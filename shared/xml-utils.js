/**
 * xml-utils.js
 * Utilities for Confluence XHTML storage format:
 * - validation, diff, sanitization of AI output
 */
(function () {
  'use strict';

  /**
   * Validate that a string is well-formed XML (Confluence storage format).
   * Returns { valid: boolean, error?: string }
   */
  function validateStorageFormat(xml) {
    if (!xml || typeof xml !== 'string') {
      return { valid: false, error: 'Content is empty or not a string' };
    }

    // Wrap in a root element so fragments parse correctly
    const wrapped = `<root xmlns:ac="https://confluence.atlassian.com/ac" xmlns:ri="https://confluence.atlassian.com/ri">${xml}</root>`;

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
