/*
 * figures/folding.js — Aşama 1: kâğıt lif yönü, forma dizimi, katlama, kemik, ağırlık altında bekletme.
 * LİSANS NOTU (MIT): Colorfigures motoru ve yöntemiyle yapıldı (ilk sürüm: Öğren prototipi, Şekil 1).
 * MIT License. Copyright (c) 2026 April Zhu (Colorfigures; iso-glow) ve Tolga Cohce (iso-figure). Tam metin: LICENSE.
 *
 * Gerçekte nasıl: bir forma y adet baskı kâğıdından (2W × H) oluşur; her kâğıdın iki yüzüne yan yana iki sayfa basılır.
 * p = 4y sayfalık formada i. kâğıt (0 = en üst): dış yüz [p − 2i | 1 + 2i], iç yüz [p − 1 − 2i | 2 + 2i]
 * (y = 4: 16|1, 14|3, 12|5, 10|7; ortada 8|9). Kâğıtlar 1. kâğıt üstte, "p | 1" yüzü yukarı dizilir ve deste ortadan
 * katlanır (yarılar aşağı iner): 1. kâğıt dışta kalır (elle deneme). Katlama çizgisi kemikle
 * bastırılır; formalar ağırlık altında bekletilir. Lif: A4'te lif çoğunlukla uzun kenara paralel (Brighton-grain), A5'e
 * katlayınca kat liflere dik düşer.
 * Koordinat: x = sayfa boyu (fkXA … fkXA + H), y = genişlik (+y izleyicinin solu), z = yukarı; 1 birim = 1 mm.
 * Kâğıt arası 2,6 mm'ye büyütüldü (gerçekte ~0,1 mm), yoksa kâğıtlar tek çizgi görünür.
 * PARÇALAR: kesme altlığı · y kâğıt (iki yarı + kıvrım) · baskı (satırlar, sayfa numarası) · lif çizgileri · kemik ·
 *   ağırlık tahtası. ÇİZİM: kâğıt şeritleri (y, z) kesitinde 2B ressam sıralaması (xSort); kemik ve tahta byDepth.
 */
