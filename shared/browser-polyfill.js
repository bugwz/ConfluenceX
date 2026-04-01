/**
 * browser-polyfill.js
 * Thin cross-browser shim that normalizes chrome.* vs browser.* APIs.
 * Does NOT include the full webextension-polyfill library (~40KB).
 * Only normalizes the specific APIs used by ConfluenceX.
 */
(function () {
  'use strict';

  // Detect environment
  const isFirefox = typeof browser !== 'undefined';
  const _chrome = isFirefox ? browser : chrome;

  // Build a unified api object
  const api = {
    runtime: {
      sendMessage: (msg) => {
        if (isFirefox) {
          return browser.runtime.sendMessage(msg);
        }
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(msg, (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          });
        });
      },
      onMessage: _chrome.runtime.onMessage,
      getURL: (path) => _chrome.runtime.getURL(path),
      id: _chrome.runtime.id,
    },

    tabs: {
      query: (opts) => {
        if (isFirefox) return browser.tabs.query(opts);
        return new Promise((resolve, reject) => {
          chrome.tabs.query(opts, (tabs) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(tabs);
          });
        });
      },
      sendMessage: (tabId, msg) => {
        if (isFirefox) return browser.tabs.sendMessage(tabId, msg);
        return new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, msg, (response) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(response);
          });
        });
      },
      onUpdated: _chrome.tabs.onUpdated,
    },

    storage: {
      local: {
        get: (keys) => {
          if (isFirefox) return browser.storage.local.get(keys);
          return new Promise((resolve, reject) => {
            chrome.storage.local.get(keys, (result) => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve(result);
            });
          });
        },
        set: (items) => {
          if (isFirefox) return browser.storage.local.set(items);
          return new Promise((resolve, reject) => {
            chrome.storage.local.set(items, () => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve();
            });
          });
        },
        remove: (keys) => {
          if (isFirefox) return browser.storage.local.remove(keys);
          return new Promise((resolve, reject) => {
            chrome.storage.local.remove(keys, () => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve();
            });
          });
        },
      },
    },

    sidePanel: {
      // Chrome-only: Firefox uses sidebar_action which opens automatically
      open: (opts) => {
        if (isFirefox) return Promise.resolve();
        if (chrome.sidePanel && chrome.sidePanel.open) {
          return chrome.sidePanel.open(opts);
        }
        return Promise.resolve();
      },
      setPanelBehavior: (opts) => {
        if (isFirefox) return Promise.resolve();
        if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
          return chrome.sidePanel.setPanelBehavior(opts);
        }
        return Promise.resolve();
      },
    },

    action: {
      onClicked: _chrome.action ? _chrome.action.onClicked : (isFirefox ? browser.browserAction.onClicked : null),
    },

    isFirefox,
  };

  // Expose globally so all scripts can use window.cfxApi
  if (typeof window !== 'undefined') {
    window.cfxApi = api;
  }
  // Also expose on globalThis for service worker context
  if (typeof globalThis !== 'undefined') {
    globalThis.cfxApi = api;
  }
})();
