const defaults = { autoExpand: false, wide: true };
chrome.storage.sync.get(defaults, (s) => {
  for (const key of Object.keys(defaults)) {
    const box = document.getElementById(key);
    box.checked = s[key];
    box.addEventListener('change', () => chrome.storage.sync.set({ [key]: box.checked }));
  }
});
