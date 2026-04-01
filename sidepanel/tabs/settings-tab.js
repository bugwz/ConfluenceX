/**
 * settings-tab.js
 * Settings tab: AI provider config, dark mode toggle, Confluence base URL.
 */
(function () {
  'use strict';

  function createNativeApi() {
    if (typeof browser !== 'undefined' && browser?.storage?.local && browser?.runtime && browser?.tabs) {
      return {
        storage: { local: browser.storage.local },
        runtime: { sendMessage: (msg) => browser.runtime.sendMessage(msg) },
        tabs: {
          query: (opts) => browser.tabs.query(opts),
          sendMessage: (tabId, msg) => browser.tabs.sendMessage(tabId, msg),
        },
      };
    }

    if (typeof chrome !== 'undefined' && chrome?.storage?.local && chrome?.runtime && chrome?.tabs) {
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
        tabs: {
          query: (opts) => new Promise((resolve, reject) => {
            chrome.tabs.query(opts, (tabs) => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve(tabs);
            });
          }),
          sendMessage: (tabId, msg) => new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, msg, (response) => {
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

  function parseAllowedOrigins(text) {
    const lines = (text || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set(lines.map(normalizeOrigin).filter(Boolean))];
  }

  let container = null;
  let pageContext = null;

  function init(containerId, ctx) {
    container = document.getElementById(containerId);
    pageContext = ctx;
    render();
  }

  function onActivate(ctx) {
    pageContext = ctx;
    render();
  }

  async function render() {
    if (!container) return;
    container.innerHTML = '';

    const form = document.createElement('div');
    form.className = 'cfx-settings-form';

    // Load current settings
    const allKeys = Object.values(CFX.STORAGE_KEYS);
    let settings = {};
    try {
      const api = getApi();
      if (!api) throw new Error('Extension API unavailable');
      settings = await api.storage.local.get(allKeys);
    } catch (e) { /* use defaults */ }

    const provider = settings[CFX.STORAGE_KEYS.AI_PROVIDER] || 'openai';
    const authMode = settings[CFX.STORAGE_KEYS.CONFLUENCE_AUTH_MODE] || CFX.DEFAULTS.CONFLUENCE_AUTH_MODE;
    const deployment = settings[CFX.STORAGE_KEYS.CONFLUENCE_DEPLOYMENT] || CFX.DEFAULTS.CONFLUENCE_DEPLOYMENT;
    let allowedOrigins = Array.isArray(settings[CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS])
      ? settings[CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS]
      : [];
    if (allowedOrigins.length === 0 && settings[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]) {
      const migrated = normalizeOrigin(settings[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]);
      if (migrated) {
        allowedOrigins = [migrated];
      }
    }

    // ── AI Provider ──
    const providerField = createField('AI Provider');
    const providerSelect = document.createElement('select');
    providerSelect.className = 'cfx-select';
    [
      { value: 'openai', label: 'OpenAI (ChatGPT)' },
      { value: 'claude', label: 'Anthropic Claude' },
      { value: 'custom', label: 'Custom (OpenAI-compatible)' },
    ].forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      opt.selected = value === provider;
      providerSelect.appendChild(opt);
    });
    providerField.appendChild(providerSelect);
    form.appendChild(providerField);

    // ── API Endpoint ──
    const endpointField = createField('API Endpoint');
    const endpointInput = document.createElement('input');
    endpointInput.type = 'text';
    endpointInput.className = 'cfx-input';
    endpointInput.placeholder = 'https://api.openai.com/v1/chat/completions';
    endpointInput.value = settings[CFX.STORAGE_KEYS.AI_ENDPOINT] ||
      CFX.DEFAULTS.AI_PROVIDERS[provider]?.endpoint || '';
    endpointField.appendChild(endpointInput);
    form.appendChild(endpointField);

    // ── API Key ──
    const keyField = createField('API Key');
    const keyWrapper = document.createElement('div');
    keyWrapper.className = 'cfx-password-wrapper';
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.className = 'cfx-input';
    keyInput.placeholder = 'sk-...';
    keyInput.value = settings[CFX.STORAGE_KEYS.AI_API_KEY] || '';
    const eyeBtn = document.createElement('button');
    eyeBtn.className = 'cfx-password-toggle';
    eyeBtn.type = 'button';
    eyeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    eyeBtn.addEventListener('click', () => {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    });
    keyWrapper.appendChild(keyInput);
    keyWrapper.appendChild(eyeBtn);
    keyField.appendChild(keyWrapper);
    form.appendChild(keyField);

    // ── Model ──
    const modelField = createField('Model');
    const modelInput = document.createElement('input');
    modelInput.type = 'text';
    modelInput.className = 'cfx-input';
    modelInput.placeholder = 'gpt-4o';
    modelInput.value = settings[CFX.STORAGE_KEYS.AI_MODEL] ||
      CFX.DEFAULTS.AI_PROVIDERS[provider]?.model || '';
    modelField.appendChild(modelInput);
    form.appendChild(modelField);

    // ── Confluence Auth Mode ──
    const authModeField = createField('Confluence Auth Mode');
    const authModeSelect = document.createElement('select');
    authModeSelect.className = 'cfx-select';
    [
      { value: 'cookie', label: 'Cookie (browser login session)' },
      { value: 'token', label: 'Token / PAT' },
    ].forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      opt.selected = value === authMode;
      authModeSelect.appendChild(opt);
    });
    authModeField.appendChild(authModeSelect);
    form.appendChild(authModeField);

    // ── Confluence Deployment ──
    const deploymentField = createField('Confluence Deployment');
    const deploymentSelect = document.createElement('select');
    deploymentSelect.className = 'cfx-select';
    [
      { value: 'cloud', label: 'Cloud' },
      { value: 'dc', label: 'Data Center / Server' },
    ].forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      opt.selected = value === deployment;
      deploymentSelect.appendChild(opt);
    });
    deploymentField.appendChild(deploymentSelect);
    form.appendChild(deploymentField);

    // ── Confluence Email / Token ──
    const confluenceEmailField = createField('Confluence Email');
    const confluenceEmailInput = document.createElement('input');
    confluenceEmailInput.type = 'email';
    confluenceEmailInput.className = 'cfx-input';
    confluenceEmailInput.placeholder = 'you@company.com';
    confluenceEmailInput.value = settings[CFX.STORAGE_KEYS.CONFLUENCE_USER_EMAIL] || '';
    confluenceEmailField.appendChild(confluenceEmailInput);
    form.appendChild(confluenceEmailField);

    const confluenceTokenField = createField('Confluence Api Token');
    const confluenceTokenWrapper = document.createElement('div');
    confluenceTokenWrapper.className = 'cfx-password-wrapper';
    const confluenceTokenInput = document.createElement('input');
    confluenceTokenInput.type = 'password';
    confluenceTokenInput.className = 'cfx-input';
    confluenceTokenInput.placeholder = 'Confluence Api token';
    confluenceTokenInput.value = settings[CFX.STORAGE_KEYS.CONFLUENCE_API_TOKEN] || '';
    const confluenceTokenEye = document.createElement('button');
    confluenceTokenEye.className = 'cfx-password-toggle';
    confluenceTokenEye.type = 'button';
    confluenceTokenEye.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    confluenceTokenEye.addEventListener('click', () => {
      confluenceTokenInput.type = confluenceTokenInput.type === 'password' ? 'text' : 'password';
    });
    confluenceTokenWrapper.appendChild(confluenceTokenInput);
    confluenceTokenWrapper.appendChild(confluenceTokenEye);
    confluenceTokenField.appendChild(confluenceTokenWrapper);
    form.appendChild(confluenceTokenField);

    function updateAuthFieldVisibility() {
      const isTokenMode = authModeSelect.value === 'token';
      const isCloud = deploymentSelect.value === 'cloud';
      confluenceEmailField.style.display = isTokenMode && isCloud ? 'block' : 'none';
      confluenceTokenField.style.display = isTokenMode ? 'block' : 'none';
      deploymentSelect.disabled = !isTokenMode;
    }
    authModeSelect.addEventListener('change', updateAuthFieldVisibility);
    deploymentSelect.addEventListener('change', updateAuthFieldVisibility);
    updateAuthFieldVisibility();

    // ── Allowed Confluence URLs ──
    const allowedOriginsField = createField('Allowed Confluence URLs');
    const allowedOriginsNote = document.createElement('div');
    allowedOriginsNote.style.cssText = 'font-size:11px;color:var(--cfx-text-muted);margin-bottom:4px;';
    allowedOriginsNote.textContent = 'One URL per line. Matching uses origin only, e.g. https://yourcompany.atlassian.net';
    const allowedOriginsInput = document.createElement('textarea');
    allowedOriginsInput.className = 'cfx-input';
    allowedOriginsInput.rows = 4;
    allowedOriginsInput.placeholder = 'https://yourcompany.atlassian.net';
    allowedOriginsInput.value = allowedOrigins.join('\n');
    allowedOriginsField.appendChild(allowedOriginsNote);
    allowedOriginsField.appendChild(allowedOriginsInput);
    form.appendChild(allowedOriginsField);

    // ── Confluence Base URL ──
    const baseUrlField = createField('Confluence Base URL');
    const baseUrlNote = document.createElement('div');
    baseUrlNote.style.cssText = 'font-size:11px;color:var(--cfx-text-muted);margin-bottom:4px;';
    baseUrlNote.textContent = 'Auto-detected from current tab. Override if needed.';
    const baseUrlInput = document.createElement('input');
    baseUrlInput.type = 'text';
    baseUrlInput.className = 'cfx-input';
    baseUrlInput.placeholder = 'https://confluence.yourcompany.com';
    baseUrlInput.value = settings[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL] ||
      (pageContext && pageContext.baseUrl) || '';
    baseUrlField.appendChild(baseUrlNote);
    baseUrlField.appendChild(baseUrlInput);
    form.appendChild(baseUrlField);

    // ── Max Content Length ──
    const maxLenField = createField('Max Content Length (chars)');
    const maxLenNote = document.createElement('div');
    maxLenNote.style.cssText = 'font-size:11px;color:var(--cfx-text-muted);margin-bottom:4px;';
    maxLenNote.textContent = 'Truncate page content sent to AI (default: 30000)';
    const maxLenInput = document.createElement('input');
    maxLenInput.type = 'number';
    maxLenInput.className = 'cfx-input';
    maxLenInput.min = '1000';
    maxLenInput.max = '200000';
    maxLenInput.value = settings[CFX.STORAGE_KEYS.MAX_CONTENT_LENGTH] || CFX.DEFAULTS.MAX_CONTENT_LENGTH;
    maxLenField.appendChild(maxLenNote);
    maxLenField.appendChild(maxLenInput);
    form.appendChild(maxLenField);

    // ── Copy Page as Markdown Toggle ──
    const copyMdRow = document.createElement('div');
    copyMdRow.className = 'cfx-toggle-row';
    const copyMdInfo = document.createElement('div');
    copyMdInfo.innerHTML = `
      <div class="cfx-toggle-label">Copy Page as Markdown</div>
      <div class="cfx-toggle-desc">Show a copy button near the scroll-to-top control on Confluence pages</div>
    `;
    const copyMdToggle = document.createElement('label');
    copyMdToggle.className = 'cfx-toggle';
    const copyMdCheckbox = document.createElement('input');
    copyMdCheckbox.type = 'checkbox';
    copyMdCheckbox.checked = settings[CFX.STORAGE_KEYS.ENABLE_COPY_MARKDOWN]
      ?? CFX.DEFAULTS.ENABLE_COPY_MARKDOWN;
    const copyMdSlider = document.createElement('span');
    copyMdSlider.className = 'cfx-toggle-slider';
    copyMdToggle.appendChild(copyMdCheckbox);
    copyMdToggle.appendChild(copyMdSlider);
    copyMdRow.appendChild(copyMdInfo);
    copyMdRow.appendChild(copyMdToggle);
    form.appendChild(copyMdRow);

    // ── Theme Button Toggle ──
    const themeBtnRow = document.createElement('div');
    themeBtnRow.className = 'cfx-toggle-row';
    const themeBtnInfo = document.createElement('div');
    themeBtnInfo.innerHTML = `
      <div class="cfx-toggle-label">Theme Color Button</div>
      <div class="cfx-toggle-desc">Show a theme button in the floating tools near scroll-to-top</div>
    `;
    const themeBtnToggle = document.createElement('label');
    themeBtnToggle.className = 'cfx-toggle';
    const themeBtnCheckbox = document.createElement('input');
    themeBtnCheckbox.type = 'checkbox';
    themeBtnCheckbox.checked = settings[CFX.STORAGE_KEYS.ENABLE_THEME_BUTTON]
      ?? CFX.DEFAULTS.ENABLE_THEME_BUTTON;
    const themeBtnSlider = document.createElement('span');
    themeBtnSlider.className = 'cfx-toggle-slider';
    themeBtnToggle.appendChild(themeBtnCheckbox);
    themeBtnToggle.appendChild(themeBtnSlider);
    themeBtnRow.appendChild(themeBtnInfo);
    themeBtnRow.appendChild(themeBtnToggle);
    form.appendChild(themeBtnRow);

    // ── Editor Scroll Fix Toggle ──
    const editorFixRow = document.createElement('div');
    editorFixRow.className = 'cfx-toggle-row';
    const editorFixInfo = document.createElement('div');
    editorFixInfo.innerHTML = `
      <div class="cfx-toggle-label">Editor Scroll Fix</div>
      <div class="cfx-toggle-desc">Mitigate abnormal cursor/scroll jumping in Confluence editor</div>
    `;
    const editorFixToggle = document.createElement('label');
    editorFixToggle.className = 'cfx-toggle';
    const editorFixCheckbox = document.createElement('input');
    editorFixCheckbox.type = 'checkbox';
    editorFixCheckbox.checked = settings[CFX.STORAGE_KEYS.ENABLE_EDITOR_SCROLL_FIX]
      ?? CFX.DEFAULTS.ENABLE_EDITOR_SCROLL_FIX;
    const editorFixSlider = document.createElement('span');
    editorFixSlider.className = 'cfx-toggle-slider';
    editorFixToggle.appendChild(editorFixCheckbox);
    editorFixToggle.appendChild(editorFixSlider);
    editorFixRow.appendChild(editorFixInfo);
    editorFixRow.appendChild(editorFixToggle);
    form.appendChild(editorFixRow);

    // ── Save Button ──
    const saveRow = document.createElement('div');
    saveRow.style.cssText = 'margin-top:16px;display:flex;gap:8px;align-items:center;';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'cfx-btn cfx-btn-primary';
    saveBtn.textContent = 'Save Settings';
    const feedbackEl = document.createElement('span');
    feedbackEl.style.cssText = 'font-size:12px;';

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      feedbackEl.textContent = '';

      const newSettings = {
        [CFX.STORAGE_KEYS.AI_PROVIDER]: providerSelect.value,
        [CFX.STORAGE_KEYS.AI_ENDPOINT]: endpointInput.value.trim(),
        [CFX.STORAGE_KEYS.AI_API_KEY]: keyInput.value.trim(),
        [CFX.STORAGE_KEYS.AI_MODEL]: modelInput.value.trim(),
        [CFX.STORAGE_KEYS.CONFLUENCE_AUTH_MODE]: authModeSelect.value,
        [CFX.STORAGE_KEYS.CONFLUENCE_DEPLOYMENT]: deploymentSelect.value,
        [CFX.STORAGE_KEYS.CONFLUENCE_USER_EMAIL]: confluenceEmailInput.value.trim(),
        [CFX.STORAGE_KEYS.CONFLUENCE_API_TOKEN]: confluenceTokenInput.value.trim(),
        [CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS]: parseAllowedOrigins(allowedOriginsInput.value),
        [CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]: baseUrlInput.value.trim(),
        [CFX.STORAGE_KEYS.MAX_CONTENT_LENGTH]: parseInt(maxLenInput.value, 10) || CFX.DEFAULTS.MAX_CONTENT_LENGTH,
        [CFX.STORAGE_KEYS.ENABLE_COPY_MARKDOWN]: copyMdCheckbox.checked,
        [CFX.STORAGE_KEYS.ENABLE_THEME_BUTTON]: themeBtnCheckbox.checked,
        [CFX.STORAGE_KEYS.ENABLE_EDITOR_SCROLL_FIX]: editorFixCheckbox.checked,
      };

      try {
        if (newSettings[CFX.STORAGE_KEYS.CONFLUENCE_AUTH_MODE] === 'token') {
          if (
            newSettings[CFX.STORAGE_KEYS.CONFLUENCE_DEPLOYMENT] === 'cloud' &&
            (!newSettings[CFX.STORAGE_KEYS.CONFLUENCE_USER_EMAIL] || !newSettings[CFX.STORAGE_KEYS.CONFLUENCE_API_TOKEN])
          ) {
            throw new Error('Cloud token mode requires Confluence email and API token');
          }
          if (
            newSettings[CFX.STORAGE_KEYS.CONFLUENCE_DEPLOYMENT] === 'dc' &&
            !newSettings[CFX.STORAGE_KEYS.CONFLUENCE_API_TOKEN]
          ) {
            throw new Error('Data Center token mode requires PAT token');
          }
        }
        if (allowedOriginsInput.value.trim() && newSettings[CFX.STORAGE_KEYS.CONFLUENCE_ALLOWED_ORIGINS].length === 0) {
          throw new Error('Allowed Confluence URLs contains no valid URL');
        }

        const api = getApi();
        if (!api) throw new Error('Extension API unavailable');
        await api.storage.local.set(newSettings);
        feedbackEl.textContent = '✓ Saved';
        feedbackEl.style.color = 'var(--cfx-success)';
      } catch (err) {
        feedbackEl.textContent = 'Save failed: ' + err.message;
        feedbackEl.style.color = 'var(--cfx-danger)';
      }

      saveBtn.disabled = false;
      setTimeout(() => { feedbackEl.textContent = ''; }, 3000);
    });

    saveRow.appendChild(saveBtn);
    saveRow.appendChild(feedbackEl);
    form.appendChild(saveRow);

    // Update endpoint/model when provider changes
    providerSelect.addEventListener('change', () => {
      const p = providerSelect.value;
      if (!endpointInput.value || Object.values(CFX.DEFAULTS.AI_PROVIDERS).some(
        (d) => d.endpoint === endpointInput.value
      )) {
        endpointInput.value = CFX.DEFAULTS.AI_PROVIDERS[p]?.endpoint || '';
      }
      if (!modelInput.value || Object.values(CFX.DEFAULTS.AI_PROVIDERS).some(
        (d) => d.model === modelInput.value
      )) {
        modelInput.value = CFX.DEFAULTS.AI_PROVIDERS[p]?.model || '';
      }
    });

    // ── Options Page link ──
    const optionsLink = document.createElement('div');
    optionsLink.style.cssText = 'margin-top:14px;font-size:12px;color:var(--cfx-text-muted);';
    const optionsAnchor = document.createElement('a');
    optionsAnchor.href = '#';
    optionsAnchor.style.color = 'var(--cfx-primary)';
    optionsAnchor.textContent = 'Open full options page →';
    optionsAnchor.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof chrome !== 'undefined' && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      }
    });
    optionsLink.appendChild(optionsAnchor);
    form.appendChild(optionsLink);

    container.appendChild(form);
  }

  function createField(label) {
    const field = document.createElement('div');
    field.className = 'cfx-field';
    const labelEl = document.createElement('label');
    labelEl.className = 'cfx-label';
    labelEl.textContent = label;
    field.appendChild(labelEl);
    return field;
  }

  window.cfxSettingsTab = { init, onActivate };
})();
