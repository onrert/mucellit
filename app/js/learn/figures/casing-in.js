/*
 * figures/casing-in.js — Aşama 8 (bloğu kapağa takma) ve 9 (preste kurutma).
 * LİSANS NOTU (MIT): Colorfigures motoru ve yöntemiyle yapıldı (ilk sürüm: Öğren prototipi, Şekil 5).
 * MIT License. Copyright (c) 2026 April Zhu (Colorfigures; iso-glow) ve Tolga Cohce (iso-figure). Tam metin: LICENSE.
 *
 * Gerçekte nasıl (MEB-2021 s.77; Talas-case; Hollander; Bean satır 2045-2058): tutkaldan ÖNCE blok kapağa kuru oturtulur,
 * taşmalar eşitlenir, ağızda mukavvaya kurşunkalemle işaret konur, blok yanına geri çevrilir.
 * Blok kapağın yanında yatarken dıştaki forza yaprağının altına
 * atık kâğıt konur, forzaya ve sırt bezi kanadına ince tutkal sürülür, atık kâğıt çıkarılır (MEB s.77 adım 5); blok
 * çevrilip tutkallı yüzü mukavvaya gelecek
 * biçimde oturtulur: sırt sırt şeridine dayanır, baş/etek/ağızda taşma eşit kalır (havadan bırakılmaz: ön kenar
 * üzerinden çevrilir). Üst forza tutkallanır, kapak kapatılır. Mafsal oluğu kemikle bastırılır. Sonra (Aşama 9) forza
 * ile blok arasına mumlu kâğıt, mafsal oluklarına şiş konur, kitap preste kurutulur (MEB s.77 adım 10: 24 saat).
 * Pres: kitap pres yatağının üstünde; baskı tablası kitabın üstüne iner (sıralamada kitabın önünde).
 * Model: kapak iki düz menteşeyle kapanır (mafsal boşluğu modelde f + t; common.js kGeo notu). Bez oluğa çökmez.
 * Koordinat: x = sırt boyu, y = genişlik, z = yukarı; 1 birim = 1 mm.
 * PARÇALAR: kesme altlığı · kapak: iki mukavva (iç yüzde kıvırma payları), sırt şeridi, mafsal bezleri · blok: forzalar,
 *   sırt bezi kanatları, ön kenar, kesitler, kapitaller · fırça · kemik · mumlu kâğıtlar · iki şiş · pres (dikmeler,
 *   kiriş, vida, tabla). ÇİZİM: kapak, blok, şişler, mumlu kâğıt (x boyunca) xSort; pres parçaları byDepth.
 */
