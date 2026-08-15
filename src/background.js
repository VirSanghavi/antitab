/**
 * Antitab — service worker.
 *
 * Owns three jobs:
 *   1. keeping the dynamic content-script registrations in step with the
 *      enabled-site list (so an enabled site is patched at document_start on
 *      every future load),
 *   2. finishing an enable that started in the popup, in case the permission
 *      prompt tore the popup down before its promise settled,
 *   3. the toolbar badge and the keyboard shortcut.
 */
importScripts('shared/site.js', 'shared/config.js');

const MAIN_SCRIPT_ID = 'antitab-main';
const BRIDGE_SCRIPT_ID = 'antitab-bridge';
const MAIN_FILES = ['src/main/antitab.js'];
const BRIDGE_FILES = ['src/shared/site.js', 'src/shared/config.js', 'src/content/bridge.js'];

const BADGE_ON = '#16794C';
const BADGE_OFF = '#6B7280';

// ------------------------------------------------------------- registrations

async function grantedSiteOrigins(config) {
  const origins = [];
  for (const site of Object.keys(config.sites)) {
    const sitePatterns = AntitabSite.patterns(site);
    if (!sitePatterns.length) continue;
    // Registering a match we lack permission for rejects the whole call, so a
    // site whose access was revoked in chrome://extensions is skipped here.
    const permitted = await chrome.permissions.contains({ origins: sitePatterns })
      .catch(() => false);
    if (permitted) origins.push(...sitePatterns);
  }
  return origins;
}

async function syncRegistrations() {
  const config = await AntitabConfig.load();
  const matches = await grantedSiteOrigins(config);

  const existing = await chrome.scripting.getRegisteredContentScripts()
    .catch(() => []);
  const existingIds = existing
    .map((script) => script.id)
    .filter((id) => id === MAIN_SCRIPT_ID || id === BRIDGE_SCRIPT_ID);

  if (!matches.length) {
    if (existingIds.length) {
      await chrome.scripting.unregisterContentScripts({ ids: existingIds }).catch(() => {});
    }
    return;
  }

  const scripts = [
    {
      id: MAIN_SCRIPT_ID,
      js: MAIN_FILES,
      matches,
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true
    },
    {
      id: BRIDGE_SCRIPT_ID,
      js: BRIDGE_FILES,
      matches,
      world: 'ISOLATED',
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true
    }
  ];

  try {
    if (existingIds.length) {
      await chrome.scripting.updateContentScripts(
        scripts.filter((script) => existingIds.includes(script.id))
      );
      const missing = scripts.filter((script) => !existingIds.includes(script.id));
      if (missing.length) await chrome.scripting.registerContentScripts(missing);
    } else {
      await chrome.scripting.registerContentScripts(scripts);
    }
  } catch (error) {
    // Fall back to a clean re-register; an update can fail if a previous
    // registration is half-present after a crash or an extension reload.
    await chrome.scripting.unregisterContentScripts({ ids: existingIds }).catch(() => {});
    await chrome.scripting.registerContentScripts(scripts).catch(() => {});
  }
}

// ------------------------------------------------------------- live injection
// Turning a site on should work on the tab you are looking at, without a reload
// that would lose your place in the video.

async function injectNow(tabId) {
  if (typeof tabId !== 'number') return;
  const target = { tabId, allFrames: true };
  try {
    await chrome.scripting.executeScript({ target, files: MAIN_FILES, world: 'MAIN' });
    await chrome.scripting.executeScript({ target, files: BRIDGE_FILES, world: 'ISOLATED' });
  } catch (_) {
    // No access to this tab (or it navigated away mid-flight); the registration
    // covers it on the next load.
  }
}

// ------------------------------------------------------------------- enabling

async function enableSite(site, tabId) {
  if (!site) return;
  const config = await AntitabConfig.load();
  if (!config.sites[site]) {
    const sites = { ...config.sites, [site]: { addedAt: Date.now() } };
    await AntitabConfig.save({ sites });
  }
  await syncRegistrations();
  await injectNow(tabId);
  await refreshBadge(tabId);
}

async function disableSite(site, tabId) {
  if (!site) return;
  const config = await AntitabConfig.load();
  if (!config.sites[site]) return;
  const sites = { ...config.sites };
  delete sites[site];
  await AntitabConfig.save({ sites });
  await syncRegistrations();
  await refreshBadge(tabId);
}

