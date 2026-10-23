'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../js/plugins/epub/typeset.js');
const H = require('../js/plugins/epub/hyphenation.js');
const U = require('./epub-build.cjs');

// fake measurer: fontSize/2 per character (size 10 → 5 pt)
const FAKE = { width: (m, style, fontSize) => m.length * fontSize / 2 };
// 100×100 pt page, 10 pt margins → 80×80 area; size 10, line spacing 1 → a line is 10 pt, 8 lines on a page
const SMALL = { pageWidth: 100, pageHeight: 100, margin: { top: 10, bottom: 10, inner: 10, outer: 10 }, fontSize: 10, lineSpacing: 1, hyphenate: false, pageNumbers: false };
// "aaaa" = 20 pt, space 5 pt → 3 words on a line (70 pt); the 4th word does not fit (95 pt)
function par(word, ek) { return Object.assign({ kind: 'paragraph', align: 'justify', indent: false, parts: [{ text: Array(word).fill('aaaa').join(' ') }] }, ek || {}); }

function lineNumbers(r) {
  return r.pages.map((s) => {
    const l = {};
    s.elements.filter((o) => o.kind === 'text' && o.role !== 'pageNumbers').forEach((o) => { l[o.block + ':' + o.line] = 1; });
    return Object.keys(l).length;
  });
}

test('typeset (a): deterministic line/page counts with the fake measurer', () => {
  assert.deepEqual(lineNumbers(D.typeset([par(30)], SMALL, FAKE)), [8, 2], '10 lines → 8 + 2');
  assert.deepEqual(lineNumbers(D.typeset([par(27)], SMALL, FAKE)), [7, 2], '9 lines → 7 + 2 (no widow line)');
  assert.deepEqual(lineNumbers(D.typeset([par(21), par(15)], SMALL, FAKE)), [7, 5], '7 + 5: the 1 line of the second paragraph is not left at the end of the page (orphan)');
  assert.deepEqual(lineNumbers(D.typeset([par(18), par(9)], SMALL, FAKE)), [6, 3], 'a 3-line paragraph is not split');
  assert.deepEqual(lineNumbers(D.typeset([par(6)], SMALL, FAKE)), [2]);
});

test('typeset: chapter start and page end open a new page, no blank page; no page number on the chapter opening', () => {
  const r = D.typeset([{ kind: 'chapterStart' }, par(3), { kind: 'chapterStart' }, { kind: 'pageEnd' }, par(3), { kind: 'pageEnd' }, par(3)], Object.assign({}, SMALL, { pageNumbers: true }), FAKE);
  assert.equal(r.pages.length, 3);
  assert.deepEqual(r.pages.map((s) => s.chapterStart), [true, true, false]);
  const numbers = r.pages.map((s) => s.elements.filter((o) => o.role === 'pageNumbers').map((o) => o.text));
  assert.deepEqual(numbers, [[], [], ['3']]);
  const no = r.pages[2].elements.find((o) => o.role === 'pageNumbers');
  assert.equal(no.y, 5, 'page number in the middle of the bottom margin');
  assert.equal(no.x + FAKE.width('3', 'R', 9) / 2, 50, 'yatayda ortada');
});

// a realistic Turkish block list
function turkishBlocks(seed, chapter, paragraph) {
  const r = U.random(seed);
  const l = [];
  for (let b = 0; b < chapter; b++) {
    l.push({ kind: 'chapterStart' });
    l.push({ kind: 'title', level: 1, parts: [{ text: 'Bölüm ' + (b + 1) }] });  // turkish-ok: Turkish test text
    for (let p = 0; p < paragraph; p++) {
      l.push({ kind: 'paragraph', align: 'justify', indent: true, lang: 'tr', parts: [
        { text: U.paragraphText(r, 30 + Math.floor(r() * 120)) + ' ' },
        { text: 'eğik bir söz', italic: true }, { text: ' ve ' }, { text: 'kalın', bold: true }, { text: "'ın sonu." }] });  // turkish-ok: Turkish test text
      if (p % 7 === 3) l.push({ kind: 'separator' });
    }
  }
  return l;
}
const A5 = { pageWidth: 419.53, pageHeight: 595.28, margin: { top: 42.52, bottom: 51.02, inner: 42.52, outer: 42.52 }, fontSize: 10.5, lineSpacing: 1.35, hyphenate: true, pageNumbers: true };
const FIELD = { x: 42.52, w: 419.53 - 2 * 42.52, alt: 51.02, top: 595.28 - 42.52 };

