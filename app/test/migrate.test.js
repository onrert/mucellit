'use strict';
/*
 * migrate.test.js — one-time migration of data saved by versions before the English code base (app/js/migrate.js,
 * the language choice in i18n.js, the Mac app restore in platform-tauri.js).
 * Fixtures: app/test/fixtures/legacy/ (real records in the old format: Turkish field names, no template keys).
 * Every check is also run on faulty input (empty, skeleton, copy, partly broken) and must report a failure there.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Migrate = require('../js/migrate.js');
const Model = require('../js/project-model.js');

const LEGACY = path.join(__dirname, 'fixtures', 'legacy');
const JS = path.join(__dirname, '..', 'js');
const I18N = path.join(__dirname, '..', 'i18n');
const read = (p) => fs.readFileSync(p, 'utf8');
const legacyLocal = read(path.join(LEGACY, 'local-storage-v1.json'));
const legacyBackup = read(path.join(LEGACY, 'projects-v1.json'));

// legacy-names: begin (old storage keys and field names used as test input)
const OLD = {
  projects: 'kitapCilt.v1', corrupt: 'kitapCilt.v1.bozuk', language: 'kitapCilt.dil', tab: 'kitapCilt.sekme',
  imposeSettings: 'kitapCilt.duzenleAyar', selectedProject: 'kitapCilt.seciliKitap', epubSettings: 'kitapCilt.epubAyar',
  learnPosition: 'kitapCilt.ogren.konum'
};
const OLD_IMPOSE = {
  ciltTuru: 'tek2', formaYaprak: 5, sonFormaKucult: true, kayma: true, kagitKalinlik: 0.12, kagitGen: 420, kagitYuk: 297,
  kitapGen: 140, kitapYuk: 200, olcek: 'doldur', disKenar: 3, ciltPayi: 4, kirim: false, katlama: false, sirtIsareti: true,
  cevirme: 'uzun', ciktiModu: 'ikili', arkaTers: true
};
/** Enum values that the migration converts on purpose (legacy → current). */
const CONVERTED = { formali: 'sewn', tek: 'single', tek1: 'single1', tek2: 'single2', sigdir: 'fit', gercek: 'actual', doldur: 'fill',
  kisa: 'short', uzun: 'long', ikili: 'pair', dikis: 'sewing' };
const OLD_EPUB = { boy: 11, satirAraligi: 1.4, ust: 16, alt: 19, yan: 14, tireBol: false, sayfaNo: false, kapakAtla: false };
// legacy-names: end
const NEW_IMPOSE = {
  bindingType: 'single2', sheetsPerSignature: 5, shrinkLastSignature: true, creep: true, paperThickness: 0.12, paperWidth: 420,
  paperHeight: 297, bookWidth: 140, bookHeight: 200, scaling: 'fill', outerMargin: 3, gutter: 4, cropMarks: false, folding: false,
  spineMarks: true, duplex: 'long', outputMode: 'pair', backsReversed: true
};
const NEW_EPUB = { fontSize: 11, lineSpacing: 1.4, top: 16, bottom: 19, side: 14, hyphenate: false, pageNumbers: false, skipCover: false };

/** Every leaf value of the legacy data (numbers, strings, booleans) must still be in the migrated data. Returns the lost ones. */
function lostValues(legacy, migrated) {
  const leaves = (x, out) => {
    if (x && typeof x === 'object') Object.keys(x).forEach((k) => leaves(x[k], out));
    else out.push(JSON.stringify(x));
    return out;
  };
  const have = leaves(migrated, []);
  const missing = [];
  for (const v0 of leaves(legacy, [])) {
    const s = /^"(.*)"$/.exec(v0);
    const v = s && Object.prototype.hasOwnProperty.call(CONVERTED, s[1]) ? JSON.stringify(CONVERTED[s[1]]) : v0;
    const i = have.indexOf(v);
    if (i < 0) missing.push(v); else have.splice(i, 1);
  }
  return missing.filter((v) => v !== '1'); // the legacy version number 1 becomes 2 on purpose
}

/** A Storage stand-in (Map); setItem can be made to fail (quota) for one key. */
function fakeStorage(entries, { failOn } = {}) {
  const m = new Map(Object.entries(entries || {}));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (k === failOn) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }
  };
}

