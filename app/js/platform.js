/*
 * platform.js — ortam farkları tek yerde.
 * Bu dosya TARAYICI uygulamasıdır ve bugünkü davranışı birebir korur: dosya seçimi gizli
 * <input type=file>, kaydetme <a download>, onay window.confirm. Tauri penceresinde
 * platform-tauri.js (bu dosyadan sonra yüklenir) yalnız farklı olan işlevleri ezer.
 *
 * Sözleşme (KitapCilt.platform):
 *   ad                     'tarayici' | 'tauri'
 *   hazir                  Promise<void>; uygulama.js başlatmayı bunu bekleyerek yapar
 *   dosyaSec({ girdi, uzantilar, mime })  Promise<File|null>
 *                          Tarayıcıda gizli girdiyi açar ve null döner: seçilen dosya girdinin kendi
 *                          `change` olayıyla gelir (e2e'deki setInputFiles da bu yolu kullanır).
 *                          null = "çağırana yapacak iş yok". Yerel diyalog File döndürür.
 *   kaydet(ad, veri, mime) Promise<true | false | { ad, yol }>; veri Blob | Uint8Array | string.
 *                          Tarayıcıda her zaman true (indirme başlatıldı; sonucu bilinmez). Yerel Kaydet
 *                          penceresi (Tauri) false = vazgeçildi, { ad, yol } = yazıldı.
 *   yerelDosya             false; Tauri'de true: Aç/Kaydet yerel pencerelerle, kaydetme sonucu gerçek
 *                          (duzenle.js dizilmiş PDF'i sırayla kaydedip bildirimi sonuca göre yazar)
 *   sonAcilanlar()         Promise<[{ kimlik, ad, tur, tarih }]>; tarayıcıda boş (yer imi Tauri'de)
 *   sonAcilaniAc(kimlik)   Promise<File|null>; tarayıcıda null
 *   onayla(mesaj)          Promise<boolean>; ASLA senkron confirm sonucuna güvenilmez (bkz. aşağı)
 *   yazdir                 null (tarayıcıda yerel baskı yok). Tauri: yazdir(ad, veri) → Promise<boolean>
 *                          (true = yazdırıldı/PDF olarak kaydedildi, false = vazgeçildi); Yazdır düğmesi yalnız bu varsa
 *   onizlemedeAc           null; Tauri: onizlemedeAc(ad, veri) → Promise<{ ad }> (açılamazsa reddedilir)
 *   tamSurum()             Promise<boolean>; tarayıcıda true
 *   metin                  ortama göre değişen kullanıcı metinleri (okununca o anki dilde; KitapCilt.dil)
 *
 * Onay notu: Tauri'nin dialog eklentisi window.confirm'ü Promise döndüren işlevle ezer; Promise
 * nesnesi doğru sayıldığı için `if (!confirm(...)) return;` kalıbı onaysız siler. Bu yüzden
 * onayla() dönüşü her zaman Promise.resolve ile beklenir: senkron true/false da, eklentinin
 * Promise<boolean>'ı da doğru sonuç verir.
 */
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};
  var D = KC.dil;

  function dosyaSec(secenek) {
    var girdi = secenek && secenek.girdi;
    if (girdi && typeof girdi.click === 'function') girdi.click();
    return Promise.resolve(null);
  }

  function kaydet(ad, veri, mime) {
    try {
      var blob = (typeof Blob !== 'undefined' && veri instanceof Blob) ? veri : new Blob([veri], { type: mime || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = ad;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
      return Promise.resolve(true);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function onayla(mesaj) {
    var sonuc;
    try { sonuc = kok.confirm(String(mesaj)); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(sonuc).then(function (ok) { return ok === true; });
  }

  KC.platform = {
    ad: 'tarayici',
    hazir: Promise.resolve(),
    dosyaSec: dosyaSec,
    kaydet: kaydet,
    onayla: onayla,
    yazdir: null,
    onizlemedeAc: null,
    yerelDosya: false,
    sonAcilanlar: function () { return Promise.resolve([]); },
    sonAcilaniAc: function () { return Promise.resolve(null); },
    tamSurum: function () { return Promise.resolve(true); },
    metin: {}
  };
  // Ortama göre değişen metinler, okunduğu andaki dilde (platform-tauri.js Mac metinleriyle ezer).
  //   kutuphaneIpucu: uygulama.js kütüphane yüklenemedi bildiriminin sonu
  //   saklamaUyari:   surec.js, saklama alanı kullanılamıyor/dolu uyarısı
  //   denetimUyari:   duzenle.js, şifre/kısıt durumu denetlenemedi uyarısı
  [['kutuphaneIpucu', 'uygulama.kutuphane_ipucu'], ['saklamaUyari', 'surec.uyari.saklama'], ['denetimUyari', 'duzenle.uyari.denetim']].forEach(function (m) {
    Object.defineProperty(KC.platform.metin, m[0], {
      get: function () { return D.t(m[1]); }, enumerable: true, configurable: true
    });
  });
})(typeof self !== 'undefined' ? self : this);
