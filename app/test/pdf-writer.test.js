'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PY = require('../js/plugins/epub/pdf-writer.js');
const D = require('../js/plugins/epub/typeset.js');
const U = require('./epub-build.cjs');

const PDFLib = require('../vendor/pdf-lib/pdf-lib.min.js');
const fontkit = require('../vendor/fontkit/fontkit.umd.min.js');
const DIR = path.join(__dirname, '..', 'vendor', 'literata');
const TTF = {
  R: fs.readFileSync(path.join(DIR, 'Literata-Regular.ttf')), I: fs.readFileSync(path.join(DIR, 'Literata-Italic.ttf')),
  B: fs.readFileSync(path.join(DIR, 'Literata-Bold.ttf')), BI: fs.readFileSync(path.join(DIR, 'Literata-BoldItalic.ttf'))
};

function fontDictionaries(doc) {
  const { PDFName, PDFDict } = PDFLib;
  const l = [];
  doc.context.enumerateIndirectObjects().forEach(([, o]) => {
    if (o instanceof PDFDict && String(o.get(PDFName.of('Type'))) === '/Font') l.push(o);
  });
  return l;
}

test('pdf-write: 2 sayfalık SAYFA → 2 sayfa, ölçü doğru, Literata FontFile2 ile gömülü, Standard 14 yok', async () => {
  const pages = [
    { no: 1, elements: [{ kind: 'text', x: 40, y: 500, text: 'Iğdır’da', style: 'R', fontSize: 10.5, space: true }, { kind: 'text', x: 90, y: 500, text: 'ılık', style: 'I', fontSize: 10.5, space: false }] },
    { no: 2, elements: [{ kind: 'text', x: 40, y: 500, text: 'İSTANBUL ÖĞÜŞÇ', style: 'B', fontSize: 10.5, space: false }, { kind: 'text', x: 40, y: 480, text: 'ğüşıöçİ', style: 'BI', fontSize: 10.5, space: false }] }
  ];
  const warnings = [];
  const bytes = await PY.writePdf(pages, { genPt: 419.53, heightPt: 595.28, title: 'Deneme', writes: 'Mücellit', i18n: 'tr' }, { PDFLib, fontkit, fonts: TTF, thumbs: {}, warnings });
  assert.ok(bytes instanceof Uint8Array && bytes.length > 1000);
  assert.deepEqual(warnings, [], 'alt küme yedeğine düşülmedi');
  const doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 2);
  for (const p of doc.getPages()) { assert.ok(Math.abs(p.getWidth() - 419.53) < 0.01); assert.ok(Math.abs(p.getHeight() - 595.28) < 0.01); }
  assert.equal(doc.getTitle(), 'Deneme');
  assert.equal(doc.getProducer(), 'Mücellit EPUB');
  const fonts = fontDictionaries(doc);
  const { PDFName } = PDFLib;
  const tip0 = fonts.filter((f) => String(f.get(PDFName.of('Subtype'))) === '/Type0');
  assert.equal(tip0.length, 4, '4 stil gömülü');
  for (const f of tip0) assert.match(String(f.get(PDFName.of('BaseFont'))), /Literata/);
  const definitions = [];
  doc.context.enumerateIndirectObjects().forEach(([, o]) => { if (o instanceof PDFLib.PDFDict && String(o.get(PDFName.of('Type'))) === '/FontDescriptor') definitions.push(o); });
  assert.equal(definitions.length, 4);
  for (const t of definitions) assert.ok(t.get(PDFName.of('FontFile2')), 'FontFile2 (TrueType) var');
  assert.equal(fonts.filter((f) => String(f.get(PDFName.of('Subtype'))) === '/Type1').length, 0, 'Standard 14 font yok');
});

test('pdf-write: dizgi çıktısı + resim; yalnız kullanılan stiller gömülür', async () => {
  const fk = { R: fontkit.create(TTF.R), I: fontkit.create(TTF.I), B: fontkit.create(TTF.B), BI: fontkit.create(TTF.BI) };
  const bl = [{ kind: 'paragraph', align: 'iki', i18n: 'tr', parts: [{ text: U.paragraphText(U.random(3), 200) }] }, { kind: 'image', image: { key: 'r', pixelWidth: 40, pixelHeight: 30 } }];
  const r = D.impose(bl, { pageWidth: 419.53, pageHeight: 595.28, margin: { top: 42.5, bottom: 51, inner: 42.5, outer: 42.5 }, fontSize: 10.5, lineSpacing: 1.35, hyphenate: true, pageNumbers: true }, D.fontkitMeasurer(fk));
  const bytes = await PY.writePdf(r.pages, { genPt: 419.53, heightPt: 595.28 }, { PDFLib, fontkit, fonts: TTF, thumbs: { r: { kind: 'png', bytes: U.makePng(40, 30) } } });
  const doc = await PDFLib.PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), r.pages.length);
  const tip0 = fontDictionaries(doc).filter((f) => String(f.get(PDFLib.PDFName.of('Subtype'))) === '/Type0');
  assert.equal(tip0.length, 1, 'yalnız Regular kullanıldı');
  const hasImage = doc.getPages().some((p) => {
    const xo = p.node.Resources().lookup(PDFLib.PDFName.of('XObject'));
    return xo && xo.keys().length > 0;
  });
  assert.ok(hasImage, 'resim gömüldü');
});

