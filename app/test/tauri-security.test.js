'use strict';
// Tauri security settings: the CSP in src-tauri/tauri.conf.json and the
// permissions in src-tauri/capabilities/default.json. The checkers are tested with faulty samples too.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const CONF = JSON.parse(fs.readFileSync(path.join(REPO, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const CAPABILITY = JSON.parse(fs.readFileSync(path.join(REPO, 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
const INDEX = fs.readFileSync(path.join(REPO, 'app', 'index.html'), 'utf8');

// ---------------------------------------------------------------- CSP denetleyicisi
// Only these sources are allowed; no outside address, wildcard, scheme wildcard (https:), blob:, no 'unsafe-*' for scripts.
// style-src 'unsafe-inline': the app uses the style attribute (projects.js progress bar) and every style attribute in the
// XHTML parsed from an EPUB with DOMParser made a CSP violation report (e2e: 2638 console
// errors). Outside sources are still forbidden (img-src/font-src/connect-src), so an inline style cannot carry data out.
const IPC = ['ipc:', 'http://ipc.localhost'];
const ALLOWED = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': IPC,
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'worker-src': ["'none'"],
};
const REQUIRED = ['default-src', 'script-src', 'connect-src', 'object-src', 'base-uri', 'form-action'];

/** Turns the CSP (Tauri's string or {directive: sources} form) into a directive → source list map. */
function parseCsp(csp) {
  const map = new Map();
  const errors = [];
  let parts;
  if (typeof csp === 'string') parts = csp.split(';').map((p) => p.trim()).filter(Boolean).map((p) => p.split(/\s+/));
  else if (csp && typeof csp === 'object' && !Array.isArray(csp)) {
    parts = Object.entries(csp).map(([y, k]) => [y, ...(Array.isArray(k) ? k : String(k).split(/\s+/)).filter(Boolean)]);
  } else return { map, errors: ['no CSP (null/empty/wrong type)'] };
  for (const [directive, ...source] of parts) {
    const y = directive.toLowerCase();
    if (map.has(y)) errors.push(`repeated directive: ${y}`);
    else map.set(y, source.map((k) => k.toLowerCase()));
  }
  if (!map.size) errors.push('empty CSP');
  return { map, errors };
}

/** Returns a list of problems; an empty list = passed. */
function checkCsp(csp) {
  const { map, errors } = parseCsp(csp);
  if (!map.size) return errors;
  for (const y of REQUIRED) if (!map.has(y)) errors.push(`required directive missing: ${y}`);
  for (const [y, sources] of map) {
    const permission = ALLOWED[y];
    if (!permission) { errors.push(`unknown/not allowed directive: ${y}`); continue; }
    if (!sources.length) errors.push(`directive without a source: ${y}`);
    for (const k of sources) if (!permission.includes(k)) errors.push(`${y}: not allowed source ${k}`);
  }
  const link = map.get('connect-src') || [];
  if (!link.includes('ipc:')) errors.push('connect-src: no ipc: (Tauri IPC does not work)');
  return errors;
}

test('CSP: the tauri.conf.json csp is strict; connect-src only IPC, no outside source', () => {
  assert.deepEqual(checkCsp(CONF.app.security.csp), []);
  const { map } = parseCsp(CONF.app.security.csp);
  assert.deepEqual(map.get('connect-src').slice().sort(), IPC.slice().sort());
  assert.ok(!/https?:\/\/(?!ipc\.localhost(\s|;|$))/i.test(String(CONF.app.security.csp)), 'an http(s) address other than ipc.localhost');
  // Tauri adds a nonce to the <style> elements in index.html; with a nonce/hash the browser ignores 'unsafe-inline'.
  assert.ok(!/<style[\s>]/i.test(INDEX), 'a <style> element in index.html');
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(INDEX), 'an inline <script> in index.html');
});

test('CSP: no separately loosened development CSP; Tauri\'s CSP modification not turned off', () => {
  const g = CONF.app.security;
  assert.ok(g.devCsp === undefined || g.devCsp === null || checkCsp(g.devCsp).length === 0, 'devCsp loose');
  assert.ok(!g.dangerousDisableAssetCspModification, 'dangerousDisableAssetCspModification on');
  assert.ok(!g.dangerousRemoteDomainIpcAccess, 'remote domain IPC access');
});

