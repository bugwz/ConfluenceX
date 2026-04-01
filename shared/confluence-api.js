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

      if (deployment !== 'cloud') {
        throw new ConfluenceApiError('Only Confluence Cloud token auth is supported right now.', 400);
      }
      if (!auth.userEmail || !auth.apiToken) {
        throw new ConfluenceApiError('Token mode requires Confluence email and API token.', 400);
      }

      const encoded = btoa(`${auth.userEmail}:${auth.apiToken}`);
      return { Authorization: `Basic ${encoded}` };
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

  // Export to globalThis for service worker context
  const confluenceApi = {
    getPageContent,
    updatePageContent,
    movePage,
    searchPages,
    getChildPages,
    getSpaces,
    getSpaceRootPages,
    ConfluenceApiError,
  };

  if (typeof window !== 'undefined') {
    window.confluenceApi = confluenceApi;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.confluenceApi = confluenceApi;
  }
})();
