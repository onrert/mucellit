/*
 * impose.js — Imposition tab: PDF loading, page grid (delete, reorder,
 * rotate, blank page), imposition settings, sheet preview, export.
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  var O = MC.common, $ = O.$, el = O.el, I18N = MC.i18n; // (D is the document state in this file)
  function t(a, p) { return I18N.t(a, p); }
  var SETTINGS_KEY = 'mucellit.imposeSettings';

  var D = {
    sourceName: '',
    sourceBytes: null,
    pdf: null,
    thumbs: {},
    pages: [],
    selected: {},
    dragging: null,
    loadNo: 0,
    requestNo: 0,       // file choice sequence number: a stale load result is dropped
    outputPdf: null,
    encrypted: false,   // the source PDF is encrypted/permission restricted: pdf-lib cannot decrypt it, export is off
    uncheckable: false, // the encryption/restriction state could not be checked: export is off (fail closed)
    passwordProtected: false,  // a password-protected PDF was chosen: no preview was opened
    pluginSizes: null, // sizes at the time of conversion when converted by a plug-in (e.g. EPUB) {bookWidth, bookHeight, gutter, outerMargin}
    blocked: false      // must the export button be off (encrypted, does not fit the paper, error)
  };
  // Warning texts in the language current when they are read.
  function ENCRYPTED_WARNING() { return t('impose.warning.encrypted'); }
  function PASSWORD_WARNING() { return t('impose.warning.password_protected'); }
  // depends on the environment (browser: "reload the page"; Mac app: tauri.warning_check)
  function UNCHECKED_WARNING() { return (MC.platform && MC.platform.text && MC.platform.text.checkWarning) || t('impose.warning.check'); }
  var counter = 0;
  function newId() { counter += 1; return 's' + counter; }

  // ---------------- settings ----------------
  var FIELDS = {
    bindingType: ['binding-type', 'text'], sheetsPerSignature: ['signature-sheet', 'number'], shrinkLastSignature: ['last-signature-shrink', 'mark'],
    creep: ['creep', 'mark'], paperThickness: ['paper-thickness', 'number'], paperWidth: ['paper-width', 'number'], paperHeight: ['paper-height', 'number'],
    bookWidth: ['book-width', 'number'], bookHeight: ['book-height', 'number'], scaling: ['scaling', 'text'], outerMargin: ['outer-margin', 'number'],
    gutter: ['binding-allowance', 'number'], cropMarks: ['cropMarks', 'mark'], folding: ['folding', 'mark'], spineMarks: ['spine-mark', 'mark'],
    duplex: ['duplex', 'text'], outputMode: ['output-mode', 'text'], backsReversed: ['back-reversed', 'mark']
  };

  function readSettings() {
    var a = {};
    Object.keys(FIELDS).forEach(function (k) {
      var id = FIELDS[k][0], kind = FIELDS[k][1], e = $(id);
      if (kind === 'mark') a[k] = e.checked;
      else if (kind === 'number') a[k] = O.number(id, NaN);
      else a[k] = e.value;
    });
    return a;
  }

  function applySettings(a) {
    if (!a) return;
    ['paper-ready', 'book-ready'].forEach(function (id) { $(id).removeAttribute('data-custom'); }); // the loaded sizes decide the pickers
    Object.keys(FIELDS).forEach(function (k) {
      if (a[k] === undefined || a[k] === null) return;
      var id = FIELDS[k][0], kind = FIELDS[k][1], e = $(id);
      if (kind === 'mark') e.checked = !!a[k];
      else if (kind === 'number') O.writeNumber(e, a[k]); // the language's decimal separator
      else e.value = a[k];
    });
    updateVisibility();
    update();
  }

  function updateVisibility() {
    var kind = $('binding-type').value;
    $('signature-fields').hidden = kind !== 'sewn';
    // the signature settings that sit in "Advanced settings" follow the same rule
    var sewnOnly = document.querySelectorAll('#settings [data-sewn-only]');
    for (var i = 0; i < sewnOnly.length; i++) sewnOnly[i].hidden = kind !== 'sewn';
    var pair = $('output-mode').value === 'pair';
    $('back-reversed-field').hidden = !pair;
    var label = pair ? 'impose.duplex.pair' : 'impose.duplex.single';
    $('duplex-label').setAttribute('data-i18n', label);
    $('duplex-label').textContent = t(label);
    var width = O.number('paper-width', 0), height = O.number('paper-height', 0);
    var rotates = MC.layout.shouldRotateBacks($('duplex').value, width, height);
    $('duplex-hint').textContent = t(rotates ? 'impose.duplex.hint_rotated' : 'impose.duplex.hint_flat',
      { direction: t(width > height ? 'impose.direction.landscape' : 'impose.direction.portrait') });
    if (MC.platform && typeof MC.platform.print === 'function') $('print-note').textContent = printNote();
    refreshSettingsText();
  }

  // ---------------- interface state (layout only; the document state is D) ----------------
  var KIND_SHORT = { sewn: 'impose.kind_short.sewn', single1: 'impose.kind_short.single1', single2: 'impose.kind_short.single2' };
  var exported = false; // an output was made for the current document (the step indicator shows step 3)

  /** "297 × 210" with the language's decimal separator. */
  function sizeText(width, height) { return I18N.numberField(width) + ' × ' + I18N.numberField(height); }

  /** The preset that matches width × height (mm), or null. landscape: the presets are also tried turned. */
  function matchPreset(width, height, landscape) {
    var found = null;
    O.PRESET_SIZES.forEach(function (o) {
      if (found) return;
      if (Math.abs(o.width - width) < 0.01 && Math.abs(o.height - height) < 0.01) found = { name: o.name, landscape: false };
      else if (landscape && Math.abs(o.height - width) < 0.01 && Math.abs(o.width - height) < 0.01) found = { name: o.name, landscape: true };
    });
    return found;
  }

  /** Short name of a size for the summaries: "A4 landscape" or "200 × 297 mm". */
  function sizeName(width, height, landscape) {
    var p = matchPreset(width, height, landscape);
    if (!p) return sizeText(width, height) + ' mm';
    return t(p.landscape ? 'impose.size_short.landscape' : 'impose.size_short.portrait', { name: p.name });
  }

  /**
   * The preset pickers show the current size; a size without a preset shows "Custom size…". A picker on which the user
   * chose "Custom size…" (data-custom) keeps showing it, so the choice does not jump back to the matching preset.
   */
  function syncPresets() {
    [['paper-ready', 'paper-width', 'paper-height'], ['book-ready', 'book-width', 'book-height']].forEach(function (f) {
      var select = $(f[0]);
      var width = O.number(f[1], NaN), height = O.number(f[2], NaN);
      var value = 'custom';
      if (select.getAttribute('data-custom') === 'yes') { select.value = value; return; }
      for (var i = 0; i < select.options.length; i++) {
        var p = select.options[i].value.split('x');
        if (p.length === 2 && Math.abs(Number(p[0]) - width) < 0.01 && Math.abs(Number(p[1]) - height) < 0.01) { value = select.options[i].value; break; }
      }
      select.value = value;
    });
  }

  /** The texts that summarise the settings: signature hint, size summary, the narrow-screen summary, the drop zone size, the download note. */
  function refreshSettingsText() {
    syncPresets();
    var kind = $('binding-type').value;
    var sheets = O.number('signature-sheet', NaN);
    var validSheets = sheets >= 1 && sheets <= 8 && Math.floor(sheets) === sheets;
    $('signature-hint').textContent = validSheets ? t('impose.signature_pages', { n: sheets, pages: sheets * 4 }) : '';
    var pw = O.number('paper-width', NaN), ph = O.number('paper-height', NaN), bw = O.number('book-width', NaN), bh = O.number('book-height', NaN);
    var sizesValid = pw > 0 && ph > 0 && bw > 0 && bh > 0;
    $('size-summary').textContent = sizesValid ? t('impose.size_summary', { paper: sizeText(pw, ph), book: sizeText(bw, bh) }) : '';
    var parts = [t(KIND_SHORT[kind] || KIND_SHORT.sewn)];
    if (sizesValid) parts.push(sizeName(pw, ph, true), sizeName(bw, bh, false));
    if (kind === 'sewn' && validSheets) parts.push(t('impose.sheets_short', { n: sheets }));
    $('settings-summary').textContent = parts.join(' · ');
    var paper = $('paper-ready');
    $('drop-size').textContent = paper.value !== 'custom' && paper.selectedOptions && paper.selectedOptions[0] ? paper.selectedOptions[0].textContent : (sizesValid ? sizeText(pw, ph) + ' mm' : '');
    refreshAdvancedNote();
    refreshDownloadNote();
  }

  /**
   * The advanced settings that differ from their defaults (the HTML default value of each control; the EPUB plug-in
   * sets its defaults the same way), listed in the closed group's summary so that a value loaded from a saved record or
   * a project is in sight without opening the group. Controls that do not apply (hidden, e.g. creep without signatures) are left out.
   */
  function changedAdvanced() {
    var names = [];
    var controls = document.querySelectorAll('#advanced-settings input, #advanced-settings select');
    for (var i = 0; i < controls.length; i++) {
      var c = controls[i];
      if (c.closest('[hidden]')) continue;
      var changed;
      if (c.type === 'checkbox') changed = c.checked !== c.defaultChecked;
      else if (c.tagName === 'SELECT') {
        var first = null;
        for (var k = 0; k < c.options.length; k++) if (c.options[k].defaultSelected) { first = c.options[k]; break; }
        changed = c.value !== (first || c.options[0] || {}).value;
      } else {
        var now = O.parseNumber(c.value), was = O.parseNumber(c.defaultValue);
        changed = isFinite(now) && isFinite(was) ? Math.abs(now - was) > 1e-9 : String(c.value).trim() !== String(c.defaultValue).trim();
      }
      if (!changed) continue;
      var label = c.closest('label');
      var text = label ? (label.querySelector('span') || label).textContent : c.getAttribute('aria-label') || c.id;
      names.push(String(text).replace(/\s+/g, ' ').trim());
    }
    return names;
  }

  function refreshAdvancedNote() {
    var names = changedAdvanced();
    var note = $('advanced-changed');
    note.textContent = names.length ? t('impose.advanced_changed', { n: names.length, names: names.join(', ') }) : '';
    $('advanced-settings').classList.toggle('changed', names.length > 0);
  }

  function refreshDownloadNote() {
    var note = $('download-note');
    if (!D.pages.length) { note.textContent = t('impose.pdf_first'); return; }
    if ($('output-mode').value === 'pair') { note.textContent = t('impose.download_note_pair'); return; }
    var duplex = $('duplex');
    note.textContent = t('impose.download_note', { duplex: duplex.selectedOptions && duplex.selectedOptions[0] ? duplex.selectedOptions[0].textContent : '' });
  }

  /**
   * Shows the parts of the Imposition tab that fit the document state: without pages the drop zone (and the "how it
   * works" cards) with the big choose button; with pages the file bar, the view switch, the sheet preview or the page grid.
   * The choose button (#pdf-select) is one element: it moves between the drop zone and the file bar.
   */
  function refreshLayout() {
    var hasPages = D.pages.length > 0;
    var tab = $('tab-impose');
    var stage = !hasPages ? 'load' : (exported ? 'print' : 'check');
    tab.setAttribute('data-stage', stage);
    var order = ['load', 'check', 'print'];
    var steps = tab.querySelectorAll('.tape li');
    for (var i = 0; i < steps.length; i++) {
      var k = order.indexOf(steps[i].getAttribute('data-step')), now = order.indexOf(stage);
      steps[i].className = k < now ? 'done' : (k === now ? 'now' : '');
      if (k === now) steps[i].setAttribute('aria-current', 'step'); else steps[i].removeAttribute('aria-current');
    }
    $('file-bar').hidden = !D.sourceName;
    $('drop-zone').hidden = hasPages;
    $('how').hidden = hasPages;
    $('result').hidden = !hasPages;
    var chooser = $('pdf-select').parentNode; // label.file-select (button + hidden input)
    var slot = hasPages ? $('file-slot') : $('drop-slot');
    var button = $('pdf-select');
    if (chooser.parentNode !== slot) {
      // moving a focused element drops the focus to <body>; the choose button keeps it in its new place
      var focused = document.activeElement === button || document.activeElement === document.body || !document.activeElement;
      slot.appendChild(chooser);
      if (focused && document.activeElement !== button) button.focus();
    }
    placeSettings();
    var key = hasPages ? 'impose.choose_other' : (MC.plugins.list().length > 0 ? 'impose.pdf_epub_choose' : 'impose.pdf_choose');
    if (button.getAttribute('data-i18n') !== key) { button.setAttribute('data-i18n', key); button.textContent = t(key); }
    button.classList.toggle('main', !hasPages);
    $('page-count').textContent = hasPages ? '(' + D.pages.length + ')' : '';
    refreshSelectionCount();
    refreshDownloadNote();
  }

  /**
   * The settings panel follows the reading order: on a wide screen it is the side column (after the work area); on a
   * narrow one (one column, style.css ≤ 820 px) it sits in the work area where it is seen: after the drop zone without
   * a document, before the result with one. So the Tab order is the visual order (no CSS `order`).
   */
  var narrowQuery = root.matchMedia ? root.matchMedia('(max-width: 820px)') : null;
  function placeSettings() {
    var settings = $('settings'), work = $('work'), mat = $('mat');
    var narrow = !!(narrowQuery && narrowQuery.matches);
    var parent = narrow ? work : work.parentNode;
    var before = narrow ? (D.pages.length > 0 ? mat : mat.nextSibling) : null;
    if (settings.parentNode === parent && (narrow ? settings.nextSibling === before : !settings.nextElementSibling)) return;
    var active = document.activeElement;
    var hadFocus = active && settings.contains(active);
    parent.insertBefore(settings, before);
    if (hadFocus && document.activeElement !== active) active.focus();
  }

  function refreshSelectionCount() {
    var n = D.pages.filter(function (s) { return D.selected[s.id]; }).length;
    $('selection-count').textContent = n ? t('impose.selection_count', { n: n }) : t('impose.selection_none');
  }

  /** A new document (or a failed choice): the output preview and step 3 belong to the previous one. */
  function newDocumentView() {
    exported = false;
    var section = $('output-section');
    if (section) section.hidden = true;
  }

  /** Sheet preview ↔ Pages view. */
  function showView(pages) {
    $('view-sheets').setAttribute('aria-selected', pages ? 'false' : 'true');
    $('view-pages').setAttribute('aria-selected', pages ? 'true' : 'false');
    // roving tabindex: only the selected view tab is in the Tab order; the arrow keys move between them (layoutEvents)
    $('view-sheets').setAttribute('tabindex', pages ? '-1' : '0');
    $('view-pages').setAttribute('tabindex', pages ? '0' : '-1');
    $('sheet-view').hidden = pages;
    $('pages-view').hidden = !pages;
  }

  /** Makes an element inside the settings visible: opens the closed groups around it and the folded settings panel. */
  function reveal(element) {
    for (var n = element; n; n = n.parentElement) {
      if (n.tagName === 'DETAILS') n.open = true;
      if (n.id === 'settings') { n.classList.add('open'); $('settings-toggle').setAttribute('aria-expanded', 'true'); }
    }
  }

  /** Ruler numbers along the top of the cutting mat (decorative): 0, 5, 10 … every 120 px, only the ones that fit. */
  function drawRuler() {
    var rulers = document.querySelectorAll('#tab-impose .ruler');
    for (var i = 0; i < rulers.length; i++) {
      var r = rulers[i], width = r.clientWidth;
      if (!width) continue;
      var offset = root.matchMedia && root.matchMedia('(max-width: 640px)').matches ? 12 : 22; // = --ruler-offset in style.css
      var count = 0;
      while (offset + count * 120 + 30 < width) count++;
      if (r.childElementCount === count && r.getAttribute('data-offset') === String(offset)) continue;
      r.textContent = '';
      r.setAttribute('data-offset', String(offset));
      for (var k = 0; k < count; k++) {
        var s = document.createElement('span');
        s.textContent = String(k * 5);
        s.style.left = (offset + k * 120 + 2) + 'px';
        r.appendChild(s);
      }
    }
  }

  // ---------------- PDF loading ----------------
  function pdfjs() {
    var p = root.pdfjsLib;
    if (!p) throw new Error(t('error.pdfjs'));
    return p;
  }

  function openDocument(bytes) {
    // isEvalSupported:false — against the code execution hole through a malicious font (pdf.js < 4.2.67)
    // No password prompt (no browser dialog is used): a password-protected PDF is rejected with PasswordException, caught by loadFile.
    return pdfjs().getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  }

  /**
   * Is the document encrypted when loaded with pdf-lib (owner password/permission restricted included)? pdf-lib does NOT decrypt.
   * true: encrypted, false: not, null: COULD NOT BE CHECKED (no pdf-lib or it could not parse) → fail closed:
   * the caller turns export off.
   */
  async function isEncrypted(bytes) {
    try {
      if (!root.PDFLib) throw new Error(t('error.pdflib'));
      var d = await root.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      return !!d.isEncrypted;
    } catch { return null; }
  }

  function passwordDocument(name) {
    if (D.pdf) { try { D.pdf.destroy(); } catch { /* ignore */ } }
    D.loadNo += 1;
    D.pdf = null; D.sourceBytes = null; D.sourceName = name;
    D.encrypted = false; D.uncheckable = false; D.passwordProtected = true; D.pluginSizes = null;
    D.thumbs = {}; D.selected = {}; D.pages = [];
    newDocumentView();
    $('source-info').removeAttribute('data-i18n');
    $('source-info').textContent = t('impose.source.password_protected', { name: name });
    drawCards();
    update();
    O.notify(name + ': ' + PASSWORD_WARNING(), 'error');
  }

  /**
   * The newly chosen file could not be opened: the previous document is not kept (so the user cannot download the old
   * document while seeing an error). The document, cards and plug-in warnings are cleared, export turns off. Same for PDF and EPUB.
   */
  function failedDocument(name) {
    if (D.pdf) { try { D.pdf.destroy(); } catch { /* ignore */ } }
    D.loadNo += 1;
    D.pdf = null; D.sourceBytes = null; D.sourceName = name;
    D.encrypted = false; D.uncheckable = false; D.passwordProtected = false; D.pluginSizes = null;
    D.thumbs = {}; D.selected = {}; D.pages = [];
    newDocumentView();
    MC.plugins.resetAll();
    $('source-info').removeAttribute('data-i18n');
    $('source-info').textContent = t('impose.source.open_failed', { name: name });
    D.blocked = true;
    setOutputButtons(true);
    drawCards();
    update();
  }

  /**
   * File choice order: every load gets a sequence number; when a newer choice exists after an await returns, this
   * (stale) result is dropped and the state and notice do not change. Plug-in warnings are cleared when a new load starts.
   * When the current request fails, the previous document is cleared (failedDocument) and the error goes to the caller (notice).
   */
  async function loadFile(file) {
    var no = ++D.requestNo;
    function stale() { return no !== D.requestNo; }
    MC.plugins.resetAll();
    try {
      return await load(file, stale);
    } catch (e) {
      if (stale()) return; // an old request's error does not spoil the notice and state of the new choice
      failedDocument(file.name || t('impose.document'));
      throw e;
    }
  }

  async function load(file, stale) {
    var name = file.name || t('impose.document') + '.pdf';
    var bytes;
    var isPdf = /\.pdf$/i.test(name) || file.type === 'application/pdf';
    var pluginSizes = null;
    if (isPdf) {
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      var d = MC.plugins.find(file);
      if (!d) throw new Error(t('impose.kind_unsupported', { name: name }));
      O.notify(t('impose.converting', { name: d.name }));
      pluginSizes = currentSizes();
      bytes = await d.convert(file, {
        bookWidth: pluginSizes.bookWidth, bookHeight: pluginSizes.bookHeight,
        gutter: pluginSizes.gutter, outerMargin: pluginSizes.outerMargin,
        progress: function (m) { if (!stale()) O.notify(m); },
        isCurrent: function () { return !stale(); }
      });
      if (stale()) return;
      if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
      name = name.replace(/(\.epub\.zip|\.[^.]+)$/i, '') + '.pdf'; // "Book.epub.zip" → "Book.pdf"
    }
    if (stale()) return;
    var head = String.fromCharCode.apply(null, bytes.subarray(0, 1024));
    if (head.indexOf('%PDF') < 0) throw new Error(t('impose.pdf_not', { name: name }));
    var pdf;
    try { pdf = await openDocument(bytes); } catch (e) {
      if (stale()) return;
      if (e && e.name === 'PasswordException') return passwordDocument(name);
      // pdf.js's raw (English) error text is not shown to the user
      var h = new Error(t('impose.pdf_corrupt', { name: name }));
      h.cause = e;
      throw h;
    }
    var encrypted = await isEncrypted(bytes);
    if (stale()) { try { pdf.destroy(); } catch { /* ignore */ } return; }
    if (D.pdf) { try { D.pdf.destroy(); } catch { /* ignore */ } }
    D.loadNo += 1;
    D.pdf = pdf;
    D.sourceBytes = bytes;
    D.sourceName = name;
    D.encrypted = encrypted === true;
    D.uncheckable = encrypted === null;
    D.passwordProtected = false;
    D.pluginSizes = pluginSizes;
    D.thumbs = {};
    D.selected = {};
    D.pages = [];
    newDocumentView();
    for (var i = 0; i < pdf.numPages; i++) D.pages.push({ id: newId(), kind: 'pdf', source: i, rotate: 0 });
    var first = await pdf.getPage(1);
    var vp = first.getViewport({ scale: 1 });
    $('source-info').removeAttribute('data-i18n');
    $('source-info').textContent = t('impose.source.info', { name: name, n: pdf.numPages,
      width: Math.round(vp.width / MC.output.MM), height: Math.round(vp.height / MC.output.MM) });
    setOutputButtons(true);  // drawPreview turns them on depending on the encrypted/does-not-fit state
    D.blocked = true;
    drawCards();
    update();
    renderThumbnails(D.loadNo);
    if (encrypted === null) O.notify(t('impose.loaded_but', { name: name, warning: UNCHECKED_WARNING() }), 'error');
    else if (encrypted) O.notify(t('impose.loaded_but', { name: name, warning: ENCRYPTED_WARNING() }), 'error');
    else O.notify(t('impose.loaded', { name: name, n: pdf.numPages }));
  }

  async function renderThumbnails(no) {
    var pdf = D.pdf;
    for (var i = 0; i < pdf.numPages; i++) {
      if (no !== D.loadNo) return;
      try {
        var page = await pdf.getPage(i + 1);
        var vp1 = page.getViewport({ scale: 1 });
        var scaling = Math.min(232 / vp1.height, 200 / vp1.width);
        var vp = page.getViewport({ scale: scaling });
        var c = document.createElement('canvas');
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        if (no !== D.loadNo) return;
        D.thumbs[i] = c.toDataURL('image/png');
        var imgs = document.querySelectorAll('#small-thumbs img[data-source="' + i + '"]');
        for (var j = 0; j < imgs.length; j++) imgs[j].src = D.thumbs[i];
      } catch (e) {
        if (no !== D.loadNo) return;
        O.notify(t('impose.thumbnail_error', { n: i + 1, error: e.message }), 'error');
      }
    }
    var grid = $('small-thumbs');
    if (grid) grid.setAttribute('data-thumbs-ready', 'yes');
  }

  // ---------------- page grid ----------------
  function indexOf(id) {
    for (var i = 0; i < D.pages.length; i++) if (D.pages[i].id === id) return i;
    return -1;
  }

  function changed() { drawCards(); update(); }

  function move(id, newIndex) {
    var i = indexOf(id);
    if (i < 0) return;
    var s = D.pages.splice(i, 1)[0];
    if (newIndex > i) newIndex -= 1;
    D.pages.splice(Math.max(0, Math.min(D.pages.length, newIndex)), 0, s);
    changed();
  }

  function drawCards() {
    var grid = $('small-thumbs');
    grid.removeAttribute('data-thumbs-ready');
    grid.textContent = '';
    var part = document.createDocumentFragment();
    D.pages.forEach(function (s, i) {
      var image;
      if (s.kind === 'blank') {
        image = el('div', { class: 'image blank-page', text: t('impose.card.blank_page') });
      } else {
        var img = el('img', { alt: t('impose.card.source_page', { n: s.source + 1 }), 'data-source': String(s.source), draggable: 'false' });
        if (D.thumbs[s.source]) img.src = D.thumbs[s.source];
        var d = s.rotate || 0;
        img.style.transform = 'rotate(' + d + 'deg)' + (d % 180 ? ' scale(0.7)' : '');
        image = el('div', { class: 'image' }, [img]);
      }
      // The whole card is the selection target: the label (checkbox + position) is stretched over the card in CSS, so a
      // click or tap anywhere on the card toggles the checkbox. Moving, rotating and deleting are in the selection bar.
      var card = el('div', {
        class: 'card' + (D.selected[s.id] ? ' selected' : ''), draggable: 'true', 'data-id': s.id,
        'data-order': String(i + 1), 'data-kind': s.kind, 'data-source': s.kind === 'pdf' ? String(s.source + 1) : ''
      }, [
        image,
        el('div', { class: 'label' }, [
          el('label', { class: 'card-hit' }, [
            el('input', { type: 'checkbox', class: 'card-select', checked: !!D.selected[s.id], 'aria-label': t('impose.card.select', { n: i + 1 }) }),
            el('span', { class: 'card-no', text: String(i + 1) })
          ]),
          el('span', { class: 'small', text: s.kind === 'pdf' ? t('impose.card.source', { n: s.source + 1 }) + (s.rotate ? ' · ' + s.rotate + '°' : '') : t('impose.card.blank') })
        ])
      ]);
      part.appendChild(card);
    });
    grid.appendChild(part);
    if (D.pdf && Object.keys(D.thumbs).length >= D.pdf.numPages) grid.setAttribute('data-thumbs-ready', 'yes');
    refreshLayout();
  }

  function cardEvents() {
    var grid = $('small-thumbs');
    grid.addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      var id = card.getAttribute('data-id');
      if (e.target.classList.contains('card-select')) {
        if (e.target.checked) D.selected[id] = true; else delete D.selected[id];
        card.classList.toggle('selected', !!D.selected[id]);
        refreshSelectionCount();
      }
    });
    grid.addEventListener('dragstart', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      D.dragging = card.getAttribute('data-id');
      card.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', D.dragging); e.dataTransfer.effectAllowed = 'move'; } catch { /* ignore */ }
    });
    grid.addEventListener('dragend', function () {
      D.dragging = null;
      var k = grid.querySelectorAll('.dragging, .target');
      for (var i = 0; i < k.length; i++) k[i].classList.remove('dragging', 'target');
    });
    grid.addEventListener('dragover', function (e) {
      var card = e.target.closest('.card');
      if (!card || !D.dragging) return;
      e.preventDefault();
      var previous = grid.querySelector('.target');
      if (previous && previous !== card) previous.classList.remove('target');
      card.classList.add('target');
    });
    grid.addEventListener('drop', function (e) {
      var card = e.target.closest('.card');
      if (!card || !D.dragging) return;
      e.preventDefault();
      var targetId = card.getAttribute('data-id');
      if (targetId === D.dragging) return;
      var r = card.getBoundingClientRect();
      var after = e.clientX > r.left + r.width / 2;
      var j = indexOf(targetId) + (after ? 1 : 0);
      var id = D.dragging;
      D.dragging = null;
      move(id, j);
    });
  }

  /** "1-4, 9" → [1,2,3,4,9] (from 1, valid sequence numbers). */
  function parseRange(text, max) {
    var result = {};
    String(text || '').split(/[,;\s]+/).forEach(function (p) {
      if (!p) return;
      var m = p.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) throw new Error(t('impose.range_faulty', { part: p }));
      var a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
      if (a > b) { var temp = a; a = b; b = temp; }
      for (var i = Math.max(1, a); i <= Math.min(max, b); i++) result[i] = true;
    });
    return Object.keys(result).map(Number);
  }

  function selectedIndices() {
    var l = [];
    D.pages.forEach(function (s, i) { if (D.selected[s.id]) l.push(i); });
    return l;
  }

  /** Opens the file; errors go to the notice (the Promise is not rejected). Also called from the menu/Open Recent/Dock. */
  function openFile(f) {
    return loadFile(f).catch(function (err) { O.notify(t('impose.file_open_failed', { error: err.message }), 'error'); });
  }

  function toolEvents() {
    $('pdf-select').addEventListener('click', function () {
      // In the browser the hidden input opens and the choice arrives through the change event below (returns null);
      // the native dialog returns a File directly.
      MC.platform.pickFile({ input: $('pdf-file'), extensions: ['pdf', 'epub'], mime: 'application/pdf' })
        .then(function (f) { if (f) return openFile(f); }, function (err) { O.notify(t('impose.file_open_failed', { error: err.message }), 'error'); });
    });
    $('pdf-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      openFile(f).then(function () { e.target.value = ''; });
    });
    // Dropping a file on the window/page: only when a file is dragged in from outside; dragging a page in the grid
    // (D.dragging) is left alone. Where nothing takes the drop, the browser is also kept from opening the file and
    // leaving the page.
    function isFileDrag(e) {
      var types = e.dataTransfer && e.dataTransfer.types;
      return !D.dragging && !!types && Array.prototype.indexOf.call(types, 'Files') >= 0;
    }
    document.addEventListener('dragover', function (e) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch { /* ignore */ }
    });
    document.addEventListener('drop', function (e) {
      if (e.defaultPrevented || !isFileDrag(e)) return;
      e.preventDefault();
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (MC.app) MC.app.openTab('impose');
      openFile(f);
    });
    $('range-select').addEventListener('click', function () {
      try {
        var l = parseRange($('range').value, D.pages.length);
        D.selected = {};
        l.forEach(function (n) { D.selected[D.pages[n - 1].id] = true; });
        drawCards();
        O.notify(t('impose.selected', { n: l.length }));
      } catch (err) { O.notify(err.message, 'error'); }
    });
    $('all-select').addEventListener('click', function () {
      D.selected = {}; D.pages.forEach(function (s) { D.selected[s.id] = true; }); drawCards();
    });
    $('selection-remove').addEventListener('click', function () { D.selected = {}; drawCards(); });
    $('selected-remove').addEventListener('click', function () {
      var n = selectedIndices().length;
      if (!n) return O.notify(t('impose.select_first'), 'error');
      D.pages = D.pages.filter(function (s) { return !D.selected[s.id]; });
      D.selected = {}; changed(); O.notify(t('impose.deleted', { n: n }));
    });
    $('selected-unselected-remove').addEventListener('click', function () {
      if (!selectedIndices().length) return O.notify(t('impose.select_first'), 'error');
      D.pages = D.pages.filter(function (s) { return D.selected[s.id]; });
      changed();
    });
    $('selected-rotate').addEventListener('click', function () {
      var l = selectedIndices();
      if (!l.length) return O.notify(t('impose.select_first'), 'error');
      l.forEach(function (i) { var s = D.pages[i]; if (s.kind === 'pdf') s.rotate = ((s.rotate || 0) + 90) % 360; });
      changed();
    });
    $('blank-toStart').addEventListener('click', function () { D.pages.unshift({ id: newId(), kind: 'blank' }); changed(); });
    $('blank-toEnd').addEventListener('click', function () { D.pages.push({ id: newId(), kind: 'blank' }); changed(); });
    $('blank-once').addEventListener('click', function () {
      var l = selectedIndices();
      if (!l.length) return O.notify(t('impose.select_first'), 'error');
      D.pages.splice(l[0], 0, { id: newId(), kind: 'blank' });
      changed();
    });
    // Move earlier / later: every selected page moves one place; a block of selected pages moves together (their order is kept)
    $('selected-earlier').addEventListener('click', function () {
      if (!selectedIndices().length) return O.notify(t('impose.select_first'), 'error');
      for (var i = 1; i < D.pages.length; i++) {
        if (D.selected[D.pages[i].id] && !D.selected[D.pages[i - 1].id]) { var a = D.pages[i - 1]; D.pages[i - 1] = D.pages[i]; D.pages[i] = a; }
      }
      changed();
    });
    $('selected-later').addEventListener('click', function () {
      if (!selectedIndices().length) return O.notify(t('impose.select_first'), 'error');
      for (var i = D.pages.length - 2; i >= 0; i--) {
        if (D.selected[D.pages[i].id] && !D.selected[D.pages[i + 1].id]) { var a = D.pages[i + 1]; D.pages[i + 1] = D.pages[i]; D.pages[i] = a; }
      }
      changed();
    });
  }

  /** The layout controls of the tab: view switch, sheets stepper, the folding settings panel, the "Learn" link, the ruler. */
  function layoutEvents() {
    $('view-sheets').addEventListener('click', function () { showView(false); });
    $('view-pages').addEventListener('click', function () { showView(true); });
    // tablist keyboard pattern: ← → (and Home / End) select and focus the other view tab
    $('view-sheets').parentNode.addEventListener('keydown', function (e) {
      var keys = { ArrowLeft: 'prev', ArrowRight: 'next', Home: 'first', End: 'last' };
      if (!keys[e.key]) return;
      e.preventDefault();
      var pages = $('view-pages').getAttribute('aria-selected') === 'true';
      var toPages = keys[e.key] === 'first' ? false : keys[e.key] === 'last' ? true : !pages;
      showView(toPages);
      $(toPages ? 'view-pages' : 'view-sheets').focus();
    });
    if (narrowQuery) {
      if (narrowQuery.addEventListener) narrowQuery.addEventListener('change', placeSettings);
      else if (narrowQuery.addListener) narrowQuery.addListener(placeSettings);
    }
    function step(by) {
      var input = $('signature-sheet');
      var n = Math.round(O.number('signature-sheet', 4));
      if (!(n >= 1)) n = 4;
      O.writeNumber(input, Math.max(1, Math.min(8, n + by)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    $('signature-less').addEventListener('click', function () { step(-1); });
    $('signature-more').addEventListener('click', function () { step(1); });
    $('settings-toggle').addEventListener('click', function () {
      var open = !$('settings').classList.contains('open');
      $('settings').classList.toggle('open', open);
      $('settings-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    var links = document.querySelectorAll('#tab-impose [data-open-tab]');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function (e) { if (MC.app) MC.app.openTab(e.currentTarget.getAttribute('data-open-tab')); });
    }
    if (typeof root.ResizeObserver === 'function') new root.ResizeObserver(drawRuler).observe($('mat'));
    else root.addEventListener('resize', drawRuler);
  }

  // ---------------- preview ----------------
  var updatePending = false;
  function update() {
    if (updatePending) return;
    updatePending = true;
    (root.requestAnimationFrame || setTimeout)(function () { updatePending = false; drawPreview(); });
  }

  function computeImposition() {
    var a = readSettings();
    var dz = MC.imposition.impose(a.bindingType, {
      pageCount: D.pages.length, sheetsPerSignature: a.sheetsPerSignature, shrinkLastSignature: a.shrinkLastSignature,
      creepEnabled: a.creep, paperThickness: a.paperThickness
    });
    return { settings: a, imposition: dz, layout: MC.layout.layout(dz, a) };
  }

  /** The sizes given to the plug-in (mm): Imposition > Sizes. */
  function currentSizes() {
    return { bookWidth: O.number('book-width', 148), bookHeight: O.number('book-height', 210), gutter: O.number('binding-allowance', 0), outerMargin: O.number('outer-margin', 0) };
  }

  /** Warning text when a document converted by a plug-in was imposed with sizes other than the current ones; otherwise null. */
  function pluginSizeWarning() {
    var e = D.pluginSizes;
    if (!e) return null;
    var g = currentSizes();
    var same = ['bookWidth', 'bookHeight', 'gutter', 'outerMargin'].every(function (k) { return Math.abs(e[k] - g[k]) < 1e-9; });
    if (same) return null;
    return t('impose.warning.plugin_size', { width: e.bookWidth, height: e.bookHeight, binding: e.gutter, outer: e.outerMargin });
  }

  function drawPreview() {
    var container = $('sheet-preview'), uy = $('warnings'), oz = $('imposition-summary');
    container.textContent = ''; uy.textContent = ''; oz.textContent = '';
    O.writeLocal(SETTINGS_KEY, JSON.stringify(readSettings()));
    refreshLayout();
    var sizeWarning = D.pages.length ? pluginSizeWarning() : null;
    if (sizeWarning) uy.appendChild(el('div', { class: 'warning', id: 'plugin-size-warning', text: sizeWarning }));
    if (!D.pages.length) {
      oz.textContent = t('impose.preview_for');
      if (D.passwordProtected) uy.appendChild(el('div', { class: 'warning', id: 'passwordProtected-warning', text: PASSWORD_WARNING() }));
      D.blocked = true; setOutputButtons(true);
      return;
    }
    if (D.encrypted) uy.appendChild(el('div', { class: 'warning', id: 'encrypted-warning', text: ENCRYPTED_WARNING() }));
    if (D.uncheckable) uy.appendChild(el('div', { class: 'warning', id: 'check-warning', text: UNCHECKED_WARNING() }));
    var r;
    try { r = computeImposition(); } catch (e) {
      uy.appendChild(el('div', { class: 'warning', text: e.message }));
      D.blocked = true; setOutputButtons(true);
      return;
    }
    // Encrypted PDF or a layout that does not fit the paper: download off (the warning shows above/below)
    D.blocked = D.encrypted || D.uncheckable || !!r.layout.doesNotFit;
    setOutputButtons(D.blocked);
    var dz = r.imposition;
    var parts = [t('impose.summary.completed', { n: D.pages.length, total: dz.totalPages, blank: dz.totalPages - D.pages.length })];
    if (dz.kind === 'sewn') parts.push(t('impose.summary.signature', { n: dz.signatures.length }));
    parts.push(t('impose.summary.paper', { n: dz.sheets.length, side: 2 * dz.sheets.length }));
    oz.textContent = parts.join(' · ');
    r.layout.warnings.forEach(function (u) { uy.appendChild(el('div', { class: 'warning', text: u })); });

    var sides = r.layout.sides;
    for (var i = 0; i < sides.length; i += 2) {
      var front = sides[i], back = sides[i + 1];
      var title = dz.kind === 'sewn'
        ? t(front.indexInSignature === 0 ? 'impose.sheet.signature_outer' : 'impose.sheet.signature', { signature: front.signature + 1, sheet: front.indexInSignature + 1 })
        : t('impose.sheet.paper', { n: front.sheet + 1 });
      // data-band: the paper tape colour of the sheet title (one colour per signature, three in turn)
      var band = dz.kind === 'sewn' ? (front.signature % 3) + 1 : 1;
      container.appendChild(el('div', { class: 'sheet-card', 'data-sheet': String(front.sheet), 'data-band': String(band) }, [
        el('div', { class: 'title' }, [el('span', { class: 'band', text: title }), el('span', { class: 'out', text: t('impose.sheet.output_page', { a: i + 1, b: i + 2 }) })]),
        el('div', { class: 'sides' }, [
          el('div', {}, [sideCanvas(r.layout, front), el('div', { class: 'side-name', text: t('impose.sheet.front', { pages: front.slots.map(pageLabel).join(' | ') }) })]),
          el('div', {}, [sideCanvas(r.layout, back), el('div', { class: 'side-name', text: t(back.rotate180 ? 'impose.sheet.back_rotated' : 'impose.sheet.back', { pages: back.slots.map(pageLabel).join(' | ') }) })])
        ])
      ]));
    }
  }

  function pageLabel(yv) { return yv.blank ? t('impose.sheet.blank_page', { n: yv.page }) : String(yv.page); }

  function sideCanvas(place, side) {
    var W = 280, PW = place.paper.width, PH = place.paper.height;
    var k = W / PW, H = Math.round(PH * k);
    var c = el('canvas', { width: W, height: H, 'aria-label': t(side.side === 'front' ? 'impose.sheet.front_side' : 'impose.sheet.back_side', { pages: side.slots.map(pageLabel).join(', ') }) });
    var g = c.getContext('2d');
    function X(x) { return x * k; }
    function Y(y) { return H - y * k; } // PDF: origin at the bottom left
    // paper laid on the cutting mat: off-white sheet, hatched blank pages, the spine side in brass, numbers in mono
    var MONO = 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace';
    g.fillStyle = '#fcfcf8'; g.fillRect(0, 0, W, H);
    side.slots.forEach(function (yv) {
      var v = yv.slot;
      var x = X(v.x), y = Y(v.y + v.h), w = v.w * k, h = v.h * k;
      if (yv.blank) {
        g.fillStyle = '#eef0eb'; g.fillRect(x, y, w, h);
        g.strokeStyle = '#d5dbd3'; g.lineWidth = 1;
        g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
        for (var ti = -h; ti < w; ti += 8) { g.beginPath(); g.moveTo(x + ti, y + h); g.lineTo(x + ti + h, y); g.stroke(); }
        g.restore();
      } else {
        g.fillStyle = '#fcfcf8'; g.fillRect(x, y, w, h);
        var inner = yv.content;
        g.strokeStyle = '#c4cdc6'; g.setLineDash([3, 2]);
        g.strokeRect(X(inner.x) + 0.5, Y(inner.y + inner.h) + 0.5, inner.w * k - 1, inner.h * k - 1);
        g.setLineDash([]);
      }
      g.strokeStyle = '#a3ada6'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      // spine side: thick line
      g.strokeStyle = '#b78512'; g.lineWidth = 3;
      var spineLeft = (yv.spineSide === 'left') !== !!side.rotate180;
      g.beginPath(); var sx = spineLeft ? x + 1.5 : x + w - 1.5; g.moveTo(sx, y); g.lineTo(sx, y + h); g.stroke();
      g.save();
      g.translate(x + w / 2, y + h / 2);
      if (side.rotate180) g.rotate(Math.PI);
      g.fillStyle = yv.blank ? '#6e7b73' : '#142019';
      g.font = (yv.blank ? '500 ' : '700 ') + Math.round(Math.min(w, h) * 0.3) + 'px ' + MONO;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(yv.page), 0, 0);
      if (yv.creep) { g.font = '10px ' + MONO; g.fillText(t('impose.sheet.creep', { mm: yv.creep }), 0, h * 0.3); }
      g.restore();
    });
    g.strokeStyle = '#2c3a33'; g.lineWidth = 1;
    side.lines.forEach(function (cz) {
      g.setLineDash(cz.dashed ? [3, 3] : []);
      g.beginPath(); g.moveTo(X(cz.x1), Y(cz.y1)); g.lineTo(X(cz.x2), Y(cz.y2)); g.stroke();
    });
    g.setLineDash([]);
    // signature spine mark: at least 6 px so that it is readable in the preview
    side.squares.forEach(function (kr) {
      var w = Math.max(6, kr.w * k), h = Math.max(6, kr.h * k);
      var cx = X(kr.x + kr.w / 2), cy = Y(kr.y + kr.h / 2);
      g.fillStyle = '#fff'; g.fillRect(cx - w / 2 - 1, cy - h / 2 - 1, w + 2, h + 2); // readable background
      g.fillStyle = '#000';
      // the style (filled / outline / small squares) is scaled into a box of at least 6 × 6 px
      var ox = w / (kr.w * k), oy = h / (kr.h * k);
      MC.layout.markParts(kr).forEach(function (pr) {
        g.fillRect(cx - w / 2 + (pr.x - kr.x) * k * ox, cy - h / 2 + (kr.y + kr.h - pr.y - pr.h) * k * oy, Math.max(1, pr.w * k * ox), Math.max(1, pr.h * k * oy));
      });
    });
    return c;
  }

  // ---------------- export ----------------
  // Output buttons: Save/Download, Print…, Open in Preview (the last two show only when platform.print exists).
  var OUTPUT_BUTTONS = ['export-transfer', 'print', 'inPreview-open'];
  // while an output job runs (building the PDF, Save/print window) the buttons stay off; the preview that is redrawn
  // when a setting changes (drawPreview → setOutputButtons(D.blocked)) does not turn them on, so no second job starts.
  var outputBusy = false;
  function setOutputButtons(closed) {
    OUTPUT_BUTTONS.forEach(function (id) { var b = $(id); if (b) b.disabled = closed || outputBusy; });
  }

  /** The print buttons show only with native printing (Mac app); the note tells the duplex choice in the tool. */
  function updatePrintVisibility() {
    var var_ = !!(MC.platform && typeof MC.platform.print === 'function');
    $('print-field').hidden = !var_;
    $('print-note').hidden = !var_;
    $('inPreview-open').hidden = !(var_ && typeof MC.platform.openInPreview === 'function');
    if (var_) $('print-note').textContent = printNote();
  }
  function printNote() {
    return MC.printing.note({ t: t }, $('output-mode').value === 'pair', $('duplex').value);
  }

  /**
   * Builds the output and hands it to the job (Save/Download, Print, Preview). While it runs all output buttons are off
   * and the clicked one is aria-busy (D10: menu shortcuts are ignored meanwhile, no "open a PDF first"). job(result) returns a Promise.
   */
  async function runOutputJob(buttonId, is) {
    if (outputBusy) return; // aria-busy: a job is running (button/menu/shortcut does not start a second one)
    if (!D.pages.length) return O.notify(t('impose.pdf_first'), 'error');
    if (D.encrypted) return O.notify(ENCRYPTED_WARNING(), 'error');
    if (D.uncheckable) return O.notify(UNCHECKED_WARNING(), 'error');
    var btn = $(buttonId);
    outputBusy = true;
    setOutputButtons(true);
    OUTPUT_BUTTONS.forEach(function (id) { var b = $(id); if (b) b.setAttribute('aria-busy', 'true'); });
    var oldText = btn.textContent;
    btn.textContent = t('impose.preparing');
    try {
      var result = await MC.output.build({ sourceBytes: D.sourceBytes, pages: D.pages, settings: readSettings(), fileName: D.sourceName });
      await is(result);
    } catch (e) {
      O.notify(t('impose.output_make_failed', { error: e.message }), 'error');
    } finally {
      outputBusy = false;
      OUTPUT_BUTTONS.forEach(function (id) { var b = $(id); if (b) b.removeAttribute('aria-busy'); });
      setOutputButtons(D.blocked);
      btn.textContent = oldText;
    }
  }

  /** Print… (one PDF, or fronts → flip confirmation → backs); the note is shown before the print window. */
  function print() {
    return runOutputJob('print', async function (result) {
      await showOutputPreview(result.files[0].bytes);
      O.notify(printNote());
      var r = await MC.printing.print(result.files, { platform: MC.platform, t: t });
      O.notify(r.text, r.kind);
    });
  }

  /** Open in Preview (when it cannot open: Save + an "print from Preview" note: printing.js). */
  function openInPreview() {
    return runOutputJob('inPreview-open', async function (result) {
      await showOutputPreview(result.files[0].bytes);
      var r = await MC.printing.openInPreview(result.files, { platform: MC.platform, t: t });
      O.notify(r.text, r.kind);
    });
  }

  function exportPdf() {
    return runOutputJob('export-transfer', async function (result) {
      if (MC.platform.localFile) {
        // Native Save window (Tauri): the files are saved one by one, the notice tells the real result. Step 3 is marked
        // only when at least one file was written (a cancelled Save window leaves the step indicator at step 2).
        await showOutputPreview(result.files[0].bytes, false);
        var record = await MC.platform.saveAll(result.files, 'application/pdf');
        if (record && record.saved && record.saved.length) { exported = true; refreshLayout(); }
        var m = MC.platform.saveMessage(record, result.layout.sides.length);
        O.notify(m.text, m.kind);
        return;
      }
      result.files.forEach(function (d, i) {
        setTimeout(function () {
          O.download(d.name, d.bytes, 'application/pdf').catch(function (err) { O.notify(t('save.save_failed', { name: d.name, error: err.message }), 'error'); });
        }, i * 600);
      });
      await showOutputPreview(result.files[0].bytes);
      O.notify(t('impose.ready', { names: result.files.map(function (d) { return d.name; }).join(t('app.and')), n: result.layout.sides.length }));
    });
  }

  /** markDone false: the caller marks step 3 itself once it knows the output was really kept (Tauri Save window). */
  async function showOutputPreview(bytes, markDone) {
    var container = $('output-preview');
    container.textContent = '';
    container.removeAttribute('data-ready');
    $('output-section').hidden = false; // the output preview shows only once an output was made
    if (markDone !== false) exported = true;
    refreshLayout();
    if (D.outputPdf) { try { D.outputPdf.destroy(); } catch { /* ignore */ } D.outputPdf = null; }
    var pdf = await openDocument(bytes);
    D.outputPdf = pdf;
    var count = Math.min(2, pdf.numPages);
    for (var i = 1; i <= count; i++) {
      var s = await pdf.getPage(i);
      var vp1 = s.getViewport({ scale: 1 });
      var vp = s.getViewport({ scale: 520 / vp1.width });
      var c = el('canvas', { width: Math.ceil(vp.width), height: Math.ceil(vp.height), 'aria-label': t('impose.output_page', { n: i }) });
      c.style.width = Math.ceil(vp.width / 1.3) + 'px';
      await s.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      container.appendChild(c);
    }
    container.setAttribute('data-ready', 'yes');
  }

  // ---------------- save to project ----------------
  /** The current in-memory data of the Projects tab (the newest even when storage is full); otherwise from storage. */
  function currentData() {
    var v = (MC.projects && MC.projects.data && MC.projects.data()) || MC.storage.read();
    return JSON.parse(JSON.stringify(v)); // copy: the caller cannot change the live data
  }

  function refreshProjectList() {
    var select = $('settings-book');
    var previous = select.value;
    var data = currentData();
    select.textContent = '';
    if (!data.projects.length) select.appendChild(el('option', { value: '', text: t('impose.project_first_hint') }));
    data.projects.forEach(function (k) { select.appendChild(el('option', { value: k.id, text: k.name })); });
    if (previous && MC.projectModel.findProject(data, previous)) select.value = previous;
  }

  function saveEvents() {
    $('settings-save').addEventListener('click', function () {
      var id = $('settings-book').value;
      if (!id) return O.notify(t('impose.project_first'), 'error');
      var a = readSettings();
      MC.projects.saveSettings(id, a, D.sourceName);
      O.notify(t('impose.settings_saved'));
    });
    $('settings-load').addEventListener('click', function () {
      var id = $('settings-book').value;
      var data = currentData();
      var k = id && MC.projectModel.findProject(data, id);
      if (!k || !k.settings) return O.notify(t('impose.no_settings'), 'error');
      applySettings(k.settings);
      O.notify(k.pdfName ? t('impose.settings_loaded_pdf', { name: k.name, pdf: k.pdfName }) : t('impose.settings_loaded', { name: k.name }));
    });
  }

  // ---------------- start ----------------
  /**
   * The preset picker shows the current size (syncPresets); "Custom size…" stands for a size without a preset and
   * opens the size fields. Choosing a preset writes its width × height.
   */
  function fillPresetSizes(selectId, widthId, heightId, landscape) {
    var select = $(selectId);
    O.PRESET_SIZES.forEach(function (o) {
      select.appendChild(el('option', { value: o.width + 'x' + o.height, text: t('impose.ready.portrait', { name: o.name, width: o.width, height: o.height }) }));
      if (landscape) select.appendChild(el('option', { value: o.height + 'x' + o.width, text: t('impose.ready.landscape', { name: o.name, width: o.height, height: o.width }) }));
    });
    select.appendChild(el('option', { value: 'custom', text: t('impose.size_custom') }));
    // 'input' comes before the panel's own input/change listeners (they sync the pickers), so the choice is handled first
    function chosen() {
      if (select.value === 'custom') {
        // the choice stays "Custom size…" (syncPresets keeps it) until a preset is chosen or settings are loaded
        select.setAttribute('data-custom', 'yes');
        $('size-fields').open = true;
        $(widthId).focus();
        return;
      }
      select.removeAttribute('data-custom');
      var p = select.value.split('x');
      if (p.length !== 2) return;
      O.writeNumber(widthId, Number(p[0])); O.writeNumber(heightId, Number(p[1]));
      update();
    }
    select.addEventListener('input', chosen);
    select.addEventListener('change', chosen);
  }

  /** ⇄: the preset picker, the summaries and the drop zone size follow the new orientation too (updateVisibility). */
  function swap(widthId, heightId) {
    var g = $(widthId).value; $(widthId).value = $(heightId).value; $(heightId).value = g;
    updateVisibility(); update();
  }

  function start() {
    fillPresetSizes('paper-ready', 'paper-width', 'paper-height', true);
    fillPresetSizes('book-ready', 'book-width', 'book-height', false);
    $('paper-swap').addEventListener('click', function () { swap('paper-width', 'paper-height'); });
    $('book-swap').addEventListener('click', function () { swap('book-width', 'book-height'); });
    var registered = O.readLocal(SETTINGS_KEY);
    if (registered) { try { applySettings(JSON.parse(registered)); } catch { /* corrupt record: defaults */ } }
    $('settings').addEventListener('input', function () { updateVisibility(); update(); });
    $('settings').addEventListener('change', function () { updateVisibility(); update(); });
    $('export-transfer').addEventListener('click', exportPdf);
    $('print').addEventListener('click', print);
    $('inPreview-open').addEventListener('click', openInPreview);
    updatePrintVisibility();
    $('pdf-file').setAttribute('accept', MC.plugins.accept());
    if (MC.plugins.list().length > 0) { $('pdf-select').setAttribute('data-i18n', 'impose.pdf_epub_choose'); $('pdf-select').textContent = t('impose.pdf_epub_choose'); }
    MC.plugins.setupInterfaces($('plugin-settings'));
    cardEvents();
    toolEvents();
    layoutEvents();
    saveEvents();
    refreshProjectList();
    updateVisibility();
    // a saved size without a preset: the size fields are open, so the numbers in use are in sight
    if ($('paper-ready').value === 'custom' || $('book-ready').value === 'custom') $('size-fields').open = true;
    refreshLayout();
    drawRuler();
    update();
  }

  function summary() {
    var a = readSettings();
    return { pageCount: D.pages.length, settings: a };
  }

  MC.impose = { start: start, openFile: openFile, readSettings: readSettings, applySettings: applySettings, currentData: currentData, refreshProjectList: refreshProjectList, summary: summary, parseRange: parseRange, reveal: reveal };
})(typeof self !== 'undefined' ? self : this);
