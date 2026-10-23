/*
 * e2e.mjs — end-to-end browser test (Playwright + Chromium).
 * Run (from the repository root):  node app/test/e2e.mjs
 *
 * Run 1 (local server): load the 37-page test PDF → sewn, paper 297×210, book 148×210, 4 sheets per signature →
 *   export → 24 pages, 297×210 mm, on page 1 16 on the left and 1 on the right (pdf.js text extraction). Preview
 *   screenshot. Projects: create a project, mark 2 steps, reload, export JSON → clear → import → the same data.
 * Run 2 (file://): the same PDF flow, index.html opened straight from the file.
 * In both runs: no console error (console.error / pageerror); every network request of the page must be local
 *   (the server address / file://); an outside network request = FAIL.
 *
 * EPUB (EPUB → PDF), in both runs: Turkish text, vector/font, size and scale 1, sewn export, DRM, FXL, broken;
 *   the long EPUB < 60 s in the file:// run. The EPUB fixtures are built during the test with app/test/epub-build.cjs.
 *
 * Confirm "no" (a native confirm rejection and a confirm that returns a Promise like the Tauri dialog plug-in) →
 *   the Projects data does not change; "yes" → the action is done. Dropping a file on the page opens the PDF, dragging
 *   pages inside the grid works.
 * ".epub.zip" (the browser's compression of a folder package EPUB) in both runs; the "tauri-simulation" run tests the
 *   native Save flow with a fake window.__TAURI__ (D7: cancel → "not saved", written → path) and the automatic backup:
 *   native Open (open_file → read_file raw ArrayBuffer), opening from the Dock/Finder (file-opened event +
 *   pending_opens), a Save error (failed branch), the page count on a partial save, ⌘S while the Save dialog is open,
 *   an empty backup without a notice / a filled backup restored, the clean-up backup goes without waiting.
 * (language): the existing runs use the Turkish interface (browser locale tr-TR; the system language rule) and today's
 *   Turkish texts. Extra "en" runs (en-US, server and file://): an English interface smoke test (tabs, notices, file
 *   name suffixes -imposed/-fronts, no Turkish letter in the visible text, an old Turkish record opens with English
 *   steps), a manual language choice and back; in the Tauri simulation read_language/set_language, the View > Language
 *   menu event and coming back from the Rust backup. At the end of every run no key is missing from the dictionary
 *   (Mucellit.i18n.missingKeys).
 * The "startup-error" run (tr-TR): with a rejected platform.ready, an i18n.js error and a broken tr dictionary the
 *   labels are not left empty (chosen language / static English); in the Tauri simulation the system language comes
 *   from Rust (read_language.system) with a storage hint fit for the Mac; in the en run the changed English texts
 *   (Imposition, source p., couldn't …).
 * Printing in the tauri-simulation run (Print… / Open in Preview buttons, the note before printing, one PDF, two PDFs
 *   fronts → turn-over confirmation → backs, stopping halfway, ⌘P/⌘S ignored while busy, menu ⌘P, Save + note when
 *   Preview cannot open); the buttons are hidden in the browser runs. Start-up jobs 0a–0i (first frame language,
 *   console without i18n.js, decimal separator, language picker tooltip and layout) in the related runs.
 * The local server sends the CSP of src-tauri/tauri.conf.json as a header (every flow runs under the same CSP as
 *   Tauri; a violation counts as a console error, FAIL); fetch('https://example.com') is rejected by the CSP;
 *   Object.prototype is frozen; on import the File of pickFile is handled, its rejection goes to a notice; the "yes"
 *   paths of Remove step and Clear all.
 *
 * (Learn guide): the "learn" (tr-TR) and "learn en" (en-US) runs, on the local server with the Tauri CSP header: the
 *   guide is not set up before the tab opens; the numbers panel defaults are the same as the Calculator (the same result
 *   object); 10 stages 45 steps; Sample Book values (by hand and from the Calculator); a manual change does not change
 *   the Calculator, "Use values from the Calculator tab"; the match note on another binding type; when the tab changes
 *   "start to end" stops, the figure is removed, rAF calls 0; play from start to end (4×) to the end; language change
 *   (after the reload the guide is in the new language, the position is kept); prefers-reduced-motion (45 steps without
 *   animation); CSP violations 0, global names only under Mucellit, missing keys 0. A smoke test in the file:// run; in
 *   the Tauri simulation the menu event "tab-learn" (View > Learn ⌘4).
 * The guide's probe interface (Mucellit.learn.probe) is not in the product code; the "learn" runs catch the learn.js
 *   request and serve a test copy (app/test/learn-probe.cjs, page.route). The file:// and Tauri simulation smoke tests
 *   use only the DOM (the product code as it is) and check that the product code has no probe. With Learn open,
 *   pressing the tab/menu again does not set the guide up again ("start to end" skips no step); the progress (done) is
 *   kept on a language change; the licence panel.
 * Flags / environment:
 *   --engine=chromium|webkit  (default chromium; webkit = the Playwright engine closest to WKWebView)
 *   MC_PLAYWRIGHT             Playwright module folder (e.g. /path/playwright/node_modules/playwright)
 *   PLAYWRIGHT_BROWSERS_PATH  without it /opt/pw-browsers (when it exists), otherwise the Playwright default
 *   MC_SCREENSHOTS            path of the preview screenshot (default docs/preview.png)
 * The libraries are local under app/vendor/.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL, format as formatUrl } from 'node:url';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { execSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Browser path: PLAYWRIGHT_BROWSERS_PATH when given; otherwise /opt/pw-browsers when it exists (cloud environment);
// when neither, Playwright's own default (macOS: ~/Library/Caches/ms-playwright).
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO = resolve(APP, '..');
const IMAGE = process.env.MC_SCREENSHOTS ? resolve(process.env.MC_SCREENSHOTS) : join(REPO, 'docs', 'preview.png');
const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=chromium').slice('--engine='.length);

const results = [];
function check(criterion, condition, message, detail) {
  results.push({ criterion, pass: !!condition, message });
  console.log(`${condition ? 'PASS' : 'FAIL'} [criterion ${criterion}] ${message}${detail !== undefined ? ' — ' + detail : ''}`);
}

/**
 * The Playwright module in this order: MC_PLAYWRIGHT (the module folder, e.g. /path/playwright/node_modules/playwright),
 * a plain `import('playwright')`, last the global npm root.
 */
async function loadPlaywright() {
  if (process.env.MC_PLAYWRIGHT) return await import(pathToFileURL(join(resolve(process.env.MC_PLAYWRIGHT), 'index.mjs')).href);
  try { return await import('playwright'); } catch {
    const root = execSync('npm root -g').toString().trim();
    return await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
  }
}

// The CSP of the Tauri window: the local server sends the same as a header. null means no header.
const TAURI_CSP = (() => {
  const c = JSON.parse(readFileSync(join(REPO, 'src-tauri', 'tauri.conf.json'), 'utf8')).app.security.csp;
  return typeof c === 'string' && c.trim() ? c : null;
})();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'x:/').pathname);
      const file = resolve(APP, '.' + (path === '/' ? '/index.html' : path));
      if (file !== APP && !file.startsWith(APP + sep)) { response.writeHead(403); return response.end(); }
      const content = await readFile(file);
      const title = { 'content-type': MIME[extname(file)] || 'application/octet-stream' };
      if (TAURI_CSP && extname(file) === '.html') title['content-security-policy'] = TAURI_CSP;
      response.writeHead(200, title);
      response.end(content);
    } catch { response.writeHead(404); response.end(); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** Watches the page: console errors and network requests. */
function watch(page, label) {
  const iz = { errors: [], requests: [], prompts: [], confirms: [], confirmRed: false };
  page.on('console', (m) => { if (m.type() === 'error') iz.errors.push(`[${label}] console.error: ${m.text()}`); });
  page.on('pageerror', (e) => iz.errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('request', (r) => iz.requests.push(r.url()));
  page.on('dialog', (d) => {
    if (d.type() === 'prompt') { iz.prompts.push(d.message()); return d.dismiss(); }
    if (d.type() === 'confirm') { iz.confirms.push(d.message()); return iz.confirmRed ? d.dismiss() : d.accept(); }
    return d.accept();
  });
  return iz;
}

async function makeTestPdf(page) {
  // The test PDF is built with the pdf-lib of the page: 37 pages, A5, a big number on every page.
  const array = await page.evaluate(async () => {
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const doc = await PDFDocument.create();
    const text = await doc.embedFont(StandardFonts.HelveticaBold);
    for (let i = 1; i <= 37; i++) {
      const s = doc.addPage([419.53, 595.28]);
      const t = String(i), fontSize = 160;
      s.drawText(t, { x: (419.53 - text.widthOfTextAtSize(t, fontSize)) / 2, y: 595.28 / 2 - fontSize * 0.35, size: fontSize, font: text });
    }
    return Array.from(await doc.save());
  });
  return Buffer.from(array);
}

async function inspectPdf(page, bytes, pages) {
  return page.evaluate(async ({ array, pages }) => {
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(array), isEvalSupported: false }).promise;
    const sizes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const s = await pdf.getPage(i);
      const vp = s.getViewport({ scale: 1 });
      sizes.push([vp.width * 25.4 / 72, vp.height * 25.4 / 72]);
    }
    const texts = {};
    for (const n of pages) {
      const s = await pdf.getPage(n);
      const vp = s.getViewport({ scale: 1 });
      const tc = await s.getTextContent();
      texts[n] = { width: vp.width, elements: tc.items.filter((o) => o.str.trim()).map((o) => ({ str: o.str.trim(), x: o.transform[4], w: o.width })) };
    }
    return { pageCount: pdf.numPages, sizes, texts };
  }, { array: Array.from(bytes), pages });
}

function leftRight(m) {
  // sort the items by x; return whether each item is in the left/right half
  return m.elements.slice().sort((a, b) => a.x - b.x).map((o) => ({ str: o.str, half: o.x + o.w / 2 < m.width / 2 ? 'left' : 'right' }));
}

/** Load the PDF → set sewn → export → check the output. */
async function pdfFlow(page, address, label, criterion, screenImage) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-impose');
  const pdf = await makeTestPdf(page);
  await page.setInputFiles('#pdf-file', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 37);
  check(criterion, true, `${label}: 37-page PDF loaded, 37 thumbnail cards`);
  await page.selectOption('#binding-type', 'sewn');
  await page.fill('#paper-width', '297');
  await page.fill('#paper-height', '210');
  await page.fill('#book-width', '148');
  await page.fill('#book-height', '210');
  await page.fill('#signature-sheet', '4');
  await page.waitForFunction(() => document.querySelectorAll('#sheet-preview .sheet-card').length === 12);
  const summary = await page.textContent('#imposition-summary');
  check(criterion, /48 sayfaya/.test(summary) && /3 forma/.test(summary), `${label}: preview 12 sheets, summary`, summary.trim());  // turkish-ok: expected Turkish UI text
  await page.waitForSelector('#small-thumbs[data-thumbs-ready="yes"]', { timeout: 60000 });
  if (screenImage) {
    await mkdir(dirname(IMAGE), { recursive: true });
    await page.locator('#sheet-preview').screenshot({ path: IMAGE });
    check(criterion, true, `${label}: preview screenshot saved`, IMAGE);
  }
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-transfer')]);
  const output = await readFile(await download.path());
  check(criterion, /-dizilmis\.pdf$/.test(download.suggestedFilename()), `${label}: one PDF downloaded`, download.suggestedFilename());  // turkish-ok: expected Turkish UI text
  await page.waitForSelector('#output-preview[data-ready="yes"]');

  const r = await inspectPdf(page, output, [1, 2, 3, 17]);
  check(criterion, r.pageCount === 24, `${label}: output 24 pages`, r.pageCount);
  const bad = r.sizes.map((b, i) => [i + 1, b]).filter(([, b]) => Math.abs(b[0] - 297) > 0.5 || Math.abs(b[1] - 210) > 0.5);
  check(criterion, r.sizes.length === 24 && bad.length === 0, `${label}: her page 297×210 mm (±0.5)`,
    bad.length ? JSON.stringify(bad) : `first ${r.sizes[0].map((x) => x.toFixed(2)).join('×')} mm`);
  const s1 = leftRight(r.texts[1]);
  check(criterion, s1.length === 2 && s1[0].str === '16' && s1[0].half === 'left' && s1[1].str === '1' && s1[1].half === 'right',
    `${label}: on page 1 16 on the left, 1 on the right (pdf.js text)`, JSON.stringify(s1));
  const s2 = leftRight(r.texts[2]);
  check(criterion, JSON.stringify(s2.map((o) => o.str)) === '["2","15"]', `${label}: 2. page (back) [2, 15]`, JSON.stringify(s2));
  const s3 = leftRight(r.texts[3]);
  check(criterion, JSON.stringify(s3.map((o) => o.str)) === '["14","3"]', `${label}: 3. page [14, 3]`, JSON.stringify(s3));
  const s17 = leftRight(r.texts[17]);
  check(criterion, s17.length === 1 && s17[0].str === '33' && s17[0].half === 'right', `${label}: page 17 [48 blank, 33]`, JSON.stringify(s17));
}

async function readStorage(page) {
  return page.evaluate(() => { const h = localStorage.getItem('mucellit.projects'); return h ? JSON.parse(h) : null; });
}

async function projectsFlow(page) {
  const O = 3;
  await page.click('#tab-button-projects');
  await page.fill('#yk-name', 'E2E Book');
  await page.selectOption('#yk-kind', 'sewn');
  await page.fill('#yk-paper', '80 g/m²');
  await page.click('#yk-create');
  await page.waitForFunction(() => document.querySelectorAll('#steps .step').length === 14);
  check(O, true, 'project created, sewn template 14 steps');
  await page.locator('#steps .step-done').nth(0).check();
  await page.locator('#steps .step-done').nth(1).check();
  await page.locator('#steps .step-note').nth(1).fill('first trial: one signature');
  // save the Imposition settings to the project
  await page.click('#tab-button-impose');
  const bookId = (await readStorage(page)).projects[0].id;
  await page.selectOption('#settings-book', bookId);
  await page.click('#settings-save');
  const registered = await readStorage(page);
  check(O, registered.projects[0].settings && registered.projects[0].settings.paperWidth === 297 && registered.projects[0].pdfName === 'test-37.pdf',
    'Imposition settings saved to the project', JSON.stringify({ paperWidth: registered.projects[0].settings && registered.projects[0].settings.paperWidth, pdfName: registered.projects[0].pdfName }));

  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]');
  await page.click('#tab-button-projects');
  await page.waitForSelector('#steps .step');
  const marks = await page.$$eval('#steps .step-done', (l) => l.map((e) => e.checked));
  const note = await page.locator('#steps .step-note').nth(1).inputValue();
  check(O, marks.length === 14 && marks[0] && marks[1] && marks.filter(Boolean).length === 2,
    '2 marks stay after the reload', JSON.stringify(marks.map((x) => (x ? 1 : 0))));
  check(O, note === 'first trial: one signature', 'the note stays after the reload', note);

  const once = await readStorage(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#json-export')]);
  const jsonPath = await download.path();
  const exportData = JSON.parse(await readFile(jsonPath, 'utf8'));
  check(O, isDeepStrictEqual(exportData, once), 'the JSON export is the same as the stored data', download.suggestedFilename());

  await page.click('#data-clear');
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 0);
  const clean = await readStorage(page);
  check(O, !clean || clean.projects.length === 0, 'clear: data empty', JSON.stringify(clean));

  await page.setInputFiles('#json-import', jsonPath);
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 1);
  const after = await readStorage(page);
  check(O, isDeepStrictEqual(after, once), 'import: the data is exactly the exported one');
  const marks2 = await page.$$eval('#steps .step-done', (l) => l.map((e) => e.checked));
  check(O, marks2.filter(Boolean).length === 2 && marks2[0] && marks2[1], '2 marks in the interface after the import', JSON.stringify(marks2.map((x) => (x ? 1 : 0))));
}


// ------------------------------------------------------------------
// Fix tests
// ------------------------------------------------------------------
const FIXTURE = join(APP, 'test', 'fixtures');

/** In-page helpers: building numbered PDFs, building the output (Mucellit.output.build) and reading text with pdf.js. */
async function setupHelpers(page) {
  await page.evaluate(() => {
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const T = (window.__t = {});
    T.numberedPdf = async (n, w = 419.53, h = 595.28) => {
      const doc = await PDFDocument.create();
      const text = await doc.embedFont(StandardFonts.HelveticaBold);
      for (let i = 1; i <= n; i++) {
        const s = doc.addPage([w, h]);
        const t = String(i), fontSize = 120;
        s.drawText(t, { x: (w - text.widthOfTextAtSize(t, fontSize)) / 2, y: h / 2 - fontSize * 0.35, size: fontSize, font: text });
      }
      return await doc.save();
    };
    T.settings = (ek) => Object.assign({
      bindingType: 'sewn', sheetsPerSignature: 1, shrinkLastSignature: false, creep: false, paperThickness: 0.1,
      paperWidth: 297, paperHeight: 210, bookWidth: 148, bookHeight: 210, scaling: 'fit', outerMargin: 0, gutter: 0,
      cropMarks: false, folding: false, spineMarks: false, duplex: 'short', outputMode: 'single', backsReversed: false,
    }, ek || {});
    T.build = async (source, pages, ek) => {
      const s = await window.Mucellit.output.build({ sourceBytes: source, pages, settings: T.settings(ek), fileName: 'test.pdf' });
      return s;
    };
    T.all = (n) => Array.from({ length: n }, (_, i) => ({ kind: 'pdf', source: i, rotate: 0 }));
    T.texts = async (bytes) => {
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const s = await pdf.getPage(n);
        const vp = s.getViewport({ scale: 1 });
        const tc = await s.getTextContent();
        pages.push({
          width: vp.width, height: vp.height,
          elements: tc.items.filter((o) => o.str.trim()).map((o) => ({ str: o.str.trim(), x: o.transform[4], y: o.transform[5], a: o.transform[0], w: o.width })),
        });
      }
      return pages;
    };
  });
}

/** Runs an in-page function; the result contains only serialisable values. */
function ordered(pageText) { return pageText.elements.slice().sort((a, b) => a.x - b.x).map((o) => o.str); }

async function ayFlowTwo(page, label) {
  const A = 'AD6';
  // ---- two PDF output + backs in reverse order (8 pages, 2 sheets per signature → 2 sheets of paper) ----
  const r = await page.evaluate(async () => {
    const T = window.__t;
    const source = await T.numberedPdf(8);
    const flat = await T.build(source, T.all(8), { sheetsPerSignature: 2, outputMode: 'pair', backsReversed: false });
    const reversed = await T.build(source, T.all(8), { sheetsPerSignature: 2, outputMode: 'pair', backsReversed: true });
    const o = {};
    for (const [name, s] of [['flat', flat], ['reversed', reversed]]) {
      o[name] = { names: s.files.map((d) => d.name), pages: [] };
      for (const d of s.files) o[name].pages.push((await T.texts(d.bytes)).map((m) => m.elements.slice().sort((a, b) => a.x - b.x).map((e) => e.str)));
    }
    return o;
  });
  check(A, r.flat.names.length === 2 && /-onler\.pdf$/.test(r.flat.names[0]) && /-arkalar\.pdf$/.test(r.flat.names[1]),  // turkish-ok: expected Turkish UI text
    `${label}: the two PDF mode makes two files (fronts + backs)`, r.flat.names.join(' , '));
  check(A, JSON.stringify(r.flat.pages[0]) === '[["8","1"],["6","3"]]', `${label}: fronts [8|1] [6|3]`, JSON.stringify(r.flat.pages[0]));
  check(A, JSON.stringify(r.flat.pages[1]) === '[["2","7"],["4","5"]]', `${label}: backs in straight order [2|7] [4|5]`, JSON.stringify(r.flat.pages[1]));
  check(A, /-arkalar-ters\.pdf$/.test(r.reversed.names[1]) && JSON.stringify(r.reversed.pages[1]) === '[["4","5"],["2","7"]]',  // turkish-ok: expected Turkish UI text
    `${label}: with backsReversed on the backs are in reverse order [4|5] [2|7]`, r.reversed.names[1] + ' ' + JSON.stringify(r.reversed.pages[1]));
  check(A, JSON.stringify(r.reversed.pages[0]) === JSON.stringify(r.flat.pages[0]), `${label}: backsReversed does not change the fronts`);

  // ---- 180° back rotation: short/long edge × landscape/portrait ----
  const d4 = await page.evaluate(async () => {
    const T = window.__t;
    const source = await T.numberedPdf(4);
    const states = [
      ['landscape-short', { paperWidth: 297, paperHeight: 210, bookWidth: 148, bookHeight: 210, duplex: 'short' }],
      ['landscape-long', { paperWidth: 297, paperHeight: 210, bookWidth: 148, bookHeight: 210, duplex: 'long' }],
      ['portrait-short', { paperWidth: 210, paperHeight: 297, bookWidth: 100, bookHeight: 150, duplex: 'short' }],
      ['portrait-long', { paperWidth: 210, paperHeight: 297, bookWidth: 100, bookHeight: 150, duplex: 'long' }],
    ];
    const o = {};
    for (const [name, ek] of states) {
      const s = await T.build(source, T.all(4), ek);
      const m = await T.texts(s.files[0].bytes);
      o[name] = m.map((p) => ({ order: p.elements.slice().sort((a, b) => a.x - b.x).map((e) => e.str), marks: p.elements.map((e) => Math.sign(e.a)) }));
    }
    return o;
  });
  const expected = { 'landscape-short': false, 'landscape-long': true, 'portrait-short': true, 'portrait-long': false };
  for (const [name, don] of Object.entries(expected)) {
    const [on, back] = d4[name];
    const frontFlat = on.marks.every((i) => i > 0) && JSON.stringify(on.order) === '["4","1"]';
    const backDone = don
      ? back.marks.length === 2 && back.marks.every((i) => i < 0) && JSON.stringify(back.order) === '["3","2"]'
      : back.marks.length === 2 && back.marks.every((i) => i > 0) && JSON.stringify(back.order) === '["2","3"]';
    check(A, frontFlat && backDone, `${label}: ${name}: front straight, back ${don ? 'turned 180°' : 'not turned'}`, JSON.stringify({ on: on.order, back: back.order, backMark: back.marks }));
  }
}

