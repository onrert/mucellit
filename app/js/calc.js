/*
 * calc.js — binding calculations, a pure module without DOM (Mucellit.calc / module.exports).
 * All sizes in mm. All defaults are in DEFAULTS and can be changed.
 *
 * Terms:
 *  - leaf: a single leaf of the book (2 pages: front + back).
 *  - printer sheet: the physical sheet that goes through the printer.
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    root.Mucellit = root.Mucellit || {};
    root.Mucellit.calc = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var root = typeof self !== 'undefined' ? self : globalThis; // Mucellit.i18n is found in a vm context too
  function I18n() { return (root && root.Mucellit && root.Mucellit.i18n) || require('./i18n.js'); }
  function t(a, p) { return I18n().t(a, p); }
  /** Field name (for error texts): "calc.name.<key>" in the dictionary. */
  function name(key) { return t('calc.name.' + key.replace(/[A-Z]/g, function (c) { return '_' + c.toLowerCase(); })); }

  var DEFAULTS = {
    bindingType: 'sewn',   // 'sewn' | 'single1' | 'single2'
    sheetsPerSignature: 4,
    shrinkLastSignature: false,
    paperThickness: 0.1,    // mm, one leaf
    endpaperAllowance: 0,          // mm, allowance added to the spine for endpapers/front-back sheets
    bookWidth: 148,
    bookHeight: 210,
    boardThickness: 2,    // t, mm
    spineShape: 'flat',       // 'flat' | 'rounded'
    spineRule: 'twoT',    // 'twoT': spine strip S + 2t | 'onlyS': S (the joint gap grows by t)
    curveLength: undefined,   // spine curve length measured on a rounded spine (mm); S + 2t when empty
    square: 3,              // k, mm: how far the board overhangs the book block (head, tail, fore edge)
    jointGap: 'auto',    // f: 'auto' (by board thickness) or manual mm
    turnIn: 15,           // e, mm: how much of the covering is turned in at each edge
    spareSheets: 0          // extra printer sheets for a test print / spoilage
  };

  function roundOff(x) { return Math.round(x * 1000) / 1000; }

  function checkNumber(v, field, min) {
    var n = Number(v);
    if (!isFinite(n) || n < (min === undefined ? 0 : min)) {
      throw new RangeError(t('calc.invalid', { name: name(field), value: v }));
    }
    return n;
  }

  /** Joint gap (groove) width by board thickness: t ≤ 1 → 6, ≤ 2 → 7, ≤ 3 → 8, > 3 → 9 (no source). */
  function autoJointGap(tm) {
    return tm <= 1 ? 6 : tm <= 2 ? 7 : tm <= 3 ? 8 : 9;
  }

  /** Number of leaves from the page count (an odd page count is rounded up). */
  function leafCount(page) {
    return Math.ceil(checkNumber(page, 'page_count', 0) / 2);
  }

  /** Spine thickness = leaves × paper thickness (+ endpaper allowance). */
  function spineThicknessOf(sheet, thickness, endpaperAllowance) {
    return roundOff(checkNumber(sheet, 'sheet', 0) * checkNumber(thickness, 'paper_thickness', 0) +
      checkNumber(endpaperAllowance || 0, 'endpaper_allowance', 0));
  }

  /** Total pages padded with blank pages for the binding type, and the signature info. */
  function padded(bindingType, page, sheetsPerSignature, shrinkLastSignature) {
    var p = Math.ceil(checkNumber(page, 'page_count', 1));
    if (bindingType === 'sewn') {
      var fs = 4 * sheetsPerSignature;
      var full = Math.floor(p / fs);
      var rest = p - full * fs;
      var signatureCount = full + (rest > 0 ? 1 : 0);
      var last = rest > 0 ? (shrinkLastSignature ? Math.ceil(rest / 4) : sheetsPerSignature) : 0;
      var total = full * fs + last * 4;
      return { totalPages: total, signatureCount: signatureCount, printSheets: total / 4 };
    }
    if (bindingType === 'single1') {
      var t1 = 2 * Math.ceil(p / 2);
      return { totalPages: t1, signatureCount: 0, printSheets: t1 / 2 };
    }
    if (bindingType === 'single2') {
      var t2 = 4 * Math.ceil(p / 4);
      return { totalPages: t2, signatureCount: 0, printSheets: t2 / 4 };
    }
    throw new Error(t('error.binding_type', { kind: bindingType }));
  }

  /**
   * The whole calculation. input: { pageCount, ...the DEFAULTS fields }
   * The spine thickness is computed with the padded number of leaves (blank pages included),
   * because blank pages are paper too.
   */
  function calculate(input) {
    var g = {};
    Object.keys(DEFAULTS).forEach(function (k) { g[k] = DEFAULTS[k]; });
    Object.keys(input || {}).forEach(function (k) {
      if (input[k] !== undefined && input[k] !== null && input[k] !== '') g[k] = input[k];
    });
    var sheetsPerSignature = checkNumber(g.sheetsPerSignature, 'sheets_per_signature', 1);
    if (!Number.isInteger(sheetsPerSignature) || sheetsPerSignature > 8) throw new RangeError(t('calc.sheets_per_signature', { value: g.sheetsPerSignature }));
    var full = padded(g.bindingType, g.pageCount, sheetsPerSignature, !!g.shrinkLastSignature);
    var leaves = leafCount(full.totalPages);
    var spine = spineThicknessOf(leaves, g.paperThickness, g.endpaperAllowance);
    var bookWidth = checkNumber(g.bookWidth, 'book_width', 1);
    var bookHeight = checkNumber(g.bookHeight, 'book_height', 1);
    var tm = checkNumber(g.boardThickness, 'board_thickness', 0); // t (board); t() is the text function
    var k = checkNumber(g.square, 'square', 0);
    var e = checkNumber(g.turnIn, 'turn_in', 0);
    [['board_thickness', tm], ['turn_in', e]].forEach(function (c) {
      if (!(c[1] > 0)) throw new RangeError(t('calc.positive', { name: name(c[0]), value: c[1] }));
    });
    // the square can be 0 (board flush with the block); it cannot be negative
    if (!(k >= 0)) throw new RangeError(t('calc.square_negative', { value: k }));
    if (g.spineShape !== 'flat' && g.spineShape !== 'rounded') throw new Error(t('calc.spine_shape', { value: g.spineShape }));
    if (g.spineRule !== 'twoT' && g.spineRule !== 'onlyS') throw new Error(t('calc.spine_rule', { value: g.spineRule }));

    var jointAuto = g.jointGap === 'auto';
    var jointGapUnsourced = false, f;
    if (jointAuto) {
      f = autoJointGap(tm);
      jointGapUnsourced = tm > 3;
    } else {
      f = checkNumber(g.jointGap, 'jointGap', 0);
      if (!(f > 0)) throw new RangeError(t('calc.positive', { name: name('jointGap'), value: g.jointGap }));
    }

    var W = bookWidth, H = bookHeight;
    var Db = roundOff(W - f + k);
    var Dh = roundOff(H + 2 * k);

    var curveLengthWarning = false, R, fCovering = f;
    if (g.spineShape === 'rounded') {
      var curve;
      if (g.curveLength === undefined || g.curveLength === null || g.curveLength === '') {
        curve = spine + 2 * tm;
        curveLengthWarning = true;
      } else {
        curve = checkNumber(g.curveLength, 'spine_curve_length', 0);
        if (!(curve > 0)) throw new RangeError(t('calc.positive', { name: name('spine_curve_length'), value: g.curveLength }));
      }
      R = roundOff(curve + 3);
    } else if (g.spineRule === 'onlyS') {
      R = roundOff(spine);
      fCovering = f + tm;
    } else {
      R = roundOff(spine + 2 * tm);
    }
    var mullHeight = roundOff(H - 12);
    [
      ['calc.name.board_width', Db, t('calc.reason.joint_gap_too_large', { f: f, w: W })],
      ['calc.name.board_height', Dh, t('calc.reason.height')],
      ['calc.name.spine_strip', R, t('calc.reason.spine')],
      ['calc.name.mull_height', mullHeight, t('calc.reason.mull', { h: H })]
    ].forEach(function (c) {
      if (!(c[1] > 0)) throw new RangeError(t('calc.zero_or_negative', { name: t(c[0]), value: c[1], reason: c[2] }));
    });
    var coveringWidth = roundOff(2 * Db + R + 2 * fCovering + 2 * (e + tm));
    var coveringHeight = roundOff(Dh + 2 * (e + tm));

    return {
      input: g,
      pageCount: Number(g.pageCount),
      totalPages: full.totalPages,
      blankPages: full.totalPages - Math.ceil(Number(g.pageCount)),
      leaves: leaves,
      signatureCount: full.signatureCount,
      spineThickness: spine,
      board: { width: Db, height: Dh, count: 2 },
      spineStrip: { width: R, height: Dh, count: 1 },
      jointGap: f,
      coveringJointGap: roundOff(fCovering),
      jointGapUnsourced: jointGapUnsourced,
      curveLengthWarning: curveLengthWarning,
      covering: { width: coveringWidth, height: coveringHeight },
      endpapers: { width: roundOff(2 * W), height: H, count: 2 },
      mull: { width: roundOff(spine + 50), height: mullHeight },
      headbands: { length: spine, count: 2 },
      printSheets: full.printSheets + Math.max(0, Math.round(Number(g.spareSheets) || 0))
    };
  }

  return {
    DEFAULTS: DEFAULTS,
    leafCount: leafCount,
    spineThicknessOf: spineThicknessOf,
    autoJointGap: autoJointGap,
    padded: padded,
    calculate: calculate
  };
});
