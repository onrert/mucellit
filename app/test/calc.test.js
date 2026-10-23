'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../js/calc.js');

test('200 pages → 100 leaves; with 0.1 mm paper the spine is 10 mm', () => {
  assert.equal(h.leafCount(200), 100);
  assert.equal(h.spineThicknessOf(100, 0.1), 10);
  const r = h.calculate({ pageCount: 200, bindingType: 'single1', paperThickness: 0.1 });
  assert.equal(r.leaves, 100);
  assert.equal(r.spineThickness, 10);
  assert.equal(r.printSheets, 100);
});

test('the endpaper allowance is added to the spine; an odd page count is rounded up', () => {
  assert.equal(h.spineThicknessOf(100, 0.1, 1.5), 11.5);
  assert.equal(h.leafCount(201), 101);
});

test('sewn: blank pages count in the spine, signature and sheet counts', () => {
  const r = h.calculate({ pageCount: 200, bindingType: 'sewn', sheetsPerSignature: 4, paperThickness: 0.1 });
  assert.equal(r.totalPages, 208);
  assert.equal(r.signatureCount, 13);
  assert.equal(r.leaves, 104);
  assert.equal(r.spineThickness, 10.4);
  assert.equal(r.printSheets, 52);
  assert.equal(r.blankPages, 8);
});

test('2-up sheet count = total / 4', () => {
  const r = h.calculate({ pageCount: 37, bindingType: 'single2' });
  assert.equal(r.totalPages, 40);
  assert.equal(r.printSheets, 10);
});

// S = 120 leaves × 0.1 = 12 mm
const BASE = { pageCount: 240, bindingType: 'single1', paperThickness: 0.1, bookWidth: 148, bookHeight: 210, boardThickness: 2, square: 3, turnIn: 15 };

test('hard cover: flat spine, S+2t → board 144×216, spine stiffener 16×216, joint 7, covering 352×250', () => {
  const r = h.calculate(BASE);
  assert.equal(r.spineThickness, 12);
  assert.deepEqual(r.board, { width: 144, height: 216, count: 2 });
  assert.deepEqual(r.spineStrip, { width: 16, height: 216, count: 1 });
  assert.equal(r.jointGap, 7);
  assert.equal(r.coveringJointGap, 7);
  assert.deepEqual(r.covering, { width: 352, height: 250 });
});

test('hard cover: the "S only" rule → stiffener 12, joint 9 in the covering, covering still 352×250', () => {
  const r = h.calculate({ ...BASE, spineRule: 'onlyS' });
  assert.deepEqual(r.spineStrip, { width: 12, height: 216, count: 1 });
  assert.equal(r.jointGap, 7);
  assert.equal(r.coveringJointGap, 9);
  assert.deepEqual(r.board, { width: 144, height: 216, count: 2 });
  assert.deepEqual(r.covering, { width: 352, height: 250 });
});

test('automatic joint: t=1 → 6, t=2.5 → 8, t=4 → 9 and the no-source flag', () => {
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

test('a manual joint overrides the automatic one and the no-source flag is not set', () => {
  const r = h.calculate({ ...BASE, boardThickness: 4, jointGap: 10 });
  assert.equal(r.jointGap, 10);
  assert.equal(r.jointGapUnsourced, false);
  assert.equal(r.board.width, 148 - 10 + 3);
});

test('endpaper 296×210 ×2; mull 62×198; headband 12 ×2', () => {
  const r = h.calculate(BASE);
  assert.deepEqual(r.endpapers, { width: 296, height: 210, count: 2 });
  assert.deepEqual(r.mull, { width: 62, height: 198 });
  assert.deepEqual(r.headbands, { length: 12, count: 2 });
});

test('rounded spine: curve length 20 → stiffener 23; when empty 16 + 3 = 19 and the warning flag', () => {
  const r = h.calculate({ ...BASE, spineShape: 'rounded', curveLength: 20 });
  assert.deepEqual(r.spineStrip, { width: 23, height: 216, count: 1 });
  assert.equal(r.curveLengthWarning, false);
  const b = h.calculate({ ...BASE, spineShape: 'rounded' });
  assert.deepEqual(b.spineStrip, { width: 19, height: 216, count: 1 });
  assert.equal(b.curveLengthWarning, true);
  assert.equal(h.calculate({ ...BASE, spineShape: 'rounded', curveLength: '' }).spineStrip.width, 19);
  assert.equal(h.calculate(BASE).curveLengthWarning, false);
  // on a rounded spine the rule option does not change the stiffener formula
  assert.equal(h.calculate({ ...BASE, spineShape: 'rounded', curveLength: 20, spineRule: 'onlyS' }).spineStrip.width, 23);
});

test('hard cover: negative / zero t, k, e, joint, curve length are rejected', () => {
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

test('defaults: t 2, k 3, e 15, joint automatic, spine flat, rule S+2t', () => {
  assert.equal(h.DEFAULTS.boardThickness, 2);
  assert.equal(h.DEFAULTS.square, 3);
  assert.equal(h.DEFAULTS.turnIn, 15);
  assert.equal(h.DEFAULTS.jointGap, 'auto');
  assert.equal(h.DEFAULTS.spineShape, 'flat');
  assert.equal(h.DEFAULTS.spineRule, 'twoT');
  const r = h.calculate({ pageCount: 240, bindingType: 'single1', paperThickness: 0.1 });
  assert.deepEqual(r.covering, { width: 352, height: 250 });
});

test('faulty input: negative / empty / not a number', () => {
  assert.throws(() => h.calculate({ pageCount: -5 }), RangeError);
  assert.throws(() => h.calculate({}), RangeError);
  assert.throws(() => h.calculate({ pageCount: 'abc' }), RangeError);
  assert.throws(() => h.calculate({ pageCount: 10, paperThickness: -1 }), RangeError);
  assert.throws(() => h.calculate({ pageCount: 10, sheetsPerSignature: 9 }), RangeError);
  assert.throws(() => h.calculate({ pageCount: 10, bindingType: 'none' }));
});

// ---- D9: the Calculator is the same as Imposition: sheets per signature must be an integer ----
test('a sheets-per-signature input that is not an integer is rejected (not rounded)', () => {
  assert.throws(() => h.calculate({ pageCount: 100, sheetsPerSignature: 2.6 }), /tam sayı/);  // turkish-ok: expected Turkish UI text
  assert.throws(() => h.calculate({ pageCount: 100, sheetsPerSignature: 0.5 }), RangeError);
  assert.equal(h.calculate({ pageCount: 100, sheetsPerSignature: 3 }).input.sheetsPerSignature, 3);
});

// ---- AR: result validation and a square of 0 ----
test('a square k = 0 is accepted (the board flush with the block)', () => {
  const r = h.calculate({ ...BASE, square: 0 });
  assert.equal(r.board.width, 148 - r.jointGap);
  assert.equal(r.board.height, 210);
});

test('a result Db <= 0 is a RangeError (W=5, jointGap=10 manual, k=0.5) that names the measurement', () => {
  assert.throws(() => h.calculate({ ...BASE, bookWidth: 5, jointGap: 10, square: 0.5 }), (e) => e instanceof RangeError && /mukavva genişliği/.test(e.message) && /-4\.5/.test(e.message));  // turkish-ok: expected Turkish UI text
});

test('a mull height <= 0 is a RangeError', () => {
  assert.throws(() => h.calculate({ ...BASE, bookHeight: 12 }), (e) => e instanceof RangeError && /mull yüksekliği/.test(e.message));  // turkish-ok: expected Turkish UI text
});
