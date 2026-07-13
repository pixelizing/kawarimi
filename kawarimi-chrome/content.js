(async () => {
const DISABLED_BUILT_IN_KEY = 'kawarimiDisabledBuiltInOrigins';

try {
    const storedState = await chrome.storage.sync.get([DISABLED_BUILT_IN_KEY]);
    const disabledOrigins = Array.isArray(storedState[DISABLED_BUILT_IN_KEY])
        ? storedState[DISABLED_BUILT_IN_KEY]
        : [];

    if (disabledOrigins.includes(location.origin)) return;
} catch {
    // Keep the built-in default when storage is temporarily unavailable.
}

let findPayload = null;
let lockedButtonRef = null;
let completedButtonRef = null;
let completedCodeSnapshot = null;
let currentPort = 10240;

const IS_CHATGPT = location.hostname === 'chatgpt.com';
const IS_CLAUDE = location.hostname === 'claude.ai';
const IS_PERPLEXITY = location.hostname === 'www.perplexity.ai' || location.hostname === 'perplexity.ai';
const IS_GROK = location.hostname === 'grok.com' || location.hostname.endsWith('.grok.com');
const NEEDS_OVERLAP_RECONCILE = IS_PERPLEXITY || IS_GROK;
const TOOLBAR_RIGHT_OFFSET = IS_CLAUDE ? 112 : 50;
const HOST_Z_INDEX = '2147483000';
const RUNTIME_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let nextBlockId = 1;
let stylesheetUrl = '';
let chatGptReconcileTimer = 0;
let isChatGptReconciling = false;
let perplexityReconcileTimer = 0;
let nextHostSequence = 1;
let isDestroyed = false;
const resizeObservers = new Set();

try {
    stylesheetUrl = chrome.runtime.getURL('kawarimi.css');
} catch {
    
}

try {
    chrome.storage.sync.get(['kawarimiPort'], (data) => {
        if (data?.kawarimiPort) currentPort = data.kawarimiPort;
    });
} catch {
    // Keep the default port when Chrome has invalidated an older context.
}

function createStyleLink() {
    if (!stylesheetUrl) return null;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = stylesheetUrl;
    return link;
}

function appendStylesheet(shadowRoot) {
    const link = createStyleLink();
    if (link) shadowRoot.appendChild(link);
}

function applyStyles(element, styles) {
    Object.assign(element.style, styles);
}

function findAnchor(preElement) {
    let element = preElement.parentElement;

    while (element && element !== document.body) {
        if (getComputedStyle(element).position !== 'static') return element;
        element = element.parentElement;
    }

    const fallback = preElement.parentElement;
    if (fallback && getComputedStyle(fallback).position === 'static') {
        fallback.style.position = 'relative';
    }
    return fallback;
}

function positionHost(host, preElement, anchor) {
    if (!anchor || !host.isConnected || !preElement.isConnected) return;

    const preRect = preElement.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const hostWidth = host.getBoundingClientRect().width || 176;
    const availableOffset = Math.max(8, preRect.width - hostWidth - 8);
    const rightOffset = Math.min(TOOLBAR_RIGHT_OFFSET, availableOffset);

    applyStyles(host, {
        top: `${Math.max(8, preRect.top - anchorRect.top + 8)}px`,
        right: `${Math.max(8, anchorRect.right - preRect.right + rightOffset)}px`
    });
}

function isKawarimiShadowHost(element) {
    if (!(element instanceof HTMLElement) || !element.shadowRoot) return false;
    return Boolean(
        element.shadowRoot.querySelector('.kawarimi-root') ||
        element.shadowRoot.querySelector('#kawarimi-toast')
    );
}

function removeLegacyUi() {
    document.querySelectorAll('[data-kawarimi-host], [data-kawarimi-toast-host]').forEach((element) => {
        element.remove();
    });

    document.querySelectorAll('pre').forEach((preElement) => {
        preElement.classList.remove('kawarimi-injected');
        delete preElement.dataset.kawarimiInjected;
        delete preElement.dataset.kawarimiBlockId;

        preElement.querySelectorAll('*').forEach((element) => {
            if (isKawarimiShadowHost(element)) element.remove();
        });
    });

    Array.from(document.documentElement.children).forEach((element) => {
        if (isKawarimiShadowHost(element)) element.remove();
    });
}

function reserveExistingCodeBlocks() {
    document.querySelectorAll('pre').forEach((preElement) => {
        preElement.classList.add('kawarimi-injected');
    });
}

function getOrCreateBlockId(preElement) {
    if (!preElement.dataset.kawarimiBlockId) {
        preElement.dataset.kawarimiBlockId = `${RUNTIME_ID}-${nextBlockId++}`;
    }
    return preElement.dataset.kawarimiBlockId;
}

function findToolbarForBlock(blockId) {
    return Array.from(document.querySelectorAll('[data-kawarimi-host]')).find((host) => {
        return host.dataset.kawarimiFor === blockId;
    }) || null;
}


function getOutermostPre(preElement) {
    let owner = preElement;
    let parentPre = preElement.parentElement?.closest('pre') || null;

    while (parentPre) {
        owner = parentPre;
        parentPre = parentPre.parentElement?.closest('pre') || null;
    }

    return owner;
}

function isRenderedPre(preElement) {
    if (!(preElement instanceof HTMLElement) || !preElement.isConnected) return false;

    const rect = preElement.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 10) return false;

    const style = getComputedStyle(preElement);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
}

function removeToolbarForPre(preElement) {
    const blockId = preElement.dataset.kawarimiBlockId;
    const host = blockId ? findToolbarForBlock(blockId) : null;

    if (host?.isConnected) host.remove();

    delete preElement.dataset.kawarimiBlockId;
    preElement.classList.add('kawarimi-injected');
    preElement.dataset.kawarimiInjected = 'true';
    preElement.dataset.kawarimiSuppressed = 'true';
}

function chooseChatGptCanonicalPre(preElements) {
    const leafPres = preElements.filter((preElement) => !preElement.querySelector('pre'));
    if (!leafPres.length) return null;

    return [...leafPres].sort((first, second) => {
        const firstVisible = isRenderedPre(first) ? 1 : 0;
        const secondVisible = isRenderedPre(second) ? 1 : 0;
        if (firstVisible !== secondVisible) return secondVisible - firstVisible;

        const firstHasCode = first.querySelector('code') ? 1 : 0;
        const secondHasCode = second.querySelector('code') ? 1 : 0;
        if (firstHasCode !== secondHasCode) return secondHasCode - firstHasCode;

        const a = first.getBoundingClientRect();
        const b = second.getBoundingClientRect();
        return (b.width * b.height) - (a.width * a.height);
    })[0];
}

function reconcileChatGptCodeBlocks() {
    if (!IS_CHATGPT || isChatGptReconciling) return;
    if (document.documentElement.dataset.kawarimiRuntime !== RUNTIME_ID) return;

    isChatGptReconciling = true;

    try {
        const allPres = Array.from(document.querySelectorAll('pre'));
        const groups = new Map();

        for (const preElement of allPres) {
            const owner = getOutermostPre(preElement);
            if (!groups.has(owner)) groups.set(owner, []);
            groups.get(owner).push(preElement);
        }

        for (const preElements of groups.values()) {
            const canonical = chooseChatGptCanonicalPre(preElements);

            for (const preElement of preElements) {
                if (preElement === canonical) {
                    delete preElement.dataset.kawarimiSuppressed;
                    injectKawarimiButtons(preElement);
                } else {
                    removeToolbarForPre(preElement);
                }
            }
        }
    } finally {
        isChatGptReconciling = false;
    }
}

function scheduleChatGptReconcile() {
    clearTimeout(chatGptReconcileTimer);
    chatGptReconcileTimer = setTimeout(reconcileChatGptCodeBlocks, 60);
}


function findPreForBlock(blockId) {
    return Array.from(document.querySelectorAll('pre[data-kawarimi-block-id]')).find((preElement) => {
        return preElement.dataset.kawarimiBlockId === blockId;
    }) || null;
}

function removeOrphanedToolbarHosts() {
    document.querySelectorAll('[data-kawarimi-host]').forEach((host) => {
        if (host.dataset.kawarimiRuntime !== RUNTIME_ID) return;

        const owner = findPreForBlock(host.dataset.kawarimiFor || '');
        if (!owner?.isConnected) host.remove();
    });
}

function getHostPosition(host) {
    const top = Number.parseFloat(host.style.top || '0');
    const right = Number.parseFloat(host.style.right || '0');
    return {
        top: Number.isFinite(top) ? top : 0,
        right: Number.isFinite(right) ? right : 0
    };
}

function elementsOverlap(first, second, threshold = 0.6) {
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();

    if (!a.width || !a.height || !b.width || !b.height) return false;

    const overlapWidth = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const overlapHeight = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const overlapArea = overlapWidth * overlapHeight;
    const smallerArea = Math.min(a.width * a.height, b.width * b.height);

    return smallerArea > 0 && overlapArea / smallerArea >= threshold;
}

function releasePerplexitySuppressedBlocks() {
    const activePres = Array.from(document.querySelectorAll('pre[data-kawarimi-block-id]')).filter((preElement) => {
        const host = findToolbarForBlock(preElement.dataset.kawarimiBlockId || '');
        return host?.isConnected && preElement.dataset.kawarimiSuppressed !== 'true';
    });

    document.querySelectorAll('pre[data-kawarimi-suppressed="true"]').forEach((preElement) => {
        if (!isRenderedPre(preElement)) return;

        const stillDuplicated = activePres.some((activePre) => elementsOverlap(preElement, activePre, 0.7));
        if (stillDuplicated) return;

        delete preElement.dataset.kawarimiSuppressed;
        delete preElement.dataset.kawarimiInjected;
        delete preElement.dataset.kawarimiBlockId;
        preElement.classList.remove('kawarimi-injected');
    });
}

function removeOverlappingToolbarHosts() {
    const hosts = Array.from(document.querySelectorAll('[data-kawarimi-host]'))
        .filter((host) => host.dataset.kawarimiRuntime === RUNTIME_ID && host.isConnected)
        .sort((first, second) => {
            return Number(second.dataset.kawarimiSequence || 0) - Number(first.dataset.kawarimiSequence || 0);
        });

    const kept = [];

    for (const host of hosts) {
        const position = getHostPosition(host);
        const duplicate = kept.some((existing) => {
            const existingPosition = getHostPosition(existing);
            const sameAnchorAndPosition =
                host.parentElement === existing.parentElement &&
                Math.abs(position.top - existingPosition.top) <= 3 &&
                Math.abs(position.right - existingPosition.right) <= 3;

            return sameAnchorAndPosition || elementsOverlap(host, existing);
        });

        if (duplicate) {
            const owner = findPreForBlock(host.dataset.kawarimiFor || '');
            if (owner) {
                delete owner.dataset.kawarimiBlockId;
                owner.dataset.kawarimiSuppressed = 'true';
                markInjected(owner);
            }
            host.remove();
        } else {
            kept.push(host);
        }
    }
}

function reconcilePerplexityCodeBlocks() {
    if (!NEEDS_OVERLAP_RECONCILE || isDestroyed) return;
    if (document.documentElement.dataset.kawarimiRuntime !== RUNTIME_ID) return;

    removeOrphanedToolbarHosts();
    releasePerplexitySuppressedBlocks();
    scanForCodeBlocks(document);

    requestAnimationFrame(() => {
        removeOrphanedToolbarHosts();
        removeOverlappingToolbarHosts();
    });
}

function schedulePerplexityReconcile() {
    clearTimeout(perplexityReconcileTimer);
    perplexityReconcileTimer = setTimeout(reconcilePerplexityCodeBlocks, 80);
}

function markInjected(preElement) {

    preElement.classList.add('kawarimi-injected');
    preElement.dataset.kawarimiInjected = 'true';
}

function removeLegacyHostsForPre(preElement, anchor) {
    preElement.querySelectorAll('*').forEach((element) => {
        if (isKawarimiShadowHost(element)) element.remove();
    });

    anchor.querySelectorAll('[data-kawarimi-host]').forEach((host) => {
        if (!host.dataset.kawarimiFor || host.dataset.kawarimiFor === preElement.dataset.kawarimiBlockId) {
            host.remove();
        }
    });
}


removeLegacyUi();
reserveExistingCodeBlocks();
document.documentElement.dataset.kawarimiRuntime = RUNTIME_ID;

const toastHost = document.createElement('div');
toastHost.dataset.kawarimiToastHost = '';
applyStyles(toastHost, {
    all: 'initial',
    position: 'fixed',
    inset: '0 auto auto 0',
    width: '0',
    height: '0',
    zIndex: '2147483647',
    pointerEvents: 'none'
});
document.documentElement.appendChild(toastHost);

const toastShadow = toastHost.attachShadow({ mode: 'open' });
appendStylesheet(toastShadow);

const toast = document.createElement('div');
toast.id = 'kawarimi-toast';
toastShadow.appendChild(toast);

function showToast(message, isError = false) {
    toast.textContent = `Kawarimi: ${message}`;
    toast.className = isError ? 'show error' : 'show';

    clearTimeout(showToast.timeout);
    showToast.timeout = setTimeout(() => {
        toast.className = '';
    }, 2800);
}



function injectKawarimiButtons(preElement) {
    if (isDestroyed) return;
    if (!(preElement instanceof HTMLElement)) return;
    if (preElement.dataset.kawarimiSuppressed === 'true') return;

    if (IS_CHATGPT && preElement.querySelector('pre')) {
        removeToolbarForPre(preElement);
        return;
    }

    const existingBlockId = preElement.dataset.kawarimiBlockId;
    const existingHost = existingBlockId ? findToolbarForBlock(existingBlockId) : null;

    if (
        preElement.dataset.kawarimiInjected === 'true' &&
        existingHost?.dataset.kawarimiRuntime === RUNTIME_ID
    ) {
        preElement.classList.add('kawarimi-injected');
        return;
    }

    const anchor = findAnchor(preElement);
    if (!anchor) return;

    
    markInjected(preElement);
    removeLegacyHostsForPre(preElement, anchor);

    if (existingHost?.isConnected) existingHost.remove();
    delete preElement.dataset.kawarimiBlockId;

    const blockId = getOrCreateBlockId(preElement);

    const host = document.createElement('div');
    host.dataset.kawarimiHost = '';
    host.dataset.kawarimiFor = blockId;
    host.dataset.kawarimiRuntime = RUNTIME_ID;
    host.dataset.kawarimiSequence = String(nextHostSequence++);
            applyStyles(host, {
        all: 'initial',
        position: 'absolute',
        zIndex: HOST_Z_INDEX,
        pointerEvents: 'none'
    });

    anchor.appendChild(host);

            const shadow = host.attachShadow({ mode: 'open' });
    appendStylesheet(shadow);

    let replaceAll = true;

    const root = document.createElement('div');
    root.className = 'kawarimi-root';

    const container = document.createElement('div');
    container.className = 'kawarimi-btn-container';

    const btnToggle = document.createElement('button');
    btnToggle.className = 'kawarimi-btn kawarimi-toggle active';
    btnToggle.textContent = 'All';
    btnToggle.title = 'Replace all matches';

    btnToggle.addEventListener('click', () => {
        replaceAll = !replaceAll;
        btnToggle.textContent = replaceAll ? 'All' : '1st';
        btnToggle.classList.toggle('active', replaceAll);
        btnToggle.title = replaceAll ? 'Replace all matches' : 'Replace only the first match';
    });

    const btnFind = document.createElement('button');
    btnFind.className = 'kawarimi-btn';
    btnFind.textContent = 'Find';

    const btnReplace = document.createElement('button');
    btnReplace.className = 'kawarimi-btn';
    btnReplace.textContent = 'Replace';

        const getCode = () => {
        const codeElement = preElement.querySelector('code');
        return codeElement ? codeElement.innerText : preElement.innerText;
    };

    if (
        preElement.dataset.kawarimiCompleted === 'true' ||
        (
            completedCodeSnapshot !== null &&
            !completedButtonRef?.isConnected &&
            getCode() === completedCodeSnapshot
        )
    ) {
        preElement.dataset.kawarimiCompleted = 'true';
        btnReplace.className = 'kawarimi-btn success';
        btnReplace.textContent = 'Done';
        completedButtonRef = btnReplace;
    }

    btnFind.addEventListener('click', () => {
        if (lockedButtonRef && lockedButtonRef !== btnFind) {
            lockedButtonRef.classList.remove('locked');
            lockedButtonRef.textContent = 'Find';
        }

        findPayload = getCode();
        btnFind.textContent = 'Locked';
        btnFind.classList.add('locked');
        lockedButtonRef = btnFind;
        showToast('Target locked. Select a replacement.');
    });

    btnReplace.addEventListener('click', () => {
        if (!findPayload) {
            showToast("Lock a target with 'Find' first.", true);
            return;
        }

        const replacePayload = getCode();
        btnReplace.textContent = 'Injecting...';

                chrome.runtime.sendMessage({
            type: 'kawarimi:patch',
            port: currentPort,
            payload: {
                find: findPayload,
                replace: replacePayload,
                replaceAll
            }
        })
            .then((result) => {
                if (!result?.ok) {
                    throw new Error(result?.error || 'Could not reach VS Code.');
                }

                const {
                    status,
                    data = {}
                } = result;

                if (status === 200) {
                    const found = data.found || 1;
                    const count = data.count || 1;

                    document.querySelectorAll('pre[data-kawarimi-completed="true"]').forEach((element) => {
                        delete element.dataset.kawarimiCompleted;
                    });

                    if (completedButtonRef && completedButtonRef !== btnReplace) {
                        completedButtonRef.className = 'kawarimi-btn';
                        completedButtonRef.textContent = 'Replace';
                    }

                    preElement.dataset.kawarimiCompleted = 'true';
                    completedCodeSnapshot = replacePayload;

                    btnReplace.className = 'kawarimi-btn success';
                    btnReplace.textContent = 'Done';
                    completedButtonRef = btnReplace;

                    if (found > 1 && !replaceAll) {
                        showToast(`Found ${found}. Replaced the first match.`);
                    } else if (found > 1) {
                        showToast(`Replaced ${count} of ${found} matches.`);
                    } else {
                        showToast('Successfully replaced in VS Code.');
                    }
                } else if (status === 404) {
                    showToast('Code block not found in the active file.', true);
                    btnReplace.textContent = 'Replace';
                } else {
                    showToast(data.error || 'VS Code error.', true);
                    btnReplace.textContent = 'Replace';
                }
            })
            .catch((error) => {
                showToast(
                    error?.message || 'VS Code is not running or the port is incorrect.',
                    true
                );
                btnReplace.textContent = 'Replace';
            });

        findPayload = null;

        if (lockedButtonRef) {
            lockedButtonRef.classList.remove('locked');
            lockedButtonRef.textContent = 'Find';
            lockedButtonRef = null;
        }
    });

    container.append(btnToggle, btnFind, btnReplace);
    root.appendChild(container);
    shadow.appendChild(root);

    requestAnimationFrame(() => {
        positionHost(host, preElement, anchor);
        if (NEEDS_OVERLAP_RECONCILE) removeOverlappingToolbarHosts();
    });
    setTimeout(() => {
        positionHost(host, preElement, anchor);
        if (NEEDS_OVERLAP_RECONCILE) removeOverlappingToolbarHosts();
    }, 60);

    if ('ResizeObserver' in window) {
        const resizeObserver = new ResizeObserver(() => {
            if (isDestroyed || !preElement.isConnected || !host.isConnected) {
                resizeObserver.disconnect();
                resizeObservers.delete(resizeObserver);
                return;
            }
            positionHost(host, preElement, anchor);
            if (NEEDS_OVERLAP_RECONCILE) removeOverlappingToolbarHosts();
        });
        resizeObservers.add(resizeObserver);
        resizeObserver.observe(preElement);
        resizeObserver.observe(host);
    }
}

function scanForCodeBlocks(root) {
    if (root.nodeType !== Node.ELEMENT_NODE && root !== document) return;

    if (root.matches?.('pre')) {
        injectKawarimiButtons(root);
    }

    root.querySelectorAll?.('pre').forEach(injectKawarimiButtons);
}

const observer = new MutationObserver((mutations) => {
    if (isDestroyed || document.documentElement.dataset.kawarimiRuntime !== RUNTIME_ID) {
        observer.disconnect();
        return;
    }

    if (IS_CHATGPT) {
        scheduleChatGptReconcile();
        return;
    }

    if (NEEDS_OVERLAP_RECONCILE) {
        schedulePerplexityReconcile();
        return;
    }

    for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement && node.dataset.kawarimiHost === '') return;
            scanForCodeBlocks(node);
        });
    }
});

