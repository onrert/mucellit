/*
 * e2e.mjs — uçtan uca tarayıcı testi (Playwright + Chromium).
 * Çalıştırma (repo kökünden):  node app/test/e2e.mjs
 *
 * Koşu 1 (yerel sunucu): 37 sayfalık test PDF'i yükle → formalı, kağıt 297×210,
 *   kitap 148×210, forma 4 → dışa aktar → 24 sayfa, 297×210 mm, 1. sayfada 16 solda
 *   1 sağda (pdf.js metin çıkarımı). Önizleme ekran görüntüsü. Süreç: kitap oluştur,
 *   2 adım işaretle, yenile, JSON dışa aktar → temizle → içe aktar → aynı veri.
 * Koşu 2 (file://): aynı PDF akışı, index.html doğrudan dosyadan açılır.
 * Her iki koşuda: konsol hatası (console.error / pageerror) yok; sayfanın yaptığı
 *   her ağ isteği yerel olmalı (sunucu adresi / file://); dış ağ isteği = KALDI.
 *
 * EPUB (EPUB → PDF), her iki koşuda: Türkçe metin, vektör/font, ölçü ve ölçek 1,
 *   formalı dışa aktarma, DRM, FXL, bozuk; file:// koşusunda uzun.epub < 60 s.
 *   EPUB fixture'ları test sırasında app/test/epub-build.cjs ile üretilir.
 *
 *: onay "hayır" (yerel confirm reddi ve Tauri dialog eklentisi gibi Promise döndüren
 *   confirm) → Süreç verisi değişmez; "evet" → işlem yapılır. Sayfaya dosya bırakma PDF'i açar, ızgara içi
 *   sayfa sürükleme çalışır.
 * ".epub.zip" (klasör paketi EPUB'un tarayıcı sıkıştırması) iki koşuda; "tauri-benzetimi" koşusu sahte
 *   window.__TAURI__ ile yerel Kaydet akışını (D7: vazgeç → "kaydedilmedi", yazıldı → yol) ve otomatik yedeği sınar.
 *: yerel Aç (dosya_ac → dosya_oku ham ArrayBuffer), Dock/Finder açılışı (dosya-acildi olayı +
 *   bekleyen_acilanlar), Kaydet hatası (hatali dalı), kısmi kayıtta yüz sayısı, Kaydet penceresi açıkken ⌘S
 *, boş yedek bildirimsiz / dolu yedek geri yüklenir, temizlik yedeği beklemeden gider.
 * (dil): mevcut koşular Türkçe arayüzle (tarayıcı yerel ayarı tr-TR; sistem dili kuralı) ve bugünkü Türkçe metinlerle
 *   koşar. Ek "en" koşuları (en-US, sunucu ve file://): İngilizce arayüz duman sınaması (sekmeler, bildirimler, dosya adı
 *   ekleri -imposed/-fronts, görünen metinde Türkçe karakter yok, eski Türkçe kayıt İngilizce adımlarla açılır), elle
 *   dil seçimi ve geri dönüş; Tauri benzetiminde dil_oku/dil_ayarla, Görünüm > Dil menü olayı ve Rust yedeğinden geri gelme.
 *   Her koşunun sonunda sözlükte eksik anahtar (KitapCilt.dil.eksikler) yok.
 * "açılış-hatası" koşusu (tr-TR): platform.hazir reddi, i18n.js hatası ve bozuk tr sözlüğünde etiketler
 *   boş kalmaz (seçili dil / statik İngilizce); Tauri benzetiminde sistem dili Rust'tan (dil_oku.sistem) ve Mac'e uygun
 *   saklama ipucu; en koşusunda değişen İngilizce metinler (Imposition, source p., couldn't …).
 * tauri-benzetimi koşusunda yazdırma (Yazdır… / Önizleme'de Aç düğmeleri, baskı öncesi not, tek PDF, iki PDF önler →
 *   çevir onayı → arkalar, yarıda kalma, meşgulken ⌘P/⌘S yok sayılır, menü ⌘P, Önizleme açılamazsa Kaydet + not);
 *   tarayıcı koşularında düğmeler gizli. Başlangıç işleri 0a–0i (ilk kare dili, i18n.js yokken konsol, ondalık ayracı,
 *   dil seçici ipucu ve yerleşimi) ilgili koşularda.
 * yerel sunucu src-tauri/tauri.conf.json'daki CSP'yi başlık olarak gönderir (bütün akışlar Tauri
 *   ile aynı CSP altında koşar; ihlal konsol hatası olarak KALDI sayılır); fetch('https://example.com') CSP ile
 *   reddedilir; Object.prototype dondurulmuştur; içe aktarmada dosyaSec'in File'ı işlenir, reddi
 *   bildirime gider; Adım çıkar ve Tümünü temizle "evet" yolları.
 *
 * (Öğren rehberi): "öğren" (tr-TR) ve "öğren en" (en-US) koşuları, yerel sunucuda Tauri CSP başlığıyla: sekme
 *   açılmadan rehber kurulmaz; sayı paneli öntanımlıları Hesapla ile aynı (aynı sonuç nesnesi); 10 aşama 45 adım; Örnek
 *   Kitap değerleri (elle ve Hesapla'dan); elle değişiklik Hesapla'yı değiştirmez, "Hesapla'dan al"; başka cilt türünde
 *   uyum notu; sekme değişince "baştan sona" durur, figür sökülür, rAF çağrısı 0; baştan sona oynat (4×) sona kadar;
 *   dil değişimi (yeniden yükleme sonrası rehber yeni dilde, konum korunur); prefers-reduced-motion (45 adım animasyonsuz);
 *   CSP ihlali 0, global ad yalnız KitapCilt altında, eksik anahtar 0. file:// koşusunda duman; Tauri benzetiminde
 *   menü olayı "sekme-ogren" (Görünüm > Öğren ⌘4).
 * rehberin denetim arayüzü (KitapCilt.ogren.denetim) ürün kodunda yok; "öğren" koşuları learn.js
 *   isteğini yakalayıp test kopyasını sunar (app/test/learn-probe.cjs, page.route). file:// ve Tauri benzetimi dumanı
 *   yalnız DOM'la (ürün kodu olduğu gibi) ve ürün kodunda denetim olmadığını sınar. Öğren açıkken sekme/menü yeniden
 *   basılınca rehber yeniden kurulmaz ("baştan sona" adım atlamaz); dil değişiminde ilerleme (tamam) korunur; lisans paneli.
 * Bayraklar / ortam:
 *   --motor=chromium|webkit   (öntanımlı chromium; webkit = WKWebView'e en yakın Playwright motoru)
 *   KC_PLAYWRIGHT             Playwright modül klasörü (ör. /yol/playwright/node_modules/playwright)
 *   PLAYWRIGHT_BROWSERS_PATH  yoksa /opt/pw-browsers (varsa), o da yoksa Playwright öntanımlısı
 *   KC_GORUNTU                önizleme ekran görüntüsünün yolu (öntanımlı docs/preview.png)
 * Kütüphaneler app/vendor/ altında yerel.
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

// Tarayıcı yolu: PLAYWRIGHT_BROWSERS_PATH verilmişse o; yoksa /opt/pw-browsers varsa o (bulut ortamı);
// ikisi de yoksa Playwright'ın kendi öntanımlısı (macOS: ~/Library/Caches/ms-playwright).
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO = resolve(APP, '..');
const IMAGE = process.env.MC_SCREENSHOTS ? resolve(process.env.MC_SCREENSHOTS) : join(REPO, 'docs', 'preview.png');
const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=chromium').slice('--engine='.length);

const results = [];
function check(criterion, condition, message, detail) {
  results.push({ criterion, pass: !!condition, message });
  console.log(`${condition ? 'GEÇTİ' : 'FAIL'} [ölçüt ${criterion}] ${message}${detail !== undefined ? ' — ' + detail : ''}`);
}

/**
 * Playwright modülü sırayla: KC_PLAYWRIGHT (modül klasörü, ör. /yol/playwright/node_modules/playwright),
 * düz `import('playwright')`, son olarak global npm kökü.
 */
async function loadPlaywright() {
  if (process.env.MC_PLAYWRIGHT) return await import(pathToFileURL(join(resolve(process.env.MC_PLAYWRIGHT), 'index.mjs')).href);
  try { return await import('playwright'); } catch {
    const root = execSync('npm root -g').toString().trim();
    return await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
  }
}

// Tauri penceresinin CSP'si: yerel sunucu aynısını başlık olarak gönderir. null ise başlık yok.
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

/** Sayfayı izler: konsol hataları ve ağ istekleri. */
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
  // Test PDF'i sayfadaki pdf-lib ile üretilir: 37 sayfa, A5, her sayfada büyük numara.
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

function solSag(m) {
  // ögeleri x'e göre sırala; her ögenin sol/sağ yarıda olup olmadığını döndür
  return m.elements.slice().sort((a, b) => a.x - b.x).map((o) => ({ str: o.str, half: o.x + o.w / 2 < m.width / 2 ? 'left' : 'right' }));
}

/** PDF yükle → formalı ayarla → dışa aktar → çıktıyı doğrula. */
async function pdfFlow(page, address, label, criterion, screenImage) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-impose');
  const pdf = await makeTestPdf(page);
  await page.setInputFiles('#pdf-file', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 37);
  check(criterion, true, `${label}: 37 sayfalık PDF yüklendi, 37 küçük resim kartı`);
  await page.selectOption('#binding-type', 'sewn');
  await page.fill('#paper-width', '297');
  await page.fill('#paper-height', '210');
  await page.fill('#book-width', '148');
  await page.fill('#book-height', '210');
  await page.fill('#signature-sheet', '4');
  await page.waitForFunction(() => document.querySelectorAll('#sheet-preview .sheet-card').length === 12);
  const summary = await page.textContent('#imposition-summary');
  check(criterion, /48 sayfaya/.test(summary) && /3 forma/.test(summary), `${label}: önizleme 12 yaprak, özet`, summary.trim());
  await page.waitForSelector('#small-thumbs[data-thumbs-ready="yes"]', { timeout: 60000 });
  if (screenImage) {
    await mkdir(dirname(IMAGE), { recursive: true });
    await page.locator('#sheet-preview').screenshot({ path: IMAGE });
    check(criterion, true, `${label}: önizleme ekran görüntüsü kaydedildi`, IMAGE);
  }
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-transfer')]);
  const output = await readFile(await download.path());
  check(criterion, /-dizilmis\.pdf$/.test(download.suggestedFilename()), `${label}: tek PDF indirildi`, download.suggestedFilename());
  await page.waitForSelector('#output-preview[data-ready="yes"]');

  const r = await inspectPdf(page, output, [1, 2, 3, 17]);
  check(criterion, r.pageCount === 24, `${label}: çıktı 24 sayfa`, r.pageCount);
  const bad = r.sizes.map((b, i) => [i + 1, b]).filter(([, b]) => Math.abs(b[0] - 297) > 0.5 || Math.abs(b[1] - 210) > 0.5);
  check(criterion, r.sizes.length === 24 && bad.length === 0, `${label}: her page 297×210 mm (±0.5)`,
    bad.length ? JSON.stringify(bad) : `first ${r.sizes[0].map((x) => x.toFixed(2)).join('×')} mm`);
  const s1 = solSag(r.texts[1]);
  check(criterion, s1.length === 2 && s1[0].str === '16' && s1[0].half === 'left' && s1[1].str === '1' && s1[1].half === 'right',
    `${label}: 1. sayfada 16 solda, 1 sağda (pdf.js metin)`, JSON.stringify(s1));
  const s2 = solSag(r.texts[2]);
  check(criterion, JSON.stringify(s2.map((o) => o.str)) === '["2","15"]', `${label}: 2. page (back) [2, 15]`, JSON.stringify(s2));
  const s3 = solSag(r.texts[3]);
  check(criterion, JSON.stringify(s3.map((o) => o.str)) === '["14","3"]', `${label}: 3. page [14, 3]`, JSON.stringify(s3));
  const s17 = solSag(r.texts[17]);
  check(criterion, s17.length === 1 && s17[0].str === '33' && s17[0].half === 'right', `${label}: 17. sayfa [48 boş, 33]`, JSON.stringify(s17));
}

async function readStorage(page) {
  return page.evaluate(() => { const h = localStorage.getItem('mucellit.projects'); return h ? JSON.parse(h) : null; });
}

async function projectsFlow(page) {
  const O = 3;
  await page.click('#tab-button-projects');
  await page.fill('#yk-name', 'E2E Kitap');
  await page.selectOption('#yk-kind', 'sewn');
  await page.fill('#yk-paper', '80 g/m²');
  await page.click('#yk-create');
  await page.waitForFunction(() => document.querySelectorAll('#steps .step').length === 14);
  check(O, true, 'kitap oluşturuldu, formalı şablon 14 adım');
  await page.locator('#steps .step-done').nth(0).check();
  await page.locator('#steps .step-done').nth(1).check();
  await page.locator('#steps .step-note').nth(1).fill('ilk deneme: tek forma');
  // Düzenle ayarlarını kitaba kaydet
  await page.click('#tab-button-impose');
  const bookId = (await readStorage(page)).projects[0].id;
  await page.selectOption('#settings-book', bookId);
  await page.click('#settings-save');
  const registered = await readStorage(page);
  check(O, registered.projects[0].settings && registered.projects[0].settings.paperWidth === 297 && registered.projects[0].pdfName === 'test-37.pdf',
    'Düzenle ayarları kitaba kaydedildi', JSON.stringify({ paperWidth: registered.projects[0].settings && registered.projects[0].settings.paperWidth, pdfName: registered.projects[0].pdfName }));

  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]');
  await page.click('#tab-button-projects');
  await page.waitForSelector('#steps .step');
  const marks = await page.$$eval('#steps .step-done', (l) => l.map((e) => e.checked));
  const note = await page.locator('#steps .step-note').nth(1).inputValue();
  check(O, marks.length === 14 && marks[0] && marks[1] && marks.filter(Boolean).length === 2,
    'yenilemeden sonra 2 işaret duruyor', JSON.stringify(marks.map((x) => (x ? 1 : 0))));
  check(O, note === 'ilk deneme: tek forma', 'yenilemeden sonra not duruyor', note);

  const once = await readStorage(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#json-export')]);
  const jsonPath = await download.path();
  const exportData = JSON.parse(await readFile(jsonPath, 'utf8'));
  check(O, isDeepStrictEqual(exportData, once), 'JSON dışa aktarım saklanan veriyle aynı', download.suggestedFilename());

  await page.click('#data-clear');
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 0);
  const clean = await readStorage(page);
  check(O, !clean || clean.projects.length === 0, 'temizle: veri boş', JSON.stringify(clean));

  await page.setInputFiles('#json-import', jsonPath);
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 1);
  const after = await readStorage(page);
  check(O, isDeepStrictEqual(after, once), 'içe aktar: veri dışa aktarılanla birebir aynı');
  const isaretler2 = await page.$$eval('#steps .step-done', (l) => l.map((e) => e.checked));
  check(O, isaretler2.filter(Boolean).length === 2 && isaretler2[0] && isaretler2[1], 'içe aktarımdan sonra 2 işaret arayüzde', JSON.stringify(isaretler2.map((x) => (x ? 1 : 0))));
}


// ------------------------------------------------------------------
// Düzeltme testleri
// ------------------------------------------------------------------
const FIXTURE = join(APP, 'test', 'fixtures');

/** Sayfa içi yardımcılar: sayılı PDF üretimi, çıktı üretimi (KC.cikti.uret) ve pdf.js ile metin okuma. */
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

/** Bir sayfa içi işlevi çalıştırır; sonuç yalnız serileştirilebilir değerler içerir. */
function ordered(pageText) { return pageText.elements.slice().sort((a, b) => a.x - b.x).map((o) => o.str); }

async function ayFlowTwo(page, label) {
  const A = 'AD6';
  // ---- iki PDF çıktısı + arkalar ters sıra (8 sayfa, forma 2 yaprak → 2 kâğıt) ----
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
  check(A, r.flat.names.length === 2 && /-onler\.pdf$/.test(r.flat.names[0]) && /-arkalar\.pdf$/.test(r.flat.names[1]),
    `${label}: iki PDF modu iki dosya üretir (önler + arkalar)`, r.flat.names.join(' , '));
  check(A, JSON.stringify(r.flat.pages[0]) === '[["8","1"],["6","3"]]', `${label}: önler [8|1] [6|3]`, JSON.stringify(r.flat.pages[0]));
  check(A, JSON.stringify(r.flat.pages[1]) === '[["2","7"],["4","5"]]', `${label}: arkalar düz sırada [2|7] [4|5]`, JSON.stringify(r.flat.pages[1]));
  check(A, /-arkalar-ters\.pdf$/.test(r.reversed.names[1]) && JSON.stringify(r.reversed.pages[1]) === '[["4","5"],["2","7"]]',
    `${label}: backsReversed açıkken arkalar ters sırada [4|5] [2|7]`, r.reversed.names[1] + ' ' + JSON.stringify(r.reversed.pages[1]));
  check(A, JSON.stringify(r.reversed.pages[0]) === JSON.stringify(r.flat.pages[0]), `${label}: backsReversed önleri değiştirmez`);

  // ---- 180° arka dönüş: kısa/uzun kenar × yatay/dikey ----
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
    check(A, frontFlat && backDone, `${label}: ${name}: ön düz, arka ${don ? '180° döndü' : 'dönmedi'}`, JSON.stringify({ on: on.order, back: back.order, backMark: back.marks }));
  }
}

