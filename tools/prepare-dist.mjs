#!/usr/bin/env node
/*
 * prepare-dist.mjs — prepares the web files for the Tauri package and the static site (--web): app/ → dist/.
 * Excluded: the test/ folder at the root (unit/e2e tests, encrypted PDF fixtures), every *.ttf (Literata already has
 * JS copies), every hidden file and folder whose name starts with a dot (.DS_Store, .env, .git/…).
 * The licence files GO INTO dist; their presence and content (not empty/skeleton) are checked.
 *
 * Target safety (removal only in a folder the script set up itself): the target must be inside the repository (links
 * resolved), it cannot clash with the repository root/source; an existing NON-EMPTY target is removed and set up again
 * only when the marker file the script left NEXT TO the target on an earlier run (`.<target-name>.dist-prepare`, with
 * the real path of the target inside) is there. The marker is written next to the target, not inside it, so that it
 * does not go into the package (Tauri embeds every file in frontendDist).
 *
 * --web (static site, e.g. GitHub Pages): LICENSE and THIRD_PARTY_NOTICES.md at the repository root are copied to the
 *   root of the target too and are required (cannot be empty/skeleton); the notices file must name every vendor/
 *   subfolder, Colorfigures and the code embedded in the built packages (EMBEDDED) (so that a new library does not go
 *   live without a notice).
 *
 * Usage:  node tools/prepare-dist.mjs [--source app] [--target dist] [--web] [--quiet]
 * Exit code: 0 = ready; 1 = missing/wrong input (missing/empty licence, no index.html, target outside the repository,
 *   a non-empty target without a marker, target clashes with the source, root licence/notices missing with --web…).
 */
import { readdirSync, readFileSync, writeFileSync, statSync, lstatSync, realpathSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

function arg(name, defaults) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaults;
}
const SOURCE = resolve(arg('--source', join(REPO, 'app')));
const TARGET = resolve(arg('--target', join(REPO, 'dist')));
const QUIET = process.argv.includes('--quiet');
const WEB = process.argv.includes('--web');
/** --web: required files copied from the repository root to the target root. */
const WEB_ROOT = ['LICENSE', 'THIRD_PARTY_NOTICES.md'];
/** --web: code embedded in the built (minified) packages; when the package file is in the source the notices must name these too. */
const EMBEDDED = {
  'vendor/pdf-lib/pdf-lib.min.js': ['pako', '@pdf-lib/upng', '@pdf-lib/standard-fonts', 'tslib'],
  'vendor/fontkit/fontkit.umd.min.js': ['pako', '@pdf-lib/brotli', '@pdf-lib/restructure', '@pdf-lib/unicode-properties',
    'unicode-trie', 'dfa', 'clone', 'deep-equal', 'iconv-lite', 'base64-js', 'base64-arraybuffer', 'buffer', 'ieee754',
    'isarray', 'inherits', 'readable-stream', 'process-es6', 'regenerator-runtime'],
};

/** Files the source must have (relative to the source). Licences: app/vendor/SOURCES.md; Learn: app/js/learn/LICENSE. */
const REQUIRED = [
  'index.html',
  'vendor/SOURCES.md',
  'vendor/pdf-lib/LICENSE.md',
  'vendor/pdfjs/LICENSE',
  'vendor/fontkit/LICENSE',
  'vendor/literata/OFL.txt',
  'js/learn/LICENSE', // the Colorfigures engine of the Learn guide (MIT; April Zhu, Tolga Cohce)
];
const LICENSE_PATTERN = /^(LICENSE|LICENCE|COPYING|OFL)(\.[a-z]+)?$/i;
/** To count as a licence text: at least this many characters without spaces and a licence/copyright word. */
const LICENSE_MIN = 200;
const LICENSE_WORD = /\b(copyright|license|licence|permission)\b/i;
const MARK_TOOL = 'dist-prepare';

function isExcluded(relPath, name, isFolder) {
  if (isFolder && relPath === 'test') return true;
  if (name.startsWith('.')) return true; // hidden file/folder (.DS_Store, .env, .git/ …)
  if (!isFolder && /\.ttf$/i.test(name)) return true;
  return false;
}

