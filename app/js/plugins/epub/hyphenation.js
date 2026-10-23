/*
 * hyphenation.js — Türkçe heceleme ve satır sonu bölme noktaları, DOM'suz saf modül
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
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    root.Mucellit = root.Mucellit || {};
    root.Mucellit.hyphenation = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VOWELS = 'aeıioöuüâîûAEIİOÖUÜÂÎÛ';
  var APOSTROPHE = '\'’';
  var LETTER = /^\p{L}$/u;

  function isVowel(c) { return VOWELS.indexOf(c) >= 0 || VOWELS.indexOf(c.toLocaleLowerCase('tr')) >= 0; }
  function isLetter(c) { return LETTER.test(c); }

  /** Yalnız harflerden oluşan bir kelimenin hece sınırları (indis listesi, 0 ve uzunluk hariç). */
  function boundaries(word) {
    var u = [];
    for (var i = 0; i < word.length; i++) if (isVowel(word.charAt(i))) u.push(i);
    var s = [];
    for (var k = 1; k < u.length; k++) {
      var previous = u[k - 1], next = u[k];
      var consonant = next - previous - 1;
      s.push(consonant === 0 ? next : next - 1);
    }
    return s;
  }

  function syllabify(word) {
    var w = String(word || '');
    if (!w) return [];
    var s = boundaries(w);
    var parts = [];
    var head = 0;
    s.forEach(function (i) { parts.push(w.slice(head, i)); head = i; });
    parts.push(w.slice(head));
    return parts;
  }

  /**
   * Satır sonu bölme noktaları (artan). secenek: { enAzSol = 2, enAzSag = 2 } (harf sayısı).
   * Bir indis i, kelimenin [0,i) ve [i,uzunluk) diye bölünebileceğini söyler.
   */
  function breakPoints(word, options) {
    var w = String(word || '');
    var minLeft = options && options.minLeft !== undefined ? options.minLeft : 2;
    var minRight = options && options.minRight !== undefined ? options.minRight : 2;
    // çekirdek: baştaki ve sondaki harf olmayan karakterler (noktalama, tırnak) dışarıda
    var head = 0, last = w.length;
    while (head < last && !isLetter(w.charAt(head))) head++;
    while (last > head && !isLetter(w.charAt(last - 1))) last--;
    if (last - head < minLeft + minRight) return [];
    var core = w.slice(head, last);
    var apostrophe = -1;
    for (var i = 0; i < core.length; i++) {
      var c = core.charAt(i);
      if (APOSTROPHE.indexOf(c) >= 0) {
        if (apostrophe >= 0) return []; // iki kesme işareti: bölme
        apostrophe = i;
      } else if (!isLetter(c)) return []; // rakam, tire vb.
    }
    var root_ = apostrophe >= 0 ? core.slice(0, apostrophe) : core;
    var ek = apostrophe >= 0 ? core.slice(apostrophe + 1) : '';
    var points = [];
    boundaries(root_).forEach(function (i) {
      // sağ taraf kesme + ek ile birlikte satıra iner; harf sayısı kökün kalanı + ek
      var leftLetter = i, rightLetter = root_.length - i + ek.length;
      if (leftLetter >= minLeft && rightLetter >= minRight) points.push(head + i);
    });
    if (apostrophe >= 0 && root_.length >= minLeft && ek.length >= minRight) points.push(head + apostrophe + 1);
    return points;
  }

  /** Bu bölme noktasında tire konmaz mı (kesme işaretinden hemen sonra)? */
  function isNoHyphen(word, index) {
    return index > 0 && APOSTROPHE.indexOf(String(word).charAt(index - 1)) >= 0;
  }

  return { syllabify: syllabify, breakPoints: breakPoints, isNoHyphen: isNoHyphen, isVowel: isVowel };
});