function checks(r, blocks, measurer, label) {
  // (b) no element is outside the text area (except the page number in the bottom margin)
  for (const s of r.pages) {
    for (const o of s.elements) {
      if (o.role === 'pageNumbers') continue;
      const w = o.kind === 'image' ? o.w : measurer.width(o.text, o.style, o.fontSize);
      assert.ok(o.x >= FIELD.x - 1e-6 && o.x + w <= FIELD.x + FIELD.w + 0.01, `${label}: outside the area horizontally: ${o.text} x=${o.x} w=${w}`);
      assert.ok(o.y >= FIELD.alt - 1e-6 && o.y <= FIELD.top + 1e-6, `${label}: outside the area vertically: ${o.text} y=${o.y}`);
    }
  }
  // gather the lines
  const line = new Map();
  r.pages.forEach((s, sn) => s.elements.filter((o) => o.kind === 'text' && o.role !== 'pageNumbers').forEach((o) => {
    const k = o.block + ':' + o.line;
    if (!line.has(k)) line.set(k, { block: o.block, line: o.line, page: sn, elements: [] });
    line.get(k).elements.push(o);
  }));
  const blockLineCount = {};
  for (const v of line.values()) blockLineCount[v.block] = Math.max(blockLineCount[v.block] || 0, v.line + 1);
  // (c) the right edge of every justified line (except the last line, more than one word) = right of the area ± 0.01
  let aged = 0;
  for (const v of line.values()) {
    const b = blocks[v.block];
    if (b.kind !== 'paragraph' || b.align !== 'justify' || v.line === blockLineCount[v.block] - 1) continue;
    const word = v.elements.filter((o) => o.space).length + 1;
    if (word < 2) continue;
    const right = Math.max(...v.elements.map((o) => o.x + measurer.width(o.text, o.style, o.fontSize)));
    assert.ok(Math.abs(right - (FIELD.x + FIELD.w)) <= 0.01, `${label}: right edge of a justified line ${right} ≠ ${FIELD.x + FIELD.w} (block ${v.block} line ${v.line})`);
    aged += 1;
  }
  assert.ok(aged > 20, `${label}: number of justified lines ${aged}`);
  // (d) the part of a split paragraph on each page is at least 2 lines (no single line at the top/bottom of a page)
  const part = {};
  for (const v of line.values()) { const k = v.block + '@' + v.page; part[k] = (part[k] || 0) + 1; }
  const blockPage = {};
  Object.keys(part).forEach((k) => { const [b] = k.split('@'); (blockPage[b] = blockPage[b] || []).push(part[k]); });
  let split = 0;
  Object.entries(blockPage).forEach(([b, l]) => {
    if (l.length < 2) return;
    split += 1;
    assert.ok(l.every((n) => n >= 2), `${label}: block ${b} sayfalara ${JSON.stringify(l)} line split`);
  });
  // (e) the first content after every chapterStart is the first element of a new page
  let chapter = 0;
  blocks.forEach((b, i) => {
    if (b.kind !== 'chapterStart') return;
    let j = i + 1;
    while (j < blocks.length && (blocks[j].kind === 'chapterStart' || blocks[j].kind === 'pageEnd')) j++;
    if (j >= blocks.length) return;
    const sn = r.pages.findIndex((s) => s.elements.some((o) => o.block === j));
    assert.ok(sn >= 0, `${label}: block ${j} not laid out`);
    const s = r.pages[sn];
    const first = s.elements.filter((o) => o.role !== 'pageNumbers')[0];
    assert.equal(first.block, j, `${label}: chapter start (block ${i}) the first element after it is not at the top of a new page (page ${sn + 1})`);
    assert.equal(s.chapterStart, true);
    assert.ok(!s.elements.some((o) => o.role === 'pageNumbers'), 'no number on the chapter opening page');
    chapter += 1;
  });
  return { aged, split, chapter };
}

