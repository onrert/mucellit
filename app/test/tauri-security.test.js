'use strict';
// Tauri güvenlik ayarları: src-tauri/tauri.conf.json içindeki CSP ve
// src-tauri/capabilities/default.json izinleri. Denetleyiciler kusurlu örneklerle de sınanır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const CONF = JSON.parse(fs.readFileSync(path.join(REPO, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const CAPABILITY = JSON.parse(fs.readFileSync(path.join(REPO, 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
const INDEX = fs.readFileSync(path.join(REPO, 'app', 'index.html'), 'utf8');

// ---------------------------------------------------------------- CSP denetleyicisi
// Yalnız bu kaynaklara izin var; dış adres, joker, şema joker'i (https:), blob:, betikte 'unsafe-*' yok.
// style-src 'unsafe-inline': uygulama style özniteliği kullanıyor (projects.js ilerleme çubuğu) ve EPUB'dan
// DOMParser ile ayrıştırılan XHTML'deki her style özniteliği CSP ihlali raporu üretiyor (e2e: 2638 konsol
// hatası). Dış kaynak yine yasak (img-src/font-src/connect-src), yani satır içi stil veri dışarı taşıyamaz.
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

/** CSP'yi (Tauri'nin dize ya da {yönerge: kaynak} biçimi) yönerge → kaynak listesi haritasına çevirir. */
function parseCsp(csp) {
  const map = new Map();
  const errors = [];
  let parts;
  if (typeof csp === 'string') parts = csp.split(';').map((p) => p.trim()).filter(Boolean).map((p) => p.split(/\s+/));
  else if (csp && typeof csp === 'object' && !Array.isArray(csp)) {
    parts = Object.entries(csp).map(([y, k]) => [y, ...(Array.isArray(k) ? k : String(k).split(/\s+/)).filter(Boolean)]);
  } else return { map, errors: ['CSP yok (null/boş/geçersiz tür)'] };
  for (const [directive, ...source] of parts) {
    const y = directive.toLowerCase();
    if (map.has(y)) errors.push(`yinelenen yönerge: ${y}`);
    else map.set(y, source.map((k) => k.toLowerCase()));
  }
  if (!map.size) errors.push('CSP boş');
  return { map, errors };
}

/** Sorun listesi döner; boş liste = geçti. */
function checkCsp(csp) {
  const { map, errors } = parseCsp(csp);
  if (!map.size) return errors;
  for (const y of REQUIRED) if (!map.has(y)) errors.push(`zorunlu yönerge yok: ${y}`);
  for (const [y, sources] of map) {
    const permission = ALLOWED[y];
    if (!permission) { errors.push(`bilinmeyen/izinsiz yönerge: ${y}`); continue; }
    if (!sources.length) errors.push(`kaynaksız yönerge: ${y}`);
    for (const k of sources) if (!permission.includes(k)) errors.push(`${y}: izinsiz kaynak ${k}`);
  }
  const link = map.get('connect-src') || [];
  if (!link.includes('ipc:')) errors.push('connect-src: ipc: yok (Tauri IPC çalışmaz)');
  return errors;
}

test('CSP: tauri.conf.json csp sıkı; connect-src yalnız IPC, dış kaynak yok', () => {
  assert.deepEqual(checkCsp(CONF.app.security.csp), []);
  const { map } = parseCsp(CONF.app.security.csp);
  assert.deepEqual(map.get('connect-src').slice().sort(), IPC.slice().sort());
  assert.ok(!/https?:\/\/(?!ipc\.localhost(\s|;|$))/i.test(String(CONF.app.security.csp)), 'ipc.localhost dışında http(s) adresi');
  // Tauri, index.html'deki <style> öğelerine nonce ekler; nonce/hash varken tarayıcı 'unsafe-inline'ı yok sayar.
  assert.ok(!/<style[\s>]/i.test(INDEX), 'index.html içinde <style> öğesi var');
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(INDEX), 'index.html içinde satır içi <script> var');
});

test('CSP: geliştirme CSP\'si ayrı gevşetilmemiş; Tauri\'nin CSP değişikliği kapatılmamış', () => {
  const g = CONF.app.security;
  assert.ok(g.devCsp === undefined || g.devCsp === null || checkCsp(g.devCsp).length === 0, 'devCsp gevşek');
  assert.ok(!g.dangerousDisableAssetCspModification, 'dangerousDisableAssetCspModification açık');
  assert.ok(!g.dangerousRemoteDomainIpcAccess, 'uzak alan IPC erişimi var');
});