async function ayBoxes(page, label) {
  const A = 'AD4';
  // CropBox (30,30,420,595) and a MediaBox whose origin is not (0,0) (100,100,420,595); a page without /Contents
  const r = await page.evaluate(async () => {
    const T = window.__t;
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    let p = doc.addPage([420, 595]); p.setMediaBox(100, 100, 420, 595); p.drawText('SHIFTEDORIGIN', { x: 150, y: 400, size: 30, font: f });
    p = doc.addPage([480, 655]); p.setCropBox(30, 30, 420, 595); p.drawText('CROPPED', { x: 150, y: 300, size: 30, font: f }); p.drawText('OVERFLOW', { x: 2, y: 2, size: 20, font: f });
    const source = await doc.save();
    const s = await T.build(source, T.all(2), { bindingType: 'single1', paperWidth: 210, paperHeight: 297, bookWidth: 210, bookHeight: 297, scaling: 'actual', duplex: 'long' });
    const m = await T.texts(s.files[0].bytes);
    const content = s.layout.sides.map((y) => y.slots.filter((v) => !v.blank).map((v) => v.content)[0]);
    // OVERFLOW: the text outside the CropBox must never show in the output → draw the page and check that the area is white
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(s.files[0].bytes), isEvalSupported: false }).promise;
    const sf = await pdf.getPage(2);
    const vp = sf.getViewport({ scale: 1 });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await sf.render({ canvasContext: g, viewport: vp }).promise;
    return { m, content, vpHeight: vp.height, vpWidth: vp.width, sourceBytes: Array.from(source.slice(0, 0)), overflowText: m[1].elements.some((o) => /OVERFLOW/.test(o.str)),
      pixelSize: [c.width, c.height], pixel: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
  });
  const MM = 72 / 25.4;
  const mm2pt = (x) => x * MM;
  const root = (inner) => ({ left: mm2pt(inner.x + inner.w / 2) - 210, bottom: mm2pt(inner.y + inner.h / 2) - 297.5 });
  const k1 = root(r.content[0]), k2 = root(r.content[1]);
  const o1 = r.m[0].elements.find((o) => o.str === 'SHIFTEDORIGIN');
  const o2 = r.m[1].elements.find((o) => o.str === 'CROPPED');
  check(A, o1 && Math.abs(o1.x - (k1.left + 50)) < 0.6 && Math.abs(o1.y - (k1.bottom + 300)) < 0.6,
    `${label}: MediaBox (100,100,420,595): SHIFTEDORIGIN x=left+50 (the origin does not shift)`, o1 ? `x ${o1.x.toFixed(2)} (expected ${(k1.left + 50).toFixed(2)}), y ${o1.y.toFixed(2)} (expected ${(k1.bottom + 300).toFixed(2)})` : 'no text');
  check(A, o2 && Math.abs(o2.x - (k2.left + 120)) < 0.6 && Math.abs(o2.y - (k2.bottom + 270)) < 0.6,
    `${label}: CropBox (30,30,420,595): CROPPED x=left+120`, o2 ? `x ${o2.x.toFixed(2)} (expected ${(k2.left + 120).toFixed(2)}), y ${o2.y.toFixed(2)} (expected ${(k2.bottom + 270).toFixed(2)})` : 'no text');
  // where OVERFLOW is drawn: page bottom left = (left-28, bottom-28) pt, 20 pt text ~ 50 pt wide
  const [W, H] = r.pixelSize;
  const x0 = Math.max(0, Math.floor(k2.left - 30)), x1 = Math.floor(k2.left - 1);
  const yBottom = Math.floor(H - (k2.bottom - 28)), yTop = Math.floor(H - (k2.bottom - 28 + 20));
  let dark = 0;
  for (let y = yTop - 2; y <= yBottom + 2; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * W + x) * 4; if (r.pixel[i] < 200) dark += 1;
  }
  console.log(`info: ${label}: OVERFLOW in the text extraction ${r.overflowText ? 'visible (pdf.js does not apply the crop to the text extraction)' : 'none'}`);
  check(A, dark === 0, `${label}: the "OVERFLOW" text outside the CropBox is not drawn in the output (the overflow area is white)`, `dark pixel ${dark}`);

  // ---- a source page without /Contents counts as blank ----
  const c = await page.evaluate(async () => {
    const T = window.__t;
    const { PDFDocument } = window.PDFLib;
    const source0 = await T.numberedPdf(3);
    const doc = await PDFDocument.load(source0);
    // make page 2 without /Contents
    doc.getPage(1).node.delete(window.PDFLib.PDFName.of('Contents'));
    const source = await doc.save();
    const checkDoc = await PDFDocument.load(source);
    const noContent = checkDoc.getPage(1).node.Contents() === undefined;
    let error = null, m = null;
    try {
      const s = await T.build(source, T.all(3), {});
      m = (await T.texts(s.files[0].bytes)).map((p) => p.elements.slice().sort((a, b) => a.x - b.x).map((e) => e.str));
    } catch (e) { error = e.message; }
    return { noContent, error, m };
  });
  check('AD3', c.noContent && c.error === null && c.m && c.m.length === 2,
    `${label}: a page without /Contents does not stop the output (the source really has no /Contents)`, c.error ? 'ERROR: ' + c.error : JSON.stringify(c.m));
  if (c.m) {
    const all = c.m.flat();
    check('AD3', all.includes('1') && all.includes('3') && !all.includes('2'), `${label}: page 2 without /Contents is blank (1 and 3 there, 2 not)`, JSON.stringify(c.m));
  }
}

async function ayBlankToStart(page, address, label) {
  const A = 'AD6';
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-impose');
  await setupHelpers(page);
  const pdf = Buffer.from(await page.evaluate(async () => Array.from(await window.__t.numberedPdf(7))));
  await page.setInputFiles('#pdf-file', { name: 'seven.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 7);
  await page.selectOption('#binding-type', 'sewn');
  await page.fill('#paper-width', '297'); await page.fill('#paper-height', '210');
  await page.fill('#book-width', '148'); await page.fill('#book-height', '210');
  await page.fill('#signature-sheet', '2');
  await page.selectOption('#output-mode', 'single');
  await page.click('#blank-toStart');
  const first = await page.getAttribute('#small-thumbs .card:first-child', 'data-kind');
  const last = await page.getAttribute('#small-thumbs .card:last-child', 'data-kind');
  check(A, first === 'blank' && last === 'pdf', `${label}: "Blank before" puts the blank page at the START of the list`, `first ${first}, son ${last}`);
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-transfer')]);
  const output = await readFile(await download.path());
  const m = await page.evaluate(async (array) => (await window.__t.texts(new Uint8Array(array)))[0].elements.map((e) => ({ str: e.str, half: e.x + e.w / 2 < 148.5 * 72 / 25.4 ? 'left' : 'right' })), Array.from(output));
  check(A, m.length === 1 && m[0].str === '7' && m[0].half === 'left', `${label}: with a blank at the start the 1st output page has only "7" on the left (right slot empty)`, JSON.stringify(m));
}

async function encryptedFlow(page, address, iz, label) {
  const A = 'AD1';
  const states = ['encrypted-owner-rc4.pdf', 'encrypted-owner-aes.pdf'];
  for (const name of states) {
    await page.goto(address);
    await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
    await page.click('#tab-button-impose');
    iz.prompts.length = 0;
    await page.setInputFiles('#pdf-file', { name: name, mimeType: 'application/pdf', buffer: await readFile(join(FIXTURE, name)) });
    await page.waitForSelector('#encrypted-warning', { timeout: 20000 });
    const warning = await page.textContent('#encrypted-warning');
    const closed = await page.isDisabled('#export-transfer');
    check(A, /Bu PDF kısıtlı\/şifreli; önce kısıtlamayı kaldırın, ör\. qpdf --decrypt girdi\.pdf cikti\.pdf/.test(warning) && closed,  // turkish-ok: expected Turkish UI text
      `${label}: ${name}: Turkish warning visible, download button disabled`, `disabled=${closed}`);
    // the warning stays when a setting changes later, the button does not turn on
    await page.fill('#book-width', '147');
    await page.waitForTimeout(150);
    check(A, await page.isDisabled('#export-transfer') && (await page.locator('#encrypted-warning').count()) === 1, `${label}: ${name}: the button stays disabled when a setting changes too`);
  }
  // A PDF with a (user) password: no password prompt (window.prompt) OPENS, no preview, the warning is visible, download disabled
  {
    const name = 'encrypted-user.pdf';
    await page.goto(address);
    await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
    await page.click('#tab-button-impose');
    iz.prompts.length = 0;
    await page.setInputFiles('#pdf-file', { name: name, mimeType: 'application/pdf', buffer: await readFile(join(FIXTURE, name)) });
    await page.waitForSelector('#passwordProtected-warning', { timeout: 20000 });
    await page.waitForTimeout(300);
    const warning = await page.textContent('#passwordProtected-warning');
    const cards = await page.locator('#small-thumbs .card').count();
    check('AR3', iz.prompts.length === 0, `${label}: ${name}: no dialog (prompt) opened`, JSON.stringify(iz.prompts));
    check('AR3', warning.includes('Bu PDF parolalı; önce parolayı kaldırın: qpdf --password=PAROLA --decrypt girdi.pdf cikti.pdf')  // turkish-ok: expected Turkish UI text
      && await page.isDisabled('#export-transfer') && cards === 0, `${label}: ${name}: Turkish password warning visible, no preview/card, download disabled`, `card=${cards}`);
  }
  // When the encryption/restriction state cannot be checked (no pdf-lib), fail closed: warning + download disabled
  {
    const name = 'no-imposition-needed.pdf';
    await page.goto(address);
    await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
    await page.click('#tab-button-impose');
    const bytes = await page.evaluate(async () => {
      const d = await window.PDFLib.PDFDocument.create();
      for (let i = 0; i < 4; i++) d.addPage([420, 595]);
      return Array.from(await d.save());
    });
    await page.evaluate(() => { window.PDFLib = undefined; });
    await page.setInputFiles('#pdf-file', { name: name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    await page.waitForSelector('#check-warning', { timeout: 20000 });
    const warning = await page.textContent('#check-warning');
    check('AR2', /Şifre\/kısıt durumu denetlenemedi/.test(warning) && await page.isDisabled('#export-transfer'),  // turkish-ok: expected Turkish UI text
      `${label}: without pdf-lib the "could not be checked" warning is visible, download disabled (fail closed)`, warning);
  }
  // currentData returns a copy; settings-load does not change project.settings
  {
    await page.goto(address);
    await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
    const result = await page.evaluate(() => {
      const MC = window.Mucellit;
      const live = MC.projects.data();
      const k = MC.impose.currentData();
      const differentObject = k !== live;
      const once = JSON.stringify(live);
      k.projects.push({ id: 'x', name: 'fake', steps: [] });
      return { differentObject, unchanged: JSON.stringify(MC.projects.data()) === once };
    });
    check('AR7', result.differentObject && result.unchanged, `${label}: currentData returns a copy (the live data does not change)`, JSON.stringify(result));
    await page.click('#tab-button-projects');
    await page.waitForTimeout(100);
    const settings = await page.evaluate(() => {
      const MC = window.Mucellit;
      const v = MC.projects.data();
      const kt = MC.projectModel.newProject({ name: 'SettingsBook' });
      kt.settings = { bookWidth: 120, bookHeight: 180, bindingType: 'sewn' };
      v.projects.push(kt);
      MC.impose.refreshProjectList();
      return kt.id;
    });
    await page.click('#tab-button-impose');
    const once = await page.evaluate((id) => JSON.stringify(window.Mucellit.projectModel.findProject(window.Mucellit.projects.data(), id).settings), settings);
    await page.selectOption('#settings-book', settings);
    await page.click('#settings-load');
    await page.fill('#book-width', '99');
    await page.waitForTimeout(100);
    const after = await page.evaluate((id) => JSON.stringify(window.Mucellit.projectModel.findProject(window.Mucellit.projects.data(), id).settings), settings);
    check('AR7', once === after, `${label}: project.settings unchanged after settings-load`, once + ' / ' + after);
  }
}

async function uiChecks(page, address, label) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-impose');
  await setupHelpers(page);
  const pdf = Buffer.from(await page.evaluate(async () => Array.from(await window.__t.numberedPdf(8))));
  await page.setInputFiles('#pdf-file', { name: 'eight.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 8);
  await page.selectOption('#binding-type', 'sewn');
  await page.fill('#paper-width', '297'); await page.fill('#paper-height', '210');
  await page.fill('#book-width', '148'); await page.fill('#book-height', '210');
  await page.fill('#signature-sheet', '2');
  await page.fill('#outer-margin', '0'); await page.fill('#binding-allowance', '0');
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled);
  // D7: the paper does not fit the book → download disabled + a clear warning
  await page.fill('#paper-width', '200');
  await page.waitForFunction(() => document.getElementById('export-transfer').disabled);
  let warn = await page.textContent('#warnings');
  check('AD6', /sığmıyor/.test(warn), `${label}: a clear warning on a layout that does not fit the paper, download disabled`, warn.trim().slice(0, 90));  // turkish-ok: expected Turkish UI text
  await page.fill('#paper-width', '297');
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled);
  // D8: a negative margin / gutter is rejected
  await page.fill('#outer-margin', '-3');
  await page.waitForFunction(() => document.getElementById('export-transfer').disabled);
  warn = await page.textContent('#warnings');
  check('AD6', /negatif/.test(warn), `${label}: a negative outer margin is rejected with a message, download disabled`, warn.trim());  // turkish-ok: expected Turkish UI text
  await page.fill('#outer-margin', '0');
  await page.fill('#binding-allowance', '-1');
  await page.waitForFunction(() => document.getElementById('export-transfer').disabled);
  warn = await page.textContent('#warnings');
  check('AD6', /negatif/.test(warn), `${label}: a negative gutter is rejected with a message`, warn.trim());  // turkish-ok: expected Turkish UI text
  await page.fill('#binding-allowance', '0');
  // O4: the turn-over label in the two PDF mode
  await page.selectOption('#output-mode', 'pair');
  const e1 = await page.textContent('#duplex-label');
  await page.selectOption('#output-mode', 'single');
  const e2 = await page.textContent('#duplex-label');
  check('AD4', /desteyi hangi kenardan çevireceksiniz/.test(e1) && /yazıcıda da aynısını seçin/.test(e2) && e1 !== e2, `${label}: the turn-over label in the two PDF mode "which edge you turn the stack over"`, e1);  // turkish-ok: expected Turkish UI text
  // D9 + blank page count: the Calculator tab
  await page.click('#tab-button-calculator');
  await page.fill('#h-pageCount', '');
  let h = await page.textContent('#h-error');
  check('AD6', /Sayfa sayısını girin/.test(h), `${label}: the Calculator says "Sayfa sayısını girin" for an empty page count`, h.trim());  // turkish-ok: expected Turkish UI text
  await page.fill('#h-pageCount', '100');
  await page.fill('#h-sheetsPerSignature', '2.6');
  h = await page.textContent('#h-error');
  check('AD6', /tam sayı/.test(h) && (await page.locator('#h-result tr').count()) === 0, `${label}: the Calculator rejects 2.6 sheets per signature (the same as Imposition)`, h.trim());  // turkish-ok: expected Turkish UI text
  await page.fill('#h-sheetsPerSignature', '4');
  // AH: hard cover measurements (S = 12 → board 144×216, stiffener 16×216, covering 352×250)
  await page.fill('#h-pageCount', '240');
  await page.selectOption('#h-bindingType', 'single1');
  const cell = (name) => page.textContent(`#h-result td[data-result="${name}"]`);
  const m1 = await cell('board'), s1 = await cell('spineStrip'), k1 = await cell('covering');
  const numbers = (x) => (x.replace(/\s/g, ' ').match(/\d+(?:,\d+)?/g) || []).join('/');
  check('AH', numbers(m1) === '144/216' && numbers(s1) === '16/216' && numbers(k1) === '352/250', `${label}: Calculator hard cover measurements 144×216, 16×216, 352×250`, `${m1} | ${s1} | ${k1}`);
  await page.selectOption('#h-spineRule', 'onlyS');
  const s2 = await cell('spineStrip'), k2 = await cell('covering');
  check('AH', numbers(s2) === '12/216' && numbers(k2) === '352/250', `${label}: the "S only" rule stiffener 12, covering still 352×250`, `${s2} | ${k2}`);
  await page.selectOption('#h-spineRule', 'twoT');
  await page.selectOption('#h-spineShape', 'rounded');
  const uyA = await page.textContent('#h-warnings');
  check('AH', /eğri boyunu ölçüp girin/.test(uyA) && numbers(await cell('spineStrip')) === '19/216', `${label}: rounded spine, curve length empty → 19 mm and a warning`, uyA.trim().slice(0, 80));  // turkish-ok: expected Turkish UI text
  await page.fill('#h-curveLength', '20');
  check('AH', numbers(await cell('spineStrip')) === '23/216' && (await page.textContent('#h-warnings')).trim() === '', `${label}: rounded spine, curve length 20 → 23 mm, no warning`);
  await page.fill('#h-curveLength', ''); await page.selectOption('#h-spineShape', 'flat');
  await page.fill('#h-boardThickness', '4');
  check('AH', /elle ayarlayın/.test(await page.textContent('#h-warnings')) && numbers(await cell('jointGap')) === '9', `${label}: t=4 → joint 9 and the "no source, set it by hand" note`);  // turkish-ok: expected Turkish UI text
  await page.fill('#h-boardThickness', '0');
  check('AH', /sıfırdan büyük/.test(await page.textContent('#h-error')), `${label}: t=0 rejected`);  // turkish-ok: expected Turkish UI text
  await page.fill('#h-boardThickness', '2');
  // no inner repository path (docs/…md) is shown to the user; the note stays "workshop practice"
  const sourceNote = await page.textContent('#h-source');
  check('AH', /atölye uygulaması/.test(sourceNote) && !/docs\/|\.md\b/.test(sourceNote), `${label}: the Calculator source note is visible, no inner repository path`, sourceNote);  // turkish-ok: expected Turkish UI text
}

async function osStorageFlow(page, address, label) {
  // O5: storage full → the new project in the Projects tab shows in the Imposition tab too
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.evaluate(() => {
    // full quota simulation: writing mucellit.projects throws
    const old = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'mucellit.projects') throw new DOMException('filled', 'QuotaExceededError'); return old.call(this, k, v); };
  });
  await page.click('#tab-button-projects');
  await page.fill('#yk-name', 'Full Book');
  await page.click('#yk-create');
  await page.waitForFunction(() => document.querySelectorAll('#steps .step').length > 0);
  const warning = await page.textContent('#storage-warning');
  check('AD5', /saklama alanı/.test(warning) && /dolu/.test(warning), `${label}: with the quota full a Turkish warning "saklama alanı ... dolu"`, warning.trim().slice(0, 80));  // turkish-ok: expected Turkish UI text
  await page.click('#tab-button-impose');
  const options = await page.$$eval('#settings-book option', (l) => l.map((o) => o.textContent));
  check('AD5', options.includes('Full Book'), `${label}: with the quota full the Imposition tab lists the new project`, JSON.stringify(options));
}

// ------------------------------------------------------------------
// EPUB → PDF. The fixtures are built during the test with epub-build.cjs.
// ------------------------------------------------------------------
const EPUB_MIME = 'application/epub+zip';
const E_MESSAGE = {
  E1: 'Bu dosya okunamadı: geçerli bir EPUB (ZIP) değil ya da bozuk.',  // turkish-ok: expected Turkish UI text
  E2: 'EPUB içinde META-INF/container.xml yok; dosya bozuk ya da EPUB değil.',  // turkish-ok: expected Turkish UI text
  E3: "Bu EPUB DRM ile korunuyor (şifreli içerik). Mücellit DRM'li kitapları açmaz; DRM'siz bir kopya kullanın.",  // turkish-ok: expected Turkish UI text
  E4: "Bu EPUB sabit sayfa düzeninde (fixed-layout). Mücellit yalnız akışkan (reflowable) EPUB'ları destekler; sabit düzenli EPUB'lar dizilemez.",  // turkish-ok: expected Turkish UI text
};

async function freshPage(page, address) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-impose');
  await page.evaluate(() => {
    const E = (window.__e = {});
    // converts the EPUB straight with the plug-in (with the EPUB settings of the interface and the given sizes)
    E.convert = async (array, size) => {
      const f = new File([new Uint8Array(array)], 'x.epub', { type: 'application/epub+zip' });
      return Array.from(await window.Mucellit.epub.convert(f, Object.assign({ bookWidth: 148, bookHeight: 210, gutter: 0, outerMargin: 0 }, size || {})));
    };
    E.inspect = async (array) => {
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(array), isEvalSupported: false }).promise;
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const s = await pdf.getPage(n);
        const vp = s.getViewport({ scale: 1 });
        const tc = await s.getTextContent();
        pages.push({ width: vp.width * 25.4 / 72, height: vp.height * 25.4 / 72, elements: tc.items.map((o) => ({ str: o.str, a: o.transform[0] })) });
      }
      return pages;
    };
    // pdf-lib low level: image XObject count per page; font dictionaries
    E.structure = async (array) => {
      const { PDFDocument, PDFName, PDFDict } = window.PDFLib;
      const doc = await PDFDocument.load(new Uint8Array(array), { updateMetadata: false });
      const withImages = doc.getPages().map((p) => {
        const xo = p.node.Resources() && p.node.Resources().lookup(PDFName.of('XObject'));
        if (!xo) return 0;
        return xo.keys().filter((k) => String(xo.lookup(k).dict.get(PDFName.of('Subtype'))) === '/Image').length;
      });
      const fonts = [];
      const definitions = [];
      doc.context.enumerateIndirectObjects().forEach(([, o]) => {
        if (!(o instanceof PDFDict)) return;
        const type = String(o.get(PDFName.of('Type')));
        if (type === '/Font') fonts.push({ subtype: String(o.get(PDFName.of('Subtype'))), name: String(o.get(PDFName.of('BaseFont'))) });
        if (type === '/FontDescriptor') definitions.push(!!o.get(PDFName.of('FontFile2')));
      });
      return { withImages, fonts, definitions };
    };
    E.ir = async (array, path) => {
      const MC = window.Mucellit;
      const zip = MC.epubZip.read(new Uint8Array(array));
      const pkg = await MC.epubPackage.readPackage(zip);
      const env = { zip, lang: pkg.lang, cssCache: new Map(), images: {}, counter: { skippedImage: 0, table: 0 } };
      const r = await MC.xhtmlBlock.documentToBlocks(await zip.text(path), path, env);
      return { blocks: r.blocks, counter: env.counter, spine: pkg.spine.map((s) => s.path), cover: pkg.coverPath, lang: pkg.lang,
        inline: env.inlineCache ? env.inlineCache.size : null, unsupported: zip.unsupportedEncodings ? zip.unsupportedEncodings() : null };
    };
  });
}

/** Picks the EPUB in the interface; returns when the "… yüklendi" notice or an error notice comes (so that the cards of an earlier load do not fool the wait). */  // turkish-ok: expected Turkish UI text
async function pickEpub(page, name, bytes, time = 90000) {
  await page.evaluate(() => { const b = document.getElementById('notice'); b.textContent = ''; b.className = ''; });
  await page.setInputFiles('#pdf-file', { name: name, mimeType: EPUB_MIME, buffer: bytes });
  await page.waitForFunction(() => { const b = document.getElementById('notice'); return b.classList.contains('error') || / yüklendi /.test(b.textContent); }, null, { timeout: time });  // turkish-ok: expected Turkish UI text
  return { card: await page.locator('#small-thumbs .card').count(), notice: (await page.textContent('#notice')) || '' };
}

const withSpaces = (s) => s.replace(/\s+/g, ' ').trim();

