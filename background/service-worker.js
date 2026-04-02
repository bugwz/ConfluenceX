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

const orgRuns = new Map();

// ─── Streaming AI Chat via Ports ─────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== MSG.AI_STREAM_PORT) return;

  port.onMessage.addListener(async (message) => {
    if (message.type !== MSG.AI_CHAT_REQUEST) return;

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
        port.postMessage({ type: MSG.AI_STREAM_ERROR, error: 'AI API key not configured. Please open Settings.' });
        return;
      }

      const callbacks = {
        onStatus: (status) => {
          try { port.postMessage({ type: MSG.AI_STREAM_STATUS, status }); } catch (e) {}
        },
        onDelta: (delta) => {
          try { port.postMessage({ type: MSG.AI_STREAM_DELTA, delta }); } catch (e) {}
        },
        onThinking: (delta) => {
          try { port.postMessage({ type: MSG.AI_STREAM_THINKING, delta }); } catch (e) {}
        },
        onDone: (content, thinking) => {
          try { port.postMessage({ type: MSG.AI_STREAM_DONE, content, thinking }); } catch (e) {}
        },
        onError: (error) => {
          try { port.postMessage({ type: MSG.AI_STREAM_ERROR, error }); } catch (e) {}
        },
      };

      await aiClient.streamAiMessage(config, message.payload.messages, callbacks);
    } catch (err) {
      try { port.postMessage({ type: MSG.AI_STREAM_ERROR, error: err.message }); } catch (e) {}
    }
  });
});

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

    case MSG.AI_ORG_SCAN_REQUEST:
      handleAiOrgScan(payload, sendResponse);
      return true;

    case MSG.AI_ORG_PLAN_REQUEST:
      handleAiOrgPlan(payload, sendResponse);
      return true;

    case MSG.AI_ORG_VALIDATE_REQUEST:
      handleAiOrgValidate(payload, sendResponse);
      return true;

    case MSG.AI_ORG_EXECUTE_REQUEST:
      handleAiOrgExecute(payload, sendResponse);
      return true;

    case MSG.AI_ORG_ABORT_REQUEST:
      handleAiOrgAbort(payload, sendResponse);
      return true;

    case MSG.AI_ORG_ROLLBACK_REQUEST:
      handleAiOrgRollback(payload, sendResponse);
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

// ─── AI Organizer Workflow ───────────────────────────────────────────────────

function publishOrgProgress(runId, stage, details = {}) {
  const maybePromise = chrome.runtime.sendMessage({
    type: MSG.AI_ORG_EXECUTE_PROGRESS,
    payload: {
      runId,
      stage,
      timestamp: Date.now(),
      ...details,
    },
  });
  if (maybePromise && typeof maybePromise.catch === 'function') {
    maybePromise.catch(() => {});
  }
}

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch (e) {
    return null;
  }
}

function buildOrgPlannerMessages(userRequest, snapshot) {
  const plannerPrompt = [
    'You are ConfluenceX Tree Organizer Planner.',
    'Output JSON only.',
    'Allowed operations:',
    '- MOVE_PAGE: { "type":"MOVE_PAGE","pageId":"...","newParentId":"...","reason":"..." }',
    '- RENAME_PAGE: { "type":"RENAME_PAGE","pageId":"...","newTitle":"...","reason":"..." }',
    'Forbidden: delete, merge, create.',
    'Schema:',
    '{',
    '  "summary": "string",',
    '  "rules": ["string"],',
    '  "operations": [ ... ],',
    '  "needsHumanDecision": false,',
    '  "openQuestions": ["string"]',
    '}',
    'Only reference page IDs that appear in the snapshot.',
  ].join('\n');

  const userInput = {
    userRequest,
    snapshot,
  };

  return [
    { role: 'system', content: plannerPrompt },
    { role: 'user', content: JSON.stringify(userInput) },
  ];
}

