/*
 * project-model.js — data model of the projects (books being bound), a pure module without DOM
 * (Mucellit.projectModel / module.exports).
 *
 * Data format (the same as the JSON backup):
 * { version: 2, projects: [ { id, name, bindingType: 'sewn'|'single', bookWidth, bookHeight,
 *   paper, paperThickness, pdfName, created, steps: [ { id, name, done, date, note, optional, template? } ],
 *   settings: null | { ...Imposition tab settings } } ] }
 * The PDF file itself is not stored; only its name.
 * Data saved by earlier versions (version 1, Turkish field names) is converted by migrate.js before it gets here.
 *
 * (i18n): a step from a template has a `template` key (e.g. "sewing"); `name` is written in the language current when
 * it was created (for older versions and the JSON backup). The name shown is `stepName(step)`: in the current language
 * when there is a template key; for the oldest records (without keys) also in the current language when the name is
 * exactly a Turkish template name; otherwise (a step the user added) as it is. Such records are not rewritten
 * (resolved when read).
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    root.Mucellit = root.Mucellit || {};
    root.Mucellit.projectModel = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var root = typeof self !== 'undefined' ? self : globalThis; // Mucellit.i18n is found in a vm context too
  function I18n() { return (root && root.Mucellit && root.Mucellit.i18n) || require('./i18n.js'); }
  function t(a, p) { return I18n().t(a, p); }

  var VERSION = 2;

  // Step templates: key → "step.<key>" in the dictionary.
  var TEMPLATES = {
    sewn: [
      { key: 'prep_pdf' },
      { key: 'test_print' },
      { key: 'printing' },
      { key: 'folding' },
      { key: 'pressing' },
      { key: 'punching' },
      { key: 'sewing' },
      { key: 'spine_gluing' },
      { key: 'spine_rounding', optional: true },
      { key: 'headband_spine_lining' },
      { key: 'board_cutting' },
      { key: 'cover_covering' },
      { key: 'endpaper_pasting' },
      { key: 'in_press_drying' }
    ],
    single: [
      { key: 'prep' },
      { key: 'printing' },
      { key: 'cutting' },
      { key: 'spine_preparing' },
      { key: 'gluing' },
      { key: 'cover' },
      { key: 'in_press_drying' }
    ]
  };

  /** The name of a template step (in the given language; otherwise in the current one). */
  function templateName(key, code) {
    return code ? I18n().tIn(code, 'step.' + key) : t('step.' + key);
  }

  /** The step name shown (see the note above). */
  function stepName(step) {
    if (!step) return '';
    var a = step.template;
    if (typeof a === 'string' && I18n().has('step.' + a)) return templateName(a);
    var old = legacyTemplate(step.name);
    return old ? templateName(old) : String(step.name);
  }

  /** Old record (without keys): Turkish template name → key; otherwise null. */
  function legacyTemplate(name) {
    var found = null;
    Object.keys(TEMPLATES).forEach(function (kind) {
      TEMPLATES[kind].forEach(function (s) { if (!found && templateName(s.key, 'tr') === name) found = s.key; });
    });
    return found;
  }

  function kindName(bindingType) { return t('binding.kind.' + (bindingType === 'single' ? 'single' : 'sewn')); }
  // Backward compatibility: KIND_NAME[kind] in the language current when read.
  var KIND_NAME = {};
  ['sewn', 'single'].forEach(function (k) {
    Object.defineProperty(KIND_NAME, k, { get: function () { return kindName(k); }, enumerable: true });
  });

  var counter = 0;
  function newId(on) {
    counter += 1;
    return (on || 'k') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '-' + counter;
  }

  function emptyData() { return { version: VERSION, projects: [] }; }

  function createSteps(bindingType) {
    var template = TEMPLATES[bindingType];
    if (!template) throw new Error(t('error.binding_type', { kind: bindingType }));
    return template.map(function (a) {
      return { id: newId('a'), name: templateName(a.key), template: a.key, done: false, date: '', note: '', optional: !!a.optional };
    });
  }

  function newProject(fields) {
    fields = fields || {};
    var bindingType = fields.bindingType === 'single' ? 'single' : 'sewn';
    var name = String(fields.name || '').trim();
    if (!name) throw new Error(t('projects.error.book_name_blank'));
    return {
      id: newId('k'),
      name: name,
      bindingType: bindingType,
      bookWidth: Number(fields.bookWidth) || 148,
      bookHeight: Number(fields.bookHeight) || 210,
      paper: String(fields.paper || ''),
      paperThickness: Number(fields.paperThickness) || 0.1,
      pdfName: String(fields.pdfName || ''),
      created: fields.created || new Date().toISOString().slice(0, 10),
      steps: createSteps(bindingType),
      settings: null
    };
  }

  function findProject(data, id) {
    for (var i = 0; i < data.projects.length; i++) if (data.projects[i].id === id) return data.projects[i];
    return null;
  }

  function markStep(book, stepId, done, today) {
    book.steps.forEach(function (a) {
      if (a.id === stepId) {
        a.done = !!done;
        if (a.done && !a.date) a.date = today || new Date().toISOString().slice(0, 10);
      }
    });
    return book;
  }

  function addStep(book, name, order) {
    var clean = String(name || '').trim();
    if (!clean) throw new Error(t('projects.error.step_name_blank'));
    var step = { id: newId('a'), name: clean, done: false, date: '', note: '', optional: false };
    var i = (order === undefined || order === null) ? book.steps.length : Math.max(0, Math.min(book.steps.length, order));
    book.steps.splice(i, 0, step);
    return step;
  }

  function removeStep(book, stepId) {
    book.steps = book.steps.filter(function (a) { return a.id !== stepId; });
    return book;
  }

  function moveStep(book, stepId, direction) {
    var i = book.steps.findIndex(function (a) { return a.id === stepId; });
    var j = i + direction;
    if (i < 0 || j < 0 || j >= book.steps.length) return book;
    var temp = book.steps[i]; book.steps[i] = book.steps[j]; book.steps[j] = temp;
    return book;
  }

  function progress(book) {
    var total = book.steps.length;
    var done = book.steps.filter(function (a) { return a.done; }).length;
    return { done: done, total: total, ratio: total ? done / total : 0 };
  }

  /** Validates imported JSON; throws an explanatory error when it is invalid. */
  function validate(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(t('validate.object'));
    if (data.version !== VERSION) throw new Error(t('validate.version', { version: data.version }));
    if (!Array.isArray(data.projects)) throw new Error(t('validate.no_projects'));
    var idler = Object.create(null);
    data.projects.forEach(function (k, i) {
      var place = t('validate.book_place', { n: i + 1 });
      var h = function (a, p) { return new Error(t(a, Object.assign({ place: place }, p || {}))); };
      if (!k || typeof k !== 'object') throw h('validate.invalid');
      if (typeof k.id !== 'string' || !k.id) throw h('validate.id');
      if (k.id in idler) throw h('validate.id_repeat', { id: k.id });
      idler[k.id] = true;
      if (typeof k.name !== 'string' || !k.name.trim()) throw h('validate.no_name');
      if (k.bindingType !== 'sewn' && k.bindingType !== 'single') throw h('validate.binding_type');
      if (!Array.isArray(k.steps)) throw h('validate.no_steps');
      var stepIds = Object.create(null);
      k.steps.forEach(function (a, j) {
        var ay = t('validate.step_place', { place: place, n: j + 1 });
        var ha = function (an, p) { return new Error(t(an, Object.assign({ place: ay }, p || {}))); };
        if (!a || typeof a.id !== 'string' || typeof a.name !== 'string' || typeof a.done !== 'boolean') {
          throw ha('validate.invalid');
        }
        if (!a.id) throw ha('validate.step_id_blank');
        if (a.id in stepIds) throw ha('validate.step_id_repeat', { id: a.id });
        stepIds[a.id] = true;
        if (a.note !== undefined && typeof a.note !== 'string') throw ha('validate.note_text');
        if (a.date !== undefined && typeof a.date !== 'string') throw ha('validate.date_text');
        if (a.template !== undefined && typeof a.template !== 'string') throw ha('validate.template_text');
      });
      if (k.settings !== undefined && k.settings !== null && (typeof k.settings !== 'object' || Array.isArray(k.settings))) {
        throw h('validate.settings_object');
      }
    });
    return true;
  }

  return {
    VERSION: VERSION,
    TEMPLATES: TEMPLATES,
    KIND_NAME: KIND_NAME,
    kindName: kindName,
    stepName: stepName,
    templateName: templateName,
    emptyData: emptyData,
    newProject: newProject,
    findProject: findProject,
    markStep: markStep,
    addStep: addStep,
    removeStep: removeStep,
    moveStep: moveStep,
    progress: progress,
    validate: validate
  };
});
