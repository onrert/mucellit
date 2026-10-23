/*
 * sekil/sirt.js — Aşama 5: sırt tutkalı → kapital → sırt bezi.
 * LİSANS NOTU (MIT): Colorfigures motoru ve yöntemiyle yapıldı (ilk sürüm: Öğren prototipi, Şekil 4).
 * MIT License. Copyright (c) 2026 April Zhu (Colorfigures; iso-glow) ve Tolga Cohce (iso-figure). Tam metin: LICENSE.
 *
 * Gerçekte nasıl: forzaları takılı, dikilmiş blok sırtı yukarıda, birkaç milimetresi dışarıda kalacak biçimde iki pres
 * çenesi arasına sıkıştırılır; sırta ince PVA sürülür ve kurutulur; baş ve kuyruğa kapital, sonra sırt bezi (mull:
 * seyrek dokulu bez) yapıştırılır, bezin iki yana ~25 mm kanadı sarkar (Talas-guide: kapital sırt bezinden önce).
 * Ölçek gerçek: blok H × W × S (kalınlık büyütülmedi).
 * Koordinat: x = sırt boyu, y = kalınlık yönü (pres ortası s4Y0), z = yukarı; 1 birim = 1 mm.
 * PARÇALAR: kesme altlığı · blok (sırt: N forma katı, dış dikişler, kettle zinciri; ön kenar; iki forza; kesitler) ·
 *   pres: iki çene, iki vida (kol topuzlu) · tutkal + fırça · 2 kapital · sırt bezi (üst + iki kanat).
 * ÇİZİM: x boyunca uzanan her şey (y, z) kesitinde 2B ressam sıralamasıyla (xSort).
 */
