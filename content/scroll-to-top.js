/**
 * scroll-to-top.js
 * Floating controls for Confluence pages:
 * - scroll to top
 * - optional copy page as Markdown
 */
(function () {
  'use strict';

  const GROUP_ID = 'cfx-floating-tools';
  const SCROLL_BUTTON_ID = 'cfx-scroll-to-top';
  const COPY_BUTTON_ID = 'cfx-copy-markdown';
  const THEME_BUTTON_ID = 'cfx-theme-button';
  const SHOW_THRESHOLD = 300;

  let group = null;
  let scrollButton = null;
  let copyButton = null;
  let themeButton = null;
  let scrollHandler = null;
  let storageChangeHandler = null;
  let copyMarkdownEnabled = false;
  let themeButtonEnabled = true;
  let darkModeEnabled = false;

  function init() {
    if (document.getElementById(GROUP_ID)) return;

    group = document.createElement('div');
    group.id = GROUP_ID;
    Object.assign(group.style, {
      position: 'fixed',
      right: '24px',
      bottom: '24px',
      zIndex: '9999',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      transition: 'opacity 0.25s, transform 0.25s',
      opacity: '0',
      transform: 'translateY(10px)',
      pointerEvents: 'none',
    });

    scrollButton = createToolButton(SCROLL_BUTTON_ID, 'Back to top', 'Scroll to top', `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="18 15 12 9 6 15"/>
      </svg>
    `);
    scrollButton.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    group.appendChild(scrollButton);

    copyButton = createToolButton(COPY_BUTTON_ID, 'Copy page as Markdown', 'Copy page as Markdown', `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    `);
    copyButton.style.display = 'none';
    copyButton.addEventListener('click', copyCurrentPageAsMarkdown);
    group.appendChild(copyButton);

    themeButton = createToolButton(THEME_BUTTON_ID, 'Theme: Light', 'Theme toggle button');
    themeButton.style.display = 'none';
    themeButton.addEventListener('click', toggleThemeMode);
    group.appendChild(themeButton);

    document.body.appendChild(group);

    scrollHandler = debounce(() => {
      const shouldShow = window.scrollY > SHOW_THRESHOLD;
      group.style.opacity = shouldShow ? '1' : '0';
      group.style.transform = shouldShow ? 'translateY(0)' : 'translateY(10px)';
      group.style.pointerEvents = shouldShow ? 'auto' : 'none';
    }, 100);

    window.addEventListener('scroll', scrollHandler, { passive: true });

    loadFloatingButtonSettings();
    attachStorageListener();
    scrollHandler();
  }

  function destroy() {
    if (group) group.remove();
    if (scrollHandler) window.removeEventListener('scroll', scrollHandler);
    detachStorageListener();
    group = null;
    scrollButton = null;
    copyButton = null;
    themeButton = null;
    scrollHandler = null;
    storageChangeHandler = null;
  }

  function createToolButton(id, title, ariaLabel, iconSvg) {
    const button = document.createElement('button');
    button.id = id;
    button.title = title;
    button.setAttribute('aria-label', ariaLabel);
    if (iconSvg) button.innerHTML = iconSvg;

    Object.assign(button.style, {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      border: '1px solid rgba(0,82,204,0.2)',
      background: '#0052cc',
      color: '#ffffff',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    });

    return button;
  }

  async function loadFloatingButtonSettings() {
    try {
      const api = (typeof globalThis !== 'undefined' && globalThis.cfxApi)
        || (typeof window !== 'undefined' && window.cfxApi);
      if (!api?.storage?.local?.get) {
        setCopyButtonVisible(false);
        setThemeButtonVisible(false);
        return;
      }
      const result = await api.storage.local.get([
        CFX.STORAGE_KEYS.ENABLE_COPY_MARKDOWN,
        CFX.STORAGE_KEYS.ENABLE_THEME_BUTTON,
        CFX.STORAGE_KEYS.DARK_MODE,
      ]);
      copyMarkdownEnabled = result[CFX.STORAGE_KEYS.ENABLE_COPY_MARKDOWN]
        ?? CFX.DEFAULTS.ENABLE_COPY_MARKDOWN;
      themeButtonEnabled = result[CFX.STORAGE_KEYS.ENABLE_THEME_BUTTON]
        ?? CFX.DEFAULTS.ENABLE_THEME_BUTTON;
      darkModeEnabled = result[CFX.STORAGE_KEYS.DARK_MODE] || false;
      setCopyButtonVisible(copyMarkdownEnabled);
      setThemeButtonVisible(themeButtonEnabled);
      renderThemeButtonState(darkModeEnabled);
    } catch (e) {
      setCopyButtonVisible(false);
      setThemeButtonVisible(false);
    }
  }

  function attachStorageListener() {
    const _storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;
    if (!_storage?.onChanged) return;

    storageChangeHandler = (changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes[CFX.STORAGE_KEYS.ENABLE_COPY_MARKDOWN]) {
        const value = changes[CFX.STORAGE_KEYS.ENABLE_COPY_MARKDOWN].newValue;
        copyMarkdownEnabled = value ?? CFX.DEFAULTS.ENABLE_COPY_MARKDOWN;
        setCopyButtonVisible(copyMarkdownEnabled);
      }

      if (changes[CFX.STORAGE_KEYS.ENABLE_THEME_BUTTON]) {
        const value = changes[CFX.STORAGE_KEYS.ENABLE_THEME_BUTTON].newValue;
        themeButtonEnabled = value ?? CFX.DEFAULTS.ENABLE_THEME_BUTTON;
        setThemeButtonVisible(themeButtonEnabled);
      }

      if (changes[CFX.STORAGE_KEYS.DARK_MODE]) {
        darkModeEnabled = !!changes[CFX.STORAGE_KEYS.DARK_MODE].newValue;
        renderThemeButtonState(darkModeEnabled);
      }
    };

    _storage.onChanged.addListener(storageChangeHandler);
  }

  function detachStorageListener() {
    const _storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;
    if (_storage?.onChanged && storageChangeHandler) {
      _storage.onChanged.removeListener(storageChangeHandler);
    }
  }

  function setCopyButtonVisible(visible) {
    if (!copyButton) return;
    copyButton.style.display = visible ? 'flex' : 'none';
  }

  function setThemeButtonVisible(visible) {
    if (!themeButton) return;
    themeButton.style.display = visible ? 'flex' : 'none';
  }

  function renderThemeButtonState(isDark) {
    if (!themeButton) return;
    themeButton.title = isDark ? 'Theme: Dark' : 'Theme: Light';
    themeButton.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
    themeButton.style.background = isDark ? '#172b4d' : '#ffab00';
    themeButton.innerHTML = isDark
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>`;
  }

  async function toggleThemeMode() {
    const next = !darkModeEnabled;
    darkModeEnabled = next;
    renderThemeButtonState(next);

    try {
      const api = (typeof globalThis !== 'undefined' && globalThis.cfxApi)
        || (typeof window !== 'undefined' && window.cfxApi);
      if (api?.storage?.local?.set) {
        await api.storage.local.set({ [CFX.STORAGE_KEYS.DARK_MODE]: next });
      }
      if (window.cfxDarkMode) {
        window.cfxDarkMode.toggle(next);
      }
    } catch (e) {
      // Revert optimistic UI on failure.
      darkModeEnabled = !next;
      renderThemeButtonState(darkModeEnabled);
    }
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  async function copyCurrentPageAsMarkdown() {
    if (!copyMarkdownEnabled) return;
    const markdown = buildPageMarkdown();
    if (!markdown.trim()) return;

    const ok = await writeToClipboard(markdown);
    showCopyFeedback(ok);
  }

  function showCopyFeedback(success) {
    if (!copyButton) return;
    const originalTitle = 'Copy page as Markdown';
    copyButton.title = success ? 'Copied!' : 'Copy failed';
    copyButton.style.background = success ? '#00875a' : '#de350b';
    setTimeout(() => {
      if (!copyButton) return;
      copyButton.title = originalTitle;
      copyButton.style.background = '#0052cc';
    }, 1200);
  }

  async function writeToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      // Fallback below
    }

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  function buildPageMarkdown() {
    const ctx = window.cfxPageDetector ? window.cfxPageDetector.getPageContext() : null;
    const title = ctx?.pageTitle || document.title || 'Confluence Page';
    const sourceUrl = window.location.href;

    const contentRoot = getContentRoot();
    const contentMd = contentRoot ? htmlToMarkdown(contentRoot).trim() : document.body.innerText.trim();

    let markdown = `# ${title}\n\n`;
    markdown += `Source: ${sourceUrl}\n\n`;
    markdown += contentMd;

    // Normalize extra blank lines.
    markdown = markdown
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();

    return `${markdown}\n`;
  }

  function getContentRoot() {
    const selectors = [
      '#main-content .wiki-content',
      '#main-content .usercontent',
      '#main-content .ak-renderer-document',
      '#main-content',
    ];
    for (let i = 0; i < selectors.length; i += 1) {
      const el = document.querySelector(selectors[i]);
      if (el) return sanitizeClone(el);
    }
    return null;
  }

  function sanitizeClone(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, iframe, button, input, textarea, select').forEach((el) => el.remove());
    return clone;
  }

  function htmlToMarkdown(root) {
    return Array.from(root.childNodes).map((n) => nodeToMarkdown(n, 0)).join('');
  }

  function nodeToMarkdown(node, listDepth) {
    if (!node) return '';

    if (node.nodeType === Node.TEXT_NODE) {
      return escapeMarkdown((node.textContent || '').replace(/\s+/g, ' '));
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const text = () => Array.from(node.childNodes).map((n) => nodeToMarkdown(n, listDepth)).join('').trim();

    if (tag === 'br') return '  \n';
    if (tag === 'hr') return '\n---\n\n';
    if (tag === 'strong' || tag === 'b') return `**${text()}**`;
    if (tag === 'em' || tag === 'i') return `*${text()}*`;
    if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') return `\`${text()}\``;
    if (tag === 'pre') return `\n\`\`\`\n${node.innerText.trim()}\n\`\`\`\n\n`;
    if (tag === 'a') {
      const label = text() || (node.getAttribute('href') || '');
      const href = node.getAttribute('href') || '';
      return href ? `[${label}](${href})` : label;
    }
    if (tag === 'img') {
      const alt = escapeMarkdown(node.getAttribute('alt') || '');
      const src = node.getAttribute('src') || '';
      return src ? `![${alt}](${src})` : '';
    }
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      return `\n${'#'.repeat(level)} ${text()}\n\n`;
    }
    if (tag === 'p') return `${text()}\n\n`;
    if (tag === 'blockquote') return `\n> ${text().replace(/\n/g, '\n> ')}\n\n`;
    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(node.children)
        .filter((child) => child.tagName.toLowerCase() === 'li')
        .map((li, idx) => {
          const marker = tag === 'ol' ? `${idx + 1}.` : '-';
          return `${'  '.repeat(listDepth)}${marker} ${nodeToMarkdown(li, listDepth + 1).trim()}`;
        })
        .join('\n');
      return `${items}\n\n`;
    }
    if (tag === 'li') return `${Array.from(node.childNodes).map((n) => nodeToMarkdown(n, listDepth)).join('').trim()}`;
    if (tag === 'table') return tableToMarkdown(node);

    return Array.from(node.childNodes).map((n) => nodeToMarkdown(n, listDepth)).join('');
  }

  function tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr'))
      .map((tr) => Array.from(tr.children)
        .filter((cell) => /^(th|td)$/i.test(cell.tagName))
        .map((cell) => (cell.innerText || '').replace(/\s+/g, ' ').trim()));
    if (!rows.length) return '';

    const header = rows[0];
    const body = rows.slice(1);
    let out = `\n| ${header.join(' | ')} |\n`;
    out += `| ${header.map(() => '---').join(' | ')} |\n`;
    body.forEach((r) => {
      out += `| ${r.join(' | ')} |\n`;
    });
    return `${out}\n`;
  }

  function escapeMarkdown(text) {
    return text.replace(/([\\`*_{}\[\]()])/g, '\\$1');
  }

  window.cfxScrollToTop = { init, destroy };
})();
