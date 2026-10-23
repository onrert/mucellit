'use strict';
// printing flows (app/js/printing.js) with a fake platform — one PDF, two PDFs (fronts → turn-over confirmation → backs),
// cancel/error at every stage; Open in Preview and, when it cannot open, option E (Save + note). Texts from the real dictionary (tr and en).
const test = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('../js/i18n.js');
const Y = require('../js/printing.js');

const t = (a, p) => I18n.t(a, p);
const SINGLE = [{ name: 'book-imposed.pdf', bytes: new Uint8Array([1, 2, 3]), side: 24 }];
const TWO = [{ name: 'book-fronts.pdf', bytes: new Uint8Array([1]), side: 12 }, { name: 'book-backs.pdf', bytes: new Uint8Array([2]), side: 12 }];

/** Fake platform: print answers in order (true/false or an Error = rejection), ask answers in order. */
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
    P.saveMessage = (s) => ({ text: s.saved.length ? 'Kaydedildi: ' + s.saved.map((k) => k.path).join(', ') + '.' : 'NotSaved.', kind: s.cancelled.length ? 'error' : undefined });  // turkish-ok: expected Turkish UI text
  }
  return P;
}
const env = (P) => ({ platform: P, t });

test('one PDF: printed → "sent"; cancelled → "Not printed" (error); a Rust error (non-Apple included) → "could not be printed"', async () => {
  I18n.set('tr');
  let P = fake({ write: [true] });
  assert.deepEqual(await Y.print(SINGLE, env(P)), { text: 'Yazıcıya gönderildi: book-imposed.pdf.' });  // turkish-ok: expected Turkish UI text
  assert.deepEqual(P.call, [['print', 'book-imposed.pdf', 3]]);
  assert.deepEqual(P.confirms, [], 'no turn-over confirmation with one PDF');
  P = fake({ write: [false] });
  assert.deepEqual(await Y.print(SINGLE, env(P)), { text: 'Yazdırılmadı (baskı penceresinden vazgeçildi).', kind: 'error' });  // turkish-ok: expected Turkish UI text
  P = fake({ write: [new Error(I18n.t('rust.no_printing'))] });
  assert.deepEqual(await Y.print(SINGLE, env(P)), { text: 'book-imposed.pdf yazdırılamadı: bu platformda yazdırma henüz yok', kind: 'error' });  // turkish-ok: expected Turkish UI text
  // without platform.print (browser) it is not rejected, a clear text
  assert.equal((await Y.print(SINGLE, env({}))).kind, 'error');
});

test('two PDFs: fronts → "turn the stack over and put it back" confirmation → backs; all done → two files sent', async () => {
  I18n.set('tr');
  const P = fake({ write: [true, true], confirmation: [true] });
  assert.deepEqual(await Y.print(TWO, env(P)), { text: 'Yazıcıya gönderildi: book-fronts.pdf ve book-backs.pdf.' });  // turkish-ok: expected Turkish UI text
  assert.deepEqual(P.call.map((c) => c[1]), ['book-fronts.pdf', 'book-backs.pdf'], 'first the fronts, then the backs');
  assert.equal(P.confirms.length, 1);
  assert.match(P.confirms[0], /^Önler \(book-fronts\.pdf\) yazıcıya gönderildi\. .*desteyi .*çevirip .*geri koyun.*Tamam/);  // turkish-ok: expected Turkish UI text
});

test('two PDFs: stopping halfway is reported correctly (cancel at the fronts / cancel at the confirmation / cancel at the backs / error)', async () => {
  I18n.set('tr');
  // cancel at the fronts: nothing printed, no confirmation asked, the backs are not tried
  let P = fake({ write: [false] });
  assert.deepEqual(await Y.print(TWO, env(P)), { text: 'Yazdırılmadı (baskı penceresinden vazgeçildi).', kind: 'error' });  // turkish-ok: expected Turkish UI text
  assert.deepEqual([P.call.length, P.confirms.length], [1, 0]);
  // cancel at the turn-over confirmation
  P = fake({ write: [true], confirmation: [false] });
  const halfway = 'Yalnız önler yazıcıya gönderildi (book-fronts.pdf); arkalar (book-backs.pdf) basılmadı (vazgeçildi).';  // turkish-ok: expected Turkish UI text
  assert.deepEqual(await Y.print(TWO, env(P)), { text: halfway, kind: 'error' });
  assert.deepEqual([P.call.length, P.confirms.length], [1, 1]);
  // cancel in the print dialog of the backs
  P = fake({ write: [true, false], confirmation: [true] });
  assert.deepEqual(await Y.print(TWO, env(P)), { text: halfway, kind: 'error' });
  assert.equal(P.call.length, 2);
  // error at the backs
  P = fake({ write: [true, new Error('a print dialog is already open')], confirmation: [true] });
  assert.deepEqual(await Y.print(TWO, env(P)), { text: 'Yalnız önler yazıcıya gönderildi (book-fronts.pdf); book-backs.pdf yazdırılamadı: a print dialog is already open', kind: 'error' });  // turkish-ok: expected Turkish UI text
  // error at the fronts
  P = fake({ write: [new Error('x')] });
  assert.deepEqual(await Y.print(TWO, env(P)), { text: 'book-fronts.pdf yazdırılamadı: x', kind: 'error' });  // turkish-ok: expected Turkish UI text
  // the confirmation dialog throws (backs not printed)
  P = fake({ write: [true], confirmation: [new Error('no window')] });
  const r = await Y.print(TWO, env(P));
  assert.equal(r.kind, 'error');
  assert.match(r.text, /^Yalnız önler yazıcıya gönderildi \(book-fronts\.pdf\); book-backs\.pdf yazdırılamadı: no window$/);  // turkish-ok: expected Turkish UI text
  assert.equal(P.call.length, 1);
});