async function ayBoxes(page, label) {
  const A = 'AD4';
  // CropBox (30,30,420,595) ve kökeni (0,0) olmayan MediaBox (100,100,420,595); /Contents'siz sayfa
  const r = await page.evaluate(async () => {
    const T = window.__t;
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    let p = doc.addPage([420, 595]); p.setMediaBox(100, 100, 420, 595); p.drawText('KAYIKORIJIN', { x: 150, y: 400, size: 30, font: f });
    p = doc.addPage([480, 655]); p.setCropBox(30, 30, 420, 595); p.drawText('KIRPIK', { x: 150, y: 300, size: 30, font: f }); p.drawText('SQUARE', { x: 2, y: 2, size: 20, font: f });
    const source = await doc.save();
    const s = await T.build(source, T.all(2), { bindingType: 'single1', paperWidth: 210, paperHeight: 297, bookWidth: 210, bookHeight: 297, scaling: 'actual', duplex: 'long' });
    const m = await T.texts(s.files[0].bytes);
    const content = s.layout.sides.map((y) => y.slots.filter((v) => !v.blank).map((v) => v.content)[0]);
    // TASMA: CropBox dışı metin çıktıda hiç görünmemeli → sayfayı çizip o bölgenin beyaz olduğunu denetle
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(s.files[0].bytes), isEvalSupported: false }).promise;
    const sf = await pdf.getPage(2);
    const vp = sf.getViewport({ scale: 1 });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await sf.render({ canvasContext: g, viewport: vp }).promise;
    return { m, content, vpHeight: vp.height, vpGen: vp.width, sourceBytes: Array.from(source.slice(0, 0)), squareText: m[1].elements.some((o) => /SQUARE/.test(o.str)),
      pixelSize: [c.width, c.height], pixel: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
  });
  const MM = 72 / 25.4;
  const mm2pt = (x) => x * MM;
  const root = (inner) => ({ left: mm2pt(inner.x + inner.w / 2) - 210, alt: mm2pt(inner.y + inner.h / 2) - 297.5 });
  const k1 = root(r.content[0]), k2 = root(r.content[1]);
  const o1 = r.m[0].elements.find((o) => o.str === 'KAYIKORIJIN');
  const o2 = r.m[1].elements.find((o) => o.str === 'KIRPIK');
  check(A, o1 && Math.abs(o1.x - (k1.left + 50)) < 0.6 && Math.abs(o1.y - (k1.alt + 300)) < 0.6,
    `${label}: MediaBox (100,100,420,595): KAYIKORIJIN x=sol+50 (köken kaymaz)`, o1 ? `x ${o1.x.toFixed(2)} (expected ${(k1.left + 50).toFixed(2)}), y ${o1.y.toFixed(2)} (expected ${(k1.alt + 300).toFixed(2)})` : 'metin yok');
  check(A, o2 && Math.abs(o2.x - (k2.left + 120)) < 0.6 && Math.abs(o2.y - (k2.alt + 270)) < 0.6,
    `${label}: CropBox (30,30,420,595): KIRPIK x=left+120`, o2 ? `x ${o2.x.toFixed(2)} (expected ${(k2.left + 120).toFixed(2)}), y ${o2.y.toFixed(2)} (expected ${(k2.alt + 270).toFixed(2)})` : 'metin yok');
  // TASMA'nın çizileceği yer: sayfa sol-altı = (sol-28, alt-28) pt, 20 pt yazı ~ 50 pt geniş
  const [W, H] = r.pixelSize;
  const x0 = Math.max(0, Math.floor(k2.left - 30)), x1 = Math.floor(k2.left - 1);
  const yAlt = Math.floor(H - (k2.alt - 28)), yUst = Math.floor(H - (k2.alt - 28 + 20));
  let dark = 0;
  for (let y = yUst - 2; y <= yAlt + 2; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * W + x) * 4; if (r.pixel[i] < 200) dark += 1;
  }
  console.log(`bilgi: ${label}: TASMA metin çıkarımında ${r.squareText ? 'görünür (pdf.js kırpmayı metin çıkarımına uygulamaz)' : 'none'}`);
  check(A, dark === 0, `${label}: CropBox dışındaki "TASMA" yazısı çıktıda çizilmiyor (taşma bölgesi beyaz)`, `dark pixel ${dark}`);

  // ---- /Contents'siz kaynak sayfa boş sayılır ----
  const c = await page.evaluate(async () => {
    const T = window.__t;
    const { PDFDocument } = window.PDFLib;
    const kaynak0 = await T.numberedPdf(3);
    const doc = await PDFDocument.load(kaynak0);
    // 2. sayfayı /Contents'siz yap
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
    `${label}: /Contents'siz sayfa çıktıyı durdurmaz (kaynakta /Contents gerçekten yok)`, c.error ? 'ERROR: ' + c.error : JSON.stringify(c.m));
  if (c.m) {
    const all = c.m.flat();
    check('AD3', all.includes('1') && all.includes('3') && !all.includes('2'), `${label}: /Contents'siz 2. sayfa boş (1 ve 3 var, 2 yok)`, JSON.stringify(c.m));
  }
}

async function ayBlankToStart(page, address, label) {
  const A = 'AD6';
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-impose');
  await setupHelpers(page);
  const pdf = Buffer.from(await page.evaluate(async () => Array.from(await window.__t.numberedPdf(7))));
  await page.setInputFiles('#pdf-file', { name: 'yedi.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 7);
  await page.selectOption('#binding-type', 'sewn');
  await page.fill('#paper-width', '297'); await page.fill('#paper-height', '210');
  await page.fill('#book-width', '148'); await page.fill('#book-height', '210');
  await page.fill('#signature-sheet', '2');
  await page.selectOption('#output-mode', 'single');
  await page.click('#blank-toStart');
  const first = await page.getAttribute('#small-thumbs .card:first-child', 'data-kind');
  const last = await page.getAttribute('#small-thumbs .card:last-child', 'data-kind');
  check(A, first === 'blank' && last === 'pdf', `${label}: "Başa boş" boş sayfayı listenin BAŞINA koyar`, `first ${first}, son ${last}`);
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-transfer')]);
  const output = await readFile(await download.path());
  const m = await page.evaluate(async (array) => (await window.__t.texts(new Uint8Array(array)))[0].elements.map((e) => ({ str: e.str, half: e.x + e.w / 2 < 148.5 * 72 / 25.4 ? 'left' : 'right' })), Array.from(output));
  check(A, m.length === 1 && m[0].str === '7' && m[0].half === 'left', `${label}: başa boş ile 1. çıktı sayfası yalnız solda "7" (sağ yuva boş)`, JSON.stringify(m));
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
    check(A, /Bu PDF kısıtlı\/şifreli; önce kısıtlamayı kaldırın, ör\. qpdf --decrypt girdi\.pdf cikti\.pdf/.test(warning) && closed,
      `${label}: ${name}: Türkçe uyarı görünür, indir düğmesi kapalı`, `disabled=${closed}`);
    // uyarı sonradan ayar değişince de durur, düğme açılmaz
    await page.fill('#book-width', '147');
    await page.waitForTimeout(150);
    check(A, await page.isDisabled('#export-transfer') && (await page.locator('#encrypted-warning').count()) === 1, `${label}: ${name}: ayar değişince de düğme kapalı kalır`);
  }
  // Parolalı (kullanıcı parolası) PDF: parola istemi (window.prompt) AÇILMAZ, önizleme açılmaz, uyarı görünür, indir kapalı
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
    check('AR3', iz.prompts.length === 0, `${label}: ${name}: dialog (prompt) açılmadı`, JSON.stringify(iz.prompts));
    check('AR3', warning.includes('Bu PDF parolalı; önce parolayı kaldırın: qpdf --password=PAROLA --decrypt girdi.pdf cikti.pdf')
      && await page.isDisabled('#export-transfer') && cards === 0, `${label}: ${name}: Türkçe parolalı uyarısı görünür, önizleme/kart yok, indir kapalı`, `card=${cards}`);
  }
  // Şifre/kısıt durumu denetlenemezse (pdf-lib yok) kapalı başarısız: uyarı + indir kapalı
  {
    const name = 'dizilim-gerek-yok.pdf';
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
    check('AR2', /Şifre\/kısıt durumu denetlenemedi/.test(warning) && await page.isDisabled('#export-transfer'),
      `${label}: pdf-lib yokken "denetlenemedi" uyarısı görünür, indir kapalı (kapalı başarısız)`, warning);
  }
  // guncelVeri kopya döndürür; ayar-yukle kitap.ayar'ı değiştirmez
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
    check('AR7', result.differentObject && result.unchanged, `${label}: currentData kopya döndürür (canlı veri değişmez)`, JSON.stringify(result));
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
    check('AR7', once === after, `${label}: settings-load sonrası book.settings değişmedi`, once + ' / ' + after);
  }
}

async function uiChecks(page, address, label) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-impose');
  await setupHelpers(page);
  const pdf = Buffer.from(await page.evaluate(async () => Array.from(await window.__t.numberedPdf(8))));
  await page.setInputFiles('#pdf-file', { name: 'sekiz.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 8);
  await page.selectOption('#binding-type', 'sewn');
  await page.fill('#paper-width', '297'); await page.fill('#paper-height', '210');
  await page.fill('#book-width', '148'); await page.fill('#book-height', '210');
  await page.fill('#signature-sheet', '2');
  await page.fill('#outer-margin', '0'); await page.fill('#binding-allowance', '0');
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled);
  // D7: kağıt kitaba sığmıyor → indirme kapalı + açık uyarı
  await page.fill('#paper-width', '200');
  await page.waitForFunction(() => document.getElementById('export-transfer').disabled);
  let uy = await page.textContent('#warnings');
  check('AD6', /sığmıyor/.test(uy), `${label}: kağıda sığmayan yerleşimde açık uyarı, indirme kapalı`, uy.trim().slice(0, 90));
  await page.fill('#paper-width', '297');
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled);
  // D8: negatif kenar / cilt payı reddedilir
  await page.fill('#outer-margin', '-3');
  await page.waitForFunction(() => document.getElementById('export-transfer').disabled);
  uy = await page.textContent('#warnings');
  check('AD6', /negatif/.test(uy), `${label}: negatif dış kenar mesajla reddedilir, indirme kapalı`, uy.trim());
  await page.fill('#outer-margin', '0');
  await page.fill('#binding-allowance', '-1');
  await page.waitForFunction(() => document.getElementById('export-transfer').disabled);
  uy = await page.textContent('#warnings');
  check('AD6', /negatif/.test(uy), `${label}: negatif cilt payı mesajla reddedilir`, uy.trim());
  await page.fill('#binding-allowance', '0');
  // O4: iki PDF modunda çevirme etiketi
  await page.selectOption('#output-mode', 'pair');
  const e1 = await page.textContent('#duplex-label');
  await page.selectOption('#output-mode', 'single');
  const e2 = await page.textContent('#duplex-label');
  check('AD4', /desteyi hangi kenardan çevireceksiniz/.test(e1) && /yazıcıda da aynısını seçin/.test(e2) && e1 !== e2, `${label}: iki PDF modunda çevirme etiketi "desteyi hangi kenardan çevireceksiniz"`, e1);
  // D9 + boş sayfa sayısı: Hesapla sekmesi
  await page.click('#tab-button-calculator');
  await page.fill('#h-pageCount', '');
  let h = await page.textContent('#h-error');
  check('AD6', /Sayfa sayısını girin/.test(h), `${label}: Hesapla boş sayfa sayısında "Sayfa sayısını girin"`, h.trim());
  await page.fill('#h-pageCount', '100');
  await page.fill('#h-sheetsPerSignature', '2.6');
  h = await page.textContent('#h-error');
  check('AD6', /tam sayı/.test(h) && (await page.locator('#h-result tr').count()) === 0, `${label}: Hesapla forma yaprağı 2.6'yı reddeder (Düzenle ile aynı)`, h.trim());
  await page.fill('#h-sheetsPerSignature', '4');
  // AH: sert kapak ölçüleri (S = 12 → mukavva 144×216, şerit 16×216, kaplama 352×250)
  await page.fill('#h-pageCount', '240');
  await page.selectOption('#h-bindingType', 'single1');
  const cell = (name) => page.textContent(`#h-result td[data-result="${name}"]`);
  const m1 = await cell('board'), s1 = await cell('spineStrip'), k1 = await cell('covering');
  const numbers = (x) => (x.replace(/\s/g, ' ').match(/\d+(?:,\d+)?/g) || []).join('/');
  check('AH', numbers(m1) === '144/216' && numbers(s1) === '16/216' && numbers(k1) === '352/250', `${label}: Hesapla sert kapak ölçüleri 144×216, 16×216, 352×250`, `${m1} | ${s1} | ${k1}`);
  await page.selectOption('#h-spineRule', 'onlyS');
  const s2 = await cell('spineStrip'), k2 = await cell('covering');
  check('AH', numbers(s2) === '12/216' && numbers(k2) === '352/250', `${label}: "yalnız S" kuralı şerit 12, kaplama yine 352×250`, `${s2} | ${k2}`);
  await page.selectOption('#h-spineRule', 'twoT');
  await page.selectOption('#h-spineShape', 'rounded');
  const uyA = await page.textContent('#h-warnings');
  check('AH', /eğri boyunu ölçüp girin/.test(uyA) && numbers(await cell('spineStrip')) === '19/216', `${label}: yuvarlak sırt, eğri boyu boş → 19 mm ve uyarı`, uyA.trim().slice(0, 80));
  await page.fill('#h-curveLength', '20');
  check('AH', numbers(await cell('spineStrip')) === '23/216' && (await page.textContent('#h-warnings')).trim() === '', `${label}: yuvarlak sırt, eğri boyu 20 → 23 mm, uyarı yok`);
  await page.fill('#h-curveLength', ''); await page.selectOption('#h-spineShape', 'flat');
  await page.fill('#h-boardThickness', '4');
  check('AH', /elle ayarlayın/.test(await page.textContent('#h-warnings')) && numbers(await cell('jointGap')) === '9', `${label}: t=4 → mafsal 9 ve "kaynak yok, elle ayarlayın" notu`);
  await page.fill('#h-boardThickness', '0');
  check('AH', /sıfırdan büyük/.test(await page.textContent('#h-error')), `${label}: t=0 rejected`);
  await page.fill('#h-boardThickness', '2');
  // kullanıcıya iç depo yolu (docs/…md) gösterilmez; not "atölye uygulaması" olarak kalır
  const sourceNote = await page.textContent('#h-source');
  check('AH', /atölye uygulaması/.test(sourceNote) && !/docs\/|\.md\b/.test(sourceNote), `${label}: Hesapla kaynak notu görünür, iç depo yolu yok`, sourceNote);
}

async function osStorageFlow(page, address, label) {
  // O5: saklama alanı dolu → Süreç sekmesindeki yeni kitap Düzenle sekmesinde de görünür
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.evaluate(() => {
    // kota dolu benzetimi: kitapCilt.v1 yazımı atar
    const old = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'mucellit.projects') throw new DOMException('filled', 'QuotaExceededError'); return old.call(this, k, v); };
  });
  await page.click('#tab-button-projects');
  await page.fill('#yk-name', 'Dolu Kitap');
  await page.click('#yk-create');
  await page.waitForFunction(() => document.querySelectorAll('#steps .step').length > 0);
  const warning = await page.textContent('#storage-warning');
  check('AD5', /saklama alanı/.test(warning) && /dolu/.test(warning), `${label}: kota doluyken Türkçe uyarı "saklama alanı ... dolu"`, warning.trim().slice(0, 80));
  await page.click('#tab-button-impose');
  const options = await page.$$eval('#settings-book option', (l) => l.map((o) => o.textContent));
  check('AD5', options.includes('Dolu Kitap'), `${label}: kota doluyken Düzenle sekmesi yeni kitabı listeler`, JSON.stringify(options));
}

// ------------------------------------------------------------------
// EPUB → PDF. Fixture'lar epub-build.cjs ile test sırasında üretilir.
// ------------------------------------------------------------------
const EPUB_MIME = 'application/epub+zip';
const E_MESSAGE = {
  E1: 'Bu dosya okunamadı: geçerli bir EPUB (ZIP) değil ya da bozuk.',
  E2: 'EPUB içinde META-INF/container.xml yok; dosya bozuk ya da EPUB değil.',
  E3: "Bu EPUB DRM ile korunuyor (şifreli içerik). Mücellit DRM'li kitapları açmaz; DRM'siz bir kopya kullanın.",
  E4: "Bu EPUB sabit sayfa düzeninde (fixed-layout). Mücellit yalnız akışkan (reflowable) EPUB'ları destekler; sabit düzenli EPUB'lar dizilemez.",
};