'use strict';
(function (root) {
  const MC = root.Mucellit.learn, { PALS, INK, byDepth, f, pd, on, toneI, ease, box, rod, boardTop, xrCallouts } = MC.cf;
  MC.figures.casingIn = function (o) {
    const { xSort, xPrism, kRect, kRot, kRun, kOrder, kLerp, kSeg, kMat, kBlockItems, kCaseItems, kGeo, kChain, kBone, kBrush, color } = MC.common, O = o.size, t = o.t;
    const PRES = o.stage === 'press', BED = PRES ? 10 : 0;   // pres yatağı kalınlığı (kitap yatağın üstünde)
    const G = kGeo(O, { RB0: PRES ? 40 : O.W + 40, zc: PRES ? 4 + BED + .4 : undefined }), S = O.S, T = G.T, BH = G.BH, s5WOOD = color.kWOOD, s5STEEL = color.kSTEEL;
    const kATIK = { l:'#eef1f2', m:'#d3d9dc', d:'#9ea7ac' };        // atık kâğıt (gri gazete kâğıdı)
    const zb = G.zc + T, hY = G.K0 - 6, hZ = (BH + zb + S)/2;          // blok çevirme ekseni
    const W2 = G.matW, D2 = PRES ? G.S0 + 60 : G.matD, xm = (G.XB0 + G.XB1)/2;
    const bookTop = G.zc + G.R, yJ = G.S0 - G.g/2;                  // kapalı kitabın üstü, üst mafsal oluğu (y)
    const HMAX = Math.max(175, bookTop + 140);
    const yP0 = G.RB0 - 15, yP1 = G.S0 + 17, yPc = (yP0 + yP1)/2;     // pres tablası
    const zt0 = G.zc + T;                                             // açık kapakta mukavvanın üst yüzü (işaret, atık kâğıt)
    // kuru deneme: blok kapağa çevrilir (0–.4), oturur ve işaretlenir (.4–.62), yanına geri çevrilir (.62–1)
    const deneY = u => u <= 0 || u >= 1 ? 0 : u < .4 ? kSeg(u, 0, .4) : u < .62 ? 1 : 1 - kSeg(u, .62, 1);

    function scene(st, m){
      const k = ease(st.xr || 0), items = [];
      let s = kMat(W2, D2, BH);
      const ch = kChain(G, Math.PI/2*kSeg(st.c, 0, .45), Math.PI/2*kSeg(st.c, .5, 1)), cop = 1 - .72*k;
      const all = kCaseItems(G, ch, m, items, { op: cop, paste: st.c >= 1, groove: st.groove, title: st.c >= 1 ? t('learn.s.book.kapak1') : null, title2: st.c >= 1 ? t('learn.s.book.kapak2') : null });
      // blok: çevrilmemiş (yanda, ters) → kapakta; kuru denemede gidip gelir
      const yerE = Math.max(st.place, deneY(st.attempt)), psi = Math.PI*(1 - ease(yerE)), tr = p => kRot(p, [hY, hZ], psi);
      all.push(...kBlockItems(G, G.K0, zb, items, { tr, glue: st.glueU, glueAlt: st.glueA, k, m: PALS.tomato, op: 1 }));
      // kurşunkalem işareti: ağız hizasında, mukavvanın iç yüzünde baş ve etek köşelerinde L (kuru denemede konur)
      if (st.mark > 0){ const y = G.K0, z = zt0 + .06, L = 24*ease(Math.min(1, st.mark)), d = pd([[G.XK0 + L, y, z], [G.XK0, y, z], [G.XK0, y + 12, z]], false) + pd([[G.XK1 - L, y, z], [G.XK1, y, z], [G.XK1, y + 12, z]], false);
        items.push({ a: [y - .5, z], b: [y + 8, z], bias: .015, svg: `<path d="${d}" fill="none" stroke="#34333a" stroke-width="2" stroke-linecap="round"/>` }); }
      // atık kâğıt: tutkallanan forza yaprağının altında, ağızda 12 mm taşar; tutkaldan sonra ağız yönünde çekilip çıkarılır
      for (const [v, zz, trr] of [[st.atikA, zb + .25, tr], [st.atikU, zb + S - .45, p => p]]){ if (!(v > 0)) continue;
        const dx = -(O.H + 30)*(1 - v);   // görünen kısım: ağızdan dışarıdaki şerit; çıkarılırken baş yönünde çekilir
        xPrism(kRect(G.K0 - 12, zz, G.K0, zz + .2, trr), G.XK0 - 6 + dx, G.XK1 + 6 + dx, kATIK, items, { w: .7, op: Math.min(1, v*3), bias: .025 }); }
      // mumlu kâğıtlar (forza ile blok arasında; ön kenarda taşar)
      if (st.wax > 0){ const dy = -50*(1 - ease(st.wax)), y0 = G.K0 - 10 + dy, y1 = G.K1 - 8;
        for (const z of [zb - .25, zb + S]) all.push(...xPrism(kRect(y0, z, y1, z + .25), G.XK0 + 3, G.XK1 - 3, color.kWAX, items, { w: .7, op: .9, bias: .03 })); }
      // şişler (üst ve alt mafsal oluğunda)
      if (st.mist > 0){ const dz = 40*(1 - ease(st.mist));
        for (const [z, b] of [[bookTop + 2 + dz, .06], [G.zc + 1.6, -.02]]){
          const sv = rod([G.XB0 - 8, yJ, z], [G.XB1 + 8, yJ, z], 2, s5STEEL, toneI, .9, 2, 12);
          items.push({ a: [yJ, z], r: 2, bias: b, svg: kOp1(sv) }); } }
      // fırça (tutkal sürerken)
      if (st.brush) items.push({ a: [st.brush[1], st.brush[2] + 3], r: 6, bias: .2, svg: kBrush(xm, st.brush[1], st.brush[2], 'y') });
      // kemik (mafsal oluğunda)
      if (st.boneFolderT >= 0){ const u = st.boneFolderX, bn = kBone(kLerp(G.XB0 - 10, G.XB1 - 140, u), yJ - 11, bookTop + .4);
        items.push({ a: [yJ - 11, bookTop + 2], b: [yJ + 11, bookTop + 2], bias: .3, svg: bn.svg }); }
      const parts = [];
      // pres yatağı (kitap üstünde durur)
      if (PRES){ const yb = box(G.XB0 - 14, yP0, BH, G.XB1 + 14, yP1, BH + BED, s5WOOD, toneI, 1.4);
        parts.push({ box: [[G.XB0 - 14, yP0, BH], [G.XB1 + 14, yP1, BH + BED]], svg: yb }); }
      // kitap katmanı: kutu üstü kitabın (ve şişlerin) üstünde biter; baskı tablası z'de ayrık kalır, önde çizilir
      parts.push({ box: [[G.XB0 - 8, 20, BH + BED], [G.XB1 + 8, D2 - 20, st.press > 0 ? bookTop + 4.2 : HMAX]], svg: xSort(items) });
      // pres
      if (st.press > 0){ const pz = kLerp(bookTop + 70, bookTop + 4.2, ease(st.press)), zK = bookTop + 120, xc = xm;
        for (const [x0, x1] of [[6, 22], [W2 - 22, W2 - 6]]) parts.push({ box: [[x0, yPc - 18, BH], [x1, yPc + 18, zK]], svg: box(x0, yPc - 18, BH, x1, yPc + 18, zK, s5WOOD, toneI, 1.4) });
        parts.push({ box: [[6, yPc - 18, zK], [W2 - 6, yPc + 18, zK + 16]], svg: box(6, yPc - 18, zK, W2 - 6, yPc + 18, zK + 16, s5WOOD, toneI, 1.6) });
        parts.push({ box: [[xc - 4, yPc - 4, pz + 12], [xc + 4, yPc + 4, zK]], svg: rod([xc, yPc, pz + 12], [xc, yPc, zK + 22], 3.6, s5STEEL, toneI, 1, 3.6, 12) + rod([xc - 26, yPc, zK + 22], [xc + 26, yPc, zK + 22], 2.4, s5STEEL, toneI, 1, 2.4, 10) });
        parts.push({ box: [[G.XB0 - 11, yP0, pz], [G.XB1 + 11, yP1, pz + 12]], svg: box(G.XB0 - 11, yP0, pz, G.XB1 + 11, yP1, pz + 12, s5WOOD, toneI, 1.6) });
      }
      s += byDepth(parts);
      // etiketler
      const LB = [], bt = tr([G.K0 + O.W*.4, zb + S]);
      if (k > .6){
        // noktalar kitap boyunca dağıtıldı (oklar tek köşede toplanmaz)
        LB.push({ at: [(G.XK0 + G.XK1)/2, ...tr([G.K1 - 1, zb + S - 3])], text: t('learn.s.casingIn.mull'), on: false });
        LB.push({ at: [G.XK1, ...tr([G.K0 + O.W*.6, zb + S*.5])], text: t('learn.s.casingIn.folds', { n: O.N }), on: false });
        LB.push({ at: [G.XB0 + 25, G.RB0 + 2, G.zc + 1], text: t('learn.s.casingIn.board', { t: o.number(T) }), on: false });
        LB.push({ at: [G.XB1 - 35, ...ch.R1([(G.S0 + G.S1)/2, G.zc + 1])], text: t('learn.s.casingIn.strip'), on: false });
      } else {
        if (st.place < 1 && !(st.deneT >= 0)) LB.push({ at: [G.XK1 - 20, ...bt], text: st.glueA > 0 ? t('learn.s.casingIn.endpaper_glue') : t('learn.s.casingIn.endpaper_alt'), on: st.glueAT >= 0 });
        if (st.mark > .5 && st.place < 1) LB.push({ at: [G.XK0 + 7, G.K0, zt0], text: t('learn.s.casingIn.mark'), on: st.deneT >= 0 });
        if (st.atikA > .3 || st.atikU > .3) LB.push({ at: st.atikA > .3 ? [G.XK1 - 40 - (O.H + 30)*(1 - st.atikA), ...tr([G.K0 - 6, zb + .35])] : [G.XK1 - 40 - (O.H + 30)*(1 - st.atikU), G.K0 - 6, zb + S - .3], text: t('learn.s.casingIn.scrap'), on: st.glueAT >= 0 || st.glueUT >= 0 });
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
    const fircaY = (u, z) => [xm, kLerp(G.K0 + 4, G.K1 - 4, u), z];
    // atık kâğıt: konur (.35 sn), tutkal sürülür, çekilip çıkarılır (.7 sn)
    const atikli = (st, ui, name, tKey, glue, done) => kOrder(st, ui, [['atikT', .35, u => { st[name] = u; }], [tKey, 1.6, glue], ['atikT', .7, u => { st.brush = null; st[name] = 1 - u; }]], () => { st[name] = 0; done(); });
    const step = {
      dryFit: { action(st, ui){ if (busy(st, ui)) return false; if (st.attempt >= 1){ ui.flash(t('learn.s.casingIn.f_has_try')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_dene', { k: o.number(O.k) }), 2800);
          kRun(st, ui, 'deneT', 3.6, u => { st.attempt = u; st.mark = kSeg(u, .42, .58); }, () => { st.attempt = 1; st.mark = 1; finish(st); }); return true; },
        last(st){ st.attempt = 1; st.mark = 1; } },
      bottom: { action(st, ui){ if (busy(st, ui)) return false; if (st.attempt < 1){ ui.flash(t('learn.s.casingIn.f_once_dene')); return false; }
          if (st.glueA >= 1){ ui.flash(t('learn.s.casingIn.f_has_glue')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_alt'), 3200);
          // blok ters yatarken üstte görünen yüz: çevrilmiş koordinatta y ayna (2hY − y)
          atikli(st, ui, 'atikA', 'glueAT', u => { st.glueA = u; const p = fircaY(u, BH + S + .4); st.brush = [p[0], 2*hY - p[1], p[2]]; }, () => { st.glueA = 1; finish(st); }); return true; },
        last(st){ st.glueA = 1; st.atikA = 0; } },
      place: { action(st, ui){ if (busy(st, ui)) return false; if (st.glueA < 1){ ui.flash(t('learn.s.casingIn.f_once_alt')); return false; }
          if (st.place >= 1){ ui.flash(t('learn.s.casingIn.f_has_place')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_yer', { k: o.number(O.k) }), 2800); kRun(st, ui, 'yerT', 1.8, u => { st.place = u; }, () => { st.place = 1; finish(st); }); return true; },
        last(st){ st.place = 1; } },
      top: { action(st, ui){ if (busy(st, ui)) return false; if (st.place < 1){ ui.flash(t('learn.s.casingIn.f_once_yer')); return false; }
          if (st.glueU >= 1){ ui.flash(t('learn.s.casingIn.f_has_glue')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_ust'), 3200);
          atikli(st, ui, 'atikU', 'glueUT', u => { st.glueU = u; st.brush = fircaY(u, zb + S + .4); }, () => { st.glueU = 1; finish(st); }); return true; },
        last(st){ st.glueU = 1; st.atikU = 0; } },
      close: { action(st, ui){ if (busy(st, ui)) return false; if (st.glueU < 1){ ui.flash(t('learn.s.casingIn.f_once_ust')); return false; }
          if (st.c >= 1){ ui.flash(t('learn.s.casingIn.f_closed')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_close'), 2400); kRun(st, ui, 'closeT', 2.2, u => { st.c = u; }, () => { st.c = 1; finish(st); }); return true; },
        last(st){ st.c = 1; } },
      jointGap: { action(st, ui){ if (busy(st, ui)) return false; if (st.c < 1){ ui.flash(t('learn.s.casingIn.f_close_once')); return false; }
          if (st.groove >= 1){ ui.flash(t('learn.s.casingIn.f_has_groove')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_groove'), 2400);
          kRun(st, ui, 'boneFolderT', 2.4, u => { st.boneFolderX = u < .5 ? ease(u*2) : 1 - ease((u - .5)*2); st.groove = Math.min(1, u*1.6); }, () => { st.groove = 1; st.boneFolderT = -1; finish(st); }); return true; },
        last(st){ st.groove = 1; st.boneFolderT = -1; } },
      // ---- pres
      waxed: { action(st, ui){ if (busy(st, ui)) return false; if (st.wax >= 1){ ui.flash(t('learn.s.casingIn.f_has_wax')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_mum'), 2600); kRun(st, ui, 'mumT', 1.2, u => { st.wax = u; }, () => { st.wax = 1; finish(st); }); return true; },
        last(st){ st.wax = 1; } },
      mist: { action(st, ui){ if (busy(st, ui)) return false; if (st.wax < 1){ ui.flash(t('learn.s.casingIn.f_once_mum')); return false; }
          if (st.mist >= 1){ ui.flash(t('learn.s.casingIn.f_sis_var')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_sis'), 2400); kRun(st, ui, 'sisT', 1, u => { st.mist = u; }, () => { st.mist = 1; finish(st); }); return true; },
        last(st){ st.mist = 1; } },
      press: { action(st, ui){ if (busy(st, ui)) return false; if (st.mist < 1){ ui.flash(t('learn.s.casingIn.f_once_sis')); return false; }
          if (st.press >= 1){ ui.flash(t('learn.s.casingIn.f_pres_var')); return false; }
          st.anim2 = true; ui.flash(t('learn.s.casingIn.f_pres'), 2200); kRun(st, ui, 'pressT', 1.4, u => { st.press = u; }, () => { st.press = 1; finish(st); }); return true; },
        last(st){ st.press = 1; } },
      dry: { action(st, ui){ if (busy(st, ui)) return false; if (st.press < 1){ ui.flash(t('learn.s.casingIn.f_once_pres')); return false; }
          if (st.dry >= 1){ ui.flash(t('learn.s.casingIn.f_dry')); return false; }
          st.anim2 = true; kRun(st, ui, 'dryT', 2.4, u => { st.dry = u; }, () => { st.dry = 1; ui.flash(t('learn.s.casingIn.f_dried'), 2600); finish(st); }); return true; },
        last(st){ st.dry = 1; } }
    };
    const st0 = { attempt: 0, deneT: -1, mark: 0, atikA: 0, atikU: 0, atikT: -1, glueA: 0, glueAT: -1, place: 0, yerT: -1, glueU: 0, glueUT: -1, c: 0, closeT: -1, groove: 0, boneFolderT: -1, boneFolderX: 0,
      wax: 0, mumT: -1, mist: 0, sisT: -1, press: 0, pressT: -1, dry: 0, dryT: -1, brush: null, anim: 0, anim2: false };
    return { step, cfg: {
      title: t('learn.casingIn.name'), credit: false, size: [W2, D2, HMAX], state: st0, scene,
      stats: st => [{ label: t('learn.s.casingIn.st_kuruma'), value: t('learn.s.casingIn.st_sa', { n: Math.round(st.dry*24) }) }, { label: t('learn.s.casingIn.st_pres'), value: st.press >= 1 ? t('learn.s.casingIn.st_clamped') : t('learn.s.casingIn.st'), small: true }]
    } };
  };
})(typeof self !== 'undefined' ? self : this);
