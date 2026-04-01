/**
 * service-worker.js (Chrome MV3) / background script (Firefox via background.html)
 * Central hub: routes messages, executes all Confluence REST API and AI API calls,
 * manages IndexedDB for edit history.
 */

// In Chrome MV3 service worker, importScripts is used for non-module scripts.
// In Firefox background page, scripts are loaded via <script> tags in background.html.
// We use a try/catch so the same file works in both environments.
try {
  importScripts(
    '../shared/browser-polyfill.js',
    '../shared/constants.js',
    '../shared/message-types.js',
    '../shared/confluence-api.js',
    '../shared/ai-client.js',
    '../shared/storage.js',
    '../shared/xml-utils.js'
  );
} catch (e) {
  // Firefox: scripts already loaded via background.html <script> tags
}

// ─── Side Panel Setup (Chrome only) ─────────────────────────────────────────

if (typeof chrome !== 'undefined' && chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

// ─── Action click (Chrome: open side panel; Firefox: sidebar opens automatically) ──

const _actionApi = typeof chrome !== 'undefined' && chrome.action
  ? chrome.action
  : (typeof browser !== 'undefined' && browser.browserAction ? browser.browserAction : null);

if (_actionApi) {
  _actionApi.onClicked.addListener((tab) => {
    if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
  });
}

// ─── Message Router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message || {};

  switch (type) {
    case MSG.FETCH_PAGE_CONTENT:
      handleFetchPageContent(payload, sendResponse);
      return true;

    case MSG.SAVE_PAGE:
      handleSavePage(payload, sendResponse);
      return true;

    case MSG.MOVE_PAGE:
      handleMovePage(payload, sendResponse);
      return true;

    case MSG.SEARCH_PAGES:
      handleSearchPages(payload, sendResponse);
      return true;

    case MSG.GET_CHILD_PAGES:
      handleGetChildPages(payload, sendResponse);
      return true;

    case MSG.GET_SPACES:
      handleGetSpaces(payload, sendResponse);
      return true;

    case MSG.AI_CHAT_REQUEST:
      handleAiChat(payload, sendResponse);
      return true;

    case MSG.SAVE_EDIT_HISTORY:
      handleSaveEditHistory(payload, sendResponse);
      return true;

    case MSG.GET_EDIT_HISTORY:
      handleGetEditHistory(payload, sendResponse);
      return true;

    case MSG.DELETE_EDIT_SNAPSHOT:
      handleDeleteEditSnapshot(payload, sendResponse);
      return true;

    case MSG.CLEAR_EDIT_HISTORY:
      handleClearEditHistory(payload, sendResponse);
      return true;

    case MSG.GET_SETTINGS:
      handleGetSettings(sendResponse);
      return true;

    case MSG.SAVE_SETTINGS:
      handleSaveSettings(payload, sendResponse);
      return true;

    default:
      return false;
  }
});

// ─── Confluence API Handlers ─────────────────────────────────────────────────

async function handleFetchPageContent({ baseUrl, pageId }, sendResponse) {
  try {
    const data = await confluenceApi.getPageContent(baseUrl, pageId);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleSavePage({ baseUrl, pageId, title, body, version, ancestors }, sendResponse) {
  try {
    const data = await confluenceApi.updatePageContent(baseUrl, pageId, title, body, version, ancestors);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message, status: err.status });
  }
}

async function handleMovePage({ baseUrl, pageId, newAncestorId }, sendResponse) {
  try {
    const data = await confluenceApi.movePage(baseUrl, pageId, newAncestorId);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleSearchPages({ baseUrl, cql, limit, start }, sendResponse) {
  try {
    const data = await confluenceApi.searchPages(baseUrl, cql, limit, start);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleGetChildPages({ baseUrl, pageId, limit, start }, sendResponse) {
  try {
    const data = await confluenceApi.getChildPages(baseUrl, pageId, limit, start);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleGetSpaces({ baseUrl }, sendResponse) {
  try {
    const data = await confluenceApi.getSpaces(baseUrl);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ─── AI Handler ──────────────────────────────────────────────────────────────

async function handleAiChat({ messages }, sendResponse) {
  try {
    const settingsResult = await cfxApi.storage.local.get([
      CFX.STORAGE_KEYS.AI_PROVIDER,
      CFX.STORAGE_KEYS.AI_ENDPOINT,
      CFX.STORAGE_KEYS.AI_API_KEY,
      CFX.STORAGE_KEYS.AI_MODEL,
    ]);

    const config = {
      provider: settingsResult[CFX.STORAGE_KEYS.AI_PROVIDER] || 'openai',
      endpoint: settingsResult[CFX.STORAGE_KEYS.AI_ENDPOINT],
      apiKey: settingsResult[CFX.STORAGE_KEYS.AI_API_KEY],
      model: settingsResult[CFX.STORAGE_KEYS.AI_MODEL],
    };

    if (!config.apiKey) {
      sendResponse({ success: false, error: 'AI API key not configured. Please open Settings.' });
      return;
    }

    const response = await aiClient.sendAiMessage(config, messages);
    sendResponse({ success: true, data: response });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ─── Edit History Handlers ────────────────────────────────────────────────────

async function handleSaveEditHistory({ snapshot }, sendResponse) {
  try {
    await cfxStorage.saveEditSnapshot(snapshot);
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleGetEditHistory({ pageId }, sendResponse) {
  try {
    const history = await cfxStorage.getEditHistory(pageId);
    sendResponse({ success: true, data: history });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleDeleteEditSnapshot({ pageId, snapshotId }, sendResponse) {
  try {
    await cfxStorage.deleteEditSnapshot(pageId, snapshotId);
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleClearEditHistory({ pageId }, sendResponse) {
  try {
    await cfxStorage.clearEditHistory(pageId);
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ─── Settings Handlers ────────────────────────────────────────────────────────

async function handleGetSettings(sendResponse) {
  try {
    const allKeys = Object.values(CFX.STORAGE_KEYS);
    const data = await cfxApi.storage.local.get(allKeys);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleSaveSettings({ settings }, sendResponse) {
  try {
    await cfxApi.storage.local.set(settings);
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}
