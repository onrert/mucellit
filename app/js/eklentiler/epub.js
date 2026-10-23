/*
 * epub.js — EPUB → PDF girdi dönüştürücü. Çekirdeğe eklenti noktasından (eklentiler.js) kaydolur.
 *
 * Akış: EPUB (ZIP) → zip.js → epub-paket.js (OPF, spine, DRM/FXL) → xhtml-blok.js (blok listesi)
 *   → dizgi.js (sayfalar) → pdf-yaz.js (pdf-lib + fontkit + Literata) → PDF baytları → çekirdek.
 * fontkit ve Literata (≈2,4 MB JS) ilk EPUB dönüşümünde <script> ile tembel yüklenir (file:// altında fetch yasak).
 *
 * Sayfa ölçüsü = çekirdeğin içerik kutusu: (kitapGen − ciltPayi − disKenar) × (kitapYuk − 2·disKenar) mm.
 * Çekirdek bu sayfayı ölçeklemeden (1:1) içerik kutusuna koyar, cilt payını sırt tarafına bırakır.
 * Eklentinin kendi tipografik kenarları simetriktir (üst, alt, yan).
 *
 * Konsola hiçbir şey yazmaz; hatalar arayüz dilinde mesajla atılır (KitapCilt.dil), çekirdek bildirir.
 */
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};
  function t(a, p) { return KC.dil.t(a, p); }
  var AYAR_ANAHTAR = 'kitapCilt.epubAyar';
  var MM = 72 / 25.4;
  var VARSAYILAN = { boy: 10.5, satirAraligi: 1.35, ust: 15, alt: 18, yan: 15, tireBol: true, sayfaNo: true, kapakAtla: true };
  var FONTKIT_JS = 'vendor/fontkit/fontkit.umd.min.js';
  var STIL_DOSYA = { R: 'regular', I: 'italic', B: 'bold', BI: 'bolditalic' };
  function E6() { return t('epub.E6'); }

  // ---------- tembel yükleme ----------
  var yuklenen = {};
  function scriptYukle(src) {
    if (!yuklenen[src]) {
      yuklenen[src] = new Promise(function (ok, red) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = function () { ok(); };
        s.onerror = function () { delete yuklenen[src]; s.remove(); red(new Error(E6())); };
        document.head.appendChild(s);
      });
    }
    return yuklenen[src];
  }

  var kaynak = null;
  function base64Bayt(b64) {
    var s = atob(b64);
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  async function kaynaklariYukle() {
    if (kaynak) return kaynak;
    var e6 = new Error(E6());
    try {
      await scriptYukle(FONTKIT_JS);
      await Promise.all(Object.keys(STIL_DOSYA).map(function (k) { return scriptYukle('vendor/literata/literata-' + STIL_DOSYA[k] + '.js'); }));
    } catch (e) { throw e6; }
    var yt = KC.yaziTipleri || {};
    if (!kok.fontkit || Object.keys(STIL_DOSYA).some(function (k) { return typeof yt[STIL_DOSYA[k]] !== 'string'; })) throw e6;
    var ttf = {}, fk = {};
    try {
      Object.keys(STIL_DOSYA).forEach(function (k) {
        ttf[k] = base64Bayt(yt[STIL_DOSYA[k]]);
        fk[k] = kok.fontkit.create(ttf[k]);
      });
    } catch (e) { throw e6; }
    kaynak = { ttf: ttf, fk: fk };
    return kaynak;
  }

  // ---------- ayarlar ----------
  function ayarYukle() {
    var a = Object.assign({}, VARSAYILAN);
    try { Object.assign(a, JSON.parse(KC.ortak.yerelOku(AYAR_ANAHTAR) || '{}')); } catch (e) { /* bozuk kayıt: varsayılanlar */ }
    return a;
  }

  // Etiketler sözlük anahtarı (epub.alan.* / epub.isaret.*), arayüz kurulurken çevrilir.
  var ALANLAR = [
    ['boy', 'epub-boy', 'epub.alan.boy', 6, 24, 0.5],
    ['satirAraligi', 'epub-satir', 'epub.alan.satir', 1, 3, 0.05],
    ['ust', 'epub-ust', 'epub.alan.ust', 0, 60, 0.5],
    ['alt', 'epub-alt', 'epub.alan.alt', 0, 60, 0.5],
    ['yan', 'epub-yan', 'epub.alan.yan', 0, 60, 0.5]
  ];
  var ISARETLER = [
    ['tireBol', 'epub-tire', 'epub.isaret.tire', 'epub.isaret.tire_not'],
    ['sayfaNo', 'epub-sayfa-no', 'epub.isaret.sayfa_no', null],
    ['kapakAtla', 'epub-kapak-atla', 'epub.isaret.kapak_atla', null]
  ];

  function ayarArayuzu(kap) {
    var O = KC.ortak, el = O.el;
    var a = ayarYukle();
    var cocuklar = [el('summary', { text: t('epub.ayarlar') })];
    ALANLAR.forEach(function (f) {
      cocuklar.push(el('label', { class: 'alan' }, [el('span', { text: t(f[2]) }),
        // sayı alanı type=text + data-sayi (dilin ondalık ayracı; ortak.sayiAlanlariKur)
        el('input', { type: 'text', inputmode: 'decimal', 'data-sayi': '', id: f[1], min: String(f[3]), max: String(f[4]), step: String(f[5]), value: KC.dil.sayiAlan(a[f[0]]) })]));
    });
    ISARETLER.forEach(function (f) {
      cocuklar.push(el('label', { class: 'secim' }, [el('input', { type: 'checkbox', id: f[1], checked: !!a[f[0]] }), ' ' + t(f[2])]));
      if (f[3]) cocuklar.push(el('p', { class: 'kucuk', id: f[1] + '-not', text: t(f[3]) }));
    });
    cocuklar.push(el('p', { class: 'kucuk', text: t('epub.olcu_notu') }));
    cocuklar.push(el('div', { id: 'epub-uyari' }));
    var d = el('details', { id: 'epub-ayarlari' }, cocuklar);
    d.addEventListener('change', function () { try { ayarOku(); } catch (e) { /* kaydetme yalnız geçerliyse */ } });
    kap.appendChild(d);
  }

  /** Arayüzden okur, doğrular, saklar. Geçersizse anlaşılır hata atar. */
  function ayarOku() {
    var O = KC.ortak, $ = O.$;
    var a = ayarYukle();
    if ($('epub-ayarlari')) {
      ALANLAR.forEach(function (f) {
        var v = O.sayi(f[1], NaN);
        if (!(v >= f[3] && v <= f[4])) throw new Error(t('epub.ayar_aralik', { ad: t(f[2]), enaz: f[3], encok: f[4] }));
        a[f[0]] = v;
      });
      ISARETLER.forEach(function (f) { a[f[0]] = !!$(f[1]).checked; });
      O.yerelYaz(AYAR_ANAHTAR, JSON.stringify(a));
    }
    return a;
  }

  /** U1 uyarısı #epub-uyari kutusunda; kutu kapalı "EPUB ayarları" bölümündeyse bölüm açılır (uyarı görünür olsun). */
  function uyariGoster(metin) {
    var u = KC.ortak.$('epub-uyari');
    if (!u) return;
    u.textContent = '';
    if (metin) {
      u.appendChild(KC.ortak.el('div', { class: 'uyari', text: metin }));
      var d = KC.ortak.$('epub-ayarlari');
      if (d) d.open = true;
    }
  }

  function nefes() { return new Promise(function (ok) { setTimeout(ok, 0); }); }

  /** İlk spine belgesi yalnız manifestteki kapak resmiyse kapak sayılır. */
  function kapakMi(bloklar, kapakYolu) {
    var icerik = bloklar.filter(function (b) { return b.tur !== 'sayfaSonu'; });
    return !!kapakYolu && icerik.length === 1 && icerik[0].tur === 'resim' && icerik[0].resim.anahtar === kapakYolu;
  }

  // ---------- dönüştürücü ----------
  async function donustur(dosya, secenek) {
    var ilerleme = (secenek && secenek.ilerleme) || function () {};
    // çekirdek bu dönüşümden sonra başka bir dosya seçildiyse false döner: bayat uyarı yazılmaz
    var guncelMi = (secenek && typeof secenek.guncelMi === 'function') ? secenek.guncelMi : function () { return true; };
    uyariGoster('');
    var a = ayarOku();
    if (!kok.PDFLib) throw new Error(t('hata.pdflib'));
    var kitapGen = secenek.kitapGen, kitapYuk = secenek.kitapYuk;
    var ciltPayi = secenek.ciltPayi || 0, disKenar = secenek.disKenar || 0;
    var sayfaGenMm = kitapGen - ciltPayi - disKenar;
    var sayfaYukMm = kitapYuk - 2 * disKenar;
    if (!(sayfaGenMm > 60) || !(sayfaYukMm > 60)) {
      throw new Error(t('epub.sayfa_kucuk', { gen: Math.round(sayfaGenMm), yuk: Math.round(sayfaYukMm) }));
    }
    if (sayfaGenMm - 2 * a.yan < 20 || sayfaYukMm - a.ust - a.alt < 20) throw new Error(t('epub.kenar_sigmiyor'));

    ilerleme(t('epub.ilerleme.yazi_tipi'));
    var k = await kaynaklariYukle();
    var bayt = new Uint8Array(await dosya.arrayBuffer());
    var zip = KC.epubZip.oku(bayt);
    var paket = await KC.epubPaket.paketOku(zip);
    var ortam = { zip: zip, dil: paket.dil, cssOnbellek: new Map(), resimler: {}, sayac: { atlananResim: 0, tablo: 0 } };
    var bloklar = [];
    var n = paket.spine.length;
    for (var i = 0; i < n; i++) {
      ilerleme(t('epub.ilerleme.bolum', { i: i + 1, n: n }));
      var yol = paket.spine[i].yol;
      var r = await KC.xhtmlBlok.belgeyiBloklara(await zip.metin(yol), yol, ortam);
      if (i === 0 && a.kapakAtla && kapakMi(r.bloklar, paket.kapakYolu)) continue;
      if (!r.bloklar.length) continue;
      bloklar.push({ tur: 'bolumBasi' });
      for (var j = 0; j < r.bloklar.length; j++) bloklar.push(r.bloklar[j]);
      await nefes();
    }
    if (!bloklar.length) { var e5 = new Error(KC.epubPaket.MESAJ.E5); e5.kod = 'E5'; throw e5; }
    var eksikKarakter = KC.pdfYaz.kapsamDuzelt(bloklar, function (cp) { return k.fk.R.hasGlyphForCodePoint(cp); });

    ilerleme(t('epub.ilerleme.dizgi'));
    var genPt = sayfaGenMm * MM, yukPt = sayfaYukMm * MM;
    var dz = await KC.epubDizgi.dizAsync(bloklar, {
      sayfaGen: genPt, sayfaYuk: yukPt,
      kenar: { ust: a.ust * MM, alt: a.alt * MM, ic: a.yan * MM, dis: a.yan * MM },
      boy: a.boy, satirAraligi: a.satirAraligi, tireBol: a.tireBol, sayfaNo: a.sayfaNo
    }, KC.epubDizgi.fontkitOlcer(k.fk));
    if (!dz.sayfalar.length) { var e = new Error(KC.epubPaket.MESAJ.E5); e.kod = 'E5'; throw e; }

    ilerleme(t('epub.ilerleme.pdf_yaz', { n: dz.sayfalar.length }));
    var ekUyari = [];
    var pdf = await KC.pdfYaz.pdfYaz(dz.sayfalar, { genPt: genPt, yukPt: yukPt, baslik: paket.baslik, yazar: paket.yazar, dil: paket.dil },
      { PDFLib: kok.PDFLib, fontkit: kok.fontkit, fontlar: k.ttf, resimler: ortam.resimler, uyarilar: ekUyari, sayac: ortam.sayac });

    var s = ortam.sayac;
    var metin = [];
    if (s.atlananResim || s.tablo || dz.uyarilar.dusukDpi) {
      metin.push(t('epub.uyari.resim_tablo', { resim: s.atlananResim, tablo: s.tablo, dpi: dz.uyarilar.dusukDpi }));
    }
    if (eksikKarakter) metin.push(t('epub.uyari.eksik_karakter', { n: eksikKarakter }));
    var desteksiz = zip.desteksizKodlamalar ? zip.desteksizKodlamalar() : [];
    if (desteksiz.length) metin.push(t('epub.uyari.kodlama', { kodlamalar: desteksiz.join(', ') }));
    metin = metin.concat(ekUyari);
    if (guncelMi()) uyariGoster(metin.join(' '));
    return pdf;
  }

  // '.epub.zip': Apple Kitaplar'ın klasör paketi EPUB'u Safari/WebKit dosya girişinde klasörün ZIP'i olarak gelir;
  // zip.js tek üst klasör önekini atar (tekKlasorOneki), içerik sıradan EPUB gibi işlenir.
  KC.eklentiler.kaydet({ ad: 'EPUB → PDF', uzantilar: ['.epub', '.epub.zip'], mime: ['application/epub+zip'], ayarArayuzu: ayarArayuzu, donustur: donustur,
    sifirla: function () { uyariGoster(''); } });
  KC.epub = { donustur: donustur, ayarOku: ayarOku, VARSAYILAN: VARSAYILAN };
})(typeof self !== 'undefined' ? self : this);
