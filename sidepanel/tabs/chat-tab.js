/**
 * chat-tab.js
 * AI Chat tab: the core feature of ConfluenceX.
 * Handles the full chat loop: fetch page, send to AI, show diff, apply/reject, history.
 */
(function () {
  'use strict';

  let container = null;
  let pageContext = null;
  let pageData = null;         // Full Confluence page object from API
  let chatHistory = [];        // [{role, content}] for AI context
  let pendingEdit = null;      // { snapshotId, before, after } awaiting apply/reject
  let isLoading = false;
  let showingHistory = false;

  // DOM refs
  let messagesEl = null;
  let inputEl = null;
  let sendBtn = null;
  let statusEl = null;
  let editActionsEl = null;
  let historyPanel = null;

  function init(containerId, ctx) {
    container = document.getElementById(containerId);
    pageContext = ctx;
    render();
  }

  function onActivate(ctx) {
    pageContext = ctx;
    if (!pageData && ctx && ctx.isConfluencePage && ctx.pageId) {
      fetchPageContent();
    }
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  function render() {
    if (!container) return;
    container.innerHTML = '';

    // Messages area
    messagesEl = document.createElement('div');
    messagesEl.id = 'cfx-chat-messages';
    container.appendChild(messagesEl);

    // Edit actions (apply/reject) - hidden initially
    editActionsEl = document.createElement('div');
    editActionsEl.className = 'cfx-edit-actions';
    editActionsEl.style.display = 'none';
    container.appendChild(editActionsEl);

    // History panel (hidden initially)
    historyPanel = document.createElement('div');
    historyPanel.style.cssText = 'display:none;overflow-y:auto;padding:10px;flex:1;';
    container.appendChild(historyPanel);

    // Input area
    const inputArea = document.createElement('div');
    inputArea.id = 'cfx-chat-input-area';

    inputEl = document.createElement('textarea');
    inputEl.id = 'cfx-chat-input';
    inputEl.className = 'cfx-input cfx-chat-input';
    inputEl.placeholder = 'Ask AI to edit this page... (e.g., "Add a table of contents at the top")';
    inputEl.rows = 3;
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    const footer = document.createElement('div');
    footer.id = 'cfx-chat-footer';

    statusEl = document.createElement('span');
    statusEl.id = 'cfx-chat-status';

    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '5px';

    const historyBtn = document.createElement('button');
    historyBtn.className = 'cfx-btn cfx-btn-secondary';
    historyBtn.style.fontSize = '11px';
    historyBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/>
      </svg>
      History
    `;
    historyBtn.addEventListener('click', toggleHistory);

    sendBtn = document.createElement('button');
    sendBtn.className = 'cfx-btn cfx-btn-primary';
    sendBtn.style.fontSize = '11px';
    sendBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
      Send
    `;
    sendBtn.addEventListener('click', sendMessage);

    btnGroup.appendChild(historyBtn);
    btnGroup.appendChild(sendBtn);

    footer.appendChild(statusEl);
    footer.appendChild(btnGroup);

    inputArea.appendChild(inputEl);
    inputArea.appendChild(footer);
    container.appendChild(inputArea);

    // Greet
    addSystemMessage('ConfluenceX is ready. Ask AI to edit the current Confluence page.');

    // Auto-fetch if we have context
    if (pageContext && pageContext.isConfluencePage && pageContext.pageId) {
      fetchPageContent();
    } else if (pageContext && !pageContext.isConfluencePage) {
      addSystemMessage('Navigate to a Confluence page to start editing.');
    }
  }

  // ─── Page Content ────────────────────────────────────────────────────────────

  async function fetchPageContent() {
    if (!pageContext || !pageContext.pageId) return;

    setStatus('Loading page content...');

    try {
      const stored = await cfxApi.storage.local.get([CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]);
      const baseUrl = stored[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL] || pageContext.baseUrl;

      const response = await cfxApi.runtime.sendMessage({
        type: MSG.FETCH_PAGE_CONTENT,
        payload: { baseUrl, pageId: pageContext.pageId },
      });

      if (!response || !response.success) {
        setStatus('Failed to load page');
        addSystemMessage(`Could not load page content: ${response?.error || 'Unknown error'}. Make sure you are logged into Confluence.`);
        return;
      }

      pageData = response.data;
      const title = pageData.title;
      const version = pageData.version?.number;
      setStatus(`Loaded: ${title} (v${version})`);
      addSystemMessage(`Page loaded: "${title}" (v${version}) — you can now ask AI to edit it.`);
    } catch (err) {
      setStatus('Error');
      addSystemMessage(`Error loading page: ${err.message}`);
    }
  }

  // ─── Chat Flow ────────────────────────────────────────────────────────────────

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isLoading) return;

    if (!pageData) {
      addSystemMessage('Page content not loaded yet. Please wait or navigate to a Confluence page.');
      return;
    }

    if (pendingEdit) {
      addSystemMessage('You have a pending edit. Please Apply or Reject it before sending another message.');
      return;
    }

    inputEl.value = '';
    setLoading(true);

    // Show user message
    addMessage('user', text);

    // Build AI messages
    const pageContent = pageData.body?.storage?.value || '';
    const maxLen = await getMaxContentLength();
    const messages = aiClient.buildMessages(chatHistory, pageContent, text, maxLen);

    // Show typing indicator
    const typingEl = cfxChatMessage.createTypingIndicator();
    messagesEl.appendChild(typingEl);
    scrollToBottom();

    try {
      const response = await cfxApi.runtime.sendMessage({
        type: MSG.AI_CHAT_REQUEST,
        payload: { messages },
      });

      typingEl.remove();

      if (!response || !response.success) {
        addMessage('assistant', `Error: ${response?.error || 'AI request failed'}`);
        setLoading(false);
        return;
      }

      const aiText = response.data;

      // Add AI response to chat history
      chatHistory.push({ role: 'user', content: text });
      chatHistory.push({ role: 'assistant', content: aiText });

      // Try to extract content
      const extracted = xmlUtils.sanitizeAiOutput(aiText);

      if (extracted.content) {
        // Get the conversational part (everything before the tag)
        const conversationalPart = aiText.split('<confluencex-content>')[0].trim();
        if (conversationalPart) {
          addMessage('assistant', conversationalPart);
        }

        // Show diff
        showDiffAndActions(pageContent, extracted.content, text, aiText);
      } else if (extracted.error) {
        // AI didn't return valid content — show the response and an error
        addMessage('assistant', aiText);
        addSystemMessage(`Note: ${extracted.error} The AI's response was shown above but no changes were applied.`);
      } else {
        addMessage('assistant', aiText);
      }
    } catch (err) {
      typingEl.remove();
      addMessage('assistant', `Error: ${err.message}`);
    }

    setLoading(false);
    scrollToBottom();
  }

  // ─── Diff & Apply/Reject ──────────────────────────────────────────────────────

  function showDiffAndActions(before, after, userPrompt, aiResponse) {
    // Save pending snapshot (not yet applied)
    const snapshotId = crypto.randomUUID();
    pendingEdit = { snapshotId, before, after, userPrompt, aiResponse };

    // Show diff
    const diffEl = cfxDiffViewer.createDiffElement(before, after);
    messagesEl.appendChild(diffEl);

    // Show action buttons
    editActionsEl.style.display = 'flex';
    editActionsEl.innerHTML = '';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'cfx-btn cfx-btn-success';
    applyBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Apply
    `;
    applyBtn.addEventListener('click', applyEdit);

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'cfx-btn cfx-btn-danger';
    rejectBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
      Reject
    `;
    rejectBtn.addEventListener('click', rejectEdit);

    const hint = document.createElement('span');
    hint.style.cssText = 'flex:1;font-size:11px;color:var(--cfx-text-muted);text-align:right;';
    hint.textContent = 'Review the diff and apply or reject';

    editActionsEl.appendChild(applyBtn);
    editActionsEl.appendChild(rejectBtn);
    editActionsEl.appendChild(hint);

    // Save to history (unapplied)
    saveSnapshot(false, null);

    scrollToBottom();
  }

  async function applyEdit() {
    if (!pendingEdit || !pageData) return;

    setLoading(true);
    editActionsEl.innerHTML = '<span style="font-size:12px;color:var(--cfx-text-muted)">Saving...</span>';

    try {
      const stored = await cfxApi.storage.local.get([CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]);
      const baseUrl = stored[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL] || pageContext.baseUrl;

      const currentVersion = pageData.version.number;
      const response = await cfxApi.runtime.sendMessage({
        type: MSG.SAVE_PAGE,
        payload: {
          baseUrl,
          pageId: pageContext.pageId,
          title: pageData.title,
          body: pendingEdit.after,
          version: currentVersion + 1,
          ancestors: pageData.ancestors,
        },
      });

      if (!response || !response.success) {
        const errMsg = response?.error || 'Save failed';
        editActionsEl.innerHTML = '';

        // Version conflict
        if (response?.status === 409) {
          addSystemMessage(`Version conflict: the page was edited by someone else. Please refresh and try again.`);
        } else {
          addSystemMessage(`Failed to save: ${errMsg}`);
        }
        // Re-show apply/reject
        const snapshot = pendingEdit;
        showApplyRejectButtons();
        setLoading(false);
        return;
      }

      // Success: update local pageData
      pageData.version.number = currentVersion + 1;
      pageData.body.storage.value = pendingEdit.after;

      // Mark snapshot as applied
      await updateSnapshot(currentVersion + 1);

      addSystemMessage(`Page saved successfully (v${currentVersion + 1})`);
      editActionsEl.style.display = 'none';
      pendingEdit = null;
    } catch (err) {
      addSystemMessage(`Error saving page: ${err.message}`);
      showApplyRejectButtons();
    }

    setLoading(false);
    scrollToBottom();
  }

  function showApplyRejectButtons() {
    if (!pendingEdit) return;
    editActionsEl.style.display = 'flex';
    editActionsEl.innerHTML = '';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'cfx-btn cfx-btn-success';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', applyEdit);
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'cfx-btn cfx-btn-danger';
    rejectBtn.textContent = 'Reject';
    rejectBtn.addEventListener('click', rejectEdit);
    editActionsEl.appendChild(applyBtn);
    editActionsEl.appendChild(rejectBtn);
  }

  function rejectEdit() {
    pendingEdit = null;
    editActionsEl.style.display = 'none';
    addSystemMessage('Edit rejected. You can ask AI to try a different approach.');
    scrollToBottom();
  }

  // ─── History ─────────────────────────────────────────────────────────────────

  function toggleHistory() {
    showingHistory = !showingHistory;
    messagesEl.style.display = showingHistory ? 'none' : 'flex';
    historyPanel.style.display = showingHistory ? 'block' : 'none';

    if (showingHistory && pageContext?.pageId) {
      cfxHistoryList.renderHistoryList(
        historyPanel,
        pageContext.pageId,
        onRollback,
        onViewHistoryDiff
      );
    }
  }

  async function onRollback(snapshot) {
    if (!pageData) return;

    if (!confirm(`Roll back to before: "${snapshot.userPrompt.substring(0, 60)}..."?`)) return;

    setLoading(true);

    try {
      const stored = await cfxApi.storage.local.get([CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]);
      const baseUrl = stored[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL] || pageContext.baseUrl;

      const currentResponse = await cfxApi.runtime.sendMessage({
        type: MSG.FETCH_PAGE_CONTENT,
        payload: { baseUrl, pageId: pageContext.pageId },
      });

      if (!currentResponse?.success) {
        addSystemMessage('Failed to fetch current page for rollback.');
        setLoading(false);
        return;
      }

      const currentPage = currentResponse.data;
      const currentVersion = currentPage.version.number;

      const saveResponse = await cfxApi.runtime.sendMessage({
        type: MSG.SAVE_PAGE,
        payload: {
          baseUrl,
          pageId: pageContext.pageId,
          title: currentPage.title,
          body: snapshot.contentBefore,
          version: currentVersion + 1,
          ancestors: currentPage.ancestors,
        },
      });

      if (saveResponse?.success) {
        pageData = { ...currentPage, version: { number: currentVersion + 1 } };
        pageData.body = { storage: { value: snapshot.contentBefore } };

        // Save a rollback snapshot
        await cfxApi.runtime.sendMessage({
          type: MSG.SAVE_EDIT_HISTORY,
          payload: {
            snapshot: {
              id: crypto.randomUUID(),
              pageId: pageContext.pageId,
              timestamp: Date.now(),
              contentBefore: currentPage.body?.storage?.value || '',
              contentAfter: snapshot.contentBefore,
              userPrompt: `Rollback to before: "${snapshot.userPrompt.substring(0, 60)}"`,
              aiResponse: '',
              applied: true,
              versionBefore: currentVersion,
              versionAfter: currentVersion + 1,
            },
          },
        });

        toggleHistory();
        addSystemMessage(`Rolled back to v${currentVersion + 1}`);
      } else {
        addSystemMessage(`Rollback failed: ${saveResponse?.error || 'Unknown error'}`);
      }
    } catch (err) {
      addSystemMessage(`Rollback error: ${err.message}`);
    }

    setLoading(false);
  }

  function onViewHistoryDiff(snapshot) {
    // Show diff in a modal-like overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;
      display:flex;flex-direction:column;padding:12px;
    `;

    const inner = document.createElement('div');
    inner.style.cssText = 'background:#fff;border-radius:6px;overflow:hidden;display:flex;flex-direction:column;max-height:100%;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--cfx-border);';
    header.innerHTML = `<span style="font-weight:600;font-size:13px;">Edit Diff</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;color:var(--cfx-text-secondary);';
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(closeBtn);

    const content = document.createElement('div');
    content.style.cssText = 'overflow-y:auto;padding:12px;';
    const diffEl = cfxDiffViewer.createDiffElement(snapshot.contentBefore, snapshot.contentAfter, { contextLines: 5 });
    content.appendChild(diffEl);

    inner.appendChild(header);
    inner.appendChild(content);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ─── Snapshot Helpers ─────────────────────────────────────────────────────────

  async function saveSnapshot(applied, versionAfter) {
    if (!pendingEdit || !pageContext?.pageId || !pageData) return;

    await cfxApi.runtime.sendMessage({
      type: MSG.SAVE_EDIT_HISTORY,
      payload: {
        snapshot: {
          id: pendingEdit.snapshotId,
          pageId: pageContext.pageId,
          timestamp: Date.now(),
          contentBefore: pendingEdit.before,
          contentAfter: pendingEdit.after,
          userPrompt: pendingEdit.userPrompt,
          aiResponse: pendingEdit.aiResponse,
          applied,
          versionBefore: pageData.version?.number,
          versionAfter,
        },
      },
    });
  }

  async function updateSnapshot(versionAfter) {
    if (!pendingEdit || !pageContext?.pageId) return;

    await cfxApi.runtime.sendMessage({
      type: MSG.SAVE_EDIT_HISTORY,
      payload: {
        snapshot: {
          id: pendingEdit.snapshotId,
          pageId: pageContext.pageId,
          timestamp: Date.now(),
          contentBefore: pendingEdit.before,
          contentAfter: pendingEdit.after,
          userPrompt: pendingEdit.userPrompt,
          aiResponse: pendingEdit.aiResponse,
          applied: true,
          versionBefore: pageData.version?.number - 1,
          versionAfter,
        },
      },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function addMessage(role, content) {
    if (!messagesEl) return;
    const el = cfxChatMessage.createMessageElement(role, content, Date.now());
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function addSystemMessage(text) {
    addMessage('system', text);
  }

  function setLoading(loading) {
    isLoading = loading;
    if (sendBtn) {
      sendBtn.disabled = loading;
      sendBtn.innerHTML = loading
        ? '<div class="cfx-spinner"></div>'
        : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send`;
    }
    if (inputEl) inputEl.disabled = loading;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function scrollToBottom() {
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  async function getMaxContentLength() {
    try {
      const stored = await cfxApi.storage.local.get([CFX.STORAGE_KEYS.MAX_CONTENT_LENGTH]);
      return stored[CFX.STORAGE_KEYS.MAX_CONTENT_LENGTH] || CFX.DEFAULTS.MAX_CONTENT_LENGTH;
    } catch {
      return CFX.DEFAULTS.MAX_CONTENT_LENGTH;
    }
  }

  window.cfxChatTab = { init, onActivate };
})();