test('English texts and the note before printing (two-sided = the choice in the tool; scale 100%; do not choose "Scale to fit")', async () => {
  I18n.set('en');
  try {
    const P = fake({ write: [true], confirmation: [false] });
    assert.deepEqual(await Y.print(TWO, env(P)), { text: "Only the fronts were sent to the printer (book-fronts.pdf); the backs (book-backs.pdf) weren't printed (canceled).", kind: 'error' });
    assert.match(P.confirms[0], /turn the stack over/);
    // the note takes the value chosen in the tool and names the option by the name in the print dialog
    assert.equal(Y.note({ t }, false, 'short'), 'In the print dialog: set Double-sided to “On (Short Edge)” (the same as “Flip on short edge” here; in Layout: Two-Sided → “Short-Edge Binding”), keep Scale at 100% and don\'t choose “Scale to fit paper size”.');
    assert.match(Y.note({ t }, true, 'short'), /Double-sided → “Off”/);
  } finally { I18n.set('tr'); }
  assert.equal(Y.note({ t }, false, 'short'), 'Baskı penceresinde: Çift Taraflı → “Açık (Kısa Kenar)” seçin (buradaki “Kısa kenardan çevir” ile aynı; Düzen bölümünde: Çift Taraflı → “Kısa Kenardan Ciltli”), ölçeği %100 bırakın, “Kâğıt boyutuna sığdır”ı seçmeyin.');  // turkish-ok: expected Turkish UI text
  assert.match(Y.note({ t }, true, 'short'), /Çift Taraflı → “Kapalı” .*%100.*sığdır/);  // turkish-ok: expected Turkish UI text
});

