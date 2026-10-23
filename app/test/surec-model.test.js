'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../js/surec-model.js');

test('şablonlar: formalı 14 adım (sırt yuvarlatma isteğe bağlı), tek yaprak 7 adım', () => {
  const f = m.yeniKitap({ ad: 'A', ciltTuru: 'formali' });
  assert.equal(f.adimlar.length, 14);
  assert.equal(f.adimlar.find((a) => a.ad === 'Sırt yuvarlatma').istegeBagli, true);
  const t = m.yeniKitap({ ad: 'B', ciltTuru: 'tek' });
  assert.deepEqual(t.adimlar.map((a) => a.ad), ['Hazırlık', 'Baskı', 'Kesim', 'Sırt hazırlama (tırtıklama)', 'Tutkallama', 'Kapak', 'Preste kurutma']);
});

test('adım işaretle (tarih otomatik), ekle, sil, taşı, ilerleme', () => {
  const k = m.yeniKitap({ ad: 'C', ciltTuru: 'tek' });
  m.adimIsaretle(k, k.adimlar[0].id, true, '2026-10-11');
  assert.equal(k.adimlar[0].tamam, true);
  assert.equal(k.adimlar[0].tarih, '2026-10-11');
  const yeni = m.adimEkle(k, 'Ayraç takma', 1);
  assert.equal(k.adimlar[1].id, yeni.id);
  m.adimTasi(k, yeni.id, 1);
  assert.equal(k.adimlar[2].id, yeni.id);
  m.adimSil(k, yeni.id);
  assert.equal(k.adimlar.length, 7);
  assert.deepEqual(m.ilerleme(k), { biten: 1, toplam: 7, oran: 1 / 7 });
  assert.throws(() => m.adimEkle(k, '   '));
  assert.throws(() => m.yeniKitap({ ad: '' }));
});

test('dogrula: geçerli yedeği kabul, kusurlu yedekleri reddeder', () => {
  const veri = m.bosVeri();
  veri.kitaplar.push(m.yeniKitap({ ad: 'D' }));
  assert.ok(m.dogrula(JSON.parse(JSON.stringify(veri))));
  assert.ok(m.dogrula(m.bosVeri()));
  const kotu = [
    null, [], {}, { surum: 2, kitaplar: [] }, { surum: 1 }, { surum: 1, kitaplar: [null] },
    { surum: 1, kitaplar: [{ id: 'x', ad: '', ciltTuru: 'tek', adimlar: [] }] },
    { surum: 1, kitaplar: [{ id: 'x', ad: 'a', ciltTuru: 'yok', adimlar: [] }] },
    { surum: 1, kitaplar: [{ id: 'x', ad: 'a', ciltTuru: 'tek' }] },
    { surum: 1, kitaplar: [{ id: 'x', ad: 'a', ciltTuru: 'tek', adimlar: [{ id: 'a', ad: 'b', tamam: 'evet' }] }] },
    { surum: 1, kitaplar: [{ id: 'x', ad: 'a', ciltTuru: 'tek', adimlar: [] }, { id: 'x', ad: 'b', ciltTuru: 'tek', adimlar: [] }] }
  ];
  kotu.forEach((v, i) => assert.throws(() => m.dogrula(v), Error, 'kusurlu yedek ' + i + ' reddedilmeli'));
});

// ---- D10: içe aktarma doğrulaması ----
function gecerliVeri() {
  const v = m.bosVeri();
  v.kitaplar.push(m.yeniKitap({ ad: 'T', ciltTuru: 'tek' }));
  return v;
}

test('içe aktarma: adım id tekrarı reddedilir (açıklamalı hata)', () => {
  const v = gecerliVeri();
  v.kitaplar[0].adimlar[1].id = v.kitaplar[0].adimlar[0].id;
  assert.throws(() => m.dogrula(v), /adım id tekrarlanıyor/);
});

test('içe aktarma: not ve tarih metin olmalı', () => {
  const v = gecerliVeri();
  v.kitaplar[0].adimlar[0].not = 5;
  assert.throws(() => m.dogrula(v), /not metin olmalı/);
  const w = gecerliVeri();
  w.kitaplar[0].adimlar[0].tarih = { x: 1 };
  assert.throws(() => m.dogrula(w), /tarih metin olmalı/);
});

test('içe aktarma: ayar nesne olmalı (dizi/metin/sayı reddedilir; null ve nesne olur)', () => {
  [[], 'x', 5].forEach((kotu) => {
    const v = gecerliVeri();
    v.kitaplar[0].ayar = kotu;
    assert.throws(() => m.dogrula(v), /ayar bir nesne olmalı/);
  });
  const ok = gecerliVeri();
  ok.kitaplar[0].ayar = { ciltTuru: 'formali' };
  assert.equal(m.dogrula(ok), true);
  ok.kitaplar[0].ayar = null;
  assert.equal(m.dogrula(ok), true);
});

test('içe aktarma: geçerli yeni kitap (not/tarih boş metin) kabul edilir', () => {
  assert.equal(m.dogrula(gecerliVeri()), true);
});
