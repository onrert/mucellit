'use strict';
/*
 * learn-measure.test.js — Öğren rehberinin sayı paneli (app/js/learn/learn-measure.js) uygulamanın kendi hesabıyla.
 *  1. Öntanımlılar Hesapla sekmesinin öntanımlılarıyla aynı: index.html'deki Hesapla alanlarından kurulan girdi
 *     (calculator.js girdiOku ile aynı kurallar) → hesap.hesapla → taban → panel; panel Hesapla'nın sonucunu AYNEN kullanır.
 *  2. Örnek Kitap (gerçek bir baskıdan alınan değerler) değerleri
 *     birebir: Hesapla'dan (162 sayfa) ve elle (11 forma × 4 kâğıt) iki yoldan.
 *  3. Bağımsız eşleme (bu dosyada ayrı yazıldı, panel kodundan kopyalanmadı) ile 1000 rastgele girdide calc.js aynı;
 *     tabanlı (Hesapla'dan gelen mukavva/taşma/kıvırma/mafsal …) 500 rastgele girdide de aynı.
 *  4. Taban kuralları: elle değişiklik Hesapla girdisini değiştirmez; forma/kâğıt aynıysa Hesapla'nın sayfa sayısı ve
 *     son forma ayarı kalır; formalı olmayan / yuvarlak sırtlı Hesapla formalı + düz çizilir (uyum=false); Hesapla
 *     hatası ya da rehber sınırı dışı değer taban vermez.
 *  5. Kusurlu girdi sınaması: karşılaştırıcı bozuk hesabı, eşleme bozuk panel kopyasını yakalar; geçersiz değerler reddedilir.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setupI18n } = require('./i18n-helper.js');

const APP = path.join(__dirname, '..');
const SIZE_PATH = path.join(APP, 'js', 'learn', 'learn-measure.js');
const Size = require(SIZE_PATH);
const Calc = require('../js/calc.js');
const INDEX = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

/* Bağımsız eşleme: formalı dikiş; toplam sayfa = forma × (forma başına kâğıt × 2 yaprak × 2 sayfa); boyut ve kalınlık aynen. */
const MAPPING = {
  bindingType: () => 'sewn',
  pageCount: (g) => { const sheetSignature = g.sheetsPerSignature * 2, pageSignature = sheetSignature * 2; return g.signatureCount * pageSignature; },
  sheetsPerSignature: (g) => g.sheetsPerSignature, bookWidth: (g) => g.bookWidth, bookHeight: (g) => g.bookHeight, paperThickness: (g) => g.paperThickness,
};
const applyMapping = (g, ek) => Object.assign({}, ek || {}, Object.fromEntries(Object.entries(MAPPING).map(([a, fn]) => [a, fn(g)])));

