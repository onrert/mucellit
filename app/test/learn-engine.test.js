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

const UYGULAMA = path.join(__dirname, '..');
const REPO = path.join(UYGULAMA, '..');
const OGREN = path.join(UYGULAMA, 'js', 'learn');
const oku = (y) => fs.readFileSync(y, 'utf8');
const INDEX = oku(path.join(UYGULAMA, 'index.html'));
const MOTOR = oku(path.join(OGREN, 'cf-engine.js'));

function dosyalar(d = OGREN, l = []) {
  for (const g of fs.readdirSync(d, { withFileTypes: true })) { const y = path.join(d, g.name); if (g.isDirectory()) dosyalar(y, l); else if (g.name.endsWith('.js')) l.push(y); }
  return l.sort();
}

// ---------------------------------------------------------------- 1. lisans
const notVar = (metin) => { const bas = String(metin).split('\n').slice(0, 30).join('\n'); return /MIT/.test(bas) && /LICENSE/.test(bas); };
const notDenetle = (liste, okuFn) => liste.filter((f) => !notVar(okuFn(f))).map((f) => path.relative(UYGULAMA, f));
function lisansDenetle(metin) {
  const s = [];
  if (!/^MIT License\b/.test(metin)) s.push('MIT başlığı yok');
  for (const p of ['April Zhu', 'Tolga Cohce', 'Permission is hereby granted', 'The above copyright notice and this permission notice shall be included', 'WITHOUT WARRANTY OF ANY KIND']) if (!metin.includes(p)) s.push('eksik: ' + p);
  return s;
}

test('lisans: her rehber dosyasında (js/learn/**, css/learn.css) MIT notu; LICENSE Colorfigures MIT metni; README atfı', () => {
  const l = [...dosyalar(), path.join(UYGULAMA, 'css', 'learn.css')];
  assert.equal(l.length, 15);
  assert.deepEqual(notDenetle(l, oku), []);
  assert.deepEqual(lisansDenetle(oku(path.join(OGREN, 'LICENSE'))), []);
  const readme = oku(path.join(REPO, 'README.md'));
  assert.match(readme, /Colorfigures/);
  assert.match(readme, /MIT/);
  assert.match(readme, /April Zhu/);
  assert.match(readme, /Tolga Cohce/);
  assert.match(readme, /app\/js\/learn\/LICENSE/);
});

test('lisans: 8 figür credit:false; motor credit:false iken "Made with" bağlantısını çizmez (dış adres yok)', () => {
  const sekiller = fs.readdirSync(path.join(OGREN, 'figures')).filter((f) => f.endsWith('.js') && f !== 'common.js');
  assert.equal(sekiller.length, 8);
  for (const f of sekiller) assert.match(oku(path.join(OGREN, 'figures', f)), /credit:\s*false/, f);
  assert.match(MOTOR, /cfg\.credit === false \? ''/);
});

test('lisans denetleyicileri kusurlu girdiyi yakalar (notsuz dosya, boş dosya, not 30. satırdan sonra, eksik/iskelet LICENSE)', () => {
  const hedef = path.join(OGREN, 'figures', 'book.js'), asil = oku(hedef);
  const notsuz = asil.split('\n').filter((s) => !/MIT|LICENSE/.test(s)).join('\n');
  assert.deepEqual(notDenetle(dosyalar(), (f) => (f === hedef ? notsuz : oku(f))), [path.join('js', 'learn', 'figures', 'book.js')]);
  assert.equal(notVar(''), false);
  assert.equal(notVar('\n'.repeat(40) + '// MIT LICENSE'), false);
  assert.ok(lisansDenetle('').length > 0);
  assert.ok(lisansDenetle('MIT License\n').length > 0, 'iskelet');
  assert.ok(lisansDenetle(oku(path.join(OGREN, 'LICENSE')).replace(/Tolga Cohce/g, 'X')).length > 0, 'telif adı eksik');
  assert.ok(!/credit:\s*false/.test(asil.replace(/credit:\s*false/g, 'credit: true')));
});

