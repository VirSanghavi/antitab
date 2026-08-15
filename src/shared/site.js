/**
 * Site identity helpers, shared by the service worker, the popup, the options
 * page and the content-script bridge.
 *
 * Loaded as a classic script everywhere (importScripts in the worker, a plain
 * <script> tag on extension pages, the first entry of the content-script `js`
 * array) so there is exactly one copy of this logic.
 */
(function (global) {
  'use strict';

  const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

  /** An IP literal or a bare host cannot take a `*.` wildcard prefix. */
  function canWildcard(hostname) {
    if (!hostname) return false;
    if (IPV4.test(hostname)) return false;
    if (hostname.includes(':')) return false; // IPv6 literal
    return true;
  }

  /**
   * The key we store a site under: the hostname with a leading `www.` removed.
   * Deliberately not an eTLD+1 guess — "docs.example.com" stays its own site so
   * turning Antitab on never silently covers hosts the user did not choose.
   */
  function fromUrl(url) {
    if (!url) return null;
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return fromHostname(parsed.hostname);
  }

  function fromHostname(hostname) {
    if (!hostname) return null;
    const host = hostname.toLowerCase();
    if (host.startsWith('www.') && host.length > 4) return host.slice(4);
    return host;
  }

  /** Match patterns / origins covering a site key and its subdomains. */
  function patterns(site) {
    if (!site) return [];
    const list = ['*://' + site + '/*'];
    if (canWildcard(site)) list.push('*://*.' + site + '/*');
    return list;
  }

  /** True when `hostname` is the site itself or one of its subdomains. */
  function covers(site, hostname) {
    const host = (hostname || '').toLowerCase();
    if (!site || !host) return false;
    if (host === site) return true;
    return canWildcard(site) && host.endsWith('.' + site);
  }

  /**
   * Which enabled site key (if any) applies to this hostname. Lets
   * "m.youtube.com" resolve to the "youtube.com" entry the user turned on.
   */
  function matchEnabled(hostname, sites) {
    if (!sites) return null;
    const keys = Object.keys(sites);
    let best = null;
    for (const key of keys) {
      if (!covers(key, hostname)) continue;
      if (!best || key.length > best.length) best = key;
    }
    return best;
  }

  global.AntitabSite = { fromUrl, fromHostname, patterns, covers, matchEnabled, canWildcard };
})(typeof globalThis !== 'undefined' ? globalThis : self);
