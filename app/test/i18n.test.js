'use strict';
// Arayüz dili: sözlük eşitliği, eksik anahtar, parametre, tekil/çoğul, dil seçimi, data-dil uygulaması,
// sabit Türkçe dizgi taraması (izin listeli) ve eski Türkçe kayıtların açılması.
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

// ---------------------------------------------------------------- sözlük denetleyicisi
const PLURAL = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const META = ['_lang', '_name', '_locale'];
function params(value) {
  const texts = typeof value === 'string' ? [value] : Object.values(value || {});
  const p = new Set();
  texts.forEach((m) => String(m).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, a) => { p.add(a); return ''; }));
  return [...p].sort();
}

/**
 * Sözlükleri karşılaştırır. sozlukler: { kod: { metin (dosya metni) } } ya da { kod: { nesne } }. Sorun listesi döner:
 * eksik/fazla anahtar (en'e göre), boş metin, metin olmayan değer, bozuk çoğul nesnesi, parametre farkı, yinelenen
 * anahtar (dosya metninde), _dil dosya adıyla uyuşmuyor, üst veri eksik.
 */
function checkDictionary(files) {
  const problem = [];
  const object = {};
  for (const [code, text] of Object.entries(files)) {
    try { object[code] = I18n.extractJson(text); } catch (e) { problem.push(`${code}: JSON değil (${e.message})`); continue; }
    const say = {};
    // üst düzey anahtarlar (2 boşluk girinti; çoğul nesnesinin one/other'ı 4 boşlukta)
    for (const m of String(text).matchAll(/^ {2}"((?:[^"\\]|\\.)+)"\s*:/gm)) say[m[1]] = (say[m[1]] || 0) + 1;
    Object.entries(say).filter(([, n]) => n > 1).forEach(([a]) => problem.push(`${code}: yinelenen anahtar ${a}`));
    META.forEach((a) => { if (typeof object[code][a] !== 'string' || !object[code][a].trim()) problem.push(`${code}: ${a} none`); });
    if (object[code]._lang !== code) problem.push(`${code}: _lang "${object[code]._lang}" dosya adıyla uyuşmuyor`);
  }
  const main = object.en;
  if (!main) return problem.concat(['en sözlüğü yok']);
  const keys = (s) => Object.keys(s).filter((a) => !a.startsWith('_'));
  for (const [code, s] of Object.entries(object)) {
    for (const a of keys(main)) if (!(a in s)) problem.push(`${code}: eksik ${a}`);
    for (const a of keys(s)) {
      if (!(a in main)) { problem.push(`${code}: fazla ${a}`); continue; }
      const d = s[a];
      if (typeof d === 'string') {
        if (!d.trim()) problem.push(`${code}: boş ${a}`);
      } else if (d && typeof d === 'object' && !Array.isArray(d)) {
        if (typeof d.other !== 'string' || !d.other.trim()) problem.push(`${code}: ${a} çoğul nesnesinde other yok`);
        for (const [k, v] of Object.entries(d)) {
          if (!PLURAL.has(k)) problem.push(`${code}: ${a} bilinmeyen çoğul kategorisi ${k}`);
          else if (typeof v !== 'string' || !v.trim()) problem.push(`${code}: ${a}.${k} boş`);
        }
        if (!params(d).includes('n')) problem.push(`${code}: ${a} çoğul ama {n} yok`);
      } else problem.push(`${code}: ${a} metin değil`);
      const pa = params(main[a]).join(','), pk = params(d).join(',');
      if (pa !== pk) problem.push(`${code}: ${a} parametreleri farklı (en: ${pa || '-'}; ${code}: ${pk || '-'})`);
    }
  }
  return problem;
}

const ACTUAL = Object.fromEntries(DICTIONARY_FILES.map((a) => [a.replace(/\.js$/, ''), read(path.join(FOLDER, a))]));

test('sözlük eşitliği: en ve tr aynı anahtar kümesi, boş metin yok, parametreler eşleşiyor, yinelenen anahtar yok', () => {
  assert.ok(DICTIONARY_FILES.includes('en.js') && DICTIONARY_FILES.includes('tr.js'), DICTIONARY_FILES.join());
  assert.deepEqual(checkDictionary(ACTUAL), []);
  const n = Object.keys(I18n.extractJson(ACTUAL.en)).length - META.length;
  // Öğren rehberi ~520 anahtar ekledi (önce 486); üst sınır yalnız "sözlük yanlışlıkla iki katına çıktı mı" denetimi
  assert.ok(n > 300 && n < 1500, `anahtar sayısı ${n}`);
});

