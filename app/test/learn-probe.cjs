'use strict';
/*
 * learn-probe.cjs — TEST ONLY: the probe interface of the Learn guide (Mucellit.learn.probe).
 * The probe interface was taken out of the product code (app/js/learn/learn.js). e2e catches the learn.js request with
 * Playwright (page.route) and serves the product file with this code added right before the closing of the IIFE; the
 * code reaches the guide's closure variables (state, setup, run …). It does not go into the product package: excluded in
 * tools/prepare-dist.mjs (dist/ and the embedded assets).
 * inject(source): throws when the closing line is not there exactly once and at the end of the file, or when the source
 * is not the expected controller (MC.tab = { show, hide }) (nothing is silently added to a wrong file).
 */
const END = "})(typeof self !== 'undefined' ? self : this);";
const SIGNATURE = 'MC.tab = { show, hide };';

const CODE = `
  // ---- TEST INJECTION (app/test/learn-probe.cjs; not product code) ----
  MC.probe = {
    state: () => ({ a: state.a, i: state.i, n: LESSONS[state.a].steps.length, playing: state.playing, flow: state.flow, finished: state.finished,
      done: state.done.slice(), i18n: I18n.code(), size: state.size, st: state.ui && state.ui.st, busy: !!(state.ui && state.ui.busy()),
      installed: state.installed, visible: state.visible, figure: !!state.ui, manual: state.manual, match: state.match, input: Object.assign({}, state.input) }),
    setup, run, play, fromStartToEnd, next, previous,
    numbers: g => { for (const a of NUMBER_FIELDS) if (g[a] !== undefined) $('g-' + a).value = String(g[a]); return numbersChanged(); },
    takeFromCalculator: () => { const d = takeFromCalculator(); if (!state.flow) setup(state.a, state.i); return d; },
    render: () => state.ui && state.ui.render(),
    // still: motion finished and the filtered layer in place (cf-engine.js difference 8); the tests wait for this before a screenshot
    still: () => !!(state.ui && state.ui.still()),
    camera: (yaw, pitch) => { MC.cf.setCam(yaw, pitch); if (state.ui) state.ui.render(); },
    missingKeys: () => I18n.missingKeys(),
    lessons: LESSONS
  };
`;

function inject(source) {
  const s = String(source == null ? '' : source);
  const i = s.indexOf(END);
  if (i < 0) throw new Error('learn-probe: no closing line (not learn.js or the format changed)');
  if (s.indexOf(END, i + 1) >= 0) throw new Error('learn-probe: more than one closing line (copied/merged file)');
  if (s.slice(i + END.length).trim()) throw new Error('learn-probe: code after the closing');
  if (!s.includes(SIGNATURE)) throw new Error('learn-probe: no controller signature (MC.tab = { show, hide })');
  return s.slice(0, i) + CODE + s.slice(i);
}

module.exports = { inject, END, SIGNATURE, CODE };