// --------------------------------------------------------------------- badge

async function badgeStateForUrl(url) {
  const hostname = (() => {
    try { return new URL(url).hostname; } catch (_) { return null; }
  })();
  if (!hostname || !AntitabSite.fromUrl(url)) return null;
  const config = await AntitabConfig.load();
  const site = AntitabSite.matchEnabled(hostname, config.sites);
  if (!site) return null;
  return { site, on: config.enabled };
}

async function refreshBadge(tabId, url) {
  if (typeof tabId !== 'number') return;
  let address = url;
  if (!address) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    address = tab.url;
  }
  // Without host permission for this tab, `url` is undefined — which is also
  // exactly the case where Antitab is not running, so a blank badge is correct.
  const state = address ? await badgeStateForUrl(address) : null;
  if (!state) {
    await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    await chrome.action.setTitle({ tabId, title: 'Antitab' }).catch(() => {});
    return;
  }
  await chrome.action.setBadgeText({ tabId, text: state.on ? 'ON' : 'OFF' }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ tabId, color: state.on ? BADGE_ON : BADGE_OFF })
    .catch(() => {});
  await chrome.action.setTitle({
    tabId,
    title: state.on
      ? `Antitab is keeping ${state.site} playing`
      : `Antitab is paused (on for ${state.site})`
  }).catch(() => {});
}

async function refreshAllBadges() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const tab of tabs) await refreshBadge(tab.id, tab.url);
}

// -------------------------------------------------------------------- events

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.action.setBadgeTextColor({ color: '#FFFFFF' }).catch(() => {});
  await syncRegistrations();
  await refreshAllBadges();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html?welcome=1') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.action.setBadgeTextColor({ color: '#FFFFFF' }).catch(() => {});
  await syncRegistrations();
  await refreshAllBadges();
});

// The popup may die to the permission prompt; the grant still lands here.
chrome.permissions.onAdded.addListener(async () => {
  const pending = await AntitabConfig.takePending();
  if (!pending) {
    await syncRegistrations();
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  await enableSite(pending, tab && tab.id);
});

// Access revoked from chrome://extensions: drop those sites so the UI stays honest.
chrome.permissions.onRemoved.addListener(async () => {
  const config = await AntitabConfig.load();
  const sites = { ...config.sites };
  let changed = false;
  for (const site of Object.keys(sites)) {
    const permitted = await chrome.permissions.contains({ origins: AntitabSite.patterns(site) })
      .catch(() => false);
    if (!permitted) {
      delete sites[site];
      changed = true;
    }
  }
  if (changed) await AntitabConfig.save({ sites });
  await syncRegistrations();
  await refreshAllBadges();
});

AntitabConfig.onChange(async () => {
  await syncRegistrations();
  await refreshAllBadges();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.status && !changeInfo.url) return;
  refreshBadge(tabId, tab && tab.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => refreshBadge(tabId));

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-site') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (!tab || !tab.url) return;
  const hostname = (() => {
    try { return new URL(tab.url).hostname; } catch (_) { return null; }
  })();
  const key = AntitabSite.fromUrl(tab.url);
  if (!key) return;

  const config = await AntitabConfig.load();
  const active = AntitabSite.matchEnabled(hostname, config.sites);
  if (active) {
    await disableSite(active, tab.id);
    return;
  }

  const origins = AntitabSite.patterns(key);
  const permitted = await chrome.permissions.contains({ origins }).catch(() => false);
  if (permitted) {
    await enableSite(key, tab.id);
    return;
  }
  // First time on this site we need consent, and a permission prompt cannot be
  // raised from a command handler — hand over to the popup.
  await AntitabConfig.setPending(key);
  if (chrome.action.openPopup) {
    chrome.action.openPopup().catch(() => {});
  }
});

// Popup and options page ask the worker to do the privileged parts.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return undefined;
  (async () => {
    switch (message.type) {
      case 'enable-site':
        await enableSite(message.site, message.tabId);
        return sendResponse({ ok: true });
      case 'disable-site':
        await disableSite(message.site, message.tabId);
        return sendResponse({ ok: true });
      case 'sync':
        await syncRegistrations();
        await refreshAllBadges();
        return sendResponse({ ok: true });
      default:
        return sendResponse({ ok: false });
    }
  })();
  return true; // keep the channel open for the async reply
});