test('sözlük denetleyicisi kusurlu sözlükleri yakalar (eksik, fazla, boş, parametre, çoğul, yineleme, _lang, JSON)', () => {
  const wrap = (o) => '[/*JSON*/' + JSON.stringify(o, null, 2) + '/*JSON*/]';
  const tr = () => I18n.extractJson(ACTUAL.tr);
  const states = {
    'missing key': (() => { const t = tr(); delete t['menu.file']; return { tr: wrap(t) }; })(),
    'extra key': (() => { const t = tr(); t['none.such'] = 'x'; return { tr: wrap(t) }; })(),
    'boş metin': (() => { const t = tr(); t['menu.file'] = '   '; return { tr: wrap(t) }; })(),
    'metin değil': (() => { const t = tr(); t['menu.file'] = 5; return { tr: wrap(t) }; })(),
    'parametre farkı': (() => { const t = tr(); t['impose.loaded'] = '{file} yüklendi ({n} sayfa).'; return { tr: wrap(t) }; })(),
    'param missing': (() => { const t = tr(); t['recent.no_disk'] = '{name} açılamadı.'; return { tr: wrap(t) }; })(),
    'çoğul other yok': (() => { const t = tr(); t['impose.selected'] = { one: '{n} page' }; return { tr: wrap(t) }; })(),
    'çoğul kategori': (() => { const t = tr(); t['impose.selected'] = { single: '{n}', other: '{n} sayfa seçildi.' }; return { tr: wrap(t) }; })(),
    'çoğul n yok': (() => { const t = tr(); t['impose.selected'] = { other: 'seçildi' }; return { tr: wrap(t) }; })(),
    'repeated key': { tr: ACTUAL.tr.replace('"menu.file": "Dosya",', '"menu.file": "Dosya",\n  "menu.file": "Dosya",') },
    '_lang uyuşmuyor': (() => { const t = tr(); t._lang = 'en'; return { tr: wrap(t) }; })(),
    'üst veri yok': (() => { const t = tr(); delete t._name; return { tr: wrap(t) }; })(),
    'JSON değil (sondaki virgül)': { tr: ACTUAL.tr.replace('"menu.file": "Dosya",', '"menu.file": "Dosya",,') },
    'işaret yok': { tr: ACTUAL.tr.replace(/\/\*JSON\*\//g, '') },
    'iskelet (boş nesne)': { tr: '[/*JSON*/{"_lang":"tr","_name":"Türkçe","_locale":"tr-TR"}/*JSON*/]' },
    'copy (en text tr diye)': { tr: ACTUAL.en },
    'en yok': { en: undefined },
  };
  for (const [name, deg] of Object.entries(states)) {
    const files = { ...ACTUAL, ...deg };
    if (deg.en === undefined && 'en' in deg) delete files.en;
    const s = checkDictionary(files);
    assert.ok(s.length > 0, `${name}: yakalanmadı`);
  }
});

// ---------------------------------------------------------------- çalışma anı (vm, tarayıcıdaki gibi)
function fresh(code, ek) {
  const ctx = { navigator: { languages: ['en-US'] } };
  ctx.self = ctx;
  vm.createContext(ctx);
  if (ek) ctx.MucellitDictionaries = [ek];
  return setupI18n(ctx, code);
}

test('eksik anahtar en\'e düşer; hiçbir dilde yoksa anahtar döner ve missingKeys()\'e yazılır', () => {
  const ek = { _lang: 'zz', _name: 'Deneme', _locale: 'en-US', 'menu.file': 'Fichier' };
  const D = fresh('zz', ek);
  assert.equal(D.code(), 'zz');
  assert.equal(D.t('menu.file'), 'Fichier');
  assert.equal(D.t('menu.open'), 'Open…', 'zz\'de yok → en');
  assert.deepEqual(Array.from(D.missingKeys()), []);
  assert.equal(D.t('none.such.key'), 'none.such.key');
  assert.deepEqual(Array.from(D.missingKeys()), ['none.such.key']);
  assert.equal(D.t('_name'), '_name', 'üst veri metin olarak verilmez');
  assert.equal(fresh('xx').code(), 'en', 'desteklenmeyen dil → en');
});

test('parametreli text: name/sayı/path instead konur; missing param {name} as kalır', () => {
  const tr = fresh('tr'), en = fresh('en');
  assert.equal(tr.t('impose.loaded', { name: 'a.pdf', n: 37 }), 'a.pdf yüklendi (37 sayfa).');
  assert.equal(en.t('impose.loaded', { name: 'a.pdf', n: 37 }), 'a.pdf loaded (37 pages).');
  assert.equal(en.t('recent.no_disk', { name: 'tez.pdf', detail: 'MCTrial' }), "tez.pdf couldn't be opened: its disk (MCTrial) isn't connected. Connect the disk and try again; the entry stays in Open Recent.");
  assert.equal(en.t('save.saved', { paths: '/Users/x/a b.pdf' }), 'Saved: /Users/x/a b.pdf.');
  assert.equal(en.t('impose.pdf_not', {}), "The file isn't a valid PDF: {name}");
  assert.equal(en.t('impose.pdf_not', { name: 0 }), "The file isn't a valid PDF: 0", '0 değeri yazılır');
});

test('tekil/çoğul: en "1 page / 2 pages" (Intl.PluralRules), tr tek biçim', () => {
  const tr = fresh('tr'), en = fresh('en');
  assert.equal(en.t('impose.selected', { n: 1 }), '1 page selected.');
  assert.equal(en.t('impose.selected', { n: 2 }), '2 pages selected.');
  assert.equal(en.t('impose.selected', { n: 0 }), '0 pages selected.');
  assert.equal(en.t('impose.loaded', { name: 'x.pdf', n: 1 }), 'x.pdf loaded (1 page).');
  assert.equal(en.t('projects.list_summary', { kind: 'T', done: 0, n: 1 }), 'T · 0/1 step');
  assert.equal(tr.t('impose.selected', { n: 1 }), '1 sayfa seçildi.');
  assert.equal(tr.t('impose.selected', { n: 2 }), '2 sayfa seçildi.');
  assert.equal(en.t('impose.selected'), '{n} pages selected.', 'n yoksa other');
});

test('dil seçimi: sistem dili Apple kuralı (desteklenen ilk dil); elle seçim localStorage\'da; html lang', () => {
  const D = fresh('en');
  assert.equal(D.systemLanguage(['tr-TR', 'en-US']), 'tr');
  assert.equal(D.systemLanguage(['tr']), 'tr');
  assert.equal(D.systemLanguage(['TR_tr']), 'tr');
  assert.equal(D.systemLanguage(['en-GB', 'tr-TR']), 'en');
  assert.equal(D.systemLanguage(['de-DE', 'tr-TR']), 'tr', 'Apple kuralı: listede desteklenen ilk dil');
  assert.equal(D.systemLanguage(['de-DE', 'fr-FR']), 'en', 'listede desteklenen dil yoksa en');
  assert.equal(D.systemLanguage([]), 'en');
  assert.equal(D.systemLanguage(undefined), 'en');
  assert.equal(D.systemLanguage(['', null, 'tr']), 'tr');
  // başlangıç: localStorage seçimi > navigator.languages
  const setup = (ls, languages) => {
    const ctx = { navigator: { languages: languages }, localStorage: ls, document: { documentElement: { lang: '', setAttribute(a, v) { this[a] = v; } }, querySelectorAll: () => [] } };
    ctx.self = ctx;
    vm.createContext(ctx);
    for (const a of DICTIONARY_FILES) vm.runInContext(read(path.join(FOLDER, a)), ctx);
    vm.runInContext(read(path.join(APP, 'js', 'i18n.js')), ctx);
    return ctx;
  };
  const storage = (v) => { const d = { v: v === undefined ? {} : v, getItem: (k) => (k in d.v ? d.v[k] : null), setItem: (k, x) => { d.v[k] = String(x); }, removeItem: (k) => { delete d.v[k]; } }; return d; };
  assert.equal(setup(storage(), ['tr-TR']).Mucellit.i18n.code(), 'tr', 'sistem tr');
  assert.equal(setup(storage(), ['en-US', 'tr']).Mucellit.i18n.code(), 'en', 'sistem en');
  assert.equal(setup(storage(), ['ja-JP']).Mucellit.i18n.code(), 'en', 'desteklenmeyen sistem dili');
  assert.equal(setup(storage({ 'mucellit.language': 'en' }), ['tr-TR']).Mucellit.i18n.code(), 'en', 'elle seçim sistem dilini ezer');
  assert.equal(setup(storage({ 'mucellit.language': 'xx' }), ['tr-TR']).Mucellit.i18n.code(), 'tr', 'bozuk seçim yok sayılır');
  const atan = { getItem() { throw new Error('kapalı'); }, setItem() { throw new Error('kapalı'); }, removeItem() { throw new Error('kapalı'); } };
  const c = setup(atan, ['tr-TR']);
  assert.equal(c.Mucellit.i18n.code(), 'tr', 'saklama kapalı: sistem dili');
  assert.doesNotThrow(() => c.Mucellit.i18n.writeChoice('en'));
  assert.equal(c.document.documentElement.lang, 'tr');
  const d = storage();
  const k = setup(d, ['tr-TR']).Mucellit.i18n;
  k.writeChoice('en');
  assert.equal(d.v['mucellit.language'], 'en');
  assert.equal(k.readChoice(), 'en');
  k.writeChoice(null);
  assert.equal('mucellit.language' in d.v, false, 'sistem seçimi anahtarı siler');
  k.writeChoice('xx');
  assert.equal('mucellit.language' in d.v, false, 'desteklenmeyen kod yazılmaz');
});

test('uygula: data-i18n metni, data-i18n-oz öznitelikleri, belge başlığı', () => {
  const D = fresh('en');
  const element = (a) => ({ a, textContent: 'old', oz: {}, getAttribute(k) { return this.a[k]; }, setAttribute(k, v) { this.oz[k] = v; } });
  const m = element({ 'data-i18n': 'menu.file' });
  const o = element({ 'data-i18n-oz': 'aria-label:language.label; title:impose.swap;bozuk;:x' });
  const root = { querySelectorAll: (s) => (s === '[data-i18n]' ? [m] : s === '[data-i18n-oz]' ? [o] : []) };
  D.apply(root);
  assert.equal(m.textContent, 'File');
  assert.deepEqual(o.oz, { 'aria-label': 'Language', title: 'Swap portrait / landscape' });
  assert.doesNotThrow(() => D.apply(null));
  assert.doesNotThrow(() => D.apply({}));
});

// ---------------------------------------------------------------- anahtar kullanımı
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
// Çalışma anında birleştirilen (dinamik) anahtar önekleri: kaynakta tam anahtar geçmez.
const DYNAMIC = ['step.', 'epub.E', 'epub.detail.', 'binding.kind.', 'calc.name.', 'imposition.name.', 'projects.settings_type.'];
/**
 * Öğren rehberinin aşama/adım anahtarları learn.js'te parçalı kurulur (`ogren.${aşama}.${adım}.baslik` …); önek
 * muafiyeti yerine ders listesinden (js/learn/learn-lessons.js) tek tek üretilir: her aşamada .ad/.ozet, her adımda
 * .baslik/.aciklama/.dugme zorunlu; .arac/.dikkat/.aciklama_az isteğe bağlı (yalnız ders listesindeki bir adım için).
 */
function learnLessonKeys(source) {
  const ctx = {}; ctx.self = ctx; vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'learn-lessons.js' });
  const required = new Set(), optional = new Set();
  for (const d of ctx.Mucellit.learn.lessons) {
    required.add(`learn.${d.id}.name`); required.add(`learn.${d.id}.summary`);
    for (const a of d.steps) {
      for (const e of ['title', 'description', 'button']) required.add(`learn.${d.id}.${a}.${e}`);
      for (const e of ['tool', 'caution', 'description_az']) optional.add(`learn.${d.id}.${a}.${e}`);
    }
  }
  return { required, optional };
}
const LEARN_LESSONS = learnLessonKeys(read(path.join(APP, 'js', 'learn', 'learn-lessons.js')));

