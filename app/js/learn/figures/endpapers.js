/*
 * figures/endpapers.js — Stage 4: folding the endpapers and tipping them onto the block with a thin strip of glue
 * (BEFORE the spine glue).
 * LICENSE NOTE (MIT): made with the Colorfigures engine and method. MIT License. Copyright (c) 2026 April Zhu
 * (Colorfigures; iso-glow) and Tolga Cohce (iso-figure). Full text: LICENSE.
 *
 * How it is done in reality: the endpaper is cut twice as wide as the block (2W × H) and folded in the middle (MEB-2021
 * p.48). A thin 3–5 mm strip of glue is brushed along the spine edge on the outer face of the first and the last
 * signature; the folded endpaper is laid with its fold flush with the spine and pressed down ("tipping on"). It is done
 * BEFORE the spine glue (order of MEB-2021 p.48-49; Cockerell line 1562: gluing it on later is a mistake). Why this
 * choice (instead of sewing the endpaper with the block): no extra sewing, the same for every signature count, simple
 * for a first book.
 * Bottom endpaper (confirmed: MEB-2021 p.54 step 11, Bean line 1991): the block is turned over and the work of the first
 * side is repeated on the last signature: a thin strip on the spine edge, the second endpaper fold flush with the
 * spine. The turn is around the x axis (the spine moves to the other side); the first endpaper comes under the block.
 * Coordinates: x = spine length, y = width (+y the viewer's left; the block spine at +y), z = up; 1 unit = 1 mm.
 * The block is at real scale (thickness = spine S); the endpaper thickness is enlarged to 0.6 mm.
 * PARTS: cutting mat · sewn block (N signature layers, sewing marks and kettle chain on the spine) · 2 endpapers
 *   (open → folded) · glue strips · brush. DRAWING: all along x: 2D painter's sort in the (y, z) section (xSort).
 */
