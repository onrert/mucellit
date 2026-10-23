/*
 * imposition.js — page imposition, a pure module without DOM.
 * Loaded as a classic <script> in the browser (Mucellit.imposition),
 * used through require() (module.exports) in Node.
 *
 * Page numbers start at 1. The total page count is padded with blank pages to
 * the multiple the binding type needs; a page whose number is greater than
 * pageCount is blank (isBlank).
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    root.Mucellit = root.Mucellit || {};
    root.Mucellit.imposition = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var root = typeof self !== 'undefined' ? self : globalThis; // Mucellit.i18n is found in a vm context too
  function I18n() { return (root && root.Mucellit && root.Mucellit.i18n) || require('./i18n.js'); }
  function t(a, p) { return I18n().t(a, p); }

  function integer(value, field, min, max) {
    var n = Number(value);
    if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
      throw new RangeError(t(max !== undefined ? 'imposition.integer' : 'imposition.integer_min',
        { name: t('imposition.name.' + field), min: min, max: max, value: value }));
    }
    return n;
  }

  function roundOff(x) {
    return Math.round(x * 1e6) / 1e6;
  }

  /** Creep for sheet i (from 0) inside a signature: i × thickness (mm). */
  function creep(i, thickness) {
    var k = Number(thickness) || 0;
    if (k < 0) throw new RangeError(t('imposition.thickness_negative'));
    return roundOff(i * k);
  }

  function isBlankFactory(pageCount) {
    return function (n) { return n > pageCount; };
  }

  /**
   * Sewn signatures imposition.
   * settings: { pageCount, sheetsPerSignature=4 (1–8), shrinkLastSignature=false,
   *             creepEnabled=false, paperThickness=0 }
   * Inside a signature of n pages, sheet i (from 0):
   *   front [left, right] = [n−2i, 1+2i]
   *   back  [left, right] = [2+2i, n−1−2i]
   */
  function sewn(settings) {
    settings = settings || {};
    var pageCount = integer(settings.pageCount, 'page_count', 1);
    var k = integer(settings.sheetsPerSignature === undefined ? 4 : settings.sheetsPerSignature, 'sheets_per_signature', 1, 8);
    var pagesPerSignature = 4 * k;
    var fullSignatures = Math.floor(pageCount / pagesPerSignature);
    var rest = pageCount - fullSignatures * pagesPerSignature;
    var signatureSheetCounts = [];
    for (var f = 0; f < fullSignatures; f++) signatureSheetCounts.push(k);
    if (rest > 0) signatureSheetCounts.push(settings.shrinkLastSignature ? Math.ceil(rest / 4) : k);

    var creepEnabled = !!settings.creepEnabled;
    var thickness = Number(settings.paperThickness) || 0;
    var signatures = [];
    var sheets = [];
    var offset = 0;
    signatureSheetCounts.forEach(function (leafCount, fi) {
      var n = 4 * leafCount;
      signatures.push({ no: fi, leafCount: leafCount, pageCount: n, firstPage: offset + 1, lastPage: offset + n });
      for (var i = 0; i < leafCount; i++) {
        sheets.push({
          no: sheets.length,
          signature: fi,
          indexInSignature: i,
          front: [offset + n - 2 * i, offset + 1 + 2 * i],
          back: [offset + 2 + 2 * i, offset + n - 1 - 2 * i],
          creep: creepEnabled ? creep(i, thickness) : 0
        });
      }
      offset += n;
    });
    return {
      kind: 'sewn',
      pageCount: pageCount,
      totalPages: offset,
      slotsPerSide: 2,
      signatures: signatures,
      sheets: sheets,
      isBlank: isBlankFactory(pageCount)
    };
  }

  /** Single leaves, 1-up: every printer sheet has front = 2i+1, back = 2i+2. */
  function single1(settings) {
    settings = settings || {};
    var pageCount = integer(settings.pageCount, 'page_count', 1);
    var leafCount = Math.ceil(pageCount / 2);
    var sheets = [];
    for (var i = 0; i < leafCount; i++) {
      sheets.push({ no: i, signature: 0, indexInSignature: i, front: [2 * i + 1], back: [2 * i + 2], creep: 0 });
    }
    return {
      kind: 'single1', pageCount: pageCount, totalPages: 2 * leafCount, slotsPerSide: 1,
      signatures: [], sheets: sheets, isBlank: isBlankFactory(pageCount)
    };
  }

  /**
   * Single leaves, 2-up cut and stack. N sheets, 4N pages in total.
   * sheet i: front [2i+1, 2N+2i+1], back [2N+2i+2, 2i+2].
   * After cutting down the middle and putting the right stack under the left one, the order is 1..4N.
   */
  function single2(settings) {
    settings = settings || {};
    var pageCount = integer(settings.pageCount, 'page_count', 1);
    var N = Math.ceil(pageCount / 4);
    var sheets = [];
    for (var i = 0; i < N; i++) {
      sheets.push({
        no: i, signature: 0, indexInSignature: i,
        front: [2 * i + 1, 2 * N + 2 * i + 1],
        back: [2 * N + 2 * i + 2, 2 * i + 2],
        creep: 0
      });
    }
    return {
      kind: 'single2', pageCount: pageCount, totalPages: 4 * N, slotsPerSide: 2,
      signatures: [], sheets: sheets, isBlank: isBlankFactory(pageCount)
    };
  }

  /** bindingType: 'sewn' | 'single1' | 'single2' */
  function impose(bindingType, settings) {
    if (bindingType === 'sewn') return sewn(settings);
    if (bindingType === 'single1') return single1(settings);
    if (bindingType === 'single2') return single2(settings);
    throw new Error(t('error.binding_type', { kind: bindingType }));
  }

  /** Verifies that an imposition uses every page exactly once (self-check). */
  function verify(result) {
    var seen = {};
    result.sheets.forEach(function (y) {
      y.front.concat(y.back).forEach(function (s) {
        if (seen[s]) throw new Error(t('imposition.twice', { s: s }));
        seen[s] = true;
      });
    });
    for (var s = 1; s <= result.totalPages; s++) {
      if (!seen[s]) throw new Error(t('imposition.notPlaced', { s: s }));
    }
    return true;
  }

  return { sewn: sewn, single1: single1, single2: single2, impose: impose, creep: creep, verify: verify };
});
