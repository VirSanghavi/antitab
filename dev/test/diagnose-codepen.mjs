/**
 * One-off diagnostic: run the payload the way the extension does (main world,
 * document_start, every frame) against the real CodePen demo of the classic
 * tab detector, and report what each frame sees.
 *
 *   node dev/test/diagnose-codepen.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const payload = readFileSync(join(ROOT, 'src/main/antitab.js'), 'utf8');
const PEN = 'https://codepen.io/calebnance/pen/nXPaKN';

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const context = await browser.newContext();

// This is what a registered content script does: main world, before any page
// script, in every frame.
await context.addInitScript({ content: payload });

const page = await context.newPage();
const logs = [];
page.on('console', (msg) => logs.push(msg.text()));

await page.goto(PEN, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(3000);

console.log('=== frames ===');
for (const frame of page.frames()) {
  const info = await frame.evaluate(() => ({
    href: location.href.slice(0, 90),
    origin: location.origin,
    payload: !!window.__antitab,
    hidden: document.hidden,
    hasDetector: typeof window.visited !== 'undefined'
  })).catch((error) => ({ error: String(error.message).slice(0, 80) }));
  console.log(JSON.stringify(info));
}

console.log('\n=== dispatch blur in every frame ===');
for (const frame of page.frames()) {
  await frame.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
  }).catch(() => {});
}
await page.waitForTimeout(500);

console.log('console output after blur:');
for (const line of logs) console.log('  ' + line);

console.log('\n=== worker under CodePen CSP ===');
const worker = await page.evaluate(() => {
  const src = 'onmessage=function(){postMessage(0)}';
  try {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.terminate();
    return 'blob worker allowed';
  } catch (error) {
    return 'blob worker threw: ' + error.name + ' / ' + String(error.message).slice(0, 60);
  }
});
console.log(worker);

const state = await page.evaluate(() => window.__antitab && window.__antitab.state());
console.log('\ntop frame state:', JSON.stringify(state));

await browser.close();
