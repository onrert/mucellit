'use strict';
/*
 * learn-fixes.test.js — düzeltme testleri, tarayıcısız:
 *  O2. Denetim arayüzü (KitapCilt.ogren.denetim) üründe yok; yalnız test enjeksiyonuyla (app/test/learn-probe.cjs) gelir.
 *  D3. cf-page.js söküm: rAF kimlikleri yalnız cancelAnimationFrame, setTimeout kimlikleri yalnız clearTimeout ile iptal.
 *  D4. i18n-scan.js uygulama adı muafiyeti sözcük sınırlı ("Mücellitler" yakalanır).
 *  D5. Tek terim: en "joint gap" (Hesapla ve rehber), "hinge" yok; tr "mafsal".
 *  D7. Rehberde MIT lisansının tam metni (index.html, #og-lisans-metin) = js/learn/LICENSE.
 * (O1 ⌘4 yeniden kurulum, D6 dil değişiminde ilerleme: tarayıcı gerektirir, e2e.mjs "düzeltme" kontrolleri.)
 * Her denetleyici kusurlu girdide "kaldı" der.
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

// ---------------------------------------------------------------- O2: denetim arayüzü üründe yok
/** Kaynak taraması: ürün rehber dosyalarında "denetim" sözcüğü (kod ya da yorum) geçen dosyalar. */
const sourceLeftover = (list) => list.filter(([, k]) => /probe/i.test(k)).map(([name]) => name);
/** 14 betiği vm'de index.html sırasıyla yükler; KitapCilt.ogren anahtarları. */
function keys(sources) {
  const ctx = vm.createContext({});
  vm.runInContext('var self = this; self.Mucellit = { i18n: { t: function (a) { return a; }, code: function () { return "tr"; } } };', ctx);
  for (const [name, k] of sources) vm.runInContext(k, ctx, { filename: name });
  return { key: Object.keys(vm.runInContext('Mucellit.learn', ctx)).sort(), ctx };
}
const PRODUCT = SCRIPTS.map((b) => [b, read(path.join(APP, b))]);
const ile = (file, fn) => PRODUCT.map(([b, k]) => [b, b === file ? fn(k) : k]);

test('O2: ürün rehber betiklerinde denetim arayüzü yok (kaynak taraması + yüklenince Mucellit.learn.probe yok)', () => {
  assert.equal(SCRIPTS.length, 14);
  const all = files().filter((f) => f.endsWith('.js')).map((f) => [path.relative(APP, f), read(f)]);
  assert.equal(all.length, 14);
  assert.deepEqual(sourceLeftover(all), []);
  const r = keys(PRODUCT);
  assert.ok(!r.key.includes('probe'), 'Mucellit.learn.probe üründe: ' + r.key.join(','));
  for (const a of ['size', 'cf', 'cfKur', 'figures', 'lessons', 'tab']) assert.ok(r.key.includes(a), a);
});

test('O2: test enjeksiyonu (learn-probe.cjs) denetim arayüzünü yalnız test kopyasına ekler; ürün dosyası değişmez', () => {
  const product = read(path.join(APP, LEARN_JS));
  const test1 = inject(product);
  assert.notEqual(test1, product);
  assert.ok(test1.startsWith(product.slice(0, product.lastIndexOf('})('))), 'ürün kodu aynen, ek yalnız kapanıştan önce');
  const r = keys(ile(LEARN_JS, inject));
  assert.ok(r.key.includes('probe'));
  const D = vm.runInContext('Mucellit.learn.probe', r.ctx);
  for (const a of ['state', 'setup', 'run', 'play', 'fromStartToEnd', 'next', 'previous', 'numbers', 'takeFromCalculator', 'render', 'still', 'camera', 'missingKeys', 'lessons']) assert.ok(a in D, a);
  assert.equal(D.lessons.length, 10);
  assert.equal(read(path.join(APP, LEARN_JS)), product);
});

test('O2 kusurlu girdi: kalıntı denetleyicileri geri konan denetimi yakalar; enjeksiyon yanlış dosyayı reddeder', () => {
  // geri konan arayüz (kaynak ve çalışma anı ayrı ayrı)
  const restored = ile(LEARN_JS, (k) => k.replace('MC.tab = { show, hide };', 'MC.tab = { show, hide };\n  MC.probe = { setup };'));
  assert.notDeepEqual(restored, PRODUCT);
  assert.deepEqual(sourceLeftover(restored), [LEARN_JS]);
  assert.ok(keys(restored).key.includes('probe'), 'çalışma anı denetimi yakalar');
  assert.deepEqual(sourceLeftover([['a.js', '// Mucellit.learn.probe: yanlış yorum']]), ['a.js'], 'yorumdaki iz de yakalanır');
  // enjeksiyon: boş, iskelet, kopya (iki kapanış), kapanıştan sonra kod, başka dosya
  const product = read(path.join(APP, LEARN_JS));
  const bad = {
    blank: '', none: null, skeleton: "(function (root) {\n})(typeof self !== 'undefined' ? self : this);\n", copy: product + '\n' + product,
    afterCode: product + '\nMucellit.x = 1;\n', otherFile: read(path.join(LEARN, 'cf-page.js')),
  };
  for (const [name, k] of Object.entries(bad)) assert.throws(() => inject(k), /learn-probe/, name);
});

