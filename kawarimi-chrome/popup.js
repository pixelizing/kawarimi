const CUSTOM_SITE_KEY = 'kawarimiCustomSites';
const DISABLED_BUILT_IN_KEY = 'kawarimiDisabledBuiltInOrigins';
const THEME_KEY = 'kawarimiTheme';

const BUILT_IN_SITES = [
    { name: 'ChatGPT', match: (host) => host === 'chatgpt.com' },
    { name: 'Claude', match: (host) => host === 'claude.ai' },
    { name: 'Gemini', match: (host) => host === 'gemini.google.com' },
    { name: 'Perplexity', match: (host) => host === 'perplexity.ai' || host === 'www.perplexity.ai' },
    { name: 'DeepSeek', match: (host) => host === 'chat.deepseek.com' },
    { name: 'Grok', match: (host) => host === 'grok.com' || host.endsWith('.grok.com') },
    { name: 'X', match: (host) => host === 'x.com' || host.endsWith('.x.com') }
];

const elements = {
    version: document.getElementById('versionLabel'),
    siteIcon: document.getElementById('siteIcon'),
    siteName: document.getElementById('siteName'),
    siteHost: document.getElementById('siteHost'),
    siteSwitch: document.getElementById('siteSwitch'),
    supportBadge: document.getElementById('supportBadge'),
    supportCopy: document.getElementById('supportCopy'),
    infoTitle: document.getElementById('infoTitle'),
    infoCopy: document.getElementById('infoCopy'),
    statusToast: document.getElementById('statusToast'),
    statusText: document.getElementById('statusText'),
    modal: document.getElementById('permissionModal'),
    cancelPermission: document.getElementById('cancelPermission'),
        continuePermission: document.getElementById('continuePermission'),
    settingsButton: document.getElementById('settingsButton'),
    themeButtons: [...document.querySelectorAll('[data-theme-value]')]
};

