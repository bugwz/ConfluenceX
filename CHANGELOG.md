# Changelog

All notable changes to ConfluenceX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.0.0] - 2026-04-01

### Added

#### AI Chat Sidebar
- Right-side panel with AI chat interface for Confluence pages
- Supports OpenAI, Anthropic Claude, and any OpenAI-compatible custom endpoint
- AI reads the current page's XHTML storage format and returns a modified version
- Before/after diff viewer (line-based LCS diff) before applying changes
- Apply / Reject workflow — changes are not written until the user explicitly approves
- Edit history stored in IndexedDB: every AI suggestion is recorded with full before/after XHTML
- One-click rollback to any previous state (creates a new version in Confluence)

#### Page Move
- CQL-powered search box to find source and destination pages
- Lazy-loading page tree browser as an alternative to search
- Move pages across spaces by changing the `ancestors` field via REST API v1
- Validation: prevents moving a page to itself or to one of its own descendants

#### Dark Mode
- Full dark theme for Confluence Server 7.x
- ~100 CSS rules covering header, sidebar, navigation, content area, tables, code blocks, macros (info/note/warning/tip/panel/expand), forms, dialogs, comments, and search results
- Applied inside TinyMCE editor iframe (edit mode)
- MutationObserver to re-apply class if Confluence scripts remove it
- State persisted in `chrome.storage.local`

#### Scroll to Top
- Fixed floating button (bottom-right, z-index 9999)
- Appears after scrolling 300px, hidden otherwise
- Smooth scroll animation

#### Settings
- In-sidebar Settings tab and full Options page
- Configurable: AI provider, endpoint, API key, model, Confluence base URL, max content length
- Dark mode toggle
- Clear edit history button

#### Browser Compatibility
- Chrome Manifest V3 with `sidePanel` API (Chrome 114+)
- Firefox Manifest V2 with `sidebar_action` (Firefox 109+)
- Thin cross-browser polyfill (`shared/browser-polyfill.js`) — no external dependencies
- Dual manifest build via `build.sh`

[0.0.0]: https://github.com/confluencex/confluencex/releases/tag/v0.0.0