// ---------------------------------------------------------------- D3: cf-sayfa söküm, zamanlayıcı kimlikleri ayrı
/** Her özelliği yutan sahte DOM öğesi (çağrılabilir, yinelenebilir, sayıya çevrilince 0). */
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
/** cf-page.js'i sahte motor ve DOM ile çalıştırır, sonra söker; zamanlayıcı kimliklerinin iptal yolu. */
function checkTeardown(source) {
  // rAF ve setTimeout kimlik alanları kesişsin: ikisi de 1'den sayar (gerçek tarayıcıda da ayrı sayaçlar)
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
  ctx.Mucellit.learn.cfKur({ text: {} });
  const givenRaf = [...raf], givenZmn = [...zmn];
  // çakışan kimlik: rAF 1 ile setTimeout 1 aynı sayı. Doğru söküm: her rAF kimliği cancelAnimationFrame ile, her
  // setTimeout kimliği clearTimeout ile, bir kez; yanlış işlevle iptal (uygulamanın aynı numaralı zamanlayıcısı) yok.
  for (const f of clear) f();
  const s = [];
  const say = (l) => l.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const cr = say(cancelRaf.filter((x) => x !== 0)), cz = say(cancelZmn);
  if (givenRaf.length < 2 || givenZmn.length < 1) s.push(`beklenen zamanlayıcılar kurulmadı (rAF ${givenRaf.length}, setTimeout ${givenZmn.length})`);
  for (const id of givenRaf) if (cr.get(id) !== 1) s.push(`rAF ${id}: cancelAnimationFrame ${cr.get(id) || 0} times`);
  for (const id of givenZmn) if (cz.get(id) !== 1) s.push(`setTimeout ${id}: clearTimeout ${cz.get(id) || 0} times`);
  if (cancelZmn.length !== givenZmn.length) s.push(`clearTimeout ${cancelZmn.length} çağrı, ${givenZmn.length} zamanlayıcı (rAF kimliği clearTimeout'a gitti)`);
  if (cr.size && [...cr.values()].reduce((a, b) => a + b, 0) !== givenRaf.length) s.push(`cancelAnimationFrame ${[...cr.values()].reduce((a, b) => a + b, 0)} çağrı, ${givenRaf.length} rAF (setTimeout kimliği cancelAnimationFrame'e gitti)`);
  return s;
}
const PAGE = read(path.join(LEARN, 'cf-page.js'));

test('D3: cf-page söküm: rAF kimlikleri yalnız cancelAnimationFrame, setTimeout kimlikleri yalnız clearTimeout ile (birer kez)', () => {
  assert.deepEqual(checkTeardown(PAGE), []);
});