let currentTab = null;
let currentUrl = null;
let currentOrigin = null;
let currentPattern = null;
let currentBuiltIn = null;
let isBusy = false;
let statusTimer = 0;
let themeMode = 'auto';

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(mode) {
    themeMode = ['light', 'dark'].includes(mode) ? mode : 'auto';

    const resolvedTheme = themeMode === 'auto'
        ? (systemTheme.matches ? 'dark' : 'light')
        : themeMode;

    document.documentElement.dataset.theme = resolvedTheme;

    elements.themeButtons.forEach((button) => {
        const active = button.dataset.themeValue === themeMode;

        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
}

async function loadTheme() {
    const data = await chrome.storage.sync.get([THEME_KEY]);
    applyTheme(data[THEME_KEY] || 'auto');
}

systemTheme.addEventListener('change', () => {
    if (themeMode === 'auto') {
        applyTheme('auto');
    }
});

function getSiteInitial(name, host) {
    const value = name || host || 'K';
    return value.trim().charAt(0).toUpperCase();
}

function isToggleOn() {
    return elements.siteSwitch.getAttribute('aria-checked') === 'true';
}

function setToggleState(enabled, label) {
    elements.siteSwitch.setAttribute('aria-checked', String(Boolean(enabled)));
    elements.siteSwitch.setAttribute('aria-label', label);
    elements.siteSwitch.title = label;
}

function showStatus(text, type = '') {
    clearTimeout(statusTimer);
    elements.statusText.textContent = text;
    elements.statusToast.className = `status-toast${type ? ` ${type}` : ''}`;
    elements.statusToast.hidden = false;

    requestAnimationFrame(() => {
        elements.statusToast.classList.add('visible');
    });

    statusTimer = setTimeout(() => {
        elements.statusToast.classList.remove('visible');
        setTimeout(() => {
            elements.statusToast.hidden = true;
        }, 220);
    }, 2400);
}

function setBadge(text, type = '') {
    elements.supportBadge.textContent = text;
    elements.supportBadge.className = `badge${type ? ` ${type}` : ''}`;
}

function setBusy(busy) {
    isBusy = busy;
    elements.siteSwitch.disabled = busy || !currentOrigin;
    elements.continuePermission.disabled = busy;
    elements.cancelPermission.disabled = busy;
}

function normalizeOrigin(url) {
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
    return url.origin;
}

function originToPattern(origin) {
    return origin ? `${origin}/*` : null;
}

async function getStoredArray(key) {
    const data = await chrome.storage.sync.get([key]);
    return Array.isArray(data[key]) ? data[key] : [];
}

async function getCustomSiteState() {
    if (!currentPattern || !currentOrigin) return false;

    const [hasPermission, sites] = await Promise.all([
        chrome.permissions.contains({ origins: [currentPattern] }),
        getStoredArray(CUSTOM_SITE_KEY)
    ]);

    return hasPermission && sites.includes(currentOrigin);
}

async function getBuiltInSiteState() {
    if (!currentOrigin) return false;
    const disabledOrigins = await getStoredArray(DISABLED_BUILT_IN_KEY);
    return !disabledOrigins.includes(currentOrigin);
}

function updateBuiltInCopy(enabled) {
    setBadge(enabled ? 'Built-in' : 'Built-in · Off', enabled ? '' : 'off');
    elements.supportCopy.textContent = enabled
        ? 'Optimized support is enabled for this site.'
        : 'Disabled for this site. Your preference is saved.';
    elements.infoTitle.textContent = 'Built-in compatibility';
    elements.infoCopy.textContent = 'Optimized support is on by default, but you can turn it off or back on at any time.';
}

function updateCustomCopy(enabled) {
    setBadge('Experimental', 'experimental');
    elements.supportCopy.textContent = enabled
        ? 'Generic Mode is enabled for this domain.'
        : 'Off by default. Enable Generic Mode for this domain only.';
    elements.infoTitle.textContent = 'Custom site support';
    elements.infoCopy.textContent = 'Unknown sites stay off by default. Experimental Generic Mode can be enabled for the current site only.';
}

function showModal() {
    elements.modal.hidden = false;
    elements.continuePermission.focus();
}

function hideModal() {
    elements.modal.hidden = true;
    elements.siteSwitch.focus();
}

async function setBuiltInSiteEnabled(enabled) {
    if (!currentOrigin || !currentTab?.id) return;

    const previousState = isToggleOn();
    setBusy(true);

    try {
        const response = await chrome.runtime.sendMessage({
            type: enabled ? 'kawarimi:enable-built-in' : 'kawarimi:disable-built-in',
            origin: currentOrigin,
            tabId: currentTab.id
        });

        if (!response?.ok) throw new Error(response?.error || 'Could not update this site.');

        setToggleState(enabled, enabled ? 'Disable Kawarimi on this site' : 'Enable Kawarimi on this site');
        updateBuiltInCopy(enabled);
        showStatus(
            enabled ? 'Kawarimi is on for this site.' : 'Kawarimi is off for this site.',
            enabled ? 'success' : ''
        );
    } catch (error) {
        setToggleState(previousState, previousState ? 'Disable Kawarimi on this site' : 'Enable Kawarimi on this site');
        showStatus(error.message || 'Could not update this site.', 'error');
    } finally {
        setBusy(false);
    }
}

async function enableCurrentCustomSite() {
    if (!currentOrigin || !currentPattern || !currentTab?.id) return;

    setBusy(true);

    try {
        const granted = await chrome.permissions.request({ origins: [currentPattern] });
        if (!granted) {
            showStatus('Permission was not granted. Kawarimi remains off.', 'error');
            return;
        }

        const response = await chrome.runtime.sendMessage({
            type: 'kawarimi:enable-site',
            origin: currentOrigin,
            tabId: currentTab.id
        });

        if (!response?.ok) throw new Error(response?.error || 'Could not enable this site.');

        setToggleState(true, 'Disable Kawarimi on this site');
        updateCustomCopy(true);
        showStatus('Experimental support is enabled.', 'success');
    } catch (error) {
        setToggleState(false, 'Enable experimental support on this site');
        showStatus(error.message || 'Could not enable this site.', 'error');
    } finally {
        hideModal();
        setBusy(false);
    }
}

async function disableCurrentCustomSite() {
    if (!currentOrigin || !currentTab?.id) return;

    const previousState = isToggleOn();
    setBusy(true);

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'kawarimi:disable-site',
            origin: currentOrigin,
            tabId: currentTab.id
        });

        if (!response?.ok) throw new Error(response?.error || 'Could not disable this site.');

        setToggleState(false, 'Enable experimental support on this site');
        updateCustomCopy(false);
        showStatus('Kawarimi is off for this domain.');
    } catch (error) {
        setToggleState(previousState, 'Disable Kawarimi on this site');
        showStatus(error.message || 'Could not disable this site.', 'error');
    } finally {
        setBusy(false);
    }
}

