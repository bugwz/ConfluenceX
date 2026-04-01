/**
 * sidepanel.js
 * Main sidepanel controller: tab switching, page context, initialization.
 */
(function () {
  'use strict';

  let currentTab = 'chat';
  let pageContext = null;
  let isAllowedSite = true;

  function normalizeOrigin(urlLike) {
    if (!urlLike || typeof urlLike !== 'string') return null;
    const trimmed = urlLike.trim();
    if (!trimmed) return null;
    try {
      return new URL(trimmed).origin;
    } catch (e) {
      // Accept bare host input like "confluence.example.com"
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

  async function getAllowedOrigins() {
    const keys = [
      CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS,
      CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL,
    ];
    const stored = await cfxApi.storage.local.get(keys);
    let origins = Array.isArray(stored[CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS])
      ? stored[CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS]
      : [];

    if (origins.length === 0 && stored[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]) {
      const migrated = normalizeOrigin(stored[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]);
      if (migrated) {
        origins = [migrated];
      }
    }
    return [...new Set(origins.map(normalizeOrigin).filter(Boolean))];
  }

  // ─── Tab Switching ──────────────────────────────────────────────────────────

  function initTabs() {
    const tabButtons = document.querySelectorAll('.cfx-tab');
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        switchTab(tabName);
      });
    });
  }

  function switchTab(tabName) {
    currentTab = tabName;

    document.querySelectorAll('.cfx-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    document.querySelectorAll('.cfx-tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });

    // Notify the tab module
    if (tabName === 'chat' && window.cfxChatTab) {
      window.cfxChatTab.onActivate(pageContext);
    } else if (tabName === 'move' && window.cfxMoveTab) {
      window.cfxMoveTab.onActivate(pageContext);
    } else if (tabName === 'settings' && window.cfxSettingsTab) {
      window.cfxSettingsTab.onActivate(pageContext);
    }

    // Persist last active tab
    cfxApi.storage.local.set({ [CFX.STORAGE_KEYS.LAST_ACTIVE_TAB]: tabName }).catch(() => {});
  }

  // ─── Page Context ───────────────────────────────────────────────────────────

  async function fetchPageContext() {
    try {
      const tabs = await cfxApi.tabs.query({ active: true, currentWindow: true });
      if (!tabs || !tabs.length) return;
      const tab = tabs[0];
      const tabOrigin = normalizeOrigin(tab.url || '');
      const allowedOrigins = await getAllowedOrigins();
      isAllowedSite = !!(tabOrigin && allowedOrigins.includes(tabOrigin));

      if (!isAllowedSite) {
        pageContext = null;
        updatePageInfo(null);
        return;
      }

      const response = await cfxApi.tabs.sendMessage(tab.id, { type: MSG.GET_PAGE_CONTEXT });
      if (response && response.success && response.data) {
        pageContext = response.data;
        updatePageInfo(pageContext);

        // Save detected base URL to storage if not already set
        if (pageContext.baseUrl && pageContext.isConfluencePage) {
          const stored = await cfxApi.storage.local.get([CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]);
          if (!stored[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]) {
            await cfxApi.storage.local.set({
              [CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]: pageContext.baseUrl,
            });
          }
        }
      }
    } catch (err) {
      // Tab may not be a Confluence page or content script not injected yet
      updatePageInfo(null);
    }
  }

  function updatePageInfo(ctx) {
    const titleEl = document.getElementById('cfx-page-title');
    if (!isAllowedSite) {
      titleEl.textContent = 'Side panel disabled for this site';
      titleEl.title = '';
      return;
    }
    if (!ctx || !ctx.isConfluencePage) {
      titleEl.textContent = 'Not a Confluence page';
      return;
    }
    titleEl.textContent = ctx.pageTitle || '(untitled page)';
    titleEl.title = ctx.pageTitle || '';
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  async function init() {
    initTabs();

    // Restore last active tab
    try {
      const stored = await cfxApi.storage.local.get([CFX.STORAGE_KEYS.LAST_ACTIVE_TAB]);
      const lastTab = stored[CFX.STORAGE_KEYS.LAST_ACTIVE_TAB];
      if (lastTab && ['chat', 'move', 'settings'].includes(lastTab)) {
        switchTab(lastTab);
      }
    } catch (e) { /* ignore */ }

    await fetchPageContext();

    // Initialize tab modules with context
    if (window.cfxChatTab) window.cfxChatTab.init('tab-chat', pageContext);
    if (window.cfxMoveTab) window.cfxMoveTab.init('tab-move', pageContext);
    if (window.cfxSettingsTab) window.cfxSettingsTab.init('tab-settings', pageContext);

    // Activate default tab
    const activeTabBtn = document.querySelector('.cfx-tab.active');
    if (activeTabBtn) {
      switchTab(activeTabBtn.dataset.tab);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
