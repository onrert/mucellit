'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../js/imposition.js');
const y = require('../js/layout.js');

const SETTINGS = { paperWidth: 297, paperHeight: 210, bookWidth: 148, bookHeight: 210 };

test('formalı 297×210 / 148×210: iki yuva ortada bitişik, sırt ortada', () => {
  const r = y.layout(d.sewn({ pageCount: 16 }), SETTINGS);
  assert.equal(r.sides.length, 8);
  const front = r.sides[0];
  assert.equal(front.side, 'front');
  assert.deepEqual(front.slots.map((v) => v.page), [16, 1]);
  assert.equal(front.slots[0].slot.x, 0.5);
  assert.equal(front.slots[1].slot.x, 148.5);
  assert.equal(front.slots[0].spineSide, 'right');
  assert.equal(front.slots[1].spineSide, 'left');
  assert.deepEqual(r.warnings, []);
});

test('cilt payı sırt tarafına, dış kenar diğer tarafa; kayma sırta doğru', () => {
  const impose = d.sewn({ pageCount: 16, creepEnabled: true, paperThickness: 0.1 });
  const r = y.layout(impose, Object.assign({}, SETTINGS, { outerMargin: 5, gutter: 10 }));
  const yaprak3on = r.sides.find((f) => f.sheet === 3 && f.side === 'front');
  const [left, right] = yaprak3on.slots;
  // sol yuva: sırt sağda → içerik x = yuva.x + dis + kayma(0.3)
  assert.equal(left.content.x, 0.5 + 5 + 0.3);
  assert.equal(left.content.w, 133);
  // sağ yuva: sırt solda → içerik x = yuva.x + cilt − kayma
  assert.equal(right.content.x, 148.5 + 10 - 0.3);
  assert.equal(left.content.y, 5);
  assert.equal(left.content.h, 200);
});

test('çevirme: yatay kağıtta uzun kenar → arka yüzler 180° döner, kısa kenar → düz', () => {
  const impose = d.sewn({ pageCount: 16 });
  const r = y.layout(impose, Object.assign({}, SETTINGS, { duplex: 'long', outerMargin: 5, gutter: 10 }));
  const front = r.sides[0], back = r.sides[1];
  assert.equal(front.rotate180, false, 'ön yüz hiç dönmez');
  assert.equal(back.rotate180, true);
  // arka [2,15]: 2 normalde solda (x=0.5); döndükten sonra sağda
  assert.equal(back.slots[0].page, 2);
  assert.equal(back.slots[0].slot.x, 148.5);
  const short = y.layout(impose, Object.assign({}, SETTINGS, { duplex: 'short' }));
  assert.equal(short.sides[1].rotate180, false);
  assert.equal(short.sides[1].slots[0].slot.x, 0.5);
});

test('shouldRotateBacks: kağıt yönüne göre (dikey kağıtta kısa kenar döner)', () => {
  assert.equal(y.shouldRotateBacks('short', 297, 210), false);
  assert.equal(y.shouldRotateBacks('long', 297, 210), true);
  assert.equal(y.shouldRotateBacks('short', 210, 297), true);
  assert.equal(y.shouldRotateBacks('long', 210, 297), false);
  assert.equal(y.shouldRotateBacks('short', 200, 200), true, 'kare kağıt dikey sayılır');
});

test('forma sırt işareti: her formanın dış yaprağının ön yüzünde, basamaklı', () => {
  const r = y.layout(d.sewn({ pageCount: 48 }), SETTINGS);
  const squares = r.sides.filter((f) => f.squares.length).map((f) => ({ signature: f.signature, side: f.side, inner: f.indexInSignature, k: f.squares[0] }));
  assert.equal(squares.length, 3);
  squares.forEach((k) => { assert.equal(k.side, 'front'); assert.equal(k.inner, 0); assert.equal(k.k.x, 148.5 - 1.5); });
  assert.ok(squares[0].k.y > squares[1].k.y && squares[1].k.y > squares[2].k.y, 'basamak aşağı iner');
  const closed = y.layout(d.sewn({ pageCount: 48 }), Object.assign({}, SETTINGS, { spineMarks: false }));
  assert.equal(closed.sides.filter((f) => f.squares.length).length, 0);
});

