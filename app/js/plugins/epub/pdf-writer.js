/*
 * pdf-writer.js — dizilmiş SAYFA listesini (typeset.js) pdf-lib ile vektör ve aranabilir PDF'e yazar
 * (KitapCilt.pdfYaz / module.exports; Node'da da çalışır).
 *
 *   await pdfYaz(sayfalar, { genPt, yukPt, baslik, yazar, dil }, kaynaklar) → Uint8Array
 *   kaynaklar: { PDFLib, fontkit, fontlar: { R, I, B, BI } (TTF baytları), resimler: { anahtar: { tur, bytes } }, uyarilar: [],
 *                sayac: { atlananResim } (isteğe bağlı; gömülemeyen bozuk resim sayısı buna eklenir) }
 *   kapsamDuzelt(bloklar, varMi) → yazı tipinde olmayan karakter sayısı (yerlerine '?' konur)
 *
 * Yazı tipi: Literata, alt küme (subset) olarak gömülür, 'liga' kapalı (Türkçede fi bağı i noktasını yutar).
 * Her kelime ayrı drawText ile ve satır içindeyse sonuna bir boşlukla yazılır: pdf.js ve görüntüleyiciler
 * kelime aralarını bu boşluktan tanır. Yalnız yazı tipi gömme hata verirse belge alt kümesiz yeniden yazılır (uyarı).
 * Gömülemeyen (bozuk) resim atlanır ve sayac.atlananResim'e eklenir; yeri boş kalır.
 * Kullanıcıya kütüphanenin ham (İngilizce) hata metni gösterilmez; özgün hata .cause'dadır.
 */
(function (kok, fabrika) {
  var m = fabrika();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    kok.KitapCilt = kok.KitapCilt || {};
    kok.KitapCilt.pdfYaz = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STILLER = ['R', 'I', 'B', 'BI'];

  var kok = typeof self !== 'undefined' ? self : globalThis; // vm bağlamında da KitapCilt.dil bulunur
  function Dil() { return (kok && kok.KitapCilt && kok.KitapCilt.dil) || require('../../i18n.js'); }
  function t(a, p) { return Dil().t(a, p); }

  function yaziTipiHatasi(e) { var h = new Error(t('pdfyaz.gomulemedi')); h.yaziTipi = true; h.cause = e; return h; }
  /** Beklenmeyen hata anlaşılır metne çevrilir (kodlu hatalar olduğu gibi). */
  function turkceHata(e) { if (e && e.kod) return e; var h = new Error(t('pdfyaz.yazilamadi')); h.cause = e; return h; }

  async function yaz(sayfalar, bilgi, kaynaklar, altKume) {
    var PDFLib = kaynaklar.PDFLib;
    var doc = await PDFLib.PDFDocument.create();
    doc.registerFontkit(kaynaklar.fontkit);
    var kullanilan = {};
    sayfalar.forEach(function (s) { s.ogeler.forEach(function (o) { if (o.tur === 'metin') kullanilan[o.stil] = true; }); });
    var fontlar = {};
    for (var i = 0; i < STILLER.length; i++) {
      var st = STILLER[i];
      if (!kullanilan[st]) continue;
      try {
        fontlar[st] = await doc.embedFont(kaynaklar.fontlar[st], { subset: altKume, features: { liga: false } });
      } catch (e) { throw yaziTipiHatasi(e); }
    }
    var resimler = {};
    var atlanan = 0;
    async function resim(anahtar) {
      if (anahtar in resimler) return resimler[anahtar];
      var r = kaynaklar.resimler && kaynaklar.resimler[anahtar];
      var img = null;
      if (r) {
        try {
          img = r.tur === 'jpg' ? await doc.embedJpg(r.bytes) : await doc.embedPng(r.bytes);
          await img.embed();
        } catch (e) { img = null; atlanan += 1; } // bozuk resim: atlanır, sayılır
      }
      resimler[anahtar] = img;
      return img;
    }
    for (var n = 0; n < sayfalar.length; n++) {
      var s = sayfalar[n];
      var sayfa = doc.addPage([bilgi.genPt, bilgi.yukPt]);
      for (var j = 0; j < s.ogeler.length; j++) {
        var o = s.ogeler[j];
        if (o.tur === 'metin') {
          var yazi = String(o.metin).replace(/[\r\n]/g, ' ');
          if (!yazi) continue;
          sayfa.drawText(o.bosluk ? yazi + ' ' : yazi, { x: o.x, y: o.y, size: o.boy, font: fontlar[o.stil] || fontlar.R });
        } else if (o.tur === 'resim') {
          var img = await resim(o.anahtar);
          if (img) sayfa.drawImage(img, { x: o.x, y: o.y, width: o.w, height: o.h });
        }
      }
    }
    // yazı tipi alt kümesi burada (kaydetmeden önce) gömülür: hata kaynağı ayrılabilsin
    for (var k in fontlar) {
      try { await fontlar[k].embed(); } catch (e) { throw yaziTipiHatasi(e); }
    }
    if (bilgi.baslik) doc.setTitle(bilgi.baslik);
    if (bilgi.yazar) doc.setAuthor(bilgi.yazar);
    if (bilgi.dil) doc.setLanguage(bilgi.dil);
    doc.setProducer('Mücellit EPUB');
    doc.setCreator('Mücellit');
    var bayt = await doc.save();
    if (atlanan && kaynaklar.sayac) kaynaklar.sayac.atlananResim = (kaynaklar.sayac.atlananResim || 0) + atlanan;
    return bayt;
  }

  async function pdfYaz(sayfalar, bilgi, kaynaklar) {
    try {
      return await yaz(sayfalar, bilgi, kaynaklar, true);
    } catch (e) {
      if (!e || !e.yaziTipi) throw turkceHata(e);
      // pdf-lib alt küme hataları (ör. #1396) için yedek yol, yalnız yazı tipi hatasında: alt kümesiz gömme
      if (kaynaklar.uyarilar) kaynaklar.uyarilar.push(t('pdfyaz.alt_kume_uyari'));
      try {
        return await yaz(sayfalar, bilgi, kaynaklar, false);
      } catch (e2) { throw turkceHata(e2 && e2.yaziTipi ? e2.cause : e2); }
    }
  }

  /** Yazı tipinde glifi olmayan karakterleri '?' yapar (U+FFFD / boş glif çıkmasın); değiştirilen karakter sayısı. */
  function kapsamDuzelt(bloklar, varMi) {
    var sayi = 0;
    var onbellek = {};
    function duzelt(s) {
      var cikti = '';
      for (var ch of s) {
        var cp = ch.codePointAt(0);
        var var_ = cp === 0x20 || cp === 0xa0 || cp === 0xad;
        if (!var_) { if (!(cp in onbellek)) onbellek[cp] = !!varMi(cp); var_ = onbellek[cp]; }
        if (var_) cikti += ch; else { cikti += '?'; sayi += 1; }
      }
      return cikti;
    }
    bloklar.forEach(function (b) {
      (b.parcalar || []).forEach(function (p) { if (!p.kir && p.metin) p.metin = duzelt(p.metin); });
      if (b.onEk) b.onEk = duzelt(b.onEk);
    });
    return sayi;
  }

  return { pdfYaz: pdfYaz, kapsamDuzelt: kapsamDuzelt };
});