async function freshPage(page, address) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-impose');
  await page.evaluate(() => {
    const E = (window.__e = {});
    // EPUB'u eklentiyle doğrudan dönüştürür (arayüzdeki EPUB ayarları ve verilen ölçülerle)
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
    // pdf-lib alt düzey: sayfa başına resim XObject sayısı; font sözlükleri
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
        if (type === '/Font') fonts.push({ alt: String(o.get(PDFName.of('Subtype'))), name: String(o.get(PDFName.of('BaseFont'))) });
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

/** EPUB'u arayüzden seçer; "… yüklendi" ya da hata bildirimi gelince döner (önceki yüklemenin kartları beklemeyi kandırmasın). */
async function epubSec(page, name, bytes, time = 90000) {
  await page.evaluate(() => { const b = document.getElementById('notice'); b.textContent = ''; b.className = ''; });
  await page.setInputFiles('#pdf-file', { name: name, mimeType: EPUB_MIME, buffer: bytes });
  await page.waitForFunction(() => { const b = document.getElementById('notice'); return b.classList.contains('error') || / yüklendi /.test(b.textContent); }, null, { timeout: time });
  return { card: await page.locator('#small-thumbs .card').count(), notice: (await page.textContent('#notice')) || '' };
}

const withSpaces = (s) => s.replace(/\s+/g, ' ').trim();

async function epubFlow(page, address, label) {
  const U = require('./epub-build.cjs');
  const tr = U.ready.trMini();

  // ---- A7 kabul: IR'de sınıfla italik/kalın parçalar; gizli paragraf yok ----
  await freshPage(page, address);
  const ir = await page.evaluate(([d]) => window.__e.ir(d, 'OEBPS/b1.xhtml'), [Array.from(tr)]);
  const part = ir.blocks.flatMap((b) => b.parts || []);
  check('A7', part.some((p) => p.italic && /eğik yazılmış/.test(p.text)) && part.some((p) => p.bold && /kalın yazılmış/.test(p.text)) && part.some((p) => p.bold && /sınıfla kalın/.test(p.text)),
    `${label}: trMini IR'sinde sınıfla italik, <strong> ve sınıfla kalın parçalar var`);
  check('A7', !part.some((p) => /GIZLIMETIN/.test(p.text || '')) && ir.blocks.some((b) => b.kind === 'separator') && ir.blocks.some((b) => b.prefix === '•') && ir.blocks.some((b) => b.prefix === '2.'),
    `${label}: display:none atlanır, @media kuralı uygulanmaz; ayraç ve liste önekleri (• / 2.)`);
  check('A7', ir.counter.skippedImage === 1 && ir.counter.table === 1 && ir.blocks.filter((b) => b.kind === 'image').length === 2 && ir.cover === 'OEBPS/images/cover.png',
    `${label}: SVG atlandı (1), tablo düz metin (1), PNG + GIF resim bloğu (2), kapak cover-image`, JSON.stringify(ir.counter));

  // ---- B3 Türkçe: arayüzden yükle, kart = PDF sayfa ≥ 3; metin birebir ----
  await page.selectOption('#binding-type', 'sewn');
  await page.fill('#paper-width', '297'); await page.fill('#paper-height', '210');
  await page.fill('#book-width', '148'); await page.fill('#book-height', '210');
  await page.fill('#signature-sheet', '4'); await page.fill('#outer-margin', '0'); await page.fill('#binding-allowance', '0');
  await page.selectOption('#scaling', 'fit'); await page.selectOption('#output-mode', 'single');
  const select = await epubSec(page, 'tr-mini.epub', tr);
  const pdf0 = await page.evaluate(([d]) => window.__e.convert(d), [Array.from(tr)]);
  const s0 = await page.evaluate(([d]) => window.__e.inspect(d), [pdf0]);
  const text = withSpaces(s0.map((s) => s.elements.map((o) => o.str).join(' ')).join(' '));
  check('B3', select.card === s0.length && s0.length >= 3, `${label}: trMini card sayısı = PDF page sayısı ≥ 3`, `card ${select.card}, PDF ${s0.length}; bildirim: ${select.notice}`);
  check('B3', text.includes(U.B3_SENTENCE), `${label}: pdf.js metninde Türkçe cümle birebir`, text.includes(U.B3_SENTENCE) ? U.B3_SENTENCE : text.slice(0, 160));
  check('B3', !text.includes('�') && text.includes('İ') && text.includes('ı'), `${label}: U+FFFD none; İ = U+0130 ve ı = U+0131 var`);
  check('B3', /Birinci Bölüm/.test(withSpaces(s0[0].elements.map((o) => o.str).join(' '))) && !text.includes('GIZLIMETIN') && s0.some((s) => /^YENISAYFA/.test(withSpaces(s.elements.map((o) => o.str).join(' ')))),
    `${label}: kapak atlandı (1. sayfa "Birinci Bölüm"), gizli paragraf yok, page-break-before yeni sayfa açtı`);
  const warning = await page.textContent('#epub-warning');
  check('B3', /1 resim atlandı \(SVG, bozuk ya da bilinmeyen biçim\), 1 tablo düz metne çevrildi, 2 resim 300 dpi altında\./.test(warning), `${label}: U1 uyarısı`, warning.trim());
  // BD/O4: uyarı varken kullanıcıya görünür (kapalı "EPUB ayarları" bölümünde gizli kalmaz)
  check('O4', await page.isVisible('#epub-warning .warning'), `${label}: U1 uyarısı görünür (isVisible('#epub-warning .warning'))`,
    `details açık: ${await page.evaluate(() => document.getElementById('epub-settings').open)}`);

  // ---- B4 Vektör: resim yalnız resimli sayfalarda; Literata FontFile2; Standard 14 yok ----
  const y = await page.evaluate(([d]) => window.__e.structure(d), [pdf0]);
  const withTextAll = s0.every((s) => s.elements.some((o) => o.str.trim()));
  check('B4', withTextAll && y.withImages.filter((n) => n > 0).length <= 2 && y.withImages.reduce((a, b) => a + b, 0) === 2 && y.withImages.filter((n) => n === 0).length >= s0.length - 2,
    `${label}: her sayfada metin var; Image XObject yalnız 2 resimli sayfada, metin sayfalarında yok`, JSON.stringify(y.withImages));
  const tip0 = y.fonts.filter((f) => f.alt === '/Type0');
  check('B4', tip0.length > 0 && tip0.every((f) => /Literata/.test(f.name)) && y.definitions.length === tip0.length && y.definitions.every(Boolean) && !y.fonts.some((f) => f.alt === '/Type1'),
    `${label}: fontlar Literata (Type0 + FontFile2), Standard 14 yok`, JSON.stringify(tip0.map((f) => f.name)));

  // ---- B5 + B6: dizilmiş çıktı (cilt 0) → ölçek 1; formalı 297×210, forma 4 ----
  const lengths = [...new Set(s0.flatMap((s) => s.elements.filter((o) => o.str.trim()).map((o) => Math.abs(o.a))))];
  const scaleOne = (page) => page.elements.filter((o) => o.str.trim()).every((o) => lengths.some((b) => Math.abs(Math.abs(o.a) / b - 1) <= 0.001));
  check('B5', s0.every((s) => Math.abs(s.width - 148) <= 0.5 && Math.abs(s.height - 210) <= 0.5), `${label}: cilt 0 / dış 0 → her sayfa 148×210 mm (±0,5)`, `${s0[0].width.toFixed(2)}×${s0[0].height.toFixed(2)}`);
  async function downloadImposed(expectedPage, size) {
    await page.waitForFunction(() => !document.getElementById('export-transfer').disabled);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-transfer')]);
    const output = await readFile(await download.path());
    await page.waitForSelector('#output-preview[data-ready="yes"]');
    const r = await page.evaluate(([d]) => window.__e.inspect(d), [Array.from(output)]);
    check('B6', /-dizilmis\.pdf$/.test(download.suggestedFilename()) && r.length === expectedPage && r.every((s) => Math.abs(s.width - 297) <= 0.5 && Math.abs(s.height - 210) <= 0.5),
      `${label}: ${size}: EPUB → formalı 297×210, forma 4 → ${download.suggestedFilename()}, ${expectedPage} sayfa, önizleme hazır`, `${r.length} page`);
    const all = r.filter((s) => s.elements.some((o) => o.str.trim()));
    check('B5', all.length > 0 && all.every(scaleOne), `${label}: ${size}: dizilmiş çıktıda ölçek 1 (metin a katsayısı kaynak boyutlarıyla ±0,001)`,
      all.length ? JSON.stringify(all[0].elements.filter((o) => o.str.trim()).slice(0, 3).map((o) => +Math.abs(o.a).toFixed(4))) + ' / kaynak ' + JSON.stringify(lengths.map((b) => +b.toFixed(4))) : 'metin yok');
  }
  await page.waitForFunction(() => document.querySelectorAll('#sheet-preview .sheet-card').length > 0);
  await downloadImposed(Math.ceil(select.card / 16) * 8, 'cilt 0');
  // ölçü değişince "yeniden seçin" uyarısı
  await page.fill('#binding-allowance', '10');
  await page.waitForSelector('#plugin-size-warning', { timeout: 5000 });
  check('B5', /EPUB bu ölçülerle dizilmişti/.test(await page.textContent('#plugin-size-warning')), `${label}: cilt payı değişince #plugin-size-warning görünür`);
  // cilt payı 10 ile yeniden yükle → sayfa 138×210, dizilmiş ölçek 1
  const sec10 = await epubSec(page, 'tr-mini.epub', tr);
  await page.waitForTimeout(100);
  check('B5', (await page.locator('#plugin-size-warning').count()) === 0 && /138 × 210 mm/.test(await page.textContent('#source-info')),
    `${label}: cilt payı 10 ile yeniden yüklenince uyarı kalkar, kaynak 138 × 210 mm`, await page.textContent('#source-info'));
  const s10 = await page.evaluate(async ([d]) => window.__e.inspect(await window.__e.convert(d, { gutter: 10 })), [Array.from(tr)]);
  check('B5', s10.every((s) => Math.abs(s.width - 138) <= 0.5 && Math.abs(s.height - 210) <= 0.5), `${label}: cilt payı 10 → her sayfa 138×210 mm (±0,5)`, `${s10[0].width.toFixed(2)}×${s10[0].height.toFixed(2)}`);
  await downloadImposed(Math.ceil(sec10.card / 16) * 8, 'cilt 10');
  await page.fill('#binding-allowance', '0');

  // ---- enMini: EPUB 2 + NCX + &nbsp; (text/html yedeği) ----
  await freshPage(page, address);
  const en = await epubSec(page, 'en-mini.epub', U.ready.enMini());
  const enMetin = withSpaces((await page.evaluate(async ([d]) => window.__e.inspect(await window.__e.convert(d)), [Array.from(U.ready.enMini())])).map((s) => s.elements.map((o) => o.str).join(' ')).join(' '));
  check('A7', en.card >= 1 && /Hello world, this is an English paragraph/.test(enMetin), `${label}: enMini (EPUB 2, NCX, DTD'siz &nbsp;) hatasız dönüşür`, `card ${en.card}; ${enMetin.slice(0, 60)}`);

  // ---- B7 DRM / fontGizli, B8 FXL, B9 bozuk / containerYok ----
  const errorState = async (criterion, name, bytes, message) => {
    await freshPage(page, address);
    const r = await epubSec(page, name, bytes);
    const closed = await page.isDisabled('#export-transfer');
    check(criterion, r.notice.includes(message) && r.card === 0 && closed, `${label}: ${name}: Türkçe mesaj, kart 0, indirme kapalı`, r.notice);
  };
  await errorState('B7', 'drm.epub', U.ready.drm(), E_MESSAGE.E3);
  await freshPage(page, address);
  const fg = await epubSec(page, 'font-gizli.epub', U.ready.fontHidden());
  check('B7', fg.card >= 3 && !/açılamadı/.test(fg.notice), `${label}: fontGizli.epub (yalnız yazı tipi gizleme) DRM sayılmaz, dönüşür`, `card ${fg.card}; ${fg.notice}`);
  await errorState('B8', 'fxl.epub', U.ready.fxl(), E_MESSAGE.E4);
  await errorState('B9', 'bozuk.epub', U.ready.corrupt(), E_MESSAGE.E1);
  await errorState('B9', 'container-yok.epub', U.ready.noContainer(), E_MESSAGE.E2);
}

// ------------------------------------------------------------------
// EPUB düzeltme testleri (kodlama dahil), her iki koşuda
// ------------------------------------------------------------------
// başlığı (IHDR) geçerli, IDAT'ı bozuk PNG
const CORRUPT_PNG = Buffer.from('89504E470D0A1A0A0000000D49484452000000100000001008020000009091683600000010494441547801DEADBEEFDEADBEEFDEADBEEF00000000', 'hex');
// windows-1254 tek bayt kodları (Türkçe harfler)
const W1254 = { 'ğ': 0xf0, 'ı': 0xfd, 'İ': 0xdd, 'Ö': 0xd6, 'Ğ': 0xd0, 'Ü': 0xdc, 'Ş': 0xde, 'Ç': 0xc7, 'ü': 0xfc, 'ş': 0xfe, 'ö': 0xf6, 'ç': 0xe7 };
function w1254(s) { return Buffer.from([...s].map((c) => (W1254[c] !== undefined ? W1254[c] : c.charCodeAt(0)))); }

async function bdFlow(page, address, label) {
  const U = require('./epub-build.cjs');
  const paragraph = (n) => `<p>${U.paragraphText(U.random(n), 60)}</p>`;

  // ---- O3: bozuk PNG'li EPUB dönüşür; U1'de 1 resim atlandı; yazı tipi uyarısı yok ----
  const corruptEpub = U.epub({ title: 'Bozuk Resim', sections: [{ name: 'b.xhtml', xhtml: U.xhtml('<h1>Resimli Bölüm</h1>' + paragraph(1) + '<p><img src="r/bozuk.png" alt="corrupt"/></p>' + paragraph(2)) }],
    files: { 'r/bozuk.png': CORRUPT_PNG } });
  await freshPage(page, address);
  const o3 = await epubSec(page, 'bozuk-resim.epub', corruptEpub);
  const u3 = (await page.textContent('#epub-warning')).trim();
  check('O3', o3.card >= 1 && !/açılamadı/.test(o3.notice), `${label}: bozuk PNG'li EPUB dönüşür (kart ≥ 1, hata yok)`, `card ${o3.card}; ${o3.notice}`);
  check('O3', /^1 resim atlandı/.test(u3) && !/Yazı tipi/.test(u3) && !/Cannot|undefined/.test(o3.notice + u3), `${label}: U1 "1 resim atlandı", yazı tipi uyarısı ve ham İngilizce hata yok`, u3);

  // ---- D4: EPUB uyarısı yeni (PDF) yüklemede temizlenir; bayat (yavaş) dönüşüm sonucu atılır ----
  await setupHelpers(page);
  await epubSec(page, 'tr-mini.epub', U.ready.trMini()); // U1 uyarısı veren EPUB (1 SVG, 1 tablo)
  const onceWarning = (await page.textContent('#epub-warning')).trim();
  const pdf8 = Buffer.from(await page.evaluate(async () => Array.from(await window.__t.numberedPdf(8))));
  await page.setInputFiles('#pdf-file', { name: 'sekiz.pdf', mimeType: 'application/pdf', buffer: pdf8 });
  await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 8);
  const restWarning = (await page.textContent('#epub-warning')).trim();
  check('D4', onceWarning !== '' && restWarning === '', `${label}: EPUB'dan sonra PDF yüklenince eski EPUB uyarısı temizlenir`, `önce: ${onceWarning.slice(0, 40) || '(boş)'}; sonra: ${restWarning || '(boş)'}`);
  await page.evaluate(async () => {
    const pdf3 = await window.__t.numberedPdf(3);
    window.__slow = { current: 'çağrılmadı' };
    window.Mucellit.plugins.register({ name: 'Yavaş deneme', extensions: ['.slow'], convert: async (f, s) => {
      await new Promise((ok) => setTimeout(ok, 1500));
      window.__slow.current = s.isCurrent ? s.isCurrent() : 'isCurrent yok';
      return pdf3;
    } });
  });
  await page.setInputFiles('#pdf-file', { name: 'a.slow', mimeType: 'application/octet-stream', buffer: Buffer.from('slow') });
  await page.setInputFiles('#pdf-file', { name: 'yeni-sekiz.pdf', mimeType: 'application/pdf', buffer: pdf8 });
  await page.waitForFunction(() => /yeni-sekiz\.pdf/.test(document.getElementById('source-info').textContent));
  await page.waitForFunction(() => window.__slow.current !== 'çağrılmadı', null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const d4 = { card: await page.locator('#small-thumbs .card').count(), info: await page.textContent('#source-info'), current: await page.evaluate(() => window.__slow.current) };
  check('D4', d4.card === 8 && /yeni-sekiz\.pdf/.test(d4.info) && d4.current === false, `${label}: yavaş dönüşüm sürerken seçilen PDF kalır; bayat sonuç atılır (isCurrent false)`, JSON.stringify(d4));

  // ---- D5: tablo hücresinde script/style/gizli metin yok; iç içe tablo satırı yinelenmez; satır içi önbellek sınırlı ----
  const tableX = U.xhtml('<h1>Tablo</h1><table>' +
    '<tr><td>DIS1<script>KOTUSCRIPT()</script><style>.k{}</style><span style="display:none">GIZLISTIL</span><span hidden="hidden">GIZLIOZ</span></td><td>DIS2</td></tr>' +
    '<tr><td><table><tr><td>IC1</td><td>IC2</td></tr></table></td><td>DIS3</td></tr></table>' +
    Array.from({ length: 2600 }, (_, i) => `<span style="margin-left: ${i}px">s${i} </span>`).join(''));
  const tableEpub = U.epub({ sections: [{ name: 't.xhtml', xhtml: tableX }] });
  const ir5 = await page.evaluate(([d]) => window.__e.ir(d, 'OEBPS/t.xhtml'), [Array.from(tableEpub)]);
  const metin5 = ir5.blocks.flatMap((b) => (b.parts || []).map((p) => p.text || '')).join(' | ');
  const ic1 = (metin5.match(/IC1/g) || []).length;
  check('D5', !/KOTUSCRIPT|GIZLISTIL|GIZLIOZ|\.k\{/.test(metin5) && /DIS1/.test(metin5) && ic1 === 1 && /IC2/.test(metin5) && /DIS3/.test(metin5),
    `${label}: tablo hücresinde script/style/gizli öğe yok; iç içe tablo satırı bir kez`, `IC1 ${ic1} times; ${metin5.slice(0, 120)}`);
  check('D5', typeof ir5.inline === 'number' && ir5.inline > 0 && ir5.inline <= 2000, `${label}: satır içi stil önbelleği dönüşüme özel ve ≤ 2000 girdi (2600 farklı style)`, String(ir5.inline));

  // ---- Kodlama: windows-1254 bildirimli XHTML doğru çözülür; desteklenmeyen kodlama U1'de bildirilir ----
  const trSentence = 'Iğdır ılık İstanbul; ÖĞÜŞÇ ğüşıöçİ';
  const xhtml1254 = (code) => Buffer.concat([Buffer.from(`<?xml version="1.0" encoding="${code}"?>\n<html xmlns="${U.NS.xhtml}" xml:lang="tr"><head><title>K</title></head><body><h1>Encoding</h1><p>`), w1254(trSentence), Buffer.from('</p></body></html>')]);
  const kodEpub = U.epub({ sections: [{ name: 'k.xhtml', xhtml: xhtml1254('windows-1254') }] });
  const irK = await page.evaluate(([d]) => window.__e.ir(d, 'OEBPS/k.xhtml'), [Array.from(kodEpub)]);
  const metinK = irK.blocks.flatMap((b) => (b.parts || []).map((p) => p.text || '')).join(' ');
  check('CODE', metinK.includes(trSentence) && !metinK.includes('�'), `${label}: windows-1254 bildirimli XHTML Türkçe harflerle çözülür`, metinK.slice(0, 80));
  const noCode = U.epub({ sections: [{ name: 'k.xhtml', xhtml: xhtml1254('x-unknown-code') }] });
  await freshPage(page, address);
  const ky = await epubSec(page, 'kodlama.epub', noCode);
  const uK = (await page.textContent('#epub-warning')).trim();
  check('CODE', ky.card >= 1 && /Desteklenmeyen karakter kodlaması \(x-unknown-code\)/.test(uK) && await page.isVisible('#epub-warning .warning'),
    `${label}: desteklenmeyen kodlama U1'de bildirilir (görünür)`, uK);

  // ---- Madde 13: başarılı yüklemeden sonra hatalı dosya → önceki belge temizlenir, indirme kapalı (EPUB ve PDF) ----
  const pickFile = async (name, mime, bytes) => {
    await page.evaluate(() => { const b = document.getElementById('notice'); b.textContent = ''; b.className = ''; });
    await page.setInputFiles('#pdf-file', { name: name, mimeType: mime, buffer: bytes });
    await page.waitForFunction(() => { const b = document.getElementById('notice'); return b.classList.contains('error') || / yüklendi /.test(b.textContent); }, null, { timeout: 90000 });
    await page.waitForTimeout(150); // guncelle() requestAnimationFrame ile çizer
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
  const iyiE = await pickFile('tr-mini.epub', EPUB_MIME, U.ready.trMini());
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled, null, { timeout: 20000 });
  const badE = await pickFile('bozuk.epub', EPUB_MIME, U.ready.corrupt());
  check('file-error', iyiE.card >= 3 && badE.card === 0 && badE.closed && badE.notice.includes(E_MESSAGE.E1) && badE.warning === '' && /açılamadı/.test(badE.info),
    `${label}: trMini → bozuk.epub: kart 0, indirme kapalı, Türkçe E1, EPUB uyarısı temiz`, JSON.stringify({ once: iyiE.card, card: badE.card, closed: badE.closed, notice: badE.notice, warning: badE.warning, info: badE.info }));
  await setupHelpers(page);
  const iyiP = await pickFile('sekiz.pdf', 'application/pdf', Buffer.from(await page.evaluate(async () => Array.from(await window.__t.numberedPdf(8)))));
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled, null, { timeout: 20000 });
  const corruptPdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 37 + 11) % 256))]);
  const badP = await pickFile('bozuk.pdf', 'application/pdf', corruptPdf);
  check('file-error', iyiP.card === 8 && badP.card === 0 && badP.closed && /^Dosya açılamadı: dosya bozuk/.test(badP.notice) && !/Invalid|structure|Error/i.test(badP.notice),
    `${label}: geçerli PDF → bozuk PDF: kart 0, indirme kapalı, Türkçe hata`, JSON.stringify({ once: iyiP.card, card: badP.card, closed: badP.closed, notice: badP.notice }));
}

async function epubPerformance(page, address, label) {
  const U = require('./epub-build.cjs');
  const long = U.ready.long();
  await freshPage(page, address);
  // önceki akıştan localStorage'da kalmış ölçü olmasın: A5, cilt payı ve dış kenar 0
  await page.fill('#book-width', '148'); await page.fill('#book-height', '210'); await page.fill('#outer-margin', '0'); await page.fill('#binding-allowance', '0');
  const head = Date.now();
  const r = await epubSec(page, 'uzun.epub', long, 120000);
  const sure = (Date.now() - head) / 1000;
  console.log(`bilgi: ${label}: uzun.epub (~90 000 kelime, ${long.length} bayt) dönüşüm ${sure.toFixed(1)} s, ${r.card} page`);
  check('B14', r.card > 100 && sure < 60, `${label}: uzun.epub (~90 bin kelime) dönüşümü < 60 s`, `${sure.toFixed(1)} s, ${r.card} page; ${r.notice}`);
}

function agCheck(iz, localPrefix, label, criterion) {
  const out = iz.requests.filter((u) => !(u.startsWith(localPrefix) || u.startsWith('data:') || u.startsWith('blob:')));
  // file:// ve yerel sunucu dışındaki her istek (http/https dahil) izinsizdir
  check(criterion, out.length === 0, `${label}: dış ağ isteği yok (yalnız yerel istekler)`,
    out.length ? JSON.stringify([...new Set(out)]) : `${iz.requests.length} istek, hepsi yerel`);
}

