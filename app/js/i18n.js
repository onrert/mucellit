/*
 * i18n.js — arayüz dili. Sözlükler app/i18n/<kod>.js dosyalarındadır; her biri iki /*JSON*\/ işareti
 * arasında KATI JSON bir nesne taşır (Rust aynı dosyayı derlemede gömer: src-tauri/build.rs, src/i18n.rs).
 * Yeni dil = app/i18n/<kod>.js + index.html'de bir <script> satırı (test unutulanı yakalar: i18n.test.js).
 *
 * Sözlük biçimi: { "_dil": "en", "_ad": "English", "_yerel": "en-US", "anahtar": "metin {ad}" | { "one": …, "other": … } }
 *   - {ad}: parametre (t(anahtar, { ad: … })); tekil/çoğul nesnede seçim `n` parametresiyle
 *     (Intl.PluralRules; kategori yoksa "other").
 *   - Eksik anahtar İngilizceye (en) düşer; en'de de yoksa anahtarın kendisi döner ve eksikler()'e yazılır.
 *
 * Dil seçimi: elle seçim localStorage 'kitapCilt.dil' ('en' | 'tr'; yoksa sistem dili). Sistem dili Apple
 * kuralıyla: tercih edilen diller listesinde birincil alt etiketi desteklenen İLK dil
 * ([de-DE, tr-TR] → tr; bölge kodu eşleşir); listede hiçbiri yoksa en. Tarayıcıda liste navigator.languages;
 * Tauri'de sistem dili Rust'tan gelir (NSLocale.preferredLanguages, aynı kural; menüdeki "Sistem dili (X)" ile
 * aynı kaynak: sistemKoduAyarla, platform-tauri.js; ilk karede de, Rust ön betiği window.__KC_DIL__.sistem ile).
 * Tauri'de seçim ayrıca Rust'a bildirilir (menü, pencereler).
 *
 * Arayüz: data-dil="anahtar" (textContent), data-dil-oz="aria-label:anahtar;title:anahtar" (öznitelikler).
 * etiketler i18n.js yüklenir yüklenmez yazılır (platform.hazir beklenmez; reddedilse de arayüz
 * metinli). index.html'deki statik metin en sözlüğüyle aynıdır (tools/i18n-html.mjs): i18n.js hiç çalışmasa da
 * arayüz İngilizce görünür; uygula() sözlükte olmayan anahtarla statik metni ezmez. Bozuk sözlük girdisi atlanır.
 * Tarayıcıda KitapCilt.dil; Node'da module.exports (sözlükler dosyadan okunur; öntanımlı dil KC_DIL || 'tr':
 * Node yalnız testler içindir ve mevcut testler Türkçe metni doğrular).
 */
