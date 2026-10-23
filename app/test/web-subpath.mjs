/*
 * web-subpath.mjs — tests the static site to be published (dist/) under a SUB PATH, as on GitHub Pages.
 * Run (from the repository root):  node app/test/web-subpath.mjs [--engine=chromium|webkit] [--dist <folder>] [--faulty]
 *
 * Default: dist/ is set up first with `node tools/prepare-dist.mjs --web --quiet`; with --dist that folder is tested as
 * it is. The local static server serves only under /mucellit-test/ (every other path is a 404 and a FAIL: a file that
 * uses an absolute path is caught); it sends no CSP header (like GitHub Pages).
 *
 * A separate context for each language (tr-TR and en-US):
 *   start-up (data-ready, tab names in the chosen language, platform = browser), no desktop-only text/button shows (in
 *   the visible text of the four tabs and the title/aria-label/placeholder of visible elements no Mac/macOS/⌘/Tauri/
 *   Finder/Dock/Open in Preview; the Print area hidden), PDF imposition (37 pages → sewn, 297 × 210, 4 sheets → 24
 *   pages, page 1 16 | 1), Learn (the guide is set up, a step plays, the licence panel exactly js/learn/LICENSE),
 *   switching to the other language with the language picker and back (the reload stays on the sub path), the licence
 *   files reachable on the site and identical to the repository; console errors 0, requests outside the sub path or
 *   outside network requests 0.
 *
 * --faulty: tests the check itself. For broken copies of dist/ (empty folder, no index.html, a script with an absolute
 *   path, a request to an outside address, a visible Mac button, no LICENSE, a broken Learn licence panel, a console
 *   error) the check must give at least one FAIL; when it does not, this run FAILs.
 * Environment: MC_PLAYWRIGHT (Playwright module folder, e.g. /path/playwright/node_modules/playwright), PLAYWRIGHT_BROWSERS_PATH.
 * Exit code: 0 = all checks passed; 1 = at least one FAIL; 2 = usage error.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SUB_PATH = '/mucellit-test/';
const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=chromium').slice('--engine='.length);
const FAULTY = process.argv.includes('--faulty');
const distArg = (() => { const i = process.argv.indexOf('--dist'); return i > 0 ? process.argv[i + 1] : null; })();
const LICENSES = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'vendor/SOURCES.md', 'vendor/pdf-lib/LICENSE.md', 'vendor/pdfjs/LICENSE',
  'vendor/fontkit/LICENSE', 'vendor/literata/OFL.txt', 'js/learn/LICENSE'];
/** Desktop (Mac/Tauri) traces that must not show in the browser version. */
const DESKTOP = /\bMac\b|macOS|⌘|Tauri|Finder|\bDock\b|Önizleme'de|Open in Preview/;  // turkish-ok: expected Turkish UI text
const EXPECTED = { tr: { tab: ['Düzenle', 'Süreç', 'Hesapla', 'Öğren'], suffix: '-dizilmis.pdf' }, en: { tab: ['Imposition', 'Projects', 'Calculator', 'Learn'], suffix: '-imposed.pdf' } };  // turkish-ok: expected Turkish UI text

async function loadPlaywright() {
  if (process.env.MC_PLAYWRIGHT) return await import(pathToFileURL(join(resolve(process.env.MC_PLAYWRIGHT), 'index.mjs')).href);
  try { return await import('playwright'); } catch {
    const root = execSync('npm root -g').toString().trim();
    return await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

/** A static server that serves only under SUB_PATH; records requests outside the sub path. */
function startServer(root) {
  const out = [];
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    if (path === SUB_PATH.slice(0, -1)) { response.writeHead(301, { location: SUB_PATH }); return response.end(); }
    if (!path.startsWith(SUB_PATH)) { out.push(path); response.writeHead(404); return response.end(); }
    try {
      let file = resolve(root, '.' + '/' + path.slice(SUB_PATH.length));
      if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403); return response.end(); }
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
      const content = await readFile(file);
      response.writeHead(200, { 'content-type': MIME[extname(file)] || (/LICENSE|OFL/.test(file) ? 'text/plain; charset=utf-8' : 'application/octet-stream') });
      response.end(content);
    } catch { response.writeHead(404); response.end(); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, out })));
}

