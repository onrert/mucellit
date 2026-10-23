/*
 * xhtml-blok.js — bir EPUB XHTML belgesini blok listesine (IR, bkz. dizgi.js) çevirir (KitapCilt.xhtmlBlok).
 * DOMParser ve CSSStyleSheet ister (tarayıcı).
 *
 *   await belgeyiBloklara(xhtmlMetni, yol, ortam) → { bloklar }
 *   ortam: { zip, dil (OPF dc:language), cssOnbellek: Map, resimler: {}, sayac: { atlananResim, tablo } }
 *   ortam.satirIciOnbellek (Map, en çok 2000 girdi) ilk belgede kurulur; dönüşüme özeldir.
 *   ortam.resimler[anahtar] = { tur: 'jpg' | 'png', bytes, pikselGen, pikselYuk }
 *
 * Güvenlik ve ağ: belge DOMParser ile ayrıştırılır ve HİÇBİR düğüm canlı belgeye eklenmez; böylece script
 * çalışmaz, resim/CSS url() istenmez. CSS yalnız ayrıştırılır (new CSSStyleSheet().replaceSync, @import atılır).
 * XHTML ayrıştırması hata verirse (ör. DTD'siz &nbsp;) text/html ile yeniden denenir.
 *
 * CSS alt kümesi: font-style, font-weight, text-align, display:none, page-break-before / break-before,
 * vertical-align: super. Kurallar kaynak sırasıyla, sonra satır içi style uygulanır (özgüllük yok sayılır).
 */
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};

  var ATLA = { script: 1, style: 1, head: 1, title: 1, meta: 1, link: 1, template: 1, noscript: 1, object: 1, iframe: 1, audio: 1, video: 1, math: 1, button: 1, input: 1, select: 1, textarea: 1 };
  var BLOK = { p: 1, div: 1, section: 1, article: 1, header: 1, footer: 1, aside: 1, nav: 1, main: 1, figure: 1, figcaption: 1,
    blockquote: 1, ul: 1, ol: 1, li: 1, dl: 1, dt: 1, dd: 1, pre: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, center: 1, address: 1, body: 1, hgroup: 1, caption: 1, details: 1, summary: 1, fieldset: 1, legend: 1 };
  var ITALIK = { em: 1, i: 1, cite: 1, dfn: 1, var: 1, address: 1 };
  var KALIN = { strong: 1, b: 1, th: 1 };
  var OZELLIKLER = ['font-style', 'font-weight', 'text-align', 'display', 'page-break-before', 'break-before', 'vertical-align'];
  var GORUNMEZ = /[​‌‍⁠﻿]/g;

  function ad(el) { return String(el.localName || el.nodeName || '').toLowerCase(); }
  function epubTur(el) { return String(el.getAttribute('epub:type') || el.getAttribute('role') || '').toLowerCase(); }

  function ayristir(metin) {
    var d = new DOMParser().parseFromString(metin, 'application/xhtml+xml');
    if (d.getElementsByTagName('parsererror').length === 0) return d;
    return new DOMParser().parseFromString(metin, 'text/html');
  }

  function sayfayiYok(s) { try { var c = new CSSStyleSheet(); c.replaceSync(s); return c; } catch (e) { return null; } }

  function ilgiliKurallar(sheet, liste) {
    if (!sheet) return;
    var kurallar;
    try { kurallar = sheet.cssRules; } catch (e) { return; }
    for (var i = 0; i < kurallar.length; i++) {
      var r = kurallar[i];
      if (r.type !== 1 || !r.selectorText) continue; // yalnız CSSStyleRule (@media vb. atlanır)
      var d = {}, var_ = false;
      OZELLIKLER.forEach(function (o) { var v = r.style.getPropertyValue(o); if (v) { d[o] = v.trim().toLowerCase(); var_ = true; } });
      if (var_) liste.push({ secici: r.selectorText, d: d, gecersiz: false });
    }
  }

  async function stilleriTopla(doc, yol, ortam) {
    var liste = [];
    var el = doc.getElementsByTagName('*');
    for (var i = 0; i < el.length; i++) {
      var e = el[i], a = ad(e);
      if (a === 'link' && /(^|\s)stylesheet(\s|$)/i.test(e.getAttribute('rel') || '')) {
        var y = KC.epubZip.yolCoz(yol, e.getAttribute('href') || '');
        if (!ortam.cssOnbellek.has(y)) {
          var s = null;
          if (ortam.zip.var(y)) { try { s = sayfayiYok(await ortam.zip.metin(y)); } catch (err) { s = null; } }
          ortam.cssOnbellek.set(y, s);
        }
        ilgiliKurallar(ortam.cssOnbellek.get(y), liste);
      } else if (a === 'style') {
        ilgiliKurallar(sayfayiYok(e.textContent || ''), liste);
      }
    }
    return liste;
  }

  // Satır içi style ayrıştırma önbelleği dönüşüme özeldir (ortam.satirIciOnbellek) ve sınırlıdır.
  var SATIR_ICI_ENCOK = 2000;
  function satirIci(attr, onbellek) {
    if (!attr) return null;
    if (onbellek.has(attr)) return onbellek.get(attr);
    var d = null;
    var s = sayfayiYok('x{' + attr + '}');
    if (s && s.cssRules.length) {
      d = {};
      OZELLIKLER.forEach(function (o) { var v = s.cssRules[0].style.getPropertyValue(o); if (v) d[o] = v.trim().toLowerCase(); });
    }
    if (onbellek.size >= SATIR_ICI_ENCOK) onbellek.clear();
    onbellek.set(attr, d);
    return d;
  }

  function elStil(el, kurallar, onbellek) {
    var d = {};
    for (var i = 0; i < kurallar.length; i++) {
      var k = kurallar[i];
      if (k.gecersiz) continue;
      var es;
      try { es = el.matches(k.secici); } catch (e) { k.gecersiz = true; continue; }
      if (es) Object.assign(d, k.d);
    }
    var s = satirIci(el.getAttribute && el.getAttribute('style'), onbellek);
    if (s) Object.assign(d, s);
    return d;
  }

  function hizaCevir(v) {
    if (!v) return null;
    if (v === 'justify') return 'iki';
    if (v === 'center' || v === '-webkit-center') return 'orta';
    if (v === 'right' || v === 'end') return 'sag';
    if (v === 'left' || v === 'start') return 'sol';
    return null;
  }
  function kalinMi(v, onceki) {
    if (!v) return onceki;
    if (v === 'bold' || v === 'bolder') return true;
    if (v === 'normal' || v === 'lighter') return false;
    var n = parseInt(v, 10);
    return isFinite(n) ? n >= 600 : onceki;
  }
  function italikMi(v, onceki) {
    if (!v) return onceki;
    if (v === 'italic' || v === 'oblique' || /^oblique/.test(v)) return true;
    if (v === 'normal') return false;
    return onceki;
  }

  // ---------- resimler ----------
  function bicim(b) {
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
    if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    if (b.length > 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
    return null;
  }
  function pngOlcu(b) { var v = new DataView(b.buffer, b.byteOffset, b.byteLength); return [v.getUint32(16), v.getUint32(20)]; }
  function jpgOlcu(b) {
    var v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    var i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      var m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      var uz = v.getUint16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [v.getUint16(i + 7), v.getUint16(i + 5)];
      i += 2 + uz;
    }
    return null;
  }
  async function pngyeCevir(bytes) {
    var bmp = await createImageBitmap(new Blob([bytes]));
    var w = bmp.width, h = bmp.height;
    var blob;
    if (typeof OffscreenCanvas !== 'undefined') {
      var oc = new OffscreenCanvas(w, h);
      oc.getContext('2d').drawImage(bmp, 0, 0);
      blob = await oc.convertToBlob({ type: 'image/png' });
    } else {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0);
      blob = await new Promise(function (ok) { c.toBlob(ok, 'image/png'); });
    }
    if (bmp.close) bmp.close();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w: w, h: h };
  }

  /** Resmi ortam.resimler'e alır; anahtar ya da null (atlandı) döner. */
  async function resimAl(yol, ortam) {
    if (yol in ortam.resimler) return ortam.resimler[yol] ? yol : null;
    var r = null;
    try {
      if (ortam.zip.var(yol)) {
        var b = await ortam.zip.ac(yol);
        var t = bicim(b);
        if (t === 'png') { var p = pngOlcu(b); r = { tur: 'png', bytes: b, pikselGen: p[0], pikselYuk: p[1] }; }
        else if (t === 'jpg') { var j = jpgOlcu(b); if (j) r = { tur: 'jpg', bytes: b, pikselGen: j[0], pikselYuk: j[1] }; }
        else if (t) { var c = await pngyeCevir(b); r = { tur: 'png', bytes: c.bytes, pikselGen: c.w, pikselYuk: c.h }; }
      }
    } catch (e) { r = null; }
    if (r && !(r.pikselGen > 0 && r.pikselYuk > 0)) r = null;
    ortam.resimler[yol] = r;
    return r ? yol : null;
  }

  // ---------- ana yürüyüş ----------
  async function belgeyiBloklara(metin, yol, ortam) {
    var doc = ayristir(metin);
    var kurallar = await stilleriTopla(doc, yol, ortam);
    var onb = ortam.satirIciOnbellek || (ortam.satirIciOnbellek = new Map());
    var kokEl = doc.documentElement;
    var govde = doc.getElementsByTagNameNS('*', 'body')[0] || doc.getElementsByTagName('body')[0] || kokEl;
    var bloklar = [];
    var acik = null; // { parcalar, bg }

    function metinEkle(t, bg) {
      t = String(t).normalize('NFC').replace(GORUNMEZ, '');
      if (!bg.pre) t = t.replace(/[ \t\n\r\f]+/g, ' ');
      if (!t) return;
      if (!acik) {
        if (!bg.pre && t === ' ') return;
        acik = { parcalar: [], bg: bg };
      }
      var l = acik.parcalar;
      var son = l[l.length - 1];
      if (!bg.pre) {
        var oncekiBosluk = !son || son.kir || / $/.test(son.metin);
        if (oncekiBosluk) t = t.replace(/^ /, '');
        if (!t) return;
      }
      if (bg.pre) {
        var satirlar = t.replace(/\r\n?/g, '\n').split('\n');
        satirlar.forEach(function (s, i) {
          if (i > 0) l.push({ kir: true });
          if (s) l.push(parca(s.replace(/[ \t]/g, ' '), bg));
        });
        return;
      }
      if (son && !son.kir && son.italik === bg.italik && son.kalin === bg.kalin && son.ust === bg.ust && son.kucuk === bg.kucuk && son.dil === bg.dil) son.metin += t;
      else l.push(parca(t, bg));
    }
    function parca(t, bg) { return { metin: t, italik: !!bg.italik, kalin: !!bg.kalin, ust: !!bg.ust, kucuk: !!bg.kucuk, dil: bg.dil }; }

    function kir(bg) {
      if (!acik) acik = { parcalar: [], bg: bg };
      var l = acik.parcalar;
      if (l.length && !l[l.length - 1].kir) l[l.length - 1].metin = l[l.length - 1].metin.replace(/ $/, '');
      l.push({ kir: true });
    }

    function kapat() {
      if (!acik) return;
      var l = acik.parcalar, bg = acik.bg;
      acik = null;
      while (l.length && l[l.length - 1].kir) l.pop();
      if (l.length && !l[l.length - 1].kir) l[l.length - 1].metin = l[l.length - 1].metin.replace(/ $/, '');
      l = l.filter(function (p) { return p.kir || p.metin; });
      if (!l.some(function (p) { return !p.kir && p.metin.replace(/ /g, ' ').trim(); }) && !l.some(function (p) { return p.kir; })) return;
      if (bg.duzey) {
        var b = { tur: 'baslik', duzey: bg.duzey, parcalar: l, dil: bg.dil };
        if (bg.baslikHiza) b.hiza = bg.baslikHiza;
        bloklar.push(b);
        return;
      }
      var blk = { tur: 'paragraf', hiza: bg.hiza || 'iki', girinti: !bg.onEkKutu && !bg.pre, solGirinti: bg.solG || 0, sagGirinti: bg.sagG || 0, kucuk: !!bg.kucukBlok, dil: bg.dil, parcalar: l };
      if (bg.pre) blk.hiza = 'sol';
      if (bg.onEkKutu && !bg.onEkKutu.kullanildi) { blk.onEk = bg.onEkKutu.metin; bg.onEkKutu.kullanildi = true; }
      bloklar.push(blk);
    }

    function sayfaSonu() {
      kapat();
      var s = bloklar[bloklar.length - 1];
      if (bloklar.length && s.tur !== 'sayfaSonu') bloklar.push({ tur: 'sayfaSonu' });
    }

    async function resimBlogu(src) {
      if (!src) return;
      var y = KC.epubZip.yolCoz(yol, src);
      var a = await resimAl(y, ortam);
      if (!a) { ortam.sayac.atlananResim += 1; return; }
      kapat();
      var r = ortam.resimler[a];
      bloklar.push({ tur: 'resim', resim: { anahtar: a, pikselGen: r.pikselGen, pikselYuk: r.pikselYuk } });
    }

    /** Hücre metni: script/style vb. (ATLA), hidden ve display:none öğeler atlanır; iç içe tablo hücrenin metnine bir kez girer. */
    function hucreMetni(dugum) {
      var parcalar = [];
      (function gez(n) {
        for (var i = 0; i < n.childNodes.length; i++) {
          var c = n.childNodes[i];
          if (c.nodeType === 3 || c.nodeType === 4) { parcalar.push(c.data); continue; }
          if (c.nodeType !== 1) continue;
          var a = ad(c);
          if (ATLA[a] || c.hasAttribute('hidden') || elStil(c, kurallar, onb).display === 'none') continue;
          var ayir = BLOK[a] || a === 'td' || a === 'th' || a === 'tr' || a === 'table' || a === 'br';
          if (ayir) parcalar.push(' ');
          gez(c);
          if (ayir) parcalar.push(' ');
        }
      })(dugum);
      return parcalar.join('').normalize('NFC').replace(GORUNMEZ, '').replace(/[ \t\n\r\f]+/g, ' ').trim();
    }
    function enYakinTablo(n) {
      for (var p = n.parentNode; p; p = p.parentNode) if (p.nodeType === 1 && ad(p) === 'table') return p;
      return null;
    }

    function tablo(el, bg) {
      kapat();
      ortam.sayac.tablo += 1;
      var tumu = el.getElementsByTagNameNS('*', 'tr');
      if (!tumu.length) tumu = el.getElementsByTagName('tr');
      // yalnız bu tablonun satırları: iç içe tablonun satırları ayrıca yinelenmez (dış hücrenin metninde yer alır)
      var satirlar = Array.prototype.filter.call(tumu, function (tr) { return enYakinTablo(tr) === el; });
      satirlar.forEach(function (tr) {
        var hucreler = Array.prototype.filter.call(tr.childNodes, function (c) {
          return c.nodeType === 1 && (ad(c) === 'td' || ad(c) === 'th') && !c.hasAttribute('hidden') && elStil(c, kurallar, onb).display !== 'none';
        }).map(hucreMetni).filter(Boolean);
        if (!hucreler.length) return;
        bloklar.push({ tur: 'paragraf', hiza: 'sol', girinti: false, solGirinti: bg.solG || 0, sagGirinti: bg.sagG || 0, dil: bg.dil, parcalar: [{ metin: hucreler.join(' · '), italik: !!bg.italik, kalin: !!bg.kalin, dil: bg.dil }] });
      });
    }

    async function yuru(dugum, bg) {
      var cocuklar = dugum.childNodes;
      var olSayac = null;
      if (ad(dugum) === 'ol') olSayac = parseInt(dugum.getAttribute('start'), 10) || 1;
      for (var i = 0; i < cocuklar.length; i++) {
        var c = cocuklar[i];
        if (c.nodeType === 3 || c.nodeType === 4) { metinEkle(c.data, bg); continue; }
        if (c.nodeType !== 1) continue;
        var a = ad(c);
        if (ATLA[a]) continue;
        if (c.hasAttribute('hidden')) continue;
        var st = elStil(c, kurallar, onb);
        if (st.display === 'none') continue;
        var tur = epubTur(c);
        var y = Object.assign({}, bg);
        var dil = c.getAttribute('xml:lang') || c.getAttribute('lang');
        if (dil) y.dil = dil;
        if (ITALIK[a]) y.italik = true;
        if (KALIN[a]) y.kalin = true;
        if (a === 'sup' || (a === 'a' && /noteref/.test(tur))) y.ust = true;
        if (a === 'small' || a === 'sub') y.kucuk = true;
        if (a === 'center') y.hiza = 'orta';
        y.italik = italikMi(st['font-style'], y.italik);
        y.kalin = kalinMi(st['font-weight'], y.kalin);
        if (st['vertical-align'] === 'super') y.ust = true;
        var h = hizaCevir(st['text-align']);
        if (h) y.hiza = h;
        var kirma = st['page-break-before'] || st['break-before'];
        var yeniSayfa = /^(always|page|left|right|recto|verso)$/.test(kirma || '');

        if (a === 'br') { kir(bg); continue; }
        if (a === 'img') { await resimBlogu(c.getAttribute('src')); continue; }
        if (a === 'svg') {
          var im = c.getElementsByTagNameNS('*', 'image')[0] || c.getElementsByTagName('image')[0];
          if (im) await resimBlogu(im.getAttribute('xlink:href') || im.getAttribute('href'));
          else ortam.sayac.atlananResim += 1;
          continue;
        }
        if (a === 'hr') { kapat(); if (yeniSayfa) sayfaSonu(); bloklar.push({ tur: 'ayrac' }); continue; }
        if (a === 'table') { if (yeniSayfa) sayfaSonu(); tablo(c, y); continue; }
        if (!BLOK[a] && st.display !== 'block') { await yuru(c, y); continue; }
        // blok öğe
        kapat();
        if (yeniSayfa) sayfaSonu();
        if (/^h[1-6]$/.test(a)) { y.duzey = parseInt(a.charAt(1), 10); y.baslikHiza = h; y.kalin = true; }
        if (a === 'blockquote') { y.solG = (y.solG || 0) + 1; y.sagG = (y.sagG || 0) + 1; }
        if (a === 'ul' || a === 'ol') y.solG = (y.solG || 0) + 2;
        if (a === 'li') {
          var ust = c.parentNode && ad(c.parentNode);
          var onEk = '•';
          if (ust === 'ol') { onEk = olSayac + '.'; }
          y.onEkKutu = { metin: onEk, kullanildi: false };
          if (bg.solG === undefined || bg.solG === 0) y.solG = Math.max(y.solG || 0, 2);
        }
        if (a === 'pre') y.pre = true;
        if (a === 'aside' && /footnote|endnote|rearnote|note/.test(tur)) y.kucukBlok = true;
        await yuru(c, y);
        kapat();
        if (a === 'li' && olSayac !== null) olSayac += 1;
      }
    }

    var kokDil = kokEl.getAttribute('xml:lang') || kokEl.getAttribute('lang') || govde.getAttribute('xml:lang') || govde.getAttribute('lang') || ortam.dil || '';
    var kokStil = elStil(govde, kurallar, onb);
    await yuru(govde, { dil: kokDil, hiza: hizaCevir(kokStil['text-align']) || null, italik: italikMi(kokStil['font-style'], false), kalin: kalinMi(kokStil['font-weight'], false), solG: 0, sagG: 0 });
    kapat();
    while (bloklar.length && bloklar[bloklar.length - 1].tur === 'sayfaSonu') bloklar.pop();
    while (bloklar.length && bloklar[0].tur === 'sayfaSonu') bloklar.shift();
    return { bloklar: bloklar };
  }

  KC.xhtmlBlok = { belgeyiBloklara: belgeyiBloklara, ayristir: ayristir };
})(typeof self !== 'undefined' ? self : this);