async function epubFlow(page, address, label) {
  const U = require('./epub-build.cjs');
  const tr = U.ready.trMini();

  // ---- A7 acceptance: italic/bold parts by class in the IR; no hidden paragraph ----
  await freshPage(page, address);
  const ir = await page.evaluate(([d]) => window.__e.ir(d, 'OEBPS/b1.xhtml'), [Array.from(tr)]);
  const part = ir.blocks.flatMap((b) => b.parts || []);
  check('A7', part.some((p) => p.italic && /eğik yazılmış/.test(p.text)) && part.some((p) => p.bold && /kalın yazılmış/.test(p.text)) && part.some((p) => p.bold && /sınıfla kalın/.test(p.text)),  // turkish-ok: expected Turkish UI text
    `${label}: the trMini IR has italic by class, <strong> and bold-by-class parts`);
  check('A7', !part.some((p) => /HIDDENTEXT/.test(p.text || '')) && ir.blocks.some((b) => b.kind === 'separator') && ir.blocks.some((b) => b.prefix === '•') && ir.blocks.some((b) => b.prefix === '2.'),
    `${label}: display:none is skipped, the @media rule is not applied; separator and list prefixes (• / 2.)`);
  check('A7', ir.counter.skippedImage === 1 && ir.counter.table === 1 && ir.blocks.filter((b) => b.kind === 'image').length === 2 && ir.cover === 'OEBPS/images/cover.png',
    `${label}: SVG skipped (1), table as plain text (1), PNG + GIF image blocks (2), cover cover-image`, JSON.stringify(ir.counter));

  // ---- B3 Turkish: load through the interface, cards = PDF pages ≥ 3; text exactly ----
  await page.selectOption('#binding-type', 'sewn');
  await page.fill('#paper-width', '297'); await page.fill('#paper-height', '210');
  await page.fill('#book-width', '148'); await page.fill('#book-height', '210');
  await page.fill('#signature-sheet', '4'); await page.fill('#outer-margin', '0'); await page.fill('#binding-allowance', '0');
  await page.selectOption('#scaling', 'fit'); await page.selectOption('#output-mode', 'single');
  const select = await pickEpub(page, 'tr-mini.epub', tr);
  const pdf0 = await page.evaluate(([d]) => window.__e.convert(d), [Array.from(tr)]);
  const s0 = await page.evaluate(([d]) => window.__e.inspect(d), [pdf0]);
  const text = withSpaces(s0.map((s) => s.elements.map((o) => o.str).join(' ')).join(' '));
  check('B3', select.card === s0.length && s0.length >= 3, `${label}: trMini card count = PDF page count ≥ 3`, `card ${select.card}, PDF ${s0.length}; notice: ${select.notice}`);
  check('B3', text.includes(U.B3_SENTENCE), `${label}: the Turkish sentence exactly in the pdf.js text`, text.includes(U.B3_SENTENCE) ? U.B3_SENTENCE : text.slice(0, 160));
  check('B3', !text.includes('�') && text.includes('İ') && text.includes('ı'), `${label}: no U+FFFD; İ = U+0130 and ı = U+0131 present`);  // turkish-ok: expected Turkish UI text
  check('B3', /Birinci Bölüm/.test(withSpaces(s0[0].elements.map((o) => o.str).join(' '))) && !text.includes('HIDDENTEXT') && s0.some((s) => /^NEWPAGE/.test(withSpaces(s.elements.map((o) => o.str).join(' ')))),  // turkish-ok: expected Turkish UI text
    `${label}: cover skipped (page 1 "Birinci Bölüm"), no hidden paragraph, page-break-before opened a new page`);  // turkish-ok: expected Turkish UI text
  const warning = await page.textContent('#epub-warning');
  check('B3', /1 resim atlandı \(SVG, bozuk ya da bilinmeyen biçim\), 1 tablo düz metne çevrildi, 2 resim 300 dpi altında\./.test(warning), `${label}: U1 warning`, warning.trim());  // turkish-ok: expected Turkish UI text
  // BD/O4: with a warning it is visible to the user (not hidden in the closed "EPUB settings" section)
  check('O4', await page.isVisible('#epub-warning .warning'), `${label}: the U1 warning is visible (isVisible('#epub-warning .warning'))`,
    `details open: ${await page.evaluate(() => document.getElementById('epub-settings').open)}`);

  // ---- B4 Vector: images only on the pages with images; Literata FontFile2; no Standard 14 ----
  const y = await page.evaluate(([d]) => window.__e.structure(d), [pdf0]);
  const withTextAll = s0.every((s) => s.elements.some((o) => o.str.trim()));
  check('B4', withTextAll && y.withImages.filter((n) => n > 0).length <= 2 && y.withImages.reduce((a, b) => a + b, 0) === 2 && y.withImages.filter((n) => n === 0).length >= s0.length - 2,
    `${label}: text on every page; Image XObject only on the 2 pages with images, not on the text pages`, JSON.stringify(y.withImages));
  const tip0 = y.fonts.filter((f) => f.subtype === '/Type0');
  check('B4', tip0.length > 0 && tip0.every((f) => /Literata/.test(f.name)) && y.definitions.length === tip0.length && y.definitions.every(Boolean) && !y.fonts.some((f) => f.subtype === '/Type1'),
    `${label}: the fonts are Literata (Type0 + FontFile2), no Standard 14`, JSON.stringify(tip0.map((f) => f.name)));

  // ---- B5 + B6: imposed output (gutter 0) → scale 1; sewn 297×210, 4 sheets per signature ----
  const lengths = [...new Set(s0.flatMap((s) => s.elements.filter((o) => o.str.trim()).map((o) => Math.abs(o.a))))];
  const scaleOne = (page) => page.elements.filter((o) => o.str.trim()).every((o) => lengths.some((b) => Math.abs(Math.abs(o.a) / b - 1) <= 0.001));
  check('B5', s0.every((s) => Math.abs(s.width - 148) <= 0.5 && Math.abs(s.height - 210) <= 0.5), `${label}: gutter 0 / outer 0 → every page 148×210 mm (±0.5)`, `${s0[0].width.toFixed(2)}×${s0[0].height.toFixed(2)}`);
  async function downloadImposed(expectedPage, size) {
    await page.waitForFunction(() => !document.getElementById('export-transfer').disabled);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-transfer')]);
    const output = await readFile(await download.path());
    await page.waitForSelector('#output-preview[data-ready="yes"]');
    const r = await page.evaluate(([d]) => window.__e.inspect(d), [Array.from(output)]);
    check('B6', /-dizilmis\.pdf$/.test(download.suggestedFilename()) && r.length === expectedPage && r.every((s) => Math.abs(s.width - 297) <= 0.5 && Math.abs(s.height - 210) <= 0.5),  // turkish-ok: expected Turkish UI text
      `${label}: ${size}: EPUB → sewn 297×210, 4 sheets per signature → ${download.suggestedFilename()}, ${expectedPage} pages, preview ready`, `${r.length} page`);
    const all = r.filter((s) => s.elements.some((o) => o.str.trim()));
    check('B5', all.length > 0 && all.every(scaleOne), `${label}: ${size}: scale 1 in the imposed output (text a factor ±0.001 with the source sizes)`,
      all.length ? JSON.stringify(all[0].elements.filter((o) => o.str.trim()).slice(0, 3).map((o) => +Math.abs(o.a).toFixed(4))) + ' / source ' + JSON.stringify(lengths.map((b) => +b.toFixed(4))) : 'no text');
  }
  await page.waitForFunction(() => document.querySelectorAll('#sheet-preview .sheet-card').length > 0);
  await downloadImposed(Math.ceil(select.card / 16) * 8, 'gutter 0');
  // the "choose again" warning when the size changes
  await page.fill('#binding-allowance', '10');
  await page.waitForSelector('#plugin-size-warning', { timeout: 5000 });
  check('B5', /EPUB bu ölçülerle dizilmişti/.test(await page.textContent('#plugin-size-warning')), `${label}: #plugin-size-warning shows when the gutter changes`);  // turkish-ok: expected Turkish UI text
  // load again with gutter 10 → page 138×210, imposed scale 1
  const picked10 = await pickEpub(page, 'tr-mini.epub', tr);
  await page.waitForTimeout(100);
  check('B5', (await page.locator('#plugin-size-warning').count()) === 0 && /138 × 210 mm/.test(await page.textContent('#source-info')),
    `${label}: loading again with gutter 10 removes the warning, source 138 × 210 mm`, await page.textContent('#source-info'));
  const s10 = await page.evaluate(async ([d]) => window.__e.inspect(await window.__e.convert(d, { gutter: 10 })), [Array.from(tr)]);
  check('B5', s10.every((s) => Math.abs(s.width - 138) <= 0.5 && Math.abs(s.height - 210) <= 0.5), `${label}: gutter 10 → every page 138×210 mm (±0.5)`, `${s10[0].width.toFixed(2)}×${s10[0].height.toFixed(2)}`);
  await downloadImposed(Math.ceil(picked10.card / 16) * 8, 'gutter 10');
  await page.fill('#binding-allowance', '0');

  // ---- enMini: EPUB 2 + NCX + &nbsp; (text/html fallback) ----
  await freshPage(page, address);
  const en = await pickEpub(page, 'en-mini.epub', U.ready.enMini());
  const enText = withSpaces((await page.evaluate(async ([d]) => window.__e.inspect(await window.__e.convert(d)), [Array.from(U.ready.enMini())])).map((s) => s.elements.map((o) => o.str).join(' ')).join(' '));
  check('A7', en.card >= 1 && /Hello world, this is an English paragraph/.test(enText), `${label}: enMini (EPUB 2, NCX, &nbsp; without a DTD) converts without errors`, `card ${en.card}; ${enText.slice(0, 60)}`);

  // ---- B7 DRM / fontHidden, B8 FXL, B9 broken / noContainer ----
  const errorState = async (criterion, name, bytes, message) => {
    await freshPage(page, address);
    const r = await pickEpub(page, name, bytes);
    const closed = await page.isDisabled('#export-transfer');
    check(criterion, r.notice.includes(message) && r.card === 0 && closed, `${label}: ${name}: Turkish message, 0 cards, download disabled`, r.notice);
  };
  await errorState('B7', 'drm.epub', U.ready.drm(), E_MESSAGE.E3);
  await freshPage(page, address);
  const fg = await pickEpub(page, 'font-hidden.epub', U.ready.fontHidden());
  check('B7', fg.card >= 3 && !/açılamadı/.test(fg.notice), `${label}: font-hidden.epub (font obfuscation only) does not count as DRM, converts`, `card ${fg.card}; ${fg.notice}`);  // turkish-ok: expected Turkish UI text
  await errorState('B8', 'fxl.epub', U.ready.fxl(), E_MESSAGE.E4);
  await errorState('B9', 'broken.epub', U.ready.corrupt(), E_MESSAGE.E1);
  await errorState('B9', 'no-container.epub', U.ready.noContainer(), E_MESSAGE.E2);
}

// ------------------------------------------------------------------
// EPUB fix tests (encoding included), in both runs
// ------------------------------------------------------------------
// a PNG with a valid header (IHDR) and a broken IDAT
const CORRUPT_PNG = Buffer.from('89504E470D0A1A0A0000000D49484452000000100000001008020000009091683600000010494441547801DEADBEEFDEADBEEFDEADBEEF00000000', 'hex');
// windows-1254 single byte codes (Turkish letters)
const W1254 = { 'ğ': 0xf0, 'ı': 0xfd, 'İ': 0xdd, 'Ö': 0xd6, 'Ğ': 0xd0, 'Ü': 0xdc, 'Ş': 0xde, 'Ç': 0xc7, 'ü': 0xfc, 'ş': 0xfe, 'ö': 0xf6, 'ç': 0xe7 };  // turkish-ok: expected Turkish UI text
function w1254(s) { return Buffer.from([...s].map((c) => (W1254[c] !== undefined ? W1254[c] : c.charCodeAt(0)))); }

async function bdFlow(page, address, label) {
  const U = require('./epub-build.cjs');
  const paragraph = (n) => `<p>${U.paragraphText(U.random(n), 60)}</p>`;

  // ---- O3: an EPUB with a broken PNG converts; 1 image skipped in U1; no font warning ----
  const corruptEpub = U.epub({ title: 'Broken Image', sections: [{ name: 'b.xhtml', xhtml: U.xhtml('<h1>Chapter with an image</h1>' + paragraph(1) + '<p><img src="r/broken.png" alt="corrupt"/></p>' + paragraph(2)) }],
    files: { 'r/broken.png': CORRUPT_PNG } });
  await freshPage(page, address);
  const o3 = await pickEpub(page, 'broken-image.epub', corruptEpub);
  const u3 = (await page.textContent('#epub-warning')).trim();
  check('O3', o3.card >= 1 && !/açılamadı/.test(o3.notice), `${label}: an EPUB with a broken PNG converts (cards ≥ 1, no error)`, `card ${o3.card}; ${o3.notice}`);  // turkish-ok: expected Turkish UI text
  check('O3', /^1 resim atlandı/.test(u3) && !/Yazı tipi/.test(u3) && !/Cannot|undefined/.test(o3.notice + u3), `${label}: U1 "1 resim atlandı", no font warning and no raw English error`, u3);  // turkish-ok: expected Turkish UI text

  // ---- D4: the EPUB warning is cleared on a new (PDF) load; a stale (slow) conversion result is dropped ----
  await setupHelpers(page);
  await pickEpub(page, 'tr-mini.epub', U.ready.trMini()); // an EPUB that gives a U1 warning (1 SVG, 1 table)
  const onceWarning = (await page.textContent('#epub-warning')).trim();
  const pdf8 = Buffer.from(await page.evaluate(async () => Array.from(await window.__t.numberedPdf(8))));
  await page.setInputFiles('#pdf-file', { name: 'eight.pdf', mimeType: 'application/pdf', buffer: pdf8 });
  await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 8);
  const restWarning = (await page.textContent('#epub-warning')).trim();
  check('D4', onceWarning !== '' && restWarning === '', `${label}: loading a PDF after an EPUB clears the old EPUB warning`, `before: ${onceWarning.slice(0, 40) || '(empty)'}; after: ${restWarning || '(empty)'}`);
  await page.evaluate(async () => {
    const pdf3 = await window.__t.numberedPdf(3);
    window.__slow = { current: 'not called' };
    window.Mucellit.plugins.register({ name: 'Slow trial', extensions: ['.slow'], convert: async (f, s) => {
      await new Promise((ok) => setTimeout(ok, 1500));
      window.__slow.current = s.isCurrent ? s.isCurrent() : 'no isCurrent';
      return pdf3;
    } });
  });
  await page.setInputFiles('#pdf-file', { name: 'a.slow', mimeType: 'application/octet-stream', buffer: Buffer.from('slow') });
  await page.setInputFiles('#pdf-file', { name: 'new-eight.pdf', mimeType: 'application/pdf', buffer: pdf8 });
  await page.waitForFunction(() => /new-eight\.pdf/.test(document.getElementById('source-info').textContent));
  await page.waitForFunction(() => window.__slow.current !== 'not called', null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const d4 = { card: await page.locator('#small-thumbs .card').count(), info: await page.textContent('#source-info'), current: await page.evaluate(() => window.__slow.current) };
  check('D4', d4.card === 8 && /new-eight\.pdf/.test(d4.info) && d4.current === false, `${label}: the PDF chosen while a slow conversion runs stays; the stale result is dropped (isCurrent false)`, JSON.stringify(d4));

  // ---- D5: no script/style/hidden text in a table cell; a nested table row is not repeated; the inline cache is limited ----
  const tableX = U.xhtml('<h1>Table</h1><table>' +
    '<tr><td>OUT1<script>BADSCRIPT()</script><style>.k{}</style><span style="display:none">HIDDENSTYLE</span><span hidden="hidden">HIDDENATTR</span></td><td>OUT2</td></tr>' +
    '<tr><td><table><tr><td>IN1</td><td>IN2</td></tr></table></td><td>OUT3</td></tr></table>' +
    Array.from({ length: 2600 }, (_, i) => `<span style="margin-left: ${i}px">s${i} </span>`).join(''));
  const tableEpub = U.epub({ sections: [{ name: 't.xhtml', xhtml: tableX }] });
  const ir5 = await page.evaluate(([d]) => window.__e.ir(d, 'OEBPS/t.xhtml'), [Array.from(tableEpub)]);
  const text5 = ir5.blocks.flatMap((b) => (b.parts || []).map((p) => p.text || '')).join(' | ');
  const in1 = (text5.match(/IN1/g) || []).length;
  check('D5', !/BADSCRIPT|HIDDENSTYLE|HIDDENATTR|\.k\{/.test(text5) && /OUT1/.test(text5) && in1 === 1 && /IN2/.test(text5) && /OUT3/.test(text5),
    `${label}: no script/style/hidden element in a table cell; a nested table row once`, `IN1 ${in1} times; ${text5.slice(0, 120)}`);
  check('D5', typeof ir5.inline === 'number' && ir5.inline > 0 && ir5.inline <= 2000, `${label}: the inline style cache is per conversion and ≤ 2000 entries (2600 different styles)`, String(ir5.inline));

  // ---- Encoding: XHTML declared windows-1254 is decoded right; an unsupported encoding is reported in U1 ----
  const trSentence = 'Iğdır ılık İstanbul; ÖĞÜŞÇ ğüşıöçİ';  // turkish-ok: expected Turkish UI text
  const xhtml1254 = (code) => Buffer.concat([Buffer.from(`<?xml version="1.0" encoding="${code}"?>\n<html xmlns="${U.NS.xhtml}" xml:lang="tr"><head><title>K</title></head><body><h1>Encoding</h1><p>`), w1254(trSentence), Buffer.from('</p></body></html>')]);
  const codeEpub = U.epub({ sections: [{ name: 'k.xhtml', xhtml: xhtml1254('windows-1254') }] });
  const irK = await page.evaluate(([d]) => window.__e.ir(d, 'OEBPS/k.xhtml'), [Array.from(codeEpub)]);
  const textK = irK.blocks.flatMap((b) => (b.parts || []).map((p) => p.text || '')).join(' ');
  check('CODE', textK.includes(trSentence) && !textK.includes('�'), `${label}: XHTML declared windows-1254 is decoded with Turkish letters`, textK.slice(0, 80));
  const noCode = U.epub({ sections: [{ name: 'k.xhtml', xhtml: xhtml1254('x-unknown-code') }] });
  await freshPage(page, address);
  const ky = await pickEpub(page, 'encoding.epub', noCode);
  const uK = (await page.textContent('#epub-warning')).trim();
  check('CODE', ky.card >= 1 && /Desteklenmeyen karakter kodlaması \(x-unknown-code\)/.test(uK) && await page.isVisible('#epub-warning .warning'),  // turkish-ok: expected Turkish UI text
    `${label}: an unsupported encoding is reported in U1 (visible)`, uK);

  // ---- Item 13: a faulty file after a successful load → the earlier document is cleared, download disabled (EPUB and PDF) ----
  const pickFile = async (name, mime, bytes) => {
    await page.evaluate(() => { const b = document.getElementById('notice'); b.textContent = ''; b.className = ''; });
    await page.setInputFiles('#pdf-file', { name: name, mimeType: mime, buffer: bytes });
    await page.waitForFunction(() => { const b = document.getElementById('notice'); return b.classList.contains('error') || / yüklendi /.test(b.textContent); }, null, { timeout: 90000 });  // turkish-ok: expected Turkish UI text
    await page.waitForTimeout(150); // update() draws with requestAnimationFrame
    return { card: await page.locator('#small-thumbs .card').count(), notice: (await page.textContent('#notice')) || '',
      closed: await page.isDisabled('#export-transfer'), warning: (await page.textContent('#epub-warning')).trim(), info: await page.textContent('#source-info') };
  };
  const setupSize = async () => {
    await page.selectOption('#binding-type', 'sewn');
    await page.fill('#paper-width', '297'); await page.fill('#paper-height', '210');
    await page.fill('#book-width', '148'); await page.fill('#book-height', '210');
    await page.fill('#signature-sheet', '4'); await page.fill('#outer-margin', '0'); await page.fill('#binding-allowance', '0');
  };
  await freshPage(page, address);
  await setupSize();
  const goodE = await pickFile('tr-mini.epub', EPUB_MIME, U.ready.trMini());
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled, null, { timeout: 20000 });
  const badE = await pickFile('broken.epub', EPUB_MIME, U.ready.corrupt());
  check('file-error', goodE.card >= 3 && badE.card === 0 && badE.closed && badE.notice.includes(E_MESSAGE.E1) && badE.warning === '' && /açılamadı/.test(badE.info),  // turkish-ok: expected Turkish UI text
    `${label}: trMini → broken.epub: 0 cards, download disabled, Turkish E1, EPUB warning clean`, JSON.stringify({ once: goodE.card, card: badE.card, closed: badE.closed, notice: badE.notice, warning: badE.warning, info: badE.info }));
  await setupHelpers(page);
  const goodP = await pickFile('eight.pdf', 'application/pdf', Buffer.from(await page.evaluate(async () => Array.from(await window.__t.numberedPdf(8)))));
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled, null, { timeout: 20000 });
  const corruptPdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 37 + 11) % 256))]);
  const badP = await pickFile('broken.pdf', 'application/pdf', corruptPdf);
  check('file-error', goodP.card === 8 && badP.card === 0 && badP.closed && /^Dosya açılamadı: dosya bozuk/.test(badP.notice) && !/Invalid|structure|Error/i.test(badP.notice),  // turkish-ok: expected Turkish UI text
    `${label}: valid PDF → broken PDF: 0 cards, download disabled, Turkish error`, JSON.stringify({ once: goodP.card, card: badP.card, closed: badP.closed, notice: badP.notice }));
}

async function epubPerformance(page, address, label) {
  const U = require('./epub-build.cjs');
  const long = U.ready.long();
  await freshPage(page, address);
  // no size left in localStorage from the earlier flow: A5, gutter and outer margin 0
  await page.fill('#book-width', '148'); await page.fill('#book-height', '210'); await page.fill('#outer-margin', '0'); await page.fill('#binding-allowance', '0');
  const head = Date.now();
  const r = await pickEpub(page, 'long.epub', long, 120000);
  const sure = (Date.now() - head) / 1000;
  console.log(`info: ${label}: long.epub (~90 000 words, ${long.length} bytes) conversion ${sure.toFixed(1)} s, ${r.card} page`);
  check('B14', r.card > 100 && sure < 60, `${label}: long.epub (~90 thousand words) conversion < 60 s`, `${sure.toFixed(1)} s, ${r.card} page; ${r.notice}`);
}

function agCheck(iz, localPrefix, label, criterion) {
  const out = iz.requests.filter((u) => !(u.startsWith(localPrefix) || u.startsWith('data:') || u.startsWith('blob:')));
  // every request other than file:// and the local server (http/https included) is not allowed
  check(criterion, out.length === 0, `${label}: no outside network request (only local requests)`,
    out.length ? JSON.stringify([...new Set(out)]) : `${iz.requests.length} requests, all local`);
}

