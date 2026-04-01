/**
 * constants.js
 * Shared constants for ConfluenceX.
 * All scripts load this before using any feature.
 */
(function () {
  'use strict';

  const CONFLUENCE_API = Object.freeze({
    // Content CRUD
    CONTENT: '/rest/api/content',
    CONTENT_BY_ID: '/rest/api/content/{id}',
    CONTENT_SEARCH: '/rest/api/content/search',
    // Children
    CHILDREN_PAGE: '/rest/api/content/{id}/child/page',
    // Spaces
    SPACES: '/rest/api/space',
    // CQL expand defaults
    PAGE_EXPAND: 'body.storage,version,ancestors,space,title',
  });

  const STORAGE_KEYS = Object.freeze({
    // AI provider settings
    AI_PROVIDER: 'cfx_ai_provider',       // 'openai' | 'claude' | 'custom'
    AI_ENDPOINT: 'cfx_ai_endpoint',
    AI_API_KEY: 'cfx_ai_api_key',
    AI_MODEL: 'cfx_ai_model',
    // UI prefs
    DARK_MODE: 'cfx_dark_mode',           // boolean
    CONFLUENCE_BASE_URL: 'cfx_base_url',  // auto-detected or user override
    CONFLUENCE_ALLOWED_ORIGINS: 'cfx_confluence_allowed_origins', // string[]
    MAX_CONTENT_LENGTH: 'cfx_max_content_length',
    // Confluence auth settings
    CONFLUENCE_AUTH_MODE: 'cfx_confluence_auth_mode', // 'cookie' | 'token'
    CONFLUENCE_DEPLOYMENT: 'cfx_confluence_deployment', // 'cloud' | 'dc'
    CONFLUENCE_USER_EMAIL: 'cfx_confluence_user_email',
    CONFLUENCE_API_TOKEN: 'cfx_confluence_api_token',
    // Sidebar state
    LAST_ACTIVE_TAB: 'cfx_last_active_tab',
  });

  const DB_CONFIG = Object.freeze({
    NAME: 'confluencex_db',
    VERSION: 1,
    STORES: {
      EDIT_HISTORY: 'editHistory',
    },
  });

  const DEFAULTS = Object.freeze({
    AI_PROVIDERS: {
      openai: {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o',
      },
      claude: {
        endpoint: 'https://api.anthropic.com/v1/messages',
        model: 'claude-sonnet-4-5',
      },
      custom: {
        endpoint: '',
        model: '',
      },
    },
    MAX_CONTENT_LENGTH: 30000,
    SEARCH_LIMIT: 20,
    CHILD_PAGE_LIMIT: 50,
    HISTORY_MAX_PER_PAGE: 100,
    CONFLUENCE_AUTH_MODE: 'cookie',
    CONFLUENCE_DEPLOYMENT: 'cloud',
    CONFLUENCE_ALLOWED_ORIGINS: [],
  });

  const DARK_MODE_CLASS = 'confluencex-dark';
  const DARK_MODE_LINK_ID = 'confluencex-dark-mode-css';

  // Export to window / globalThis
  const exports = {
    CONFLUENCE_API,
    STORAGE_KEYS,
    DB_CONFIG,
    DEFAULTS,
    DARK_MODE_CLASS,
    DARK_MODE_LINK_ID,
  };

  if (typeof window !== 'undefined') {
    window.CFX = exports;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.CFX = exports;
  }
})();