test('CSP denetleyicisi kusurlu örnekleri reddeder', () => {
  const good = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; form-action 'none'";
  assert.deepEqual(checkCsp(good), [], 'iyi örnek geçmeli');
  const bad = {
    'null': null,
    'boş dize': '',
    'yalnız noktalı virgül': ' ; ; ',
    'array': ["default-src 'none'"],
    'connect-src yok': good.replace('; connect-src ipc: http://ipc.localhost', ''),
    'connect-src dış adres': good.replace('http://ipc.localhost', 'http://ipc.localhost https://example.com'),
    'connect-src joker': good.replace('connect-src ipc:', 'connect-src *'),
    'connect-src şema joker': good.replace('connect-src ipc:', 'connect-src ipc: https:'),
    'connect-src benzer alan': good.replace('http://ipc.localhost', 'http://ipc.localhost.evil.com'),
    'connect-src self': good.replace('connect-src ipc:', "connect-src ipc: 'self'"),
    'connect-src data': good.replace('connect-src ipc:', 'connect-src ipc: data:'),
    'connect-src ws': good.replace('connect-src ipc:', 'connect-src ipc: ws://localhost:1430'),
    'connect-src ipc yok': good.replace('connect-src ipc: ', 'connect-src '),
    'büyük harf yönerge': good + '; CONNECT-SRC https://x.com',
    'büyük harf kaynak': good.replace('http://ipc.localhost', 'HTTPS://EXAMPLE.COM'),
    'yinelenen default-src': good + '; default-src *',
    'default-src self yerine joker': good.replace("default-src 'none'", 'default-src *'),
    'script-src unsafe-eval': good.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"),
    'script-src unsafe-inline': good.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    'script-src cdn': good.replace("script-src 'self'", "script-src 'self' https://cdn.jsdelivr.net"),
    'style-src dış adres': good.replace("style-src 'self'", "style-src 'self' https://fonts.googleapis.com"),
    'style-src unsafe-eval': good.replace("style-src 'self'", "style-src 'self' 'unsafe-eval'"),
    'img-src dış': good.replace("img-src 'self' data:", "img-src 'self' data: https://iz.example"),
    'img-src blob': good.replace("img-src 'self' data:", "img-src 'self' data: blob:"),
    'object-src yok': good.replace("; object-src 'none'", ''),
    'base-uri yok': good.replace("; base-uri 'none'", ''),
    'kaynaksız yönerge': good + '; img-src',
    'bilinmeyen yönerge': good + "; navigate-to 'self'",
    'nesne biçiminde dış adres': { 'default-src': "'none'", 'script-src': "'self'", 'connect-src': ['ipc:', 'https://example.com'], 'object-src': "'none'", 'base-uri': "'none'", 'form-action': "'none'" },
  };
  for (const [name, csp] of Object.entries(bad)) assert.ok(checkCsp(csp).length > 0, `kusurlu örnek geçti: ${name}`);
  // nesne biçiminin iyi hali geçer (denetleyici biçime takılıp her şeyi reddetmiyor)
  assert.deepEqual(checkCsp({ 'default-src': "'none'", 'script-src': "'self'", 'connect-src': ['ipc:', 'http://ipc.localhost'], 'object-src': "'none'", 'base-uri': "'none'", 'form-action': "'none'" }), []);
});

// ---------------------------------------------------------------- Object.prototype dondurma
// dil betikleri (sözlükler + js/i18n.js) vendor'dan ÖNCE yüklenir (ilk kare seçili dilde); freeze.js'ten önce
// çalışan vendor dışı tek grup budur ve Object.prototype'a yazmaz (aşağıda dondurulmuş bağlamda sınanır).
const isI18nScript = (b) => /^i18n\/[a-z]{2,3}\.js$/.test(b) || b === 'js/i18n.js';
/** index.html betik sırası kuralları (boş dizi = uygun). Kusurlu sıralarla ayrıca sınanır. */
function scriptOrderHatalari(scripts) {
  const h = [];
  const i = scripts.indexOf('js/freeze.js');
  if (i <= 0) return ['index.html js/freeze.js yüklemiyor'];
  const once = scripts.slice(0, i);
  const ilkVendor = once.findIndex((b) => b.startsWith('vendor/'));
  if (ilkVendor < 0) h.push('vendor betikleri eksik');
  else {
    if (!once.slice(0, ilkVendor).every(isI18nScript)) h.push('vendor öncesinde dil dışı betik var');
    if (!once.slice(ilkVendor).every((b) => b.startsWith('vendor/'))) h.push('freeze.js öncesinde vendor dışı betik var (dil betikleri vendor\'dan sonra)');
    if (once.slice(ilkVendor).length < 3) h.push('vendor betikleri eksik');
  }
  if (!scripts.includes('js/i18n.js') || !once.includes('js/i18n.js')) h.push('js/i18n.js vendor\'dan önce değil');
  if (scripts.slice(i + 1).some((b) => b.startsWith('vendor/'))) h.push('freeze.js sonrasında vendor betiği var');
  return h;
}

