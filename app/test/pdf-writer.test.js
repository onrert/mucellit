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

test('pdf-writer: a 2-page PAGE list → 2 pages, right size, Literata embedded as FontFile2, no Standard 14', async () => {
  const pages = [
    { no: 1, elements: [{ kind: 'text', x: 40, y: 500, text: 'Iğdır’da', style: 'R', fontSize: 10.5, space: true }, { kind: 'text', x: 90, y: 500, text: 'ılık', style: 'I', fontSize: 10.5, space: false }] },  // turkish-ok: Turkish test text
    { no: 2, elements: [{ kind: 'text', x: 40, y: 500, text: 'İSTANBUL ÖĞÜŞÇ', style: 'B', fontSize: 10.5, space: false }, { kind: 'text', x: 40, y: 480, text: 'ğüşıöçİ', style: 'BI', fontSize: 10.5, space: false }] }  // turkish-ok: Turkish test text
  ];
  const warnings = [];
  const bytes = await PY.writePdf(pages, { widthPt: 419.53, heightPt: 595.28, title: 'Test', author: 'Mücellit', lang: 'tr' }, { PDFLib, fontkit, fonts: TTF, images: {}, warnings });
  assert.ok(bytes instanceof Uint8Array && bytes.length > 1000);
  assert.deepEqual(warnings, [], 'did not fall back to the non-subset path');
  const doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 2);
  for (const p of doc.getPages()) { assert.ok(Math.abs(p.getWidth() - 419.53) < 0.01); assert.ok(Math.abs(p.getHeight() - 595.28) < 0.01); }
  assert.equal(doc.getTitle(), 'Test');
  assert.equal(doc.getProducer(), 'Mücellit EPUB');
  const fonts = fontDictionaries(doc);
  const { PDFName } = PDFLib;
  const type0 = fonts.filter((f) => String(f.get(PDFName.of('Subtype'))) === '/Type0');
  assert.equal(type0.length, 4, '4 styles embedded');
  for (const f of type0) assert.match(String(f.get(PDFName.of('BaseFont'))), /Literata/);
  const definitions = [];
  doc.context.enumerateIndirectObjects().forEach(([, o]) => { if (o instanceof PDFLib.PDFDict && String(o.get(PDFName.of('Type'))) === '/FontDescriptor') definitions.push(o); });
  assert.equal(definitions.length, 4);
  for (const t of definitions) assert.ok(t.get(PDFName.of('FontFile2')), 'FontFile2 (TrueType) var');
  assert.equal(fonts.filter((f) => String(f.get(PDFName.of('Subtype'))) === '/Type1').length, 0, 'no Standard 14 font');
});

test('pdf-writer: typeset output + image; only the styles used are embedded', async () => {
  const fk = { R: fontkit.create(TTF.R), I: fontkit.create(TTF.I), B: fontkit.create(TTF.B), BI: fontkit.create(TTF.BI) };
  const bl = [{ kind: 'paragraph', align: 'justify', lang: 'tr', parts: [{ text: U.paragraphText(U.random(3), 200) }] }, { kind: 'image', image: { key: 'r', pixelWidth: 40, pixelHeight: 30 } }];
  const r = D.typeset(bl, { pageWidth: 419.53, pageHeight: 595.28, margin: { top: 42.5, bottom: 51, inner: 42.5, outer: 42.5 }, fontSize: 10.5, lineSpacing: 1.35, hyphenate: true, pageNumbers: true }, D.fontkitMeasurer(fk));
  const bytes = await PY.writePdf(r.pages, { widthPt: 419.53, heightPt: 595.28 }, { PDFLib, fontkit, fonts: TTF, images: { r: { kind: 'png', bytes: U.makePng(40, 30) } } });
  const doc = await PDFLib.PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), r.pages.length);
  const type0 = fontDictionaries(doc).filter((f) => String(f.get(PDFLib.PDFName.of('Subtype'))) === '/Type0');
  assert.equal(type0.length, 1, 'only Regular was used');
  const hasImage = doc.getPages().some((p) => {
    const xo = p.node.Resources().lookup(PDFLib.PDFName.of('XObject'));
    return xo && xo.keys().length > 0;
  });
  assert.ok(hasImage, 'image embedded');
});

