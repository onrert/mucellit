'use strict';
// yazdırma akışları (app/js/yazdirma.js) sahte platformla — tek PDF, iki PDF (önler → çevir onayı → arkalar),
// her aşamada vazgeç/hata; Önizleme'de Aç ve açılamazsa seçenek E (Kaydet + not). Metinler gerçek sözlükten (tr ve en).
const test = require('node:test');
const assert = require('node:assert/strict');
const Dil = require('../js/dil.js');
const Y = require('../js/yazdirma.js');

const t = (a, p) => Dil.t(a, p);
const TEK = [{ ad: 'kitap-dizilmis.pdf', bytes: new Uint8Array([1, 2, 3]), yuz: 24 }];
const IKI = [{ ad: 'kitap-onler.pdf', bytes: new Uint8Array([1]), yuz: 12 }, { ad: 'kitap-arkalar.pdf', bytes: new Uint8Array([2]), yuz: 12 }];

/** Sahte platform: yazdir yanıtları sırayla (true/false ya da Error = red), onayla yanıtları sırayla. */
function sahte({ yaz = [], onay = [], onizleme = [], kaydet = null } = {}) {
  const P = { cagri: [], onaylar: [] };
  P.yazdir = (ad, bytes) => {
    P.cagri.push(['yazdir', ad, bytes.length]);
    const y = yaz.shift();
    return y instanceof Error ? Promise.reject(y) : Promise.resolve(y);
  };
  P.onayla = (m) => { P.onaylar.push(m); const o = onay.shift(); return o instanceof Error ? Promise.reject(o) : Promise.resolve(o === true); };
  P.onizlemedeAc = (ad) => {
    P.cagri.push(['onizleme', ad]);
    const o = onizleme.shift();
    return o instanceof Error ? Promise.reject(o) : Promise.resolve({ ad });
  };
  if (kaydet) {
    P.hepsiniKaydet = (l) => { P.cagri.push(['kaydet', l.map((d) => d.ad)]); return Promise.resolve(kaydet); };
    P.kayitMesaji = (s) => ({ metin: s.kaydedilen.length ? 'Kaydedildi: ' + s.kaydedilen.map((k) => k.yol).join(', ') + '.' : 'Kaydedilmedi.', tur: s.vazgecilen.length ? 'hata' : undefined });
  }
  return P;
}
const ortam = (P) => ({ platform: P, t });

test('tek PDF: yazdırıldı → "gönderildi"; vazgeçildi → "Yazdırılmadı" (hata); Rust hatası (Apple dışı dahil) → "yazdırılamadı"', async () => {
  Dil.ayarla('tr');
  let P = sahte({ yaz: [true] });
  assert.deepEqual(await Y.yazdir(TEK, ortam(P)), { metin: 'Yazıcıya gönderildi: kitap-dizilmis.pdf.' });
  assert.deepEqual(P.cagri, [['yazdir', 'kitap-dizilmis.pdf', 3]]);
  assert.deepEqual(P.onaylar, [], 'tek PDF\'te çevir onayı yok');
  P = sahte({ yaz: [false] });
  assert.deepEqual(await Y.yazdir(TEK, ortam(P)), { metin: 'Yazdırılmadı (baskı penceresinden vazgeçildi).', tur: 'hata' });
  P = sahte({ yaz: [new Error(Dil.t('rust.yazdirma_yok'))] });
  assert.deepEqual(await Y.yazdir(TEK, ortam(P)), { metin: 'kitap-dizilmis.pdf yazdırılamadı: bu platformda yazdırma henüz yok', tur: 'hata' });
  // platform.yazdir yoksa (tarayıcı) reddedilmez, anlaşılır metin
  assert.equal((await Y.yazdir(TEK, ortam({}))).tur, 'hata');
});

