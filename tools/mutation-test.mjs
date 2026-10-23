/*
 * mutation-test.mjs — shows that the tests catch a faulty app.
 * Run (from the repository root): node tools/mutation-test.mjs
 *
 * The project is copied to a temporary folder; for every mutation one file of the copy is broken on purpose and the
 * unit tests and/or e2e run. Expected: for every mutation at least one test FAILS (exit code ≠ 0). The unbroken copy
 * must pass (control run). The real files are not touched.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MUTATIONS = [
  { name: 'sewn front left/right swapped', file: 'app/js/imposition.js', find: 'front: [offset + n - 2 * i, offset + 1 + 2 * i]', put: 'front: [offset + 1 + 2 * i, offset + n - 2 * i]', run: ['unit', 'e2e'] },
  { name: 'signature not filled up with blank pages (last signature always smaller)', file: 'app/js/imposition.js', find: "signatureSheetCounts.push(settings.shrinkLastSignature ? Math.ceil(rest / 4) : k)", put: 'signatureSheetCounts.push(Math.ceil(rest / 4))', run: ['unit', 'e2e'] },
  { name: '2-up back side wrong', file: 'app/js/imposition.js', find: 'back: [2 * N + 2 * i + 2, 2 * i + 2]', put: 'back: [2 * i + 2, 2 * N + 2 * i + 2]', run: ['unit'] },
  { name: 'creep halved', file: 'app/js/imposition.js', find: 'return roundOff(i * k);', put: 'return roundOff(i * k / 2);', run: ['unit'] },
  { name: 'spine thickness counts the endpaper allowance twice / wrong', file: 'app/js/calc.js', find: "checkNumber(sheet, 'sheet', 0) * checkNumber(thickness, 'paper_thickness', 0)", put: "checkNumber(sheet, 'sheet', 0) * 2 * checkNumber(thickness, 'paper_thickness', 0)", run: ['unit'] },
  { name: 'output paper portrait (width/height swapped)', file: 'app/js/output.js', find: 'doc.addPage([pt(place.paper.width), pt(place.paper.height)])', put: 'doc.addPage([pt(place.paper.height), pt(place.paper.width)])', run: ['e2e'] },
  { name: 'project data not stored', file: 'app/js/storage.js', find: 'root.localStorage.setItem(KEY, JSON.stringify(data));', put: '/* no write */', run: ['e2e'] },
  { name: 'import drops the notes', file: 'app/js/projects.js', find: '        data = fresh;\n', put: '        fresh.projects.forEach(function (k) { k.steps.forEach(function (a) { a.note = ""; }); });\n        data = fresh;\n', run: ['e2e'] },
  { name: 'console.error at start-up', file: 'app/js/app.js', find: "document.documentElement.setAttribute('data-ready', 'yes');", put: "console.error('test error'); document.documentElement.setAttribute('data-ready', 'yes');", run: ['e2e'] },
  { name: 'outside network request without permission', file: 'app/js/app.js', find: "document.documentElement.setAttribute('data-ready', 'yes');", put: "try { new Image().src = 'https://example.com/watch.gif'; } catch (e) {} document.documentElement.setAttribute('data-ready', 'yes');", run: ['e2e', 'grep'] },
  { name: 'library loaded from a CDN again', file: 'app/index.html', find: 'vendor/pdf-lib/pdf-lib.min.js', put: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', run: ['grep'] },
  { name: 'local library path broken (pdf.js)', file: 'app/index.html', find: 'vendor/pdfjs/pdf.min.js', put: 'vendor/pdfjs/none.min.js', run: ['e2e'] },
  // ---- fix round ----
  { name: 'backs in reverse order (backsReversed) not applied', file: 'app/js/output.js', find: 'if (settings.backsReversed) backs = backs.slice().reverse();', put: '', run: ['e2e'] },
  { name: '"blank before" added at the end', file: 'app/js/impose.js', find: "D.pages.unshift({ id: newId(), kind: 'blank' })", put: "D.pages.push({ id: newId(), kind: 'blank' })", run: ['e2e'] },
  { name: 'output: the 180° back rotation not applied', file: 'app/js/output.js', find: '(side.rotate180 ? 180 : 0)', put: '0', run: ['e2e'] },
  { name: 'output: the CropBox/MediaBox box not given to embedPages', file: 'app/js/output.js', find: 'await doc.embedPages(toEmbed, boxes)', put: 'await doc.embedPages(toEmbed)', run: ['e2e'] },
  { name: 'output: a page without /Contents unprotected', file: 'app/js/output.js', find: "if (!content || (content instanceof PDFLib.PDFArray && content.size() === 0)) {", put: 'if (false) {', run: ['e2e'] },
  { name: 'encrypted/restricted PDF not detected', file: 'app/js/impose.js', find: 'D.encrypted = encrypted === true;', put: 'D.encrypted = false;', run: ['e2e'] },
  { name: 'download enabled on a layout that does not fit the paper', file: 'app/js/impose.js', find: 'D.blocked = D.encrypted || D.uncheckable || !!r.layout.doesNotFit;', put: 'D.blocked = D.encrypted || D.uncheckable;', run: ['e2e'] },
  { name: 'storage.read returns the old record while the quota is full', file: 'app/js/storage.js', find: 'if (!persistent && memory) return memoryCopy();', put: '', run: ['unit'] },
  { name: 'negative margin/gutter accepted', file: 'app/js/layout.js', find: 'if (outer < 0 || binding < 0) throw', put: 'if (false) throw', run: ['unit'] },
  { name: 'spine mark shifts sideways in a new round (leaves the fold line)', file: 'app/js/layout.js', find: 'x: roundOff(middleX - SPINE_MARK_WIDTH / 2),', put: 'x: roundOff(middleX - SPINE_MARK_WIDTH / 2 + cycle * 4),', run: ['unit'] },
  { name: 'spine mark style does not change with the round (always filled)', file: 'app/js/layout.js', find: 'style: cycle % SPINE_MARK_STYLES', put: 'style: 0', run: ['unit'] },
  { name: 'isEncrypted returns false on the error branch (open instead of fail closed)', file: 'app/js/impose.js', find: '} catch { return null; }', put: '} catch { return false; }', run: ['e2e'] },
  { name: 'a result Db <= 0 not rejected', file: 'app/js/calc.js', find: "if (!(c[1] > 0)) throw new RangeError(t('calc.zero_or_negative'", put: "if (false) throw new RangeError(t('calc.zero_or_negative'", run: ['unit'] },
  { name: 'square 0 rejected', file: 'app/js/calc.js', find: 'if (!(k >= 0)) throw', put: 'if (!(k > 0)) throw', run: ['unit'] },
  { name: 'storage.clear does not set the memory to empty data (an old record may come back)', file: 'app/js/storage.js', find: 'memory = MC.projectModel.emptyData();\n    corruptRecord = false;', put: 'memory = null;', run: ['unit'] },
  { name: 'currentData returns the live object', file: 'app/js/impose.js', find: 'return JSON.parse(JSON.stringify(v)); // copy', put: 'return v; // copy', run: ['e2e'] },
  { name: 'window.prompt back for a password PDF', file: 'app/js/impose.js', find: "if (e && e.name === 'PasswordException') return passwordDocument(name);", put: "if (e && e.name === 'PasswordException') { window.prompt('password'); return passwordDocument(name); }", run: ['e2e'] },
  { name: 'a repeated step id accepted on import', file: 'app/js/project-model.js', find: 'if (a.id in stepIds) throw', put: 'if (false) throw', run: ['unit'] },
  { name: 'the Calculator rounds sheets per signature', file: 'app/js/calc.js', find: 'if (!Number.isInteger(sheetsPerSignature) || sheetsPerSignature > 8) throw', put: 'if (sheetsPerSignature > 8) throw', run: ['unit'] },
  // ---- AH: hard cover measurement formulas ----
  { name: 'jointGap not taken off the board width (Db = W + k)', file: 'app/js/calc.js', find: 'var Db = roundOff(W - f + k);', put: 'var Db = roundOff(W + k);', run: ['unit', 'e2e'] },
  { name: '2t dropped from the spine stiffener (R = S)', file: 'app/js/calc.js', find: 'R = roundOff(spine + 2 * tm);', put: 'R = roundOff(spine);', run: ['unit', 'e2e'] },
  // Every app script becomes an ES module: runs on a server, does not load under file:// (CORS) → only criterion 6 must fail
  { name: 'app loaded as an ES module', file: 'app/index.html', find: '<script src="js/', put: '<script type="module" src="js/', all: true, run: ['e2e'] },
  // ---- EPUB → PDF ----
  { name: 'EPUB: DRM check off', file: 'app/js/plugins/epub/epub-package.js', find: 'await checkDrm(zip);', put: '/* no DRM check */', run: ['e2e'] },
  { name: 'EPUB: the two consonant hyphenation rule reversed (both to the next syllable)', file: 'app/js/plugins/epub/hyphenation.js', find: 's.push(consonant === 0 ? next : next - 1);', put: 's.push(consonant === 0 ? next : consonant === 2 ? next - 2 : next - 1);', run: ['unit'] },
  { name: 'EPUB: chapter start does not open a new page', file: 'app/js/plugins/epub/typeset.js', find: 'if (!blank()) newPage();', put: 'if (false) newPage();', run: ['unit'] },
  { name: 'EPUB: gutter not taken off the page width', file: 'app/js/plugins/epub.js', find: 'var pageWidthMm = bookWidth - gutter - outerMargin;', put: 'var pageWidthMm = bookWidth - outerMargin;', run: ['e2e'] },
  { name: 'EPUB: font StandardFonts.TimesRoman instead of Literata', file: 'app/js/plugins/epub/pdf-writer.js', find: 'fonts[st] = await doc.embedFont(sources.fonts[st], { subset: subset, features: { liga: false } });', put: 'fonts[st] = await doc.embedFont(PDFLib.StandardFonts.TimesRoman);', run: ['unit', 'e2e'] },
  { name: 'EPUB: text/html fallback off on an XHTML error', file: 'app/js/plugins/epub/xhtml-blocks.js', find: "return new DOMParser().parseFromString(text, 'text/html');", put: 'return d;', run: ['e2e'] },
  { name: 'EPUB: lazy load path broken (fontkit)', file: 'app/js/plugins/epub.js', find: "var FONTKIT_JS = 'vendor/fontkit/fontkit.umd.min.js';", put: "var FONTKIT_JS = 'vendor/fontkit/none.umd.min.js';", run: ['e2e'] },
  // ---- EPUB fix round (encoding included) ----
  { name: 'BD/O1: no indent ceiling (W ≤ 0 → empty lines)', file: 'app/js/plugins/epub/typeset.js', find: 'if (leftLevel + rightLevel > areaWidth - minWidth) {', put: 'if (false) {', run: ['unit'] },
  { name: 'BD/O2: the whole long word measured on every line', file: 'app/js/plugins/epub/typeset.js', find: 'var g = wordWidthLimited(w, W - curW - ek, measure);', put: 'var g = wordWidth(w, measure);', run: ['unit'] },
  { name: 'BD/D3: a separator opens a new page on an empty page too', file: 'app/js/plugins/epub/typeset.js', find: 'if (before + L > rest() + 1e-6 && !blank()) newPage();', put: 'if (before + L > rest() + 1e-6) newPage();', run: ['unit'] },
  { name: 'BD/O3: broken image not caught', file: 'app/js/plugins/epub/pdf-writer.js', find: '} catch (e) { img = null; skipped += 1; }', put: '} catch (e) { throw e; }', run: ['unit', 'e2e'] },
  { name: 'BD/O4: EPUB settings not opened while there is a warning', file: 'app/js/plugins/epub.js', find: 'if (d) d.open = true;', put: '', run: ['e2e'] },
  { name: 'BD/D1: no size check of the unpacked data', file: 'app/js/plugins/epub/zip.js', find: 'if (n + p.length > expected) {', put: 'if (false) {', run: ['unit'] },
  { name: 'BD/D2: the entry table a plain object again', file: 'app/js/plugins/epub/zip.js', find: 'var inputs = Object.create(null);', put: 'var inputs = {};', run: ['unit'] },
  { name: 'BD/D4: a stale load result not dropped', file: 'app/js/impose.js', find: 'function stale() { return no !== D.requestNo; }', put: 'function stale() { return false; }', run: ['e2e'] },
  { name: 'BD/D5: table cell with textContent again', file: 'app/js/plugins/epub/xhtml-blocks.js', find: '}).map(cellText).filter(Boolean);', put: '}).map(function (c) { return String(c.textContent || \'\').trim(); }).filter(Boolean);', run: ['e2e'] },
  { name: 'BD/encoding: the encoding in the XML declaration ignored', file: 'app/js/plugins/epub/zip.js', find: 'var code = xmlEncoding(d);', put: 'var code = null;', run: ['unit', 'e2e'] },
  { name: 'BD/item 13: the earlier document stays on a faulty file', file: 'app/js/impose.js', find: "failedDocument(file.name || t('impose.document'));", put: '', run: ['e2e'] },
  // D6: the URL gate scans .cjs/.mjs files too; an address put into a new .cjs file under app must be caught
  { name: 'BD/D6: an outside address in a .cjs file under app/js', file: 'app/js/plugins/epub/leak.cjs', fresh: true, put: "module.exports = 'https://example.com/watch.gif';\n", run: ['grep'] }
];

