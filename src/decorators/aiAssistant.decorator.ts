import { Injectable, ComponentRef, Injector, ApplicationRef, createComponent, EnvironmentInjector } from '@angular/core'
import { take, Subscription } from 'rxjs'
import { HotkeysService, ConfigService } from 'tabby-core'
import { TerminalDecorator, BaseTerminalTabComponent } from 'tabby-terminal'
import { AIPanelComponent, ContextMode } from '../components/aiPanel.component'
import { CommandTrackerService } from '../services/commandTracker.service'

/** Tabby hotkey id -> chat context mode it selects. */
const CONTEXT_HOTKEYS: Partial<Record<string, ContextMode>> = {
    'ai-context-none': 'none',
    'ai-context-last-command': 'lastCommand',
    'ai-context-visible': 'visible',
    'ai-context-selection': 'selection',
    'ai-context-last-n': 'lastN',
}

/**
 * Decorator that attaches the AI Assistant panel to terminal tabs.
 * Uses hotkey to toggle the panel visibility.
 */
@Injectable()
export class AIAssistantDecorator extends TerminalDecorator {
    private panelRefs = new Map<BaseTerminalTabComponent<any>, ComponentRef<AIPanelComponent>>()
    private panelVisible = new Map<BaseTerminalTabComponent<any>, boolean>()
    private origXtermFocus = new Map<BaseTerminalTabComponent<any>, () => void>()
    private commandWatchers = new Map<BaseTerminalTabComponent<any>, Subscription>()

    constructor (
        private hotkeys: HotkeysService,
        private config: ConfigService,
        private appRef: ApplicationRef,
        private injector: Injector,
        private envInjector: EnvironmentInjector,
        private commandTracker: CommandTrackerService,
    ) {
        super()
    }

    attach (terminal: BaseTerminalTabComponent<any>): void {
        // Start tracking command boundaries. frontendReady is a plain Subject
        // (no replay), so attach immediately if the frontend already exists and
        // otherwise wait for the readiness signal.
        const attachTracker = (): void => {
            if (terminal.frontend) {
                this.commandTracker.attach(terminal.frontend)
            }
        }
        if (terminal.frontend) {
            attachTracker()
        } else {
            this.subscribeUntilDetached(
                terminal,
                terminal.frontendReady$.pipe(take(1)).subscribe(attachTracker),
            )
        }

        // Subscribe to hotkey to toggle AI panel
        this.subscribeUntilDetached(
            terminal,
            this.hotkeys.hotkey$.subscribe(hotkey => {
                if (hotkey === 'toggle-ai-panel' && terminal.hasFocus) {
                    this.togglePanel(terminal)
                }

                if (hotkey === 'focus-ai-input' && this.panelVisible.get(terminal)) {
                    const panelRef = this.panelRefs.get(terminal)
                    const hostEl = panelRef?.location.nativeElement as HTMLElement | undefined
                    if (hostEl?.contains(document.activeElement)) {
                        // Focus is inside the chat - toggle back to the terminal.
                        this.focusTerminal(terminal)
                    } else {
                        // Focus is in the terminal - jump into the chat with the
                        // last command's output attached.
                        panelRef?.instance.setContextMode('lastCommand')
                        panelRef?.changeDetectorRef.detectChanges()
                        this.focusChatInput(terminal)
                    }
                }

                const contextMode = CONTEXT_HOTKEYS[hotkey]
                if (contextMode) {
                    this.applyContextHotkey(terminal, contextMode)
                }
            }),
        )
    }

    detach (terminal: BaseTerminalTabComponent<any>): void {
        this.commandWatchers.get(terminal)?.unsubscribe()
        this.commandWatchers.delete(terminal)
        if (terminal.frontend) {
            this.commandTracker.detach(terminal.frontend)
        }
        this.destroyPanel(terminal)
        this.panelVisible.delete(terminal)
        super.detach(terminal)
    }

