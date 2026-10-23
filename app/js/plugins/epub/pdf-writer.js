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
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    root.Mucellit = root.Mucellit || {};
    root.Mucellit.writePdf = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STYLES = ['R', 'I', 'B', 'BI'];

  var root = typeof self !== 'undefined' ? self : globalThis; // vm bağlamında da KitapCilt.dil bulunur
  function I18n() { return (root && root.Mucellit && root.Mucellit.i18n) || require('../../i18n.js'); }
  function t(a, p) { return I18n().t(a, p); }

  function fontError(e) { var h = new Error(t('pdfwriter.embedFailed')); h.font = true; h.cause = e; return h; }
  /** Beklenmeyen hata anlaşılır metne çevrilir (kodlu hatalar olduğu gibi). */
  function turkishError(e) { if (e && e.code) return e; var h = new Error(t('pdfwriter.writeFailed')); h.cause = e; return h; }

  async function write(pages, info, sources, subset) {
    var PDFLib = sources.PDFLib;
    var doc = await PDFLib.PDFDocument.create();
    doc.registerFontkit(sources.fontkit);
    var used = {};
    pages.forEach(function (s) { s.elements.forEach(function (o) { if (o.kind === 'text') used[o.style] = true; }); });
    var fonts = {};
    for (var i = 0; i < STYLES.length; i++) {
      var st = STYLES[i];
      if (!used[st]) continue;
      try {
        fonts[st] = await doc.embedFont(sources.fonts[st], { subset: subset, features: { liga: false } });
      } catch (e) { throw fontError(e); }
    }
    var thumbs = {};
    var skipped = 0;
    async function image(key) {
      if (key in thumbs) return thumbs[key];
      var r = sources.thumbs && sources.thumbs[key];
      var img = null;
      if (r) {
        try {
          img = r.kind === 'jpg' ? await doc.embedJpg(r.bytes) : await doc.embedPng(r.bytes);
          await img.embed();
        } catch (e) { img = null; skipped += 1; } // bozuk resim: atlanır, sayılır
      }
      thumbs[key] = img;
      return img;
    }
    for (var n = 0; n < pages.length; n++) {
      var s = pages[n];
      var page = doc.addPage([info.genPt, info.heightPt]);
      for (var j = 0; j < s.elements.length; j++) {
        var o = s.elements[j];
        if (o.kind === 'text') {
          var text = String(o.text).replace(/[\r\n]/g, ' ');
          if (!text) continue;
          page.drawText(o.space ? text + ' ' : text, { x: o.x, y: o.y, size: o.fontSize, font: fonts[o.style] || fonts.R });
        } else if (o.kind === 'image') {
          var img = await image(o.key);
          if (img) page.drawImage(img, { x: o.x, y: o.y, width: o.w, height: o.h });
        }
      }
    }
    // yazı tipi alt kümesi burada (kaydetmeden önce) gömülür: hata kaynağı ayrılabilsin
    for (var k in fonts) {
      try { await fonts[k].embed(); } catch (e) { throw fontError(e); }
    }
    if (info.title) doc.setTitle(info.title);
    if (info.writes) doc.setAuthor(info.writes);
    if (info.i18n) doc.setLanguage(info.i18n);
    doc.setProducer('Mücellit EPUB');
    doc.setCreator('Mücellit');
    var bytes = await doc.save();
    if (skipped && sources.counter) sources.counter.skippedImage = (sources.counter.skippedImage || 0) + skipped;
    return bytes;
  }

  async function writePdf(pages, info, sources) {
    try {
      return await write(pages, info, sources, true);
    } catch (e) {
      if (!e || !e.font) throw turkishError(e);
      // pdf-lib alt küme hataları (ör. #1396) için yedek yol, yalnız yazı tipi hatasında: alt kümesiz gömme
      if (sources.warnings) sources.warnings.push(t('pdfwriter.subset_warning'));
      try {
        return await write(pages, info, sources, false);
      } catch (e2) { throw turkishError(e2 && e2.font ? e2.cause : e2); }
    }
  }

  /** Yazı tipinde glifi olmayan karakterleri '?' yapar (U+FFFD / boş glif çıkmasın); değiştirilen karakter sayısı. */
  function fixScope(blocks, has) {
    var number = 0;
    var cache = {};
    function fix(s) {
      var output = '';
      for (var ch of s) {
        var cp = ch.codePointAt(0);
        var var_ = cp === 0x20 || cp === 0xa0 || cp === 0xad;
        if (!var_) { if (!(cp in cache)) cache[cp] = !!has(cp); var_ = cache[cp]; }
        if (var_) output += ch; else { output += '?'; number += 1; }
      }
      return output;
    }
    blocks.forEach(function (b) {
      (b.parts || []).forEach(function (p) { if (!p.lineBreak && p.text) p.text = fix(p.text); });
      if (b.prefix) b.prefix = fix(b.prefix);
    });
    return number;
  }

  return { writePdf: writePdf, fixScope: fixScope };
});
