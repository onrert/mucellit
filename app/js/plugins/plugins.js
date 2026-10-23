/*
 * plugins.js — girdi dönüştürücü eklenti noktası.
 *
 * Çekirdek yalnız PDF okur. Başka biçimler (ör. EPUB) bir
 * "girdi dönüştürücü" olarak kaydolur: dosyayı alır, PDF bytes döner.
 * Bu dosyada hiçbir dönüştürücü yoktur; yalnız arayüz vardır.
 *
 * Bir eklenti dosyası (ör. js/plugins/epub.js) index.html'de bu dosyadan
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
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  var converters = [];
  function t(a, p) { return MC.i18n.t(a, p); }

  function register(d) {
    if (!d || typeof d.name !== 'string' || !d.name) throw new Error(t('plugin.no_name'));
    if (!Array.isArray(d.extensions) || !d.extensions.length) throw new Error(t('plugin.no_extension'));
    if (typeof d.convert !== 'function') throw new Error(t('plugin.no_convert'));
    converters.push({
      name: d.name,
      extensions: d.extensions.map(function (u) { return String(u).toLowerCase(); }),
      mime: Array.isArray(d.mime) ? d.mime.slice() : [],
      settingsUi: typeof d.settingsUi === 'function' ? d.settingsUi : null,
      reset: typeof d.reset === 'function' ? d.reset : null,
      convert: d.convert
    });
  }

  function find(file) {
    var name = String((file && file.name) || '').toLowerCase();
    var type = (file && file.type) || '';
    for (var i = 0; i < converters.length; i++) {
      var d = converters[i];
      if (d.mime.indexOf(type) >= 0) return d;
      for (var j = 0; j < d.extensions.length; j++) {
        if (name.slice(-d.extensions[j].length) === d.extensions[j]) return d;
      }
    }
    return null;
  }

  /** Dosya girişinin accept değeri: PDF + kayıtlı uzantılar. */
  function accept() {
    var l = ['.pdf', 'application/pdf'];
    converters.forEach(function (d) { l = l.concat(d.extensions, d.mime); });
    return l.join(',');
  }

  /** Ayar arayüzü olan her eklentinin alanlarını kap öğesine kurar. Bir eklentinin hatası diğerlerini durdurmaz. */
  function setupInterfaces(container) {
    if (!container) return;
    converters.forEach(function (d) {
      if (!d.settingsUi) return;
      try { d.settingsUi(container); } catch (e) {
        var p = container.ownerDocument.createElement('p');
        p.className = 'warning';
        p.textContent = t('plugin.setupFailed', { name: d.name, error: e && e.message ? e.message : e });
        container.appendChild(p);
      }
    });
  }

  /** Yeni dosya yüklemesi başlarken: her eklentinin önceki dönüşümden kalan uyarısını temizler. */
  function resetAll() {
    converters.forEach(function (d) { if (d.reset) { try { d.reset(); } catch (e) { /* bir eklenti diğerlerini durdurmaz */ } } });
  }

  MC.plugins = {
    register: register,
    resetAll: resetAll,
    find: find,
    accept: accept,
    setupInterfaces: setupInterfaces,
    list: function () { return converters.map(function (d) { return d.name; }); }
  };
})(typeof self !== 'undefined' ? self : this);
