(function () {
  'use strict';

  function createNativeApi() {
    if (typeof browser !== 'undefined' && browser?.storage?.local && browser?.runtime) {
      return {
        storage: { local: browser.storage.local },
        runtime: { sendMessage: (msg) => browser.runtime.sendMessage(msg) },
      };
    }

    if (typeof chrome !== 'undefined' && chrome?.storage?.local && chrome?.runtime) {
      return {
        storage: {
          local: {
            get: (keys) => new Promise((resolve, reject) => {
              chrome.storage.local.get(keys, (result) => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve(result);
              });
            }),
            set: (items) => new Promise((resolve, reject) => {
              chrome.storage.local.set(items, () => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve();
              });
            }),
          },
        },
        runtime: {
          sendMessage: (msg) => new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(msg, (response) => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve(response);
            });
          }),
        },
      };
    }

    return null;
  }

  function getApi() {
    return (typeof globalThis !== 'undefined' && globalThis.cfxApi)
      || (typeof window !== 'undefined' && window.cfxApi)
      || (typeof cfxApi !== 'undefined' ? cfxApi : null)
      || createNativeApi();
  }

  function normalizeOrigin(urlLike) {
    if (!urlLike || typeof urlLike !== 'string') return null;
    try {
      return new URL(urlLike.trim()).origin;
    } catch (e) {
      return null;
    }
  }

  function parseAllowedOrigins(text) {
    const lines = (text || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set(lines.map(normalizeOrigin).filter(Boolean))];
  }

  const PROVIDERS = CFX.DEFAULTS.AI_PROVIDERS;

  const $ = (id) => document.getElementById(id);

  async function load() {
    const keys = Object.values(CFX.STORAGE_KEYS);
    const api = getApi();
    if (!api) throw new Error('Extension API unavailable');
    const settings = await api.storage.local.get(keys);

    const provider = settings[CFX.STORAGE_KEYS.AI_PROVIDER] || 'openai';
    $('provider').value = provider;
    $('endpoint').value = settings[CFX.STORAGE_KEYS.AI_ENDPOINT] || PROVIDERS[provider]?.endpoint || '';
    $('apikey').value = settings[CFX.STORAGE_KEYS.AI_API_KEY] || '';
    $('model').value = settings[CFX.STORAGE_KEYS.AI_MODEL] || PROVIDERS[provider]?.model || '';
    $('baseUrl').value = settings[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL] || '';
    $('maxLen').value = settings[CFX.STORAGE_KEYS.MAX_CONTENT_LENGTH] || CFX.DEFAULTS.MAX_CONTENT_LENGTH;
    $('darkMode').checked = settings[CFX.STORAGE_KEYS.DARK_MODE] || false;
    $('authMode').value = settings[CFX.STORAGE_KEYS.CONFLUENCE_AUTH_MODE] || CFX.DEFAULTS.CONFLUENCE_AUTH_MODE;
    $('deployment').value = settings[CFX.STORAGE_KEYS.CONFLUENCE_DEPLOYMENT] || CFX.DEFAULTS.CONFLUENCE_DEPLOYMENT;
    $('confluenceEmail').value = settings[CFX.STORAGE_KEYS.CONFLUENCE_USER_EMAIL] || '';
    $('confluenceToken').value = settings[CFX.STORAGE_KEYS.CONFLUENCE_API_TOKEN] || '';
    let allowedOrigins = Array.isArray(settings[CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS])
      ? settings[CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS]
      : CFX.DEFAULTS.CONFLUENCE_ALLOWED_ORIGINS;
    if (allowedOrigins.length === 0 && settings[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]) {
      const migrated = normalizeOrigin(settings[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]);
      if (migrated) {
        allowedOrigins = [migrated];
      }
    }
    $('allowedOrigins').value = allowedOrigins.join('\n');
    updateAuthFieldVisibility();
  }

  function showFeedback(text, ok) {
    const el = $('feedback');
    el.textContent = text;
    el.style.color = ok ? '#00875a' : '#de350b';
    setTimeout(() => { el.textContent = ''; }, 3000);
  }

  function updateAuthFieldVisibility() {
    const mode = $('authMode').value;
    const deploymentValue = $('deployment').value;
    const tokenFields = $('tokenAuthFields');
    const deployment = $('deployment');
    const emailField = $('confluenceEmail').closest('.opt-field');

    tokenFields.style.display = mode === 'token' ? 'block' : 'none';
    deployment.disabled = mode !== 'token';
    if (emailField) {
      emailField.style.display = mode === 'token' && deploymentValue === 'cloud' ? 'block' : 'none';
    }
  }

  $('provider').addEventListener('change', () => {
    const p = $('provider').value;
    $('endpoint').value = PROVIDERS[p]?.endpoint || '';
    $('model').value = PROVIDERS[p]?.model || '';
  });

  $('toggleKey').addEventListener('click', () => {
    const input = $('apikey');
    const isVisible = input.type === 'text';
    input.type = isVisible ? 'password' : 'text';
    $('toggleKey').textContent = isVisible ? 'Show' : 'Hide';
  });

  $('toggleConfluenceToken').addEventListener('click', () => {
    const input = $('confluenceToken');
    const isVisible = input.type === 'text';
    input.type = isVisible ? 'password' : 'text';
    $('toggleConfluenceToken').textContent = isVisible ? 'Show' : 'Hide';
  });

  $('authMode').addEventListener('change', updateAuthFieldVisibility);
  $('deployment').addEventListener('change', updateAuthFieldVisibility);

  $('saveBtn').addEventListener('click', async () => {
    $('saveBtn').disabled = true;
    try {
      const authMode = $('authMode').value;
      const deployment = $('deployment').value;
      const confluenceEmail = $('confluenceEmail').value.trim();
      const confluenceToken = $('confluenceToken').value.trim();
      const allowedOrigins = parseAllowedOrigins($('allowedOrigins').value);

      if (authMode === 'token') {
        if (deployment === 'cloud' && (!confluenceEmail || !confluenceToken)) {
          throw new Error('Cloud token mode requires Confluence email and API token');
        }
        if (deployment === 'dc' && !confluenceToken) {
          throw new Error('Data Center token mode requires PAT token');
        }
      }
      if ($('allowedOrigins').value.trim() && allowedOrigins.length === 0) {
        throw new Error('Allowed Confluence URLs contains no valid URL');
      }

      const api = getApi();
      if (!api) throw new Error('Extension API unavailable');
      await api.storage.local.set({
        [CFX.STORAGE_KEYS.AI_PROVIDER]: $('provider').value,
        [CFX.STORAGE_KEYS.AI_ENDPOINT]: $('endpoint').value.trim(),
        [CFX.STORAGE_KEYS.AI_API_KEY]: $('apikey').value.trim(),
        [CFX.STORAGE_KEYS.AI_MODEL]: $('model').value.trim(),
        [CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]: $('baseUrl').value.trim(),
        [CFX.STORAGE_KEYS.MAX_CONTENT_LENGTH]: parseInt($('maxLen').value, 10) || CFX.DEFAULTS.MAX_CONTENT_LENGTH,
        [CFX.STORAGE_KEYS.DARK_MODE]: $('darkMode').checked,
        [CFX.STORAGE_KEYS.CONFLUENCE_AUTH_MODE]: authMode,
        [CFX.STORAGE_KEYS.CONFLUENCE_DEPLOYMENT]: deployment,
        [CFX.STORAGE_KEYS.CONFLUENCE_USER_EMAIL]: confluenceEmail,
        [CFX.STORAGE_KEYS.CONFLUENCE_API_TOKEN]: confluenceToken,
        [CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS]: allowedOrigins,
      });
      showFeedback('✓ Settings saved', true);
    } catch (err) {
      showFeedback('Error: ' + err.message, false);
    }
    $('saveBtn').disabled = false;
  });

  $('clearHistory').addEventListener('click', async () => {
    if (!confirm('This will permanently delete all edit history stored locally. Continue?')) return;
    try {
      // Clear IndexedDB by sending message to background
      const api = getApi();
      if (!api) throw new Error('Extension API unavailable');
      await api.runtime.sendMessage({ type: 'CLEAR_ALL_HISTORY', payload: {} });
      showFeedback('✓ History cleared', true);
    } catch (err) {
      showFeedback('Error: ' + err.message, false);
    }
  });

  load();
})();
