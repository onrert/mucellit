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
import { fileURLToPath, pathToFileURL, format as urlBicimle } from 'node:url';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { execSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Tarayıcı yolu: PLAYWRIGHT_BROWSERS_PATH verilmişse o; yoksa /opt/pw-browsers varsa o (bulut ortamı);
// ikisi de yoksa Playwright'ın kendi öntanımlısı (macOS: ~/Library/Caches/ms-playwright).
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const BURASI = dirname(fileURLToPath(import.meta.url));
const UYGULAMA = resolve(BURASI, '..');
const REPO = resolve(UYGULAMA, '..');
const GORUNTU = process.env.KC_GORUNTU ? resolve(process.env.KC_GORUNTU) : join(REPO, 'docs', 'preview.png');
const MOTOR = (process.argv.find((a) => a.startsWith('--motor=')) || '--motor=chromium').slice('--motor='.length);

const sonuclar = [];
function kontrol(olcut, kosul, mesaj, ayrinti) {
  sonuclar.push({ olcut, gecti: !!kosul, mesaj });
  console.log(`${kosul ? 'GEÇTİ' : 'KALDI'} [ölçüt ${olcut}] ${mesaj}${ayrinti !== undefined ? ' — ' + ayrinti : ''}`);
}

/**
 * Playwright modülü sırayla: KC_PLAYWRIGHT (modül klasörü, ör. /yol/playwright/node_modules/playwright),
 * düz `import('playwright')`, son olarak global npm kökü.
 */
async function playwrightYukle() {
  if (process.env.KC_PLAYWRIGHT) return await import(pathToFileURL(join(resolve(process.env.KC_PLAYWRIGHT), 'index.mjs')).href);
  try { return await import('playwright'); } catch {
    const kok = execSync('npm root -g').toString().trim();
    return await import(pathToFileURL(join(kok, 'playwright', 'index.mjs')).href);
  }
}

// Tauri penceresinin CSP'si: yerel sunucu aynısını başlık olarak gönderir. null ise başlık yok.
const TAURI_CSP = (() => {
  const c = JSON.parse(readFileSync(join(REPO, 'src-tauri', 'tauri.conf.json'), 'utf8')).app.security.csp;
  return typeof c === 'string' && c.trim() ? c : null;
})();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function sunucuBaslat() {
  const sunucu = createServer(async (istek, yanit) => {
    try {
      const yol = decodeURIComponent(new URL(istek.url, 'x:/').pathname);
      const dosya = resolve(UYGULAMA, '.' + (yol === '/' ? '/index.html' : yol));
      if (dosya !== UYGULAMA && !dosya.startsWith(UYGULAMA + sep)) { yanit.writeHead(403); return yanit.end(); }
      const icerik = await readFile(dosya);
      const baslik = { 'content-type': MIME[extname(dosya)] || 'application/octet-stream' };
      if (TAURI_CSP && extname(dosya) === '.html') baslik['content-security-policy'] = TAURI_CSP;
      yanit.writeHead(200, baslik);
      yanit.end(icerik);
    } catch { yanit.writeHead(404); yanit.end(); }
  });
  return new Promise((ok) => sunucu.listen(0, '127.0.0.1', () => ok(sunucu)));
}

/** Sayfayı izler: konsol hataları ve ağ istekleri. */
function izle(page, etiket) {
  const iz = { hatalar: [], istekler: [], istemler: [], onaylar: [], onayRed: false };
  page.on('console', (m) => { if (m.type() === 'error') iz.hatalar.push(`[${etiket}] console.error: ${m.text()}`); });
  page.on('pageerror', (e) => iz.hatalar.push(`[${etiket}] pageerror: ${e.message}`));
  page.on('request', (r) => iz.istekler.push(r.url()));
  page.on('dialog', (d) => {
    if (d.type() === 'prompt') { iz.istemler.push(d.message()); return d.dismiss(); }
    if (d.type() === 'confirm') { iz.onaylar.push(d.message()); return iz.onayRed ? d.dismiss() : d.accept(); }
    return d.accept();
  });
  return iz;
}

async function testPdfUret(page) {
  // Test PDF'i sayfadaki pdf-lib ile üretilir: 37 sayfa, A5, her sayfada büyük numara.
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

async function pdfIncele(page, bytes, sayfalar) {
  return page.evaluate(async ({ dizi, sayfalar }) => {
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(dizi), isEvalSupported: false }).promise;
    const boyutlar = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const s = await pdf.getPage(i);
      const vp = s.getViewport({ scale: 1 });
      boyutlar.push([vp.width * 25.4 / 72, vp.height * 25.4 / 72]);
    }
    const metinler = {};
    for (const n of sayfalar) {
      const s = await pdf.getPage(n);
      const vp = s.getViewport({ scale: 1 });
      const tc = await s.getTextContent();
      metinler[n] = { gen: vp.width, ogeler: tc.items.filter((o) => o.str.trim()).map((o) => ({ str: o.str.trim(), x: o.transform[4], w: o.width })) };
    }
    return { sayfaSayisi: pdf.numPages, boyutlar, metinler };
  }, { dizi: Array.from(bytes), sayfalar });
}

function solSag(m) {
  // ögeleri x'e göre sırala; her ögenin sol/sağ yarıda olup olmadığını döndür
  return m.ogeler.slice().sort((a, b) => a.x - b.x).map((o) => ({ str: o.str, yari: o.x + o.w / 2 < m.gen / 2 ? 'sol' : 'sag' }));
}

/** PDF yükle → formalı ayarla → dışa aktar → çıktıyı doğrula. */
async function pdfAkisi(page, adres, etiket, olcut, ekranGoruntusu) {
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.click('#sekme-dugme-duzenle');
  const pdf = await testPdfUret(page);
  await page.setInputFiles('#pdf-dosya', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#kucuk-resimler .kart').length === 37);
  kontrol(olcut, true, `${etiket}: 37 sayfalık PDF yüklendi, 37 küçük resim kartı`);
  await page.selectOption('#cilt-turu', 'formali');
  await page.fill('#kagit-gen', '297');
  await page.fill('#kagit-yuk', '210');
  await page.fill('#kitap-gen', '148');
  await page.fill('#kitap-yuk', '210');
  await page.fill('#forma-yaprak', '4');
  await page.waitForFunction(() => document.querySelectorAll('#yaprak-onizleme .yaprak-kart').length === 12);
  const ozet = await page.textContent('#dizilim-ozet');
  kontrol(olcut, /48 sayfaya/.test(ozet) && /3 forma/.test(ozet), `${etiket}: önizleme 12 yaprak, özet`, ozet.trim());
  await page.waitForSelector('#kucuk-resimler[data-resimler-hazir="evet"]', { timeout: 60000 });
  if (ekranGoruntusu) {
    await mkdir(dirname(GORUNTU), { recursive: true });
    await page.locator('#yaprak-onizleme').screenshot({ path: GORUNTU });
    kontrol(olcut, true, `${etiket}: önizleme ekran görüntüsü kaydedildi`, GORUNTU);
  }
  const [indirme] = await Promise.all([page.waitForEvent('download'), page.click('#disa-aktar')]);
  const cikti = await readFile(await indirme.path());
  kontrol(olcut, /-dizilmis\.pdf$/.test(indirme.suggestedFilename()), `${etiket}: tek PDF indirildi`, indirme.suggestedFilename());
  await page.waitForSelector('#cikti-onizleme[data-hazir="evet"]');

  const r = await pdfIncele(page, cikti, [1, 2, 3, 17]);
  kontrol(olcut, r.sayfaSayisi === 24, `${etiket}: çıktı 24 sayfa`, r.sayfaSayisi);
  const kotu = r.boyutlar.map((b, i) => [i + 1, b]).filter(([, b]) => Math.abs(b[0] - 297) > 0.5 || Math.abs(b[1] - 210) > 0.5);
  kontrol(olcut, r.boyutlar.length === 24 && kotu.length === 0, `${etiket}: her sayfa 297×210 mm (±0.5)`,
    kotu.length ? JSON.stringify(kotu) : `ilk ${r.boyutlar[0].map((x) => x.toFixed(2)).join('×')} mm`);
  const s1 = solSag(r.metinler[1]);
  kontrol(olcut, s1.length === 2 && s1[0].str === '16' && s1[0].yari === 'sol' && s1[1].str === '1' && s1[1].yari === 'sag',
    `${etiket}: 1. sayfada 16 solda, 1 sağda (pdf.js metin)`, JSON.stringify(s1));
  const s2 = solSag(r.metinler[2]);
  kontrol(olcut, JSON.stringify(s2.map((o) => o.str)) === '["2","15"]', `${etiket}: 2. sayfa (arka) [2, 15]`, JSON.stringify(s2));
  const s3 = solSag(r.metinler[3]);
  kontrol(olcut, JSON.stringify(s3.map((o) => o.str)) === '["14","3"]', `${etiket}: 3. sayfa [14, 3]`, JSON.stringify(s3));
  const s17 = solSag(r.metinler[17]);
  kontrol(olcut, s17.length === 1 && s17[0].str === '33' && s17[0].yari === 'sag', `${etiket}: 17. sayfa [48 boş, 33]`, JSON.stringify(s17));
}

async function depoOku(page) {
  return page.evaluate(() => { const h = localStorage.getItem('kitapCilt.v1'); return h ? JSON.parse(h) : null; });
}

async function surecAkisi(page) {
  const O = 3;
  await page.click('#sekme-dugme-surec');
  await page.fill('#yk-ad', 'E2E Kitap');
  await page.selectOption('#yk-tur', 'formali');
  await page.fill('#yk-kagit', '80 g/m²');
  await page.click('#yk-olustur');
  await page.waitForFunction(() => document.querySelectorAll('#adimlar .adim').length === 14);
  kontrol(O, true, 'kitap oluşturuldu, formalı şablon 14 adım');
  await page.locator('#adimlar .adim-tamam').nth(0).check();
  await page.locator('#adimlar .adim-tamam').nth(1).check();
  await page.locator('#adimlar .adim-not').nth(1).fill('ilk deneme: tek forma');
  // Düzenle ayarlarını kitaba kaydet
  await page.click('#sekme-dugme-duzenle');
  const kitapId = (await depoOku(page)).kitaplar[0].id;
  await page.selectOption('#ayar-kitap', kitapId);
  await page.click('#ayar-kaydet');
  const kayitli = await depoOku(page);
  kontrol(O, kayitli.kitaplar[0].ayar && kayitli.kitaplar[0].ayar.kagitGen === 297 && kayitli.kitaplar[0].pdfAdi === 'test-37.pdf',
    'Düzenle ayarları kitaba kaydedildi', JSON.stringify({ kagitGen: kayitli.kitaplar[0].ayar && kayitli.kitaplar[0].ayar.kagitGen, pdfAdi: kayitli.kitaplar[0].pdfAdi }));

  await page.reload();
  await page.waitForSelector('html[data-hazir="evet"]');
  await page.click('#sekme-dugme-surec');
  await page.waitForSelector('#adimlar .adim');
  const isaretler = await page.$$eval('#adimlar .adim-tamam', (l) => l.map((e) => e.checked));
  const not = await page.locator('#adimlar .adim-not').nth(1).inputValue();
  kontrol(O, isaretler.length === 14 && isaretler[0] && isaretler[1] && isaretler.filter(Boolean).length === 2,
    'yenilemeden sonra 2 işaret duruyor', JSON.stringify(isaretler.map((x) => (x ? 1 : 0))));
  kontrol(O, not === 'ilk deneme: tek forma', 'yenilemeden sonra not duruyor', not);

  const once = await depoOku(page);
  const [indirme] = await Promise.all([page.waitForEvent('download'), page.click('#json-disa')]);
  const jsonYolu = await indirme.path();
  const disa = JSON.parse(await readFile(jsonYolu, 'utf8'));
  kontrol(O, isDeepStrictEqual(disa, once), 'JSON dışa aktarım saklanan veriyle aynı', indirme.suggestedFilename());

  await page.click('#veri-temizle');
  await page.waitForFunction(() => document.querySelectorAll('#kitap-listesi li').length === 0);
  const temiz = await depoOku(page);
  kontrol(O, !temiz || temiz.kitaplar.length === 0, 'temizle: veri boş', JSON.stringify(temiz));

  await page.setInputFiles('#json-ice', jsonYolu);
  await page.waitForFunction(() => document.querySelectorAll('#kitap-listesi li').length === 1);
  const sonra = await depoOku(page);
  kontrol(O, isDeepStrictEqual(sonra, once), 'içe aktar: veri dışa aktarılanla birebir aynı');
  const isaretler2 = await page.$$eval('#adimlar .adim-tamam', (l) => l.map((e) => e.checked));
  kontrol(O, isaretler2.filter(Boolean).length === 2 && isaretler2[0] && isaretler2[1], 'içe aktarımdan sonra 2 işaret arayüzde', JSON.stringify(isaretler2.map((x) => (x ? 1 : 0))));
}


// ------------------------------------------------------------------
// Düzeltme testleri
// ------------------------------------------------------------------
const FIXTURE = join(UYGULAMA, 'test', 'fixtures');

/** Sayfa içi yardımcılar: sayılı PDF üretimi, çıktı üretimi (KC.cikti.uret) ve pdf.js ile metin okuma. */
async function yardimcilariKur(page) {
  await page.evaluate(() => {
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const T = (window.__t = {});
    T.sayiliPdf = async (n, w = 419.53, h = 595.28) => {
      const doc = await PDFDocument.create();
      const yazi = await doc.embedFont(StandardFonts.HelveticaBold);
      for (let i = 1; i <= n; i++) {
        const s = doc.addPage([w, h]);
        const t = String(i), boy = 120;
        s.drawText(t, { x: (w - yazi.widthOfTextAtSize(t, boy)) / 2, y: h / 2 - boy * 0.35, size: boy, font: yazi });
      }
      return await doc.save();
    };
    T.ayar = (ek) => Object.assign({
      ciltTuru: 'formali', formaYaprak: 1, sonFormaKucult: false, kayma: false, kagitKalinlik: 0.1,
      kagitGen: 297, kagitYuk: 210, kitapGen: 148, kitapYuk: 210, olcek: 'sigdir', disKenar: 0, ciltPayi: 0,
      kirim: false, katlama: false, sirtIsareti: false, cevirme: 'kisa', ciktiModu: 'tek', arkaTers: false,
    }, ek || {});
    T.uret = async (kaynak, sayfalar, ek) => {
      const s = await window.KitapCilt.cikti.uret({ kaynakBytes: kaynak, sayfalar, ayar: T.ayar(ek), dosyaAdi: 'test.pdf' });
      return s;
    };
    T.tumu = (n) => Array.from({ length: n }, (_, i) => ({ tur: 'pdf', kaynak: i, dondur: 0 }));
    T.metinler = async (bytes) => {
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
      const sayfalar = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const s = await pdf.getPage(n);
        const vp = s.getViewport({ scale: 1 });
        const tc = await s.getTextContent();
        sayfalar.push({
          gen: vp.width, yuk: vp.height,
          ogeler: tc.items.filter((o) => o.str.trim()).map((o) => ({ str: o.str.trim(), x: o.transform[4], y: o.transform[5], a: o.transform[0], w: o.width })),
        });
      }
      return sayfalar;
    };
  });
}

/** Bir sayfa içi işlevi çalıştırır; sonuç yalnız serileştirilebilir değerler içerir. */
function sirali(sayfaMetni) { return sayfaMetni.ogeler.slice().sort((a, b) => a.x - b.x).map((o) => o.str); }

async function ayAkisIki(page, etiket) {
  const A = 'AD6';
  // ---- iki PDF çıktısı + arkalar ters sıra (8 sayfa, forma 2 yaprak → 2 kâğıt) ----
  const r = await page.evaluate(async () => {
    const T = window.__t;
    const kaynak = await T.sayiliPdf(8);
    const duz = await T.uret(kaynak, T.tumu(8), { formaYaprak: 2, ciktiModu: 'ikili', arkaTers: false });
    const ters = await T.uret(kaynak, T.tumu(8), { formaYaprak: 2, ciktiModu: 'ikili', arkaTers: true });
    const o = {};
    for (const [ad, s] of [['duz', duz], ['ters', ters]]) {
      o[ad] = { adlar: s.dosyalar.map((d) => d.ad), sayfalar: [] };
      for (const d of s.dosyalar) o[ad].sayfalar.push((await T.metinler(d.bytes)).map((m) => m.ogeler.slice().sort((a, b) => a.x - b.x).map((e) => e.str)));
    }
    return o;
  });
  kontrol(A, r.duz.adlar.length === 2 && /-onler\.pdf$/.test(r.duz.adlar[0]) && /-arkalar\.pdf$/.test(r.duz.adlar[1]),
    `${etiket}: iki PDF modu iki dosya üretir (önler + arkalar)`, r.duz.adlar.join(' , '));
  kontrol(A, JSON.stringify(r.duz.sayfalar[0]) === '[["8","1"],["6","3"]]', `${etiket}: önler [8|1] [6|3]`, JSON.stringify(r.duz.sayfalar[0]));
  kontrol(A, JSON.stringify(r.duz.sayfalar[1]) === '[["2","7"],["4","5"]]', `${etiket}: arkalar düz sırada [2|7] [4|5]`, JSON.stringify(r.duz.sayfalar[1]));
  kontrol(A, /-arkalar-ters\.pdf$/.test(r.ters.adlar[1]) && JSON.stringify(r.ters.sayfalar[1]) === '[["4","5"],["2","7"]]',
    `${etiket}: arkaTers açıkken arkalar ters sırada [4|5] [2|7]`, r.ters.adlar[1] + ' ' + JSON.stringify(r.ters.sayfalar[1]));
  kontrol(A, JSON.stringify(r.ters.sayfalar[0]) === JSON.stringify(r.duz.sayfalar[0]), `${etiket}: arkaTers önleri değiştirmez`);

  // ---- 180° arka dönüş: kısa/uzun kenar × yatay/dikey ----
  const d4 = await page.evaluate(async () => {
    const T = window.__t;
    const kaynak = await T.sayiliPdf(4);
    const durumlar = [
      ['yatay-kisa', { kagitGen: 297, kagitYuk: 210, kitapGen: 148, kitapYuk: 210, cevirme: 'kisa' }],
      ['yatay-uzun', { kagitGen: 297, kagitYuk: 210, kitapGen: 148, kitapYuk: 210, cevirme: 'uzun' }],
      ['dikey-kisa', { kagitGen: 210, kagitYuk: 297, kitapGen: 100, kitapYuk: 150, cevirme: 'kisa' }],
      ['dikey-uzun', { kagitGen: 210, kagitYuk: 297, kitapGen: 100, kitapYuk: 150, cevirme: 'uzun' }],
    ];
    const o = {};
    for (const [ad, ek] of durumlar) {
      const s = await T.uret(kaynak, T.tumu(4), ek);
      const m = await T.metinler(s.dosyalar[0].bytes);
      o[ad] = m.map((p) => ({ sira: p.ogeler.slice().sort((a, b) => a.x - b.x).map((e) => e.str), isaretler: p.ogeler.map((e) => Math.sign(e.a)) }));
    }
    return o;
  });
  const beklenen = { 'yatay-kisa': false, 'yatay-uzun': true, 'dikey-kisa': true, 'dikey-uzun': false };
  for (const [ad, don] of Object.entries(beklenen)) {
    const [on, arka] = d4[ad];
    const onDuz = on.isaretler.every((i) => i > 0) && JSON.stringify(on.sira) === '["4","1"]';
    const arkaTamam = don
      ? arka.isaretler.length === 2 && arka.isaretler.every((i) => i < 0) && JSON.stringify(arka.sira) === '["3","2"]'
      : arka.isaretler.length === 2 && arka.isaretler.every((i) => i > 0) && JSON.stringify(arka.sira) === '["2","3"]';
    kontrol(A, onDuz && arkaTamam, `${etiket}: ${ad}: ön düz, arka ${don ? '180° döndü' : 'dönmedi'}`, JSON.stringify({ on: on.sira, arka: arka.sira, arkaIsaret: arka.isaretler }));
  }
}

async function ayKutular(page, etiket) {
  const A = 'AD4';
  // CropBox (30,30,420,595) ve kökeni (0,0) olmayan MediaBox (100,100,420,595); /Contents'siz sayfa
  const r = await page.evaluate(async () => {
    const T = window.__t;
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    let p = doc.addPage([420, 595]); p.setMediaBox(100, 100, 420, 595); p.drawText('KAYIKORIJIN', { x: 150, y: 400, size: 30, font: f });
    p = doc.addPage([480, 655]); p.setCropBox(30, 30, 420, 595); p.drawText('KIRPIK', { x: 150, y: 300, size: 30, font: f }); p.drawText('TASMA', { x: 2, y: 2, size: 20, font: f });
    const kaynak = await doc.save();
    const s = await T.uret(kaynak, T.tumu(2), { ciltTuru: 'tek1', kagitGen: 210, kagitYuk: 297, kitapGen: 210, kitapYuk: 297, olcek: 'gercek', cevirme: 'uzun' });
    const m = await T.metinler(s.dosyalar[0].bytes);
    const icerik = s.yerlesim.yuzler.map((y) => y.yuvalar.filter((v) => !v.bos).map((v) => v.icerik)[0]);
    // TASMA: CropBox dışı metin çıktıda hiç görünmemeli → sayfayı çizip o bölgenin beyaz olduğunu denetle
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(s.dosyalar[0].bytes), isEvalSupported: false }).promise;
    const sf = await pdf.getPage(2);
    const vp = sf.getViewport({ scale: 1 });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await sf.render({ canvasContext: g, viewport: vp }).promise;
    return { m, icerik, vpYuk: vp.height, vpGen: vp.width, kaynakBytes: Array.from(kaynak.slice(0, 0)), tasmaMetin: m[1].ogeler.some((o) => /TASMA/.test(o.str)),
      pikselBoyut: [c.width, c.height], piksel: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
  });
  const MM = 72 / 25.4;
  const mm2pt = (x) => x * MM;
  const kok = (ic) => ({ sol: mm2pt(ic.x + ic.w / 2) - 210, alt: mm2pt(ic.y + ic.h / 2) - 297.5 });
  const k1 = kok(r.icerik[0]), k2 = kok(r.icerik[1]);
  const o1 = r.m[0].ogeler.find((o) => o.str === 'KAYIKORIJIN');
  const o2 = r.m[1].ogeler.find((o) => o.str === 'KIRPIK');
  kontrol(A, o1 && Math.abs(o1.x - (k1.sol + 50)) < 0.6 && Math.abs(o1.y - (k1.alt + 300)) < 0.6,
    `${etiket}: MediaBox (100,100,420,595): KAYIKORIJIN x=sol+50 (köken kaymaz)`, o1 ? `x ${o1.x.toFixed(2)} (beklenen ${(k1.sol + 50).toFixed(2)}), y ${o1.y.toFixed(2)} (beklenen ${(k1.alt + 300).toFixed(2)})` : 'metin yok');
  kontrol(A, o2 && Math.abs(o2.x - (k2.sol + 120)) < 0.6 && Math.abs(o2.y - (k2.alt + 270)) < 0.6,
    `${etiket}: CropBox (30,30,420,595): KIRPIK x=sol+120`, o2 ? `x ${o2.x.toFixed(2)} (beklenen ${(k2.sol + 120).toFixed(2)}), y ${o2.y.toFixed(2)} (beklenen ${(k2.alt + 270).toFixed(2)})` : 'metin yok');
  // TASMA'nın çizileceği yer: sayfa sol-altı = (sol-28, alt-28) pt, 20 pt yazı ~ 50 pt geniş
  const [W, H] = r.pikselBoyut;
  const x0 = Math.max(0, Math.floor(k2.sol - 30)), x1 = Math.floor(k2.sol - 1);
  const yAlt = Math.floor(H - (k2.alt - 28)), yUst = Math.floor(H - (k2.alt - 28 + 20));
  let koyu = 0;
  for (let y = yUst - 2; y <= yAlt + 2; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * W + x) * 4; if (r.piksel[i] < 200) koyu += 1;
  }
  console.log(`bilgi: ${etiket}: TASMA metin çıkarımında ${r.tasmaMetin ? 'görünür (pdf.js kırpmayı metin çıkarımına uygulamaz)' : 'yok'}`);
  kontrol(A, koyu === 0, `${etiket}: CropBox dışındaki "TASMA" yazısı çıktıda çizilmiyor (taşma bölgesi beyaz)`, `koyu piksel ${koyu}`);

  // ---- /Contents'siz kaynak sayfa boş sayılır ----
  const c = await page.evaluate(async () => {
    const T = window.__t;
    const { PDFDocument } = window.PDFLib;
    const kaynak0 = await T.sayiliPdf(3);
    const doc = await PDFDocument.load(kaynak0);
    // 2. sayfayı /Contents'siz yap
    doc.getPage(1).node.delete(window.PDFLib.PDFName.of('Contents'));
    const kaynak = await doc.save();
    const kontrolDoc = await PDFDocument.load(kaynak);
    const icerikYok = kontrolDoc.getPage(1).node.Contents() === undefined;
    let hata = null, m = null;
    try {
      const s = await T.uret(kaynak, T.tumu(3), {});
      m = (await T.metinler(s.dosyalar[0].bytes)).map((p) => p.ogeler.slice().sort((a, b) => a.x - b.x).map((e) => e.str));
    } catch (e) { hata = e.message; }
    return { icerikYok, hata, m };
  });
  kontrol('AD3', c.icerikYok && c.hata === null && c.m && c.m.length === 2,
    `${etiket}: /Contents'siz sayfa çıktıyı durdurmaz (kaynakta /Contents gerçekten yok)`, c.hata ? 'HATA: ' + c.hata : JSON.stringify(c.m));
  if (c.m) {
    const hepsi = c.m.flat();
    kontrol('AD3', hepsi.includes('1') && hepsi.includes('3') && !hepsi.includes('2'), `${etiket}: /Contents'siz 2. sayfa boş (1 ve 3 var, 2 yok)`, JSON.stringify(c.m));
  }
}