async function makeTestPdf(page) {
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

async function inspectPdf(page, bytes) {
  return page.evaluate(async (array) => {
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(array), isEvalSupported: false }).promise;
    const s = await pdf.getPage(1);
    const vp = s.getViewport({ scale: 1 });
    const tc = await s.getTextContent();
    const elements = tc.items.filter((o) => o.str.trim()).map((o) => ({ str: o.str.trim(), x: o.transform[4], w: o.width })).sort((a, b) => a.x - b.x);
    return { page: pdf.numPages, mm: [vp.width * 25.4 / 72, vp.height * 25.4 / 72], first: elements.map((o) => o.str + ':' + (o.x + o.w / 2 < vp.width / 2 ? 'left' : 'right')) };
  }, Array.from(bytes));
}

/** The visible text + the title/aria-label/placeholder of visible elements (except the language picker). */
async function visibleText(page) {
  return page.evaluate(() => {
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll('#i18n-select, script, [hidden], template').forEach((e) => e.remove());
    const oz = Array.from(document.querySelectorAll('[title],[aria-label],[placeholder]'))
      .filter((e) => e.id !== 'i18n-select' && e.offsetParent !== null)
      .map((e) => [e.title, e.getAttribute('aria-label'), e.placeholder].filter(Boolean).join(' ')).join(' ');
    return copy.innerText + ' ' + oz + ' ' + document.title;
  });
}

