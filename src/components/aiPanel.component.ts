import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core'
import { Subscription } from 'rxjs'
import { ConfigService } from 'tabby-core'
import { Frontend } from 'tabby-terminal'
import { TerminalContextService } from '../services/terminalContext.service'
import { ModelProviderService, ModelInfo } from '../services/modelProvider.service'

export type ContextMode = 'none' | 'visible' | 'lastN' | 'lastCommand' | 'selection'

interface ChatMessage {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: Date
    isStreaming?: boolean
    attachedContext?: string
    commands?: string[]
    // Reasoning ("thinking") trace emitted before the answer. Kept separate so
    // it can be shown in a collapsible block and excluded from command parsing.
    reasoning?: string
    isThinking?: boolean
    showReasoning?: boolean
}

@Component({
    selector: 'ai-panel',
    templateUrl: './aiPanel.component.pug',
    styleUrls: ['./aiPanel.component.scss'],
})
export class AIPanelComponent implements OnInit, OnDestroy {
    @Input() frontend: Frontend | undefined
    @Output() closed = new EventEmitter<void>()
    @Output() insertCommand = new EventEmitter<string>()
    @Output() executeCommand = new EventEmitter<string>()
    @Output() widthChanged = new EventEmitter<number>()

    @ViewChild('messageInput') messageInput!: ElementRef<HTMLTextAreaElement>
    @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>

    // Each panel has its own messages - not shared!
    messages: ChatMessage[] = []
    inputText = ''
    isLoading = false
    currentStreamingContent = ''
    currentStreamingId = ''

    // Live reasoning state for the message currently streaming
    currentReasoningContent = ''
    currentIsThinking = false
    showStreamingReasoning = false

    // Keyboard navigation over the generated commands of one assistant message
    commandNavMessageId = ''
    selectedCommandIndex = 0

    // Context options
    contextMode: ContextMode = 'none'
    contextLines = 50
    attachedContext = ''
    showContextPreview = false

    // Per-conversation override that re-enables reasoning for Qwen3.5 models
    // when it is globally disabled in settings (see canOverrideReasoning).
    reasoningEnabled = false

    // Model picker
    availableModels: ModelInfo[] = []
    isLoadingModels = false
    modelSearchTerm = ''

    private subscriptions: Subscription[] = []
    private abortController: AbortController | null = null
    private resizeStartX = 0
    private resizeStartWidth = 0
    private resizeMoveHandler: ((e: MouseEvent) => void) | null = null
    private resizeUpHandler: ((e: MouseEvent) => void) | null = null

    constructor (
        private contextService: TerminalContextService,
        public config: ConfigService,
        private cdr: ChangeDetectorRef,
        public modelProvider: ModelProviderService,
        private hostRef: ElementRef,
    ) {}

    ngOnInit (): void {
        // Load context settings
        this.contextLines = this.config.store.aiAssistant?.defaultContextLines ?? 50

        // On open, default the context to the last command's output and fetch it
        // so the panel starts already aware of what the user just ran.
        this.setContextMode('lastCommand')

        // Load available models
        this.loadModels()
    }

    async loadModels (forceRefresh = false): Promise<void> {
        this.isLoadingModels = true
        this.cdr.detectChanges()

        try {
            this.availableModels = await this.modelProvider.fetchModels(forceRefresh)
        } catch (error) {
            console.error('Failed to load models:', error)
        } finally {
            this.isLoadingModels = false
            this.cdr.detectChanges()
        }
    }

    selectModel (model: ModelInfo): void {
        this.modelProvider.setModel(model.id)
        this.cdr.detectChanges()
    }

