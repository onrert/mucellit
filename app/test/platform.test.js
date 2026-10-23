'use strict';
// platform.js (tarayıcı) ve platform-tauri.js (sahte window.__TAURI__) birim testleri, G5.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setupI18n } = require('./i18n-helper.js');

const JS = path.join(__dirname, '..', 'js');
const read = (name) => fs.readFileSync(path.join(JS, name), 'utf8');

/** platform.js'i (ve istenirse platform-tauri.js'i) sahte bir pencerede çalıştırır. */
function setup({ confirm, tauri, document } = {}) {
  const ctx = { confirm, __TAURI__: tauri, Blob, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, setTimeout: () => 0, document: document };
  ctx.self = ctx;
  vm.createContext(ctx);
  setupI18n(ctx);
  vm.runInContext(read('platform.js'), ctx, { filename: 'platform.js' });
  vm.runInContext(read('platform-tauri.js'), ctx, { filename: 'platform-tauri.js' });
  return ctx;
}

test('tarayıcı: ad, hazir, yazdir yok, fullVersion true, kütüphane ipucu bugünkü metin', async () => {
  const P = setup({ confirm: () => true }).Mucellit.platform;
  assert.equal(P.name, 'browser');
  await P.ready;
  assert.equal(P.print, null);
  assert.equal(await P.fullVersion(), true);
  assert.equal(P.text.libraryHint, 'İnternet bağlantısını kontrol edip sayfayı yenileyin.');
});

test('onayla: senkron true → true, false → false', async () => {
  assert.equal(await setup({ confirm: () => true }).Mucellit.platform.ask('?'), true);
  assert.equal(await setup({ confirm: () => false }).Mucellit.platform.ask('?'), false);
});

test('onayla: Promise döndüren confirm (Tauri dialog eklentisi ezmesi) beklenir; Promise<false> → false', async () => {
  assert.equal(await setup({ confirm: async () => false }).Mucellit.platform.ask('?'), false);
  assert.equal(await setup({ confirm: async () => true }).Mucellit.platform.ask('?'), true);
});

test('onayla: yalnız tam true "evet" sayılır (dize, 1, nesne, undefined → false)', async () => {
  for (const d of ['Ok', 1, {}, undefined, null]) {
    assert.equal(await setup({ confirm: () => d }).Mucellit.platform.ask('?'), false, String(d));
  }
});

test('onayla: confirm hata atarsa Promise reddedilir (sessizce "evet" sayılmaz)', async () => {
  const P = setup({ confirm: () => { throw new Error('yok'); } }).Mucellit.platform;
  await assert.rejects(P.ask('?'), /yok/);
});

test('onayla: mesaj confirm\'e dize olarak geçer', async () => {
  let incoming;
  await setup({ confirm: (m) => { incoming = m; return false; } }).Mucellit.platform.ask(42);
  assert.equal(incoming, '42');
});

test('pickFile (tarayıcı): verilen gizli girdiye tıklar, null döner; girdi yoksa da null', async () => {
  const P = setup({}).Mucellit.platform;
  let tik = 0;
  assert.equal(await P.pickFile({ input: { click: () => { tik += 1; } } }), null);
  assert.equal(tik, 1);
  assert.equal(await P.pickFile({}), null);
  assert.equal(await P.pickFile(), null);
});

test('kaydet (tarayıcı): <a download> ile verilen adla tıklar, true döner', async () => {
  const added = [];
  const document = {
    createElement: () => ({ style: {}, click() { this.clicked = true; }, remove() {} }),
    body: { appendChild: (a) => added.push(a) },
  };
  const P = setup({ document }).Mucellit.platform;
  assert.equal(await P.save('cikti.pdf', new Uint8Array([1, 2]), 'application/pdf'), true);
  assert.equal(added.length, 1);
  assert.equal(added[0].download, 'cikti.pdf');
  assert.equal(added[0].href, 'blob:x');
  assert.equal(added[0].clicked, true);
});

test('kaydet (tarayıcı): DOM hatası Promise reddine döner', async () => {
  const document = { createElement: () => { throw new Error('dom yok'); }, body: {} };
  await assert.rejects(setup({ document }).Mucellit.platform.save('a', 'b'), /dom yok/);
});

test('platform-tauri: __TAURI__ yoksa ya da core yoksa hiçbir şeyi ezmez', () => {
  assert.equal(setup({}).Mucellit.platform.name, 'browser');
  assert.equal(setup({ tauri: {} }).Mucellit.platform.name, 'browser');
});

function fakeTauri(askResponse) {
  const T = { core: { invoke() {} }, call: [], listener: {} };
  if (askResponse !== undefined) T.dialog = { ask: async (m, s) => { T.call.push([m, s]); return askResponse; } };
  T.event = { listen: (name, f) => { T.listener[name] = f; return Promise.resolve(() => {}); } };
  return T;
}

test('platform-tauri: ad tauri; onayla yerel dialog.ask kullanır, "hayır" → false, "evet" → true', async () => {
  const T = fakeTauri(false);
  const P = setup({ tauri: T, confirm: () => { throw new Error('confirm çağrılmamalı'); } }).Mucellit.platform;
  assert.equal(P.name, 'tauri');
  assert.equal(await P.ask('Silinsin mi?'), false);
  assert.equal(T.call.length, 1);
  assert.equal(T.call[0][0], 'Silinsin mi?');
  assert.equal(T.call[0][1].kind, 'warning');
  assert.equal(await setup({ tauri: fakeTauri(true) }).Mucellit.platform.ask('?'), true);
});

test('platform-tauri: dialog.ask yoksa eklentinin ezdiği async confirm beklenir', async () => {
  assert.equal(await setup({ tauri: fakeTauri(), confirm: async () => false }).Mucellit.platform.ask('?'), false);
  assert.equal(await setup({ tauri: fakeTauri(), confirm: async () => true }).Mucellit.platform.ask('?'), true);
});

