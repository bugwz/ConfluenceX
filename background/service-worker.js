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

const isChromeSidePanelAvailable = typeof chrome !== 'undefined' && !!chrome.sidePanel;

function normalizeOrigin(urlLike) {
  if (!urlLike || typeof urlLike !== 'string') return null;
  const trimmed = urlLike.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch (e) {
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
      try {
        return new URL(`https://${trimmed}`).origin;
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

async function getAllowedConfluenceOrigins() {
  const stored = await cfxApi.storage.local.get([
    CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS,
    CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL,
  ]);

  let allowedOrigins = Array.isArray(stored[CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS])
    ? stored[CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS]
    : [];

  if (allowedOrigins.length === 0 && stored[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]) {
    const migrated = normalizeOrigin(stored[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]);
    if (migrated) {
      allowedOrigins = [migrated];
    }
  }

  return new Set(allowedOrigins.map(normalizeOrigin).filter(Boolean));
}

function isAllowedTabUrl(tabUrl, allowedOrigins) {
  if (!tabUrl || !allowedOrigins || allowedOrigins.size === 0) return false;
  try {
    const origin = new URL(tabUrl).origin;
    return allowedOrigins.has(origin);
  } catch (e) {
    return false;
  }
}

async function updateSidePanelForTab(tabId, tabUrl) {
  if (!isChromeSidePanelAvailable || typeof tabId !== 'number' || !chrome.sidePanel.setOptions) return;
  try {
    const allowedOrigins = await getAllowedConfluenceOrigins();
    const enabled = isAllowedTabUrl(tabUrl, allowedOrigins);
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel/sidepanel.html',
      enabled,
    });
  } catch (e) {
    // Ignore transient tab/storage errors.
  }
}

async function refreshSidePanelForAllTabs() {
  if (!isChromeSidePanelAvailable || !chrome.tabs?.query) return;
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      (tabs || [])
        .filter((tab) => typeof tab.id === 'number')
        .map((tab) => updateSidePanelForTab(tab.id, tab.url))
    );
  } catch (e) {
    // Ignore transient tab query errors.
  }
}

if (isChromeSidePanelAvailable) {
  // Let browser action click toggle side panel directly.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // Default to disabled globally; we enable it per-tab for allowed origins only.
  if (chrome.sidePanel.setOptions) {
    chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
  }

  chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url && changeInfo.status !== 'complete') return;
    updateSidePanelForTab(tabId, changeInfo.url || tab?.url);
  });

  chrome.tabs?.onActivated?.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      updateSidePanelForTab(tabId, tab?.url);
    } catch (e) {
      // Ignore transient tab access errors.
    }
  });

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!changes[CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS]
      && !changes[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]) return;
    refreshSidePanelForAllTabs();
  });

  chrome.runtime?.onInstalled?.addListener(() => {
    refreshSidePanelForAllTabs();
  });
  chrome.runtime?.onStartup?.addListener(() => {
    refreshSidePanelForAllTabs();
  });

  refreshSidePanelForAllTabs();
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

async function getConfluenceAuthConfig() {
  const keys = [
    CFX.STORAGE_KEYS.CONFLUENCE_AUTH_MODE,
    CFX.STORAGE_KEYS.CONFLUENCE_DEPLOYMENT,
    CFX.STORAGE_KEYS.CONFLUENCE_USER_EMAIL,
    CFX.STORAGE_KEYS.CONFLUENCE_API_TOKEN,
  ];
  const settings = await cfxApi.storage.local.get(keys);

  const mode = settings[CFX.STORAGE_KEYS.CONFLUENCE_AUTH_MODE] || CFX.DEFAULTS.CONFLUENCE_AUTH_MODE;
  const deployment = settings[CFX.STORAGE_KEYS.CONFLUENCE_DEPLOYMENT] || CFX.DEFAULTS.CONFLUENCE_DEPLOYMENT;
  const userEmail = (settings[CFX.STORAGE_KEYS.CONFLUENCE_USER_EMAIL] || '').trim();
  const apiToken = (settings[CFX.STORAGE_KEYS.CONFLUENCE_API_TOKEN] || '').trim();

  if (mode === 'token') {
    if (deployment === 'cloud' && (!userEmail || !apiToken)) {
      throw new Error('Cloud token mode requires Confluence email and API token in Settings.');
    }
    if (deployment === 'dc' && !apiToken) {
      throw new Error('Data Center token mode requires PAT token in Settings.');
    }
  }

  return { mode, deployment, userEmail, apiToken };
}

async function handleFetchPageContent({ baseUrl, pageId }, sendResponse) {
  try {
    const auth = await getConfluenceAuthConfig();
    const data = await confluenceApi.getPageContent(baseUrl, pageId, auth);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message, status: err.status });
  }
}

async function handleSavePage({ baseUrl, pageId, title, body, version, ancestors }, sendResponse) {
  try {
    const auth = await getConfluenceAuthConfig();
    const data = await confluenceApi.updatePageContent(baseUrl, pageId, title, body, version, ancestors, auth);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message, status: err.status });
  }
}

async function handleMovePage({ baseUrl, pageId, newAncestorId }, sendResponse) {
  try {
    const auth = await getConfluenceAuthConfig();
    const data = await confluenceApi.movePage(baseUrl, pageId, newAncestorId, auth);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message, status: err.status });
  }
}

async function handleSearchPages({ baseUrl, cql, limit, start }, sendResponse) {
  try {
    const auth = await getConfluenceAuthConfig();
    const data = await confluenceApi.searchPages(baseUrl, cql, limit, start, auth);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message, status: err.status });
  }
}

async function handleGetChildPages({ baseUrl, pageId, limit, start }, sendResponse) {
  try {
    const auth = await getConfluenceAuthConfig();
    const data = await confluenceApi.getChildPages(baseUrl, pageId, limit, start, auth);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message, status: err.status });
  }
}

async function handleGetSpaces({ baseUrl }, sendResponse) {
  try {
    const auth = await getConfluenceAuthConfig();
    const data = await confluenceApi.getSpaces(baseUrl, 50, 0, auth);
    sendResponse({ success: true, data });
  } catch (err) {
    sendResponse({ success: false, error: err.message, status: err.status });
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
