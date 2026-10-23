'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../js/eklentiler/epub/dizgi.js');
const H = require('../js/eklentiler/epub/hece.js');
const U = require('./epub-uret.cjs');

// sahte ölçer: karakter başı boy/2 (boy 10 → 5 pt)
const SAHTE = { genislik: (m, stil, boy) => m.length * boy / 2 };
// 100×100 pt sayfa, 10 pt kenar → 80×80 alan; boy 10, satır aralığı 1 → satır 10 pt, sayfada 8 satır
const KUCUK = { sayfaGen: 100, sayfaYuk: 100, kenar: { ust: 10, alt: 10, ic: 10, dis: 10 }, boy: 10, satirAraligi: 1, tireBol: false, sayfaNo: false };
// "aaaa" = 20 pt, boşluk 5 pt → satırda 3 kelime (70 pt); 4. kelime sığmaz (95 pt)
function par(kelime, ek) { return Object.assign({ tur: 'paragraf', hiza: 'iki', girinti: false, parcalar: [{ metin: Array(kelime).fill('aaaa').join(' ') }] }, ek || {}); }

function satirSayilari(r) {
  return r.sayfalar.map((s) => {
    const l = {};
    s.ogeler.filter((o) => o.tur === 'metin' && o.rol !== 'sayfaNo').forEach((o) => { l[o.blok + ':' + o.satir] = 1; });
    return Object.keys(l).length;
  });
}

test('dizgi (a): sahte ölçerle belirlenimci satır/sayfa sayıları', () => {
  assert.deepEqual(satirSayilari(D.diz([par(30)], KUCUK, SAHTE)), [8, 2], '10 satır → 8 + 2');
  assert.deepEqual(satirSayilari(D.diz([par(27)], KUCUK, SAHTE)), [7, 2], '9 satır → 7 + 2 (dul satır kalmaz)');
  assert.deepEqual(satirSayilari(D.diz([par(21), par(15)], KUCUK, SAHTE)), [7, 5], '7 + 5: ikinci paragrafın 1 satırı sayfa sonunda kalmaz (öksüz)');
  assert.deepEqual(satirSayilari(D.diz([par(18), par(9)], KUCUK, SAHTE)), [6, 3], '3 satırlık paragraf bölünmez');
  assert.deepEqual(satirSayilari(D.diz([par(6)], KUCUK, SAHTE)), [2]);
});

test('dizgi: bölüm başı ve sayfa sonu yeni sayfa açar, boş sayfa üretmez; sayfa no bölüm açılışında yok', () => {
  const r = D.diz([{ tur: 'bolumBasi' }, par(3), { tur: 'bolumBasi' }, { tur: 'sayfaSonu' }, par(3), { tur: 'sayfaSonu' }, par(3)], Object.assign({}, KUCUK, { sayfaNo: true }), SAHTE);
  assert.equal(r.sayfalar.length, 3);
  assert.deepEqual(r.sayfalar.map((s) => s.bolumBasi), [true, true, false]);
  const nolar = r.sayfalar.map((s) => s.ogeler.filter((o) => o.rol === 'sayfaNo').map((o) => o.metin));
  assert.deepEqual(nolar, [[], [], ['3']]);
  const no = r.sayfalar[2].ogeler.find((o) => o.rol === 'sayfaNo');
  assert.equal(no.y, 5, 'sayfa numarası alt kenarın ortasında');
  assert.equal(no.x + SAHTE.genislik('3', 'R', 9) / 2, 50, 'yatayda ortada');
});

// gerçekçi Türkçe blok listesi
function turkceBloklar(tohum, bolum, paragraf) {
  const r = U.rastgele(tohum);
  const l = [];
  for (let b = 0; b < bolum; b++) {
    l.push({ tur: 'bolumBasi' });
    l.push({ tur: 'baslik', duzey: 1, parcalar: [{ metin: 'Bölüm ' + (b + 1) }] });
    for (let p = 0; p < paragraf; p++) {
      l.push({ tur: 'paragraf', hiza: 'iki', girinti: true, dil: 'tr', parcalar: [
        { metin: U.paragrafMetni(r, 30 + Math.floor(r() * 120)) + ' ' },
        { metin: 'eğik bir söz', italik: true }, { metin: ' ve ' }, { metin: 'kalın', kalin: true }, { metin: "'ın sonu." }] });
      if (p % 7 === 3) l.push({ tur: 'ayrac' });
    }
  }
  return l;
}
const A5 = { sayfaGen: 419.53, sayfaYuk: 595.28, kenar: { ust: 42.52, alt: 51.02, ic: 42.52, dis: 42.52 }, boy: 10.5, satirAraligi: 1.35, tireBol: true, sayfaNo: true };
const ALAN = { x: 42.52, w: 419.53 - 2 * 42.52, alt: 51.02, ust: 595.28 - 42.52 };

