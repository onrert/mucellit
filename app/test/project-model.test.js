'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../js/project-model.js');

test('şablonlar: formalı 14 adım (sırt yuvarlatma isteğe bağlı), tek yaprak 7 adım', () => {
  const f = m.newProject({ name: 'A', bindingType: 'sewn' });
  assert.equal(f.steps.length, 14);
  assert.equal(f.steps.find((a) => a.name === 'Sırt yuvarlatma').optional, true);
  const t = m.newProject({ name: 'B', bindingType: 'single' });
  assert.deepEqual(t.steps.map((a) => a.name), ['Hazırlık', 'Baskı', 'Kesim', 'Sırt hazırlama (tırtıklama)', 'Tutkallama', 'Kapak', 'Preste kurutma']);
});

test('adım işaretle (tarih otomatik), ekle, sil, taşı, ilerleme', () => {
  const k = m.newProject({ name: 'C', bindingType: 'single' });
  m.markStep(k, k.steps[0].id, true, '2026-10-11');
  assert.equal(k.steps[0].done, true);
  assert.equal(k.steps[0].date, '2026-10-11');
  const fresh = m.addStep(k, 'Ayraç takma', 1);
  assert.equal(k.steps[1].id, fresh.id);
  m.moveStep(k, fresh.id, 1);
  assert.equal(k.steps[2].id, fresh.id);
  m.removeStep(k, fresh.id);
  assert.equal(k.steps.length, 7);
  assert.deepEqual(m.progress(k), { done: 1, total: 7, ratio: 1 / 7 });
  assert.throws(() => m.addStep(k, '   '));
  assert.throws(() => m.newProject({ name: '' }));
});

test('dogrula: geçerli yedeği kabul, kusurlu yedekleri reddeder', () => {
  const data = m.emptyData();
  data.projects.push(m.newProject({ name: 'D' }));
  assert.ok(m.validate(JSON.parse(JSON.stringify(data))));
  assert.ok(m.validate(m.emptyData()));
  const bad = [
    null, [], {}, { version: 3, projects: [] }, { version: 1, projects: [] }, { version: 2 }, { version: 2, projects: [null] },
    { version: 2, projects: [{ id: 'x', name: '', bindingType: 'single', steps: [] }] },
    { version: 2, projects: [{ id: 'x', name: 'a', bindingType: 'none', steps: [] }] },
    { version: 2, projects: [{ id: 'x', name: 'a', bindingType: 'single' }] },
    { version: 2, projects: [{ id: 'x', name: 'a', bindingType: 'single', steps: [{ id: 'a', name: 'b', done: 'yes' }] }] },
    { version: 2, projects: [{ id: 'x', name: 'a', bindingType: 'single', steps: [] }, { id: 'x', name: 'b', bindingType: 'single', steps: [] }] }
  ];
  bad.forEach((v, i) => assert.throws(() => m.validate(v), Error, 'faulty backup ' + i + ' reddedilmeli'));
});

// ---- D10: içe aktarma doğrulaması ----
function validData() {
  const v = m.emptyData();
  v.projects.push(m.newProject({ name: 'T', bindingType: 'single' }));
  return v;
}

test('içe aktarma: adım id tekrarı reddedilir (açıklamalı hata)', () => {
  const v = validData();
  v.projects[0].steps[1].id = v.projects[0].steps[0].id;
  assert.throws(() => m.validate(v), /adım id tekrarlanıyor/);
});

test('içe aktarma: not ve tarih metin olmalı', () => {
  const v = validData();
  v.projects[0].steps[0].note = 5;
  assert.throws(() => m.validate(v), /not metin olmalı/);
  const w = validData();
  w.projects[0].steps[0].date = { x: 1 };
  assert.throws(() => m.validate(w), /tarih metin olmalı/);
});

test('içe aktarma: ayar nesne olmalı (dizi/metin/sayı reddedilir; null ve nesne olur)', () => {
  [[], 'x', 5].forEach((bad) => {
    const v = validData();
    v.projects[0].settings = bad;
    assert.throws(() => m.validate(v), /ayar bir nesne olmalı/);
  });
  const ok = validData();
  ok.projects[0].settings = { bindingType: 'sewn' };
  assert.equal(m.validate(ok), true);
  ok.projects[0].settings = null;
  assert.equal(m.validate(ok), true);
});

test('içe aktarma: geçerli yeni kitap (not/tarih boş metin) kabul edilir', () => {
  assert.equal(m.validate(validData()), true);
});
