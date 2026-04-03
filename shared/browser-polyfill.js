/**
 * browser-polyfill.js
 * Thin cross-browser shim that normalizes chrome.* vs browser.* APIs.
 * Does NOT include the full webextension-polyfill library (~40KB).
 * Only normalizes the specific APIs used by ConfluenceX.
 */
(function () {
  'use strict';

  // Detect environment safely across extension contexts (background, sidepanel, content script).
  const browserApi = typeof browser !== 'undefined' ? browser : null;
  const chromeApi = typeof chrome !== 'undefined' ? chrome : null;
  const isFirefox = !!browserApi;

  function unavailable(name) {
    return Promise.reject(new Error(`Extension API unavailable: ${name}`));
  }

  // Build a unified api object
  const api = {
    runtime: {
      sendMessage: (msg) => {
        if (browserApi?.runtime?.sendMessage) {
          return browserApi.runtime.sendMessage(msg);
        }
        if (!chromeApi?.runtime?.sendMessage) {
          return unavailable('runtime.sendMessage');
        }
        return new Promise((resolve, reject) => {
          chromeApi.runtime.sendMessage(msg, (response) => {
            if (chromeApi.runtime.lastError) {
              reject(chromeApi.runtime.lastError);
            } else {
              resolve(response);
            }
          });
        });
      },
      connect: (opts) => {
        if (browserApi?.runtime?.connect) {
          return browserApi.runtime.connect(opts);
        }
        if (chromeApi?.runtime?.connect) {
          return chromeApi.runtime.connect(opts);
        }
        throw new Error('Extension API unavailable: runtime.connect');
      },
      onMessage: browserApi?.runtime?.onMessage || chromeApi?.runtime?.onMessage || null,
      getURL: (path) => {
        if (browserApi?.runtime?.getURL) return browserApi.runtime.getURL(path);
        if (chromeApi?.runtime?.getURL) return chromeApi.runtime.getURL(path);
        return path;
      },
      id: browserApi?.runtime?.id || chromeApi?.runtime?.id,
    },

    tabs: {
      query: (opts) => {
        if (browserApi?.tabs?.query) return browserApi.tabs.query(opts);
        if (!chromeApi?.tabs?.query) return unavailable('tabs.query');
        return new Promise((resolve, reject) => {
          chromeApi.tabs.query(opts, (tabs) => {
            if (chromeApi.runtime?.lastError) reject(chromeApi.runtime.lastError);
            else resolve(tabs);
          });
        });
      },
      sendMessage: (tabId, msg) => {
        if (browserApi?.tabs?.sendMessage) return browserApi.tabs.sendMessage(tabId, msg);
        if (!chromeApi?.tabs?.sendMessage) return unavailable('tabs.sendMessage');
        return new Promise((resolve, reject) => {
          chromeApi.tabs.sendMessage(tabId, msg, (response) => {
            if (chromeApi.runtime?.lastError) reject(chromeApi.runtime.lastError);
            else resolve(response);
          });
        });
      },
      onUpdated: browserApi?.tabs?.onUpdated || chromeApi?.tabs?.onUpdated || null,
    },

    storage: {
      local: {
        get: (keys) => {
          if (browserApi?.storage?.local?.get) return browserApi.storage.local.get(keys);
          if (!chromeApi?.storage?.local?.get) return unavailable('storage.local.get');
          return new Promise((resolve, reject) => {
            chromeApi.storage.local.get(keys, (result) => {
              if (chromeApi.runtime?.lastError) reject(chromeApi.runtime.lastError);
              else resolve(result);
            });
          });
        },
        set: (items) => {
          if (browserApi?.storage?.local?.set) return browserApi.storage.local.set(items);
          if (!chromeApi?.storage?.local?.set) return unavailable('storage.local.set');
          return new Promise((resolve, reject) => {
            chromeApi.storage.local.set(items, () => {
              if (chromeApi.runtime?.lastError) reject(chromeApi.runtime.lastError);
              else resolve();
            });
          });
        },
        remove: (keys) => {
          if (browserApi?.storage?.local?.remove) return browserApi.storage.local.remove(keys);
          if (!chromeApi?.storage?.local?.remove) return unavailable('storage.local.remove');
          return new Promise((resolve, reject) => {
            chromeApi.storage.local.remove(keys, () => {
              if (chromeApi.runtime?.lastError) reject(chromeApi.runtime.lastError);
              else resolve();
            });
          });
        },
      },
    },

    sidePanel: {
      // Chrome-only: Firefox uses sidebar_action which opens automatically
      open: (opts) => {
        if (browserApi) return Promise.resolve();
        if (chromeApi?.sidePanel?.open) {
          return chromeApi.sidePanel.open(opts);
        }
        return Promise.resolve();
      },
      setPanelBehavior: (opts) => {
        if (browserApi) return Promise.resolve();
        if (chromeApi?.sidePanel?.setPanelBehavior) {
          return chromeApi.sidePanel.setPanelBehavior(opts);
        }
        return Promise.resolve();
      },
    },

    action: {
      onClicked: browserApi?.action?.onClicked
        || browserApi?.browserAction?.onClicked
        || chromeApi?.action?.onClicked
        || null,
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