'use strict';
(function (root) {
  const MC = root.Mucellit.learn, { pd, on, toneI, ease, ink, fill, face, shape, boardTop, xrCallouts } = MC.cf;
  MC.figures.endpapers = function (o) {
    const { xSort, xPrism, kRect, kRot, kRun, kLerp, kSeg, kMat, kBlockItems, kGeo, kSpineSewing, kBrush, color } = MC.common, O = o.size, t = o.t;
    const G = Object.assign(kGeo(O), { XK0: 40, XK1: 40 + O.H });
    const W = O.W, S = O.S, BH = 4, TF = .6;                      // TF: the drawn thickness of one endpaper leaf
    const ya = 20, yc = ya + W, y0 = ya + 2*W + 40, y1 = y0 + W;
    const matW = G.XK1 + 40, matD = y1 + 45, HMAX = Math.max(90, W*.75);
    const ST = O.station.position.map(v => G.XK0 + v), STRIP = 4;
    const kENDP = color.kENDP;

    // folded endpaper: [yA, yA + W] × [z, z + 2TF], the fold at the +y edge
    function endpaperItems(items, yA, z, o2 = {}){
      const face = (i, n, Q) => { const at = (x, tt) => [x, kLerp(Q[0][1], Q[3][1], tt) + n[1]*.05, kLerp(Q[0][2], Q[3][2], tt) + n[2]*.05];
        let s = shape(Q, toneI(n, kENDP), .9);
        if (i === 3) s += ink(pd([at(G.XK0, .5), at(G.XK1, .5)], false), .5);
        if (i === 2 && o2.strip > 0){ const w = Math.hypot(Q[3][1] - Q[0][1], Q[3][2] - Q[0][2]), e = STRIP/w;
          s += `<path d="${pd([at(G.XK0, 0), at(kLerp(G.XK0, G.XK1, o2.strip), 0), at(kLerp(G.XK0, G.XK1, o2.strip), e), at(G.XK0, e)])}" fill="#fff3b8" opacity=".85"/>`; }
        return s; };
      return xPrism(kRect(yA, z, yA + W, z + 2*TF, o2.tr || undefined), G.XK0, G.XK1, kENDP, items, { face, w: .9, bias: o2.bias || .002 });
    }
    // open endpaper pair (while folding): a fixed half + a half turning on the hinge (θ)
    function openItems(items, th){
      const pts = [];
      for (let j = 0; j < 2; j++){ const z = BH + j*TF;
        pts.push(...xPrism(kRect(ya, z, yc, z + TF), G.XK0, G.XK1, kENDP, items, { w: .9 }));
        const h = [yc, BH + 2*TF], r = TF*(1.5 - j);           // the top leaf inside
        const R = p => kRot(p, h, th);
        pts.push(...xPrism(kRect(yc, h[1] - r - TF + TF*j*0, yc + W, h[1] - r + TF*0).map(p => [p[0], p[1]]).map(R), G.XK0, G.XK1, kENDP, items, { w: .9, bias: .001*(j + 1) })); }
      return pts;
    }

    function scene(st, m){
      const k = ease(st.xr || 0), items = [];
      let s = kMat(matW, matD, BH);
      const all = [], ptsP = [];
      // block + top endpaper lift together and turn around the x axis (for the bottom endpaper)
      const ce = ease(st.swap || 0), zb = BH + 40*st.rise, zc = zb + (S + 2*TF)/2, yc = y0 + W/2;
      const tr = ce > 0 ? p => kRot(p, [yc, zc], Math.PI*ce) : p => p;
      const strip = (at, t0, t1, u) => `<path d="${pd([at(G.XK0, t0), at(kLerp(G.XK0, G.XK1, u), t0), at(kLerp(G.XK0, G.XK1, u), t1), at(G.XK0, t1)])}" fill="#fff3b8" opacity=".85"/>`;
      const text = (i, at) => { let sv = '';
        if (i === 1) sv += kSpineSewing(at, O.N, ST, .8);
        if (i === 2 && st.strip > 0) sv += strip(at, 0, STRIP/W, st.strip);
        if (i === 0 && st.strip2 > 0) sv += strip(at, 1, 1 - STRIP/W, st.strip2);   // spine edge of the last signature on the turned block
        return sv; };      all.push(...kBlockItems(G, y0, zb, items, { th: S, mull: false, headbands: false, endpapers: false, k, text, op: 1 - .5*k, tr }));
      // forzalar
      if (st.fold < 1) ptsP.push(...openItems(items, st.fold*Math.PI));
      else {
        // F1 (second endpaper): in the stack → turned in the air onto the turned block, the fold flush with the spine (now at y0)
        const u1 = kSeg(st.bottomT, .68, 1), top = BH + 2*TF + S;
        const yF1 = kLerp(ya, y0, u1), zF1 = kLerp(BH, top, u1) + Math.sin(Math.PI*u1)*35, c1 = [yF1 + W/2, zF1 + TF];
        (u1 > .5 ? all : ptsP).push(...endpaperItems(items, yF1, zF1, { bias: .003, tr: u1 > 0 ? p => kRot(p, c1, Math.PI*u1) : null }));
        // F0 (top endpaper): in the stack (above F1) → onto the block; when the block turns it goes under with it
        const u0 = st.top;
        const zTop = zb + S, yF0 = kLerp(ya, y0, u0), zF0 = kLerp(BH + 2*TF, zTop, u0) + Math.sin(Math.PI*u0)*35;
        (u0 > .5 ? all : ptsP).push(...endpaperItems(items, yF0, zF0, { bias: .004, tr: u0 >= 1 ? tr : null }));
      }
      // brush
      if (st.brush){ const p = st.brush; items.push({ a: [p[1], p[2] + 3], r: 7, bias: .2, svg: kBrush(p[0], p[1], p[2], 'x') }); }
      const yS = ce >= .5 ? y0 : y1, zU = ce >= .5 ? BH + 2*TF + S : zb + S;   // spine side and block top (before/after turning)
      s += xSort(items);
      // labels
      const LB = [];
      if (k > .6){
        LB.push({ at: [G.XK1, ...tr([y1 - .5, zb + S/2])], text: t('learn.s.endpapers.block_section', { n: O.N }), on: false });
        LB.push({ at: [(ST[1] + ST[2])/2, ...tr([y1, zb + S/2])], text: t('learn.s.endpapers.sewing'), on: false });
      } else {
        LB.push({ at: [G.XK0 + 30, ...tr([y1, zb + S/2])], text: t('learn.s.endpapers.spine'), on: false });
        if (st.fold < 1) LB.push({ at: [G.XK1 - 20, ya + W*.5, BH + 1.2], text: t('learn.s.endpapers.isOpen', { a: o.number(2*W), b: o.number(O.H) }), on: st.foldT >= 0 });
        else if (st.top < 1) LB.push({ at: [G.XK1 - 20, ya + W*.4, BH + 4*TF], text: t('learn.s.endpapers.folded'), on: st.foldT >= 0 });
        if (st.strip > 0 && st.top < .5) LB.push({ at: [G.XK0 + 60, y1 - 2, zb + S], text: t('learn.s.endpapers.strip'), on: st.stripT >= 0 });
        if (st.strip2 > 0 && st.strip2 < 1) LB.push({ at: [G.XK0 + 60, y0 + 2, zU], text: t('learn.s.endpapers.strip'), on: true });
        if (st.top >= 1 && ce < .5) LB.push({ at: [G.XK1 - 30, y0 + W*.5, zb + S + 2*TF], text: t('learn.s.endpapers.top'), on: st.topT >= 0 });
        if (st.bottom >= 1 || kSeg(st.bottomT, .68, 1) > .5) LB.push({ at: [G.XK1 - 30, y0 + W*.5, zU + 2*TF], text: t('learn.s.endpapers.bottom'), on: st.bottomT >= 0 && st.bottom < 1 });
        if (st.top >= 1) LB.push({ at: [G.XK0 + 6, yS, zU + TF], text: t('learn.s.endpapers.fold_aligned'), on: false });
      }
      s += xrCallouts(LB, [0, matW, 0, matD, 0, HMAX]);
      return s;
    }
    const busy = (st, ui) => { if (st.anim2){ ui.flash(t('learn.f.busy')); return true; } return false; };
    const finish = st => { st.anim2 = false; st.brush = null; };
    const brushX = u => kLerp(G.XK0 + 8, G.XK1 - 8, u);
    const step = {
      fold: { action(st, ui){ if (busy(st, ui)) return false; if (st.fold >= 1){ ui.flash(t('learn.s.endpapers.f_folded')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.endpapers.f_fold'), 2400);
          kRun(st, ui, 'foldT', 1.8, u => { st.fold = ease(u); }, () => { st.fold = 1; finish(st); }); return true; },
        last(st){ st.fold = 1; } },
      glue: { action(st, ui){ if (busy(st, ui)) return false; if (st.fold < 1){ ui.flash(t('learn.s.endpapers.f_fold_first')); return false; }
          if (st.strip >= 1){ ui.flash(t('learn.s.endpapers.f_has_strip')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.endpapers.f_strip'), 2600);
          kRun(st, ui, 'stripT', 1.8, u => { st.strip = u; st.brush = [brushX(u), y1 - 2, BH + S + .4]; }, () => { st.strip = 1; finish(st); }); return true; },
        last(st){ st.strip = 1; } },
      top: { action(st, ui){ if (busy(st, ui)) return false; if (st.strip < 1){ ui.flash(t('learn.s.endpapers.f_first_strip')); return false; }
          if (st.top >= 1){ ui.flash(t('learn.s.endpapers.f_has_top')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.endpapers.f_top'), 2400);
          kRun(st, ui, 'topT', 1.6, u => { st.top = ease(u); }, () => { st.top = 1; finish(st); }); return true; },
        last(st){ st.top = 1; } },
      bottom: { action(st, ui){ if (busy(st, ui)) return false; if (st.top < 1){ ui.flash(t('learn.s.endpapers.f_first_top')); return false; }
          if (st.bottom >= 1){ ui.flash(t('learn.s.endpapers.f_bottom_done')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.endpapers.f_bottom'), 3000);
          // lift (0–.12) → turn (.12–.42) → down (.42–.52) → strip on the spine edge of the last signature (.52–.68) → second endpaper (.68–1)
          kRun(st, ui, 'altK', 4.4, u => { st.bottomT = u; st.rise = u < .12 ? kSeg(u, 0, .12) : u < .42 ? 1 : 1 - kSeg(u, .42, .52);
            st.swap = kSeg(u, .12, .42); st.strip2 = kSeg(u, .52, .68);
            st.brush = u > .52 && u < .68 ? [brushX(st.strip2), y0 + 2, BH + 2*TF + S + .4] : null; st.bottom = u >= .999 ? 1 : 0; },
            () => { st.bottom = 1; st.rise = 0; st.bottomT = 1; st.strip2 = 1; st.swap = 1; finish(st); }); return true; },
        last(st){ st.bottom = 1; st.bottomT = 1; st.strip2 = 1; st.rise = 0; st.swap = 1; } }
    };
    const st0 = { fold: 0, foldT: -1, strip: 0, stripT: -1, top: 0, topT: -1, bottom: 0, bottomT: -1, rise: 0, strip2: 0, swap: 0, brush: null, anim: 0, anim2: false };
    return { step, cfg: {
      title: t('learn.endpapers.name'), credit: false, size: [matW, matD, HMAX], state: st0, scene,
      stats: st => [{ label: t('learn.s.endpapers.st_endpaper'), value: t('learn.s.endpapers.st_v', { a: (st.top >= 1 ? 1 : 0) + (st.bottom >= 1 ? 1 : 0), n: 2 }) }, { label: t('learn.s.endpapers.st_strip'), value: t('learn.mm_range', { a: 3, b: 5 }), small: true }]
    } };
  };
})(typeof self !== 'undefined' ? self : this);
