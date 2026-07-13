# Kawarimi

Kawarimi applies AI-generated code replacements directly to the active VS Code file.

## Requirements

- Kawarimi Chrome extension installed and enabled
- VS Code running
- Target file open and active
- Same port configured in Chrome and VS Code

Default port: `10240`

## Usage

1. Wait until the AI finishes generating the code.
2. Click **Find** on the original code block.
3. Click **Replace** on the new code block.

Kawarimi updates and automatically saves the active VS Code file.

- **All** — replaces every match
- **1st** — replaces only the first match
- **Done** — marks the latest successful replacement
- **Ctrl+Z / Cmd+Z** — undoes the change

## Settings

`kawarimi.serverPort`

Default: `10240`

## License

MIT