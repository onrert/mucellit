/*
 * zip.js — EPUB için küçük, salt okunur ZIP okuyucu (KitapCilt.epubZip / module.exports).
 *
 * EPUB yalnız "stored" (0) ve "Deflate" (8) girdilerine izin verir (EPUB 3.3 §4.3.2).
 * Deflate, tarayıcının yerleşik DecompressionStream('deflate-raw') akışıyla açılır
 * (Chrome 103+, Node 21.2+); ek kütüphane yoktur. ZIP64 ve başka sıkıştırma yöntemleri
 * anlaşılır bir hatayla reddedilir; şifreli girdi (genel amaçlı bayrak bit 0) E3'tür.
 *
 *   var z = KitapCilt.epubZip.oku(bytes);   // Uint8Array | ArrayBuffer; bozuksa E1 hatası atar
 *   z.adlar()            → ['mimetype', 'META-INF/container.xml', …]  (klasörler hariç)
 *   z.var(ad)            → true/false (tam ad; yoksa büyük/küçük harf duyarsız eşleşme)
 *   await z.ac(ad)       → Uint8Array
 *   await z.metin(ad)    → string (UTF-8; BOM'a göre UTF-16; XML bildirimi başka kodlama diyorsa o kodlamayla)
 *   z.desteksizKodlamalar() → tanınmayan XML kodlama adları (o belgeler UTF-8 olarak okundu)
 *   z.kokOneki()         → atılan üst klasör öneki ("Kitap.epub/") ya da '' (bkz. tekKlasorOneki: klasör paketi
 *                          EPUB'un tarayıcıda "<ad>.epub.zip" olarak sıkıştırılmış hali)
 *   KitapCilt.epubZip.oku(bytes, { enCokAcilan }) → girdi başına açılmış boyut sınırı (varsayılan 256 MB)
 *   KitapCilt.epubZip.yolCoz('OEBPS/text/', '../img/a%20b.png') → 'OEBPS/img/a b.png'
 *
 * Hata nesnelerinde .kod alanı vardır ('E1', 'E3', 'E7'); metinler e2e'de birebir sınanır.
 */
