# ConfluenceX

A Chrome and Firefox browser extension that supercharges **Confluence Server 7.x** with an AI-powered sidebar, page management tools, and quality-of-life improvements.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

### AI Chat Sidebar
- Talk to an AI assistant (OpenAI, Claude, or any OpenAI-compatible endpoint) to edit Confluence page content using natural language
- AI reads the current page's XHTML storage format and returns a modified version
- Review changes in a **before/after diff viewer** before applying
- **Edit history** with one-click rollback — every AI-suggested change is saved locally in IndexedDB

### Page Move
- Search for pages using Confluence CQL or browse the page tree
- Move any page to a new parent with a single click
- Works across spaces

### Dark Mode
- Full dark theme for Confluence 7.x pages
- ~100 targeted CSS rules covering header, sidebar, content area, tables, code blocks, macros, and more
- Persists across page loads and browser sessions
- Also applied inside the TinyMCE editor iframe

### Scroll to Top
- Floating button appears when you scroll down a long page
- Smooth scroll back to the top

---

## Installation

### Chrome (v114+)

1. Download or clone this repository
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project root directory

### Firefox

1. Download or clone this repository
2. Open `about:debugging`
3. Click **This Firefox** → **Load Temporary Add-on**
4. Select `manifest.firefox.json`

> **Permanent Firefox install:** Build the `.zip` with `./build.sh firefox`, then submit to [addons.mozilla.org](https://addons.mozilla.org) or use `about:addons` → Install from file.

---

## Building

Requires `zip` (standard on macOS/Linux) and `rsync`.

```bash
./build.sh chrome    # → confluencex-chrome.zip
./build.sh firefox   # → confluencex-firefox.zip
./build.sh all       # → both
```

---

## Configuration

Open the extension sidebar → **Settings** tab (or right-click the toolbar icon → Options).

| Setting | Description |
|---------|-------------|
| **AI Provider** | `OpenAI`, `Anthropic Claude`, or `Custom` (OpenAI-compatible) |
| **API Endpoint** | Pre-filled for OpenAI/Claude; set your own for custom providers |
| **API Key** | Your provider's API key (stored locally, never sent anywhere except the AI endpoint) |
| **Model** | e.g. `gpt-4o`, `claude-sonnet-4-5`, or your custom model name |
| **Confluence Base URL** | Auto-detected from the active tab; override if needed |
| **Max Content Length** | Characters of page XHTML sent to AI (default: 30,000) |
| **Dark Mode** | Toggle the dark theme |

---

## Project Structure

```
ConfluenceX/
├── manifest.chrome.json        # Chrome Manifest V3
├── manifest.firefox.json       # Firefox Manifest V2
├── build.sh                    # Build & packaging script
├── icons/                      # Extension icons (16/32/48/128px)
├── shared/
│   ├── browser-polyfill.js     # Cross-browser API shim (no external deps)
│   ├── constants.js            # Shared constants & defaults
│   ├── message-types.js        # Message type constants
│   ├── confluence-api.js       # Confluence REST API v1 functions
│   ├── ai-client.js            # AI provider adapter (OpenAI / Claude / Custom)
│   ├── storage.js              # IndexedDB wrapper for edit history
│   └── xml-utils.js            # XHTML validation, diff, AI output sanitizer
├── background/
│   └── service-worker.js       # Central message router + API executor
├── content/
│   ├── content-main.js         # Content script entry point
│   ├── page-detector.js        # Extracts page ID, space key, base URL
│   ├── scroll-to-top.js        # Floating scroll-to-top button
│   ├── dark-mode.js            # Dark mode controller
│   └── dark-mode.css           # Dark mode stylesheet
├── sidepanel/
│   ├── sidepanel.html/css/js   # Sidebar shell and controller
│   ├── tabs/
│   │   ├── chat-tab.js         # AI chat + diff + apply/reject
│   │   ├── move-tab.js         # Page move UI
│   │   └── settings-tab.js     # Settings UI
│   └── components/
│       ├── chat-message.js     # Chat bubble renderer
│       ├── diff-viewer.js      # Line diff component
│       ├── history-list.js     # Edit history with rollback
│       ├── page-tree.js        # Lazy-loading page tree
│       └── search-box.js       # CQL-powered page search
└── options/                    # Full options page
```

---

## Architecture

```
┌─────────── CONFLUENCE PAGE ──────────────┐  ┌──── SIDE PANEL ────┐
│  Content Script                           │  │  Chat | Move | Settings
│  - page-detector  (page ID, space key)    │  │                    │
│  - scroll-to-top  (floating button)       │  │  AI Chat UI        │
│  - dark-mode      (CSS injection)         │  │  Diff Viewer       │
└────────────────┬──────────────────────────┘  │  History / Rollback│
                 │ chrome.runtime messages      └──────────┬─────────┘
                 ▼                                         │
       ┌─────────────────────────────────────────────────┐│
       │           Background Service Worker              ││
       │  - Routes messages between components            ││
       │  - Executes Confluence REST API calls            ◄┘
       │    (with session cookies — no separate login)
       │  - Executes AI API calls
       │  - Manages IndexedDB (edit history)
       └─────────────────────────────────────────────────┘
```

All network I/O goes through the background script, which sends `credentials: 'include'` on every Confluence request — your existing browser session is used automatically.

---

## Confluence Compatibility

Tested against **Confluence Server 7.13.7**. Uses REST API v1 (`/rest/api/content/`). Not compatible with Confluence Cloud (which uses API v2).

---

## Privacy

- Your Confluence session cookies are used automatically by the browser — no credentials are stored by the extension.
- Your AI API key is stored only in `chrome.storage.local` (local to your browser profile).
- Page content is sent to your configured AI endpoint only when you explicitly send a chat message.
- Edit history is stored only in your browser's IndexedDB — nothing is sent to any server.

---

## License

[MIT](LICENSE)
