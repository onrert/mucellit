'use strict';
// tek katı sayı ayrıştırıcı (ortak.sayiCoz). Çoklu ayraç / sondaki çöp / üs / sonsuz → NaN ve
// kullanıcıya hata (ortak.sayiHatasi); binliğe benzeyen girdi (tr "1.200", en "1,200") açık hata; kayıtlı veri
// (kayit: true) eski biçimiyle okunur. Hesapla da aynı ayrıştırıcıyı kullanır (kendi Number() ayrıştırması yok).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setupI18n } = require('./i18n-helper.js');

const JS = path.join(__dirname, '..', 'js');
const read = (a) => fs.readFileSync(path.join(JS, a), 'utf8');

/** common.js'i (isteğe bağlı dil ile) vm bağlamına yükler. alanlar: sahte getElementById değerleri. */
function setup(i18n, fields = {}) {
  const ctx = { document: { getElementById: (id) => (id in fields ? { value: fields[id] } : null) } };
  ctx.self = ctx;
  vm.createContext(ctx);
  if (i18n) setupI18n(ctx, i18n);
  vm.runInContext(read('common.js'), ctx, { filename: 'common.js' });
  return ctx.Mucellit.common;
}

// Vektörler: [girdi, tr sonucu, en sonucu] (NaN = hata). Rapor bu listeyi aynen içerir.
const VECTORS = [
  ['0,5', 0.5, 0.5], ['0.5', 0.5, 0.5], [' 12 ', 12, 12], ['1,25', 1.25, 1.25], ['-3,5', -3.5, -3.5], ['+2', 2, 2],
  ['.5', 0.5, 0.5], [',5', 0.5, 0.5], ['5.', 5, 5], ['1200', 1200, 1200], ['0.125', 0.125, 0.125], ['0,125', 0.125, 0.125],
  ['1.25', 1.25, 1.25], ['1,2', 1.2, 1.2],
  // binliğe benzeyen: dilin ondalık ayracı olmayan ayraç + tam 3 hane, baş kısım 1–3 hane ve 0 ile başlamıyor
  ['1.200', NaN, 1.2], ['12.500', NaN, 12.5], ['999.999', NaN, 999.999], ['1,200', 1.2, NaN], ['12,500', 12.5, NaN],
  ['-1.200', NaN, -1.2],
  // çoklu ayraç / sondaki çöp / üs / boş
  ['1.234,5', NaN, NaN], ['1,234.5', NaN, NaN], ['1,2,3', NaN, NaN], ['1.200.000', NaN, NaN], ['1..2', NaN, NaN],
  ['12abc', NaN, NaN], ['12 mm', NaN, NaN], ['1 200', NaN, NaN], ['1e3', NaN, NaN], ['0x10', NaN, NaN],
  ['Infinity', NaN, NaN], ['--1', NaN, NaN], ['+', NaN, NaN], ['.', NaN, NaN], [',', NaN, NaN], ['', NaN, NaN],
  ['   ', NaN, NaN], ['abc', NaN, NaN], [null, NaN, NaN], [undefined, NaN, NaN]
];

test('parseNumber katı — vektörler (tr ve en arayüzü)', () => {
  for (const [i18n, column] of [['tr', 1], ['en', 2]]) {
    const O = setup(i18n);
    const wrong = VECTORS.filter((v) => !Object.is(O.parseNumber(v[0]), v[column]) && !(Number.isNaN(v[column]) && Number.isNaN(O.parseNumber(v[0]))));
    assert.deepEqual(wrong.map((v) => `${i18n} ${JSON.stringify(v[0])} → ${O.parseNumber(v[0])} (expected ${v[column]})`), []);
  }
  // dil yüklü değilse ondalık ayracı "." sayılır (en gibi)
  const O = setup(null);
  assert.ok(Number.isNaN(O.parseNumber('1,200')) && O.parseNumber('1.200') === 1.2);
  // sayı türü girdi aynen (sonlu değilse NaN)
  assert.deepEqual([O.parseNumber(0.1), O.parseNumber(-2)], [0.1, -2]);
  assert.ok([NaN, Infinity, -Infinity].every((n) => Number.isNaN(O.parseNumber(n))));
});

