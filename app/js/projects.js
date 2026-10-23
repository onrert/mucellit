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

  function select(id) {
    selectedId = id;
    O.writeLocal(SELECTED_KEY, id || '');
    drawList();
    drawDetail();
  }

  function drawList() {
    var ul = $('book-list');
    ul.textContent = '';
    $('book-none').hidden = data.projects.length > 0;
    data.projects.forEach(function (k) {
      var il = M.progress(k);
      ul.appendChild(el('li', {}, [
        el('button', { type: 'button', 'data-book': k.id, 'aria-current': k.id === selectedId ? 'true' : 'false', onclick: function () { select(k.id); } }, [
          el('strong', { text: k.name }),
          el('span', { class: 'small', text: t('projects.list_summary', { kind: M.kindName(k.bindingType), done: il.done, n: il.total }) }),
          el('span', { class: 'progress' }, [el('i', { style: 'width:' + Math.round(il.ratio * 100) + '%' })])
        ])
      ]));
    });
  }

  function field(label, input) { return el('label', { class: 'field' }, [el('span', { text: label }), input]); }

  function drawDetail() {
    var container = $('book-detail');
    container.textContent = '';
    var k = selected();
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
      var ap = { kind: settingsKind(a.bindingType), kg: a.paperWidth, ky: a.paperHeight, bg: a.bookWidth, by: a.bookHeight, n: a.sheetsPerSignature };
      container.appendChild(el('p', { class: 'small', text: t(a.bindingType === 'sewn' ? 'projects.saved_settings_signature' : 'projects.saved_settings', ap) }));
    }
    container.appendChild(el('div', { class: 'line' }, [
      el('button', { type: 'button', id: 'settings-toImpose', disabled: !k.settings, text: t('projects.load_settings'), onclick: function () {
        MC.impose.applySettings(k.settings); MC.app.openTab('impose');
        O.notify(k.pdfName ? t('projects.settings_loaded_pdf', { pdf: k.pdfName }) : t('projects.settings_loaded'));
      } }),
      el('button', { type: 'button', id: 'book-remove', text: t('projects.delete_project'), onclick: function () {
        ask(t('projects.confirmation.delete_book', { name: k.name }), function () {
          data.projects = data.projects.filter(function (x) { return x.id !== k.id; });
          save(); select(data.projects[0] ? data.projects[0].id : null);
        });
      } })
    ]));

    container.appendChild(el('h3', { text: t('projects.steps') }));
    var ul = el('ul', { id: 'steps' });
    k.steps.forEach(function (a, i) {
      var name = M.stepName(a);
      var box = el('input', { type: 'checkbox', class: 'step-done', checked: a.done, 'aria-label': t('projects.step.completed', { name: name }) });
      box.addEventListener('change', function () {
        M.markStep(k, a.id, box.checked, O.today());
        save(); drawList(); drawDetail();
      });
      var date = el('input', { type: 'date', class: 'step-date', value: a.date || '', 'aria-label': t('projects.step.date', { name: name }) });
      date.addEventListener('change', function () { a.date = date.value; save(); });
      var note = el('textarea', { class: 'step-note', rows: 1, placeholder: t('projects.step.note'), 'aria-label': t('projects.step.note_label', { name: name }) });
      note.value = a.note || '';
      note.addEventListener('input', function () { a.note = note.value; save(); });
      ul.appendChild(el('li', { class: 'step' + (a.done ? ' done' : ''), 'data-step': a.id }, [
        box,
        el('div', {}, [el('div', { class: 'step-name', text: (i + 1) + '. ' + name }), a.optional ? el('div', { class: 'small', text: t('projects.step.optional') }) : null]),
        date,
        el('div', { class: 'step-buttons' }, [
          el('button', { type: 'button', title: t('projects.step.up'), text: '▲', disabled: i === 0, onclick: function () { M.moveStep(k, a.id, -1); save(); drawDetail(); } }),
          el('button', { type: 'button', title: t('projects.step.down'), text: '▼', disabled: i === k.steps.length - 1, onclick: function () { M.moveStep(k, a.id, 1); save(); drawDetail(); } }),
          el('button', { type: 'button', title: t('projects.step.remove'), class: 'step-remove', text: '✕', onclick: function () {
            ask(t('projects.confirmation.remove_step', { name: name }), function () {
              M.removeStep(k, a.id); save(); drawList(); drawDetail();
            });
          } })
        ]),
        note
      ]));
    });
    container.appendChild(ul);
    var yeniAd = el('input', { type: 'text', id: 'step-fresh-name', placeholder: t('projects.step.new_name') });
    container.appendChild(el('div', { class: 'line' }, [
      yeniAd,
      el('button', { type: 'button', id: 'step-add', text: t('projects.step.add'), onclick: function () {
        try { M.addStep(k, yeniAd.value); save(); drawList(); drawDetail(); } catch (e) { O.notify(e.message, 'error'); }
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
        select(k.id);
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
