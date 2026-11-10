// X Thread-Ansicht: blendet unter jeder Antwort deren komplette Unterhaltung ein und aus.
// Läuft im Seitenkontext (world: MAIN), damit es X' eigene TweetDetail-Anfrage mitlesen kann.
(() => {
  'use strict';

  const MAX_REQUESTS_PER_CLICK = 15; // schont X' Rate-Limit; tiefere Äste bleiben per Button ladbar
  const AUTO_REQUESTS_PER_POST = 80; // Budget fürs automatische Aufklappen je geöffnetem Beitrag
  const RATE_RESERVE = 50; // X erlaubt 300 TweetDetail-Abfragen / 15 Min.; der Rest bleibt für X selbst
  let rateRemaining = Infinity;
  const MAX_SPAM_CLICKS = 10; // so oft klickt die Erweiterung X' Spam-Button pro Beitrag höchstens
  const MAX_SPAM_PAGES = 3; // so viele Spam-Seiten lädt die Thread-Ansicht pro Antwort höchstens nach
  // „wahrscheinlich Spam“ einblenden: Häkchen im Popup, standardmäßig an (kommt über bridge.js)
  const spamEnabled = () => document.documentElement.dataset.xttShowSpam !== '0';

  // Sprache folgt X' Oberfläche (<html lang>), Texte aus i18n.js
  const lang = () => window.xttPick(document.documentElement.lang || navigator.language);
  function msg(key, vars = {}) {
    const s = window.xttStrings[lang()][key] ?? window.xttStrings.en[key];
    return s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  }

  // --- 1. X' eigene TweetDetail-Anfrage mitlesen (queryId, Feature-Flags, Sitzungs-Header) ---
  let template = null;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._xttUrl = String(url);
    this._xttHeaders = {};
    if (/\/TweetDetail\?/.test(this._xttUrl)) this.addEventListener('load', onXTweetDetail);
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._xttHeaders && /\/TweetDetail\?/.test(this._xttUrl)) {
      this._xttHeaders[name] = value;
      template = { url: this._xttUrl, headers: this._xttHeaders };
    }
    return origSetHeader.apply(this, arguments);
  };

  // --- 2. Antworten eines Beitrags laden ---
  async function fetchReplies(tweetId, cursor) {
    if (!template) throw new Error(msg('errReload'));
    const url = new URL(template.url, location.origin);
    const vars = JSON.parse(url.searchParams.get('variables'));
    vars.focalTweetId = tweetId;
    vars.referrer = 'tweet';
    if (cursor) vars.cursor = cursor;
    else delete vars.cursor;
    url.searchParams.set('variables', JSON.stringify(vars));
    const headers = { ...template.headers };
    delete headers['x-client-transaction-id']; // gilt nur für die Original-Anfrage, wird nicht benötigt
    const res = await fetch(url, { headers, credentials: 'include' });
    const remaining = res.headers.get('x-rate-limit-remaining');
    if (remaining !== null) rateRemaining = Number(remaining);
    if (res.status === 429) throw new Error(msg('errLimit'));
    if (!res.ok) throw new Error(msg('errStatus', { status: res.status }));
    return parseReplies(await res.json(), tweetId);
  }

  // --- 2b. Schreibende Aktionen (Like, Repost, Lesezeichen, Antworten) ---
  // X verlangt dafür eine x-client-transaction-id; die erzeugt X' eigener Generator aus dem Webpack-Bundle.
  let txGen = null;
  function transactionId(path) {
    if (!txGen) {
      const req = webpackRequire();
      txGen = Object.keys(req.m)
        .filter((id) => {
          const src = req.m[id].toString();
          return src.includes('jf.x.com') && src.includes('x-client-transaction-id');
        })
        .flatMap((id) => Object.values(req(id)))
        .find((f) => typeof f === 'function' && f.length === 3); // (host, path, method)
      if (!txGen) throw new Error(msg('errChanged'));
    }
    return txGen('https://x.com', path, 'POST');
  }

  // queryId und Feature-Flags einer Abfrage oder Aktion stehen im Haupt-Bundle von X
  let bundle = null;
  async function operation(name) {
    bundle ??= fetch([...document.scripts].map((s) => s.src).find((s) => /\/client-web\/main\.[^/]+\.js$/.test(s)))
      .then((r) => r.text());
    const m = (await bundle).match(new RegExp(`queryId:"([^"]+)",operationName:"${name}",operationType:"\\w+",metadata:\\{featureSwitches:\\[([^\\]]*)\\]`));
    if (!m) throw new Error(msg('errChanged'));
    return { queryId: m[1], features: m[2] ? m[2].replace(/"/g, '').split(',') : [] };
  }

  async function mutate(name, variables) {
    if (!template) throw new Error(msg('errReload'));
    const op = await operation(name);
    const path = `/i/api/graphql/${op.queryId}/${name}`;
    const body = { variables, queryId: op.queryId };
    if (op.features.length) body.features = featuresOf(op);
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { ...template.headers, 'content-type': 'application/json', 'x-client-transaction-id': await transactionId(path) },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.errors?.length) throw new Error(json?.errors?.[0]?.message || msg('errStatus', { status: res.status }));
    return json.data;
  }

  function featuresOf(op) { // Werte wie in X' eigener TweetDetail-Anfrage
    const known = JSON.parse(new URL(template.url, location.origin).searchParams.get('features') || '{}');
    return Object.fromEntries(op.features.map((f) => [f, known[f] ?? false]));
  }

  // Sitzungs-Header aus X' TweetDetail-Anfrage; lesende Abfragen brauchen keine x-client-transaction-id
  function sessionHeaders() {
    if (!template) throw new Error(msg('errReload'));
    const headers = { ...template.headers };
    delete headers['x-client-transaction-id'];
    return headers;
  }

  async function checked(res) {
    const json = await res.json().catch(() => null);
    if (res.status === 429) throw new Error(msg('errLimit'));
    if (!res.ok || json?.errors?.length) throw new Error(json?.errors?.[0]?.message || msg('errStatus', { status: res.status }));
    return json;
  }

  // Lesende GraphQL-Abfrage (z. B. UserByScreenName)
  async function query(name, variables, fieldToggles) {
    const headers = sessionHeaders();
    const op = await operation(name);
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(featuresOf(op)),
      fieldToggles: JSON.stringify(fieldToggles),
    });
    return (await checked(await fetch(`/i/api/graphql/${op.queryId}/${name}?${params}`, { headers, credentials: 'include' }))).data;
  }

  // X' ältere REST-Schnittstelle (Folgen, „Gefolgt von“), aufgebaut wie in X' eigenem apiClient:
  // /i/api/1.1/<endpunkt>.json, POST-Daten als Formular
  async function rest(method, endpoint, params) {
    const headers = sessionHeaders();
    const path = `/i/api/1.1/${endpoint}.json`;
    const body = new URLSearchParams(params);
    if (method === 'GET') return checked(await fetch(`${path}?${body}`, { headers, credentials: 'include' }));
    headers['content-type'] = 'application/x-www-form-urlencoded';
    headers['x-client-transaction-id'] = await transactionId(path);
    return checked(await fetch(path, { method, headers, credentials: 'include', body }));
  }

  function unwrap(result) {
    if (result?.__typename === 'TweetWithVisibilityResults') return result.tweet;
    return result?.__typename === 'Tweet' ? result : null;
  }

  // Liefert nur direkte Antworten auf parentId (Vorgänger-Beiträge und Ketten fallen heraus)
  function parseReplies(json, parentId) {
    const instructions = json?.data?.threaded_conversation_with_injections_v2?.instructions || [];
    const replies = [];
    const seen = new Set();
    let cursor = null;
    let spamCursor = null; // „Wahrscheinlichen Spam anzeigen“: X hält diese Antworten hinter eigenem Cursor zurück
    for (const ins of instructions) {
      for (const entry of ins.entries || []) {
        const c = entry.content;
        const cur = c.entryType === 'TimelineTimelineCursor' ? c : c.itemContent?.itemType === 'TimelineTimelineCursor' ? c.itemContent : null;
        if (cur) {
          if (cur.cursorType?.startsWith('ShowMoreThreads')) spamCursor = cur.value;
          else if (cur.cursorType !== 'Top') cursor = cur.value;
          continue;
        }
        const items = c.items ? c.items.map((i) => i.item.itemContent) : [c.itemContent];
        for (const ic of items) {
          const t = unwrap(ic?.tweet_results?.result);
          if (t && t.legacy?.in_reply_to_status_id_str === parentId && !seen.has(t.rest_id)) {
            seen.add(t.rest_id);
            replies.push(t);
          }
        }
      }
    }
    return { replies, cursor, spamCursor };
  }

  // --- 3. Darstellung (nur textContent, nie innerHTML – Inhalte stammen von Fremden) ---
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function link(text, href, external) {
    const a = el('a', null, text);
    a.href = href;
    if (external) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    return a;
  }

  function userOf(t) {
    const u = t.core?.user_results?.result || {};
    return {
      name: u.core?.name ?? u.legacy?.name ?? '?',
      handle: u.core?.screen_name ?? u.legacy?.screen_name ?? 'i',
      avatar: u.avatar?.image_url ?? u.legacy?.profile_image_url_https,
      profile: u, // vollständige Kontodaten für die Profilkarte
    };
  }

  function decode(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  function renderText(t) {
    const box = el('div', 'xtt-text');
    const note = t.note_tweet?.note_tweet_results?.result; // Langbeiträge
    let text, urls;
    if (note) {
      text = note.text;
      urls = note.entity_set?.urls || [];
    } else {
      const [from, to] = t.legacy.display_text_range || [0, Infinity]; // schneidet führende @Erwähnungen ab
      text = decode(Array.from(t.legacy.full_text).slice(from, to).join(''));
      urls = t.legacy.entities?.urls || [];
    }
    const mediaLinks = new Set((t.legacy.entities?.media || []).map((m) => m.url));
    return appendLinked(box, text, urls, mediaLinks);
  }

  // Ersetzt t.co-Kurzlinks durch die ausgeschriebene Adresse (Beitragstext und Profil-Bio)
  function appendLinked(box, text, urls, skip = new Set()) {
    const byShort = new Map(urls.map((u) => [u.url, u]));
    let last = 0;
    for (const m of text.matchAll(/https:\/\/t\.co\/\w+/g)) {
      appendRich(box, text.slice(last, m.index));
      last = m.index + m[0].length;
      if (skip.has(m[0])) continue;
      const u = byShort.get(m[0]);
      box.append(link(u?.display_url || m[0], u?.expanded_url || m[0], true));
    }
    appendRich(box, text.slice(last));
    return box;
  }

  // @Erwähnungen, #Hashtags und $Cashtags verlinken wie X
  const TAGS = /(?<![\w@＠])[@＠](\w{1,15})|(?<![\w#＃&])[#＃]([\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)|(?<![\w$])\$([A-Za-z]{1,6}(?:[._][A-Za-z]{1,2})?)(?!\w)/gu;
  function appendRich(box, text) {
    let last = 0;
    for (const m of text.matchAll(TAGS)) {
      box.append(...withEmoji(text.slice(last, m.index)));
      last = m.index + m[0].length;
      const href = m[1] ? `/${m[1]}` : m[2] ? `/hashtag/${encodeURIComponent(m[2])}?src=hashtag_click` : `/search?q=%24${m[3]}&src=cashtag_click`;
      box.append(link(m[0], href));
    }
    box.append(...withEmoji(text.slice(last)));
  }

  // Emojis als X' eigene Emoji-Bilder (wie in X' Beiträgen), sofern X auf der Seite welche zeigt
  const EMOJI = /\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu;
  function withEmoji(text, scope = 'tweetText') {
    const tpl = document.querySelector(`[data-testid="${scope}"] img[src*="/emoji/v2/"]`) || document.querySelector('article img[src*="/emoji/v2/"]');
    if (!tpl || !text) return text ? [text] : [];
    const out = [];
    let last = 0;
    for (const m of text.matchAll(EMOJI)) {
      if (m[0].length === 1 && m[0].charCodeAt(0) < 0x2000) continue; // ©, ®, Ziffern: Text wie bei X
      if (m.index > last) out.push(text.slice(last, m.index));
      last = m.index + m[0].length;
      const e = m[0].includes('\u200D') ? m[0] : m[0].replace(/\uFE0F/g, ''); // Dateinamen wie bei Twemoji
      const img = tpl.cloneNode(false);
      img.src = tpl.src.replace(/[^/]+\.svg(\?.*)?$/, [...e].map((c) => c.codePointAt(0).toString(16)).join('-') + '.svg');
      img.alt = m[0];
      img.removeAttribute('title');
      out.push(img);
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  function renderMedia(t) {
    const media = t.legacy.extended_entities?.media || [];
    if (!media.length) return [];
    const box = el('div', `xtt-media xtt-media-${Math.min(media.length, 4)}`);
    for (const m of media) {
      const a = link('', m.expanded_url);
      if (m.type !== 'photo') a.className = 'xtt-video';
      const img = el('img');
      img.src = m.media_url_https + (media.length === 1 ? '?name=medium' : '?name=small');
      img.loading = 'lazy';
      img.alt = m.ext_alt_text || '';
      a.append(img);
      box.append(a);
    }
    return [box];
  }

  function renderQuote(t) {
    const q = unwrap(t.quoted_status_result?.result);
    if (!q) return [];
    const u = userOf(q);
    const a = link('', `/${u.handle}/status/${q.rest_id}`);
    a.className = 'xtt-quote';
    const head = el('div', 'xtt-quote-head');
    const avatar = el('img', 'xtt-quote-avatar');
    if (u.avatar) avatar.src = u.avatar;
    avatar.alt = '';
    const name = el('strong');
    name.append(...withEmoji(u.name, 'User-Name'));
    head.append(avatar, name, el('span', 'xtt-muted', ` @${u.handle} · ${relTime(new Date(q.legacy.created_at))}`));
    const text = el('div', 'xtt-quote-text');
    text.append(...withEmoji(decode(q.legacy.full_text)));
    a.append(head, text);
    return [a];
  }

  // --- 3c. X' eigene Bausteine: Texte, Navigation, Grok, Zeit- und Zahlformat, Hinweise ---
  let wpReq = null;
  function webpackRequire() {
    if (!wpReq) window.webpackChunk_twitter_responsive_web.push([[Symbol('xtt')], {}, (r) => { wpReq = r; }]);
    return wpReq;
  }

  // Texte aus X' eigenem Sprachmodul, damit Menüs und Hinweise wörtlich wie bei X lauten, in X' Sprache.
  // Die Schlüssel stammen aus X' Code; das Modul wird nur gelesen, nie aufgerufen. Fehlt es, gilt der Ersatztext.
  let xStrings = null;
  function xText(key, vars, fallback) {
    try {
      if (!xStrings) {
        for (const m of Object.values(webpackRequire().c)) {
          const ex = m?.exports;
          if (ex && typeof ex === 'object' && 'c66afdc3' in ex) {
            xStrings = ex;
            break;
          }
        }
      }
      const v = xStrings?.[key];
      const s = typeof v === 'function' ? v(vars || {}) : v;
      if (typeof s === 'string' && s) return s;
    } catch (e) { /* Modul anders aufgebaut */ }
    return fallback;
  }

  // Navigation innerhalb von X' App, ohne die Seite neu zu laden (aufgeklappte Threads bleiben erhalten).
  // Zustand im Format von X' Router; fromApp und previousPath setzt X bei jedem eigenen Seitenwechsel.
  function navigate(href, state = {}) {
    const s = { key: Math.random().toString(36).slice(2, 8), state: { ...state, fromApp: true, previousPath: location.pathname } };
    history.pushState(s, '', href);
    dispatchEvent(new PopStateEvent('popstate', { state: s }));
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('.xtt-thread a[href], .xtt-card a[href], .xtt-pmenu a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (a.target === '_blank' || a.origin !== location.origin) return;
    e.preventDefault();
    navigate(a.pathname + a.search);
  });

  // X' eigene Grok-Funktion öffnet die Grok-Seitenleiste. Sie hängt an jedem echten X-Beitrag auf der Seite
  // (React-Komponente „Tweet“, Feld _openGrok); bis sie geladen ist, ist es eine leere Funktion.
  function xOpenGrok() {
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
      const key = Object.keys(art).find((k) => k.startsWith('__reactFiber$'));
      for (let f = key && art[key], n = 0; f && n < 80; f = f.return, n++) {
        const fn = f.stateNode?._openGrok;
        if (typeof fn === 'function' && fn.toString().replace(/\s/g, '') !== 'async()=>{}') return fn;
      }
    }
    return null;
  }
  function openGrok(args, fallbackUrl) {
    const fallback = () => window.open(fallbackUrl, '_blank', 'noopener');
    try {
      const fn = xOpenGrok();
      if (fn) return void Promise.resolve(fn(args)).catch(fallback);
    } catch (e) { /* X hat die Funktion geändert */ }
    fallback();
  }

  const xLang = () => document.documentElement.lang || navigator.language;
  // Zeitangaben wie bei X („8 Min.“, „19 Std.“, „10. Nov.“). Das Muster je Einheit lernt die Erweiterung aus
  // X' eigenen Zeitangaben auf der Seite, denn X bringt dafür eigene Sprachdaten mit.
  const timeUnits = {};
  function learnTimeUnits() {
    for (const time of document.querySelectorAll('article[data-testid="tweet"] time[datetime]')) {
      const age = (Date.now() - Date.parse(time.dateTime)) / 1000;
      const unit = age < 60 ? 'second' : age < 3600 ? 'minute' : age < 86400 ? 'hour' : null;
      const m = unit && time.textContent.match(/\d+/);
      if (m) timeUnits[unit] = time.textContent.replace(m[0], '{0}');
    }
  }
  function relTime(date) {
    const age = Math.max(0, (Date.now() - date) / 1000);
    const [unit, n] = age < 60 ? ['second', Math.floor(age)] : age < 3600 ? ['minute', Math.floor(age / 60)] : age < 86400 ? ['hour', Math.floor(age / 3600)] : [];
    if (unit) {
      if (!timeUnits[unit]) learnTimeUnits();
      return timeUnits[unit]?.replace('{0}', n) ?? new Intl.NumberFormat(xLang(), { style: 'unit', unit, unitDisplay: 'narrow' }).format(n);
    }
    const opt = { day: 'numeric', month: 'short' };
    if (date.getFullYear() !== new Date().getFullYear()) opt.year = 'numeric';
    return date.toLocaleDateString(xLang(), opt);
  }
  // Zähler wie bei X: ausgeschrieben, große Zahlen gekürzt und abgeschnitten statt gerundet („17 Mio.“)
  const xCount = (n) => (n > 0 ? new Intl.NumberFormat(xLang(), n < 10000 ? {} : { notation: 'compact', roundingMode: 'trunc' }).format(n) : '');

  // Hinweis unten wie X' eigene Meldungen („Du folgst jetzt @…“)
  function toast(text) {
    if (!text) return;
    document.querySelector('.xtt-toast')?.remove();
    const t = el('div', 'xtt-toast', text);
    document.body.append(t);
    setTimeout(() => t.remove(), 4000);
  }

  // Rückfrage wie X' Dialog (z. B. „@… blockieren?“): Titel, Text, roter Bestätigen-Button, Abbrechen
  function confirmDialog(title, text, action, run) {
    const overlay = el('div', 'xtt-modal');
    const box = el('div', 'xtt-modal-box');
    box.style.background = getComputedStyle(document.body).backgroundColor;
    box.style.color = getComputedStyle(document.querySelector('[data-testid="tweetText"]') || document.body).color;
    const ok = el('button', 'xtt-modal-ok', action);
    const cancel = el('button', 'xtt-modal-cancel', xText('cfd2f35e', null, 'Cancel'));
    box.append(el('div', 'xtt-modal-title', title), el('div', 'xtt-modal-text', text), ok, cancel);
    overlay.append(box);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => e.target === overlay && close());
    cancel.addEventListener('click', close);
    ok.addEventListener('click', () => {
      close();
      run();
    });
    document.body.append(overlay);
    ok.focus();
  }

  // --- 3d. Beiträge aus X' eigener Vorlage ---
  // Eine echte X-Antwort auf der Seite dient als Vorlage: Geklont und mit den Daten des Beitrags gefüllt, sieht
  // ein eingeblendeter Beitrag exakt wie bei X aus (Schrift, Farben, Symbole, X' Einstellung zur Schriftgröße).
  function nativeTemplate() {
    return [...document.querySelectorAll('article[data-testid="tweet"][tabindex="0"]')].find((a) => !a.closest('.xtt-thread')
      && a.querySelector('[data-testid="User-Name"] a[href*="/status/"] time') && a.querySelector('[data-testid="tweetText"]')
      && a.querySelector('[data-testid="caret"]') && a.querySelector('[role="group"] [data-testid="reply"]')
      && a.querySelector('[data-testid="Tweet-User-Avatar"]'));
  }

  // kleinster gemeinsamer Vorfahr mehrerer Elemente
  function commonAncestor(...els) {
    let a = els[0];
    while (a && !els.every((e) => a.contains(e))) a = a.parentElement;
    return a;
  }

  // Haken nach dem Namen: aus der Vorlage oder von einem anderen Beitrag auf der Seite; Farbe je Kontotyp
  function setBadge(nameLink, info) {
    const own = nameLink.querySelector('svg[data-testid="icon-verified"]');
    let box = own?.closest('div[dir]');
    if (!info.check) return box?.remove();
    if (!box) {
      const other = [...document.querySelectorAll('[data-testid="User-Name"] svg[data-testid="icon-verified"]')].find((s) => !s.closest('.xtt-thread'));
      const nameBox = nameLink.querySelector('div[dir]');
      if (!other || !nameBox) return;
      box = other.closest('div[dir]').cloneNode(true);
      nameBox.after(box);
    }
    const svg = box.querySelector('svg');
    if (info.type === 'business') svg.style.color = 'rgb(226, 183, 25)';
    else if (info.type === 'government') svg.style.color = 'rgb(130, 154, 171)';
    else svg.style.removeProperty('color');
  }

  function renderNative(t, tpl) {
    const u = userOf(t);
    const info = profileInfo(u.profile);
    const id = t.rest_id;
    const art = tpl.cloneNode(true);
    // Kennungen ändern, damit weder X noch der Scan dieser Erweiterung den Klon für einen X-Beitrag halten
    art.dataset.testid = 'xtt-tweet';
    art.removeAttribute('tabindex');
    for (const e of [art, ...art.querySelectorAll('[id], [aria-labelledby], [aria-describedby]')]) {
      e.removeAttribute('id');
      e.removeAttribute('aria-labelledby');
      e.removeAttribute('aria-describedby');
    }
    art.classList.add('xtt-native');
    art.dataset.tid = id; // damit X' eigene Kopie desselben Beitrags ausgeblendet werden kann

    const nameBox = art.querySelector('[data-testid="User-Name"]');
    const textBox = art.querySelector('[data-testid="tweetText"]');
    const group = art.querySelector('[role="group"]');
    const caret = art.querySelector('[data-testid="caret"]');

    // Inhalt zwischen Kopf und Aktionsleiste (Medien, Karten, Zitate, „Mehr anzeigen“) aus der Vorlage entfernen
    const column = commonAncestor(nameBox, textBox, group);
    const headRow = [...column.children].find((c) => c.contains(nameBox));
    const textRow = [...column.children].find((c) => c.contains(textBox));
    const actionRow = [...column.children].find((c) => c.contains(group));
    for (const c of [...column.children]) if (![headRow, textRow, actionRow].includes(c)) c.remove();
    for (let e = textBox; e !== textRow; e = e.parentElement) {
      for (const s of [...e.parentElement.children]) if (s !== e) s.remove();
    }

    // Profilbild
    const avatar = art.querySelector('[data-testid="Tweet-User-Avatar"]');
    for (const a of avatar.querySelectorAll('a[href]')) a.setAttribute('href', `/${u.handle}`);
    for (const e of avatar.querySelectorAll('[data-testid^="UserAvatar-Container-"]')) e.dataset.testid = `UserAvatar-Container-${u.handle}`;
    for (const e of avatar.querySelectorAll('[style*="background-image"]')) e.style.backgroundImage = u.avatar ? `url("${u.avatar}")` : '';
    for (const img of avatar.querySelectorAll('img')) img.src = u.avatar || '';

    // Kopfzeile: Name, Haken, @handle, Zeit
    const timeLink = nameBox.querySelector('a[href*="/status/"]');
    const [nameLink, handleLink] = [...nameBox.querySelectorAll('a[href]')].filter((a) => a !== timeLink);
    nameLink.setAttribute('href', `/${u.handle}`);
    const nameText = nameLink.querySelector('div[dir]');
    const nameSpan = nameText?.querySelector('span span') || nameText?.querySelector('span');
    nameSpan?.replaceChildren(...withEmoji(u.name));
    for (const c of [...(nameText?.parentElement.children || [])]) if (c !== nameText && !c.querySelector('svg[data-testid="icon-verified"]')) c.remove(); // z. B. Firmenlogo der Vorlage
    setBadge(nameLink, info);
    if (handleLink) {
      handleLink.setAttribute('href', `/${u.handle}`);
      const span = handleLink.querySelector('span');
      if (span) span.textContent = '@' + u.handle;
    }
    const created = new Date(t.legacy.created_at);
    timeLink.setAttribute('href', `/${u.handle}/status/${id}`);
    timeLink.setAttribute('aria-label', created.toLocaleString(xLang(), { dateStyle: 'medium', timeStyle: 'short' }));
    const time = timeLink.querySelector('time');
    time.dateTime = created.toISOString();
    time.textContent = relTime(created);
    withCard(avatar.querySelector('a[href]') || avatar, u);
    withCard(nameLink, u);
    if (handleLink) withCard(handleLink, u);

    // Grok-Button und ⋯ rechts im Kopf
    const grok = [...headRow.querySelectorAll('button')].find((b) => b !== caret && !nameBox.contains(b));
    grok?.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = `https://x.com/${u.handle}/status/${id}`;
      openGrok({ text: url, analysisEntityId: id, autoSubmit: true, source: 'post_analysis_timeline',
        promptMetadata: { promptSource: 'GROK_ANALYZE', action: 'INPUT', properties: { element: 'BUTTON' } } },
      `/i/grok?text=${encodeURIComponent(url)}`);
    });
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      openPostMenu(caret, t, u);
    });

    // Text
    textBox.replaceChildren(...renderText(t).childNodes);
    textBox.removeAttribute('lang');
    if (t.legacy.lang) textBox.setAttribute('lang', t.legacy.lang);
    if (!textBox.textContent.trim()) textRow.hidden = true; // reiner Medien-Beitrag

    // Medien und Zitat unter dem Text, Abstände wie bei X
    const extraContent = [...renderMedia(t), ...renderQuote(t)];
    if (extraContent.length) {
      const box = el('div', 'xtt-native-content');
      box.append(...extraContent);
      textRow.after(box);
    }

    // Aktionsleiste: X' Leiste mit den Daten und Funktionen dieses Beitrags
    const [, extra] = renderActions(t, u, group);
    actionRow.after(extra);

    // Klick auf eine freie Stelle öffnet den Beitrag, wie bei X
    art.addEventListener('click', (e) => {
      if (e.target.closest('a, button, [role="button"], textarea, input, .xtt-thread .xtt-thread') || getSelection().toString()) return;
      navigate(`/${u.handle}/status/${id}`);
    });
    return art;
  }

  // --- 3e. ⋯-Menü wie X' eigenes ---
  // Aussehen und Symbole kommen aus X' echtem Menü: Die Erweiterung öffnet es einmal unsichtbar an einem
  // X-Beitrag, kopiert es als Vorlage und schließt es wieder (ein zweiter Klick auf ⋯ schließt es bei X).
  let menuTpl = null;
  const muteState = new Map(); // Konto-ID -> stummgeschaltet, nach eigenem Klick
  const blockState = new Map();
  const convoState = new Map(); // Beitrags-ID -> Unterhaltung stummgeschaltet
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function harvestMenu() {
    if (menuTpl) return menuTpl;
    // bevorzugt eine Antwort: ihr Menü entspricht dem der eingeblendeten Beiträge (der Hauptbeitrag hat z. B. „Abonnieren“)
    const carets = [...document.querySelectorAll('article[data-testid="tweet"] [data-testid="caret"]')].filter((c) => !c.closest('.xtt-thread'));
    const caret = carets.find((c) => c.closest('article[tabindex="0"]')) || carets[0];
    if (!caret) return null;
    document.documentElement.classList.add('xtt-harvest');
    try {
      caret.click();
      let menu = null;
      for (let i = 0; i < 40 && !menu; i++) {
        await sleep(50);
        menu = document.querySelector('#layers [role="menu"]');
      }
      if (!menu) return null;
      const items = [...menu.querySelectorAll('[role="menuitem"]')];
      const at = (f) => items.findIndex(f);
      const plain = (it) => it && !it.dataset.testid && !it.getAttribute('href');
      const between = (a, b) => (a >= 0 && b > a ? items.slice(a + 1, b).filter(plain) : []);
      const find = (sel) => items.find((it) => it.matches(sel));
      // Zuordnung über X' feste Reihenfolge: Folgen, Listen, Stummschalten, Unterhaltung, Blockieren,
      // Post-Aktivität, …, Einbetten, Melden, EU-Meldung, Kollektive Anmerkungen
      const iLists = at((it) => it.getAttribute('href') === '/i/lists/add_member');
      const iBlock = at((it) => it.dataset.testid === 'block');
      const iEng = at((it) => it.dataset.testid === 'tweetEngagements');
      const iReport = at((it) => it.dataset.testid === 'report');
      const mutes = between(iLists, iBlock);
      const found = {
        follow: items.slice(0, Math.max(iLists, 0)).find(plain), // vor „Abonnieren“ u. Ä.
        lists: items[iLists], mute: mutes[0], muteConvo: mutes[1], block: items[iBlock], engagements: items[iEng],
        embed: between(iEng, iReport).at(-1), report: items[iReport], dsa: find('[data-testid="reportEUIllegalContentDSA"]'),
        noteWrite: find('[href^="/i/communitynotes/contribute/"]'), noteRequest: find('[href^="/i/communitynotes/noterequest/"]'),
      };
      const icons = {};
      const texts = {};
      for (const [k, it] of Object.entries(found)) {
        if (!it) continue;
        icons[k] = it.querySelector('svg')?.cloneNode(true);
        texts[k] = it.innerText.trim();
      }
      menuTpl = { menu: menu.cloneNode(true), icons, texts };
      caret.click();
      for (let i = 0; i < 40 && document.querySelector('#layers [role="menu"]'); i++) await sleep(50);
    } finally {
      document.documentElement.classList.remove('xtt-harvest');
    }
    return menuTpl;
  }

  let postMenu = null;
  function closePostMenu() {
    postMenu?.remove();
    postMenu = null;
  }
  // Klick daneben schließt; ein Klick auf den Auslöser selbst wird in openPostMenu als „Schließen“ behandelt
  document.addEventListener('mousedown', (e) => postMenu && !postMenu.contains(e.target) && !postMenu.anchor?.contains(e.target) && closePostMenu(), true);

  // wie bei X: rechte obere Ecke des Menüs auf dem Auslöser, oberhalb, wenn unten kein Platz ist
  function showMenu(menu, anchor) {
    closePostMenu();
    menu.anchor = anchor;
    document.body.append(menu);
    postMenu = menu;
    const r = anchor.getBoundingClientRect();
    const h = menu.offsetHeight;
    menu.style.right = `${Math.max(6, innerWidth - r.right)}px`;
    menu.style.top = `${r.top + h <= innerHeight - 6 ? r.top : Math.max(6, r.bottom - h)}px`;
  }
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closePostMenu());
  addEventListener('scroll', closePostMenu, { passive: true });

  // Menü öffnen: Einträge in X' Reihenfolge, Texte aus X' Sprachmodul, Aktionen über X' Schnittstellen
  async function openPostMenu(anchor, t, u) {
    if (postMenu?.anchor === anchor) return closePostMenu();
    closePostMenu();
    const tpl = await harvestMenu();
    await loadCardData(u.handle).catch(() => {}); // Beziehung (folgen, stumm, blockiert) wie in X' eigenem Menü
    const p = cardData.get(u.handle)?.user || u.profile;
    const rel = p.relationship_perspectives || {};
    const L = p.legacy || {};
    const uid = p.rest_id;
    const id = t.rest_id;
    const h = u.handle;
    const url = `https://x.com/${h}/status/${id}`;
    const own = uid && uid === viewerId();
    const items = [];
    const fail = (err) => toast('⚠ ' + err.message);

    if (!own && uid) {
      const following = followState.has(uid) ? followState.get(uid) !== 'none' : !!(rel.following ?? L.following);
      items.push({ icon: 'follow', text: xText(following ? 'ja66a2b5' : 'c66afdc3', { screenName: h }, `${following ? 'Unfollow' : 'Follow'} @${h}`),
        run: () => rest('POST', `friendships/${following ? 'destroy' : 'create'}`, { user_id: uid }).then(() => {
          const isProtected = profileInfo(p).protected;
          followState.set(uid, following ? 'none' : isProtected ? 'pending' : 'following');
          toast(following ? xText('c2423b7b', { screenName: h }) : xText(isProtected ? 'hbe4feb5' : 'e1618e49', { screenName: h }));
        }, fail) });
      items.push({ icon: 'lists', text: tpl?.texts.lists || xText('a599bbfa', null, 'Add/remove from Lists'), href: '/i/lists/add_member',
        go: () => navigate('/i/lists/add_member', { userId: uid }) });
      const muted = muteState.get(uid) ?? !!(rel.muting ?? L.muting);
      items.push({ icon: 'mute', text: xText(muted ? 'bb1cbeb6' : 'hb568af4', null, muted ? 'Unmute' : 'Mute'),
        run: () => rest('POST', `mutes/users/${muted ? 'destroy' : 'create'}`, { user_id: uid }).then(() => {
          muteState.set(uid, !muted);
          toast(xText(muted ? 'h129c3c3' : 'i29533b3', { screenName: h }));
        }, fail) });
    }
    if (tpl?.icons.muteConvo) {
      const convoMuted = convoState.get(id) ?? !!t.legacy.conversation_muted;
      items.push({ icon: 'muteConvo', text: xText(convoMuted ? 'cd1942f4' : 'e2d6c17e', null, convoMuted ? 'Unmute this conversation' : 'Mute this conversation'),
        run: () => rest('POST', `mutes/conversations/${convoMuted ? 'destroy' : 'create'}`, { tweet_id: id }).then(() => {
          convoState.set(id, !convoMuted);
          toast(xText(convoMuted ? 'c13af432' : 'bbd8bed6'));
        }, fail) });
    }
    if (!own && uid) {
      const blocked = blockState.get(uid) ?? !!(rel.blocking ?? L.blocking);
      items.push({ icon: 'block', text: xText(blocked ? 'c9623eeb' : 'fcd4d489', { screenName: h }, `${blocked ? 'Unblock' : 'Block'} @${h}`),
        run: () => confirmDialog(
          xText(blocked ? 'fe40537f' : 'f9e45cfb', { screenName: h }, `${blocked ? 'Unblock' : 'Block'} @${h}?`),
          xText(blocked ? 'i58d8718' : 'ad00a739', { screenName: h }, ''),
          xText(blocked ? 'ea100d6a' : 'a6450e84', null, blocked ? 'Unblock' : 'Block'),
          () => rest('POST', `blocks/${blocked ? 'destroy' : 'create'}`, { user_id: uid }).then(() => {
            blockState.set(uid, !blocked);
            if (!blocked) toast(xText('a9fd20be'));
          }, fail)) });
    }
    items.push({ icon: 'engagements', text: tpl?.texts.engagements || xText('f0943340', null, 'View post engagements'),
      href: `/${h}/status/${id}/quotes` });
    items.push({ icon: 'embed', text: tpl?.texts.embed || xText('a0ff3524', null, 'Embed post'),
      href: `https://publish.x.com/?url=${encodeURIComponent(url)}`, external: true });
    if (uid) {
      items.push({ icon: 'report', text: tpl?.texts.report || xText('ebb7662a', null, 'Report post'),
        go: () => navigate('/i/safety/report_story_start', { input: { requested_variant: JSON.stringify({
          client_app_id: '3033300', client_location: 'tweet:conversation_descendants:tweet', client_referer: location.pathname,
          conversation_section: 'HighQuality', is_media: !!t.legacy.extended_entities?.media?.length, is_promoted: false,
          report_flow_id: crypto.randomUUID(), reported_tweet_id: id, reported_user_id: uid, source: 'reporttweet' }) } }) });
    }
    if (tpl?.icons.dsa) {
      items.push({ icon: 'dsa', text: tpl.texts.dsa || xText('e9eef4c6'), external: true,
        href: `https://help.twitter.com/forms/dsa/report?content_id=${encodeURIComponent(url)}&content_type=post&content_author=${encodeURIComponent('@' + h)}` });
    }
    if (tpl?.icons.noteWrite) items.push({ icon: 'noteWrite', text: tpl.texts.noteWrite, href: `/i/communitynotes/contribute/${id}` });
    if (tpl?.icons.noteRequest) items.push({ icon: 'noteRequest', text: tpl.texts.noteRequest, href: `/i/communitynotes/noterequest/${id}` });

    showMenu(buildMenu(tpl, items), anchor);
  }

  function buildMenu(tpl, items) {
    const menu = tpl ? tpl.menu.cloneNode(true) : el('div', 'xtt-pmenu-fallback');
    menu.classList.add('xtt-pmenu');
    menu.removeAttribute('style');
    // X' Menü wurde mitten in seiner Einblend-Animation kopiert (Höhe 0, unsichtbar): Endzustand herstellen
    for (const e of menu.querySelectorAll('[style]')) {
      for (const prop of ['height', 'opacity', 'will-change', 'transition-duration', 'transition-property']) e.style.removeProperty(prop);
    }
    const list = menu.querySelector('[data-testid="Dropdown"]') || menu;
    const divTpl = list.querySelector('div[role="menuitem"]');
    const aTpl = list.querySelector('a[role="menuitem"]') || divTpl;
    list.replaceChildren();
    for (const it of items) {
      let node;
      if (divTpl) {
        node = (it.href ? aTpl : divTpl).cloneNode(true);
        if (node.tagName !== 'A' && it.href) { // Link-Vorlage fehlt: Eintrag als Link nachbauen
          const a = document.createElement('a');
          a.className = node.className;
          a.setAttribute('role', 'menuitem');
          a.append(...node.childNodes);
          node = a;
        }
        node.removeAttribute('data-testid');
        const svg = node.querySelector('svg');
        if (svg) svg.replaceWith(it.svg || tpl.icons[it.icon]?.cloneNode(true) || el('span'));
        const span = node.querySelector('div[dir] span') || node.querySelector('span');
        if (span) span.textContent = it.text;
      } else {
        node = el(it.href ? 'a' : 'div', 'xtt-pmenu-item', it.text);
        node.setAttribute('role', 'menuitem');
      }
      if (it.href) {
        node.setAttribute('href', it.href);
        if (it.external) {
          node.target = '_blank';
          node.rel = 'noopener noreferrer';
        }
      }
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.go || it.run) e.preventDefault();
        closePostMenu();
        if (it.go) it.go();
        else if (it.run) it.run();
        else if (it.href && !it.external) {
          e.preventDefault();
          navigate(it.href);
        }
      });
      list.append(node);
    }
    return menu;
  }

  // --- 3b. Profilkarte beim Überfahren von Name oder Profilbild, nachgebaut nach X' eigener Karte ---
  // Wie X lädt sie das vollständige Konto (UserByScreenName) und „Gefolgt von …“ (friends/following/list) nach,
  // je Konto einmal pro Seitenaufruf. Bis dahin zeigt sie, was schon in der TweetDetail-Antwort steht.
  const CARD_OPEN_MS = 500;
  const CARD_CLOSE_MS = 300; // Zeit, um mit der Maus vom Namen in die Karte zu wechseln
  let profileCard = null; // höchstens eine Karte gleichzeitig, hängt an <body>
  let cardTimer = 0;
  const cardLoads = new Map(); // @handle -> Promise der nachgeladenen Daten
  const cardData = new Map(); // @handle -> { user, known }, sobald geladen
  const followState = new Map(); // Konto-ID -> 'none' | 'following' | 'pending' nach eigenem Klick

  function hideCard() {
    clearTimeout(cardTimer);
    profileCard?.remove();
    profileCard = null;
  }
  addEventListener('scroll', hideCard, { passive: true }); // die Karte steht fest im Fenster

  function loadCardData(handle) {
    if (!cardLoads.has(handle)) {
      const load = query('UserByScreenName', { screen_name: handle, withGrokTranslatedBio: false }, { withAuxiliaryUserLabels: false, withPayments: false })
        .then(async (data) => {
          const user = data?.user?.result?.__typename === 'User' ? data.user.result : null;
          const known = user?.rest_id
            ? await rest('GET', 'friends/following/list', { user_id: user.rest_id, count: 3, with_total_count: true, cursor: -1 }).catch(() => null)
            : null;
          cardData.set(handle, { user, known });
        });
      load.catch(() => cardLoads.delete(handle)); // beim nächsten Überfahren neu versuchen
      cardLoads.set(handle, load);
    }
    return cardLoads.get(handle);
  }

  // Felder liegen je nach Abfrage in legacy oder in den neueren Unterobjekten
  function profileInfo(p) {
    const L = p.legacy || {};
    const rel = p.relationship_perspectives || {};
    const type = p.verification?.verified_type ?? L.verified_type; // Business, Government
    const bioFromLegacy = !!L.description;
    return {
      id: p.rest_id,
      bio: bioFromLegacy ? L.description : p.profile_bio?.description,
      bioUrls: (bioFromLegacy ? L.entities : p.profile_bio?.entities)?.description?.urls || [],
      friends: L.friends_count ?? p.relationship_counts?.following,
      followers: L.followers_count ?? p.relationship_counts?.followers,
      following: rel.following ?? L.following,
      followedBy: rel.followed_by ?? L.followed_by,
      pending: p.follow_request_sent ?? L.follow_request_sent,
      protected: p.privacy?.protected ?? L.protected,
      type: type?.toLowerCase(),
      check: !!(p.is_blue_verified || type),
    };
  }

  const viewerId = () => document.cookie.match(/(?:^|;\s*)twid=u%3D(\d+)/)?.[1]; // eigenes Konto: kein Folgen-Button

  function fillCard(box, u) {
    const data = cardData.get(u.handle);
    const i = profileInfo(data?.user || u.profile);
    const fmt = (n) => new Intl.NumberFormat(lang(), n < 10000 ? {} : { notation: 'compact' }).format(n); // ab 10.000 gekürzt
    const parts = [];

    // Kopf: Profilbild links, Folgen-Button rechts
    const top = el('div', 'xtt-card-top');
    const avatar = el('img', 'xtt-card-avatar');
    if (u.avatar) avatar.src = u.avatar.replace('_normal.', '_200x200.');
    avatar.alt = '';
    const avatarLink = link('', `/${u.handle}`);
    avatarLink.append(avatar);
    top.append(avatarLink);
    if (i.id && i.id !== viewerId()) top.append(followButton(box, u, i));
    parts.push(top);

    // Name mit Haken, darunter @handle und „Folgt dir“
    const names = el('div', 'xtt-card-names');
    const name = link('', `/${u.handle}`);
    name.className = 'xtt-card-name';
    name.append(el('strong', null, u.name));
    if (i.check) name.append(' ', el('span', `xtt-check xtt-check-${i.type || 'blue'}`, '✓'));
    const handle = el('div', 'xtt-card-handle');
    handle.append(link('@' + u.handle, `/${u.handle}`));
    if (i.followedBy) handle.append(' ', el('span', 'xtt-card-follows', msg('followsYou')));
    names.append(name, handle);
    parts.push(names);

    if (i.bio) parts.push(appendLinked(el('div', 'xtt-card-bio'), decode(i.bio), i.bioUrls));

    if (i.friends != null && i.followers != null) {
      const counts = el('div', 'xtt-card-counts');
      for (const [n, key] of [[i.friends, 'following'], [i.followers, 'followers']]) {
        const a = link('', `/${u.handle}/${key}`);
        a.append(el('strong', null, fmt(n)), ' ', el('span', 'xtt-muted', msg(key)));
        counts.append(a);
      }
      parts.push(counts);
    }

    // „Gefolgt von …“: Konten, denen du folgst und die diesem Konto folgen
    const known = data?.known;
    const knownUsers = (known?.users || []).filter((k) => k.name && k.profile_image_url_https);
    if (known?.total_count > 0 && knownUsers.length) {
      const row = link('', `/${u.handle}/followers_you_follow`);
      row.className = 'xtt-card-known';
      const faces = el('span', 'xtt-card-faces');
      for (const k of knownUsers.slice(0, 3)) {
        const img = el('img');
        img.src = k.profile_image_url_https;
        img.alt = '';
        faces.append(img);
      }
      row.append(faces, el('span', 'xtt-muted', knownText(knownUsers.map((k) => k.name), known.total_count)));
      parts.push(row);
    }

    // „Kurzprofil“: öffnet wie bei X die Grok-Seitenleiste mit „@handle“ (Rückfall: Grok in neuem Tab).
    // Wie bei X nicht für geschützte Konten und Firmen- oder Behördenkonten.
    if (data?.user && !i.protected && !i.type) {
      const fallback = `/i/grok?text=${encodeURIComponent('@' + u.handle)}`;
      const grok = link('', fallback, true);
      grok.className = 'xtt-card-grok';
      grok.addEventListener('click', (e) => {
        e.preventDefault();
        hideCard();
        openGrok({ text: '@' + u.handle, autoSubmit: true, source: 'user_profile_summary' }, fallback);
      });
      const icon = document.querySelector('nav a[href="/i/grok"] svg');
      if (icon) grok.append(icon.cloneNode(true));
      grok.append(el('span', null, msg('profileSummary')));
      parts.push(grok);
    }

    box.replaceChildren(...parts);
  }

  function knownText(names, total) {
    const [a, b, c] = names;
    if (total > 3 && b) return msg('followedByMore', { a, b, n: new Intl.NumberFormat(lang()).format(total - 2) });
    if (c) return msg('followedBy3', { a, b, c });
    if (b) return msg('followedBy2', { a, b });
    return msg('followedBy1', { a });
  }

  // Folgen-Button mit X' Zuständen; Entfolgen und Anfrage verwerfen erst nach Rückfrage
  function followButton(box, u, i) {
    const b = el('button', 'xtt-follow');
    let state = followState.get(i.id) ?? (i.pending ? 'pending' : i.following ? 'following' : 'none');
    const show = (hover) => {
      b.className = `xtt-follow xtt-follow-${state}${hover && state === 'following' ? ' xtt-unfollow' : ''}`; // rot nur mit „Entfolgen“
      b.textContent = state === 'pending' ? msg('pending')
        : state === 'following' ? msg(hover ? 'unfollow' : 'followingBtn')
          : msg(i.followedBy ? 'followBack' : 'follow');
    };
    const showError = (err) => {
      box.querySelector('.xtt-card-error')?.remove();
      box.append(el('div', 'xtt-muted xtt-card-error', '⚠ ' + err.message));
    };
    async function run(endpoint, next) {
      b.disabled = true;
      try {
        await rest('POST', endpoint, { user_id: i.id });
        state = next;
        followState.set(i.id, next);
      } catch (err) {
        showError(err);
      }
      b.disabled = false;
      show(false);
    }
    b.addEventListener('mouseenter', () => show(true));
    b.addEventListener('mouseleave', () => show(false));
    b.addEventListener('click', (e) => {
      e.preventDefault();
      if (b.disabled) return;
      if (state === 'none') return run('friendships/create', i.protected ? 'pending' : 'following');
      // Rückfrage wie bei X, hier direkt in der Karte
      box.querySelector('.xtt-card-confirm')?.remove();
      const confirm = el('div', 'xtt-card-confirm');
      const question = state === 'following' ? msg('unfollowConfirm', { handle: u.handle }) : msg('cancelRequest');
      const yes = el('button', 'xtt-follow xtt-follow-none', msg(state === 'following' ? 'unfollow' : 'discard'));
      const no = el('button', 'xtt-follow xtt-follow-following', msg('cancel'));
      yes.addEventListener('click', () => {
        confirm.remove();
        run(state === 'following' ? 'friendships/destroy' : 'friendships/cancel', 'none');
      });
      no.addEventListener('click', () => confirm.remove());
      const row = el('div', 'xtt-card-confirm-row');
      row.append(no, yes);
      confirm.append(el('div', null, question), row);
      box.append(confirm);
    });
    show(false);
    return b;
  }

  // unter den Namen, oder darüber, wenn unten kein Platz ist
  function placeCard(box, trigger) {
    const r = trigger.getBoundingClientRect();
    const h = box.offsetHeight;
    box.style.top = `${r.bottom + 6 + h <= innerHeight ? r.bottom + 6 : Math.max(6, r.top - 6 - h)}px`;
    box.style.left = `${Math.max(6, Math.min(r.left, innerWidth - box.offsetWidth - 6))}px`;
  }

  function showCard(trigger, u) {
    if (profileCard?.owner === trigger || !trigger.isConnected) return;
    hideCard();
    const box = el('div', 'xtt-card');
    box.owner = trigger;
    // Farben wie die Thread-Ansicht bzw. X' Farbschema (Hell, Gedimmt, Dunkel); der Folgen-Button kehrt sie um
    const fg = getComputedStyle(trigger.closest('.xtt-thread') || trigger).color;
    const bg = getComputedStyle(document.body).backgroundColor;
    box.style.setProperty('--xtt-fg', fg);
    if (bg !== 'rgba(0, 0, 0, 0)') box.style.setProperty('--xtt-bg', bg);
    box.addEventListener('mouseenter', () => clearTimeout(cardTimer));
    box.addEventListener('mouseleave', () => {
      cardTimer = setTimeout(hideCard, CARD_CLOSE_MS);
    });
    box.addEventListener('click', (e) => {
      if (e.target.closest('a')) hideCard(); // Link geöffnet
    });
    fillCard(box, u);
    document.body.append(box);
    profileCard = box;
    placeCard(box, trigger);
    if (!cardData.has(u.handle)) {
      loadCardData(u.handle).then(() => {
        if (profileCard !== box) return;
        fillCard(box, u);
        placeCard(box, trigger);
      }, () => {}); // ohne Nachladen bleibt die Karte mit den vorhandenen Angaben
    }
  }

  function withCard(trigger, u) {
    trigger.addEventListener('mouseenter', () => {
      clearTimeout(cardTimer);
      cardTimer = setTimeout(() => showCard(trigger, u), CARD_OPEN_MS);
    });
    trigger.addEventListener('mouseleave', () => {
      clearTimeout(cardTimer);
      cardTimer = setTimeout(hideCard, CARD_CLOSE_MS);
    });
    trigger.addEventListener('click', hideCard);
  }

  function renderTweet(t) {
    const tpl = nativeTemplate();
    if (tpl) {
      try {
        return renderNative(t, tpl);
      } catch (e) { /* Vorlage anders aufgebaut als erwartet: einfache Darstellung */ }
    }
    const u = userOf(t);
    const card = el('div', 'xtt-tweet');
    card.dataset.tid = t.rest_id; // damit X' eigene Kopie desselben Beitrags ausgeblendet werden kann
    const avatar = el('img', 'xtt-avatar');
    if (u.avatar) avatar.src = u.avatar;
    avatar.alt = '';
    const body = el('div', 'xtt-body');
    const head = el('div', 'xtt-head');
    const time = new Date(t.legacy.created_at).toLocaleString(lang(), { dateStyle: 'short', timeStyle: 'short' });
    const timeLink = link(time, `/${u.handle}/status/${t.rest_id}`);
    timeLink.className = 'xtt-muted';
    const avatarLink = link('', `/${u.handle}`);
    avatarLink.append(avatar);
    const userLink = link('', `/${u.handle}`);
    userLink.className = 'xtt-user';
    userLink.append(el('strong', null, u.name), el('span', 'xtt-muted', ` @${u.handle}`));
    withCard(avatarLink, u);
    withCard(userLink, u);
    head.append(userLink, el('span', 'xtt-muted', ' · '), timeLink);
    body.append(head, renderText(t), ...renderMedia(t), ...renderQuote(t), ...renderActions(t, u));
    card.append(avatarLink, body);
    return card;
  }

  // Symbole aus X' eigener Aktionsleiste klonen, damit es wie bei X aussieht
  const ICON_TESTID = { reply: 'reply', retweet: 'retweet', like: 'like', bookmark: 'bookmark' };
  const ICON_TESTID_ON = { retweet: 'unretweet', like: 'unlike', bookmark: 'removeBookmark' };
  const ICON_FALLBACK = { reply: '💬', retweet: '🔁', like: '♥', views: '📊', bookmark: '🔖', share: '⤴' };
  const iconCache = {};
  function icon(name, on) {
    const key = name + (on ? '-on' : '');
    if (!iconCache[key]) {
      let svg = on && ICON_TESTID_ON[name] && document.querySelector(`article [data-testid="${ICON_TESTID_ON[name]}"] svg`);
      svg ||= ICON_TESTID[name] && document.querySelector(`article [data-testid="${ICON_TESTID[name]}"] svg`);
      if (!svg && name === 'views') svg = document.querySelector('article [role="group"] a[href$="/analytics"] svg');
      if (!svg && name === 'share') svg = [...(document.querySelector('article [role="group"]')?.querySelectorAll('button svg') || [])].at(-1);
      if (!svg) return el('span', null, ICON_FALLBACK[name]);
      iconCache[key] = svg.cloneNode(true);
    }
    return iconCache[key].cloneNode(true);
  }

  // Antworten · Reposten · Gefällt mir · Aufrufe · Lesezeichen · Teilen
  // Zähler in X' Struktur setzen (span > span > span); bei 0 fehlt der innere span in X' Vorlage
  function setCount(box, n) {
    const outer = box.firstElementChild || box;
    let inner = outer.firstElementChild;
    const text = xCount(n);
    if (!inner && text) {
      inner = document.createElement('span');
      inner.className = document.querySelector('[role="group"] [data-testid="app-text-transition-container"] span span')?.className || '';
      outer.append(inner);
    }
    if (inner) inner.textContent = text;
  }

  function renderActions(t, u, group) {
    const L = t.legacy;
    const id = t.rest_id;
    const url = `https://x.com/${u.handle}/status/${id}`;
    const bar = group || el('div', 'xtt-actions');
    const extra = el('div', 'xtt-extra'); // Platz für Antwortfeld, Repost-Menü und Fehlermeldungen
    const fmt = xCount;
    const showError = (err) => extra.replaceChildren(el('div', 'xtt-muted', '⚠ ' + err.message));

    // X' eigener Button aus der geklonten Leiste: Kennung, Symbol, Farbe und Zähler schalten wie bei X um
    const TESTIDS = { reply: ['reply', 'reply'], retweet: ['retweet', 'unretweet'], like: ['like', 'unlike'], bookmark: ['bookmark', 'removeBookmark'] };
    const ACTIVE = { retweet: 'rgb(0, 186, 124)', like: 'rgb(249, 24, 128)', bookmark: 'rgb(29, 155, 240)' };
    function adopt(name, label, count, on) {
      const b = (name === 'share' ? [...group.querySelectorAll('button')].at(-1)
        : group.querySelector(TESTIDS[name].map((x) => `[data-testid="${x}"]`).join(', '))) || el('button');
      const tint = b.querySelector('div[dir]');
      const base = tint?.style.color || '';
      const counter = b.querySelector('[data-testid="app-text-transition-container"]');
      b.state = { on: !!on, count };
      b.show = (s) => {
        if (TESTIDS[name]) b.dataset.testid = TESTIDS[name][s.on ? 1 : 0];
        if (name !== 'share') b.querySelector('svg')?.replaceWith(icon(name, s.on));
        if (tint) tint.style.color = s.on && ACTIVE[name] ? ACTIVE[name] : base;
        if (counter) setCount(counter, s.count);
      };
      b.show(b.state);
      return b;
    }

    function button(name, label, count, on) {
      if (group) return adopt(name, label, count, on);
      const b = el('button', `xtt-act xtt-${name}`);
      const c = el('span', null, fmt(count));
      b.title = label;
      b.append(icon(name, on), c);
      b.classList.toggle('xtt-on', !!on);
      b.state = { on: !!on, count };
      b.show = (s) => {
        b.classList.toggle('xtt-on', s.on);
        b.firstChild.replaceWith(icon(name, s.on));
        c.textContent = fmt(s.count);
      };
      return b;
    }

    // Anzeige sofort umschalten, bei Fehler zurück
    async function flip(b, run) {
      if (b.busy) return;
      b.busy = true;
      const next = { on: !b.state.on, count: b.state.count + (b.state.on ? -1 : 1) };
      b.show(next);
      try {
        await run(next.on);
        b.state = next;
      } catch (err) {
        b.show(b.state);
        showError(err);
      }
      b.busy = false;
    }

    function openComposer(mode) {
      const box = el('div', 'xtt-composer');
      const ta = el('textarea');
      ta.rows = 3;
      ta.placeholder = mode === 'reply' ? msg('replyTo', { handle: u.handle }) : msg('quotePlaceholder');
      ta.addEventListener('keydown', (e) => e.stopPropagation()); // X' Tastenkürzel nicht auslösen
      const send = el('button', 'xtt-send', mode === 'reply' ? msg('reply') : msg('post'));
      const cancel = el('button', 'xtt-toggle', msg('cancel'));
      const row = el('div', 'xtt-composer-row');
      row.append(cancel, send);
      box.append(ta, row);
      cancel.addEventListener('click', (e) => {
        e.stopPropagation();
        extra.replaceChildren();
      });
      send.addEventListener('click', async (e) => {
        e.stopPropagation();
        const text = ta.value.trim();
        if (!text || send.disabled) return;
        send.disabled = true;
        send.textContent = msg('sending');
        // Aufbau wie in X' eigenem CreateTweet-Aufruf
        const vars = { tweet_text: text, media: { media_entities: [], possibly_sensitive: false }, semantic_annotation_ids: [] };
        if (mode === 'reply') vars.reply = { in_reply_to_tweet_id: id, exclude_reply_user_ids: [] };
        else vars.attachment_url = url;
        try {
          const data = await mutate('CreateTweet', vars);
          const posted = unwrap(data?.create_tweet?.tweet_results?.result);
          extra.replaceChildren(el('div', 'xtt-muted', mode === 'reply' ? msg('yourReply') : msg('yourQuote')));
          if (posted) extra.append(renderTweet(posted));
          if (mode === 'reply') reply.show((reply.state = { on: false, count: reply.state.count + 1 }));
        } catch (err) {
          send.disabled = false;
          send.textContent = msg('retry');
          box.append(el('div', 'xtt-muted', '⚠ ' + err.message));
        }
      });
      extra.replaceChildren(box);
      ta.focus();
    }

    const reply = button('reply', msg('reply'), L.reply_count, false);
    reply.addEventListener('click', (e) => {
      e.stopPropagation();
      openComposer('reply');
    });

    const retweet = button('retweet', msg('repost'), L.retweet_count, L.retweeted);
    const repost = () => flip(retweet, (on) => mutate(on ? 'CreateRetweet' : 'DeleteRetweet', on ? { tweet_id: id } : { source_tweet_id: id }));
    retweet.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (postMenu?.anchor === retweet) return closePostMenu();
      if (group) { // X' Menü: Reposten bzw. rückgängig machen, Zitieren
        const tpl = await harvestMenu();
        if (tpl) {
          return showMenu(buildMenu(tpl, [
            { svg: icon('retweet', false), text: retweet.state.on ? xText('fd1e5446', null, msg('undoRepost')) : xText('f2919fb8', null, msg('repost')), run: repost },
            { svg: el('span'), text: xText('a18aff23', { verb: '' }, msg('quote')), run: () => openComposer('quote') },
          ]), retweet);
        }
      }
      const menu = el('div', 'xtt-menu'); // Zwischenschritt wie bei X – ein Repost ist öffentlich
      const toggle = el('button', 'xtt-toggle', retweet.state.on ? msg('undoRepost') : msg('repost'));
      const quote = el('button', 'xtt-toggle', msg('quote'));
      toggle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        extra.replaceChildren();
        repost();
      });
      quote.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openComposer('quote');
      });
      menu.append(toggle, quote);
      extra.replaceChildren(menu);
    });

    const like = button('like', msg('like'), L.favorite_count, L.favorited);
    like.addEventListener('click', (e) => {
      e.stopPropagation();
      flip(like, (on) => mutate(on ? 'FavoriteTweet' : 'UnfavoriteTweet', { tweet_id: id }));
    });

    let views = group?.querySelector('a[href$="/analytics"]');
    if (views) {
      views.setAttribute('href', `/${u.handle}/status/${id}/analytics`);
      const counter = views.querySelector('[data-testid="app-text-transition-container"]');
      if (counter) setCount(counter, Number(t.views?.count));
    } else {
      views = link('', `/${u.handle}/status/${id}/analytics`);
      views.className = 'xtt-act xtt-views';
      views.title = msg('views');
      views.append(icon('views'), el('span', null, fmt(Number(t.views?.count))));
    }

    const bookmark = button('bookmark', msg('bookmark'), L.bookmark_count, L.bookmarked);
    bookmark.addEventListener('click', (e) => {
      e.stopPropagation();
      flip(bookmark, (on) => mutate(on ? 'CreateBookmark' : 'DeleteBookmark', { tweet_id: id }));
    });

    const share = button('share', msg('share'), 0, false);
    const copy = async () => toast(await navigator.clipboard.writeText(url).then(() => msg('copied'), () => msg('copyFailed')));
    share.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (postMenu?.anchor === share) return closePostMenu();
      const tpl = group && (await harvestMenu());
      if (!tpl) return copy();
      const items = [{ svg: icon('share'), text: msg('share'), run: copy }];
      showMenu(buildMenu(tpl, items), share);
    });

    if (!group) bar.append(reply, retweet, like, views, bookmark, share);
    return [bar, extra];
  }

  // --- 4. Knoten = Button + aufklappbare Antwortliste unter einem Beitrag ---
  function createNode(tweetId, replyCount) {
    const wrap = el('div', 'xtt-thread');
    const btn = el('button', 'xtt-toggle');
    const list = el('div', 'xtt-replies');
    list.hidden = true;
    let loaded = false;
    let shown = 0;

    const label = () => {
      btn.textContent = list.hidden
        ? `▸ ${msg('showReplies')} (${replyCount})`
        : `▾ ${msg('hideReplies')}`;
    };

    function renderReplies(replies, cursor) {
      const children = [];
      for (const t of replies) {
        const item = el('div', 'xtt-item');
        item.append(renderTweet(t));
        if (t.legacy.reply_count > 0) {
          const child = createNode(t.rest_id, t.legacy.reply_count);
          item.append(child.el);
          children.push(child);
        }
        list.append(item);
      }
      shown += replies.length;
      if (cursor && replies.length && shown < replyCount) { // X liefert auch am Ende noch einen Cursor
        const more = el('button', 'xtt-toggle', msg('loadMore'));
        more.addEventListener('click', async (e) => {
          e.stopPropagation();
          more.disabled = true;
          more.textContent = msg('loading');
          try {
            const next = await fetchReplies(tweetId, cursor);
            more.remove();
            renderReplies(next.replies, next.cursor || next.spamCursor);
          } catch (err) {
            more.disabled = false;
            more.textContent = '⚠ ' + err.message;
          }
        });
        list.append(more);
      }
      return children;
    }

    const node = {
      el: wrap,
      // Klappt auf, lädt beim ersten Mal und gibt die Kind-Knoten mit eigenen Antworten zurück
      async load() {
        list.hidden = false;
        label();
        if (loaded) return [];
        loaded = true;
        list.replaceChildren(el('div', 'xtt-muted', msg('loading')));
        try {
          let { replies, cursor, spamCursor } = await fetchReplies(tweetId);
          // als „wahrscheinlich Spam“ zurückgehaltene Antworten gleich mitladen
          for (let i = 0; spamCursor && spamEnabled() && i < MAX_SPAM_PAGES && rateRemaining > RATE_RESERVE; i++) {
            const more = await fetchReplies(tweetId, spamCursor);
            replies = replies.concat(more.replies);
            spamCursor = more.spamCursor;
          }
          list.replaceChildren();
          if (!replies.length) list.append(el('div', 'xtt-muted', msg('noReplies')));
          return renderReplies(replies, cursor || spamCursor);
        } catch (err) {
          loaded = false;
          list.replaceChildren(el('div', 'xtt-muted', '⚠ ' + err.message));
          return [];
        }
      },
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!loaded) return expandAll(node);
      list.hidden = !list.hidden;
      label();
      requestScan(); // Ein-/Ausklappen ändert nur ein Attribut, das löst keinen Durchlauf aus
    });

    label();
    wrap.append(btn, list);
    return node;
  }

  // Ebene für Ebene aufklappen, bis das Anfrage-Budget aufgebraucht ist
  async function expandAll(root) {
    const queue = [root];
    for (let budget = MAX_REQUESTS_PER_CLICK; queue.length && budget > 0; budget--) {
      queue.push(...(await queue.shift().load()));
    }
  }

  // --- 5. Automatisch aufklappen (Einstellung im Popup, kommt über bridge.js als data-Attribut an <html>) ---
  let autoPath = null;
  let autoVisible = []; // hereingescrollte Antworten – haben Vorrang
  let autoQueue = []; // tiefere Ebenen
  let autoBudget = 0;
  let autoRunning = false;
  const autoQueued = new Set();

  function autoEnqueue(id, node) {
    if (location.pathname !== autoPath) { // neuer Beitrag geöffnet: frisches Budget
      autoPath = location.pathname;
      autoVisible = [];
      autoQueue = [];
      autoQueued.clear();
      autoBudget = AUTO_REQUESTS_PER_POST;
    }
    if (autoQueued.has(id)) return;
    autoQueued.add(id);
    autoVisible.push(node);
    runAuto();
  }

  async function runAuto() {
    if (autoRunning) return;
    autoRunning = true;
    const path = autoPath;
    while (autoPath === path && (autoVisible.length || autoQueue.length) && autoBudget > 0 && rateRemaining > RATE_RESERVE) {
      autoBudget--;
      const children = await (autoVisible.shift() || autoQueue.shift()).load();
      if (autoPath === path) autoQueue.push(...children); // nach Seitenwechsel nicht in die neue Warteschlange mischen
    }
    autoRunning = false;
    if (autoPath !== path) runAuto(); // während des Ladens wurde ein anderer Beitrag geöffnet
  }

  // --- 6. X' Button „Wahrscheinlichen Spam anzeigen“ selbst anklicken ---
  // X' eigene TweetDetail-Antworten verraten, ob X Antworten als Spam zurückhält (Cursor „ShowMoreThreads“)
  let spamPath = null; // Beitrag, für den X gerade Spam zurückhält
  let spamClickPath = null; // Beitrag, auf den sich spamClicks bezieht
  let spamClicks = 0;
  function onXTweetDetail() {
    const remaining = this.getResponseHeader('x-rate-limit-remaining');
    if (remaining !== null) rateRemaining = Number(remaining);
    try {
      if (/"cursorType":"ShowMoreThreads/.test(this.responseText)) spamPath = location.pathname;
    } catch (e) { /* Antwort nicht als Text lesbar */ }
  }

  function clickSpamButton() {
    if (spamPath !== location.pathname) return;
    if (spamClickPath !== location.pathname) {
      spamClickPath = location.pathname;
      spamClicks = 0;
    }
    if (spamClicks >= MAX_SPAM_CLICKS || rateRemaining <= RATE_RESERVE) return;
    // Der Button ist die letzte Zelle der Liste: kein Beitrag, genau ein Button, kein data-testid (Text ist sprachabhängig)
    const cell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].filter((c) => c.textContent.trim()).at(-1);
    const buttons = cell && !cell.querySelector('article') ? cell.querySelectorAll('button[role="button"]') : [];
    if (buttons.length !== 1 || buttons[0].dataset.testid) return;
    spamPath = null; // erst die nächste Antwort von X entscheidet, ob noch mehr Spam zurückgehalten wird
    spamClicks++;
    buttons[0].click();
  }

  // --- 7. Buttons an die Antworten auf Statusseiten hängen ---
  const nodes = new Map(); // tweetId -> Knoten; bleibt erhalten, wenn X Zellen beim Scrollen neu aufbaut
  let confirmedPath = null; // Pfad, dessen Hauptbeitrag X bereits angezeigt hat

  function tweetIdOf(article) {
    const a = article.querySelector('a[href*="/status/"] time')?.closest('a');
    return a?.getAttribute('href').match(/\/status\/(\d+)/)?.[1];
  }

  function replyCountOf(article) {
    const label = article.querySelector('[data-testid="reply"]')?.getAttribute('aria-label') || '';
    return parseInt((label.match(/[\d.,]+/)?.[0] || '0').replace(/[.,]/g, ''), 10);
  }

  function scan() {
    const pathId = location.pathname.match(/\/status\/(\d+)/)?.[1];
    if (!pathId) return;
    if (spamEnabled()) clickSpamButton();
    // Beim Runterscrollen baut X den Hauptbeitrag oben ab – dann liegt alles Sichtbare unter ihm
    const focal = document.querySelector('article[data-testid="tweet"][tabindex="-1"]');
    if (focal && tweetIdOf(focal) === pathId) confirmedPath = location.pathname;
    // erst automatisch laden, wenn X nach einem Seitenwechsel wirklich den neuen Beitrag gezeigt hat
    const auto = document.documentElement.dataset.xttAutoExpand === '1' && confirmedPath === location.pathname;
    for (const article of document.querySelectorAll('article[data-testid="tweet"][tabindex="0"]')) {
      if (focal && !(focal.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING)) continue; // Vorgänger überspringen
      const id = tweetIdOf(article);
      const count = replyCountOf(article);
      let node = id && count ? nodes.get(id) : null;
      if (id && count && !node) {
        node = createNode(id, count);
        node.el.style.color = getComputedStyle(article.querySelector('[data-testid="User-Name"]') || article).color;
        nodes.set(id, node);
      }
      // X verwendet Zellen für andere Beiträge wieder: Knoten des vorherigen Beitrags aus der Zelle nehmen
      for (const stale of article.parentElement.querySelectorAll(':scope > .xtt-thread')) {
        if (stale !== node?.el) stale.remove();
      }
      if (!node) continue;
      if (article.nextElementSibling !== node.el) article.after(node.el);
      if (auto) autoEnqueue(id, node);
    }
    hideNativeDuplicates();
  }

  // X zeigt Antworten auf eine Antwort manchmal selbst als Kette direkt darunter. Solange dieselben Beiträge
  // in einer aufgeklappten Thread-Ansicht stehen, wird X' Zelle ausgeblendet, sonst stünden sie doppelt da.
  function hideNativeDuplicates() {
    const inTree = new Set();
    for (const card of document.querySelectorAll('.xtt-replies [data-tid]')) {
      if (card.offsetParent !== null) inTree.add(card.dataset.tid); // nur sichtbar aufgeklappte
    }
    // X verwendet Zellen für andere Beiträge wieder: auch schon ausgeblendete Zellen jedes Mal neu prüfen
    const cells = new Set(document.querySelectorAll('[data-xtt-dup]'));
    for (const article of document.querySelectorAll('article[data-testid="tweet"][tabindex="0"]')) {
      const cell = article.closest('[data-testid="cellInnerDiv"]');
      if (cell) cells.add(cell);
    }
    for (const cell of cells) {
      const article = cell.querySelector('article[data-testid="tweet"][tabindex="0"]');
      const dup = !!article && !article.closest('.xtt-thread') && inTree.has(tweetIdOf(article));
      if (dup) cell.dataset.xttDup = '1';
      else delete cell.dataset.xttDup;
    }
  }

  let scheduled = false;
  function requestScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }
  new MutationObserver(requestScan).observe(document.documentElement, { childList: true, subtree: true });
})();
