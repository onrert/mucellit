/*
 * output.js — dizilmiş baskı PDF'ini pdf-lib ile üretir (tarayıcıda, PDFLib global).
 * Girdi: kaynak PDF bytes, düzenlenmiş sayfa listesi, ayarlar.
 * Hiçbir ağ isteği yapmaz; her şey bellekte.
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  function t(a, p) { return MC.i18n.t(a, p); }

  var MM = 72 / 25.4;
  function pt(mm) { return mm * MM; }

  /**
   * secenek: {
   *   kaynakBytes: Uint8Array | null,
   *   sayfalar: [{ tur: 'pdf', kaynak: <0'dan sayfa indisi>, dondur: 0|90|180|270 } | { tur: 'bos' }],
   *   ayar: Düzenle ayarları (ciltTuru, kagitGen, ..., ciktiModu, arkaTers),
   * }
   * Döner: { dizilim, yerlesim, dosyalar: [{ ad, bytes, yuz }] } (yuz: o dosyadaki yüz/sayfa sayısı)
   */
  async function build(options) {
    var PDFLib = root.PDFLib;
    if (!PDFLib) throw new Error(t('error.pdflib'));
    var settings = options.settings;
    var pages = options.pages;
    if (!pages.length) throw new Error(t('output.no_pages'));

    var imposition = MC.imposition.impose(settings.bindingType, {
      pageCount: pages.length,
      sheetsPerSignature: settings.sheetsPerSignature,
      shrinkLastSignature: settings.shrinkLastSignature,
      creepEnabled: settings.creep,
      paperThickness: settings.paperThickness
    });
    var place = MC.layout.layout(imposition, settings);
    if (place.doesNotFit) throw new Error(place.warnings[0] || t('output.doesNotFit'));

    var sourceDoc = null;
    var used = {};
    pages.forEach(function (s) { if (s.kind === 'pdf') used[s.source] = true; });
    var indices = Object.keys(used).map(Number).sort(function (a, b) { return a - b; });

    function newDocument() { return PDFLib.PDFDocument.create(); }

    async function prepare(doc) {
      var map = {};
      if (indices.length) {
        if (!sourceDoc) sourceDoc = await PDFLib.PDFDocument.load(options.sourceBytes, { ignoreEncryption: true });
        var toEmbed = [], boxes = [], embedIndices = [];
        indices.forEach(function (i) {
          var sf = sourceDoc.getPage(i);
          var content = sf.node.Contents();
          // /Contents'siz (ya da boş dizili) kaynak sayfa pdf-lib'de gömülemez ("missing Contents"): boş sayfa sayılır.
          if (!content || (content instanceof PDFLib.PDFArray && content.size() === 0)) {
            map[i] = { blank: true };
            return;
          }
          // Gömme kutusu CropBox (yoksa MediaBox): kutu verilmezse MediaBox kökeni (0,0) değilse içerik kayar,
          // CropBox'ın dışındaki taşma payı da basılırdı. Önizleme (pdf.js) de CropBox'ı kullanır.
          var cb = sf.getCropBox();
          toEmbed.push(sf);
          boxes.push({ left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height });
          embedIndices.push(i);
        });
        var embedded = toEmbed.length ? await doc.embedPages(toEmbed, boxes) : [];
        embedIndices.forEach(function (i, j) {
          map[i] = { embedded: embedded[j], angle: toEmbed[j].getRotation().angle || 0 };
        });
      }
      return map;
    }

    function drawSide(doc, map, side) {
      var page = doc.addPage([pt(place.paper.width), pt(place.paper.height)]);
      side.slots.forEach(function (yv) {
        if (yv.blank) return;
        var record = pages[yv.page - 1];
        if (!record || record.kind !== 'pdf') return;
        var g = map[record.source];
        if (!g || g.blank) return;
        var e = g.embedded;
        var angleCw = ((g.angle + (record.rotate || 0) + (side.rotate180 ? 180 : 0)) % 360 + 360) % 360;
        var widthMm = e.width / MM, heightMm = e.height / MM;
        var fit = MC.layout.fitPage(yv.content, widthMm, heightMm, angleCw, settings.scaling);
        var w = pt(widthMm * fit.s), h = pt(heightMm * fit.s);
        var origin0 = MC.layout.drawOrigin(pt(fit.centerX), pt(fit.centerY), w, h, -angleCw);
        var k = yv.content;
        page.pushOperators(
          PDFLib.pushGraphicsState(),
          PDFLib.rectangle(pt(k.x), pt(k.y), pt(k.w), pt(k.h)),
          PDFLib.clip(),
          PDFLib.endPath()
        );
        page.drawPage(e, { x: origin0.x, y: origin0.y, xScale: fit.s, yScale: fit.s, rotate: PDFLib.degrees(-angleCw) });
        page.pushOperators(PDFLib.popGraphicsState());
      });
      var black = PDFLib.rgb(0, 0, 0);
      side.lines.forEach(function (c) {
        page.drawLine({
          start: { x: pt(c.x1), y: pt(c.y1) }, end: { x: pt(c.x2), y: pt(c.y2) },
          thickness: 0.4, color: black, dashArray: c.dashed ? [2, 2] : undefined
        });
      });
      side.squares.forEach(function (kr) {
        MC.layout.markParts(kr).forEach(function (pr) {
          page.drawRectangle({ x: pt(pr.x), y: pt(pr.y), width: pt(pr.w), height: pt(pr.h), color: black });
        });
      });
    }

    // Dosya adı ekleri ve PDF başlığı arayüz dilinde (en: -imposed, -fronts, -backs; tr: -dizilmis, -onler, -arkalar).
    var base = (options.fileName || t('output.name.book')).replace(/\.[^.]+$/, '');
    var files = [];
    if (settings.outputMode === 'pair') {
      var frontDoc = await newDocument(), backDoc = await newDocument();
      var hFront = await prepare(frontDoc), hBack = await prepare(backDoc);
      var fronts = place.sides.filter(function (y) { return y.side === 'front'; });
      var backs = place.sides.filter(function (y) { return y.side === 'back'; });
      if (settings.backsReversed) backs = backs.slice().reverse();
      fronts.forEach(function (y) { drawSide(frontDoc, hFront, y); });
      backs.forEach(function (y) { drawSide(backDoc, hBack, y); });
      frontDoc.setTitle(t('output.title.fronts', { name: base }));
      backDoc.setTitle(t('output.title.backs', { name: base }));
      files.push({ name: base + t('output.ek.fronts') + '.pdf', bytes: await frontDoc.save(), side: fronts.length });
      files.push({ name: base + t('output.ek.backs') + (settings.backsReversed ? t('output.ek.reversed') : '') + '.pdf', bytes: await backDoc.save(), side: backs.length });
    } else {
      var doc = await newDocument();
      var h = await prepare(doc);
      place.sides.forEach(function (y) { drawSide(doc, h, y); });
      doc.setTitle(t('output.title.imposed', { name: base }));
      files.push({ name: base + t('output.ek.imposed') + '.pdf', bytes: await doc.save(), side: place.sides.length });
    }
    return { imposition: imposition, layout: place, files: files };
  }

  MC.output = { build: build, MM: MM };
})(typeof self !== 'undefined' ? self : this);
