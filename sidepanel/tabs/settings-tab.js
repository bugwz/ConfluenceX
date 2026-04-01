/**
 * settings-tab.js
 * Settings tab: AI provider config, dark mode toggle, Confluence base URL.
 */
(function () {
  'use strict';

  const api = (typeof globalThis !== 'undefined' && globalThis.cfxApi)
    || (typeof window !== 'undefined' && window.cfxApi)
    || null;

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
      if (!api) throw new Error('Extension API unavailable');
      settings = await api.storage.local.get(allKeys);
    } catch (e) { /* use defaults */ }

    const provider = settings[CFX.STORAGE_KEYS.AI_PROVIDER] || 'openai';

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

    // ── Dark Mode Toggle ──
    const darkModeRow = document.createElement('div');
    darkModeRow.className = 'cfx-toggle-row';
    const darkModeInfo = document.createElement('div');
    darkModeInfo.innerHTML = `
      <div class="cfx-toggle-label">Dark Mode</div>
      <div class="cfx-toggle-desc">Apply dark theme to Confluence pages</div>
    `;
    const darkModeToggle = document.createElement('label');
    darkModeToggle.className = 'cfx-toggle';
    const darkModeCheckbox = document.createElement('input');
    darkModeCheckbox.type = 'checkbox';
    darkModeCheckbox.checked = settings[CFX.STORAGE_KEYS.DARK_MODE] || false;
    darkModeCheckbox.addEventListener('change', async () => {
      const enabled = darkModeCheckbox.checked;
      if (!api) throw new Error('Extension API unavailable');
      await api.storage.local.set({ [CFX.STORAGE_KEYS.DARK_MODE]: enabled });
      // Notify content script
      try {
        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs.length > 0) {
          await api.tabs.sendMessage(tabs[0].id, {
            type: MSG.TOGGLE_DARK_MODE,
            payload: { enable: enabled },
          });
        }
      } catch (e) { /* ignore */ }
    });
    const darkModeSlider = document.createElement('span');
    darkModeSlider.className = 'cfx-toggle-slider';
    darkModeToggle.appendChild(darkModeCheckbox);
    darkModeToggle.appendChild(darkModeSlider);
    darkModeRow.appendChild(darkModeInfo);
    darkModeRow.appendChild(darkModeToggle);
    form.appendChild(darkModeRow);

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
        [CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]: baseUrlInput.value.trim(),
        [CFX.STORAGE_KEYS.MAX_CONTENT_LENGTH]: parseInt(maxLenInput.value, 10) || CFX.DEFAULTS.MAX_CONTENT_LENGTH,
      };

      try {
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
