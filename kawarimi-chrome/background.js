const CUSTOM_SITE_KEY = 'kawarimiCustomSites';
const DISABLED_BUILT_IN_KEY = 'kawarimiDisabledBuiltInOrigins';
const SCRIPT_PREFIX = 'kawarimi-custom-';

function normalizeOrigin(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return url.origin;
    } catch {
        return null;
    }
}

function originToPattern(origin) {
    const normalized = normalizeOrigin(origin);
    return normalized ? `${normalized}/*` : null;
}

function scriptIdForOrigin(origin) {
    let hash = 2166136261;
    for (const char of origin) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return `${SCRIPT_PREFIX}${(hash >>> 0).toString(36)}`;
}

async function getCustomSites() {
    const data = await chrome.storage.sync.get([CUSTOM_SITE_KEY]);
    const sites = Array.isArray(data[CUSTOM_SITE_KEY]) ? data[CUSTOM_SITE_KEY] : [];
    return [...new Set(sites.map(normalizeOrigin).filter(Boolean))];
}

async function setCustomSites(sites) {
    const normalized = [...new Set(sites.map(normalizeOrigin).filter(Boolean))];
    await chrome.storage.sync.set({ [CUSTOM_SITE_KEY]: normalized });
    return normalized;
}

async function getDisabledBuiltInOrigins() {
    const data = await chrome.storage.sync.get([DISABLED_BUILT_IN_KEY]);
    const origins = Array.isArray(data[DISABLED_BUILT_IN_KEY]) ? data[DISABLED_BUILT_IN_KEY] : [];
    return [...new Set(origins.map(normalizeOrigin).filter(Boolean))];
}

async function setDisabledBuiltInOrigins(origins) {
    const normalized = [...new Set(origins.map(normalizeOrigin).filter(Boolean))];
    await chrome.storage.sync.set({ [DISABLED_BUILT_IN_KEY]: normalized });
    return normalized;
}

async function sendPatchToVsCode(port, payload) {
    const parsedPort = Number.parseInt(port, 10);
    const safePort = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
        ? parsedPort
        : 10240;

    const find = typeof payload?.find === 'string' ? payload.find : '';
    const replace = typeof payload?.replace === 'string' ? payload.replace : '';

    if (!find.trim()) {
        throw new Error('The target code is empty.');
    }

    const response = await fetch(`http://127.0.0.1:${safePort}/patch`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Kawarimi-Client': 'chrome-extension'
        },
        body: JSON.stringify({
            find,
            replace,
            replaceAll: payload?.replaceAll !== false,
            matchMode: payload?.matchMode === 'exact' ? 'exact' : 'flexible'
        })
    });

    let data = {};

    try {
        data = await response.json();
    } catch {
    }

    return {
        status: response.status,
        data
    };
}

async function setBuiltInEnabled(origin, enabled, tabId) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) throw new Error('Unsupported site URL.');

    const disabledOrigins = await getDisabledBuiltInOrigins();
    const nextDisabled = enabled
        ? disabledOrigins.filter((item) => item !== normalized)
        : [...disabledOrigins.filter((item) => item !== normalized), normalized];

    await setDisabledBuiltInOrigins(nextDisabled);

    if (!Number.isInteger(tabId)) return;

    if (!enabled) {
        try {
            await chrome.tabs.sendMessage(tabId, { type: 'kawarimi:teardown' });
        } catch {
            // No active Kawarimi content script in the tab.
        }
        return;
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
        });
    } catch (error) {
        const rollback = await getDisabledBuiltInOrigins();
        if (!rollback.includes(normalized)) {
            rollback.push(normalized);
            await setDisabledBuiltInOrigins(rollback);
        }
        throw new Error(error?.message || 'Could not enable Kawarimi in the current tab.');
    }
}

async function hasOriginPermission(origin) {
    const pattern = originToPattern(origin);
    if (!pattern) return false;
    return chrome.permissions.contains({ origins: [pattern] });
}

