/*
 * learn.js — controller of the "Learn" guide: stage list, step card (description, tools/materials, Caution), progress,
 * step playback, "play from start to end", the book's numbers panel. Sets up the figures with cfMount (cf-page.js).
 * Every user text comes from the dictionary (Mucellit.i18n.t); there is no fixed user text here.
 * The only exposed interface is Mucellit.learn.tab (show/hide; app.js openTab calls it). There is no test interface in
 * the product: e2e adds it to its own test copy (the injection script under app/test/).
 * (added for the app; adapted from the Learn prototype):
 *  - Runs in the Learn tab (#tab-learn); element ids have the "guide-" prefix (so that they do not clash with the app's ids).
 *  - No language picker of its own: the app's language (Mucellit.i18n); when the language changes the app reloads the
 *    page and the guide is set up in the new language; the stage/step position and the progress of the stages (done)
 *    stay in sessionStorage (not lost on reload).
 *  - Lazy setup: set up when the tab is first opened (Mucellit.learn.tab.show); when the tab is left
 *    (Mucellit.learn.tab.hide) "start to end" stops and the figure is removed (animation, rAF, listeners released).
 *  - By default the numbers panel shows the inputs and the result of the Calculator tab (Mucellit.calculator.state);
 *    manual changes stay in the guide only; "Use values from the Calculator tab" binds it to the Calculator again.
 *    The document title and the URL do not change.
 * LICENSE NOTE: Mucellit code (MIT, LICENSE at the root); it contains no Colorfigures code. The Colorfigures parts in this
 * folder are MIT licensed (April Zhu, Tolga Cohce), full text: LICENSE.
 */
