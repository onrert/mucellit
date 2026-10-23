/*
 * web-subpath.mjs — yayınlanacak statik siteyi (dist/) GitHub Pages'teki gibi bir ALT YOL altında sınar.
 * Çalıştırma (repo kökünden):  node app/test/web-subpath.mjs [--motor=chromium|webkit] [--dist <klasör>] [--kusurlu]
 *
 * Öntanımlı: önce `node tools/prepare-dist.mjs --web --sessiz` ile dist/ kurulur; --dist verilirse o klasör olduğu
 * gibi sınanır. Yerel statik sunucu yalnız /kitap-cilt-test/ altını sunar (başka her yol 404 ve KALDI: mutlak yol
 * kullanan bir dosya yakalanır); CSP başlığı göndermez (GitHub Pages gibi).
 *
 * Her dil için ayrı bağlam (tr-TR ve en-US):
 *   açılış (data-hazir, sekme adları seçili dilde, platform = tarayıcı), masaüstüne özgü metin/düğme görünmüyor (dört
 *   sekmede görünen metin ve görünür öğelerin title/aria-label/placeholder'ında Mac/macOS/⌘/Tauri/Finder/Dock/Önizleme'de
 *   Aç yok; Yazdır alanı gizli), PDF dizme (37 sayfa → formalı, 297 × 210, 4 yaprak → 24 sayfa, 1. sayfa 16 | 1),
 *   Öğren (rehber kurulur, bir adım oynar, lisans paneli js/learn/LICENSE ile birebir), dil seçiciyle öteki dile geçiş
 *   ve geri dönüş (yeniden yükleme alt yolda kalır), lisans dosyaları sitede erişilebilir ve repodakiyle birebir;
 *   konsol hatası 0, alt yol dışı ya da dış ağ isteği 0.
 *
 * --kusurlu: denetimin kendisini sınar. dist/'in bozuk kopyaları (boş klasör, index.html yok, mutlak yollu betik,
 *   dış adrese istek, görünür Mac düğmesi, LICENSE yok, bozuk Öğren lisans paneli, konsol hatası) için denetim
 *   en az bir KALDI vermelidir; vermezse bu koşu KALDI olur.
 * Ortam: KC_PLAYWRIGHT (Playwright modül klasörü, ör. /yol/playwright/node_modules/playwright), PLAYWRIGHT_BROWSERS_PATH.
 * Çıkış kodu: 0 = bütün kontroller geçti; 1 = en az bir KALDI; 2 = kullanım hatası.
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
const ALT_PATH = '/kitap-cilt-test/';
const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=chromium').slice('--engine='.length);
const FAULTY = process.argv.includes('--faulty');
const distArg = (() => { const i = process.argv.indexOf('--dist'); return i > 0 ? process.argv[i + 1] : null; })();
const LICENSES = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'vendor/SOURCES.md', 'vendor/pdf-lib/LICENSE.md', 'vendor/pdfjs/LICENSE',
  'vendor/fontkit/LICENSE', 'vendor/literata/OFL.txt', 'js/learn/LICENSE'];
/** Tarayıcı sürümünde görünmemesi gereken masaüstü (Mac/Tauri) izleri. */
const DESKTOP = /\bMac\b|macOS|⌘|Tauri|Finder|\bDock\b|Önizleme'de|Open in Preview/;
const PROMISE = { tr: { tab: ['Düzenle', 'Süreç', 'Hesapla', 'Öğren'], ek: '-dizilmis.pdf' }, en: { tab: ['Imposition', 'Projects', 'Calculator', 'Learn'], ek: '-imposed.pdf' } };

