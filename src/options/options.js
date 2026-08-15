/* Antitab — options page. */
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  const el = {
    welcome: $('#welcome'),
    options: document.querySelectorAll('.opt'),
    sites: $('#sites'),
    sitesSub: $('#sites-sub'),
    sitesEmpty: $('#sites-empty'),
    shortcutHint: $('#shortcut-hint'),
    shortcuts: $('#shortcuts'),
    revoke: $('#revoke'),
    version: $('#version'),
    toast: $('#toast')
  };

  let config = null;

  let toastTimer = null;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3000);
  }

  const DAY = 86400000;
  function since(timestamp) {
    if (!timestamp) return 'added a while ago';
    const days = Math.floor((Date.now() - timestamp) / DAY);
    if (days <= 0) return 'added today';
    if (days === 1) return 'added yesterday';
    if (days < 30) return `added ${days} days ago`;
    const months = Math.round(days / 30);
    return months === 1 ? 'added a month ago' : `added ${months} months ago`;
  }

  function renderOptions() {
    for (const button of el.options) {
      const on = !!config.options[button.dataset.option];
      button.setAttribute('aria-checked', String(on));
      button.querySelector('.switch').setAttribute('aria-checked', String(on));
    }
  }

  function renderSites() {
    const entries = Object.entries(config.sites)
      .sort((a, b) => a[0].localeCompare(b[0]));

    el.sites.replaceChildren();
    el.sites.hidden = entries.length === 0;
    el.sitesEmpty.hidden = entries.length > 0;
    el.sitesSub.textContent = entries.length === 0
      ? 'Antitab only runs where you switch it on.'
      : entries.length === 1
        ? 'Antitab runs on 1 site, and every page under it.'
        : `Antitab runs on ${entries.length} sites, and every page under them.`;

    for (const [site, meta] of entries) {
      const row = document.createElement('div');
      row.className = 'row row--static';

      const text = document.createElement('span');
      text.className = 'row__text';

      const host = document.createElement('span');
      host.className = 'site-row__host';
      host.textContent = site;

      const when = document.createElement('span');
      when.className = 'site-row__meta';
      when.textContent = since(meta && meta.addedAt);

      text.append(host, when);

      const remove = document.createElement('button');
      remove.className = 'button';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${site} and revoke its access`);
      remove.addEventListener('click', () => removeSite(site));

      row.append(text, remove);
      el.sites.append(row);
    }
  }

  function render() {
    renderOptions();
    renderSites();
  }

  async function reload() {
    config = await AntitabConfig.load();
    render();
  }

  async function removeSite(site) {
    const sites = { ...config.sites };
    delete sites[site];
    config = await AntitabConfig.save({ sites });
    // Hand the host access back too — a site that is off has no business
    // leaving a permission behind.
    await chrome.permissions.remove({ origins: AntitabSite.patterns(site) }).catch(() => {});
    await chrome.runtime.sendMessage({ type: 'sync' }).catch(() => {});
    render();
    toast(`Removed ${site} and revoked its access.`);
  }

  async function revokeAll() {
    const sites = Object.keys(config.sites);
    config = await AntitabConfig.save({ sites: {} });
    for (const site of sites) {
      await chrome.permissions.remove({ origins: AntitabSite.patterns(site) }).catch(() => {});
    }
    await chrome.runtime.sendMessage({ type: 'sync' }).catch(() => {});
    render();
    toast(sites.length ? 'All site access revoked.' : 'There was nothing to revoke.');
  }

  function renderShortcut() {
    if (!chrome.commands || !chrome.commands.getAll) return;
    chrome.commands.getAll().then((commands) => {
      const command = commands.find((entry) => entry.name === 'toggle-site');
      if (!el.shortcutHint) return;
      if (command && command.shortcut) {
        el.shortcutHint.replaceChildren();
        for (const key of command.shortcut.split('+')) {
          const kbd = document.createElement('kbd');
          kbd.textContent = key;
          el.shortcutHint.append(kbd);
        }
        el.shortcutHint.append(' Change it in Chrome’s shortcut settings.');
      } else {
        el.shortcutHint.textContent = 'No shortcut assigned yet. Set one in Chrome’s shortcut settings.';
      }
    }).catch(() => {});
  }

  async function init() {
    if (new URLSearchParams(location.search).get('welcome')) el.welcome.hidden = false;
    el.version.textContent = `version ${chrome.runtime.getManifest().version}`;

    await reload();
    renderShortcut();

    for (const button of el.options) {
      button.addEventListener('click', async () => {
        const key = button.dataset.option;
        config = await AntitabConfig.save({ options: { [key]: !config.options[key] } });
        render();
      });
    }

    el.shortcuts.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });

    el.revoke.addEventListener('click', revokeAll);

    // Another surface (the popup, the shortcut) may change things while this
    // page is open.
    AntitabConfig.onChange((next) => { config = next; render(); });
    chrome.permissions.onRemoved.addListener(() => { reload(); });
  }

  init();
})();
