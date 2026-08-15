/* Antitab — popup. */
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  const el = {
    master: $('#master'),
    body: $('#body'),
    sitePanel: $('#site-panel'),
    blockedPanel: $('#blocked-panel'),
    blockedTitle: $('#blocked-title'),
    blockedBody: $('#blocked-body'),
    host: $('#host'),
    siteToggle: $('#site-toggle'),
    primaryHint: $('#primary-hint'),
    statusDot: $('#status-dot'),
    statusText: $('#status-text'),
    embeds: $('#embeds'),
    embedsNote: $('#embeds-note'),
    embedsList: $('#embeds-list'),
    options: $('#options'),
    count: $('#count'),
    manage: $('#manage'),
    toast: $('#toast')
  };

  const state = {
    tab: null,
    hostname: null,
    siteKey: null,     // what we would enable
    activeKey: null,   // what is enabled and covers this host
    config: null,
    busy: false
  };

  // ------------------------------------------------------------------- utils

  let toastTimer = null;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
  }

  function describeUnsupported(url) {
    if (!url) {
      return ['Nothing to do here', 'Antitab needs a normal web page to work on.'];
    }
    if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:')) {
      return ['Browser page', 'Antitab cannot run on Chrome’s own pages. Open a site with a video and try again.'];
    }
    if (url.startsWith('chrome-extension://')) {
      return ['Extension page', 'Antitab only runs on ordinary websites.'];
    }
    if (url.includes('chromewebstore.google.com') || url.includes('chrome.google.com/webstore')) {
      return ['Web Store', 'Chrome blocks every extension on the Web Store, including this one.'];
    }
    if (url.startsWith('file://')) {
      return ['Local file', 'Antitab works on http and https pages only.'];
    }
    return ['Nothing to do here', 'Antitab works on http and https pages only.'];
  }

  // ------------------------------------------------------------------ render

  function render() {
    const config = state.config;
    const master = config.enabled;
    const siteOn = !!state.activeKey;

    el.master.setAttribute('aria-checked', String(master));
    el.master.setAttribute('aria-label', master ? 'Antitab turned on' : 'Antitab turned off');

    const supported = !!state.siteKey;
    el.sitePanel.hidden = !supported;
    el.blockedPanel.hidden = supported;

    if (!supported) {
      const [title, body] = describeUnsupported(state.tab && state.tab.url);
      el.blockedTitle.textContent = title;
      el.blockedBody.textContent = body;
    } else {
      const label = state.activeKey || state.siteKey;
      el.host.textContent = label;
      el.host.title = state.hostname || label;

      el.siteToggle.setAttribute('aria-checked', String(siteOn));
      el.siteToggle.querySelector('.switch').setAttribute('aria-checked', String(siteOn));

      if (!siteOn) {
        el.primaryHint.textContent = 'Off. This site can still pause itself.';
      } else if (!master) {
        el.primaryHint.textContent = 'On for this site, but Antitab is switched off.';
      } else if (state.activeKey !== state.hostname && state.activeKey !== state.siteKey) {
        el.primaryHint.textContent = `Covered by your ${state.activeKey} rule.`;
      } else {
        el.primaryHint.textContent = 'On, including every page under this domain.';
      }

      const live = siteOn && master;
      el.statusDot.classList.toggle('dot--on', live);
      el.statusText.textContent = live
        ? 'This tab looks open, focused and in use, even when it is not.'
        : siteOn
          ? 'Paused by the switch up top.'
          : 'Switch on, then leave the tab. No reload needed.';
    }

    const optionsLive = master && siteOn;
    for (const button of el.options.querySelectorAll('.opt')) {
      const key = button.dataset.option;
      const on = !!config.options[key];
      button.setAttribute('aria-checked', String(on));
      button.querySelector('.switch').setAttribute('aria-checked', String(on));
      button.querySelector('.switch').setAttribute('aria-disabled', String(!optionsLive));
      if (optionsLive) button.removeAttribute('aria-disabled');
      else button.setAttribute('aria-disabled', 'true');
    }

    const total = Object.keys(config.sites).length;
    el.count.textContent = total === 0
      ? 'no sites yet'
      : total === 1 ? '1 site on' : `${total} sites on`;
  }

  // ----------------------------------------------------------------- actions

  async function reload() {
    state.config = await AntitabConfig.load();
    state.activeKey = state.hostname
      ? AntitabSite.matchEnabled(state.hostname, state.config.sites)
      : null;
    render();
  }

  async function setSiteEnabled(on, explicitSite) {
    const target = explicitSite || state.siteKey;
    if (state.busy || !target) return;
    state.busy = true;
    try {
      if (!on) {
        const key = state.activeKey;
        if (key) {
          await chrome.runtime.sendMessage({
            type: 'disable-site', site: key, tabId: state.tab && state.tab.id
          });
        }
        await reload();
        return;
      }

      const origins = AntitabSite.patterns(target);
      const alreadyGranted = await chrome.permissions.contains({ origins }).catch(() => false);

      if (!alreadyGranted) {
        // On some platforms the permission prompt closes the popup before this
        // promise settles. Park the intent so the worker can finish the job.
        await AntitabConfig.setPending(target);
        const granted = await chrome.permissions.request({ origins }).catch(() => false);
        if (!granted) {
          await AntitabConfig.takePending();
          toast('Antitab needs access to this site to work on it.');
          await reload();
          return;
        }
        await AntitabConfig.takePending();
      }

      await chrome.runtime.sendMessage({
        type: 'enable-site', site: target, tabId: state.tab && state.tab.id
      });
      await reload();
      await refreshEmbeds();
      if (!state.config.enabled) toast('Turned on for this site. Switch Antitab on to use it.');
    } finally {
      state.busy = false;
    }
  }

  /**
   * A page can run the part you care about inside a frame from another domain,
   * and a site is only ever switched on one domain at a time. CodePen is the
   * clearest case: the address bar says codepen.io, the pen runs on cdpn.io.
   * Offer those rather than leaving it looking broken.
   */
  async function refreshEmbeds() {
    el.embeds.hidden = true;
    if (!state.activeKey || !state.tab) return;

    const reply = await chrome.runtime
      .sendMessage({ type: 'frames', tabId: state.tab.id })
      .catch(() => null);
    const hosts = (reply && reply.hosts) || [];
    const exact = !!(reply && reply.exact);

    const suggestions = [];
    for (const host of hosts) {
      const key = AntitabSite.fromHostname(host);
      if (!key) continue;
      if (AntitabSite.matchEnabled(host, state.config.sites)) continue;
      if (!suggestions.includes(key)) suggestions.push(key);
    }
    if (!suggestions.length) {
      // Nothing found. A frame that redirects to another domain, which is how
      // CodePen serves a pen, is invisible from the page itself, so offer the
      // one permission that can see it rather than claiming there is nothing.
      if (!exact) offerFrameLookup();
      return;
    }

    el.embedsNote.textContent = suggestions.length === 1
      ? 'Part of this page comes from another domain, and needs its own switch:'
      : 'Parts of this page come from other domains, each needing its own switch:';

    el.embedsList.replaceChildren();
    for (const site of suggestions) {
      const button = document.createElement('button');
      button.className = 'embed';
      button.type = 'button';

      const host = document.createElement('span');
      host.className = 'embed__host';
      host.textContent = site;

      const action = document.createElement('span');
      action.className = 'embed__action';
      action.textContent = 'Turn on';

      button.append(host, action);
      button.setAttribute('aria-label', `Turn Antitab on for ${site} as well`);
      button.addEventListener('click', () => setSiteEnabled(true, site));
      el.embedsList.append(button);
    }
    el.embeds.hidden = false;
  }

  function offerFrameLookup() {
    el.embedsNote.textContent = 'Not working? Part of this page may come from another domain, which needs its own switch.';
    el.embedsList.replaceChildren();

    const button = document.createElement('button');
    button.className = 'embed';
    button.type = 'button';

    const label = document.createElement('span');
    label.className = 'embed__host';
    label.textContent = 'Look for other domains';

    const action = document.createElement('span');
    action.className = 'embed__action';
    action.textContent = 'Check';

    button.append(label, action);
    button.addEventListener('click', async () => {
      const granted = await chrome.permissions
        .request({ permissions: ['webNavigation'] }).catch(() => false);
      if (!granted) {
        toast('Antitab cannot list a page\u2019s frames without that.');
        return;
      }
      await refreshEmbeds();
      if (el.embeds.hidden || !el.embedsList.querySelector('[aria-label]')) {
        toast('Everything on this page is already covered.');
      }
    });

    el.embedsList.append(button);
    el.embeds.hidden = false;
  }

  async function setOption(key, value) {
    state.config = await AntitabConfig.save({ options: { [key]: value } });
    render();
  }

  async function setMaster(value) {
    state.config = await AntitabConfig.save({ enabled: value });
    render();
  }

  // -------------------------------------------------------------------- init

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    state.tab = tab || null;
    state.siteKey = tab ? AntitabSite.fromUrl(tab.url) : null;
    try {
      state.hostname = tab && tab.url ? new URL(tab.url).hostname : null;
    } catch (_) {
      state.hostname = null;
    }

    // A shortcut press on a site we lack access to hands over to the popup.
    const pending = state.siteKey ? await AntitabConfig.takePending() : null;

    await reload();

    el.master.addEventListener('click', () => setMaster(!state.config.enabled));
    el.siteToggle.addEventListener('click', () => setSiteEnabled(!state.activeKey));
    el.manage.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });

    for (const button of el.options.querySelectorAll('.opt')) {
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true') {
          toast('Turn Antitab on for this site first.');
          return;
        }
        const key = button.dataset.option;
        setOption(key, !state.config.options[key]);
      });
    }

    refreshEmbeds();

    if (pending && pending === state.siteKey && !state.activeKey) setSiteEnabled(true);
  }

  init();
})();
