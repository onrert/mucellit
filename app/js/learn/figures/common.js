/*
 * figures/common.js — shared helpers of the figures (Mucellit Learn, Colorfigures method).
 * LICENSE NOTE (MIT): made with the Colorfigures engine and method. MIT License. Copyright (c) 2026 April Zhu
 * (Colorfigures; iso-glow) and Tolga Cohce (iso-figure). Full text: LICENSE.
 *
 * Every figure writes a constructor Mucellit.learn.figures.<name>(o); o = the book's numbers (learn-measure.js
 * calculate(), learn.js passes it). The constructor returns { cfg, step: { <id>: { action(st, ui) -> bool (did it
 * start), last(st) } } }. cfg goes to mountFigure.
 * The measurements come from the book's numbers (learn-measure.js → Mucellit.calc); no book measurement is fixed here.
 */
'use strict';
(function (root) {
  const MC = root.Mucellit.learn, { PALS, INK, P, Dv, f, pd, rrUV, PX, on, cross, norm, vis, tone, toneI, matOf, ease, ink, fill, face, shape, line, loft, hullInk, box, rod, txM, board } = MC.cf;
  MC.figures = MC.figures || {};

  /* 2D painter's sort for parts that run along x: in the (y, z) section a line segment (a, b) or a point with a radius (a, r) */
  function xSort(items){
    const CV = MC.cf.CAM_V, L0 = Math.hypot(CV[1], CV[2]) || 1, vy = CV[1]/L0, vz = CV[2]/L0;
    const open = p => -p[0]*vz + p[1]*vy, dp = p => p[0]*vy + p[1]*vz, n = items.length;
    for (const it of items){ const b = it.b || it.a, r = it.r || 0; it._s0 = open(it.a); it._s1 = open(b);
      it._lo = Math.min(it._s0, it._s1) - r; it._hi = Math.max(it._s0, it._s1) + r; it._d = (dp(it.a) + dp(b))/2 + (it.bias || 0); }
    const dAt = (it, s) => { const b = it.b || it.a, ds = it._s1 - it._s0; if (Math.abs(ds) < 1e-7) return Math.max(dp(it.a), dp(b)) + (it.bias || 0);
      const t = Math.max(0, Math.min(1, (s - it._s0)/ds)); return dp([it.a[0] + (b[0] - it.a[0])*t, it.a[1] + (b[1] - it.a[1])*t]) + (it.bias || 0); };
    const out = Array.from({ length:n }, () => []), indeg = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++){ const A = items[i], B = items[j];
      const lo = Math.max(A._lo, B._lo), hi = Math.min(A._hi, B._hi); if (hi - lo <= 1e-4) continue;
      const m = (lo + hi)/2, da = dAt(A, m), db = dAt(B, m); if (Math.abs(da - db) < 1e-5) continue;
      if (da < db){ out[i].push(j); indeg[j]++; } else { out[j].push(i); indeg[i]++; } }
    const done = new Array(n).fill(false), order = [];
    for (let c = 0; c < n; c++){ let best = -1;
      for (let i = 0; i < n; i++) if (!done[i] && indeg[i] === 0 && (best < 0 || items[i]._d < items[best]._d)) best = i;
      if (best < 0) for (let i = 0; i < n; i++) if (!done[i] && (best < 0 || items[i]._d < items[best]._d)) best = i;
      done[best] = true; order.push(best); for (const j of out[best]) indeg[j]--; }
    return order.map(i => items[i].svg).join('');
  }
  const kOp = (op, svg) => op != null && op < 1 ? (op <= .01 ? '' : `<g opacity="${f(op)}">${svg}</g>`) : svg;
  /* a convex prism along x (section poly: an array of [y, z]); the end cap is a separate item */
  function xPrism(poly, x0, x1, m, items, o = {}){
    const sh = o.shade || toneI, cy = poly.reduce((a, p) => a + p[0], 0)/poly.length, cz = poly.reduce((a, p) => a + p[1], 0)/poly.length, faces = [];
    for (let i = 0; i < poly.length; i++){ const a = poly[i], b = poly[(i + 1) % poly.length], t = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(...t); if (tl < 1e-6) continue;
      let n = [0, -t[1]/tl, t[0]/tl]; if (n[1]*(a[0] - cy) + n[2]*(a[1] - cz) < 0) n = n.map(v => -v);
      if (!vis(n)) continue;
      const Q = [[x0, a[0], a[1]], [x1, a[0], a[1]], [x1, b[0], b[1]], [x0, b[0], b[1]]];
      faces.push({ a, b, nz: n[2], svg: o.face ? o.face(i, n, Q) : shape(Q, sh(n, m), o.w ?? 1) }); }
    const cs = vis([1, 0, 0]) ? 1 : vis([-1, 0, 0]) ? -1 : 0;
    if (cs){ const xc = cs > 0 ? x1 : x0, PQ = poly.map(p => [xc, p[0], p[1]]), CV = MC.cf.CAM_V, L0 = Math.hypot(CV[1], CV[2]) || 1;
      const open = p => (-p[0]*CV[2] + p[1]*CV[1])/L0, lo = poly.reduce((a, q) => open(q) < open(a) ? q : a), hi = poly.reduce((a, q) => open(q) > open(a) ? q : a);
      items.push({ a: lo, b: hi, bias: (o.bias || 0) + .001, svg: kOp(o.op, shape(PQ, sh([cs, 0, 0], m), o.w ?? 1) + (o.cap ? o.cap(xc, cs, PQ) : '')) }); }
    for (const fc of faces) items.push({ a: fc.a, b: fc.b, bias: o.bias || 0, svg: kOp(o.op, fc.svg) });
    return poly.flatMap(p => [[x0, p[0], p[1]], [x1, p[0], p[1]]]);
  }
  const kRect = (y0, z0, y1, z1, tr = p => p) => [[y0, z0], [y1, z0], [y1, z1], [y0, z1]].map(tr);
  const kRot = (p, h, a) => { const c = Math.cos(a), s = Math.sin(a), dy = p[0] - h[0], dz = p[1] - h[1]; return [h[0] + dy*c - dz*s, h[1] + dy*s + dz*c]; };
  const kSeg = (t, t0, t1) => ease(Math.max(0, Math.min(1, (t - t0)/(t1 - t0))));
  const kLerp = (a, b, t) => a + (b - a)*t;
  const kText = (p, U, V, str, size, col = INK, weight = 800) => `<text transform="${txM(P(...p), Dv(...U), Dv(...V))}" font-size="${size}" fill="${col}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="${weight}">${kEsc(str)}</text>`;
  const kEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const kBoxOf = pts => [[0, 1, 2].map(i => Math.min(...pts.map(p => p[i]))), [0, 1, 2].map(i => Math.max(...pts.map(p => p[i])))];
  const kPAPER = { l:'#fffdf6', m:'#ece5d4', d:'#c9bfa8' }, kEDGE = { l:'#f6f0e1', m:'#e6dcc6', d:'#bdb092' };
  const kBOARD = { l:'#b9b2a4', m:'#9c9485', d:'#6e675b' }, kMAT = { l:'#86b896', m:'#679a78', d:'#3f6b52' };
  const kMULL = { l:'#f4ecd2', m:'#e3d8b8', d:'#b9ab86' }, kTHREAD = '#c8402a';
  const kBACK = { l:'#f3ead6', m:'#e2d6bb', d:'#b9ab8a' }, kENDP = { l:'#f2e3bd', m:'#e0cd9e', d:'#b49f6c' };
  const kWOOD = { l:'#d9a86c', m:'#bf8a4f', d:'#8e6236' }, kSTEEL = { l:'#d9dee0', m:'#a9b1b4', d:'#6d7477' };
  const kBONE = { l:'#f4ecd8', m:'#ddd1b4', d:'#b3a585' }, kWAX = { l:'#f7f4e6', m:'#e6e1c9', d:'#bfb89a' };
  const kThr = (P3, w = 1.6, col = kTHREAD) => { const d = pd(P3, false);
    return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${f(w + .8)}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round"/>`; };
  function kMat(W, D, h = 4){
    let s = board(0, 0, W, D, h, 8, kMAT), g = '';
    for (let x = 20; x < W; x += 20) g += pd([[x, 6, h + .05], [x, D - 6, h + .05]], false);
    for (let y = 20; y < D; y += 20) g += pd([[6, y, h + .05], [W - 6, y, h + .05]], false);
    return s + `<path d="${g}" fill="none" stroke="#b5dcc0" stroke-width=".6" opacity=".8"/>`;
  }
  // one animation: st[key] 0..T seconds; step (u 0..1); done at the end
  function kRun(st, ui, key, T, step, done){ const id = ++st.anim; st[key] = 0;
    ui.animate(dt => { if (id !== st.anim) return false; st[key] += dt; step(Math.min(1, st[key]/T)); if (st[key] >= T){ st[key] = -1; if (done) done(); return false; } return true; }); }
  // animations in a row: [[key, T, step], ...] one after the other
  function kOrder(st, ui, list, done){ const go = i => { if (i >= list.length){ if (done) done(); return; } const [k, T, s] = list[i]; kRun(st, ui, k, T, s, () => go(i + 1)); }; go(0); }
  // bone folder: a flat bar along x0..x0+L with rounded ends
  function kBone(x0, y0, z0, L = 150, w = 22, h = 4){
    const prof = rrUV(y0, z0, y0 + w, z0 + h, 1.9, 4), x1 = x0 + L, A = on(PX(x0), prof), B = on(PX(x1), prof);
    let s = loft(A, B, n => tone(n, kBONE));
    if (vis([1, 0, 0])) s += fill(pd(B), tone([1, 0, 0], kBONE)) + ink(pd(B), .9);
    if (vis([-1, 0, 0])) s += fill(pd(A), tone([-1, 0, 0], kBONE)) + ink(pd(A), .9);
    if (vis([0, 0, 1])) s += line([[x0 + 12, y0 + w/2, z0 + h + .05], [x1 - 12, y0 + w/2, z0 + h + .05]], .5);
    return { svg: s + hullInk([...A, ...B], 1.6), box: [[x0, y0, z0], [x1, y0 + w, z0 + h]], pts: [...A, ...B] };
  }
  // brush (glue): its tip at the point (x, y, z), the handle up
  const kBrush = (x, y, z, along = 'x') => along === 'x'
    ? box(x - 8, y - 6, z, x + 8, y + 6, z + 6, matOf('#e9d9a6'), toneI, 1) + rod([x, y, z + 6], [x - 26, y, z + 36], 2.6, kWOOD, toneI, 1, 2.6, 12)
    : box(x - 60, y - 5, z, x + 60, y + 5, z + 6, matOf('#e9d9a6'), toneI, 1) + box(x - 30, y - 4, z + 6, x + 30, y + 4, z + 22, kWOOD, toneI, 1.2);

  /* ---------- book geometry (figures: endpapers, spine, cover, casing-in, press, finished book) ----------
     x = spine length, y = width, z = up; 1 unit = 1 mm. On an open (flat) case: right board RB0..RB1, joint, spine
     stiffener S0..S1, joint, left board LB0..LB1. In the model the joint gap is g = f + t: the case closes on two flat
     hinges (in reality the cloth sinks into the groove); so the square is exactly k on the closed book. With the
     block closed its spine rests against the inner face of the stiffener (S0 - t). */
  function kGeo(o, ek = {}){
    const T = o.t, g = o.f + T, BH = 4;
    const G = { T, TH: o.S, W: o.W, H: o.H, N: o.N, BH, zc: ek.zc ?? BH + .4, g, f: o.f, k: o.k, R: o.R, Db: o.Db, Dh: o.Dh, e: o.e };
    G.XB0 = 37; G.XB1 = G.XB0 + o.Dh; G.XK0 = G.XB0 + o.k; G.XK1 = G.XK0 + o.H;
    G.RB0 = ek.RB0 || 45.4; G.RB1 = G.RB0 + o.Db; G.S0 = G.RB1 + g; G.S1 = G.S0 + o.R; G.LB0 = G.S1 + g; G.LB1 = G.LB0 + o.Db;
    G.K1 = G.S0 - T; G.K0 = G.K1 - o.W;
    G.matW = G.XB1 + 37; G.matD = G.LB1 + 40;
    return G;
  }
  function kChain(G, f1, f2){ const H1 = [G.S0, G.zc], H2 = kRot([G.S1, G.zc], H1, f1);
    const R1 = p => kRot(p, H1, f1), Rl = p => kRot(kRot(p, H1, f1), H2, f2);
    return { f1, f2, H2, R1, Rl }; }
  // case: two boards + stiffener (outer face cloth; on the inner face bare board, turn-in bands: first head/tail, fore-edge on top)
  function kCaseItems(G, ch, m, items, o = {}){
    const zc = G.zc, zt = zc + G.T, op = o.op, pts = [], e = G.e;
    const inner = (spineAtB, isStrip) => (i, n, Q) => {
      if (i !== 2) return shape(Q, tone(n, m), 1);
      const at = (x, t) => [x, kLerp(Q[0][1], Q[3][1], t), kLerp(Q[0][2], Q[3][2], t)].map((v, j) => j ? v + n[j]*.05 : v);
      const tF = spineAtB ? 1 : 0, w = Math.hypot(Q[3][1] - Q[0][1], Q[3][2] - Q[0][2]), ee = e/w;
      let s = shape(Q, toneI(n, kBOARD), 1);
      const band = (x0, x1, t0, t1) => fill(pd([at(x0, t0), at(x1, t0), at(x1, t1), at(x0, t1)]), tone(n, m));
      s += band(G.XB0, G.XB0 + e, 0, 1) + band(G.XB1 - e, G.XB1, 0, 1);                       // 1. head and tail (long edges)
      if (!isStrip) s += band(G.XB0, G.XB1, tF ? 1 - ee : 0, tF ? 1 : ee) + ink(pd([at(G.XB0 + e, tF ? 1 - ee : ee), at(G.XB1 - e, tF ? 1 - ee : ee)], false), .5);   // 2. fore-edge, on top
      if (o.paste && !isStrip){ const m3 = 3/w, a0 = tF ? 0 : m3, a1 = tF ? 1 - m3 : 1;
        s += shape([at(G.XB0 + 3, a0), at(G.XB1 - 3, a0), at(G.XB1 - 3, a1), at(G.XB0 + 3, a1)], toneI(n, kENDP), .7); }
      return s; };
    pts.push(...xPrism(kRect(G.RB0, zc, G.RB1, zt), G.XB0, G.XB1, m, items, { face: inner(true), shade: tone, op, bias: o.bias }));
    pts.push(...xPrism(kRect(G.S0, zc, G.S1, zt, ch.R1), G.XB0, G.XB1, m, items, { face: (i, n, Q) => {
      let s = inner(true, true)(i, n, Q);
      if (i === 0 && o.title){ const mid = [(Q[0][1] + Q[3][1])/2 + n[1]*.1, (Q[0][2] + Q[3][2])/2 + n[2]*.1], U = [1, 0, 0], V = norm(cross(n, U));
        s += kText([(G.XB0 + G.XB1)/2, mid[0] - V[1]*1.8, mid[1] - V[2]*1.8], U, V, o.title, Math.min(5.4, G.R*.42), '#f3d98a', 800); }
      return s; }, shade: tone, op, bias: o.bias }));
    pts.push(...xPrism(kRect(G.LB0, zc, G.LB1, zt, ch.Rl), G.XB0, G.XB1, m, items, { face: (i, n, Q) => {
      let s = inner(false)(i, n, Q);
      if (i === 0 && o.title){ const a = Q[0], b = Q[3], mid = [(a[1] + b[1])/2 + n[1]*.1, (a[2] + b[2])/2 + n[2]*.1];
        const U = norm([0, b[1] - a[1], b[2] - a[2]]), V = [1, 0, 0], xm = (G.XB0 + G.XB1)/2;
        s += kText([xm - 27, mid[0], mid[1]], U, V, o.title, 13, '#f3d98a', 800) + (o.title2 ? kText([xm - 9, mid[0], mid[1]], U, V, o.title2, 7, '#f3d98a', 700) : ''); }
      return s; }, shade: tone, op, bias: o.bias }));
    // cloth at the joints (outer face cloth, inner face lining); a dark line when the groove is pressed
    for (const [p, q] of [[[G.RB1, zc - .25], [G.S0, zc - .25]], [ch.R1([G.S1, zc - .25]), ch.Rl([G.LB0, zc - .25])]]){
      const t = [q[0] - p[0], q[1] - p[1]], tl = Math.hypot(...t); let n = [0, t[1]/tl, -t[0]/tl];
      const Q = [[G.XB0, p[0], p[1]], [G.XB1, p[0], p[1]], [G.XB1, q[0], q[1]], [G.XB0, q[0], q[1]]];
      let sv = shape(Q, vis(n) ? tone(n, m) : toneI(n.map(v => -v), kBACK), .9);
      if (o.groove && vis(n)){ const mm = [(p[0] + q[0])/2, (p[1] + q[1])/2]; sv += `<g opacity="${f(o.groove)}">${line([[G.XB0 + 2, mm[0] + n[1]*.1, mm[1] + n[2]*.1], [G.XB1 - 2, mm[0] + n[1]*.1, mm[1] + n[2]*.1]], 1.6)}</g>`; }
      items.push({ a: p, b: q, bias: (o.bias || 0) - .01, svg: kOp(op, sv) }); }
    return pts;
  }
  // block: top/bottom endpaper, spine (mull), fore-edge, head/tail sections. tr: section transform (turning over), N signature layers.
  function kBlockItems(G, y0, z0, items, o = {}){
    const TH = o.th || G.TH, W = G.W, y1 = y0 + W, z1 = z0 + TH, k = o.k || 0, N = G.N, tr = o.tr || (p => p);
    const lines = (at, n) => { let d = ''; for (let j = 1; j < N; j++) d += pd([at(G.XK0 + 6, j/N), at(G.XK1 - 6, j/N)], false); return d; };
    const face = (i, n, Q) => {
      const at = (x, t) => [x, kLerp(Q[0][1], Q[3][1], t) + n[1]*.05, kLerp(Q[0][2], Q[3][2], t) + n[2]*.05];
      if (i === 1){ let s = shape(Q, toneI(n, o.mull === false ? kPAPER : kMULL), 1);
        return s + `<path d="${lines(at, n)}" fill="none" stroke="#a89a78" stroke-width=".35"/>`; }
      if (i === 3){ let s = shape(Q, toneI(n, kEDGE), 1), d = ''; for (let j = 1; j < N; j++) d += pd([at(G.XK0, j/N), at(G.XK1, j/N)], false);
        return s + `<path d="${d}" fill="none" stroke="#b9ad92" stroke-width=".3"/>`; }
      const fz = i === 2 ? (o.endpaperTop ?? o.endpapers) : (o.endpaperBottom ?? o.endpapers);
      let s = shape(Q, toneI(n, fz === false ? kPAPER : kENDP), 1);
      if (i === 2 && o.mull !== false && o.mullKanat !== false){
        const w = Math.hypot(Q[3][1] - Q[0][1], Q[3][2] - Q[0][2]), ee = 25/w;
        s += `<g opacity=".75">${fill(pd([at(G.XK0 + 6, 0), at(G.XK1 - 6, 0), at(G.XK1 - 6, ee), at(G.XK0 + 6, ee)]), toneI(n, kMULL))}</g>`; }
      if (i === 0 && o.mull !== false && o.mullKanat !== false){
        const w = Math.hypot(Q[3][1] - Q[0][1], Q[3][2] - Q[0][2]), ee = 25/w;
        s += `<g opacity=".75">${fill(pd([at(G.XK0 + 6, 1 - ee), at(G.XK1 - 6, 1 - ee), at(G.XK1 - 6, 1), at(G.XK0 + 6, 1)]), toneI(n, kMULL))}</g>`; }
      if (i === 2 && o.glue > 0) s += `<path d="${pd([at(G.XK0, 1), at(G.XK1, 1), at(G.XK1, 1 - o.glue), at(G.XK0, 1 - o.glue)])}" fill="#fff6c8" opacity=".6"/>`;
      if (i === 0 && o.glueAlt > 0) s += `<path d="${pd([at(G.XK0, 0), at(G.XK1, 0), at(G.XK1, o.glueAlt), at(G.XK0, o.glueAlt)])}" fill="#fff6c8" opacity=".6"/>`;
      if (o.text) s += o.text(i, at, n);
      return s; };
    const cap = (xc, cs) => { const at = (y, z) => { const q = tr([y, z]); return [xc + cs*.06, q[0], q[1]]; }; let d = '', a = '';
      for (let j = 1; j < N; j++){ const z = z0 + TH*j/N; d += pd([at(y0 + .5, z), at(y1 - .6, z)], false); }
      for (let j = 0; j < N; j++){ const za = z0 + TH*j/N + .03, zb = za + TH/N - .06;
        a += pd([at(y1 - 1.2, za), at(y1 - .4, za + .02), at(y1 - .1, (za + zb)/2), at(y1 - .4, zb - .02), at(y1 - 1.2, zb)], false); }
      let s = `<path d="${d}" fill="none" stroke="#b9ad92" stroke-width=".3"/><path d="${a}" fill="none" stroke="#6b604a" stroke-width=".4"/>`;
      if (k > 0){ let th = ''; for (let j = 0; j < N; j++){ const zm = z0 + TH*(j + .5)/N; th += pd([at(y1 - .9, zm - .15), at(y1 - .9, zm + .15)], false); }
        s += `<g opacity="${f(k)}"><path d="${th}" fill="none" stroke="${kTHREAD}" stroke-width=".9" stroke-linecap="round"/></g>`; }
      return s; };
    const pts = xPrism(kRect(y0, z0, y1, z1, tr), G.XK0, G.XK1, kPAPER, items, { face, cap, op: o.op });
    if (o.headbands !== false) for (const x of [G.XK0 + 1.5, G.XK1 - 1.5]){
      const A = tr([y1 + 1.2, z0 + .3]), B = tr([y1 + 1.2, z1 - .3]);
      const sv = rod([x, A[0], A[1]], [x, B[0], B[1]], 1.4, o.m || PALS.tomato, toneI, .8, 1.4, 10);
      items.push({ a: A, b: B, r: 1.4, bias: .02, svg: kOp(o.op, sv) }); }
    return pts;
  }

  // sewing marks on the spine: on every signature the outside stitches (holes 1-2, 3-4, …) and the kettle chain at both ends. at(x, t): a
  // point on the spine face (t 0..1 across the thickness), ST: x positions of the holes, N: number of signatures
  function kSpineSewing(at, N, ST, w = .9){
    let s = '';
    for (let j = 0; j < N; j++){ const tm = (j + .5)/N;
      for (let q = 1; q + 1 < ST.length - 1; q += 2) s += kThr([at(ST[q], tm), at(ST[q + 1], tm)], w); }
    for (const x of [ST[0], ST[ST.length - 1]]) s += kThr([at(x, Math.min(.5, .5/N)), at(x, 1 - Math.min(.5, .5/N))], w);
    return s;
  }

  MC.common = { kSpineSewing, xSort, kOp, xPrism, kRect, kRot, kSeg, kLerp, kText, kEsc, kBoxOf, kThr, kMat, kRun, kOrder, kBone, kBrush, kGeo, kChain, kCaseItems, kBlockItems,
    color: { kPAPER, kEDGE, kBOARD, kMAT, kMULL, kTHREAD, kBACK, kENDP, kWOOD, kSTEEL, kBONE, kWAX } };
})(typeof self !== 'undefined' ? self : this);
