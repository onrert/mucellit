/*
 * platform.js — environment differences in one place.
 * This file is the BROWSER app and keeps today's behaviour exactly: file choice through a hidden
 * <input type=file>, saving through <a download>, confirmation through window.confirm. In a Tauri window
 * platform-tauri.js (loaded after this file) overrides only the functions that differ.
 *
 * Contract (Mucellit.platform):
 *   name                   'browser' | 'tauri'
 *   ready                  Promise<void>; app.js starts after waiting for it
 *   pickFile({ input, extensions, mime })  Promise<File|null>
 *                          In the browser it opens the hidden input and returns null: the chosen file arrives through
 *                          the input's own `change` event (setInputFiles in e2e uses the same path).
 *                          null = "nothing for the caller to do". The native dialog returns a File.
 *   save(name, data, mime) Promise<true | false | { name, path }>; data Blob | Uint8Array | string.
 *                          Always true in the browser (the download started; its outcome is unknown). The native Save
 *                          window (Tauri): false = cancelled, { name, path } = written.
 *   localFile              false; true in Tauri: Open/Save through native windows, the save result is real
 *                          (impose.js saves the imposed PDFs one by one and writes the notice from the result)
 *   recentFiles()          Promise<[{ id, name, kind, date }]>; empty in the browser (bookmarks are in Tauri)
 *   openRecent(id)         Promise<File|null>; null in the browser
 *   ask(message)           Promise<boolean>; NEVER rely on a synchronous confirm result (see below)
 *   print                  null (no native printing in the browser). Tauri: print(name, data) → Promise<boolean>
 *                          (true = printed/saved as PDF, false = cancelled); the Print button exists only when it is set
 *   openInPreview          null; Tauri: openInPreview(name, data) → Promise<{ name }> (rejected when it cannot open)
 *   fullVersion()          Promise<boolean>; true in the browser
 *   text                   user texts that depend on the environment (in the current language when read; Mucellit.i18n)
 *
 * Note on confirmation: Tauri's dialog plug-in replaces window.confirm with a function returning a Promise; since a
 * Promise object is truthy, the `if (!confirm(...)) return;` pattern deletes without confirmation. So the result of
 * ask() is always awaited through Promise.resolve: a synchronous true/false and the plug-in's Promise<boolean> both
 * give the right answer.
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  var D = MC.i18n;

  function pickFile(options) {
    var input = options && options.input;
    if (input && typeof input.click === 'function') input.click();
    return Promise.resolve(null);
  }

  function save(name, data, mime) {
    try {
      var blob = (typeof Blob !== 'undefined' && data instanceof Blob) ? data : new Blob([data], { type: mime || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
      return Promise.resolve(true);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function ask(message) {
    var result;
    try { result = root.confirm(String(message)); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(result).then(function (ok) { return ok === true; });
  }

  MC.platform = {
    name: 'browser',
    ready: Promise.resolve(),
    pickFile: pickFile,
    save: save,
    ask: ask,
    print: null,
    openInPreview: null,
    localFile: false,
    recentFiles: function () { return Promise.resolve([]); },
    openRecent: function () { return Promise.resolve(null); },
    fullVersion: function () { return Promise.resolve(true); },
    text: {}
  };
  // Texts that depend on the environment, in the language current when read (platform-tauri.js overrides them with Mac texts).
  //   libraryHint:    end of the "library could not be loaded" notice in app.js
  //   storageWarning: projects.js, storage unavailable/full warning
  //   checkWarning:   impose.js, warning that the encryption/restriction state could not be checked
  [['libraryHint', 'app.library_hint'], ['storageWarning', 'projects.warning.storage'], ['checkWarning', 'impose.warning.check']].forEach(function (m) {
    Object.defineProperty(MC.platform.text, m[0], {
      get: function () { return D.t(m[1]); }, enumerable: true, configurable: true
    });
  });
})(typeof self !== 'undefined' ? self : this);