// ------------------------------------------------------------------
// confirm pass: Tauri's dialog plug-in overrides window.confirm with a function that returns a Promise;
// the old `if (!confirm(...)) return;` pattern took the Promise as "yes" and deleted without asking. For every action:
// (a) native confirm "no" (dialog.dismiss), (b) a Tauri-like async confirm → false; the data does not change in either.
// ------------------------------------------------------------------
async function confirmFlow(page, address, iz, label) {
  const O = 'G5';
  const os = await import('node:os');
  const fsp = await import('node:fs/promises');
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.evaluate(() => { localStorage.removeItem('mucellit.projects'); localStorage.removeItem('mucellit.selectedProject'); });
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-projects');
  for (const name of ['Confirm One', 'Confirm Two']) {
    await page.fill('#yk-name', name);
    await page.selectOption('#yk-kind', 'sewn');
    await page.click('#yk-create');
    await page.waitForFunction((a) => document.querySelector('#book-detail h2') && document.querySelector('#book-detail h2').textContent === a, name);
  }
  const first = await readStorage(page);
  check(O, first && first.projects.length === 2, `${label}: confirm set-up: 2 projects`, first && first.projects.length);
  const backupPath = join(await fsp.mkdtemp(join(os.tmpdir(), 'mc-confirmation-')), 'backup.json');
  await fsp.writeFile(backupPath, JSON.stringify(Object.assign({}, first, { projects: [first.projects[0]] })));

  const asyncConfirm = (response) => page.evaluate((y) => {
    window.__originalConfirm = window.__originalConfirm || window.confirm;
    window.__confirmCounter = 0;
    window.confirm = async function () { window.__confirmCounter += 1; return y; };
  }, response);
  const localConfirm = () => page.evaluate(() => { if (window.__originalConfirm) window.confirm = window.__originalConfirm; });
  const calm = () => page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
  const stepCount = () => page.locator('#steps .step').count();

  // every action: trigger() → compare the data before/after
  const operations = [
    { name: 'Kitabı sil', trigger: () => page.click('#book-remove') },  // turkish-ok: expected Turkish UI text
    { name: 'Adımı çıkar', trigger: () => page.locator('#steps .step-remove').first().click() },  // turkish-ok: expected Turkish UI text
    { name: 'Tümünü temizle', trigger: () => page.click('#data-clear') },  // turkish-ok: expected Turkish UI text
    { name: 'İçe aktar (değiştir)', trigger: () => page.setInputFiles('#json-import', backupPath) },  // turkish-ok: expected Turkish UI text
  ];
  for (const is of operations) {
    // (a) native confirm "no"
    const once = await readStorage(page);
    const stepOnce = await stepCount();
    iz.confirms.length = 0;
    iz.confirmRed = true;
    await is.trigger();
    for (let i = 0; i < 50 && iz.confirms.length === 0; i++) await calm();
    await calm();
    iz.confirmRed = false;
    const afterA = await readStorage(page);
    check(O, iz.confirms.length === 1 && isDeepStrictEqual(afterA, once) && (await stepCount()) === stepOnce,
      `${label}: ${is.name}: native confirm "no" → data unchanged`, `confirmation penceresi ${iz.confirms.length}, projects ${afterA && afterA.projects.length}`);
    // (b) like the Tauri dialog plug-in: confirm returns Promise<false>
    await asyncConfirm(false);
    await is.trigger();
    await page.waitForFunction(() => window.__confirmCounter > 0, null, { timeout: 10000 }).catch(() => {});
    await calm();
    const counter = await page.evaluate(() => window.__confirmCounter);
    await localConfirm();
    const afterB = await readStorage(page);
    check(O, counter === 1 && isDeepStrictEqual(afterB, once) && (await stepCount()) === stepOnce,
      `${label}: ${is.name}: a confirm returning a Promise "no" (Tauri-like) → data unchanged`, `confirm calls ${counter}, projects ${afterB && afterB.projects.length}`);
  }

  // "yes" paths: with async true the project is removed; with a native "yes" the import replaces
  const selected = await page.textContent('#book-detail h2');
  await asyncConfirm(true);
  await page.click('#book-remove');
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 1, null, { timeout: 10000 }).catch(() => {});
  await localConfirm();
  const remove = await readStorage(page);
  check(O, remove.projects.length === 1 && remove.projects[0].name !== selected, `${label}: Remove project: a confirm returning a Promise "yes" → the selected project was removed`, `${selected}; left ${remove.projects.map((k) => k.name).join(', ')}`);
  const backup2 = join(dirname(backupPath), 'backup2.json');
  await fsp.writeFile(backup2, JSON.stringify(first));
  iz.confirms.length = 0;
  await page.setInputFiles('#json-import', backup2);
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 2, null, { timeout: 10000 }).catch(() => {});
  const importData = await readStorage(page);
  check(O, iz.confirms.length === 1 && isDeepStrictEqual(importData, first), `${label}: Import: native confirm "yes" → the data changed with the backup`, `confirmation penceresi ${iz.confirms.length}, projects ${importData.projects.length}`);

  // D9: Remove step "yes" (a confirm returning a Promise, Tauri-like) → the first step of the selected project is removed
  const stepBook = await page.textContent('#book-detail h2');
  const stepOnce = await stepCount();
  const stepNames = (v) => (v.projects.find((k) => k.name === stepBook) || { steps: [] }).steps.map((a) => a.name);
  const firstStep = stepNames(await readStorage(page));
  await asyncConfirm(true);
  await page.locator('#steps .step-remove').first().click();
  await page.waitForFunction((n) => document.querySelectorAll('#steps .step').length === n - 1, stepOnce, { timeout: 10000 }).catch(() => {});
  const stepCounter = await page.evaluate(() => window.__confirmCounter);
  await localConfirm();
  const nextStep = stepNames(await readStorage(page));
  check('confirmation', stepCounter === 1 && (await stepCount()) === stepOnce - 1 && isDeepStrictEqual(nextStep, firstStep.slice(1)),
    `${label}: Remove step: a confirm returning a Promise "yes" → the first step was removed`, `confirm calls ${stepCounter}, steps ${stepOnce} → ${await stepCount()}`);

  // D9: Clear all native confirm "yes" → all the Projects data is removed
  iz.confirms.length = 0;
  await page.click('#data-clear');
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 0, null, { timeout: 10000 }).catch(() => {});
  const clean = await readStorage(page);
  check('confirmation', iz.confirms.length === 1 && (!clean || clean.projects.length === 0) && (await page.locator('#book-list li').count()) === 0,
    `${label}: Clear all: native confirm "yes" → all projects removed`, `confirmation penceresi ${iz.confirms.length}, projects ${clean ? clean.projects.length : 0}`);
  await fsp.rm(dirname(backupPath), { recursive: true, force: true });
}

// dropping a file on the page opens the PDF and does not leave the page; dragging inside the grid works.
async function releaseFlow(page, address, label) {
  const O = 'G8';
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-projects');
  const pdf = await makeTestPdf(page);
  const result = await page.evaluate((array) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(array)], 'drop.pdf', { type: 'application/pdf' }));
    const target = document.querySelector('main') || document.body;
    const ov = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
    target.dispatchEvent(ov);
    const dr = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    target.dispatchEvent(dr);
    return { ov: ov.defaultPrevented, dr: dr.defaultPrevented };
  }, Array.from(pdf));
  await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 37, null, { timeout: 30000 }).catch(() => {});
  const card = await page.locator('#small-thumbs .card').count();
  const info = (await page.textContent('#source-info')) || '';
  const tab = await page.getAttribute('#tab-button-impose', 'aria-selected');
  check(O, result.ov && result.dr && card === 37 && /drop\.pdf/.test(info) && tab === 'true' && page.url() === address,
    `${label}: the PDF dropped on the page opened, moved to the Imposition tab, did not leave the page`, JSON.stringify({ result, card, tab, info: info.slice(0, 60) }));

  // dragging inside the grid: drop card 1 on the right half of card 3 → order 2, 3, 1, 4…
  const sourceOrder = () => page.$$eval('#small-thumbs .card', (l) => l.slice(0, 4).map((k) => k.getAttribute('data-id')));
  const once = await sourceOrder();
  const target = page.locator('#small-thumbs .card').nth(2);
  const box = await target.boundingBox();
  await page.locator('#small-thumbs .card').nth(0).dragTo(target, { targetPosition: { x: Math.round(box.width * 0.8), y: Math.round(box.height / 2) } });
  await page.waitForTimeout(200);
  const after = await sourceOrder();
  check(O, JSON.stringify(after.slice(0, 3)) === JSON.stringify([once[1], once[2], once[0]]),
    `${label}: dragging inside the grid (page 1 → behind page 3) works, the file drop handler does not interfere`, JSON.stringify({ once, after }));
}

// ------------------------------------------------------------------
// CSP and freezing Object.prototype; the platform.pickFile result on import.
// ------------------------------------------------------------------
async function m1FixFlow(page, address, iz, label, cspTest) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const rotated = await page.evaluate(() => ({ rotated: Object.isFrozen(Object.prototype), pdfLib: !!window.PDFLib, pdfjs: !!window.pdfjsLib }));
  check('security', rotated.rotated && rotated.pdfLib && rotated.pdfjs, `${label}: Object.prototype frozen, pdf-lib and pdf.js loaded`, JSON.stringify(rotated));

  if (cspTest) {
    // A separate tab: the CSP must reject the fetch without reaching the network. Safety net: the example.com request is cut in Playwright
    // (without a CSP the fetch is still rejected but there is no violation event → FAIL; no request reaches the real network).
    const p2 = await page.context().newPage();
    let cut = 0;
    await p2.route('https://example.com/**', (r) => { cut += 1; return r.abort(); });
    await p2.goto(address);
    await p2.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
    const s = await p2.evaluate(async () => {
      let violation = null;
      document.addEventListener('securitypolicyviolation', (e) => { violation = violation || e.violatedDirective; });
      let rejected = false;
      try { await fetch('https://example.com/'); } catch { rejected = true; }
      await new Promise((r) => setTimeout(r, 200));
      return { rejected, violation };
    });
    await p2.close();
    check('security', s.rejected && /^connect-src/.test(s.violation || '') && cut === 0,
      `${label}: CSP active: fetch('https://example.com') rejected by connect-src, the request did not reach the network`, JSON.stringify({ ...s, cut, csp: TAURI_CSP ? 'var' : 'none' }));
  }

  // O4: when pickFile returns a File (native dialog) the import works; when it is rejected a notice, no unhandled rejection.
  await page.evaluate(() => { localStorage.removeItem('mucellit.projects'); localStorage.removeItem('mucellit.selectedProject'); });
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-projects');
  await page.fill('#yk-name', 'Picker Book');
  await page.selectOption('#yk-kind', 'sewn');
  await page.click('#yk-create');
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 1);
  const backup = await readStorage(page);
  await page.evaluate(() => { localStorage.removeItem('mucellit.projects'); localStorage.removeItem('mucellit.selectedProject'); });
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-projects');
  const errorOnce = iz.errors.length;
  await page.evaluate((json) => {
    const P = window.Mucellit.platform;
    window.__selectOriginalFile = P.pickFile;
    window.__choiceCounter = 0;
    P.pickFile = function () { window.__choiceCounter += 1; return Promise.resolve(new File([json], 'backup.json', { type: 'application/json' })); };
  }, JSON.stringify(backup));
  await page.click('#json-import-button');
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 1, null, { timeout: 10000 }).catch(() => {});
  const importData = await readStorage(page);
  const picks1 = await page.evaluate(() => window.__choiceCounter);
  check('import-transfer', picks1 === 1 && isDeepStrictEqual(importData, backup), `${label}: import: when pickFile returns a File the backup is imported`,
    `picker ${picks1}, projects ${importData ? importData.projects.length : 0}`);

  await page.evaluate(() => { window.Mucellit.platform.pickFile = function () { return Promise.reject(new Error('picker could not open')); }; });
  await page.click('#json-import-button');
  await page.waitForFunction(() => /İçe aktarılamadı: picker could not open/.test(document.getElementById('notice').textContent), null, { timeout: 5000 }).catch(() => {});  // turkish-ok: expected Turkish UI text
  await page.waitForTimeout(150);
  const notice = await page.textContent('#notice');
  const after = await readStorage(page);
  check('import-transfer', /İçe aktarılamadı: picker could not open/.test(notice) && iz.errors.length === errorOnce && isDeepStrictEqual(after, backup),  // turkish-ok: expected Turkish UI text
    `${label}: import: a pickFile rejection goes to a notice, no unhandled error, data unchanged`, `notice: ${notice}; new console errors ${iz.errors.length - errorOnce}`);
  await page.evaluate(() => { window.Mucellit.platform.pickFile = window.__selectOriginalFile; });
}

// ------------------------------------------------------------------
// the browser's compression of a folder package EPUB ("<name>.epub.zip"; Safari/WebKit gives an Apple Books folder package
// like this): the single top folder prefix is dropped, the content is handled like an ordinary EPUB. In both runs.
// ------------------------------------------------------------------
async function prefixedEpubZip(U, epubBytes, prefix, suffixes) {
  const Z = require('../js/plugins/epub/zip.js');
  const z = Z.read(new Uint8Array(epubBytes));
  const g = [];
  for (const a of z.names()) g.push({ name: prefix + a, data: Buffer.from(await z.open(a)), method: 8 }); // WebKit: all deflated
  return U.makeZip([{ name: prefix, data: '', method: 0 }].concat(g, suffixes || []));
}

function folderFixtureZip(U, prefix) {
  const root = join(HERE, 'fixtures', 'folder-package.epub');
  const names = [];
  (function walk(d, on) {
    for (const g of readdirSync(d, { withFileTypes: true })) {
      if (g.name.startsWith('.')) continue;
      if (g.isDirectory()) walk(join(d, g.name), on + g.name + '/'); else names.push(on + g.name);
    }
  })(root, '');
  names.sort();
  return U.makeZip(names.map((a) => ({ name: prefix + a, data: readFileSync(join(root, ...a.split('/'))), method: 8 })));
}

async function m2EpubZipFlow(page, address, label) {
  const U = require('./epub-build.cjs');
  await freshPage(page, address);
  await page.selectOption('#binding-type', 'sewn');
  const tr = U.ready.trMini();
  const expected = (await page.evaluate(async ([d]) => window.__e.inspect(await window.__e.convert(d)), [Array.from(tr)])).length;
  const zipped = await prefixedEpubZip(U, tr, 'tr-mini.epub/', [
    { name: '__MACOSX/tr-mini.epub/._mimetype', data: 'x' },
    { name: 'tr-mini.epub/.DS_Store', data: 'x' },
  ]);
  await page.evaluate(() => { const b = document.getElementById('notice'); b.textContent = ''; b.className = ''; });
  await page.setInputFiles('#pdf-file', { name: 'tr-mini.epub.zip', mimeType: 'application/zip', buffer: zipped });
  await page.waitForFunction(() => { const b = document.getElementById('notice'); return b.classList.contains('error') || / yüklendi /.test(b.textContent); }, null, { timeout: 90000 });  // turkish-ok: expected Turkish UI text
  const card = await page.locator('#small-thumbs .card').count();
  const notice = (await page.textContent('#notice')) || '';
  const info = (await page.textContent('#source-info')) || '';
  check('file', card === expected && expected >= 3 && /^tr-mini\.pdf yüklendi/.test(notice) && /^tr-mini\.pdf — /.test(info),  // turkish-ok: expected Turkish UI text
    `${label}: .epub.zip (one top folder, deflate, __MACOSX + .DS_Store) converts like an ordinary EPUB; name tr-mini.pdf`, `card ${card}/${expected}; ${notice}; ${info}`);
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-transfer')]);
  check('file', download.suggestedFilename() === 'tr-mini-dizilmis.pdf', `${label}: the imposed output name from .epub.zip is tr-mini-dizilmis.pdf (".epub.zip" dropped)`, download.suggestedFilename());  // turkish-ok: expected Turkish UI text

  // the repository fixture (a synthetic folder package) as a folder ZIP: converts, the text is in the PDF
  const fz = folderFixtureZip(U, 'folder-package.epub/');
  const text = await page.evaluate(async ([d]) => {
    const f = new File([new Uint8Array(d)], 'folder-package.epub.zip', { type: 'application/zip' });
    const pdf = await window.Mucellit.epub.convert(f, { bookWidth: 148, bookHeight: 210, gutter: 0, outerMargin: 0 });
    return (await window.__e.inspect(Array.from(pdf))).map((s) => s.elements.map((o) => o.str).join(' ')).join(' ');
  }, [Array.from(fz)]).then(withSpaces);
  check('file', /KLASORPAKETI/.test(text) && /Birinci Bölüm/.test(text) && !text.includes('�'),  // turkish-ok: expected Turkish UI text
    `${label}: app/test/fixtures/folder-package.epub (folder ZIP) converts; the text of both chapters is in the PDF`,
    JSON.stringify({ mark: /KLASORPAKETI/.test(text), chapter: /Birinci Bölüm/.test(text), fffd: text.includes('�'), head: text.slice(0, 60) }));  // turkish-ok: expected Turkish UI text

  // faulty: two top folders → the prefix is not dropped → E2 (no container); 0 cards, download disabled
  await freshPage(page, address);
  const two = await prefixedEpubZip(U, tr, 'A.epub/', [{ name: 'B/okubeni.txt', data: 'x' }]);
  const r = await pickEpub(page, 'two-folders.epub.zip', two);
  check('file', r.notice.includes(E_MESSAGE.E2) && r.card === 0 && await page.isDisabled('#export-transfer'),
    `${label}: .epub.zip with two top folders: E2 Turkish message, 0 cards, download disabled`, r.notice);
}

// ------------------------------------------------------------------
// Tauri simulation: platform-tauri.js runs on the real page with a fake window.__TAURI__ (init script).
// The imposed PDF and the JSON backup go through the native Save dialog (fake save_file): "not saved" on cancel,
// the real path when written; no browser download ever starts. At start-up the automatic backup is restored; changes are backed up.
// ------------------------------------------------------------------
const FAKE_TAURI = `(() => {
  const record = (window.__fake = { call: [], saveResponse: null, saveOrder: null, saveError: null, saveGate: null,
    backup: sessionStorage.getItem('fakeBackup') || '{"version":2,"projects":[]}', listener: {}, openResponse: null, table: {}, pending: [] });
  const bytes = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
  // Rust's initialization_script (i18n::init_script): the system language before the page scripts
  Object.defineProperty(window, '__MC_LANG__', { value: Object.freeze({ system: sessionStorage.getItem('fakeSystem') || 'tr' }) });
  window.__TAURI__ = {
    core: { invoke: async (command, arg, options) => {
      record.call.push({ command, name: options && options.headers ? decodeURIComponent(options.headers['x-name']) : null,
        kind: options && options.headers ? options.headers['x-kind'] : null, size: arg && arg.byteLength, json: arg && arg.json,
        purpose: arg && arg.purpose, id: arg && arg.id, session: arg && arg.session, order: arg && arg.order, time: Date.now() });
      if (command === 'save_file') {
        if (record.saveGate) await record.saveGate;
        if (record.saveError) throw record.saveError;
        const y = record.saveOrder ? record.saveOrder.shift() : record.saveResponse;
        return y ? { name: y.split('/').pop(), path: y } : null;
      }
      // printing (Rust print: true = printed, false = cancelled; a string/Error = a Rust error) and Open in Preview
      if (command === 'print') {
        record.call[record.call.length - 1].noteAtPrint = (document.getElementById('notice') || {}).textContent;
        if (record.printGate) await record.printGate;
        const y = record.printOrder && record.printOrder.length ? record.printOrder.shift() : true;
        if (typeof y !== 'boolean') throw y;
        return y;
      }
      if (command === 'open_in_preview') {
        const y = record.previewOrder && record.previewOrder.length ? record.previewOrder.shift() : null;
        if (y) throw y;
        return decodeURIComponent(options.headers['x-name']);
      }
      if (command === 'open_file') return record.openResponse;
      if (command === 'read_file') {
        const b = record.table[arg.id];
        delete record.table[arg.id]; // a single use id, as in Rust
        if (!b) throw 'UNKNOWN: no file opened with this id';
        return bytes(b);
      }
      if (command === 'read_backup') return record.backup;
      if (command === 'backup_data') { record.lastBackup = arg.json; return null; }
      if (command === 'pending_opens') { const k = record.pending; record.pending = []; return k; }
      if (command === 'recent_files') return [];
      // system: the system language Rust finds with NSLocale + the Apple rule (default tr in the simulation = a tr-TR browser)
      // the interface language at the time of read_language (the first frame, before Rust's decision arrives)
      if (command === 'read_language' && !record.firstFrame) record.firstFrame = { lang: document.documentElement.lang, tab: (document.getElementById('tab-button-impose') || {}).textContent };
      if (command === 'read_language') return { code: sessionStorage.getItem('fakeI18nCode') || 'tr', choice: sessionStorage.getItem('fakeI18nChoice') || 'system', system: sessionStorage.getItem('fakeSystem') || 'tr' };
      if (command === 'set_language') {
        record.i18nSettings = (record.i18nSettings || []).concat([[arg.code, arg.choice]]);
        sessionStorage.setItem('fakeI18nCode', arg.code);
        if (arg.choice === 'system') sessionStorage.removeItem('fakeI18nChoice'); else sessionStorage.setItem('fakeI18nChoice', arg.choice);
        return null;
      }
      throw new Error('unexpected command: ' + command);
    } },
    event: { listen: async (name, f) => { record.listener[name] = f; return () => {}; } },
    // native confirmation (dialog plug-in): the question is recorded; the answer from askOrder (yes when missing)
    dialog: { ask: async (m) => { (record.questions = record.questions || []).push(m); return record.askOrder && record.askOrder.length ? record.askOrder.shift() : true; } },
  };
})();`;

