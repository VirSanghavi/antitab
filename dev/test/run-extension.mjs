/**
 * Loads the real extension into Chromium and points it at a live page.
 *
 *   npm install --no-save playwright
 *   node dev/test/run-extension.mjs [url]
 *
 * Defaults to the CodePen demo of the classic blur/focus tab detector, which is
 * the interesting case: CodePen renders a pen inside an iframe on cdpn.io, a
 * deliberately different domain, so enabling codepen.io alone leaves the pen's
 * own code unprotected.
 *
 * Runs twice on purpose. A silent detector only proves something if the same
 * test can make it speak, and the first scenario is what you actually get by
 * switching Antitab on from the popup while looking at codepen.io.
 *
 * Test harness only: the copy under test has its optional host permissions
 * promoted to granted ones, because a permission prompt cannot be clicked by a
 * script. Everything else is the shipping extension, unmodified.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TARGET = process.argv[2] || 'https://codepen.io/calebnance/pen/nXPaKN';

const SCENARIOS = [
  { name: 'codepen.io only, which is what the popup gives you', sites: ['codepen.io'], expectDetected: true },
  { name: 'codepen.io and cdpn.io', sites: ['codepen.io', 'cdpn.io'], expectDetected: false }
];

const { chromium } = await import('playwright');

const failures = [];
const check = (name, condition, detail) => {
  if (!condition) failures.push(name);
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  (' + detail + ')' : ''}`);
};

// ---------------------------------------------------------------- test build
const build = mkdtempSync(join(tmpdir(), 'antitab-ext-'));
for (const entry of ['manifest.json', 'src', 'icons']) {
  cpSync(join(ROOT, entry), join(build, entry), { recursive: true });
}
const manifest = JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8'));
manifest.host_permissions = manifest.optional_host_permissions;
manifest.permissions = [...manifest.permissions, ...(manifest.optional_permissions || [])];
delete manifest.optional_host_permissions;
delete manifest.optional_permissions;
writeFileSync(join(build, 'manifest.json'), JSON.stringify(manifest, null, 2));

async function runScenario(scenario) {
  console.log(`\n=== ${scenario.name} ===`);
  const profile = mkdtempSync(join(tmpdir(), 'antitab-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`]
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });

    // The worker can be handed over before its globals exist.
    for (let attempt = 0; attempt < 40; attempt++) {
      const ready = await worker
        .evaluate(() => typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local))
        .catch(() => false);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    await worker.evaluate(async (sites) => {
      const entries = {};
      for (const site of sites) entries[site] = { addedAt: Date.now() };
      await chrome.storage.local.set({
        antitab: {
          enabled: true,
          sites: entries,
          options: { presence: true, keepAlive: true, fakeActivity: true, forceResume: true }
        }
      });
    }, scenario.sites);
    await new Promise((r) => setTimeout(r, 1500));

    const registered = await worker.evaluate(() =>
      chrome.scripting.getRegisteredContentScripts().then((s) => s.map((x) => x.id)));
    check('content scripts registered', registered.length === 2, registered.join(', '));

    const page = await context.newPage();
    const logs = [];
    page.on('console', (msg) => logs.push(msg.text()));
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);

    let detectorFrame = null;
    for (const frame of page.frames()) {
      const info = await frame.evaluate(() => ({
        host: location.hostname,
        payload: !!window.__antitab,
        active: window.__antitab && window.__antitab.state().config.active,
        hasDetector: typeof window.visited !== 'undefined'
      })).catch(() => null);
      if (info && info.hasDetector) {
        detectorFrame = frame;
        console.log('  pen frame: ' + JSON.stringify(info));
        check('the pen runs on a different domain', info.host !== 'codepen.io', info.host);
        check(`Antitab ${scenario.expectDetected ? 'is absent from' : 'reached'} the pen frame`,
          info.payload === !scenario.expectDetected, `payload=${info.payload}`);
      }
    }
    if (!detectorFrame) {
      check('found the frame running the pen', false, 'no frame defined `visited`');
      return;
    }

    // --- does the detector still catch a departure in that frame? ----------
    // A tab cannot actually be put in the background under automation: three
    // methods across both headless modes all leave it visible, because the
    // driver keeps every page active on purpose. Dispatching the event into
    // the frame tests the part that can break, which is the interception.
    logs.length = 0;
    await detectorFrame.evaluate(() => { window.dispatchEvent(new Event('blur')); });
    await new Promise((r) => setTimeout(r, 400));
    const left = logs.filter((l) => /left this browser tab/i.test(l));
    console.log('  detector said: ' + (left.length ? left.join(' | ') : '(nothing)'));
    check(scenario.expectDetected
      ? 'without cdpn.io the detector still catches you'
      : 'with cdpn.io the detector never notices',
    (left.length > 0) === scenario.expectDetected, `${left.length} detections`);

    // --- would the popup offer the missing domain? --------------------------
    if (scenario.expectDetected) {
      // Calls the worker's own lookup, the same one the popup asks for.
      const reply = await worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => (t.url || '').includes('codepen.io')) || tabs[0];
        return embeddedHosts(tab.id);
      });
      const hosts = (reply && reply.hosts) || [];
      console.log('  embedded domains reported: ' + JSON.stringify(hosts));
      check('the popup would offer the domain the pen runs on',
        hosts.some((h) => h.endsWith('cdpn.io')), hosts.join(', ') || 'none');
    }

  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

try {
  for (const scenario of SCENARIOS) await runScenario(scenario);
} catch (error) {
  console.error(error);
  failures.push(String(error && error.message).slice(0, 120));
} finally {
  rmSync(build, { recursive: true, force: true });
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall good');
process.exit(failures.length ? 1 : 0);
