'use strict';
// Interface language: dictionary equality, missing keys, parameters, singular/plural, language choice, applying data-i18n,
// the fixed Turkish string scan (with an allowlist) and opening old Turkish records.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setupI18n, DICTIONARY_FILES, FOLDER } = require('./i18n-helper.js');
const { jsStrings, rustStrings, htmlTexts, isTurkish } = require('./i18n-scan.js');
const I18n = require('../js/i18n.js');

const APP = path.join(__dirname, '..');
const REPO = path.join(APP, '..');
const read = (y) => fs.readFileSync(y, 'utf8');

// ---------------------------------------------------------------- dictionary checker
const PLURAL = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const META = ['_lang', '_name', '_locale'];
function params(value) {
  const texts = typeof value === 'string' ? [value] : Object.values(value || {});
  const p = new Set();
  texts.forEach((m) => String(m).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, a) => { p.add(a); return ''; }));
  return [...p].sort();
}

/**
 * Compares the dictionaries. files: { code: text (file text) } or { code: object }. Returns a list of problems:
 * missing/extra key (against en), empty text, a value that is not text, a broken plural object, a parameter difference,
 * a repeated key (in the file text), _lang does not match the file name, metadata missing.
 */
function checkDictionary(files) {
  const problem = [];
  const object = {};
  for (const [code, text] of Object.entries(files)) {
    try { object[code] = I18n.extractJson(text); } catch (e) { problem.push(`${code}: not JSON (${e.message})`); continue; }
    const say = {};
    // top-level keys (2 spaces of indent; the one/other of a plural object at 4 spaces)
    for (const m of String(text).matchAll(/^ {2}"((?:[^"\\]|\\.)+)"\s*:/gm)) say[m[1]] = (say[m[1]] || 0) + 1;
    Object.entries(say).filter(([, n]) => n > 1).forEach(([a]) => problem.push(`${code}: repeated key ${a}`));
    META.forEach((a) => { if (typeof object[code][a] !== 'string' || !object[code][a].trim()) problem.push(`${code}: ${a} none`); });
    if (object[code]._lang !== code) problem.push(`${code}: _lang "${object[code]._lang}" does not match the file name`);
  }
  const main = object.en;
  if (!main) return problem.concat(['no en dictionary']);
  const keys = (s) => Object.keys(s).filter((a) => !a.startsWith('_'));
  for (const [code, s] of Object.entries(object)) {
    for (const a of keys(main)) if (!(a in s)) problem.push(`${code}: missing ${a}`);
    for (const a of keys(s)) {
      if (!(a in main)) { problem.push(`${code}: extra ${a}`); continue; }
      const d = s[a];
      if (typeof d === 'string') {
        if (!d.trim()) problem.push(`${code}: empty ${a}`);
      } else if (d && typeof d === 'object' && !Array.isArray(d)) {
        if (typeof d.other !== 'string' || !d.other.trim()) problem.push(`${code}: ${a} plural object without other`);
        for (const [k, v] of Object.entries(d)) {
          if (!PLURAL.has(k)) problem.push(`${code}: ${a} unknown plural category ${k}`);
          else if (typeof v !== 'string' || !v.trim()) problem.push(`${code}: ${a}.${k} empty`);
        }
        if (!params(d).includes('n')) problem.push(`${code}: ${a} plural but no {n}`);
      } else problem.push(`${code}: ${a} not text`);
      const pa = params(main[a]).join(','), pk = params(d).join(',');
      if (pa !== pk) problem.push(`${code}: ${a} parameters differ (en: ${pa || '-'}; ${code}: ${pk || '-'})`);
    }
  }
  return problem;
}

const ACTUAL = Object.fromEntries(DICTIONARY_FILES.map((a) => [a.replace(/\.js$/, ''), read(path.join(FOLDER, a))]));

test('dictionary equality: en and tr have the same key set, no empty text, the parameters match, no repeated key', () => {
  assert.ok(DICTIONARY_FILES.includes('en.js') && DICTIONARY_FILES.includes('tr.js'), DICTIONARY_FILES.join());
  assert.deepEqual(checkDictionary(ACTUAL), []);
  const n = Object.keys(I18n.extractJson(ACTUAL.en)).length - META.length;
  // the Learn guide added ~520 keys (486 before); the upper limit only checks "did the dictionary double by mistake"
  assert.ok(n > 300 && n < 1500, `key count ${n}`);
});

