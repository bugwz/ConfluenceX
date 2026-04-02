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
  let orgRunState = null;      // { baseUrl, snapshot, plan, dryRun, runId, executionResult }
  let orgProgressBound = false;

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
    bindOrgProgressListener();
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
    addSystemMessage('ConfluenceX is ready. Ask AI to edit the page, or use "/organize <goal>" to plan tree reorganization.');

    // Auto-fetch if we have context
    if (pageContext && pageContext.isConfluencePage && pageContext.pageId) {
      fetchPageContent();
    } else if (pageContext && !pageContext.isConfluencePage) {
      addSystemMessage('Navigate to a Confluence page to start editing.');
    }
  }

  // ─── Page Content ────────────────────────────────────────────────────────────

  async function fetchPageContent() {
    if (!pageContext || !pageContext.pageId) return false;

    setStatus('Loading page content...');

    try {
      const stored = await cfxApi.storage.local.get([CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]);
      const baseUrlCandidates = [
        stored[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL],
        pageContext.baseUrl,
      ].filter(Boolean);
      const uniqueBaseUrls = [...new Set(baseUrlCandidates)];

      let lastError = null;
      for (const baseUrl of uniqueBaseUrls) {
        const response = await cfxApi.runtime.sendMessage({
          type: MSG.FETCH_PAGE_CONTENT,
          payload: { baseUrl, pageId: pageContext.pageId },
        });

        if (response && response.success) {
          pageData = response.data;
          const title = pageData.title;
          const version = pageData.version?.number;
          setStatus(`Loaded: ${title} (v${version})`);
          addSystemMessage(`Page loaded: "${title}" (v${version}) — you can now ask AI to edit it.`);
          return true;
        }

        lastError = response?.error || 'Unknown error';
      }

      setStatus('Failed to load page');
      addSystemMessage(`Could not load page content: ${lastError}. Make sure you are logged into Confluence.`);
      return false;
    } catch (err) {
      setStatus('Error');
      addSystemMessage(`Error loading page: ${err.message}`);
      return false;
    }
  }

  async function refreshPageContextFromActiveTab() {
    try {
      const tabs = await cfxApi.tabs.query({ active: true, currentWindow: true });
      if (!tabs || !tabs.length) return null;
      const tab = tabs[0];
      const response = await cfxApi.tabs.sendMessage(tab.id, { type: MSG.GET_PAGE_CONTEXT });
      if (!response || !response.success || !response.data) return null;
      pageContext = response.data;
      return pageContext;
    } catch (err) {
      return null;
    }
  }

  async function ensurePageDataLoaded() {
    if (pageData) return true;
    await refreshPageContextFromActiveTab();
    if (!pageContext || !pageContext.isConfluencePage || !pageContext.pageId) return false;
    return fetchPageContent();
  }

  // ─── Chat Flow ────────────────────────────────────────────────────────────────

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isLoading) return;

    inputEl.value = '';
    setLoading(true);

    // Show user message
    addMessage('user', text);

    if (isOrganizeCommand(text)) {
      try {
        await handleOrganizeCommand(text);
      } catch (err) {
        addMessage('assistant', `Organizer error: ${err.message}`);
      } finally {
        setLoading(false);
        scrollToBottom();
      }
      return;
    }

    if (!pageData && !(await ensurePageDataLoaded())) {
      setLoading(false);
      addSystemMessage('Page content not loaded yet. Please wait or navigate to a Confluence page.');
      return;
    }

    if (pendingEdit) {
      setLoading(false);
      addSystemMessage('You have a pending edit. Please Apply or Reject it before sending another message.');
      return;
    }

    try {
      // Build AI messages
      const pageContent = pageData.body?.storage?.value || '';
      const maxLen = await getMaxContentLength();
      if (!globalThis.aiClient || typeof globalThis.aiClient.buildMessages !== 'function') {
        throw new Error('AI client is unavailable. Please reload the extension.');
      }
      const messages = globalThis.aiClient.buildMessages(chatHistory, pageContent, text, maxLen);

      // Create streaming message element
      const streamMsg = cfxChatMessage.createStreamingMessage();
      messagesEl.appendChild(streamMsg.element);
      scrollToBottom();

      // Open a port for streaming communication
      const port = cfxApi.runtime.connect({ name: MSG.AI_STREAM_PORT });

      let streamDone = false;
      let errorReported = false;

      await new Promise((resolve, reject) => {
        port.onMessage.addListener((msg) => {
          switch (msg.type) {
            case MSG.AI_STREAM_STATUS:
              streamMsg.setStatus(msg.status);
              setStatus(msg.status === 'thinking' ? 'AI is thinking...' :
                        msg.status === 'generating' ? 'AI is generating...' :
                        msg.status === 'connecting' ? 'Connecting to AI...' : '');
              break;

            case MSG.AI_STREAM_THINKING:
              streamMsg.appendThinking(msg.delta);
              scrollToBottom();
              break;

            case MSG.AI_STREAM_DELTA:
              streamMsg.appendDelta(msg.delta);
              scrollToBottom();
              break;

            case MSG.AI_STREAM_DONE: {
              streamDone = true;
              const aiText = msg.content || streamMsg.getContent();

              // Add AI response to chat history
              chatHistory.push({ role: 'user', content: text });
              chatHistory.push({ role: 'assistant', content: aiText });

              // Try to extract content
              const extracted = xmlUtils.sanitizeAiOutput(aiText);

              if (extracted.content) {
                // Strip <confluencex-content> from the displayed message —
                // only show the conversational prefix, not the raw XHTML payload.
                const conversationalPart = aiText.split('<confluencex-content>')[0].trim();
                streamMsg.replaceContent(conversationalPart);
              }

              streamMsg.setStatus('done');
              streamMsg.finalize(Date.now());

              if (extracted.content) {
                showDiffAndActions(pageContent, extracted.content, text, aiText);
              } else if (extracted.error) {
                addSystemMessage(`Note: ${extracted.error} The AI's response was shown above but no changes were applied.`);
              }

              port.disconnect();
              resolve();
              break;
            }

            case MSG.AI_STREAM_ERROR:
              streamDone = true;
              errorReported = true;
              streamMsg.setStatus('error');
              streamMsg.element.remove();
              addMessage('assistant', `Error: ${msg.error}`);
              port.disconnect();
              resolve();
              break;
          }
        });

        port.onDisconnect.addListener(() => {
          if (!streamDone) {
            // Port closed unexpectedly before stream completed — treat as error
            errorReported = true;
            streamMsg.setStatus('error');
            streamMsg.element.remove();
            addMessage('assistant', 'Error: Connection to AI was interrupted. Please try again.');
            resolve();
          }
        });

        // Send the request through the port
        port.postMessage({
          type: MSG.AI_CHAT_REQUEST,
          payload: { messages },
        });
      });
    } catch (err) {
      // Surface errors not already reported by stream/disconnect handlers
      if (!errorReported) {
        addMessage('assistant', `Error: ${err.message}`);
      }
    } finally {
      setLoading(false);
      setStatus('');
      scrollToBottom();
    }
  }

  function isOrganizeCommand(text) {
    return /^\/organize\b/i.test(text.trim()) || /^\/reorg\b/i.test(text.trim());
  }

  async function getConfluenceBaseUrl() {
    const stored = await cfxApi.storage.local.get([CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL]);
    return stored[CFX.STORAGE_KEYS.CONFLUENCE_BASE_URL] || pageContext?.baseUrl || '';
  }

  function extractOrganizeGoal(text) {
    return text.replace(/^\/organize\b/i, '').replace(/^\/reorg\b/i, '').trim();
  }

  async function handleOrganizeCommand(text) {
    const goal = extractOrganizeGoal(text);
    if (!goal) {
      addSystemMessage('Use format: /organize <how to reorganize this subtree>');
      return;
    }
    if (!pageContext?.isConfluencePage || !pageContext?.pageId) {
      addSystemMessage('Open a Confluence page first. The current page is used as organize root.');
      return;
    }

    const baseUrl = await getConfluenceBaseUrl();
    if (!baseUrl) {
      addSystemMessage('Confluence base URL not configured.');
      return;
    }

    addSystemMessage('Organizer: scanning subtree...');
    const planResponse = await cfxApi.runtime.sendMessage({
      type: MSG.AI_ORG_PLAN_REQUEST,
      payload: {
        baseUrl,
        rootPageId: pageContext.pageId,
        userRequest: goal,
      },
    });
    if (!planResponse?.success) {
      throw new Error(planResponse?.error || 'Failed to build organization plan');
    }

    const { snapshot, plan } = planResponse.data;
    const validationResponse = await cfxApi.runtime.sendMessage({
      type: MSG.AI_ORG_VALIDATE_REQUEST,
      payload: { snapshot, plan },
    });
    if (!validationResponse?.success) {
      throw new Error(validationResponse?.error || 'Failed to validate organization plan');
    }

    const validation = validationResponse.data;
    orgRunState = {
      baseUrl,
      snapshot,
      plan,
      dryRun: validation.dryRun,
      validation,
      runId: null,
      executionResult: null,
    };

    addMessage('assistant', [
      `Organization plan ready for subtree "${snapshot.rootTitle}".`,
      `- Nodes scanned: ${snapshot.total}`,
      `- Operations: ${plan.operations.length}`,
      `- Batches: ${validation.dryRun?.batches?.length || 0}`,
      `- Validation: ${validation.valid ? 'pass' : 'failed'}`,
    ].join('\n'));

    renderOrganizationCard();
  }

  function renderOrganizationCard() {
    if (!orgRunState || !messagesEl) return;

    const existing = document.getElementById('cfx-org-card');
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.id = 'cfx-org-card';
    card.className = 'cfx-org-card';

    const validation = orgRunState.validation || {};
    const dryRun = orgRunState.dryRun || {};
    const risk = dryRun.riskReport || { low: 0, medium: 0, high: 0 };

    const title = document.createElement('div');
    title.className = 'cfx-org-card-title';
    title.textContent = 'Tree Organization Dry-run';
    card.appendChild(title);

    const summary = document.createElement('div');
    summary.className = 'cfx-org-card-summary';
    summary.textContent = orgRunState.plan?.summary || 'No summary.';
    card.appendChild(summary);

    const stats = document.createElement('div');
    stats.className = 'cfx-org-card-stats';
    stats.textContent = `Ops ${dryRun.totalOperations || 0} · Batches ${dryRun.batches?.length || 0} · Risk L/M/H ${risk.low}/${risk.medium}/${risk.high}`;
    card.appendChild(stats);

    const preview = document.createElement('div');
    preview.className = 'cfx-org-card-preview';
    const previewLines = (dryRun.previews || []).slice(0, 6).map((item) => {
      return `${item.type === 'MOVE_PAGE' ? 'Move' : 'Rename'}: ${item.beforePath} -> ${item.afterPath}`;
    });
    preview.textContent = previewLines.length ? previewLines.join('\n') : 'No operations to preview.';
    card.appendChild(preview);

    if (validation.errors?.length) {
      const errors = document.createElement('div');
      errors.className = 'cfx-org-card-errors';
      errors.textContent = `Validation errors: ${validation.errors.join(' | ')}`;
      card.appendChild(errors);
    }

    const controls = document.createElement('div');
    controls.className = 'cfx-org-card-controls';

    const execBtn = document.createElement('button');
    execBtn.className = 'cfx-btn cfx-btn-success';
    execBtn.textContent = 'Execute Plan';
    execBtn.disabled = !validation.valid || !orgRunState.plan?.operations?.length;
    execBtn.addEventListener('click', executeOrganizationPlan);

    const abortBtn = document.createElement('button');
    abortBtn.className = 'cfx-btn cfx-btn-danger';
    abortBtn.textContent = 'Abort';
    abortBtn.disabled = !orgRunState.runId;
    abortBtn.addEventListener('click', abortOrganizationRun);

    const rollbackBtn = document.createElement('button');
    rollbackBtn.className = 'cfx-btn cfx-btn-secondary';
    rollbackBtn.textContent = 'Rollback';
    rollbackBtn.disabled = !orgRunState.runId || !orgRunState.executionResult;
    rollbackBtn.addEventListener('click', rollbackOrganizationRun);

    controls.appendChild(execBtn);
    controls.appendChild(abortBtn);
    controls.appendChild(rollbackBtn);
    card.appendChild(controls);

    messagesEl.appendChild(card);
    scrollToBottom();
  }

  async function executeOrganizationPlan() {
    if (!orgRunState) return;
    if (!confirm('Execute this organization plan? This will modify page tree structure.')) return;

    addSystemMessage('Organizer: executing plan...');
    const response = await cfxApi.runtime.sendMessage({
      type: MSG.AI_ORG_EXECUTE_REQUEST,
      payload: {
        baseUrl: orgRunState.baseUrl,
        snapshot: orgRunState.snapshot,
        plan: orgRunState.plan,
      },
    });

    if (!response?.success) {
      addSystemMessage(`Organizer execution failed: ${response?.error || 'Unknown error'}`);
      if (response?.data?.runId) {
        orgRunState.runId = response.data.runId;
      }
      renderOrganizationCard();
      return;
    }

    orgRunState.runId = response.data.runId;
    orgRunState.executionResult = response.data;
    addSystemMessage(`Organizer completed: ${response.data.executed}/${response.data.totalOperations} operations.`);
    renderOrganizationCard();
  }

  async function abortOrganizationRun() {
    if (!orgRunState?.runId) return;
    const response = await cfxApi.runtime.sendMessage({
      type: MSG.AI_ORG_ABORT_REQUEST,
      payload: { runId: orgRunState.runId },
    });
    if (response?.success) {
      addSystemMessage(`Organizer run ${orgRunState.runId} marked for abort.`);
    } else {
      addSystemMessage(`Abort failed: ${response?.error || 'Unknown error'}`);
    }
  }

  async function rollbackOrganizationRun() {
    if (!orgRunState?.runId) return;
    if (!confirm(`Rollback organizer run ${orgRunState.runId}?`)) return;

    const response = await cfxApi.runtime.sendMessage({
      type: MSG.AI_ORG_ROLLBACK_REQUEST,
      payload: {
        runId: orgRunState.runId,
        baseUrl: orgRunState.baseUrl,
      },
    });
    if (response?.success) {
      addSystemMessage(`Rollback completed: ${response.data.rolledBack} operations reverted.`);
      orgRunState.executionResult = null;
      renderOrganizationCard();
    } else {
      addSystemMessage(`Rollback failed: ${response?.error || 'Unknown error'}`);
    }
  }

  function bindOrgProgressListener() {
    if (orgProgressBound || !cfxApi.runtime?.onMessage) return;
    cfxApi.runtime.onMessage.addListener((message) => {
      if (!message || message.type !== MSG.AI_ORG_EXECUTE_PROGRESS) return;
      const payload = message.payload || {};
      if (!orgRunState || (orgRunState.runId && payload.runId !== orgRunState.runId)) return;

      if (payload.runId && !orgRunState.runId) {
        orgRunState.runId = payload.runId;
        renderOrganizationCard();
      }

      const stageMap = {
        started: 'Organizer started',
        batch_started: `Batch ${payload.batchIndex + 1} started`,
        op_started: `Running ${payload.opId} (${payload.type})`,
        op_succeeded: `${payload.opId} succeeded`,
        op_failed: `${payload.opId} failed: ${payload.error}`,
        batch_succeeded: `Batch ${payload.batchIndex + 1} completed`,
        completed: 'Organizer finished',
        aborted: 'Organizer aborted',
        rollback_step: `Rolled back ${payload.opId}`,
        rolled_back: 'Rollback finished',
      };
      if (stageMap[payload.stage]) {
        addSystemMessage(stageMap[payload.stage]);
      }
    });
    orgProgressBound = true;
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
