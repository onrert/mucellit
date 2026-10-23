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
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var m = factory(root, isNode);
  if (isNode) {
    module.exports = m;
  } else {
    root.Mucellit = root.Mucellit || {};
    root.Mucellit.i18n = m;
  }
})(typeof self !== 'undefined' ? self : this, function (root, isNode) {
  'use strict';

  var MAIN = 'en';
  var CHOICE_KEY = 'mucellit.language';
  // legacy-names: begin
  var LEGACY_CHOICE_KEY = 'kitapCilt.dil'; // the language choice as saved before the English code base
  // legacy-names: end
  var MARKER = '/*JSON*/';
  var dictionary = Object.create(null); // kod → { anahtar: değer }
  var order = [];                    // kodlar (en önce)
  var current = MAIN;
  var missing = [];

  /** Sözlük dosyası metninden JSON gövdesini çıkarır ve ayrıştırır (iki işaret arası). Bozuksa hata atar. */
  function extractJson(text) {
    var s = String(text);
    var a = s.indexOf(MARKER), b = s.lastIndexOf(MARKER);
    if (a < 0 || b <= a) throw new Error('dictionary: missing ' + MARKER + ' markers');
    var object = JSON.parse(s.slice(a + MARKER.length, b));
    if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('dictionary: body must be a JSON object');
    return object;
  }

  function addDictionary(s) {
    if (!s || typeof s !== 'object' || typeof s._lang !== 'string' || !s._lang) throw new Error('dictionary: missing _lang');
    dictionary[s._lang] = s;
    if (order.indexOf(s._lang) < 0) order.push(s._lang);
    order.sort(function (x, y) { return (x === MAIN ? -1 : 0) - (y === MAIN ? -1 : 0) || (x < y ? -1 : x > y ? 1 : 0); });
  }

  if (isNode) {
    var fs = require('node:fs'), path = require('node:path');
    var folder = path.join(__dirname, '..', 'i18n');
    fs.readdirSync(folder).filter(function (a) { return /^[a-z]{2,3}\.js$/.test(a); }).sort().forEach(function (a) {
      addDictionary(extractJson(fs.readFileSync(path.join(folder, a), 'utf8')));
    });
  } else {
    // Tarayıcıda bozuk girdi (geliştirici hatası; testler yakalar) öbür sözlükleri ve arayüzü düşürmez.
    var registered = root.MucellitDictionaries;
    (Array.isArray(registered) ? registered : []).forEach(function (s) {
      try { addDictionary(s); } catch (e) { if (root.console && root.console.warn) root.console.warn('Mücellit: ' + e.message); }
    });
  }

  function isSupported(code) { return typeof code === 'string' && Object.prototype.hasOwnProperty.call(dictionary, code); }

  /**
   * Tercih edilen dil listesinden (ör. navigator.languages) arayüz dili, Apple kuralı: birincil alt etiketi
   * desteklenen ilk dil; yoksa en. Rust i18n::sistem_dili ile aynı (ortak vektörler: test/fixtures/i18n-vectors.json).
   */
  function systemLanguage(list) {
    var l = Array.isArray(list) ? list : [];
    for (var i = 0; i < l.length; i++) {
      if (typeof l[i] !== 'string' || !l[i]) continue;
      var code = l[i].toLowerCase().split(/[-_]/)[0];
      if (isSupported(code)) return code;
    }
    return MAIN;
  }

  var externalSystem = null; // Tauri: Rust'ın bildirdiği sistem dili (menüyle aynı kaynak)
  // Tauri penceresi sayfa betiklerinden önce `window.__KC_DIL__ = { sistem: "<kod>" }` tanımlar (Rust
  // initialization_script, src-tauri/src/i18n.rs baslangic_betigi): ilk kare de menüdeki "Sistem dili (X)" ile aynı
  // dilde olur (navigator.languages → Rust kararı geçişi yok). Desteklenmeyen/bozuk değer yok sayılır.
  try {
    var outer = root.__MC_LANG__;
    if (outer && typeof outer === 'object' && isSupported(outer.system)) externalSystem = outer.system;
  } catch (e) { /* yok say */ }
  /** "Sistem dili" seçiminin karşılığı: Tauri'de Rust'ınki, tarayıcıda navigator.languages + Apple kuralı. */
  function systemCode() { return externalSystem || systemLanguage(browserLanguages()); }
  /** Dış (Rust) sistem dilini ayarlar; desteklenmeyen/boş değer yok sayılır (tarayıcı listesi kalır). */
  function setSystemCode(code) { externalSystem = isSupported(code) ? code : null; return systemCode(); }

  function browserLanguages() {
    var n = root.navigator;
    if (!n) return [];
    if (n.languages && n.languages.length) return Array.prototype.slice.call(n.languages);
    return n.language ? [n.language] : [];
  }

  /** Elle seçim (localStorage) ya da null (= sistem dili). */
  function readChoice() {
    try { var s = root.localStorage && root.localStorage.getItem(CHOICE_KEY); return isSupported(s) ? s : null; } catch (e) { return null; }
  }
  /** Elle seçimi saklar; null/'sistem' seçimi siler. */
  function writeChoice(code) {
    try {
      if (isSupported(code)) root.localStorage.setItem(CHOICE_KEY, code);
      else root.localStorage.removeItem(CHOICE_KEY);
    } catch (e) { /* saklama yok: yalnız bu oturum */ }
  }

  function set(code) {
    current = isSupported(code) ? code : MAIN;
    if (root.document && root.document.documentElement) root.document.documentElement.setAttribute('lang', current);
    return current;
  }

  function rawValue(code, key) {
    var s = dictionary[code];
    return s && Object.prototype.hasOwnProperty.call(s, key) && key.charAt(0) !== '_' ? s[key] : undefined;
  }

  function selectPlural(value, code, n) {
    if (!value || typeof value !== 'object') return value;
    var fold = 'other';
    try { fold = new Intl.PluralRules(code).select(Number(n)); } catch (e) { fold = Number(n) === 1 ? 'one' : 'other'; }
    if (typeof value[fold] === 'string') return value[fold];
    return typeof value.other === 'string' ? value.other : '';
  }

  /** Parametreleri tek geçişte doldurur (değer içindeki {x} yeniden doldurulmaz; Rust i18n::doldur ile aynı). */
  function fill(text, p) {
    if (!p) return text;
    return text.replace(/\{([a-zA-Z0-9_]+)\}/g, function (tam, name) {
      return Object.prototype.hasOwnProperty.call(p, name) && p[name] !== undefined && p[name] !== null ? String(p[name]) : tam;
    });
  }

  /** Metin (verilen dilde). Eksikse en'e, o da yoksa anahtara düşer. */
  function tIn(code, key, p) {
    var source = code;
    var d = rawValue(code, key);
    if (d === undefined && code !== MAIN) { d = rawValue(MAIN, key); source = MAIN; }
    if (d === undefined) {
      if (missing.indexOf(key) < 0) missing.push(key);
      return key;
    }
    return fill(selectPlural(d, source, p && p.n), p);
  }

  function t(key, p) { return tIn(current, key, p); }
  function has(key) { return rawValue(current, key) !== undefined || rawValue(MAIN, key) !== undefined; }

  /** Sayı biçimi (ondalık ayracı dile göre). */
  function number(n, maxStep) {
    var y = (dictionary[current] && dictionary[current]._locale) || current;
    var x = Number(n);
    try { return x.toLocaleString(y, { maximumFractionDigits: maxStep === undefined ? 3 : maxStep }); } catch (e) { return String(x); }
  }

  /**
   * Sayı alanına yazılacak biçim: dilin ondalık ayracı (en ".", tr ","), binlik ayracı YOK (alan yeniden
   * okunabilsin), en çok 6 ondalık. Sayı değilse ''.
   */
  function numberField(n) {
    var x = typeof n === 'string' && n.trim() !== '' ? Number(n) : n;
    if (typeof x !== 'number' || !isFinite(x)) return '';
    var y = (dictionary[current] && dictionary[current]._locale) || current;
    try { return x.toLocaleString(y, { useGrouping: false, maximumFractionDigits: 6 }); } catch (e) { return String(x); }
  }

  /**
   * data-dil / data-dil-oz taşıyan öğelere metinleri yazar (kök: document ya da bir öğe). Anahtar hiçbir sözlükte
   * yoksa öğenin mevcut (statik İngilizce) metni korunur; metin yoksa anahtar yazılır (eksik görünür, eksikler()).
   */
  function apply(rootElement) {
    var k = rootElement || root.document;
    if (!k || typeof k.querySelectorAll !== 'function') return;
    var elements = k.querySelectorAll('[data-i18n]');
    for (var i = 0; i < elements.length; i++) {
      var a = elements[i].getAttribute('data-i18n');
      var m = t(a);
      if (m !== a || !elements[i].textContent) elements[i].textContent = m;
    }
    var oz = k.querySelectorAll('[data-i18n-oz]');
    for (var j = 0; j < oz.length; j++) {
      String(oz[j].getAttribute('data-i18n-oz')).split(';').forEach(function (double) {
        var b = double.indexOf(':');
        if (b <= 0) return;
        var name = double.slice(0, b).trim(), an = double.slice(b + 1).trim(), d = t(an);
        if (d !== an || !oz[j].getAttribute(name)) oz[j].setAttribute(name, d);
      });
    }
    if (root.document && k === root.document) root.document.title = t('app.name');
  }

  /** Başlangıç dili: elle seçim, yoksa sistem (tarayıcı) dili. */
  /** One-time move of the language choice saved by an earlier version (see migrate.js for the other keys). */
  function migrateLegacyChoice() {
    try {
      var ls = root.localStorage;
      var old = ls && ls.getItem(LEGACY_CHOICE_KEY);
      if (old === null || old === undefined) return;
      if (ls.getItem(CHOICE_KEY) !== null) return; // the current choice wins; the legacy one is left alone
      ls.setItem(CHOICE_KEY, old);
      if (ls.getItem(CHOICE_KEY) !== null) ls.removeItem(LEGACY_CHOICE_KEY);
    } catch (e) { /* storage unavailable */ }
  }

  function initial() {
    if (!isNode) migrateLegacyChoice();
    if (isNode) return set(isSupported(process.env.MC_LANG) ? process.env.MC_LANG : 'tr');
    return set(readChoice() || systemCode());
  }
  initial();

  // etiketler hemen (betik gövde sonunda: öğeler ayrıştırılmış) ve DOMContentLoaded'da yazılır;
  // platform.hazir beklenmez. Tauri'nin dil eşitlemesi sonradan dili değiştirirse orada yeniden uygulanır.
  if (!isNode && root.document) {
    try { apply(root.document); } catch (e) { /* arayüz statik İngilizceyle kalır */ }
    if (root.document.readyState === 'loading' && typeof root.document.addEventListener === 'function') {
      root.document.addEventListener('DOMContentLoaded', function () { try { apply(root.document); } catch (e) { /* statik */ } });
    }
  }

  return {
    MAIN: MAIN,
    CHOICE_KEY: CHOICE_KEY,
    languages: function () { return order.slice(); },
    name: function (code) { return dictionary[code] ? dictionary[code]._name : code; },
    code: function () { return current; },
    isSupported: isSupported,
    set: set,
    t: t,
    tIn: tIn,
    has: has,
    number: number,
    numberField: numberField,
    apply: apply,
    systemLanguage: systemLanguage,
    systemCode: systemCode,
    setSystemCode: setSystemCode,
    browserLanguages: browserLanguages,
    readChoice: readChoice,
    writeChoice: writeChoice,
    missingKeys: function () { return missing.slice(); },
    dictionary: function (code) { return dictionary[code] ? JSON.parse(JSON.stringify(dictionary[code])) : null; },
    extractJson: extractJson,
    addDictionary: addDictionary,
    MARKER: MARKER
  };
});