test('the CSP checker rejects faulty samples', () => {
  const good = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; form-action 'none'";
  assert.deepEqual(checkCsp(good), [], 'the good sample must pass');
  const bad = {
    'null': null,
    'empty string': '',
    'only a semicolon': ' ; ; ',
    'array': ["default-src 'none'"],
    'no connect-src': good.replace('; connect-src ipc: http://ipc.localhost', ''),
    'connect-src outside address': good.replace('http://ipc.localhost', 'http://ipc.localhost https://example.com'),
    'connect-src joker': good.replace('connect-src ipc:', 'connect-src *'),
    'connect-src scheme wildcard': good.replace('connect-src ipc:', 'connect-src ipc: https:'),
    'connect-src benzer alan': good.replace('http://ipc.localhost', 'http://ipc.localhost.evil.com'),
    'connect-src self': good.replace('connect-src ipc:', "connect-src ipc: 'self'"),
    'connect-src data': good.replace('connect-src ipc:', 'connect-src ipc: data:'),
    'connect-src ws': good.replace('connect-src ipc:', 'connect-src ipc: ws://localhost:1430'),
    'connect-src without ipc': good.replace('connect-src ipc: ', 'connect-src '),
    'upper case directive': good + '; CONNECT-SRC https://x.com',
    'upper case source': good.replace('http://ipc.localhost', 'HTTPS://EXAMPLE.COM'),
    'repeated default-src': good + '; default-src *',
    'a wildcard instead of default-src self': good.replace("default-src 'none'", 'default-src *'),
    'script-src unsafe-eval': good.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"),
    'script-src unsafe-inline': good.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    'script-src cdn': good.replace("script-src 'self'", "script-src 'self' https://cdn.jsdelivr.net"),
    'style-src outside address': good.replace("style-src 'self'", "style-src 'self' https://fonts.googleapis.com"),
    'style-src unsafe-eval': good.replace("style-src 'self'", "style-src 'self' 'unsafe-eval'"),
    'img-src outside': good.replace("img-src 'self' data:", "img-src 'self' data: https://iz.example"),
    'img-src blob': good.replace("img-src 'self' data:", "img-src 'self' data: blob:"),
    'no object-src': good.replace("; object-src 'none'", ''),
    'no base-uri': good.replace("; base-uri 'none'", ''),
    'directive without a source': good + '; img-src',
    'unknown directive': good + "; navigate-to 'self'",
    'outside address in the object form': { 'default-src': "'none'", 'script-src': "'self'", 'connect-src': ['ipc:', 'https://example.com'], 'object-src': "'none'", 'base-uri': "'none'", 'form-action': "'none'" },
  };
  for (const [name, csp] of Object.entries(bad)) assert.ok(checkCsp(csp).length > 0, `faulty sample passed: ${name}`);
  // the good form of the object style passes (the checker does not reject everything because of the form)
  assert.deepEqual(checkCsp({ 'default-src': "'none'", 'script-src': "'self'", 'connect-src': ['ipc:', 'http://ipc.localhost'], 'object-src': "'none'", 'base-uri': "'none'", 'form-action': "'none'" }), []);
});

// ---------------------------------------------------------------- Object.prototype dondurma
// the language scripts (dictionaries + js/i18n.js) load BEFORE vendor (the first frame is in the chosen language); this is the
// only non-vendor group that runs before freeze.js and it does not write to Object.prototype (tested below in a frozen context).
const isI18nScript = (b) => /^i18n\/[a-z]{2,3}\.js$/.test(b) || b === 'js/i18n.js';
/** index.html script order rules (empty array = fine). Tested with faulty orders too. */
function scriptOrderProblems(scripts) {
  const h = [];
  const i = scripts.indexOf('js/freeze.js');
  if (i <= 0) return ['index.html does not load js/freeze.js'];
  const once = scripts.slice(0, i);
  const firstVendor = once.findIndex((b) => b.startsWith('vendor/'));
  if (firstVendor < 0) h.push('vendor scripts missing');
  else {
    if (!once.slice(0, firstVendor).every(isI18nScript)) h.push('a non-language script before vendor');
    if (!once.slice(firstVendor).every((b) => b.startsWith('vendor/'))) h.push('a non-vendor script before freeze.js (language scripts after vendor)');
    if (once.slice(firstVendor).length < 3) h.push('vendor scripts missing');
  }
  if (!scripts.includes('js/i18n.js') || !once.includes('js/i18n.js')) h.push('js/i18n.js not before vendor');
  if (scripts.slice(i + 1).some((b) => b.startsWith('vendor/'))) h.push('a vendor script after freeze.js');
  return h;
}