test('sığmayan ölçü uyarı verir; geçersiz ölçü hata', () => {
  const r = y.layout(d.sewn({ pageCount: 4 }), { paperWidth: 210, paperHeight: 297, bookWidth: 148, bookHeight: 210 });
  assert.equal(r.warnings.length, 1);
  assert.throws(() => y.layout(d.sewn({ pageCount: 4 }), { paperWidth: 0, paperHeight: 210, bookWidth: 148, bookHeight: 210 }), RangeError);
});

test('tek2: yuvaların sırt tarafı sayfa tek/çiftliğine göre', () => {
  const r = y.layout(d.single2({ pageCount: 8 }), SETTINGS);
  assert.deepEqual(r.sides[0].slots.map((v) => v.spineSide), ['left', 'left']); // 1, 5
  assert.deepEqual(r.sides[1].slots.map((v) => v.spineSide), ['right', 'right']); // 6, 2
});

test('fitPage: sığdır / gerçek / doldur ve 90° döndürme', () => {
  const box = { x: 0, y: 0, w: 100, h: 200 };
  const s = y.fitPage(box, 50, 50, 0, 'fit');
  assert.equal(s.s, 2); assert.equal(s.width, 100); assert.equal(s.centerY, 100);
  const g = y.fitPage(box, 50, 50, 0, 'actual');
  assert.equal(g.s, 1);
  const dl = y.fitPage(box, 50, 50, 0, 'fill');
  assert.equal(dl.s, 4);
  const r90 = y.fitPage(box, 200, 100, 90, 'fit');
  assert.equal(r90.s, 1); assert.equal(r90.width, 100); assert.equal(r90.height, 200);
});

test('drawOrigin: döndürülmüş kutunun merkezi istenen noktaya gelir', () => {
  for (const angle of [0, 90, 180, 270, -90]) {
    const w = 40, h = 10, mx = 100, my = 50;
    const k = y.drawOrigin(mx, my, w, h, angle);
    const r = angle * Math.PI / 180;
    const cx = k.x + (w / 2) * Math.cos(r) - (h / 2) * Math.sin(r);
    const cy = k.y + (w / 2) * Math.sin(r) + (h / 2) * Math.cos(r);
    assert.ok(Math.abs(cx - mx) < 1e-6 && Math.abs(cy - my) < 1e-6, 'açı ' + angle);
  }
});

// ---- D6: 180° arka dönüş (kısa/uzun kenar × yatay/dikey) ----
test('shouldRotateBacks: yatay/dikey × kısa/uzun kenar dört birleşim', () => {
  assert.equal(y.shouldRotateBacks('short', 297, 210), false); // yatay + kısa: dönüş yok
  assert.equal(y.shouldRotateBacks('long', 297, 210), true);  // yatay + uzun: 180°
  assert.equal(y.shouldRotateBacks('short', 210, 297), true);  // dikey + kısa: 180°
  assert.equal(y.shouldRotateBacks('long', 210, 297), false); // dikey + uzun: dönüş yok
  assert.equal(y.shouldRotateBacks('short', 210, 210), true);  // kare dikey sayılır
});

test('yerlesim: yalnız arka yüzler döner, ön yüzler dönmez (dört birleşim)', () => {
  const impose = d.sewn({ pageCount: 4, sheetsPerSignature: 1 });
  [[297, 210, 148, 210, 'short', false], [297, 210, 148, 210, 'long', true],
    [210, 297, 100, 150, 'short', true], [210, 297, 100, 150, 'long', false]].forEach(([pg, py, bg, by, cev, expected]) => {
    const r = y.layout(impose, { paperWidth: pg, paperHeight: py, bookWidth: bg, bookHeight: by, duplex: cev });
    assert.equal(r.sides.find((f) => f.side === 'front').rotate180, false, cev);
    assert.equal(r.sides.find((f) => f.side === 'back').rotate180, expected, pg + 'x' + py + ' ' + cev);
  });
});

