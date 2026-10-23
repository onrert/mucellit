/*
 * figures/case.js — Stage 6: cutting the case to the size of the finished block (boards, spine stiffener, covering).
 * LICENSE NOTE (MIT): made with the Colorfigures engine and method. MIT License. Copyright (c) 2026 April Zhu
 * (Colorfigures; iso-glow) and Tolga Cohce (iso-figure). Full text: LICENSE.
 *
 * How it is done in reality: the case is made to the size of the sewn block with its spine glued (MEGEP-2008 p.6-7:
 * "the measurement is taken from the finished inner block"; the spine is measured with the boards on both sides of
 * the block). The measurements come from Mucellit's calculation (calc.js): board Db × Dh = (W − f + k) × (H + 2k);
 * spine stiffener R = S + 2t; covering (2·Db + R + 2f + 2(e + t)) × (Dh + 2(e + t)). The board laid on the block has a
 * square of k at head, tail and fore-edge; on the spine side it stays f (the joint) back.
 * Coordinates: x = spine length, y = width (the block spine at +y), z = up; 1 unit = 1 mm.
 * PARTS: cutting mat · finished block (endpaper, mull, headband) · measuring lines · 2 boards · spine stiffener ·
 *   covering (cloth face outside; layout lines on its lining). DRAWING: all along x: 2D painter's sort (xSort).
 */