async function unregisterOrigin(origin) {
    const id = scriptIdForOrigin(origin);
    try {
        await chrome.scripting.unregisterContentScripts({ ids: [id] });
    } catch {
        // The script may not be registered yet.
    }
}

async function registerOrigin(origin) {
    const pattern = originToPattern(origin);
    if (!pattern) throw new Error('Unsupported site URL.');
    if (!(await hasOriginPermission(origin))) throw new Error('Site permission was not granted.');

    const id = scriptIdForOrigin(origin);
    await unregisterOrigin(origin);
    await chrome.scripting.registerContentScripts([{
        id,
        matches: [pattern],
        js: ['content.js'],
        runAt: 'document_end',
        persistAcrossSessions: true
    }]);
}

async function enableOrigin(origin, tabId) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) throw new Error('Unsupported site URL.');

    await registerOrigin(normalized);

    const sites = await getCustomSites();
    if (!sites.includes(normalized)) {
        sites.push(normalized);
        await setCustomSites(sites);
    }

    if (Number.isInteger(tabId)) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content.js']
            });
        } catch (error) {
            // Registration still succeeds for future page loads.
            console.warn('Kawarimi could not inject into the current tab:', error);
        }
    }
}

async function disableOrigin(origin, tabId) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return;

    if (Number.isInteger(tabId)) {
        try {
            await chrome.tabs.sendMessage(tabId, { type: 'kawarimi:teardown' });
        } catch {
            // No active Kawarimi content script in the tab.
        }
    }

    await unregisterOrigin(normalized);

    const sites = await getCustomSites();
    await setCustomSites(sites.filter((site) => site !== normalized));

    const pattern = originToPattern(normalized);
    if (pattern) {
        try {
            await chrome.permissions.remove({ origins: [pattern] });
        } catch {
            // Permission may already have been removed by Chrome settings.
        }
    }
}

async function syncRegisteredSites() {
    const sites = await getCustomSites();
    const allowedSites = [];

    for (const origin of sites) {
        if (await hasOriginPermission(origin)) allowedSites.push(origin);
    }

    if (allowedSites.length !== sites.length) {
        await setCustomSites(allowedSites);
    }

    const registrations = await chrome.scripting.getRegisteredContentScripts();
    const customRegistrations = registrations.filter((item) => item.id.startsWith(SCRIPT_PREFIX));
    const desiredIds = new Set(allowedSites.map(scriptIdForOrigin));
    const staleIds = customRegistrations
        .filter((item) => !desiredIds.has(item.id))
        .map((item) => item.id);

    if (staleIds.length) {
        await chrome.scripting.unregisterContentScripts({ ids: staleIds });
    }

    for (const origin of allowedSites) {
        const id = scriptIdForOrigin(origin);
        const existing = customRegistrations.find((item) => item.id === id);
        const pattern = originToPattern(origin);
        const isCurrent = existing?.matches?.length === 1 && existing.matches[0] === pattern;

        if (!isCurrent) await registerOrigin(origin);
    }
}

chrome.runtime.onInstalled.addListener(() => {
    syncRegisteredSites().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
    syncRegisteredSites().catch(console.error);
});

chrome.permissions.onRemoved.addListener(() => {
    syncRegisteredSites().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'kawarimi:patch') {
        sendPatchToVsCode(message.port, message.payload)
            .then((result) => {
                sendResponse({
                    ok: true,
                    ...result
                });
            })
            .catch((error) => {
                sendResponse({
                    ok: false,
                    error: error?.message || 'VS Code is not running or the port is incorrect.'
                });
            });

        return true;
    }

    if (message?.type === 'kawarimi:enable-site') {
        enableOrigin(message.origin, message.tabId)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (message?.type === 'kawarimi:disable-site') {
        disableOrigin(message.origin, message.tabId)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (message?.type === 'kawarimi:enable-built-in') {
        setBuiltInEnabled(message.origin, true, message.tabId)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (message?.type === 'kawarimi:disable-built-in') {
        setBuiltInEnabled(message.origin, false, message.tabId)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (message?.type === 'kawarimi:sync-sites') {
        syncRegisteredSites()
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    return false;
});