test('iki PDF: önler → "desteyi çevirip geri koyun" onayı → arkalar; hepsi tamam → iki dosya gönderildi', async () => {
  Dil.ayarla('tr');
  const P = sahte({ yaz: [true, true], onay: [true] });
  assert.deepEqual(await Y.yazdir(IKI, ortam(P)), { metin: 'Yazıcıya gönderildi: kitap-onler.pdf ve kitap-arkalar.pdf.' });
  assert.deepEqual(P.cagri.map((c) => c[1]), ['kitap-onler.pdf', 'kitap-arkalar.pdf'], 'önce önler, sonra arkalar');
  assert.equal(P.onaylar.length, 1);
  assert.match(P.onaylar[0], /^Önler \(kitap-onler\.pdf\) yazıcıya gönderildi\. .*desteyi .*çevirip .*geri koyun.*Tamam/);
});

test('iki PDF: yarıda kalma doğru bildirilir (önlerde vazgeç / çevir onayında vazgeç / arkalarda vazgeç / hata)', async () => {
  Dil.ayarla('tr');
  // önlerde vazgeç: hiçbir şey basılmadı, onay sorulmaz, arkalar denenmez
  let P = sahte({ yaz: [false] });
  assert.deepEqual(await Y.yazdir(IKI, ortam(P)), { metin: 'Yazdırılmadı (baskı penceresinden vazgeçildi).', tur: 'hata' });
  assert.deepEqual([P.cagri.length, P.onaylar.length], [1, 0]);
  // çevir onayında vazgeç
  P = sahte({ yaz: [true], onay: [false] });
  const yarida = 'Yalnız önler yazıcıya gönderildi (kitap-onler.pdf); arkalar (kitap-arkalar.pdf) basılmadı (vazgeçildi).';
  assert.deepEqual(await Y.yazdir(IKI, ortam(P)), { metin: yarida, tur: 'hata' });
  assert.deepEqual([P.cagri.length, P.onaylar.length], [1, 1]);
  // arkaların baskı penceresinde vazgeç
  P = sahte({ yaz: [true, false], onay: [true] });
  assert.deepEqual(await Y.yazdir(IKI, ortam(P)), { metin: yarida, tur: 'hata' });
  assert.equal(P.cagri.length, 2);
  // arkalarda hata
  P = sahte({ yaz: [true, new Error('bir baskı penceresi zaten açık')], onay: [true] });
  assert.deepEqual(await Y.yazdir(IKI, ortam(P)), { metin: 'Yalnız önler yazıcıya gönderildi (kitap-onler.pdf); kitap-arkalar.pdf yazdırılamadı: bir baskı penceresi zaten açık', tur: 'hata' });
  // önlerde hata
  P = sahte({ yaz: [new Error('x')] });
  assert.deepEqual(await Y.yazdir(IKI, ortam(P)), { metin: 'kitap-onler.pdf yazdırılamadı: x', tur: 'hata' });
  // onay penceresi hata atarsa (arkalar basılmadı)
  P = sahte({ yaz: [true], onay: [new Error('pencere yok')] });
  const r = await Y.yazdir(IKI, ortam(P));
  assert.equal(r.tur, 'hata');
  assert.match(r.metin, /^Yalnız önler yazıcıya gönderildi \(kitap-onler\.pdf\); kitap-arkalar\.pdf yazdırılamadı: pencere yok$/);
  assert.equal(P.cagri.length, 1);
});

test('İngilizce metinler ve baskı öncesi not (çift yüz = araçtaki seçim; ölçek %100; "Sığdır" seçmeyin)', async () => {
  Dil.ayarla('en');
  try {
    const P = sahte({ yaz: [true], onay: [false] });
    assert.deepEqual(await Y.yazdir(IKI, ortam(P)), { metin: "Only the fronts were sent to the printer (kitap-onler.pdf); the backs (kitap-arkalar.pdf) weren't printed (canceled).", tur: 'hata' });
    assert.match(P.onaylar[0], /turn the stack over/);
    // not araçtaki seçim değerini alır, seçeneği baskı penceresinin adıyla söyler
    assert.equal(Y.not({ t }, false, 'kisa'), 'In the print dialog: set Double-sided to “On (Short Edge)” (the same as “Flip on short edge” here; in Layout: Two-Sided → “Short-Edge Binding”), keep Scale at 100% and don\'t choose “Scale to fit paper size”.');
    assert.match(Y.not({ t }, true, 'kisa'), /Double-sided → “Off”/);
  } finally { Dil.ayarla('tr'); }
  assert.equal(Y.not({ t }, false, 'kisa'), 'Baskı penceresinde: Çift Taraflı → “Açık (Kısa Kenar)” seçin (buradaki “Kısa kenardan çevir” ile aynı; Düzen bölümünde: Çift Taraflı → “Kısa Kenardan Ciltli”), ölçeği %100 bırakın, “Kâğıt boyutuna sığdır”ı seçmeyin.');
  assert.match(Y.not({ t }, true, 'kisa'), /Çift Taraflı → “Kapalı” .*%100.*sığdır/);
});