test('platform-tauri: kütüphane ipucu uygulama metniyle değişir; pickFile/kaydet yerel (tarayıcınınkinden farklı)', () => {
  const ctx = setup({ tauri: fakeTauri(true) });
  const P = ctx.Mucellit.platform;
  assert.notEqual(P.text.libraryHint, 'İnternet bağlantısını kontrol edip sayfayı yenileyin.');
  assert.doesNotMatch(P.text.libraryHint, /İnternet/);
  const browser = setup({}).Mucellit.platform;
  assert.notEqual(P.pickFile.toString(), browser.pickFile.toString());
  assert.notEqual(P.save.toString(), browser.save.toString());
  assert.equal(P.localFile, true);
  assert.equal(browser.localFile, false);
});

test('platform-tauri: menü olayı sekme öğesinde openTab çağırır, bilinmeyen öğede çağırmaz', () => {
  const T = fakeTauri(true);
  const ctx = setup({ tauri: T });
  const opened = [];
  ctx.Mucellit.app = { openTab: (s) => opened.push(s) };
  assert.equal(typeof T.listener.menu, 'function');
  T.listener.menu({ payload: 'tab-projects' });
  T.listener.menu({ payload: 'tab-calculator' });
  T.listener.menu({ payload: 'tab-impose' });
  T.listener.menu({ payload: 'tab-learn' }); // Görünüm > Öğren ⌘4
  T.listener.menu({ payload: 'unknown' });
  T.listener.menu({ payload: 'tab-learn ' });
  T.listener.menu({ payload: 'learn' });
  T.listener.menu({});
  T.listener.menu(null);
  assert.deepEqual(opened, ['projects', 'calculator', 'impose', 'learn']);
});

// Kaynak denetimi: platform katmanı dışındaki uygulama kodu tarayıcı diyaloglarını doğrudan çağırmaz.
// (Doğrudan `confirm(...)` Tauri'de Promise döner ve `if (!confirm())` kalıbı onaysız siler; alert beklemez.)
test('kaynak: platform.js / platform-tauri.js dışında doğrudan confirm/alert/prompt çağrısı yok', () => {
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
  assert.ok(files.length >= 10, 'en az 10 JS dosyası tarandı');
  assert.deepEqual(found, []);
});