test('Open in Preview: every file opens in turn; when it cannot open (sandbox) option E — Save + a "print from Preview" note, or an error', async () => {
  I18n.set('tr');
  let P = fake({ preview: [true, true] });
  assert.deepEqual(await Y.openInPreview(TWO, env(P)), { text: "Önizleme'de açıldı: book-fronts.pdf ve book-backs.pdf. Önizleme'den “Gerçek Boyut” (%100) ile basın." });  // turkish-ok: expected Turkish UI text
  assert.deepEqual(P.call, [['preview', 'book-fronts.pdf'], ['preview', 'book-backs.pdf']]);
  // could not open → confirmation yes → Save dialog → saved + note
  P = fake({ preview: [new Error('no permission')], confirmation: [true], save: { saved: [{ name: 'book-imposed.pdf', path: '/Users/x/book-imposed.pdf' }], cancelled: [], failed: [] } });
  let r = await Y.openInPreview(SINGLE, env(P));
  assert.deepEqual(r, { text: "Kaydedildi: /Users/x/book-imposed.pdf. Önizleme'de açıp “Gerçek Boyut” (%100) ile basın.", kind: undefined });  // turkish-ok: expected Turkish UI text
  assert.match(P.confirms[0], /^Önizleme PDF'i açamadı \(no permission\)\. Bunun yerine PDF kaydedilsin mi\?/);  // turkish-ok: expected Turkish UI text
  assert.deepEqual(P.call.map((c) => c[0]), ['preview', 'save']);
  // could not open → cancel in the Save dialog: no note added
  P = fake({ preview: [new Error('no permission')], confirmation: [true], save: { saved: [], cancelled: ['book-imposed.pdf'], failed: [] } });
  r = await Y.openInPreview(SINGLE, env(P));
  assert.deepEqual(r, { text: 'NotSaved.', kind: 'error' });
  // could not open → confirmation no → error text
  P = fake({ preview: [new Error('no permission')], confirmation: [false], save: { saved: [], cancelled: [], failed: [] } });
  assert.deepEqual(await Y.openInPreview(SINGLE, env(P)), { text: "Önizleme PDF'i açamadı: no permission", kind: 'error' });  // turkish-ok: expected Turkish UI text
  assert.equal(P.call.filter((c) => c[0] === 'save').length, 0);
  // the second could not open: the first stays open, E is asked
  P = fake({ preview: [true, new Error('y')], confirmation: [false] });
  assert.deepEqual(await Y.openInPreview(TWO, env(P)), { text: "Önizleme PDF'i açamadı: y", kind: 'error' });  // turkish-ok: expected Turkish UI text
  assert.equal(P.call.length, 2);
  // without platform.openInPreview
  assert.equal((await Y.openInPreview(SINGLE, env({}))).kind, 'error');
});

// the two-sided term in the print note uses the macOS print dialog's own name. The pop-up menu in the main dialog
// (PrintingUI PMDuplex: "Double-sided" → Off / On / On (Short Edge); tr "Çift Taraflı" → Kapalı / Açık /  // turkish-ok: Turkish names of the macOS print dialog
// Açık (Kısa Kenar)) and the Layout section (PrintingCocoaPDEs: "Two-Sided" → Long-Edge / Short-Edge Binding; tr Uzun/Kısa  // turkish-ok: Turkish names of the macOS print dialog
// Kenardan Ciltli). The note turns the choice in the tool (short/long) into these names; the tool's own "flip on short edge" name is not in the dialog.  // turkish-ok: Turkish names of the macOS print dialog
const fs = require('node:fs');
const PRINTING = '/System/Library/PrivateFrameworks/PrintingPrivate.framework/Versions/A/Plugins';
const loctable = (path) => JSON.parse(require('node:child_process').execFileSync('plutil', ['-convert', 'json', '-o', '-', path]).toString());
const PANEL_KEYS = { 'print.panel.double': ['hCn-CU-yI5.title', 'Two-Sided'], 'print.panel.closed': ['VfQ-Ti-J6u.title'], 'print.panel.long': ['Ugn-qd-042.title', 'Long-Edge Binding'], 'print.panel.short': ['jfS-0y-BUO.title', 'Short-Edge Binding'] };

test('the print note uses the terms of the macOS print dialog (choice in the tool → option name in the dialog), in both languages', () => {
  const dictionary = { en: I18n.dictionary('en'), tr: I18n.dictionary('tr') };
  const duplex = PRINTING + '/PrintingUI.bundle/Contents/Resources/PMDuplex.loctable', layout = PRINTING + '/PrintingCocoaPDEs.bundle/Contents/Resources/Localizable.loctable';
  const nib = PRINTING + '/PrintingUI.bundle/Contents/Resources/Base.lproj/PMDuplex.nib';
  if (process.platform === 'darwin' && fs.existsSync(duplex) && fs.existsSync(layout)) {
    const d = loctable(duplex), l = loctable(layout);
    const panel = { tr: d.tr, en: d.en_GB }; // the strings of the Base (en) nib are the same as en_GB (looked up in the nib below)
    const nibText = fs.readFileSync(nib).toString('latin1');
    for (const code of ['en', 'tr']) {
      for (const [a, [k, layoutK]] of Object.entries(PANEL_KEYS)) {
        assert.equal(dictionary[code][a], panel[code][k], `${code} ${a} (PMDuplex ${k})`);
        if (layoutK) assert.equal(dictionary[code][a + '_layout'], l[code][layoutK], `${code} ${a}_layout (Layout: ${layoutK})`);
      }
    }
    for (const k of Object.values(PANEL_KEYS)) assert.ok(nibText.includes(panel.en[k[0]]) || ['On', 'Off'].includes(panel.en[k[0]]), `Base nib: ${panel.en[k[0]]}`);
  }
  // note: the value chosen in the tool (short/long) → dialog names; the tool's name too (so the same choice shows)
  for (const code of ['tr', 'en']) {
    I18n.set(code);
    try {
      const short = Y.note({ t }, false, 'short'), long = Y.note({ t }, false, 'long'), two = Y.note({ t }, true, 'short');
      assert.ok(short.includes('“' + t('print.panel.short') + '”') && short.includes('“' + t('print.panel.short_layout') + '”') && short.includes(t('print.panel.double')), `${code} short: ${short}`);
      assert.ok(short.includes(t('impose.duplex.short')), `${code} short: name in the tool`);
      assert.ok(long.includes('“' + t('print.panel.long') + '”') && long.includes('“' + t('print.panel.long_layout') + '”') && !long.includes(t('print.panel.short')), `${code} long: ${long}`);
      assert.ok(two.includes('“' + t('print.panel.closed') + '”') && /100/.test(two), `${code} two PDFs: ${two}`);
      // a name that is not in the dialog is not given as the option (old note: choose it as “Kısa kenardan çevir”)  // turkish-ok: Turkish names of the macOS print dialog
      assert.ok(!short.includes('“' + t('impose.duplex.short') + '” ' + (code === 'tr' ? 'olarak' : '(')), `${code}: ${short}`);  // turkish-ok: expected Turkish UI text
      assert.match(short, /100/);
    } finally { I18n.set('tr'); }
  }
});
