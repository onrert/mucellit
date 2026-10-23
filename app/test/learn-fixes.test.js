'use strict';
/*
 * learn-fixes.test.js — fix tests, without a browser:
 *  O2. The probe interface (Mucellit.learn.probe) is not in the product; it only comes with the test injection (app/test/learn-probe.cjs).
 *  D3. cf-page.js teardown: rAF ids are cancelled only with cancelAnimationFrame, setTimeout ids only with clearTimeout.
 *  D4. The app name exemption of i18n-scan.js is word bounded ("Mücellitler" is caught).
 *  D5. One term: en "joint gap" (Calculator and guide), no "hinge"; tr "mafsal".
 *  D7. The full text of the MIT licence in the guide (index.html, #guide-license-text) = js/learn/LICENSE.
 * (O1 ⌘4 setup again, D6 progress on a language change: need a browser, the e2e.mjs "fix" checks.)
 * Every checker says "fail" on faulty input.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isTurkish } = require('./i18n-scan.js');
const { inject } = require('./learn-probe.cjs');
const I18n = require('../js/i18n.js');

const APP = path.join(__dirname, '..');
const LEARN = path.join(APP, 'js', 'learn');
const read = (y) => fs.readFileSync(y, 'utf8');
const INDEX = read(path.join(APP, 'index.html'));
const SCRIPTS = [...INDEX.matchAll(/<script\s+src="(js\/learn\/[^"]+)"/g)].map((m) => m[1]);
const LEARN_JS = 'js/learn/learn.js';
function files(d = LEARN, l = []) {
  for (const g of fs.readdirSync(d, { withFileTypes: true })) { const y = path.join(d, g.name); if (g.isDirectory()) files(y, l); else l.push(y); }
  return l.sort();
}

// ---------------------------------------------------------------- O2: no probe interface in the product
/** Source scan: product guide files in which the word "probe" occurs (code or comment). */
const sourceLeftover = (list) => list.filter(([, k]) => /probe/i.test(k)).map(([name]) => name);
/** Loads the 14 scripts in a vm in the index.html order; the Mucellit.learn keys. */
function keys(sources) {
  const ctx = vm.createContext({});
  vm.runInContext('var self = this; self.Mucellit = { i18n: { t: function (a) { return a; }, code: function () { return "tr"; } } };', ctx);
  for (const [name, k] of sources) vm.runInContext(k, ctx, { filename: name });
  return { key: Object.keys(vm.runInContext('Mucellit.learn', ctx)).sort(), ctx };
}
const PRODUCT = SCRIPTS.map((b) => [b, read(path.join(APP, b))]);
const withFile = (file, fn) => PRODUCT.map(([b, k]) => [b, b === file ? fn(k) : k]);

test('O2: no probe interface in the product guide scripts (source scan + no Mucellit.learn.probe after loading)', () => {
  assert.equal(SCRIPTS.length, 14);
  const all = files().filter((f) => f.endsWith('.js')).map((f) => [path.relative(APP, f), read(f)]);
  assert.equal(all.length, 14);
  assert.deepEqual(sourceLeftover(all), []);
  const r = keys(PRODUCT);
  assert.ok(!r.key.includes('probe'), 'Mucellit.learn.probe in the product: ' + r.key.join(','));
  for (const a of ['size', 'cf', 'cfMount', 'figures', 'lessons', 'tab']) assert.ok(r.key.includes(a), a);
});

test('O2: the test injection (learn-probe.cjs) adds the probe interface only to the test copy; the product file does not change', () => {
  const product = read(path.join(APP, LEARN_JS));
  const test1 = inject(product);
  assert.notEqual(test1, product);
  assert.ok(test1.startsWith(product.slice(0, product.lastIndexOf('})('))), 'product code as it is, the addition only before the closing');
  const r = keys(withFile(LEARN_JS, inject));
  assert.ok(r.key.includes('probe'));
  const D = vm.runInContext('Mucellit.learn.probe', r.ctx);
  for (const a of ['state', 'setup', 'run', 'play', 'fromStartToEnd', 'next', 'previous', 'numbers', 'takeFromCalculator', 'render', 'still', 'camera', 'missingKeys', 'lessons']) assert.ok(a in D, a);
  assert.equal(D.lessons.length, 10);
  assert.equal(read(path.join(APP, LEARN_JS)), product);
});