test('kaynak denetimi kendisi: kusurlu örnekleri yakalar, temiz örneği geçirir', () => {
  const pattern = /(^|[^\w.$])(confirm|alert|prompt)\s*\(|\.(confirm|alert|prompt)\s*\(/;
  for (const bad of ['if (!root.confirm(m)) return;', 'confirm("x")', 'window.alert (1)', ' prompt(a)', 'x = self.prompt(1)']) assert.match(bad, pattern, bad);
  for (const good of ['MC.platform.ask(m)', 'ask(m, is)', 'var confirmed = 1;', 'prompts.push(x)']) assert.doesNotMatch(good, pattern, good);
});

// ---------------------------------------------------------------- Tauri dosya, kaydetme, son açılanlar, yedek
/**
 * Sahte Tauri penceresi: invoke çağrıları kaydedilir, yanıtlar `yanit[komut]` (değer ya da işlev) ile verilir.
 * setTimeout kuyruğu elle çalıştırılır (`zaman.calistir()`); DOM yalnız getElementById + olay dinleyicisi.
 */
function kurTauri({ response = {}, elements = {}, ls = null, storage = true, readyState = 'complete', i18n = 'tr', languages } = {}) {
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
    MC.projectModel = { emptyData: () => ({ version: 2, projects: [] }), validate: (v) => { if (!v || !Array.isArray(v.projects)) throw new Error('geçersiz'); } };
  }
  vm.runInContext(read('platform-tauri.js'), ctx, { filename: 'platform-tauri.js' });
  return { ctx, MC, P: MC.platform, call, listener, time, notices, opened, tab, documentListener };
}
/** Açılıştaki (hazir) yedek/kuyruk/dil çağrıları dışındaki invoke çağrıları (dil_oku + dil_ayarla da açılışta). */
const STARTUP = ['read_backup', 'pending_opens', 'read_language', 'set_language'];
const isCall = (s) => s.call.filter((c) => !STARTUP.includes(c.command));
const ab = (s) => { const b = Buffer.from(s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const wait = () => new Promise((r) => setImmediate(r));

test('pickFile: document → open_file {purpose: document} + read_file {id} → File (name, tür, bytes); JSON → purpose backup', async () => {
  const s = kurTauri({ response: { open_file: { id: 'k-1', name: 'Mavi Pusula.epub', kind: 'epub' }, read_file: () => ab('EPUBBAYT') } });
  const f = await s.P.pickFile({ extensions: ['pdf', 'epub'], input: { click() { throw new Error('gizli girdi açılmamalı'); } } });
  assert.equal(f.name, 'Mavi Pusula.epub');
  assert.equal(f.type, 'application/epub+zip');
  assert.equal(Buffer.from(await f.arrayBuffer()).toString(), 'EPUBBAYT');
  assert.deepEqual(isCall(s).map((c) => [c.command, JSON.stringify(c.arg)]), [['open_file', '{"purpose":"document"}'], ['read_file', '{"id":"k-1"}']]);
  const j = kurTauri({ response: { open_file: { id: 'k-2', name: 'yedek.json', kind: 'json' }, read_file: () => ab('{}') } });
  const fj = await j.P.pickFile({ extensions: ['json'] });
  assert.equal(fj.type, 'application/json');
  assert.equal(isCall(j)[0].arg.purpose, 'backup');
});

test('pickFile: vazgeçilirse null (read_file çağrılmaz); Rust hatası Promise reddine gider', async () => {
  const s = kurTauri({ response: { open_file: null } });
  assert.equal(await s.P.pickFile({ extensions: ['pdf'] }), null);
  assert.deepEqual(isCall(s).map((c) => c.command), ['open_file']);
  const h = kurTauri({ response: { open_file: () => Promise.reject('desteklenmeyen dosya: a.txt') } });
  await assert.rejects(h.P.pickFile({ extensions: ['pdf'] }), /desteklenmeyen/);
});

test('save: raw bytes gövde, x-name encodeURIComponent (ASCII başlık), x-kind; sonuç {name, path} ya da false', async () => {
  const s = kurTauri({ response: { save_file: (b, o) => (o.headers['x-kind'] === 'pdf' ? { name: 'Çiğdemköy-dizilmis.pdf', path: '/Users/x/Masaüstü/Çiğdemköy-dizilmis.pdf' } : null) } });
  const r = await s.P.save('Çiğdemköy-dizilmis.pdf', new Uint8Array([37, 80, 68, 70]), 'application/pdf');
  assert.deepEqual({ ...r }, { name: 'Çiğdemköy-dizilmis.pdf', path: '/Users/x/Masaüstü/Çiğdemköy-dizilmis.pdf' });
  const k = () => s.call.filter((x) => x.command === 'save_file');
  const c = k()[0];
  assert.equal(c.command, 'save_file');
  assert.ok(ArrayBuffer.isView(c.arg), 'gövde ham bayt (Uint8Array)');
  assert.deepEqual([...c.arg], [37, 80, 68, 70]);
  assert.equal(c.options.headers['x-name'], encodeURIComponent('Çiğdemköy-dizilmis.pdf'));
  assert.match(c.options.headers['x-name'], /^[\x21-\x7e]+$/, 'başlık ASCII');
  assert.equal(c.options.headers['x-kind'], 'pdf');
  // JSON metni → UTF-8 bayt, tür json; Rust null (vazgeçildi) → false
  assert.equal(await s.P.save('yedek.json', '{"name":"ğ"}', 'application/json'), false);
  assert.equal(k()[1].options.headers['x-kind'], 'json');
  assert.equal(Buffer.from(k()[1].arg).toString(), '{"name":"ğ"}');
  // Blob ve ArrayBuffer
  await s.P.save('b.pdf', new Blob([Buffer.from('BLOB')]), 'application/pdf');
  assert.equal(Buffer.from(k()[2].arg).toString(), 'BLOB');
  await s.P.save('c.pdf', ab('AB'), 'application/pdf');
  assert.equal(Buffer.from(k()[3].arg).toString(), 'AB');
  await assert.rejects(s.P.save('d.pdf', 42, 'application/pdf'), /tanınmadı/);
  // Rust yolsuz/garip yanıt → false (başarı sayılmaz)
  const g = kurTauri({ response: { save_file: { name: 'x' } } });
  assert.equal(await g.P.save('x.pdf', 'x', 'application/pdf'), false);
});

test('saveAll: dosyalar SIRAYLA (ikinci pencere birinci kapanınca); vazgeç/hata sıradakini durdurmaz', async () => {
  const order = [];
  let finishFirst;
  const s = kurTauri({ response: { save_file: (b, o) => {
    const name = decodeURIComponent(o.headers['x-name']);
    order.push('basla ' + name);
    if (name === 'a-onler.pdf') return new Promise((r) => { finishFirst = () => { order.push('bitti ' + name); r(null); }; });
    if (name === 'a-arkalar.pdf') return { name, path: '/k/' + name };
    return Promise.reject(new Error('disk dolu'));
  } } });
  const promise = s.P.saveAll([{ name: 'a-onler.pdf', bytes: new Uint8Array([1]) }, { name: 'a-arkalar.pdf', bytes: new Uint8Array([2]) }, { name: 'a-ucuncu.pdf', bytes: new Uint8Array([3]) }], 'application/pdf');
  await wait();
  assert.deepEqual(order, ['basla a-onler.pdf'], 'ikinci pencere birinci bitmeden açılmadı');
  finishFirst();
  const r = await promise;
  assert.deepEqual(order, ['basla a-onler.pdf', 'bitti a-onler.pdf', 'basla a-arkalar.pdf', 'basla a-ucuncu.pdf']);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { saved: [{ name: 'a-arkalar.pdf', path: '/k/a-arkalar.pdf' }], cancelled: ['a-onler.pdf'], failed: [{ name: 'a-ucuncu.pdf', message: 'disk dolu' }] });
});

test('saveMessage (D7): başarıda gerçek yol, vazgeçte "kaydedilmedi"; "hazır" yanlış başarısı yok', () => {
  const { P } = kurTauri();
  const tam = P.saveMessage({ saved: [{ name: 'a.pdf', path: '/K/a.pdf' }], cancelled: [], failed: [] }, 24);
  assert.deepEqual({ ...tam }, { text: 'Kaydedildi: /K/a.pdf (24 yüz).', kind: undefined });
  const iki = P.saveMessage({ saved: [{ name: 'o.pdf', path: '/K/o.pdf' }, { name: 'a.pdf', path: '/K/a.pdf' }], cancelled: [], failed: [] }, 12);
  assert.equal(iki.text, 'Kaydedildi: /K/o.pdf, /K/a.pdf (12 yüz).');
  const never = P.saveMessage({ saved: [], cancelled: ['a.pdf'], failed: [] }, 24);
  assert.equal(never.kind, 'error');
  assert.match(never.text, /kaydedilmedi/);
  const partial = P.saveMessage({ saved: [{ name: 'o.pdf', path: '/K/o.pdf', side: 12 }], cancelled: ['a.pdf'], failed: [] }, 24);
  assert.equal(partial.kind, 'error');
  assert.match(partial.text, /^Kaydedildi: \/K\/o\.pdf \(12 yüz\)\. Kaydedilmedi \(vazgeçildi\): a\.pdf\.$/);
  const failed = P.saveMessage({ saved: [], cancelled: [], failed: [{ name: 'a.pdf', message: 'yazılamadı: izin yok' }] }, 24);
  assert.equal(failed.kind, 'error');
  assert.equal(failed.text, 'a.pdf kaydedilemedi: yazılamadı: izin yok');
  for (const m of [tam, iki, never, partial, failed]) assert.doesNotMatch(m.text, /hazır/);
});

test('openRecent: listedeki kayıt → read_recent_file → File; NOTFOUND/ACCESS/UNKNOWN anlaşılır hataya; listede yoksa Rust çağrılmaz', async () => {
  const list = [{ id: 'u1', name: 'Tez.pdf', kind: 'pdf', date: 1 }, { id: 'u2', name: 'Silik.epub', kind: 'epub', date: 1 }, { id: 'u3', name: 'Izin.pdf', kind: 'pdf', date: 1 }];
  const s = kurTauri({ response: { recent_files: list, read_recent_file: (a) => {
    if (a.id === 'u1') return ab('%PDF-tez');
    if (a.id === 'u2') return Promise.reject('NOTFOUND: The file couldn’t be opened');
    if (a.id === 'u3') return Promise.reject('ACCESS: sistem dosyaya erişim vermedi');
    return Promise.reject('UNKNOWN: son açılanlarda böyle bir kayıt yok');
  } } });
  const f = await s.P.openRecent('u1');
  assert.equal(f.name, 'Tez.pdf');
  assert.equal(f.type, 'application/pdf');
  assert.equal(Buffer.from(await f.arrayBuffer()).toString(), '%PDF-tez');
  await assert.rejects(s.P.openRecent('u2'), /^Error: Silik\.epub bulunamadı .*çıkarıldı\.$/);
  await assert.rejects(s.P.openRecent('u3'), /Izin\.pdf açılamadı: sistem dosyaya yeniden erişim izni vermedi/);
  const once = s.call.length;
  await assert.rejects(s.P.openRecent('/etc/hosts'), /artık yok/);
  assert.deepEqual(s.call.slice(once).map((c) => c.command), ['recent_files'], 'listede olmayan kimlik Rust\'a okutulmaz');
  // tarayıcıda: boş liste, null
  const t = setup({}).Mucellit.platform;
  assert.equal((await t.recentFiles()).length, 0);
  assert.equal(await t.openRecent('u1'), null);
});

test('onMenu: Dosya öğeleri doğru düğmeyi/sekmeyi tetikler; Kaydet kapalıysa bildirim; son:<kimlik> belgeyi açar; kusurlu kimlik yok sayılır', async () => {
  const tik = [];
  const button = (id, disabled) => ({ disabled: !!disabled, click() { tik.push(id); } });
  const elements = { 'pdf-select': button('pdf-select'), 'export-transfer': button('export-transfer', true), 'json-export': button('json-export'), 'json-import-button': button('json-import-button') };
  const s = kurTauri({ elements, response: { recent_files: [{ id: 'u1', name: 'Tez.pdf', kind: 'pdf' }], read_recent_file: () => ab('%PDF') } });
  s.P.onMenu('file-open');
  s.P.onMenu('file-save');
  assert.deepEqual(tik, ['pdf-select'], 'kapalı Kaydet düğmesine tıklanmadı');
  assert.match(s.notices.at(-1)[0], /Önce bir PDF/);
  elements['export-transfer'].disabled = false;
  s.P.onMenu('file-save');
  s.P.onMenu('json-export');
  s.P.onMenu('json-import');
  assert.deepEqual(tik, ['pdf-select', 'export-transfer', 'json-export', 'json-import-button']);
  assert.deepEqual(s.tab, ['impose', 'impose', 'projects', 'projects']);
  await s.P.onMenu('last:u1');
  assert.deepEqual(s.opened, [{ name: 'Tez.pdf', kind: 'application/pdf', text: '%PDF' }]);
  // olay yolu da aynı işi yapar
  await s.listener.menu({ payload: 'tab-calculator' });
  assert.equal(s.tab.at(-1), 'calculator');
  const once = { tik: tik.length, opened: s.opened.length, call: s.call.length, notice: s.notices.length, tab: s.tab.length };
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'last', 'file', '', null, undefined, 42, {}]) {
    assert.doesNotThrow(() => s.P.onMenu(k), String(k));
  }
  await wait();
  assert.equal(tik.length, once.tik);
  assert.equal(s.opened.length, once.opened);
  assert.equal(s.call.length, once.call);
  assert.equal(s.notices.length, once.notice, 'kusurlu kimlik bildirim de üretmez');
  assert.equal(s.tab.length, once.tab);
});

