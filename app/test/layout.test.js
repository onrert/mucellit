'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../js/imposition.js');
const y = require('../js/layout.js');

const AYAR = { kagitGen: 297, kagitYuk: 210, kitapGen: 148, kitapYuk: 210 };

test('formalı 297×210 / 148×210: iki yuva ortada bitişik, sırt ortada', () => {
  const r = y.yerlesim(d.formali({ sayfaSayisi: 16 }), AYAR);
  assert.equal(r.yuzler.length, 8);
  const on = r.yuzler[0];
  assert.equal(on.yuz, 'on');
  assert.deepEqual(on.yuvalar.map((v) => v.sayfa), [16, 1]);
  assert.equal(on.yuvalar[0].yuva.x, 0.5);
  assert.equal(on.yuvalar[1].yuva.x, 148.5);
  assert.equal(on.yuvalar[0].sirtTaraf, 'sag');
  assert.equal(on.yuvalar[1].sirtTaraf, 'sol');
  assert.deepEqual(r.uyarilar, []);
});

test('cilt payı sırt tarafına, dış kenar diğer tarafa; kayma sırta doğru', () => {
  const diz = d.formali({ sayfaSayisi: 16, kaymaAcik: true, kagitKalinlik: 0.1 });
  const r = y.yerlesim(diz, Object.assign({}, AYAR, { disKenar: 5, ciltPayi: 10 }));
  const yaprak3on = r.yuzler.find((f) => f.yaprak === 3 && f.yuz === 'on');
  const [sol, sag] = yaprak3on.yuvalar;
  // sol yuva: sırt sağda → içerik x = yuva.x + dis + kayma(0.3)
  assert.equal(sol.icerik.x, 0.5 + 5 + 0.3);
  assert.equal(sol.icerik.w, 133);
  // sağ yuva: sırt solda → içerik x = yuva.x + cilt − kayma
  assert.equal(sag.icerik.x, 148.5 + 10 - 0.3);
  assert.equal(sol.icerik.y, 5);
  assert.equal(sol.icerik.h, 200);
});

test('çevirme: yatay kağıtta uzun kenar → arka yüzler 180° döner, kısa kenar → düz', () => {
  const diz = d.formali({ sayfaSayisi: 16 });
  const r = y.yerlesim(diz, Object.assign({}, AYAR, { cevirme: 'uzun', disKenar: 5, ciltPayi: 10 }));
  const on = r.yuzler[0], arka = r.yuzler[1];
  assert.equal(on.dondur180, false, 'ön yüz hiç dönmez');
  assert.equal(arka.dondur180, true);
  // arka [2,15]: 2 normalde solda (x=0.5); döndükten sonra sağda
  assert.equal(arka.yuvalar[0].sayfa, 2);
  assert.equal(arka.yuvalar[0].yuva.x, 148.5);
  const kisa = y.yerlesim(diz, Object.assign({}, AYAR, { cevirme: 'kisa' }));
  assert.equal(kisa.yuzler[1].dondur180, false);
  assert.equal(kisa.yuzler[1].yuvalar[0].yuva.x, 0.5);
});

test('arkaDondurulsunMu: kağıt yönüne göre (dikey kağıtta kısa kenar döner)', () => {
  assert.equal(y.arkaDondurulsunMu('kisa', 297, 210), false);
  assert.equal(y.arkaDondurulsunMu('uzun', 297, 210), true);
  assert.equal(y.arkaDondurulsunMu('kisa', 210, 297), true);
  assert.equal(y.arkaDondurulsunMu('uzun', 210, 297), false);
  assert.equal(y.arkaDondurulsunMu('kisa', 200, 200), true, 'kare kağıt dikey sayılır');
});

test('forma sırt işareti: her formanın dış yaprağının ön yüzünde, basamaklı', () => {
  const r = y.yerlesim(d.formali({ sayfaSayisi: 48 }), AYAR);
  const kareler = r.yuzler.filter((f) => f.kareler.length).map((f) => ({ forma: f.forma, yuz: f.yuz, ic: f.formaIci, k: f.kareler[0] }));
  assert.equal(kareler.length, 3);
  kareler.forEach((k) => { assert.equal(k.yuz, 'on'); assert.equal(k.ic, 0); assert.equal(k.k.x, 148.5 - 1.5); });
  assert.ok(kareler[0].k.y > kareler[1].k.y && kareler[1].k.y > kareler[2].k.y, 'basamak aşağı iner');
  const kapali = y.yerlesim(d.formali({ sayfaSayisi: 48 }), Object.assign({}, AYAR, { sirtIsareti: false }));
  assert.equal(kapali.yuzler.filter((f) => f.kareler.length).length, 0);
});

