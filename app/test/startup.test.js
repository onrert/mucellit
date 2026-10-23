'use strict';
// Açılışta arayüz boş kalmaz.
//   1. Statik etiketler i18n.js yüklenir yüklenmez seçili/öntanımlı dille dolar; platform.hazir reddedilse de.
//   2. i18n.js ya da sözlük hata atarsa (yüklenemezse) index.html'deki statik İngilizce metin görünür
//      (index.html'deki metin en sözlüğüyle birebir aynı; tools/i18n-html.mjs yazar, bu test denetler).
// index.html'deki data-dil / data-dil-oz öğeleri küçük bir sahte DOM'a alınır; sözlükler, i18n.js ve app.js
// tarayıcıdaki sırayla bir vm bağlamında çalışır.
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
function cozHtml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (tam, v) => {
    if (v[0] === '#') return String.fromCodePoint(v[1] === 'x' || v[1] === 'X' ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(ENTITY, v) ? ENTITY[v] : tam;
  });
}

/**
 * HTML'deki data-dil / data-dil-oz taşıyan etiketler: { etiket, oz: {öznitelik: değer}, ic: kapanışa kadarki metin
 * (yalnız data-dil'de; iç içe öğe varsa null) }. Yorumlar ve <script> atlanır.
 */
function i18nItems(html) {
  const clean = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const l = [];
  const label = /<([a-z][a-z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let m;
  while ((m = label.exec(clean)) !== null) {
    if (!/\sdata-i18n(-oz)?\s*=/.test(m[2])) continue;
    const oz = {};
    for (const o of m[2].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      oz[o[1]] = cozHtml(o[2] !== undefined ? o[2] : o[3] !== undefined ? o[3] : o[4] !== undefined ? o[4] : '');
    }
    let inner = null;
    if ('data-i18n' in oz) {
      const exit = new RegExp('</' + m[1] + '\\s*>', 'i');
      const rest = clean.slice(m.index + m[0].length);
      const k = exit.exec(rest);
      const raw = k ? rest.slice(0, k.index) : '';
      inner = /</.test(raw) ? null : cozHtml(raw);
    }
    l.push({ label: m[1].toLowerCase(), oz, inner });
  }
  return l;
}

/** index.html'deki statik metnin en sözlüğüyle farkları (boş dizi = aynı). */
function staticDifferences(html, en) {
  const difference = [];
  const elements = i18nItems(html);
  if (!elements.length) return ['data-i18n öğesi yok'];
  for (const o of elements) {
    if ('data-i18n' in o.oz) {
      const a = o.oz['data-i18n'];
      if (typeof en[a] !== 'string') difference.push(`${a}: en sözlüğünde düz metin değil`);
      else if (o.inner === null) difference.push(`${a}: öğenin içinde başka öğe var (textContent ezer)`);
      else if (o.inner !== en[a]) difference.push(`${a}: "${o.inner}" ≠ "${en[a]}"`);
    }
    if ('data-i18n-oz' in o.oz) {
      for (const double of o.oz['data-i18n-oz'].split(';')) {
        const b = double.indexOf(':');
        if (b <= 0) continue;
        const name = double.slice(0, b).trim(), a = double.slice(b + 1).trim();
        if (typeof en[a] !== 'string') difference.push(`${name}:${a}: en sözlüğünde düz metin değil`);
        else if (o.oz[name] !== en[a]) difference.push(`${name}:${a}: "${o.oz[name]}" ≠ "${en[a]}"`);
      }
    }
  }
  return difference;
}

test('index.html statik metni en sözlüğüyle aynı: i18n.js çalışmasa da arayüz İngilizce metinli (tools/i18n-html.mjs)', () => {
  assert.deepEqual(staticDifferences(HTML, EN), []);
  const n = i18nItems(HTML).length;
  assert.ok(n >= 100, `${n} öğe`);
  assert.match(HTML, /<html lang="en">/, 'statik metin İngilizce: html lang en');
});

test('statik metin denetleyicisi kusurlu HTML\'i yakalar (boş, farklı, iç içe, eksik öznitelik, iskelet, kopya)', () => {
  const first = /<button role="tab" id="tab-button-impose"[^>]*>[^<]*<\/button>/.exec(HTML)[0];
  const states = {
    'boş metin': HTML.replace(first, first.replace(/>[^<]*</, '><')),
    'farklı metin': HTML.replace(first, first.replace(/>[^<]*</, '>Düzenle<')),
    'boşluklu metin': HTML.replace(first, first.replace(/>([^<]*)</, '> $1 <')),
    'iç içe öğe': HTML.replace(first, first.replace(/>[^<]*</, '><b>Imposition</b><')),
    'eksik öznitelik': HTML.replace(/(<select id="i18n-select")\s+aria-label="[^"]*"/, '$1'),
    'yanlış öznitelik': HTML.replace(/(<select id="i18n-select") aria-label="[^"]*"/, '$1 aria-label="I18n"'),
    'iskelet (öğe yok)': '<!doctype html><html lang="en"><body></body></html>',
    'kopya (Türkçe sözlük metni)': (() => {
      const TR = require('../js/i18n.js').extractJson(read(path.join(FOLDER, 'tr.js')));
      return HTML.replace(/(data-i18n="([^"]+)"[^>]*>)[^<]*</g, (t, head, a) => head + (TR[a] || '') + '<');
    })(),
  };
  for (const [name, h] of Object.entries(states)) {
    assert.notEqual(h, HTML, `${name}: bozma uygulanamadı (test kendisi)`);
    assert.ok(staticDifferences(h, EN).length > 0, `${name}: yakalanmadı`);
  }
  assert.deepEqual(staticDifferences(HTML, EN), [], 'gerçek dosya temiz');
  assert.equal(cozHtml('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#x27; &unknown;'), 'a & b <c> "d" \'e\' &unknown;');
});

// ---------------------------------------------------------------- sahte DOM ile açılış
function fakeDocument() {
  const elements = i18nItems(HTML).map((o) => ({
    ...o, textContent: o.inner === null ? '' : o.inner, attribute: { ...o.oz },
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
      if (s === '[data-i18n-oz]') return elements.filter((o) => o.getAttribute('data-i18n-oz') !== null);
      return [];
    },
    getElementById(id) { return elements.find((o) => o.getAttribute('id') === id) || (blank[id] = blank[id] || { id, attribute: {}, setAttribute(a, v) { this.attribute[a] = v; }, getAttribute(a) { return this.attribute[a]; } }); },
    addEventListener(name, f) { (listener[name] = listener[name] || []).push(f); },
  };
  return { document, elements, listener, load() { document.readyState = 'interactive'; (listener.DOMContentLoaded || []).forEach((f) => f()); } };
}

/**
 * Tarayıcıdaki sırayla: sözlükler (sozlukMetni ile değiştirilebilir), i18n.js (dilMetni ile), app.js. hazir:
 * KC.platform.hazir. Betik hatası (sayfadaki gibi) yakalanır, sonraki betik çalışır.
 */
function open({ languages = ['tr-TR'], ready = Promise.resolve(), dictionaryText = {}, i18nText, outer, choice } = {}) {
  const b = fakeDocument();
  const notices = [];
  const errors = [];
  const ctx = { navigator: { languages: languages }, document: b.document, console: { error: (...a) => errors.push(a.join(' ')) } };
  if (outer !== undefined) ctx.__MC_LANG__ = outer; // Tauri'nin initialization_script'i (Rust i18n::baslangic_betigi)
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

test('açılış: platform.ready reddedilse de statik etiketler i18n.js yüklenir yüklenmez seçili dilde (tr-TR → Türkçe)', async () => {
  const s = open({ languages: ['tr-TR'], ready: Promise.reject(new Error('köprü yok')) });
  // DOMContentLoaded'dan önce bile (betikler gövde sonunda: öğeler ayrıştırılmış)
  const once = labels(s.elements).filter(([a, m]) => m !== TR[a]);
  assert.deepEqual(once.slice(0, 5), [], `${once.length} etiket Türkçe değil`);
  s.load();
  await wait();
  const l = labels(s.elements);
  assert.ok(l.length >= 100);
  assert.deepEqual(l.filter(([a, m]) => !m || m !== TR[a]).slice(0, 5), [], 'her etiket dolu ve Türkçe');
  const i18n = s.elements.find((o) => o.getAttribute('id') === 'i18n-select');
  assert.equal(i18n.attribute['aria-label'], 'Dil');
  assert.equal(s.document.documentElement.attribute.lang, 'tr');
  assert.deepEqual(s.notices, [['Uygulama başlatılamadı: köprü yok', 'error']]);
  assert.deepEqual(s.errors, []);
});

test('açılış: en-US tarayıcıda etiketler İngilizce; hazır olunca yeniden uygulanır (Tauri eşitlemesi gibi)', async () => {
  let parse;
  const s = open({ languages: ['en-US'], ready: new Promise((r) => { parse = r; }) });
  assert.deepEqual(labels(s.elements).filter(([a, m]) => m !== EN[a]).slice(0, 3), []);
  // hazir'dan önce dil değişti (Tauri: dil_oku Rust yedeğinden "tr" getirdi) → baslat yeniden uygular
  s.ctx.Mucellit.i18n.set('tr');
  s.load();
  parse();
  await wait();
  assert.deepEqual(labels(s.elements).filter(([a, m]) => m !== TR[a]).slice(0, 3), []);
});

test('açılış: tr sözlüğü bozuksa i18n.js yine çalışır, tr-TR kullanıcısı İngilizce (boş değil) görür', async () => {
  for (const corrupt of ['(self.MucellitDictionaries = (self.MucellitDictionaries || []).concat([{ "_name": "Türkçe" }]));', 'self.MucellitDictionaries = (self.MucellitDictionaries || []).concat([null, 5, "x"]);']) {
    const s = open({ languages: ['tr-TR'], dictionaryText: { 'tr.js': corrupt } });
    s.load();
    await wait();
    assert.equal(s.ctx.Mucellit.i18n && s.ctx.Mucellit.i18n.code(), 'en', corrupt);
    assert.deepEqual(labels(s.elements).filter(([a, m]) => m !== EN[a]).slice(0, 3), [], corrupt);
    assert.deepEqual(s.notices, [], 'başlatma sürer');
  }
});

test('açılış: i18n.js hata atarsa statik İngilizce metin yerinde kalır (boş arayüz yok)', async () => {
  const s = open({ languages: ['tr-TR'], i18nText: 'throw new Error("i18n.js bozuk");' });
  s.load();
  await wait();
  const l = labels(s.elements);
  assert.ok(l.length >= 100);
  assert.deepEqual(l.filter(([a, m]) => m !== EN[a]).slice(0, 3), [], 'statik İngilizce');
  assert.ok(s.errors.some((h) => /i18n\.js bozuk/.test(h)), s.errors.join(' | '));
  // başlatma hatası dil altyapısı olmadan da (İngilizce) bildirilir; işlenmemiş red yok
  assert.equal(s.notices.length, 1, JSON.stringify(s.notices));
  assert.match(s.notices[0][0], /^The app couldn't start: /);
});

test('tools/i18n-html.mjs: kusurlu girdide sorun bildirir, kaçışları doğru yazar, güncel dosyada değişiklik yapmaz', async () => {
  const { update } = await import('../../tools/i18n-html.mjs');
  const en = { 'a.b': 'A & B <x> "q"', 'c.d': 'Title "1"', 'plural': { one: '1', other: '{n}' } };
  const r = update('<p data-i18n="a.b">old</p><i data-i18n-oz="title:c.d"></i><b title="x" data-i18n-oz="title:c.d"></b>', en);
  assert.deepEqual(r.problem, []);
  assert.equal(r.html, '<p data-i18n="a.b">A &amp; B &lt;x&gt; "q"</p><i title="Title &quot;1&quot;" data-i18n-oz="title:c.d"></i><b title="Title &quot;1&quot;" data-i18n-oz="title:c.d"></b>');
  assert.equal(r.changed, 3);
  assert.deepEqual(staticDifferences(r.html, en), [], 'bağımsız denetleyici yazılanı kabul eder (kaçış gidiş-dönüş)');
  const iki = update(r.html, en);
  assert.equal(iki.changed, 0);
  assert.equal(iki.html, r.html, 'ikinci koşu değiştirmez');
  for (const [name, h] of [['iç içe öğe', '<p data-i18n="a.b"><b>x</b></p>'], ['çoğul anahtar', '<p data-i18n="plural"></p>'], ['unknown key', '<p data-i18n="none.x"></p>'],
    ['öznitelikte bilinmeyen', '<i data-i18n-oz="title:none.x"></i>'], ['kapanışsız', '<p data-i18n="a.b">x']]) {
    assert.ok(update(h, en).problem.length > 0, `${name}: sorun bildirilmedi`);
  }
  // gerçek dosya güncel (betik --denetle ile aynı)
  const g = update(HTML, EN);
  assert.deepEqual(g.problem, []);
  assert.equal(g.html, HTML, 'index.html güncel: node tools/i18n-html.mjs');
});

// ---------------------------------------------------------------- Tauri'de ilk kare Rust'ın sistem diliyle
test('Tauri ön betiği (__MC_LANG__.system) varsa ilk kare o dilde; navigator.languages\'ten geçiş yok', async () => {
  // WKWebView navigator.languages tek dil (en-US) verir, Rust NSLocale + Apple kuralı tr der: etiketler HEMEN Türkçe
  const s = open({ languages: ['en-US'], outer: { system: 'tr' }, ready: new Promise(() => {}) });
  assert.equal(s.ctx.Mucellit.i18n.code(), 'tr', 'i18n.js yüklenir yüklenmez (platform.ready beklenmeden)');
  const difference = labels(s.elements).filter(([a, m]) => m !== TR[a]);
  assert.deepEqual(difference.slice(0, 3), [], `${difference.length} etiket Türkçe değil`);
  assert.equal(s.ctx.Mucellit.i18n.systemCode(), 'tr');
  // tersi: tarayıcı tr-TR, Rust en
  const e = open({ languages: ['tr-TR'], outer: { system: 'en' }, ready: new Promise(() => {}) });
  assert.equal(e.ctx.Mucellit.i18n.code(), 'en');
  assert.deepEqual(labels(e.elements).filter(([a, m]) => m !== EN[a]).slice(0, 3), []);
  assert.deepEqual([s.errors, e.errors], [[], []]);
});

test('bozuk/desteklenmeyen __MC_LANG__ yok sayılır (tarayıcı dili kalır); elle seçim yine önce gelir', () => {
  for (const outer of [null, 'tr', 42, {}, { system: 'xx' }, { system: 'TR' }, { system: '' }, { system: { toString: () => 'tr' } }]) {
    const s = open({ languages: ['en-US'], outer, ready: new Promise(() => {}) });
    assert.equal(s.ctx.Mucellit.i18n.code(), 'en', JSON.stringify(outer));
    assert.deepEqual(s.errors, [], JSON.stringify(outer));
  }
  // getter hata atarsa da açılış sürer
  const b = open({ languages: ['en-US'], outer: Object.defineProperty({}, 'system', { get() { throw new Error('bozuk'); } }), ready: new Promise(() => {}) });
  assert.equal(b.ctx.Mucellit.i18n.code(), 'en');
  // elle seçim (localStorage) Rust'ın sistem dilinden önce gelir
  const el = open({ languages: ['tr-TR'], outer: { system: 'tr' }, choice: 'en', ready: new Promise(() => {}) });
  assert.equal(el.ctx.Mucellit.i18n.code(), 'en');
  assert.equal(el.ctx.Mucellit.i18n.systemCode(), 'tr');
});

// ---------------------------------------------------------------- dil seçici ipucu
test('dil seçicinin ipucu (title) statik değil (yeniden yüklemede eski dilde "Language" görünmez); seçili dilde yazılır ve dil değişince güncellenir', async () => {
  const selectI18n = i18nItems(HTML).find((o) => o.oz.id === 'i18n-select');
  assert.ok(selectI18n, 'index.html #i18n-select');
  assert.equal('title' in selectI18n.oz, false, 'statik title yok');
  assert.match(selectI18n.oz['aria-label'] || '', /^Language$/, 'erişilebilir ad statik İngilizce (i18n.js yoksa da)');
  let parse;
  const s = open({ languages: ['tr-TR'], ready: new Promise((r) => { parse = r; }) });
  const select = s.elements.find((o) => o.getAttribute('id') === 'i18n-select');
  assert.equal(select.attribute.title, 'Dil', 'açılışta seçili dilde (Türkçe)');
  assert.equal(select.attribute['aria-label'], 'Dil');
  // Tauri eşitlemesi dili değiştirdi (yeniden yükleme yok) → baslat ipucunu da günceller
  s.ctx.Mucellit.i18n.set('en');
  s.load();
  parse();
  await wait(); await wait();
  assert.equal(select.attribute.title, 'Language');
  assert.equal(select.attribute['aria-label'], 'Language');
});