async function ayBosBasa(page, adres, etiket) {
  const A = 'AD6';
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.click('#sekme-dugme-duzenle');
  await yardimcilariKur(page);
  const pdf = Buffer.from(await page.evaluate(async () => Array.from(await window.__t.sayiliPdf(7))));
  await page.setInputFiles('#pdf-dosya', { name: 'yedi.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#kucuk-resimler .kart').length === 7);
  await page.selectOption('#cilt-turu', 'formali');
  await page.fill('#kagit-gen', '297'); await page.fill('#kagit-yuk', '210');
  await page.fill('#kitap-gen', '148'); await page.fill('#kitap-yuk', '210');
  await page.fill('#forma-yaprak', '2');
  await page.selectOption('#cikti-modu', 'tek');
  await page.click('#bos-basa');
  const ilk = await page.getAttribute('#kucuk-resimler .kart:first-child', 'data-tur');
  const son = await page.getAttribute('#kucuk-resimler .kart:last-child', 'data-tur');
  kontrol(A, ilk === 'bos' && son === 'pdf', `${etiket}: "Başa boş" boş sayfayı listenin BAŞINA koyar`, `ilk ${ilk}, son ${son}`);
  await page.waitForFunction(() => !document.getElementById('disa-aktar').disabled);
  const [indirme] = await Promise.all([page.waitForEvent('download'), page.click('#disa-aktar')]);
  const cikti = await readFile(await indirme.path());
  const m = await page.evaluate(async (dizi) => (await window.__t.metinler(new Uint8Array(dizi)))[0].ogeler.map((e) => ({ str: e.str, yari: e.x + e.w / 2 < 148.5 * 72 / 25.4 ? 'sol' : 'sag' })), Array.from(cikti));
  kontrol(A, m.length === 1 && m[0].str === '7' && m[0].yari === 'sol', `${etiket}: başa boş ile 1. çıktı sayfası yalnız solda "7" (sağ yuva boş)`, JSON.stringify(m));
}

async function sifreliAkis(page, adres, iz, etiket) {
  const A = 'AD1';
  const durumlar = ['encrypted-owner-rc4.pdf', 'encrypted-owner-aes.pdf'];
  for (const ad of durumlar) {
    await page.goto(adres);
    await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
    await page.click('#sekme-dugme-duzenle');
    iz.istemler.length = 0;
    await page.setInputFiles('#pdf-dosya', { name: ad, mimeType: 'application/pdf', buffer: await readFile(join(FIXTURE, ad)) });
    await page.waitForSelector('#sifreli-uyari', { timeout: 20000 });
    const uyari = await page.textContent('#sifreli-uyari');
    const kapali = await page.isDisabled('#disa-aktar');
    kontrol(A, /Bu PDF kısıtlı\/şifreli; önce kısıtlamayı kaldırın, ör\. qpdf --decrypt girdi\.pdf cikti\.pdf/.test(uyari) && kapali,
      `${etiket}: ${ad}: Türkçe uyarı görünür, indir düğmesi kapalı`, `disabled=${kapali}`);
    // uyarı sonradan ayar değişince de durur, düğme açılmaz
    await page.fill('#kitap-gen', '147');
    await page.waitForTimeout(150);
    kontrol(A, await page.isDisabled('#disa-aktar') && (await page.locator('#sifreli-uyari').count()) === 1, `${etiket}: ${ad}: ayar değişince de düğme kapalı kalır`);
  }
  // Parolalı (kullanıcı parolası) PDF: parola istemi (window.prompt) AÇILMAZ, önizleme açılmaz, uyarı görünür, indir kapalı
  {
    const ad = 'encrypted-user.pdf';
    await page.goto(adres);
    await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
    await page.click('#sekme-dugme-duzenle');
    iz.istemler.length = 0;
    await page.setInputFiles('#pdf-dosya', { name: ad, mimeType: 'application/pdf', buffer: await readFile(join(FIXTURE, ad)) });
    await page.waitForSelector('#parolali-uyari', { timeout: 20000 });
    await page.waitForTimeout(300);
    const uyari = await page.textContent('#parolali-uyari');
    const kartlar = await page.locator('#kucuk-resimler .kart').count();
    kontrol('AR3', iz.istemler.length === 0, `${etiket}: ${ad}: dialog (prompt) açılmadı`, JSON.stringify(iz.istemler));
    kontrol('AR3', uyari.includes('Bu PDF parolalı; önce parolayı kaldırın: qpdf --password=PAROLA --decrypt girdi.pdf cikti.pdf')
      && await page.isDisabled('#disa-aktar') && kartlar === 0, `${etiket}: ${ad}: Türkçe parolalı uyarısı görünür, önizleme/kart yok, indir kapalı`, `kart=${kartlar}`);
  }
  // Şifre/kısıt durumu denetlenemezse (pdf-lib yok) kapalı başarısız: uyarı + indir kapalı
  {
    const ad = 'dizilim-gerek-yok.pdf';
    await page.goto(adres);
    await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
    await page.click('#sekme-dugme-duzenle');
    const bayt = await page.evaluate(async () => {
      const d = await window.PDFLib.PDFDocument.create();
      for (let i = 0; i < 4; i++) d.addPage([420, 595]);
      return Array.from(await d.save());
    });
    await page.evaluate(() => { window.PDFLib = undefined; });
    await page.setInputFiles('#pdf-dosya', { name: ad, mimeType: 'application/pdf', buffer: Buffer.from(bayt) });
    await page.waitForSelector('#denetim-uyari', { timeout: 20000 });
    const uyari = await page.textContent('#denetim-uyari');
    kontrol('AR2', /Şifre\/kısıt durumu denetlenemedi/.test(uyari) && await page.isDisabled('#disa-aktar'),
      `${etiket}: pdf-lib yokken "denetlenemedi" uyarısı görünür, indir kapalı (kapalı başarısız)`, uyari);
  }
  // guncelVeri kopya döndürür; ayar-yukle kitap.ayar'ı değiştirmez
  {
    await page.goto(adres);
    await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
    const sonuc = await page.evaluate(() => {
      const KC = window.KitapCilt;
      const canli = KC.surec.veri();
      const k = KC.duzenle.guncelVeri();
      const farkliNesne = k !== canli;
      const once = JSON.stringify(canli);
      k.kitaplar.push({ id: 'x', ad: 'sahte', adimlar: [] });
      return { farkliNesne, degismedi: JSON.stringify(KC.surec.veri()) === once };
    });
    kontrol('AR7', sonuc.farkliNesne && sonuc.degismedi, `${etiket}: guncelVeri kopya döndürür (canlı veri değişmez)`, JSON.stringify(sonuc));
    await page.click('#sekme-dugme-surec');
    await page.waitForTimeout(100);
    const ayar = await page.evaluate(() => {
      const KC = window.KitapCilt;
      const v = KC.surec.veri();
      const kt = KC.surecModel.yeniKitap({ ad: 'AyarKitap' });
      kt.ayar = { kitapGen: 120, kitapYuk: 180, ciltTuru: 'formali' };
      v.kitaplar.push(kt);
      KC.duzenle.kitapListesiYenile();
      return kt.id;
    });
    await page.click('#sekme-dugme-duzenle');
    const once = await page.evaluate((id) => JSON.stringify(window.KitapCilt.surecModel.kitapBul(window.KitapCilt.surec.veri(), id).ayar), ayar);
    await page.selectOption('#ayar-kitap', ayar);
    await page.click('#ayar-yukle');
    await page.fill('#kitap-gen', '99');
    await page.waitForTimeout(100);
    const sonra = await page.evaluate((id) => JSON.stringify(window.KitapCilt.surecModel.kitapBul(window.KitapCilt.surec.veri(), id).ayar), ayar);
    kontrol('AR7', once === sonra, `${etiket}: ayar-yukle sonrası kitap.ayar değişmedi`, once + ' / ' + sonra);
  }
}

async function arayuzKontrolleri(page, adres, etiket) {
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.click('#sekme-dugme-duzenle');
  await yardimcilariKur(page);
  const pdf = Buffer.from(await page.evaluate(async () => Array.from(await window.__t.sayiliPdf(8))));
  await page.setInputFiles('#pdf-dosya', { name: 'sekiz.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#kucuk-resimler .kart').length === 8);
  await page.selectOption('#cilt-turu', 'formali');
  await page.fill('#kagit-gen', '297'); await page.fill('#kagit-yuk', '210');
  await page.fill('#kitap-gen', '148'); await page.fill('#kitap-yuk', '210');
  await page.fill('#forma-yaprak', '2');
  await page.fill('#dis-kenar', '0'); await page.fill('#cilt-payi', '0');
  await page.waitForFunction(() => !document.getElementById('disa-aktar').disabled);
  // D7: kağıt kitaba sığmıyor → indirme kapalı + açık uyarı
  await page.fill('#kagit-gen', '200');
  await page.waitForFunction(() => document.getElementById('disa-aktar').disabled);
  let uy = await page.textContent('#uyarilar');
  kontrol('AD6', /sığmıyor/.test(uy), `${etiket}: kağıda sığmayan yerleşimde açık uyarı, indirme kapalı`, uy.trim().slice(0, 90));
  await page.fill('#kagit-gen', '297');
  await page.waitForFunction(() => !document.getElementById('disa-aktar').disabled);
  // D8: negatif kenar / cilt payı reddedilir
  await page.fill('#dis-kenar', '-3');
  await page.waitForFunction(() => document.getElementById('disa-aktar').disabled);
  uy = await page.textContent('#uyarilar');
  kontrol('AD6', /negatif/.test(uy), `${etiket}: negatif dış kenar mesajla reddedilir, indirme kapalı`, uy.trim());
  await page.fill('#dis-kenar', '0');
  await page.fill('#cilt-payi', '-1');
  await page.waitForFunction(() => document.getElementById('disa-aktar').disabled);
  uy = await page.textContent('#uyarilar');
  kontrol('AD6', /negatif/.test(uy), `${etiket}: negatif cilt payı mesajla reddedilir`, uy.trim());
  await page.fill('#cilt-payi', '0');
  // O4: iki PDF modunda çevirme etiketi
  await page.selectOption('#cikti-modu', 'ikili');
  const e1 = await page.textContent('#cevirme-etiket');
  await page.selectOption('#cikti-modu', 'tek');
  const e2 = await page.textContent('#cevirme-etiket');
  kontrol('AD4', /desteyi hangi kenardan çevireceksiniz/.test(e1) && /yazıcıda da aynısını seçin/.test(e2) && e1 !== e2, `${etiket}: iki PDF modunda çevirme etiketi "desteyi hangi kenardan çevireceksiniz"`, e1);
  // D9 + boş sayfa sayısı: Hesapla sekmesi
  await page.click('#sekme-dugme-hesapla');
  await page.fill('#h-sayfaSayisi', '');
  let h = await page.textContent('#h-hata');
  kontrol('AD6', /Sayfa sayısını girin/.test(h), `${etiket}: Hesapla boş sayfa sayısında "Sayfa sayısını girin"`, h.trim());
  await page.fill('#h-sayfaSayisi', '100');
  await page.fill('#h-formaYaprak', '2.6');
  h = await page.textContent('#h-hata');
  kontrol('AD6', /tam sayı/.test(h) && (await page.locator('#h-sonuc tr').count()) === 0, `${etiket}: Hesapla forma yaprağı 2.6'yı reddeder (Düzenle ile aynı)`, h.trim());
  await page.fill('#h-formaYaprak', '4');
  // AH: sert kapak ölçüleri (S = 12 → mukavva 144×216, şerit 16×216, kaplama 352×250)
  await page.fill('#h-sayfaSayisi', '240');
  await page.selectOption('#h-ciltTuru', 'tek1');
  const hucre = (ad) => page.textContent(`#h-sonuc td[data-sonuc="${ad}"]`);
  const m1 = await hucre('mukavva'), s1 = await hucre('sirtSeridi'), k1 = await hucre('kaplama');
  const sayilar = (x) => (x.replace(/\s/g, ' ').match(/\d+(?:,\d+)?/g) || []).join('/');
  kontrol('AH', sayilar(m1) === '144/216' && sayilar(s1) === '16/216' && sayilar(k1) === '352/250', `${etiket}: Hesapla sert kapak ölçüleri 144×216, 16×216, 352×250`, `${m1} | ${s1} | ${k1}`);
  await page.selectOption('#h-sirtKurali', 'yalnizS');
  const s2 = await hucre('sirtSeridi'), k2 = await hucre('kaplama');
  kontrol('AH', sayilar(s2) === '12/216' && sayilar(k2) === '352/250', `${etiket}: "yalnız S" kuralı şerit 12, kaplama yine 352×250`, `${s2} | ${k2}`);
  await page.selectOption('#h-sirtKurali', 'ikiT');
  await page.selectOption('#h-sirtTipi', 'yuvarlak');
  const uyA = await page.textContent('#h-uyarilar');
  kontrol('AH', /eğri boyunu ölçüp girin/.test(uyA) && sayilar(await hucre('sirtSeridi')) === '19/216', `${etiket}: yuvarlak sırt, eğri boyu boş → 19 mm ve uyarı`, uyA.trim().slice(0, 80));
  await page.fill('#h-egriBoyu', '20');
  kontrol('AH', sayilar(await hucre('sirtSeridi')) === '23/216' && (await page.textContent('#h-uyarilar')).trim() === '', `${etiket}: yuvarlak sırt, eğri boyu 20 → 23 mm, uyarı yok`);
  await page.fill('#h-egriBoyu', ''); await page.selectOption('#h-sirtTipi', 'duz');
  await page.fill('#h-mukavvaKalinlik', '4');
  kontrol('AH', /elle ayarlayın/.test(await page.textContent('#h-uyarilar')) && sayilar(await hucre('mafsal')) === '9', `${etiket}: t=4 → mafsal 9 ve "kaynak yok, elle ayarlayın" notu`);
  await page.fill('#h-mukavvaKalinlik', '0');
  kontrol('AH', /sıfırdan büyük/.test(await page.textContent('#h-hata')), `${etiket}: t=0 reddedilir`);
  await page.fill('#h-mukavvaKalinlik', '2');
  // kullanıcıya iç depo yolu (docs/…md) gösterilmez; not "atölye uygulaması" olarak kalır
  const kaynakNotu = await page.textContent('#h-kaynak');
  kontrol('AH', /atölye uygulaması/.test(kaynakNotu) && !/docs\/|\.md\b/.test(kaynakNotu), `${etiket}: Hesapla kaynak notu görünür, iç depo yolu yok`, kaynakNotu);
}

async function osDepoAkisi(page, adres, etiket) {
  // O5: saklama alanı dolu → Süreç sekmesindeki yeni kitap Düzenle sekmesinde de görünür
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.evaluate(() => {
    // kota dolu benzetimi: kitapCilt.v1 yazımı atar
    const eski = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'kitapCilt.v1') throw new DOMException('dolu', 'QuotaExceededError'); return eski.call(this, k, v); };
  });
  await page.click('#sekme-dugme-surec');
  await page.fill('#yk-ad', 'Dolu Kitap');
  await page.click('#yk-olustur');
  await page.waitForFunction(() => document.querySelectorAll('#adimlar .adim').length > 0);
  const uyari = await page.textContent('#depo-uyari');
  kontrol('AD5', /saklama alanı/.test(uyari) && /dolu/.test(uyari), `${etiket}: kota doluyken Türkçe uyarı "saklama alanı ... dolu"`, uyari.trim().slice(0, 80));
  await page.click('#sekme-dugme-duzenle');
  const secenekler = await page.$$eval('#ayar-kitap option', (l) => l.map((o) => o.textContent));
  kontrol('AD5', secenekler.includes('Dolu Kitap'), `${etiket}: kota doluyken Düzenle sekmesi yeni kitabı listeler`, JSON.stringify(secenekler));
}

// ------------------------------------------------------------------
// EPUB → PDF. Fixture'lar epub-build.cjs ile test sırasında üretilir.
// ------------------------------------------------------------------
const EPUB_MIME = 'application/epub+zip';
const E_MESAJ = {
  E1: 'Bu dosya okunamadı: geçerli bir EPUB (ZIP) değil ya da bozuk.',
  E2: 'EPUB içinde META-INF/container.xml yok; dosya bozuk ya da EPUB değil.',
  E3: "Bu EPUB DRM ile korunuyor (şifreli içerik). Mücellit DRM'li kitapları açmaz; DRM'siz bir kopya kullanın.",
  E4: "Bu EPUB sabit sayfa düzeninde (fixed-layout). Mücellit yalnız akışkan (reflowable) EPUB'ları destekler; sabit düzenli EPUB'lar dizilemez.",
};

async function tazeSayfa(page, adres) {
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.click('#sekme-dugme-duzenle');
  await page.evaluate(() => {
    const E = (window.__e = {});
    // EPUB'u eklentiyle doğrudan dönüştürür (arayüzdeki EPUB ayarları ve verilen ölçülerle)
    E.donustur = async (dizi, olcu) => {
      const f = new File([new Uint8Array(dizi)], 'x.epub', { type: 'application/epub+zip' });
      return Array.from(await window.KitapCilt.epub.donustur(f, Object.assign({ kitapGen: 148, kitapYuk: 210, ciltPayi: 0, disKenar: 0 }, olcu || {})));
    };
    E.incele = async (dizi) => {
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(dizi), isEvalSupported: false }).promise;
      const sayfalar = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const s = await pdf.getPage(n);
        const vp = s.getViewport({ scale: 1 });
        const tc = await s.getTextContent();
        sayfalar.push({ gen: vp.width * 25.4 / 72, yuk: vp.height * 25.4 / 72, ogeler: tc.items.map((o) => ({ str: o.str, a: o.transform[0] })) });
      }
      return sayfalar;
    };
    // pdf-lib alt düzey: sayfa başına resim XObject sayısı; font sözlükleri
    E.yapi = async (dizi) => {
      const { PDFDocument, PDFName, PDFDict } = window.PDFLib;
      const doc = await PDFDocument.load(new Uint8Array(dizi), { updateMetadata: false });
      const resimli = doc.getPages().map((p) => {
        const xo = p.node.Resources() && p.node.Resources().lookup(PDFName.of('XObject'));
        if (!xo) return 0;
        return xo.keys().filter((k) => String(xo.lookup(k).dict.get(PDFName.of('Subtype'))) === '/Image').length;
      });
      const fontlar = [];
      const tanimlar = [];
      doc.context.enumerateIndirectObjects().forEach(([, o]) => {
        if (!(o instanceof PDFDict)) return;
        const tip = String(o.get(PDFName.of('Type')));
        if (tip === '/Font') fontlar.push({ alt: String(o.get(PDFName.of('Subtype'))), ad: String(o.get(PDFName.of('BaseFont'))) });
        if (tip === '/FontDescriptor') tanimlar.push(!!o.get(PDFName.of('FontFile2')));
      });
      return { resimli, fontlar, tanimlar };
    };
    E.ir = async (dizi, yol) => {
      const KC = window.KitapCilt;
      const zip = KC.epubZip.oku(new Uint8Array(dizi));
      const paket = await KC.epubPaket.paketOku(zip);
      const ortam = { zip, dil: paket.dil, cssOnbellek: new Map(), resimler: {}, sayac: { atlananResim: 0, tablo: 0 } };
      const r = await KC.xhtmlBlok.belgeyiBloklara(await zip.metin(yol), yol, ortam);
      return { bloklar: r.bloklar, sayac: ortam.sayac, spine: paket.spine.map((s) => s.yol), kapak: paket.kapakYolu, dil: paket.dil,
        satirIci: ortam.satirIciOnbellek ? ortam.satirIciOnbellek.size : null, desteksiz: zip.desteksizKodlamalar ? zip.desteksizKodlamalar() : null };
    };
  });
}

/** EPUB'u arayüzden seçer; "… yüklendi" ya da hata bildirimi gelince döner (önceki yüklemenin kartları beklemeyi kandırmasın). */
async function epubSec(page, ad, bayt, zaman = 90000) {
  await page.evaluate(() => { const b = document.getElementById('bildirim'); b.textContent = ''; b.className = ''; });
  await page.setInputFiles('#pdf-dosya', { name: ad, mimeType: EPUB_MIME, buffer: bayt });
  await page.waitForFunction(() => { const b = document.getElementById('bildirim'); return b.classList.contains('hata') || / yüklendi /.test(b.textContent); }, null, { timeout: zaman });
  return { kart: await page.locator('#kucuk-resimler .kart').count(), bildirim: (await page.textContent('#bildirim')) || '' };
}

const bosluklu = (s) => s.replace(/\s+/g, ' ').trim();