test('typeset (b)–(e): area, justification, widow/orphan lines and chapter start on Turkish text (fake measurer)', () => {
  const bl = turkishBlocks(1, 4, 25);
  const r = D.typeset(bl, A5, FAKE);
  const d = checks(r, bl, FAKE, 'fake');
  assert.equal(d.chapter, 4);
  assert.ok(d.split >= 3, 'there is a paragraph split at a page boundary: ' + d.split);
  assert.ok(r.pages.length >= 8);
});

test('typeset: every word split with a hyphen is split at a Turkish hyphenation point', () => {
  const bl = turkishBlocks(5, 2, 30);
  const r = D.typeset(bl, Object.assign({}, A5, { margin: { top: 42, bottom: 51, inner: 120, outer: 120 } }), FAKE);
  const texts = r.pages.flatMap((s) => s.elements.filter((o) => o.kind === 'text' && o.role !== 'pageNumbers'));
  let split = 0;
  texts.forEach((o, i) => {
    if (!/\p{L}-$/u.test(o.text) || o.space) return;
    const next = texts[i + 1];
    const all = o.text.slice(0, -1) + next.text;
    const k = o.text.length - 1;
    assert.ok(H.breakPoints(all).includes(k), `"${o.text}" + "${next.text}" is not a valid hyphenation point`);
    split += 1;
  });
  assert.ok(split > 5, 'a word split with a hyphen in a narrow column: ' + split);
  const closed = D.typeset(bl, Object.assign({}, A5, { hyphenate: false, margin: { top: 42, bottom: 51, inner: 120, outer: 120 } }), FAKE);
  const hyphenated = closed.pages.flatMap((s) => s.elements).filter((o) => o.kind === 'text' && /\p{L}-$/u.test(o.text));
  assert.equal(hyphenated.length, 0, 'no hyphenated part when hyphenation is off');
});

test('typeset: <br> breaks the line and that line is not justified; U+00A0 does not break; a long word does not overflow the area', () => {
  const r = D.typeset([{ kind: 'paragraph', align: 'justify', parts: [{ text: 'aa bb' }, { lineBreak: true }, { text: 'cc dd ee ff gg hh ii jj kk ll' }, { text: ' ' + 'x'.repeat(40) }] }], SMALL, FAKE);
  const o = r.pages[0].elements;
  assert.equal(o[0].text, 'aa'); assert.equal(o[1].text, 'bb');
  assert.equal(o[1].x, 10 + 15, 'the line before <br> is left aligned');
  assert.ok(o.some((e) => e.text === 'cc dd'), 'words joined with U+00A0 are one part');
  for (const e of o) assert.ok(e.x + FAKE.width(e.text, e.style, e.fontSize) <= 90 + 1e-6, 'overflow: ' + e.text);
});

test('typeset: an image is fitted to the area, low dpi is counted; typesetAsync gives the same result', async () => {
  const bl = [par(3), { kind: 'image', image: { key: 'r1', pixelWidth: 400, pixelHeight: 200 } }, { kind: 'image', image: { key: 'r2', pixelWidth: 60, pixelHeight: 20 } }, par(3)];
  const r = D.typeset(bl, SMALL, FAKE);
  const res = r.pages.flatMap((s) => s.elements).filter((o) => o.kind === 'image');
  assert.deepEqual([res[0].w, res[0].h], [80, 40], '400×200 px (300 pt) is shrunk to the area (80 pt) → 360 dpi');
  assert.deepEqual([res[1].w, res[1].h], [45, 15], '60×20 px stays at its 96 dpi size (not enlarged)');
  assert.equal(r.warnings.lowDpi, 1, 'only the 96 dpi image is under 300');
  const a = await D.typesetAsync(turkishBlocks(3, 3, 120), A5, FAKE);
  assert.deepEqual(a, D.typeset(turkishBlocks(3, 3, 120), A5, FAKE));
});

