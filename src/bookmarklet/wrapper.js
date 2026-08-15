/**
 * Antitab — bookmarklet wrapper.
 *
 * For locked-down machines (most managed Chromebooks) where extensions cannot
 * be installed at all. The same payload from src/main/antitab.js is inlined
 * ahead of this file by dev/build-bookmarklet.mjs, which also declares
 * `__antitabWasInstalled` so a second click can turn it back off.
 *
 * Everything here is about the human: the payload is silent by design, and a
 * bookmark that appears to do nothing feels broken, so this says what happened.
 */
(() => {
  'use strict';

  const api = window.__antitab;
  const wasInstalled = typeof __antitabWasInstalled !== 'undefined' && __antitabWasInstalled;

  if (!api) {
    notify(false, 'Antitab could not start on this page');
    return;
  }

  // First click turns it on; every click after that flips it.
  const on = wasInstalled ? !api.state().config.active : true;
  api.apply({ active: on, blockEvents: true, rafKeepAlive: true, forceResume: true });

  notify(on, on
    ? 'Antitab is on. This tab keeps playing'
    : 'Antitab is off. This tab can pause again');

  function notify(active, message) {
    const ID = 'antitab-toast-host';
    const existing = document.getElementById(ID);
    if (existing) existing.remove();

    const host = document.createElement('div');
    host.id = ID;
    host.style.cssText = [
      'position:fixed',
      'left:0',
      'right:0',
      'bottom:24px',
      'z-index:2147483647',
      'pointer-events:none',
      'display:flex',
      'justify-content:center'
    ].join(';');

    // Shadow DOM so no page stylesheet can reach in and wreck it.
    const shadow = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;

    const pill = document.createElement('div');
    pill.textContent = message;
    pill.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'max-width:min(90vw,420px)',
      'padding:10px 16px',
      'border-radius:999px',
      'background:#16181c',
      'color:#fcfcfd',
      'font:500 13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
      'box-shadow:0 8px 28px rgba(0,0,0,.35)'
    ].join(';');

    const dot = document.createElement('span');
    dot.style.cssText = [
      'width:7px',
      'height:7px',
      'flex:none',
      'border-radius:50%',
      'background:' + (active ? '#35c98a' : '#8a9099')
    ].join(';');
    pill.prepend(dot);

    shadow.appendChild(pill);
    (document.body || document.documentElement).appendChild(host);

    setTimeout(() => host.remove(), 3200);
  }
})();
