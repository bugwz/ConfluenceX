/**
 * editor-scroll-fix-injected.js
 * Page-context workaround for Confluence editor cursor/scroll jump issue.
 * Reference behavior: CONFSERVER-100547 mitigation.
 */
(function () {
  'use strict';

  const JUMP_THRESHOLD = 200;
  const state = window.__cfxEditorScrollFixState || {
    initialized: false,
    observer: null,
  };
  window.__cfxEditorScrollFixState = state;

  function getIframeDoc() {
    const iframe = document.getElementById('wysiwygTextarea_ifr');
    if (!iframe) return null;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc || !doc.body) return null;
    return { iframe, doc };
  }

  function restoreIfJump(saved, editorContainer, contentDoc) {
    const outerDelta = Math.abs(window.scrollY - saved.outer);
    const containerDelta = editorContainer
      ? Math.abs(editorContainer.scrollTop - saved.container)
      : 0;
    const iframeDocTop = contentDoc.documentElement ? contentDoc.documentElement.scrollTop : 0;
    const iframeBodyTop = contentDoc.body ? contentDoc.body.scrollTop : 0;
    const iframeDelta = Math.max(
      Math.abs(iframeDocTop - saved.iframeDoc),
      Math.abs(iframeBodyTop - saved.iframeBody)
    );

    if (outerDelta > JUMP_THRESHOLD) {
      window.scrollTo(0, saved.outer);
    }
    if (containerDelta > JUMP_THRESHOLD && editorContainer) {
      editorContainer.scrollTop = saved.container;
    }
    if (iframeDelta > JUMP_THRESHOLD) {
      if (contentDoc.documentElement) contentDoc.documentElement.scrollTop = saved.iframeDoc;
      if (contentDoc.body) contentDoc.body.scrollTop = saved.iframeBody;
    }
  }

  function bindForCurrentIframe() {
    const frame = getIframeDoc();
    if (!frame) return false;

    const { iframe, doc: contentDoc } = frame;
    if (contentDoc.__cfxScrollFixBound) return true;

    // Match reference behavior: keep iframe html/body height natural.
    contentDoc.documentElement.style.setProperty('height', 'auto', 'important');
    contentDoc.body.style.setProperty('height', 'auto', 'important');

    const editorContainer = document.getElementById('editor-scrollbar-content')
      || document.getElementById('content-editor')
      || iframe.parentElement;

    contentDoc.addEventListener('mousedown', () => {
      const savedScroll = {
        outer: window.scrollY,
        container: editorContainer ? editorContainer.scrollTop : 0,
        iframeDoc: contentDoc.documentElement ? contentDoc.documentElement.scrollTop : 0,
        iframeBody: contentDoc.body ? contentDoc.body.scrollTop : 0,
      };

      // Some jumps happen in the same frame, some happen slightly later.
      setTimeout(() => restoreIfJump(savedScroll, editorContainer, contentDoc), 0);
      setTimeout(() => restoreIfJump(savedScroll, editorContainer, contentDoc), 48);
    }, true);

    contentDoc.__cfxScrollFixBound = true;
    return true;
  }

  function install() {
    // Always attempt immediately.
    bindForCurrentIframe();

    if (!state.initialized) {
      state.initialized = true;

      // Strategy 1: Listen Confluence editor-ready event.
      try {
        if (typeof require === 'function') {
          require('confluence/api/event').bind('rte-ready', () => {
            setTimeout(bindForCurrentIframe, 50);
          });
        }
      } catch (e) {
        // Ignore if Confluence module API is unavailable.
      }

      // Strategy 2: Mutation observer for iframe recreation/replacement.
      state.observer = new MutationObserver(() => {
        bindForCurrentIframe();
      });
      state.observer.observe(document.documentElement, { subtree: true, childList: true });
    }

    // Strategy 3: Short polling to cover delayed iframe init.
    (function poll(attempts) {
      if (attempts <= 0 || bindForCurrentIframe()) return;
      setTimeout(() => poll(attempts - 1), 500);
    })(30);
  }

  install();
})();
