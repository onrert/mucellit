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

const BURASI = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(BURASI, '..', '..');
const ALT_YOL = '/kitap-cilt-test/';
const MOTOR = (process.argv.find((a) => a.startsWith('--motor=')) || '--motor=chromium').slice('--motor='.length);
const KUSURLU = process.argv.includes('--kusurlu');
const distArg = (() => { const i = process.argv.indexOf('--dist'); return i > 0 ? process.argv[i + 1] : null; })();
const LISANSLAR = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'vendor/SOURCES.md', 'vendor/pdf-lib/LICENSE.md', 'vendor/pdfjs/LICENSE',
  'vendor/fontkit/LICENSE', 'vendor/literata/OFL.txt', 'js/learn/LICENSE'];
/** Tarayıcı sürümünde görünmemesi gereken masaüstü (Mac/Tauri) izleri. */
const MASAUSTU = /\bMac\b|macOS|⌘|Tauri|Finder|\bDock\b|Önizleme'de|Open in Preview/;
const SOZ = { tr: { sekme: ['Düzenle', 'Süreç', 'Hesapla', 'Öğren'], ek: '-dizilmis.pdf' }, en: { sekme: ['Imposition', 'Projects', 'Calculator', 'Learn'], ek: '-imposed.pdf' } };

async function playwrightYukle() {
  if (process.env.KC_PLAYWRIGHT) return await import(pathToFileURL(join(resolve(process.env.KC_PLAYWRIGHT), 'index.mjs')).href);
  try { return await import('playwright'); } catch {
    const kok = execSync('npm root -g').toString().trim();
    return await import(pathToFileURL(join(kok, 'playwright', 'index.mjs')).href);
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

/** Yalnız ALT_YOL altını sunan statik sunucu; alt yol dışı istekleri kaydeder. */
function sunucuBaslat(kok) {
  const disari = [];
  const sunucu = createServer(async (istek, yanit) => {
    const yol = decodeURIComponent(new URL(istek.url, 'http://x').pathname);
    if (yol === ALT_YOL.slice(0, -1)) { yanit.writeHead(301, { location: ALT_YOL }); return yanit.end(); }
    if (!yol.startsWith(ALT_YOL)) { disari.push(yol); yanit.writeHead(404); return yanit.end(); }
    try {
      let dosya = resolve(kok, '.' + '/' + yol.slice(ALT_YOL.length));
      if (dosya !== kok && !dosya.startsWith(kok + sep)) { yanit.writeHead(403); return yanit.end(); }
      if (existsSync(dosya) && statSync(dosya).isDirectory()) dosya = join(dosya, 'index.html');
      const icerik = await readFile(dosya);
      yanit.writeHead(200, { 'content-type': MIME[extname(dosya)] || (/LICENSE|OFL/.test(dosya) ? 'text/plain; charset=utf-8' : 'application/octet-stream') });
      yanit.end(icerik);
    } catch { yanit.writeHead(404); yanit.end(); }
  });
  return new Promise((ok) => sunucu.listen(0, '127.0.0.1', () => ok({ sunucu, disari })));
}

async function testPdfUret(page) {
  const dizi = await page.evaluate(async () => {
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const doc = await PDFDocument.create();
    const yazi = await doc.embedFont(StandardFonts.HelveticaBold);
    for (let i = 1; i <= 37; i++) {
      const s = doc.addPage([419.53, 595.28]);
      const t = String(i), boy = 160;
      s.drawText(t, { x: (419.53 - yazi.widthOfTextAtSize(t, boy)) / 2, y: 595.28 / 2 - boy * 0.35, size: boy, font: yazi });
    }
    return Array.from(await doc.save());
  });
  return Buffer.from(dizi);
}

async function pdfIncele(page, bytes) {
  return page.evaluate(async (dizi) => {
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(dizi), isEvalSupported: false }).promise;
    const s = await pdf.getPage(1);
    const vp = s.getViewport({ scale: 1 });
    const tc = await s.getTextContent();
    const ogeler = tc.items.filter((o) => o.str.trim()).map((o) => ({ str: o.str.trim(), x: o.transform[4], w: o.width })).sort((a, b) => a.x - b.x);
    return { sayfa: pdf.numPages, mm: [vp.width * 25.4 / 72, vp.height * 25.4 / 72], ilk: ogeler.map((o) => o.str + ':' + (o.x + o.w / 2 < vp.width / 2 ? 'sol' : 'sag')) };
  }, Array.from(bytes));
}

