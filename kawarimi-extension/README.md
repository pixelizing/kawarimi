# Kawarimi

Kawarimi is the VS Code companion for a browser-to-editor workflow that applies AI-generated code through a simple Find → Replace flow—without API keys or manual copy-paste.

> **Required:** Install the Kawarimi Chrome extension from [GitHub Releases](https://github.com/pixelizing/kawarimi/releases/latest).

## Usage

1. Open the target file in VS Code and keep it active.
2. Wait until the AI finishes generating the code.
3. Click **Find** on the original code block.
4. Click **Replace** on the new code block.

Kawarimi updates and automatically saves the active VS Code file.

- **All** — replaces every match
- **1st** — replaces only the first match
- **Done** — marks the latest successful replacement
- **Ctrl+Z / Cmd+Z** — undoes the change

## Requirements

- Kawarimi Chrome extension installed and enabled
- VS Code running
- Target file open and active
- Same port configured in Chrome and VS Code

Default port: `10240`

## Settings

`kawarimi.serverPort`

Default: `10240`

## Links

- [GitHub](https://github.com/pixelizing/kawarimi)
- [Releases](https://github.com/pixelizing/kawarimi/releases)
- [Issues](https://github.com/pixelizing/kawarimi/issues)

## License

MIT