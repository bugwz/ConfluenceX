/**
 * ai-client.js
 * Adapter for multiple AI providers: OpenAI, Claude (Anthropic), and custom endpoints.
 * Runs in the background service worker context.
 */
(function () {
  'use strict';

  const SYSTEM_PROMPT = `You are ConfluenceX, an AI assistant that edits Confluence wiki pages.

When the user asks you to modify a Confluence page:
1. Analyze the current page content (Confluence XHTML storage format).
2. Make only the requested changes while preserving all existing structure, macros, and formatting.
3. Return normal conversational text followed by a node-level patch in <confluencex-patch> tags.

Primary output format (preferred):
<confluencex-patch>
{
  "formatVersion": "1.0",
  "operations": [
    {
      "opId": "op_1",
      "type": "replace_node",
      "target": {
        "path": "/root/p[3]",
        "fingerprint": ""
      },
      "oldXml": "<p>old node xml exactly as in current page</p>",
      "newXml": "<p>updated node xml</p>",
      "reason": "short reason"
    }
  ]
}
</confluencex-patch>

Patch rules:
- Only use type "replace_node" in operations.
- target.path must start with /root and identify a single XML node.
- oldXml must be the exact original node content from current page.
- newXml must be valid Confluence storage XML for exactly one node.
- Preserve all ac: and ri: namespaced elements unless explicitly requested.
- Preserve macro IDs (ac:macro-id attributes) unless explicitly requested.

Fallback output format (only when patch cannot be produced reliably):
<confluencex-content>...</confluencex-content>
- If using fallback, return COMPLETE page content in valid Confluence storage XML.
- Do not add explanatory text or comments inside either XML tag block.`;

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

  // ─── Streaming Implementations ──────────────────────────────────────────────

  /**
   * Parse SSE lines from a text chunk. Returns array of parsed data objects.
   */
  function parseSSELines(text) {
    const events = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          events.push({ done: true });
        } else {
          try {
            events.push(JSON.parse(data));
          } catch (e) {
            // skip malformed JSON
          }
        }
      } else if (trimmed.startsWith('event: ')) {
        // Anthropic uses event types; store for next data line
        events.push({ _event: trimmed.slice(7).trim() });
      }
    }
    return events;
  }

  /**
   * Stream from OpenAI-compatible API.
   * @param {object} config
   * @param {Array} messages
   * @param {object} callbacks - { onStatus, onDelta, onThinking, onDone, onError }
   */
  async function openaiStream(config, messages, callbacks) {
    const endpoint = config.endpoint || CFX.DEFAULTS.AI_PROVIDERS.openai.endpoint;
    const model = config.model || CFX.DEFAULTS.AI_PROVIDERS.openai.model;

    callbacks.onStatus('connecting');

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
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error: ${error.error?.message || `HTTP ${response.status}`}`);
    }

    callbacks.onStatus('generating');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            callbacks.onDelta(delta);
          }
        } catch (e) {
          // skip
        }
      }
    }

    callbacks.onDone(fullContent, '');
  }

  /**
   * Stream from Anthropic Claude API with thinking support.
   */
  async function claudeStream(config, messages, callbacks) {
    const endpoint = config.endpoint || CFX.DEFAULTS.AI_PROVIDERS.claude.endpoint;
    const model = config.model || CFX.DEFAULTS.AI_PROVIDERS.claude.model;

    const systemMsg = messages.find((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');

    callbacks.onStatus('connecting');

    // Build request body - add thinking support for models that support it
    const reqBody = {
      model,
      max_tokens: 16000,
      system: systemMsg ? systemMsg.content : SYSTEM_PROMPT,
      messages: userMessages,
      stream: true,
    };

    // Enable extended thinking for Claude models that support it
    if (model && (model.includes('claude-3-7') || model.includes('claude-sonnet-4') || model.includes('claude-opus'))) {
      reqBody.thinking = {
        type: 'enabled',
        budget_tokens: 8000,
      };
      // thinking requires higher max_tokens
      reqBody.max_tokens = 24000;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(reqBody),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Claude API error: ${error.error?.message || `HTTP ${response.status}`}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let fullThinking = '';
    let currentBlockType = null;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed.startsWith('event: ')) {
          const eventType = trimmed.slice(7).trim();
          if (eventType === 'content_block_start') {
            // Will get block type from the data line
          } else if (eventType === 'message_stop') {
            // Done
          }
          continue;
        }

        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        try {
          const parsed = JSON.parse(data);

          // content_block_start: determine block type
          if (parsed.type === 'content_block_start') {
            currentBlockType = parsed.content_block?.type;
            if (currentBlockType === 'thinking') {
              callbacks.onStatus('thinking');
            } else if (currentBlockType === 'text') {
              callbacks.onStatus('generating');
            }
            continue;
          }

          // content_block_delta: stream content
          if (parsed.type === 'content_block_delta') {
            if (parsed.delta?.type === 'thinking_delta') {
              fullThinking += parsed.delta.thinking || '';
              callbacks.onThinking(parsed.delta.thinking || '');
            } else if (parsed.delta?.type === 'text_delta') {
              fullContent += parsed.delta.text || '';
              callbacks.onDelta(parsed.delta.text || '');
            }
            continue;
          }

          // content_block_stop
          if (parsed.type === 'content_block_stop') {
            currentBlockType = null;
            continue;
          }

          // message_delta (may contain stop_reason)
          if (parsed.type === 'message_delta') {
            continue;
          }
        } catch (e) {
          // skip malformed
        }
      }
    }

    callbacks.onDone(fullContent, fullThinking);
  }

  /**
   * Stream from a custom OpenAI-compatible endpoint.
   */
  async function customStream(config, messages, callbacks) {
    if (!config.endpoint) {
      throw new Error('Custom AI endpoint not configured. Please set it in Settings.');
    }

    callbacks.onStatus('connecting');

    const headers = { 'Content-Type': 'application/json' };
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
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`AI API error: ${error.error?.message || error.message || `HTTP ${response.status}`}`);
    }

    // Check if response is actually streaming (SSE) or plain JSON
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      // Non-streaming fallback
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || data.text || data.response || '';
      callbacks.onStatus('generating');
      callbacks.onDelta(text);
      callbacks.onDone(text, '');
      return;
    }

    callbacks.onStatus('generating');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            callbacks.onDelta(delta);
          }
        } catch (e) {
          // skip
        }
      }
    }

    callbacks.onDone(fullContent, '');
  }

  /**
   * Main streaming entry point.
   * @param {object} config - { provider, endpoint, apiKey, model }
   * @param {Array} messages - Full messages array
   * @param {object} callbacks - { onStatus, onDelta, onThinking, onDone, onError }
   */
  async function streamAiMessage(config, messages, callbacks) {
    const hasSystem = messages.some((m) => m.role === 'system');
    const finalMessages = hasSystem ? messages : [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ];

    const provider = config.provider || 'openai';

    switch (provider) {
      case 'claude':
        return claudeStream(config, finalMessages, callbacks);
      case 'custom':
        return customStream(config, finalMessages, callbacks);
      case 'openai':
      default:
        return openaiStream(config, finalMessages, callbacks);
    }
  }

  const aiClient = {
    sendAiMessage,
    streamAiMessage,
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
