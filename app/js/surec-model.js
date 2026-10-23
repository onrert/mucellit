/*
 * surec-model.js — süreç (kitap/proje) veri modeli, DOM'suz saf modül
 * (KitapCilt.surecModel / module.exports).
 *
 * Veri biçimi (JSON yedeğiyle aynı):
 * { surum: 1, kitaplar: [ { id, ad, ciltTuru: 'formali'|'tek', kitapGen, kitapYuk,
 *   kagit, kagitKalinlik, pdfAdi, olusturma, adimlar: [ { id, ad, tamam, tarih, not, istegeBagli, sablon? } ],
 *   ayar: null | { ...Düzenle sekmesi ayarları } } ] }
 * PDF dosyasının kendisi saklanmaz; yalnız adı.
 *
 * (dil): şablondan gelen adımın `sablon` anahtarı vardır (ör. "dikis"); `ad` oluşturulduğu andaki dilde yazılır
 * (eski sürümler ve JSON yedeği için). Görünen ad `adimAdi(adim)`: şablon anahtarı varsa o anki dilde; eski
 * (öncesi, anahtarsız) kayıtta ad bir Türkçe şablon adıyla birebir aynıysa yine o anki dilde; değilse (kullanıcının
 * eklediği adım) olduğu gibi. Eski kayıt değiştirilmez (geçiş yazmadan, okurken).
 */
