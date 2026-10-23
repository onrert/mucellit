'use strict';
// yazdırma akışları (app/js/printing.js) sahte platformla — tek PDF, iki PDF (önler → çevir onayı → arkalar),
// her aşamada vazgeç/hata; Önizleme'de Aç ve açılamazsa seçenek E (Kaydet + not). Metinler gerçek sözlükten (tr ve en).
const test = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('../js/i18n.js');
const Y = require('../js/printing.js');

const t = (a, p) => I18n.t(a, p);
const SINGLE = [{ name: 'kitap-dizilmis.pdf', bytes: new Uint8Array([1, 2, 3]), side: 24 }];
const IKI = [{ name: 'kitap-onler.pdf', bytes: new Uint8Array([1]), side: 12 }, { name: 'kitap-arkalar.pdf', bytes: new Uint8Array([2]), side: 12 }];

/** Sahte platform: yazdir yanıtları sırayla (true/false ya da Error = red), onayla yanıtları sırayla. */
function fake({ write = [], confirmation = [], preview = [], save = null } = {}) {
  const P = { call: [], confirms: [] };
  P.print = (name, bytes) => {
    P.call.push(['print', name, bytes.length]);
    const y = write.shift();
    return y instanceof Error ? Promise.reject(y) : Promise.resolve(y);
  };
  P.ask = (m) => { P.confirms.push(m); const o = confirmation.shift(); return o instanceof Error ? Promise.reject(o) : Promise.resolve(o === true); };
  P.openInPreview = (name) => {
    P.call.push(['preview', name]);
    const o = preview.shift();
    return o instanceof Error ? Promise.reject(o) : Promise.resolve({ name });
  };
  if (save) {
    P.saveAll = (l) => { P.call.push(['save', l.map((d) => d.name)]); return Promise.resolve(save); };
    P.saveMessage = (s) => ({ text: s.saved.length ? 'Kaydedildi: ' + s.saved.map((k) => k.path).join(', ') + '.' : 'NotSaved.', kind: s.cancelled.length ? 'error' : undefined });
  }
  return P;
}
const env = (P) => ({ platform: P, t });

test('tek PDF: yazdırıldı → "gönderildi"; vazgeçildi → "Yazdırılmadı" (hata); Rust hatası (Apple dışı dahil) → "yazdırılamadı"', async () => {
  I18n.set('tr');
  let P = fake({ write: [true] });
  assert.deepEqual(await Y.print(SINGLE, env(P)), { text: 'Yazıcıya gönderildi: kitap-dizilmis.pdf.' });
  assert.deepEqual(P.call, [['print', 'kitap-dizilmis.pdf', 3]]);
  assert.deepEqual(P.confirms, [], 'tek PDF\'te çevir onayı yok');
  P = fake({ write: [false] });
  assert.deepEqual(await Y.print(SINGLE, env(P)), { text: 'Yazdırılmadı (baskı penceresinden vazgeçildi).', kind: 'error' });
  P = fake({ write: [new Error(I18n.t('rust.no_printing'))] });
  assert.deepEqual(await Y.print(SINGLE, env(P)), { text: 'kitap-dizilmis.pdf yazdırılamadı: bu platformda yazdırma henüz yok', kind: 'error' });
  // platform.yazdir yoksa (tarayıcı) reddedilmez, anlaşılır metin
  assert.equal((await Y.print(SINGLE, env({}))).kind, 'error');
});

test('iki PDF: önler → "desteyi çevirip geri koyun" onayı → arkalar; hepsi tamam → iki dosya gönderildi', async () => {
  I18n.set('tr');
  const P = fake({ write: [true, true], confirmation: [true] });
  assert.deepEqual(await Y.print(IKI, env(P)), { text: 'Yazıcıya gönderildi: kitap-onler.pdf ve kitap-arkalar.pdf.' });
  assert.deepEqual(P.call.map((c) => c[1]), ['kitap-onler.pdf', 'kitap-arkalar.pdf'], 'önce önler, sonra arkalar');
  assert.equal(P.confirms.length, 1);
  assert.match(P.confirms[0], /^Önler \(kitap-onler\.pdf\) yazıcıya gönderildi\. .*desteyi .*çevirip .*geri koyun.*Tamam/);
});

