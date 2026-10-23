/*
 * migrate.js — one-time migration of data saved by versions before the English code base.
 *
 * Earlier versions stored their data under Turkish names: localStorage keys with the old app prefix, a sessionStorage
 * key, field names inside the project records and enum values (see the legacy-names block below). On load, every
 * legacy key that is found is converted to the current format, written under its new key and then removed, so nothing
 * the user saved is lost. A legacy key is only removed after its new key has been written; when the new key already
 * exists, the legacy key is left alone (the current data wins and nothing is overwritten).
 *
 * The same converters are used for files the user imports (a JSON backup exported by an earlier version) and for the
 * automatic backup the Mac app restores (platform-tauri.js). Unknown fields are kept as they are.
 *
 * Browser: Mucellit.migrate (runs storage() once when loaded). Node: module.exports (tests).
 * The language choice is migrated by i18n.js itself, because i18n.js reads it before this file is loaded.
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    root.Mucellit = root.Mucellit || {};
    root.Mucellit.migrate = m;
    try { m.storage(root.localStorage, root.sessionStorage); } catch (e) { /* storage unavailable: nothing to migrate */ }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Current version of the project data (the legacy format was version 1 with Turkish field names). */
  var VERSION = 2;

  // legacy-names: begin (the names below are the storage format of earlier versions; they must stay as they are)
  var LEGACY_KEYS = {
    projects: 'kitapCilt.v1',
    corrupt: 'kitapCilt.v1.bozuk',
    tab: 'kitapCilt.sekme',
    imposeSettings: 'kitapCilt.duzenleAyar',
    selectedProject: 'kitapCilt.seciliKitap',
    epubSettings: 'kitapCilt.epubAyar'
  };
  var LEGACY_SESSION_KEYS = { learnPosition: 'kitapCilt.ogren.konum' };
  var LEGACY_DATA = { version: 'surum', projects: 'kitaplar' };
  var PROJECT_FIELDS = {
    ad: 'name', ciltTuru: 'bindingType', kitapGen: 'bookWidth', kitapYuk: 'bookHeight', kagit: 'paper',
    kagitKalinlik: 'paperThickness', pdfAdi: 'pdfName', olusturma: 'created', adimlar: 'steps', ayar: 'settings'
  };
  var STEP_FIELDS = { ad: 'name', tamam: 'done', tarih: 'date', not: 'note', istegeBagli: 'optional', sablon: 'template' };
  var BINDING_TYPES = { formali: 'sewn', tek: 'single' };
  var TEMPLATES = {
    hazirlik_pdf: 'prep_pdf', test_baskisi: 'test_print', baski: 'printing', katlama: 'folding', presleme: 'pressing',
    delme: 'punching', dikis: 'sewing', sirt_tutkallama: 'spine_gluing', sirt_yuvarlatma: 'spine_rounding',
    kapital_sirt_bezi: 'headband_spine_lining', mukavva_kesimi: 'board_cutting', kapak_kaplama: 'cover_covering',
    forza_yapistirma: 'endpaper_pasting', preste_kurutma: 'in_press_drying', hazirlik: 'prep', kesim: 'cutting',
    sirt_hazirlama: 'spine_preparing', tutkallama: 'gluing', kapak: 'cover'
  };
  var IMPOSE_FIELDS = {
    ciltTuru: 'bindingType', formaYaprak: 'sheetsPerSignature', sonFormaKucult: 'shrinkLastSignature', kayma: 'creep',
    kagitKalinlik: 'paperThickness', kagitGen: 'paperWidth', kagitYuk: 'paperHeight', kitapGen: 'bookWidth',
    kitapYuk: 'bookHeight', olcek: 'scaling', disKenar: 'outerMargin', ciltPayi: 'gutter', kirim: 'cropMarks',
    katlama: 'folding', sirtIsareti: 'spineMarks', cevirme: 'duplex', ciktiModu: 'outputMode', arkaTers: 'backsReversed'
  };
  var IMPOSE_VALUES = {
    bindingType: { formali: 'sewn', tek1: 'single1', tek2: 'single2' },
    scaling: { sigdir: 'fit', gercek: 'actual', doldur: 'fill' },
    duplex: { kisa: 'short', uzun: 'long' },
    outputMode: { tek: 'single', ikili: 'pair' }
  };
  var EPUB_FIELDS = {
    boy: 'fontSize', satirAraligi: 'lineSpacing', ust: 'top', alt: 'bottom', yan: 'side', tireBol: 'hyphenate',
    sayfaNo: 'pageNumbers', kapakAtla: 'skipCover'
  };
  var TABS = { duzenle: 'impose', surec: 'projects', hesapla: 'calculator', ogren: 'learn' };
  var LEARN_FIELDS = { tamam: 'done' };
  // legacy-names: end

  var NEW_KEYS = {
    projects: 'mucellit.projects', corrupt: 'mucellit.projects.corrupt', tab: 'mucellit.tab',
    imposeSettings: 'mucellit.imposeSettings', selectedProject: 'mucellit.selectedProject', epubSettings: 'mucellit.epubSettings'
  };
  var NEW_SESSION_KEYS = { learnPosition: 'mucellit.learn.position' };
  /** When the new key already exists, the legacy value is also copied once under this prefix + the legacy key. */
  var LEGACY_BACKUP_PREFIX = 'mucellit.legacy-backup.';

  function isObject(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /** Copies o with its keys renamed by map (unknown keys kept; a new name never overwrites an existing key). */
  function renameKeys(o, map) {
    var out = {};
    Object.keys(o).forEach(function (k) {
      var n = has(map, k) ? map[k] : k;
      if (!has(out, n)) out[n] = o[k];
    });
    return out;
  }

  /** Impose-tab settings (also stored inside each project) in the current format. Non-objects are returned as they are. */
  function imposeSettings(s) {
    if (!isObject(s)) return s;
    var out = renameKeys(s, IMPOSE_FIELDS);
    Object.keys(IMPOSE_VALUES).forEach(function (f) {
      if (typeof out[f] === 'string' && has(IMPOSE_VALUES[f], out[f])) out[f] = IMPOSE_VALUES[f][out[f]];
    });
    return out;
  }

  /** Is this project data in the legacy (Turkish field name) format? */
  function isLegacyProjects(d) { return isObject(d) && (has(d, LEGACY_DATA.version) || has(d, LEGACY_DATA.projects)); }

  function step(a) {
    if (!isObject(a)) return a;
    var out = renameKeys(a, STEP_FIELDS);
    if (typeof out.template === 'string' && has(TEMPLATES, out.template)) out.template = TEMPLATES[out.template];
    return out;
  }

  function project(k) {
    if (!isObject(k)) return k;
    var out = renameKeys(k, PROJECT_FIELDS);
    if (typeof out.bindingType === 'string' && has(BINDING_TYPES, out.bindingType)) out.bindingType = BINDING_TYPES[out.bindingType];
    if (Array.isArray(out.steps)) out.steps = out.steps.map(step);
    if (has(out, 'settings')) out.settings = imposeSettings(out.settings);
    return out;
  }

  /**
   * Project data in the current format. Data that is already current is returned unchanged; legacy data is converted
   * (version 1 becomes VERSION; any other legacy version is kept so that validation reports it).
   */
  function projects(d) {
    if (!isLegacyProjects(d)) return d;
    var out = {};
    Object.keys(d).forEach(function (k) {
      if (k === LEGACY_DATA.version) out.version = d[k] === 1 ? VERSION : d[k];
      else if (k === LEGACY_DATA.projects) out.projects = Array.isArray(d[k]) ? d[k].map(project) : d[k];
      else if (!has(out, k)) out[k] = d[k];
    });
    return out;
  }

  /** EPUB plug-in settings in the current format. */
  function epubSettings(s) { return isObject(s) ? renameKeys(s, EPUB_FIELDS) : s; }

  /** Learn guide position ({ a, i, done }) in the current format. */
  function learnPosition(p) { return isObject(p) ? renameKeys(p, LEARN_FIELDS) : p; }

  /** JSON text → converted JSON text; text that is not valid JSON is kept as it is (it is reported where it is read). */
  function viaJson(convert) {
    return function (raw) {
      var v;
      try { v = JSON.parse(raw); } catch (e) { return raw; }
      return JSON.stringify(convert(v));
    };
  }

  var CONVERT = {
    projects: viaJson(projects),
    corrupt: function (raw) { return raw; },
    tab: function (raw) { return has(TABS, raw) ? TABS[raw] : raw; },
    imposeSettings: viaJson(imposeSettings),
    selectedProject: function (raw) { return raw; },
    epubSettings: viaJson(epubSettings),
    learnPosition: viaJson(learnPosition)
  };

  function get(s, k) { try { return s.getItem(k); } catch (e) { return null; } }

  /**
   * Moves one legacy key. Returns 'moved', 'kept' (new key already there) or null (nothing to do / not possible).
   * 'kept': the current data wins and is not overwritten; the legacy key is left as it is and its value is also copied
   * once to LEGACY_BACKUP_PREFIX + legacy key, so nothing is lost even if the legacy key is removed later.
   */
  function moveKey(s, oldKey, newKey, convert) {
    var raw = get(s, oldKey);
    if (raw === null) return null;
    if (get(s, newKey) !== null) {
      var backupKey = LEGACY_BACKUP_PREFIX + oldKey;
      if (get(s, backupKey) === null) {
        try { s.setItem(backupKey, raw); } catch (e) { /* storage full: the legacy key still holds the value */ }
      }
      return 'kept';
    }
    try { s.setItem(newKey, convert(raw)); } catch (e) { return null; } // storage full: try again next time
    if (get(s, newKey) === null) return null;
    try { s.removeItem(oldKey); } catch (e) { /* the data is safe under the new key */ }
    return 'moved';
  }

  /**
   * One-time migration of localStorage (ls) and sessionStorage (ss). Safe to call again: it only acts on legacy keys.
   * Returns { name: 'moved' | 'kept' } for each legacy key that was found.
   */
  function storage(ls, ss) {
    var done = {};
    if (ls) {
      Object.keys(LEGACY_KEYS).forEach(function (n) {
        var r = moveKey(ls, LEGACY_KEYS[n], NEW_KEYS[n], CONVERT[n]);
        if (r) done[n] = r;
      });
    }
    if (ss) {
      Object.keys(LEGACY_SESSION_KEYS).forEach(function (n) {
        var r = moveKey(ss, LEGACY_SESSION_KEYS[n], NEW_SESSION_KEYS[n], CONVERT[n]);
        if (r) done[n] = r;
      });
    }
    return done;
  }

  return {
    VERSION: VERSION,
    LEGACY_KEYS: LEGACY_KEYS,
    LEGACY_SESSION_KEYS: LEGACY_SESSION_KEYS,
    NEW_KEYS: NEW_KEYS,
    NEW_SESSION_KEYS: NEW_SESSION_KEYS,
    LEGACY_BACKUP_PREFIX: LEGACY_BACKUP_PREFIX,
    isLegacyProjects: isLegacyProjects,
    projects: projects,
    imposeSettings: imposeSettings,
    epubSettings: epubSettings,
    learnPosition: learnPosition,
    storage: storage
  };
});
