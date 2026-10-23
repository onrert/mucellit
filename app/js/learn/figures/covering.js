/*
 * figures/covering.js — Aşama 7: kapağı kaplama (tutkal kaplamaya → mukavvalar → köşeler → önce uzun kenarlar (baş/etek),
 * sonra kısa kenarlar (ağız) → deneme).
 * LİSANS NOTU (MIT): Colorfigures motoru ve yöntemiyle yapıldı (ilk sürüm: Öğren prototipi, Şekil 3).
 * MIT License. Copyright (c) 2026 April Zhu (Colorfigures; iso-glow) ve Tolga Cohce (iso-figure). Tam metin: LICENSE.
 *
 * Gerçekte nasıl (MEB-2021 s.74-75; MEGEP-2008 s.36): kaplamanın tersine tutkal sürülür (bu rehberin tek yolu); iki
 * mukavva ve sırt şeridi f mafsal boşluğu bırakılarak ortalanır; dört köşe mukavva köşesinden t + 2 … t + 3 mm uzakta 45°
 * kesilir; ÖNCE uzun kenarlar (açık kapakta baş ve etek), SONRA kısa kenarlar (ağız) kıvrılır; ağız payı köşede baş/etek
 * payının üstüne biner. Ölçüler kitabın sayılarından (calc.js).
 * Koordinat: x = yükseklik yönü (mukavva fcXA..fcXB), y = genişlik, z = yukarı; 1 birim = 1 mm.
 * PARÇALAR: kesme altlığı · kaplama (bez yüzü + astar yüzü) · 2 mukavva · sırt şeridi · 4 kıvırma payı · 4 köşe üçgeni ·
 *   fırça. ÇİZİM: x boyunca uzanan her şey (y, z) kesitinde 2B ressam sıralaması (xSort); dönen baş/etek payları ve
 *   kesilen köşeler ayrı.
 */
