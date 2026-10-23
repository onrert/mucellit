'use strict';
// app.js başlatma: baslat() içindeki hata da, platform.hazir reddi de
// "Uygulama başlatılamadı" bildirimine gider; işlenmemiş Promise reddi kalmaz.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KAYNAK = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

/** app.js'i sahte belge ve KitapCilt parçalarıyla çalıştırır. */
function kur({ hazir, surecBaslat, ogren } = {}) {
  const bildirimler = [];
  const elemanlar = {};
  const el = (id) => (elemanlar[id] = elemanlar[id] || { id, hidden: false, ozellik: {}, setAttribute(a, d) { this.ozellik[a] = d; } });
  const ctx = {
    PDFLib: {}, pdfjsLib: {},
    document: {
      readyState: 'complete',
      querySelectorAll: () => [],
      documentElement: el('html'),
      addEventListener() {},
    },
    KitapCilt: {
      ortak: { $: el, bildir: (m, t) => bildirimler.push([m, t]), yerelYaz() {}, yerelOku: () => null },
      platform: { hazir, metin: { kutuphaneIpucu: 'ipucu' } },
      dil: require('../js/i18n.js'), // Node örneği (öntanımlı tr)
      surec: { baslat: surecBaslat || (() => {}) },
      duzenle: { baslat() {} },
      hesapla: { baslat() {} },
      ogren: ogren,
    },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(KAYNAK, ctx, { filename: 'app.js' });
  return { ctx, bildirimler, elemanlar };
}
const bekle = () => new Promise((r) => setImmediate(r));

test('başlatma: hazır → başlar, data-hazir evet, bildirim yok', async () => {
  const { bildirimler, elemanlar } = kur({ hazir: Promise.resolve() });
  await bekle();
  assert.deepEqual(bildirimler, []);
  assert.equal(elemanlar.html.ozellik['data-hazir'], 'evet');
});

test('başlatma: platform.hazir reddedilirse "Uygulama başlatılamadı" bildirimi', async () => {
  const { bildirimler } = kur({ hazir: Promise.reject(new Error('köprü yok')) });
  await bekle();
  assert.deepEqual(bildirimler, [['Uygulama başlatılamadı: köprü yok', 'hata']]);
});

test('başlatma: baslat() içinde hata atılırsa yakalanır, bildirime gider (işlenmemiş red yok)', async () => {
  const redler = [];
  const dinle = (e) => redler.push(e);
  process.on('unhandledRejection', dinle);
  try {
    const { bildirimler, elemanlar } = kur({ hazir: Promise.resolve(), surecBaslat: () => { throw new Error('süreç bozuk'); } });
    await bekle(); await bekle();
    assert.deepEqual(bildirimler, [['Uygulama başlatılamadı: süreç bozuk', 'hata']]);
    assert.equal(elemanlar.html.ozellik['data-hazir'], undefined);
  } finally {
    await bekle();
    process.off('unhandledRejection', dinle);
  }
  assert.deepEqual(redler.map(String), []);
});

// ---------------------------------------------------------------- Öğren sekmesi
test('sekme: Öğren açılınca rehber gösterilir, başka sekmeye geçince gizlenir; paneller ve aria-selected doğru', async () => {
  const cagri = [];
  const sekme = { goster() { cagri.push(['goster', elemanlar['sekme-ogren'].hidden]); }, gizle() { cagri.push(['gizle', elemanlar['sekme-ogren'].hidden]); } };
  const { ctx, elemanlar } = kur({ hazir: Promise.resolve(), ogren: { sekme } });
  await bekle();
  cagri.length = 0;
  ctx.KitapCilt.uygulama.sekmeAc('ogren');
  assert.deepEqual(cagri, [['goster', false]], 'goster panel görünür olduktan sonra');
  assert.equal(elemanlar['sekme-duzenle'].hidden, true);
  assert.equal(elemanlar['sekme-dugme-ogren'].ozellik['aria-selected'], 'true');
  ctx.KitapCilt.uygulama.sekmeAc('hesapla');
  assert.deepEqual(cagri.at(-1), ['gizle', true], 'gizle panel gizlendikten sonra');
  assert.equal(elemanlar['sekme-hesapla'].hidden, false);
  assert.equal(elemanlar['sekme-dugme-ogren'].ozellik['aria-selected'], 'false');
  ctx.KitapCilt.uygulama.sekmeAc('bilinmeyen');
  assert.equal(elemanlar['sekme-duzenle'].hidden, false, 'bilinmeyen sekme → Düzenle');
  assert.deepEqual(cagri.at(-1), ['gizle', true]);
});

test('sekme: rehber hata atarsa sekme yine açılır, hata bildirilir ve gizlenmez (sonradan atılır); rehber yoksa sekmeler çalışır', async () => {
  const atilan = [];
  const eski = globalThis.setTimeout;
  const { ctx, bildirimler, elemanlar } = kur({ hazir: Promise.resolve(), ogren: { sekme: { goster() { throw new Error('figür bozuk'); }, gizle() {} } } });
  await bekle();
  ctx.setTimeout = (fn) => { try { fn(); } catch (e) { atilan.push(e.message); } };
  ctx.KitapCilt.uygulama.sekmeAc('ogren');
  assert.equal(elemanlar['sekme-ogren'].hidden, false);
  assert.deepEqual(bildirimler.at(-1), ['Öğren sekmesi açılamadı: figür bozuk', 'hata']);
  assert.deepEqual(atilan, ['figür bozuk']);
  assert.equal(globalThis.setTimeout, eski);
  const yok = kur({ hazir: Promise.resolve() });
  await bekle();
  assert.doesNotThrow(() => yok.ctx.KitapCilt.uygulama.sekmeAc('ogren'));
  assert.equal(yok.elemanlar['sekme-ogren'].hidden, false);
});
