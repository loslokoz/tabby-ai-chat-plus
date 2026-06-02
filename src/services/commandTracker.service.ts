import { Injectable } from '@angular/core'
import { Frontend } from 'tabby-terminal'

/** Minimal subset of xterm's IMarker we rely on. */
interface XtermMarker {
    line: number
    isDisposed: boolean
    dispose: () => void
}

/**
 * Tracks where each command starts in the terminal buffer by listening to
 * xterm's `onData`, which fires ONLY for user input (keyboard / paste) and
 * never for program output.
 *
 * The command's start line is remembered with an xterm Marker rather than a
 * raw line index: a Marker is maintained by xterm itself, so `marker.line`
 * stays correct even as the buffer scrolls and old lines are trimmed from the
 * scrollback (a raw index would silently drift and capture only the tail of a
 * long output).
 *
 * This makes "last command output" capture fully independent of the output's
 * content: no shell configuration, and it survives SSH (program output uses
 * \r\n that previously polluted Tabby's input$ stream) and restored sessions
 * (restoration replays output through the pty->screen path, not onData).
 */
@Injectable({ providedIn: 'root' })
export class CommandTrackerService {
    private tracked = new Set<Frontend>()
    private markers = new Map<Frontend, XtermMarker>()
    private disposables = new Map<Frontend, { dispose: () => void }>()

    attach (frontend: Frontend): void {
        const { xterm } = (frontend as any)
        if (!xterm || this.tracked.has(frontend)) { return }
        this.tracked.add(frontend)

        const disposable: { dispose: () => void } = xterm.onData((data: string) => {
            // Carriage return = the user submitted a command. Ignore anything else.
            if (!data.includes('\r')) { return }
            const buf = xterm.buffer.active
            // TUI apps (vim, less, mc...) run on the alternate buffer where Enter
            // is just navigation - never treat that as a command boundary.
            if (buf.type === 'alternate') { return }

            this.markers.get(frontend)?.dispose()
            // Marker at the current cursor row = the prompt + command line.
            const marker: XtermMarker | undefined = xterm.registerMarker(0)
            if (marker) {
                this.markers.set(frontend, marker)
            } else {
                this.markers.delete(frontend)
            }
        })
        this.disposables.set(frontend, disposable)
    }

    detach (frontend: Frontend): void {
        this.markers.get(frontend)?.dispose()
        this.markers.delete(frontend)
        this.disposables.get(frontend)?.dispose()
        this.disposables.delete(frontend)
        this.tracked.delete(frontend)
    }

    /**
     * Returns the last command (prompt + command line) together with its output.
     *   null → frontend not tracked (caller may fall back to a heuristic)
     *   ''   → tracked but no command submitted yet (fresh / restored tab)
     *   text → the command line and everything it printed
     */
    getLastCommandOutput (frontend: Frontend): string | null {
        if (!this.tracked.has(frontend)) { return null }
        const marker = this.markers.get(frontend)
        if (!marker) { return '' }

        const { xterm } = (frontend as any)
        if (!xterm) { return '' }
        const buffer = xterm.buffer.active

        // Marker.line is kept up to date by xterm; -1 / disposed means the
        // command line was trimmed out of scrollback (output longer than the
        // buffer) - capture whatever output is still available.
        let start = marker.isDisposed || marker.line < 0 ? 0 : marker.line

        // Walk back over wrapped rows so a long command line is captured whole.
        while (start > 0 && buffer.getLine(start)?.isWrapped) {
            start--
        }

        // Current cursor sits on the fresh prompt awaiting input - exclude it.
        const end = buffer.baseY + buffer.cursorY
        if (start >= end) { return '' }

        const lines: string[] = []
        for (let i = start; i < end; i++) {
            const line = buffer.getLine(i)
            if (line) { lines.push(line.translateToString(true)) }
        }

        while (lines.length > 0 && !lines[lines.length - 1].trim()) {
            lines.pop()
        }

        return lines.join('\n')
    }
}
