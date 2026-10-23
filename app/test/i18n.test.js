'use strict';
// Arayüz dili: sözlük eşitliği, eksik anahtar, parametre, tekil/çoğul, dil seçimi, data-dil uygulaması,
// sabit Türkçe dizgi taraması (izin listeli) ve eski Türkçe kayıtların açılması.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { dilKur, SOZLUK_DOSYALARI, KLASOR } = require('./i18n-helper.js');
const { jsDizgileri, rustDizgileri, htmlMetinleri, turkceMi } = require('./i18n-scan.js');
const Dil = require('../js/i18n.js');

const UYGULAMA = path.join(__dirname, '..');
const REPO = path.join(UYGULAMA, '..');
const oku = (y) => fs.readFileSync(y, 'utf8');

// ---------------------------------------------------------------- sözlük denetleyicisi
const COGUL = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const META = ['_dil', '_ad', '_yerel'];
function parametreler(deger) {
  const metinler = typeof deger === 'string' ? [deger] : Object.values(deger || {});
  const p = new Set();
  metinler.forEach((m) => String(m).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, a) => { p.add(a); return ''; }));
  return [...p].sort();
}

/**
 * Sözlükleri karşılaştırır. sozlukler: { kod: { metin (dosya metni) } } ya da { kod: { nesne } }. Sorun listesi döner:
 * eksik/fazla anahtar (en'e göre), boş metin, metin olmayan değer, bozuk çoğul nesnesi, parametre farkı, yinelenen
 * anahtar (dosya metninde), _dil dosya adıyla uyuşmuyor, üst veri eksik.
 */
function sozlukDenetle(dosyalar) {
  const sorun = [];
  const nesne = {};
  for (const [kod, metin] of Object.entries(dosyalar)) {
    try { nesne[kod] = Dil.jsonAyikla(metin); } catch (e) { sorun.push(`${kod}: JSON değil (${e.message})`); continue; }
    const say = {};
    // üst düzey anahtarlar (2 boşluk girinti; çoğul nesnesinin one/other'ı 4 boşlukta)
    for (const m of String(metin).matchAll(/^ {2}"((?:[^"\\]|\\.)+)"\s*:/gm)) say[m[1]] = (say[m[1]] || 0) + 1;
    Object.entries(say).filter(([, n]) => n > 1).forEach(([a]) => sorun.push(`${kod}: yinelenen anahtar ${a}`));
    META.forEach((a) => { if (typeof nesne[kod][a] !== 'string' || !nesne[kod][a].trim()) sorun.push(`${kod}: ${a} yok`); });
    if (nesne[kod]._dil !== kod) sorun.push(`${kod}: _dil "${nesne[kod]._dil}" dosya adıyla uyuşmuyor`);
  }
  const ana = nesne.en;
  if (!ana) return sorun.concat(['en sözlüğü yok']);
  const anahtarlar = (s) => Object.keys(s).filter((a) => !a.startsWith('_'));
  for (const [kod, s] of Object.entries(nesne)) {
    for (const a of anahtarlar(ana)) if (!(a in s)) sorun.push(`${kod}: eksik ${a}`);
    for (const a of anahtarlar(s)) {
      if (!(a in ana)) { sorun.push(`${kod}: fazla ${a}`); continue; }
      const d = s[a];
      if (typeof d === 'string') {
        if (!d.trim()) sorun.push(`${kod}: boş ${a}`);
      } else if (d && typeof d === 'object' && !Array.isArray(d)) {
        if (typeof d.other !== 'string' || !d.other.trim()) sorun.push(`${kod}: ${a} çoğul nesnesinde other yok`);
        for (const [k, v] of Object.entries(d)) {
          if (!COGUL.has(k)) sorun.push(`${kod}: ${a} bilinmeyen çoğul kategorisi ${k}`);
          else if (typeof v !== 'string' || !v.trim()) sorun.push(`${kod}: ${a}.${k} boş`);
        }
        if (!parametreler(d).includes('n')) sorun.push(`${kod}: ${a} çoğul ama {n} yok`);
      } else sorun.push(`${kod}: ${a} metin değil`);
      const pa = parametreler(ana[a]).join(','), pk = parametreler(d).join(',');
      if (pa !== pk) sorun.push(`${kod}: ${a} parametreleri farklı (en: ${pa || '-'}; ${kod}: ${pk || '-'})`);
    }
  }
  return sorun;
}

const GERCEK = Object.fromEntries(SOZLUK_DOSYALARI.map((a) => [a.replace(/\.js$/, ''), oku(path.join(KLASOR, a))]));

test('sözlük eşitliği: en ve tr aynı anahtar kümesi, boş metin yok, parametreler eşleşiyor, yinelenen anahtar yok', () => {
  assert.ok(SOZLUK_DOSYALARI.includes('en.js') && SOZLUK_DOSYALARI.includes('tr.js'), SOZLUK_DOSYALARI.join());
  assert.deepEqual(sozlukDenetle(GERCEK), []);
  const n = Object.keys(Dil.jsonAyikla(GERCEK.en)).length - META.length;
  // Öğren rehberi ~520 anahtar ekledi (önce 486); üst sınır yalnız "sözlük yanlışlıkla iki katına çıktı mı" denetimi
  assert.ok(n > 300 && n < 1500, `anahtar sayısı ${n}`);
});