'use strict';
(function (kok) {
  const KC = kok.KitapCilt.ogren, { DARK, byDepth, f, pd, on, vis, tone, toneI, ease, ink, fill, face, box, boardTop, board, act, xrCallouts } = KC.cf;
  KC.sekil.katlama = function (o) {
    const { xSort, kText, kBoxOf, kRun, kBone, renk } = KC.ortak, O = o.olcu, t = o.t;
    const fkPAPER = renk.kPAPER, fkMAT = renk.kMAT;
    const NY = O.y, PG = 4 * NY, fkL = O.W, fkHH = O.H;
    const fkXA = 20, fkXB = fkXA + fkHH, fkYF = fkL + 52, fkG = 2.6, fkR0 = 1.4, fkBH = 4;
    const fkBW = fkHH + 40, fkBD = 2 * fkL + 103, fkH = fkL + 30;
    const SC = Math.min(fkL / 148, fkHH / 210);
    const NUM = i => [PG - 2 * i, 1 + 2 * i, PG - 1 - 2 * i, 2 + 2 * i];
    const fkAdd = (p, d, k) => [p[0] + d[0]*k, p[1] + d[1]*k, p[2] + d[2]*k];
    // yatırma (pres adımı): kesit noktası (y, z) kat çevresinde -90° döner ve masaya iner
    const yatir = (st, zc) => { const a = -Math.PI/2 * st.yat; if (!a) return p => p;
      const c = Math.cos(a), s = Math.sin(a), hy = fkYF, hz = zc, dz = (fkBH + .6 + fkR0 + (NY - 1)*fkG - hz) * st.yat, dy = (fkL*.5) * st.yat;
      return p => [hy + (p[0] - hy)*c - (p[1] - hz)*s + dy, hz + (p[0] - hy)*s + (p[1] - hz)*c + dz]; };
    const yatirN = st => { const a = -Math.PI/2 * st.yat, c = Math.cos(a), s = Math.sin(a); return n => [n[0], n[1]*c - n[2]*s, n[1]*s + n[2]*c]; };

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
      const phi = st.phi, zc = fkZc(phi), items = [], all = [], R = yatir(st, zc), RN = yatirN(st);
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
            // lif çizgileri (1. kâğıdın üst yüzünde, uzun kenara paralel)
            if (i === 0 && st.lif > 0 && outerSeen){ let g = ''; const e2 = [0, edge[0] - fold[0], edge[1] - fold[1]], L2 = Math.hypot(e2[1], e2[2]);
              for (let x = fkXA + 10; x < fkXB - 4; x += 12){ g += pd([[x, fold[0] + seen[1]*.5, fold[1] + seen[2]*.5], [x, fold[0] + e2[1]*.92 + seen[1]*.5, fold[1] + e2[2]*.92 + seen[2]*.5]], false); }
              void L2; sv += `<g opacity="${f(.85*st.lif)}"><path d="${g}" fill="none" stroke="#8a6a3c" stroke-width="1" stroke-dasharray="7 4"/></g>`; }
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
      // ağırlık tahtası (pres adımı): yatırılmış formanın üstüne iner
      let plank = null;
      if (st.agirlik > 0 && paper.pts.length){ const b = kBoxOf(paper.pts), zt = b[1][2] + 60*(1 - ease(st.agirlik));
        const y0 = b[0][1] - 8, y1 = b[1][1] + 8, x0 = fkXA - 6, x1 = fkXB + 6;
        const sv = box(x0, y0, zt, x1, y1, zt + 10, renk.kWOOD, toneI, 1.4) + box(x0 + 50, (y0 + y1)/2 - 25, zt + 10, x1 - 50, (y0 + y1)/2 + 25, zt + 34, DARK, toneI, 1.4);
        plank = { box: [[x0, y0, zt], [x1, y1, zt + 34]], svg: sv }; }
      s += byDepth([
        paper.pts.length ? { box: kBoxOf(paper.pts), svg: paper.svg } : null,
        { box: folder.box, svg: act('folder', folder.svg) }, plank ]);
      // etiketler
      const phi = st.phi, zc = paper.zc, R = yatir(st, zc), on = i => st.dz[i] != null;
      const s0 = on(0) ? fkSheet(0, phi, zc + st.dz[0], R) : null, sL = on(NY - 1) && NY > 1 ? fkSheet(NY - 1, phi, zc + st.dz[NY - 1], R) : null;
      const items = [], mid = sh => { const p = sh.pts[sh.pts.length - 1], q = sh.pts[sh.pts.length - 2]; return [(p[0]*.35 + q[0]*.65), (p[1]*.35 + q[1]*.65)]; };
      const spine = s0 ? s0.pts[Math.floor(s0.pts.length/2)] : null;
      if (k > .6){
        for (let i = 0; i < Math.min(NY, 6); i++) if (on(i)){ const [y, z] = mid(fkSheet(i, phi, zc + st.dz[i], R)); const n = NUM(i);
          items.push({ at: [fkXA + 20 + (fkHH - 40)*i/Math.max(1, NY - 1), y, z], text: t('ogren.s.katlama.kagit_n', { n: i + 1, a: n[0], b: n[1] }), on: i === 0 }); }
        if (sL) items.push({ at: [fkXA + fkHH/2, ...sL.pts[Math.floor(sL.pts.length/2)]], text: t('ogren.s.katlama.orta', { a: PG/2, b: PG/2 + 1 }), on: false });
        if (spine) items.push({ at: [fkXB, ...spine], text: phi > .3 ? t('ogren.s.katlama.sirt') : t('ogren.s.katlama.kat_cizgisi'), on: st.creaseT >= 0 });
      } else {
        if (s0){ const [y, z] = mid(s0);
          items.push({ at: [fkXB - 30, y, z], text: NY > 1 ? t('ogren.s.katlama.dista') : t('ogren.s.katlama.kagit'), on: true });
          if (st.lif > 0 && phi < .6) items.push({ at: [fkXA + 16, y, z], text: t('ogren.s.katlama.lif'), on: st.lifT >= 0 });
          if (spine) items.push({ at: [fkXB, ...spine], text: phi > .3 ? t('ogren.s.katlama.sirt') : t('ogren.s.katlama.kat_cizgisi'), on: st.creaseT >= 0 || st.lifT >= 0 });
          if (spine && phi < .3) items.push({ at: [fkXA + fkHH*.35, ...spine], text: `${PG} | 1`, on: true }); }
        if (sL){ const p = sL.pts[0]; items.push({ at: [fkXB, p[0], p[1]], text: phi > .6 ? t('ogren.s.katlama.icte', { n: NY }) : t('ogren.s.katlama.altta', { n: NY }), on: false }); }
        items.push({ at: [fo[0] + 140, fo[1] + 11, fo[2] + 4], text: t('ogren.s.katlama.kemik'), on: st.creaseT >= 0 });
        if (plank) items.push({ at: [fkXB + 6, (plank.box[0][1] + plank.box[1][1])/2, plank.box[0][2] + 5], text: t('ogren.s.katlama.agirlik'), on: st.agirlikT >= 0 });
      }
      s += xrCallouts(items, [0, fkBW, 0, fkBD, 0, fkH]);
      return s;
    }

    /* ---------- davranış ---------- */
    const mesgul = (st, ui) => { if (st.anim2){ ui.flash(t('ogren.f.mesgul')); return true; } return false; };
    const adim = {
      lif: { eylem(st, ui){ if (mesgul(st, ui)) return false;
          ui.flash(t('ogren.s.katlama.f_lif'), 2600); st.anim2 = true;
          kRun(st, ui, 'lifT', 2.2, u => { st.lif = Math.min(1, u*3); st.phi = .42*Math.sin(Math.PI*Math.min(1, Math.max(0, (u - .25)/.75))); }, () => { st.phi = 0; st.anim2 = false; }); return true; },
        son(st){ st.lif = 1; st.phi = 0; } },
      diz: { eylem(st, ui){ if (mesgul(st, ui)) return false;
          if (st.phi > .01) { ui.flash(t('ogren.s.katlama.f_once_ac')); return false; }
          st.dz = new Array(NY).fill(null); st.anim2 = true;
          ui.flash(t('ogren.s.katlama.f_diz', { p: PG }), 2600);
          const T = (NY - 1)*.4 + .5, lif0 = st.lif;   // lif çizgileri dizerken söner (son() ile aynı son durum)
          kRun(st, ui, 'dropT', T, u => { st.lif = Math.max(0, lif0*(1 - u*4)); const tt = u*T; for (let i = 0; i < NY; i++){ const t0 = (NY - 1 - i)*.4, w = (tt - t0)/.5; st.dz[i] = w < 0 ? null : w >= 1 ? 0 : 90*(1 - ease(w)); } },
            () => { st.dz = new Array(NY).fill(0); st.lif = 0; st.anim2 = false; }); return true; },
        son(st){ st.dz = new Array(NY).fill(0); st.lif = 0; } },
      katla: { eylem(st, ui){ if (mesgul(st, ui)) return false;
          if (st.dz.some(v => v == null)) { ui.flash(t('ogren.s.katlama.f_once_diz')); return false; }
          if (st.phi > 1.5) { ui.flash(t('ogren.s.katlama.f_zaten_katli')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.katlama.f_katla'), 2400);
          kRun(st, ui, 'foldT', 1.7, u => { st.phi = ease(u)*Math.PI/2; }, () => { st.anim2 = false; }); return true; },
        son(st){ st.phi = Math.PI/2; } },
      kemik: { eylem(st, ui){ if (mesgul(st, ui)) return false;
          if (st.phi < Math.PI/2 - .01) { ui.flash(t('ogren.s.katlama.f_once_katla')); return false; }
          st.anim2 = true; kRun(st, ui, 'creaseT', 4.1, u => { if (u*4.1 > 2.2) st.creased = true; }, () => { st.anim2 = false; st.creaseT = -1; }); return true; },
        son(st){ st.creased = true; st.creaseT = -1; } },
      pres: { eylem(st, ui){ if (mesgul(st, ui)) return false;
          if (!st.creased) { ui.flash(t('ogren.s.katlama.f_once_kemik')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.katlama.f_pres', { n: O.N }), 2600);
          kRun(st, ui, 'yatT', 1.2, u => { st.yat = ease(u); }, () => kRun(st, ui, 'agirlikT', 1, u => { st.agirlik = u; }, () => { st.anim2 = false; st.katli = O.N; })); return true; },
        son(st){ st.yat = 1; st.agirlik = 1; st.katli = O.N; } }
    };
    const st0 = { phi: 0, dz: [0].concat(new Array(NY - 1).fill(null)), lif: 0, lifT: -1, dropT: -1, foldT: -1, creaseT: -1, creased: false, yat: 0, yatT: -1, agirlik: 0, agirlikT: -1, katli: 0, anim: 0, anim2: false };
    return {
      adim,
      cfg: {
        title: t('ogren.katlama.ad'), credit: false, size: [fkBW, fkBD, fkH], state: st0, scene: fkScene,
        stats: st => [{ label: t('ogren.s.katlama.st_sayfa'), value: st.dz.filter(v => v != null).length*4 }, { label: t('ogren.s.katlama.st_katli'), value: t('ogren.s.katlama.st_katli_v', { a: st.katli, n: O.N }), small: true }],
        acts: { folder: () => { if (o.calistir) o.calistir('kemik'); } }
      }
    };
  };
})(typeof self !== 'undefined' ? self : this);
