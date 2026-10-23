/*
 * figures/folding.js — Stage 1: paper grain direction, signature imposition, folding, bone folder, resting under a weight.
 * LICENSE NOTE (MIT): made with the Colorfigures engine and method (first version: the Learn prototype, figure 1).
 * MIT License. Copyright (c) 2026 April Zhu (Colorfigures; iso-glow) and Tolga Cohce (iso-figure). Full text: LICENSE.
 *
 * How it is done in reality: a signature is made of y printed sheets (2W × H); two pages are printed side by side on
 * both faces of every sheet. In a signature of p = 4y pages, sheet i (0 = top): outer face [p − 2i | 1 + 2i], inner face
 * [p − 1 − 2i | 2 + 2i] (y = 4: 16|1, 14|3, 12|5, 10|7; 8|9 in the middle). The sheets are stacked with sheet 1 on top,
 * the "p | 1" face up, and the pile is folded in the middle (the halves come down): sheet 1 stays outside (tried by
 * hand). The fold is creased with the bone folder; the signatures rest under a weight. Grain: on A4 the grain mostly
 * runs parallel to the long edge (Brighton-grain); folded to A5 the fold runs across the grain.
 * Coordinates: x = page height (fkXA … fkXA + H), y = width (+y the viewer's left), z = up; 1 unit = 1 mm.
 * The gap between the sheets is enlarged to 2.6 mm (~0.1 mm in reality), otherwise the sheets look like one line.
 * PARTS: cutting mat · y sheets (two halves + fold) · print (lines, page number) · grain lines · bone folder ·
 *   weight board. DRAWING: paper strips with the 2D painter's sort in the (y, z) section (xSort); bone folder and board byDepth.
 */
