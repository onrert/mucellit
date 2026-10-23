/*
 * typeset.js — EPUB blok listesini (IR) sayfalara dizer; DOM'suz saf modül
 * (KitapCilt.epubDizgi / module.exports). Node'da birim testlenir.
 *
 *   diz(bloklar, ayar, olcer)      → { sayfalar, uyarilar }       (eşzamanlı)
 *   dizAsync(bloklar, ayar, olcer) → Promise<{ sayfalar, uyarilar }> (her 200 blokta olay döngüsüne nefes)
 *   fontkitOlcer(fontlar)          → olcer (fontkit yazı tipleriyle; pdf-lib'in widthOfTextAtSize hesabının aynısı)
 *
 * ayar (pt): { sayfaGen, sayfaYuk, kenar: { ust, alt, ic, dis }, boy, satirAraligi, tireBol, sayfaNo, sayfaNoBoy = 9 }
 * olcer: { genislik(metin, stil, boy) → pt }   stil: 'R' | 'I' | 'B' | 'BI'
 *
 * BLOK (IR):
 *   { tur: 'paragraf', hiza: 'iki'|'sol'|'orta'|'sag', girinti, solGirinti (em), sagGirinti (em), kucuk, onEk, dil,
 *     parcalar: [{ metin, italik, kalin, ust, kucuk, dil } | { kir: true }] }   (kir: <br>)
 *   { tur: 'baslik', duzey: 1..6, hiza, parcalar }
 *   { tur: 'resim', resim: { anahtar, pikselGen, pikselYuk } }
 *   { tur: 'ayrac' } | { tur: 'sayfaSonu' } | { tur: 'bolumBasi' }
 * SAYFA: { no, bolumBasi, ogeler: [{ tur: 'metin', x, y, metin, stil, boy, bosluk, blok, satir, rol? }
 *                                  | { tur: 'resim', x, y, w, h, anahtar, blok }] }   pt, sol alt köken.
 *   bosluk: true → pdf-yaz bu parçadan sonra bir boşluk yazar (aranabilir metin için kelime ayırıcı).
 *
 * Kurallar: açgözlü satır kırma; sığmayan kelimede satır doluluğu < %92 ise en uzun sığan hece noktası "-" ile;
 * iki yana yaslı satırda fazlalık boşluklara eşit dağıtılır, son satır ve <br> öncesi sola; U+00A0 kırılmaz;
 * dul/öksüz en az 2 satır (≤3 satırlık paragraf bölünmez); başlık sonraki 2 satırla aynı sayfada; bolumBasi ve
 * sayfaSonu yeni sayfa (sayfa zaten boşsa boş sayfa üretilmez); bölüm açılış sayfasına numara basılmaz.
 */
