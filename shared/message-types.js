/**
 * message-types.js
 * Single source of truth for all chrome.runtime.sendMessage type strings.
 * Import this before any messaging code to avoid typos.
 */
(function () {
  'use strict';

  const MSG = Object.freeze({
    // Page context (content script <-> sidepanel)
    GET_PAGE_CONTEXT: 'GET_PAGE_CONTEXT',
    PAGE_CONTEXT: 'PAGE_CONTEXT',

    // Confluence API (sidepanel -> background)
    FETCH_PAGE_CONTENT: 'FETCH_PAGE_CONTENT',
    PAGE_CONTENT_RESULT: 'PAGE_CONTENT_RESULT',
    SAVE_PAGE: 'SAVE_PAGE',
    SAVE_PAGE_RESULT: 'SAVE_PAGE_RESULT',
    MOVE_PAGE: 'MOVE_PAGE',
    MOVE_PAGE_RESULT: 'MOVE_PAGE_RESULT',
    SEARCH_PAGES: 'SEARCH_PAGES',
    SEARCH_PAGES_RESULT: 'SEARCH_PAGES_RESULT',
    GET_CHILD_PAGES: 'GET_CHILD_PAGES',
    GET_CHILD_PAGES_RESULT: 'GET_CHILD_PAGES_RESULT',
    GET_SPACES: 'GET_SPACES',
    GET_SPACES_RESULT: 'GET_SPACES_RESULT',

    // AI (sidepanel -> background)
    AI_CHAT_REQUEST: 'AI_CHAT_REQUEST',
    AI_CHAT_RESPONSE: 'AI_CHAT_RESPONSE',

    // Edit history (sidepanel -> background)
    SAVE_EDIT_HISTORY: 'SAVE_EDIT_HISTORY',
    GET_EDIT_HISTORY: 'GET_EDIT_HISTORY',
    EDIT_HISTORY_RESULT: 'EDIT_HISTORY_RESULT',
    DELETE_EDIT_SNAPSHOT: 'DELETE_EDIT_SNAPSHOT',
    CLEAR_EDIT_HISTORY: 'CLEAR_EDIT_HISTORY',

    // Settings (any -> background)
    GET_SETTINGS: 'GET_SETTINGS',
    SETTINGS_RESULT: 'SETTINGS_RESULT',
    SAVE_SETTINGS: 'SAVE_SETTINGS',

    // UI controls (sidepanel -> content)
    TOGGLE_DARK_MODE: 'TOGGLE_DARK_MODE',
    SCROLL_TO_TOP: 'SCROLL_TO_TOP',
  });

  if (typeof window !== 'undefined') {
    window.MSG = MSG;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.MSG = MSG;
  }
})();
