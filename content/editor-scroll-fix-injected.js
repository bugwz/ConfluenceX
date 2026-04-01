/**
 * editor-scroll-fix-injected.js
 * Page-context workaround for Confluence editor cursor/scroll jump issue.
 * Reference behavior: CONFSERVER-100547 mitigation.
 */
(function () {
  'use strict';

  if (window.__cfxEditorScrollFixPatched) return;
  window.__cfxEditorScrollFixPatched = true;

  const JUMP_THRESHOLD = 200;
  let patched = false;

  function patchIframe() {
    if (patched) return true;

    const iframe = document.getElementById('wysiwygTextarea_ifr');
    if (!iframe) return false;

    const contentDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!contentDoc || !contentDoc.body) return false;
    if (contentDoc.__cfxScrollFixBound) {
      patched = true;
      return true;
    }

    // Keep editable area height natural, avoids some jump-to-top edge cases.
    contentDoc.documentElement.style.height = 'auto';
    contentDoc.body.style.height = 'auto';

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

      setTimeout(() => {
        const outerDelta = Math.abs(window.scrollY - savedScroll.outer);
        const containerDelta = editorContainer
          ? Math.abs(editorContainer.scrollTop - savedScroll.container)
          : 0;
        const iframeDocTop = contentDoc.documentElement ? contentDoc.documentElement.scrollTop : 0;
        const iframeBodyTop = contentDoc.body ? contentDoc.body.scrollTop : 0;
        const iframeDelta = Math.max(
          Math.abs(iframeDocTop - savedScroll.iframeDoc),
          Math.abs(iframeBodyTop - savedScroll.iframeBody)
        );

        if (outerDelta > JUMP_THRESHOLD) {
          window.scrollTo(0, savedScroll.outer);
        }
        if (containerDelta > JUMP_THRESHOLD && editorContainer) {
          editorContainer.scrollTop = savedScroll.container;
        }
        if (iframeDelta > JUMP_THRESHOLD) {
          if (contentDoc.documentElement) contentDoc.documentElement.scrollTop = savedScroll.iframeDoc;
          if (contentDoc.body) contentDoc.body.scrollTop = savedScroll.iframeBody;
        }
      }, 0);
    }, true);

    contentDoc.__cfxScrollFixBound = true;
    patched = true;
    return true;
  }

  // Strategy 1: Listen Confluence editor-ready event if available.
  try {
    if (typeof require === 'function') {
      require('confluence/api/event').bind('rte-ready', () => {
        setTimeout(patchIframe, 50);
      });
    }
  } catch (e) {
    // Ignore if module API is unavailable.
  }

  // Strategy 2: Poll for iframe availability.
  (function poll(attempts) {
    if (attempts <= 0 || patchIframe()) return;
    setTimeout(() => poll(attempts - 1), 500);
  })(30);

  // Strategy 3: Observe DOM insertion for editor iframe.
  const observer = new MutationObserver((mutations) => {
    if (patched) {
      observer.disconnect();
      return;
    }

    for (let i = 0; i < mutations.length; i += 1) {
      const addedNodes = mutations[i].addedNodes || [];
      for (let j = 0; j < addedNodes.length; j += 1) {
        const node = addedNodes[j];
        if (!node || node.nodeType !== 1) continue;
        const hasIframe = node.id === 'wysiwygTextarea_ifr'
          || (node.querySelector && node.querySelector('#wysiwygTextarea_ifr'));
        if (!hasIframe) continue;

        let retries = 20;
        const interval = setInterval(() => {
          retries -= 1;
          if (patchIframe() || retries <= 0) {
            clearInterval(interval);
            observer.disconnect();
          }
        }, 200);
        return;
      }
    }
  });

  observer.observe(document.documentElement, { subtree: true, childList: true });
})();
