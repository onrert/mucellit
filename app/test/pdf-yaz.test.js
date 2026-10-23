'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PY = require('../js/eklentiler/epub/pdf-yaz.js');
const D = require('../js/eklentiler/epub/dizgi.js');
const U = require('./epub-uret.cjs');

const PDFLib = require('../vendor/pdf-lib/pdf-lib.min.js');
const fontkit = require('../vendor/fontkit/fontkit.umd.min.js');
const DIZIN = path.join(__dirname, '..', 'vendor', 'literata');
const TTF = {
  R: fs.readFileSync(path.join(DIZIN, 'Literata-Regular.ttf')), I: fs.readFileSync(path.join(DIZIN, 'Literata-Italic.ttf')),
  B: fs.readFileSync(path.join(DIZIN, 'Literata-Bold.ttf')), BI: fs.readFileSync(path.join(DIZIN, 'Literata-BoldItalic.ttf'))
};

function fontSozlukleri(doc) {
  const { PDFName, PDFDict } = PDFLib;
  const l = [];
  doc.context.enumerateIndirectObjects().forEach(([, o]) => {
    if (o instanceof PDFDict && String(o.get(PDFName.of('Type'))) === '/Font') l.push(o);
  });
  return l;
}

test('pdf-yaz: 2 sayfalık SAYFA → 2 sayfa, ölçü doğru, Literata FontFile2 ile gömülü, Standard 14 yok', async () => {
  const sayfalar = [
    { no: 1, ogeler: [{ tur: 'metin', x: 40, y: 500, metin: 'Iğdır’da', stil: 'R', boy: 10.5, bosluk: true }, { tur: 'metin', x: 90, y: 500, metin: 'ılık', stil: 'I', boy: 10.5, bosluk: false }] },
    { no: 2, ogeler: [{ tur: 'metin', x: 40, y: 500, metin: 'İSTANBUL ÖĞÜŞÇ', stil: 'B', boy: 10.5, bosluk: false }, { tur: 'metin', x: 40, y: 480, metin: 'ğüşıöçİ', stil: 'BI', boy: 10.5, bosluk: false }] }
  ];
  const uyarilar = [];
  const bayt = await PY.pdfYaz(sayfalar, { genPt: 419.53, yukPt: 595.28, baslik: 'Deneme', yazar: 'Mücellit', dil: 'tr' }, { PDFLib, fontkit, fontlar: TTF, resimler: {}, uyarilar });
  assert.ok(bayt instanceof Uint8Array && bayt.length > 1000);
  assert.deepEqual(uyarilar, [], 'alt küme yedeğine düşülmedi');
  const doc = await PDFLib.PDFDocument.load(bayt, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 2);
  for (const p of doc.getPages()) { assert.ok(Math.abs(p.getWidth() - 419.53) < 0.01); assert.ok(Math.abs(p.getHeight() - 595.28) < 0.01); }
  assert.equal(doc.getTitle(), 'Deneme');
  assert.equal(doc.getProducer(), 'Mücellit EPUB');
  const fontlar = fontSozlukleri(doc);
  const { PDFName } = PDFLib;
  const tip0 = fontlar.filter((f) => String(f.get(PDFName.of('Subtype'))) === '/Type0');
  assert.equal(tip0.length, 4, '4 stil gömülü');
  for (const f of tip0) assert.match(String(f.get(PDFName.of('BaseFont'))), /Literata/);
  const tanimlar = [];
  doc.context.enumerateIndirectObjects().forEach(([, o]) => { if (o instanceof PDFLib.PDFDict && String(o.get(PDFName.of('Type'))) === '/FontDescriptor') tanimlar.push(o); });
  assert.equal(tanimlar.length, 4);
  for (const t of tanimlar) assert.ok(t.get(PDFName.of('FontFile2')), 'FontFile2 (TrueType) var');
  assert.equal(fontlar.filter((f) => String(f.get(PDFName.of('Subtype'))) === '/Type1').length, 0, 'Standard 14 font yok');
});

test('pdf-yaz: dizgi çıktısı + resim; yalnız kullanılan stiller gömülür', async () => {
  const fk = { R: fontkit.create(TTF.R), I: fontkit.create(TTF.I), B: fontkit.create(TTF.B), BI: fontkit.create(TTF.BI) };
  const bl = [{ tur: 'paragraf', hiza: 'iki', dil: 'tr', parcalar: [{ metin: U.paragrafMetni(U.rastgele(3), 200) }] }, { tur: 'resim', resim: { anahtar: 'r', pikselGen: 40, pikselYuk: 30 } }];
  const r = D.diz(bl, { sayfaGen: 419.53, sayfaYuk: 595.28, kenar: { ust: 42.5, alt: 51, ic: 42.5, dis: 42.5 }, boy: 10.5, satirAraligi: 1.35, tireBol: true, sayfaNo: true }, D.fontkitOlcer(fk));
  const bayt = await PY.pdfYaz(r.sayfalar, { genPt: 419.53, yukPt: 595.28 }, { PDFLib, fontkit, fontlar: TTF, resimler: { r: { tur: 'png', bytes: U.pngUret(40, 30) } } });
  const doc = await PDFLib.PDFDocument.load(bayt);
  assert.equal(doc.getPageCount(), r.sayfalar.length);
  const tip0 = fontSozlukleri(doc).filter((f) => String(f.get(PDFLib.PDFName.of('Subtype'))) === '/Type0');
  assert.equal(tip0.length, 1, 'yalnız Regular kullanıldı');
  const resimVar = doc.getPages().some((p) => {
    const xo = p.node.Resources().lookup(PDFLib.PDFName.of('XObject'));
    return xo && xo.keys().length > 0;
  });
  assert.ok(resimVar, 'resim gömüldü');
});

