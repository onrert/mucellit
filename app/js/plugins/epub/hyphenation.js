/*
 * hyphenation.js — Turkish syllabification and line-break points, a pure module without DOM
 * (Mucellit.hyphenation / module.exports).
 *
 * Rules (TDK, the Turkish Language Association, "syllable structure and splitting words at the end of a line"):
 *  - Every syllable has one vowel. A single consonant between two vowels goes to the next syllable; of two adjacent
 *    consonants the first goes to the previous, the second to the next syllable; of three consonants the first two go
 *    to the previous syllable. In general: the LAST consonant between two vowels goes to the next syllable.
 *    Two adjacent vowels are separate syllables.
 *  - No single letter is left at the start / end of a line (minLeft / minRight, default 2).
 *  - A suffix separated by an apostrophe is not split; after the apostrophe a break point without a hyphen is given.
 *    That point is recognised because the character before the index is an apostrophe.
 *  - A word with a digit or another non-letter inside (apostrophe aside) is not split.
 *
 * turkish-data: begin (Turkish example words)
 *   a-ra-ba, bir-lik, Türk-çe, alt-lık, sa-at
 *   syllabify('araba')                    → ['a', 'ra', 'ba']
 *   breakPoints('uçurtma')                → [5]          ('uçurt' | 'ma')
 *   breakPoints('Edirne’nin')             → [4, 7]       ('Edir-' | 'ne’nin', 'Edirne’' | 'nin')
 *   isNoHyphen('Edirne’nin', 7)           → true
 *   Leading/trailing punctuation (e.g. 'sabahı;') is skipped; the indices refer to the original word.
 * turkish-data: end
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

  var VOWELS = 'aeıioöuüâîûAEIİOÖUÜÂÎÛ';  // turkish-ok: Turkish vowels
  var APOSTROPHE = '\'’';
  var LETTER = /^\p{L}$/u;

  function isVowel(c) { return VOWELS.indexOf(c) >= 0 || VOWELS.indexOf(c.toLocaleLowerCase('tr')) >= 0; }
  function isLetter(c) { return LETTER.test(c); }

  /** The syllable boundaries of a word made of letters only (index list, without 0 and the length). */
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
   * Line-break points (ascending). options: { minLeft = 2, minRight = 2 } (number of letters).
   * An index i says the word can be split as [0,i) and [i,length).
   */
  function breakPoints(word, options) {
    var w = String(word || '');
    var minLeft = options && options.minLeft !== undefined ? options.minLeft : 2;
    var minRight = options && options.minRight !== undefined ? options.minRight : 2;
    // core: the non-letter characters (punctuation, quotes) at the start and end stay outside
    var head = 0, last = w.length;
    while (head < last && !isLetter(w.charAt(head))) head++;
    while (last > head && !isLetter(w.charAt(last - 1))) last--;
    if (last - head < minLeft + minRight) return [];
    var core = w.slice(head, last);
    var apostrophe = -1;
    for (var i = 0; i < core.length; i++) {
      var c = core.charAt(i);
      if (APOSTROPHE.indexOf(c) >= 0) {
        if (apostrophe >= 0) return []; // two apostrophes: do not split
        apostrophe = i;
      } else if (!isLetter(c)) return []; // rakam, tire vb.
    }
    var root_ = apostrophe >= 0 ? core.slice(0, apostrophe) : core;
    var ek = apostrophe >= 0 ? core.slice(apostrophe + 1) : '';
    var points = [];
    boundaries(root_).forEach(function (i) {
      // the right side moves to the next line together with the apostrophe + suffix; letters = rest of the root + suffix
      var leftLetter = i, rightLetter = root_.length - i + ek.length;
      if (leftLetter >= minLeft && rightLetter >= minRight) points.push(head + i);
    });
    if (apostrophe >= 0 && root_.length >= minLeft && ek.length >= minRight) points.push(head + apostrophe + 1);
    return points;
  }

  /** Is no hyphen put at this break point (right after an apostrophe)? */
  function isNoHyphen(word, index) {
    return index > 0 && APOSTROPHE.indexOf(String(word).charAt(index - 1)) >= 0;
  }

  return { syllabify: syllabify, breakPoints: breakPoints, isNoHyphen: isNoHyphen, isVowel: isVowel };
});
