/*
 * epub.js — EPUB → PDF input converter. Registers with the core through the plug-in point (plugins.js).
 *
 * Flow: EPUB (ZIP) → zip.js → epub-package.js (OPF, spine, DRM/FXL) → xhtml-blocks.js (block list)
 *   → typeset.js (pages) → pdf-writer.js (pdf-lib + fontkit + Literata) → PDF bytes → core.
 * fontkit and Literata (≈2.4 MB of JS) are loaded lazily with <script> on the first EPUB conversion (fetch is not
 * allowed under file://).
 *
 * Page size = the core's content box: (bookWidth − gutter − outerMargin) × (bookHeight − 2·outerMargin) mm.
 * The core places this page in the content box without scaling (1:1) and leaves the gutter on the spine side.
 * The plug-in's own typographic margins are symmetric (top, bottom, side).
 *
 * Writes nothing to the console; errors are thrown with messages in the interface language (Mucellit.i18n), the core
 * reports them.
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  function t(a, p) { return MC.i18n.t(a, p); }
  var SETTINGS_KEY = 'mucellit.epubSettings';
  var MM = 72 / 25.4;
  var DEFAULTS = { fontSize: 10.5, lineSpacing: 1.35, top: 15, bottom: 18, side: 15, hyphenate: true, pageNumbers: true, skipCover: true };
  var FONTKIT_JS = 'vendor/fontkit/fontkit.umd.min.js';
  var STYLE_FILE = { R: 'regular', I: 'italic', B: 'bold', BI: 'bolditalic' };
  function E6() { return t('epub.E6'); }

  // ---------- lazy loading ----------
  var loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise(function (ok, red) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = function () { ok(); };
        s.onerror = function () { delete loaded[src]; s.remove(); red(new Error(E6())); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  var source = null;
  function base64Bytes(b64) {
    var s = atob(b64);
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  async function loadSources() {
    if (source) return source;
    var e6 = new Error(E6());
    try {
      await loadScript(FONTKIT_JS);
      await Promise.all(Object.keys(STYLE_FILE).map(function (k) { return loadScript('vendor/literata/literata-' + STYLE_FILE[k] + '.js'); }));
    } catch (e) { throw e6; }
    var yt = MC.fonts || {};
    if (!root.fontkit || Object.keys(STYLE_FILE).some(function (k) { return typeof yt[STYLE_FILE[k]] !== 'string'; })) throw e6;
    var ttf = {}, fk = {};
    try {
      Object.keys(STYLE_FILE).forEach(function (k) {
        ttf[k] = base64Bytes(yt[STYLE_FILE[k]]);
        fk[k] = root.fontkit.create(ttf[k]);
      });
    } catch (e) { throw e6; }
    source = { ttf: ttf, fk: fk };
    return source;
  }

  // ---------- settings ----------
  function loadSettings() {
    var a = Object.assign({}, DEFAULTS);
    try { Object.assign(a, JSON.parse(MC.common.readLocal(SETTINGS_KEY) || '{}')); } catch (e) { /* corrupt record: defaults */ }
    return a;
  }

  // Labels are dictionary keys (epub.field.* / epub.mark.*), translated when the interface is set up.
  var FIELDS = [
    ['fontSize', 'epub-fontSize', 'epub.field.fontSize', 6, 24, 0.5],
    ['lineSpacing', 'epub-line', 'epub.field.line', 1, 3, 0.05],
    ['top', 'epub-top', 'epub.field.top', 0, 60, 0.5],
    ['bottom', 'epub-bottom', 'epub.field.bottom', 0, 60, 0.5],
    ['side', 'epub-side', 'epub.field.side', 0, 60, 0.5]
  ];
  var MARKS = [
    ['hyphenate', 'epub-hyphen', 'epub.mark.hyphen', 'epub.mark.hyphen_note'],
    ['pageNumbers', 'epub-page-no', 'epub.mark.page_no', null],
    ['skipCover', 'epub-cover-skip', 'epub.mark.skip_cover', null]
  ];

  function settingsUi(container) {
    var O = MC.common, el = O.el;
    var a = loadSettings();
    var children = [el('summary', { text: t('epub.settings') })];
    FIELDS.forEach(function (f) {
      children.push(el('label', { class: 'field' }, [el('span', { text: t(f[2]) }),
        // number field type=text + data-number (the language's decimal separator; common.setupNumberFields)
        el('input', { type: 'text', inputmode: 'decimal', 'data-number': '', id: f[1], min: String(f[3]), max: String(f[4]), step: String(f[5]), value: MC.i18n.numberField(a[f[0]]) })]));
    });
    MARKS.forEach(function (f) {
      children.push(el('label', { class: 'choice' }, [el('input', { type: 'checkbox', id: f[1], checked: !!a[f[0]] }), ' ' + t(f[2])]));
      if (f[3]) children.push(el('p', { class: 'small', id: f[1] + '-note', text: t(f[3]) }));
    });
    children.push(el('p', { class: 'small', text: t('epub.size_note') }));
    children.push(el('div', { id: 'epub-warning' }));
    var d = el('details', { id: 'epub-settings' }, children);
    d.addEventListener('change', function () { try { readSettings(); } catch (e) { /* save only when valid */ } });
    container.appendChild(d);
  }

  /** Reads from the interface, validates, stores. Throws a clear error when invalid. */
  function readSettings() {
    var O = MC.common, $ = O.$;
    var a = loadSettings();
    if ($('epub-settings')) {
      FIELDS.forEach(function (f) {
        var v = O.number(f[1], NaN);
        if (!(v >= f[3] && v <= f[4])) throw new Error(t('epub.settings_range', { name: t(f[2]), min: f[3], max: f[4] }));
        a[f[0]] = v;
      });
      MARKS.forEach(function (f) { a[f[0]] = !!$(f[1]).checked; });
      O.writeLocal(SETTINGS_KEY, JSON.stringify(a));
    }
    return a;
  }

  /** Warning U1 in the #epub-warning box; when the box is inside the closed "EPUB settings" section, the section opens (so that the warning is visible). */
  function showWarning(text) {
    var u = MC.common.$('epub-warning');
    if (!u) return;
    u.textContent = '';
    if (text) {
      u.appendChild(MC.common.el('div', { class: 'warning', text: text }));
      var d = MC.common.$('epub-settings');
      if (d) d.open = true;
    }
  }

  function breath() { return new Promise(function (ok) { setTimeout(ok, 0); }); }

  /** The first spine document counts as a cover only when it is the cover image in the manifest. */
  function isCover(blocks, coverPath) {
    var content = blocks.filter(function (b) { return b.kind !== 'pageEnd'; });
    return !!coverPath && content.length === 1 && content[0].kind === 'image' && content[0].image.key === coverPath;
  }

  // ---------- converter ----------
  async function convert(file, options) {
    var progress = (options && options.progress) || function () {};
    // the core returns false when another file was chosen after this conversion: no stale warning is written
    var isCurrent = (options && typeof options.isCurrent === 'function') ? options.isCurrent : function () { return true; };
    showWarning('');
    var a = readSettings();
    if (!root.PDFLib) throw new Error(t('error.pdflib'));
    var bookWidth = options.bookWidth, bookHeight = options.bookHeight;
    var gutter = options.gutter || 0, outerMargin = options.outerMargin || 0;
    var pageWidthMm = bookWidth - gutter - outerMargin;
    var pageHeightMm = bookHeight - 2 * outerMargin;
    if (!(pageWidthMm > 60) || !(pageHeightMm > 60)) {
      throw new Error(t('epub.page_small', { width: Math.round(pageWidthMm), height: Math.round(pageHeightMm) }));
    }
    if (pageWidthMm - 2 * a.side < 20 || pageHeightMm - a.top - a.bottom < 20) throw new Error(t('epub.margin_too_large'));

    progress(t('epub.progress.font'));
    var k = await loadSources();
    var bytes = new Uint8Array(await file.arrayBuffer());
    var zip = MC.epubZip.read(bytes);
    var pkg = await MC.epubPackage.readPackage(zip);
    var env = { zip: zip, lang: pkg.lang, cssCache: new Map(), images: {}, counter: { skippedImage: 0, table: 0 } };
    var blocks = [];
    var n = pkg.spine.length;
    for (var i = 0; i < n; i++) {
      progress(t('epub.progress.chapter', { i: i + 1, n: n }));
      var path = pkg.spine[i].path;
      var r = await MC.xhtmlBlock.documentToBlocks(await zip.text(path), path, env);
      if (i === 0 && a.skipCover && isCover(r.blocks, pkg.coverPath)) continue;
      if (!r.blocks.length) continue;
      blocks.push({ kind: 'chapterStart' });
      for (var j = 0; j < r.blocks.length; j++) blocks.push(r.blocks[j]);
      await breath();
    }
    if (!blocks.length) { var e5 = new Error(MC.epubPackage.MESSAGE.E5); e5.code = 'E5'; throw e5; }
    var missingChar = MC.writePdf.fixScope(blocks, function (cp) { return k.fk.R.hasGlyphForCodePoint(cp); });

    progress(t('epub.progress.typeset'));
    var widthPt = pageWidthMm * MM, heightPt = pageHeightMm * MM;
    var dz = await MC.epubTypeset.typesetAsync(blocks, {
      pageWidth: widthPt, pageHeight: heightPt,
      margin: { top: a.top * MM, bottom: a.bottom * MM, inner: a.side * MM, outer: a.side * MM },
      fontSize: a.fontSize, lineSpacing: a.lineSpacing, hyphenate: a.hyphenate, pageNumbers: a.pageNumbers
    }, MC.epubTypeset.fontkitMeasurer(k.fk));
    if (!dz.pages.length) { var e = new Error(MC.epubPackage.MESSAGE.E5); e.code = 'E5'; throw e; }

    progress(t('epub.progress.write_pdf', { n: dz.pages.length }));
    var ekWarning = [];
    var pdf = await MC.writePdf.writePdf(dz.pages, { widthPt: widthPt, heightPt: heightPt, title: pkg.title, author: pkg.author, lang: pkg.lang },
      { PDFLib: root.PDFLib, fontkit: root.fontkit, fonts: k.ttf, images: env.images, warnings: ekWarning, counter: env.counter });

    var s = env.counter;
    var text = [];
    if (s.skippedImage || s.table || dz.warnings.lowDpi) {
      text.push(t('epub.warning.image_table', { image: s.skippedImage, table: s.table, dpi: dz.warnings.lowDpi }));
    }
    if (missingChar) text.push(t('epub.warning.missing_char', { n: missingChar }));
    var unsupported = zip.unsupportedEncodings ? zip.unsupportedEncodings() : [];
    if (unsupported.length) text.push(t('epub.warning.encoding', { encodings: unsupported.join(', ') }));
    text = text.concat(ekWarning);
    if (isCurrent()) showWarning(text.join(' '));
    return pdf;
  }

  // '.epub.zip': Apple Books' folder package EPUB arrives in Safari/WebKit's file input as a ZIP of the folder;
  // zip.js drops the single top folder prefix (singleFolderPrefix), the content is handled like a normal EPUB.
  MC.plugins.register({ name: 'EPUB → PDF', extensions: ['.epub', '.epub.zip'], mime: ['application/epub+zip'], settingsUi: settingsUi, convert: convert,
    reset: function () { showWarning(''); } });
  MC.epub = { convert: convert, readSettings: readSettings, DEFAULTS: DEFAULTS };
})(typeof self !== 'undefined' ? self : this);
