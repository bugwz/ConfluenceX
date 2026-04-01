/**
 * history-list.js
 * Renders edit history for the current page with rollback functionality.
 */
(function () {
  'use strict';

  /**
   * Render the history list into a container element.
   * @param {HTMLElement} container
   * @param {string} pageId
   * @param {function} onRollback - Called with snapshot when user clicks Rollback
   * @param {function} onViewDiff - Called with snapshot when user clicks View Diff
   */
  async function renderHistoryList(container, pageId, onRollback, onViewDiff) {
    container.innerHTML = '';

    // Loading state
    const loader = document.createElement('div');
    loader.className = 'cfx-empty';
    loader.innerHTML = '<div class="cfx-spinner"></div>';
    container.appendChild(loader);

    try {
      const response = await cfxApi.runtime.sendMessage({
        type: MSG.GET_EDIT_HISTORY,
        payload: { pageId },
      });

      container.innerHTML = '';

      if (!response || !response.success) {
        showError(container, response?.error || 'Failed to load history');
        return;
      }

      const history = response.data || [];

      if (history.length === 0) {
        showEmpty(container);
        return;
      }

      // Header with clear button
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
      header.innerHTML = `
        <span style="font-size:12px;color:var(--cfx-text-secondary);font-weight:600;">${history.length} edit(s)</span>
      `;
      const clearBtn = document.createElement('button');
      clearBtn.className = 'cfx-btn cfx-btn-secondary';
      clearBtn.style.fontSize = '11px';
      clearBtn.textContent = 'Clear All';
      clearBtn.addEventListener('click', async () => {
        if (!confirm('Clear all edit history for this page?')) return;
        await cfxApi.runtime.sendMessage({
          type: MSG.CLEAR_EDIT_HISTORY,
          payload: { pageId },
        });
        renderHistoryList(container, pageId, onRollback, onViewDiff);
      });
      header.appendChild(clearBtn);
      container.appendChild(header);

      history.forEach((snapshot) => {
        const item = createHistoryItem(snapshot, onRollback, onViewDiff);
        container.appendChild(item);
      });
    } catch (err) {
      container.innerHTML = '';
      showError(container, err.message);
    }
  }

  function createHistoryItem(snapshot, onRollback, onViewDiff) {
    const item = document.createElement('div');
    item.className = 'cfx-history-item';

    const header = document.createElement('div');
    header.className = 'cfx-history-item-header';

    const prompt = document.createElement('div');
    prompt.className = 'cfx-history-prompt';
    prompt.title = snapshot.userPrompt;
    prompt.textContent = snapshot.userPrompt.length > 60
      ? snapshot.userPrompt.substring(0, 60) + '...'
      : snapshot.userPrompt;

    const badge = document.createElement('span');
    badge.className = `cfx-badge ${snapshot.applied ? 'cfx-badge-applied' : 'cfx-badge-pending'}`;
    badge.textContent = snapshot.applied ? 'Applied' : 'Pending';

    header.appendChild(prompt);
    header.appendChild(badge);

    const meta = document.createElement('div');
    meta.className = 'cfx-history-meta';
    const relTime = xmlUtils.formatRelativeTime(snapshot.timestamp);
    meta.textContent = `${relTime}${snapshot.versionBefore ? ` · v${snapshot.versionBefore}` : ''}`;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:5px;margin-top:7px;';

    const viewDiffBtn = document.createElement('button');
    viewDiffBtn.className = 'cfx-btn cfx-btn-secondary';
    viewDiffBtn.style.fontSize = '11px';
    viewDiffBtn.textContent = 'View Diff';
    viewDiffBtn.addEventListener('click', () => {
      if (onViewDiff) onViewDiff(snapshot);
    });

    actions.appendChild(viewDiffBtn);

    if (snapshot.applied) {
      const rollbackBtn = document.createElement('button');
      rollbackBtn.className = 'cfx-btn cfx-btn-secondary';
      rollbackBtn.style.fontSize = '11px';
      rollbackBtn.textContent = 'Rollback';
      rollbackBtn.addEventListener('click', () => {
        if (onRollback) onRollback(snapshot);
      });
      actions.appendChild(rollbackBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'cfx-btn cfx-btn-secondary';
    deleteBtn.style.cssText = 'font-size:11px;margin-left:auto;';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Delete this entry';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await cfxApi.runtime.sendMessage({
        type: MSG.DELETE_EDIT_SNAPSHOT,
        payload: { pageId: snapshot.pageId, snapshotId: snapshot.id },
      });
      item.remove();
    });
    actions.appendChild(deleteBtn);

    item.appendChild(header);
    item.appendChild(meta);
    item.appendChild(actions);

    return item;
  }

  function showEmpty(container) {
    const empty = document.createElement('div');
    empty.className = 'cfx-empty';
    empty.innerHTML = `
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <div class="cfx-empty-title">No edit history</div>
      <div class="cfx-empty-desc">AI-suggested edits will appear here for quick rollback.</div>
    `;
    container.appendChild(empty);
  }

  function showError(container, message) {
    const alert = document.createElement('div');
    alert.className = 'cfx-alert cfx-alert-error';
    alert.textContent = message;
    container.appendChild(alert);
  }

  window.cfxHistoryList = { renderHistoryList };
})();