test('Son Açılanlar menüsünden açılamayan belge bildirime gider (Promise reddedilmez)', async () => {
  const s = kurTauri({ response: { recent_files: [{ id: 'u2', name: 'Silik.epub', kind: 'epub' }], read_recent_file: () => Promise.reject('NOTFOUND: yok') } });
  await s.P.onMenu('last:u2');
  assert.equal(s.opened.length, 0);
  assert.match(s.notices.at(-1)[0], /^Dosya açılamadı: Silik\.epub bulunamadı/);
  assert.equal(s.notices.at(-1)[1], 'error');
});

test('hazir: localStorage boşsa geçerli yedek geri yüklenir ve bildirilir; dolu, bozuk ya da okunamayan yedekte dokunulmaz', async () => {
  const lsYap = (first) => { const m = new Map(first ? [['mucellit.projects', first]] : []); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };
  const backup = JSON.stringify({ version: 2, projects: [{ id: 'k1', name: 'Çiğdemköy' }] });
  const blank = lsYap();
  const s = kurTauri({ ls: blank, response: { read_backup: backup, pending_opens: [] } });
  await s.P.ready;
  assert.equal(blank.m.get('mucellit.projects'), backup);
  s.time.run();
  assert.ok(s.notices.some((b) => /otomatik yedekten geri/.test(b[0])));
  const filled = lsYap('{"version":2,"projects":[]}');
  await kurTauri({ ls: filled, response: { read_backup: backup } }).P.ready;
  assert.equal(filled.m.get('mucellit.projects'), '{"version":2,"projects":[]}', 'mevcut veri ezilmedi');
  for (const bad of ['{corrupt', '{"projects":5}', '[]', null, 42]) {
    const l = lsYap();
    await kurTauri({ ls: l, response: { read_backup: bad } }).P.ready;
    assert.equal(l.m.has('mucellit.projects'), false, String(bad));
  }
  const l = lsYap();
  const r = kurTauri({ ls: l, response: { read_backup: () => Promise.reject('okunamadı') } });
  await r.P.ready; // reddedilmez: uygulama başlar
  assert.equal(l.m.has('mucellit.projects'), false);
  // localStorage erişimi hata atarsa da başlar
  await kurTauri({ ls: { getItem() { throw new Error('kapalı'); } }, response: { read_backup: backup } }).P.ready;
});