(function (kok, fabrika) {
  var m = fabrika();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    kok.KitapCilt = kok.KitapCilt || {};
    kok.KitapCilt.surecModel = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var kok = typeof self !== 'undefined' ? self : globalThis; // vm bağlamında da KitapCilt.dil bulunur
  function Dil() { return (kok && kok.KitapCilt && kok.KitapCilt.dil) || require('./dil.js'); }
  function t(a, p) { return Dil().t(a, p); }

  var SURUM = 1;

  // Adım şablonları: anahtar → sözlükte "adim.<anahtar>".
  var SABLONLAR = {
    formali: [
      { anahtar: 'hazirlik_pdf' },
      { anahtar: 'test_baskisi' },
      { anahtar: 'baski' },
      { anahtar: 'katlama' },
      { anahtar: 'presleme' },
      { anahtar: 'delme' },
      { anahtar: 'dikis' },
      { anahtar: 'sirt_tutkallama' },
      { anahtar: 'sirt_yuvarlatma', istegeBagli: true },
      { anahtar: 'kapital_sirt_bezi' },
      { anahtar: 'mukavva_kesimi' },
      { anahtar: 'kapak_kaplama' },
      { anahtar: 'forza_yapistirma' },
      { anahtar: 'preste_kurutma' }
    ],
    tek: [
      { anahtar: 'hazirlik' },
      { anahtar: 'baski' },
      { anahtar: 'kesim' },
      { anahtar: 'sirt_hazirlama' },
      { anahtar: 'tutkallama' },
      { anahtar: 'kapak' },
      { anahtar: 'preste_kurutma' }
    ]
  };

  /** Bir şablon adımının adı (verilen dilde; yoksa o anki dilde). */
  function sablonAdi(anahtar, kod) {
    return kod ? Dil().tDilde(kod, 'adim.' + anahtar) : t('adim.' + anahtar);
  }

  /** Görünen adım adı (bkz. üstteki notu). */
  function adimAdi(adim) {
    if (!adim) return '';
    var a = adim.sablon;
    if (typeof a === 'string' && Dil().var('adim.' + a)) return sablonAdi(a);
    var eski = eskiSablon(adim.ad);
    return eski ? sablonAdi(eski) : String(adim.ad);
  }

  /** Eski (anahtarsız) kayıt: Türkçe şablon adı → anahtar; değilse null. */
  function eskiSablon(ad) {
    var bulunan = null;
    Object.keys(SABLONLAR).forEach(function (tur) {
      SABLONLAR[tur].forEach(function (s) { if (!bulunan && sablonAdi(s.anahtar, 'tr') === ad) bulunan = s.anahtar; });
    });
    return bulunan;
  }

  function turAdi(ciltTuru) { return t('cilt.tur.' + (ciltTuru === 'tek' ? 'tek' : 'formali')); }
  // Geriye uyum: TUR_ADI[tur] okunduğu andaki dilde.
  var TUR_ADI = {};
  ['formali', 'tek'].forEach(function (k) {
    Object.defineProperty(TUR_ADI, k, { get: function () { return turAdi(k); }, enumerable: true });
  });

  var sayac = 0;
  function yeniId(on) {
    sayac += 1;
    return (on || 'k') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '-' + sayac;
  }

  function bosVeri() { return { surum: SURUM, kitaplar: [] }; }

  function adimlarOlustur(ciltTuru) {
    var sablon = SABLONLAR[ciltTuru];
    if (!sablon) throw new Error(t('hata.cilt_turu', { tur: ciltTuru }));
    return sablon.map(function (a) {
      return { id: yeniId('a'), ad: sablonAdi(a.anahtar), sablon: a.anahtar, tamam: false, tarih: '', not: '', istegeBagli: !!a.istegeBagli };
    });
  }

  function yeniKitap(alanlar) {
    alanlar = alanlar || {};
    var ciltTuru = alanlar.ciltTuru === 'tek' ? 'tek' : 'formali';
    var ad = String(alanlar.ad || '').trim();
    if (!ad) throw new Error(t('surec.hata.kitap_adi_bos'));
    return {
      id: yeniId('k'),
      ad: ad,
      ciltTuru: ciltTuru,
      kitapGen: Number(alanlar.kitapGen) || 148,
      kitapYuk: Number(alanlar.kitapYuk) || 210,
      kagit: String(alanlar.kagit || ''),
      kagitKalinlik: Number(alanlar.kagitKalinlik) || 0.1,
      pdfAdi: String(alanlar.pdfAdi || ''),
      olusturma: alanlar.olusturma || new Date().toISOString().slice(0, 10),
      adimlar: adimlarOlustur(ciltTuru),
      ayar: null
    };
  }

  function kitapBul(veri, id) {
    for (var i = 0; i < veri.kitaplar.length; i++) if (veri.kitaplar[i].id === id) return veri.kitaplar[i];
    return null;
  }

  function adimIsaretle(kitap, adimId, tamam, bugun) {
    kitap.adimlar.forEach(function (a) {
      if (a.id === adimId) {
        a.tamam = !!tamam;
        if (a.tamam && !a.tarih) a.tarih = bugun || new Date().toISOString().slice(0, 10);
      }
    });
    return kitap;
  }

  function adimEkle(kitap, ad, sira) {
    var temiz = String(ad || '').trim();
    if (!temiz) throw new Error(t('surec.hata.adim_adi_bos'));
    var adim = { id: yeniId('a'), ad: temiz, tamam: false, tarih: '', not: '', istegeBagli: false };
    var i = (sira === undefined || sira === null) ? kitap.adimlar.length : Math.max(0, Math.min(kitap.adimlar.length, sira));
    kitap.adimlar.splice(i, 0, adim);
    return adim;
  }

  function adimSil(kitap, adimId) {
    kitap.adimlar = kitap.adimlar.filter(function (a) { return a.id !== adimId; });
    return kitap;
  }

  function adimTasi(kitap, adimId, yon) {
    var i = kitap.adimlar.findIndex(function (a) { return a.id === adimId; });
    var j = i + yon;
    if (i < 0 || j < 0 || j >= kitap.adimlar.length) return kitap;
    var gecici = kitap.adimlar[i]; kitap.adimlar[i] = kitap.adimlar[j]; kitap.adimlar[j] = gecici;
    return kitap;
  }

  function ilerleme(kitap) {
    var toplam = kitap.adimlar.length;
    var biten = kitap.adimlar.filter(function (a) { return a.tamam; }).length;
    return { biten: biten, toplam: toplam, oran: toplam ? biten / toplam : 0 };
  }

  /** İçe aktarılan JSON'u doğrular; geçersizse açıklamalı hata atar. */
  function dogrula(veri) {
    if (!veri || typeof veri !== 'object' || Array.isArray(veri)) throw new Error(t('dogrula.nesne'));
    if (veri.surum !== SURUM) throw new Error(t('dogrula.surum', { surum: veri.surum }));
    if (!Array.isArray(veri.kitaplar)) throw new Error(t('dogrula.kitaplar_yok'));
    var idler = Object.create(null);
    veri.kitaplar.forEach(function (k, i) {
      var yer = t('dogrula.kitap_yeri', { n: i + 1 });
      var h = function (a, p) { return new Error(t(a, Object.assign({ yer: yer }, p || {}))); };
      if (!k || typeof k !== 'object') throw h('dogrula.gecersiz');
      if (typeof k.id !== 'string' || !k.id) throw h('dogrula.id_yok');
      if (k.id in idler) throw h('dogrula.id_tekrar', { id: k.id });
      idler[k.id] = true;
      if (typeof k.ad !== 'string' || !k.ad.trim()) throw h('dogrula.ad_yok');
      if (k.ciltTuru !== 'formali' && k.ciltTuru !== 'tek') throw h('dogrula.cilt_turu');
      if (!Array.isArray(k.adimlar)) throw h('dogrula.adimlar_yok');
      var adimIdleri = Object.create(null);
      k.adimlar.forEach(function (a, j) {
        var ay = t('dogrula.adim_yeri', { yer: yer, n: j + 1 });
        var ha = function (an, p) { return new Error(t(an, Object.assign({ yer: ay }, p || {}))); };
        if (!a || typeof a.id !== 'string' || typeof a.ad !== 'string' || typeof a.tamam !== 'boolean') {
          throw ha('dogrula.gecersiz');
        }
        if (!a.id) throw ha('dogrula.adim_id_bos');
        if (a.id in adimIdleri) throw ha('dogrula.adim_id_tekrar', { id: a.id });
        adimIdleri[a.id] = true;
        if (a.not !== undefined && typeof a.not !== 'string') throw ha('dogrula.not_metin');
        if (a.tarih !== undefined && typeof a.tarih !== 'string') throw ha('dogrula.tarih_metin');
        if (a.sablon !== undefined && typeof a.sablon !== 'string') throw ha('dogrula.sablon_metin');
      });
      if (k.ayar !== undefined && k.ayar !== null && (typeof k.ayar !== 'object' || Array.isArray(k.ayar))) {
        throw h('dogrula.ayar_nesne');
      }
    });
    return true;
  }

  return {
    SURUM: SURUM,
    SABLONLAR: SABLONLAR,
    TUR_ADI: TUR_ADI,
    turAdi: turAdi,
    adimAdi: adimAdi,
    sablonAdi: sablonAdi,
    bosVeri: bosVeri,
    yeniKitap: yeniKitap,
    kitapBul: kitapBul,
    adimIsaretle: adimIsaretle,
    adimEkle: adimEkle,
    adimSil: adimSil,
    adimTasi: adimTasi,
    ilerleme: ilerleme,
    dogrula: dogrula
  };
});
