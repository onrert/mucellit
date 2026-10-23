'use strict';
/*
 * learn-engine.test.js — the engine, licence and namespace of the Learn guide (no browser, vm).
 *  1. Licence: every .js under app/js/learn/ and app/css/learn.css has the MIT note and LICENSE in its first 30 lines;
 *     js/learn/LICENSE is the Colorfigures MIT text (April Zhu, Tolga Cohce); all 8 figures credit:false, the engine
 *     draws no link with credit:false; the MIT attribution is in the README.
 *  2. Engine: label and text strings are escaped into the SVG; the stand-alone version's test error log (window
 *     'error' listener, html[data-errors]) is not in the product.
 *  3. Namespace: when the 14 guide scripts load in the index.html order no name other than Mucellit is added to the
 *     global scope (neither a property nor a lexical binding); the engine Mucellit.learn.cf is frozen.
 * Every checker says "fail" on a broken copy (faulty input test).
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

// ---------------------------------------------------------------- 1. licence
const hasNote = (text) => { const head = String(text).split('\n').slice(0, 30).join('\n'); return /MIT/.test(head) && /LICENSE/.test(head); };
const checkNote = (list, readFn) => list.filter((f) => !hasNote(readFn(f))).map((f) => path.relative(APP, f));
function checkLicense(text) {
  const s = [];
  if (!/^MIT License\b/.test(text)) s.push('no MIT heading');
  for (const p of ['April Zhu', 'Tolga Cohce', 'Permission is hereby granted', 'The above copyright notice and this permission notice shall be included', 'WITHOUT WARRANTY OF ANY KIND']) if (!text.includes(p)) s.push('missing: ' + p);
  return s;
}

test('licence: the MIT note in every guide file (js/learn/**, css/learn.css); LICENSE is the Colorfigures MIT text; README attribution', () => {
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

test('licence: 8 figures credit:false; the engine draws no "Made with" link with credit:false (no outside address)', () => {
  const figures = fs.readdirSync(path.join(LEARN, 'figures')).filter((f) => f.endsWith('.js') && f !== 'common.js');
  assert.equal(figures.length, 8);
  for (const f of figures) assert.match(read(path.join(LEARN, 'figures', f)), /credit:\s*false/, f);
  assert.match(ENGINE, /cfg\.credit === false \? ''/);
});

test('the licence checkers catch faulty input (file without the note, empty file, note after line 30, missing/skeleton LICENSE)', () => {
  const target = path.join(LEARN, 'figures', 'book.js'), original = read(target);
  const withoutNotes = original.split('\n').filter((s) => !/MIT|LICENSE/.test(s)).join('\n');
  assert.deepEqual(checkNote(files(), (f) => (f === target ? withoutNotes : read(f))), [path.join('js', 'learn', 'figures', 'book.js')]);
  assert.equal(hasNote(''), false);
  assert.equal(hasNote('\n'.repeat(40) + '// MIT LICENSE'), false);
  assert.ok(checkLicense('').length > 0);
  assert.ok(checkLicense('MIT License\n').length > 0, 'skeleton');
  assert.ok(checkLicense(read(path.join(LEARN, 'LICENSE')).replace(/Tolga Cohce/g, 'X')).length > 0, 'copyright name missing');
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
  if (!t.includes('data-t="A&quot;&lt;b&gt;&amp;x"')) problem.push('tag data-t not escaped');
  if (!t.includes('>A&quot;&lt;b&gt;&amp;x</text>')) problem.push('tag text not escaped');
  for (const [name, s] of [['tag', t], ['tx', y], ['txY', y2]]) if (s.includes('<b>') || /data-t="A"/.test(s)) problem.push(name + ': ham < ya da " var');
  if (!y.includes('A&quot;&lt;b&gt;&amp;x</text>')) problem.push('tx not escaped');
  if (!y2.includes('A&quot;&lt;b&gt;&amp;x</text>')) problem.push('txY not escaped');
  return problem;
}
/** Test leftover: a window 'error' listener or writing html[data-errors] (empty = none). */
function checkLeftover(source) {
  const m = loadEngine(source), s = [];
  if (m.listener.some(([type]) => type === 'error')) s.push('window error dinleyicisi');
  for (const [, fn] of m.listener) { try { fn({ message: 'x' }); } catch (_) { /* ignored */ } }
  if ('errors' in m.dataset) s.push('html[data-errors]');
  if (/dataset\.errors|_errorListener/.test(source)) s.push('error log in the source');
  return s;
}

test('engine: label and text strings escaped; no test error log (error listener, data-errors) in the product', () => {
  assert.deepEqual(checkEscape(loadEngine(ENGINE).cf), []);
  assert.deepEqual(checkLeftover(ENGINE), []);
});

