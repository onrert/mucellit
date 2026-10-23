/*
 * learn-measure.js — "Kitabın sayıları" paneli: kitabın beş sayısından rehberin bütün ölçüleri.
 * Cilt ölçüleri Mücellit'in kendi hesabından gelir (KitapCilt.hesap.hesapla). (uygulamaya ekleme): öntanımlı
 * sayılar Hesapla sekmesinin girdileri ve onun hesap sonucudur (taban; aynı kaynak, kopya hesap yok): rehber Hesapla'nın
 * mukavva kalınlığını, taşmayı, kıvırmayı, mafsalı, forza payını, sırt şeridi kuralını aynen kullanır; yalnız cilt türü
 * hep formalı dikiş ve sırt hep düz çizilir (rehberin konusu). Panelde elle değişiklik yalnız rehberde kalır.
 * Taban yoksa (Hesapla okunamadı) yedek öntanımlı: Örnek Kitap (11 forma × 4 kâğıt, 148 × 210, 0,1 mm).
 * Rehberin ek varsayımları (araçta yok):
 *   delik:  uçlardan 15 mm içeride birer kettle deliği, aralık en çok 40 mm, çift sayıda delik (kaynaksız varsayım;
 *           MEB-2021 s.26 örneğinde uçlar ~25 mm, Cockerell ~6 mm)
 *   iplik:  yaklaşık (forma + 2) × kitap boyu, 10 mm'ye yuvarlanır (kaynaksız yaklaşık kural)
 *   köşe:   mukavva köşesinden t + 2 … t + 3 mm (MEGEP-2008 s.36: "mukavva kalınlığından 2-3 mm fazla"; MEB-2021 s.75: 5 mm)
 * Tarayıcıda KitapCilt.ogren.olcu, Node'da module.exports (testler).
 * LİSANS NOTU: Mücellit kodu (MIT, kökteki LICENSE); Colorfigures kodu içermez. Bu klasördeki Colorfigures parçaları MIT lisanslı
 * (April Zhu, Tolga Cohce), tam metin: LICENSE.
 */