test('anahtar kullanımı: kaynakta geçen her anahtar sözlükte var; sözlükte kullanılmayan anahtar yok', () => {
  const used = new Set();
  // dosya/alan adları (dil.txt, surec.json, tauri.localhost) anahtar sayılmaz
  const keyLike = (m) => /^[a-z]+(\.[a-zA-Z0-9_]+)+$/.test(m) && NAME_FIELDS.has(m.split('.')[0]) && !/\.(txt|json|js|pdf|epub|localhost)$/.test(m);
  for (const y of JS_FILES) for (const d of jsStrings(read(y))) if (keyLike(d.text)) used.add(d.text);
  for (const y of RUST_FILES) for (const d of rustStrings(read(y))) if (!d.log && keyLike(d.text)) used.add(d.text);
  const html = read(path.join(APP, 'index.html'));
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-oz="([^"]+)"/g)) m[1].split(';').forEach((c) => used.add(c.split(':')[1]));
  for (const a of LEARN_LESSONS.required) used.add(a);
  const missing = [...used].filter((a) => !(a in DICTIONARY));
  assert.deepEqual(missing, [], 'sözlükte olmayan anahtar');
  const unused = Object.keys(DICTIONARY).filter((a) => !a.startsWith('_') && !used.has(a) && !LEARN_LESSONS.optional.has(a) && !DYNAMIC.some((o) => a.startsWith(o)));
  assert.deepEqual(unused, [], 'sözlükte kullanılmayan anahtar');
  // dinamik öneklerin her biri gerçekten kaynakta birleştiriliyor
  const allSource = JS_FILES.map(read).join('\n');
  for (const o of DYNAMIC.filter((o) => o !== 'epub.E')) assert.ok(allSource.includes(`'${o}'`), `dinamik önek kaynakta yok: ${o}`);
  assert.ok(used.size > 300, `${used.size} key found`);
});

