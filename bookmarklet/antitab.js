/* Antitab 1.2.0 — keeps a tab's video playing after you switch away.
   Source: https://github.com/VirSanghavi/antitab — MIT licensed. */
(function(){
var __antitabWasInstalled = !!window.__antitab;
var __antitabSource = "(() => {\n'use strict';\nconst NS = '__antitab';\nconst VERSION = '1.2.0';\nconst win = window;\nconst doc = document;\nif (win[NS]) {\nwin[NS].hello();\nreturn;\n}\nconst addEventListener_ = EventTarget.prototype.addEventListener;\nconst removeEventListener_ = EventTarget.prototype.removeEventListener;\nconst listen = (target, type, fn, options) =>\naddEventListener_.call(target, type, fn, options === undefined ? true : options);\nconst unlisten = (target, type, fn, options) =>\nremoveEventListener_.call(target, type, fn, options === undefined ? true : options);\nconst bindOrNull = (fn) => (typeof fn === 'function' ? fn.bind(win) : null);\nconst rafReal = bindOrNull(win.requestAnimationFrame);\nconst cafReal = bindOrNull(win.cancelAnimationFrame);\nconst setTimeoutReal = bindOrNull(win.setTimeout);\nconst clearTimeoutReal = bindOrNull(win.clearTimeout);\nconst setIntervalReal = bindOrNull(win.setInterval);\nconst clearIntervalReal = bindOrNull(win.clearInterval);\nconst ricReal = bindOrNull(win.requestIdleCallback);\nconst cicReal = bindOrNull(win.cancelIdleCallback);\nconst nowMs = () => (win.performance && win.performance.now)\n? win.performance.now() : Date.now();\nconst protoDescriptor = (name) => Object.getOwnPropertyDescriptor(Document.prototype, name);\nconst realHiddenGetter = (protoDescriptor('hidden') || {}).get;\nfunction trulyHidden() {\ntry {\nreturn realHiddenGetter ? realHiddenGetter.call(doc) === true : false;\n} catch (_) {\nreturn false;\n}\n}\nfunction rethrow(error) {\nif (setTimeoutReal) setTimeoutReal(() => { throw error; }, 0);\n}\nfunction safeCall(fn, args) {\ntry {\nfn.apply(win, args || []);\n} catch (error) {\nrethrow(error);\n}\n}\nconst config = {\nactive: true,\npresence: true,\nkeepAlive: true,\nfakeActivity: true,\nforceResume: true\n};\nlet installed = false;\nconst FAKE_PROPERTIES = [\n{ name: 'hidden', value: false, always: true },\n{ name: 'visibilityState', value: 'visible', always: true },\n{ name: 'webkitHidden', value: false, always: false },\n{ name: 'webkitVisibilityState', value: 'visible', always: false }\n];\nconst definedProperties = [];\nlet hasFocusPatched = false;\nlet userActivationPatched = false;\nconst idleDetectorPatches = [];\nfunction defineFakes() {\nfor (const prop of FAKE_PROPERTIES) {\nif (!prop.always && !(prop.name in doc)) continue;\nif (Object.prototype.hasOwnProperty.call(doc, prop.name)) continue;\ntry {\nObject.defineProperty(doc, prop.name, {\nconfigurable: true,\nenumerable: true,\nget: () => prop.value\n});\ndefinedProperties.push(prop.name);\n} catch (_) {  }\n}\ntry {\nObject.defineProperty(doc, 'hasFocus', {\nconfigurable: true,\nwritable: true,\nenumerable: false,\nvalue: function hasFocus() { return true; }\n});\nhasFocusPatched = true;\n} catch (_) {  }\nif ('userActivation' in navigator) {\ntry {\nObject.defineProperty(navigator, 'userActivation', {\nconfigurable: true,\nenumerable: true,\nget: () => ({ isActive: true, hasBeenActive: true })\n});\nuserActivationPatched = true;\n} catch (_) {  }\n}\nif (typeof win.IdleDetector === 'function') {\nfor (const [name, value] of [['userState', 'active'], ['screenState', 'unlocked']]) {\nconst original = Object.getOwnPropertyDescriptor(win.IdleDetector.prototype, name);\nif (!original || !original.configurable) continue;\ntry {\nObject.defineProperty(win.IdleDetector.prototype, name, {\nconfigurable: true,\nenumerable: original.enumerable,\nget: () => value\n});\nidleDetectorPatches.push([name, original]);\n} catch (_) {  }\n}\n}\n}\nfunction removeFakes() {\nwhile (definedProperties.length) {\nconst name = definedProperties.pop();\ntry { delete doc[name]; } catch (_) {  }\n}\nif (hasFocusPatched) {\ntry { delete doc.hasFocus; } catch (_) {  }\nhasFocusPatched = false;\n}\nif (userActivationPatched) {\ntry { delete navigator.userActivation; } catch (_) {  }\nuserActivationPatched = false;\n}\nwhile (idleDetectorPatches.length) {\nconst [name, descriptor] = idleDetectorPatches.pop();\ntry { Object.defineProperty(win.IdleDetector.prototype, name, descriptor); } catch (_) {  }\n}\n}\nconst DOCUMENT_EVENTS = [\n'visibilitychange',\n'webkitvisibilitychange',\n'mozvisibilitychange',\n'msvisibilitychange',\n'freeze'\n];\nconst WINDOW_EVENTS = ['blur'];\nconst installedLate = doc.readyState !== 'loading';\nlet restoringFocus = false;\nfunction onSuppressedEvent(event) {\nif (event.type === 'visibilitychange') onRealVisibilityChange();\nif (!config.active || !config.presence) return;\nif (event.type === 'blur' && event.target !== win) return;\nif (event.type === 'blur' && installedLate && !restoringFocus) {\nrestoringFocus = true;\nsetTimeoutReal(() => {\nrestoringFocus = false;\ntry {\nwin.dispatchEvent(new FocusEvent('focus'));\n} catch (_) {\ntry { win.dispatchEvent(new Event('focus')); } catch (__) {  }\n}\n}, 0);\n}\nevent.stopImmediatePropagation();\nevent.stopPropagation();\n}\nfunction addBlockers() {\nfor (const type of DOCUMENT_EVENTS) listen(win, type, onSuppressedEvent);\nfor (const type of WINDOW_EVENTS) listen(win, type, onSuppressedEvent);\n}\nfunction removeBlockers() {\nfor (const type of DOCUMENT_EVENTS) unlisten(win, type, onSuppressedEvent);\nfor (const type of WINDOW_EVENTS) unlisten(win, type, onSuppressedEvent);\n}\nfunction onRealVisibilityChange() {\nconst hidden = trulyHidden();\nmigrateTimers(hidden);\nif (hidden) {\nif (config.active && config.fakeActivity) startActivity();\n} else {\nstopActivity();\nif (!pendingFrames.size && !hasShimmedTimers()) stopTicker();\n}\n}\nlet ticker = null;\nconst TICKER_SOURCE =\n'var t=null;' +\n'onmessage=function(e){' +\n'if(e.data===\"start\"){if(t)return;t=setInterval(function(){postMessage(0)},16)}' +\n'else{clearInterval(t);t=null}' +\n'};';\nlet workerRefused = false;\nfunction startTicker() {\nif (ticker) return;\nif (!workerRefused) {\ntry {\nconst url = URL.createObjectURL(new Blob([TICKER_SOURCE], { type: 'text/javascript' }));\nconst worker = new Worker(url);\nURL.revokeObjectURL(url);\nworker.onmessage = tick;\nworker.onerror = () => {\nworkerRefused = true;\nif (ticker && ticker.viaWorker) {\nstopTicker();\nstartTicker();\n}\n};\nworker.postMessage('start');\nticker = {\nviaWorker: true,\nstop() { try { worker.terminate(); } catch (_) {  } }\n};\nreturn;\n} catch (_) {\nworkerRefused = true;\n}\n}\nconst handle = setIntervalReal(tick, 16);\nticker = { viaWorker: false, stop() { clearIntervalReal(handle); } };\n}\nfunction stopTicker() {\nif (!ticker) return;\nticker.stop();\nticker = null;\n}\nfunction tick() {\nconst hidden = trulyHidden();\nif (!hidden || !config.active || !config.keepAlive) {\nflushFramesToNative();\nmigrateTimers(hidden);\nstopTicker();\nreturn;\n}\nflushFrames();\nflushTimers();\nif (!pendingFrames.size && !hasShimmedTimers()) stopTicker();\n}\nconst FRAME_ID_BASE = 1e8;\nlet nextFrameId = FRAME_ID_BASE;\nconst pendingFrames = new Map();\nconst frameNativeIds = new Map();\nlet rafPatched = false;\nfunction requestAnimationFrameShim(callback) {\nif (typeof callback !== 'function') {\nthrow new TypeError(\"Failed to execute 'requestAnimationFrame' on 'Window': The callback provided as parameter 1 is not a function.\");\n}\nconst id = ++nextFrameId;\nif (!config.active || !config.keepAlive || !trulyHidden() || !rafReal) {\nif (!rafReal) return id;\nconst nativeId = rafReal((timestamp) => {\nframeNativeIds.delete(id);\ncallback(timestamp);\n});\nframeNativeIds.set(id, nativeId);\nreturn id;\n}\npendingFrames.set(id, callback);\nstartTicker();\nreturn id;\n}\nfunction cancelAnimationFrameShim(id) {\nif (frameNativeIds.has(id)) {\nif (cafReal) cafReal(frameNativeIds.get(id));\nframeNativeIds.delete(id);\nreturn;\n}\nif (pendingFrames.has(id)) {\npendingFrames.delete(id);\nreturn;\n}\nif (cafReal && typeof id === 'number' && id < FRAME_ID_BASE) cafReal(id);\n}\nfunction flushFrames() {\nif (!pendingFrames.size) return;\nconst batch = Array.from(pendingFrames.values());\npendingFrames.clear();\nconst timestamp = nowMs();\nfor (const callback of batch) {\ntry {\ncallback(timestamp);\n} catch (error) {\nrethrow(error);\n}\n}\n}\nfunction flushFramesToNative() {\nif (!pendingFrames.size || !rafReal) return;\nconst batch = Array.from(pendingFrames.values());\npendingFrames.clear();\nfor (const callback of batch) rafReal(callback);\n}\nfunction patchRaf() {\nif (rafPatched || !rafReal) return;\ntry {\nwin.requestAnimationFrame = requestAnimationFrameShim;\nwin.cancelAnimationFrame = cancelAnimationFrameShim;\nrafPatched = true;\n} catch (_) {  }\n}\nfunction unpatchRaf() {\nif (!rafPatched) return;\ntry {\nwin.requestAnimationFrame = rafReal;\nwin.cancelAnimationFrame = cafReal;\n} catch (_) {  }\nrafPatched = false;\nflushFramesToNative();\n}\nconst TIMER_ID_BASE = 2e8;\nlet nextTimerId = TIMER_ID_BASE;\nconst timers = new Map();\nlet timersPatched = false;\nconst hasShimmedTimers = () => {\nfor (const record of timers.values()) if (record.nativeId === undefined) return true;\nreturn false;\n};\nconst shouldShimTimers = () => config.active && config.keepAlive && trulyHidden();\nfunction scheduleNative(id, record) {\nconst fire = (...args) => {\nif (record.kind === 'timeout' || record.kind === 'idle') timers.delete(id);\nsafeCall(record.fn, record.kind === 'idle' ? [idleDeadline()] : args);\n};\nif (record.kind === 'interval') {\nrecord.nativeId = setIntervalReal(fire, record.delay, ...record.args);\n} else if (record.kind === 'idle' && ricReal) {\nrecord.nativeId = ricReal(() => fire());\nrecord.idle = true;\n} else {\nrecord.nativeId = setTimeoutReal(fire, Math.max(0, record.due - nowMs()), ...record.args);\n}\n}\nfunction clearNative(record) {\nif (record.nativeId === undefined) return;\nif (record.kind === 'interval') clearIntervalReal(record.nativeId);\nelse if (record.idle && cicReal) cicReal(record.nativeId);\nelse clearTimeoutReal(record.nativeId);\nrecord.nativeId = undefined;\nrecord.idle = false;\n}\nconst idleDeadline = () => ({ didTimeout: false, timeRemaining: () => 12 });\nfunction makeTimer(kind, handler, delay, args) {\nconst id = ++nextTimerId;\nconst wait = Math.max(0, Number(delay) || 0);\nconst record = { kind, fn: handler, args, delay: wait, due: nowMs() + wait };\ntimers.set(id, record);\nif (shouldShimTimers()) startTicker(); else scheduleNative(id, record);\nreturn id;\n}\nfunction setTimeoutShim(handler, delay, ...args) {\nif (typeof handler !== 'function') return setTimeoutReal(handler, delay, ...args);\nreturn makeTimer('timeout', handler, delay, args);\n}\nfunction setIntervalShim(handler, delay, ...args) {\nif (typeof handler !== 'function') return setIntervalReal(handler, delay, ...args);\nreturn makeTimer('interval', handler, delay, args);\n}\nfunction requestIdleCallbackShim(handler, options) {\nif (typeof handler !== 'function') return ricReal ? ricReal(handler, options) : 0;\nreturn makeTimer('idle', handler, (options && options.timeout) || 50, []);\n}\nfunction clearTimerShim(id) {\nconst record = timers.get(id);\nif (record) {\nclearNative(record);\ntimers.delete(id);\nreturn;\n}\nif (typeof id === 'number' && id < TIMER_ID_BASE) {\nif (clearTimeoutReal) clearTimeoutReal(id);\nif (clearIntervalReal) clearIntervalReal(id);\n}\n}\nfunction cancelIdleCallbackShim(id) {\nconst record = timers.get(id);\nif (record) {\nclearNative(record);\ntimers.delete(id);\nreturn;\n}\nif (cicReal && typeof id === 'number' && id < TIMER_ID_BASE) cicReal(id);\n}\nfunction flushTimers() {\nif (!timers.size) return;\nconst now = nowMs();\nfor (const [id, record] of Array.from(timers)) {\nif (record.nativeId !== undefined || record.due > now) continue;\nif (record.kind === 'interval') {\nrecord.due = now + Math.max(record.delay, 4);\nsafeCall(record.fn, record.args);\n} else {\ntimers.delete(id);\nsafeCall(record.fn, record.kind === 'idle' ? [idleDeadline()] : record.args);\n}\n}\n}\nfunction migrateTimers(hidden) {\nif (!timersPatched) return;\nconst toTicker = hidden && config.active && config.keepAlive;\nlet moved = false;\nfor (const [id, record] of timers) {\nif (toTicker && record.nativeId !== undefined) {\nclearNative(record);\nmoved = true;\n} else if (!toTicker && record.nativeId === undefined) {\nscheduleNative(id, record);\n}\n}\nif (moved) startTicker();\n}\nfunction patchTimers() {\nif (timersPatched || !setTimeoutReal) return;\ntry {\nwin.setTimeout = setTimeoutShim;\nwin.setInterval = setIntervalShim;\nwin.clearTimeout = clearTimerShim;\nwin.clearInterval = clearTimerShim;\nif (ricReal) {\nwin.requestIdleCallback = requestIdleCallbackShim;\nwin.cancelIdleCallback = cancelIdleCallbackShim;\n}\ntimersPatched = true;\n} catch (_) {  }\n}\nfunction unpatchTimers() {\nif (!timersPatched) return;\ntry {\nwin.setTimeout = setTimeoutReal;\nwin.setInterval = setIntervalReal;\nwin.clearTimeout = clearTimeoutReal;\nwin.clearInterval = clearIntervalReal;\nif (ricReal) {\nwin.requestIdleCallback = ricReal;\nwin.cancelIdleCallback = cicReal;\n}\n} catch (_) {  }\ntimersPatched = false;\nfor (const [id, record] of timers) {\nif (record.nativeId === undefined) scheduleNative(id, record);\n}\ntimers.clear();\n}\nconst ACTIVITY_PERIOD_MS = 30000;\nlet activityHandle = null;\nlet lastPointer = { x: 0, y: 0 };\nfunction rememberPointer(event) {\nif (!event.isTrusted) return;\nlastPointer = { x: event.clientX || 0, y: event.clientY || 0 };\n}\nfunction nudge() {\nif (!config.active || !config.fakeActivity || !trulyHidden()) return;\nconst x = lastPointer.x + (lastPointer.x > 0 ? -1 : 1);\nconst y = lastPointer.y;\nlastPointer = { x, y };\nfor (const type of ['mousemove', 'pointermove']) {\nlet event;\ntry {\nconst Ctor = type === 'pointermove' && typeof win.PointerEvent === 'function'\n? win.PointerEvent : win.MouseEvent;\nevent = new Ctor(type, {\nbubbles: true, cancelable: false, view: win, clientX: x, clientY: y\n});\n} catch (_) {\ncontinue;\n}\ntry { doc.dispatchEvent(event); } catch (_) {  }\n}\n}\nfunction startActivity() {\nif (activityHandle !== null) return;\nactivityHandle = setIntervalReal(nudge, ACTIVITY_PERIOD_MS);\nnudge();\n}\nfunction stopActivity() {\nif (activityHandle === null) return;\nclearIntervalReal(activityHandle);\nactivityHandle = null;\n}\nconst RESUME_LIMIT = 3;\nconst RESUME_WINDOW_MS = 15000;\nconst DEDUPE_MS = 60;\nconst resumeAttempts = new WeakMap();\nconst lastHandled = new WeakMap();\nfunction handlePause(media) {\nif (!config.active || !config.forceResume) return;\nif (!(media instanceof HTMLMediaElement)) return;\nif (!trulyHidden()) return;\nif (media.ended || media.seeking) return;\nif (!media.currentSrc && !media.src) return;\nif (media.readyState === 0) return;\nconst stamp = Date.now();\nif (stamp - (lastHandled.get(media) || 0) < DEDUPE_MS) return;\nlastHandled.set(media, stamp);\nconst record = resumeAttempts.get(media) || { count: 0, at: 0 };\nif (stamp - record.at > RESUME_WINDOW_MS) record.count = 0;\nif (record.count >= RESUME_LIMIT) return;\nrecord.count += 1;\nrecord.at = stamp;\nresumeAttempts.set(media, record);\nsetTimeoutReal(() => {\nif (!config.active || !config.forceResume) return;\nif (!trulyHidden() || !media.paused || media.ended) return;\nconst attempt = media.play();\nif (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});\n}, 0);\n}\nfunction onMediaPause(event) { handlePause(event.target); }\nconst nativePause = HTMLMediaElement.prototype.pause;\nlet pausePatched = false;\nfunction addResumeWatcher() {\nlisten(doc, 'pause', onMediaPause);\ntry {\nHTMLMediaElement.prototype.pause = function pause() {\nconst result = nativePause.apply(this, arguments);\ntry { handlePause(this); } catch (_) {  }\nreturn result;\n};\npausePatched = true;\n} catch (_) {  }\n}\nfunction removeResumeWatcher() {\nunlisten(doc, 'pause', onMediaPause);\nif (!pausePatched) return;\ntry { HTMLMediaElement.prototype.pause = nativePause; } catch (_) {  }\npausePatched = false;\n}\nfunction install() {\nif (installed) return;\ninstalled = true;\ndefineFakes();\naddBlockers();\npatchRaf();\npatchTimers();\naddResumeWatcher();\nlisten(doc, 'mousemove', rememberPointer, { capture: true, passive: true });\nif (config.fakeActivity && trulyHidden()) startActivity();\n}\nfunction uninstall() {\nif (!installed) return;\ninstalled = false;\nunlisten(doc, 'mousemove', rememberPointer, { capture: true, passive: true });\nstopActivity();\nremoveResumeWatcher();\nunpatchTimers();\nunpatchRaf();\nremoveBlockers();\nremoveFakes();\nstopTicker();\n}\nfunction apply(next) {\nif (next && typeof next === 'object') {\nfor (const key of ['active', 'presence', 'keepAlive', 'fakeActivity', 'forceResume']) {\nif (typeof next[key] === 'boolean') config[key] = next[key];\n}\nif (typeof next.blockEvents === 'boolean' && typeof next.presence !== 'boolean') {\nconfig.presence = next.blockEvents;\n}\nif (typeof next.rafKeepAlive === 'boolean' && typeof next.keepAlive !== 'boolean') {\nconfig.keepAlive = next.rafKeepAlive;\n}\n}\nif (config.active) install(); else uninstall();\nif (!installed) return;\nif (!config.keepAlive) {\nmigrateTimers(false);\nflushFramesToNative();\nstopTicker();\n} else if (trulyHidden()) {\nmigrateTimers(true);\n}\nif (config.fakeActivity && trulyHidden()) startActivity(); else stopActivity();\n}\nlisten(doc, 'antitab:config', (event) => {\ntry {\napply(JSON.parse(event.detail));\n} catch (_) {  }\n});\nfunction hello() {\ndoc.dispatchEvent(new CustomEvent('antitab:hello'));\n}\nObject.defineProperty(win, NS, {\nconfigurable: true,\nenumerable: false,\nvalue: Object.freeze({\nversion: VERSION,\nhello,\napply,\nstate: () => ({\nversion: VERSION,\ninstalled,\nconfig: { ...config },\ntrulyHidden: trulyHidden(),\nticking: !!ticker,\nqueuedFrames: pendingFrames.size,\nqueuedTimers: timers.size,\nfaking: activityHandle !== null\n})\n})\n});\ninstall();\nhello();\n})();";
(() => {
'use strict';
const NS = '__antitab';
const VERSION = '1.2.0';
const win = window;
const doc = document;
if (win[NS]) {
win[NS].hello();
return;
}
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
function trulyHidden() {
try {
return realHiddenGetter ? realHiddenGetter.call(doc) === true : false;
} catch (_) {
return false;
}
}
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
const config = {
active: true,
presence: true,
keepAlive: true,
fakeActivity: true,
forceResume: true
};
let installed = false;
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
if (!prop.always && !(prop.name in doc)) continue;
if (Object.prototype.hasOwnProperty.call(doc, prop.name)) continue;
try {
Object.defineProperty(doc, prop.name, {
configurable: true,
enumerable: true,
get: () => prop.value
});
definedProperties.push(prop.name);
} catch (_) {  }
}
try {
Object.defineProperty(doc, 'hasFocus', {
configurable: true,
writable: true,
enumerable: false,
value: function hasFocus() { return true; }
});
hasFocusPatched = true;
} catch (_) {  }
if ('userActivation' in navigator) {
try {
Object.defineProperty(navigator, 'userActivation', {
configurable: true,
enumerable: true,
get: () => ({ isActive: true, hasBeenActive: true })
});
userActivationPatched = true;
} catch (_) {  }
}
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
} catch (_) {  }
}
}
}
function removeFakes() {
while (definedProperties.length) {
const name = definedProperties.pop();
try { delete doc[name]; } catch (_) {  }
}
if (hasFocusPatched) {
try { delete doc.hasFocus; } catch (_) {  }
hasFocusPatched = false;
}
if (userActivationPatched) {
try { delete navigator.userActivation; } catch (_) {  }
userActivationPatched = false;
}
while (idleDetectorPatches.length) {
const [name, descriptor] = idleDetectorPatches.pop();
try { Object.defineProperty(win.IdleDetector.prototype, name, descriptor); } catch (_) {  }
}
}
const DOCUMENT_EVENTS = [
'visibilitychange',
'webkitvisibilitychange',
'mozvisibilitychange',
'msvisibilitychange',
'freeze'
];
const WINDOW_EVENTS = ['blur'];
const installedLate = doc.readyState !== 'loading';
let restoringFocus = false;
function onSuppressedEvent(event) {
if (event.type === 'visibilitychange') onRealVisibilityChange();
if (!config.active || !config.presence) return;
if (event.type === 'blur' && event.target !== win) return;
if (event.type === 'blur' && installedLate && !restoringFocus) {
restoringFocus = true;
setTimeoutReal(() => {
restoringFocus = false;
try {
win.dispatchEvent(new FocusEvent('focus'));
} catch (_) {
try { win.dispatchEvent(new Event('focus')); } catch (__) {  }
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
let ticker = null;
const TICKER_SOURCE =
'var t=null;' +
'onmessage=function(e){' +
'if(e.data==="start"){if(t)return;t=setInterval(function(){postMessage(0)},16)}' +
'else{clearInterval(t);t=null}' +
'};';
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
workerRefused = true;
if (ticker && ticker.viaWorker) {
stopTicker();
startTicker();
}
};
worker.postMessage('start');
ticker = {
viaWorker: true,
stop() { try { worker.terminate(); } catch (_) {  } }
};
return;
} catch (_) {
workerRefused = true;
}
}
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
const FRAME_ID_BASE = 1e8;
let nextFrameId = FRAME_ID_BASE;
const pendingFrames = new Map();
const frameNativeIds = new Map();
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
} catch (_) {  }
}
function unpatchRaf() {
if (!rafPatched) return;
try {
win.requestAnimationFrame = rafReal;
win.cancelAnimationFrame = cafReal;
} catch (_) {  }
rafPatched = false;
flushFramesToNative();
}
const TIMER_ID_BASE = 2e8;
let nextTimerId = TIMER_ID_BASE;
const timers = new Map();
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
if (typeof handler !== 'function') return setTimeoutReal(handler, delay, ...args);
return makeTimer('timeout', handler, delay, args);
}
function setIntervalShim(handler, delay, ...args) {
if (typeof handler !== 'function') return setIntervalReal(handler, delay, ...args);
return makeTimer('interval', handler, delay, args);
}
function requestIdleCallbackShim(handler, options) {
if (typeof handler !== 'function') return ricReal ? ricReal(handler, options) : 0;
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
} catch (_) {  }
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
} catch (_) {  }
timersPatched = false;
for (const [id, record] of timers) {
if (record.nativeId === undefined) scheduleNative(id, record);
}
timers.clear();
}
const ACTIVITY_PERIOD_MS = 30000;
let activityHandle = null;
let lastPointer = { x: 0, y: 0 };
function rememberPointer(event) {
if (!event.isTrusted) return;
lastPointer = { x: event.clientX || 0, y: event.clientY || 0 };
}
function nudge() {
if (!config.active || !config.fakeActivity || !trulyHidden()) return;
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
try { doc.dispatchEvent(event); } catch (_) {  }
}
}
function startActivity() {
if (activityHandle !== null) return;
activityHandle = setIntervalReal(nudge, ACTIVITY_PERIOD_MS);
nudge();
}
function stopActivity() {
if (activityHandle === null) return;
clearIntervalReal(activityHandle);
activityHandle = null;
}
const RESUME_LIMIT = 3;
const RESUME_WINDOW_MS = 15000;
const DEDUPE_MS = 60;
const resumeAttempts = new WeakMap();
const lastHandled = new WeakMap();
function handlePause(media) {
if (!config.active || !config.forceResume) return;
if (!(media instanceof HTMLMediaElement)) return;
if (!trulyHidden()) return;
if (media.ended || media.seeking) return;
if (!media.currentSrc && !media.src) return;
if (media.readyState === 0) return;
const stamp = Date.now();
if (stamp - (lastHandled.get(media) || 0) < DEDUPE_MS) return;
lastHandled.set(media, stamp);
const record = resumeAttempts.get(media) || { count: 0, at: 0 };
if (stamp - record.at > RESUME_WINDOW_MS) record.count = 0;
if (record.count >= RESUME_LIMIT) return;
record.count += 1;
record.at = stamp;
resumeAttempts.set(media, record);
setTimeoutReal(() => {
if (!config.active || !config.forceResume) return;
if (!trulyHidden() || !media.paused || media.ended) return;
const attempt = media.play();
if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
}, 0);
}
function onMediaPause(event) { handlePause(event.target); }
const nativePause = HTMLMediaElement.prototype.pause;
let pausePatched = false;
function addResumeWatcher() {
listen(doc, 'pause', onMediaPause);
try {
HTMLMediaElement.prototype.pause = function pause() {
const result = nativePause.apply(this, arguments);
try { handlePause(this); } catch (_) {  }
return result;
};
pausePatched = true;
} catch (_) {  }
}
function removeResumeWatcher() {
unlisten(doc, 'pause', onMediaPause);
if (!pausePatched) return;
try { HTMLMediaElement.prototype.pause = nativePause; } catch (_) {  }
pausePatched = false;
}
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
listen(doc, 'antitab:config', (event) => {
try {
apply(JSON.parse(event.detail));
} catch (_) {  }
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
hello();
})();
(() => {
'use strict';
const api = window.__antitab;
const wasInstalled = typeof __antitabWasInstalled !== 'undefined' && __antitabWasInstalled;
if (!api) {
notify(false, 'Antitab could not start on this page');
return;
}
const on = wasInstalled ? !api.state().config.active : true;
api.apply({ active: on, presence: true, keepAlive: true, fakeActivity: true, forceResume: true });
const frames = reachFrames(on);
watchForFrames(on);
notify(on, on
? 'Antitab is on. This tab looks open and in use'
: 'Antitab is off. This tab looks idle again',
on ? frames.blocked : 0);
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
void view.location.href;
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
blocked++;
}
}
return { reached, blocked };
}
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
setTimeout(() => { queued = false; reachFrames(true); }, 250);
});
try {
observer.observe(document.documentElement, { childList: true, subtree: true });
Object.defineProperty(window, KEY, { configurable: true, value: observer });
} catch (_) {  }
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
try {
Object.defineProperty(window, '__antitabNotice', {
configurable: true,
value: { active: active, message: pill.textContent, unreachable: unreachable || 0 }
});
} catch (_) {  }
shadow.appendChild(pill);
(document.body || document.documentElement).appendChild(host);
setTimeout(() => host.remove(), unreachable ? 8000 : 3200);
}
})();
})();