// ------------------------------------------------------------------
//: onay geçişi. Tauri'nin dialog eklentisi window.confirm'ü Promise döndüren işlevle ezer;
// eski `if (!confirm(...)) return;` kalıbı Promise'i "evet" sayıp onaysız silerdi. Her işlem için:
// (a) yerel confirm "hayır" (dialog.dismiss), (b) Tauri benzeri async confirm → false; ikisinde de veri değişmez.
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
  for (const name of ['Onay Bir', 'Onay İki']) {
    await page.fill('#yk-name', name);
    await page.selectOption('#yk-kind', 'sewn');
    await page.click('#yk-create');
    await page.waitForFunction((a) => document.querySelector('#book-detail h2') && document.querySelector('#book-detail h2').textContent === a, name);
  }
  const first = await readStorage(page);
  check(O, first && first.projects.length === 2, `${label}: onay hazırlığı: 2 kitap`, first && first.projects.length);
  const backupPath = join(await fsp.mkdtemp(join(os.tmpdir(), 'mc-confirmation-')), 'yedek.json');
  await fsp.writeFile(backupPath, JSON.stringify(Object.assign({}, first, { projects: [first.projects[0]] })));

  const asyncConfirm = (response) => page.evaluate((y) => {
    window.__originalConfirm = window.__originalConfirm || window.confirm;
    window.__confirmCounter = 0;
    window.confirm = async function () { window.__confirmCounter += 1; return y; };
  }, response);
  const localConfirm = () => page.evaluate(() => { if (window.__originalConfirm) window.confirm = window.__originalConfirm; });
  const calm = () => page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
  const stepCount = () => page.locator('#steps .step').count();

  // her işlem: tetik() → önce/sonra veri karşılaştırması
  const operations = [
    { name: 'Kitabı sil', trigger: () => page.click('#book-remove') },
    { name: 'Adımı çıkar', trigger: () => page.locator('#steps .step-remove').first().click() },
    { name: 'Tümünü temizle', trigger: () => page.click('#data-clear') },
    { name: 'İçe aktar (değiştir)', trigger: () => page.setInputFiles('#json-import', backupPath) },
  ];
  for (const is of operations) {
    // (a) yerel confirm "hayır"
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
      `${label}: ${is.name}: yerel onay "hayır" → veri değişmedi`, `confirmation penceresi ${iz.confirms.length}, kitap ${afterA && afterA.projects.length}`);
    // (b) Tauri dialog eklentisi benzeri: confirm Promise<false> döner
    await asyncConfirm(false);
    await is.trigger();
    await page.waitForFunction(() => window.__confirmCounter > 0, null, { timeout: 10000 }).catch(() => {});
    await calm();
    const counter = await page.evaluate(() => window.__confirmCounter);
    await localConfirm();
    const afterB = await readStorage(page);
    check(O, counter === 1 && isDeepStrictEqual(afterB, once) && (await stepCount()) === stepOnce,
      `${label}: ${is.name}: Promise döndüren onay "hayır" (Tauri benzeri) → veri değişmedi`, `onay çağrısı ${counter}, kitap ${afterB && afterB.projects.length}`);
  }

  // "evet" yolları: async true ile kitap silinir; yerel "evet" ile içe aktarma değiştirir
  const selected = await page.textContent('#book-detail h2');
  await asyncConfirm(true);
  await page.click('#book-remove');
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 1, null, { timeout: 10000 }).catch(() => {});
  await localConfirm();
  const remove = await readStorage(page);
  check(O, remove.projects.length === 1 && remove.projects[0].name !== selected, `${label}: Kitabı sil: Promise döndüren onay "evet" → seçili kitap silindi`, `${selected}; kalan ${remove.projects.map((k) => k.name).join(', ')}`);
  const yedek2 = join(dirname(backupPath), 'yedek2.json');
  await fsp.writeFile(yedek2, JSON.stringify(first));
  iz.confirms.length = 0;
  await page.setInputFiles('#json-import', yedek2);
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 2, null, { timeout: 10000 }).catch(() => {});
  const importData = await readStorage(page);
  check(O, iz.confirms.length === 1 && isDeepStrictEqual(importData, first), `${label}: İçe aktar: yerel onay "evet" → veri yedekle değişti`, `confirmation penceresi ${iz.confirms.length}, kitap ${importData.projects.length}`);

  // D9: Adım çıkar "evet" (Promise döndüren onay, Tauri benzeri) → seçili kitabın ilk adımı çıkar
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
    `${label}: Adımı çıkar: Promise döndüren onay "evet" → ilk adım çıktı`, `onay çağrısı ${stepCounter}, adım ${stepOnce} → ${await stepCount()}`);

  // D9: Tümünü temizle yerel onay "evet" → bütün süreç verisi silinir
  iz.confirms.length = 0;
  await page.click('#data-clear');
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 0, null, { timeout: 10000 }).catch(() => {});
  const clean = await readStorage(page);
  check('confirmation', iz.confirms.length === 1 && (!clean || clean.projects.length === 0) && (await page.locator('#book-list li').count()) === 0,
    `${label}: Tümünü temizle: yerel onay "evet" → bütün kitaplar silindi`, `confirmation penceresi ${iz.confirms.length}, kitap ${clean ? clean.projects.length : 0}`);
  await fsp.rm(dirname(backupPath), { recursive: true, force: true });
}

//: sayfaya dosya bırakma PDF'i açar ve sayfadan ayrılmaz; ızgara içi sürükleme çalışır.
async function releaseFlow(page, address, label) {
  const O = 'G8';
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-projects');
  const pdf = await makeTestPdf(page);
  const result = await page.evaluate((array) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(array)], 'birak.pdf', { type: 'application/pdf' }));
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
  check(O, result.ov && result.dr && card === 37 && /birak\.pdf/.test(info) && tab === 'true' && page.url() === address,
    `${label}: sayfaya bırakılan PDF açıldı, Düzenle sekmesine geçildi, sayfadan ayrılmadı`, JSON.stringify({ result, card, tab, info: info.slice(0, 60) }));

  // ızgara içi sürükleme: 1. kartı 3. kartın sağ yarısına bırak → sıra 2, 3, 1, 4…
  const sourceOrder = () => page.$$eval('#small-thumbs .card', (l) => l.slice(0, 4).map((k) => k.getAttribute('data-id')));
  const once = await sourceOrder();
  const target = page.locator('#small-thumbs .card').nth(2);
  const box = await target.boundingBox();
  await page.locator('#small-thumbs .card').nth(0).dragTo(target, { targetPosition: { x: Math.round(box.width * 0.8), y: Math.round(box.height / 2) } });
  await page.waitForTimeout(200);
  const after = await sourceOrder();
  check(O, JSON.stringify(after.slice(0, 3)) === JSON.stringify([once[1], once[2], once[0]]),
    `${label}: ızgara içi sürükleme (1. sayfa → 3.'nün arkası) çalışır, dosya bırakma işleyicisi karışmaz`, JSON.stringify({ once, after }));
}

// ------------------------------------------------------------------
//: CSP ve Object.prototype dondurma; içe aktarmada platform.dosyaSec sonucu.
// ------------------------------------------------------------------
async function m1FixFlow(page, address, iz, label, cspTest) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const rotated = await page.evaluate(() => ({ rotated: Object.isFrozen(Object.prototype), pdfLib: !!window.PDFLib, pdfjs: !!window.pdfjsLib }));
  check('security', rotated.rotated && rotated.pdfLib && rotated.pdfjs, `${label}: Object.prototype dondurulmuş, pdf-lib ve pdf.js yüklü`, JSON.stringify(rotated));

  if (cspTest) {
    // Ayrı sekme: CSP fetch'i ağa çıkmadan reddetmeli. Güvenlik ağı: example.com isteği Playwright'ta kesilir
    // (CSP yoksa fetch yine reddedilir ama ihlal olayı olmaz → KALDI; gerçek ağa istek çıkmaz).
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
      `${label}: CSP etkin: fetch('https://example.com') connect-src ile reddedildi, istek ağa çıkmadı`, JSON.stringify({ ...s, cut, csp: TAURI_CSP ? 'var' : 'none' }));
  }

  // O4: dosyaSec File döndürürse (yerel diyalog) içe aktarma çalışır; reddedilirse bildirim, işlenmemiş red yok.
  await page.evaluate(() => { localStorage.removeItem('mucellit.projects'); localStorage.removeItem('mucellit.selectedProject'); });
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-projects');
  await page.fill('#yk-name', 'Seçici Kitap');
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
    P.pickFile = function () { window.__choiceCounter += 1; return Promise.resolve(new File([json], 'yedek.json', { type: 'application/json' })); };
  }, JSON.stringify(backup));
  await page.click('#json-import-button');
  await page.waitForFunction(() => document.querySelectorAll('#book-list li').length === 1, null, { timeout: 10000 }).catch(() => {});
  const importData = await readStorage(page);
  const secim1 = await page.evaluate(() => window.__choiceCounter);
  check('import-transfer', secim1 === 1 && isDeepStrictEqual(importData, backup), `${label}: içe aktar: pickFile File döndürünce yedek içe aktarıldı`,
    `seçici ${secim1}, kitap ${importData ? importData.projects.length : 0}`);

  await page.evaluate(() => { window.Mucellit.platform.pickFile = function () { return Promise.reject(new Error('seçici açılamadı')); }; });
  await page.click('#json-import-button');
  await page.waitForFunction(() => /İçe aktarılamadı: seçici açılamadı/.test(document.getElementById('notice').textContent), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  const notice = await page.textContent('#notice');
  const after = await readStorage(page);
  check('import-transfer', /İçe aktarılamadı: seçici açılamadı/.test(notice) && iz.errors.length === errorOnce && isDeepStrictEqual(after, backup),
    `${label}: içe aktar: pickFile reddi bildirime gider, işlenmemiş hata yok, veri değişmez`, `bildirim: ${notice}; yeni konsol hatası ${iz.errors.length - errorOnce}`);
  await page.evaluate(() => { window.Mucellit.platform.pickFile = window.__selectOriginalFile; });
}

// ------------------------------------------------------------------
// klasör paketi EPUB'un tarayıcı sıkıştırması ("<ad>.epub.zip"; Safari/WebKit Apple Kitaplar klasör paketini
// böyle verir): tek üst klasör öneki atılır, içerik sıradan EPUB gibi işlenir. Her iki koşuda.
// ------------------------------------------------------------------
async function prefixedEpubZip(U, epubBytes, prefix, suffixes) {
  const Z = require('../js/plugins/epub/zip.js');
  const z = Z.read(new Uint8Array(epubBytes));
  const g = [];
  for (const a of z.names()) g.push({ name: prefix + a, data: Buffer.from(await z.open(a)), method: 8 }); // WebKit: hepsi deflate
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
  await page.waitForFunction(() => { const b = document.getElementById('notice'); return b.classList.contains('error') || / yüklendi /.test(b.textContent); }, null, { timeout: 90000 });
  const card = await page.locator('#small-thumbs .card').count();
  const notice = (await page.textContent('#notice')) || '';
  const info = (await page.textContent('#source-info')) || '';
  check('file', card === expected && expected >= 3 && /^tr-mini\.pdf yüklendi/.test(notice) && /^tr-mini\.pdf — /.test(info),
    `${label}: .epub.zip (tek üst klasör, deflate, __MACOSX + .DS_Store) sıradan EPUB gibi dönüşür; ad tr-mini.pdf`, `card ${card}/${expected}; ${notice}; ${info}`);
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-transfer')]);
  check('file', download.suggestedFilename() === 'tr-mini-dizilmis.pdf', `${label}: .epub.zip'ten dizilmiş çıktı adı tr-mini-dizilmis.pdf (".epub.zip" atıldı)`, download.suggestedFilename());

  // repo fixture'ı (sentetik klasör paketi) klasör ZIP'i olarak: dönüşür, metin PDF'te
  const fz = folderFixtureZip(U, 'folder-package.epub/');
  const text = await page.evaluate(async ([d]) => {
    const f = new File([new Uint8Array(d)], 'folder-package.epub.zip', { type: 'application/zip' });
    const pdf = await window.Mucellit.epub.convert(f, { bookWidth: 148, bookHeight: 210, gutter: 0, outerMargin: 0 });
    return (await window.__e.inspect(Array.from(pdf))).map((s) => s.elements.map((o) => o.str).join(' ')).join(' ');
  }, [Array.from(fz)]).then(withSpaces);
  check('file', /KLASORPAKETI/.test(text) && /Birinci Bölüm/.test(text) && !text.includes('�'),
    `${label}: app/test/fixtures/folder-package.epub (klasör ZIP'i) dönüşür; iki bölümün metni PDF'te`,
    JSON.stringify({ mark: /KLASORPAKETI/.test(text), chapter: /Birinci Bölüm/.test(text), fffd: text.includes('�'), head: text.slice(0, 60) }));

  // kusurlu: iki üst klasör → önek atılmaz → E2 (container yok); kart 0, indirme kapalı
  await freshPage(page, address);
  const iki = await prefixedEpubZip(U, tr, 'A.epub/', [{ name: 'B/okubeni.txt', data: 'x' }]);
  const r = await epubSec(page, 'iki-klasor.epub.zip', iki);
  check('file', r.notice.includes(E_MESSAGE.E2) && r.card === 0 && await page.isDisabled('#export-transfer'),
    `${label}: iki üst klasörlü .epub.zip: E2 Türkçe mesaj, kart 0, indirme kapalı`, r.notice);
}

// ------------------------------------------------------------------
// Tauri benzetimi: sahte window.__TAURI__ (init betiği) ile platform-tauri.js gerçek sayfada çalışır.
// Dizilmiş PDF ve JSON yedeği yerel Kaydet penceresinden (sahte dosya_kaydet) geçer: vazgeçilince "kaydedilmedi",
// yazılınca gerçek yol; tarayıcı indirmesi hiç başlamaz. Açılışta otomatik yedek geri yüklenir; değişiklik yedeklenir.
// ------------------------------------------------------------------
const FAKE_TAURI = `(() => {
  const record = (window.__fake = { call: [], saveResponse: null, saveOrder: null, saveError: null, saveGate: null,
    backup: sessionStorage.getItem('fakeBackup') || '{"version":2,"projects":[]}', listener: {}, openResponse: null, table: {}, pending: [] });
  const bytes = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
  // Rust'ın initialization_script'i (i18n::init_script): system language page betiklerinden önce
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
      // yazdırma (Rust print: true = yazdırıldı, false = vazgeçildi; dize/Error = Rust hatası) ve Önizleme'de Aç
      if (command === 'print') {
        record.call[record.call.length - 1].notAn = (document.getElementById('notice') || {}).textContent;
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
        delete record.table[arg.id]; // Rust'taki like single kullanımlık id
        if (!b) throw 'UNKNOWN: bu kimlikle açılmış file none';
        return bytes(b);
      }
      if (command === 'read_backup') return record.backup;
      if (command === 'backup_data') { record.lastBackup = arg.json; return null; }
      if (command === 'pending_opens') { const k = record.pending; record.pending = []; return k; }
      if (command === 'recent_files') return [];
      // system: Rust'ın NSLocale + Apple kuralıyla bulduğu system language (benzetimde öntanımlı tr = tr-TR tarayıcı)
      // read_language anındaki (Rust kararı gelmeden önceki, first square) arayüz language
      if (command === 'read_language' && !record.firstSquare) record.firstSquare = { lang: document.documentElement.lang, tab: (document.getElementById('tab-button-impose') || {}).textContent };
      if (command === 'read_language') return { code: sessionStorage.getItem('fakeI18nCode') || 'tr', choice: sessionStorage.getItem('fakeI18nChoice') || 'system', system: sessionStorage.getItem('fakeSystem') || 'tr' };
      if (command === 'set_language') {
        record.i18nSettings = (record.i18nSettings || []).concat([[arg.code, arg.choice]]);
        sessionStorage.setItem('fakeI18nCode', arg.code);
        if (arg.choice === 'system') sessionStorage.removeItem('fakeI18nChoice'); else sessionStorage.setItem('fakeI18nChoice', arg.choice);
        return null;
      }
      throw new Error('beklenmeyen command: ' + command);
    } },
    event: { listen: async (name, f) => { record.listener[name] = f; return () => {}; } },
    // local confirmation (dialog eklentisi): soru kaydedilir; yanıt askOrder'dan (ifMissing yes)
    dialog: { ask: async (m) => { (record.questions = record.questions || []).push(m); return record.askOrder && record.askOrder.length ? record.askOrder.shift() : true; } },
  };
})();`;

