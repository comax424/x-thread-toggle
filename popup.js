// Popup-Texte in der Browsersprache
const lang = window.xttPick(navigator.language);
document.documentElement.lang = lang;
for (const el of document.querySelectorAll('[data-i18n]')) {
  el.textContent = window.xttStrings[lang][el.dataset.i18n] ?? window.xttStrings.en[el.dataset.i18n];
}

const defaults = { autoExpand: false, wide: true, showSpam: true };
chrome.storage.sync.get(defaults, (s) => {
  for (const key of Object.keys(defaults)) {
    const box = document.getElementById(key);
    box.checked = s[key];
    box.addEventListener('change', () => chrome.storage.sync.set({ [key]: box.checked }));
  }
});
