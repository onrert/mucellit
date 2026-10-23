'use strict';
// storage.js'i sahte localStorage ile (vm bağlamında) sınar: kota dolu / bozuk kayıt davranışı.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { dilKur } = require('./i18n-helper.js');

function kur(depo) {
  const ctx = { localStorage: depo };
  vm.createContext(ctx);
  dilKur(ctx);
  ['project-model.js', 'storage.js'].forEach((ad) => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', ad), 'utf8'), ctx, { filename: ad });
  });
  return ctx.KitapCilt;
}

function sahteDepo() {
  const d = { veri: {}, dolu: false };
  d.getItem = (k) => (k in d.veri ? d.veri[k] : null);
  d.setItem = (k, v) => { if (d.dolu) throw new Error('QuotaExceededError'); d.veri[k] = String(v); };
  d.removeItem = (k) => { delete d.veri[k]; };
  return d;
}

function adlar(v) { return Array.from(v.kitaplar, (k) => k.ad); }

function kitapliVeri(KC, ad) {
  const v = KC.surecModel.bosVeri();
  v.kitaplar.push(KC.surecModel.yeniKitap({ ad }));
  return v;
}

test('kota dolunca oku() eski kalıcı kaydı değil, bellekteki en yeni veriyi döndürür', () => {
  const d = sahteDepo();
  const KC = kur(d);
  assert.equal(KC.depo.yaz(kitapliVeri(KC, 'Eski')), true);
  d.dolu = true;
  const yeni = kitapliVeri(KC, 'Eski');
  yeni.kitaplar.push(KC.surecModel.yeniKitap({ ad: 'Yeni' }));
  assert.equal(KC.depo.yaz(yeni), false);
  assert.equal(KC.depo.kaliciMi(), false);
  assert.deepEqual(adlar(KC.depo.oku()), ['Eski', 'Yeni']);
});

test('yazım yeniden başarılı olunca kalıcı moda döner ve oku() depoyu okur', () => {
  const d = sahteDepo();
  const KC = kur(d);
  KC.depo.yaz(kitapliVeri(KC, 'A'));
  d.dolu = true;
  KC.depo.yaz(kitapliVeri(KC, 'B'));
  d.dolu = false;
  assert.equal(KC.depo.yaz(kitapliVeri(KC, 'C')), true);
  assert.equal(KC.depo.kaliciMi(), true);
  assert.deepEqual(adlar(KC.depo.oku()), ['C']);
});

test('bozuk kayıt uyarısı başarılı yazımdan sonra kalkar; ham kayıt yedeklenir', () => {
  const d = sahteDepo();
  const KC = kur(d);
  d.veri[KC.depo.ANAHTAR] = '{bozuk json';
  const v = KC.depo.oku();
  assert.equal(v.kitaplar.length, 0);
  assert.equal(KC.depo.bozukMu(), true);
  assert.equal(d.veri[KC.depo.ANAHTAR + '.bozuk'], '{bozuk json');
  assert.equal(KC.depo.yaz(kitapliVeri(KC, 'X')), true);
  assert.equal(KC.depo.bozukMu(), false);
});

test('saklama hiç yoksa (getItem atar) bellekten sürer', () => {
  const KC = kur({ getItem() { throw new Error('yok'); }, setItem() { throw new Error('yok'); }, removeItem() {} });
  assert.equal(KC.depo.yaz(kitapliVeri(KC, 'B')), false);
  assert.deepEqual(adlar(KC.depo.oku()), ['B']);
});

test('temizle sonrası oku() silinmiş/eski kaydı döndürmez (removeItem başarısız olsa da)', () => {
  const d = sahteDepo();
  const KC = kur(d);
  assert.equal(KC.depo.yaz(kitapliVeri(KC, 'A')), true);
  d.removeItem = () => { throw new Error('silinemedi'); };
  KC.depo.temizle();
  assert.equal(KC.depo.oku().kitaplar.length, 0, 'removeItem atsa da eski kayıt dönmez');
  // normal yol
  const d2 = sahteDepo();
  const KC2 = kur(d2);
  KC2.depo.yaz(kitapliVeri(KC2, 'B'));
  KC2.depo.temizle();
  assert.equal(KC2.depo.oku().kitaplar.length, 0);
  // kota doluyken (bellek en yeni) temizle: eski kalıcı kayıt geri gelmez
  const d3 = sahteDepo();
  const KC3 = kur(d3);
  KC3.depo.yaz(kitapliVeri(KC3, 'A'));
  d3.dolu = true;
  KC3.depo.yaz(kitapliVeri(KC3, 'B'));
  d3.removeItem = () => { throw new Error('silinemedi'); };
  KC3.depo.temizle();
  assert.equal(KC3.depo.oku().kitaplar.length, 0);
});