function normalizeAndEnrichPlan(rawPlan, snapshot) {
  if (!rawPlan || typeof rawPlan !== 'object') {
    throw new Error('Planner output is not a JSON object.');
  }
  if (!Array.isArray(rawPlan.operations)) {
    throw new Error('Planner output missing operations array.');
  }

  const nodesById = new Map((snapshot?.nodes || []).map((n) => [String(n.id), n]));
  const operations = [];
  const perPageOps = new Map();

  rawPlan.operations.forEach((op, idx) => {
    const type = String(op?.type || '').trim().toUpperCase();
    const pageId = String(op?.pageId || '').trim();
    if (!['MOVE_PAGE', 'RENAME_PAGE'].includes(type)) return;
    if (!nodesById.has(pageId)) return;

    const normalized = {
      opId: op.opId || `op-${idx + 1}`,
      type,
      pageId,
      reason: String(op.reason || '').trim(),
      dependsOn: Array.isArray(op.dependsOn) ? op.dependsOn.slice() : [],
    };

    if (type === 'MOVE_PAGE') {
      const newParentId = String(op.newParentId || '').trim();
      if (!newParentId) return;
      normalized.newParentId = newParentId;
    } else {
      const newTitle = String(op.newTitle || '').trim();
      if (!newTitle) return;
      normalized.newTitle = newTitle;
    }

    if (perPageOps.has(pageId)) {
      normalized.dependsOn.push(perPageOps.get(pageId));
    }
    perPageOps.set(pageId, normalized.opId);

    const current = nodesById.get(pageId);
    normalized.before = {
      parentId: current.parentId || null,
      title: current.title || '',
      version: current.version || null,
    };
    normalized.riskLevel = type === 'MOVE_PAGE' ? 'medium' : 'low';
    operations.push(normalized);
  });

  return {
    planId: rawPlan.planId || crypto.randomUUID(),
    summary: String(rawPlan.summary || 'Tree organization plan'),
    rules: Array.isArray(rawPlan.rules) ? rawPlan.rules.slice(0, 20) : [],
    needsHumanDecision: Boolean(rawPlan.needsHumanDecision),
    openQuestions: Array.isArray(rawPlan.openQuestions) ? rawPlan.openQuestions.slice(0, 10) : [],
    operations,
  };
}

function buildStateFromSnapshot(snapshot) {
  return new Map((snapshot?.nodes || []).map((n) => [String(n.id), {
    id: String(n.id),
    title: n.title || '',
    parentId: n.parentId ? String(n.parentId) : null,
    version: n.version || null,
  }]));
}

function computePath(nodeId, stateMap, maxDepth = 100) {
  const parts = [];
  let cursor = stateMap.get(String(nodeId));
  let depth = 0;
  while (cursor && depth < maxDepth) {
    parts.unshift(cursor.title || cursor.id);
    if (!cursor.parentId) break;
    cursor = stateMap.get(String(cursor.parentId));
    depth += 1;
  }
  return parts.join(' / ');
}

function hasAncestor(candidateParentId, nodeId, stateMap, maxDepth = 200) {
  let cursor = stateMap.get(String(candidateParentId));
  let depth = 0;
  while (cursor && depth < maxDepth) {
    if (String(cursor.id) === String(nodeId)) return true;
    if (!cursor.parentId) return false;
    cursor = stateMap.get(String(cursor.parentId));
    depth += 1;
  }
  return false;
}

function topologicalBatches(operations) {
  const byId = new Map(operations.map((op) => [op.opId, op]));
  const inDegree = new Map();
  const adjacency = new Map();
  operations.forEach((op) => {
    inDegree.set(op.opId, 0);
    adjacency.set(op.opId, []);
  });
  operations.forEach((op) => {
    (op.dependsOn || []).forEach((dep) => {
      if (!byId.has(dep)) return;
      inDegree.set(op.opId, inDegree.get(op.opId) + 1);
      adjacency.get(dep).push(op.opId);
    });
  });

  let ready = operations.filter((op) => inDegree.get(op.opId) === 0).map((op) => op.opId);
  const batches = [];
  let processed = 0;

  while (ready.length) {
    const batchIds = ready;
    ready = [];
    const batch = [];
    batchIds.forEach((id) => {
      processed += 1;
      batch.push(byId.get(id));
      adjacency.get(id).forEach((nextId) => {
        inDegree.set(nextId, inDegree.get(nextId) - 1);
        if (inDegree.get(nextId) === 0) ready.push(nextId);
      });
    });
    batches.push(batch);
  }

  if (processed !== operations.length) {
    throw new Error('Plan dependencies contain a cycle.');
  }

  return batches;
}