/** Panel sonucu ile calc.js sonucunun farkları (boş = aynı). */
function compare(o, r) {
  const double = [
    ['page', o.page, r.totalPages], ['signature', o.N, r.signatureCount], ['sheet', o.sheet, r.leaves],
    ['printing', o.printSheets, r.printSheets], ['spine', o.S, r.spineThickness], ['jointGap', o.f, r.jointGap],
    ['brdWidth', o.Db, r.board.width], ['brdHeight', o.Dh, r.board.height], ['strip', o.R, r.spineStrip.width],
    ['kapGen', o.covering.width, r.covering.width], ['containerHeight', o.covering.height, r.covering.height],
    ['endpaperWidth', o.endpapers.width, r.endpapers.width], ['endpaperHeight', o.endpapers.height, r.endpapers.height],
    ['mullGen', o.mull.width, r.mull.width], ['mullHeight', o.mull.height, r.mull.height], ['headbands', o.headbands, r.headbands.length],
    ['square', o.k, Number(r.input.square)], ['turnIn', o.e, Number(r.input.turnIn)], ['t', o.t, Number(r.input.boardThickness)],
  ];
  return double.filter(([, a, b]) => a !== b).map(([name, a, b]) => `${name}: panel ${a} ≠ hesap ${b}`);
}
function seed(s) { return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function random(rnd) {
  const r = (a, b) => a + rnd() * (b - a), yuv = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  return { signatureCount: 1 + Math.floor(rnd() * 40), sheetsPerSignature: 1 + Math.floor(rnd() * 8),
    bookWidth: yuv(r(60, 300), rnd() < 0.5 ? 0 : 1), bookHeight: yuv(r(80, 420), rnd() < 0.5 ? 0 : 1), paperThickness: yuv(r(0.04, 0.4), 3) };
}
/** Hesapla durumu: { girdi, sonuc } (calculator.js'in sakladığı biçim). */
const calculatorState = (input) => ({ error: null, input, result: Calc.calculate(input) });

/**
 * index.html'deki Hesapla alanlarının öntanımlıları → calculator.js girdiOku ile aynı kurallarla girdi (boş sayı → yok,
 * boş mafsal → 'otomatik'). Ayrıştırıcı bu testte yazıldı (calculator.js'ten alınmadı).
 */
function calculatorDefault(html) {
  const value = (id) => { const m = new RegExp(`<input[^>]*\\sid="h-${id}"[^>]*>`).exec(html); assert.ok(m, `h-${id} none`); const v = /\svalue="([^"]*)"/.exec(m[0]); return v ? v[1] : ''; };
  const selected = (id) => { const m = new RegExp(`<select id="h-${id}">([\\s\\S]*?)</select>`).exec(html); assert.ok(m, `h-${id} none`); const o = /<option value="([^"]+)"[^>]*\sselected/.exec(m[1]) || /<option value="([^"]+)"/.exec(m[1]); return o[1]; };
  const g = { bindingType: selected('bindingType'), shrinkLastSignature: /id="h-shrinkLastSignature"[^>]*\schecked/.test(html), spineShape: selected('spineShape'), spineRule: selected('spineRule') };
  for (const a of ['pageCount', 'sheetsPerSignature', 'paperThickness', 'endpaperAllowance', 'bookWidth', 'bookHeight', 'boardThickness', 'square', 'curveLength', 'jointGap', 'turnIn', 'spareSheets']) {
    const v = value(a).trim();
    g[a] = v === '' ? undefined : Number(v.replace(',', '.'));
  }
  if (g.jointGap === undefined) g.jointGap = 'auto';
  return g;
}

// calc.js hata metinleri için dil (Node'da require('./i18n.js') yolu da çalışır; açıkça Türkçe kurulur)
const ctx = { navigator: { languages: ['tr-TR'] } }; ctx.self = ctx; vm.createContext(ctx); setupI18n(ctx, 'tr');

// ---------------------------------------------------------------- 1. öntanımlı = Hesapla
test('öntanımlı: panel Hesapla sekmesinin öntanımlı girdisini ve SONUCUNU aynen kullanır (index.html → calc.calculator → taban)', () => {
  const g = calculatorDefault(INDEX);
  assert.deepEqual({ bindingType: g.bindingType, pageCount: g.pageCount, sheetsPerSignature: g.sheetsPerSignature, bookWidth: g.bookWidth, bookHeight: g.bookHeight, paperThickness: g.paperThickness, boardThickness: g.boardThickness, square: g.square, turnIn: g.turnIn, jointGap: g.jointGap },
    { bindingType: 'sewn', pageCount: 200, sheetsPerSignature: 4, bookWidth: 148, bookHeight: 210, paperThickness: 0.1, boardThickness: 2, square: 3, turnIn: 15, jointGap: 'auto' }, 'Hesapla öntanımlıları (index.html)');
  const d = calculatorState(g);
  const tb = Size.fromBase(d);
  assert.equal(tb.match, true);
  assert.equal(tb.result, d.result, 'Hesapla formalı + düz: sonuç nesnesi aynen (kopya hesap yok)');
  assert.deepEqual(tb.bes, { signatureCount: 13, sheetsPerSignature: 4, bookWidth: 148, bookHeight: 210, paperThickness: 0.1 });
  const o = Size.calculate(tb.bes, tb);
  assert.equal(o.source, 'calculator');
  assert.equal(o.calc, d.result);
  assert.deepEqual(compare(o, d.result), []);
  assert.deepEqual([o.page, o.N, o.S, o.Db, o.Dh, o.f], [208, 13, 10.4, 144, 216, 7]);
  // girdi verilmezse de taban kullanılır
  assert.equal(Size.calculate({}, tb).calc, d.result);
});

