'use strict';
// Tests storage.js with a fake localStorage (in a vm context): full quota / corrupt record behaviour.
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

test('when the quota is full read() returns the newest data in memory, not the old persistent record', () => {
  const d = fakeStorage();
  const MC = setup(d);
  assert.equal(MC.storage.write(withBooksData(MC, 'Old')), true);
  d.filled = true;
  const fresh = withBooksData(MC, 'Old');
  fresh.projects.push(MC.projectModel.newProject({ name: 'New' }));
  assert.equal(MC.storage.write(fresh), false);
  assert.equal(MC.storage.isPersistent(), false);
  assert.deepEqual(names(MC.storage.read()), ['Old', 'New']);
});

test('when a write succeeds again it goes back to persistent mode and read() reads the storage', () => {
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

test('the corrupt record warning goes away after a successful write; the raw record is backed up', () => {
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

test('without any storage (getItem throws) it goes on in memory', () => {
  const MC = setup({ getItem() { throw new Error('none'); }, setItem() { throw new Error('none'); }, removeItem() {} });
  assert.equal(MC.storage.write(withBooksData(MC, 'B')), false);
  assert.deepEqual(names(MC.storage.read()), ['B']);
});

test('after clear read() does not return the removed/old record (even when removeItem fails)', () => {
  const d = fakeStorage();
  const MC = setup(d);
  assert.equal(MC.storage.write(withBooksData(MC, 'A')), true);
  d.removeItem = () => { throw new Error('deleteFailed'); };
  MC.storage.clear();
  assert.equal(MC.storage.read().projects.length, 0, 'removeItem throws and still no old record comes back');
  // normal path
  const d2 = fakeStorage();
  const MC2 = setup(d2);
  MC2.storage.write(withBooksData(MC2, 'B'));
  MC2.storage.clear();
  assert.equal(MC2.storage.read().projects.length, 0);
  // clear while the quota is full (memory is newest): the old persistent record does not come back
  const d3 = fakeStorage();
  const MC3 = setup(d3);
  MC3.storage.write(withBooksData(MC3, 'A'));
  d3.filled = true;
  MC3.storage.write(withBooksData(MC3, 'B'));
  d3.removeItem = () => { throw new Error('deleteFailed'); };
  MC3.storage.clear();
  assert.equal(MC3.storage.read().projects.length, 0);
});
