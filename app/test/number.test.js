'use strict';
// The single strict number parser (common.parseNumber). Several separators / trailing garbage / exponent / infinity → NaN
// and an error for the user (common.numberError); input that looks like thousands (tr "1.200", en "1,200") is a clear
// error; saved data (record: true) is read in its old format. The Calculator uses the same parser (no Number() of its own).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setupI18n } = require('./i18n-helper.js');

const JS = path.join(__dirname, '..', 'js');
const read = (a) => fs.readFileSync(path.join(JS, a), 'utf8');

/** Loads common.js (with an optional language) into a vm context. fields: fake getElementById values. */
function setup(i18n, fields = {}) {
  const ctx = { document: { getElementById: (id) => (id in fields ? { value: fields[id] } : null) } };
  ctx.self = ctx;
  vm.createContext(ctx);
  if (i18n) setupI18n(ctx, i18n);
  vm.runInContext(read('common.js'), ctx, { filename: 'common.js' });
  return ctx.Mucellit.common;
}

// Vectors: [input, tr result, en result] (NaN = error). The report contains this list as it is.
const VECTORS = [
  ['0,5', 0.5, 0.5], ['0.5', 0.5, 0.5], [' 12 ', 12, 12], ['1,25', 1.25, 1.25], ['-3,5', -3.5, -3.5], ['+2', 2, 2],
  ['.5', 0.5, 0.5], [',5', 0.5, 0.5], ['5.', 5, 5], ['1200', 1200, 1200], ['0.125', 0.125, 0.125], ['0,125', 0.125, 0.125],
  ['1.25', 1.25, 1.25], ['1,2', 1.2, 1.2],
  // looks like thousands: a separator that is not the language's decimal separator + exactly 3 digits, a 1–3 digit head not starting with 0
  ['1.200', NaN, 1.2], ['12.500', NaN, 12.5], ['999.999', NaN, 999.999], ['1,200', 1.2, NaN], ['12,500', 12.5, NaN],
  ['-1.200', NaN, -1.2],
  // several separators / trailing garbage / exponent / empty
  ['1.234,5', NaN, NaN], ['1,234.5', NaN, NaN], ['1,2,3', NaN, NaN], ['1.200.000', NaN, NaN], ['1..2', NaN, NaN],
  ['12abc', NaN, NaN], ['12 mm', NaN, NaN], ['1 200', NaN, NaN], ['1e3', NaN, NaN], ['0x10', NaN, NaN],
  ['Infinity', NaN, NaN], ['--1', NaN, NaN], ['+', NaN, NaN], ['.', NaN, NaN], [',', NaN, NaN], ['', NaN, NaN],
  ['   ', NaN, NaN], ['abc', NaN, NaN], [null, NaN, NaN], [undefined, NaN, NaN]
];

test('parseNumber strict — vectors (tr and en interface)', () => {
  for (const [i18n, column] of [['tr', 1], ['en', 2]]) {
    const O = setup(i18n);
    const wrong = VECTORS.filter((v) => !Object.is(O.parseNumber(v[0]), v[column]) && !(Number.isNaN(v[column]) && Number.isNaN(O.parseNumber(v[0]))));
    assert.deepEqual(wrong.map((v) => `${i18n} ${JSON.stringify(v[0])} → ${O.parseNumber(v[0])} (expected ${v[column]})`), []);
  }
  // without a loaded language the decimal separator is "." (like en)
  const O = setup(null);
  assert.ok(Number.isNaN(O.parseNumber('1,200')) && O.parseNumber('1.200') === 1.2);
  // a number type input as it is (NaN when not finite)
  assert.deepEqual([O.parseNumber(0.1), O.parseNumber(-2)], [0.1, -2]);
  assert.ok([NaN, Infinity, -Infinity].every((n) => Number.isNaN(O.parseNumber(n))));
});

test('saved data (record: true) is read without the thousands check — old "." and "," format', () => {
  const O = setup('tr');
  assert.deepEqual(['0.1', '0,1', '1.200', '297', 0.1].map((s) => O.parseNumber(s, { record: true })), [0.1, 0.1, 1.2, 297, 0.1]);
  // garbage is still rejected
  assert.ok(['1.234,5', '12abc', '1e3'].every((s) => Number.isNaN(O.parseNumber(s, { record: true }))));
});

test('numberError — a clear error for the user (thousands apart, general apart); null when valid or empty', () => {
  const O = setup('tr');
  assert.match(O.numberError('1.200'), /1\.200/);
  assert.match(O.numberError('1.200'), /binlik/i);  // turkish-ok: expected Turkish UI text
  assert.match(O.numberError('12abc'), /12abc/);
  assert.doesNotMatch(O.numberError('12abc'), /binlik/i);  // turkish-ok: expected Turkish UI text
  assert.deepEqual([O.numberError('1,2'), O.numberError(''), O.numberError('  '), O.numberError(null)], [null, null, null, null]);
  const E = setup('en');
  assert.match(E.numberError('1,200'), /thousands/i);
  assert.match(E.numberError('1,2,3'), /n.t a valid number/i);
});

test('number(id) and requiredNumber(id) — empty → default; invalid → NaN / a clear error (no silent default)', () => {
  const O = setup('tr', { a: '0,5', b: '1.200', c: '', d: '12abc' });
  assert.deepEqual(['a', 'c'].map((id) => O.number(id, -1)), [0.5, -1]);
  assert.ok(Number.isNaN(O.number('b', NaN)));
  assert.equal(O.requiredNumber('a', 148), 0.5);
  assert.equal(O.requiredNumber('c', 148), 148);
  assert.throws(() => O.requiredNumber('b', 148), /1\.200/);
  assert.throws(() => O.requiredNumber('d', 148), /12abc/);
});

test('one parser — Calculator, Projects and Imposition do not do their own Number()/parseFloat parsing', () => {
  const problem = (name, k) => {
    const s = [];
    if (/\.value\)?\.trim\(\)\.replace\(/.test(k) || /parseFloat\(/.test(k)) s.push(name + ': own parsing');
    if (/parseNumber\(g\.value\) \|\| 0/.test(k)) s.push(name + ': invalid → silent 0');
    return s;
  };
  assert.deepEqual(['calculator.js', 'projects.js', 'impose.js'].flatMap((a) => problem(a, read(a))), []);
  assert.match(read('calculator.js'), /O\.parseNumber\(/);
  // the checker catches a faulty source
  assert.equal(problem('x', "var v = String($('h').value).trim().replace(',', '.');").length, 1);
  assert.equal(problem('x', 'k[a] = isNumber ? (O.parseNumber(g.value) || 0) : g.value;').length, 1);
  assert.equal(problem('x', 'var n = parseFloat(s);').length, 1);
});

test('the error texts in the dictionary in both languages ({value} parameter)', () => {
  for (const code of ['tr', 'en']) {
    const D = setupI18n((() => { const c = {}; c.self = c; vm.createContext(c); return c; })(), code);
    for (const a of ['number.invalid', 'number.thousands']) {
      assert.ok(D.has(a), `${code} ${a}`);
      assert.match(D.t(a, { value: 'X9', separator: ',' }), /X9/, `${code} ${a}`);
    }
  }
});
