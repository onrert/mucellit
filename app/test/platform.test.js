'use strict';
// Unit tests of platform.js (browser) and platform-tauri.js (fake window.__TAURI__), G5.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setupI18n } = require('./i18n-helper.js');

const JS = path.join(__dirname, '..', 'js');
const read = (name) => fs.readFileSync(path.join(JS, name), 'utf8');

/** Runs platform.js (and platform-tauri.js when asked) in a fake window. */
function setup({ confirm, tauri, document } = {}) {
  const ctx = { confirm, __TAURI__: tauri, Blob, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, setTimeout: () => 0, document: document };
  ctx.self = ctx;
  vm.createContext(ctx);
  setupI18n(ctx);
  vm.runInContext(read('platform.js'), ctx, { filename: 'platform.js' });
  vm.runInContext(read('platform-tauri.js'), ctx, { filename: 'platform-tauri.js' });
  return ctx;
}

test('browser: name, ready, no print, fullVersion true, library hint is the current text', async () => {
  const P = setup({ confirm: () => true }).Mucellit.platform;
  assert.equal(P.name, 'browser');
  await P.ready;
  assert.equal(P.print, null);
  assert.equal(await P.fullVersion(), true);
  assert.equal(P.text.libraryHint, 'İnternet bağlantısını kontrol edip sayfayı yenileyin.');  // turkish-ok: expected Turkish UI text
});

test('ask: synchronous true → true, false → false', async () => {
  assert.equal(await setup({ confirm: () => true }).Mucellit.platform.ask('?'), true);
  assert.equal(await setup({ confirm: () => false }).Mucellit.platform.ask('?'), false);
});

test('ask: a confirm that returns a Promise (the Tauri dialog plug-in override) is awaited; Promise<false> → false', async () => {
  assert.equal(await setup({ confirm: async () => false }).Mucellit.platform.ask('?'), false);
  assert.equal(await setup({ confirm: async () => true }).Mucellit.platform.ask('?'), true);
});

test('ask: only exactly true counts as "yes" (string, 1, object, undefined → false)', async () => {
  for (const d of ['Ok', 1, {}, undefined, null]) {
    assert.equal(await setup({ confirm: () => d }).Mucellit.platform.ask('?'), false, String(d));
  }
});

test('ask: when confirm throws the Promise is rejected (not silently counted as "yes")', async () => {
  const P = setup({ confirm: () => { throw new Error('none'); } }).Mucellit.platform;
  await assert.rejects(P.ask('?'), /none/);
});

test('ask: the message reaches confirm as a string', async () => {
  let incoming;
  await setup({ confirm: (m) => { incoming = m; return false; } }).Mucellit.platform.ask(42);
  assert.equal(incoming, '42');
});

test('pickFile (browser): clicks the given hidden input, returns null; null also without an input', async () => {
  const P = setup({}).Mucellit.platform;
  let clicks = 0;
  assert.equal(await P.pickFile({ input: { click: () => { clicks += 1; } } }), null);
  assert.equal(clicks, 1);
  assert.equal(await P.pickFile({}), null);
  assert.equal(await P.pickFile(), null);
});

test('save (browser): clicks an <a download> with the given name, returns true', async () => {
  const added = [];
  const document = {
    createElement: () => ({ style: {}, click() { this.clicked = true; }, remove() {} }),
    body: { appendChild: (a) => added.push(a) },
  };
  const P = setup({ document }).Mucellit.platform;
  assert.equal(await P.save('output.pdf', new Uint8Array([1, 2]), 'application/pdf'), true);
  assert.equal(added.length, 1);
  assert.equal(added[0].download, 'output.pdf');
  assert.equal(added[0].href, 'blob:x');
  assert.equal(added[0].clicked, true);
});

test('save (browser): a DOM error becomes a rejected Promise', async () => {
  const document = { createElement: () => { throw new Error('no dom'); }, body: {} };
  await assert.rejects(setup({ document }).Mucellit.platform.save('a', 'b'), /no dom/);
});

test('platform-tauri: without __TAURI__ or without core it overrides nothing', () => {
  assert.equal(setup({}).Mucellit.platform.name, 'browser');
  assert.equal(setup({ tauri: {} }).Mucellit.platform.name, 'browser');
});

function fakeTauri(askResponse) {
  const T = { core: { invoke() {} }, call: [], listener: {} };
  if (askResponse !== undefined) T.dialog = { ask: async (m, s) => { T.call.push([m, s]); return askResponse; } };
  T.event = { listen: (name, f) => { T.listener[name] = f; return Promise.resolve(() => {}); } };
  return T;
}

test('platform-tauri: name tauri; ask uses the native dialog.ask, "no" → false, "yes" → true', async () => {
  const T = fakeTauri(false);
  const P = setup({ tauri: T, confirm: () => { throw new Error('confirm must not be called'); } }).Mucellit.platform;
  assert.equal(P.name, 'tauri');
  assert.equal(await P.ask('Silinsin mi?'), false);  // turkish-ok: expected Turkish UI text
  assert.equal(T.call.length, 1);
  assert.equal(T.call[0][0], 'Silinsin mi?');  // turkish-ok: expected Turkish UI text
  assert.equal(T.call[0][1].kind, 'warning');
  assert.equal(await setup({ tauri: fakeTauri(true) }).Mucellit.platform.ask('?'), true);
});

test('platform-tauri: without dialog.ask the async confirm overridden by the plug-in is awaited', async () => {
  assert.equal(await setup({ tauri: fakeTauri(), confirm: async () => false }).Mucellit.platform.ask('?'), false);
  assert.equal(await setup({ tauri: fakeTauri(), confirm: async () => true }).Mucellit.platform.ask('?'), true);
});

test('platform-tauri: the library hint changes to the app text; pickFile/save are native (different from the browser ones)', () => {
  const ctx = setup({ tauri: fakeTauri(true) });
  const P = ctx.Mucellit.platform;
  assert.notEqual(P.text.libraryHint, 'İnternet bağlantısını kontrol edip sayfayı yenileyin.');  // turkish-ok: expected Turkish UI text
  assert.doesNotMatch(P.text.libraryHint, /İnternet/);  // turkish-ok: expected Turkish UI text
  const browser = setup({}).Mucellit.platform;
  assert.notEqual(P.pickFile.toString(), browser.pickFile.toString());
  assert.notEqual(P.save.toString(), browser.save.toString());
  assert.equal(P.localFile, true);
  assert.equal(browser.localFile, false);
});

