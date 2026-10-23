'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../js/hesap.js');

test('200 sayfa → 100 yaprak; 0.1 mm kağıtla sırt 10 mm', () => {
  assert.equal(h.yaprakSayisi(200), 100);
  assert.equal(h.sirtKalinligi(100, 0.1), 10);
  const r = h.hesapla({ sayfaSayisi: 200, ciltTuru: 'tek1', kagitKalinlik: 0.1 });
  assert.equal(r.kitapYaprak, 100);
  assert.equal(r.sirtKalinlik, 10);
  assert.equal(r.baskiKagidi, 100);
});

test('forza payı sırta eklenir; tek sayı sayfa yukarı yuvarlanır', () => {
  assert.equal(h.sirtKalinligi(100, 0.1, 1.5), 11.5);
  assert.equal(h.yaprakSayisi(201), 101);
});

test('formalı: boş sayfalar sırta dahil, forma ve kağıt adedi', () => {
  const r = h.hesapla({ sayfaSayisi: 200, ciltTuru: 'formali', formaYaprak: 4, kagitKalinlik: 0.1 });
  assert.equal(r.toplamSayfa, 208);
  assert.equal(r.formaSayisi, 13);
  assert.equal(r.kitapYaprak, 104);
  assert.equal(r.sirtKalinlik, 10.4);
  assert.equal(r.baskiKagidi, 52);
  assert.equal(r.bosSayfa, 8);
});

test('2-up kağıt adedi = toplam / 4', () => {
  const r = h.hesapla({ sayfaSayisi: 37, ciltTuru: 'tek2' });
  assert.equal(r.toplamSayfa, 40);
  assert.equal(r.baskiKagidi, 10);
});

// S = 120 yaprak × 0,1 = 12 mm
const TEMEL = { sayfaSayisi: 240, ciltTuru: 'tek1', kagitKalinlik: 0.1, kitapGen: 148, kitapYuk: 210, mukavvaKalinlik: 2, tasma: 3, kivirma: 15 };

test('sert kapak: düz sırt, S+2t → mukavva 144×216, sırt şeridi 16×216, mafsal 7, kaplama 352×250', () => {
  const r = h.hesapla(TEMEL);
  assert.equal(r.sirtKalinlik, 12);
  assert.deepEqual(r.mukavva, { gen: 144, yuk: 216, adet: 2 });
  assert.deepEqual(r.sirtSeridi, { gen: 16, yuk: 216, adet: 1 });
  assert.equal(r.mafsal, 7);
  assert.equal(r.mafsalKaplama, 7);
  assert.deepEqual(r.kaplama, { gen: 352, yuk: 250 });
});

test('sert kapak: "yalnız S" kuralı → şerit 12, kaplamada mafsal 9, kaplama yine 352×250', () => {
  const r = h.hesapla({ ...TEMEL, sirtKurali: 'yalnizS' });
  assert.deepEqual(r.sirtSeridi, { gen: 12, yuk: 216, adet: 1 });
  assert.equal(r.mafsal, 7);
  assert.equal(r.mafsalKaplama, 9);
  assert.deepEqual(r.mukavva, { gen: 144, yuk: 216, adet: 2 });
  assert.deepEqual(r.kaplama, { gen: 352, yuk: 250 });
});

test('otomatik mafsal: t=1 → 6, t=2.5 → 8, t=4 → 9 ve kaynak yok bayrağı', () => {
  assert.equal(h.hesapla({ ...TEMEL, mukavvaKalinlik: 1 }).mafsal, 6);
  assert.equal(h.hesapla({ ...TEMEL, mukavvaKalinlik: 2 }).mafsal, 7);
  const r25 = h.hesapla({ ...TEMEL, mukavvaKalinlik: 2.5 });
  assert.equal(r25.mafsal, 8);
  assert.equal(r25.mafsalKaynakYok, false);
  assert.equal(h.hesapla({ ...TEMEL, mukavvaKalinlik: 3 }).mafsal, 8);
  const r4 = h.hesapla({ ...TEMEL, mukavvaKalinlik: 4 });
  assert.equal(r4.mafsal, 9);
  assert.equal(r4.mafsalKaynakYok, true);
});

test('elle mafsal otomatiği ezer ve kaynak yok bayrağı çıkmaz', () => {
  const r = h.hesapla({ ...TEMEL, mukavvaKalinlik: 4, mafsal: 10 });
  assert.equal(r.mafsal, 10);
  assert.equal(r.mafsalKaynakYok, false);
  assert.equal(r.mukavva.gen, 148 - 10 + 3);
});

test('forza 296×210 ×2; mull 62×198; kapital 12 ×2', () => {
  const r = h.hesapla(TEMEL);
  assert.deepEqual(r.forza, { gen: 296, yuk: 210, adet: 2 });
  assert.deepEqual(r.mull, { gen: 62, yuk: 198 });
  assert.deepEqual(r.kapital, { uzunluk: 12, adet: 2 });
});