/** Tests a dist folder in two languages; returns the result list. */
async function verify(pw, distRoot, { quiet = false, time = 60000 } = {}) {
  const result = [];
  const check = (condition, message, detail) => {
    result.push({ pass: !!condition, message });
    if (!quiet) console.log(`${condition ? 'PASS' : 'FAIL'} ${message}${detail !== undefined ? ' — ' + detail : ''}`);
  };
  const root = resolve(distRoot);
  const { server, out } = await startServer(root);
  const serverRoot = `http://127.0.0.1:${server.address().port}`;
  const site = serverRoot + SUB_PATH;
  const browser = await pw[ENGINE].launch();
  try {
    for (const [i18n, local] of [['tr', 'tr-TR'], ['en', 'en-US']]) {
      const et = `[${ENGINE} ${i18n}]`;
      const ctx = await browser.newContext({ acceptDownloads: true, locale: local, viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      page.setDefaultTimeout(time);
      const errors = [], requests = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('request', (r) => requests.push(r.url()));
      page.on('dialog', (d) => d.accept());
      try {
        // ---- start-up (sub path, without the trailing / too)
        await page.goto(site.slice(0, -1));
        await page.waitForSelector('html[data-ready="yes"]', { timeout: Math.min(time, 20000) });
        const a = await page.evaluate(() => ({ url: location.href, lang: document.documentElement.lang, platform: window.Mucellit.platform.name,
          tabs: ['impose', 'projects', 'calculator', 'learn'].map((s) => document.getElementById('tab-button-' + s).textContent.trim()) }));
        check(a.url === site && a.lang === i18n && a.platform === 'browser' && JSON.stringify(a.tabs) === JSON.stringify(EXPECTED[i18n].tab),
          `${et} start-up: ${SUB_PATH} ready, language ${i18n}, platform browser, tab names in the chosen language`, JSON.stringify(a));

        // ---- no desktop-only text/button (four tabs)
        const tracks = [];
        for (const s of ['impose', 'projects', 'calculator', 'learn']) {
          await page.click('#tab-button-' + s);
          const m = (await visibleText(page)).match(new RegExp(DESKTOP.source, 'g'));
          if (m) tracks.push(s + ': ' + [...new Set(m)].join(', '));
        }
        await page.click('#tab-button-impose');
        const y = await page.evaluate(() => ({ print: window.Mucellit.platform.print, field: document.getElementById('print-field').hidden,
          visible: !!document.getElementById('print').offsetParent || !!(document.getElementById('inPreview-open') || {}).offsetParent }));
        check(tracks.length === 0 && y.print === null && y.field && !y.visible,
          `${et} no desktop-only text/button shows (4 tabs; Print/Open in Preview hidden)`, tracks.length ? tracks.join(' | ') : JSON.stringify(y));

        // ---- switching to the other language with the language picker and back (the reload stays on the sub path)
        const other = i18n === 'tr' ? 'en' : 'tr';
        await Promise.all([page.waitForEvent('load'), page.selectOption('#i18n-select', other)]);
        await page.waitForSelector('html[data-ready="yes"]');
        const g1 = await page.evaluate(() => ({ url: location.href, lang: document.documentElement.lang, tab: document.getElementById('tab-button-impose').textContent.trim() }));
        await Promise.all([page.waitForEvent('load'), page.selectOption('#i18n-select', 'system')]);
        await page.waitForSelector('html[data-ready="yes"]');
        const g2 = await page.evaluate(() => ({ url: location.href, lang: document.documentElement.lang, tab: document.getElementById('tab-button-impose').textContent.trim() }));
        check(g1.url === site && g1.lang === other && g1.tab === EXPECTED[other].tab[0] && g2.url === site && g2.lang === i18n && g2.tab === EXPECTED[i18n].tab[0],
          `${et} language picker: ${other} → system (${i18n}); the page reloads on the sub path`, JSON.stringify({ g1, g2 }));

        // ---- PDF dizme
        await page.click('#tab-button-impose');
        const pdf = await makeTestPdf(page);
        await page.setInputFiles('#pdf-file', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
        await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 37);
        await page.selectOption('#binding-type', 'sewn');
        await page.fill('#paper-width', '297');
        await page.fill('#paper-height', '210');
        await page.fill('#book-width', '148');
        await page.fill('#book-height', '210');
        await page.fill('#signature-sheet', '4');
        await page.waitForFunction(() => document.querySelectorAll('#sheet-preview .sheet-card').length === 12);
        await page.waitForSelector('#small-thumbs[data-thumbs-ready="yes"]');
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-transfer')]);
        const output = await readFile(await download.path());
        const r = await inspectPdf(page, output);
        check(download.suggestedFilename().endsWith(EXPECTED[i18n].suffix) && r.page === 24 && Math.abs(r.mm[0] - 297) < 0.5 && Math.abs(r.mm[1] - 210) < 0.5
          && JSON.stringify(r.first) === '["16:left","1:right"]',
          `${et} PDF imposition: 37 pages → sewn 4 sheets, 24 pages 297 × 210 mm, page 1 16 | 1`, JSON.stringify({ name: download.suggestedFilename(), ...r }));

        // ---- Learn
        await page.click('#tab-button-learn');
        await page.waitForFunction(() => document.getElementById('guide-stage').childElementCount > 0 && document.getElementById('guide-root').dataset.state === 'ready', null, { timeout: Math.min(time, 15000) });
        await page.selectOption('#guide-speed', '4');
        await page.click('#guide-play');
        await page.waitForFunction(() => document.querySelectorAll('#guide-steps li.finished').length === 1 && document.getElementById('guide-root').dataset.state === 'ready', null, { timeout: Math.min(time, 15000) });
        const o = await page.evaluate(() => ({ stage: document.querySelectorAll('#guide-stages li').length, tab: document.getElementById('tab-button-learn').textContent.trim(),
          license: document.getElementById('guide-license-text').textContent.trim() }));
        const learnLicense = existsSync(join(root, 'js/learn/LICENSE')) ? readFileSync(join(root, 'js/learn/LICENSE'), 'utf8').trim() : null;
        check(o.stage === 10 && o.tab === EXPECTED[i18n].tab[3] && learnLicense !== null && o.license === learnLicense,
          `${et} Learn: the guide is set up (10 stages), a step plays, the licence panel exactly js/learn/LICENSE`, JSON.stringify({ ...o, license: o.license.slice(0, 30) }));

        // ---- the licence files are reachable on the site (with a relative path) and identical to the repository
        const lis = await page.evaluate(async (l) => Promise.all(l.map(async (g) => { const y = await fetch(g); return [g, y.status, y.ok ? await y.text() : ''] })), LICENSES);
        const repoCounterpart = (g) => (g === 'LICENSE' || g === 'THIRD_PARTY_NOTICES.md' ? join(REPO, g) : join(REPO, 'app', g));
        const faulty = lis.filter(([g, state, text]) => state !== 200 || text !== readFileSync(repoCounterpart(g), 'utf8')).map(([g, d]) => g + ':' + d);
        check(faulty.length === 0, `${et} licence files reachable on the site and identical to the repository (${LICENSES.length} file)`, faulty.length ? faulty.join(', ') : undefined);
      } catch (e) {
        check(false, `${et} run stopped halfway: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
      }
      check(errors.length === 0, `${et} no console error`, errors.length ? errors.slice(0, 3).map((h) => h.slice(0, 200)).join(' | ') : '0 errors');
      const outer = requests.filter((u) => !(u.startsWith(site) || u.startsWith('data:') || u.startsWith('blob:') || u === site.slice(0, -1)));
      check(outer.length === 0 && out.length === 0, `${et} no outside network request and no request outside the sub path`,
        outer.length || out.length ? JSON.stringify({ outer: [...new Set(outer)].slice(0, 5), altPathOutside: [...new Set(out)].slice(0, 5) }) : `${requests.length} requests, all under ${SUB_PATH}`);
      out.length = 0;
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  return result;
}

/** Broken dist copies: [name, corrupting function(folder)]. */
const CORRUPT = [
  ['empty folder', (d) => { rmSync(d, { recursive: true, force: true }); mkdirSync(d); }],
  ['no index.html', (d) => rmSync(join(d, 'index.html'))],
  ['script with an absolute path', (d) => change(d, 'index.html', '<script src="js/calc.js"></script>', '<script src="/js/calc.js"></script>')],
  ['request to an outside address', (d) => change(d, 'index.html', '</body>', '<img src="https://example.com/x.png" alt=""></body>')],
  // removing the hidden attribute in index.html is not a fault (impose.js sets the visibility at run time from
  // platform.print); the real fault is the browser platform offering printing → the Print button shows in the browser.
  ['visible Mac button', (d) => change(d, 'js/platform.js', 'print: null,', 'print: function () { return Promise.resolve(true); },')],
  ['Mac text visible', (d) => change(d, 'index.html', '</header>', '<p>Open in Preview (⌘P)</p></header>')],
  ['no LICENSE', (d) => rmSync(join(d, 'LICENSE'))],
  ['THIRD_PARTY_NOTICES.md partly broken', (d) => writeFileSync(join(d, 'THIRD_PARTY_NOTICES.md'), readFileSync(join(d, 'THIRD_PARTY_NOTICES.md'), 'utf8').slice(0, 200))],
  ['Learn licence panel broken', (d) => change(d, 'index.html', 'Copyright (c) 2026 Tolga Cohce', 'Copyright (c) 2026 X')],
  ['console error', (d) => change(d, 'index.html', '</body>', '<script>console.error("fault")</script></body>')],
];
function change(d, relative, old, fresh) {
  const y = join(d, relative);
  const m = readFileSync(y, 'utf8');
  if (!m.includes(old)) throw new Error(`corruption pattern not found (${relative}): ${old}`);
  writeFileSync(y, m.replace(old, fresh));
}

async function main() {
  const pw = await loadPlaywright();
  if (!pw[ENGINE] || typeof pw[ENGINE].launch !== 'function') { console.error(`Unknown engine: ${ENGINE} (chromium | webkit)`); process.exit(2); }
  let dist = distArg ? resolve(distArg) : join(REPO, 'dist');
  if (!distArg) {
    const h = spawnSync(process.execPath, [join(REPO, 'tools', 'prepare-dist.mjs'), '--web', '--quiet'], { encoding: 'utf8' });
    process.stdout.write(h.stdout + h.stderr);
    if (h.status !== 0) { console.log('FAIL dist-prepare --web failed'); process.exit(1); }
  }
  if (!existsSync(dist)) { console.error('no dist folder: ' + dist); process.exit(2); }
  console.log(`Motor: ${ENGINE}; site: ${dist} → ${SUB_PATH}`);

  if (!FAULTY) {
    const s = await verify(pw, dist);
    const rest = s.filter((x) => !x.pass);
    console.log(`\nSUMMARY: ${s.length} checks, ${s.length - rest.length} passed, ${rest.length} failed`);
    process.exit(rest.length ? 1 : 0);
  }

  // --faulty: on every broken copy the check must give at least one FAIL
  const tmp = mkdtempSync(join(tmpdir(), 'mc-alt-path-'));
  let escaping = 0;
  try {
    for (const [name, corrupt] of CORRUPT) {
      const d = join(tmp, name.replace(/[^a-z0-9]+/gi, '-'));
      cpSync(dist, d, { recursive: true });
      corrupt(d);
      const s = await verify(pw, d, { quiet: true, time: 8000 });
      const rest = s.filter((x) => !x.pass);
      const caught = rest.length > 0;
      if (!caught) escaping += 1;
      console.log(`${caught ? 'PASS' : 'FAIL'} [faulty] ${name}: check ${caught ? 'said FAIL' : 'MISSED'} (${rest.length}/${s.length} checks failed${rest.length ? '; first: ' + rest[0].message.slice(0, 110) : ''})`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\nSUMMARY (faulty): ${CORRUPT.length} broken copies, ${CORRUPT.length - escaping} caught, ${escaping} missed`);
  process.exit(escaping ? 1 : 0);
}

main();
