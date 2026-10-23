/*
 * sekil/dikis.js — Aşama 2 (delme) ve 3 (dikiş): delik şablonu, bız, bütün formaların dikişi, kare düğüm, kettle stitch.
 * LİSANS NOTU (MIT): Colorfigures motoru ve yöntemiyle yapıldı (ilk sürüm: Öğren prototipi, Şekil 2).
 * MIT License. Copyright (c) 2026 April Zhu (Colorfigures; iso-glow) ve Tolga Cohce (iso-figure). Tam metin: LICENSE.
 *
 * Gerçekte nasıl (Cockerell satır 1918-1936; Brighton-kettle; Talas-guide):
 *  1. Katlanmış forma açılıp V delme beşiğine oturtulur; delik şablonu katın dibine konur; bız her işaretten katın
 *     içinden dışa batırılır. Delikler: uçlardan ~15 mm (kettle delikleri) + aradakiler, çift sayıda (ogren-olcu.js).
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
(function (kok) {
  const KC = kok.KitapCilt.ogren, { METAL, INK, WOOD, P, P0, depthOf, byDepth, f, pd, sp, on, sub, norm, vis, tone, toneI, matOf, ease, ink, fill, face, shape, hullInk, box, rod, boardTop, board, xrCallouts } = KC.cf;
  KC.sekil.dikis = function (o) {
    const { xSort, kBoxOf, kRun, kSira, kLerp, kSeg, renk } = KC.ortak, O = o.olcu, t = o.t;
    const fdPAPER = renk.kPAPER, fdMAT = renk.kMAT, fdTHREAD = renk.kTHREAD, fdCARD = '#f4e3a8';
    const fdBRASS = { l:'#f1d27a', m:'#cfa94a', d:'#8a6a22' }, fdHANDLE = { l:'#c98a55', m:'#a86b3c', d:'#6e4423' };
    const NY = O.y, N = O.N, NS = Math.min(N, 12), HH = O.H, fdL = O.W;
    const fdBH = 4, fdXA = 25, fdXB = fdXA + HH, fdST = O.istasyon.konum.map(v => fdXA + v), NST = fdST.length;
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
    function fdSheet(r, alpha, F, Lh = fdL, kaba = false){
      const h = alpha/2, s = Lh - r*(Math.PI - alpha)/2, d1 = [Math.sin(h), Math.cos(h)], d2 = [-Math.sin(h), Math.cos(h)];
      const a0 = -h, a1 = h - Math.PI, n = Math.max(2, Math.ceil((a0 - a1)/(Math.PI/(kaba ? 6 : 12)))), loc = [];
      const t1 = [r*Math.cos(a0), r*Math.sin(a0)], t2 = [r*Math.cos(a1), r*Math.sin(a1)];
      loc.push([t1[0] + d1[0]*s, t1[1] + d1[1]*s]);
      for (let k = 0; k <= n; k++){ const a = a0 + (a1 - a0)*k/n; loc.push([r*Math.cos(a), r*Math.sin(a)]); }
      loc.push([t2[0] + d2[0]*s, t2[1] + d2[1]*s]);
      return loc.map(F.at);
    }
    function fdSigItems(F, alpha, k, items, pts, kaba){
      for (let j = 0; j < NY; j++){
        const op = 1 - (.9 - .2*j/Math.max(1, NY - 1))*k;
        const sp = fdSheet(fdRM + (NY - 1 - j)*fdG, alpha, F, fdL, kaba), nSeg = sp.length - 1;
        // kapalı ve altta kalan formada iç kâğıtların kıvrımı dıştaki kâğıdın içinde görünmez: yalnız iki düz yaprak (hız)
        const yalnizBacak = kaba && j > 0 && k < .05;
        for (let q = 0; q < nSeg; q++){
          if (yalnizBacak && q > 0 && q < nSeg - 1) continue;
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
    const yol = [], son = [];
    const ciftler = (i, sira) => sira.forEach((s, k) => { if (k % 2 === 0) yol.push([i, 'out', s], [i, 'in', s]); else yol.push([i, 'in', s], [i, 'out', s]); });
    yol.push(['tail']); ciftler(0, asc); son[0] = yol.length;
    if (N >= 2){ ciftler(1, desc); yol.push(['gap', 1, 0], ['knot', 1, 0]); son[1] = yol.length; }
    for (let i = 2; i < NS; i++){
      const sira = i % 2 === 0 ? asc : desc, s0 = sira[0], s1 = sira[NST - 1];
      yol.push(['up', i, s0]); ciftler(i, sira); yol.push(['drop', i, s1], ['gapK', i, s1], ['kn', i, s1]); son[i] = yol.length; }
    const SON = NS - 1, SONS = SON % 2 === 0 ? NST - 1 : 0;
    if (N >= 3) yol.push(['drop2', SON, SONS], ['gapK2', SON, SONS], ['kn2', SON, SONS]);
    const YOL_BIT = yol.length;

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
      for (let i = 0; i + 1 < yol.length; i++){
        const a = yol[i], b = yol[i + 1], seg = Math.min(1, Math.max(0, upto - i)); if (seg <= 0) break;
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
      const tip = [p[0] + dir[0]*46, p[1] + dir[1]*46, p[2] + dir[2]*46], eye = [p[0] - dir[0]*1.5, p[1] - dir[1]*1.5, p[2] - dir[2]*1.5];
      return rod(eye, tip, .55, METAL, toneI, .8, .12, 10) + `<circle cx="${f(P(...p)[0])}" cy="${f(P(...p)[1])}" r=".55" fill="${INK}"/>`;
    }

    /* ---------- bız ---------- */
    function fdAwl(tip, end){
      const d = norm(sub(end, tip)), at = l => [tip[0] + d[0]*l, tip[1] + d[1]*l, tip[2] + d[2]*l];
      const parts = [rod(tip, at(52), .15, METAL, toneI, .8, 1.3, 10), rod(at(52), at(59), 3.6, fdBRASS, toneI, 1, 4.4, 14),
        rod(at(59), at(132), 6.5, fdHANDLE, toneI, 1.2, 7.6, 16), rod(at(132), at(140), 7.6, fdHANDLE, toneI, 1.2, 5, 16)];
      return depthOf(tip) > depthOf(end) ? parts.reverse().join('') : parts.join('');
    }
    const YR = fdYC + fdS1*.9 + 20;   // bızın dinlenme yeri (beşik ile yığın arası)
    const FD_AWL_REST = { tip: [fdXA + 70, YR, fdBH + 7.7], end: [fdXA + 210, YR, fdBH + 7.7] };
    const PER = .5, P0 = 1.6, FD_PUNCH_END = P0 + NST*PER + 1.6;
    function fdAwlPose(st){
      const tt = st.punchT, R = FD_AWL_REST, up = (y, x, zt) => ({ tip: [x, y, zt], end: [x, y, zt + 140] });
      if (tt < 0) return R;
      const top = fdCC[1] + 118, hover = fdCC[1] + 26, pierce = fdCC[1] - fdRO - 2.5, stand = up(YR, fdXA + 70, fdBH + 30);
      const mix3 = (A, B, u) => ({ tip: A.tip.map((v, i) => kLerp(v, B.tip[i], u)), end: A.end.map((v, i) => kLerp(v, B.end[i], u)) });
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
    const dugum = (p, r = 2.3) => { const Q = P(...p); return `<circle cx="${f(Q[0])}" cy="${f(Q[1])}" r="${r}" fill="${fdTHREAD}" stroke="${INK}" stroke-width="1"/>`; };
    // kaç forma dikildi (iplik yolu ilerlemesine göre)
    const sonDikili = st => { let n = 0; for (let i = 0; i < NS; i++) if (son[i] && st.ip >= son[i] - .05) n = i + 1; return n === NS && N > NS ? N : n; };

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
        const kaba = i !== 1 && fr.alpha < .01 && i < NS - 2;
        fdSigItems(fr.F, fr.alpha, k, items, i === 1 ? ptsB : ptsSt, kaba);
        fdHoleItems(fr.F, i === 1 ? st.holes : NST, items); }
      st._cizilen = FR.filter(Boolean).length;          // test: figürde çizilen forma sayısı
      const FB = FR[1] && FR[1].F;
      if (FB && st.tmpl > 0) fdTemplateItems(FB, FR[1].alpha, (1 - st.tmpl)*70, items);
      // iplik + iğne
      const innerThr = []; let ndl = null;
      if (st.iplik > 0){
        const op = Math.min(1, st.iplik);
        if (st.ip > 0){ const head = fdThreadItems(st.ip, FR, items, innerThr);
          if (st.ipT >= 0 && head) ndl = { p: head.p, dir: head.hole ? [Math.sign(head.dir[0]) || 1, 0, 0] : head.dir };
          else if (st.ip < YOL_BIT - .01){ const e = fdNode(yol[Math.max(0, Math.round(st.ip) - 1)], FR), p = [e[0], e[1] + 8, e[2] + 4];
            items.push({ a: [e[1], e[2]], b: [p[1], p[2]], bias: .05, svg: fdThr([e, p]) }); ndl = { p, dir: [0, .35, 1] }; }
          else { // dikiş bitti: iplik düğümden kısa kesilir, iğne altlıkta (iplik yığından altlığa inmez)
            const e = fdNode(yol[YOL_BIT - 1], FR), c = [e[0] - 3, e[1] + 6, e[2] + 1];
            items.push({ a: [e[1], e[2]], b: [c[1], c[2]], bias: .05, svg: fdThr([e, c]) }); ndl = { p: fdNode(['restE'], FR), dir: [-1, 0, 0] }; } }
        else { const a = fdNode(['tail'], FR), b = fdNode(['rest0'], FR); items.push({ a: [a[1], a[2]], b: [b[1], b[2]], bias: .05, svg: kOpI(op, fdThr([a, [a[0] + 30, a[1] + 4, a[2]], b])) }); ndl = { p: b, dir: [-1, 0, 0] }; }
        if (Math.abs(ndl.dir[0]) < .5 && st.ipT >= 0) ndl.dir = [ndl.dir[0] >= 0 ? .3 : -.3, ndl.dir[1], ndl.dir[2]];
        const dd = norm(ndl.dir); items.push({ a: [ndl.p[1], ndl.p[2]], b: [ndl.p[1] + dd[1]*46, ndl.p[2] + dd[2]*46], r: .6, bias: .08, svg: kOpI(op, fdNeedle(ndl.p, dd)) });
        // düğümler: kare düğüm (1→2) ve kettle ilmekleri
        if (N >= 2 && st.ip >= son[1] - .05){ const q = fdNode(['knot', 1, 0], FR); items.push({ a: [q[1], q[2]], r: 1.6, bias: .1, svg: dugum(q, 2.6) }); }
        for (let i = 2; i < NS; i++) if (st.ip >= son[i] - .05){ const q = fdNode(yol[son[i] - 1], FR); items.push({ a: [q[1], q[2]], r: 1.6, bias: .1, svg: dugum(q, 2) }); }
        if (N >= 3 && st.ip >= YOL_BIT - .05){ const q = fdNode(yol[YOL_BIT - 1], FR); items.push({ a: [q[1], q[2]], r: 1.6, bias: .1, svg: dugum(q, 2) }); }
      }
      // bız
      const aw = fdAwlPose(st);
      items.push({ a: [aw.tip[1], aw.tip[2]], b: [aw.end[1], aw.end[2]], r: 6, svg: kOpI(gop, fdAwl(aw.tip, aw.end)) });
      // gölgeler
      const clip = boardTop(0, 0, fdBW, fdBD, fdBH, 8), plates = [];
      for (const sd of FD_CR) for (const x of [[fdXA - 16, fdXA - 6], [fdXB + 6, fdXB + 16]]) plates.push({ poly: sd.plate, x });
      const ptsPl = plates.flatMap(p => p.poly.flatMap(q => [[p.x[0], q[0], q[1]], [p.x[1], q[0], q[1]]]));
      const bInCradle = FB && FB.c[0] < (fdYC + fdYA)/2;
      const all = [...ptsCr, ...ptsSt, ...ptsB, aw.tip, aw.end];
      const xb = kBoxOf(all); xb[0][0] = fdXA - 6 + 1e-3; xb[1][0] = fdXB + 6 - 1e-3;
      const xin = k > 0 && innerThr.length ? `<g opacity="${f(.85*k)}">${innerThr.join('')}</g>` : '';
      s += byDepth([{ box: xb, svg: xSort(items) + xin },
        ...plates.map(p => ({ box: [[p.x[0], Math.min(...p.poly.map(q => q[0])), fdBH], [p.x[1], Math.max(...p.poly.map(q => q[0])), Math.max(...p.poly.map(q => q[1]))]], svg: kOpI(gop, fdPrismX(p.poly, p.x[0], p.x[1], WOOD)) }))]);
      // etiketler
      const LB = [], spA = fdSpine(FR[0].F, 0), dikili = sonDikili(st);
      const kareVar = N >= 2 && st.ip >= son[1] - .05, ketVar = NS >= 3 && st.ip >= son[2] - .05;
      if (k > .6){
        LB.push({ at: [(fdST[0] + fdST[1])/2, ...fdInner(FR[0].F)], text: t('ogren.s.dikis.ic_dikis'), on: false });
        if (st.ip > 0) LB.push({ at: [(fdST[1] + fdST[2])/2, ...fdSpine(FR[0].F, .5)], text: t('ogren.s.dikis.dis_dikis'), on: false });
        if (kareVar) LB.push({ at: fdNode(['knot', 1, 0], FR), text: t('ogren.s.dikis.kare_dugum'), on: false });
        if (ketVar) LB.push({ at: fdNode(yol[son[2] - 1], FR), text: t('ogren.s.dikis.kettle'), on: st.ipT >= 0 });
        if (FB && !st.placed) LB.push({ at: [fdST[Math.floor(NST/2)], ...fdSpine(FB, 0)], text: t('ogren.s.dikis.delikler', { a: st.holes, n: NST }), on: st.punchT >= 0 });
        if (st.iplik > 0) LB.push({ at: fdNode(['tail'], FR), text: t('ogren.s.dikis.uc'), on: false });
      } else {
        LB.push({ at: [fdXA + 30, ...spA], text: dikili >= 1 ? t('ogren.s.dikis.forma_dikili', { n: 1 }) : t('ogren.s.dikis.forma_n', { n: 1 }), on: false });
        if (FB && !st.placed) LB.push({ at: [fdXB - 20, ...fdSpine(FB, 0)], text: t('ogren.s.dikis.forma_n', { n: 2 }), on: st.punchT >= 0 });
        LB.push({ at: [fdXB + 11, FD_CR[1].slab[1][0] + 10, FD_CR[1].slab[1][1] - 12], text: t('ogren.s.dikis.besik'), on: false });
        LB.push({ at: [(aw.tip[0] + aw.end[0])/2, (aw.tip[1] + aw.end[1])/2, (aw.tip[2] + aw.end[2])/2], text: t('ogren.s.dikis.biz'), on: st.punchT >= 0 });
        if (FB && st.tmpl > .5) LB.push({ at: [fdXA + 60, ...fdInner(FB, fdRM - .4)], text: t('ogren.s.dikis.sablon', { n: NST }), on: st.tmplT >= 0 });
        if (ndl && st.iplik > 0) LB.push({ at: ndl.p, text: t('ogren.s.dikis.igne'), on: st.ipT >= 0 });
        const ust = Math.min(dikili, NS) - 1;
        if (ust >= 1 && FR[ust]) LB.push({ at: [fdXB - 40, ...fdSpine(FR[ust].F, 0)], text: t('ogren.s.dikis.forma_n', { n: ust + 1 }), on: st.ipT >= 0 });
        if (N > NS && dikili >= N) LB.push({ at: [fdXB - 90, ...fdSpine(FR[NS - 1].F, 0)], text: t('ogren.s.dikis.temsili', { n: N - NS }), on: false });
        if (N >= 3 && st.ip >= YOL_BIT - .05) LB.push({ at: fdNode(yol[YOL_BIT - 1], FR), text: t('ogren.s.dikis.cift_kettle'), on: true });
        else if (ketVar) LB.push({ at: fdNode(yol[son[Math.min(dikili, NS) - 1] - 1], FR), text: t('ogren.s.dikis.kettle'), on: st.ipT >= 0 });
        if (kareVar && (!ketVar || dikili <= 3)) LB.push({ at: fdNode(['knot', 1, 0], FR), text: t('ogren.s.dikis.kare_dugum'), on: st.ipT >= 0 && dikili <= 2 });
      }
      // içini görde etiketler yığının sınırına göre dizilir (oklar beşiğin üstünden geçmez, iki yana dağılır)
      const ust = FR.reduce((z, fr, i) => fr ? Math.max(z, fdZ(i) + fdRO) : z, fdBH + 10);
      s += xrCallouts(LB, k > .6 ? [fdXA, fdXB, fdYA - fdL - 4, fdYA + fdRO + 10, fdBH, ust] : [0, fdBW, 0, fdBD, 0, fdH]);
      return s;
    }
    const kOpI = (op, svg) => op < 1 ? `<g opacity="${f(op)}">${svg}</g>` : svg;

    /* ---------- davranış ---------- */
    const mesgulMu = (st, ui) => { if (st.anim2){ ui.flash(t('ogren.f.mesgul')); return true; } return false; };
    const st0 = { tmpl: 0, tmplT: -1, holes: 0, punchT: -1, delinen: 1, delT: -1, moveT: -1, placed: false,
      alpha: new Array(NS).fill(Math.PI/2), drop: new Array(NS).fill(0), iplik: 0, iplikT: -1, ip: 0, ipT: -1, anim: 0, anim2: false };
    st0.alpha[0] = 0;
    const ipKos = (st, ui, hedef, sure, done) => { const i0 = st.ip; kRun(st, ui, 'ipT', sure, u => { st.ip = kLerp(i0, hedef, u); }, () => { st.ip = hedef; st.ipT = -1; if (done) done(); }); };
    const kapat = (st, i, sure) => ['kapT', sure, u => { st.alpha[i] = Math.PI/2*(1 - ease(u)); }];
    const dus = (st, i, sure) => ['dusT', sure, u => { st.drop[i] = u; st.alpha[i] = Math.PI/2; }];
    const bos = () => ['bosT', .4, () => {}];
    const bitir = st => { st.anim2 = false; };
    const adim = {
      // ---- delme
      sablon: { eylem(st, ui){ if (mesgulMu(st, ui)) return false; if (st.tmpl >= 1){ ui.flash(t('ogren.s.dikis.f_sablon_zaten')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.dikis.f_sablon', { n: NST, a: o.sayi(O.istasyon.aralik, 0) }), 2600);
          kRun(st, ui, 'tmplT', .8, u => { st.tmpl = ease(u); }, () => { st.tmpl = 1; bitir(st); }); return true; },
        son(st){ st.tmpl = 1; } },
      del: { eylem(st, ui){ if (mesgulMu(st, ui)) return false;
          if (st.tmpl < 1){ ui.flash(t('ogren.s.dikis.f_once_sablon')); return false; }
          if (st.holes >= NST){ ui.flash(t('ogren.s.dikis.f_delindi', { n: NST })); return false; }
          st.anim2 = true;
          kRun(st, ui, 'punchT', FD_PUNCH_END, u => { const tt = u*FD_PUNCH_END, i = Math.floor((tt - P0)/PER), w = (tt - P0 - i*PER)/PER;
            if (i >= 0 && i < NST && w >= .55) st.holes = Math.max(st.holes, i + 1); }, () => { st.holes = NST; st.delinen = Math.max(st.delinen, Math.min(2, N)); st.punchT = -1; bitir(st); }); return true; },
        son(st){ st.holes = NST; st.delinen = Math.max(st.delinen, Math.min(2, N)); } },
      tumu: { eylem(st, ui){ if (mesgulMu(st, ui)) return false;
          if (st.holes < NST){ ui.flash(t('ogren.s.dikis.f_once_del')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.dikis.f_tumu', { n: N }), 2600); const d0 = st.delinen;
          kRun(st, ui, 'delT', Math.max(.6, Math.min(3, .25*N)), u => { st.delinen = Math.round(kLerp(d0, N, u)); st.tmpl = 1 - u; }, () => { st.delinen = N; st.tmpl = 0; bitir(st); }); return true; },
        son(st){ st.delinen = N; st.tmpl = 0; st.holes = NST; } },
      // ---- dikiş
      hazirla: { eylem(st, ui){ if (mesgulMu(st, ui)) return false; if (st.iplik >= 1){ ui.flash(t('ogren.s.dikis.f_iplik_zaten')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.dikis.f_iplik', { mm: o.sayi(O.iplik, 0) }), 2800);
          kRun(st, ui, 'iplikT', .8, u => { st.iplik = u; }, () => { st.iplik = 1; bitir(st); }); return true; },
        son(st){ st.iplik = 1; } },
      ilk: { eylem(st, ui){ if (mesgulMu(st, ui)) return false; if (st.iplik < 1){ ui.flash(t('ogren.s.dikis.f_once_iplik')); return false; }
          if (st.ip >= son[0]){ ui.flash(t('ogren.s.dikis.f_dikili', { n: 1 })); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.dikis.f_ilk'), 2600); ipKos(st, ui, son[0], 3.2, () => bitir(st)); return true; },
        son(st){ st.iplik = 1; st.ip = Math.max(st.ip, son[0]); } },
      ikinci: { eylem(st, ui){ if (mesgulMu(st, ui)) return false;
          if (N < 2){ ui.flash(t('ogren.s.dikis.f_tek_forma')); st.anim2 = true; kSira(st, ui, [bos()], () => bitir(st)); return true; }
          if (st.ip < son[0]){ ui.flash(t('ogren.s.dikis.f_once_ilk')); return false; }
          if (st.ip >= son[1]){ ui.flash(t('ogren.s.dikis.f_dikili', { n: 2 })); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.dikis.f_ikinci'), 3000);
          kRun(st, ui, 'moveK', 2.2, u => { st.tmpl = 0; st.moveT = u; }, () => { st.moveT = -1; st.placed = true; st.alpha[1] = Math.PI/2;
            ipKos(st, ui, son[1], 3.6, () => { ui.flash(t('ogren.s.dikis.f_kare'), 2600); bitir(st); }); }); return true; },
        son(st){ if (N < 2) return; st.placed = true; st.tmpl = 0; st.moveT = -1; st.alpha[1] = Math.PI/2; st.ip = Math.max(st.ip, son[1]); } },
      ucuncu: { eylem(st, ui){ if (mesgulMu(st, ui)) return false;
          if (N < 3){ ui.flash(t('ogren.s.dikis.f_yok', { n: 3, f: N })); st.anim2 = true; kSira(st, ui, N >= 2 ? [kapat(st, 1, .8)] : [bos()], () => bitir(st)); return true; }
          if (st.ip < son[1]){ ui.flash(t('ogren.s.dikis.f_once_ikinci')); return false; }
          if (st.ip >= son[2]){ ui.flash(t('ogren.s.dikis.f_dikili', { n: 3 })); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.dikis.f_ucuncu'), 3000);
          kSira(st, ui, [kapat(st, 1, .8), dus(st, 2, .8)], () => ipKos(st, ui, son[2], 4, () => { ui.flash(t('ogren.s.dikis.f_kettle'), 2600);
            kSira(st, ui, [kapat(st, 2, .7)], () => bitir(st)); })); return true; },
        son(st){ if (N >= 2) st.alpha[1] = 0; if (N < 3) return; st.drop[2] = 1; st.alpha[2] = 0; st.ip = Math.max(st.ip, son[2]); } },
      zincir: { eylem(st, ui){ if (mesgulMu(st, ui)) return false;
          if (N < 4){ ui.flash(t('ogren.s.dikis.f_yok', { n: 4, f: N })); st.anim2 = true; kSira(st, ui, [bos()], () => bitir(st)); return true; }
          if (st.ip < son[2]){ ui.flash(t('ogren.s.dikis.f_once_ucuncu')); return false; }
          if (st.ip >= son[NS - 1]){ ui.flash(t('ogren.s.dikis.f_zincir_zaten')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.dikis.f_zincir', { a: 4, b: N }), 3000);
          const git = i => { if (i >= NS){ if (N > NS) ui.flash(t('ogren.s.dikis.f_temsili', { n: N - NS }), 2600); bitir(st); return; }
            kSira(st, ui, [dus(st, i, .55)], () => ipKos(st, ui, son[i], 1.3, () => kSira(st, ui, [kapat(st, i, .4)], () => git(i + 1)))); };
          git(3); return true; },
        son(st){ for (let i = 3; i < NS; i++){ st.drop[i] = 1; st.alpha[i] = 0; } if (NS >= 4) st.ip = Math.max(st.ip, son[NS - 1]); } },
      son: { eylem(st, ui){ if (mesgulMu(st, ui)) return false;
          if (st.ip >= YOL_BIT){ ui.flash(t('ogren.s.dikis.f_bitti')); return false; }
          if (N < 3){ ui.flash(t('ogren.s.dikis.f_son_az')); st.anim2 = true; ipKos(st, ui, YOL_BIT, .8, () => bitir(st)); return true; }
          if (st.ip < son[NS - 1]){ ui.flash(t('ogren.s.dikis.f_once_zincir')); return false; }
          st.anim2 = true; ipKos(st, ui, YOL_BIT, 1.6, () => { ui.flash(t('ogren.s.dikis.f_cift'), 2600); bitir(st); }); return true; },
        son(st){ st.ip = YOL_BIT; } }
    };
    return {
      adim,
      cfg: {
        title: t('ogren.dikis.ad'), credit: false, size: [fdBW, fdBD, fdH], state: st0, scene: fdScene,
        stats: st => st.iplik > 0
          ? [{ label: t('ogren.s.dikis.st_dikili'), value: t('ogren.s.dikis.st_v', { a: sonDikili(st), n: N }) }, { label: t('ogren.s.dikis.st_delik'), value: t('ogren.s.dikis.st_v', { a: NST, n: NST }), small: true }]
          : [{ label: t('ogren.s.dikis.st_delik'), value: t('ogren.s.dikis.st_v', { a: st.holes, n: NST }) }, { label: t('ogren.s.dikis.st_delinen'), value: t('ogren.s.dikis.st_v', { a: st.delinen, n: N }), small: true }]
      }
    };
  };
})(typeof self !== 'undefined' ? self : this);
