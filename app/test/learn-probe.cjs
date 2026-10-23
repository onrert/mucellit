'use strict';
/*
 * learn-probe.cjs — YALNIZ TEST: Öğren rehberinin denetim arayüzü (KitapCilt.ogren.denetim).
 * Denetim arayüzü ürün kodundan (app/js/learn/learn.js) çıkarıldı. e2e, learn.js
 * isteğini Playwright ile yakalar (page.route) ve ürün dosyasını, IIFE'nin kapanışından hemen önce bu kodu ekleyerek
 * sunar; kod rehberin kapanış değişkenlerine (durum, kur, calistir …) erişir. Ürün paketine girmez: app/test/
 * prepare-dist.mjs'te hariç (dist/ ve gömülü varlıklar).
 * enjekte(kaynak): kapanış satırı tam bir kez ve dosyanın sonunda değilse ya da kaynak beklenen denetleyici
 * (KC.sekme = { goster, gizle }) değilse hata atar (sessizce yanlış dosyaya eklenmez).
 */
const END = "})(typeof self !== 'undefined' ? self : this);";
const SIGNATURE = 'MC.tab = { show, hide };';

const CODE = `
  // ---- TEST ENJEKSİYONU (app/test/learn-probe.cjs; ürün code değil) ----
  MC.probe = {
    state: () => ({ a: state.a, i: state.i, n: LESSONS[state.a].steps.length, playing: state.playing, flow: state.flow, finished: state.finished,
      done: state.done.slice(), i18n: I18n.code(), size: state.size, st: state.ui && state.ui.st, busy: !!(state.ui && state.ui.busy()),
      installed: state.installed, visible: state.visible, figure: !!state.ui, manual: state.manual, match: state.match, input: Object.assign({}, state.input) }),
    setup, run, play, fromStartToEnd, next, previous,
    numbers: g => { for (const a of NUMBER_FIELDS) if (g[a] !== undefined) $('g-' + a).value = String(g[a]); return numbersChanged(); },
    takeFromCalculator: () => { const d = takeFromCalculator(); if (!state.flow) setup(state.a, state.i); return d; },
    render: () => state.ui && state.ui.render(),
    // still: motion finished ve filtreli katman inPlace (cf-engine.js difference 8); görüntü almadan önce tests bunu bekler
    still: () => !!(state.ui && state.ui.still()),
    camera: (yaw, pitch) => { MC.cf.setCam(yaw, pitch); if (state.ui) state.ui.render(); },
    missingKeys: () => I18n.missingKeys(),
    lessons: LESSONS
  };
`;

function inject(source) {
  const s = String(source == null ? '' : source);
  const i = s.indexOf(END);
  if (i < 0) throw new Error('learn-probe: kapanış satırı yok (learn.js değil ya da biçim değişti)');
  if (s.indexOf(END, i + 1) >= 0) throw new Error('learn-probe: kapanış satırı birden çok (kopya/birleştirilmiş dosya)');
  if (s.slice(i + END.length).trim()) throw new Error('learn-probe: kapanıştan sonra kod var');
  if (!s.includes(SIGNATURE)) throw new Error('learn-probe: denetleyici imzası (MC.tab = { show, hide }) none');
  return s.slice(0, i) + CODE + s.slice(i);
}

module.exports = { inject, END, SIGNATURE, CODE };