test('iki PDF: yarıda kalma doğru bildirilir (önlerde vazgeç / çevir onayında vazgeç / arkalarda vazgeç / hata)', async () => {
  I18n.set('tr');
  // önlerde vazgeç: hiçbir şey basılmadı, onay sorulmaz, arkalar denenmez
  let P = fake({ write: [false] });
  assert.deepEqual(await Y.print(IKI, env(P)), { text: 'Yazdırılmadı (baskı penceresinden vazgeçildi).', kind: 'error' });
  assert.deepEqual([P.call.length, P.confirms.length], [1, 0]);
  // çevir onayında vazgeç
  P = fake({ write: [true], confirmation: [false] });
  const halfway = 'Yalnız önler yazıcıya gönderildi (kitap-onler.pdf); arkalar (kitap-arkalar.pdf) basılmadı (vazgeçildi).';
  assert.deepEqual(await Y.print(IKI, env(P)), { text: halfway, kind: 'error' });
  assert.deepEqual([P.call.length, P.confirms.length], [1, 1]);
  // arkaların baskı penceresinde vazgeç
  P = fake({ write: [true, false], confirmation: [true] });
  assert.deepEqual(await Y.print(IKI, env(P)), { text: halfway, kind: 'error' });
  assert.equal(P.call.length, 2);
  // arkalarda hata
  P = fake({ write: [true, new Error('bir baskı penceresi zaten açık')], confirmation: [true] });
  assert.deepEqual(await Y.print(IKI, env(P)), { text: 'Yalnız önler yazıcıya gönderildi (kitap-onler.pdf); kitap-arkalar.pdf yazdırılamadı: bir baskı penceresi zaten açık', kind: 'error' });
  // önlerde hata
  P = fake({ write: [new Error('x')] });
  assert.deepEqual(await Y.print(IKI, env(P)), { text: 'kitap-onler.pdf yazdırılamadı: x', kind: 'error' });
  // onay penceresi hata atarsa (arkalar basılmadı)
  P = fake({ write: [true], confirmation: [new Error('pencere yok')] });
  const r = await Y.print(IKI, env(P));
  assert.equal(r.kind, 'error');
  assert.match(r.text, /^Yalnız önler yazıcıya gönderildi \(kitap-onler\.pdf\); kitap-arkalar\.pdf yazdırılamadı: pencere yok$/);
  assert.equal(P.call.length, 1);
});

test('İngilizce texts ve baskı öncesi note (çift yüz = araçtaki seçim; ölçek %100; "Sığdır" seçmeyin)', async () => {
  I18n.set('en');
  try {
    const P = fake({ write: [true], confirmation: [false] });
    assert.deepEqual(await Y.print(IKI, env(P)), { text: "Only the fronts were sent to the printer (kitap-onler.pdf); the backs (kitap-arkalar.pdf) weren't printed (canceled).", kind: 'error' });
    assert.match(P.confirms[0], /turn the stack over/);
    // not araçtaki seçim değerini alır, seçeneği baskı penceresinin adıyla söyler
    assert.equal(Y.note({ t }, false, 'short'), 'In the print dialog: set Double-sided to “On (Short Edge)” (the same as “Flip on short edge” here; in Layout: Two-Sided → “Short-Edge Binding”), keep Scale at 100% and don\'t choose “Scale to fit paper size”.');
    assert.match(Y.note({ t }, true, 'short'), /Double-sided → “Off”/);
  } finally { I18n.set('tr'); }
  assert.equal(Y.note({ t }, false, 'short'), 'Baskı penceresinde: Çift Taraflı → “Açık (Kısa Kenar)” seçin (buradaki “Kısa kenardan çevir” ile aynı; Düzen bölümünde: Çift Taraflı → “Kısa Kenardan Ciltli”), ölçeği %100 bırakın, “Kâğıt boyutuna sığdır”ı seçmeyin.');
  assert.match(Y.note({ t }, true, 'short'), /Çift Taraflı → “Kapalı” .*%100.*sığdır/);
});