    private togglePanel (terminal: BaseTerminalTabComponent<any>): void {
        const isVisible = this.panelVisible.get(terminal) ?? false

        if (isVisible) {
            this.hidePanel(terminal)
        } else {
            this.showPanel(terminal)
        }
    }

    private showPanel (terminal: BaseTerminalTabComponent<any>): void {
        if (this.panelRefs.has(terminal)) {
            // Panel already exists, just show it
            const ref = this.panelRefs.get(terminal)!
            ref.location.nativeElement.style.display = 'flex'
            this.panelVisible.set(terminal, true)
            this.updateTerminalLayout(terminal, true)
            this.focusChatInput(terminal)
            return
        }

        // Create the AI panel component
        const panelRef = createComponent(AIPanelComponent, {
            environmentInjector: this.envInjector,
            elementInjector: this.injector,
        })

        // Set inputs
        panelRef.instance.frontend = terminal.frontend

        // Handle outputs
        panelRef.instance.closed.subscribe(() => {
            this.hidePanel(terminal)
        })

        panelRef.instance.insertCommand.subscribe((cmd: string) => {
            this.insertCommandIntoTerminal(terminal, cmd)
        })

        panelRef.instance.executeCommand.subscribe((cmd: string) => {
            this.executeCommandInTerminal(terminal, cmd)
        })

        panelRef.instance.widthChanged.subscribe((widthPercent: number) => {
            const contentEl = terminal.element.nativeElement.querySelector('.content') as HTMLElement | null
            if (contentEl) {
                contentEl.style.width = `${100 - widthPercent}%`
            }
        })

        // Attach to the terminal's host element
        const hostElement = terminal.element.nativeElement
        const panelElement = panelRef.location.nativeElement

        // Style the panel
        const widthPercent = this.config.store.aiAssistant?.panelWidthPercent ?? 40
        panelElement.style.cssText = `
            position: absolute;
            top: 0;
            right: 0;
            width: ${widthPercent}%;
            height: 100%;
            z-index: 100;
            display: flex;
            flex-direction: column;
            pointer-events: auto;
            background: var(--theme-bg);
        `

        hostElement.appendChild(panelElement)
        this.appRef.attachView(panelRef.hostView)

        this.panelRefs.set(terminal, panelRef)
        this.panelVisible.set(terminal, true)

        // Update terminal layout to make room for panel
        this.updateTerminalLayout(terminal, true)

        // Detect changes
        panelRef.changeDetectorRef.detectChanges()
        this.focusChatInput(terminal)
    }

    private hidePanel (terminal: BaseTerminalTabComponent<any>): void {
        const ref = this.panelRefs.get(terminal)
        if (ref) {
            ref.location.nativeElement.style.display = 'none'
        }
        this.panelVisible.set(terminal, false)
        this.updateTerminalLayout(terminal, false)

        // Refocus terminal
        terminal.frontend?.focus()
    }

    private destroyPanel (terminal: BaseTerminalTabComponent<any>): void {
        const ref = this.panelRefs.get(terminal)
        if (ref) {
            this.appRef.detachView(ref.hostView)
            ref.destroy()
            this.panelRefs.delete(terminal)
        }
    }

    private updateTerminalLayout (terminal: BaseTerminalTabComponent<any>, panelVisible: boolean): void {
        // Get the terminal's content element
        const contentEl = terminal.element.nativeElement.querySelector('.content') as HTMLElement | null
        if (contentEl) {
            if (panelVisible) {
                const widthPercent = this.config.store.aiAssistant?.panelWidthPercent ?? 40
                contentEl.style.width = `${100 - widthPercent}%`
            } else {
                contentEl.style.width = '100%'
            }
        }

        // Trigger terminal resize after layout change
        setTimeout(() => {
            // Access xterm resize via the frontend if available
            const frontend = terminal.frontend as any
            if (frontend?.resizeHandler) {
                frontend.resizeHandler()
            }
        }, 100)
    }

