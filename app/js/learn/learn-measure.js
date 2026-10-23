/*
 * learn-measure.js — "Kitabın sayıları" paneli: kitabın beş sayısından rehberin bütün ölçüleri.
 * Cilt ölçüleri Mücellit'in kendi hesabından gelir (KitapCilt.hesap.hesapla). (uygulamaya ekleme): öntanımlı
 * sayılar Hesapla sekmesinin girdileri ve onun hesap sonucudur (taban; aynı kaynak, kopya hesap yok): rehber Hesapla'nın
 * mukavva kalınlığını, taşmayı, kıvırmayı, mafsalı, forza payını, sırt şeridi kuralını aynen kullanır; yalnız cilt türü
 * hep formalı dikiş ve sırt hep düz çizilir (rehberin konusu). Panelde elle değişiklik yalnız rehberde kalır.
 * Taban yoksa (Hesapla okunamadı) yedek öntanımlı: Örnek Kitap (11 forma × 4 kâğıt, 148 × 210, 0,1 mm).
 * Rehberin ek varsayımları (araçta yok):
 *   delik:  uçlardan 15 mm içeride birer kettle deliği, aralık en çok 40 mm, çift sayıda delik (kaynaksız varsayım;
 *           MEB-2021 s.26 örneğinde uçlar ~25 mm, Cockerell ~6 mm)
 *   iplik:  yaklaşık (forma + 2) × kitap boyu, 10 mm'ye yuvarlanır (kaynaksız yaklaşık kural)
 *   köşe:   mukavva köşesinden t + 2 … t + 3 mm (MEGEP-2008 s.36: "mukavva kalınlığından 2-3 mm fazla"; MEB-2021 s.75: 5 mm)
 * Tarayıcıda KitapCilt.ogren.olcu, Node'da module.exports (testler).
 * LİSANS NOTU: Mücellit kodu (MIT, kökteki LICENSE); Colorfigures kodu içermez. Bu klasördeki Colorfigures parçaları MIT lisanslı
 * (April Zhu, Tolga Cohce), tam metin: LICENSE.
 */
