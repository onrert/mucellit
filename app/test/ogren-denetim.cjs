'use strict';
/*
 * ogren-denetim.cjs — YALNIZ TEST: Öğren rehberinin denetim arayüzü (KitapCilt.ogren.denetim).
 * Denetim arayüzü ürün kodundan (app/js/ogren/ogren.js) çıkarıldı. e2e, ogren.js
 * isteğini Playwright ile yakalar (page.route) ve ürün dosyasını, IIFE'nin kapanışından hemen önce bu kodu ekleyerek
 * sunar; kod rehberin kapanış değişkenlerine (durum, kur, calistir …) erişir. Ürün paketine girmez: app/test/
 * dist-hazirla.mjs'te hariç (dist/ ve gömülü varlıklar).
 * enjekte(kaynak): kapanış satırı tam bir kez ve dosyanın sonunda değilse ya da kaynak beklenen denetleyici
 * (KC.sekme = { goster, gizle }) değilse hata atar (sessizce yanlış dosyaya eklenmez).
 */
const BITIS = "})(typeof self !== 'undefined' ? self : this);";
const IMZA = 'KC.sekme = { goster, gizle };';

const KOD = `
  // ---- TEST ENJEKSİYONU (app/test/ogren-denetim.cjs; ürün kodu değil) ----
  KC.denetim = {
    durum: () => ({ a: durum.a, i: durum.i, n: DERS[durum.a].adimlar.length, oynuyor: durum.oynuyor, akis: durum.akis, bitti: durum.bitti,
      tamam: durum.tamam.slice(), dil: Dil.kod(), olcu: durum.olcu, st: durum.ui && durum.ui.st, mesgul: !!(durum.ui && durum.ui.mesgul()),
      kurulu: durum.kurulu, gorunur: durum.gorunur, figur: !!durum.ui, elle: durum.elle, uyum: durum.uyum, girdi: Object.assign({}, durum.girdi) }),
    kur, calistir, oynat, bastanSona, sonraki, onceki,
    sayilar: g => { for (const a of SAYI_ALANLARI) if (g[a] !== undefined) $('g-' + a).value = String(g[a]); return sayilarDegisti(); },
    hesapladanAl: () => { const d = hesapladanAl(); if (!durum.akis) kur(durum.a, durum.i); return d; },
    render: () => durum.ui && durum.ui.render(),
    // durgun: hareket bitti ve filtreli katman yerinde (cf-motor.js fark 8); görüntü almadan önce testler bunu bekler
    durgun: () => !!(durum.ui && durum.ui.durgun()),
    kamera: (yaw, pitch) => { KC.cf.setCam(yaw, pitch); if (durum.ui) durum.ui.render(); },
    eksikler: () => Dil.eksikler(),
    dersler: DERS
  };
`;

function enjekte(kaynak) {
  const s = String(kaynak == null ? '' : kaynak);
  const i = s.indexOf(BITIS);
  if (i < 0) throw new Error('ogren-denetim: kapanış satırı yok (ogren.js değil ya da biçim değişti)');
  if (s.indexOf(BITIS, i + 1) >= 0) throw new Error('ogren-denetim: kapanış satırı birden çok (kopya/birleştirilmiş dosya)');
  if (s.slice(i + BITIS.length).trim()) throw new Error('ogren-denetim: kapanıştan sonra kod var');
  if (!s.includes(IMZA)) throw new Error('ogren-denetim: denetleyici imzası (KC.sekme = { goster, gizle }) yok');
  return s.slice(0, i) + KOD + s.slice(i);
}

module.exports = { enjekte, BITIS, IMZA, KOD };