async function m2TauriSimulation(page, address, label) {
  await page.addInitScript({ content: FAKE_TAURI });
  const clearNotice = () => page.evaluate(() => { const b = document.getElementById('notice'); b.textContent = ''; b.className = ''; });
  // O2: localStorage empty + backup empty (after a deliberate clean-up): not restored, no "restored" notice
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.waitForTimeout(500);
  const blank = await page.evaluate(() => ({ name: window.Mucellit.platform.name, button: document.getElementById('export-transfer').textContent,
    ls: localStorage.getItem('mucellit.projects'), notice: document.getElementById('notice').textContent }));
  check('file', blank.name === 'tauri' && blank.button === "Dizilmiş PDF'i kaydet…" && blank.ls === null && !/geri yüklendi/.test(blank.notice),  // turkish-ok: expected Turkish UI text
    `${label}: platform tauri; Save button text; an EMPTY backup was not restored, no "restored" notice (O2)`, JSON.stringify(blank));
  // filled backup, empty localStorage: restored and reported
  const filledBackup = JSON.stringify({ version: 2, projects: [{ id: 'k-restored', name: 'Restored Book', bindingType: 'single', steps: [] }] });
  await page.evaluate((y) => { sessionStorage.setItem('fakeBackup', y); localStorage.clear(); }, filledBackup);
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const startup = await page.evaluate(() => localStorage.getItem('mucellit.projects'));
  check('file', startup === filledBackup, `${label}: an empty localStorage was restored from the filled automatic backup`, String(startup));
  await page.waitForFunction(() => /otomatik yedekten geri yüklendi/.test(document.getElementById('notice').textContent), null, { timeout: 5000 })  // turkish-ok: expected Turkish UI text
    .then(() => check('file', true, `${label}: the "otomatik yedekten geri yüklendi" notice`), () => check('file', false, `${label}: the "otomatik yedekten geri yüklendi" notice`));  // turkish-ok: expected Turkish UI text

  let downloadCount = 0;
  page.on('download', () => { downloadCount += 1; });
  const pdf = await makeTestPdf(page);
  const pdf64 = pdf.toString('base64');
  await page.click('#tab-button-impose');
  await page.selectOption('#binding-type', 'sewn');
  // D11: native Open dialog → open_file {purpose: document} → read_file {id} raw ArrayBuffer → File → loaded
  await page.evaluate((b) => { window.__fake.openResponse = { id: 'k-open-1', name: 'test-37.pdf', kind: 'pdf' }; window.__fake.table['k-open-1'] = b; }, pdf64);
  await clearNotice();
  await page.click('#pdf-select');
  const opened = await page.waitForFunction(() => !document.getElementById('export-transfer').disabled, null, { timeout: 30000 }).then(() => true, () => false);
  const open = await page.evaluate(() => ({ notice: document.getElementById('notice').textContent,
    call: window.__fake.call.filter((c) => c.command === 'open_file' || c.command === 'read_file').map((c) => [c.command, c.purpose || c.id]),
    rest: Object.keys(window.__fake.table).length }));
  check('file', /test-37\.pdf yüklendi \(37 sayfa\)/.test(open.notice) && JSON.stringify(open.call) === '[["open_file","document"],["read_file","k-open-1"]]' && open.rest === 0,  // turkish-ok: expected Turkish UI text
    `${label}: D11 native Open → open_file + read_file (raw ArrayBuffer) → 37 pages loaded`, JSON.stringify(open));
  if (!opened) { // the PDF is loaded with the hidden input so that the rest of the flow is tested (the check above already FAILED)
    await page.setInputFiles('#pdf-file', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.waitForFunction(() => !document.getElementById('export-transfer').disabled, null, { timeout: 30000 });
  }
  async function exportNotice() {
    await clearNotice();
    await page.click('#export-transfer');
    await page.waitForFunction(() => /Kaydedildi|kaydedilmedi|kaydedilemedi/.test(document.getElementById('notice').textContent), null, { timeout: 30000 });  // turkish-ok: expected Turkish UI text
    return { text: await page.textContent('#notice'), error: await page.evaluate(() => document.getElementById('notice').classList.contains('error')) };
  }
  // cancel
  const cancelled = await exportNotice();
  const c1 = await page.evaluate(() => window.__fake.call.filter((c) => c.command === 'save_file'));
  check('file', /^Dizilmiş PDF kaydedilmedi/.test(cancelled.text) && cancelled.error && !/hazır/.test(cancelled.text) && c1.length === 1 && c1[0].name === 'test-37-dizilmis.pdf' && c1[0].kind === 'pdf' && c1[0].size > 1000,  // turkish-ok: expected Turkish UI text
    `${label}: D7 cancel in Save → "kaydedilmedi" (error), no "hazır"; save_file raw bytes + suggested name`, `${cancelled.text} / ${JSON.stringify(c1)}`);  // turkish-ok: expected Turkish UI text
  // write
  await page.evaluate(() => { window.__fake.saveResponse = '/Users/test/Desktop/test-37-dizilmis.pdf'; });  // turkish-ok: expected Turkish UI text
  const write = await exportNotice();
  check('file', write.text === 'Kaydedildi: /Users/test/Desktop/test-37-dizilmis.pdf (24 yüz).' && !write.error,  // turkish-ok: expected Turkish UI text
    `${label}: D7 written in Save → a success notice with the real path`, write.text);
  // D11 failed branch: Save could not write → "kaydedilemedi: <Rust error>" (error), no success  // turkish-ok: expected Turkish UI text
  await page.evaluate(() => { window.__fake.saveError = 'could not write: Operation not permitted (os error 1)'; });
  const failedSave = await exportNotice();
  await page.evaluate(() => { window.__fake.saveError = null; });
  check('file', failedSave.text === 'test-37-dizilmis.pdf kaydedilemedi: could not write: Operation not permitted (os error 1)' && failedSave.error,  // turkish-ok: expected Turkish UI text
    `${label}: D11 Save error → "kaydedilemedi" + the Rust error text (error style)`, failedSave.text);  // turkish-ok: expected Turkish UI text
  // D10: ⌘S while the Save dialog is open → ignored (no second dialog, no "Önce bir PDF"); then the result is reported  // turkish-ok: expected Turkish UI text
  await page.evaluate(() => { const s = window.__fake; s.saveGate = new Promise((r) => { s.openGate = r; }); s.call.length = 0; });
  await clearNotice();
  await page.click('#export-transfer');
  await page.waitForFunction(() => window.__fake.call.some((c) => c.command === 'save_file'), null, { timeout: 30000 });
  const isOpen = await page.evaluate(() => { window.Mucellit.platform.onMenu('file-save'); return { notice: document.getElementById('notice').textContent,
    busy: document.getElementById('export-transfer').getAttribute('aria-busy') }; });
  await page.evaluate(() => { const s = window.__fake; s.saveGate = null; s.openGate(); });
  await page.waitForFunction(() => /Kaydedildi/.test(document.getElementById('notice').textContent), null, { timeout: 30000 });  // turkish-ok: expected Turkish UI text
  const after = await page.evaluate(() => ({ save: window.__fake.call.filter((c) => c.command === 'save_file').length,
    busy: document.getElementById('export-transfer').getAttribute('aria-busy'), closed: document.getElementById('export-transfer').disabled }));
  check('file', isOpen.busy === 'true' && !/Önce bir PDF/.test(isOpen.notice) && after.save === 1 && after.busy === null && !after.closed,  // turkish-ok: expected Turkish UI text
    `${label}: D10 ⌘S ignored while the Save dialog is open (one dialog, no wrong notice); the button is free at the end`, JSON.stringify({ isOpen, after }));
  // D9: in the two PDF mode the fronts were written, the backs cancelled → only the page count of what was written
  await page.selectOption('#output-mode', 'pair');
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled);
  await page.evaluate(() => { window.__fake.call.length = 0; window.__fake.saveOrder = ['/Users/test/Desktop/test-37-onler.pdf', null]; });  // turkish-ok: expected Turkish UI text
  const pair = await exportNotice();
  await page.evaluate(() => { window.__fake.saveOrder = null; });
  const c2 = await page.evaluate(() => window.__fake.call.filter((c) => c.command === 'save_file').map((c) => c.name));
  check('file', c2.length === 2 && /-onler\.pdf$/.test(c2[0]) && /-arkalar\.pdf$/.test(c2[1]),  // turkish-ok: expected Turkish UI text
    `${label}: two PDF mode → two Save dialogs in turn (fronts, backs)`, JSON.stringify(c2));
  check('file', pair.text === 'Kaydedildi: /Users/test/Desktop/test-37-onler.pdf (12 yüz). Kaydedilmedi (vazgeçildi): test-37-arkalar.pdf.' && pair.error,  // turkish-ok: expected Turkish UI text
    `${label}: D9 partial save → only the page count of the written file (12, not the total 24)`, pair.text);
  await page.selectOption('#output-mode', 'single');
  // D11: opening from the Dock/Finder: file-opened event → pending_opens → read_file → loaded; an unreadable one is reported
  await page.click('#tab-button-projects');
  await page.evaluate((b) => { const s = window.__fake; s.call.length = 0; s.table['k-dock-1'] = b;
    s.pending = [{ id: 'k-dock-1', name: 'dock-37.pdf', kind: 'pdf' }]; }, pdf64);
  await clearNotice();
  await page.evaluate(() => window.__fake.listener['file-opened']({ payload: null }));
  await page.waitForFunction(() => /dock-37\.pdf yüklendi \(37 sayfa\)/.test(document.getElementById('notice').textContent), null, { timeout: 30000 })  // turkish-ok: expected Turkish UI text
    .catch(() => {});
  const dock = await page.evaluate(() => ({ notice: document.getElementById('notice').textContent,
    impose: !document.getElementById('tab-impose').hidden, call: window.__fake.call.map((c) => c.command + (c.id ? ':' + c.id : '')) }));
  check('file', /dock-37\.pdf yüklendi \(37 sayfa\)/.test(dock.notice) && dock.impose && JSON.stringify(dock.call) === '["pending_opens","read_file:k-dock-1"]',  // turkish-ok: expected Turkish UI text
    `${label}: D11 Opened (file-opened) → pending_opens → read_file → 37 pages in Imposition`, JSON.stringify(dock));
  await page.evaluate(() => { window.__fake.pending = [{ id: 'k-none', name: 'missing.pdf', kind: 'pdf' }]; });
  await clearNotice();
  await page.evaluate(() => window.__fake.listener['file-opened']({ payload: null }));
  await page.waitForFunction(() => /Dosya açılamadı/.test(document.getElementById('notice').textContent), null, { timeout: 5000 }).catch(() => {});  // turkish-ok: expected Turkish UI text
  const loss = await page.evaluate(() => ({ text: document.getElementById('notice').textContent, error: document.getElementById('notice').classList.contains('error') }));
  check('file', /^Dosya açılamadı: UNKNOWN/.test(loss.text) && loss.error, `${label}: D11 an unreadable outside open goes to an error notice`, loss.text);  // turkish-ok: expected Turkish UI text
  // JSON backup: cancel and write
  await page.click('#tab-button-projects');
  await page.evaluate(() => { window.__fake.saveResponse = null; const b = document.getElementById('notice'); b.textContent = ''; });
  await page.click('#json-export');
  await page.waitForFunction(() => /kaydedilmedi|dışa aktarıldı/.test(document.getElementById('notice').textContent));  // turkish-ok: expected Turkish UI text
  const jv = await page.textContent('#notice');
  await page.evaluate(() => { window.__fake.saveResponse = '/Users/test/Documents/mucellit-yedek.json'; const b = document.getElementById('notice'); b.textContent = ''; });  // turkish-ok: expected Turkish UI text
  await page.click('#json-export');
  await page.waitForFunction(() => /kaydedilmedi|dışa aktarıldı/.test(document.getElementById('notice').textContent));  // turkish-ok: expected Turkish UI text
  const jy = await page.textContent('#notice');
  const jc = await page.evaluate(() => window.__fake.call.filter((c) => c.command === 'save_file' && c.kind === 'json').length);
  check('file', /^JSON yedeği kaydedilmedi/.test(jv) && /dışa aktarıldı: \/Users\/test\/Documents\/mucellit-yedek\.json\.$/.test(jy) && jc === 2,  // turkish-ok: expected Turkish UI text
    `${label}: JSON backup: cancel → "kaydedilmedi", written → path`, `${jv} / ${jy}`);  // turkish-ok: expected Turkish UI text
  check('file', downloadCount === 0, `${label}: no browser download ever started in Tauri mode (no <a download>)`, `${downloadCount} download`);
  // automatic backup: add a project → backup_data (session + sequence)
  await page.fill('#yk-name', 'Backup Book');
  await page.click('#yk-create');
  await page.waitForFunction(() => window.__fake.lastBackup && /Backup Book/.test(window.__fake.lastBackup), null, { timeout: 5000 })
    .then(() => check('file', true, `${label}: a Projects change went to the automatic backup (backup_data)`),
      () => check('file', false, `${label}: a Projects change went to the automatic backup (backup_data)`));
  // O2: Clear all → the empty data backup WITHOUT WAITING (no old 1 s delay; Rust writes on quit)
  const t0 = await page.evaluate(() => Date.now());
  await page.click('#data-clear');
  const clean = await page.waitForFunction((t) => {
    const y = window.__fake.call.filter((c) => c.command === 'backup_data' && c.time >= t).find((c) => /"projects":\[\]/.test(c.json));
    return y ? { delay: y.time - t, session: y.session, order: y.order } : false;
  }, t0, { timeout: 900 }).then((h) => h.jsonValue(), () => null);
  check('file', clean && clean.delay < 900 && typeof clean.session === 'string' && clean.order > 0,
    `${label}: O2 Clear all → the empty backup went to Rust without waiting (session + sequence)`, JSON.stringify(clean));
  // when the delayed write in Rust fails (backup-writeFailed event) an error notice
  await clearNotice();
  await page.evaluate(() => window.__fake.listener['backup-writeFailed']({ payload: 'backup could not be written: No space left on device' }));
  const yh = await page.evaluate(() => ({ text: document.getElementById('notice').textContent, error: document.getElementById('notice').classList.contains('error') }));
  check('file', /otomatik yedeği yazılamadı: backup could not be written: No space left on device/.test(yh.text) && yh.error,  // turkish-ok: expected Turkish UI text
    `${label}: O2 the backup-writeFailed event goes to an error notice`, yh.text);
}

// ------------------------------------------------------------------
// interface language
// ------------------------------------------------------------------
const TR_LETTER = /[çğıöşüÇĞİÖŞÜ]/;  // turkish-ok: Turkish visible text check
// the app name "Mücellit" is not translated (only the whole word, word bounded; a word with a suffix like "Mücellitler" is not exempt)  // turkish-ok: Turkish visible text check
const trLetter = (m) => TR_LETTER.test(String(m).replace(/\bMücellit\b/g, ''));
const OLD_RECORD = join(FIXTURE, 'legacy');

/** The visible body text (except the name "Türkçe" in the language picker and the given user texts). */  // turkish-ok: Turkish visible text check
async function visibleText(page, except = []) {
  const m = await page.evaluate(() => {
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll('#i18n-select, script, [hidden]').forEach((e) => e.remove());
    return copy.innerText + ' ' + Array.from(document.querySelectorAll('[title],[aria-label],[placeholder]'))
      .filter((e) => e.id !== 'i18n-select').map((e) => [e.title, e.getAttribute('aria-label'), e.placeholder].filter(Boolean).join(' ')).join(' ');
  });
  return except.reduce((x, h) => x.split(h).join(''), m);
}

async function noMissingKey(page, label) {
  const e = await page.evaluate(() => window.Mucellit.i18n.missingKeys());
  check('i18n', e.length === 0, `${label}: no key missing from the dictionary`, JSON.stringify(e));
}

/**
 * The number fields and the Calculator result table use the decimal separator of the interface language (en ".", tr
 * ","); the input is accepted with both separators and goes back to the language's format when the field is left;
 * the ↑ key step (the old type=number behaviour) is kept.
 */
async function decimalFlow(page, label, i18n) {
  const ay = i18n === 'tr' ? ',' : '.', other = i18n === 'tr' ? '.' : ',';
  const first = await page.evaluate(() => ['paper-thickness', 'paper-width', 'h-paperThickness', 'h-square', 'yk-thickness', 'outer-margin'].map((id) => document.getElementById(id).value));
  check('print', JSON.stringify(first) === JSON.stringify(['0' + ay + '1', '297', '0' + ay + '1', '3', '0' + ay + '1', '0']),
    `${label}: number fields ${i18n} with the decimal separator ("0${ay}1")`, JSON.stringify(first));
  await page.click('#tab-button-calculator');
  let entry = null;
  try {
    await page.fill('#h-paperThickness', '0' + other + '123');
    await page.press('#h-paperThickness', 'Tab');
    entry = await page.evaluate(() => ({ field: document.getElementById('h-paperThickness').value, spine: document.querySelector('[data-result="spineThickness"]').textContent }));
  } catch (e) { entry = { error: String(e.message).split('\n')[0] }; }
  check('print', entry && entry.field === '0' + ay + '123' && entry.spine === '12' + ay + '8 mm',
    `${label}: "0${other}123" (the other separator) accepted, "0${ay}123" after leaving the field; spine 12${ay}8 mm`, JSON.stringify(entry));
  await page.focus('#h-square');
  await page.keyboard.press('ArrowUp');
  const table = await page.evaluate(() => ({ square: document.getElementById('h-square').value,
    cell: Array.from(document.querySelectorAll('#h-result td')).map((e) => e.textContent).join(' | ') }));
  const foreign = new RegExp('\\d\\' + other + '\\d');
  check('print', table.square === '3' + ay + '5' && !foreign.test(table.cell) && table.cell.includes(ay === ',' ? ',' : '.'),
    `${label}: step with ↑ (3 → 3${ay}5); only the "${ay}" decimal separator in the result table (value + formula)`, JSON.stringify({ square: table.square, foreign: (table.cell.match(new RegExp('.{0,12}' + foreign.source + '.{0,12}')) || [''])[0] }));
  await page.fill('#h-paperThickness', '0' + ay + '1');
  await page.fill('#h-square', '3');
  await page.press('#h-square', 'Tab');
  // a page count that looks like thousands ("1.200" tr / "1,200" en) is not silently read as 1.2; a clear error, no result.
  // "1200" is 1200 pages. The field is aria-invalid, the same error in the notice.
  const ambiguous = '1' + other + '200';
  await page.fill('#h-pageCount', ambiguous);
  await page.press('#h-pageCount', 'Tab');
  const b1 = await page.evaluate(() => ({ error: document.getElementById('h-error').textContent, line: document.querySelectorAll('#h-result tr').length,
    invalid: document.getElementById('h-pageCount').getAttribute('aria-invalid'), notice: document.getElementById('notice').textContent }));
  await page.fill('#h-pageCount', '1200');
  await page.press('#h-pageCount', 'Tab');
  const b2 = await page.evaluate(() => ({ total: (document.querySelector('[data-result="totalPages"]') || {}).textContent, error: document.getElementById('h-error').textContent,
    invalid: document.getElementById('h-pageCount').getAttribute('aria-invalid') }));
  const thousandsWord = i18n === 'tr' ? /binlik/ : /thousands/;  // turkish-ok: expected Turkish UI text
  check('print', thousandsWord.test(b1.error) && b1.error.includes(ambiguous) && b1.line === 0 && b1.invalid === 'true' && thousandsWord.test(b1.notice) &&
    b2.total === '1200' && b2.error === '' && b2.invalid === null,
    `${label}: in the Calculator "${ambiguous}" is a clear error (no result, the field invalid, a notice); "1200" → 1200 pages`, JSON.stringify({ b1, b2 }));
  await page.fill('#h-pageCount', '200');
  await page.press('#h-pageCount', 'Tab');
}

/**
 * The language picker is a small picker in the header (not a full width bar): on the same line as the title, narrow;
 * its accessible name and keyboard access are kept. Window 1280 px (the Playwright default; the Mac window is at least 1000 px).
 */
async function i18nPickerLayout(page, label) {
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width: width, height: 800 });
    const o = await page.evaluate(() => {
      const r = (e) => e.getBoundingClientRect();
      const select = document.getElementById('i18n-select'), h1 = document.querySelector('header h1'), head = document.querySelector('header');
      return { width: Math.round(r(select).width), basGen: Math.round(r(head).width), sameLine: Math.abs((r(select).top + r(select).bottom) / 2 - (r(h1).top + r(h1).bottom) / 2) < 16,
        headHeight: Math.round(r(head).height), aria: select.getAttribute('aria-label'), tab: select.tabIndex, punto: parseFloat(getComputedStyle(select).fontSize) };
    });
    check('print', o.width <= 240 && o.width < o.basGen / 3 && o.sameLine && o.aria && o.tab >= 0 && o.punto >= 12,
      `${label}: ${width} px: the language picker is small in the header (≤ 240 px, on the title line), accessible name + keyboard`, JSON.stringify(o));
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** At the end of the Turkish runs: html lang tr, the tabs in Turkish (today's text), no missing key. */
async function m6TrCheck(page, address, label) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const d = await page.evaluate(() => ({ lang: document.documentElement.lang, tab: Array.from(document.querySelectorAll('nav [role="tab"]')).map((b) => b.textContent),
    button: document.getElementById('export-transfer').textContent, code: window.Mucellit.i18n.code(), choice: document.getElementById('i18n-select').value }));
  check('i18n', d.lang === 'tr' && d.code === 'tr' && JSON.stringify(d.tab) === '["Düzenle","Süreç","Hesapla","Öğren"]' && /Dizilmiş PDF'i (indir|kaydet…)/.test(d.button) && d.choice === 'system',  // turkish-ok: expected Turkish UI text
    `${label}: in a tr-TR browser the system language is Turkish; tabs and button with today's text`, JSON.stringify(d));
  const storage = await page.textContent('#storage-hint');
  check('i18n', storage === 'Veri bu tarayıcıda saklanır. Tarayıcı verisi silinirse kaybolur; ara ara JSON yedeği alın.',  // turkish-ok: expected Turkish UI text
    `${label}: the storage hint in the browser is today's Turkish text (the Mac text only in Tauri)`, storage);
  await decimalFlow(page, label, 'tr');
  await i18nPickerLayout(page, label);
  await printingHidden(page, label);
  await noMissingKey(page, label);
}