function denetimler(r, bloklar, olcer, etiket) {
  // (b) hiçbir öge metin alanı dışında değil (sayfa numarası alt kenarda, hariç)
  for (const s of r.sayfalar) {
    for (const o of s.ogeler) {
      if (o.rol === 'sayfaNo') continue;
      const w = o.tur === 'resim' ? o.w : olcer.genislik(o.metin, o.stil, o.boy);
      assert.ok(o.x >= ALAN.x - 1e-6 && o.x + w <= ALAN.x + ALAN.w + 0.01, `${etiket}: yatayda alan dışı: ${o.metin} x=${o.x} w=${w}`);
      assert.ok(o.y >= ALAN.alt - 1e-6 && o.y <= ALAN.ust + 1e-6, `${etiket}: dikeyde alan dışı: ${o.metin} y=${o.y}`);
    }
  }
  // satırları topla
  const satir = new Map();
  r.sayfalar.forEach((s, sn) => s.ogeler.filter((o) => o.tur === 'metin' && o.rol !== 'sayfaNo').forEach((o) => {
    const k = o.blok + ':' + o.satir;
    if (!satir.has(k)) satir.set(k, { blok: o.blok, satir: o.satir, sayfa: sn, ogeler: [] });
    satir.get(k).ogeler.push(o);
  }));
  const blokSatirSayisi = {};
  for (const v of satir.values()) blokSatirSayisi[v.blok] = Math.max(blokSatirSayisi[v.blok] || 0, v.satir + 1);
  // (c) iki yana yaslı her satırın (son satır hariç, birden çok kelime) sağ kenarı = alan sağı ± 0,01
  let yasli = 0;
  for (const v of satir.values()) {
    const b = bloklar[v.blok];
    if (b.tur !== 'paragraf' || b.hiza !== 'iki' || v.satir === blokSatirSayisi[v.blok] - 1) continue;
    const kelime = v.ogeler.filter((o) => o.bosluk).length + 1;
    if (kelime < 2) continue;
    const sag = Math.max(...v.ogeler.map((o) => o.x + olcer.genislik(o.metin, o.stil, o.boy)));
    assert.ok(Math.abs(sag - (ALAN.x + ALAN.w)) <= 0.01, `${etiket}: yaslı satır sağ kenarı ${sag} ≠ ${ALAN.x + ALAN.w} (blok ${v.blok} satır ${v.satir})`);
    yasli += 1;
  }
  assert.ok(yasli > 20, `${etiket}: yaslı satır sayısı ${yasli}`);
  // (d) bölünen paragrafın her sayfadaki parçası en az 2 satır (sayfa başında/sonunda tek satır yok)
  const parca = {};
  for (const v of satir.values()) { const k = v.blok + '@' + v.sayfa; parca[k] = (parca[k] || 0) + 1; }
  const blokSayfa = {};
  Object.keys(parca).forEach((k) => { const [b] = k.split('@'); (blokSayfa[b] = blokSayfa[b] || []).push(parca[k]); });
  let bolunen = 0;
  Object.entries(blokSayfa).forEach(([b, l]) => {
    if (l.length < 2) return;
    bolunen += 1;
    assert.ok(l.every((n) => n >= 2), `${etiket}: blok ${b} sayfalara ${JSON.stringify(l)} satır bölünmüş`);
  });
  // (e) her bolumBasi'dan sonraki ilk içerik yeni sayfanın ilk ögesi
  let bolum = 0;
  bloklar.forEach((b, i) => {
    if (b.tur !== 'bolumBasi') return;
    let j = i + 1;
    while (j < bloklar.length && (bloklar[j].tur === 'bolumBasi' || bloklar[j].tur === 'sayfaSonu')) j++;
    if (j >= bloklar.length) return;
    const sn = r.sayfalar.findIndex((s) => s.ogeler.some((o) => o.blok === j));
    assert.ok(sn >= 0, `${etiket}: blok ${j} dizilmemiş`);
    const s = r.sayfalar[sn];
    const ilk = s.ogeler.filter((o) => o.rol !== 'sayfaNo')[0];
    assert.equal(ilk.blok, j, `${etiket}: bölüm başı (blok ${i}) sonrası ilk öge yeni sayfanın başında değil (sayfa ${sn + 1})`);
    assert.equal(s.bolumBasi, true);
    assert.ok(!s.ogeler.some((o) => o.rol === 'sayfaNo'), 'bölüm açılış sayfasında numara yok');
    bolum += 1;
  });
  return { yasli, bolunen, bolum };
}