test('hazir: sayfa betikleri yüklenene (DOMContentLoaded) kadar bekler; Kaydet düğmesi metni değişir', async () => {
  const button = { textContent: "Dizilmiş PDF'i indir" };
  const s = kurTauri({ readyState: 'loading', elements: { 'export-transfer': button }, response: { read_backup: null, pending_opens: [] } });
  let finished = false;
  s.P.ready.then(() => { finished = true; });
  await wait();
  assert.equal(finished, false, 'DOMContentLoaded öncesi hazır değil');
  assert.deepEqual(s.call, [], 'yedek DOM hazır olmadan okunmaz');
  s.documentListener.DOMContentLoaded.forEach((f) => f());
  await s.P.ready;
  assert.equal(button.textContent, "Dizilmiş PDF'i kaydet…");
});

test('depo yedeği: yaz/temizle asıl işlevi çağırır, sonucu korur, son hali yedekler; backup_data reddi bildirilir', async () => {
  const s = kurTauri({ response: { read_backup: null, pending_opens: [], backup_data: undefined } });
  await s.P.ready;
  s.time.run();
  const D = s.MC.storage;
  assert.equal(D.write({ version: 2, projects: [{ id: 'a' }] }), true, 'asıl yaz sonucu korunur');
  D.write({ version: 2, projects: [{ id: 'b' }] });
  const y = s.call.filter((c) => c.command === 'backup_data');
  assert.deepEqual(JSON.parse(y.at(-1).arg.json), { version: 2, projects: [{ id: 'b' }] }, 'son hali');
  assert.deepEqual(D.written.map((v) => (v.projects ? v.projects[0].id : v)), ['a', 'b'], 'asıl yaz çağrıldı');
  D.clear();
  assert.equal(D.written.at(-1), 'CLEAR', 'asıl temizle çağrıldı');
  assert.deepEqual(JSON.parse(s.call.filter((c) => c.command === 'backup_data').at(-1).arg.json), { version: 2, projects: [] }, 'temizle → boş veri yedeklenir');
  assert.equal(s.time.tail.length, 0, 'JS tarafında zamanlayıcı yok (bekletme Rust\'ta)');
  // yedek reddedilirse (geçersiz/çok büyük) bildirim
  const h = kurTauri({ response: { read_backup: null, pending_opens: [], backup_data: () => Promise.reject('yedek çok büyük (17000000 bayt)') } });
  await h.P.ready;
  h.MC.storage.write({ version: 2, projects: [] });
  await wait();
  assert.ok(h.notices.some((b) => /otomatik yedeği yazılamadı: yedek çok büyük/.test(b[0]) && b[1] === 'error'));
});

test('dış açılış (Dock/Finder): hazır olmadan gelen olay yok sayılır, açılışta kuyruk boşaltılır; sonra olayla açılır', async () => {
  let tail = [{ id: 'd1', name: 'Bir.pdf', kind: 'pdf' }, { id: 'd2', name: 'Iki.epub', kind: 'epub' }];
  const s = kurTauri({ readyState: 'loading', response: {
    read_backup: null,
    pending_opens: () => { const k = tail; tail = []; return k; },
    read_file: (a) => ab('content-' + a.id),
  } });
  s.listener['file-opened']({});
  await wait();
  assert.equal(s.call.filter((c) => c.command === 'pending_opens').length, 0, 'hazır olmadan kuyruk okunmaz');
  s.documentListener.DOMContentLoaded.forEach((f) => f());
  await s.P.ready;
  s.time.run();
  for (let i = 0; i < 10; i++) await wait();
  assert.deepEqual(s.opened.map((a) => [a.name, a.kind, a.text]), [['Bir.pdf', 'application/pdf', 'content-d1'], ['Iki.epub', 'application/epub+zip', 'content-d2']], 'sırayla, son açılan en son');
  tail = [{ id: 'd3', name: 'Uc.pdf', kind: 'pdf' }];
  s.listener['file-opened']({});
  for (let i = 0; i < 10; i++) await wait();
  assert.equal(s.opened.at(-1).name, 'Uc.pdf');
});

// ----------------------------------------------------------------
test('O2 temizle: boş veri yedeği HEMEN gider (zamanlayıcı beklenmez; ⌘Q arada gelse de eski dolu yedek kalmaz)', async () => {
  const s = kurTauri({ response: { read_backup: null, pending_opens: [], backup_data: undefined } });
  await s.P.ready;
  s.time.run();
  s.MC.storage.clear();
  const y = s.call.filter((c) => c.command === 'backup_data');
  assert.equal(y.length, 1, 'temizle anında backup_data (zamanlayıcı çalıştırılmadan)');
  assert.deepEqual(JSON.parse(y[0].arg.json), { version: 2, projects: [] });
});

