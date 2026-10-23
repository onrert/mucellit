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
const { turkceMi } = require('./i18n-scan.js');
const { enjekte } = require('./learn-probe.cjs');
const Dil = require('../js/i18n.js');

const UYGULAMA = path.join(__dirname, '..');
const OGREN = path.join(UYGULAMA, 'js', 'learn');
const oku = (y) => fs.readFileSync(y, 'utf8');
const INDEX = oku(path.join(UYGULAMA, 'index.html'));
const BETIKLER = [...INDEX.matchAll(/<script\s+src="(js\/learn\/[^"]+)"/g)].map((m) => m[1]);
const OGREN_JS = 'js/learn/learn.js';
function dosyalar(d = OGREN, l = []) {
  for (const g of fs.readdirSync(d, { withFileTypes: true })) { const y = path.join(d, g.name); if (g.isDirectory()) dosyalar(y, l); else l.push(y); }
  return l.sort();
}

// ---------------------------------------------------------------- O2: denetim arayüzü üründe yok
/** Kaynak taraması: ürün rehber dosyalarında "denetim" sözcüğü (kod ya da yorum) geçen dosyalar. */
const kaynakKalintisi = (liste) => liste.filter(([, k]) => /denetim/i.test(k)).map(([ad]) => ad);
/** 14 betiği vm'de index.html sırasıyla yükler; KitapCilt.ogren anahtarları. */
function anahtarlar(kaynaklar) {
  const ctx = vm.createContext({});
  vm.runInContext('var self = this; self.KitapCilt = { dil: { t: function (a) { return a; }, kod: function () { return "tr"; } } };', ctx);
  for (const [ad, k] of kaynaklar) vm.runInContext(k, ctx, { filename: ad });
  return { anahtar: Object.keys(vm.runInContext('KitapCilt.ogren', ctx)).sort(), ctx };
}
const URUN = BETIKLER.map((b) => [b, oku(path.join(UYGULAMA, b))]);
const ile = (dosya, fn) => URUN.map(([b, k]) => [b, b === dosya ? fn(k) : k]);

test('O2: ürün rehber betiklerinde denetim arayüzü yok (kaynak taraması + yüklenince KitapCilt.ogren.denetim yok)', () => {
  assert.equal(BETIKLER.length, 14);
  const tum = dosyalar().filter((f) => f.endsWith('.js')).map((f) => [path.relative(UYGULAMA, f), oku(f)]);
  assert.equal(tum.length, 14);
  assert.deepEqual(kaynakKalintisi(tum), []);
  const r = anahtarlar(URUN);
  assert.ok(!r.anahtar.includes('denetim'), 'KitapCilt.ogren.denetim üründe: ' + r.anahtar.join(','));
  for (const a of ['olcu', 'cf', 'cfKur', 'sekil', 'dersler', 'sekme']) assert.ok(r.anahtar.includes(a), a);
});

test('O2: test enjeksiyonu (learn-probe.cjs) denetim arayüzünü yalnız test kopyasına ekler; ürün dosyası değişmez', () => {
  const urun = oku(path.join(UYGULAMA, OGREN_JS));
  const test1 = enjekte(urun);
  assert.notEqual(test1, urun);
  assert.ok(test1.startsWith(urun.slice(0, urun.lastIndexOf('})('))), 'ürün kodu aynen, ek yalnız kapanıştan önce');
  const r = anahtarlar(ile(OGREN_JS, enjekte));
  assert.ok(r.anahtar.includes('denetim'));
  const D = vm.runInContext('KitapCilt.ogren.denetim', r.ctx);
  for (const a of ['durum', 'kur', 'calistir', 'oynat', 'bastanSona', 'sonraki', 'onceki', 'sayilar', 'hesapladanAl', 'render', 'durgun', 'kamera', 'eksikler', 'dersler']) assert.ok(a in D, a);
  assert.equal(D.dersler.length, 10);
  assert.equal(oku(path.join(UYGULAMA, OGREN_JS)), urun);
});

