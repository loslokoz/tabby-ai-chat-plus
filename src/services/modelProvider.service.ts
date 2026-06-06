import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { AIProvider } from '../config'

export interface ModelInfo {
    id: string
    name: string
    description?: string
    contextLength?: number
    provider?: AIProvider
    pricing?: {
        prompt: number
        completion: number
    }
}

@Injectable({ providedIn: 'root' })
export class ModelProviderService {
    private modelsCache: Map<string, { models: ModelInfo[]; timestamp: number }> = new Map()
    private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes

    constructor (private config: ConfigService) {}

    /**
     * Enabled providers, in display order (Custom LLM first when enabled).
     */
    get enabledProviders (): AIProvider[] {
        const cfg = this.config.store.aiAssistant
        const result: AIProvider[] = []
        if (cfg?.litellmEnabled) { result.push('litellm') }
        if (cfg?.openRouterEnabled) { result.push('openrouter') }
        return result
    }

    /**
     * Human-readable label for a provider.
     */
    providerLabel (provider: AIProvider): string {
        return provider === 'litellm' ? 'Custom LLM' : 'OpenRouter'
    }

    /**
     * The provider currently used for chat: the stored active one if it is
     * enabled, otherwise the first enabled provider.
     */
    get currentProvider (): AIProvider {
        const active = this.config.store.aiAssistant?.activeProvider as AIProvider | undefined
        const enabled = this.enabledProviders
        if (active && enabled.includes(active)) {
            return active
        }
        return enabled[0] ?? 'openrouter'
    }

    setActiveProvider (provider: AIProvider): void {
        this.config.store.aiAssistant.activeProvider = provider
        this.config.save()
    }

    /**
     * Get the current model based on the active provider
     */
    get currentModel (): string {
        return this.modelForProvider(this.currentProvider)
    }

    private modelForProvider (provider: AIProvider): string {
        const cfg = this.config.store.aiAssistant
        return provider === 'openrouter'
            ? cfg?.openRouterModel ?? 'openai/gpt-4o-mini'
            : cfg?.litellmModel ?? ''
    }

    /**
     * The model id configured for a provider (may be a manually-typed name not
     * present in the provider's /models listing).
     */
    getConfiguredModel (provider: AIProvider): string {
        return this.modelForProvider(provider)
    }

    /**
     * Set the model for the active provider
     */
    setModel (modelId: string): void {
        this.setModelForProvider(this.currentProvider, modelId)
    }

    setModelForProvider (provider: AIProvider, modelId: string): void {
        if (provider === 'openrouter') {
            this.config.store.aiAssistant.openRouterModel = modelId
        } else {
            this.config.store.aiAssistant.litellmModel = modelId
        }
        this.config.save()
    }

    /**
     * Get API endpoint for a provider (defaults to the active one)
     */
    getEndpoint (provider: AIProvider = this.currentProvider): string {
        const cfg = this.config.store.aiAssistant
        if (provider === 'openrouter') {
            return 'https://openrouter.ai/api/v1'
        }
        return cfg?.litellmEndpoint?.replace(/\/+$/, '') ?? 'http://localhost:4000/v1'
    }

    /**
     * Get API key for a provider (defaults to the active one)
     */
    getApiKey (provider: AIProvider = this.currentProvider): string {
        const cfg = this.config.store.aiAssistant
        if (provider === 'openrouter') {
            return cfg?.openRouterApiKey ?? ''
        }
        return cfg?.litellmApiKey ?? ''
    }

    /**
     * Fetch available models for a single provider (cached per provider)
     */
    async fetchModels (provider: AIProvider = this.currentProvider, forceRefresh = false): Promise<ModelInfo[]> {
        const cacheKey = `${provider}-${this.getEndpoint(provider)}`

        // Check cache
        if (!forceRefresh) {
            const cached = this.modelsCache.get(cacheKey)
            if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
                return cached.models
            }
        }

        try {
            const models = provider === 'openrouter'
                ? await this.fetchOpenRouterModels()
                : await this.fetchLiteLLMModels(provider)

            // Update cache
            this.modelsCache.set(cacheKey, { models, timestamp: Date.now() })
            return models
        } catch (error) {
            console.error('Failed to fetch models:', error)
            // Return cached if available, otherwise empty
            const cached = this.modelsCache.get(cacheKey)
            return cached?.models ?? []
        }
    }

    /**
     * Fetch models from every enabled provider, each tagged with its provider
     * and concatenated in display order (Custom LLM first).
     */
    async fetchAllModels (forceRefresh = false): Promise<ModelInfo[]> {
        const out: ModelInfo[] = []
        for (const provider of this.enabledProviders) {
            out.push(...await this.fetchModels(provider, forceRefresh))
        }
        return out
    }

    /**
     * Fetch models from OpenRouter API
     */
    private async fetchOpenRouterModels (): Promise<ModelInfo[]> {
        const response = await fetch('https://openrouter.ai/api/v1/models', {
            headers: {
                Authorization: `Bearer ${this.getApiKey('openrouter')}`,
            },
        })

        if (!response.ok) {
            throw new Error(`OpenRouter API error: ${response.status}`)
        }

        const data = await response.json()

        return (data.data || []).map((model: any) => ({
            id: model.id,
            name: model.name || model.id,
            description: model.description,
            contextLength: model.context_length,
            provider: 'openrouter' as AIProvider,
            pricing: model.pricing ? {
                prompt: parseFloat(model.pricing.prompt) * 1000000,
                completion: parseFloat(model.pricing.completion) * 1000000,
            } : undefined,
        })).sort((a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name))
    }

    /**
     * Fetch models from LiteLLM/OpenAI-compatible endpoint
     */
    private async fetchLiteLLMModels (provider: AIProvider): Promise<ModelInfo[]> {
        const endpoint = this.getEndpoint(provider)
        const apiKey = this.getApiKey(provider)

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        }
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`
        }

        const response = await fetch(`${endpoint}/models`, { headers })

        if (!response.ok) {
            throw new Error(`LiteLLM API error: ${response.status}`)
        }

        const data = await response.json()

        return (data.data || []).map((model: any) => ({
            id: model.id,
            name: model.id,
            description: model.description,
            contextLength: model.context_length,
            provider: 'litellm' as AIProvider,
        })).sort((a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name))
    }

    /**
     * Get request headers for API calls (defaults to the active provider)
     */
    getRequestHeaders (provider: AIProvider = this.currentProvider): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        }

        const apiKey = this.getApiKey(provider)
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`
        }

        if (provider === 'openrouter') {
            headers['HTTP-Referer'] = 'https://github.com/Eugeny/tabby'
            headers['X-Title'] = 'Tabby Terminal AI Assistant'
        }

        return headers
    }
}
