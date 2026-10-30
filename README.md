# X Thread View

[Deutsch](README.de.md)

A Chrome extension for x.com. Below every reply that has replies of its own, a button
“▸ Show replies (N)” appears. One click expands **all** posts underneath as a nested tree
(level by level, up to 15 requests per click), instead of having to open every reply one by one.
Each level can be collapsed again on its own. Deeper branches that did not fit into the request
budget keep their own button.

> **Not affiliated with X Corp.** This is an independent, unofficial project. “X” is a trademark of X Corp.

## Features

- **Expand threads:** one button per reply, works for replies loaded while scrolling, expanded threads survive scrolling,
  only 16 px indentation per level so even deep threads (9+ levels) stay readable.
- **Actions in the reading view:** every expanded post has the same bar as on X:
  **Reply** (text box right below) · **Repost** (menu: repost/undo or quote) · **Like** · **Views** (link to post analytics) ·
  **Bookmark** · **Share** (copy link). Replies and quotes are text-only — open the post on X (via its date) for images, polls or emoji.
  Name, handle and avatar link to the profile.
- **Settings** (click the extension icon; pin it via the puzzle icon if needed). Both take effect immediately:

  | Option | Default | Effect |
  |---|---|---|
  | Automatically expand all replies when opening a post | off | Expands everything on opening and while scrolling, visible replies first. At most 80 requests per post; stops while 50 of X's requests are still left for X itself. |
  | Widen the middle column | on | Middle column 1000 instead of 600 px, sidebars move outwards. Only in windows at least 1700 px wide. |

## Languages

29 languages: all 24 official EU languages (bg, cs, da, de, el, en, es, et, fi, fr, ga, hr, hu, it, lt, lv, mt, nl, pl, pt, ro, sk, sl, sv)
plus Norwegian, Ukrainian, Russian, Turkish and Catalan. Texts on x.com follow the language set in X; the popup follows
the browser language; English is the fallback. All texts live in `i18n.js`, the extension's name and description in `_locales/`
(Chrome has no Irish or Maltese locale there; those fall back to English).
The translations are machine-generated and have not been reviewed by native speakers — corrections are welcome.

## Installation

1. Download the ZIP from the [latest release](../../releases/latest) and unzip it (or clone this repository).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder.
5. Reload any open x.com tabs.

Also works in other Chromium browsers such as Vivaldi, Brave or Edge.

## Privacy

- The extension only runs on `https://x.com/*` and requests a single permission: `storage`, for its two settings
  (synced with your browser profile via `chrome.storage.sync`).
- It sends requests **only to x.com**, using your existing X session in the browser — exactly like X's own web app.
  Images are loaded from X's own image servers.
- No analytics, no tracking, no third-party servers. Nothing you read or write is stored or sent anywhere else.

## How it works

- **Reading:** The extension observes the `TweetDetail` request X's web app sends when you open a post
  (query ID, feature flags, session headers) and repeats it with the ID of a reply to load that reply's replies.
- **Writing** (like, repost, bookmark, reply): X requires an `x-client-transaction-id` header for these. The extension
  generates it with X's own generator from the page's webpack bundle; query IDs and feature flags are read from X's main bundle at runtime.
- **Rate limit:** X allows 300 `TweetDetail` requests per 15 minutes. Automatic expansion follows the remaining count X reports
  and always leaves 50 for X itself.

## Limitations

- Only on post pages (`/…/status/…`), not in the home timeline.
- If X's rate limit is reached, “X rate limit reached” appears — wait a few minutes.
- “Please reload the page once (F5)” means X has not yet sent a request the extension could learn from.
- The extension relies on X's internal web interfaces. If X changes them, it may break; error messages then appear below the buttons.
- X's terms of service restrict access through unpublished interfaces. Use at your own risk.

## License

[MIT](LICENSE)