test('O2 kusurlu girdi: kalıntı denetleyicileri geri konan denetimi yakalar; enjeksiyon yanlış dosyayı reddeder', () => {
  // geri konan arayüz (kaynak ve çalışma anı ayrı ayrı)
  const geri = ile(OGREN_JS, (k) => k.replace('KC.sekme = { goster, gizle };', 'KC.sekme = { goster, gizle };\n  KC.denetim = { kur };'));
  assert.notDeepEqual(geri, URUN);
  assert.deepEqual(kaynakKalintisi(geri), [OGREN_JS]);
  assert.ok(anahtarlar(geri).anahtar.includes('denetim'), 'çalışma anı denetimi yakalar');
  assert.deepEqual(kaynakKalintisi([['a.js', '// KitapCilt.ogren.denetim: yanlış yorum']]), ['a.js'], 'yorumdaki iz de yakalanır');
  // enjeksiyon: boş, iskelet, kopya (iki kapanış), kapanıştan sonra kod, başka dosya
  const urun = oku(path.join(UYGULAMA, OGREN_JS));
  const kotu = {
    bos: '', yok: null, iskelet: "(function (kok) {\n})(typeof self !== 'undefined' ? self : this);\n", kopya: urun + '\n' + urun,
    sonrasindaKod: urun + '\nKitapCilt.x = 1;\n', baskaDosya: oku(path.join(OGREN, 'cf-page.js')),
  };
  for (const [ad, k] of Object.entries(kotu)) assert.throws(() => enjekte(k), /ogren-denetim/, ad);
});

// ---------------------------------------------------------------- D3: cf-sayfa söküm, zamanlayıcı kimlikleri ayrı
/** Her özelliği yutan sahte DOM öğesi (çağrılabilir, yinelenebilir, sayıya çevrilince 0). */
function sahte() {
  const onbellek = new Map();
  const p = new Proxy(function () {}, {
    get(_, k) {
      if (k === Symbol.iterator) return function* () {};
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      if (!onbellek.has(k)) onbellek.set(k, sahte());
      return onbellek.get(k);
    },
    set(_, k, v) { onbellek.set(k, v); return true; },
    apply() { return sahte(); },
    construct() { return sahte(); },
  });
  return p;
}
/** cf-page.js'i sahte motor ve DOM ile çalıştırır, sonra söker; zamanlayıcı kimliklerinin iptal yolu. */
function sokumDenetle(kaynak) {
  // rAF ve setTimeout kimlik alanları kesişsin: ikisi de 1'den sayar (gerçek tarayıcıda da ayrı sayaçlar)
  let r = 0, z = 0;
  const raf = new Set(), zmn = new Set(), iptalRaf = [], iptalZmn = [];
  const temizle = [];
  const ui = new Proxy({}, { get(_, k) { if (k === 'temizle') return (f) => temizle.push(f); if (k === 'then') return undefined; return () => undefined; } });
  const ctx = vm.createContext({
    Math, JSON, Map, Set, String, Number, Object, Array,
    innerWidth: 1280, innerHeight: 860, window: sahte(), document: sahte(), MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => { r += 1; raf.add(r); return r; }, cancelAnimationFrame: (id) => iptalRaf.push(id),
    setTimeout: () => { z += 1; zmn.add(z); return z; }, clearTimeout: (id) => iptalZmn.push(id),
  });
  ctx.self = ctx;
  ctx.KitapCilt = { ogren: { cf: { mountFigure: () => ui, xrMount: () => undefined } } };
  vm.runInContext(kaynak, ctx, { filename: 'cf-page.js' });
  ctx.KitapCilt.ogren.cfKur({ metin: {} });
  const verilenRaf = [...raf], verilenZmn = [...zmn];
  // çakışan kimlik: rAF 1 ile setTimeout 1 aynı sayı. Doğru söküm: her rAF kimliği cancelAnimationFrame ile, her
  // setTimeout kimliği clearTimeout ile, bir kez; yanlış işlevle iptal (uygulamanın aynı numaralı zamanlayıcısı) yok.
  for (const f of temizle) f();
  const s = [];
  const say = (l) => l.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const cr = say(iptalRaf.filter((x) => x !== 0)), cz = say(iptalZmn);
  if (verilenRaf.length < 2 || verilenZmn.length < 1) s.push(`beklenen zamanlayıcılar kurulmadı (rAF ${verilenRaf.length}, setTimeout ${verilenZmn.length})`);
  for (const id of verilenRaf) if (cr.get(id) !== 1) s.push(`rAF ${id}: cancelAnimationFrame ${cr.get(id) || 0} kez`);
  for (const id of verilenZmn) if (cz.get(id) !== 1) s.push(`setTimeout ${id}: clearTimeout ${cz.get(id) || 0} kez`);
  if (iptalZmn.length !== verilenZmn.length) s.push(`clearTimeout ${iptalZmn.length} çağrı, ${verilenZmn.length} zamanlayıcı (rAF kimliği clearTimeout'a gitti)`);
  if (cr.size && [...cr.values()].reduce((a, b) => a + b, 0) !== verilenRaf.length) s.push(`cancelAnimationFrame ${[...cr.values()].reduce((a, b) => a + b, 0)} çağrı, ${verilenRaf.length} rAF (setTimeout kimliği cancelAnimationFrame'e gitti)`);
  return s;
}
const SAYFA = oku(path.join(OGREN, 'cf-page.js'));

