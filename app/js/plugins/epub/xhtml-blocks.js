/*
 * xhtml-blocks.js — bir EPUB XHTML belgesini blok listesine (IR, bkz. typeset.js) çevirir (KitapCilt.xhtmlBlok).
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
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};

  var SKIP = { script: 1, style: 1, head: 1, title: 1, meta: 1, link: 1, template: 1, noscript: 1, object: 1, iframe: 1, audio: 1, video: 1, math: 1, button: 1, input: 1, select: 1, textarea: 1 };
  var BLOCK = { p: 1, div: 1, section: 1, article: 1, header: 1, footer: 1, aside: 1, nav: 1, main: 1, figure: 1, figcaption: 1,
    blockquote: 1, ul: 1, ol: 1, li: 1, dl: 1, dt: 1, dd: 1, pre: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, center: 1, address: 1, body: 1, hgroup: 1, caption: 1, details: 1, summary: 1, fieldset: 1, legend: 1 };
  var ITALIC = { em: 1, i: 1, cite: 1, dfn: 1, var: 1, address: 1 };
  var BOLD = { strong: 1, b: 1, th: 1 };
  var FEATURES = ['font-style', 'font-weight', 'text-align', 'display', 'page-break-before', 'break-before', 'vertical-align'];
  var INVISIBLE = /[​‌‍⁠﻿]/g;

  function name(el) { return String(el.localName || el.nodeName || '').toLowerCase(); }
  function epubTur(el) { return String(el.getAttribute('epub:type') || el.getAttribute('role') || '').toLowerCase(); }

  function parse(text) {
    var d = new DOMParser().parseFromString(text, 'application/xhtml+xml');
    if (d.getElementsByTagName('parsererror').length === 0) return d;
    return new DOMParser().parseFromString(text, 'text/html');
  }

  function noPage(s) { try { var c = new CSSStyleSheet(); c.replaceSync(s); return c; } catch (e) { return null; } }

  function relatedRules(sheet, list) {
    if (!sheet) return;
    var rules;
    try { rules = sheet.cssRules; } catch (e) { return; }
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.type !== 1 || !r.selectorText) continue; // yalnız CSSStyleRule (@media vb. atlanır)
      var d = {}, var_ = false;
      FEATURES.forEach(function (o) { var v = r.style.getPropertyValue(o); if (v) { d[o] = v.trim().toLowerCase(); var_ = true; } });
      if (var_) list.push({ picker: r.selectorText, d: d, invalid: false });
    }
  }

  async function collectStyles(doc, path, env) {
    var list = [];
    var el = doc.getElementsByTagName('*');
    for (var i = 0; i < el.length; i++) {
      var e = el[i], a = name(e);
      if (a === 'link' && /(^|\s)stylesheet(\s|$)/i.test(e.getAttribute('rel') || '')) {
        var y = MC.epubZip.parsePath(path, e.getAttribute('href') || '');
        if (!env.cssCache.has(y)) {
          var s = null;
          if (env.zip.has(y)) { try { s = noPage(await env.zip.text(y)); } catch (err) { s = null; } }
          env.cssCache.set(y, s);
        }
        relatedRules(env.cssCache.get(y), list);
      } else if (a === 'style') {
        relatedRules(noPage(e.textContent || ''), list);
      }
    }
    return list;
  }

  // Satır içi style ayrıştırma önbelleği dönüşüme özeldir (ortam.satirIciOnbellek) ve sınırlıdır.
  var INLINE_MAX = 2000;
  function inline(attr, cache) {
    if (!attr) return null;
    if (cache.has(attr)) return cache.get(attr);
    var d = null;
    var s = noPage('x{' + attr + '}');
    if (s && s.cssRules.length) {
      d = {};
      FEATURES.forEach(function (o) { var v = s.cssRules[0].style.getPropertyValue(o); if (v) d[o] = v.trim().toLowerCase(); });
    }
    if (cache.size >= INLINE_MAX) cache.clear();
    cache.set(attr, d);
    return d;
  }

  function elStyle(el, rules, cache) {
    var d = {};
    for (var i = 0; i < rules.length; i++) {
      var k = rules[i];
      if (k.invalid) continue;
      var es;
      try { es = el.matches(k.picker); } catch (e) { k.invalid = true; continue; }
      if (es) Object.assign(d, k.d);
    }
    var s = inline(el.getAttribute && el.getAttribute('style'), cache);
    if (s) Object.assign(d, s);
    return d;
  }

  function flipAlign(v) {
    if (!v) return null;
    if (v === 'justify') return 'iki';
    if (v === 'center' || v === '-webkit-center') return 'middle';
    if (v === 'right' || v === 'end') return 'right';
    if (v === 'left' || v === 'start') return 'left';
    return null;
  }
  function isBold(v, previous) {
    if (!v) return previous;
    if (v === 'bold' || v === 'bolder') return true;
    if (v === 'normal' || v === 'lighter') return false;
    var n = parseInt(v, 10);
    return isFinite(n) ? n >= 600 : previous;
  }
  function isItalic(v, previous) {
    if (!v) return previous;
    if (v === 'italic' || v === 'oblique' || /^oblique/.test(v)) return true;
    if (v === 'normal') return false;
    return previous;
  }

  // ---------- resimler ----------
  function format(b) {
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
    if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    if (b.length > 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
    return null;
  }
  function pngSize(b) { var v = new DataView(b.buffer, b.byteOffset, b.byteLength); return [v.getUint32(16), v.getUint32(20)]; }
  function jpgSize(b) {
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
  async function flipToPng(bytes) {
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
  async function takeImage(path, env) {
    if (path in env.thumbs) return env.thumbs[path] ? path : null;
    var r = null;
    try {
      if (env.zip.has(path)) {
        var b = await env.zip.open(path);
        var t = format(b);
        if (t === 'png') { var p = pngSize(b); r = { kind: 'png', bytes: b, pixelWidth: p[0], pixelHeight: p[1] }; }
        else if (t === 'jpg') { var j = jpgSize(b); if (j) r = { kind: 'jpg', bytes: b, pixelWidth: j[0], pixelHeight: j[1] }; }
        else if (t) { var c = await flipToPng(b); r = { kind: 'png', bytes: c.bytes, pixelWidth: c.w, pixelHeight: c.h }; }
      }
    } catch (e) { r = null; }
    if (r && !(r.pixelWidth > 0 && r.pixelHeight > 0)) r = null;
    env.thumbs[path] = r;
    return r ? path : null;
  }

  // ---------- ana yürüyüş ----------
  async function documentToBlocks(text, path, env) {
    var doc = parse(text);
    var rules = await collectStyles(doc, path, env);
    var onb = env.inlineCache || (env.inlineCache = new Map());
    var rootEl = doc.documentElement;
    var body = doc.getElementsByTagNameNS('*', 'body')[0] || doc.getElementsByTagName('body')[0] || rootEl;
    var blocks = [];
    var isOpen = null; // { parcalar, bg }

    function addText(t, bg) {
      t = String(t).normalize('NFC').replace(INVISIBLE, '');
      if (!bg.pre) t = t.replace(/[ \t\n\r\f]+/g, ' ');
      if (!t) return;
      if (!isOpen) {
        if (!bg.pre && t === ' ') return;
        isOpen = { parts: [], bg: bg };
      }
      var l = isOpen.parts;
      var last = l[l.length - 1];
      if (!bg.pre) {
        var previousSpace = !last || last.lineBreak || / $/.test(last.text);
        if (previousSpace) t = t.replace(/^ /, '');
        if (!t) return;
      }
      if (bg.pre) {
        var rows = t.replace(/\r\n?/g, '\n').split('\n');
        rows.forEach(function (s, i) {
          if (i > 0) l.push({ lineBreak: true });
          if (s) l.push(part(s.replace(/[ \t]/g, ' '), bg));
        });
        return;
      }
      if (last && !last.lineBreak && last.italic === bg.italic && last.bold === bg.bold && last.top === bg.top && last.small === bg.small && last.i18n === bg.i18n) last.text += t;
      else l.push(part(t, bg));
    }
    function part(t, bg) { return { text: t, italic: !!bg.italic, bold: !!bg.bold, top: !!bg.top, small: !!bg.small, i18n: bg.i18n }; }

    function lineBreak(bg) {
      if (!isOpen) isOpen = { parts: [], bg: bg };
      var l = isOpen.parts;
      if (l.length && !l[l.length - 1].lineBreak) l[l.length - 1].text = l[l.length - 1].text.replace(/ $/, '');
      l.push({ lineBreak: true });
    }

    function close() {
      if (!isOpen) return;
      var l = isOpen.parts, bg = isOpen.bg;
      isOpen = null;
      while (l.length && l[l.length - 1].lineBreak) l.pop();
      if (l.length && !l[l.length - 1].lineBreak) l[l.length - 1].text = l[l.length - 1].text.replace(/ $/, '');
      l = l.filter(function (p) { return p.lineBreak || p.text; });
      if (!l.some(function (p) { return !p.lineBreak && p.text.replace(/ /g, ' ').trim(); }) && !l.some(function (p) { return p.lineBreak; })) return;
      if (bg.level) {
        var b = { kind: 'title', level: bg.level, parts: l, i18n: bg.i18n };
        if (bg.titleAlign) b.align = bg.titleAlign;
        blocks.push(b);
        return;
      }
      var blk = { kind: 'paragraph', align: bg.align || 'iki', indent: !bg.prefixBox && !bg.pre, leftIndent: bg.solG || 0, rightIndent: bg.sagG || 0, small: !!bg.smallBlock, i18n: bg.i18n, parts: l };
      if (bg.pre) blk.align = 'left';
      if (bg.prefixBox && !bg.prefixBox.used) { blk.prefix = bg.prefixBox.text; bg.prefixBox.used = true; }
      blocks.push(blk);
    }

    function pageEnd() {
      close();
      var s = blocks[blocks.length - 1];
      if (blocks.length && s.kind !== 'pageEnd') blocks.push({ kind: 'pageEnd' });
    }

    async function imageBlock(src) {
      if (!src) return;
      var y = MC.epubZip.parsePath(path, src);
      var a = await takeImage(y, env);
      if (!a) { env.counter.skippedImage += 1; return; }
      close();
      var r = env.thumbs[a];
      blocks.push({ kind: 'image', image: { key: a, pixelWidth: r.pixelWidth, pixelHeight: r.pixelHeight } });
    }

    /** Hücre metni: script/style vb. (ATLA), hidden ve display:none öğeler atlanır; iç içe tablo hücrenin metnine bir kez girer. */
    function cellText(isNode) {
      var parts = [];
      (function walk(n) {
        for (var i = 0; i < n.childNodes.length; i++) {
          var c = n.childNodes[i];
          if (c.nodeType === 3 || c.nodeType === 4) { parts.push(c.data); continue; }
          if (c.nodeType !== 1) continue;
          var a = name(c);
          if (SKIP[a] || c.hasAttribute('hidden') || elStyle(c, rules, onb).display === 'none') continue;
          var split = BLOCK[a] || a === 'td' || a === 'th' || a === 'tr' || a === 'table' || a === 'br';
          if (split) parts.push(' ');
          walk(c);
          if (split) parts.push(' ');
        }
      })(isNode);
      return parts.join('').normalize('NFC').replace(INVISIBLE, '').replace(/[ \t\n\r\f]+/g, ' ').trim();
    }
    function nearestTable(n) {
      for (var p = n.parentNode; p; p = p.parentNode) if (p.nodeType === 1 && name(p) === 'table') return p;
      return null;
    }

    function table(el, bg) {
      close();
      env.counter.table += 1;
      var all = el.getElementsByTagNameNS('*', 'tr');
      if (!all.length) all = el.getElementsByTagName('tr');
      // yalnız bu tablonun satırları: iç içe tablonun satırları ayrıca yinelenmez (dış hücrenin metninde yer alır)
      var rows = Array.prototype.filter.call(all, function (tr) { return nearestTable(tr) === el; });
      rows.forEach(function (tr) {
        var cells = Array.prototype.filter.call(tr.childNodes, function (c) {
          return c.nodeType === 1 && (name(c) === 'td' || name(c) === 'th') && !c.hasAttribute('hidden') && elStyle(c, rules, onb).display !== 'none';
        }).map(cellText).filter(Boolean);
        if (!cells.length) return;
        blocks.push({ kind: 'paragraph', align: 'left', indent: false, leftIndent: bg.solG || 0, rightIndent: bg.sagG || 0, i18n: bg.i18n, parts: [{ text: cells.join(' · '), italic: !!bg.italic, bold: !!bg.bold, i18n: bg.i18n }] });
      });
    }

    async function walk(isNode, bg) {
      var children = isNode.childNodes;
      var olCounter = null;
      if (name(isNode) === 'ol') olCounter = parseInt(isNode.getAttribute('start'), 10) || 1;
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c.nodeType === 3 || c.nodeType === 4) { addText(c.data, bg); continue; }
        if (c.nodeType !== 1) continue;
        var a = name(c);
        if (SKIP[a]) continue;
        if (c.hasAttribute('hidden')) continue;
        var st = elStyle(c, rules, onb);
        if (st.display === 'none') continue;
        var kind = epubTur(c);
        var y = Object.assign({}, bg);
        var i18n = c.getAttribute('xml:lang') || c.getAttribute('lang');
        if (i18n) y.i18n = i18n;
        if (ITALIC[a]) y.italic = true;
        if (BOLD[a]) y.bold = true;
        if (a === 'sup' || (a === 'a' && /noteref/.test(kind))) y.top = true;
        if (a === 'small' || a === 'sub') y.small = true;
        if (a === 'center') y.align = 'middle';
        y.italic = isItalic(st['font-style'], y.italic);
        y.bold = isBold(st['font-weight'], y.bold);
        if (st['vertical-align'] === 'super') y.top = true;
        var h = flipAlign(st['text-align']);
        if (h) y.align = h;
        var breaking = st['page-break-before'] || st['break-before'];
        var newPage = /^(always|page|left|right|recto|verso)$/.test(breaking || '');

        if (a === 'br') { lineBreak(bg); continue; }
        if (a === 'img') { await imageBlock(c.getAttribute('src')); continue; }
        if (a === 'svg') {
          var im = c.getElementsByTagNameNS('*', 'image')[0] || c.getElementsByTagName('image')[0];
          if (im) await imageBlock(im.getAttribute('xlink:href') || im.getAttribute('href'));
          else env.counter.skippedImage += 1;
          continue;
        }
        if (a === 'hr') { close(); if (newPage) pageEnd(); blocks.push({ kind: 'separator' }); continue; }
        if (a === 'table') { if (newPage) pageEnd(); table(c, y); continue; }
        if (!BLOCK[a] && st.display !== 'block') { await walk(c, y); continue; }
        // blok öğe
        close();
        if (newPage) pageEnd();
        if (/^h[1-6]$/.test(a)) { y.level = parseInt(a.charAt(1), 10); y.titleAlign = h; y.bold = true; }
        if (a === 'blockquote') { y.solG = (y.solG || 0) + 1; y.sagG = (y.sagG || 0) + 1; }
        if (a === 'ul' || a === 'ol') y.solG = (y.solG || 0) + 2;
        if (a === 'li') {
          var top = c.parentNode && name(c.parentNode);
          var prefix = '•';
          if (top === 'ol') { prefix = olCounter + '.'; }
          y.prefixBox = { text: prefix, used: false };
          if (bg.solG === undefined || bg.solG === 0) y.solG = Math.max(y.solG || 0, 2);
        }
        if (a === 'pre') y.pre = true;
        if (a === 'aside' && /footnote|endnote|rearnote|note/.test(kind)) y.smallBlock = true;
        await walk(c, y);
        close();
        if (a === 'li' && olCounter !== null) olCounter += 1;
      }
    }

    var rootI18n = rootEl.getAttribute('xml:lang') || rootEl.getAttribute('lang') || body.getAttribute('xml:lang') || body.getAttribute('lang') || env.i18n || '';
    var rootStyle = elStyle(body, rules, onb);
    await walk(body, { i18n: rootI18n, align: flipAlign(rootStyle['text-align']) || null, italic: isItalic(rootStyle['font-style'], false), bold: isBold(rootStyle['font-weight'], false), solG: 0, sagG: 0 });
    close();
    while (blocks.length && blocks[blocks.length - 1].kind === 'pageEnd') blocks.pop();
    while (blocks.length && blocks[0].kind === 'pageEnd') blocks.shift();
    return { blocks: blocks };
  }

  MC.xhtmlBlock = { documentToBlocks: documentToBlocks, parse: parse };
})(typeof self !== 'undefined' ? self : this);
