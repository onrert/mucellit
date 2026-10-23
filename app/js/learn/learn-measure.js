/*
 * learn-measure.js — the "Book's numbers" panel: every measurement of the guide from the book's five numbers.
 * The binding measurements come from Mucellit's own calculation (Mucellit.calc.calculate). (added for the app): the
 * default numbers are the inputs of the Calculator tab and its result (the base; the same source, no copied
 * calculation): the guide uses the Calculator's board thickness, square, turn-in, joint, endpaper allowance and spine
 * strip rule as they are; only the binding type is always sewn signatures and the spine is always drawn flat (the
 * subject of the guide). Manual changes in the panel stay in the guide only.
 * Without a base (the Calculator could not be read) the fallback default: Sample Book (11 signatures × 4 sheets,
 * 148 × 210, 0.1 mm).
 * Extra assumptions of the guide (not in the tool):
 *   holes:  one kettle hole 15 mm in from each end, spacing at most 40 mm, an even number of holes (assumption without
 *           a source; in the MEB-2021 p.26 example the ends are ~25 mm, Cockerell ~6 mm)
 *   thread: about (signatures + 2) × book height, rounded to 10 mm (approximate rule without a source)
 *   corner: t + 2 … t + 3 mm from the board corner (MEGEP-2008 p.36: "2-3 mm more than the board thickness";
 *           MEB-2021 p.75: 5 mm)
 * In the browser Mucellit.learn.size, in Node module.exports (tests).
 * LICENSE NOTE: Mucellit code (MIT, LICENSE at the root); it contains no Colorfigures code. The Colorfigures parts in this
 * folder are MIT licensed (April Zhu, Tolga Cohce), full text: LICENSE.
 */