test('betik sırası: dil betikleri vendor\'dan önce; freeze.js son vendor betiğinden hemen sonra; denetleyici kusurlu sırayı yakalar', () => {
  const scripts = [...INDEX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scriptOrderHatalari(scripts), []);
  const v = ['vendor/a.js', 'vendor/b.js', 'vendor/c.js'], d = ['i18n/en.js', 'i18n/tr.js', 'js/i18n.js'], u = ['js/platform.js'];
  assert.deepEqual(scriptOrderHatalari([...d, ...v, 'js/freeze.js', ...u]), []);
  for (const [name, bad] of Object.entries({
    'eski sıra (dil vendor sonrası)': [...v, 'js/freeze.js', ...d, ...u],
    'dil vendor arasında': ['vendor/a.js', ...d, 'vendor/b.js', 'vendor/c.js', 'js/freeze.js', ...u],
    'uygulama betiği vendor öncesi': [...d, 'js/platform.js', ...v, 'js/freeze.js'],
    'dondur yok': [...d, ...v, ...u],
    'dondur sonrası vendor': [...d, ...v, 'js/freeze.js', 'vendor/d.js'],
    'vendor eksik': [...d, 'vendor/a.js', 'js/freeze.js', ...u],
  })) assert.ok(scriptOrderHatalari(bad).length > 0, name);
});

// ---------------------------------------------------------------- Öğren rehberinin betik sırası
/** app/js/learn/ altındaki bütün .js dosyaları (index.html'deki biçimde: js/learn/…). */
function learnFiles() {
  const root = path.join(REPO, 'app', 'js', 'learn'), l = [];
  (function walk(k) { for (const g of fs.readdirSync(k, { withFileTypes: true })) { const y = path.join(k, g.name); if (g.isDirectory()) walk(y); else if (g.name.endsWith('.js')) l.push(y); } })(root);
  return l.map((y) => 'js/' + path.relative(path.join(REPO, 'app', 'js'), y).split(path.sep).join('/')).sort();
}
/**
 * Öğren betiklerinin sırası (boş dizi = uygun): app/js/learn/'deki her dosya bir kez yüklenir (unutulan/fazla/yinelenen
 * yok); hepsi freeze.js, calc.js ve calculator.js'ten sonra, app.js'ten önce, kesintisiz tek grup; grup içinde
 * bağımlılık sırası: ogren-olcu → cf-motor → cf-sayfa → figures/ortak → diğer figürler → ogren-dersler → learn.js (son).
 */
function learnOrderHatalari(scripts, files) {
  const h = [], og = scripts.filter((b) => b.startsWith('js/learn/'));
  const place = (b) => scripts.indexOf(b);
  for (const d of files) if (!og.includes(d)) h.push('yüklenmeyen Öğren dosyası: ' + d);
  for (const b of og) if (!files.includes(b)) h.push('olmayan Öğren betiği: ' + b);
  if (new Set(og).size !== og.length) h.push('yinelenen Öğren betiği');
  if (!og.length) return h.concat(['Öğren betiği yok']);
  const first = place(og[0]), last = scripts.lastIndexOf(og[og.length - 1]);
  if (scripts.slice(first, last + 1).some((b) => !b.startsWith('js/learn/'))) h.push('Öğren betikleri kesintisiz tek grup değil');
  for (const on of ['js/freeze.js', 'js/calc.js', 'js/calculator.js']) if (!(place(on) >= 0 && place(on) < first)) h.push(`${on} Öğren betiklerinden önce değil`);
  if (!(place('js/app.js') > last)) h.push('js/app.js Öğren betiklerinden sonra değil');
  const order = ['js/learn/learn-measure.js', 'js/learn/cf-engine.js', 'js/learn/cf-page.js', 'js/learn/figures/common.js'];
  for (let i = 1; i < order.length; i++) if (!(og.indexOf(order[i - 1]) >= 0 && og.indexOf(order[i - 1]) < og.indexOf(order[i]))) h.push(`${order[i - 1]} → ${order[i]} sırası bozuk`);
  const figures = og.filter((b) => b.startsWith('js/learn/figures/') && b !== 'js/learn/figures/common.js');
  if (figures.some((b) => og.indexOf(b) < og.indexOf('js/learn/figures/common.js'))) h.push('figür figures/common.js\'ten önce');
  const lesson = og.indexOf('js/learn/learn-lessons.js');
  if (!(lesson > Math.max(...figures.map((b) => og.indexOf(b))))) h.push('learn-lessons.js figürlerden sonra değil');
  if (og[og.length - 1] !== 'js/learn/learn.js') h.push('learn.js Öğren grubunun sonunda değil');
  return h;
}

