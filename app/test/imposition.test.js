'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../js/imposition.js');

test('formalı: 10 sayfa, forma 4 yaprak → 16 sayfaya tamamlanır', () => {
  const r = d.formali({ sayfaSayisi: 10, formaYaprak: 4 });
  assert.equal(r.toplamSayfa, 16);
  assert.equal(r.formalar.length, 1);
  assert.equal(r.yapraklar.length, 4);
  // "yaprak 1" ve "yaprak 4" 1'den sayılır (formül i = 0..3)
  assert.deepEqual(r.yapraklar[0].on, [16, 1]);
  assert.deepEqual(r.yapraklar[0].arka, [2, 15]);
  assert.deepEqual(r.yapraklar[3].on, [10, 7]);
  assert.deepEqual(r.yapraklar[3].arka, [8, 9]);
  for (let s = 1; s <= 10; s++) assert.equal(r.bosMu(s), false, 'sayfa ' + s + ' dolu olmalı');
  for (let s = 11; s <= 16; s++) assert.equal(r.bosMu(s), true, 'sayfa ' + s + ' boş olmalı');
  assert.ok(d.denetle(r));
});

test('formalı: 37 sayfa, forma 4 → 48 sayfa, 3 forma, 12 yaprak; 2. forma 1. yaprak ön [32,17]', () => {
  const r = d.formali({ sayfaSayisi: 37, formaYaprak: 4 });
  assert.equal(r.toplamSayfa, 48);
  assert.equal(r.formalar.length, 3);
  assert.equal(r.yapraklar.length, 12);
  const y = r.yapraklar.find((x) => x.forma === 1 && x.formaIci === 0);
  assert.deepEqual(y.on, [32, 17]);
  assert.deepEqual(y.arka, [18, 31]);
  assert.ok(d.denetle(r));
});

test('formalı: son formayı küçültme (37 sayfa → 32 + 8 = 40)', () => {
  const r = d.formali({ sayfaSayisi: 37, formaYaprak: 4, sonFormaKucult: true });
  assert.equal(r.toplamSayfa, 40);
  assert.deepEqual(r.formalar.map((f) => f.yaprakSayisi), [4, 4, 2]);
  const son = r.yapraklar.filter((y) => y.forma === 2);
  assert.deepEqual(son[0].on, [40, 33]);
  assert.deepEqual(son[1].arka, [36, 37]);
  assert.ok(d.denetle(r));
});

test('formalı: forma yaprak sınırları 1–8, dışı hata', () => {
  assert.equal(d.formali({ sayfaSayisi: 3, formaYaprak: 1 }).toplamSayfa, 4);
  assert.equal(d.formali({ sayfaSayisi: 3, formaYaprak: 8 }).toplamSayfa, 32);
  assert.throws(() => d.formali({ sayfaSayisi: 3, formaYaprak: 0 }), RangeError);
  assert.throws(() => d.formali({ sayfaSayisi: 3, formaYaprak: 9 }), RangeError);
  assert.throws(() => d.formali({ sayfaSayisi: 3, formaYaprak: 2.5 }), RangeError);
  assert.throws(() => d.formali({ sayfaSayisi: 0 }), RangeError);
  assert.throws(() => d.formali({}), RangeError);
  assert.equal(d.formali({ sayfaSayisi: 5 }).yapraklar.length, 4, 'varsayılan 4 yaprak');
});

test('formalı: her sayfa tam bir kez (1..200, forma 1..8)', () => {
  for (let k = 1; k <= 8; k++) {
    for (const p of [1, 2, 15, 16, 17, 63, 200]) {
      for (const kucult of [false, true]) {
        const r = d.formali({ sayfaSayisi: p, formaYaprak: k, sonFormaKucult: kucult });
        assert.ok(d.denetle(r));
        assert.ok(r.toplamSayfa >= p && r.toplamSayfa % 4 === 0);
      }
    }
  }
});

test('2-up kes-üst üste: 8 sayfa → N=2', () => {
  const r = d.tek2({ sayfaSayisi: 8 });
  assert.equal(r.yapraklar.length, 2);
  assert.equal(r.toplamSayfa, 8);
  assert.deepEqual(r.yapraklar[0].on, [1, 5]);
  assert.deepEqual(r.yapraklar[0].arka, [6, 2]);
  assert.deepEqual(r.yapraklar[1].on, [3, 7]);
  assert.deepEqual(r.yapraklar[1].arka, [8, 4]);
  assert.ok(d.denetle(r));
});

test('2-up: kesip sağ desteyi sol destenin altına koyunca sıra 1..4N', () => {
  for (const p of [1, 5, 8, 9, 37, 101]) {
    const r = d.tek2({ sayfaSayisi: p });
    const sol = [], sag = [];
    // ön/arka sol yarı aynı kağıt parçası: ön sol + arka sağ; ön sağ + arka sol
    r.yapraklar.forEach((y) => { sol.push(y.on[0], y.arka[1]); sag.push(y.on[1], y.arka[0]); });
    const sira = sol.concat(sag);
    assert.deepEqual(sira, Array.from({ length: r.toplamSayfa }, (_, i) => i + 1));
  }
});

test('1-up: ön 2i+1, arka 2i+2; tek sayı tamamlanır', () => {
  const r = d.tek1({ sayfaSayisi: 5 });
  assert.equal(r.toplamSayfa, 6);
  assert.deepEqual(r.yapraklar.map((y) => [y.on[0], y.arka[0]]), [[1, 2], [3, 4], [5, 6]]);
  assert.equal(r.bosMu(6), true);
  assert.ok(d.denetle(r));
});

test('kayma: kalınlık 0.1 mm, yaprak 3 → 0.3 mm', () => {
  assert.equal(d.kayma(3, 0.1), 0.3);
  assert.equal(d.kayma(0, 0.1), 0);
  const r = d.formali({ sayfaSayisi: 16, formaYaprak: 4, kaymaAcik: true, kagitKalinlik: 0.1 });
  assert.deepEqual(r.yapraklar.map((y) => y.kayma), [0, 0.1, 0.2, 0.3]);
  const kapali = d.formali({ sayfaSayisi: 16, formaYaprak: 4, kagitKalinlik: 0.1 });
  assert.deepEqual(kapali.yapraklar.map((y) => y.kayma), [0, 0, 0, 0], 'varsayılan kapalı');
  assert.throws(() => d.kayma(1, -0.1), RangeError);
});

test('denetle: bozuk dizilimi yakalar (kopya ve eksik sayfa)', () => {
  const r = d.formali({ sayfaSayisi: 8, formaYaprak: 2 });
  const kopya = JSON.parse(JSON.stringify(r)); kopya.yapraklar[1].on[0] = kopya.yapraklar[0].on[0];
  assert.throws(() => d.denetle(kopya), /iki kez/);
  const eksik = JSON.parse(JSON.stringify(r)); eksik.yapraklar.pop();
  assert.throws(() => d.denetle(eksik), /yerleşmedi/);
  const bos = { toplamSayfa: 4, yapraklar: [] };
  assert.throws(() => d.denetle(bos), /yerleşmedi/);
});

test('diz: tür seçimi ve bilinmeyen tür', () => {
  assert.equal(d.diz('formali', { sayfaSayisi: 4 }).tur, 'formali');
  assert.equal(d.diz('tek1', { sayfaSayisi: 4 }).tur, 'tek1');
  assert.equal(d.diz('tek2', { sayfaSayisi: 4 }).tur, 'tek2');
  assert.throws(() => d.diz('xx', { sayfaSayisi: 4 }));
});
