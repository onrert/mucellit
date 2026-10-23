/*
 * platform-tauri.js — in a Tauri window, overrides the functions of Mucellit.platform that differ.
 * Does nothing in the browser (no window.__TAURI__). Loaded after platform.js.
 *
 * name, ask (native NSAlert, dialog plug-in), menu events (View ⌘1-3; ⌘4 Learn).
 * Native functions:
 *   pickFile   → Rust open_file (native Open window; folder package EPUB included) + read_file (raw bytes) → File.
 *                JS never sees or passes a path; Rust returns only an id.
 *   save       → Rust save_file (native Save window; the body is raw bytes). Returns false (cancelled) or
 *                { name, path } (written). The browser's <a download> is not used in Tauri.
 *   saveAll / saveMessage → the imposed PDF(s) are saved one by one, the notice follows the real result.
 *   recentFiles / openRecent → Rust recent_files / read_recent_file (bookmark; short-lived access).
 *   File menu (Open ⌘O, Open Recent, Save ⌘S, JSON backup) and files opened from the Dock/Finder
 *   (file-opened event + pending_opens).
 *   ready      → once the page scripts are loaded: when localStorage is empty the project data is restored from the
 *                automatic backup (an empty backup is not restored, no notice); after every storage.write/clear the
 *                data goes to backup_data RIGHT AWAY (session + increasing sequence). The delay (1 s) and the write
 *                on exit are in Rust (src-tauri/src/backup.rs). A backup written by an earlier version is converted
 *                (migrate.js).
 * Recent file errors are told apart (only NOTFOUND/INVALID say "removed"); after a partial save the sides are
 *   counted per file; ⌘S is ignored while the imposed PDF is being prepared/saved (D10, button aria-busy).
 * Texts come from Mucellit.i18n (when they are read); on start-up read_language (the manual choice backed up in Rust
 *   comes back when localStorage is empty) and set_language (so that the menu language matches JS); the
 *   View > Language menu (i18n:<choice>) → changeLanguage.
 * print (Rust print: PDFKit print window, 100%) and openInPreview (Rust open_in_preview); File > Print… ⌘P,
 *   Open in Preview ⌥⌘P (file-print / file-preview → the buttons on the Imposition tab; flow in app/js/printing.js).
 * The system language comes from Rust (read_language.system: NSLocale + the Apple rule; the same source as
 *   "System Language (X)" in the menu; WKWebView's navigator.languages may give only one language). Browser-only texts
 *   (storage hint and warning, "reload the page") get the Mac text; the storage hint changes as soon as the script loads.
 */