test('sözlük denetleyicisi kusurlu sözlükleri yakalar (eksik, fazla, boş, parametre, çoğul, yineleme, _dil, JSON)', () => {
  const sar = (o) => '[/*JSON*/' + JSON.stringify(o, null, 2) + '/*JSON*/]';
  const tr = () => Dil.jsonAyikla(GERCEK.tr);
  const durumlar = {
    'eksik anahtar': (() => { const t = tr(); delete t['menu.dosya']; return { tr: sar(t) }; })(),
    'fazla anahtar': (() => { const t = tr(); t['yok.boyle'] = 'x'; return { tr: sar(t) }; })(),
    'boş metin': (() => { const t = tr(); t['menu.dosya'] = '   '; return { tr: sar(t) }; })(),
    'metin değil': (() => { const t = tr(); t['menu.dosya'] = 5; return { tr: sar(t) }; })(),
    'parametre farkı': (() => { const t = tr(); t['duzenle.yuklendi'] = '{dosya} yüklendi ({n} sayfa).'; return { tr: sar(t) }; })(),
    'parametre eksik': (() => { const t = tr(); t['son.disk_yok'] = '{ad} açılamadı.'; return { tr: sar(t) }; })(),
    'çoğul other yok': (() => { const t = tr(); t['duzenle.secildi'] = { one: '{n} sayfa' }; return { tr: sar(t) }; })(),
    'çoğul kategori': (() => { const t = tr(); t['duzenle.secildi'] = { tek: '{n}', other: '{n} sayfa seçildi.' }; return { tr: sar(t) }; })(),
    'çoğul n yok': (() => { const t = tr(); t['duzenle.secildi'] = { other: 'seçildi' }; return { tr: sar(t) }; })(),
    'yinelenen anahtar': { tr: GERCEK.tr.replace('"menu.dosya": "Dosya",', '"menu.dosya": "Dosya",\n  "menu.dosya": "Dosya",') },
    '_dil uyuşmuyor': (() => { const t = tr(); t._dil = 'en'; return { tr: sar(t) }; })(),
    'üst veri yok': (() => { const t = tr(); delete t._ad; return { tr: sar(t) }; })(),
    'JSON değil (sondaki virgül)': { tr: GERCEK.tr.replace('"menu.dosya": "Dosya",', '"menu.dosya": "Dosya",,') },
    'işaret yok': { tr: GERCEK.tr.replace(/\/\*JSON\*\//g, '') },
    'iskelet (boş nesne)': { tr: '[/*JSON*/{"_dil":"tr","_ad":"Türkçe","_yerel":"tr-TR"}/*JSON*/]' },
    'kopya (en metni tr diye)': { tr: GERCEK.en },
    'en yok': { en: undefined },
  };
  for (const [ad, deg] of Object.entries(durumlar)) {
    const dosyalar = { ...GERCEK, ...deg };
    if (deg.en === undefined && 'en' in deg) delete dosyalar.en;
    const s = sozlukDenetle(dosyalar);
    assert.ok(s.length > 0, `${ad}: yakalanmadı`);
  }
});

// ---------------------------------------------------------------- çalışma anı (vm, tarayıcıdaki gibi)
function taze(kod, ek) {
  const ctx = { navigator: { languages: ['en-US'] } };
  ctx.self = ctx;
  vm.createContext(ctx);
  if (ek) ctx.KitapCiltSozlukleri = [ek];
  return dilKur(ctx, kod);
}

test('eksik anahtar en\'e düşer; hiçbir dilde yoksa anahtar döner ve eksikler()\'e yazılır', () => {
  const ek = { _dil: 'zz', _ad: 'Deneme', _yerel: 'en-US', 'menu.dosya': 'Fichier' };
  const D = taze('zz', ek);
  assert.equal(D.kod(), 'zz');
  assert.equal(D.t('menu.dosya'), 'Fichier');
  assert.equal(D.t('menu.ac'), 'Open…', 'zz\'de yok → en');
  assert.deepEqual(Array.from(D.eksikler()), []);
  assert.equal(D.t('yok.boyle.anahtar'), 'yok.boyle.anahtar');
  assert.deepEqual(Array.from(D.eksikler()), ['yok.boyle.anahtar']);
  assert.equal(D.t('_ad'), '_ad', 'üst veri metin olarak verilmez');
  assert.equal(taze('xx').kod(), 'en', 'desteklenmeyen dil → en');
});

test('parametreli metin: ad/sayı/yol yerine konur; eksik parametre {ad} olarak kalır', () => {
  const tr = taze('tr'), en = taze('en');
  assert.equal(tr.t('duzenle.yuklendi', { ad: 'a.pdf', n: 37 }), 'a.pdf yüklendi (37 sayfa).');
  assert.equal(en.t('duzenle.yuklendi', { ad: 'a.pdf', n: 37 }), 'a.pdf loaded (37 pages).');
  assert.equal(en.t('son.disk_yok', { ad: 'tez.pdf', ayrinti: 'KCDeneme' }), "tez.pdf couldn't be opened: its disk (KCDeneme) isn't connected. Connect the disk and try again; the entry stays in Open Recent.");
  assert.equal(en.t('kayit.kaydedildi', { yollar: '/Users/x/a b.pdf' }), 'Saved: /Users/x/a b.pdf.');
  assert.equal(en.t('duzenle.pdf_degil', {}), "The file isn't a valid PDF: {ad}");
  assert.equal(en.t('duzenle.pdf_degil', { ad: 0 }), "The file isn't a valid PDF: 0", '0 değeri yazılır');
});

test('tekil/çoğul: en "1 page / 2 pages" (Intl.PluralRules), tr tek biçim', () => {
  const tr = taze('tr'), en = taze('en');
  assert.equal(en.t('duzenle.secildi', { n: 1 }), '1 page selected.');
  assert.equal(en.t('duzenle.secildi', { n: 2 }), '2 pages selected.');
  assert.equal(en.t('duzenle.secildi', { n: 0 }), '0 pages selected.');
  assert.equal(en.t('duzenle.yuklendi', { ad: 'x.pdf', n: 1 }), 'x.pdf loaded (1 page).');
  assert.equal(en.t('surec.liste_ozet', { tur: 'T', biten: 0, n: 1 }), 'T · 0/1 step');
  assert.equal(tr.t('duzenle.secildi', { n: 1 }), '1 sayfa seçildi.');
  assert.equal(tr.t('duzenle.secildi', { n: 2 }), '2 sayfa seçildi.');
  assert.equal(en.t('duzenle.secildi'), '{n} pages selected.', 'n yoksa other');
});

test('dil seçimi: sistem dili Apple kuralı (desteklenen ilk dil); elle seçim localStorage\'da; html lang', () => {
  const D = taze('en');
  assert.equal(D.sistemDili(['tr-TR', 'en-US']), 'tr');
  assert.equal(D.sistemDili(['tr']), 'tr');
  assert.equal(D.sistemDili(['TR_tr']), 'tr');
  assert.equal(D.sistemDili(['en-GB', 'tr-TR']), 'en');
  assert.equal(D.sistemDili(['de-DE', 'tr-TR']), 'tr', 'Apple kuralı: listede desteklenen ilk dil');
  assert.equal(D.sistemDili(['de-DE', 'fr-FR']), 'en', 'listede desteklenen dil yoksa en');
  assert.equal(D.sistemDili([]), 'en');
  assert.equal(D.sistemDili(undefined), 'en');
  assert.equal(D.sistemDili(['', null, 'tr']), 'tr');
  // başlangıç: localStorage seçimi > navigator.languages
  const kur = (ls, diller) => {
    const ctx = { navigator: { languages: diller }, localStorage: ls, document: { documentElement: { lang: '', setAttribute(a, v) { this[a] = v; } }, querySelectorAll: () => [] } };
    ctx.self = ctx;
    vm.createContext(ctx);
    for (const a of SOZLUK_DOSYALARI) vm.runInContext(oku(path.join(KLASOR, a)), ctx);
    vm.runInContext(oku(path.join(UYGULAMA, 'js', 'i18n.js')), ctx);
    return ctx;
  };
  const depo = (v) => { const d = { v: v === undefined ? {} : v, getItem: (k) => (k in d.v ? d.v[k] : null), setItem: (k, x) => { d.v[k] = String(x); }, removeItem: (k) => { delete d.v[k]; } }; return d; };
  assert.equal(kur(depo(), ['tr-TR']).KitapCilt.dil.kod(), 'tr', 'sistem tr');
  assert.equal(kur(depo(), ['en-US', 'tr']).KitapCilt.dil.kod(), 'en', 'sistem en');
  assert.equal(kur(depo(), ['ja-JP']).KitapCilt.dil.kod(), 'en', 'desteklenmeyen sistem dili');
  assert.equal(kur(depo({ 'kitapCilt.dil': 'en' }), ['tr-TR']).KitapCilt.dil.kod(), 'en', 'elle seçim sistem dilini ezer');
  assert.equal(kur(depo({ 'kitapCilt.dil': 'xx' }), ['tr-TR']).KitapCilt.dil.kod(), 'tr', 'bozuk seçim yok sayılır');
  const atan = { getItem() { throw new Error('kapalı'); }, setItem() { throw new Error('kapalı'); }, removeItem() { throw new Error('kapalı'); } };
  const c = kur(atan, ['tr-TR']);
  assert.equal(c.KitapCilt.dil.kod(), 'tr', 'saklama kapalı: sistem dili');
  assert.doesNotThrow(() => c.KitapCilt.dil.secimYaz('en'));
  assert.equal(c.document.documentElement.lang, 'tr');
  const d = depo();
  const k = kur(d, ['tr-TR']).KitapCilt.dil;
  k.secimYaz('en');
  assert.equal(d.v['kitapCilt.dil'], 'en');
  assert.equal(k.secimOku(), 'en');
  k.secimYaz(null);
  assert.equal('kitapCilt.dil' in d.v, false, 'sistem seçimi anahtarı siler');
  k.secimYaz('xx');
  assert.equal('kitapCilt.dil' in d.v, false, 'desteklenmeyen kod yazılmaz');
});

test('uygula: data-dil metni, data-dil-oz öznitelikleri, belge başlığı', () => {
  const D = taze('en');
  const oge = (a) => ({ a, textContent: 'eski', oz: {}, getAttribute(k) { return this.a[k]; }, setAttribute(k, v) { this.oz[k] = v; } });
  const m = oge({ 'data-dil': 'menu.dosya' });
  const o = oge({ 'data-dil-oz': 'aria-label:dil.etiket; title:duzenle.cevir;bozuk;:x' });
  const kok = { querySelectorAll: (s) => (s === '[data-dil]' ? [m] : s === '[data-dil-oz]' ? [o] : []) };
  D.uygula(kok);
  assert.equal(m.textContent, 'File');
  assert.deepEqual(o.oz, { 'aria-label': 'Language', title: 'Swap portrait / landscape' });
  assert.doesNotThrow(() => D.uygula(null));
  assert.doesNotThrow(() => D.uygula({}));
});

// ---------------------------------------------------------------- anahtar kullanımı
function dosyalar(klasor, uzanti, haric = []) {
  const l = [];
  (function gez(k) {
    for (const g of fs.readdirSync(k, { withFileTypes: true })) {
      const y = path.join(k, g.name);
      if (haric.some((h) => y.startsWith(h))) continue;
      if (g.isDirectory()) gez(y); else if (g.name.endsWith(uzanti)) l.push(y);
    }
  })(klasor);
  return l.sort();
}
const JS_DOSYALARI = dosyalar(path.join(UYGULAMA, 'js'), '.js');
const RUST_DOSYALARI = dosyalar(path.join(REPO, 'src-tauri', 'src'), '.rs');
const SOZLUK = Dil.jsonAyikla(GERCEK.en);
const AD_ALANLARI = new Set(Object.keys(SOZLUK).filter((a) => !a.startsWith('_')).map((a) => a.split('.')[0]));
// Çalışma anında birleştirilen (dinamik) anahtar önekleri: kaynakta tam anahtar geçmez.
const DINAMIK = ['adim.', 'epub.E', 'epub.ayrinti.', 'cilt.tur.', 'hesap.ad.', 'dizilim.ad.', 'surec.ayar_turu.'];
/**
 * Öğren rehberinin aşama/adım anahtarları learn.js'te parçalı kurulur (`ogren.${aşama}.${adım}.baslik` …); önek
 * muafiyeti yerine ders listesinden (js/learn/learn-lessons.js) tek tek üretilir: her aşamada .ad/.ozet, her adımda
 * .baslik/.aciklama/.dugme zorunlu; .arac/.dikkat/.aciklama_az isteğe bağlı (yalnız ders listesindeki bir adım için).
 */
function ogrenDersAnahtarlari(kaynak) {
  const ctx = {}; ctx.self = ctx; vm.createContext(ctx);
  vm.runInContext(kaynak, ctx, { filename: 'learn-lessons.js' });
  const zorunlu = new Set(), istege = new Set();
  for (const d of ctx.KitapCilt.ogren.dersler) {
    zorunlu.add(`ogren.${d.id}.ad`); zorunlu.add(`ogren.${d.id}.ozet`);
    for (const a of d.adimlar) {
      for (const e of ['baslik', 'aciklama', 'dugme']) zorunlu.add(`ogren.${d.id}.${a}.${e}`);
      for (const e of ['arac', 'dikkat', 'aciklama_az']) istege.add(`ogren.${d.id}.${a}.${e}`);
    }
  }
  return { zorunlu, istege };
}
const OGREN_DERS = ogrenDersAnahtarlari(oku(path.join(UYGULAMA, 'js', 'learn', 'learn-lessons.js')));

test('anahtar kullanımı: kaynakta geçen her anahtar sözlükte var; sözlükte kullanılmayan anahtar yok', () => {
  const kullanilan = new Set();
  // dosya/alan adları (dil.txt, surec.json, tauri.localhost) anahtar sayılmaz
  const anahtarBenzeri = (m) => /^[a-z]+(\.[a-zA-Z0-9_]+)+$/.test(m) && AD_ALANLARI.has(m.split('.')[0]) && !/\.(txt|json|js|pdf|epub|localhost)$/.test(m);
  for (const y of JS_DOSYALARI) for (const d of jsDizgileri(oku(y))) if (anahtarBenzeri(d.metin)) kullanilan.add(d.metin);
  for (const y of RUST_DOSYALARI) for (const d of rustDizgileri(oku(y))) if (!d.gunluk && anahtarBenzeri(d.metin)) kullanilan.add(d.metin);
  const html = oku(path.join(UYGULAMA, 'index.html'));
  for (const m of html.matchAll(/data-dil="([^"]+)"/g)) kullanilan.add(m[1]);
  for (const m of html.matchAll(/data-dil-oz="([^"]+)"/g)) m[1].split(';').forEach((c) => kullanilan.add(c.split(':')[1]));
  for (const a of OGREN_DERS.zorunlu) kullanilan.add(a);
  const eksik = [...kullanilan].filter((a) => !(a in SOZLUK));
  assert.deepEqual(eksik, [], 'sözlükte olmayan anahtar');
  const kullanilmayan = Object.keys(SOZLUK).filter((a) => !a.startsWith('_') && !kullanilan.has(a) && !OGREN_DERS.istege.has(a) && !DINAMIK.some((o) => a.startsWith(o)));
  assert.deepEqual(kullanilmayan, [], 'sözlükte kullanılmayan anahtar');
  // dinamik öneklerin her biri gerçekten kaynakta birleştiriliyor
  const tumKaynak = JS_DOSYALARI.map(oku).join('\n');
  for (const o of DINAMIK.filter((o) => o !== 'epub.E')) assert.ok(tumKaynak.includes(`'${o}'`), `dinamik önek kaynakta yok: ${o}`);
  assert.ok(kullanilan.size > 300, `${kullanilan.size} anahtar bulundu`);
});

test('Öğren ders anahtarları ders listesinden üretilir; denetleyici eksik/fazla adım anahtarını yakalar', () => {
  const ders = oku(path.join(UYGULAMA, 'js', 'learn', 'learn-lessons.js'));
  assert.equal(OGREN_DERS.zorunlu.size, 10 * 2 + 45 * 3, '10 aşama, 45 adım');
  const eksikler = (k) => [...ogrenDersAnahtarlari(k).zorunlu].filter((a) => !(a in SOZLUK));
  assert.deepEqual(eksikler(ders), []);
  // kusurlu girdi: sözlükte karşılığı olmayan adım eklenirse eksik çıkar; adım silinirse onun anahtarları kullanılmıyor sayılır
  const yeniAdim = ders.replace("adimlar: ['lif', 'diz', 'katla', 'kemik', 'pres']", "adimlar: ['lif', 'diz', 'katla', 'kemik', 'pres', 'yeni']");
  assert.notEqual(yeniAdim, ders, 'varyant uygulanamadı');
  assert.deepEqual(eksikler(yeniAdim), ['ogren.katlama.yeni.baslik', 'ogren.katlama.yeni.aciklama', 'ogren.katlama.yeni.dugme']);
  const silinmis = ogrenDersAnahtarlari(ders.replace("'kemik', 'pres']", "'kemik']"));
  assert.ok(!silinmis.zorunlu.has('ogren.katlama.pres.baslik') && !silinmis.istege.has('ogren.katlama.pres.dikkat'));
  assert.throws(() => ogrenDersAnahtarlari(''), 'boş ders dosyası');
});

test('index.html\'deki her sözlük betiği yüklenir; her app/i18n/*.js index.html\'de (yeni dil unutulmasın); i18n.js sözlüklerden sonra', () => {
  const html = oku(path.join(UYGULAMA, 'index.html'));
  const betikler = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const sozluk = betikler.filter((b) => b.startsWith('i18n/'));
  assert.deepEqual(sozluk.map((b) => b.slice(5)).sort(), SOZLUK_DOSYALARI);
  const dilJs = betikler.indexOf('js/i18n.js');
  assert.ok(dilJs > Math.max(...sozluk.map((b) => betikler.indexOf(b))), 'i18n.js sözlüklerden sonra');
  assert.ok(dilJs < betikler.indexOf('js/platform.js'), 'i18n.js platform.js\'ten önce');
});

test('t() gölgelenmiyor: t işlevi tanımlayan dosyada t adlı değişken/parametre yok', () => {
  const sorunlu = (kaynak) => /function t\(/.test(kaynak) && /\b(var|let|const)\s+t\b|function\s*[A-Za-z0-9_$]*\s*\(\s*(?:[^)]*,\s*)?t\s*[,)]/.test(kaynak.replace(/function t\(a, p\)/g, ''));
  const bulunan = JS_DOSYALARI.filter((y) => sorunlu(oku(y))).map((y) => path.relative(REPO, y));
  assert.deepEqual(bulunan, []);
  // denetleyici kusurlu girdiyi yakalar
  assert.equal(sorunlu("function t(a, p) {}\nfunction f() { var t = 1; }"), true);
  assert.equal(sorunlu("function t(a, p) {}\n[].reduce(function (t, k) { return t; })"), true);
  assert.equal(sorunlu("function t(a, p) {}\nfunction g(x, t) {}"), true);
  assert.equal(sorunlu("function t(a, p) {}\nvar tk = 1; function g(top) {}"), false);
});

// ---------------------------------------------------------------- sabit Türkçe dizgi taraması
/**
 * İzin listesi: arayüz metni OLMAYAN Türkçe karakterli değişmezler (dosya → değişmez parçası, neden). Testler
 * (app/test/), sözlükler (app/i18n/) ve vendor taranmaz. Rust'ta günlük (eprintln!/expect/assert …) ve test modülü
 * taranmaz (kullanıcıya gitmez).
 */
const IZIN = [
  ['app/js/plugins/epub/hyphenation.js', 'aeıioöuüâîû', 'Türkçe tire bölme kuralı (PDF içeriği, arayüz değil)'],
  ['app/js/plugins/epub/zip.js', 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ', 'CP437 kod çözme tablosu (ZIP adları)'],
];
function izinli(dosya, metin) {
  return IZIN.some(([d, parca]) => dosya === d && metin.includes(parca));
}
function tara() {
  const bulgu = [];
  for (const y of JS_DOSYALARI) {
    const g = path.relative(REPO, y);
    for (const d of jsDizgileri(oku(y))) if (turkceMi(d.metin) && !izinli(g, d.metin)) bulgu.push(`${g}:${d.satir}: ${d.metin.slice(0, 70)}`);
  }
  for (const y of RUST_DOSYALARI) {
    const g = path.relative(REPO, y);
    for (const d of rustDizgileri(oku(y))) if (!d.gunluk && turkceMi(d.metin) && !izinli(g, d.metin)) bulgu.push(`${g}:${d.satir}: ${d.metin.slice(0, 70)}`);
  }
  for (const d of htmlMetinleri(oku(path.join(UYGULAMA, 'index.html')))) if (turkceMi(d.metin)) bulgu.push(`app/index.html:${d.satir}: ${d.metin.slice(0, 70)}`);
  return bulgu;
}

test('tarama: app/ ve src-tauri/src/ içinde izin listesi dışında Türkçe kullanıcı dizgisi yok', () => {
  assert.deepEqual(tara(), []);
  assert.ok(JS_DOSYALARI.length >= 20 && RUST_DOSYALARI.length >= 7, `${JS_DOSYALARI.length} JS, ${RUST_DOSYALARI.length} Rust`);
});

test('tarama ve anahtar kullanımı Öğren rehberini kapsar (app/js/learn/ alt klasörleri dahil); rehbere sabit Türkçe dizgi eklenirse KALDI', () => {
  const ogren = JS_DOSYALARI.map((y) => path.relative(UYGULAMA, y)).filter((y) => y.startsWith(path.join('js', 'learn') + path.sep));
  const beklenen = ['learn-measure.js', 'cf-engine.js', 'cf-page.js', 'learn-lessons.js', 'learn.js', ...fs.readdirSync(path.join(UYGULAMA, 'js', 'learn', 'figures')).filter((a) => a.endsWith('.js')).map((a) => 'figures/' + a)];
  assert.deepEqual(ogren.map((y) => y.slice(9).split(path.sep).join('/')).sort(), beklenen.sort());
  assert.equal(beklenen.length, 14, '5 rehber dosyası + 9 figür dosyası');
  // kusurlu girdi: gerçek rehber dosyalarının bozulmuş kopyaları (Türkçe harfli, ASCII Türkçe, figür etiketi)
  const bul = (k) => jsDizgileri(k).filter((d) => turkceMi(d.metin)).map((d) => d.metin);
  const ogrenJs = oku(path.join(UYGULAMA, 'js', 'learn', 'learn.js'));
  const kitapJs = oku(path.join(UYGULAMA, 'js', 'learn', 'figures', 'book.js'));
  assert.deepEqual(bul(ogrenJs), []);
  assert.deepEqual(bul(kitapJs), []);
  assert.deepEqual(bul(ogrenJs.replace("t('ogren.durdur')", "'Durdur ve başa dön'")), ['Durdur ve başa dön']);
  assert.deepEqual(bul(ogrenJs.replace("t('ogren.durdur')", "'Oynatma durduruldu'")), ['Oynatma durduruldu']);
  assert.deepEqual(bul(kitapJs.replace("t('ogren.s.kitap.kapak2')", "'KITABI AC VE CEVIR'")), ['KITABI AC VE CEVIR']);
});

test('tarama: izin listesindeki her girdi gerçekten var (bayat izin kalmaz)', () => {
  for (const [d, parca] of IZIN) {
    const s = d.endsWith('.rs') ? rustDizgileri(oku(path.join(REPO, d))) : jsDizgileri(oku(path.join(REPO, d)));
    assert.ok(s.some((x) => x.metin.includes(parca)), `${d}: ${parca}`);
  }
});

test('tarama kusurlu/zor girdiyi yakalar: tırnak türleri, şablon, kaçış, regex, yorum; Rust günlük/test/ham dizgi; HTML', () => {
  const js = (k) => jsDizgileri(k).filter((d) => turkceMi(d.metin)).map((d) => d.metin);
  assert.deepEqual(js("var a = 'Kitap oluşturuldu';"), ['Kitap oluşturuldu']);
  assert.deepEqual(js('f("Çıktı")'), ['Çıktı']);
  const sablon = js('x = `${n} sayfa ${"ğ"} yüz`');
  assert.ok(sablon.includes('ğ') && sablon.some((m) => m.includes('yüz')), 'şablon içindeki dizgi ve şablon metni: ' + JSON.stringify(sablon));
  assert.ok(js('x = `${n} yüz`').length === 1, 'şablon metni');
  assert.deepEqual(js("y = 'it\\'s ş'"), ["it's ş"], 'kaçışlı tırnak');
  assert.deepEqual(js("if (/'/.test(a)) b = 'ş';"), ['ş'], 'tırnak içeren regex dizgiyi bozmaz');
  assert.deepEqual(js("var r = /[çğ]/g; var s = a / b; c = 'ö';"), ['ö'], 'regex atlanır, bölme regex sayılmaz');
  assert.deepEqual(js('// yorum: ç\n/* çok satırlı\nş */ var x = 1;'), [], 'yorumlar atlanır');
  assert.deepEqual(js("return /ş/.test(x) ? 'a' : 'ı';"), ['ı'], 'return sonrası regex');
  assert.deepEqual(js("t('Forma sayisi yok')"), ['Forma sayisi yok'], 'Türkçe harfsiz Türkçe cümle (sözcük sezgisi)');
  assert.deepEqual(js("t('menu.dosya'); x('system-ui, sans-serif'); y(' · ')"), [], 'anahtar ve teknik dizgi Türkçe değil');
  const satir = jsDizgileri("a\n\n  'ş'");
  assert.equal(satir[0].satir, 3, 'satır numarası');

  const rs = (k) => rustDizgileri(k).filter((d) => !d.gunluk && turkceMi(d.metin)).map((d) => d.metin);
  assert.deepEqual(rs('fn f() -> String { format!("dosya çok büyük ({} MB)", 3) }'), ['dosya çok büyük ({} MB)']);
  assert.deepEqual(rs('fn f() { eprintln!("yazılamadı: {e}"); x.lock().expect("kilidi ş"); assert!(a, "ğ"); }'), [], 'günlük/expect/assert');
  assert.deepEqual(rs('fn f() { eprintln!("{}", format!("ş")); }'), [], 'günlük içindeki format!');
  assert.deepEqual(rs('const A: &str = r#"ham "ç" dizgi"#;'), ['ham "ç" dizgi'], 'ham dizgi');
  assert.deepEqual(rs("fn f<'a>(x: &'a str) -> char { 'ş' }"), ['ş'], 'ömür ve karakter değişmezi');
  assert.deepEqual(rs('// yorum ç\n/* iç /* içe */ ş */ fn f() {}'), [], 'iç içe yorum');
  assert.deepEqual(rs('fn a() { b("ç") }\n#[cfg(test)]\nmod testler { fn t() { x("ş") } }'), ['ç'], 'test modülü taranmaz');
  assert.deepEqual(rs('#[cfg(test)]\npub fn kalip() {}\nfn a() { b("ç") }'), ['ç'], 'cfg(test) işlev test modülü değildir');
  assert.deepEqual(rs('fn a() { b("kaç\\"ış") }'), ['kaç"ış'], 'kaçışlı tırnak');

  const ht = (k) => htmlMetinleri(k).filter((d) => turkceMi(d.metin)).map((d) => d.metin);
  assert.deepEqual(ht('<p>Düzenle</p>'), ['Düzenle']);
  assert.deepEqual(ht('<button title="Çevir" data-dil="a.b">⇄</button>'), ['Çevir']);
  assert.deepEqual(ht('<input placeholder="ör. 1-4">'), ['ör. 1-4']);
  assert.deepEqual(ht('<!-- yorum ğ --><script>var a = "ş";</script><span data-dil="ö"></span>'), [], 'yorum, betik, anahtar');
  assert.deepEqual(ht('<p data-dil="x"></p>\n<p>Sayfa yok</p>'), ['Sayfa yok'], 'harfsiz Türkçe metin düğümü');
  // tara(): dosyaya sabit Türkçe dizgi eklenirse KALDI (gerçek dosyanın bozulmuş kopyası üzerinde)
  const kopya = oku(path.join(UYGULAMA, 'js', 'projects.js')).replace("t('surec.silindi')", "'Bütün süreç verisi silindi.'");
  assert.ok(jsDizgileri(kopya).some((d) => turkceMi(d.metin) && d.metin.startsWith('Bütün')), 'geri eklenen sabit dizgi yakalanır');
});

// ---------------------------------------------------------------- eski (öncesi) kayıtlar
const ESKI = path.join(__dirname, 'fixtures', 'legacy');

test('eski Türkçe kayıtlar: localStorage/surec.json verisi doğrulanır; şablon adımları o anki dilde, kullanıcı adımı aynen', () => {
  const M = require('../js/project-model.js');
  for (const ad of ['local-storage-v1.json', 'projects-v1.json']) {
    const veri = JSON.parse(oku(path.join(ESKI, ad)));
    assert.equal(M.dogrula(veri), true, ad);
    const k = veri.kitaplar[0];
    assert.ok(k.adimlar.every((a) => a.sablon === undefined), `${ad}: eski kayıtta şablon anahtarı yok`);
    const onceki = Dil.kod();
    try {
      Dil.ayarla('en');
      const adlar = k.adimlar.map(M.adimAdi);
      assert.equal(adlar[0], 'Prep / PDF', ad);
      assert.equal(adlar[6], 'Sewing', ad);
      assert.ok(adlar.includes('Ayraç takma'), `${ad}: kullanıcının eklediği adım aynen: ${adlar}`);
      assert.equal(M.turAdi(k.ciltTuru), 'Sewn signatures + hardcover (case binding)');
      Dil.ayarla('tr');
      assert.deepEqual(k.adimlar.map(M.adimAdi), k.adimlar.map((a) => a.ad), `${ad}: Türkçede bugünkü adlar`);
    } finally { Dil.ayarla(onceki); }
    assert.deepEqual(JSON.parse(oku(path.join(ESKI, ad))), veri, 'okuma kaydı değiştirmez');
  }
});

test('yeni kitap: adım şablon anahtarı + oluşturulduğu dildeki ad; dil değişince görünen ad değişir; JSON eski sürümle uyumlu', () => {
  const M = require('../js/project-model.js');
  const onceki = Dil.kod();
  try {
    Dil.ayarla('en');
    const k = M.yeniKitap({ ad: 'Notebook', ciltTuru: 'formali' });
    assert.equal(k.adimlar[6].sablon, 'dikis');
    assert.equal(k.adimlar[6].ad, 'Sewing');
    Dil.ayarla('tr');
    assert.equal(M.adimAdi(k.adimlar[6]), 'Dikiş');
    assert.equal(M.dogrula(JSON.parse(JSON.stringify({ surum: 1, kitaplar: [k] }))), true);
    const bozuk = JSON.parse(JSON.stringify({ surum: 1, kitaplar: [k] }));
    bozuk.kitaplar[0].adimlar[0].sablon = 5;
    assert.throws(() => M.dogrula(bozuk), /şablon anahtarı metin olmalı/);
    const bilinmeyen = { ...k.adimlar[0], sablon: 'yok_boyle', ad: 'Elle' };
    assert.equal(M.adimAdi(bilinmeyen), 'Elle', 'bilinmeyen şablon anahtarı: kayıtlı ad');
  } finally { Dil.ayarla(onceki); }
});

// ---------------------------------------------------------------- düzeltme
const VEKTOR = JSON.parse(oku(path.join(__dirname, 'fixtures', 'i18n-vectors.json')));

test('Apple dil kuralı (JS): ortak vektörler (Rust i18n.rs aynı dosyayı sınar); tercih listesinde desteklenen ilk dil', () => {
  const D = taze('en');
  assert.ok(VEKTOR.sistem_dili.length >= 5);
  for (const v of VEKTOR.sistem_dili) assert.equal(D.sistemDili(v.liste), v.beklenen, JSON.stringify(v.liste));
  // asgari vektörler dosyada (silinirse test kalır)
  const anahtar = (l) => JSON.stringify(l);
  const asgari = { '["tr-TR"]': 'tr', '["de-DE","tr-TR"]': 'tr', '["de-DE","fr-FR"]': 'en', '["en-GB","tr"]': 'en', '[]': 'en' };
  for (const [l, b] of Object.entries(asgari)) assert.ok(VEKTOR.sistem_dili.some((v) => anahtar(v.liste) === l && v.beklenen === b), `asgari vektör yok: ${l}`);
});

test('parametre doldurma tek geçişli (JS): ortak vektörler (Rust aynı sonucu verir); değer içindeki {x} doldurulmaz', () => {
  for (const v of VEKTOR.doldur) {
    const D = taze(v.dil);
    assert.equal(D.t(v.anahtar, Object.fromEntries(v.p)), v.beklenen, JSON.stringify(v.p));
  }
});

test('uygula: anahtar hiçbir sözlükte yoksa öğenin mevcut (statik) metni anahtarla ezilmez', () => {
  const D = taze('en');
  const oge = (a, metin) => ({ a, textContent: metin, oz: {}, getAttribute(k) { return this.a[k]; }, setAttribute(k, v) { this.oz[k] = v; } });
  const m = oge({ 'data-dil': 'yok.boyle.anahtar' }, 'Static');
  const b = oge({ 'data-dil': 'yok.boyle.anahtar' }, '');
  const o = oge({ 'data-dil-oz': 'title:yok.boyle.anahtar', title: 'Static title' }, '');
  D.uygula({ querySelectorAll: (s) => (s === '[data-dil]' ? [m, b] : s === '[data-dil-oz]' ? [o] : []) });
  assert.equal(m.textContent, 'Static');
  assert.equal(b.textContent, 'yok.boyle.anahtar', 'statik metin yoksa anahtar (eksik görünür)');
  assert.equal(o.oz.title, undefined, 'statik öznitelik ezilmedi');
  assert.ok(D.eksikler().includes('yok.boyle.anahtar'), 'eksik yine kaydedilir');
});

// İngilizce metin birliği: en-US yazım, olumsuzlukta tek biçim (kısaltma), iç yol yok.
const INGILIZ = /\b(centre[sd]?|centring|cancell(?:ed|ing|ation)|colou?rs?\b(?<=colours?)|colour(?:ed|ful|ing)?|behaviours?|favou?r(?<=favour)(?:s|ed|ite|ites)?|honours?|labours?|licence|organis(?:e|ed|es|ing|ation)|recognis(?:e|ed|es|ing)|customis(?:e|ed|es|ing)|initialis(?:e|ed|es|ing)|normalis(?:e|ed|es|ing)|optimis(?:e|ed|es|ing)|minimis(?:e|ed|es|ing)|maximis(?:e|ed|es|ing)|summaris(?:e|ed|es|ing)|prioritis(?:e|ed|es|ing)|utilis(?:e|ed|es|ing)|analys(?:e|ed|es|ing)|catalogue|fibres?|metres?|millimetres?|centimetres?|litres?|programmes?|travell(?:ed|ing|er)|labell(?:ed|ing)|modell(?:ed|ing)|judgement|grey|aluminium|enrol(?:s|ment)?|fulfil(?:s|ment)?|whilst|amongst|learnt|spelt|realis(?:e|ed|es|ing))\b/i;
const UZUN_OLUMSUZ = /\b(can ?not|could not|does not|did not|do not|is not|are not|was not|were not|will not|would not|should not|has not|have not|had not|must not)\b/i;
const IC_YOL = /\b(?:docs|app|src-tauri|araclar|vendor|src|node_modules)\/|\.(?:md|rs|mjs|cjs)\b/;
function metinler(s) {
  return Object.entries(s).filter(([a]) => !a.startsWith('_')).flatMap(([a, d]) => (typeof d === 'string' ? [[a, d]] : Object.entries(d).map(([k, v]) => [a + '.' + k, v])));
}
const sorunlu = (s, re) => metinler(s).filter(([, m]) => re.test(m)).map(([a, m]) => `${a}: ${m}`);

test('en sözlüğü en-US yazımında: İngiliz yazımı kalıntısı yok (centre, cancelled, colour, behaviour …)', () => {
  assert.deepEqual(sorunlu(SOZLUK, INGILIZ), []);
});

test('en sözlüğünde olumsuzluk tek biçimde: kısaltma (can\'t, couldn\'t, doesn\'t, isn\'t …); "could not / cannot" yok', () => {
  assert.deepEqual(sorunlu(SOZLUK, UZUN_OLUMSUZ), []);
  assert.ok(metinler(SOZLUK).filter(([, m]) => /n't\b/.test(m)).length >= 20, 'kısaltmalar gerçekten kullanılıyor');
});

test('kullanıcı metninde iç depo yolu yok (docs/, app/vendor/, .md …) — en ve tr', () => {
  for (const kod of Object.keys(GERCEK)) assert.deepEqual(sorunlu(Dil.jsonAyikla(GERCEK[kod]), IC_YOL), [], kod);
});

test('metin birliği denetleyicileri kusurlu girdiyi yakalar, doğru biçimi geçirir', () => {
  const yakala = ['Bottom centre', 'centred text', 'The dialog was cancelled.', 'Cancelling…', 'Colour', 'colours', 'odd behaviour', 'Licence', 'Organise files', 'initialised',
    'analyse', '5 millimetres', 'labelled', 'grey', 'Travelling', 'whilst', 'a favourite', 'Paper fibres', 'fibre'];
  const gecir = ['Bottom center', 'The dialog was canceled.', 'Canceling…', 'Color', 'behavior', 'License', 'Organize', 'concentrate', 'centered', 'precise',
    'otherwise', 'promise', 'licensed', 'Analyze', 'program', 'canceled', 'flavor', 'cancel'];
  for (const m of yakala) assert.ok(INGILIZ.test(m), `İngiliz yazımı kaçtı: ${m}`);
  for (const m of gecir) assert.ok(!INGILIZ.test(m), `yanlış alarm: ${m}`);
  for (const m of ['could not be opened', 'Cannot open', 'can not', 'It is not valid', 'does not match', 'did not grant', "Don't", 'Do not use', 'will not work', 'are not'])
    assert.equal(UZUN_OLUMSUZ.test(m), !/n't/.test(m), m);
  for (const m of ["couldn't be opened", "can't", "isn't valid", 'Not saved (canceled)', 'not connected?', 'Notes', 'cannon']) assert.ok(!UZUN_OLUMSUZ.test(m), `yanlış alarm: ${m}`);
  for (const m of ['Source: docs/notlar/x.md.', 'files in app/vendor/ may be missing', '(vendor/literata/)', 'see README.md', 'src-tauri/src/i18n.rs']) assert.ok(IC_YOL.test(m), `iç yol kaçtı: ${m}`);
  for (const m of ['META-INF/container.xml', 'e.g. my-book.pdf', 'encryption.xml could not', 'qpdf --decrypt input.pdf output.pdf', 'PDF / EPUB', '1/2 steps', 'mucellit-backup-{tarih}'])
    assert.ok(!IC_YOL.test(m), `yanlış alarm: ${m}`);
  // gerçek sözlüğün bozulmuş kopyası
  const bozuk = { ...SOZLUK, 'zz.ingiliz': 'Page numbers (bottom centre)', 'zz.olumsuz': 'pdf.js could not be loaded', 'zz.yol': 'see files in app/vendor/' };
  for (const re of [INGILIZ, UZUN_OLUMSUZ, IC_YOL]) assert.equal(sorunlu(bozuk, re).length, sorunlu(SOZLUK, re).length + 1, String(re).slice(0, 30));
});

// Türkçe harfsiz (ASCII) Türkçe cümle sezgisi (26 sözcükten genişletildi + sık ekler).
const ASCII_TURKCE = ['Lutfen tekrar deneyin', 'Gecersiz deger girildi', 'Ayarlar kaydedilemedi', 'Yedek alinamadi', 'Sirt kalinligi hesaplanamadi',
  'Baski onizlemesi hazirlaniyor', 'Islem tamamlandi', 'Uyari: mukavva cok kalin', 'Tum kitaplar silinsin mi?', 'Adimlari sifirla', 'Secili sayfalari dondur',
  'Cikti uretilemedi', 'Iptal edildi', 'Kapak olcusu hesaplandi', 'Bu ayar degistirilemez', 'Dosya acilamadi', 'Forma sayisi yok', 'Kitap olusturuldu'];

test('tarama sezgisi: ASCII Türkçe cümleler yakalanır; İngilizce sözlük, statik HTML ve teknik dizgiler yanlış alarm vermez', () => {
  const kacan = ASCII_TURKCE.filter((m) => !turkceMi(m));
  assert.deepEqual(kacan, [], 'yakalanmayan ASCII Türkçe');
  const yanlis = metinler(SOZLUK).filter(([, m]) => turkceMi(m)).map(([a, m]) => `${a}: ${m}`);
  assert.deepEqual(yanlis, [], 'İngilizce metin Türkçe sanıldı');
  for (const m of ['system-ui, sans-serif', 'application/epub+zip', 'Mücellit', 'once more', 'Load a PDF once', 'Style guide', 'Somali', 'major update', 'hidden files', 'Sweden'])
    assert.equal(turkceMi(m), false, `yanlış alarm: ${m}`);
  assert.equal(turkceMi('Kaydet'), false, 'tek sözcük (boşluksuz) bilerek sayılmaz: kaynakta Türkçe tanıtıcılar çok (bilinen sınır)');
});

test('tarama sezgisi sınırları: CSS sınıfı/kimlik ve BÜYÜK HARFLİ makine kodu Türkçe sayılmaz; içindeki gerçek Türkçe sayılır', () => {
  for (const m of ['.surukleniyor, .hedef', '#kitap-listesi li', 'BULUNAMADI: {m}', 'GECERSIZ: {m}', 'DISKYOK: {ad}', 'kc-yedek-isleri calisiyor-x']) assert.equal(turkceMi(m), false, m);
  for (const m of ['BULUNAMADI: dosya silinmis', 'Hata: kayit silinemedi', 'DIKKAT tum veriler silinsin mi?']) assert.equal(turkceMi(m), true, m);
});

// ----------------------------------------------------------------
test('tr tauri.saklama_ipucu "(otomatik yedeklenir)" (edilgen; "(otomatik yedekle)" emir kipi değil)', () => {
  const tr = Dil.jsonAyikla(oku(path.join(KLASOR, 'tr.js')));
  assert.match(tr['tauri.saklama_ipucu'], /\(otomatik yedeklenir\)/);
  assert.doesNotMatch(tr['tauri.saklama_ipucu'], /\(otomatik yedekle\)/);
});

// ----------------------------------------------------------------
test('tamamı BÜYÜK HARFLİ (ASCII) Türkçe metin yakalanır; makine kodu yalnız "KOD:" önekiyse sayılmaz', () => {
  const yakala = ['DOSYA ACILAMADI', 'TUM VERILER SILINSIN MI?', 'KAYDEDILEMEDI, LUTFEN TEKRAR DENEYIN', 'UYARI: SAYFA BOS',
    'ISLEM IPTAL EDILDI', 'BULUNAMADI DOSYA SILINMIS', 'KITAP OLUSTURULDU', 'Dikkat: TUM KITAPLAR SILINECEK'];
  for (const m of yakala) assert.equal(turkceMi(m), true, `kaçtı: ${m}`);
  // makine kodu (Rust → JS hata öneki; JS'te dile göre metne çevrilir) ve teknik büyük harfli dizgiler
  const gecir = ['BULUNAMADI: {m}', 'GECERSIZ: {m}', 'DISKYOK: {ad}', 'BILINMEYEN: {}', 'ERISIM: {yol}', 'GECICI: {hata}', 'META-INF/container.xml',
    'OUT_DIR', 'CARGO_MANIFEST_DIR', 'EPUB → PDF', 'PDF EPUB JSON', 'UTF-8 BOM', 'DOMContentLoaded', 'HOME'];
  for (const m of gecir) assert.equal(turkceMi(m), false, `yanlış alarm: ${m}`);
});

// ---------------------------------------------------------------- ondalık ayracı arayüz diline göre
test('sayı alanı biçimi dile göre (en nokta, tr virgül), binlik ayracı yok; boş/geçersiz → ""', () => {
  const once = Dil.kod();
  try {
    Dil.ayarla('en');
    assert.deepEqual([0.1, 1234.5, 297, 0, -2.5, 0.1234567, NaN, Infinity, '0.25', null].map((n) => Dil.sayiAlan(n)), ['0.1', '1234.5', '297', '0', '-2.5', '0.123457', '', '', '0.25', '']);
    Dil.ayarla('tr');
    assert.deepEqual([0.1, 1234.5, 297, 215.9].map((n) => Dil.sayiAlan(n)), ['0,1', '1234,5', '297', '215,9']);
    assert.equal(Dil.sayi(10.4), '10,4', 'sonuç tablosu (mevcut sayi) tr virgül');
    Dil.ayarla('en');
    assert.equal(Dil.sayi(10.4), '10.4');
  } finally { Dil.ayarla(once); }
});

test('sayı girişi iki ayraçla da okunur (ortak.sayiCoz / sayi)', () => {
  const ctx = { document: { getElementById: (id) => ({ value: { a: '0,5', b: '0.5', c: ' 12 ', d: '', e: 'abc' }[id] }) } };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(oku(path.join(UYGULAMA, 'js', 'common.js')), ctx);
  const O = ctx.KitapCilt.ortak;
  assert.deepEqual(['0,5', '0.5', ' 12 ', '1,25', '-3,5'].map((s) => O.sayiCoz(s)), [0.5, 0.5, 12, 1.25, -3.5]);
  assert.ok(['', 'abc', null, undefined, ','].every((s) => Number.isNaN(O.sayiCoz(s))));
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((id) => O.sayi(id, -1)), [0.5, 0.5, 12, -1, -1]);
});

test('sayı alanları type=number değil (WebKit sistem bölgesiyle biçimliyordu); data-sayi + inputmode="decimal"', () => {
  const html = oku(path.join(UYGULAMA, 'index.html'));
  const sayiAlanlari = (h) => [...h.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((e) => /\sdata-sayi\b/.test(e) || /type="number"/.test(e));
  const hatalar = (h) => {
    const l = sayiAlanlari(h);
    const e = l.filter((x) => /type="number"/.test(x) || !/\sdata-sayi\b/.test(x) || !/inputmode="decimal"/.test(x) || !/type="text"/.test(x));
    return l.length >= 20 ? e : ['sayı alanı sayısı ' + l.length].concat(e);
  };
  assert.deepEqual(hatalar(html), []);
  // denetleyici kusurlu girdiyi yakalar
  const ilk = sayiAlanlari(html)[0];
  assert.ok(hatalar(html.replace(ilk, ilk.replace('type="text"', 'type="number"'))).length > 0, 'type=number');
  assert.ok(hatalar(html.replace(ilk, ilk.replace(' inputmode="decimal"', ''))).length > 0, 'inputmode yok');
  assert.ok(hatalar('<input type="text" data-sayi inputmode="decimal">').length > 0, 'iskelet (az alan)');
  // dinamik alanlar (Süreç ayrıntısı, EPUB ayarları) da metin + data-sayi
  for (const d of ['projects.js', path.join('plugins', 'epub.js')]) {
    const k = oku(path.join(UYGULAMA, 'js', d));
    assert.doesNotMatch(k, /type: 'number'|'number'\)/, d);
    assert.match(k, /'data-sayi'/, d);
  }
});

// ---------------------------------------------------------------- tam ekran menü adı
// Görünüm menüsündeki tam ekran öğesi AppKit'in toggleFullScreen: öğesidir (muda PredefinedMenuItem::fullscreen). AppKit
// menü doğrulanırken (menü açılınca) başlığı kendi çevirisiyle değiştirir: "Enter Full Screen"/"Exit Full Screen"
// (tr: "Tam Ekrana Geç"/"Tam Ekrandan Çık"; gözlem: rapor). Sözlük AppKit'in metniyle aynı olmalı ki menü
// doğrulanmadan önce de sonra da aynı adı göstersin.
test('menu.tam_ekran iki dilde AppKit\'in kendi metni ("Enter Full Screen" ↔ "Tam Ekrana Geç")', () => {
  const en = Dil.jsonAyikla(oku(path.join(KLASOR, 'en.js'))), tr = Dil.jsonAyikla(oku(path.join(KLASOR, 'tr.js')));
  assert.deepEqual([en['menu.tam_ekran'], tr['menu.tam_ekran']], ['Enter Full Screen', 'Tam Ekrana Geç']);
  const loctable = '/System/Library/Frameworks/AppKit.framework/Resources/MenuCommands.loctable';
  if (process.platform === 'darwin' && fs.existsSync(loctable)) {
    const j = JSON.parse(require('node:child_process').execFileSync('plutil', ['-convert', 'json', '-o', '-', loctable]).toString());
    assert.deepEqual([j.en['Enter Full Screen'], j.tr['Enter Full Screen']], [en['menu.tam_ekran'], tr['menu.tam_ekran']], 'AppKit MenuCommands.loctable');
  }
});
