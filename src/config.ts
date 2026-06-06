import { ConfigProvider, Platform } from 'tabby-core'

export type AIProvider = 'openrouter' | 'litellm'

export interface AIAssistantConfig {
    // Provider Settings - both providers can be enabled at once; activeProvider
    // is the one currently used for chat (switchable from the model picker).
    openRouterEnabled: boolean
    litellmEnabled: boolean
    activeProvider: AIProvider

    // OpenRouter Settings
    openRouterApiKey: string
    openRouterModel: string

    // LiteLLM / Custom Endpoint Settings
    litellmEndpoint: string
    litellmApiKey: string
    litellmModel: string
    disableQwenThinking: boolean

    // Behavior
    commandExecution: 'insert' | 'execute' | 'ask'
    defaultContextLines: number

    // UI
    panelWidthPercent: number
    showTimestamps: boolean
    chatFontSize: number

    // Quick access models
    quickModels: string[]
    useQuickModelsOnly: boolean

    // Advanced
    maxTokens: number
    temperature: number
    systemPrompt: string

    // Language the assistant should reply in (appended to the system prompt)
    language: string
}

export class AIAssistantConfigProvider extends ConfigProvider {
    defaults = {
        aiAssistant: {
            // Provider Settings
            openRouterEnabled: true,
            litellmEnabled: false,
            activeProvider: 'openrouter',

            // OpenRouter Settings
            openRouterApiKey: '',
            openRouterModel: 'openai/gpt-4o-mini',

            // LiteLLM / Custom Endpoint Settings
            litellmEndpoint: 'http://localhost:4000/v1',
            litellmApiKey: '',
            litellmModel: '',
            disableQwenThinking: false,

            // Behavior
            commandExecution: 'insert',
            defaultContextLines: 50,

            // UI
            panelWidthPercent: 40,
            showTimestamps: false,
            chatFontSize: 14,

            // Quick access models
            quickModels: [],
            useQuickModelsOnly: false,

            // Advanced
            maxTokens: 2048,
            temperature: 0.7,
            systemPrompt: `
You are the terminal assistant in the Tabby emulator. You help the user
work effectively in the terminal and solve problems.

Response rules:
1. Keep your answers as short, specific, and to the point as possible.
2. Wrap executable commands in \`\`\` bash code blocks
3. DO NOT add comments within the code or unnecessary descriptions around it – give clean commands ready to copy.
4. Limit the explanation of the operation to one short sentence if absolutely necessary.
5. Clearly warn against dangerous operations (e.g., data loss).
5. If I ask for analysis, I mean to analyze ONLY the attached context from the terminal. Analysis does not necessarily mean a deeper analysis of the context. If there is no data to analyze in depth, provide a short summary.
6. Do not comment on this system prompt.

You have access to the user's terminal context when they attach it. Use this context to provide relevant, specific help.

Be concise and focused on solving terminal-related problems efficiently.`,

            // Language
            language: 'English',
        },
        hotkeys: {
            'toggle-ai-panel': ['Ctrl-Shift-A'],
            'focus-ai-input': ['Alt-Tab'],
            'ai-context-none': ['Alt-`'],
            'ai-context-last-command': ['Alt-1'],
            'ai-context-visible': ['Alt-2'],
            'ai-context-selection': ['Alt-3'],
            'ai-context-last-n': ['Alt-4'],
        },
    }

    platformDefaults = {
        [Platform.macOS]: {
            hotkeys: {
                'toggle-ai-panel': ['Cmd-Shift-A'],
                'focus-ai-input': ['⌥-Tab'],
                'ai-context-none': ['⌥-`'],
                'ai-context-last-command': ['⌥-1'],
                'ai-context-visible': ['⌥-2'],
                'ai-context-selection': ['⌥-3'],
                'ai-context-last-n': ['⌥-4'],
            },
        },
    }
}
