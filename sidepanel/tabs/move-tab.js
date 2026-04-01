/**
 * move-tab.js
 * Page Move tab: search for source/destination pages and execute the move.
 */
(function () {
  'use strict';

  let container = null;
  let pageContext = null;
  let baseUrl = null;

  // State
  let sourcePage = null;   // { id, title, space, version }
  let destPage = null;     // { id, title, space }

  function init(containerId, ctx) {
    container = document.getElementById(containerId);
    pageContext = ctx;
    loadBaseUrl().then(render);
  }

  function onActivate(ctx) {
    pageContext = ctx;
    loadBaseUrl().then(render);
  }

  async function loadBaseUrl() {
    try {
      const stored = await cfxApi.storage.local.get([CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]);
      baseUrl = stored[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL] ||
        (pageContext && pageContext.baseUrl) || '';
    } catch (e) {
      baseUrl = (pageContext && pageContext.baseUrl) || '';
    }
  }

  async function render() {
    if (!container) return;
    container.innerHTML = '';

    const form = document.createElement('div');
    form.className = 'cfx-move-form';

    // ── Source Page ──
    const sourceTitle = document.createElement('div');
    sourceTitle.className = 'cfx-section-title';
    sourceTitle.textContent = 'Page to Move';
    form.appendChild(sourceTitle);

    // Auto-populate from current page
    if (pageContext && pageContext.pageId && pageContext.pageTitle) {
      sourcePage = {
        id: pageContext.pageId,
        title: pageContext.pageTitle,
        spaceKey: pageContext.spaceKey,
      };
    }

    const sourceCard = document.createElement('div');
    sourceCard.id = 'cfx-source-card';
    renderSourceCard(sourceCard);
    form.appendChild(sourceCard);

    // Source search (optional override)
    const sourceSearchLabel = document.createElement('div');
    sourceSearchLabel.style.cssText = 'font-size:11px;color:var(--cfx-text-muted);margin-bottom:5px;';
    sourceSearchLabel.textContent = 'Or search for a different page:';
    form.appendChild(sourceSearchLabel);

    const sourceSearch = cfxSearchBox.createSearchBox({
      placeholder: 'Search source page...',
      baseUrl,
      onSelect: (page) => {
        sourcePage = { id: page.id, title: page.title, spaceKey: page.space?.key || '' };
        renderSourceCard(sourceCard);
        sourceSearch.clear();
        updateMoveButton();
      },
    });
    form.appendChild(sourceSearch);

    // ── Destination ──
    const destTitleEl = document.createElement('div');
    destTitleEl.className = 'cfx-section-title';
    destTitleEl.textContent = 'New Parent Page';
    form.appendChild(destTitleEl);

    const destCard = document.createElement('div');
    destCard.id = 'cfx-dest-card';
    form.appendChild(destCard);

    const destTabs = document.createElement('div');
    destTabs.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';

    let activeDestMode = 'search';

    const searchModeBtn = createModeBtn('Search', true);
    const treeModeBtn = createModeBtn('Browse Tree', false);

    const destSearchContainer = document.createElement('div');
    const destTreeContainer = document.createElement('div');
    destTreeContainer.style.display = 'none';

    searchModeBtn.addEventListener('click', () => {
      activeDestMode = 'search';
      searchModeBtn.classList.add('active-mode');
      treeModeBtn.classList.remove('active-mode');
      destSearchContainer.style.display = 'block';
      destTreeContainer.style.display = 'none';
    });

    treeModeBtn.addEventListener('click', () => {
      activeDestMode = 'tree';
      treeModeBtn.classList.add('active-mode');
      searchModeBtn.classList.remove('active-mode');
      destSearchContainer.style.display = 'none';
      destTreeContainer.style.display = 'block';
    });

    destTabs.appendChild(searchModeBtn);
    destTabs.appendChild(treeModeBtn);
    form.appendChild(destTabs);

    // Destination search
    const destSearch = cfxSearchBox.createSearchBox({
      placeholder: 'Search destination parent page...',
      baseUrl,
      onSelect: (page) => {
        destPage = { id: page.id, title: page.title, spaceKey: page.space?.key || '' };
        renderDestCard(destCard);
        destSearch.clear();
        updateMoveButton();
      },
    });
    destSearchContainer.appendChild(destSearch);
    form.appendChild(destSearchContainer);

    // Destination tree
    const tree = cfxPageTree.createPageTree({
      baseUrl,
      onSelect: (page) => {
        destPage = { id: page.id, title: page.title, spaceKey: page.space?.key || '' };
        renderDestCard(destCard);
        updateMoveButton();
      },
    });
    destTreeContainer.appendChild(tree);
    form.appendChild(destTreeContainer);

    // ── Status & Move Button ──
    const statusEl = document.createElement('div');
    statusEl.id = 'cfx-move-status';
    statusEl.style.marginTop = '12px';
    form.appendChild(statusEl);

    const moveBtn = document.createElement('button');
    moveBtn.id = 'cfx-move-btn';
    moveBtn.className = 'cfx-btn cfx-btn-primary';
    moveBtn.style.marginTop = '12px';
    moveBtn.disabled = true;
    moveBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/>
        <line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
      </svg>
      Move Page
    `;
    form.appendChild(moveBtn);

    container.appendChild(form);

    // Initial render
    renderSourceCard(sourceCard);
    renderDestCard(destCard);

    function updateMoveButton() {
      moveBtn.disabled = !(sourcePage && destPage && sourcePage.id !== destPage.id);
    }

    moveBtn.addEventListener('click', () => executeMoveFlow(statusEl, moveBtn));
  }

  function createModeBtn(label, isDefault) {
    const btn = document.createElement('button');
    btn.className = `cfx-btn cfx-btn-secondary${isDefault ? ' active-mode' : ''}`;
    btn.style.fontSize = '11px';
    btn.textContent = label;
    btn.style.cssText += ';flex:1;';
    return btn;
  }

  function renderSourceCard(card) {
    card.innerHTML = '';
    if (!sourcePage) {
      card.innerHTML = '<div style="font-size:12px;color:var(--cfx-text-muted);padding:8px 0;">No page selected</div>';
      return;
    }
    card.className = 'cfx-page-card';
    card.innerHTML = `
      <div class="cfx-page-card-title">${escHtml(sourcePage.title)}</div>
      <div class="cfx-page-card-meta">Space: ${escHtml(sourcePage.spaceKey || '—')} · ID: ${sourcePage.id}</div>
    `;
  }

  function renderDestCard(card) {
    card.innerHTML = '';
    if (!destPage) {
      card.innerHTML = '<div style="font-size:12px;color:var(--cfx-text-muted);padding:4px 0;">No destination selected</div>';
      return;
    }
    card.className = 'cfx-page-card';
    card.style.borderColor = 'var(--cfx-border-focus)';
    card.innerHTML = `
      <div class="cfx-page-card-title">→ ${escHtml(destPage.title)}</div>
      <div class="cfx-page-card-meta">Space: ${escHtml(destPage.spaceKey || '—')} · ID: ${destPage.id}</div>
    `;
  }

  async function executeMoveFlow(statusEl, moveBtn) {
    if (!sourcePage || !destPage) return;
    if (sourcePage.id === destPage.id) {
      showStatus(statusEl, 'Source and destination are the same page.', 'error');
      return;
    }

    moveBtn.disabled = true;
    moveBtn.innerHTML = '<div class="cfx-spinner"></div> Moving...';
    statusEl.innerHTML = '';

    try {
      const response = await cfxApi.runtime.sendMessage({
        type: MSG.MOVE_PAGE,
        payload: {
          baseUrl,
          pageId: sourcePage.id,
          newAncestorId: destPage.id,
        },
      });

      if (response && response.success) {
        showStatus(
          statusEl,
          `✓ "${sourcePage.title}" moved under "${destPage.title}" successfully.`,
          'success'
        );
        // Clear destination selection
        destPage = null;
        const destCard = document.getElementById('cfx-dest-card');
        if (destCard) renderDestCard(destCard);
      } else {
        showStatus(statusEl, `Move failed: ${response?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      showStatus(statusEl, `Error: ${err.message}`, 'error');
    }

    moveBtn.disabled = false;
    moveBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/>
        <line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
      </svg>
      Move Page
    `;
    moveBtn.disabled = !(sourcePage && destPage && sourcePage.id !== destPage.id);
  }

  function showStatus(el, message, type) {
    el.innerHTML = '';
    const alert = document.createElement('div');
    alert.className = `cfx-alert cfx-alert-${type === 'success' ? 'success' : 'error'}`;
    alert.textContent = message;
    el.appendChild(alert);
  }

  function escHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.cfxMoveTab = { init, onActivate };
})();