async function m2TauriSimulation(page, address, label) {
  await page.addInitScript({ content: FAKE_TAURI });
  const clearNotice = () => page.evaluate(() => { const b = document.getElementById('notice'); b.textContent = ''; b.className = ''; });
  // O2: localStorage boş + yedek boş (kasıtlı temizlik sonrası): geri yüklenmez, "geri yüklendi" bildirimi çıkmaz
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.waitForTimeout(500);
  const blank = await page.evaluate(() => ({ name: window.Mucellit.platform.name, button: document.getElementById('export-transfer').textContent,
    ls: localStorage.getItem('mucellit.projects'), notice: document.getElementById('notice').textContent }));
  check('file', blank.name === 'tauri' && blank.button === "Dizilmiş PDF'i kaydet…" && blank.ls === null && !/geri yüklendi/.test(blank.notice),
    `${label}: platform tauri; Kaydet düğmesi metni; BOŞ yedek geri yüklenmedi, "geri yüklendi" bildirimi yok (O2)`, JSON.stringify(blank));
  // dolu yedek, boş localStorage: geri yüklenir ve bildirilir
  const filledBackup = JSON.stringify({ version: 2, projects: [{ id: 'k-restored', name: 'Geri Gelen Kitap', bindingType: 'single', steps: [] }] });
  await page.evaluate((y) => { sessionStorage.setItem('fakeBackup', y); localStorage.clear(); }, filledBackup);
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const startup = await page.evaluate(() => localStorage.getItem('mucellit.projects'));
  check('file', startup === filledBackup, `${label}: boş localStorage dolu otomatik yedekten geri yüklendi`, String(startup));
  await page.waitForFunction(() => /otomatik yedekten geri yüklendi/.test(document.getElementById('notice').textContent), null, { timeout: 5000 })
    .then(() => check('file', true, `${label}: "otomatik yedekten geri yüklendi" bildirimi`), () => check('file', false, `${label}: "otomatik yedekten geri yüklendi" bildirimi`));

  let downloadCount = 0;
  page.on('download', () => { downloadCount += 1; });
  const pdf = await makeTestPdf(page);
  const pdf64 = pdf.toString('base64');
  await page.click('#tab-button-impose');
  await page.selectOption('#binding-type', 'sewn');
  // D11: yerel Aç penceresi → dosya_ac {amac: belge} → dosya_oku {kimlik} ham ArrayBuffer → File → yüklenir
  await page.evaluate((b) => { window.__fake.openResponse = { id: 'k-open-1', name: 'test-37.pdf', kind: 'pdf' }; window.__fake.table['k-open-1'] = b; }, pdf64);
  await clearNotice();
  await page.click('#pdf-select');
  const opened = await page.waitForFunction(() => !document.getElementById('export-transfer').disabled, null, { timeout: 30000 }).then(() => true, () => false);
  const open = await page.evaluate(() => ({ notice: document.getElementById('notice').textContent,
    call: window.__fake.call.filter((c) => c.command === 'open_file' || c.command === 'read_file').map((c) => [c.command, c.purpose || c.id]),
    rest: Object.keys(window.__fake.table).length }));
  check('file', /test-37\.pdf yüklendi \(37 sayfa\)/.test(open.notice) && JSON.stringify(open.call) === '[["open_file","document"],["read_file","k-open-1"]]' && open.rest === 0,
    `${label}: D11 yerel Aç → open_file + read_file (ham ArrayBuffer) → 37 sayfa yüklendi`, JSON.stringify(open));
  if (!opened) { // akışın geri kalanı sınansın diye PDF gizli girdiyle yüklenir (yukarıdaki kontrol zaten KALDI)
    await page.setInputFiles('#pdf-file', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.waitForFunction(() => !document.getElementById('export-transfer').disabled, null, { timeout: 30000 });
  }
  async function exportNotice() {
    await clearNotice();
    await page.click('#export-transfer');
    await page.waitForFunction(() => /Kaydedildi|kaydedilmedi|kaydedilemedi/.test(document.getElementById('notice').textContent), null, { timeout: 30000 });
    return { text: await page.textContent('#notice'), error: await page.evaluate(() => document.getElementById('notice').classList.contains('error')) };
  }
  // vazgeç
  const vaz = await exportNotice();
  const c1 = await page.evaluate(() => window.__fake.call.filter((c) => c.command === 'save_file'));
  check('file', /^Dizilmiş PDF kaydedilmedi/.test(vaz.text) && vaz.error && !/hazır/.test(vaz.text) && c1.length === 1 && c1[0].name === 'test-37-dizilmis.pdf' && c1[0].kind === 'pdf' && c1[0].size > 1000,
    `${label}: D7 Kaydet'te vazgeç → "kaydedilmedi" (hata), "hazır" yok; save_file ham bayt + önerilen ad`, `${vaz.text} / ${JSON.stringify(c1)}`);
  // yaz
  await page.evaluate(() => { window.__fake.saveResponse = '/Users/deneme/Masaüstü/test-37-dizilmis.pdf'; });
  const write = await exportNotice();
  check('file', write.text === 'Kaydedildi: /Users/deneme/Masaüstü/test-37-dizilmis.pdf (24 yüz).' && !write.error,
    `${label}: D7 Kaydet'te yazıldı → gerçek yol ile başarı bildirimi`, write.text);
  // D11 hatali dalı: Kaydet yazamadı → "kaydedilemedi: <Rust hatası>" (hata), başarı yok
  await page.evaluate(() => { window.__fake.saveError = 'yazılamadı: Operation not permitted (os error 1)'; });
  const hat = await exportNotice();
  await page.evaluate(() => { window.__fake.saveError = null; });
  check('file', hat.text === 'test-37-dizilmis.pdf kaydedilemedi: yazılamadı: Operation not permitted (os error 1)' && hat.error,
    `${label}: D11 Kaydet hatası → "kaydedilemedi" + Rust hata metni (hata stili)`, hat.text);
  // D10: Kaydet penceresi açıkken ⌘S → yok sayılır (ikinci pencere yok, "Önce bir PDF" yok); sonra sonuç bildirilir
  await page.evaluate(() => { const s = window.__fake; s.saveGate = new Promise((r) => { s.openGate = r; }); s.call.length = 0; });
  await clearNotice();
  await page.click('#export-transfer');
  await page.waitForFunction(() => window.__fake.call.some((c) => c.command === 'save_file'), null, { timeout: 30000 });
  const isOpen = await page.evaluate(() => { window.Mucellit.platform.onMenu('file-save'); return { notice: document.getElementById('notice').textContent,
    busy: document.getElementById('export-transfer').getAttribute('aria-busy') }; });
  await page.evaluate(() => { const s = window.__fake; s.saveGate = null; s.openGate(); });
  await page.waitForFunction(() => /Kaydedildi/.test(document.getElementById('notice').textContent), null, { timeout: 30000 });
  const after = await page.evaluate(() => ({ save: window.__fake.call.filter((c) => c.command === 'save_file').length,
    busy: document.getElementById('export-transfer').getAttribute('aria-busy'), closed: document.getElementById('export-transfer').disabled }));
  check('file', isOpen.busy === 'true' && !/Önce bir PDF/.test(isOpen.notice) && after.save === 1 && after.busy === null && !after.closed,
    `${label}: D10 Kaydet penceresi açıkken ⌘S yok sayıldı (tek pencere, yanlış bildirim yok); bitince düğme serbest`, JSON.stringify({ isOpen, after }));
  // D9: iki PDF modunda önler yazıldı, arkalar vazgeçildi → yalnız yazılanın yüz sayısı
  await page.selectOption('#output-mode', 'pair');
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled);
  await page.evaluate(() => { window.__fake.call.length = 0; window.__fake.saveOrder = ['/Users/deneme/Masaüstü/test-37-onler.pdf', null]; });
  const pair = await exportNotice();
  await page.evaluate(() => { window.__fake.saveOrder = null; });
  const c2 = await page.evaluate(() => window.__fake.call.filter((c) => c.command === 'save_file').map((c) => c.name));
  check('file', c2.length === 2 && /-onler\.pdf$/.test(c2[0]) && /-arkalar\.pdf$/.test(c2[1]),
    `${label}: iki PDF modu → iki Kaydet penceresi sırayla (önler, arkalar)`, JSON.stringify(c2));
  check('file', pair.text === 'Kaydedildi: /Users/deneme/Masaüstü/test-37-onler.pdf (12 yüz). Kaydedilmedi (vazgeçildi): test-37-arkalar.pdf.' && pair.error,
    `${label}: D9 kısmi kayıt → yalnız yazılan dosyanın yüz sayısı (12, toplam 24 değil)`, pair.text);
  await page.selectOption('#output-mode', 'single');
  // D11: Dock/Finder'dan açılış: dosya-acildi olayı → bekleyen_acilanlar → dosya_oku → yüklenir; okunamayan bildirilir
  await page.click('#tab-button-projects');
  await page.evaluate((b) => { const s = window.__fake; s.call.length = 0; s.table['k-dock-1'] = b;
    s.pending = [{ id: 'k-dock-1', name: 'dock-37.pdf', kind: 'pdf' }]; }, pdf64);
  await clearNotice();
  await page.evaluate(() => window.__fake.listener['file-opened']({ payload: null }));
  await page.waitForFunction(() => /dock-37\.pdf yüklendi \(37 sayfa\)/.test(document.getElementById('notice').textContent), null, { timeout: 30000 })
    .catch(() => {});
  const dock = await page.evaluate(() => ({ notice: document.getElementById('notice').textContent,
    impose: !document.getElementById('tab-impose').hidden, call: window.__fake.call.map((c) => c.command + (c.id ? ':' + c.id : '')) }));
  check('file', /dock-37\.pdf yüklendi \(37 sayfa\)/.test(dock.notice) && dock.impose && JSON.stringify(dock.call) === '["pending_opens","read_file:k-dock-1"]',
    `${label}: D11 Opened (file-opened) → pending_opens → read_file → Düzenle'de 37 sayfa`, JSON.stringify(dock));
  await page.evaluate(() => { window.__fake.pending = [{ id: 'k-none', name: 'kayip.pdf', kind: 'pdf' }]; });
  await clearNotice();
  await page.evaluate(() => window.__fake.listener['file-opened']({ payload: null }));
  await page.waitForFunction(() => /Dosya açılamadı/.test(document.getElementById('notice').textContent), null, { timeout: 5000 }).catch(() => {});
  const loss = await page.evaluate(() => ({ text: document.getElementById('notice').textContent, error: document.getElementById('notice').classList.contains('error') }));
  check('file', /^Dosya açılamadı: UNKNOWN/.test(loss.text) && loss.error, `${label}: D11 okunamayan dış açılış hata bildirimine gider`, loss.text);
  // JSON yedeği: vazgeç ve yaz
  await page.click('#tab-button-projects');
  await page.evaluate(() => { window.__fake.saveResponse = null; const b = document.getElementById('notice'); b.textContent = ''; });
  await page.click('#json-export');
  await page.waitForFunction(() => /kaydedilmedi|dışa aktarıldı/.test(document.getElementById('notice').textContent));
  const jv = await page.textContent('#notice');
  await page.evaluate(() => { window.__fake.saveResponse = '/Users/deneme/Belgeler/mucellit-yedek.json'; const b = document.getElementById('notice'); b.textContent = ''; });
  await page.click('#json-export');
  await page.waitForFunction(() => /kaydedilmedi|dışa aktarıldı/.test(document.getElementById('notice').textContent));
  const jy = await page.textContent('#notice');
  const jc = await page.evaluate(() => window.__fake.call.filter((c) => c.command === 'save_file' && c.kind === 'json').length);
  check('file', /^JSON yedeği kaydedilmedi/.test(jv) && /dışa aktarıldı: \/Users\/deneme\/Belgeler\/mucellit-yedek\.json\.$/.test(jy) && jc === 2,
    `${label}: JSON yedeği: vazgeç → "kaydedilmedi", yazıldı → yol`, `${jv} / ${jy}`);
  check('file', downloadCount === 0, `${label}: Tauri modunda tarayıcı indirmesi hiç başlamadı (<a download> yok)`, `${downloadCount} download`);
  // otomatik yedek: kitap ekle → veri_yedekle (oturum + sıra)
  await page.fill('#yk-name', 'Yedek Kitabı');
  await page.click('#yk-create');
  await page.waitForFunction(() => window.__fake.lastBackup && /Yedek Kitabı/.test(window.__fake.lastBackup), null, { timeout: 5000 })
    .then(() => check('file', true, `${label}: Süreç değişikliği otomatik yedeğe (backup_data) gitti`),
      () => check('file', false, `${label}: Süreç değişikliği otomatik yedeğe (backup_data) gitti`));
  // O2: Tümünü temizle → boş veri yedeği BEKLEMEDEN (eski 1 sn bekletme yok; kapanışta Rust yazar)
  const t0 = await page.evaluate(() => Date.now());
  await page.click('#data-clear');
  const clean = await page.waitForFunction((t) => {
    const y = window.__fake.call.filter((c) => c.command === 'backup_data' && c.time >= t).find((c) => /"projects":\[\]/.test(c.json));
    return y ? { delay: y.time - t, session: y.session, order: y.order } : false;
  }, t0, { timeout: 900 }).then((h) => h.jsonValue(), () => null);
  check('file', clean && clean.delay < 900 && typeof clean.session === 'string' && clean.order > 0,
    `${label}: O2 Tümünü temizle → boş yedek bekletmeden Rust'a gitti (oturum + sıra)`, JSON.stringify(clean));
  // Rust'taki gecikmeli yazım başarısızsa (yedek-yazilamadi olayı) hata bildirimi
  await clearNotice();
  await page.evaluate(() => window.__fake.listener['backup-writeFailed']({ payload: 'yedek yazılamadı: No space left on device' }));
  const yh = await page.evaluate(() => ({ text: document.getElementById('notice').textContent, error: document.getElementById('notice').classList.contains('error') }));
  check('file', /otomatik yedeği yazılamadı: yedek yazılamadı: No space left on device/.test(yh.text) && yh.error,
    `${label}: O2 backup-writeFailed olayı hata bildirimine gider`, yh.text);
}

// ------------------------------------------------------------------
// arayüz dili
// ------------------------------------------------------------------
const TR_LETTER = /[çğıöşüÇĞİÖŞÜ]/;
// uygulama adı "Mücellit" çevrilmez (yalnız tam sözcük, sözcük sınırı; "Mücellitler" gibi uzantılı sözcük muaf değil)
const trLetter = (m) => TR_LETTER.test(String(m).replace(/\bMücellit\b/g, ''));
const OLD_RECORD = join(FIXTURE, 'legacy');

/** Görünen gövde metni (dil seçicideki "Türkçe" adı ve verilen kullanıcı metinleri hariç). */
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
  check('i18n', e.length === 0, `${label}: sözlükte eksik anahtar yok`, JSON.stringify(e));
}

/**
 * sayı alanları ve Hesapla sonuç tablosu arayüz dilinin ondalık ayracıyla (en ".", tr ","); giriş iki ayraçla
 * da kabul edilir ve alandan çıkınca dilin biçimine döner; ↑ tuşu adımı (eski type=number davranışı) korunur.
 */
async function decimalFlow(page, label, i18n) {
  const ay = i18n === 'tr' ? ',' : '.', other = i18n === 'tr' ? '.' : ',';
  const first = await page.evaluate(() => ['paper-thickness', 'paper-width', 'h-paperThickness', 'h-square', 'yk-thickness', 'outer-margin'].map((id) => document.getElementById(id).value));
  check('print', JSON.stringify(first) === JSON.stringify(['0' + ay + '1', '297', '0' + ay + '1', '3', '0' + ay + '1', '0']),
    `${label}: sayı alanları ${i18n} ondalık ayracıyla ("0${ay}1")`, JSON.stringify(first));
  await page.click('#tab-button-calculator');
  let entry = null;
  try {
    await page.fill('#h-paperThickness', '0' + other + '123');
    await page.press('#h-paperThickness', 'Tab');
    entry = await page.evaluate(() => ({ field: document.getElementById('h-paperThickness').value, spine: document.querySelector('[data-result="spineThickness"]').textContent }));
  } catch (e) { entry = { error: String(e.message).split('\n')[0] }; }
  check('print', entry && entry.field === '0' + ay + '123' && entry.spine === '12' + ay + '8 mm',
    `${label}: "0${other}123" (öbür ayraç) kabul edildi, alandan çıkınca "0${ay}123"; sırt 12${ay}8 mm`, JSON.stringify(entry));
  await page.focus('#h-square');
  await page.keyboard.press('ArrowUp');
  const table = await page.evaluate(() => ({ square: document.getElementById('h-square').value,
    cell: Array.from(document.querySelectorAll('#h-result td')).map((e) => e.textContent).join(' | ') }));
  const foreign = new RegExp('\\d\\' + other + '\\d');
  check('print', table.square === '3' + ay + '5' && !foreign.test(table.cell) && table.cell.includes(ay === ',' ? ',' : '.'),
    `${label}: ↑ ile adım (3 → 3${ay}5); sonuç tablosunda (değer + formül) yalnız "${ay}" ondalık ayracı`, JSON.stringify({ square: table.square, foreign: (table.cell.match(new RegExp('.{0,12}' + foreign.source + '.{0,12}')) || [''])[0] }));
  await page.fill('#h-paperThickness', '0' + ay + '1');
  await page.fill('#h-square', '3');
  await page.press('#h-square', 'Tab');
  // binliğe benzeyen sayfa sayısı ("1.200" tr / "1,200" en) sessizce 1,2 okunmaz; açık hata, sonuç yok.
  // "1200" ise 1200 sayfa. Alan aria-invalid, bildirimde aynı hata.
  const ambiguous = '1' + other + '200';
  await page.fill('#h-pageCount', ambiguous);
  await page.press('#h-pageCount', 'Tab');
  const b1 = await page.evaluate(() => ({ error: document.getElementById('h-error').textContent, line: document.querySelectorAll('#h-result tr').length,
    invalid: document.getElementById('h-pageCount').getAttribute('aria-invalid'), notice: document.getElementById('notice').textContent }));
  await page.fill('#h-pageCount', '1200');
  await page.press('#h-pageCount', 'Tab');
  const b2 = await page.evaluate(() => ({ total: (document.querySelector('[data-result="totalPages"]') || {}).textContent, error: document.getElementById('h-error').textContent,
    invalid: document.getElementById('h-pageCount').getAttribute('aria-invalid') }));
  const thousandsWord = i18n === 'tr' ? /binlik/ : /thousands/;
  check('print', thousandsWord.test(b1.error) && b1.error.includes(ambiguous) && b1.line === 0 && b1.invalid === 'true' && thousandsWord.test(b1.notice) &&
    b2.total === '1200' && b2.error === '' && b2.invalid === null,
    `${label}: Hesapla'da "${ambiguous}" açık hata (sonuç yok, alan geçersiz, bildirim); "1200" → 1200 sayfa`, JSON.stringify({ b1, b2 }));
  await page.fill('#h-pageCount', '200');
  await page.press('#h-pageCount', 'Tab');
}

/**
 * dil seçici başlıkta küçük bir seçici (tam genişlik çubuk değil): başlıkla aynı satırda, dar; erişilebilir
 * adı ve klavye erişimi korunur. Pencere 1280 px (Playwright öntanımlısı; Mac penceresi en az 1000 px).
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
      `${label}: ${width} px: dil seçici başlıkta küçük (≤ 240 px, başlık satırında), erişilebilir ad + klavye`, JSON.stringify(o));
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** Türkçe koşuların sonunda: html lang tr, sekmeler Türkçe (bugünkü metin), eksik anahtar yok. */
async function m6TrCheck(page, address, label) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const d = await page.evaluate(() => ({ lang: document.documentElement.lang, tab: Array.from(document.querySelectorAll('nav [role="tab"]')).map((b) => b.textContent),
    button: document.getElementById('export-transfer').textContent, code: window.Mucellit.i18n.code(), choice: document.getElementById('i18n-select').value }));
  check('i18n', d.lang === 'tr' && d.code === 'tr' && JSON.stringify(d.tab) === '["Düzenle","Süreç","Hesapla","Öğren"]' && /Dizilmiş PDF'i (indir|kaydet…)/.test(d.button) && d.choice === 'system',
    `${label}: tr-TR tarayıcıda sistem dili Türkçe; sekmeler ve düğme bugünkü metinle`, JSON.stringify(d));
  const storage = await page.textContent('#storage-hint');
  check('i18n', storage === 'Veri bu tarayıcıda saklanır. Tarayıcı verisi silinirse kaybolur; ara ara JSON yedeği alın.',
    `${label}: tarayıcıda saklama ipucu bugünkü Türkçe metin (Mac metni yalnız Tauri'de)`, storage);
  await decimalFlow(page, label, 'tr');
  await i18nPickerLayout(page, label);
  await printingHidden(page, label);
  await noMissingKey(page, label);
}

