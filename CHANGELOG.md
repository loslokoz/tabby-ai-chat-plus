# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-06-07

A major rework focused on a **fully keyboard-driven workflow**, **multiple
providers at once**, and **reasoning support**. The plugin is now named
**AI Assistant Plus** and published as the unscoped package `tabby-ai-chat-plus`
so it appears in Tabby's plugin list.

### Keyboard-driven workflow
- Configurable context shortcuts — switch the attached context with `Alt`/`⌥` + `` ` ``/`1`/`2`/`3`/`4` (none / last command / visible / selection / last N). Editable in *Settings → Hotkeys*.
- Focus toggle (`Alt+Tab` / `⌥+Tab`) between terminal and chat; jumping into the chat auto-attaches the last command output.
- Command navigation — focus lands on the first suggested command; move with arrows, run with Enter, return to input with Escape.
- Run-and-refresh — running a command from the chat moves focus to the terminal while it runs (so interactive prompts like a `sudo` password reach the shell), then returns to the chat with that command's output attached.
- On open, the panel attaches the last command output by default.

### Multiple providers at once
- Enable Custom LLM (LiteLLM / OpenAI-compatible) and OpenRouter at the same time, and switch between them from the model picker in the chat (Custom LLM listed first).
- Each provider's settings section appears only when that provider is enabled.
- The configured model is always selectable, even if the endpoint's `/models` list is empty.

### Reasoning ("Thinking")
- Models that emit a reasoning trace (inline `<think>…</think>` or `reasoning_content`) show a collapsible, animated "Thinking…" indicator.
- Reasoning is hidden by default and never contributes commands to the executable list.
- Qwen3.5: option to disable reasoning globally on Custom LLM, plus a per-conversation Reasoning toggle above the input to re-enable it.

### Other
- Response Language setting — choose the language the assistant replies in (added to the system prompt).

### Fixed
- Accented characters (e.g. Polish diacritics) now type correctly in the chat input.
- Context shortcuts fire reliably on every press, not just the first.

### Breaking changes
- Provider configuration changed from a single selector to per-provider enable toggles. After updating, enable the provider(s) you use in *Settings → AI Assistant Plus*.
- The package is now published as `tabby-ai-chat-plus` (unscoped).

## [1.0.0]

### Added
- Initial release of tabby-ai-assistant as a standalone plugin
- AI chat panel integrated into terminal tabs
- Support for OpenRouter API with model selection
- Support for LiteLLM / custom OpenAI-compatible endpoints
- Terminal context extraction (configurable line count)
- Markdown rendering in chat responses with syntax highlighting
- Code block copy functionality
- Command execution (insert/execute/ask modes)
- Configurable panel width (20-60%)
- Auto-attach terminal context option
- Customizable system prompt
- Temperature and max tokens settings
- Keyboard shortcuts for panel toggle and focus
