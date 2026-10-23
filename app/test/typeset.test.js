'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../js/plugins/epub/typeset.js');
const H = require('../js/plugins/epub/hyphenation.js');
const U = require('./epub-build.cjs');

// sahte ölçer: karakter başı boy/2 (boy 10 → 5 pt)
const FAKE = { width: (m, style, fontSize) => m.length * fontSize / 2 };
// 100×100 pt sayfa, 10 pt kenar → 80×80 alan; boy 10, satır aralığı 1 → satır 10 pt, sayfada 8 satır
const SMALL = { pageWidth: 100, pageHeight: 100, margin: { top: 10, bottom: 10, inner: 10, outer: 10 }, fontSize: 10, lineSpacing: 1, hyphenate: false, pageNumbers: false };
// "aaaa" = 20 pt, boşluk 5 pt → satırda 3 kelime (70 pt); 4. kelime sığmaz (95 pt)
function par(word, ek) { return Object.assign({ kind: 'paragraph', align: 'iki', indent: false, parts: [{ text: Array(word).fill('aaaa').join(' ') }] }, ek || {}); }

function lineNumbers(r) {
  return r.pages.map((s) => {
    const l = {};
    s.elements.filter((o) => o.kind === 'text' && o.role !== 'pageNumbers').forEach((o) => { l[o.block + ':' + o.line] = 1; });
    return Object.keys(l).length;
  });
}

test('dizgi (a): sahte ölçerle belirlenimci satır/sayfa sayıları', () => {
  assert.deepEqual(lineNumbers(D.impose([par(30)], SMALL, FAKE)), [8, 2], '10 satır → 8 + 2');
  assert.deepEqual(lineNumbers(D.impose([par(27)], SMALL, FAKE)), [7, 2], '9 satır → 7 + 2 (dul satır kalmaz)');
  assert.deepEqual(lineNumbers(D.impose([par(21), par(15)], SMALL, FAKE)), [7, 5], '7 + 5: ikinci paragrafın 1 satırı sayfa sonunda kalmaz (öksüz)');
  assert.deepEqual(lineNumbers(D.impose([par(18), par(9)], SMALL, FAKE)), [6, 3], '3 satırlık paragraf bölünmez');
  assert.deepEqual(lineNumbers(D.impose([par(6)], SMALL, FAKE)), [2]);
});

test('dizgi: bölüm başı ve sayfa sonu yeni sayfa açar, boş sayfa üretmez; sayfa no bölüm açılışında yok', () => {
  const r = D.impose([{ kind: 'chapterStart' }, par(3), { kind: 'chapterStart' }, { kind: 'pageEnd' }, par(3), { kind: 'pageEnd' }, par(3)], Object.assign({}, SMALL, { pageNumbers: true }), FAKE);
  assert.equal(r.pages.length, 3);
  assert.deepEqual(r.pages.map((s) => s.chapterStart), [true, true, false]);
  const numbers = r.pages.map((s) => s.elements.filter((o) => o.role === 'pageNumbers').map((o) => o.text));
  assert.deepEqual(numbers, [[], [], ['3']]);
  const no = r.pages[2].elements.find((o) => o.role === 'pageNumbers');
  assert.equal(no.y, 5, 'sayfa numarası alt kenarın ortasında');
  assert.equal(no.x + FAKE.width('3', 'R', 9) / 2, 50, 'yatayda ortada');
});

// gerçekçi Türkçe blok listesi
function turkishBlocks(seed, chapter, paragraph) {
  const r = U.random(seed);
  const l = [];
  for (let b = 0; b < chapter; b++) {
    l.push({ kind: 'chapterStart' });
    l.push({ kind: 'title', level: 1, parts: [{ text: 'Bölüm ' + (b + 1) }] });
    for (let p = 0; p < paragraph; p++) {
      l.push({ kind: 'paragraph', align: 'iki', indent: true, i18n: 'tr', parts: [
        { text: U.paragraphText(r, 30 + Math.floor(r() * 120)) + ' ' },
        { text: 'eğik bir söz', italic: true }, { text: ' ve ' }, { text: 'kalın', bold: true }, { text: "'ın sonu." }] });
      if (p % 7 === 3) l.push({ kind: 'separator' });
    }
  }
  return l;
}
const A5 = { pageWidth: 419.53, pageHeight: 595.28, margin: { top: 42.52, bottom: 51.02, inner: 42.52, outer: 42.52 }, fontSize: 10.5, lineSpacing: 1.35, hyphenate: true, pageNumbers: true };
const FIELD = { x: 42.52, w: 419.53 - 2 * 42.52, alt: 51.02, top: 595.28 - 42.52 };

