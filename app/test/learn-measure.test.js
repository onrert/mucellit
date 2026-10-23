'use strict';
/*
 * learn-measure.test.js — the numbers panel of the Learn guide (app/js/learn/learn-measure.js) with the app's own calculation.
 *  1. The defaults are the defaults of the Calculator tab: the input built from the Calculator fields in index.html
 *     (the same rules as calculator.js readInputs) → calc.calculate → base → panel; the panel uses the Calculator's
 *     result AS IT IS.
 *  2. Sample Book values (taken from a real binding) exactly: from the Calculator (162 pages) and by hand
 *     (11 signatures × 4 sheets), two ways.
 *  3. With an independent mapping (written separately in this file, not copied from the panel code) calc.js gives the
 *     same for 1000 random inputs; with a base (board/square/turn-in/joint … from the Calculator) also for 500 random inputs.
 *  4. Base rules: a manual change does not change the Calculator input; when signature/sheets are the same the
 *     Calculator's page count and last-signature setting stay; a Calculator that is not sewn / has a rounded spine is
 *     drawn sewn + flat (match=false); a Calculator error or a value outside the guide's limits gives no base.
 *  5. Faulty input test: the comparer catches a broken calculation, the mapping catches a broken panel copy; invalid
 *     values are rejected.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setupI18n } = require('./i18n-helper.js');

const APP = path.join(__dirname, '..');
const SIZE_PATH = path.join(APP, 'js', 'learn', 'learn-measure.js');
const Size = require(SIZE_PATH);
const Calc = require('../js/calc.js');
const INDEX = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

/* Independent mapping: sewn signatures; total pages = signatures × (sheets per signature × 2 leaves × 2 pages); size and thickness as they are. */
const MAPPING = {
  bindingType: () => 'sewn',
  pageCount: (g) => { const sheetSignature = g.sheetsPerSignature * 2, pageSignature = sheetSignature * 2; return g.signatureCount * pageSignature; },
  sheetsPerSignature: (g) => g.sheetsPerSignature, bookWidth: (g) => g.bookWidth, bookHeight: (g) => g.bookHeight, paperThickness: (g) => g.paperThickness,
};
const applyMapping = (g, ek) => Object.assign({}, ek || {}, Object.fromEntries(Object.entries(MAPPING).map(([a, fn]) => [a, fn(g)])));

/** Differences between the panel result and the calc.js result (empty = the same). */
function compare(o, r) {
  const pairs = [
    ['page', o.page, r.totalPages], ['signature', o.N, r.signatureCount], ['sheet', o.sheet, r.leaves],
    ['printing', o.printSheets, r.printSheets], ['spine', o.S, r.spineThickness], ['jointGap', o.f, r.jointGap],
    ['brdWidth', o.Db, r.board.width], ['brdHeight', o.Dh, r.board.height], ['strip', o.R, r.spineStrip.width],
    ['coveringWidth', o.covering.width, r.covering.width], ['coveringHeight', o.covering.height, r.covering.height],
    ['endpaperWidth', o.endpapers.width, r.endpapers.width], ['endpaperHeight', o.endpapers.height, r.endpapers.height],
    ['mullWidth', o.mull.width, r.mull.width], ['mullHeight', o.mull.height, r.mull.height], ['headbands', o.headbands, r.headbands.length],
    ['square', o.k, Number(r.input.square)], ['turnIn', o.e, Number(r.input.turnIn)], ['t', o.t, Number(r.input.boardThickness)],
  ];
  return pairs.filter(([, a, b]) => a !== b).map(([name, a, b]) => `${name}: panel ${a} ≠ calc ${b}`);
}
function seed(s) { return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function random(rnd) {
  const r = (a, b) => a + rnd() * (b - a), roundTo = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  return { signatureCount: 1 + Math.floor(rnd() * 40), sheetsPerSignature: 1 + Math.floor(rnd() * 8),
    bookWidth: roundTo(r(60, 300), rnd() < 0.5 ? 0 : 1), bookHeight: roundTo(r(80, 420), rnd() < 0.5 ? 0 : 1), paperThickness: roundTo(r(0.04, 0.4), 3) };
}
/** Calculator state: { input, result } (the format calculator.js keeps). */
const calculatorState = (input) => ({ error: null, input, result: Calc.calculate(input) });

/**
 * The defaults of the Calculator fields in index.html → an input with the same rules as calculator.js readInputs
 * (an empty number → missing, an empty joint → 'auto'). The parser is written in this test (not taken from calculator.js).
 */
function calculatorDefault(html) {
  const value = (id) => { const m = new RegExp(`<input[^>]*\\sid="h-${id}"[^>]*>`).exec(html); assert.ok(m, `h-${id} none`); const v = /\svalue="([^"]*)"/.exec(m[0]); return v ? v[1] : ''; };
  const selected = (id) => { const m = new RegExp(`<select id="h-${id}">([\\s\\S]*?)</select>`).exec(html); assert.ok(m, `h-${id} none`); const o = /<option value="([^"]+)"[^>]*\sselected/.exec(m[1]) || /<option value="([^"]+)"/.exec(m[1]); return o[1]; };
  const g = { bindingType: selected('bindingType'), shrinkLastSignature: /id="h-shrinkLastSignature"[^>]*\schecked/.test(html), spineShape: selected('spineShape'), spineRule: selected('spineRule') };
  for (const a of ['pageCount', 'sheetsPerSignature', 'paperThickness', 'endpaperAllowance', 'bookWidth', 'bookHeight', 'boardThickness', 'square', 'curveLength', 'jointGap', 'turnIn', 'spareSheets']) {
    const v = value(a).trim();
    g[a] = v === '' ? undefined : Number(v.replace(',', '.'));
  }
  if (g.jointGap === undefined) g.jointGap = 'auto';
  return g;
}