/** Görünen metin + görünür öğelerin title/aria-label/placeholder'ı (dil seçici hariç). */
async function gorunenMetin(page) {
  return page.evaluate(() => {
    const kopya = document.body.cloneNode(true);
    kopya.querySelectorAll('#dil-sec, script, [hidden], template').forEach((e) => e.remove());
    const oz = Array.from(document.querySelectorAll('[title],[aria-label],[placeholder]'))
      .filter((e) => e.id !== 'dil-sec' && e.offsetParent !== null)
      .map((e) => [e.title, e.getAttribute('aria-label'), e.placeholder].filter(Boolean).join(' ')).join(' ');
    return kopya.innerText + ' ' + oz + ' ' + document.title;
  });
}

/** Bir dist klasörünü iki dilde sınar; sonuç listesi döner. */
async function denetle(pw, distKok, { sessiz = false, zaman = 60000 } = {}) {
  const sonuc = [];
  const kontrol = (kosul, mesaj, ayrinti) => {
    sonuc.push({ gecti: !!kosul, mesaj });
    if (!sessiz) console.log(`${kosul ? 'GEÇTİ' : 'KALDI'} ${mesaj}${ayrinti !== undefined ? ' — ' + ayrinti : ''}`);
  };
  const kok = resolve(distKok);
  const { sunucu, disari } = await sunucuBaslat(kok);
  const sunucuKok = `http://127.0.0.1:${sunucu.address().port}`;
  const site = sunucuKok + ALT_YOL;
  const tarayici = await pw[MOTOR].launch();
  try {
    for (const [dil, yerel] of [['tr', 'tr-TR'], ['en', 'en-US']]) {
      const et = `[${MOTOR} ${dil}]`;
      const ctx = await tarayici.newContext({ acceptDownloads: true, locale: yerel, viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      page.setDefaultTimeout(zaman);
      const hatalar = [], istekler = [];
      page.on('console', (m) => { if (m.type() === 'error') hatalar.push('console.error: ' + m.text()); });
      page.on('pageerror', (e) => hatalar.push('pageerror: ' + e.message));
      page.on('request', (r) => istekler.push(r.url()));
      page.on('dialog', (d) => d.accept());
      try {
        // ---- açılış (alt yol, sondaki / olmadan da)
        await page.goto(site.slice(0, -1));
        await page.waitForSelector('html[data-hazir="evet"]', { timeout: Math.min(zaman, 20000) });
        const a = await page.evaluate(() => ({ url: location.href, lang: document.documentElement.lang, platform: window.KitapCilt.platform.ad,
          sekmeler: ['duzenle', 'surec', 'hesapla', 'ogren'].map((s) => document.getElementById('sekme-dugme-' + s).textContent.trim()) }));
        kontrol(a.url === site && a.lang === dil && a.platform === 'tarayici' && JSON.stringify(a.sekmeler) === JSON.stringify(SOZ[dil].sekme),
          `${et} açılış: ${ALT_YOL} altında hazır, dil ${dil}, platform tarayıcı, sekme adları seçili dilde`, JSON.stringify(a));

        // ---- masaüstüne özgü metin/düğme yok (dört sekme)
        const izler = [];
        for (const s of ['duzenle', 'surec', 'hesapla', 'ogren']) {
          await page.click('#sekme-dugme-' + s);
          const m = (await gorunenMetin(page)).match(new RegExp(MASAUSTU.source, 'g'));
          if (m) izler.push(s + ': ' + [...new Set(m)].join(', '));
        }
        await page.click('#sekme-dugme-duzenle');
        const y = await page.evaluate(() => ({ yazdir: window.KitapCilt.platform.yazdir, alan: document.getElementById('yazdir-alani').hidden,
          gorunur: !!document.getElementById('yazdir').offsetParent || !!(document.getElementById('onizlemede-ac') || {}).offsetParent }));
        kontrol(izler.length === 0 && y.yazdir === null && y.alan && !y.gorunur,
          `${et} masaüstüne özgü metin/düğme görünmüyor (4 sekme; Yazdır/Önizleme'de Aç gizli)`, izler.length ? izler.join(' | ') : JSON.stringify(y));

        // ---- dil seçiciyle öteki dile geçiş ve geri dönüş (yeniden yükleme alt yolda kalır)
        const oteki = dil === 'tr' ? 'en' : 'tr';
        await Promise.all([page.waitForEvent('load'), page.selectOption('#dil-sec', oteki)]);
        await page.waitForSelector('html[data-hazir="evet"]');
        const g1 = await page.evaluate(() => ({ url: location.href, lang: document.documentElement.lang, sekme: document.getElementById('sekme-dugme-duzenle').textContent.trim() }));
        await Promise.all([page.waitForEvent('load'), page.selectOption('#dil-sec', 'sistem')]);
        await page.waitForSelector('html[data-hazir="evet"]');
        const g2 = await page.evaluate(() => ({ url: location.href, lang: document.documentElement.lang, sekme: document.getElementById('sekme-dugme-duzenle').textContent.trim() }));
        kontrol(g1.url === site && g1.lang === oteki && g1.sekme === SOZ[oteki].sekme[0] && g2.url === site && g2.lang === dil && g2.sekme === SOZ[dil].sekme[0],
          `${et} dil seçici: ${oteki} → sistem (${dil}); sayfa alt yolda yeniden yüklenir`, JSON.stringify({ g1, g2 }));

        // ---- PDF dizme
        await page.click('#sekme-dugme-duzenle');
        const pdf = await testPdfUret(page);
        await page.setInputFiles('#pdf-dosya', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
        await page.waitForFunction(() => document.querySelectorAll('#kucuk-resimler .kart').length === 37);
        await page.selectOption('#cilt-turu', 'formali');
        await page.fill('#kagit-gen', '297');
        await page.fill('#kagit-yuk', '210');
        await page.fill('#kitap-gen', '148');
        await page.fill('#kitap-yuk', '210');
        await page.fill('#forma-yaprak', '4');
        await page.waitForFunction(() => document.querySelectorAll('#yaprak-onizleme .yaprak-kart').length === 12);
        await page.waitForSelector('#kucuk-resimler[data-resimler-hazir="evet"]');
        const [indirme] = await Promise.all([page.waitForEvent('download'), page.click('#disa-aktar')]);
        const cikti = await readFile(await indirme.path());
        const r = await pdfIncele(page, cikti);
        kontrol(indirme.suggestedFilename().endsWith(SOZ[dil].ek) && r.sayfa === 24 && Math.abs(r.mm[0] - 297) < 0.5 && Math.abs(r.mm[1] - 210) < 0.5
          && JSON.stringify(r.ilk) === '["16:sol","1:sag"]',
          `${et} PDF dizme: 37 sayfa → formalı 4 yaprak, 24 sayfa 297 × 210 mm, 1. sayfa 16 | 1`, JSON.stringify({ ad: indirme.suggestedFilename(), ...r }));

        // ---- Öğren
        await page.click('#sekme-dugme-ogren');
        await page.waitForFunction(() => document.getElementById('og-sahne').childElementCount > 0 && document.getElementById('og-kok').dataset.durum === 'hazir', null, { timeout: Math.min(zaman, 15000) });
        await page.selectOption('#og-hiz', '4');
        await page.click('#og-oynat');
        await page.waitForFunction(() => document.querySelectorAll('#og-adimlar li.bitti').length === 1 && document.getElementById('og-kok').dataset.durum === 'hazir', null, { timeout: Math.min(zaman, 15000) });
        const o = await page.evaluate(() => ({ asama: document.querySelectorAll('#og-asamalar li').length, sekme: document.getElementById('sekme-dugme-ogren').textContent.trim(),
          lisans: document.getElementById('og-lisans-metin').textContent.trim() }));
        const ogrenLisans = existsSync(join(kok, 'js/learn/LICENSE')) ? readFileSync(join(kok, 'js/learn/LICENSE'), 'utf8').trim() : null;
        kontrol(o.asama === 10 && o.sekme === SOZ[dil].sekme[3] && ogrenLisans !== null && o.lisans === ogrenLisans,
          `${et} Öğren: rehber kurulur (10 aşama), bir adım oynar, lisans paneli js/learn/LICENSE ile birebir`, JSON.stringify({ ...o, lisans: o.lisans.slice(0, 30) }));

        // ---- lisans dosyaları sitede (göreli yolla) erişilebilir ve repodakiyle birebir
        const lis = await page.evaluate(async (l) => Promise.all(l.map(async (g) => { const y = await fetch(g); return [g, y.status, y.ok ? await y.text() : ''] })), LISANSLAR);
        const repoKarsiligi = (g) => (g === 'LICENSE' || g === 'THIRD_PARTY_NOTICES.md' ? join(REPO, g) : join(REPO, 'app', g));
        const sorunlu = lis.filter(([g, durum, metin]) => durum !== 200 || metin !== readFileSync(repoKarsiligi(g), 'utf8')).map(([g, d]) => g + ':' + d);
        kontrol(sorunlu.length === 0, `${et} lisans dosyaları sitede erişilebilir ve repodakiyle birebir (${LISANSLAR.length} dosya)`, sorunlu.length ? sorunlu.join(', ') : undefined);
      } catch (e) {
        kontrol(false, `${et} koşu yarıda kaldı: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
      }
      kontrol(hatalar.length === 0, `${et} konsol hatası yok`, hatalar.length ? hatalar.slice(0, 3).map((h) => h.slice(0, 200)).join(' | ') : '0 hata');
      const dis = istekler.filter((u) => !(u.startsWith(site) || u.startsWith('data:') || u.startsWith('blob:') || u === site.slice(0, -1)));
      kontrol(dis.length === 0 && disari.length === 0, `${et} dış ağ isteği ve alt yol dışı istek yok`,
        dis.length || disari.length ? JSON.stringify({ dis: [...new Set(dis)].slice(0, 5), altYolDisi: [...new Set(disari)].slice(0, 5) }) : `${istekler.length} istek, hepsi ${ALT_YOL} altında`);
      disari.length = 0;
      await ctx.close();
    }
  } finally {
    await tarayici.close();
    sunucu.close();
  }
  return sonuc;
}

/** Bozuk dist kopyaları: [ad, bozma işlevi(klasör)]. */
const BOZUKLAR = [
  ['boş klasör', (d) => { rmSync(d, { recursive: true, force: true }); mkdirSync(d); }],
  ['index.html yok', (d) => rmSync(join(d, 'index.html'))],
  ['mutlak yollu betik', (d) => degistir(d, 'index.html', '<script src="js/calc.js"></script>', '<script src="/js/calc.js"></script>')],
  ['dış adrese istek', (d) => degistir(d, 'index.html', '</body>', '<img src="https://example.com/x.png" alt=""></body>')],
  // index.html'deki hidden özniteliğini silmek kusur değildir (impose.js görünürlüğü platform.yazdir'a göre çalışma anında
  // kurar); gerçek kusur tarayıcı platformunun yazdırma sunmasıdır → Yazdır düğmesi tarayıcıda görünür.
  ['görünür Mac düğmesi', (d) => degistir(d, 'js/platform.js', 'yazdir: null,', 'yazdir: function () { return Promise.resolve(true); },')],
  ['Mac metni görünür', (d) => degistir(d, 'index.html', '</header>', '<p>Open in Preview (⌘P)</p></header>')],
  ['LICENSE yok', (d) => rmSync(join(d, 'LICENSE'))],
  ['THIRD_PARTY_NOTICES.md kısmen bozuk', (d) => writeFileSync(join(d, 'THIRD_PARTY_NOTICES.md'), readFileSync(join(d, 'THIRD_PARTY_NOTICES.md'), 'utf8').slice(0, 200))],
  ['Öğren lisans paneli bozuk', (d) => degistir(d, 'index.html', 'Copyright (c) 2026 Tolga Cohce', 'Copyright (c) 2026 X')],
  ['konsol hatası', (d) => degistir(d, 'index.html', '</body>', '<script>console.error("kusur")</script></body>')],
];
function degistir(d, goreli, eski, yeni) {
  const y = join(d, goreli);
  const m = readFileSync(y, 'utf8');
  if (!m.includes(eski)) throw new Error(`bozma kalıbı bulunamadı (${goreli}): ${eski}`);
  writeFileSync(y, m.replace(eski, yeni));
}

async function main() {
  const pw = await playwrightYukle();
  if (!pw[MOTOR] || typeof pw[MOTOR].launch !== 'function') { console.error(`Bilinmeyen motor: ${MOTOR} (chromium | webkit)`); process.exit(2); }
  let dist = distArg ? resolve(distArg) : join(REPO, 'dist');
  if (!distArg) {
    const h = spawnSync(process.execPath, [join(REPO, 'tools', 'prepare-dist.mjs'), '--web', '--sessiz'], { encoding: 'utf8' });
    process.stdout.write(h.stdout + h.stderr);
    if (h.status !== 0) { console.log('KALDI dist-hazirla --web başarısız'); process.exit(1); }
  }
  if (!existsSync(dist)) { console.error('dist klasörü yok: ' + dist); process.exit(2); }
  console.log(`Motor: ${MOTOR}; site: ${dist} → ${ALT_YOL}`);

  if (!KUSURLU) {
    const s = await denetle(pw, dist);
    const kalan = s.filter((x) => !x.gecti);
    console.log(`\nÖZET: ${s.length} kontrol, ${s.length - kalan.length} geçti, ${kalan.length} kaldı`);
    process.exit(kalan.length ? 1 : 0);
  }

  // --kusurlu: her bozuk kopyada denetim en az bir KALDI vermeli
  const tmp = mkdtempSync(join(tmpdir(), 'kc-alt-yol-'));
  let kacan = 0;
  try {
    for (const [ad, boz] of BOZUKLAR) {
      const d = join(tmp, ad.replace(/[^a-z0-9]+/gi, '-'));
      cpSync(dist, d, { recursive: true });
      boz(d);
      const s = await denetle(pw, d, { sessiz: true, zaman: 8000 });
      const kalan = s.filter((x) => !x.gecti);
      const yakalandi = kalan.length > 0;
      if (!yakalandi) kacan += 1;
      console.log(`${yakalandi ? 'GEÇTİ' : 'KALDI'} [kusurlu] ${ad}: denetim ${yakalandi ? 'KALDI dedi' : 'KAÇIRDI'} (${kalan.length}/${s.length} kontrol kaldı${kalan.length ? '; ilk: ' + kalan[0].mesaj.slice(0, 110) : ''})`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\nÖZET (kusurlu): ${BOZUKLAR.length} bozuk kopya, ${BOZUKLAR.length - kacan} yakalandı, ${kacan} kaçtı`);
  process.exit(kacan ? 1 : 0);
}

main();
