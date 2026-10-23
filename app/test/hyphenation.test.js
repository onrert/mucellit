'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/plugins/epub/hyphenation.js');

// Örnekler: TDK, "Hece yapısı ve satır sonunda kelimelerin bölünmesi" (erişim 2026-10-12)
const TDK_HYPHENATION = {
  // iki ünlü arasındaki tek ünsüz sonraki heceye
  araba: 'a-ra-ba', biçimine: 'bi-çi-mi-ne', insanın: 'in-sa-nın', karaca: 'ka-ra-ca',
  // yan yana iki ünsüz: ilki önceki, ikincisi sonraki heceye
  aldı: 'al-dı', birlik: 'bir-lik', sevmek: 'sev-mek',
  // üç ünsüz: ilk ikisi önceki heceye
  altlık: 'alt-lık', Türkçe: 'Türk-çe', korkmak: 'kork-mak',
  // Batı kökenli kelimeler Türkçe hece yapısına göre
  bandrol: 'band-rol', kontrol: 'kont-rol', portre: 'port-re', program: 'prog-ram', santral: 'sant-ral', sürpriz: 'sürp-riz',
  // ilk heceden sonraki heceler ünsüzle başlar; bitişik kelimeler
  başöğretmen: 'ba-şöğ-ret-men', ilkokul: 'il-ko-kul', Karaosmanoğlu: 'Ka-ra-os-ma-noğ-lu',
  // büyük İ / I
  IĞDIR: 'IĞ-DIR', İstanbul: 'İs-tan-bul', saat: 'sa-at'
};

test('hece: TDK örneklerinin hepsi doğru hecelenir', () => {
  for (const [k, expected] of Object.entries(TDK_HYPHENATION)) {
    assert.equal(H.syllabify(k).join('-'), expected, k);
  }
});

function split(k) { return H.breakPoints(k).map((i) => k.slice(0, i) + '|' + k.slice(i)); }

test('hece: satır sonunda tek harf kalmaz (uçurt-ma, müda-faa)', () => {
  assert.deepEqual(split('uçurtma'), ['uçurt|ma']);
  assert.deepEqual(split('müdafaa'), ['mü|dafaa', 'müda|faa']);
  assert.deepEqual(H.breakPoints('ok'), []);
  assert.deepEqual(H.breakPoints('ağaç'), []);
  assert.deepEqual(split('araba'), ['ara|ba'], 'a-raba olmaz (tek harf), ara-ba olur');
});

test('hece: kesme işaretinden sonraki ek bölünmez; kesmede tiresiz bölme', () => {
  for (const k of ['Edirne’nin', "Edirne'nin"]) {
    const n = H.breakPoints(k);
    assert.deepEqual(n, [4, 7], k);
    assert.equal(H.isNoHyphen(k, 7), true, 'kesmeden sonra tire yok');
    assert.equal(H.isNoHyphen(k, 4), false);
    assert.equal(k.slice(0, 7), k.slice(0, 6) + k.charAt(6));
  }
  assert.deepEqual(split('Ankara’dan'), ['An|kara’dan', 'Anka|ra’dan', 'Ankara’|dan']);
});

test('hece: rakam ya da iç tire içeren kelime bölünmez; baştaki/sondaki noktalama atlanır', () => {
  assert.deepEqual(H.breakPoints('1996’da'), []);
  assert.deepEqual(H.breakPoints('e-posta'), []);
  assert.deepEqual(split('sabahı;'), ['sa|bahı;', 'saba|hı;']);
  assert.deepEqual(split('«kitaplık»'), ['«ki|taplık»', '«kitap|lık»']);
});

test('hece: minLeft / minRight ayarı', () => {
  assert.deepEqual(H.breakPoints('araba', { minLeft: 1, minRight: 1 }), [1, 3]);
  assert.deepEqual(H.breakPoints('araba', { minLeft: 3, minRight: 3 }), []);
});
