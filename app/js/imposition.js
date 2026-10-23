/*
 * imposition.js — sayfa dizilimi (imposition), DOM'suz saf modül.
 * Tarayıcıda klasik <script> olarak yüklenir (KitapCilt.dizilim),
 * Node'da require() ile (module.exports) kullanılır.
 *
 * Sayfa numaraları 1'den başlar. Toplam sayfa, cilt türünün gerektirdiği
 * katına boş sayfayla tamamlanır; numarası sayfaSayisi'ndan büyük olan
 * sayfa boştur (bosMu).
 */
(function (kok, fabrika) {
  var m = fabrika();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    kok.KitapCilt = kok.KitapCilt || {};
    kok.KitapCilt.dizilim = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var kok = typeof self !== 'undefined' ? self : globalThis; // vm bağlamında da KitapCilt.dil bulunur
  function Dil() { return (kok && kok.KitapCilt && kok.KitapCilt.dil) || require('./i18n.js'); }
  function t(a, p) { return Dil().t(a, p); }

  function tamSayi(deger, alan, enAz, enCok) {
    var n = Number(deger);
    if (!Number.isInteger(n) || n < enAz || (enCok !== undefined && n > enCok)) {
      throw new RangeError(t(enCok !== undefined ? 'dizilim.tam_sayi' : 'dizilim.tam_sayi_acik',
        { ad: t('dizilim.ad.' + alan), enaz: enAz, encok: enCok, deger: deger }));
    }
    return n;
  }

  function yuvarla(x) {
    return Math.round(x * 1e6) / 1e6;
  }

  /** Forma içindeki yaprak i (0'dan) için kayma: i × kalınlık (mm). */
  function kayma(i, kalinlik) {
    var k = Number(kalinlik) || 0;
    if (k < 0) throw new RangeError(t('dizilim.kalinlik_negatif'));
    return yuvarla(i * k);
  }

  function bosMuFabrika(sayfaSayisi) {
    return function (n) { return n > sayfaSayisi; };
  }

  /**
   * Formalı (signature) dizilim.
   * ayar: { sayfaSayisi, formaYaprak=4 (1–8), sonFormaKucult=false,
   *         kaymaAcik=false, kagitKalinlik=0 }
   * Forma içinde n sayfa, yaprak i (0'dan):
   *   ön  [sol, sağ] = [n−2i, 1+2i]
   *   arka[sol, sağ] = [2+2i, n−1−2i]
   */
  function formali(ayar) {
    ayar = ayar || {};
    var sayfaSayisi = tamSayi(ayar.sayfaSayisi, 'sayfa_sayisi', 1);
    var k = tamSayi(ayar.formaYaprak === undefined ? 4 : ayar.formaYaprak, 'forma_yaprak', 1, 8);
    var formaSayfa = 4 * k;
    var tamForma = Math.floor(sayfaSayisi / formaSayfa);
    var kalan = sayfaSayisi - tamForma * formaSayfa;
    var formaYapraklari = [];
    for (var f = 0; f < tamForma; f++) formaYapraklari.push(k);
    if (kalan > 0) formaYapraklari.push(ayar.sonFormaKucult ? Math.ceil(kalan / 4) : k);

    var kaymaAcik = !!ayar.kaymaAcik;
    var kalinlik = Number(ayar.kagitKalinlik) || 0;
    var formalar = [];
    var yapraklar = [];
    var ofset = 0;
    formaYapraklari.forEach(function (yaprakSayisi, fi) {
      var n = 4 * yaprakSayisi;
      formalar.push({ no: fi, yaprakSayisi: yaprakSayisi, sayfaSayisi: n, ilkSayfa: ofset + 1, sonSayfa: ofset + n });
      for (var i = 0; i < yaprakSayisi; i++) {
        yapraklar.push({
          no: yapraklar.length,
          forma: fi,
          formaIci: i,
          on: [ofset + n - 2 * i, ofset + 1 + 2 * i],
          arka: [ofset + 2 + 2 * i, ofset + n - 1 - 2 * i],
          kayma: kaymaAcik ? kayma(i, kalinlik) : 0
        });
      }
      ofset += n;
    });
    return {
      tur: 'formali',
      sayfaSayisi: sayfaSayisi,
      toplamSayfa: ofset,
      yuvaSayisi: 2,
      formalar: formalar,
      yapraklar: yapraklar,
      bosMu: bosMuFabrika(sayfaSayisi)
    };
  }

  /** Tek yaprak, 1'li: her baskı yaprağı ön = 2i+1, arka = 2i+2. */
  function tek1(ayar) {
    ayar = ayar || {};
    var sayfaSayisi = tamSayi(ayar.sayfaSayisi, 'sayfa_sayisi', 1);
    var yaprakSayisi = Math.ceil(sayfaSayisi / 2);
    var yapraklar = [];
    for (var i = 0; i < yaprakSayisi; i++) {
      yapraklar.push({ no: i, forma: 0, formaIci: i, on: [2 * i + 1], arka: [2 * i + 2], kayma: 0 });
    }
    return {
      tur: 'tek1', sayfaSayisi: sayfaSayisi, toplamSayfa: 2 * yaprakSayisi, yuvaSayisi: 1,
      formalar: [], yapraklar: yapraklar, bosMu: bosMuFabrika(sayfaSayisi)
    };
  }

  /**
   * Tek yaprak, 2'li kes-üst üste koy. N yaprak, toplam 4N.
   * yaprak i: ön [2i+1, 2N+2i+1], arka [2N+2i+2, 2i+2].
   * Ortadan kesip sağ desteyi sol destenin altına koyunca sıra 1..4N olur.
   */
  function tek2(ayar) {
    ayar = ayar || {};
    var sayfaSayisi = tamSayi(ayar.sayfaSayisi, 'sayfa_sayisi', 1);
    var N = Math.ceil(sayfaSayisi / 4);
    var yapraklar = [];
    for (var i = 0; i < N; i++) {
      yapraklar.push({
        no: i, forma: 0, formaIci: i,
        on: [2 * i + 1, 2 * N + 2 * i + 1],
        arka: [2 * N + 2 * i + 2, 2 * i + 2],
        kayma: 0
      });
    }
    return {
      tur: 'tek2', sayfaSayisi: sayfaSayisi, toplamSayfa: 4 * N, yuvaSayisi: 2,
      formalar: [], yapraklar: yapraklar, bosMu: bosMuFabrika(sayfaSayisi)
    };
  }

  /** ciltTuru: 'formali' | 'tek1' | 'tek2' */
  function diz(ciltTuru, ayar) {
    if (ciltTuru === 'formali') return formali(ayar);
    if (ciltTuru === 'tek1') return tek1(ayar);
    if (ciltTuru === 'tek2') return tek2(ayar);
    throw new Error(t('hata.cilt_turu', { tur: ciltTuru }));
  }

  /** Bir dizilimin her sayfayı tam bir kez kullandığını doğrular (öz-denetim). */
  function denetle(sonuc) {
    var gorulen = {};
    sonuc.yapraklar.forEach(function (y) {
      y.on.concat(y.arka).forEach(function (s) {
        if (gorulen[s]) throw new Error(t('dizilim.iki_kez', { s: s }));
        gorulen[s] = true;
      });
    });
    for (var s = 1; s <= sonuc.toplamSayfa; s++) {
      if (!gorulen[s]) throw new Error(t('dizilim.yerlesmedi', { s: s }));
    }
    return true;
  }

  return { formali: formali, tek1: tek1, tek2: tek2, diz: diz, kayma: kayma, denetle: denetle };
});