(function (root, factory) {
  var m = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.Mucellit = root.Mucellit || {}; root.Mucellit.learn = root.Mucellit.learn || {}; root.Mucellit.learn.size = m; }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var DEFAULTS = { signatureCount: 11, sheetsPerSignature: 4, bookWidth: 148, bookHeight: 210, paperThickness: 0.1 };
  // [en az, en çok, tam sayı mı]
  var LIMIT = {
    signatureCount: [1, 40, true], sheetsPerSignature: [1, 8, true],
    bookWidth: [60, 300, false], bookHeight: [80, 420, false], paperThickness: [0.04, 0.4, false]
  };
  var UC_ALLOWANCE = 15, MAX_RANGE = 40;

  function roundOff(x) { return Math.round(x * 1000) / 1000; }

  /** "8,8" / "8.8" / 8.8 → 8.8; boş ya da bozuk → NaN. Binlik ayracı kabul edilmez. */
  function readNumber(v) {
    if (typeof v === 'number') return v;
    var s = String(v == null ? '' : v).trim().replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return Number(s);
  }

  /** Geçersiz alanların adları (boş dizi = geçerli). */
  function invalidFields(g) {
    return Object.keys(LIMIT).filter(function (a) {
      var v = readNumber(g[a]), s = LIMIT[a];
      return !isFinite(v) || v < s[0] || v > s[1] || (s[2] && !Number.isInteger(v));
    });
  }

  function stations(H) {
    var inner = H - 2 * UC_ALLOWANCE;
    var rangeCount = Math.max(1, Math.ceil(inner / MAX_RANGE));
    if (rangeCount % 2 === 0) rangeCount += 1;   // delik sayısı = aralık + 1, çift olmalı
    var range = inner / rangeCount, position = [];
    for (var i = 0; i <= rangeCount; i++) position.push(roundOff(UC_ALLOWANCE + i * range));
    return { number: position.length, range: roundOff(range), position: position, ucAllowance: UC_ALLOWANCE };
  }

  function calcModule() {
    if (root && root.Mucellit && root.Mucellit.calc) return root.Mucellit.calc;
    return require('../calc.js');
  }

  var FIELDS = Object.keys(DEFAULTS);

  /**
   * Hesapla sekmesinin durumundan taban: { girdi (rehberin hesap girdisi: formalı, düz sırt), sonuc (o girdinin
   * hesap sonucu), bes (panelin beş alanı), uyum (Hesapla'da cilt türü formalı ve sırt düz mü) }.
   * durum: { girdi, sonuc, hata } (KitapCilt.hesapla.durum()). Hesapla formalı + düz sırttaysa Hesapla'nın kendi sonucu
   * aynen kullanılır (yeniden hesaplanmaz). Hata: Hesapla hatalıysa { hata }, rehberin sınırları dışındaysa { alanlar }.
   */
  function fromBase(state, H) {
    if (!state || state.error || !state.input || !state.result) return { error: state && state.error ? state.error : true };
    var hg = {}, d = state.input;
    Object.keys(d).forEach(function (a) { if (a !== 'errors') hg[a] = d[a]; });
    var match = hg.bindingType === 'sewn' && hg.spineShape !== 'rounded';
    var result = state.result;
    if (!match) {
      hg.bindingType = 'sewn'; hg.spineShape = 'flat'; delete hg.curveLength;
      try { result = (H || calcModule()).calculate(hg); } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
    }
    var bes = { signatureCount: result.signatureCount, sheetsPerSignature: Number(result.input.sheetsPerSignature), bookWidth: Number(result.input.bookWidth),
      bookHeight: Number(result.input.bookHeight), paperThickness: Number(result.input.paperThickness) };
    var failed = invalidFields(bes);
    if (failed.length) return { fields: failed, bes: bes };
    return { input: hg, result: result, bes: bes, match: match };
  }

  /**
   * girdi: { formaSayisi, formaYaprak, kitapGen, kitapYuk, kagitKalinlik } (eksik alan tabandan, taban yoksa öntanımlı).
   * taban: tabandan() sonucu (isteğe bağlı). Beş alan tabanla aynıysa tabanın hesap sonucu aynen kullanılır; değilse hesap
   * girdisi = taban girdisi (mukavva, taşma, kıvırma, mafsal …) + beş alan: forma sayısı ya da forma yaprağı değiştiyse
   * sayfa = forma × kâğıt × 4 (son forma tam), değişmediyse Hesapla'nın sayfa sayısı ve son forma ayarı kalır.
   * Geçersizse RangeError (e.alanlar = geçersiz alan adları). H: hesap modülü (testte başka bir kopya verilebilir).
   */
  function calculate(input, base, H) {
    var tb = base && base.input && base.result ? base : null;
    var vs = tb ? tb.bes : DEFAULTS;
    var g = {};
    FIELDS.forEach(function (a) {
      var v = input && input[a] != null && input[a] !== '' ? input[a] : vs[a];
      g[a] = v;
    });
    var failed = invalidFields(g);
    if (failed.length) { var e = new RangeError('learn-size: ' + failed.join(', ')); e.fields = failed; throw e; }
    FIELDS.forEach(function (a) { g[a] = readNumber(g[a]); });
    var N = g.signatureCount, y = g.sheetsPerSignature, h, hg;
    if (tb && FIELDS.every(function (a) { return g[a] === tb.bes[a]; })) {
      h = tb.result;
    } else {
      hg = {};
      if (tb) Object.keys(tb.input).forEach(function (a) { hg[a] = tb.input[a]; });
      var sameSignature = tb && N === tb.bes.signatureCount && y === tb.bes.sheetsPerSignature;
      hg.bindingType = 'sewn';
      if (tb) hg.spineShape = 'flat';
      hg.pageCount = sameSignature ? tb.input.pageCount : N * y * 4;
      if (tb) hg.shrinkLastSignature = sameSignature ? !!tb.input.shrinkLastSignature : false;
      hg.sheetsPerSignature = y;
      hg.bookWidth = g.bookWidth; hg.bookHeight = g.bookHeight; hg.paperThickness = g.paperThickness;
      h = (H || calcModule()).calculate(hg);
    }
    var t = Number(h.input.boardThickness), ist = stations(g.bookHeight);
    return {
      input: g, calc: h, source: h === (tb && tb.result) ? 'calculator' : 'guide',
      N: h.signatureCount, y: y, W: g.bookWidth, H: g.bookHeight, paper: g.paperThickness,
      page: h.totalPages, sheet: h.leaves, printSheets: h.printSheets,
      S: h.spineThickness, t: t, k: Number(h.input.square), e: Number(h.input.turnIn), f: h.jointGap,
      Db: h.board.width, Dh: h.board.height, R: h.spineStrip.width,
      covering: h.covering, endpapers: h.endpapers, mull: h.mull, headbands: h.headbands.length,
      station: ist, thread: Math.round((h.signatureCount + 2) * g.bookHeight / 10) * 10,
      corner: [roundOff(t + 2), roundOff(t + 3)]
    };
  }

  return { DEFAULTS: DEFAULTS, LIMIT: LIMIT, UC_ALLOWANCE: UC_ALLOWANCE, MAX_RANGE: MAX_RANGE,
    readNumber: readNumber, invalidFields: invalidFields, stations: stations, fromBase: fromBase, calculate: calculate };
});
