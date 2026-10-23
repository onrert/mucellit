/*
 * i18n.js — interface language. The dictionaries are in app/i18n/<code>.js; each one carries a STRICT JSON object
 * between two /*JSON*\/ markers (Rust embeds the same file at build time: src-tauri/build.rs, src/i18n.rs).
 * A new language = app/i18n/<code>.js + one <script> line in index.html (a test catches a forgotten one: i18n.test.js).
 *
 * Dictionary format: { "_lang": "en", "_name": "English", "_locale": "en-US", "key": "text {name}" | { "one": …, "other": … } }
 *   - {name}: parameter (t(key, { name: … })); in a singular/plural object the form is chosen by the `n` parameter
 *     (Intl.PluralRules; "other" when the category is missing).
 *   - A missing key falls back to English (en); when en has none either, the key itself is returned and recorded in
 *     missingKeys().
 *
 * Language choice: a manual choice in localStorage 'mucellit.language' ('en' | 'tr'; otherwise the system language).
 * System language by the Apple rule: the FIRST language in the preferred languages list whose primary subtag is
 * supported ([de-DE, tr-TR] → tr; a region code matches); en when none is. In the browser the list is
 * navigator.languages; in Tauri the system language comes from Rust (NSLocale.preferredLanguages, same rule; same source
 * as "System Language (X)" in the menu: setSystemCode, platform-tauri.js; also on the first frame, through the Rust
 * init script window.__MC_LANG__.system). In Tauri the choice is also reported to Rust (menu, windows).
 * A choice saved by an earlier version is moved once (migrateLegacyChoice).
 *
 * Interface: data-i18n="key" (textContent), data-i18n-attr="aria-label:key;title:key" (attributes).
 * Labels are written as soon as i18n.js loads (platform.ready is not awaited; the interface has text even when it is
 * rejected). The static text in index.html is the same as the en dictionary (tools/i18n-html.mjs): even when i18n.js
 * does not run at all, the interface shows English; apply() does not overwrite static text with a key missing from
 * the dictionaries. A broken dictionary entry is skipped.
 * Browser: Mucellit.i18n; Node: module.exports (dictionaries are read from the files; default language MC_LANG || 'tr':
 * Node is only for tests and the existing tests check the Turkish text).
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
  var dictionary = Object.create(null); // code → { key: value }
  var order = [];                    // codes (en first)
  var current = MAIN;
  var missing = [];

  /** Extracts and parses the JSON body of a dictionary file (between the two markers). Throws when it is broken. */
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
    // In the browser a broken entry (a developer error; caught by tests) does not bring down the other dictionaries or the interface.
    var registered = root.MucellitDictionaries;
    (Array.isArray(registered) ? registered : []).forEach(function (s) {
      try { addDictionary(s); } catch (e) { if (root.console && root.console.warn) root.console.warn('Mücellit: ' + e.message); }
    });
  }

  function isSupported(code) { return typeof code === 'string' && Object.prototype.hasOwnProperty.call(dictionary, code); }

  /**
   * Interface language from a preferred languages list (e.g. navigator.languages), Apple rule: the first language whose
   * primary subtag is supported; otherwise en. Same as Rust i18n::system_language (shared vectors:
   * test/fixtures/i18n-vectors.json).
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

  var externalSystem = null; // Tauri: the system language reported by Rust (same source as the menu)
  // The Tauri window defines `window.__MC_LANG__ = { system: "<code>" }` before the page scripts (Rust
  // initialization_script, src-tauri/src/i18n.rs init_script): the first frame is in the same language as "System Language (X)"
  // in the menu (no switch from navigator.languages to the Rust decision). An unsupported or broken value is ignored.
  try {
    var outer = root.__MC_LANG__;
    if (outer && typeof outer === 'object' && isSupported(outer.system)) externalSystem = outer.system;
  } catch (e) { /* ignore */ }
  /** What the "System language" choice means: Rust's in Tauri, navigator.languages + the Apple rule in the browser. */
  function systemCode() { return externalSystem || systemLanguage(browserLanguages()); }
  /** Sets the external (Rust) system language; an unsupported or empty value is ignored (the browser list stays). */
  function setSystemCode(code) { externalSystem = isSupported(code) ? code : null; return systemCode(); }

  function browserLanguages() {
    var n = root.navigator;
    if (!n) return [];
    if (n.languages && n.languages.length) return Array.prototype.slice.call(n.languages);
    return n.language ? [n.language] : [];
  }

  /** The manual choice (localStorage) or null (= system language). */
  function readChoice() {
    try { var s = root.localStorage && root.localStorage.getItem(CHOICE_KEY); return isSupported(s) ? s : null; } catch (e) { return null; }
  }
  /** Stores the manual choice; a null/'system' choice removes it. */
  function writeChoice(code) {
    try {
      if (isSupported(code)) root.localStorage.setItem(CHOICE_KEY, code);
      else root.localStorage.removeItem(CHOICE_KEY);
    } catch (e) { /* no storage: this session only */ }
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

  /** Fills the parameters in a single pass ({x} inside a value is not filled again; same as Rust i18n::fill). */
  function fill(text, p) {
    if (!p) return text;
    return text.replace(/\{([a-zA-Z0-9_]+)\}/g, function (tam, name) {
      return Object.prototype.hasOwnProperty.call(p, name) && p[name] !== undefined && p[name] !== null ? String(p[name]) : tam;
    });
  }

  /** Text (in the given language). Falls back to en when missing, and to the key when en has none either. */
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

  /** Number format (decimal separator by language). */
  function number(n, maxStep) {
    var y = (dictionary[current] && dictionary[current]._locale) || current;
    var x = Number(n);
    try { return x.toLocaleString(y, { maximumFractionDigits: maxStep === undefined ? 3 : maxStep }); } catch (e) { return String(x); }
  }

  /**
   * The format written into a number field: the language's decimal separator (en ".", tr ","), NO thousands separator
   * (so that the field can be read back), at most 6 decimals. '' when it is not a number.
   */
  function numberField(n) {
    var x = typeof n === 'string' && n.trim() !== '' ? Number(n) : n;
    if (typeof x !== 'number' || !isFinite(x)) return '';
    var y = (dictionary[current] && dictionary[current]._locale) || current;
    try { return x.toLocaleString(y, { useGrouping: false, maximumFractionDigits: 6 }); } catch (e) { return String(x); }
  }

  /**
   * Writes the texts into the elements carrying data-i18n / data-i18n-attr (root: document or an element). When a key is
   * in no dictionary, the element's existing (static English) text is kept; when there is no text, the key is written
   * (the gap shows, missingKeys()).
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
    var attrs = k.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < attrs.length; j++) {
      String(attrs[j].getAttribute('data-i18n-attr')).split(';').forEach(function (pair) {
        var b = pair.indexOf(':');
        if (b <= 0) return;
        var name = pair.slice(0, b).trim(), an = pair.slice(b + 1).trim(), d = t(an);
        if (d !== an || !attrs[j].getAttribute(name)) attrs[j].setAttribute(name, d);
      });
    }
    if (root.document && k === root.document) root.document.title = t('app.name');
  }

  /** Initial language: the manual choice, otherwise the system (browser) language. */
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

  // labels right away (end of the script body: the elements are parsed) and on DOMContentLoaded;
  // platform.ready is not awaited. When the Tauri language sync later changes the language, they are applied again there.
  if (!isNode && root.document) {
    try { apply(root.document); } catch (e) { /* the interface keeps its static English */ }
    if (root.document.readyState === 'loading' && typeof root.document.addEventListener === 'function') {
      root.document.addEventListener('DOMContentLoaded', function () { try { apply(root.document); } catch (e) { /* static */ } });
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