function checks(r, blocks, measurer, label) {
  // (b) hiçbir öge metin alanı dışında değil (sayfa numarası alt kenarda, hariç)
  for (const s of r.pages) {
    for (const o of s.elements) {
      if (o.role === 'pageNumbers') continue;
      const w = o.kind === 'image' ? o.w : measurer.width(o.text, o.style, o.fontSize);
      assert.ok(o.x >= FIELD.x - 1e-6 && o.x + w <= FIELD.x + FIELD.w + 0.01, `${label}: yatayda alan dışı: ${o.text} x=${o.x} w=${w}`);
      assert.ok(o.y >= FIELD.alt - 1e-6 && o.y <= FIELD.top + 1e-6, `${label}: dikeyde alan dışı: ${o.text} y=${o.y}`);
    }
  }
  // satırları topla
  const line = new Map();
  r.pages.forEach((s, sn) => s.elements.filter((o) => o.kind === 'text' && o.role !== 'pageNumbers').forEach((o) => {
    const k = o.block + ':' + o.line;
    if (!line.has(k)) line.set(k, { block: o.block, line: o.line, page: sn, elements: [] });
    line.get(k).elements.push(o);
  }));
  const blockLineCount = {};
  for (const v of line.values()) blockLineCount[v.block] = Math.max(blockLineCount[v.block] || 0, v.line + 1);
  // (c) iki yana yaslı her satırın (son satır hariç, birden çok kelime) sağ kenarı = alan sağı ± 0,01
  let aged = 0;
  for (const v of line.values()) {
    const b = blocks[v.block];
    if (b.kind !== 'paragraph' || b.align !== 'iki' || v.line === blockLineCount[v.block] - 1) continue;
    const word = v.elements.filter((o) => o.space).length + 1;
    if (word < 2) continue;
    const right = Math.max(...v.elements.map((o) => o.x + measurer.width(o.text, o.style, o.fontSize)));
    assert.ok(Math.abs(right - (FIELD.x + FIELD.w)) <= 0.01, `${label}: yaslı satır sağ kenarı ${right} ≠ ${FIELD.x + FIELD.w} (block ${v.block} satır ${v.line})`);
    aged += 1;
  }
  assert.ok(aged > 20, `${label}: yaslı satır sayısı ${aged}`);
  // (d) bölünen paragrafın her sayfadaki parçası en az 2 satır (sayfa başında/sonunda tek satır yok)
  const part = {};
  for (const v of line.values()) { const k = v.block + '@' + v.page; part[k] = (part[k] || 0) + 1; }
  const blockPage = {};
  Object.keys(part).forEach((k) => { const [b] = k.split('@'); (blockPage[b] = blockPage[b] || []).push(part[k]); });
  let split = 0;
  Object.entries(blockPage).forEach(([b, l]) => {
    if (l.length < 2) return;
    split += 1;
    assert.ok(l.every((n) => n >= 2), `${label}: blok ${b} sayfalara ${JSON.stringify(l)} satır bölünmüş`);
  });
  // (e) her bolumBasi'dan sonraki ilk içerik yeni sayfanın ilk ögesi
  let chapter = 0;
  blocks.forEach((b, i) => {
    if (b.kind !== 'chapterStart') return;
    let j = i + 1;
    while (j < blocks.length && (blocks[j].kind === 'chapterStart' || blocks[j].kind === 'pageEnd')) j++;
    if (j >= blocks.length) return;
    const sn = r.pages.findIndex((s) => s.elements.some((o) => o.block === j));
    assert.ok(sn >= 0, `${label}: blok ${j} dizilmemiş`);
    const s = r.pages[sn];
    const first = s.elements.filter((o) => o.role !== 'pageNumbers')[0];
    assert.equal(first.block, j, `${label}: bölüm başı (blok ${i}) sonrası ilk öge yeni sayfanın başında değil (sayfa ${sn + 1})`);
    assert.equal(s.chapterStart, true);
    assert.ok(!s.elements.some((o) => o.role === 'pageNumbers'), 'bölüm açılış sayfasında numara yok');
    chapter += 1;
  });
  return { aged, split, chapter };
}

