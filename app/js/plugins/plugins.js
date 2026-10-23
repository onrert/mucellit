/*
 * plugins.js — plug-in point for input converters.
 *
 * The core reads only PDF. Other formats (e.g. EPUB) register as an
 * "input converter": it takes the file and returns PDF bytes.
 * This file has no converter itself; only the interface.
 *
 * A plug-in file (e.g. js/plugins/epub.js) is added to index.html AFTER this
 * file as a classic <script> and calls:
 *
 *   Mucellit.plugins.register({
 *     name: 'EPUB → PDF',
 *     extensions: ['.epub'],                // lower case, with the dot
 *     mime: ['application/epub+zip'],       // optional
 *     settingsUi: function (container) { ... },  // optional: adds its own fields to the Imposition > settings panel
 *     reset: function () { ... },           // optional: called by the core when a new file starts loading;
 *                                           // the plug-in clears the warnings left from the previous conversion
 *     convert: async function (file, options) {
 *       // file: File
 *       // options: { bookWidth, bookHeight, gutter, outerMargin } (mm; from Imposition > Sizes)
 *       //          progress(text): reports an intermediate state to the user
 *       //          isCurrent(): false when another file was chosen after this request (the result is dropped; do
 *       //          not write stale warnings)
 *       // Suggested page size: (bookWidth − gutter − outerMargin) × (bookHeight − 2·outerMargin); the core places
 *       // a page of this size in the content box without scaling and puts the gutter on the right side.
 *       // ...
 *       return pdfBytes; // Uint8Array
 *     }
 *   });
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  var converters = [];
  function t(a, p) { return MC.i18n.t(a, p); }

  function register(d) {
    if (!d || typeof d.name !== 'string' || !d.name) throw new Error(t('plugin.no_name'));
    if (!Array.isArray(d.extensions) || !d.extensions.length) throw new Error(t('plugin.no_extension'));
    if (typeof d.convert !== 'function') throw new Error(t('plugin.no_convert'));
    converters.push({
      name: d.name,
      extensions: d.extensions.map(function (u) { return String(u).toLowerCase(); }),
      mime: Array.isArray(d.mime) ? d.mime.slice() : [],
      settingsUi: typeof d.settingsUi === 'function' ? d.settingsUi : null,
      reset: typeof d.reset === 'function' ? d.reset : null,
      convert: d.convert
    });
  }

  function find(file) {
    var name = String((file && file.name) || '').toLowerCase();
    var type = (file && file.type) || '';
    for (var i = 0; i < converters.length; i++) {
      var d = converters[i];
      if (d.mime.indexOf(type) >= 0) return d;
      for (var j = 0; j < d.extensions.length; j++) {
        if (name.slice(-d.extensions[j].length) === d.extensions[j]) return d;
      }
    }
    return null;
  }

  /** The accept value of the file input: PDF + the registered extensions. */
  function accept() {
    var l = ['.pdf', 'application/pdf'];
    converters.forEach(function (d) { l = l.concat(d.extensions, d.mime); });
    return l.join(',');
  }

  /** Sets up the fields of every plug-in with a settings interface in the container element. One plug-in's error does not stop the others. */
  function setupInterfaces(container) {
    if (!container) return;
    converters.forEach(function (d) {
      if (!d.settingsUi) return;
      try { d.settingsUi(container); } catch (e) {
        var p = container.ownerDocument.createElement('p');
        p.className = 'warning';
        p.textContent = t('plugin.setup_failed', { name: d.name, error: e && e.message ? e.message : e });
        container.appendChild(p);
      }
    });
  }

  /** When a new file starts loading: clears every plug-in's warning left from the previous conversion. */
  function resetAll() {
    converters.forEach(function (d) { if (d.reset) { try { d.reset(); } catch (e) { /* one plug-in does not stop the others */ } } });
  }

  MC.plugins = {
    register: register,
    resetAll: resetAll,
    find: find,
    accept: accept,
    setupInterfaces: setupInterfaces,
    list: function () { return converters.map(function (d) { return d.name; }); }
  };
})(typeof self !== 'undefined' ? self : this);
