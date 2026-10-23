'use strict';
/*
 * learn-engine.test.js — Öğren rehberinin motoru, lisansı ve ad alanı (tarayıcısız, vm).
 *  1. Lisans: app/js/learn/ altındaki her .js ve app/css/learn.css ilk 30 satırında MIT notu ve LICENSE; js/learn/LICENSE
 *     Colorfigures MIT metni (April Zhu, Tolga Cohce); 8 figürün hepsi credit:false, motor credit:false iken bağlantı
 *     çizmez; README'de MIT atfı.
 *  2. Motor: etiket ve yazı metinleri SVG'ye kaçışlı; bağımsız sürümün test hata kaydı (window 'error' dinleyicisi,
 *     html[data-errors]) üründe yok.
 *  3. Ad alanı: 14 rehber betiği index.html sırasıyla yüklenince küresel kapsama KitapCilt dışında ad eklenmez
 *     (özellik de sözcüksel bağ da); motor KitapCilt.ogren.cf donmuş.
 * Her denetleyici bozuk kopyada "kaldı" der (kusurlu girdi sınaması).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = path.join(__dirname, '..');
const REPO = path.join(APP, '..');
const LEARN = path.join(APP, 'js', 'learn');
const read = (y) => fs.readFileSync(y, 'utf8');
const INDEX = read(path.join(APP, 'index.html'));
const ENGINE = read(path.join(LEARN, 'cf-engine.js'));

function files(d = LEARN, l = []) {
  for (const g of fs.readdirSync(d, { withFileTypes: true })) { const y = path.join(d, g.name); if (g.isDirectory()) files(y, l); else if (g.name.endsWith('.js')) l.push(y); }
  return l.sort();
}

// ---------------------------------------------------------------- 1. lisans
const hasNote = (text) => { const head = String(text).split('\n').slice(0, 30).join('\n'); return /MIT/.test(head) && /LICENSE/.test(head); };
const checkNote = (list, readFn) => list.filter((f) => !hasNote(readFn(f))).map((f) => path.relative(APP, f));
function checkLicense(text) {
  const s = [];
  if (!/^MIT License\b/.test(text)) s.push('MIT başlığı yok');
  for (const p of ['April Zhu', 'Tolga Cohce', 'Permission is hereby granted', 'The above copyright notice and this permission notice shall be included', 'WITHOUT WARRANTY OF ANY KIND']) if (!text.includes(p)) s.push('eksik: ' + p);
  return s;
}

test('lisans: her rehber dosyasında (js/learn/**, css/learn.css) MIT notu; LICENSE Colorfigures MIT metni; README atfı', () => {
  const l = [...files(), path.join(APP, 'css', 'learn.css')];
  assert.equal(l.length, 15);
  assert.deepEqual(checkNote(l, read), []);
  assert.deepEqual(checkLicense(read(path.join(LEARN, 'LICENSE'))), []);
  const readme = read(path.join(REPO, 'README.md'));
  assert.match(readme, /Colorfigures/);
  assert.match(readme, /MIT/);
  assert.match(readme, /April Zhu/);
  assert.match(readme, /Tolga Cohce/);
  assert.match(readme, /app\/js\/learn\/LICENSE/);
});

test('lisans: 8 figür credit:false; motor credit:false iken "Made with" bağlantısını çizmez (dış adres yok)', () => {
  const figures = fs.readdirSync(path.join(LEARN, 'figures')).filter((f) => f.endsWith('.js') && f !== 'common.js');
  assert.equal(figures.length, 8);
  for (const f of figures) assert.match(read(path.join(LEARN, 'figures', f)), /credit:\s*false/, f);
  assert.match(ENGINE, /cfg\.credit === false \? ''/);
});

test('lisans denetleyicileri kusurlu girdiyi yakalar (notsuz dosya, boş dosya, not 30. satırdan sonra, eksik/iskelet LICENSE)', () => {
  const target = path.join(LEARN, 'figures', 'book.js'), original = read(target);
  const withoutNotes = original.split('\n').filter((s) => !/MIT|LICENSE/.test(s)).join('\n');
  assert.deepEqual(checkNote(files(), (f) => (f === target ? withoutNotes : read(f))), [path.join('js', 'learn', 'figures', 'book.js')]);
  assert.equal(hasNote(''), false);
  assert.equal(hasNote('\n'.repeat(40) + '// MIT LICENSE'), false);
  assert.ok(checkLicense('').length > 0);
  assert.ok(checkLicense('MIT License\n').length > 0, 'skeleton');
  assert.ok(checkLicense(read(path.join(LEARN, 'LICENSE')).replace(/Tolga Cohce/g, 'X')).length > 0, 'telif adı eksik');
  assert.ok(!/credit:\s*false/.test(original.replace(/credit:\s*false/g, 'credit: true')));
});

// ---------------------------------------------------------------- 2. motor
function loadEngine(source) {
  const listener = [], dataset = {};
  const ctx = { Math, JSON, Object, Array, String, Number, Set, Map, URLSearchParams, isFinite, console,
    document: { getElementById: () => null, documentElement: { dataset } }, addEventListener: (type, fn) => listener.push([type, fn]) };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'cf-engine.js' });
  return { ctx, cf: ctx.Mucellit && ctx.Mucellit.learn && ctx.Mucellit.learn.cf, listener, dataset };
}
const BAD = 'A"<b>&x';
function checkEscape(cf) {
  const problem = [], t = cf.tag([0, 0, 0], 10, 10, BAD), y = cf.tx(0, 0, 0, BAD, 8), y2 = cf.txY(0, 0, 0, BAD, 8);
  if (!t.includes('data-t="A&quot;&lt;b&gt;&amp;x"')) problem.push('tag data-t kaçışsız');
  if (!t.includes('>A&quot;&lt;b&gt;&amp;x</text>')) problem.push('tag metni kaçışsız');
  for (const [name, s] of [['tag', t], ['tx', y], ['txY', y2]]) if (s.includes('<b>') || /data-t="A"/.test(s)) problem.push(name + ': ham < ya da " var');
  if (!y.includes('A&quot;&lt;b&gt;&amp;x</text>')) problem.push('tx kaçışsız');
  if (!y2.includes('A&quot;&lt;b&gt;&amp;x</text>')) problem.push('txY kaçışsız');
  return problem;
}
/** Test kalıntısı: pencere 'error' dinleyicisi ya da html[data-errors] yazımı (boş = yok). */
function checkLeftover(source) {
  const m = loadEngine(source), s = [];
  if (m.listener.some(([type]) => type === 'error')) s.push('window error dinleyicisi');
  for (const [, fn] of m.listener) { try { fn({ message: 'x' }); } catch (_) { /* yok sayılır */ } }
  if ('errors' in m.dataset) s.push('html[data-errors]');
  if (/dataset\.errors|_errorListener/.test(source)) s.push('kaynakta hata kaydı');
  return s;
}