test('script order: language scripts before vendor; freeze.js right after the last vendor script; the checker catches a faulty order', () => {
  const scripts = [...INDEX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scriptOrderProblems(scripts), []);
  const v = ['vendor/a.js', 'vendor/b.js', 'vendor/c.js'], d = ['i18n/en.js', 'i18n/tr.js', 'js/i18n.js'], u = ['js/platform.js'];
  assert.deepEqual(scriptOrderProblems([...d, ...v, 'js/freeze.js', ...u]), []);
  for (const [name, bad] of Object.entries({
    'old order (language after vendor)': [...v, 'js/freeze.js', ...d, ...u],
    'language among vendor': ['vendor/a.js', ...d, 'vendor/b.js', 'vendor/c.js', 'js/freeze.js', ...u],
    'app script before vendor': [...d, 'js/platform.js', ...v, 'js/freeze.js'],
    'no freeze': [...d, ...v, ...u],
    'vendor after freeze': [...d, ...v, 'js/freeze.js', 'vendor/d.js'],
    'vendor missing': [...d, 'vendor/a.js', 'js/freeze.js', ...u],
  })) assert.ok(scriptOrderProblems(bad).length > 0, name);
});

// ---------------------------------------------------------------- script order of the Learn guide
/** Every .js under app/js/learn/ (in the index.html form: js/learn/…). */
function learnFiles() {
  const root = path.join(REPO, 'app', 'js', 'learn'), l = [];
  (function walk(k) { for (const g of fs.readdirSync(k, { withFileTypes: true })) { const y = path.join(k, g.name); if (g.isDirectory()) walk(y); else if (g.name.endsWith('.js')) l.push(y); } })(root);
  return l.map((y) => 'js/' + path.relative(path.join(REPO, 'app', 'js'), y).split(path.sep).join('/')).sort();
}
/**
 * Order of the Learn scripts (empty array = fine): every file in app/js/learn/ is loaded once (none forgotten/extra/
 * repeated); all after freeze.js, calc.js and calculator.js, before app.js, one unbroken group; dependency order inside
 * the group: learn-measure → cf-engine → cf-page → figures/common → the other figures → learn-lessons → learn.js (last).
 */
function learnOrderProblems(scripts, files) {
  const h = [], og = scripts.filter((b) => b.startsWith('js/learn/'));
  const place = (b) => scripts.indexOf(b);
  for (const d of files) if (!og.includes(d)) h.push('a Learn file not loaded: ' + d);
  for (const b of og) if (!files.includes(b)) h.push('a Learn script that does not exist: ' + b);
  if (new Set(og).size !== og.length) h.push('a repeated Learn script');
  if (!og.length) return h.concat(['no Learn script']);
  const first = place(og[0]), last = scripts.lastIndexOf(og[og.length - 1]);
  if (scripts.slice(first, last + 1).some((b) => !b.startsWith('js/learn/'))) h.push('the Learn scripts are not one unbroken group');
  for (const on of ['js/freeze.js', 'js/calc.js', 'js/calculator.js']) if (!(place(on) >= 0 && place(on) < first)) h.push(`${on} not before the Learn scripts`);
  if (!(place('js/app.js') > last)) h.push('js/app.js not after the Learn scripts');
  const order = ['js/learn/learn-measure.js', 'js/learn/cf-engine.js', 'js/learn/cf-page.js', 'js/learn/figures/common.js'];
  for (let i = 1; i < order.length; i++) if (!(og.indexOf(order[i - 1]) >= 0 && og.indexOf(order[i - 1]) < og.indexOf(order[i]))) h.push(`${order[i - 1]} → ${order[i]} order broken`);
  const figures = og.filter((b) => b.startsWith('js/learn/figures/') && b !== 'js/learn/figures/common.js');
  if (figures.some((b) => og.indexOf(b) < og.indexOf('js/learn/figures/common.js'))) h.push('a figure before figures/common.js');
  const lesson = og.indexOf('js/learn/learn-lessons.js');
  if (!(lesson > Math.max(...figures.map((b) => og.indexOf(b))))) h.push('learn-lessons.js not after the figures');
  if (og[og.length - 1] !== 'js/learn/learn.js') h.push('learn.js not at the end of the Learn group');
  return h;
}