(function (kok, fabrika) {
  var dugum = typeof module === 'object' && module.exports;
  var m = fabrika(kok, dugum);
  if (dugum) {
    module.exports = m;
  } else {
    kok.KitapCilt = kok.KitapCilt || {};
    kok.KitapCilt.dil = m;
  }
})(typeof self !== 'undefined' ? self : this, function (kok, dugum) {
  'use strict';

  var ANA = 'en';
  var SECIM_ANAHTAR = 'kitapCilt.dil';
  var ISARET = '/*JSON*/';
  var sozluk = Object.create(null); // kod → { anahtar: değer }
  var sira = [];                    // kodlar (en önce)
  var guncel = ANA;
  var eksik = [];

  /** Sözlük dosyası metninden JSON gövdesini çıkarır ve ayrıştırır (iki işaret arası). Bozuksa hata atar. */
  function jsonAyikla(metin) {
    var s = String(metin);
    var a = s.indexOf(ISARET), b = s.lastIndexOf(ISARET);
    if (a < 0 || b <= a) throw new Error('dictionary: missing ' + ISARET + ' markers');
    var nesne = JSON.parse(s.slice(a + ISARET.length, b));
    if (!nesne || typeof nesne !== 'object' || Array.isArray(nesne)) throw new Error('dictionary: body must be a JSON object');
    return nesne;
  }

  function sozlukEkle(s) {
    if (!s || typeof s !== 'object' || typeof s._dil !== 'string' || !s._dil) throw new Error('dictionary: missing _dil');
    sozluk[s._dil] = s;
    if (sira.indexOf(s._dil) < 0) sira.push(s._dil);
    sira.sort(function (x, y) { return (x === ANA ? -1 : 0) - (y === ANA ? -1 : 0) || (x < y ? -1 : x > y ? 1 : 0); });
  }

  if (dugum) {
    var fs = require('node:fs'), yol = require('node:path');
    var klasor = yol.join(__dirname, '..', 'i18n');
    fs.readdirSync(klasor).filter(function (a) { return /^[a-z]{2,3}\.js$/.test(a); }).sort().forEach(function (a) {
      sozlukEkle(jsonAyikla(fs.readFileSync(yol.join(klasor, a), 'utf8')));
    });
  } else {
    // Tarayıcıda bozuk girdi (geliştirici hatası; testler yakalar) öbür sözlükleri ve arayüzü düşürmez.
    var kayitli = kok.KitapCiltSozlukleri;
    (Array.isArray(kayitli) ? kayitli : []).forEach(function (s) {
      try { sozlukEkle(s); } catch (e) { if (kok.console && kok.console.warn) kok.console.warn('Mücellit: ' + e.message); }
    });
  }

  function destekli(kod) { return typeof kod === 'string' && Object.prototype.hasOwnProperty.call(sozluk, kod); }

  /**
   * Tercih edilen dil listesinden (ör. navigator.languages) arayüz dili, Apple kuralı: birincil alt etiketi
   * desteklenen ilk dil; yoksa en. Rust i18n::sistem_dili ile aynı (ortak vektörler: test/fixtures/i18n-vectors.json).
   */
  function sistemDili(liste) {
    var l = Array.isArray(liste) ? liste : [];
    for (var i = 0; i < l.length; i++) {
      if (typeof l[i] !== 'string' || !l[i]) continue;
      var kod = l[i].toLowerCase().split(/[-_]/)[0];
      if (destekli(kod)) return kod;
    }
    return ANA;
  }

  var sistemDis = null; // Tauri: Rust'ın bildirdiği sistem dili (menüyle aynı kaynak)
  // Tauri penceresi sayfa betiklerinden önce `window.__KC_DIL__ = { sistem: "<kod>" }` tanımlar (Rust
  // initialization_script, src-tauri/src/i18n.rs baslangic_betigi): ilk kare de menüdeki "Sistem dili (X)" ile aynı
  // dilde olur (navigator.languages → Rust kararı geçişi yok). Desteklenmeyen/bozuk değer yok sayılır.
  try {
    var dis = kok.__KC_DIL__;
    if (dis && typeof dis === 'object' && destekli(dis.sistem)) sistemDis = dis.sistem;
  } catch (e) { /* yok say */ }
  /** "Sistem dili" seçiminin karşılığı: Tauri'de Rust'ınki, tarayıcıda navigator.languages + Apple kuralı. */
  function sistemKodu() { return sistemDis || sistemDili(tarayiciDilleri()); }
  /** Dış (Rust) sistem dilini ayarlar; desteklenmeyen/boş değer yok sayılır (tarayıcı listesi kalır). */
  function sistemKoduAyarla(kod) { sistemDis = destekli(kod) ? kod : null; return sistemKodu(); }

  function tarayiciDilleri() {
    var n = kok.navigator;
    if (!n) return [];
    if (n.languages && n.languages.length) return Array.prototype.slice.call(n.languages);
    return n.language ? [n.language] : [];
  }

  /** Elle seçim (localStorage) ya da null (= sistem dili). */
  function secimOku() {
    try { var s = kok.localStorage && kok.localStorage.getItem(SECIM_ANAHTAR); return destekli(s) ? s : null; } catch (e) { return null; }
  }
  /** Elle seçimi saklar; null/'sistem' seçimi siler. */
  function secimYaz(kod) {
    try {
      if (destekli(kod)) kok.localStorage.setItem(SECIM_ANAHTAR, kod);
      else kok.localStorage.removeItem(SECIM_ANAHTAR);
    } catch (e) { /* saklama yok: yalnız bu oturum */ }
  }

  function ayarla(kod) {
    guncel = destekli(kod) ? kod : ANA;
    if (kok.document && kok.document.documentElement) kok.document.documentElement.setAttribute('lang', guncel);
    return guncel;
  }

  function ham(kod, anahtar) {
    var s = sozluk[kod];
    return s && Object.prototype.hasOwnProperty.call(s, anahtar) && anahtar.charAt(0) !== '_' ? s[anahtar] : undefined;
  }

  function cogulSec(deger, kod, n) {
    if (!deger || typeof deger !== 'object') return deger;
    var kat = 'other';
    try { kat = new Intl.PluralRules(kod).select(Number(n)); } catch (e) { kat = Number(n) === 1 ? 'one' : 'other'; }
    if (typeof deger[kat] === 'string') return deger[kat];
    return typeof deger.other === 'string' ? deger.other : '';
  }

  /** Parametreleri tek geçişte doldurur (değer içindeki {x} yeniden doldurulmaz; Rust i18n::doldur ile aynı). */
  function doldur(metin, p) {
    if (!p) return metin;
    return metin.replace(/\{([a-zA-Z0-9_]+)\}/g, function (tam, ad) {
      return Object.prototype.hasOwnProperty.call(p, ad) && p[ad] !== undefined && p[ad] !== null ? String(p[ad]) : tam;
    });
  }

  /** Metin (verilen dilde). Eksikse en'e, o da yoksa anahtara düşer. */
  function tDilde(kod, anahtar, p) {
    var kaynak = kod;
    var d = ham(kod, anahtar);
    if (d === undefined && kod !== ANA) { d = ham(ANA, anahtar); kaynak = ANA; }
    if (d === undefined) {
      if (eksik.indexOf(anahtar) < 0) eksik.push(anahtar);
      return anahtar;
    }
    return doldur(cogulSec(d, kaynak, p && p.n), p);
  }

  function t(anahtar, p) { return tDilde(guncel, anahtar, p); }
  function varMi(anahtar) { return ham(guncel, anahtar) !== undefined || ham(ANA, anahtar) !== undefined; }

  /** Sayı biçimi (ondalık ayracı dile göre). */
  function sayi(n, enCokBasamak) {
    var y = (sozluk[guncel] && sozluk[guncel]._yerel) || guncel;
    var x = Number(n);
    try { return x.toLocaleString(y, { maximumFractionDigits: enCokBasamak === undefined ? 3 : enCokBasamak }); } catch (e) { return String(x); }
  }

  /**
   * Sayı alanına yazılacak biçim: dilin ondalık ayracı (en ".", tr ","), binlik ayracı YOK (alan yeniden
   * okunabilsin), en çok 6 ondalık. Sayı değilse ''.
   */
  function sayiAlan(n) {
    var x = typeof n === 'string' && n.trim() !== '' ? Number(n) : n;
    if (typeof x !== 'number' || !isFinite(x)) return '';
    var y = (sozluk[guncel] && sozluk[guncel]._yerel) || guncel;
    try { return x.toLocaleString(y, { useGrouping: false, maximumFractionDigits: 6 }); } catch (e) { return String(x); }
  }

  /**
   * data-dil / data-dil-oz taşıyan öğelere metinleri yazar (kök: document ya da bir öğe). Anahtar hiçbir sözlükte
   * yoksa öğenin mevcut (statik İngilizce) metni korunur; metin yoksa anahtar yazılır (eksik görünür, eksikler()).
   */
  function uygula(kokOge) {
    var k = kokOge || kok.document;
    if (!k || typeof k.querySelectorAll !== 'function') return;
    var ogeler = k.querySelectorAll('[data-dil]');
    for (var i = 0; i < ogeler.length; i++) {
      var a = ogeler[i].getAttribute('data-dil');
      var m = t(a);
      if (m !== a || !ogeler[i].textContent) ogeler[i].textContent = m;
    }
    var oz = k.querySelectorAll('[data-dil-oz]');
    for (var j = 0; j < oz.length; j++) {
      String(oz[j].getAttribute('data-dil-oz')).split(';').forEach(function (cift) {
        var b = cift.indexOf(':');
        if (b <= 0) return;
        var ad = cift.slice(0, b).trim(), an = cift.slice(b + 1).trim(), d = t(an);
        if (d !== an || !oz[j].getAttribute(ad)) oz[j].setAttribute(ad, d);
      });
    }
    if (kok.document && k === kok.document) kok.document.title = t('uygulama.ad');
  }

  /** Başlangıç dili: elle seçim, yoksa sistem (tarayıcı) dili. */
  function baslangic() {
    if (dugum) return ayarla(destekli(process.env.KC_DIL) ? process.env.KC_DIL : 'tr');
    return ayarla(secimOku() || sistemKodu());
  }
  baslangic();

  // etiketler hemen (betik gövde sonunda: öğeler ayrıştırılmış) ve DOMContentLoaded'da yazılır;
  // platform.hazir beklenmez. Tauri'nin dil eşitlemesi sonradan dili değiştirirse orada yeniden uygulanır.
  if (!dugum && kok.document) {
    try { uygula(kok.document); } catch (e) { /* arayüz statik İngilizceyle kalır */ }
    if (kok.document.readyState === 'loading' && typeof kok.document.addEventListener === 'function') {
      kok.document.addEventListener('DOMContentLoaded', function () { try { uygula(kok.document); } catch (e) { /* statik */ } });
    }
  }

  return {
    ANA: ANA,
    SECIM_ANAHTAR: SECIM_ANAHTAR,
    diller: function () { return sira.slice(); },
    ad: function (kod) { return sozluk[kod] ? sozluk[kod]._ad : kod; },
    kod: function () { return guncel; },
    destekli: destekli,
    ayarla: ayarla,
    t: t,
    tDilde: tDilde,
    var: varMi,
    sayi: sayi,
    sayiAlan: sayiAlan,
    uygula: uygula,
    sistemDili: sistemDili,
    sistemKodu: sistemKodu,
    sistemKoduAyarla: sistemKoduAyarla,
    tarayiciDilleri: tarayiciDilleri,
    secimOku: secimOku,
    secimYaz: secimYaz,
    eksikler: function () { return eksik.slice(); },
    sozluk: function (kod) { return sozluk[kod] ? JSON.parse(JSON.stringify(sozluk[kod])) : null; },
    jsonAyikla: jsonAyikla,
    sozlukEkle: sozlukEkle,
    ISARET: ISARET
  };
});