test('dizgi (b)–(e): Türkçe metinde alan, yaslama, dul/öksüz satır ve bölüm başı (sahte ölçer)', () => {
  const bl = turkishBlocks(1, 4, 25);
  const r = D.impose(bl, A5, FAKE);
  const d = checks(r, bl, FAKE, 'fake');
  assert.equal(d.chapter, 4);
  assert.ok(d.split >= 3, 'sayfa sınırında bölünen paragraf var: ' + d.split);
  assert.ok(r.pages.length >= 8);
});

test('dizgi: tire ile bölünen her kelime Türkçe hece noktasından bölünmüş', () => {
  const bl = turkishBlocks(5, 2, 30);
  const r = D.impose(bl, Object.assign({}, A5, { margin: { top: 42, bottom: 51, inner: 120, outer: 120 } }), FAKE);
  const texts = r.pages.flatMap((s) => s.elements.filter((o) => o.kind === 'text' && o.role !== 'pageNumbers'));
  let split = 0;
  texts.forEach((o, i) => {
    if (!/\p{L}-$/u.test(o.text) || o.space) return;
    const next = texts[i + 1];
    const all = o.text.slice(0, -1) + next.text;
    const k = o.text.length - 1;
    assert.ok(H.breakPoints(all).includes(k), `"${o.text}" + "${next.text}" geçerli hece noktası değil`);
    split += 1;
  });
  assert.ok(split > 5, 'dar sütunda tire ile bölünen kelime: ' + split);
  const closed = D.impose(bl, Object.assign({}, A5, { hyphenate: false, margin: { top: 42, bottom: 51, inner: 120, outer: 120 } }), FAKE);
  const hyphenated = closed.pages.flatMap((s) => s.elements).filter((o) => o.kind === 'text' && /\p{L}-$/u.test(o.text));
  assert.equal(hyphenated.length, 0, 'tire bölme kapalıyken tireli parça yok');
});

test('dizgi: <br> satır kırar ve o satır yaslanmaz; U+00A0 kırılmaz; uzun kelime alanı taşmaz', () => {
  const r = D.impose([{ kind: 'paragraph', align: 'iki', parts: [{ text: 'aa bb' }, { lineBreak: true }, { text: 'cc dd ee ff gg hh ii jj kk ll' }, { text: ' ' + 'x'.repeat(40) }] }], SMALL, FAKE);
  const o = r.pages[0].elements;
  assert.equal(o[0].text, 'aa'); assert.equal(o[1].text, 'bb');
  assert.equal(o[1].x, 10 + 15, '<br> öncesi satır sola yaslı');
  assert.ok(o.some((e) => e.text === 'cc dd'), 'U+00A0 ile bağlı kelimeler tek parça');
  for (const e of o) assert.ok(e.x + FAKE.width(e.text, e.style, e.fontSize) <= 90 + 1e-6, 'taşma: ' + e.text);
});

test('dizgi: resim alana sığdırılır, düşük dpi sayılır; imposeAsync aynı sonucu verir', async () => {
  const bl = [par(3), { kind: 'image', image: { key: 'r1', pixelWidth: 400, pixelHeight: 200 } }, { kind: 'image', image: { key: 'r2', pixelWidth: 60, pixelHeight: 20 } }, par(3)];
  const r = D.impose(bl, SMALL, FAKE);
  const res = r.pages.flatMap((s) => s.elements).filter((o) => o.kind === 'image');
  assert.deepEqual([res[0].w, res[0].h], [80, 40], '400×200 px (300 pt) alana (80 pt) küçültülür → 360 dpi');
  assert.deepEqual([res[1].w, res[1].h], [45, 15], '60×20 px 96 dpi boyutunda kalır (büyütülmez)');
  assert.equal(r.warnings.lowDpi, 1, 'yalnız 96 dpi resim 300 altında');
  const a = await D.imposeAsync(turkishBlocks(3, 3, 120), A5, FAKE);
  assert.deepEqual(a, D.impose(turkishBlocks(3, 3, 120), A5, FAKE));
});