// language for the calc.js error texts (in Node the require('./i18n.js') path works too; Turkish is set explicitly)
const ctx = { navigator: { languages: ['tr-TR'] } }; ctx.self = ctx; vm.createContext(ctx); setupI18n(ctx, 'tr');

// ---------------------------------------------------------------- 1. default = Calculator
test('default: the panel uses the default input and the RESULT of the Calculator tab as they are (index.html → calc.calculate → base)', () => {
  const g = calculatorDefault(INDEX);
  assert.deepEqual({ bindingType: g.bindingType, pageCount: g.pageCount, sheetsPerSignature: g.sheetsPerSignature, bookWidth: g.bookWidth, bookHeight: g.bookHeight, paperThickness: g.paperThickness, boardThickness: g.boardThickness, square: g.square, turnIn: g.turnIn, jointGap: g.jointGap },
    { bindingType: 'sewn', pageCount: 200, sheetsPerSignature: 4, bookWidth: 148, bookHeight: 210, paperThickness: 0.1, boardThickness: 2, square: 3, turnIn: 15, jointGap: 'auto' }, 'Calculator defaults (index.html)');
  const d = calculatorState(g);
  const baseData = Size.fromBase(d);
  assert.equal(baseData.match, true);
  assert.equal(baseData.result, d.result, 'Calculator sewn + flat: the result object as it is (no copied calculation)');
  assert.deepEqual(baseData.five, { signatureCount: 13, sheetsPerSignature: 4, bookWidth: 148, bookHeight: 210, paperThickness: 0.1 });
  const o = Size.calculate(baseData.five, baseData);
  assert.equal(o.source, 'calculator');
  assert.equal(o.calc, d.result);
  assert.deepEqual(compare(o, d.result), []);
  assert.deepEqual([o.page, o.N, o.S, o.Db, o.Dh, o.f], [208, 13, 10.4, 144, 216, 7]);
  // the base is used even when no input is given
  assert.equal(Size.calculate({}, baseData).calc, d.result);
});

