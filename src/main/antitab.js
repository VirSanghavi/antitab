/**
 * Antitab — main-world payload.
 *
 * Runs at document_start in the page's own JavaScript world, before any site
 * script, so the page never observes a moment where the tab looks hidden.
 *
 * Chrome tells a page four different things when you switch away, and each one
 * gets its own switch here:
 *
 *   1. presence   — "your tab is hidden / you lost focus".
 *                   document.hidden, visibilityState, hasFocus, userActivation
 *                   and the visibilitychange / blur / freeze events all keep
 *                   saying you are right here.
 *   2. keepAlive  — "you are in the background, so I am throttling you".
 *                   requestAnimationFrame stops entirely and timers are clamped
 *                   to once a second (once a minute after five minutes). Both
 *                   are served from a Worker timer instead, which Chrome does
 *                   not throttle.
 *   3. fakeActivity — "nobody has touched this page in a while". Idle timers,
 *                   session timeouts and "are you still there?" prompts watch
 *                   for input events, so a little pointer movement is
 *                   synthesised while the tab is genuinely hidden.
 *   4. forceResume — a player that pauses anyway gets play pressed again.
 *
 * Everything is reversible: uninstall() puts the page back exactly as it was.
 */
(() => {
  'use strict';

  const NS = '__antitab';
  const VERSION = '1.1.0';
  const win = window;
  const doc = document;

  if (win[NS]) {
    win[NS].hello();
    return;
  }

  // ---------------------------------------------------------------- pristine
  // Captured before the page can wrap anything, and used internally so the
  // payload never runs through its own shims.
  const addEventListener_ = EventTarget.prototype.addEventListener;
  const removeEventListener_ = EventTarget.prototype.removeEventListener;
  const listen = (target, type, fn, options) =>
    addEventListener_.call(target, type, fn, options === undefined ? true : options);
  const unlisten = (target, type, fn, options) =>
    removeEventListener_.call(target, type, fn, options === undefined ? true : options);

  const bindOrNull = (fn) => (typeof fn === 'function' ? fn.bind(win) : null);
  const rafReal = bindOrNull(win.requestAnimationFrame);
  const cafReal = bindOrNull(win.cancelAnimationFrame);
  const setTimeoutReal = bindOrNull(win.setTimeout);
  const clearTimeoutReal = bindOrNull(win.clearTimeout);
  const setIntervalReal = bindOrNull(win.setInterval);
  const clearIntervalReal = bindOrNull(win.clearInterval);
  const ricReal = bindOrNull(win.requestIdleCallback);
  const cicReal = bindOrNull(win.cancelIdleCallback);

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

  /** Rethrow out of band, so one bad callback cannot take the batch with it. */
  function rethrow(error) {
    if (setTimeoutReal) setTimeoutReal(() => { throw error; }, 0);
  }

  function safeCall(fn, args) {
    try {
      fn.apply(win, args || []);
    } catch (error) {
      rethrow(error);
    }
  }

  // ------------------------------------------------------------------ config
  const config = {
    active: true,
    presence: true,
    keepAlive: true,
    fakeActivity: true,
    forceResume: true
  };

  let installed = false;

  // ------------------------------------------------------- 1. presence: props
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
  let userActivationPatched = false;
  const idleDetectorPatches = [];

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

    // Sites gate autoplay and other privileges on a recent user gesture.
    if ('userActivation' in navigator) {
      try {
        Object.defineProperty(navigator, 'userActivation', {
          configurable: true,
          enumerable: true,
          get: () => ({ isActive: true, hasBeenActive: true })
        });
        userActivationPatched = true;
      } catch (_) { /* ignore */ }
    }

    // The Idle Detection API reports the whole machine as idle or locked.
    if (typeof win.IdleDetector === 'function') {
      for (const [name, value] of [['userState', 'active'], ['screenState', 'unlocked']]) {
        const original = Object.getOwnPropertyDescriptor(win.IdleDetector.prototype, name);
        if (!original || !original.configurable) continue;
        try {
          Object.defineProperty(win.IdleDetector.prototype, name, {
            configurable: true,
            enumerable: original.enumerable,
            get: () => value
          });
          idleDetectorPatches.push([name, original]);
        } catch (_) { /* ignore */ }
      }
    }
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
    if (userActivationPatched) {
      try { delete navigator.userActivation; } catch (_) { /* ignore */ }
      userActivationPatched = false;
    }
    while (idleDetectorPatches.length) {
      const [name, descriptor] = idleDetectorPatches.pop();
      try { Object.defineProperty(win.IdleDetector.prototype, name, descriptor); } catch (_) { /* ignore */ }
    }
  }

  // ------------------------------------------------------ 2. presence: events
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

  /**
   * A `visibilitychange` is dispatched at `document`, so its path runs
   * window then document and a capture listener on window always goes first,
   * whenever it was added. A window `blur` is dispatched at `window` itself,
   * where every listener is in the target phase and they run in the order they
   * were added. Injected at document_start we are first and can swallow it;
   * injected from a bookmarklet, into a page that wired up its own handler
   * minutes ago, we are last and cannot.
   *
   * True when the page had already loaded by the time we installed, which is
   * exactly the case where that race is lost.
   */
  const installedLate = doc.readyState !== 'loading';
  let restoringFocus = false;

  function onSuppressedEvent(event) {
    if (event.type === 'visibilitychange') onRealVisibilityChange();
    if (!config.active || !config.presence) return;
    if (event.type === 'blur' && event.target !== win) return;

    if (event.type === 'blur' && installedLate && !restoringFocus) {
      // Whoever was listening before us has already heard it. The next best
      // thing is to hand focus straight back, so anything that pauses on blur
      // and resumes on focus ends up running again.
      restoringFocus = true;
      setTimeoutReal(() => {
        restoringFocus = false;
        try {
          win.dispatchEvent(new FocusEvent('focus'));
        } catch (_) {
          try { win.dispatchEvent(new Event('focus')); } catch (__) { /* ignore */ }
        }
      }, 0);
    }

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
    const hidden = trulyHidden();
    migrateTimers(hidden);
    if (hidden) {
      if (config.active && config.fakeActivity) startActivity();
    } else {
      stopActivity();
      if (!pendingFrames.size && !hasShimmedTimers()) stopTicker();
    }
  }

  // ----------------------------------------------- 3. the unthrottled ticker
  // Chrome stops requestAnimationFrame in a hidden tab and clamps timers to one
  // a second, then one a minute. A Worker's timer is not throttled, so it is
  // used to drive both while the tab is really hidden.
  let ticker = null;

  const TICKER_SOURCE =
    'var t=null;' +
    'onmessage=function(e){' +
    'if(e.data==="start"){if(t)return;t=setInterval(function(){postMessage(0)},16)}' +
    'else{clearInterval(t);t=null}' +
    '};';

  // A strict `worker-src` or `script-src` refuses blob: workers outright, and
  // plenty of sites send one. Worth trying once per page, never worth trying
  // twice: the refusal is a console error every time, and it will not change.
  let workerRefused = false;

  function startTicker() {
    if (ticker) return;

    if (!workerRefused) {
      try {
        const url = URL.createObjectURL(new Blob([TICKER_SOURCE], { type: 'text/javascript' }));
        const worker = new Worker(url);
        URL.revokeObjectURL(url);
        worker.onmessage = tick;
        worker.onerror = () => {
          // Refused asynchronously: drop to the fallback rather than sit behind
          // a ticker object that will never tick.
          workerRefused = true;
          if (ticker && ticker.viaWorker) {
            stopTicker();
            startTicker();
          }
        };
        worker.postMessage('start');
        ticker = {
          viaWorker: true,
          stop() { try { worker.terminate(); } catch (_) { /* ignore */ } }
        };
        return;
      } catch (_) {
        workerRefused = true;
      }
    }

    // A hidden tab clamps setInterval to about a second, which is coarse but
    // still keeps things moving.
    const handle = setIntervalReal(tick, 16);
    ticker = { viaWorker: false, stop() { clearIntervalReal(handle); } };
  }

  function stopTicker() {
    if (!ticker) return;
    ticker.stop();
    ticker = null;
  }

  function tick() {
    const hidden = trulyHidden();
    if (!hidden || !config.active || !config.keepAlive) {
      flushFramesToNative();
      migrateTimers(hidden);
      stopTicker();
      return;
    }
    flushFrames();
    flushTimers();
    if (!pendingFrames.size && !hasShimmedTimers()) stopTicker();
  }

  // ------------------------------------------------- 4. animation frames
  const FRAME_ID_BASE = 1e8;
  let nextFrameId = FRAME_ID_BASE;
  const pendingFrames = new Map(); // ourId -> callback
  const frameNativeIds = new Map(); // ourId -> real rAF id
  let rafPatched = false;

  function requestAnimationFrameShim(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError("Failed to execute 'requestAnimationFrame' on 'Window': The callback provided as parameter 1 is not a function.");
    }
    const id = ++nextFrameId;
    if (!config.active || !config.keepAlive || !trulyHidden() || !rafReal) {
      if (!rafReal) return id;
      const nativeId = rafReal((timestamp) => {
        frameNativeIds.delete(id);
        callback(timestamp);
      });
      frameNativeIds.set(id, nativeId);
      return id;
    }
    pendingFrames.set(id, callback);
    startTicker();
    return id;
  }

  function cancelAnimationFrameShim(id) {
    if (frameNativeIds.has(id)) {
      if (cafReal) cafReal(frameNativeIds.get(id));
      frameNativeIds.delete(id);
      return;
    }
    if (pendingFrames.has(id)) {
      pendingFrames.delete(id);
      return;
    }
    // An id we never issued (taken before we installed): pass it through.
    if (cafReal && typeof id === 'number' && id < FRAME_ID_BASE) cafReal(id);
  }

  function flushFrames() {
    if (!pendingFrames.size) return;
    const batch = Array.from(pendingFrames.values());
    pendingFrames.clear();
    const timestamp = nowMs();
    for (const callback of batch) {
      try {
        callback(timestamp);
      } catch (error) {
        rethrow(error);
      }
    }
  }

  /** Back in the foreground: hand anything queued to the real rAF. */
  function flushFramesToNative() {
    if (!pendingFrames.size || !rafReal) return;
    const batch = Array.from(pendingFrames.values());
    pendingFrames.clear();
    for (const callback of batch) rafReal(callback);
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
    flushFramesToNative();
  }

  // ------------------------------------------------------------- 5. timers
  // One registry for setTimeout, setInterval and requestIdleCallback, because
  // the browser shares one id space between clearTimeout and clearInterval and
  // pages rely on that.
  const TIMER_ID_BASE = 2e8;
  let nextTimerId = TIMER_ID_BASE;
  const timers = new Map(); // ourId -> record
  let timersPatched = false;

  const hasShimmedTimers = () => {
    for (const record of timers.values()) if (record.nativeId === undefined) return true;
    return false;
  };

  const shouldShimTimers = () => config.active && config.keepAlive && trulyHidden();

  function scheduleNative(id, record) {
    const fire = (...args) => {
      if (record.kind === 'timeout' || record.kind === 'idle') timers.delete(id);
      safeCall(record.fn, record.kind === 'idle' ? [idleDeadline()] : args);
    };
    if (record.kind === 'interval') {
      record.nativeId = setIntervalReal(fire, record.delay, ...record.args);
    } else if (record.kind === 'idle' && ricReal) {
      record.nativeId = ricReal(() => fire());
      record.idle = true;
    } else {
      record.nativeId = setTimeoutReal(fire, Math.max(0, record.due - nowMs()), ...record.args);
    }
  }

  function clearNative(record) {
    if (record.nativeId === undefined) return;
    if (record.kind === 'interval') clearIntervalReal(record.nativeId);
    else if (record.idle && cicReal) cicReal(record.nativeId);
    else clearTimeoutReal(record.nativeId);
    record.nativeId = undefined;
    record.idle = false;
  }

  const idleDeadline = () => ({ didTimeout: false, timeRemaining: () => 12 });

  function makeTimer(kind, handler, delay, args) {
    const id = ++nextTimerId;
    const wait = Math.max(0, Number(delay) || 0);
    const record = { kind, fn: handler, args, delay: wait, due: nowMs() + wait };
    timers.set(id, record);
    if (shouldShimTimers()) startTicker(); else scheduleNative(id, record);
    return id;
  }

  function setTimeoutShim(handler, delay, ...args) {
    // The string form runs through the browser's own evaluator; leave it alone.
    if (typeof handler !== 'function') return setTimeoutReal(handler, delay, ...args);
    return makeTimer('timeout', handler, delay, args);
  }

  function setIntervalShim(handler, delay, ...args) {
    if (typeof handler !== 'function') return setIntervalReal(handler, delay, ...args);
    return makeTimer('interval', handler, delay, args);
  }

  function requestIdleCallbackShim(handler, options) {
    if (typeof handler !== 'function') return ricReal ? ricReal(handler, options) : 0;
    // A hidden tab never goes idle in the browser's eyes, so this becomes a
    // short timeout, which is what the callers actually want.
    return makeTimer('idle', handler, (options && options.timeout) || 50, []);
  }

  function clearTimerShim(id) {
    const record = timers.get(id);
    if (record) {
      clearNative(record);
      timers.delete(id);
      return;
    }
    if (typeof id === 'number' && id < TIMER_ID_BASE) {
      // Not ours: could be either kind, and clearing the wrong one is a no-op.
      if (clearTimeoutReal) clearTimeoutReal(id);
      if (clearIntervalReal) clearIntervalReal(id);
    }
  }

  function cancelIdleCallbackShim(id) {
    const record = timers.get(id);
    if (record) {
      clearNative(record);
      timers.delete(id);
      return;
    }
    if (cicReal && typeof id === 'number' && id < TIMER_ID_BASE) cicReal(id);
  }

  function flushTimers() {
    if (!timers.size) return;
    const now = nowMs();
    for (const [id, record] of Array.from(timers)) {
      if (record.nativeId !== undefined || record.due > now) continue;
      if (record.kind === 'interval') {
        record.due = now + Math.max(record.delay, 4);
        safeCall(record.fn, record.args);
      } else {
        timers.delete(id);
        safeCall(record.fn, record.kind === 'idle' ? [idleDeadline()] : record.args);
      }
    }
  }

  /**
   * A timer set while the tab was visible is a native one, and Chrome throttles
   * it the moment you leave. Moving pending timers between the browser and the
   * ticker on every visibility change is what keeps a poll set at page load
   * running at its real interval.
   */
  function migrateTimers(hidden) {
    if (!timersPatched) return;
    const toTicker = hidden && config.active && config.keepAlive;
    let moved = false;
    for (const [id, record] of timers) {
      if (toTicker && record.nativeId !== undefined) {
        clearNative(record);
        moved = true;
      } else if (!toTicker && record.nativeId === undefined) {
        scheduleNative(id, record);
      }
    }
    if (moved) startTicker();
  }

  function patchTimers() {
    if (timersPatched || !setTimeoutReal) return;
    try {
      win.setTimeout = setTimeoutShim;
      win.setInterval = setIntervalShim;
      win.clearTimeout = clearTimerShim;
      win.clearInterval = clearTimerShim;
      if (ricReal) {
        win.requestIdleCallback = requestIdleCallbackShim;
        win.cancelIdleCallback = cancelIdleCallbackShim;
      }
      timersPatched = true;
    } catch (_) { /* ignore */ }
  }

  function unpatchTimers() {
    if (!timersPatched) return;
    try {
      win.setTimeout = setTimeoutReal;
      win.setInterval = setIntervalReal;
      win.clearTimeout = clearTimeoutReal;
      win.clearInterval = clearIntervalReal;
      if (ricReal) {
        win.requestIdleCallback = ricReal;
        win.cancelIdleCallback = cicReal;
      }
    } catch (_) { /* ignore */ }
    timersPatched = false;
    // Hand anything still pending back to the browser so nothing is dropped.
    for (const [id, record] of timers) {
      if (record.nativeId === undefined) scheduleNative(id, record);
    }
    timers.clear();
  }

  // -------------------------------------------------------- 6. fake activity
  // Idle timers, session timeouts and "are you still there?" prompts watch for
  // input. Only ever synthesised while the tab is genuinely hidden, so it can
  // never land on top of something you are actually doing.
  const ACTIVITY_PERIOD_MS = 30000;
  let activityHandle = null;
  let lastPointer = { x: 0, y: 0 };

  function rememberPointer(event) {
    if (!event.isTrusted) return;
    lastPointer = { x: event.clientX || 0, y: event.clientY || 0 };
  }

  function nudge() {
    if (!config.active || !config.fakeActivity || !trulyHidden()) return;
    // A pixel of drift, so a listener comparing coordinates still sees a change.
    const x = lastPointer.x + (lastPointer.x > 0 ? -1 : 1);
    const y = lastPointer.y;
    lastPointer = { x, y };

    for (const type of ['mousemove', 'pointermove']) {
      let event;
      try {
        const Ctor = type === 'pointermove' && typeof win.PointerEvent === 'function'
          ? win.PointerEvent : win.MouseEvent;
        event = new Ctor(type, {
          bubbles: true, cancelable: false, view: win, clientX: x, clientY: y
        });
      } catch (_) {
        continue;
      }
      try { doc.dispatchEvent(event); } catch (_) { /* ignore */ }
    }
  }

  function startActivity() {
    if (activityHandle !== null) return;
    // Driven by the real timer, so it survives whatever the page does to ours.
    activityHandle = setIntervalReal(nudge, ACTIVITY_PERIOD_MS);
    nudge();
  }

  function stopActivity() {
    if (activityHandle === null) return;
    clearIntervalReal(activityHandle);
    activityHandle = null;
  }

  // -------------------------------------------------------- 7. force resume
  // Last line of defence for players that pause through a path we cannot see
  // (a server nudge, a media-key handler, their own watchdog). Bounded to a few
  // attempts per element per window so it never wrestles the user or the site.
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
    setTimeoutReal(() => {
      if (!config.active || !config.forceResume) return;
      if (!trulyHidden() || !media.paused || media.ended) return;
      const attempt = media.play();
      if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
    }, 0);
  }

  function onMediaPause(event) { handlePause(event.target); }

  // A `pause` event only reaches `document` from an element that is in the
  // document. Plenty of audio players never attach theirs (`new Audio()`), so
  // the method itself is wrapped as well, same handler, no change in what
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
    patchTimers();
    addResumeWatcher();
    listen(doc, 'mousemove', rememberPointer, { capture: true, passive: true });
    if (config.fakeActivity && trulyHidden()) startActivity();
  }

  function uninstall() {
    if (!installed) return;
    installed = false;
    unlisten(doc, 'mousemove', rememberPointer, { capture: true, passive: true });
    stopActivity();
    removeResumeWatcher();
    unpatchTimers();
    unpatchRaf();
    removeBlockers();
    removeFakes();
    stopTicker();
  }

  function apply(next) {
    if (next && typeof next === 'object') {
      for (const key of ['active', 'presence', 'keepAlive', 'fakeActivity', 'forceResume']) {
        if (typeof next[key] === 'boolean') config[key] = next[key];
      }
      // Accept the 1.0 name so an older stored setting still means something.
      if (typeof next.blockEvents === 'boolean' && typeof next.presence !== 'boolean') {
        config.presence = next.blockEvents;
      }
      if (typeof next.rafKeepAlive === 'boolean' && typeof next.keepAlive !== 'boolean') {
        config.keepAlive = next.rafKeepAlive;
      }
    }

    if (config.active) install(); else uninstall();
    if (!installed) return;

    if (!config.keepAlive) {
      migrateTimers(false);
      flushFramesToNative();
      stopTicker();
    } else if (trulyHidden()) {
      migrateTimers(true);
    }

    if (config.fakeActivity && trulyHidden()) startActivity(); else stopActivity();
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
        queuedFrames: pendingFrames.size,
        queuedTimers: timers.size,
        faking: activityHandle !== null
      })
    })
  });

  install();
  hello(); // ask the bridge for the real settings
})();