/** İngilizce arayüz (en-US): duman + eski Türkçe kayıt + elle dil seçimi. */
async function m6MostFlow(page, address, iz, label, tam) {
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const head = await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, tab: Array.from(document.querySelectorAll('nav [role="tab"]')).map((b) => b.textContent),
    button: document.getElementById('export-transfer').textContent, source: document.getElementById('source-info').textContent, choice: document.getElementById('i18n-select').value,
    options: Array.from(document.getElementById('i18n-select').options).map((o) => o.value + '=' + o.textContent) }));
  check('i18n', head.lang === 'en' && head.title === 'Mücellit' && JSON.stringify(head.tab) === '["Imposition","Projects","Calculator","Learn"]' && head.button === 'Download imposed PDF' &&
    head.source === 'No PDF loaded yet.' && head.choice === 'system' && JSON.stringify(head.options) === '["system=System language (English)","en=English","tr=Türkçe"]',
    `${label}: en-US tarayıcıda arayüz İngilizce (sekmeler, düğme, dil seçici)`, JSON.stringify(head));
  // değişen İngilizce metinler arayüzde
  const dm = await page.evaluate(() => {
    const m = (a) => (document.querySelector(`[data-i18n="${a}"]`) || {}).textContent;
    return { blank: [m('impose.blank_to_start'), m('impose.blank_before'), m('impose.blank_to_end')], spine: m('calculator.spine_shape'), endpapers: m('calculator.endpaper_allowance'), rule: m('calculator.spine_rule'),
      source: m('calculator.source'), hint: m('impose.output_hint'), storage: (document.getElementById('storage-hint') || {}).textContent };
  });
  check('i18n', JSON.stringify(dm.blank) === '["Insert blank at start","Insert blank before selected","Insert blank at end"]' && dm.spine === 'Spine shape' &&
    dm.endpapers === 'Endpaper thickness allowance (mm)' && dm.rule === 'Spine stiffener rule (flat spine)' && !/docs\//.test(dm.source) &&
    dm.hint === 'First sides of the exported file (actual output).' && /stored in this browser/.test(dm.storage),
    `${label}: değişen İngilizce metinler görünür; tarayıcıda saklama ipucu tarayıcı metni`, JSON.stringify(dm));
  const first = await visibleText(page);
  check('i18n', !trLetter(first), `${label}: açılışta görünen metinde Türkçe karakter yok`, (first.match(new RegExp('.{0,30}' + TR_LETTER.source + '.{0,30}')) || [''])[0]);
  // PDF yükle + dışa aktar
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
    `${label}: yüklenen PDF bilgisi, dizilim özeti (tekil/çoğul), yaprak başlığı İngilizce`, JSON.stringify(height));
  if (tam) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-transfer')]);
    await page.waitForFunction(() => /ready/.test(document.getElementById('notice').textContent), null, { timeout: 30000 });
    const b = await page.textContent('#notice');
    check('i18n', download.suggestedFilename() === 'test-37-imposed.pdf' && b === 'test-37-imposed.pdf ready (24 sides).',
      `${label}: dışa aktarılan dosya adı -imposed, bildirim İngilizce`, download.suggestedFilename() + ' | ' + b);
    await page.selectOption('#output-mode', 'pair');
    await page.check('#back-reversed');
    const iki = [];
    page.on('download', (d) => iki.push(d.suggestedFilename()));
    await page.click('#export-transfer');
    await page.waitForFunction(() => /and/.test(document.getElementById('notice').textContent), null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    check('i18n', JSON.stringify(iki.sort()) === '["test-37-backs-reversed.pdf","test-37-fronts.pdf"]', `${label}: iki PDF: -fronts / -backs-reversed`, JSON.stringify(iki));
    await page.selectOption('#output-mode', 'single');
    // kusurlu girdi bildirimi İngilizce: EPUB değil
    await page.setInputFiles('#pdf-file', { name: 'bozuk.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('bu bir zip değil') });
    await page.waitForFunction(() => /couldn't be opened/.test(document.getElementById('notice').textContent), null, { timeout: 30000 }).catch(() => {});
    const bz = await page.textContent('#notice');
    check('i18n', bz === "The file couldn't be opened: This file couldn't be read: it isn't a valid EPUB (ZIP) or it is damaged.", `${label}: bozuk EPUB hatası İngilizce`, bz);
    // Hesapla: ondalık nokta, İngilizce satırlar
    await page.click('#tab-button-calculator');
    const h = await page.evaluate(() => ({ line: Array.from(document.querySelectorAll('#h-result th')).map((e) => e.textContent).slice(0, 4), spine: document.querySelector('[data-result="spineThickness"]').textContent }));
    check('i18n', JSON.stringify(h.line) === '["Total pages (blanks included)","Leaves","Signatures","Spine thickness S"]' && h.spine === '10.4 mm',
      `${label}: Hesapla satırları İngilizce`, JSON.stringify(h));
    await page.fill('#h-paperThickness', '0.123');
    const decimal = await page.textContent('[data-result="spineThickness"]');
    check('i18n', decimal === '12.8 mm', `${label}: Hesapla ondalık ayracı nokta (en-US)`, decimal);
    await page.fill('#h-paperThickness', '0.1');
    await decimalFlow(page, label, 'en');
  }
  // Süreç: yeni proje İngilizce adımlarla; eski Türkçe kayıt İngilizce görünür, kullanıcı adımı aynen
  await page.click('#tab-button-projects');
  await page.fill('#yk-name', 'Notebook');
  await page.click('#yk-create');
  await page.waitForFunction(() => document.querySelectorAll('#steps .step').length === 14);
  const fresh = await page.evaluate(() => ({ first: document.querySelector('#steps .step-name').textContent, summary: document.getElementById('book-progress').textContent,
    data: JSON.parse(localStorage.getItem('mucellit.projects')).projects.slice(-1)[0].steps[6] }));
  check('i18n', fresh.first === '1. Prep / PDF' && /^Sewn signatures \+ hardcover \(case binding\) · 0 \/ 14 steps done · created \d{4}-\d\d-\d\d$/.test(fresh.summary) && fresh.data.template === 'sewing' && fresh.data.name === 'Sewing',
    `${label}: yeni projede adımlar İngilizce, kayıtta şablon anahtarı`, JSON.stringify(fresh));
  const old = readFileSync(join(OLD_RECORD, 'local-storage-v1.json'), 'utf8');
  await page.evaluate((e) => { localStorage.removeItem('mucellit.projects'); localStorage.removeItem('mucellit.selectedProject'); localStorage.setItem('kitapCilt.v1', e); localStorage.setItem('kitapCilt.seciliKitap', 'k-mzeski-1'); }, old);
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]');
  await page.click('#tab-button-projects');
  await page.waitForSelector('#steps .step');
  const e = await page.evaluate(() => ({ names: Array.from(document.querySelectorAll('#steps .step-name')).map((x) => x.textContent),
    settings: (document.querySelector('#book-detail p.small') || {}).textContent, ls: localStorage.getItem('mucellit.projects'), legacy: localStorage.getItem('kitapCilt.v1') + '|' + localStorage.getItem('kitapCilt.seciliKitap') }));
  check('i18n', e.names.length === 15 && e.names[0] === '1. Prep / PDF' && e.names[6] === '7. Sewing' && e.names[14] === '15. Ayraç takma' &&
    /^Saved imposition settings: sewn signatures, paper 297×210 mm, book 148×210 mm, 4 sheets per signature$/.test(e.settings) && e.legacy === 'null|null' && JSON.parse(e.ls).version === 2 && JSON.parse(e.ls).projects[0].steps.length === 15 && JSON.parse(e.ls).projects[0].name === JSON.parse(old).kitaplar[0].ad,
    `${label}: eski Türkçe kayıt açıldı: şablon adımları İngilizce, kullanıcı adımı aynen, kayıt değişmedi`, JSON.stringify({ names: [e.names[0], e.names[6], e.names[14]], settings: e.settings }));
  const sm = await visibleText(page, ['Çiğdemköy (deneme)', 'Ayraç takma', 'kuşe kağıt', '80 g/m² kitap kağıdı']);
  check('i18n', !trLetter(sm), `${label}: Süreç görünümünde (kullanıcı metinleri dışında) Türkçe karakter yok`, (sm.match(new RegExp('.{0,30}' + TR_LETTER.source + '.{0,30}')) || [''])[0]);
  await noMissingKey(page, label);
  // elle dil seçimi: açık belge yok → onaysız; Türkçeye geçer ve kalıcı; sistem diline dönünce İngilizce
  const confirmCount = iz.confirms.length;
  await Promise.all([page.waitForEvent('load'), page.selectOption('#i18n-select', 'tr')]);
  await page.waitForSelector('html[data-ready="yes"]');
  await page.click('#tab-button-projects');
  const tr = await page.evaluate(() => ({ lang: document.documentElement.lang, tab: document.getElementById('tab-button-impose').textContent, choice: localStorage.getItem('mucellit.language'),
    value: document.getElementById('i18n-select').value, step: (document.querySelector('#steps .step-name') || {}).textContent }));
  check('i18n', tr.lang === 'tr' && tr.tab === 'Düzenle' && tr.choice === 'tr' && tr.value === 'tr' && tr.step === '1. Hazırlık / PDF' && iz.confirms.length === confirmCount,
    `${label}: elle Türkçe seçimi (belge yokken onaysız) sayfayı yeniden yükler, kalıcı, adımlar Türkçe`, JSON.stringify(tr));
  const ipTr = await page.evaluate(() => document.getElementById('i18n-select').getAttribute('title'));
  check('print', ipTr === 'Dil', `${label}: Türkçeye geçince dil seçici ipucu "Dil"`, String(ipTr));
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]');
  check('i18n', await page.evaluate(() => document.documentElement.lang) === 'tr', `${label}: elle seçim yeniden açılışta duruyor (en-US tarayıcıda Türkçe)`);
  // açık belge varken dil değişimi onay ister; vazgeçilince değişmez
  await page.click('#tab-button-impose');
  await page.setInputFiles('#pdf-file', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#small-thumbs .card').length === 37);
  iz.confirmRed = true;
  await page.selectOption('#i18n-select', 'system');
  await page.waitForTimeout(500);
  iz.confirmRed = false;
  const red = await page.evaluate(() => ({ lang: document.documentElement.lang, choice: localStorage.getItem('mucellit.language'), value: document.getElementById('i18n-select').value, card: document.querySelectorAll('#small-thumbs .card').length }));
  check('i18n', iz.confirms.length === confirmCount + 1 && /Dil değişince pencere yeniden yüklenir/.test(iz.confirms[iz.confirms.length - 1]) && red.lang === 'tr' && red.choice === 'tr' && red.value === 'tr' && red.card === 37,
    `${label}: belge açıkken dil değişimi onay ister (Türkçe metin); Vazgeç → dil, seçim ve belge değişmez`, JSON.stringify({ red, confirmation: iz.confirms.slice(-1) }));
  await Promise.all([page.waitForEvent('load'), page.selectOption('#i18n-select', 'system')]);
  await page.waitForSelector('html[data-ready="yes"]');
  const restored = await page.evaluate(() => ({ lang: document.documentElement.lang, choice: localStorage.getItem('mucellit.language'), value: document.getElementById('i18n-select').value }));
  check('i18n', restored.lang === 'en' && restored.choice === null && restored.value === 'system', `${label}: "Sistem dili" seçimi elle seçimi siler, en-US'te İngilizceye döner (onay kabul)`, JSON.stringify(restored));
  const ipEn = await page.evaluate(() => document.getElementById('i18n-select').getAttribute('title'));
  check('print', ipEn === 'Language', `${label}: İngilizceye dönünce dil seçici ipucu "Language"`, String(ipEn));
  await printingHidden(page, label);
  await noMissingKey(page, label);
}

/** Tauri benzetimi: açılışta dil_oku + dil_ayarla; menüden dil:en; WebKit verisi silinince seçim Rust yedeğinden döner. */
async function m6TauriI18n(page, address, label) {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.removeItem('fakeI18nChoice'); sessionStorage.removeItem('fakeI18nCode'); window.__fake.call = []; });
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const a = await page.evaluate(() => ({ call: window.__fake.call.filter((c) => /_language$/.test(c.command)).map((c) => c.command), settings: window.__fake.i18nSettings, lang: document.documentElement.lang,
    button: document.getElementById('export-transfer').textContent }));
  check('i18n', JSON.stringify(a.call) === '["read_language","set_language"]' && JSON.stringify(a.settings.slice(-1)) === '[["tr","system"]]' && a.lang === 'tr' && a.button === "Dizilmiş PDF'i kaydet…",
    `${label}: açılışta read_language, after set_language {tr, system} (menü JS ile aynı inLang); Save düğmesi Türkçe`, JSON.stringify(a));
  // Görünüm > Dil > English (belge açık değil: onaysız) → Rust'a {en, en}, sayfa yeniden yüklenir, İngilizce
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => window.__fake.listener.menu({ payload: 'i18n:en' }))]);
  await page.waitForSelector('html[data-ready="yes"]');
  const b = await page.evaluate(() => ({ lang: document.documentElement.lang, button: document.getElementById('export-transfer').textContent, ls: localStorage.getItem('mucellit.language'), settings: window.__fake.i18nSettings,
    tab: document.getElementById('tab-button-projects').textContent }));
  check('i18n', b.lang === 'en' && b.button === 'Save imposed PDF…' && b.ls === 'en' && b.tab === 'Projects' && JSON.stringify(b.settings.slice(-1)) === '[["en","en"]]',
    `${label}: menü i18n:en → set_language {en, en}, again yüklenir, arayüz ve Save düğmesi İngilizce`, JSON.stringify(b));
  // WebKit verisi silindi (localStorage boş) ama Rust'ta yedek var → seçim geri gelir
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]');
  const c = await page.evaluate(() => ({ lang: document.documentElement.lang, ls: localStorage.getItem('mucellit.language'), tab: document.getElementById('tab-button-calculator').textContent, source: document.getElementById('source-info').textContent }));
  check('i18n', c.lang === 'en' && c.ls === 'en' && c.tab === 'Calculator' && c.source === 'No PDF loaded yet.',
    `${label}: localStorage silinince elle seçim Rust yedeğinden (read_language) geri gelir; tr-TR sistemde İngilizce`, JSON.stringify(c));
  // kusurlu menü kimliği yok sayılır
  await page.evaluate(() => { window.__fake.listener.menu({ payload: 'i18n:xx' }); window.__fake.listener.menu({ payload: 'i18n:' }); });
  await page.waitForTimeout(300);
  check('i18n', await page.evaluate(() => document.documentElement.lang + '|' + localStorage.getItem('mucellit.language')) === 'en|en', `${label}: kusurlu dil menü kimliği (dil:xx, dil:) yok sayılır`);
  await noMissingKey(page, label);
  // "Sistem dili" menüdeki gibi Rust'tan (NSLocale + Apple kuralı); tarayıcı tr-TR iken Rust en derse arayüz en
  await page.evaluate(() => { localStorage.clear(); sessionStorage.removeItem('fakeI18nChoice'); sessionStorage.removeItem('fakeI18nCode'); sessionStorage.setItem('fakeSystem', 'en'); window.__fake.i18nSettings = []; });
  await page.reload();
  await page.waitForSelector('html[data-ready="yes"]');
  const r = await page.evaluate(() => ({ lang: document.documentElement.lang, options: Array.from(document.getElementById('i18n-select').options).map((o) => o.value + '=' + o.textContent),
    value: document.getElementById('i18n-select').value, settings: window.__fake.i18nSettings, tab: document.getElementById('tab-button-impose').textContent, hint: document.getElementById('storage-hint').textContent }));
  check('i18n', r.lang === 'en' && r.options[0] === 'system=System language (English)' && r.value === 'system' && r.tab === 'Imposition' && JSON.stringify(r.settings.slice(-1)) === '[["en","system"]]',
    `${label}: sistem dili Rust'tan (read_language.system en, tarayıcı tr-TR): arayüz ve "System language (English)" seçeneği menüyle aynı kaynaktan`, JSON.stringify(r));
  check('i18n', /this Mac/.test(r.hint) && !/browser/i.test(r.hint), `${label}: Mac uygulamasında saklama ipucu Mac metniyle (tarayıcı demez)`, r.hint);
  const first = await page.evaluate(() => window.__fake.firstSquare);
  check('print', first && first.lang === 'en' && first.tab === 'Imposition',
    `${label}: ilk kare (read_language dönmeden) Rust'ın sistem dilinde (ön betik __MC_LANG__; tarayıcı tr-TR, Rust en): navigator.languages → Rust geçişi yok`, JSON.stringify(first));
  await page.evaluate(() => { sessionStorage.removeItem('fakeSystem'); localStorage.clear(); sessionStorage.removeItem('fakeI18nCode'); });
}

/**
 * Mac uygulamasında yazdırma (sahte __TAURI__): düğmeler yalnız platform.yazdir varken; baskı öncesi not (çift yüz =
 * araçtaki seçim, %100); tek PDF gönderildi / vazgeçildi / Rust hatası; iki PDF önler → "desteyi çevir" onayı → arkalar
 * ve yarıda kalma; çıktı hazırlanırken/pencere açıkken ⌘P ve ⌘S yok sayılır; menü ⌘P; Önizleme'de Aç ve açılamazsa
 * seçenek E (Kaydet + not). Tarayıcı indirmesi hiç başlamaz.
 */
