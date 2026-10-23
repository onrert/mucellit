/*
 * platform.js — ortam farkları tek yerde.
 * Bu dosya TARAYICI uygulamasıdır ve bugünkü davranışı birebir korur: dosya seçimi gizli
 * <input type=file>, kaydetme <a download>, onay window.confirm. Tauri penceresinde
 * platform-tauri.js (bu dosyadan sonra yüklenir) yalnız farklı olan işlevleri ezer.
 *
 * Sözleşme (KitapCilt.platform):
 *   ad                     'tarayici' | 'tauri'
 *   hazir                  Promise<void>; app.js başlatmayı bunu bekleyerek yapar
 *   dosyaSec({ girdi, uzantilar, mime })  Promise<File|null>
 *                          Tarayıcıda gizli girdiyi açar ve null döner: seçilen dosya girdinin kendi
 *                          `change` olayıyla gelir (e2e'deki setInputFiles da bu yolu kullanır).
 *                          null = "çağırana yapacak iş yok". Yerel diyalog File döndürür.
 *   kaydet(ad, veri, mime) Promise<true | false | { ad, yol }>; veri Blob | Uint8Array | string.
 *                          Tarayıcıda her zaman true (indirme başlatıldı; sonucu bilinmez). Yerel Kaydet
 *                          penceresi (Tauri) false = vazgeçildi, { ad, yol } = yazıldı.
 *   yerelDosya             false; Tauri'de true: Aç/Kaydet yerel pencerelerle, kaydetme sonucu gerçek
 *                          (impose.js dizilmiş PDF'i sırayla kaydedip bildirimi sonuca göre yazar)
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
  // Ortama göre değişen metinler, okunduğu andaki dilde (platform-tauri.js Mac metinleriyle ezer).
  //   kutuphaneIpucu: app.js kütüphane yüklenemedi bildiriminin sonu
  //   saklamaUyari:   projects.js, saklama alanı kullanılamıyor/dolu uyarısı
  //   denetimUyari:   impose.js, şifre/kısıt durumu denetlenemedi uyarısı
  [['libraryHint', 'app.library_hint'], ['storageWarning', 'projects.warning.storage'], ['checkWarning', 'impose.warning.check']].forEach(function (m) {
    Object.defineProperty(MC.platform.text, m[0], {
      get: function () { return D.t(m[1]); }, enumerable: true, configurable: true
    });
  });
})(typeof self !== 'undefined' ? self : this);