test('yuvarlak sırt: eğri boyu 20 → şerit 23; boşsa 16 + 3 = 19 ve uyarı bayrağı', () => {
  const r = h.hesapla({ ...TEMEL, sirtTipi: 'yuvarlak', egriBoyu: 20 });
  assert.deepEqual(r.sirtSeridi, { gen: 23, yuk: 216, adet: 1 });
  assert.equal(r.egriBoyuUyari, false);
  const b = h.hesapla({ ...TEMEL, sirtTipi: 'yuvarlak' });
  assert.deepEqual(b.sirtSeridi, { gen: 19, yuk: 216, adet: 1 });
  assert.equal(b.egriBoyuUyari, true);
  assert.equal(h.hesapla({ ...TEMEL, sirtTipi: 'yuvarlak', egriBoyu: '' }).sirtSeridi.gen, 19);
  assert.equal(h.hesapla(TEMEL).egriBoyuUyari, false);
  // yuvarlak sırtta kural seçeneği şerit formülünü değiştirmez
  assert.equal(h.hesapla({ ...TEMEL, sirtTipi: 'yuvarlak', egriBoyu: 20, sirtKurali: 'yalnizS' }).sirtSeridi.gen, 23);
});

test('sert kapak: negatif / sıfır t, k, e, mafsal, eğri boyu reddedilir', () => {
  ['mukavvaKalinlik', 'kivirma'].forEach((ad) => {
    assert.throws(() => h.hesapla({ ...TEMEL, [ad]: 0 }), RangeError, ad + '=0');
    assert.throws(() => h.hesapla({ ...TEMEL, [ad]: -1 }), RangeError, ad + '=-1');
  });
  assert.throws(() => h.hesapla({ ...TEMEL, tasma: -1 }), RangeError, 'tasma=-1');
  assert.throws(() => h.hesapla({ ...TEMEL, mafsal: 0 }), RangeError);
  assert.throws(() => h.hesapla({ ...TEMEL, mafsal: -2 }), RangeError);
  assert.throws(() => h.hesapla({ ...TEMEL, sirtTipi: 'yuvarlak', egriBoyu: -3 }), RangeError);
  assert.throws(() => h.hesapla({ ...TEMEL, sirtTipi: 'kare' }));
  assert.throws(() => h.hesapla({ ...TEMEL, sirtKurali: 'x' }));
});

test('varsayılanlar: t 2, k 3, e 15, mafsal otomatik, sırt düz, kural S+2t', () => {
  assert.equal(h.VARSAYILAN.mukavvaKalinlik, 2);
  assert.equal(h.VARSAYILAN.tasma, 3);
  assert.equal(h.VARSAYILAN.kivirma, 15);
  assert.equal(h.VARSAYILAN.mafsal, 'otomatik');
  assert.equal(h.VARSAYILAN.sirtTipi, 'duz');
  assert.equal(h.VARSAYILAN.sirtKurali, 'ikiT');
  const r = h.hesapla({ sayfaSayisi: 240, ciltTuru: 'tek1', kagitKalinlik: 0.1 });
  assert.deepEqual(r.kaplama, { gen: 352, yuk: 250 });
});

test('kusurlu girdi: negatif / boş / sayı olmayan', () => {
  assert.throws(() => h.hesapla({ sayfaSayisi: -5 }), RangeError);
  assert.throws(() => h.hesapla({}), RangeError);
  assert.throws(() => h.hesapla({ sayfaSayisi: 'abc' }), RangeError);
  assert.throws(() => h.hesapla({ sayfaSayisi: 10, kagitKalinlik: -1 }), RangeError);
  assert.throws(() => h.hesapla({ sayfaSayisi: 10, formaYaprak: 9 }), RangeError);
  assert.throws(() => h.hesapla({ sayfaSayisi: 10, ciltTuru: 'yok' }));
});

// ---- D9: Hesapla Düzenle ile aynı: forma yaprağı tam sayı olmalı ----
test('forma yaprağı tam sayı olmayan girdi reddedilir (yuvarlanmaz)', () => {
  assert.throws(() => h.hesapla({ sayfaSayisi: 100, formaYaprak: 2.6 }), /tam sayı/);
  assert.throws(() => h.hesapla({ sayfaSayisi: 100, formaYaprak: 0.5 }), RangeError);
  assert.equal(h.hesapla({ sayfaSayisi: 100, formaYaprak: 3 }).girdi.formaYaprak, 3);
});

// ---- AR: sonuç doğrulaması ve taşma 0 ----
test('taşma k = 0 kabul edilir (mukavva blokla aynı hizada)', () => {
  const r = h.hesapla({ ...TEMEL, tasma: 0 });
  assert.equal(r.mukavva.gen, 148 - r.mafsal);
  assert.equal(r.mukavva.yuk, 210);
});

test('sonuç Db <= 0 ise RangeError (W=5, mafsal=10 elle, k=0.5) ve ölçüyü adıyla söyler', () => {
  assert.throws(() => h.hesapla({ ...TEMEL, kitapGen: 5, mafsal: 10, tasma: 0.5 }), (e) => e instanceof RangeError && /mukavva genişliği/.test(e.message) && /-4\.5/.test(e.message));
});

test('mull yüksekliği <= 0 ise RangeError', () => {
  assert.throws(() => h.hesapla({ ...TEMEL, kitapYuk: 12 }), (e) => e instanceof RangeError && /mull yüksekliği/.test(e.message));
});