test('180° dönen arka yüzde sayfa yuvaları kağıt merkezine göre yansır', () => {
  const impose = d.sewn({ pageCount: 4, sheetsPerSignature: 1 });
  const settings = { paperWidth: 297, paperHeight: 210, bookWidth: 148, bookHeight: 210, duplex: 'long', outerMargin: 3, gutter: 5 };
  const r = y.layout(impose, settings);
  const back = r.sides.find((f) => f.side === 'back');
  const flat = y.layout(impose, Object.assign({}, settings, { duplex: 'short' })).sides.find((f) => f.side === 'back');
  flat.slots.forEach((yv, i) => {
    const k = flat.slots[i].content, q = back.slots[i].content;
    assert.ok(Math.abs(q.x - (297 - k.x - k.w)) < 1e-6 && Math.abs(q.y - (210 - k.y - k.h)) < 1e-6);
  });
});

// ---- D7 / D8 ----
test('kağıda sığmayan yerleşim: sigmiyor işareti ve açık uyarı', () => {
  const impose = d.sewn({ pageCount: 16 });
  const r = y.layout(impose, { paperWidth: 200, paperHeight: 210, bookWidth: 148, bookHeight: 210 });
  assert.equal(r.doesNotFit, true);
  assert.match(r.warnings[0], /sığmıyor/);
  assert.equal(y.layout(impose, SETTINGS).doesNotFit, false);
});

test('negatif dış kenar / cilt payı sessizce 0 yapılmaz, reddedilir', () => {
  const impose = d.sewn({ pageCount: 16 });
  assert.throws(() => y.layout(impose, Object.assign({}, SETTINGS, { outerMargin: -2 })), /negatif/);
  assert.throws(() => y.layout(impose, Object.assign({}, SETTINGS, { gutter: -0.5 })), /negatif/);
  assert.doesNotThrow(() => y.layout(impose, Object.assign({}, SETTINGS, { outerMargin: 0, gutter: 0 })));
});

// ---- AR: sırt işareti hep katlama çizgisinde; yeni turda biçim değişir ----
test('sırt işareti: 130 formada (tur, basamak) benzersiz, x merkezi hep middleX, biçim tura göre değişir', () => {
  const impose = d.sewn({ pageCount: 130 * 16, sheetsPerSignature: 4 });
  const r = y.layout(impose, SETTINGS);
  const middleX = r.paper.width / 2;
  const signatures = {};
  r.sides.forEach((f) => { f.squares.forEach((k) => { signatures[f.signature] = k; }); });
  assert.equal(Object.keys(signatures).length, 130);
  const double = new Set();
  Object.values(signatures).forEach((k) => {
    assert.ok(Math.abs(k.x + k.w / 2 - middleX) < 1e-9, 'işaret merkezi middleX: ' + k.x);
    double.add(k.kind + ',' + k.step);
    assert.ok(k.x >= 0 && k.x + k.w <= 297 && k.y >= 0 && k.y + k.h <= 210);
    // parçalar da merkezde (yatay ortalı) ve işaret kutusunda
    const p = y.markParts(k);
    const minX = Math.min(...p.map((q) => q.x)), maxX = Math.max(...p.map((q) => q.x + q.w));
    assert.ok(Math.abs((minX + maxX) / 2 - middleX) < 1e-9, 'parçalar ortalı');
  });
  assert.equal(double.size, 130, '(tur, basamak) çiftleri benzersiz');
  assert.ok(Object.values(signatures).some((k) => k.kind >= 3), 'en az 4 tur');
  // aynı basamaktaki ardışık turların biçimi farklı (40. forma ile 0. forma ayırt edilir)
  const partCount = (k) => y.markParts(k).length;
  assert.notEqual(`${signatures[40].style}`, `${signatures[0].style}`);
  assert.notEqual(partCount(signatures[80]), partCount(signatures[0]));
  assert.equal(y.markParts(signatures[0]).length, 1);
});