function teardownKawarimi() {
    if (isDestroyed) return;
    isDestroyed = true;

    observer.disconnect();
    clearTimeout(chatGptReconcileTimer);
    clearTimeout(perplexityReconcileTimer);
    document.removeEventListener('click', schedulePerplexityReconcile, true);

    resizeObservers.forEach((resizeObserver) => resizeObserver.disconnect());
    resizeObservers.clear();

    document.querySelectorAll('[data-kawarimi-host]').forEach((host) => {
        if (host.dataset.kawarimiRuntime === RUNTIME_ID) host.remove();
    });

    if (toastHost.isConnected) toastHost.remove();

    document.querySelectorAll('pre').forEach((preElement) => {
        const blockId = preElement.dataset.kawarimiBlockId || '';
        if (blockId.startsWith(RUNTIME_ID)) {
            delete preElement.dataset.kawarimiBlockId;
            delete preElement.dataset.kawarimiInjected;
                        delete preElement.dataset.kawarimiSuppressed;
            delete preElement.dataset.kawarimiCompleted;
            preElement.classList.remove('kawarimi-injected');
        }
    });

    if (document.documentElement.dataset.kawarimiRuntime === RUNTIME_ID) {
        delete document.documentElement.dataset.kawarimiRuntime;
    }
}

try {
    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'kawarimi:teardown') teardownKawarimi();
    });
} catch {
    
}

observer.observe(document.body, { childList: true, subtree: true });

if (IS_CHATGPT) {
    reconcileChatGptCodeBlocks();
} else if (NEEDS_OVERLAP_RECONCILE) {
    reconcilePerplexityCodeBlocks();
    document.addEventListener('click', schedulePerplexityReconcile, true);
    setTimeout(schedulePerplexityReconcile, 250);
    setTimeout(schedulePerplexityReconcile, 900);
} else {
    scanForCodeBlocks(document);
}

})();