test('D3 kusurlu girdi: karışık dizi (eski söküm), eksik iptal ve ters iptal yakalanır', () => {
  const old = "const time = [];\n  ui.clear(() => { time.forEach(id => { clearTimeout(id); cancelAnimationFrame(id); }); });";
  const mixed = PAGE.replace(/const raf = \[\], time = \[\];\n {2}ui\.clear\([^\n]*\n/, old + '\n').replace(/raf\.push\(/g, 'time.push(');
  assert.notEqual(mixed, PAGE, 'karışık varyant uygulanamadı');
  assert.ok(checkTeardown(mixed).length > 0, 'karışık dizi yakalanmadı');
  const noCancel = PAGE.replace(/raf\.forEach\(cancelAnimationFrame\)/, 'void 0');
  assert.notEqual(noCancel, PAGE);
  assert.ok(checkTeardown(noCancel).length > 0, 'rAF iptali eksik yakalanmadı');
  const reversed = PAGE.replace(/raf\.forEach\(cancelAnimationFrame\)/, 'raf.forEach(id => clearTimeout(id))');
  assert.notEqual(reversed, PAGE);
  assert.ok(checkTeardown(reversed).length > 0, 'ters iptal yakalanmadı');
});

// ---------------------------------------------------------------- D4: muafiyet sözcük sınırlı
test('D4: uygulama adı muafiyeti yalnız tam ad ("Mücellit", "MUCELLIT"); uzantılı Türkçe sözcük yakalanır', () => {
  for (const m of ['Mücellit', 'MUCELLIT', 'Mücellit v1', 'MUCELLIT 2026']) assert.equal(isTurkish(m), false, `yanlış alarm: ${m}`);
  for (const m of ['Mücellitler', 'Mücellitin', 'Mücellite acildi', 'YENI Mücellitler', 'Mücellitçi']) assert.equal(isTurkish(m), true, `kaçtı: ${m}`);
});

// ---------------------------------------------------------------- D5: tek terim
const EN = I18n.extractJson(read(path.join(APP, 'i18n', 'en.js')));
const TR = I18n.extractJson(read(path.join(APP, 'i18n', 'tr.js')));
// f ölçüsünü adlandıran metinler (Hesapla + hesap nedenleri + rehber paneli/notu)
const JOINT_KEY = ['calculator.jointGap', 'calculator.result.jointGap', 'calculator.warning.jointGap', 'calculator.rule.onlyS', 'calculator.description', 'calc.name.jointGap',
  'calc.name.board_width', 'calc.reason.joint_gap_too_large', 'learn.p.jointGap', 'learn.numbers_note', 'learn.cover.board.description', 'learn.cover.covering.description'];
function checkTerm(en, tr) {
  const s = [];
  const flat = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  for (const [a, v] of Object.entries(en)) if (/hinge/i.test(flat(v))) s.push(`en ${a}: "hinge"`);
  for (const a of JOINT_KEY) {
    if (!(a in en) || !/joint gap/i.test(flat(en[a]))) s.push(`en ${a}: "joint gap" yok`);
    if (!(a in tr) || !/mafsal/i.test(flat(tr[a]))) s.push(`tr ${a}: "mafsal" yok`);
  }
  return s;
}
test('D5: mafsal (f) ölçüsü en-US\'de tek terim "joint gap" (Hesapla ve rehber), "hinge" yok; tr "mafsal"', () => {
  assert.deepEqual(checkTerm(EN, TR), []);
});
test('D5 kusurlu girdi: tek bir "hinge gap" geri gelirse, terim silinirse ya da tr değişirse yakalanır', () => {
  assert.ok(checkTerm({ ...EN, 'calculator.result.jointGap': 'Hinge gap f' }, TR).length > 0);
  assert.ok(checkTerm({ ...EN, 'learn.s.book.jointGap': 'HINGE' }, TR).length > 0, 'figür etiketi');
  assert.ok(checkTerm({ ...EN, 'learn.p.jointGap': 'Gap f' }, TR).length > 0);
  assert.ok(checkTerm(EN, { ...TR, 'learn.p.jointGap': 'Menteşe f' }).length > 0);
  assert.ok(checkTerm({}, {}).length > 0, 'boş sözlük');
});

// ---------------------------------------------------------------- D7: lisans metni rehberde
const cozHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function licensePanel(html, license) {
  const s = [];
  const d = html.match(/<details\b[^>]*\bid="og-license"[^>]*>([\s\S]*?)<\/details>/);
  if (!d) return ['#og-license (details) yok'];
  const top = html.slice(html.indexOf('id="og-root"'), html.indexOf('</section>', html.indexOf('id="tab-learn"')));
  if (!top.includes('id="og-license"')) s.push('lisans paneli Öğren sekmesinin içinde değil');
  const summary = d[1].match(/<summary\b[^>]*\bdata-i18n="([^"]+)"[^>]*>([^<]*)<\/summary>/);
  if (!summary) s.push('summary (data-i18n) yok');
  else if (!(summary[1] in EN) || !(summary[1] in TR) || !summary[2].trim()) s.push('summary anahtarı sözlükte değil ya da boş: ' + summary[1]);
  const pre = d[1].match(/<pre\b[^>]*\bid="og-license-text"[^>]*>([\s\S]*?)<\/pre>/);
  if (!pre) s.push('#og-license-text yok');
  else if (cozHtml(pre[1]).trim() !== String(license).trim()) s.push('panel metni LICENSE ile aynı değil');
  if (pre && !/\blang="en"/.test(pre[0])) s.push('lisans metni lang="en" değil (Türkçe arayüzde İngilizce hukuk metni)');
  return s;
}
const LICENSE = read(path.join(LEARN, 'LICENSE'));
test('D7: Öğren sekmesinde açılır lisans paneli; metin js/learn/LICENSE ile birebir; dipnot paneli gösterir', () => {
  assert.deepEqual(licensePanel(INDEX, LICENSE), []);
  for (const S of [EN, TR]) assert.doesNotMatch(S['learn.license'], /LICENSE/, 'kullanıcının erişemediği dosyaya yönlendirme yok');
});
test('D7 kusurlu girdi: panelsiz, boş, iskelet, farklı metin, sekme dışında panel yakalanır', () => {
  const pre = INDEX.match(/(<pre\b[^>]*id="og-license-text"[^>]*>)([\s\S]*?)(<\/pre>)/);
  assert.ok(pre, 'panel yok');
  assert.ok(licensePanel(INDEX.replace(/<details\b[^>]*id="og-license"[\s\S]*?<\/details>/, ''), LICENSE).length > 0, 'withoutPanel');
  assert.ok(licensePanel(INDEX.replace(pre[0], pre[1] + pre[3]), LICENSE).length > 0, 'boş');
  assert.ok(licensePanel(INDEX.replace(pre[0], pre[1] + 'MIT License' + pre[3]), LICENSE).length > 0, 'skeleton');
  assert.ok(licensePanel(INDEX.replace(pre[0], pre[0].replace('Tolga Cohce', 'X')), LICENSE).length > 0, 'farklı');
  const panel = INDEX.match(/<details\b[^>]*id="og-license"[\s\S]*?<\/details>/)[0];
  assert.ok(licensePanel(INDEX.replace(panel, '').replace('</body>', panel + '</body>'), LICENSE).length > 0, 'sekme dışında');
});