'use strict';
(function (root) {
  const MC = root.Mucellit.learn, I18n = root.Mucellit.i18n, doc = root.document;
  const t = (a, p) => I18n.t(a, p);
  const $ = id => doc.getElementById('guide-' + id);   // ids have the guide- prefix
  const keyPart = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase()); // ids are camelCase, dictionary keys snake_case
  const LESSONS = MC.lessons;
  const NUMBER_FIELDS = ['signatureCount', 'sheetsPerSignature', 'bookWidth', 'bookHeight', 'paperThickness'];

  const state = {
    a: 0, i: 0, ui: null, fig: null, size: null, input: Object.assign({}, MC.size.DEFAULTS),
    done: LESSONS.map(() => 0), playing: false, flow: false, flowId: 0, xr: 0, label: false, finished: false,
    installed: false, visible: false, manual: false, base: null, match: true
  };
  const POSITION = 'mucellit.learn.position';
  function writePosition() { try { root.sessionStorage.setItem(POSITION, JSON.stringify({ a: state.a, i: state.i, done: state.done })); } catch (_) { /* no storage */ } }
  /** Saved position and progress; broken progress (length, type, bounds) is ignored, the position is still used. */
  function readPosition() {
    try { const k = JSON.parse(root.sessionStorage.getItem(POSITION) || 'null');
      if (k && Number.isInteger(k.a) && k.a >= 0 && k.a < LESSONS.length && Number.isInteger(k.i) && k.i >= 0) {
        const t = Array.isArray(k.done) && k.done.length === LESSONS.length &&
          k.done.every((v, a) => Number.isInteger(v) && v >= 0 && v <= LESSONS[a].steps.length) ? k.done.slice() : null;
        return { a: k.a, i: Math.min(k.i, LESSONS[k.a].steps.length), done: t };
      }
    } catch (_) { /* broken or missing */ }
    return null;
  }

  /* ---------- numbers ---------- */
  const number = (n, b) => I18n.number(n, b === undefined ? 2 : b);
  const size2 = (a, b) => t('learn.size_two', { a: number(a), b: number(b) });
  /** {placeholder} values of the texts (number format by language). */
  function values(o) {
    return {
      signature: o.N, sheetsPerSignature: o.y, pagesPerSignature: o.y * 4, page: o.page, printSheets: o.printSheets, sheet: o.sheet,
      W: number(o.W), H: number(o.H), paperWidth: number(2 * o.W), paper: number(o.paper, 3),
      spine: number(o.S), jointGap: number(o.f), t: number(o.t), k: number(o.k), e: number(o.e),
      board: size2(o.Db, o.Dh), spineStrip: size2(o.R, o.Dh), covering: size2(o.covering.width, o.covering.height),
      endpapers: size2(o.endpapers.width, o.endpapers.height), mull: size2(o.mull.width, o.mull.height), headbands: number(o.headbands),
      hole: o.station.number, range: number(o.station.range, 0), endAllowance: number(o.station.endAllowance), thread: number(o.thread, 0),
      cornerMin: number(o.corner[0]), cornerMax: number(o.corner[1]),
      lastPage: o.y * 4, back2: o.y * 4 - 1, rest: Math.max(0, o.N - 3)
    };
  }

  /* ---------- figure ---------- */
  const cfText = () => ({
    view: t('learn.cf.view'), fromFront: t('learn.cf.from_front'),
    rotates: t('learn.cf.rotates'), see_inside: t('learn.cf.see_inside'), labels: t('learn.cf.labels'),
    zoomIn: t('learn.cf.zoom_in'), zoomOut: t('learn.cf.zoom_out'), reset: t('learn.cf.reset')
  });

  function unmount() { if (state.ui) { try { state.ui.unmount(); } catch (_) { /* already removed */ } state.ui = null; state.fig = null; } }
  function setup(a, i) {
    state.flowId += state.flow ? 0 : 1;
    unmount();
    state.a = a; state.i = Math.max(0, Math.min(LESSONS[a].steps.length, i)); state.playing = false;
    writePosition();
    if (!state.visible) { render(); return; }   // no figure is set up in a hidden tab (no animation, no rAF)
    const d = LESSONS[a], o = { size: state.size, t, number, value: values(state.size), stage: d.id,
      run: id => { const j = d.steps.indexOf(id); if (j >= 0 && !state.flow) run(j); } };
    const fig = MC.figures[d.figures](o);
    state.fig = fig;
    const st = fig.cfg.state;
    for (const id of (d.ready || [])) fig.step[id].last(st);
    for (let j = 0; j < state.i; j++) fig.step[d.steps[j]].last(st);
    const cfg = Object.assign({}, fig.cfg, {
      root: $('stage'), text: cfText(), xr: state.xr, label: state.label, turn: 'full',
      buttons: d.steps.map((id, j) => ({ id, label: t(`learn.${keyPart(d.id)}.${keyPart(id)}.button`), onClick: () => run(j) })),
      viewChanged: g => { if ('xr' in g) state.xr = g.xr ? 1 : 0; if ('label' in g) state.label = g.label; }
    });
    state.ui = MC.cfMount(cfg);
    render();
  }

  /** Plays a step; when it ends (the animation stops) the progress is written. A promise if it started (resolved at the end), false if not. */
  function run(j) {
    const ui = state.ui, d = LESSONS[state.a];
    if (!ui || !state.visible) return false;
    if (state.playing || ui.busy()) { ui.flash(t('learn.f.busy')); return false; }
    const name = d.steps[j], started = state.fig.step[name].action(ui.st, ui);
    ui.render();
    if (!started) return false;
    state.playing = true; render();
    const a = state.a, ui0 = ui;
    return new Promise(parse => {
      const wait = () => {
        if (state.ui !== ui0) { parse(false); return; }
        if (ui0.busy()) { requestAnimationFrame(wait); return; }
        state.playing = false;
        if (j >= state.i) state.i = j + 1;
        state.done[a] = Math.max(state.done[a], state.i);
        if (a === LESSONS.length - 1 && state.i === d.steps.length) state.finished = true;
        writePosition();   // the position and the progress are saved after a played step too (not lost when the language changes)
        render(); parse(true);
      };
      requestAnimationFrame(wait);
    });
  }

  /* ---------- playback buttons ---------- */
  function play() {
    const d = LESSONS[state.a];
    if (state.i >= d.steps.length) { if (state.a < LESSONS.length - 1) { setup(state.a + 1, 0); return run(0); } return false; }
    return run(state.i);
  }
  function previous() {
    if (state.flow) return;
    if (state.i > 0) setup(state.a, state.i - 1);
    else if (state.a > 0) setup(state.a - 1, LESSONS[state.a - 1].steps.length - 1);
  }
  function next() {
    if (state.flow) return;
    const n = LESSONS[state.a].steps.length;
    if (state.i < n) { state.done[state.a] = Math.max(state.done[state.a], state.i + 1); setup(state.a, state.i + 1); }
    else if (state.a < LESSONS.length - 1) setup(state.a + 1, 0);
  }
  function again() {
    if (state.flow) return;
    const j = Math.max(0, state.i - 1);
    setup(state.a, j); run(j);
  }
  const wait = ms => new Promise(r => setTimeout(r, ms / (MC.speed || 1)));
  async function fromStartToEnd() {
    if (state.flow) { state.flow = false; state.flowId++; render(); return; }
    state.flow = true; state.finished = false; const id = ++state.flowId; render();
    try {
      for (let a = 0; a < LESSONS.length; a++) {
        setup(a, 0);
        for (let j = 0; j < LESSONS[a].steps.length; j++) {
          await wait(700);
          if (!state.flow || state.flowId !== id) return;
          const p = run(j);
          if (p && p.then) await p;
          if (!state.flow || state.flowId !== id) return;
          await wait(500);
        }
      }
      state.finished = true;
    } finally {
      if (state.flowId === id) { state.flow = false; render(); }
    }
  }

  /* ---------- drawing (step card, stage list, progress) ---------- */
  function hasText(a) { return I18n.has(a); }
  function render() {
    const d = LESSONS[state.a], n = d.steps.length, D = values(state.size);
    // stage list
    const ol = $('stages'); ol.textContent = '';
    LESSONS.forEach((x, a) => {
      const li = doc.createElement('li'), b = doc.createElement('button'); b.type = 'button';
      b.className = 'stage' + (a === state.a ? ' current' : '') + (state.done[a] >= x.steps.length ? ' finished' : '');
      const no = doc.createElement('span'); no.className = 'no'; no.textContent = String(a + 1);
      const name = doc.createElement('span'); name.className = 'name'; name.textContent = t(`learn.${keyPart(x.id)}.name`);
      const sy = doc.createElement('span'); sy.className = 'sy'; sy.textContent = t('learn.step_count', { i: state.done[a], n: x.steps.length });
      b.append(no, name, sy); b.disabled = state.flow;
      b.onclick = () => setup(a, 0);
      li.appendChild(b); ol.appendChild(li);
    });
    // overall progress
    const top = LESSONS.reduce((s, x) => s + x.steps.length, 0), done = state.done.reduce((s, v) => s + v, 0);
    $('progress-bar').style.width = (100 * done / top).toFixed(1) + '%';
    $('progress-bar').parentNode.setAttribute('aria-valuenow', String(done));
    $('progress-bar').parentNode.setAttribute('aria-valuemax', String(top));
    $('progress-text').textContent = t('learn.general', { i: done, n: top });
    // step card
    $('stage-name').textContent = t('learn.stage_no', { a: state.a + 1, count: LESSONS.length }) + ' · ' + t(`learn.${keyPart(d.id)}.name`);
    $('stage-summary').textContent = t(`learn.${keyPart(d.id)}.summary`, D);
    const stepList = $('steps'); stepList.textContent = '';
    d.steps.forEach((id, j) => {
      const li = doc.createElement('li');
      li.className = (j < state.i ? 'finished' : '') + (j === state.i ? ' current' : '');
      li.textContent = t(`learn.${keyPart(d.id)}.${keyPart(id)}.title`, D);
      stepList.appendChild(li);
    });
    const card = $('card');
    if (state.i < n) {
      const id = d.steps[state.i], k = `learn.${keyPart(d.id)}.${keyPart(id)}`;
      const few = d.few && d.few[id] && d.few[id](state.size);
      $('step-no').textContent = t('learn.step_no', { i: state.i + 1, n });
      $('step-title').textContent = t(k + '.title', D);
      $('step-description').textContent = t(k + (few && hasText(k + '.description_few') ? '.description_few' : '.description'), D);
      const tool = hasText(k + '.tool'), caution = hasText(k + '.caution');
      $('tool-box').hidden = !tool; $('tool').textContent = tool ? t(k + '.tool', D) : '';
      $('caution-box').hidden = !caution; $('caution').textContent = caution ? t(k + '.caution', D) : '';
      card.classList.remove('last');
    } else {
      const isLastStage = state.a === LESSONS.length - 1;
      $('step-no').textContent = t('learn.stage_done');
      $('step-title').textContent = isLastStage ? t('learn.finished_title') : t('learn.next_stage', { name: t(`learn.${keyPart(LESSONS[state.a + 1].id)}.name`) });
      $('step-description').textContent = isLastStage ? t('learn.finished_text', D) : t(`learn.${keyPart(LESSONS[state.a + 1].id)}.summary`, D);
      $('tool-box').hidden = true; $('caution-box').hidden = true;
      card.classList.add('last');
    }
    const ui = state.ui;
    if (ui && ui.buttons) ui.buttons.forEach((b, j) => { b.classList.toggle('done', j < state.i); b.classList.toggle('inOrder', j === state.i); });
    $('play').disabled = state.playing || state.flow || (state.a === LESSONS.length - 1 && state.i >= n);
    $('play').textContent = state.i >= n && state.a < LESSONS.length - 1 ? t('learn.play_next_stage') : t('learn.play');
    $('previous').disabled = state.flow || (state.a === 0 && state.i === 0);
    $('next').disabled = state.flow || (state.a === LESSONS.length - 1 && state.i >= n);
    $('again').disabled = state.flow || state.playing || state.i === 0;
    $('fromStart-toEnd').textContent = state.flow ? t('learn.stop') : t('learn.from_start_to_end');
    $('fromStart-toEnd').setAttribute('aria-pressed', state.flow ? 'true' : 'false');
    const rootElement = $('root');
    if (rootElement) { rootElement.dataset.state = state.flow ? 'flow' : state.playing ? 'playing' : 'ready'; rootElement.dataset.finished = state.finished ? '1' : '0'; }
  }

  /* ---------- numbers panel ---------- */
  function writeResults() {
    const o = state.size, tb = $('results'); tb.textContent = '';
    const line = (k, v, hint) => { const tr = doc.createElement('tr'); const th = doc.createElement('th'); th.scope = 'row'; th.textContent = t(k);
      const td = doc.createElement('td'); td.textContent = v; td.dataset.k = k.split('.').pop(); if (hint) td.title = hint; tr.append(th, td); tb.appendChild(tr); };
    const mm = v => t('learn.mm', { v });
    line('learn.p.page', String(o.page));
    line('learn.p.signature', String(o.N));
    line('learn.p.sheet', String(o.sheet));
    line('learn.p.printing', String(o.printSheets));
    line('learn.p.spine', mm(number(o.S)));
    line('learn.p.board', mm(size2(o.Db, o.Dh)));
    line('learn.p.strip', mm(size2(o.R, o.Dh)));
    line('learn.p.joint_gap', mm(number(o.f)));
    line('learn.p.square', mm(number(o.k)));
    line('learn.p.turn_in', mm(number(o.e)));
    line('learn.p.corner', t('learn.mm_range', { a: number(o.corner[0]), b: number(o.corner[1]) }));
    line('learn.p.covering', mm(size2(o.covering.width, o.covering.height)));
    line('learn.p.endpapers', mm(size2(o.endpapers.width, o.endpapers.height)));
    line('learn.p.mull', mm(size2(o.mull.width, o.mull.height)));
    line('learn.p.headbands', mm(number(o.headbands)));
    line('learn.p.hole', t('learn.p.hole_value', { n: o.station.number, a: number(o.station.range, 0) }));
    line('learn.p.thread', t('learn.approx_mm', { v: number(o.thread, 0) }));
    $('match').hidden = !(state.base && !state.manual && !state.match);
  }
  function writeFields() {
    for (const a of NUMBER_FIELDS) $('g-' + a).value = I18n.numberField(state.input[a]);
  }
  function numbersChanged() {
    const g = {};
    $('number-note').hidden = true;
    for (const a of NUMBER_FIELDS) g[a] = $('g-' + a).value;
    const failed = MC.size.invalidFields(g);
    for (const a of NUMBER_FIELDS) $('g-' + a).setAttribute('aria-invalid', failed.includes(a) ? 'true' : 'false');
    if (failed.length) {
      $('number-error').hidden = false;
      $('number-error').textContent = t('learn.invalid', { fields: failed.map(a => t('learn.g.' + keyPart(a))).join(', ') });
      return false;
    }
    $('number-error').hidden = true;
    for (const a of NUMBER_FIELDS) g[a] = MC.size.readNumber(g[a]);
    const o = MC.size.calculate(g, state.base);
    state.manual = o.source !== 'calculator';   // the binding to the Calculator stays when the values are the same as there
    state.input = g; state.size = o;
    writeResults();
    if (!state.flow) setup(state.a, state.i); else render();
    return true;
  }

  /* ---------- Calculator tab ---------- */
  function calculatorState() { return root.Mucellit.calculator && root.Mucellit.calculator.state ? root.Mucellit.calculator.state() : null; }
  /**
   * Takes the numbers from the Calculator tab (the base). If the Calculator has an error or is outside the guide's
   * limits, the previous numbers stay and a note is shown; on the first setup without a base, the fallback default
   * (Sample Book). Returns whether anything changed.
   */
  function takeFromCalculator() {
    const tb = MC.size.fromBase(calculatorState());
    const note = $('number-note');
    $('number-error').hidden = true;
    for (const a of NUMBER_FIELDS) $('g-' + a).setAttribute('aria-invalid', 'false');
    if (!tb.input) {
      note.hidden = false;
      note.textContent = tb.fields ? t('learn.calculator_outside', { fields: tb.fields.map(a => t('learn.g.' + keyPart(a))).join(', ') }) : t('learn.calculator_error');
      if (!state.size) { state.base = null; state.size = MC.size.calculate(state.input); writeFields(); writeResults(); return true; }
      return false;
    }
    note.hidden = true;
    const old = state.size && JSON.stringify(state.size.calc.input) + JSON.stringify(state.size.input);
    state.base = tb; state.match = tb.match; state.manual = false;
    state.input = Object.assign({}, tb.five); state.size = MC.size.calculate(state.input, tb);
    writeFields(); writeResults();
    return old !== JSON.stringify(state.size.calc.input) + JSON.stringify(state.size.input);
  }

  /* ---------- setup and tab ---------- */
  function firstSetup() {
    state.installed = true;
    takeFromCalculator();
    for (const a of NUMBER_FIELDS) $('g-' + a).addEventListener('change', numbersChanged);
    $('number-form').addEventListener('submit', e => { e.preventDefault(); numbersChanged(); });
    $('use-calculator').addEventListener('click', () => { const changed = takeFromCalculator(); if (!state.flow && (changed || !state.ui)) setup(state.a, state.i); else render(); });
    $('play').onclick = () => { play(); };
    $('previous').onclick = previous; $('next').onclick = next; $('again').onclick = again;
    $('fromStart-toEnd').onclick = () => { fromStartToEnd(); };
    $('speed').onchange = () => { MC.speed = Number($('speed').value) || 1; };
    MC.speed = Number($('speed').value) || 1;
    const k = readPosition();
    if (k) { state.a = k.a; state.i = k.i; if (k.done) state.done = k.done; }
  }
  /**
   * The tab was opened: set up the first time; when bound to the Calculator (no manual change) the numbers are
   * refreshed; the figure is set up. When the tab is already visible and the figure is set up (⌘4 / menu / tab pressed
   * again) nothing is done: setting the figure up again would cut a playing step short, and "start to end" would move
   * on to the next step and skip one.
   */
  function show() {
    if (state.visible && state.ui) return;
    state.visible = true;
    if (!state.installed) firstSetup();
    else if (!state.manual) takeFromCalculator();
    setup(state.a, state.i);
  }
  /** The tab was left: "start to end" stops and the figure is removed (no animation and no rAF in a hidden tab). */
  function hide() {
    state.visible = false;
    if (state.flow) { state.flow = false; state.flowId++; }
    state.playing = false;
    unmount();
    if (state.installed) render();
  }
  MC.tab = { show, hide };
})(typeof self !== 'undefined' ? self : this);
