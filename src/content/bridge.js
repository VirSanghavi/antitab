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

  push();
})();