test('D3: cf-sayfa söküm: rAF kimlikleri yalnız cancelAnimationFrame, setTimeout kimlikleri yalnız clearTimeout ile (birer kez)', () => {
  assert.deepEqual(sokumDenetle(SAYFA), []);
});

test('D3 kusurlu girdi: karışık dizi (eski söküm), eksik iptal ve ters iptal yakalanır', () => {
  const eski = "const zaman = [];\n  ui.temizle(() => { zaman.forEach(id => { clearTimeout(id); cancelAnimationFrame(id); }); });";
  const karisik = SAYFA.replace(/const raf = \[\], zaman = \[\];\n {2}ui\.temizle\([^\n]*\n/, eski + '\n').replace(/raf\.push\(/g, 'zaman.push(');
  assert.notEqual(karisik, SAYFA, 'karışık varyant uygulanamadı');
  assert.ok(sokumDenetle(karisik).length > 0, 'karışık dizi yakalanmadı');
  const iptalsiz = SAYFA.replace(/raf\.forEach\(cancelAnimationFrame\)/, 'void 0');
  assert.notEqual(iptalsiz, SAYFA);
  assert.ok(sokumDenetle(iptalsiz).length > 0, 'rAF iptali eksik yakalanmadı');
  const ters = SAYFA.replace(/raf\.forEach\(cancelAnimationFrame\)/, 'raf.forEach(id => clearTimeout(id))');
  assert.notEqual(ters, SAYFA);
  assert.ok(sokumDenetle(ters).length > 0, 'ters iptal yakalanmadı');
});

// ---------------------------------------------------------------- D4: muafiyet sözcük sınırlı
test('D4: uygulama adı muafiyeti yalnız tam ad ("Mücellit", "MUCELLIT"); uzantılı Türkçe sözcük yakalanır', () => {
  for (const m of ['Mücellit', 'MUCELLIT', 'Mücellit v1', 'MUCELLIT 2026']) assert.equal(turkceMi(m), false, `yanlış alarm: ${m}`);
  for (const m of ['Mücellitler', 'Mücellitin', 'Mücellite acildi', 'YENI Mücellitler', 'Mücellitçi']) assert.equal(turkceMi(m), true, `kaçtı: ${m}`);
});

// ---------------------------------------------------------------- D5: tek terim
const EN = Dil.jsonAyikla(oku(path.join(UYGULAMA, 'i18n', 'en.js')));
const TR = Dil.jsonAyikla(oku(path.join(UYGULAMA, 'i18n', 'tr.js')));
// f ölçüsünü adlandıran metinler (Hesapla + hesap nedenleri + rehber paneli/notu)
const MAFSAL_ANAHTAR = ['hesapla.mafsal', 'hesapla.sonuc.mafsal', 'hesapla.uyari.mafsal', 'hesapla.kural.yalnizS', 'hesapla.aciklama', 'hesap.ad.mafsal',
  'hesap.ad.mukavva_gen', 'hesap.neden.mafsal_buyuk', 'ogren.p.mafsal', 'ogren.sayilar_not', 'ogren.kapak.mukavva.aciklama', 'ogren.kapak.kaplama.aciklama'];
function terimDenetle(en, tr) {
  const s = [];
  const duz = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  for (const [a, v] of Object.entries(en)) if (/hinge/i.test(duz(v))) s.push(`en ${a}: "hinge"`);
  for (const a of MAFSAL_ANAHTAR) {
    if (!(a in en) || !/joint gap/i.test(duz(en[a]))) s.push(`en ${a}: "joint gap" yok`);
    if (!(a in tr) || !/mafsal/i.test(duz(tr[a]))) s.push(`tr ${a}: "mafsal" yok`);
  }
  return s;
}
test('D5: mafsal (f) ölçüsü en-US\'de tek terim "joint gap" (Hesapla ve rehber), "hinge" yok; tr "mafsal"', () => {
  assert.deepEqual(terimDenetle(EN, TR), []);
});
test('D5 kusurlu girdi: tek bir "hinge gap" geri gelirse, terim silinirse ya da tr değişirse yakalanır', () => {
  assert.ok(terimDenetle({ ...EN, 'hesapla.sonuc.mafsal': 'Hinge gap f' }, TR).length > 0);
  assert.ok(terimDenetle({ ...EN, 'ogren.s.kitap.mafsal': 'HINGE' }, TR).length > 0, 'figür etiketi');
  assert.ok(terimDenetle({ ...EN, 'ogren.p.mafsal': 'Gap f' }, TR).length > 0);
  assert.ok(terimDenetle(EN, { ...TR, 'ogren.p.mafsal': 'Menteşe f' }).length > 0);
  assert.ok(terimDenetle({}, {}).length > 0, 'boş sözlük');
});

// ---------------------------------------------------------------- D7: lisans metni rehberde
const cozHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function lisansPaneli(html, lisans) {
  const s = [];
  const d = html.match(/<details\b[^>]*\bid="og-lisans"[^>]*>([\s\S]*?)<\/details>/);
  if (!d) return ['#og-lisans (details) yok'];
  const ust = html.slice(html.indexOf('id="og-kok"'), html.indexOf('</section>', html.indexOf('id="sekme-ogren"')));
  if (!ust.includes('id="og-lisans"')) s.push('lisans paneli Öğren sekmesinin içinde değil');
  const ozet = d[1].match(/<summary\b[^>]*\bdata-dil="([^"]+)"[^>]*>([^<]*)<\/summary>/);
  if (!ozet) s.push('summary (data-dil) yok');
  else if (!(ozet[1] in EN) || !(ozet[1] in TR) || !ozet[2].trim()) s.push('summary anahtarı sözlükte değil ya da boş: ' + ozet[1]);
  const pre = d[1].match(/<pre\b[^>]*\bid="og-lisans-metin"[^>]*>([\s\S]*?)<\/pre>/);
  if (!pre) s.push('#og-lisans-metin yok');
  else if (cozHtml(pre[1]).trim() !== String(lisans).trim()) s.push('panel metni LICENSE ile aynı değil');
  if (pre && !/\blang="en"/.test(pre[0])) s.push('lisans metni lang="en" değil (Türkçe arayüzde İngilizce hukuk metni)');
  return s;
}
const LISANS = oku(path.join(OGREN, 'LICENSE'));
test('D7: Öğren sekmesinde açılır lisans paneli; metin js/learn/LICENSE ile birebir; dipnot paneli gösterir', () => {
  assert.deepEqual(lisansPaneli(INDEX, LISANS), []);
  for (const S of [EN, TR]) assert.doesNotMatch(S['ogren.lisans'], /LICENSE/, 'kullanıcının erişemediği dosyaya yönlendirme yok');
});
test('D7 kusurlu girdi: panelsiz, boş, iskelet, farklı metin, sekme dışında panel yakalanır', () => {
  const pre = INDEX.match(/(<pre\b[^>]*id="og-lisans-metin"[^>]*>)([\s\S]*?)(<\/pre>)/);
  assert.ok(pre, 'panel yok');
  assert.ok(lisansPaneli(INDEX.replace(/<details\b[^>]*id="og-lisans"[\s\S]*?<\/details>/, ''), LISANS).length > 0, 'panelsiz');
  assert.ok(lisansPaneli(INDEX.replace(pre[0], pre[1] + pre[3]), LISANS).length > 0, 'boş');
  assert.ok(lisansPaneli(INDEX.replace(pre[0], pre[1] + 'MIT License' + pre[3]), LISANS).length > 0, 'iskelet');
  assert.ok(lisansPaneli(INDEX.replace(pre[0], pre[0].replace('Tolga Cohce', 'X')), LISANS).length > 0, 'farklı');
  const panel = INDEX.match(/<details\b[^>]*id="og-lisans"[\s\S]*?<\/details>/)[0];
  assert.ok(lisansPaneli(INDEX.replace(panel, '').replace('</body>', panel + '</body>'), LISANS).length > 0, 'sekme dışında');
});
