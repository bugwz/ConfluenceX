/**
 * confluence-api.js
 * All Confluence Server REST API v1 request functions.
 * Runs in the background service worker context.
 * All fetch() calls use credentials: 'include' to send the browser session cookies.
 */
(function () {
  'use strict';

  class ConfluenceApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'ConfluenceApiError';
      this.status = status;
    }
  }

  function buildAuthHeaders(auth = {}) {
    const mode = auth.mode || 'cookie';

    if (mode === 'token') {
      const deployment = auth.deployment || 'cloud';

      if (deployment === 'cloud') {
        if (!auth.userEmail || !auth.apiToken) {
          throw new ConfluenceApiError('Cloud token mode requires Confluence email and API token.', 400);
        }
        const encoded = btoa(`${auth.userEmail}:${auth.apiToken}`);
        return { Authorization: `Basic ${encoded}` };
      }

      if (deployment === 'dc') {
        if (!auth.apiToken) {
          throw new ConfluenceApiError('Data Center token mode requires PAT token.', 400);
        }
        return { Authorization: `Bearer ${auth.apiToken}` };
      }

      throw new ConfluenceApiError(`Unsupported Confluence deployment: ${deployment}`, 400);
    }

    return {};
  }

  async function cfxFetch(url, options = {}, auth = {}) {
    const defaultOptions = {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Atlassian-Token': 'no-check',  // Required for Confluence XSRF protection
      },
    };

    const mergedOptions = {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...buildAuthHeaders(auth),
        ...(options.headers || {}),
      },
    };

    const response = await fetch(url, mergedOptions);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.message) errorMessage = errorData.message;
        else if (errorData.statusMessage) errorMessage = errorData.statusMessage;
      } catch (e) { /* ignore JSON parse error */ }
      const err = new ConfluenceApiError(errorMessage, response.status);
      throw err;
    }

    // Handle 204 No Content
    if (response.status === 204) return null;

    return response.json();
  }

  /**
   * GET /rest/api/content/{id}?expand=body.storage,version,ancestors,space,title
   */
  async function getPageContent(baseUrl, pageId, auth) {
    const expand = 'body.storage,version,ancestors,space,title';
    const url = `${baseUrl}/rest/api/content/${pageId}?expand=${expand}`;
    return cfxFetch(url, {}, auth);
  }

  /**
   * PUT /rest/api/content/{id}
   * Updates page content. Version must be incremented.
   */
  async function updatePageContent(baseUrl, pageId, title, bodyValue, versionNumber, ancestors, auth) {
    const url = `${baseUrl}/rest/api/content/${pageId}`;
    const payload = {
      version: {
        number: versionNumber,
        message: 'Updated via ConfluenceX',
      },
      type: 'page',
      title: title,
      body: {
        storage: {
          value: bodyValue,
          representation: 'storage',
        },
      },
    };

    if (ancestors && ancestors.length > 0) {
      payload.ancestors = ancestors.map((a) => ({ id: String(a.id) }));
    }

    return cfxFetch(url, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }, auth);
  }

  /**
   * Move a page by changing its parent (ancestors).
   * Fetches the page first to get current version and body, then updates ancestors.
   */
  async function movePage(baseUrl, pageId, newAncestorId, auth) {
    // First fetch current page to get version, title, and body
    const page = await getPageContent(baseUrl, pageId, auth);
    const currentVersion = page.version.number;
    const title = page.title;
    const bodyValue = page.body.storage.value;

    const url = `${baseUrl}/rest/api/content/${pageId}`;
    const payload = {
      version: {
        number: currentVersion + 1,
        message: 'Moved via ConfluenceX',
      },
      type: 'page',
      title: title,
      ancestors: [{ id: String(newAncestorId) }],
      body: {
        storage: {
          value: bodyValue,
          representation: 'storage',
        },
      },
    };

    return cfxFetch(url, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }, auth);
  }

  /**
   * Rename a page while preserving body and ancestors.
   */
  async function renamePage(baseUrl, pageId, newTitle, auth) {
    if (!newTitle || !newTitle.trim()) {
      throw new ConfluenceApiError('New title is required for rename.', 400);
    }

    const page = await getPageContent(baseUrl, pageId, auth);
    const currentVersion = page.version.number;
    const bodyValue = page.body.storage.value;
    const ancestors = Array.isArray(page.ancestors) ? page.ancestors : [];

    return updatePageContent(
      baseUrl,
      pageId,
      newTitle.trim(),
      bodyValue,
      currentVersion + 1,
      ancestors,
      auth
    );
  }

  /**
   * GET /rest/api/content/search?cql=...
   */
  async function searchPages(baseUrl, cql, limit = 20, start = 0, auth) {
    const params = new URLSearchParams({
      cql,
      limit: String(limit),
      start: String(start),
      expand: 'space,ancestors',
    });
    const url = `${baseUrl}/rest/api/content/search?${params}`;
    return cfxFetch(url, {}, auth);
  }

  /**
   * GET /rest/api/content/{id}/child/page
   */
  async function getChildPages(baseUrl, pageId, limit = 50, start = 0, auth) {
    const params = new URLSearchParams({
      limit: String(limit),
      start: String(start),
      expand: 'ancestors',
    });
    const url = `${baseUrl}/rest/api/content/${pageId}/child/page?${params}`;
    return cfxFetch(url, {}, auth);
  }

  /**
   * GET /rest/api/space
   */
  async function getSpaces(baseUrl, limit = 50, start = 0, auth) {
    const params = new URLSearchParams({ limit: String(limit), start: String(start) });
    const url = `${baseUrl}/rest/api/space?${params}`;
    return cfxFetch(url, {}, auth);
  }

  /**
   * GET /rest/api/content?spaceKey=...&type=page (root pages of a space)
   */
  async function getSpaceRootPages(baseUrl, spaceKey, limit = 50, start = 0, auth) {
    const params = new URLSearchParams({
      spaceKey,
      depth: 'root',
      type: 'page',
      limit: String(limit),
      start: String(start),
      expand: 'ancestors',
    });
    const url = `${baseUrl}/rest/api/content?${params}`;
    return cfxFetch(url, {}, auth);
  }

  /**
   * Scan a subtree rooted at rootPageId.
   * Returns a flat list of page nodes with parent relation and depth.
   */
  async function getTreeSnapshot(baseUrl, rootPageId, depthLimit = 5, pageLimit = 500, auth) {
    if (!rootPageId) {
      throw new ConfluenceApiError('rootPageId is required.', 400);
    }

    const root = await getPageContent(baseUrl, rootPageId, auth);
    const nodes = [];
    const queue = [{
      page: root,
      depth: 0,
    }];
    const seen = new Set();

    while (queue.length > 0 && nodes.length < pageLimit) {
      const current = queue.shift();
      const page = current.page;
      const depth = current.depth;
      const pageId = String(page.id);
      if (seen.has(pageId)) continue;
      seen.add(pageId);

      const ancestors = Array.isArray(page.ancestors) ? page.ancestors : [];
      const immediateParent = ancestors.length ? String(ancestors[ancestors.length - 1].id) : null;
      nodes.push({
        id: pageId,
        title: page.title || '',
        parentId: immediateParent,
        depth,
        version: page.version?.number || null,
        spaceKey: page.space?.key || '',
      });

      if (depth >= depthLimit) continue;

      let start = 0;
      const limit = 50;
      while (nodes.length + queue.length < pageLimit) {
        const childResult = await getChildPages(baseUrl, pageId, limit, start, auth);
        const children = Array.isArray(childResult?.results) ? childResult.results : [];
        if (!children.length) break;

        children.forEach((child) => {
          queue.push({ page: child, depth: depth + 1 });
        });

        if (children.length < limit) break;
        start += limit;
      }
    }

    return {
      rootId: String(root.id),
      rootTitle: root.title || '',
      scannedAt: Date.now(),
      total: nodes.length,
      nodes,
    };
  }

  // Export to globalThis for service worker context
  const confluenceApi = {
    getPageContent,
    updatePageContent,
    movePage,
    searchPages,
    getChildPages,
    getSpaces,
    getSpaceRootPages,
    renamePage,
    getTreeSnapshot,
    ConfluenceApiError,
  };

  if (typeof window !== 'undefined') {
    window.confluenceApi = confluenceApi;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.confluenceApi = confluenceApi;
  }
})();
