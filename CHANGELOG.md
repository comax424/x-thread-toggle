# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- English README (German version moved to `README.de.md`), privacy notice and disclaimer of affiliation with X Corp.
- This changelog.

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

[Unreleased]: https://github.com/comax424/x-thread-toggle/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/comax424/x-thread-toggle/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/comax424/x-thread-toggle/releases/tag/v1.0.0
