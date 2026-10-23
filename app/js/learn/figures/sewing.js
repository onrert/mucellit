/*
 * figures/sewing.js — Aşama 2 (delme) ve 3 (dikiş): delik şablonu, bız, bütün formaların dikişi, kare düğüm, kettle stitch.
 * LİSANS NOTU (MIT): Colorfigures motoru ve yöntemiyle yapıldı (ilk sürüm: Öğren prototipi, Şekil 2).
 * MIT License. Copyright (c) 2026 April Zhu (Colorfigures; iso-glow) ve Tolga Cohce (iso-figure). Tam metin: LICENSE.
 *
 * Gerçekte nasıl (Cockerell satır 1918-1936; Brighton-kettle; Talas-guide):
 *  1. Katlanmış forma açılıp V delme beşiğine oturtulur; delik şablonu katın dibine konur; bız her işaretten katın
 *     içinden dışa batırılır. Delikler: uçlardan ~15 mm (kettle delikleri) + aradakiler, çift sayıda (learn-measure.js).
 *  2. 1. forma: baştaki kettle deliğinden dışarıdan girilir, içeri-dışarı öteki uca gidilir; ucu dışarıda kalır.
 *  3. 2. forma üstüne konur, ters yönde dikilir; başlangıç ucunda iplik 1. formanın ucuyla KARE DÜĞÜMLE bağlanır
 *     (kettle değil).
 *  4. 3. formadan itibaren her formanın ucunda iğne alttaki iki formanın arasından, aradaki dikişin arkasından geçirilip
 *     ilmekten çekilir: kettle stitch. Uçlarda küçük bir zincir oluşur. Sonda kettle iki kez atılır.
 * Basitleştirme: 4. formadan sonrakiler kapalı iner ve hızlı dikilir (temsilî zincir); 12'den çok formada ilk 12 çizilir.
 * Koordinat: x = sırt boyu (baş fdXA, kuyruk fdXA + H), y = genişlik (+y izleyicinin solu), z = yukarı; 1 birim = 1 mm.
 * Kâğıt arası büyütüldü (2,2 mm'ye kadar; çok formada küçülür), yoksa kâğıtlar tek çizgi görünür.
 * PARÇALAR: kesme altlığı · beşik (iki eğik tahta, iki uç plakası) · formalar (her biri y kâğıt) · şablon · bız ·
 *   delikler · iplik (uç, dış dikiş, iç dikiş, bağlantılar, kare düğüm, kettle ilmekleri) · iğne.
 * ÇİZİM: x boyunca uzanan her şey (y, z) kesitinde 2B ressam sıralamasıyla (xSort); uç plakaları byDepth.
 */
