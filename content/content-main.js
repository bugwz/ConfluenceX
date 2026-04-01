/**
 * content-main.js
 * Entry point for all content script initialization.
 * Loaded last in the content scripts array.
 */
(function () {
  'use strict';

  // Only activate on Confluence pages
  const ctx = window.cfxPageDetector ? window.cfxPageDetector.getPageContext() : null;
  if (!ctx || !ctx.isConfluencePage) return;

  // Initialize scroll-to-top button
  if (window.cfxScrollToTop) {
    window.cfxScrollToTop.init();
  }

  // Initialize dark mode (restores saved state)
  if (window.cfxDarkMode) {
    window.cfxDarkMode.init();
  }

  // Listen for UI control messages from sidepanel
  const _runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
  _runtime.onMessage.addListener((message) => {
    if (!message) return;

    if (message.type === MSG.TOGGLE_DARK_MODE) {
      if (window.cfxDarkMode) window.cfxDarkMode.toggle(message.payload && message.payload.enable);
    }

    if (message.type === MSG.SCROLL_TO_TOP) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
})();