(function (kok, fabrika) {
  var m = fabrika(kok);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { kok.KitapCilt = kok.KitapCilt || {}; kok.KitapCilt.ogren = kok.KitapCilt.ogren || {}; kok.KitapCilt.ogren.olcu = m; }
})(typeof self !== 'undefined' ? self : this, function (kok) {
  'use strict';
  var VARSAYILAN = { formaSayisi: 11, formaYaprak: 4, kitapGen: 148, kitapYuk: 210, kagitKalinlik: 0.1 };
  // [en az, en çok, tam sayı mı]
  var SINIR = {
    formaSayisi: [1, 40, true], formaYaprak: [1, 8, true],
    kitapGen: [60, 300, false], kitapYuk: [80, 420, false], kagitKalinlik: [0.04, 0.4, false]
  };
  var UC_PAYI = 15, EN_COK_ARALIK = 40;

  function yuvarla(x) { return Math.round(x * 1000) / 1000; }

  /** "8,8" / "8.8" / 8.8 → 8.8; boş ya da bozuk → NaN. Binlik ayracı kabul edilmez. */
  function sayiOku(v) {
    if (typeof v === 'number') return v;
    var s = String(v == null ? '' : v).trim().replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return Number(s);
  }

  /** Geçersiz alanların adları (boş dizi = geçerli). */
  function gecersizAlanlar(g) {
    return Object.keys(SINIR).filter(function (a) {
      var v = sayiOku(g[a]), s = SINIR[a];
      return !isFinite(v) || v < s[0] || v > s[1] || (s[2] && !Number.isInteger(v));
    });
  }

  function istasyonlar(H) {
    var ic = H - 2 * UC_PAYI;
    var aralikSayisi = Math.max(1, Math.ceil(ic / EN_COK_ARALIK));
    if (aralikSayisi % 2 === 0) aralikSayisi += 1;   // delik sayısı = aralık + 1, çift olmalı
    var aralik = ic / aralikSayisi, konum = [];
    for (var i = 0; i <= aralikSayisi; i++) konum.push(yuvarla(UC_PAYI + i * aralik));
    return { sayi: konum.length, aralik: yuvarla(aralik), konum: konum, ucPayi: UC_PAYI };
  }

  function hesapModulu() {
    if (kok && kok.KitapCilt && kok.KitapCilt.hesap) return kok.KitapCilt.hesap;
    return require('../calc.js');
  }

  var ALANLAR = Object.keys(VARSAYILAN);

  /**
   * Hesapla sekmesinin durumundan taban: { girdi (rehberin hesap girdisi: formalı, düz sırt), sonuc (o girdinin
   * hesap sonucu), bes (panelin beş alanı), uyum (Hesapla'da cilt türü formalı ve sırt düz mü) }.
   * durum: { girdi, sonuc, hata } (KitapCilt.hesapla.durum()). Hesapla formalı + düz sırttaysa Hesapla'nın kendi sonucu
   * aynen kullanılır (yeniden hesaplanmaz). Hata: Hesapla hatalıysa { hata }, rehberin sınırları dışındaysa { alanlar }.
   */
  function tabandan(durum, H) {
    if (!durum || durum.hata || !durum.girdi || !durum.sonuc) return { hata: durum && durum.hata ? durum.hata : true };
    var hg = {}, d = durum.girdi;
    Object.keys(d).forEach(function (a) { if (a !== 'hatalar') hg[a] = d[a]; });
    var uyum = hg.ciltTuru === 'formali' && hg.sirtTipi !== 'yuvarlak';
    var sonuc = durum.sonuc;
    if (!uyum) {
      hg.ciltTuru = 'formali'; hg.sirtTipi = 'duz'; delete hg.egriBoyu;
      try { sonuc = (H || hesapModulu()).hesapla(hg); } catch (e) { return { hata: e && e.message ? e.message : String(e) }; }
    }
    var bes = { formaSayisi: sonuc.formaSayisi, formaYaprak: Number(sonuc.girdi.formaYaprak), kitapGen: Number(sonuc.girdi.kitapGen),
      kitapYuk: Number(sonuc.girdi.kitapYuk), kagitKalinlik: Number(sonuc.girdi.kagitKalinlik) };
    var hatali = gecersizAlanlar(bes);
    if (hatali.length) return { alanlar: hatali, bes: bes };
    return { girdi: hg, sonuc: sonuc, bes: bes, uyum: uyum };
  }

  /**
   * girdi: { formaSayisi, formaYaprak, kitapGen, kitapYuk, kagitKalinlik } (eksik alan tabandan, taban yoksa öntanımlı).
   * taban: tabandan() sonucu (isteğe bağlı). Beş alan tabanla aynıysa tabanın hesap sonucu aynen kullanılır; değilse hesap
   * girdisi = taban girdisi (mukavva, taşma, kıvırma, mafsal …) + beş alan: forma sayısı ya da forma yaprağı değiştiyse
   * sayfa = forma × kâğıt × 4 (son forma tam), değişmediyse Hesapla'nın sayfa sayısı ve son forma ayarı kalır.
   * Geçersizse RangeError (e.alanlar = geçersiz alan adları). H: hesap modülü (testte başka bir kopya verilebilir).
   */
  function hesapla(girdi, taban, H) {
    var tb = taban && taban.girdi && taban.sonuc ? taban : null;
    var vs = tb ? tb.bes : VARSAYILAN;
    var g = {};
    ALANLAR.forEach(function (a) {
      var v = girdi && girdi[a] != null && girdi[a] !== '' ? girdi[a] : vs[a];
      g[a] = v;
    });
    var hatali = gecersizAlanlar(g);
    if (hatali.length) { var e = new RangeError('ogren-olcu: ' + hatali.join(', ')); e.alanlar = hatali; throw e; }
    ALANLAR.forEach(function (a) { g[a] = sayiOku(g[a]); });
    var N = g.formaSayisi, y = g.formaYaprak, h, hg;
    if (tb && ALANLAR.every(function (a) { return g[a] === tb.bes[a]; })) {
      h = tb.sonuc;
    } else {
      hg = {};
      if (tb) Object.keys(tb.girdi).forEach(function (a) { hg[a] = tb.girdi[a]; });
      var ayniForma = tb && N === tb.bes.formaSayisi && y === tb.bes.formaYaprak;
      hg.ciltTuru = 'formali';
      if (tb) hg.sirtTipi = 'duz';
      hg.sayfaSayisi = ayniForma ? tb.girdi.sayfaSayisi : N * y * 4;
      if (tb) hg.sonFormaKucult = ayniForma ? !!tb.girdi.sonFormaKucult : false;
      hg.formaYaprak = y;
      hg.kitapGen = g.kitapGen; hg.kitapYuk = g.kitapYuk; hg.kagitKalinlik = g.kagitKalinlik;
      h = (H || hesapModulu()).hesapla(hg);
    }
    var t = Number(h.girdi.mukavvaKalinlik), ist = istasyonlar(g.kitapYuk);
    return {
      girdi: g, hesap: h, kaynak: h === (tb && tb.sonuc) ? 'hesapla' : 'rehber',
      N: h.formaSayisi, y: y, W: g.kitapGen, H: g.kitapYuk, kagit: g.kagitKalinlik,
      sayfa: h.toplamSayfa, yaprak: h.kitapYaprak, baskiKagidi: h.baskiKagidi,
      S: h.sirtKalinlik, t: t, k: Number(h.girdi.tasma), e: Number(h.girdi.kivirma), f: h.mafsal,
      Db: h.mukavva.gen, Dh: h.mukavva.yuk, R: h.sirtSeridi.gen,
      kaplama: h.kaplama, forza: h.forza, mull: h.mull, kapital: h.kapital.uzunluk,
      istasyon: ist, iplik: Math.round((h.formaSayisi + 2) * g.kitapYuk / 10) * 10,
      kose: [yuvarla(t + 2), yuvarla(t + 3)]
    };
  }

  return { VARSAYILAN: VARSAYILAN, SINIR: SINIR, UC_PAYI: UC_PAYI, EN_COK_ARALIK: EN_COK_ARALIK,
    sayiOku: sayiOku, gecersizAlanlar: gecersizAlanlar, istasyonlar: istasyonlar, tabandan: tabandan, hesapla: hesapla };
});
