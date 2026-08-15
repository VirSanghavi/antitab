/**
 * The bookmarklet against every frame arrangement a page might use.
 *
 *   npm install --no-save playwright
 *   node dev/test/run-frames.mjs
 *
 * A bookmarklet starts in one document. Whether it gets anywhere else depends
 * entirely on the shape of the page, so each shape is checked:
 *
 *   same origin      reachable
 *   srcdoc           reachable, it inherits the parent's origin
 *   nested           reachable, the walk has to recurse
 *   sandboxed        reachable while allow-same-origin is set
 *   added later      reachable, the observer picks it up
 *   another site     NOT reachable by anything, and reported rather than hidden
 *
 * Reachable means a `visibilitychange` listener registered in that frame before
 * Antitab existed never hears one, which is the thing that makes a page pause.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  (' + detail + ')' : ''}`);
};

const bookmarklet = decodeURIComponent(
  readFileSync(join(ROOT, 'bookmarklet/antitab.txt'), 'utf8').trim().slice('javascript:'.length)
);

const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  await page.addInitScript(`window.__crossOrigin = ${JSON.stringify(OTHER)};`);
  await page.goto(`${HOME}/dev/test/frames.html`);
  await page.waitForTimeout(1200);

  // Click the bookmark, then add a frame afterwards to prove the observer works.
  const toast = await page.evaluate((src) => {
    new Function(src)();
    return window.__antitabNotice || null;
  }, bookmarklet);
  check('the bookmarklet ran', !!toast && !!toast.message);

  await page.evaluate(() => window.addLateFrame());
  await page.waitForTimeout(900);

  // Now make every frame hear a visibility change.
  for (const frame of page.frames()) {
    await frame.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))).catch(() => {});
  }
  await page.waitForTimeout(300);

  const shapes = [
    ['same', 'a same-origin frame', true],
    ['srcdoc', 'a srcdoc frame', true],
    ['sandboxed', 'a sandboxed frame that kept its origin', true],
    ['late', 'a frame added after the click', true],
    ['cross', 'a frame from another site', false]
  ];

  for (const [id, label, reachable] of shapes) {
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
      check(`Antitab reaches ${label}`, result.payload === true, JSON.stringify(result));
      check(`${label} never hears the change`, result.heard === 0, JSON.stringify(result));
    } else {
      check(`${label} is correctly out of reach`, result.crossOrigin === true, JSON.stringify(result));
    }
  }

  // The frame nested two levels down, inside the same-origin one.
  const nested = await page.evaluate(() => {
    const outer = document.getElementById('same').contentWindow;
    const inner = outer.document.getElementById('nested');
    if (!inner || !inner.contentWindow) return { missing: true };
    return {
      payload: !!inner.contentWindow.__antitab,
      heard: inner.contentWindow.__seen ? inner.contentWindow.__seen.visibility : null
    };
  });
  check('Antitab reaches a frame nested two levels down', nested.payload === true, JSON.stringify(nested));
  check('the nested frame never hears the change', nested.heard === 0, JSON.stringify(nested));

  // And the human is told about the one it cannot reach.
  check('the toast says a part of the page is out of reach',
    !!toast && /another site/i.test(toast.message) && toast.unreachable === 1,
    JSON.stringify(toast && toast.message.slice(0, 130)));
} catch (error) {
  console.error(error);
  failures.push(String(error && error.message).slice(0, 120));
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall good');
process.exit(failures.length ? 1 : 0);
