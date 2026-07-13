# Kawarimi

Kawarimi replaces AI-generated code directly in the active VS Code file.

## Installation

### Chrome

1. Download `kawarimi-chrome-1.2.0.zip`
2. Extract the ZIP
3. Open `chrome://extensions`
4. Enable **Developer mode**
5. Click **Load unpacked**
6. Select the extracted `kawarimi-chrome` folder

### VS Code

1. Download `kawarimi-1.2.0.vsix`
2. Open the Extensions view in VS Code
3. Open the `...` menu
4. Select **Install from VSIX...**
5. Select the downloaded VSIX file
6. Reload VS Code if requested

## Usage

1. Open the target file in VS Code and keep it active
2. Wait until the AI completely finishes generating the code
3. Click **Find** on the original code block
4. Click **Replace** on the new code block

Kawarimi updates and automatically saves the active VS Code file.

- **All** — replaces every match
- **1st** — replaces only the first match
- **Done** — marks the latest successful replacement
- **Ctrl+Z / Cmd+Z** — undoes the change

## Notes

- VS Code must be running
- Both Kawarimi extensions must be installed and enabled
- Chrome and VS Code must use the same port
- Default port: `10240`
- Custom-site support is experimental and may not work on every website

## Example AI Prompt

Optional prompt for Kawarimi-friendly edits:

> Use my current code as the source of truth. For every edit, provide the exact file path, an exact and unique FIND block copied from my code, and a complete REPLACE WITH block. Preserve indentation and line breaks. Do not use ellipses, placeholders, omitted sections, line-number-only instructions, vague insertion directions, or guessed code. If the exact current code is unavailable, ask me to provide it. When I request a complete file, return the complete untruncated file.

## License

MIT