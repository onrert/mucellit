'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/plugins/epub/hyphenation.js');

// turkish-data: begin (Turkish example words and their syllables)
// Examples: TDK (Turkish Language Association), "syllable structure and splitting words at the end of a line" (accessed 2026-10-12)
const TDK_HYPHENATION = {
  // a single consonant between two vowels goes to the next syllable
  araba: 'a-ra-ba', biçimine: 'bi-çi-mi-ne', insanın: 'in-sa-nın', karaca: 'ka-ra-ca',
  // two adjacent consonants: the first to the previous, the second to the next syllable
  aldı: 'al-dı', birlik: 'bir-lik', sevmek: 'sev-mek',
  // three consonants: the first two to the previous syllable
  altlık: 'alt-lık', Türkçe: 'Türk-çe', korkmak: 'kork-mak',
  // words of Western origin by the Turkish syllable structure
  bandrol: 'band-rol', kontrol: 'kont-rol', portre: 'port-re', program: 'prog-ram', santral: 'sant-ral', sürpriz: 'sürp-riz',
  // the syllables after the first start with a consonant; compound words
  başöğretmen: 'ba-şöğ-ret-men', ilkokul: 'il-ko-kul', Karaosmanoğlu: 'Ka-ra-os-ma-noğ-lu',
  // capital dotted / dotless I
  IĞDIR: 'IĞ-DIR', İstanbul: 'İs-tan-bul', saat: 'sa-at'
// turkish-data: end
};

test('hyphenation: every TDK example is syllabified correctly', () => {
  for (const [k, expected] of Object.entries(TDK_HYPHENATION)) {
    assert.equal(H.syllabify(k).join('-'), expected, k);
  }
});

function split(k) { return H.breakPoints(k).map((i) => k.slice(0, i) + '|' + k.slice(i)); }

test('hyphenation: no single letter is left at the end of a line (uçurt-ma, müda-faa)', () => {  // turkish-ok: Turkish test words in the test name
  assert.deepEqual(split('uçurtma'), ['uçurt|ma']);  // turkish-ok: Turkish test data
  assert.deepEqual(split('müdafaa'), ['mü|dafaa', 'müda|faa']);  // turkish-ok: Turkish test data
  assert.deepEqual(H.breakPoints('ok'), []);
  assert.deepEqual(H.breakPoints('ağaç'), []);  // turkish-ok: Turkish test data
  assert.deepEqual(split('araba'), ['ara|ba'], 'a-raba not allowed (single letter), ara-ba allowed');
});

test('hyphenation: the suffix after an apostrophe is not split; a break at the apostrophe has no hyphen', () => {
  for (const k of ['Edirne’nin', "Edirne'nin"]) {
    const n = H.breakPoints(k);
    assert.deepEqual(n, [4, 7], k);
    assert.equal(H.isNoHyphen(k, 7), true, 'no hyphen after the apostrophe');
    assert.equal(H.isNoHyphen(k, 4), false);
    assert.equal(k.slice(0, 7), k.slice(0, 6) + k.charAt(6));
  }
  assert.deepEqual(split('Ankara’dan'), ['An|kara’dan', 'Anka|ra’dan', 'Ankara’|dan']);
});

test('hyphenation: a word with a digit or an inner hyphen is not split; leading/trailing punctuation is skipped', () => {
  assert.deepEqual(H.breakPoints('1996’da'), []);
  assert.deepEqual(H.breakPoints('e-posta'), []);
  assert.deepEqual(split('sabahı;'), ['sa|bahı;', 'saba|hı;']);  // turkish-ok: Turkish test data
  assert.deepEqual(split('«kitaplık»'), ['«ki|taplık»', '«kitap|lık»']);  // turkish-ok: Turkish test data
});

test('hyphenation: minLeft / minRight setting', () => {
  assert.deepEqual(H.breakPoints('araba', { minLeft: 1, minRight: 1 }), [1, 3]);
  assert.deepEqual(H.breakPoints('araba', { minLeft: 3, minRight: 3 }), []);
});