/** Is it an empty or skeleton (placeholder, one heading line) licence file? The problem text or null. */
function licenseProblem(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return 'could not be read'; }
  if (text.replace(/\s+/g, '').length < LICENSE_MIN) return 'empty or skeleton (too short)';
  if (!LICENSE_WORD.test(text)) return 'not a licence/copyright text';
  return null;
}

/** The real path (links resolved); when the path does not exist it is built from the nearest existing parent folder. */
function actualPath(path) {
  const suffixes = [];
  let y = path;
  while (!existsSync(y)) {
    const top = dirname(y);
    if (top === y) break;
    suffixes.unshift(basename(y));
    y = top;
  }
  return join(realpathSync(y), ...suffixes);
}

function stop(message) {
  console.error('dist-prepare: ' + message);
  process.exit(1);
}

function isInside(inner, outer) { return inner === outer || inner.startsWith(outer + sep); }

if (!existsSync(SOURCE) || !statSync(SOURCE).isDirectory()) stop(`no source folder: ${SOURCE}`);
const ACTUAL_SOURCE = realpathSync(SOURCE);
const ACTUAL_TARGET = actualPath(TARGET);
if (!isInside(ACTUAL_TARGET, REPO)) stop(`target outside the repository (${REPO}): ${TARGET}${ACTUAL_TARGET !== TARGET ? ' → ' + ACTUAL_TARGET : ''}`);
if (ACTUAL_TARGET === REPO) stop(`the repository root cannot be the target: ${TARGET}`);
if (isInside(ACTUAL_TARGET, ACTUAL_SOURCE) || isInside(ACTUAL_SOURCE, ACTUAL_TARGET)) stop(`target clashes with the source (one inside the other): ${TARGET}`);
if (existsSync(TARGET) && !lstatSync(TARGET).isDirectory()) stop(`target is not a folder (a file or a link): ${TARGET}`);

// The marker file is next to the target, with the real path of the target inside. A marker copied from another target does not pass.
const MARKER = join(dirname(ACTUAL_TARGET), '.' + basename(ACTUAL_TARGET) + '.dist-prepare');
// legacy-names: begin (marker written by the script under its earlier name; accepted once, then replaced)
const LEGACY_MARKER = join(dirname(ACTUAL_TARGET), '.' + basename(ACTUAL_TARGET) + '.dist-hazirla');
function legacyMarkValid() {
  try {
    const i = JSON.parse(readFileSync(LEGACY_MARKER, 'utf8'));
    return !!i && i.arac === 'dist-hazirla' && i.hedef === ACTUAL_TARGET;
  } catch { return false; }
}
// legacy-names: end
function markValid() {
  try {
    const i = JSON.parse(readFileSync(MARKER, 'utf8'));
    if (i && i.tool === MARK_TOOL && i.target === ACTUAL_TARGET) return true;
  } catch { /* no current marker: try the legacy one */ }
  return legacyMarkValid();
}
if (existsSync(TARGET) && readdirSync(TARGET).length && !markValid()) {
  stop(`target is not empty and there is no dist-prepare marker file (${MARKER}); a folder the script did not set up is not removed: ${TARGET}`);
}