test('O2 faulty input: the leftover checkers catch a probe put back; the injection rejects a wrong file', () => {
  // an interface put back (source and run time separately)
  const restored = withFile(LEARN_JS, (k) => k.replace('MC.tab = { show, hide };', 'MC.tab = { show, hide };\n  MC.probe = { setup };'));
  assert.notDeepEqual(restored, PRODUCT);
  assert.deepEqual(sourceLeftover(restored), [LEARN_JS]);
  assert.ok(keys(restored).key.includes('probe'), 'the run time check catches it');
  assert.deepEqual(sourceLeftover([['a.js', '// Mucellit.learn.probe: a wrong comment']]), ['a.js'], 'a trace in a comment is caught too');
  // injection: empty, skeleton, copy (two closings), code after the closing, another file
  const product = read(path.join(APP, LEARN_JS));
  const bad = {
    blank: '', none: null, skeleton: "(function (root) {\n})(typeof self !== 'undefined' ? self : this);\n", copy: product + '\n' + product,
    afterCode: product + '\nMucellit.x = 1;\n', otherFile: read(path.join(LEARN, 'cf-page.js')),
  };
  for (const [name, k] of Object.entries(bad)) assert.throws(() => inject(k), /learn-probe/, name);
});

// ---------------------------------------------------------------- D3: cf-page teardown, timer ids apart
/** A fake DOM element that swallows every property (callable, iterable, 0 when turned into a number). */
function fake() {
  const cache = new Map();
  const p = new Proxy(function () {}, {
    get(_, k) {
      if (k === Symbol.iterator) return function* () {};
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      if (!cache.has(k)) cache.set(k, fake());
      return cache.get(k);
    },
    set(_, k, v) { cache.set(k, v); return true; },
    apply() { return fake(); },
    construct() { return fake(); },
  });
  return p;
}
/** Runs cf-page.js with a fake engine and DOM, then tears it down; the cancel path of the timer ids. */
function checkTeardown(source) {
  // the rAF and setTimeout id ranges overlap: both count from 1 (separate counters in a real browser too)
  let r = 0, z = 0;
  const raf = new Set(), zmn = new Set(), cancelRaf = [], cancelZmn = [];
  const clear = [];
  const ui = new Proxy({}, { get(_, k) { if (k === 'clear') return (f) => clear.push(f); if (k === 'then') return undefined; return () => undefined; } });
  const ctx = vm.createContext({
    Math, JSON, Map, Set, String, Number, Object, Array,
    innerWidth: 1280, innerHeight: 860, window: fake(), document: fake(), MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => { r += 1; raf.add(r); return r; }, cancelAnimationFrame: (id) => cancelRaf.push(id),
    setTimeout: () => { z += 1; zmn.add(z); return z; }, clearTimeout: (id) => cancelZmn.push(id),
  });
  ctx.self = ctx;
  ctx.Mucellit = { learn: { cf: { mountFigure: () => ui, xrMount: () => undefined } } };
  vm.runInContext(source, ctx, { filename: 'cf-page.js' });
  ctx.Mucellit.learn.cfMount({ text: {} });
  const givenRaf = [...raf], givenZmn = [...zmn];
  // clashing id: rAF 1 and setTimeout 1 are the same number. Correct teardown: every rAF id with cancelAnimationFrame, every
  // setTimeout id with clearTimeout, once; no cancel with the wrong function (the app's timer with the same number).
  for (const f of clear) f();
  const s = [];
  const say = (l) => l.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const cr = say(cancelRaf.filter((x) => x !== 0)), cz = say(cancelZmn);
  if (givenRaf.length < 2 || givenZmn.length < 1) s.push(`the expected timers were not set up (rAF ${givenRaf.length}, setTimeout ${givenZmn.length})`);
  for (const id of givenRaf) if (cr.get(id) !== 1) s.push(`rAF ${id}: cancelAnimationFrame ${cr.get(id) || 0} times`);
  for (const id of givenZmn) if (cz.get(id) !== 1) s.push(`setTimeout ${id}: clearTimeout ${cz.get(id) || 0} times`);
  if (cancelZmn.length !== givenZmn.length) s.push(`clearTimeout ${cancelZmn.length} calls, ${givenZmn.length} timers (an rAF id went to clearTimeout)`);
  if (cr.size && [...cr.values()].reduce((a, b) => a + b, 0) !== givenRaf.length) s.push(`cancelAnimationFrame ${[...cr.values()].reduce((a, b) => a + b, 0)} calls, ${givenRaf.length} rAF (a setTimeout id went to cancelAnimationFrame)`);
  return s;
}
const PAGE = read(path.join(LEARN, 'cf-page.js'));