test('dizgi (b)–(e): Türkçe metinde alan, yaslama, dul/öksüz satır ve bölüm başı (sahte ölçer)', () => {
  const bl = turkceBloklar(1, 4, 25);
  const r = D.diz(bl, A5, SAHTE);
  const d = denetimler(r, bl, SAHTE, 'sahte');
  assert.equal(d.bolum, 4);
  assert.ok(d.bolunen >= 3, 'sayfa sınırında bölünen paragraf var: ' + d.bolunen);
  assert.ok(r.sayfalar.length >= 8);
});

test('dizgi: tire ile bölünen her kelime Türkçe hece noktasından bölünmüş', () => {
  const bl = turkceBloklar(5, 2, 30);
  const r = D.diz(bl, Object.assign({}, A5, { kenar: { ust: 42, alt: 51, ic: 120, dis: 120 } }), SAHTE);
  const metinler = r.sayfalar.flatMap((s) => s.ogeler.filter((o) => o.tur === 'metin' && o.rol !== 'sayfaNo'));
  let bolunmus = 0;
  metinler.forEach((o, i) => {
    if (!/\p{L}-$/u.test(o.metin) || o.bosluk) return;
    const sonraki = metinler[i + 1];
    const tum = o.metin.slice(0, -1) + sonraki.metin;
    const k = o.metin.length - 1;
    assert.ok(H.bolmeNoktalari(tum).includes(k), `"${o.metin}" + "${sonraki.metin}" geçerli hece noktası değil`);
    bolunmus += 1;
  });
  assert.ok(bolunmus > 5, 'dar sütunda tire ile bölünen kelime: ' + bolunmus);
  const kapali = D.diz(bl, Object.assign({}, A5, { tireBol: false, kenar: { ust: 42, alt: 51, ic: 120, dis: 120 } }), SAHTE);
  const tireli = kapali.sayfalar.flatMap((s) => s.ogeler).filter((o) => o.tur === 'metin' && /\p{L}-$/u.test(o.metin));
  assert.equal(tireli.length, 0, 'tire bölme kapalıyken tireli parça yok');
});

test('dizgi: <br> satır kırar ve o satır yaslanmaz; U+00A0 kırılmaz; uzun kelime alanı taşmaz', () => {
  const r = D.diz([{ tur: 'paragraf', hiza: 'iki', parcalar: [{ metin: 'aa bb' }, { kir: true }, { metin: 'cc dd ee ff gg hh ii jj kk ll' }, { metin: ' ' + 'x'.repeat(40) }] }], KUCUK, SAHTE);
  const o = r.sayfalar[0].ogeler;
  assert.equal(o[0].metin, 'aa'); assert.equal(o[1].metin, 'bb');
  assert.equal(o[1].x, 10 + 15, '<br> öncesi satır sola yaslı');
  assert.ok(o.some((e) => e.metin === 'cc dd'), 'U+00A0 ile bağlı kelimeler tek parça');
  for (const e of o) assert.ok(e.x + SAHTE.genislik(e.metin, e.stil, e.boy) <= 90 + 1e-6, 'taşma: ' + e.metin);
});

test('dizgi: resim alana sığdırılır, düşük dpi sayılır; dizAsync aynı sonucu verir', async () => {
  const bl = [par(3), { tur: 'resim', resim: { anahtar: 'r1', pikselGen: 400, pikselYuk: 200 } }, { tur: 'resim', resim: { anahtar: 'r2', pikselGen: 60, pikselYuk: 20 } }, par(3)];
  const r = D.diz(bl, KUCUK, SAHTE);
  const res = r.sayfalar.flatMap((s) => s.ogeler).filter((o) => o.tur === 'resim');
  assert.deepEqual([res[0].w, res[0].h], [80, 40], '400×200 px (300 pt) alana (80 pt) küçültülür → 360 dpi');
  assert.deepEqual([res[1].w, res[1].h], [45, 15], '60×20 px 96 dpi boyutunda kalır (büyütülmez)');
  assert.equal(r.uyarilar.dusukDpi, 1, 'yalnız 96 dpi resim 300 altında');
  const a = await D.dizAsync(turkceBloklar(3, 3, 120), A5, SAHTE);
  assert.deepEqual(a, D.diz(turkceBloklar(3, 3, 120), A5, SAHTE));
});

