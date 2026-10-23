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
const { dilKur } = require('./i18n-helper.js');

const UYGULAMA = path.join(__dirname, '..');
const OLCU_YOLU = path.join(UYGULAMA, 'js', 'learn', 'learn-measure.js');
const Olcu = require(OLCU_YOLU);
const Hesap = require('../js/calc.js');
const INDEX = fs.readFileSync(path.join(UYGULAMA, 'index.html'), 'utf8');

/* Bağımsız eşleme: formalı dikiş; toplam sayfa = forma × (forma başına kâğıt × 2 yaprak × 2 sayfa); boyut ve kalınlık aynen. */
const ESLEME = {
  ciltTuru: () => 'formali',
  sayfaSayisi: (g) => { const yaprakForma = g.formaYaprak * 2, sayfaForma = yaprakForma * 2; return g.formaSayisi * sayfaForma; },
  formaYaprak: (g) => g.formaYaprak, kitapGen: (g) => g.kitapGen, kitapYuk: (g) => g.kitapYuk, kagitKalinlik: (g) => g.kagitKalinlik,
};
const eslemeUygula = (g, ek) => Object.assign({}, ek || {}, Object.fromEntries(Object.entries(ESLEME).map(([a, fn]) => [a, fn(g)])));

/** Panel sonucu ile calc.js sonucunun farkları (boş = aynı). */
function karsilastir(o, r) {
  const cift = [
    ['sayfa', o.sayfa, r.toplamSayfa], ['forma', o.N, r.formaSayisi], ['yaprak', o.yaprak, r.kitapYaprak],
    ['baski', o.baskiKagidi, r.baskiKagidi], ['sirt', o.S, r.sirtKalinlik], ['mafsal', o.f, r.mafsal],
    ['mukGen', o.Db, r.mukavva.gen], ['mukYuk', o.Dh, r.mukavva.yuk], ['serit', o.R, r.sirtSeridi.gen],
    ['kapGen', o.kaplama.gen, r.kaplama.gen], ['kapYuk', o.kaplama.yuk, r.kaplama.yuk],
    ['forzaGen', o.forza.gen, r.forza.gen], ['forzaYuk', o.forza.yuk, r.forza.yuk],
    ['mullGen', o.mull.gen, r.mull.gen], ['mullYuk', o.mull.yuk, r.mull.yuk], ['kapital', o.kapital, r.kapital.uzunluk],
    ['tasma', o.k, Number(r.girdi.tasma)], ['kivirma', o.e, Number(r.girdi.kivirma)], ['t', o.t, Number(r.girdi.mukavvaKalinlik)],
  ];
  return cift.filter(([, a, b]) => a !== b).map(([ad, a, b]) => `${ad}: panel ${a} ≠ hesap ${b}`);
}
function tohum(s) { return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function rastgele(rnd) {
  const r = (a, b) => a + rnd() * (b - a), yuv = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  return { formaSayisi: 1 + Math.floor(rnd() * 40), formaYaprak: 1 + Math.floor(rnd() * 8),
    kitapGen: yuv(r(60, 300), rnd() < 0.5 ? 0 : 1), kitapYuk: yuv(r(80, 420), rnd() < 0.5 ? 0 : 1), kagitKalinlik: yuv(r(0.04, 0.4), 3) };
}
/** Hesapla durumu: { girdi, sonuc } (calculator.js'in sakladığı biçim). */
const hesaplaDurumu = (girdi) => ({ hata: null, girdi, sonuc: Hesap.hesapla(girdi) });

/**
 * index.html'deki Hesapla alanlarının öntanımlıları → calculator.js girdiOku ile aynı kurallarla girdi (boş sayı → yok,
 * boş mafsal → 'otomatik'). Ayrıştırıcı bu testte yazıldı (calculator.js'ten alınmadı).
 */
function hesaplaOntanimli(html) {
  const deger = (id) => { const m = new RegExp(`<input[^>]*\\sid="h-${id}"[^>]*>`).exec(html); assert.ok(m, `h-${id} yok`); const v = /\svalue="([^"]*)"/.exec(m[0]); return v ? v[1] : ''; };
  const secili = (id) => { const m = new RegExp(`<select id="h-${id}">([\\s\\S]*?)</select>`).exec(html); assert.ok(m, `h-${id} yok`); const o = /<option value="([^"]+)"[^>]*\sselected/.exec(m[1]) || /<option value="([^"]+)"/.exec(m[1]); return o[1]; };
  const g = { ciltTuru: secili('ciltTuru'), sonFormaKucult: /id="h-sonFormaKucult"[^>]*\schecked/.test(html), sirtTipi: secili('sirtTipi'), sirtKurali: secili('sirtKurali') };
  for (const a of ['sayfaSayisi', 'formaYaprak', 'kagitKalinlik', 'forzaPayi', 'kitapGen', 'kitapYuk', 'mukavvaKalinlik', 'tasma', 'egriBoyu', 'mafsal', 'kivirma', 'yedekKagit']) {
    const v = deger(a).trim();
    g[a] = v === '' ? undefined : Number(v.replace(',', '.'));
  }
  if (g.mafsal === undefined) g.mafsal = 'otomatik';
  return g;
}

