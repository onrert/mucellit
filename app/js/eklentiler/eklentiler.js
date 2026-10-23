/*
 * eklentiler.js — girdi dönüştürücü eklenti noktası.
 *
 * Çekirdek yalnız PDF okur. Başka biçimler (ör. EPUB) bir
 * "girdi dönüştürücü" olarak kaydolur: dosyayı alır, PDF bytes döner.
 * Bu dosyada hiçbir dönüştürücü yoktur; yalnız arayüz vardır.
 *
 * Bir eklenti dosyası (ör. js/eklentiler/epub.js) index.html'de bu dosyadan
 * SONRA klasik <script> olarak eklenir ve şunu çağırır:
 *
 *   KitapCilt.eklentiler.kaydet({
 *     ad: 'EPUB → PDF',
 *     uzantilar: ['.epub'],                 // küçük harf, noktalı
 *     mime: ['application/epub+zip'],       // isteğe bağlı
 *     ayarArayuzu: function (kap) { ... },  // isteğe bağlı: Düzenle > ayarlar paneline kendi alanlarını ekler
 *     sifirla: function () { ... },         // isteğe bağlı: yeni bir dosya yüklenmeye başlarken çekirdek çağırır;
 *                                           // eklenti önceki dönüşümden kalan uyarılarını temizler
 *     donustur: async function (dosya, secenek) {
 *       // dosya: File
 *       // secenek: { kitapGen, kitapYuk, ciltPayi, disKenar } (mm; Düzenle > Ölçüler'den)
 *       //          ilerleme(metin): kullanıcıya ara durum bildirir
 *       //          guncelMi(): bu istekten sonra başka dosya seçildiyse false (sonuç atılacak; bayat uyarı yazmayın)
 *       // Sayfa ölçüsü önerisi: (kitapGen − ciltPayi − disKenar) × (kitapYuk − 2·disKenar); çekirdek
 *       // bu ölçüdeki sayfayı içerik kutusuna ölçeklemeden yerleştirir, cilt payını doğru tarafa koyar.
 *       // ...
 *       return pdfBytes; // Uint8Array
 *     }
 *   });
 */
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};
  var donusturuculer = [];
  function t(a, p) { return KC.dil.t(a, p); }

  function kaydet(d) {
    if (!d || typeof d.ad !== 'string' || !d.ad) throw new Error(t('eklenti.ad_yok'));
    if (!Array.isArray(d.uzantilar) || !d.uzantilar.length) throw new Error(t('eklenti.uzanti_yok'));
    if (typeof d.donustur !== 'function') throw new Error(t('eklenti.donustur_yok'));
    donusturuculer.push({
      ad: d.ad,
      uzantilar: d.uzantilar.map(function (u) { return String(u).toLowerCase(); }),
      mime: Array.isArray(d.mime) ? d.mime.slice() : [],
      ayarArayuzu: typeof d.ayarArayuzu === 'function' ? d.ayarArayuzu : null,
      sifirla: typeof d.sifirla === 'function' ? d.sifirla : null,
      donustur: d.donustur
    });
  }

  function bul(dosya) {
    var ad = String((dosya && dosya.name) || '').toLowerCase();
    var tip = (dosya && dosya.type) || '';
    for (var i = 0; i < donusturuculer.length; i++) {
      var d = donusturuculer[i];
      if (d.mime.indexOf(tip) >= 0) return d;
      for (var j = 0; j < d.uzantilar.length; j++) {
        if (ad.slice(-d.uzantilar[j].length) === d.uzantilar[j]) return d;
      }
    }
    return null;
  }

  /** Dosya girişinin accept değeri: PDF + kayıtlı uzantılar. */
  function kabul() {
    var l = ['.pdf', 'application/pdf'];
    donusturuculer.forEach(function (d) { l = l.concat(d.uzantilar, d.mime); });
    return l.join(',');
  }

  /** Ayar arayüzü olan her eklentinin alanlarını kap öğesine kurar. Bir eklentinin hatası diğerlerini durdurmaz. */
  function arayuzleriKur(kap) {
    if (!kap) return;
    donusturuculer.forEach(function (d) {
      if (!d.ayarArayuzu) return;
      try { d.ayarArayuzu(kap); } catch (e) {
        var p = kap.ownerDocument.createElement('p');
        p.className = 'uyari';
        p.textContent = t('eklenti.kurulamadi', { ad: d.ad, hata: e && e.message ? e.message : e });
        kap.appendChild(p);
      }
    });
  }

  /** Yeni dosya yüklemesi başlarken: her eklentinin önceki dönüşümden kalan uyarısını temizler. */
  function hepsiniSifirla() {
    donusturuculer.forEach(function (d) { if (d.sifirla) { try { d.sifirla(); } catch (e) { /* bir eklenti diğerlerini durdurmaz */ } } });
  }

  KC.eklentiler = {
    kaydet: kaydet,
    hepsiniSifirla: hepsiniSifirla,
    bul: bul,
    kabul: kabul,
    arayuzleriKur: arayuzleriKur,
    liste: function () { return donusturuculer.map(function (d) { return d.ad; }); }
  };
})(typeof self !== 'undefined' ? self : this);
