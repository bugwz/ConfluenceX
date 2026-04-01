/**
 * page-tree.js
 * Lazy-loading page tree browser for selecting move destinations.
 */
(function () {
  'use strict';

  /**
   * Create a page tree component.
   * @param {object} options
   *   - baseUrl: string
   *   - onSelect: function(page) - called when a node is selected
   * @returns {HTMLElement}
   */
  function createPageTree(options = {}) {
    const { baseUrl, onSelect } = options;

    const wrapper = document.createElement('div');
    wrapper.className = 'cfx-tree';

    let selectedNode = null;

    async function loadSpaces() {
      wrapper.innerHTML = '<div class="cfx-search-empty"><div class="cfx-spinner" style="display:inline-block"></div></div>';

      try {
        const response = await cfxApi.runtime.sendMessage({
          type: MSG.GET_SPACES,
          payload: { baseUrl },
        });

        wrapper.innerHTML = '';

        if (!response || !response.success) {
          showError(wrapper, response?.error || 'Failed to load spaces');
          return;
        }

        const spaces = response.data?.results || [];
        if (spaces.length === 0) {
          showError(wrapper, 'No spaces found');
          return;
        }

        spaces.forEach((space) => {
          const node = createSpaceNode(space);
          wrapper.appendChild(node);
        });
      } catch (err) {
        showError(wrapper, err.message);
      }
    }

    function createSpaceNode(space) {
      const container = document.createElement('div');

      const nodeEl = document.createElement('div');
      nodeEl.className = 'cfx-tree-node';
      nodeEl.dataset.id = space.key;
      nodeEl.dataset.type = 'space';

      const expandEl = document.createElement('span');
      expandEl.className = 'cfx-tree-expand';
      expandEl.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;

      const label = document.createElement('span');
      label.textContent = space.name || space.key;
      label.style.flex = '1';

      nodeEl.appendChild(expandEl);
      nodeEl.appendChild(label);

      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'cfx-tree-children';
      childrenContainer.style.paddingLeft = '14px';

      let loaded = false;
      let expanded = false;

      async function toggle() {
        expanded = !expanded;
        expandEl.classList.toggle('expanded', expanded);
        childrenContainer.classList.toggle('open', expanded);

        if (expanded && !loaded) {
          loaded = true;
          childrenContainer.innerHTML = '<div class="cfx-search-empty"><div class="cfx-spinner" style="display:inline-block"></div></div>';

          try {
            const response = await cfxApi.runtime.sendMessage({
              type: MSG.SEARCH_PAGES,
              payload: {
                baseUrl,
                cql: `type=page AND space="${space.key}" AND ancestor=root ORDER BY title ASC`,
                limit: CFX.DEFAULTS.CHILD_PAGE_LIMIT,
                start: 0,
              },
            });

            childrenContainer.innerHTML = '';
            const pages = response?.data?.results || [];
            if (pages.length === 0) {
              const empty = document.createElement('div');
              empty.className = 'cfx-search-empty';
              empty.style.fontSize = '11px';
              empty.textContent = 'No pages';
              childrenContainer.appendChild(empty);
            } else {
              pages.forEach((page) => {
                const pageNode = createPageNode(page, 1);
                childrenContainer.appendChild(pageNode);
              });
            }
          } catch (err) {
            showError(childrenContainer, err.message);
          }
        }
      }

      expandEl.addEventListener('click', toggle);
      nodeEl.addEventListener('click', (e) => {
        if (e.target === expandEl || expandEl.contains(e.target)) return;
        toggle();
      });

      container.appendChild(nodeEl);
      container.appendChild(childrenContainer);
      return container;
    }

    function createPageNode(page, depth) {
      const container = document.createElement('div');

      const nodeEl = document.createElement('div');
      nodeEl.className = 'cfx-tree-node';
      nodeEl.dataset.id = page.id;
      nodeEl.dataset.type = 'page';
      nodeEl.style.paddingLeft = `${8 + depth * 10}px`;

      const expandEl = document.createElement('span');
      expandEl.className = 'cfx-tree-expand';
      expandEl.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;

      const label = document.createElement('span');
      label.textContent = page.title;
      label.style.flex = '1';

      nodeEl.appendChild(expandEl);
      nodeEl.appendChild(label);

      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'cfx-tree-children';

      let loaded = false;
      let expanded = false;

      async function toggleExpand(e) {
        e.stopPropagation();
        expanded = !expanded;
        expandEl.classList.toggle('expanded', expanded);
        childrenContainer.classList.toggle('open', expanded);

        if (expanded && !loaded) {
          loaded = true;
          childrenContainer.innerHTML = '<div style="padding:4px 8px;font-size:11px;color:var(--cfx-text-muted)">Loading...</div>';

          try {
            const response = await cfxApi.runtime.sendMessage({
              type: MSG.GET_CHILD_PAGES,
              payload: { baseUrl, pageId: page.id, limit: CFX.DEFAULTS.CHILD_PAGE_LIMIT, start: 0 },
            });

            childrenContainer.innerHTML = '';
            const children = response?.data?.results || [];
            if (children.length === 0) {
              expandEl.style.visibility = 'hidden';
            } else {
              children.forEach((child) => {
                const childNode = createPageNode(child, depth + 1);
                childrenContainer.appendChild(childNode);
              });
            }
          } catch (err) {
            childrenContainer.innerHTML = '';
          }
        }
      }

      function selectNode() {
        if (selectedNode) {
          selectedNode.classList.remove('selected');
        }
        nodeEl.classList.add('selected');
        selectedNode = nodeEl;
        if (onSelect) onSelect(page);
      }

      expandEl.addEventListener('click', toggleExpand);
      nodeEl.addEventListener('click', selectNode);

      container.appendChild(nodeEl);
      container.appendChild(childrenContainer);
      return container;
    }

    function showError(container, message) {
      container.innerHTML = '';
      const err = document.createElement('div');
      err.className = 'cfx-alert cfx-alert-error';
      err.style.cssText = 'margin:8px;font-size:11px;';
      err.textContent = message;
      container.appendChild(err);
    }

    // Load spaces when baseUrl is available
    if (baseUrl) {
      loadSpaces();
    }

    wrapper.refresh = () => loadSpaces();
    wrapper.setBaseUrl = (url) => {
      options.baseUrl = url;
      loadSpaces();
    };

    return wrapper;
  }

  window.cfxPageTree = { createPageTree };
})();