// ---------------------------------------------------------------- 2. Örnek Kitap
const TB = { page: 176, signature: 11, sheet: 88, printing: 44, spine: 8.8, jointGap: 7, board: [144, 216], strip: [12.8, 216], covering: [348.8, 250], endpapers: [296, 210], mull: [58.8, 198], headbands: 8.8 };
function tbFarki(o) {
  const v = { page: o.page, signature: o.N, sheet: o.sheet, printing: o.printSheets, spine: o.S, jointGap: o.f, board: [o.Db, o.Dh], strip: [o.R, o.Dh],
    covering: [o.covering.width, o.covering.height], endpapers: [o.endpapers.width, o.endpapers.height], mull: [o.mull.width, o.mull.height], headbands: o.headbands };
  return Object.keys(TB).filter((a) => JSON.stringify(v[a]) !== JSON.stringify(TB[a])).map((a) => `${a}: ${JSON.stringify(v[a])} ≠ ${JSON.stringify(TB[a])}`);
}
test('Örnek Kitap birebir: Hesapla\'dan (162 sayfa) ve elle (11 forma × 4 kâğıt) aynı değerler', () => {
  const tbInput = { bindingType: 'sewn', pageCount: 162, sheetsPerSignature: 4, shrinkLastSignature: false, paperThickness: 0.1, endpaperAllowance: 0, bookWidth: 148, bookHeight: 210,
    boardThickness: 2, square: 3, spineShape: 'flat', spineRule: 'twoT', jointGap: 'auto', turnIn: 15, spareSheets: 0 };
  const tb = Size.fromBase(calculatorState(tbInput));
  const o1 = Size.calculate(tb.bes, tb);
  assert.deepEqual(tbFarki(o1), []);
  assert.equal(o1.calc.blankPages, 14, '176 (14 boş)');
  const o2 = Size.calculate({ signatureCount: 11, sheetsPerSignature: 4, bookWidth: 148, bookHeight: 210, paperThickness: 0.1 });
  assert.deepEqual(tbFarki(o2), []);
  // rehberin ek varsayımları (delik, iplik, köşe)
  assert.deepEqual([o2.station.number, o2.station.range, o2.station.position[0], o2.station.position[5]], [6, 36, 15, 195]);
  assert.equal(o2.thread, 2730); assert.deepEqual(o2.corner, [4, 5]); assert.deepEqual([o2.k, o2.e, o2.t], [3, 15, 2]);
  // denetleyici bozuk değeri yakalar
  assert.ok(tbFarki({ ...o2, S: 8.9 }).length === 1 && tbFarki({ ...o2, Db: 145 }).length === 1);
});

// ---------------------------------------------------------------- 3. bağımsız eşleme, rastgele
test('1000 rastgele girdi (tabansız) ve 500 rastgele girdi (rastgele Hesapla tabanıyla) calc.js ile aynı', () => {
  const rnd = seed(20261023);
  for (let i = 0; i < 1000; i++) {
    const g = random(rnd), o = Size.calculate(g), r = Calc.calculate(applyMapping(g));
    assert.deepEqual(o.calc.input, r.input, 'hesap girdisi bağımsız eşlemeyle aynı');
    assert.deepEqual(compare(o, r), [], JSON.stringify(g));
  }
  for (let i = 0; i < 500; i++) {
    const ek = { boardThickness: [1, 1.5, 2, 2.5, 3][Math.floor(rnd() * 5)], square: [0, 2, 3, 4][Math.floor(rnd() * 4)], turnIn: [12, 15, 18][Math.floor(rnd() * 3)],
      jointGap: rnd() < 0.5 ? 'auto' : 6 + Math.floor(rnd() * 4), endpaperAllowance: rnd() < 0.5 ? 0 : 0.4, spineRule: rnd() < 0.7 ? 'twoT' : 'onlyS', spareSheets: Math.floor(rnd() * 3) };
    const base = random(rnd), tb = Size.fromBase(calculatorState(applyMapping(base, ek)));
    assert.ok(tb.input, JSON.stringify(base));
    const g = random(rnd), o = Size.calculate(g, tb);
    const r = Calc.calculate(applyMapping(g, { ...ek, spineShape: 'flat', shrinkLastSignature: false }));
    assert.deepEqual(compare(o, r), [], JSON.stringify({ g, ek }));
  }
});

