'use strict';
// The interface is not left empty at start-up.
//   1. The static labels are filled in the chosen/default language as soon as i18n.js loads; even when platform.ready is rejected.
//   2. When i18n.js or a dictionary throws (cannot load) the static English text of index.html shows
//      (the text in index.html is exactly the en dictionary; tools/i18n-html.mjs writes it, this test checks it).
// The data-i18n / data-i18n-attr elements of index.html are taken into a small fake DOM; the dictionaries, i18n.js and app.js
// run in a vm context in the browser's order.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DICTIONARY_FILES, FOLDER } = require('./i18n-helper.js');

const APP = path.join(__dirname, '..');
const read = (y) => fs.readFileSync(y, 'utf8');
const HTML = read(path.join(APP, 'index.html'));
const EN = require('../js/i18n.js').extractJson(read(path.join(FOLDER, 'en.js')));

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeHtml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (tam, v) => {
    if (v[0] === '#') return String.fromCodePoint(v[1] === 'x' || v[1] === 'X' ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(ENTITY, v) ? ENTITY[v] : tam;
  });
}

/**
 * The tags in the HTML with data-i18n / data-i18n-attr: { label, attrs: { attribute: value }, inner: the text up to the
 * closing tag (only for data-i18n; null when there is a nested element) }. Comments and <script> are skipped.
 */