    get filteredModels (): ModelInfo[] {
        const useQuickOnly = this.config.store.aiAssistant?.useQuickModelsOnly ?? false
        const quickIds: string[] = this.config.store.aiAssistant?.quickModels ?? []

        let source = this.availableModels
        if (useQuickOnly && quickIds.length > 0) {
            source = quickIds
                .map(id => this.availableModels.find(m => m.id === id) ?? { id, name: id })
        }

        if (!this.modelSearchTerm) {
            return source.slice(0, 50)
        }
        const term = this.modelSearchTerm.toLowerCase()
        return source.filter(m =>
            m.id.toLowerCase().includes(term) ||
            m.name.toLowerCase().includes(term),
        ).slice(0, 50)
    }

    get currentModelDisplay (): string {
        const modelId = this.modelProvider.currentModel
        const model = this.availableModels.find(m => m.id === modelId)
        if (model) {
            return model.name
        }
        // Truncate long model IDs for display
        if (modelId.length > 25) {
            return modelId.slice(0, 22) + '...'
        }
        return modelId || 'Select model'
    }

    ngOnDestroy (): void {
        this.subscriptions.forEach(s => s.unsubscribe())
        this.cancelRequest()
        this.cleanupResizeListeners()
    }

    onResizeStart (event: MouseEvent): void {
        event.preventDefault()
        event.stopPropagation()

        const hostEl = this.hostRef.nativeElement as HTMLElement
        const parentWidth = hostEl.parentElement?.offsetWidth ?? 0
        if (!parentWidth) { return }

        this.resizeStartX = event.clientX
        this.resizeStartWidth = hostEl.offsetWidth / parentWidth * 100

        this.resizeMoveHandler = (e: MouseEvent) => {
            const delta = this.resizeStartX - e.clientX
            const newWidth = Math.min(70, Math.max(15, this.resizeStartWidth + delta / parentWidth * 100))
            hostEl.style.width = `${newWidth}%`
            this.widthChanged.emit(newWidth)
        }

        this.resizeUpHandler = (e: MouseEvent) => {
            const delta = this.resizeStartX - e.clientX
            const newWidth = Math.min(70, Math.max(15, this.resizeStartWidth + delta / parentWidth * 100))
            this.config.store.aiAssistant.panelWidthPercent = Math.round(newWidth)
            this.config.save()
            this.cleanupResizeListeners()
        }

        document.addEventListener('mousemove', this.resizeMoveHandler)
        document.addEventListener('mouseup', this.resizeUpHandler)
    }

    private cleanupResizeListeners (): void {
        if (this.resizeMoveHandler) {
            document.removeEventListener('mousemove', this.resizeMoveHandler)
            this.resizeMoveHandler = null
        }
        if (this.resizeUpHandler) {
            document.removeEventListener('mouseup', this.resizeUpHandler)
            this.resizeUpHandler = null
        }
    }

    close (): void {
        this.closed.emit()
    }

    async sendMessage (): Promise<void> {
        const text = this.inputText.trim()
        if (!text || this.isLoading) { return }

        this.inputText = ''
        this.isLoading = true
        this.cdr.detectChanges()

        // Update context before sending
        this.updateAttachedContext()

        // Create user message
        const userMsg: ChatMessage = {
            id: this.generateId(),
            role: 'user',
            content: text,
            timestamp: new Date(),
            attachedContext: this.attachedContext || undefined,
        }
        this.messages.push(userMsg)

        // Create placeholder for assistant response
        const assistantMsg: ChatMessage = {
            id: this.generateId(),
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            isStreaming: true,
        }
        this.messages.push(assistantMsg)
        this.currentStreamingId = assistantMsg.id
        this.currentStreamingContent = ''
        this.currentReasoningContent = ''
        this.currentIsThinking = false
        this.showStreamingReasoning = false
        this.cdr.detectChanges()
        this.scrollToBottom()

        try {
            this.abortController = new AbortController()

            await this.makeStreamingRequest(assistantMsg)

        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                console.error('AI request failed:', error)
                assistantMsg.content = `Error: ${(error as Error).message}`
            }
            assistantMsg.isStreaming = false
            this.isLoading = false
        }