test('platform-tauri: a menu event on a tab item calls openTab, an unknown item does not', () => {
  const T = fakeTauri(true);
  const ctx = setup({ tauri: T });
  const opened = [];
  ctx.Mucellit.app = { openTab: (s) => opened.push(s) };
  assert.equal(typeof T.listener.menu, 'function');
  T.listener.menu({ payload: 'tab-projects' });
  T.listener.menu({ payload: 'tab-calculator' });
  T.listener.menu({ payload: 'tab-impose' });
  T.listener.menu({ payload: 'tab-learn' }); // View > Learn ⌘4
  T.listener.menu({ payload: 'unknown' });
  T.listener.menu({ payload: 'tab-learn ' });
  T.listener.menu({ payload: 'learn' });
  T.listener.menu({});
  T.listener.menu(null);
  assert.deepEqual(opened, ['projects', 'calculator', 'impose', 'learn']);
});

// Source check: app code outside the platform layer does not call the browser dialogs directly.
// (A direct `confirm(...)` returns a Promise in Tauri and the `if (!confirm())` pattern deletes without asking; alert does not wait.)
test('source: no direct confirm/alert/prompt call outside platform.js / platform-tauri.js', () => {
  const files = [];
  (function walk(d) {
    for (const g of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, g.name);
      if (g.isDirectory()) walk(y);
      else if (g.name.endsWith('.js')) files.push(y);
    }
  })(JS);
  const allowed = new Set(['platform.js', 'platform-tauri.js'].map((a) => path.join(JS, a)));
  const found = [];
  for (const y of files) {
    if (allowed.has(y)) continue;
    const rows = fs.readFileSync(y, 'utf8').split('\n');
    rows.forEach((s, i) => {
      const code = s.replace(/\/\/.*$/, '');
      if (/(^|[^\w.$])(confirm|alert|prompt)\s*\(|\.(confirm|alert|prompt)\s*\(/.test(code)) found.push(`${path.relative(JS, y)}:${i + 1}`);
    });
  }
  assert.ok(files.length >= 10, 'at least 10 JS files scanned');
  assert.deepEqual(found, []);
});

test('the source check itself: catches the faulty samples, passes the clean sample', () => {
  const pattern = /(^|[^\w.$])(confirm|alert|prompt)\s*\(|\.(confirm|alert|prompt)\s*\(/;
  for (const bad of ['if (!root.confirm(m)) return;', 'confirm("x")', 'window.alert (1)', ' prompt(a)', 'x = self.prompt(1)']) assert.match(bad, pattern, bad);
  for (const good of ['MC.platform.ask(m)', 'ask(m, is)', 'var confirmed = 1;', 'prompts.push(x)']) assert.doesNotMatch(good, pattern, good);
});

// ---------------------------------------------------------------- Tauri file, save, recent files, backup
/**
 * Fake Tauri window: invoke calls are recorded, answers are given with `response[command]` (a value or a function).
 * The setTimeout queue is run by hand (`time.run()`); the DOM is only getElementById + event listeners.
 */
function setupTauri({ response = {}, elements = {}, ls = null, storage = true, readyState = 'complete', i18n = 'tr', languages } = {}) {
  const call = [];
  const listener = {};
  const T = {
    core: {
      invoke(command, arg, options) {
        call.push({ command, arg, options });
        const y = response[command];
        return Promise.resolve(typeof y === 'function' ? y(arg, options) : y);
      },
    },
    event: { listen: (name, f) => { listener[name] = f; return Promise.resolve(() => {}); } },
    dialog: { ask: async () => true },
  };
  const pending = [];
  let counter = 0;
  const time = {
    tail: pending,
    run() { while (pending.length) { const z = pending.shift(); z.f(); } },
  };
  const documentListener = {};
  const document = {
    readyState,
    getElementById: (id) => elements[id] || null,
    addEventListener: (name, f) => { (documentListener[name] = documentListener[name] || []).push(f); },
    visibilityState: 'visible',
  };
  const notices = [];
  const ctx = {
    __TAURI__: T, File, Blob, TextEncoder, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    document: document, localStorage: ls, navigator: { languages: languages || (i18n === 'tr' ? ['tr-TR'] : ['en-US']) },
    setTimeout: (f, ms) => { const id = ++counter; pending.push({ id, f, ms }); return id; },
    clearTimeout: (id) => { const i = pending.findIndex((z) => z.id === id); if (i >= 0) pending.splice(i, 1); },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  setupI18n(ctx, i18n);
  vm.runInContext(read('platform.js'), ctx, { filename: 'platform.js' });
  const MC = ctx.Mucellit;
  MC.common = { notify: (m, t) => notices.push([m, t]) };
  const opened = [];
  const tab = [];
  MC.impose = { openFile: async (f) => { opened.push({ name: f.name, kind: f.type, text: Buffer.from(await f.arrayBuffer()).toString() }); } };
  MC.app = { openTab: (s) => tab.push(s) };
  if (storage) {
    const written = [];
    MC.storage = { KEY: 'mucellit.projects', write: (v) => { written.push(v); return true; }, clear: () => { written.push('CLEAR'); }, written };
    MC.projectModel = { emptyData: () => ({ version: 2, projects: [] }), validate: (v) => { if (!v || !Array.isArray(v.projects)) throw new Error('invalid'); } };
  }
  vm.runInContext(read('platform-tauri.js'), ctx, { filename: 'platform-tauri.js' });
  return { ctx, MC, P: MC.platform, call, listener, time, notices, opened, tab, documentListener };
}
/** invoke calls other than the backup/queue/language calls at start-up (ready) (read_language + set_language at start-up too). */
const STARTUP = ['read_backup', 'pending_opens', 'read_language', 'set_language'];
const isCall = (s) => s.call.filter((c) => !STARTUP.includes(c.command));
const ab = (s) => { const b = Buffer.from(s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const wait = () => new Promise((r) => setImmediate(r));

test('pickFile: document → open_file {purpose: document} + read_file {id} → File (name, type, bytes); JSON → purpose backup', async () => {
  const s = setupTauri({ response: { open_file: { id: 'k-1', name: 'Mavi Pusula.epub', kind: 'epub' }, read_file: () => ab('EPUBBYTES') } });
  const f = await s.P.pickFile({ extensions: ['pdf', 'epub'], input: { click() { throw new Error('the hidden input must not be opened'); } } });
  assert.equal(f.name, 'Mavi Pusula.epub');
  assert.equal(f.type, 'application/epub+zip');
  assert.equal(Buffer.from(await f.arrayBuffer()).toString(), 'EPUBBYTES');
  assert.deepEqual(isCall(s).map((c) => [c.command, JSON.stringify(c.arg)]), [['open_file', '{"purpose":"document"}'], ['read_file', '{"id":"k-1"}']]);
  const j = setupTauri({ response: { open_file: { id: 'k-2', name: 'backup.json', kind: 'json' }, read_file: () => ab('{}') } });
  const fj = await j.P.pickFile({ extensions: ['json'] });
  assert.equal(fj.type, 'application/json');
  assert.equal(isCall(j)[0].arg.purpose, 'backup');
});

test('pickFile: cancelled → null (read_file not called); a Rust error goes to a rejected Promise', async () => {
  const s = setupTauri({ response: { open_file: null } });
  assert.equal(await s.P.pickFile({ extensions: ['pdf'] }), null);
  assert.deepEqual(isCall(s).map((c) => c.command), ['open_file']);
  const h = setupTauri({ response: { open_file: () => Promise.reject('unsupported file: a.txt') } });
  await assert.rejects(h.P.pickFile({ extensions: ['pdf'] }), /unsupported/);
});

test('save: raw bytes as the body, x-name encodeURIComponent (ASCII header), x-kind; result {name, path} or false', async () => {
  const s = setupTauri({ response: { save_file: (b, o) => (o.headers['x-kind'] === 'pdf' ? { name: 'Çiğdemköy-dizilmis.pdf', path: '/Users/x/Masaüstü/Çiğdemköy-dizilmis.pdf' } : null) } });  // turkish-ok: Turkish test text (UTF-8 file names)
  const r = await s.P.save('Çiğdemköy-dizilmis.pdf', new Uint8Array([37, 80, 68, 70]), 'application/pdf');  // turkish-ok: Turkish test text (UTF-8 file names)
  assert.deepEqual({ ...r }, { name: 'Çiğdemköy-dizilmis.pdf', path: '/Users/x/Masaüstü/Çiğdemköy-dizilmis.pdf' });  // turkish-ok: Turkish test text (UTF-8 file names)
  const k = () => s.call.filter((x) => x.command === 'save_file');
  const c = k()[0];
  assert.equal(c.command, 'save_file');
  assert.ok(ArrayBuffer.isView(c.arg), 'the body is raw bytes (Uint8Array)');
  assert.deepEqual([...c.arg], [37, 80, 68, 70]);
  assert.equal(c.options.headers['x-name'], encodeURIComponent('Çiğdemköy-dizilmis.pdf'));  // turkish-ok: Turkish test text (UTF-8 file names)
  assert.match(c.options.headers['x-name'], /^[\x21-\x7e]+$/, 'ASCII header');
  assert.equal(c.options.headers['x-kind'], 'pdf');
  // JSON text → UTF-8 bytes, kind json; Rust null (cancelled) → false
  assert.equal(await s.P.save('backup.json', '{"name":"ğ"}', 'application/json'), false);  // turkish-ok: Turkish test text (UTF-8 file names)
  assert.equal(k()[1].options.headers['x-kind'], 'json');
  assert.equal(Buffer.from(k()[1].arg).toString(), '{"name":"ğ"}');  // turkish-ok: Turkish test text (UTF-8 file names)
  // Blob and ArrayBuffer
  await s.P.save('b.pdf', new Blob([Buffer.from('BLOB')]), 'application/pdf');
  assert.equal(Buffer.from(k()[2].arg).toString(), 'BLOB');
  await s.P.save('c.pdf', ab('AB'), 'application/pdf');
  assert.equal(Buffer.from(k()[3].arg).toString(), 'AB');
  await assert.rejects(s.P.save('d.pdf', 42, 'application/pdf'), /tanınmadı/);  // turkish-ok: expected Turkish UI text
  // a Rust answer without a path / an odd answer → false (not counted as success)
  const g = setupTauri({ response: { save_file: { name: 'x' } } });
  assert.equal(await g.P.save('x.pdf', 'x', 'application/pdf'), false);
});

test('saveAll: the files ONE AFTER THE OTHER (the second dialog when the first closes); a cancel/error does not stop the next', async () => {
  const order = [];
  let finishFirst;
  const s = setupTauri({ response: { save_file: (b, o) => {
    const name = decodeURIComponent(o.headers['x-name']);
    order.push('start ' + name);
    if (name === 'a-fronts.pdf') return new Promise((r) => { finishFirst = () => { order.push('done ' + name); r(null); }; });
    if (name === 'a-backs.pdf') return { name, path: '/k/' + name };
    return Promise.reject(new Error('disk full'));
  } } });
  const promise = s.P.saveAll([{ name: 'a-fronts.pdf', bytes: new Uint8Array([1]) }, { name: 'a-backs.pdf', bytes: new Uint8Array([2]) }, { name: 'a-third.pdf', bytes: new Uint8Array([3]) }], 'application/pdf');
  await wait();
  assert.deepEqual(order, ['start a-fronts.pdf'], 'the second dialog did not open before the first finished');
  finishFirst();
  const r = await promise;
  assert.deepEqual(order, ['start a-fronts.pdf', 'done a-fronts.pdf', 'start a-backs.pdf', 'start a-third.pdf']);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { saved: [{ name: 'a-backs.pdf', path: '/k/a-backs.pdf' }], cancelled: ['a-fronts.pdf'], failed: [{ name: 'a-third.pdf', message: 'disk full' }] });
});

test('saveMessage (D7): the real path on success, "not saved" on cancel; no false "ready" success', () => {
  const { P } = setupTauri();
  const full = P.saveMessage({ saved: [{ name: 'a.pdf', path: '/K/a.pdf' }], cancelled: [], failed: [] }, 24);
  assert.deepEqual({ ...full }, { text: 'Kaydedildi: /K/a.pdf (24 yüz).', kind: undefined });  // turkish-ok: expected Turkish UI text
  const two = P.saveMessage({ saved: [{ name: 'o.pdf', path: '/K/o.pdf' }, { name: 'a.pdf', path: '/K/a.pdf' }], cancelled: [], failed: [] }, 12);
  assert.equal(two.text, 'Kaydedildi: /K/o.pdf, /K/a.pdf (12 yüz).');  // turkish-ok: expected Turkish UI text
  const never = P.saveMessage({ saved: [], cancelled: ['a.pdf'], failed: [] }, 24);
  assert.equal(never.kind, 'error');
  assert.match(never.text, /kaydedilmedi/);  // turkish-ok: expected Turkish UI text
  const partial = P.saveMessage({ saved: [{ name: 'o.pdf', path: '/K/o.pdf', side: 12 }], cancelled: ['a.pdf'], failed: [] }, 24);
  assert.equal(partial.kind, 'error');
  assert.match(partial.text, /^Kaydedildi: \/K\/o\.pdf \(12 yüz\)\. Kaydedilmedi \(vazgeçildi\): a\.pdf\.$/);  // turkish-ok: expected Turkish UI text
  const failed = P.saveMessage({ saved: [], cancelled: [], failed: [{ name: 'a.pdf', message: 'could not write: no permission' }] }, 24);
  assert.equal(failed.kind, 'error');
  assert.equal(failed.text, 'a.pdf kaydedilemedi: could not write: no permission');  // turkish-ok: expected Turkish UI text
  for (const m of [full, two, never, partial, failed]) assert.doesNotMatch(m.text, /hazır/);  // turkish-ok: expected Turkish UI text
});

test('openRecent: a listed entry → read_recent_file → File; NOTFOUND/ACCESS/UNKNOWN become clear errors; nothing is asked from Rust when not in the list', async () => {
  const list = [{ id: 'u1', name: 'Tez.pdf', kind: 'pdf', date: 1 }, { id: 'u2', name: 'Gone.epub', kind: 'epub', date: 1 }, { id: 'u3', name: 'Denied.pdf', kind: 'pdf', date: 1 }];
  const s = setupTauri({ response: { recent_files: list, read_recent_file: (a) => {
    if (a.id === 'u1') return ab('%PDF-tez');
    if (a.id === 'u2') return Promise.reject('NOTFOUND: The file couldn’t be opened');
    if (a.id === 'u3') return Promise.reject('ACCESS: the system denied access to the file');
    return Promise.reject('UNKNOWN: no such entry in the recent files');
  } } });
  const f = await s.P.openRecent('u1');
  assert.equal(f.name, 'Tez.pdf');
  assert.equal(f.type, 'application/pdf');
  assert.equal(Buffer.from(await f.arrayBuffer()).toString(), '%PDF-tez');
  await assert.rejects(s.P.openRecent('u2'), /^Error: Gone\.epub bulunamadı .*çıkarıldı\.$/);  // turkish-ok: expected Turkish UI text
  await assert.rejects(s.P.openRecent('u3'), /Denied\.pdf açılamadı: sistem dosyaya yeniden erişim izni vermedi/);  // turkish-ok: expected Turkish UI text
  const once = s.call.length;
  await assert.rejects(s.P.openRecent('/etc/hosts'), /artık yok/);  // turkish-ok: expected Turkish UI text
  assert.deepEqual(s.call.slice(once).map((c) => c.command), ['recent_files'], 'an id that is not in the list is not read by Rust');
  // in the browser: an empty list, null
  const t = setup({}).Mucellit.platform;
  assert.equal((await t.recentFiles()).length, 0);
  assert.equal(await t.openRecent('u1'), null);
});

test('onMenu: the File items trigger the right button/tab; a notice when Save is off; last:<id> opens the document; a faulty id is ignored', async () => {
  const clicks = [];
  const button = (id, disabled) => ({ disabled: !!disabled, click() { clicks.push(id); } });
  const elements = { 'pdf-select': button('pdf-select'), 'export-transfer': button('export-transfer', true), 'json-export': button('json-export'), 'json-import-button': button('json-import-button') };
  const s = setupTauri({ elements, response: { recent_files: [{ id: 'u1', name: 'Tez.pdf', kind: 'pdf' }], read_recent_file: () => ab('%PDF') } });
  s.P.onMenu('file-open');
  s.P.onMenu('file-save');
  assert.deepEqual(clicks, ['pdf-select'], 'the disabled Save button was not clicked');
  assert.match(s.notices.at(-1)[0], /Önce bir PDF/);  // turkish-ok: expected Turkish UI text
  elements['export-transfer'].disabled = false;
  s.P.onMenu('file-save');
  s.P.onMenu('json-export');
  s.P.onMenu('json-import');
  assert.deepEqual(clicks, ['pdf-select', 'export-transfer', 'json-export', 'json-import-button']);
  assert.deepEqual(s.tab, ['impose', 'impose', 'projects', 'projects']);
  await s.P.onMenu('last:u1');
  assert.deepEqual(s.opened, [{ name: 'Tez.pdf', kind: 'application/pdf', text: '%PDF' }]);
  // the event path does the same
  await s.listener.menu({ payload: 'tab-calculator' });
  assert.equal(s.tab.at(-1), 'calculator');
  const once = { clicks: clicks.length, opened: s.opened.length, call: s.call.length, notice: s.notices.length, tab: s.tab.length };
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'last', 'file', '', null, undefined, 42, {}]) {
    assert.doesNotThrow(() => s.P.onMenu(k), String(k));
  }
  await wait();
  assert.equal(clicks.length, once.clicks);
  assert.equal(s.opened.length, once.opened);
  assert.equal(s.call.length, once.call);
  assert.equal(s.notices.length, once.notice, 'a faulty id gives no notice either');
  assert.equal(s.tab.length, once.tab);
});

test('a document that cannot be opened from the Recent Items menu goes to a notice (the Promise is not rejected)', async () => {
  const s = setupTauri({ response: { recent_files: [{ id: 'u2', name: 'Gone.epub', kind: 'epub' }], read_recent_file: () => Promise.reject('NOTFOUND: missing') } });
  await s.P.onMenu('last:u2');
  assert.equal(s.opened.length, 0);
  assert.match(s.notices.at(-1)[0], /^Dosya açılamadı: Gone\.epub bulunamadı/);  // turkish-ok: expected Turkish UI text
  assert.equal(s.notices.at(-1)[1], 'error');
});

test('ready: with an empty localStorage a valid backup is restored and reported; a filled, broken or unreadable backup is left alone', async () => {
  const makeLs = (first) => { const m = new Map(first ? [['mucellit.projects', first]] : []); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };
  const backup = JSON.stringify({ version: 2, projects: [{ id: 'k1', name: 'Çiğdemköy' }] });  // turkish-ok: Turkish test text (UTF-8 file names)
  const blank = makeLs();
  const s = setupTauri({ ls: blank, response: { read_backup: backup, pending_opens: [] } });
  await s.P.ready;
  assert.equal(blank.m.get('mucellit.projects'), backup);
  s.time.run();
  assert.ok(s.notices.some((b) => /otomatik yedekten geri/.test(b[0])));  // turkish-ok: expected Turkish UI text
  const filled = makeLs('{"version":2,"projects":[]}');
  await setupTauri({ ls: filled, response: { read_backup: backup } }).P.ready;
  assert.equal(filled.m.get('mucellit.projects'), '{"version":2,"projects":[]}', 'the current data was not overwritten');
  for (const bad of ['{corrupt', '{"projects":5}', '[]', null, 42]) {
    const l = makeLs();
    await setupTauri({ ls: l, response: { read_backup: bad } }).P.ready;
    assert.equal(l.m.has('mucellit.projects'), false, String(bad));
  }
  const l = makeLs();
  const r = setupTauri({ ls: l, response: { read_backup: () => Promise.reject('could not be read') } });
  await r.P.ready; // not rejected: the app starts
  assert.equal(l.m.has('mucellit.projects'), false);
  // it starts even when localStorage access throws
  await setupTauri({ ls: { getItem() { throw new Error('off'); } }, response: { read_backup: backup } }).P.ready;
});

test('ready: waits until the page scripts are loaded (DOMContentLoaded); the Save button text changes', async () => {
  const button = { textContent: "Dizilmiş PDF'i indir" };  // turkish-ok: expected Turkish UI text
  const s = setupTauri({ readyState: 'loading', elements: { 'export-transfer': button }, response: { read_backup: null, pending_opens: [] } });
  let finished = false;
  s.P.ready.then(() => { finished = true; });
  await wait();
  assert.equal(finished, false, 'not ready before DOMContentLoaded');
  assert.deepEqual(s.call, [], 'the backup is not read before the DOM is ready');
  s.documentListener.DOMContentLoaded.forEach((f) => f());
  await s.P.ready;
  assert.equal(button.textContent, "Dizilmiş PDF'i kaydet…");  // turkish-ok: expected Turkish UI text
});

test('storage backup: write/clear call the original function, keep its result, back up the last state; a rejected backup_data is reported', async () => {
  const s = setupTauri({ response: { read_backup: null, pending_opens: [], backup_data: undefined } });
  await s.P.ready;
  s.time.run();
  const D = s.MC.storage;
  assert.equal(D.write({ version: 2, projects: [{ id: 'a' }] }), true, 'the original write result is kept');
  D.write({ version: 2, projects: [{ id: 'b' }] });
  const y = s.call.filter((c) => c.command === 'backup_data');
  assert.deepEqual(JSON.parse(y.at(-1).arg.json), { version: 2, projects: [{ id: 'b' }] }, 'son hali');
  assert.deepEqual(D.written.map((v) => (v.projects ? v.projects[0].id : v)), ['a', 'b'], 'the original write was called');
  D.clear();
  assert.equal(D.written.at(-1), 'CLEAR', 'the original clear was called');
  assert.deepEqual(JSON.parse(s.call.filter((c) => c.command === 'backup_data').at(-1).arg.json), { version: 2, projects: [] }, 'clear → empty data is backed up');
  assert.equal(s.time.tail.length, 0, 'no timer on the JS side (the debounce is in Rust)');
  // a notice when the backup is rejected (invalid/too big)
  const h = setupTauri({ response: { read_backup: null, pending_opens: [], backup_data: () => Promise.reject('backup too big (17000000 bytes)') } });
  await h.P.ready;
  h.MC.storage.write({ version: 2, projects: [] });
  await wait();
  assert.ok(h.notices.some((b) => /otomatik yedeği yazılamadı: backup too big/.test(b[0]) && b[1] === 'error'));  // turkish-ok: expected Turkish UI text
});

test('outside open (Dock/Finder): an event before ready is ignored, the queue is emptied at start-up; later it opens by event', async () => {
  let tail = [{ id: 'd1', name: 'One.pdf', kind: 'pdf' }, { id: 'd2', name: 'Two.epub', kind: 'epub' }];
  const s = setupTauri({ readyState: 'loading', response: {
    read_backup: null,
    pending_opens: () => { const k = tail; tail = []; return k; },
    read_file: (a) => ab('content-' + a.id),
  } });
  s.listener['file-opened']({});
  await wait();
  assert.equal(s.call.filter((c) => c.command === 'pending_opens').length, 0, 'the queue is not read before ready');
  s.documentListener.DOMContentLoaded.forEach((f) => f());
  await s.P.ready;
  s.time.run();
  for (let i = 0; i < 10; i++) await wait();
  assert.deepEqual(s.opened.map((a) => [a.name, a.kind, a.text]), [['One.pdf', 'application/pdf', 'content-d1'], ['Two.epub', 'application/epub+zip', 'content-d2']], 'in order, the last opened last');
  tail = [{ id: 'd3', name: 'Uc.pdf', kind: 'pdf' }];
  s.listener['file-opened']({});
  for (let i = 0; i < 10; i++) await wait();
  assert.equal(s.opened.at(-1).name, 'Uc.pdf');
});

// ----------------------------------------------------------------
test('O2 clear: the empty data backup goes AT ONCE (no timer wait; even if ⌘Q comes in between no old filled backup stays)', async () => {
  const s = setupTauri({ response: { read_backup: null, pending_opens: [], backup_data: undefined } });
  await s.P.ready;
  s.time.run();
  s.MC.storage.clear();
  const y = s.call.filter((c) => c.command === 'backup_data');
  assert.equal(y.length, 1, 'clear calls backup_data at once (without running the timer)');
  assert.deepEqual(JSON.parse(y[0].arg.json), { version: 2, projects: [] });
});

test('O2 write: every change goes to Rust at once (the debounce and the write on quit are in Rust); session + increasing sequence', async () => {
  const s = setupTauri({ response: { read_backup: null, pending_opens: [], backup_data: undefined } });
  await s.P.ready;
  s.time.run();
  s.MC.storage.write({ version: 2, projects: [{ id: 'a' }] });
  s.MC.storage.write({ version: 2, projects: [{ id: 'b' }] });
  const y = s.call.filter((c) => c.command === 'backup_data');
  assert.equal(y.length, 2, 'two calls without waiting for the timer');
  assert.deepEqual(y.map((c) => JSON.parse(c.arg.json).projects[0].id), ['a', 'b']);
  assert.equal(typeof y[0].arg.session, 'string');
  assert.ok(y[0].arg.session.length >= 8, 'session id');
  assert.equal(y[0].arg.session, y[1].arg.session, 'same page same session');
  assert.ok(Number.isSafeInteger(y[0].arg.order) && y[1].arg.order > y[0].arg.order, 'the sequence increases');
  const other = setupTauri({ response: { read_backup: null, pending_opens: [] } });
  await other.P.ready;
  other.MC.storage.write({ version: 2, projects: [] });
  assert.notEqual(other.call.find((c) => c.command === 'backup_data').arg.session, y[0].arg.session, 'new page new session');
});

test('O2 an empty backup (a deliberate clean-up) is not restored, no "restored" notice', async () => {
  const makeLs = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };
  const l = makeLs();
  const s = setupTauri({ ls: l, response: { read_backup: JSON.stringify({ version: 2, projects: [] }), pending_opens: [] } });
  await s.P.ready;
  s.time.run();
  assert.equal(l.m.has('mucellit.projects'), false, 'an empty backup is not written to localStorage');
  assert.ok(!s.notices.some((b) => /geri yüklendi/.test(b[0])), 'no notice: ' + JSON.stringify(s.notices));  // turkish-ok: expected Turkish UI text
});

test('O2 a failed delayed write in Rust (backup-writeFailed event) is reported', async () => {
  const s = setupTauri({ response: { read_backup: null, pending_opens: [] } });
  await s.P.ready;
  assert.equal(typeof s.listener['backup-writeFailed'], 'function', 'the event is listened to');
  s.listener['backup-writeFailed']({ payload: 'backup could not be written: disk full' });
  assert.ok(s.notices.some((b) => /otomatik yedeği yazılamadı: backup could not be written: disk full/.test(b[0]) && b[1] === 'error'));  // turkish-ok: expected Turkish UI text
});

test('O4 openRecent: only NOTFOUND/INVALID say "removed"; ACCESS/NODISK/TRANSIENT say with a separate text that the entry stays', async () => {
  const list = ['b', 'g', 'e', 'd', 'c'].map((k) => ({ id: k, name: k.toUpperCase() + '.pdf', kind: 'pdf', date: 1 }));
  const code = { b: 'NOTFOUND: The file doesn’t exist.', g: 'INVALID: kind mismatch', e: 'ACCESS: the system denied access to the file', d: 'NODISK: Backup Disk', c: 'TRANSIENT: Resource deadlock avoided' };
  const s = setupTauri({ response: { recent_files: list, read_recent_file: (a) => Promise.reject(code[a.id]) } });
  const m = {};
  for (const k of Object.keys(code)) m[k] = await s.P.openRecent(k).then(() => null, (e) => e.message);
  assert.match(m.b, /^B\.pdf bulunamadı .*Son Açılanlar'dan çıkarıldı\.$/);  // turkish-ok: expected Turkish UI text
  assert.match(m.g, /^G\.pdf .*çıkarıldı\.$/);  // turkish-ok: expected Turkish UI text
  for (const k of ['e', 'd', 'c']) {
    assert.doesNotMatch(m[k], /çıkarıldı/, k + ': ' + m[k]);  // turkish-ok: expected Turkish UI text
    assert.match(m[k], /Son Açılanlar'da duruyor/, k + ': ' + m[k]);  // turkish-ok: expected Turkish UI text
  }
  assert.match(m.e, /^E\.pdf açılamadı: sistem dosyaya yeniden erişim izni vermedi/);  // turkish-ok: expected Turkish UI text
  assert.match(m.d, /^D\.pdf açılamadı: bulunduğu disk \(Backup Disk\) takılı değil/);  // turkish-ok: expected Turkish UI text
  assert.match(m.c, /^C\.pdf şu an açılamadı \(Resource deadlock avoided\)/);  // turkish-ok: expected Turkish UI text
  assert.equal(new Set(Object.values(m)).size, 5, 'five separate texts');
});

test('D9 saveMessage: on a partial save only the page count of the saved files; saveAll carries the pages per file', async () => {
  const { P } = setupTauri();
  const partial = P.saveMessage({ saved: [{ name: 'o.pdf', path: '/K/o.pdf', side: 12 }], cancelled: ['a.pdf'], failed: [] }, 24);
  assert.equal(partial.text, 'Kaydedildi: /K/o.pdf (12 yüz). Kaydedilmedi (vazgeçildi): a.pdf.');  // turkish-ok: expected Turkish UI text
  const two = P.saveMessage({ saved: [{ name: 'o.pdf', path: '/K/o.pdf', side: 12 }, { name: 'a.pdf', path: '/K/a.pdf', side: 12 }], cancelled: [], failed: [] }, 24);
  assert.equal(two.text, 'Kaydedildi: /K/o.pdf, /K/a.pdf (24 yüz).');  // turkish-ok: expected Turkish UI text
  const bilgisiz = P.saveMessage({ saved: [{ name: 'o.pdf', path: '/K/o.pdf' }], cancelled: ['a.pdf'], failed: [] }, 24);
  assert.equal(bilgisiz.text, 'Kaydedildi: /K/o.pdf. Kaydedilmedi (vazgeçildi): a.pdf.', 'no total is written without per-file information');  // turkish-ok: expected Turkish UI text
  const s = setupTauri({ response: { save_file: (b, o) => { const name = decodeURIComponent(o.headers['x-name']); return name === 'x-fronts.pdf' ? { name, path: '/K/' + name } : null; } } });
  const r = await s.P.saveAll([{ name: 'x-fronts.pdf', bytes: new Uint8Array([1]), side: 6 }, { name: 'x-backs.pdf', bytes: new Uint8Array([2]), side: 6 }], 'application/pdf');
  assert.deepEqual(JSON.parse(JSON.stringify(r.saved)), [{ name: 'x-fronts.pdf', path: '/K/x-fronts.pdf', side: 6 }]);
  assert.equal(s.P.saveMessage(r, 12).text, 'Kaydedildi: /K/x-fronts.pdf (6 yüz). Kaydedilmedi (vazgeçildi): x-backs.pdf.');  // turkish-ok: expected Turkish UI text
});

test('D10 ⌘S: ignored while the imposed PDF is being prepared / the Save dialog is open (button aria-busy); no false "Open a PDF first"', () => {
  const clicks = [];
  const button = { disabled: true, getAttribute: (a) => (a === 'aria-busy' ? 'true' : null), click() { clicks.push('export-transfer'); } };
  const s = setupTauri({ elements: { 'export-transfer': button } });
  s.P.onMenu('file-save');
  assert.deepEqual(clicks, []);
  assert.deepEqual(s.notices, [], 'no notice: ' + JSON.stringify(s.notices));
  button.getAttribute = () => null; // not busy, disabled → the old notice
  s.P.onMenu('file-save');
  assert.match(s.notices.at(-1)[0], /Önce bir PDF/);  // turkish-ok: expected Turkish UI text
});

// ---------------------------------------------------------------- fixes
const lsMemory = (first = {}) => { const m = new Map(Object.entries(first)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const lastI18nSettings = (s) => s.call.filter((c) => c.command === 'set_language').map((c) => ({ ...c.arg })).slice(-1)[0];

test('in Tauri the system language comes from Rust (read_language.system; the same source as the menu); without a manual choice the interface is in that language', async () => {
  // WKWebView says navigator.languages tr-TR while the macOS preference (Apple rule) is en: the interface and "System Language (X)" follow Rust
  const s = setupTauri({ i18n: 'tr', ls: lsMemory(), response: { read_language: { code: 'en', choice: 'system', system: 'en' }, read_backup: null, pending_opens: [] } });
  await s.P.ready;
  const D = s.MC.i18n;
  assert.equal(D.systemCode(), 'en');
  assert.equal(D.code(), 'en');
  assert.deepEqual(lastI18nSettings(s), { code: 'en', choice: 'system' });
  // a manual choice stays; the system language is still Rust's
  const e = setupTauri({ i18n: 'tr', ls: lsMemory({ 'mucellit.language': 'tr' }), response: { read_language: { code: 'tr', choice: 'tr', system: 'en' }, read_backup: null, pending_opens: [] } });
  await e.P.ready;
  assert.equal(e.MC.i18n.code(), 'tr');
  assert.equal(e.MC.i18n.systemCode(), 'en');
  assert.deepEqual(lastI18nSettings(e), { code: 'tr', choice: 'tr' });
  // when Rust says the opposite (macOS tr, browser en) it is still Rust
  const t = setupTauri({ i18n: 'en', ls: lsMemory(), response: { read_language: { code: 'tr', choice: 'system', system: 'tr' }, read_backup: null, pending_opens: [] } });
  await t.P.ready;
  assert.equal(t.MC.i18n.code(), 'tr');
});

test('an old/faulty read_language answer (no system, unsupported, error) does not stop the start-up; the browser language stays', async () => {
  for (const y of [{ code: 'tr', choice: 'system' }, { code: 'tr', choice: 'system', system: 'xx' }, { code: 'tr', choice: 'system', system: 5 }, null, () => Promise.reject(new Error('none'))]) {
    const s = setupTauri({ i18n: 'tr', ls: lsMemory(), response: { read_language: y, read_backup: null, pending_opens: [] } });
    await s.P.ready;
    assert.equal(s.MC.i18n.code(), 'tr', String(y && JSON.stringify(y)));
    assert.equal(s.MC.i18n.systemCode(), 'tr', String(y && JSON.stringify(y)));
  }
});

test('in the Mac app the browser-specific texts are the Mac texts (storage hint, storage warning, check warning); the old ones in the browser', async () => {
  const hintSheet = () => ({ textContent: '', attribute: { 'data-i18n': 'projects.storage_hint' }, setAttribute(a, v) { this.attribute[a] = v; }, getAttribute(a) { return this.attribute[a]; } });
  const hint = hintSheet();
  const s = setupTauri({ i18n: 'en', ls: lsMemory(), elements: { 'storage-hint': hint }, response: { read_language: { code: 'en', choice: 'system', system: 'en' }, read_backup: null, pending_opens: [] } });
  assert.equal(hint.attribute['data-i18n'], 'tauri.storage_hint', 'changes as soon as the script loads (without waiting for ready)');
  assert.match(hint.textContent, /this Mac/);
  assert.doesNotMatch(hint.textContent, /browser/i);
  for (const name of ['storageWarning', 'checkWarning']) {
    assert.match(s.P.text[name], /\S/, name);
    assert.doesNotMatch(s.P.text[name], /browser|private window|reload the page/i, name);
  }
  await s.P.ready;
  // browser: the old texts (the same keys)
  const b = setup({});
  const D = b.Mucellit.i18n;
  assert.equal(b.Mucellit.platform.text.storageWarning, D.t('projects.warning.storage'));
  assert.equal(b.Mucellit.platform.text.checkWarning, D.t('impose.warning.check'));
  // in Turkish too (the browser text mentions the browser, the Mac text does not)
  const hintTr = hintSheet();
  const tr = setupTauri({ i18n: 'tr', ls: lsMemory(), elements: { 'storage-hint': hintTr } });
  assert.match(hintTr.textContent, /Mac/);
  assert.doesNotMatch(hintTr.textContent, /tarayıcı/i);  // turkish-ok: expected Turkish UI text
  assert.match(tr.P.text.storageWarning, /\S/);
  assert.doesNotMatch(tr.P.text.storageWarning + tr.P.text.checkWarning, /tarayıcı|gizli pencere|sayfayı yenile/i);  // turkish-ok: expected Turkish UI text
});

// ----------------------------------------------------------------
test('without i18n.js (no Mucellit.i18n) platform-tauri.js does not throw while loading; the texts from the loaded en dictionary, the key without it', async () => {
  const hint = { attribute: {}, textContent: 'static', setAttribute(a, v) { this.attribute[a] = v; } };
  const document = { readyState: 'complete', getElementById: (id) => (id === 'storage-hint' ? hint : null) };
  const run = (mostDictionary) => {
    const T = fakeTauri(true);
    const call = [];
    T.core.invoke = (k) => { call.push(k); return Promise.resolve(k === 'read_backup' ? null : k === 'pending_opens' ? [] : null); };
    const ctx = { __TAURI__: T, document: document, setTimeout: () => 0, Blob };
    ctx.self = ctx;
    vm.createContext(ctx);
    if (mostDictionary) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'i18n', 'en.js'), 'utf8'), ctx);
    vm.runInContext(read('platform.js'), ctx, { filename: 'platform.js' });
    vm.runInContext(read('platform-tauri.js'), ctx, { filename: 'platform-tauri.js' }); // the test FAILs if it throws
    return { P: ctx.Mucellit.platform, call };
  };
  const { P, call } = run(true);
  assert.equal(P.name, 'tauri');
  assert.equal(typeof P.ask, 'function');
  assert.match(hint.textContent, /stored on this Mac/);
  assert.match(P.text.libraryHint, /^[A-Z]/);
  await P.ready; // the language step is skipped, the backup is read; not rejected
  assert.ok(!call.includes('read_language') && call.includes('read_backup'), JSON.stringify(call));
  assert.equal(P.saveMessage({ saved: [], cancelled: ['a.pdf'], failed: [] }).text, "The imposed PDF wasn't saved (the Save dialog was canceled).");
  // without the en dictionary too: the key (still no error)
  hint.textContent = 'static';
  run(false);
  assert.equal(hint.textContent, 'tauri.storage_hint');
});

// ---------------------------------------------------------------- printing
test('browser: no print and no openInPreview (the Print button stays hidden)', () => {
  const P = setup({}).Mucellit.platform;
  assert.equal(P.print, null);
  assert.equal(P.openInPreview, null);
});

test('print: the Rust print command gets the raw PDF bytes + x-name (ASCII); true → true, false/odd answer → false, error → rejection', async () => {
  const responses = [true, false, 'yes', null];
  const s = setupTauri({ response: { print: () => responses.shift(), open_in_preview: (b, o) => decodeURIComponent(o.headers['x-name']) } });
  assert.equal(await s.P.print('Çiğdemköy-onler.pdf', new Uint8Array([37, 80, 68, 70])), true);  // turkish-ok: Turkish test text (UTF-8 file names)
  const c = s.call.filter((x) => x.command === 'print');
  assert.ok(ArrayBuffer.isView(c[0].arg) && [...c[0].arg].join() === '37,80,68,70', 'the body is raw bytes');
  assert.equal(c[0].options.headers['x-name'], encodeURIComponent('Çiğdemköy-onler.pdf'));  // turkish-ok: Turkish test text (UTF-8 file names)
  assert.match(c[0].options.headers['x-name'], /^[\x21-\x7e]+$/);
  assert.equal(await s.P.print('a.pdf', 'x'), false);
  assert.equal(await s.P.print('a.pdf', 'x'), false, 'the string "yes" does not count as success');
  assert.equal(await s.P.print('a.pdf', 'x'), false);
  const h = setupTauri({ response: { print: () => Promise.reject('printing is not available on this platform yet') } });
  await assert.rejects(h.P.print('a.pdf', 'x'), /not available/);
  assert.equal((await s.P.openInPreview('Ç.pdf', new Uint8Array([1]))).name, 'Ç.pdf');  // turkish-ok: Turkish test text (UTF-8 file names)
  const o = setupTauri({ response: { open_in_preview: () => Promise.reject('no permission') } });
  await assert.rejects(o.P.openInPreview('a.pdf', 'x'), /no permission/);
});

test('menu ⌘P / ⌥⌘P: presses the button in Imposition; busy (aria-busy) → ignored; disabled/hidden → the "Open a PDF first" notice', () => {
  const clicks = [];
  const button = (id, d = {}) => ({ disabled: !!d.disabled, hidden: !!d.hidden, busy: !!d.busy, click() { clicks.push(id); }, getAttribute(a) { return a === 'aria-busy' && this.busy ? 'true' : null; } });
  const elements = { print: button('print', { disabled: true }), 'inPreview-open': button('inPreview-open', { hidden: true }) };
  const s = setupTauri({ elements });
  s.P.onMenu('file-print');
  s.P.onMenu('file-preview');
  assert.deepEqual(clicks, []);
  assert.deepEqual(s.notices.map((b) => b[0]), ['Önce bir PDF açın, sonra yazdırın.', 'Önce bir PDF açın, sonra yazdırın.']);  // turkish-ok: expected Turkish UI text
  elements.print.disabled = false; elements['inPreview-open'].hidden = false;
  s.P.onMenu('file-print');
  s.P.onMenu('file-preview');
  assert.deepEqual(clicks, ['print', 'inPreview-open']);
  assert.deepEqual(s.tab.slice(-2), ['impose', 'impose']);
  elements.print.busy = true;
  const n = s.notices.length;
  s.P.onMenu('file-print');
  assert.deepEqual([clicks.length, s.notices.length], [2, n], '⌘P is ignored while printing/saving, no wrong notice');
});