function i18nItems(html) {
  const clean = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const l = [];
  const label = /<([a-z][a-z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let m;
  while ((m = label.exec(clean)) !== null) {
    if (!/\sdata-i18n(-attr)?\s*=/.test(m[2])) continue;
    const attrs = {};
    for (const o of m[2].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      attrs[o[1]] = decodeHtml(o[2] !== undefined ? o[2] : o[3] !== undefined ? o[3] : o[4] !== undefined ? o[4] : '');
    }
    let inner = null;
    if ('data-i18n' in attrs) {
      const exit = new RegExp('</' + m[1] + '\\s*>', 'i');
      const rest = clean.slice(m.index + m[0].length);
      const k = exit.exec(rest);
      const raw = k ? rest.slice(0, k.index) : '';
      inner = /</.test(raw) ? null : decodeHtml(raw);
    }
    l.push({ label: m[1].toLowerCase(), attrs, inner });
  }
  return l;
}

/** Differences of the static text in index.html from the en dictionary (empty array = the same). */
function staticDifferences(html, en) {
  const difference = [];
  const elements = i18nItems(html);
  if (!elements.length) return ['no data-i18n element'];
  for (const o of elements) {
    if ('data-i18n' in o.attrs) {
      const a = o.attrs['data-i18n'];
      if (typeof en[a] !== 'string') difference.push(`${a}: not plain text in the en dictionary`);
      else if (o.inner === null) difference.push(`${a}: there is another element inside (textContent would overwrite it)`);
      else if (o.inner !== en[a]) difference.push(`${a}: "${o.inner}" ≠ "${en[a]}"`);
    }
    if ('data-i18n-attr' in o.attrs) {
      for (const pair of o.attrs['data-i18n-attr'].split(';')) {
        const b = pair.indexOf(':');
        if (b <= 0) continue;
        const name = pair.slice(0, b).trim(), a = pair.slice(b + 1).trim();
        if (typeof en[a] !== 'string') difference.push(`${name}:${a}: not plain text in the en dictionary`);
        else if (o.attrs[name] !== en[a]) difference.push(`${name}:${a}: "${o.attrs[name]}" ≠ "${en[a]}"`);
      }
    }
  }
  return difference;
}

test('the static text of index.html is the en dictionary: the interface has English text even when i18n.js does not run (tools/i18n-html.mjs)', () => {
  assert.deepEqual(staticDifferences(HTML, EN), []);
  const n = i18nItems(HTML).length;
  assert.ok(n >= 100, `${n} elements`);
  assert.match(HTML, /<html lang="en">/, 'static text in English: html lang en');
});

test('the static text checker catches faulty HTML (empty, different, nested, missing attribute, skeleton, copy)', () => {
  const first = /<button role="tab" id="tab-button-impose"[^>]*>[^<]*<\/button>/.exec(HTML)[0];
  const states = {
    'empty text': HTML.replace(first, first.replace(/>[^<]*</, '><')),
    'different text': HTML.replace(first, first.replace(/>[^<]*</, '>Imposition (changed)<')),
    'text with spaces': HTML.replace(first, first.replace(/>([^<]*)</, '> $1 <')),
    'nested element': HTML.replace(first, first.replace(/>[^<]*</, '><b>Imposition</b><')),
    'missing attribute': HTML.replace(/(<select id="i18n-select")\s+aria-label="[^"]*"/, '$1'),
    'wrong attribute': HTML.replace(/(<select id="i18n-select") aria-label="[^"]*"/, '$1 aria-label="I18n"'),
    'skeleton (no element)': '<!doctype html><html lang="en"><body></body></html>',
    'copy (Turkish dictionary text)': (() => {
      const TR = require('../js/i18n.js').extractJson(read(path.join(FOLDER, 'tr.js')));
      return HTML.replace(/(data-i18n="([^"]+)"[^>]*>)[^<]*</g, (t, head, a) => head + (TR[a] || '') + '<');
    })(),
  };
  for (const [name, h] of Object.entries(states)) {
    assert.notEqual(h, HTML, `${name}: corruption could not be applied (the test itself)`);
    assert.ok(staticDifferences(h, EN).length > 0, `${name}: not caught`);
  }
  assert.deepEqual(staticDifferences(HTML, EN), [], 'the real file is clean');
  assert.equal(decodeHtml('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#x27; &unknown;'), 'a & b <c> "d" \'e\' &unknown;');
});

// ---------------------------------------------------------------- start-up with a fake DOM
function fakeDocument() {
  const elements = i18nItems(HTML).map((o) => ({
    ...o, textContent: o.inner === null ? '' : o.inner, attribute: { ...o.attrs },
    getAttribute(a) { return Object.prototype.hasOwnProperty.call(this.attribute, a) ? this.attribute[a] : null; },
    setAttribute(a, v) { this.attribute[a] = String(v); },
  }));
  const listener = {};
  const rootElement = { attribute: { lang: 'en' }, setAttribute(a, v) { this.attribute[a] = String(v); }, getAttribute(a) { return this.attribute[a]; } };
  const blank = {};
  const document = {
    readyState: 'loading',
    title: 'Mücellit',
    documentElement: rootElement,
    querySelectorAll(s) {
      if (s === '[data-i18n]') return elements.filter((o) => o.getAttribute('data-i18n') !== null);
      if (s === '[data-i18n-attr]') return elements.filter((o) => o.getAttribute('data-i18n-attr') !== null);
      return [];
    },
    getElementById(id) { return elements.find((o) => o.getAttribute('id') === id) || (blank[id] = blank[id] || { id, attribute: {}, setAttribute(a, v) { this.attribute[a] = v; }, getAttribute(a) { return this.attribute[a]; } }); },
    addEventListener(name, f) { (listener[name] = listener[name] || []).push(f); },
  };
  return { document, elements, listener, load() { document.readyState = 'interactive'; (listener.DOMContentLoaded || []).forEach((f) => f()); } };
}

/**
 * In the browser's order: dictionaries (replaceable with dictionaryText), i18n.js (with i18nText), app.js. ready:
 * Mucellit.platform.ready. A script error (as on the page) is caught and the next script runs.
 */
function open({ languages = ['tr-TR'], ready = Promise.resolve(), dictionaryText = {}, i18nText, outer, choice } = {}) {
  const b = fakeDocument();
  const notices = [];
  const errors = [];
  const ctx = { navigator: { languages: languages }, document: b.document, console: { error: (...a) => errors.push(a.join(' ')) } };
  if (outer !== undefined) ctx.__MC_LANG__ = outer; // Tauri's initialization_script (Rust i18n::init_script_for)
  if (choice !== undefined) ctx.localStorage = { getItem: (a) => (a === 'mucellit.language' ? choice : null), setItem() {}, removeItem() {} };
  ctx.self = ctx;
  vm.createContext(ctx);
  const run = (code, name) => { try { vm.runInContext(code, ctx, { filename: name }); } catch (e) { errors.push(`${name}: ${e.message}`); } };
  for (const a of DICTIONARY_FILES) run(a in dictionaryText ? dictionaryText[a] : read(path.join(FOLDER, a)), 'i18n/' + a);
  run(i18nText !== undefined ? i18nText : read(path.join(APP, 'js', 'i18n.js')), 'js/i18n.js');
  const MC = ctx.Mucellit = ctx.Mucellit || {};
  MC.common = { $: (id) => b.document.getElementById(id), notify: (m, t) => notices.push([m, t]), writeLocal() {}, readLocal: () => null, el: () => ({}) };
  MC.platform = { ready, text: { libraryHint: 'hint' }, ask: () => Promise.resolve(true) };
  MC.projects = { start() {} }; MC.impose = { start() {} }; MC.calculator = { start() {} };
  ctx.PDFLib = {}; ctx.pdfjsLib = {};
  run(read(path.join(APP, 'js', 'app.js')), 'js/app.js');
  return { ...b, ctx, notices, errors };
}
const wait = () => new Promise((r) => setImmediate(r));
const TR = require('../js/i18n.js').extractJson(read(path.join(FOLDER, 'tr.js')));

function labels(elements) {
  return elements.filter((o) => o.getAttribute('data-i18n') !== null).map((o) => [o.getAttribute('data-i18n'), o.textContent]);
}

test('start-up: even when platform.ready is rejected the static labels are in the chosen language as soon as i18n.js loads (tr-TR → Turkish)', async () => {
  const s = open({ languages: ['tr-TR'], ready: Promise.reject(new Error('no bridge')) });
  // even before DOMContentLoaded (the scripts are at the end of the body: the elements are parsed)
  const once = labels(s.elements).filter(([a, m]) => m !== TR[a]);
  assert.deepEqual(once.slice(0, 5), [], `${once.length} labels not in Turkish`);
  s.load();
  await wait();
  const l = labels(s.elements);
  assert.ok(l.length >= 100);
  assert.deepEqual(l.filter(([a, m]) => !m || m !== TR[a]).slice(0, 5), [], 'every label is filled and in Turkish');
  const i18n = s.elements.find((o) => o.getAttribute('id') === 'i18n-select');
  assert.equal(i18n.attribute['aria-label'], 'Dil');  // turkish-ok: expected Turkish UI text
  assert.equal(s.document.documentElement.attribute.lang, 'tr');
  assert.deepEqual(s.notices, [['Uygulama başlatılamadı: no bridge', 'error']]);  // turkish-ok: expected Turkish UI text
  assert.deepEqual(s.errors, []);
});

test('start-up: in an en-US browser the labels are in English; applied again when ready (like the Tauri sync)', async () => {
  let parse;
  const s = open({ languages: ['en-US'], ready: new Promise((r) => { parse = r; }) });
  assert.deepEqual(labels(s.elements).filter(([a, m]) => m !== EN[a]).slice(0, 3), []);
  // the language changed before ready (Tauri: read_language brought "tr" from the Rust backup) → start applies it again
  s.ctx.Mucellit.i18n.set('tr');
  s.load();
  parse();
  await wait();
  assert.deepEqual(labels(s.elements).filter(([a, m]) => m !== TR[a]).slice(0, 3), []);
});

test('start-up: when the tr dictionary is broken i18n.js still runs, a tr-TR user sees English (not empty)', async () => {
  for (const corrupt of ['(self.MucellitDictionaries = (self.MucellitDictionaries || []).concat([{ "_name": "Turkish" }]));', 'self.MucellitDictionaries = (self.MucellitDictionaries || []).concat([null, 5, "x"]);']) {
    const s = open({ languages: ['tr-TR'], dictionaryText: { 'tr.js': corrupt } });
    s.load();
    await wait();
    assert.equal(s.ctx.Mucellit.i18n && s.ctx.Mucellit.i18n.code(), 'en', corrupt);
    assert.deepEqual(labels(s.elements).filter(([a, m]) => m !== EN[a]).slice(0, 3), [], corrupt);
    assert.deepEqual(s.notices, [], 'start-up goes on');
  }
});

test('start-up: when i18n.js throws the static English text stays in place (no empty interface)', async () => {
  const s = open({ languages: ['tr-TR'], i18nText: 'throw new Error("i18n.js broken");' });
  s.load();
  await wait();
  const l = labels(s.elements);
  assert.ok(l.length >= 100);
  assert.deepEqual(l.filter(([a, m]) => m !== EN[a]).slice(0, 3), [], 'static English');
  assert.ok(s.errors.some((h) => /i18n\.js broken/.test(h)), s.errors.join(' | '));
  // the start-up error is reported (in English) even without the language layer; no unhandled rejection
  assert.equal(s.notices.length, 1, JSON.stringify(s.notices));
  assert.match(s.notices[0][0], /^The app couldn't start: /);
});

test('tools/i18n-html.mjs: reports problems on faulty input, writes the escapes right, changes nothing in an up-to-date file', async () => {
  const { update } = await import('../../tools/i18n-html.mjs');
  const en = { 'a.b': 'A & B <x> "q"', 'c.d': 'Title "1"', 'plural': { one: '1', other: '{n}' } };
  const r = update('<p data-i18n="a.b">old</p><i data-i18n-attr="title:c.d"></i><b title="x" data-i18n-attr="title:c.d"></b>', en);
  assert.deepEqual(r.problem, []);
  assert.equal(r.html, '<p data-i18n="a.b">A &amp; B &lt;x&gt; "q"</p><i title="Title &quot;1&quot;" data-i18n-attr="title:c.d"></i><b title="Title &quot;1&quot;" data-i18n-attr="title:c.d"></b>');
  assert.equal(r.changed, 3);
  assert.deepEqual(staticDifferences(r.html, en), [], 'the independent checker accepts what was written (escape round trip)');
  const second = update(r.html, en);
  assert.equal(second.changed, 0);
  assert.equal(second.html, r.html, 'the second run changes nothing');
  for (const [name, h] of [['nested element', '<p data-i18n="a.b"><b>x</b></p>'], ['plural key', '<p data-i18n="plural"></p>'], ['unknown key', '<p data-i18n="none.x"></p>'],
    ['unknown in an attribute', '<i data-i18n-attr="title:none.x"></i>'], ['not closed', '<p data-i18n="a.b">x']]) {
    assert.ok(update(h, en).problem.length > 0, `${name}: no problem reported`);
  }
  // the real file is up to date (the same as the script with --check)
  const g = update(HTML, EN);
  assert.deepEqual(g.problem, []);
  assert.equal(g.html, HTML, 'index.html up to date: node tools/i18n-html.mjs');
});

// ---------------------------------------------------------------- in Tauri the first frame is in Rust's system language
test('with the Tauri pre-script (__MC_LANG__.system) the first frame is in that language; no switch from navigator.languages', async () => {
  // WKWebView gives navigator.languages one language (en-US), Rust NSLocale + the Apple rule say tr: the labels are Turkish AT ONCE
  const s = open({ languages: ['en-US'], outer: { system: 'tr' }, ready: new Promise(() => {}) });
  assert.equal(s.ctx.Mucellit.i18n.code(), 'tr', 'as soon as i18n.js loads (without waiting for platform.ready)');
  const difference = labels(s.elements).filter(([a, m]) => m !== TR[a]);
  assert.deepEqual(difference.slice(0, 3), [], `${difference.length} labels not in Turkish`);
  assert.equal(s.ctx.Mucellit.i18n.systemCode(), 'tr');
  // the other way round: browser tr-TR, Rust en
  const e = open({ languages: ['tr-TR'], outer: { system: 'en' }, ready: new Promise(() => {}) });
  assert.equal(e.ctx.Mucellit.i18n.code(), 'en');
  assert.deepEqual(labels(e.elements).filter(([a, m]) => m !== EN[a]).slice(0, 3), []);
  assert.deepEqual([s.errors, e.errors], [[], []]);
});

test('a broken/unsupported __MC_LANG__ is ignored (the browser language stays); a manual choice still comes first', () => {
  for (const outer of [null, 'tr', 42, {}, { system: 'xx' }, { system: 'TR' }, { system: '' }, { system: { toString: () => 'tr' } }]) {
    const s = open({ languages: ['en-US'], outer, ready: new Promise(() => {}) });
    assert.equal(s.ctx.Mucellit.i18n.code(), 'en', JSON.stringify(outer));
    assert.deepEqual(s.errors, [], JSON.stringify(outer));
  }
  // start-up goes on even when the getter throws
  const b = open({ languages: ['en-US'], outer: Object.defineProperty({}, 'system', { get() { throw new Error('broken'); } }), ready: new Promise(() => {}) });
  assert.equal(b.ctx.Mucellit.i18n.code(), 'en');
  // a manual choice (localStorage) comes before Rust's system language
  const el = open({ languages: ['tr-TR'], outer: { system: 'tr' }, choice: 'en', ready: new Promise(() => {}) });
  assert.equal(el.ctx.Mucellit.i18n.code(), 'en');
  assert.equal(el.ctx.Mucellit.i18n.systemCode(), 'tr');
});

// ---------------------------------------------------------------- language picker tooltip
test('the tooltip (title) of the language picker is not static ("Language" in the old language does not show on reload); written in the chosen language and updated when the language changes', async () => {
  const selectI18n = i18nItems(HTML).find((o) => o.attrs.id === 'i18n-select');
  assert.ok(selectI18n, 'index.html #i18n-select');
  assert.equal('title' in selectI18n.attrs, false, 'no static title');
  assert.match(selectI18n.attrs['aria-label'] || '', /^Language$/, 'accessible name static English (even without i18n.js)');
  let parse;
  const s = open({ languages: ['tr-TR'], ready: new Promise((r) => { parse = r; }) });
  const select = s.elements.find((o) => o.getAttribute('id') === 'i18n-select');
  assert.equal(select.attribute.title, 'Dil', 'in the chosen language at start-up (Turkish)');  // turkish-ok: expected Turkish UI text
  assert.equal(select.attribute['aria-label'], 'Dil');  // turkish-ok: expected Turkish UI text
  // the Tauri sync changed the language (no reload) → start updates the tooltip too
  s.ctx.Mucellit.i18n.set('en');
  s.load();
  parse();
  await wait(); await wait();
  assert.equal(select.attribute.title, 'Language');
  assert.equal(select.attribute['aria-label'], 'Language');
});