test('dizgi (f): fontkit + Literata ile gerçek ölçer; Türkçe paragraf dizilir, iki koşu aynı', () => {
  const fontkit = require('../vendor/fontkit/fontkit.umd.min.js');
  const dizin = path.join(__dirname, '..', 'vendor', 'literata');
  const yukle = (ad) => fontkit.create(fs.readFileSync(path.join(dizin, ad)));
  const fontlar = { R: yukle('Literata-Regular.ttf'), I: yukle('Literata-Italic.ttf'), B: yukle('Literata-Bold.ttf'), BI: yukle('Literata-BoldItalic.ttf') };
  const olcer = D.fontkitOlcer(fontlar);
  assert.ok(olcer.genislik('ğüşıöçİ', 'R', 10.5) > 0);
  assert.ok(olcer.genislik('fi', 'R', 10.5) > olcer.genislik('f', 'R', 10.5), 'liga kapalı: fi iki glif');
  const bl = turkceBloklar(9, 2, 20);
  const r1 = D.diz(bl, A5, olcer);
  const r2 = D.diz(turkceBloklar(9, 2, 20), A5, D.fontkitOlcer(fontlar));
  assert.deepEqual(r1, r2, 'belirlenimci');
  const d = denetimler(r1, bl, olcer, 'Literata');
  assert.equal(d.bolum, 2);
  const metin = r1.sayfalar.flatMap((s) => s.ogeler).filter((o) => o.tur === 'metin').map((o) => o.metin).join(' ');
  assert.match(metin, /[ğüşıöçİ]/);
});

// ---- düzeltme testleri ----

test('dizgi O1: girinti alanı aşınca (40 em girinti, 32 em alan) boş satır üretilmez, ≤ 3 sayfa, < 1 s', () => {
  const olcer = { genislik: (t) => [...t].length * 5 };
  const ayar = { sayfaGen: 400, sayfaYuk: 600, kenar: { ust: 40, alt: 40, ic: 40, dis: 40 }, boy: 10, satirAraligi: 1.2, tireBol: true, sayfaNo: true };
  const t0 = Date.now();
  const r = D.diz([{ tur: 'paragraf', hiza: 'iki', girinti: true, solGirinti: 40, dil: 'tr', parcalar: [{ metin: 'bir iki üç' }] }], ayar, olcer);
  const sure = Date.now() - t0;
  assert.ok(r.sayfalar.length <= 3, 'sayfa sayısı ' + r.sayfalar.length);
  assert.ok(sure < 1000, 'süre ' + sure + ' ms');
  const metin = r.sayfalar.flatMap((s) => s.ogeler).filter((o) => o.tur === 'metin' && o.rol !== 'sayfaNo');
  assert.deepEqual(metin.map((o) => o.metin), ['bir', 'iki', 'üç'], 'üç kelime de basılır');
  for (const o of metin) assert.ok(o.x >= 40 - 1e-6 && o.x + olcer.genislik(o.metin) <= 360 + 1e-6, 'alan içinde: ' + o.metin + ' x=' + o.x);
  // satırlar() doğrudan: her satırda en az bir öge (boş satır yok)
  const sl = D.satirlar({ tur: 'paragraf', hiza: 'iki', solGirinti: 30, sagGirinti: 30, parcalar: [{ metin: 'a bb ccc' }] }, 10, 320, ayar, (m) => [...m].length * 5);
  assert.ok(sl.length >= 1 && sl.length <= 3 && sl.every((s) => s.ogeler.length > 0), 'satır sayısı ' + sl.length);
});

// gerçek fontkit + Literata; ölçülen toplam karakter bütçesi aşılırsa hemen hata (karesel yol testi uzun süre kilitlemesin)
function butceliOlcer(n) {
  const fontkit = require('../vendor/fontkit/fontkit.umd.min.js');
  const f = fontkit.create(fs.readFileSync(path.join(__dirname, '..', 'vendor', 'literata', 'Literata-Regular.ttf')));
  const ic = D.fontkitOlcer({ R: f, I: f, B: f, BI: f });
  const o = { sayilan: 0, butce: 30 * n };
  o.genislik = (m, s, boy) => {
    o.sayilan += m.length;
    if (o.sayilan > o.butce) throw new Error(`ölçüm bütçesi aşıldı: ${o.sayilan} karakter (> 30 × ${n})`);
    return ic.genislik(m, s, boy);
  };
  return o;
}
function uzunKelime(n, birim) { return birim.repeat(Math.ceil(n / birim.length)).slice(0, n); }
function base64Kelime(n) {
  const r = U.rastgele(77), a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = ''; for (let i = 0; i < n; i++) s += a[Math.floor(r() * 64)];
  return s;
}

