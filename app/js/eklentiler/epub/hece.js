/*
 * hece.js — Türkçe heceleme ve satır sonu bölme noktaları, DOM'suz saf modül
 * (KitapCilt.hece / module.exports).
 *
 * Kurallar (TDK, "Hece yapısı ve satır sonunda kelimelerin bölünmesi"):
 *  - Her hecede bir ünlü vardır. İki ünlü arasındaki tek ünsüz sonraki heceye geçer (a-ra-ba);
 *    yan yana iki ünsüzün ilki önceki, ikincisi sonraki heceye (bir-lik); üç ünsüzde ilk ikisi
 *    önceki heceye (Türk-çe, alt-lık). Genel biçim: iki ünlü arasındaki SON ünsüz sonraki heceye geçer.
 *    Yan yana iki ünlü ayrı hecedir (sa-at).
 *  - Satır başında / sonunda tek harf kalmaz (enAzSol / enAzSag, varsayılan 2).
 *  - Kesme işaretiyle ayrılan ek bölünmez; kesme işaretinden sonra tiresiz bölme noktası verilir
 *    ("Edirne’" / "nin"). Bu nokta, indisin bir önceki karakteri kesme işareti olduğu için tanınır.
 *  - Rakam ya da harf dışı iç karakter (kesme işareti hariç) içeren kelime bölünmez.
 *
 *   hecele('araba')                       → ['a', 'ra', 'ba']
 *   bolmeNoktalari('uçurtma')             → [5]          ('uçurt' | 'ma')
 *   bolmeNoktalari('Edirne’nin')          → [4, 7]       ('Edir-' | 'ne’nin', 'Edirne’' | 'nin')
 *   tiresizMi('Edirne’nin', 7)            → true
 * Baştaki/sondaki noktalama (ör. 'sabahı;') atlanır; indisler özgün kelimeye göredir.
 */
(function (kok, fabrika) {
  var m = fabrika();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    kok.KitapCilt = kok.KitapCilt || {};
    kok.KitapCilt.hece = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var UNLULER = 'aeıioöuüâîûAEIİOÖUÜÂÎÛ';
  var KESME = '\'’';
  var HARF = /^\p{L}$/u;

  function unluMu(c) { return UNLULER.indexOf(c) >= 0 || UNLULER.indexOf(c.toLocaleLowerCase('tr')) >= 0; }
  function harfMi(c) { return HARF.test(c); }

  /** Yalnız harflerden oluşan bir kelimenin hece sınırları (indis listesi, 0 ve uzunluk hariç). */
  function sinirlar(kelime) {
    var u = [];
    for (var i = 0; i < kelime.length; i++) if (unluMu(kelime.charAt(i))) u.push(i);
    var s = [];
    for (var k = 1; k < u.length; k++) {
      var onceki = u[k - 1], sonraki = u[k];
      var unsuz = sonraki - onceki - 1;
      s.push(unsuz === 0 ? sonraki : sonraki - 1);
    }
    return s;
  }

  function hecele(kelime) {
    var w = String(kelime || '');
    if (!w) return [];
    var s = sinirlar(w);
    var parcalar = [];
    var bas = 0;
    s.forEach(function (i) { parcalar.push(w.slice(bas, i)); bas = i; });
    parcalar.push(w.slice(bas));
    return parcalar;
  }

  /**
   * Satır sonu bölme noktaları (artan). secenek: { enAzSol = 2, enAzSag = 2 } (harf sayısı).
   * Bir indis i, kelimenin [0,i) ve [i,uzunluk) diye bölünebileceğini söyler.
   */
  function bolmeNoktalari(kelime, secenek) {
    var w = String(kelime || '');
    var enAzSol = secenek && secenek.enAzSol !== undefined ? secenek.enAzSol : 2;
    var enAzSag = secenek && secenek.enAzSag !== undefined ? secenek.enAzSag : 2;
    // çekirdek: baştaki ve sondaki harf olmayan karakterler (noktalama, tırnak) dışarıda
    var bas = 0, son = w.length;
    while (bas < son && !harfMi(w.charAt(bas))) bas++;
    while (son > bas && !harfMi(w.charAt(son - 1))) son--;
    if (son - bas < enAzSol + enAzSag) return [];
    var cekirdek = w.slice(bas, son);
    var kesme = -1;
    for (var i = 0; i < cekirdek.length; i++) {
      var c = cekirdek.charAt(i);
      if (KESME.indexOf(c) >= 0) {
        if (kesme >= 0) return []; // iki kesme işareti: bölme
        kesme = i;
      } else if (!harfMi(c)) return []; // rakam, tire vb.
    }
    var kok_ = kesme >= 0 ? cekirdek.slice(0, kesme) : cekirdek;
    var ek = kesme >= 0 ? cekirdek.slice(kesme + 1) : '';
    var noktalar = [];
    sinirlar(kok_).forEach(function (i) {
      // sağ taraf kesme + ek ile birlikte satıra iner; harf sayısı kökün kalanı + ek
      var solHarf = i, sagHarf = kok_.length - i + ek.length;
      if (solHarf >= enAzSol && sagHarf >= enAzSag) noktalar.push(bas + i);
    });
    if (kesme >= 0 && kok_.length >= enAzSol && ek.length >= enAzSag) noktalar.push(bas + kesme + 1);
    return noktalar;
  }

  /** Bu bölme noktasında tire konmaz mı (kesme işaretinden hemen sonra)? */
  function tiresizMi(kelime, indis) {
    return indis > 0 && KESME.indexOf(String(kelime).charAt(indis - 1)) >= 0;
  }

  return { hecele: hecele, bolmeNoktalari: bolmeNoktalari, tiresizMi: tiresizMi, unluMu: unluMu };
});