test('migrate: legacy project records (both fixtures) become version 2 with English fields; nothing is lost; idempotent', () => {
  for (const [name, raw] of [['local-storage-v1.json', legacyLocal], ['projects-v1.json', legacyBackup]]) {
    const legacy = JSON.parse(raw);
    assert.ok(Migrate.isLegacyProjects(legacy), name);
    const d = Migrate.projects(legacy);
    assert.equal(Model.validate(d), true, name);
    assert.equal(d.version, 2);
    assert.ok(!Migrate.isLegacyProjects(d));
    const k = d.projects[0];
    assert.equal(k.bindingType, 'sewn');
    for (const f of ['id', 'name', 'bookWidth', 'bookHeight', 'paper', 'paperThickness', 'pdfName', 'created', 'steps']) assert.ok(f in k, `${name}: ${f}`);
    for (const a of k.steps) for (const f of ['id', 'name', 'done', 'date', 'note', 'optional']) assert.ok(f in a, `${name}: step ${f}`);
    assert.deepEqual(lostValues(legacy, d), [], `${name}: no value lost`);
    assert.deepEqual(Migrate.projects(d), d, `${name}: idempotent`);
    assert.deepEqual(JSON.parse(raw), legacy, `${name}: input not modified`);
  }
});

test('migrate: project settings, template keys and unknown fields are converted or kept', () => {
  // legacy-names: begin
  const legacy = { surum: 1, extra: 'x', kitaplar: [{ id: 'k1', ad: 'A', ciltTuru: 'tek', yeniAlan: 7, ayar: OLD_IMPOSE,
    adimlar: [{ id: 'a1', ad: 'Dikiş', tamam: true, tarih: '2026-01-02', not: 'n', istegeBagli: false, sablon: 'dikis' },
      { id: 'a2', ad: 'Bilinmeyen', tamam: false, sablon: 'kendi_sablonum' }] }] };
  // legacy-names: end
  const d = Migrate.projects(legacy);
  assert.equal(d.extra, 'x');
  const k = d.projects[0];
  assert.equal(k.bindingType, 'single');
  assert.equal(k.yeniAlan, 7, 'unknown project field kept'); // turkish-ok: legacy format names (migration test)
  assert.deepEqual(k.settings, NEW_IMPOSE);
  assert.deepEqual(k.steps[0], { id: 'a1', name: 'Dikiş', done: true, date: '2026-01-02', note: 'n', optional: false, template: 'sewing' });  // turkish-ok: legacy format names (migration test)
  assert.equal(k.steps[1].template, 'kendi_sablonum', 'unknown template kept'); // turkish-ok: legacy format names (migration test)
  assert.equal(Model.validate(d), true);
});

test('migrate faulty input: non-objects, other versions and broken lists are left for validation to report', () => {
  for (const x of [null, undefined, 5, 'x', [], {}, { version: 2, projects: [] }]) assert.deepEqual(Migrate.projects(x), x, String(JSON.stringify(x)));
  // legacy-names: begin
  assert.equal(Migrate.projects({ surum: 3, kitaplar: [] }).version, 3, 'unknown legacy version kept');
  assert.throws(() => Model.validate(Migrate.projects({ surum: 3, kitaplar: [] })));
  assert.throws(() => Model.validate(Migrate.projects({ surum: 1, kitaplar: 'x' })));
  assert.throws(() => Model.validate(Migrate.projects({ surum: 1, kitaplar: [null] })));
  assert.throws(() => Model.validate(Migrate.projects({ surum: 1 })));
  assert.deepEqual(Migrate.imposeSettings({ ciltTuru: 'baska' }), { bindingType: 'baska' }, 'unknown value kept'); // turkish-ok: legacy format names (migration test)
  // legacy-names: end
  for (const x of [null, 3, 'a', []]) assert.deepEqual(Migrate.imposeSettings(x), x);
  assert.deepEqual(Migrate.imposeSettings(OLD_IMPOSE), NEW_IMPOSE);
  assert.deepEqual(Migrate.imposeSettings(NEW_IMPOSE), NEW_IMPOSE, 'current settings unchanged');
  assert.deepEqual(Migrate.epubSettings(OLD_EPUB), NEW_EPUB);
  assert.deepEqual(Migrate.epubSettings(NEW_EPUB), NEW_EPUB);
});

