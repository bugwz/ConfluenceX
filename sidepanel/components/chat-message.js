/**
 * chat-message.js
 * Renders individual chat messages in the AI chat UI.
 */
(function () {
  'use strict';

  /**
   * Apply minimal markdown rendering (bold, italic, inline code, code blocks).
   */
  function renderMarkdown(text) {
    if (!text) return '';

    // Escape HTML first
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks (``` ... ```)
    html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
      return `<pre>${code.trim()}</pre>`;
    });

    // Inline code
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  /**
   * Create a chat message DOM element.
   * @param {string} role - 'user' | 'assistant' | 'system'
   * @param {string} content - The message text
   * @param {number} timestamp - Date.now() when message was created
   * @returns {HTMLElement}
   */
  function createMessageElement(role, content, timestamp) {
    const wrapper = document.createElement('div');

    if (role === 'system') {
      wrapper.className = 'cfx-msg cfx-msg-system';
      wrapper.textContent = content;
      return wrapper;
    }

    wrapper.className = `cfx-msg cfx-msg-${role === 'user' ? 'user' : 'ai'}`;

    const contentEl = document.createElement('div');
    contentEl.className = 'cfx-msg-content';

    if (role === 'user') {
      contentEl.textContent = content;
    } else {
      // Render markdown for AI messages
      contentEl.innerHTML = renderMarkdown(content);
    }

    wrapper.appendChild(contentEl);

    if (timestamp) {
      const timeEl = document.createElement('span');
      timeEl.className = 'cfx-msg-timestamp';
      timeEl.textContent = formatTime(timestamp);
      wrapper.appendChild(timeEl);
    }

    return wrapper;
  }

  /**
   * Create a typing indicator element.
   */
  function createTypingIndicator() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cfx-msg cfx-msg-ai cfx-typing';
    wrapper.id = 'cfx-typing-indicator';

    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'cfx-typing-dot';
      wrapper.appendChild(dot);
    }

    return wrapper;
  }

  /**
   * Create a streaming message element that can be progressively updated.
   * Returns an object with { element, appendDelta, appendThinking, setStatus, finalize }.
   */
  function createStreamingMessage() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cfx-msg cfx-msg-ai cfx-msg-streaming';

    // Status indicator
    const statusEl = document.createElement('div');
    statusEl.className = 'cfx-stream-status';
    statusEl.innerHTML = '<div class="cfx-stream-status-dot"></div><span>Connecting...</span>';
    wrapper.appendChild(statusEl);

    // Thinking block (hidden initially)
    const thinkingBlock = document.createElement('div');
    thinkingBlock.className = 'cfx-thinking-block';
    thinkingBlock.style.display = 'none';

    const thinkingHeader = document.createElement('div');
    thinkingHeader.className = 'cfx-thinking-header';
    thinkingHeader.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
      </svg>
      <span>Thinking</span>
      <svg class="cfx-thinking-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    `;
    thinkingHeader.addEventListener('click', () => {
      const isCollapsed = thinkingContent.style.display === 'none';
      thinkingContent.style.display = isCollapsed ? 'block' : 'none';
      thinkingHeader.querySelector('.cfx-thinking-chevron').style.transform = isCollapsed ? 'rotate(180deg)' : '';
    });

    const thinkingContent = document.createElement('div');
    thinkingContent.className = 'cfx-thinking-content';

    thinkingBlock.appendChild(thinkingHeader);
    thinkingBlock.appendChild(thinkingContent);
    wrapper.appendChild(thinkingBlock);

    // Content area
    const contentEl = document.createElement('div');
    contentEl.className = 'cfx-msg-content';
    wrapper.appendChild(contentEl);

    // Cursor blink
    const cursor = document.createElement('span');
    cursor.className = 'cfx-stream-cursor';
    contentEl.appendChild(cursor);

    let thinkingText = '';
    let contentText = '';

    const statusLabels = {
      connecting: 'Connecting...',
      thinking: 'Thinking...',
      generating: 'Generating...',
      done: '',
      error: 'Error',
    };

    return {
      element: wrapper,

      setStatus(status) {
        const label = statusLabels[status] || status;
        if (status === 'done' || status === 'error') {
          statusEl.style.display = 'none';
        } else {
          statusEl.style.display = 'flex';
          statusEl.querySelector('span').textContent = label;
          // Adjust dot animation based on status
          const dot = statusEl.querySelector('.cfx-stream-status-dot');
          dot.className = 'cfx-stream-status-dot';
          if (status === 'thinking') dot.classList.add('cfx-status-thinking');
          if (status === 'generating') dot.classList.add('cfx-status-generating');
        }
      },

      appendThinking(delta) {
        thinkingBlock.style.display = 'block';
        thinkingText += delta;
        thinkingContent.textContent = thinkingText;
      },

      appendDelta(delta) {
        contentText += delta;
        // Re-render markdown with cursor
        contentEl.innerHTML = renderMarkdown(contentText);
        contentEl.appendChild(cursor);
      },

      finalize(timestamp) {
        wrapper.classList.remove('cfx-msg-streaming');
        // Remove cursor
        cursor.remove();
        statusEl.remove();
        // Final markdown render
        if (contentText) {
          contentEl.innerHTML = renderMarkdown(contentText);
        }
        // Collapse thinking by default after done
        if (thinkingText) {
          thinkingContent.style.display = 'none';
          thinkingHeader.querySelector('.cfx-thinking-chevron').style.transform = '';
        }
        // Add timestamp
        if (timestamp) {
          const timeEl = document.createElement('span');
          timeEl.className = 'cfx-msg-timestamp';
          timeEl.textContent = formatTime(timestamp);
          wrapper.appendChild(timeEl);
        }
      },

      replaceContent(newText) {
        contentText = newText;
        contentEl.innerHTML = renderMarkdown(contentText);
        contentEl.appendChild(cursor);
      },

      getContent() {
        return contentText;
      },

      getThinking() {
        return thinkingText;
      },
    };
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const mins = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${mins}`;
  }

  window.cfxChatMessage = {
    createMessageElement,
    createTypingIndicator,
    createStreamingMessage,
  };
})();