// ---------------------------------------------------------------- 2. motor
function motorYukle(kaynak) {
  const dinleyici = [], dataset = {};
  const ctx = { Math, JSON, Object, Array, String, Number, Set, Map, URLSearchParams, isFinite, console,
    document: { getElementById: () => null, documentElement: { dataset } }, addEventListener: (tip, fn) => dinleyici.push([tip, fn]) };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(kaynak, ctx, { filename: 'cf-engine.js' });
  return { ctx, cf: ctx.KitapCilt && ctx.KitapCilt.ogren && ctx.KitapCilt.ogren.cf, dinleyici, dataset };
}
const KOTU = 'A"<b>&x';
function kacisDenetle(cf) {
  const sorun = [], t = cf.tag([0, 0, 0], 10, 10, KOTU), y = cf.tx(0, 0, 0, KOTU, 8), y2 = cf.txY(0, 0, 0, KOTU, 8);
  if (!t.includes('data-t="A&quot;&lt;b&gt;&amp;x"')) sorun.push('tag data-t kaçışsız');
  if (!t.includes('>A&quot;&lt;b&gt;&amp;x</text>')) sorun.push('tag metni kaçışsız');
  for (const [ad, s] of [['tag', t], ['tx', y], ['txY', y2]]) if (s.includes('<b>') || /data-t="A"/.test(s)) sorun.push(ad + ': ham < ya da " var');
  if (!y.includes('A&quot;&lt;b&gt;&amp;x</text>')) sorun.push('tx kaçışsız');
  if (!y2.includes('A&quot;&lt;b&gt;&amp;x</text>')) sorun.push('txY kaçışsız');
  return sorun;
}
/** Test kalıntısı: pencere 'error' dinleyicisi ya da html[data-errors] yazımı (boş = yok). */
function kalintiDenetle(kaynak) {
  const m = motorYukle(kaynak), s = [];
  if (m.dinleyici.some(([tip]) => tip === 'error')) s.push('window error dinleyicisi');
  for (const [, fn] of m.dinleyici) { try { fn({ message: 'x' }); } catch (_) { /* yok sayılır */ } }
  if ('errors' in m.dataset) s.push('html[data-errors]');
  if (/dataset\.errors|_hataDinleyici/.test(kaynak)) s.push('kaynakta hata kaydı');
  return s;
}

test('motor: etiket ve yazı metinleri kaçışlı; test hata kaydı (error dinleyicisi, data-errors) üründe yok', () => {
  assert.deepEqual(kacisDenetle(motorYukle(MOTOR).cf), []);
  assert.deepEqual(kalintiDenetle(MOTOR), []);
});

test('motor denetleyicileri bozuk kopyaları yakalar (kusurlu girdi sınaması)', () => {
  const deg = (a, b) => { assert.ok(MOTOR.includes(a), 'varyant uygulanamadı: ' + a.slice(0, 40)); return MOTOR.replace(a, b); };
  const kacisBozuk = {
    'tag data-t kaçışsız': deg('data-t="${esc(text)}"', 'data-t="${text}"'),
    'tag metni kaçışsız': deg('${u ? n : esc(text)}</text></g>`;', '${u ? n : text}</text></g>`;'),
    'tx kaçışsız (ikisi)': MOTOR.split('letter-spacing=".04em">${esc(str)}</text>').join('letter-spacing=".04em">${str}</text>'),
    'esc boş işlev': deg('const esc = s => String(s).replace', 'const esc = s => String(s); void String.prototype.replace'),
  };
  for (const [ad, k] of Object.entries(kacisBozuk)) { assert.notEqual(k, MOTOR, ad); assert.ok(kacisDenetle(motorYukle(k).cf).length > 0, ad + ' yakalanmadı'); }
  const geriKoy = "if (!KC._hataDinleyici){ KC._hataDinleyici = true; const kayit = [];\n  kok.addEventListener('error', e => { kayit.push(String(e.message)); document.documentElement.dataset.errors = kayit.join(';'); }); }\nfunction mountFigure(cfg){";
  assert.ok(kalintiDenetle(deg('function mountFigure(cfg){', geriKoy)).length > 0, 'hata kaydı geri gelirse yakalanır');
  assert.ok(kalintiDenetle(deg('function mountFigure(cfg){', "kok.addEventListener('error', () => {});\nfunction mountFigure(cfg){")).length > 0, 'yalnız dinleyici');
});

