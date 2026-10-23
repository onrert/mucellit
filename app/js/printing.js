/*
 * printing.js — the Print and Open in Preview flows of the Mac app. Independent of the interface:
 * platform (Mucellit.platform), text (t) and the notice function are passed in; unit tests use a fake platform.
 *
 *   print(files, env)              One PDF: the print window. Two PDFs (fronts + backs, manual duplex): fronts first;
 *                                  when printed, the "flip the stack and put it back" confirmation; when confirmed, the
 *                                  backs. The notice matches wherever a cancel/error happened (when it stopped halfway
 *                                  it says which file was printed).
 *   openInPreview(files, env)      Every file is opened in Preview in turn. When one cannot be opened (e.g. sandbox),
 *                                  option E: "Save the PDF instead?" confirmation → Save window(s) + "print from
 *                                  Preview" note.
 *
 * env: { platform, t(key, p), notify(text, kind) }. Returns Promise<{ text, kind }> (kind 'error' = the requested job
 * did not finish); never rejected. files: the files of output.build ([{ name, bytes, side }], [fronts, backs] in pair mode).
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};

  function errorText(e) { return String(e && e.message ? e.message : e); }

  /** The note shown before the print window (duplex setting = the choice in the tool; scale 100%). */
  /**
   * Note before printing. duplex: the value chosen in the tool ('short' | 'long'). The option is given with the macOS
   * print window's own names (main window: Two-Sided → On / On (Short Edge); Layout section: Long-/Short-Edge
   * binding — the PrintingPrivate loctables, printing.test.js); the name in the tool is mentioned as well.
   */
  function note(env, pair, duplex) {
    var t = env.t, short = duplex === 'short';
    var p = { double: t('print.panel.double'), double_layout: t('print.panel.double_layout'), closed: t('print.panel.closed') };
    if (pair) return t('print.note_two_up', p);
    p.options = t(short ? 'print.panel.short' : 'print.panel.long');
    p.layout = t(short ? 'print.panel.short_layout' : 'print.panel.long_layout');
    p.duplex = t(short ? 'impose.duplex.short' : 'impose.duplex.long');
    return t('print.note_single', p);
  }

  function print(files, env) {
    var P = env.platform, t = env.t;
    var l = files || [];
    if (!P || typeof P.print !== 'function') return Promise.resolve({ text: t('rust.no_printing'), kind: 'error' });
    if (l.length === 1) {
      var d = l[0];
      return Promise.resolve().then(function () { return P.print(d.name, d.bytes); }).then(function (ok) {
        return ok ? { text: t('print.sent', { name: d.name }) } : { text: t('print.cancelled'), kind: 'error' };
      }, function (e) { return { text: t('print.error', { name: d.name, error: errorText(e) }), kind: 'error' }; });
    }
    var on = l[0], back = l[1];
    var p = { fronts: on.name, backs: back.name };
    return Promise.resolve().then(function () { return P.print(on.name, on.bytes); }).then(function (ok) {
      if (!ok) return { text: t('print.cancelled'), kind: 'error' };
      return P.ask(t('print.flip_confirm', p)).then(function (resume) {
        if (!resume) return { text: t('print.halfway', p), kind: 'error' };
        return Promise.resolve().then(function () { return P.print(back.name, back.bytes); }).then(function (ok2) {
          return ok2 ? { text: t('print.two_sent', p) } : { text: t('print.halfway', p), kind: 'error' };
        }, function (e) { return { text: t('print.halfway_error', { fronts: on.name, name: back.name, error: errorText(e) }), kind: 'error' }; });
      }, function (e) { return { text: t('print.halfway_error', { fronts: on.name, name: back.name, error: errorText(e) }), kind: 'error' }; });
    }, function (e) { return { text: t('print.error', { name: on.name, error: errorText(e) }), kind: 'error' }; });
  }

  function openInPreview(files, env) {
    var P = env.platform, t = env.t;
    var l = files || [];
    if (!P || typeof P.openInPreview !== 'function') return Promise.resolve({ text: t('rust.no_printing'), kind: 'error' });
    var opened = [];
    return l.reduce(function (z, d) {
      return z.then(function () { return P.openInPreview(d.name, d.bytes).then(function (r) { opened.push((r && r.name) || d.name); }); });
    }, Promise.resolve()).then(function () {
      return { text: t('preview.opened', { names: opened.join(t('app.and')) }) };
    }, function (e) {
      var error = errorText(e);
      // Option E: could not open → Save + "print from Preview" note (the ones that opened stay open)
      return P.ask(t('preview.save_open_failed', { error: error })).then(function (save) {
        if (!save || typeof P.saveAll !== 'function') return { text: t('preview.openFailed', { error: error }), kind: 'error' };
        return P.saveAll(l, 'application/pdf').then(function (s) {
          var m = P.saveMessage(s);
          return { text: s.saved.length ? m.text + ' ' + t('preview.save_note') : m.text, kind: m.kind };
        });
      }, function () { return { text: t('preview.openFailed', { error: error }), kind: 'error' }; });
    });
  }

  MC.printing = { print: print, openInPreview: openInPreview, note: note };
  if (typeof module === 'object' && module.exports) module.exports = MC.printing;
})(typeof self !== 'undefined' ? self : this);