function validateAndBuildDryRun(snapshot, plan) {
  const errors = [];
  const warnings = [];
  const state = buildStateFromSnapshot(snapshot);
  const previews = [];

  if (!plan.operations.length) {
    errors.push('Planner produced no valid operations.');
  }

  const seenOpIds = new Set();
  for (const op of plan.operations) {
    if (seenOpIds.has(op.opId)) {
      errors.push(`Duplicate opId: ${op.opId}`);
      continue;
    }
    seenOpIds.add(op.opId);

    const page = state.get(op.pageId);
    if (!page) {
      errors.push(`Unknown pageId in operation ${op.opId}: ${op.pageId}`);
      continue;
    }

    const beforePath = computePath(op.pageId, state);
    let afterPath = beforePath;

    if (op.type === 'MOVE_PAGE') {
      if (!state.has(op.newParentId)) {
        errors.push(`Operation ${op.opId} target parent not in snapshot: ${op.newParentId}`);
        continue;
      }
      if (op.newParentId === op.pageId) {
        errors.push(`Operation ${op.opId} moves page under itself.`);
        continue;
      }
      if (hasAncestor(op.newParentId, op.pageId, state)) {
        errors.push(`Operation ${op.opId} would create a cycle.`);
        continue;
      }
      page.parentId = op.newParentId;
      afterPath = computePath(op.pageId, state);
    } else if (op.type === 'RENAME_PAGE') {
      if (!op.newTitle || !op.newTitle.trim()) {
        errors.push(`Operation ${op.opId} has empty newTitle.`);
        continue;
      }
      page.title = op.newTitle.trim();
      afterPath = computePath(op.pageId, state);
    }

    previews.push({
      opId: op.opId,
      type: op.type,
      pageId: op.pageId,
      beforePath,
      afterPath,
      riskLevel: op.riskLevel || 'low',
      reason: op.reason || '',
    });
  }

  let batches = [];
  try {
    batches = topologicalBatches(plan.operations);
  } catch (e) {
    errors.push(e.message);
  }

  const riskReport = {
    low: plan.operations.filter((o) => (o.riskLevel || 'low') === 'low').length,
    medium: plan.operations.filter((o) => (o.riskLevel || 'low') === 'medium').length,
    high: plan.operations.filter((o) => (o.riskLevel || 'low') === 'high').length,
  };

  if (plan.needsHumanDecision) {
    warnings.push('Plan requested human decisions before execution.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    dryRun: {
      totalOperations: plan.operations.length,
      previews,
      batches: batches.map((batch, idx) => ({
        batchIndex: idx,
        opIds: batch.map((op) => op.opId),
      })),
      riskReport,
    },
  };
}

async function scanTreeSnapshot({ baseUrl, rootPageId, depthLimit = 4, pageLimit = 400 }) {
  const auth = await getConfluenceAuthConfig();
  return confluenceApi.getTreeSnapshot(baseUrl, rootPageId, depthLimit, pageLimit, auth);
}

async function handleAiOrgScan(payload, sendResponse) {
  try {
    const snapshot = await scanTreeSnapshot(payload || {});
    sendResponse({ success: true, data: snapshot });
  } catch (err) {
    sendResponse({ success: false, error: err.message, status: err.status });
  }
}

