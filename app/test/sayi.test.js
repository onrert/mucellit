'use strict';
// tek katı sayı ayrıştırıcı (ortak.sayiCoz). Çoklu ayraç / sondaki çöp / üs / sonsuz → NaN ve
// kullanıcıya hata (ortak.sayiHatasi); binliğe benzeyen girdi (tr "1.200", en "1,200") açık hata; kayıtlı veri
// (kayit: true) eski biçimiyle okunur. Hesapla da aynı ayrıştırıcıyı kullanır (kendi Number() ayrıştırması yok).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { dilKur } = require('./dil-yardimci.js');

const JS = path.join(__dirname, '..', 'js');
const oku = (a) => fs.readFileSync(path.join(JS, a), 'utf8');

/** ortak.js'i (isteğe bağlı dil ile) vm bağlamına yükler. alanlar: sahte getElementById değerleri. */
function kur(dil, alanlar = {}) {
  const ctx = { document: { getElementById: (id) => (id in alanlar ? { value: alanlar[id] } : null) } };
  ctx.self = ctx;
  vm.createContext(ctx);
  if (dil) dilKur(ctx, dil);
  vm.runInContext(oku('ortak.js'), ctx, { filename: 'ortak.js' });
  return ctx.KitapCilt.ortak;
}

// Vektörler: [girdi, tr sonucu, en sonucu] (NaN = hata). Rapor bu listeyi aynen içerir.
const VEKTORLER = [
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

test('sayiCoz katı — vektörler (tr ve en arayüzü)', () => {
  for (const [dil, sutun] of [['tr', 1], ['en', 2]]) {
    const O = kur(dil);
    const yanlis = VEKTORLER.filter((v) => !Object.is(O.sayiCoz(v[0]), v[sutun]) && !(Number.isNaN(v[sutun]) && Number.isNaN(O.sayiCoz(v[0]))));
    assert.deepEqual(yanlis.map((v) => `${dil} ${JSON.stringify(v[0])} → ${O.sayiCoz(v[0])} (beklenen ${v[sutun]})`), []);
  }
  // dil yüklü değilse ondalık ayracı "." sayılır (en gibi)
  const O = kur(null);
  assert.ok(Number.isNaN(O.sayiCoz('1,200')) && O.sayiCoz('1.200') === 1.2);
  // sayı türü girdi aynen (sonlu değilse NaN)
  assert.deepEqual([O.sayiCoz(0.1), O.sayiCoz(-2)], [0.1, -2]);
  assert.ok([NaN, Infinity, -Infinity].every((n) => Number.isNaN(O.sayiCoz(n))));
});

test('kayıtlı veri (kayit: true) binlik denetimi olmadan okunur — eski "." ve "," biçimi', () => {
  const O = kur('tr');
  assert.deepEqual(['0.1', '0,1', '1.200', '297', 0.1].map((s) => O.sayiCoz(s, { kayit: true })), [0.1, 0.1, 1.2, 297, 0.1]);
  // çöp yine reddedilir
  assert.ok(['1.234,5', '12abc', '1e3'].every((s) => Number.isNaN(O.sayiCoz(s, { kayit: true }))));
});

test('sayiHatasi — kullanıcıya anlaşılır hata (binlik ayrı, genel ayrı); geçerli ya da boşsa null', () => {
  const O = kur('tr');
  assert.match(O.sayiHatasi('1.200'), /1\.200/);
  assert.match(O.sayiHatasi('1.200'), /binlik/i);
  assert.match(O.sayiHatasi('12abc'), /12abc/);
  assert.doesNotMatch(O.sayiHatasi('12abc'), /binlik/i);
  assert.deepEqual([O.sayiHatasi('1,2'), O.sayiHatasi(''), O.sayiHatasi('  '), O.sayiHatasi(null)], [null, null, null, null]);
  const E = kur('en');
  assert.match(E.sayiHatasi('1,200'), /thousands/i);
  assert.match(E.sayiHatasi('1,2,3'), /n.t a valid number/i);
});

test('sayi(id) ve sayiZorunlu(id) — boş → öntanımlı; geçersiz → NaN / anlaşılır hata (sessiz öntanımlı yok)', () => {
  const O = kur('tr', { a: '0,5', b: '1.200', c: '', d: '12abc' });
  assert.deepEqual(['a', 'c'].map((id) => O.sayi(id, -1)), [0.5, -1]);
  assert.ok(Number.isNaN(O.sayi('b', NaN)));
  assert.equal(O.sayiZorunlu('a', 148), 0.5);
  assert.equal(O.sayiZorunlu('c', 148), 148);
  assert.throws(() => O.sayiZorunlu('b', 148), /1\.200/);
  assert.throws(() => O.sayiZorunlu('d', 148), /12abc/);
});

test('tek ayrıştırıcı — Hesapla, Süreç ve Düzenle kendi Number()/parseFloat ayrıştırmasını yapmaz', () => {
  const sorun = (ad, k) => {
    const s = [];
    if (/\.value\)?\.trim\(\)\.replace\(/.test(k) || /parseFloat\(/.test(k)) s.push(ad + ': kendi ayrıştırması');
    if (/sayiCoz\(g\.value\) \|\| 0/.test(k)) s.push(ad + ': geçersiz → sessiz 0');
    return s;
  };
  assert.deepEqual(['hesapla.js', 'surec.js', 'duzenle.js'].flatMap((a) => sorun(a, oku(a))), []);
  assert.match(oku('hesapla.js'), /O\.sayiCoz\(/);
  // denetleyici kusurlu kaynağı yakalar
  assert.equal(sorun('x', "var v = String($('h').value).trim().replace(',', '.');").length, 1);
  assert.equal(sorun('x', 'k[a] = sayiMi ? (O.sayiCoz(g.value) || 0) : g.value;').length, 1);
  assert.equal(sorun('x', 'var n = parseFloat(s);').length, 1);
});

test('sözlükte hata metinleri iki dilde ({deger} parametreli)', () => {
  for (const kod of ['tr', 'en']) {
    const D = dilKur((() => { const c = {}; c.self = c; vm.createContext(c); return c; })(), kod);
    for (const a of ['sayi.gecersiz', 'sayi.binlik']) {
      assert.ok(D.var(a), `${kod} ${a}`);
      assert.match(D.t(a, { deger: 'X9', ayrac: ',' }), /X9/, `${kod} ${a}`);
    }
  }
});