const missing = REQUIRED.filter((g) => !existsSync(join(SOURCE, g)));
// The required licences must not be empty/skeleton.
for (const g of REQUIRED) {
  if (!LICENSE_PATTERN.test(basename(g)) || !existsSync(join(SOURCE, g))) continue;
  const problem = licenseProblem(join(SOURCE, g));
  if (problem) missing.push(`${g} (${problem})`);
}
// Every vendor subfolder must have a valid licence file (a newly added library must not go into the package without a licence).
const vendor = join(SOURCE, 'vendor');
if (existsSync(vendor)) {
  for (const g of readdirSync(vendor, { withFileTypes: true })) {
    if (!g.isDirectory() || isExcluded('vendor/' + g.name, g.name, true)) continue;
    const licenses = readdirSync(join(vendor, g.name)).filter((a) => LICENSE_PATTERN.test(a));
    if (!licenses.length) missing.push(`vendor/${g.name}/ (no licence file)`);
    else if (licenses.every((a) => licenseProblem(join(vendor, g.name, a)))) {
      missing.push(`vendor/${g.name}/ (licence file empty or skeleton: ${licenses.join(', ')})`);
    }
  }
}
if (WEB) {
  for (const a of WEB_ROOT) {
    const y = join(REPO, a);
    if (existsSync(join(SOURCE, a))) missing.push(`${a} (also in the source; clashes with the root file)`);
    if (!existsSync(y) || !statSync(y).isFile()) { missing.push(`${a} (not at the repository root)`); continue; }
    const problem = licenseProblem(y);
    if (problem) missing.push(`${a} (${problem})`);
  }
  const noticePath = join(REPO, 'THIRD_PARTY_NOTICES.md');
  if (existsSync(noticePath)) {
    const notice = readFileSync(noticePath, 'utf8').toLowerCase();
    const toMention = existsSync(vendor)
      ? readdirSync(vendor, { withFileTypes: true }).filter((g) => g.isDirectory() && !g.name.startsWith('.')).map((g) => g.name)
      : [];
    if (existsSync(join(SOURCE, 'js/learn/LICENSE'))) toMention.push('Colorfigures');
    for (const [pkg, names] of Object.entries(EMBEDDED)) {
      if (existsSync(join(SOURCE, pkg))) toMention.push(...names);
    }
    for (const name of new Set(toMention)) if (!notice.includes(name.toLowerCase())) missing.push(`THIRD_PARTY_NOTICES.md (${name} not named)`);
  }
}
if (missing.length) stop('missing required file: ' + [...new Set(missing)].join(', '));

rmSync(ACTUAL_TARGET, { recursive: true, force: true });
mkdirSync(ACTUAL_TARGET, { recursive: true });
writeFileSync(MARKER, JSON.stringify({ tool: MARK_TOOL, target: ACTUAL_TARGET }) + '\n');
if (existsSync(LEGACY_MARKER)) rmSync(LEGACY_MARKER, { force: true }); // replaced by the current marker
const copied = [];
const skipped = [];
(function walk(d) {
  for (const g of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const tam = join(d, g.name);
    const relPath = relative(SOURCE, tam).split(sep).join('/');
    if (isExcluded(relPath, g.name, g.isDirectory())) { skipped.push(relPath + (g.isDirectory() ? '/' : '')); continue; }
    if (g.isDirectory()) { walk(tam); continue; }
    if (!g.isFile()) { skipped.push(relPath + ' (not a file)'); continue; }
    const targetPath = join(ACTUAL_TARGET, relPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(tam, targetPath);
    copied.push(relPath);
  }
})(SOURCE);

if (WEB) {
  for (const a of WEB_ROOT) {
    if (existsSync(join(ACTUAL_TARGET, a))) stop(`the source also has ${a}; it clashes with the root file`);
    copyFileSync(join(REPO, a), join(ACTUAL_TARGET, a));
    copied.push(a + ' (from the repository root)');
  }
}

// Last check: nothing excluded is left in the target, the required files arrived.
const leaking = copied.filter((g) => g === 'test' || g.startsWith('test/') || /\.ttf$/i.test(g) || g.split('/').some((p) => p.startsWith('.')));
if (leaking.length) stop('a file that must be excluded was copied: ' + leaking.join(', '));
const absent = [...REQUIRED, ...(WEB ? WEB_ROOT : [])].filter((g) => !existsSync(join(ACTUAL_TARGET, g)));
if (absent.length) stop('a required file did not reach the target: ' + absent.join(', '));

if (!QUIET) {
  for (const g of copied) console.log('  + ' + g);
  for (const g of skipped) console.log('  - ' + g + ' (excluded)');
}
console.log(`dist-prepare: ${copied.length} files → ${relative(process.cwd(), TARGET) || TARGET}; excluded ${skipped.length}`);