test('the dictionary checker catches faulty dictionaries (missing, extra, empty, parameter, plural, repetition, _lang, JSON)', () => {
  const wrap = (o) => '[/*JSON*/' + JSON.stringify(o, null, 2) + '/*JSON*/]';
  const tr = () => I18n.extractJson(ACTUAL.tr);
  const states = {
    'missing key': (() => { const t = tr(); delete t['menu.file']; return { tr: wrap(t) }; })(),
    'extra key': (() => { const t = tr(); t['none.such'] = 'x'; return { tr: wrap(t) }; })(),
    'empty text': (() => { const t = tr(); t['menu.file'] = '   '; return { tr: wrap(t) }; })(),
    'not text': (() => { const t = tr(); t['menu.file'] = 5; return { tr: wrap(t) }; })(),
    'parameter difference': (() => { const t = tr(); t['impose.loaded'] = '{file} yüklendi ({n} sayfa).'; return { tr: wrap(t) }; })(),  // turkish-ok: Turkish test text
    'param missing': (() => { const t = tr(); t['recent.no_disk'] = '{name} açılamadı.'; return { tr: wrap(t) }; })(),  // turkish-ok: Turkish test text
    'plural without other': (() => { const t = tr(); t['impose.selected'] = { one: '{n} page' }; return { tr: wrap(t) }; })(),
    'plural category': (() => { const t = tr(); t['impose.selected'] = { single: '{n}', other: '{n} sayfa seçildi.' }; return { tr: wrap(t) }; })(),  // turkish-ok: Turkish test text
    'plural without n': (() => { const t = tr(); t['impose.selected'] = { other: 'seçildi' }; return { tr: wrap(t) }; })(),  // turkish-ok: Turkish test text
    'repeated key': { tr: ACTUAL.tr.replace('"menu.file": "Dosya",', '"menu.file": "Dosya",\n  "menu.file": "Dosya",') },  // turkish-ok: Turkish test text
    '_lang does not match': (() => { const t = tr(); t._lang = 'en'; return { tr: wrap(t) }; })(),
    'no metadata': (() => { const t = tr(); delete t._name; return { tr: wrap(t) }; })(),
    'not JSON (trailing comma)': { tr: ACTUAL.tr.replace('"menu.file": "Dosya",', '"menu.file": "Dosya",,') },  // turkish-ok: Turkish test text
    'no markers': { tr: ACTUAL.tr.replace(/\/\*JSON\*\//g, '') },
    'skeleton (empty object)': { tr: '[/*JSON*/{"_lang":"tr","_name":"Türkçe","_locale":"tr-TR"}/*JSON*/]' },  // turkish-ok: Turkish test text
    'copy (en text tr diye)': { tr: ACTUAL.en },
    'no en': { en: undefined },
  };
  for (const [name, deg] of Object.entries(states)) {
    const files = { ...ACTUAL, ...deg };
    if (deg.en === undefined && 'en' in deg) delete files.en;
    const s = checkDictionary(files);
    assert.ok(s.length > 0, `${name}: not caught`);
  }
});

// ---------------------------------------------------------------- run time (vm, as in the browser)
function fresh(code, extra) {
  const ctx = { navigator: { languages: ['en-US'] } };
  ctx.self = ctx;
  vm.createContext(ctx);
  if (extra) ctx.MucellitDictionaries = [extra];
  return setupI18n(ctx, code);
}

test('a missing key falls back to en; when no language has it the key is returned and written to missingKeys()', () => {
  const extra = { _lang: 'zz', _name: 'Test', _locale: 'en-US', 'menu.file': 'Fichier' };
  const D = fresh('zz', extra);
  assert.equal(D.code(), 'zz');
  assert.equal(D.t('menu.file'), 'Fichier');
  assert.equal(D.t('menu.open'), 'Open…', 'not in zz → en');
  assert.deepEqual(Array.from(D.missingKeys()), []);
  assert.equal(D.t('none.such.key'), 'none.such.key');
  assert.deepEqual(Array.from(D.missingKeys()), ['none.such.key']);
  assert.equal(D.t('_name'), '_name', 'metadata is not given as text');
  assert.equal(fresh('xx').code(), 'en', 'unsupported language → en');
});

test('text with parameters: name/number/path are put in place; a missing parameter stays as {name}', () => {
  const tr = fresh('tr'), en = fresh('en');
  assert.equal(tr.t('impose.loaded', { name: 'a.pdf', n: 37 }), 'a.pdf yüklendi (37 sayfa).');  // turkish-ok: expected Turkish UI text
  assert.equal(en.t('impose.loaded', { name: 'a.pdf', n: 37 }), 'a.pdf loaded (37 pages).');
  assert.equal(en.t('recent.no_disk', { name: 'tez.pdf', detail: 'MCTrial' }), "tez.pdf couldn't be opened: its disk (MCTrial) isn't connected. Connect the disk and try again; the entry stays in Open Recent.");
  assert.equal(en.t('save.saved', { paths: '/Users/x/a b.pdf' }), 'Saved: /Users/x/a b.pdf.');
  assert.equal(en.t('impose.pdf_not', {}), "The file isn't a valid PDF: {name}");
  assert.equal(en.t('impose.pdf_not', { name: 0 }), "The file isn't a valid PDF: 0", 'the value 0 is written');
});

test('singular/plural: en "1 page / 2 pages" (Intl.PluralRules), tr one form', () => {
  const tr = fresh('tr'), en = fresh('en');
  assert.equal(en.t('impose.selected', { n: 1 }), '1 page selected.');
  assert.equal(en.t('impose.selected', { n: 2 }), '2 pages selected.');
  assert.equal(en.t('impose.selected', { n: 0 }), '0 pages selected.');
  assert.equal(en.t('impose.loaded', { name: 'x.pdf', n: 1 }), 'x.pdf loaded (1 page).');
  assert.equal(en.t('projects.list_summary', { kind: 'T', done: 0, n: 1 }), 'T · 0/1 step');
  assert.equal(tr.t('impose.selected', { n: 1 }), '1 sayfa seçildi.');  // turkish-ok: expected Turkish UI text
  assert.equal(tr.t('impose.selected', { n: 2 }), '2 sayfa seçildi.');  // turkish-ok: expected Turkish UI text
  assert.equal(en.t('impose.selected'), '{n} pages selected.', 'other without n');
});

test('language choice: the system language by the Apple rule (the first supported language); a manual choice in localStorage; html lang', () => {
  const D = fresh('en');
  assert.equal(D.systemLanguage(['tr-TR', 'en-US']), 'tr');
  assert.equal(D.systemLanguage(['tr']), 'tr');
  assert.equal(D.systemLanguage(['TR_tr']), 'tr');
  assert.equal(D.systemLanguage(['en-GB', 'tr-TR']), 'en');
  assert.equal(D.systemLanguage(['de-DE', 'tr-TR']), 'tr', 'Apple rule: the first supported language in the list');
  assert.equal(D.systemLanguage(['de-DE', 'fr-FR']), 'en', 'en when the list has no supported language');
  assert.equal(D.systemLanguage([]), 'en');
  assert.equal(D.systemLanguage(undefined), 'en');
  assert.equal(D.systemLanguage(['', null, 'tr']), 'tr');
  // start: the localStorage choice > navigator.languages
  const setup = (ls, languages) => {
    const ctx = { navigator: { languages: languages }, localStorage: ls, document: { documentElement: { lang: '', setAttribute(a, v) { this[a] = v; } }, querySelectorAll: () => [] } };
    ctx.self = ctx;
    vm.createContext(ctx);
    for (const a of DICTIONARY_FILES) vm.runInContext(read(path.join(FOLDER, a)), ctx);
    vm.runInContext(read(path.join(APP, 'js', 'i18n.js')), ctx);
    return ctx;
  };
  const storage = (v) => { const d = { v: v === undefined ? {} : v, getItem: (k) => (k in d.v ? d.v[k] : null), setItem: (k, x) => { d.v[k] = String(x); }, removeItem: (k) => { delete d.v[k]; } }; return d; };
  assert.equal(setup(storage(), ['tr-TR']).Mucellit.i18n.code(), 'tr', 'system tr');
  assert.equal(setup(storage(), ['en-US', 'tr']).Mucellit.i18n.code(), 'en', 'system en');
  assert.equal(setup(storage(), ['ja-JP']).Mucellit.i18n.code(), 'en', 'unsupported system language');
  assert.equal(setup(storage({ 'mucellit.language': 'en' }), ['tr-TR']).Mucellit.i18n.code(), 'en', 'a manual choice overrides the system language');
  assert.equal(setup(storage({ 'mucellit.language': 'xx' }), ['tr-TR']).Mucellit.i18n.code(), 'tr', 'a broken choice is ignored');
  const atan = { getItem() { throw new Error('off'); }, setItem() { throw new Error('off'); }, removeItem() { throw new Error('off'); } };
  const c = setup(atan, ['tr-TR']);
  assert.equal(c.Mucellit.i18n.code(), 'tr', 'storage off: the system language');
  assert.doesNotThrow(() => c.Mucellit.i18n.writeChoice('en'));
  assert.equal(c.document.documentElement.lang, 'tr');
  const d = storage();
  const k = setup(d, ['tr-TR']).Mucellit.i18n;
  k.writeChoice('en');
  assert.equal(d.v['mucellit.language'], 'en');
  assert.equal(k.readChoice(), 'en');
  k.writeChoice(null);
  assert.equal('mucellit.language' in d.v, false, 'the system choice removes the key');
  k.writeChoice('xx');
  assert.equal('mucellit.language' in d.v, false, 'an unsupported code is not written');
});

test('apply: data-i18n text, data-i18n-attr attributes, document title', () => {
  const D = fresh('en');
  const element = (a) => ({ a, textContent: 'old', attrs: {}, getAttribute(k) { return this.a[k]; }, setAttribute(k, v) { this.attrs[k] = v; } });
  const m = element({ 'data-i18n': 'menu.file' });
  const o = element({ 'data-i18n-attr': 'aria-label:language.label; title:impose.swap;broken;:x' });
  const root = { querySelectorAll: (s) => (s === '[data-i18n]' ? [m] : s === '[data-i18n-attr]' ? [o] : []) };
  D.apply(root);
  assert.equal(m.textContent, 'File');
  assert.deepEqual(o.attrs, { 'aria-label': 'Language', title: 'Swap portrait / landscape' });
  assert.doesNotThrow(() => D.apply(null));
  assert.doesNotThrow(() => D.apply({}));
});

// ---------------------------------------------------------------- key use
function files(folder, extension, except = []) {
  const l = [];
  (function walk(k) {
    for (const g of fs.readdirSync(k, { withFileTypes: true })) {
      const y = path.join(k, g.name);
      if (except.some((h) => y.startsWith(h))) continue;
      if (g.isDirectory()) walk(y); else if (g.name.endsWith(extension)) l.push(y);
    }
  })(folder);
  return l.sort();
}
const JS_FILES = files(path.join(APP, 'js'), '.js');
const RUST_FILES = files(path.join(REPO, 'src-tauri', 'src'), '.rs');
const DICTIONARY = I18n.extractJson(ACTUAL.en);
const NAME_FIELDS = new Set(Object.keys(DICTIONARY).filter((a) => !a.startsWith('_')).map((a) => a.split('.')[0]));
// Key prefixes joined at run time (dynamic): the full key does not occur in the source.
const DYNAMIC = ['step.', 'epub.E', 'epub.detail.', 'binding.kind.', 'calc.name.', 'imposition.name.', 'projects.settings_type.'];
/**
 * The stage/step keys of the Learn guide are built in pieces in learn.js (`learn.${stage}.${step}.title` …); instead of
 * a prefix exemption they are generated one by one from the lesson list (js/learn/learn-lessons.js): .name/.summary
 * required on every stage, .title/.description/.button on every step; .tool/.caution/.description_few optional (only
 * for a step in the lesson list).
 */
function learnLessonKeys(source) {
  const ctx = {}; ctx.self = ctx; vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'learn-lessons.js' });
  const required = new Set(), optional = new Set();
  for (const d of ctx.Mucellit.learn.lessons) {
    required.add(`learn.${d.id}.name`); required.add(`learn.${d.id}.summary`);
    for (const a of d.steps) {
      for (const e of ['title', 'description', 'button']) required.add(`learn.${d.id}.${a}.${e}`);
      for (const e of ['tool', 'caution', 'description_few']) optional.add(`learn.${d.id}.${a}.${e}`);
    }
  }
  return { required, optional };
}
const LEARN_LESSONS = learnLessonKeys(read(path.join(APP, 'js', 'learn', 'learn-lessons.js')));

