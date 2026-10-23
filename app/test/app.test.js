'use strict';
// app.js başlatma: baslat() içindeki hata da, platform.hazir reddi de
// "Uygulama başlatılamadı" bildirimine gider; işlenmemiş Promise reddi kalmaz.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

/** app.js'i sahte belge ve KitapCilt parçalarıyla çalıştırır. */
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
      i18n: require('../js/i18n.js'), // Node örneği (öntanımlı tr)
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

test('başlatma: hazır → başlar, data-ready evet, bildirim yok', async () => {
  const { notices, elements } = setup({ ready: Promise.resolve() });
  await wait();
  assert.deepEqual(notices, []);
  assert.equal(elements.html.property['data-ready'], 'yes');
});

test('başlatma: platform.ready reddedilirse "Uygulama başlatılamadı" bildirimi', async () => {
  const { notices } = setup({ ready: Promise.reject(new Error('köprü yok')) });
  await wait();
  assert.deepEqual(notices, [['Uygulama başlatılamadı: köprü yok', 'error']]);
});

test('başlatma: start() içinde hata atılırsa yakalanır, bildirime gider (işlenmemiş red yok)', async () => {
  const rejections = [];
  const listen = (e) => rejections.push(e);
  process.on('unhandledRejection', listen);
  try {
    const { notices, elements } = setup({ ready: Promise.resolve(), startProjects: () => { throw new Error('süreç bozuk'); } });
    await wait(); await wait();
    assert.deepEqual(notices, [['Uygulama başlatılamadı: süreç bozuk', 'error']]);
    assert.equal(elements.html.property['data-ready'], undefined);
  } finally {
    await wait();
    process.off('unhandledRejection', listen);
  }
  assert.deepEqual(rejections.map(String), []);
});

// ---------------------------------------------------------------- Öğren sekmesi
test('sekme: Öğren açılınca rehber gösterilir, başka sekmeye geçince gizlenir; paneller ve aria-selected doğru', async () => {
  const call = [];
  const tab = { show() { call.push(['show', elements['tab-learn'].hidden]); }, hide() { call.push(['hide', elements['tab-learn'].hidden]); } };
  const { ctx, elements } = setup({ ready: Promise.resolve(), learn: { tab } });
  await wait();
  call.length = 0;
  ctx.Mucellit.app.openTab('learn');
  assert.deepEqual(call, [['show', false]], 'goster panel görünür olduktan sonra');
  assert.equal(elements['tab-impose'].hidden, true);
  assert.equal(elements['tab-button-learn'].property['aria-selected'], 'true');
  ctx.Mucellit.app.openTab('calculator');
  assert.deepEqual(call.at(-1), ['hide', true], 'gizle panel gizlendikten sonra');
  assert.equal(elements['tab-calculator'].hidden, false);
  assert.equal(elements['tab-button-learn'].property['aria-selected'], 'false');
  ctx.Mucellit.app.openTab('unknown');
  assert.equal(elements['tab-impose'].hidden, false, 'bilinmeyen sekme → Düzenle');
  assert.deepEqual(call.at(-1), ['hide', true]);
});

test('sekme: rehber hata atarsa sekme yine açılır, hata bildirilir ve gizlenmez (sonradan atılır); rehber yoksa sekmeler çalışır', async () => {
  const dropped = [];
  const old = globalThis.setTimeout;
  const { ctx, notices, elements } = setup({ ready: Promise.resolve(), learn: { tab: { show() { throw new Error('figür bozuk'); }, hide() {} } } });
  await wait();
  ctx.setTimeout = (fn) => { try { fn(); } catch (e) { dropped.push(e.message); } };
  ctx.Mucellit.app.openTab('learn');
  assert.equal(elements['tab-learn'].hidden, false);
  assert.deepEqual(notices.at(-1), ['Öğren sekmesi açılamadı: figür bozuk', 'error']);
  assert.deepEqual(dropped, ['figür bozuk']);
  assert.equal(globalThis.setTimeout, old);
  const none = setup({ ready: Promise.resolve() });
  await wait();
  assert.doesNotThrow(() => none.ctx.Mucellit.app.openTab('learn'));
  assert.equal(none.elements['tab-learn'].hidden, false);
});
