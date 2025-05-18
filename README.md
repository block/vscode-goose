# Goose - VS Code Extension

[Goose](https://block.github.io/goose/) is an open-source, on-device AI agent that runs locally, works with any LLM provider you configure, and can autonomously tackle full-stack engineering tasks from debugging to deployment. By embedding Goose directly inside VS Code, this extension lets you ask questions, refactor code, generate tests, or spin up entire features without ever leaving your editor. Keep your code in your editor, choose the model that suits you, and let Goose handle the heavy lifting so you can stay in flow

![Screenshot](./resources/screenshot.png)

## ⚠️ Experimental Features Notice ⚠️

Please be aware that this extension is under active development. Some features, especially those related to how information (like code context) is processed and sent to the AI, are experimental and may undergo significant changes. We appreciate your understanding and feedback as we work to stabilize and improve these functionalities.

## Current Features

* Interactive chat UI
* Access to Goose's AI capabilities directly within VS Code
* Support for coding assistance, explanations, and more
* Unified session switching
* Code referencing with visual chips in the chat UI
* Quick actions for common coding tasks
* Clipboard tools to copy code snippets/responses for easy sharing
* Keyboard shortcuts for improved productivity (cmd+opt+g / ctrl+alt+g by default for sending code to Goose; configurable)

## Coming Soon

* Smart Auto-fix loop (Let Goose automatically fix it's own mistakes based on VS Code diagnostics)
* Code action suggestions for diagnostics and terminal output
* Diff views for code changes

## Requirements

> ⚠️ **VS Code 1.95.0 or higher is required** for this extension to function properly.

> ⚠️ **Goose Desktop must be installed** before using this extension.
👉 Install Goose Desktop from [here](https://block.github.io/goose/)

## Installation

There are two ways to install the Goose VS Code Extension:

### Method 1: Install from VS Code Marketplace (recommended)
[Install from Market Place](https://marketplace.visualstudio.com/items?itemName=block.vscode-goose)

### Method 2: Install from GitHub Releases

1. Go to the [GitHub Releases page](https://github.com/block/vscode-goose/releases)
2. Find the latest release with the tag `vscode-v*`
3. Download the `.vsix` file
4. In VS Code, go to the Extensions view (Ctrl+Shift+X)
5. Click on the "..." menu at the top of the Extensions view
6. Select "Install from VSIX..."
7. Locate and select the downloaded `.vsix` file
8. Restart VS Code if prompted

### Chat Interface

The Goose chat interface appears in the sidebar activity bar. Click the Goose icon to open the chat panel.

### Code References

You can reference code from your editor in your conversations with Goose:

1. Select code in your editor (or don't select anything to use the entire file)
2. Right-click and choose "Ask Goose about this code" or use the keyboard shortcut <kbd>Ctrl+Alt+G</kbd> (<kbd>Cmd+Option+G</kbd> on macOS)
3. The chat input will be automatically focused, allowing you to immediately start typing your question

The behavior varies based on how much code is selected:

* **No selection:** The entire active file is sent as a reference chip
* **Small selections (< 100 lines):** The selected code is automatically included inline with your message
* **Large selections (≥ 100 lines):** The code is added as a reference chip above the input box

This adaptive approach provides the best experience for different code sizes.

### Quick Actions

The extension currently provides the following quick action command that can be accessed by right-clicking on selected code:

* **Ask Goose about this code** - General question about the selected code

### Keyboard Shortcuts

| Command                       | Shortcut (Windows/Linux) | Shortcut (macOS)        |
| ----------------------------- | ------------------------ | ----------------------- |
| Ask Goose about selected code | <kbd>Ctrl+Alt+G</kbd>    | <kbd>Cmd+Option+G</kbd> |

## Extension Settings

This extension contributes the following settings:

* `goose.enable`: enable/disable this extension

----

## Support

For support, bug reports, or feature suggestions, please use [GitHub Issues](https://github.com/block/vscode-goose/issues).


## Architecture

Detailed information about the extension's architecture can be found in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Development

Information for developers contributing to this extension can be found in [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## License

This extension is licensed under Apache-2.0.
See the [LICENSE](./LICENSE) file for details.