test('D3: cf-page teardown: rAF ids only with cancelAnimationFrame, setTimeout ids only with clearTimeout (once each)', () => {
  assert.deepEqual(checkTeardown(PAGE), []);
});

test('D3 faulty input: a mixed array (old teardown), a missing cancel and a swapped cancel are caught', () => {
  const old = "const time = [];\n  ui.clear(() => { time.forEach(id => { clearTimeout(id); cancelAnimationFrame(id); }); });";
  const mixed = PAGE.replace(/const raf = \[\], time = \[\];\n {2}ui\.clear\([^\n]*\n/, old + '\n').replace(/raf\.push\(/g, 'time.push(');
  assert.notEqual(mixed, PAGE, 'mixed variant could not be applied');
  assert.ok(checkTeardown(mixed).length > 0, 'mixed array not caught');
  const noCancel = PAGE.replace(/raf\.forEach\(cancelAnimationFrame\)/, 'void 0');
  assert.notEqual(noCancel, PAGE);
  assert.ok(checkTeardown(noCancel).length > 0, 'missing rAF cancel not caught');
  const reversed = PAGE.replace(/raf\.forEach\(cancelAnimationFrame\)/, 'raf.forEach(id => clearTimeout(id))');
  assert.notEqual(reversed, PAGE);
  assert.ok(checkTeardown(reversed).length > 0, 'swapped cancel not caught');
});

// ---------------------------------------------------------------- D4: the exemption is word bounded
test('D4: the app name exemption only for the full name ("Mücellit", "MUCELLIT"); a Turkish word with a suffix is caught', () => {
  for (const m of ['Mücellit', 'MUCELLIT', 'Mücellit v1', 'MUCELLIT 2026']) assert.equal(isTurkish(m), false, `false alarm: ${m}`);
  for (const m of ['Mücellitler', 'Mücellitin', 'Mücellite acildi', 'YENI Mücellitler', 'Mücellitçi']) assert.equal(isTurkish(m), true, `missed: ${m}`);  // turkish-ok: Turkish test text (the scan must catch these)
});

// ---------------------------------------------------------------- D5: one term
const EN = I18n.extractJson(read(path.join(APP, 'i18n', 'en.js')));
const TR = I18n.extractJson(read(path.join(APP, 'i18n', 'tr.js')));
// texts that name the f measurement (Calculator + calculation reasons + guide panel/note)
const JOINT_KEY = ['calculator.jointGap', 'calculator.result.jointGap', 'calculator.warning.jointGap', 'calculator.rule.onlyS', 'calculator.description', 'calc.name.jointGap',
  'calc.name.board_width', 'calc.reason.joint_gap_too_large', 'learn.p.jointGap', 'learn.numbers_note', 'learn.cover.board.description', 'learn.cover.covering.description'];
function checkTerm(en, tr) {
  const s = [];
  const flat = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  for (const [a, v] of Object.entries(en)) if (/hinge/i.test(flat(v))) s.push(`en ${a}: "hinge"`);
  for (const a of JOINT_KEY) {
    if (!(a in en) || !/joint gap/i.test(flat(en[a]))) s.push(`en ${a}: no "joint gap"`);
    if (!(a in tr) || !/mafsal/i.test(flat(tr[a]))) s.push(`tr ${a}: no "mafsal"`);  // turkish-ok: expected Turkish UI text
  }
  return s;
}
test('D5: the joint (f) measurement has one term in en-US, "joint gap" (Calculator and guide), no "hinge"; tr "mafsal"', () => {
  assert.deepEqual(checkTerm(EN, TR), []);
});
test('D5 faulty input: caught when a single "hinge gap" comes back, the term is removed or tr changes', () => {
  assert.ok(checkTerm({ ...EN, 'calculator.result.jointGap': 'Hinge gap f' }, TR).length > 0);
  assert.ok(checkTerm({ ...EN, 'learn.s.book.jointGap': 'HINGE' }, TR).length > 0, 'figure label');
  assert.ok(checkTerm({ ...EN, 'learn.p.jointGap': 'Gap f' }, TR).length > 0);
  assert.ok(checkTerm(EN, { ...TR, 'learn.p.jointGap': 'Menteşe f' }).length > 0);  // turkish-ok: expected Turkish UI text
  assert.ok(checkTerm({}, {}).length > 0, 'empty dictionary');
});

// ---------------------------------------------------------------- D7: the licence text in the guide
const decodeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function licensePanel(html, license) {
  const s = [];
  const d = html.match(/<details\b[^>]*\bid="guide-license"[^>]*>([\s\S]*?)<\/details>/);
  if (!d) return ['#guide-license (details) missing'];
  const top = html.slice(html.indexOf('id="guide-root"'), html.indexOf('</section>', html.indexOf('id="tab-learn"')));
  if (!top.includes('id="guide-license"')) s.push('the licence panel is not inside the Learn tab');
  const summary = d[1].match(/<summary\b[^>]*\bdata-i18n="([^"]+)"[^>]*>([^<]*)<\/summary>/);
  if (!summary) s.push('summary (data-i18n) missing');
  else if (!(summary[1] in EN) || !(summary[1] in TR) || !summary[2].trim()) s.push('the summary key is not in the dictionary or is empty: ' + summary[1]);
  const pre = d[1].match(/<pre\b[^>]*\bid="guide-license-text"[^>]*>([\s\S]*?)<\/pre>/);
  if (!pre) s.push('#guide-license-text missing');
  else if (decodeHtml(pre[1]).trim() !== String(license).trim()) s.push('the panel text is not the same as LICENSE');
  if (pre && !/\blang="en"/.test(pre[0])) s.push('the licence text is not lang="en" (English legal text in the Turkish interface)');
  return s;
}
const LICENSE = read(path.join(LEARN, 'LICENSE'));
test('D7: a collapsible licence panel in the Learn tab; the text exactly js/learn/LICENSE; the footnote shows the panel', () => {
  assert.deepEqual(licensePanel(INDEX, LICENSE), []);
  for (const S of [EN, TR]) assert.doesNotMatch(S['learn.license'], /LICENSE/, 'no pointer to a file the user cannot reach');
});
test('D7 faulty input: no panel, empty, skeleton, different text, a panel outside the tab are caught', () => {
  const pre = INDEX.match(/(<pre\b[^>]*id="guide-license-text"[^>]*>)([\s\S]*?)(<\/pre>)/);
  assert.ok(pre, 'no panel');
  assert.ok(licensePanel(INDEX.replace(/<details\b[^>]*id="guide-license"[\s\S]*?<\/details>/, ''), LICENSE).length > 0, 'withoutPanel');
  assert.ok(licensePanel(INDEX.replace(pre[0], pre[1] + pre[3]), LICENSE).length > 0, 'empty');
  assert.ok(licensePanel(INDEX.replace(pre[0], pre[1] + 'MIT License' + pre[3]), LICENSE).length > 0, 'skeleton');
  assert.ok(licensePanel(INDEX.replace(pre[0], pre[0].replace('Tolga Cohce', 'X')), LICENSE).length > 0, 'different');
  const panel = INDEX.match(/<details\b[^>]*id="guide-license"[\s\S]*?<\/details>/)[0];
  assert.ok(licensePanel(INDEX.replace(panel, '').replace('</body>', panel + '</body>'), LICENSE).length > 0, 'outside the tab');
});
