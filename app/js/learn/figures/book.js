/*
 * figures/book.js — Stage 10: the finished book (open the cover, turn the pages, close it).
 * LICENSE NOTE (MIT): made with the Colorfigures engine and method (first version: the Learn prototype, figure 6).
 * MIT License. Copyright (c) 2026 April Zhu (Colorfigures; iso-glow) and Tolga Cohce (iso-figure). Full text: LICENSE.
 *
 * How it is done in reality: the front cover opens at the joint (the pasted endpaper covers the inner face of the
 * board, ~3 mm of the turn-in shows at the edge); the free endpaper and the pages turn from the spine; a page opens
 * with a curve near the spine.
 * Simplification: at most the first 10 leaves (endpaper + pages) are drawn and turned separately, the rest is one
 * block; the gap between the leaves is enlarged. Page texts are placeholder lines.
 * Coordinates: x = spine length, y = width, z = up; 1 unit = 1 mm. The measurements come from the book's numbers.
 * PARTS: cutting mat · back cover · spine stiffener · front cover (lettering, endpaper on the inner face, turn-ins) ·
 *   joint cloth · block (endpaper, fore-edge, mull, sections) · 2 headbands · leaves. DRAWING: all along x: 2D painter's
 *   sort (xSort).
 */
'use strict';
(function (root) {
  const MC = root.Mucellit.learn, { PALS, f, pd, on, vis, toneI, ease, ink, fill, face, boardTop, xrCallouts } = MC.cf;
  MC.figures.book = function (o) {
    const { xSort, kRun, kOrder, kLerp, kSeg, kMat, kBlockItems, kCaseItems, kGeo, kChain, kText, kOp, color } = MC.common, O = o.size, t = o.t;
    const G = kGeo(O), W = O.W, kPAPER = color.kPAPER, kENDP = color.kENDP;
    const NL = Math.min(10, O.sheet + 1), DY = Math.min(.35, O.S*.5/NL), DROOP = .085;
    const ZB = G.zc + G.T, ZT = ZB + G.TH, s6W = G.matW, s6D = G.matD, HMAX = Math.max(120, W*.8);
    const ch0 = st => kChain(G, Math.PI/2, Math.PI/2 - st.open*(Math.PI + DROOP));
    // leaf j: the hinge at the spine (y = K1); flat towards -y; when turned it curves from the spine and lies on the open cover
    function leaf(j, a, ch, order){
      const H = [G.K1, ZT - .05 - DY*j];
      const q0 = ch.Rl([G.LB0, G.zc + G.T]), q1 = ch.Rl([G.LB1, G.zc + G.T]), dl = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
      const dir = [(q1[0] - q0[0])/dl, (q1[1] - q0[1])/dl], nUp = [-dir[1], dir[0]], oo = .5 + .45*order;
      const P2 = [q0[0] + nUp[0]*oo + dir[0]*2, q0[1] + nUp[1]*oo + dir[1]*2], P1 = [G.K1 + 2.6, Math.max(H[1], P2[1]) + 1.2 + .3*order];
      const d1 = Math.hypot(P1[0] - H[0], P1[1] - H[1]), d2 = Math.hypot(P2[0] - P1[0], P2[1] - P1[1]), L3 = W - d1 - d2;
      const fin = [H, P1, P2, [P2[0] + dir[0]*L3, P2[1] + dir[1]*L3]];
      const th = a*Math.PI, e = [-Math.cos(th), Math.sin(th)], ds = [0, d1, d1 + d2, W];
      const str = ds.map(d => [H[0] + e[0]*d, H[1] + e[1]*d]);
      if (a <= .7) return str;
      const w = ease((a - .7)/.3); return str.map((p, i) => [kLerp(p[0], fin[i][0], w), kLerp(p[1], fin[i][1], w)]);
    }
    const page = j => j === 0 ? { f: 'endpapers', b: 'endpapers' } : { f: j === 1 ? 'title' : String(2*j - 1), b: String(2*j) };
    function leafItems(j, pts, items, op){
      for (let i = 0; i + 1 < pts.length; i++){
        const a = pts[i], b = pts[i + 1], tv = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(...tv); if (tl < 1e-6) continue;
        const nTop = [0, tv[1]/tl, -tv[0]/tl], front = vis(nTop), n = front ? nTop : nTop.map(v => -v), pg = page(j)[front ? 'f' : 'b'];
        const Q = [[G.XK0, a[0], a[1]], [G.XK1, a[0], a[1]], [G.XK1, b[0], b[1]], [G.XK0, b[0], b[1]]];
        let sv = face(pd(Q), toneI(n, pg === 'endpapers' ? kENDP : kPAPER)) + ink(pd([Q[0], Q[3]], false), .9) + ink(pd([Q[1], Q[2]], false), .9);
        if (i === pts.length - 2){ sv += ink(pd([Q[3], Q[2]], false), .9);
          if (pg !== 'endpapers'){ const e = [0, tv[0]/tl, tv[1]/tl], U = front ? e : e.map(v => -v), V = [1, 0, 0], sc = O.H/210;
            const at = (s2, x) => [x, a[0] + tv[0]*s2 + n[1]*.08, a[1] + tv[1]*s2 + n[2]*.08];
            if (pg === 'title') sv += kText(at(.5, G.XK0 + 80*sc), U, V, t('learn.s.book.title1'), 12, '#3a332a') + kText(at(.5, G.XK0 + 98*sc), U, V, t('learn.s.book.title2'), 6, '#6d6556', 700);
            else { let d = ''; for (let r = 0; r < 18; r++){ const x = G.XK0 + (30 + 8*r)*sc; d += pd([at(.12, x), at(.88, x)], false); }
              sv += `<path d="${d}" fill="none" stroke="#b9b09c" stroke-width=".8" stroke-linecap="round"/>` + kText(at(.5, G.XK0 + 190*sc), U, V, pg, 6, '#6d6556', 700); } } }
        items.push({ a, b, bias: .01*(j + 1), svg: kOp(op, sv) });
      }
    }
    function scene(st, m){
      const k = ease(st.xr || 0), items = [], ch = ch0(st), cop = 1 - .75*k, lop = 1 - .8*k;
      let s = kMat(s6W, s6D, G.BH);
      const all = kCaseItems(G, ch, m, items, { op: cop, paste: true, groove: 1, title: t('learn.s.book.cover1'), title2: t('learn.s.book.cover2') });
      all.push(...kBlockItems(G, G.K0, ZB, items, { k, m: PALS.tomato, op: 1, th: G.TH - NL*DY, endpaperTop: false, mullKanat: false }));
      for (let j = 0; j < NL; j++){
        const a = j < st.turned ? 1 - (st._back || 0) : j === st.turned && st.turnA > 0 ? st.turnA : 0;
        leafItems(j, leaf(j, a, ch, j), items, lop);
      }
      s += xSort(items);
      const LB = [];
      if (k > .6){
        // the marker points are spread along the book (headband at the head end, mull in the middle of the spine, stiffener near the
        // tail, board at the fore-edge corner, signatures at the tail section); the arrows do not gather at one corner
        LB.push({ at: [G.XK1, G.K0 + W*.6, ZB + G.TH*.5], text: t('learn.s.book.folds', { n: O.N }), on: false });
        LB.push({ at: [(G.XK0 + G.XK1)/2, G.K1 + .1, ZB + G.TH*.5], text: t('learn.s.book.mull'), on: false });
        LB.push({ at: [G.XB0 + 25, G.RB0 + 2, G.zc + 1], text: t('learn.s.book.board', { t: o.number(G.T) }), on: false });
        LB.push({ at: [G.XB1 - 35, ...ch.R1([(G.S0 + G.S1)/2, G.zc + 1])], text: t('learn.s.book.strip', { r: o.number(G.R) }), on: false });
        LB.push({ at: [G.XK0 + 1.5, G.K1 + 1.2, ZB + 3], text: t('learn.s.book.headbands'), on: false });
      } else {
        const cv = ch.Rl([(G.LB0 + G.LB1)/2, G.zc + (st.open > .5 ? G.T : 0)]);
        LB.push({ at: [G.XB1 - 20, cv[0], cv[1]], text: st.open > .5 ? t('learn.s.book.stuck') : t('learn.s.book.front_cover'), on: st.openT >= 0 });
        LB.push({ at: [G.XB1, ...ch.R1([(G.S0 + G.S1)/2, G.zc])], text: t('learn.s.book.spine'), on: false });
        LB.push({ at: [G.XB1, ...ch.Rl([G.LB0 - 3.5, G.zc - .3])], text: t('learn.s.book.joint_gap'), on: st.openT >= 0 });
        LB.push({ at: [G.XK1, G.K0 + .2, ZB + 3], text: t('learn.s.book.fore_edge'), on: false });
        if (st.open > .5 && st.turned === 0) LB.push({ at: [G.XK1 - 30, ...leaf(0, st.turnA > 0 ? st.turnA : 0, ch, 0)[2]], text: t('learn.s.book.free'), on: st.turnT >= 0 });
      }
      // with see-inside and with the cover closed the label columns follow the bounds of the book (the book stays large, the arrows short)
      s += xrCallouts(LB, k > .6 && st.open < .05 ? [G.XB0 - 4, G.XB1 + 4, G.RB0 - 4, G.S1 + 6, 0, ZT + 8] : [0, s6W, 0, s6D, 0, HMAX]);
      return s;
    }
    const busy = (st, ui) => { if (st.anim2){ ui.flash(t('learn.f.busy')); return true; } return false; };
    const finish = st => { st.anim2 = false; };
    const swap = (st, ui, n, duration, done) => { const turnNext = i => { if (i >= n || st.turned >= NL){ done(); return; }
      kRun(st, ui, 'turnT', duration, u => { st.turnA = u; }, () => { st.turned++; st.turnA = 0; turnNext(i + 1); }); }; turnNext(0); };
    const step = {
      open: { action(st, ui){ if (busy(st, ui)) return false; if (st.open >= 1){ ui.flash(t('learn.s.book.f_open')); return false; }
          st.anim2 = true; kRun(st, ui, 'openT', 1.6, u => { st.open = u; }, () => { st.open = 1; finish(st); }); return true; },
        last(st){ st.open = 1; } },
      swap: { action(st, ui){ if (busy(st, ui)) return false; if (st.open < 1){ ui.flash(t('learn.s.book.f_first_open')); return false; }
          if (st.turned >= NL){ ui.flash(t('learn.s.book.f_last_sheet')); return false; }
          st.anim2 = true; swap(st, ui, Math.min(3, NL), 1.1, () => finish(st)); return true; },
        last(st){ st.open = 1; st.turned = Math.min(3, NL); } },
      more: { action(st, ui){ if (busy(st, ui)) return false; if (st.open < 1){ ui.flash(t('learn.s.book.f_first_open')); return false; }
          if (st.turned >= NL){ ui.flash(t('learn.s.book.f_last_sheet')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.book.f_more', { n: O.page }), 2400); swap(st, ui, NL - st.turned, .7, () => finish(st)); return true; },
        last(st){ st.open = 1; st.turned = NL; } },
      close: { action(st, ui){ if (busy(st, ui)) return false; if (st.open <= 0){ ui.flash(t('learn.s.book.f_closed')); return false; }
          st.anim2 = true; const n0 = st.turned;
          kRun(st, ui, 'closeT', 2.4, u => { const b = kSeg(u, 0, .45); st.turnA = 0; st.turned = b < 1 ? n0 : 0; st._back = b; st.open = 1 - kSeg(u, .5, 1); },
            () => { st.turned = 0; st._back = 0; st.open = 0; st.closed = 1; ui.flash(t('learn.s.book.f_preset'), 2600); finish(st); }); return true; },
        last(st){ st.open = 0; st.turned = 0; st._back = 0; st.closed = 1; } }
    };
    const st0 = { open: 0, openT: -1, turned: 0, turnA: 0, turnT: -1, closeT: -1, _back: 0, anim: 0, anim2: false };
    return { step, cfg: {
      title: t('learn.book.name'), credit: false, size: [s6W, s6D, HMAX], state: st0, scene,
      stats: st => [{ label: t('learn.s.book.st_cover'), value: st.open >= 1 ? t('learn.s.book.st_open') : st.open > 0 ? t('learn.s.book.st_gap') : t('learn.s.book.st_closed') }, { label: t('learn.s.book.st_sheet'), value: String(st.turned), small: true }]
    } };
  };
})(typeof self !== 'undefined' ? self : this);
