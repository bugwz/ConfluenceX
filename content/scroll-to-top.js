/**
 * scroll-to-top.js
 * Floating scroll-to-top button for Confluence pages.
 */
(function () {
  'use strict';

  const BUTTON_ID = 'cfx-scroll-to-top';
  const SHOW_THRESHOLD = 300;

  let button = null;
  let scrollHandler = null;

  function init() {
    if (document.getElementById(BUTTON_ID)) return;

    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.title = 'Back to top';
    button.setAttribute('aria-label', 'Scroll to top');
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="18 15 12 9 6 15"/>
      </svg>
    `;

    // Inline styles to avoid conflicts with Confluence CSS
    Object.assign(button.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '9999',
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      border: '1px solid rgba(0,82,204,0.2)',
      background: '#0052cc',
      color: '#ffffff',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      transition: 'opacity 0.25s, transform 0.25s',
      opacity: '0',
      transform: 'translateY(10px)',
      pointerEvents: 'none',
    });

    button.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.body.appendChild(button);

    scrollHandler = debounce(() => {
      const shouldShow = window.scrollY > SHOW_THRESHOLD;
      button.style.opacity = shouldShow ? '1' : '0';
      button.style.transform = shouldShow ? 'translateY(0)' : 'translateY(10px)';
      button.style.pointerEvents = shouldShow ? 'auto' : 'none';
    }, 100);

    window.addEventListener('scroll', scrollHandler, { passive: true });
  }

  function destroy() {
    if (button) button.remove();
    if (scrollHandler) window.removeEventListener('scroll', scrollHandler);
    button = null;
    scrollHandler = null;
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  window.cfxScrollToTop = { init, destroy };
})();