async function handleAiOrgPlan(payload, sendResponse) {
  try {
    const {
      baseUrl,
      rootPageId,
      userRequest,
      snapshot: rawSnapshot,
      depthLimit = 4,
      pageLimit = 400,
    } = payload || {};

    if (!baseUrl || !rootPageId || !userRequest) {
      throw new Error('baseUrl, rootPageId, and userRequest are required.');
    }

    const snapshot = rawSnapshot || await scanTreeSnapshot({ baseUrl, rootPageId, depthLimit, pageLimit });
    const settings = await cfxApi.storage.local.get([
      CFX.STORAGE_KEYS.AI_PROVIDER,
      CFX.STORAGE_KEYS.AI_ENDPOINT,
      CFX.STORAGE_KEYS.AI_API_KEY,
      CFX.STORAGE_KEYS.AI_MODEL,
    ]);
    const config = {
      provider: settings[CFX.STORAGE_KEYS.AI_PROVIDER] || 'openai',
      endpoint: settings[CFX.STORAGE_KEYS.AI_ENDPOINT],
      apiKey: settings[CFX.STORAGE_KEYS.AI_API_KEY],
      model: settings[CFX.STORAGE_KEYS.AI_MODEL],
    };
    if (!config.apiKey) {
      throw new Error('AI API key not configured. Please open Settings.');
    }

    const messages = buildOrgPlannerMessages(userRequest, snapshot);
    const plannerRaw = await aiClient.sendAiMessage(config, messages);
    const plannerJson = extractJsonObject(plannerRaw);
    if (!plannerJson) {
      throw new Error('Planner returned invalid JSON.');
    }
    const plan = normalizeAndEnrichPlan(plannerJson, snapshot);

    sendResponse({
      success: true,
      data: {
        plan,
        snapshot,
        plannerRaw,
      },
    });
  } catch (err) {
    sendResponse({ success: false, error: err.message, status: err.status });
  }
}

