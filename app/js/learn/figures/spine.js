/*
 * figures/spine.js — Stage 5: spine glue → headbands → mull.
 * LICENSE NOTE (MIT): made with the Colorfigures engine and method (first version: the Learn prototype, figure 4).
 * MIT License. Copyright (c) 2026 April Zhu (Colorfigures; iso-glow) and Tolga Cohce (iso-figure). Full text: LICENSE.
 *
 * How it is done in reality: the sewn block with its endpapers on is clamped spine up between two press jaws so that
 * a few millimetres stay outside; thin PVA is brushed on the spine and left to dry; headbands are glued at head and
 * tail, then the mull (an open-weave cloth), with ~25 mm wings hanging down on both sides (Talas-guide: headbands
 * before the mull).
 * Real scale: block H × W × S (the thickness is not enlarged).
 * Coordinates: x = spine length, y = thickness direction (press centre s4Y0), z = up; 1 unit = 1 mm.
 * PARTS: cutting mat · block (spine: N signature layers, outside stitches, kettle chain; fore-edge; two endpapers;
 *   sections) · press: two jaws, two screws (with knobs) · glue + brush · 2 headbands · mull (top + two wings).
 * DRAWING: everything along x with the 2D painter's sort in the (y, z) section (xSort).
 */
'use strict';
(function (root) {
  const MC = root.Mucellit.learn, { INK, f, pd, sp, on, vis, toneI, matOf, ease, fill, face, shape, box, rod, boardTop, xrCallouts } = MC.cf;
  MC.figures.spine = function (o) {
    const { xSort, xPrism, kRect, kRun, kLerp, kSeg, kMat, kThr, kSpineSewing, kOp, color } = MC.common, O = o.size, t = o.t;
    const kPAPER = color.kPAPER, kEDGE = color.kEDGE, kENDP = color.kENDP, kMULL = color.kMULL, kTHREAD = color.kTHREAD, s4WOOD = color.kWOOD, s4STEEL = color.kSTEEL;
    const N = O.N, s4T = O.S, s4H = O.W, s4BH = 4, s4JW = 34, s4Y0 = 110;
    const s4XA = 60, s4XB = s4XA + O.H, s4JZ = s4BH + s4H - 6,   // the spine 6 mm above the jaws ("a few millimetres")
    ST = O.station.position.map(v => s4XA + v);
    const lieCY = s4Y0 + 100 + s4H/2, s4W = s4XB + 60, s4D = lieCY + s4H/2 + 25, HMAX = Math.max(200, s4H + 60);

    function s4Pose(mv){
      const lie = { cy: lieCY, cz: s4BH + s4T/2, a: Math.PI/2 }, up = { cy: s4Y0, cz: s4BH + s4H/2, a: 0 }, hi = s4BH + s4H + 88;
      if (mv <= .25){ const u = kSeg(mv, 0, .25); return { cy: lie.cy, cz: kLerp(lie.cz, hi, u), a: lie.a }; }
      if (mv <= .65){ const u = kSeg(mv, .25, .65); return { cy: kLerp(lie.cy, up.cy, u), cz: hi, a: kLerp(lie.a, 0, u) }; }
      const u = kSeg(mv, .65, 1); return { cy: up.cy, cz: kLerp(hi, up.cz, u), a: 0 };
    }
    const s4Loc = (ps, [u, w]) => { const c = Math.cos(ps.a), s = Math.sin(ps.a), ww = w - s4H/2; return [ps.cy + u*c - ww*s, ps.cz + u*s + ww*c]; };

    function scene(st, m){
      const k = ease(st.xr || 0), items = [], all = [];
      let s = kMat(s4W, s4D, s4BH);
      const ps = s4Pose(st.mv), top = s4BH + s4H, standing = st.mv >= 1;
      const poly = [[-s4T/2, 0], [s4T/2, 0], [s4T/2, s4H], [-s4T/2, s4H]].map(p => s4Loc(ps, p));
      const lerpQ = (Q, tt, x) => [x, kLerp(Q[0][1], Q[3][1], tt), kLerp(Q[0][2], Q[3][2], tt)];
      const face = (i, n, Q) => {
        const c = i === 2 ? toneI(n, kPAPER) : i === 0 ? toneI(n, kEDGE) : toneI(n, kENDP);
        let sv = shape(Q, c, 1);
        const off = p => [p[0], p[1] + n[1]*.06, p[2] + n[2]*.06], at = (x, tt) => off(lerpQ(Q, tt, x));
        if (i === 0){ let d = ''; for (let j = 1; j < N; j++) d += pd([at(s4XA, j/N), at(s4XB, j/N)], false);
          sv += `<path d="${d}" fill="none" stroke="#b9ad92" stroke-width=".35"/>`; }
        if (i === 2){
          let d = ''; for (let j = 1; j < N; j++) d += pd([at(s4XA, j/N), at(s4XB, j/N)], false);
          sv += `<path d="${d}" fill="none" stroke="#9c8f72" stroke-width=".45"/>` + kSpineSewing(at, N, ST, .9);
          if (k > 0){ let dd = ''; for (let j = 0; j < N; j++){ const tm = (j + .5)/N; for (let q = 0; q + 1 < ST.length; q += 2) dd += pd([at(ST[q] + 2, tm), at(ST[q + 1] - 2, tm)], false); }
            sv += `<g opacity="${f(.8*k)}"><path d="${dd}" fill="none" stroke="${kTHREAD}" stroke-width=".7" stroke-dasharray="2.5 2"/></g>`; }
          if (st.glue > 0){ const xg = kLerp(s4XA, s4XB, st.glue);
            sv += `<path d="${pd([at(s4XA, 0), at(xg, 0), at(xg, 1), at(s4XA, 1)])}" fill="#fff6c8" opacity=".6"/>`; }
        }
        return sv; };
      const cap = (xc, cs) => {
        let d = ''; const at = (u, w) => { const p = s4Loc(ps, [u, w]); return [xc + cs*.06, p[0], p[1]]; };
        for (let j = 1; j < N; j++){ const u = -s4T/2 + s4T*j/N; d += pd([at(u, 2), at(u, s4H - .5)], false); }
        let arcs = ''; for (let j = 0; j < N; j++){ const u0 = -s4T/2 + s4T*j/N + .04, u1 = u0 + s4T/N - .08, um = (u0 + u1)/2;
          arcs += pd([at(u0, s4H - 1.2), at(u0 + .03, s4H - .45), at(um, s4H - .1), at(u1 - .03, s4H - .45), at(u1, s4H - 1.2)], false); }
        return `<path d="${d}" fill="none" stroke="#b9ad92" stroke-width=".3"/><path d="${arcs}" fill="none" stroke="#6b604a" stroke-width=".4"/>`; };
      all.push(...xPrism(poly, s4XA, s4XB, kPAPER, items, { face, cap }));
      // press jaws and screws
      const g = st.gap, fadeOp = 1 - .72*k;
      for (const [y0, y1] of [[s4Y0 - g/2 - s4JW, s4Y0 - g/2], [s4Y0 + g/2, s4Y0 + g/2 + s4JW]])
        all.push(...xPrism(kRect(y0, s4BH, y1, s4JZ), s4XA - 45, s4XB + 45, s4WOOD, items, { w: 1.3, op: fadeOp }));
      for (const x of [s4XA - 28, s4XB + 28]){
        const zs = s4JZ*.5, yo = s4Y0 + g/2 + s4JW, yi = s4Y0 - g/2 - s4JW;
        const knob = rod([x, s4Y0 + 86, zs], [x, s4Y0 + 98, zs], 8, s4WOOD, toneI, 1.2, 8, 16);
        const rodP = rod([x, yo, zs], [x, s4Y0 + 86, zs], 4.2, s4STEEL, toneI, 1, 4.2, 12);
        items.push({ a: [yo, zs], b: [s4Y0 + 98, zs], svg: kOp(fadeOp, MC.cf.CAM_V[1] > 0 ? rodP + knob : knob + rodP) });
        items.push({ a: [s4Y0 - 74, zs], b: [yi, zs], svg: kOp(fadeOp, rod([x, s4Y0 - 74, zs], [x, yi, zs], 4.2, s4STEEL, toneI, 1, 4.2, 12)) });
      }
      // headband (first)
      if (st.container > 0){ const dz = 30*(1 - ease(st.container)), zk = top + 1.7 + dz;
        for (const x of [s4XA + 1.7, s4XB - 1.7]){
          const sv = rod([x, s4Y0 - s4T/2, zk], [x, s4Y0 + s4T/2, zk], 1.7, m, toneI, .9, 1.7, 12);
          let st2 = ''; for (let j = 1; j < 8; j++){ const y = s4Y0 - s4T/2 + s4T*j/8; st2 += pd([[x + 1.6, y, zk + .3], [x + .4, y, zk + 1.6]], false); }
          items.push({ a: [s4Y0, zk], r: 1.7, bias: .04, svg: sv + `<path d="${st2}" fill="none" stroke="${INK}" stroke-width=".4"/>` }); } }
      // mull (then): top + two wings
      if (st.mull > 0){ const dz = 40*(1 - ease(st.mull)), x0 = s4XA + 6, x1 = s4XB - 6, zt = top + .5 + dz, yl = s4Y0 - s4T/2 - .45, yr = s4Y0 + s4T/2 + .45;
        const mq = (a, b, n) => { const Q = [[x0, a[0], a[1]], [x1, a[0], a[1]], [x1, b[0], b[1]], [x0, b[0], b[1]]];
          let d = ''; for (let j = 1; j < 4; j++){ const tt = j/4; d += pd([[x0, kLerp(a[0], b[0], tt), kLerp(a[1], b[1], tt)], [x1, kLerp(a[0], b[0], tt), kLerp(a[1], b[1], tt)]], false); }
          for (let x = x0 + 8; x < x1; x += 9) d += pd([[x, a[0], a[1]], [x, b[0], b[1]]], false);
          return shape(Q, toneI(n, kMULL), .9) + `<path d="${d}" fill="none" stroke="#c9bb93" stroke-width=".35" opacity=".8"/>`; };
        // the wings do not pass through the jaw; they come down from the spine onto the jaw and lie on its top face (~25 mm in all)
        const zj = s4JZ + .5 + dz, side = Math.max(0, 25 - (zt - zj));
        const pts = [[yl - side, zj], [yl, zj], [yl, zt], [yr, zt], [yr, zj], [yr + side, zj]];
        for (let i = 0; i + 1 < pts.length; i++){ const a = pts[i], b = pts[i + 1], tv = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(...tv);
          let n = [0, -tv[1]/tl, tv[0]/tl]; if (!vis(n)) n = n.map(v => -v);
          items.push({ a, b, bias: .05, svg: mq(a, b, n) }); } }
      // brush
      if (st.glueT >= 0){ const xg = kLerp(s4XA, s4XB, st.glue), zb = top + .6;
        const sv = box(xg - 8, s4Y0 - 7, zb, xg + 8, s4Y0 + 7, zb + 6, matOf('#e9d9a6'), toneI, 1) + rod([xg, s4Y0, zb + 6], [xg - 30, s4Y0, zb + 40], 2.6, s4WOOD, toneI, 1, 2.6, 12);
        items.push({ a: [s4Y0, zb + 3], b: [s4Y0, zb + 30], r: 7, bias: .1, svg: sv }); }
      s += xSort(items);
      // labels
      const LB = [], sp = s4Loc(ps, [0, s4H]);
      if (k > .6){
        LB.push({ at: [ST[0], sp[0], sp[1]], text: t('learn.s.spine.kettle'), on: false });
        LB.push({ at: [(ST[1] + ST[2])/2, sp[0], sp[1]], text: t('learn.s.spine.outer'), on: false });
        LB.push({ at: [(ST[2] + ST[3])/2, sp[0], sp[1]], text: t('learn.s.spine.inner'), on: false });
        LB.push({ at: [s4XB, ...s4Loc(ps, [0, s4H - 2])], text: t('learn.s.spine.folds', { n: N }), on: false });
      } else {
        LB.push({ at: [s4XB, ...s4Loc(ps, [s4T/2, s4H*.7])], text: t('learn.s.spine.block', { n: N, y: O.sheet }), on: false });
        LB.push({ at: [s4XB - 30, sp[0], sp[1]], text: t('learn.s.spine.spine', { s: o.number(s4T) }), on: false });
        LB.push({ at: [s4XA + 40, ...s4Loc(ps, [-s4T/2, s4H*.5])], text: t('learn.s.spine.endpapers'), on: false });
        if (standing) LB.push({ at: [s4XB + 30, s4Y0 + st.gap/2 + s4JW, s4JZ*.75], text: t('learn.s.spine.jaw'), on: st.gapT >= 0 });
        LB.push({ at: [s4XB + 28, s4Y0 + 92, s4JZ*.5], text: t('learn.s.spine.screw'), on: st.gapT >= 0 });
        if (st.glue > 0 && st.mull < .5) LB.push({ at: [s4XA + 40, sp[0], sp[1]], text: t('learn.s.spine.glue'), on: st.glueT >= 0 });
        if (st.container > .5) LB.push({ at: [s4XB - 1.7, s4Y0, top + 2], text: t('learn.s.spine.headbands', { s: o.number(s4T) }), on: st.containerT >= 0 });
        if (st.mull > .5) LB.push({ at: [s4XA + 120, s4Y0 + s4T/2 + 8, s4JZ + .6], text: t('learn.s.spine.mull', { a: o.number(O.mull.width), b: o.number(O.mull.height) }), on: st.mullT >= 0 });
      }
      s += xrCallouts(LB, [0, s4W, 0, s4D, 0, HMAX]);
      return s;
    }
    const busy = (st, ui) => { if (st.anim2){ ui.flash(t('learn.f.busy')); return true; } return false; };
    const finish = st => { st.anim2 = false; };
    const step = {
      press: { action(st, ui){ if (busy(st, ui)) return false; if (st.mv >= 1){ ui.flash(t('learn.s.spine.f_in_press')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.spine.f_press'), 2400);
          kRun(st, ui, 'mvT', 2.2, u => { st.mv = u; }, () => kRun(st, ui, 'gapT', 1, u => { st.gap = kLerp(34, s4T + .3, u); }, () => finish(st))); return true; },
        last(st){ st.mv = 1; st.gap = s4T + .3; } },
      glue: { action(st, ui){ if (busy(st, ui)) return false; if (st.gap > s4T + 1){ ui.flash(t('learn.s.spine.f_first_press')); return false; }
          if (st.glue >= 1){ ui.flash(t('learn.s.spine.f_has_glue')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.spine.f_glue'), 2400); kRun(st, ui, 'glueT', 2, u => { st.glue = u; }, () => finish(st)); return true; },
        last(st){ st.glue = 1; } },
      headbands: { action(st, ui){ if (busy(st, ui)) return false; if (st.glue < 1){ ui.flash(t('learn.s.spine.f_first_glue')); return false; }
          if (st.container >= 1){ ui.flash(t('learn.s.spine.f_has_headband')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.spine.f_headband'), 2400); kRun(st, ui, 'containerT', 1, u => { st.container = u; }, () => finish(st)); return true; },
        last(st){ st.container = 1; } },
      mull: { action(st, ui){ if (busy(st, ui)) return false; if (st.container < 1){ ui.flash(t('learn.s.spine.f_first_headband')); return false; }
          if (st.mull >= 1){ ui.flash(t('learn.s.spine.f_mull_done')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.spine.f_mull'), 2400); kRun(st, ui, 'mullT', 1.1, u => { st.mull = u; }, () => finish(st)); return true; },
        last(st){ st.mull = 1; } }
    };
    const st0 = { mv: 0, mvT: -1, gap: 34, gapT: -1, glue: 0, glueT: -1, mull: 0, mullT: -1, container: 0, containerT: -1, anim: 0, anim2: false };
    return { step, cfg: {
      title: t('learn.spine.name'), credit: false, size: [s4W, s4D, HMAX], state: st0, scene,
      stats: st => [{ label: t('learn.s.spine.st_spine'), value: t('learn.mm', { v: o.number(s4T) }) }, { label: t('learn.s.spine.st_signature'), value: String(N), small: true }]
    } };
  };
})(typeof self !== 'undefined' ? self : this);