// ---------------------------------------------------------------- 2. Sample Book
const BASE_VALUES = { page: 176, signature: 11, sheet: 88, printing: 44, spine: 8.8, jointGap: 7, board: [144, 216], strip: [12.8, 216], covering: [348.8, 250], endpapers: [296, 210], mull: [58.8, 198], headbands: 8.8 };
function baseDiff(o) {
  const v = { page: o.page, signature: o.N, sheet: o.sheet, printing: o.printSheets, spine: o.S, jointGap: o.f, board: [o.Db, o.Dh], strip: [o.R, o.Dh],
    covering: [o.covering.width, o.covering.height], endpapers: [o.endpapers.width, o.endpapers.height], mull: [o.mull.width, o.mull.height], headbands: o.headbands };
  return Object.keys(BASE_VALUES).filter((a) => JSON.stringify(v[a]) !== JSON.stringify(BASE_VALUES[a])).map((a) => `${a}: ${JSON.stringify(v[a])} ≠ ${JSON.stringify(BASE_VALUES[a])}`);
}
test('Sample Book exactly: the same values from the Calculator (162 pages) and by hand (11 signatures × 4 sheets)', () => {
  const baseInput = { bindingType: 'sewn', pageCount: 162, sheetsPerSignature: 4, shrinkLastSignature: false, paperThickness: 0.1, endpaperAllowance: 0, bookWidth: 148, bookHeight: 210,
    boardThickness: 2, square: 3, spineShape: 'flat', spineRule: 'twoT', jointGap: 'auto', turnIn: 15, spareSheets: 0 };
  const baseData = Size.fromBase(calculatorState(baseInput));
  const o1 = Size.calculate(baseData.five, baseData);
  assert.deepEqual(baseDiff(o1), []);
  assert.equal(o1.calc.blankPages, 14, '176 (14 blank)');
  const o2 = Size.calculate({ signatureCount: 11, sheetsPerSignature: 4, bookWidth: 148, bookHeight: 210, paperThickness: 0.1 });
  assert.deepEqual(baseDiff(o2), []);
  // the guide's extra assumptions (holes, thread, corner)
  assert.deepEqual([o2.station.number, o2.station.range, o2.station.position[0], o2.station.position[5]], [6, 36, 15, 195]);
  assert.equal(o2.thread, 2730); assert.deepEqual(o2.corner, [4, 5]); assert.deepEqual([o2.k, o2.e, o2.t], [3, 15, 2]);
  // the checker catches a broken value
  assert.ok(baseDiff({ ...o2, S: 8.9 }).length === 1 && baseDiff({ ...o2, Db: 145 }).length === 1);
});

// ---------------------------------------------------------------- 3. independent mapping, random
test('1000 random inputs (without a base) and 500 random inputs (with a random Calculator base) are the same as calc.js', () => {
  const rnd = seed(20261023);
  for (let i = 0; i < 1000; i++) {
    const g = random(rnd), o = Size.calculate(g), r = Calc.calculate(applyMapping(g));
    assert.deepEqual(o.calc.input, r.input, 'the calculation input is the same as the independent mapping');
    assert.deepEqual(compare(o, r), [], JSON.stringify(g));
  }
  for (let i = 0; i < 500; i++) {
    const ek = { boardThickness: [1, 1.5, 2, 2.5, 3][Math.floor(rnd() * 5)], square: [0, 2, 3, 4][Math.floor(rnd() * 4)], turnIn: [12, 15, 18][Math.floor(rnd() * 3)],
      jointGap: rnd() < 0.5 ? 'auto' : 6 + Math.floor(rnd() * 4), endpaperAllowance: rnd() < 0.5 ? 0 : 0.4, spineRule: rnd() < 0.7 ? 'twoT' : 'onlyS', spareSheets: Math.floor(rnd() * 3) };
    const base = random(rnd), baseData = Size.fromBase(calculatorState(applyMapping(base, ek)));
    assert.ok(baseData.input, JSON.stringify(base));
    const g = random(rnd), o = Size.calculate(g, baseData);
    const r = Calc.calculate(applyMapping(g, { ...ek, spineShape: 'flat', shrinkLastSignature: false }));
    assert.deepEqual(compare(o, r), [], JSON.stringify({ g, ek }));
  }
});

