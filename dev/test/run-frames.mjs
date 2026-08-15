/**
 * Both surfaces against every frame arrangement a page might use.
 *
 *   npm install --no-save playwright
 *   node dev/test/run-frames.mjs
 *
 * A page is rarely one document, and how far Antitab gets depends entirely on
 * the shape of it:
 *
 *   same origin      reachable
 *   srcdoc           reachable, but only because it is asked for: it has no URL
 *                    to match against, so a content script skips it by default
 *   nested           reachable, the walk has to recurse
 *   sandboxed        reachable while allow-same-origin is set
 *   added later      reachable
 *   another site     NOT reachable without being switched on in its own right
 *
 * Reachable means a `visibilitychange` listener registered in that frame before
 * Antitab existed never hears one, which is the thing that makes a page pause.
 *
 * The extension is given 127.0.0.1 and not localhost, so the cross-origin frame
 * is genuinely beyond it and both surfaces are held to the same table.
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 8803;
const HOME = `http://127.0.0.1:${PORT}`;
const OTHER = `http://localhost:${PORT}`; // same server, different site to the browser

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (_) {
  console.error('playwright is not installed. Run: npm install --no-save playwright');
  process.exit(1);
}

const server = spawn(process.execPath, [join(ROOT, 'dev/test/serve.mjs'), String(PORT)], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit']
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('the test server did not start')), 10000);
  server.stdout.on('data', () => { clearTimeout(timer); resolve(); });
  server.on('exit', (code) => reject(new Error(`the test server exited with ${code}`)));
});

const failures = [];
const check = (name, condition, detail) => {
  if (!condition) failures.push(name);
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  (' + detail + ')' : ''}`);
};

const SHAPES = [
  ['same', 'a same-origin frame', true],
  ['srcdoc', 'a srcdoc frame', true],
  ['sandboxed', 'a sandboxed frame that kept its origin', true],
  ['late', 'a frame added afterwards', true],
  ['cross', 'a frame from another site', false]
];

/** Everything both surfaces must satisfy, once the page is set up. */
async function assertShapes(page) {
  await page.evaluate(() => window.addLateFrame());
  await page.waitForTimeout(1200);

  for (const frame of page.frames()) {
    await frame.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))).catch(() => {});
  }
  await page.waitForTimeout(300);

  for (const [id, label, reachable] of SHAPES) {
    const result = await page.evaluate((frameId) => {
      const frame = document.getElementById(frameId);
      if (!frame || !frame.contentWindow) return { missing: true };
      try {
        return {
          payload: !!frame.contentWindow.__antitab,
          heard: frame.contentWindow.__seen ? frame.contentWindow.__seen.visibility : null
        };
      } catch (_) {
        return { crossOrigin: true };
      }
    }, id);

    if (reachable) {
      check(`reaches ${label}`, result.payload === true, JSON.stringify(result));
      check(`${label} never hears the change`, result.heard === 0, JSON.stringify(result));
    } else {
      check(`${label} is correctly out of reach`, result.crossOrigin === true, JSON.stringify(result));
    }
  }

  const nested = await page.evaluate(() => {
    const outer = document.getElementById('same').contentWindow;
    const inner = outer.document.getElementById('nested');
    if (!inner || !inner.contentWindow) return { missing: true };
    return {
      payload: !!inner.contentWindow.__antitab,
      heard: inner.contentWindow.__seen ? inner.contentWindow.__seen.visibility : null
    };
  });
  check('reaches a frame nested two levels down', nested.payload === true, JSON.stringify(nested));
  check('the nested frame never hears the change', nested.heard === 0, JSON.stringify(nested));
}

// ------------------------------------------------------------- the bookmark
async function runBookmarklet() {
  console.log('\n=== the bookmark ===');
  const bookmarklet = decodeURIComponent(
    readFileSync(join(ROOT, 'bookmarklet/antitab.txt'), 'utf8').trim().slice('javascript:'.length)
  );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(`window.__crossOrigin = ${JSON.stringify(OTHER)};`);
    await page.goto(`${HOME}/dev/test/frames.html`);
    await page.waitForTimeout(1200);

    const notice = await page.evaluate((src) => {
      new Function(src)();
      return window.__antitabNotice || null;
    }, bookmarklet);
    check('the bookmarklet ran', !!notice && !!notice.message);
    check('it says a part of the page is out of reach',
      !!notice && /another site/i.test(notice.message) && notice.unreachable === 1,
      JSON.stringify(notice && notice.message.slice(0, 90)));

    await assertShapes(page);
  } finally {
    await browser.close();
  }
}

// ----------------------------------------------------------- the extension
async function runExtension() {
  console.log('\n=== the extension ===');
  const build = mkdtempSync(join(tmpdir(), 'antitab-frames-'));
  for (const entry of ['manifest.json', 'src', 'icons']) {
    cpSync(join(ROOT, entry), join(build, entry), { recursive: true });
  }
  const manifest = JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['*://127.0.0.1/*']; // deliberately not localhost
  delete manifest.optional_host_permissions;
  delete manifest.optional_permissions;
  writeFileSync(join(build, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const profile = mkdtempSync(join(tmpdir(), 'antitab-frames-p-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`]
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    for (let attempt = 0; attempt < 40; attempt++) {
      const ready = await worker
        .evaluate(() => typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local))
        .catch(() => false);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        antitab: {
          enabled: true,
          sites: { '127.0.0.1': { addedAt: Date.now() } },
          options: { presence: true, keepAlive: true, fakeActivity: true, forceResume: true }
        }
      });
    });
    await new Promise((r) => setTimeout(r, 1500));

    const registered = await worker.evaluate(() =>
      chrome.scripting.getRegisteredContentScripts()
        .then((s) => s.map((x) => ({ id: x.id, fallback: x.matchOriginAsFallback }))));
    check('registered to match a frame with no URL of its own',
      registered.every((r) => r.fallback === true), JSON.stringify(registered));

    const page = await context.newPage();
    await page.addInitScript(`window.__crossOrigin = ${JSON.stringify(OTHER)};`);
    await page.goto(`${HOME}/dev/test/frames.html`);
    await page.waitForTimeout(2000);

    await assertShapes(page);
  } finally {
    await context.close();
    rmSync(build, { recursive: true, force: true });
    rmSync(profile, { recursive: true, force: true });
  }
}

try {
  await runBookmarklet();
  await runExtension();
} catch (error) {
  console.error(error);
  failures.push(String(error && error.message).slice(0, 120));
} finally {
  server.kill();
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall good');
process.exit(failures.length ? 1 : 0);