async function m3Printing(page, address, label) {
  let download = 0;
  page.on('download', () => { download += 1; });
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  await page.click('#tab-button-impose');
  const clearNotice = () => page.evaluate(() => { const b = document.getElementById('notice'); b.textContent = ''; b.className = ''; window.__fake.call.length = 0; window.__fake.questions = []; });
  const state = () => page.evaluate(() => ({ notice: document.getElementById('notice').textContent, error: document.getElementById('notice').classList.contains('error'),
    print: window.__fake.call.filter((c) => c.command === 'print').map((c) => ({ name: c.name, size: c.size, notAn: c.notAn })),
    preview: window.__fake.call.filter((c) => c.command === 'open_in_preview').map((c) => c.name), save: window.__fake.call.filter((c) => c.command === 'save_file').map((c) => c.name),
    questions: window.__fake.questions || [] }));
  const finished = (re) => page.waitForFunction((k) => new RegExp(k).test(document.getElementById('notice').textContent), re.source, { timeout: 30000 }).catch(() => {});
  const g = await page.evaluate(() => ({ field: document.getElementById('print-field').hidden, button: document.getElementById('print').disabled, preview: document.getElementById('inPreview-open').hidden,
    note: document.getElementById('print-note').hidden ? null : document.getElementById('print-note').textContent, duplex: document.getElementById('duplex').selectedOptions[0].textContent,
    text: [document.getElementById('print').textContent, document.getElementById('inPreview-open').textContent],
    visible: [!!document.getElementById('print').offsetParent, !!document.getElementById('inPreview-open').offsetParent, !!document.getElementById('print-note').offsetParent] }));
  check('print', g.field === false && JSON.stringify(g.visible) === '[true,true,true]' && g.button === true && g.preview === false && JSON.stringify(g.text) === '["Yazdır…","Önizleme\'de Aç"]' &&
    // seçenek baskı penceresinin adıyla ("Açık (Kısa Kenar)" / Düzen: "Kısa Kenardan Ciltli"), araçtaki ad ayrıca
    g.note === `Baskı penceresinde: Çift Taraflı → “Açık (Kısa Kenar)” seçin (buradaki “${g.duplex}” ile aynı; Düzen bölümünde: Çift Taraflı → “Kısa Kenardan Ciltli”), ölçeği %100 bırakın, “Kâğıt boyutuna sığdır”ı seçmeyin.`,
    `${label}: Yazdır… ve Önizleme'de Aç görünür (PDF yokken kapalı); baskı notu araçtaki çift yüz seçimini söyler`, JSON.stringify(g));
  await clearNotice();
  await page.evaluate(() => window.Mucellit.platform.onMenu('file-print'));
  const none = await state();
  check('print', none.notice === 'Önce bir PDF açın, sonra yazdırın.' && none.error && none.print.length === 0, `${label}: PDF yokken ⌘P → "Önce bir PDF açın" (baskı penceresi yok)`, JSON.stringify(none));
  const pdf = await makeTestPdf(page);
  await page.setInputFiles('#pdf-file', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => !document.getElementById('print').disabled, null, { timeout: 30000 });
  await page.selectOption('#binding-type', 'sewn');
  await page.selectOption('#output-mode', 'single');
  // tek PDF: yazdırıldı
  await clearNotice();
  await page.click('#print');
  await finished(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı/);
  const single = await state();
  check('print', single.notice === 'Yazıcıya gönderildi: test-37-dizilmis.pdf.' && !single.error && single.print.length === 1 && single.print[0].name === 'test-37-dizilmis.pdf' && single.print[0].size > 1000 &&
    /^Baskı penceresinde: Çift Taraflı → “Açık.*%100.*sığdır/.test(single.print[0].notAn) && single.questions.length === 0,
    `${label}: tek PDF → yazdir (ham bayt, ad), baskı penceresinden önce not gösterildi, "Yazıcıya gönderildi"`, JSON.stringify(single));
  // tek PDF: vazgeçildi
  await clearNotice();
  await page.evaluate(() => { window.__fake.printOrder = [false]; });
  await page.click('#print');
  await finished(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı/);
  const vaz = await state();
  check('print', vaz.notice === 'Yazdırılmadı (baskı penceresinden vazgeçildi).' && vaz.error && vaz.print.length === 1, `${label}: baskı penceresinde Vazgeç → "Yazdırılmadı" (hata), uygulama sürer`, JSON.stringify(vaz));
  // Rust hatası (Apple dışı platform metni)
  await clearNotice();
  await page.evaluate(() => { window.__fake.printOrder = ['bu platformda yazdırma henüz yok']; });
  await page.click('#print');
  await finished(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı/);
  const rh = await state();
  check('print', rh.notice === 'test-37-dizilmis.pdf yazdırılamadı: bu platformda yazdırma henüz yok' && rh.error, `${label}: Rust hatası (Apple dışı: "bu platformda yazdırma henüz yok") bildirilir`, rh.notice);
  // iki PDF: önler → çevir onayı → arkalar
  await page.selectOption('#output-mode', 'pair');
  await page.waitForFunction(() => !document.getElementById('print').disabled);
  const notIki = await page.textContent('#print-note');
  await clearNotice();
  await page.evaluate(() => { window.__fake.printOrder = [true, true]; window.__fake.askOrder = [true]; });
  await page.click('#print');
  await finished(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı|Yalnız önler/);
  const iki = await state();
  check('print', iki.notice === 'Yazıcıya gönderildi: test-37-onler.pdf ve test-37-arkalar.pdf.' && JSON.stringify(iki.print.map((y) => y.name)) === '["test-37-onler.pdf","test-37-arkalar.pdf"]' &&
    iki.questions.length === 1 && /^Önler \(test-37-onler\.pdf\) yazıcıya gönderildi\. .*desteyi .*çevirip .*geri koyun/.test(iki.questions[0]) && /Çift Taraflı → “Kapalı”/.test(notIki),
    `${label}: iki PDF → önler, "desteyi çevirip geri koyun" onayı, arkalar; not "Çift Taraflı → Kapalı"`, JSON.stringify({ ...iki, notIki }));
  // iki PDF: çevir onayında Vazgeç → yarıda (yalnız önler)
  await clearNotice();
  await page.evaluate(() => { window.__fake.printOrder = [true]; window.__fake.askOrder = [false]; });
  await page.click('#print');
  await finished(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı|Yalnız önler/);
  const half = await state();
  check('print', half.notice === 'Yalnız önler yazıcıya gönderildi (test-37-onler.pdf); arkalar (test-37-arkalar.pdf) basılmadı (vazgeçildi).' && half.error && half.print.length === 1,
    `${label}: iki PDF, çevir onayında Vazgeç → yarıda kalma doğru bildirildi (yalnız önler)`, JSON.stringify(half));
  // iki PDF: arkaların baskı penceresinde Vazgeç
  await clearNotice();
  await page.evaluate(() => { window.__fake.printOrder = [true, false]; window.__fake.askOrder = [true]; });
  await page.click('#print');
  await finished(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı|Yalnız önler/);
  const yar2 = await state();
  check('print', /^Yalnız önler yazıcıya gönderildi/.test(yar2.notice) && yar2.error && yar2.print.length === 2, `${label}: iki PDF, arkalarda Vazgeç → yarıda`, JSON.stringify(yar2));
  // meşgulken ⌘P / ⌘S yok sayılır; sonra düğmeler serbest
  await page.selectOption('#output-mode', 'single');
  await page.waitForFunction(() => !document.getElementById('print').disabled);
  await clearNotice();
  await page.evaluate(() => { const s = window.__fake; s.printGate = new Promise((r) => { s.openGate = r; }); });
  await page.click('#print');
  await page.waitForFunction(() => window.__fake.call.some((c) => c.command === 'print'), null, { timeout: 30000 });
  const busy = await page.evaluate(() => { const P = window.Mucellit.platform; P.onMenu('file-print'); P.onMenu('file-save'); P.onMenu('file-preview');
    return { write: document.getElementById('print').getAttribute('aria-busy'), creep: document.getElementById('export-transfer').getAttribute('aria-busy'), closed: document.getElementById('export-transfer').disabled }; });
  await page.evaluate(() => { const s = window.__fake; s.printGate = null; s.openGate(); });
  await finished(/Yazıcıya gönderildi/);
  const after = await state();
  const free = await page.evaluate(() => ['print', 'export-transfer', 'inPreview-open'].map((id) => [document.getElementById(id).disabled, document.getElementById(id).getAttribute('aria-busy')]));
  check('print', busy.write === 'true' && busy.creep === 'true' && busy.closed && after.print.length === 1 && after.save.length === 0 && after.preview.length === 0 &&
    JSON.stringify(free) === '[[false,null],[false,null],[false,null]]',
    `${label}: baskı penceresi açıkken ⌘P/⌘S/⌥⌘P yok sayıldı (tek pencere); bitince düğmeler serbest`, JSON.stringify({ busy, after, free }));
  // baskı penceresi açıkken ayar değişirse (önizleme yeniden çizilir) çıktı düğmeleri açılmaz,
  // aria-busy kalkmaz; ikinci çıktı işi (Kaydet tıklaması) başlamaz.
  await clearNotice();
  await page.evaluate(() => { const s = window.__fake; s.printGate = new Promise((r) => { s.openGate = r; });
    const C = window.Mucellit.output, u = C.build; window.__countMake = 0; C.build = function () { window.__countMake += 1; return u.apply(this, arguments); }; });
  await page.click('#print');
  await page.waitForFunction(() => window.__fake.call.some((c) => c.command === 'print'), null, { timeout: 30000 });
  await page.click('#cropMarks'); // kesim işareti aç/kapa: yerleşim sığmaya devam eder (D.engel false), önizleme yeniden çizilir
  await page.waitForTimeout(400); // önizleme yeniden çizimi (requestAnimationFrame + pdf.js)
  const configured = await page.evaluate(() => ['print', 'export-transfer', 'inPreview-open'].map((id) => [document.getElementById(id).disabled, document.getElementById(id).getAttribute('aria-busy')]));
  await page.evaluate(() => { document.getElementById('export-transfer').click(); document.getElementById('inPreview-open').click(); });
  await page.waitForTimeout(800); // ikinci iş başladıysa uret çağrılır, Kaydet/Önizleme komutu gider
  await page.evaluate(() => { const s = window.__fake; s.printGate = null; s.openGate(); });
  await finished(/Yazıcıya gönderildi/);
  await page.waitForTimeout(300);
  const settingsAfter = { ...(await state()), build: await page.evaluate(() => window.__countMake) };
  const settingsFree = await page.evaluate(() => ['print', 'export-transfer', 'inPreview-open'].map((id) => [document.getElementById(id).disabled, document.getElementById(id).getAttribute('aria-busy')]));
  await page.click('#cropMarks');
  await page.waitForFunction(() => !document.getElementById('export-transfer').disabled, null, { timeout: 30000 }).catch(() => {});
  check('print', JSON.stringify(configured) === '[[true,"true"],[true,"true"],[true,"true"]]' && settingsAfter.print.length === 1 && settingsAfter.save.length === 0 &&
    settingsAfter.preview.length === 0 && settingsAfter.build === 1 &&
    JSON.stringify(settingsFree) === '[[false,null],[false,null],[false,null]]',
    `${label}: baskı penceresi açıkken ayar değişince çıktı düğmeleri kapalı + aria-busy kalır; Kaydet ikinci iş başlatmaz`, JSON.stringify({ configured, settingsFree, settingsAfter }));
  // menü ⌘P (olay yolu)
  await clearNotice();
  await page.evaluate(() => window.__fake.listener.menu({ payload: 'file-print' }));
  await finished(/Yazıcıya gönderildi/);
  const menu = await state();
  check('print', menu.print.length === 1 && menu.notice === 'Yazıcıya gönderildi: test-37-dizilmis.pdf.', `${label}: Dosya > Yazdır… (⌘P menü olayı) baskı penceresini açar`, JSON.stringify(menu));
  // Önizleme'de Aç: açıldı
  await clearNotice();
  await page.click('#inPreview-open');
  await finished(/Önizleme/);
  const on = await state();
  check('print', on.notice === "Önizleme'de açıldı: test-37-dizilmis.pdf. Önizleme'den “Gerçek Boyut” (%100) ile basın." && JSON.stringify(on.preview) === '["test-37-dizilmis.pdf"]',
    `${label}: Önizleme'de Aç → open_in_preview, "Gerçek Boyut" notu`, JSON.stringify(on));
  // açılamadı (sandbox) → seçenek E: onay → Kaydet → kaydedildi + not
  await clearNotice();
  await page.evaluate(() => { const s = window.__fake; s.previewOrder = ['The application “Preview” does not have permission to open “test-37-dizilmis.pdf.”']; s.askOrder = [true]; s.saveResponse = '/Users/deneme/Belgeler/test-37-dizilmis.pdf'; });
  await page.click('#inPreview-open');
  await finished(/Kaydedildi|açamadı|kaydedilmedi/);
  const e = await state();
  await page.evaluate(() => { window.__fake.saveResponse = null; });
  check('print', /^Kaydedildi: \/Users\/deneme\/Belgeler\/test-37-dizilmis\.pdf \(24 yüz\)\. Önizleme'de açıp “Gerçek Boyut” \(%100\) ile basın\.$/.test(e.notice) &&
    e.questions.length === 1 && /^Önizleme PDF'i açamadı \(The application/.test(e.questions[0]) && JSON.stringify(e.save) === '["test-37-dizilmis.pdf"]',
    `${label}: Önizleme açamadı → anlaşılır soru → Kaydet (seçenek E) + "Önizleme'de basın" notu`, JSON.stringify(e));
  // açılamadı → Vazgeç
  await clearNotice();
  await page.evaluate(() => { const s = window.__fake; s.previewOrder = ['izin yok']; s.askOrder = [false]; });
  await page.click('#inPreview-open');
  await finished(/açamadı|Kaydedildi/);
  const ev = await state();
  check('print', ev.notice === "Önizleme PDF'i açamadı: izin yok" && ev.error && ev.save.length === 0, `${label}: Önizleme açamadı + Vazgeç → hata bildirimi, Kaydet yok`, JSON.stringify(ev));
  check('print', download === 0, `${label}: yazdırma/Önizleme akışlarında tarayıcı indirmesi yok`, `${download} download`);
}

/** tarayıcıda (platform.yazdir yok) yazdırma düğmeleri ve not gizli. */
async function printingHidden(page, label) {
  await page.click('#tab-button-impose'); // görünürlük Düzenle sekmesi açıkken ölçülür
  const g = await page.evaluate(() => ({ print: window.Mucellit.platform.print, field: document.getElementById('print-field').hidden, note: document.getElementById('print-note').hidden,
    visible: !!document.getElementById('print').offsetParent }));
  check('print', g.print === null && g.field && g.note && !g.visible, `${label}: tarayıcıda Yazdır / Önizleme düğmeleri ve baskı notu gizli`, JSON.stringify(g));
}

/**
 * Tauri benzetiminde i18n.js hata atarsa (yüklenemezse) platform-tauri.js fazladan
 * konsol hatası üretmez: konsoldaki tek hata benzetimin kendisi (KC-BENZETIM); arayüz statik İngilizce, başlatma hatası
 * İngilizce bildirilir. Benzetim hataları kontrolden sonra düşülür (koşu sonu "konsol hatası yok" denetimi için).
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
    `${label}: i18n.js yokken platform-tauri.js fazladan konsol hatası üretmez (yalnız benzetim hatası); arayüz statik İngilizce, Mac saklama ipucu İngilizce, başlatma hatası bildirildi`,
    JSON.stringify({ ...b, console: fresh.map((h) => h.slice(0, 140)) }));
  iz.errors.splice(once); // benzetim (ve varsa kaldı sayılan) hataları koşu sonu denetiminden düşülür; kontrol yukarıda
  await page.unroute('**/js/i18n.js');
}

/**
 * Başlangıç hatası benzetimi. (a) platform.hazir reddedilir, (b) i18n.js hata atar,
 * (c) tr sözlüğü bozuk. Üçünde de etiketler boş değil: (a) seçili dilde (tr-TR → Türkçe), (b) statik İngilizce
 * (index.html), (c) İngilizce ve uygulama çalışır. Benzetim hataları (KC-BENZETIM) konsol denetiminden düşülür.
 */