for (const [n, sinir] of [[2000, 500], [10000, 2000]]) {
  test(`dizgi O2: boşluksuz ${n} karakter, gerçek Literata < ${sinir} ms, metin korunur, ölçüm doğrusal`, () => {
    for (const metin of [uzunKelime(n, '?'), uzunKelime(n, 'kitapsayfacilt'), base64Kelime(n)]) {
      const olcer = butceliOlcer(n);
      const t0 = Date.now();
      const r = D.diz([{ tur: 'paragraf', hiza: 'iki', girinti: false, dil: 'tr', parcalar: [{ metin }] }], A5, olcer);
      const sure = Date.now() - t0;
      const ogeler = r.sayfalar.flatMap((s) => s.ogeler).filter((o) => o.tur === 'metin' && o.rol !== 'sayfaNo');
      assert.equal(ogeler.map((o) => o.metin.replace(/-$/, '')).join(''), metin, 'metin eksiksiz');
      for (const o of ogeler) assert.ok(o.x + olcer.genislik(o.metin, o.stil, o.boy) <= ALAN.x + ALAN.w + 0.01, 'taşma');
      assert.ok(sure < sinir, `${metin.slice(0, 12)}…: ${sure} ms`);
    }
  });
}

test('dizgi O2: ölçüm önbelleği sınırlı (uzun metin saklanmaz, kısa metinde üst sınır)', () => {
  let cagri = 0;
  const olc = D.onbellekliOlcer({ genislik: (m) => { cagri++; return m.length; } });
  for (let i = 0; i < 25000; i++) olc('k' + i, 'R', 10);
  assert.ok(olc.boyut() <= 20000, 'önbellek ' + olc.boyut());
  olc('x'.repeat(500), 'R', 10); olc('x'.repeat(500), 'R', 10);
  const once = cagri;
  olc('kısa', 'R', 10); olc('kısa', 'R', 10);
  assert.equal(cagri - once, 1, 'kısa metin önbellekten');
});

test('dizgi D3: ayraç boş sayfaya sığmasa da araya boş sayfa eklenmez (boy 24, satır aralığı 3, alan 56,7 pt)', () => {
  const ayar = { sayfaGen: 300, sayfaYuk: 56.7 + 20, kenar: { ust: 10, alt: 10, ic: 20, dis: 20 }, boy: 24, satirAraligi: 3, tireBol: false, sayfaNo: false };
  const r = D.diz([{ tur: 'ayrac' }, par(1), { tur: 'ayrac' }, { tur: 'ayrac' }], ayar, SAHTE);
  const bos = r.sayfalar.filter((s) => s.ogeler.length === 0).length;
  assert.equal(bos, 0, 'boş sayfa: ' + bos + ' / ' + r.sayfalar.length);
  assert.equal(r.sayfalar.flatMap((s) => s.ogeler).filter((o) => o.metin === '* * *').length, 3);
});

test('dizgi D-1: tireli kelimede de hece noktaları üretilir; her bölme hecede ve tireli', () => {
  const ayar = { tireBol: true, satirAraligi: 1, sayfaNo: false };
  const sl = D.satirlar({ tur: 'paragraf', hiza: 'sol', dil: 'tr', parcalar: [{ metin: 'Türk-Amerikanlaştırılamayanlardan bir söz' }] }, 10, 80, ayar, (m) => [...m].length * 5);
  const metinler = sl.map((s) => s.ogeler.map((o) => o.metin).join('').replace(/\s+/g, ' ').trim());
  const bitis = metinler.slice(0, -1);
  assert.ok(bitis.every((m) => /-$/.test(m)), 'son satır dışında her satır tire ile biter: ' + JSON.stringify(metinler));
  assert.equal(metinler.join('').replace(/-/g, '').replace(/ /g, ''), 'TürkAmerikanlaştırılamayanlardanbirsöz'.replace(/-/g, ''), 'harf kaybı yok: ' + JSON.stringify(metinler));
  assert.ok(metinler.length >= 3 && metinler.length <= 5, JSON.stringify(metinler));
  // hece noktaları: hiçbir satır, hece dışı bir yerde tiresiz kesilmemiş olmalı
  const H2 = require('../js/eklentiler/epub/hece.js');
  const kelime = 'Amerikanlaştırılamayanlardan';
  const nok = H2.bolmeNoktalari(kelime);
  const parcalar = metinler.join(' ').replace(/ /g, '').split('-');
  let say = 0;
  parcalar.forEach((p) => { const k = kelime.indexOf(p); if (k > 0 && p.length > 3) { say += nok.includes(k) || nok.includes(k + p.length) ? 0 : 1; } });
  assert.equal(say, 0, 'bölmeler hece noktasında: ' + JSON.stringify(metinler));
});
