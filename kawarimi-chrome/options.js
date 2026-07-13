document.addEventListener('DOMContentLoaded', () => {
    const DEFAULT_PORT = 10240;

    const portInput = document.getElementById('portInput');
    const saveBtn = document.getElementById('saveBtn');
    const resetBtn = document.getElementById('resetBtn');

    chrome.storage.sync.get(['kawarimiPort'], (data) => {
        portInput.value = data.kawarimiPort || DEFAULT_PORT;
    });

    saveBtn.addEventListener('click', () => {
        const port = Number.parseInt(portInput.value, 10) || DEFAULT_PORT;

        portInput.value = port;

        chrome.storage.sync.set({ kawarimiPort: port }, () => {
            saveBtn.textContent = 'Saved!';
            saveBtn.classList.add('success');

            setTimeout(() => {
                saveBtn.textContent = 'Save Preferences';
                saveBtn.classList.remove('success');
            }, 1600);
        });
    });

    resetBtn.addEventListener('click', () => {
        portInput.value = DEFAULT_PORT;

        chrome.storage.sync.set({ kawarimiPort: DEFAULT_PORT }, () => {
            resetBtn.textContent = 'Reset Complete';
            resetBtn.classList.add('success');

            setTimeout(() => {
                resetBtn.textContent = 'Reset to Default';
                resetBtn.classList.remove('success');
            }, 1600);
        });
    });
});