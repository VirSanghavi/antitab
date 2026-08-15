/**
 * Antitab — isolated-world bridge.
 *
 * The main-world payload cannot touch chrome.storage; this can. It resolves
 * whether Antitab applies to this frame and pushes the settings across the
 * world boundary as a JSON string, then keeps them live as the user flips
 * switches in the popup.
 *
 * Loaded after src/shared/site.js and src/shared/config.js, which share this
 * script's isolated-world globals.
 */
(() => {
  'use strict';

  const send = (payload) => {
    document.dispatchEvent(new CustomEvent('antitab:config', {
      detail: JSON.stringify(payload)
    }));
  };

  function resolve(config) {
    // The frame was injected because its URL matched an enabled site, but the
    // exact host can be a subdomain ("m.youtube.com" under "youtube.com"), so
    // match by coverage rather than by an exact key lookup.
    const site = AntitabSite.matchEnabled(location.hostname, config.sites);
    return {
      active: config.enabled && !!site,
      presence: config.options.presence,
      keepAlive: config.options.keepAlive,
      fakeActivity: config.options.fakeActivity,
      forceResume: config.options.forceResume
    };
  }

  let latest = null;

  async function push() {
    try {
      const config = await AntitabConfig.load();
      latest = resolve(config);
      send(latest);
    } catch (_) {
      // Extension reloaded out from under this page; the payload keeps running
      // with the settings it already has until the next navigation.
    }
  }

  // Either order of world start-up is possible, so both sides open the
  // conversation: we push immediately, and answer the payload's hello.
  document.addEventListener('antitab:hello', () => {
    if (latest) send(latest); else push();
  }, true);

  AntitabConfig.onChange((config) => {
    latest = resolve(config);
    send(latest);
  });

  /**
   * Which other domains this page embeds. A site can only be switched on per
   * domain, and plenty of pages run the interesting code inside a frame served
   * from somewhere else: CodePen renders a pen from cdpn.io, and embedded
   * players come from their own host. Switching on the address bar's domain
   * does nothing for those, which looks exactly like Antitab not working.
   *
   * Reading the `src` attribute of a frame is plain DOM and needs no extra
   * permission, so the popup can offer them without Antitab ever being able to
   * see inside a frame it was not given access to.
   */
  function embeddedHosts() {
    const hosts = new Set();
    for (const frame of document.querySelectorAll('iframe, frame')) {
      const src = frame.getAttribute('src');
      if (!src) continue;
      try {
        const url = new URL(src, location.href);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
        if (url.hostname === location.hostname) continue;
        hosts.add(url.hostname);
      } catch (_) { /* a relative or malformed src: nothing to offer */ }
    }
    return Array.from(hosts).slice(0, 8);
  }

  if (window === window.top) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== 'antitab-frames') return undefined;
      sendResponse({ hosts: embeddedHosts() });
      return undefined;
    });
  }

  push();
})();
