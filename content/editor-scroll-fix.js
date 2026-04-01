/**
 * editor-scroll-fix.js
 * Injects page-context workaround for Confluence editor cursor/scroll jump issue.
 */
(function () {
  'use strict';

  const INJECT_TAG = 'cfx-editor-scroll-fix-loader';
  const URL_CHECK_INTERVAL_MS = 800;

  let urlTimer = null;
  let lastUrl = '';

  function isConfluencePage() {
    const ctx = window.cfxPageDetector ? window.cfxPageDetector.getPageContext() : null;
    return !!(ctx && ctx.isConfluencePage);
  }

  async function isEnabled() {
    try {
      const api = (typeof globalThis !== 'undefined' && globalThis.cfxApi)
        || (typeof window !== 'undefined' && window.cfxApi);
      if (!api?.storage?.local?.get) return CFX.DEFAULTS.ENABLE_EDITOR_SCROLL_FIX;
      const result = await api.storage.local.get([CFX.STORAGE_KEYS.ENABLE_EDITOR_SCROLL_FIX]);
      return result[CFX.STORAGE_KEYS.ENABLE_EDITOR_SCROLL_FIX]
        ?? CFX.DEFAULTS.ENABLE_EDITOR_SCROLL_FIX;
    } catch (e) {
      return CFX.DEFAULTS.ENABLE_EDITOR_SCROLL_FIX;
    }
  }

  function injectIntoPage() {
    if (document.querySelector(`script[data-${INJECT_TAG}]`)) return;

    const script = document.createElement('script');
    script.src = (typeof chrome !== 'undefined' ? chrome : browser).runtime.getURL(
      'content/editor-scroll-fix-injected.js'
    );
    script.setAttribute(`data-${INJECT_TAG}`, '1');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  async function tryInject() {
    if (!isConfluencePage()) return;
    if (!(await isEnabled())) return;
    injectIntoPage();
  }

  function watchNavigation() {
    if (urlTimer) return;
    lastUrl = location.href;
    urlTimer = window.setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        window.setTimeout(tryInject, 500);
      }
    }, URL_CHECK_INTERVAL_MS);
  }

  function watchSettingChanges() {
    const _storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;
    if (!_storage?.onChanged) return;

    _storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (!changes[CFX.STORAGE_KEYS.ENABLE_EDITOR_SCROLL_FIX]) return;
      const enabled = changes[CFX.STORAGE_KEYS.ENABLE_EDITOR_SCROLL_FIX].newValue
        ?? CFX.DEFAULTS.ENABLE_EDITOR_SCROLL_FIX;
      if (enabled) {
        tryInject();
      }
    });
  }

  function init() {
    tryInject();
    watchNavigation();
    watchSettingChanges();
  }

  window.cfxEditorScrollFix = { init };
})();
