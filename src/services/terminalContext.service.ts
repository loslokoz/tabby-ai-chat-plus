import { Injectable } from '@angular/core'
import { Frontend } from 'tabby-terminal'
import { CommandTrackerService } from './commandTracker.service'

export interface TerminalContext {
    content: string
    cursorPosition?: { row: number; col: number }
    isAlternateScreen: boolean
    rows: number
    cols: number
}

/**
 * Service to extract context from terminal buffer for AI assistance.
 * Works with XTermFrontend to access the underlying xterm.js buffer.
 */
@Injectable({ providedIn: 'root' })
export class TerminalContextService {
    constructor (private commandTracker: CommandTrackerService) {}

    /**
     * Get the last N lines from the terminal buffer
     */
    getLastNLines (frontend: Frontend, n: number): TerminalContext | null {
        const xterm = this.getXterm(frontend)
        if (!xterm) {
            return null
        }

        const buffer = xterm.buffer.active
        const lines: string[] = []

        // Calculate starting row
        const totalRows = buffer.baseY + buffer.cursorY + 1
        const startRow = Math.max(0, totalRows - n)

        for (let i = startRow; i < totalRows; i++) {
            const line = buffer.getLine(i)
            if (line) {
                lines.push(line.translateToString(true))
            }
        }

        return {
            content: lines.join('\n'),
            cursorPosition: {
                row: buffer.cursorY,
                col: buffer.cursorX,
            },
            isAlternateScreen: buffer.type === 'alternate',
            rows: xterm.rows,
            cols: xterm.cols,
        }
    }

    /**
     * Get the visible content currently displayed in the terminal viewport
     */
    getVisibleContent (frontend: Frontend): TerminalContext | null {
        const xterm = this.getXterm(frontend)
        if (!xterm) {
            return null
        }

        const buffer = xterm.buffer.active
        const lines: string[] = []

        // Get visible rows based on viewport
        const { viewportY } = buffer
        for (let i = 0; i < xterm.rows; i++) {
            const line = buffer.getLine(viewportY + i)
            if (line) {
                lines.push(line.translateToString(true))
            }
        }

        return {
            content: lines.join('\n'),
            cursorPosition: {
                row: buffer.cursorY,
                col: buffer.cursorX,
            },
            isAlternateScreen: buffer.type === 'alternate',
            rows: xterm.rows,
            cols: xterm.cols,
        }
    }

    /**
     * Get the current selection from the terminal, if any
     */
    getSelection (frontend: Frontend): string | null {
        const xterm = this.getXterm(frontend)
        if (!xterm) {
            return null
        }

        const selection = xterm.getSelection()
        return selection && selection.trim().length > 0 ? selection : null
    }

    /**
     * Get the last command and its output.
     *
     * Uses CommandTrackerService, which marks command boundaries from keyboard
     * input - fully independent of the output's content. If the frontend isn't
     * tracked yet (panel opened before tracking started), it starts tracking now
     * and returns an empty context rather than guessing from prompt patterns.
     */
    getLastCommandContext (frontend: Frontend): TerminalContext | null {
        let tracked = this.commandTracker.getLastCommandOutput(frontend)
        if (tracked === null) {
            // Backstop: ensure this frontend is tracked from now on.
            this.commandTracker.attach(frontend)
            tracked = this.commandTracker.getLastCommandOutput(frontend) ?? ''
        }

        const xterm = this.getXterm(frontend)
        const buffer = xterm?.buffer.active
        return {
            content: tracked,
            cursorPosition: buffer ? { row: buffer.cursorY, col: buffer.cursorX } : undefined,
            isAlternateScreen: buffer?.type === 'alternate',
            rows: xterm?.rows ?? 0,
            cols: xterm?.cols ?? 0,
        }
    }

    /**
     * Get the entire scrollback buffer (use with caution - can be large)
     */
    getFullBuffer (frontend: Frontend, maxLines = 1000): TerminalContext | null {
        const xterm = this.getXterm(frontend)
        if (!xterm) {
            return null
        }

        const buffer = xterm.buffer.active
        const lines: string[] = []

        const totalRows = buffer.baseY + buffer.cursorY + 1
        const startRow = Math.max(0, totalRows - maxLines)

        for (let i = startRow; i < totalRows; i++) {
            const line = buffer.getLine(i)
            if (line) {
                lines.push(line.translateToString(true))
            }
        }

        return {
            content: lines.join('\n'),
            cursorPosition: {
                row: buffer.cursorY,
                col: buffer.cursorX,
            },
            isAlternateScreen: buffer.type === 'alternate',
            rows: xterm.rows,
            cols: xterm.cols,
        }
    }

    /**
     * Helper to extract the xterm instance from a Frontend.
     * Returns null if the frontend is not XTermFrontend or not ready.
     */
    private getXterm (frontend: Frontend): any | null {
        // Access the xterm instance - XTermFrontend exposes it as a public property
        // Cast to any because Frontend interface doesn't expose xterm directly
        const xtermFrontend = frontend as any
        if (xtermFrontend?.xterm) {
            return xtermFrontend.xterm
        }

        return null
    }
}
