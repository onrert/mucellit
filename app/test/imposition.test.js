'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../js/imposition.js');

test('sewn: 10 pages, 4 sheets per signature → filled up to 16 pages', () => {
  const r = d.sewn({ pageCount: 10, sheetsPerSignature: 4 });
  assert.equal(r.totalPages, 16);
  assert.equal(r.signatures.length, 1);
  assert.equal(r.sheets.length, 4);
  // "sheet 1" and "sheet 4" are counted from 1 (formula i = 0..3)
  assert.deepEqual(r.sheets[0].front, [16, 1]);
  assert.deepEqual(r.sheets[0].back, [2, 15]);
  assert.deepEqual(r.sheets[3].front, [10, 7]);
  assert.deepEqual(r.sheets[3].back, [8, 9]);
  for (let s = 1; s <= 10; s++) assert.equal(r.isBlank(s), false, 'page ' + s + ' must be filled');
  for (let s = 11; s <= 16; s++) assert.equal(r.isBlank(s), true, 'page ' + s + ' must be blank');
  assert.ok(d.verify(r));
});

test('sewn: 37 pages, 4 sheets → 48 pages, 3 signatures, 12 sheets; signature 2 sheet 1 front [32,17]', () => {
  const r = d.sewn({ pageCount: 37, sheetsPerSignature: 4 });
  assert.equal(r.totalPages, 48);
  assert.equal(r.signatures.length, 3);
  assert.equal(r.sheets.length, 12);
  const y = r.sheets.find((x) => x.signature === 1 && x.indexInSignature === 0);
  assert.deepEqual(y.front, [32, 17]);
  assert.deepEqual(y.back, [18, 31]);
  assert.ok(d.verify(r));
});

test('sewn: shrinking the last signature (37 pages → 32 + 8 = 40)', () => {
  const r = d.sewn({ pageCount: 37, sheetsPerSignature: 4, shrinkLastSignature: true });
  assert.equal(r.totalPages, 40);
  assert.deepEqual(r.signatures.map((f) => f.leafCount), [4, 4, 2]);
  const last = r.sheets.filter((y) => y.signature === 2);
  assert.deepEqual(last[0].front, [40, 33]);
  assert.deepEqual(last[1].back, [36, 37]);
  assert.ok(d.verify(r));
});

test('sewn: sheets per signature limited to 1–8, an error outside', () => {
  assert.equal(d.sewn({ pageCount: 3, sheetsPerSignature: 1 }).totalPages, 4);
  assert.equal(d.sewn({ pageCount: 3, sheetsPerSignature: 8 }).totalPages, 32);
  assert.throws(() => d.sewn({ pageCount: 3, sheetsPerSignature: 0 }), RangeError);
  assert.throws(() => d.sewn({ pageCount: 3, sheetsPerSignature: 9 }), RangeError);
  assert.throws(() => d.sewn({ pageCount: 3, sheetsPerSignature: 2.5 }), RangeError);
  assert.throws(() => d.sewn({ pageCount: 0 }), RangeError);
  assert.throws(() => d.sewn({}), RangeError);
  assert.equal(d.sewn({ pageCount: 5 }).sheets.length, 4, 'default 4 sheets');
});

test('sewn: every page exactly once (1..200, signatures 1..8)', () => {
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

test('2-up cut-and-stack: 8 pages → N=2', () => {
  const r = d.single2({ pageCount: 8 });
  assert.equal(r.sheets.length, 2);
  assert.equal(r.totalPages, 8);
  assert.deepEqual(r.sheets[0].front, [1, 5]);
  assert.deepEqual(r.sheets[0].back, [6, 2]);
  assert.deepEqual(r.sheets[1].front, [3, 7]);
  assert.deepEqual(r.sheets[1].back, [8, 4]);
  assert.ok(d.verify(r));
});

test('2-up: after cutting and putting the right stack under the left stack the order is 1..4N', () => {
  for (const p of [1, 5, 8, 9, 37, 101]) {
    const r = d.single2({ pageCount: p });
    const left = [], right = [];
    // front/back left half is the same piece of paper: front left + back right; front right + back left
    r.sheets.forEach((y) => { left.push(y.front[0], y.back[1]); right.push(y.front[1], y.back[0]); });
    const order = left.concat(right);
    assert.deepEqual(order, Array.from({ length: r.totalPages }, (_, i) => i + 1));
  }
});

test('1-up: front 2i+1, back 2i+2; an odd count is filled up', () => {
  const r = d.single1({ pageCount: 5 });
  assert.equal(r.totalPages, 6);
  assert.deepEqual(r.sheets.map((y) => [y.front[0], y.back[0]]), [[1, 2], [3, 4], [5, 6]]);
  assert.equal(r.isBlank(6), true);
  assert.ok(d.verify(r));
});

test('creep: thickness 0.1 mm, sheet 3 → 0.3 mm', () => {
  assert.equal(d.creep(3, 0.1), 0.3);
  assert.equal(d.creep(0, 0.1), 0);
  const r = d.sewn({ pageCount: 16, sheetsPerSignature: 4, creepEnabled: true, paperThickness: 0.1 });
  assert.deepEqual(r.sheets.map((y) => y.creep), [0, 0.1, 0.2, 0.3]);
  const closed = d.sewn({ pageCount: 16, sheetsPerSignature: 4, paperThickness: 0.1 });
  assert.deepEqual(closed.sheets.map((y) => y.creep), [0, 0, 0, 0], 'off by default');
  assert.throws(() => d.creep(1, -0.1), RangeError);
});

test('verify: catches a corrupt imposition (a copy and a missing page)', () => {
  const r = d.sewn({ pageCount: 8, sheetsPerSignature: 2 });
  const copy = JSON.parse(JSON.stringify(r)); copy.sheets[1].front[0] = copy.sheets[0].front[0];
  assert.throws(() => d.verify(copy), /iki kez/);  // turkish-ok: expected Turkish UI text
  const missing = JSON.parse(JSON.stringify(r)); missing.sheets.pop();
  assert.throws(() => d.verify(missing), /yerleşmedi/);  // turkish-ok: expected Turkish UI text
  const blank = { totalPages: 4, sheets: [] };
  assert.throws(() => d.verify(blank), /yerleşmedi/);  // turkish-ok: expected Turkish UI text
});

test('impose: type choice and an unknown type', () => {
  assert.equal(d.impose('sewn', { pageCount: 4 }).kind, 'sewn');
  assert.equal(d.impose('single1', { pageCount: 4 }).kind, 'single1');
  assert.equal(d.impose('single2', { pageCount: 4 }).kind, 'single2');
  assert.throws(() => d.impose('xx', { pageCount: 4 }));
});
