/*
 * epub-read-cli.cjs — TEST ONLY: opens an EPUB (ZIP) file with the app's own reader (zip.js), checks the OCF structure
 * and writes the result as one line of JSON. The Rust test (src-tauri/src/epub_folder.rs) checks the ZIP it builds
 * from a folder package with it: can the JS side really read the Rust output.
 *
 *   node app/test/epub-read-cli.cjs <file.epub>
 *   output: {"names":[…],"title":"…","warnings":[…]}  — exit 0 even with warnings; exit 1 when it cannot be read.
 *
 * Node has no DOMParser; container.xml and the OPF are read with regular expressions here (for the test only).
 */
'use strict';
const fs = require('node:fs');
const Z = require('../js/plugins/epub/zip.js');

async function verify(bytes) {
  const zip = Z.read(new Uint8Array(bytes));
  const names = zip.names();
  const warnings = [];
  if (names[0] !== 'mimetype') warnings.push('first entry is not mimetype: ' + names[0]);
  const mg = zip.input('mimetype');
  if (!mg) warnings.push('no mimetype');
  else {
    if (mg.method !== 0) warnings.push('mimetype is compressed');
    if ((await zip.text('mimetype')) !== 'application/epub+zip') warnings.push('wrong mimetype content');
  }
  if (!zip.has('META-INF/container.xml')) throw new Error('no META-INF/container.xml');
  const container = await zip.text('META-INF/container.xml');
  const opfPath = (/full-path="([^"]+)"/.exec(container) || [])[1];
  if (!opfPath || !zip.has(opfPath)) throw new Error('OPF not found: ' + opfPath);
  const opf = await zip.text(opfPath);
  const title = ((/<dc:title[^>]*>([^<]*)<\/dc:title>/.exec(opf)) || [])[1] || null;
  const base = opfPath.replace(/[^/]*$/, '');
  for (const m of opf.matchAll(/<item\b[^>]*\bhref="([^"]+)"/g)) {
    const y = Z.parsePath(base, m[1]);
    if (!zip.has(y)) warnings.push('manifest file missing: ' + y);
    else await zip.open(y); // CRC and size checks are in zip.js
  }
  return { names, title, warnings };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node app/test/epub-read-cli.cjs <file.epub>'); process.exit(2); }
  verify(fs.readFileSync(file)).then(
    (s) => { console.log(JSON.stringify(s)); },
    (e) => { console.error('could not be read: ' + (e && e.message)); process.exit(1); }
  );
}

module.exports = { verify };