'use strict';
(function (kok) {
  const KC = kok.KitapCilt.ogren, { INK, f, pd, sp, on, vis, toneI, matOf, ease, fill, face, shape, box, rod, boardTop, xrCallouts } = KC.cf;
  KC.sekil.sirt = function (o) {
    const { xSort, xPrism, kRect, kRun, kLerp, kSeg, kMat, kThr, kSirtDikis, kOp, renk } = KC.ortak, O = o.olcu, t = o.t;
    const kPAPER = renk.kPAPER, kEDGE = renk.kEDGE, kENDP = renk.kENDP, kMULL = renk.kMULL, kTHREAD = renk.kTHREAD, s4WOOD = renk.kWOOD, s4STEEL = renk.kSTEEL;
    const N = O.N, s4T = O.S, s4H = O.W, s4BH = 4, s4JW = 34, s4Y0 = 110;
    const s4XA = 60, s4XB = s4XA + O.H, s4JZ = s4BH + s4H - 6,   // sırt çenelerin 6 mm üstünde ("birkaç milimetre")
    ST = O.istasyon.konum.map(v => s4XA + v);
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
          sv += `<path d="${d}" fill="none" stroke="#9c8f72" stroke-width=".45"/>` + kSirtDikis(at, N, ST, .9);
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
      // pres çeneleri ve vidalar
      const g = st.gap, jop = 1 - .72*k;
      for (const [y0, y1] of [[s4Y0 - g/2 - s4JW, s4Y0 - g/2], [s4Y0 + g/2, s4Y0 + g/2 + s4JW]])
        all.push(...xPrism(kRect(y0, s4BH, y1, s4JZ), s4XA - 45, s4XB + 45, s4WOOD, items, { w: 1.3, op: jop }));
      for (const x of [s4XA - 28, s4XB + 28]){
        const zs = s4JZ*.5, yo = s4Y0 + g/2 + s4JW, yi = s4Y0 - g/2 - s4JW;
        const knob = rod([x, s4Y0 + 86, zs], [x, s4Y0 + 98, zs], 8, s4WOOD, toneI, 1.2, 8, 16);
        const rodP = rod([x, yo, zs], [x, s4Y0 + 86, zs], 4.2, s4STEEL, toneI, 1, 4.2, 12);
        items.push({ a: [yo, zs], b: [s4Y0 + 98, zs], svg: kOp(jop, KC.cf.CAM_V[1] > 0 ? rodP + knob : knob + rodP) });
        items.push({ a: [s4Y0 - 74, zs], b: [yi, zs], svg: kOp(jop, rod([x, s4Y0 - 74, zs], [x, yi, zs], 4.2, s4STEEL, toneI, 1, 4.2, 12)) });
      }
      // kapital (önce)
      if (st.kap > 0){ const dz = 30*(1 - ease(st.kap)), zk = top + 1.7 + dz;
        for (const x of [s4XA + 1.7, s4XB - 1.7]){
          const sv = rod([x, s4Y0 - s4T/2, zk], [x, s4Y0 + s4T/2, zk], 1.7, m, toneI, .9, 1.7, 12);
          let st2 = ''; for (let j = 1; j < 8; j++){ const y = s4Y0 - s4T/2 + s4T*j/8; st2 += pd([[x + 1.6, y, zk + .3], [x + .4, y, zk + 1.6]], false); }
          items.push({ a: [s4Y0, zk], r: 1.7, bias: .04, svg: sv + `<path d="${st2}" fill="none" stroke="${INK}" stroke-width=".4"/>` }); } }
      // sırt bezi (sonra): üst + iki kanat
      if (st.mull > 0){ const dz = 40*(1 - ease(st.mull)), x0 = s4XA + 6, x1 = s4XB - 6, zt = top + .5 + dz, yl = s4Y0 - s4T/2 - .45, yr = s4Y0 + s4T/2 + .45;
        const mq = (a, b, n) => { const Q = [[x0, a[0], a[1]], [x1, a[0], a[1]], [x1, b[0], b[1]], [x0, b[0], b[1]]];
          let d = ''; for (let j = 1; j < 4; j++){ const tt = j/4; d += pd([[x0, kLerp(a[0], b[0], tt), kLerp(a[1], b[1], tt)], [x1, kLerp(a[0], b[0], tt), kLerp(a[1], b[1], tt)]], false); }
          for (let x = x0 + 8; x < x1; x += 9) d += pd([[x, a[0], a[1]], [x, b[0], b[1]]], false);
          return shape(Q, toneI(n, kMULL), .9) + `<path d="${d}" fill="none" stroke="#c9bb93" stroke-width=".35" opacity=".8"/>`; };
        // kanatlar çenenin içinden geçmez; sırttan çene üstüne iner, çenenin üst yüzüne yatar (toplam ~25 mm)
        const zj = s4JZ + .5 + dz, yan = Math.max(0, 25 - (zt - zj));
        const pts = [[yl - yan, zj], [yl, zj], [yl, zt], [yr, zt], [yr, zj], [yr + yan, zj]];
        for (let i = 0; i + 1 < pts.length; i++){ const a = pts[i], b = pts[i + 1], tv = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(...tv);
          let n = [0, -tv[1]/tl, tv[0]/tl]; if (!vis(n)) n = n.map(v => -v);
          items.push({ a, b, bias: .05, svg: mq(a, b, n) }); } }
      // fırça
      if (st.glueT >= 0){ const xg = kLerp(s4XA, s4XB, st.glue), zb = top + .6;
        const sv = box(xg - 8, s4Y0 - 7, zb, xg + 8, s4Y0 + 7, zb + 6, matOf('#e9d9a6'), toneI, 1) + rod([xg, s4Y0, zb + 6], [xg - 30, s4Y0, zb + 40], 2.6, s4WOOD, toneI, 1, 2.6, 12);
        items.push({ a: [s4Y0, zb + 3], b: [s4Y0, zb + 30], r: 7, bias: .1, svg: sv }); }
      s += xSort(items);
      // etiketler
      const LB = [], sp = s4Loc(ps, [0, s4H]);
      if (k > .6){
        LB.push({ at: [ST[0], sp[0], sp[1]], text: t('ogren.s.sirt.kettle'), on: false });
        LB.push({ at: [(ST[1] + ST[2])/2, sp[0], sp[1]], text: t('ogren.s.sirt.dis'), on: false });
        LB.push({ at: [(ST[2] + ST[3])/2, sp[0], sp[1]], text: t('ogren.s.sirt.ic'), on: false });
        LB.push({ at: [s4XB, ...s4Loc(ps, [0, s4H - 2])], text: t('ogren.s.sirt.katlar', { n: N }), on: false });
      } else {
        LB.push({ at: [s4XB, ...s4Loc(ps, [s4T/2, s4H*.7])], text: t('ogren.s.sirt.blok', { n: N, y: O.yaprak }), on: false });
        LB.push({ at: [s4XB - 30, sp[0], sp[1]], text: t('ogren.s.sirt.sirt', { s: o.sayi(s4T) }), on: false });
        LB.push({ at: [s4XA + 40, ...s4Loc(ps, [-s4T/2, s4H*.5])], text: t('ogren.s.sirt.forza'), on: false });
        if (standing) LB.push({ at: [s4XB + 30, s4Y0 + st.gap/2 + s4JW, s4JZ*.75], text: t('ogren.s.sirt.cene'), on: st.gapT >= 0 });
        LB.push({ at: [s4XB + 28, s4Y0 + 92, s4JZ*.5], text: t('ogren.s.sirt.vida'), on: st.gapT >= 0 });
        if (st.glue > 0 && st.mull < .5) LB.push({ at: [s4XA + 40, sp[0], sp[1]], text: t('ogren.s.sirt.tutkal'), on: st.glueT >= 0 });
        if (st.kap > .5) LB.push({ at: [s4XB - 1.7, s4Y0, top + 2], text: t('ogren.s.sirt.kapital', { s: o.sayi(s4T) }), on: st.kapT >= 0 });
        if (st.mull > .5) LB.push({ at: [s4XA + 120, s4Y0 + s4T/2 + 8, s4JZ + .6], text: t('ogren.s.sirt.mull', { a: o.sayi(O.mull.gen), b: o.sayi(O.mull.yuk) }), on: st.mullT >= 0 });
      }
      s += xrCallouts(LB, [0, s4W, 0, s4D, 0, HMAX]);
      return s;
    }
    const mesgul = (st, ui) => { if (st.anim2){ ui.flash(t('ogren.f.mesgul')); return true; } return false; };
    const bitir = st => { st.anim2 = false; };
    const adim = {
      pres: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.mv >= 1){ ui.flash(t('ogren.s.sirt.f_preste')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.sirt.f_pres'), 2400);
          kRun(st, ui, 'mvT', 2.2, u => { st.mv = u; }, () => kRun(st, ui, 'gapT', 1, u => { st.gap = kLerp(34, s4T + .3, u); }, () => bitir(st))); return true; },
        son(st){ st.mv = 1; st.gap = s4T + .3; } },
      tutkal: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.gap > s4T + 1){ ui.flash(t('ogren.s.sirt.f_once_pres')); return false; }
          if (st.glue >= 1){ ui.flash(t('ogren.s.sirt.f_tutkal_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.sirt.f_tutkal'), 2400); kRun(st, ui, 'glueT', 2, u => { st.glue = u; }, () => bitir(st)); return true; },
        son(st){ st.glue = 1; } },
      kapital: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.glue < 1){ ui.flash(t('ogren.s.sirt.f_once_tutkal')); return false; }
          if (st.kap >= 1){ ui.flash(t('ogren.s.sirt.f_kapital_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.sirt.f_kapital'), 2400); kRun(st, ui, 'kapT', 1, u => { st.kap = u; }, () => bitir(st)); return true; },
        son(st){ st.kap = 1; } },
      mull: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.kap < 1){ ui.flash(t('ogren.s.sirt.f_once_kapital')); return false; }
          if (st.mull >= 1){ ui.flash(t('ogren.s.sirt.f_mull_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.sirt.f_mull'), 2400); kRun(st, ui, 'mullT', 1.1, u => { st.mull = u; }, () => bitir(st)); return true; },
        son(st){ st.mull = 1; } }
    };
    const st0 = { mv: 0, mvT: -1, gap: 34, gapT: -1, glue: 0, glueT: -1, mull: 0, mullT: -1, kap: 0, kapT: -1, anim: 0, anim2: false };
    return { adim, cfg: {
      title: t('ogren.sirt.ad'), credit: false, size: [s4W, s4D, HMAX], state: st0, scene,
      stats: st => [{ label: t('ogren.s.sirt.st_sirt'), value: t('ogren.mm', { v: o.sayi(s4T) }) }, { label: t('ogren.s.sirt.st_forma'), value: String(N), small: true }]
    } };
  };
})(typeof self !== 'undefined' ? self : this);