test('O2 yaz: her değişiklik Rust\'a hemen gider (bekletme ve kapanışta yazma Rust\'ta); oturum + artan sıra', async () => {
  const s = kurTauri({ response: { read_backup: null, pending_opens: [], backup_data: undefined } });
  await s.P.ready;
  s.time.run();
  s.MC.storage.write({ version: 2, projects: [{ id: 'a' }] });
  s.MC.storage.write({ version: 2, projects: [{ id: 'b' }] });
  const y = s.call.filter((c) => c.command === 'backup_data');
  assert.equal(y.length, 2, 'zamanlayıcı beklenmeden iki çağrı');
  assert.deepEqual(y.map((c) => JSON.parse(c.arg.json).projects[0].id), ['a', 'b']);
  assert.equal(typeof y[0].arg.session, 'string');
  assert.ok(y[0].arg.session.length >= 8, 'oturum kimliği');
  assert.equal(y[0].arg.session, y[1].arg.session, 'aynı sayfa aynı oturum');
  assert.ok(Number.isSafeInteger(y[0].arg.order) && y[1].arg.order > y[0].arg.order, 'sıra artar');
  const other = kurTauri({ response: { read_backup: null, pending_opens: [] } });
  await other.P.ready;
  other.MC.storage.write({ version: 2, projects: [] });
  assert.notEqual(other.call.find((c) => c.command === 'backup_data').arg.session, y[0].arg.session, 'yeni sayfa yeni oturum');
});

test('O2 boş yedek (kasıtlı temizlik) geri yüklenmez, "geri yüklendi" bildirimi çıkmaz', async () => {
  const lsYap = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };
  const l = lsYap();
  const s = kurTauri({ ls: l, response: { read_backup: JSON.stringify({ version: 2, projects: [] }), pending_opens: [] } });
  await s.P.ready;
  s.time.run();
  assert.equal(l.m.has('mucellit.projects'), false, 'boş yedek localStorage\'a yazılmaz');
  assert.ok(!s.notices.some((b) => /geri yüklendi/.test(b[0])), 'bildirim yok: ' + JSON.stringify(s.notices));
});

test('O2 Rust\'taki gecikmeli yazım başarısızsa (backup-writeFailed olayı) bildirilir', async () => {
  const s = kurTauri({ response: { read_backup: null, pending_opens: [] } });
  await s.P.ready;
  assert.equal(typeof s.listener['backup-writeFailed'], 'function', 'olay dinleniyor');
  s.listener['backup-writeFailed']({ payload: 'yedek yazılamadı: disk dolu' });
  assert.ok(s.notices.some((b) => /otomatik yedeği yazılamadı: yedek yazılamadı: disk dolu/.test(b[0]) && b[1] === 'error'));
});