test('Öğren ders anahtarları ders listesinden üretilir; denetleyici eksik/fazla adım anahtarını yakalar', () => {
  const lesson = read(path.join(APP, 'js', 'learn', 'learn-lessons.js'));
  assert.equal(LEARN_LESSONS.required.size, 10 * 2 + 45 * 3, '10 aşama, 45 adım');
  const missingKeys = (k) => [...learnLessonKeys(k).required].filter((a) => !(a in DICTIONARY));
  assert.deepEqual(missingKeys(lesson), []);
  // kusurlu girdi: sözlükte karşılığı olmayan adım eklenirse eksik çıkar; adım silinirse onun anahtarları kullanılmıyor sayılır
  const newStep = lesson.replace("steps: ['grain', 'impose', 'fold', 'boneFolder', 'press']", "steps: ['grain', 'impose', 'fold', 'boneFolder', 'press', 'fresh']");
  assert.notEqual(newStep, lesson, 'varyant uygulanamadı');
  assert.deepEqual(missingKeys(newStep), ['learn.folding.fresh.title', 'learn.folding.fresh.description', 'learn.folding.fresh.button']);
  const deleted = learnLessonKeys(lesson.replace("'boneFolder', 'press']", "'boneFolder']"));
  assert.ok(!deleted.required.has('learn.folding.press.title') && !deleted.optional.has('learn.folding.press.caution'));
  assert.throws(() => learnLessonKeys(''), 'boş ders dosyası');
});

test('index.html\'deki her sözlük betiği yüklenir; her app/i18n/*.js index.html\'de (yeni dil unutulmasın); i18n.js sözlüklerden sonra', () => {
  const html = read(path.join(APP, 'index.html'));
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const dictionary = scripts.filter((b) => b.startsWith('i18n/'));
  assert.deepEqual(dictionary.map((b) => b.slice(5)).sort(), DICTIONARY_FILES);
  const i18nJs = scripts.indexOf('js/i18n.js');
  assert.ok(i18nJs > Math.max(...dictionary.map((b) => scripts.indexOf(b))), 'i18n.js sözlüklerden sonra');
  assert.ok(i18nJs < scripts.indexOf('js/platform.js'), 'i18n.js platform.js\'ten önce');
});

test('t() gölgelenmiyor: t işlevi tanımlayan dosyada t adlı değişken/parametre yok', () => {
  const faulty = (source) => /function t\(/.test(source) && /\b(var|let|const)\s+t\b|function\s*[A-Za-z0-9_$]*\s*\(\s*(?:[^)]*,\s*)?t\s*[,)]/.test(source.replace(/function t\(a, p\)/g, ''));
  const found = JS_FILES.filter((y) => faulty(read(y))).map((y) => path.relative(REPO, y));
  assert.deepEqual(found, []);
  // denetleyici kusurlu girdiyi yakalar
  assert.equal(faulty("function t(a, p) {}\nfunction f() { var t = 1; }"), true);
  assert.equal(faulty("function t(a, p) {}\n[].reduce(function (t, k) { return t; })"), true);
  assert.equal(faulty("function t(a, p) {}\nfunction g(x, t) {}"), true);
  assert.equal(faulty("function t(a, p) {}\nvar tk = 1; function g(top) {}"), false);
});

// ---------------------------------------------------------------- sabit Türkçe dizgi taraması
/**
 * İzin listesi: arayüz metni OLMAYAN Türkçe karakterli değişmezler (dosya → değişmez parçası, neden). Testler
 * (app/test/), sözlükler (app/i18n/) ve vendor taranmaz. Rust'ta günlük (eprintln!/expect/assert …) ve test modülü
 * taranmaz (kullanıcıya gitmez).
 */