async function epubAkisi(page, adres, etiket) {
  const U = require('./epub-build.cjs');
  const tr = U.hazir.trMini();

  // ---- A7 kabul: IR'de sınıfla italik/kalın parçalar; gizli paragraf yok ----
  await tazeSayfa(page, adres);
  const ir = await page.evaluate(([d]) => window.__e.ir(d, 'OEBPS/b1.xhtml'), [Array.from(tr)]);
  const parca = ir.bloklar.flatMap((b) => b.parcalar || []);
  kontrol('A7', parca.some((p) => p.italik && /eğik yazılmış/.test(p.metin)) && parca.some((p) => p.kalin && /kalın yazılmış/.test(p.metin)) && parca.some((p) => p.kalin && /sınıfla kalın/.test(p.metin)),
    `${etiket}: trMini IR'sinde sınıfla italik, <strong> ve sınıfla kalın parçalar var`);
  kontrol('A7', !parca.some((p) => /GIZLIMETIN/.test(p.metin || '')) && ir.bloklar.some((b) => b.tur === 'ayrac') && ir.bloklar.some((b) => b.onEk === '•') && ir.bloklar.some((b) => b.onEk === '2.'),
    `${etiket}: display:none atlanır, @media kuralı uygulanmaz; ayraç ve liste önekleri (• / 2.)`);
  kontrol('A7', ir.sayac.atlananResim === 1 && ir.sayac.tablo === 1 && ir.bloklar.filter((b) => b.tur === 'resim').length === 2 && ir.kapak === 'OEBPS/resim/kapak.png',
    `${etiket}: SVG atlandı (1), tablo düz metin (1), PNG + GIF resim bloğu (2), kapak cover-image`, JSON.stringify(ir.sayac));

  // ---- B3 Türkçe: arayüzden yükle, kart = PDF sayfa ≥ 3; metin birebir ----
  await page.selectOption('#cilt-turu', 'formali');
  await page.fill('#kagit-gen', '297'); await page.fill('#kagit-yuk', '210');
  await page.fill('#kitap-gen', '148'); await page.fill('#kitap-yuk', '210');
  await page.fill('#forma-yaprak', '4'); await page.fill('#dis-kenar', '0'); await page.fill('#cilt-payi', '0');
  await page.selectOption('#olcek', 'sigdir'); await page.selectOption('#cikti-modu', 'tek');
  const sec = await epubSec(page, 'tr-mini.epub', tr);
  const pdf0 = await page.evaluate(([d]) => window.__e.donustur(d), [Array.from(tr)]);
  const s0 = await page.evaluate(([d]) => window.__e.incele(d), [pdf0]);
  const metin = bosluklu(s0.map((s) => s.ogeler.map((o) => o.str).join(' ')).join(' '));
  kontrol('B3', sec.kart === s0.length && s0.length >= 3, `${etiket}: trMini kart sayısı = PDF sayfa sayısı ≥ 3`, `kart ${sec.kart}, PDF ${s0.length}; bildirim: ${sec.bildirim}`);
  kontrol('B3', metin.includes(U.B3_CUMLE), `${etiket}: pdf.js metninde Türkçe cümle birebir`, metin.includes(U.B3_CUMLE) ? U.B3_CUMLE : metin.slice(0, 160));
  kontrol('B3', !metin.includes('�') && metin.includes('İ') && metin.includes('ı'), `${etiket}: U+FFFD yok; İ = U+0130 ve ı = U+0131 var`);
  kontrol('B3', /Birinci Bölüm/.test(bosluklu(s0[0].ogeler.map((o) => o.str).join(' '))) && !metin.includes('GIZLIMETIN') && s0.some((s) => /^YENISAYFA/.test(bosluklu(s.ogeler.map((o) => o.str).join(' ')))),
    `${etiket}: kapak atlandı (1. sayfa "Birinci Bölüm"), gizli paragraf yok, page-break-before yeni sayfa açtı`);
  const uyari = await page.textContent('#epub-uyari');
  kontrol('B3', /1 resim atlandı \(SVG, bozuk ya da bilinmeyen biçim\), 1 tablo düz metne çevrildi, 2 resim 300 dpi altında\./.test(uyari), `${etiket}: U1 uyarısı`, uyari.trim());
  // BD/O4: uyarı varken kullanıcıya görünür (kapalı "EPUB ayarları" bölümünde gizli kalmaz)
  kontrol('O4', await page.isVisible('#epub-uyari .uyari'), `${etiket}: U1 uyarısı görünür (isVisible('#epub-uyari .uyari'))`,
    `details açık: ${await page.evaluate(() => document.getElementById('epub-ayarlari').open)}`);

  // ---- B4 Vektör: resim yalnız resimli sayfalarda; Literata FontFile2; Standard 14 yok ----
  const y = await page.evaluate(([d]) => window.__e.yapi(d), [pdf0]);
  const metinliHepsi = s0.every((s) => s.ogeler.some((o) => o.str.trim()));
  kontrol('B4', metinliHepsi && y.resimli.filter((n) => n > 0).length <= 2 && y.resimli.reduce((a, b) => a + b, 0) === 2 && y.resimli.filter((n) => n === 0).length >= s0.length - 2,
    `${etiket}: her sayfada metin var; Image XObject yalnız 2 resimli sayfada, metin sayfalarında yok`, JSON.stringify(y.resimli));
  const tip0 = y.fontlar.filter((f) => f.alt === '/Type0');
  kontrol('B4', tip0.length > 0 && tip0.every((f) => /Literata/.test(f.ad)) && y.tanimlar.length === tip0.length && y.tanimlar.every(Boolean) && !y.fontlar.some((f) => f.alt === '/Type1'),
    `${etiket}: fontlar Literata (Type0 + FontFile2), Standard 14 yok`, JSON.stringify(tip0.map((f) => f.ad)));

  // ---- B5 + B6: dizilmiş çıktı (cilt 0) → ölçek 1; formalı 297×210, forma 4 ----
  const boylar = [...new Set(s0.flatMap((s) => s.ogeler.filter((o) => o.str.trim()).map((o) => Math.abs(o.a))))];
  const olcekBir = (sayfa) => sayfa.ogeler.filter((o) => o.str.trim()).every((o) => boylar.some((b) => Math.abs(Math.abs(o.a) / b - 1) <= 0.001));
  kontrol('B5', s0.every((s) => Math.abs(s.gen - 148) <= 0.5 && Math.abs(s.yuk - 210) <= 0.5), `${etiket}: cilt 0 / dış 0 → her sayfa 148×210 mm (±0,5)`, `${s0[0].gen.toFixed(2)}×${s0[0].yuk.toFixed(2)}`);
  async function dizilmisIndir(beklenenSayfa, olcu) {
    await page.waitForFunction(() => !document.getElementById('disa-aktar').disabled);
    const [indirme] = await Promise.all([page.waitForEvent('download'), page.click('#disa-aktar')]);
    const cikti = await readFile(await indirme.path());
    await page.waitForSelector('#cikti-onizleme[data-hazir="evet"]');
    const r = await page.evaluate(([d]) => window.__e.incele(d), [Array.from(cikti)]);
    kontrol('B6', /-dizilmis\.pdf$/.test(indirme.suggestedFilename()) && r.length === beklenenSayfa && r.every((s) => Math.abs(s.gen - 297) <= 0.5 && Math.abs(s.yuk - 210) <= 0.5),
      `${etiket}: ${olcu}: EPUB → formalı 297×210, forma 4 → ${indirme.suggestedFilename()}, ${beklenenSayfa} sayfa, önizleme hazır`, `${r.length} sayfa`);
    const tum = r.filter((s) => s.ogeler.some((o) => o.str.trim()));
    kontrol('B5', tum.length > 0 && tum.every(olcekBir), `${etiket}: ${olcu}: dizilmiş çıktıda ölçek 1 (metin a katsayısı kaynak boyutlarıyla ±0,001)`,
      tum.length ? JSON.stringify(tum[0].ogeler.filter((o) => o.str.trim()).slice(0, 3).map((o) => +Math.abs(o.a).toFixed(4))) + ' / kaynak ' + JSON.stringify(boylar.map((b) => +b.toFixed(4))) : 'metin yok');
  }
  await page.waitForFunction(() => document.querySelectorAll('#yaprak-onizleme .yaprak-kart').length > 0);
  await dizilmisIndir(Math.ceil(sec.kart / 16) * 8, 'cilt 0');
  // ölçü değişince "yeniden seçin" uyarısı
  await page.fill('#cilt-payi', '10');
  await page.waitForSelector('#eklenti-olcu-uyari', { timeout: 5000 });
  kontrol('B5', /EPUB bu ölçülerle dizilmişti/.test(await page.textContent('#eklenti-olcu-uyari')), `${etiket}: cilt payı değişince #eklenti-olcu-uyari görünür`);
  // cilt payı 10 ile yeniden yükle → sayfa 138×210, dizilmiş ölçek 1
  const sec10 = await epubSec(page, 'tr-mini.epub', tr);
  await page.waitForTimeout(100);
  kontrol('B5', (await page.locator('#eklenti-olcu-uyari').count()) === 0 && /138 × 210 mm/.test(await page.textContent('#kaynak-bilgi')),
    `${etiket}: cilt payı 10 ile yeniden yüklenince uyarı kalkar, kaynak 138 × 210 mm`, await page.textContent('#kaynak-bilgi'));
  const s10 = await page.evaluate(async ([d]) => window.__e.incele(await window.__e.donustur(d, { ciltPayi: 10 })), [Array.from(tr)]);
  kontrol('B5', s10.every((s) => Math.abs(s.gen - 138) <= 0.5 && Math.abs(s.yuk - 210) <= 0.5), `${etiket}: cilt payı 10 → her sayfa 138×210 mm (±0,5)`, `${s10[0].gen.toFixed(2)}×${s10[0].yuk.toFixed(2)}`);
  await dizilmisIndir(Math.ceil(sec10.kart / 16) * 8, 'cilt 10');
  await page.fill('#cilt-payi', '0');

  // ---- enMini: EPUB 2 + NCX + &nbsp; (text/html yedeği) ----
  await tazeSayfa(page, adres);
  const en = await epubSec(page, 'en-mini.epub', U.hazir.enMini());
  const enMetin = bosluklu((await page.evaluate(async ([d]) => window.__e.incele(await window.__e.donustur(d)), [Array.from(U.hazir.enMini())])).map((s) => s.ogeler.map((o) => o.str).join(' ')).join(' '));
  kontrol('A7', en.kart >= 1 && /Hello world, this is an English paragraph/.test(enMetin), `${etiket}: enMini (EPUB 2, NCX, DTD'siz &nbsp;) hatasız dönüşür`, `kart ${en.kart}; ${enMetin.slice(0, 60)}`);

  // ---- B7 DRM / fontGizli, B8 FXL, B9 bozuk / containerYok ----
  const hataDurumu = async (olcut, ad, bayt, mesaj) => {
    await tazeSayfa(page, adres);
    const r = await epubSec(page, ad, bayt);
    const kapali = await page.isDisabled('#disa-aktar');
    kontrol(olcut, r.bildirim.includes(mesaj) && r.kart === 0 && kapali, `${etiket}: ${ad}: Türkçe mesaj, kart 0, indirme kapalı`, r.bildirim);
  };
  await hataDurumu('B7', 'drm.epub', U.hazir.drm(), E_MESAJ.E3);
  await tazeSayfa(page, adres);
  const fg = await epubSec(page, 'font-gizli.epub', U.hazir.fontGizli());
  kontrol('B7', fg.kart >= 3 && !/açılamadı/.test(fg.bildirim), `${etiket}: fontGizli.epub (yalnız yazı tipi gizleme) DRM sayılmaz, dönüşür`, `kart ${fg.kart}; ${fg.bildirim}`);
  await hataDurumu('B8', 'fxl.epub', U.hazir.fxl(), E_MESAJ.E4);
  await hataDurumu('B9', 'bozuk.epub', U.hazir.bozuk(), E_MESAJ.E1);
  await hataDurumu('B9', 'container-yok.epub', U.hazir.containerYok(), E_MESAJ.E2);
}

// ------------------------------------------------------------------
// EPUB düzeltme testleri (kodlama dahil), her iki koşuda
// ------------------------------------------------------------------
// başlığı (IHDR) geçerli, IDAT'ı bozuk PNG
const BOZUK_PNG = Buffer.from('89504E470D0A1A0A0000000D49484452000000100000001008020000009091683600000010494441547801DEADBEEFDEADBEEFDEADBEEF00000000', 'hex');
// windows-1254 tek bayt kodları (Türkçe harfler)
const W1254 = { 'ğ': 0xf0, 'ı': 0xfd, 'İ': 0xdd, 'Ö': 0xd6, 'Ğ': 0xd0, 'Ü': 0xdc, 'Ş': 0xde, 'Ç': 0xc7, 'ü': 0xfc, 'ş': 0xfe, 'ö': 0xf6, 'ç': 0xe7 };
function w1254(s) { return Buffer.from([...s].map((c) => (W1254[c] !== undefined ? W1254[c] : c.charCodeAt(0)))); }

async function bdAkisi(page, adres, etiket) {
  const U = require('./epub-build.cjs');
  const paragraf = (n) => `<p>${U.paragrafMetni(U.rastgele(n), 60)}</p>`;

  // ---- O3: bozuk PNG'li EPUB dönüşür; U1'de 1 resim atlandı; yazı tipi uyarısı yok ----
  const bozukEpub = U.epub({ baslik: 'Bozuk Resim', bolumler: [{ ad: 'b.xhtml', xhtml: U.xhtml('<h1>Resimli Bölüm</h1>' + paragraf(1) + '<p><img src="r/bozuk.png" alt="bozuk"/></p>' + paragraf(2)) }],
    dosyalar: { 'r/bozuk.png': BOZUK_PNG } });
  await tazeSayfa(page, adres);
  const o3 = await epubSec(page, 'bozuk-resim.epub', bozukEpub);
  const u3 = (await page.textContent('#epub-uyari')).trim();
  kontrol('O3', o3.kart >= 1 && !/açılamadı/.test(o3.bildirim), `${etiket}: bozuk PNG'li EPUB dönüşür (kart ≥ 1, hata yok)`, `kart ${o3.kart}; ${o3.bildirim}`);
  kontrol('O3', /^1 resim atlandı/.test(u3) && !/Yazı tipi/.test(u3) && !/Cannot|undefined/.test(o3.bildirim + u3), `${etiket}: U1 "1 resim atlandı", yazı tipi uyarısı ve ham İngilizce hata yok`, u3);

  // ---- D4: EPUB uyarısı yeni (PDF) yüklemede temizlenir; bayat (yavaş) dönüşüm sonucu atılır ----
  await yardimcilariKur(page);
  await epubSec(page, 'tr-mini.epub', U.hazir.trMini()); // U1 uyarısı veren EPUB (1 SVG, 1 tablo)
  const onceUyari = (await page.textContent('#epub-uyari')).trim();
  const pdf8 = Buffer.from(await page.evaluate(async () => Array.from(await window.__t.sayiliPdf(8))));
  await page.setInputFiles('#pdf-dosya', { name: 'sekiz.pdf', mimeType: 'application/pdf', buffer: pdf8 });
  await page.waitForFunction(() => document.querySelectorAll('#kucuk-resimler .kart').length === 8);
  const kalanUyari = (await page.textContent('#epub-uyari')).trim();
  kontrol('D4', onceUyari !== '' && kalanUyari === '', `${etiket}: EPUB'dan sonra PDF yüklenince eski EPUB uyarısı temizlenir`, `önce: ${onceUyari.slice(0, 40) || '(boş)'}; sonra: ${kalanUyari || '(boş)'}`);
  await page.evaluate(async () => {
    const pdf3 = await window.__t.sayiliPdf(3);
    window.__yavas = { guncel: 'çağrılmadı' };
    window.KitapCilt.eklentiler.kaydet({ ad: 'Yavaş deneme', uzantilar: ['.yavas'], donustur: async (f, s) => {
      await new Promise((ok) => setTimeout(ok, 1500));
      window.__yavas.guncel = s.guncelMi ? s.guncelMi() : 'guncelMi yok';
      return pdf3;
    } });
  });
  await page.setInputFiles('#pdf-dosya', { name: 'a.yavas', mimeType: 'application/octet-stream', buffer: Buffer.from('yavas') });
  await page.setInputFiles('#pdf-dosya', { name: 'yeni-sekiz.pdf', mimeType: 'application/pdf', buffer: pdf8 });
  await page.waitForFunction(() => /yeni-sekiz\.pdf/.test(document.getElementById('kaynak-bilgi').textContent));
  await page.waitForFunction(() => window.__yavas.guncel !== 'çağrılmadı', null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const d4 = { kart: await page.locator('#kucuk-resimler .kart').count(), bilgi: await page.textContent('#kaynak-bilgi'), guncel: await page.evaluate(() => window.__yavas.guncel) };
  kontrol('D4', d4.kart === 8 && /yeni-sekiz\.pdf/.test(d4.bilgi) && d4.guncel === false, `${etiket}: yavaş dönüşüm sürerken seçilen PDF kalır; bayat sonuç atılır (guncelMi false)`, JSON.stringify(d4));

  // ---- D5: tablo hücresinde script/style/gizli metin yok; iç içe tablo satırı yinelenmez; satır içi önbellek sınırlı ----
  const tabloX = U.xhtml('<h1>Tablo</h1><table>' +
    '<tr><td>DIS1<script>KOTUSCRIPT()</script><style>.k{}</style><span style="display:none">GIZLISTIL</span><span hidden="hidden">GIZLIOZ</span></td><td>DIS2</td></tr>' +
    '<tr><td><table><tr><td>IC1</td><td>IC2</td></tr></table></td><td>DIS3</td></tr></table>' +
    Array.from({ length: 2600 }, (_, i) => `<span style="margin-left: ${i}px">s${i} </span>`).join(''));
  const tabloEpub = U.epub({ bolumler: [{ ad: 't.xhtml', xhtml: tabloX }] });
  const ir5 = await page.evaluate(([d]) => window.__e.ir(d, 'OEBPS/t.xhtml'), [Array.from(tabloEpub)]);
  const metin5 = ir5.bloklar.flatMap((b) => (b.parcalar || []).map((p) => p.metin || '')).join(' | ');
  const ic1 = (metin5.match(/IC1/g) || []).length;
  kontrol('D5', !/KOTUSCRIPT|GIZLISTIL|GIZLIOZ|\.k\{/.test(metin5) && /DIS1/.test(metin5) && ic1 === 1 && /IC2/.test(metin5) && /DIS3/.test(metin5),
    `${etiket}: tablo hücresinde script/style/gizli öğe yok; iç içe tablo satırı bir kez`, `IC1 ${ic1} kez; ${metin5.slice(0, 120)}`);
  kontrol('D5', typeof ir5.satirIci === 'number' && ir5.satirIci > 0 && ir5.satirIci <= 2000, `${etiket}: satır içi stil önbelleği dönüşüme özel ve ≤ 2000 girdi (2600 farklı style)`, String(ir5.satirIci));

  // ---- Kodlama: windows-1254 bildirimli XHTML doğru çözülür; desteklenmeyen kodlama U1'de bildirilir ----
  const trCumle = 'Iğdır ılık İstanbul; ÖĞÜŞÇ ğüşıöçİ';
  const xhtml1254 = (kod) => Buffer.concat([Buffer.from(`<?xml version="1.0" encoding="${kod}"?>\n<html xmlns="${U.NS.xhtml}" xml:lang="tr"><head><title>K</title></head><body><h1>Kodlama</h1><p>`), w1254(trCumle), Buffer.from('</p></body></html>')]);
  const kodEpub = U.epub({ bolumler: [{ ad: 'k.xhtml', xhtml: xhtml1254('windows-1254') }] });
  const irK = await page.evaluate(([d]) => window.__e.ir(d, 'OEBPS/k.xhtml'), [Array.from(kodEpub)]);
  const metinK = irK.bloklar.flatMap((b) => (b.parcalar || []).map((p) => p.metin || '')).join(' ');
  kontrol('KOD', metinK.includes(trCumle) && !metinK.includes('�'), `${etiket}: windows-1254 bildirimli XHTML Türkçe harflerle çözülür`, metinK.slice(0, 80));
  const kodYok = U.epub({ bolumler: [{ ad: 'k.xhtml', xhtml: xhtml1254('x-bilinmeyen-kod') }] });
  await tazeSayfa(page, adres);
  const ky = await epubSec(page, 'kodlama.epub', kodYok);
  const uK = (await page.textContent('#epub-uyari')).trim();
  kontrol('KOD', ky.kart >= 1 && /Desteklenmeyen karakter kodlaması \(x-bilinmeyen-kod\)/.test(uK) && await page.isVisible('#epub-uyari .uyari'),
    `${etiket}: desteklenmeyen kodlama U1'de bildirilir (görünür)`, uK);

  // ---- Madde 13: başarılı yüklemeden sonra hatalı dosya → önceki belge temizlenir, indirme kapalı (EPUB ve PDF) ----
  const dosyaSec = async (ad, mime, bayt) => {
    await page.evaluate(() => { const b = document.getElementById('bildirim'); b.textContent = ''; b.className = ''; });
    await page.setInputFiles('#pdf-dosya', { name: ad, mimeType: mime, buffer: bayt });
    await page.waitForFunction(() => { const b = document.getElementById('bildirim'); return b.classList.contains('hata') || / yüklendi /.test(b.textContent); }, null, { timeout: 90000 });
    await page.waitForTimeout(150); // guncelle() requestAnimationFrame ile çizer
    return { kart: await page.locator('#kucuk-resimler .kart').count(), bildirim: (await page.textContent('#bildirim')) || '',
      kapali: await page.isDisabled('#disa-aktar'), uyari: (await page.textContent('#epub-uyari')).trim(), bilgi: await page.textContent('#kaynak-bilgi') };
  };
  const olcuKur = async () => {
    await page.selectOption('#cilt-turu', 'formali');
    await page.fill('#kagit-gen', '297'); await page.fill('#kagit-yuk', '210');
    await page.fill('#kitap-gen', '148'); await page.fill('#kitap-yuk', '210');
    await page.fill('#forma-yaprak', '4'); await page.fill('#dis-kenar', '0'); await page.fill('#cilt-payi', '0');
  };
  await tazeSayfa(page, adres);
  await olcuKur();
  const iyiE = await dosyaSec('tr-mini.epub', EPUB_MIME, U.hazir.trMini());
  await page.waitForFunction(() => !document.getElementById('disa-aktar').disabled, null, { timeout: 20000 });
  const kotuE = await dosyaSec('bozuk.epub', EPUB_MIME, U.hazir.bozuk());
  kontrol('dosya-hatasi', iyiE.kart >= 3 && kotuE.kart === 0 && kotuE.kapali && kotuE.bildirim.includes(E_MESAJ.E1) && kotuE.uyari === '' && /açılamadı/.test(kotuE.bilgi),
    `${etiket}: trMini → bozuk.epub: kart 0, indirme kapalı, Türkçe E1, EPUB uyarısı temiz`, JSON.stringify({ once: iyiE.kart, kart: kotuE.kart, kapali: kotuE.kapali, bildirim: kotuE.bildirim, uyari: kotuE.uyari, bilgi: kotuE.bilgi }));
  await yardimcilariKur(page);
  const iyiP = await dosyaSec('sekiz.pdf', 'application/pdf', Buffer.from(await page.evaluate(async () => Array.from(await window.__t.sayiliPdf(8)))));
  await page.waitForFunction(() => !document.getElementById('disa-aktar').disabled, null, { timeout: 20000 });
  const bozukPdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 37 + 11) % 256))]);
  const kotuP = await dosyaSec('bozuk.pdf', 'application/pdf', bozukPdf);
  kontrol('dosya-hatasi', iyiP.kart === 8 && kotuP.kart === 0 && kotuP.kapali && /^Dosya açılamadı: dosya bozuk/.test(kotuP.bildirim) && !/Invalid|structure|Error/i.test(kotuP.bildirim),
    `${etiket}: geçerli PDF → bozuk PDF: kart 0, indirme kapalı, Türkçe hata`, JSON.stringify({ once: iyiP.kart, kart: kotuP.kart, kapali: kotuP.kapali, bildirim: kotuP.bildirim }));
}

async function epubPerformans(page, adres, etiket) {
  const U = require('./epub-build.cjs');
  const uzun = U.hazir.uzun();
  await tazeSayfa(page, adres);
  // önceki akıştan localStorage'da kalmış ölçü olmasın: A5, cilt payı ve dış kenar 0
  await page.fill('#kitap-gen', '148'); await page.fill('#kitap-yuk', '210'); await page.fill('#dis-kenar', '0'); await page.fill('#cilt-payi', '0');
  const bas = Date.now();
  const r = await epubSec(page, 'uzun.epub', uzun, 120000);
  const sure = (Date.now() - bas) / 1000;
  console.log(`bilgi: ${etiket}: uzun.epub (~90 000 kelime, ${uzun.length} bayt) dönüşüm ${sure.toFixed(1)} s, ${r.kart} sayfa`);
  kontrol('B14', r.kart > 100 && sure < 60, `${etiket}: uzun.epub (~90 bin kelime) dönüşümü < 60 s`, `${sure.toFixed(1)} s, ${r.kart} sayfa; ${r.bildirim}`);
}

function agDenetle(iz, yerelOnEk, etiket, olcut) {
  const disari = iz.istekler.filter((u) => !(u.startsWith(yerelOnEk) || u.startsWith('data:') || u.startsWith('blob:')));
  // file:// ve yerel sunucu dışındaki her istek (http/https dahil) izinsizdir
  kontrol(olcut, disari.length === 0, `${etiket}: dış ağ isteği yok (yalnız yerel istekler)`,
    disari.length ? JSON.stringify([...new Set(disari)]) : `${iz.istekler.length} istek, hepsi yerel`);
}

// ------------------------------------------------------------------
//: onay geçişi. Tauri'nin dialog eklentisi window.confirm'ü Promise döndüren işlevle ezer;
// eski `if (!confirm(...)) return;` kalıbı Promise'i "evet" sayıp onaysız silerdi. Her işlem için:
// (a) yerel confirm "hayır" (dialog.dismiss), (b) Tauri benzeri async confirm → false; ikisinde de veri değişmez.
// ------------------------------------------------------------------
async function onayAkisi(page, adres, iz, etiket) {
  const O = 'G5';
  const os = await import('node:os');
  const fsp = await import('node:fs/promises');
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.evaluate(() => { localStorage.removeItem('kitapCilt.v1'); localStorage.removeItem('kitapCilt.seciliKitap'); });
  await page.reload();
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.click('#sekme-dugme-surec');
  for (const ad of ['Onay Bir', 'Onay İki']) {
    await page.fill('#yk-ad', ad);
    await page.selectOption('#yk-tur', 'formali');
    await page.click('#yk-olustur');
    await page.waitForFunction((a) => document.querySelector('#kitap-detay h2') && document.querySelector('#kitap-detay h2').textContent === a, ad);
  }
  const ilk = await depoOku(page);
  kontrol(O, ilk && ilk.kitaplar.length === 2, `${etiket}: onay hazırlığı: 2 kitap`, ilk && ilk.kitaplar.length);
  const yedekYolu = join(await fsp.mkdtemp(join(os.tmpdir(), 'kc-onay-')), 'yedek.json');
  await fsp.writeFile(yedekYolu, JSON.stringify(Object.assign({}, ilk, { kitaplar: [ilk.kitaplar[0]] })));

  const asenkronConfirm = (yanit) => page.evaluate((y) => {
    window.__asilConfirm = window.__asilConfirm || window.confirm;
    window.__onaySayac = 0;
    window.confirm = async function () { window.__onaySayac += 1; return y; };
  }, yanit);
  const yerelConfirm = () => page.evaluate(() => { if (window.__asilConfirm) window.confirm = window.__asilConfirm; });
  const sakin = () => page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
  const adimSayisi = () => page.locator('#adimlar .adim').count();

  // her işlem: tetik() → önce/sonra veri karşılaştırması
  const islemler = [
    { ad: 'Kitabı sil', tetik: () => page.click('#kitap-sil') },
    { ad: 'Adımı çıkar', tetik: () => page.locator('#adimlar .adim-sil').first().click() },
    { ad: 'Tümünü temizle', tetik: () => page.click('#veri-temizle') },
    { ad: 'İçe aktar (değiştir)', tetik: () => page.setInputFiles('#json-ice', yedekYolu) },
  ];
  for (const is of islemler) {
    // (a) yerel confirm "hayır"
    const once = await depoOku(page);
    const adimOnce = await adimSayisi();
    iz.onaylar.length = 0;
    iz.onayRed = true;
    await is.tetik();
    for (let i = 0; i < 50 && iz.onaylar.length === 0; i++) await sakin();
    await sakin();
    iz.onayRed = false;
    const sonraA = await depoOku(page);
    kontrol(O, iz.onaylar.length === 1 && isDeepStrictEqual(sonraA, once) && (await adimSayisi()) === adimOnce,
      `${etiket}: ${is.ad}: yerel onay "hayır" → veri değişmedi`, `onay penceresi ${iz.onaylar.length}, kitap ${sonraA && sonraA.kitaplar.length}`);
    // (b) Tauri dialog eklentisi benzeri: confirm Promise<false> döner
    await asenkronConfirm(false);
    await is.tetik();
    await page.waitForFunction(() => window.__onaySayac > 0, null, { timeout: 10000 }).catch(() => {});
    await sakin();
    const sayac = await page.evaluate(() => window.__onaySayac);
    await yerelConfirm();
    const sonraB = await depoOku(page);
    kontrol(O, sayac === 1 && isDeepStrictEqual(sonraB, once) && (await adimSayisi()) === adimOnce,
      `${etiket}: ${is.ad}: Promise döndüren onay "hayır" (Tauri benzeri) → veri değişmedi`, `onay çağrısı ${sayac}, kitap ${sonraB && sonraB.kitaplar.length}`);
  }

  // "evet" yolları: async true ile kitap silinir; yerel "evet" ile içe aktarma değiştirir
  const secili = await page.textContent('#kitap-detay h2');
  await asenkronConfirm(true);
  await page.click('#kitap-sil');
  await page.waitForFunction(() => document.querySelectorAll('#kitap-listesi li').length === 1, null, { timeout: 10000 }).catch(() => {});
  await yerelConfirm();
  const sil = await depoOku(page);
  kontrol(O, sil.kitaplar.length === 1 && sil.kitaplar[0].ad !== secili, `${etiket}: Kitabı sil: Promise döndüren onay "evet" → seçili kitap silindi`, `${secili}; kalan ${sil.kitaplar.map((k) => k.ad).join(', ')}`);
  const yedek2 = join(dirname(yedekYolu), 'yedek2.json');
  await fsp.writeFile(yedek2, JSON.stringify(ilk));
  iz.onaylar.length = 0;
  await page.setInputFiles('#json-ice', yedek2);
  await page.waitForFunction(() => document.querySelectorAll('#kitap-listesi li').length === 2, null, { timeout: 10000 }).catch(() => {});
  const ice = await depoOku(page);
  kontrol(O, iz.onaylar.length === 1 && isDeepStrictEqual(ice, ilk), `${etiket}: İçe aktar: yerel onay "evet" → veri yedekle değişti`, `onay penceresi ${iz.onaylar.length}, kitap ${ice.kitaplar.length}`);

  // D9: Adım çıkar "evet" (Promise döndüren onay, Tauri benzeri) → seçili kitabın ilk adımı çıkar
  const adimKitap = await page.textContent('#kitap-detay h2');
  const adimOnce = await adimSayisi();
  const adimAdlari = (v) => (v.kitaplar.find((k) => k.ad === adimKitap) || { adimlar: [] }).adimlar.map((a) => a.ad);
  const ilkAdim = adimAdlari(await depoOku(page));
  await asenkronConfirm(true);
  await page.locator('#adimlar .adim-sil').first().click();
  await page.waitForFunction((n) => document.querySelectorAll('#adimlar .adim').length === n - 1, adimOnce, { timeout: 10000 }).catch(() => {});
  const adimSayac = await page.evaluate(() => window.__onaySayac);
  await yerelConfirm();
  const sonrakiAdim = adimAdlari(await depoOku(page));
  kontrol('onay', adimSayac === 1 && (await adimSayisi()) === adimOnce - 1 && isDeepStrictEqual(sonrakiAdim, ilkAdim.slice(1)),
    `${etiket}: Adımı çıkar: Promise döndüren onay "evet" → ilk adım çıktı`, `onay çağrısı ${adimSayac}, adım ${adimOnce} → ${await adimSayisi()}`);

  // D9: Tümünü temizle yerel onay "evet" → bütün süreç verisi silinir
  iz.onaylar.length = 0;
  await page.click('#veri-temizle');
  await page.waitForFunction(() => document.querySelectorAll('#kitap-listesi li').length === 0, null, { timeout: 10000 }).catch(() => {});
  const temiz = await depoOku(page);
  kontrol('onay', iz.onaylar.length === 1 && (!temiz || temiz.kitaplar.length === 0) && (await page.locator('#kitap-listesi li').count()) === 0,
    `${etiket}: Tümünü temizle: yerel onay "evet" → bütün kitaplar silindi`, `onay penceresi ${iz.onaylar.length}, kitap ${temiz ? temiz.kitaplar.length : 0}`);
  await fsp.rm(dirname(yedekYolu), { recursive: true, force: true });
}

