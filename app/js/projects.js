/*
 * projects.js — Projects tab: project list, steps (check, date, note,
 * add/remove/reorder), project details, JSON export/import.
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  var O = MC.common, $ = O.$, el = O.el, M = MC.projectModel, D = MC.i18n;
  function t(a, p) { return D.t(a, p); }
  var SELECTED_KEY = 'mucellit.selectedProject';

  var data = null;
  var selectedId = null;

  function save() {
    var ok = MC.storage.write(data);
    storageWarning(!ok);
    if (MC.impose) MC.impose.refreshProjectList();
  }

  function storageWarning(show) {
    var k = $('storage-warning');
    k.textContent = '';
    if (MC.storage.isCorrupt()) {
      k.appendChild(el('div', { class: 'warning', text: t('projects.warning.corrupt', { key: MC.storage.KEY + '.corrupt' }) }));
    }
    if (show || !MC.storage.isPersistent()) {
      // depends on the environment (browser: projects.warning.storage; Mac app: tauri.warning_storage)
      k.appendChild(el('div', { class: 'warning', text: (MC.platform && MC.platform.text && MC.platform.text.storageWarning) || t('projects.warning.storage') }));
    }
  }

  function selected() { return selectedId ? M.findProject(data, selectedId) : null; }

  /** The binding type in saved Imposition settings (in Turkish the raw value as today, e.g. "sewn"; in English its name). */
  function settingsKind(kind) { return D.has('projects.settings_type.' + kind) ? t('projects.settings_type.' + kind) : String(kind); }

  /** When the confirmation window (MC.platform.ask, Promise) says "yes", job() runs; on "no" nothing happens. */
  function ask(message, is) {
    return MC.platform.ask(message).then(function (ok) { if (ok) is(); })
      .catch(function (err) { O.notify(t('projects.operation_failed', { error: err && err.message ? err.message : err }), 'error'); });
  }

  /**
   * Selects a book and redraws the shelf and the open book. chosen: the user picked it (shelf, new-book form).
   * The redraw replaces the focused shelf button (and WebKit does not focus a clicked button at all), so the focus is
   * placed: on a narrow screen (one column, style.css ≤ 820 px) the open book is below the shelf and the form, so a
   * chosen book is brought into view and its title gets the focus; on a wide screen the focus goes to the book on the
   * shelf and the page moves only when that button is under a bar or out of the window (common.focusInView). Delete book
   * passes chosen too (WebKit leaves the focus on <body> after a click or a tap, so "the focus was lost" cannot be seen
   * there): the next book is handled the same way; with no book left the focus goes to the new-book form. A redraw that
   * took the focus away does the same. A chosen book's redraw does not give the focus back to the control that had it
   * (Delete book of the next book): the focus goes to its place once, not through that control.
   */
  var narrowQuery = root.matchMedia ? root.matchMedia('(max-width: 820px)') : null;
  function select(id, chosen) {
    var active = document.activeElement;
    var hadFocus = !!active && active !== document.body && $('tab-projects').contains(active);
    selectedId = id;
    O.writeLocal(SELECTED_KEY, id || '');
    drawList();
    drawDetail(chosen ? false : undefined);
    var lost = hadFocus && (!document.activeElement || document.activeElement === document.body);
    if (!chosen && !lost) return;
    var target = null;
    var items = $('book-list').querySelectorAll('button[data-book]');
    for (var i = 0; i < items.length; i++) if (items[i].getAttribute('data-book') === selectedId) target = items[i];
    var heading = $('book-detail').querySelector('h2');
    if (!target) {
      O.focusInView($('yk-name')); // no book (left): the new-book form
    } else if (heading && narrowQuery && narrowQuery.matches) {
      heading.setAttribute('tabindex', '-1');
      heading.scrollIntoView({ block: 'start' }); // the scroll-padding of html (style.css) keeps it below the sticky header
      heading.focus({ preventScroll: true });
    } else {
      O.focusInView(target);
    }
  }

  /**
   * drawDetail replaces every control of the open book, so a step control used with the keyboard (or a tap) would leave
   * the focus on <body>. place says where it goes after the redraw: { step, control, index } → the same control of the
   * same step (data-control: done | up | down | remove); an arrow disabled now (the step reached an end) hands over to the
   * other arrow; a removed step hands over to the step that took its place (or the one before it), the last one to the
   * "New step" field. { id } → that element. Without place the focused element keeps the focus when it has an id; with
   * place false nothing is focused (select places the focus itself). The focus is kept clear of the bars over the page
   * (common.focusInView): a step moved up can land under the sticky header, one moved down under the phone tab bar.
   */
  function placeFocus(place) {
    var target = null;
    if (place.id) target = $(place.id);
    else {
      var rows = $('steps') ? $('steps').children : [], row = null;
      for (var i = 0; i < rows.length; i++) if (rows[i].getAttribute('data-step') === place.step) row = rows[i];
      if (!row) row = rows[place.index] || rows[place.index - 1] || null;
      if (!row) target = $('step-fresh-name');
      else {
        target = row.querySelector('[data-control="' + place.control + '"]');
        if (target && target.disabled) target = row.querySelector('[data-control="' + (place.control === 'up' ? 'down' : 'up') + '"]');
        if (!target || target.disabled) target = row.querySelector('[data-control="done"]');
      }
    }
    O.focusInView(target);
  }

  function drawList() {
    var ul = $('book-list');
    ul.textContent = '';
    $('book-none').hidden = data.projects.length > 0;
    data.projects.forEach(function (k) {
      var il = M.progress(k);
      ul.appendChild(el('li', {}, [
        el('button', { type: 'button', 'data-book': k.id, 'aria-current': k.id === selectedId ? 'true' : 'false', onclick: function () { select(k.id, true); } }, [
          el('strong', { text: k.name }),
          el('span', { class: 'small', text: t('projects.list_summary', { kind: M.kindName(k.bindingType), done: il.done, n: il.total }) }),
          el('span', { class: 'progress' }, [el('i', { style: 'width:' + Math.round(il.ratio * 100) + '%' })])
        ])
      ]));
    });
  }

  function field(label, input) { return el('label', { class: 'field' }, [el('span', { text: label }), input]); }

  function drawDetail(place) {
    var container = $('book-detail');
    var active = document.activeElement;
    if (place === undefined && active && active.id && container.contains(active)) place = { id: active.id };
    container.textContent = '';
    drawDetailContent(container);
    if (place) placeFocus(place);
  }

  function drawDetailContent(container) {
    var k = selected();
    container.classList.toggle('empty', !k); // no book chosen: the panel is an empty cutting mat (style.css)
    if (!k) {
      container.appendChild(el('p', { class: 'small', text: t('projects.detail_blank') }));
      return;
    }
    // number field type=text + data-number (the language's decimal separator; "," or "." accepted, common.setupNumberFields)
    function infoInput(key, kind, ek) {
      var isNumber = kind === 'number';
      var value = k[key] === undefined ? '' : isNumber ? D.numberField(k[key]) : String(k[key]);
      var oz = isNumber ? { type: 'text', inputmode: 'decimal', 'data-number': '' } : { type: kind };
      var g = el('input', Object.assign(oz, { value: value, 'data-field': key }, ek || {}));
      g.addEventListener('change', function () {
        var n = isNumber ? O.parseNumber(g.value) : g.value;
        if (isNumber && !isFinite(n)) return; // an invalid number is not stored (the field error is in common.setupNumberFields)
        k[key] = n;
        save(); drawList();
      });
      return g;
    }
    var il = M.progress(k);
    container.appendChild(el('h2', { text: k.name }));
    container.appendChild(el('p', { class: 'summary', id: 'book-progress', text: t('projects.progress', { kind: M.kindName(k.bindingType), done: il.done, n: il.total, date: k.created }) }));
    container.appendChild(el('span', { class: 'progress book-tape', 'aria-hidden': 'true' }, [el('i', { style: 'width:' + Math.round(il.ratio * 100) + '%' })]));
    container.appendChild(el('div', { class: 'fields-grid' }, [
      field(t('projects.field.name'), infoInput('name', 'text')),
      field(t('projects.field.width'), infoInput('bookWidth', 'number', { step: '0.1', min: '1' })),
      field(t('projects.field.height'), infoInput('bookHeight', 'number', { step: '0.1', min: '1' })),
      field(t('projects.field.paper'), infoInput('paper', 'text')),
      field(t('field.paper_thickness'), infoInput('paperThickness', 'number', { step: '0.01', min: '0' })),
      field(t('projects.field.pdf_name'), infoInput('pdfName', 'text'))
    ]));
    if (k.settings) {
      var a = k.settings;
      var ap = { kind: settingsKind(a.bindingType), pw: a.paperWidth, ph: a.paperHeight, bw: a.bookWidth, bh: a.bookHeight, n: a.sheetsPerSignature };
      container.appendChild(el('p', { class: 'small', text: t(a.bindingType === 'sewn' ? 'projects.saved_settings_signature' : 'projects.saved_settings', ap) }));
    }
    container.appendChild(el('div', { class: 'line' }, [
      el('button', { type: 'button', id: 'settings-toImpose', disabled: !k.settings, text: t('projects.load_settings'), onclick: function () {
        MC.impose.applySettings(k.settings); MC.app.openTab('impose');
        O.notify(k.pdfName ? t('projects.settings_loaded_pdf', { pdf: k.pdfName }) : t('projects.settings_loaded'));
      } }),
      el('button', { type: 'button', id: 'book-remove', class: 'danger', text: t('projects.delete_project'), onclick: function () {
        ask(t('projects.confirmation.delete_book', { name: k.name }), function () {
          data.projects = data.projects.filter(function (x) { return x.id !== k.id; });
          save(); select(data.projects[0] ? data.projects[0].id : null, true);
        });
      } })
    ]));

    container.appendChild(el('h3', { text: t('projects.steps') }));
    var ul = el('ul', { id: 'steps' });
    k.steps.forEach(function (a, i) {
      var name = M.stepName(a);
      var here = function (control) { return { step: a.id, control: control, index: i }; };
      var box = el('input', { type: 'checkbox', class: 'step-done', 'data-control': 'done', checked: a.done, 'aria-label': t('projects.step.completed', { name: name }) });
      box.addEventListener('change', function () {
        M.markStep(k, a.id, box.checked, O.today());
        save(); drawList(); drawDetail(here('done'));
      });
      var date = el('input', { type: 'date', class: 'step-date', value: a.date || '', 'aria-label': t('projects.step.date', { name: name }) });
      date.addEventListener('change', function () { a.date = date.value; save(); });
      var note = el('textarea', { class: 'step-note', rows: 1, placeholder: t('projects.step.note'), 'aria-label': t('projects.step.note_label', { name: name }) });
      note.value = a.note || '';
      note.addEventListener('input', function () { a.note = note.value; save(); });
      // the checkbox sits in a 44 × 44 label (the touch target); the grid areas are in style.css (.step)
      ul.appendChild(el('li', { class: 'step' + (a.done ? ' done' : ''), 'data-step': a.id }, [
        el('label', { class: 'step-check' }, [box]),
        el('div', { class: 'step-title' }, [el('div', { class: 'step-name', text: (i + 1) + '. ' + name }), a.optional ? el('div', { class: 'small', text: t('projects.step.optional') }) : null]),
        date,
        el('div', { class: 'step-buttons' }, [
          el('button', { type: 'button', 'data-control': 'up', title: t('projects.step.up'), text: '▲', disabled: i === 0, onclick: function () { M.moveStep(k, a.id, -1); save(); drawDetail(here('up')); } }),
          el('button', { type: 'button', 'data-control': 'down', title: t('projects.step.down'), text: '▼', disabled: i === k.steps.length - 1, onclick: function () { M.moveStep(k, a.id, 1); save(); drawDetail(here('down')); } }),
          el('button', { type: 'button', 'data-control': 'remove', title: t('projects.step.remove'), class: 'step-remove', text: '✕', onclick: function () {
            ask(t('projects.confirmation.remove_step', { name: name }), function () {
              M.removeStep(k, a.id); save(); drawList(); drawDetail(here('remove'));
            });
          } })
        ]),
        note
      ]));
    });
    container.appendChild(ul);
    var newName = el('input', { type: 'text', id: 'step-fresh-name', placeholder: t('projects.step.new_name') });
    container.appendChild(el('div', { class: 'line' }, [
      newName,
      el('button', { type: 'button', id: 'step-add', text: t('projects.step.add'), onclick: function () {
        // the focus stays on "Add step" (it moves down by the new step), also after a click in WebKit, which does not focus a clicked button
        try { M.addStep(k, newName.value); save(); drawList(); drawDetail({ id: 'step-add' }); } catch (e) { O.notify(e.message, 'error'); }
      } })
    ]));
  }

  function newProjectEvents() {
    $('fresh-book-form').addEventListener('submit', function (e) {
      e.preventDefault();
      try {
        var k = M.newProject({
          name: $('yk-name').value, bindingType: $('yk-kind').value,
          bookWidth: O.requiredNumber('yk-width', 148), bookHeight: O.requiredNumber('yk-height', 210), // O1: invalid → error
          paper: $('yk-paper').value, paperThickness: O.requiredNumber('yk-thickness', 0.1), pdfName: $('yk-pdf').value,
          created: O.today()
        });
        data.projects.push(k);
        save();
        $('yk-name').value = '';
        select(k.id, true);
        O.notify(t('projects.created', { name: k.name }));
      } catch (err) { O.notify(err.message, 'error'); }
    });
  }

  function backupEvents() {
    $('json-export').addEventListener('click', function () {
      var text = JSON.stringify(data, null, 2);
      var count = data.projects.length;
      // ok: true (browser download), { name, path } (written by the native Save window) or false (cancelled)
      O.download(t('projects.backup_file_name', { date: O.today() }) + '.json', text, 'application/json').then(function (ok) {
        if (ok) O.notify(ok.path ? t('projects.exported_path', { n: count, path: ok.path }) : t('projects.exported', { n: count }));
        else O.notify(t('projects.json_not_saved'), 'error');
      }, function (err) { O.notify(t('projects.export_failed', { error: err.message }), 'error'); });
    });
    // In the browser the hidden input opens and the choice arrives through the change event below (returns null); the
    // native dialog returns a File directly (same pattern as "Choose PDF" in impose.js). A rejected picker also goes to the notice.
    $('json-import-button').addEventListener('click', function () {
      MC.platform.pickFile({ input: $('json-import'), extensions: ['json'], mime: 'application/json' })
        .then(function (f) { if (f) return importFile(f); }, function (err) { O.notify(t('projects.import_failed', { error: err.message }), 'error'); });
    });
    $('json-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      importFile(f).then(function () { e.target.value = ''; });
    });
    /** Imports the chosen backup file; errors go to the notice, the Promise is never rejected. */
    function importFile(f) {
      return f.text().then(function (text) {
        var fresh;
        try { fresh = JSON.parse(text); } catch (x) { throw new Error(t('projects.json_not'), { cause: x }); }
        if (MC.migrate) fresh = MC.migrate.projects(fresh); // backup exported by an earlier version
        M.validate(fresh);
        var ask = data.projects.length
          ? MC.platform.ask(t('projects.confirmation.change', { n: data.projects.length, fresh: fresh.projects.length }))
          : Promise.resolve(true);
        return ask.then(function (ok) {
          if (!ok) return;
          data = fresh;
          save();
          select(data.projects[0] ? data.projects[0].id : null);
          O.notify(t('projects.imported', { n: data.projects.length }));
        });
      }).catch(function (err) { O.notify(t('projects.import_failed', { error: err.message }), 'error'); });
    }
    $('data-clear').addEventListener('click', function () {
      ask(t('projects.confirmation.clear'), function () {
        MC.storage.clear();
        data = M.emptyData();
        save();
        select(null);
        O.notify(t('projects.deleted'));
      });
    });
  }

  /** Called from the Imposition tab. */
  function saveSettings(id, settings, pdfName) {
    var k = M.findProject(data, id);
    if (!k) throw new Error(t('projects.book_not_found'));
    k.settings = JSON.parse(JSON.stringify(settings));
    if (isFinite(settings.bookWidth)) k.bookWidth = settings.bookWidth;
    if (isFinite(settings.bookHeight)) k.bookHeight = settings.bookHeight;
    if (isFinite(settings.paperThickness) && settings.bindingType === 'sewn') k.paperThickness = settings.paperThickness;
    if (pdfName) k.pdfName = pdfName;
    save();
    if (k.id === selectedId) drawDetail();
    drawList();
  }

  function start() {
    data = MC.storage.read();
    var s = O.readLocal(SELECTED_KEY);
    selectedId = s && M.findProject(data, s) ? s : (data.projects[0] ? data.projects[0].id : null);
    newProjectEvents();
    backupEvents();
    storageWarning(false);
    drawList();
    drawDetail();
  }

  MC.projects = { start: start, saveSettings: saveSettings, data: function () { return data; }, selected: selected };
})(typeof self !== 'undefined' ? self : this);
