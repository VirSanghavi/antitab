/**
 * A fake `chrome.*` just rich enough to render the popup and the options page
 * outside the browser, so their pixels can be reviewed and screenshotted.
 *
 * Development only — dev/preview/build.mjs writes the preview pages that load
 * this, and those pages are gitignored. Nothing here ships in the extension.
 */
(() => {
  const params = new URLSearchParams(location.search);

  if (params.get('theme')) {
    document.documentElement.dataset.theme = params.get('theme');
  }

  const DAY = 86400000;
  const SEEDS = {
    full: {
      enabled: true,
      sites: {
        'youtube.com': { addedAt: Date.now() - 9 * DAY },
        'twitch.tv': { addedAt: Date.now() - DAY },
        'coursera.org': { addedAt: Date.now() - 47 * DAY }
      },
      options: { blockEvents: true, rafKeepAlive: true, forceResume: false }
    },
    empty: { enabled: true, sites: {}, options: { blockEvents: true, rafKeepAlive: true, forceResume: true } },
    off: {
      enabled: false,
      sites: { 'youtube.com': { addedAt: Date.now() - 3 * DAY } },
      options: { blockEvents: true, rafKeepAlive: true, forceResume: true }
    }
  };

  const URLS = {
    site: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    sub: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    blocked: 'chrome://settings/appearance'
  };

  const store = { antitab: SEEDS[params.get('seed') || 'full'] };
  const session = {};
  const listeners = [];

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const area = (bucket) => ({
    async get(key) {
      if (key === undefined || key === null) return clone(bucket);
      const keys = Array.isArray(key) ? key : [key];
      const out = {};
      for (const k of keys) if (k in bucket) out[k] = clone(bucket[k]);
      return out;
    },
    async set(values) {
      const changes = {};
      for (const [k, v] of Object.entries(values)) {
        changes[k] = { oldValue: bucket[k], newValue: v };
        bucket[k] = clone(v);
      }
      for (const listener of listeners) listener(changes, bucket === store ? 'local' : 'session');
    },
    async remove(key) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) delete bucket[k];
    }
  });

  window.chrome = {
    storage: {
      local: area(store),
      session: area(session),
      onChanged: { addListener: (fn) => listeners.push(fn) }
    },
    tabs: {
      async query() {
        return [{ id: 1, url: URLS[params.get('page') || 'site'] }];
      },
      async get() { return { id: 1, url: URLS[params.get('page') || 'site'] }; },
      create(options) { console.log('[stub] tabs.create', options); }
    },
    permissions: {
      async contains() { return true; },
      async request() { return true; },
      async remove() { return true; },
      onAdded: { addListener() {} },
      onRemoved: { addListener() {} }
    },
    runtime: {
      async sendMessage(message) { console.log('[stub] sendMessage', message); return { ok: true }; },
      getManifest: () => ({ version: '1.0.0' }),
      openOptionsPage() { console.log('[stub] openOptionsPage'); },
      getURL: (path) => path
    },
    commands: {
      async getAll() { return [{ name: 'toggle-site', shortcut: 'Alt+Shift+K' }]; }
    },
    action: {
      setBadgeText() {}, setBadgeBackgroundColor() {}, setBadgeTextColor() {}, setTitle() {}
    },
    scripting: {
      async executeScript() { return []; },
      async getRegisteredContentScripts() { return []; },
      async registerContentScripts() {},
      async updateContentScripts() {},
      async unregisterContentScripts() {}
    }
  };
})();