test('betik sırası: Öğren betikleri dondur/hesap/hesapla sonrası, app.js öncesi, bağımlılık sırasıyla; denetleyici kusurlu sırayı yakalar', () => {
  const scripts = [...INDEX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  const files = learnFiles();
  assert.equal(files.length, 14, files.join());
  assert.deepEqual(learnOrderHatalari(scripts, files), []);
  assert.deepEqual(scriptOrderHatalari(scripts), [], 'genel sıra (dil → vendor → dondur → uygulama) korunur');
  const og = scripts.filter((b) => b.startsWith('js/learn/')), other = scripts.filter((b) => !b.startsWith('js/learn/'));
  const add = (l, once, ...e) => { const i = l.indexOf(once); return [...l.slice(0, i), ...e, ...l.slice(i)]; };
  const move = (b, once) => add(scripts.filter((x) => x !== b), once, b);
  const bad = {
    'Öğren yok': other,
    'bir figür unutuldu': scripts.filter((b) => b !== 'js/learn/figures/book.js'),
    'yinelenen figür': add(scripts, 'js/learn/learn-lessons.js', 'js/learn/figures/book.js'),
    'non script': add(scripts, 'js/learn/learn.js', 'js/learn/none.js'),
    'freeze.js öncesi': add(other, 'js/freeze.js', ...og),
    'calculator.js öncesi': add(other, 'js/calculator.js', ...og),
    'app.js sonrası': [...other, ...og],
    'grup bölünmüş': move('js/calculator.js', 'js/learn/cf-page.js'),
    'cf-page motordan önce': move('js/learn/cf-page.js', 'js/learn/cf-engine.js'),
    'figür common.js öncesi': move('js/learn/figures/sewing.js', 'js/learn/figures/common.js'),
    'dersler figürlerden önce': move('js/learn/learn-lessons.js', 'js/learn/figures/common.js'),
    'learn.js son değil': move('js/learn/learn.js', 'js/learn/learn-lessons.js'),
    'ölçü motordan sonra': move('js/learn/learn-measure.js', 'js/learn/cf-page.js'),
  };
  for (const [name, l] of Object.entries(bad)) {
    assert.notDeepEqual(l, scripts, `varyant uygulanamadı: ${name}`);
    assert.ok(learnOrderHatalari(l, files).length > 0, `kusurlu sıra geçti: ${name}`);
  }
  assert.ok(learnOrderHatalari([], files).length > 0, 'boş liste');
});

test('dil betikleri Object.prototype dondurulmuş bağlamda da çalışır (prototipe yazmaz)', () => {
  const vm = require('node:vm');
  const ctx = vm.createContext({ console });
  ctx.self = ctx;
  vm.runInContext('Object.freeze(Object.prototype)', ctx);
  for (const b of ['i18n/en.js', 'i18n/tr.js', 'js/i18n.js']) vm.runInContext(fs.readFileSync(path.join(REPO, 'app', b), 'utf8'), ctx, { filename: b });
  assert.equal(vm.runInContext('JSON.stringify([Mucellit.i18n.languages().join(), Mucellit.i18n.tIn("tr", "tab.impose"), Object.isFrozen(Object.prototype)])', ctx), '["en,tr","Düzenle",true]');
});

/**
 * freeze.js'ten önce çalışan BÜTÜN dil betikleri (index.html'deki sırayla; dil/ klasöründeki her
 * sözlük yüklenmeli) Object.prototype'a (ve Array/Function/String prototiplerine) yazmaz. Sözlükler katı kipte değil:
 * dondurulmuş bağlamda kirletme sessizce düşer, o yüzden DONDURULMAMIŞ bağlamda önce/sonra karşılaştırılır; ayrıca
 * dondurulmuş bağlamda hatasız çalıştıkları ve bütün dilleri kaydettikleri sınanır. Sorun listesi döner (boş = uygun).
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
    problem.push('prototip değişti: ' + s2.filter((x) => !o.includes(x)).concat(o.filter((x) => !s2.includes(x)).map((x) => '-' + x)).join(', '));
  }
  const rotated = vm.createContext({ console });
  rotated.self = rotated;
  vm.runInContext('Object.freeze(Object.prototype)', rotated);
  for (const b of scripts) {
    try { vm.runInContext(read(b), rotated, { filename: b }); } catch (e) { problem.push(`${b} (dondurulmuş): ${e.message}`); }
  }
  const languages = scripts.filter((b) => /^i18n\/[a-z]{2,3}\.js$/.test(b)).map((b) => b.slice(5, -3)).sort().join();
  let registered = null;
  try { registered = vm.runInContext('Mucellit.i18n.languages().slice().sort().join()', rotated); } catch (e) { problem.push('dondurulmuş bağlamda Mucellit.i18n yok: ' + e.message); }
  if (registered !== null && registered !== languages) problem.push(`dondurulmuş bağlamda diller ${registered} (expected ${languages})`);
  return problem;
}

test('freeze.js öncesindeki bütün dil betikleri (index.html sırası, i18n/*.js tamamı) prototiplere yazmaz; denetleyici kirletmeyi yakalar', () => {
  const scripts = [...INDEX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  const i18n = scripts.slice(0, scripts.indexOf('js/freeze.js')).filter(isI18nScript);
  const folder = fs.readdirSync(path.join(REPO, 'app', 'i18n')).filter((a) => /^[a-z]{2,3}\.js$/.test(a)).map((a) => 'i18n/' + a);
  assert.deepEqual(folder.filter((k) => !i18n.includes(k)), [], 'dil/ klasöründe index.html\'in freeze.js öncesinde yüklemediği sözlük var');
  assert.ok(i18n.includes('js/i18n.js') && i18n.length >= 3, i18n.join());
  const read = (b) => fs.readFileSync(path.join(REPO, 'app', b), 'utf8');
  assert.deepEqual(i18nScriptsProtoProblems(i18n, read), []);
  // kusurlu girdi: katı olmayan kipte sessiz kirletme, defineProperty, Array.prototype, sözlük kaydetmeyen betik
  const fake = { 'i18n/xx.js': read('i18n/tr.js').replace('"_lang": "tr"', '"_lang": "xx"') };
  const readS = (b) => (b in fake ? fake[b] : read(b));
  const dirty = {
    'atama (katı değil)': 'Object.prototype.dirty = 1;',
    'defineProperty': 'Object.defineProperty(Object.prototype, "hidden", { value: 1, enumerable: false });',
    'Array.prototype': 'Array.prototype.add = function () {};',
    'hata atan betik': 'throw new Error("corrupt");',
  };
  for (const [name, code] of Object.entries(dirty)) {
    fake['i18n/xx.js'] = read('i18n/tr.js').replace('"_lang": "tr"', '"_lang": "xx"') + '\n' + code;
    assert.ok(i18nScriptsProtoProblems(['i18n/en.js', 'i18n/xx.js', 'js/i18n.js'], readS).length > 0, name);
  }
  fake['i18n/xx.js'] = '/* boş sözlük */';
  assert.ok(i18nScriptsProtoProblems(['i18n/en.js', 'i18n/xx.js', 'js/i18n.js'], readS).length > 0, 'sözlük kaydetmeyen i18n/xx.js');
  // eski denetim (yalnız dondurulmuş bağlamda çalıştırma) sessiz kirletmeyi yakalamıyordu: gözlem
  const vm = require('node:vm');
  const ctx = vm.createContext({ console });
  ctx.self = ctx;
  vm.runInContext('Object.freeze(Object.prototype)', ctx);
  assert.doesNotThrow(() => vm.runInContext('Object.prototype.dirty = 1;', ctx), 'katı olmayan kipte dondurulmuş prototipe atama hata vermez (eski testin açığı)');
});

