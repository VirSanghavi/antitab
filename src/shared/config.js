/**
 * Stored settings, shared by every context. Classic script, see site.js.
 *
 * Shape:
 *   {
 *     enabled: boolean,                  // master switch
 *     sites:   { "youtube.com": { addedAt: 1699999999999 } },
 *     options: { blockEvents, rafKeepAlive, forceResume }
 *   }
 *
 * chrome.storage.local (not .sync) on purpose: the site list is only meaningful
 * alongside host permissions, and permissions do not sync between profiles.
 */
(function (global) {
  'use strict';

  const KEY = 'antitab';
  const PENDING_KEY = 'antitab_pending_site';

  const DEFAULTS = Object.freeze({
    enabled: true,
    sites: {},
    options: Object.freeze({
      blockEvents: true,
      rafKeepAlive: true,
      forceResume: true
    })
  });

  function normalize(stored) {
    const raw = stored && typeof stored === 'object' ? stored : {};
    const sites = {};
    if (raw.sites && typeof raw.sites === 'object') {
      for (const [site, meta] of Object.entries(raw.sites)) {
        if (!site) continue;
        sites[site] = meta && typeof meta === 'object' ? meta : { addedAt: 0 };
      }
    }
    return {
      enabled: raw.enabled !== false,
      sites,
      options: {
        blockEvents: raw.options ? raw.options.blockEvents !== false : true,
        rafKeepAlive: raw.options ? raw.options.rafKeepAlive !== false : true,
        forceResume: raw.options ? raw.options.forceResume !== false : true
      }
    };
  }

  async function load() {
    const stored = await chrome.storage.local.get(KEY);
    return normalize(stored[KEY]);
  }

  async function save(patch) {
    const current = await load();
    const next = normalize({
      ...current,
      ...patch,
      options: { ...current.options, ...(patch && patch.options) }
    });
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  }

  function onChange(listener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[KEY]) return;
      listener(normalize(changes[KEY].newValue));
    });
  }

  /**
   * A permission prompt can tear down the popup before its promise settles, so
   * the site being enabled is parked in session storage and the service worker
   * finishes the job from chrome.permissions.onAdded.
   */
  async function setPending(site) {
    await chrome.storage.session.set({ [PENDING_KEY]: { site, at: Date.now() } });
  }

  async function takePending() {
    const stored = await chrome.storage.session.get(PENDING_KEY);
    const pending = stored[PENDING_KEY];
    if (!pending) return null;
    await chrome.storage.session.remove(PENDING_KEY);
    if (Date.now() - pending.at > 120000) return null;
    return pending.site;
  }

  global.AntitabConfig = { KEY, DEFAULTS, normalize, load, save, onChange, setPending, takePending };
})(typeof globalThis !== 'undefined' ? globalThis : self);