//: sayfaya dosya bırakma PDF'i açar ve sayfadan ayrılmaz; ızgara içi sürükleme çalışır.
async function birakmaAkisi(page, adres, etiket) {
  const O = 'G8';
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.click('#sekme-dugme-surec');
  const pdf = await testPdfUret(page);
  const sonuc = await page.evaluate((dizi) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(dizi)], 'birak.pdf', { type: 'application/pdf' }));
    const hedef = document.querySelector('main') || document.body;
    const ov = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
    hedef.dispatchEvent(ov);
    const dr = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    hedef.dispatchEvent(dr);
    return { ov: ov.defaultPrevented, dr: dr.defaultPrevented };
  }, Array.from(pdf));
  await page.waitForFunction(() => document.querySelectorAll('#kucuk-resimler .kart').length === 37, null, { timeout: 30000 }).catch(() => {});
  const kart = await page.locator('#kucuk-resimler .kart').count();
  const bilgi = (await page.textContent('#kaynak-bilgi')) || '';
  const sekme = await page.getAttribute('#sekme-dugme-duzenle', 'aria-selected');
  kontrol(O, sonuc.ov && sonuc.dr && kart === 37 && /birak\.pdf/.test(bilgi) && sekme === 'true' && page.url() === adres,
    `${etiket}: sayfaya bırakılan PDF açıldı, Düzenle sekmesine geçildi, sayfadan ayrılmadı`, JSON.stringify({ sonuc, kart, sekme, bilgi: bilgi.slice(0, 60) }));

  // ızgara içi sürükleme: 1. kartı 3. kartın sağ yarısına bırak → sıra 2, 3, 1, 4…
  const kaynakSira = () => page.$$eval('#kucuk-resimler .kart', (l) => l.slice(0, 4).map((k) => k.getAttribute('data-id')));
  const once = await kaynakSira();
  const hedef = page.locator('#kucuk-resimler .kart').nth(2);
  const kutu = await hedef.boundingBox();
  await page.locator('#kucuk-resimler .kart').nth(0).dragTo(hedef, { targetPosition: { x: Math.round(kutu.width * 0.8), y: Math.round(kutu.height / 2) } });
  await page.waitForTimeout(200);
  const sonra = await kaynakSira();
  kontrol(O, JSON.stringify(sonra.slice(0, 3)) === JSON.stringify([once[1], once[2], once[0]]),
    `${etiket}: ızgara içi sürükleme (1. sayfa → 3.'nün arkası) çalışır, dosya bırakma işleyicisi karışmaz`, JSON.stringify({ once, sonra }));
}