'use strict';
(function (root) {
  const MC = root.Mucellit.learn, { byDepth, f, pd, on, sub, cross, norm, avg, vis, tone, toneI, matOf, ease, ink, fill, face, shape, box, boardTop, board, xrCallouts } = MC.cf;
  MC.figures.covering = function (o) {
    const { xSort, kRun, kSeg, kText, color } = MC.common, O = o.size, t = o.t;
    const fcBACK = color.kBACK, fcBOARD = color.kBOARD, fcMAT = color.kMAT;
    const T = O.t, Db = O.Db, Dh = O.Dh, R = O.R, F = O.f, fcE = O.e + T, CORNER = (O.corner[0] + O.corner[1])/2, C2 = CORNER*Math.SQRT2;
    const fcBH = 4, fcZ0 = fcBH + .3, fcZB = fcBH + .6, fcT = T, fcZT = fcZB + fcT;
    const fcXA = 20 + fcE, fcXB = fcXA + Dh, fcCX0 = fcXA - fcE, fcCX1 = fcXB + fcE;
    const fcCY0 = 25.6, fcRB0 = fcCY0 + fcE, fcRB1 = fcRB0 + Db, fcS0 = fcRB1 + F, fcS1 = fcS0 + R, fcLB0 = fcS1 + F, fcLB1 = fcLB0 + Db, fcCY1 = fcLB1 + fcE;
    const fcMW = fcCX1 + 20, fcMD = fcCY1 + 26, fcH = Math.max(160, Db + 20);
    const H1 = 2.9;                                  // ağız payının menteşe yüksekliği (baş/etek payının üstüne biner)
    const fcRot = (p, h, a) => { const c = Math.cos(a), s = Math.sin(a), dy = p[0] - h[0], dz = p[1] - h[1]; return [h[0] + dy*c - dz*s, h[1] + dy*s + dz*c]; };

    function fcGeom(st){
      const b = st.close*Math.PI/2, HL = [fcLB0, fcZ0], HR = [fcRB1, fcZ0];
      const rL = p => fcRot(p, HL, b), rR = p => fcRot(p, HR, -b);
      const flap = (ye, sg, g) => { const a = Math.PI/2*Math.min(1, g/.5), bb = Math.PI/2*Math.max(0, (g - .5)/.5);
        const p0 = [ye, fcZ0], p1 = [ye + sg*Math.cos(a)*H1, fcZ0 + Math.sin(a)*H1], p2 = [p1[0] + sg*Math.cos(a + bb)*(fcE - H1), p1[1] + Math.sin(a + bb)*(fcE - H1)];
        return [p0, p1, p2]; };
      const fl = flap(fcLB1, 1, st.foldL), fr = flap(fcRB0, -1, st.foldL);
      const cloth = [
        { p: rL(fl[2]), d: fcE }, { p: rL(fl[1]), d: H1 }, { p: rL(fl[0]), d: 0 }, { p: rL([fcLB0, fcZ0]), d: -1 },
        { p: [fcS1, fcZ0], d: -1 }, { p: [fcS0, fcZ0], d: -1 }, { p: rR([fcRB1, fcZ0]), d: -1 },
        { p: rR(fr[0]), d: 0 }, { p: rR(fr[1]), d: H1 }, { p: rR(fr[2]), d: fcE } ];
      const rect = (y0, y1, rot) => [[y0, fcZB], [y1, fcZB], [y1, fcZT], [y0, fcZT]].map(rot);
      return { b, rL, rR, cloth, boards: [rect(fcLB0, fcLB1, rL), rect(fcS0, fcS1, p => p), rect(fcRB0, fcRB1, rR)] };
    }
    // ağız payının x uzunluğu: gövde mukavva boyu; pay köşe kesilince 45°
    const fcXr = (d, cut) => d < 0 ? [fcXA, fcXB] : !cut ? [fcCX0, fcCX1] : [fcXA - C2 + d, fcXB + C2 - d];

    function scene(st, m){
      const k = ease(st.xr || 0), G = fcGeom(st), items = [], all = [];
      let s = board(0, 0, fcMW, fcMD, fcBH, 8, fcMAT);
      let g = ''; for (let x = 20; x < fcMW; x += 20) g += pd([[x, 6, fcBH + .05], [x, fcMD - 6, fcBH + .05]], false);
      for (let y = 20; y < fcMD; y += 20) g += pd([[6, y, fcBH + .05], [fcMW - 6, y, fcBH + .05]], false);
      s += `<path d="${g}" fill="none" stroke="#b5dcc0" stroke-width=".6" opacity=".8"/>`;
      const cOp = 1 - .7*k;
      for (let i = 0; i + 1 < G.cloth.length; i++){
        const A = G.cloth[i], B = G.cloth[i + 1], a = A.p, b = B.p, tv = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(...tv); if (tl < 1e-6) continue;
        const nOut = [0, -tv[1]/tl, tv[0]/tl], good = vis(nOut), seen = good ? nOut : nOut.map(v => -v);
        const body = A.d < 0 || B.d < 0, xa = fcXr(body ? -1 : A.d, st.cut), xb = fcXr(body ? -1 : B.d, st.cut);   // gövde parçası: mukavva boyu
        const Q = [[xa[0], a[0], a[1]], [xa[1], a[0], a[1]], [xb[1], b[0], b[1]], [xb[0], b[0], b[1]]];
        let sv = face(pd(Q), good ? tone(seen, m) : toneI(seen, fcBACK)) + ink(pd([Q[0], Q[3]], false), 1) + ink(pd([Q[1], Q[2]], false), 1);
        if (i === 0) sv += ink(pd([Q[0], Q[1]], false), 1); if (i === G.cloth.length - 2) sv += ink(pd([Q[3], Q[2]], false), 1);
        items.push({ a, b, bias: body ? 0 : .035, svg: cOp < 1 ? `<g opacity="${f(cOp)}">${sv}</g>` : sv }); all.push(...Q);
      }
      // tutkal (kaplamanın astar yüzüne, fırçayla)
      let brush = null;
      if (st.glue > 0 && st.drop < 1){ const yg = fcCY0 + (fcCY1 - fcCY0)*st.glue, zg = fcZ0 + .08;
        const gl = shape([[fcCX0 + 2, fcCY0 + 2, zg], [fcCX1 - 2, fcCY0 + 2, zg], [fcCX1 - 2, yg, zg], [fcCX0 + 2, yg, zg]], '#fffbe6', 0);
        let st2 = ''; for (let x = fcCX0 + 14; x < fcCX1; x += 23) st2 += pd([[x, fcCY0 + 4, zg + .01], [x + 6, Math.max(fcCY0 + 5, yg - 4), zg + .01]], false);
        items.push({ a: [fcCY0 + 2, zg], b: [yg, zg], bias: .005, svg: `<g opacity=".55">${gl}</g><path d="${st2}" fill="none" stroke="#ffffff" stroke-width="1.2" opacity=".6"/>` });
        if (st.glueT >= 0){ const by = Math.min(fcCY1 - 10, yg), bz = fcZ0 + 1.5;
          brush = { box: [[fcCX0 + 60, by - 6, bz], [fcCX1 - 60, by + 6, bz + 30]], svg: box(fcCX0 + 60, by - 5, bz, fcCX1 - 60, by + 5, bz + 6, matOf('#e9d9a6'), toneI, 1) + box(fcCX0 + 90, by - 4, bz + 6, fcCX1 - 90, by + 4, bz + 22, color.kWOOD, toneI, 1.2) }; } }
      // mukavvalar ve sırt şeridi
      const dz = 70*(1 - ease(st.drop));
      if (st.drop > 0) G.boards.forEach((Rr, bi) => {
        const P4 = Rr.map(p => [p[0], p[1] + dz]), cen = [(P4[0][0] + P4[2][0])/2, (P4[0][1] + P4[2][1])/2];
        for (let i = 0; i < 4; i++){ const a = P4[i], b = P4[(i + 1) % 4], tv = [b[0] - a[0], b[1] - a[1]];
          let n = [0, -tv[1], tv[0]]; if (n[1]*(a[0] - cen[0]) + n[2]*(a[1] - cen[1]) < 0) n = n.map(v => -v); n = norm(n);
          if (!vis(n)) continue;
          const Q = [[fcXA, a[0], a[1]], [fcXB, a[0], a[1]], [fcXB, b[0], b[1]], [fcXA, b[0], b[1]]];
          let sv = shape(Q, toneI(n, fcBOARD), 1.1);
          if (bi !== 1 && i === 2){ const ang = bi === 0 ? G.b : -G.b, U = [0, -Math.cos(ang), -Math.sin(ang)], mid = [(a[0] + b[0])/2 + n[1]*.2, (a[1] + b[1])/2 + n[2]*.2];
            sv += kText([(fcXA + fcXB)/2, mid[0], mid[1]], U, [1, 0, 0], t('learn.size_two', { a: o.number(Db), b: o.number(Dh) }), 11, '#4a443b', 800); }
          items.push({ a, b, bias: .01, svg: sv }); all.push(...Q); } });
      // katlanmış baş / etek payları (ÖNCE kıvrılır; kapak kapanırken mukavvayla döner)
      const zTop = fcZT + .3;
      const yzTop = [[[fcRB0 + 1.4, zTop], [fcRB1, zTop]], [[fcRB1, zTop], [fcS0, zTop]], [[fcS0, zTop], [fcS1, zTop]], [[fcS1, zTop], [fcLB0, zTop]], [[fcLB0, zTop], [fcLB1 - 1.4, zTop]]];
      const mapTop = (p, j) => j === 0 ? G.rR(p) : j === 4 ? G.rL(p) : j === 1 ? (p[0] === fcRB1 ? G.rR(p) : p) : j === 3 ? (p[0] === fcLB0 ? G.rL(p) : p) : p;
      const headSep = [], Lb = fcE - 2.6;
      if (st.foldH >= 1){
        for (const [x0, x1] of [[fcXA, fcXA + Lb], [fcXB - Lb, fcXB]]) yzTop.forEach(([p, q], j) => {
          const a = mapTop(p, j), b = mapTop(q, j), tv = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(...tv);
          const nU = [0, -tv[1]/tl, tv[0]/tl], up = vis(nU.map(v => -v)) ? nU.map(v => -v) : nU;
          const Q = [[x0, a[0], a[1]], [x1, a[0], a[1]], [x1, b[0], b[1]], [x0, b[0], b[1]]];
          const sv = shape(Q, tone(up, m), .9);
          items.push({ a, b, bias: .02, svg: cOp < 1 ? `<g opacity="${f(cOp)}">${sv}</g>` : sv }); });
      } else {
        for (const [xh, sg] of [[fcXA, -1], [fcXB, 1]]){
          const g2 = st.foldH, a = Math.PI/2*Math.min(1, g2/.5), bb = Math.PI/2*Math.max(0, (g2 - .5)/.5);
          const p0 = [xh, fcZ0], p1 = [xh + sg*Math.cos(a)*2.6, fcZ0 + Math.sin(a)*2.6], p2 = [p1[0] + sg*Math.cos(a + bb)*(fcE - 2.6), p1[1] + Math.sin(a + bb)*(fcE - 2.6)];
          const yr = d => st.cut ? [fcRB0 - C2 + d, fcLB1 + C2 - d] : [fcRB0, fcLB1];
          const pieces = [[p0, 0, p1, 2.6], [p1, 2.6, p2, fcE]].map(([A, da, B, db]) => {
            const Q = [[A[0], yr(da)[0], A[1]], [A[0], yr(da)[1], A[1]], [B[0], yr(db)[1], B[1]], [B[0], yr(db)[0], B[1]]];
            const n = norm(cross(sub(Q[1], Q[0]), sub(Q[3], Q[0]))), good = vis(n.map(v => -v)) === (sg < 0);
            const seen = vis(n) ? n : n.map(v => -v);
            return { at: avg(Q), svg: shape(Q, good ? tone(seen, m) : toneI(seen, fcBACK), 1) }; });
          const svg = byDepth(pieces);
          const bx = [[Math.min(p0[0], p1[0], p2[0]), fcRB0 - C2, fcZ0], [Math.max(p0[0], p1[0], p2[0]), fcLB1 + C2, Math.max(p0[1], p1[1], p2[1])]];
          headSep.push({ svg: cOp < 1 ? `<g opacity="${f(cOp)}">${svg}</g>` : svg, box: bx, over: g2 > .5 });
        }
      }
      const clip = boardTop(0, 0, fcMW, fcMD, fcBH, 8);
      const main = { box: [[fcXA, fcCY0, fcBH], [fcXB, fcCY1, fcH]], svg: xSort(items) };
      s += byDepth([main, ...headSep.filter(h => !h.over), brush]) + headSep.filter(h => h.over).map(h => h.svg).join('');
      // kesilen köşeler: kalkıp kaybolur
      if (st.cutT >= 0){ const u = ease(Math.min(1, st.cutT/.9)), z = fcZ0 + .2 + 40*u, L = 2*fcE - C2;
        for (const [cx, cy, sx, sy] of [[fcCX0, fcCY1, 1, -1], [fcCX0, fcCY0, 1, 1], [fcCX1, fcCY1, -1, -1], [fcCX1, fcCY0, -1, 1]])
          s += `<g opacity="${f(1 - u)}">${shape([[cx, cy, z], [cx + sx*L, cy, z], [cx, cy + sy*L, z]], tone([0, 0, 1], m), 1)}</g>`; }
      // etiketler
      const LB = [], bk = st.drop > .5;
      if (bk){ LB.push({ at: [fcXB, ...G.rL([(fcLB0 + fcLB1)/2, fcZT])], text: t('learn.s.covering.brd', { a: o.number(Db), b: o.number(Dh) }), on: st.dropT >= 0 });
        LB.push({ at: [fcXB, (fcS0 + fcS1)/2, fcZT], text: t('learn.s.covering.strip', { a: o.number(R), b: o.number(Dh) }), on: st.dropT >= 0 });
        LB.push({ at: [fcXB, (fcLB0 + fcS1)/2, fcZ0], text: t('learn.s.covering.jointGap', { f: o.number(F) }), on: st.closeT >= 0 }); }
      if (st.glue > 0 && st.drop < 1) LB.push({ at: [150, fcCY0 + (fcCY1 - fcCY0)*st.glue*.5, fcZ0], text: t('learn.s.covering.glue'), on: st.glueT >= 0 });
      if (st.foldH < 1) LB.push({ at: [fcCX1, (fcRB0 + fcRB1)/2, fcZ0], text: t('learn.s.covering.long', { e: o.number(O.e), t: o.number(T) }), on: st.foldT >= 0 && st.foldH < 1 });
      if (st.foldL < 1) LB.push({ at: [(fcXA + fcXB)/2, ...G.cloth[G.cloth.length - 1].p], text: t('learn.s.covering.short'), on: st.foldT >= 0 && st.foldH >= 1 });
      LB.push({ at: [fcXA + 5, ...G.cloth[4].p], text: t('learn.s.covering.covering', { a: o.number(O.covering.width), b: o.number(O.covering.height) }), on: false });
      if (st.cut && st.close < .3) LB.push({ at: [fcXA - C2/2, fcLB1 + C2/2, fcZ0], text: t('learn.s.covering.corner', { a: o.number(O.corner[0]), b: o.number(O.corner[1]) }), on: st.cutT >= 0 });
      s += xrCallouts(LB, [0, fcMW, 0, fcMD, 0, fcH]);
      return s;
    }
    const busy = (st, ui) => { if (st.anim2){ ui.flash(t('learn.f.busy')); return true; } return false; };
    const finish = st => { st.anim2 = false; };
    const step = {
      glue: { action(st, ui){ if (busy(st, ui)) return false; if (st.glue >= 1){ ui.flash(t('learn.s.covering.f_has_glue')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.covering.f_glue'), 2400); kRun(st, ui, 'glueT', 1.6, u => { st.glue = u; }, () => finish(st)); return true; },
        last(st){ st.glue = 1; } },
      place: { action(st, ui){ if (busy(st, ui)) return false; if (st.drop >= 1){ ui.flash(t('learn.s.covering.f_has_brd')); return false; }
          if (st.glue < 1){ ui.flash(t('learn.s.covering.f_once_glue')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.covering.f_brd', { f: o.number(F) }), 2400); kRun(st, ui, 'dropT', 1, u => { st.drop = u; }, () => finish(st)); return true; },
        last(st){ st.glue = 1; st.drop = 1; } },
      corner: { action(st, ui){ if (busy(st, ui)) return false; if (st.drop < 1){ ui.flash(t('learn.s.covering.f_once_brd')); return false; }
          if (st.cut){ ui.flash(t('learn.s.covering.f_has_corner')); return false; }
          st.anim2 = true; st.cut = true; ui.flash(t('learn.s.covering.f_corner', { a: o.number(O.corner[0]), b: o.number(O.corner[1]) }), 2400);
          kRun(st, ui, 'cutT', .9, () => {}, () => { st.cutT = -1; finish(st); }); return true; },
        last(st){ st.cut = true; st.cutT = -1; } },
      turnIn: { action(st, ui){ if (busy(st, ui)) return false; if (!st.cut){ ui.flash(t('learn.s.covering.f_once_corner')); return false; }
          if (st.foldL >= 1){ ui.flash(t('learn.s.covering.f_has_turn_in')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.covering.f_turn_in'), 3000);
          kRun(st, ui, 'foldT', 2.6, u => { st.foldH = kSeg(u, 0, .45); st.foldL = kSeg(u, .55, 1); }, () => finish(st)); return true; },
        last(st){ st.foldH = 1; st.foldL = 1; } },
      close: { action(st, ui){ if (busy(st, ui)) return false; if (st.foldL < 1){ ui.flash(t('learn.s.covering.f_turn_in_once')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.covering.f_close'), 2600);
          kRun(st, ui, 'closeT', 2.4, u => { st.close = u < .5 ? ease(u*2) : 1 - ease((u - .5)*2); }, () => { st.close = 0; st.tried = 1; finish(st); }); return true; },
        last(st){ st.close = 0; st.tried = 1; } }
    };
    const st0 = { glue: 0, glueT: -1, drop: 0, dropT: -1, cut: false, cutT: -1, foldL: 0, foldH: 0, foldT: -1, close: 0, closeT: -1, tried: 0, anim: 0, anim2: false };
    return { step, cfg: {
      title: t('learn.covering.name'), credit: false, size: [fcMW, fcMD, fcH], state: st0, scene,
      stats: st => [{ label: t('learn.s.covering.st_covering'), value: t('learn.size_two', { a: o.number(O.covering.width), b: o.number(O.covering.height) }), small: true }, { label: t('learn.s.covering.st_joint'), value: t('learn.mm', { v: o.number(F) }), small: true }]
    } };
  };
})(typeof self !== 'undefined' ? self : this);