test('key use: every key in the source is in the dictionary; no unused key in the dictionary', () => {
  const used = new Set();
  // file/host names (language.txt, projects.json, tauri.localhost) do not count as keys
  const keyLike = (m) => /^[a-z]+(\.[a-zA-Z0-9_]+)+$/.test(m) && NAME_FIELDS.has(m.split('.')[0]) && !/\.(txt|json|js|pdf|epub|localhost)$/.test(m);
  for (const y of JS_FILES) for (const d of jsStrings(read(y))) if (keyLike(d.text)) used.add(d.text);
  for (const y of RUST_FILES) for (const d of rustStrings(read(y))) if (!d.log && keyLike(d.text)) used.add(d.text);
  const html = read(path.join(APP, 'index.html'));
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(';').forEach((c) => used.add(c.split(':')[1]));
  for (const a of LEARN_LESSONS.required) used.add(a);
  const missing = [...used].filter((a) => !(a in DICTIONARY));
  assert.deepEqual(missing, [], 'keys missing from the dictionary');
  const unused = Object.keys(DICTIONARY).filter((a) => !a.startsWith('_') && !used.has(a) && !LEARN_LESSONS.optional.has(a) && !DYNAMIC.some((o) => a.startsWith(o)));
  assert.deepEqual(unused, [], 'unused dictionary keys');
  // every dynamic prefix is really joined in the source
  const allSource = JS_FILES.map(read).join('\n');
  for (const o of DYNAMIC.filter((o) => o !== 'epub.E')) assert.ok(allSource.includes(`'${o}'`), `dynamic prefix not in the source: ${o}`);
  assert.ok(used.size > 300, `${used.size} key found`);
});

