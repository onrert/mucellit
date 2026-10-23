'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../js/calc.js');

test('200 sayfa → 100 yaprak; 0.1 mm kağıtla sırt 10 mm', () => {
  assert.equal(h.leafCount(200), 100);
  assert.equal(h.spineThicknessOf(100, 0.1), 10);
  const r = h.calculate({ pageCount: 200, bindingType: 'single1', paperThickness: 0.1 });
  assert.equal(r.leaves, 100);
  assert.equal(r.spineThickness, 10);
  assert.equal(r.printSheets, 100);
});

test('forza payı sırta eklenir; tek sayı sayfa yukarı yuvarlanır', () => {
  assert.equal(h.spineThicknessOf(100, 0.1, 1.5), 11.5);
  assert.equal(h.leafCount(201), 101);
});

test('formalı: boş sayfalar sırta dahil, forma ve kağıt adedi', () => {
  const r = h.calculate({ pageCount: 200, bindingType: 'sewn', sheetsPerSignature: 4, paperThickness: 0.1 });
  assert.equal(r.totalPages, 208);
  assert.equal(r.signatureCount, 13);
  assert.equal(r.leaves, 104);
  assert.equal(r.spineThickness, 10.4);
  assert.equal(r.printSheets, 52);
  assert.equal(r.blankPages, 8);
});

test('2-up kağıt adedi = toplam / 4', () => {
  const r = h.calculate({ pageCount: 37, bindingType: 'single2' });
  assert.equal(r.totalPages, 40);
  assert.equal(r.printSheets, 10);
});

// S = 120 yaprak × 0,1 = 12 mm
const BASE = { pageCount: 240, bindingType: 'single1', paperThickness: 0.1, bookWidth: 148, bookHeight: 210, boardThickness: 2, square: 3, turnIn: 15 };

test('sert kapak: düz sırt, S+2t → mukavva 144×216, sırt şeridi 16×216, mafsal 7, kaplama 352×250', () => {
  const r = h.calculate(BASE);
  assert.equal(r.spineThickness, 12);
  assert.deepEqual(r.board, { width: 144, height: 216, count: 2 });
  assert.deepEqual(r.spineStrip, { width: 16, height: 216, count: 1 });
  assert.equal(r.jointGap, 7);
  assert.equal(r.coveringJointGap, 7);
  assert.deepEqual(r.covering, { width: 352, height: 250 });
});

test('sert kapak: "yalnız S" kuralı → şerit 12, kaplamada mafsal 9, kaplama yine 352×250', () => {
  const r = h.calculate({ ...BASE, spineRule: 'onlyS' });
  assert.deepEqual(r.spineStrip, { width: 12, height: 216, count: 1 });
  assert.equal(r.jointGap, 7);
  assert.equal(r.coveringJointGap, 9);
  assert.deepEqual(r.board, { width: 144, height: 216, count: 2 });
  assert.deepEqual(r.covering, { width: 352, height: 250 });
});

test('otomatik mafsal: t=1 → 6, t=2.5 → 8, t=4 → 9 ve kaynak yok bayrağı', () => {
  assert.equal(h.calculate({ ...BASE, boardThickness: 1 }).jointGap, 6);
  assert.equal(h.calculate({ ...BASE, boardThickness: 2 }).jointGap, 7);
  const r25 = h.calculate({ ...BASE, boardThickness: 2.5 });
  assert.equal(r25.jointGap, 8);
  assert.equal(r25.jointGapUnsourced, false);
  assert.equal(h.calculate({ ...BASE, boardThickness: 3 }).jointGap, 8);
  const r4 = h.calculate({ ...BASE, boardThickness: 4 });
  assert.equal(r4.jointGap, 9);
  assert.equal(r4.jointGapUnsourced, true);
});

test('elle mafsal otomatiği ezer ve kaynak yok bayrağı çıkmaz', () => {
  const r = h.calculate({ ...BASE, boardThickness: 4, jointGap: 10 });
  assert.equal(r.jointGap, 10);
  assert.equal(r.jointGapUnsourced, false);
  assert.equal(r.board.width, 148 - 10 + 3);
});

test('forza 296×210 ×2; mull 62×198; kapital 12 ×2', () => {
  const r = h.calculate(BASE);
  assert.deepEqual(r.endpapers, { width: 296, height: 210, count: 2 });
  assert.deepEqual(r.mull, { width: 62, height: 198 });
  assert.deepEqual(r.headbands, { length: 12, count: 2 });
});