test('pdf-write: fixScope yazı tipinde olmayan karakteri ? yapar, Türkçeye dokunmaz', () => {
  const f = fontkit.create(TTF.R);
  const bl = [{ kind: 'paragraph', parts: [{ text: 'ğüşıöçİ ÖĞÜŞÇ “—…” 漢 \u{1F600}' }, { lineBreak: true }] }];
  const n = PY.fixScope(bl, (cp) => f.hasGlyphForCodePoint(cp));
  assert.equal(n, 2);
  assert.equal(bl[0].parts[0].text, 'ğüşıöçİ ÖĞÜŞÇ “—…” ? ?');
});

// ---- düzeltme testleri ----
test('pdf-write O3: başlığı geçerli, IDAT\'ı bozuk PNG atlanır ve sayılır; yazı tipi uyarısı yok, ham İngilizce hata yok', async () => {
  // senaryo: IHDR geçerli, IDAT bozuk
  const corrupt = Buffer.from('89504E470D0A1A0A0000000D49484452000000100000001008020000009091683600000010494441547801DEADBEEFDEADBEEFDEADBEEF00000000', 'hex');
  const warnings = [];
  const counter = { skippedImage: 2 };
  const pages = [
    { elements: [{ kind: 'text', x: 10, y: 150, text: 'Iğdır', style: 'R', fontSize: 10 }, { kind: 'image', x: 0, y: 0, w: 10, h: 10, key: 'a' }, { kind: 'image', x: 20, y: 0, w: 10, h: 10, key: 'good' }] },
    { elements: [{ kind: 'image', x: 0, y: 0, w: 10, h: 10, key: 'a' }] }
  ];
  const bytes = await PY.writePdf(pages, { genPt: 200, heightPt: 200 }, { PDFLib, fontkit, fonts: TTF, thumbs: { a: { kind: 'png', bytes: corrupt }, good: { kind: 'png', bytes: U.makePng(4, 4) } }, warnings, counter });
  assert.deepEqual(warnings, [], 'yazı tipi uyarısı yok');
  assert.equal(counter.skippedImage, 3, 'aynı bozuk resim bir kez sayılır, önceki sayıya eklenir');
  const doc = await PDFLib.PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
});

test('pdf-write O3: yazı tipi dışı hata alt kümesiz yolu tetiklemez; kullanıcıya Türkçe mesaj', async () => {
  const warnings = [];
  let error = null;
  const corruptPdfLib = Object.assign({}, PDFLib, { PDFDocument: { create: async () => { const d = await PDFLib.PDFDocument.create(); d.save = async () => { throw new TypeError("Cannot read properties of undefined (reading '0')"); }; return d; } } });
  try {
    await PY.writePdf([{ elements: [{ kind: 'text', x: 10, y: 10, text: 'a', style: 'R', fontSize: 10 }] }], { genPt: 100, heightPt: 100 }, { PDFLib: corruptPdfLib, fontkit, fonts: TTF, thumbs: {}, warnings });
  } catch (e) { error = e; }
  assert.ok(error, 'hata atıldı');
  assert.doesNotMatch(error.message, /Cannot read|undefined/, 'ham İngilizce metin yok: ' + error.message);
  assert.match(error.message, /^PDF yazılamadı/);
  assert.deepEqual(warnings, [], 'yazı tipi uyarısı eklenmedi (yedek yol çalışmadı)');
});

test('pdf-write O3: yazı tipi gömme hatasında alt kümesiz yedek yol çalışır ve Türkçe uyarı verir (ham metin yok)', async () => {
  const warnings = [];
  let trial = 0;
  const pdfLibFake = Object.assign({}, PDFLib, { PDFDocument: { create: async () => {
    const d = await PDFLib.PDFDocument.create();
    const first = trial++ === 0;
    const old = d.embedFont.bind(d);
    d.embedFont = async (b, s) => { const f = await old(b, s); if (first) f.embed = async () => { throw new Error('subset failed: glyph 0'); }; return f; };
    return d;
  } } });
  const bytes = await PY.writePdf([{ elements: [{ kind: 'text', x: 10, y: 10, text: 'ğ', style: 'R', fontSize: 10 }] }], { genPt: 100, heightPt: 100 }, { PDFLib: pdfLibFake, fontkit, fonts: TTF, thumbs: {}, warnings });
  assert.equal(trial, 2, 'iki kez yazıldı');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Yazı tipi alt küme olarak gömülemedi; tam yazı tipi gömüldü/);
  assert.doesNotMatch(warnings[0], /subset failed/);
  assert.equal((await PDFLib.PDFDocument.load(bytes)).getPageCount(), 1);
});
