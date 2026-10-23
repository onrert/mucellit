/* calculator.js — Hesapla sekmesi arayüzü (calc.js'i kullanır).
 * son çizimin girdisi ve sonucu KitapCilt.hesapla.durum() ile okunur (Öğren rehberinin sayı paneli aynı kaynağı
 * kullanır; ayrı hesap yapmaz). */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  var O = MC.common, $ = O.$, el = O.el, D = MC.i18n;
  function t(a, p) { return D.t(a, p); }
  var NUMBER_FIELDS = ['pageCount', 'sheetsPerSignature', 'paperThickness', 'endpaperAllowance', 'bookWidth', 'bookHeight',
    'boardThickness', 'square', 'curveLength', 'jointGap', 'turnIn', 'spareSheets'];

  function readInputs() {
    var g = { bindingType: $('h-bindingType').value, shrinkLastSignature: $('h-shrinkLastSignature').checked,
      spineShape: $('h-spineShape').value, spineRule: $('h-spineRule').value };
    var errors = [];
    NUMBER_FIELDS.forEach(function (k) {
      var raw = $('h-' + k).value; // "," ya da "."; ortak katı ayrıştırıcı
      var error = O.numberError(raw);
      if (error) errors.push(error);
      g[k] = String(raw).trim() === '' ? undefined : O.parseNumber(raw);
    });
    g.errors = errors;
    if (g.jointGap === undefined) g.jointGap = 'auto';
    return g;
  }

  function mm(x) { return D.number(Math.round(x * 10) / 10) + ' mm'; }
  function size(o) { return mm(o.width) + ' × ' + mm(o.height); }

  // son çizimin girdisi/sonucu ya da hatası (Öğren sayı paneli okur)
  var last = { error: null, input: null, result: null };

  function render() {
    var table = $('h-result'), error = $('h-error'), warning = $('h-warnings');
    table.textContent = ''; error.textContent = ''; warning.textContent = '';
    $('h-curveLength').disabled = $('h-spineShape').value !== 'rounded';
    $('h-spineRule').disabled = $('h-spineShape').value === 'rounded';
    var r;
    var input = readInputs();
    if (input.errors.length) { // geçersiz sayı: sessiz hesap yok, hata gösterilir
      input.errors.forEach(function (m) { error.appendChild(el('div', { class: 'warning', text: m })); });
      last = { error: input.errors.join(' '), input: null, result: null };
      return;
    }
    delete input.errors;
    if (input.pageCount === undefined) {
      error.appendChild(el('div', { class: 'warning', text: t('calculator.enter_page') }));
      last = { error: t('calculator.enter_page'), input: null, result: null };
      return;
    }
    try { r = MC.calc.calculate(input); } catch (e) {
      error.appendChild(el('div', { class: 'warning', text: e.message }));
      last = { error: e.message, input: null, result: null };
      return;
    }
    last = { error: null, input: input, result: r };
    var f = r.jointGap, tk = r.input.boardThickness, k = r.input.square, e = r.input.turnIn; // tk: mukavva t (t() metin)
    var rounded = r.input.spineShape === 'rounded';
    var onlyS = !rounded && r.input.spineRule === 'onlyS';
    var sf = t(rounded ? 'calculator.formula.spine_rounded' : onlyS ? 'calculator.formula.spine_s' : 'calculator.formula.spine_s2t');
    var rows = [
      [t('calculator.result.total_pages'), r.blankPages ? t('calculator.result.total_blank', { n: r.totalPages, blank: r.blankPages }) : String(r.totalPages), 'totalPages', ''],
      [t('calculator.result.leaves'), String(r.leaves), 'leaves', ''],
      [t('calculator.result.signature_count'), r.input.bindingType === 'sewn' ? String(r.signatureCount) : '—', 'signatureCount', ''],
      [t('calculator.result.spine'), mm(r.spineThickness), 'spineThickness', t('calculator.formula.spine_thickness')],
      [t('calculator.result.jointGap'), mm(r.jointGap), 'jointGap', t(r.input.jointGap === 'auto' ? 'calculator.formula.joint_gap_auto' : 'calculator.formula.joint_gap_manual')],
      [t('calculator.result.board'), size(r.board), 'board', 'Db = W − f + k = ' + D.number(r.input.bookWidth) + ' − ' + D.number(f) + ' + ' + D.number(k) + ';  Dh = H + 2k'],
      [t('calculator.result.spine_strip'), size(r.spineStrip), 'spineStrip', sf],
      [t('calculator.result.covering'), size(r.covering), 'covering', t('calculator.formula.covering', { fek: onlyS ? "' (f' = f + t = " + mm(r.coveringJointGap) + ')' : '', e: D.number(e), t: D.number(tk) })],
      [t('calculator.result.endpapers'), size(r.endpapers), 'endpapers', '2W × H'],
      [t('calculator.result.mull'), size(r.mull), 'mull', '(S + 50) × (H − 12)'],
      [t('calculator.result.headbands'), mm(r.headbands.length), 'headbands', t('calculator.formula.headbands')],
      [t('calculator.result.print_sheets'), String(r.printSheets), 'printSheets', '']
    ];
    rows.forEach(function (s) {
      table.appendChild(el('tr', {}, [el('th', { text: s[0] }), el('td', { class: 'value', 'data-result': s[2], text: s[1] }),
        el('td', { class: 'small formula', text: s[3] })]));
    });
    if (r.jointGapUnsourced) warning.appendChild(el('div', { class: 'warning', 'data-warning': 'jointGap', text: t('calculator.warning.jointGap') }));
    if (r.curveLengthWarning) warning.appendChild(el('div', { class: 'warning', 'data-warning': 'curve', text: t('calculator.warning.curve') }));
  }

  function takeFromImpose() {
    var o = MC.impose.summary();
    if (o.pageCount) O.writeNumber('h-pageCount', o.pageCount);
    $('h-bindingType').value = o.settings.bindingType;
    if (isFinite(o.settings.sheetsPerSignature)) O.writeNumber('h-sheetsPerSignature', o.settings.sheetsPerSignature);
    $('h-shrinkLastSignature').checked = !!o.settings.shrinkLastSignature;
    if (isFinite(o.settings.paperThickness)) O.writeNumber('h-paperThickness', o.settings.paperThickness);
    if (isFinite(o.settings.bookWidth)) O.writeNumber('h-bookWidth', o.settings.bookWidth);
    if (isFinite(o.settings.bookHeight)) O.writeNumber('h-bookHeight', o.settings.bookHeight);
    render();
    O.notify(t(o.pageCount ? 'calculator.taken' : 'calculator.taken_without_pdf'));
  }

  function start() {
    var f = $('calc-form');
    f.addEventListener('submit', function (e) { e.preventDefault(); });
    f.addEventListener('input', render);
    f.addEventListener('change', render);
    $('h-al').addEventListener('click', takeFromImpose);
    render();
  }

  /** son çizimin { hata, girdi, sonuc } kopyası (girdi hesap.hesapla'ya verilenin aynısı; sonuç onun sonucu). */
  function state() {
    var g = null;
    if (last.input) { g = {}; Object.keys(last.input).forEach(function (k) { g[k] = last.input[k]; }); }
    return { error: last.error, input: g, result: last.result };
  }

  MC.calculator = { start: start, render: render, state: state };
})(typeof self !== 'undefined' ? self : this);