test('the Learn lesson keys are generated from the lesson list; the checker catches missing/extra step keys', () => {
  const lesson = read(path.join(APP, 'js', 'learn', 'learn-lessons.js'));
  assert.equal(LEARN_LESSONS.required.size, 10 * 2 + 45 * 3, '10 stages, 45 steps');
  const missingKeys = (k) => [...learnLessonKeys(k).required].filter((a) => !(a in DICTIONARY));
  assert.deepEqual(missingKeys(lesson), []);
  // faulty input: a step added without a dictionary entry comes out missing; when a step is removed its keys count as unused
  const newStep = lesson.replace("steps: ['grain', 'impose', 'fold', 'boneFolder', 'press']", "steps: ['grain', 'impose', 'fold', 'boneFolder', 'press', 'fresh']");
  assert.notEqual(newStep, lesson, 'variant could not be applied');
  assert.deepEqual(missingKeys(newStep), ['learn.folding.fresh.title', 'learn.folding.fresh.description', 'learn.folding.fresh.button']);
  const deleted = learnLessonKeys(lesson.replace("'boneFolder', 'press']", "'boneFolder']"));
  assert.ok(!deleted.required.has('learn.folding.press.title') && !deleted.optional.has('learn.folding.press.caution'));
  assert.throws(() => learnLessonKeys(''), 'empty lesson file');
});

test('every dictionary script in index.html is loaded; every app/i18n/*.js is in index.html (no forgotten new language); i18n.js after the dictionaries', () => {
  const html = read(path.join(APP, 'index.html'));
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const dictionary = scripts.filter((b) => b.startsWith('i18n/'));
  assert.deepEqual(dictionary.map((b) => b.slice(5)).sort(), DICTIONARY_FILES);
  const i18nJs = scripts.indexOf('js/i18n.js');
  assert.ok(i18nJs > Math.max(...dictionary.map((b) => scripts.indexOf(b))), 'i18n.js after the dictionaries');
  assert.ok(i18nJs < scripts.indexOf('js/platform.js'), 'i18n.js before platform.js');
});

test('t() is not shadowed: no variable/parameter named t in a file that defines the t function', () => {
  const faulty = (source) => /function t\(/.test(source) && /\b(var|let|const)\s+t\b|function\s*[A-Za-z0-9_$]*\s*\(\s*(?:[^)]*,\s*)?t\s*[,)]/.test(source.replace(/function t\(a, p\)/g, ''));
  const found = JS_FILES.filter((y) => faulty(read(y))).map((y) => path.relative(REPO, y));
  assert.deepEqual(found, []);
  // the checker catches faulty input
  assert.equal(faulty("function t(a, p) {}\nfunction f() { var t = 1; }"), true);
  assert.equal(faulty("function t(a, p) {}\n[].reduce(function (t, k) { return t; })"), true);
  assert.equal(faulty("function t(a, p) {}\nfunction g(x, t) {}"), true);
  assert.equal(faulty("function t(a, p) {}\nvar tk = 1; function g(top) {}"), false);
});

// ---------------------------------------------------------------- fixed Turkish string scan
/**
 * Allowlist: literals with Turkish letters that are NOT interface text (file → part of the literal, reason). The tests
 * (app/test/), the dictionaries (app/i18n/) and vendor are not scanned. In Rust the logs (eprintln!/expect/assert …)
 * and the test module are not scanned (they do not reach the user).
 */