test('script order: the Learn scripts after freeze/calc/calculator, before app.js, in dependency order; the checker catches a faulty order', () => {
  const scripts = [...INDEX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  const files = learnFiles();
  assert.equal(files.length, 14, files.join());
  assert.deepEqual(learnOrderProblems(scripts, files), []);
  assert.deepEqual(scriptOrderProblems(scripts), [], 'the general order (language → vendor → freeze → app) is kept');
  const og = scripts.filter((b) => b.startsWith('js/learn/')), other = scripts.filter((b) => !b.startsWith('js/learn/'));
  const add = (l, once, ...e) => { const i = l.indexOf(once); return [...l.slice(0, i), ...e, ...l.slice(i)]; };
  const move = (b, once) => add(scripts.filter((x) => x !== b), once, b);
  const bad = {
    'no Learn': other,
    'a figure forgotten': scripts.filter((b) => b !== 'js/learn/figures/book.js'),
    'repeated figure': add(scripts, 'js/learn/learn-lessons.js', 'js/learn/figures/book.js'),
    'non script': add(scripts, 'js/learn/learn.js', 'js/learn/none.js'),
    'before freeze.js': add(other, 'js/freeze.js', ...og),
    'before calculator.js': add(other, 'js/calculator.js', ...og),
    'after app.js': [...other, ...og],
    'group split': move('js/calculator.js', 'js/learn/cf-page.js'),
    'cf-page before the engine': move('js/learn/cf-page.js', 'js/learn/cf-engine.js'),
    'a figure before common.js': move('js/learn/figures/sewing.js', 'js/learn/figures/common.js'),
    'lessons before the figures': move('js/learn/learn-lessons.js', 'js/learn/figures/common.js'),
    'learn.js not last': move('js/learn/learn.js', 'js/learn/learn-lessons.js'),
    'measure after the engine': move('js/learn/learn-measure.js', 'js/learn/cf-page.js'),
  };
  for (const [name, l] of Object.entries(bad)) {
    assert.notDeepEqual(l, scripts, `variant could not be applied: ${name}`);
    assert.ok(learnOrderProblems(l, files).length > 0, `faulty order passed: ${name}`);
  }
  assert.ok(learnOrderProblems([], files).length > 0, 'empty list');
});

test('the language scripts run in a context with Object.prototype frozen too (they do not write to the prototype)', () => {
  const vm = require('node:vm');
  const ctx = vm.createContext({ console });
  ctx.self = ctx;
  vm.runInContext('Object.freeze(Object.prototype)', ctx);
  for (const b of ['i18n/en.js', 'i18n/tr.js', 'js/i18n.js']) vm.runInContext(fs.readFileSync(path.join(REPO, 'app', b), 'utf8'), ctx, { filename: b });
  assert.equal(vm.runInContext('JSON.stringify([Mucellit.i18n.languages().join(), Mucellit.i18n.tIn("tr", "tab.impose"), Object.isFrozen(Object.prototype)])', ctx), '["en,tr","Düzenle",true]');  // turkish-ok: expected Turkish UI text
});

/**
 * ALL the language scripts that run before freeze.js (in the index.html order; every dictionary in the i18n/ folder must
 * load) do not write to Object.prototype (nor to the Array/Function/String prototypes). The dictionaries are not in
 * strict mode: in a frozen context pollution fails silently, so they are compared before/after in an UNFROZEN context;
 * it is also tested that they run without error in a frozen context and register every language. Returns a list of
 * problems (empty = fine).
 */
function i18nScriptsProtoProblems(scripts, read) {
  const vm = require('node:vm');
  const problem = [];
  const image = (ctx) => vm.runInContext(`JSON.stringify(['Object', 'Array', 'Function', 'String'].map((a) => {
    const p = globalThis[a].prototype;
    return Reflect.ownKeys(p).map((k) => { const d = Object.getOwnPropertyDescriptor(p, k); return a + '.' + String(k) + ':' + typeof d.value + (d.get ? ':get' : '') + (d.set ? ':set' : '') + ':' + d.enumerable + d.writable + d.configurable; }).sort();
  }))`, ctx);
  const isOpen = vm.createContext({ console });
  isOpen.self = isOpen;
  const once = image(isOpen);
  for (const b of scripts) {
    try { vm.runInContext(read(b), isOpen, { filename: b }); } catch (e) { problem.push(`${b}: ${e.message}`); }
  }
  const after = image(isOpen);
  if (once !== after) {
    const [o, s2] = [JSON.parse(once).flat(), JSON.parse(after).flat()];
    problem.push('prototype changed: ' + s2.filter((x) => !o.includes(x)).concat(o.filter((x) => !s2.includes(x)).map((x) => '-' + x)).join(', '));
  }
  const rotated = vm.createContext({ console });
  rotated.self = rotated;
  vm.runInContext('Object.freeze(Object.prototype)', rotated);
  for (const b of scripts) {
    try { vm.runInContext(read(b), rotated, { filename: b }); } catch (e) { problem.push(`${b} (frozen): ${e.message}`); }
  }
  const languages = scripts.filter((b) => /^i18n\/[a-z]{2,3}\.js$/.test(b)).map((b) => b.slice(5, -3)).sort().join();
  let registered = null;
  try { registered = vm.runInContext('Mucellit.i18n.languages().slice().sort().join()', rotated); } catch (e) { problem.push('no Mucellit.i18n in the frozen context: ' + e.message); }
  if (registered !== null && registered !== languages) problem.push(`languages in the frozen context ${registered} (expected ${languages})`);
  return problem;
}

test('all language scripts before freeze.js (index.html order, every i18n/*.js) do not write to the prototypes; the checker catches pollution', () => {
  const scripts = [...INDEX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  const i18n = scripts.slice(0, scripts.indexOf('js/freeze.js')).filter(isI18nScript);
  const folder = fs.readdirSync(path.join(REPO, 'app', 'i18n')).filter((a) => /^[a-z]{2,3}\.js$/.test(a)).map((a) => 'i18n/' + a);
  assert.deepEqual(folder.filter((k) => !i18n.includes(k)), [], 'a dictionary in the i18n/ folder that index.html does not load before freeze.js');
  assert.ok(i18n.includes('js/i18n.js') && i18n.length >= 3, i18n.join());
  const read = (b) => fs.readFileSync(path.join(REPO, 'app', b), 'utf8');
  assert.deepEqual(i18nScriptsProtoProblems(i18n, read), []);
  // faulty input: silent pollution in sloppy mode, defineProperty, Array.prototype, a script that registers no dictionary
  const fake = { 'i18n/xx.js': read('i18n/tr.js').replace('"_lang": "tr"', '"_lang": "xx"') };
  const readS = (b) => (b in fake ? fake[b] : read(b));
  const dirty = {
    'assignment (not strict)': 'Object.prototype.dirty = 1;',
    'defineProperty': 'Object.defineProperty(Object.prototype, "hidden", { value: 1, enumerable: false });',
    'Array.prototype': 'Array.prototype.add = function () {};',
    'a script that throws': 'throw new Error("corrupt");',
  };
  for (const [name, code] of Object.entries(dirty)) {
    fake['i18n/xx.js'] = read('i18n/tr.js').replace('"_lang": "tr"', '"_lang": "xx"') + '\n' + code;
    assert.ok(i18nScriptsProtoProblems(['i18n/en.js', 'i18n/xx.js', 'js/i18n.js'], readS).length > 0, name);
  }
  fake['i18n/xx.js'] = '/* empty dictionary */';
  assert.ok(i18nScriptsProtoProblems(['i18n/en.js', 'i18n/xx.js', 'js/i18n.js'], readS).length > 0, 'i18n/xx.js that registers no dictionary');
  // the old check (only running in a frozen context) did not catch silent pollution: observation
  const vm = require('node:vm');
  const ctx = vm.createContext({ console });
  ctx.self = ctx;
  vm.runInContext('Object.freeze(Object.prototype)', ctx);
  assert.doesNotThrow(() => vm.runInContext('Object.prototype.dirty = 1;', ctx), 'an assignment to a frozen prototype in sloppy mode gives no error (the gap of the old test)');
});

test('freezing Object.prototype: js/freeze.js right after the last vendor script, before the app scripts', () => {
  const scripts = [...INDEX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  const i = scripts.indexOf('js/freeze.js');
  assert.ok(i > 0, 'index.html does not load js/freeze.js');
  assert.deepEqual(scriptOrderProblems(scripts), []);
  const source = fs.readFileSync(path.join(REPO, 'app', 'js', 'freeze.js'), 'utf8');
  assert.match(source, /Object\.freeze\(Object\.prototype\)/);
  const vm = require('node:vm');
  const ctx = vm.createContext({});
  vm.runInContext(source, ctx);
  assert.equal(vm.runInContext('Object.isFrozen(Object.prototype)', ctx), true);
  assert.equal(vm.runInContext("'use strict'; try { Object.prototype.dirty = 1; 'written' } catch (e) { 'rejected' }", ctx), 'rejected');
});

// ---------------------------------------------------------------- window setup (navigation/new window in Rust)
test('the main window is set up with the system language pre-script (lib.rs initialization_script(i18n::init_script()))', () => {
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const isBound = (k) => /WebviewWindowBuilder::from_config\([\s\S]*?\.initialization_script\(i18n::init_script\(\)\)[\s\S]*?\.build\(\)\?/.test(k.replace(/\/\/.*$/gm, ''));
  assert.ok(isBound(lib));
  assert.equal(isBound(lib.replace('.initialization_script(i18n::init_script())', '')), false, 'caught when removed');
  assert.equal(isBound(lib.replace('.initialization_script(i18n::init_script())', '// .initialization_script(i18n::init_script())')), false, 'a comment line does not count');
});

test('window: "main" is created from the configuration in the Rust setup (with on_navigation/on_new_window)', () => {
  const w = CONF.app.windows;
  assert.equal(w.length, 1);
  assert.equal(w[0].label, 'main');
  assert.equal(w[0].create, false, 'a window created on its own from the configuration gets no navigation check');
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  assert.deepEqual(setupBindingProblems(lib), []);
});

/**
 * Does the lib.rs setup bind the navigation/new window decision to the functions the Rust tests test directly?
 * A decision embedded in a closure (`|_| true`, `true || …`) escapes the Rust tests (test §7); so only binding with a
 * named function is accepted. The correctness of the decision functions is in `cargo test`.
 */
function setupBindingProblems(lib) {
  const h = [];
  const code = lib.replace(/\/\/.*$/gm, '');
  const nav = code.match(/\.on_navigation\(([^)]*)\)/g) || [];
  if (nav.length !== 1 || nav[0] !== '.on_navigation(navigation_decision)') h.push('on_navigation must be bound only with navigation_decision: ' + JSON.stringify(nav));
  const fresh = code.match(/\.on_new_window\(.*\)\s*$/gm) || [];
  if (fresh.length !== 1 || !/^\.on_new_window\(\|url, _\| new_window_decision\(&url\)\)\s*$/.test(fresh[0].trim())) h.push('on_new_window must be bound only with new_window_decision: ' + JSON.stringify(fresh));
  if (!/pub fn navigation_decision\(url: &Url\) -> bool \{\s*let permission = navigation_allowed\(url\);/.test(code)) h.push('navigation_decision does not use the navigation_allowed result directly');
  const yp = code.match(/fn new_window_decision<R: Runtime>\(url: &Url\) -> NewWindowResponse<R> \{\n([\s\S]*?)\n\}/);
  if (!yp || !/NewWindowResponse::Deny\s*$/.test(yp[1]) || /Allow|Create|return/.test(yp[1])) h.push('new_window_decision does not return Deny');
  if (/WebviewWindowBuilder::new\(|webview_windows\(\)|\.add_child\(|WebviewBuilder::new\(/.test(code)) h.push('a second window/webview setup without the check');
  return h;
}

test('the setup binding checker rejects faulty lib.rs samples', () => {
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  assert.deepEqual(setupBindingProblems(lib), [], 'the real lib.rs must pass');
  const bad = {
    'empty': '',
    'a closure that allows everything': lib.replace('.on_navigation(navigation_decision)', '.on_navigation(|_| true)'),
    'true || inside the closure': lib.replace('.on_navigation(navigation_decision)', '.on_navigation(|u| true || navigation_allowed(u))'),
    'no on_navigation': lib.replace('.on_navigation(navigation_decision)', ''),
    'two on_navigation': lib.replace('.on_navigation(navigation_decision)', '.on_navigation(navigation_decision).on_navigation(|_| true)'),
    'true || in the decision function': lib.replace('let permission = navigation_allowed(url);', 'let permission = true || navigation_allowed(url);'),
    'new window allowed': lib.replace('.on_new_window(|url, _| new_window_decision(&url))', '.on_new_window(|_, _| NewWindowResponse::Allow)'),
    'no new window': lib.replace('.on_new_window(|url, _| new_window_decision(&url))', ''),
    'decision Allow': lib.replace(/(fn new_window_decision[\s\S]*?)NewWindowResponse::Deny/, '$1NewWindowResponse::Allow'),
    'decision early Allow': lib.replace(/(fn new_window_decision[^\n]*\n)/, '$1    if url.as_str().is_empty() { return NewWindowResponse::Allow; }\n'),
    'second window': lib + '\nfn x(app: &App) { WebviewWindowBuilder::new(app, "x", WebviewUrl::App("a".into())); }',
  };
  for (const [name, k] of Object.entries(bad)) {
    assert.notEqual(k, lib, `mutant could not be applied: ${name}`);
    assert.ok(setupBindingProblems(k).length > 0, `faulty sample passed: ${name}`);
  }
});

// ---------------------------------------------------------------- izinler
// the app's own commands (src-tauri/build.rs app manifest → allow-<command>). The command list must be exactly the same in
// build.rs, lib.rs generate_handler! and these permissions (the test below).
const APP_COMMANDS = ['open_file', 'read_file', 'save_file', 'recent_files', 'read_recent_file', 'pending_opens', 'backup_data', 'read_backup', 'read_language', 'set_language', 'print', 'open_in_preview']; // print, open_in_preview
const EXPECTED_PERMISSION = ['core:event:allow-listen', 'dialog:allow-message', ...APP_COMMANDS.map((k) => 'allow-' + k.replace(/_/g, '-'))];
function checkCapability(y) {
  const h = [];
  if (!y || typeof y !== 'object') return ['no capability file'];
  if (!Array.isArray(y.windows) || y.windows.length !== 1 || y.windows[0] !== 'main') h.push('windows must be only ["main"]');
  if (y.webviews !== undefined) h.push('no webviews field expected');
  if (y.remote !== undefined) h.push('no remote (IPC to a remote address) expected');
  if (y.platforms !== undefined && !(Array.isArray(y.platforms))) h.push('platforms invalid');
  const permission = Array.isArray(y.permissions) ? y.permissions.map((p) => (typeof p === 'string' ? p : p && p.identifier)) : [];
  if (!Array.isArray(y.permissions)) h.push('no permissions');
  for (const p of permission) if (!EXPECTED_PERMISSION.includes(p)) h.push(`extra permission: ${p}`);
  for (const p of EXPECTED_PERMISSION) if (!permission.includes(p)) h.push(`missing permission: ${p}`);
  if (new Set(permission).size !== permission.length) h.push('repeated permission');
  if (Array.isArray(y.permissions) && y.permissions.some((p) => typeof p !== 'string')) h.push('no scoped (object) permission expected');
  return h;
}

test('permissions: capabilities/default.json the smallest set (event listening + confirm dialog + app commands), no core:default', () => {
  assert.deepEqual(checkCapability(CAPABILITY), []);
  // Tauri loads ALL the files in the capabilities/ folder; an extra file or an inline capability in the conf could add permissions.
  assert.deepEqual(fs.readdirSync(path.join(REPO, 'src-tauri', 'capabilities')), ['default.json']);
  assert.equal(CONF.app.security.capabilities, undefined, 'an extra capability definition in tauri.conf.json');
});

/** The build.rs app manifest commands and the lib.rs generate_handler! list (only `module::command` names). */
function commandLists(build, lib) {
  const b = (build.match(/commands\(&\[([\s\S]*?)\]\)/) || [])[1];
  const l = (lib.match(/generate_handler!\[([\s\S]*?)\]/) || [])[1];
  return {
    build: b ? [...b.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : null,
    lib: l ? l.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split('::').pop()) : null,
  };
}

test('app commands: build.rs manifest = lib.rs generate_handler! = permissions (nothing missing/extra)', () => {
  const build = fs.readFileSync(path.join(REPO, 'src-tauri', 'build.rs'), 'utf8');
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const k = commandLists(build, lib);
  assert.deepEqual([...k.build].sort(), [...APP_COMMANDS].sort(), 'build.rs');
  assert.deepEqual([...k.lib].sort(), [...APP_COMMANDS].sort(), 'lib.rs generate_handler!');
  // without a manifest Tauri opens the app commands without permissions: build.rs must use app_manifest
  assert.match(build, /app_manifest\(/);
  // faulty samples: caught when the lists drift apart
  const extra = commandLists(build, lib.replace('backup::read_backup,', 'backup::read_backup,\n            files::hidden_command,'));
  assert.notDeepEqual([...extra.lib].sort(), [...APP_COMMANDS].sort());
  assert.equal(commandLists('', '').build, null);
});

test('the permission checker rejects faulty samples', () => {
  const good = { identifier: 'default', windows: ['main'], permissions: EXPECTED_PERMISSION.slice() };
  assert.deepEqual(checkCapability(good), []);
  const bad = {
    'null': null,
    'core:default added': { ...good, permissions: ['core:default', ...EXPECTED_PERMISSION] },
    'only core:default': { ...good, permissions: ['core:default', 'dialog:allow-message'] },
    'core:event:default': { ...good, permissions: ['core:event:default', 'dialog:allow-message'] },
    'dialog:default': { ...good, permissions: ['core:event:allow-listen', 'dialog:default'] },
    'emit izni': { ...good, permissions: [...EXPECTED_PERMISSION, 'core:event:allow-emit'] },
    'file system': { ...good, permissions: [...EXPECTED_PERMISSION, 'fs:default'] },
    'confirm permission missing': { ...good, permissions: ['core:event:allow-listen'] },
    'empty permission': { ...good, permissions: [] },
    'no permissions field': { identifier: 'default', windows: ['main'] },
    'wildcard window': { ...good, windows: ['*'] },
    'two windows': { ...good, windows: ['main', 'other'] },
    'far address': { ...good, remote: { urls: ['https://*.example.com'] } },
    'object permission': { ...good, permissions: ['core:event:allow-listen', { identifier: 'dialog:allow-message', allow: [{ path: '$HOME' }] }] },
    'repeated': { ...good, permissions: [...EXPECTED_PERMISSION, 'dialog:allow-message'] },
    'file read permission missing': { ...good, permissions: EXPECTED_PERMISSION.filter((p) => p !== 'allow-read-file') },
    'app wildcard permission': { ...good, permissions: [...EXPECTED_PERMISSION, 'allow-*'] },
    'unknown app command': { ...good, permissions: [...EXPECTED_PERMISSION, 'allow-read-path'] },
    'dialog open (JS path choice)': { ...good, permissions: [...EXPECTED_PERMISSION, 'dialog:allow-open'] },
    'mixed with deny': { ...good, permissions: [...EXPECTED_PERMISSION, 'deny-read-backup'] },
  };
  for (const [name, y] of Object.entries(bad)) assert.ok(checkCapability(y).length > 0, `faulty sample passed: ${name}`);
});

// ---------------------------------------------------------------- entitlements and file association
/** The <key>…</key><true/|false/> pairs of a flat plist dict (comments dropped). Another value type → a list of errors. */
function readEntitlement(xml) {
  const body = String(xml).replace(/<!--[\s\S]*?-->/g, '');
  const key = {};
  const error = [];
  const re = /<key>([^<]+)<\/key>\s*<([a-z]+)\s*\/?>/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[1] in key) error.push('repeated ' + m[1]);
    if (m[2] === 'true') key[m[1]] = true;
    else if (m[2] === 'false') key[m[1]] = false;
    else error.push(`${m[1]}: unexpected value <${m[2]}>`);
  }
  if (!/<plist[^>]*>\s*<dict>/.test(body)) error.push('no plist/dict');
  return { key, error };
}
const LOCAL_ENT = ['com.apple.security.app-sandbox', 'com.apple.security.files.user-selected.read-write', 'com.apple.security.files.bookmarks.app-scope', 'com.apple.security.print', 'com.apple.security.network.client'];

test('entitlements: local = sandbox + user selection + bookmarks (app-scope) + printing + network.client; the S12 build without bookmarks, the rest the same', () => {
  const read = (name) => readEntitlement(fs.readFileSync(path.join(REPO, 'src-tauri', name), 'utf8'));
  const local = read('Entitlements.local.plist');
  assert.deepEqual(local.error, []);
  assert.deepEqual(Object.keys(local.key).sort(), [...LOCAL_ENT].sort());
  assert.ok(Object.values(local.key).every((v) => v === true));
  const noBookmarks = read('Entitlements.local-no-bookmarks.plist');
  assert.deepEqual(noBookmarks.error, []);
  assert.deepEqual(Object.keys(noBookmarks.key).sort(), LOCAL_ENT.filter((k) => !/bookmarks/.test(k)).sort());
  const conf = (name) => JSON.parse(fs.readFileSync(path.join(REPO, 'src-tauri', name), 'utf8')).bundle.macOS.entitlements;
  assert.equal(conf('tauri.local.conf.json'), 'Entitlements.local.plist');
  assert.equal(conf('tauri.local-no-bookmarks.conf.json'), 'Entitlements.local-no-bookmarks.plist');
  // the checker catches faulty samples
  assert.ok(readEntitlement('').error.length > 0);
  assert.ok(readEntitlement('<plist><dict><key>a</key><string>x</string></dict></plist>').error.length > 0);
  assert.ok(readEntitlement('<plist><dict><key>a</key><true/><key>a</key><true/></dict></plist>').error.length > 0);
  assert.deepEqual(readEntitlement('<plist><dict><!-- <key>hidden</key><true/> --><key>a</key><false/></dict></plist>').key, { a: false });
});

test('file association: PDF and EPUB (the folder package type com.apple.ibooks.epub included) as Viewer', () => {
  const fa = CONF.bundle.fileAssociations;
  assert.ok(Array.isArray(fa) && fa.length === 2);
  const pdf = fa.find((f) => f.ext.includes('pdf'));
  const epub = fa.find((f) => f.ext.includes('epub'));
  assert.ok(pdf && pdf.contentTypes.includes('com.adobe.pdf') && pdf.role === 'Viewer');
  assert.ok(epub && epub.contentTypes.includes('com.apple.ibooks.epub') && epub.contentTypes.includes('org.idpf.epub-container') && epub.role === 'Viewer');
  assert.ok(fa.every((f) => !f.exportedType), 'another vendor\'s type is not exported (no exportedType)');
});
