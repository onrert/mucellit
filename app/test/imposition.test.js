'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../js/imposition.js');

test('formalı: 10 sayfa, forma 4 yaprak → 16 sayfaya tamamlanır', () => {
  const r = d.sewn({ pageCount: 10, sheetsPerSignature: 4 });
  assert.equal(r.totalPages, 16);
  assert.equal(r.signatures.length, 1);
  assert.equal(r.sheets.length, 4);
  // "yaprak 1" ve "yaprak 4" 1'den sayılır (formül i = 0..3)
  assert.deepEqual(r.sheets[0].front, [16, 1]);
  assert.deepEqual(r.sheets[0].back, [2, 15]);
  assert.deepEqual(r.sheets[3].front, [10, 7]);
  assert.deepEqual(r.sheets[3].back, [8, 9]);
  for (let s = 1; s <= 10; s++) assert.equal(r.isBlank(s), false, 'page ' + s + ' dolu olmalı');
  for (let s = 11; s <= 16; s++) assert.equal(r.isBlank(s), true, 'page ' + s + ' boş olmalı');
  assert.ok(d.verify(r));
});

test('formalı: 37 sayfa, forma 4 → 48 sayfa, 3 forma, 12 yaprak; 2. forma 1. yaprak ön [32,17]', () => {
  const r = d.sewn({ pageCount: 37, sheetsPerSignature: 4 });
  assert.equal(r.totalPages, 48);
  assert.equal(r.signatures.length, 3);
  assert.equal(r.sheets.length, 12);
  const y = r.sheets.find((x) => x.signature === 1 && x.indexInSignature === 0);
  assert.deepEqual(y.front, [32, 17]);
  assert.deepEqual(y.back, [18, 31]);
  assert.ok(d.verify(r));
});

test('formalı: last formayı küçültme (37 page → 32 + 8 = 40)', () => {
  const r = d.sewn({ pageCount: 37, sheetsPerSignature: 4, shrinkLastSignature: true });
  assert.equal(r.totalPages, 40);
  assert.deepEqual(r.signatures.map((f) => f.leafCount), [4, 4, 2]);
  const last = r.sheets.filter((y) => y.signature === 2);
  assert.deepEqual(last[0].front, [40, 33]);
  assert.deepEqual(last[1].back, [36, 37]);
  assert.ok(d.verify(r));
});

test('formalı: forma yaprak sınırları 1–8, dışı hata', () => {
  assert.equal(d.sewn({ pageCount: 3, sheetsPerSignature: 1 }).totalPages, 4);
  assert.equal(d.sewn({ pageCount: 3, sheetsPerSignature: 8 }).totalPages, 32);
  assert.throws(() => d.sewn({ pageCount: 3, sheetsPerSignature: 0 }), RangeError);
  assert.throws(() => d.sewn({ pageCount: 3, sheetsPerSignature: 9 }), RangeError);
  assert.throws(() => d.sewn({ pageCount: 3, sheetsPerSignature: 2.5 }), RangeError);
  assert.throws(() => d.sewn({ pageCount: 0 }), RangeError);
  assert.throws(() => d.sewn({}), RangeError);
  assert.equal(d.sewn({ pageCount: 5 }).sheets.length, 4, 'varsayılan 4 yaprak');
});

test('formalı: her sayfa tam bir kez (1..200, forma 1..8)', () => {
  for (let k = 1; k <= 8; k++) {
    for (const p of [1, 2, 15, 16, 17, 63, 200]) {
      for (const shrink of [false, true]) {
        const r = d.sewn({ pageCount: p, sheetsPerSignature: k, shrinkLastSignature: shrink });
        assert.ok(d.verify(r));
        assert.ok(r.totalPages >= p && r.totalPages % 4 === 0);
      }
    }
  }
});

test('2-up kes-üst üste: 8 sayfa → N=2', () => {
  const r = d.single2({ pageCount: 8 });
  assert.equal(r.sheets.length, 2);
  assert.equal(r.totalPages, 8);
  assert.deepEqual(r.sheets[0].front, [1, 5]);
  assert.deepEqual(r.sheets[0].back, [6, 2]);
  assert.deepEqual(r.sheets[1].front, [3, 7]);
  assert.deepEqual(r.sheets[1].back, [8, 4]);
  assert.ok(d.verify(r));
});

test('2-up: kesip sağ desteyi sol destenin altına koyunca sıra 1..4N', () => {
  for (const p of [1, 5, 8, 9, 37, 101]) {
    const r = d.single2({ pageCount: p });
    const left = [], right = [];
    // ön/arka sol yarı aynı kağıt parçası: ön sol + arka sağ; ön sağ + arka sol
    r.sheets.forEach((y) => { left.push(y.front[0], y.back[1]); right.push(y.front[1], y.back[0]); });
    const order = left.concat(right);
    assert.deepEqual(order, Array.from({ length: r.totalPages }, (_, i) => i + 1));
  }
});

test('1-up: ön 2i+1, arka 2i+2; tek sayı tamamlanır', () => {
  const r = d.single1({ pageCount: 5 });
  assert.equal(r.totalPages, 6);
  assert.deepEqual(r.sheets.map((y) => [y.front[0], y.back[0]]), [[1, 2], [3, 4], [5, 6]]);
  assert.equal(r.isBlank(6), true);
  assert.ok(d.verify(r));
});

test('kayma: kalınlık 0.1 mm, yaprak 3 → 0.3 mm', () => {
  assert.equal(d.creep(3, 0.1), 0.3);
  assert.equal(d.creep(0, 0.1), 0);
  const r = d.sewn({ pageCount: 16, sheetsPerSignature: 4, creepEnabled: true, paperThickness: 0.1 });
  assert.deepEqual(r.sheets.map((y) => y.creep), [0, 0.1, 0.2, 0.3]);
  const closed = d.sewn({ pageCount: 16, sheetsPerSignature: 4, paperThickness: 0.1 });
  assert.deepEqual(closed.sheets.map((y) => y.creep), [0, 0, 0, 0], 'varsayılan kapalı');
  assert.throws(() => d.creep(1, -0.1), RangeError);
});

test('verify: corrupt dizilimi yakalar (copy ve missing page)', () => {
  const r = d.sewn({ pageCount: 8, sheetsPerSignature: 2 });
  const copy = JSON.parse(JSON.stringify(r)); copy.sheets[1].front[0] = copy.sheets[0].front[0];
  assert.throws(() => d.verify(copy), /iki kez/);
  const missing = JSON.parse(JSON.stringify(r)); missing.sheets.pop();
  assert.throws(() => d.verify(missing), /yerleşmedi/);
  const blank = { totalPages: 4, sheets: [] };
  assert.throws(() => d.verify(blank), /yerleşmedi/);
});

test('diz: tür seçimi ve bilinmeyen tür', () => {
  assert.equal(d.impose('sewn', { pageCount: 4 }).kind, 'sewn');
  assert.equal(d.impose('single1', { pageCount: 4 }).kind, 'single1');
  assert.equal(d.impose('single2', { pageCount: 4 }).kind, 'single2');
  assert.throws(() => d.impose('xx', { pageCount: 4 }));
});