test('rounded sırt: eğri length 20 → şerit 23; boşsa 16 + 3 = 19 ve uyarı bayrağı', () => {
  const r = h.calculate({ ...BASE, spineShape: 'rounded', curveLength: 20 });
  assert.deepEqual(r.spineStrip, { width: 23, height: 216, count: 1 });
  assert.equal(r.curveLengthWarning, false);
  const b = h.calculate({ ...BASE, spineShape: 'rounded' });
  assert.deepEqual(b.spineStrip, { width: 19, height: 216, count: 1 });
  assert.equal(b.curveLengthWarning, true);
  assert.equal(h.calculate({ ...BASE, spineShape: 'rounded', curveLength: '' }).spineStrip.width, 19);
  assert.equal(h.calculate(BASE).curveLengthWarning, false);
  // yuvarlak sırtta kural seçeneği şerit formülünü değiştirmez
  assert.equal(h.calculate({ ...BASE, spineShape: 'rounded', curveLength: 20, spineRule: 'onlyS' }).spineStrip.width, 23);
});

test('sert kapak: negatif / sıfır t, k, e, mafsal, eğri boyu reddedilir', () => {
  ['boardThickness', 'turnIn'].forEach((name) => {
    assert.throws(() => h.calculate({ ...BASE, [name]: 0 }), RangeError, name + '=0');
    assert.throws(() => h.calculate({ ...BASE, [name]: -1 }), RangeError, name + '=-1');
  });
  assert.throws(() => h.calculate({ ...BASE, square: -1 }), RangeError, 'square=-1');
  assert.throws(() => h.calculate({ ...BASE, jointGap: 0 }), RangeError);
  assert.throws(() => h.calculate({ ...BASE, jointGap: -2 }), RangeError);
  assert.throws(() => h.calculate({ ...BASE, spineShape: 'rounded', curveLength: -3 }), RangeError);
  assert.throws(() => h.calculate({ ...BASE, spineShape: 'square' }));
  assert.throws(() => h.calculate({ ...BASE, spineRule: 'x' }));
});

test('varsayılanlar: t 2, k 3, e 15, mafsal otomatik, sırt düz, kural S+2t', () => {
  assert.equal(h.DEFAULTS.boardThickness, 2);
  assert.equal(h.DEFAULTS.square, 3);
  assert.equal(h.DEFAULTS.turnIn, 15);
  assert.equal(h.DEFAULTS.jointGap, 'auto');
  assert.equal(h.DEFAULTS.spineShape, 'flat');
  assert.equal(h.DEFAULTS.spineRule, 'twoT');
  const r = h.calculate({ pageCount: 240, bindingType: 'single1', paperThickness: 0.1 });
  assert.deepEqual(r.covering, { width: 352, height: 250 });
});

test('kusurlu girdi: negatif / boş / sayı olmayan', () => {
  assert.throws(() => h.calculate({ pageCount: -5 }), RangeError);
  assert.throws(() => h.calculate({}), RangeError);
  assert.throws(() => h.calculate({ pageCount: 'abc' }), RangeError);
  assert.throws(() => h.calculate({ pageCount: 10, paperThickness: -1 }), RangeError);
  assert.throws(() => h.calculate({ pageCount: 10, sheetsPerSignature: 9 }), RangeError);
  assert.throws(() => h.calculate({ pageCount: 10, bindingType: 'none' }));
});

// ---- D9: Hesapla Düzenle ile aynı: forma yaprağı tam sayı olmalı ----
test('forma yaprağı tam sayı olmayan girdi reddedilir (yuvarlanmaz)', () => {
  assert.throws(() => h.calculate({ pageCount: 100, sheetsPerSignature: 2.6 }), /tam sayı/);
  assert.throws(() => h.calculate({ pageCount: 100, sheetsPerSignature: 0.5 }), RangeError);
  assert.equal(h.calculate({ pageCount: 100, sheetsPerSignature: 3 }).input.sheetsPerSignature, 3);
});

// ---- AR: sonuç doğrulaması ve taşma 0 ----
test('taşma k = 0 accept edilir (board blokla aynı hizada)', () => {
  const r = h.calculate({ ...BASE, square: 0 });
  assert.equal(r.board.width, 148 - r.jointGap);
  assert.equal(r.board.height, 210);
});

test('sonuç Db <= 0 ise RangeError (W=5, jointGap=10 elle, k=0.5) ve ölçüyü adıyla söyler', () => {
  assert.throws(() => h.calculate({ ...BASE, bookWidth: 5, jointGap: 10, square: 0.5 }), (e) => e instanceof RangeError && /mukavva genişliği/.test(e.message) && /-4\.5/.test(e.message));
});

test('mull yüksekliği <= 0 ise RangeError', () => {
  assert.throws(() => h.calculate({ ...BASE, bookHeight: 12 }), (e) => e instanceof RangeError && /mull yüksekliği/.test(e.message));
});
