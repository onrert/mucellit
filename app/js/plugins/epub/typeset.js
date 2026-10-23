/*
 * typeset.js — lays the EPUB block list (IR) out on pages; a pure module without DOM
 * (Mucellit.epubTypeset / module.exports). Unit tested in Node.
 *
 *   typeset(blocks, settings, measurer)      → { pages, warnings }       (synchronous)
 *   typesetAsync(blocks, settings, measurer) → Promise<{ pages, warnings }> (yields to the event loop every 200 blocks)
 *   fontkitMeasurer(fonts)                   → measurer (with fontkit fonts; the same as pdf-lib's widthOfTextAtSize)
 *
 * settings (pt): { pageWidth, pageHeight, margin: { top, bottom, inner, outer }, fontSize, lineSpacing, hyphenate,
 *                  pageNumbers, pageNumberSize = 9 }
 * measurer: { width(text, style, fontSize) → pt }   style: 'R' | 'I' | 'B' | 'BI'
 *
 * BLOCK (IR):
 *   { kind: 'paragraph', align: 'justify'|'left'|'center'|'right', indent, leftIndent (em), rightIndent (em), small,
 *     prefix, lang, parts: [{ text, italic, bold, top, small, lang } | { lineBreak: true }] }   (lineBreak: <br>)
 *   { kind: 'title', level: 1..6, align, parts }
 *   { kind: 'image', image: { key, pixelWidth, pixelHeight } }
 *   { kind: 'separator' } | { kind: 'pageEnd' } | { kind: 'chapterStart' }
 * PAGE: { no, chapterStart, elements: [{ kind: 'text', x, y, text, style, fontSize, space, block, line, role? }
 *                                      | { kind: 'image', x, y, w, h, key, block }] }   pt, origin bottom left.
 *   space: true → pdf-writer writes a space after this part (word separator for searchable text).
 *
 * Rules: greedy line breaking; a word that does not fit is split with "-" at the longest hyphenation point that fits
 * when the line is less than 92% full; on a justified line the extra space is spread evenly over the gaps, the last
 * line and a line before <br> go left; U+00A0 does not break; widows/orphans at least 2 lines (a paragraph of ≤3 lines
 * is not split); a title stays on the same page as the next 2 lines; chapterStart and pageEnd start a new page (no
 * blank page when the page is already empty); no number is printed on a chapter opening page.
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

  // The measurement cache is limited: only short texts (words/parts) are kept, it is emptied when full.
  // The prefixes measured while splitting a long word (each a different text) do not bloat the cache.
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

  // ---------- splitting into words ----------
  // Word: a run of parts not separated by a space. seg: { text, style, fontSize, top }
  function splitIntoWords(block, fontSize) {
    var icons = [];
    var cur = null;
    function finish() { if (cur && cur.segs.length) icons.push(cur); cur = null; }
    (block.parts || []).forEach(function (p) {
      if (p.lineBreak) { finish(); icons.push({ lineBreak: true }); return; }
      var segBoy = fontSize * (p.small ? 0.85 : 1) * (p.top ? 0.7 : 1);
      var style = styleName(p);
      var lang = p.lang || block.lang || '';
      var parts = String(p.text || '').split(/([ \t\n\r\f]+)/);
      parts.forEach(function (t) {
        if (!t) return;
        if (SPACE_RE.test(t) && !t.replace(SPACE_RE, '')) { finish(); return; }
        if (!cur) cur = { segs: [], lang: lang };
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
  function wordLength(w) { return w.segs.reduce(function (t, s) { return t + s.text.length; }, 0); }

  /** Width of the first k characters (without hyphen); only the left part is built (the right rest is not copied). */
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

  function isHighSurrogate(c) { return c >= 0xd800 && c <= 0xdbff; }

  /**
   * Estimated fitting prefix: counted until the prefix sum of the (cached) single character widths passes place.
   * At most k+1 characters are visited (about a line long); the rest of the word is not looked at.
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
   * The largest k in [0, n−1] that fits in place (the prefix width grows with k; glyph widths ≥ 0).
   * Starts from the prefix-sum estimate and checks it with a real measurement (2 measurements on most lines); if the
   * estimate is off, exponential + binary search from there. O(log n) measurements per line, each of about a line of text.
   */
  function longestPrefix(w, n, place, measure) {
    if (n <= 1 || !(place >= 0)) return 0;
    function sig(k) { return prefixWidth(w, k, measure) <= place + 1e-6; }
    var k0 = Math.min(n - 1, estimatedPrefix(w, place, measure));
    var lo, hi, a;
    if (k0 === 0 || sig(k0)) {
      lo = k0; hi = n; // n: the whole word (it does not fit for the caller anyway)
      for (a = 1; lo + a < hi; a *= 2) { if (sig(lo + a)) lo += a; else { hi = lo + a; break; } }
    } else {
      lo = 0; hi = k0;
      for (a = 1; hi - a > 0; a *= 2) { if (sig(hi - a)) { lo = hi - a; break; } hi -= a; }
    }
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (sig(m)) lo = m; else hi = m; }
    return lo;
  }

  // For a long word (> LONG characters) the fit is checked before the full width is measured: if even the real prefix
  // at the estimated overflow point does not fit, the word does not fit (the whole word is not measured again on every line).
  var LONG = 64;
  function wordWidthLimited(w, place, measure) {
    var n = wordLength(w);
    if (n > LONG) {
      var k = estimatedPrefix(w, place, measure);
      if (k < n && prefixWidth(w, k + 1, measure) > place + 1e-6) return Infinity;
    }
    return wordWidth(w, measure);
  }

  /** Splits the word at character k; when hyphen is true a '-' is added to the left part. */
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
    var rest = { segs: right, lang: w.lang };
    // the split points are inherited from the original word (not calculated again for the rest)
    if (w.nk) rest.nk = { l: w.nk.l, o: w.nk.o + k };
    return [{ segs: left, lang: w.lang }, rest];
  }

  /**
   * The split points of the original word, calculated once: { l: [{ k, hyphen, left }] (ascending, absolute), o: offset }.
   * left: the smallest relative k the point needs to be valid in the rest (the right side stays as in the original).
   * The rest of a split word inherits the same list (nk.o = start of the rest in the original); so a long word is not
   * hyphenated again on every line.
   */
  function pointList(w, hyphenate) {
    if (w.nk) return w.nk;
    var t = wordText(w);
    var l = [];
    var see = {};
    function add(k, hyphen, left) { if (k > 0 && k < t.length && !see[k]) { see[k] = 1; l.push({ k: k, hyphen: hyphen, left: left }); } }
    for (var i = 1; i < t.length - 1; i++) {
      var c = t.charAt(i);
      // an existing hyphen: split after it without a hyphen (at least 2 characters on both sides)
      if ((c === '-' || c === '‐') && i >= 2 && t.length - i - 1 >= 2) add(i + 1, false, 3);
      if (hyphenate && c === SOFT) add(i + 1, true, 2);
    }
    if (hyphenate && /^tr\b/i.test(w.lang || '') && H()) {
      // every substring separated by '-', U+2010 and U+00AD is hyphenated separately (the hyphenator gave no point when it saw a hyphen)
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

  /** Split points (relative to this part): [{ k, hyphen }] ascending. */
  function points(w, hyphenate) {
    var nk = pointList(w, hyphenate);
    var n = wordLength(w);
    var l = [];
    nk.l.forEach(function (p) {
      var k = p.k - nk.o;
      if (k > 0 && k < n && (nk.o === 0 || k >= p.left)) l.push({ k: k, hyphen: p.hyphen });
    });
    return l;
  }

  /** Index of the last point in the ascending l with an absolute k ≤ limit (−1 when there is none); binary search. */
  function lastPointAt(l, limit) {
    var lo = 0, hi = l.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (l[m].k <= limit) lo = m + 1; else hi = m; }
    return lo - 1;
  }

  /** The i-th UTF-16 unit of the word (without joining the parts). */
  function unitCode(w, i) {
    for (var j = 0; j < w.segs.length; j++) {
      var m = w.segs[j].text;
      if (i < m.length) return m.charCodeAt(i);
      i -= m.length;
    }
    return NaN;
  }

  // ---------- splitting into lines ----------
  /**
   * Splits a paragraph/title block into lines.
   * Returns: [{ elements: [{ x (from the left of the area), dy (baseline from the top of the line), text, style, fontSize, space }] }]
   */
  function rows(block, fontSize, areaWidth, settings, measure) {
    var em = fontSize;
    var leftLevel = (block.leftIndent || 0) * em, rightLevel = (block.rightIndent || 0) * em;
    // Nested list/quote indents add up and have no upper limit: the line width stays at least min(area, 4 em), the
    // rest is taken from the left/right indents in proportion (with W ≤ 0 every word made an empty line).
    var minWidth = Math.min(areaWidth, 4 * em);
    if (leftLevel + rightLevel > areaWidth - minWidth) {
      var ratio = (areaWidth - minWidth) / (leftLevel + rightLevel);
      leftLevel *= ratio; rightLevel *= ratio;
    }
    var W0 = areaWidth - leftLevel - rightLevel;
    var align = block.align || 'justify';
    var indent = !!block.indent && align !== 'center' && align !== 'right' && W0 > 2 * em;
    var L = fontSize * settings.lineSpacing;
    var baseDy = (L - fontSize) / 2 + 0.8 * fontSize;
    var space = measure(' ', 'R', fontSize);
    var icons = splitIntoWords(block, fontSize);
    var output = [];
    var cur = [], curW = 0, first = true;

    function lineWidth() { return W0 - (first && indent ? em : 0); }

    function finish(toLeft) {
      var W = lineWidth();
      var head = leftLevel + (first && indent ? em : 0);
      var widths = cur.map(function (w) { return wordWidth(w, measure); });
      var natural = widths.reduce(function (a, b) { return a + b; }, 0) + space * Math.max(0, cur.length - 1);
      var range = space;
      var x = head;
      if (align === 'justify' && !toLeft && cur.length > 1) range = space + (W - natural) / (cur.length - 1);
      else if (align === 'center') x = head + Math.max(0, (W - natural) / 2);
      else if (align === 'right') x = head + Math.max(0, W - natural);
      var elements = [];
      if (first && block.prefix) {
        var oe = measure(block.prefix, 'R', fontSize);
        elements.push({ x: Math.max(0, leftLevel - oe - 0.4 * em), dy: baseDy, text: block.prefix, style: 'R', fontSize: fontSize, space: true });
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
      var n = wordLength(w);
      // the longest prefix that fits without a hyphen (exponential + binary search); no split point beyond it can fit
      var kFlat = longestPrefix(w, n, place, measure);
      var nk = pointList(w, settings.hyphenate);
      for (var i = lastPointAt(nk.l, nk.o + kFlat); i >= 0; i--) {
        var kr = nk.l[i].k - nk.o;
        if (kr <= 0) break;
        if (nk.o > 0 && kr < nk.l[i].left) continue;
        var p = splitWord(w, kr, nk.l[i].hyphen);
        if (wordWidth(p[0], measure) <= place + 1e-6) return p;
      }
      if (!required) return null;
      // no point fits and the line is empty: split at a character (the word is longer than the line); a surrogate pair is not split
      var k = kFlat;
      if (k > 1 && k < n && isHighSurrogate(unitCode(w, k - 1))) k -= 1;
      if (k < 1) k = n > 1 && isHighSurrogate(unitCode(w, 0)) ? 2 : 1;
      return splitWord(w, k, false);
    }

    icons.forEach(function (s) {
      if (s.lineBreak) { finish(true); return; }
      var w = s;
      for (var protection = 0; protection < 10000; protection++) {
        if (!w.segs.length) return; // a part left empty by the split: the loop ends
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

  /** Interface text: Mucellit.i18n in the browser, ../../i18n.js in Node. */
  function i18nT(a, p) {
    var k = typeof self !== 'undefined' ? self : globalThis;
    return ((k && k.Mucellit && k.Mucellit.i18n) || require('../../i18n.js')).t(a, p);
  }

  // ---------- sayfalama ----------
  function* imposeGenerator(blocks, settings, measurer) {
    var measure = cachedMeasurer(measurer);
    var k = settings.margin;
    var areaWidth = settings.pageWidth - k.inner - k.outer;
    var fieldHeight = settings.pageHeight - k.top - k.bottom;
    if (!(areaWidth > 0) || !(fieldHeight > 0)) throw new Error(i18nT('typeset.margin_too_large', { width: Math.round(areaWidth), height: Math.round(fieldHeight) }));
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
        bb.align = b.align || (b.level <= 2 ? 'center' : 'left');
        bb.parts = (b.parts || []).map(function (p) { return p.lineBreak ? p : Object.assign({}, p, { bold: true }); });
      }
      var r = rows(bb, blockLength(b), areaWidth, settings, measure);
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
        putLine({ elements: [{ x: (areaWidth - yg) / 2, dy: (L - settings.fontSize) / 2 + 0.8 * settings.fontSize, text: star, style: 'R', fontSize: settings.fontSize, space: false }], height: L }, i, 0);
        used += Math.max(0, Math.min(0.5 * L, rest()));
        continue;
      }
      if (b.kind === 'image') {
        var r = b.image || {};
        var w = (r.pixelWidth || 1) * 0.75, h = (r.pixelHeight || 1) * 0.75;
        var scaling = Math.min(1, areaWidth / w, fieldHeight / h);
        w *= scaling; h *= scaling;
        var once = blank() ? 0 : 0.5 * L;
        if (once + h > rest() + 1e-6) newPage(); else putSpace(once);
        page.elements.push({ kind: 'image', x: k.inner + (areaWidth - w) / 2, y: top - used - h, w: w, h: h, key: r.key, block: i });
        used += h;
        if (r.pixelWidth / (w / 72) < 300 - 1e-6) warnings.lowDpi += 1;
        used += Math.min(0.5 * L, rest());
        continue;
      }
      // paragraph / title
      var sl = takeLines(i);
      if (!sl.length) continue;
      var title = b.kind === 'title';
      var frontSpace = title ? L : 0;
      if (title) {
        // a title + the first 2 lines of the next block on the same page
        var need = (blank() ? 0 : frontSpace) + sl.length * L + 0.5 * L;
        var j = i + 1;
        if (j < blocks.length && (blocks[j].kind === 'paragraph' || blocks[j].kind === 'title')) {
          var next = takeLines(j);
          need += Math.min(2, next.length) * (next.length ? next[0].height : 0);
        } else if (j < blocks.length && blocks[j].kind === 'image') {
          need += L; // room for at least one line: when the image does not fit on the page the title goes down with it
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
        // needs to be split
        var put;
        if (blank()) {
          // does not fit even on an empty page: place what fits, leave at least 2 lines for the next one
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
    // page numbers (not printed on a chapter opening page)
    if (settings.pageNumbers) {
      var nb = settings.pageNumberSize || 9;
      pages.forEach(function (s, idx) {
        if (s.chapterStart) return;
        var t = String(idx + 1);
        s.elements.push({ kind: 'text', role: 'pageNumbers', x: (settings.pageWidth - measure(t, 'R', nb)) / 2, y: k.bottom / 2, text: t, style: 'R', fontSize: nb, space: false });
      });
    }
    pages.forEach(function (s, idx) { s.no = idx + 1; });
    return { pages: pages, warnings: warnings, field: { x: k.inner, y: k.bottom, w: areaWidth, h: fieldHeight } };
  }

  function typeset(blocks, settings, measurer) {
    var it = imposeGenerator(blocks, settings, measurer);
    var r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  async function typesetAsync(blocks, settings, measurer) {
    var it = imposeGenerator(blocks, settings, measurer);
    var r = it.next();
    while (!r.done) {
      await new Promise(function (ok) { setTimeout(ok, 0); });
      r = it.next();
    }
    return r.value;
  }

  /**
   * fonts: { R, I, B, BI } fontkit font objects. Width = Σ glyph.advanceWidth × fontSize / unitsPerEm
   * (the same as pdf-lib CustomFontEmbedder.widthOfTextAtSize; no kerning, liga off).
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

  return { typeset: typeset, typesetAsync: typesetAsync, fontkitMeasurer: fontkitMeasurer, rows: rows, splitIntoWords: splitIntoWords, points: points, cachedMeasurer: cachedMeasurer };
});
