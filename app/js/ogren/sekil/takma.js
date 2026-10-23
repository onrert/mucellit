/*
 * sekil/takma.js — Aşama 8 (bloğu kapağa takma) ve 9 (preste kurutma).
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
 * Model: kapak iki düz menteşeyle kapanır (mafsal boşluğu modelde f + t; ortak.js kGeo notu). Bez oluğa çökmez.
 * Koordinat: x = sırt boyu, y = genişlik, z = yukarı; 1 birim = 1 mm.
 * PARÇALAR: kesme altlığı · kapak: iki mukavva (iç yüzde kıvırma payları), sırt şeridi, mafsal bezleri · blok: forzalar,
 *   sırt bezi kanatları, ön kenar, kesitler, kapitaller · fırça · kemik · mumlu kâğıtlar · iki şiş · pres (dikmeler,
 *   kiriş, vida, tabla). ÇİZİM: kapak, blok, şişler, mumlu kâğıt (x boyunca) xSort; pres parçaları byDepth.
 */
'use strict';
(function (kok) {
  const KC = kok.KitapCilt.ogren, { PALS, INK, byDepth, f, pd, on, toneI, ease, box, rod, boardTop, xrCallouts } = KC.cf;
  KC.sekil.takma = function (o) {
    const { xSort, xPrism, kRect, kRot, kRun, kSira, kLerp, kSeg, kMat, kBlockItems, kCaseItems, kGeo, kChain, kBone, kBrush, renk } = KC.ortak, O = o.olcu, t = o.t;
    const PRES = o.asama === 'pres', YATAK = PRES ? 10 : 0;   // pres yatağı kalınlığı (kitap yatağın üstünde)
    const G = kGeo(O, { RB0: PRES ? 40 : O.W + 40, zc: PRES ? 4 + YATAK + .4 : undefined }), S = O.S, T = G.T, BH = G.BH, s5WOOD = renk.kWOOD, s5STEEL = renk.kSTEEL;
    const kATIK = { l:'#eef1f2', m:'#d3d9dc', d:'#9ea7ac' };        // atık kâğıt (gri gazete kâğıdı)
    const zb = G.zc + T, hY = G.K0 - 6, hZ = (BH + zb + S)/2;          // blok çevirme ekseni
    const W2 = G.matW, D2 = PRES ? G.S0 + 60 : G.matD, xm = (G.XB0 + G.XB1)/2;
    const kitapUst = G.zc + G.R, yJ = G.S0 - G.g/2;                  // kapalı kitabın üstü, üst mafsal oluğu (y)
    const HMAX = Math.max(175, kitapUst + 140);
    const yP0 = G.RB0 - 15, yP1 = G.S0 + 17, yPc = (yP0 + yP1)/2;     // pres tablası
    const zt0 = G.zc + T;                                             // açık kapakta mukavvanın üst yüzü (işaret, atık kâğıt)
    // kuru deneme: blok kapağa çevrilir (0–.4), oturur ve işaretlenir (.4–.62), yanına geri çevrilir (.62–1)
    const deneY = u => u <= 0 || u >= 1 ? 0 : u < .4 ? kSeg(u, 0, .4) : u < .62 ? 1 : 1 - kSeg(u, .62, 1);

    function scene(st, m){
      const k = ease(st.xr || 0), items = [];
      let s = kMat(W2, D2, BH);
      const ch = kChain(G, Math.PI/2*kSeg(st.c, 0, .45), Math.PI/2*kSeg(st.c, .5, 1)), cop = 1 - .72*k;
      const all = kCaseItems(G, ch, m, items, { op: cop, paste: st.c >= 1, oluk: st.oluk, title: st.c >= 1 ? t('ogren.s.kitap.kapak1') : null, title2: st.c >= 1 ? t('ogren.s.kitap.kapak2') : null });
      // blok: çevrilmemiş (yanda, ters) → kapakta; kuru denemede gidip gelir
      const yerE = Math.max(st.yer, deneY(st.dene)), psi = Math.PI*(1 - ease(yerE)), tr = p => kRot(p, [hY, hZ], psi);
      all.push(...kBlockItems(G, G.K0, zb, items, { tr, glue: st.glueU, glueAlt: st.glueA, k, m: PALS.tomato, op: 1 }));
      // kurşunkalem işareti: ağız hizasında, mukavvanın iç yüzünde baş ve etek köşelerinde L (kuru denemede konur)
      if (st.isaret > 0){ const y = G.K0, z = zt0 + .06, L = 24*ease(Math.min(1, st.isaret)), d = pd([[G.XK0 + L, y, z], [G.XK0, y, z], [G.XK0, y + 12, z]], false) + pd([[G.XK1 - L, y, z], [G.XK1, y, z], [G.XK1, y + 12, z]], false);
        items.push({ a: [y - .5, z], b: [y + 8, z], bias: .015, svg: `<path d="${d}" fill="none" stroke="#34333a" stroke-width="2" stroke-linecap="round"/>` }); }
      // atık kâğıt: tutkallanan forza yaprağının altında, ağızda 12 mm taşar; tutkaldan sonra ağız yönünde çekilip çıkarılır
      for (const [v, zz, trr] of [[st.atikA, zb + .25, tr], [st.atikU, zb + S - .45, p => p]]){ if (!(v > 0)) continue;
        const dx = -(O.H + 30)*(1 - v);   // görünen kısım: ağızdan dışarıdaki şerit; çıkarılırken baş yönünde çekilir
        xPrism(kRect(G.K0 - 12, zz, G.K0, zz + .2, trr), G.XK0 - 6 + dx, G.XK1 + 6 + dx, kATIK, items, { w: .7, op: Math.min(1, v*3), bias: .025 }); }
      // mumlu kâğıtlar (forza ile blok arasında; ön kenarda taşar)
      if (st.mum > 0){ const dy = -50*(1 - ease(st.mum)), y0 = G.K0 - 10 + dy, y1 = G.K1 - 8;
        for (const z of [zb - .25, zb + S]) all.push(...xPrism(kRect(y0, z, y1, z + .25), G.XK0 + 3, G.XK1 - 3, renk.kWAX, items, { w: .7, op: .9, bias: .03 })); }
      // şişler (üst ve alt mafsal oluğunda)
      if (st.sis > 0){ const dz = 40*(1 - ease(st.sis));
        for (const [z, b] of [[kitapUst + 2 + dz, .06], [G.zc + 1.6, -.02]]){
          const sv = rod([G.XB0 - 8, yJ, z], [G.XB1 + 8, yJ, z], 2, s5STEEL, toneI, .9, 2, 12);
          items.push({ a: [yJ, z], r: 2, bias: b, svg: kOp1(sv) }); } }
      // fırça (tutkal sürerken)
      if (st.firca) items.push({ a: [st.firca[1], st.firca[2] + 3], r: 6, bias: .2, svg: kBrush(xm, st.firca[1], st.firca[2], 'y') });
      // kemik (mafsal oluğunda)
      if (st.kemikT >= 0){ const u = st.kemikX, bn = kBone(kLerp(G.XB0 - 10, G.XB1 - 140, u), yJ - 11, kitapUst + .4);
        items.push({ a: [yJ - 11, kitapUst + 2], b: [yJ + 11, kitapUst + 2], bias: .3, svg: bn.svg }); }
      const parts = [];
      // pres yatağı (kitap üstünde durur)
      if (PRES){ const yb = box(G.XB0 - 14, yP0, BH, G.XB1 + 14, yP1, BH + YATAK, s5WOOD, toneI, 1.4);
        parts.push({ box: [[G.XB0 - 14, yP0, BH], [G.XB1 + 14, yP1, BH + YATAK]], svg: yb }); }
      // kitap katmanı: kutu üstü kitabın (ve şişlerin) üstünde biter; baskı tablası z'de ayrık kalır, önde çizilir
      parts.push({ box: [[G.XB0 - 8, 20, BH + YATAK], [G.XB1 + 8, D2 - 20, st.press > 0 ? kitapUst + 4.2 : HMAX]], svg: xSort(items) });
      // pres
      if (st.press > 0){ const pz = kLerp(kitapUst + 70, kitapUst + 4.2, ease(st.press)), zK = kitapUst + 120, xc = xm;
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
        LB.push({ at: [(G.XK0 + G.XK1)/2, ...tr([G.K1 - 1, zb + S - 3])], text: t('ogren.s.takma.mull'), on: false });
        LB.push({ at: [G.XK1, ...tr([G.K0 + O.W*.6, zb + S*.5])], text: t('ogren.s.takma.katlar', { n: O.N }), on: false });
        LB.push({ at: [G.XB0 + 25, G.RB0 + 2, G.zc + 1], text: t('ogren.s.takma.mukavva', { t: o.sayi(T) }), on: false });
        LB.push({ at: [G.XB1 - 35, ...ch.R1([(G.S0 + G.S1)/2, G.zc + 1])], text: t('ogren.s.takma.serit'), on: false });
      } else {
        if (st.yer < 1 && !(st.deneT >= 0)) LB.push({ at: [G.XK1 - 20, ...bt], text: st.glueA > 0 ? t('ogren.s.takma.forza_tutkal') : t('ogren.s.takma.forza_alt'), on: st.glueAT >= 0 });
        if (st.isaret > .5 && st.yer < 1) LB.push({ at: [G.XK0 + 7, G.K0, zt0], text: t('ogren.s.takma.isaret'), on: st.deneT >= 0 });
        if (st.atikA > .3 || st.atikU > .3) LB.push({ at: st.atikA > .3 ? [G.XK1 - 40 - (O.H + 30)*(1 - st.atikA), ...tr([G.K0 - 6, zb + .35])] : [G.XK1 - 40 - (O.H + 30)*(1 - st.atikU), G.K0 - 6, zb + S - .3], text: t('ogren.s.takma.atik'), on: st.glueAT >= 0 || st.glueUT >= 0 });
        else if (st.c < .5) LB.push({ at: [G.XK1 - 20, ...bt], text: st.glueU > 0 ? t('ogren.s.takma.forza_tutkal') : t('ogren.s.takma.forza_ust'), on: st.glueUT >= 0 });
        if (st.c < .5) LB.push({ at: [G.XB1, (G.LB0 + G.LB1)/2, G.zc + 2], text: t('ogren.s.takma.kivirma'), on: false });
        LB.push({ at: [G.XB1, ...ch.R1([(G.S0 + G.S1)/2, G.zc])], text: t('ogren.s.takma.serit'), on: st.closeT >= 0 });
        LB.push({ at: [G.XB1, (G.RB1 + G.S0)/2, G.zc - .3], text: t('ogren.s.takma.mafsal', { f: o.sayi(O.f) }), on: st.yerT >= 0 });
        if (st.yer >= 1 && st.c < .5) LB.push({ at: [G.XK0 + 10, G.K0, zb + 2], text: t('ogren.s.takma.tasma', { k: o.sayi(O.k) }), on: st.yerT >= 0 });
        LB.push({ at: [G.XK1 - 1.5, ...tr([G.K1 + 1.2, zb + 4])], text: t('ogren.s.takma.kapital'), on: false });
        if (st.oluk > 0 || st.kemikT >= 0) LB.push({ at: [G.XB0 + 30, yJ, kitapUst], text: t('ogren.s.takma.oluk'), on: st.kemikT >= 0 });
        if (st.kemikT >= 0) LB.push({ at: [kLerp(G.XB0 - 10, G.XB1 - 140, st.kemikX) + 140, yJ, kitapUst + 4], text: t('ogren.s.takma.kemik'), on: true });
        if (st.mum > .5) LB.push({ at: [G.XK1 - 30, G.K0 - 10, zb + S], text: t('ogren.s.takma.mumlu'), on: st.mumT >= 0 });
        if (st.sis > .5) LB.push({ at: [G.XB1 + 8, yJ, kitapUst + 2], text: t('ogren.s.takma.sis'), on: st.sisT >= 0 });
        if (st.press > .5) LB.push({ at: [W2 - 14, yPc, kitapUst + 60], text: t('ogren.s.takma.pres'), on: st.pressT >= 0 || st.dryT >= 0 });
      }
      s += xrCallouts(LB, k > .6 && st.c >= 1 ? [G.XB0 - 4, G.XB1 + 4, G.RB0 - 4, G.S1 + 6, 0, kitapUst + 8] : [0, W2, 0, D2, 0, HMAX]);
      return s;
    }
    const kOp1 = svg => svg;
    const mesgul = (st, ui) => { if (st.anim2){ ui.flash(t('ogren.f.mesgul')); return true; } return false; };
    const bitir = st => { st.anim2 = false; st.firca = null; };
    const fircaY = (u, z) => [xm, kLerp(G.K0 + 4, G.K1 - 4, u), z];
    // atık kâğıt: konur (.35 sn), tutkal sürülür, çekilip çıkarılır (.7 sn)
    const atikli = (st, ui, ad, tKey, tutkal, done) => kSira(st, ui, [['atikT', .35, u => { st[ad] = u; }], [tKey, 1.6, tutkal], ['atikT', .7, u => { st.firca = null; st[ad] = 1 - u; }]], () => { st[ad] = 0; done(); });
    const adim = {
      kuru: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.dene >= 1){ ui.flash(t('ogren.s.takma.f_dene_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.takma.f_dene', { k: o.sayi(O.k) }), 2800);
          kRun(st, ui, 'deneT', 3.6, u => { st.dene = u; st.isaret = kSeg(u, .42, .58); }, () => { st.dene = 1; st.isaret = 1; bitir(st); }); return true; },
        son(st){ st.dene = 1; st.isaret = 1; } },
      alt: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.dene < 1){ ui.flash(t('ogren.s.takma.f_once_dene')); return false; }
          if (st.glueA >= 1){ ui.flash(t('ogren.s.takma.f_tutkal_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.takma.f_alt'), 3200);
          // blok ters yatarken üstte görünen yüz: çevrilmiş koordinatta y ayna (2hY − y)
          atikli(st, ui, 'atikA', 'glueAT', u => { st.glueA = u; const p = fircaY(u, BH + S + .4); st.firca = [p[0], 2*hY - p[1], p[2]]; }, () => { st.glueA = 1; bitir(st); }); return true; },
        son(st){ st.glueA = 1; st.atikA = 0; } },
      yerlestir: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.glueA < 1){ ui.flash(t('ogren.s.takma.f_once_alt')); return false; }
          if (st.yer >= 1){ ui.flash(t('ogren.s.takma.f_yer_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.takma.f_yer', { k: o.sayi(O.k) }), 2800); kRun(st, ui, 'yerT', 1.8, u => { st.yer = u; }, () => { st.yer = 1; bitir(st); }); return true; },
        son(st){ st.yer = 1; } },
      ust: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.yer < 1){ ui.flash(t('ogren.s.takma.f_once_yer')); return false; }
          if (st.glueU >= 1){ ui.flash(t('ogren.s.takma.f_tutkal_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.takma.f_ust'), 3200);
          atikli(st, ui, 'atikU', 'glueUT', u => { st.glueU = u; st.firca = fircaY(u, zb + S + .4); }, () => { st.glueU = 1; bitir(st); }); return true; },
        son(st){ st.glueU = 1; st.atikU = 0; } },
      kapat: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.glueU < 1){ ui.flash(t('ogren.s.takma.f_once_ust')); return false; }
          if (st.c >= 1){ ui.flash(t('ogren.s.takma.f_kapali')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.takma.f_kapat'), 2400); kRun(st, ui, 'closeT', 2.2, u => { st.c = u; }, () => { st.c = 1; bitir(st); }); return true; },
        son(st){ st.c = 1; } },
      mafsal: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.c < 1){ ui.flash(t('ogren.s.takma.f_once_kapat')); return false; }
          if (st.oluk >= 1){ ui.flash(t('ogren.s.takma.f_oluk_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.takma.f_oluk'), 2400);
          kRun(st, ui, 'kemikT', 2.4, u => { st.kemikX = u < .5 ? ease(u*2) : 1 - ease((u - .5)*2); st.oluk = Math.min(1, u*1.6); }, () => { st.oluk = 1; st.kemikT = -1; bitir(st); }); return true; },
        son(st){ st.oluk = 1; st.kemikT = -1; } },
      // ---- pres
      mumlu: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.mum >= 1){ ui.flash(t('ogren.s.takma.f_mum_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.takma.f_mum'), 2600); kRun(st, ui, 'mumT', 1.2, u => { st.mum = u; }, () => { st.mum = 1; bitir(st); }); return true; },
        son(st){ st.mum = 1; } },
      sis: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.mum < 1){ ui.flash(t('ogren.s.takma.f_once_mum')); return false; }
          if (st.sis >= 1){ ui.flash(t('ogren.s.takma.f_sis_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.takma.f_sis'), 2400); kRun(st, ui, 'sisT', 1, u => { st.sis = u; }, () => { st.sis = 1; bitir(st); }); return true; },
        son(st){ st.sis = 1; } },
      pres: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.sis < 1){ ui.flash(t('ogren.s.takma.f_once_sis')); return false; }
          if (st.press >= 1){ ui.flash(t('ogren.s.takma.f_pres_var')); return false; }
          st.anim2 = true; ui.flash(t('ogren.s.takma.f_pres'), 2200); kRun(st, ui, 'pressT', 1.4, u => { st.press = u; }, () => { st.press = 1; bitir(st); }); return true; },
        son(st){ st.press = 1; } },
      kurut: { eylem(st, ui){ if (mesgul(st, ui)) return false; if (st.press < 1){ ui.flash(t('ogren.s.takma.f_once_pres')); return false; }
          if (st.dry >= 1){ ui.flash(t('ogren.s.takma.f_kuru')); return false; }
          st.anim2 = true; kRun(st, ui, 'dryT', 2.4, u => { st.dry = u; }, () => { st.dry = 1; ui.flash(t('ogren.s.takma.f_kurudu'), 2600); bitir(st); }); return true; },
        son(st){ st.dry = 1; } }
    };
    const st0 = { dene: 0, deneT: -1, isaret: 0, atikA: 0, atikU: 0, atikT: -1, glueA: 0, glueAT: -1, yer: 0, yerT: -1, glueU: 0, glueUT: -1, c: 0, closeT: -1, oluk: 0, kemikT: -1, kemikX: 0,
      mum: 0, mumT: -1, sis: 0, sisT: -1, press: 0, pressT: -1, dry: 0, dryT: -1, firca: null, anim: 0, anim2: false };
    return { adim, cfg: {
      title: t('ogren.takma.ad'), credit: false, size: [W2, D2, HMAX], state: st0, scene,
      stats: st => [{ label: t('ogren.s.takma.st_kuruma'), value: t('ogren.s.takma.st_sa', { n: Math.round(st.dry*24) }) }, { label: t('ogren.s.takma.st_pres'), value: st.press >= 1 ? t('ogren.s.takma.st_sikili') : t('ogren.s.takma.st_yok'), small: true }]
    } };
  };
})(typeof self !== 'undefined' ? self : this);
