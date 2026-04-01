(function () {
  'use strict';

  const PROVIDERS = CFX.DEFAULTS.AI_PROVIDERS;

  const $ = (id) => document.getElementById(id);

  async function load() {
    const keys = Object.values(CFX.STORAGE_KEYS);
    const settings = await cfxApi.storage.local.get(keys);

    const provider = settings[CFX.STORAGE_KEYS.AI_PROVIDER] || 'openai';
    $('provider').value = provider;
    $('endpoint').value = settings[CFX.STORAGE_KEYS.AI_ENDPOINT] || PROVIDERS[provider]?.endpoint || '';
    $('apikey').value = settings[CFX.STORAGE_KEYS.AI_API_KEY] || '';
    $('model').value = settings[CFX.STORAGE_KEYS.AI_MODEL] || PROVIDERS[provider]?.model || '';
    $('baseUrl').value = settings[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL] || '';
    $('maxLen').value = settings[CFX.STORAGE_KEYS.MAX_CONTENT_LENGTH] || CFX.DEFAULTS.MAX_CONTENT_LENGTH;
    $('darkMode').checked = settings[CFX.STORAGE_KEYS.DARK_MODE] || false;
  }

  function showFeedback(text, ok) {
    const el = $('feedback');
    el.textContent = text;
    el.style.color = ok ? '#00875a' : '#de350b';
    setTimeout(() => { el.textContent = ''; }, 3000);
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

  $('saveBtn').addEventListener('click', async () => {
    $('saveBtn').disabled = true;
    try {
      await cfxApi.storage.local.set({
        [CFX.STORAGE_KEYS.AI_PROVIDER]: $('provider').value,
        [CFX.STORAGE_KEYS.AI_ENDPOINT]: $('endpoint').value.trim(),
        [CFX.STORAGE_KEYS.AI_API_KEY]: $('apikey').value.trim(),
        [CFX.STORAGE_KEYS.AI_MODEL]: $('model').value.trim(),
        [CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]: $('baseUrl').value.trim(),
        [CFX.STORAGE_KEYS.MAX_CONTENT_LENGTH]: parseInt($('maxLen').value, 10) || CFX.DEFAULTS.MAX_CONTENT_LENGTH,
        [CFX.STORAGE_KEYS.DARK_MODE]: $('darkMode').checked,
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
      await cfxApi.runtime.sendMessage({ type: 'CLEAR_ALL_HISTORY', payload: {} });
      showFeedback('✓ History cleared', true);
    } catch (err) {
      showFeedback('Error: ' + err.message, false);
    }
  });

  load();
})();
