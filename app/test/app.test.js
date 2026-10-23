'use strict';
// app.js start-up: an error inside start() and a rejected platform.ready both
// go to the "The app couldn't start" notice; no unhandled Promise rejection is left.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

/** Runs app.js with a fake document and Mucellit parts. */
function setup({ ready, startProjects, learn } = {}) {
  const notices = [];
  const elements = {};
  const el = (id) => (elements[id] = elements[id] || { id, hidden: false, property: {}, setAttribute(a, d) { this.property[a] = d; } });
  const ctx = {
    PDFLib: {}, pdfjsLib: {},
    document: {
      readyState: 'complete',
      querySelectorAll: () => [],
      documentElement: el('html'),
      addEventListener() {},
    },
    Mucellit: {
      common: { $: el, notify: (m, t) => notices.push([m, t]), writeLocal() {}, readLocal: () => null },
      platform: { ready, text: { libraryHint: 'hint' } },
      i18n: require('../js/i18n.js'), // Node instance (default tr)
      projects: { start: startProjects || (() => {}) },
      impose: { start() {} },
      calculator: { start() {} },
      learn: learn,
    },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: 'app.js' });
  return { ctx, notices, elements };
}
const wait = () => new Promise((r) => setImmediate(r));

test('start-up: ready → starts, data-ready yes, no notice', async () => {
  const { notices, elements } = setup({ ready: Promise.resolve() });
  await wait();
  assert.deepEqual(notices, []);
  assert.equal(elements.html.property['data-ready'], 'yes');
});

test('start-up: when platform.ready is rejected, a "The app couldn\'t start" notice', async () => {
  const { notices } = setup({ ready: Promise.reject(new Error('no bridge')) });
  await wait();
  assert.deepEqual(notices, [['Uygulama başlatılamadı: no bridge', 'error']]);  // turkish-ok: expected Turkish UI text
});

test('start-up: an error thrown inside start() is caught and goes to the notice (no unhandled rejection)', async () => {
  const rejections = [];
  const listen = (e) => rejections.push(e);
  process.on('unhandledRejection', listen);
  try {
    const { notices, elements } = setup({ ready: Promise.resolve(), startProjects: () => { throw new Error('projects broken'); } });
    await wait(); await wait();
    assert.deepEqual(notices, [['Uygulama başlatılamadı: projects broken', 'error']]);  // turkish-ok: expected Turkish UI text
    assert.equal(elements.html.property['data-ready'], undefined);
  } finally {
    await wait();
    process.off('unhandledRejection', listen);
  }
  assert.deepEqual(rejections.map(String), []);
});

// ---------------------------------------------------------------- Learn tab
test('tab: opening Learn shows the guide, moving to another tab hides it; panels and aria-selected are right', async () => {
  const call = [];
  const tab = { show() { call.push(['show', elements['tab-learn'].hidden]); }, hide() { call.push(['hide', elements['tab-learn'].hidden]); } };
  const { ctx, elements } = setup({ ready: Promise.resolve(), learn: { tab } });
  await wait();
  call.length = 0;
  ctx.Mucellit.app.openTab('learn');
  assert.deepEqual(call, [['show', false]], 'show after the panel is visible');
  assert.equal(elements['tab-impose'].hidden, true);
  assert.equal(elements['tab-button-learn'].property['aria-selected'], 'true');
  ctx.Mucellit.app.openTab('calculator');
  assert.deepEqual(call.at(-1), ['hide', true], 'hide after the panel is hidden');
  assert.equal(elements['tab-calculator'].hidden, false);
  assert.equal(elements['tab-button-learn'].property['aria-selected'], 'false');
  ctx.Mucellit.app.openTab('unknown');
  assert.equal(elements['tab-impose'].hidden, false, 'unknown tab → Imposition');
  assert.deepEqual(call.at(-1), ['hide', true]);
});

test('tab: when the guide throws, the tab still opens, the error is reported and not swallowed (thrown later); without a guide the tabs work', async () => {
  const dropped = [];
  const old = globalThis.setTimeout;
  const { ctx, notices, elements } = setup({ ready: Promise.resolve(), learn: { tab: { show() { throw new Error('figure broken'); }, hide() {} } } });
  await wait();
  ctx.setTimeout = (fn) => { try { fn(); } catch (e) { dropped.push(e.message); } };
  ctx.Mucellit.app.openTab('learn');
  assert.equal(elements['tab-learn'].hidden, false);
  assert.deepEqual(notices.at(-1), ['Öğren sekmesi açılamadı: figure broken', 'error']);  // turkish-ok: expected Turkish UI text
  assert.deepEqual(dropped, ['figure broken']);
  assert.equal(globalThis.setTimeout, old);
  const none = setup({ ready: Promise.resolve() });
  await wait();
  assert.doesNotThrow(() => none.ctx.Mucellit.app.openTab('learn'));
  assert.equal(none.elements['tab-learn'].hidden, false);
});
