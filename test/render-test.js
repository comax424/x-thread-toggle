// Smoke test: runs the real code of thread-toggle.js with a minimal DOM stand-in.
// Usage: node test/render-test.js   (renders a sample post in several languages and clicks Reply/Repost)
const fs = require('fs');
const dir = process.argv[2] || require('path').join(__dirname, '..');
const label = process.argv[3] || 'render';
class El {
  constructor(tag) { this.tagName = tag; this.children = []; this._text = ''; this.dataset = {}; this.style = {}; this.listeners = {};
    const cls = new Set(); this.classList = { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) }; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  append(...n) { this.children.push(...n); }
  replaceChildren(...n) { this.children = n; }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  click() { for (const fn of this.listeners.click || []) fn({ stopPropagation() {} }); }
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children.at(-1); }
  replaceWith() {} focus() {} setAttribute() {} cloneNode() { return new El(this.tagName); }
  find(pred) { for (const c of this.children) { if (typeof c === 'string') continue; if (pred(c)) return c; const r = c.find(pred); if (r) return r; } }
}
globalThis.window = globalThis;
globalThis.document = { createElement: (t) => new El(t), querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {}, lang: 'de' } };
globalThis.XMLHttpRequest = class {}; globalThis.MutationObserver = class { observe() {} };
globalThis.requestAnimationFrame = () => {}; globalThis.location = { pathname: '/', origin: 'https://x.com' };
eval(fs.readFileSync(dir + '/i18n.js', 'utf8'));
const src = fs.readFileSync(dir + '/thread-toggle.js', 'utf8').replace(/\}\)\(\);\s*$/, 'globalThis.__x = { renderTweet };\n})();');
eval(src);
const tweet = { rest_id: '1', views: { count: '1234' },
  core: { user_results: { result: { core: { name: 'Test', screen_name: 'test' }, avatar: { image_url: 'a.jpg' } } } },
  legacy: { created_at: 'Sat Nov 01 10:00:00 +0000 2026', full_text: '@x Hallo Welt', display_text_range: [3, 13], entities: { urls: [], media: [] },
    reply_count: 2, retweet_count: 1, favorite_count: 5, bookmark_count: 0, favorited: false, retweeted: false, bookmarked: false } };
for (const lang of ['de', 'en', 'pl', 'el']) {
  document.documentElement.lang = lang;
  try {
    const card = __x.renderTweet(tweet);
    const btn = (cls) => card.find((e) => e.tagName === 'button' && e.className.includes(cls));
    btn('xtt-reply').click();
    const placeholder = card.find((e) => e.tagName === 'textarea')?.placeholder;
    btn('xtt-retweet').click();
    const menu = card.find((e) => e.className === 'xtt-menu')?.textContent;
    console.log(`${label} ${lang}: OK | reply box: "${placeholder}" | repost menu: "${menu}"`);
  } catch (e) { console.log(`${label} ${lang}: FAILED → ${e.message}`); process.exitCode = 1; }
}
