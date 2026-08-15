/**
 * Sanity checks on the built bookmarklet, so a broken build cannot ship.
 *
 *   node dev/test/bookmarklet-check.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const failures = [];
const check = (name, condition) => {
  if (!condition) failures.push(name);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
};

const url = read('bookmarklet', 'antitab.txt').trim();
const readable = read('bookmarklet', 'antitab.js');
const page = read('docs', 'index.html');
const payload = read('src', 'main', 'antitab.js');

check('bookmarklet is a javascript: url', url.startsWith('javascript:'));
check('bookmarklet decodes to valid js', (() => {
  const decoded = decodeURIComponent(url.slice('javascript:'.length));
  try {
    // eslint-disable-next-line no-new-func
    new Function(decoded);
    return true;
  } catch (_) {
    return false;
  }
})());
check('bookmarklet has no raw newlines that a URL bar would drop', !/[\n\r]/.test(url));
check('bookmarklet is attribute-safe', !/["<>&]/.test(url));
check('bookmarklet fits comfortably in a bookmark', Buffer.byteLength(url) < 64 * 1024);

// The whole point of building from one source: these must not drift.
const markers = [
  'requestAnimationFrameShim',
  'handlePause',
  'onSuppressedEvent',
  'visibilityState'
];
for (const marker of markers) {
  check(`payload marker "${marker}" survives the build`, readable.includes(marker));
  check(`payload marker "${marker}" is in the source`, payload.includes(marker));
}

check('installer page carries the bookmarklet', page.includes(url));
check('installer page has no unreplaced placeholders', !/\{\{[A-Z_]+\}\}/.test(page));
check('installer page names the repo', page.includes('github.com/'));

console.log(failures.length ? `\n${failures.length} failed` : '\nall good');
process.exit(failures.length ? 1 : 0);