        this.abortController = null
        this.cdr.detectChanges()
        this.scrollToBottom()

        // Clear context after sending
        if (this.contextMode !== 'none') {
            this.attachedContext = ''
            this.showContextPreview = false
        }
    }

    private async makeStreamingRequest (assistantMsg: ChatMessage): Promise<void> {
        const aiConfig = this.config.store.aiAssistant
        const apiKey = this.modelProvider.getApiKey()

        // Only require API key for OpenRouter - LiteLLM may not need one
        if (!apiKey && this.modelProvider.currentProvider === 'openrouter') {
            throw new Error('API key not configured. Please set your OpenRouter API key in Settings > AI Assistant.')
        }

        const endpoint = this.modelProvider.getEndpoint() + '/chat/completions'

        // Build messages for API
        const apiMessages: { role: string; content: string }[] = []

        // System prompt
        const systemContent = aiConfig.systemPrompt || 'You are a helpful terminal assistant.'
        apiMessages.push({ role: 'system', content: systemContent })

        // Add conversation history (excluding current streaming message).
        // Each user message carries its own attached context inline so it travels
        // with that turn and is preserved across the whole conversation, instead
        // of relying on a single volatile system-prompt copy.
        for (const msg of this.messages) {
            if (msg.isStreaming) { continue }
            if (msg.role !== 'user' && msg.role !== 'assistant') { continue }

            let { content } = msg
            if (msg.role === 'user' && msg.attachedContext) {
                content += `\n\n## Terminal Context\n\`\`\`\n${msg.attachedContext}\n\`\`\``
            }
            apiMessages.push({ role: msg.role, content })
        }

        const body: Record<string, unknown> = {
            model: this.modelProvider.currentModel,
            messages: apiMessages,
            max_tokens: aiConfig.maxTokens || 2048,
            temperature: aiConfig.temperature || 0.7,
            stream: true,
        }

        // Disable reasoning for Qwen3.5-family models on a self-hosted endpoint.
        // Qwen3.5 thinks by default and exposes no /no_think soft switch; the
        // OpenAI-compatible way (vLLM/SGLang) is chat_template_kwargs.enable_thinking.
        // See https://huggingface.co/Qwen/Qwen3.5-122B-A10B
        if (this.canOverrideReasoning && !this.reasoningEnabled) {
            body.chat_template_kwargs = { enable_thinking: false }
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: this.modelProvider.getRequestHeaders(),
            body: JSON.stringify(body),
            signal: this.abortController?.signal,
        })

        if (!response.ok) {
            const errorText = await response.text()
            let errorMessage = `API request failed: ${response.status}`
            try {
                const errorJson = JSON.parse(errorText)
                errorMessage = errorJson.error?.message || errorJson.message || errorMessage
            } catch {
                if (errorText) {
                    errorMessage = errorText.slice(0, 200)
                }
            }
            throw new Error(errorMessage)
        }

        if (!response.body) {
            throw new Error('Response body is null')
        }

        // Process stream
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        // Raw accumulators: `rawContent` is the model's `content` (may carry
        // inline <think>...</think>), `reasoningField` is the separate
        // `reasoning_content` some endpoints emit. Both feed the split below.
        let rawContent = ''
        let reasoningField = ''

        // Some chat templates (e.g. Qwen3.5) open the <think> block implicitly,
        // so the opening tag never reaches the stream - only the closing
        // </think> does. When we expect reasoning, assume the block is open from
        // the start so the trace is shown as thinking (not leaked into the
        // answer) until </think> arrives.
        const expectThinking = this.expectsThinking

        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) { break }

                buffer += decoder.decode(value, { stream: true })

                // Process complete SSE events
                const lines = buffer.split('\n')
                buffer = lines.pop() ?? ''

                for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed.startsWith('data: ')) { continue }

                    const data = trimmed.slice(6)
                    if (data === '[DONE]') { continue }

                    try {
                        const parsed = JSON.parse(data)
                        const delta = parsed.choices?.[0]?.delta
                        const piece: string | undefined = delta?.content
                        const reasoningPiece: string | undefined = delta?.reasoning_content ?? delta?.reasoning
                        if (!piece && !reasoningPiece) { continue }

                        if (reasoningPiece) { reasoningField += reasoningPiece }
                        if (piece) { rawContent += piece }

                        const { thinking, answer } = this.splitThinking(rawContent, reasoningField, expectThinking)
                        this.currentReasoningContent = thinking
                        this.currentStreamingContent = answer
                        this.currentIsThinking = !!thinking && !answer.trim()
                        assistantMsg.reasoning = thinking || undefined
                        assistantMsg.content = answer
                        assistantMsg.isThinking = this.currentIsThinking

                        this.cdr.detectChanges()
                        this.scrollToBottom()
                        await new Promise(resolve => setTimeout(resolve, 0))
                    } catch {
                        // Skip malformed JSON chunks
                    }
                }
            }
        } finally {
            reader.releaseLock()
        }

        this.finalizeAssistantMessage(assistantMsg, rawContent, reasoningField, expectThinking)
    }

    private finalizeAssistantMessage (assistantMsg: ChatMessage, rawContent: string, reasoningField: string, expectThinking: boolean): void {
        const final = this.splitThinking(rawContent, reasoningField, expectThinking)
        assistantMsg.content = final.answer
        assistantMsg.reasoning = final.thinking || undefined
        assistantMsg.isThinking = false
        assistantMsg.showReasoning = this.showStreamingReasoning
        assistantMsg.isStreaming = false
        // Commands are parsed only from the answer, never the thinking trace, so
        // anything the model "thought" of stays out of the executable list.
        assistantMsg.commands = this.extractCommands(assistantMsg.content)
        this.currentStreamingId = ''
        this.currentStreamingContent = ''
        this.currentReasoningContent = ''
        this.currentIsThinking = false
        this.isLoading = false
        this.cdr.detectChanges()
        this.activateCommandNav(assistantMsg)
    }

    /**
     * Separate a reasoning ("thinking") trace from the actual answer.
     *
     * Two transports are supported: a dedicated `reasoning_content` field
     * (`reasoningField`) and inline `<think>...</think>` tags inside the
     * content. Some chat templates open the think block implicitly, so a
     * closing `</think>` with no opener still marks everything before it as
     * thinking. When `assumeOpen` is set, content with no tags at all is treated
     * as thinking too (for templates that open <think> implicitly).
     */
    private splitThinking (raw: string, reasoningField: string, assumeOpen = false): { thinking: string; answer: string } {
        let inlineThinking = ''
        let answer = raw

        const close = raw.indexOf('</think>')
        if (close !== -1) {
            const open = raw.indexOf('<think>')
            const start = open === -1 ? 0 : open + '<think>'.length
            inlineThinking = raw.slice(start, close)
            answer = raw.slice(close + '</think>'.length)
        } else {
            const open = raw.indexOf('<think>')
            if (open !== -1) {
                inlineThinking = raw.slice(open + '<think>'.length)
                answer = ''
            } else if (assumeOpen && raw) {
                inlineThinking = raw
                answer = ''
            }
        }

        const thinking = [reasoningField, inlineThinking]
            .map(s => s.trim())
            .filter(Boolean)
            .join('\n')

        return { thinking, answer }
    }

    cancelRequest (): void {
        if (this.abortController) {
            this.abortController.abort()
            this.abortController = null
        }
        this.isLoading = false
        this.currentStreamingId = ''
        this.currentStreamingContent = ''
        this.currentReasoningContent = ''
        this.currentIsThinking = false

        // Mark any streaming message as complete
        for (const msg of this.messages) {
            if (msg.isStreaming) {
                msg.isStreaming = false
                msg.isThinking = false
                if (!msg.content) {
                    msg.content = msg.reasoning ? '(stopped while thinking)' : '(cancelled)'
                }
            }
        }
        this.cdr.detectChanges()
    }

    clearChat (): void {
        this.messages = []
        this.currentStreamingContent = ''
        this.currentStreamingId = ''
        this.isLoading = false
        this.cdr.detectChanges()
    }

    /**
     * Keep panel keystrokes from leaking to the terminal, but let Alt/⌥ combos
     * (and the Alt key release) bubble to Tabby's HotkeysService so the
     * configurable context shortcuts actually fire from inside the panel.
     */
    onContainerKey (event: KeyboardEvent): void {
        if (event.altKey || event.key === 'Alt') { return }
        event.stopPropagation()
    }

    onKeyDown (event: KeyboardEvent): void {
        // Context-switch shortcuts are registered as configurable Tabby hotkeys
        // (defaults Alt/⌥ + §/1..4) and handled by the decorator. Let Alt combos
        // bubble to Tabby's HotkeysService instead of consuming them here. Only
        // suppress the default for the keys those shortcuts use (digits / § /
        // backquote) so we don't insert the macOS Option character - Alt+letter
        // combos must keep typing so Polish diacritics (ą, ć, ę, ł, …) work.
        if (event.altKey) {
            if (/^(Digit\d|IntlBackslash|Backquote|Tab)$/.test(event.code)) {
                event.preventDefault()
            }
            return
        }

        // Prevent terminal from capturing keystrokes
        event.stopPropagation()

        // Submit on Enter (without Shift)
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            this.sendMessage()
        }

        // Cancel on Escape
        if (event.key === 'Escape') {
            if (this.isLoading) {
                this.cancelRequest()
            } else {
                this.close()
            }
        }
    }

    /**
     * Called by the decorator once a command executed from the chat has
     * finished: switch the context to the freshly produced output and refresh.
     */
    showLastCommandOutput (): void {
        this.setContextMode('lastCommand')
        this.cdr.detectChanges()
    }

    // Context management
    setContextMode (mode: ContextMode): void {
        this.contextMode = mode
        if (mode !== 'none') {
            this.updateAttachedContext()
            this.showContextPreview = true
        } else {
            this.attachedContext = ''
            this.showContextPreview = false
        }
    }

    updateAttachedContext (): void {
        if (!this.frontend) {
            this.attachedContext = ''
            return
        }

        let context: { content: string } | null = null

        switch (this.contextMode) {
            case 'visible':
                context = this.contextService.getVisibleContent(this.frontend)
                break
            case 'lastN':
                context = this.contextService.getLastNLines(this.frontend, this.contextLines)
                break
            case 'lastCommand':
                context = this.contextService.getLastCommandContext(this.frontend)
                break
            case 'selection':
                const selection = this.contextService.getSelection(this.frontend)
                if (selection) {
                    this.attachedContext = selection
                    return
                }
                break
            case 'none':
            default:
                this.attachedContext = ''
                return
        }

        this.attachedContext = context?.content ?? ''
    }

    refreshContext (): void {
        this.updateAttachedContext()
    }

    // Command navigation - lets the user move across the commands generated in
    // the latest assistant message with the arrow keys and run one with Enter.
    private activateCommandNav (msg: ChatMessage): void {
        if (msg.role !== 'assistant' || !msg.commands?.length) {
            this.focusInput()
            return
        }
        this.commandNavMessageId = msg.id
        this.selectedCommandIndex = 0
        this.focusCommand(0)
    }

    selectCommand (msgId: string, index: number): void {
        this.commandNavMessageId = msgId
        this.selectedCommandIndex = index
    }

    onCommandKey (event: KeyboardEvent, msgId: string): void {
        event.stopPropagation()
        const msg = this.messages.find(m => m.id === msgId)
        const count = msg?.commands?.length ?? 0
        if (count === 0) { return }

        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowRight':
                event.preventDefault()
                this.selectedCommandIndex = (this.selectedCommandIndex + 1) % count
                this.focusCommand(this.selectedCommandIndex)
                break
            case 'ArrowUp':
            case 'ArrowLeft':
                event.preventDefault()
                this.selectedCommandIndex = (this.selectedCommandIndex - 1 + count) % count
                this.focusCommand(this.selectedCommandIndex)
                break
            case 'Enter':
                event.preventDefault()
                this.handleExecuteCommand(msg!.commands![this.selectedCommandIndex])
                break
            case 'Escape':
                event.preventDefault()
                this.focusInput()
                break
            default:
                break
        }
    }

    private focusCommand (index: number): void {
        this.cdr.detectChanges()
        setTimeout(() => {
            const blocks = Array.from(
                this.hostRef.nativeElement.querySelectorAll('.command-block.cmd-nav') as NodeListOf<HTMLElement>,
            )
            const el = blocks.at(index)
            if (el) {
                el.focus()
                el.scrollIntoView({ block: 'nearest' })
            }
        }, 0)
    }

    // Command handling
    handleInsertCommand (command: string): void {
        this.insertCommand.emit(command)
    }

    handleExecuteCommand (command: string): void {
        const execMode = this.config.store.aiAssistant?.commandExecution ?? 'insert'

        switch (execMode) {
            case 'execute':
                this.executeCommand.emit(command)
                break
            case 'ask':
                if (window.confirm(`Execute command?\n\n${command}`)) {
                    this.executeCommand.emit(command)
                }
                break
            case 'insert':
            default:
                this.insertCommand.emit(command)
                break
        }
    }

    extractCommands (content: string): string[] {
        const commands: string[] = []
        const codeBlockRegex = /```(?:bash|shell|sh|zsh|cmd|powershell|ps1)?\n([\s\S]*?)```/g

        let match: RegExpExecArray | null = null
        while ((match = codeBlockRegex.exec(content)) !== null) {
            const code = match[1].trim()
            if (code) {
                const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
                commands.push(...lines)
            }
        }

        return commands
    }


    onInputFocus (): void {
        this.updateAttachedContext()
        this.cdr.detectChanges()
    }

    focusInput (): void {
        setTimeout(() => {
            this.messageInput.nativeElement.focus()
        }, 0)
    }

    private scrollToBottom (): void {
        setTimeout(() => {
            const el = this.messagesContainer.nativeElement
            el.scrollTop = el.scrollHeight
        }, 0)
    }

    private generateId (): string {
        return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    }

    /**
     * Whether the per-chat reasoning toggle is relevant: reasoning is globally
     * disabled for Qwen3.5 on a self-hosted endpoint, so the user may want to
     * re-enable it for the current conversation.
     */
    get canOverrideReasoning (): boolean {
        return this.modelProvider.currentProvider === 'litellm' &&
            (this.config.store.aiAssistant?.disableQwenThinking ?? false) &&
            /qwen3\.?5/i.test(this.modelProvider.currentModel)
    }

    /**
     * Whether the next request should expect a reasoning trace. True for
     * Qwen3.5 unless thinking was actively disabled for this chat (i.e. we sent
     * enable_thinking=false). Used to treat an implicitly-opened <think> block
     * as thinking before its closing tag arrives.
     */
    private get expectsThinking (): boolean {
        if (!/qwen3\.?5/i.test(this.modelProvider.currentModel)) { return false }
        const thinkingDisabled = this.canOverrideReasoning && !this.reasoningEnabled
        return !thinkingDisabled
    }

    get contextModeLabel (): string {
        const labels: Record<ContextMode, string> = {
            none: 'No context',
            visible: 'Visible content',
            lastN: `Last ${this.contextLines} lines`,
            lastCommand: 'Last command',
            selection: 'Selection',
        }
        return labels[this.contextMode]
    }
}