// Files excluded from the URL gate on purpose, with reasons. epub-build.cjs is a test fixture builder that runs only
// in Node; the browser never loads it; the addresses in it are XML namespace identifiers (xmlns), not network requests.
// The network requests at run time are tested separately by the e2e "no outside network request" check.
const EXCLUDE_URL = ['app/test/epub-build.cjs'];

function run(copy, kind) {
  if (kind === 'unit') {
    const r = spawnSync(process.execPath, ['--test', join(copy, 'app', 'test') + '/'], { encoding: 'utf8' });
    const m = (r.stdout || '').match(/# fail (\d+)/);
    return { code: r.status, summary: `unit: fail ${m ? m[1] : '?'}` };
  }
  if (kind === 'e2e') {
    const r = spawnSync(process.execPath, [join(copy, 'app', 'test', 'e2e.mjs')], { encoding: 'utf8', timeout: 240000 });
    const rows = (r.stdout || '').split('\n');
    const remaining = rows.filter((s) => s.startsWith('FAIL')).map((s) => s.slice(0, 110));
    const previousServer = rows.filter((s) => s.startsWith('PASS') && s.includes('server')).length;
    return { code: r.status, summary: `e2e: ${remaining.length} FAIL, ${previousServer} PASS in the server run${remaining.length ? ' (first: ' + remaining[0] + ')' : ''}` };
  }
  // grep: criterion 3 — no http(s) address under app (except app/vendor).
  // *.cjs and *.mjs are scanned too; only the files in EXCLUDE_URL (reasons above) are excluded on purpose.
  const r = spawnSync('grep', ['-rnoE', '--include=*.html', '--include=*.js', '--include=*.cjs', '--include=*.mjs', '--exclude-dir=vendor', 'https?://[^"\' )]+', join(copy, 'app')], { encoding: 'utf8' });
  const exclude = EXCLUDE_URL.map((d) => join(copy, d).replace(/\\/g, '/') + ':');
  const bad = (r.stdout || '').split('\n').filter(Boolean)
    .filter((s) => !exclude.some((d) => s.replace(/\\/g, '/').startsWith(d)))
    .map((s) => s.replace(/^.*?:\d+:/, ''));
  return { code: bad.length ? 1 : 0, summary: `grep: ${bad.length} URLs without permission${bad.length ? ' (' + bad[0] + ')' : ''}` };
}

const root = mkdtempSync(join(tmpdir(), 'book-binding-mutation-'));
let error = 0;
try {
  const clean = join(root, 'clean', 'projects', 'book-binding');
  cpSync(PROJECT, clean, { recursive: true });
  for (const kind of ['unit', 'e2e', 'grep']) {
    const r = run(clean, kind);
    const good = r.code === 0;
    if (!good) error += 1;
    console.log(`${good ? 'PASS' : 'FAIL'} control run (unbroken copy) ${kind}: exit ${r.code} — ${r.summary}`);
  }
  MUTATIONS.forEach((m, i) => {
    const copy = join(root, 'm' + i, 'projects', 'book-binding');
    cpSync(PROJECT, copy, { recursive: true });
    const path = join(copy, m.file);
    if (m.fresh) {
      if (existsSync(path)) { error += 1; console.log(`ERROR  mutation could not be applied: ${m.name} (file already exists)`); return; }
      writeFileSync(path, m.put);
    } else {
      // in a Windows (core.autocrlf=true) tree the file is CRLF: turned into LF so that a multi-line search text matches
      const content = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
      if (!content.includes(m.find)) { error += 1; console.log(`ERROR  mutation could not be applied: ${m.name} (text not found)`); return; }
      writeFileSync(path, m.all ? content.split(m.find).join(m.put) : content.replace(m.find, m.put));
    }
    for (const kind of m.run) {
      const r = run(copy, kind);
      const caught = r.code !== 0;
      if (!caught) error += 1;
      console.log(`${caught ? 'CAUGHT' : 'MISSED   '} [${kind}] ${m.name} — exit ${r.code}; ${r.summary}`);
    }
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(error ? `\nRESULT: ${error} problems (a missed mutation or a broken control run)` : '\nRESULT: all mutations caught, the control run is clean');
process.exit(error ? 1 : 0);
