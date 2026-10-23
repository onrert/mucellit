/*
 * depo.js — süreç verisini tarayıcıda saklar (localStorage, try/catch ile).
 * Saklama kullanılamazsa (gizli pencere, engellenmiş site verisi) veri yalnız
 * bu oturumda bellekte durur ve kullanıcı uyarılır; JSON yedeği her zaman çalışır.
 */
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};
  var ANAHTAR = 'kitapCilt.v1';
  var bellek = null;
  var kalici = true;

  var bozukKayit = false;

  function bellekKopya() { return JSON.parse(JSON.stringify(bellek)); }

  function oku() {
    // Son kalıcı yazım başarısızsa (kota dolu, saklama kapalı) localStorage'daki kayıt ESKİDİR;
    // en yeni veri bellektedir.
    if (!kalici && bellek) return bellekKopya();
    var ham;
    try {
      ham = kok.localStorage.getItem(ANAHTAR);
    } catch {
      kalici = false;
      return bellek ? JSON.parse(JSON.stringify(bellek)) : KC.surecModel.bosVeri();
    }
    if (!ham) return bellek ? JSON.parse(JSON.stringify(bellek)) : KC.surecModel.bosVeri();
    try {
      var veri = JSON.parse(ham);
      KC.surecModel.dogrula(veri);
      return veri;
    } catch {
      // Bozuk kayıt: üzerine yazılmadan önce ayrı anahtara yedeklenir, kullanıcı uyarılır.
      bozukKayit = true;
      try { kok.localStorage.setItem(ANAHTAR + '.bozuk', ham); } catch { /* yer yok */ }
      return KC.surecModel.bosVeri();
    }
  }

  function yaz(veri) {
    bellek = JSON.parse(JSON.stringify(veri));
    try {
      kok.localStorage.setItem(ANAHTAR, JSON.stringify(veri));
      kalici = true;
      bozukKayit = false; // başarılı yazım bozuk kaydın üzerine yazdı; uyarı artık geçerli değil
      return true;
    } catch {
      kalici = false;
      return false;
    }
  }

  function temizle() {
    // Bellek BOŞ veri olur (null değil): removeItem başarısız olursa oku() localStorage'daki eski kaydı döndürmesin.
    bellek = KC.surecModel.bosVeri();
    bozukKayit = false;
    try { kok.localStorage.removeItem(ANAHTAR); kalici = true; } catch { kalici = false; /* silinemedi: bellek geçerli */ }
  }

  KC.depo = { oku: oku, yaz: yaz, temizle: temizle, kaliciMi: function () { return kalici; }, bozukMu: function () { return bozukKayit; }, ANAHTAR: ANAHTAR };
})(typeof self !== 'undefined' ? self : this);
