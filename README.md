# tabby-ai-chat-plus

**AI Assistant Plus** — an AI chat plugin for [Tabby](https://tabby.sh) that lives inside your terminal tabs and is built to be driven entirely from the keyboard.

Ask questions, attach terminal context, and run AI-suggested commands without ever leaving the keyboard.

## Features

- **AI Chat Panel** — integrated, resizable chat side panel in terminal tabs
- **Keyboard-first workflow** — toggle the panel, jump focus between terminal and chat, switch context, navigate and run suggested commands — all with shortcuts (see [Keyboard-driven workflow](#keyboard-driven-workflow))
- **Terminal Context** — attach the last command output, visible screen, selection or last N lines to your message; on open the panel auto-attaches the last command output
- **Multiple providers at once** — enable **Custom LLM** (LiteLLM / OpenAI-compatible) and/or **OpenRouter**, and switch between them from the model picker in the chat
- **Reasoning support** — models that "think" show a collapsible *Thinking…* indicator; the reasoning trace is kept out of the executable command list
- **Response language** — pick the language the assistant replies in
- **Quick Access Models** — pin favourite models for fast switching
- **Code Actions** — copy code blocks or run commands directly in the terminal
- **Customizable** — panel width, font size, temperature, token limits, and more

## Installation

### Manual Installation

```bash
# Install to Tabby's plugin directory
cd ~/.config/tabby/plugins  # Linux/macOS
cd %APPDATA%\tabby\plugins   # Windows
npm install tabby-ai-chat-plus
```

## Configuration

After installation, go to **Settings** > **AI Assistant Plus** to configure.

### Providers

Both providers can be enabled at the same time. When both are on, you switch between them from the model picker in the chat panel (**Custom LLM** is listed first).

**Custom LLM** (LiteLLM / OpenAI-compatible, e.g. self-hosted):
1. Enable the **Custom LLM** toggle
2. Enter your endpoint URL (e.g. `http://localhost:4000/v1`)
3. Optionally add an API key
4. Enter or select your model name (the configured model is always selectable in the chat, even if the endpoint's `/models` list is empty)

**OpenRouter** (cloud):
1. Enable the **OpenRouter** toggle
2. Get an API key from [openrouter.ai/keys](https://openrouter.ai/keys) and enter it
3. Choose a model from the list

Disabling a provider hides its settings section.

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Custom LLM / OpenRouter | Enable one or both providers | OpenRouter on |
| Response Language | Language the assistant replies in (added to the system prompt) | English |
| Max Tokens | Maximum response length | 2048 |
| Temperature | Response randomness (0–1) | 0.7 |
| Context Lines | Terminal lines captured for "last N lines" | 50 |
| Command Execution | `insert` / `execute` / `ask` | insert |
| Chat Font Size | Message font size in px | 14 |
| Panel Width | Percentage of terminal width | 40% |
| Quick Access Models | Pinned models for fast switching (under OpenRouter settings) | — |
| Use Quick Access Only | Restrict model picker to pinned models | off |
| Disable reasoning for Qwen3.5 | Send `enable_thinking=false` for Qwen3.5 on Custom LLM | off |
| System Prompt | Base instructions for the assistant | (preset) |

## Keyboard-driven workflow

The plugin is designed so a whole loop — ask → read → run → read output → ask again — can be done without the mouse.

### Shortcuts

All shortcuts are configurable in **Settings** > **Hotkeys**.

| Action | Default (Linux/Windows) | Default (macOS) |
|--------|-------------------------|-----------------|
| Toggle AI panel | `Ctrl+Shift+A` | `Cmd+Shift+A` |
| Toggle focus terminal ↔ chat | `Alt+Tab` | `⌥+Tab` |
| Context: none | `Alt+\` ` | `⌥+§` |
| Context: last command output | `Alt+1` | `⌥+1` |
| Context: visible terminal | `Alt+2` | `⌥+2` |
| Context: current selection | `Alt+3` | `⌥+3` |
| Context: last N lines | `Alt+4` | `⌥+4` |

### Focus toggle (terminal ↔ chat)

`Alt+Tab` / `⌥+Tab` moves focus between the terminal and the chat input:
- From the terminal → jumps into the chat and attaches the **last command output** as context.
- From the chat → jumps back to the terminal.

### Switching context from the keyboard

While the chat input is focused, use the context shortcuts above to change what gets attached to your next message. The attachment indicator and preview update immediately.

### Navigating and running suggested commands

When the assistant replies with commands, focus automatically lands on the first one:
- **Arrow keys** — move between the suggested commands
- **Enter** — run the selected command
- **Escape** — return to the chat input

### Run-and-refresh flow

Running a command from the chat:
1. Sends it to the terminal and moves focus there while it runs, so any interactive prompt (e.g. a `sudo` password) goes straight to the shell.
2. When the command finishes, focus returns to the chat input and the context is refreshed to that command's output — ready for a follow-up question.

The exact behaviour of "running" depends on the **Command Execution** setting: `insert` (paste only), `execute` (run immediately), or `ask` (confirm first).

### Composing a message

In the chat input:
- **Enter** — send
- **Shift+Enter** — new line
- **Escape** — stop generation if streaming, otherwise close the panel

## Reasoning ("Thinking")

For models that emit a reasoning trace (inline `<think>…</think>` or a separate `reasoning_content` field), the panel shows an animated **Thinking…** indicator. The trace stays hidden by default and can be expanded; once the answer starts it collapses on its own. Commands found inside the reasoning are never added to the executable command list.

For Qwen3.5 on a Custom LLM endpoint you can turn reasoning off globally (*Disable reasoning for Qwen3.5*). When it is off, a small **Reasoning** toggle appears above the chat input so you can re-enable thinking for the current conversation.

## Panel width

Drag the left edge of the panel to resize it. The new width is saved automatically.

## Code blocks

AI responses with code blocks include:
- **Copy** button — copy code to clipboard
- **Execute** button — run the command in the terminal (see *Command Execution* / run-and-refresh above)

## Development

```bash
# Clone the repository
git clone https://github.com/loslokoz/tabby-ai-chat-plus.git
cd tabby-ai-chat-plus

# Install dependencies
npm install

# Build
npm run build

# Watch mode for development
npm run watch

# Lint
npm run lint
```

### Testing Locally

Set the `TABBY_PLUGINS` environment variable to load the plugin:

```bash
# Linux/macOS
TABBY_PLUGINS=/path/to/tabby-ai-chat-plus tabby

# Windows (PowerShell)
$env:TABBY_PLUGINS="C:\path\to\tabby-ai-chat-plus"; tabby
```

## License

MIT - See [LICENSE](LICENSE) for details.

## Authors
* **Author & Maintainer:** Rafał Basiewicz (rafal@basiewi.cz)
* **Original Code Author:** Philipp Bontemps (philipp@vrtxlabs.com)