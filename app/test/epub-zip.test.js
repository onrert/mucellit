'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../js/plugins/epub/zip.js');
const U = require('./epub-build.cjs');

async function hataKodu(fn) {
  try { await fn(); } catch (e) { return { kod: e.kod, mesaj: e.message }; }
  return { kod: null };
}

test('zip: stored ve deflate girdiler birebir açılıyor, sıra korunuyor', async () => {
  const uzun = 'kitap cilt '.repeat(500);
  const z = Z.oku(U.zipUret([
    { ad: 'mimetype', veri: 'application/epub+zip', yontem: 0 },
    { ad: 'a/b.txt', veri: uzun, yontem: 8 },
    { ad: 'klasor/', veri: '', yontem: 0 }
  ]));
  assert.deepEqual(z.adlar(), ['mimetype', 'a/b.txt']);
  assert.equal(await z.metin('mimetype'), 'application/epub+zip');
  assert.equal(await z.metin('a/b.txt'), uzun);
  assert.equal(z.var('A/B.TXT'), true, 'büyük/küçük harf duyarsız yedek eşleşme');
  assert.equal(z.var('yok.txt'), false);
});

test('zip: Türkçe (UTF-8) girdi adı ve Türkçe içerik', async () => {
  const z = Z.oku(U.zipUret([{ ad: 'OEBPS/Bölüm-çğışöü İ.xhtml', veri: 'Iğdır ılık İstanbul', yontem: 8 }]));
  assert.deepEqual(z.adlar(), ['OEBPS/Bölüm-çğışöü İ.xhtml']);
  assert.equal(await z.metin('OEBPS/Bölüm-çğışöü İ.xhtml'), 'Iğdır ılık İstanbul');
});

test('zip: rastgele bayt → E1 (Türkçe mesaj)', async () => {
  const r = await hataKodu(() => Z.oku(U.hazir.bozuk()));
  assert.equal(r.kod, 'E1');
  assert.equal(r.mesaj, 'Bu dosya okunamadı: geçerli bir EPUB (ZIP) değil ya da bozuk.');
});

test('zip: boş ve kısaltılmış dosya → E1', async () => {
  assert.equal((await hataKodu(() => Z.oku(new Uint8Array(0)))).kod, 'E1');
  const tam = U.zipUret([{ ad: 'a.txt', veri: 'merhaba dünya '.repeat(50) }]);
  assert.equal((await hataKodu(() => Z.oku(tam.subarray(0, tam.length - 30)))).kod, 'E1', 'EOCD kesik');
});

test('zip: CRC uyuşmazlığı → E1 (açarken)', async () => {
  const z = Z.oku(U.zipUret([{ ad: 'a.txt', veri: 'içerik', crcBoz: true }]));
  assert.equal((await hataKodu(() => z.ac('a.txt'))).kod, 'E1');
});

test('zip: şifre bayrağı (bit 0) → E3 DRM mesajı', async () => {
  const r = await hataKodu(() => Z.oku(U.zipUret([{ ad: 'a.txt', veri: 'x', bayrak: 0x801 }])));
  assert.equal(r.kod, 'E3');
  assert.match(r.mesaj, /^Bu EPUB DRM ile korunuyor \(şifreli içerik\)\. Mücellit DRM'li kitapları açmaz; DRM'siz bir kopya kullanın\.$/);
});

