/**
 * Static checks that run in CI and before a release.
 *
 *   node dev/test/check-sources.mjs
 *
 * 1. every JavaScript file parses
 * 2. every path the manifest and the HTML pages point at exists
 * 3. no em dash in user-facing copy (a house rule: commas, colons and full
 *    stops instead, because the em dash is the giveaway of unedited generated
 *    prose)
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const failures = [];
const fail = (message) => { failures.push(message); console.log(`FAIL  ${message}`); };
const pass = (message) => console.log(`PASS  ${message}`);

const SKIP_DIRS = new Set(['.git', 'node_modules', 'bookmarklet', 'docs', '.playwright-mcp']);

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = dir === '.' ? entry : `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const files = walk('.');

// ---------------------------------------------------------------- 1. it parses

for (const file of files.filter((f) => /\.(js|mjs)$/.test(f) && !f.endsWith('.preview.html'))) {
  try {
    execFileSync(process.execPath, ['--check', join(ROOT, file)], { stdio: 'pipe' });
  } catch (error) {
    fail(`${file} does not parse: ${String(error.stderr || error).split('\n')[0]}`);
  }
}
pass('every JavaScript file parses');

// ------------------------------------------------------------ 2. paths resolve

const manifest = JSON.parse(read('manifest.json'));
const manifestPaths = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon)
];
for (const path of manifestPaths) {
  if (!existsSync(join(ROOT, path))) fail(`manifest points at a missing file: ${path}`);
}

// The service worker's importScripts are relative to the worker, not the root.
for (const match of read(manifest.background.service_worker).matchAll(/importScripts\(([^)]*)\)/g)) {
  for (const raw of match[1].split(',')) {
    const path = raw.trim().replace(/^['"]|['"]$/g, '');
    if (!path) continue;
    const resolved = join(dirname(manifest.background.service_worker), path);
    if (!existsSync(join(ROOT, resolved))) fail(`service worker imports a missing file: ${resolved}`);
  }
}

// Files the worker injects are root-relative.
for (const match of read(manifest.background.service_worker).matchAll(/'(src\/[^']+\.js)'/g)) {
  if (!existsSync(join(ROOT, match[1]))) fail(`service worker injects a missing file: ${match[1]}`);
}

for (const page of [manifest.action.default_popup, manifest.options_ui.page]) {
  const html = read(page);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (/^(https?:|data:|#|mailto:)/.test(reference)) continue;
    const resolved = join(dirname(page), reference);
    if (!existsSync(join(ROOT, resolved))) fail(`${page} references a missing file: ${reference}`);
  }
}
pass('every referenced path exists');

// ------------------------------------------------------- 3. no em dash in copy

/** Comments are code, not copy, so they are not part of this rule. */
function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const COPY_FILES = [
  ...files.filter((f) => f.startsWith('src/') && f.endsWith('.html') && !f.endsWith('.preview.html')),
  ...files.filter((f) => f.startsWith('src/') && f.endsWith('.js')),
  'dev/templates/install.html',
  'README.md'
];

let emDashes = false;
for (const file of COPY_FILES) {
  const source = read(file);
  const body = /\.(js)$/.test(file) ? stripJsComments(source) : source;
  if (!body.includes('—')) continue;
  const line = body.split('\n').findIndex((text) => text.includes('—')) + 1;
  fail(`em dash in user-facing copy: ${file}:${line}`);
  emDashes = true;
}
if (!emDashes) pass('no em dash in user-facing copy');

// ------------------------------------------------------------------- 4. report

console.log(failures.length ? `\n${failures.length} failed` : '\nall good');
process.exit(failures.length ? 1 : 0);