/** English interface (en-US): smoke + an old Turkish record + a manual language choice. */
async function m6MostFlow(page, address, iz, label, tam) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const head = await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, tab: Array.from(document.querySelectorAll('nav [role="tab"]')).map((b) => b.textContent),
    button: document.getElementById('export-transfer').textContent, source: document.getElementById('source-info').textContent, choice: document.getElementById('i18n-select').value,
    options: Array.from(document.getElementById('i18n-select').options).map((o) => o.value + '=' + o.textContent) }));
  check('i18n', head.lang === 'en' && head.title === 'Mücellit' && JSON.stringify(head.tab) === '["Imposition","Projects","Calculator","Learn"]' && head.button === 'Download imposed PDF' &&
    head.source === 'No PDF loaded yet.' && head.choice === 'system' && JSON.stringify(head.options) === '["system=System language (English)","en=English","tr=Türkçe"]',  // turkish-ok: expected Turkish UI text
    `${label}: in an en-US browser the interface is in English (tabs, button, language picker)`, JSON.stringify(head));
  // the changed English texts in the interface
  const dm = await page.evaluate(() => {
    const m = (a) => (document.querySelector(`[data-i18n="${a}"]`) || {}).textContent;
    return { blank: [m('impose.blank_to_start'), m('impose.blank_before'), m('impose.blank_to_end')], spine: m('calculator.spine_shape'), endpapers: m('calculator.endpaper_allowance'), rule: m('calculator.spine_rule'),
      source: m('calculator.source'), hint: m('impose.output_hint'), storage: (document.getElementById('storage-hint') || {}).textContent };
  });
  check('i18n', JSON.stringify(dm.blank) === '["Insert blank at start","Insert blank before selected","Insert blank at end"]' && dm.spine === 'Spine shape' &&
    dm.endpapers === 'Endpaper thickness allowance (mm)' && dm.rule === 'Spine stiffener rule (flat spine)' && !/docs\//.test(dm.source) &&
    dm.hint === 'First sides of the exported file (actual output).' && /stored in this browser/.test(dm.storage),
    `${label}: the changed English texts are visible; in the browser the storage hint is the browser text`, JSON.stringify(dm));
  const first = await visibleText(page);
  check('i18n', !trLetter(first), `${label}: no Turkish letter in the visible text at start-up`, (first.match(new RegExp('.{0,30}' + TR_LETTER.source + '.{0,30}')) || [''])[0]);
  // load a PDF + export
  await page.click('#tab-button-impose');
  const pdf = await makeTestPdf(page);
  await page.setInputFiles('#pdf-file', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 37);
  await page.waitForFunction(() => /loaded/.test(document.getElementById('notice').textContent), null, { timeout: 10000 }).catch(() => {});
  await page.selectOption('#binding-type', 'sewn');
  await page.fill('#signature-sheet', '4');
  await page.waitForFunction(() => document.querySelectorAll('#sheet-preview .sheet-card').length === 12);
  const height = await page.evaluate(() => ({ source: document.getElementById('source-info').textContent, summary: document.getElementById('imposition-summary').textContent,
    title: document.querySelector('#sheet-preview .sheet-card .title').textContent, card: document.querySelector('#small-thumbs .card .label .small').textContent }));
  check('i18n', /^test-37\.pdf — 37 pages, first page 148 × 210 mm$/.test(height.source) && height.summary === '37 pages → padded to 48 (11 blank) · 3 signatures · 12 printer sheets (24 sides)' &&
    /^Signature 1 · sheet 1 \(outer\)output p\. 1–2$/.test(height.title) && height.card === 'source p. 1',
    `${label}: loaded PDF information, imposition summary (singular/plural), sheet title in English`, JSON.stringify(height));
  if (tam) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-transfer')]);
    await page.waitForFunction(() => /ready/.test(document.getElementById('notice').textContent), null, { timeout: 30000 });
    const b = await page.textContent('#notice');
    check('i18n', download.suggestedFilename() === 'test-37-imposed.pdf' && b === 'test-37-imposed.pdf ready (24 sides).',
      `${label}: exported file name -imposed, the notice in English`, download.suggestedFilename() + ' | ' + b);
    await page.selectOption('#output-mode', 'pair');
    await page.check('#back-reversed');
    const two = [];
    page.on('download', (d) => two.push(d.suggestedFilename()));
    await page.click('#export-transfer');
    await page.waitForFunction(() => /and/.test(document.getElementById('notice').textContent), null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    check('i18n', JSON.stringify(two.sort()) === '["test-37-backs-reversed.pdf","test-37-fronts.pdf"]', `${label}: two PDFs: -fronts / -backs-reversed`, JSON.stringify(two));
    await page.selectOption('#output-mode', 'single');
    // a faulty input notice in English: not an EPUB
    await page.setInputFiles('#pdf-file', { name: 'broken.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('this is not a zip') });
    await page.waitForFunction(() => /couldn't be opened/.test(document.getElementById('notice').textContent), null, { timeout: 30000 }).catch(() => {});
    const bz = await page.textContent('#notice');
    check('i18n', bz === "The file couldn't be opened: This file couldn't be read: it isn't a valid EPUB (ZIP) or it is damaged.", `${label}: the broken EPUB error in English`, bz);
    // Calculator: decimal point, English rows
    await page.click('#tab-button-calculator');
    const h = await page.evaluate(() => ({ line: Array.from(document.querySelectorAll('#h-result th')).map((e) => e.textContent).slice(0, 4), spine: document.querySelector('[data-result="spineThickness"]').textContent }));
    check('i18n', JSON.stringify(h.line) === '["Total pages (blanks included)","Leaves","Signatures","Spine thickness S"]' && h.spine === '10.4 mm',
      `${label}: the Calculator rows in English`, JSON.stringify(h));
    await page.fill('#h-paperThickness', '0.123');
    const decimal = await page.textContent('[data-result="spineThickness"]');
    check('i18n', decimal === '12.8 mm', `${label}: the Calculator decimal separator is a point (en-US)`, decimal);
    await page.fill('#h-paperThickness', '0.1');
    await decimalFlow(page, label, 'en');
  }
  // Projects: a new project with English steps; an old Turkish record shows in English, the user step as it is
  await page.click('#tab-button-projects');
  await page.fill('#yk-name', 'Notebook');
  await page.click('#yk-create');
  await page.waitForFunction(() => document.querySelectorAll('#steps .step').length === 14);
  const fresh = await page.evaluate(() => ({ first: document.querySelector('#steps .step-name').textContent, summary: document.getElementById('book-progress').textContent,
    data: JSON.parse(localStorage.getItem('mucellit.projects')).projects.slice(-1)[0].steps[6] }));
  check('i18n', fresh.first === '1. Prep / PDF' && /^Sewn signatures \+ hardcover \(case binding\) · 0 \/ 14 steps done · created \d{4}-\d\d-\d\d$/.test(fresh.summary) && fresh.data.template === 'sewing' && fresh.data.name === 'Sewing',
    `${label}: steps in English in a new project, the template key in the record`, JSON.stringify(fresh));
  const old = readFileSync(join(OLD_RECORD, 'local-storage-v1.json'), 'utf8');
  await page.evaluate((e) => { localStorage.removeItem('mucellit.projects'); localStorage.removeItem('mucellit.selectedProject'); localStorage.setItem('kitapCilt.v1', e); localStorage.setItem('kitapCilt.seciliKitap', 'k-mzeski-1'); }, old);  // turkish-ok: legacy storage names (migration test)
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]');
  await page.click('#tab-button-projects');
  await page.waitForSelector('#steps .step');
  const e = await page.evaluate(() => ({ names: Array.from(document.querySelectorAll('#steps .step-name')).map((x) => x.textContent),
    settings: (document.querySelector('#book-detail p.small') || {}).textContent, ls: localStorage.getItem('mucellit.projects'), legacy: localStorage.getItem('kitapCilt.v1') + '|' + localStorage.getItem('kitapCilt.seciliKitap') }));  // turkish-ok: legacy storage names (migration test)
  check('i18n', e.names.length === 15 && e.names[0] === '1. Prep / PDF' && e.names[6] === '7. Sewing' && e.names[14] === '15. Ayraç takma' &&  // turkish-ok: expected Turkish UI text
    /^Saved imposition settings: sewn signatures, paper 297×210 mm, book 148×210 mm, 4 sheets per signature$/.test(e.settings) && e.legacy === 'null|null' && JSON.parse(e.ls).version === 2 && JSON.parse(e.ls).projects[0].steps.length === 15 && JSON.parse(e.ls).projects[0].name === JSON.parse(old).kitaplar[0].ad,  // turkish-ok: legacy storage names (migration test)
    `${label}: the old Turkish record opened: template steps in English, the user step as it is, the record unchanged`, JSON.stringify({ names: [e.names[0], e.names[6], e.names[14]], settings: e.settings }));
  const sm = await visibleText(page, ['Çiğdemköy (deneme)', 'Ayraç takma', 'kuşe kağıt', '80 g/m² kitap kağıdı']);  // turkish-ok: expected Turkish UI text
  check('i18n', !trLetter(sm), `${label}: no Turkish letter in the Projects view (except the user texts)`, (sm.match(new RegExp('.{0,30}' + TR_LETTER.source + '.{0,30}')) || [''])[0]);
  await noMissingKey(page, label);
  // manual language choice: no open document → no confirmation; switches to Turkish and stays; back to the system language → English
  const confirmCount = iz.confirms.length;
  await Promise.all([page.waitForEvent('load'), page.selectOption('#i18n-select', 'tr')]);
  await page.waitForSelector('html[data-ready="yes"]');
  await page.click('#tab-button-projects');
  const tr = await page.evaluate(() => ({ lang: document.documentElement.lang, tab: document.getElementById('tab-button-impose').textContent, choice: localStorage.getItem('mucellit.language'),
    value: document.getElementById('i18n-select').value, step: (document.querySelector('#steps .step-name') || {}).textContent }));
  check('i18n', tr.lang === 'tr' && tr.tab === 'Düzenle' && tr.choice === 'tr' && tr.value === 'tr' && tr.step === '1. Hazırlık / PDF' && iz.confirms.length === confirmCount,  // turkish-ok: expected Turkish UI text
    `${label}: a manual Turkish choice (no confirmation without a document) reloads the page, stays, the steps in Turkish`, JSON.stringify(tr));
  const hintTr = await page.evaluate(() => document.getElementById('i18n-select').getAttribute('title'));
  check('print', hintTr === 'Dil', `${label}: after switching to Turkish the language picker tooltip is "Dil"`, String(hintTr));  // turkish-ok: expected Turkish UI text
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]');
  check('i18n', await page.evaluate(() => document.documentElement.lang) === 'tr', `${label}: the manual choice stays on reopening (Turkish in an en-US browser)`);
  // with an open document the language change asks for confirmation; nothing changes on cancel
  await page.click('#tab-button-impose');
  await page.setInputFiles('#pdf-file', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 37);
  iz.confirmRed = true;
  await page.selectOption('#i18n-select', 'system');
  await page.waitForTimeout(500);
  iz.confirmRed = false;
  const red = await page.evaluate(() => ({ lang: document.documentElement.lang, choice: localStorage.getItem('mucellit.language'), value: document.getElementById('i18n-select').value, card: document.querySelectorAll('#small-thumbs .card').length }));
  check('i18n', iz.confirms.length === confirmCount + 1 && /Dil değişince pencere yeniden yüklenir/.test(iz.confirms[iz.confirms.length - 1]) && red.lang === 'tr' && red.choice === 'tr' && red.value === 'tr' && red.card === 37,  // turkish-ok: expected Turkish UI text
    `${label}: with an open document the language change asks for confirmation (Turkish text); Cancel → language, choice and document unchanged`, JSON.stringify({ red, confirmation: iz.confirms.slice(-1) }));
  await Promise.all([page.waitForEvent('load'), page.selectOption('#i18n-select', 'system')]);
  await page.waitForSelector('html[data-ready="yes"]');
  const restored = await page.evaluate(() => ({ lang: document.documentElement.lang, choice: localStorage.getItem('mucellit.language'), value: document.getElementById('i18n-select').value }));
  check('i18n', restored.lang === 'en' && restored.choice === null && restored.value === 'system', `${label}: choosing "System language" removes the manual choice, back to English in en-US (confirmation accepted)`, JSON.stringify(restored));
  const ipEn = await page.evaluate(() => document.getElementById('i18n-select').getAttribute('title'));
  check('print', ipEn === 'Language', `${label}: back to English the language picker tooltip is "Language"`, String(ipEn));
  await printingHidden(page, label);
  await noMissingKey(page, label);
}

/** Tauri simulation: read_language + set_language at start-up; language:en from the menu; when the WebKit data is removed the choice comes back from the Rust backup. */
async function m6TauriI18n(page, address, label) {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.removeItem('fakeI18nChoice'); sessionStorage.removeItem('fakeI18nCode'); window.__fake.call = []; });
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const a = await page.evaluate(() => ({ call: window.__fake.call.filter((c) => /_language$/.test(c.command)).map((c) => c.command), settings: window.__fake.i18nSettings, lang: document.documentElement.lang,
    button: document.getElementById('export-transfer').textContent }));
  check('i18n', JSON.stringify(a.call) === '["read_language","set_language"]' && JSON.stringify(a.settings.slice(-1)) === '[["tr","system"]]' && a.lang === 'tr' && a.button === "Dizilmiş PDF'i kaydet…",  // turkish-ok: expected Turkish UI text
    `${label}: read_language at start-up, then set_language {tr, system} (the menu in the same language as JS); the Save button in Turkish`, JSON.stringify(a));
  // View > Language > English (no open document: no confirmation) → {en, en} to Rust, the page reloads, English
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => window.__fake.listener.menu({ payload: 'i18n:en' }))]);
  await page.waitForSelector('html[data-ready="yes"]');
  const b = await page.evaluate(() => ({ lang: document.documentElement.lang, button: document.getElementById('export-transfer').textContent, ls: localStorage.getItem('mucellit.language'), settings: window.__fake.i18nSettings,
    tab: document.getElementById('tab-button-projects').textContent }));
  check('i18n', b.lang === 'en' && b.button === 'Save imposed PDF…' && b.ls === 'en' && b.tab === 'Projects' && JSON.stringify(b.settings.slice(-1)) === '[["en","en"]]',
    `${label}: menu language:en → set_language {en, en}, reloaded, the interface and the Save button in English`, JSON.stringify(b));
  // the WebKit data was removed (localStorage empty) but Rust has a backup → the choice comes back
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]');
  const c = await page.evaluate(() => ({ lang: document.documentElement.lang, ls: localStorage.getItem('mucellit.language'), tab: document.getElementById('tab-button-calculator').textContent, source: document.getElementById('source-info').textContent }));
  check('i18n', c.lang === 'en' && c.ls === 'en' && c.tab === 'Calculator' && c.source === 'No PDF loaded yet.',
    `${label}: when localStorage is removed the manual choice comes back from the Rust backup (read_language); English on a tr-TR system`, JSON.stringify(c));
  // a faulty menu id is ignored
  await page.evaluate(() => { window.__fake.listener.menu({ payload: 'i18n:xx' }); window.__fake.listener.menu({ payload: 'i18n:' }); });
  await page.waitForTimeout(300);
  check('i18n', await page.evaluate(() => document.documentElement.lang + '|' + localStorage.getItem('mucellit.language')) === 'en|en', `${label}: a faulty language menu id (language:xx, language:) is ignored`);
  await noMissingKey(page, label);
  // "System language" from Rust as in the menu (NSLocale + the Apple rule); with a tr-TR browser and Rust saying en the interface is en
  await page.evaluate(() => { localStorage.clear(); sessionStorage.removeItem('fakeI18nChoice'); sessionStorage.removeItem('fakeI18nCode'); sessionStorage.setItem('fakeSystem', 'en'); window.__fake.i18nSettings = []; });
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]');
  const r = await page.evaluate(() => ({ lang: document.documentElement.lang, options: Array.from(document.getElementById('i18n-select').options).map((o) => o.value + '=' + o.textContent),
    value: document.getElementById('i18n-select').value, settings: window.__fake.i18nSettings, tab: document.getElementById('tab-button-impose').textContent, hint: document.getElementById('storage-hint').textContent }));
  check('i18n', r.lang === 'en' && r.options[0] === 'system=System language (English)' && r.value === 'system' && r.tab === 'Imposition' && JSON.stringify(r.settings.slice(-1)) === '[["en","system"]]',
    `${label}: the system language from Rust (read_language.system en, browser tr-TR): the interface and the "System language (English)" option from the same source as the menu`, JSON.stringify(r));
  check('i18n', /this Mac/.test(r.hint) && !/browser/i.test(r.hint), `${label}: the storage hint in the Mac app is the Mac text (does not say browser)`, r.hint);
  const first = await page.evaluate(() => window.__fake.firstFrame);
  check('print', first && first.lang === 'en' && first.tab === 'Imposition',
    `${label}: the first frame (before read_language returns) is in Rust's system language (pre-script __MC_LANG__; browser tr-TR, Rust en): no navigator.languages → Rust switch`, JSON.stringify(first));
  await page.evaluate(() => { sessionStorage.removeItem('fakeSystem'); localStorage.clear(); sessionStorage.removeItem('fakeI18nCode'); });
}

/**
 * Printing in the Mac app (fake __TAURI__): the buttons only with platform.print; the note before printing (two-sided =
 * the choice in the tool, 100%); one PDF sent / cancelled / Rust error; two PDFs fronts → "turn the stack over"
 * confirmation → backs and stopping halfway; ⌘P and ⌘S are ignored while the output is prepared / the dialog is open;
 * menu ⌘P; Open in Preview and, when it cannot open, option E (Save + note). No browser download ever starts.
 */
async function m3Printing(page, address, label) {
  let download = 0;
  page.on('download', () => { download += 1; });
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-impose');
  const clearNotice = () => page.evaluate(() => { const b = document.getElementById('notice'); b.textContent = ''; b.className = ''; window.__fake.call.length = 0; window.__fake.questions = []; });
  const state = () => page.evaluate(() => ({ notice: document.getElementById('notice').textContent, error: document.getElementById('notice').classList.contains('error'),
    print: window.__fake.call.filter((c) => c.command === 'print').map((c) => ({ name: c.name, size: c.size, noteAtPrint: c.noteAtPrint })),
    preview: window.__fake.call.filter((c) => c.command === 'open_in_preview').map((c) => c.name), save: window.__fake.call.filter((c) => c.command === 'save_file').map((c) => c.name),
    questions: window.__fake.questions || [] }));
  const finished = (re) => page.waitForFunction((k) => new RegExp(k).test(document.getElementById('notice').textContent), re.source, { timeout: 30000 }).catch(() => {});
  const g = await page.evaluate(() => ({ field: document.getElementById('print-field').hidden, button: document.getElementById('print').disabled, preview: document.getElementById('inPreview-open').hidden,
    note: document.getElementById('print-note').hidden ? null : document.getElementById('print-note').textContent, duplex: document.getElementById('duplex').selectedOptions[0].textContent,
    text: [document.getElementById('print').textContent, document.getElementById('inPreview-open').textContent],
    visible: [!!document.getElementById('print').offsetParent, !!document.getElementById('inPreview-open').offsetParent, !!document.getElementById('print-note').offsetParent] }));
  check('print', g.field === false && JSON.stringify(g.visible) === '[true,true,true]' && g.button === true && g.preview === false && JSON.stringify(g.text) === '["Yazdır…","Önizleme\'de Aç"]' &&  // turkish-ok: expected Turkish UI text
    // the option with the name of the print dialog ("Açık (Kısa Kenar)" / Layout: "Kısa Kenardan Ciltli"), the tool's name apart  // turkish-ok: expected Turkish UI text
    g.note === `Baskı penceresinde: Çift Taraflı → “Açık (Kısa Kenar)” seçin (buradaki “${g.duplex}” ile aynı; Düzen bölümünde: Çift Taraflı → “Kısa Kenardan Ciltli”), ölçeği %100 bırakın, “Kâğıt boyutuna sığdır”ı seçmeyin.`,  // turkish-ok: expected Turkish UI text
    `${label}: Print… and Open in Preview visible (disabled without a PDF); the print note names the two-sided choice of the tool`, JSON.stringify(g));
  await clearNotice();
  await page.evaluate(() => window.Mucellit.platform.onMenu('file-print'));
  const none = await state();
  check('print', none.notice === 'Önce bir PDF açın, sonra yazdırın.' && none.error && none.print.length === 0, `${label}: ⌘P without a PDF → "Önce bir PDF açın" (no print dialog)`, JSON.stringify(none));  // turkish-ok: expected Turkish UI text
  const pdf = await makeTestPdf(page);
  await page.setInputFiles('#pdf-file', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => !document.getElementById('print').disabled, null, { timeout: 30000 });
  await page.selectOption('#binding-type', 'sewn');
  await page.selectOption('#output-mode', 'single');
  // one PDF: printed
  await clearNotice();
  await page.click('#print');
  await finished(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı/);  // turkish-ok: expected Turkish UI text
  const single = await state();
  check('print', single.notice === 'Yazıcıya gönderildi: test-37-dizilmis.pdf.' && !single.error && single.print.length === 1 && single.print[0].name === 'test-37-dizilmis.pdf' && single.print[0].size > 1000 &&  // turkish-ok: expected Turkish UI text
    /^Baskı penceresinde: Çift Taraflı → “Açık.*%100.*sığdır/.test(single.print[0].noteAtPrint) && single.questions.length === 0,  // turkish-ok: expected Turkish UI text
    `${label}: one PDF → print (raw bytes, name), the note shown before the print dialog, "Yazıcıya gönderildi"`, JSON.stringify(single));  // turkish-ok: expected Turkish UI text
  // one PDF: cancelled
  await clearNotice();
  await page.evaluate(() => { window.__fake.printOrder = [false]; });
  await page.click('#print');
  await finished(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı/);  // turkish-ok: expected Turkish UI text
  const cancelled = await state();
  check('print', cancelled.notice === 'Yazdırılmadı (baskı penceresinden vazgeçildi).' && cancelled.error && cancelled.print.length === 1, `${label}: Cancel in the print dialog → "Yazdırılmadı" (error), the app goes on`, JSON.stringify(cancelled));  // turkish-ok: expected Turkish UI text
  // Rust error (the non-Apple platform text)
  await clearNotice();
  await page.evaluate(() => { window.__fake.printOrder = ['bu platformda yazdırma henüz yok']; });  // turkish-ok: expected Turkish UI text
  await page.click('#print');
  await finished(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı/);  // turkish-ok: expected Turkish UI text
  const rh = await state();
  check('print', rh.notice === 'test-37-dizilmis.pdf yazdırılamadı: bu platformda yazdırma henüz yok' && rh.error, `${label}: a Rust error (non-Apple: "bu platformda yazdırma henüz yok") is reported`, rh.notice);  // turkish-ok: expected Turkish UI text
  // two PDFs: fronts → turn-over confirmation → backs
  await page.selectOption('#output-mode', 'pair');
  await page.waitForFunction(() => !document.getElementById('print').disabled);
  const noteTwo = await page.textContent('#print-note');
  await clearNotice();
  await page.evaluate(() => { window.__fake.printOrder = [true, true]; window.__fake.askOrder = [true]; });
  await page.click('#print');
  await finished(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı|Yalnız önler/);  // turkish-ok: expected Turkish UI text
  const two = await state();
  check('print', two.notice === 'Yazıcıya gönderildi: test-37-onler.pdf ve test-37-arkalar.pdf.' && JSON.stringify(two.print.map((y) => y.name)) === '["test-37-onler.pdf","test-37-arkalar.pdf"]' &&  // turkish-ok: expected Turkish UI text
    two.questions.length === 1 && /^Önler \(test-37-onler\.pdf\) yazıcıya gönderildi\. .*desteyi .*çevirip .*geri koyun/.test(two.questions[0]) && /Çift Taraflı → “Kapalı”/.test(noteTwo),  // turkish-ok: expected Turkish UI text
    `${label}: two PDFs → fronts, the "desteyi çevirip geri koyun" confirmation, backs; note "Çift Taraflı → Kapalı"`, JSON.stringify({ ...two, noteTwo }));  // turkish-ok: expected Turkish UI text
  // two PDFs: Cancel at the turn-over confirmation → halfway (only the fronts)
  await clearNotice();
  await page.evaluate(() => { window.__fake.printOrder = [true]; window.__fake.askOrder = [false]; });
  await page.click('#print');
  await finished(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı|Yalnız önler/);  // turkish-ok: expected Turkish UI text
  const half = await state();
  check('print', half.notice === 'Yalnız önler yazıcıya gönderildi (test-37-onler.pdf); arkalar (test-37-arkalar.pdf) basılmadı (vazgeçildi).' && half.error && half.print.length === 1,  // turkish-ok: expected Turkish UI text
    `${label}: two PDFs, Cancel at the turn-over confirmation → stopping halfway reported correctly (only the fronts)`, JSON.stringify(half));
  // two PDFs: Cancel in the print dialog of the backs
  await clearNotice();
  await page.evaluate(() => { window.__fake.printOrder = [true, false]; window.__fake.askOrder = [true]; });
  await page.click('#print');
  await finished(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı|Yalnız önler/);  // turkish-ok: expected Turkish UI text
  const half2 = await state();
  check('print', /^Yalnız önler yazıcıya gönderildi/.test(half2.notice) && half2.error && half2.print.length === 2, `${label}: two PDFs, Cancel at the backs → halfway`, JSON.stringify(half2));  // turkish-ok: expected Turkish UI text
  // ⌘P / ⌘S ignored while busy; then the buttons are free
  await page.selectOption('#output-mode', 'single');
  await page.waitForFunction(() => !document.getElementById('print').disabled);
  await clearNotice();
  await page.evaluate(() => { const s = window.__fake; s.printGate = new Promise((r) => { s.openGate = r; }); });
  await page.click('#print');
  await page.waitForFunction(() => window.__fake.call.some((c) => c.command === 'print'), null, { timeout: 30000 });
  const busy = await page.evaluate(() => { const P = window.Mucellit.platform; P.onMenu('file-print'); P.onMenu('file-save'); P.onMenu('file-preview');
    return { write: document.getElementById('print').getAttribute('aria-busy'), creep: document.getElementById('export-transfer').getAttribute('aria-busy'), closed: document.getElementById('export-transfer').disabled }; });
  await page.evaluate(() => { const s = window.__fake; s.printGate = null; s.openGate(); });
  await finished(/Yazıcıya gönderildi/);  // turkish-ok: expected Turkish UI text
  const after = await state();
  const free = await page.evaluate(() => ['print', 'export-transfer', 'inPreview-open'].map((id) => [document.getElementById(id).disabled, document.getElementById(id).getAttribute('aria-busy')]));
  check('print', busy.write === 'true' && busy.creep === 'true' && busy.closed && after.print.length === 1 && after.save.length === 0 && after.preview.length === 0 &&
    JSON.stringify(free) === '[[false,null],[false,null],[false,null]]',
    `${label}: ⌘P/⌘S/⌥⌘P ignored while the print dialog is open (one dialog); the buttons are free at the end`, JSON.stringify({ busy, after, free }));
  // when a setting changes while the print dialog is open (the preview is drawn again) the output buttons do not turn on,
  // aria-busy stays; no second output job (Save click) starts.
  await clearNotice();
  await page.evaluate(() => { const s = window.__fake; s.printGate = new Promise((r) => { s.openGate = r; });
    const C = window.Mucellit.output, u = C.build; window.__countMake = 0; C.build = function () { window.__countMake += 1; return u.apply(this, arguments); }; });
  await page.click('#print');
  await page.waitForFunction(() => window.__fake.call.some((c) => c.command === 'print'), null, { timeout: 30000 });
  await page.click('#cropMarks'); // toggle the crop marks: the layout still fits (D.blocked false), the preview is drawn again
  await page.waitForTimeout(400); // drawing the preview again (requestAnimationFrame + pdf.js)
  const configured = await page.evaluate(() => ['print', 'export-transfer', 'inPreview-open'].map((id) => [document.getElementById(id).disabled, document.getElementById(id).getAttribute('aria-busy')]));
  await page.evaluate(() => { document.getElementById('export-transfer').click(); document.getElementById('inPreview-open').click(); });
  await page.waitForTimeout(800); // when a second job started, build is called and the Save/Preview command goes
  await page.evaluate(() => { const s = window.__fake; s.printGate = null; s.openGate(); });
  await finished(/Yazıcıya gönderildi/);  // turkish-ok: expected Turkish UI text
  await page.waitForTimeout(300);
  const settingsAfter = { ...(await state()), build: await page.evaluate(() => window.__countMake) };
  const settingsFree = await page.evaluate(() => ['print', 'export-transfer', 'inPreview-open'].map((id) => [document.getElementById(id).disabled, document.getElementById(id).getAttribute('aria-busy')]));
  await page.click('#cropMarks');
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled, null, { timeout: 30000 }).catch(() => {});
  check('print', JSON.stringify(configured) === '[[true,"true"],[true,"true"],[true,"true"]]' && settingsAfter.print.length === 1 && settingsAfter.save.length === 0 &&
    settingsAfter.preview.length === 0 && settingsAfter.build === 1 &&
    JSON.stringify(settingsFree) === '[[false,null],[false,null],[false,null]]',
    `${label}: when a setting changes while the print dialog is open the output buttons stay disabled + aria-busy; Save starts no second job`, JSON.stringify({ configured, settingsFree, settingsAfter }));
  // menu ⌘P (event path)
  await clearNotice();
  await page.evaluate(() => window.__fake.listener.menu({ payload: 'file-print' }));
  await finished(/Yazıcıya gönderildi/);  // turkish-ok: expected Turkish UI text
  const menu = await state();
  check('print', menu.print.length === 1 && menu.notice === 'Yazıcıya gönderildi: test-37-dizilmis.pdf.', `${label}: File > Print… (⌘P menu event) opens the print dialog`, JSON.stringify(menu));  // turkish-ok: expected Turkish UI text
  // Open in Preview: opened
  await clearNotice();
  await page.click('#inPreview-open');
  await finished(/Önizleme/);  // turkish-ok: expected Turkish UI text
  const on = await state();
  check('print', on.notice === "Önizleme'de açıldı: test-37-dizilmis.pdf. Önizleme'den “Gerçek Boyut” (%100) ile basın." && JSON.stringify(on.preview) === '["test-37-dizilmis.pdf"]',  // turkish-ok: expected Turkish UI text
    `${label}: Open in Preview → open_in_preview, the "Gerçek Boyut" note`, JSON.stringify(on));  // turkish-ok: expected Turkish UI text
  // could not open (sandbox) → option E: confirm → Save → saved + note
  await clearNotice();
  await page.evaluate(() => { const s = window.__fake; s.previewOrder = ['The application “Preview” does not have permission to open “test-37-dizilmis.pdf.”']; s.askOrder = [true]; s.saveResponse = '/Users/test/Documents/test-37-dizilmis.pdf'; });  // turkish-ok: expected Turkish UI text
  await page.click('#inPreview-open');
  await finished(/Kaydedildi|açamadı|kaydedilmedi/);  // turkish-ok: expected Turkish UI text
  const e = await state();
  await page.evaluate(() => { window.__fake.saveResponse = null; });
  check('print', /^Kaydedildi: \/Users\/test\/Documents\/test-37-dizilmis\.pdf \(24 yüz\)\. Önizleme'de açıp “Gerçek Boyut” \(%100\) ile basın\.$/.test(e.notice) &&  // turkish-ok: expected Turkish UI text
    e.questions.length === 1 && /^Önizleme PDF'i açamadı \(The application/.test(e.questions[0]) && JSON.stringify(e.save) === '["test-37-dizilmis.pdf"]',  // turkish-ok: expected Turkish UI text
    `${label}: Preview could not open → a clear question → Save (option E) + the "Önizleme'de basın" note`, JSON.stringify(e));  // turkish-ok: expected Turkish UI text
  // could not open → Cancel
  await clearNotice();
  await page.evaluate(() => { const s = window.__fake; s.previewOrder = ['no permission']; s.askOrder = [false]; });
  await page.click('#inPreview-open');
  await finished(/açamadı|Kaydedildi/);  // turkish-ok: expected Turkish UI text
  const ev = await state();
  check('print', ev.notice === "Önizleme PDF'i açamadı: no permission" && ev.error && ev.save.length === 0, `${label}: Preview could not open + Cancel → an error notice, no Save`, JSON.stringify(ev));  // turkish-ok: expected Turkish UI text
  check('print', download === 0, `${label}: no browser download in the printing/Preview flows`, `${download} download`);
}

