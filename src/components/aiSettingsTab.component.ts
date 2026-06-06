import { Component, HostBinding, OnInit } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { ModelProviderService, ModelInfo } from '../services/modelProvider.service'

@Component({
    templateUrl: './aiSettingsTab.component.pug',
    styleUrls: ['./aiSettingsTab.component.scss'],
})
export class AISettingsTabComponent implements OnInit {
    @HostBinding('class.content-box') true

    // Model lists
    openRouterModels: ModelInfo[] = []
    litellmModels: ModelInfo[] = []
    isLoadingOpenRouterModels = false
    isLoadingLitellmModels = false

    // Search filters
    openRouterSearchTerm = ''
    litellmSearchTerm = ''

    // Quick access models
    quickModelSearchTerm = ''
    customModelInput = ''

    constructor (
        public config: ConfigService,
        private modelProvider: ModelProviderService,
    ) {}

    ngOnInit (): void {
        // Load models for each enabled provider
        if (this.config.store.aiAssistant?.openRouterEnabled) {
            this.loadOpenRouterModels()
        }
        if (this.config.store.aiAssistant?.litellmEnabled) {
            this.loadLitellmModels()
        }
    }

    onToggleOpenRouter (): void {
        this.config.save()
        if (this.config.store.aiAssistant.openRouterEnabled && this.openRouterModels.length === 0) {
            this.loadOpenRouterModels()
        }
    }

    onToggleLitellm (): void {
        this.config.save()
        if (this.config.store.aiAssistant.litellmEnabled && this.litellmModels.length === 0) {
            this.loadLitellmModels()
        }
    }

    async loadOpenRouterModels (): Promise<void> {
        this.isLoadingOpenRouterModels = true
        try {
            this.openRouterModels = await this.modelProvider.fetchModels('openrouter', true)
        } catch (error) {
            console.error('Failed to load OpenRouter models:', error)
        } finally {
            this.isLoadingOpenRouterModels = false
        }
    }

    async loadLitellmModels (): Promise<void> {
        this.isLoadingLitellmModels = true
        try {
            this.litellmModels = await this.modelProvider.fetchModels('litellm', true)
        } catch (error) {
            console.error('Failed to load LiteLLM models:', error)
        } finally {
            this.isLoadingLitellmModels = false
        }
    }

    get filteredOpenRouterModels (): ModelInfo[] {
        if (!this.openRouterSearchTerm) {
            return this.openRouterModels.slice(0, 100)
        }
        const term = this.openRouterSearchTerm.toLowerCase()
        return this.openRouterModels.filter(m =>
            m.id.toLowerCase().includes(term) ||
            m.name.toLowerCase().includes(term),
        ).slice(0, 100)
    }

    get filteredLitellmModels (): ModelInfo[] {
        if (!this.litellmSearchTerm) {
            return this.litellmModels.slice(0, 100)
        }
        const term = this.litellmSearchTerm.toLowerCase()
        return this.litellmModels.filter(m =>
            m.id.toLowerCase().includes(term) ||
            m.name.toLowerCase().includes(term),
        ).slice(0, 100)
    }

    selectOpenRouterModel (model: ModelInfo): void {
        this.config.store.aiAssistant.openRouterModel = model.id
        this.config.save()
    }

    selectLitellmModel (model: ModelInfo): void {
        this.config.store.aiAssistant.litellmModel = model.id
        this.config.save()
    }

    testConnection (): void {
        // TODO: Implement connection test
        console.log('Testing connection...')
    }

    get quickModels (): string[] {
        return this.config.store.aiAssistant?.quickModels ?? []
    }

    get availableModelsForQuick (): ModelInfo[] {
        const all = [...this.litellmModels, ...this.openRouterModels]
        const term = this.quickModelSearchTerm.toLowerCase()
        return all
            .filter(m => !this.quickModels.includes(m.id))
            .filter(m => !term || m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term))
            .slice(0, 50)
    }

    addQuickModel (modelId: string): void {
        const id = modelId.trim()
        if (!id || this.quickModels.includes(id)) { return }
        this.config.store.aiAssistant.quickModels = [...this.quickModels, id]
        this.config.save()
        this.customModelInput = ''
    }

    removeQuickModel (modelId: string): void {
        this.config.store.aiAssistant.quickModels =
            this.quickModels.filter(id => id !== modelId)
        this.config.save()
    }
}
