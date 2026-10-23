/*
 * cikti.js — dizilmiş baskı PDF'ini pdf-lib ile üretir (tarayıcıda, PDFLib global).
 * Girdi: kaynak PDF bytes, düzenlenmiş sayfa listesi, ayarlar.
 * Hiçbir ağ isteği yapmaz; her şey bellekte.
 */
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};
  function t(a, p) { return KC.dil.t(a, p); }

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
  async function uret(secenek) {
    var PDFLib = kok.PDFLib;
    if (!PDFLib) throw new Error(t('hata.pdflib'));
    var ayar = secenek.ayar;
    var sayfalar = secenek.sayfalar;
    if (!sayfalar.length) throw new Error(t('cikti.sayfa_yok'));

    var dizilim = KC.dizilim.diz(ayar.ciltTuru, {
      sayfaSayisi: sayfalar.length,
      formaYaprak: ayar.formaYaprak,
      sonFormaKucult: ayar.sonFormaKucult,
      kaymaAcik: ayar.kayma,
      kagitKalinlik: ayar.kagitKalinlik
    });
    var yer = KC.yerlesim.yerlesim(dizilim, ayar);
    if (yer.sigmiyor) throw new Error(yer.uyarilar[0] || t('cikti.sigmiyor'));

    var kaynakDoc = null;
    var kullanilan = {};
    sayfalar.forEach(function (s) { if (s.tur === 'pdf') kullanilan[s.kaynak] = true; });
    var indisler = Object.keys(kullanilan).map(Number).sort(function (a, b) { return a - b; });

    function yeniBelge() { return PDFLib.PDFDocument.create(); }

    async function hazirla(doc) {
      var harita = {};
      if (indisler.length) {
        if (!kaynakDoc) kaynakDoc = await PDFLib.PDFDocument.load(secenek.kaynakBytes, { ignoreEncryption: true });
        var gomulecek = [], kutular = [], gomulecekIndis = [];
        indisler.forEach(function (i) {
          var sf = kaynakDoc.getPage(i);
          var icerik = sf.node.Contents();
          // /Contents'siz (ya da boş dizili) kaynak sayfa pdf-lib'de gömülemez ("missing Contents"): boş sayfa sayılır.
          if (!icerik || (icerik instanceof PDFLib.PDFArray && icerik.size() === 0)) {
            harita[i] = { bos: true };
            return;
          }
          // Gömme kutusu CropBox (yoksa MediaBox): kutu verilmezse MediaBox kökeni (0,0) değilse içerik kayar,
          // CropBox'ın dışındaki taşma payı da basılırdı. Önizleme (pdf.js) de CropBox'ı kullanır.
          var cb = sf.getCropBox();
          gomulecek.push(sf);
          kutular.push({ left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height });
          gomulecekIndis.push(i);
        });
        var gom = gomulecek.length ? await doc.embedPages(gomulecek, kutular) : [];
        gomulecekIndis.forEach(function (i, j) {
          harita[i] = { gomulu: gom[j], aci: gomulecek[j].getRotation().angle || 0 };
        });
      }
      return harita;
    }

    function yuzCiz(doc, harita, yuz) {
      var sayfa = doc.addPage([pt(yer.kagit.gen), pt(yer.kagit.yuk)]);
      yuz.yuvalar.forEach(function (yv) {
        if (yv.bos) return;
        var kayit = sayfalar[yv.sayfa - 1];
        if (!kayit || kayit.tur !== 'pdf') return;
        var g = harita[kayit.kaynak];
        if (!g || g.bos) return;
        var e = g.gomulu;
        var aciSaat = ((g.aci + (kayit.dondur || 0) + (yuz.dondur180 ? 180 : 0)) % 360 + 360) % 360;
        var genMm = e.width / MM, yukMm = e.height / MM;
        var yerl = KC.yerlesim.sayfaYerlestir(yv.icerik, genMm, yukMm, aciSaat, ayar.olcek);
        var w = pt(genMm * yerl.s), h = pt(yukMm * yerl.s);
        var kok0 = KC.yerlesim.cizimKokeni(pt(yerl.merkezX), pt(yerl.merkezY), w, h, -aciSaat);
        var k = yv.icerik;
        sayfa.pushOperators(
          PDFLib.pushGraphicsState(),
          PDFLib.rectangle(pt(k.x), pt(k.y), pt(k.w), pt(k.h)),
          PDFLib.clip(),
          PDFLib.endPath()
        );
        sayfa.drawPage(e, { x: kok0.x, y: kok0.y, xScale: yerl.s, yScale: yerl.s, rotate: PDFLib.degrees(-aciSaat) });
        sayfa.pushOperators(PDFLib.popGraphicsState());
      });
      var siyah = PDFLib.rgb(0, 0, 0);
      yuz.cizgiler.forEach(function (c) {
        sayfa.drawLine({
          start: { x: pt(c.x1), y: pt(c.y1) }, end: { x: pt(c.x2), y: pt(c.y2) },
          thickness: 0.4, color: siyah, dashArray: c.kesik ? [2, 2] : undefined
        });
      });
      yuz.kareler.forEach(function (kr) {
        KC.yerlesim.isaretParcalari(kr).forEach(function (pr) {
          sayfa.drawRectangle({ x: pt(pr.x), y: pt(pr.y), width: pt(pr.w), height: pt(pr.h), color: siyah });
        });
      });
    }

    // Dosya adı ekleri ve PDF başlığı arayüz dilinde (en: -imposed, -fronts, -backs; tr: -dizilmis, -onler, -arkalar).
    var taban = (secenek.dosyaAdi || t('cikti.ad.kitap')).replace(/\.[^.]+$/, '');
    var dosyalar = [];
    if (ayar.ciktiModu === 'ikili') {
      var onDoc = await yeniBelge(), arkaDoc = await yeniBelge();
      var hOn = await hazirla(onDoc), hArka = await hazirla(arkaDoc);
      var onler = yer.yuzler.filter(function (y) { return y.yuz === 'on'; });
      var arkalar = yer.yuzler.filter(function (y) { return y.yuz === 'arka'; });
      if (ayar.arkaTers) arkalar = arkalar.slice().reverse();
      onler.forEach(function (y) { yuzCiz(onDoc, hOn, y); });
      arkalar.forEach(function (y) { yuzCiz(arkaDoc, hArka, y); });
      onDoc.setTitle(t('cikti.baslik.onler', { ad: taban }));
      arkaDoc.setTitle(t('cikti.baslik.arkalar', { ad: taban }));
      dosyalar.push({ ad: taban + t('cikti.ek.onler') + '.pdf', bytes: await onDoc.save(), yuz: onler.length });
      dosyalar.push({ ad: taban + t('cikti.ek.arkalar') + (ayar.arkaTers ? t('cikti.ek.ters') : '') + '.pdf', bytes: await arkaDoc.save(), yuz: arkalar.length });
    } else {
      var doc = await yeniBelge();
      var h = await hazirla(doc);
      yer.yuzler.forEach(function (y) { yuzCiz(doc, h, y); });
      doc.setTitle(t('cikti.baslik.dizilmis', { ad: taban }));
      dosyalar.push({ ad: taban + t('cikti.ek.dizilmis') + '.pdf', bytes: await doc.save(), yuz: yer.yuzler.length });
    }
    return { dizilim: dizilim, yerlesim: yer, dosyalar: dosyalar };
  }

  KC.cikti = { uret: uret, MM: MM };
})(typeof self !== 'undefined' ? self : this);