test('Önizleme\'de Aç: her dosya sırayla açılır; açılamazsa (sandbox) seçenek E — Kaydet + "Önizleme\'de basın" notu ya da hata', async () => {
  Dil.ayarla('tr');
  let P = sahte({ onizleme: [true, true] });
  assert.deepEqual(await Y.onizlemedeAc(IKI, ortam(P)), { metin: "Önizleme'de açıldı: kitap-onler.pdf ve kitap-arkalar.pdf. Önizleme'den “Gerçek Boyut” (%100) ile basın." });
  assert.deepEqual(P.cagri, [['onizleme', 'kitap-onler.pdf'], ['onizleme', 'kitap-arkalar.pdf']]);
  // açılamadı → onay evet → Kaydet penceresi → kaydedildi + not
  P = sahte({ onizleme: [new Error('izin yok')], onay: [true], kaydet: { kaydedilen: [{ ad: 'kitap-dizilmis.pdf', yol: '/Users/x/kitap-dizilmis.pdf' }], vazgecilen: [], hatali: [] } });
  let r = await Y.onizlemedeAc(TEK, ortam(P));
  assert.deepEqual(r, { metin: "Kaydedildi: /Users/x/kitap-dizilmis.pdf. Önizleme'de açıp “Gerçek Boyut” (%100) ile basın.", tur: undefined });
  assert.match(P.onaylar[0], /^Önizleme PDF'i açamadı \(izin yok\)\. Bunun yerine PDF kaydedilsin mi\?/);
  assert.deepEqual(P.cagri.map((c) => c[0]), ['onizleme', 'kaydet']);
  // açılamadı → Kaydet penceresinde vazgeç: not eklenmez
  P = sahte({ onizleme: [new Error('izin yok')], onay: [true], kaydet: { kaydedilen: [], vazgecilen: ['kitap-dizilmis.pdf'], hatali: [] } });
  r = await Y.onizlemedeAc(TEK, ortam(P));
  assert.deepEqual(r, { metin: 'Kaydedilmedi.', tur: 'hata' });
  // açılamadı → onay hayır → hata metni
  P = sahte({ onizleme: [new Error('izin yok')], onay: [false], kaydet: { kaydedilen: [], vazgecilen: [], hatali: [] } });
  assert.deepEqual(await Y.onizlemedeAc(TEK, ortam(P)), { metin: "Önizleme PDF'i açamadı: izin yok", tur: 'hata' });
  assert.equal(P.cagri.filter((c) => c[0] === 'kaydet').length, 0);
  // ikincisi açılamadı: birincisi açık kalır, E sorulur
  P = sahte({ onizleme: [true, new Error('y')], onay: [false] });
  assert.deepEqual(await Y.onizlemedeAc(IKI, ortam(P)), { metin: "Önizleme PDF'i açamadı: y", tur: 'hata' });
  assert.equal(P.cagri.length, 2);
  // platform.onizlemedeAc yoksa
  assert.equal((await Y.onizlemedeAc(TEK, ortam({}))).tur, 'hata');
});

// baskı notundaki çift yüz terimi macOS baskı penceresinin kendi adıyla. Ana penceredeki açılır
// menü (PrintingUI PMDuplex: "Double-sided" → Off / On / On (Short Edge); tr "Çift Taraflı" → Kapalı / Açık /
// Açık (Kısa Kenar)) ve Düzen bölümü (PrintingCocoaPDEs: "Two-Sided" → Long-Edge / Short-Edge Binding; tr Uzun/Kısa
// Kenardan Ciltli). Not araçtaki seçimi (kisa/uzun) bu adlara çevirir; araçtaki "Kısa kenardan çevir" adı pencerede yok.
const fs = require('node:fs');
const PRINTING = '/System/Library/PrivateFrameworks/PrintingPrivate.framework/Versions/A/Plugins';
const loctable = (yol) => JSON.parse(require('node:child_process').execFileSync('plutil', ['-convert', 'json', '-o', '-', yol]).toString());
const PANEL_ANAHTARLARI = { 'yazdir.panel.cift': ['hCn-CU-yI5.title', 'Two-Sided'], 'yazdir.panel.kapali': ['VfQ-Ti-J6u.title'], 'yazdir.panel.uzun': ['Ugn-qd-042.title', 'Long-Edge Binding'], 'yazdir.panel.kisa': ['jfS-0y-BUO.title', 'Short-Edge Binding'] };

test('baskı notu macOS baskı penceresinin terimleriyle (araçtaki seçim → pencerede seçenek adı), iki dilde', () => {
  const sozluk = { en: Dil.sozluk('en'), tr: Dil.sozluk('tr') };
  const duplex = PRINTING + '/PrintingUI.bundle/Contents/Resources/PMDuplex.loctable', duzen = PRINTING + '/PrintingCocoaPDEs.bundle/Contents/Resources/Localizable.loctable';
  const nib = PRINTING + '/PrintingUI.bundle/Contents/Resources/Base.lproj/PMDuplex.nib';
  if (process.platform === 'darwin' && fs.existsSync(duplex) && fs.existsSync(duzen)) {
    const d = loctable(duplex), l = loctable(duzen);
    const panel = { tr: d.tr, en: d.en_GB }; // Base (en) nib'in dizgileri en_GB ile aynı (aşağıda nib'de aranır)
    const nibMetni = fs.readFileSync(nib).toString('latin1');
    for (const kod of ['en', 'tr']) {
      for (const [a, [k, duzenK]] of Object.entries(PANEL_ANAHTARLARI)) {
        assert.equal(sozluk[kod][a], panel[kod][k], `${kod} ${a} (PMDuplex ${k})`);
        if (duzenK) assert.equal(sozluk[kod][a + '_duzen'], l[kod][duzenK], `${kod} ${a}_duzen (Düzen: ${duzenK})`);
      }
    }
    for (const k of Object.values(PANEL_ANAHTARLARI)) assert.ok(nibMetni.includes(panel.en[k[0]]) || ['On', 'Off'].includes(panel.en[k[0]]), `Base nib: ${panel.en[k[0]]}`);
  }
  // not: araçtaki seçim değeri (kisa/uzun) → pencere adları; araç adı da (aynı seçim olduğu görünsün)
  for (const kod of ['tr', 'en']) {
    Dil.ayarla(kod);
    try {
      const kisa = Y.not({ t }, false, 'kisa'), uzun = Y.not({ t }, false, 'uzun'), iki = Y.not({ t }, true, 'kisa');
      assert.ok(kisa.includes('“' + t('yazdir.panel.kisa') + '”') && kisa.includes('“' + t('yazdir.panel.kisa_duzen') + '”') && kisa.includes(t('yazdir.panel.cift')), `${kod} kısa: ${kisa}`);
      assert.ok(kisa.includes(t('duzenle.cevirme.kisa')), `${kod} kısa: araçtaki ad`);
      assert.ok(uzun.includes('“' + t('yazdir.panel.uzun') + '”') && uzun.includes('“' + t('yazdir.panel.uzun_duzen') + '”') && !uzun.includes(t('yazdir.panel.kisa')), `${kod} uzun: ${uzun}`);
      assert.ok(iki.includes('“' + t('yazdir.panel.kapali') + '”') && /100/.test(iki), `${kod} iki PDF: ${iki}`);
      // pencerede olmayan ad seçenek olarak söylenmez (eski not: “Kısa kenardan çevir” olarak seçin)
      assert.ok(!kisa.includes('“' + t('duzenle.cevirme.kisa') + '” ' + (kod === 'tr' ? 'olarak' : '(')), `${kod}: ${kisa}`);
      assert.match(kisa, /100/);
    } finally { Dil.ayarla('tr'); }
  }
});