// ---------------------------------------------------------------- 4. base rules
test('base: a manual change does not change the Calculator input; when signature/sheets are the same the Calculator\'s page count and last-signature setting stay', () => {
  const calcInput = { bindingType: 'sewn', pageCount: 200, sheetsPerSignature: 4, shrinkLastSignature: true, paperThickness: 0.1, bookWidth: 148, bookHeight: 210, boardThickness: 2.5, square: 4, turnIn: 18, jointGap: 'auto', spineShape: 'flat', spineRule: 'twoT' };
  const once = JSON.stringify(calcInput), d = calculatorState(calcInput), baseData = Size.fromBase(d);
  assert.equal(d.result.totalPages, 200, 'last signature smaller: 12 × 16 + 2 sheets × 4');
  const wide = Size.calculate({ ...baseData.five, bookWidth: 160 }, baseData);
  assert.equal(wide.source, 'guide');
  assert.deepEqual([wide.page, wide.N, wide.t, wide.k, wide.e], [200, 13, 2.5, 4, 18], 'only the width changed: pages and last signature from the Calculator');
  assert.equal(wide.calc.input.shrinkLastSignature, true);
  const signature = Size.calculate({ ...baseData.five, signatureCount: 5 }, baseData);
  assert.deepEqual([signature.page, signature.N, signature.calc.input.shrinkLastSignature, signature.t, signature.k, signature.e], [80, 5, false, 2.5, 4, 18], 'signatures changed: 5 × 16 pages, the Calculator\'s board/square/turn-in');
  assert.equal(JSON.stringify(calcInput), once, 'Calculator input unchanged');
  assert.equal(JSON.stringify(baseData.input), once, 'base input unchanged');
  assert.equal(Size.calculate({ ...baseData.five }, baseData).source, 'calculator', 'back to the same values the binding goes on');
});

test('base: a Calculator that is not sewn or has a rounded spine is drawn sewn + flat (match=false); the other settings as they are', () => {
  const common = { pageCount: 176, sheetsPerSignature: 4, paperThickness: 0.1, bookWidth: 148, bookHeight: 210, boardThickness: 2, square: 3, turnIn: 15, jointGap: 'auto', spineRule: 'twoT' };
  for (const difference of [{ bindingType: 'single1', spineShape: 'flat' }, { bindingType: 'single2', spineShape: 'flat' }, { bindingType: 'sewn', spineShape: 'rounded', curveLength: 20 }]) {
    const d = calculatorState({ ...common, ...difference }), baseData = Size.fromBase(d);
    assert.equal(baseData.match, false, JSON.stringify(difference));
    assert.notEqual(baseData.result, d.result);
    assert.deepEqual([baseData.input.bindingType, baseData.input.spineShape, 'curveLength' in baseData.input], ['sewn', 'flat', false]);
    assert.deepEqual(baseDiff(Size.calculate(baseData.five, baseData)), [], 'sewn + flat: Sample Book values');
  }
});

test('base: a Calculator error or a value outside the guide\'s limits gives no base (faulty input)', () => {
  assert.ok(Size.fromBase(null).error);
  assert.ok(Size.fromBase({ error: 'Invalid number', input: null, result: null }).error);
  assert.ok(Size.fromBase({}).error, 'empty state');
  const many = Size.fromBase(calculatorState({ bindingType: 'sewn', pageCount: 2000, sheetsPerSignature: 4, bookWidth: 148, bookHeight: 210, paperThickness: 0.1 }));
  assert.deepEqual(many.fields, ['signatureCount']);
  const narrow = Size.fromBase(calculatorState({ bindingType: 'sewn', pageCount: 32, sheetsPerSignature: 4, bookWidth: 40, bookHeight: 500, paperThickness: 0.5 }));
  assert.deepEqual(narrow.fields, ['bookWidth', 'bookHeight', 'paperThickness']);
  // a missing base object is ignored (falls back to the default)
  assert.equal(Size.calculate({}, { input: null }).N, 11);
});

