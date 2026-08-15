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
  api.apply({ active: on, presence: true, keepAlive: true, fakeActivity: true, forceResume: true });

  // A page often runs the part that matters inside a frame. Any frame from
  // this same site can be reached; one from another site cannot.
  const frames = reachFrames(on);
  watchForFrames(on);

  notify(on, on
    ? 'Antitab is on. This tab looks open and in use'
    : 'Antitab is off. This tab looks idle again',
  on ? frames.blocked : 0);

  /**
   * Put the payload into every same-origin frame, however deeply nested, and
   * switch it to match. CodePen runs a pen inside an about:srcdoc frame, which
   * inherits this document's origin, so it is reachable even though the code
   * clicked on lives one document up.
   *
   * Frames from another site are counted and reported instead: nothing running
   * in this document is allowed to touch them.
   */
  function reachFrames(active, root, depth) {
    const doc = root || document;
    const level = depth || 0;
    let reached = 0;
    let blocked = 0;
    if (level > 4) return { reached, blocked };

    for (const frame of doc.querySelectorAll('iframe, frame')) {
      const view = frame.contentWindow;
      if (!view) continue;

      try {
        void view.location.href; // throws for another site
      } catch (_) {
        blocked++;
        continue;
      }

      try {
        if (!frame.__antitabWatched) {
          frame.__antitabWatched = true;
          frame.addEventListener('load', () => { reachFrames(true); }, { passive: true });
        }
        if (!view.__antitab) view.eval(__antitabSource);
        if (view.__antitab) {
          view.__antitab.apply({
            active: active, presence: true, keepAlive: true, fakeActivity: true, forceResume: true
          });
          reached++;
        }
        const inner = reachFrames(active, view.document, level + 1);
        reached += inner.reached;
        blocked += inner.blocked;
      } catch (_) {
        // A policy that forbids eval, or a frame that vanished mid-loop.
        blocked++;
      }
    }
    return { reached, blocked };
  }

  /**
   * Frames that arrive after the click, which is most of them on a page that
   * builds itself: a lazily mounted player, a pen re-rendering after an edit,
   * anything swapped in later. Without this, clicking the bookmark a moment too
   * early quietly does nothing for the part that matters.
   */
  function watchForFrames(active) {
    const KEY = '__antitabFrameWatcher';
    if (window[KEY]) {
      window[KEY].disconnect();
      delete window[KEY];
    }
    if (!active || typeof MutationObserver !== 'function') return;

    let queued = false;
    const observer = new MutationObserver((records) => {
      if (queued) return;
      const sawFrame = records.some((record) =>
        Array.prototype.some.call(record.addedNodes, (node) =>
          node.nodeType === 1 && (node.tagName === 'IFRAME' || node.tagName === 'FRAME'
            || (node.querySelector && node.querySelector('iframe, frame')))));
      if (!sawFrame) return;
      queued = true;
      // Let the frame get a document before reaching into it.
      setTimeout(() => { queued = false; reachFrames(true); }, 250);
    });

    try {
      observer.observe(document.documentElement, { childList: true, subtree: true });
      Object.defineProperty(window, KEY, { configurable: true, value: observer });
    } catch (_) { /* nothing to observe yet */ }
  }

  function notify(active, message, unreachable) {
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
    const line = document.createElement('span');
    line.textContent = message;
    pill.appendChild(line);
    pill.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'text-align:left',
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

    if (unreachable) {
      // Say it plainly, and say what to do instead.
      line.textContent = message + '.';
      const note = document.createElement('span');
      note.textContent = unreachable === 1
        ? ' Part of this page comes from another site, which a bookmark cannot reach. Open that part on its own page, or use the extension.'
        : ' Parts of this page come from other sites, which a bookmark cannot reach. Open them on their own pages, or use the extension.';
      note.style.cssText = 'opacity:.72';
      pill.appendChild(note);
      pill.style.borderRadius = '12px';
      pill.style.alignItems = 'flex-start';
      pill.style.display = 'block';
      pill.style.maxWidth = 'min(90vw,460px)';
      dot.style.display = 'none';
    }

    // The toast lives in a closed shadow root so no page style can reach it,
    // which also puts it out of reach of anything checking the result. Publish
    // the same words plainly.
    try {
      Object.defineProperty(window, '__antitabNotice', {
        configurable: true,
        value: { active: active, message: pill.textContent, unreachable: unreachable || 0 }
      });
    } catch (_) { /* ignore */ }

    shadow.appendChild(pill);
    (document.body || document.documentElement).appendChild(host);

    setTimeout(() => host.remove(), unreachable ? 8000 : 3200);
  }
})();