(function (root, factory) {
  var m = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.Mucellit = root.Mucellit || {}; root.Mucellit.learn = root.Mucellit.learn || {}; root.Mucellit.learn.size = m; }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var DEFAULTS = { signatureCount: 11, sheetsPerSignature: 4, bookWidth: 148, bookHeight: 210, paperThickness: 0.1 };
  // [minimum, maximum, integer only]
  var LIMIT = {
    signatureCount: [1, 40, true], sheetsPerSignature: [1, 8, true],
    bookWidth: [60, 300, false], bookHeight: [80, 420, false], paperThickness: [0.04, 0.4, false]
  };
  var END_ALLOWANCE = 15, MAX_RANGE = 40;

  function roundOff(x) { return Math.round(x * 1000) / 1000; }

  /** "8,8" / "8.8" / 8.8 → 8.8; empty or broken → NaN. No thousands separator is accepted. */
  function readNumber(v) {
    if (typeof v === 'number') return v;
    var s = String(v == null ? '' : v).trim().replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return Number(s);
  }

  /** Names of the invalid fields (empty array = valid). */
  function invalidFields(g) {
    return Object.keys(LIMIT).filter(function (a) {
      var v = readNumber(g[a]), s = LIMIT[a];
      return !isFinite(v) || v < s[0] || v > s[1] || (s[2] && !Number.isInteger(v));
    });
  }

  function stations(H) {
    var inner = H - 2 * END_ALLOWANCE;
    var rangeCount = Math.max(1, Math.ceil(inner / MAX_RANGE));
    if (rangeCount % 2 === 0) rangeCount += 1;   // number of holes = ranges + 1, must be even
    var range = inner / rangeCount, position = [];
    for (var i = 0; i <= rangeCount; i++) position.push(roundOff(END_ALLOWANCE + i * range));
    return { number: position.length, range: roundOff(range), position: position, endAllowance: END_ALLOWANCE };
  }

  function calcModule() {
    if (root && root.Mucellit && root.Mucellit.calc) return root.Mucellit.calc;
    return require('../calc.js');
  }

  var FIELDS = Object.keys(DEFAULTS);

  /**
   * The base from the state of the Calculator tab: { input (the guide's calculation input: sewn, flat spine), result
   * (the calculation result of that input), five (the five fields of the panel), match (are the binding type sewn and
   * the spine flat in the Calculator) }.
   * state: { input, result, error } (Mucellit.calculator.state()). When the Calculator is at sewn + flat spine, its own
   * result is used as it is (not calculated again). Error: { error } when the Calculator has an error, { fields } when
   * outside the guide's limits.
   */
  function fromBase(state, H) {
    if (!state || state.error || !state.input || !state.result) return { error: state && state.error ? state.error : true };
    var calcInput = {}, d = state.input;
    Object.keys(d).forEach(function (a) { if (a !== 'errors') calcInput[a] = d[a]; });
    var match = calcInput.bindingType === 'sewn' && calcInput.spineShape !== 'rounded';
    var result = state.result;
    if (!match) {
      calcInput.bindingType = 'sewn'; calcInput.spineShape = 'flat'; delete calcInput.curveLength;
      try { result = (H || calcModule()).calculate(calcInput); } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
    }
    var five = { signatureCount: result.signatureCount, sheetsPerSignature: Number(result.input.sheetsPerSignature), bookWidth: Number(result.input.bookWidth),
      bookHeight: Number(result.input.bookHeight), paperThickness: Number(result.input.paperThickness) };
    var failed = invalidFields(five);
    if (failed.length) return { fields: failed, five: five };
    return { input: calcInput, result: result, five: five, match: match };
  }

  /**
   * input: { signatureCount, sheetsPerSignature, bookWidth, bookHeight, paperThickness } (a missing field from the base,
   * without a base the default). base: the result of fromBase() (optional). When the five fields equal the base, the
   * base's calculation result is used as it is; otherwise the calculation input = the base input (board, square,
   * turn-in, joint …) + the five fields: when the signature count or the sheets per signature changed,
   * pages = signatures × sheets × 4 (last signature full), otherwise the Calculator's page count and last-signature
   * setting stay. When invalid a RangeError (e.fields = names of the invalid fields). H: the calculation module (a test
   * may pass another copy).
   */
  function calculate(input, base, H) {
    var baseData = base && base.input && base.result ? base : null;
    var vs = baseData ? baseData.five : DEFAULTS;
    var g = {};
    FIELDS.forEach(function (a) {
      var v = input && input[a] != null && input[a] !== '' ? input[a] : vs[a];
      g[a] = v;
    });
    var failed = invalidFields(g);
    if (failed.length) { var e = new RangeError('learn-size: ' + failed.join(', ')); e.fields = failed; throw e; }
    FIELDS.forEach(function (a) { g[a] = readNumber(g[a]); });
    var N = g.signatureCount, y = g.sheetsPerSignature, h, calcInput;
    if (baseData && FIELDS.every(function (a) { return g[a] === baseData.five[a]; })) {
      h = baseData.result;
    } else {
      calcInput = {};
      if (baseData) Object.keys(baseData.input).forEach(function (a) { calcInput[a] = baseData.input[a]; });
      var sameSignature = baseData && N === baseData.five.signatureCount && y === baseData.five.sheetsPerSignature;
      calcInput.bindingType = 'sewn';
      if (baseData) calcInput.spineShape = 'flat';
      calcInput.pageCount = sameSignature ? baseData.input.pageCount : N * y * 4;
      if (baseData) calcInput.shrinkLastSignature = sameSignature ? !!baseData.input.shrinkLastSignature : false;
      calcInput.sheetsPerSignature = y;
      calcInput.bookWidth = g.bookWidth; calcInput.bookHeight = g.bookHeight; calcInput.paperThickness = g.paperThickness;
      h = (H || calcModule()).calculate(calcInput);
    }
    var t = Number(h.input.boardThickness), stationInfo = stations(g.bookHeight);
    return {
      input: g, calc: h, source: h === (baseData && baseData.result) ? 'calculator' : 'guide',
      N: h.signatureCount, y: y, W: g.bookWidth, H: g.bookHeight, paper: g.paperThickness,
      page: h.totalPages, sheet: h.leaves, printSheets: h.printSheets,
      S: h.spineThickness, t: t, k: Number(h.input.square), e: Number(h.input.turnIn), f: h.jointGap,
      Db: h.board.width, Dh: h.board.height, R: h.spineStrip.width,
      covering: h.covering, endpapers: h.endpapers, mull: h.mull, headbands: h.headbands.length,
      station: stationInfo, thread: Math.round((h.signatureCount + 2) * g.bookHeight / 10) * 10,
      corner: [roundOff(t + 2), roundOff(t + 3)]
    };
  }

  return { DEFAULTS: DEFAULTS, LIMIT: LIMIT, END_ALLOWANCE: END_ALLOWANCE, MAX_RANGE: MAX_RANGE,
    readNumber: readNumber, invalidFields: invalidFields, stations: stations, fromBase: fromBase, calculate: calculate };
});