// ---------------------------------------------------------------- 4. taban kuralları
test('taban: elle değişiklik Hesapla girdisini değiştirmez; forma/kâğıt aynıysa Hesapla\'nın sayfa sayısı ve son forma ayarı kalır', () => {
  const hg = { bindingType: 'sewn', pageCount: 200, sheetsPerSignature: 4, shrinkLastSignature: true, paperThickness: 0.1, bookWidth: 148, bookHeight: 210, boardThickness: 2.5, square: 4, turnIn: 18, jointGap: 'auto', spineShape: 'flat', spineRule: 'twoT' };
  const once = JSON.stringify(hg), d = calculatorState(hg), tb = Size.fromBase(d);
  assert.equal(d.result.totalPages, 200, 'son forma küçük: 12 × 16 + 2 kâğıt × 4');
  const wide = Size.calculate({ ...tb.bes, bookWidth: 160 }, tb);
  assert.equal(wide.source, 'guide');
  assert.deepEqual([wide.page, wide.N, wide.t, wide.k, wide.e], [200, 13, 2.5, 4, 18], 'yalnız en değişti: sayfa ve son forma Hesapla\'dan');
  assert.equal(wide.calc.input.shrinkLastSignature, true);
  const signature = Size.calculate({ ...tb.bes, signatureCount: 5 }, tb);
  assert.deepEqual([signature.page, signature.N, signature.calc.input.shrinkLastSignature, signature.t, signature.k, signature.e], [80, 5, false, 2.5, 4, 18], 'forma değişti: 5 × 16 sayfa, Hesapla\'nın mukavva/taşma/kıvırması');
  assert.equal(JSON.stringify(hg), once, 'Hesapla girdisi değişmedi');
  assert.equal(JSON.stringify(tb.input), once, 'taban girdisi değişmedi');
  assert.equal(Size.calculate({ ...tb.bes }, tb).source, 'calculator', 'aynı değerlere dönünce bağ sürer');
});

test('taban: formalı olmayan ya da yuvarlak sırtlı Hesapla formalı + düz sırtla çizilir (match=false); diğer ayarlar aynen', () => {
  const common = { pageCount: 176, sheetsPerSignature: 4, paperThickness: 0.1, bookWidth: 148, bookHeight: 210, boardThickness: 2, square: 3, turnIn: 15, jointGap: 'auto', spineRule: 'twoT' };
  for (const difference of [{ bindingType: 'single1', spineShape: 'flat' }, { bindingType: 'single2', spineShape: 'flat' }, { bindingType: 'sewn', spineShape: 'rounded', curveLength: 20 }]) {
    const d = calculatorState({ ...common, ...difference }), tb = Size.fromBase(d);
    assert.equal(tb.match, false, JSON.stringify(difference));
    assert.notEqual(tb.result, d.result);
    assert.deepEqual([tb.input.bindingType, tb.input.spineShape, 'curveLength' in tb.input], ['sewn', 'flat', false]);
    assert.deepEqual(tbFarki(Size.calculate(tb.bes, tb)), [], 'formalı + düz: Örnek Kitap değerleri');
  }
});

test('taban: Hesapla hatası ya da rehberin sınırları dışındaki değer taban vermez (kusurlu girdi)', () => {
  assert.ok(Size.fromBase(null).error);
  assert.ok(Size.fromBase({ error: 'Geçersiz sayı', input: null, result: null }).error);
  assert.ok(Size.fromBase({}).error, 'boş durum');
  const many = Size.fromBase(calculatorState({ bindingType: 'sewn', pageCount: 2000, sheetsPerSignature: 4, bookWidth: 148, bookHeight: 210, paperThickness: 0.1 }));
  assert.deepEqual(many.fields, ['signatureCount']);
  const dar = Size.fromBase(calculatorState({ bindingType: 'sewn', pageCount: 32, sheetsPerSignature: 4, bookWidth: 40, bookHeight: 500, paperThickness: 0.5 }));
  assert.deepEqual(dar.fields, ['bookWidth', 'bookHeight', 'paperThickness']);
  // taban nesnesi eksikse yok sayılır (öntanımlıya düşer)
  assert.equal(Size.calculate({}, { input: null }).N, 11);
});