'use strict';
(function (root) {
  const MC = root.Mucellit.learn, { DARK, byDepth, f, pd, on, vis, tone, toneI, ease, ink, fill, face, box, boardTop, board, act, xrCallouts } = MC.cf;
  MC.figures.folding = function (o) {
    const { xSort, kText, kBoxOf, kRun, kBone, color } = MC.common, O = o.size, t = o.t;
    const fkPAPER = color.kPAPER, fkMAT = color.kMAT;
    const NY = O.y, PG = 4 * NY, fkL = O.W, fkHH = O.H;
    const fkXA = 20, fkXB = fkXA + fkHH, fkYF = fkL + 52, fkG = 2.6, fkR0 = 1.4, fkBH = 4;
    const fkBW = fkHH + 40, fkBD = 2 * fkL + 103, fkH = fkL + 30;
    const SC = Math.min(fkL / 148, fkHH / 210);
    const NUM = i => [PG - 2 * i, 1 + 2 * i, PG - 1 - 2 * i, 2 + 2 * i];
    const fkAdd = (p, d, k) => [p[0] + d[0]*k, p[1] + d[1]*k, p[2] + d[2]*k];
    // laying down (press step): the section point (y, z) turns -90° around the fold and comes down onto the table
    const lay = (st, zc) => { const a = -Math.PI/2 * st.lie; if (!a) return p => p;
      const c = Math.cos(a), s = Math.sin(a), hy = fkYF, hz = zc, dz = (fkBH + .6 + fkR0 + (NY - 1)*fkG - hz) * st.lie, dy = (fkL*.5) * st.lie;
      return p => [hy + (p[0] - hy)*c - (p[1] - hz)*s + dy, hz + (p[0] - hy)*s + (p[1] - hz)*c + dz]; };
    const layN = st => { const a = -Math.PI/2 * st.lie, c = Math.cos(a), s = Math.sin(a); return n => [n[0], n[1]*c - n[2]*s, n[1]*s + n[2]*c]; };

    function fkSheet(i, phi, zc, R){
      const r = fkR0 + (NY - 1 - i)*fkG, s = fkL - r*phi, n = Math.max(1, Math.ceil(phi / (Math.PI/18)));
      const c = Math.cos(phi), sn = Math.sin(phi), raw = [];
      raw.push([fkYF + r*sn + s*c, zc + r*c - s*sn]);
      for (let k = n; k >= 0; k--){ const tt = phi*k/n; raw.push([fkYF + r*Math.sin(tt), zc + r*Math.cos(tt)]); }
      for (let k = 1; k <= n; k++){ const tt = phi*k/n; raw.push([fkYF - r*Math.sin(tt), zc + r*Math.cos(tt)]); }
      raw.push([fkYF - r*sn - s*c, zc + r*c - s*sn]);
      const pts = raw.filter((p, j) => j === 0 || Math.hypot(p[0] - raw[j - 1][0], p[1] - raw[j - 1][1]) > 1e-6).map(R);
      return { pts, r, s };
    }
    const fkZc = phi => fkBH + .6 - (fkR0*Math.cos(phi) - (fkL - fkR0*phi)*Math.sin(phi));

    function fkPrint(a, b, half, outer, num, accent, phi, r, RN){
      const e = [0, b[0] - a[0], b[1] - a[1]], len = Math.hypot(e[1], e[2]); e[1] /= len; e[2] /= len;
      const nOut = RN(half === 'R' ? [0, -Math.sin(phi), Math.cos(phi)] : [0, Math.sin(phi), Math.cos(phi)]);
      const nrm = outer ? nOut : nOut.map(v => -v);
      const U0 = half === 'R' ? e : e.map(v => -v), U = outer ? U0 : U0.map(v => -v), V = [1, 0, 0];
      const at = (dist, x) => { const tt = Math.max(0, dist - r*phi); return fkAdd([x, a[0] + e[1]*tt, a[1] + e[2]*tt], nrm, .35); };
      let s = '', lines = '';
      const rows = [44, 52, 60, 68, 76, 158, 166, 174, 182].map(v => fkXA + v*fkHH/210);
      for (const x of rows) lines += pd([at(18*SC, x), at(fkL - 16*SC, x)], false);
      s += `<path d="${lines}" fill="none" stroke="#b9b09c" stroke-width=".9" stroke-linecap="round"/>`;
      s += kText(at(fkL/2 + 1, fkXA + 128*fkHH/210), U, V, String(num), 46*SC, accent ? accent : '#3a332a', 800);
      s += kText(at(fkL/2 + 1, fkXA + 200*fkHH/210), U, V, String(num), 6*SC, '#6d6556', 700);
      return s;
    }

    function fkPaper(st, m, k){
      const phi = st.phi, zc = fkZc(phi), items = [], all = [], R = lay(st, zc), RN = layN(st);
      for (let i = 0; i < NY; i++){
        const dz = st.dz[i]; if (dz == null) continue;
        const { pts, r } = fkSheet(i, phi, zc + dz, R), nSeg = pts.length - 1;
        const op = i === NY - 1 ? 1 : 1 - (.8 - .4*i/Math.max(1, NY - 1))*k;
        for (let j = 0; j < nSeg; j++){
          const a = pts[j], b = pts[j + 1], tv = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(...tv);
          const nIn = [0, -tv[1]/tl, tv[0]/tl], nOut = nIn.map(v => -v), seen = vis(nOut) ? nOut : nIn;
          const q = [[fkXA, a[0], a[1]], [fkXB, a[0], a[1]], [fkXB, b[0], b[1]], [fkXA, b[0], b[1]]];
          let sv = face(pd(q), tone(seen, fkPAPER));
          sv += ink(pd([q[0], q[3]], false), 1.1) + ink(pd([q[1], q[2]], false), 1.1);
          if (j === 0) sv += ink(pd([q[0], q[1]], false), 1.1);
          if (j === nSeg - 1) sv += ink(pd([q[3], q[2]], false), 1.1);
          if (j === 0 || j === nSeg - 1){
            const half = j === 0 ? 'L' : 'R', fold = j === 0 ? b : a, edge = j === 0 ? a : b, outerSeen = seen === nOut;
            const nums = NUM(i), num = half === 'L' ? (outerSeen ? nums[0] : nums[2]) : (outerSeen ? nums[1] : nums[3]);
            const pr = fkPrint(fold, edge, half, outerSeen, num, i === 0 && outerSeen ? m.d : null, phi, r, RN), to = i < NY - 1 ? 1 - k : 1;
            if (to > .01) sv += to < 1 ? `<g opacity="${f(to)}">${pr}</g>` : pr;
            // grain lines (on the top face of sheet 1, parallel to the long edge)
            if (i === 0 && st.grain > 0 && outerSeen){ let g = ''; const e2 = [0, edge[0] - fold[0], edge[1] - fold[1]], L2 = Math.hypot(e2[1], e2[2]);
              for (let x = fkXA + 10; x < fkXB - 4; x += 12){ g += pd([[x, fold[0] + seen[1]*.5, fold[1] + seen[2]*.5], [x, fold[0] + e2[1]*.92 + seen[1]*.5, fold[1] + e2[2]*.92 + seen[2]*.5]], false); }
              void L2; sv += `<g opacity="${f(.85*st.grain)}"><path d="${g}" fill="none" stroke="#8a6a3c" stroke-width="1" stroke-dasharray="7 4"/></g>`; }
          }
          if (i === 0 && st.creased && phi > 1.2 && j === Math.floor(nSeg/2)) sv += ink(pd([[fkXA, a[0], a[1]], [fkXB, a[0], a[1]]], false), 1.4);
          items.push({ a, b, svg: op < 1 ? `<g opacity="${f(op)}">${sv}</g>` : sv });
          all.push(...q);
        }
      }
      return { svg: xSort(items), pts: all, zc };
    }
    function fkFolderPose(st, top){
      const rest = [60, 16, fkBH], tt = st.creaseT;
      if (tt < 0) return rest;
      const zl = top + 22, zs = top + .4, ys = fkYF - 11;
      const seg = (t0, t1) => ease(Math.max(0, Math.min(1, (tt - t0)/(t1 - t0))));
      if (tt < .5) return [60, 16, fkBH + (zl - fkBH)*seg(0, .5)];
      if (tt < 1.1) return [60, 16 + (ys - 16)*seg(.5, 1.1), zl];
      if (tt < 1.5) return [60, ys, zl + (zs - zl)*seg(1.1, 1.5)];
      if (tt < 2.7){ const u = (tt - 1.5)/1.2, x = u < .33 ? 60 + 20*ease(u/.33) : u < .75 ? 80 - 60*ease((u - .33)/.42) : 20 + 40*ease((u - .75)/.25); return [x, ys, zs]; }
      if (tt < 3.1) return [60, ys, zs + (zl - zs)*seg(2.7, 3.1)];
      if (tt < 3.7) return [60, ys + (16 - ys)*seg(3.1, 3.7), zl];
      return [60, 16, zl + (fkBH - zl)*seg(3.7, 4.1)];
    }

    function fkScene(st, m){
      const k = ease(st.xr || 0);
      let s = board(0, 0, fkBW, fkBD, fkBH, 8, fkMAT);
      let g = ''; for (let x = 20; x < fkBW; x += 20) g += pd([[x, 6, fkBH + .05], [x, fkBD - 6, fkBH + .05]], false);
      for (let y = 20; y < fkBD; y += 20) g += pd([[6, y, fkBH + .05], [fkBW - 6, y, fkBH + .05]], false);
      s += `<path d="${g}" fill="none" stroke="#b5dcc0" stroke-width=".6" opacity=".8"/>`;
      const paper = fkPaper(st, m, k), clip = boardTop(0, 0, fkBW, fkBD, fkBH, 8);
      const top = paper.pts.length ? Math.max(...paper.pts.map(p => p[2])) : fkBH;
      const fo = fkFolderPose(st, top), folder = kBone(...fo);
      // weight board (press step): comes down onto the laid-down signature
      let plank = null;
      if (st.weight > 0 && paper.pts.length){ const b = kBoxOf(paper.pts), zt = b[1][2] + 60*(1 - ease(st.weight));
        const y0 = b[0][1] - 8, y1 = b[1][1] + 8, x0 = fkXA - 6, x1 = fkXB + 6;
        const sv = box(x0, y0, zt, x1, y1, zt + 10, color.kWOOD, toneI, 1.4) + box(x0 + 50, (y0 + y1)/2 - 25, zt + 10, x1 - 50, (y0 + y1)/2 + 25, zt + 34, DARK, toneI, 1.4);
        plank = { box: [[x0, y0, zt], [x1, y1, zt + 34]], svg: sv }; }
      s += byDepth([
        paper.pts.length ? { box: kBoxOf(paper.pts), svg: paper.svg } : null,
        { box: folder.box, svg: act('folder', folder.svg) }, plank ]);
      // labels
      const phi = st.phi, zc = paper.zc, R = lay(st, zc), on = i => st.dz[i] != null;
      const s0 = on(0) ? fkSheet(0, phi, zc + st.dz[0], R) : null, sL = on(NY - 1) && NY > 1 ? fkSheet(NY - 1, phi, zc + st.dz[NY - 1], R) : null;
      const items = [], mid = sh => { const p = sh.pts[sh.pts.length - 1], q = sh.pts[sh.pts.length - 2]; return [(p[0]*.35 + q[0]*.65), (p[1]*.35 + q[1]*.65)]; };
      const spine = s0 ? s0.pts[Math.floor(s0.pts.length/2)] : null;
      if (k > .6){
        for (let i = 0; i < Math.min(NY, 6); i++) if (on(i)){ const [y, z] = mid(fkSheet(i, phi, zc + st.dz[i], R)); const n = NUM(i);
          items.push({ at: [fkXA + 20 + (fkHH - 40)*i/Math.max(1, NY - 1), y, z], text: t('learn.s.folding.paper_n', { n: i + 1, a: n[0], b: n[1] }), on: i === 0 }); }
        if (sL) items.push({ at: [fkXA + fkHH/2, ...sL.pts[Math.floor(sL.pts.length/2)]], text: t('learn.s.folding.middle', { a: PG/2, b: PG/2 + 1 }), on: false });
        if (spine) items.push({ at: [fkXB, ...spine], text: phi > .3 ? t('learn.s.folding.spine') : t('learn.s.folding.fold_line'), on: st.creaseT >= 0 });
      } else {
        if (s0){ const [y, z] = mid(s0);
          items.push({ at: [fkXB - 30, y, z], text: NY > 1 ? t('learn.s.folding.outside') : t('learn.s.folding.paper'), on: true });
          if (st.grain > 0 && phi < .6) items.push({ at: [fkXA + 16, y, z], text: t('learn.s.folding.grain'), on: st.lifT >= 0 });
          if (spine) items.push({ at: [fkXB, ...spine], text: phi > .3 ? t('learn.s.folding.spine') : t('learn.s.folding.fold_line'), on: st.creaseT >= 0 || st.lifT >= 0 });
          if (spine && phi < .3) items.push({ at: [fkXA + fkHH*.35, ...spine], text: `${PG} | 1`, on: true }); }
        if (sL){ const p = sL.pts[0]; items.push({ at: [fkXB, p[0], p[1]], text: phi > .6 ? t('learn.s.folding.inside', { n: NY }) : t('learn.s.folding.below', { n: NY }), on: false }); }
        items.push({ at: [fo[0] + 140, fo[1] + 11, fo[2] + 4], text: t('learn.s.folding.boneFolder'), on: st.creaseT >= 0 });
        if (plank) items.push({ at: [fkXB + 6, (plank.box[0][1] + plank.box[1][1])/2, plank.box[0][2] + 5], text: t('learn.s.folding.weight'), on: st.weightT >= 0 });
      }
      s += xrCallouts(items, [0, fkBW, 0, fkBD, 0, fkH]);
      return s;
    }

    /* ---------- behaviour ---------- */
    const busy = (st, ui) => { if (st.anim2){ ui.flash(t('learn.f.busy')); return true; } return false; };
    const step = {
      grain: { action(st, ui){ if (busy(st, ui)) return false;
          ui.flash(t('learn.s.folding.f_grain'), 2600); st.anim2 = true;
          kRun(st, ui, 'lifT', 2.2, u => { st.grain = Math.min(1, u*3); st.phi = .42*Math.sin(Math.PI*Math.min(1, Math.max(0, (u - .25)/.75))); }, () => { st.phi = 0; st.anim2 = false; }); return true; },
        last(st){ st.grain = 1; st.phi = 0; } },
      impose: { action(st, ui){ if (busy(st, ui)) return false;
          if (st.phi > .01) { ui.flash(t('learn.s.folding.f_first_open')); return false; }
          st.dz = new Array(NY).fill(null); st.anim2 = true;
          ui.flash(t('learn.s.folding.f_impose', { p: PG }), 2600);
          const T = (NY - 1)*.4 + .5, lif0 = st.grain;   // the grain lines fade out while stacking (the same end state as last())
          kRun(st, ui, 'dropT', T, u => { st.grain = Math.max(0, lif0*(1 - u*4)); const tt = u*T; for (let i = 0; i < NY; i++){ const t0 = (NY - 1 - i)*.4, w = (tt - t0)/.5; st.dz[i] = w < 0 ? null : w >= 1 ? 0 : 90*(1 - ease(w)); } },
            () => { st.dz = new Array(NY).fill(0); st.grain = 0; st.anim2 = false; }); return true; },
        last(st){ st.dz = new Array(NY).fill(0); st.grain = 0; } },
      fold: { action(st, ui){ if (busy(st, ui)) return false;
          if (st.dz.some(v => v == null)) { ui.flash(t('learn.s.folding.f_impose_first')); return false; }
          if (st.phi > 1.5) { ui.flash(t('learn.s.folding.f_already_folded')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.folding.f_fold'), 2400);
          kRun(st, ui, 'foldT', 1.7, u => { st.phi = ease(u)*Math.PI/2; }, () => { st.anim2 = false; }); return true; },
        last(st){ st.phi = Math.PI/2; } },
      boneFolder: { action(st, ui){ if (busy(st, ui)) return false;
          if (st.phi < Math.PI/2 - .01) { ui.flash(t('learn.s.folding.f_fold_first')); return false; }
          st.anim2 = true; kRun(st, ui, 'creaseT', 4.1, u => { if (u*4.1 > 2.2) st.creased = true; }, () => { st.anim2 = false; st.creaseT = -1; }); return true; },
        last(st){ st.creased = true; st.creaseT = -1; } },
      press: { action(st, ui){ if (busy(st, ui)) return false;
          if (!st.creased) { ui.flash(t('learn.s.folding.f_first_bone_folder')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.folding.f_press', { n: O.N }), 2600);
          kRun(st, ui, 'yatT', 1.2, u => { st.lie = ease(u); }, () => kRun(st, ui, 'weightT', 1, u => { st.weight = u; }, () => { st.anim2 = false; st.folded = O.N; })); return true; },
        last(st){ st.lie = 1; st.weight = 1; st.folded = O.N; } }
    };
    const st0 = { phi: 0, dz: [0].concat(new Array(NY - 1).fill(null)), grain: 0, lifT: -1, dropT: -1, foldT: -1, creaseT: -1, creased: false, lie: 0, yatT: -1, weight: 0, weightT: -1, folded: 0, anim: 0, anim2: false };
    return {
      step,
      cfg: {
        title: t('learn.folding.name'), credit: false, size: [fkBW, fkBD, fkH], state: st0, scene: fkScene,
        stats: st => [{ label: t('learn.s.folding.st_page'), value: st.dz.filter(v => v != null).length*4 }, { label: t('learn.s.folding.st_folded'), value: t('learn.s.folding.st_folded_v', { a: st.folded, n: O.N }), small: true }],
        acts: { folder: () => { if (o.run) o.run('boneFolder'); } }
      }
    };
  };
})(typeof self !== 'undefined' ? self : this);