test('zip: sıkıştırma yöntemi 12 (bzip2) → E7, ayrıntıda yöntem', async () => {
  const z = Z.oku(U.zipUret([{ ad: 'a.txt', veri: 'x', yontem: 12 }]));
  const r = await hataKodu(() => z.ac('a.txt'));
  assert.equal(r.kod, 'E7');
  assert.match(r.mesaj, /^Bu EPUB'un ZIP biçimi desteklenmiyor \(sıkıştırma yöntemi 12/);
});

test('zip: ZIP64 bulucu → E7 (ZIP64)', async () => {
  const r = await hataKodu(() => Z.oku(U.zipUret([{ ad: 'a.txt', veri: 'x' }], { zip64Bulucu: true })));
  assert.equal(r.kod, 'E7');
  assert.match(r.mesaj, /\(ZIP64\)\.$/);
});

test('zip: ".." ve kök yollar ZIP dışına çıkmaz; yolCoz göreli yolu çözer', async () => {
  const z = Z.oku(U.zipUret([{ ad: '../../etc/x.txt', veri: 'a' }, { ad: '/kok.txt', veri: 'b' }]));
  assert.deepEqual(z.adlar(), ['etc/x.txt', 'kok.txt']);
  assert.equal(Z.yolCoz('OEBPS/text/b1.xhtml', '../img/a%20b.png#x'), 'OEBPS/img/a b.png');
  assert.equal(Z.yolCoz('OEBPS/content.opf', 'text/b1.xhtml'), 'OEBPS/text/b1.xhtml');
  assert.equal(Z.yolCoz('OEBPS/', '../../../x.css'), 'x.css');
});

test('zip: hazır EPUB fixture (trMini) içinde mimetype ilk ve stored', async () => {
  const z = Z.oku(U.hazir.trMini());
  assert.equal(z.adlar()[0], 'mimetype');
  assert.equal(z.girdi('mimetype').yontem, 0);
  assert.ok(z.var('META-INF/container.xml'));
  assert.match(await z.metin('OEBPS/b1.xhtml'), /ÖĞÜŞÇ ğüşıöçİ/);
});

// ---- düzeltme testleri (kodlama dahil) ----
const zlib = require('node:zlib');

test('zip D1: bildirilen boyutu aşan deflate akışı okunurken kesilir → E1 (sıkıştırma bombası)', async () => {
  const bomba = Buffer.alloc(8 * 1024 * 1024); // 8 MB sıfır ≈ 8 KB deflate
  const z = Z.oku(U.zipUret([{ ad: 'bomba.xhtml', veri: bomba, bildirilenBoyut: 1000 }]));
  const r = await hataKodu(() => z.ac('bomba.xhtml'));
  assert.equal(r.kod, 'E1');
  assert.match(r.mesaj, /^Bu dosya okunamadı/);
  const e = await (async () => { try { await z.ac('bomba.xhtml'); } catch (x) { return x; } })();
  assert.match(e.ayrinti, /açılan veri bildirilen boyutu aşıyor/, 'okuma sırasında kesildi: ' + e.ayrinti);
});

test('zip D1: bildirilen açılmış boyut mutlak sınırı aşarsa açmadan E1', async () => {
  const veri = 'a'.repeat(5000);
  const z = Z.oku(U.zipUret([{ ad: 'a.txt', veri }, { ad: 'b.txt', veri: 'küçük' }]), { enCokAcilan: 4096 });
  const e = await (async () => { try { await z.ac('a.txt'); } catch (x) { return x; } return null; })();
  assert.ok(e, '5000 baytlık girdi 4096 sınırında açılmamalı');
  assert.equal(e.kod, 'E1');
  assert.match(e.ayrinti, /sınırı aşıyor/);
  assert.equal(await z.metin('b.txt'), 'küçük', 'sınır altındaki girdi açılır');
});

test('zip D2: girdi tablosu prototipsiz; toString/constructor/__proto__ adları karışmaz', async () => {
  const z = Z.oku(U.zipUret([{ ad: 'a.txt', veri: 'a' }, { ad: '__proto__', veri: 'proto içeriği' }, { ad: 'constructor', veri: 'yapıcı' }]));
  assert.equal(z.var('toString'), false);
  assert.equal(z.var('hasOwnProperty'), false);
  assert.equal(z.var('TOSTRING'), false);
  const r = await hataKodu(() => z.ac('valueOf'));
  assert.equal(r.kod, 'YOK');
  assert.equal(await z.metin('__proto__'), 'proto içeriği');
  assert.equal(await z.metin('constructor'), 'yapıcı');
  assert.deepEqual(z.adlar(), ['a.txt', '__proto__', 'constructor']);
});

test('zip D6: veri tanımlayıcılı (bayrak bit 3) girdiler merkezi dizinden doğru açılır', async () => {
  const uzun = 'Iğdır ılık İstanbul '.repeat(300);
  const z = Z.oku(U.zipUret([
    { ad: 'mimetype', veri: 'application/epub+zip', yontem: 0 },
    { ad: 'a.xhtml', veri: uzun, veriTanimlayici: true },
    { ad: 'b.bin', veri: Buffer.from([1, 2, 3, 4, 5]), yontem: 0, veriTanimlayici: true },
    { ad: 'c.txt', veri: 'son girdi', veriTanimlayici: true }
  ]));
  assert.equal(z.girdi('a.xhtml').bayrak & 8, 8);
  assert.equal(await z.metin('a.xhtml'), uzun);
  assert.deepEqual(Array.from(await z.ac('b.bin')), [1, 2, 3, 4, 5]);
  assert.equal(await z.metin('c.txt'), 'son girdi');
});

test('zip D6: EOCD sonunda ZIP yorumu (kısa ve 60 000 bayt) EOCD aramasını bozmaz', async () => {
  for (const yorum of ['Mücellit deneme yorumu', 'y'.repeat(60000)]) {
    const z = Z.oku(U.zipUret([{ ad: 'a.txt', veri: 'merhaba' }, { ad: 'b.txt', veri: 'dünya' }], { yorum }));
    assert.deepEqual(z.adlar(), ['a.txt', 'b.txt']);
    assert.equal(await z.metin('b.txt'), 'dünya');
  }
});

test('zip kodlama: XML bildirimi windows-1254 / iso-8859-9 ise o kodlamayla çözülür', async () => {
  const tr = 'Iğdır ılık İstanbul; ÖĞÜŞÇ ğüşıöçİ';
  // windows-1254 baytları: Türkçe harfler tek bayt
  const w1254 = { 'ğ': 0xf0, 'ı': 0xfd, 'İ': 0xdd, 'Ö': 0xd6, 'Ğ': 0xd0, 'Ü': 0xdc, 'Ş': 0xde, 'Ç': 0xc7, 'ü': 0xfc, 'ş': 0xfe, 'ö': 0xf6, 'ç': 0xe7 };
  const kodla = (s) => Buffer.from([...s].map((c) => w1254[c] !== undefined ? w1254[c] : c.charCodeAt(0)));
  for (const ad of ['windows-1254', 'ISO-8859-9']) {
    const xml = Buffer.concat([Buffer.from(`<?xml version="1.0" encoding="${ad}"?>\n<html><body><p>`), kodla(tr), Buffer.from('</p></body></html>')]);
    const z = Z.oku(U.zipUret([{ ad: 'b.xhtml', veri: xml }]));
    const m = await z.metin('b.xhtml');
    assert.ok(m.includes(tr), `${ad}: ${m.slice(0, 120)}`);
    assert.ok(!m.includes('�'));
    assert.deepEqual(z.desteksizKodlamalar(), []);
  }
});

test('zip kodlama: UTF-8 bildirimi ve bildirimsiz metin değişmez; desteklenmeyen kodlama UTF-8 okunur ve bildirilir', async () => {
  const z = Z.oku(U.zipUret([
    { ad: 'u.xhtml', veri: '<?xml version="1.0" encoding="UTF-8"?><p>ğüş</p>' },
    { ad: 'c.css', veri: 'p { font-style: italic } /* ğ */' },
    { ad: 'x.xhtml', veri: '<?xml version="1.0" encoding="x-bilinmeyen-kod"?><p>abc ğ</p>' }
  ]));
  assert.equal(await z.metin('u.xhtml'), '<?xml version="1.0" encoding="UTF-8"?><p>ğüş</p>');
  assert.equal(await z.metin('c.css'), 'p { font-style: italic } /* ğ */');
  assert.equal(await z.metin('x.xhtml'), '<?xml version="1.0" encoding="x-bilinmeyen-kod"?><p>abc ğ</p>');
  assert.deepEqual(z.desteksizKodlamalar(), ['x-bilinmeyen-kod']);
});

test('zip kodlama D-2: içerik UTF-8 ama bildirim iso-8859-1 ise UTF-8 okunur; gerçek windows-1254 bayt bildirimi korunur', async () => {
  const tr = 'Iğdır ılık İstanbul';
  const z = Z.oku(U.zipUret([{ ad: 'u.xhtml', veri: `<?xml version="1.0" encoding="iso-8859-1"?><p>${tr}</p>` }]));
  const m = await z.metin('u.xhtml');
  assert.ok(m.includes(tr), m);
  assert.ok(!m.includes('Ä'), 'mojibake yok');
  const w1254 = { 'ğ': 0xf0, 'ı': 0xfd, 'İ': 0xdd };
  const bayt = Buffer.from([...tr].map((c) => w1254[c] !== undefined ? w1254[c] : c.charCodeAt(0)));
  const xml = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="windows-1254"?><p>'), bayt, Buffer.from('</p>')]);
  const z2 = Z.oku(U.zipUret([{ ad: 'w.xhtml', veri: xml }]));
  assert.ok((await z2.metin('w.xhtml')).includes(tr));
});

// ---- klasör paketi EPUB'un tarayıcı sıkıştırması ("<ad>.epub.zip", tek üst klasör) ----
async function onekliZip(onek, ekler) {
  const ham = Z.oku(U.epub(U.trMiniTanim()));
  const g = [];
  for (const a of ham.adlar()) g.push({ ad: onek + a, veri: Buffer.from(await ham.ac(a)), yontem: 8 });
  return U.zipUret(g.concat(ekler || []));
}

test('zip (.epub.zip): tek üst klasör öneki atılır; __MACOSX ve .DS_Store yok sayılır; içerik aynı', async () => {
  const z = Z.oku(await onekliZip('Mavi Pusula.epub/', [
    { ad: 'Mavi Pusula.epub/', veri: '', yontem: 0 },
    { ad: '__MACOSX/Mavi Pusula.epub/._mimetype', veri: 'x' },
    { ad: 'Mavi Pusula.epub/.DS_Store', veri: 'x' },
  ]));
  assert.equal(z.kokOneki(), 'Mavi Pusula.epub/');
  const asil = Z.oku(U.epub(U.trMiniTanim()));
  assert.deepEqual(z.adlar(), asil.adlar());
  assert.equal(z.var('META-INF/container.xml'), true);
  assert.equal(await z.metin('mimetype'), 'application/epub+zip');
  assert.equal(await z.metin('OEBPS/b1.xhtml'), await asil.metin('OEBPS/b1.xhtml'));
  assert.equal(z.var('.DS_Store'), false);
  assert.equal(z.adlar().some((a) => /__MACOSX|DS_Store/.test(a)), false);
});

test('zip (.epub.zip): önek atılmayan durumlar (kökte container, iki üst klasör, öneksiz kök dosya, container yok)', async () => {
  // sıradan EPUB: önek yok
  assert.equal(Z.oku(U.epub(U.trMiniTanim())).kokOneki(), '');
  // kökte de container.xml var → dokunulmaz
  const ikisi = Z.oku(U.zipUret([
    { ad: 'META-INF/container.xml', veri: '<c/>' },
    { ad: 'X.epub/META-INF/container.xml', veri: '<c/>' },
  ]));
  assert.equal(ikisi.kokOneki(), '');
  assert.equal(ikisi.var('X.epub/META-INF/container.xml'), true);
  // kökte container var ve bütün girdiler META-INF/ altında (iç içe META-INF/META-INF/container.xml) → dokunulmaz
  const icIce = Z.oku(U.zipUret([
    { ad: 'META-INF/container.xml', veri: '<c/>' },
    { ad: 'META-INF/META-INF/container.xml', veri: '<c/>' },
  ]));
  assert.equal(icIce.kokOneki(), '');
  assert.equal(icIce.var('META-INF/META-INF/container.xml'), true);
  // iki ayrı üst klasör
  const iki = Z.oku(await onekliZip('A.epub/', [{ ad: 'B/x.txt', veri: 'x' }]));
  assert.equal(iki.kokOneki(), '');
  assert.equal(iki.var('META-INF/container.xml'), false);
  // kökte önek dışında dosya
  const kokDosya = Z.oku(await onekliZip('A.epub/', [{ ad: 'okubeni.txt', veri: 'x' }]));
  assert.equal(kokDosya.kokOneki(), '');
  // tek klasör ama içinde container yok
  const kapsiz = Z.oku(U.zipUret([{ ad: 'A/mimetype', veri: 'application/epub+zip' }, { ad: 'A/OEBPS/b.xhtml', veri: '<x/>' }]));
  assert.equal(kapsiz.kokOneki(), '');
  assert.equal(kapsiz.var('A/mimetype'), true);
  // yalnız sistem artığı
  assert.equal(Z.oku(U.zipUret([{ ad: '__MACOSX/._a', veri: 'x' }])).kokOneki(), '');
});

test('zip (.epub.zip): önek büyük/küçük harf farkıyla container (meta-inf/CONTAINER.XML) da bulunur', async () => {
  const z = Z.oku(U.zipUret([
    { ad: 'K.epub/mimetype', veri: 'application/epub+zip', yontem: 0 },
    { ad: 'K.epub/meta-inf/CONTAINER.XML', veri: '<c/>' },
  ]));
  assert.equal(z.kokOneki(), 'K.epub/');
  assert.equal(z.var('META-INF/container.xml'), true);
});

test('repo fixture: klasör paketi (app/test/fixtures/folder-package.epub) epub-oku-cli denetleyicisiyle; kusurlu girdiler kalır', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { denetle } = require('./epub-read-cli.cjs');
  const kok = path.join(__dirname, 'fixtures', 'folder-package.epub');
  const dosyalar = [];
  (function gez(d) {
    for (const g of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (g.name.startsWith('.')) continue;
      const y = path.join(d, g.name);
      if (g.isDirectory()) gez(y); else dosyalar.push(path.relative(kok, y).split(path.sep).join('/'));
    }
  })(kok);
  dosyalar.sort((a, b) => (a === 'mimetype' ? -1 : b === 'mimetype' ? 1 : a < b ? -1 : 1));
  const girdi = (ad, ek) => Object.assign({ ad, veri: fs.readFileSync(path.join(kok, ad)), yontem: ad === 'mimetype' ? 0 : 8 }, ek);
  const iyi = await denetle(U.zipUret(dosyalar.map((a) => girdi(a))));
  assert.equal(iyi.baslik, 'Klasör Paketi Deneme Kitabı');
  assert.deepEqual(iyi.uyarilar, []);
  // kusurlu: mimetype sıkıştırılmış / ikinci sırada / manifest dosyası eksik / container yok
  const sikisik = await denetle(U.zipUret(dosyalar.map((a) => girdi(a, a === 'mimetype' ? { yontem: 8 } : {}))));
  assert.ok(sikisik.uyarilar.some((u) => /sıkıştırılmış/.test(u)), JSON.stringify(sikisik));
  const sira = dosyalar.slice(1).concat(['mimetype']);
  assert.ok((await denetle(U.zipUret(sira.map((a) => girdi(a))))).uyarilar.some((u) => /ilk girdi/.test(u)));
  const eksik = dosyalar.filter((a) => a !== 'OEBPS/chapter-2.xhtml');
  assert.ok((await denetle(U.zipUret(eksik.map((a) => girdi(a))))).uyarilar.some((u) => /manifest dosyası yok/.test(u)));
  await assert.rejects(denetle(U.zipUret(dosyalar.filter((a) => !a.startsWith('META-INF/')).map((a) => girdi(a)))), /container/);
  await assert.rejects(denetle(Buffer.alloc(0)), /./);
});

test('deflate açılamıyorsa (DecompressionStream yok) tarayıcıda Chrome/Edge önerisi, Mac uygulamasında macOS metni', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const { dilKur } = require('./i18n-helper.js');
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'js', 'plugins', 'epub', 'zip.js'), 'utf8');
  const bayt = U.zipUret([{ ad: 'a.txt', veri: 'x'.repeat(100), yontem: 8 }]);
  for (const [platform, beklenen, olmayan] of [['tarayici', /Chrome\/Edge/, null], ['tauri', /macOS/, /Chrome|Edge|browser/i]]) {
    const ctx = {};
    ctx.self = ctx;
    vm.createContext(ctx);
    dilKur(ctx, 'en');
    ctx.KitapCilt.platform = { ad: platform };
    vm.runInContext(kaynak, ctx, { filename: 'zip.js' });
    const z = ctx.KitapCilt.epubZip.oku(vm.runInContext('Uint8Array', ctx).from(bayt));
    const r = await hataKodu(() => z.ac('a.txt'));
    assert.equal(r.kod, 'E7', platform);
    assert.match(r.mesaj, beklenen, platform);
    if (olmayan) assert.doesNotMatch(r.mesaj, olmayan, platform);
  }
});