test('dizgi (f): fontkit + Literata ile gerçek ölçer; Türkçe paragraf dizilir, iki koşu aynı', () => {
  const fontkit = require('../vendor/fontkit/fontkit.umd.min.js');
  const dir = path.join(__dirname, '..', 'vendor', 'literata');
  const load = (name) => fontkit.create(fs.readFileSync(path.join(dir, name)));
  const fonts = { R: load('Literata-Regular.ttf'), I: load('Literata-Italic.ttf'), B: load('Literata-Bold.ttf'), BI: load('Literata-BoldItalic.ttf') };
  const measurer = D.fontkitMeasurer(fonts);
  assert.ok(measurer.width('ğüşıöçİ', 'R', 10.5) > 0);
  assert.ok(measurer.width('fi', 'R', 10.5) > measurer.width('f', 'R', 10.5), 'liga kapalı: fi iki glif');
  const bl = turkishBlocks(9, 2, 20);
  const r1 = D.impose(bl, A5, measurer);
  const r2 = D.impose(turkishBlocks(9, 2, 20), A5, D.fontkitMeasurer(fonts));
  assert.deepEqual(r1, r2, 'deterministic');
  const d = checks(r1, bl, measurer, 'Literata');
  assert.equal(d.chapter, 2);
  const text = r1.pages.flatMap((s) => s.elements).filter((o) => o.kind === 'text').map((o) => o.text).join(' ');
  assert.match(text, /[ğüşıöçİ]/);
});

// ---- düzeltme testleri ----

test('dizgi O1: girinti alanı aşınca (40 em girinti, 32 em alan) boş satır üretilmez, ≤ 3 sayfa, < 1 s', () => {
  const measurer = { width: (t) => [...t].length * 5 };
  const settings = { pageWidth: 400, pageHeight: 600, margin: { top: 40, bottom: 40, inner: 40, outer: 40 }, fontSize: 10, lineSpacing: 1.2, hyphenate: true, pageNumbers: true };
  const t0 = Date.now();
  const r = D.impose([{ kind: 'paragraph', align: 'iki', indent: true, leftIndent: 40, i18n: 'tr', parts: [{ text: 'bir iki üç' }] }], settings, measurer);
  const sure = Date.now() - t0;
  assert.ok(r.pages.length <= 3, 'sayfa sayısı ' + r.pages.length);
  assert.ok(sure < 1000, 'süre ' + sure + ' ms');
  const text = r.pages.flatMap((s) => s.elements).filter((o) => o.kind === 'text' && o.role !== 'pageNumbers');
  assert.deepEqual(text.map((o) => o.text), ['bir', 'iki', 'üç'], 'üç kelime de basılır');
  for (const o of text) assert.ok(o.x >= 40 - 1e-6 && o.x + measurer.width(o.text) <= 360 + 1e-6, 'alan içinde: ' + o.text + ' x=' + o.x);
  // satırlar() doğrudan: her satırda en az bir öge (boş satır yok)
  const sl = D.rows({ kind: 'paragraph', align: 'iki', leftIndent: 30, rightIndent: 30, parts: [{ text: 'a bb ccc' }] }, 10, 320, settings, (m) => [...m].length * 5);
  assert.ok(sl.length >= 1 && sl.length <= 3 && sl.every((s) => s.elements.length > 0), 'satır sayısı ' + sl.length);
});

// gerçek fontkit + Literata; ölçülen toplam karakter bütçesi aşılırsa hemen hata (karesel yol testi uzun süre kilitlemesin)
function budgetedMeasurer(n) {
  const fontkit = require('../vendor/fontkit/fontkit.umd.min.js');
  const f = fontkit.create(fs.readFileSync(path.join(__dirname, '..', 'vendor', 'literata', 'Literata-Regular.ttf')));
  const inner = D.fontkitMeasurer({ R: f, I: f, B: f, BI: f });
  const o = { counted: 0, budget: 30 * n };
  o.width = (m, s, fontSize) => {
    o.counted += m.length;
    if (o.counted > o.budget) throw new Error(`ölçüm bütçesi aşıldı: ${o.counted} karakter (> 30 × ${n})`);
    return inner.width(m, s, fontSize);
  };
  return o;
}
function longWord(n, unit) { return unit.repeat(Math.ceil(n / unit.length)).slice(0, n); }
function base64Word(n) {
  const r = U.random(77), a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = ''; for (let i = 0; i < n; i++) s += a[Math.floor(r() * 64)];
  return s;
}