test('sığmayan ölçü uyarı verir; geçersiz ölçü hata', () => {
  const r = y.yerlesim(d.formali({ sayfaSayisi: 4 }), { kagitGen: 210, kagitYuk: 297, kitapGen: 148, kitapYuk: 210 });
  assert.equal(r.uyarilar.length, 1);
  assert.throws(() => y.yerlesim(d.formali({ sayfaSayisi: 4 }), { kagitGen: 0, kagitYuk: 210, kitapGen: 148, kitapYuk: 210 }), RangeError);
});

test('tek2: yuvaların sırt tarafı sayfa tek/çiftliğine göre', () => {
  const r = y.yerlesim(d.tek2({ sayfaSayisi: 8 }), AYAR);
  assert.deepEqual(r.yuzler[0].yuvalar.map((v) => v.sirtTaraf), ['sol', 'sol']); // 1, 5
  assert.deepEqual(r.yuzler[1].yuvalar.map((v) => v.sirtTaraf), ['sag', 'sag']); // 6, 2
});

test('sayfaYerlestir: sığdır / gerçek / doldur ve 90° döndürme', () => {
  const kutu = { x: 0, y: 0, w: 100, h: 200 };
  const s = y.sayfaYerlestir(kutu, 50, 50, 0, 'sigdir');
  assert.equal(s.s, 2); assert.equal(s.gen, 100); assert.equal(s.merkezY, 100);
  const g = y.sayfaYerlestir(kutu, 50, 50, 0, 'gercek');
  assert.equal(g.s, 1);
  const dl = y.sayfaYerlestir(kutu, 50, 50, 0, 'doldur');
  assert.equal(dl.s, 4);
  const r90 = y.sayfaYerlestir(kutu, 200, 100, 90, 'sigdir');
  assert.equal(r90.s, 1); assert.equal(r90.gen, 100); assert.equal(r90.yuk, 200);
});

test('cizimKokeni: döndürülmüş kutunun merkezi istenen noktaya gelir', () => {
  for (const aci of [0, 90, 180, 270, -90]) {
    const w = 40, h = 10, mx = 100, my = 50;
    const k = y.cizimKokeni(mx, my, w, h, aci);
    const r = aci * Math.PI / 180;
    const cx = k.x + (w / 2) * Math.cos(r) - (h / 2) * Math.sin(r);
    const cy = k.y + (w / 2) * Math.sin(r) + (h / 2) * Math.cos(r);
    assert.ok(Math.abs(cx - mx) < 1e-6 && Math.abs(cy - my) < 1e-6, 'açı ' + aci);
  }
});

// ---- D6: 180° arka dönüş (kısa/uzun kenar × yatay/dikey) ----
test('arkaDondurulsunMu: yatay/dikey × kısa/uzun kenar dört birleşim', () => {
  assert.equal(y.arkaDondurulsunMu('kisa', 297, 210), false); // yatay + kısa: dönüş yok
  assert.equal(y.arkaDondurulsunMu('uzun', 297, 210), true);  // yatay + uzun: 180°
  assert.equal(y.arkaDondurulsunMu('kisa', 210, 297), true);  // dikey + kısa: 180°
  assert.equal(y.arkaDondurulsunMu('uzun', 210, 297), false); // dikey + uzun: dönüş yok
  assert.equal(y.arkaDondurulsunMu('kisa', 210, 210), true);  // kare dikey sayılır
});

test('yerlesim: yalnız arka yüzler döner, ön yüzler dönmez (dört birleşim)', () => {
  const diz = d.formali({ sayfaSayisi: 4, formaYaprak: 1 });
  [[297, 210, 148, 210, 'kisa', false], [297, 210, 148, 210, 'uzun', true],
    [210, 297, 100, 150, 'kisa', true], [210, 297, 100, 150, 'uzun', false]].forEach(([pg, py, bg, by, cev, beklenen]) => {
    const r = y.yerlesim(diz, { kagitGen: pg, kagitYuk: py, kitapGen: bg, kitapYuk: by, cevirme: cev });
    assert.equal(r.yuzler.find((f) => f.yuz === 'on').dondur180, false, cev);
    assert.equal(r.yuzler.find((f) => f.yuz === 'arka').dondur180, beklenen, pg + 'x' + py + ' ' + cev);
  });
});