async function handleAiOrgValidate({ snapshot, plan }, sendResponse) {
  try {
    const validation = validateAndBuildDryRun(snapshot, plan);
    sendResponse({ success: true, data: validation });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function executeOperation(baseUrl, op, currentState, auth) {
  if (op.type === 'MOVE_PAGE') {
    const response = await confluenceApi.movePage(baseUrl, op.pageId, op.newParentId, auth);
    const node = currentState.get(op.pageId);
    if (node) {
      node.parentId = op.newParentId;
      node.version = response?.version?.number || (node.version ? node.version + 1 : null);
    }
    return response;
  }
  if (op.type === 'RENAME_PAGE') {
    const response = await confluenceApi.renamePage(baseUrl, op.pageId, op.newTitle, auth);
    const node = currentState.get(op.pageId);
    if (node) {
      node.title = op.newTitle;
      node.version = response?.version?.number || (node.version ? node.version + 1 : null);
    }
    return response;
  }
  throw new Error(`Unsupported operation type: ${op.type}`);
}

async function handleAiOrgExecute(payload, sendResponse) {
  try {
    const { baseUrl, snapshot, plan } = payload || {};
    if (!baseUrl || !snapshot || !plan) {
      throw new Error('baseUrl, snapshot, and plan are required.');
    }

    const validation = validateAndBuildDryRun(snapshot, plan);
    if (!validation.valid) {
      sendResponse({ success: false, error: `Validation failed: ${validation.errors.join('; ')}`, data: validation });
      return;
    }

    const runId = crypto.randomUUID();
    const run = {
      runId,
      status: 'running',
      createdAt: Date.now(),
      plan,
      snapshot,
      executed: [],
      failedAt: null,
      aborted: false,
    };
    orgRuns.set(runId, run);
    publishOrgProgress(runId, 'started', { totalOperations: plan.operations.length });

    const auth = await getConfluenceAuthConfig();
    const currentState = buildStateFromSnapshot(snapshot);
    const byOpId = new Map(plan.operations.map((op) => [op.opId, op]));
    const batches = validation.dryRun.batches.map((b) => b.opIds.map((id) => byOpId.get(id)).filter(Boolean));

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      publishOrgProgress(runId, 'batch_started', { batchIndex: b, size: batch.length });
      for (const op of batch) {
        if (run.aborted) {
          run.status = 'aborted';
          publishOrgProgress(runId, 'aborted', { executed: run.executed.length });
          sendResponse({
            success: false,
            error: 'Execution aborted by user.',
            data: { runId, status: run.status, executed: run.executed },
          });
          return;
        }

        const before = currentState.get(op.pageId) ? { ...currentState.get(op.pageId) } : null;
        publishOrgProgress(runId, 'op_started', { opId: op.opId, type: op.type, pageId: op.pageId });
        try {
          const result = await executeOperation(baseUrl, op, currentState, auth);
          const after = currentState.get(op.pageId) ? { ...currentState.get(op.pageId) } : null;
          run.executed.push({
            ...op,
            checkpoint: { before, after },
            resultVersion: result?.version?.number || null,
            executedAt: Date.now(),
          });
          publishOrgProgress(runId, 'op_succeeded', { opId: op.opId, pageId: op.pageId });
        } catch (err) {
          run.status = 'failed';
          run.failedAt = {
            opId: op.opId,
            error: err.message,
          };
          publishOrgProgress(runId, 'op_failed', { opId: op.opId, error: err.message });
          sendResponse({
            success: false,
            error: `Operation ${op.opId} failed: ${err.message}`,
            data: {
              runId,
              status: run.status,
              failedAt: run.failedAt,
              executed: run.executed,
            },
          });
          return;
        }
      }
      publishOrgProgress(runId, 'batch_succeeded', { batchIndex: b });
    }

    run.status = 'completed';
    run.completedAt = Date.now();
    publishOrgProgress(runId, 'completed', {
      executed: run.executed.length,
      totalOperations: plan.operations.length,
    });

    sendResponse({
      success: true,
      data: {
        runId,
        status: run.status,
        executed: run.executed.length,
        totalOperations: plan.operations.length,
      },
    });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleAiOrgAbort({ runId }, sendResponse) {
  const run = orgRuns.get(runId);
  if (!run) {
    sendResponse({ success: false, error: `Run not found: ${runId}` });
    return;
  }
  run.aborted = true;
  sendResponse({ success: true, data: { runId, status: 'aborting' } });
}

async function rollbackExecutedOperation(baseUrl, executedOp, auth) {
  const before = executedOp?.checkpoint?.before;
  if (!before) throw new Error(`Missing rollback checkpoint for ${executedOp.opId}`);
  if (executedOp.type === 'MOVE_PAGE') {
    if (!before.parentId) {
      throw new Error(`Cannot rollback move for ${executedOp.opId}: original parent is empty.`);
    }
    await confluenceApi.movePage(baseUrl, executedOp.pageId, before.parentId, auth);
    return;
  }
  if (executedOp.type === 'RENAME_PAGE') {
    await confluenceApi.renamePage(baseUrl, executedOp.pageId, before.title, auth);
    return;
  }
  throw new Error(`Unsupported rollback op type: ${executedOp.type}`);
}

async function handleAiOrgRollback({ runId, baseUrl }, sendResponse) {
  try {
    const run = orgRuns.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (!baseUrl) throw new Error('baseUrl is required for rollback.');
    if (!run.executed.length) {
      sendResponse({ success: true, data: { runId, rolledBack: 0 } });
      return;
    }

    const auth = await getConfluenceAuthConfig();
    let rolledBack = 0;
    for (let i = run.executed.length - 1; i >= 0; i--) {
      const op = run.executed[i];
      await rollbackExecutedOperation(baseUrl, op, auth);
      rolledBack += 1;
      publishOrgProgress(runId, 'rollback_step', { opId: op.opId, rolledBack });
    }

    run.status = 'rolled_back';
    run.rolledBackAt = Date.now();
    publishOrgProgress(runId, 'rolled_back', { rolledBack });
    sendResponse({ success: true, data: { runId, rolledBack } });
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
