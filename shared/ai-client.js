/**
 * ai-client.js
 * Adapter for multiple AI providers: OpenAI, Claude (Anthropic), and custom endpoints.
 * Runs in the background service worker context.
 */
(function () {
  'use strict';

  const SYSTEM_PROMPT = `You are ConfluenceX, an AI assistant that edits Confluence wiki pages.

When the user asks you to modify a Confluence page:
1. Analyze the current page content (provided in Confluence XHTML storage format).
2. Make the requested changes, preserving all existing structure, macros, and formatting.
3. Return your response as normal text followed by the complete modified content wrapped in <confluencex-content> tags.

Important rules:
- Always return the COMPLETE page content inside <confluencex-content> tags, not just the changed parts.
- Preserve all ac: and ri: namespaced elements exactly unless the user explicitly asks to change them.
- Keep all existing macro IDs (ac:macro-id attributes).
- Ensure the output is well-formed XML compatible with Confluence storage format.
- Do not add explanatory text or comments inside the <confluencex-content> tags.
- Use proper Confluence storage format: <p>, <h1>-<h6>, <ul>, <ol>, <li>, <table>, <tr>, <td>, <th>, <strong>, <em>, <code>, <pre>, <br />, etc.
- For Confluence macros, use <ac:structured-macro> elements.

Example response format:
"I've added a note macro at the top of the page.

<confluencex-content>
<ac:structured-macro ac:name="note"><ac:rich-text-body><p>Important notice here</p></ac:rich-text-body></ac:structured-macro>
<h2>Introduction</h2>
<p>Rest of page...</p>
</confluencex-content>"`;

  /**
   * Send a message to OpenAI-compatible API.
   */
  async function openaiChat(config, messages) {
    const endpoint = config.endpoint || CFX.DEFAULTS.AI_PROVIDERS.openai.endpoint;
    const model = config.model || CFX.DEFAULTS.AI_PROVIDERS.openai.model;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 16000,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const msg = error.error?.message || `HTTP ${response.status}`;
      throw new Error(`OpenAI API error: ${msg}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * Send a message to Anthropic Claude API.
   */
  async function claudeChat(config, messages) {
    const endpoint = config.endpoint || CFX.DEFAULTS.AI_PROVIDERS.claude.endpoint;
    const model = config.model || CFX.DEFAULTS.AI_PROVIDERS.claude.model;

    // Anthropic uses a different format: system is a top-level field, not a message
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        system: systemMsg ? systemMsg.content : SYSTEM_PROMPT,
        messages: userMessages,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const msg = error.error?.message || `HTTP ${response.status}`;
      throw new Error(`Claude API error: ${msg}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || '';
  }

  /**
   * Send a message to a custom OpenAI-compatible endpoint.
   */
  async function customChat(config, messages) {
    if (!config.endpoint) {
      throw new Error('Custom AI endpoint not configured. Please set it in Settings.');
    }

    const headers = {
      'Content-Type': 'application/json',
    };

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model || 'default',
        messages,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const msg = error.error?.message || error.message || `HTTP ${response.status}`;
      throw new Error(`AI API error: ${msg}`);
    }

    const data = await response.json();
    // Support both OpenAI format and simple {text} format
    return data.choices?.[0]?.message?.content || data.text || data.response || '';
  }

  /**
   * Main entry point. Builds messages array and dispatches to the right provider.
   * @param {object} config - { provider, endpoint, apiKey, model }
   * @param {string} pageContent - Current page XHTML storage content
   * @param {Array} chatHistory - Array of { role, content } (excluding system)
   * @param {string} userMessage - The new user message
   * @param {number} maxContentLength - Maximum content chars to include
   */
  async function sendAiMessage(config, messages) {
    // Prepend system message if not already present
    const hasSystem = messages.some((m) => m.role === 'system');
    const finalMessages = hasSystem ? messages : [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ];

    const provider = config.provider || 'openai';

    switch (provider) {
      case 'claude':
        return claudeChat(config, finalMessages);
      case 'custom':
        return customChat(config, finalMessages);
      case 'openai':
      default:
        return openaiChat(config, finalMessages);
    }
  }

  /**
   * Build the messages array for an AI chat request.
   */
  function buildMessages(chatHistory, pageContent, userMessage, maxContentLength) {
    const truncated = xmlUtils
      ? xmlUtils.truncateContent(pageContent, maxContentLength || 30000)
      : pageContent;

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    // Add chat history (up to last 10 exchanges to keep context manageable)
    const recentHistory = chatHistory.slice(-20);
    messages.push(...recentHistory);

    // Add current page content + user request
    const userContent = pageContent
      ? `Current page content (Confluence storage format):\n\`\`\`xml\n${truncated}\n\`\`\`\n\nUser request: ${userMessage}`
      : userMessage;

    messages.push({ role: 'user', content: userContent });

    return messages;
  }

  const aiClient = {
    sendAiMessage,
    buildMessages,
    SYSTEM_PROMPT,
  };

  if (typeof window !== 'undefined') {
    window.aiClient = aiClient;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.aiClient = aiClient;
  }
})();