const PERMISSION = [
  ['app/js/plugins/epub/hyphenation.js', 'aeıioöuüâîû', 'Türkçe tire bölme kuralı (PDF içeriği, arayüz değil)'],
  ['app/js/plugins/epub/zip.js', 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ', 'CP437 kod çözme tablosu (ZIP adları)'],
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

test('tarama: app/ ve src-tauri/src/ içinde izin listesi dışında Türkçe kullanıcı dizgisi yok', () => {
  assert.deepEqual(scan(), []);
  assert.ok(JS_FILES.length >= 20 && RUST_FILES.length >= 7, `${JS_FILES.length} JS, ${RUST_FILES.length} Rust`);
});

test('tarama ve anahtar kullanımı Öğren rehberini kapsar (app/js/learn/ alt klasörleri dahil); rehbere sabit Türkçe dizgi eklenirse FAIL', () => {
  const learn = JS_FILES.map((y) => path.relative(APP, y)).filter((y) => y.startsWith(path.join('js', 'learn') + path.sep));
  const expected = ['learn-measure.js', 'cf-engine.js', 'cf-page.js', 'learn-lessons.js', 'learn.js', ...fs.readdirSync(path.join(APP, 'js', 'learn', 'figures')).filter((a) => a.endsWith('.js')).map((a) => 'figures/' + a)];
  assert.deepEqual(learn.map((y) => y.slice(9).split(path.sep).join('/')).sort(), expected.sort());
  assert.equal(expected.length, 14, '5 rehber dosyası + 9 figür dosyası');
  // kusurlu girdi: gerçek rehber dosyalarının bozulmuş kopyaları (Türkçe harfli, ASCII Türkçe, figür etiketi)
  const find = (k) => jsStrings(k).filter((d) => isTurkish(d.text)).map((d) => d.text);
  const learnJs = read(path.join(APP, 'js', 'learn', 'learn.js'));
  const bookJs = read(path.join(APP, 'js', 'learn', 'figures', 'book.js'));
  assert.deepEqual(find(learnJs), []);
  assert.deepEqual(find(bookJs), []);
  assert.deepEqual(find(learnJs.replace("t('learn.stop')", "'Durdur ve başa dön'")), ['Durdur ve başa dön']);
  assert.deepEqual(find(learnJs.replace("t('learn.stop')", "'Oynatma durduruldu'")), ['Oynatma durduruldu']);
  assert.deepEqual(find(bookJs.replace("t('learn.s.book.kapak2')", "'KITABI AC VE CEVIR'")), ['KITABI AC VE CEVIR']);
});

test('tarama: izin listesindeki her girdi gerçekten var (bayat izin kalmaz)', () => {
  for (const [d, part] of PERMISSION) {
    const s = d.endsWith('.rs') ? rustStrings(read(path.join(REPO, d))) : jsStrings(read(path.join(REPO, d)));
    assert.ok(s.some((x) => x.text.includes(part)), `${d}: ${part}`);
  }
});

test('tarama kusurlu/zor girdiyi yakalar: tırnak türleri, şablon, kaçış, regex, yorum; Rust günlük/test/ham dizgi; HTML', () => {
  const js = (k) => jsStrings(k).filter((d) => isTurkish(d.text)).map((d) => d.text);
  assert.deepEqual(js("var a = 'Kitap oluşturuldu';"), ['Kitap oluşturuldu']);
  assert.deepEqual(js('f("Çıktı")'), ['Çıktı']);
  const template = js('x = `${n} sayfa ${"ğ"} yüz`');
  assert.ok(template.includes('ğ') && template.some((m) => m.includes('yüz')), 'şablon içindeki dizgi ve şablon metni: ' + JSON.stringify(template));
  assert.ok(js('x = `${n} yüz`').length === 1, 'şablon metni');
  assert.deepEqual(js("y = 'it\\'s ş'"), ["it's ş"], 'kaçışlı tırnak');
  assert.deepEqual(js("if (/'/.test(a)) b = 'ş';"), ['ş'], 'tırnak içeren regex dizgiyi bozmaz');
  assert.deepEqual(js("var r = /[çğ]/g; var s = a / b; c = 'ö';"), ['ö'], 'regex atlanır, bölme regex sayılmaz');
  assert.deepEqual(js('// yorum: ç\n/* çok satırlı\nş */ var x = 1;'), [], 'yorumlar atlanır');
  assert.deepEqual(js("return /ş/.test(x) ? 'a' : 'ı';"), ['ı'], 'return sonrası regex');
  assert.deepEqual(js("t('Forma sayisi yok')"), ['Forma sayisi yok'], 'Türkçe harfsiz Türkçe cümle (sözcük sezgisi)');
  assert.deepEqual(js("t('menu.dosya'); x('system-ui, sans-serif'); y(' · ')"), [], 'anahtar ve teknik dizgi Türkçe değil');
  const line = jsStrings("a\n\n  'ş'");
  assert.equal(line[0].line, 3, 'satır numarası');

  const rs = (k) => rustStrings(k).filter((d) => !d.log && isTurkish(d.text)).map((d) => d.text);
  assert.deepEqual(rs('fn f() -> String { format!("dosya çok büyük ({} MB)", 3) }'), ['dosya çok büyük ({} MB)']);
  assert.deepEqual(rs('fn f() { eprintln!("yazılamadı: {e}"); x.lock().expect("kilidi ş"); assert!(a, "ğ"); }'), [], 'günlük/expect/assert');
  assert.deepEqual(rs('fn f() { eprintln!("{}", format!("ş")); }'), [], 'günlük içindeki format!');
  assert.deepEqual(rs('const A: &str = r#"ham "ç" dizgi"#;'), ['ham "ç" dizgi'], 'ham dizgi');
  assert.deepEqual(rs("fn f<'a>(x: &'a str) -> char { 'ş' }"), ['ş'], 'ömür ve karakter değişmezi');
  assert.deepEqual(rs('// yorum ç\n/* iç /* içe */ ş */ fn f() {}'), [], 'iç içe yorum');
  assert.deepEqual(rs('fn a() { b("ç") }\n#[cfg(test)]\nmod testler { fn t() { x("ş") } }'), ['ç'], 'test modülü taranmaz');
  assert.deepEqual(rs('#[cfg(test)]\npub fn kalip() {}\nfn a() { b("ç") }'), ['ç'], 'cfg(test) işlev test modülü değildir');
  assert.deepEqual(rs('fn a() { b("kaç\\"ış") }'), ['kaç"ış'], 'kaçışlı tırnak');

  const ht = (k) => htmlTexts(k).filter((d) => isTurkish(d.text)).map((d) => d.text);
  assert.deepEqual(ht('<p>Düzenle</p>'), ['Düzenle']);
  assert.deepEqual(ht('<button title="Çevir" data-dil="a.b">⇄</button>'), ['Çevir']);
  assert.deepEqual(ht('<input placeholder="ör. 1-4">'), ['ör. 1-4']);
  assert.deepEqual(ht('<!-- yorum ğ --><script>var a = "ş";</script><span data-dil="ö"></span>'), [], 'yorum, betik, anahtar');
  assert.deepEqual(ht('<p data-dil="x"></p>\n<p>Sayfa yok</p>'), ['Sayfa yok'], 'harfsiz Türkçe metin düğümü');
  // tara(): dosyaya sabit Türkçe dizgi eklenirse KALDI (gerçek dosyanın bozulmuş kopyası üzerinde)
  const copy = read(path.join(APP, 'js', 'projects.js')).replace("t('projects.deleted')", "'Bütün süreç verisi silindi.'");
  assert.ok(jsStrings(copy).some((d) => isTurkish(d.text) && d.text.startsWith('Bütün')), 'geri eklenen sabit dizgi yakalanır');
});

// ---------------------------------------------------------------- eski (öncesi) kayıtlar
const OLD = path.join(__dirname, 'fixtures', 'legacy');

test('eski Türkçe kayıtlar: localStorage/surec.json verisi doğrulanır; şablon adımları o anki dilde, kullanıcı adımı aynen', () => {
  const M = require('../js/project-model.js');
  for (const name of ['local-storage-v1.json', 'projects-v1.json']) {
    const Migrate = require('../js/migrate.js');
    const legacy = JSON.parse(read(path.join(OLD, name)));
    assert.ok(Migrate.isLegacyProjects(legacy), `${name}: legacy format`);
    const data = Migrate.projects(legacy);
    assert.equal(M.validate(data), true, name);
    const k = data.projects[0];
    assert.ok(k.steps.every((a) => a.template === undefined), `${name}: eski kayıtta şablon anahtarı yok`);
    const previous = I18n.code();
    try {
      I18n.set('en');
      const names = k.steps.map(M.stepName);
      assert.equal(names[0], 'Prep / PDF', name);
      assert.equal(names[6], 'Sewing', name);
      assert.ok(names.includes('Ayraç takma'), `${name}: kullanıcının eklediği adım aynen: ${names}`);
      assert.equal(M.kindName(k.bindingType), 'Sewn signatures + hardcover (case binding)');
      I18n.set('tr');
      assert.deepEqual(k.steps.map(M.stepName), k.steps.map((a) => a.name), `${name}: Türkçede bugünkü adlar`);
    } finally { I18n.set(previous); }
    assert.deepEqual(Migrate.projects(data), data, 'conversion is idempotent');
  }
});

test('yeni kitap: adım şablon anahtarı + oluşturulduğu dildeki ad; dil değişince görünen ad değişir; JSON eski sürümle uyumlu', () => {
  const M = require('../js/project-model.js');
  const previous = I18n.code();
  try {
    I18n.set('en');
    const k = M.newProject({ name: 'Notebook', bindingType: 'sewn' });
    assert.equal(k.steps[6].template, 'sewing');
    assert.equal(k.steps[6].name, 'Sewing');
    I18n.set('tr');
    assert.equal(M.stepName(k.steps[6]), 'Dikiş');
    assert.equal(M.validate(JSON.parse(JSON.stringify({ version: 2, projects: [k] }))), true);
    const corrupt = JSON.parse(JSON.stringify({ version: 2, projects: [k] }));
    corrupt.projects[0].steps[0].template = 5;
    assert.throws(() => M.validate(corrupt), /şablon anahtarı metin olmalı/);
    const unknown = { ...k.steps[0], template: 'none_such', name: 'Elle' };
    assert.equal(M.stepName(unknown), 'Elle', 'bilinmeyen şablon anahtarı: kayıtlı ad');
  } finally { I18n.set(previous); }
});

// ---------------------------------------------------------------- düzeltme
const VECTOR = JSON.parse(read(path.join(__dirname, 'fixtures', 'i18n-vectors.json')));

test('Apple dil kuralı (JS): ortak vektörler (Rust i18n.rs aynı dosyayı sınar); tercih listesinde desteklenen ilk dil', () => {
  const D = fresh('en');
  assert.ok(VECTOR.system_language.length >= 5);
  for (const v of VECTOR.system_language) assert.equal(D.systemLanguage(v.list), v.expected, JSON.stringify(v.list));
  // asgari vektörler dosyada (silinirse test kalır)
  const key = (l) => JSON.stringify(l);
  const minimum = { '["tr-TR"]': 'tr', '["de-DE","tr-TR"]': 'tr', '["de-DE","fr-FR"]': 'en', '["en-GB","tr"]': 'en', '[]': 'en' };
  for (const [l, b] of Object.entries(minimum)) assert.ok(VECTOR.system_language.some((v) => key(v.list) === l && v.expected === b), `asgari vektör yok: ${l}`);
});

test('param fill single geçişli (JS): common vektörler (Rust aynı result gives); değer içindeki {x} doldurulmaz', () => {
  for (const v of VECTOR.fill) {
    const D = fresh(v.i18n);
    assert.equal(D.t(v.key, Object.fromEntries(v.p)), v.expected, JSON.stringify(v.p));
  }
});

test('uygula: anahtar hiçbir sözlükte yoksa öğenin mevcut (statik) metni anahtarla ezilmez', () => {
  const D = fresh('en');
  const element = (a, text) => ({ a, textContent: text, oz: {}, getAttribute(k) { return this.a[k]; }, setAttribute(k, v) { this.oz[k] = v; } });
  const m = element({ 'data-i18n': 'none.such.key' }, 'Static');
  const b = element({ 'data-i18n': 'none.such.key' }, '');
  const o = element({ 'data-i18n-oz': 'title:none.such.key', title: 'Static title' }, '');
  D.apply({ querySelectorAll: (s) => (s === '[data-i18n]' ? [m, b] : s === '[data-i18n-oz]' ? [o] : []) });
  assert.equal(m.textContent, 'Static');
  assert.equal(b.textContent, 'none.such.key', 'statik metin yoksa anahtar (eksik görünür)');
  assert.equal(o.oz.title, undefined, 'statik öznitelik ezilmedi');
  assert.ok(D.missingKeys().includes('none.such.key'), 'eksik yine kaydedilir');
});

// İngilizce metin birliği: en-US yazım, olumsuzlukta tek biçim (kısaltma), iç yol yok.
const BRITISH = /\b(centre[sd]?|centring|cancell(?:ed|ing|ation)|colou?rs?\b(?<=colours?)|colour(?:ed|ful|ing)?|behaviours?|favou?r(?<=favour)(?:s|ed|ite|ites)?|honours?|labours?|licence|organis(?:e|ed|es|ing|ation)|recognis(?:e|ed|es|ing)|customis(?:e|ed|es|ing)|initialis(?:e|ed|es|ing)|normalis(?:e|ed|es|ing)|optimis(?:e|ed|es|ing)|minimis(?:e|ed|es|ing)|maximis(?:e|ed|es|ing)|summaris(?:e|ed|es|ing)|prioritis(?:e|ed|es|ing)|utilis(?:e|ed|es|ing)|analys(?:e|ed|es|ing)|catalogue|fibres?|metres?|millimetres?|centimetres?|litres?|programmes?|travell(?:ed|ing|er)|labell(?:ed|ing)|modell(?:ed|ing)|judgement|grey|aluminium|enrol(?:s|ment)?|fulfil(?:s|ment)?|whilst|amongst|learnt|spelt|realis(?:e|ed|es|ing))\b/i;
const LONG_NEGATIVE = /\b(can ?not|could not|does not|did not|do not|is not|are not|was not|were not|will not|would not|should not|has not|have not|had not|must not)\b/i;
const INNER_PATH = /\b(?:docs|app|src-tauri|araclar|vendor|src|node_modules)\/|\.(?:md|rs|mjs|cjs)\b/;
function texts(s) {
  return Object.entries(s).filter(([a]) => !a.startsWith('_')).flatMap(([a, d]) => (typeof d === 'string' ? [[a, d]] : Object.entries(d).map(([k, v]) => [a + '.' + k, v])));
}
const faulty = (s, re) => texts(s).filter(([, m]) => re.test(m)).map(([a, m]) => `${a}: ${m}`);

test('en sözlüğü en-US yazımında: İngiliz yazımı kalıntısı yok (centre, cancelled, colour, behaviour …)', () => {
  assert.deepEqual(faulty(DICTIONARY, BRITISH), []);
});

test('en sözlüğünde olumsuzluk tek biçimde: kısaltma (can\'t, couldn\'t, doesn\'t, isn\'t …); "could not / cannot" yok', () => {
  assert.deepEqual(faulty(DICTIONARY, LONG_NEGATIVE), []);
  assert.ok(texts(DICTIONARY).filter(([, m]) => /n't\b/.test(m)).length >= 20, 'kısaltmalar gerçekten kullanılıyor');
});

test('kullanıcı metninde iç depo yolu yok (docs/, app/vendor/, .md …) — en ve tr', () => {
  for (const code of Object.keys(ACTUAL)) assert.deepEqual(faulty(I18n.extractJson(ACTUAL[code]), INNER_PATH), [], code);
});

test('metin birliği denetleyicileri kusurlu girdiyi yakalar, doğru biçimi geçirir', () => {
  const capture = ['Bottom centre', 'centred text', 'The dialog was cancelled.', 'Cancelling…', 'Colour', 'colours', 'odd behaviour', 'Licence', 'Organise files', 'initialised',
    'analyse', '5 millimetres', 'labelled', 'grey', 'Travelling', 'whilst', 'a favourite', 'Paper fibres', 'fibre'];
  const pass = ['Bottom center', 'The dialog was canceled.', 'Canceling…', 'Color', 'behavior', 'License', 'Organize', 'concentrate', 'centered', 'precise',
    'otherwise', 'promise', 'licensed', 'Analyze', 'program', 'canceled', 'flavor', 'cancel'];
  for (const m of capture) assert.ok(BRITISH.test(m), `İngiliz yazımı kaçtı: ${m}`);
  for (const m of pass) assert.ok(!BRITISH.test(m), `yanlış alarm: ${m}`);
  for (const m of ['could not be opened', 'Cannot open', 'can not', 'It is not valid', 'does not match', 'did not grant', "Don't", 'Do not use', 'will not work', 'are not'])
    assert.equal(LONG_NEGATIVE.test(m), !/n't/.test(m), m);
  for (const m of ["couldn't be opened", "can't", "isn't valid", 'Not saved (canceled)', 'not connected?', 'Notes', 'cannon']) assert.ok(!LONG_NEGATIVE.test(m), `yanlış alarm: ${m}`);
  for (const m of ['Source: docs/notlar/x.md.', 'files in app/vendor/ may be missing', '(vendor/literata/)', 'see README.md', 'src-tauri/src/i18n.rs']) assert.ok(INNER_PATH.test(m), `iç yol kaçtı: ${m}`);
  for (const m of ['META-INF/container.xml', 'e.g. my-book.pdf', 'encryption.xml could not', 'qpdf --decrypt input.pdf output.pdf', 'PDF / EPUB', '1/2 steps', 'mucellit-backup-{tarih}'])
    assert.ok(!INNER_PATH.test(m), `yanlış alarm: ${m}`);
  // gerçek sözlüğün bozulmuş kopyası
  const corrupt = { ...DICTIONARY, 'zz.ingiliz': 'Page numbers (bottom centre)', 'zz.olumsuz': 'pdf.js could not be loaded', 'zz.yol': 'see files in app/vendor/' };
  for (const re of [BRITISH, LONG_NEGATIVE, INNER_PATH]) assert.equal(faulty(corrupt, re).length, faulty(DICTIONARY, re).length + 1, String(re).slice(0, 30));
});

// Türkçe harfsiz (ASCII) Türkçe cümle sezgisi (26 sözcükten genişletildi + sık ekler).
const ASCII_TURKISH = ['Lutfen tekrar deneyin', 'Gecersiz deger girildi', 'Ayarlar kaydedilemedi', 'Yedek alinamadi', 'Sirt kalinligi hesaplanamadi',
  'Baski onizlemesi hazirlaniyor', 'Islem tamamlandi', 'Uyari: mukavva cok kalin', 'Tum kitaplar silinsin mi?', 'Adimlari sifirla', 'Secili sayfalari dondur',
  'Cikti uretilemedi', 'Iptal edildi', 'Kapak olcusu hesaplandi', 'Bu ayar degistirilemez', 'Dosya acilamadi', 'Forma sayisi yok', 'Kitap olusturuldu'];

test('tarama sezgisi: ASCII Türkçe cümleler yakalanır; İngilizce sözlük, statik HTML ve teknik dizgiler yanlış alarm vermez', () => {
  const escaping = ASCII_TURKISH.filter((m) => !isTurkish(m));
  assert.deepEqual(escaping, [], 'yakalanmayan ASCII Türkçe');
  const wrong = texts(DICTIONARY).filter(([, m]) => isTurkish(m)).map(([a, m]) => `${a}: ${m}`);
  assert.deepEqual(wrong, [], 'İngilizce metin Türkçe sanıldı');
  for (const m of ['system-ui, sans-serif', 'application/epub+zip', 'Mücellit', 'once more', 'Load a PDF once', 'Style guide', 'Somali', 'major update', 'hidden files', 'Sweden'])
    assert.equal(isTurkish(m), false, `yanlış alarm: ${m}`);
  assert.equal(isTurkish('Kaydet'), false, 'tek sözcük (boşluksuz) bilerek sayılmaz: kaynakta Türkçe tanıtıcılar çok (bilinen sınır)');
});

test('tarama sezgisi sınırları: CSS sınıfı/kimlik ve BÜYÜK HARFLİ makine kodu Türkçe sayılmaz; içindeki gerçek Türkçe sayılır', () => {
  for (const m of ['.surukleniyor, .hedef', '#kitap-listesi li', 'BULUNAMADI: {m}', 'GECERSIZ: {m}', 'DISKYOK: {ad}', 'kc-yedek-isleri calisiyor-x']) assert.equal(isTurkish(m), false, m);
  for (const m of ['BULUNAMADI: dosya silinmis', 'Hata: kayit silinemedi', 'DIKKAT tum veriler silinsin mi?']) assert.equal(isTurkish(m), true, m);
});

// ----------------------------------------------------------------
test('tr tauri.storage_hint "(otomatik yedeklenir)" (edilgen; "(otomatik yedekle)" emir kipi değil)', () => {
  const tr = I18n.extractJson(read(path.join(FOLDER, 'tr.js')));
  assert.match(tr['tauri.storage_hint'], /\(otomatik yedeklenir\)/);
  assert.doesNotMatch(tr['tauri.storage_hint'], /\(otomatik yedekle\)/);
});

// ----------------------------------------------------------------
test('tamamı BÜYÜK HARFLİ (ASCII) Türkçe metin yakalanır; makine kodu yalnız "KOD:" önekiyse sayılmaz', () => {
  const capture = ['DOSYA ACILAMADI', 'TUM VERILER SILINSIN MI?', 'KAYDEDILEMEDI, LUTFEN TEKRAR DENEYIN', 'UYARI: SAYFA BOS',
    'ISLEM IPTAL EDILDI', 'BULUNAMADI DOSYA SILINMIS', 'KITAP OLUSTURULDU', 'Dikkat: TUM KITAPLAR SILINECEK'];
  for (const m of capture) assert.equal(isTurkish(m), true, `kaçtı: ${m}`);
  // makine kodu (Rust → JS hata öneki; JS'te dile göre metne çevrilir) ve teknik büyük harfli dizgiler
  const pass = ['BULUNAMADI: {m}', 'GECERSIZ: {m}', 'DISKYOK: {ad}', 'BILINMEYEN: {}', 'ERISIM: {yol}', 'GECICI: {hata}', 'META-INF/container.xml',
    'OUT_DIR', 'CARGO_MANIFEST_DIR', 'EPUB → PDF', 'PDF EPUB JSON', 'UTF-8 BOM', 'DOMContentLoaded', 'HOME'];
  for (const m of pass) assert.equal(isTurkish(m), false, `yanlış alarm: ${m}`);
});

// ---------------------------------------------------------------- ondalık ayracı arayüz diline göre
test('sayı alanı biçimi dile göre (en nokta, tr virgül), binlik ayracı yok; boş/geçersiz → ""', () => {
  const once = I18n.code();
  try {
    I18n.set('en');
    assert.deepEqual([0.1, 1234.5, 297, 0, -2.5, 0.1234567, NaN, Infinity, '0.25', null].map((n) => I18n.numberField(n)), ['0.1', '1234.5', '297', '0', '-2.5', '0.123457', '', '', '0.25', '']);
    I18n.set('tr');
    assert.deepEqual([0.1, 1234.5, 297, 215.9].map((n) => I18n.numberField(n)), ['0,1', '1234,5', '297', '215,9']);
    assert.equal(I18n.number(10.4), '10,4', 'sonuç tablosu (mevcut sayi) tr virgül');
    I18n.set('en');
    assert.equal(I18n.number(10.4), '10.4');
  } finally { I18n.set(once); }
});

test('sayı girişi iki ayraçla da okunur (common.parseNumber / sayi)', () => {
  const ctx = { document: { getElementById: (id) => ({ value: { a: '0,5', b: '0.5', c: ' 12 ', d: '', e: 'abc' }[id] }) } };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(path.join(APP, 'js', 'common.js')), ctx);
  const O = ctx.Mucellit.common;
  assert.deepEqual(['0,5', '0.5', ' 12 ', '1,25', '-3,5'].map((s) => O.parseNumber(s)), [0.5, 0.5, 12, 1.25, -3.5]);
  assert.ok(['', 'abc', null, undefined, ','].every((s) => Number.isNaN(O.parseNumber(s))));
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((id) => O.number(id, -1)), [0.5, 0.5, 12, -1, -1]);
});

test('sayı alanları type=number değil (WebKit sistem bölgesiyle biçimliyordu); data-number + inputmode="decimal"', () => {
  const html = read(path.join(APP, 'index.html'));
  const numberFields = (h) => [...h.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((e) => /\sdata-number\b/.test(e) || /type="number"/.test(e));
  const errors = (h) => {
    const l = numberFields(h);
    const e = l.filter((x) => /type="number"/.test(x) || !/\sdata-number\b/.test(x) || !/inputmode="decimal"/.test(x) || !/type="text"/.test(x));
    return l.length >= 20 ? e : ['sayı alanı sayısı ' + l.length].concat(e);
  };
  assert.deepEqual(errors(html), []);
  // denetleyici kusurlu girdiyi yakalar
  const first = numberFields(html)[0];
  assert.ok(errors(html.replace(first, first.replace('type="text"', 'type="number"'))).length > 0, 'type=number');
  assert.ok(errors(html.replace(first, first.replace(' inputmode="decimal"', ''))).length > 0, 'inputmode yok');
  assert.ok(errors('<input type="text" data-number inputmode="decimal">').length > 0, 'skeleton (az field)');
  // dinamik alanlar (Süreç ayrıntısı, EPUB ayarları) da metin + data-sayi
  for (const d of ['projects.js', path.join('plugins', 'epub.js')]) {
    const k = read(path.join(APP, 'js', d));
    assert.doesNotMatch(k, /type: 'number'|'number'\)/, d);
    assert.match(k, /'data-number'/, d);
  }
});

// ---------------------------------------------------------------- tam ekran menü adı
// Görünüm menüsündeki tam ekran öğesi AppKit'in toggleFullScreen: öğesidir (muda PredefinedMenuItem::fullscreen). AppKit
// menü doğrulanırken (menü açılınca) başlığı kendi çevirisiyle değiştirir: "Enter Full Screen"/"Exit Full Screen"
// (tr: "Tam Ekrana Geç"/"Tam Ekrandan Çık"; gözlem: rapor). Sözlük AppKit'in metniyle aynı olmalı ki menü
// doğrulanmadan önce de sonra da aynı adı göstersin.
test('menu.full_screen iki dilde AppKit\'in kendi metni ("Enter Full Screen" ↔ "Tam Ekrana Geç")', () => {
  const en = I18n.extractJson(read(path.join(FOLDER, 'en.js'))), tr = I18n.extractJson(read(path.join(FOLDER, 'tr.js')));
  assert.deepEqual([en['menu.full_screen'], tr['menu.full_screen']], ['Enter Full Screen', 'Tam Ekrana Geç']);
  const loctable = '/System/Library/Frameworks/AppKit.framework/Resources/MenuCommands.loctable';
  if (process.platform === 'darwin' && fs.existsSync(loctable)) {
    const j = JSON.parse(require('node:child_process').execFileSync('plutil', ['-convert', 'json', '-o', '-', loctable]).toString());
    assert.deepEqual([j.en['Enter Full Screen'], j.tr['Enter Full Screen']], [en['menu.full_screen'], tr['menu.full_screen']], 'AppKit MenuCommands.loctable');
  }
});
