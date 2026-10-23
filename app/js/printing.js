/*
 * printing.js — Mac uygulamasında yazdırma ve Önizleme'de Aç akışları. Arayüzden bağımsız:
 * platform (KitapCilt.platform), metin (t) ve bildirim işlevi dışarıdan verilir; birim testleri sahte platformla sınar.
 *
 *   yazdir(dosyalar, ortam)        Tek PDF: baskı penceresi. İki PDF (önler + arkalar, elle çift yüz): önce önler; basıldıysa
 *                                  "desteyi çevirip geri koyun" onayı; onaylanırsa arkalar. Vazgeç/hata nerede olduysa
 *                                  bildirim ona göre (yarıda kaldıysa hangi dosyanın basıldığı söylenir).
 *   onizlemedeAc(dosyalar, ortam)  Her dosya sırayla Önizleme'de açılır. Biri açılamazsa (ör. sandbox) seçenek E:
 *                                  "PDF kaydedilsin mi?" onayı → Kaydet penceresi(leri) + "Önizleme'de basın" notu.
 *
 * ortam: { platform, t(anahtar, p), bildir(metin, tur) }. Dönüş Promise<{ metin, tur }> (tur 'hata' = istenen iş
 * tamamlanmadı); hiç reddedilmez. dosyalar: cikti.uret'in dosyaları ([{ ad, bytes, yuz }], ikili modda [önler, arkalar]).
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};

  function errorText(e) { return String(e && e.message ? e.message : e); }

  /** Baskı penceresinden önce gösterilen not (çift yüz ayarı = araçtaki seçim; ölçek %100). */
  /**
   * Baskı öncesi not. cevirme: araçtaki seçim değeri ('kisa' | 'uzun'). seçenek macOS baskı
   * penceresinin kendi adıyla söylenir (ana pencere: Çift Taraflı → Açık / Açık (Kısa Kenar); Düzen bölümü: Uzun/Kısa
   * Kenardan Ciltli — PrintingPrivate loctable'ları, printing.test.js), araçtaki ad ayrıca anılır.
   */
  function note(env, pair, duplex) {
    var t = env.t, short = duplex === 'short';
    var p = { double: t('print.panel.double'), double_layout: t('print.panel.double_layout'), closed: t('print.panel.closed') };
    if (pair) return t('print.note_two_up', p);
    p.options = t(short ? 'print.panel.short' : 'print.panel.long');
    p.layout = t(short ? 'print.panel.short_layout' : 'print.panel.long_layout');
    p.duplex = t(short ? 'impose.duplex.short' : 'impose.duplex.long');
    return t('print.not_tek', p);
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
      return { text: t('preview.opened', { names: opened.join(t('app.ve')) }) };
    }, function (e) {
      var error = errorText(e);
      // Seçenek E: açılamadı → Kaydet + "Önizleme'de basın" notu (açılabilenler zaten açık kalır)
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
