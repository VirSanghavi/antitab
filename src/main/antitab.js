/**
 * Antitab — main-world payload.
 *
 * Runs at document_start in the page's own JavaScript world, before any site
 * script, so the page never observes a moment where the tab looks hidden.
 *
 * Three independent tricks, each toggleable from the popup:
 *   1. blockEvents  — document.hidden / visibilityState report "visible" and
 *                     visibilitychange / window blur / freeze never reach the page.
 *   2. rafKeepAlive — requestAnimationFrame keeps firing while the tab is really
 *                     hidden (Chrome normally stops it), driven by a Worker
 *                     timer, which background throttling does not clamp.
 *   3. forceResume  — if a player pauses anyway while the tab is really hidden,
 *                     press play again (bounded, so it never fights forever).
 *
 * Everything is reversible: uninstall() restores the untouched page.
 */
(() => {
  'use strict';

  const NS = '__antitab';
  const VERSION = '1.0.0';
  const win = window;
  const doc = document;

  if (win[NS]) {
    win[NS].hello();
    return;
  }

  // ---------------------------------------------------------------- pristine
  // Grabbed before the page can wrap anything.
  const addEventListener_ = EventTarget.prototype.addEventListener;
  const removeEventListener_ = EventTarget.prototype.removeEventListener;
  const listen = (target, type, fn) => addEventListener_.call(target, type, fn, true);
  const unlisten = (target, type, fn) => removeEventListener_.call(target, type, fn, true);

  const rafReal = typeof win.requestAnimationFrame === 'function'
    ? win.requestAnimationFrame.bind(win) : null;
  const cafReal = typeof win.cancelAnimationFrame === 'function'
    ? win.cancelAnimationFrame.bind(win) : null;
  const nowMs = () => (win.performance && win.performance.now)
    ? win.performance.now() : Date.now();

  const protoDescriptor = (name) => Object.getOwnPropertyDescriptor(Document.prototype, name);
  const realHiddenGetter = (protoDescriptor('hidden') || {}).get;

  /** The truth, read straight off the prototype getter we shadow below. */
  function trulyHidden() {
    try {
      return realHiddenGetter ? realHiddenGetter.call(doc) === true : false;
    } catch (_) {
      return false;
    }
  }

  // ------------------------------------------------------------------ config
  const config = {
    active: true,
    blockEvents: true,
    rafKeepAlive: true,
    forceResume: true
  };

  let installed = false;

  // ------------------------------------------------- 1. visibility overrides
  // Own properties on `document` shadow the prototype getters; deleting them
  // restores the real ones exactly.
  const FAKE_PROPERTIES = [
    { name: 'hidden', value: false, always: true },
    { name: 'visibilityState', value: 'visible', always: true },
    { name: 'webkitHidden', value: false, always: false },
    { name: 'webkitVisibilityState', value: 'visible', always: false }
  ];

  const definedProperties = [];
  let hasFocusPatched = false;

  function defineFakes() {
    for (const prop of FAKE_PROPERTIES) {
      // Only shadow legacy prefixed names if this browser actually has them,
      // so we never hand a site a legacy code path it would not otherwise take.
      if (!prop.always && !(prop.name in doc)) continue;
      if (Object.prototype.hasOwnProperty.call(doc, prop.name)) continue;
      try {
        Object.defineProperty(doc, prop.name, {
          configurable: true,
          enumerable: true,
          get: () => prop.value
        });
        definedProperties.push(prop.name);
      } catch (_) { /* a locked-down page: skip this one, keep the rest */ }
    }

    try {
      Object.defineProperty(doc, 'hasFocus', {
        configurable: true,
        writable: true,
        enumerable: false,
        value: function hasFocus() { return true; }
      });
      hasFocusPatched = true;
    } catch (_) { /* ignore */ }
  }

  function removeFakes() {
    while (definedProperties.length) {
      const name = definedProperties.pop();
      try { delete doc[name]; } catch (_) { /* ignore */ }
    }
    if (hasFocusPatched) {
      try { delete doc.hasFocus; } catch (_) { /* ignore */ }
      hasFocusPatched = false;
    }
  }

  // ------------------------------------------------------- 2. event blocking
  // Events that mean "you are in the background". Registered in the capture
  // phase on `window`, which sits ahead of `document` in the propagation path,
  // so we get first refusal on everything a page can listen for.
  const DOCUMENT_EVENTS = [
    'visibilitychange',
    'webkitvisibilitychange',
    'mozvisibilitychange',
    'msvisibilitychange',
    'freeze'
  ];
  // `blur` also passes through window on its way to focused elements, so it is
  // only swallowed when window itself is the target.
  const WINDOW_EVENTS = ['blur'];

  function onSuppressedEvent(event) {
    if (event.type === 'visibilitychange') onRealVisibilityChange();
    if (!config.active || !config.blockEvents) return;
    if (event.type === 'blur' && event.target !== win) return;
    event.stopImmediatePropagation();
    event.stopPropagation();
  }

  function addBlockers() {
    for (const type of DOCUMENT_EVENTS) listen(win, type, onSuppressedEvent);
    for (const type of WINDOW_EVENTS) listen(win, type, onSuppressedEvent);
  }

  function removeBlockers() {
    for (const type of DOCUMENT_EVENTS) unlisten(win, type, onSuppressedEvent);
    for (const type of WINDOW_EVENTS) unlisten(win, type, onSuppressedEvent);
  }

  function onRealVisibilityChange() {
    if (!trulyHidden()) stopTicker();
  }

  // -------------------------------------------------- 3. animation-frame keep-alive
  // Chrome stops firing rAF in a hidden tab. Anything driving playback, a
  // progress bar or a canvas renderer off rAF stalls with it. While the tab is
  // really hidden we serve those callbacks from a Worker-driven ticker instead;
  // worker timers are not clamped the way a hidden tab's setTimeout is.
  const ID_BASE = 1e8; // keeps our ids clear of the real ones
  let nextId = ID_BASE;
  const pendingCallbacks = new Map(); // ourId -> callback
  const realIds = new Map();          // ourId -> real rAF id
  let ticker = null;
  let rafPatched = false;

  function requestAnimationFrameShim(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError("Failed to execute 'requestAnimationFrame' on 'Window': The callback provided as parameter 1 is not a function.");
    }
    const id = ++nextId;
    if (!config.active || !config.rafKeepAlive || !trulyHidden() || !rafReal) {
      if (!rafReal) return id;
      const realId = rafReal((timestamp) => {
        realIds.delete(id);
        callback(timestamp);
      });
      realIds.set(id, realId);
      return id;
    }
    pendingCallbacks.set(id, callback);
    startTicker();
    return id;
  }

  function cancelAnimationFrameShim(id) {
    if (realIds.has(id)) {
      if (cafReal) cafReal(realIds.get(id));
      realIds.delete(id);
      return;
    }
    if (pendingCallbacks.has(id)) {
      pendingCallbacks.delete(id);
      return;
    }
    // An id we never issued (e.g. taken before we installed): pass it through.
    if (cafReal && typeof id === 'number' && id < ID_BASE) cafReal(id);
  }

  const TICKER_SOURCE =
    'var t=null;' +
    'onmessage=function(e){' +
    'if(e.data==="start"){if(t)return;t=setInterval(function(){postMessage(0)},16)}' +
    'else{clearInterval(t);t=null}' +
    '};';

  function startTicker() {
    if (ticker) return;
    try {
      const url = URL.createObjectURL(new Blob([TICKER_SOURCE], { type: 'text/javascript' }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = flushFrames;
      worker.postMessage('start');
      ticker = { stop() { try { worker.terminate(); } catch (_) { /* ignore */ } } };
    } catch (_) {
      // Strict CSP can forbid blob: workers. A hidden tab clamps setInterval to
      // ~1s, which is coarse but still keeps rAF-driven code moving.
      const handle = setInterval(flushFrames, 16);
      ticker = { stop() { clearInterval(handle); } };
    }
  }

  function stopTicker() {
    if (!ticker) return;
    ticker.stop();
    ticker = null;
  }

  function flushFrames() {
    if (!trulyHidden() || !config.active || !config.rafKeepAlive) {
      // Back in the foreground: hand anything still queued to the real rAF.
      const stragglers = Array.from(pendingCallbacks.values());
      pendingCallbacks.clear();
      stopTicker();
      if (rafReal) for (const callback of stragglers) rafReal(callback);
      return;
    }
    if (!pendingCallbacks.size) return;

    const batch = Array.from(pendingCallbacks.values());
    pendingCallbacks.clear();
    const timestamp = nowMs();
    for (const callback of batch) {
      try {
        callback(timestamp);
      } catch (error) {
        // Match native rAF: a throwing callback surfaces to window.onerror
        // instead of silently killing the rest of the batch.
        setTimeout(() => { throw error; }, 0);
      }
    }
  }

  function patchRaf() {
    if (rafPatched || !rafReal) return;
    try {
      win.requestAnimationFrame = requestAnimationFrameShim;
      win.cancelAnimationFrame = cancelAnimationFrameShim;
      rafPatched = true;
    } catch (_) { /* ignore */ }
  }

  function unpatchRaf() {
    if (!rafPatched) return;
    try {
      win.requestAnimationFrame = rafReal;
      win.cancelAnimationFrame = cafReal;
    } catch (_) { /* ignore */ }
    rafPatched = false;
    stopTicker();
    const stragglers = Array.from(pendingCallbacks.values());
    pendingCallbacks.clear();
    if (rafReal) for (const callback of stragglers) rafReal(callback);
  }

  // ------------------------------------------------------- 4. force resume
  // Last line of defence for players that pause through a path we cannot see
  // (a server nudge, a media-key handler, their own watchdog). Bounded to a few
  // attempts per element per window so we never wrestle the user or the site.
  const RESUME_LIMIT = 3;
  const RESUME_WINDOW_MS = 15000;
  const DEDUPE_MS = 60;
  const resumeAttempts = new WeakMap();
  const lastHandled = new WeakMap();

  function handlePause(media) {
    if (!config.active || !config.forceResume) return;
    if (!(media instanceof HTMLMediaElement)) return;
    if (!trulyHidden()) return;               // a pause you can see is a pause you meant
    if (media.ended || media.seeking) return;
    if (!media.currentSrc && !media.src) return;
    if (media.readyState === 0) return;

    const stamp = Date.now();
    // The event listener and the pause() wrapper can both see one pause.
    if (stamp - (lastHandled.get(media) || 0) < DEDUPE_MS) return;
    lastHandled.set(media, stamp);

    const record = resumeAttempts.get(media) || { count: 0, at: 0 };
    if (stamp - record.at > RESUME_WINDOW_MS) record.count = 0;
    if (record.count >= RESUME_LIMIT) return;
    record.count += 1;
    record.at = stamp;
    resumeAttempts.set(media, record);

    // Let the site's own pause handler finish before contradicting it.
    setTimeout(() => {
      if (!config.active || !config.forceResume) return;
      if (!trulyHidden() || !media.paused || media.ended) return;
      const attempt = media.play();
      if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
    }, 0);
  }

  function onMediaPause(event) { handlePause(event.target); }

  // A `pause` event only reaches `document` from an element that is in the
  // document. Plenty of audio players never attach theirs (`new Audio()`), so
  // the method itself is wrapped as well — same handler, no change in what
  // pause() actually does.
  const nativePause = HTMLMediaElement.prototype.pause;
  let pausePatched = false;

  function addResumeWatcher() {
    listen(doc, 'pause', onMediaPause);
    try {
      HTMLMediaElement.prototype.pause = function pause() {
        const result = nativePause.apply(this, arguments);
        try { handlePause(this); } catch (_) { /* never break the page's pause */ }
        return result;
      };
      pausePatched = true;
    } catch (_) { /* ignore */ }
  }

  function removeResumeWatcher() {
    unlisten(doc, 'pause', onMediaPause);
    if (!pausePatched) return;
    try { HTMLMediaElement.prototype.pause = nativePause; } catch (_) { /* ignore */ }
    pausePatched = false;
  }

  // ----------------------------------------------------------------- wiring
  function install() {
    if (installed) return;
    installed = true;
    defineFakes();
    addBlockers();
    patchRaf();
    addResumeWatcher();
  }

  function uninstall() {
    if (!installed) return;
    installed = false;
    removeResumeWatcher();
    unpatchRaf();
    removeBlockers();
    removeFakes();
  }

  function apply(next) {
    if (next && typeof next === 'object') {
      if (typeof next.active === 'boolean') config.active = next.active;
      if (typeof next.blockEvents === 'boolean') config.blockEvents = next.blockEvents;
      if (typeof next.rafKeepAlive === 'boolean') config.rafKeepAlive = next.rafKeepAlive;
      if (typeof next.forceResume === 'boolean') config.forceResume = next.forceResume;
    }
    if (config.active) install(); else uninstall();
    if (!config.active || !config.rafKeepAlive) stopTicker();
  }

  // The bridge lives in the isolated world and owns chrome.storage. Config
  // crosses as a JSON string so no object has to survive the world boundary.
  listen(doc, 'antitab:config', (event) => {
    try {
      apply(JSON.parse(event.detail));
    } catch (_) { /* ignore malformed input, including a page's own forgeries */ }
  });

  function hello() {
    doc.dispatchEvent(new CustomEvent('antitab:hello'));
  }

  Object.defineProperty(win, NS, {
    configurable: true,
    enumerable: false,
    value: Object.freeze({
      version: VERSION,
      hello,
      apply,
      state: () => ({
        version: VERSION,
        installed,
        config: { ...config },
        trulyHidden: trulyHidden(),
        ticking: !!ticker,
        queuedFrames: pendingCallbacks.size
      })
    })
  });

  install();
  hello(); // ask the bridge for the real settings
})();
