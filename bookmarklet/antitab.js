/* Antitab 1.0.0 — keeps a tab's video playing after you switch away.
   Source: https://github.com/VirSanghavi/antitab — MIT licensed. */
(function(){
var __antitabWasInstalled = !!window.__antitab;
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
function trulyHidden() {
try {
return realHiddenGetter ? realHiddenGetter.call(doc) === true : false;
} catch (_) {
return false;
}
}
const config = {
active: true,
blockEvents: true,
rafKeepAlive: true,
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
}
const DOCUMENT_EVENTS = [
'visibilitychange',
'webkitvisibilitychange',
'mozvisibilitychange',
'msvisibilitychange',
'freeze'
];
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
const ID_BASE = 1e8;
let nextId = ID_BASE;
const pendingCallbacks = new Map();
const realIds = new Map();
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
ticker = { stop() { try { worker.terminate(); } catch (_) {  } } };
} catch (_) {
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
} catch (_) {  }
}
function unpatchRaf() {
if (!rafPatched) return;
try {
win.requestAnimationFrame = rafReal;
win.cancelAnimationFrame = cafReal;
} catch (_) {  }
rafPatched = false;
stopTicker();
const stragglers = Array.from(pendingCallbacks.values());
pendingCallbacks.clear();
if (rafReal) for (const callback of stragglers) rafReal(callback);
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
setTimeout(() => {
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
queuedFrames: pendingCallbacks.size
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
})();
