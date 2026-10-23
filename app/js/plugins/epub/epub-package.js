/*
 * epub-package.js — EPUB package info: container.xml → OPF; title, author, language, manifest, spine, cover;
 * DRM and fixed-layout checks (Mucellit.epubPackage). Needs DOMParser (browser).
 *
 *   await readPackage(zip) → { version, title, author, lang, opfPath, spine: [{ path, linear, property }], manifest, coverPath, warnings }
 *
 * Errors (.code): E2 no container, E3 DRM, E4 fixed-layout, E5 no readable chapter; E1 when the OPF is not found.
 * DRM rule: DRM when META-INF/encryption.xml has an EncryptedData other than font obfuscation
 * (IDPF obfuscation: EPUB 3.3 §4.4.5; Adobe obfuscation "ns.adobe.com/pdf/enc#RC"). rights.xml alone is not DRM.
 * Algorithm identifiers are compared without the scheme (domain + path).
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  function t(a, p) { return MC.i18n.t(a, p); }

  // User texts in the language current when they are read (epub.E1 … in the dictionary).
  var MESSAGE = {};
  ['E1', 'E2', 'E3', 'E4', 'E5'].forEach(function (k) {
    Object.defineProperty(MESSAGE, k, { get: function () { return t('epub.' + k); }, enumerable: true });
  });
  // font obfuscation algorithms (not DRM)
  var HIDING = [/(^|\/\/)www\.idpf\.org\/2008\/embedding$/, /(^|\/\/)ns\.adobe\.com\/pdf\/enc#RC$/];

  /** detail: [key, parameters] (epub.detail.<key> in the dictionary). */
  function error(code, detail) {
    var e = new Error(MESSAGE[code]);
    e.code = code;
    if (detail) e.detail = t('epub.detail.' + detail[0], detail[1]);
    return e;
  }

  function xml(text) {
    var d = new DOMParser().parseFromString(text, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) return null;
    return d;
  }
  function all(d, name) { return Array.prototype.slice.call(d.getElementsByTagNameNS('*', name)); }
  function firstText(d, name) {
    var e = all(d, name)[0];
    return e ? String(e.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  async function checkDrm(zip) {
    if (!zip.has('META-INF/encryption.xml')) return;
    var d = xml(await zip.text('META-INF/encryption.xml'));
    if (!d) throw error('E3', ['encryption_unreadable']);
    all(d, 'EncryptedData').forEach(function (ed) {
      var method = all(ed, 'EncryptionMethod')[0];
      var alg = method ? String(method.getAttribute('Algorithm') || '').trim() : '';
      var hiding = HIDING.some(function (r) { return r.test(alg); });
      if (!hiding) throw error('E3', ['encryption', { alg: alg || t('epub.detail.no_algorithm') }]);
    });
  }

  async function checkFxl(zip, opf) {
    var layout = all(opf, 'meta').filter(function (m) {
      return m.getAttribute('property') === 'rendition:layout';
    }).map(function (m) { return String(m.textContent || '').trim(); });
    if (layout.indexOf('pre-paginated') >= 0) throw error('E4');
    // old Kindle marker: <meta name="fixed-layout" content="true">
    var kindle = all(opf, 'meta').some(function (m) {
      return m.getAttribute('name') === 'fixed-layout' && String(m.getAttribute('content')).trim() === 'true';
    });
    if (kindle) throw error('E4');
    // old Apple marker: fixed-layout = true in META-INF/com.apple.ibooks.display-options.xml
    var elma = 'META-INF/com.apple.ibooks.display-options.xml';
    if (zip.has(elma)) {
      var d = xml(await zip.text(elma));
      if (d && all(d, 'option').some(function (o) { return o.getAttribute('name') === 'fixed-layout' && String(o.textContent).trim() === 'true'; })) throw error('E4');
    }
  }

  async function readPackage(zip) {
    var Z = MC.epubZip;
    var warnings = [];
    if (!zip.has('mimetype')) warnings.push(t('epub.warning.no_mimetype'));
    else if ((await zip.text('mimetype')).trim() !== 'application/epub+zip') warnings.push(t('epub.warning.mimetype_wrong'));
    if (!zip.has('META-INF/container.xml')) throw error('E2');
    await checkDrm(zip);
    var container = xml(await zip.text('META-INF/container.xml'));
    if (!container) throw error('E2', ['container_parse_failed']);
    var roots = all(container, 'rootfile');
    var rootFile = roots.filter(function (r) { return (r.getAttribute('media-type') || '') === 'application/oebps-package+xml'; })[0] || roots[0];
    var opfPath = rootFile ? Z.normal(rootFile.getAttribute('full-path') || '') : '';
    if (!opfPath || !zip.has(opfPath)) throw error('E1', ['no_opf', { path: String(opfPath) }]);
    var opf = xml(await zip.text(opfPath));
    if (!opf) throw error('E1', ['opf_parse_failed']);
    var pkg = all(opf, 'package')[0];
    var version = pkg ? String(pkg.getAttribute('version') || '') : '';
    await checkFxl(zip, opf);

    var manifest = {};
    var coverPath = null;
    all(opf, 'item').forEach(function (it) {
      var id = it.getAttribute('id');
      var path = Z.parsePath(opfPath, it.getAttribute('href') || '');
      var property = String(it.getAttribute('properties') || '').split(/\s+/);
      manifest[id] = { path: path, kind: String(it.getAttribute('media-type') || ''), property: property };
      if (property.indexOf('cover-image') >= 0) coverPath = path;
    });
    if (!coverPath) {
      // EPUB 2: <meta name="cover" content="manifest-id">
      var km = all(opf, 'meta').filter(function (m) { return m.getAttribute('name') === 'cover'; })[0];
      var kid = km && km.getAttribute('content');
      if (kid && manifest[kid]) coverPath = manifest[kid].path;
    }

    var main = [], ek = [], skipped = 0, itemFxl = 0;
    all(opf, 'itemref').forEach(function (ir) {
      var m = manifest[ir.getAttribute('idref')];
      if (!m) { skipped += 1; return; }
      var html = /xhtml|html/.test(m.kind) || /\.x?html?$/i.test(m.path);
      if (!html || !zip.has(m.path)) { skipped += 1; return; }
      var oz = String(ir.getAttribute('properties') || '');
      if (/rendition:layout-pre-paginated/.test(oz)) itemFxl += 1;
      var linear = String(ir.getAttribute('linear') || 'yes').trim() !== 'no';
      (linear ? main : ek).push({ path: m.path, linear: linear, property: oz });
    });
    if (skipped) warnings.push(t('epub.warning.spine_skipped', { n: skipped }));
    if (itemFxl) warnings.push(t('epub.warning.fxl_reflowable', { n: itemFxl }));
    // linear="no" items (e.g. endnotes) are added after the main flow
    var spine = main.concat(ek);
    if (!spine.length) throw error('E5');
    return {
      version: version, opfPath: opfPath,
      title: firstText(opf, 'title'), author: firstText(opf, 'creator'), lang: firstText(opf, 'language'),
      spine: spine, manifest: manifest, coverPath: coverPath, warnings: warnings
    };
  }

  MC.epubPackage = { readPackage: readPackage, MESSAGE: MESSAGE };
})(typeof self !== 'undefined' ? self : this);