test('motor: etiket ve yazı metinleri kaçışlı; test hata kaydı (error dinleyicisi, data-errors) üründe yok', () => {
  assert.deepEqual(checkEscape(loadEngine(ENGINE).cf), []);
  assert.deepEqual(checkLeftover(ENGINE), []);
});

test('motor denetleyicileri bozuk kopyaları yakalar (kusurlu girdi sınaması)', () => {
  const deg = (a, b) => { assert.ok(ENGINE.includes(a), 'varyant uygulanamadı: ' + a.slice(0, 40)); return ENGINE.replace(a, b); };
  const escapeCorrupt = {
    'tag data-t kaçışsız': deg('data-t="${esc(text)}"', 'data-t="${text}"'),
    'tag metni kaçışsız': deg('${u ? n : esc(text)}</text></g>`;', '${u ? n : text}</text></g>`;'),
    'tx kaçışsız (ikisi)': ENGINE.split('letter-spacing=".04em">${esc(str)}</text>').join('letter-spacing=".04em">${str}</text>'),
    'esc boş işlev': deg('const esc = s => String(s).replace', 'const esc = s => String(s); void String.prototype.replace'),
  };
  for (const [name, k] of Object.entries(escapeCorrupt)) { assert.notEqual(k, ENGINE, name); assert.ok(checkEscape(loadEngine(k).cf).length > 0, name + ' yakalanmadı'); }
  const putBack = "if (!MC._errorListener){ MC._errorListener = true; const record = [];\n  root.addEventListener('error', e => { record.push(String(e.message)); document.documentElement.dataset.errors = record.join(';'); }); }\nfunction mountFigure(cfg){";
  assert.ok(checkLeftover(deg('function mountFigure(cfg){', putBack)).length > 0, 'hata kaydı geri gelirse yakalanır');
  assert.ok(checkLeftover(deg('function mountFigure(cfg){', "root.addEventListener('error', () => {});\nfunction mountFigure(cfg){")).length > 0, 'yalnız dinleyici');
});