// calc.js hata metinleri için dil (Node'da require('./i18n.js') yolu da çalışır; açıkça Türkçe kurulur)
const ctx = { navigator: { languages: ['tr-TR'] } }; ctx.self = ctx; vm.createContext(ctx); dilKur(ctx, 'tr');

// ---------------------------------------------------------------- 1. öntanımlı = Hesapla
test('öntanımlı: panel Hesapla sekmesinin öntanımlı girdisini ve SONUCUNU aynen kullanır (index.html → hesap.hesapla → taban)', () => {
  const g = hesaplaOntanimli(INDEX);
  assert.deepEqual({ ciltTuru: g.ciltTuru, sayfaSayisi: g.sayfaSayisi, formaYaprak: g.formaYaprak, kitapGen: g.kitapGen, kitapYuk: g.kitapYuk, kagitKalinlik: g.kagitKalinlik, mukavvaKalinlik: g.mukavvaKalinlik, tasma: g.tasma, kivirma: g.kivirma, mafsal: g.mafsal },
    { ciltTuru: 'formali', sayfaSayisi: 200, formaYaprak: 4, kitapGen: 148, kitapYuk: 210, kagitKalinlik: 0.1, mukavvaKalinlik: 2, tasma: 3, kivirma: 15, mafsal: 'otomatik' }, 'Hesapla öntanımlıları (index.html)');
  const d = hesaplaDurumu(g);
  const tb = Olcu.tabandan(d);
  assert.equal(tb.uyum, true);
  assert.equal(tb.sonuc, d.sonuc, 'Hesapla formalı + düz: sonuç nesnesi aynen (kopya hesap yok)');
  assert.deepEqual(tb.bes, { formaSayisi: 13, formaYaprak: 4, kitapGen: 148, kitapYuk: 210, kagitKalinlik: 0.1 });
  const o = Olcu.hesapla(tb.bes, tb);
  assert.equal(o.kaynak, 'hesapla');
  assert.equal(o.hesap, d.sonuc);
  assert.deepEqual(karsilastir(o, d.sonuc), []);
  assert.deepEqual([o.sayfa, o.N, o.S, o.Db, o.Dh, o.f], [208, 13, 10.4, 144, 216, 7]);
  // girdi verilmezse de taban kullanılır
  assert.equal(Olcu.hesapla({}, tb).hesap, d.sonuc);
});