(function (root) {
  'use strict';
  var T = root.__TAURI__;
  var MC = root.Mucellit;
  if (!T || !T.core || !MC || !MC.platform) return;
  var P = MC.platform;
  var D = MC.i18n;
  /**
   * Text (in the current language). When i18n.js could not be loaded (no MC.i18n): the plain text from the loaded en
   * dictionary, or the key; so this file does not throw while loading (no extra console error) and the Mac texts stay English.
   */
  function t(a, p) {
    if (D) return D.t(a, p);
    var en = (Array.isArray(root.MucellitDictionaries) ? root.MucellitDictionaries : []).filter(function (s) { return s && s._lang === 'en'; })[0];
    var m = en && Object.prototype.hasOwnProperty.call(en, a) ? en[a] : a;
    if (m && typeof m === 'object') m = m.other;
    m = typeof m === 'string' ? m : a;
    return p ? m.replace(/\{([a-zA-Z0-9_]+)\}/g, function (x, k) { return Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : x; }) : m;
  }
  var KIND_MIME = { pdf: 'application/pdf', epub: 'application/epub+zip', json: 'application/json' };
  // Backup session of this page: Rust ignores an old backup that arrives late from the same session; a new page always writes.
  var BACKUP_SESSION = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

  function invoke(command, arg, options) {
    try { return Promise.resolve(T.core.invoke(command, arg, options)); } catch (e) { return Promise.reject(e); }
  }
  function notify(m, kind) { if (MC.common) MC.common.notify(m, kind); }
  function element(id) { return root.document ? root.document.getElementById(id) : null; }
  function errorText(e) { return String(e && e.message ? e.message : e); }

  P.name = 'tauri';
  P.localFile = true;
  [['libraryHint', 'tauri.library_hint'], ['storageWarning', 'tauri.warning_storage'], ['checkWarning', 'tauri.warning_check']].forEach(function (m) {
    Object.defineProperty(P.text, m[0], {
      get: function () { return t(m[1]); }, enumerable: true, configurable: true
    });
  });
  // The storage hint on the Projects tab: "on this Mac", not "in this browser" (scripts are at the end of the body: the element exists).
  (function () {
    var s = element('storage-hint');
    if (!s || typeof s.setAttribute !== 'function') return;
    s.setAttribute('data-i18n', 'tauri.storage_hint');
    s.textContent = t('tauri.storage_hint');
  })();

  P.ask = function (message) {
    var d = T.dialog;
    var result;
    try {
      result = (d && typeof d.ask === 'function')
        ? d.ask(String(message), { title: t('app.name'), kind: 'warning', okLabel: t('common.done'), cancelLabel: t('common.cancel') })
        : root.confirm(String(message)); // the confirm replaced by the plug-in also returns a Promise<boolean>
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve(result).then(function (ok) { return ok === true; });
  };

  // ---------------------------------------------------------------- opening files
  function makeFile(bytes, name, kind) {
    return new root.File([bytes], String(name), { type: KIND_MIME[kind] || '' });
  }

  /** Native Open window. A JSON backup when extensions contains 'json', otherwise PDF/EPUB. null when cancelled. */
  P.pickFile = function (options) {
    var u = (options && options.extensions) || [];
    var purpose = u.indexOf('json') >= 0 ? 'backup' : 'document';
    return invoke('open_file', { purpose: purpose }).then(function (a) {
      if (!a) return null;
      return invoke('read_file', { id: a.id }).then(function (b) { return makeFile(b, a.name, a.kind); });
    });
  };

  P.recentFiles = function () { return invoke('recent_files').then(function (l) { return Array.isArray(l) ? l : []; }); };

  /** Opens a recent file entry → File. When the entry cannot be read (Rust removes it from the list) it is rejected with a clear error. */
  P.openRecent = function (id) {
    return P.recentFiles().then(function (list) {
      var k = list.filter(function (x) { return x && x.id === id; })[0];
      if (!k) throw new Error(t('recent.none'));
      return invoke('read_recent_file', { id: id }).then(function (b) { return makeFile(b, k.name, k.kind); }, function (e) {
        var m = errorText(e);
        var detail = m.replace(/^[A-Z]+:\s*/, '');
        var p = { name: k.name, detail: detail };
        if (/^NOTFOUND:/.test(m)) throw new Error(t('recent.notFound', p));
        if (/^INVALID:/.test(m)) throw new Error(t('recent.invalid', p));
        if (/^ACCESS:/.test(m)) throw new Error(t('recent.access', p));
        if (/^NODISK:/.test(m)) throw new Error(t('recent.no_disk', p));
        if (/^TRANSIENT:/.test(m)) throw new Error(t('recent.temp', p));
        if (/^UNKNOWN:/.test(m)) throw new Error(t('recent.none'));
        throw new Error(k.name + ': ' + m);
      });
    });
  };

  // ---------------------------------------------------------------- kaydetme
  function toBytes(data) {
    if (typeof data === 'string') return Promise.resolve(new root.TextEncoder().encode(data));
    if (data && ArrayBuffer.isView(data)) return Promise.resolve(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (data && Object.prototype.toString.call(data) === '[object ArrayBuffer]') return Promise.resolve(new Uint8Array(data));
    if (data && typeof data.arrayBuffer === 'function') return data.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return Promise.reject(new Error(t('tauri.data_unrecognized')));
  }

  /** Native Save window. Promise<false | { name, path }>. */
  P.save = function (name, data, mime) {
    var kind = (/json/i.test(mime || '') || /\.json$/i.test(String(name))) ? 'json' : 'pdf';
    return toBytes(data).then(function (b) {
      return invoke('save_file', b, { headers: { 'x-name': encodeURIComponent(String(name)), 'x-kind': kind } });
    }).then(function (s) { return s && s.path ? { name: String(s.name), path: String(s.path) } : false; });
  };

  /**
   * Saves the files ONE BY ONE (a separate Save window for each). When one is cancelled or fails it moves on to the
   * next. Promise<{ saved: [{name, path, side?}], cancelled: [name], failed: [{name, message}] }> (never rejected).
   * When a file has `side` (the number of sides in that file) it is carried over to the saved entry.
   */
  P.saveAll = function (files, mime) {
    var s = { saved: [], cancelled: [], failed: [] };
    return (files || []).reduce(function (chain, d) {
      return chain.then(function () {
        return P.save(d.name, d.bytes, mime).then(function (r) {
          if (r && typeof d.side === 'number' && isFinite(d.side)) r.side = d.side;
          if (r) s.saved.push(r); else s.cancelled.push(d.name);
        }, function (e) { s.failed.push({ name: d.name, message: errorText(e) }); });
      });
    }, Promise.resolve()).then(function () { return s; });
  };

  /**
   * Notice from a saveAll result: { text, kind } (kind 'error' = at least one was not written). Side count: the sum
   * of `side` of the saved files; without per-file info `sideCount` only when all were written (giving the total after
   * a partial save would be wrong, D9).
   */
  P.saveMessage = function (s, sideCount) {
    var number = null;
    var allHaveSides = s.saved.length > 0 && s.saved.every(function (k) { return typeof k.side === 'number' && isFinite(k.side); });
    if (allHaveSides) number = s.saved.reduce(function (top, k) { return top + k.side; }, 0);
    else if (!s.cancelled.length && !s.failed.length && typeof sideCount === 'number' && isFinite(sideCount)) number = sideCount;
    if (!s.saved.length && !s.failed.length) return { text: t('save.pdf_not_saved'), kind: 'error' };
    var part = [];
    if (s.saved.length) {
      var paths = s.saved.map(function (k) { return k.path; }).join(', ');
      part.push(number !== null ? t('save.saved_side', { paths: paths, n: number }) : t('save.saved', { paths: paths }));
    }
    if (s.cancelled.length) part.push(t('save.notSaved', { names: s.cancelled.join(', ') }));
    s.failed.forEach(function (h) { part.push(t('save.saveFailed', { name: h.name, error: h.message })); });
    return { text: part.join(' '), kind: (s.cancelled.length || s.failed.length) ? 'error' : undefined };
  };

  // ---------------------------------------------------------------- printing
  /**
   * Native print window (Rust print: PDFKit, 100% scale, paper = page). The body is the raw PDF bytes, x-name the job name.
   * Promise<boolean>: true = printed (or saved as PDF), false = cancelled; an error is rejected.
   */
  P.print = function (name, data) {
    return toBytes(data).then(function (b) {
      return invoke('print', b, { headers: { 'x-name': encodeURIComponent(String(name)) } });
    }).then(function (r) { return r === true; });
  };

  /** Open in Preview (Rust open_in_preview: writes to the cache, opens with NSWorkspace). Promise<{ name }>; rejected when it cannot open. */
  P.openInPreview = function (name, data) {
    return toBytes(data).then(function (b) {
      return invoke('open_in_preview', b, { headers: { 'x-name': encodeURIComponent(String(name)) } });
    }).then(function (r) { return { name: typeof r === 'string' && r ? r : String(name) }; });
  };

  // ---------------------------------------------------------------- menu and outside opening
  function openDocument(filePromise) {
    return filePromise.then(function (f) {
      if (!f) return;
      if (MC.app) MC.app.openTab('impose');
      return MC.impose && MC.impose.openFile(f);
    }).catch(function (e) { notify(t('impose.file_open_failed', { error: errorText(e) }), 'error'); });
  }

  function click(id, tab) {
    if (tab && MC.app) MC.app.openTab(tab);
    var b = element(id);
    if (b) b.click();
  }

  /** Presses an output button of the Imposition tab (print / Preview) from the menu: ignored while busy, reported when off. */
  function clickOutputButton(id) {
    var b = element(id);
    if (b && typeof b.getAttribute === 'function' && b.getAttribute('aria-busy') === 'true') return;
    if (!b || b.disabled || b.hidden) return notify(t('print.closed'), 'error');
    if (MC.app) MC.app.openTab('impose');
    b.click();
  }

  var TAB_ITEMS = { 'tab-impose': 'impose', 'tab-projects': 'projects', 'tab-calculator': 'calculator', 'tab-learn': 'learn' }; // Learn ⌘4
  var FILE_ITEMS = {
    'file-open': function () { click('pdf-select', 'impose'); },
    'file-save': function () {
      var b = element('export-transfer');
      // D10: the output is being prepared or the Save window is open (impose.exportPdf makes the button aria-busy): ignore.
      if (b && typeof b.getAttribute === 'function' && b.getAttribute('aria-busy') === 'true') return;
      if (!b || b.disabled) return notify(t('save.save_closed'), 'error');
      if (MC.app) MC.app.openTab('impose');
      b.click();
    },
    // Print… ⌘P / Open in Preview ⌥⌘P — ignored while the output is being prepared or a window is open (aria-busy)
    'file-print': function () { clickOutputButton('print'); },
    'file-preview': function () { clickOutputButton('inPreview-open'); },
    'json-export': function () { click('json-export', 'projects'); },
    'json-import': function () { click('json-import-button', 'projects'); }
  };
  var RECENT_PREFIX = 'last:';
  var LANGUAGE_PREFIX = 'i18n:';

  /** Native menu item (src-tauri/src/menu.rs) → interface action. */
  P.onMenu = function (id) {
    if (typeof id !== 'string') return;
    if (Object.prototype.hasOwnProperty.call(TAB_ITEMS, id)) { if (MC.app) MC.app.openTab(TAB_ITEMS[id]); return; }
    if (Object.prototype.hasOwnProperty.call(FILE_ITEMS, id)) { FILE_ITEMS[id](); return; }
    if (id.indexOf(RECENT_PREFIX) === 0) return openDocument(P.openRecent(id.slice(RECENT_PREFIX.length)));
    if (id.indexOf(LANGUAGE_PREFIX) === 0 && MC.app && MC.app.changeLanguage) return MC.app.changeLanguage(id.slice(LANGUAGE_PREFIX.length));
  };

  /** Opens the not yet handled files from the Dock/Finder one by one (the last opened stays on screen). */
  P.openPending = function () {
    return invoke('pending_opens').then(function (l) {
      return (Array.isArray(l) ? l : []).reduce(function (z, a) {
        return z.then(function () {
          return openDocument(invoke('read_file', { id: a.id }).then(function (b) { return makeFile(b, a.name, a.kind); }));
        });
      }, Promise.resolve());
    }).catch(function (e) { notify(t('impose.file_open_failed', { error: errorText(e) }), 'error'); });
  };

  if (T.event && typeof T.event.listen === 'function') {
    T.event.listen('menu', function (on_event) { P.onMenu(on_event && on_event.payload); });
    T.event.listen('file-opened', function () { if (P.isReady) P.openPending(); });
    // The delayed write in Rust failed (src-tauri/src/backup.rs ERROR_EVENT).
    T.event.listen('backup-writeFailed', function (on_event) { notify(t('backup.writeFailed', { error: String(on_event && on_event.payload) }), 'error'); });
  }

  // ---------------------------------------------------------------- automatic backup of the project data
  var backupSeq = 0;
  /** Sends the change to Rust RIGHT AWAY: the delay and the write to disk on exit are in Rust. */
  function sendBackup(data) {
    var j;
    try { j = JSON.stringify(data); } catch (e) { return Promise.resolve(); }
    backupSeq += 1;
    return invoke('backup_data', { json: j, session: BACKUP_SESSION, order: backupSeq })
      .catch(function (e) { notify(t('backup.writeFailed', { error: errorText(e) }), 'error'); });
  }

  /**
   * When there is no project data in localStorage and the backup is valid, writes the backup (converted to the current
   * format when an earlier version wrote it). true: restored. An empty backup (no project at all: deliberately cleared
   * or never filled) is not restored: there is nothing to load and a notice would mislead.
   */
  function restore(json) {
    if (typeof json !== 'string' || !MC.storage) return false;
    var ls;
    try { ls = root.localStorage; if (ls.getItem(MC.storage.KEY) !== null) return false; } catch (e) { return false; }
    try {
      var data = JSON.parse(json);
      if (MC.migrate) data = MC.migrate.projects(data); // backup written by an earlier version
      if (MC.projectModel) MC.projectModel.validate(data);
      if (!data || !Array.isArray(data.projects) || data.projects.length === 0) return false;
      ls.setItem(MC.storage.KEY, JSON.stringify(data));
      return true;
    } catch (e) { return false; }
  }

  function hookStorage() {
    if (!MC.storage || MC.storage.backupHooked) return;
    var originalWrite = MC.storage.write, originalClear = MC.storage.clear;
    MC.storage.write = function (data) { var ok = originalWrite.apply(this, arguments); sendBackup(data); return ok; };
    MC.storage.clear = function () {
      var r = originalClear.apply(this, arguments);
      if (MC.projectModel) sendBackup(MC.projectModel.emptyData());
      return r;
    };
    MC.storage.backupHooked = true;
  }

  function pageLoaded() {
    var d = root.document;
    if (!d || d.readyState !== 'loading') return Promise.resolve();
    return new Promise(function (parse) { d.addEventListener('DOMContentLoaded', function () { parse(); }, { once: true }); });
  }

  // ---------------------------------------------------------------- language
  /** Reports a language change to Rust (menu language + backup of the manual choice). choice: 'system' | code. */
  P.notifyLanguage = function (code, choice) { return invoke('set_language', { code: code, choice: choice }); };

  /**
   * On start-up: when localStorage has no manual choice and Rust has a backed-up one (WebKit data was cleared), it comes
   * back; then the current language is reported to Rust (so the menu is built in the same language as JS). An error
   * does not stop the start-up.
   */
  function syncLanguage() {
    if (!D) return Promise.resolve(); // no language layer; the start-up error is reported in app.js
    return invoke('read_language').then(function (r) {
      if (r && D.isSupported(r.system)) D.setSystemCode(r.system);
      if (!D.readChoice() && r && D.isSupported(r.choice)) D.writeChoice(r.choice);
      var target = D.readChoice() || D.systemCode();
      if (target !== D.code()) {
        D.set(target);
        D.apply(root.document);
      }
    }, function () {}).then(function () {
      return P.notifyLanguage(D.code(), D.readChoice() || 'system').catch(function () {});
    });
  }

  // Runs after all classic scripts (storage.js, impose.js …) are loaded; app.js calls start() after waiting
  // for it. Start-up does not stop when the backup or the language cannot be read.
  P.ready = pageLoaded().then(syncLanguage).then(function () {
    return invoke('read_backup').then(function (json) { return restore(json); }, function () { return false; });
  }).then(function (restored) {
    hookStorage();
    var b = element('export-transfer');
    if (b) { if (typeof b.setAttribute === 'function') b.setAttribute('data-i18n', 'impose.save'); b.textContent = t('impose.save'); }
    P.isReady = true;
    if (restored) setTimeout(function () { notify(t('backup.restored')); }, 0);
    setTimeout(function () { P.openPending(); }, 0);
  });
})(typeof self !== 'undefined' ? self : this);
