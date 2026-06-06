import { Injectable } from '@angular/core'
import { HotkeyDescription, HotkeyProvider, TranslateService } from 'tabby-core'

@Injectable()
export class AIAssistantHotkeyProvider extends HotkeyProvider {
    constructor (
        private translate: TranslateService,
    ) { super() }

    async provide (): Promise<HotkeyDescription[]> {
        return [
            {
                id: 'toggle-ai-panel',
                name: this.translate.instant('Toggle AI Assistant Plus Panel'),
            },
            {
                id: 'focus-ai-input',
                name: this.translate.instant('Focus AI Assistant Plus input'),
            },
            {
                id: 'ai-context-none',
                name: this.translate.instant('AI context: none'),
            },
            {
                id: 'ai-context-last-command',
                name: this.translate.instant('AI context: last command output'),
            },
            {
                id: 'ai-context-visible',
                name: this.translate.instant('AI context: visible terminal'),
            },
            {
                id: 'ai-context-selection',
                name: this.translate.instant('AI context: selection'),
            },
            {
                id: 'ai-context-last-n',
                name: this.translate.instant('AI context: last N lines'),
            },
        ]
    }
}