// ---------------------------------------------------------------- 2. Örnek Kitap
const TB = { sayfa: 176, forma: 11, yaprak: 88, baski: 44, sirt: 8.8, mafsal: 7, mukavva: [144, 216], serit: [12.8, 216], kaplama: [348.8, 250], forza: [296, 210], mull: [58.8, 198], kapital: 8.8 };
function tbFarki(o) {
  const v = { sayfa: o.sayfa, forma: o.N, yaprak: o.yaprak, baski: o.baskiKagidi, sirt: o.S, mafsal: o.f, mukavva: [o.Db, o.Dh], serit: [o.R, o.Dh],
    kaplama: [o.kaplama.gen, o.kaplama.yuk], forza: [o.forza.gen, o.forza.yuk], mull: [o.mull.gen, o.mull.yuk], kapital: o.kapital };
  return Object.keys(TB).filter((a) => JSON.stringify(v[a]) !== JSON.stringify(TB[a])).map((a) => `${a}: ${JSON.stringify(v[a])} ≠ ${JSON.stringify(TB[a])}`);
}
test('Örnek Kitap birebir: Hesapla\'dan (162 sayfa) ve elle (11 forma × 4 kâğıt) aynı değerler', () => {
  const tbGirdi = { ciltTuru: 'formali', sayfaSayisi: 162, formaYaprak: 4, sonFormaKucult: false, kagitKalinlik: 0.1, forzaPayi: 0, kitapGen: 148, kitapYuk: 210,
    mukavvaKalinlik: 2, tasma: 3, sirtTipi: 'duz', sirtKurali: 'ikiT', mafsal: 'otomatik', kivirma: 15, yedekKagit: 0 };
  const tb = Olcu.tabandan(hesaplaDurumu(tbGirdi));
  const o1 = Olcu.hesapla(tb.bes, tb);
  assert.deepEqual(tbFarki(o1), []);
  assert.equal(o1.hesap.bosSayfa, 14, '176 (14 boş)');
  const o2 = Olcu.hesapla({ formaSayisi: 11, formaYaprak: 4, kitapGen: 148, kitapYuk: 210, kagitKalinlik: 0.1 });
  assert.deepEqual(tbFarki(o2), []);
  // rehberin ek varsayımları (delik, iplik, köşe)
  assert.deepEqual([o2.istasyon.sayi, o2.istasyon.aralik, o2.istasyon.konum[0], o2.istasyon.konum[5]], [6, 36, 15, 195]);
  assert.equal(o2.iplik, 2730); assert.deepEqual(o2.kose, [4, 5]); assert.deepEqual([o2.k, o2.e, o2.t], [3, 15, 2]);
  // denetleyici bozuk değeri yakalar
  assert.ok(tbFarki({ ...o2, S: 8.9 }).length === 1 && tbFarki({ ...o2, Db: 145 }).length === 1);
});

// ---------------------------------------------------------------- 3. bağımsız eşleme, rastgele
test('1000 rastgele girdi (tabansız) ve 500 rastgele girdi (rastgele Hesapla tabanıyla) calc.js ile aynı', () => {
  const rnd = tohum(20261023);
  for (let i = 0; i < 1000; i++) {
    const g = rastgele(rnd), o = Olcu.hesapla(g), r = Hesap.hesapla(eslemeUygula(g));
    assert.deepEqual(o.hesap.girdi, r.girdi, 'hesap girdisi bağımsız eşlemeyle aynı');
    assert.deepEqual(karsilastir(o, r), [], JSON.stringify(g));
  }
  for (let i = 0; i < 500; i++) {
    const ek = { mukavvaKalinlik: [1, 1.5, 2, 2.5, 3][Math.floor(rnd() * 5)], tasma: [0, 2, 3, 4][Math.floor(rnd() * 4)], kivirma: [12, 15, 18][Math.floor(rnd() * 3)],
      mafsal: rnd() < 0.5 ? 'otomatik' : 6 + Math.floor(rnd() * 4), forzaPayi: rnd() < 0.5 ? 0 : 0.4, sirtKurali: rnd() < 0.7 ? 'ikiT' : 'yalnizS', yedekKagit: Math.floor(rnd() * 3) };
    const taban = rastgele(rnd), tb = Olcu.tabandan(hesaplaDurumu(eslemeUygula(taban, ek)));
    assert.ok(tb.girdi, JSON.stringify(taban));
    const g = rastgele(rnd), o = Olcu.hesapla(g, tb);
    const r = Hesap.hesapla(eslemeUygula(g, { ...ek, sirtTipi: 'duz', sonFormaKucult: false }));
    assert.deepEqual(karsilastir(o, r), [], JSON.stringify({ g, ek }));
  }
});

// ---------------------------------------------------------------- 4. taban kuralları
test('taban: elle değişiklik Hesapla girdisini değiştirmez; forma/kâğıt aynıysa Hesapla\'nın sayfa sayısı ve son forma ayarı kalır', () => {
  const hg = { ciltTuru: 'formali', sayfaSayisi: 200, formaYaprak: 4, sonFormaKucult: true, kagitKalinlik: 0.1, kitapGen: 148, kitapYuk: 210, mukavvaKalinlik: 2.5, tasma: 4, kivirma: 18, mafsal: 'otomatik', sirtTipi: 'duz', sirtKurali: 'ikiT' };
  const once = JSON.stringify(hg), d = hesaplaDurumu(hg), tb = Olcu.tabandan(d);
  assert.equal(d.sonuc.toplamSayfa, 200, 'son forma küçük: 12 × 16 + 2 kâğıt × 4');
  const genis = Olcu.hesapla({ ...tb.bes, kitapGen: 160 }, tb);
  assert.equal(genis.kaynak, 'rehber');
  assert.deepEqual([genis.sayfa, genis.N, genis.t, genis.k, genis.e], [200, 13, 2.5, 4, 18], 'yalnız en değişti: sayfa ve son forma Hesapla\'dan');
  assert.equal(genis.hesap.girdi.sonFormaKucult, true);
  const forma = Olcu.hesapla({ ...tb.bes, formaSayisi: 5 }, tb);
  assert.deepEqual([forma.sayfa, forma.N, forma.hesap.girdi.sonFormaKucult, forma.t, forma.k, forma.e], [80, 5, false, 2.5, 4, 18], 'forma değişti: 5 × 16 sayfa, Hesapla\'nın mukavva/taşma/kıvırması');
  assert.equal(JSON.stringify(hg), once, 'Hesapla girdisi değişmedi');
  assert.equal(JSON.stringify(tb.girdi), once, 'taban girdisi değişmedi');
  assert.equal(Olcu.hesapla({ ...tb.bes }, tb).kaynak, 'hesapla', 'aynı değerlere dönünce bağ sürer');
});

