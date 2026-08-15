/**
 * Runs dev/test/spec.html headlessly and fails the build on any red assertion.
 *
 *   npm install --no-save playwright
 *   node dev/test/run-spec.mjs
 *
 * The spec drives the real Document.prototype.hidden getter itself, because no
 * headless browser ever puts a tab in the background. See spec.html.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 8799;

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

const browser = await chromium.launch();
let exitCode = 0;

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => { console.error('page error:', error.message); });

  await page.goto(`http://127.0.0.1:${PORT}/dev/test/spec.html`);
  await page.click('#run');
  await page.waitForFunction(() => window.__spec !== undefined, null, { timeout: 30000 });

  const spec = await page.evaluate(() => window.__spec);
  for (const result of spec.results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? '  (' + result.detail + ')' : ''}`);
  }
  console.log(`\n${spec.total - spec.failed}/${spec.total} passed`);
  exitCode = spec.failed ? 1 : 0;
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}

process.exit(exitCode);