'use strict';
(function (root) {
  const MC = root.Mucellit.learn, { METAL, INK, WOOD, P, P0, depthOf, byDepth, f, pd, sp, on, sub, norm, vis, tone, toneI, matOf, ease, ink, fill, face, shape, hullInk, box, rod, boardTop, board, xrCallouts } = MC.cf;
  MC.figures.sewing = function (o) {
    const { xSort, kBoxOf, kRun, kOrder, kLerp, kSeg, color } = MC.common, O = o.size, t = o.t;
    const fdPAPER = color.kPAPER, fdMAT = color.kMAT, fdTHREAD = color.kTHREAD, fdCARD = '#f4e3a8';
    const fdBRASS = { l:'#f1d27a', m:'#cfa94a', d:'#8a6a22' }, fdHANDLE = { l:'#c98a55', m:'#a86b3c', d:'#6e4423' };
    const NY = O.y, N = O.N, NS = Math.min(N, 12), HH = O.H, fdL = O.W;
    const fdBH = 4, fdXA = 25, fdXB = fdXA + HH, fdST = O.station.position.map(v => fdXA + v), NST = fdST.length;
    const fdRM = .9, fdGAP = 1.6;
    const fdG = NY > 1 ? Math.max(.45, Math.min(2.2, ((190/NS - fdGAP)/2 - fdRM)/(NY - 1))) : 0;
    const fdRO = fdRM + (NY - 1)*fdG;
    const fdS0 = 7, fdS1 = Math.max(80, fdL*.72), fdT = 10, fdYC = 43 + fdS1*Math.SQRT1_2, fdZV = fdBH + 30;
    const fdCC = [fdYC, fdZV + fdRO*Math.SQRT2];
    const fdYA = fdYC + (fdS1 + 12)*Math.SQRT1_2 + 46 + fdL;
    const fdZ = i => fdBH + fdRO + .5 + i*(2*fdRO + fdGAP);               // i. formanın yığındaki kat merkezi (z)
    const fdBW = HH + 50, fdBD = fdYA + 30, fdH = Math.max(200, fdZ(NS - 1) + fdRO + 30);

    /* ---------- forma kesiti ---------- */
    function fdFrame(c, tb){ const w = [Math.cos(tb), Math.sin(tb)], u = [Math.sin(tb), -Math.cos(tb)];
      return { c, w, u, at: ([pu, pw]) => [c[0] + u[0]*pu + w[0]*pw, c[1] + u[1]*pu + w[1]*pw] }; }
    function fdSheet(r, alpha, F, Lh = fdL, rough = false){
      const h = alpha/2, s = Lh - r*(Math.PI - alpha)/2, d1 = [Math.sin(h), Math.cos(h)], d2 = [-Math.sin(h), Math.cos(h)];
      const a0 = -h, a1 = h - Math.PI, n = Math.max(2, Math.ceil((a0 - a1)/(Math.PI/(rough ? 6 : 12)))), loc = [];
      const t1 = [r*Math.cos(a0), r*Math.sin(a0)], t2 = [r*Math.cos(a1), r*Math.sin(a1)];
      loc.push([t1[0] + d1[0]*s, t1[1] + d1[1]*s]);
      for (let k = 0; k <= n; k++){ const a = a0 + (a1 - a0)*k/n; loc.push([r*Math.cos(a), r*Math.sin(a)]); }
      loc.push([t2[0] + d2[0]*s, t2[1] + d2[1]*s]);
      return loc.map(F.at);
    }
    function fdSigItems(F, alpha, k, items, pts, rough){
      for (let j = 0; j < NY; j++){
        const op = 1 - (.9 - .2*j/Math.max(1, NY - 1))*k;
        const sp = fdSheet(fdRM + (NY - 1 - j)*fdG, alpha, F, fdL, rough), nSeg = sp.length - 1;
        // kapalı ve altta kalan formada iç kâğıtların kıvrımı dıştaki kâğıdın içinde görünmez: yalnız iki düz yaprak (hız)
        const onlyLeg = rough && j > 0 && k < .05;
        for (let q = 0; q < nSeg; q++){
          if (onlyLeg && q > 0 && q < nSeg - 1) continue;
          const a = sp[q], b = sp[q + 1], tv = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(...tv); if (tl < 1e-6) continue;
          const n1 = [0, -tv[1]/tl, tv[0]/tl], seen = vis(n1) ? n1 : n1.map(v => -v);
          const Q = [[fdXA, a[0], a[1]], [fdXB, a[0], a[1]], [fdXB, b[0], b[1]], [fdXA, b[0], b[1]]];
          // (WebKit boyama yükü): bir dilimin mürekkep çizgileri tek path (aynı kalınlık, aynı görünüm)
          let d = pd([Q[0], Q[3]], false) + pd([Q[1], Q[2]], false);
          if (q === 0) d += pd([Q[0], Q[1]], false);
          if (q === nSeg - 1) d += pd([Q[3], Q[2]], false);
          const sv = face(pd(Q), tone(seen, fdPAPER)) + ink(d, 1);
          items.push({ a, b, svg: op < 1 ? `<g opacity="${f(op)}">${sv}</g>` : sv });
          pts.push(...Q);
        }
      }
    }
    const fdSpine = (F, off) => [F.c[0] - F.w[0]*(fdRO + off), F.c[1] - F.w[1]*(fdRO + off)];
    const fdInner = (F, off = .3) => [F.c[0] - F.w[0]*off, F.c[1] - F.w[1]*off];

    /* ---------- beşik ---------- */
    const FD_CR = [1, -1].map(sg => {
      const V0 = [fdYC, fdZV], d = [sg*Math.SQRT1_2, Math.SQRT1_2], nO = [sg*Math.SQRT1_2, -Math.SQRT1_2];
      const TI = [V0[0] + d[0]*fdS0, V0[1] + d[1]*fdS0], TO = [V0[0] + d[0]*fdS1, V0[1] + d[1]*fdS1];
      const BI = [TI[0] + nO[0]*fdT, TI[1] + nO[1]*fdT], BO = [TO[0] + nO[0]*fdT, TO[1] + nO[1]*fdT];
      return { slab: [TI, TO, BO, BI], plate: [[TI[0], fdBH], [BO[0], fdBH], BO, TO, TI] }; });
    function fdPrismX(poly, x0, x1, m){
      let s = ''; const cen = poly.reduce((a, p) => [a[0] + p[0]/poly.length, a[1] + p[1]/poly.length], [0, 0]);
      for (let i = 0; i < poly.length; i++){ const a = poly[i], b = poly[(i + 1) % poly.length], tv = [b[0] - a[0], b[1] - a[1]];
        let n = [0, -tv[1], tv[0]]; if (n[1]*(a[0] - cen[0]) + n[2]*(a[1] - cen[1]) < 0) n = n.map(v => -v);
        if (vis(n)) s += shape([[x0, a[0], a[1]], [x1, a[0], a[1]], [x1, b[0], b[1]], [x0, b[0], b[1]]], toneI(norm(n), m), .9); }
      const cap = vis([1, 0, 0]) ? [x1, [1, 0, 0]] : vis([-1, 0, 0]) ? [x0, [-1, 0, 0]] : null;
      if (cap) s += shape(poly.map(p => [cap[0], p[0], p[1]]), toneI(cap[1], m), 1.1);
      return s + hullInk([...poly.map(p => [x0, p[0], p[1]]), ...poly.map(p => [x1, p[0], p[1]])], 1.8);
    }
    function fdCradleItems(items, pts, op = 1){
      const x0 = fdXA - 6, x1 = fdXB + 6;
      for (const sd of FD_CR){ const P4 = sd.slab, cen = [(P4[0][0] + P4[2][0])/2, (P4[0][1] + P4[2][1])/2];
        for (let i = 0; i < 4; i++){ const a = P4[i], b = P4[(i + 1) % 4], tv = [b[0] - a[0], b[1] - a[1]];
          let n = [0, -tv[1], tv[0]]; if (n[1]*(a[0] - cen[0]) + n[2]*(a[1] - cen[1]) < 0) n = n.map(v => -v);
          if (!vis(n)) continue;
          items.push({ a, b, svg: kOpI(op, shape([[x0, a[0], a[1]], [x1, a[0], a[1]], [x1, b[0], b[1]], [x0, b[0], b[1]]], toneI(norm(n), WOOD), 1.1)) }); }
        for (const p of P4) pts.push([x0, p[0], p[1]], [x1, p[0], p[1]]); }
    }

    /* ---------- iplik yolu ----------
       düğüm: [i, 'out'|'in', s] (i. forma, sırtta dışarıda / katın içinde, s. delik) ya da özel adlar. Bütün dikiş tek yol;
       her adım st.ip'i (yolun kaçıncı düğümüne kadar çizildiği) ilerletir. son[i]: i. formanın bittiği düğüm sayısı. */
    const asc = [...Array(NST).keys()], desc = asc.slice().reverse();
    const path = [], last = [];
    const pairs = (i, order) => order.forEach((s, k) => { if (k % 2 === 0) path.push([i, 'out', s], [i, 'in', s]); else path.push([i, 'in', s], [i, 'out', s]); });
    path.push(['tail']); pairs(0, asc); last[0] = path.length;
    if (N >= 2){ pairs(1, desc); path.push(['gap', 1, 0], ['knot', 1, 0]); last[1] = path.length; }
    for (let i = 2; i < NS; i++){
      const order = i % 2 === 0 ? asc : desc, s0 = order[0], s1 = order[NST - 1];
      path.push(['up', i, s0]); pairs(i, order); path.push(['drop', i, s1], ['gapK', i, s1], ['kn', i, s1]); last[i] = path.length; }
    const LAST = NS - 1, SONS = LAST % 2 === 0 ? NST - 1 : 0;
    if (N >= 3) path.push(['drop2', LAST, SONS], ['gapK2', LAST, SONS], ['kn2', LAST, SONS]);
    const PATH_BIT = path.length;

    /* ---------- forma yerleri ---------- */
    function fdFrameB(st){
      const mv = st.moveT < 0 ? (st.placed ? 1 : 0) : st.moveT, lift = 95;
      let c, tb;
      if (mv <= 0){ c = fdCC; tb = Math.PI/2; }
      else if (mv < .25){ const u = kSeg(mv, 0, .25); c = [fdCC[0], fdCC[1] + lift*u]; tb = Math.PI/2; }
      else if (mv < .7){ const u = kSeg(mv, .25, .7); c = [kLerp(fdCC[0], fdYA, u), fdCC[1] + lift]; tb = Math.PI/2 + u*Math.PI/4; }
      else { const u = kSeg(mv, .7, 1); c = [fdYA, kLerp(fdCC[1] + lift, fdZ(1), u)]; tb = 3*Math.PI/4; }
      const alpha = st.placed && st.moveT < 0 ? st.alpha[1] : Math.PI/2;
      if (st.placed && st.moveT < 0) tb = Math.PI - alpha/2;
      return { F: fdFrame(c, tb), alpha };
    }
    function fdFrameI(st, i){
      if (i === 0) return { F: fdFrame([fdYA, fdZ(0)], Math.PI), alpha: 0 };
      if (i === 1) return fdFrameB(st);
      const dr = st.drop[i]; if (!(dr > 0)) return null;
      const a = st.alpha[i], dz = 80*(1 - ease(Math.min(1, dr)));
      return { F: fdFrame([fdYA, fdZ(i) + dz], Math.PI - a/2), alpha: a };
    }
    function fdNode(nd, FR){
      const k = nd[0], ST = s => fdST[s];
      // iplik ucu altlığa inmez; 1. formanın sırtında, kettle deliğinin dışında kısa bir uç olarak kalır
      if (k === 'tail') return [fdST[0] - 9, fdYA + fdRO + 7, fdZ(0) - .5];
      if (k === 'rest0') return [fdST[NST - 1] - 4, fdYA + 22, fdBH + .7];
      if (k === 'restE') return [fdXB - 30, fdYA + 24, fdBH + .7];
      const i = nd[1], s = nd[2], sg = s === 0 ? 1 : -1;
      if (typeof k === 'number'){ const F = FR[k].F; return [ST(s), ...(nd[1] === 'out' ? fdSpine(F, .5) : fdInner(F))]; }
      if (k === 'gap') return [ST(s) + 3, fdYA + 2.2, fdZ(0) + fdRO + .8];
      if (k === 'knot') return [ST(s), ...fdSpine(FR[0].F, 1.3)];
      if (k === 'up') return [ST(s), fdYA + fdRO + 2.2, fdZ(i - 1)];
      if (k === 'drop' || k === 'drop2') return [ST(s) + sg*(k === 'drop2' ? 3.5 : 1.5), fdYA + fdRO + 2.2, fdZ(i - 1)];
      if (k === 'gapK' || k === 'gapK2') return [ST(s) + sg*(k === 'gapK2' ? 5 : 3), fdYA + 2.2, fdZ(i - 2) + fdRO + .8];
      if (k === 'kn' || k === 'kn2') return [ST(s) + sg*(k === 'kn2' ? 4 : 1.5), ...fdSpine(FR[i - 1].F, 1.3)];
      return [0, 0, 0];
    }
    const fdThr = (P3, w = 2.6) => { const d = pd(P3, false);
      return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${f(w + .9)}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${fdTHREAD}" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round"/>`; };
    function fdThreadItems(upto, FR, items, inner){
      let last = null;
      for (let i = 0; i + 1 < path.length; i++){
        const a = path[i], b = path[i + 1], seg = Math.min(1, Math.max(0, upto - i)); if (seg <= 0) break;
        const pa = fdNode(a, FR), pb0 = fdNode(b, FR), pb = pa.map((v, q) => kLerp(v, pb0[q], seg));
        const hole = typeof a[0] === 'number' && typeof b[0] === 'number' && a[0] === b[0] && a[2] === b[2] && a[1] !== b[1];
        last = { p: pb, dir: norm(sub(pb0, pa)), hole };
        if (hole) continue;
        const same = Math.hypot(pa[1] - pb[1], pa[2] - pb[2]) < 1e-3;
        if (inner && a[1] === 'in' && b[1] === 'in') inner.push(fdThr([pa, pb]));
        items.push(same ? { a: [pa[1], pa[2]], r: .6, bias: .05, svg: fdThr([pa, pb]) } : { a: [pa[1], pa[2]], b: [pb[1], pb[2]], bias: .05, svg: fdThr([pa, pb]) });
      }
      return last;
    }
    function fdNeedle(p, dir){
      const type = [p[0] + dir[0]*46, p[1] + dir[1]*46, p[2] + dir[2]*46], eye = [p[0] - dir[0]*1.5, p[1] - dir[1]*1.5, p[2] - dir[2]*1.5];
      return rod(eye, type, .55, METAL, toneI, .8, .12, 10) + `<circle cx="${f(P(...p)[0])}" cy="${f(P(...p)[1])}" r=".55" fill="${INK}"/>`;
    }

    /* ---------- bız ---------- */
    function fdAwl(type, end){
      const d = norm(sub(end, type)), at = l => [type[0] + d[0]*l, type[1] + d[1]*l, type[2] + d[2]*l];
      const parts = [rod(type, at(52), .15, METAL, toneI, .8, 1.3, 10), rod(at(52), at(59), 3.6, fdBRASS, toneI, 1, 4.4, 14),
        rod(at(59), at(132), 6.5, fdHANDLE, toneI, 1.2, 7.6, 16), rod(at(132), at(140), 7.6, fdHANDLE, toneI, 1.2, 5, 16)];
      return depthOf(type) > depthOf(end) ? parts.reverse().join('') : parts.join('');
    }
    const YR = fdYC + fdS1*.9 + 20;   // bızın dinlenme yeri (beşik ile yığın arası)
    const FD_AWL_REST = { type: [fdXA + 70, YR, fdBH + 7.7], end: [fdXA + 210, YR, fdBH + 7.7] };
    const PER = .5, P0 = 1.6, FD_PUNCH_END = P0 + NST*PER + 1.6;
    function fdAwlPose(st){
      const tt = st.punchT, R = FD_AWL_REST, up = (y, x, zt) => ({ type: [x, y, zt], end: [x, y, zt + 140] });
      if (tt < 0) return R;
      const top = fdCC[1] + 118, hover = fdCC[1] + 26, pierce = fdCC[1] - fdRO - 2.5, stand = up(YR, fdXA + 70, fdBH + 30);
      const mix3 = (A, B, u) => ({ type: A.type.map((v, i) => kLerp(v, B.type[i], u)), end: A.end.map((v, i) => kLerp(v, B.end[i], u)) });
      if (tt < .5) return mix3(R, stand, kSeg(tt, 0, .5));
      if (tt < .8) return mix3(stand, up(YR, fdST[0], top), kSeg(tt, .5, .8));
      if (tt < 1.3) return mix3(up(YR, fdST[0], top), up(fdYC, fdST[0], top), kSeg(tt, .8, 1.3));
      if (tt < 1.6) return mix3(up(fdYC, fdST[0], top), up(fdYC, fdST[0], hover), kSeg(tt, 1.3, 1.6));
      if (tt < P0 + NST*PER){ const i = Math.floor((tt - P0)/PER), u = (tt - P0 - i*PER)/PER;
        const x = i > 0 && u < .3 ? kLerp(fdST[i - 1], fdST[i], ease(u/.3)) : fdST[i];
        const z = u < .3 ? hover : u < .6 ? kLerp(hover, pierce, ease((u - .3)/.3)) : kLerp(pierce, hover, ease((u - .6)/.4));
        return up(fdYC, x, z); }
      const T2 = P0 + NST*PER;
      if (tt < T2 + .3) return mix3(up(fdYC, fdST[NST - 1], hover), up(fdYC, fdST[NST - 1], top), kSeg(tt, T2, T2 + .3));
      if (tt < T2 + .8) return mix3(up(fdYC, fdST[NST - 1], top), up(YR, fdXA + 70, top), kSeg(tt, T2 + .3, T2 + .8));
      if (tt < T2 + 1.1) return mix3(up(YR, fdXA + 70, top), stand, kSeg(tt, T2 + .8, T2 + 1.1));
      return mix3(stand, R, kSeg(tt, T2 + 1.1, T2 + 1.6));
    }
    function fdTemplateItems(F, alpha, lift, items){
      const sp = fdSheet(fdRM - .45, alpha, F, (Math.PI - alpha)/2*(fdRM - .45) + 15).map(p => [p[0], p[1] + lift]);
      for (let q = 0; q + 1 < sp.length; q++){ const a = sp[q], b = sp[q + 1], tv = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(...tv); if (tl < 1e-6) continue;
        const n1 = [0, -tv[1]/tl, tv[0]/tl], seen = vis(n1) ? n1 : n1.map(v => -v);
        let sv = face(pd([[fdXA + 2, a[0], a[1]], [fdXB - 2, a[0], a[1]], [fdXB - 2, b[0], b[1]], [fdXA + 2, b[0], b[1]]]), toneI(seen, matOf(fdCARD)));
        sv += ink(pd([[fdXA + 2, a[0], a[1]], [fdXA + 2, b[0], b[1]]], false), .8) + ink(pd([[fdXB - 2, a[0], a[1]], [fdXB - 2, b[0], b[1]]], false), .8);
        if (q === 0 || q === sp.length - 2){
          const e = q === 0 ? a : b, oo = [seen[1]*.08, seen[2]*.08];
          let tk = ''; for (const x of fdST) tk += pd([[x, a[0] + oo[0], a[1] + oo[1]], [x, b[0] + oo[0], b[1] + oo[1]]], false);
          sv += `<path d="${tk}" fill="none" stroke="${INK}" stroke-width=".9"/>` + ink(pd([[fdXA + 2, e[0], e[1]], [fdXB - 2, e[0], e[1]]], false), .8); }
        items.push({ a, b, bias: .02, svg: sv }); }
    }
    function fdHoleItems(F, n, items){
      for (let i = 0; i < n; i++){ const oo = fdSpine(F, .15), ii = fdInner(F, fdRM - .2), nOut = [0, -F.w[0], -F.w[1]];
        if (vis(nOut)){ const q = P(fdST[i], ...oo); items.push({ a: oo, r: .4, bias: .04, svg: `<ellipse cx="${f(q[0])}" cy="${f(q[1])}" rx="1.9" ry="1.9" fill="${INK}"/>` }); }
        if (vis(nOut.map(v => -v))){ const q = P(fdST[i], ...ii); items.push({ a: ii, r: .4, bias: .04, svg: `<ellipse cx="${f(q[0])}" cy="${f(q[1])}" rx="1.7" ry="1.7" fill="${INK}"/>` }); } }
    }
    const isNode = (p, r = 2.3) => { const Q = P(...p); return `<circle cx="${f(Q[0])}" cy="${f(Q[1])}" r="${r}" fill="${fdTHREAD}" stroke="${INK}" stroke-width="1"/>`; };
    // kaç forma dikildi (iplik yolu ilerlemesine göre)
    const lastSewn = st => { let n = 0; for (let i = 0; i < NS; i++) if (last[i] && st.ip >= last[i] - .05) n = i + 1; return n === NS && N > NS ? N : n; };

    function fdScene(st, m){
      const k = ease(st.xr || 0);
      let s = board(0, 0, fdBW, fdBD, fdBH, 8, fdMAT);
      let g = ''; for (let x = 20; x < fdBW; x += 20) g += pd([[x, 6, fdBH + .05], [x, fdBD - 6, fdBH + .05]], false);
      for (let y = 20; y < fdBD; y += 20) g += pd([[6, y, fdBH + .05], [fdBW - 6, y, fdBH + .05]], false);
      s += `<path d="${g}" fill="none" stroke="#b5dcc0" stroke-width=".6" opacity=".8"/>`;
      const items = [], ptsCr = [], ptsSt = [], ptsB = [], FR = [];
      const gop = 1 - .65*k;   // içini görde beşik, uç plakaları ve bız soluk (etiketler yığına ait)
      fdCradleItems(items, ptsCr, gop);
      for (let i = 0; i < NS; i++){ const fr = fdFrameI(st, i); FR[i] = fr; if (!fr) continue;
        const rough = i !== 1 && fr.alpha < .01 && i < NS - 2;
        fdSigItems(fr.F, fr.alpha, k, items, i === 1 ? ptsB : ptsSt, rough);
        fdHoleItems(fr.F, i === 1 ? st.holes : NST, items); }
      st._drawn = FR.filter(Boolean).length;          // test: figürde çizilen forma sayısı
      const FB = FR[1] && FR[1].F;
      if (FB && st.tmpl > 0) fdTemplateItems(FB, FR[1].alpha, (1 - st.tmpl)*70, items);
      // iplik + iğne
      const innerThr = []; let ndl = null;
      if (st.thread > 0){
        const op = Math.min(1, st.thread);
        if (st.ip > 0){ const head = fdThreadItems(st.ip, FR, items, innerThr);
          if (st.ipT >= 0 && head) ndl = { p: head.p, dir: head.hole ? [Math.sign(head.dir[0]) || 1, 0, 0] : head.dir };
          else if (st.ip < PATH_BIT - .01){ const e = fdNode(path[Math.max(0, Math.round(st.ip) - 1)], FR), p = [e[0], e[1] + 8, e[2] + 4];
            items.push({ a: [e[1], e[2]], b: [p[1], p[2]], bias: .05, svg: fdThr([e, p]) }); ndl = { p, dir: [0, .35, 1] }; }
          else { // dikiş bitti: iplik düğümden kısa kesilir, iğne altlıkta (iplik yığından altlığa inmez)
            const e = fdNode(path[PATH_BIT - 1], FR), c = [e[0] - 3, e[1] + 6, e[2] + 1];
            items.push({ a: [e[1], e[2]], b: [c[1], c[2]], bias: .05, svg: fdThr([e, c]) }); ndl = { p: fdNode(['restE'], FR), dir: [-1, 0, 0] }; } }
        else { const a = fdNode(['tail'], FR), b = fdNode(['rest0'], FR); items.push({ a: [a[1], a[2]], b: [b[1], b[2]], bias: .05, svg: kOpI(op, fdThr([a, [a[0] + 30, a[1] + 4, a[2]], b])) }); ndl = { p: b, dir: [-1, 0, 0] }; }
        if (Math.abs(ndl.dir[0]) < .5 && st.ipT >= 0) ndl.dir = [ndl.dir[0] >= 0 ? .3 : -.3, ndl.dir[1], ndl.dir[2]];
        const dd = norm(ndl.dir); items.push({ a: [ndl.p[1], ndl.p[2]], b: [ndl.p[1] + dd[1]*46, ndl.p[2] + dd[2]*46], r: .6, bias: .08, svg: kOpI(op, fdNeedle(ndl.p, dd)) });
        // düğümler: kare düğüm (1→2) ve kettle ilmekleri
        if (N >= 2 && st.ip >= last[1] - .05){ const q = fdNode(['knot', 1, 0], FR); items.push({ a: [q[1], q[2]], r: 1.6, bias: .1, svg: isNode(q, 2.6) }); }
        for (let i = 2; i < NS; i++) if (st.ip >= last[i] - .05){ const q = fdNode(path[last[i] - 1], FR); items.push({ a: [q[1], q[2]], r: 1.6, bias: .1, svg: isNode(q, 2) }); }
        if (N >= 3 && st.ip >= PATH_BIT - .05){ const q = fdNode(path[PATH_BIT - 1], FR); items.push({ a: [q[1], q[2]], r: 1.6, bias: .1, svg: isNode(q, 2) }); }
      }
      // bız
      const aw = fdAwlPose(st);
      items.push({ a: [aw.type[1], aw.type[2]], b: [aw.end[1], aw.end[2]], r: 6, svg: kOpI(gop, fdAwl(aw.type, aw.end)) });
      // gölgeler
      const clip = boardTop(0, 0, fdBW, fdBD, fdBH, 8), plates = [];
      for (const sd of FD_CR) for (const x of [[fdXA - 16, fdXA - 6], [fdXB + 6, fdXB + 16]]) plates.push({ poly: sd.plate, x });
      const ptsPl = plates.flatMap(p => p.poly.flatMap(q => [[p.x[0], q[0], q[1]], [p.x[1], q[0], q[1]]]));
      const bInCradle = FB && FB.c[0] < (fdYC + fdYA)/2;
      const all = [...ptsCr, ...ptsSt, ...ptsB, aw.type, aw.end];
      const xb = kBoxOf(all); xb[0][0] = fdXA - 6 + 1e-3; xb[1][0] = fdXB + 6 - 1e-3;
      const xin = k > 0 && innerThr.length ? `<g opacity="${f(.85*k)}">${innerThr.join('')}</g>` : '';
      s += byDepth([{ box: xb, svg: xSort(items) + xin },
        ...plates.map(p => ({ box: [[p.x[0], Math.min(...p.poly.map(q => q[0])), fdBH], [p.x[1], Math.max(...p.poly.map(q => q[0])), Math.max(...p.poly.map(q => q[1]))]], svg: kOpI(gop, fdPrismX(p.poly, p.x[0], p.x[1], WOOD)) }))]);
      // etiketler
      const LB = [], spA = fdSpine(FR[0].F, 0), sewn = lastSewn(st);
      const hasSquare = N >= 2 && st.ip >= last[1] - .05, ketVar = NS >= 3 && st.ip >= last[2] - .05;
      if (k > .6){
        LB.push({ at: [(fdST[0] + fdST[1])/2, ...fdInner(FR[0].F)], text: t('learn.s.sewing.inner_sewing'), on: false });
        if (st.ip > 0) LB.push({ at: [(fdST[1] + fdST[2])/2, ...fdSpine(FR[0].F, .5)], text: t('learn.s.sewing.outer_sewing'), on: false });
        if (hasSquare) LB.push({ at: fdNode(['knot', 1, 0], FR), text: t('learn.s.sewing.square_knot'), on: false });
        if (ketVar) LB.push({ at: fdNode(path[last[2] - 1], FR), text: t('learn.s.sewing.kettle'), on: st.ipT >= 0 });
        if (FB && !st.placed) LB.push({ at: [fdST[Math.floor(NST/2)], ...fdSpine(FB, 0)], text: t('learn.s.sewing.holes', { a: st.holes, n: NST }), on: st.punchT >= 0 });
        if (st.thread > 0) LB.push({ at: fdNode(['tail'], FR), text: t('learn.s.sewing.uc'), on: false });
      } else {
        LB.push({ at: [fdXA + 30, ...spA], text: sewn >= 1 ? t('learn.s.sewing.signature_sewn', { n: 1 }) : t('learn.s.sewing.signature_n', { n: 1 }), on: false });
        if (FB && !st.placed) LB.push({ at: [fdXB - 20, ...fdSpine(FB, 0)], text: t('learn.s.sewing.signature_n', { n: 2 }), on: st.punchT >= 0 });
        LB.push({ at: [fdXB + 11, FD_CR[1].slab[1][0] + 10, FD_CR[1].slab[1][1] - 12], text: t('learn.s.sewing.cradle'), on: false });
        LB.push({ at: [(aw.type[0] + aw.end[0])/2, (aw.type[1] + aw.end[1])/2, (aw.type[2] + aw.end[2])/2], text: t('learn.s.sewing.biz'), on: st.punchT >= 0 });
        if (FB && st.tmpl > .5) LB.push({ at: [fdXA + 60, ...fdInner(FB, fdRM - .4)], text: t('learn.s.sewing.template', { n: NST }), on: st.tmplT >= 0 });
        if (ndl && st.thread > 0) LB.push({ at: ndl.p, text: t('learn.s.sewing.needle'), on: st.ipT >= 0 });
        const top = Math.min(sewn, NS) - 1;
        if (top >= 1 && FR[top]) LB.push({ at: [fdXB - 40, ...fdSpine(FR[top].F, 0)], text: t('learn.s.sewing.signature_n', { n: top + 1 }), on: st.ipT >= 0 });
        if (N > NS && sewn >= N) LB.push({ at: [fdXB - 90, ...fdSpine(FR[NS - 1].F, 0)], text: t('learn.s.sewing.schematic', { n: N - NS }), on: false });
        if (N >= 3 && st.ip >= PATH_BIT - .05) LB.push({ at: fdNode(path[PATH_BIT - 1], FR), text: t('learn.s.sewing.double_kettle'), on: true });
        else if (ketVar) LB.push({ at: fdNode(path[last[Math.min(sewn, NS) - 1] - 1], FR), text: t('learn.s.sewing.kettle'), on: st.ipT >= 0 });
        if (hasSquare && (!ketVar || sewn <= 3)) LB.push({ at: fdNode(['knot', 1, 0], FR), text: t('learn.s.sewing.square_knot'), on: st.ipT >= 0 && sewn <= 2 });
      }
      // içini görde etiketler yığının sınırına göre dizilir (oklar beşiğin üstünden geçmez, iki yana dağılır)
      const top = FR.reduce((z, fr, i) => fr ? Math.max(z, fdZ(i) + fdRO) : z, fdBH + 10);
      s += xrCallouts(LB, k > .6 ? [fdXA, fdXB, fdYA - fdL - 4, fdYA + fdRO + 10, fdBH, top] : [0, fdBW, 0, fdBD, 0, fdH]);
      return s;
    }
    const kOpI = (op, svg) => op < 1 ? `<g opacity="${f(op)}">${svg}</g>` : svg;

    /* ---------- davranış ---------- */
    const isBusy = (st, ui) => { if (st.anim2){ ui.flash(t('learn.f.busy')); return true; } return false; };
    const st0 = { tmpl: 0, tmplT: -1, holes: 0, punchT: -1, punched: 1, delT: -1, moveT: -1, placed: false,
      alpha: new Array(NS).fill(Math.PI/2), drop: new Array(NS).fill(0), thread: 0, threadT: -1, ip: 0, ipT: -1, anim: 0, anim2: false };
    st0.alpha[0] = 0;
    const ipKos = (st, ui, target, sure, done) => { const i0 = st.ip; kRun(st, ui, 'ipT', sure, u => { st.ip = kLerp(i0, target, u); }, () => { st.ip = target; st.ipT = -1; if (done) done(); }); };
    const close = (st, i, sure) => ['kapT', sure, u => { st.alpha[i] = Math.PI/2*(1 - ease(u)); }];
    const dus = (st, i, sure) => ['dusT', sure, u => { st.drop[i] = u; st.alpha[i] = Math.PI/2; }];
    const blank = () => ['bosT', .4, () => {}];
    const finish = st => { st.anim2 = false; };
    const step = {
      // ---- delme
      template: { action(st, ui){ if (isBusy(st, ui)) return false; if (st.tmpl >= 1){ ui.flash(t('learn.s.sewing.f_template_already')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.sewing.f_template', { n: NST, a: o.number(O.station.range, 0) }), 2600);
          kRun(st, ui, 'tmplT', .8, u => { st.tmpl = ease(u); }, () => { st.tmpl = 1; finish(st); }); return true; },
        last(st){ st.tmpl = 1; } },
      del: { action(st, ui){ if (isBusy(st, ui)) return false;
          if (st.tmpl < 1){ ui.flash(t('learn.s.sewing.f_once_template')); return false; }
          if (st.holes >= NST){ ui.flash(t('learn.s.sewing.f_punched', { n: NST })); return false; }
          st.anim2 = true;
          kRun(st, ui, 'punchT', FD_PUNCH_END, u => { const tt = u*FD_PUNCH_END, i = Math.floor((tt - P0)/PER), w = (tt - P0 - i*PER)/PER;
            if (i >= 0 && i < NST && w >= .55) st.holes = Math.max(st.holes, i + 1); }, () => { st.holes = NST; st.punched = Math.max(st.punched, Math.min(2, N)); st.punchT = -1; finish(st); }); return true; },
        last(st){ st.holes = NST; st.punched = Math.max(st.punched, Math.min(2, N)); } },
      all: { action(st, ui){ if (isBusy(st, ui)) return false;
          if (st.holes < NST){ ui.flash(t('learn.s.sewing.f_once_del')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.sewing.f_all', { n: N }), 2600); const d0 = st.punched;
          kRun(st, ui, 'delT', Math.max(.6, Math.min(3, .25*N)), u => { st.punched = Math.round(kLerp(d0, N, u)); st.tmpl = 1 - u; }, () => { st.punched = N; st.tmpl = 0; finish(st); }); return true; },
        last(st){ st.punched = N; st.tmpl = 0; st.holes = NST; } },
      // ---- dikiş
      prepare: { action(st, ui){ if (isBusy(st, ui)) return false; if (st.thread >= 1){ ui.flash(t('learn.s.sewing.f_thread_already')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.sewing.f_thread', { mm: o.number(O.thread, 0) }), 2800);
          kRun(st, ui, 'threadT', .8, u => { st.thread = u; }, () => { st.thread = 1; finish(st); }); return true; },
        last(st){ st.thread = 1; } },
      first: { action(st, ui){ if (isBusy(st, ui)) return false; if (st.thread < 1){ ui.flash(t('learn.s.sewing.f_once_thread')); return false; }
          if (st.ip >= last[0]){ ui.flash(t('learn.s.sewing.f_sewn', { n: 1 })); return false; }
          st.anim2 = true; ui.flash(t('learn.s.sewing.f_ilk'), 2600); ipKos(st, ui, last[0], 3.2, () => finish(st)); return true; },
        last(st){ st.thread = 1; st.ip = Math.max(st.ip, last[0]); } },
      second: { action(st, ui){ if (isBusy(st, ui)) return false;
          if (N < 2){ ui.flash(t('learn.s.sewing.f_single_signature')); st.anim2 = true; kOrder(st, ui, [blank()], () => finish(st)); return true; }
          if (st.ip < last[0]){ ui.flash(t('learn.s.sewing.f_once_ilk')); return false; }
          if (st.ip >= last[1]){ ui.flash(t('learn.s.sewing.f_sewn', { n: 2 })); return false; }
          st.anim2 = true; ui.flash(t('learn.s.sewing.f_second'), 3000);
          kRun(st, ui, 'moveK', 2.2, u => { st.tmpl = 0; st.moveT = u; }, () => { st.moveT = -1; st.placed = true; st.alpha[1] = Math.PI/2;
            ipKos(st, ui, last[1], 3.6, () => { ui.flash(t('learn.s.sewing.f_square'), 2600); finish(st); }); }); return true; },
        last(st){ if (N < 2) return; st.placed = true; st.tmpl = 0; st.moveT = -1; st.alpha[1] = Math.PI/2; st.ip = Math.max(st.ip, last[1]); } },
      third: { action(st, ui){ if (isBusy(st, ui)) return false;
          if (N < 3){ ui.flash(t('learn.s.sewing.f', { n: 3, f: N })); st.anim2 = true; kOrder(st, ui, N >= 2 ? [close(st, 1, .8)] : [blank()], () => finish(st)); return true; }
          if (st.ip < last[1]){ ui.flash(t('learn.s.sewing.f_once_second')); return false; }
          if (st.ip >= last[2]){ ui.flash(t('learn.s.sewing.f_sewn', { n: 3 })); return false; }
          st.anim2 = true; ui.flash(t('learn.s.sewing.f_third'), 3000);
          kOrder(st, ui, [close(st, 1, .8), dus(st, 2, .8)], () => ipKos(st, ui, last[2], 4, () => { ui.flash(t('learn.s.sewing.f_kettle'), 2600);
            kOrder(st, ui, [close(st, 2, .7)], () => finish(st)); })); return true; },
        last(st){ if (N >= 2) st.alpha[1] = 0; if (N < 3) return; st.drop[2] = 1; st.alpha[2] = 0; st.ip = Math.max(st.ip, last[2]); } },
      chain: { action(st, ui){ if (isBusy(st, ui)) return false;
          if (N < 4){ ui.flash(t('learn.s.sewing.f', { n: 4, f: N })); st.anim2 = true; kOrder(st, ui, [blank()], () => finish(st)); return true; }
          if (st.ip < last[2]){ ui.flash(t('learn.s.sewing.f_once_third')); return false; }
          if (st.ip >= last[NS - 1]){ ui.flash(t('learn.s.sewing.f_chain_already')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.sewing.f_chain', { a: 4, b: N }), 3000);
          const git = i => { if (i >= NS){ if (N > NS) ui.flash(t('learn.s.sewing.f_schematic', { n: N - NS }), 2600); finish(st); return; }
            kOrder(st, ui, [dus(st, i, .55)], () => ipKos(st, ui, last[i], 1.3, () => kOrder(st, ui, [close(st, i, .4)], () => git(i + 1)))); };
          git(3); return true; },
        last(st){ for (let i = 3; i < NS; i++){ st.drop[i] = 1; st.alpha[i] = 0; } if (NS >= 4) st.ip = Math.max(st.ip, last[NS - 1]); } },
      last: { action(st, ui){ if (isBusy(st, ui)) return false;
          if (st.ip >= PATH_BIT){ ui.flash(t('learn.s.sewing.f_finished')); return false; }
          if (N < 3){ ui.flash(t('learn.s.sewing.f_son_az')); st.anim2 = true; ipKos(st, ui, PATH_BIT, .8, () => finish(st)); return true; }
          if (st.ip < last[NS - 1]){ ui.flash(t('learn.s.sewing.f_once_chain')); return false; }
          st.anim2 = true; ipKos(st, ui, PATH_BIT, 1.6, () => { ui.flash(t('learn.s.sewing.f_double'), 2600); finish(st); }); return true; },
        last(st){ st.ip = PATH_BIT; } }
    };
    return {
      step,
      cfg: {
        title: t('learn.sewing.name'), credit: false, size: [fdBW, fdBD, fdH], state: st0, scene: fdScene,
        stats: st => st.thread > 0
          ? [{ label: t('learn.s.sewing.st_sewn'), value: t('learn.s.sewing.st_v', { a: lastSewn(st), n: N }) }, { label: t('learn.s.sewing.st_hole'), value: t('learn.s.sewing.st_v', { a: NST, n: NST }), small: true }]
          : [{ label: t('learn.s.sewing.st_hole'), value: t('learn.s.sewing.st_v', { a: st.holes, n: NST }) }, { label: t('learn.s.sewing.st_punched'), value: t('learn.s.sewing.st_v', { a: st.punched, n: N }), small: true }]
      }
    };
  };
})(typeof self !== 'undefined' ? self : this);