test('taban: formalı olmayan ya da yuvarlak sırtlı Hesapla formalı + düz sırtla çizilir (uyum=false); diğer ayarlar aynen', () => {
  const ortak = { sayfaSayisi: 176, formaYaprak: 4, kagitKalinlik: 0.1, kitapGen: 148, kitapYuk: 210, mukavvaKalinlik: 2, tasma: 3, kivirma: 15, mafsal: 'otomatik', sirtKurali: 'ikiT' };
  for (const fark of [{ ciltTuru: 'tek1', sirtTipi: 'duz' }, { ciltTuru: 'tek2', sirtTipi: 'duz' }, { ciltTuru: 'formali', sirtTipi: 'yuvarlak', egriBoyu: 20 }]) {
    const d = hesaplaDurumu({ ...ortak, ...fark }), tb = Olcu.tabandan(d);
    assert.equal(tb.uyum, false, JSON.stringify(fark));
    assert.notEqual(tb.sonuc, d.sonuc);
    assert.deepEqual([tb.girdi.ciltTuru, tb.girdi.sirtTipi, 'egriBoyu' in tb.girdi], ['formali', 'duz', false]);
    assert.deepEqual(tbFarki(Olcu.hesapla(tb.bes, tb)), [], 'formalı + düz: Örnek Kitap değerleri');
  }
});

test('taban: Hesapla hatası ya da rehberin sınırları dışındaki değer taban vermez (kusurlu girdi)', () => {
  assert.ok(Olcu.tabandan(null).hata);
  assert.ok(Olcu.tabandan({ hata: 'Geçersiz sayı', girdi: null, sonuc: null }).hata);
  assert.ok(Olcu.tabandan({}).hata, 'boş durum');
  const cok = Olcu.tabandan(hesaplaDurumu({ ciltTuru: 'formali', sayfaSayisi: 2000, formaYaprak: 4, kitapGen: 148, kitapYuk: 210, kagitKalinlik: 0.1 }));
  assert.deepEqual(cok.alanlar, ['formaSayisi']);
  const dar = Olcu.tabandan(hesaplaDurumu({ ciltTuru: 'formali', sayfaSayisi: 32, formaYaprak: 4, kitapGen: 40, kitapYuk: 500, kagitKalinlik: 0.5 }));
  assert.deepEqual(dar.alanlar, ['kitapGen', 'kitapYuk', 'kagitKalinlik']);
  // taban nesnesi eksikse yok sayılır (öntanımlıya düşer)
  assert.equal(Olcu.hesapla({}, { girdi: null }).N, 11);
});

// ---------------------------------------------------------------- 5. kusurlu girdi
test('kusurlu girdi: geçersiz değerler reddedilir, alan adı bildirilir (tabanlı ve tabansız)', () => {
  const tb = Olcu.tabandan(hesaplaDurumu(hesaplaOntanimli(INDEX)));
  const kotu = [
    [{ formaSayisi: 0 }, 'formaSayisi'], [{ formaSayisi: 41 }, 'formaSayisi'], [{ formaSayisi: 2.5 }, 'formaSayisi'],
    [{ formaYaprak: 9 }, 'formaYaprak'], [{ kitapGen: 59.9 }, 'kitapGen'], [{ kitapYuk: 'abc' }, 'kitapYuk'],
    [{ kagitKalinlik: -0.1 }, 'kagitKalinlik'], [{ kagitKalinlik: '1.200' }, 'kagitKalinlik'], [{ kitapGen: '1,2,3' }, 'kitapGen'],
    [{ kitapYuk: NaN }, 'kitapYuk'], [{ kitapYuk: Infinity }, 'kitapYuk'], [{ formaSayisi: '  ' }, 'formaSayisi'],
  ];
  for (const t of [null, tb]) for (const [g, alan] of kotu) assert.throws(() => Olcu.hesapla(g, t), (e) => e instanceof RangeError && e.alanlar.includes(alan), JSON.stringify(g));
  assert.equal(Olcu.hesapla({ kagitKalinlik: '0,12' }).S, 10.56, 'virgüllü ondalık');
  assert.equal(Olcu.gecersizAlanlar({ formaSayisi: '', formaYaprak: '', kitapGen: '', kitapYuk: '', kagitKalinlik: '' }).length, 5);
});

