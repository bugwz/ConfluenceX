/**
 * dark-mode.js
 * Dark mode controller for Confluence pages.
 * Injects dark-mode.css and manages the confluencex-dark class on body.
 */
(function () {
  'use strict';

  const LINK_ID = CFX.DARK_MODE_LINK_ID;
  const DARK_CLASS = CFX.DARK_MODE_CLASS;
  let editorCheckInterval = null;
  let observer = null;

  function init() {
    // Restore saved state
    const _storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;
    _storage.local.get([CFX.STORAGE_KEYS.DARK_MODE], (result) => {
      if (result[CFX.STORAGE_KEYS.DARK_MODE]) {
        enableDarkMode();
      }
    });
  }

  function enableDarkMode() {
    injectCSS();
    document.body.classList.add(DARK_CLASS);
    startEditorCheck();
    startMutationObserver();
  }

  function disableDarkMode() {
    const link = document.getElementById(LINK_ID);
    if (link) link.remove();
    document.body.classList.remove(DARK_CLASS);
    stopEditorCheck();
    stopMutationObserver();
  }

  function toggle(enable) {
    if (enable === undefined) {
      enable = !document.body.classList.contains(DARK_CLASS);
    }
    if (enable) {
      enableDarkMode();
    } else {
      disableDarkMode();
    }
  }

  function injectCSS() {
    if (document.getElementById(LINK_ID)) return;
    const link = document.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = (typeof chrome !== 'undefined' ? chrome : browser).runtime.getURL('content/dark-mode.css');
    document.head.appendChild(link);
  }

  function injectCSSIntoFrame(frameDoc) {
    if (!frameDoc || frameDoc.getElementById(LINK_ID)) return;
    const link = frameDoc.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = (typeof chrome !== 'undefined' ? chrome : browser).runtime.getURL('content/dark-mode.css');
    if (frameDoc.head) {
      frameDoc.head.appendChild(link);
    } else {
      frameDoc.documentElement.appendChild(link);
    }
    if (frameDoc.body) {
      frameDoc.body.classList.add(DARK_CLASS);
    }
  }

  // TinyMCE editor iframe dark mode injection
  function startEditorCheck() {
    if (editorCheckInterval) return;
    editorCheckInterval = setInterval(() => {
      const iframe = document.getElementById('wysiwygTextarea_ifr') ||
        document.querySelector('.tox-edit-area__iframe');
      if (iframe) {
        try {
          injectCSSIntoFrame(iframe.contentDocument);
        } catch (e) { /* cross-origin, ignore */ }
      }
    }, 2000);
  }

  function stopEditorCheck() {
    if (editorCheckInterval) {
      clearInterval(editorCheckInterval);
      editorCheckInterval = null;
    }
  }

  // MutationObserver to re-apply class if something removes it
  function startMutationObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          if (!document.body.classList.contains(DARK_CLASS) &&
              document.getElementById(LINK_ID)) {
            document.body.classList.add(DARK_CLASS);
          }
        }
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function stopMutationObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  window.cfxDarkMode = { init, toggle, enableDarkMode, disableDarkMode };
})();