test('typeset (f): real measurer with fontkit + Literata; a Turkish paragraph is laid out, two runs are the same', () => {
  const fontkit = require('../vendor/fontkit/fontkit.umd.min.js');
  const dir = path.join(__dirname, '..', 'vendor', 'literata');
  const load = (name) => fontkit.create(fs.readFileSync(path.join(dir, name)));
  const fonts = { R: load('Literata-Regular.ttf'), I: load('Literata-Italic.ttf'), B: load('Literata-Bold.ttf'), BI: load('Literata-BoldItalic.ttf') };
  const measurer = D.fontkitMeasurer(fonts);
  assert.ok(measurer.width('ğüşıöçİ', 'R', 10.5) > 0);  // turkish-ok: Turkish test text
  assert.ok(measurer.width('fi', 'R', 10.5) > measurer.width('f', 'R', 10.5), 'liga off: fi is two glyphs');
  const bl = turkishBlocks(9, 2, 20);
  const r1 = D.typeset(bl, A5, measurer);
  const r2 = D.typeset(turkishBlocks(9, 2, 20), A5, D.fontkitMeasurer(fonts));
  assert.deepEqual(r1, r2, 'deterministic');
  const d = checks(r1, bl, measurer, 'Literata');
  assert.equal(d.chapter, 2);
  const text = r1.pages.flatMap((s) => s.elements).filter((o) => o.kind === 'text').map((o) => o.text).join(' ');
  assert.match(text, /[ğüşıöçİ]/);  // turkish-ok: Turkish test text
});

// ---- fix tests ----

test('typeset O1: when the indent passes the area (40 em indent, 32 em area) no empty line is made, ≤ 3 pages, < 1 s', () => {
  const measurer = { width: (t) => [...t].length * 5 };
  const settings = { pageWidth: 400, pageHeight: 600, margin: { top: 40, bottom: 40, inner: 40, outer: 40 }, fontSize: 10, lineSpacing: 1.2, hyphenate: true, pageNumbers: true };
  const t0 = Date.now();
  const r = D.typeset([{ kind: 'paragraph', align: 'justify', indent: true, leftIndent: 40, lang: 'tr', parts: [{ text: 'bir iki üç' }] }], settings, measurer);  // turkish-ok: Turkish test text
  const duration = Date.now() - t0;
  assert.ok(r.pages.length <= 3, 'page count ' + r.pages.length);
  assert.ok(duration < 1000, 'duration ' + duration + ' ms');
  const text = r.pages.flatMap((s) => s.elements).filter((o) => o.kind === 'text' && o.role !== 'pageNumbers');
  assert.deepEqual(text.map((o) => o.text), ['bir', 'iki', 'üç'], 'all three words are printed');  // turkish-ok: Turkish test text
  for (const o of text) assert.ok(o.x >= 40 - 1e-6 && o.x + measurer.width(o.text) <= 360 + 1e-6, 'inside the area: ' + o.text + ' x=' + o.x);
  // rows() directly: at least one element on every line (no empty line)
  const sl = D.rows({ kind: 'paragraph', align: 'justify', leftIndent: 30, rightIndent: 30, parts: [{ text: 'a bb ccc' }] }, 10, 320, settings, (m) => [...m].length * 5);
  assert.ok(sl.length >= 1 && sl.length <= 3 && sl.every((s) => s.elements.length > 0), 'line count ' + sl.length);
});