test('lostValues check itself: reports a dropped or changed value (faulty migration), passes a correct one', () => {
  const legacy = JSON.parse(legacyLocal);
  const good = Migrate.projects(legacy);
  assert.deepEqual(lostValues(legacy, good), []);
  const dropped = JSON.parse(JSON.stringify(good)); delete dropped.projects[0].steps[3].date;
  assert.ok(lostValues(legacy, dropped).length > 0, 'dropped field');
  const changed = JSON.parse(JSON.stringify(good)); changed.projects[0].name = 'x';
  assert.ok(lostValues(legacy, changed).length > 0, 'changed value');
  assert.ok(lostValues(legacy, { version: 2, projects: [] }).length > 0, 'empty result');
  assert.ok(lostValues(legacy, {}).length > 0, 'skeleton');
});

test('storage(): every legacy key moves to its new key once, converted; legacy keys are removed; second run does nothing', () => {
  const ls = fakeStorage({
    [OLD.projects]: legacyLocal, [OLD.corrupt]: '{corrupt', [OLD.tab]: 'surec', [OLD.imposeSettings]: JSON.stringify(OLD_IMPOSE),  // turkish-ok: legacy format names (migration test)
    [OLD.selectedProject]: 'k-mzeski-1', [OLD.epubSettings]: JSON.stringify(OLD_EPUB), other: 'kept'
  });
  const ss = fakeStorage({ [OLD.learnPosition]: JSON.stringify({ a: 2, i: 1, tamam: [5, 3, 0, 0, 0, 0, 0, 0, 0, 0] }) }); // turkish-ok: legacy format names (migration test)
  const r = Migrate.storage(ls, ss);
  assert.deepEqual(Object.keys(r).sort(), ['corrupt', 'epubSettings', 'imposeSettings', 'learnPosition', 'projects', 'selectedProject', 'tab']);
  assert.ok(Object.values(r).every((v) => v === 'moved'));
  for (const k of Object.values(OLD)) assert.equal(ls.getItem(k), null, `${k} removed`);
  assert.equal(ss.getItem(OLD.learnPosition), null);
  const p = JSON.parse(ls.getItem('mucellit.projects'));
  assert.equal(Model.validate(p), true);
  assert.deepEqual(lostValues(JSON.parse(legacyLocal), p), []);
  assert.equal(ls.getItem('mucellit.projects.corrupt'), '{corrupt', 'corrupt record copied as it is');
  assert.equal(ls.getItem('mucellit.tab'), 'projects');
  assert.deepEqual(JSON.parse(ls.getItem('mucellit.imposeSettings')), NEW_IMPOSE);
  assert.equal(ls.getItem('mucellit.selectedProject'), 'k-mzeski-1');
  assert.deepEqual(JSON.parse(ls.getItem('mucellit.epubSettings')), NEW_EPUB);
  assert.deepEqual(JSON.parse(ss.getItem('mucellit.learn.position')), { a: 2, i: 1, done: [5, 3, 0, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(ls.getItem('other'), 'kept');
  const snapshot = JSON.stringify([...ls.m]);
  assert.deepEqual(Migrate.storage(ls, ss), {}, 'second run');
  assert.equal(JSON.stringify([...ls.m]), snapshot);
});

test('storage() faulty cases: current key wins (legacy kept), failed write keeps the legacy key, broken JSON is copied raw', () => {
  const both = fakeStorage({ [OLD.projects]: legacyLocal, 'mucellit.projects': '{"version":2,"projects":[]}' });
  assert.deepEqual(Migrate.storage(both, null), { projects: 'kept' });
  assert.equal(both.getItem('mucellit.projects'), '{"version":2,"projects":[]}', 'current data not overwritten');
  assert.equal(both.getItem(OLD.projects), legacyLocal, 'legacy data not deleted');
  const full = fakeStorage({ [OLD.projects]: legacyLocal }, { failOn: 'mucellit.projects' });
  assert.deepEqual(Migrate.storage(full, null), {});
  assert.equal(full.getItem(OLD.projects), legacyLocal, 'legacy data kept when the write fails');
  const broken = fakeStorage({ [OLD.projects]: '{"surum":1,"kitaplar":[' }); // turkish-ok: legacy format names (migration test)
  Migrate.storage(broken, null);
  assert.equal(broken.getItem('mucellit.projects'), '{"surum":1,"kitaplar":[', 'broken JSON copied raw (storage.js backs it up)'); // turkish-ok: legacy format names (migration test)
  assert.deepEqual(Migrate.storage(fakeStorage({}), fakeStorage({})), {}, 'empty storage');
  assert.deepEqual(Migrate.storage(null, null), {}, 'no storage');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  assert.deepEqual(Migrate.storage(throwing, throwing), {}, 'storage that throws');
});

/** Loads the dictionaries, i18n.js and (optionally) migrate.js + storage.js in a browser-like vm context. */
function browser(ls, { withStorage = false } = {}) {
  const ctx = { navigator: { languages: ['en-US'] }, localStorage: ls, sessionStorage: fakeStorage({}) };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of fs.readdirSync(I18N).filter((a) => /^[a-z]{2,3}\.js$/.test(a)).sort()) vm.runInContext(read(path.join(I18N, f)), ctx);
  vm.runInContext(read(path.join(JS, 'i18n.js')), ctx);
  if (withStorage) {
    vm.runInContext(read(path.join(JS, 'migrate.js')), ctx);
    vm.runInContext(read(path.join(JS, 'project-model.js')), ctx);
    vm.runInContext(read(path.join(JS, 'storage.js')), ctx);
  }
  return ctx;
}

test('i18n.js: the legacy language choice is moved once and used (en-US browser opens in Turkish)', () => {
  const ls = fakeStorage({ [OLD.language]: 'tr' });
  const ctx = browser(ls);
  assert.equal(ctx.Mucellit.i18n.code(), 'tr');
  assert.equal(ls.getItem('mucellit.language'), 'tr');
  assert.equal(ls.getItem(OLD.language), null);
  const both = fakeStorage({ [OLD.language]: 'tr', 'mucellit.language': 'en' });
  assert.equal(browser(both).Mucellit.i18n.code(), 'en', 'current choice wins');
  assert.equal(both.getItem(OLD.language), 'tr', 'legacy choice left alone');
  const none = fakeStorage({});
  assert.equal(browser(none).Mucellit.i18n.code(), 'en', 'no choice: system language');
  assert.equal(none.m.size, 0, 'nothing written');
});

test('opening the page with legacy localStorage: migrate.js runs on load and storage.read() returns the migrated projects', () => {
  const ls = fakeStorage({ [OLD.projects]: legacyLocal, [OLD.language]: 'tr' });
  const ctx = browser(ls, { withStorage: true });
  const d = ctx.Mucellit.storage.read();
  assert.equal(d.version, 2);
  assert.equal(d.projects[0].steps.length, 15);
  assert.equal(ctx.Mucellit.storage.isCorrupt(), false);
  assert.equal(ls.getItem(OLD.projects), null);
  // a legacy record written under the new key (e.g. restored by hand) is converted when read
  const ls2 = fakeStorage({ 'mucellit.projects': legacyBackup });
  const d2 = browser(ls2, { withStorage: true }).Mucellit.storage.read();
  assert.equal(d2.version, 2);
  assert.deepEqual(lostValues(JSON.parse(legacyBackup), d2), []);
});

test('Mac app: a legacy automatic backup (old projects.json) is restored in the current format', async () => {
  const ls = fakeStorage({});
  const ctx = browser(ls, { withStorage: true });
  Object.assign(ctx, { File, Blob, TextEncoder, setTimeout: (f) => f(), document: { readyState: 'complete', getElementById: () => null } });
  ctx.__TAURI__ = {
    core: { invoke: (command) => Promise.resolve(command === 'read_backup' ? legacyBackup : command === 'pending_opens' ? [] : null) },
    event: { listen: () => Promise.resolve(() => {}) }
  };
  vm.runInContext(read(path.join(JS, 'platform.js')), ctx);
  ctx.Mucellit.common = { notify() {} };
  vm.runInContext(read(path.join(JS, 'platform-tauri.js')), ctx);
  await ctx.Mucellit.platform.ready;
  const d = JSON.parse(ls.getItem('mucellit.projects'));
  assert.equal(Model.validate(d), true);
  assert.deepEqual(lostValues(JSON.parse(legacyBackup), d), []);
});