// ---------------------------------------------------------------- 5. kusurlu girdi
test('kusurlu girdi: geçersiz değerler reddedilir, alan adı bildirilir (tabanlı ve tabansız)', () => {
  const tb = Size.fromBase(calculatorState(calculatorDefault(INDEX)));
  const bad = [
    [{ signatureCount: 0 }, 'signatureCount'], [{ signatureCount: 41 }, 'signatureCount'], [{ signatureCount: 2.5 }, 'signatureCount'],
    [{ sheetsPerSignature: 9 }, 'sheetsPerSignature'], [{ bookWidth: 59.9 }, 'bookWidth'], [{ bookHeight: 'abc' }, 'bookHeight'],
    [{ paperThickness: -0.1 }, 'paperThickness'], [{ paperThickness: '1.200' }, 'paperThickness'], [{ bookWidth: '1,2,3' }, 'bookWidth'],
    [{ bookHeight: NaN }, 'bookHeight'], [{ bookHeight: Infinity }, 'bookHeight'], [{ signatureCount: '  ' }, 'signatureCount'],
  ];
  for (const t of [null, tb]) for (const [g, field] of bad) assert.throws(() => Size.calculate(g, t), (e) => e instanceof RangeError && e.fields.includes(field), JSON.stringify(g));
  assert.equal(Size.calculate({ paperThickness: '0,12' }).S, 10.56, 'virgüllü ondalık');
  assert.equal(Size.invalidFields({ signatureCount: '', sheetsPerSignature: '', bookWidth: '', bookHeight: '', paperThickness: '' }).length, 5);
});

test('karşılaştırıcı bozuk hesabı yakalar; eşleme bozuk panel kopyası FAIL der (kusurlu girdi sınaması)', () => {
  const rnd = seed(7);
  const corrupt = {
    'mafsal +1': (r) => { r.jointGap += 1; },
    'sırt × 1,01': (r) => { r.spineThickness = Math.round(r.spineThickness * 1.01 * 1000) / 1000; },
    'kaplama eni −0,1': (r) => { r.covering = { width: r.covering.width - 0.1, height: r.covering.height }; },
    'forma +1': (r) => { r.signatureCount += 1; },
  };
  for (const [name, breakIt] of Object.entries(corrupt)) {
    let caught = 0;
    for (let i = 0; i < 50; i++) { const g = random(rnd), r = Calc.calculate(applyMapping(g)); breakIt(r); if (compare(Size.calculate(g), r).length) caught++; }
    assert.ok(caught >= 49, `${name}: ${caught}/50`);
  }
  const source = fs.readFileSync(SIZE_PATH, 'utf8');
  const copy = (a, b) => { assert.ok(source.includes(a), 'varyant uygulanamadı: ' + a); const m = { exports: {} };
    new Function('module', 'require', 'self', source.replace(a, b))(m, (name) => require(path.join(APP, 'js', 'learn', name)), undefined); return m.exports; }; // eslint-disable-line no-new-func
  const varyant = {
    'sayfa = forma × kâğıt × 2': copy('hg.pageCount = sameSignature ? tb.input.pageCount : N * y * 4;', 'hg.pageCount = sameSignature ? tb.input.pageCount : N * y * 2;'),
    'en ↔ boy': copy('hg.bookWidth = g.bookWidth; hg.bookHeight = g.bookHeight;', 'hg.bookWidth = g.bookHeight; hg.bookHeight = g.bookWidth;'),
    'kalınlık yuvarlanmış': copy('hg.paperThickness = g.paperThickness;', 'hg.paperThickness = Math.round(g.paperThickness * 10) / 10;'),
    'taban mukavvası atılmış': copy('if (tb) Object.keys(tb.input).forEach(function (a) { hg[a] = tb.input[a]; });', ''),
  };
  const tbInput = { boardThickness: 3, square: 4, turnIn: 18 };
  for (const [name, O] of Object.entries(varyant)) {
    let fail = 0;
    for (let i = 0; i < 50; i++) {
      const tb = O.fromBase(calculatorState(applyMapping(random(rnd), tbInput))), g = random(rnd);
      let f; try { f = compare(O.calculate(g, tb), Calc.calculate(applyMapping(g, { ...tbInput, spineShape: 'flat', shrinkLastSignature: false }))); } catch (e) { f = ['hata: ' + e.message]; }
      if (f.length) fail++;
    }
    assert.ok(fail >= 45, `${name}: ${fail}/50 FAIL`);
  }
});

test('Hesapla öntanımlı ayrıştırıcısı kusurlu HTML\'i yakalar (eksik alan)', () => {
  assert.throws(() => calculatorDefault(INDEX.replace('id="h-pageCount"', 'id="h-none"')));
  assert.throws(() => calculatorDefault(''));
  assert.equal(calculatorDefault(INDEX.replace(/(id="h-pageCount"[^>]*\s)value="200"/, '$1value="176"')).pageCount, 176, 'değer değişince okunan değişir');
});
