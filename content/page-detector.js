/**
 * page-detector.js
 * Extracts Confluence page context from DOM and URL.
 * Exposes getPageContext() used by content-main.js and message handlers.
 */
(function () {
  'use strict';

  function getPageContext() {
    const url = window.location.href;
    const origin = window.location.origin;

    // Detect context path (e.g., /confluence or empty)
    let contextPath = '';
    const pathMatch = window.location.pathname.match(/^(\/[^/]+)?\/display\//);
    if (pathMatch && pathMatch[1]) {
      contextPath = pathMatch[1];
    } else {
      // Try AJS if available
      if (typeof AJS !== 'undefined' && AJS.contextPath) {
        contextPath = AJS.contextPath() || '';
      }
    }

    const baseUrl = origin + contextPath;

    // Page ID: try multiple sources
    let pageId = null;

    // 1. AJS.params (most reliable for Confluence 7.x)
    if (typeof AJS !== 'undefined' && AJS.params && AJS.params.pageId) {
      pageId = String(AJS.params.pageId);
    }

    // 2. URL query param viewpage.action?pageId=
    if (!pageId) {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('pageId')) {
        pageId = urlParams.get('pageId');
      }
    }

    // 3. Meta tag
    if (!pageId) {
      const meta = document.querySelector('meta[name="ajs-page-id"]');
      if (meta) pageId = meta.getAttribute('content');
    }

    // 4. DOM data attribute
    if (!pageId) {
      const mainContent = document.getElementById('main-content');
      if (mainContent && mainContent.dataset.pageId) {
        pageId = mainContent.dataset.pageId;
      }
    }

    // Space key
    let spaceKey = null;
    if (typeof AJS !== 'undefined' && AJS.params && AJS.params.spaceKey) {
      spaceKey = AJS.params.spaceKey;
    }
    if (!spaceKey) {
      const meta = document.querySelector('meta[name="ajs-space-key"]');
      if (meta) spaceKey = meta.getAttribute('content');
    }
    if (!spaceKey) {
      // Try URL: /display/SPACEKEY/PageTitle
      const displayMatch = window.location.pathname.match(/\/display\/([^/]+)\//);
      if (displayMatch) spaceKey = displayMatch[1];
    }

    // Page title
    let pageTitle = null;
    const titleEl = document.getElementById('title-text');
    if (titleEl) {
      pageTitle = titleEl.textContent.trim();
    }
    if (!pageTitle) {
      pageTitle = document.title.replace(/ - .*$/, '').trim();
    }

    // Is it a Confluence page? Check for common Confluence DOM markers
    const isConfluencePage = !!(
      document.getElementById('confluence-ui') ||
      document.getElementById('main-content') ||
      document.querySelector('.ia-fixed-sidebar') ||
      document.querySelector('#header.aui-header') ||
      (typeof AJS !== 'undefined')
    );

    // Edit mode detection
    const isEditMode = !!(
      document.getElementById('wysiwygTextarea_ifr') ||
      document.getElementById('rte') ||
      document.querySelector('.tox-tinymce')
    );

    return {
      pageId,
      spaceKey,
      pageTitle,
      baseUrl,
      contextPath,
      isConfluencePage,
      isEditMode,
      url,
    };
  }

  // Expose globally for other content scripts
  window.cfxPageDetector = { getPageContext };

  // Respond to GET_PAGE_CONTEXT messages from sidepanel
  if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
    const _runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
    _runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.type === 'GET_PAGE_CONTEXT') {
        sendResponse({ success: true, data: getPageContext() });
        return true;
      }
    });
  }
})();
