/*
 * figures/casing-in.js — Stage 8 (casing the block in) and 9 (drying in the press).
 * LICENSE NOTE (MIT): made with the Colorfigures engine and method (first version: the Learn prototype, figure 5).
 * MIT License. Copyright (c) 2026 April Zhu (Colorfigures; iso-glow) and Tolga Cohce (iso-figure). Full text: LICENSE.
 *
 * How it is done in reality (MEB-2021 p.77; Talas-case; Hollander; Bean lines 2045-2058): BEFORE the glue the block is
 * fitted dry into the case, the squares are evened, the board is marked with a pencil at the fore-edge, and the block
 * is turned back beside the case.
 * While the block lies beside the case, waste paper goes under the outer endpaper leaf, thin glue is brushed over the
 * endpaper and the mull wing, the waste paper is taken out (MEB p.77 step 5); the block is turned over and set so that
 * the pasted face comes onto the board: the spine against the stiffener, the square even at head, tail and fore-edge
 * (not dropped from the air: turned over on the fore-edge). The top endpaper is glued, the case is closed. The joint
 * groove is pressed with the bone folder. Then (stage 9) wax paper goes between the endpaper and the block, rods into
 * the joint grooves, and the book dries in the press (MEB p.77 step 10: 24 hours).
 * Press: the book lies on the press bed; the platen comes down onto the book (in front of the book in the sort).
 * Model: the case closes on two flat hinges (joint gap f + t in the model; see the kGeo note in common.js). The cloth
 * does not sink into the groove.
 * Coordinates: x = spine length, y = width, z = up; 1 unit = 1 mm.
 * PARTS: cutting mat · case: two boards (turn-ins on the inner face), stiffener, joint cloth · block: endpapers,
 *   mull wings, fore-edge, sections, headbands · brush · bone folder · wax papers · two rods · press (posts,
 *   beam, screw, platen). DRAWING: case, block, rods, wax paper (along x) xSort; press parts byDepth.
 */
