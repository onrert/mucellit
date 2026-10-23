/*
 * sekil/forza.js — Aşama 4: forzaları katlama ve bloğa ince tutkal şeridiyle takma (sırt tutkalından ÖNCE).
 * LİSANS NOTU (MIT): Colorfigures motoru ve yöntemiyle yapıldı. MIT License. Copyright (c) 2026 April Zhu
 * (Colorfigures; iso-glow) ve Tolga Cohce (iso-figure). Tam metin: LICENSE.
 *
 * Gerçekte nasıl: forza (yan kâğıdı) blok eninin iki katı genişlikte (2W × H) kesilir ve ortadan katlanır (MEB-2021
 * s.48). Bloğun ilk ve son formasının dış yüzüne, sırt kenarı boyunca 3–5 mm'lik ince bir tutkal şeridi sürülür;
 * katlı forza katı sırta tam hizalı gelecek biçimde konup bastırılır ("tipping on"). Sırt tutkalından ÖNCE yapılır
 * (MEB-2021 s.48-49 sırası; Cockerell satır 1562: sonradan yapıştırmak hata). Seçim gerekçesi (forzayı blokla birlikte
 * dikmek yerine): ek dikiş gerektirmez, her forma sayısında aynıdır, ilk kitap için basittir.
 * Alt forza (teyit: MEB-2021 s.54 adım 11, Bean satır 1991): blok çevrilir ve ilk taraftaki işlem son
 * formada tekrarlanır: sırt kenarına ince şerit, ikinci forza katı sırta hizalı. Çevirme x ekseni çevresinde (sırt
 * öbür yana geçer); ilk forza bloğun altına gelir.
 * Koordinat: x = sırt boyu, y = genişlik (+y izleyicinin solu; blok sırtı +y'de), z = yukarı; 1 birim = 1 mm.
 * Blok gerçek ölçekte (kalınlık = sırt S); forza kâğıdı kalınlığı 0,6 mm'ye büyütüldü.
 * PARÇALAR: kesme altlığı · dikilmiş blok (N forma katı, sırtta dikiş izi ve kettle zinciri) · 2 forza (açık → katlı) ·
 *   tutkal şeritleri · fırça. ÇİZİM: hepsi x boyunca: (y, z) kesitinde 2B ressam sıralaması (xSort).
 */
