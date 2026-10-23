/*
 * layout.js — printer sheet geometry, a pure module without DOM
 * (Mucellit.layout / module.exports).
 *
 * Coordinates in mm, the origin is the BOTTOM LEFT corner of the paper (as in PDF).
 * Takes an imposition result (imposition.js) and builds, for the front and back of
 * every sheet, the page slots, content boxes, crop/fold lines and the signature
 * spine mark. Drawing into the PDF is output.js's job.
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    root.Mucellit = root.Mucellit || {};
    root.Mucellit.layout = m;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var root = typeof self !== 'undefined' ? self : globalThis; // Mucellit.i18n is found in a vm context too
  function I18n() { return (root && root.Mucellit && root.Mucellit.i18n) || require('./i18n.js'); }
  function t(a, p) { return I18n().t(a, p); }

  var MARK_GAP = 2;   // distance of the crop mark from the book block
  var MARK_LENGTH = 5;      // crop mark line length
  var FOLD_MARK_LENGTH = 5;     // fold mark, from the paper edge inwards
  var SPINE_MARK_WIDTH = 3;        // width of the signature spine mark
  var SPINE_MARK_HEIGHT = 5;        // height of the signature spine mark (one step)
  var SPINE_MARK_STYLES = 4;       // number of spine mark styles: 0 filled, 1 outline, 2 two small squares, 3 three small squares

  function roundOff(x) { return Math.round(x * 1e6) / 1e6; }

  function num(v, defaults) {
    var n = Number(v);
    return isFinite(n) ? n : defaults;
  }

  /** The spine (binding) side of a page number: odd pages are on the right, their spine on the left. */
  function spineSide(kind, slotNo, page) {
    if (kind === 'sewn') return slotNo === 0 ? 'right' : 'left';
    return page % 2 === 1 ? 'left' : 'right';
  }

  /**
   * Places a source page in the content box.
   * pageWidth/pageHeight: unrotated size of the source page (mm)
   * angle: total clockwise rotation (0/90/180/270)
   * scaling: 'fit' | 'actual' | 'fill'
   * Returns: { s (scale), width, height (as shown, scaled), centerX, centerY }
   */
  function fitPage(box, pageWidth, pageHeight, angle, scaling) {
    var a = ((Number(angle) || 0) % 360 + 360) % 360;
    var dg = a % 180 === 0 ? pageWidth : pageHeight;
    var dy = a % 180 === 0 ? pageHeight : pageWidth;
    var s;
    if (scaling === 'actual') s = 1;
    else if (scaling === 'fill') s = Math.max(box.w / dg, box.h / dy);
    else s = Math.min(box.w / dg, box.h / dy);
    return {
      s: s,
      width: dg * s,
      height: dy * s,
      centerX: box.x + box.w / 2,
      centerY: box.y + box.h / 2
    };
  }

  /**
   * Origin of a rotated drawing: where to put the origin so that a box of width w and height h
   * (scaled, unrotated), rotated `angleReversed` degrees COUNTER-clockwise around the origin,
   * has its center at (mx, my).
   */
  function drawOrigin(mx, my, w, h, angleReversed) {
    var r = angleReversed * Math.PI / 180;
    var c = Math.cos(r), s = Math.sin(r);
    var ox = (w / 2) * c - (h / 2) * s;
    var oy = (w / 2) * s + (h / 2) * c;
    return { x: roundOff(mx - ox), y: roundOff(my - oy) };
  }

  /**
   * Must the back sides be rotated by 180°?
   * The imposition assumes the paper is turned around the VERTICAL axis of its content
   * (back side upright; the back of the right page is on the left). The printer setting refers
   * to the physical paper edge:
   *  - landscape paper (width > height): the vertical axis is parallel to the short edge →
   *    "short edge" is upright, "long edge" prints the backs upside down → rotate 180°.
   *  - portrait paper (width <= height): the vertical axis is parallel to the long edge →
   *    "long edge" is upright, "short edge" prints upside down → rotate 180°.
   */
  function shouldRotateBacks(duplex, paperWidth, paperHeight) {
    var landscape = Number(paperWidth) > Number(paperHeight);
    var short = duplex === 'short';
    return landscape ? !short : short;
  }

  function rotateBox180(k, PW, PH) {
    var y = {};
    Object.keys(k).forEach(function (a) { y[a] = k[a]; });
    y.x = roundOff(PW - k.x - k.w);
    y.y = roundOff(PH - k.y - k.h);
    return y;
  }

  function rotateLine180(c, PW, PH) {
    return { x1: roundOff(PW - c.x1), y1: roundOff(PH - c.y1), x2: roundOff(PW - c.x2), y2: roundOff(PH - c.y2), dashed: c.dashed };
  }

  /**
   * settings: { paperWidth, paperHeight, bookWidth, bookHeight, outerMargin=0, gutter=0,
   *             cropMarks=true, folding=true, spineMarks=true,
   *             duplex='short'|'long' (the printer's duplex flip setting) }
   */
  function layout(imposition, settings) {
    var PW = num(settings.paperWidth, 0), PH = num(settings.paperHeight, 0);
    var BW = num(settings.bookWidth, 0), BH = num(settings.bookHeight, 0);
    if (!(PW > 0 && PH > 0 && BW > 0 && BH > 0)) throw new RangeError(t('layout.size_positive'));
    var outer = num(settings.outerMargin, 0);
    var binding = num(settings.gutter, 0);
    if (outer < 0 || binding < 0) throw new RangeError(t('layout.margin_negative'));
    var kind = imposition.kind;
    var slotsPerSide = imposition.slotsPerSide;
    var warnings = [];

    var blockWidth = BW * slotsPerSide;
    var doesNotFit = blockWidth > PW + 0.01 || BH > PH + 0.01;
    if (doesNotFit) {
      warnings.push(t('layout.doesNotFit', { n: slotsPerSide, bw: BW, bh: BH, pw: PW, ph: PH }));
    }
    if (BW - outer - binding <= 0 || BH - 2 * outer <= 0) {
      warnings.push(t('layout.no_content'));
    }
    var bx = (PW - blockWidth) / 2;
    var by = (PH - BH) / 2;
    var middleX = PW / 2;

    // Crop/fold lines (at the same place on both sides of the sheet)
    var sharedLines = [];
    function addCropMark(x1, y1, x2, y2) {
      // clip the line to the paper; skip it when it gets too short
      var c = { x1: Math.max(0, Math.min(PW, x1)), y1: Math.max(0, Math.min(PH, y1)),
        x2: Math.max(0, Math.min(PW, x2)), y2: Math.max(0, Math.min(PH, y2)) };
      if (Math.hypot(c.x2 - c.x1, c.y2 - c.y1) >= 1) sharedLines.push(c);
    }
    if (settings.cropMarks !== false) {
      var g = MARK_GAP, L = MARK_LENGTH;
      var xs = [bx, bx + blockWidth], ys = [by, by + BH];
      xs.forEach(function (x) {
        var direction = x === bx ? -1 : 1;
        ys.forEach(function (y) {
          var ydir = y === by ? -1 : 1;
          addCropMark(x + direction * g, y, x + direction * (g + L), y);         // horizontal
          addCropMark(x, y + ydir * g, x, y + ydir * (g + L));       // vertical
        });
      });
      if (kind === 'single2') { // mark for the cut line in the middle
        addCropMark(middleX, by - g, middleX, by - g - L);
        addCropMark(middleX, by + BH + g, middleX, by + BH + g + L);
      }
    }
    var foldLines = [];
    if (kind === 'sewn' && settings.folding !== false) {
      foldLines.push({ x1: middleX, y1: PH, x2: middleX, y2: PH - FOLD_MARK_LENGTH, dashed: true });
      foldLines.push({ x1: middleX, y1: 0, x2: middleX, y2: FOLD_MARK_LENGTH, dashed: true });
    }

    var spineSteps = Math.max(1, Math.floor((BH - 10) / SPINE_MARK_HEIGHT));
    var rotateBacks = shouldRotateBacks(settings.duplex, PW, PH);
    var sides = [];

    imposition.sheets.forEach(function (sheet) {
      ['front', 'back'].forEach(function (side) {
        var pages = sheet[side];
        var slots = pages.map(function (page, slotNo) {
          var slot = { x: roundOff(bx + slotNo * BW), y: roundOff(by), w: BW, h: BH };
          var side = spineSide(kind, slotNo, page);
          var creep = kind === 'sewn' ? (sheet.creep || 0) : 0;
          var icX = slot.x + (side === 'left' ? binding : outer) + (side === 'left' ? -creep : creep);
          var content = { x: roundOff(icX), y: roundOff(by + outer), w: roundOff(Math.max(0, BW - binding - outer)), h: roundOff(Math.max(0, BH - 2 * outer)) };
          return { page: page, blank: imposition.isBlank(page), slot: slot, content: content, spineSide: side, creep: creep };
        });
        var lines = sharedLines.concat(foldLines);
        var squares = [];
        if (kind === 'sewn' && settings.spineMarks !== false && side === 'front' && sheet.indexInSignature === 0) {
          // When the number of steps (spineSteps, depends on the book height) is used up, the mark does not move sideways; it
          // stays on the fold line (middleX); in a new cycle the steps start again from the top and the mark STYLE changes
          // (cycle 0 filled, 1 outline, 2 two small squares, 3 three small squares; then it starts over). The (cycle, step) pair is unique.
          var step = sheet.signature % spineSteps;
          var cycle = Math.floor(sheet.signature / spineSteps);
          squares.push({ x: roundOff(middleX - SPINE_MARK_WIDTH / 2), y: roundOff(by + BH - 5 - (step + 1) * SPINE_MARK_HEIGHT), w: SPINE_MARK_WIDTH, h: SPINE_MARK_HEIGHT, signature: sheet.signature, kind: cycle, step: step, style: cycle % SPINE_MARK_STYLES });
        }
        var rotated = rotateBacks && side === 'back';
        if (rotated) {
          slots = slots.map(function (y) {
            var k = {}; Object.keys(y).forEach(function (a) { k[a] = y[a]; });
            k.slot = rotateBox180(y.slot, PW, PH);
            k.content = rotateBox180(y.content, PW, PH);
            return k;
          });
          lines = lines.map(function (c) { return rotateLine180(c, PW, PH); });
          squares = squares.map(function (k) { return rotateBox180(k, PW, PH); });
        }
        sides.push({ sheet: sheet.no, signature: sheet.signature, indexInSignature: sheet.indexInSignature, side: side, rotate180: rotated, slots: slots, lines: lines, squares: squares });
      });
    });

    return { paper: { width: PW, height: PH }, book: { width: BW, height: BH }, sides: sides, warnings: warnings, doesNotFit: doesNotFit };
  }

  /** The filled rectangles to draw for a spine mark (mm; the drawing side fills them all). The center x does not change. */
  function markParts(kr) {
    var style = kr.style || 0, k = 0.6;
    function r(dx, dy, w, h) { return { x: roundOff(kr.x + dx), y: roundOff(kr.y + dy), w: w, h: h }; }
    if (style === 1) { // outline (hollow)
      return [r(0, 0, kr.w, k), r(0, kr.h - k, kr.w, k), r(0, k, k, kr.h - 2 * k), r(kr.w - k, k, k, kr.h - 2 * k)];
    }
    if (style === 2 || style === 3) { // 2 or 3 small squares, stacked vertically, centered horizontally
      var n = style, a = n === 2 ? 1.5 : 1.2, gap = (kr.h - n * a) / (n + 1), list = [];
      for (var i = 0; i < n; i++) list.push(r((kr.w - a) / 2, gap + i * (a + gap), a, a));
      return list;
    }
    return [r(0, 0, kr.w, kr.h)];
  }

  return {
    markParts: markParts,
    layout: layout,
    fitPage: fitPage,
    drawOrigin: drawOrigin,
    spineSide: spineSide,
    shouldRotateBacks: shouldRotateBacks
  };
});
