/*
 * epub-package.js — EPUB paket bilgisi: container.xml → OPF; başlık, yazar, dil, manifest, spine, kapak;
 * DRM ve sabit sayfa (fixed-layout) denetimi (KitapCilt.epubPaket). DOMParser ister (tarayıcı).
 *
 *   await paketOku(zip) → { surum, baslik, yazar, dil, opfYolu, spine: [{ yol, linear, ozellik }], manifest, kapakYolu, uyarilar }
 *
 * Hatalar (.kod): E2 container yok, E3 DRM, E4 fixed-layout, E5 okunacak bölüm yok; OPF bulunamazsa E1.
 * DRM kuralı: META-INF/encryption.xml'de yazı tipi gizleme dışında bir EncryptedData varsa DRM sayılır
 * (IDPF gizleme: EPUB 3.3 §4.4.5; Adobe gizleme "ns.adobe.com/pdf/enc#RC"). rights.xml tek başına DRM değildir.
 * Algoritma tanımlayıcıları şemasız (alan adı + yol) karşılaştırılır.
 */
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};
  function t(a, p) { return KC.dil.t(a, p); }

  // Kullanıcı metinleri okundukları anda o anki dilde (sözlükte epub.E1 …).
  var MESAJ = {};
  ['E1', 'E2', 'E3', 'E4', 'E5'].forEach(function (k) {
    Object.defineProperty(MESAJ, k, { get: function () { return t('epub.' + k); }, enumerable: true });
  });
  // yazı tipi gizleme algoritmaları (DRM değil)
  var GIZLEME = [/(^|\/\/)www\.idpf\.org\/2008\/embedding$/, /(^|\/\/)ns\.adobe\.com\/pdf\/enc#RC$/];

  /** ayrinti: [anahtar, parametreler] (sözlükte epub.ayrinti.<anahtar>). */
  function hata(kod, ayrinti) {
    var e = new Error(MESAJ[kod]);
    e.kod = kod;
    if (ayrinti) e.ayrinti = t('epub.ayrinti.' + ayrinti[0], ayrinti[1]);
    return e;
  }

  function xml(metin) {
    var d = new DOMParser().parseFromString(metin, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) return null;
    return d;
  }
  function hepsi(d, ad) { return Array.prototype.slice.call(d.getElementsByTagNameNS('*', ad)); }
  function ilkMetin(d, ad) {
    var e = hepsi(d, ad)[0];
    return e ? String(e.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  async function drmDenetle(zip) {
    if (!zip.var('META-INF/encryption.xml')) return;
    var d = xml(await zip.metin('META-INF/encryption.xml'));
    if (!d) throw hata('E3', ['encryption_okunamadi']);
    hepsi(d, 'EncryptedData').forEach(function (ed) {
      var yontem = hepsi(ed, 'EncryptionMethod')[0];
      var alg = yontem ? String(yontem.getAttribute('Algorithm') || '').trim() : '';
      var gizleme = GIZLEME.some(function (r) { return r.test(alg); });
      if (!gizleme) throw hata('E3', ['sifreleme', { alg: alg || t('epub.ayrinti.algoritma_yok') }]);
    });
  }

  async function fxlDenetle(zip, opf) {
    var duzen = hepsi(opf, 'meta').filter(function (m) {
      return m.getAttribute('property') === 'rendition:layout';
    }).map(function (m) { return String(m.textContent || '').trim(); });
    if (duzen.indexOf('pre-paginated') >= 0) throw hata('E4');
    // eski Kindle işareti: <meta name="fixed-layout" content="true">
    var kindle = hepsi(opf, 'meta').some(function (m) {
      return m.getAttribute('name') === 'fixed-layout' && String(m.getAttribute('content')).trim() === 'true';
    });
    if (kindle) throw hata('E4');
    // eski Apple işareti: META-INF/com.apple.ibooks.display-options.xml içinde fixed-layout = true
    var elma = 'META-INF/com.apple.ibooks.display-options.xml';
    if (zip.var(elma)) {
      var d = xml(await zip.metin(elma));
      if (d && hepsi(d, 'option').some(function (o) { return o.getAttribute('name') === 'fixed-layout' && String(o.textContent).trim() === 'true'; })) throw hata('E4');
    }
  }

  async function paketOku(zip) {
    var Z = KC.epubZip;
    var uyarilar = [];
    if (!zip.var('mimetype')) uyarilar.push(t('epub.uyari.mimetype_yok'));
    else if ((await zip.metin('mimetype')).trim() !== 'application/epub+zip') uyarilar.push(t('epub.uyari.mimetype_yanlis'));
    if (!zip.var('META-INF/container.xml')) throw hata('E2');
    await drmDenetle(zip);
    var kap = xml(await zip.metin('META-INF/container.xml'));
    if (!kap) throw hata('E2', ['container_ayristirilamadi']);
    var kokler = hepsi(kap, 'rootfile');
    var kokDosya = kokler.filter(function (r) { return (r.getAttribute('media-type') || '') === 'application/oebps-package+xml'; })[0] || kokler[0];
    var opfYolu = kokDosya ? Z.normal(kokDosya.getAttribute('full-path') || '') : '';
    if (!opfYolu || !zip.var(opfYolu)) throw hata('E1', ['opf_yok', { yol: String(opfYolu) }]);
    var opf = xml(await zip.metin(opfYolu));
    if (!opf) throw hata('E1', ['opf_ayristirilamadi']);
    var paket = hepsi(opf, 'package')[0];
    var surum = paket ? String(paket.getAttribute('version') || '') : '';
    await fxlDenetle(zip, opf);

    var manifest = {};
    var kapakYolu = null;
    hepsi(opf, 'item').forEach(function (it) {
      var id = it.getAttribute('id');
      var yol = Z.yolCoz(opfYolu, it.getAttribute('href') || '');
      var ozellik = String(it.getAttribute('properties') || '').split(/\s+/);
      manifest[id] = { yol: yol, tur: String(it.getAttribute('media-type') || ''), ozellik: ozellik };
      if (ozellik.indexOf('cover-image') >= 0) kapakYolu = yol;
    });
    if (!kapakYolu) {
      // EPUB 2: <meta name="cover" content="manifest-id">
      var km = hepsi(opf, 'meta').filter(function (m) { return m.getAttribute('name') === 'cover'; })[0];
      var kid = km && km.getAttribute('content');
      if (kid && manifest[kid]) kapakYolu = manifest[kid].yol;
    }

    var ana = [], ek = [], atlanan = 0, tekFxl = 0;
    hepsi(opf, 'itemref').forEach(function (ir) {
      var m = manifest[ir.getAttribute('idref')];
      if (!m) { atlanan += 1; return; }
      var html = /xhtml|html/.test(m.tur) || /\.x?html?$/i.test(m.yol);
      if (!html || !zip.var(m.yol)) { atlanan += 1; return; }
      var oz = String(ir.getAttribute('properties') || '');
      if (/rendition:layout-pre-paginated/.test(oz)) tekFxl += 1;
      var linear = String(ir.getAttribute('linear') || 'yes').trim() !== 'no';
      (linear ? ana : ek).push({ yol: m.yol, linear: linear, ozellik: oz });
    });
    if (atlanan) uyarilar.push(t('epub.uyari.spine_atlandi', { n: atlanan }));
    if (tekFxl) uyarilar.push(t('epub.uyari.fxl_akiskan', { n: tekFxl }));
    // linear="no" öğeler (ör. sonnotlar) ana akıştan sonra eklenir
    var spine = ana.concat(ek);
    if (!spine.length) throw hata('E5');
    return {
      surum: surum, opfYolu: opfYolu,
      baslik: ilkMetin(opf, 'title'), yazar: ilkMetin(opf, 'creator'), dil: ilkMetin(opf, 'language'),
      spine: spine, manifest: manifest, kapakYolu: kapakYolu, uyarilar: uyarilar
    };
  }

  KC.epubPaket = { paketOku: paketOku, MESAJ: MESAJ };
})(typeof self !== 'undefined' ? self : this);