test('karşılaştırıcı bozuk hesabı yakalar; eşleme bozuk panel kopyası KALDI der (kusurlu girdi sınaması)', () => {
  const rnd = tohum(7);
  const bozuklar = {
    'mafsal +1': (r) => { r.mafsal += 1; },
    'sırt × 1,01': (r) => { r.sirtKalinlik = Math.round(r.sirtKalinlik * 1.01 * 1000) / 1000; },
    'kaplama eni −0,1': (r) => { r.kaplama = { gen: r.kaplama.gen - 0.1, yuk: r.kaplama.yuk }; },
    'forma +1': (r) => { r.formaSayisi += 1; },
  };
  for (const [ad, boz] of Object.entries(bozuklar)) {
    let yakalanan = 0;
    for (let i = 0; i < 50; i++) { const g = rastgele(rnd), r = Hesap.hesapla(eslemeUygula(g)); boz(r); if (karsilastir(Olcu.hesapla(g), r).length) yakalanan++; }
    assert.ok(yakalanan >= 49, `${ad}: ${yakalanan}/50`);
  }
  const kaynak = fs.readFileSync(OLCU_YOLU, 'utf8');
  const kopya = (a, b) => { assert.ok(kaynak.includes(a), 'varyant uygulanamadı: ' + a); const m = { exports: {} };
    new Function('module', 'require', 'self', kaynak.replace(a, b))(m, (ad) => require(path.join(UYGULAMA, 'js', 'learn', ad)), undefined); return m.exports; }; // eslint-disable-line no-new-func
  const varyant = {
    'sayfa = forma × kâğıt × 2': kopya('hg.sayfaSayisi = ayniForma ? tb.girdi.sayfaSayisi : N * y * 4;', 'hg.sayfaSayisi = ayniForma ? tb.girdi.sayfaSayisi : N * y * 2;'),
    'en ↔ boy': kopya('hg.kitapGen = g.kitapGen; hg.kitapYuk = g.kitapYuk;', 'hg.kitapGen = g.kitapYuk; hg.kitapYuk = g.kitapGen;'),
    'kalınlık yuvarlanmış': kopya('hg.kagitKalinlik = g.kagitKalinlik;', 'hg.kagitKalinlik = Math.round(g.kagitKalinlik * 10) / 10;'),
    'taban mukavvası atılmış': kopya('if (tb) Object.keys(tb.girdi).forEach(function (a) { hg[a] = tb.girdi[a]; });', ''),
  };
  const tbGirdi = { mukavvaKalinlik: 3, tasma: 4, kivirma: 18 };
  for (const [ad, O] of Object.entries(varyant)) {
    let kaldi = 0;
    for (let i = 0; i < 50; i++) {
      const tb = O.tabandan(hesaplaDurumu(eslemeUygula(rastgele(rnd), tbGirdi))), g = rastgele(rnd);
      let f; try { f = karsilastir(O.hesapla(g, tb), Hesap.hesapla(eslemeUygula(g, { ...tbGirdi, sirtTipi: 'duz', sonFormaKucult: false }))); } catch (e) { f = ['hata: ' + e.message]; }
      if (f.length) kaldi++;
    }
    assert.ok(kaldi >= 45, `${ad}: ${kaldi}/50 KALDI`);
  }
});

test('Hesapla öntanımlı ayrıştırıcısı kusurlu HTML\'i yakalar (eksik alan)', () => {
  assert.throws(() => hesaplaOntanimli(INDEX.replace('id="h-sayfaSayisi"', 'id="h-yok"')));
  assert.throws(() => hesaplaOntanimli(''));
  assert.equal(hesaplaOntanimli(INDEX.replace(/(id="h-sayfaSayisi"[^>]*\s)value="200"/, '$1value="176"')).sayfaSayisi, 176, 'değer değişince okunan değişir');
});
