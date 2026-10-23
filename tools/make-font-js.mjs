/*
 * make-font-js.mjs — turns the Literata TTF files into classic <script> files (base64) that the browser can load
 * under file:// too.
 *
 * Why: Chrome blocks reading local files with fetch/XHR under file://; injecting a <script> works. The EPUB plug-in
 * (js/plugins/epub.js) loads these JS files lazily.
 *
 * Run (from the repository root):
 *   node tools/make-font-js.mjs            → writes app/vendor/literata/literata-<style>.js
 *   node tools/make-font-js.mjs --verify   → builds them again and compares them byte for byte with the existing
 *                                            files; exit 1 on a difference, a missing or an extra file
 *   --root <folder>  another folder instead of the repository root (for the faulty input test)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const verify = argv.includes('--verify');
const rootIndex = argv.indexOf('--root');
const ROOT = rootIndex >= 0 ? resolve(argv[rootIndex + 1] || '.') : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'app', 'vendor', 'literata');

// style key → TTF name (the key is the same in pdf-writer.js and epub.js)
const STYLES = [
  ['regular', 'Literata-Regular.ttf'],
  ['italic', 'Literata-Italic.ttf'],
  ['bold', 'Literata-Bold.ttf'],
  ['bolditalic', 'Literata-BoldItalic.ttf']
];

function makeContent(style, ttfName, ttf) {
  return '/* ' + ttfName + ' (SIL OFL 1.1, see OFL.txt) as base64. Written by tools/make-font-js.mjs; do not edit by hand. */\n' +
    '(self.Mucellit = self.Mucellit || {}); (Mucellit.fonts = Mucellit.fonts || {})[\'' + style + '\'] = \'' +
    Buffer.from(ttf).toString('base64') + '\';\n';
}

let error = 0;
for (const [style, ttfName] of STYLES) {
  const ttfPath = join(DIR, ttfName);
  const jsPath = join(DIR, 'literata-' + style + '.js');
  if (!existsSync(ttfPath)) { console.log(`ERROR ${ttfName} missing (${ttfPath})`); error += 1; continue; }
  const ttf = readFileSync(ttfPath);
  if (ttf.length < 1024 || ttf.readUInt32BE(0) !== 0x00010000) { console.log(`ERROR ${ttfName} is not TrueType or is truncated (${ttf.length} bytes)`); error += 1; continue; }
  const expected = Buffer.from(makeContent(style, ttfName, ttf), 'utf8');
  if (verify) {
    if (!existsSync(jsPath)) { console.log(`FAIL ${jsPath} missing`); error += 1; continue; }
    const existing = readFileSync(jsPath);
    if (Buffer.compare(existing, expected) !== 0) { console.log(`FAIL literata-${style}.js ${ttfName} does not match (${existing.length} ≠ ${expected.length} bytes or different content)`); error += 1; }
    else console.log(`PASS literata-${style}.js ${expected.length} bytes, identical to ${ttfName}`);
  } else {
    writeFileSync(jsPath, expected);
    console.log(`written literata-${style}.js (${expected.length} bytes)`);
  }
}
process.exit(error ? 1 : 0);
