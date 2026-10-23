'use strict';
// Tauri güvenlik ayarları: src-tauri/tauri.conf.json içindeki CSP ve
// src-tauri/capabilities/default.json izinleri. Denetleyiciler kusurlu örneklerle de sınanır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const KONF = JSON.parse(fs.readFileSync(path.join(REPO, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const YETKI = JSON.parse(fs.readFileSync(path.join(REPO, 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
const INDEX = fs.readFileSync(path.join(REPO, 'app', 'index.html'), 'utf8');

// ---------------------------------------------------------------- CSP denetleyicisi
// Yalnız bu kaynaklara izin var; dış adres, joker, şema joker'i (https:), blob:, betikte 'unsafe-*' yok.
// style-src 'unsafe-inline': uygulama style özniteliği kullanıyor (projects.js ilerleme çubuğu) ve EPUB'dan
// DOMParser ile ayrıştırılan XHTML'deki her style özniteliği CSP ihlali raporu üretiyor (e2e: 2638 konsol
// hatası). Dış kaynak yine yasak (img-src/font-src/connect-src), yani satır içi stil veri dışarı taşıyamaz.
const IPC = ['ipc:', 'http://ipc.localhost'];
const IZINLI = {
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
const ZORUNLU = ['default-src', 'script-src', 'connect-src', 'object-src', 'base-uri', 'form-action'];

/** CSP'yi (Tauri'nin dize ya da {yönerge: kaynak} biçimi) yönerge → kaynak listesi haritasına çevirir. */
function cspAyristir(csp) {
  const harita = new Map();
  const hatalar = [];
  let parcalar;
  if (typeof csp === 'string') parcalar = csp.split(';').map((p) => p.trim()).filter(Boolean).map((p) => p.split(/\s+/));
  else if (csp && typeof csp === 'object' && !Array.isArray(csp)) {
    parcalar = Object.entries(csp).map(([y, k]) => [y, ...(Array.isArray(k) ? k : String(k).split(/\s+/)).filter(Boolean)]);
  } else return { harita, hatalar: ['CSP yok (null/boş/geçersiz tür)'] };
  for (const [yonerge, ...kaynak] of parcalar) {
    const y = yonerge.toLowerCase();
    if (harita.has(y)) hatalar.push(`yinelenen yönerge: ${y}`);
    else harita.set(y, kaynak.map((k) => k.toLowerCase()));
  }
  if (!harita.size) hatalar.push('CSP boş');
  return { harita, hatalar };
}

/** Sorun listesi döner; boş liste = geçti. */
function cspDenetle(csp) {
  const { harita, hatalar } = cspAyristir(csp);
  if (!harita.size) return hatalar;
  for (const y of ZORUNLU) if (!harita.has(y)) hatalar.push(`zorunlu yönerge yok: ${y}`);
  for (const [y, kaynaklar] of harita) {
    const izin = IZINLI[y];
    if (!izin) { hatalar.push(`bilinmeyen/izinsiz yönerge: ${y}`); continue; }
    if (!kaynaklar.length) hatalar.push(`kaynaksız yönerge: ${y}`);
    for (const k of kaynaklar) if (!izin.includes(k)) hatalar.push(`${y}: izinsiz kaynak ${k}`);
  }
  const baglanti = harita.get('connect-src') || [];
  if (!baglanti.includes('ipc:')) hatalar.push('connect-src: ipc: yok (Tauri IPC çalışmaz)');
  return hatalar;
}

test('CSP: tauri.conf.json csp sıkı; connect-src yalnız IPC, dış kaynak yok', () => {
  assert.deepEqual(cspDenetle(KONF.app.security.csp), []);
  const { harita } = cspAyristir(KONF.app.security.csp);
  assert.deepEqual(harita.get('connect-src').slice().sort(), IPC.slice().sort());
  assert.ok(!/https?:\/\/(?!ipc\.localhost(\s|;|$))/i.test(String(KONF.app.security.csp)), 'ipc.localhost dışında http(s) adresi');
  // Tauri, index.html'deki <style> öğelerine nonce ekler; nonce/hash varken tarayıcı 'unsafe-inline'ı yok sayar.
  assert.ok(!/<style[\s>]/i.test(INDEX), 'index.html içinde <style> öğesi var');
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(INDEX), 'index.html içinde satır içi <script> var');
});

test('CSP: geliştirme CSP\'si ayrı gevşetilmemiş; Tauri\'nin CSP değişikliği kapatılmamış', () => {
  const g = KONF.app.security;
  assert.ok(g.devCsp === undefined || g.devCsp === null || cspDenetle(g.devCsp).length === 0, 'devCsp gevşek');
  assert.ok(!g.dangerousDisableAssetCspModification, 'dangerousDisableAssetCspModification açık');
  assert.ok(!g.dangerousRemoteDomainIpcAccess, 'uzak alan IPC erişimi var');
});

