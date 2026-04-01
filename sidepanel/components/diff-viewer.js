/**
 * diff-viewer.js
 * Renders a before/after line diff of Confluence XHTML content.
 */
(function () {
  'use strict';

  /**
   * Create a diff viewer DOM element.
   * @param {string} before - Original XHTML content
   * @param {string} after - Modified XHTML content
   * @param {object} options - { showAll: false (only show changed lines with context) }
   * @returns {HTMLElement}
   */
  function createDiffElement(before, after, options = {}) {
    const contextLines = options.contextLines !== undefined ? options.contextLines : 3;

    const wrapper = document.createElement('div');
    wrapper.className = 'cfx-diff';

    // Header
    const header = document.createElement('div');
    header.className = 'cfx-diff-header';
    header.innerHTML = `
      <span>Content Changes</span>
      <span id="cfx-diff-stats"></span>
    `;
    wrapper.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'cfx-diff-content';

    const diffLines = xmlUtils.diffSummary(before, after);

    let addCount = 0;
    let removeCount = 0;
    diffLines.forEach((l) => {
      if (l.type === 'add') addCount++;
      if (l.type === 'remove') removeCount++;
    });

    // Update stats
    const statsEl = header.querySelector('#cfx-diff-stats');
    if (statsEl) {
      statsEl.textContent = `+${addCount} / -${removeCount}`;
      statsEl.style.color = addCount > 0 || removeCount > 0
        ? 'var(--cfx-text)'
        : 'var(--cfx-text-muted)';
    }

    if (addCount === 0 && removeCount === 0) {
      const noChange = document.createElement('div');
      noChange.className = 'cfx-search-empty';
      noChange.textContent = 'No changes detected';
      content.appendChild(noChange);
      wrapper.appendChild(content);
      return wrapper;
    }

    // Determine which lines to show (changed lines + context)
    const showLine = new Set();
    diffLines.forEach((line, idx) => {
      if (line.type !== 'keep') {
        for (let i = Math.max(0, idx - contextLines); i <= Math.min(diffLines.length - 1, idx + contextLines); i++) {
          showLine.add(i);
        }
      }
    });

    let lastShown = -1;
    diffLines.forEach((line, idx) => {
      if (!showLine.has(idx)) return;

      if (lastShown !== -1 && idx > lastShown + 1) {
        // Gap indicator
        const gap = document.createElement('div');
        gap.className = 'cfx-diff-line';
        gap.style.background = 'var(--cfx-bg-secondary)';
        gap.innerHTML = `
          <span class="cfx-diff-line-num">...</span>
          <span class="cfx-diff-line-content" style="color:var(--cfx-text-muted);font-style:italic">
            ${idx - lastShown - 1} line(s) hidden
          </span>
        `;
        content.appendChild(gap);
      }

      const lineEl = document.createElement('div');
      lineEl.className = `cfx-diff-line cfx-diff-${line.type}`;

      const numEl = document.createElement('span');
      numEl.className = 'cfx-diff-line-num';
      numEl.textContent = line.lineNum;

      const contentEl = document.createElement('span');
      contentEl.className = 'cfx-diff-line-content';
      // Escape HTML in line content
      contentEl.textContent = line.line;

      lineEl.appendChild(numEl);
      lineEl.appendChild(contentEl);
      content.appendChild(lineEl);
      lastShown = idx;
    });

    wrapper.appendChild(content);
    return wrapper;
  }

  window.cfxDiffViewer = { createDiffElement };
})();
