/*
 * pdf-writer.js — writes the typeset PAGE list (typeset.js) with pdf-lib into a vector, searchable PDF
 * (Mucellit.pdfWriter / module.exports; works in Node too).
 *
 *   await writePdf(pages, { widthPt, heightPt, title, author, lang }, sources) → Uint8Array
 *   sources: { PDFLib, fontkit, fonts: { R, I, B, BI } (TTF bytes), images: { key: { kind, bytes } }, warnings: [],
 *              counter: { skippedImage } (optional; the number of broken images that could not be embedded is added) }
 *   fixScope(blocks, has) → number of characters missing from the font (replaced by '?')
 *
 * Font: Literata, embedded as a subset, 'liga' off (in Turkish the fi ligature swallows the dot of the i).
 * Every word is written with its own drawText and, inside a line, followed by one space: pdf.js and viewers
 * recognise the word gaps from that space. Only when embedding the font fails is the document written again
 * without subsetting (warning).
 * An image that cannot be embedded (broken) is skipped and added to counter.skippedImage; its place stays empty.
 * The library's raw (English) error text is not shown to the user; the original error is in .cause.
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

  var root = typeof self !== 'undefined' ? self : globalThis; // Mucellit.i18n is found in a vm context too
  function I18n() { return (root && root.Mucellit && root.Mucellit.i18n) || require('../../i18n.js'); }
  function t(a, p) { return I18n().t(a, p); }

  function fontError(e) { var h = new Error(t('pdfwriter.embed_failed')); h.font = true; h.cause = e; return h; }
  /** An unexpected error is turned into a clear text (coded errors stay as they are). */
  function localizedError(e) { if (e && e.code) return e; var h = new Error(t('pdfwriter.write_failed')); h.cause = e; return h; }

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
    var images = {};
    var skipped = 0;
    async function image(key) {
      if (key in images) return images[key];
      var r = sources.images && sources.images[key];
      var img = null;
      if (r) {
        try {
          img = r.kind === 'jpg' ? await doc.embedJpg(r.bytes) : await doc.embedPng(r.bytes);
          await img.embed();
        } catch (e) { img = null; skipped += 1; } // broken image: skipped, counted
      }
      images[key] = img;
      return img;
    }
    for (var n = 0; n < pages.length; n++) {
      var s = pages[n];
      var page = doc.addPage([info.widthPt, info.heightPt]);
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
    // the font subset is embedded here (before saving): so that the source of an error can be told apart
    for (var k in fonts) {
      try { await fonts[k].embed(); } catch (e) { throw fontError(e); }
    }
    if (info.title) doc.setTitle(info.title);
    if (info.author) doc.setAuthor(info.author);
    if (info.lang) doc.setLanguage(info.lang);
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
      if (!e || !e.font) throw localizedError(e);
      // fallback path for pdf-lib subset errors (e.g. #1396), only on a font error: embedding without subsetting
      if (sources.warnings) sources.warnings.push(t('pdfwriter.subset_warning'));
      try {
        return await write(pages, info, sources, false);
      } catch (e2) { throw localizedError(e2 && e2.font ? e2.cause : e2); }
    }
  }

  /** Replaces characters without a glyph in the font by '?' (so that no U+FFFD / empty glyph appears); the number of replaced characters. */
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