// ---------------------------------------------------------------- 5. faulty input
test('faulty input: invalid values are rejected, the field name is reported (with and without a base)', () => {
  const baseData = Size.fromBase(calculatorState(calculatorDefault(INDEX)));
  const bad = [
    [{ signatureCount: 0 }, 'signatureCount'], [{ signatureCount: 41 }, 'signatureCount'], [{ signatureCount: 2.5 }, 'signatureCount'],
    [{ sheetsPerSignature: 9 }, 'sheetsPerSignature'], [{ bookWidth: 59.9 }, 'bookWidth'], [{ bookHeight: 'abc' }, 'bookHeight'],
    [{ paperThickness: -0.1 }, 'paperThickness'], [{ paperThickness: '1.200' }, 'paperThickness'], [{ bookWidth: '1,2,3' }, 'bookWidth'],
    [{ bookHeight: NaN }, 'bookHeight'], [{ bookHeight: Infinity }, 'bookHeight'], [{ signatureCount: '  ' }, 'signatureCount'],
  ];
  for (const t of [null, baseData]) for (const [g, field] of bad) assert.throws(() => Size.calculate(g, t), (e) => e instanceof RangeError && e.fields.includes(field), JSON.stringify(g));
  assert.equal(Size.calculate({ paperThickness: '0,12' }).S, 10.56, 'decimal comma');
  assert.equal(Size.invalidFields({ signatureCount: '', sheetsPerSignature: '', bookWidth: '', bookHeight: '', paperThickness: '' }).length, 5);
});

test('the comparer catches a broken calculation; the mapping says FAIL for a broken panel copy (faulty input test)', () => {
  const rnd = seed(7);
  const corrupt = {
    'joint +1': (r) => { r.jointGap += 1; },
    'spine × 1.01': (r) => { r.spineThickness = Math.round(r.spineThickness * 1.01 * 1000) / 1000; },
    'covering width −0.1': (r) => { r.covering = { width: r.covering.width - 0.1, height: r.covering.height }; },
    'signatures +1': (r) => { r.signatureCount += 1; },
  };
  for (const [name, breakIt] of Object.entries(corrupt)) {
    let caught = 0;
    for (let i = 0; i < 50; i++) { const g = random(rnd), r = Calc.calculate(applyMapping(g)); breakIt(r); if (compare(Size.calculate(g), r).length) caught++; }
    assert.ok(caught >= 49, `${name}: ${caught}/50`);
  }
  const source = fs.readFileSync(SIZE_PATH, 'utf8');
  const copy = (a, b) => { assert.ok(source.includes(a), 'variant could not be applied: ' + a); const m = { exports: {} };
    new Function('module', 'require', 'self', source.replace(a, b))(m, (name) => require(path.join(APP, 'js', 'learn', name)), undefined); return m.exports; }; // eslint-disable-line no-new-func
  const variants = {
    'pages = signatures × sheets × 2': copy('calcInput.pageCount = sameSignature ? baseData.input.pageCount : N * y * 4;', 'calcInput.pageCount = sameSignature ? baseData.input.pageCount : N * y * 2;'),
    'width ↔ height': copy('calcInput.bookWidth = g.bookWidth; calcInput.bookHeight = g.bookHeight;', 'calcInput.bookWidth = g.bookHeight; calcInput.bookHeight = g.bookWidth;'),
    'thickness rounded': copy('calcInput.paperThickness = g.paperThickness;', 'calcInput.paperThickness = Math.round(g.paperThickness * 10) / 10;'),
    'base board dropped': copy('if (baseData) Object.keys(baseData.input).forEach(function (a) { calcInput[a] = baseData.input[a]; });', ''),
  };
  const baseInput = { boardThickness: 3, square: 4, turnIn: 18 };
  for (const [name, O] of Object.entries(variants)) {
    let fail = 0;
    for (let i = 0; i < 50; i++) {
      const baseData = O.fromBase(calculatorState(applyMapping(random(rnd), baseInput))), g = random(rnd);
      let f; try { f = compare(O.calculate(g, baseData), Calc.calculate(applyMapping(g, { ...baseInput, spineShape: 'flat', shrinkLastSignature: false }))); } catch (e) { f = ['error: ' + e.message]; }
      if (f.length) fail++;
    }
    assert.ok(fail >= 45, `${name}: ${fail}/50 FAIL`);
  }
});

test('the Calculator default parser catches faulty HTML (missing field)', () => {
  assert.throws(() => calculatorDefault(INDEX.replace('id="h-pageCount"', 'id="h-none"')));
  assert.throws(() => calculatorDefault(''));
  assert.equal(calculatorDefault(INDEX.replace(/(id="h-pageCount"[^>]*\s)value="200"/, '$1value="176"')).pageCount, 176, 'when the value changes the value read changes');
});