'use strict';
(function (kok) {
  const KC = kok.KitapCilt.ogren, { pd, on, toneI, ease, ink, fill, face, shape, boardTop, xrCallouts } = KC.cf;
  KC.sekil.forza = function (o) {
    const { xSort, xPrism, kRect, kRot, kRun, kLerp, kSeg, kMat, kBlockItems, kGeo, kSirtDikis, kBrush, renk } = KC.ortak, O = o.olcu, t = o.t;
    const G = Object.assign(kGeo(O), { XK0: 40, XK1: 40 + O.H });
    const W = O.W, S = O.S, BH = 4, TF = .6;                      // TF: bir forza yaprağının çizim kalınlığı
    const ya = 20, yc = ya + W, y0 = ya + 2*W + 40, y1 = y0 + W;
    const matW = G.XK1 + 40, matD = y1 + 45, HMAX = Math.max(90, W*.75);
    const ST = O.istasyon.konum.map(v => G.XK0 + v), SERIT = 4;
    const kENDP = renk.kENDP;

    // katlı forza: [yA, yA + W] × [z, z + 2TF], katı +y kenarında
    function forzaItems(items, yA, z, o2 = {}){
      const face = (i, n, Q) => { const at = (x, tt) => [x, kLerp(Q[0][1], Q[3][1], tt) + n[1]*.05, kLerp(Q[0][2], Q[3][2], tt) + n[2]*.05];
        let s = shape(Q, toneI(n, kENDP), .9);
        if (i === 3) s += ink(pd([at(G.XK0, .5), at(G.XK1, .5)], false), .5);
        if (i === 2 && o2.serit > 0){ const w = Math.hypot(Q[3][1] - Q[0][1], Q[3][2] - Q[0][2]), e = SERIT/w;
          s += `<path d="${pd([at(G.XK0, 0), at(kLerp(G.XK0, G.XK1, o2.serit), 0), at(kLerp(G.XK0, G.XK1, o2.serit), e), at(G.XK0, e)])}" fill="#fff3b8" opacity=".85"/>`; }
        return s; };
      return xPrism(kRect(yA, z, yA + W, z + 2*TF, o2.tr || undefined), G.XK0, G.XK1, kENDP, items, { face, w: .9, bias: o2.bias || .002 });
    }
    // açık forza çifti (katlanırken): sabit yarı + menteşede dönen yarı (θ)
    function acikItems(items, th){
      const pts = [];
      for (let j = 0; j < 2; j++){ const z = BH + j*TF;
        pts.push(...xPrism(kRect(ya, z, yc, z + TF), G.XK0, G.XK1, kENDP, items, { w: .9 }));
        const h = [yc, BH + 2*TF], r = TF*(1.5 - j);           // üstteki yaprak içte
        const R = p => kRot(p, h, th);
        pts.push(...xPrism(kRect(yc, h[1] - r - TF + TF*j*0, yc + W, h[1] - r + TF*0).map(p => [p[0], p[1]]).map(R), G.XK0, G.XK1, kENDP, items, { w: .9, bias: .001*(j + 1) })); }
      return pts;
    }

    function scene(st, m){
      const k = ease(st.xr || 0), items = [];
      let s = kMat(matW, matD, BH);
      const all = [], ptsP = [];
      // blok + üst forza birlikte kalkar ve x ekseni çevresinde çevrilir (alt forza için)
      const ce = ease(st.cevir || 0), zb = BH + 40*st.kalk, zc = zb + (S + 2*TF)/2, yc = y0 + W/2;
      const tr = ce > 0 ? p => kRot(p, [yc, zc], Math.PI*ce) : p => p;
      const strip = (at, t0, t1, u) => `<path d="${pd([at(G.XK0, t0), at(kLerp(G.XK0, G.XK1, u), t0), at(kLerp(G.XK0, G.XK1, u), t1), at(G.XK0, t1)])}" fill="#fff3b8" opacity=".85"/>`;
      const text = (i, at) => { let sv = '';
        if (i === 1) sv += kSirtDikis(at, O.N, ST, .8);
        if (i === 2 && st.serit > 0) sv += strip(at, 0, SERIT/W, st.serit);
        if (i === 0 && st.serit2 > 0) sv += strip(at, 1, 1 - SERIT/W, st.serit2);   // çevrilmiş blokta son formanın sırt kenarı
        return sv; };      all.push(...kBlockItems(G, y0, zb, items, { th: S, mull: false, kapital: false, forza: false, k, text, op: 1 - .5*k, tr }));
      // forzalar
      if (st.katla < 1) ptsP.push(...acikItems(items, st.katla*Math.PI));
      else {
        // F1 (ikinci forza): yığında → havada çevrilerek çevrilmiş bloğun üstüne, katı sırta (artık y0 yanında) hizalı
        const u1 = kSeg(st.altT, .68, 1), top = BH + 2*TF + S;
        const yF1 = kLerp(ya, y0, u1), zF1 = kLerp(BH, top, u1) + Math.sin(Math.PI*u1)*35, c1 = [yF1 + W/2, zF1 + TF];
        (u1 > .5 ? all : ptsP).push(...forzaItems(items, yF1, zF1, { bias: .003, tr: u1 > 0 ? p => kRot(p, c1, Math.PI*u1) : null }));
        // F0 (üst forza): yığında (F1'in üstünde) → bloğun üstüne; blok çevrilince onunla birlikte alta geçer
        const u0 = st.ust;
        const zTop = zb + S, yF0 = kLerp(ya, y0, u0), zF0 = kLerp(BH + 2*TF, zTop, u0) + Math.sin(Math.PI*u0)*35;
        (u0 > .5 ? all : ptsP).push(...forzaItems(items, yF0, zF0, { bias: .004, tr: u0 >= 1 ? tr : null }));
      }
      // fırça
      if (st.firca){ const p = st.firca; items.push({ a: [p[1], p[2] + 3], r: 7, bias: .2, svg: kBrush(p[0], p[1], p[2], 'x') }); }
      const yS = ce >= .5 ? y0 : y1, zU = ce >= .5 ? BH + 2*TF + S : zb + S;   // sırt yanı ve blok üstü (çevrilmeden önce/sonra)
      s += xSort(items);
      // etiketler
      const LB = [];
      if (k > .6){
        LB.push({ at: [G.XK1, ...tr([y1 - .5, zb + S/2])], text: t('ogren.s.forza.blok_kesit', { n: O.N }), on: false });
        LB.push({ at: [(ST[1] + ST[2])/2, ...tr([y1, zb + S/2])], text: t('ogren.s.forza.dikis'), on: false });
      } else {
        LB.push({ at: [G.XK0 + 30, ...tr([y1, zb + S/2])], text: t('ogren.s.forza.sirt'), on: false });
        if (st.katla < 1) LB.push({ at: [G.XK1 - 20, ya + W*.5, BH + 1.2], text: t('ogren.s.forza.acik', { a: o.sayi(2*W), b: o.sayi(O.H) }), on: st.katlaT >= 0 });
        else if (st.ust < 1) LB.push({ at: [G.XK1 - 20, ya + W*.4, BH + 4*TF], text: t('ogren.s.forza.katli'), on: st.katlaT >= 0 });
        if (st.serit > 0 && st.ust < .5) LB.push({ at: [G.XK0 + 60, y1 - 2, zb + S], text: t('ogren.s.forza.serit'), on: st.seritT >= 0 });
        if (st.serit2 > 0 && st.serit2 < 1) LB.push({ at: [G.XK0 + 60, y0 + 2, zU], text: t('ogren.s.forza.serit'), on: true });
        if (st.ust >= 1 && ce < .5) LB.push({ at: [G.XK1 - 30, y0 + W*.5, zb + S + 2*TF], text: t('ogren.s.forza.ust'), on: st.ustT >= 0 });
        if (st.alt >= 1 || kSeg(st.altT, .68, 1) > .5) LB.push({ at: [G.XK1 - 30, y0 + W*.5, zU + 2*TF], text: t('ogren.s.forza.alt'), on: st.altT >= 0 && st.alt < 1 });
        if (st.ust >= 1) LB.push({ at: [G.XK0 + 6, yS, zU + TF], text: t('ogren.s.forza.kat_hizali'), on: false });
      }
      s += xrCallouts(LB, [0, matW, 0, matD, 0, HMAX]);
      return s;
    }
    const mesgul = (st, ui) => { if (st.anim2){ ui.flash(t('ogren.f.mesgul')); return true; } return false; };
    const bitir = st => { st.anim2 = false; st.firca = null; };
    const fircaX = u => kLerp(G.XK0 + 8, G.XK1 - 8, u);
    const adim = {
      katla: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.katla >= 1){ ui.flash(t('ogren.s.forza.f_katli')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.forza.f_katla'), 2400);
          kRun(st, ui, 'katlaT', 1.8, u => { st.katla = ease(u); }, () => { st.katla = 1; bitir(st); }); return true; },
        son(st){ st.katla = 1; } },
      tutkal: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.katla < 1){ ui.flash(t('ogren.s.forza.f_once_katla')); return false; }
          if (st.serit >= 1){ ui.flash(t('ogren.s.forza.f_serit_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.forza.f_serit'), 2600);
          kRun(st, ui, 'seritT', 1.8, u => { st.serit = u; st.firca = [fircaX(u), y1 - 2, BH + S + .4]; }, () => { st.serit = 1; bitir(st); }); return true; },
        son(st){ st.serit = 1; } },
      ust: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.serit < 1){ ui.flash(t('ogren.s.forza.f_once_serit')); return false; }
          if (st.ust >= 1){ ui.flash(t('ogren.s.forza.f_ust_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.forza.f_ust'), 2400);
          kRun(st, ui, 'ustT', 1.6, u => { st.ust = ease(u); }, () => { st.ust = 1; bitir(st); }); return true; },
        son(st){ st.ust = 1; } },
      alt: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.ust < 1){ ui.flash(t('ogren.s.forza.f_once_ust')); return false; }
          if (st.alt >= 1){ ui.flash(t('ogren.s.forza.f_alt_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.forza.f_alt'), 3000);
          // kalk (0–.12) → çevir (.12–.42) → in (.42–.52) → son formanın sırt kenarına şerit (.52–.68) → ikinci forza (.68–1)
          kRun(st, ui, 'altK', 4.4, u => { st.altT = u; st.kalk = u < .12 ? kSeg(u, 0, .12) : u < .42 ? 1 : 1 - kSeg(u, .42, .52);
            st.cevir = kSeg(u, .12, .42); st.serit2 = kSeg(u, .52, .68);
            st.firca = u > .52 && u < .68 ? [fircaX(st.serit2), y0 + 2, BH + 2*TF + S + .4] : null; st.alt = u >= .999 ? 1 : 0; },
            () => { st.alt = 1; st.kalk = 0; st.altT = 1; st.serit2 = 1; st.cevir = 1; bitir(st); }); return true; },
        son(st){ st.alt = 1; st.altT = 1; st.serit2 = 1; st.kalk = 0; st.cevir = 1; } }
    };
    const st0 = { katla: 0, katlaT: -1, serit: 0, seritT: -1, ust: 0, ustT: -1, alt: 0, altT: -1, kalk: 0, serit2: 0, cevir: 0, firca: null, anim: 0, anim2: false };
    return { adim, cfg: {
      title: t('ogren.forza.ad'), credit: false, size: [matW, matD, HMAX], state: st0, scene,
      stats: st => [{ label: t('ogren.s.forza.st_forza'), value: t('ogren.s.forza.st_v', { a: (st.ust >= 1 ? 1 : 0) + (st.alt >= 1 ? 1 : 0), n: 2 }) }, { label: t('ogren.s.forza.st_serit'), value: t('ogren.mm_aralik', { a: 3, b: 5 }), small: true }]
    } };
  };
})(typeof self !== 'undefined' ? self : this);
