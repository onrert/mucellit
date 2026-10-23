'use strict';
// storage.js'i sahte localStorage ile (vm bağlamında) sınar: kota dolu / bozuk kayıt davranışı.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setupI18n } = require('./i18n-helper.js');

function setup(storage) {
  const ctx = { localStorage: storage };
  vm.createContext(ctx);
  setupI18n(ctx);
  ['project-model.js', 'storage.js'].forEach((name) => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name), 'utf8'), ctx, { filename: name });
  });
  return ctx.Mucellit;
}

function fakeStorage() {
  const d = { data: {}, filled: false };
  d.getItem = (k) => (k in d.data ? d.data[k] : null);
  d.setItem = (k, v) => { if (d.filled) throw new Error('QuotaExceededError'); d.data[k] = String(v); };
  d.removeItem = (k) => { delete d.data[k]; };
  return d;
}

function names(v) { return Array.from(v.projects, (k) => k.name); }

function withBooksData(MC, name) {
  const v = MC.projectModel.emptyData();
  v.projects.push(MC.projectModel.newProject({ name }));
  return v;
}

test('kota dolunca read() eski kalıcı kaydı değil, bellekteki en yeni veriyi döndürür', () => {
  const d = fakeStorage();
  const MC = setup(d);
  assert.equal(MC.storage.write(withBooksData(MC, 'Eski')), true);
  d.filled = true;
  const fresh = withBooksData(MC, 'Eski');
  fresh.projects.push(MC.projectModel.newProject({ name: 'Yeni' }));
  assert.equal(MC.storage.write(fresh), false);
  assert.equal(MC.storage.isPersistent(), false);
  assert.deepEqual(names(MC.storage.read()), ['Eski', 'Yeni']);
});

test('yazım yeniden başarılı olunca kalıcı moda döner ve read() depoyu okur', () => {
  const d = fakeStorage();
  const MC = setup(d);
  MC.storage.write(withBooksData(MC, 'A'));
  d.filled = true;
  MC.storage.write(withBooksData(MC, 'B'));
  d.filled = false;
  assert.equal(MC.storage.write(withBooksData(MC, 'C')), true);
  assert.equal(MC.storage.isPersistent(), true);
  assert.deepEqual(names(MC.storage.read()), ['C']);
});

test('bozuk kayıt uyarısı başarılı yazımdan sonra kalkar; ham kayıt yedeklenir', () => {
  const d = fakeStorage();
  const MC = setup(d);
  d.data[MC.storage.KEY] = '{corrupt json';
  const v = MC.storage.read();
  assert.equal(v.projects.length, 0);
  assert.equal(MC.storage.isCorrupt(), true);
  assert.equal(d.data[MC.storage.KEY + '.corrupt'], '{corrupt json');
  assert.equal(MC.storage.write(withBooksData(MC, 'X')), true);
  assert.equal(MC.storage.isCorrupt(), false);
});

test('saklama hiç yoksa (getItem atar) bellekten sürer', () => {
  const MC = setup({ getItem() { throw new Error('none'); }, setItem() { throw new Error('none'); }, removeItem() {} });
  assert.equal(MC.storage.write(withBooksData(MC, 'B')), false);
  assert.deepEqual(names(MC.storage.read()), ['B']);
});

test('temizle sonrası read() silinmiş/eski kaydı döndürmez (removeItem başarısız olsa da)', () => {
  const d = fakeStorage();
  const MC = setup(d);
  assert.equal(MC.storage.write(withBooksData(MC, 'A')), true);
  d.removeItem = () => { throw new Error('deleteFailed'); };
  MC.storage.clear();
  assert.equal(MC.storage.read().projects.length, 0, 'removeItem atsa da eski kayıt dönmez');
  // normal yol
  const d2 = fakeStorage();
  const KC2 = setup(d2);
  KC2.storage.write(withBooksData(KC2, 'B'));
  KC2.storage.clear();
  assert.equal(KC2.storage.read().projects.length, 0);
  // kota doluyken (bellek en yeni) temizle: eski kalıcı kayıt geri gelmez
  const d3 = fakeStorage();
  const KC3 = setup(d3);
  KC3.storage.write(withBooksData(KC3, 'A'));
  d3.filled = true;
  KC3.storage.write(withBooksData(KC3, 'B'));
  d3.removeItem = () => { throw new Error('deleteFailed'); };
  KC3.storage.clear();
  assert.equal(KC3.storage.read().projects.length, 0);
});
