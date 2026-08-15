/**
 * Runs Antitab against the classic window blur/focus tab detector from
 * Stack Overflow question 1760250, using real jQuery.
 *
 *   npm install --no-save playwright
 *   node dev/test/run-detector.mjs
 *
 * Four scenarios, because the answer genuinely differs between them:
 *
 *   1. no payload          the detector must fire, or this test proves nothing
 *   2. payload first       the extension case, at document_start: swallowed
 *   3. payload last, blur  the bookmarklet case. A window blur is dispatched at
 *                          window, where listeners run in the order they were
 *                          added, so a handler registered before us still hears
 *                          it. Focus is handed straight back instead.
 *   4. payload last, vis   a visibilitychange is dispatched at document, so a
 *                          capture listener on window runs first whenever it
 *                          was added: still swallowed.
 *
 * A headless browser never really backgrounds a tab, so the events are
 * dispatched directly. What is under test is the interception, which is the
 * part that can break.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 8801;
const BASE = `http://127.0.0.1:${PORT}`;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (_) {
  console.error('playwright is not installed. Run: npm install --no-save playwright');
  process.exit(1);
}

const server = spawn(process.execPath, [join(ROOT, 'dev/test/serve.mjs'), String(PORT)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'inherit']
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

const browser = await chromium.launch();

try {
  const page = await browser.newPage();

  // --- 1. baseline: the detector works when nothing is interfering ----------
  await page.goto(`${BASE}/dev/test/detector.html?antitab=0`);
  const baseline = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const type of ['blur', 'focus', 'blur', 'focus']) {
      window.dispatchEvent(new Event(type));
      await wait(20);
    }
    return window.__detector.report();
  });
  check('the detector catches a tab switch when left alone', baseline.blursSeen === 2, `${baseline.blursSeen} blurs`);
  check('the detector counts return visits', baseline.visited === 2, baseline.visited);

  // --- 2. the extension case: payload first --------------------------------
  await page.goto(`${BASE}/dev/test/detector.html?antitab=1`);
  const early = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let focusEvents = 0;
    window.addEventListener('focus', () => { focusEvents++; });
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('blur'));
    await wait(80);
    return { ...window.__detector.report(), focusEvents };
  });
  check('loaded first, the detector never sees the blur', early.blursSeen === 0, `${early.blursSeen} blurs`);
  check('loaded first, it never says you left', early.messages.length === 0, early.messages.join(' | '));
  check('loaded first, no focus event is invented', early.focusEvents === 0, early.focusEvents);

  // --- 3 and 4. the bookmarklet case: payload last -------------------------
  await page.goto(`${BASE}/dev/test/detector.html?antitab=0`);
  const late = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // Registered before the payload, the way a real page would have.
    let playing = true;
    let visChanges = 0;
    window.addEventListener('blur', () => { playing = false; });
    window.addEventListener('focus', () => { playing = true; });
    document.addEventListener('visibilitychange', () => { visChanges++; });

    const url = await (await fetch('/bookmarklet/antitab.txt')).text();
    const code = decodeURIComponent(url.trim().slice('javascript:'.length));
    new Function(code)();

    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    await wait(80);

    return { playing, visChanges, payload: !!window.__antitab, ...window.__detector.report() };
  });
  check('the bookmarklet applies to a loaded page', late.payload === true);
  check('a pause on blur is undone within a frame', late.playing === true, `playing=${late.playing}`);
  check('visibilitychange is still swallowed when injected late', late.visChanges === 0, late.visChanges);
  check('the honest limit: an earlier blur handler still hears it', late.blursSeen === 1,
    `${late.blursSeen}, expected 1`);
} catch (error) {
  console.error(error);
  failures.push(String(error && error.message));
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall good');
process.exit(failures.length ? 1 : 0);