async function loadPlaywright() {
  if (process.env.MC_PLAYWRIGHT) return await import(pathToFileURL(join(resolve(process.env.MC_PLAYWRIGHT), 'index.mjs')).href);
  try { return await import('playwright'); } catch {
    const root = execSync('npm root -g').toString().trim();
    return await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

/** Yalnız ALT_YOL altını sunan statik sunucu; alt yol dışı istekleri kaydeder. */
function startServer(root) {
  const out = [];
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    if (path === ALT_PATH.slice(0, -1)) { response.writeHead(301, { location: ALT_PATH }); return response.end(); }
    if (!path.startsWith(ALT_PATH)) { out.push(path); response.writeHead(404); return response.end(); }
    try {
      let file = resolve(root, '.' + '/' + path.slice(ALT_PATH.length));
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

/** Görünen metin + görünür öğelerin title/aria-label/placeholder'ı (dil seçici hariç). */
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

/** Bir dist klasörünü iki dilde sınar; sonuç listesi döner. */
async function verify(pw, distRoot, { quiet = false, time = 60000 } = {}) {
  const result = [];
  const check = (condition, message, detail) => {
    result.push({ pass: !!condition, message });
    if (!quiet) console.log(`${condition ? 'GEÇTİ' : 'FAIL'} ${message}${detail !== undefined ? ' — ' + detail : ''}`);
  };
  const root = resolve(distRoot);
  const { server, out } = await startServer(root);
  const serverRoot = `http://127.0.0.1:${server.address().port}`;
  const site = serverRoot + ALT_PATH;
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
        // ---- açılış (alt yol, sondaki / olmadan da)
        await page.goto(site.slice(0, -1));
        await page.waitForSelector('html[data-ready="yes"]', { timeout: Math.min(time, 20000) });
        const a = await page.evaluate(() => ({ url: location.href, lang: document.documentElement.lang, platform: window.Mucellit.platform.name,
          tabs: ['impose', 'projects', 'calculator', 'learn'].map((s) => document.getElementById('tab-button-' + s).textContent.trim()) }));
        check(a.url === site && a.lang === i18n && a.platform === 'browser' && JSON.stringify(a.tabs) === JSON.stringify(PROMISE[i18n].tab),
          `${et} açılış: ${ALT_PATH} altında hazır, dil ${i18n}, platform tarayıcı, sekme adları seçili dilde`, JSON.stringify(a));

        // ---- masaüstüne özgü metin/düğme yok (dört sekme)
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
          `${et} masaüstüne özgü metin/düğme görünmüyor (4 sekme; Yazdır/Önizleme'de Aç gizli)`, tracks.length ? tracks.join(' | ') : JSON.stringify(y));

        // ---- dil seçiciyle öteki dile geçiş ve geri dönüş (yeniden yükleme alt yolda kalır)
        const other = i18n === 'tr' ? 'en' : 'tr';
        await Promise.all([page.waitForEvent('load'), page.selectOption('#i18n-select', other)]);
        await page.waitForSelector('html[data-ready="yes"]');
        const g1 = await page.evaluate(() => ({ url: location.href, lang: document.documentElement.lang, tab: document.getElementById('tab-button-impose').textContent.trim() }));
        await Promise.all([page.waitForEvent('load'), page.selectOption('#i18n-select', 'system')]);
        await page.waitForSelector('html[data-ready="yes"]');
        const g2 = await page.evaluate(() => ({ url: location.href, lang: document.documentElement.lang, tab: document.getElementById('tab-button-impose').textContent.trim() }));
        check(g1.url === site && g1.lang === other && g1.tab === PROMISE[other].tab[0] && g2.url === site && g2.lang === i18n && g2.tab === PROMISE[i18n].tab[0],
          `${et} dil seçici: ${other} → sistem (${i18n}); sayfa alt yolda yeniden yüklenir`, JSON.stringify({ g1, g2 }));

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
        check(download.suggestedFilename().endsWith(PROMISE[i18n].ek) && r.page === 24 && Math.abs(r.mm[0] - 297) < 0.5 && Math.abs(r.mm[1] - 210) < 0.5
          && JSON.stringify(r.first) === '["16:left","1:right"]',
          `${et} PDF dizme: 37 sayfa → formalı 4 yaprak, 24 sayfa 297 × 210 mm, 1. sayfa 16 | 1`, JSON.stringify({ name: download.suggestedFilename(), ...r }));

        // ---- Öğren
        await page.click('#tab-button-learn');
        await page.waitForFunction(() => document.getElementById('og-stage').childElementCount > 0 && document.getElementById('og-root').dataset.state === 'ready', null, { timeout: Math.min(time, 15000) });
        await page.selectOption('#og-speed', '4');
        await page.click('#og-play');
        await page.waitForFunction(() => document.querySelectorAll('#og-steps li.finished').length === 1 && document.getElementById('og-root').dataset.state === 'ready', null, { timeout: Math.min(time, 15000) });
        const o = await page.evaluate(() => ({ stage: document.querySelectorAll('#og-stages li').length, tab: document.getElementById('tab-button-learn').textContent.trim(),
          license: document.getElementById('og-license-text').textContent.trim() }));
        const learnLicense = existsSync(join(root, 'js/learn/LICENSE')) ? readFileSync(join(root, 'js/learn/LICENSE'), 'utf8').trim() : null;
        check(o.stage === 10 && o.tab === PROMISE[i18n].tab[3] && learnLicense !== null && o.license === learnLicense,
          `${et} Öğren: rehber kurulur (10 aşama), bir adım oynar, lisans paneli js/learn/LICENSE ile birebir`, JSON.stringify({ ...o, license: o.license.slice(0, 30) }));

        // ---- lisans dosyaları sitede (göreli yolla) erişilebilir ve repodakiyle birebir
        const lis = await page.evaluate(async (l) => Promise.all(l.map(async (g) => { const y = await fetch(g); return [g, y.status, y.ok ? await y.text() : ''] })), LICENSES);
        const repoCounterpart = (g) => (g === 'LICENSE' || g === 'THIRD_PARTY_NOTICES.md' ? join(REPO, g) : join(REPO, 'app', g));
        const faulty = lis.filter(([g, state, text]) => state !== 200 || text !== readFileSync(repoCounterpart(g), 'utf8')).map(([g, d]) => g + ':' + d);
        check(faulty.length === 0, `${et} lisans dosyaları sitede erişilebilir ve repodakiyle birebir (${LICENSES.length} file)`, faulty.length ? faulty.join(', ') : undefined);
      } catch (e) {
        check(false, `${et} koşu yarıda kaldı: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
      }
      check(errors.length === 0, `${et} konsol hatası yok`, errors.length ? errors.slice(0, 3).map((h) => h.slice(0, 200)).join(' | ') : '0 hata');
      const outer = requests.filter((u) => !(u.startsWith(site) || u.startsWith('data:') || u.startsWith('blob:') || u === site.slice(0, -1)));
      check(outer.length === 0 && out.length === 0, `${et} dış ağ isteği ve alt yol dışı istek yok`,
        outer.length || out.length ? JSON.stringify({ outer: [...new Set(outer)].slice(0, 5), altPathOutside: [...new Set(out)].slice(0, 5) }) : `${requests.length} istek, hepsi ${ALT_PATH} altında`);
      out.length = 0;
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  return result;
}

/** Bozuk dist kopyaları: [ad, bozma işlevi(klasör)]. */
const CORRUPT = [
  ['boş klasör', (d) => { rmSync(d, { recursive: true, force: true }); mkdirSync(d); }],
  ['index.html yok', (d) => rmSync(join(d, 'index.html'))],
  ['mutlak yollu betik', (d) => change(d, 'index.html', '<script src="js/calc.js"></script>', '<script src="/js/calc.js"></script>')],
  ['dış adrese istek', (d) => change(d, 'index.html', '</body>', '<img src="https://example.com/x.png" alt=""></body>')],
  // index.html'deki hidden özniteliğini silmek kusur değildir (impose.js görünürlüğü platform.yazdir'a göre çalışma anında
  // kurar); gerçek kusur tarayıcı platformunun yazdırma sunmasıdır → Yazdır düğmesi tarayıcıda görünür.
  ['görünür Mac düğmesi', (d) => change(d, 'js/platform.js', 'yazdir: null,', 'print: function () { return Promise.resolve(true); },')],
  ['Mac metni görünür', (d) => change(d, 'index.html', '</header>', '<p>Open in Preview (⌘P)</p></header>')],
  ['LICENSE yok', (d) => rmSync(join(d, 'LICENSE'))],
  ['THIRD_PARTY_NOTICES.md kısmen bozuk', (d) => writeFileSync(join(d, 'THIRD_PARTY_NOTICES.md'), readFileSync(join(d, 'THIRD_PARTY_NOTICES.md'), 'utf8').slice(0, 200))],
  ['Öğren lisans paneli bozuk', (d) => change(d, 'index.html', 'Copyright (c) 2026 Tolga Cohce', 'Copyright (c) 2026 X')],
  ['konsol hatası', (d) => change(d, 'index.html', '</body>', '<script>console.error("kusur")</script></body>')],
];
function change(d, relative, old, fresh) {
  const y = join(d, relative);
  const m = readFileSync(y, 'utf8');
  if (!m.includes(old)) throw new Error(`bozma kalıbı bulunamadı (${relative}): ${old}`);
  writeFileSync(y, m.replace(old, fresh));
}

async function main() {
  const pw = await loadPlaywright();
  if (!pw[ENGINE] || typeof pw[ENGINE].launch !== 'function') { console.error(`Bilinmeyen motor: ${ENGINE} (chromium | webkit)`); process.exit(2); }
  let dist = distArg ? resolve(distArg) : join(REPO, 'dist');
  if (!distArg) {
    const h = spawnSync(process.execPath, [join(REPO, 'tools', 'prepare-dist.mjs'), '--web', '--quiet'], { encoding: 'utf8' });
    process.stdout.write(h.stdout + h.stderr);
    if (h.status !== 0) { console.log('FAIL dist-prepare --web başarısız'); process.exit(1); }
  }
  if (!existsSync(dist)) { console.error('dist klasörü yok: ' + dist); process.exit(2); }
  console.log(`Motor: ${ENGINE}; site: ${dist} → ${ALT_PATH}`);

  if (!FAULTY) {
    const s = await verify(pw, dist);
    const rest = s.filter((x) => !x.pass);
    console.log(`\nÖZET: ${s.length} kontrol, ${s.length - rest.length} geçti, ${rest.length} kaldı`);
    process.exit(rest.length ? 1 : 0);
  }

  // --kusurlu: her bozuk kopyada denetim en az bir KALDI vermeli
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
      console.log(`${caught ? 'GEÇTİ' : 'FAIL'} [faulty] ${name}: denetim ${caught ? 'FAIL dedi' : 'KAÇIRDI'} (${rest.length}/${s.length} kontrol kaldı${rest.length ? '; ilk: ' + rest[0].message.slice(0, 110) : ''})`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\nÖZET (kusurlu): ${CORRUPT.length} bozuk kopya, ${CORRUPT.length - escaping} yakalandı, ${escaping} kaçtı`);
  process.exit(escaping ? 1 : 0);
}

main();
