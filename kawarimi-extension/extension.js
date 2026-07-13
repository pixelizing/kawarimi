const vscode = require('vscode');
const http = require('http');

let server = null;
const CLIENT_HEADER = 'x-kawarimi-client';
const CLIENT_VALUE = 'chrome-extension';

// Ignore invisible characters that can appear in copied code.
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF]/g;

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Preserve original document offsets while ignoring invisible characters.
function buildCleanMap(text) {
    let clean = '';
    const map = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\u200B' || ch === '\u200C' || ch === '\u200D' || ch === '\uFEFF') continue;
        clean += ch;
        map.push(i);
    }
    return { clean, map };
}

function activate(context) {
    console.log('Kawarimi is now active.');

            server = http.createServer((req, res) => {
        const origin = req.headers.origin || '';
        const isExtensionOrigin = origin.startsWith('chrome-extension://');

        if (isExtensionOrigin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        }

        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, X-Kawarimi-Client'
        );

        if (req.headers['access-control-request-private-network'] === 'true') {
            res.setHeader('Access-Control-Allow-Private-Network', 'true');
        }

        if (req.method === 'OPTIONS') {
            if (!isExtensionOrigin) {
                res.writeHead(403, {
                    'Content-Type': 'application/json'
                });

                return res.end(JSON.stringify({
                    error: 'Forbidden origin.'
                }));
            }

            res.writeHead(204);
            return res.end();
        }

        if (req.headers[CLIENT_HEADER] !== CLIENT_VALUE) {
            res.writeHead(403, {
                'Content-Type': 'application/json'
            });

            return res.end(JSON.stringify({
                error: 'Unauthorized client.'
            }));
        }

        if (req.method === 'POST' && req.url === '/patch') {
            const contentType = req.headers['content-type'] || '';

            if (!contentType.startsWith('application/json')) {
                res.writeHead(415, {
                    'Content-Type': 'application/json'
                });

                return res.end(JSON.stringify({
                    error: 'JSON request required.'
                }));
            }
            let body = '';
            req.on('data', chunk => body += chunk.toString());

            req.on('end', async () => {
                try {
                    const payload = JSON.parse(body);
                    const findTextRaw = payload.find.trim();
                    const findText = findTextRaw.replace(ZERO_WIDTH_RE, '');
                    const replaceText = (payload.replace || '').replace(ZERO_WIDTH_RE, '');
                                        // Replace all matches unless the client requests only the first.
                    const replaceAll = payload.replaceAll !== false;

                    let targetEditor = vscode.window.activeTextEditor;

                    if (!targetEditor) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: 'No active file found in VS Code.' }));
                    }

                    const document = targetEditor.document;
                    const documentText = document.getText();

                    const { clean: cleanDocText, map } = buildCleanMap(documentText);

                    const escapedFind = escapeRegExp(findText);
                                        // Allow harmless whitespace differences between copied and local code.
                    const flexibleRegexStr = escapedFind.replace(/\s+/g, '\\s+');
                    const regex = new RegExp(flexibleRegexStr, 'g');

                    const matches = [];
                    let m;
                    while ((m = regex.exec(cleanDocText)) !== null) {
                        matches.push(m);
                        if (m[0].length === 0) regex.lastIndex++;
                    }

                    if (matches.length === 0) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                                                vscode.window.setStatusBarMessage('$(error) Kawarimi: Target code not found', 4000);
                        return res.end(JSON.stringify({ error: 'Match not found.' }));
                    }

                    const toReplace = replaceAll ? matches : [matches[0]];

                    const edit = new vscode.WorkspaceEdit();
                    for (const match of toReplace) {
                        const origStart = map[match.index];
                        const lastCleanIdx = match.index + match[0].length - 1;
                        const origEnd = map[lastCleanIdx] + 1;

                        const startPos = document.positionAt(origStart);
                        const endPos = document.positionAt(origEnd);
                        edit.replace(document.uri, new vscode.Range(startPos, endPos), replaceText);
                    }

                    const success = await vscode.workspace.applyEdit(edit);
                    if (success) {
                        await document.save();
                        const replacedCount = toReplace.length;
                        const foundCount = matches.length;
                        vscode.window.setStatusBarMessage(
                            `$(check) Kawarimi: ${replacedCount} replaced (found ${foundCount})`,
                            3000
                        );
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, count: replacedCount, found: foundCount }));
                    } else {
                        throw new Error("VS Code prevented the edit.");
                    }

                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found.' }));
        }
    });

    const config = vscode.workspace.getConfiguration('kawarimi');
    const port = config.get('serverPort') || 10240;

            server.listen(port, '127.0.0.1', () => {
        console.log(`Kawarimi Server Listening (127.0.0.1:${port})...`);
    });
}

function deactivate() {
    if (server) server.close();
}

module.exports = { activate, deactivate }