test('Object.prototype dondurma: js/freeze.js son vendor betiğinden hemen sonra, uygulama betiklerinden önce', () => {
  const scripts = [...INDEX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  const i = scripts.indexOf('js/freeze.js');
  assert.ok(i > 0, 'index.html js/freeze.js yüklemiyor');
  assert.deepEqual(scriptOrderHatalari(scripts), []);
  const source = fs.readFileSync(path.join(REPO, 'app', 'js', 'freeze.js'), 'utf8');
  assert.match(source, /Object\.freeze\(Object\.prototype\)/);
  const vm = require('node:vm');
  const ctx = vm.createContext({});
  vm.runInContext(source, ctx);
  assert.equal(vm.runInContext('Object.isFrozen(Object.prototype)', ctx), true);
  assert.equal(vm.runInContext("'use strict'; try { Object.prototype.dirty = 1; 'yazildi' } catch (e) { 'rejected' }", ctx), 'rejected');
});

// ---------------------------------------------------------------- pencere ayarı (gezinme/yeni pencere Rust'ta)
test('ana pencere sistem dili ön betiğiyle kurulur (lib.rs initialization_script(i18n::init_script()))', () => {
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const bagli = (k) => /WebviewWindowBuilder::from_config\([\s\S]*?\.initialization_script\(i18n::init_script\(\)\)[\s\S]*?\.build\(\)\?/.test(k.replace(/\/\/.*$/gm, ''));
  assert.ok(bagli(lib));
  assert.equal(bagli(lib.replace('.initialization_script(i18n::init_script())', '')), false, 'kaldırılınca yakalanır');
  assert.equal(bagli(lib.replace('.initialization_script(i18n::init_script())', '// .initialization_script(i18n::init_script())')), false, 'yorum satırı sayılmaz');
});

test('pencere: "main" yapılandırmadan Rust kurulumunda (on_navigation/on_new_window ile) oluşturulur', () => {
  const w = CONF.app.windows;
  assert.equal(w.length, 1);
  assert.equal(w[0].label, 'main');
  assert.equal(w[0].create, false, 'pencere yapılandırmadan kendiliğinden oluşturulursa gezinme denetimi bağlanmaz');
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  assert.deepEqual(setupBindingHatalari(lib), []);
});

/**
 * lib.rs kurulumu gezinme/yeni pencere kararını Rust testlerinin doğrudan sınadığı işlevlere bağlıyor mu?
 * Kapanış içine gömülü karar (`|_| true`, `true || …`) Rust testlerinden kaçar (sınaması §7); bu yüzden
 * bağlama yalnız adlı işlevle kabul edilir. Karar işlevlerinin doğruluğu `cargo test`te.
 */
function setupBindingHatalari(lib) {
  const h = [];
  const code = lib.replace(/\/\/.*$/gm, '');
  const nav = code.match(/\.on_navigation\(([^)]*)\)/g) || [];
  if (nav.length !== 1 || nav[0] !== '.on_navigation(navigation_decision)') h.push('on_navigation yalnız navigation_decision ile bağlanmalı: ' + JSON.stringify(nav));
  const fresh = code.match(/\.on_new_window\(.*\)\s*$/gm) || [];
  if (fresh.length !== 1 || !/^\.on_new_window\(\|url, _\| new_window_decision\(&url\)\)\s*$/.test(fresh[0].trim())) h.push('on_new_window yalnız new_window_decision ile bağlanmalı: ' + JSON.stringify(fresh));
  if (!/pub fn navigation_decision\(url: &Url\) -> bool \{\s*let permission = navigation_allowed\(url\);/.test(code)) h.push('navigation_decision navigation_allowed sonucunu doğrudan kullanmıyor');
  const yp = code.match(/fn new_window_decision<R: Runtime>\(url: &Url\) -> NewWindowResponse<R> \{\n([\s\S]*?)\n\}/);
  if (!yp || !/NewWindowResponse::Deny\s*$/.test(yp[1]) || /Allow|Create|return/.test(yp[1])) h.push('new_window_decision Deny dönmüyor');
  if (/WebviewWindowBuilder::new\(|webview_windows\(\)|\.add_child\(|WebviewBuilder::new\(/.test(code)) h.push('denetimsiz ikinci pencere/webview kurulumu');
  return h;
}

test('kurulum bağlama denetleyicisi kusurlu lib.rs örneklerini reddeder', () => {
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  assert.deepEqual(setupBindingHatalari(lib), [], 'gerçek lib.rs geçmeli');
  const bad = {
    'boş': '',
    'kapanış her şeye izin': lib.replace('.on_navigation(navigation_decision)', '.on_navigation(|_| true)'),
    'kapanış içinde true ||': lib.replace('.on_navigation(navigation_decision)', '.on_navigation(|u| true || navigation_allowed(u))'),
    'on_navigation yok': lib.replace('.on_navigation(navigation_decision)', ''),
    'iki on_navigation': lib.replace('.on_navigation(navigation_decision)', '.on_navigation(navigation_decision).on_navigation(|_| true)'),
    'karar işlevinde true ||': lib.replace('let permission = navigation_allowed(url);', 'let permission = true || navigation_allowed(url);'),
    'yeni pencere izinli': lib.replace('.on_new_window(|url, _| new_window_decision(&url))', '.on_new_window(|_, _| NewWindowResponse::Allow)'),
    'yeni pencere yok': lib.replace('.on_new_window(|url, _| new_window_decision(&url))', ''),
    'karar Allow': lib.replace(/(fn new_window_decision[\s\S]*?)NewWindowResponse::Deny/, '$1NewWindowResponse::Allow'),
    'karar erken Allow': lib.replace(/(fn new_window_decision[^\n]*\n)/, '$1    if url.as_str().is_empty() { return NewWindowResponse::Allow; }\n'),
    'second window': lib + '\nfn x(app: &App) { WebviewWindowBuilder::new(app, "x", WebviewUrl::App("a".into())); }',
  };
  for (const [name, k] of Object.entries(bad)) {
    assert.notEqual(k, lib, `mutant uygulanamadı: ${name}`);
    assert.ok(setupBindingHatalari(k).length > 0, `kusurlu örnek geçti: ${name}`);
  }
});

// ---------------------------------------------------------------- izinler
// uygulamanın kendi komutları (src-tauri/build.rs app manifest → allow-<komut>). Komut listesi build.rs,
// lib.rs generate_handler! ve bu izinler arasında birebir aynı olmalı (aşağıdaki test).
const APP_COMMANDS = ['open_file', 'read_file', 'save_file', 'recent_files', 'read_recent_file', 'pending_opens', 'backup_data', 'read_backup', 'read_language', 'set_language', 'print', 'open_in_preview']; // yazdir, onizlemede_ac
const EXPECTED_PERMISSION = ['core:event:allow-listen', 'dialog:allow-message', ...APP_COMMANDS.map((k) => 'allow-' + k.replace(/_/g, '-'))];
function checkCapability(y) {
  const h = [];
  if (!y || typeof y !== 'object') return ['yetki dosyası yok'];
  if (!Array.isArray(y.windows) || y.windows.length !== 1 || y.windows[0] !== 'main') h.push('windows yalnız ["main"] olmalı');
  if (y.webviews !== undefined) h.push('webviews alanı beklenmiyor');
  if (y.remote !== undefined) h.push('remote (uzak adrese IPC) beklenmiyor');
  if (y.platforms !== undefined && !(Array.isArray(y.platforms))) h.push('platforms geçersiz');
  const permission = Array.isArray(y.permissions) ? y.permissions.map((p) => (typeof p === 'string' ? p : p && p.identifier)) : [];
  if (!Array.isArray(y.permissions)) h.push('permissions yok');
  for (const p of permission) if (!EXPECTED_PERMISSION.includes(p)) h.push(`fazla izin: ${p}`);
  for (const p of EXPECTED_PERMISSION) if (!permission.includes(p)) h.push(`eksik izin: ${p}`);
  if (new Set(permission).size !== permission.length) h.push('repeated permission');
  if (Array.isArray(y.permissions) && y.permissions.some((p) => typeof p !== 'string')) h.push('kapsamlı (nesne) izin beklenmiyor');
  return h;
}

test('izinler: capabilities/default.json en küçük set (event dinleme + onay penceresi + uygulama komutları), core:default yok', () => {
  assert.deepEqual(checkCapability(CAPABILITY), []);
  // Tauri capabilities/ klasöründeki BÜTÜN dosyaları yükler; ek dosya ya da conf'ta satır içi yetki izin ekleyebilir.
  assert.deepEqual(fs.readdirSync(path.join(REPO, 'src-tauri', 'capabilities')), ['default.json']);
  assert.equal(CONF.app.security.capabilities, undefined, 'tauri.conf.json içinde ek yetki tanımı');
});

/** build.rs app manifest komutları ve lib.rs generate_handler! listesi (yalnız `modul::komut` adları). */
function commandLists(build, lib) {
  const b = (build.match(/commands\(&\[([\s\S]*?)\]\)/) || [])[1];
  const l = (lib.match(/generate_handler!\[([\s\S]*?)\]/) || [])[1];
  return {
    build: b ? [...b.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : null,
    lib: l ? l.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split('::').pop()) : null,
  };
}

test('app komutları: build.rs manifesti = lib.rs generate_handler! = izinler (missing/extra none)', () => {
  const build = fs.readFileSync(path.join(REPO, 'src-tauri', 'build.rs'), 'utf8');
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const k = commandLists(build, lib);
  assert.deepEqual([...k.build].sort(), [...APP_COMMANDS].sort(), 'build.rs');
  assert.deepEqual([...k.lib].sort(), [...APP_COMMANDS].sort(), 'lib.rs generate_handler!');
  // manifest yoksa Tauri uygulama komutlarını izinsiz açar: build.rs app_manifest kullanmalı
  assert.match(build, /app_manifest\(/);
  // kusurlu örnekler: listeler ayrışırsa yakalanır
  const extra = commandLists(build, lib.replace('backup::read_backup,', 'backup::read_backup,\n            files::hidden_command,'));
  assert.notDeepEqual([...extra.lib].sort(), [...APP_COMMANDS].sort());
  assert.equal(commandLists('', '').build, null);
});

test('izin denetleyicisi kusurlu örnekleri reddeder', () => {
  const good = { identifier: 'default', windows: ['main'], permissions: EXPECTED_PERMISSION.slice() };
  assert.deepEqual(checkCapability(good), []);
  const bad = {
    'null': null,
    'core:default eklenmiş': { ...good, permissions: ['core:default', ...EXPECTED_PERMISSION] },
    'yalnız core:default': { ...good, permissions: ['core:default', 'dialog:allow-message'] },
    'core:event:default': { ...good, permissions: ['core:event:default', 'dialog:allow-message'] },
    'dialog:default': { ...good, permissions: ['core:event:allow-listen', 'dialog:default'] },
    'emit izni': { ...good, permissions: [...EXPECTED_PERMISSION, 'core:event:allow-emit'] },
    'dosya sistemi': { ...good, permissions: [...EXPECTED_PERMISSION, 'fs:default'] },
    'onay izni eksik': { ...good, permissions: ['core:event:allow-listen'] },
    'boş izin': { ...good, permissions: [] },
    'izin alanı yok': { identifier: 'default', windows: ['main'] },
    'joker pencere': { ...good, windows: ['*'] },
    'iki pencere': { ...good, windows: ['main', 'other'] },
    'far address': { ...good, remote: { urls: ['https://*.example.com'] } },
    'object permission': { ...good, permissions: ['core:event:allow-listen', { identifier: 'dialog:allow-message', allow: [{ path: '$HOME' }] }] },
    'repeated': { ...good, permissions: [...EXPECTED_PERMISSION, 'dialog:allow-message'] },
    'dosya okuma izni eksik': { ...good, permissions: EXPECTED_PERMISSION.filter((p) => p !== 'allow-read-file') },
    'uygulama joker izni': { ...good, permissions: [...EXPECTED_PERMISSION, 'allow-*'] },
    'bilinmeyen uygulama komutu': { ...good, permissions: [...EXPECTED_PERMISSION, 'allow-read-path'] },
    'dialog open (JS yol seçimi)': { ...good, permissions: [...EXPECTED_PERMISSION, 'dialog:allow-open'] },
    'deny ile karışık': { ...good, permissions: [...EXPECTED_PERMISSION, 'deny-read-backup'] },
  };
  for (const [name, y] of Object.entries(bad)) assert.ok(checkCapability(y).length > 0, `kusurlu örnek geçti: ${name}`);
});

// ---------------------------------------------------------------- entitlements ve dosya ilişkilendirme
/** Düz plist sözlüğündeki <key>…</key><true/|false/> çiftleri (yorumlar atılır). Başka değer türü → hata listesi. */
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
    else error.push(`${m[1]}: beklenmeyen değer <${m[2]}>`);
  }
  if (!/<plist[^>]*>\s*<dict>/.test(body)) error.push('plist/dict yok');
  return { key, error };
}
const LOCAL_ENT = ['com.apple.security.app-sandbox', 'com.apple.security.files.user-selected.read-write', 'com.apple.security.files.bookmarks.app-scope', 'com.apple.security.print', 'com.apple.security.network.client'];

test('entitlements: local = sandbox + kullanıcı seçimi + place mark (app-scope) + yazdırma + network.client; S12 derlemesi place noBookmark, gerisi aynı', () => {
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
  // denetleyici kusurlu örnekleri yakalar
  assert.ok(readEntitlement('').error.length > 0);
  assert.ok(readEntitlement('<plist><dict><key>a</key><string>x</string></dict></plist>').error.length > 0);
  assert.ok(readEntitlement('<plist><dict><key>a</key><true/><key>a</key><true/></dict></plist>').error.length > 0);
  assert.deepEqual(readEntitlement('<plist><dict><!-- <key>gizli</key><true/> --><key>a</key><false/></dict></plist>').key, { a: false });
});

test('dosya ilişkilendirme: PDF ve EPUB (klasör paketi türü com.apple.ibooks.epub dahil) Görüntüleyici olarak', () => {
  const fa = CONF.bundle.fileAssociations;
  assert.ok(Array.isArray(fa) && fa.length === 2);
  const pdf = fa.find((f) => f.ext.includes('pdf'));
  const epub = fa.find((f) => f.ext.includes('epub'));
  assert.ok(pdf && pdf.contentTypes.includes('com.adobe.pdf') && pdf.role === 'Viewer');
  assert.ok(epub && epub.contentTypes.includes('com.apple.ibooks.epub') && epub.contentTypes.includes('org.idpf.epub-container') && epub.role === 'Viewer');
  assert.ok(fa.every((f) => !f.exportedType), 'başkasının türü dışa aktarılmaz (exportedType yok)');
});