async function m6StartupError(page, address, iz, label) {
  const I18n = require('../js/i18n.js');
  const dictionary = (code) => I18n.extractJson(readFileSync(join(APP, 'i18n', code + '.js'), 'utf8'));
  const EN = dictionary('en'), TR = dictionary('tr');
  const labels = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-i18n]')).map((e) => [e.getAttribute('data-i18n'), e.textContent]));
  const different = (l, s) => l.filter(([a, m]) => !m || m !== s[a]);
  const platformJs = readFileSync(join(APP, 'js', 'platform.js'), 'utf8');
  if (!platformJs.includes('ready: Promise.resolve(),')) throw new Error('platform.js benzetim noktası bulunamadı');
  const fallSimulation = () => { const once = iz.errors.length; iz.errors = iz.errors.filter((h) => !/MC-SIMULATION/.test(h)); return once - iz.errors.length; };
  // (a)
  await page.route('**/js/platform.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: platformJs.replace('ready: Promise.resolve(),', "ready: Promise.reject(new Error('MC-SIMULATION ready')),") }));
  await page.goto(address);
  await page.waitForFunction(() => /MC-SIMULATION ready/.test(document.getElementById('notice').textContent), null, { timeout: 20000 });
  const a = await page.evaluate(() => ({ lang: document.documentElement.lang, ready: document.documentElement.getAttribute('data-ready'), notice: document.getElementById('notice').textContent,
    options: document.getElementById('i18n-select').options.length }));
  const la = await labels();
  check('i18n', la.length >= 100 && different(la, TR).length === 0 && a.lang === 'tr' && a.ready === null && /^Uygulama başlatılamadı: MC-SIMULATION ready$/.test(a.notice) && a.options === 3,
    `${label}: (a) platform.ready reddedildi: ${la.length} etiket boş değil ve Türkçe (tr-TR), dil seçici dolu, başlatma hatası bildirildi`, JSON.stringify({ ...a, difference: different(la, TR).slice(0, 3) }));
  await page.unroute('**/js/platform.js');
  fallSimulation(); // (a): benzetimde hazir oluşturulurken reddedildiği için tarayıcı "işlenmemiş red" de yazabilir
  // (b)
  await page.route('**/js/i18n.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: 'throw new Error("MC-SIMULATION i18n.js");' }));
  await page.goto(address);
  await page.waitForFunction(() => /start/.test(document.getElementById('notice').textContent), null, { timeout: 20000 }).catch(() => {});
  const lb = await labels();
  const b = await page.evaluate(() => ({ lang: document.documentElement.lang, notice: document.getElementById('notice').textContent, aria: document.getElementById('i18n-select').getAttribute('aria-label') }));
  const bError = iz.errors.slice();
  const bFallen = fallSimulation();
  check('i18n', lb.length >= 100 && different(lb, EN).length === 0 && b.lang === 'en' && b.aria === 'Language' && /^The app couldn't start: /.test(b.notice) && bFallen >= 1,
    `${label}: (b) i18n.js hata attı: ${lb.length} etiket statik İngilizce (index.html), başlatma hatası İngilizce bildirildi`, JSON.stringify({ ...b, difference: different(lb, EN).slice(0, 3), console: bError.slice(0, 3).map((h) => h.slice(0, 120)) }));
  // (b)'de başka hata (benzetimin dolaylı sonucu) varsa ayrıca görünür kalsın diye listelenir ve düşülür
  const indirect = iz.errors.length;
  iz.errors = [];
  check('i18n', indirect <= 3, `${label}: (b) i18n.js yokken benzetim dışı konsol hatası en çok birkaç dolaylı hata (${indirect})`, JSON.stringify(bError.map((h) => h.slice(0, 120))));
  await page.unroute('**/js/i18n.js');
  // (c)
  await page.route('**/i18n/tr.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: 'self.MucellitDictionaries = (self.MucellitDictionaries || []).concat([{ "_name": "MC-SIMULATION corrupt" }]);' }));
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const lc = await labels();
  const c = await page.evaluate(() => ({ lang: document.documentElement.lang, code: window.Mucellit.i18n.code(), languages: window.Mucellit.i18n.languages() }));
  check('i18n', lc.length >= 100 && different(lc, EN).length === 0 && c.lang === 'en' && c.code === 'en' && JSON.stringify(c.languages) === '["en"]',
    `${label}: (c) tr sözlüğü bozuk: i18n.js çalışır, tr-TR kullanıcısı İngilizce görür, uygulama başlar`, JSON.stringify({ ...c, difference: different(lc, EN).slice(0, 3) }));
  await page.unroute('**/i18n/tr.js');
  // benzetimden sonra olağan açılış
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  const ld = await labels();
  check('i18n', different(ld, TR).length === 0, `${label}: benzetim kalkınca olağan Türkçe açılış`, JSON.stringify(different(ld, TR).slice(0, 3)));
}

// ------------------------------------------------------------------
// Öğren rehberi
// ------------------------------------------------------------------
const LEARN_FOLDER = join(APP, 'js', 'learn');
const { inject: injectLearnCheck } = require('./learn-probe.cjs');
/**
 * denetim arayüzü yalnız testte. learn.js isteği yakalanır, ürün dosyası test enjeksiyonuyla sunulur
 * (app/test/learn-probe.cjs; kapanıştan önce KitapCilt.ogren.denetim eklenir). Ürün kodu diskte değişmez.
 */
async function setupLearnCheck(page) {
  const source = injectLearnCheck(readFileSync(join(LEARN_FOLDER, 'learn.js'), 'utf8'));
  await page.route('**/js/learn/learn.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: source }));
}
const LEARN_LICENSE = readFileSync(join(LEARN_FOLDER, 'LICENSE'), 'utf8').trim();
/** Rehber betiklerinin üst düzey bildirdiği adlar (global ad denetimi adayları). */
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
/** Test izleri (Playwright enjekte eder; ürün kodu değil): CSP ihlalleri ve rAF çağrı sayısı. */
const LEARN_IZ = `(() => { window.__kcCsp = []; document.addEventListener('securitypolicyviolation', (e) => window.__kcCsp.push(e.violatedDirective + ' ' + (e.blockedURI || '')));
  const r = window.requestAnimationFrame.bind(window); window.__kcRaf = 0; window.requestAnimationFrame = (f) => { window.__kcRaf++; return r(f); }; })();`;
const learnState = (page) => page.evaluate(() => { const d = window.Mucellit.learn.probe.state();
  return { a: d.a, i: d.i, n: d.n, flow: d.flow, finished: d.finished, playing: d.playing, installed: d.installed, visible: d.visible, figure: d.figure, manual: d.manual, match: d.match, input: d.input, isOpen: d.st ? d.st.open : null, done: d.done }; });
/** Sayı paneli tablosu: { anahtar: [sayılar] } (dilin ondalık/binlik ayracıyla okunur). */
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

/** Öğren koşusu (sunucu, Tauri CSP başlığı). dil: 'tr' | 'en' (tarayıcı yerel ayarı). */
async function m7LearnFlow(page, address, iz, label, i18n) {
  const D = require('../js/i18n.js');
  const PROMISE = D.extractJson(readFileSync(join(APP, 'i18n', i18n + '.js'), 'utf8'));
  await page.addInitScript({ content: LEARN_IZ });
  await setupLearnCheck(page);
  await page.goto(address);
  await page.waitForSelector('html[data-ready="yes"]', { timeout: 20000 });
  // ---- sekme açılmadan rehber kurulmaz; boşta rAF yok
  const r0 = await page.evaluate(() => window.__kcRaf);
  await page.waitForTimeout(600);
  const once = await learnState(page);
  const blank = await page.evaluate((r0) => ({ stage: document.getElementById('guide-stage').childElementCount, raf: window.__kcRaf - r0, hidden: document.getElementById('tab-learn').hidden,
    tab: document.getElementById('tab-button-learn').textContent }), r0);
  check('learn', !once.installed && !once.figure && blank.stage === 0 && blank.raf === 0 && blank.hidden && blank.tab === PROMISE['tab.learn'],
    `${label}: Öğren sekmesi açılmadan rehber kurulmaz, figür ve rAF yok; 4. sekme "${PROMISE['tab.learn']}"`, JSON.stringify({ once, blank }));
  // ---- sekme açılır; panel öntanımlıları Hesapla ile aynı (aynı sonuç nesnesi)
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
    `${label}: sekme açılınca rehber kurulur; sayı paneli öntanımlıları Hesapla ile aynı (aynı hesap sonucu nesnesi, 12 değer)`, JSON.stringify({ difference, same, field, og: og.page }));
  // ---- global ad: yalnız KitapCilt altında
  const candidate = learnCandidates();
  const base = new Set(await page.evaluate(() => { const f = document.createElement('iframe'); document.body.appendChild(f); const l = Object.getOwnPropertyNames(f.contentWindow); f.remove(); return l; }));
  const defined = [];
  for (const a of candidate) { if (base.has(a)) continue; if (await page.evaluate(`typeof ${a} !== 'undefined'`).catch(() => false)) defined.push(a); }
  // id'li öğeler tarayıcının adlı erişimiyle (window.fig === #fig) görünür: betik bildirimi değil, ayrı sayılır
  const idElement = await page.evaluate((l) => l.filter((a) => { const e = document.getElementById(a); return !!e && window[a] === e; }), defined);
  const reported = defined.filter((a) => !idElement.includes(a));
  const window = await page.evaluate(() => ({ name: ['__st', '__ln', 'CF_SPEED', 'FIG_A', 'LBL_U', 'cfMount', 'mountFigure', 'PALS'].filter((a) => a in window),
    learn: Object.keys(window.Mucellit.learn).sort(), nolabels: document.documentElement.classList.contains('nolabels'), accent: document.documentElement.style.getPropertyValue('--accent'),
    dataErrors: document.documentElement.hasAttribute('data-errors') }));
  check('learn', reported.length === 0 && window.name.length === 0 && !window.nolabels && !window.accent && !window.dataErrors && ['cf', 'probe', 'size', 'tab'].every((a) => window.learn.includes(a)),
    `${label}: global ad yalnız Mucellit altında (${candidate.length} aday bildirimden küresel ${reported.length}; id'li öğe adları ayrı: ${idElement.length}; html sınıf/değişken/data-errors kalıntısı yok)`, JSON.stringify({ reported, idElement, window }));
  // ---- lisans paneli (Mac'te kullanıcının erişebildiği MIT tam metni)
  const lis = await page.evaluate(() => { const d = document.getElementById('guide-license'), p = document.getElementById('guide-license-text');
    // görünürlük: checkVisibility (kapalı details içeriği content-visibility ile gizli; offsetHeight Chromium'da 0 değil)
    const visible = (e) => (typeof e.checkVisibility === 'function' ? e.checkVisibility() : e.offsetHeight > 0);
    const r = { var: !!d && !!p && !!d.closest('#guide-root'), summary: d ? d.querySelector('summary').textContent : '', closed: p ? !d.open && !visible(p) : null };
    if (d) d.querySelector('summary').click();
    return { ...r, isOpen: p ? d.open && visible(p) && p.offsetHeight > 0 : null, text: p ? p.textContent.trim() : '', lang: p ? p.lang : '', footnote: document.querySelector('#guide-root [data-i18n="learn.license"]').textContent }; });
  await page.evaluate(() => { const d = document.getElementById('guide-license'); if (d) d.open = false; });
  check('learn', lis.var && lis.summary === PROMISE['learn.license_text'] && lis.closed && lis.isOpen && lis.text === LEARN_LICENSE && lis.lang === 'en' && lis.footnote === PROMISE['learn.license'],
    `${label}: Öğren'de "${PROMISE['learn.license_text']}" paneli açılır, MIT tam metni js/learn/LICENSE ile birebir`, JSON.stringify({ ...lis, text: lis.text.slice(0, 40) }));
  // ---- 10 aşama, 45 adım (4×)
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
  check('learn', step === 45 && lesson.length === 10 && rest.length === 0 && lastStep.a === 9 && lastStep.i === 4 && card === PROMISE['learn.finished_title'],
    `${label}: 10 aşamanın 45 adımı oynatıldı (4×), hepsi başladı ve bitti; son kart "${PROMISE['learn.finished_title']}"`, JSON.stringify({ step, rest, last: [lastStep.a, lastStep.i], card }));
  // ---- Örnek Kitap (elle) ve elle değişikliğin Hesapla'ya geçmemesi
  const ond = i18n === 'tr' ? '0,1' : '0.1';
  const accept = await page.evaluate((ond) => window.Mucellit.learn.probe.numbers({ signatureCount: '11', sheetsPerSignature: '4', bookWidth: '148', bookHeight: '210', paperThickness: ond }), ond);
  const tbElle = tbFarki(await learnTable(page, i18n));
  const manual = await learnState(page);
  const hValue = await page.evaluate(() => document.getElementById('h-pageCount').value);
  check('learn', accept === true && tbElle.length === 0 && manual.manual && hValue === '200',
    `${label}: Örnek Kitap (11 forma × 4, 148 × 210, 0,1 mm) panelde birebir; elle değişiklik Hesapla'yı değiştirmez`, JSON.stringify({ tbElle, manual: manual.manual, hValue }));
  // ---- Hesapla değişir: rehber elle değerlerde kalır; "Hesapla'dan al" bağlar; bağlıyken Hesapla'yı izler (TB Hesapla'dan)
  await writeCalculator(page, 'h-pageCount', 300);
  await page.click('#tab-button-learn');
  const manualStays = await learnState(page);
  await page.click('#guide-use-calculator');
  const taken = await learnState(page), takeTable = await learnTable(page, i18n);
  await writeCalculator(page, 'h-pageCount', 162);
  await page.click('#tab-button-learn');
  const tracks = await learnState(page), tbCalculator = tbFarki(await learnTable(page, i18n));
  const ayni2 = await page.evaluate(() => window.Mucellit.learn.probe.state().size.calc === window.Mucellit.calculator.state().result);
  check('learn', manualStays.manual && manualStays.input.signatureCount === 11 && !taken.manual && taken.input.signatureCount === 19 && takeTable.page[0] === 304 &&
    !tracks.manual && tracks.input.signatureCount === 11 && tbCalculator.length === 0 && ayni2,
    `${label}: Hesapla değişince elle değerler kalır; "${PROMISE['learn.take_from_calculator']}" Hesapla'ya bağlar (300 sayfa → 19 forma); bağlıyken Hesapla'yı izler (162 sayfa → Örnek Kitap birebir)`,
    JSON.stringify({ manualStays: [manualStays.manual, manualStays.input.signatureCount], taken: [taken.manual, taken.input.signatureCount, takeTable.page], tracks: [tracks.manual, tracks.input.signatureCount], tbCalculator, ayni2 }));
  // ---- Hesapla'da tek yaprak: rehber formalı çizer, uyum notu görünür; Hesapla hatalıysa not, önceki sayılar kalır
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
  check('learn', match.note && match.d === false && matchTb.length === 0 && failed.note === PROMISE['learn.calculator_error'] && failed.signature === 11 && fixed.note && fixed.match,
    `${label}: Hesapla tek yaprakken rehber formalı + düz sırt çizer ve not gösterir; Hesapla hatalıyken önceki sayılar kalır, düzelince not kalkar`, JSON.stringify({ match, matchTb, failed, fixed }));
  // ---- Öğren açıkken sekme yeniden basılınca rehber söküp yeniden kurulmaz; "baştan sona" adım atlamaz
  await page.evaluate(() => window.Mucellit.learn.probe.setup(0, 0));
  await page.click('#guide-fromStart-toEnd');
  await page.waitForFunction(() => { const d = window.Mucellit.learn.probe.state(); return d.flow && d.playing && d.i >= 1; }, null, { timeout: 20000 });
  const yb0 = await page.evaluate(() => { const d = window.Mucellit.learn.probe.state(); window.__kcSt = d.st; window.__kcStage = document.getElementById('guide-stage').firstElementChild; return { a: d.a, i: d.i }; });
  await page.click('#tab-button-learn');
  const yb1 = await page.evaluate(() => { const d = window.Mucellit.learn.probe.state();
    return { sameSt: d.st === window.__kcSt, sameStage: document.getElementById('guide-stage').firstElementChild === window.__kcStage, playing: d.playing, flow: d.flow, a: d.a, i: d.i }; });
  await page.waitForFunction(([a, i]) => { const d = window.Mucellit.learn.probe.state(); return d.a !== a || d.i !== i || !d.flow; }, [yb0.a, yb0.i], { timeout: 20000 });
  const yb2 = await learnState(page);
  await page.click('#guide-fromStart-toEnd');   // durdur
  await page.waitForFunction(() => !window.Mucellit.learn.probe.state().flow, null, { timeout: 10000 });
  check('learn', yb1.sameSt && yb1.sameStage && yb1.playing && yb1.flow && yb2.flow && yb2.a === yb0.a && yb2.i === yb0.i + 1,
    `${label}: "baştan sona" sürerken Öğren sekmesi yeniden basılınca figür yeniden kurulmaz, oynayan adım sürer, sonraki adım sırayla (adım atlanmaz)`,
    JSON.stringify({ once: yb0, after: yb1, first: [yb2.a, yb2.i, yb2.flow] }));
  // ---- sekme değişince "baştan sona" durur, figür sökülür, rAF çağrısı yok; geri dönünce aynı yerden kurulur
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
    `${label}: sekme değişince "baştan sona" durur, figür sökülür, gizli sekmede rAF çağrısı 0 (1,2 sn); geri dönünce aynı aşamada kurulur`,
    JSON.stringify({ whilePlaying: [whilePlaying.flow, whilePlaying.a], immediately: [immediately.flow, immediately.figure], stage, raf: rb - ra, restored: [restored.figure, restored.a] }));
  // ---- baştan sona oynat (4×): sona kadar, sıra 1→10, son karede kapak kapalı
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
  check('learn', last && last.finished && last.a === 9 && last.i === 4 && last.isOpen === 0 && JSON.stringify(order) === '[1,2,3,4,5,6,7,8,9,10]' && button === PROMISE['learn.from_start_to_end'],
    `${label}: baştan sona oynat (4×) bitti: aşama sırası 1→10, son aşamada 4/4, kapak kapalı (${Math.round((Date.now() - t0) / 1000)} sn)`, JSON.stringify({ order, last: last && [last.finished, last.a, last.i, last.isOpen], button }));
  // ---- CSP ihlali 0 (Tauri CSP başlığı), eksik anahtar 0, uygulama bildiriminde hata yok
  const sonIz = await page.evaluate(() => ({ csp: window.__kcCsp.slice(), missing: window.Mucellit.i18n.missingKeys().filter((a) => /^(ogren|sekme)\./.test(a)), notice: document.getElementById('notice').className }));
  check('learn', sonIz.csp.length === 0 && sonIz.missing.length === 0 && !/hata/.test(sonIz.notice),
    `${label}: Öğren boyunca CSP ihlali 0 (Tauri CSP başlığı), eksik ogren.* anahtarı 0, hata bildirimi yok`, JSON.stringify(sonIz));
  // ---- dil değişimi: yeniden yüklemeden sonra Öğren sekmesi açık, rehber yeni dilde, aşama/adım korunur
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
    `${label}: dil ${i18n} → ${other}: yeniden yüklemeden sonra Öğren açık, rehber ${other} (başlık, adım, düğme), aşama 3 adım 3 korunur${other === 'en' ? ', görünen metinde Türkçe harf yok' : ''}`,
    JSON.stringify({ ym, position: [yd.a, yd.i], tr: other === 'en' ? (visible.match(new RegExp('.{0,20}' + TR_LETTER.source + '.{0,20}')) || [''])[0] : '' }));
  const afterProgress = await page.evaluate(() => document.getElementById('guide-progress-text').textContent.match(/\d+/g).join('/'));
  check('learn', onceDone.reduce((s, v) => s + v, 0) > 0 && JSON.stringify(yd.done) === JSON.stringify(onceDone) && afterProgress === onceProgress,
    `${label}: dil ${i18n} → ${other}: aşamaların ilerlemesi (tamam) ve genel ilerleme (${onceProgress}) korunur`, JSON.stringify({ onceDone, after: yd.done, onceProgress, afterProgress }));
  await noMissingKey(page, label + ' (' + other + ')');
}

/** prefers-reduced-motion: 45 adımın her biri animasyonsuz biter (≤150 ms, ≤1 çizim, adım sonu durumu, geçiş 0 sn). */
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
      if (r.ok !== true) problem.push('başlamadı'); if (r.sure > 150) problem.push(`süre ${r.sure} ms`); if (r.drawing > 1) problem.push(`${r.drawing} gap square`);
      if (r.difference.length) problem.push('son durum farklı: ' + r.difference.join(',')); if (!/^0s(, 0s)*$/.test(r.transition)) problem.push('geçiş ' + r.transition);
      if (problem.length) fail.push(`${a + 1}.${j + 1}: ${problem.join(', ')}`);
    }
    check('learn', step === 45 && fail.length === 0, `${label}: prefers-reduced-motion: 45 adımın her biri animasyonsuz biter (≤150 ms, ≤1 çizim, adım sonu durumu, geçiş 0 sn)`, JSON.stringify({ step, fail: fail.slice(0, 5) }));
  } catch (e) {
    check('learn', false, `${label}: hareketi azalt koşusu yarıda kaldı: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
  }
  check('learn', iz.errors.length === 0, `${label}: hareketi azalt koşusunda konsol hatası yok`, iz.errors.slice(0, 3).join(' | ') || '0 hata');
  await ctx.close();
}

/**
 * file:// ve Tauri benzetimi için kısa Öğren denetimi, yalnız DOM'la (ürün kodu olduğu gibi; test enjeksiyonu yok):
 * sekme (ya da menü olayı) rehberi açar, bir adım oynar; ürün kodunda denetim arayüzü yok; yeniden basınca yeniden
 * kurulmaz.
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
    `${label}: ${menu ? 'menü olayı "tab-learn" (Görünüm > Öğren ⌘4)' : 'Öğren sekmesi'} rehberi açar, ilk adım oynar`, JSON.stringify(d));
  const product = await page.evaluate(() => Object.keys(window.Mucellit.learn).sort());
  check('learn', !product.includes('probe') && product.includes('tab'),
    `${label}: ürün kodunda test arayüzü yok (Mucellit.learn.probe tanımsız; yalnız sekme/olcu/cf/…)`, JSON.stringify(product));
  await page.evaluate(() => { window.__kcStage = document.getElementById('guide-stage').firstElementChild; });
  await open();
  const y = await page.evaluate(() => ({ same: document.getElementById('guide-stage').firstElementChild === window.__kcStage, finished: document.querySelectorAll('#guide-steps li.finished').length,
    current: Array.from(document.querySelectorAll('#guide-steps li')).findIndex((l) => l.classList.contains('current')) }));
  check('learn', y.same && y.finished === 1 && y.current === 1,
    `${label}: Öğren açıkken ${menu ? 'menü olayı (⌘4)' : 'tab'} yeniden gelince rehber yeniden kurulmaz (aynı figür, aynı adım)`, JSON.stringify(y));
  if (menu) {
    await page.evaluate(() => window.__fake.listener.menu({ payload: 'tab-calculator' }));
    const g = await page.evaluate(() => ({ stage: document.getElementById('guide-stage').childElementCount, calculator: !document.getElementById('tab-calculator').hidden }));
    check('learn', g.stage === 0 && g.calculator, `${label}: menüden başka sekmeye (⌘3) geçince rehber figürü sökülür`, JSON.stringify(g));
  }
}

async function main() {
  const pw = await loadPlaywright();
  const engine = pw[ENGINE];
  if (!engine || typeof engine.launch !== 'function') { console.error(`Bilinmeyen motor: ${ENGINE} (chromium | webkit)`); process.exit(2); }
  console.log(`Motor: ${ENGINE}`);
  const server = await startServer();
  const port = server.address().port;
  const localRoot = formatUrl({ protocol: 'http:', slashes: true, hostname: '127.0.0.1', port, pathname: '/' });
  const browser = await engine.launch();
  let code = 0;
  async function run(label, criterionFlow, address, localPrefix, body, local = 'tr-TR') {
    // tarayıcı dili = sistem dili (navigator.languages); mevcut koşular Türkçe arayüzle
    const ctx = await browser.newContext({ acceptDownloads: true, locale: local });
    const p = await ctx.newPage();
    p.setDefaultTimeout(60000);
    const iz = watch(p, label);
    try {
      await body(p, address, iz);
    } catch (e) {
      const first = String(e && e.message ? e.message : e).split('\n')[0];
      check(criterionFlow, false, `${label} koşusu yarıda kaldı: ${first}`, iz.errors.length ? 'konsol: ' + iz.errors.slice(0, 2).map((h) => h.slice(0, 200)).join(' | ') : undefined);
    }
    check(5, iz.errors.length === 0, `${label} koşusu: konsol hatası yok`, iz.errors.length ? `${iz.errors.length} hata, ilk: ` + iz.errors.slice(0, 3).map((h) => h.slice(0, 200)).join(' | ') : '0 hata');
    agCheck(iz, localPrefix, label, 4);
    await ctx.close();
    return iz;
  }
  try {
    // ---- Koşu 1: yerel sunucu (ölçüt 2, 3) ----
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
    // ---- Koşu 1b: yerel sunucu, sahte __TAURI__ ile ----
    await run('tauri-simulation', 'file', localRoot + 'index.html', localRoot, async (p, address, iz) => {
      await m2TauriSimulation(p, address, 'tauri-simulation');
      await m6TauriI18n(p, address, 'tauri-simulation');
      await m3Printing(p, address, 'tauri-simulation');
      await m3NoTauriI18n(p, address, iz, 'tauri-simulation');
      await m7LearnSmoke(p, address, 'tauri-simulation', true);
    });
    // ---- Koşu 1d: başlangıç hatası benzetimi, tr-TR ----
    await run('açılış-hatası', 'i18n', localRoot + 'index.html', localRoot, async (p, address, iz) => {
      await m6StartupError(p, address, iz, 'açılış-hatası');
    });
    // ---- Koşu 1e: Öğren rehberi, Tauri CSP başlığıyla; tr-TR ve en-US; hareketi azalt ----
    await run('öğren', 'learn', localRoot + 'index.html', localRoot, async (p, address, iz) => {
      await m7LearnFlow(p, address, iz, 'öğren', 'tr');
    });
    await run('öğren en', 'learn', localRoot + 'index.html', localRoot, async (p, address, iz) => {
      await m7LearnFlow(p, address, iz, 'öğren en', 'en');
    }, 'en-US');
    await m7ReduceLearn(browser, localRoot + 'index.html', 'öğren azalt', 'tr-TR');
    await m7ReduceLearn(browser, localRoot + 'index.html', 'öğren azalt en', 'en-US');
    // ---- Koşu 1c: İngilizce arayüz, en-US tarayıcı ----
    await run('en', 'i18n', localRoot + 'index.html', localRoot, async (p, address, iz) => {
      await m6MostFlow(p, address, iz, 'en', true);
    }, 'en-US');
    // ---- Koşu 2: file:// (ölçüt 6) ----
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
    // ---- Koşu 2b: file://, İngilizce duman ----
    await run('en file://', 'i18n', pathToFileURL(join(APP, 'index.html')).href, 'file://', async (p, address, iz) => {
      await m6MostFlow(p, address, iz, 'en file://', false);
    }, 'en-US');
    check(6, iz2.errors.length === 0, 'file:// koşusu: konsol hatası yok (ölçüt 6)');
  } catch (e) {
    check('-', false, 'beklenmeyen hata', e && e.stack ? e.stack : String(e));
  } finally {
    await browser.close();
    server.close();
  }
  const rest = results.filter((s) => !s.pass);
  console.log(`\nÖZET: ${results.length} kontrol, ${results.length - rest.length} geçti, ${rest.length} kaldı`);
  if (rest.length) code = 1;
  process.exit(code);
}

main();