test('180° dönen arka yüzde sayfa yuvaları kağıt merkezine göre yansır', () => {
  const diz = d.formali({ sayfaSayisi: 4, formaYaprak: 1 });
  const ayar = { kagitGen: 297, kagitYuk: 210, kitapGen: 148, kitapYuk: 210, cevirme: 'uzun', disKenar: 3, ciltPayi: 5 };
  const r = y.yerlesim(diz, ayar);
  const arka = r.yuzler.find((f) => f.yuz === 'arka');
  const duz = y.yerlesim(diz, Object.assign({}, ayar, { cevirme: 'kisa' })).yuzler.find((f) => f.yuz === 'arka');
  duz.yuvalar.forEach((yv, i) => {
    const k = duz.yuvalar[i].icerik, q = arka.yuvalar[i].icerik;
    assert.ok(Math.abs(q.x - (297 - k.x - k.w)) < 1e-6 && Math.abs(q.y - (210 - k.y - k.h)) < 1e-6);
  });
});

// ---- D7 / D8 ----
test('kağıda sığmayan yerleşim: sigmiyor işareti ve açık uyarı', () => {
  const diz = d.formali({ sayfaSayisi: 16 });
  const r = y.yerlesim(diz, { kagitGen: 200, kagitYuk: 210, kitapGen: 148, kitapYuk: 210 });
  assert.equal(r.sigmiyor, true);
  assert.match(r.uyarilar[0], /sığmıyor/);
  assert.equal(y.yerlesim(diz, AYAR).sigmiyor, false);
});

test('negatif dış kenar / cilt payı sessizce 0 yapılmaz, reddedilir', () => {
  const diz = d.formali({ sayfaSayisi: 16 });
  assert.throws(() => y.yerlesim(diz, Object.assign({}, AYAR, { disKenar: -2 })), /negatif/);
  assert.throws(() => y.yerlesim(diz, Object.assign({}, AYAR, { ciltPayi: -0.5 })), /negatif/);
  assert.doesNotThrow(() => y.yerlesim(diz, Object.assign({}, AYAR, { disKenar: 0, ciltPayi: 0 })));
});

// ---- AR: sırt işareti hep katlama çizgisinde; yeni turda biçim değişir ----
test('sırt işareti: 130 formada (tur, basamak) benzersiz, x merkezi hep ortaX, biçim tura göre değişir', () => {
  const diz = d.formali({ sayfaSayisi: 130 * 16, formaYaprak: 4 });
  const r = y.yerlesim(diz, AYAR);
  const ortaX = r.kagit.gen / 2;
  const formalar = {};
  r.yuzler.forEach((f) => { f.kareler.forEach((k) => { formalar[f.forma] = k; }); });
  assert.equal(Object.keys(formalar).length, 130);
  const cift = new Set();
  Object.values(formalar).forEach((k) => {
    assert.ok(Math.abs(k.x + k.w / 2 - ortaX) < 1e-9, 'işaret merkezi ortaX: ' + k.x);
    cift.add(k.tur + ',' + k.basamak);
    assert.ok(k.x >= 0 && k.x + k.w <= 297 && k.y >= 0 && k.y + k.h <= 210);
    // parçalar da merkezde (yatay ortalı) ve işaret kutusunda
    const p = y.isaretParcalari(k);
    const minX = Math.min(...p.map((q) => q.x)), maxX = Math.max(...p.map((q) => q.x + q.w));
    assert.ok(Math.abs((minX + maxX) / 2 - ortaX) < 1e-9, 'parçalar ortalı');
  });
  assert.equal(cift.size, 130, '(tur, basamak) çiftleri benzersiz');
  assert.ok(Object.values(formalar).some((k) => k.tur >= 3), 'en az 4 tur');
  // aynı basamaktaki ardışık turların biçimi farklı (40. forma ile 0. forma ayırt edilir)
  const parcaSayisi = (k) => y.isaretParcalari(k).length;
  assert.notEqual(`${formalar[40].stil}`, `${formalar[0].stil}`);
  assert.notEqual(parcaSayisi(formalar[80]), parcaSayisi(formalar[0]));
  assert.equal(y.isaretParcalari(formalar[0]).length, 1);
});