test('pdf-writer: fixScope turns a character missing from the font into ?, leaves Turkish alone', () => {
  const f = fontkit.create(TTF.R);
  const bl = [{ kind: 'paragraph', parts: [{ text: 'ğüşıöçİ ÖĞÜŞÇ “—…” 漢 \u{1F600}' }, { lineBreak: true }] }];  // turkish-ok: Turkish test text
  const n = PY.fixScope(bl, (cp) => f.hasGlyphForCodePoint(cp));
  assert.equal(n, 2);
  assert.equal(bl[0].parts[0].text, 'ğüşıöçİ ÖĞÜŞÇ “—…” ? ?');  // turkish-ok: Turkish test text
});

// ---- fix tests ----
test('pdf-writer O3: a PNG with a valid header and a broken IDAT is skipped and counted; no font warning, no raw English error', async () => {
  // scenario: IHDR valid, IDAT broken
  const corrupt = Buffer.from('89504E470D0A1A0A0000000D49484452000000100000001008020000009091683600000010494441547801DEADBEEFDEADBEEFDEADBEEF00000000', 'hex');
  const warnings = [];
  const counter = { skippedImage: 2 };
  const pages = [
    { elements: [{ kind: 'text', x: 10, y: 150, text: 'Iğdır', style: 'R', fontSize: 10 }, { kind: 'image', x: 0, y: 0, w: 10, h: 10, key: 'a' }, { kind: 'image', x: 20, y: 0, w: 10, h: 10, key: 'good' }] },  // turkish-ok: Turkish test text
    { elements: [{ kind: 'image', x: 0, y: 0, w: 10, h: 10, key: 'a' }] }
  ];
  const bytes = await PY.writePdf(pages, { widthPt: 200, heightPt: 200 }, { PDFLib, fontkit, fonts: TTF, images: { a: { kind: 'png', bytes: corrupt }, good: { kind: 'png', bytes: U.makePng(4, 4) } }, warnings, counter });
  assert.deepEqual(warnings, [], 'no font warning');
  assert.equal(counter.skippedImage, 3, 'the same broken image is counted once and added to the earlier count');
  const doc = await PDFLib.PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
});

test('pdf-writer O3: an error that is not about the font does not start the non-subset path; a Turkish message for the user', async () => {
  const warnings = [];
  let error = null;
  const corruptPdfLib = Object.assign({}, PDFLib, { PDFDocument: { create: async () => { const d = await PDFLib.PDFDocument.create(); d.save = async () => { throw new TypeError("Cannot read properties of undefined (reading '0')"); }; return d; } } });
  try {
    await PY.writePdf([{ elements: [{ kind: 'text', x: 10, y: 10, text: 'a', style: 'R', fontSize: 10 }] }], { widthPt: 100, heightPt: 100 }, { PDFLib: corruptPdfLib, fontkit, fonts: TTF, images: {}, warnings });
  } catch (e) { error = e; }
  assert.ok(error, 'an error was thrown');
  assert.doesNotMatch(error.message, /Cannot read|undefined/, 'no raw English text: ' + error.message);
  assert.match(error.message, /^PDF yazılamadı/);  // turkish-ok: expected Turkish UI text
  assert.deepEqual(warnings, [], 'no font warning added (the fallback path did not run)');
});

test('pdf-writer O3: when embedding the font fails the non-subset fallback runs and gives a Turkish warning (no raw text)', async () => {
  const warnings = [];
  let trial = 0;
  const pdfLibFake = Object.assign({}, PDFLib, { PDFDocument: { create: async () => {
    const d = await PDFLib.PDFDocument.create();
    const first = trial++ === 0;
    const old = d.embedFont.bind(d);
    d.embedFont = async (b, s) => { const f = await old(b, s); if (first) f.embed = async () => { throw new Error('subset failed: glyph 0'); }; return f; };
    return d;
  } } });
  const bytes = await PY.writePdf([{ elements: [{ kind: 'text', x: 10, y: 10, text: 'ğ', style: 'R', fontSize: 10 }] }], { widthPt: 100, heightPt: 100 }, { PDFLib: pdfLibFake, fontkit, fonts: TTF, images: {}, warnings });  // turkish-ok: Turkish test text
  assert.equal(trial, 2, 'written twice');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Yazı tipi alt küme olarak gömülemedi; tam yazı tipi gömüldü/);  // turkish-ok: expected Turkish UI text
  assert.doesNotMatch(warnings[0], /subset failed/);
  assert.equal((await PDFLib.PDFDocument.load(bytes)).getPageCount(), 1);
});
