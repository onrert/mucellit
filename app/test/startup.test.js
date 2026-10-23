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
const { SOZLUK_DOSYALARI, KLASOR } = require('./i18n-helper.js');

const UYGULAMA = path.join(__dirname, '..');
const oku = (y) => fs.readFileSync(y, 'utf8');
const HTML = oku(path.join(UYGULAMA, 'index.html'));
const EN = require('../js/i18n.js').jsonAyikla(oku(path.join(KLASOR, 'en.js')));

const VARLIK = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function cozHtml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (tam, v) => {
    if (v[0] === '#') return String.fromCodePoint(v[1] === 'x' || v[1] === 'X' ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(VARLIK, v) ? VARLIK[v] : tam;
  });
}

/**
 * HTML'deki data-dil / data-dil-oz taşıyan etiketler: { etiket, oz: {öznitelik: değer}, ic: kapanışa kadarki metin
 * (yalnız data-dil'de; iç içe öğe varsa null) }. Yorumlar ve <script> atlanır.
 */
function dilOgeleri(html) {
  const temiz = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const l = [];
  const etiket = /<([a-z][a-z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let m;
  while ((m = etiket.exec(temiz)) !== null) {
    if (!/\sdata-dil(-oz)?\s*=/.test(m[2])) continue;
    const oz = {};
    for (const o of m[2].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      oz[o[1]] = cozHtml(o[2] !== undefined ? o[2] : o[3] !== undefined ? o[3] : o[4] !== undefined ? o[4] : '');
    }
    let ic = null;
    if ('data-dil' in oz) {
      const kapanis = new RegExp('</' + m[1] + '\\s*>', 'i');
      const kalan = temiz.slice(m.index + m[0].length);
      const k = kapanis.exec(kalan);
      const ham = k ? kalan.slice(0, k.index) : '';
      ic = /</.test(ham) ? null : cozHtml(ham);
    }
    l.push({ etiket: m[1].toLowerCase(), oz, ic });
  }
  return l;
}

/** index.html'deki statik metnin en sözlüğüyle farkları (boş dizi = aynı). */
function statikFarklar(html, en) {
  const fark = [];
  const ogeler = dilOgeleri(html);
  if (!ogeler.length) return ['data-dil öğesi yok'];
  for (const o of ogeler) {
    if ('data-dil' in o.oz) {
      const a = o.oz['data-dil'];
      if (typeof en[a] !== 'string') fark.push(`${a}: en sözlüğünde düz metin değil`);
      else if (o.ic === null) fark.push(`${a}: öğenin içinde başka öğe var (textContent ezer)`);
      else if (o.ic !== en[a]) fark.push(`${a}: "${o.ic}" ≠ "${en[a]}"`);
    }
    if ('data-dil-oz' in o.oz) {
      for (const cift of o.oz['data-dil-oz'].split(';')) {
        const b = cift.indexOf(':');
        if (b <= 0) continue;
        const ad = cift.slice(0, b).trim(), a = cift.slice(b + 1).trim();
        if (typeof en[a] !== 'string') fark.push(`${ad}:${a}: en sözlüğünde düz metin değil`);
        else if (o.oz[ad] !== en[a]) fark.push(`${ad}:${a}: "${o.oz[ad]}" ≠ "${en[a]}"`);
      }
    }
  }
  return fark;
}

test('index.html statik metni en sözlüğüyle aynı: i18n.js çalışmasa da arayüz İngilizce metinli (tools/i18n-html.mjs)', () => {
  assert.deepEqual(statikFarklar(HTML, EN), []);
  const n = dilOgeleri(HTML).length;
  assert.ok(n >= 100, `${n} öğe`);
  assert.match(HTML, /<html lang="en">/, 'statik metin İngilizce: html lang en');
});

test('statik metin denetleyicisi kusurlu HTML\'i yakalar (boş, farklı, iç içe, eksik öznitelik, iskelet, kopya)', () => {
  const ilk = /<button role="tab" id="sekme-dugme-duzenle"[^>]*>[^<]*<\/button>/.exec(HTML)[0];
  const durumlar = {
    'boş metin': HTML.replace(ilk, ilk.replace(/>[^<]*</, '><')),
    'farklı metin': HTML.replace(ilk, ilk.replace(/>[^<]*</, '>Düzenle<')),
    'boşluklu metin': HTML.replace(ilk, ilk.replace(/>([^<]*)</, '> $1 <')),
    'iç içe öğe': HTML.replace(ilk, ilk.replace(/>[^<]*</, '><b>Imposition</b><')),
    'eksik öznitelik': HTML.replace(/(<select id="dil-sec")\s+aria-label="[^"]*"/, '$1'),
    'yanlış öznitelik': HTML.replace(/(<select id="dil-sec") aria-label="[^"]*"/, '$1 aria-label="Dil"'),
    'iskelet (öğe yok)': '<!doctype html><html lang="en"><body></body></html>',
    'kopya (Türkçe sözlük metni)': (() => {
      const TR = require('../js/i18n.js').jsonAyikla(oku(path.join(KLASOR, 'tr.js')));
      return HTML.replace(/(data-dil="([^"]+)"[^>]*>)[^<]*</g, (t, bas, a) => bas + (TR[a] || '') + '<');
    })(),
  };
  for (const [ad, h] of Object.entries(durumlar)) {
    assert.notEqual(h, HTML, `${ad}: bozma uygulanamadı (test kendisi)`);
    assert.ok(statikFarklar(h, EN).length > 0, `${ad}: yakalanmadı`);
  }
  assert.deepEqual(statikFarklar(HTML, EN), [], 'gerçek dosya temiz');
  assert.equal(cozHtml('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#x27; &bilinmeyen;'), 'a & b <c> "d" \'e\' &bilinmeyen;');
});

// ---------------------------------------------------------------- sahte DOM ile açılış
function sahteBelge() {
  const ogeler = dilOgeleri(HTML).map((o) => ({
    ...o, textContent: o.ic === null ? '' : o.ic, nitelik: { ...o.oz },
    getAttribute(a) { return Object.prototype.hasOwnProperty.call(this.nitelik, a) ? this.nitelik[a] : null; },
    setAttribute(a, v) { this.nitelik[a] = String(v); },
  }));
  const dinleyici = {};
  const kokOge = { nitelik: { lang: 'en' }, setAttribute(a, v) { this.nitelik[a] = String(v); }, getAttribute(a) { return this.nitelik[a]; } };
  const bos = {};
  const belge = {
    readyState: 'loading',
    title: 'Mücellit',
    documentElement: kokOge,
    querySelectorAll(s) {
      if (s === '[data-dil]') return ogeler.filter((o) => o.getAttribute('data-dil') !== null);
      if (s === '[data-dil-oz]') return ogeler.filter((o) => o.getAttribute('data-dil-oz') !== null);
      return [];
    },
    getElementById(id) { return ogeler.find((o) => o.getAttribute('id') === id) || (bos[id] = bos[id] || { id, nitelik: {}, setAttribute(a, v) { this.nitelik[a] = v; }, getAttribute(a) { return this.nitelik[a]; } }); },
    addEventListener(ad, f) { (dinleyici[ad] = dinleyici[ad] || []).push(f); },
  };
  return { belge, ogeler, dinleyici, yukle() { belge.readyState = 'interactive'; (dinleyici.DOMContentLoaded || []).forEach((f) => f()); } };
}

/**
 * Tarayıcıdaki sırayla: sözlükler (sozlukMetni ile değiştirilebilir), i18n.js (dilMetni ile), app.js. hazir:
 * KC.platform.hazir. Betik hatası (sayfadaki gibi) yakalanır, sonraki betik çalışır.
 */
function ac({ diller = ['tr-TR'], hazir = Promise.resolve(), sozlukMetni = {}, dilMetni, dis, secim } = {}) {
  const b = sahteBelge();
  const bildirimler = [];
  const hatalar = [];
  const ctx = { navigator: { languages: diller }, document: b.belge, console: { error: (...a) => hatalar.push(a.join(' ')) } };
  if (dis !== undefined) ctx.__KC_DIL__ = dis; // Tauri'nin initialization_script'i (Rust i18n::baslangic_betigi)
  if (secim !== undefined) ctx.localStorage = { getItem: (a) => (a === 'kitapCilt.dil' ? secim : null), setItem() {}, removeItem() {} };
  ctx.self = ctx;
  vm.createContext(ctx);
  const calistir = (kod, ad) => { try { vm.runInContext(kod, ctx, { filename: ad }); } catch (e) { hatalar.push(`${ad}: ${e.message}`); } };
  for (const a of SOZLUK_DOSYALARI) calistir(a in sozlukMetni ? sozlukMetni[a] : oku(path.join(KLASOR, a)), 'i18n/' + a);
  calistir(dilMetni !== undefined ? dilMetni : oku(path.join(UYGULAMA, 'js', 'i18n.js')), 'js/i18n.js');
  const KC = ctx.KitapCilt = ctx.KitapCilt || {};
  KC.ortak = { $: (id) => b.belge.getElementById(id), bildir: (m, t) => bildirimler.push([m, t]), yerelYaz() {}, yerelOku: () => null, el: () => ({}) };
  KC.platform = { hazir, metin: { kutuphaneIpucu: 'ipucu' }, onayla: () => Promise.resolve(true) };
  KC.surec = { baslat() {} }; KC.duzenle = { baslat() {} }; KC.hesapla = { baslat() {} };
  ctx.PDFLib = {}; ctx.pdfjsLib = {};
  calistir(oku(path.join(UYGULAMA, 'js', 'app.js')), 'js/app.js');
  return { ...b, ctx, bildirimler, hatalar };
}
const bekle = () => new Promise((r) => setImmediate(r));
const TR = require('../js/i18n.js').jsonAyikla(oku(path.join(KLASOR, 'tr.js')));

function etiketler(ogeler) {
  return ogeler.filter((o) => o.getAttribute('data-dil') !== null).map((o) => [o.getAttribute('data-dil'), o.textContent]);
}

test('açılış: platform.hazir reddedilse de statik etiketler i18n.js yüklenir yüklenmez seçili dilde (tr-TR → Türkçe)', async () => {
  const s = ac({ diller: ['tr-TR'], hazir: Promise.reject(new Error('köprü yok')) });
  // DOMContentLoaded'dan önce bile (betikler gövde sonunda: öğeler ayrıştırılmış)
  const once = etiketler(s.ogeler).filter(([a, m]) => m !== TR[a]);
  assert.deepEqual(once.slice(0, 5), [], `${once.length} etiket Türkçe değil`);
  s.yukle();
  await bekle();
  const l = etiketler(s.ogeler);
  assert.ok(l.length >= 100);
  assert.deepEqual(l.filter(([a, m]) => !m || m !== TR[a]).slice(0, 5), [], 'her etiket dolu ve Türkçe');
  const dil = s.ogeler.find((o) => o.getAttribute('id') === 'dil-sec');
  assert.equal(dil.nitelik['aria-label'], 'Dil');
  assert.equal(s.belge.documentElement.nitelik.lang, 'tr');
  assert.deepEqual(s.bildirimler, [['Uygulama başlatılamadı: köprü yok', 'hata']]);
  assert.deepEqual(s.hatalar, []);
});

test('açılış: en-US tarayıcıda etiketler İngilizce; hazır olunca yeniden uygulanır (Tauri eşitlemesi gibi)', async () => {
  let coz;
  const s = ac({ diller: ['en-US'], hazir: new Promise((r) => { coz = r; }) });
  assert.deepEqual(etiketler(s.ogeler).filter(([a, m]) => m !== EN[a]).slice(0, 3), []);
  // hazir'dan önce dil değişti (Tauri: dil_oku Rust yedeğinden "tr" getirdi) → baslat yeniden uygular
  s.ctx.KitapCilt.dil.ayarla('tr');
  s.yukle();
  coz();
  await bekle();
  assert.deepEqual(etiketler(s.ogeler).filter(([a, m]) => m !== TR[a]).slice(0, 3), []);
});

test('açılış: tr sözlüğü bozuksa i18n.js yine çalışır, tr-TR kullanıcısı İngilizce (boş değil) görür', async () => {
  for (const bozuk of ['(self.KitapCiltSozlukleri = (self.KitapCiltSozlukleri || []).concat([{ "_ad": "Türkçe" }]));', 'self.KitapCiltSozlukleri = (self.KitapCiltSozlukleri || []).concat([null, 5, "x"]);']) {
    const s = ac({ diller: ['tr-TR'], sozlukMetni: { 'tr.js': bozuk } });
    s.yukle();
    await bekle();
    assert.equal(s.ctx.KitapCilt.dil && s.ctx.KitapCilt.dil.kod(), 'en', bozuk);
    assert.deepEqual(etiketler(s.ogeler).filter(([a, m]) => m !== EN[a]).slice(0, 3), [], bozuk);
    assert.deepEqual(s.bildirimler, [], 'başlatma sürer');
  }
});

test('açılış: i18n.js hata atarsa statik İngilizce metin yerinde kalır (boş arayüz yok)', async () => {
  const s = ac({ diller: ['tr-TR'], dilMetni: 'throw new Error("i18n.js bozuk");' });
  s.yukle();
  await bekle();
  const l = etiketler(s.ogeler);
  assert.ok(l.length >= 100);
  assert.deepEqual(l.filter(([a, m]) => m !== EN[a]).slice(0, 3), [], 'statik İngilizce');
  assert.ok(s.hatalar.some((h) => /i18n\.js bozuk/.test(h)), s.hatalar.join(' | '));
  // başlatma hatası dil altyapısı olmadan da (İngilizce) bildirilir; işlenmemiş red yok
  assert.equal(s.bildirimler.length, 1, JSON.stringify(s.bildirimler));
  assert.match(s.bildirimler[0][0], /^The app couldn't start: /);
});

test('tools/i18n-html.mjs: kusurlu girdide sorun bildirir, kaçışları doğru yazar, güncel dosyada değişiklik yapmaz', async () => {
  const { guncelle } = await import('../../tools/i18n-html.mjs');
  const en = { 'a.b': 'A & B <x> "q"', 'c.d': 'Title "1"', 'cogul': { one: '1', other: '{n}' } };
  const r = guncelle('<p data-dil="a.b">eski</p><i data-dil-oz="title:c.d"></i><b title="x" data-dil-oz="title:c.d"></b>', en);
  assert.deepEqual(r.sorun, []);
  assert.equal(r.html, '<p data-dil="a.b">A &amp; B &lt;x&gt; "q"</p><i title="Title &quot;1&quot;" data-dil-oz="title:c.d"></i><b title="Title &quot;1&quot;" data-dil-oz="title:c.d"></b>');
  assert.equal(r.degisen, 3);
  assert.deepEqual(statikFarklar(r.html, en), [], 'bağımsız denetleyici yazılanı kabul eder (kaçış gidiş-dönüş)');
  const iki = guncelle(r.html, en);
  assert.equal(iki.degisen, 0);
  assert.equal(iki.html, r.html, 'ikinci koşu değiştirmez');
  for (const [ad, h] of [['iç içe öğe', '<p data-dil="a.b"><b>x</b></p>'], ['çoğul anahtar', '<p data-dil="cogul"></p>'], ['bilinmeyen anahtar', '<p data-dil="yok.x"></p>'],
    ['öznitelikte bilinmeyen', '<i data-dil-oz="title:yok.x"></i>'], ['kapanışsız', '<p data-dil="a.b">x']]) {
    assert.ok(guncelle(h, en).sorun.length > 0, `${ad}: sorun bildirilmedi`);
  }
  // gerçek dosya güncel (betik --denetle ile aynı)
  const g = guncelle(HTML, EN);
  assert.deepEqual(g.sorun, []);
  assert.equal(g.html, HTML, 'index.html güncel: node tools/i18n-html.mjs');
});

// ---------------------------------------------------------------- Tauri'de ilk kare Rust'ın sistem diliyle
test('Tauri ön betiği (__KC_DIL__.sistem) varsa ilk kare o dilde; navigator.languages\'ten geçiş yok', async () => {
  // WKWebView navigator.languages tek dil (en-US) verir, Rust NSLocale + Apple kuralı tr der: etiketler HEMEN Türkçe
  const s = ac({ diller: ['en-US'], dis: { sistem: 'tr' }, hazir: new Promise(() => {}) });
  assert.equal(s.ctx.KitapCilt.dil.kod(), 'tr', 'i18n.js yüklenir yüklenmez (platform.hazir beklenmeden)');
  const fark = etiketler(s.ogeler).filter(([a, m]) => m !== TR[a]);
  assert.deepEqual(fark.slice(0, 3), [], `${fark.length} etiket Türkçe değil`);
  assert.equal(s.ctx.KitapCilt.dil.sistemKodu(), 'tr');
  // tersi: tarayıcı tr-TR, Rust en
  const e = ac({ diller: ['tr-TR'], dis: { sistem: 'en' }, hazir: new Promise(() => {}) });
  assert.equal(e.ctx.KitapCilt.dil.kod(), 'en');
  assert.deepEqual(etiketler(e.ogeler).filter(([a, m]) => m !== EN[a]).slice(0, 3), []);
  assert.deepEqual([s.hatalar, e.hatalar], [[], []]);
});

test('bozuk/desteklenmeyen __KC_DIL__ yok sayılır (tarayıcı dili kalır); elle seçim yine önce gelir', () => {
  for (const dis of [null, 'tr', 42, {}, { sistem: 'xx' }, { sistem: 'TR' }, { sistem: '' }, { sistem: { toString: () => 'tr' } }]) {
    const s = ac({ diller: ['en-US'], dis, hazir: new Promise(() => {}) });
    assert.equal(s.ctx.KitapCilt.dil.kod(), 'en', JSON.stringify(dis));
    assert.deepEqual(s.hatalar, [], JSON.stringify(dis));
  }
  // getter hata atarsa da açılış sürer
  const b = ac({ diller: ['en-US'], dis: Object.defineProperty({}, 'sistem', { get() { throw new Error('bozuk'); } }), hazir: new Promise(() => {}) });
  assert.equal(b.ctx.KitapCilt.dil.kod(), 'en');
  // elle seçim (localStorage) Rust'ın sistem dilinden önce gelir
  const el = ac({ diller: ['tr-TR'], dis: { sistem: 'tr' }, secim: 'en', hazir: new Promise(() => {}) });
  assert.equal(el.ctx.KitapCilt.dil.kod(), 'en');
  assert.equal(el.ctx.KitapCilt.dil.sistemKodu(), 'tr');
});

// ---------------------------------------------------------------- dil seçici ipucu
test('dil seçicinin ipucu (title) statik değil (yeniden yüklemede eski dilde "Language" görünmez); seçili dilde yazılır ve dil değişince güncellenir', async () => {
  const dilSec = dilOgeleri(HTML).find((o) => o.oz.id === 'dil-sec');
  assert.ok(dilSec, 'index.html #dil-sec');
  assert.equal('title' in dilSec.oz, false, 'statik title yok');
  assert.match(dilSec.oz['aria-label'] || '', /^Language$/, 'erişilebilir ad statik İngilizce (i18n.js yoksa da)');
  let coz;
  const s = ac({ diller: ['tr-TR'], hazir: new Promise((r) => { coz = r; }) });
  const sec = s.ogeler.find((o) => o.getAttribute('id') === 'dil-sec');
  assert.equal(sec.nitelik.title, 'Dil', 'açılışta seçili dilde (Türkçe)');
  assert.equal(sec.nitelik['aria-label'], 'Dil');
  // Tauri eşitlemesi dili değiştirdi (yeniden yükleme yok) → baslat ipucunu da günceller
  s.ctx.KitapCilt.dil.ayarla('en');
  s.yukle();
  coz();
  await bekle(); await bekle();
  assert.equal(sec.nitelik.title, 'Language');
  assert.equal(sec.nitelik['aria-label'], 'Language');
});