// ---------------------------------------------------------------- 3. ad alanı (bütün rehber betikleri)
const BETIKLER = [...INDEX.matchAll(/<script\s+src="(js\/learn\/[^"]+)"/g)].map((m) => m[1]);
/** Rehber betiklerini index.html sırasıyla yükler; küresel kapsama eklenen adlar (özellik + sözcüksel). */
function adAlani(kaynaklar) {
  const bos = vm.createContext({});
  const temel = new Set(vm.runInContext('Object.getOwnPropertyNames(this)', bos));
  const ctx = vm.createContext({});
  vm.runInContext('var self = this; self.KitapCilt = { dil: { t: function (a) { return a; } } };', ctx);
  temel.add('self');
  for (const [ad, k] of kaynaklar) vm.runInContext(k, ctx, { filename: ad });
  const eklenen = Array.from(vm.runInContext('Object.getOwnPropertyNames(this)', ctx)).filter((a) => !temel.has(a) && a !== 'KitapCilt');
  // sözcüksel küresel bağlar (const/let/class) Object.getOwnPropertyNames'te görünmez: bildirilen her ad sorulur
  const aday = new Set();
  for (const [, k] of kaynaklar) {
    const s = k.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const m of s.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) aday.add(m[1]);
  }
  const sozcuksel = [...aday].filter((a) => !temel.has(a) && a !== 'KitapCilt' && vm.runInContext(`typeof ${a} !== 'undefined'`, ctx));
  const og = vm.runInContext('KitapCilt.ogren', ctx);
  return { eklenen, sozcuksel, anahtarlar: og ? Array.from(Object.keys(og)).sort() : [], cfDonmus: !!(og && og.cf && Object.isFrozen(og.cf)) };
}

test('ad alanı: 14 rehber betiği yüklenince küresel kapsama KitapCilt dışında ad eklenmez; KitapCilt.ogren altında; cf donmuş', () => {
  assert.equal(BETIKLER.length, 14);
  const r = adAlani(BETIKLER.map((b) => [b, oku(path.join(UYGULAMA, b))]));
  assert.deepEqual(r.eklenen, [], 'küresel özellik');
  assert.deepEqual(r.sozcuksel, [], 'küresel sözcüksel ad');
  assert.ok(r.cfDonmus, 'KitapCilt.ogren.cf donmuş');
  for (const a of ['olcu', 'cf', 'cfKur', 'sekil', 'dersler', 'sekme']) assert.ok(r.anahtarlar.includes(a), a);
  // test arayüzü (denetim) üründe yok; yalnız e2e test kopyasına ekler (learn-fixes.test.js O2)
  assert.ok(!r.anahtarlar.includes('denetim'), 'KitapCilt.ogren.denetim üründe');
});

test('ad alanı denetleyicisi sızan küresel adı yakalar (kusurlu girdi sınaması)', () => {
  const temiz = BETIKLER.map((b) => [b, oku(path.join(UYGULAMA, b))]);
  const boz = (dosya, fn) => temiz.map(([b, k]) => [b, b === dosya ? fn(k) : k]);
  const ogrenJs = 'js/learn/learn.js';
  const varyant = {
    'üst düzey const': boz('js/learn/learn-lessons.js', (k) => k + '\nconst SIZAN = 1;'),
    'üst düzey işlev': boz(ogrenJs, (k) => k + '\nfunction sizanIslev() {}'),
    'self özelliği': boz('js/learn/figures/common.js', (k) => k + '\nself.__st = {};'),
    'IIFE kaldırılmış (motor)': boz('js/learn/cf-engine.js', (k) => { const y = k.replace("(function (kok) {\nkok.KitapCilt", 'var kok = self;\nkok.KitapCilt').replace(/\}\)\(typeof self !== 'undefined' \? self : this\);\s*$/, '\n'); assert.notEqual(y, k); return y; }),
    'cf donmamış': boz('js/learn/cf-engine.js', (k) => { const y = k.replace('KC.cf = Object.freeze({', 'KC.cf = ({'); assert.notEqual(y, k); return y; }),
  };
  for (const [ad, k] of Object.entries(varyant)) {
    const r = adAlani(k);
    assert.ok(r.eklenen.length > 0 || r.sozcuksel.length > 0 || !r.cfDonmus, ad + ' yakalanmadı');
  }
});
