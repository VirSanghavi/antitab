/**
 * Antitab under a Content Security Policy that forbids blob: workers, which is
 * what CodePen, GitHub and plenty of other strict sites send.
 *
 *   npm install --no-save playwright
 *   node dev/test/run-csp.mjs
 *
 * The keep-alive ticker is a Worker built from a blob URL. If that is refused
 * the fallback has to actually take over, and it has to do so once, not on
 * every attempt: a page cannot be left with a ticker object that never ticks.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 8802;

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
  const context = await browser.newContext();

  // Stamp a strict policy onto the spec page, the way a real site would.
  await context.route(`http://127.0.0.1:${PORT}/dev/test/spec.html`, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      body,
      headers: {
        ...response.headers(),
        'content-security-policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'none'"
      }
    });
  });

  const page = await context.newPage();
  const violations = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Content Security Policy|worker/i.test(text)) violations.push(text.slice(0, 80));
  });

  await page.goto(`http://127.0.0.1:${PORT}/dev/test/spec.html`);

  const result = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const api = window.__antitab;

    // Blob workers must genuinely be refused here, or this test proves nothing.
    let workerRefused = false;
    try {
      const url = URL.createObjectURL(new Blob(['0'], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.terminate();
    } catch (_) {
      workerRefused = true;
    }

    window.__simHidden = true;

    let frames = 0;
    let running = true;
    (function loop() { if (!running) return; frames++; requestAnimationFrame(loop); })();

    let ticks = 0;
    const handle = setInterval(() => { ticks++; }, 50);

    await wait(1500);
    running = false;
    clearInterval(handle);
    window.__simHidden = false;

    return { workerRefused, frames, ticks, state: api.state() };
  });

  check('the policy really does refuse blob workers', result.workerRefused === true);
  check('animation frames still arrive with no worker', result.frames > 0, `${result.frames} in 1.5s`);
  check('timers still fire with no worker', result.ticks > 0, `${result.ticks} in 1.5s`);
  check('the ticker reports itself as running', result.state.ticking === true);
  check('the worker is not retried over and over', violations.length <= 2, `${violations.length} violations`);
  if (violations.length) console.log('    first violation: ' + violations[0]);
} catch (error) {
  console.error(error);
  failures.push(String(error && error.message));
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall good');
process.exit(failures.length ? 1 : 0);