test('O4 openRecent: yalnız NOTFOUND/INVALID "çıkarıldı" der; ACCESS/NODISK/TRANSIENT kaydın durduğunu ayrı metinle söyler', async () => {
  const list = ['b', 'g', 'e', 'd', 'c'].map((k) => ({ id: k, name: k.toUpperCase() + '.pdf', kind: 'pdf', date: 1 }));
  const code = { b: 'NOTFOUND: The file doesn’t exist.', g: 'INVALID: tür uyuşmuyor', e: 'ACCESS: sistem dosyaya erişim vermedi', d: 'NODISK: Yedek Disk', c: 'TRANSIENT: Resource deadlock avoided' };
  const s = kurTauri({ response: { recent_files: list, read_recent_file: (a) => Promise.reject(code[a.id]) } });
  const m = {};
  for (const k of Object.keys(code)) m[k] = await s.P.openRecent(k).then(() => null, (e) => e.message);
  assert.match(m.b, /^B\.pdf bulunamadı .*Son Açılanlar'dan çıkarıldı\.$/);
  assert.match(m.g, /^G\.pdf .*çıkarıldı\.$/);
  for (const k of ['e', 'd', 'c']) {
    assert.doesNotMatch(m[k], /çıkarıldı/, k + ': ' + m[k]);
    assert.match(m[k], /Son Açılanlar'da duruyor/, k + ': ' + m[k]);
  }
  assert.match(m.e, /^E\.pdf açılamadı: sistem dosyaya yeniden erişim izni vermedi/);
  assert.match(m.d, /^D\.pdf açılamadı: bulunduğu disk \(Yedek Disk\) takılı değil/);
  assert.match(m.c, /^C\.pdf şu an açılamadı \(Resource deadlock avoided\)/);
  assert.equal(new Set(Object.values(m)).size, 5, 'beş ayrı metin');
});

test('D9 saveMessage: kısmi kayıtta yalnız kaydedilen dosyaların yüz sayısı; saveAll dosya başına yüzü taşır', async () => {
  const { P } = kurTauri();
  const partial = P.saveMessage({ saved: [{ name: 'o.pdf', path: '/K/o.pdf', side: 12 }], cancelled: ['a.pdf'], failed: [] }, 24);
  assert.equal(partial.text, 'Kaydedildi: /K/o.pdf (12 yüz). Kaydedilmedi (vazgeçildi): a.pdf.');
  const iki = P.saveMessage({ saved: [{ name: 'o.pdf', path: '/K/o.pdf', side: 12 }, { name: 'a.pdf', path: '/K/a.pdf', side: 12 }], cancelled: [], failed: [] }, 24);
  assert.equal(iki.text, 'Kaydedildi: /K/o.pdf, /K/a.pdf (24 yüz).');
  const bilgisiz = P.saveMessage({ saved: [{ name: 'o.pdf', path: '/K/o.pdf' }], cancelled: ['a.pdf'], failed: [] }, 24);
  assert.equal(bilgisiz.text, 'Kaydedildi: /K/o.pdf. Kaydedilmedi (vazgeçildi): a.pdf.', 'dosya başı bilgi yoksa toplam yazılmaz');
  const s = kurTauri({ response: { save_file: (b, o) => { const name = decodeURIComponent(o.headers['x-name']); return name === 'x-onler.pdf' ? { name, path: '/K/' + name } : null; } } });
  const r = await s.P.saveAll([{ name: 'x-onler.pdf', bytes: new Uint8Array([1]), side: 6 }, { name: 'x-arkalar.pdf', bytes: new Uint8Array([2]), side: 6 }], 'application/pdf');
  assert.deepEqual(JSON.parse(JSON.stringify(r.saved)), [{ name: 'x-onler.pdf', path: '/K/x-onler.pdf', side: 6 }]);
  assert.equal(s.P.saveMessage(r, 12).text, 'Kaydedildi: /K/x-onler.pdf (6 yüz). Kaydedilmedi (vazgeçildi): x-arkalar.pdf.');
});

test('D10 ⌘S: dizilmiş PDF hazırlanırken / Kaydet penceresi açıkken (düğme aria-busy) yok sayılır; yanlış "Önce bir PDF" yok', () => {
  const tik = [];
  const button = { disabled: true, getAttribute: (a) => (a === 'aria-busy' ? 'true' : null), click() { tik.push('export-transfer'); } };
  const s = kurTauri({ elements: { 'export-transfer': button } });
  s.P.onMenu('file-save');
  assert.deepEqual(tik, []);
  assert.deepEqual(s.notices, [], 'bildirim yok: ' + JSON.stringify(s.notices));
  button.getAttribute = () => null; // meşgul değil, kapalı → eski bildirim
  s.P.onMenu('file-save');
  assert.match(s.notices.at(-1)[0], /Önce bir PDF/);
});

// ---------------------------------------------------------------- düzeltme
const lsMemory = (first = {}) => { const m = new Map(Object.entries(first)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const lastI18nSettings = (s) => s.call.filter((c) => c.command === 'set_language').map((c) => ({ ...c.arg })).slice(-1)[0];

test('Tauri\'de sistem dili Rust\'tan gelir (read_language.system; menü ile aynı kaynak); elle seçim yoksa arayüz o dilde', async () => {
  // WKWebView navigator.languages tr-TR derken macOS tercihi (Apple kuralı) en: arayüz ve "Sistem dili (X)" Rust'a uyar
  const s = kurTauri({ i18n: 'tr', ls: lsMemory(), response: { read_language: { code: 'en', choice: 'system', system: 'en' }, read_backup: null, pending_opens: [] } });
  await s.P.ready;
  const D = s.MC.i18n;
  assert.equal(D.systemCode(), 'en');
  assert.equal(D.code(), 'en');
  assert.deepEqual(lastI18nSettings(s), { code: 'en', choice: 'system' });
  // elle seçim varsa o kalır; sistem dili yine Rust'ınki
  const e = kurTauri({ i18n: 'tr', ls: lsMemory({ 'mucellit.language': 'tr' }), response: { read_language: { code: 'tr', choice: 'tr', system: 'en' }, read_backup: null, pending_opens: [] } });
  await e.P.ready;
  assert.equal(e.MC.i18n.code(), 'tr');
  assert.equal(e.MC.i18n.systemCode(), 'en');
  assert.deepEqual(lastI18nSettings(e), { code: 'tr', choice: 'tr' });
  // Rust tersini söylüyorsa (macOS tr, tarayıcı en) da Rust
  const t = kurTauri({ i18n: 'en', ls: lsMemory(), response: { read_language: { code: 'tr', choice: 'system', system: 'tr' }, read_backup: null, pending_opens: [] } });
  await t.P.ready;
  assert.equal(t.MC.i18n.code(), 'tr');
});

test('read_language eski/kusurlu yanıt (sistem yok, desteklenmeyen, hata) başlatmayı durdurmaz; tarayıcı dili kalır', async () => {
  for (const y of [{ code: 'tr', choice: 'system' }, { code: 'tr', choice: 'system', system: 'xx' }, { code: 'tr', choice: 'system', system: 5 }, null, () => Promise.reject(new Error('yok'))]) {
    const s = kurTauri({ i18n: 'tr', ls: lsMemory(), response: { read_language: y, read_backup: null, pending_opens: [] } });
    await s.P.ready;
    assert.equal(s.MC.i18n.code(), 'tr', String(y && JSON.stringify(y)));
    assert.equal(s.MC.i18n.systemCode(), 'tr', String(y && JSON.stringify(y)));
  }
});

test('Mac uygulamasında tarayıcıya özgü metinler Mac metniyle (saklama ipucu, saklama uyarısı, denetim uyarısı); tarayıcıda eskisi', async () => {
  const hintSheet = () => ({ textContent: '', attribute: { 'data-i18n': 'projects.storage_hint' }, setAttribute(a, v) { this.attribute[a] = v; }, getAttribute(a) { return this.attribute[a]; } });
  const hint = hintSheet();
  const s = kurTauri({ i18n: 'en', ls: lsMemory(), elements: { 'storage-hint': hint }, response: { read_language: { code: 'en', choice: 'system', system: 'en' }, read_backup: null, pending_opens: [] } });
  assert.equal(hint.attribute['data-i18n'], 'tauri.storage_hint', 'betik yüklenince (hazir beklenmeden) değişir');
  assert.match(hint.textContent, /this Mac/);
  assert.doesNotMatch(hint.textContent, /browser/i);
  for (const name of ['storageWarning', 'checkWarning']) {
    assert.match(s.P.text[name], /\S/, name);
    assert.doesNotMatch(s.P.text[name], /browser|private window|reload the page/i, name);
  }
  await s.P.ready;
  // tarayıcı: eski metinler (anahtarlar aynı)
  const b = setup({});
  const D = b.Mucellit.i18n;
  assert.equal(b.Mucellit.platform.text.storageWarning, D.t('projects.warning.storage'));
  assert.equal(b.Mucellit.platform.text.checkWarning, D.t('impose.warning.check'));
  // Türkçede de (tarayıcı metni "tarayıcı" der, Mac metni demez)
  const hintTr = hintSheet();
  const tr = kurTauri({ i18n: 'tr', ls: lsMemory(), elements: { 'storage-hint': hintTr } });
  assert.match(hintTr.textContent, /Mac/);
  assert.doesNotMatch(hintTr.textContent, /tarayıcı/i);
  assert.match(tr.P.text.storageWarning, /\S/);
  assert.doesNotMatch(tr.P.text.storageWarning + tr.P.text.checkWarning, /tarayıcı|gizli pencere|sayfayı yenile/i);
});

// ----------------------------------------------------------------
test('i18n.js yoksa (KC.dil yok) platform-tauri.js yüklenirken hata atmaz; metinler yüklü en sözlüğünden, o da yoksa anahtar', async () => {
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
    vm.runInContext(read('platform-tauri.js'), ctx, { filename: 'platform-tauri.js' }); // atarsa test KALDI
    return { P: ctx.Mucellit.platform, call };
  };
  const { P, call } = run(true);
  assert.equal(P.name, 'tauri');
  assert.equal(typeof P.ask, 'function');
  assert.match(hint.textContent, /stored on this Mac/);
  assert.match(P.text.libraryHint, /^[A-Z]/);
  await P.ready; // dil adımı atlanır, yedek okunur; reddedilmez
  assert.ok(!call.includes('read_language') && call.includes('read_backup'), JSON.stringify(call));
  assert.equal(P.saveMessage({ saved: [], cancelled: ['a.pdf'], failed: [] }).text, "The imposed PDF wasn't saved (the Save dialog was canceled).");
  // en sözlüğü de yoksa anahtar (yine hata yok)
  hint.textContent = 'static';
  run(false);
  assert.equal(hint.textContent, 'tauri.storage_hint');
});

// ---------------------------------------------------------------- yazdırma
test('tarayıcı: yazdir ve openInPreview yok (Yazdır düğmesi gizli kalır)', () => {
  const P = setup({}).Mucellit.platform;
  assert.equal(P.print, null);
  assert.equal(P.openInPreview, null);
});

test('yazdir: Rust yazdir komutuna ham PDF baytı + x-name (ASCII); true → true, false/garip yanıt → false, hata → red', async () => {
  const responses = [true, false, 'yes', null];
  const s = kurTauri({ response: { print: () => responses.shift(), open_in_preview: (b, o) => decodeURIComponent(o.headers['x-name']) } });
  assert.equal(await s.P.print('Çiğdemköy-onler.pdf', new Uint8Array([37, 80, 68, 70])), true);
  const c = s.call.filter((x) => x.command === 'print');
  assert.ok(ArrayBuffer.isView(c[0].arg) && [...c[0].arg].join() === '37,80,68,70', 'gövde ham bayt');
  assert.equal(c[0].options.headers['x-name'], encodeURIComponent('Çiğdemköy-onler.pdf'));
  assert.match(c[0].options.headers['x-name'], /^[\x21-\x7e]+$/);
  assert.equal(await s.P.print('a.pdf', 'x'), false);
  assert.equal(await s.P.print('a.pdf', 'x'), false, '"evet" dizesi başarı sayılmaz');
  assert.equal(await s.P.print('a.pdf', 'x'), false);
  const h = kurTauri({ response: { print: () => Promise.reject('bu platformda yazdırma henüz yok') } });
  await assert.rejects(h.P.print('a.pdf', 'x'), /henüz yok/);
  assert.equal((await s.P.openInPreview('Ç.pdf', new Uint8Array([1]))).name, 'Ç.pdf');
  const o = kurTauri({ response: { open_in_preview: () => Promise.reject('izin yok') } });
  await assert.rejects(o.P.openInPreview('a.pdf', 'x'), /izin yok/);
});

test('menü ⌘P / ⌥⌘P: Düzenle\'deki düğmeye basar; meşgul (aria-busy) → yok sayılır; kapalı/gizli → "Önce bir PDF açın" bildirimi', () => {
  const tik = [];
  const button = (id, d = {}) => ({ disabled: !!d.disabled, hidden: !!d.hidden, busy: !!d.busy, click() { tik.push(id); }, getAttribute(a) { return a === 'aria-busy' && this.busy ? 'true' : null; } });
  const elements = { print: button('print', { disabled: true }), 'inPreview-open': button('inPreview-open', { hidden: true }) };
  const s = kurTauri({ elements });
  s.P.onMenu('file-print');
  s.P.onMenu('file-preview');
  assert.deepEqual(tik, []);
  assert.deepEqual(s.notices.map((b) => b[0]), ['Önce bir PDF açın, sonra yazdırın.', 'Önce bir PDF açın, sonra yazdırın.']);
  elements.print.disabled = false; elements['inPreview-open'].hidden = false;
  s.P.onMenu('file-print');
  s.P.onMenu('file-preview');
  assert.deepEqual(tik, ['print', 'inPreview-open']);
  assert.deepEqual(s.tab.slice(-2), ['impose', 'impose']);
  elements.print.busy = true;
  const n = s.notices.length;
  s.P.onMenu('file-print');
  assert.deepEqual([tik.length, s.notices.length], [2, n], 'baskı/kaydet sürerken ⌘P yok sayılır, yanlış bildirim yok');
});