test('pdf-yaz: kapsamDuzelt yazı tipinde olmayan karakteri ? yapar, Türkçeye dokunmaz', () => {
  const f = fontkit.create(TTF.R);
  const bl = [{ tur: 'paragraf', parcalar: [{ metin: 'ğüşıöçİ ÖĞÜŞÇ “—…” 漢 \u{1F600}' }, { kir: true }] }];
  const n = PY.kapsamDuzelt(bl, (cp) => f.hasGlyphForCodePoint(cp));
  assert.equal(n, 2);
  assert.equal(bl[0].parcalar[0].metin, 'ğüşıöçİ ÖĞÜŞÇ “—…” ? ?');
});

// ---- düzeltme testleri ----
test('pdf-yaz O3: başlığı geçerli, IDAT\'ı bozuk PNG atlanır ve sayılır; yazı tipi uyarısı yok, ham İngilizce hata yok', async () => {
  // senaryo: IHDR geçerli, IDAT bozuk
  const bozuk = Buffer.from('89504E470D0A1A0A0000000D49484452000000100000001008020000009091683600000010494441547801DEADBEEFDEADBEEFDEADBEEF00000000', 'hex');
  const uyarilar = [];
  const sayac = { atlananResim: 2 };
  const sayfalar = [
    { ogeler: [{ tur: 'metin', x: 10, y: 150, metin: 'Iğdır', stil: 'R', boy: 10 }, { tur: 'resim', x: 0, y: 0, w: 10, h: 10, anahtar: 'a' }, { tur: 'resim', x: 20, y: 0, w: 10, h: 10, anahtar: 'iyi' }] },
    { ogeler: [{ tur: 'resim', x: 0, y: 0, w: 10, h: 10, anahtar: 'a' }] }
  ];
  const bayt = await PY.pdfYaz(sayfalar, { genPt: 200, yukPt: 200 }, { PDFLib, fontkit, fontlar: TTF, resimler: { a: { tur: 'png', bytes: bozuk }, iyi: { tur: 'png', bytes: U.pngUret(4, 4) } }, uyarilar, sayac });
  assert.deepEqual(uyarilar, [], 'yazı tipi uyarısı yok');
  assert.equal(sayac.atlananResim, 3, 'aynı bozuk resim bir kez sayılır, önceki sayıya eklenir');
  const doc = await PDFLib.PDFDocument.load(bayt);
  assert.equal(doc.getPageCount(), 2);
});

test('pdf-yaz O3: yazı tipi dışı hata alt kümesiz yolu tetiklemez; kullanıcıya Türkçe mesaj', async () => {
  const uyarilar = [];
  let hata = null;
  const bozukPdfLib = Object.assign({}, PDFLib, { PDFDocument: { create: async () => { const d = await PDFLib.PDFDocument.create(); d.save = async () => { throw new TypeError("Cannot read properties of undefined (reading '0')"); }; return d; } } });
  try {
    await PY.pdfYaz([{ ogeler: [{ tur: 'metin', x: 10, y: 10, metin: 'a', stil: 'R', boy: 10 }] }], { genPt: 100, yukPt: 100 }, { PDFLib: bozukPdfLib, fontkit, fontlar: TTF, resimler: {}, uyarilar });
  } catch (e) { hata = e; }
  assert.ok(hata, 'hata atıldı');
  assert.doesNotMatch(hata.message, /Cannot read|undefined/, 'ham İngilizce metin yok: ' + hata.message);
  assert.match(hata.message, /^PDF yazılamadı/);
  assert.deepEqual(uyarilar, [], 'yazı tipi uyarısı eklenmedi (yedek yol çalışmadı)');
});

test('pdf-yaz O3: yazı tipi gömme hatasında alt kümesiz yedek yol çalışır ve Türkçe uyarı verir (ham metin yok)', async () => {
  const uyarilar = [];
  let deneme = 0;
  const pdfLibSahte = Object.assign({}, PDFLib, { PDFDocument: { create: async () => {
    const d = await PDFLib.PDFDocument.create();
    const ilk = deneme++ === 0;
    const eski = d.embedFont.bind(d);
    d.embedFont = async (b, s) => { const f = await eski(b, s); if (ilk) f.embed = async () => { throw new Error('subset failed: glyph 0'); }; return f; };
    return d;
  } } });
  const bayt = await PY.pdfYaz([{ ogeler: [{ tur: 'metin', x: 10, y: 10, metin: 'ğ', stil: 'R', boy: 10 }] }], { genPt: 100, yukPt: 100 }, { PDFLib: pdfLibSahte, fontkit, fontlar: TTF, resimler: {}, uyarilar });
  assert.equal(deneme, 2, 'iki kez yazıldı');
  assert.equal(uyarilar.length, 1);
  assert.match(uyarilar[0], /^Yazı tipi alt küme olarak gömülemedi; tam yazı tipi gömüldü/);
  assert.doesNotMatch(uyarilar[0], /subset failed/);
  assert.equal((await PDFLib.PDFDocument.load(bayt)).getPageCount(), 1);
});