'use strict';
(function (root) {
  const MC = root.Mucellit.learn, { PALS, f, pd, on, vis, tone, toneI, ease, ink, fill, face, shape, boardTop, xrCallouts } = MC.cf;
  MC.figures.cover = function (o) {
    const { xSort, xPrism, kRect, kRun, kLerp, kMat, kBlockItems, kGeo, kText, color } = MC.common, O = o.size, t = o.t;
    const BH = 4, T = O.t, S = O.S, W = O.W, H = O.H, k = O.k, FM = O.f, Db = O.Db, Dh = O.Dh, R = O.R, KG = O.covering.width, KY = O.covering.height;
    const matW = Math.max(Dh, KY) + 60, xm = matW/2;
    const G = Object.assign(kGeo(O), { XK0: xm - H/2, XK1: xm + H/2 });
    // layout without overlaps: covering | second board | block (the first board on it) | spine stiffener
    const yc0 = 22, y2 = yc0 + KG + 18, yb0 = y2 + Db + 18 + k, yb1 = yb0 + W, ys0 = yb1 + 16, matD = ys0 + R + 30, HMAX = 60;
    const xb0 = xm - Dh/2, xb1 = xm + Dh/2, xc0 = xm - KY/2, xc1 = xm + KY/2, E = O.e + T;
    const kBOARD = color.kBOARD, kStrip = { l:'#d8c7a2', m:'#bba984', d:'#857755' };   // spine stiffener: light brown (apart from the board)
    const ol = (a, b, w = .9) => ink(pd([a, b], false), w);
    const ok = (p, d, s = 3) => ol(p, [p[0] + d[0]*s, p[1] + d[1]*s, p[2] + d[2]*s], .9);

    function scene(st, m){
      const kk = ease(st.xr || 0), items = [], all = [], ptsC = [], ptsS = [];
      let s = kMat(matW, matD, BH);
      // block
      all.push(...kBlockItems(G, yb0, BH, items, { th: S, m: PALS.tomato, op: 1 - .6*kk }));
      const zt = BH + S;
      // measuring lines (on the block and at its head end)
      if (st.measure > 0){ const u = ease(st.measure), zz = zt + .3, xh = G.XK0 - 8, g = `<g opacity="${f(u)}">`;
        let d = ol([xh, yb0, zz], [xh, kLerp(yb0, yb1, u), zz]) + ok([xh, yb0, zz], [0, 1, 0]) + ok([xh, yb0, zz], [0, -0, 1], 0);
        d += ol([G.XK0, yb0 - 8, zz], [kLerp(G.XK0, G.XK1, u), yb0 - 8, zz]);
        d += ol([G.XK0 - 2, yb1 + 4, BH], [G.XK0 - 2, yb1 + 4, kLerp(BH, zt, u)], 1.2) + ol([G.XK0 - 4, yb1 + 4, BH], [G.XK0, yb1 + 4, BH], 1) + ol([G.XK0 - 4, yb1 + 4, zt], [G.XK0, yb1 + 4, zt], 1);
        items.push({ a: [yb0 - 8, zz], b: [yb1 + 4, zz], bias: .3, svg: g + d + '</g>' }); }
      // boards: one on the block (squares), one beside it on the mat
      if (st.brd > 0){ const u = ease(st.brd), dz = 50*(1 - u);
        const z0 = zt + .2 + dz, yA = yb0 - k, yB = yA + Db;
        const face = (i, n, Q) => { let sv = shape(Q, toneI(n, kBOARD), 1.1);
          if (i === 2 && vis(n)) sv += kText([xm, (yA + yB)/2 + 0, z0 + T + .05], [0, -1, 0], [1, 0, 0], t('learn.s.cover.brd_size', { a: o.number(Db), b: o.number(Dh) }), 15, '#4a443b', 800);
          return sv; };
        all.push(...xPrism(kRect(yA, z0, yB, z0 + T), xb0, xb1, kBOARD, items, { face, bias: .02 }));
        // second board: on the mat between the covering and the block
        ptsS.push(...xPrism(kRect(y2, BH, y2 + Db, BH + T), xb0, xb1, kBOARD, items, { face: (i, n, Q) => { let sv = shape(Q, toneI(n, kBOARD), 1.1);
          if (i === 2 && vis(n)) sv += kText([xm, y2 + Db/2, BH + T + .05], [0, -1, 0], [1, 0, 0], t('learn.s.cover.brd_size', { a: o.number(Db), b: o.number(Dh) }), 15, '#4a443b', 800);
          return sv; }, op: u }));
      }
      // spine stiffener: on the mat beside the spine
      // spine stiffener: a lighter colour so that it differs from the board; a length label on it
      if (st.ser > 0){ const u = ease(st.ser), dz = 40*(1 - u), zS = BH + T + dz;
        ptsS.push(...xPrism(kRect(ys0, BH + dz, ys0 + R, zS), xb0, xb1, kStrip, items, { bias: .01, face: (i, n, Q) => { let sv = shape(Q, toneI(n, kStrip), 1.1);
          if (i === 2 && vis(n)) sv += kText([xm, ys0 + R/2 + 2.2, zS + .05], [1, 0, 0], [0, 1, 0], t('learn.s.cover.brd_size', { a: o.number(R), b: o.number(Dh) }), Math.min(7, R*.55), '#4a3f2c', 800);
          return sv; } })); }
      // covering: on the mat, lining face up; layout lines
      if (st.container > 0){ const u = ease(st.container), dy = -60*(1 - u), z0 = BH + .3, yA = yc0 + dy, yB = yA + KG;
        const face = (i, n, Q) => { if (i !== 2) return shape(Q, tone(n, m), .9);
          let sv = shape(Q, toneI(n, color.kBACK), 1); const zz = z0 + .65;
          const ln = (x0, y0, x1, y1) => pd([[x0, y0, zz], [x1, y0, zz], [x1, y1, zz], [x0, y1, zz]]);
          const r0 = yA + E, r1 = r0 + Db, s0 = r1 + FM, s1 = s0 + R, l0 = s1 + FM, l1 = l0 + Db;
          sv += `<path d="${ln(xb0, r0, xb1, r1) + ln(xb0, s0, xb1, s1) + ln(xb0, l0, xb1, l1)}" fill="none" stroke="#8f8165" stroke-width=".8" stroke-dasharray="5 3"/>`;
          return sv; };
        ptsC.push(...xPrism(kRect(yA, z0, yB, z0 + .6), xc0, xc1, m, items, { face, op: Math.min(1, u*1.5), bias: -.01 })); }
      const clip = boardTop(0, 0, matW, matD, BH, 8);
      s += xSort(items);
      // labels
      const LB = [];
      if (kk > .6){
        LB.push({ at: [G.XK1, yb1 - 1, BH + S/2], text: t('learn.s.cover.block_section'), on: false });
      } else {
        LB.push({ at: [G.XK1 - 20, yb0 + W*.4, zt], text: t('learn.s.cover.block'), on: false });
        if (st.measure > .5){ LB.push({ at: [G.XK0 - 2, yb1 + 4, (BH + zt)/2], text: t('learn.s.cover.s', { s: o.number(S) }), on: st.measureT >= 0 });
          LB.push({ at: [G.XK0 - 8, (yb0 + yb1)/2, zt], text: t('learn.s.cover.w', { w: o.number(W) }), on: st.measureT >= 0 });
          LB.push({ at: [xm, yb0 - 8, zt], text: t('learn.s.cover.h', { h: o.number(H) }), on: st.measureT >= 0 }); }
        if (st.brd > .5){ LB.push({ at: [xb1, yb0 - k, zt + T], text: t('learn.s.cover.square', { k: o.number(k) }), on: st.brdT >= 0 });
          LB.push({ at: [xb1 - 30, yb0 - k + Db, zt + T], text: t('learn.s.cover.jointGap', { f: o.number(FM) }), on: st.brdT >= 0 });
          LB.push({ at: [xb0 + 20, y2 + Db/2, BH + T], text: t('learn.s.cover.brd', { a: o.number(Db), b: o.number(Dh) }), on: st.brdT >= 0 }); }
        if (st.ser > .5) LB.push({ at: [xb1, ys0 + R/2, BH + T], text: t('learn.s.cover.strip', { a: o.number(R), b: o.number(Dh) }), on: st.serT >= 0 });
        if (st.container > .5) LB.push({ at: [xc1, yc0 + KG*.3, BH + 1], text: t('learn.s.cover.covering', { a: o.number(KG), b: o.number(KY) }), on: st.containerT >= 0 });
      }
      s += xrCallouts(LB, [0, matW, 0, matD, 0, HMAX]);
      return s;
    }
    const busy = (st, ui) => { if (st.anim2){ ui.flash(t('learn.f.busy')); return true; } return false; };
    const finish = st => { st.anim2 = false; };
    const mk = (stateKey, order, previous, warn) => ({
      action(st, ui){ if (busy(st, ui)) return false;
        if (previous && !(st[previous] >= 1)){ ui.flash(t({ measure: 'learn.s.cover.f_measure_first', brd: 'learn.s.cover.f_first_brd', ser: 'learn.s.cover.f_first_stiffener' }[previous])); return false; }
        if (st[stateKey] >= 1){ ui.flash(t('learn.s.cover.f_done')); return false; }
        st.anim2 = true; ui.flash(warn(), 2600); kRun(st, ui, stateKey + 'T', 1.4, u => { st[stateKey] = u; }, () => { st[stateKey] = 1; finish(st); }); return true; },
      last(st){ st[stateKey] = 1; } });
    const step = {
      measure: mk('measure', 0, null, () => t('learn.s.cover.f_measure', { s: o.number(S) })),
      board: mk('brd', 1, 'measure', () => t('learn.s.cover.f_brd', { k: o.number(k), f: o.number(FM) })),
      strip: mk('ser', 2, 'brd', () => t('learn.s.cover.f_stiffener', { s: o.number(S), t: o.number(T), r: o.number(R) })),
      covering: mk('container', 3, 'ser', () => t('learn.s.cover.f_covering', { e: o.number(O.e) }))
    };
    const st0 = { measure: 0, measureT: -1, brd: 0, brdT: -1, ser: 0, serT: -1, container: 0, containerT: -1, anim: 0, anim2: false };
    return { step, cfg: {
      title: t('learn.cover.name'), credit: false, size: [matW, matD, HMAX], state: st0, scene,
      stats: st => [{ label: t('learn.s.cover.st_spine'), value: t('learn.mm', { v: o.number(S) }) }, { label: t('learn.s.cover.st_brd'), value: t('learn.size_two', { a: o.number(Db), b: o.number(Dh) }), small: true }]
    } };
  };
})(typeof self !== 'undefined' ? self : this);