test('the engine checkers catch broken copies (faulty input test)', () => {
  const deg = (a, b) => { assert.ok(ENGINE.includes(a), 'variant could not be applied: ' + a.slice(0, 40)); return ENGINE.replace(a, b); };
  const escapeCorrupt = {
    'tag data-t not escaped': deg('data-t="${esc(text)}"', 'data-t="${text}"'),
    'tag text not escaped': deg('${u ? n : esc(text)}</text></g>`;', '${u ? n : text}</text></g>`;'),
    'tx not escaped (both)': ENGINE.split('letter-spacing=".04em">${esc(str)}</text>').join('letter-spacing=".04em">${str}</text>'),
    'esc an empty function': deg('const esc = s => String(s).replace', 'const esc = s => String(s); void String.prototype.replace'),
  };
  for (const [name, k] of Object.entries(escapeCorrupt)) { assert.notEqual(k, ENGINE, name); assert.ok(checkEscape(loadEngine(k).cf).length > 0, name + ' not caught'); }
  const putBack = "if (!MC._errorListener){ MC._errorListener = true; const record = [];\n  root.addEventListener('error', e => { record.push(String(e.message)); document.documentElement.dataset.errors = record.join(';'); }); }\nfunction mountFigure(cfg){";
  assert.ok(checkLeftover(deg('function mountFigure(cfg){', putBack)).length > 0, 'caught if the error log comes back');
  assert.ok(checkLeftover(deg('function mountFigure(cfg){', "root.addEventListener('error', () => {});\nfunction mountFigure(cfg){")).length > 0, 'only the listener');
});

// ---------------------------------------------------------------- 3. namespace (all guide scripts)
const SCRIPTS = [...INDEX.matchAll(/<script\s+src="(js\/learn\/[^"]+)"/g)].map((m) => m[1]);
/** Loads the guide scripts in the index.html order; the names added to the global scope (property + lexical). */
function namespaceNames(sources) {
  const blank = vm.createContext({});
  const base = new Set(vm.runInContext('Object.getOwnPropertyNames(this)', blank));
  const ctx = vm.createContext({});
  vm.runInContext('var self = this; self.Mucellit = { i18n: { t: function (a) { return a; } } };', ctx);
  base.add('self');
  for (const [name, k] of sources) vm.runInContext(k, ctx, { filename: name });
  const added = Array.from(vm.runInContext('Object.getOwnPropertyNames(this)', ctx)).filter((a) => !base.has(a) && a !== 'Mucellit');
  // lexical global bindings (const/let/class) do not show in Object.getOwnPropertyNames: every declared name is asked for
  const candidate = new Set();
  for (const [, k] of sources) {
    const s = k.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const m of s.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) candidate.add(m[1]);
  }
  const lexical = [...candidate].filter((a) => !base.has(a) && a !== 'Mucellit' && vm.runInContext(`typeof ${a} !== 'undefined'`, ctx));
  const og = vm.runInContext('Mucellit.learn', ctx);
  return { added, lexical, keys: og ? Array.from(Object.keys(og)).sort() : [], cfFrozen: !!(og && og.cf && Object.isFrozen(og.cf)) };
}

test('namespace: loading the 14 guide scripts adds no global name other than Mucellit; under Mucellit.learn; cf frozen', () => {
  assert.equal(SCRIPTS.length, 14);
  const r = namespaceNames(SCRIPTS.map((b) => [b, read(path.join(APP, b))]));
  assert.deepEqual(r.added, [], 'global property');
  assert.deepEqual(r.lexical, [], 'global lexical name');
  assert.ok(r.cfFrozen, 'Mucellit.learn.cf frozen');
  for (const a of ['size', 'cf', 'cfMount', 'figures', 'lessons', 'tab']) assert.ok(r.keys.includes(a), a);
  // the test interface (probe) is not in the product; only e2e adds it to its test copy (learn-fixes.test.js O2)
  assert.ok(!r.keys.includes('probe'), 'Mucellit.learn.probe in the product');
});

test('the namespace checker catches a leaking global name (faulty input test)', () => {
  const clean = SCRIPTS.map((b) => [b, read(path.join(APP, b))]);
  const corrupt = (file, fn) => clean.map(([b, k]) => [b, b === file ? fn(k) : k]);
  const learnJs = 'js/learn/learn.js';
  const varyant = {
    'top-level const': corrupt('js/learn/learn-lessons.js', (k) => k + '\nconst LEAKING = 1;'),
    'top-level function': corrupt(learnJs, (k) => k + '\nfunction leakingIslev() {}'),
    'self property': corrupt('js/learn/figures/common.js', (k) => k + '\nself.__st = {};'),
    'IIFE removed (engine)': corrupt('js/learn/cf-engine.js', (k) => { const y = k.replace("(function (root) {\nroot.Mucellit", 'var root = self;\nroot.Mucellit').replace(/\}\)\(typeof self !== 'undefined' \? self : this\);\s*$/, '\n'); assert.notEqual(y, k); return y; }),
    'cf not frozen': corrupt('js/learn/cf-engine.js', (k) => { const y = k.replace('MC.cf = Object.freeze({', 'MC.cf = ({'); assert.notEqual(y, k); return y; }),
  };
  for (const [name, k] of Object.entries(varyant)) {
    const r = namespaceNames(k);
    assert.ok(r.added.length > 0 || r.lexical.length > 0 || !r.cfFrozen, name + ' not caught');
  }
});