async function renderCurrentSite() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab || null;

    try {
        currentUrl = new URL(tab?.url || '');
    } catch {
        currentUrl = null;
    }

    currentOrigin = normalizeOrigin(currentUrl);
    currentPattern = originToPattern(currentOrigin);
    currentBuiltIn = currentUrl
        ? BUILT_IN_SITES.find((site) => site.match(currentUrl.hostname)) || null
        : null;

    if (!currentUrl || !currentOrigin) {
        elements.siteIcon.textContent = '—';
        elements.siteName.textContent = 'Unavailable here';
        elements.siteHost.textContent = 'Open a regular website to use Kawarimi';
        setToggleState(false, 'Kawarimi is unavailable on this page');
        elements.siteSwitch.disabled = true;
        setBadge('Unavailable', 'unavailable');
        elements.supportCopy.textContent = 'Chrome internal pages and extension pages cannot be modified.';
        elements.infoTitle.textContent = 'Per-site access';
        elements.infoCopy.textContent = 'Open a regular website to manage Kawarimi for that domain.';
        return;
    }

    const displayName = currentBuiltIn?.name || currentUrl.hostname.replace(/^www\./, '');
    elements.siteIcon.textContent = getSiteInitial(displayName, currentUrl.hostname);
    elements.siteName.textContent = displayName;
    elements.siteHost.textContent = currentUrl.hostname;

    if (currentBuiltIn) {
        const enabled = await getBuiltInSiteState();
        setToggleState(enabled, enabled ? 'Disable Kawarimi on this site' : 'Enable Kawarimi on this site');
        elements.siteSwitch.disabled = false;
        updateBuiltInCopy(enabled);
        return;
    }

    const enabled = await getCustomSiteState();
    setToggleState(enabled, enabled ? 'Disable Kawarimi on this site' : 'Enable experimental support on this site');
    elements.siteSwitch.disabled = false;
    updateCustomCopy(enabled);
}

elements.siteSwitch.addEventListener('click', () => {
    if (isBusy || !currentOrigin) return;

    const enabled = isToggleOn();

    if (currentBuiltIn) {
        setBuiltInSiteEnabled(!enabled);
        return;
    }

    if (enabled) {
        disableCurrentCustomSite();
    } else {
        showModal();
    }
});

elements.cancelPermission.addEventListener('click', hideModal);
elements.continuePermission.addEventListener('click', enableCurrentCustomSite);

elements.modal.addEventListener('click', (event) => {
    if (event.target === elements.modal && !isBusy) hideModal();
});

elements.themeButtons.forEach((button) => {
    button.addEventListener('click', async () => {
        const selectedTheme = button.dataset.themeValue;

        applyTheme(selectedTheme);

        await chrome.storage.sync.set({
            [THEME_KEY]: selectedTheme
        });
    });
});

elements.settingsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

(async () => {
    elements.version.textContent = `v${chrome.runtime.getManifest().version}`;

    try {
        await loadTheme();
        await renderCurrentSite();
        } catch (error) {
        showStatus(error.message || 'Could not read the current site.', 'error');
        setBusy(false);
    } finally {
        requestAnimationFrame(() => {
            document.documentElement.classList.remove('popup-loading');
        });
    }
})();