test('CSP denetleyicisi kusurlu örnekleri reddeder', () => {
  const iyi = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; form-action 'none'";
  assert.deepEqual(cspDenetle(iyi), [], 'iyi örnek geçmeli');
  const kotu = {
    'null': null,
    'boş dize': '',
    'yalnız noktalı virgül': ' ; ; ',
    'dizi': ["default-src 'none'"],
    'connect-src yok': iyi.replace('; connect-src ipc: http://ipc.localhost', ''),
    'connect-src dış adres': iyi.replace('http://ipc.localhost', 'http://ipc.localhost https://example.com'),
    'connect-src joker': iyi.replace('connect-src ipc:', 'connect-src *'),
    'connect-src şema joker': iyi.replace('connect-src ipc:', 'connect-src ipc: https:'),
    'connect-src benzer alan': iyi.replace('http://ipc.localhost', 'http://ipc.localhost.evil.com'),
    'connect-src self': iyi.replace('connect-src ipc:', "connect-src ipc: 'self'"),
    'connect-src data': iyi.replace('connect-src ipc:', 'connect-src ipc: data:'),
    'connect-src ws': iyi.replace('connect-src ipc:', 'connect-src ipc: ws://localhost:1430'),
    'connect-src ipc yok': iyi.replace('connect-src ipc: ', 'connect-src '),
    'büyük harf yönerge': iyi + '; CONNECT-SRC https://x.com',
    'büyük harf kaynak': iyi.replace('http://ipc.localhost', 'HTTPS://EXAMPLE.COM'),
    'yinelenen default-src': iyi + '; default-src *',
    'default-src self yerine joker': iyi.replace("default-src 'none'", 'default-src *'),
    'script-src unsafe-eval': iyi.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"),
    'script-src unsafe-inline': iyi.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    'script-src cdn': iyi.replace("script-src 'self'", "script-src 'self' https://cdn.jsdelivr.net"),
    'style-src dış adres': iyi.replace("style-src 'self'", "style-src 'self' https://fonts.googleapis.com"),
    'style-src unsafe-eval': iyi.replace("style-src 'self'", "style-src 'self' 'unsafe-eval'"),
    'img-src dış': iyi.replace("img-src 'self' data:", "img-src 'self' data: https://iz.example"),
    'img-src blob': iyi.replace("img-src 'self' data:", "img-src 'self' data: blob:"),
    'object-src yok': iyi.replace("; object-src 'none'", ''),
    'base-uri yok': iyi.replace("; base-uri 'none'", ''),
    'kaynaksız yönerge': iyi + '; img-src',
    'bilinmeyen yönerge': iyi + "; navigate-to 'self'",
    'nesne biçiminde dış adres': { 'default-src': "'none'", 'script-src': "'self'", 'connect-src': ['ipc:', 'https://example.com'], 'object-src': "'none'", 'base-uri': "'none'", 'form-action': "'none'" },
  };
  for (const [ad, csp] of Object.entries(kotu)) assert.ok(cspDenetle(csp).length > 0, `kusurlu örnek geçti: ${ad}`);
  // nesne biçiminin iyi hali geçer (denetleyici biçime takılıp her şeyi reddetmiyor)
  assert.deepEqual(cspDenetle({ 'default-src': "'none'", 'script-src': "'self'", 'connect-src': ['ipc:', 'http://ipc.localhost'], 'object-src': "'none'", 'base-uri': "'none'", 'form-action': "'none'" }), []);
});

// ---------------------------------------------------------------- Object.prototype dondurma
// dil betikleri (sözlükler + js/i18n.js) vendor'dan ÖNCE yüklenir (ilk kare seçili dilde); freeze.js'ten önce
// çalışan vendor dışı tek grup budur ve Object.prototype'a yazmaz (aşağıda dondurulmuş bağlamda sınanır).
const dilBetigiMi = (b) => /^i18n\/[a-z]{2,3}\.js$/.test(b) || b === 'js/i18n.js';
/** index.html betik sırası kuralları (boş dizi = uygun). Kusurlu sıralarla ayrıca sınanır. */
function betikSirasiHatalari(betikler) {
  const h = [];
  const i = betikler.indexOf('js/freeze.js');
  if (i <= 0) return ['index.html js/freeze.js yüklemiyor'];
  const once = betikler.slice(0, i);
  const ilkVendor = once.findIndex((b) => b.startsWith('vendor/'));
  if (ilkVendor < 0) h.push('vendor betikleri eksik');
  else {
    if (!once.slice(0, ilkVendor).every(dilBetigiMi)) h.push('vendor öncesinde dil dışı betik var');
    if (!once.slice(ilkVendor).every((b) => b.startsWith('vendor/'))) h.push('freeze.js öncesinde vendor dışı betik var (dil betikleri vendor\'dan sonra)');
    if (once.slice(ilkVendor).length < 3) h.push('vendor betikleri eksik');
  }
  if (!betikler.includes('js/i18n.js') || !once.includes('js/i18n.js')) h.push('js/i18n.js vendor\'dan önce değil');
  if (betikler.slice(i + 1).some((b) => b.startsWith('vendor/'))) h.push('freeze.js sonrasında vendor betiği var');
  return h;
}

