/*
 * yazdirma.js — Mac uygulamasında yazdırma ve Önizleme'de Aç akışları. Arayüzden bağımsız:
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
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};

  function hataMetni(e) { return String(e && e.message ? e.message : e); }

  /** Baskı penceresinden önce gösterilen not (çift yüz ayarı = araçtaki seçim; ölçek %100). */
  /**
   * Baskı öncesi not. cevirme: araçtaki seçim değeri ('kisa' | 'uzun'). seçenek macOS baskı
   * penceresinin kendi adıyla söylenir (ana pencere: Çift Taraflı → Açık / Açık (Kısa Kenar); Düzen bölümü: Uzun/Kısa
   * Kenardan Ciltli — PrintingPrivate loctable'ları, yazdirma.test.js), araçtaki ad ayrıca anılır.
   */
  function not(ortam, ikili, cevirme) {
    var t = ortam.t, kisa = cevirme === 'kisa';
    var p = { cift: t('yazdir.panel.cift'), cift_duzen: t('yazdir.panel.cift_duzen'), kapali: t('yazdir.panel.kapali') };
    if (ikili) return t('yazdir.not_ikili', p);
    p.secenek = t(kisa ? 'yazdir.panel.kisa' : 'yazdir.panel.uzun');
    p.duzen = t(kisa ? 'yazdir.panel.kisa_duzen' : 'yazdir.panel.uzun_duzen');
    p.cevirme = t(kisa ? 'duzenle.cevirme.kisa' : 'duzenle.cevirme.uzun');
    return t('yazdir.not_tek', p);
  }

  function yazdir(dosyalar, ortam) {
    var P = ortam.platform, t = ortam.t;
    var l = dosyalar || [];
    if (!P || typeof P.yazdir !== 'function') return Promise.resolve({ metin: t('rust.yazdirma_yok'), tur: 'hata' });
    if (l.length === 1) {
      var d = l[0];
      return Promise.resolve().then(function () { return P.yazdir(d.ad, d.bytes); }).then(function (ok) {
        return ok ? { metin: t('yazdir.gonderildi', { ad: d.ad }) } : { metin: t('yazdir.vazgecildi'), tur: 'hata' };
      }, function (e) { return { metin: t('yazdir.hata', { ad: d.ad, hata: hataMetni(e) }), tur: 'hata' }; });
    }
    var on = l[0], arka = l[1];
    var p = { onler: on.ad, arkalar: arka.ad };
    return Promise.resolve().then(function () { return P.yazdir(on.ad, on.bytes); }).then(function (ok) {
      if (!ok) return { metin: t('yazdir.vazgecildi'), tur: 'hata' };
      return P.onayla(t('yazdir.cevir_onay', p)).then(function (devam) {
        if (!devam) return { metin: t('yazdir.yarida', p), tur: 'hata' };
        return Promise.resolve().then(function () { return P.yazdir(arka.ad, arka.bytes); }).then(function (ok2) {
          return ok2 ? { metin: t('yazdir.iki_gonderildi', p) } : { metin: t('yazdir.yarida', p), tur: 'hata' };
        }, function (e) { return { metin: t('yazdir.yarida_hata', { onler: on.ad, ad: arka.ad, hata: hataMetni(e) }), tur: 'hata' }; });
      }, function (e) { return { metin: t('yazdir.yarida_hata', { onler: on.ad, ad: arka.ad, hata: hataMetni(e) }), tur: 'hata' }; });
    }, function (e) { return { metin: t('yazdir.hata', { ad: on.ad, hata: hataMetni(e) }), tur: 'hata' }; });
  }

  function onizlemedeAc(dosyalar, ortam) {
    var P = ortam.platform, t = ortam.t;
    var l = dosyalar || [];
    if (!P || typeof P.onizlemedeAc !== 'function') return Promise.resolve({ metin: t('rust.yazdirma_yok'), tur: 'hata' });
    var acilan = [];
    return l.reduce(function (z, d) {
      return z.then(function () { return P.onizlemedeAc(d.ad, d.bytes).then(function (r) { acilan.push((r && r.ad) || d.ad); }); });
    }, Promise.resolve()).then(function () {
      return { metin: t('onizleme.acildi', { adlar: acilan.join(t('uygulama.ve')) }) };
    }, function (e) {
      var hata = hataMetni(e);
      // Seçenek E: açılamadı → Kaydet + "Önizleme'de basın" notu (açılabilenler zaten açık kalır)
      return P.onayla(t('onizleme.acilamadi_kaydet', { hata: hata })).then(function (kaydet) {
        if (!kaydet || typeof P.hepsiniKaydet !== 'function') return { metin: t('onizleme.acilamadi', { hata: hata }), tur: 'hata' };
        return P.hepsiniKaydet(l, 'application/pdf').then(function (s) {
          var m = P.kayitMesaji(s);
          return { metin: s.kaydedilen.length ? m.metin + ' ' + t('onizleme.kaydet_not') : m.metin, tur: m.tur };
        });
      }, function () { return { metin: t('onizleme.acilamadi', { hata: hata }), tur: 'hata' }; });
    });
  }

  KC.yazdirma = { yazdir: yazdir, onizlemedeAc: onizlemedeAc, not: not };
  if (typeof module === 'object' && module.exports) module.exports = KC.yazdirma;
})(typeof self !== 'undefined' ? self : this);
