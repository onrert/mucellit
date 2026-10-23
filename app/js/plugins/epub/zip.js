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
 *   z.has(ad)            → true/false (tam ad; yoksa büyük/küçük harf duyarsız eşleşme)
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
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    root.Mucellit = root.Mucellit || {};
    root.Mucellit.epubZip = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var root = typeof self !== 'undefined' ? self : globalThis; // vm bağlamında da KitapCilt.dil bulunur
  function I18n() { return (root && root.Mucellit && root.Mucellit.i18n) || require('../../i18n.js'); }
  function t(a, p) { return I18n().t(a, p); }

  // Kullanıcı metinleri okundukları anda o anki dilde (sözlükte epub.E1 …).
  var MESSAGE = {};
  ['E1', 'E3', 'E7'].forEach(function (k) {
    Object.defineProperty(MESSAGE, k, { get: function () { return t('epub.' + k); }, enumerable: true });
  });

  /** ayrinti: [anahtar, parametreler] (sözlükte epub.ayrinti.<anahtar>). */
  function error(code, detail) {
    var a = detail ? t('epub.detail.' + detail[0], detail[1]) : '';
    var e = new Error(code === 'E7' ? t('epub.E7_detailed', { detail: a }) : MESSAGE[code]);
    e.code = code;
    if (code !== 'E7' && a) e.detail = a;
    return e;
  }

  // CP437 üst yarısı (0x80–0xFF): bayrak bit 11 kapalı ve ad UTF-8 değilse kullanılır.
  var CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
    'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

  function adCoz(b, utf8Flag) {
    var ascii = true;
    for (var i = 0; i < b.length; i++) if (b[i] >= 0x80) { ascii = false; break; }
    if (ascii) return String.fromCharCode.apply(null, b);
    if (utf8Flag) return new TextDecoder('utf-8').decode(b);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) {
      var s = '';
      for (var j = 0; j < b.length; j++) s += b[j] < 0x80 ? String.fromCharCode(b[j]) : CP437.charAt(b[j] - 0x80);
      return s;
    }
  }

  /** Yol normalleştirme: ters bölü → '/', kök ve '..' kırpılır (ZIP dışına çıkan yol olmaz). */
  function normal(path) {
    var output = [];
    String(path).replace(/\\/g, '/').split('/').forEach(function (p) {
      if (p === '' || p === '.') return;
      if (p === '..') { output.pop(); return; }
      output.push(p);
    });
    return output.join('/');
  }

  /** taban: belgenin bulunduğu klasör ('OEBPS/text/' ya da 'OEBPS/text/b1.xhtml'); goreli: href. */
  function parsePath(base, relative) {
    var h = String(relative || '').replace(/[#?].*$/, '');
    try { h = decodeURIComponent(h); } catch (e) { /* bozuk % kodu: olduğu gibi */ }
    if (h.charAt(0) === '/') return normal(h);
    var tb = String(base || '');
    tb = tb.slice(0, tb.lastIndexOf('/') + 1);
    return normal(tb + h);
  }

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(b) {
    var c = 0xffffffff;
    for (var i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Sıkıştırma bombası sınırı: bir girdi açılınca en çok bu kadar bayt (bildirilen boyut da bunu aşamaz).
  var ABSOLUTE_LIMIT = 256 * 1024 * 1024;

  /**
   * Deflate akışını parça parça açar; açılan veri beklenen boyutu (merkezi dizindeki bildirim) aşar aşmaz
   * okuma kesilir ve E1 verilir (bütün akış belleğe alınmaz).
   */
  async function inflate(data, expected, name) {
    if (typeof DecompressionStream === 'undefined') {
      // Mac uygulamasında "Chrome/Edge" önerisi yanıltır: macOS metni
      var P = root && root.Mucellit && root.Mucellit.platform;
      throw error('E7', [P && P.name === 'tauri' ? 'deflate_yok_mac' : 'no_deflate']);
    }
    var reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    var output = new Uint8Array(expected);
    var n = 0;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      var p = r.value;
      if (n + p.length > expected) {
        try { await reader.cancel(); } catch (e) { /* yok say */ }
        throw error('E1', ['size_exceeds', { name: name }]);
      }
      output.set(p, n);
      n += p.length;
    }
    return n === expected ? output : output.subarray(0, n);
  }

  /** XML bildirimindeki kodlama adı (yoksa null); yalnız ASCII başlık okunur. */
  function xmlEncoding(d) {
    var head = '';
    for (var i = 0; i < Math.min(d.length, 200); i++) {
      if (d[i] === 0 || d[i] >= 0x80) break;
      head += String.fromCharCode(d[i]);
    }
    var m = /^\s*<\?xml[^>]*?\sencoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/.exec(head);
    return m ? m[1] : null;
  }

  function systemLeftover(a) { return /^__MACOSX(\/|$)/.test(a) || /(^|\/)\.DS_Store$/.test(a); }

  /**
   * Bütün (sistem artığı olmayan) girdiler tek bir "X/" klasöründeyse, kökte META-INF/container.xml yoksa ve
   * "X/META-INF/container.xml" varsa "X/" döner; aksi halde null (EPUB olduğu gibi okunur).
   */
  function singleFolderPrefix(names) {
    if (names.some(function (a) { return a.toLowerCase() === 'meta-inf/container.xml'; })) return null;
    var original = names.filter(function (a) { return !systemLeftover(a); });
    if (!original.length) return null;
    var i = original[0].indexOf('/');
    if (i <= 0) return null;
    var prefix = original[0].slice(0, i + 1);
    if (!original.every(function (a) { return a.slice(0, prefix.length) === prefix && a.length > prefix.length; })) return null;
    var target = (prefix + 'META-INF/container.xml').toLowerCase();
    return original.some(function (a) { return a.toLowerCase() === target; }) ? prefix : null;
  }

  /**
   * secenek: { enCokAcilan } — bir girdinin açılmış boyutu için üst sınır (varsayılan 256 MB; test için küçültülebilir).
   */
  function read(input, options) {
    var limit = (options && options.maxOpened) || ABSOLUTE_LIMIT;
    var b = input instanceof Uint8Array ? input : new Uint8Array(input);
    var v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    var n = b.length;
    if (n < 22) throw error('E1', ['many_short']);
    // EOCD (0x06054b50) sondan aranır; sonundaki yorum en çok 65 535 bayt
    var eocd = -1;
    for (var i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw error('E1', ['no_eocd']);
    if (eocd >= 20 && v.getUint32(eocd - 20, true) === 0x07064b50) throw error('E7', ['zip64']);
    var count = v.getUint16(eocd + 10, true);
    var cdSize = v.getUint32(eocd + 12, true);
    var cdOffset = v.getUint32(eocd + 16, true);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw error('E7', ['zip64']);
    if (v.getUint16(eocd + 4, true) !== 0 || v.getUint16(eocd + 6, true) !== 0) throw error('E7', ['many_parts']);
    if (cdOffset + cdSize > eocd) throw error('E1', ['dir_limit']);

    // Prototipsiz tablolar: 'constructor', '__proto__', 'toString' gibi girdi adları Object.prototype ile karışmaz.
    var inputs = Object.create(null);
    var order = [];
    var p = cdOffset;
    for (var k = 0; k < count; k++) {
      if (p + 46 > eocd || v.getUint32(p, true) !== 0x02014b50) throw error('E1', ['dir_input']);
      var flag = v.getUint16(p + 8, true);
      var method = v.getUint16(p + 10, true);
      var crc = v.getUint32(p + 16, true);
      var tight = v.getUint32(p + 20, true);
      var size = v.getUint32(p + 24, true);
      var adUz = v.getUint16(p + 28, true), ekUz = v.getUint16(p + 30, true), commentUz = v.getUint16(p + 32, true);
      var offset = v.getUint32(p + 42, true);
      if (tight === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw error('E7', ['zip64']);
      if (p + 46 + adUz > eocd) throw error('E1', ['name_limit']);
      var hamAd = adCoz(b.subarray(p + 46, p + 46 + adUz), (flag & 0x800) !== 0);
      p += 46 + adUz + ekUz + commentUz;
      if (/\/$/.test(hamAd)) continue; // klasör
      var name = normal(hamAd);
      if (!name) continue;
      if (flag & 1) throw error('E3', ['encrypted_input', { name: name }]);
      if (!(name in inputs)) order.push(name);
      inputs[name] = { method: method, tightSize: tight, size: size, offset: offset, flag: flag, crc: crc };
    }
    // Klasör paketi EPUB'un tarayıcı sıkıştırması (Safari/WebKit, Apple Kitaplar'daki klasör paketini "<ad>.epub.zip"
    // olarak verir): bütün girdiler tek bir üst klasördeyse ve EPUB kapsayıcısı (META-INF/container.xml) kökte değil
    // o klasördeyse, klasör öneki atılır. macOS'un eklediği __MACOSX/ ve .DS_Store girdileri yok sayılır.
    var prefix = singleFolderPrefix(order);
    if (prefix) {
      var shortInputs = Object.create(null), shortOrder = [];
      order.forEach(function (a) {
        if (a.slice(0, prefix.length) !== prefix) return;
        var short = a.slice(prefix.length);
        if (!short || systemLeftover(short) || (short in shortInputs)) return;
        shortInputs[short] = inputs[a];
        shortOrder.push(short);
      });
      inputs = shortInputs;
      order = shortOrder;
    }
    var smallLetter = Object.create(null);
    order.forEach(function (a) { var l = a.toLowerCase(); if (!(l in smallLetter)) smallLetter[l] = a; });

    function find(name) {
      var a = normal(name);
      if (a in inputs) return a;
      var l = a.toLowerCase();
      return l in smallLetter ? smallLetter[l] : null;
    }

    async function open(name) {
      var actual = find(name);
      if (actual === null) {
        var e = new Error(t('epub.no_file', { name: name }));
        e.code = 'NONE';
        throw e;
      }
      var g = inputs[actual];
      var o = g.offset;
      if (o + 30 > n || v.getUint32(o, true) !== 0x04034b50) throw error('E1', ['local_title', { name: actual }]);
      var head = o + 30 + v.getUint16(o + 26, true) + v.getUint16(o + 28, true);
      if (head + g.tightSize > n) throw error('E1', ['data_limit', { name: actual }]);
      var raw = b.subarray(head, head + g.tightSize);
      if (g.size > limit) throw error('E1', ['opened_limit', { size: g.size, name: actual }]);
      var output;
      if (g.method === 0) output = raw.slice();
      else if (g.method === 8) {
        try { output = await inflate(raw, g.size, actual); } catch (err) {
          if (err && err.code) throw err;
          throw error('E1', ['deflate', { name: actual }]);
        }
      } else throw error('E7', ['method', { method: g.method, name: actual }]);
      if (output.length !== g.size || crc32(output) !== g.crc) throw error('E1', ['crc', { name: actual }]);
      return output;
    }

    var unsupportedEncoding = [];
    function supportedEncoding(k) { try { new TextDecoder(k); return true; } catch (e) { return false; } }
    /**
     * Metin çözümü: BOM varsa UTF-16/UTF-8; yoksa XML bildirimindeki kodlama (ör. windows-1254, iso-8859-9)
     * TextDecoder ile; tarayıcının tanımadığı kodlama UTF-8 olarak okunur ve desteksizKodlamalar()'a yazılır.
     */
    async function text(name) {
      var d = await open(name);
      if (d.length >= 2 && d[0] === 0xfe && d[1] === 0xff) return new TextDecoder('utf-16be').decode(d);
      if (d.length >= 2 && d[0] === 0xff && d[1] === 0xfe) return new TextDecoder('utf-16le').decode(d);
      if (d.length >= 3 && d[0] === 0xef && d[1] === 0xbb && d[2] === 0xbf) return new TextDecoder('utf-8').decode(d);
      var code = xmlEncoding(d);
      // BOM yok: bildirim ne derse desin, geçerli UTF-8 olan ve çok baytlı dizi içeren içerik UTF-8 okunur (yanlış bildirim)
      if (code && !/^(utf-?8|us-ascii|ascii)$/i.test(code) && supportedEncoding(code)) {
        var manyBytes = false;
        for (var q = 0; q < d.length; q++) { if (d[q] >= 0x80) { manyBytes = true; break; } }
        if (manyBytes) {
          try { return new TextDecoder('utf-8', { fatal: true }).decode(d); } catch (e) { /* UTF-8 değil: bildirilen kodlamaya geç */ }
        }
      }
      if (code && !/^(utf-?8|utf-?16(le|be)?|ucs-?2|us-ascii|ascii)$/i.test(code)) {
        var decoder = null;
        try { decoder = new TextDecoder(code); } catch (e) { decoder = null; }
        if (decoder) return decoder.decode(d);
        if (unsupportedEncoding.indexOf(code) < 0) unsupportedEncoding.push(code);
      }
      return new TextDecoder('utf-8').decode(d);
    }

    return {
      names: function () { return order.slice(); },
      has: function (name) { return find(name) !== null; },
      actualName: find,
      input: function (name) { var a = find(name); return a === null ? null : Object.assign({ name: a }, inputs[a]); },
      open: open,
      text: text,
      unsupportedEncodings: function () { return unsupportedEncoding.slice(); },
      rootPrefix: function () { return prefix || ''; }
    };
  }

  return { read: read, parsePath: parsePath, normal: normal, crc32: crc32, MESSAGE: MESSAGE };
});