test('Önizleme\'de Aç: her dosya sırayla açılır; açılamazsa (sandbox) seçenek E — Kaydet + "Önizleme\'de basın" notu ya da hata', async () => {
  I18n.set('tr');
  let P = fake({ preview: [true, true] });
  assert.deepEqual(await Y.openInPreview(IKI, env(P)), { text: "Önizleme'de açıldı: kitap-onler.pdf ve kitap-arkalar.pdf. Önizleme'den “Gerçek Boyut” (%100) ile basın." });
  assert.deepEqual(P.call, [['preview', 'kitap-onler.pdf'], ['preview', 'kitap-arkalar.pdf']]);
  // açılamadı → onay evet → Kaydet penceresi → kaydedildi + not
  P = fake({ preview: [new Error('izin yok')], confirmation: [true], save: { saved: [{ name: 'kitap-dizilmis.pdf', path: '/Users/x/kitap-dizilmis.pdf' }], cancelled: [], failed: [] } });
  let r = await Y.openInPreview(SINGLE, env(P));
  assert.deepEqual(r, { text: "Kaydedildi: /Users/x/kitap-dizilmis.pdf. Önizleme'de açıp “Gerçek Boyut” (%100) ile basın.", kind: undefined });
  assert.match(P.confirms[0], /^Önizleme PDF'i açamadı \(izin yok\)\. Bunun yerine PDF kaydedilsin mi\?/);
  assert.deepEqual(P.call.map((c) => c[0]), ['preview', 'save']);
  // açılamadı → Kaydet penceresinde vazgeç: not eklenmez
  P = fake({ preview: [new Error('izin yok')], confirmation: [true], save: { saved: [], cancelled: ['kitap-dizilmis.pdf'], failed: [] } });
  r = await Y.openInPreview(SINGLE, env(P));
  assert.deepEqual(r, { text: 'NotSaved.', kind: 'error' });
  // açılamadı → onay hayır → hata metni
  P = fake({ preview: [new Error('izin yok')], confirmation: [false], save: { saved: [], cancelled: [], failed: [] } });
  assert.deepEqual(await Y.openInPreview(SINGLE, env(P)), { text: "Önizleme PDF'i açamadı: izin yok", kind: 'error' });
  assert.equal(P.call.filter((c) => c[0] === 'save').length, 0);
  // ikincisi açılamadı: birincisi açık kalır, E sorulur
  P = fake({ preview: [true, new Error('y')], confirmation: [false] });
  assert.deepEqual(await Y.openInPreview(IKI, env(P)), { text: "Önizleme PDF'i açamadı: y", kind: 'error' });
  assert.equal(P.call.length, 2);
  // platform.onizlemedeAc yoksa
  assert.equal((await Y.openInPreview(SINGLE, env({}))).kind, 'error');
});

// baskı notundaki çift yüz terimi macOS baskı penceresinin kendi adıyla. Ana penceredeki açılır
// menü (PrintingUI PMDuplex: "Double-sided" → Off / On / On (Short Edge); tr "Çift Taraflı" → Kapalı / Açık /
// Açık (Kısa Kenar)) ve Düzen bölümü (PrintingCocoaPDEs: "Two-Sided" → Long-Edge / Short-Edge Binding; tr Uzun/Kısa
// Kenardan Ciltli). Not araçtaki seçimi (kisa/uzun) bu adlara çevirir; araçtaki "Kısa kenardan çevir" adı pencerede yok.
const fs = require('node:fs');
const PRINTING = '/System/Library/PrivateFrameworks/PrintingPrivate.framework/Versions/A/Plugins';
const loctable = (path) => JSON.parse(require('node:child_process').execFileSync('plutil', ['-convert', 'json', '-o', '-', path]).toString());
const PANEL_KEYS = { 'print.panel.double': ['hCn-CU-yI5.title', 'Two-Sided'], 'print.panel.closed': ['VfQ-Ti-J6u.title'], 'print.panel.long': ['Ugn-qd-042.title', 'Long-Edge Binding'], 'print.panel.short': ['jfS-0y-BUO.title', 'Short-Edge Binding'] };

test('baskı notu macOS baskı penceresinin terimleriyle (araçtaki seçim → pencerede seçenek adı), iki dilde', () => {
  const dictionary = { en: I18n.dictionary('en'), tr: I18n.dictionary('tr') };
  const duplex = PRINTING + '/PrintingUI.bundle/Contents/Resources/PMDuplex.loctable', layout = PRINTING + '/PrintingCocoaPDEs.bundle/Contents/Resources/Localizable.loctable';
  const nib = PRINTING + '/PrintingUI.bundle/Contents/Resources/Base.lproj/PMDuplex.nib';
  if (process.platform === 'darwin' && fs.existsSync(duplex) && fs.existsSync(layout)) {
    const d = loctable(duplex), l = loctable(layout);
    const panel = { tr: d.tr, en: d.en_GB }; // Base (en) nib'in dizgileri en_GB ile aynı (aşağıda nib'de aranır)
    const nibText = fs.readFileSync(nib).toString('latin1');
    for (const code of ['en', 'tr']) {
      for (const [a, [k, layoutK]] of Object.entries(PANEL_KEYS)) {
        assert.equal(dictionary[code][a], panel[code][k], `${code} ${a} (PMDuplex ${k})`);
        if (layoutK) assert.equal(dictionary[code][a + '_layout'], l[code][layoutK], `${code} ${a}_layout (Düzen: ${layoutK})`);
      }
    }
    for (const k of Object.values(PANEL_KEYS)) assert.ok(nibText.includes(panel.en[k[0]]) || ['On', 'Off'].includes(panel.en[k[0]]), `Base nib: ${panel.en[k[0]]}`);
  }
  // not: araçtaki seçim değeri (kisa/uzun) → pencere adları; araç adı da (aynı seçim olduğu görünsün)
  for (const code of ['tr', 'en']) {
    I18n.set(code);
    try {
      const short = Y.note({ t }, false, 'short'), long = Y.note({ t }, false, 'long'), iki = Y.note({ t }, true, 'short');
      assert.ok(short.includes('“' + t('print.panel.short') + '”') && short.includes('“' + t('print.panel.short_layout') + '”') && short.includes(t('print.panel.double')), `${code} kısa: ${short}`);
      assert.ok(short.includes(t('impose.duplex.short')), `${code} kısa: araçtaki ad`);
      assert.ok(long.includes('“' + t('print.panel.long') + '”') && long.includes('“' + t('print.panel.long_layout') + '”') && !long.includes(t('print.panel.short')), `${code} uzun: ${long}`);
      assert.ok(iki.includes('“' + t('print.panel.closed') + '”') && /100/.test(iki), `${code} iki PDF: ${iki}`);
      // pencerede olmayan ad seçenek olarak söylenmez (eski not: “Kısa kenardan çevir” olarak seçin)
      assert.ok(!short.includes('“' + t('impose.duplex.short') + '” ' + (code === 'tr' ? 'as' : '(')), `${code}: ${short}`);
      assert.match(short, /100/);
    } finally { I18n.set('tr'); }
  }
});
