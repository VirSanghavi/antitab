/**
 * Builds the no-install version of Antitab from the very same payload the
 * extension ships, so the two can never drift apart.
 *
 *   node dev/build-bookmarklet.mjs
 *
 * Outputs:
 *   bookmarklet/antitab.js        readable, for anyone who wants to check it
 *   bookmarklet/antitab.txt       the javascript: URL, ready to paste
 *   docs/index.html               the one-page installer (GitHub Pages)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const REPO = process.env.ANTITAB_REPO || 'VirSanghavi/antitab';

/**
 * Drops comments and indentation. Deliberately not a minifier: it only needs to
 * know where strings and comments start and end, and neither source file
 * contains a regular-expression literal (asserted below), which is the one case
 * a scanner this simple cannot tell apart from a division.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      out += char;
      i++;
      while (i < source.length) {
        out += source[i];
        if (source[i] === '\\') {
          out += source[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += char;
    i++;
  }

  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function assertNoRegexLiteral(source, label) {
  // A regex literal always opens with `/` followed by something that is not a
  // space, `/`, `*` or `=`. Good enough to catch an accidental future one.
  const suspicious = /(^|[=(,:[!&|?{};])\s*\/[^/*\s=]/m.test(source);
  if (suspicious) {
    throw new Error(`${label} looks like it now contains a regex literal; the comment stripper cannot handle that safely.`);
  }
}

function check(source) {
  const file = join(tmpdir(), `antitab-check-${process.pid}.js`);
  writeFileSync(file, source);
  execFileSync(process.execPath, ['--check', file]);
}

const payload = read('src', 'main', 'antitab.js');
const wrapper = read('src', 'bookmarklet', 'wrapper.js');
const version = JSON.parse(read('manifest.json')).version;

assertNoRegexLiteral(payload, 'src/main/antitab.js');
assertNoRegexLiteral(wrapper, 'src/bookmarklet/wrapper.js');

const banner = `/* Antitab ${version} — keeps a tab's video playing after you switch away.\n`
  + `   Source: https://github.com/${REPO} — MIT licensed. */\n`;

const strippedPayload = stripComments(payload);

// The payload is inlined as code for this window, and again as a string so the
// wrapper can put it inside same-origin frames. Inlining it twice is deliberate:
// running the top window through eval would break on any page whose policy
// forbids eval, and that is the case that has to keep working.
const body = [
  'var __antitabWasInstalled = !!window.__antitab;',
  'var __antitabSource = ' + JSON.stringify(strippedPayload) + ';',
  strippedPayload,
  stripComments(wrapper)
].join('\n');

const readable = `${banner}(function(){\n${body}\n})();\n`;
check(readable);

const href = 'javascript:' + encodeURIComponent(`(function(){${body}})();`);

mkdirSync(join(ROOT, 'bookmarklet'), { recursive: true });
writeFileSync(join(ROOT, 'bookmarklet', 'antitab.js'), readable);
writeFileSync(join(ROOT, 'bookmarklet', 'antitab.txt'), href + '\n');

// The installer page carries the whole bookmarklet in one anchor href.
// encodeURIComponent leaves no <, >, & or " behind, so it is attribute-safe.
if (/["<>&]/.test(href)) throw new Error('bookmarklet href is not safe to inline in HTML');

const page = read('dev', 'templates', 'install.html')
  .replaceAll('{{HREF}}', href)
  .replaceAll('{{VERSION}}', version)
  .replaceAll('{{REPO}}', REPO);

mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'index.html'), page);
writeFileSync(join(ROOT, 'docs', '.nojekyll'), '');

const kb = (Buffer.byteLength(href) / 1024).toFixed(1);
console.log(`bookmarklet: ${kb} kB url`);
console.log('wrote bookmarklet/antitab.js, bookmarklet/antitab.txt, docs/index.html');