/** In the browser (no platform.print) the print buttons and the note are hidden. */
async function printingHidden(page, label) {
  await page.click('#tab-button-impose'); // the visibility is measured with the Imposition tab open
  const g = await page.evaluate(() => ({ print: window.Mucellit.platform.print, field: document.getElementById('print-field').hidden, note: document.getElementById('print-note').hidden,
    visible: !!document.getElementById('print').offsetParent }));
  check('print', g.print === null && g.field && g.note && !g.visible, `${label}: in the browser the Print / Preview buttons and the print note are hidden`, JSON.stringify(g));
}

/**
 * When i18n.js throws (cannot load) in the Tauri simulation, platform-tauri.js makes no extra console error: the only
 * error in the console is the simulation itself (MC-SIMULATION); the interface is static English, the start-up error
 * is reported in English. The simulation errors are dropped after the check (for the "no console error" check at the end of the run).
 */
async function m3NoTauriI18n(page, address, iz, label) {
  await page.route('**/js/i18n.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: 'throw new Error("MC-SIMULATION i18n.js");' }));
  const once = iz.errors.length;
  await page.goto(address);
  await page.waitForFunction(() => /start/.test(document.getElementById('notice').textContent), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  const b = await page.evaluate(() => ({ name: window.Mucellit.platform.name, notice: document.getElementById('notice').textContent,
    tab: document.getElementById('tab-button-impose').textContent, storage: document.getElementById('storage-hint').textContent }));
  const fresh = iz.errors.slice(once);
  const outside = fresh.filter((h) => !/MC-SIMULATION/.test(h));
  check('print', b.name === 'tauri' && outside.length === 0 && fresh.length >= 1 && b.tab === 'Imposition' && /^The app couldn't start: /.test(b.notice) && /this Mac/.test(b.storage),
    `${label}: without i18n.js platform-tauri.js makes no extra console error (only the simulation error); the interface static English, the Mac storage hint English, the start-up error reported`,
    JSON.stringify({ ...b, console: fresh.map((h) => h.slice(0, 140)) }));
  iz.errors.splice(once); // the simulation errors (and the ones counted as failed, if any) are dropped from the end-of-run check; the check is above
  await page.unroute('**/js/i18n.js');
}

/**
 * Start-up error simulation. (a) platform.ready is rejected, (b) i18n.js throws, (c) the tr dictionary is broken. In
 * all three the labels are not empty: (a) in the chosen language (tr-TR → Turkish), (b) static English (index.html),
 * (c) English and the app works. The simulation errors (MC-SIMULATION) are dropped from the console check.
 */
async function m6StartupError(page, address, iz, label) {
  const I18n = require('../js/i18n.js');
  const dictionary = (code) => I18n.extractJson(readFileSync(join(APP, 'i18n', code + '.js'), 'utf8'));
  const EN = dictionary('en'), TR = dictionary('tr');
  const labels = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-i18n]')).map((e) => [e.getAttribute('data-i18n'), e.textContent]));
  const different = (l, s) => l.filter(([a, m]) => !m || m !== s[a]);
  const platformJs = readFileSync(join(APP, 'js', 'platform.js'), 'utf8');
  if (!platformJs.includes('ready: Promise.resolve(),')) throw new Error('platform.js simulation point not found');
  const fallSimulation = () => { const once = iz.errors.length; iz.errors = iz.errors.filter((h) => !/MC-SIMULATION/.test(h)); return once - iz.errors.length; };
  // (a)
  await page.route('**/js/platform.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: platformJs.replace('ready: Promise.resolve(),', "ready: Promise.reject(new Error('MC-SIMULATION ready')),") }));
  await page.goto(address);
  await page.waitForFunction(() => /MC-SIMULATION ready/.test(document.getElementById('notice').textContent), null, { timeout: 20000 });
  const a = await page.evaluate(() => ({ lang: document.documentElement.lang, ready: document.documentElement.getAttribute('data-ready'), notice: document.getElementById('notice').textContent,
    options: document.getElementById('i18n-select').options.length }));
  const la = await labels();
  check('i18n', la.length >= 100 && different(la, TR).length === 0 && a.lang === 'tr' && a.ready === null && /^Uygulama başlatılamadı: MC-SIMULATION ready$/.test(a.notice) && a.options === 3,  // turkish-ok: expected Turkish UI text
    `${label}: (a) platform.ready rejected: ${la.length} labels not empty and in Turkish (tr-TR), language picker filled, start-up error reported`, JSON.stringify({ ...a, difference: different(la, TR).slice(0, 3) }));
  await page.unroute('**/js/platform.js');
  fallSimulation(); // (a): as ready is rejected while being created in the simulation, the browser may also write "unhandled rejection"
  // (b)
  await page.route('**/js/i18n.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: 'throw new Error("MC-SIMULATION i18n.js");' }));
  await page.goto(address);
  await page.waitForFunction(() => /start/.test(document.getElementById('notice').textContent), null, { timeout: 20000 }).catch(() => {});
  const lb = await labels();
  const b = await page.evaluate(() => ({ lang: document.documentElement.lang, notice: document.getElementById('notice').textContent, aria: document.getElementById('i18n-select').getAttribute('aria-label') }));
  const bError = iz.errors.slice();
  const bFallen = fallSimulation();
  check('i18n', lb.length >= 100 && different(lb, EN).length === 0 && b.lang === 'en' && b.aria === 'Language' && /^The app couldn't start: /.test(b.notice) && bFallen >= 1,
    `${label}: (b) i18n.js threw: ${lb.length} labels static English (index.html), the start-up error reported in English`, JSON.stringify({ ...b, difference: different(lb, EN).slice(0, 3), console: bError.slice(0, 3).map((h) => h.slice(0, 120)) }));
  // in (b) any other error (an indirect result of the simulation) is listed so that it stays visible, and dropped
  const indirect = iz.errors.length;
  iz.errors = [];
  check('i18n', indirect <= 3, `${label}: (b) without i18n.js at most a few indirect console errors outside the simulation (${indirect})`, JSON.stringify(bError.map((h) => h.slice(0, 120))));
  await page.unroute('**/js/i18n.js');
  // (c)
  await page.route('**/i18n/tr.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: 'self.MucellitDictionaries = (self.MucellitDictionaries || []).concat([{ "_name": "MC-SIMULATION corrupt" }]);' }));
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const lc = await labels();
  const c = await page.evaluate(() => ({ lang: document.documentElement.lang, code: window.Mucellit.i18n.code(), languages: window.Mucellit.i18n.languages() }));
  check('i18n', lc.length >= 100 && different(lc, EN).length === 0 && c.lang === 'en' && c.code === 'en' && JSON.stringify(c.languages) === '["en"]',
    `${label}: (c) the tr dictionary broken: i18n.js runs, a tr-TR user sees English, the app starts`, JSON.stringify({ ...c, difference: different(lc, EN).slice(0, 3) }));
  await page.unroute('**/i18n/tr.js');
  // the normal start-up after the simulation
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const ld = await labels();
  check('i18n', different(ld, TR).length === 0, `${label}: the normal Turkish start-up when the simulation is removed`, JSON.stringify(different(ld, TR).slice(0, 3)));
}

// ------------------------------------------------------------------
// Learn guide
// ------------------------------------------------------------------
const LEARN_FOLDER = join(APP, 'js', 'learn');
const { inject: injectLearnCheck } = require('./learn-probe.cjs');
/**
 * The probe interface only in the test. The learn.js request is caught and the product file is served with the test
 * injection (app/test/learn-probe.cjs; Mucellit.learn.probe is added before the closing). The product code on disk does not change.
 */
async function setupLearnCheck(page) {
  const source = injectLearnCheck(readFileSync(join(LEARN_FOLDER, 'learn.js'), 'utf8'));
  await page.route('**/js/learn/learn.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: source }));
}
const LEARN_LICENSE = readFileSync(join(LEARN_FOLDER, 'LICENSE'), 'utf8').trim();
/** The names the guide scripts declare at the top level (candidates for the global name check). */
function learnCandidates() {
  const l = [];
  (function walk(k) { for (const g of readdirSync(k, { withFileTypes: true })) { const y = join(k, g.name); if (g.isDirectory()) walk(y); else if (g.name.endsWith('.js')) l.push(y); } })(LEARN_FOLDER);
  const candidate = new Set();
  for (const y of l) {
    const k = readFileSync(y, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const m of k.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) candidate.add(m[1]);
  }
  return [...candidate];
}
/** Test traces (injected by Playwright; not product code): CSP violations and the rAF call count. */
const LEARN_IZ = `(() => { window.__kcCsp = []; document.addEventListener('securitypolicyviolation', (e) => window.__kcCsp.push(e.violatedDirective + ' ' + (e.blockedURI || '')));
  const r = window.requestAnimationFrame.bind(window); window.__kcRaf = 0; window.requestAnimationFrame = (f) => { window.__kcRaf++; return r(f); }; })();`;
const learnState = (page) => page.evaluate(() => { const d = window.Mucellit.learn.probe.state();
  return { a: d.a, i: d.i, n: d.n, flow: d.flow, finished: d.finished, playing: d.playing, installed: d.installed, visible: d.visible, figure: d.figure, manual: d.manual, match: d.match, input: d.input, isOpen: d.st ? d.st.open : null, done: d.done }; });
/** The numbers panel table: { key: [numbers] } (read with the decimal/thousands separator of the language). */
function extractNumbers(text, i18n) {
  return (String(text).match(/\d[\d.,]*/g) || []).map((x) => Number(i18n === 'tr' ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '')));
}
const learnTable = (page, i18n) => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#guide-results td')).map((td) => [td.dataset.k, td.textContent])))
  .then((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, extractNumbers(v, i18n)])));
const calculatorTable = (page, i18n) => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#h-result td[data-result]')).map((td) => [td.dataset.result, td.textContent])))
  .then((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, extractNumbers(v, i18n)])));
const TB_LEARN = { page: [176], signature: [11], sheet: [88], printing: [44], spine: [8.8], board: [144, 216], strip: [12.8, 216], jointGap: [7], covering: [348.8, 250], endpapers: [296, 210], mull: [58.8, 198], headbands: [8.8] };
const tbFarki = (t) => Object.keys(TB_LEARN).filter((k) => JSON.stringify(t[k]) !== JSON.stringify(TB_LEARN[k])).map((k) => `${k}: ${JSON.stringify(t[k])}`);
async function writeCalculator(page, id, value) {
  await page.click('#tab-button-calculator');
  if (id === 'h-bindingType') await page.selectOption('#h-bindingType', value);
  else { await page.fill('#' + id, String(value)); await page.dispatchEvent('#' + id, 'change'); }
}

