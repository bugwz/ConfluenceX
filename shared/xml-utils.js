/**
 * xml-utils.js
 * Utilities for Confluence XHTML storage format:
 * - validation, diff, sanitization of AI output
 */
(function () {
  'use strict';

  const XML_PREDEFINED_ENTITIES = new Set(['amp', 'lt', 'gt', 'apos', 'quot']);
  const HTML_NAMED_ENTITY_MAP = {
    nbsp: '\u00A0',
    ensp: '\u2002',
    emsp: '\u2003',
    thinsp: '\u2009',
    ldquo: '\u201C',
    rdquo: '\u201D',
    lsquo: '\u2018',
    rsquo: '\u2019',
    hellip: '\u2026',
    ndash: '\u2013',
    mdash: '\u2014',
    bull: '\u2022',
    middot: '\u00B7',
    copy: '\u00A9',
    reg: '\u00AE',
    trade: '\u2122',
  };

  function normalizeNamedEntitiesForXml(xml) {
    if (!xml || typeof xml !== 'string') return '';
    return xml.replace(/&([A-Za-z][A-Za-z0-9]+);/g, (full, entityName) => {
      if (XML_PREDEFINED_ENTITIES.has(entityName)) return full;
      if (Object.prototype.hasOwnProperty.call(HTML_NAMED_ENTITY_MAP, entityName)) {
        return HTML_NAMED_ENTITY_MAP[entityName];
      }
      // Unknown named entities are invalid in XML without DTD.
      // Keep literal text to avoid parse failures.
      return `&amp;${entityName};`;
    });
  }

  function wrapStorageFragment(xml) {
    const normalized = normalizeNamedEntitiesForXml(xml);
    return `<root xmlns:ac="https://confluence.atlassian.com/ac" xmlns:ri="https://confluence.atlassian.com/ri">${normalized}</root>`;
  }

  /**
   * Validate that a string is well-formed XML (Confluence storage format).
   * Returns { valid: boolean, error?: string }
   */
  function validateStorageFormat(xml) {
    if (!xml || typeof xml !== 'string') {
      return { valid: false, error: 'Content is empty or not a string' };
    }

    // Wrap in a root element so fragments parse correctly
    const wrapped = wrapStorageFragment(xml);

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(wrapped, 'application/xml');
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        const msg = parseError.textContent.split('\n')[0].trim();
        return { valid: false, error: `XML parse error: ${msg}` };
      }
      return { valid: true };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }

  /**
   * Extract plain text content from XHTML storage format.
   * Used when page content is too long to send to AI in full.
   */
  function extractTextContent(xml) {
    if (!xml) return '';
    try {
      const wrapped = `<root>${xml}</root>`;
      const parser = new DOMParser();
      const doc = parser.parseFromString(wrapped, 'text/html');
      return doc.body.textContent || '';
    } catch (e) {
      // Fallback: strip tags with regex
      return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  /**
   * Compute a simple line-based diff between two strings.
   * Returns array of { type: 'add'|'remove'|'keep', line: string, lineNum: number }
   * Uses Myers diff algorithm (simplified).
   */
  function diffSummary(before, after) {
    const beforeLines = (before || '').split('\n');
    const afterLines = (after || '').split('\n');

    const result = [];
    const lcs = computeLCS(beforeLines, afterLines);

    let i = 0, j = 0, k = 0;
    let lineNum = 1;

    while (i < beforeLines.length || j < afterLines.length) {
      if (k < lcs.length && i < beforeLines.length && j < afterLines.length &&
          beforeLines[i] === lcs[k] && afterLines[j] === lcs[k]) {
        result.push({ type: 'keep', line: beforeLines[i], lineNum: lineNum++ });
        i++; j++; k++;
      } else if (j < afterLines.length &&
                 (k >= lcs.length || afterLines[j] !== lcs[k])) {
        result.push({ type: 'add', line: afterLines[j], lineNum: lineNum++ });
        j++;
      } else {
        result.push({ type: 'remove', line: beforeLines[i], lineNum: lineNum++ });
        i++;
      }
    }

    return result;
  }

  /**
   * Compute Longest Common Subsequence of two string arrays.
   */
  function computeLCS(a, b) {
    // For performance, limit to first 500 lines
    const maxLines = 500;
    const aSlice = a.slice(0, maxLines);
    const bSlice = b.slice(0, maxLines);

    const m = aSlice.length;
    const n = bSlice.length;

    // dp[i][j] = LCS length of a[0..i-1] and b[0..j-1]
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (aSlice[i - 1] === bSlice[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to find LCS
    const lcs = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (aSlice[i - 1] === bSlice[j - 1]) {
        lcs.unshift(aSlice[i - 1]);
        i--; j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return lcs;
  }

  /**
   * Extract and sanitize AI-generated content.
   * Looks for content between <confluencex-content>...</confluencex-content> tags.
   * Returns { content: string|null, error: string|null }
   */
  function sanitizeAiOutput(rawResponse) {
    if (!rawResponse) return { content: null, error: 'Empty AI response' };

    // Try to find content between special tags
    const tagMatch = rawResponse.match(/<confluencex-content>([\s\S]*?)<\/confluencex-content>/);
    if (!tagMatch) {
      return {
        content: null,
        error: 'AI response did not contain <confluencex-content> tags. Please ask it to try again.',
      };
    }

    const content = tagMatch[1].trim();

    // Validate the extracted XML
    const validation = validateStorageFormat(content);
    if (!validation.valid) {
      return {
        content: null,
        error: `AI generated invalid XML: ${validation.error}`,
      };
    }

    return { content, error: null };
  }

  function extractJsonPayload(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return candidate.slice(start, end + 1);
  }

  function sanitizeAiPatch(rawResponse) {
    if (!rawResponse) {
      return { foundTag: false, patch: null, error: 'Empty AI response', errorCode: 'PARSE_ERROR' };
    }

    const tagMatch = rawResponse.match(/<confluencex-patch>([\s\S]*?)<\/confluencex-patch>/);
    if (!tagMatch) {
      return { foundTag: false, patch: null, error: null, errorCode: null };
    }

    const jsonPayload = extractJsonPayload(tagMatch[1]);
    if (!jsonPayload) {
      return {
        foundTag: true,
        patch: null,
        error: 'Patch payload is not valid JSON object text.',
        errorCode: 'PARSE_ERROR',
      };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(jsonPayload);
    } catch (e) {
      return {
        foundTag: true,
        patch: null,
        error: `Patch JSON parse failed: ${e.message}`,
        errorCode: 'PARSE_ERROR',
      };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        foundTag: true,
        patch: null,
        error: 'Patch root must be a JSON object.',
        errorCode: 'INVALID_SCHEMA',
      };
    }

    const operations = Array.isArray(parsed.operations) ? parsed.operations : null;
    if (!operations || operations.length === 0) {
      return {
        foundTag: true,
        patch: null,
        error: 'Patch must include non-empty operations array.',
        errorCode: 'INVALID_SCHEMA',
      };
    }

    const normalizedOps = [];
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i] || {};
      const opId = (typeof op.opId === 'string' && op.opId.trim()) || `op_${i + 1}`;
      if (op.type !== 'replace_node') {
        return {
          foundTag: true,
          patch: null,
          error: `Unsupported operation type in ${opId}: ${op.type || '(missing)'}`,
          errorCode: 'INVALID_SCHEMA',
        };
      }

      const target = op.target || {};
      const path = typeof target.path === 'string' ? target.path.trim() : '';
      if (!path) {
        return {
          foundTag: true,
          patch: null,
          error: `Operation ${opId} missing target.path.`,
          errorCode: 'INVALID_SCHEMA',
        };
      }

      const oldXml = typeof op.oldXml === 'string' ? op.oldXml.trim() : '';
      const newXml = typeof op.newXml === 'string' ? op.newXml.trim() : '';
      if (!oldXml || !newXml) {
        return {
          foundTag: true,
          patch: null,
          error: `Operation ${opId} requires oldXml and newXml.`,
          errorCode: 'INVALID_SCHEMA',
        };
      }

      const oldValidation = validateStorageFormat(oldXml);
      if (!oldValidation.valid) {
        return {
          foundTag: true,
          patch: null,
          error: `Operation ${opId} oldXml invalid: ${oldValidation.error}`,
          errorCode: 'INVALID_XML',
        };
      }

      const newValidation = validateStorageFormat(newXml);
      if (!newValidation.valid) {
        return {
          foundTag: true,
          patch: null,
          error: `Operation ${opId} newXml invalid: ${newValidation.error}`,
          errorCode: 'INVALID_XML',
        };
      }

      const fingerprint = typeof target.fingerprint === 'string' ? target.fingerprint.trim() : '';
      normalizedOps.push({
        opId,
        type: 'replace_node',
        target: { path, fingerprint },
        oldXml,
        newXml,
        reason: typeof op.reason === 'string' ? op.reason : '',
      });
    }

    return {
      foundTag: true,
      patch: {
        formatVersion: typeof parsed.formatVersion === 'string' ? parsed.formatVersion : '1.0',
        operations: normalizedOps,
      },
      error: null,
      errorCode: null,
    };
  }

  function canonicalizeNodeXml(xml) {
    if (typeof xml !== 'string' || !xml.trim()) return '';
    const wrapped = wrapStorageFragment(xml);
    const parser = new DOMParser();
    const doc = parser.parseFromString(wrapped, 'application/xml');
    if (doc.querySelector('parsererror')) return '';

    const root = doc.documentElement;
    const serializer = new XMLSerializer();
    const chunks = [];
    for (const node of root.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        if (text) chunks.push(text);
      } else {
        chunks.push(serializer.serializeToString(node));
      }
    }
    return chunks.join('').replace(/>\s+</g, '><').trim();
  }

  function fingerprintText(text) {
    // FNV-1a 32-bit hash
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = (hash >>> 0) * 0x01000193;
    }
    return (`00000000${(hash >>> 0).toString(16)}`).slice(-8);
  }

  function resolveNodeByPath(rootEl, path) {
    if (!path || typeof path !== 'string') {
      return { node: null, error: 'Path is empty', errorCode: 'INVALID_SCHEMA' };
    }
    if (!path.startsWith('/root')) {
      return { node: null, error: 'Path must start with /root', errorCode: 'INVALID_SCHEMA' };
    }

    const rawSegments = path.split('/').filter(Boolean);
    if (!rawSegments.length || rawSegments[0] !== 'root') {
      return { node: null, error: 'Invalid root segment in path', errorCode: 'INVALID_SCHEMA' };
    }
    if (rawSegments.length === 1) {
      return { node: null, error: 'Path "/root" is not a replaceable node target.', errorCode: 'INVALID_SCHEMA' };
    }

    let current = rootEl;
    for (let i = 1; i < rawSegments.length; i++) {
      const segment = rawSegments[i];
      const match = segment.match(/^([A-Za-z_][\w:.-]*)(?:\[(\d+)\])?$/);
      if (!match) {
        return { node: null, error: `Invalid path segment "${segment}"`, errorCode: 'INVALID_SCHEMA' };
      }
      const tagName = match[1];
      const index = match[2] ? parseInt(match[2], 10) : 1;
      if (!Number.isFinite(index) || index < 1) {
        return { node: null, error: `Invalid index in segment "${segment}"`, errorCode: 'INVALID_SCHEMA' };
      }

      const matches = Array.from(current.children).filter((el) => el.tagName === tagName);
      if (matches.length < index) {
        return {
          node: null,
          error: `Path "${path}" did not match node at segment "${segment}"`,
          errorCode: 'NO_MATCH',
        };
      }
      current = matches[index - 1];
    }

    return { node: current, error: null, errorCode: null };
  }

  function serializeRootChildren(rootEl) {
    const serializer = new XMLSerializer();
    const parts = [];
    for (const node of rootEl.childNodes) {
      parts.push(serializer.serializeToString(node));
    }
    return parts.join('').trim();
  }

  function parseXmlFragment(xml) {
    const wrapped = wrapStorageFragment(xml);
    const parser = new DOMParser();
    const doc = parser.parseFromString(wrapped, 'application/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      return { doc: null, root: null, error: parseError.textContent.trim() };
    }
    return { doc, root: doc.documentElement, error: null };
  }

  function applyNodePatch(pageContent, patch) {
    if (!patch || !Array.isArray(patch.operations) || patch.operations.length === 0) {
      return { content: null, error: 'Patch operations are empty.', errorCode: 'INVALID_SCHEMA' };
    }

    const parsed = parseXmlFragment(pageContent || '');
    if (parsed.error || !parsed.root) {
      return { content: null, error: `Current page XML invalid: ${parsed.error || 'parse error'}`, errorCode: 'INVALID_XML' };
    }

    const doc = parsed.doc;
    const root = parsed.root;

    for (const op of patch.operations) {
      const resolved = resolveNodeByPath(root, op.target.path);
      if (!resolved.node) {
        return { content: null, error: `Operation ${op.opId} failed: ${resolved.error}`, errorCode: resolved.errorCode || 'NO_MATCH' };
      }

      const targetNode = resolved.node;
      const serializer = new XMLSerializer();
      const currentXml = serializer.serializeToString(targetNode);
      const currentCanonical = canonicalizeNodeXml(currentXml);
      const oldCanonical = canonicalizeNodeXml(op.oldXml);

      const fingerprintMatched = op.target.fingerprint
        && op.target.fingerprint.toLowerCase() === fingerprintText(currentCanonical).toLowerCase();
      if (currentCanonical !== oldCanonical && !fingerprintMatched) {
        return {
          content: null,
          error: `Operation ${op.opId} failed: target node content no longer matches oldXml.`,
          errorCode: 'FINGERPRINT_MISMATCH',
        };
      }

      const replacementParsed = parseXmlFragment(op.newXml);
      if (replacementParsed.error || !replacementParsed.root) {
        return {
          content: null,
          error: `Operation ${op.opId} failed: newXml parse error: ${replacementParsed.error || 'unknown'}`,
          errorCode: 'INVALID_XML',
        };
      }

      const replacementElements = Array.from(replacementParsed.root.children);
      if (replacementElements.length < 1) {
        return {
          content: null,
          error: `Operation ${op.opId} must provide at least one root element node in newXml.`,
          errorCode: 'INVALID_SCHEMA',
        };
      }

      const parentNode = targetNode.parentNode;
      let anchor = targetNode.nextSibling;
      for (let i = 0; i < replacementElements.length; i++) {
        const importedNode = doc.importNode(replacementElements[i], true);
        if (i === 0) {
          parentNode.replaceChild(importedNode, targetNode);
        } else {
          parentNode.insertBefore(importedNode, anchor);
        }
      }
    }

    const merged = serializeRootChildren(root);
    const validation = validateStorageFormat(merged);
    if (!validation.valid) {
      return {
        content: null,
        error: `Patched content is invalid XML: ${validation.error}`,
        errorCode: 'INVALID_XML',
      };
    }

    return {
      content: merged,
      error: null,
      errorCode: null,
      applied: patch.operations.length,
    };
  }

  /**
   * Truncate page content for AI if too long.
   * Preserves the beginning and end of the document.
   */
  function truncateContent(content, maxLength) {
    if (!content || content.length <= maxLength) return content;

    const half = Math.floor(maxLength / 2);
    const start = content.substring(0, half);
    const end = content.substring(content.length - half);
    return `${start}\n\n<!-- [ConfluenceX: content truncated for AI context] -->\n\n${end}`;
  }

  /**
   * Format a timestamp as a relative time string (e.g., "2 hours ago").
   */
  function formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  const xmlUtils = {
    validateStorageFormat,
    extractTextContent,
    diffSummary,
    sanitizeAiOutput,
    sanitizeAiPatch,
    canonicalizeNodeXml,
    fingerprintText,
    applyNodePatch,
    truncateContent,
    formatRelativeTime,
  };

  if (typeof window !== 'undefined') {
    window.xmlUtils = xmlUtils;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.xmlUtils = xmlUtils;
  }
})();