(function (root, factory) {
  var m = factory(typeof module === 'object' && module.exports ? require('./hyphenation.js') : null);
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    root.Mucellit = root.Mucellit || {};
    root.Mucellit.epubTypeset = m;
  }
})(typeof self !== 'undefined' ? self : this, function (hyphenationModule) {
  'use strict';

  function H() { return hyphenationModule || (typeof self !== 'undefined' && self.Mucellit && self.Mucellit.hyphenation); }

  var TITLE_FACTOR = [1.6, 1.35, 1.15, 1, 1, 1];
  var FILL_THRESHOLD = 0.92;
  var SPACE_RE = /[ \t\n\r\f]+/;
  var SOFT = '­';

  function styleName(p) { return (p.bold ? 'B' : '') + (p.italic ? 'I' : '') || 'R'; }
  function visible(s) { return s.replace(/­/g, '').replace(/ /g, ' '); }

  // Ölçüm önbelleği sınırlı: yalnız kısa metinler (kelime/parça) saklanır, dolunca boşaltılır.
  // Uzun kelime bölünürken ölçülen önekler (her biri ayrı metin) önbelleği şişirmez.
  var CACHE_TEXT = 64;
  var CACHE_MAX = 20000;
  function cachedMeasurer(measurer) {
    var map = new Map();
    var f = function (text, style, fontSize) {
      var t = visible(text);
      if (!t) return 0;
      if (t.length > CACHE_TEXT) return measurer.width(t, style, fontSize);
      var k = style + '|' + fontSize + '|' + t;
      var v = map.get(k);
      if (v === undefined) {
        v = measurer.width(t, style, fontSize);
        if (map.size >= CACHE_MAX) map.clear();
        map.set(k, v);
      }
      return v;
    };
    f.size = function () { return map.size; };
    return f;
  }

  // ---------- kelimelere ayırma ----------
  // Kelime: boşlukla ayrılmamış parça dizisi. seg: { metin, stil, boy, ust }
  function splitIntoWords(block, fontSize) {
    var icons = [];
    var cur = null;
    function finish() { if (cur && cur.segs.length) icons.push(cur); cur = null; }
    (block.parts || []).forEach(function (p) {
      if (p.lineBreak) { finish(); icons.push({ lineBreak: true }); return; }
      var segBoy = fontSize * (p.small ? 0.85 : 1) * (p.top ? 0.7 : 1);
      var style = styleName(p);
      var i18n = p.i18n || block.i18n || '';
      var parts = String(p.text || '').split(/([ \t\n\r\f]+)/);
      parts.forEach(function (t) {
        if (!t) return;
        if (SPACE_RE.test(t) && !t.replace(SPACE_RE, '')) { finish(); return; }
        if (!cur) cur = { segs: [], i18n: i18n };
        cur.segs.push({ text: t, style: style, fontSize: segBoy, top: !!p.top });
      });
    });
    finish();
    while (icons.length && icons[icons.length - 1].lineBreak) icons.pop();
    while (icons.length && icons[0].lineBreak) icons.shift();
    return icons;
  }

  function wordText(w) { return w.segs.map(function (s) { return s.text; }).join(''); }
  function wordWidth(w, measure) { return w.segs.reduce(function (t, s) { return t + measure(s.text, s.style, s.fontSize); }, 0); }
  function wordUz(w) { return w.segs.reduce(function (t, s) { return t + s.text.length; }, 0); }

  /** İlk k karakterin genişliği (tiresiz); yalnız sol parça kurulur (sağ kalan kopyalanmaz). */
  function prefixWidth(w, k, measure) {
    var t = 0, i = 0;
    for (var j = 0; j < w.segs.length && i < k; j++) {
      var s = w.segs[j];
      var last = i + s.text.length;
      t += measure(last <= k ? s.text : s.text.slice(0, k - i), s.style, s.fontSize);
      i = last;
    }
    return t;
  }

  function tallProxy(c) { return c >= 0xd800 && c <= 0xdbff; }

  /**
   * Tahmini sığan önek: tek karakter genişliklerinin (önbellekli) önek toplamı yer'i aşana kadar sayılır.
   * En çok k+1 karakter gezilir (satır boyu kadar), kelimenin kalanına bakılmaz.
   */
  function estimatedPrefix(w, place, measure) {
    var t = 0, k = 0;
    for (var j = 0; j < w.segs.length; j++) {
      var s = w.segs[j];
      for (var i = 0; i < s.text.length; i++) {
        t += measure(s.text.charAt(i), s.style, s.fontSize);
        if (t > place + 1e-6) return k;
        k++;
      }
    }
    return k;
  }

  /**
   * [0, n−1] içinde yer'e sığan en büyük k (önek genişliği k ile artar; glif genişlikleri ≥ 0).
   * Önek toplamı tahmininden başlar, gerçek ölçümle doğrular (çoğu satırda 2 ölçüm); tahmin şaşarsa
   * oradan üstel + ikili arama. Satır başına O(log n) ölçüm, her biri satır boyu kadar metin.
   */
  function longestPrefix(w, n, place, measure) {
    if (n <= 1 || !(place >= 0)) return 0;
    function sig(k) { return prefixWidth(w, k, measure) <= place + 1e-6; }
    var k0 = Math.min(n - 1, estimatedPrefix(w, place, measure));
    var lo, hi, a;
    if (k0 === 0 || sig(k0)) {
      lo = k0; hi = n; // n: bütün kelime (çağıran için zaten sığmıyor)
      for (a = 1; lo + a < hi; a *= 2) { if (sig(lo + a)) lo += a; else { hi = lo + a; break; } }
    } else {
      lo = 0; hi = k0;
      for (a = 1; hi - a > 0; a *= 2) { if (sig(hi - a)) { lo = hi - a; break; } hi -= a; }
    }
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (sig(m)) lo = m; else hi = m; }
    return lo;
  }

  // Uzun kelimede (> UZUN karakter) tam genişlik ölçülmeden önce sığma denetlenir: tahmini taşma noktasındaki
  // gerçek önek bile sığmıyorsa kelime sığmaz (kelimenin tamamı her satırda yeniden ölçülmez).
  var LONG = 64;
  function wordWidthLimited(w, place, measure) {
    var n = wordUz(w);
    if (n > LONG) {
      var k = estimatedPrefix(w, place, measure);
      if (k < n && prefixWidth(w, k + 1, measure) > place + 1e-6) return Infinity;
    }
    return wordWidth(w, measure);
  }

  /** Kelimeyi k karakterinden böler; tire true ise sol parçaya '-' eklenir. */
  function splitWord(w, k, hyphen) {
    var left = [], right = [], i = 0;
    w.segs.forEach(function (s) {
      var head = i, last = i + s.text.length;
      if (last <= k) left.push(s);
      else if (head >= k) right.push(s);
      else {
        left.push(Object.assign({}, s, { text: s.text.slice(0, k - head) }));
        right.push(Object.assign({}, s, { text: s.text.slice(k - head) }));
      }
      i = last;
    });
    if (hyphen && left.length) {
      var last_ = left[left.length - 1];
      left[left.length - 1] = Object.assign({}, last_, { text: last_.text.replace(/­$/, '') + '-' });
    }
    var rest = { segs: right, i18n: w.i18n };
    // bölme noktaları kelimenin aslından devralınır (kalan parça için baştan hesaplanmaz)
    if (w.nk) rest.nk = { l: w.nk.l, o: w.nk.o + k };
    return [{ segs: left, i18n: w.i18n }, rest];
  }

  /**
   * Kelimenin aslındaki bölme noktaları, bir kez hesaplanır: { l: [{ k, tire, sol }] (artan, mutlak), o: ofset }.
   * sol: kalan parçada noktanın geçerli olması için gereken en az göreli k (sağ taraf aslıyla aynı kalır).
   * Bölünen kelimenin kalan parçası aynı listeyi devralır (nk.o = kalanın asıldaki başlangıcı); böylece uzun
   * kelimede heceleme her satırda baştan yapılmaz.
   */
  function pointList(w, hyphenate) {
    if (w.nk) return w.nk;
    var t = wordText(w);
    var l = [];
    var see = {};
    function add(k, hyphen, left) { if (k > 0 && k < t.length && !see[k]) { see[k] = 1; l.push({ k: k, hyphen: hyphen, left: left }); } }
    for (var i = 1; i < t.length - 1; i++) {
      var c = t.charAt(i);
      // var olan kısa çizgi: sonrasında tiresiz bölünür (her iki yanda en az 2 karakter)
      if ((c === '-' || c === '‐') && i >= 2 && t.length - i - 1 >= 2) add(i + 1, false, 3);
      if (hyphenate && c === SOFT) add(i + 1, true, 2);
    }
    if (hyphenate && /^tr\b/i.test(w.i18n || '') && H()) {
      // '-', U+2010 ve U+00AD ile ayrılmış her alt dizi ayrı hecelenir (heceleyici tire görünce hiç nokta vermiyordu)
      var altBas = 0;
      var addAlternatives = function (part, ofs) {
        H().breakPoints(part).forEach(function (k) { add(ofs + k, !H().isNoHyphen(part, k), 2); });
      };
      for (var j = 0; j <= t.length; j++) {
        var cj = j < t.length ? t.charAt(j) : '';
        if (j === t.length || cj === '-' || cj === '‐' || cj === SOFT) {
          if (j > altBas) addAlternatives(t.slice(altBas, j), altBas);
          altBas = j + 1;
        }
      }
    }
    l.sort(function (a, b) { return a.k - b.k; });
    w.nk = { l: l, o: 0 };
    return w.nk;
  }

  /** Bölme noktaları (bu parçaya göre): [{ k, tire }] artan. */
  function points(w, hyphenate) {
    var nk = pointList(w, hyphenate);
    var n = wordUz(w);
    var l = [];
    nk.l.forEach(function (p) {
      var k = p.k - nk.o;
      if (k > 0 && k < n && (nk.o === 0 || k >= p.left)) l.push({ k: k, hyphen: p.hyphen });
    });
    return l;
  }

  /** Artan l içinde mutlak k ≤ sinir olan son noktanın indisi (yoksa −1); ikili arama. */
  function sonNokta(l, limit) {
    var lo = 0, hi = l.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (l[m].k <= limit) lo = m + 1; else hi = m; }
    return lo - 1;
  }

  /** Kelimenin i. UTF-16 birimi (parçaları birleştirmeden). */
  function unitCode(w, i) {
    for (var j = 0; j < w.segs.length; j++) {
      var m = w.segs[j].text;
      if (i < m.length) return m.charCodeAt(i);
      i -= m.length;
    }
    return NaN;
  }

  // ---------- satırlara bölme ----------
  /**
   * Bir paragraf/başlık bloğunu satırlara böler.
   * Dönüş: [{ ogeler: [{ x (alan soluna göre), dy (satır üstünden taban çizgisi), metin, stil, boy, bosluk }] }]
   */
  function rows(block, fontSize, alanGen, settings, measure) {
    var em = fontSize;
    var solG = (block.leftIndent || 0) * em, sagG = (block.rightIndent || 0) * em;
    // İç içe liste/alıntı girintisi birikir ve üst sınırı yoktur: satır genişliği en az min(alan, 4 em) kalsın,
    // fazlası sol/sağ girintiden orantılı düşülür (W ≤ 0 olursa her kelime boş satır üretiyordu).
    var minWidth = Math.min(alanGen, 4 * em);
    if (solG + sagG > alanGen - minWidth) {
      var ratio = (alanGen - minWidth) / (solG + sagG);
      solG *= ratio; sagG *= ratio;
    }
    var W0 = alanGen - solG - sagG;
    var align = block.align || 'iki';
    var indent = !!block.indent && align !== 'middle' && align !== 'right' && W0 > 2 * em;
    var L = fontSize * settings.lineSpacing;
    var baseDy = (L - fontSize) / 2 + 0.8 * fontSize;
    var space = measure(' ', 'R', fontSize);
    var icons = splitIntoWords(block, fontSize);
    var output = [];
    var cur = [], curW = 0, first = true;

    function lineWidth() { return W0 - (first && indent ? em : 0); }

    function finish(toLeft) {
      var W = lineWidth();
      var head = solG + (first && indent ? em : 0);
      var widths = cur.map(function (w) { return wordWidth(w, measure); });
      var natural = widths.reduce(function (a, b) { return a + b; }, 0) + space * Math.max(0, cur.length - 1);
      var range = space;
      var x = head;
      if (align === 'iki' && !toLeft && cur.length > 1) range = space + (W - natural) / (cur.length - 1);
      else if (align === 'middle') x = head + Math.max(0, (W - natural) / 2);
      else if (align === 'right') x = head + Math.max(0, W - natural);
      var elements = [];
      if (first && block.prefix) {
        var oe = measure(block.prefix, 'R', fontSize);
        elements.push({ x: Math.max(0, solG - oe - 0.4 * em), dy: baseDy, text: block.prefix, style: 'R', fontSize: fontSize, space: true });
      }
      cur.forEach(function (w, i) {
        var sx = x;
        w.segs.forEach(function (s, j) {
          var t = visible(s.text);
          if (t) {
            elements.push({ x: sx, dy: baseDy - (s.top ? 0.33 * fontSize : 0), text: t, style: s.style, fontSize: s.fontSize, space: j === w.segs.length - 1 && i < cur.length - 1 });
          }
          sx += measure(s.text, s.style, s.fontSize);
        });
        x += widths[i] + range;
      });
      output.push({ elements: elements, height: L });
      cur = []; curW = 0; first = false;
    }

    function longestFitting(w, place, required) {
      var n = wordUz(w);
      // tiresiz sığan en uzun önek (üstel + ikili arama); hiçbir bölme noktası bundan ileride sığamaz
      var kFlat = longestPrefix(w, n, place, measure);
      var nk = pointList(w, settings.hyphenate);
      for (var i = sonNokta(nk.l, nk.o + kFlat); i >= 0; i--) {
        var kr = nk.l[i].k - nk.o;
        if (kr <= 0) break;
        if (nk.o > 0 && kr < nk.l[i].left) continue;
        var p = splitWord(w, kr, nk.l[i].hyphen);
        if (wordWidth(p[0], measure) <= place + 1e-6) return p;
      }
      if (!required) return null;
      // hiç nokta sığmıyor ve satır boş: karakterden böl (kelime satırdan uzun); vekil çift bölünmez
      var k = kFlat;
      if (k > 1 && k < n && tallProxy(unitCode(w, k - 1))) k -= 1;
      if (k < 1) k = n > 1 && tallProxy(unitCode(w, 0)) ? 2 : 1;
      return splitWord(w, k, false);
    }

    icons.forEach(function (s) {
      if (s.lineBreak) { finish(true); return; }
      var w = s;
      for (var protection = 0; protection < 10000; protection++) {
        if (!w.segs.length) return; // bölmeden boş kalan parça: döngü biter
        var W = lineWidth();
        var ek = cur.length ? space : 0;
        var g = wordWidthLimited(w, W - curW - ek, measure);
        if (curW + ek + g <= W + 1e-6) { cur.push(w); curW += ek + g; return; }
        if (!cur.length || curW / W < FILL_THRESHOLD) {
          var p = longestFitting(w, W - curW - ek, !cur.length);
          if (p) { cur.push(p[0]); curW += ek + wordWidth(p[0], measure); finish(false); w = p[1]; continue; }
        }
        finish(false);
      }
    });
    if (cur.length || !output.length) finish(true);
    return output;
  }

  /** Arayüz metni: tarayıcıda KitapCilt.dil, Node'da ../../i18n.js. */
  function i18nT(a, p) {
    var k = typeof self !== 'undefined' ? self : globalThis;
    return ((k && k.Mucellit && k.Mucellit.i18n) || require('../../i18n.js')).t(a, p);
  }

  // ---------- sayfalama ----------
  function* imposeGenerator(blocks, settings, measurer) {
    var measure = cachedMeasurer(measurer);
    var k = settings.margin;
    var alanGen = settings.pageWidth - k.inner - k.outer;
    var fieldHeight = settings.pageHeight - k.top - k.bottom;
    if (!(alanGen > 0) || !(fieldHeight > 0)) throw new Error(i18nT('typeset.margin_too_large', { width: Math.round(alanGen), height: Math.round(fieldHeight) }));
    var top = settings.pageHeight - k.top;
    var pages = [];
    var page = { no: 1, chapterStart: false, elements: [] };
    var used = 0;
    var warnings = { lowDpi: 0 };
    var lineCache = {};

    function blank() { return page.elements.length === 0 && used === 0; }
    function newPage() {
      pages.push(page);
      page = { no: pages.length + 1, chapterStart: false, elements: [] };
      used = 0;
    }
    function blockLength(b) {
      if (b.kind === 'title') return settings.fontSize * TITLE_FACTOR[Math.min(6, Math.max(1, b.level || 1)) - 1];
      return settings.fontSize * (b.small ? 0.85 : 1);
    }
    function previous(i) { return i > 0 ? blocks[i - 1] : null; }
    function blockIndented(i) {
      var b = blocks[i], o = previous(i);
      if (!b.indent || b.prefix) return false;
      return !!o && o.kind === 'paragraph' && !o.prefix;
    }
    function takeLines(i) {
      if (lineCache[i]) return lineCache[i];
      var b = blocks[i];
      var bb = Object.assign({}, b, { indent: b.kind === 'paragraph' ? blockIndented(i) : false });
      if (b.kind === 'title') {
        bb.align = b.align || (b.level <= 2 ? 'middle' : 'left');
        bb.parts = (b.parts || []).map(function (p) { return p.lineBreak ? p : Object.assign({}, p, { bold: true }); });
      }
      var r = rows(bb, blockLength(b), alanGen, settings, measure);
      lineCache[i] = r;
      return r;
    }
    function putLine(s, i, no) {
      s.elements.forEach(function (o) {
        page.elements.push({ kind: 'text', x: k.inner + o.x, y: top - used - o.dy, text: o.text, style: o.style, fontSize: o.fontSize, space: o.space, block: i, line: no });
      });
      used += s.height;
    }
    function putSpace(h) { if (!blank()) used += h; }
    function rest() { return fieldHeight - used; }

    for (var i = 0; i < blocks.length; i++) {
      if (i > 0 && i % 200 === 0) yield i;
      var b = blocks[i];
      var L = blockLength(b) * settings.lineSpacing;
      if (b.kind === 'chapterStart' || b.kind === 'pageEnd') {
        if (!blank()) newPage();
        if (b.kind === 'chapterStart') page.chapterStart = true;
        continue;
      }
      if (b.kind === 'separator') {
        var before = blank() ? 0 : 0.5 * L;
        if (before + L > rest() + 1e-6 && !blank()) newPage(); else putSpace(before);
        var star = '* * *';
        var yg = measure(star, 'R', settings.fontSize);
        putLine({ elements: [{ x: (alanGen - yg) / 2, dy: (L - settings.fontSize) / 2 + 0.8 * settings.fontSize, text: star, style: 'R', fontSize: settings.fontSize, space: false }], height: L }, i, 0);
        used += Math.max(0, Math.min(0.5 * L, rest()));
        continue;
      }
      if (b.kind === 'image') {
        var r = b.image || {};
        var w = (r.pixelWidth || 1) * 0.75, h = (r.pixelHeight || 1) * 0.75;
        var scaling = Math.min(1, alanGen / w, fieldHeight / h);
        w *= scaling; h *= scaling;
        var once = blank() ? 0 : 0.5 * L;
        if (once + h > rest() + 1e-6) newPage(); else putSpace(once);
        page.elements.push({ kind: 'image', x: k.inner + (alanGen - w) / 2, y: top - used - h, w: w, h: h, key: r.key, block: i });
        used += h;
        if (r.pixelWidth / (w / 72) < 300 - 1e-6) warnings.lowDpi += 1;
        used += Math.min(0.5 * L, rest());
        continue;
      }
      // paragraf / başlık
      var sl = takeLines(i);
      if (!sl.length) continue;
      var title = b.kind === 'title';
      var frontSpace = title ? L : 0;
      if (title) {
        // başlık + sonraki bloğun ilk 2 satırı aynı sayfada
        var need = (blank() ? 0 : frontSpace) + sl.length * L + 0.5 * L;
        var j = i + 1;
        if (j < blocks.length && (blocks[j].kind === 'paragraph' || blocks[j].kind === 'title')) {
          var next = takeLines(j);
          need += Math.min(2, next.length) * (next.length ? next[0].height : 0);
        } else if (j < blocks.length && blocks[j].kind === 'image') {
          need += L; // en az bir satırlık yer: resim sayfaya sığmazsa başlık onunla birlikte iner
        }
        if (need > rest() + 1e-6 && !blank()) newPage();
        putSpace(frontSpace);
        sl.forEach(function (s, n) { if (s.height > rest() + 1e-6 && !blank()) newPage(); putLine(s, i, n); });
        used += Math.min(0.5 * L, rest());
        continue;
      }
      var n = 0;
      while (n < sl.length) {
        var restLine = sl.length - n;
        var fitting = Math.floor((rest() + 1e-6) / L);
        if (fitting >= restLine) { for (; n < sl.length; n++) putLine(sl[n], i, n); break; }
        // bölünmesi gerek
        var put;
        if (blank()) {
          // boş sayfaya bile sığmıyor: sığanı koy, alttakine en az 2 satır bırak
          put = Math.max(1, Math.min(fitting, restLine - 2));
        } else if (restLine <= 3 || fitting < 2 || (n === 0 && sl.length <= 3)) {
          newPage();
          continue;
        } else {
          put = Math.min(fitting, restLine - 2);
          if (put < 2) { newPage(); continue; }
        }
        for (var t = 0; t < put; t++, n++) putLine(sl[n], i, n);
        newPage();
      }
    }
    if (page.elements.length) pages.push(page);
    // sayfa numaraları (bölüm açılış sayfasına basılmaz)
    if (settings.pageNumbers) {
      var nb = settings.pageNoLength || 9;
      pages.forEach(function (s, idx) {
        if (s.chapterStart) return;
        var t = String(idx + 1);
        s.elements.push({ kind: 'text', role: 'pageNumbers', x: (settings.pageWidth - measure(t, 'R', nb)) / 2, y: k.bottom / 2, text: t, style: 'R', fontSize: nb, space: false });
      });
    }
    pages.forEach(function (s, idx) { s.no = idx + 1; });
    return { pages: pages, warnings: warnings, field: { x: k.inner, y: k.bottom, w: alanGen, h: fieldHeight } };
  }

  function impose(blocks, settings, measurer) {
    var it = imposeGenerator(blocks, settings, measurer);
    var r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  async function imposeAsync(blocks, settings, measurer) {
    var it = imposeGenerator(blocks, settings, measurer);
    var r = it.next();
    while (!r.done) {
      await new Promise(function (ok) { setTimeout(ok, 0); });
      r = it.next();
    }
    return r.value;
  }

  /**
   * fontlar: { R, I, B, BI } fontkit yazı tipi nesneleri. Genişlik = Σ glyph.advanceWidth × boy / unitsPerEm
   * (pdf-lib CustomFontEmbedder.widthOfTextAtSize ile aynı; kerning yok, liga kapalı).
   */
  function fontkitMeasurer(fonts, features) {
    var oz = features || { liga: false };
    return {
      width: function (text, style, fontSize) {
        var f = fonts[style] || fonts.R;
        var gl = f.layout(text, oz).glyphs;
        var t = 0;
        for (var i = 0; i < gl.length; i++) t += gl[i].advanceWidth;
        return t * fontSize / f.unitsPerEm;
      }
    };
  }

  return { impose: impose, imposeAsync: imposeAsync, fontkitMeasurer: fontkitMeasurer, rows: rows, splitIntoWords: splitIntoWords, points: points, cachedMeasurer: cachedMeasurer };
});
