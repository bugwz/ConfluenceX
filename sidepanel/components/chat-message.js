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

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const mins = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${mins}`;
  }

  window.cfxChatMessage = {
    createMessageElement,
    createTypingIndicator,
  };
})();