test('kayıtlı veri (kayit: true) binlik denetimi olmadan okunur — eski "." ve "," biçimi', () => {
  const O = setup('tr');
  assert.deepEqual(['0.1', '0,1', '1.200', '297', 0.1].map((s) => O.parseNumber(s, { record: true })), [0.1, 0.1, 1.2, 297, 0.1]);
  // çöp yine reddedilir
  assert.ok(['1.234,5', '12abc', '1e3'].every((s) => Number.isNaN(O.parseNumber(s, { record: true }))));
});

test('numberError — kullanıcıya anlaşılır hata (binlik ayrı, genel ayrı); geçerli ya da boşsa null', () => {
  const O = setup('tr');
  assert.match(O.numberError('1.200'), /1\.200/);
  assert.match(O.numberError('1.200'), /binlik/i);
  assert.match(O.numberError('12abc'), /12abc/);
  assert.doesNotMatch(O.numberError('12abc'), /binlik/i);
  assert.deepEqual([O.numberError('1,2'), O.numberError(''), O.numberError('  '), O.numberError(null)], [null, null, null, null]);
  const E = setup('en');
  assert.match(E.numberError('1,200'), /thousands/i);
  assert.match(E.numberError('1,2,3'), /n.t a valid number/i);
});

test('number(id) ve requiredNumber(id) — boş → öntanımlı; geçersiz → NaN / anlaşılır hata (sessiz öntanımlı yok)', () => {
  const O = setup('tr', { a: '0,5', b: '1.200', c: '', d: '12abc' });
  assert.deepEqual(['a', 'c'].map((id) => O.number(id, -1)), [0.5, -1]);
  assert.ok(Number.isNaN(O.number('b', NaN)));
  assert.equal(O.requiredNumber('a', 148), 0.5);
  assert.equal(O.requiredNumber('c', 148), 148);
  assert.throws(() => O.requiredNumber('b', 148), /1\.200/);
  assert.throws(() => O.requiredNumber('d', 148), /12abc/);
});

test('tek ayrıştırıcı — Hesapla, Süreç ve Düzenle kendi Number()/parseFloat ayrıştırmasını yapmaz', () => {
  const problem = (name, k) => {
    const s = [];
    if (/\.value\)?\.trim\(\)\.replace\(/.test(k) || /parseFloat\(/.test(k)) s.push(name + ': kendi ayrıştırması');
    if (/parseNumber\(g\.value\) \|\| 0/.test(k)) s.push(name + ': geçersiz → sessiz 0');
    return s;
  };
  assert.deepEqual(['calculator.js', 'projects.js', 'impose.js'].flatMap((a) => problem(a, read(a))), []);
  assert.match(read('calculator.js'), /O\.parseNumber\(/);
  // denetleyici kusurlu kaynağı yakalar
  assert.equal(problem('x', "var v = String($('h').value).trim().replace(',', '.');").length, 1);
  assert.equal(problem('x', 'k[a] = isNumber ? (O.parseNumber(g.value) || 0) : g.value;').length, 1);
  assert.equal(problem('x', 'var n = parseFloat(s);').length, 1);
});

test('sözlükte error texts iki inLang ({value} parametreli)', () => {
  for (const code of ['tr', 'en']) {
    const D = setupI18n((() => { const c = {}; c.self = c; vm.createContext(c); return c; })(), code);
    for (const a of ['number.invalid', 'number.thousands']) {
      assert.ok(D.has(a), `${code} ${a}`);
      assert.match(D.t(a, { value: 'X9', separator: ',' }), /X9/, `${code} ${a}`);
    }
  }
});