test('betik sırası: dil betikleri vendor\'dan önce; freeze.js son vendor betiğinden hemen sonra; denetleyici kusurlu sırayı yakalar', () => {
  const betikler = [...INDEX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(betikSirasiHatalari(betikler), []);
  const v = ['vendor/a.js', 'vendor/b.js', 'vendor/c.js'], d = ['i18n/en.js', 'i18n/tr.js', 'js/i18n.js'], u = ['js/platform.js'];
  assert.deepEqual(betikSirasiHatalari([...d, ...v, 'js/freeze.js', ...u]), []);
  for (const [ad, kotu] of Object.entries({
    'eski sıra (dil vendor sonrası)': [...v, 'js/freeze.js', ...d, ...u],
    'dil vendor arasında': ['vendor/a.js', ...d, 'vendor/b.js', 'vendor/c.js', 'js/freeze.js', ...u],
    'uygulama betiği vendor öncesi': [...d, 'js/platform.js', ...v, 'js/freeze.js'],
    'dondur yok': [...d, ...v, ...u],
    'dondur sonrası vendor': [...d, ...v, 'js/freeze.js', 'vendor/d.js'],
    'vendor eksik': [...d, 'vendor/a.js', 'js/freeze.js', ...u],
  })) assert.ok(betikSirasiHatalari(kotu).length > 0, ad);
});

// ---------------------------------------------------------------- Öğren rehberinin betik sırası
/** app/js/learn/ altındaki bütün .js dosyaları (index.html'deki biçimde: js/learn/…). */
function ogrenDosyalari() {
  const kok = path.join(REPO, 'app', 'js', 'learn'), l = [];
  (function gez(k) { for (const g of fs.readdirSync(k, { withFileTypes: true })) { const y = path.join(k, g.name); if (g.isDirectory()) gez(y); else if (g.name.endsWith('.js')) l.push(y); } })(kok);
  return l.map((y) => 'js/' + path.relative(path.join(REPO, 'app', 'js'), y).split(path.sep).join('/')).sort();
}
/**
 * Öğren betiklerinin sırası (boş dizi = uygun): app/js/learn/'deki her dosya bir kez yüklenir (unutulan/fazla/yinelenen
 * yok); hepsi freeze.js, calc.js ve calculator.js'ten sonra, app.js'ten önce, kesintisiz tek grup; grup içinde
 * bağımlılık sırası: ogren-olcu → cf-motor → cf-sayfa → figures/ortak → diğer figürler → ogren-dersler → learn.js (son).
 */
function ogrenSirasiHatalari(betikler, dosyalar) {
  const h = [], og = betikler.filter((b) => b.startsWith('js/learn/'));
  const yer = (b) => betikler.indexOf(b);
  for (const d of dosyalar) if (!og.includes(d)) h.push('yüklenmeyen Öğren dosyası: ' + d);
  for (const b of og) if (!dosyalar.includes(b)) h.push('olmayan Öğren betiği: ' + b);
  if (new Set(og).size !== og.length) h.push('yinelenen Öğren betiği');
  if (!og.length) return h.concat(['Öğren betiği yok']);
  const ilk = yer(og[0]), son = betikler.lastIndexOf(og[og.length - 1]);
  if (betikler.slice(ilk, son + 1).some((b) => !b.startsWith('js/learn/'))) h.push('Öğren betikleri kesintisiz tek grup değil');
  for (const on of ['js/freeze.js', 'js/calc.js', 'js/calculator.js']) if (!(yer(on) >= 0 && yer(on) < ilk)) h.push(`${on} Öğren betiklerinden önce değil`);
  if (!(yer('js/app.js') > son)) h.push('js/app.js Öğren betiklerinden sonra değil');
  const sira = ['js/learn/learn-measure.js', 'js/learn/cf-engine.js', 'js/learn/cf-page.js', 'js/learn/figures/common.js'];
  for (let i = 1; i < sira.length; i++) if (!(og.indexOf(sira[i - 1]) >= 0 && og.indexOf(sira[i - 1]) < og.indexOf(sira[i]))) h.push(`${sira[i - 1]} → ${sira[i]} sırası bozuk`);
  const figurler = og.filter((b) => b.startsWith('js/learn/figures/') && b !== 'js/learn/figures/common.js');
  if (figurler.some((b) => og.indexOf(b) < og.indexOf('js/learn/figures/common.js'))) h.push('figür figures/common.js\'ten önce');
  const ders = og.indexOf('js/learn/learn-lessons.js');
  if (!(ders > Math.max(...figurler.map((b) => og.indexOf(b))))) h.push('learn-lessons.js figürlerden sonra değil');
  if (og[og.length - 1] !== 'js/learn/learn.js') h.push('learn.js Öğren grubunun sonunda değil');
  return h;
}

test('betik sırası: Öğren betikleri dondur/hesap/hesapla sonrası, app.js öncesi, bağımlılık sırasıyla; denetleyici kusurlu sırayı yakalar', () => {
  const betikler = [...INDEX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  const dosyalar = ogrenDosyalari();
  assert.equal(dosyalar.length, 14, dosyalar.join());
  assert.deepEqual(ogrenSirasiHatalari(betikler, dosyalar), []);
  assert.deepEqual(betikSirasiHatalari(betikler), [], 'genel sıra (dil → vendor → dondur → uygulama) korunur');
  const og = betikler.filter((b) => b.startsWith('js/learn/')), digeri = betikler.filter((b) => !b.startsWith('js/learn/'));
  const ekle = (l, once, ...e) => { const i = l.indexOf(once); return [...l.slice(0, i), ...e, ...l.slice(i)]; };
  const tasi = (b, once) => ekle(betikler.filter((x) => x !== b), once, b);
  const kotu = {
    'Öğren yok': digeri,
    'bir figür unutuldu': betikler.filter((b) => b !== 'js/learn/figures/book.js'),
    'yinelenen figür': ekle(betikler, 'js/learn/learn-lessons.js', 'js/learn/figures/book.js'),
    'olmayan betik': ekle(betikler, 'js/learn/learn.js', 'js/learn/yok.js'),
    'freeze.js öncesi': ekle(digeri, 'js/freeze.js', ...og),
    'calculator.js öncesi': ekle(digeri, 'js/calculator.js', ...og),
    'app.js sonrası': [...digeri, ...og],
    'grup bölünmüş': tasi('js/calculator.js', 'js/learn/cf-page.js'),
    'cf-sayfa motordan önce': tasi('js/learn/cf-page.js', 'js/learn/cf-engine.js'),
    'figür common.js öncesi': tasi('js/learn/figures/sewing.js', 'js/learn/figures/common.js'),
    'dersler figürlerden önce': tasi('js/learn/learn-lessons.js', 'js/learn/figures/common.js'),
    'learn.js son değil': tasi('js/learn/learn.js', 'js/learn/learn-lessons.js'),
    'ölçü motordan sonra': tasi('js/learn/learn-measure.js', 'js/learn/cf-page.js'),
  };
  for (const [ad, l] of Object.entries(kotu)) {
    assert.notDeepEqual(l, betikler, `varyant uygulanamadı: ${ad}`);
    assert.ok(ogrenSirasiHatalari(l, dosyalar).length > 0, `kusurlu sıra geçti: ${ad}`);
  }
  assert.ok(ogrenSirasiHatalari([], dosyalar).length > 0, 'boş liste');
});

test('dil betikleri Object.prototype dondurulmuş bağlamda da çalışır (prototipe yazmaz)', () => {
  const vm = require('node:vm');
  const ctx = vm.createContext({ console });
  ctx.self = ctx;
  vm.runInContext('Object.freeze(Object.prototype)', ctx);
  for (const b of ['i18n/en.js', 'i18n/tr.js', 'js/i18n.js']) vm.runInContext(fs.readFileSync(path.join(REPO, 'app', b), 'utf8'), ctx, { filename: b });
  assert.equal(vm.runInContext('JSON.stringify([KitapCilt.dil.diller().join(), KitapCilt.dil.tDilde("tr", "sekme.duzenle"), Object.isFrozen(Object.prototype)])', ctx), '["en,tr","Düzenle",true]');
});

/**
 * freeze.js'ten önce çalışan BÜTÜN dil betikleri (index.html'deki sırayla; dil/ klasöründeki her
 * sözlük yüklenmeli) Object.prototype'a (ve Array/Function/String prototiplerine) yazmaz. Sözlükler katı kipte değil:
 * dondurulmuş bağlamda kirletme sessizce düşer, o yüzden DONDURULMAMIŞ bağlamda önce/sonra karşılaştırılır; ayrıca
 * dondurulmuş bağlamda hatasız çalıştıkları ve bütün dilleri kaydettikleri sınanır. Sorun listesi döner (boş = uygun).
 */
function dilBetikleriProtoSorunlari(betikler, oku) {
  const vm = require('node:vm');
  const sorun = [];
  const goruntu = (ctx) => vm.runInContext(`JSON.stringify(['Object', 'Array', 'Function', 'String'].map((a) => {
    const p = globalThis[a].prototype;
    return Reflect.ownKeys(p).map((k) => { const d = Object.getOwnPropertyDescriptor(p, k); return a + '.' + String(k) + ':' + typeof d.value + (d.get ? ':get' : '') + (d.set ? ':set' : '') + ':' + d.enumerable + d.writable + d.configurable; }).sort();
  }))`, ctx);
  const acik = vm.createContext({ console });
  acik.self = acik;
  const once = goruntu(acik);
  for (const b of betikler) {
    try { vm.runInContext(oku(b), acik, { filename: b }); } catch (e) { sorun.push(`${b}: ${e.message}`); }
  }
  const sonra = goruntu(acik);
  if (once !== sonra) {
    const [o, s2] = [JSON.parse(once).flat(), JSON.parse(sonra).flat()];
    sorun.push('prototip değişti: ' + s2.filter((x) => !o.includes(x)).concat(o.filter((x) => !s2.includes(x)).map((x) => '-' + x)).join(', '));
  }
  const donuk = vm.createContext({ console });
  donuk.self = donuk;
  vm.runInContext('Object.freeze(Object.prototype)', donuk);
  for (const b of betikler) {
    try { vm.runInContext(oku(b), donuk, { filename: b }); } catch (e) { sorun.push(`${b} (dondurulmuş): ${e.message}`); }
  }
  const diller = betikler.filter((b) => /^i18n\/[a-z]{2,3}\.js$/.test(b)).map((b) => b.slice(5, -3)).sort().join();
  let kayitli = null;
  try { kayitli = vm.runInContext('KitapCilt.dil.diller().slice().sort().join()', donuk); } catch (e) { sorun.push('dondurulmuş bağlamda KitapCilt.dil yok: ' + e.message); }
  if (kayitli !== null && kayitli !== diller) sorun.push(`dondurulmuş bağlamda diller ${kayitli} (beklenen ${diller})`);
  return sorun;
}

test('freeze.js öncesindeki bütün dil betikleri (index.html sırası, i18n/*.js tamamı) prototiplere yazmaz; denetleyici kirletmeyi yakalar', () => {
  const betikler = [...INDEX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  const dil = betikler.slice(0, betikler.indexOf('js/freeze.js')).filter(dilBetigiMi);
  const klasor = fs.readdirSync(path.join(REPO, 'app', 'i18n')).filter((a) => /^[a-z]{2,3}\.js$/.test(a)).map((a) => 'i18n/' + a);
  assert.deepEqual(klasor.filter((k) => !dil.includes(k)), [], 'dil/ klasöründe index.html\'in freeze.js öncesinde yüklemediği sözlük var');
  assert.ok(dil.includes('js/i18n.js') && dil.length >= 3, dil.join());
  const oku = (b) => fs.readFileSync(path.join(REPO, 'app', b), 'utf8');
  assert.deepEqual(dilBetikleriProtoSorunlari(dil, oku), []);
  // kusurlu girdi: katı olmayan kipte sessiz kirletme, defineProperty, Array.prototype, sözlük kaydetmeyen betik
  const sahte = { 'i18n/xx.js': oku('i18n/tr.js').replace('"_dil": "tr"', '"_dil": "xx"') };
  const okuS = (b) => (b in sahte ? sahte[b] : oku(b));
  const kirli = {
    'atama (katı değil)': 'Object.prototype.kirli = 1;',
    'defineProperty': 'Object.defineProperty(Object.prototype, "gizli", { value: 1, enumerable: false });',
    'Array.prototype': 'Array.prototype.ekle = function () {};',
    'hata atan betik': 'throw new Error("bozuk");',
  };
  for (const [ad, kod] of Object.entries(kirli)) {
    sahte['i18n/xx.js'] = oku('i18n/tr.js').replace('"_dil": "tr"', '"_dil": "xx"') + '\n' + kod;
    assert.ok(dilBetikleriProtoSorunlari(['i18n/en.js', 'i18n/xx.js', 'js/i18n.js'], okuS).length > 0, ad);
  }
  sahte['i18n/xx.js'] = '/* boş sözlük */';
  assert.ok(dilBetikleriProtoSorunlari(['i18n/en.js', 'i18n/xx.js', 'js/i18n.js'], okuS).length > 0, 'sözlük kaydetmeyen i18n/xx.js');
  // eski denetim (yalnız dondurulmuş bağlamda çalıştırma) sessiz kirletmeyi yakalamıyordu: gözlem
  const vm = require('node:vm');
  const ctx = vm.createContext({ console });
  ctx.self = ctx;
  vm.runInContext('Object.freeze(Object.prototype)', ctx);
  assert.doesNotThrow(() => vm.runInContext('Object.prototype.kirli = 1;', ctx), 'katı olmayan kipte dondurulmuş prototipe atama hata vermez (eski testin açığı)');
});

test('Object.prototype dondurma: js/freeze.js son vendor betiğinden hemen sonra, uygulama betiklerinden önce', () => {
  const betikler = [...INDEX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  const i = betikler.indexOf('js/freeze.js');
  assert.ok(i > 0, 'index.html js/freeze.js yüklemiyor');
  assert.deepEqual(betikSirasiHatalari(betikler), []);
  const kaynak = fs.readFileSync(path.join(REPO, 'app', 'js', 'freeze.js'), 'utf8');
  assert.match(kaynak, /Object\.freeze\(Object\.prototype\)/);
  const vm = require('node:vm');
  const ctx = vm.createContext({});
  vm.runInContext(kaynak, ctx);
  assert.equal(vm.runInContext('Object.isFrozen(Object.prototype)', ctx), true);
  assert.equal(vm.runInContext("'use strict'; try { Object.prototype.kirli = 1; 'yazildi' } catch (e) { 'reddedildi' }", ctx), 'reddedildi');
});

// ---------------------------------------------------------------- pencere ayarı (gezinme/yeni pencere Rust'ta)
test('ana pencere sistem dili ön betiğiyle kurulur (lib.rs initialization_script(i18n::baslangic_betigi()))', () => {
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const bagli = (k) => /WebviewWindowBuilder::from_config\([\s\S]*?\.initialization_script\(i18n::baslangic_betigi\(\)\)[\s\S]*?\.build\(\)\?/.test(k.replace(/\/\/.*$/gm, ''));
  assert.ok(bagli(lib));
  assert.equal(bagli(lib.replace('.initialization_script(i18n::baslangic_betigi())', '')), false, 'kaldırılınca yakalanır');
  assert.equal(bagli(lib.replace('.initialization_script(i18n::baslangic_betigi())', '// .initialization_script(i18n::baslangic_betigi())')), false, 'yorum satırı sayılmaz');
});

test('pencere: "main" yapılandırmadan Rust kurulumunda (on_navigation/on_new_window ile) oluşturulur', () => {
  const w = KONF.app.windows;
  assert.equal(w.length, 1);
  assert.equal(w[0].label, 'main');
  assert.equal(w[0].create, false, 'pencere yapılandırmadan kendiliğinden oluşturulursa gezinme denetimi bağlanmaz');
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  assert.deepEqual(kurulumBaglamaHatalari(lib), []);
});

/**
 * lib.rs kurulumu gezinme/yeni pencere kararını Rust testlerinin doğrudan sınadığı işlevlere bağlıyor mu?
 * Kapanış içine gömülü karar (`|_| true`, `true || …`) Rust testlerinden kaçar (sınaması §7); bu yüzden
 * bağlama yalnız adlı işlevle kabul edilir. Karar işlevlerinin doğruluğu `cargo test`te.
 */
function kurulumBaglamaHatalari(lib) {
  const h = [];
  const kod = lib.replace(/\/\/.*$/gm, '');
  const nav = kod.match(/\.on_navigation\(([^)]*)\)/g) || [];
  if (nav.length !== 1 || nav[0] !== '.on_navigation(gezinme_karari)') h.push('on_navigation yalnız gezinme_karari ile bağlanmalı: ' + JSON.stringify(nav));
  const yeni = kod.match(/\.on_new_window\(.*\)\s*$/gm) || [];
  if (yeni.length !== 1 || !/^\.on_new_window\(\|url, _\| yeni_pencere_karari\(&url\)\)\s*$/.test(yeni[0].trim())) h.push('on_new_window yalnız yeni_pencere_karari ile bağlanmalı: ' + JSON.stringify(yeni));
  if (!/pub fn gezinme_karari\(url: &Url\) -> bool \{\s*let izin = gezinme_izinli\(url\);/.test(kod)) h.push('gezinme_karari gezinme_izinli sonucunu doğrudan kullanmıyor');
  const yp = kod.match(/fn yeni_pencere_karari<R: Runtime>\(url: &Url\) -> NewWindowResponse<R> \{\n([\s\S]*?)\n\}/);
  if (!yp || !/NewWindowResponse::Deny\s*$/.test(yp[1]) || /Allow|Create|return/.test(yp[1])) h.push('yeni_pencere_karari Deny dönmüyor');
  if (/WebviewWindowBuilder::new\(|webview_windows\(\)|\.add_child\(|WebviewBuilder::new\(/.test(kod)) h.push('denetimsiz ikinci pencere/webview kurulumu');
  return h;
}

test('kurulum bağlama denetleyicisi kusurlu lib.rs örneklerini reddeder', () => {
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  assert.deepEqual(kurulumBaglamaHatalari(lib), [], 'gerçek lib.rs geçmeli');
  const kotu = {
    'boş': '',
    'kapanış her şeye izin': lib.replace('.on_navigation(gezinme_karari)', '.on_navigation(|_| true)'),
    'kapanış içinde true ||': lib.replace('.on_navigation(gezinme_karari)', '.on_navigation(|u| true || gezinme_izinli(u))'),
    'on_navigation yok': lib.replace('.on_navigation(gezinme_karari)', ''),
    'iki on_navigation': lib.replace('.on_navigation(gezinme_karari)', '.on_navigation(gezinme_karari).on_navigation(|_| true)'),
    'karar işlevinde true ||': lib.replace('let izin = gezinme_izinli(url);', 'let izin = true || gezinme_izinli(url);'),
    'yeni pencere izinli': lib.replace('.on_new_window(|url, _| yeni_pencere_karari(&url))', '.on_new_window(|_, _| NewWindowResponse::Allow)'),
    'yeni pencere yok': lib.replace('.on_new_window(|url, _| yeni_pencere_karari(&url))', ''),
    'karar Allow': lib.replace(/(fn yeni_pencere_karari[\s\S]*?)NewWindowResponse::Deny/, '$1NewWindowResponse::Allow'),
    'karar erken Allow': lib.replace(/(fn yeni_pencere_karari[^\n]*\n)/, '$1    if url.as_str().is_empty() { return NewWindowResponse::Allow; }\n'),
    'ikinci pencere': lib + '\nfn x(app: &App) { WebviewWindowBuilder::new(app, "x", WebviewUrl::App("a".into())); }',
  };
  for (const [ad, k] of Object.entries(kotu)) {
    assert.notEqual(k, lib, `mutant uygulanamadı: ${ad}`);
    assert.ok(kurulumBaglamaHatalari(k).length > 0, `kusurlu örnek geçti: ${ad}`);
  }
});

// ---------------------------------------------------------------- izinler
// uygulamanın kendi komutları (src-tauri/build.rs app manifest → allow-<komut>). Komut listesi build.rs,
// lib.rs generate_handler! ve bu izinler arasında birebir aynı olmalı (aşağıdaki test).
const UYGULAMA_KOMUTLARI = ['dosya_ac', 'dosya_oku', 'dosya_kaydet', 'son_acilanlar', 'son_acilani_oku', 'bekleyen_acilanlar', 'veri_yedekle', 'veri_oku', 'dil_oku', 'dil_ayarla', 'yazdir', 'onizlemede_ac']; // yazdir, onizlemede_ac
const BEKLENEN_IZIN = ['core:event:allow-listen', 'dialog:allow-message', ...UYGULAMA_KOMUTLARI.map((k) => 'allow-' + k.replace(/_/g, '-'))];
function yetkiDenetle(y) {
  const h = [];
  if (!y || typeof y !== 'object') return ['yetki dosyası yok'];
  if (!Array.isArray(y.windows) || y.windows.length !== 1 || y.windows[0] !== 'main') h.push('windows yalnız ["main"] olmalı');
  if (y.webviews !== undefined) h.push('webviews alanı beklenmiyor');
  if (y.remote !== undefined) h.push('remote (uzak adrese IPC) beklenmiyor');
  if (y.platforms !== undefined && !(Array.isArray(y.platforms))) h.push('platforms geçersiz');
  const izin = Array.isArray(y.permissions) ? y.permissions.map((p) => (typeof p === 'string' ? p : p && p.identifier)) : [];
  if (!Array.isArray(y.permissions)) h.push('permissions yok');
  for (const p of izin) if (!BEKLENEN_IZIN.includes(p)) h.push(`fazla izin: ${p}`);
  for (const p of BEKLENEN_IZIN) if (!izin.includes(p)) h.push(`eksik izin: ${p}`);
  if (new Set(izin).size !== izin.length) h.push('yinelenen izin');
  if (Array.isArray(y.permissions) && y.permissions.some((p) => typeof p !== 'string')) h.push('kapsamlı (nesne) izin beklenmiyor');
  return h;
}

test('izinler: capabilities/default.json en küçük set (event dinleme + onay penceresi + uygulama komutları), core:default yok', () => {
  assert.deepEqual(yetkiDenetle(YETKI), []);
  // Tauri capabilities/ klasöründeki BÜTÜN dosyaları yükler; ek dosya ya da conf'ta satır içi yetki izin ekleyebilir.
  assert.deepEqual(fs.readdirSync(path.join(REPO, 'src-tauri', 'capabilities')), ['default.json']);
  assert.equal(KONF.app.security.capabilities, undefined, 'tauri.conf.json içinde ek yetki tanımı');
});

/** build.rs app manifest komutları ve lib.rs generate_handler! listesi (yalnız `modul::komut` adları). */
function komutListeleri(build, lib) {
  const b = (build.match(/commands\(&\[([\s\S]*?)\]\)/) || [])[1];
  const l = (lib.match(/generate_handler!\[([\s\S]*?)\]/) || [])[1];
  return {
    build: b ? [...b.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : null,
    lib: l ? l.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split('::').pop()) : null,
  };
}

test('uygulama komutları: build.rs manifesti = lib.rs generate_handler! = izinler (eksik/fazla yok)', () => {
  const build = fs.readFileSync(path.join(REPO, 'src-tauri', 'build.rs'), 'utf8');
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const k = komutListeleri(build, lib);
  assert.deepEqual([...k.build].sort(), [...UYGULAMA_KOMUTLARI].sort(), 'build.rs');
  assert.deepEqual([...k.lib].sort(), [...UYGULAMA_KOMUTLARI].sort(), 'lib.rs generate_handler!');
  // manifest yoksa Tauri uygulama komutlarını izinsiz açar: build.rs app_manifest kullanmalı
  assert.match(build, /app_manifest\(/);
  // kusurlu örnekler: listeler ayrışırsa yakalanır
  const fazla = komutListeleri(build, lib.replace('backup::veri_oku,', 'backup::veri_oku,\n            files::gizli_komut,'));
  assert.notDeepEqual([...fazla.lib].sort(), [...UYGULAMA_KOMUTLARI].sort());
  assert.equal(komutListeleri('', '').build, null);
});

test('izin denetleyicisi kusurlu örnekleri reddeder', () => {
  const iyi = { identifier: 'default', windows: ['main'], permissions: BEKLENEN_IZIN.slice() };
  assert.deepEqual(yetkiDenetle(iyi), []);
  const kotu = {
    'null': null,
    'core:default eklenmiş': { ...iyi, permissions: ['core:default', ...BEKLENEN_IZIN] },
    'yalnız core:default': { ...iyi, permissions: ['core:default', 'dialog:allow-message'] },
    'core:event:default': { ...iyi, permissions: ['core:event:default', 'dialog:allow-message'] },
    'dialog:default': { ...iyi, permissions: ['core:event:allow-listen', 'dialog:default'] },
    'emit izni': { ...iyi, permissions: [...BEKLENEN_IZIN, 'core:event:allow-emit'] },
    'dosya sistemi': { ...iyi, permissions: [...BEKLENEN_IZIN, 'fs:default'] },
    'onay izni eksik': { ...iyi, permissions: ['core:event:allow-listen'] },
    'boş izin': { ...iyi, permissions: [] },
    'izin alanı yok': { identifier: 'default', windows: ['main'] },
    'joker pencere': { ...iyi, windows: ['*'] },
    'iki pencere': { ...iyi, windows: ['main', 'diger'] },
    'uzak adres': { ...iyi, remote: { urls: ['https://*.example.com'] } },
    'nesne izin': { ...iyi, permissions: ['core:event:allow-listen', { identifier: 'dialog:allow-message', allow: [{ path: '$HOME' }] }] },
    'yinelenen': { ...iyi, permissions: [...BEKLENEN_IZIN, 'dialog:allow-message'] },
    'dosya okuma izni eksik': { ...iyi, permissions: BEKLENEN_IZIN.filter((p) => p !== 'allow-dosya-oku') },
    'uygulama joker izni': { ...iyi, permissions: [...BEKLENEN_IZIN, 'allow-*'] },
    'bilinmeyen uygulama komutu': { ...iyi, permissions: [...BEKLENEN_IZIN, 'allow-yol-oku'] },
    'dialog open (JS yol seçimi)': { ...iyi, permissions: [...BEKLENEN_IZIN, 'dialog:allow-open'] },
    'deny ile karışık': { ...iyi, permissions: [...BEKLENEN_IZIN, 'deny-veri-oku'] },
  };
  for (const [ad, y] of Object.entries(kotu)) assert.ok(yetkiDenetle(y).length > 0, `kusurlu örnek geçti: ${ad}`);
});

// ---------------------------------------------------------------- entitlements ve dosya ilişkilendirme
/** Düz plist sözlüğündeki <key>…</key><true/|false/> çiftleri (yorumlar atılır). Başka değer türü → hata listesi. */
function entitlementOku(xml) {
  const govde = String(xml).replace(/<!--[\s\S]*?-->/g, '');
  const anahtar = {};
  const hata = [];
  const re = /<key>([^<]+)<\/key>\s*<([a-z]+)\s*\/?>/g;
  let m;
  while ((m = re.exec(govde))) {
    if (m[1] in anahtar) hata.push('yinelenen ' + m[1]);
    if (m[2] === 'true') anahtar[m[1]] = true;
    else if (m[2] === 'false') anahtar[m[1]] = false;
    else hata.push(`${m[1]}: beklenmeyen değer <${m[2]}>`);
  }
  if (!/<plist[^>]*>\s*<dict>/.test(govde)) hata.push('plist/dict yok');
  return { anahtar, hata };
}
const YEREL_ENT = ['com.apple.security.app-sandbox', 'com.apple.security.files.user-selected.read-write', 'com.apple.security.files.bookmarks.app-scope', 'com.apple.security.print', 'com.apple.security.network.client'];

test('entitlements: yerel = sandbox + kullanıcı seçimi + yer imi (app-scope) + yazdırma + network.client; S12 derlemesi yer imsiz, gerisi aynı', () => {
  const oku = (ad) => entitlementOku(fs.readFileSync(path.join(REPO, 'src-tauri', ad), 'utf8'));
  const yerel = oku('Entitlements.local.plist');
  assert.deepEqual(yerel.hata, []);
  assert.deepEqual(Object.keys(yerel.anahtar).sort(), [...YEREL_ENT].sort());
  assert.ok(Object.values(yerel.anahtar).every((v) => v === true));
  const yerimsiz = oku('Entitlements.local-no-bookmarks.plist');
  assert.deepEqual(yerimsiz.hata, []);
  assert.deepEqual(Object.keys(yerimsiz.anahtar).sort(), YEREL_ENT.filter((k) => !/bookmarks/.test(k)).sort());
  const konf = (ad) => JSON.parse(fs.readFileSync(path.join(REPO, 'src-tauri', ad), 'utf8')).bundle.macOS.entitlements;
  assert.equal(konf('tauri.local.conf.json'), 'Entitlements.local.plist');
  assert.equal(konf('tauri.local-no-bookmarks.conf.json'), 'Entitlements.local-no-bookmarks.plist');
  // denetleyici kusurlu örnekleri yakalar
  assert.ok(entitlementOku('').hata.length > 0);
  assert.ok(entitlementOku('<plist><dict><key>a</key><string>x</string></dict></plist>').hata.length > 0);
  assert.ok(entitlementOku('<plist><dict><key>a</key><true/><key>a</key><true/></dict></plist>').hata.length > 0);
  assert.deepEqual(entitlementOku('<plist><dict><!-- <key>gizli</key><true/> --><key>a</key><false/></dict></plist>').anahtar, { a: false });
});

test('dosya ilişkilendirme: PDF ve EPUB (klasör paketi türü com.apple.ibooks.epub dahil) Görüntüleyici olarak', () => {
  const fa = KONF.bundle.fileAssociations;
  assert.ok(Array.isArray(fa) && fa.length === 2);
  const pdf = fa.find((f) => f.ext.includes('pdf'));
  const epub = fa.find((f) => f.ext.includes('epub'));
  assert.ok(pdf && pdf.contentTypes.includes('com.adobe.pdf') && pdf.role === 'Viewer');
  assert.ok(epub && epub.contentTypes.includes('com.apple.ibooks.epub') && epub.contentTypes.includes('org.idpf.epub-container') && epub.role === 'Viewer');
  assert.ok(fa.every((f) => !f.exportedType), 'başkasının türü dışa aktarılmaz (exportedType yok)');
});
