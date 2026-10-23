'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../js/imposition.js');
const y = require('../js/layout.js');

const SETTINGS = { paperWidth: 297, paperHeight: 210, bookWidth: 148, bookHeight: 210 };

test('sewn 297×210 / 148×210: two slots side by side in the middle, the spine in the middle', () => {
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

test('gutter on the spine side, outer margin on the other side; creep towards the spine', () => {
  const impose = d.sewn({ pageCount: 16, creepEnabled: true, paperThickness: 0.1 });
  const r = y.layout(impose, Object.assign({}, SETTINGS, { outerMargin: 5, gutter: 10 }));
  const sheet3front = r.sides.find((f) => f.sheet === 3 && f.side === 'front');
  const [left, right] = sheet3front.slots;
  // left slot: spine on the right → content x = slot.x + outer + creep(0.3)
  assert.equal(left.content.x, 0.5 + 5 + 0.3);
  assert.equal(left.content.w, 133);
  // right slot: spine on the left → content x = slot.x + gutter − creep
  assert.equal(right.content.x, 148.5 + 10 - 0.3);
  assert.equal(left.content.y, 5);
  assert.equal(left.content.h, 200);
});

test('duplex: on landscape paper long edge → the backs turn 180°, short edge → straight', () => {
  const impose = d.sewn({ pageCount: 16 });
  const r = y.layout(impose, Object.assign({}, SETTINGS, { duplex: 'long', outerMargin: 5, gutter: 10 }));
  const front = r.sides[0], back = r.sides[1];
  assert.equal(front.rotate180, false, 'the front never turns');
  assert.equal(back.rotate180, true);
  // back [2,15]: 2 is normally on the left (x=0.5); on the right after turning
  assert.equal(back.slots[0].page, 2);
  assert.equal(back.slots[0].slot.x, 148.5);
  const short = y.layout(impose, Object.assign({}, SETTINGS, { duplex: 'short' }));
  assert.equal(short.sides[1].rotate180, false);
  assert.equal(short.sides[1].slots[0].slot.x, 0.5);
});

test('shouldRotateBacks: by paper orientation (on portrait paper the short edge turns)', () => {
  assert.equal(y.shouldRotateBacks('short', 297, 210), false);
  assert.equal(y.shouldRotateBacks('long', 297, 210), true);
  assert.equal(y.shouldRotateBacks('short', 210, 297), true);
  assert.equal(y.shouldRotateBacks('long', 210, 297), false);
  assert.equal(y.shouldRotateBacks('short', 200, 200), true, 'square paper counts as portrait');
});

test('signature spine mark: on the front of the outer sheet of every signature, stepped', () => {
  const r = y.layout(d.sewn({ pageCount: 48 }), SETTINGS);
  const squares = r.sides.filter((f) => f.squares.length).map((f) => ({ signature: f.signature, side: f.side, inner: f.indexInSignature, k: f.squares[0] }));
  assert.equal(squares.length, 3);
  squares.forEach((k) => { assert.equal(k.side, 'front'); assert.equal(k.inner, 0); assert.equal(k.k.x, 148.5 - 1.5); });
  assert.ok(squares[0].k.y > squares[1].k.y && squares[1].k.y > squares[2].k.y, 'the step goes down');
  const closed = y.layout(d.sewn({ pageCount: 48 }), Object.assign({}, SETTINGS, { spineMarks: false }));
  assert.equal(closed.sides.filter((f) => f.squares.length).length, 0);
});

test('a size that does not fit gives a warning; an invalid size is an error', () => {
  const r = y.layout(d.sewn({ pageCount: 4 }), { paperWidth: 210, paperHeight: 297, bookWidth: 148, bookHeight: 210 });
  assert.equal(r.warnings.length, 1);
  assert.throws(() => y.layout(d.sewn({ pageCount: 4 }), { paperWidth: 0, paperHeight: 210, bookWidth: 148, bookHeight: 210 }), RangeError);
});

test('single2: the spine side of the slots by odd/even page', () => {
  const r = y.layout(d.single2({ pageCount: 8 }), SETTINGS);
  assert.deepEqual(r.sides[0].slots.map((v) => v.spineSide), ['left', 'left']); // 1, 5
  assert.deepEqual(r.sides[1].slots.map((v) => v.spineSide), ['right', 'right']); // 6, 2
});

test('fitPage: fit / actual / fill and 90° rotation', () => {
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

test('drawOrigin: the centre of the rotated box comes to the requested point', () => {
  for (const angle of [0, 90, 180, 270, -90]) {
    const w = 40, h = 10, mx = 100, my = 50;
    const k = y.drawOrigin(mx, my, w, h, angle);
    const r = angle * Math.PI / 180;
    const cx = k.x + (w / 2) * Math.cos(r) - (h / 2) * Math.sin(r);
    const cy = k.y + (w / 2) * Math.sin(r) + (h / 2) * Math.cos(r);
    assert.ok(Math.abs(cx - mx) < 1e-6 && Math.abs(cy - my) < 1e-6, 'angle ' + angle);
  }
});

// ---- D6: 180° back rotation (short/long edge × landscape/portrait) ----
test('shouldRotateBacks: landscape/portrait × short/long edge, four combinations', () => {
  assert.equal(y.shouldRotateBacks('short', 297, 210), false); // landscape + short: no rotation
  assert.equal(y.shouldRotateBacks('long', 297, 210), true);  // landscape + long: 180°
  assert.equal(y.shouldRotateBacks('short', 210, 297), true);  // portrait + short: 180°
  assert.equal(y.shouldRotateBacks('long', 210, 297), false); // portrait + long: no rotation
  assert.equal(y.shouldRotateBacks('short', 210, 210), true);  // square counts as portrait
});

test('layout: only the backs turn, the fronts do not (four combinations)', () => {
  const impose = d.sewn({ pageCount: 4, sheetsPerSignature: 1 });
  [[297, 210, 148, 210, 'short', false], [297, 210, 148, 210, 'long', true],
    [210, 297, 100, 150, 'short', true], [210, 297, 100, 150, 'long', false]].forEach(([pg, py, bg, by, flipEdge, expected]) => {
    const r = y.layout(impose, { paperWidth: pg, paperHeight: py, bookWidth: bg, bookHeight: by, duplex: flipEdge });
    assert.equal(r.sides.find((f) => f.side === 'front').rotate180, false, flipEdge);
    assert.equal(r.sides.find((f) => f.side === 'back').rotate180, expected, pg + 'x' + py + ' ' + flipEdge);
  });
});

test('on a back turned 180° the page slots are mirrored around the paper centre', () => {
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
test('a layout that does not fit the paper: the doesNotFit flag and a clear warning', () => {
  const impose = d.sewn({ pageCount: 16 });
  const r = y.layout(impose, { paperWidth: 200, paperHeight: 210, bookWidth: 148, bookHeight: 210 });
  assert.equal(r.doesNotFit, true);
  assert.match(r.warnings[0], /sığmıyor/);  // turkish-ok: expected Turkish UI text
  assert.equal(y.layout(impose, SETTINGS).doesNotFit, false);
});

test('a negative outer margin / gutter is not silently made 0, it is rejected', () => {
  const impose = d.sewn({ pageCount: 16 });
  assert.throws(() => y.layout(impose, Object.assign({}, SETTINGS, { outerMargin: -2 })), /negatif/);  // turkish-ok: expected Turkish UI text
  assert.throws(() => y.layout(impose, Object.assign({}, SETTINGS, { gutter: -0.5 })), /negatif/);  // turkish-ok: expected Turkish UI text
  assert.doesNotThrow(() => y.layout(impose, Object.assign({}, SETTINGS, { outerMargin: 0, gutter: 0 })));
});

// ---- AR: the spine mark is always on the fold line; the style changes in a new round ----
test('spine mark: on 130 signatures (round, step) unique, x centre always middleX, style changes by round', () => {
  const impose = d.sewn({ pageCount: 130 * 16, sheetsPerSignature: 4 });
  const r = y.layout(impose, SETTINGS);
  const middleX = r.paper.width / 2;
  const signatures = {};
  r.sides.forEach((f) => { f.squares.forEach((k) => { signatures[f.signature] = k; }); });
  assert.equal(Object.keys(signatures).length, 130);
  const double = new Set();
  Object.values(signatures).forEach((k) => {
    assert.ok(Math.abs(k.x + k.w / 2 - middleX) < 1e-9, 'mark centre middleX: ' + k.x);
    double.add(k.kind + ',' + k.step);
    assert.ok(k.x >= 0 && k.x + k.w <= 297 && k.y >= 0 && k.y + k.h <= 210);
    // the parts are in the centre too (horizontally centred) and inside the mark box
    const p = y.markParts(k);
    const minX = Math.min(...p.map((q) => q.x)), maxX = Math.max(...p.map((q) => q.x + q.w));
    assert.ok(Math.abs((minX + maxX) / 2 - middleX) < 1e-9, 'parts centred');
  });
  assert.equal(double.size, 130, '(round, step) pairs unique');
  assert.ok(Object.values(signatures).some((k) => k.kind >= 3), 'at least 4 rounds');
  // consecutive rounds on the same step have different styles (signature 40 is told apart from signature 0)
  const partCount = (k) => y.markParts(k).length;
  assert.notEqual(`${signatures[40].style}`, `${signatures[0].style}`);
  assert.notEqual(partCount(signatures[80]), partCount(signatures[0]));
  assert.equal(y.markParts(signatures[0]).length, 1);
});