// ------------------------------------------------------------------
//: CSP ve Object.prototype dondurma; içe aktarmada platform.dosyaSec sonucu.
// ------------------------------------------------------------------
async function m1DuzeltmeAkisi(page, adres, iz, etiket, cspSinamasi) {
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  const donuk = await page.evaluate(() => ({ donuk: Object.isFrozen(Object.prototype), pdfLib: !!window.PDFLib, pdfjs: !!window.pdfjsLib }));
  kontrol('guvenlik', donuk.donuk && donuk.pdfLib && donuk.pdfjs, `${etiket}: Object.prototype dondurulmuş, pdf-lib ve pdf.js yüklü`, JSON.stringify(donuk));

  if (cspSinamasi) {
    // Ayrı sekme: CSP fetch'i ağa çıkmadan reddetmeli. Güvenlik ağı: example.com isteği Playwright'ta kesilir
    // (CSP yoksa fetch yine reddedilir ama ihlal olayı olmaz → KALDI; gerçek ağa istek çıkmaz).
    const p2 = await page.context().newPage();
    let kesilen = 0;
    await p2.route('https://example.com/**', (r) => { kesilen += 1; return r.abort(); });
    await p2.goto(adres);
    await p2.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
    const s = await p2.evaluate(async () => {
      let ihlal = null;
      document.addEventListener('securitypolicyviolation', (e) => { ihlal = ihlal || e.violatedDirective; });
      let reddedildi = false;
      try { await fetch('https://example.com/'); } catch { reddedildi = true; }
      await new Promise((r) => setTimeout(r, 200));
      return { reddedildi, ihlal };
    });
    await p2.close();
    kontrol('guvenlik', s.reddedildi && /^connect-src/.test(s.ihlal || '') && kesilen === 0,
      `${etiket}: CSP etkin: fetch('https://example.com') connect-src ile reddedildi, istek ağa çıkmadı`, JSON.stringify({ ...s, kesilen, csp: TAURI_CSP ? 'var' : 'yok' }));
  }

  // O4: dosyaSec File döndürürse (yerel diyalog) içe aktarma çalışır; reddedilirse bildirim, işlenmemiş red yok.
  await page.evaluate(() => { localStorage.removeItem('kitapCilt.v1'); localStorage.removeItem('kitapCilt.seciliKitap'); });
  await page.reload();
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.click('#sekme-dugme-surec');
  await page.fill('#yk-ad', 'Seçici Kitap');
  await page.selectOption('#yk-tur', 'formali');
  await page.click('#yk-olustur');
  await page.waitForFunction(() => document.querySelectorAll('#kitap-listesi li').length === 1);
  const yedek = await depoOku(page);
  await page.evaluate(() => { localStorage.removeItem('kitapCilt.v1'); localStorage.removeItem('kitapCilt.seciliKitap'); });
  await page.reload();
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.click('#sekme-dugme-surec');
  const hataOnce = iz.hatalar.length;
  await page.evaluate((json) => {
    const P = window.KitapCilt.platform;
    window.__asilDosyaSec = P.dosyaSec;
    window.__secimSayac = 0;
    P.dosyaSec = function () { window.__secimSayac += 1; return Promise.resolve(new File([json], 'yedek.json', { type: 'application/json' })); };
  }, JSON.stringify(yedek));
  await page.click('#json-ice-dugme');
  await page.waitForFunction(() => document.querySelectorAll('#kitap-listesi li').length === 1, null, { timeout: 10000 }).catch(() => {});
  const ice = await depoOku(page);
  const secim1 = await page.evaluate(() => window.__secimSayac);
  kontrol('ice-aktar', secim1 === 1 && isDeepStrictEqual(ice, yedek), `${etiket}: içe aktar: dosyaSec File döndürünce yedek içe aktarıldı`,
    `seçici ${secim1}, kitap ${ice ? ice.kitaplar.length : 0}`);

  await page.evaluate(() => { window.KitapCilt.platform.dosyaSec = function () { return Promise.reject(new Error('seçici açılamadı')); }; });
  await page.click('#json-ice-dugme');
  await page.waitForFunction(() => /İçe aktarılamadı: seçici açılamadı/.test(document.getElementById('bildirim').textContent), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  const bildirim = await page.textContent('#bildirim');
  const sonra = await depoOku(page);
  kontrol('ice-aktar', /İçe aktarılamadı: seçici açılamadı/.test(bildirim) && iz.hatalar.length === hataOnce && isDeepStrictEqual(sonra, yedek),
    `${etiket}: içe aktar: dosyaSec reddi bildirime gider, işlenmemiş hata yok, veri değişmez`, `bildirim: ${bildirim}; yeni konsol hatası ${iz.hatalar.length - hataOnce}`);
  await page.evaluate(() => { window.KitapCilt.platform.dosyaSec = window.__asilDosyaSec; });
}

// ------------------------------------------------------------------
// klasör paketi EPUB'un tarayıcı sıkıştırması ("<ad>.epub.zip"; Safari/WebKit Apple Kitaplar klasör paketini
// böyle verir): tek üst klasör öneki atılır, içerik sıradan EPUB gibi işlenir. Her iki koşuda.
// ------------------------------------------------------------------
async function onekliEpubZip(U, epubBayt, onek, ekler) {
  const Z = require('../js/plugins/epub/zip.js');
  const z = Z.oku(new Uint8Array(epubBayt));
  const g = [];
  for (const a of z.adlar()) g.push({ ad: onek + a, veri: Buffer.from(await z.ac(a)), yontem: 8 }); // WebKit: hepsi deflate
  return U.zipUret([{ ad: onek, veri: '', yontem: 0 }].concat(g, ekler || []));
}

function klasorFixtureZip(U, onek) {
  const kok = join(BURASI, 'fixtures', 'folder-package.epub');
  const adlar = [];
  (function gez(d, on) {
    for (const g of readdirSync(d, { withFileTypes: true })) {
      if (g.name.startsWith('.')) continue;
      if (g.isDirectory()) gez(join(d, g.name), on + g.name + '/'); else adlar.push(on + g.name);
    }
  })(kok, '');
  adlar.sort();
  return U.zipUret(adlar.map((a) => ({ ad: onek + a, veri: readFileSync(join(kok, ...a.split('/'))), yontem: 8 })));
}

async function m2EpubZipAkisi(page, adres, etiket) {
  const U = require('./epub-build.cjs');
  await tazeSayfa(page, adres);
  await page.selectOption('#cilt-turu', 'formali');
  const tr = U.hazir.trMini();
  const beklenen = (await page.evaluate(async ([d]) => window.__e.incele(await window.__e.donustur(d)), [Array.from(tr)])).length;
  const zipli = await onekliEpubZip(U, tr, 'tr-mini.epub/', [
    { ad: '__MACOSX/tr-mini.epub/._mimetype', veri: 'x' },
    { ad: 'tr-mini.epub/.DS_Store', veri: 'x' },
  ]);
  await page.evaluate(() => { const b = document.getElementById('bildirim'); b.textContent = ''; b.className = ''; });
  await page.setInputFiles('#pdf-dosya', { name: 'tr-mini.epub.zip', mimeType: 'application/zip', buffer: zipli });
  await page.waitForFunction(() => { const b = document.getElementById('bildirim'); return b.classList.contains('hata') || / yüklendi /.test(b.textContent); }, null, { timeout: 90000 });
  const kart = await page.locator('#kucuk-resimler .kart').count();
  const bildirim = (await page.textContent('#bildirim')) || '';
  const bilgi = (await page.textContent('#kaynak-bilgi')) || '';
  kontrol('dosya', kart === beklenen && beklenen >= 3 && /^tr-mini\.pdf yüklendi/.test(bildirim) && /^tr-mini\.pdf — /.test(bilgi),
    `${etiket}: .epub.zip (tek üst klasör, deflate, __MACOSX + .DS_Store) sıradan EPUB gibi dönüşür; ad tr-mini.pdf`, `kart ${kart}/${beklenen}; ${bildirim}; ${bilgi}`);
  await page.waitForFunction(() => !document.getElementById('disa-aktar').disabled);
  const [indirme] = await Promise.all([page.waitForEvent('download'), page.click('#disa-aktar')]);
  kontrol('dosya', indirme.suggestedFilename() === 'tr-mini-dizilmis.pdf', `${etiket}: .epub.zip'ten dizilmiş çıktı adı tr-mini-dizilmis.pdf (".epub.zip" atıldı)`, indirme.suggestedFilename());

  // repo fixture'ı (sentetik klasör paketi) klasör ZIP'i olarak: dönüşür, metin PDF'te
  const fz = klasorFixtureZip(U, 'folder-package.epub/');
  const metin = await page.evaluate(async ([d]) => {
    const f = new File([new Uint8Array(d)], 'folder-package.epub.zip', { type: 'application/zip' });
    const pdf = await window.KitapCilt.epub.donustur(f, { kitapGen: 148, kitapYuk: 210, ciltPayi: 0, disKenar: 0 });
    return (await window.__e.incele(Array.from(pdf))).map((s) => s.ogeler.map((o) => o.str).join(' ')).join(' ');
  }, [Array.from(fz)]).then(bosluklu);
  kontrol('dosya', /KLASORPAKETI/.test(metin) && /Birinci Bölüm/.test(metin) && !metin.includes('�'),
    `${etiket}: app/test/fixtures/folder-package.epub (klasör ZIP'i) dönüşür; iki bölümün metni PDF'te`,
    JSON.stringify({ isaret: /KLASORPAKETI/.test(metin), bolum: /Birinci Bölüm/.test(metin), fffd: metin.includes('�'), bas: metin.slice(0, 60) }));

  // kusurlu: iki üst klasör → önek atılmaz → E2 (container yok); kart 0, indirme kapalı
  await tazeSayfa(page, adres);
  const iki = await onekliEpubZip(U, tr, 'A.epub/', [{ ad: 'B/okubeni.txt', veri: 'x' }]);
  const r = await epubSec(page, 'iki-klasor.epub.zip', iki);
  kontrol('dosya', r.bildirim.includes(E_MESAJ.E2) && r.kart === 0 && await page.isDisabled('#disa-aktar'),
    `${etiket}: iki üst klasörlü .epub.zip: E2 Türkçe mesaj, kart 0, indirme kapalı`, r.bildirim);
}

// ------------------------------------------------------------------
// Tauri benzetimi: sahte window.__TAURI__ (init betiği) ile platform-tauri.js gerçek sayfada çalışır.
// Dizilmiş PDF ve JSON yedeği yerel Kaydet penceresinden (sahte dosya_kaydet) geçer: vazgeçilince "kaydedilmedi",
// yazılınca gerçek yol; tarayıcı indirmesi hiç başlamaz. Açılışta otomatik yedek geri yüklenir; değişiklik yedeklenir.
// ------------------------------------------------------------------
const SAHTE_TAURI = `(() => {
  const kayit = (window.__sahte = { cagri: [], kaydetYanit: null, kaydetSira: null, kaydetHata: null, kaydetKapi: null,
    yedek: sessionStorage.getItem('sahteYedek') || '{"surum":1,"kitaplar":[]}', dinleyici: {}, acYanit: null, tablo: {}, bekleyen: [] });
  const bayt = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
  // Rust'ın initialization_script'i (i18n::baslangic_betigi): sistem dili sayfa betiklerinden önce
  Object.defineProperty(window, '__KC_DIL__', { value: Object.freeze({ sistem: sessionStorage.getItem('sahteSistem') || 'tr' }) });
  window.__TAURI__ = {
    core: { invoke: async (komut, arg, secenek) => {
      kayit.cagri.push({ komut, ad: secenek && secenek.headers ? decodeURIComponent(secenek.headers['x-ad']) : null,
        tur: secenek && secenek.headers ? secenek.headers['x-tur'] : null, boyut: arg && arg.byteLength, json: arg && arg.json,
        amac: arg && arg.amac, kimlik: arg && arg.kimlik, oturum: arg && arg.oturum, sira: arg && arg.sira, zaman: Date.now() });
      if (komut === 'dosya_kaydet') {
        if (kayit.kaydetKapi) await kayit.kaydetKapi;
        if (kayit.kaydetHata) throw kayit.kaydetHata;
        const y = kayit.kaydetSira ? kayit.kaydetSira.shift() : kayit.kaydetYanit;
        return y ? { ad: y.split('/').pop(), yol: y } : null;
      }
      // yazdırma (Rust yazdir: true = yazdırıldı, false = vazgeçildi; dize/Error = Rust hatası) ve Önizleme'de Aç
      if (komut === 'yazdir') {
        kayit.cagri[kayit.cagri.length - 1].notAn = (document.getElementById('bildirim') || {}).textContent;
        if (kayit.yazdirKapi) await kayit.yazdirKapi;
        const y = kayit.yazdirSira && kayit.yazdirSira.length ? kayit.yazdirSira.shift() : true;
        if (typeof y !== 'boolean') throw y;
        return y;
      }
      if (komut === 'onizlemede_ac') {
        const y = kayit.onizlemeSira && kayit.onizlemeSira.length ? kayit.onizlemeSira.shift() : null;
        if (y) throw y;
        return decodeURIComponent(secenek.headers['x-ad']);
      }
      if (komut === 'dosya_ac') return kayit.acYanit;
      if (komut === 'dosya_oku') {
        const b = kayit.tablo[arg.kimlik];
        delete kayit.tablo[arg.kimlik]; // Rust'taki gibi tek kullanımlık kimlik
        if (!b) throw 'BILINMEYEN: bu kimlikle açılmış dosya yok';
        return bayt(b);
      }
      if (komut === 'veri_oku') return kayit.yedek;
      if (komut === 'veri_yedekle') { kayit.sonYedek = arg.json; return null; }
      if (komut === 'bekleyen_acilanlar') { const k = kayit.bekleyen; kayit.bekleyen = []; return k; }
      if (komut === 'son_acilanlar') return [];
      // sistem: Rust'ın NSLocale + Apple kuralıyla bulduğu sistem dili (benzetimde öntanımlı tr = tr-TR tarayıcı)
      // dil_oku anındaki (Rust kararı gelmeden önceki, ilk kare) arayüz dili
      if (komut === 'dil_oku' && !kayit.ilkKare) kayit.ilkKare = { lang: document.documentElement.lang, sekme: (document.getElementById('sekme-dugme-duzenle') || {}).textContent };
      if (komut === 'dil_oku') return { kod: sessionStorage.getItem('sahteDilKod') || 'tr', secim: sessionStorage.getItem('sahteDilSecim') || 'sistem', sistem: sessionStorage.getItem('sahteSistem') || 'tr' };
      if (komut === 'dil_ayarla') {
        kayit.dilAyar = (kayit.dilAyar || []).concat([[arg.kod, arg.secim]]);
        sessionStorage.setItem('sahteDilKod', arg.kod);
        if (arg.secim === 'sistem') sessionStorage.removeItem('sahteDilSecim'); else sessionStorage.setItem('sahteDilSecim', arg.secim);
        return null;
      }
      throw new Error('beklenmeyen komut: ' + komut);
    } },
    event: { listen: async (ad, f) => { kayit.dinleyici[ad] = f; return () => {}; } },
    // yerel onay (dialog eklentisi): soru kaydedilir; yanıt askSira'dan (yoksa evet)
    dialog: { ask: async (m) => { (kayit.sorular = kayit.sorular || []).push(m); return kayit.askSira && kayit.askSira.length ? kayit.askSira.shift() : true; } },
  };
})();`;

async function m2TauriBenzetimi(page, adres, etiket) {
  await page.addInitScript({ content: SAHTE_TAURI });
  const bildirimTemizle = () => page.evaluate(() => { const b = document.getElementById('bildirim'); b.textContent = ''; b.className = ''; });
  // O2: localStorage boş + yedek boş (kasıtlı temizlik sonrası): geri yüklenmez, "geri yüklendi" bildirimi çıkmaz
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.waitForTimeout(500);
  const bos = await page.evaluate(() => ({ ad: window.KitapCilt.platform.ad, dugme: document.getElementById('disa-aktar').textContent,
    ls: localStorage.getItem('kitapCilt.v1'), bildirim: document.getElementById('bildirim').textContent }));
  kontrol('dosya', bos.ad === 'tauri' && bos.dugme === "Dizilmiş PDF'i kaydet…" && bos.ls === null && !/geri yüklendi/.test(bos.bildirim),
    `${etiket}: platform tauri; Kaydet düğmesi metni; BOŞ yedek geri yüklenmedi, "geri yüklendi" bildirimi yok (O2)`, JSON.stringify(bos));
  // dolu yedek, boş localStorage: geri yüklenir ve bildirilir
  const doluYedek = JSON.stringify({ surum: 1, kitaplar: [{ id: 'k-geri', ad: 'Geri Gelen Kitap', ciltTuru: 'tek', adimlar: [] }] });
  await page.evaluate((y) => { sessionStorage.setItem('sahteYedek', y); localStorage.clear(); }, doluYedek);
  await page.reload();
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  const acilis = await page.evaluate(() => localStorage.getItem('kitapCilt.v1'));
  kontrol('dosya', acilis === doluYedek, `${etiket}: boş localStorage dolu otomatik yedekten geri yüklendi`, String(acilis));
  await page.waitForFunction(() => /otomatik yedekten geri yüklendi/.test(document.getElementById('bildirim').textContent), null, { timeout: 5000 })
    .then(() => kontrol('dosya', true, `${etiket}: "otomatik yedekten geri yüklendi" bildirimi`), () => kontrol('dosya', false, `${etiket}: "otomatik yedekten geri yüklendi" bildirimi`));

  let indirmeSayisi = 0;
  page.on('download', () => { indirmeSayisi += 1; });
  const pdf = await testPdfUret(page);
  const pdf64 = pdf.toString('base64');
  await page.click('#sekme-dugme-duzenle');
  await page.selectOption('#cilt-turu', 'formali');
  // D11: yerel Aç penceresi → dosya_ac {amac: belge} → dosya_oku {kimlik} ham ArrayBuffer → File → yüklenir
  await page.evaluate((b) => { window.__sahte.acYanit = { kimlik: 'k-ac-1', ad: 'test-37.pdf', tur: 'pdf' }; window.__sahte.tablo['k-ac-1'] = b; }, pdf64);
  await bildirimTemizle();
  await page.click('#pdf-sec');
  const acildi = await page.waitForFunction(() => !document.getElementById('disa-aktar').disabled, null, { timeout: 30000 }).then(() => true, () => false);
  const ac = await page.evaluate(() => ({ bildirim: document.getElementById('bildirim').textContent,
    cagri: window.__sahte.cagri.filter((c) => c.komut === 'dosya_ac' || c.komut === 'dosya_oku').map((c) => [c.komut, c.amac || c.kimlik]),
    kalan: Object.keys(window.__sahte.tablo).length }));
  kontrol('dosya', /test-37\.pdf yüklendi \(37 sayfa\)/.test(ac.bildirim) && JSON.stringify(ac.cagri) === '[["dosya_ac","belge"],["dosya_oku","k-ac-1"]]' && ac.kalan === 0,
    `${etiket}: D11 yerel Aç → dosya_ac + dosya_oku (ham ArrayBuffer) → 37 sayfa yüklendi`, JSON.stringify(ac));
  if (!acildi) { // akışın geri kalanı sınansın diye PDF gizli girdiyle yüklenir (yukarıdaki kontrol zaten KALDI)
    await page.setInputFiles('#pdf-dosya', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.waitForFunction(() => !document.getElementById('disa-aktar').disabled, null, { timeout: 30000 });
  }
  async function disaAktarBildirim() {
    await bildirimTemizle();
    await page.click('#disa-aktar');
    await page.waitForFunction(() => /Kaydedildi|kaydedilmedi|kaydedilemedi/.test(document.getElementById('bildirim').textContent), null, { timeout: 30000 });
    return { metin: await page.textContent('#bildirim'), hata: await page.evaluate(() => document.getElementById('bildirim').classList.contains('hata')) };
  }
  // vazgeç
  const vaz = await disaAktarBildirim();
  const c1 = await page.evaluate(() => window.__sahte.cagri.filter((c) => c.komut === 'dosya_kaydet'));
  kontrol('dosya', /^Dizilmiş PDF kaydedilmedi/.test(vaz.metin) && vaz.hata && !/hazır/.test(vaz.metin) && c1.length === 1 && c1[0].ad === 'test-37-dizilmis.pdf' && c1[0].tur === 'pdf' && c1[0].boyut > 1000,
    `${etiket}: D7 Kaydet'te vazgeç → "kaydedilmedi" (hata), "hazır" yok; dosya_kaydet ham bayt + önerilen ad`, `${vaz.metin} / ${JSON.stringify(c1)}`);
  // yaz
  await page.evaluate(() => { window.__sahte.kaydetYanit = '/Users/deneme/Masaüstü/test-37-dizilmis.pdf'; });
  const yaz = await disaAktarBildirim();
  kontrol('dosya', yaz.metin === 'Kaydedildi: /Users/deneme/Masaüstü/test-37-dizilmis.pdf (24 yüz).' && !yaz.hata,
    `${etiket}: D7 Kaydet'te yazıldı → gerçek yol ile başarı bildirimi`, yaz.metin);
  // D11 hatali dalı: Kaydet yazamadı → "kaydedilemedi: <Rust hatası>" (hata), başarı yok
  await page.evaluate(() => { window.__sahte.kaydetHata = 'yazılamadı: Operation not permitted (os error 1)'; });
  const hat = await disaAktarBildirim();
  await page.evaluate(() => { window.__sahte.kaydetHata = null; });
  kontrol('dosya', hat.metin === 'test-37-dizilmis.pdf kaydedilemedi: yazılamadı: Operation not permitted (os error 1)' && hat.hata,
    `${etiket}: D11 Kaydet hatası → "kaydedilemedi" + Rust hata metni (hata stili)`, hat.metin);
  // D10: Kaydet penceresi açıkken ⌘S → yok sayılır (ikinci pencere yok, "Önce bir PDF" yok); sonra sonuç bildirilir
  await page.evaluate(() => { const s = window.__sahte; s.kaydetKapi = new Promise((r) => { s.kapiAc = r; }); s.cagri.length = 0; });
  await bildirimTemizle();
  await page.click('#disa-aktar');
  await page.waitForFunction(() => window.__sahte.cagri.some((c) => c.komut === 'dosya_kaydet'), null, { timeout: 30000 });
  const acik = await page.evaluate(() => { window.KitapCilt.platform.menuOlayi('dosya-kaydet'); return { bildirim: document.getElementById('bildirim').textContent,
    mesgul: document.getElementById('disa-aktar').getAttribute('aria-busy') }; });
  await page.evaluate(() => { const s = window.__sahte; s.kaydetKapi = null; s.kapiAc(); });
  await page.waitForFunction(() => /Kaydedildi/.test(document.getElementById('bildirim').textContent), null, { timeout: 30000 });
  const sonra = await page.evaluate(() => ({ kaydet: window.__sahte.cagri.filter((c) => c.komut === 'dosya_kaydet').length,
    mesgul: document.getElementById('disa-aktar').getAttribute('aria-busy'), kapali: document.getElementById('disa-aktar').disabled }));
  kontrol('dosya', acik.mesgul === 'true' && !/Önce bir PDF/.test(acik.bildirim) && sonra.kaydet === 1 && sonra.mesgul === null && !sonra.kapali,
    `${etiket}: D10 Kaydet penceresi açıkken ⌘S yok sayıldı (tek pencere, yanlış bildirim yok); bitince düğme serbest`, JSON.stringify({ acik, sonra }));
  // D9: iki PDF modunda önler yazıldı, arkalar vazgeçildi → yalnız yazılanın yüz sayısı
  await page.selectOption('#cikti-modu', 'ikili');
  await page.waitForFunction(() => !document.getElementById('disa-aktar').disabled);
  await page.evaluate(() => { window.__sahte.cagri.length = 0; window.__sahte.kaydetSira = ['/Users/deneme/Masaüstü/test-37-onler.pdf', null]; });
  const ikili = await disaAktarBildirim();
  await page.evaluate(() => { window.__sahte.kaydetSira = null; });
  const c2 = await page.evaluate(() => window.__sahte.cagri.filter((c) => c.komut === 'dosya_kaydet').map((c) => c.ad));
  kontrol('dosya', c2.length === 2 && /-onler\.pdf$/.test(c2[0]) && /-arkalar\.pdf$/.test(c2[1]),
    `${etiket}: iki PDF modu → iki Kaydet penceresi sırayla (önler, arkalar)`, JSON.stringify(c2));
  kontrol('dosya', ikili.metin === 'Kaydedildi: /Users/deneme/Masaüstü/test-37-onler.pdf (12 yüz). Kaydedilmedi (vazgeçildi): test-37-arkalar.pdf.' && ikili.hata,
    `${etiket}: D9 kısmi kayıt → yalnız yazılan dosyanın yüz sayısı (12, toplam 24 değil)`, ikili.metin);
  await page.selectOption('#cikti-modu', 'tek');
  // D11: Dock/Finder'dan açılış: dosya-acildi olayı → bekleyen_acilanlar → dosya_oku → yüklenir; okunamayan bildirilir
  await page.click('#sekme-dugme-surec');
  await page.evaluate((b) => { const s = window.__sahte; s.cagri.length = 0; s.tablo['k-dock-1'] = b;
    s.bekleyen = [{ kimlik: 'k-dock-1', ad: 'dock-37.pdf', tur: 'pdf' }]; }, pdf64);
  await bildirimTemizle();
  await page.evaluate(() => window.__sahte.dinleyici['dosya-acildi']({ payload: null }));
  await page.waitForFunction(() => /dock-37\.pdf yüklendi \(37 sayfa\)/.test(document.getElementById('bildirim').textContent), null, { timeout: 30000 })
    .catch(() => {});
  const dock = await page.evaluate(() => ({ bildirim: document.getElementById('bildirim').textContent,
    duzenle: !document.getElementById('sekme-duzenle').hidden, cagri: window.__sahte.cagri.map((c) => c.komut + (c.kimlik ? ':' + c.kimlik : '')) }));
  kontrol('dosya', /dock-37\.pdf yüklendi \(37 sayfa\)/.test(dock.bildirim) && dock.duzenle && JSON.stringify(dock.cagri) === '["bekleyen_acilanlar","dosya_oku:k-dock-1"]',
    `${etiket}: D11 Opened (dosya-acildi) → bekleyen_acilanlar → dosya_oku → Düzenle'de 37 sayfa`, JSON.stringify(dock));
  await page.evaluate(() => { window.__sahte.bekleyen = [{ kimlik: 'k-yok', ad: 'kayip.pdf', tur: 'pdf' }]; });
  await bildirimTemizle();
  await page.evaluate(() => window.__sahte.dinleyici['dosya-acildi']({ payload: null }));
  await page.waitForFunction(() => /Dosya açılamadı/.test(document.getElementById('bildirim').textContent), null, { timeout: 5000 }).catch(() => {});
  const kayip = await page.evaluate(() => ({ metin: document.getElementById('bildirim').textContent, hata: document.getElementById('bildirim').classList.contains('hata') }));
  kontrol('dosya', /^Dosya açılamadı: BILINMEYEN/.test(kayip.metin) && kayip.hata, `${etiket}: D11 okunamayan dış açılış hata bildirimine gider`, kayip.metin);
  // JSON yedeği: vazgeç ve yaz
  await page.click('#sekme-dugme-surec');
  await page.evaluate(() => { window.__sahte.kaydetYanit = null; const b = document.getElementById('bildirim'); b.textContent = ''; });
  await page.click('#json-disa');
  await page.waitForFunction(() => /kaydedilmedi|dışa aktarıldı/.test(document.getElementById('bildirim').textContent));
  const jv = await page.textContent('#bildirim');
  await page.evaluate(() => { window.__sahte.kaydetYanit = '/Users/deneme/Belgeler/mucellit-yedek.json'; const b = document.getElementById('bildirim'); b.textContent = ''; });
  await page.click('#json-disa');
  await page.waitForFunction(() => /kaydedilmedi|dışa aktarıldı/.test(document.getElementById('bildirim').textContent));
  const jy = await page.textContent('#bildirim');
  const jc = await page.evaluate(() => window.__sahte.cagri.filter((c) => c.komut === 'dosya_kaydet' && c.tur === 'json').length);
  kontrol('dosya', /^JSON yedeği kaydedilmedi/.test(jv) && /dışa aktarıldı: \/Users\/deneme\/Belgeler\/mucellit-yedek\.json\.$/.test(jy) && jc === 2,
    `${etiket}: JSON yedeği: vazgeç → "kaydedilmedi", yazıldı → yol`, `${jv} / ${jy}`);
  kontrol('dosya', indirmeSayisi === 0, `${etiket}: Tauri modunda tarayıcı indirmesi hiç başlamadı (<a download> yok)`, `${indirmeSayisi} indirme`);
  // otomatik yedek: kitap ekle → veri_yedekle (oturum + sıra)
  await page.fill('#yk-ad', 'Yedek Kitabı');
  await page.click('#yk-olustur');
  await page.waitForFunction(() => window.__sahte.sonYedek && /Yedek Kitabı/.test(window.__sahte.sonYedek), null, { timeout: 5000 })
    .then(() => kontrol('dosya', true, `${etiket}: Süreç değişikliği otomatik yedeğe (veri_yedekle) gitti`),
      () => kontrol('dosya', false, `${etiket}: Süreç değişikliği otomatik yedeğe (veri_yedekle) gitti`));
  // O2: Tümünü temizle → boş veri yedeği BEKLEMEDEN (eski 1 sn bekletme yok; kapanışta Rust yazar)
  const t0 = await page.evaluate(() => Date.now());
  await page.click('#veri-temizle');
  const temiz = await page.waitForFunction((t) => {
    const y = window.__sahte.cagri.filter((c) => c.komut === 'veri_yedekle' && c.zaman >= t).find((c) => /"kitaplar":\[\]/.test(c.json));
    return y ? { gecikme: y.zaman - t, oturum: y.oturum, sira: y.sira } : false;
  }, t0, { timeout: 900 }).then((h) => h.jsonValue(), () => null);
  kontrol('dosya', temiz && temiz.gecikme < 900 && typeof temiz.oturum === 'string' && temiz.sira > 0,
    `${etiket}: O2 Tümünü temizle → boş yedek bekletmeden Rust'a gitti (oturum + sıra)`, JSON.stringify(temiz));
  // Rust'taki gecikmeli yazım başarısızsa (yedek-yazilamadi olayı) hata bildirimi
  await bildirimTemizle();
  await page.evaluate(() => window.__sahte.dinleyici['yedek-yazilamadi']({ payload: 'yedek yazılamadı: No space left on device' }));
  const yh = await page.evaluate(() => ({ metin: document.getElementById('bildirim').textContent, hata: document.getElementById('bildirim').classList.contains('hata') }));
  kontrol('dosya', /otomatik yedeği yazılamadı: yedek yazılamadı: No space left on device/.test(yh.metin) && yh.hata,
    `${etiket}: O2 yedek-yazilamadi olayı hata bildirimine gider`, yh.metin);
}

// ------------------------------------------------------------------
// arayüz dili
// ------------------------------------------------------------------
const TR_HARF = /[çğıöşüÇĞİÖŞÜ]/;
// uygulama adı "Mücellit" çevrilmez (yalnız tam sözcük, sözcük sınırı; "Mücellitler" gibi uzantılı sözcük muaf değil)
const trHarf = (m) => TR_HARF.test(String(m).replace(/\bMücellit\b/g, ''));
const ESKI_KAYIT = join(FIXTURE, 'legacy');

/** Görünen gövde metni (dil seçicideki "Türkçe" adı ve verilen kullanıcı metinleri hariç). */
async function gorunenMetin(page, haric = []) {
  const m = await page.evaluate(() => {
    const kopya = document.body.cloneNode(true);
    kopya.querySelectorAll('#dil-sec, script, [hidden]').forEach((e) => e.remove());
    return kopya.innerText + ' ' + Array.from(document.querySelectorAll('[title],[aria-label],[placeholder]'))
      .filter((e) => e.id !== 'dil-sec').map((e) => [e.title, e.getAttribute('aria-label'), e.placeholder].filter(Boolean).join(' ')).join(' ');
  });
  return haric.reduce((x, h) => x.split(h).join(''), m);
}

async function eksikAnahtarYok(page, etiket) {
  const e = await page.evaluate(() => window.KitapCilt.dil.eksikler());
  kontrol('dil', e.length === 0, `${etiket}: sözlükte eksik anahtar yok`, JSON.stringify(e));
}

/**
 * sayı alanları ve Hesapla sonuç tablosu arayüz dilinin ondalık ayracıyla (en ".", tr ","); giriş iki ayraçla
 * da kabul edilir ve alandan çıkınca dilin biçimine döner; ↑ tuşu adımı (eski type=number davranışı) korunur.
 */
async function ondalikAkisi(page, etiket, dil) {
  const ay = dil === 'tr' ? ',' : '.', obur = dil === 'tr' ? '.' : ',';
  const ilk = await page.evaluate(() => ['kagit-kalinlik', 'kagit-gen', 'h-kagitKalinlik', 'h-tasma', 'yk-kalinlik', 'dis-kenar'].map((id) => document.getElementById(id).value));
  kontrol('yazdir', JSON.stringify(ilk) === JSON.stringify(['0' + ay + '1', '297', '0' + ay + '1', '3', '0' + ay + '1', '0']),
    `${etiket}: sayı alanları ${dil} ondalık ayracıyla ("0${ay}1")`, JSON.stringify(ilk));
  await page.click('#sekme-dugme-hesapla');
  let giris = null;
  try {
    await page.fill('#h-kagitKalinlik', '0' + obur + '123');
    await page.press('#h-kagitKalinlik', 'Tab');
    giris = await page.evaluate(() => ({ alan: document.getElementById('h-kagitKalinlik').value, sirt: document.querySelector('[data-sonuc="sirtKalinlik"]').textContent }));
  } catch (e) { giris = { hata: String(e.message).split('\n')[0] }; }
  kontrol('yazdir', giris && giris.alan === '0' + ay + '123' && giris.sirt === '12' + ay + '8 mm',
    `${etiket}: "0${obur}123" (öbür ayraç) kabul edildi, alandan çıkınca "0${ay}123"; sırt 12${ay}8 mm`, JSON.stringify(giris));
  await page.focus('#h-tasma');
  await page.keyboard.press('ArrowUp');
  const tablo = await page.evaluate(() => ({ tasma: document.getElementById('h-tasma').value,
    hucre: Array.from(document.querySelectorAll('#h-sonuc td')).map((e) => e.textContent).join(' | ') }));
  const yabanci = new RegExp('\\d\\' + obur + '\\d');
  kontrol('yazdir', tablo.tasma === '3' + ay + '5' && !yabanci.test(tablo.hucre) && tablo.hucre.includes(ay === ',' ? ',' : '.'),
    `${etiket}: ↑ ile adım (3 → 3${ay}5); sonuç tablosunda (değer + formül) yalnız "${ay}" ondalık ayracı`, JSON.stringify({ tasma: tablo.tasma, yabanci: (tablo.hucre.match(new RegExp('.{0,12}' + yabanci.source + '.{0,12}')) || [''])[0] }));
  await page.fill('#h-kagitKalinlik', '0' + ay + '1');
  await page.fill('#h-tasma', '3');
  await page.press('#h-tasma', 'Tab');
  // binliğe benzeyen sayfa sayısı ("1.200" tr / "1,200" en) sessizce 1,2 okunmaz; açık hata, sonuç yok.
  // "1200" ise 1200 sayfa. Alan aria-invalid, bildirimde aynı hata.
  const belirsiz = '1' + obur + '200';
  await page.fill('#h-sayfaSayisi', belirsiz);
  await page.press('#h-sayfaSayisi', 'Tab');
  const b1 = await page.evaluate(() => ({ hata: document.getElementById('h-hata').textContent, satir: document.querySelectorAll('#h-sonuc tr').length,
    gecersiz: document.getElementById('h-sayfaSayisi').getAttribute('aria-invalid'), bildirim: document.getElementById('bildirim').textContent }));
  await page.fill('#h-sayfaSayisi', '1200');
  await page.press('#h-sayfaSayisi', 'Tab');
  const b2 = await page.evaluate(() => ({ toplam: (document.querySelector('[data-sonuc="toplamSayfa"]') || {}).textContent, hata: document.getElementById('h-hata').textContent,
    gecersiz: document.getElementById('h-sayfaSayisi').getAttribute('aria-invalid') }));
  const binlikSozu = dil === 'tr' ? /binlik/ : /thousands/;
  kontrol('yazdir', binlikSozu.test(b1.hata) && b1.hata.includes(belirsiz) && b1.satir === 0 && b1.gecersiz === 'true' && binlikSozu.test(b1.bildirim) &&
    b2.toplam === '1200' && b2.hata === '' && b2.gecersiz === null,
    `${etiket}: Hesapla'da "${belirsiz}" açık hata (sonuç yok, alan geçersiz, bildirim); "1200" → 1200 sayfa`, JSON.stringify({ b1, b2 }));
  await page.fill('#h-sayfaSayisi', '200');
  await page.press('#h-sayfaSayisi', 'Tab');
}

/**
 * dil seçici başlıkta küçük bir seçici (tam genişlik çubuk değil): başlıkla aynı satırda, dar; erişilebilir
 * adı ve klavye erişimi korunur. Pencere 1280 px (Playwright öntanımlısı; Mac penceresi en az 1000 px).
 */
async function dilSeciciYerlesimi(page, etiket) {
  for (const gen of [1280, 1000]) {
    await page.setViewportSize({ width: gen, height: 800 });
    const o = await page.evaluate(() => {
      const r = (e) => e.getBoundingClientRect();
      const sec = document.getElementById('dil-sec'), h1 = document.querySelector('header h1'), bas = document.querySelector('header');
      return { gen: Math.round(r(sec).width), basGen: Math.round(r(bas).width), ayniSatir: Math.abs((r(sec).top + r(sec).bottom) / 2 - (r(h1).top + r(h1).bottom) / 2) < 16,
        basYuk: Math.round(r(bas).height), aria: sec.getAttribute('aria-label'), tab: sec.tabIndex, punto: parseFloat(getComputedStyle(sec).fontSize) };
    });
    kontrol('yazdir', o.gen <= 240 && o.gen < o.basGen / 3 && o.ayniSatir && o.aria && o.tab >= 0 && o.punto >= 12,
      `${etiket}: ${gen} px: dil seçici başlıkta küçük (≤ 240 px, başlık satırında), erişilebilir ad + klavye`, JSON.stringify(o));
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** Türkçe koşuların sonunda: html lang tr, sekmeler Türkçe (bugünkü metin), eksik anahtar yok. */
async function m6TrDenetim(page, adres, etiket) {
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  const d = await page.evaluate(() => ({ lang: document.documentElement.lang, sekme: Array.from(document.querySelectorAll('nav [role="tab"]')).map((b) => b.textContent),
    dugme: document.getElementById('disa-aktar').textContent, kod: window.KitapCilt.dil.kod(), secim: document.getElementById('dil-sec').value }));
  kontrol('dil', d.lang === 'tr' && d.kod === 'tr' && JSON.stringify(d.sekme) === '["Düzenle","Süreç","Hesapla","Öğren"]' && /Dizilmiş PDF'i (indir|kaydet…)/.test(d.dugme) && d.secim === 'sistem',
    `${etiket}: tr-TR tarayıcıda sistem dili Türkçe; sekmeler ve düğme bugünkü metinle`, JSON.stringify(d));
  const saklama = await page.textContent('#saklama-ipucu');
  kontrol('dil', saklama === 'Veri bu tarayıcıda saklanır. Tarayıcı verisi silinirse kaybolur; ara ara JSON yedeği alın.',
    `${etiket}: tarayıcıda saklama ipucu bugünkü Türkçe metin (Mac metni yalnız Tauri'de)`, saklama);
  await ondalikAkisi(page, etiket, 'tr');
  await dilSeciciYerlesimi(page, etiket);
  await yazdirmaGizli(page, etiket);
  await eksikAnahtarYok(page, etiket);
}

/** İngilizce arayüz (en-US): duman + eski Türkçe kayıt + elle dil seçimi. */
async function m6EnAkisi(page, adres, iz, etiket, tam) {
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  const bas = await page.evaluate(() => ({ lang: document.documentElement.lang, baslik: document.title, sekme: Array.from(document.querySelectorAll('nav [role="tab"]')).map((b) => b.textContent),
    dugme: document.getElementById('disa-aktar').textContent, kaynak: document.getElementById('kaynak-bilgi').textContent, secim: document.getElementById('dil-sec').value,
    secenek: Array.from(document.getElementById('dil-sec').options).map((o) => o.value + '=' + o.textContent) }));
  kontrol('dil', bas.lang === 'en' && bas.baslik === 'Mücellit' && JSON.stringify(bas.sekme) === '["Imposition","Projects","Calculator","Learn"]' && bas.dugme === 'Download imposed PDF' &&
    bas.kaynak === 'No PDF loaded yet.' && bas.secim === 'sistem' && JSON.stringify(bas.secenek) === '["sistem=System language (English)","en=English","tr=Türkçe"]',
    `${etiket}: en-US tarayıcıda arayüz İngilizce (sekmeler, düğme, dil seçici)`, JSON.stringify(bas));
  // değişen İngilizce metinler arayüzde
  const dm = await page.evaluate(() => {
    const m = (a) => (document.querySelector(`[data-dil="${a}"]`) || {}).textContent;
    return { bos: [m('duzenle.bos_basa'), m('duzenle.bos_once'), m('duzenle.bos_sona')], sirt: m('hesapla.sirt_tipi'), forza: m('hesapla.forza_payi'), kural: m('hesapla.sirt_kurali'),
      kaynak: m('hesapla.kaynak'), ipucu: m('duzenle.cikti_ipucu'), saklama: (document.getElementById('saklama-ipucu') || {}).textContent };
  });
  kontrol('dil', JSON.stringify(dm.bos) === '["Insert blank at start","Insert blank before selected","Insert blank at end"]' && dm.sirt === 'Spine shape' &&
    dm.forza === 'Endpaper thickness allowance (mm)' && dm.kural === 'Spine stiffener rule (flat spine)' && !/docs\//.test(dm.kaynak) &&
    dm.ipucu === 'First sides of the exported file (actual output).' && /stored in this browser/.test(dm.saklama),
    `${etiket}: değişen İngilizce metinler görünür; tarayıcıda saklama ipucu tarayıcı metni`, JSON.stringify(dm));
  const ilk = await gorunenMetin(page);
  kontrol('dil', !trHarf(ilk), `${etiket}: açılışta görünen metinde Türkçe karakter yok`, (ilk.match(new RegExp('.{0,30}' + TR_HARF.source + '.{0,30}')) || [''])[0]);
  // PDF yükle + dışa aktar
  await page.click('#sekme-dugme-duzenle');
  const pdf = await testPdfUret(page);
  await page.setInputFiles('#pdf-dosya', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#kucuk-resimler .kart').length === 37);
  await page.waitForFunction(() => /loaded/.test(document.getElementById('bildirim').textContent), null, { timeout: 10000 }).catch(() => {});
  await page.selectOption('#cilt-turu', 'formali');
  await page.fill('#forma-yaprak', '4');
  await page.waitForFunction(() => document.querySelectorAll('#yaprak-onizleme .yaprak-kart').length === 12);
  const yuk = await page.evaluate(() => ({ kaynak: document.getElementById('kaynak-bilgi').textContent, ozet: document.getElementById('dizilim-ozet').textContent,
    baslik: document.querySelector('#yaprak-onizleme .yaprak-kart .baslik').textContent, kart: document.querySelector('#kucuk-resimler .kart .etiket .kucuk').textContent }));
  kontrol('dil', /^test-37\.pdf — 37 pages, first page 148 × 210 mm$/.test(yuk.kaynak) && yuk.ozet === '37 pages → padded to 48 (11 blank) · 3 signatures · 12 printer sheets (24 sides)' &&
    /^Signature 1 · sheet 1 \(outer\)output p\. 1–2$/.test(yuk.baslik) && yuk.kart === 'source p. 1',
    `${etiket}: yüklenen PDF bilgisi, dizilim özeti (tekil/çoğul), yaprak başlığı İngilizce`, JSON.stringify(yuk));
  if (tam) {
    const [indirme] = await Promise.all([page.waitForEvent('download'), page.click('#disa-aktar')]);
    await page.waitForFunction(() => /ready/.test(document.getElementById('bildirim').textContent), null, { timeout: 30000 });
    const b = await page.textContent('#bildirim');
    kontrol('dil', indirme.suggestedFilename() === 'test-37-imposed.pdf' && b === 'test-37-imposed.pdf ready (24 sides).',
      `${etiket}: dışa aktarılan dosya adı -imposed, bildirim İngilizce`, indirme.suggestedFilename() + ' | ' + b);
    await page.selectOption('#cikti-modu', 'ikili');
    await page.check('#arka-ters');
    const iki = [];
    page.on('download', (d) => iki.push(d.suggestedFilename()));
    await page.click('#disa-aktar');
    await page.waitForFunction(() => /and/.test(document.getElementById('bildirim').textContent), null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    kontrol('dil', JSON.stringify(iki.sort()) === '["test-37-backs-reversed.pdf","test-37-fronts.pdf"]', `${etiket}: iki PDF: -fronts / -backs-reversed`, JSON.stringify(iki));
    await page.selectOption('#cikti-modu', 'tek');
    // kusurlu girdi bildirimi İngilizce: EPUB değil
    await page.setInputFiles('#pdf-dosya', { name: 'bozuk.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('bu bir zip değil') });
    await page.waitForFunction(() => /couldn't be opened/.test(document.getElementById('bildirim').textContent), null, { timeout: 30000 }).catch(() => {});
    const bz = await page.textContent('#bildirim');
    kontrol('dil', bz === "The file couldn't be opened: This file couldn't be read: it isn't a valid EPUB (ZIP) or it is damaged.", `${etiket}: bozuk EPUB hatası İngilizce`, bz);
    // Hesapla: ondalık nokta, İngilizce satırlar
    await page.click('#sekme-dugme-hesapla');
    const h = await page.evaluate(() => ({ satir: Array.from(document.querySelectorAll('#h-sonuc th')).map((e) => e.textContent).slice(0, 4), sirt: document.querySelector('[data-sonuc="sirtKalinlik"]').textContent }));
    kontrol('dil', JSON.stringify(h.satir) === '["Total pages (blanks included)","Leaves","Signatures","Spine thickness S"]' && h.sirt === '10.4 mm',
      `${etiket}: Hesapla satırları İngilizce`, JSON.stringify(h));
    await page.fill('#h-kagitKalinlik', '0.123');
    const ondalik = await page.textContent('[data-sonuc="sirtKalinlik"]');
    kontrol('dil', ondalik === '12.8 mm', `${etiket}: Hesapla ondalık ayracı nokta (en-US)`, ondalik);
    await page.fill('#h-kagitKalinlik', '0.1');
    await ondalikAkisi(page, etiket, 'en');
  }
  // Süreç: yeni proje İngilizce adımlarla; eski Türkçe kayıt İngilizce görünür, kullanıcı adımı aynen
  await page.click('#sekme-dugme-surec');
  await page.fill('#yk-ad', 'Notebook');
  await page.click('#yk-olustur');
  await page.waitForFunction(() => document.querySelectorAll('#adimlar .adim').length === 14);
  const yeni = await page.evaluate(() => ({ ilk: document.querySelector('#adimlar .adim-ad').textContent, ozet: document.getElementById('kitap-ilerleme').textContent,
    veri: JSON.parse(localStorage.getItem('kitapCilt.v1')).kitaplar.slice(-1)[0].adimlar[6] }));
  kontrol('dil', yeni.ilk === '1. Prep / PDF' && /^Sewn signatures \+ hardcover \(case binding\) · 0 \/ 14 steps done · created \d{4}-\d\d-\d\d$/.test(yeni.ozet) && yeni.veri.sablon === 'dikis' && yeni.veri.ad === 'Sewing',
    `${etiket}: yeni projede adımlar İngilizce, kayıtta şablon anahtarı`, JSON.stringify(yeni));
  const eski = readFileSync(join(ESKI_KAYIT, 'local-storage-v1.json'), 'utf8');
  await page.evaluate((e) => { localStorage.setItem('kitapCilt.v1', e); localStorage.setItem('kitapCilt.seciliKitap', 'k-mzeski-1'); }, eski);
  await page.reload();
  await page.waitForSelector('html[data-hazir="evet"]');
  await page.click('#sekme-dugme-surec');
  await page.waitForSelector('#adimlar .adim');
  const e = await page.evaluate(() => ({ adlar: Array.from(document.querySelectorAll('#adimlar .adim-ad')).map((x) => x.textContent),
    ayar: (document.querySelector('#kitap-detay p.kucuk') || {}).textContent, ls: localStorage.getItem('kitapCilt.v1') }));
  kontrol('dil', e.adlar.length === 15 && e.adlar[0] === '1. Prep / PDF' && e.adlar[6] === '7. Sewing' && e.adlar[14] === '15. Ayraç takma' &&
    /^Saved imposition settings: sewn signatures, paper 297×210 mm, book 148×210 mm, 4 sheets per signature$/.test(e.ayar) && e.ls === eski,
    `${etiket}: eski Türkçe kayıt açıldı: şablon adımları İngilizce, kullanıcı adımı aynen, kayıt değişmedi`, JSON.stringify({ adlar: [e.adlar[0], e.adlar[6], e.adlar[14]], ayar: e.ayar }));
  const sm = await gorunenMetin(page, ['Çiğdemköy (deneme)', 'Ayraç takma', 'kuşe kağıt', '80 g/m² kitap kağıdı']);
  kontrol('dil', !trHarf(sm), `${etiket}: Süreç görünümünde (kullanıcı metinleri dışında) Türkçe karakter yok`, (sm.match(new RegExp('.{0,30}' + TR_HARF.source + '.{0,30}')) || [''])[0]);
  await eksikAnahtarYok(page, etiket);
  // elle dil seçimi: açık belge yok → onaysız; Türkçeye geçer ve kalıcı; sistem diline dönünce İngilizce
  const onaySayisi = iz.onaylar.length;
  await Promise.all([page.waitForEvent('load'), page.selectOption('#dil-sec', 'tr')]);
  await page.waitForSelector('html[data-hazir="evet"]');
  await page.click('#sekme-dugme-surec');
  const tr = await page.evaluate(() => ({ lang: document.documentElement.lang, sekme: document.getElementById('sekme-dugme-duzenle').textContent, secim: localStorage.getItem('kitapCilt.dil'),
    deger: document.getElementById('dil-sec').value, adim: (document.querySelector('#adimlar .adim-ad') || {}).textContent }));
  kontrol('dil', tr.lang === 'tr' && tr.sekme === 'Düzenle' && tr.secim === 'tr' && tr.deger === 'tr' && tr.adim === '1. Hazırlık / PDF' && iz.onaylar.length === onaySayisi,
    `${etiket}: elle Türkçe seçimi (belge yokken onaysız) sayfayı yeniden yükler, kalıcı, adımlar Türkçe`, JSON.stringify(tr));
  const ipTr = await page.evaluate(() => document.getElementById('dil-sec').getAttribute('title'));
  kontrol('yazdir', ipTr === 'Dil', `${etiket}: Türkçeye geçince dil seçici ipucu "Dil"`, String(ipTr));
  await page.reload();
  await page.waitForSelector('html[data-hazir="evet"]');
  kontrol('dil', await page.evaluate(() => document.documentElement.lang) === 'tr', `${etiket}: elle seçim yeniden açılışta duruyor (en-US tarayıcıda Türkçe)`);
  // açık belge varken dil değişimi onay ister; vazgeçilince değişmez
  await page.click('#sekme-dugme-duzenle');
  await page.setInputFiles('#pdf-dosya', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelectorAll('#kucuk-resimler .kart').length === 37);
  iz.onayRed = true;
  await page.selectOption('#dil-sec', 'sistem');
  await page.waitForTimeout(500);
  iz.onayRed = false;
  const red = await page.evaluate(() => ({ lang: document.documentElement.lang, secim: localStorage.getItem('kitapCilt.dil'), deger: document.getElementById('dil-sec').value, kart: document.querySelectorAll('#kucuk-resimler .kart').length }));
  kontrol('dil', iz.onaylar.length === onaySayisi + 1 && /Dil değişince pencere yeniden yüklenir/.test(iz.onaylar[iz.onaylar.length - 1]) && red.lang === 'tr' && red.secim === 'tr' && red.deger === 'tr' && red.kart === 37,
    `${etiket}: belge açıkken dil değişimi onay ister (Türkçe metin); Vazgeç → dil, seçim ve belge değişmez`, JSON.stringify({ red, onay: iz.onaylar.slice(-1) }));
  await Promise.all([page.waitForEvent('load'), page.selectOption('#dil-sec', 'sistem')]);
  await page.waitForSelector('html[data-hazir="evet"]');
  const geri = await page.evaluate(() => ({ lang: document.documentElement.lang, secim: localStorage.getItem('kitapCilt.dil'), deger: document.getElementById('dil-sec').value }));
  kontrol('dil', geri.lang === 'en' && geri.secim === null && geri.deger === 'sistem', `${etiket}: "Sistem dili" seçimi elle seçimi siler, en-US'te İngilizceye döner (onay kabul)`, JSON.stringify(geri));
  const ipEn = await page.evaluate(() => document.getElementById('dil-sec').getAttribute('title'));
  kontrol('yazdir', ipEn === 'Language', `${etiket}: İngilizceye dönünce dil seçici ipucu "Language"`, String(ipEn));
  await yazdirmaGizli(page, etiket);
  await eksikAnahtarYok(page, etiket);
}

/** Tauri benzetimi: açılışta dil_oku + dil_ayarla; menüden dil:en; WebKit verisi silinince seçim Rust yedeğinden döner. */
async function m6TauriDil(page, adres, etiket) {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.removeItem('sahteDilSecim'); sessionStorage.removeItem('sahteDilKod'); window.__sahte.cagri = []; });
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  const a = await page.evaluate(() => ({ cagri: window.__sahte.cagri.filter((c) => /^dil_/.test(c.komut)).map((c) => c.komut), ayar: window.__sahte.dilAyar, lang: document.documentElement.lang,
    dugme: document.getElementById('disa-aktar').textContent }));
  kontrol('dil', JSON.stringify(a.cagri) === '["dil_oku","dil_ayarla"]' && JSON.stringify(a.ayar.slice(-1)) === '[["tr","sistem"]]' && a.lang === 'tr' && a.dugme === "Dizilmiş PDF'i kaydet…",
    `${etiket}: açılışta dil_oku, sonra dil_ayarla {tr, sistem} (menü JS ile aynı dilde); Kaydet düğmesi Türkçe`, JSON.stringify(a));
  // Görünüm > Dil > English (belge açık değil: onaysız) → Rust'a {en, en}, sayfa yeniden yüklenir, İngilizce
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => window.__sahte.dinleyici.menu({ payload: 'dil:en' }))]);
  await page.waitForSelector('html[data-hazir="evet"]');
  const b = await page.evaluate(() => ({ lang: document.documentElement.lang, dugme: document.getElementById('disa-aktar').textContent, ls: localStorage.getItem('kitapCilt.dil'), ayar: window.__sahte.dilAyar,
    sekme: document.getElementById('sekme-dugme-surec').textContent }));
  kontrol('dil', b.lang === 'en' && b.dugme === 'Save imposed PDF…' && b.ls === 'en' && b.sekme === 'Projects' && JSON.stringify(b.ayar.slice(-1)) === '[["en","en"]]',
    `${etiket}: menü dil:en → dil_ayarla {en, en}, yeniden yüklenir, arayüz ve Kaydet düğmesi İngilizce`, JSON.stringify(b));
  // WebKit verisi silindi (localStorage boş) ama Rust'ta yedek var → seçim geri gelir
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('html[data-hazir="evet"]');
  const c = await page.evaluate(() => ({ lang: document.documentElement.lang, ls: localStorage.getItem('kitapCilt.dil'), sekme: document.getElementById('sekme-dugme-hesapla').textContent, kaynak: document.getElementById('kaynak-bilgi').textContent }));
  kontrol('dil', c.lang === 'en' && c.ls === 'en' && c.sekme === 'Calculator' && c.kaynak === 'No PDF loaded yet.',
    `${etiket}: localStorage silinince elle seçim Rust yedeğinden (dil_oku) geri gelir; tr-TR sistemde İngilizce`, JSON.stringify(c));
  // kusurlu menü kimliği yok sayılır
  await page.evaluate(() => { window.__sahte.dinleyici.menu({ payload: 'dil:xx' }); window.__sahte.dinleyici.menu({ payload: 'dil:' }); });
  await page.waitForTimeout(300);
  kontrol('dil', await page.evaluate(() => document.documentElement.lang + '|' + localStorage.getItem('kitapCilt.dil')) === 'en|en', `${etiket}: kusurlu dil menü kimliği (dil:xx, dil:) yok sayılır`);
  await eksikAnahtarYok(page, etiket);
  // "Sistem dili" menüdeki gibi Rust'tan (NSLocale + Apple kuralı); tarayıcı tr-TR iken Rust en derse arayüz en
  await page.evaluate(() => { localStorage.clear(); sessionStorage.removeItem('sahteDilSecim'); sessionStorage.removeItem('sahteDilKod'); sessionStorage.setItem('sahteSistem', 'en'); window.__sahte.dilAyar = []; });
  await page.reload();
  await page.waitForSelector('html[data-hazir="evet"]');
  const r = await page.evaluate(() => ({ lang: document.documentElement.lang, secenek: Array.from(document.getElementById('dil-sec').options).map((o) => o.value + '=' + o.textContent),
    deger: document.getElementById('dil-sec').value, ayar: window.__sahte.dilAyar, sekme: document.getElementById('sekme-dugme-duzenle').textContent, ipucu: document.getElementById('saklama-ipucu').textContent }));
  kontrol('dil', r.lang === 'en' && r.secenek[0] === 'sistem=System language (English)' && r.deger === 'sistem' && r.sekme === 'Imposition' && JSON.stringify(r.ayar.slice(-1)) === '[["en","sistem"]]',
    `${etiket}: sistem dili Rust'tan (dil_oku.sistem en, tarayıcı tr-TR): arayüz ve "System language (English)" seçeneği menüyle aynı kaynaktan`, JSON.stringify(r));
  kontrol('dil', /this Mac/.test(r.ipucu) && !/browser/i.test(r.ipucu), `${etiket}: Mac uygulamasında saklama ipucu Mac metniyle (tarayıcı demez)`, r.ipucu);
  const ilk = await page.evaluate(() => window.__sahte.ilkKare);
  kontrol('yazdir', ilk && ilk.lang === 'en' && ilk.sekme === 'Imposition',
    `${etiket}: ilk kare (dil_oku dönmeden) Rust'ın sistem dilinde (ön betik __KC_DIL__; tarayıcı tr-TR, Rust en): navigator.languages → Rust geçişi yok`, JSON.stringify(ilk));
  await page.evaluate(() => { sessionStorage.removeItem('sahteSistem'); localStorage.clear(); sessionStorage.removeItem('sahteDilKod'); });
}

/**
 * Mac uygulamasında yazdırma (sahte __TAURI__): düğmeler yalnız platform.yazdir varken; baskı öncesi not (çift yüz =
 * araçtaki seçim, %100); tek PDF gönderildi / vazgeçildi / Rust hatası; iki PDF önler → "desteyi çevir" onayı → arkalar
 * ve yarıda kalma; çıktı hazırlanırken/pencere açıkken ⌘P ve ⌘S yok sayılır; menü ⌘P; Önizleme'de Aç ve açılamazsa
 * seçenek E (Kaydet + not). Tarayıcı indirmesi hiç başlamaz.
 */
async function m3Yazdirma(page, adres, etiket) {
  let indirme = 0;
  page.on('download', () => { indirme += 1; });
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.click('#sekme-dugme-duzenle');
  const bildirimTemizle = () => page.evaluate(() => { const b = document.getElementById('bildirim'); b.textContent = ''; b.className = ''; window.__sahte.cagri.length = 0; window.__sahte.sorular = []; });
  const durum = () => page.evaluate(() => ({ bildirim: document.getElementById('bildirim').textContent, hata: document.getElementById('bildirim').classList.contains('hata'),
    yazdir: window.__sahte.cagri.filter((c) => c.komut === 'yazdir').map((c) => ({ ad: c.ad, boyut: c.boyut, notAn: c.notAn })),
    onizleme: window.__sahte.cagri.filter((c) => c.komut === 'onizlemede_ac').map((c) => c.ad), kaydet: window.__sahte.cagri.filter((c) => c.komut === 'dosya_kaydet').map((c) => c.ad),
    sorular: window.__sahte.sorular || [] }));
  const bitti = (re) => page.waitForFunction((k) => new RegExp(k).test(document.getElementById('bildirim').textContent), re.source, { timeout: 30000 }).catch(() => {});
  const g = await page.evaluate(() => ({ alan: document.getElementById('yazdir-alani').hidden, dugme: document.getElementById('yazdir').disabled, onizleme: document.getElementById('onizlemede-ac').hidden,
    not: document.getElementById('yazdir-not').hidden ? null : document.getElementById('yazdir-not').textContent, cevirme: document.getElementById('cevirme').selectedOptions[0].textContent,
    metin: [document.getElementById('yazdir').textContent, document.getElementById('onizlemede-ac').textContent],
    gorunur: [!!document.getElementById('yazdir').offsetParent, !!document.getElementById('onizlemede-ac').offsetParent, !!document.getElementById('yazdir-not').offsetParent] }));
  kontrol('yazdir', g.alan === false && JSON.stringify(g.gorunur) === '[true,true,true]' && g.dugme === true && g.onizleme === false && JSON.stringify(g.metin) === '["Yazdır…","Önizleme\'de Aç"]' &&
    // seçenek baskı penceresinin adıyla ("Açık (Kısa Kenar)" / Düzen: "Kısa Kenardan Ciltli"), araçtaki ad ayrıca
    g.not === `Baskı penceresinde: Çift Taraflı → “Açık (Kısa Kenar)” seçin (buradaki “${g.cevirme}” ile aynı; Düzen bölümünde: Çift Taraflı → “Kısa Kenardan Ciltli”), ölçeği %100 bırakın, “Kâğıt boyutuna sığdır”ı seçmeyin.`,
    `${etiket}: Yazdır… ve Önizleme'de Aç görünür (PDF yokken kapalı); baskı notu araçtaki çift yüz seçimini söyler`, JSON.stringify(g));
  await bildirimTemizle();
  await page.evaluate(() => window.KitapCilt.platform.menuOlayi('dosya-yazdir'));
  const yok = await durum();
  kontrol('yazdir', yok.bildirim === 'Önce bir PDF açın, sonra yazdırın.' && yok.hata && yok.yazdir.length === 0, `${etiket}: PDF yokken ⌘P → "Önce bir PDF açın" (baskı penceresi yok)`, JSON.stringify(yok));
  const pdf = await testPdfUret(page);
  await page.setInputFiles('#pdf-dosya', { name: 'test-37.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => !document.getElementById('yazdir').disabled, null, { timeout: 30000 });
  await page.selectOption('#cilt-turu', 'formali');
  await page.selectOption('#cikti-modu', 'tek');
  // tek PDF: yazdırıldı
  await bildirimTemizle();
  await page.click('#yazdir');
  await bitti(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı/);
  const tek = await durum();
  kontrol('yazdir', tek.bildirim === 'Yazıcıya gönderildi: test-37-dizilmis.pdf.' && !tek.hata && tek.yazdir.length === 1 && tek.yazdir[0].ad === 'test-37-dizilmis.pdf' && tek.yazdir[0].boyut > 1000 &&
    /^Baskı penceresinde: Çift Taraflı → “Açık.*%100.*sığdır/.test(tek.yazdir[0].notAn) && tek.sorular.length === 0,
    `${etiket}: tek PDF → yazdir (ham bayt, ad), baskı penceresinden önce not gösterildi, "Yazıcıya gönderildi"`, JSON.stringify(tek));
  // tek PDF: vazgeçildi
  await bildirimTemizle();
  await page.evaluate(() => { window.__sahte.yazdirSira = [false]; });
  await page.click('#yazdir');
  await bitti(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı/);
  const vaz = await durum();
  kontrol('yazdir', vaz.bildirim === 'Yazdırılmadı (baskı penceresinden vazgeçildi).' && vaz.hata && vaz.yazdir.length === 1, `${etiket}: baskı penceresinde Vazgeç → "Yazdırılmadı" (hata), uygulama sürer`, JSON.stringify(vaz));
  // Rust hatası (Apple dışı platform metni)
  await bildirimTemizle();
  await page.evaluate(() => { window.__sahte.yazdirSira = ['bu platformda yazdırma henüz yok']; });
  await page.click('#yazdir');
  await bitti(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı/);
  const rh = await durum();
  kontrol('yazdir', rh.bildirim === 'test-37-dizilmis.pdf yazdırılamadı: bu platformda yazdırma henüz yok' && rh.hata, `${etiket}: Rust hatası (Apple dışı: "bu platformda yazdırma henüz yok") bildirilir`, rh.bildirim);
  // iki PDF: önler → çevir onayı → arkalar
  await page.selectOption('#cikti-modu', 'ikili');
  await page.waitForFunction(() => !document.getElementById('yazdir').disabled);
  const notIki = await page.textContent('#yazdir-not');
  await bildirimTemizle();
  await page.evaluate(() => { window.__sahte.yazdirSira = [true, true]; window.__sahte.askSira = [true]; });
  await page.click('#yazdir');
  await bitti(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı|Yalnız önler/);
  const iki = await durum();
  kontrol('yazdir', iki.bildirim === 'Yazıcıya gönderildi: test-37-onler.pdf ve test-37-arkalar.pdf.' && JSON.stringify(iki.yazdir.map((y) => y.ad)) === '["test-37-onler.pdf","test-37-arkalar.pdf"]' &&
    iki.sorular.length === 1 && /^Önler \(test-37-onler\.pdf\) yazıcıya gönderildi\. .*desteyi .*çevirip .*geri koyun/.test(iki.sorular[0]) && /Çift Taraflı → “Kapalı”/.test(notIki),
    `${etiket}: iki PDF → önler, "desteyi çevirip geri koyun" onayı, arkalar; not "Çift Taraflı → Kapalı"`, JSON.stringify({ ...iki, notIki }));
  // iki PDF: çevir onayında Vazgeç → yarıda (yalnız önler)
  await bildirimTemizle();
  await page.evaluate(() => { window.__sahte.yazdirSira = [true]; window.__sahte.askSira = [false]; });
  await page.click('#yazdir');
  await bitti(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı|Yalnız önler/);
  const yar = await durum();
  kontrol('yazdir', yar.bildirim === 'Yalnız önler yazıcıya gönderildi (test-37-onler.pdf); arkalar (test-37-arkalar.pdf) basılmadı (vazgeçildi).' && yar.hata && yar.yazdir.length === 1,
    `${etiket}: iki PDF, çevir onayında Vazgeç → yarıda kalma doğru bildirildi (yalnız önler)`, JSON.stringify(yar));
  // iki PDF: arkaların baskı penceresinde Vazgeç
  await bildirimTemizle();
  await page.evaluate(() => { window.__sahte.yazdirSira = [true, false]; window.__sahte.askSira = [true]; });
  await page.click('#yazdir');
  await bitti(/Yazıcıya gönderildi|Yazdırılmadı|yazdırılamadı|Yalnız önler/);
  const yar2 = await durum();
  kontrol('yazdir', /^Yalnız önler yazıcıya gönderildi/.test(yar2.bildirim) && yar2.hata && yar2.yazdir.length === 2, `${etiket}: iki PDF, arkalarda Vazgeç → yarıda`, JSON.stringify(yar2));
  // meşgulken ⌘P / ⌘S yok sayılır; sonra düğmeler serbest
  await page.selectOption('#cikti-modu', 'tek');
  await page.waitForFunction(() => !document.getElementById('yazdir').disabled);
  await bildirimTemizle();
  await page.evaluate(() => { const s = window.__sahte; s.yazdirKapi = new Promise((r) => { s.kapiAc = r; }); });
  await page.click('#yazdir');
  await page.waitForFunction(() => window.__sahte.cagri.some((c) => c.komut === 'yazdir'), null, { timeout: 30000 });
  const mesgul = await page.evaluate(() => { const P = window.KitapCilt.platform; P.menuOlayi('dosya-yazdir'); P.menuOlayi('dosya-kaydet'); P.menuOlayi('dosya-onizleme');
    return { yaz: document.getElementById('yazdir').getAttribute('aria-busy'), kay: document.getElementById('disa-aktar').getAttribute('aria-busy'), kapali: document.getElementById('disa-aktar').disabled }; });
  await page.evaluate(() => { const s = window.__sahte; s.yazdirKapi = null; s.kapiAc(); });
  await bitti(/Yazıcıya gönderildi/);
  const sonra = await durum();
  const serbest = await page.evaluate(() => ['yazdir', 'disa-aktar', 'onizlemede-ac'].map((id) => [document.getElementById(id).disabled, document.getElementById(id).getAttribute('aria-busy')]));
  kontrol('yazdir', mesgul.yaz === 'true' && mesgul.kay === 'true' && mesgul.kapali && sonra.yazdir.length === 1 && sonra.kaydet.length === 0 && sonra.onizleme.length === 0 &&
    JSON.stringify(serbest) === '[[false,null],[false,null],[false,null]]',
    `${etiket}: baskı penceresi açıkken ⌘P/⌘S/⌥⌘P yok sayıldı (tek pencere); bitince düğmeler serbest`, JSON.stringify({ mesgul, sonra, serbest }));
  // baskı penceresi açıkken ayar değişirse (önizleme yeniden çizilir) çıktı düğmeleri açılmaz,
  // aria-busy kalkmaz; ikinci çıktı işi (Kaydet tıklaması) başlamaz.
  await bildirimTemizle();
  await page.evaluate(() => { const s = window.__sahte; s.yazdirKapi = new Promise((r) => { s.kapiAc = r; });
    const C = window.KitapCilt.cikti, u = C.uret; window.__uretSay = 0; C.uret = function () { window.__uretSay += 1; return u.apply(this, arguments); }; });
  await page.click('#yazdir');
  await page.waitForFunction(() => window.__sahte.cagri.some((c) => c.komut === 'yazdir'), null, { timeout: 30000 });
  await page.click('#kirim'); // kesim işareti aç/kapa: yerleşim sığmaya devam eder (D.engel false), önizleme yeniden çizilir
  await page.waitForTimeout(400); // önizleme yeniden çizimi (requestAnimationFrame + pdf.js)
  const ayarli = await page.evaluate(() => ['yazdir', 'disa-aktar', 'onizlemede-ac'].map((id) => [document.getElementById(id).disabled, document.getElementById(id).getAttribute('aria-busy')]));
  await page.evaluate(() => { document.getElementById('disa-aktar').click(); document.getElementById('onizlemede-ac').click(); });
  await page.waitForTimeout(800); // ikinci iş başladıysa uret çağrılır, Kaydet/Önizleme komutu gider
  await page.evaluate(() => { const s = window.__sahte; s.yazdirKapi = null; s.kapiAc(); });
  await bitti(/Yazıcıya gönderildi/);
  await page.waitForTimeout(300);
  const ayarSonra = { ...(await durum()), uret: await page.evaluate(() => window.__uretSay) };
  const ayarSerbest = await page.evaluate(() => ['yazdir', 'disa-aktar', 'onizlemede-ac'].map((id) => [document.getElementById(id).disabled, document.getElementById(id).getAttribute('aria-busy')]));
  await page.click('#kirim');
  await page.waitForFunction(() => !document.getElementById('disa-aktar').disabled, null, { timeout: 30000 }).catch(() => {});
  kontrol('yazdir', JSON.stringify(ayarli) === '[[true,"true"],[true,"true"],[true,"true"]]' && ayarSonra.yazdir.length === 1 && ayarSonra.kaydet.length === 0 &&
    ayarSonra.onizleme.length === 0 && ayarSonra.uret === 1 &&
    JSON.stringify(ayarSerbest) === '[[false,null],[false,null],[false,null]]',
    `${etiket}: baskı penceresi açıkken ayar değişince çıktı düğmeleri kapalı + aria-busy kalır; Kaydet ikinci iş başlatmaz`, JSON.stringify({ ayarli, ayarSerbest, ayarSonra }));
  // menü ⌘P (olay yolu)
  await bildirimTemizle();
  await page.evaluate(() => window.__sahte.dinleyici.menu({ payload: 'dosya-yazdir' }));
  await bitti(/Yazıcıya gönderildi/);
  const menu = await durum();
  kontrol('yazdir', menu.yazdir.length === 1 && menu.bildirim === 'Yazıcıya gönderildi: test-37-dizilmis.pdf.', `${etiket}: Dosya > Yazdır… (⌘P menü olayı) baskı penceresini açar`, JSON.stringify(menu));
  // Önizleme'de Aç: açıldı
  await bildirimTemizle();
  await page.click('#onizlemede-ac');
  await bitti(/Önizleme/);
  const on = await durum();
  kontrol('yazdir', on.bildirim === "Önizleme'de açıldı: test-37-dizilmis.pdf. Önizleme'den “Gerçek Boyut” (%100) ile basın." && JSON.stringify(on.onizleme) === '["test-37-dizilmis.pdf"]',
    `${etiket}: Önizleme'de Aç → onizlemede_ac, "Gerçek Boyut" notu`, JSON.stringify(on));
  // açılamadı (sandbox) → seçenek E: onay → Kaydet → kaydedildi + not
  await bildirimTemizle();
  await page.evaluate(() => { const s = window.__sahte; s.onizlemeSira = ['The application “Preview” does not have permission to open “test-37-dizilmis.pdf.”']; s.askSira = [true]; s.kaydetYanit = '/Users/deneme/Belgeler/test-37-dizilmis.pdf'; });
  await page.click('#onizlemede-ac');
  await bitti(/Kaydedildi|açamadı|kaydedilmedi/);
  const e = await durum();
  await page.evaluate(() => { window.__sahte.kaydetYanit = null; });
  kontrol('yazdir', /^Kaydedildi: \/Users\/deneme\/Belgeler\/test-37-dizilmis\.pdf \(24 yüz\)\. Önizleme'de açıp “Gerçek Boyut” \(%100\) ile basın\.$/.test(e.bildirim) &&
    e.sorular.length === 1 && /^Önizleme PDF'i açamadı \(The application/.test(e.sorular[0]) && JSON.stringify(e.kaydet) === '["test-37-dizilmis.pdf"]',
    `${etiket}: Önizleme açamadı → anlaşılır soru → Kaydet (seçenek E) + "Önizleme'de basın" notu`, JSON.stringify(e));
  // açılamadı → Vazgeç
  await bildirimTemizle();
  await page.evaluate(() => { const s = window.__sahte; s.onizlemeSira = ['izin yok']; s.askSira = [false]; });
  await page.click('#onizlemede-ac');
  await bitti(/açamadı|Kaydedildi/);
  const ev = await durum();
  kontrol('yazdir', ev.bildirim === "Önizleme PDF'i açamadı: izin yok" && ev.hata && ev.kaydet.length === 0, `${etiket}: Önizleme açamadı + Vazgeç → hata bildirimi, Kaydet yok`, JSON.stringify(ev));
  kontrol('yazdir', indirme === 0, `${etiket}: yazdırma/Önizleme akışlarında tarayıcı indirmesi yok`, `${indirme} indirme`);
}

/** tarayıcıda (platform.yazdir yok) yazdırma düğmeleri ve not gizli. */
async function yazdirmaGizli(page, etiket) {
  await page.click('#sekme-dugme-duzenle'); // görünürlük Düzenle sekmesi açıkken ölçülür
  const g = await page.evaluate(() => ({ yazdir: window.KitapCilt.platform.yazdir, alan: document.getElementById('yazdir-alani').hidden, not: document.getElementById('yazdir-not').hidden,
    gorunur: !!document.getElementById('yazdir').offsetParent }));
  kontrol('yazdir', g.yazdir === null && g.alan && g.not && !g.gorunur, `${etiket}: tarayıcıda Yazdır / Önizleme düğmeleri ve baskı notu gizli`, JSON.stringify(g));
}

/**
 * Tauri benzetiminde i18n.js hata atarsa (yüklenemezse) platform-tauri.js fazladan
 * konsol hatası üretmez: konsoldaki tek hata benzetimin kendisi (KC-BENZETIM); arayüz statik İngilizce, başlatma hatası
 * İngilizce bildirilir. Benzetim hataları kontrolden sonra düşülür (koşu sonu "konsol hatası yok" denetimi için).
 */
async function m3TauriDilYok(page, adres, iz, etiket) {
  await page.route('**/js/i18n.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: 'throw new Error("KC-BENZETIM i18n.js");' }));
  const once = iz.hatalar.length;
  await page.goto(adres);
  await page.waitForFunction(() => /start/.test(document.getElementById('bildirim').textContent), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  const b = await page.evaluate(() => ({ ad: window.KitapCilt.platform.ad, bildirim: document.getElementById('bildirim').textContent,
    sekme: document.getElementById('sekme-dugme-duzenle').textContent, saklama: document.getElementById('saklama-ipucu').textContent }));
  const yeni = iz.hatalar.slice(once);
  const disarida = yeni.filter((h) => !/KC-BENZETIM/.test(h));
  kontrol('yazdir', b.ad === 'tauri' && disarida.length === 0 && yeni.length >= 1 && b.sekme === 'Imposition' && /^The app couldn't start: /.test(b.bildirim) && /this Mac/.test(b.saklama),
    `${etiket}: i18n.js yokken platform-tauri.js fazladan konsol hatası üretmez (yalnız benzetim hatası); arayüz statik İngilizce, Mac saklama ipucu İngilizce, başlatma hatası bildirildi`,
    JSON.stringify({ ...b, konsol: yeni.map((h) => h.slice(0, 140)) }));
  iz.hatalar.splice(once); // benzetim (ve varsa kaldı sayılan) hataları koşu sonu denetiminden düşülür; kontrol yukarıda
  await page.unroute('**/js/i18n.js');
}

/**
 * Başlangıç hatası benzetimi. (a) platform.hazir reddedilir, (b) i18n.js hata atar,
 * (c) tr sözlüğü bozuk. Üçünde de etiketler boş değil: (a) seçili dilde (tr-TR → Türkçe), (b) statik İngilizce
 * (index.html), (c) İngilizce ve uygulama çalışır. Benzetim hataları (KC-BENZETIM) konsol denetiminden düşülür.
 */
async function m6AcilisHatasi(page, adres, iz, etiket) {
  const Dil = require('../js/i18n.js');
  const sozluk = (kod) => Dil.jsonAyikla(readFileSync(join(UYGULAMA, 'i18n', kod + '.js'), 'utf8'));
  const EN = sozluk('en'), TR = sozluk('tr');
  const etiketler = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-dil]')).map((e) => [e.getAttribute('data-dil'), e.textContent]));
  const farkli = (l, s) => l.filter(([a, m]) => !m || m !== s[a]);
  const platformJs = readFileSync(join(UYGULAMA, 'js', 'platform.js'), 'utf8');
  if (!platformJs.includes('hazir: Promise.resolve(),')) throw new Error('platform.js benzetim noktası bulunamadı');
  const benzetimDus = () => { const once = iz.hatalar.length; iz.hatalar = iz.hatalar.filter((h) => !/KC-BENZETIM/.test(h)); return once - iz.hatalar.length; };
  // (a)
  await page.route('**/js/platform.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: platformJs.replace('hazir: Promise.resolve(),', "hazir: Promise.reject(new Error('KC-BENZETIM hazir')),") }));
  await page.goto(adres);
  await page.waitForFunction(() => /KC-BENZETIM hazir/.test(document.getElementById('bildirim').textContent), null, { timeout: 20000 });
  const a = await page.evaluate(() => ({ lang: document.documentElement.lang, hazir: document.documentElement.getAttribute('data-hazir'), bildirim: document.getElementById('bildirim').textContent,
    secenek: document.getElementById('dil-sec').options.length }));
  const la = await etiketler();
  kontrol('dil', la.length >= 100 && farkli(la, TR).length === 0 && a.lang === 'tr' && a.hazir === null && /^Uygulama başlatılamadı: KC-BENZETIM hazir$/.test(a.bildirim) && a.secenek === 3,
    `${etiket}: (a) platform.hazir reddedildi: ${la.length} etiket boş değil ve Türkçe (tr-TR), dil seçici dolu, başlatma hatası bildirildi`, JSON.stringify({ ...a, fark: farkli(la, TR).slice(0, 3) }));
  await page.unroute('**/js/platform.js');
  benzetimDus(); // (a): benzetimde hazir oluşturulurken reddedildiği için tarayıcı "işlenmemiş red" de yazabilir
  // (b)
  await page.route('**/js/i18n.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: 'throw new Error("KC-BENZETIM i18n.js");' }));
  await page.goto(adres);
  await page.waitForFunction(() => /start/.test(document.getElementById('bildirim').textContent), null, { timeout: 20000 }).catch(() => {});
  const lb = await etiketler();
  const b = await page.evaluate(() => ({ lang: document.documentElement.lang, bildirim: document.getElementById('bildirim').textContent, aria: document.getElementById('dil-sec').getAttribute('aria-label') }));
  const bHata = iz.hatalar.slice();
  const bDusulen = benzetimDus();
  kontrol('dil', lb.length >= 100 && farkli(lb, EN).length === 0 && b.lang === 'en' && b.aria === 'Language' && /^The app couldn't start: /.test(b.bildirim) && bDusulen >= 1,
    `${etiket}: (b) i18n.js hata attı: ${lb.length} etiket statik İngilizce (index.html), başlatma hatası İngilizce bildirildi`, JSON.stringify({ ...b, fark: farkli(lb, EN).slice(0, 3), konsol: bHata.slice(0, 3).map((h) => h.slice(0, 120)) }));
  // (b)'de başka hata (benzetimin dolaylı sonucu) varsa ayrıca görünür kalsın diye listelenir ve düşülür
  const dolayli = iz.hatalar.length;
  iz.hatalar = [];
  kontrol('dil', dolayli <= 3, `${etiket}: (b) i18n.js yokken benzetim dışı konsol hatası en çok birkaç dolaylı hata (${dolayli})`, JSON.stringify(bHata.map((h) => h.slice(0, 120))));
  await page.unroute('**/js/i18n.js');
  // (c)
  await page.route('**/i18n/tr.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: 'self.KitapCiltSozlukleri = (self.KitapCiltSozlukleri || []).concat([{ "_ad": "KC-BENZETIM bozuk" }]);' }));
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  const lc = await etiketler();
  const c = await page.evaluate(() => ({ lang: document.documentElement.lang, kod: window.KitapCilt.dil.kod(), diller: window.KitapCilt.dil.diller() }));
  kontrol('dil', lc.length >= 100 && farkli(lc, EN).length === 0 && c.lang === 'en' && c.kod === 'en' && JSON.stringify(c.diller) === '["en"]',
    `${etiket}: (c) tr sözlüğü bozuk: i18n.js çalışır, tr-TR kullanıcısı İngilizce görür, uygulama başlar`, JSON.stringify({ ...c, fark: farkli(lc, EN).slice(0, 3) }));
  await page.unroute('**/i18n/tr.js');
  // benzetimden sonra olağan açılış
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  const ld = await etiketler();
  kontrol('dil', farkli(ld, TR).length === 0, `${etiket}: benzetim kalkınca olağan Türkçe açılış`, JSON.stringify(farkli(ld, TR).slice(0, 3)));
}

// ------------------------------------------------------------------
// Öğren rehberi
// ------------------------------------------------------------------
const OGREN_KLASOR = join(UYGULAMA, 'js', 'learn');
const { enjekte: ogrenDenetimEnjekte } = require('./learn-probe.cjs');
/**
 * denetim arayüzü yalnız testte. learn.js isteği yakalanır, ürün dosyası test enjeksiyonuyla sunulur
 * (app/test/learn-probe.cjs; kapanıştan önce KitapCilt.ogren.denetim eklenir). Ürün kodu diskte değişmez.
 */
async function ogrenDenetimKur(page) {
  const kaynak = ogrenDenetimEnjekte(readFileSync(join(OGREN_KLASOR, 'learn.js'), 'utf8'));
  await page.route('**/js/learn/learn.js', (r) => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: kaynak }));
}
const OGREN_LISANS = readFileSync(join(OGREN_KLASOR, 'LICENSE'), 'utf8').trim();
/** Rehber betiklerinin üst düzey bildirdiği adlar (global ad denetimi adayları). */
function ogrenAdaylari() {
  const l = [];
  (function gez(k) { for (const g of readdirSync(k, { withFileTypes: true })) { const y = join(k, g.name); if (g.isDirectory()) gez(y); else if (g.name.endsWith('.js')) l.push(y); } })(OGREN_KLASOR);
  const aday = new Set();
  for (const y of l) {
    const k = readFileSync(y, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const m of k.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) aday.add(m[1]);
  }
  return [...aday];
}
/** Test izleri (Playwright enjekte eder; ürün kodu değil): CSP ihlalleri ve rAF çağrı sayısı. */
const OGREN_IZ = `(() => { window.__kcCsp = []; document.addEventListener('securitypolicyviolation', (e) => window.__kcCsp.push(e.violatedDirective + ' ' + (e.blockedURI || '')));
  const r = window.requestAnimationFrame.bind(window); window.__kcRaf = 0; window.requestAnimationFrame = (f) => { window.__kcRaf++; return r(f); }; })();`;
const ogrenDurum = (page) => page.evaluate(() => { const d = window.KitapCilt.ogren.denetim.durum();
  return { a: d.a, i: d.i, n: d.n, akis: d.akis, bitti: d.bitti, oynuyor: d.oynuyor, kurulu: d.kurulu, gorunur: d.gorunur, figur: d.figur, elle: d.elle, uyum: d.uyum, girdi: d.girdi, acik: d.st ? d.st.open : null, tamam: d.tamam }; });
/** Sayı paneli tablosu: { anahtar: [sayılar] } (dilin ondalık/binlik ayracıyla okunur). */
function sayilariAyikla(metin, dil) {
  return (String(metin).match(/\d[\d.,]*/g) || []).map((x) => Number(dil === 'tr' ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '')));
}
const ogrenTablo = (page, dil) => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#og-sonuclar td')).map((td) => [td.dataset.k, td.textContent])))
  .then((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, sayilariAyikla(v, dil)])));
const hesaplaTablo = (page, dil) => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#h-sonuc td[data-sonuc]')).map((td) => [td.dataset.sonuc, td.textContent])))
  .then((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, sayilariAyikla(v, dil)])));
const TB_OGREN = { sayfa: [176], forma: [11], yaprak: [88], baski: [44], sirt: [8.8], mukavva: [144, 216], serit: [12.8, 216], mafsal: [7], kaplama: [348.8, 250], forza: [296, 210], mull: [58.8, 198], kapital: [8.8] };
const tbFarki = (t) => Object.keys(TB_OGREN).filter((k) => JSON.stringify(t[k]) !== JSON.stringify(TB_OGREN[k])).map((k) => `${k}: ${JSON.stringify(t[k])}`);
async function hesaplaYaz(page, id, deger) {
  await page.click('#sekme-dugme-hesapla');
  if (id === 'h-ciltTuru') await page.selectOption('#h-ciltTuru', deger);
  else { await page.fill('#' + id, String(deger)); await page.dispatchEvent('#' + id, 'change'); }
}

/** Öğren koşusu (sunucu, Tauri CSP başlığı). dil: 'tr' | 'en' (tarayıcı yerel ayarı). */
async function m7OgrenAkisi(page, adres, iz, etiket, dil) {
  const D = require('../js/i18n.js');
  const SOZ = D.jsonAyikla(readFileSync(join(UYGULAMA, 'i18n', dil + '.js'), 'utf8'));
  await page.addInitScript({ content: OGREN_IZ });
  await ogrenDenetimKur(page);
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  // ---- sekme açılmadan rehber kurulmaz; boşta rAF yok
  const r0 = await page.evaluate(() => window.__kcRaf);
  await page.waitForTimeout(600);
  const once = await ogrenDurum(page);
  const bos = await page.evaluate((r0) => ({ sahne: document.getElementById('og-sahne').childElementCount, raf: window.__kcRaf - r0, gizli: document.getElementById('sekme-ogren').hidden,
    sekme: document.getElementById('sekme-dugme-ogren').textContent }), r0);
  kontrol('ogren', !once.kurulu && !once.figur && bos.sahne === 0 && bos.raf === 0 && bos.gizli && bos.sekme === SOZ['sekme.ogren'],
    `${etiket}: Öğren sekmesi açılmadan rehber kurulmaz, figür ve rAF yok; 4. sekme "${SOZ['sekme.ogren']}"`, JSON.stringify({ once, bos }));
  // ---- sekme açılır; panel öntanımlıları Hesapla ile aynı (aynı sonuç nesnesi)
  await page.click('#sekme-dugme-ogren');
  await page.waitForFunction(() => window.KitapCilt.ogren.denetim.durum().figur, null, { timeout: 10000 });
  const ac = await ogrenDurum(page);
  const ayni = await page.evaluate(() => window.KitapCilt.ogren.denetim.durum().olcu.hesap === window.KitapCilt.hesapla.durum().sonuc);
  const og = await ogrenTablo(page, dil), hs = await hesaplaTablo(page, dil);
  const esle = { sayfa: (h) => h.toplamSayfa.slice(0, 1), forma: (h) => h.formaSayisi, yaprak: (h) => h.kitapYaprak, baski: (h) => h.baskiKagidi, sirt: (h) => h.sirtKalinlik,
    mukavva: (h) => h.mukavva, serit: (h) => h.sirtSeridi, mafsal: (h) => h.mafsal, kaplama: (h) => h.kaplama, forza: (h) => h.forza, mull: (h) => h.mull, kapital: (h) => h.kapital };
  const fark = Object.entries(esle).filter(([k, f]) => JSON.stringify(og[k]) !== JSON.stringify(f(hs))).map(([k, f]) => `${k}: ${JSON.stringify(og[k])} ≠ ${JSON.stringify(f(hs))}`);
  const alan = await page.evaluate(() => ['formaSayisi', 'formaYaprak', 'kitapGen', 'kitapYuk', 'kagitKalinlik'].map((a) => document.getElementById('og-g-' + a).value));
  kontrol('ogren', ac.kurulu && ac.figur && ac.gorunur && !ac.elle && ayni && fark.length === 0 && Object.keys(og).length >= 12 && og.sayfa[0] === 208 && og.forma[0] === 13 &&
    JSON.stringify(alan) === JSON.stringify(['13', '4', '148', '210', dil === 'tr' ? '0,1' : '0.1']),
    `${etiket}: sekme açılınca rehber kurulur; sayı paneli öntanımlıları Hesapla ile aynı (aynı hesap sonucu nesnesi, 12 değer)`, JSON.stringify({ fark, ayni, alan, og: og.sayfa }));
  // ---- global ad: yalnız KitapCilt altında
  const aday = ogrenAdaylari();
  const temel = new Set(await page.evaluate(() => { const f = document.createElement('iframe'); document.body.appendChild(f); const l = Object.getOwnPropertyNames(f.contentWindow); f.remove(); return l; }));
  const tanimli = [];
  for (const a of aday) { if (temel.has(a)) continue; if (await page.evaluate(`typeof ${a} !== 'undefined'`).catch(() => false)) tanimli.push(a); }
  // id'li öğeler tarayıcının adlı erişimiyle (window.fig === #fig) görünür: betik bildirimi değil, ayrı sayılır
  const idOge = await page.evaluate((l) => l.filter((a) => { const e = document.getElementById(a); return !!e && window[a] === e; }), tanimli);
  const bildirilen = tanimli.filter((a) => !idOge.includes(a));
  const pencere = await page.evaluate(() => ({ ad: ['__st', '__ln', 'CF_HIZ', 'FIG_A', 'LBL_U', 'cfKur', 'mountFigure', 'PALS'].filter((a) => a in window),
    ogren: Object.keys(window.KitapCilt.ogren).sort(), nolabels: document.documentElement.classList.contains('nolabels'), accent: document.documentElement.style.getPropertyValue('--accent'),
    dataErrors: document.documentElement.hasAttribute('data-errors') }));
  kontrol('ogren', bildirilen.length === 0 && pencere.ad.length === 0 && !pencere.nolabels && !pencere.accent && !pencere.dataErrors && ['cf', 'denetim', 'olcu', 'sekme'].every((a) => pencere.ogren.includes(a)),
    `${etiket}: global ad yalnız KitapCilt altında (${aday.length} aday bildirimden küresel ${bildirilen.length}; id'li öğe adları ayrı: ${idOge.length}; html sınıf/değişken/data-errors kalıntısı yok)`, JSON.stringify({ bildirilen, idOge, pencere }));
  // ---- lisans paneli (Mac'te kullanıcının erişebildiği MIT tam metni)
  const lis = await page.evaluate(() => { const d = document.getElementById('og-lisans'), p = document.getElementById('og-lisans-metin');
    // görünürlük: checkVisibility (kapalı details içeriği content-visibility ile gizli; offsetHeight Chromium'da 0 değil)
    const gorunur = (e) => (typeof e.checkVisibility === 'function' ? e.checkVisibility() : e.offsetHeight > 0);
    const r = { var: !!d && !!p && !!d.closest('#og-kok'), ozet: d ? d.querySelector('summary').textContent : '', kapali: p ? !d.open && !gorunur(p) : null };
    if (d) d.querySelector('summary').click();
    return { ...r, acik: p ? d.open && gorunur(p) && p.offsetHeight > 0 : null, metin: p ? p.textContent.trim() : '', lang: p ? p.lang : '', dipnot: document.querySelector('#og-kok [data-dil="ogren.lisans"]').textContent }; });
  await page.evaluate(() => { const d = document.getElementById('og-lisans'); if (d) d.open = false; });
  kontrol('ogren', lis.var && lis.ozet === SOZ['ogren.lisans_metni'] && lis.kapali && lis.acik && lis.metin === OGREN_LISANS && lis.lang === 'en' && lis.dipnot === SOZ['ogren.lisans'],
    `${etiket}: Öğren'de "${SOZ['ogren.lisans_metni']}" paneli açılır, MIT tam metni js/learn/LICENSE ile birebir`, JSON.stringify({ ...lis, metin: lis.metin.slice(0, 40) }));
  // ---- 10 aşama, 45 adım (4×)
  await page.selectOption('#og-hiz', '4');
  const ders = await page.evaluate(() => window.KitapCilt.ogren.denetim.dersler.map((d) => d.adimlar.length));
  const kalan = [];
  let adim = 0;
  for (let a = 0; a < ders.length; a++) {
    await page.evaluate((a) => window.KitapCilt.ogren.denetim.kur(a, 0), a);
    for (let j = 0; j < ders[a]; j++) {
      const r = await page.evaluate(async (j) => { const p = window.KitapCilt.ogren.denetim.calistir(j); return p && p.then ? await p : p; }, j);
      adim++;
      if (r !== true) kalan.push(`${a + 1}.${j + 1}`);
    }
  }
  const sonAdim = await ogrenDurum(page);
  const kart = await page.textContent('#og-adim-baslik');
  kontrol('ogren', adim === 45 && ders.length === 10 && kalan.length === 0 && sonAdim.a === 9 && sonAdim.i === 4 && kart === SOZ['ogren.bitti_baslik'],
    `${etiket}: 10 aşamanın 45 adımı oynatıldı (4×), hepsi başladı ve bitti; son kart "${SOZ['ogren.bitti_baslik']}"`, JSON.stringify({ adim, kalan, son: [sonAdim.a, sonAdim.i], kart }));
  // ---- Örnek Kitap (elle) ve elle değişikliğin Hesapla'ya geçmemesi
  const ond = dil === 'tr' ? '0,1' : '0.1';
  const kabul = await page.evaluate((ond) => window.KitapCilt.ogren.denetim.sayilar({ formaSayisi: '11', formaYaprak: '4', kitapGen: '148', kitapYuk: '210', kagitKalinlik: ond }), ond);
  const tbElle = tbFarki(await ogrenTablo(page, dil));
  const elle = await ogrenDurum(page);
  const hDeger = await page.evaluate(() => document.getElementById('h-sayfaSayisi').value);
  kontrol('ogren', kabul === true && tbElle.length === 0 && elle.elle && hDeger === '200',
    `${etiket}: Örnek Kitap (11 forma × 4, 148 × 210, 0,1 mm) panelde birebir; elle değişiklik Hesapla'yı değiştirmez`, JSON.stringify({ tbElle, elle: elle.elle, hDeger }));
  // ---- Hesapla değişir: rehber elle değerlerde kalır; "Hesapla'dan al" bağlar; bağlıyken Hesapla'yı izler (TB Hesapla'dan)
  await hesaplaYaz(page, 'h-sayfaSayisi', 300);
  await page.click('#sekme-dugme-ogren');
  const elleKalir = await ogrenDurum(page);
  await page.click('#og-hesapladan-al');
  const alindi = await ogrenDurum(page), alTablo = await ogrenTablo(page, dil);
  await hesaplaYaz(page, 'h-sayfaSayisi', 162);
  await page.click('#sekme-dugme-ogren');
  const izler = await ogrenDurum(page), tbHesapla = tbFarki(await ogrenTablo(page, dil));
  const ayni2 = await page.evaluate(() => window.KitapCilt.ogren.denetim.durum().olcu.hesap === window.KitapCilt.hesapla.durum().sonuc);
  kontrol('ogren', elleKalir.elle && elleKalir.girdi.formaSayisi === 11 && !alindi.elle && alindi.girdi.formaSayisi === 19 && alTablo.sayfa[0] === 304 &&
    !izler.elle && izler.girdi.formaSayisi === 11 && tbHesapla.length === 0 && ayni2,
    `${etiket}: Hesapla değişince elle değerler kalır; "${SOZ['ogren.hesapladan_al']}" Hesapla'ya bağlar (300 sayfa → 19 forma); bağlıyken Hesapla'yı izler (162 sayfa → Örnek Kitap birebir)`,
    JSON.stringify({ elleKalir: [elleKalir.elle, elleKalir.girdi.formaSayisi], alindi: [alindi.elle, alindi.girdi.formaSayisi, alTablo.sayfa], izler: [izler.elle, izler.girdi.formaSayisi], tbHesapla, ayni2 }));
  // ---- Hesapla'da tek yaprak: rehber formalı çizer, uyum notu görünür; Hesapla hatalıysa not, önceki sayılar kalır
  await hesaplaYaz(page, 'h-ciltTuru', 'tek1');
  await page.click('#sekme-dugme-ogren');
  const uyum = await page.evaluate(() => ({ not: !document.getElementById('og-uyum').hidden, d: window.KitapCilt.ogren.denetim.durum().uyum }));
  const uyumTb = tbFarki(await ogrenTablo(page, dil));
  await hesaplaYaz(page, 'h-ciltTuru', 'formali');
  await hesaplaYaz(page, 'h-kitapGen', 'abc');
  await page.click('#sekme-dugme-ogren');
  const hatali = await page.evaluate(() => ({ not: document.getElementById('og-sayi-not').hidden ? '' : document.getElementById('og-sayi-not').textContent, forma: window.KitapCilt.ogren.denetim.durum().girdi.formaSayisi }));
  await hesaplaYaz(page, 'h-kitapGen', 148);
  await page.click('#sekme-dugme-ogren');
  const duzeldi = await page.evaluate(() => ({ not: document.getElementById('og-sayi-not').hidden, uyum: document.getElementById('og-uyum').hidden }));
  kontrol('ogren', uyum.not && uyum.d === false && uyumTb.length === 0 && hatali.not === SOZ['ogren.hesapla_hata'] && hatali.forma === 11 && duzeldi.not && duzeldi.uyum,
    `${etiket}: Hesapla tek yaprakken rehber formalı + düz sırt çizer ve not gösterir; Hesapla hatalıyken önceki sayılar kalır, düzelince not kalkar`, JSON.stringify({ uyum, uyumTb, hatali, duzeldi }));
  // ---- Öğren açıkken sekme yeniden basılınca rehber söküp yeniden kurulmaz; "baştan sona" adım atlamaz
  await page.evaluate(() => window.KitapCilt.ogren.denetim.kur(0, 0));
  await page.click('#og-bastan-sona');
  await page.waitForFunction(() => { const d = window.KitapCilt.ogren.denetim.durum(); return d.akis && d.oynuyor && d.i >= 1; }, null, { timeout: 20000 });
  const yb0 = await page.evaluate(() => { const d = window.KitapCilt.ogren.denetim.durum(); window.__kcSt = d.st; window.__kcSahne = document.getElementById('og-sahne').firstElementChild; return { a: d.a, i: d.i }; });
  await page.click('#sekme-dugme-ogren');
  const yb1 = await page.evaluate(() => { const d = window.KitapCilt.ogren.denetim.durum();
    return { ayniSt: d.st === window.__kcSt, ayniSahne: document.getElementById('og-sahne').firstElementChild === window.__kcSahne, oynuyor: d.oynuyor, akis: d.akis, a: d.a, i: d.i }; });
  await page.waitForFunction(([a, i]) => { const d = window.KitapCilt.ogren.denetim.durum(); return d.a !== a || d.i !== i || !d.akis; }, [yb0.a, yb0.i], { timeout: 20000 });
  const yb2 = await ogrenDurum(page);
  await page.click('#og-bastan-sona');   // durdur
  await page.waitForFunction(() => !window.KitapCilt.ogren.denetim.durum().akis, null, { timeout: 10000 });
  kontrol('ogren', yb1.ayniSt && yb1.ayniSahne && yb1.oynuyor && yb1.akis && yb2.akis && yb2.a === yb0.a && yb2.i === yb0.i + 1,
    `${etiket}: "baştan sona" sürerken Öğren sekmesi yeniden basılınca figür yeniden kurulmaz, oynayan adım sürer, sonraki adım sırayla (adım atlanmaz)`,
    JSON.stringify({ once: yb0, sonra: yb1, ilk: [yb2.a, yb2.i, yb2.akis] }));
  // ---- sekme değişince "baştan sona" durur, figür sökülür, rAF çağrısı yok; geri dönünce aynı yerden kurulur
  await page.evaluate(() => window.KitapCilt.ogren.denetim.kur(2, 0));
  await page.click('#og-bastan-sona');
  await page.waitForTimeout(1500);
  const oynarken = await ogrenDurum(page);
  await page.click('#sekme-dugme-surec');
  const hemen = await ogrenDurum(page);
  const sahne = await page.evaluate(() => document.getElementById('og-sahne').childElementCount);
  await page.waitForTimeout(300);
  const ra = await page.evaluate(() => window.__kcRaf);
  await page.waitForTimeout(1200);
  const rb = await page.evaluate(() => window.__kcRaf);
  const gizliKonum = await ogrenDurum(page);
  await page.click('#sekme-dugme-ogren');
  const geri = await ogrenDurum(page);
  kontrol('ogren', oynarken.akis && !hemen.akis && !hemen.figur && !hemen.gorunur && sahne === 0 && rb - ra === 0 && gizliKonum.a === oynarken.a && geri.figur && geri.a === gizliKonum.a && !geri.akis,
    `${etiket}: sekme değişince "baştan sona" durur, figür sökülür, gizli sekmede rAF çağrısı 0 (1,2 sn); geri dönünce aynı aşamada kurulur`,
    JSON.stringify({ oynarken: [oynarken.akis, oynarken.a], hemen: [hemen.akis, hemen.figur], sahne, raf: rb - ra, geri: [geri.figur, geri.a] }));
  // ---- baştan sona oynat (4×): sona kadar, sıra 1→10, son karede kapak kapalı
  await page.evaluate(() => window.KitapCilt.ogren.denetim.kur(0, 0));
  const t0 = Date.now();
  await page.click('#og-bastan-sona');
  const sira = [];
  let son = null;
  while (Date.now() - t0 < 240000) {
    const d = await ogrenDurum(page);
    if (!sira.length || sira[sira.length - 1] !== d.a + 1) sira.push(d.a + 1);
    if (!d.akis) { son = d; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  const dugme = await page.textContent('#og-bastan-sona');
  kontrol('ogren', son && son.bitti && son.a === 9 && son.i === 4 && son.acik === 0 && JSON.stringify(sira) === '[1,2,3,4,5,6,7,8,9,10]' && dugme === SOZ['ogren.bastan_sona'],
    `${etiket}: baştan sona oynat (4×) bitti: aşama sırası 1→10, son aşamada 4/4, kapak kapalı (${Math.round((Date.now() - t0) / 1000)} sn)`, JSON.stringify({ sira, son: son && [son.bitti, son.a, son.i, son.acik], dugme }));
  // ---- CSP ihlali 0 (Tauri CSP başlığı), eksik anahtar 0, uygulama bildiriminde hata yok
  const sonIz = await page.evaluate(() => ({ csp: window.__kcCsp.slice(), eksik: window.KitapCilt.dil.eksikler().filter((a) => /^(ogren|sekme)\./.test(a)), bildirim: document.getElementById('bildirim').className }));
  kontrol('ogren', sonIz.csp.length === 0 && sonIz.eksik.length === 0 && !/hata/.test(sonIz.bildirim),
    `${etiket}: Öğren boyunca CSP ihlali 0 (Tauri CSP başlığı), eksik ogren.* anahtarı 0, hata bildirimi yok`, JSON.stringify(sonIz));
  // ---- dil değişimi: yeniden yüklemeden sonra Öğren sekmesi açık, rehber yeni dilde, aşama/adım korunur
  const obur = dil === 'tr' ? 'en' : 'tr';
  const OBUR = D.jsonAyikla(readFileSync(join(UYGULAMA, 'i18n', obur + '.js'), 'utf8'));
  await page.evaluate(() => window.KitapCilt.ogren.denetim.kur(2, 2));
  const onceTamam = (await ogrenDurum(page)).tamam;
  const onceIlerleme = await page.evaluate(() => document.getElementById('og-ilerleme-metin').textContent.match(/\d+/g).join('/'));
  await Promise.all([page.waitForEvent('load'), page.selectOption('#dil-sec', obur)]);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  await page.waitForFunction(() => window.KitapCilt.ogren.denetim.durum().figur, null, { timeout: 10000 });
  const yd = await ogrenDurum(page);
  const ym = await page.evaluate(() => ({ sekme: document.getElementById('sekme-dugme-ogren').textContent, secili: document.getElementById('sekme-dugme-ogren').getAttribute('aria-selected'),
    baslik: document.querySelector('#og-kok [data-dil="ogren.baslik"]').textContent, adim: document.getElementById('og-adim-baslik').textContent, oynat: document.getElementById('og-oynat').textContent,
    lang: document.documentElement.lang, hata: document.documentElement.dataset.errors || null }));
  const gorunen = obur === 'en' ? await gorunenMetin(page) : '';
  kontrol('ogren', ym.lang === obur && ym.sekme === OBUR['sekme.ogren'] && ym.secili === 'true' && ym.baslik === OBUR['ogren.baslik'] && ym.adim === OBUR['ogren.dikis.ikinci.baslik'] &&
    ym.oynat === OBUR['ogren.oynat'] && yd.a === 2 && yd.i === 2 && (obur !== 'en' || !trHarf(gorunen)),
    `${etiket}: dil ${dil} → ${obur}: yeniden yüklemeden sonra Öğren açık, rehber ${obur} (başlık, adım, düğme), aşama 3 adım 3 korunur${obur === 'en' ? ', görünen metinde Türkçe harf yok' : ''}`,
    JSON.stringify({ ym, konum: [yd.a, yd.i], tr: obur === 'en' ? (gorunen.match(new RegExp('.{0,20}' + TR_HARF.source + '.{0,20}')) || [''])[0] : '' }));
  const sonraIlerleme = await page.evaluate(() => document.getElementById('og-ilerleme-metin').textContent.match(/\d+/g).join('/'));
  kontrol('ogren', onceTamam.reduce((s, v) => s + v, 0) > 0 && JSON.stringify(yd.tamam) === JSON.stringify(onceTamam) && sonraIlerleme === onceIlerleme,
    `${etiket}: dil ${dil} → ${obur}: aşamaların ilerlemesi (tamam) ve genel ilerleme (${onceIlerleme}) korunur`, JSON.stringify({ onceTamam, sonra: yd.tamam, onceIlerleme, sonraIlerleme }));
  await eksikAnahtarYok(page, etiket + ' (' + obur + ')');
}

/** prefers-reduced-motion: 45 adımın her biri animasyonsuz biter (≤150 ms, ≤1 çizim, adım sonu durumu, geçiş 0 sn). */
async function m7OgrenAzalt(tarayici, adres, etiket, yerel) {
  const ctx = await tarayici.newContext({ locale: yerel, reducedMotion: 'reduce', viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const iz = izle(page, etiket);
  try {
    await ogrenDenetimKur(page);
    await page.goto(adres);
    await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
    await page.click('#sekme-dugme-ogren');
    await page.waitForFunction(() => window.KitapCilt.ogren.denetim.durum().figur, null, { timeout: 10000 });
    const ders = await page.evaluate(() => window.KitapCilt.ogren.denetim.dersler.map((d) => d.adimlar.length));
    const kaldi = [];
    let adim = 0;
    for (let a = 0; a < ders.length; a++) for (let j = 0; j < ders[a]; j++) {
      const r = await page.evaluate(async ([a, j]) => {
        const D = window.KitapCilt.ogren.denetim, temiz = (st) => JSON.stringify(st, (k, v) => (/T$|K$|^anim|^firca$|^_/.test(k) ? undefined : typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
        D.kur(a, j + 1); const hedef = temiz(D.durum().st);
        D.kur(a, j); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const art = document.getElementById('art'); let cizim = 0; const mo = new MutationObserver(() => cizim++); mo.observe(art, { childList: true });
        const t0 = performance.now(); const p = D.calistir(j); const ok = p && p.then ? await p : p; const sure = performance.now() - t0;
        await new Promise((r) => setTimeout(r, 0)); mo.disconnect();
        const gecis = getComputedStyle(document.getElementById('figF')).transitionDuration;
        const H = JSON.parse(hedef), G = JSON.parse(temiz(D.durum().st)), fark = Object.keys({ ...H, ...G }).filter((x) => JSON.stringify(H[x]) !== JSON.stringify(G[x]));
        return { ok, sure: Math.round(sure), cizim, fark, gecis };
      }, [a, j]);
      adim++;
      const sorun = [];
      if (r.ok !== true) sorun.push('başlamadı'); if (r.sure > 150) sorun.push(`süre ${r.sure} ms`); if (r.cizim > 1) sorun.push(`${r.cizim} ara kare`);
      if (r.fark.length) sorun.push('son durum farklı: ' + r.fark.join(',')); if (!/^0s(, 0s)*$/.test(r.gecis)) sorun.push('geçiş ' + r.gecis);
      if (sorun.length) kaldi.push(`${a + 1}.${j + 1}: ${sorun.join(', ')}`);
    }
    kontrol('ogren', adim === 45 && kaldi.length === 0, `${etiket}: prefers-reduced-motion: 45 adımın her biri animasyonsuz biter (≤150 ms, ≤1 çizim, adım sonu durumu, geçiş 0 sn)`, JSON.stringify({ adim, kaldi: kaldi.slice(0, 5) }));
  } catch (e) {
    kontrol('ogren', false, `${etiket}: hareketi azalt koşusu yarıda kaldı: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
  }
  kontrol('ogren', iz.hatalar.length === 0, `${etiket}: hareketi azalt koşusunda konsol hatası yok`, iz.hatalar.slice(0, 3).join(' | ') || '0 hata');
  await ctx.close();
}

/**
 * file:// ve Tauri benzetimi için kısa Öğren denetimi, yalnız DOM'la (ürün kodu olduğu gibi; test enjeksiyonu yok):
 * sekme (ya da menü olayı) rehberi açar, bir adım oynar; ürün kodunda denetim arayüzü yok; yeniden basınca yeniden
 * kurulmaz.
 */
async function m7OgrenDuman(page, adres, etiket, menu) {
  await page.goto(adres);
  await page.waitForSelector('html[data-hazir="evet"]', { timeout: 20000 });
  const ac = () => (menu ? page.evaluate(() => window.__sahte.dinleyici.menu({ payload: 'sekme-ogren' })) : page.click('#sekme-dugme-ogren'));
  await ac();
  await page.waitForFunction(() => document.getElementById('og-sahne').childElementCount > 0 && document.getElementById('og-kok').dataset.durum === 'hazir', null, { timeout: 10000 });
  await page.selectOption('#og-hiz', '4');
  await page.click('#og-oynat');
  await page.waitForFunction(() => document.querySelectorAll('#og-adimlar li.bitti').length === 1 && document.getElementById('og-kok').dataset.durum === 'hazir', null, { timeout: 15000 });
  const d = await page.evaluate(() => ({ secili: document.getElementById('sekme-dugme-ogren').getAttribute('aria-selected'), gorunur: !document.getElementById('sekme-ogren').hidden,
    bitti: document.querySelectorAll('#og-adimlar li.bitti').length, guncel: Array.from(document.querySelectorAll('#og-adimlar li')).findIndex((l) => l.classList.contains('guncel')) }));
  kontrol('ogren', d.secili === 'true' && d.gorunur && d.bitti === 1 && d.guncel === 1,
    `${etiket}: ${menu ? 'menü olayı "sekme-ogren" (Görünüm > Öğren ⌘4)' : 'Öğren sekmesi'} rehberi açar, ilk adım oynar`, JSON.stringify(d));
  const urun = await page.evaluate(() => Object.keys(window.KitapCilt.ogren).sort());
  kontrol('ogren', !urun.includes('denetim') && urun.includes('sekme'),
    `${etiket}: ürün kodunda test arayüzü yok (KitapCilt.ogren.denetim tanımsız; yalnız sekme/olcu/cf/…)`, JSON.stringify(urun));
  await page.evaluate(() => { window.__kcSahne = document.getElementById('og-sahne').firstElementChild; });
  await ac();
  const y = await page.evaluate(() => ({ ayni: document.getElementById('og-sahne').firstElementChild === window.__kcSahne, bitti: document.querySelectorAll('#og-adimlar li.bitti').length,
    guncel: Array.from(document.querySelectorAll('#og-adimlar li')).findIndex((l) => l.classList.contains('guncel')) }));
  kontrol('ogren', y.ayni && y.bitti === 1 && y.guncel === 1,
    `${etiket}: Öğren açıkken ${menu ? 'menü olayı (⌘4)' : 'sekme'} yeniden gelince rehber yeniden kurulmaz (aynı figür, aynı adım)`, JSON.stringify(y));
  if (menu) {
    await page.evaluate(() => window.__sahte.dinleyici.menu({ payload: 'sekme-hesapla' }));
    const g = await page.evaluate(() => ({ sahne: document.getElementById('og-sahne').childElementCount, hesapla: !document.getElementById('sekme-hesapla').hidden }));
    kontrol('ogren', g.sahne === 0 && g.hesapla, `${etiket}: menüden başka sekmeye (⌘3) geçince rehber figürü sökülür`, JSON.stringify(g));
  }
}

async function main() {
  const pw = await playwrightYukle();
  const motor = pw[MOTOR];
  if (!motor || typeof motor.launch !== 'function') { console.error(`Bilinmeyen motor: ${MOTOR} (chromium | webkit)`); process.exit(2); }
  console.log(`Motor: ${MOTOR}`);
  const sunucu = await sunucuBaslat();
  const port = sunucu.address().port;
  const yerelKok = urlBicimle({ protocol: 'http:', slashes: true, hostname: '127.0.0.1', port, pathname: '/' });
  const tarayici = await motor.launch();
  let kodu = 0;
  async function kosu(etiket, olcutAkis, adres, yerelOnEk, govde, yerel = 'tr-TR') {
    // tarayıcı dili = sistem dili (navigator.languages); mevcut koşular Türkçe arayüzle
    const ctx = await tarayici.newContext({ acceptDownloads: true, locale: yerel });
    const p = await ctx.newPage();
    p.setDefaultTimeout(60000);
    const iz = izle(p, etiket);
    try {
      await govde(p, adres, iz);
    } catch (e) {
      const ilk = String(e && e.message ? e.message : e).split('\n')[0];
      kontrol(olcutAkis, false, `${etiket} koşusu yarıda kaldı: ${ilk}`, iz.hatalar.length ? 'konsol: ' + iz.hatalar.slice(0, 2).map((h) => h.slice(0, 200)).join(' | ') : undefined);
    }
    kontrol(5, iz.hatalar.length === 0, `${etiket} koşusu: konsol hatası yok`, iz.hatalar.length ? `${iz.hatalar.length} hata, ilk: ` + iz.hatalar.slice(0, 3).map((h) => h.slice(0, 200)).join(' | ') : '0 hata');
    agDenetle(iz, yerelOnEk, etiket, 4);
    await ctx.close();
    return iz;
  }
  try {
    // ---- Koşu 1: yerel sunucu (ölçüt 2, 3) ----
    await kosu('sunucu', '2/3', yerelKok + 'index.html', yerelKok, async (p, adres, iz) => {
      await pdfAkisi(p, adres, 'sunucu', 2, true);
      await surecAkisi(p);
      await yardimcilariKur(p);
      await ayAkisIki(p, 'sunucu');
      await ayKutular(p, 'sunucu');
      await ayBosBasa(p, adres, 'sunucu');
      await sifreliAkis(p, adres, iz, 'sunucu');
      await arayuzKontrolleri(p, adres, 'sunucu');
      await osDepoAkisi(p, adres, 'sunucu');
      await epubAkisi(p, adres, 'sunucu');
      await bdAkisi(p, adres, 'sunucu');
      await onayAkisi(p, adres, iz, 'sunucu');
      await birakmaAkisi(p, adres, 'sunucu');
      await m1DuzeltmeAkisi(p, adres, iz, 'sunucu', true);
      await m2EpubZipAkisi(p, adres, 'sunucu');
      await m6TrDenetim(p, adres, 'sunucu');
    });
    // ---- Koşu 1b: yerel sunucu, sahte __TAURI__ ile ----
    await kosu('tauri-benzetimi', 'dosya', yerelKok + 'index.html', yerelKok, async (p, adres, iz) => {
      await m2TauriBenzetimi(p, adres, 'tauri-benzetimi');
      await m6TauriDil(p, adres, 'tauri-benzetimi');
      await m3Yazdirma(p, adres, 'tauri-benzetimi');
      await m3TauriDilYok(p, adres, iz, 'tauri-benzetimi');
      await m7OgrenDuman(p, adres, 'tauri-benzetimi', true);
    });
    // ---- Koşu 1d: başlangıç hatası benzetimi, tr-TR ----
    await kosu('açılış-hatası', 'dil', yerelKok + 'index.html', yerelKok, async (p, adres, iz) => {
      await m6AcilisHatasi(p, adres, iz, 'açılış-hatası');
    });
    // ---- Koşu 1e: Öğren rehberi, Tauri CSP başlığıyla; tr-TR ve en-US; hareketi azalt ----
    await kosu('öğren', 'ogren', yerelKok + 'index.html', yerelKok, async (p, adres, iz) => {
      await m7OgrenAkisi(p, adres, iz, 'öğren', 'tr');
    });
    await kosu('öğren en', 'ogren', yerelKok + 'index.html', yerelKok, async (p, adres, iz) => {
      await m7OgrenAkisi(p, adres, iz, 'öğren en', 'en');
    }, 'en-US');
    await m7OgrenAzalt(tarayici, yerelKok + 'index.html', 'öğren azalt', 'tr-TR');
    await m7OgrenAzalt(tarayici, yerelKok + 'index.html', 'öğren azalt en', 'en-US');
    // ---- Koşu 1c: İngilizce arayüz, en-US tarayıcı ----
    await kosu('en', 'dil', yerelKok + 'index.html', yerelKok, async (p, adres, iz) => {
      await m6EnAkisi(p, adres, iz, 'en', true);
    }, 'en-US');
    // ---- Koşu 2: file:// (ölçüt 6) ----
    const iz2 = await kosu('file://', 6, pathToFileURL(join(UYGULAMA, 'index.html')).href, 'file://', async (p, adres, iz) => {
      await pdfAkisi(p, adres, 'file://', 6, false);
      await onayAkisi(p, adres, iz, 'file://');
      await m1DuzeltmeAkisi(p, adres, iz, 'file://', false);
      await epubAkisi(p, adres, 'file://');
      await bdAkisi(p, adres, 'file://');
      await epubPerformans(p, adres, 'file://');
      await m2EpubZipAkisi(p, adres, 'file://');
      await m6TrDenetim(p, adres, 'file://');
      await m7OgrenDuman(p, adres, 'file://', false);
    });
    // ---- Koşu 2b: file://, İngilizce duman ----
    await kosu('en file://', 'dil', pathToFileURL(join(UYGULAMA, 'index.html')).href, 'file://', async (p, adres, iz) => {
      await m6EnAkisi(p, adres, iz, 'en file://', false);
    }, 'en-US');
    kontrol(6, iz2.hatalar.length === 0, 'file:// koşusu: konsol hatası yok (ölçüt 6)');
  } catch (e) {
    kontrol('-', false, 'beklenmeyen hata', e && e.stack ? e.stack : String(e));
  } finally {
    await tarayici.close();
    sunucu.close();
  }
  const kalan = sonuclar.filter((s) => !s.gecti);
  console.log(`\nÖZET: ${sonuclar.length} kontrol, ${sonuclar.length - kalan.length} geçti, ${kalan.length} kaldı`);
  if (kalan.length) kodu = 1;
  process.exit(kodu);
}

main();
