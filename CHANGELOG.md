# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.1] - 2026-11-09

### Changed

- Renamed to “Thread View for X” (in all 28 localized names; Irish and Maltese use English) so the name describes what the extension does for X
  instead of reading like a product of X Corp.

### Added

- `amo-metadata.json` and `./sign-firefox.sh listed`: submits a version for public listing on addons.mozilla.org,
  with summary, description, category, license and notes for Mozilla's reviewers.

## [1.3.0] - 2026-11-09

### Added

- Firefox support (Firefox 142 or later). The release contains a Mozilla-signed `.xpi` that is not listed on
  addons.mozilla.org. The extension's code is the same as in 1.2.1.
- `build.sh` builds the Chrome ZIP and the Firefox package from a git ref. For Firefox it adds the add-on ID,
  the minimum version and the data collection declaration (`none`) to `manifest.json`.
- Extension icon: a small reply tree (three indented replies with avatars) instead of the browser's default
  puzzle piece or letter. The source is `icons/icon.svg`.

### Fixed

- README: the privacy section mentioned two settings; there are three.

## [1.2.1] - 2026-11-09

### Fixed

- A reply could appear twice: once indented in the expanded thread view and once more below it, because X itself
  sometimes shows a reply to a reply right underneath as a conversation chain. While a reply is open in the thread
  view, X's own copy of it is now hidden; collapsing the thread view shows it again. Cells that X reuses for other
  posts are re-checked every time, so nothing else stays hidden.

## [1.2.0] - 2026-11-01

### Added

- New setting “Automatically show replies X hides as ‘probable spam’” (on by default):
  - clicks X's own “Show probable spam” button at the end of a post's replies, at most 10 times per post;
  - the thread view follows X's `ShowMoreThreads` cursor and loads replies held back as probable spam,
    at most 3 extra pages per reply. Before, such replies showed up as “No visible replies”.
  - Both respect the reserve for X's rate limit. Setting texts in all 29 languages.
- The extension now also reads the remaining request count from X's own conversation requests.
- Smoke test covers loading replies held back as probable spam, with the setting on and off.

## [1.1.1] - 2026-11-01

### Fixed

- Expanding a thread failed with “t is not a function” for every post (regression in 1.1.0): the translation
  helper shared its name with the post variable in the action bar. The helper is now called `msg`.

### Added

- English README (German version moved to `README.de.md`), privacy notice and disclaimer of affiliation with X Corp.
- This changelog.
- Security policy (`SECURITY.md`) with private vulnerability reporting.

## [1.1.0] - 2026-10-31

### Added

- Support for 29 European languages: the 24 official EU languages plus Norwegian, Ukrainian, Russian, Turkish and Catalan.
  In-page texts follow the language set in X, the popup follows the browser language; English is the fallback.
- Localized extension name and description (`_locales/`).

### Changed

- The expand button now reads “Show replies (N)” instead of a pluralized count.
- Dates and numbers are formatted in the selected language.

## [1.0.0] - 2026-10-31

### Added

- Button below every reply on a post page that expands and collapses all replies underneath as a nested thread.
- Optional automatic expansion when opening a post, with a per-post request budget and a reserve for X's own rate limit.
- Reading view with reply, repost/quote, like, views, bookmark and share actions; name and avatar link to the profile.
- Optional wider middle column (1000 px) on large windows; 16 px indentation per level.

[Unreleased]: https://github.com/comax424/x-thread-toggle/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/comax424/x-thread-toggle/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/comax424/x-thread-toggle/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/comax424/x-thread-toggle/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/comax424/x-thread-toggle/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/comax424/x-thread-toggle/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/comax424/x-thread-toggle/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/comax424/x-thread-toggle/releases/tag/v1.0.0