    /**
     * Switch the chat context mode in response to a context hotkey. Scoped to
     * the terminal whose chat input currently holds focus so the shortcut only
     * fires for the panel the user is actually typing in (and never the wrong
     * panel when several terminals are open).
     */
    private applyContextHotkey (terminal: BaseTerminalTabComponent<any>, mode: ContextMode): void {
        if (!this.panelVisible.get(terminal)) { return }
        const panelRef = this.panelRefs.get(terminal)
        if (!panelRef) { return }
        const hostEl = panelRef.location.nativeElement as HTMLElement
        if (!hostEl.contains(document.activeElement)) { return }
        panelRef.instance.setContextMode(mode)
        panelRef.changeDetectorRef.detectChanges()
    }

    private focusChatInput (terminal: BaseTerminalTabComponent<any>): void {
        setTimeout(() => {
            const xtermTextarea = terminal.element.nativeElement
                .querySelector('.xterm-helper-textarea') as HTMLElement | null
            if (xtermTextarea) {
                const orig = xtermTextarea.focus.bind(xtermTextarea)
                this.origXtermFocus.set(terminal, orig)
                xtermTextarea.focus = () => { /* blocked while panel is open */ }
            }
            const panelRef = this.panelRefs.get(terminal)
            const chatInput = panelRef?.location.nativeElement
                .querySelector('textarea') as HTMLElement | null
            chatInput?.focus()
            if (xtermTextarea) {
                setTimeout(() => {
                    const orig = this.origXtermFocus.get(terminal)
                    if (orig) {
                        xtermTextarea.focus = orig
                        this.origXtermFocus.delete(terminal)
                    }
                }, 100)
            }
        }, 150)
    }

    private insertCommandIntoTerminal (terminal: BaseTerminalTabComponent<any>, command: string): void {
        // Insert command without executing (don't add newline)
        terminal.sendInput(command)
        terminal.frontend?.focus()
    }

    private executeCommandInTerminal (terminal: BaseTerminalTabComponent<any>, command: string): void {
        if (!terminal.frontend) {
            terminal.sendInput(command + '\n')
            return
        }

        // Cancel any previous, still-pending watcher for this terminal.
        this.commandWatchers.get(terminal)?.unsubscribe()
        this.commandWatchers.delete(terminal)

        // Mark the boundary so the tracker captures this run (sendInput bypasses
        // xterm's onData), then run the command with a completion sentinel that
        // also reports the exit code.
        this.commandTracker.recordCommandAt(terminal.frontend)

        const { payload, marker } = this.commandTracker.buildWrappedCommand(command)
        const donePattern = new RegExp(`${marker}:(\\d+)`)

        let acc = ''
        const sub = terminal.output$.subscribe((chunk: string) => {
            acc += chunk
            const match = donePattern.exec(acc)
            if (!match) { return }

            sub.unsubscribe()
            this.commandWatchers.delete(terminal)

            // Command finished (exit code in match[1]); surface its output in
            // the panel and hand focus back to the chat input.
            const panelRef = this.panelRefs.get(terminal)
            panelRef?.instance.showLastCommandOutput()
            this.focusChatInput(terminal)
        })
        this.commandWatchers.set(terminal, sub)

        terminal.sendInput(payload)

        // Move focus to the terminal while the command runs so any interactive
        // I/O it triggers (e.g. a sudo password prompt) goes straight to the
        // shell. Focus returns to the chat input once the watcher above sees
        // the completion sentinel.
        this.focusTerminal(terminal)
    }

    private focusTerminal (terminal: BaseTerminalTabComponent<any>): void {
        // Lift any focus block left in place by focusChatInput before handing
        // keyboard focus back to the terminal, otherwise frontend.focus() would
        // be a no-op while the override is active.
        const xtermTextarea = terminal.element.nativeElement
            .querySelector('.xterm-helper-textarea') as HTMLElement | null
        const orig = this.origXtermFocus.get(terminal)
        if (orig && xtermTextarea) {
            xtermTextarea.focus = orig
            this.origXtermFocus.delete(terminal)
        }
        terminal.frontend?.focus()
    }
}
