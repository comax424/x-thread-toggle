// X Thread-Ansicht: blendet unter jeder Antwort deren komplette Unterhaltung ein und aus.
// Läuft im Seitenkontext (world: MAIN), damit es X' eigene TweetDetail-Anfrage mitlesen kann.
(() => {
  'use strict';

  const MAX_REQUESTS_PER_CLICK = 15; // schont X' Rate-Limit; tiefere Äste bleiben per Button ladbar
  const AUTO_REQUESTS_PER_POST = 80; // Budget fürs automatische Aufklappen je geöffnetem Beitrag
  const RATE_RESERVE = 50; // X erlaubt 300 TweetDetail-Abfragen / 15 Min.; der Rest bleibt für X selbst
  let rateRemaining = Infinity;

  // --- 1. X' eigene TweetDetail-Anfrage mitlesen (queryId, Feature-Flags, Sitzungs-Header) ---
  let template = null;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._xttUrl = String(url);
    this._xttHeaders = {};
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
    if (!template) throw new Error('Bitte die Seite einmal neu laden (F5).');
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
    if (res.status === 429) throw new Error('X-Limit erreicht – in ein paar Minuten erneut versuchen.');
    if (!res.ok) throw new Error('X antwortet mit Fehler ' + res.status);
    return parseReplies(await res.json(), tweetId);
  }

  // --- 2b. Schreibende Aktionen (Like, Repost, Lesezeichen, Antworten) ---
  // X verlangt dafür eine x-client-transaction-id; die erzeugt X' eigener Generator aus dem Webpack-Bundle.
  let txGen = null;
  function transactionId(path) {
    if (!txGen) {
      let req;
      window.webpackChunk_twitter_responsive_web.push([[Symbol('xtt')], {}, (r) => { req = r; }]);
      txGen = Object.keys(req.m)
        .filter((id) => {
          const src = req.m[id].toString();
          return src.includes('jf.x.com') && src.includes('x-client-transaction-id');
        })
        .flatMap((id) => Object.values(req(id)))
        .find((f) => typeof f === 'function' && f.length === 3); // (host, path, method)
      if (!txGen) throw new Error('X hat seinen Code geändert – Aktion gerade nicht möglich.');
    }
    return txGen('https://x.com', path, 'POST');
  }

  // queryId und Feature-Flags einer Aktion stehen im Haupt-Bundle von X
  let bundle = null;
  async function operation(name) {
    bundle ??= fetch([...document.scripts].map((s) => s.src).find((s) => /\/client-web\/main\.[^/]+\.js$/.test(s)))
      .then((r) => r.text());
    const m = (await bundle).match(new RegExp(`queryId:"([^"]+)",operationName:"${name}",operationType:"mutation",metadata:\\{featureSwitches:\\[([^\\]]*)\\]`));
    if (!m) throw new Error('X hat seinen Code geändert – Aktion gerade nicht möglich.');
    return { queryId: m[1], features: m[2] ? m[2].replace(/"/g, '').split(',') : [] };
  }

  async function mutate(name, variables) {
    if (!template) throw new Error('Bitte die Seite einmal neu laden (F5).');
    const op = await operation(name);
    const path = `/i/api/graphql/${op.queryId}/${name}`;
    const body = { variables, queryId: op.queryId };
    if (op.features.length) { // Werte wie in X' eigener TweetDetail-Anfrage
      const known = JSON.parse(new URL(template.url, location.origin).searchParams.get('features') || '{}');
      body.features = Object.fromEntries(op.features.map((f) => [f, known[f] ?? false]));
    }
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { ...template.headers, 'content-type': 'application/json', 'x-client-transaction-id': await transactionId(path) },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.errors?.length) throw new Error(json?.errors?.[0]?.message || 'X antwortet mit Fehler ' + res.status);
    return json.data;
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
    for (const ins of instructions) {
      for (const entry of ins.entries || []) {
        const c = entry.content;
        if (c.entryType === 'TimelineTimelineCursor') {
          if (c.cursorType !== 'Top') cursor = c.value;
          continue;
        }
        if (c.itemContent?.itemType === 'TimelineTimelineCursor') {
          cursor = c.itemContent.value; // „Weitere Antworten anzeigen“
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
    return { replies, cursor };
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
    const byShort = new Map(urls.map((u) => [u.url, u]));
    const mediaLinks = new Set((t.legacy.entities?.media || []).map((m) => m.url));
    let last = 0;
    for (const m of text.matchAll(/https:\/\/t\.co\/\w+/g)) {
      box.append(text.slice(last, m.index));
      last = m.index + m[0].length;
      if (mediaLinks.has(m[0])) continue;
      const u = byShort.get(m[0]);
      box.append(link(u?.display_url || m[0], u?.expanded_url || m[0], true));
    }
    box.append(text.slice(last));
    return box;
  }

  function renderMedia(t) {
    const media = t.legacy.extended_entities?.media || [];
    if (!media.length) return [];
    const box = el('div', 'xtt-media');
    for (const m of media) {
      const a = link('', m.expanded_url);
      if (m.type !== 'photo') a.className = 'xtt-video';
      const img = el('img');
      img.src = m.media_url_https + '?name=small';
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
    a.append(el('strong', null, u.name), el('span', 'xtt-muted', ' @' + u.handle), el('div', 'xtt-quote-text', decode(q.legacy.full_text)));
    return [a];
  }

  function renderTweet(t) {
    const u = userOf(t);
    const card = el('div', 'xtt-tweet');
    const avatar = el('img', 'xtt-avatar');
    if (u.avatar) avatar.src = u.avatar;
    avatar.alt = '';
    const body = el('div', 'xtt-body');
    const head = el('div', 'xtt-head');
    const time = new Date(t.legacy.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    const timeLink = link(time, `/${u.handle}/status/${t.rest_id}`);
    timeLink.className = 'xtt-muted';
    const avatarLink = link('', `/${u.handle}`);
    avatarLink.append(avatar);
    const userLink = link('', `/${u.handle}`);
    userLink.className = 'xtt-user';
    userLink.append(el('strong', null, u.name), el('span', 'xtt-muted', ` @${u.handle}`));
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
  function renderActions(t, u) {
    const L = t.legacy;
    const id = t.rest_id;
    const url = `https://x.com/${u.handle}/status/${id}`;
    const bar = el('div', 'xtt-actions');
    const extra = el('div'); // Platz für Antwortfeld, Repost-Menü und Fehlermeldungen
    const fmt = (n) => (n > 0 ? new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n) : '');
    const showError = (err) => extra.replaceChildren(el('div', 'xtt-muted', '⚠ ' + err.message));

    function button(name, label, count, on) {
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
      ta.placeholder = mode === 'reply' ? `Antwort an @${u.handle}` : 'Kommentar zum Zitat';
      ta.addEventListener('keydown', (e) => e.stopPropagation()); // X' Tastenkürzel nicht auslösen
      const send = el('button', 'xtt-send', mode === 'reply' ? 'Antworten' : 'Posten');
      const cancel = el('button', 'xtt-toggle', 'Abbrechen');
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
        send.textContent = 'Sende …';
        // Aufbau wie in X' eigenem CreateTweet-Aufruf
        const vars = { tweet_text: text, media: { media_entities: [], possibly_sensitive: false }, semantic_annotation_ids: [] };
        if (mode === 'reply') vars.reply = { in_reply_to_tweet_id: id, exclude_reply_user_ids: [] };
        else vars.attachment_url = url;
        try {
          const data = await mutate('CreateTweet', vars);
          const posted = unwrap(data?.create_tweet?.tweet_results?.result);
          extra.replaceChildren(el('div', 'xtt-muted', mode === 'reply' ? '✓ Deine Antwort:' : '✓ Dein Zitat:'));
          if (posted) extra.append(renderTweet(posted));
          if (mode === 'reply') reply.show((reply.state = { on: false, count: reply.state.count + 1 }));
        } catch (err) {
          send.disabled = false;
          send.textContent = 'Erneut senden';
          box.append(el('div', 'xtt-muted', '⚠ ' + err.message));
        }
      });
      extra.replaceChildren(box);
      ta.focus();
    }

    const reply = button('reply', 'Antworten', L.reply_count, false);
    reply.addEventListener('click', (e) => {
      e.stopPropagation();
      openComposer('reply');
    });

    const retweet = button('retweet', 'Reposten', L.retweet_count, L.retweeted);
    retweet.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = el('div', 'xtt-menu'); // Zwischenschritt wie bei X – ein Repost ist öffentlich
      const toggle = el('button', 'xtt-toggle', retweet.state.on ? 'Repost rückgängig machen' : 'Reposten');
      const quote = el('button', 'xtt-toggle', 'Zitieren');
      toggle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        extra.replaceChildren();
        flip(retweet, (on) => mutate(on ? 'CreateRetweet' : 'DeleteRetweet', on ? { tweet_id: id } : { source_tweet_id: id }));
      });
      quote.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openComposer('quote');
      });
      menu.append(toggle, quote);
      extra.replaceChildren(menu);
    });

    const like = button('like', 'Gefällt mir', L.favorite_count, L.favorited);
    like.addEventListener('click', (e) => {
      e.stopPropagation();
      flip(like, (on) => mutate(on ? 'FavoriteTweet' : 'UnfavoriteTweet', { tweet_id: id }));
    });

    const views = link('', `/${u.handle}/status/${id}/analytics`);
    views.className = 'xtt-act xtt-views';
    views.title = 'Aufrufe';
    views.append(icon('views'), el('span', null, fmt(Number(t.views?.count))));

    const bookmark = button('bookmark', 'Lesezeichen', L.bookmark_count, L.bookmarked);
    bookmark.addEventListener('click', (e) => {
      e.stopPropagation();
      flip(bookmark, (on) => mutate(on ? 'CreateBookmark' : 'DeleteBookmark', { tweet_id: id }));
    });

    const share = button('share', 'Link kopieren', 0, false);
    share.addEventListener('click', async (e) => {
      e.stopPropagation();
      share.lastChild.textContent = await navigator.clipboard.writeText(url).then(
        () => 'Link kopiert',
        () => 'Kopieren nicht erlaubt',
      );
      setTimeout(() => (share.lastChild.textContent = ''), 1500);
    });

    bar.append(reply, retweet, like, views, bookmark, share);
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
        ? `▸ ${replyCount} ${replyCount === 1 ? 'Antwort' : 'Antworten'} anzeigen`
        : '▾ Antworten ausblenden';
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
        const more = el('button', 'xtt-toggle', 'Weitere Antworten laden');
        more.addEventListener('click', async (e) => {
          e.stopPropagation();
          more.disabled = true;
          more.textContent = 'Lade …';
          try {
            const next = await fetchReplies(tweetId, cursor);
            more.remove();
            renderReplies(next.replies, next.cursor);
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
        list.replaceChildren(el('div', 'xtt-muted', 'Lade …'));
        try {
          const { replies, cursor } = await fetchReplies(tweetId);
          list.replaceChildren();
          if (!replies.length) list.append(el('div', 'xtt-muted', 'Keine Antworten sichtbar (gelöscht oder von X ausgeblendet).'));
          return renderReplies(replies, cursor);
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

  // --- 6. Buttons an die Antworten auf Statusseiten hängen ---
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
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
