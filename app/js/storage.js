/*
 * storage.js — keeps the project data in the browser (localStorage, inside try/catch).
 * When storage is unavailable (private window, blocked site data) the data stays in memory for this session only and
 * the user is warned; the JSON backup always works.
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  var KEY = 'mucellit.projects';
  var memory = null;
  var persistent = true;

  var corruptRecord = false;

  function memoryCopy() { return JSON.parse(JSON.stringify(memory)); }

  function read() {
    // If the last persistent write failed (quota full, storage off), the record in localStorage is OUT OF DATE;
    // the newest data is in memory.
    if (!persistent && memory) return memoryCopy();
    var raw;
    try {
      raw = root.localStorage.getItem(KEY);
    } catch {
      persistent = false;
      return memory ? JSON.parse(JSON.stringify(memory)) : MC.projectModel.emptyData();
    }
    if (!raw) return memory ? JSON.parse(JSON.stringify(memory)) : MC.projectModel.emptyData();
    try {
      var data = JSON.parse(raw);
      if (MC.migrate) data = MC.migrate.projects(data); // data saved by an earlier version
      MC.projectModel.validate(data);
      return data;
    } catch {
      // Corrupt record: before it is overwritten it is backed up under a separate key and the user is warned.
      corruptRecord = true;
      try { root.localStorage.setItem(KEY + '.corrupt', raw); } catch { /* no room */ }
      return MC.projectModel.emptyData();
    }
  }

  function write(data) {
    memory = JSON.parse(JSON.stringify(data));
    try {
      root.localStorage.setItem(KEY, JSON.stringify(data));
      persistent = true;
      corruptRecord = false; // the successful write overwrote the corrupt record; the warning no longer applies
      return true;
    } catch {
      persistent = false;
      return false;
    }
  }

  function clear() {
    // Memory becomes EMPTY data (not null): if removeItem fails, read() must not return the old record in localStorage.
    memory = MC.projectModel.emptyData();
    corruptRecord = false;
    try { root.localStorage.removeItem(KEY); persistent = true; } catch { persistent = false; /* could not remove: memory is valid */ }
  }

  MC.storage = { read: read, write: write, clear: clear, isPersistent: function () { return persistent; }, isCorrupt: function () { return corruptRecord; }, KEY: KEY };
})(typeof self !== 'undefined' ? self : this);