// real fontkit + Literata; if the measured total character budget is passed it fails at once (a quadratic path must not lock the test for long)
function budgetedMeasurer(n) {
  const fontkit = require('../vendor/fontkit/fontkit.umd.min.js');
  const f = fontkit.create(fs.readFileSync(path.join(__dirname, '..', 'vendor', 'literata', 'Literata-Regular.ttf')));
  const inner = D.fontkitMeasurer({ R: f, I: f, B: f, BI: f });
  const o = { counted: 0, budget: 30 * n };
  o.width = (m, s, fontSize) => {
    o.counted += m.length;
    if (o.counted > o.budget) throw new Error(`measurement budget passed: ${o.counted} characters (> 30 × ${n})`);
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
  test(`typeset O2: ${n} characters without spaces, real Literata < ${limit} ms, the text is kept, measuring is linear`, () => {
    for (const text of [longWord(n, '?'), longWord(n, 'kitapsayfacilt'), base64Word(n)]) {
      const measurer = budgetedMeasurer(n);
      const t0 = Date.now();
      const r = D.typeset([{ kind: 'paragraph', align: 'justify', indent: false, lang: 'tr', parts: [{ text }] }], A5, measurer);
      const duration = Date.now() - t0;
      const elements = r.pages.flatMap((s) => s.elements).filter((o) => o.kind === 'text' && o.role !== 'pageNumbers');
      assert.equal(elements.map((o) => o.text.replace(/-$/, '')).join(''), text, 'text complete');
      for (const o of elements) assert.ok(o.x + measurer.width(o.text, o.style, o.fontSize) <= FIELD.x + FIELD.w + 0.01, 'overflow');
      assert.ok(duration < limit, `${text.slice(0, 12)}…: ${duration} ms`);
    }
  });
}

test('typeset O2: the measurement cache is limited (long text is not kept, an upper limit for short text)', () => {
  let call = 0;
  const measure = D.cachedMeasurer({ width: (m) => { call++; return m.length; } });
  for (let i = 0; i < 25000; i++) measure('k' + i, 'R', 10);
  assert.ok(measure.size() <= 20000, 'cache ' + measure.size());
  measure('x'.repeat(500), 'R', 10); measure('x'.repeat(500), 'R', 10);
  const once = call;
  measure('kısa', 'R', 10); measure('kısa', 'R', 10);  // turkish-ok: Turkish test text
  assert.equal(call - once, 1, 'short text from the cache');
});

test('typeset D3: a separator that does not fit an empty page adds no blank page in between (size 24, line spacing 3, area 56.7 pt)', () => {
  const settings = { pageWidth: 300, pageHeight: 56.7 + 20, margin: { top: 10, bottom: 10, inner: 20, outer: 20 }, fontSize: 24, lineSpacing: 3, hyphenate: false, pageNumbers: false };
  const r = D.typeset([{ kind: 'separator' }, par(1), { kind: 'separator' }, { kind: 'separator' }], settings, FAKE);
  const blank = r.pages.filter((s) => s.elements.length === 0).length;
  assert.equal(blank, 0, 'blank page: ' + blank + ' / ' + r.pages.length);
  assert.equal(r.pages.flatMap((s) => s.elements).filter((o) => o.text === '* * *').length, 3);
});

test('typeset D-1: hyphenation points are made in a hyphenated word too; every split at a syllable and hyphenated', () => {
  const settings = { hyphenate: true, lineSpacing: 1, pageNumbers: false };
  const sl = D.rows({ kind: 'paragraph', align: 'left', lang: 'tr', parts: [{ text: 'Türk-Amerikanlaştırılamayanlardan bir söz' }] }, 10, 80, settings, (m) => [...m].length * 5);  // turkish-ok: Turkish test text
  const texts = sl.map((s) => s.elements.map((o) => o.text).join('').replace(/\s+/g, ' ').trim());
  const end = texts.slice(0, -1);
  assert.ok(end.every((m) => /-$/.test(m)), 'every line except the last ends with a hyphen: ' + JSON.stringify(texts));
  assert.equal(texts.join('').replace(/-/g, '').replace(/ /g, ''), 'TürkAmerikanlaştırılamayanlardanbirsöz'.replace(/-/g, ''), 'no letter lost: ' + JSON.stringify(texts));  // turkish-ok: Turkish test text
  assert.ok(texts.length >= 3 && texts.length <= 5, JSON.stringify(texts));
  // hyphenation points: no line may be cut without a hyphen at a place that is not a syllable boundary
  const H2 = require('../js/plugins/epub/hyphenation.js');
  const word = 'Amerikanlaştırılamayanlardan';  // turkish-ok: Turkish test text
  const points = H2.breakPoints(word);
  const parts = texts.join(' ').replace(/ /g, '').split('-');
  let count = 0;
  parts.forEach((p) => { const k = word.indexOf(p); if (k > 0 && p.length > 3) { count += points.includes(k) || points.includes(k + p.length) ? 0 : 1; } });
  assert.equal(count, 0, 'splits at hyphenation points: ' + JSON.stringify(texts));
});