(function (kok, fabrika) {
  var m = fabrika();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    kok.KitapCilt = kok.KitapCilt || {};
    kok.KitapCilt.epubZip = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var kok = typeof self !== 'undefined' ? self : globalThis; // vm bağlamında da KitapCilt.dil bulunur
  function Dil() { return (kok && kok.KitapCilt && kok.KitapCilt.dil) || require('../../i18n.js'); }
  function t(a, p) { return Dil().t(a, p); }

  // Kullanıcı metinleri okundukları anda o anki dilde (sözlükte epub.E1 …).
  var MESAJ = {};
  ['E1', 'E3', 'E7'].forEach(function (k) {
    Object.defineProperty(MESAJ, k, { get: function () { return t('epub.' + k); }, enumerable: true });
  });

  /** ayrinti: [anahtar, parametreler] (sözlükte epub.ayrinti.<anahtar>). */
  function hata(kod, ayrinti) {
    var a = ayrinti ? t('epub.ayrinti.' + ayrinti[0], ayrinti[1]) : '';
    var e = new Error(kod === 'E7' ? t('epub.E7_ayrintili', { ayrinti: a }) : MESAJ[kod]);
    e.kod = kod;
    if (kod !== 'E7' && a) e.ayrinti = a;
    return e;
  }

  // CP437 üst yarısı (0x80–0xFF): bayrak bit 11 kapalı ve ad UTF-8 değilse kullanılır.
  var CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
    'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

  function adCoz(b, utf8Bayrak) {
    var ascii = true;
    for (var i = 0; i < b.length; i++) if (b[i] >= 0x80) { ascii = false; break; }
    if (ascii) return String.fromCharCode.apply(null, b);
    if (utf8Bayrak) return new TextDecoder('utf-8').decode(b);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) {
      var s = '';
      for (var j = 0; j < b.length; j++) s += b[j] < 0x80 ? String.fromCharCode(b[j]) : CP437.charAt(b[j] - 0x80);
      return s;
    }
  }

  /** Yol normalleştirme: ters bölü → '/', kök ve '..' kırpılır (ZIP dışına çıkan yol olmaz). */
  function normal(yol) {
    var cikti = [];
    String(yol).replace(/\\/g, '/').split('/').forEach(function (p) {
      if (p === '' || p === '.') return;
      if (p === '..') { cikti.pop(); return; }
      cikti.push(p);
    });
    return cikti.join('/');
  }

  /** taban: belgenin bulunduğu klasör ('OEBPS/text/' ya da 'OEBPS/text/b1.xhtml'); goreli: href. */
  function yolCoz(taban, goreli) {
    var h = String(goreli || '').replace(/[#?].*$/, '');
    try { h = decodeURIComponent(h); } catch (e) { /* bozuk % kodu: olduğu gibi */ }
    if (h.charAt(0) === '/') return normal(h);
    var tb = String(taban || '');
    tb = tb.slice(0, tb.lastIndexOf('/') + 1);
    return normal(tb + h);
  }

  var CRC_TABLO = (function () {
    var tablo = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tablo[n] = c >>> 0;
    }
    return tablo;
  })();

  function crc32(b) {
    var c = 0xffffffff;
    for (var i = 0; i < b.length; i++) c = CRC_TABLO[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Sıkıştırma bombası sınırı: bir girdi açılınca en çok bu kadar bayt (bildirilen boyut da bunu aşamaz).
  var MUTLAK_SINIR = 256 * 1024 * 1024;

  /**
   * Deflate akışını parça parça açar; açılan veri beklenen boyutu (merkezi dizindeki bildirim) aşar aşmaz
   * okuma kesilir ve E1 verilir (bütün akış belleğe alınmaz).
   */
  async function inflate(veri, beklenen, ad) {
    if (typeof DecompressionStream === 'undefined') {
      // Mac uygulamasında "Chrome/Edge" önerisi yanıltır: macOS metni
      var P = kok && kok.KitapCilt && kok.KitapCilt.platform;
      throw hata('E7', [P && P.ad === 'tauri' ? 'deflate_yok_mac' : 'deflate_yok']);
    }
    var okuyucu = new Blob([veri]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    var cikti = new Uint8Array(beklenen);
    var n = 0;
    for (;;) {
      var r = await okuyucu.read();
      if (r.done) break;
      var p = r.value;
      if (n + p.length > beklenen) {
        try { await okuyucu.cancel(); } catch (e) { /* yok say */ }
        throw hata('E1', ['boyut_asiyor', { ad: ad }]);
      }
      cikti.set(p, n);
      n += p.length;
    }
    return n === beklenen ? cikti : cikti.subarray(0, n);
  }

  /** XML bildirimindeki kodlama adı (yoksa null); yalnız ASCII başlık okunur. */
  function xmlKodlamasi(d) {
    var bas = '';
    for (var i = 0; i < Math.min(d.length, 200); i++) {
      if (d[i] === 0 || d[i] >= 0x80) break;
      bas += String.fromCharCode(d[i]);
    }
    var m = /^\s*<\?xml[^>]*?\sencoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/.exec(bas);
    return m ? m[1] : null;
  }

  function sistemArtigi(a) { return /^__MACOSX(\/|$)/.test(a) || /(^|\/)\.DS_Store$/.test(a); }

  /**
   * Bütün (sistem artığı olmayan) girdiler tek bir "X/" klasöründeyse, kökte META-INF/container.xml yoksa ve
   * "X/META-INF/container.xml" varsa "X/" döner; aksi halde null (EPUB olduğu gibi okunur).
   */
  function tekKlasorOneki(adlar) {
    if (adlar.some(function (a) { return a.toLowerCase() === 'meta-inf/container.xml'; })) return null;
    var asil = adlar.filter(function (a) { return !sistemArtigi(a); });
    if (!asil.length) return null;
    var i = asil[0].indexOf('/');
    if (i <= 0) return null;
    var onek = asil[0].slice(0, i + 1);
    if (!asil.every(function (a) { return a.slice(0, onek.length) === onek && a.length > onek.length; })) return null;
    var hedef = (onek + 'META-INF/container.xml').toLowerCase();
    return asil.some(function (a) { return a.toLowerCase() === hedef; }) ? onek : null;
  }

  /**
   * secenek: { enCokAcilan } — bir girdinin açılmış boyutu için üst sınır (varsayılan 256 MB; test için küçültülebilir).
   */
  function oku(girdi, secenek) {
    var sinir = (secenek && secenek.enCokAcilan) || MUTLAK_SINIR;
    var b = girdi instanceof Uint8Array ? girdi : new Uint8Array(girdi);
    var v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    var n = b.length;
    if (n < 22) throw hata('E1', ['cok_kisa']);
    // EOCD (0x06054b50) sondan aranır; sonundaki yorum en çok 65 535 bayt
    var eocd = -1;
    for (var i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw hata('E1', ['eocd_yok']);
    if (eocd >= 20 && v.getUint32(eocd - 20, true) === 0x07064b50) throw hata('E7', ['zip64']);
    var adet = v.getUint16(eocd + 10, true);
    var cdBoyut = v.getUint32(eocd + 12, true);
    var cdOfset = v.getUint32(eocd + 16, true);
    if (adet === 0xffff || cdBoyut === 0xffffffff || cdOfset === 0xffffffff) throw hata('E7', ['zip64']);
    if (v.getUint16(eocd + 4, true) !== 0 || v.getUint16(eocd + 6, true) !== 0) throw hata('E7', ['cok_parcali']);
    if (cdOfset + cdBoyut > eocd) throw hata('E1', ['dizin_sinir']);

    // Prototipsiz tablolar: 'constructor', '__proto__', 'toString' gibi girdi adları Object.prototype ile karışmaz.
    var girdiler = Object.create(null);
    var sira = [];
    var p = cdOfset;
    for (var k = 0; k < adet; k++) {
      if (p + 46 > eocd || v.getUint32(p, true) !== 0x02014b50) throw hata('E1', ['dizin_girdisi']);
      var bayrak = v.getUint16(p + 8, true);
      var yontem = v.getUint16(p + 10, true);
      var crc = v.getUint32(p + 16, true);
      var sikisik = v.getUint32(p + 20, true);
      var boyut = v.getUint32(p + 24, true);
      var adUz = v.getUint16(p + 28, true), ekUz = v.getUint16(p + 30, true), yorumUz = v.getUint16(p + 32, true);
      var ofset = v.getUint32(p + 42, true);
      if (sikisik === 0xffffffff || boyut === 0xffffffff || ofset === 0xffffffff) throw hata('E7', ['zip64']);
      if (p + 46 + adUz > eocd) throw hata('E1', ['ad_sinir']);
      var hamAd = adCoz(b.subarray(p + 46, p + 46 + adUz), (bayrak & 0x800) !== 0);
      p += 46 + adUz + ekUz + yorumUz;
      if (/\/$/.test(hamAd)) continue; // klasör
      var ad = normal(hamAd);
      if (!ad) continue;
      if (bayrak & 1) throw hata('E3', ['sifreli_girdi', { ad: ad }]);
      if (!(ad in girdiler)) sira.push(ad);
      girdiler[ad] = { yontem: yontem, sikisikBoyut: sikisik, boyut: boyut, ofset: ofset, bayrak: bayrak, crc: crc };
    }
    // Klasör paketi EPUB'un tarayıcı sıkıştırması (Safari/WebKit, Apple Kitaplar'daki klasör paketini "<ad>.epub.zip"
    // olarak verir): bütün girdiler tek bir üst klasördeyse ve EPUB kapsayıcısı (META-INF/container.xml) kökte değil
    // o klasördeyse, klasör öneki atılır. macOS'un eklediği __MACOSX/ ve .DS_Store girdileri yok sayılır.
    var onek = tekKlasorOneki(sira);
    if (onek) {
      var kisaGirdiler = Object.create(null), kisaSira = [];
      sira.forEach(function (a) {
        if (a.slice(0, onek.length) !== onek) return;
        var kisa = a.slice(onek.length);
        if (!kisa || sistemArtigi(kisa) || (kisa in kisaGirdiler)) return;
        kisaGirdiler[kisa] = girdiler[a];
        kisaSira.push(kisa);
      });
      girdiler = kisaGirdiler;
      sira = kisaSira;
    }
    var kucukHarf = Object.create(null);
    sira.forEach(function (a) { var l = a.toLowerCase(); if (!(l in kucukHarf)) kucukHarf[l] = a; });

    function bul(ad) {
      var a = normal(ad);
      if (a in girdiler) return a;
      var l = a.toLowerCase();
      return l in kucukHarf ? kucukHarf[l] : null;
    }

    async function ac(ad) {
      var gercek = bul(ad);
      if (gercek === null) {
        var e = new Error(t('epub.dosya_yok', { ad: ad }));
        e.kod = 'YOK';
        throw e;
      }
      var g = girdiler[gercek];
      var o = g.ofset;
      if (o + 30 > n || v.getUint32(o, true) !== 0x04034b50) throw hata('E1', ['yerel_baslik', { ad: gercek }]);
      var bas = o + 30 + v.getUint16(o + 26, true) + v.getUint16(o + 28, true);
      if (bas + g.sikisikBoyut > n) throw hata('E1', ['veri_sinir', { ad: gercek }]);
      var ham = b.subarray(bas, bas + g.sikisikBoyut);
      if (g.boyut > sinir) throw hata('E1', ['acilmis_sinir', { boyut: g.boyut, ad: gercek }]);
      var cikti;
      if (g.yontem === 0) cikti = ham.slice();
      else if (g.yontem === 8) {
        try { cikti = await inflate(ham, g.boyut, gercek); } catch (err) {
          if (err && err.kod) throw err;
          throw hata('E1', ['deflate', { ad: gercek }]);
        }
      } else throw hata('E7', ['yontem', { yontem: g.yontem, ad: gercek }]);
      if (cikti.length !== g.boyut || crc32(cikti) !== g.crc) throw hata('E1', ['crc', { ad: gercek }]);
      return cikti;
    }

    var desteksizKodlama = [];
    function desteklenenKodlama(k) { try { new TextDecoder(k); return true; } catch (e) { return false; } }
    /**
     * Metin çözümü: BOM varsa UTF-16/UTF-8; yoksa XML bildirimindeki kodlama (ör. windows-1254, iso-8859-9)
     * TextDecoder ile; tarayıcının tanımadığı kodlama UTF-8 olarak okunur ve desteksizKodlamalar()'a yazılır.
     */
    async function metin(ad) {
      var d = await ac(ad);
      if (d.length >= 2 && d[0] === 0xfe && d[1] === 0xff) return new TextDecoder('utf-16be').decode(d);
      if (d.length >= 2 && d[0] === 0xff && d[1] === 0xfe) return new TextDecoder('utf-16le').decode(d);
      if (d.length >= 3 && d[0] === 0xef && d[1] === 0xbb && d[2] === 0xbf) return new TextDecoder('utf-8').decode(d);
      var kod = xmlKodlamasi(d);
      // BOM yok: bildirim ne derse desin, geçerli UTF-8 olan ve çok baytlı dizi içeren içerik UTF-8 okunur (yanlış bildirim)
      if (kod && !/^(utf-?8|us-ascii|ascii)$/i.test(kod) && desteklenenKodlama(kod)) {
        var cokBayt = false;
        for (var q = 0; q < d.length; q++) { if (d[q] >= 0x80) { cokBayt = true; break; } }
        if (cokBayt) {
          try { return new TextDecoder('utf-8', { fatal: true }).decode(d); } catch (e) { /* UTF-8 değil: bildirilen kodlamaya geç */ }
        }
      }
      if (kod && !/^(utf-?8|utf-?16(le|be)?|ucs-?2|us-ascii|ascii)$/i.test(kod)) {
        var cozucu = null;
        try { cozucu = new TextDecoder(kod); } catch (e) { cozucu = null; }
        if (cozucu) return cozucu.decode(d);
        if (desteksizKodlama.indexOf(kod) < 0) desteksizKodlama.push(kod);
      }
      return new TextDecoder('utf-8').decode(d);
    }

    return {
      adlar: function () { return sira.slice(); },
      var: function (ad) { return bul(ad) !== null; },
      gercekAd: bul,
      girdi: function (ad) { var a = bul(ad); return a === null ? null : Object.assign({ ad: a }, girdiler[a]); },
      ac: ac,
      metin: metin,
      desteksizKodlamalar: function () { return desteksizKodlama.slice(); },
      kokOneki: function () { return onek || ''; }
    };
  }

  return { oku: oku, yolCoz: yolCoz, normal: normal, crc32: crc32, MESAJ: MESAJ };
});
