/*
 * yerlesim.js — baskı yaprağı geometrisi, DOM'suz saf modül
 * (KitapCilt.yerlesim / module.exports).
 *
 * Koordinatlar mm, başlangıç noktası kağıdın SOL ALT köşesi (PDF ile aynı).
 * Bir dizilim sonucunu (dizilim.js) alır; her yaprağın ön ve arka yüzü için
 * sayfa yuvalarını, içerik kutularını, kırım/katlama çizgilerini ve forma
 * sırt işaretini üretir. PDF'e çizmek cikti.js'in işidir.
 */
(function (kok, fabrika) {
  var m = fabrika();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    kok.KitapCilt = kok.KitapCilt || {};
    kok.KitapCilt.yerlesim = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var kok = typeof self !== 'undefined' ? self : globalThis; // vm bağlamında da KitapCilt.dil bulunur
  function Dil() { return (kok && kok.KitapCilt && kok.KitapCilt.dil) || require('./dil.js'); }
  function t(a, p) { return Dil().t(a, p); }

  var ISARET_BOSLUK = 2;   // kırım işaretinin kitap bloğuna uzaklığı
  var ISARET_BOY = 5;      // kırım işareti çizgi boyu
  var KATLAMA_BOY = 5;     // katlama işareti, kağıt kenarından içeri
  var SIRT_GEN = 3;        // forma sırt işareti genişliği
  var SIRT_YUK = 5;        // forma sırt işareti yüksekliği (basamak)
  var SIRT_STIL = 4;       // sırt işareti biçim sayısı: 0 dolu, 1 çerçeve, 2 iki küçük kare, 3 üç küçük kare

  function yuvarla(x) { return Math.round(x * 1e6) / 1e6; }

  function sayi(v, varsayilan) {
    var n = Number(v);
    return isFinite(n) ? n : varsayilan;
  }

  /** Sayfa numarasının sırt (cilt) tarafı: tek sayfalar sağdadır, sırtı solda. */
  function sirtTarafi(tur, yuvaNo, sayfa) {
    if (tur === 'formali') return yuvaNo === 0 ? 'sag' : 'sol';
    return sayfa % 2 === 1 ? 'sol' : 'sag';
  }

  /**
   * Kaynak sayfayı içerik kutusuna yerleştirir.
   * sayfaGen/sayfaYuk: kaynak sayfanın döndürülmemiş ölçüsü (mm)
   * aci: saat yönünde toplam döndürme (0/90/180/270)
   * olcek: 'sigdir' | 'gercek' | 'doldur'
   * Döner: { s (ölçek), gen, yuk (görünen, ölçekli), merkezX, merkezY }
   */
  function sayfaYerlestir(kutu, sayfaGen, sayfaYuk, aci, olcek) {
    var a = ((Number(aci) || 0) % 360 + 360) % 360;
    var dg = a % 180 === 0 ? sayfaGen : sayfaYuk;
    var dy = a % 180 === 0 ? sayfaYuk : sayfaGen;
    var s;
    if (olcek === 'gercek') s = 1;
    else if (olcek === 'doldur') s = Math.max(kutu.w / dg, kutu.h / dy);
    else s = Math.min(kutu.w / dg, kutu.h / dy);
    return {
      s: s,
      gen: dg * s,
      yuk: dy * s,
      merkezX: kutu.x + kutu.w / 2,
      merkezY: kutu.y + kutu.h / 2
    };
  }

  /**
   * Döndürülmüş çizimin başlangıç noktası: genişliği w, yüksekliği h olan
   * (ölçekli, döndürülmemiş) bir kutu, başlangıç noktası etrafında saat
   * yönünün TERSİNE `aciTers` derece döndürüldüğünde merkezi (mx, my)'ye
   * gelsin diye başlangıç noktasının nereye konacağı.
   */
  function cizimKokeni(mx, my, w, h, aciTers) {
    var r = aciTers * Math.PI / 180;
    var c = Math.cos(r), s = Math.sin(r);
    var ox = (w / 2) * c - (h / 2) * s;
    var oy = (w / 2) * s + (h / 2) * c;
    return { x: yuvarla(mx - ox), y: yuvarla(my - oy) };
  }

  /**
   * Arka yüzler 180° döndürülmeli mi?
   * Dizilim, kağıdın içerik yönünde DİKEY eksen etrafında çevrildiğini varsayar
   * (arka yüz düz; sağdaki sayfanın arkası solda). Yazıcı ayarı fiziksel kağıt
   * kenarına göredir:
   *  - yatay kağıt (gen > yük): dikey eksen kısa kenara paraleldir →
   *    "kısa kenar" düz, "uzun kenar" arka yüzleri ters basar → 180° döndür.
   *  - dikey kağıt (gen <= yük): dikey eksen uzun kenara paraleldir →
   *    "uzun kenar" düz, "kısa kenar" ters basar → 180° döndür.
   */
  function arkaDondurulsunMu(cevirme, kagitGen, kagitYuk) {
    var yatay = Number(kagitGen) > Number(kagitYuk);
    var kisa = cevirme === 'kisa';
    return yatay ? !kisa : kisa;
  }

  function dondur180Kutu(k, PW, PH) {
    var y = {};
    Object.keys(k).forEach(function (a) { y[a] = k[a]; });
    y.x = yuvarla(PW - k.x - k.w);
    y.y = yuvarla(PH - k.y - k.h);
    return y;
  }

  function dondur180Cizgi(c, PW, PH) {
    return { x1: yuvarla(PW - c.x1), y1: yuvarla(PH - c.y1), x2: yuvarla(PW - c.x2), y2: yuvarla(PH - c.y2), kesik: c.kesik };
  }

  /**
   * ayar: { kagitGen, kagitYuk, kitapGen, kitapYuk, disKenar=0, ciltPayi=0,
   *         kirim=true, katlama=true, sirtIsareti=true,
   *         cevirme='kisa'|'uzun' (yazıcının çift yüz çevirme ayarı) }
   */
  function yerlesim(dizilim, ayar) {
    var PW = sayi(ayar.kagitGen, 0), PH = sayi(ayar.kagitYuk, 0);
    var BW = sayi(ayar.kitapGen, 0), BH = sayi(ayar.kitapYuk, 0);
    if (!(PW > 0 && PH > 0 && BW > 0 && BH > 0)) throw new RangeError(t('yerlesim.olcu_pozitif'));
    var dis = sayi(ayar.disKenar, 0);
    var cilt = sayi(ayar.ciltPayi, 0);
    if (dis < 0 || cilt < 0) throw new RangeError(t('yerlesim.kenar_negatif'));
    var tur = dizilim.tur;
    var yuvaSayisi = dizilim.yuvaSayisi;
    var uyarilar = [];

    var blokGen = BW * yuvaSayisi;
    var sigmiyor = blokGen > PW + 0.01 || BH > PH + 0.01;
    if (sigmiyor) {
      uyarilar.push(t('yerlesim.sigmiyor', { n: yuvaSayisi, bw: BW, bh: BH, pw: PW, ph: PH }));
    }
    if (BW - dis - cilt <= 0 || BH - 2 * dis <= 0) {
      uyarilar.push(t('yerlesim.icerik_yok'));
    }
    var bx = (PW - blokGen) / 2;
    var by = (PH - BH) / 2;
    var ortaX = PW / 2;

    // Kırım/katlama çizgileri (yaprağın iki yüzünde de aynı konumda)
    var cizgilerOrtak = [];
    function kirimEkle(x1, y1, x2, y2) {
      // çizgiyi kağıdın içine kırp; çok kısa kalırsa atla
      var c = { x1: Math.max(0, Math.min(PW, x1)), y1: Math.max(0, Math.min(PH, y1)),
        x2: Math.max(0, Math.min(PW, x2)), y2: Math.max(0, Math.min(PH, y2)) };
      if (Math.hypot(c.x2 - c.x1, c.y2 - c.y1) >= 1) cizgilerOrtak.push(c);
    }
    if (ayar.kirim !== false) {
      var g = ISARET_BOSLUK, L = ISARET_BOY;
      var xs = [bx, bx + blokGen], ys = [by, by + BH];
      xs.forEach(function (x) {
        var yon = x === bx ? -1 : 1;
        ys.forEach(function (y) {
          var yyon = y === by ? -1 : 1;
          kirimEkle(x + yon * g, y, x + yon * (g + L), y);         // yatay
          kirimEkle(x, y + yyon * g, x, y + yyon * (g + L));       // dikey
        });
      });
      if (tur === 'tek2') { // ortadan kesim çizgisi işareti
        kirimEkle(ortaX, by - g, ortaX, by - g - L);
        kirimEkle(ortaX, by + BH + g, ortaX, by + BH + g + L);
      }
    }
    var katlamaCizgileri = [];
    if (tur === 'formali' && ayar.katlama !== false) {
      katlamaCizgileri.push({ x1: ortaX, y1: PH, x2: ortaX, y2: PH - KATLAMA_BOY, kesik: true });
      katlamaCizgileri.push({ x1: ortaX, y1: 0, x2: ortaX, y2: KATLAMA_BOY, kesik: true });
    }

    var sirtBasamak = Math.max(1, Math.floor((BH - 10) / SIRT_YUK));
    var arkaDonsun = arkaDondurulsunMu(ayar.cevirme, PW, PH);
    var yuzler = [];

    dizilim.yapraklar.forEach(function (yap) {
      ['on', 'arka'].forEach(function (yuz) {
        var sayfalar = yap[yuz];
        var yuvalar = sayfalar.map(function (sayfa, yuvaNo) {
          var yuva = { x: yuvarla(bx + yuvaNo * BW), y: yuvarla(by), w: BW, h: BH };
          var taraf = sirtTarafi(tur, yuvaNo, sayfa);
          var kay = tur === 'formali' ? (yap.kayma || 0) : 0;
          var icX = yuva.x + (taraf === 'sol' ? cilt : dis) + (taraf === 'sol' ? -kay : kay);
          var icerik = { x: yuvarla(icX), y: yuvarla(by + dis), w: yuvarla(Math.max(0, BW - cilt - dis)), h: yuvarla(Math.max(0, BH - 2 * dis)) };
          return { sayfa: sayfa, bos: dizilim.bosMu(sayfa), yuva: yuva, icerik: icerik, sirtTaraf: taraf, kayma: kay };
        });
        var cizgiler = cizgilerOrtak.concat(katlamaCizgileri);
        var kareler = [];
        if (tur === 'formali' && ayar.sirtIsareti !== false && yuz === 'on' && yap.formaIci === 0) {
          // Basamak sayısı (sirtBasamak, kitap yüksekliğine bağlı) aşılınca işaret yana kaymaz, hep katlama
          // çizgisinde (ortaX) kalır; yeni turda basamaklar yeniden yukarıdan başlar ve işaret BİÇİMİ değişir
          // (tur 0 dolu, 1 çerçeve, 2 iki küçük kare, 3 üç küçük kare; sonra başa döner). (tur, basamak) çifti benzersizdir.
          var basamak = yap.forma % sirtBasamak;
          var tur2 = Math.floor(yap.forma / sirtBasamak);
          kareler.push({ x: yuvarla(ortaX - SIRT_GEN / 2), y: yuvarla(by + BH - 5 - (basamak + 1) * SIRT_YUK), w: SIRT_GEN, h: SIRT_YUK, forma: yap.forma, tur: tur2, basamak: basamak, stil: tur2 % SIRT_STIL });
        }
        var donuk = arkaDonsun && yuz === 'arka';
        if (donuk) {
          yuvalar = yuvalar.map(function (y) {
            var k = {}; Object.keys(y).forEach(function (a) { k[a] = y[a]; });
            k.yuva = dondur180Kutu(y.yuva, PW, PH);
            k.icerik = dondur180Kutu(y.icerik, PW, PH);
            return k;
          });
          cizgiler = cizgiler.map(function (c) { return dondur180Cizgi(c, PW, PH); });
          kareler = kareler.map(function (k) { return dondur180Kutu(k, PW, PH); });
        }
        yuzler.push({ yaprak: yap.no, forma: yap.forma, formaIci: yap.formaIci, yuz: yuz, dondur180: donuk, yuvalar: yuvalar, cizgiler: cizgiler, kareler: kareler });
      });
    });

    return { kagit: { gen: PW, yuk: PH }, kitap: { gen: BW, yuk: BH }, yuzler: yuzler, uyarilar: uyarilar, sigmiyor: sigmiyor };
  }

  /** Sırt işaretinin çizilecek dolu dikdörtgenleri (mm; çizen taraf hepsini doldurur). Merkez x değişmez. */
  function isaretParcalari(kr) {
    var stil = kr.stil || 0, k = 0.6;
    function r(dx, dy, w, h) { return { x: yuvarla(kr.x + dx), y: yuvarla(kr.y + dy), w: w, h: h }; }
    if (stil === 1) { // çerçeve (içi boş)
      return [r(0, 0, kr.w, k), r(0, kr.h - k, kr.w, k), r(0, k, k, kr.h - 2 * k), r(kr.w - k, k, k, kr.h - 2 * k)];
    }
    if (stil === 2 || stil === 3) { // 2 ya da 3 küçük kare, dikey dizili, yatayda ortalı
      var n = stil, a = n === 2 ? 1.5 : 1.2, ara = (kr.h - n * a) / (n + 1), liste = [];
      for (var i = 0; i < n; i++) liste.push(r((kr.w - a) / 2, ara + i * (a + ara), a, a));
      return liste;
    }
    return [r(0, 0, kr.w, kr.h)];
  }

  return {
    isaretParcalari: isaretParcalari,
    yerlesim: yerlesim,
    sayfaYerlestir: sayfaYerlestir,
    cizimKokeni: cizimKokeni,
    sirtTarafi: sirtTarafi,
    arkaDondurulsunMu: arkaDondurulsunMu
  };
});
