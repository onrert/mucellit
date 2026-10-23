/*
 * calc.js — cilt hesapları, DOM'suz saf modül (KitapCilt.hesap / module.exports).
 * Bütün ölçüler mm. Bütün varsayılanlar VARSAYILAN içinde ve düzenlenebilir.
 *
 * Terimler:
 *  - kitap yaprağı: kitaptaki tek bir yaprak (2 sayfa: ön + arka).
 *  - baskı kağıdı: yazıcıdan geçen fiziksel kağıt.
 */
(function (kok, fabrika) {
  var m = fabrika();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    kok.KitapCilt = kok.KitapCilt || {};
    kok.KitapCilt.hesap = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var kok = typeof self !== 'undefined' ? self : globalThis; // vm bağlamında da KitapCilt.dil bulunur
  function Dil() { return (kok && kok.KitapCilt && kok.KitapCilt.dil) || require('./i18n.js'); }
  function t(a, p) { return Dil().t(a, p); }
  /** Alan adı (hata metinleri için): sözlükte "hesap.ad.<anahtar>". */
  function ad(anahtar) { return t('hesap.ad.' + anahtar); }

  var VARSAYILAN = {
    ciltTuru: 'formali',   // 'formali' | 'tek1' | 'tek2'
    formaYaprak: 4,
    sonFormaKucult: false,
    kagitKalinlik: 0.1,    // mm, tek kitap yaprağı
    forzaPayi: 0,          // mm, sırta eklenecek forza/ön-arka kağıt payı
    kitapGen: 148,
    kitapYuk: 210,
    mukavvaKalinlik: 2,    // t, mm
    sirtTipi: 'duz',       // 'duz' | 'yuvarlak'
    sirtKurali: 'ikiT',    // 'ikiT': sırt şeridi S + 2t | 'yalnizS': S (mafsal t kadar artar)
    egriBoyu: undefined,   // yuvarlak sırtta ölçülen sırt eğri boyu (mm); boşsa S + 2t
    tasma: 3,              // k, mm: mukavvanın kitap bloğundan taşması (baş, kuyruk, ön)
    mafsal: 'otomatik',    // f: 'otomatik' (mukavva kalınlığına göre) ya da elle mm
    kivirma: 15,           // e, mm: kaplamanın her kenardan içe kıvrılan payı
    yedekKagit: 0          // test baskısı / fire için ek baskı kağıdı
  };

  function yuvarla(x) { return Math.round(x * 1000) / 1000; }

  function sayi(v, alan, enAz) {
    var n = Number(v);
    if (!isFinite(n) || n < (enAz === undefined ? 0 : enAz)) {
      throw new RangeError(t('hesap.gecersiz', { ad: ad(alan), deger: v }));
    }
    return n;
  }

  /** Mafsal (oluk) genişliği, mukavva kalınlığına göre: t ≤ 1 → 6, ≤ 2 → 7, ≤ 3 → 8, > 3 → 9 (kaynaksız). */
  function mafsalOtomatikDegeri(tm) {
    return tm <= 1 ? 6 : tm <= 2 ? 7 : tm <= 3 ? 8 : 9;
  }

  /** Sayfa sayısından kitap yaprağı sayısı (tek sayıda sayfa yukarı yuvarlanır). */
  function yaprakSayisi(sayfa) {
    return Math.ceil(sayi(sayfa, 'sayfa_sayisi', 0) / 2);
  }

  /** Sırt kalınlığı = yaprak × kağıt kalınlığı (+ forza payı). */
  function sirtKalinligi(yaprak, kalinlik, forzaPayi) {
    return yuvarla(sayi(yaprak, 'yaprak', 0) * sayi(kalinlik, 'kagit_kalinligi', 0) +
      sayi(forzaPayi || 0, 'forza_payi', 0));
  }

  /** Cilt türüne göre boş sayfayla tamamlanmış toplam sayfa ve forma bilgisi. */
  function tamamlanmis(ciltTuru, sayfa, formaYaprak, sonFormaKucult) {
    var p = Math.ceil(sayi(sayfa, 'sayfa_sayisi', 1));
    if (ciltTuru === 'formali') {
      var fs = 4 * formaYaprak;
      var tam = Math.floor(p / fs);
      var kalan = p - tam * fs;
      var formaSayisi = tam + (kalan > 0 ? 1 : 0);
      var son = kalan > 0 ? (sonFormaKucult ? Math.ceil(kalan / 4) : formaYaprak) : 0;
      var toplam = tam * fs + son * 4;
      return { toplamSayfa: toplam, formaSayisi: formaSayisi, baskiKagidi: toplam / 4 };
    }
    if (ciltTuru === 'tek1') {
      var t1 = 2 * Math.ceil(p / 2);
      return { toplamSayfa: t1, formaSayisi: 0, baskiKagidi: t1 / 2 };
    }
    if (ciltTuru === 'tek2') {
      var t2 = 4 * Math.ceil(p / 4);
      return { toplamSayfa: t2, formaSayisi: 0, baskiKagidi: t2 / 4 };
    }
    throw new Error(t('hata.cilt_turu', { tur: ciltTuru }));
  }

  /**
   * Tüm hesap. girdi: { sayfaSayisi, ...VARSAYILAN alanları }
   * Sırt kalınlığı tamamlanmış (boş sayfalar dahil) yaprak sayısıyla hesaplanır,
   * çünkü boş sayfalar da kağıttır.
   */
  function hesapla(girdi) {
    var g = {};
    Object.keys(VARSAYILAN).forEach(function (k) { g[k] = VARSAYILAN[k]; });
    Object.keys(girdi || {}).forEach(function (k) {
      if (girdi[k] !== undefined && girdi[k] !== null && girdi[k] !== '') g[k] = girdi[k];
    });
    var formaYaprak = sayi(g.formaYaprak, 'forma_yapragi', 1);
    if (!Number.isInteger(formaYaprak) || formaYaprak > 8) throw new RangeError(t('hesap.forma_yaprak', { deger: g.formaYaprak }));
    var tam = tamamlanmis(g.ciltTuru, g.sayfaSayisi, formaYaprak, !!g.sonFormaKucult);
    var kitapYaprak = yaprakSayisi(tam.toplamSayfa);
    var sirt = sirtKalinligi(kitapYaprak, g.kagitKalinlik, g.forzaPayi);
    var kitapGen = sayi(g.kitapGen, 'kitap_genisligi', 1);
    var kitapYuk = sayi(g.kitapYuk, 'kitap_yuksekligi', 1);
    var tm = sayi(g.mukavvaKalinlik, 'mukavva_kalinligi', 0); // t (mukavva); t() metin işlevi
    var k = sayi(g.tasma, 'tasma', 0);
    var e = sayi(g.kivirma, 'kivirma_payi', 0);
    [['mukavva_kalinligi', tm], ['kivirma_payi', e]].forEach(function (c) {
      if (!(c[1] > 0)) throw new RangeError(t('hesap.pozitif', { ad: ad(c[0]), deger: c[1] }));
    });
    // taşma 0 olabilir (mukavva blokla aynı hizada); negatif olamaz
    if (!(k >= 0)) throw new RangeError(t('hesap.tasma_negatif', { deger: k }));
    if (g.sirtTipi !== 'duz' && g.sirtTipi !== 'yuvarlak') throw new Error(t('hesap.sirt_tipi', { deger: g.sirtTipi }));
    if (g.sirtKurali !== 'ikiT' && g.sirtKurali !== 'yalnizS') throw new Error(t('hesap.sirt_kurali', { deger: g.sirtKurali }));

    var mafsalOtomatik = g.mafsal === 'otomatik';
    var mafsalKaynakYok = false, f;
    if (mafsalOtomatik) {
      f = mafsalOtomatikDegeri(tm);
      mafsalKaynakYok = tm > 3;
    } else {
      f = sayi(g.mafsal, 'mafsal', 0);
      if (!(f > 0)) throw new RangeError(t('hesap.pozitif', { ad: ad('mafsal'), deger: g.mafsal }));
    }

    var W = kitapGen, H = kitapYuk;
    var Db = yuvarla(W - f + k);
    var Dh = yuvarla(H + 2 * k);

    var egriBoyuUyari = false, R, fKaplama = f;
    if (g.sirtTipi === 'yuvarlak') {
      var egri;
      if (g.egriBoyu === undefined || g.egriBoyu === null || g.egriBoyu === '') {
        egri = sirt + 2 * tm;
        egriBoyuUyari = true;
      } else {
        egri = sayi(g.egriBoyu, 'sirt_egri_boyu', 0);
        if (!(egri > 0)) throw new RangeError(t('hesap.pozitif', { ad: ad('sirt_egri_boyu'), deger: g.egriBoyu }));
      }
      R = yuvarla(egri + 3);
    } else if (g.sirtKurali === 'yalnizS') {
      R = yuvarla(sirt);
      fKaplama = f + tm;
    } else {
      R = yuvarla(sirt + 2 * tm);
    }
    var mullYuk = yuvarla(H - 12);
    [
      ['hesap.ad.mukavva_gen', Db, t('hesap.neden.mafsal_buyuk', { f: f, w: W })],
      ['hesap.ad.mukavva_yuk', Dh, t('hesap.neden.yukseklik')],
      ['hesap.ad.sirt_seridi', R, t('hesap.neden.sirt')],
      ['hesap.ad.mull_yuk', mullYuk, t('hesap.neden.mull', { h: H })]
    ].forEach(function (c) {
      if (!(c[1] > 0)) throw new RangeError(t('hesap.sifir_negatif', { ad: t(c[0]), deger: c[1], neden: c[2] }));
    });
    var kaplamaGen = yuvarla(2 * Db + R + 2 * fKaplama + 2 * (e + tm));
    var kaplamaYuk = yuvarla(Dh + 2 * (e + tm));

    return {
      girdi: g,
      sayfaSayisi: Number(g.sayfaSayisi),
      toplamSayfa: tam.toplamSayfa,
      bosSayfa: tam.toplamSayfa - Math.ceil(Number(g.sayfaSayisi)),
      kitapYaprak: kitapYaprak,
      formaSayisi: tam.formaSayisi,
      sirtKalinlik: sirt,
      mukavva: { gen: Db, yuk: Dh, adet: 2 },
      sirtSeridi: { gen: R, yuk: Dh, adet: 1 },
      mafsal: f,
      mafsalKaplama: yuvarla(fKaplama),
      mafsalKaynakYok: mafsalKaynakYok,
      egriBoyuUyari: egriBoyuUyari,
      kaplama: { gen: kaplamaGen, yuk: kaplamaYuk },
      forza: { gen: yuvarla(2 * W), yuk: H, adet: 2 },
      mull: { gen: yuvarla(sirt + 50), yuk: mullYuk },
      kapital: { uzunluk: sirt, adet: 2 },
      baskiKagidi: tam.baskiKagidi + Math.max(0, Math.round(Number(g.yedekKagit) || 0))
    };
  }

  return {
    VARSAYILAN: VARSAYILAN,
    yaprakSayisi: yaprakSayisi,
    sirtKalinligi: sirtKalinligi,
    mafsalOtomatikDegeri: mafsalOtomatikDegeri,
    tamamlanmis: tamamlanmis,
    hesapla: hesapla
  };
});