const PERMISSION = [
  ['app/js/plugins/epub/hyphenation.js', 'aeıioöuüâîû', 'Turkish hyphenation rule (PDF content, not interface)'],  // turkish-ok: Turkish test text
  ['app/js/plugins/epub/zip.js', 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ', 'CP437 decoding table (ZIP names)'],  // turkish-ok: Turkish test text
];
function allowed(file, text) {
  return PERMISSION.some(([d, part]) => file === d && text.includes(part));
}
function scan() {
  const finding = [];
  for (const y of JS_FILES) {
    const g = path.relative(REPO, y);
    for (const d of jsStrings(read(y))) if (isTurkish(d.text) && !allowed(g, d.text)) finding.push(`${g}:${d.line}: ${d.text.slice(0, 70)}`);
  }
  for (const y of RUST_FILES) {
    const g = path.relative(REPO, y);
    for (const d of rustStrings(read(y))) if (!d.log && isTurkish(d.text) && !allowed(g, d.text)) finding.push(`${g}:${d.line}: ${d.text.slice(0, 70)}`);
  }
  for (const d of htmlTexts(read(path.join(APP, 'index.html')))) if (isTurkish(d.text)) finding.push(`app/index.html:${d.line}: ${d.text.slice(0, 70)}`);
  return finding;
}

test('scan: no Turkish user string outside the allowlist in app/ and src-tauri/src/', () => {
  assert.deepEqual(scan(), []);
  assert.ok(JS_FILES.length >= 20 && RUST_FILES.length >= 7, `${JS_FILES.length} JS, ${RUST_FILES.length} Rust`);
});

test('the scan and the key use cover the Learn guide (app/js/learn/ subfolders included); a fixed Turkish string added to the guide is a FAIL', () => {
  const learn = JS_FILES.map((y) => path.relative(APP, y)).filter((y) => y.startsWith(path.join('js', 'learn') + path.sep));
  const expected = ['learn-measure.js', 'cf-engine.js', 'cf-page.js', 'learn-lessons.js', 'learn.js', ...fs.readdirSync(path.join(APP, 'js', 'learn', 'figures')).filter((a) => a.endsWith('.js')).map((a) => 'figures/' + a)];
  assert.deepEqual(learn.map((y) => y.slice(9).split(path.sep).join('/')).sort(), expected.sort());
  assert.equal(expected.length, 14, '5 guide files + 9 figure files');
  // faulty input: broken copies of the real guide files (with Turkish letters, ASCII Turkish, a figure label)
  const find = (k) => jsStrings(k).filter((d) => isTurkish(d.text)).map((d) => d.text);
  const learnJs = read(path.join(APP, 'js', 'learn', 'learn.js'));
  const bookJs = read(path.join(APP, 'js', 'learn', 'figures', 'book.js'));
  assert.deepEqual(find(learnJs), []);
  assert.deepEqual(find(bookJs), []);
  assert.deepEqual(find(learnJs.replace("t('learn.stop')", "'Durdur ve başa dön'")), ['Durdur ve başa dön']);  // turkish-ok: Turkish test text
  assert.deepEqual(find(learnJs.replace("t('learn.stop')", "'Oynatma durduruldu'")), ['Oynatma durduruldu']);  // turkish-ok: Turkish test text
  assert.deepEqual(find(bookJs.replace("t('learn.s.book.cover2')", "'KITABI AC VE CEVIR'")), ['KITABI AC VE CEVIR']);  // turkish-ok: Turkish test text
});

test('scan: every allowlist entry really exists (no stale allowance)', () => {
  for (const [d, part] of PERMISSION) {
    const s = d.endsWith('.rs') ? rustStrings(read(path.join(REPO, d))) : jsStrings(read(path.join(REPO, d)));
    assert.ok(s.some((x) => x.text.includes(part)), `${d}: ${part}`);
  }
});

test('the scan catches faulty/hard input: quote kinds, template, escape, regex, comment; Rust log/test/raw string; HTML', () => {
  const js = (k) => jsStrings(k).filter((d) => isTurkish(d.text)).map((d) => d.text);
  assert.deepEqual(js("var a = 'Kitap oluşturuldu';"), ['Kitap oluşturuldu']);  // turkish-ok: Turkish test text
  assert.deepEqual(js('f("Çıktı")'), ['Çıktı']);  // turkish-ok: Turkish test text
  const template = js('x = `${n} sayfa ${"ğ"} yüz`');  // turkish-ok: Turkish test text
  assert.ok(template.includes('ğ') && template.some((m) => m.includes('yüz')), 'a string inside a template and the template text: ' + JSON.stringify(template));  // turkish-ok: expected Turkish UI text
  assert.ok(js('x = `${n} yüz`').length === 1, 'template text');  // turkish-ok: Turkish test text
  assert.deepEqual(js("y = 'it\\'s ş'"), ["it's ş"], 'escaped quote');  // turkish-ok: Turkish test text
  assert.deepEqual(js("if (/'/.test(a)) b = 'ş';"), ['ş'], 'a regex with a quote does not break the string');  // turkish-ok: Turkish test text
  assert.deepEqual(js("var r = /[çğ]/g; var s = a / b; c = 'ö';"), ['ö'], 'regex skipped, division is not a regex');  // turkish-ok: Turkish test text
  assert.deepEqual(js('// yorum: ç\n/* çok satırlı\nş */ var x = 1;'), [], 'comments skipped');  // turkish-ok: Turkish test text
  assert.deepEqual(js("return /ş/.test(x) ? 'a' : 'ı';"), ['ı'], 'regex after return');  // turkish-ok: Turkish test text
  assert.deepEqual(js("t('Forma sayisi yok')"), ['Forma sayisi yok'], 'Turkish sentence without Turkish letters (word heuristic)');  // turkish-ok: Turkish test text
  assert.deepEqual(js("t('menu.file'); x('system-ui, sans-serif'); y(' · ')"), [], 'key and technical string are not Turkish');
  const line = jsStrings("a\n\n  'ş'");  // turkish-ok: Turkish test text
  assert.equal(line[0].line, 3, 'line number');

  const rs = (k) => rustStrings(k).filter((d) => !d.log && isTurkish(d.text)).map((d) => d.text);
  assert.deepEqual(rs('fn f() -> String { format!("dosya çok büyük ({} MB)", 3) }'), ['dosya çok büyük ({} MB)']);  // turkish-ok: Turkish test text
  assert.deepEqual(rs('fn f() { eprintln!("yazılamadı: {e}"); x.lock().expect("kilidi ş"); assert!(a, "ğ"); }'), [], 'log/expect/assert');  // turkish-ok: Turkish test text
  assert.deepEqual(rs('fn f() { eprintln!("{}", format!("ş")); }'), [], 'format! inside a log');  // turkish-ok: Turkish test text
  assert.deepEqual(rs('const A: &str = r#"ham "ç" dizgi"#;'), ['ham "ç" dizgi'], 'raw string');  // turkish-ok: Turkish test text
  assert.deepEqual(rs("fn f<'a>(x: &'a str) -> char { 'ş' }"), ['ş'], 'lifetime and char literal');  // turkish-ok: Turkish test text
  assert.deepEqual(rs('// yorum ç\n/* iç /* içe */ ş */ fn f() {}'), [], 'nested comment');  // turkish-ok: Turkish test text
  assert.deepEqual(rs('fn a() { b("ç") }\n#[cfg(test)]\nmod tests { fn t() { x("ş") } }'), ['ç'], 'the test module is not scanned');  // turkish-ok: Turkish test text
  assert.deepEqual(rs('#[cfg(test)]\npub fn helper() {}\nfn a() { b("ç") }'), ['ç'], 'a cfg(test) function is not a test module');  // turkish-ok: Turkish test text
  assert.deepEqual(rs('fn a() { b("kaç\\"ış") }'), ['kaç"ış'], 'escaped quote');  // turkish-ok: Turkish test text

  const ht = (k) => htmlTexts(k).filter((d) => isTurkish(d.text)).map((d) => d.text);
  assert.deepEqual(ht('<p>Düzenle</p>'), ['Düzenle']);  // turkish-ok: Turkish test text
  assert.deepEqual(ht('<button title="Çevir" data-i18n="a.b">⇄</button>'), ['Çevir']);  // turkish-ok: Turkish test text
  assert.deepEqual(ht('<input placeholder="ör. 1-4">'), ['ör. 1-4']);  // turkish-ok: Turkish test text
  assert.deepEqual(ht('<!-- yorum ğ --><script>var a = "ş";</script><span data-i18n="ö"></span>'), [], 'comment, script, key');  // turkish-ok: Turkish test text
  assert.deepEqual(ht('<p data-i18n="x"></p>\n<p>Sayfa yok</p>'), ['Sayfa yok'], 'a Turkish text node without Turkish letters');  // turkish-ok: Turkish test text
  // scan(): a fixed Turkish string added to a file is a FAIL (on a broken copy of the real file)
  const copy = read(path.join(APP, 'js', 'projects.js')).replace("t('projects.deleted')", "'Bütün süreç verisi silindi.'");  // turkish-ok: Turkish test text
  assert.ok(jsStrings(copy).some((d) => isTurkish(d.text) && d.text.startsWith('Bütün')), 'a fixed string added back is caught');  // turkish-ok: expected Turkish UI text
});

// ---------------------------------------------------------------- old (earlier) records
const OLD = path.join(__dirname, 'fixtures', 'legacy');

test('old Turkish records: the legacy localStorage / Mac app backup data is valid; template steps in the current language, the user step as it is', () => {
  const M = require('../js/project-model.js');
  for (const name of ['local-storage-v1.json', 'projects-v1.json']) {
    const Migrate = require('../js/migrate.js');
    const legacy = JSON.parse(read(path.join(OLD, name)));
    assert.ok(Migrate.isLegacyProjects(legacy), `${name}: legacy format`);
    const data = Migrate.projects(legacy);
    assert.equal(M.validate(data), true, name);
    const k = data.projects[0];
    assert.ok(k.steps.every((a) => a.template === undefined), `${name}: no template key in the old record`);
    const previous = I18n.code();
    try {
      I18n.set('en');
      const names = k.steps.map(M.stepName);
      assert.equal(names[0], 'Prep / PDF', name);
      assert.equal(names[6], 'Sewing', name);
      assert.ok(names.includes('Ayraç takma'), `${name}: the step the user added as it is: ${names}`);  // turkish-ok: expected Turkish UI text
      assert.equal(M.kindName(k.bindingType), 'Sewn signatures + hardcover (case binding)');
      I18n.set('tr');
      assert.deepEqual(k.steps.map(M.stepName), k.steps.map((a) => a.name), `${name}: today's names in Turkish`);
    } finally { I18n.set(previous); }
    assert.deepEqual(Migrate.projects(data), data, 'conversion is idempotent');
  }
});

test('new project: the step template key + the name in the language it was created in; the shown name changes with the language; JSON compatible with the old version', () => {
  const M = require('../js/project-model.js');
  const previous = I18n.code();
  try {
    I18n.set('en');
    const k = M.newProject({ name: 'Notebook', bindingType: 'sewn' });
    assert.equal(k.steps[6].template, 'sewing');
    assert.equal(k.steps[6].name, 'Sewing');
    I18n.set('tr');
    assert.equal(M.stepName(k.steps[6]), 'Dikiş');  // turkish-ok: expected Turkish UI text
    assert.equal(M.validate(JSON.parse(JSON.stringify({ version: 2, projects: [k] }))), true);
    const corrupt = JSON.parse(JSON.stringify({ version: 2, projects: [k] }));
    corrupt.projects[0].steps[0].template = 5;
    assert.throws(() => M.validate(corrupt), /şablon anahtarı metin olmalı/);  // turkish-ok: expected Turkish UI text
    const unknown = { ...k.steps[0], template: 'none_such', name: 'By hand' };
    assert.equal(M.stepName(unknown), 'By hand', 'unknown template key: the saved name');
  } finally { I18n.set(previous); }
});

// ---------------------------------------------------------------- fixes
const VECTOR = JSON.parse(read(path.join(__dirname, 'fixtures', 'i18n-vectors.json')));

test('Apple language rule (JS): shared vectors (Rust i18n.rs tests the same file); the first supported language in the preference list', () => {
  const D = fresh('en');
  assert.ok(VECTOR.system_language.length >= 5);
  for (const v of VECTOR.system_language) assert.equal(D.systemLanguage(v.list), v.expected, JSON.stringify(v.list));
  // minimum vectors in the file (the test stays if they are removed)
  const key = (l) => JSON.stringify(l);
  const minimum = { '["tr-TR"]': 'tr', '["de-DE","tr-TR"]': 'tr', '["de-DE","fr-FR"]': 'en', '["en-GB","tr"]': 'en', '[]': 'en' };
  for (const [l, b] of Object.entries(minimum)) assert.ok(VECTOR.system_language.some((v) => key(v.list) === l && v.expected === b), `minimum vector missing: ${l}`);
});

test('param fill single pass (JS): shared vectors (Rust gives the same result); a {x} inside a value is not filled', () => {
  for (const v of VECTOR.fill) {
    const D = fresh(v.i18n);
    assert.equal(D.t(v.key, Object.fromEntries(v.p)), v.expected, JSON.stringify(v.p));
  }
});

test('apply: when no dictionary has the key, the current (static) text of the element is not overwritten with the key', () => {
  const D = fresh('en');
  const element = (a, text) => ({ a, textContent: text, attrs: {}, getAttribute(k) { return this.a[k]; }, setAttribute(k, v) { this.attrs[k] = v; } });
  const m = element({ 'data-i18n': 'none.such.key' }, 'Static');
  const b = element({ 'data-i18n': 'none.such.key' }, '');
  const o = element({ 'data-i18n-attr': 'title:none.such.key', title: 'Static title' }, '');
  D.apply({ querySelectorAll: (s) => (s === '[data-i18n]' ? [m, b] : s === '[data-i18n-attr]' ? [o] : []) });
  assert.equal(m.textContent, 'Static');
  assert.equal(b.textContent, 'none.such.key', 'the key when there is no static text (the gap shows)');
  assert.equal(o.attrs.title, undefined, 'the static attribute was not overwritten');
  assert.ok(D.missingKeys().includes('none.such.key'), 'still recorded as missing');
});

// English text unity: en-US spelling, one form of negation (contraction), no inner path.
const BRITISH = /\b(centre[sd]?|centring|cancell(?:ed|ing|ation)|colou?rs?\b(?<=colours?)|colour(?:ed|ful|ing)?|behaviours?|favou?r(?<=favour)(?:s|ed|ite|ites)?|honours?|labours?|licence|organis(?:e|ed|es|ing|ation)|recognis(?:e|ed|es|ing)|customis(?:e|ed|es|ing)|initialis(?:e|ed|es|ing)|normalis(?:e|ed|es|ing)|optimis(?:e|ed|es|ing)|minimis(?:e|ed|es|ing)|maximis(?:e|ed|es|ing)|summaris(?:e|ed|es|ing)|prioritis(?:e|ed|es|ing)|utilis(?:e|ed|es|ing)|analys(?:e|ed|es|ing)|catalogue|fibres?|metres?|millimetres?|centimetres?|litres?|programmes?|travell(?:ed|ing|er)|labell(?:ed|ing)|modell(?:ed|ing)|judgement|grey|aluminium|enrol(?:s|ment)?|fulfil(?:s|ment)?|whilst|amongst|learnt|spelt|realis(?:e|ed|es|ing))\b/i;
const LONG_NEGATIVE = /\b(can ?not|could not|does not|did not|do not|is not|are not|was not|were not|will not|would not|should not|has not|have not|had not|must not)\b/i;
const INNER_PATH = /\b(?:docs|app|src-tauri|tools|vendor|src|node_modules)\/|\.(?:md|rs|mjs|cjs)\b/;
function texts(s) {
  return Object.entries(s).filter(([a]) => !a.startsWith('_')).flatMap(([a, d]) => (typeof d === 'string' ? [[a, d]] : Object.entries(d).map(([k, v]) => [a + '.' + k, v])));
}
const faulty = (s, re) => texts(s).filter(([, m]) => re.test(m)).map(([a, m]) => `${a}: ${m}`);

test('the en dictionary in en-US spelling: no British spelling left (centre, cancelled, colour, behaviour …)', () => {
  assert.deepEqual(faulty(DICTIONARY, BRITISH), []);
});

test('one form of negation in the en dictionary: contractions (can\'t, couldn\'t, doesn\'t, isn\'t …); no "could not / cannot"', () => {
  assert.deepEqual(faulty(DICTIONARY, LONG_NEGATIVE), []);
  assert.ok(texts(DICTIONARY).filter(([, m]) => /n't\b/.test(m)).length >= 20, 'the contractions are really used');
});

test('no inner repository path in user text (docs/, app/vendor/, .md …) — en and tr', () => {
  for (const code of Object.keys(ACTUAL)) assert.deepEqual(faulty(I18n.extractJson(ACTUAL[code]), INNER_PATH), [], code);
});

test('the text unity checkers catch faulty input and pass the right form', () => {
  const capture = ['Bottom centre', 'centred text', 'The dialog was cancelled.', 'Cancelling…', 'Colour', 'colours', 'odd behaviour', 'Licence', 'Organise files', 'initialised',
    'analyse', '5 millimetres', 'labelled', 'grey', 'Travelling', 'whilst', 'a favourite', 'Paper fibres', 'fibre'];
  const pass = ['Bottom center', 'The dialog was canceled.', 'Canceling…', 'Color', 'behavior', 'License', 'Organize', 'concentrate', 'centered', 'precise',
    'otherwise', 'promise', 'licensed', 'Analyze', 'program', 'canceled', 'flavor', 'cancel'];
  for (const m of capture) assert.ok(BRITISH.test(m), `British spelling missed: ${m}`);
  for (const m of pass) assert.ok(!BRITISH.test(m), `false alarm: ${m}`);
  for (const m of ['could not be opened', 'Cannot open', 'can not', 'It is not valid', 'does not match', 'did not grant', "Don't", 'Do not use', 'will not work', 'are not'])
    assert.equal(LONG_NEGATIVE.test(m), !/n't/.test(m), m);
  for (const m of ["couldn't be opened", "can't", "isn't valid", 'Not saved (canceled)', 'not connected?', 'Notes', 'cannon']) assert.ok(!LONG_NEGATIVE.test(m), `false alarm: ${m}`);
  for (const m of ['Source: docs/notlar/x.md.', 'files in app/vendor/ may be missing', '(vendor/literata/)', 'see README.md', 'src-tauri/src/i18n.rs']) assert.ok(INNER_PATH.test(m), `inner path missed: ${m}`);
  for (const m of ['META-INF/container.xml', 'e.g. my-book.pdf', 'encryption.xml could not', 'qpdf --decrypt input.pdf output.pdf', 'PDF / EPUB', '1/2 steps', 'mucellit-backup-{date}'])
    assert.ok(!INNER_PATH.test(m), `false alarm: ${m}`);
  // a broken copy of the real dictionary
  const corrupt = { ...DICTIONARY, 'zz.british': 'Page numbers (bottom centre)', 'zz.negative': 'pdf.js could not be loaded', 'zz.path': 'see files in app/vendor/' };
  for (const re of [BRITISH, LONG_NEGATIVE, INNER_PATH]) assert.equal(faulty(corrupt, re).length, faulty(DICTIONARY, re).length + 1, String(re).slice(0, 30));
});

// Turkish sentence heuristic without Turkish letters (ASCII) (widened from 26 words + common suffixes).
const ASCII_TURKISH = ['Lutfen tekrar deneyin', 'Gecersiz deger girildi', 'Ayarlar kaydedilemedi', 'Yedek alinamadi', 'Sirt kalinligi hesaplanamadi',  // turkish-ok: Turkish test text
  'Baski onizlemesi hazirlaniyor', 'Islem tamamlandi', 'Uyari: mukavva cok kalin', 'Tum kitaplar silinsin mi?', 'Adimlari sifirla', 'Secili sayfalari dondur',  // turkish-ok: Turkish test text
  'Cikti uretilemedi', 'Iptal edildi', 'Kapak olcusu hesaplandi', 'Bu ayar degistirilemez', 'Dosya acilamadi', 'Forma sayisi yok', 'Kitap olusturuldu'];  // turkish-ok: Turkish test text

test('scan heuristic: ASCII Turkish sentences are caught; the English dictionary, the static HTML and technical strings give no false alarm', () => {
  const escaping = ASCII_TURKISH.filter((m) => !isTurkish(m));
  assert.deepEqual(escaping, [], 'ASCII Turkish not caught');
  const wrong = texts(DICTIONARY).filter(([, m]) => isTurkish(m)).map(([a, m]) => `${a}: ${m}`);
  assert.deepEqual(wrong, [], 'English text taken for Turkish');
  for (const m of ['system-ui, sans-serif', 'application/epub+zip', 'Mücellit', 'once more', 'Load a PDF once', 'Style guide', 'Somali', 'major update', 'hidden files', 'Sweden'])
    assert.equal(isTurkish(m), false, `false alarm: ${m}`);
  assert.equal(isTurkish('Kaydet'), false, 'a single word (no space) is not counted on purpose: there are many Turkish identifiers in the source (a known limit)');  // turkish-ok: Turkish test text
});

test('scan heuristic limits: a CSS class/id and an UPPER CASE machine code are not Turkish; real Turkish inside them is', () => {
  for (const m of ['.surukleniyor, .hedef', '#kitap-listesi li', 'NOTFOUND: {m}', 'INVALID: {m}', 'NODISK: {name}', 'kc-yedek-isleri calisiyor-x']) assert.equal(isTurkish(m), false, m);  // turkish-ok: Turkish test text
  for (const m of ['NOTFOUND: dosya silinmis', 'Hata: kayit silinemedi', 'DIKKAT tum veriler silinsin mi?']) assert.equal(isTurkish(m), true, m);  // turkish-ok: Turkish test text
});

// ----------------------------------------------------------------
test('tr tauri.storage_hint "(otomatik yedeklenir)" (passive; not the imperative "(otomatik yedekle)")', () => {  // turkish-ok: expected Turkish UI text
  const tr = I18n.extractJson(read(path.join(FOLDER, 'tr.js')));
  assert.match(tr['tauri.storage_hint'], /\(otomatik yedeklenir\)/);  // turkish-ok: expected Turkish UI text
  assert.doesNotMatch(tr['tauri.storage_hint'], /\(otomatik yedekle\)/);  // turkish-ok: expected Turkish UI text
});

// ----------------------------------------------------------------
test('Turkish text all in UPPER CASE (ASCII) is caught; a machine code only with a "CODE:" prefix does not count', () => {
  const capture = ['DOSYA ACILAMADI', 'TUM VERILER SILINSIN MI?', 'KAYDEDILEMEDI, LUTFEN TEKRAR DENEYIN', 'UYARI: SAYFA BOS',  // turkish-ok: Turkish test text
    'ISLEM IPTAL EDILDI', 'NOTFOUND DOSYA SILINMIS', 'KITAP OLUSTURULDU', 'Dikkat: TUM KITAPLAR SILINECEK'];  // turkish-ok: Turkish test text
  for (const m of capture) assert.equal(isTurkish(m), true, `missed: ${m}`);
  // machine code (a Rust → JS error prefix; turned into text by language in JS) and technical upper case strings
  const pass = ['NOTFOUND: {m}', 'INVALID: {m}', 'NODISK: {name}', 'UNKNOWN: {}', 'ACCESS: {path}', 'TRANSIENT: {error}', 'META-INF/container.xml',
    'OUT_DIR', 'CARGO_MANIFEST_DIR', 'EPUB → PDF', 'PDF EPUB JSON', 'UTF-8 BOM', 'DOMContentLoaded', 'HOME'];
  for (const m of pass) assert.equal(isTurkish(m), false, `false alarm: ${m}`);
});

// ---------------------------------------------------------------- decimal separator by interface language
test('number field format by language (en point, tr comma), no thousands separator; empty/invalid → ""', () => {
  const once = I18n.code();
  try {
    I18n.set('en');
    assert.deepEqual([0.1, 1234.5, 297, 0, -2.5, 0.1234567, NaN, Infinity, '0.25', null].map((n) => I18n.numberField(n)), ['0.1', '1234.5', '297', '0', '-2.5', '0.123457', '', '', '0.25', '']);
    I18n.set('tr');
    assert.deepEqual([0.1, 1234.5, 297, 215.9].map((n) => I18n.numberField(n)), ['0,1', '1234,5', '297', '215,9']);
    assert.equal(I18n.number(10.4), '10,4', 'result table (the current number) tr comma');
    I18n.set('en');
    assert.equal(I18n.number(10.4), '10.4');
  } finally { I18n.set(once); }
});

test('a number input is read with both separators (common.parseNumber / number)', () => {
  const ctx = { document: { getElementById: (id) => ({ value: { a: '0,5', b: '0.5', c: ' 12 ', d: '', e: 'abc' }[id] }) } };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(path.join(APP, 'js', 'common.js')), ctx);
  const O = ctx.Mucellit.common;
  assert.deepEqual(['0,5', '0.5', ' 12 ', '1,25', '-3,5'].map((s) => O.parseNumber(s)), [0.5, 0.5, 12, 1.25, -3.5]);
  assert.ok(['', 'abc', null, undefined, ','].every((s) => Number.isNaN(O.parseNumber(s))));
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((id) => O.number(id, -1)), [0.5, 0.5, 12, -1, -1]);
});

test('number fields are not type=number (WebKit formatted them with the system region); data-number + inputmode="decimal"', () => {
  const html = read(path.join(APP, 'index.html'));
  const numberFields = (h) => [...h.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((e) => /\sdata-number\b/.test(e) || /type="number"/.test(e));
  const errors = (h) => {
    const l = numberFields(h);
    const e = l.filter((x) => /type="number"/.test(x) || !/\sdata-number\b/.test(x) || !/inputmode="decimal"/.test(x) || !/type="text"/.test(x));
    return l.length >= 20 ? e : ['number field count ' + l.length].concat(e);
  };
  assert.deepEqual(errors(html), []);
  // the checker catches faulty input
  const first = numberFields(html)[0];
  assert.ok(errors(html.replace(first, first.replace('type="text"', 'type="number"'))).length > 0, 'type=number');
  assert.ok(errors(html.replace(first, first.replace(' inputmode="decimal"', ''))).length > 0, 'no inputmode');
  assert.ok(errors('<input type="text" data-number inputmode="decimal">').length > 0, 'skeleton (az field)');
  // dynamic fields (Projects detail, EPUB settings) are text + data-number too
  for (const d of ['projects.js', path.join('plugins', 'epub.js')]) {
    const k = read(path.join(APP, 'js', d));
    assert.doesNotMatch(k, /type: 'number'|'number'\)/, d);
    assert.match(k, /'data-number'/, d);
  }
});

// ---------------------------------------------------------------- full screen menu name
// The full screen item in the View menu is AppKit's toggleFullScreen: item (muda PredefinedMenuItem::fullscreen). AppKit
// changes its title with its own translation when the menu is validated (when it opens): "Enter Full Screen"/"Exit Full Screen"
// (tr: "Tam Ekrana Geç"/"Tam Ekrandan Çık"; observed: report). The dictionary must be AppKit's text so that the menu  // turkish-ok: expected Turkish UI text
// shows the same name before and after validation.
test('menu.full_screen in both languages is AppKit\'s own text ("Enter Full Screen" ↔ "Tam Ekrana Geç")', () => {  // turkish-ok: expected Turkish UI text
  const en = I18n.extractJson(read(path.join(FOLDER, 'en.js'))), tr = I18n.extractJson(read(path.join(FOLDER, 'tr.js')));
  assert.deepEqual([en['menu.full_screen'], tr['menu.full_screen']], ['Enter Full Screen', 'Tam Ekrana Geç']);  // turkish-ok: expected Turkish UI text
  const loctable = '/System/Library/Frameworks/AppKit.framework/Resources/MenuCommands.loctable';
  if (process.platform === 'darwin' && fs.existsSync(loctable)) {
    const j = JSON.parse(require('node:child_process').execFileSync('plutil', ['-convert', 'json', '-o', '-', loctable]).toString());
    assert.deepEqual([j.en['Enter Full Screen'], j.tr['Enter Full Screen']], [en['menu.full_screen'], tr['menu.full_screen']], 'AppKit MenuCommands.loctable');
  }
});
