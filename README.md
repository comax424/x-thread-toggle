# X Thread View

[Deutsch](README.de.md)

A browser extension for x.com, for Chrome and Firefox. Below every reply that has replies of its own, a button
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
  | Automatically show replies X hides as “probable spam” | on | Clicks X's “Show probable spam” button at the end of a post's replies (at most 10 times per post) and also loads such replies in the thread view (at most 3 extra pages per reply). Uses additional requests and respects the rate-limit reserve. |

## Languages

29 languages: all 24 official EU languages (bg, cs, da, de, el, en, es, et, fi, fr, ga, hr, hu, it, lt, lv, mt, nl, pl, pt, ro, sk, sl, sv)
plus Norwegian, Ukrainian, Russian, Turkish and Catalan. Texts on x.com follow the language set in X; the popup follows
the browser language; English is the fallback. All texts live in `i18n.js`, the extension's name and description in `_locales/`
(Chrome has no Irish or Maltese locale there; those fall back to English).
The translations are machine-generated and have not been reviewed by native speakers — corrections are welcome.

## Installation

### Chrome

1. Download `x-thread-toggle-<version>.zip` from the [latest release](../../releases/latest) and unzip it (or clone this repository).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder.
5. Reload any open x.com tabs.

Also works in other Chromium browsers such as Vivaldi, Brave or Edge.

### Firefox (142 or later)

1. Download `x-thread-toggle-<version>-firefox.xpi` from the [latest release](../../releases/latest).
2. Open `about:addons`, click the gear icon and choose **Install Add-on From File…**, then select the file
   (or drag the file into a Firefox window).
3. Confirm the prompt, which also asks for access to x.com.
4. Reload any open x.com tabs.

The file is signed by Mozilla but not listed on addons.mozilla.org, so Firefox does not update it automatically:
install a newer version the same way; your settings are kept. If nothing appears on x.com, check the
**Permissions** tab of the extension in `about:addons`.

### Building the packages

`./build.sh [git-ref]` builds both packages from a commit or tag (default: `HEAD`) into `dist/`:
the Chrome ZIP and a Firefox ZIP for signing on addons.mozilla.org. The code is the same for both;
for Firefox the script only adds the add-on ID, the minimum version and the data-collection declaration to `manifest.json`.

### Signing the Firefox package (maintainers)

Firefox only installs signed add-ons permanently. Signing is free and done by Mozilla; the add-on stays unlisted.

1. Test first: in Firefox open `about:debugging` → **This Firefox** → **Load Temporary Add-on…** and select
   `dist/firefox/manifest.json`. Mozilla accepts every version number only once, so fix problems before uploading.
2. Open <https://addons.mozilla.org/en-US/developers/> and log in with a Mozilla account.
3. Click **Submit a New Add-on** (the first time, accept the developer agreement).
4. Choose **On your own** and click **Continue**.
5. Under **Select a file**, upload `dist/x-thread-toggle-<version>-firefox.zip` and wait for the validation.
6. When asked whether source code is needed, answer **No** (the code is not minified or bundled).
7. Mozilla signs the file and sends an email. Download the signed `.xpi` from the version page and attach it
   to the GitHub release as `x-thread-toggle-<version>-firefox.xpi`.

Steps 2–7 can also run from the command line: create API credentials at
<https://addons.mozilla.org/en-US/developers/addon/api/key/>, put them into `~/.config/x-thread-toggle/amo-api.env`
(`WEB_EXT_API_KEY=<JWT issuer>`, `WEB_EXT_API_SECRET=<JWT secret>`, `chmod 600`) and run `./sign-firefox.sh`.
It uploads `dist/firefox` as an unlisted version, waits for the signature and saves `dist/x-thread-toggle-<version>-firefox.xpi`.

## Privacy

- The extension only runs on `https://x.com/*` and requests a single permission: `storage`, for its three settings
  (synced with your browser profile via `storage.sync`). In Firefox it declares that it collects no data.
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
