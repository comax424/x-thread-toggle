// Reicht die Popup-Einstellungen an thread-toggle.js/.css weiter – die laufen im Seitenkontext ohne Zugriff auf chrome.storage.
const apply = (s) => {
  const d = document.documentElement.dataset;
  if ('autoExpand' in s) d.xttAutoExpand = s.autoExpand ? '1' : '0';
  if ('wide' in s) d.xttWide = s.wide ? '1' : '0';
  if ('showSpam' in s) d.xttShowSpam = s.showSpam ? '1' : '0';
};
chrome.storage.sync.get({ autoExpand: false, wide: true, showSpam: true }, apply);
chrome.storage.onChanged.addListener((changes) => {
  apply(Object.fromEntries(Object.entries(changes).map(([key, c]) => [key, c.newValue])));
});