/** Learn run (server, Tauri CSP header). language: 'tr' | 'en' (browser locale). */
async function m7LearnFlow(page, address, iz, label, i18n) {
  const D = require('../js/i18n.js');
  const DICT = D.extractJson(readFileSync(join(APP, 'i18n', i18n + '.js'), 'utf8'));
  await page.addInitScript({ content: LEARN_IZ });
  await setupLearnCheck(page);
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  // ---- the guide is not set up before the tab opens; no rAF when idle
  const r0 = await page.evaluate(() => window.__kcRaf);
  await page.waitForTimeout(600);
  const once = await learnState(page);
  const blank = await page.evaluate((r0) => ({ stage: document.getElementById('guide-stage').childElementCount, raf: window.__kcRaf - r0, hidden: document.getElementById('tab-learn').hidden,
    tab: document.getElementById('tab-button-learn').textContent }), r0);
  check('learn', !once.installed && !once.figure && blank.stage === 0 && blank.raf === 0 && blank.hidden && blank.tab === DICT['tab.learn'],
    `${label}: the guide is not set up before the Learn tab opens, no figure and no rAF; tab 4 "${DICT['tab.learn']}"`, JSON.stringify({ once, blank }));
  // ---- the tab opens; the panel defaults are the same as the Calculator (the same result object)
  await page.click('#tab-button-learn');
  await page.waitForFunction(() => window.Mucellit.learn.probe.state().figure, null, { timeout: 10000 });
  const open = await learnState(page);
  const same = await page.evaluate(() => window.Mucellit.learn.probe.state().size.calc === window.Mucellit.calculator.state().result);
  const og = await learnTable(page, i18n), hs = await calculatorTable(page, i18n);
  const reconcile = { page: (h) => h.totalPages.slice(0, 1), signature: (h) => h.signatureCount, sheet: (h) => h.leaves, printing: (h) => h.printSheets, spine: (h) => h.spineThickness,
    board: (h) => h.board, strip: (h) => h.spineStrip, jointGap: (h) => h.jointGap, covering: (h) => h.covering, endpapers: (h) => h.endpapers, mull: (h) => h.mull, headbands: (h) => h.headbands };
  const difference = Object.entries(reconcile).filter(([k, f]) => JSON.stringify(og[k]) !== JSON.stringify(f(hs))).map(([k, f]) => `${k}: ${JSON.stringify(og[k])} ≠ ${JSON.stringify(f(hs))}`);
  const field = await page.evaluate(() => ['signatureCount', 'sheetsPerSignature', 'bookWidth', 'bookHeight', 'paperThickness'].map((a) => document.getElementById('guide-g-' + a).value));
  check('learn', open.installed && open.figure && open.visible && !open.manual && same && difference.length === 0 && Object.keys(og).length >= 12 && og.page[0] === 208 && og.signature[0] === 13 &&
    JSON.stringify(field) === JSON.stringify(['13', '4', '148', '210', i18n === 'tr' ? '0,1' : '0.1']),
    `${label}: the guide is set up when the tab opens; the numbers panel defaults are the same as the Calculator (the same calculation result object, 12 values)`, JSON.stringify({ difference, same, field, og: og.page }));
  // ---- global names: only under Mucellit
  const candidate = learnCandidates();
  const base = new Set(await page.evaluate(() => { const f = document.createElement('iframe'); document.body.appendChild(f); const l = Object.getOwnPropertyNames(f.contentWindow); f.remove(); return l; }));
  const defined = [];
  for (const a of candidate) { if (base.has(a)) continue; if (await page.evaluate(`typeof ${a} !== 'undefined'`).catch(() => false)) defined.push(a); }
  // elements with an id show through the browser's named access (window.fig === #fig): not a script declaration, counted apart
  const idElement = await page.evaluate((l) => l.filter((a) => { const e = document.getElementById(a); return !!e && window[a] === e; }), defined);
  const reported = defined.filter((a) => !idElement.includes(a));
  const window = await page.evaluate(() => ({ name: ['__st', '__ln', 'CF_SPEED', 'FIG_A', 'LBL_U', 'cfMount', 'mountFigure', 'PALS'].filter((a) => a in window),
    learn: Object.keys(window.Mucellit.learn).sort(), nolabels: document.documentElement.classList.contains('nolabels'), accent: document.documentElement.style.getPropertyValue('--accent'),
    dataErrors: document.documentElement.hasAttribute('data-errors') }));
  check('learn', reported.length === 0 && window.name.length === 0 && !window.nolabels && !window.accent && !window.dataErrors && ['cf', 'probe', 'size', 'tab'].every((a) => window.learn.includes(a)),
    `${label}: global names only under Mucellit (${candidate.length} candidate declarations, global ${reported.length}; names of elements with an id apart: ${idElement.length}; no html class/variable/data-errors leftover)`, JSON.stringify({ reported, idElement, window }));
  // ---- licence panel (the full MIT text the user can reach on the Mac)
  const lis = await page.evaluate(() => { const d = document.getElementById('guide-license'), p = document.getElementById('guide-license-text');
    // visibility: checkVisibility (the content of a closed details is hidden with content-visibility; offsetHeight is not 0 in Chromium)
    const visible = (e) => (typeof e.checkVisibility === 'function' ? e.checkVisibility() : e.offsetHeight > 0);
    const r = { var: !!d && !!p && !!d.closest('#guide-root'), summary: d ? d.querySelector('summary').textContent : '', closed: p ? !d.open && !visible(p) : null };
    if (d) d.querySelector('summary').click();
    return { ...r, isOpen: p ? d.open && visible(p) && p.offsetHeight > 0 : null, text: p ? p.textContent.trim() : '', lang: p ? p.lang : '', footnote: document.querySelector('#guide-root [data-i18n="learn.license"]').textContent }; });
  await page.evaluate(() => { const d = document.getElementById('guide-license'); if (d) d.open = false; });
  check('learn', lis.var && lis.summary === DICT['learn.license_text'] && lis.closed && lis.isOpen && lis.text === LEARN_LICENSE && lis.lang === 'en' && lis.footnote === DICT['learn.license'],
    `${label}: in Learn the "${DICT['learn.license_text']}" panel opens, the full MIT text exactly js/learn/LICENSE`, JSON.stringify({ ...lis, text: lis.text.slice(0, 40) }));
  // ---- 10 stages, 45 steps (4×)
  await page.selectOption('#guide-speed', '4');
  const lesson = await page.evaluate(() => window.Mucellit.learn.probe.lessons.map((d) => d.steps.length));
  const rest = [];
  let step = 0;
  for (let a = 0; a < lesson.length; a++) {
    await page.evaluate((a) => window.Mucellit.learn.probe.setup(a, 0), a);
    for (let j = 0; j < lesson[a]; j++) {
      const r = await page.evaluate(async (j) => { const p = window.Mucellit.learn.probe.run(j); return p && p.then ? await p : p; }, j);
      step++;
      if (r !== true) rest.push(`${a + 1}.${j + 1}`);
    }
  }
  const lastStep = await learnState(page);
  const card = await page.textContent('#guide-step-title');
  check('learn', step === 45 && lesson.length === 10 && rest.length === 0 && lastStep.a === 9 && lastStep.i === 4 && card === DICT['learn.finished_title'],
    `${label}: the 45 steps of the 10 stages played (4×), all started and finished; last card "${DICT['learn.finished_title']}"`, JSON.stringify({ step, rest, last: [lastStep.a, lastStep.i], card }));
  // ---- Sample Book (by hand) and a manual change not passing to the Calculator
  const ond = i18n === 'tr' ? '0,1' : '0.1';
  const accept = await page.evaluate((ond) => window.Mucellit.learn.probe.numbers({ signatureCount: '11', sheetsPerSignature: '4', bookWidth: '148', bookHeight: '210', paperThickness: ond }), ond);
  const tbElle = tbFarki(await learnTable(page, i18n));
  const manual = await learnState(page);
  const hValue = await page.evaluate(() => document.getElementById('h-pageCount').value);
  check('learn', accept === true && tbElle.length === 0 && manual.manual && hValue === '200',
    `${label}: Sample Book (11 signatures × 4, 148 × 210, 0.1 mm) exactly in the panel; a manual change does not change the Calculator`, JSON.stringify({ tbElle, manual: manual.manual, hValue }));
  // ---- the Calculator changes: the guide keeps the manual values; "Use values from the Calculator tab" binds; while bound it follows the Calculator (base from the Calculator)
  await writeCalculator(page, 'h-pageCount', 300);
  await page.click('#tab-button-learn');
  const manualStays = await learnState(page);
  await page.click('#guide-use-calculator');
  const taken = await learnState(page), takeTable = await learnTable(page, i18n);
  await writeCalculator(page, 'h-pageCount', 162);
  await page.click('#tab-button-learn');
  const tracks = await learnState(page), tbCalculator = tbFarki(await learnTable(page, i18n));
  const same2 = await page.evaluate(() => window.Mucellit.learn.probe.state().size.calc === window.Mucellit.calculator.state().result);
  check('learn', manualStays.manual && manualStays.input.signatureCount === 11 && !taken.manual && taken.input.signatureCount === 19 && takeTable.page[0] === 304 &&
    !tracks.manual && tracks.input.signatureCount === 11 && tbCalculator.length === 0 && same2,
    `${label}: when the Calculator changes the manual values stay; "${DICT['learn.take_from_calculator']}" binds to the Calculator (300 pages → 19 signatures); while bound it follows the Calculator (162 pages → Sample Book exactly)`,
    JSON.stringify({ manualStays: [manualStays.manual, manualStays.input.signatureCount], taken: [taken.manual, taken.input.signatureCount, takeTable.page], tracks: [tracks.manual, tracks.input.signatureCount], tbCalculator, same2 }));
  // ---- single leaf in the Calculator: the guide draws sewn, the match note shows; with a Calculator error a note, the previous numbers stay
  await writeCalculator(page, 'h-bindingType', 'single1');
  await page.click('#tab-button-learn');
  const match = await page.evaluate(() => ({ note: !document.getElementById('guide-match').hidden, d: window.Mucellit.learn.probe.state().match }));
  const matchTb = tbFarki(await learnTable(page, i18n));
  await writeCalculator(page, 'h-bindingType', 'sewn');
  await writeCalculator(page, 'h-bookWidth', 'abc');
  await page.click('#tab-button-learn');
  const failed = await page.evaluate(() => ({ note: document.getElementById('guide-number-note').hidden ? '' : document.getElementById('guide-number-note').textContent, signature: window.Mucellit.learn.probe.state().input.signatureCount }));
  await writeCalculator(page, 'h-bookWidth', 148);
  await page.click('#tab-button-learn');
  const fixed = await page.evaluate(() => ({ note: document.getElementById('guide-number-note').hidden, match: document.getElementById('guide-match').hidden }));
  check('learn', match.note && match.d === false && matchTb.length === 0 && failed.note === DICT['learn.calculator_error'] && failed.signature === 11 && fixed.note && fixed.match,
    `${label}: with single leaf in the Calculator the guide draws sewn + flat spine and shows a note; with a Calculator error the previous numbers stay, the note goes away when fixed`, JSON.stringify({ match, matchTb, failed, fixed }));
  // ---- with Learn open, pressing the tab again does not tear the guide down and set it up again; "start to end" skips no step
  await page.evaluate(() => window.Mucellit.learn.probe.setup(0, 0));
  await page.click('#guide-fromStart-toEnd');
  await page.waitForFunction(() => { const d = window.Mucellit.learn.probe.state(); return d.flow && d.playing && d.i >= 1; }, null, { timeout: 20000 });
  const yb0 = await page.evaluate(() => { const d = window.Mucellit.learn.probe.state(); window.__kcSt = d.st; window.__kcStage = document.getElementById('guide-stage').firstElementChild; return { a: d.a, i: d.i }; });
  await page.click('#tab-button-learn');
  const yb1 = await page.evaluate(() => { const d = window.Mucellit.learn.probe.state();
    return { sameSt: d.st === window.__kcSt, sameStage: document.getElementById('guide-stage').firstElementChild === window.__kcStage, playing: d.playing, flow: d.flow, a: d.a, i: d.i }; });
  await page.waitForFunction(([a, i]) => { const d = window.Mucellit.learn.probe.state(); return d.a !== a || d.i !== i || !d.flow; }, [yb0.a, yb0.i], { timeout: 20000 });
  const yb2 = await learnState(page);
  await page.click('#guide-fromStart-toEnd');   // stop
  await page.waitForFunction(() => !window.Mucellit.learn.probe.state().flow, null, { timeout: 10000 });
  check('learn', yb1.sameSt && yb1.sameStage && yb1.playing && yb1.flow && yb2.flow && yb2.a === yb0.a && yb2.i === yb0.i + 1,
    `${label}: pressing the Learn tab again while "start to end" runs does not set the figure up again, the playing step goes on, the next step in turn (no step skipped)`,
    JSON.stringify({ once: yb0, after: yb1, first: [yb2.a, yb2.i, yb2.flow] }));
  // ---- when the tab changes "start to end" stops, the figure is removed, no rAF call; back again it is set up at the same place
  await page.evaluate(() => window.Mucellit.learn.probe.setup(2, 0));
  await page.click('#guide-fromStart-toEnd');
  await page.waitForTimeout(1500);
  const whilePlaying = await learnState(page);
  await page.click('#tab-button-projects');
  const immediately = await learnState(page);
  const stage = await page.evaluate(() => document.getElementById('guide-stage').childElementCount);
  await page.waitForTimeout(300);
  const ra = await page.evaluate(() => window.__kcRaf);
  await page.waitForTimeout(1200);
  const rb = await page.evaluate(() => window.__kcRaf);
  const hiddenPosition = await learnState(page);
  await page.click('#tab-button-learn');
  const restored = await learnState(page);
  check('learn', whilePlaying.flow && !immediately.flow && !immediately.figure && !immediately.visible && stage === 0 && rb - ra === 0 && hiddenPosition.a === whilePlaying.a && restored.figure && restored.a === hiddenPosition.a && !restored.flow,
    `${label}: when the tab changes "start to end" stops, the figure is removed, rAF calls 0 in the hidden tab (1.2 s); back again set up at the same stage`,
    JSON.stringify({ whilePlaying: [whilePlaying.flow, whilePlaying.a], immediately: [immediately.flow, immediately.figure], stage, raf: rb - ra, restored: [restored.figure, restored.a] }));
  // ---- play from start to end (4×): to the end, order 1→10, the cover closed in the last frame
  await page.evaluate(() => window.Mucellit.learn.probe.setup(0, 0));
  const t0 = Date.now();
  await page.click('#guide-fromStart-toEnd');
  const order = [];
  let last = null;
  while (Date.now() - t0 < 240000) {
    const d = await learnState(page);
    if (!order.length || order[order.length - 1] !== d.a + 1) order.push(d.a + 1);
    if (!d.flow) { last = d; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  const button = await page.textContent('#guide-fromStart-toEnd');
  check('learn', last && last.finished && last.a === 9 && last.i === 4 && last.isOpen === 0 && JSON.stringify(order) === '[1,2,3,4,5,6,7,8,9,10]' && button === DICT['learn.from_start_to_end'],
    `${label}: play from start to end (4×) finished: stage order 1→10, 4/4 at the last stage, cover closed (${Math.round((Date.now() - t0) / 1000)} sn)`, JSON.stringify({ order, last: last && [last.finished, last.a, last.i, last.isOpen], button }));
  // ---- CSP violations 0 (Tauri CSP header), missing keys 0, no error in the app notice
  const lastTrace = await page.evaluate(() => ({ csp: window.__kcCsp.slice(), missing: window.Mucellit.i18n.missingKeys().filter((a) => /^(learn|tab)\./.test(a)), notice: document.getElementById('notice').className }));  // turkish-ok: expected Turkish UI text
  check('learn', lastTrace.csp.length === 0 && lastTrace.missing.length === 0 && !/hata/.test(lastTrace.notice),  // turkish-ok: expected Turkish UI text
    `${label}: during Learn CSP violations 0 (Tauri CSP header), missing learn.* keys 0, no error notice`, JSON.stringify(lastTrace));
  // ---- language change: after the reload the Learn tab is open, the guide in the new language, stage/step kept
  const other = i18n === 'tr' ? 'en' : 'tr';
  const OTHER = D.extractJson(readFileSync(join(APP, 'i18n', other + '.js'), 'utf8'));
  await page.evaluate(() => window.Mucellit.learn.probe.setup(2, 2));
  const onceDone = (await learnState(page)).done;
  const onceProgress = await page.evaluate(() => document.getElementById('guide-progress-text').textContent.match(/\d+/g).join('/'));
  await Promise.all([page.waitForEvent('load'), page.selectOption('#i18n-select', other)]);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.waitForFunction(() => window.Mucellit.learn.probe.state().figure, null, { timeout: 10000 });
  const yd = await learnState(page);
  const ym = await page.evaluate(() => ({ tab: document.getElementById('tab-button-learn').textContent, selected: document.getElementById('tab-button-learn').getAttribute('aria-selected'),
    title: document.querySelector('#guide-root [data-i18n="learn.title"]').textContent, step: document.getElementById('guide-step-title').textContent, play: document.getElementById('guide-play').textContent,
    lang: document.documentElement.lang, error: document.documentElement.dataset.errors || null }));
  const visible = other === 'en' ? await visibleText(page) : '';
  check('learn', ym.lang === other && ym.tab === OTHER['tab.learn'] && ym.selected === 'true' && ym.title === OTHER['learn.title'] && ym.step === OTHER['learn.sewing.second.title'] &&
    ym.play === OTHER['learn.play'] && yd.a === 2 && yd.i === 2 && (other !== 'en' || !trLetter(visible)),
    `${label}: language ${i18n} → ${other}: after the reload Learn is open, the guide ${other} (title, step, button), stage 3 step 3 kept${other === 'en' ? ', no Turkish letter in the visible text' : ''}`,
    JSON.stringify({ ym, position: [yd.a, yd.i], tr: other === 'en' ? (visible.match(new RegExp('.{0,20}' + TR_LETTER.source + '.{0,20}')) || [''])[0] : '' }));
  const afterProgress = await page.evaluate(() => document.getElementById('guide-progress-text').textContent.match(/\d+/g).join('/'));
  check('learn', onceDone.reduce((s, v) => s + v, 0) > 0 && JSON.stringify(yd.done) === JSON.stringify(onceDone) && afterProgress === onceProgress,
    `${label}: language ${i18n} → ${other}: the progress of the stages (done) and the overall progress (${onceProgress}) kept`, JSON.stringify({ onceDone, after: yd.done, onceProgress, afterProgress }));
  await noMissingKey(page, label + ' (' + other + ')');
}

/** prefers-reduced-motion: each of the 45 steps finishes without animation (≤150 ms, ≤1 frame, the step end state, transition 0 s). */
async function m7ReduceLearn(browser, address, label, local) {
  const ctx = await browser.newContext({ locale: local, reducedMotion: 'reduce', viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const iz = watch(page, label);
  try {
    await setupLearnCheck(page);
    await page.goto(address);
    await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
    await page.click('#tab-button-learn');
    await page.waitForFunction(() => window.Mucellit.learn.probe.state().figure, null, { timeout: 10000 });
    const lesson = await page.evaluate(() => window.Mucellit.learn.probe.lessons.map((d) => d.steps.length));
    const fail = [];
    let step = 0;
    for (let a = 0; a < lesson.length; a++) for (let j = 0; j < lesson[a]; j++) {
      const r = await page.evaluate(async ([a, j]) => {
        const D = window.Mucellit.learn.probe, clean = (st) => JSON.stringify(st, (k, v) => (/T$|K$|^anim|^firca$|^_/.test(k) ? undefined : typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
        D.setup(a, j + 1); const target = clean(D.state().st);
        D.setup(a, j); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const art = document.getElementById('art'); let drawing = 0; const mo = new MutationObserver(() => drawing++); mo.observe(art, { childList: true });
        const t0 = performance.now(); const p = D.run(j); const ok = p && p.then ? await p : p; const sure = performance.now() - t0;
        await new Promise((r) => setTimeout(r, 0)); mo.disconnect();
        const transition = getComputedStyle(document.getElementById('figF')).transitionDuration;
        const H = JSON.parse(target), G = JSON.parse(clean(D.state().st)), difference = Object.keys({ ...H, ...G }).filter((x) => JSON.stringify(H[x]) !== JSON.stringify(G[x]));
        return { ok, sure: Math.round(sure), drawing, difference, transition };
      }, [a, j]);
      step++;
      const problem = [];
      if (r.ok !== true) problem.push('did not start'); if (r.sure > 150) problem.push(`duration ${r.sure} ms`); if (r.drawing > 1) problem.push(`${r.drawing} gap square`);
      if (r.difference.length) problem.push('end state differs: ' + r.difference.join(',')); if (!/^0s(, 0s)*$/.test(r.transition)) problem.push('transition ' + r.transition);
      if (problem.length) fail.push(`${a + 1}.${j + 1}: ${problem.join(', ')}`);
    }
    check('learn', step === 45 && fail.length === 0, `${label}: prefers-reduced-motion: each of the 45 steps finishes without animation (≤150 ms, ≤1 frame, the step end state, transition 0 s)`, JSON.stringify({ step, fail: fail.slice(0, 5) }));
  } catch (e) {
    check('learn', false, `${label}: the reduced motion run stopped halfway: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
  }
  check('learn', iz.errors.length === 0, `${label}: no console error in the reduced motion run`, iz.errors.slice(0, 3).join(' | ') || '0 errors');
  await ctx.close();
}

/**
 * A short Learn check for file:// and the Tauri simulation, with the DOM only (the product code as it is; no test
 * injection): the tab (or the menu event) opens the guide, a step plays; no probe interface in the product code; not
 * set up again when pressed again.
 */
async function m7LearnSmoke(page, address, label, menu) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const open = () => (menu ? page.evaluate(() => window.__fake.listener.menu({ payload: 'tab-learn' })) : page.click('#tab-button-learn'));
  await open();
  await page.waitForFunction(() => document.getElementById('guide-stage').childElementCount > 0 && document.getElementById('guide-root').dataset.state === 'ready', null, { timeout: 10000 });
  await page.selectOption('#guide-speed', '4');
  await page.click('#guide-play');
  await page.waitForFunction(() => document.querySelectorAll('#guide-steps li.finished').length === 1 && document.getElementById('guide-root').dataset.state === 'ready', null, { timeout: 15000 });
  const d = await page.evaluate(() => ({ selected: document.getElementById('tab-button-learn').getAttribute('aria-selected'), visible: !document.getElementById('tab-learn').hidden,
    finished: document.querySelectorAll('#guide-steps li.finished').length, current: Array.from(document.querySelectorAll('#guide-steps li')).findIndex((l) => l.classList.contains('current')) }));
  check('learn', d.selected === 'true' && d.visible && d.finished === 1 && d.current === 1,
    `${label}: ${menu ? 'menu event "tab-learn" (View > Learn ⌘4)' : 'Learn tab'} opens the guide, the first step plays`, JSON.stringify(d));
  const product = await page.evaluate(() => Object.keys(window.Mucellit.learn).sort());
  check('learn', !product.includes('probe') && product.includes('tab'),
    `${label}: no test interface in the product code (Mucellit.learn.probe undefined; only tab/size/cf/…)`, JSON.stringify(product));
  await page.evaluate(() => { window.__kcStage = document.getElementById('guide-stage').firstElementChild; });
  await open();
  const y = await page.evaluate(() => ({ same: document.getElementById('guide-stage').firstElementChild === window.__kcStage, finished: document.querySelectorAll('#guide-steps li.finished').length,
    current: Array.from(document.querySelectorAll('#guide-steps li')).findIndex((l) => l.classList.contains('current')) }));
  check('learn', y.same && y.finished === 1 && y.current === 1,
    `${label}: with Learn open, ${menu ? 'menu event (⌘4)' : 'tab'} coming again does not set the guide up again (same figure, same step)`, JSON.stringify(y));
  if (menu) {
    await page.evaluate(() => window.__fake.listener.menu({ payload: 'tab-calculator' }));
    const g = await page.evaluate(() => ({ stage: document.getElementById('guide-stage').childElementCount, calculator: !document.getElementById('tab-calculator').hidden }));
    check('learn', g.stage === 0 && g.calculator, `${label}: moving to another tab from the menu (⌘3) removes the guide figure`, JSON.stringify(g));
  }
}

async function main() {
  const pw = await loadPlaywright();
  const engine = pw[ENGINE];
  if (!engine || typeof engine.launch !== 'function') { console.error(`Unknown engine: ${ENGINE} (chromium | webkit)`); process.exit(2); }
  console.log(`Motor: ${ENGINE}`);
  const server = await startServer();
  const port = server.address().port;
  const localRoot = formatUrl({ protocol: 'http:', slashes: true, hostname: '127.0.0.1', port, pathname: '/' });
  const browser = await engine.launch();
  let code = 0;
  async function run(label, criterionFlow, address, localPrefix, body, local = 'tr-TR') {
    // browser language = system language (navigator.languages); the existing runs use the Turkish interface
    const ctx = await browser.newContext({ acceptDownloads: true, locale: local });
    const p = await ctx.newPage();
    p.setDefaultTimeout(60000);
    const iz = watch(p, label);
    try {
      await body(p, address, iz);
    } catch (e) {
      const first = String(e && e.message ? e.message : e).split('\n')[0];
      check(criterionFlow, false, `${label} run stopped halfway: ${first}`, iz.errors.length ? 'console: ' + iz.errors.slice(0, 2).map((h) => h.slice(0, 200)).join(' | ') : undefined);
    }
    check(5, iz.errors.length === 0, `${label} run: no console error`, iz.errors.length ? `${iz.errors.length} errors, first: ` + iz.errors.slice(0, 3).map((h) => h.slice(0, 200)).join(' | ') : '0 errors');
    agCheck(iz, localPrefix, label, 4);
    await ctx.close();
    return iz;
  }
  try {
    // ---- Run 1: local server (criteria 2, 3) ----
    await run('server', '2/3', localRoot + 'index.html', localRoot, async (p, address, iz) => {
      await pdfFlow(p, address, 'server', 2, true);
      await projectsFlow(p);
      await setupHelpers(p);
      await ayFlowTwo(p, 'server');
      await ayBoxes(p, 'server');
      await ayBlankToStart(p, address, 'server');
      await encryptedFlow(p, address, iz, 'server');
      await uiChecks(p, address, 'server');
      await osStorageFlow(p, address, 'server');
      await epubFlow(p, address, 'server');
      await bdFlow(p, address, 'server');
      await confirmFlow(p, address, iz, 'server');
      await releaseFlow(p, address, 'server');
      await m1FixFlow(p, address, iz, 'server', true);
      await m2EpubZipFlow(p, address, 'server');
      await m6TrCheck(p, address, 'server');
    });
    // ---- Run 1b: local server, with a fake __TAURI__ ----
    await run('tauri-simulation', 'file', localRoot + 'index.html', localRoot, async (p, address, iz) => {
      await m2TauriSimulation(p, address, 'tauri-simulation');
      await m6TauriI18n(p, address, 'tauri-simulation');
      await m3Printing(p, address, 'tauri-simulation');
      await m3NoTauriI18n(p, address, iz, 'tauri-simulation');
      await m7LearnSmoke(p, address, 'tauri-simulation', true);
    });
    // ---- Run 1d: start-up error simulation, tr-TR ----
    await run('startup-error', 'i18n', localRoot + 'index.html', localRoot, async (p, address, iz) => {
      await m6StartupError(p, address, iz, 'startup-error');
    });
    // ---- Run 1e: Learn guide, with the Tauri CSP header; tr-TR and en-US; reduced motion ----
    await run('learn', 'learn', localRoot + 'index.html', localRoot, async (p, address, iz) => {
      await m7LearnFlow(p, address, iz, 'learn', 'tr');
    });
    await run('learn en', 'learn', localRoot + 'index.html', localRoot, async (p, address, iz) => {
      await m7LearnFlow(p, address, iz, 'learn en', 'en');
    }, 'en-US');
    await m7ReduceLearn(browser, localRoot + 'index.html', 'learn reduced', 'tr-TR');
    await m7ReduceLearn(browser, localRoot + 'index.html', 'learn reduced en', 'en-US');
    // ---- Run 1c: English interface, en-US browser ----
    await run('en', 'i18n', localRoot + 'index.html', localRoot, async (p, address, iz) => {
      await m6MostFlow(p, address, iz, 'en', true);
    }, 'en-US');
    // ---- Run 2: file:// (criterion 6) ----
    const iz2 = await run('file://', 6, pathToFileURL(join(APP, 'index.html')).href, 'file://', async (p, address, iz) => {
      await pdfFlow(p, address, 'file://', 6, false);
      await confirmFlow(p, address, iz, 'file://');
      await m1FixFlow(p, address, iz, 'file://', false);
      await epubFlow(p, address, 'file://');
      await bdFlow(p, address, 'file://');
      await epubPerformance(p, address, 'file://');
      await m2EpubZipFlow(p, address, 'file://');
      await m6TrCheck(p, address, 'file://');
      await m7LearnSmoke(p, address, 'file://', false);
    });
    // ---- Run 2b: file://, English smoke ----
    await run('en file://', 'i18n', pathToFileURL(join(APP, 'index.html')).href, 'file://', async (p, address, iz) => {
      await m6MostFlow(p, address, iz, 'en file://', false);
    }, 'en-US');
    check(6, iz2.errors.length === 0, 'file:// run: no console error (criterion 6)');
  } catch (e) {
    check('-', false, 'unexpected error', e && e.stack ? e.stack : String(e));
  } finally {
    await browser.close();
    server.close();
  }
  const rest = results.filter((s) => !s.pass);
  console.log(`\nSUMMARY: ${results.length} checks, ${results.length - rest.length} passed, ${rest.length} failed`);
  if (rest.length) code = 1;
  process.exit(code);
}

main();
