/* common.js — interface helpers (DOM). */
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

  /** Hands the file to the user (a download in the browser). Promise<boolean>: false = the user cancelled. */
  function download(name, data, mime) {
    return MC.platform.save(name, data, mime);
  }

  // single strict number parser. A sign, digits and at most one decimal separator ("," or ".";
  // accepted whatever the interface language). Several separators ("1.234,5"), trailing junk ("12abc", "12 mm"), an exponent ("1e3"), spaces
  // ("1 200") and infinity → NaN. Input that looks like thousands — a separator that is NOT the language's decimal separator + exactly 3 digits, a leading part of 1–3
  // digits that is not 0 (tr "1.200", en "1,200") — is an explicit error (NaN): in tr "1.200" may mean 1200 or 1.2; silently reading 1.2
  // (the old parseFloat) computed a wrong spine, and reading 1200 would mislead a user who writes decimals like "1.125 mm".
  // Saved data (options.record) skips the thousands check: old records ("0.1", "0,1") are still read.
  var NUMBER_PATTERN = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;

  /** The decimal separator of the interface language ("," or "."); "." when no language is loaded. */
  function decimalSeparator() {
    var D = MC.i18n;
    var o = D && D.numberField ? D.numberField(1.5) : '1.5';
    return o.indexOf(',') >= 0 ? ',' : '.';
  }

  /** Does the input look like thousands (ambiguous): a separator that is not the language's decimal separator + exactly 3 digits ("1.200" tr, "1,200" en). */
  function looksLikeThousands(s) {
    var other = decimalSeparator() === ',' ? '.' : ',';
    return new RegExp('^[+-]?[1-9]\\d{0,2}\\' + other + '\\d{3}$').test(s);
  }

  /**
   * A number typed by the user or saved → number; NaN when invalid. A number input stays as it is (NaN when not finite).
   * options.record: saved data (no thousands check).
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

  /** The error text shown to the user for an invalid number input; null when valid or empty. */
  function numberError(text) {
    if (text === null || text === undefined) return null;
    var s = String(text).trim();
    if (s === '' || isFinite(parseNumber(s))) return null;
    var D = MC.i18n;
    var thousands = NUMBER_PATTERN.test(s) && looksLikeThousands(s);
    if (!D || !D.t) return (thousands ? 'Ambiguous number (thousands separator?): ' : 'Not a valid number: ') + s;
    return D.t(thousands ? 'number.thousands' : 'number.invalid', { value: s, separator: decimalSeparator() });
  }

  /** The number in the field; the default when it is empty or invalid (invalid input is reported on the field: setupNumberFields). */
  function number(id, defaults) {
    var n = parseNumber($(id).value);
    return isFinite(n) ? n : defaults;
  }

  /** The number in the field; the default when empty; throws a clear error when invalid (no silent default). */
  function requiredNumber(id, defaults) {
    var v = $(id).value;
    if (v === null || v === undefined || String(v).trim() === '') return defaults;
    var n = parseNumber(v);
    if (!isFinite(n)) throw new Error(numberError(v));
    return n;
  }

  /** Writes a value into a number field in the interface language's format (plain without Mucellit.i18n). element: id or element. */
  function writeNumber(element, n) {
    var e = typeof element === 'string' ? $(element) : element;
    if (!e) return;
    var D = MC.i18n;
    var x = typeof n === 'string' ? parseNumber(n, { record: true }) : n; // value that was saved or comes from the program
    e.value = D && D.numberField ? D.numberField(x) : (isFinite(x) ? String(x) : '');
  }

  function isNumberField(e) { return !!(e && e.tagName === 'INPUT' && e.hasAttribute && e.hasAttribute('data-number')); }

  /**
   * Number fields (input[data-number], type=text inputmode=decimal): with type=number WebKit showed the separator of the
   * system region ("0,1" in the English interface). Here (1) existing values are converted to the language's format,
   * (2) on leaving a field (change, in the capture phase: other listeners see the formatted value) the typed value is
   * converted back to the language's format, (3) ↑/↓ step by step/min/max like the old type=number and fire input + change.
   * Bound to the document once.
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
      var error = numberError(e.target.value); // invalid input is reported to the user
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
  function writeLocal(key, value) { try { root.localStorage.setItem(key, value); } catch { /* ignore */ } }

  var PRESET_SIZES = [
    { name: 'A3', width: 297, height: 420 },
    { name: 'A4', width: 210, height: 297 },
    { name: 'A5', width: 148, height: 210 },
    { name: 'A6', width: 105, height: 148 },
    { name: 'Letter', width: 215.9, height: 279.4 }
  ];

  MC.common = { $: $, el: el, notify: notify, download: download, number: number, requiredNumber: requiredNumber, parseNumber: parseNumber, numberError: numberError, writeNumber: writeNumber, setupNumberFields: setupNumberFields, today: today, readLocal: readLocal, writeLocal: writeLocal, PRESET_SIZES: PRESET_SIZES };
})(typeof self !== 'undefined' ? self : this);