'use strict';
(function (root) {
  const MC = root.Mucellit.learn, { PALS, INK, byDepth, f, pd, on, toneI, ease, box, rod, boardTop, xrCallouts } = MC.cf;
  MC.figures.casingIn = function (o) {
    const { xSort, xPrism, kRect, kRot, kRun, kOrder, kLerp, kSeg, kMat, kBlockItems, kCaseItems, kGeo, kChain, kBone, kBrush, color } = MC.common, O = o.size, t = o.t;
    const IN_PRESS = o.stage === 'press', BED = IN_PRESS ? 10 : 0;   // press bed thickness (the book lies on the bed)
    const G = kGeo(O, { RB0: IN_PRESS ? 40 : O.W + 40, zc: IN_PRESS ? 4 + BED + .4 : undefined }), S = O.S, T = G.T, BH = G.BH, s5WOOD = color.kWOOD, s5STEEL = color.kSTEEL;
    const kATIK = { l:'#eef1f2', m:'#d3d9dc', d:'#9ea7ac' };        // waste paper (grey newsprint)
    const zb = G.zc + T, hY = G.K0 - 6, hZ = (BH + zb + S)/2;          // axis for turning the block over
    const W2 = G.matW, D2 = IN_PRESS ? G.S0 + 60 : G.matD, xm = (G.XB0 + G.XB1)/2;
    const bookTop = G.zc + G.R, yJ = G.S0 - G.g/2;                  // top of the closed book, top joint groove (y)
    const HMAX = Math.max(175, bookTop + 140);
    const yP0 = G.RB0 - 15, yP1 = G.S0 + 17, yPc = (yP0 + yP1)/2;     // press platen
    const zt0 = G.zc + T;                                             // top face of the board on the open case (mark, waste paper)
    // dry fit: the block turns onto the case (0–.4), settles and is marked (.4–.62), turns back beside it (.62–1)
    const deneY = u => u <= 0 || u >= 1 ? 0 : u < .4 ? kSeg(u, 0, .4) : u < .62 ? 1 : 1 - kSeg(u, .62, 1);

    function scene(st, m){
      const k = ease(st.xr || 0), items = [];
      let s = kMat(W2, D2, BH);
      const ch = kChain(G, Math.PI/2*kSeg(st.c, 0, .45), Math.PI/2*kSeg(st.c, .5, 1)), cop = 1 - .72*k;
      const all = kCaseItems(G, ch, m, items, { op: cop, paste: st.c >= 1, groove: st.groove, title: st.c >= 1 ? t('learn.s.book.cover1') : null, title2: st.c >= 1 ? t('learn.s.book.cover2') : null });
      // block: not turned (beside, upside down) → in the case; it goes and comes back during the dry fit
      const yerE = Math.max(st.place, deneY(st.attempt)), psi = Math.PI*(1 - ease(yerE)), tr = p => kRot(p, [hY, hZ], psi);
      all.push(...kBlockItems(G, G.K0, zb, items, { tr, glue: st.glueU, glueAlt: st.glueA, k, m: PALS.tomato, op: 1 }));
      // pencil mark: in line with the fore-edge, an L at the head and tail corners on the inner face of the board (made during the dry fit)
      if (st.mark > 0){ const y = G.K0, z = zt0 + .06, L = 24*ease(Math.min(1, st.mark)), d = pd([[G.XK0 + L, y, z], [G.XK0, y, z], [G.XK0, y + 12, z]], false) + pd([[G.XK1 - L, y, z], [G.XK1, y, z], [G.XK1, y + 12, z]], false);
        items.push({ a: [y - .5, z], b: [y + 8, z], bias: .015, svg: `<path d="${d}" fill="none" stroke="#34333a" stroke-width="2" stroke-linecap="round"/>` }); }
      // waste paper: under the pasted endpaper leaf, 12 mm over the fore-edge; after the glue it is pulled out towards the fore-edge
      for (const [v, zz, trr] of [[st.wasteA, zb + .25, tr], [st.wasteU, zb + S - .45, p => p]]){ if (!(v > 0)) continue;
        const dx = -(O.H + 30)*(1 - v);   // the visible part: the strip outside the fore-edge; pulled towards the head when taken out
        xPrism(kRect(G.K0 - 12, zz, G.K0, zz + .2, trr), G.XK0 - 6 + dx, G.XK1 + 6 + dx, kATIK, items, { w: .7, op: Math.min(1, v*3), bias: .025 }); }
      // wax papers (between the endpaper and the block; over the fore-edge)
      if (st.wax > 0){ const dy = -50*(1 - ease(st.wax)), y0 = G.K0 - 10 + dy, y1 = G.K1 - 8;
        for (const z of [zb - .25, zb + S]) all.push(...xPrism(kRect(y0, z, y1, z + .25), G.XK0 + 3, G.XK1 - 3, color.kWAX, items, { w: .7, op: .9, bias: .03 })); }
      // rods (in the top and bottom joint grooves)
      if (st.mist > 0){ const dz = 40*(1 - ease(st.mist));
        for (const [z, b] of [[bookTop + 2 + dz, .06], [G.zc + 1.6, -.02]]){
          const sv = rod([G.XB0 - 8, yJ, z], [G.XB1 + 8, yJ, z], 2, s5STEEL, toneI, .9, 2, 12);
          items.push({ a: [yJ, z], r: 2, bias: b, svg: kOp1(sv) }); } }
      // brush (while gluing)
      if (st.brush) items.push({ a: [st.brush[1], st.brush[2] + 3], r: 6, bias: .2, svg: kBrush(xm, st.brush[1], st.brush[2], 'y') });
      // bone folder (in the joint groove)
      if (st.boneFolderT >= 0){ const u = st.boneFolderX, bn = kBone(kLerp(G.XB0 - 10, G.XB1 - 140, u), yJ - 11, bookTop + .4);
        items.push({ a: [yJ - 11, bookTop + 2], b: [yJ + 11, bookTop + 2], bias: .3, svg: bn.svg }); }
      const parts = [];
      // press bed (the book lies on it)
      if (IN_PRESS){ const yb = box(G.XB0 - 14, yP0, BH, G.XB1 + 14, yP1, BH + BED, s5WOOD, toneI, 1.4);
        parts.push({ box: [[G.XB0 - 14, yP0, BH], [G.XB1 + 14, yP1, BH + BED]], svg: yb }); }
      // book layer: the box top ends above the book (and the rods); the platen stays apart in z and is drawn in front
      parts.push({ box: [[G.XB0 - 8, 20, BH + BED], [G.XB1 + 8, D2 - 20, st.press > 0 ? bookTop + 4.2 : HMAX]], svg: xSort(items) });
      // press
      if (st.press > 0){ const pz = kLerp(bookTop + 70, bookTop + 4.2, ease(st.press)), zK = bookTop + 120, xc = xm;
        for (const [x0, x1] of [[6, 22], [W2 - 22, W2 - 6]]) parts.push({ box: [[x0, yPc - 18, BH], [x1, yPc + 18, zK]], svg: box(x0, yPc - 18, BH, x1, yPc + 18, zK, s5WOOD, toneI, 1.4) });
        parts.push({ box: [[6, yPc - 18, zK], [W2 - 6, yPc + 18, zK + 16]], svg: box(6, yPc - 18, zK, W2 - 6, yPc + 18, zK + 16, s5WOOD, toneI, 1.6) });
        parts.push({ box: [[xc - 4, yPc - 4, pz + 12], [xc + 4, yPc + 4, zK]], svg: rod([xc, yPc, pz + 12], [xc, yPc, zK + 22], 3.6, s5STEEL, toneI, 1, 3.6, 12) + rod([xc - 26, yPc, zK + 22], [xc + 26, yPc, zK + 22], 2.4, s5STEEL, toneI, 1, 2.4, 10) });
        parts.push({ box: [[G.XB0 - 11, yP0, pz], [G.XB1 + 11, yP1, pz + 12]], svg: box(G.XB0 - 11, yP0, pz, G.XB1 + 11, yP1, pz + 12, s5WOOD, toneI, 1.6) });
      }
      s += byDepth(parts);
      // labels
      const LB = [], bt = tr([G.K0 + O.W*.4, zb + S]);
      if (k > .6){
        // the points are spread along the book (the arrows do not gather at one corner)
        LB.push({ at: [(G.XK0 + G.XK1)/2, ...tr([G.K1 - 1, zb + S - 3])], text: t('learn.s.casingIn.mull'), on: false });
        LB.push({ at: [G.XK1, ...tr([G.K0 + O.W*.6, zb + S*.5])], text: t('learn.s.casingIn.folds', { n: O.N }), on: false });
        LB.push({ at: [G.XB0 + 25, G.RB0 + 2, G.zc + 1], text: t('learn.s.casingIn.board', { t: o.number(T) }), on: false });
        LB.push({ at: [G.XB1 - 35, ...ch.R1([(G.S0 + G.S1)/2, G.zc + 1])], text: t('learn.s.casingIn.strip'), on: false });
      } else {
        if (st.place < 1 && !(st.deneT >= 0)) LB.push({ at: [G.XK1 - 20, ...bt], text: st.glueA > 0 ? t('learn.s.casingIn.endpaper_glue') : t('learn.s.casingIn.endpaper_bottom'), on: st.glueAT >= 0 });
        if (st.mark > .5 && st.place < 1) LB.push({ at: [G.XK0 + 7, G.K0, zt0], text: t('learn.s.casingIn.mark'), on: st.deneT >= 0 });
        if (st.wasteA > .3 || st.wasteU > .3) LB.push({ at: st.wasteA > .3 ? [G.XK1 - 40 - (O.H + 30)*(1 - st.wasteA), ...tr([G.K0 - 6, zb + .35])] : [G.XK1 - 40 - (O.H + 30)*(1 - st.wasteU), G.K0 - 6, zb + S - .3], text: t('learn.s.casingIn.scrap'), on: st.glueAT >= 0 || st.glueUT >= 0 });
        else if (st.c < .5) LB.push({ at: [G.XK1 - 20, ...bt], text: st.glueU > 0 ? t('learn.s.casingIn.endpaper_glue') : t('learn.s.casingIn.endpaper_top'), on: st.glueUT >= 0 });
        if (st.c < .5) LB.push({ at: [G.XB1, (G.LB0 + G.LB1)/2, G.zc + 2], text: t('learn.s.casingIn.turnIn'), on: false });
        LB.push({ at: [G.XB1, ...ch.R1([(G.S0 + G.S1)/2, G.zc])], text: t('learn.s.casingIn.strip'), on: st.closeT >= 0 });
        LB.push({ at: [G.XB1, (G.RB1 + G.S0)/2, G.zc - .3], text: t('learn.s.casingIn.jointGap', { f: o.number(O.f) }), on: st.yerT >= 0 });
        if (st.place >= 1 && st.c < .5) LB.push({ at: [G.XK0 + 10, G.K0, zb + 2], text: t('learn.s.casingIn.square', { k: o.number(O.k) }), on: st.yerT >= 0 });
        LB.push({ at: [G.XK1 - 1.5, ...tr([G.K1 + 1.2, zb + 4])], text: t('learn.s.casingIn.headbands'), on: false });
        if (st.groove > 0 || st.boneFolderT >= 0) LB.push({ at: [G.XB0 + 30, yJ, bookTop], text: t('learn.s.casingIn.groove'), on: st.boneFolderT >= 0 });
        if (st.boneFolderT >= 0) LB.push({ at: [kLerp(G.XB0 - 10, G.XB1 - 140, st.boneFolderX) + 140, yJ, bookTop + 4], text: t('learn.s.casingIn.boneFolder'), on: true });
        if (st.wax > .5) LB.push({ at: [G.XK1 - 30, G.K0 - 10, zb + S], text: t('learn.s.casingIn.waxed'), on: st.mumT >= 0 });
        if (st.mist > .5) LB.push({ at: [G.XB1 + 8, yJ, bookTop + 2], text: t('learn.s.casingIn.mist'), on: st.sisT >= 0 });
        if (st.press > .5) LB.push({ at: [W2 - 14, yPc, bookTop + 60], text: t('learn.s.casingIn.press'), on: st.pressT >= 0 || st.dryT >= 0 });
      }
      s += xrCallouts(LB, k > .6 && st.c >= 1 ? [G.XB0 - 4, G.XB1 + 4, G.RB0 - 4, G.S1 + 6, 0, bookTop + 8] : [0, W2, 0, D2, 0, HMAX]);
      return s;
    }
    const kOp1 = svg => svg;
    const busy = (st, ui) => { if (st.anim2){ ui.flash(t('learn.f.busy')); return true; } return false; };
    const finish = st => { st.anim2 = false; st.brush = null; };
    const brushY = (u, z) => [xm, kLerp(G.K0 + 4, G.K1 - 4, u), z];
    // waste paper: laid in (.35 s), glue brushed on, pulled out (.7 s)
    const withWaste = (st, ui, name, tKey, glue, done) => kOrder(st, ui, [['wasteT', .35, u => { st[name] = u; }], [tKey, 1.6, glue], ['wasteT', .7, u => { st.brush = null; st[name] = 1 - u; }]], () => { st[name] = 0; done(); });
    const step = {
      dryFit: { action(st, ui){ if (busy(st, ui)) return false; if (st.attempt >= 1){ ui.flash(t('learn.s.casingIn.f_has_try')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_try', { k: o.number(O.k) }), 2800);
          kRun(st, ui, 'deneT', 3.6, u => { st.attempt = u; st.mark = kSeg(u, .42, .58); }, () => { st.attempt = 1; st.mark = 1; finish(st); }); return true; },
        last(st){ st.attempt = 1; st.mark = 1; } },
      bottom: { action(st, ui){ if (busy(st, ui)) return false; if (st.attempt < 1){ ui.flash(t('learn.s.casingIn.f_first_try')); return false; }
          if (st.glueA >= 1){ ui.flash(t('learn.s.casingIn.f_has_glue')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_bottom'), 3200);
          // the face on top while the block lies upside down: y mirrored in turned coordinates (2hY − y)
          withWaste(st, ui, 'wasteA', 'glueAT', u => { st.glueA = u; const p = brushY(u, BH + S + .4); st.brush = [p[0], 2*hY - p[1], p[2]]; }, () => { st.glueA = 1; finish(st); }); return true; },
        last(st){ st.glueA = 1; st.wasteA = 0; } },
      place: { action(st, ui){ if (busy(st, ui)) return false; if (st.glueA < 1){ ui.flash(t('learn.s.casingIn.f_first_bottom')); return false; }
          if (st.place >= 1){ ui.flash(t('learn.s.casingIn.f_has_place')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_place', { k: o.number(O.k) }), 2800); kRun(st, ui, 'yerT', 1.8, u => { st.place = u; }, () => { st.place = 1; finish(st); }); return true; },
        last(st){ st.place = 1; } },
      top: { action(st, ui){ if (busy(st, ui)) return false; if (st.place < 1){ ui.flash(t('learn.s.casingIn.f_first_place')); return false; }
          if (st.glueU >= 1){ ui.flash(t('learn.s.casingIn.f_has_glue')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_top'), 3200);
          withWaste(st, ui, 'wasteU', 'glueUT', u => { st.glueU = u; st.brush = brushY(u, zb + S + .4); }, () => { st.glueU = 1; finish(st); }); return true; },
        last(st){ st.glueU = 1; st.wasteU = 0; } },
      close: { action(st, ui){ if (busy(st, ui)) return false; if (st.glueU < 1){ ui.flash(t('learn.s.casingIn.f_first_top')); return false; }
          if (st.c >= 1){ ui.flash(t('learn.s.casingIn.f_closed')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_close'), 2400); kRun(st, ui, 'closeT', 2.2, u => { st.c = u; }, () => { st.c = 1; finish(st); }); return true; },
        last(st){ st.c = 1; } },
      jointGap: { action(st, ui){ if (busy(st, ui)) return false; if (st.c < 1){ ui.flash(t('learn.s.casingIn.f_close_first')); return false; }
          if (st.groove >= 1){ ui.flash(t('learn.s.casingIn.f_has_groove')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_groove'), 2400);
          kRun(st, ui, 'boneFolderT', 2.4, u => { st.boneFolderX = u < .5 ? ease(u*2) : 1 - ease((u - .5)*2); st.groove = Math.min(1, u*1.6); }, () => { st.groove = 1; st.boneFolderT = -1; finish(st); }); return true; },
        last(st){ st.groove = 1; st.boneFolderT = -1; } },
      // ---- press
      waxed: { action(st, ui){ if (busy(st, ui)) return false; if (st.wax >= 1){ ui.flash(t('learn.s.casingIn.f_has_wax')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_wax'), 2600); kRun(st, ui, 'mumT', 1.2, u => { st.wax = u; }, () => { st.wax = 1; finish(st); }); return true; },
        last(st){ st.wax = 1; } },
      mist: { action(st, ui){ if (busy(st, ui)) return false; if (st.wax < 1){ ui.flash(t('learn.s.casingIn.f_first_wax')); return false; }
          if (st.mist >= 1){ ui.flash(t('learn.s.casingIn.f_rods_done')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_rods'), 2400); kRun(st, ui, 'sisT', 1, u => { st.mist = u; }, () => { st.mist = 1; finish(st); }); return true; },
        last(st){ st.mist = 1; } },
      press: { action(st, ui){ if (busy(st, ui)) return false; if (st.mist < 1){ ui.flash(t('learn.s.casingIn.f_first_rods')); return false; }
          if (st.press >= 1){ ui.flash(t('learn.s.casingIn.f_press_done')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_press'), 2200); kRun(st, ui, 'pressT', 1.4, u => { st.press = u; }, () => { st.press = 1; finish(st); }); return true; },
        last(st){ st.press = 1; } },
      dry: { action(st, ui){ if (busy(st, ui)) return false; if (st.press < 1){ ui.flash(t('learn.s.casingIn.f_first_press')); return false; }
          if (st.dry >= 1){ ui.flash(t('learn.s.casingIn.f_dry')); return false; }
          st.anim2 = true; kRun(st, ui, 'dryT', 2.4, u => { st.dry = u; }, () => { st.dry = 1; ui.flash(t('learn.s.casingIn.f_dried'), 2600); finish(st); }); return true; },
        last(st){ st.dry = 1; } }
    };
    const st0 = { attempt: 0, deneT: -1, mark: 0, wasteA: 0, wasteU: 0, wasteT: -1, glueA: 0, glueAT: -1, place: 0, yerT: -1, glueU: 0, glueUT: -1, c: 0, closeT: -1, groove: 0, boneFolderT: -1, boneFolderX: 0,
      wax: 0, mumT: -1, mist: 0, sisT: -1, press: 0, pressT: -1, dry: 0, dryT: -1, brush: null, anim: 0, anim2: false };
    return { step, cfg: {
      title: t('learn.casingIn.name'), credit: false, size: [W2, D2, HMAX], state: st0, scene,
      stats: st => [{ label: t('learn.s.casingIn.st_drying'), value: t('learn.s.casingIn.st_hours', { n: Math.round(st.dry*24) }) }, { label: t('learn.s.casingIn.st_press'), value: st.press >= 1 ? t('learn.s.casingIn.st_clamped') : t('learn.s.casingIn.st'), small: true }]
    } };
  };
})(typeof self !== 'undefined' ? self : this);