for (const [n, limit] of [[2000, 500], [10000, 2000]]) {
  test(`dizgi O2: boşluksuz ${n} karakter, gerçek Literata < ${limit} ms, metin korunur, ölçüm doğrusal`, () => {
    for (const text of [longWord(n, '?'), longWord(n, 'kitapsayfacilt'), base64Word(n)]) {
      const measurer = budgetedMeasurer(n);
      const t0 = Date.now();
      const r = D.impose([{ kind: 'paragraph', align: 'iki', indent: false, i18n: 'tr', parts: [{ text }] }], A5, measurer);
      const sure = Date.now() - t0;
      const elements = r.pages.flatMap((s) => s.elements).filter((o) => o.kind === 'text' && o.role !== 'pageNumbers');
      assert.equal(elements.map((o) => o.text.replace(/-$/, '')).join(''), text, 'metin eksiksiz');
      for (const o of elements) assert.ok(o.x + measurer.width(o.text, o.style, o.fontSize) <= FIELD.x + FIELD.w + 0.01, 'taşma');
      assert.ok(sure < limit, `${text.slice(0, 12)}…: ${sure} ms`);
    }
  });
}

test('dizgi O2: ölçüm önbelleği sınırlı (uzun metin saklanmaz, kısa metinde üst sınır)', () => {
  let call = 0;
  const measure = D.cachedMeasurer({ width: (m) => { call++; return m.length; } });
  for (let i = 0; i < 25000; i++) measure('k' + i, 'R', 10);
  assert.ok(measure.size() <= 20000, 'önbellek ' + measure.size());
  measure('x'.repeat(500), 'R', 10); measure('x'.repeat(500), 'R', 10);
  const once = call;
  measure('kısa', 'R', 10); measure('kısa', 'R', 10);
  assert.equal(call - once, 1, 'kısa metin önbellekten');
});

test('dizgi D3: ayraç boş sayfaya sığmasa da araya boş sayfa eklenmez (boy 24, satır aralığı 3, alan 56,7 pt)', () => {
  const settings = { pageWidth: 300, pageHeight: 56.7 + 20, margin: { top: 10, bottom: 10, inner: 20, outer: 20 }, fontSize: 24, lineSpacing: 3, hyphenate: false, pageNumbers: false };
  const r = D.impose([{ kind: 'separator' }, par(1), { kind: 'separator' }, { kind: 'separator' }], settings, FAKE);
  const blank = r.pages.filter((s) => s.elements.length === 0).length;
  assert.equal(blank, 0, 'boş sayfa: ' + blank + ' / ' + r.pages.length);
  assert.equal(r.pages.flatMap((s) => s.elements).filter((o) => o.text === '* * *').length, 3);
});

test('dizgi D-1: tireli kelimede de hece noktaları üretilir; her bölme hecede ve tireli', () => {
  const settings = { hyphenate: true, lineSpacing: 1, pageNumbers: false };
  const sl = D.rows({ kind: 'paragraph', align: 'left', i18n: 'tr', parts: [{ text: 'Türk-Amerikanlaştırılamayanlardan bir söz' }] }, 10, 80, settings, (m) => [...m].length * 5);
  const texts = sl.map((s) => s.elements.map((o) => o.text).join('').replace(/\s+/g, ' ').trim());
  const end = texts.slice(0, -1);
  assert.ok(end.every((m) => /-$/.test(m)), 'son satır dışında her satır tire ile biter: ' + JSON.stringify(texts));
  assert.equal(texts.join('').replace(/-/g, '').replace(/ /g, ''), 'TürkAmerikanlaştırılamayanlardanbirsöz'.replace(/-/g, ''), 'harf kaybı yok: ' + JSON.stringify(texts));
  assert.ok(texts.length >= 3 && texts.length <= 5, JSON.stringify(texts));
  // hece noktaları: hiçbir satır, hece dışı bir yerde tiresiz kesilmemiş olmalı
  const H2 = require('../js/plugins/epub/hyphenation.js');
  const word = 'Amerikanlaştırılamayanlardan';
  const nok = H2.breakPoints(word);
  const parts = texts.join(' ').replace(/ /g, '').split('-');
  let say = 0;
  parts.forEach((p) => { const k = word.indexOf(p); if (k > 0 && p.length > 3) { say += nok.includes(k) || nok.includes(k + p.length) ? 0 : 1; } });
  assert.equal(say, 0, 'bölmeler hece noktasında: ' + JSON.stringify(texts));
});
