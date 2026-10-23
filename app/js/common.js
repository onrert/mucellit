/* common.js — arayüz yardımcıları (DOM). */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};

  function $(id) { return document.getElementById(id); }

  function el(label, property, children) {
    var e = document.createElement(label);
    if (property) {
      Object.keys(property).forEach(function (k) {
        var v = property[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'text') e.textContent = v;
        else if (k === 'class') e.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k in e && typeof v !== 'string') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  var noticeTimer = null;
  function notify(message, kind) {
    var b = $('notice');
    if (!b) return;
    b.textContent = message;
    b.className = 'show' + (kind === 'error' ? ' error' : '');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { b.className = ''; }, kind === 'error' ? 8000 : 3500);
  }

  /** Dosyayı kullanıcıya verir (tarayıcıda indirme). Promise<boolean>: false = kullanıcı vazgeçti. */
  function download(name, data, mime) {
    return MC.platform.save(name, data, mime);
  }

  // tek katı sayı ayrıştırıcı. İşaret, rakamlar ve en çok bir ondalık ayracı ("," ya da ".";
  // arayüz dilinden bağımsız kabul). Çoklu ayraç ("1.234,5"), sondaki çöp ("12abc", "12 mm"), üs ("1e3"), boşluklu
  // ("1 200"), sonsuz → NaN. Binliğe benzeyen girdi — dilin ondalık ayracı OLMAYAN ayraç + tam 3 hane, baş kısım 1–3
  // hane ve 0 değil (tr "1.200", en "1,200") — açık hata (NaN): tr'de "1.200" = 1200 mü 1,2 mi belirsiz; sessizce 1,2
  // okumak (eski parseFloat) sırtı yanlış hesaplatıyordu, 1200 okumak "1.125 mm" gibi ondalık yazan kullanıcıyı
  // yanıltırdı. Kayıtlı veri (secenek.kayit) binlik denetimine girmez: eski kayıtlar ("0.1", "0,1") okunmaya devam.
  var NUMBER_PATTERN = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;

  /** Arayüz dilinin ondalık ayracı ("," ya da "."); dil yüklü değilse ".". */
  function decimalSeparator() {
    var D = MC.i18n;
    var o = D && D.numberField ? D.numberField(1.5) : '1.5';
    return o.indexOf(',') >= 0 ? ',' : '.';
  }

  /** Binliğe benzeyen (belirsiz) girdi mi: dilin ondalık ayracı olmayan ayraç + tam 3 hane ("1.200" tr, "1,200" en). */
  function looksLikeThousands(s) {
    var other = decimalSeparator() === ',' ? '.' : ',';
    return new RegExp('^[+-]?[1-9]\\d{0,2}\\' + other + '\\d{3}$').test(s);
  }

  /**
   * Kullanıcının yazdığı ya da kayıtlı sayı → sayı; geçersizse NaN. Sayı türü girdi aynen (sonlu değilse NaN).
   * secenek.kayit: kayıtlı veri (binlik denetimi yok).
   */
  function parseNumber(text, options) {
    if (text === null || text === undefined) return NaN;
    if (typeof text === 'number') return isFinite(text) ? text : NaN;
    var s = String(text).trim();
    if (!NUMBER_PATTERN.test(s)) return NaN;
    if (!(options && options.record) && looksLikeThousands(s)) return NaN;
    var n = Number(s.replace(',', '.'));
    return isFinite(n) ? n : NaN;
  }

  /** Geçersiz sayı girdisi için kullanıcıya gösterilecek hata metni; geçerli ya da boşsa null. */
  function numberError(text) {
    if (text === null || text === undefined) return null;
    var s = String(text).trim();
    if (s === '' || isFinite(parseNumber(s))) return null;
    var D = MC.i18n;
    var thousands = NUMBER_PATTERN.test(s) && looksLikeThousands(s);
    if (!D || !D.t) return (thousands ? 'Ambiguous number (thousands separator?): ' : 'Not a valid number: ') + s;
    return D.t(thousands ? 'number.thousands' : 'number.invalid', { value: s, separator: decimalSeparator() });
  }

  /** Alandaki sayı; boş ya da geçersizse varsayilan (geçersizlik alan düzeyinde bildirilir: sayiAlanlariKur). */
  function number(id, defaults) {
    var n = parseNumber($(id).value);
    return isFinite(n) ? n : defaults;
  }

  /** Alandaki sayı; boşsa varsayilan, geçersizse anlaşılır hata atar (sessiz öntanımlı yok). */
  function requiredNumber(id, defaults) {
    var v = $(id).value;
    if (v === null || v === undefined || String(v).trim() === '') return defaults;
    var n = parseNumber(v);
    if (!isFinite(n)) throw new Error(numberError(v));
    return n;
  }

  /** Sayı alanına değeri arayüz dilinin biçimiyle yazar (KitapCilt.dil yoksa düz). oge: kimlik ya da öğe. */
  function writeNumber(element, n) {
    var e = typeof element === 'string' ? $(element) : element;
    if (!e) return;
    var D = MC.i18n;
    var x = typeof n === 'string' ? parseNumber(n, { record: true }) : n; // kayıtlı/programdan gelen değer
    e.value = D && D.numberField ? D.numberField(x) : (isFinite(x) ? String(x) : '');
  }

  function isNumberField(e) { return !!(e && e.tagName === 'INPUT' && e.hasAttribute && e.hasAttribute('data-number')); }

  /**
   * Sayı alanları (input[data-sayi], type=text inputmode=decimal): type=number WebKit'te sistem bölgesinin
   * ayracıyla görünüyordu (İngilizce arayüzde "0,1"). Burada (1) mevcut değerler dilin biçimine çevrilir, (2) alandan
   * çıkınca (change, yakalama evresinde: diğer dinleyiciler biçimli değeri görür) yazılan değer dilin biçimine döner,
   * (3) ↑/↓ eski type=number gibi step/min/max ile adımlar ve input + change olayı yayar. Belgeye bir kez bağlanır.
   */
  var numberFieldsReady = false;
  function setupNumberFields(rootElement) {
    var k = rootElement || document;
    var l = k.querySelectorAll ? k.querySelectorAll('input[data-number]') : [];
    for (var i = 0; i < l.length; i++) { var n = parseNumber(l[i].value, { record: true }); if (isFinite(n)) writeNumber(l[i], n); }
    if (numberFieldsReady || !document.addEventListener) return;
    numberFieldsReady = true;
    document.addEventListener('change', function (e) {
      if (!isNumberField(e.target)) return;
      var n = parseNumber(e.target.value);
      var error = numberError(e.target.value); // geçersiz girdi kullanıcıya bildirilir
      if (error) { e.target.setAttribute('aria-invalid', 'true'); e.target.title = error; notify(error, 'error'); return; }
      if (e.target.getAttribute('aria-invalid') === 'true') { e.target.removeAttribute('aria-invalid'); e.target.removeAttribute('title'); }
      if (isFinite(n)) writeNumber(e.target, n);
    }, true);
    document.addEventListener('keydown', function (e) {
      if (!isNumberField(e.target) || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.target.disabled || e.altKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      var g = e.target;
      var step = parseNumber(g.getAttribute('step'), { record: true });
      if (!(step > 0)) step = 1;
      var en = parseNumber(g.getAttribute('min'), { record: true }), ec = parseNumber(g.getAttribute('max'), { record: true });
      var v = parseNumber(g.value);
      if (!isFinite(v)) v = isFinite(en) ? en : 0;
      v = v + (e.key === 'ArrowUp' ? step : -step);
      v = Math.round(v * 1e6) / 1e6;
      if (isFinite(en) && v < en) v = en;
      if (isFinite(ec) && v > ec) v = ec;
      writeNumber(g, v);
      g.dispatchEvent(new Event('input', { bubbles: true }));
      g.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function readLocal(key) { try { return root.localStorage.getItem(key); } catch { return null; } }
  function writeLocal(key, value) { try { root.localStorage.setItem(key, value); } catch { /* yok say */ } }

  var PRESET_SIZES = [
    { name: 'A3', width: 297, height: 420 },
    { name: 'A4', width: 210, height: 297 },
    { name: 'A5', width: 148, height: 210 },
    { name: 'A6', width: 105, height: 148 },
    { name: 'Letter', width: 215.9, height: 279.4 }
  ];

  MC.common = { $: $, el: el, notify: notify, download: download, number: number, requiredNumber: requiredNumber, parseNumber: parseNumber, numberError: numberError, writeNumber: writeNumber, setupNumberFields: setupNumberFields, today: today, readLocal: readLocal, writeLocal: writeLocal, PRESET_SIZES: PRESET_SIZES };
})(typeof self !== 'undefined' ? self : this);