// ---------------------------------------------------------------- 3. ad alanı (bütün rehber betikleri)
const SCRIPTS = [...INDEX.matchAll(/<script\s+src="(js\/learn\/[^"]+)"/g)].map((m) => m[1]);
/** Rehber betiklerini index.html sırasıyla yükler; küresel kapsama eklenen adlar (özellik + sözcüksel). */
function adAlani(sources) {
  const blank = vm.createContext({});
  const base = new Set(vm.runInContext('Object.getOwnPropertyNames(this)', blank));
  const ctx = vm.createContext({});
  vm.runInContext('var self = this; self.Mucellit = { i18n: { t: function (a) { return a; } } };', ctx);
  base.add('self');
  for (const [name, k] of sources) vm.runInContext(k, ctx, { filename: name });
  const added = Array.from(vm.runInContext('Object.getOwnPropertyNames(this)', ctx)).filter((a) => !base.has(a) && a !== 'Mucellit');
  // sözcüksel küresel bağlar (const/let/class) Object.getOwnPropertyNames'te görünmez: bildirilen her ad sorulur
  const candidate = new Set();
  for (const [, k] of sources) {
    const s = k.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const m of s.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) candidate.add(m[1]);
  }
  const lexical = [...candidate].filter((a) => !base.has(a) && a !== 'Mucellit' && vm.runInContext(`typeof ${a} !== 'undefined'`, ctx));
  const og = vm.runInContext('Mucellit.learn', ctx);
  return { added, lexical, keys: og ? Array.from(Object.keys(og)).sort() : [], cfFrozen: !!(og && og.cf && Object.isFrozen(og.cf)) };
}

test('ad alanı: 14 rehber betiği yüklenince küresel kapsama Mucellit dışında ad eklenmez; Mucellit.learn altında; cf donmuş', () => {
  assert.equal(SCRIPTS.length, 14);
  const r = adAlani(SCRIPTS.map((b) => [b, read(path.join(APP, b))]));
  assert.deepEqual(r.added, [], 'küresel özellik');
  assert.deepEqual(r.lexical, [], 'küresel sözcüksel ad');
  assert.ok(r.cfFrozen, 'Mucellit.learn.cf donmuş');
  for (const a of ['size', 'cf', 'cfKur', 'figures', 'lessons', 'tab']) assert.ok(r.keys.includes(a), a);
  // test arayüzü (denetim) üründe yok; yalnız e2e test kopyasına ekler (learn-fixes.test.js O2)
  assert.ok(!r.keys.includes('probe'), 'Mucellit.learn.probe üründe');
});

test('ad alanı denetleyicisi sızan küresel adı yakalar (kusurlu girdi sınaması)', () => {
  const clean = SCRIPTS.map((b) => [b, read(path.join(APP, b))]);
  const corrupt = (file, fn) => clean.map(([b, k]) => [b, b === file ? fn(k) : k]);
  const learnJs = 'js/learn/learn.js';
  const varyant = {
    'üst düzey const': corrupt('js/learn/learn-lessons.js', (k) => k + '\nconst LEAKING = 1;'),
    'üst düzey işlev': corrupt(learnJs, (k) => k + '\nfunction leakingIslev() {}'),
    'self özelliği': corrupt('js/learn/figures/common.js', (k) => k + '\nself.__st = {};'),
    'IIFE kaldırılmış (motor)': corrupt('js/learn/cf-engine.js', (k) => { const y = k.replace("(function (root) {\nroot.Mucellit", 'var root = self;\nroot.Mucellit').replace(/\}\)\(typeof self !== 'undefined' \? self : this\);\s*$/, '\n'); assert.notEqual(y, k); return y; }),
    'cf donmamış': corrupt('js/learn/cf-engine.js', (k) => { const y = k.replace('MC.cf = Object.freeze({', 'MC.cf = ({'); assert.notEqual(y, k); return y; }),
  };
  for (const [name, k] of Object.entries(varyant)) {
    const r = adAlani(k);
    assert.ok(r.added.length > 0 || r.lexical.length > 0 || !r.cfFrozen, name + ' yakalanmadı');
  }
});
