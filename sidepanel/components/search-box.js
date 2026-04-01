/**
 * search-box.js
 * Debounced CQL page search component.
 */
(function () {
  'use strict';

  /**
   * Create a search box component.
   * @param {object} options
   *   - placeholder: string
   *   - baseUrl: string (Confluence base URL)
   *   - onSelect: function(result) - called when user selects a result
   *   - spaceKey: string (optional, limit search to space)
   * @returns {HTMLElement} wrapper element containing input + dropdown
   */
  function createSearchBox(options = {}) {
    const { placeholder = 'Search pages...', baseUrl, onSelect, spaceKey } = options;

    const wrapper = document.createElement('div');
    wrapper.className = 'cfx-search-wrapper';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cfx-input';
    input.placeholder = placeholder;

    const dropdown = document.createElement('div');
    dropdown.className = 'cfx-search-results';
    dropdown.style.display = 'none';

    wrapper.appendChild(input);
    wrapper.appendChild(dropdown);

    let debounceTimer = null;
    let currentQuery = '';

    function showResults(results) {
      dropdown.innerHTML = '';

      if (!results || results.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cfx-search-empty';
        empty.textContent = currentQuery ? 'No pages found' : 'Type to search...';
        dropdown.appendChild(empty);
      } else {
        results.forEach((page) => {
          const item = document.createElement('div');
          item.className = 'cfx-search-result';

          const title = document.createElement('div');
          title.className = 'cfx-search-result-title';
          title.textContent = page.title;

          const meta = document.createElement('div');
          meta.className = 'cfx-search-result-meta';
          const spaceName = page.space?.name || page.space?.key || '';
          meta.textContent = [spaceName, `ID: ${page.id}`].filter(Boolean).join(' · ');

          item.appendChild(title);
          item.appendChild(meta);

          item.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevent blur from firing before click
            closeDropdown();
            input.value = page.title;
            if (onSelect) onSelect(page);
          });

          dropdown.appendChild(item);
        });
      }

      dropdown.style.display = 'block';
    }

    function closeDropdown() {
      dropdown.style.display = 'none';
    }

    async function doSearch(query) {
      if (!baseUrl) {
        showResults([]);
        return;
      }

      let cql = `type=page AND title~"${query.replace(/"/g, '')}"`;
      if (spaceKey) {
        cql += ` AND space="${spaceKey}"`;
      }
      cql += ' ORDER BY lastmodified DESC';

      try {
        const response = await cfxApi.runtime.sendMessage({
          type: MSG.SEARCH_PAGES,
          payload: { baseUrl, cql, limit: CFX.DEFAULTS.SEARCH_LIMIT, start: 0 },
        });

        if (response && response.success) {
          showResults(response.data?.results || []);
        } else {
          showResults([]);
        }
      } catch (err) {
        showResults([]);
      }
    }

    input.addEventListener('input', () => {
      currentQuery = input.value.trim();
      clearTimeout(debounceTimer);

      if (!currentQuery) {
        closeDropdown();
        return;
      }

      dropdown.innerHTML = '<div class="cfx-search-empty"><div class="cfx-spinner" style="display:inline-block"></div></div>';
      dropdown.style.display = 'block';

      debounceTimer = setTimeout(() => {
        doSearch(currentQuery);
      }, 350);
    });

    input.addEventListener('focus', () => {
      if (currentQuery && dropdown.children.length > 0) {
        dropdown.style.display = 'block';
      }
    });

    input.addEventListener('blur', () => {
      // Slight delay so mousedown on result fires first
      setTimeout(closeDropdown, 200);
    });

    // Expose methods on the wrapper
    wrapper._searchInput = input;
    wrapper.getValue = () => input.value;
    wrapper.setValue = (val) => { input.value = val; };
    wrapper.setBaseUrl = (url) => { options.baseUrl = url; };
    wrapper.clear = () => {
      input.value = '';
      currentQuery = '';
      closeDropdown();
    };

    return wrapper;
  }

  window.cfxSearchBox = { createSearchBox };
})();
