'use strict';
// platform.js (tarayıcı) ve platform-tauri.js (sahte window.__TAURI__) birim testleri, G5.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { dilKur } = require('./dil-yardimci.js');

const JS = path.join(__dirname, '..', 'js');
const oku = (ad) => fs.readFileSync(path.join(JS, ad), 'utf8');

/** platform.js'i (ve istenirse platform-tauri.js'i) sahte bir pencerede çalıştırır. */
function kur({ confirm, tauri, belge } = {}) {
  const ctx = { confirm, __TAURI__: tauri, Blob, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, setTimeout: () => 0, document: belge };
  ctx.self = ctx;
  vm.createContext(ctx);
  dilKur(ctx);
  vm.runInContext(oku('platform.js'), ctx, { filename: 'platform.js' });
  vm.runInContext(oku('platform-tauri.js'), ctx, { filename: 'platform-tauri.js' });
  return ctx;
}

test('tarayıcı: ad, hazir, yazdir yok, tamSurum true, kütüphane ipucu bugünkü metin', async () => {
  const P = kur({ confirm: () => true }).KitapCilt.platform;
  assert.equal(P.ad, 'tarayici');
  await P.hazir;
  assert.equal(P.yazdir, null);
  assert.equal(await P.tamSurum(), true);
  assert.equal(P.metin.kutuphaneIpucu, 'İnternet bağlantısını kontrol edip sayfayı yenileyin.');
});

test('onayla: senkron true → true, false → false', async () => {
  assert.equal(await kur({ confirm: () => true }).KitapCilt.platform.onayla('?'), true);
  assert.equal(await kur({ confirm: () => false }).KitapCilt.platform.onayla('?'), false);
});

test('onayla: Promise döndüren confirm (Tauri dialog eklentisi ezmesi) beklenir; Promise<false> → false', async () => {
  assert.equal(await kur({ confirm: async () => false }).KitapCilt.platform.onayla('?'), false);
  assert.equal(await kur({ confirm: async () => true }).KitapCilt.platform.onayla('?'), true);
});

test('onayla: yalnız tam true "evet" sayılır (dize, 1, nesne, undefined → false)', async () => {
  for (const d of ['Ok', 1, {}, undefined, null]) {
    assert.equal(await kur({ confirm: () => d }).KitapCilt.platform.onayla('?'), false, String(d));
  }
});

test('onayla: confirm hata atarsa Promise reddedilir (sessizce "evet" sayılmaz)', async () => {
  const P = kur({ confirm: () => { throw new Error('yok'); } }).KitapCilt.platform;
  await assert.rejects(P.onayla('?'), /yok/);
});

test('onayla: mesaj confirm\'e dize olarak geçer', async () => {
  let gelen;
  await kur({ confirm: (m) => { gelen = m; return false; } }).KitapCilt.platform.onayla(42);
  assert.equal(gelen, '42');
});

test('dosyaSec (tarayıcı): verilen gizli girdiye tıklar, null döner; girdi yoksa da null', async () => {
  const P = kur({}).KitapCilt.platform;
  let tik = 0;
  assert.equal(await P.dosyaSec({ girdi: { click: () => { tik += 1; } } }), null);
  assert.equal(tik, 1);
  assert.equal(await P.dosyaSec({}), null);
  assert.equal(await P.dosyaSec(), null);
});

test('kaydet (tarayıcı): <a download> ile verilen adla tıklar, true döner', async () => {
  const eklenen = [];
  const belge = {
    createElement: () => ({ style: {}, click() { this.tiklandi = true; }, remove() {} }),
    body: { appendChild: (a) => eklenen.push(a) },
  };
  const P = kur({ belge }).KitapCilt.platform;
  assert.equal(await P.kaydet('cikti.pdf', new Uint8Array([1, 2]), 'application/pdf'), true);
  assert.equal(eklenen.length, 1);
  assert.equal(eklenen[0].download, 'cikti.pdf');
  assert.equal(eklenen[0].href, 'blob:x');
  assert.equal(eklenen[0].tiklandi, true);
});

test('kaydet (tarayıcı): DOM hatası Promise reddine döner', async () => {
  const belge = { createElement: () => { throw new Error('dom yok'); }, body: {} };
  await assert.rejects(kur({ belge }).KitapCilt.platform.kaydet('a', 'b'), /dom yok/);
});

test('platform-tauri: __TAURI__ yoksa ya da core yoksa hiçbir şeyi ezmez', () => {
  assert.equal(kur({}).KitapCilt.platform.ad, 'tarayici');
  assert.equal(kur({ tauri: {} }).KitapCilt.platform.ad, 'tarayici');
});

function sahteTauri(askYanit) {
  const T = { core: { invoke() {} }, cagri: [], dinleyici: {} };
  if (askYanit !== undefined) T.dialog = { ask: async (m, s) => { T.cagri.push([m, s]); return askYanit; } };
  T.event = { listen: (ad, f) => { T.dinleyici[ad] = f; return Promise.resolve(() => {}); } };
  return T;
}

test('platform-tauri: ad tauri; onayla yerel dialog.ask kullanır, "hayır" → false, "evet" → true', async () => {
  const T = sahteTauri(false);
  const P = kur({ tauri: T, confirm: () => { throw new Error('confirm çağrılmamalı'); } }).KitapCilt.platform;
  assert.equal(P.ad, 'tauri');
  assert.equal(await P.onayla('Silinsin mi?'), false);
  assert.equal(T.cagri.length, 1);
  assert.equal(T.cagri[0][0], 'Silinsin mi?');
  assert.equal(T.cagri[0][1].kind, 'warning');
  assert.equal(await kur({ tauri: sahteTauri(true) }).KitapCilt.platform.onayla('?'), true);
});

test('platform-tauri: dialog.ask yoksa eklentinin ezdiği async confirm beklenir', async () => {
  assert.equal(await kur({ tauri: sahteTauri(), confirm: async () => false }).KitapCilt.platform.onayla('?'), false);
  assert.equal(await kur({ tauri: sahteTauri(), confirm: async () => true }).KitapCilt.platform.onayla('?'), true);
});

test('platform-tauri: kütüphane ipucu uygulama metniyle değişir; dosyaSec/kaydet yerel (tarayıcınınkinden farklı)', () => {
  const ctx = kur({ tauri: sahteTauri(true) });
  const P = ctx.KitapCilt.platform;
  assert.notEqual(P.metin.kutuphaneIpucu, 'İnternet bağlantısını kontrol edip sayfayı yenileyin.');
  assert.doesNotMatch(P.metin.kutuphaneIpucu, /İnternet/);
  const tarayici = kur({}).KitapCilt.platform;
  assert.notEqual(P.dosyaSec.toString(), tarayici.dosyaSec.toString());
  assert.notEqual(P.kaydet.toString(), tarayici.kaydet.toString());
  assert.equal(P.yerelDosya, true);
  assert.equal(tarayici.yerelDosya, false);
});

test('platform-tauri: menü olayı sekme öğesinde sekmeAc çağırır, bilinmeyen öğede çağırmaz', () => {
  const T = sahteTauri(true);
  const ctx = kur({ tauri: T });
  const acilan = [];
  ctx.KitapCilt.uygulama = { sekmeAc: (s) => acilan.push(s) };
  assert.equal(typeof T.dinleyici.menu, 'function');
  T.dinleyici.menu({ payload: 'sekme-surec' });
  T.dinleyici.menu({ payload: 'sekme-hesapla' });
  T.dinleyici.menu({ payload: 'sekme-duzenle' });
  T.dinleyici.menu({ payload: 'sekme-ogren' }); // Görünüm > Öğren ⌘4
  T.dinleyici.menu({ payload: 'bilinmeyen' });
  T.dinleyici.menu({ payload: 'sekme-ogren ' });
  T.dinleyici.menu({ payload: 'ogren' });
  T.dinleyici.menu({});
  T.dinleyici.menu(null);
  assert.deepEqual(acilan, ['surec', 'hesapla', 'duzenle', 'ogren']);
});

// Kaynak denetimi: platform katmanı dışındaki uygulama kodu tarayıcı diyaloglarını doğrudan çağırmaz.
// (Doğrudan `confirm(...)` Tauri'de Promise döner ve `if (!confirm())` kalıbı onaysız siler; alert beklemez.)
test('kaynak: platform.js / platform-tauri.js dışında doğrudan confirm/alert/prompt çağrısı yok', () => {
  const dosyalar = [];
  (function gez(d) {
    for (const g of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, g.name);
      if (g.isDirectory()) gez(y);
      else if (g.name.endsWith('.js')) dosyalar.push(y);
    }
  })(JS);
  const izinli = new Set(['platform.js', 'platform-tauri.js'].map((a) => path.join(JS, a)));
  const bulunan = [];
  for (const y of dosyalar) {
    if (izinli.has(y)) continue;
    const satirlar = fs.readFileSync(y, 'utf8').split('\n');
    satirlar.forEach((s, i) => {
      const kod = s.replace(/\/\/.*$/, '');
      if (/(^|[^\w.$])(confirm|alert|prompt)\s*\(|\.(confirm|alert|prompt)\s*\(/.test(kod)) bulunan.push(`${path.relative(JS, y)}:${i + 1}`);
    });
  }
  assert.ok(dosyalar.length >= 10, 'en az 10 JS dosyası tarandı');
  assert.deepEqual(bulunan, []);
});

test('kaynak denetimi kendisi: kusurlu örnekleri yakalar, temiz örneği geçirir', () => {
  const desen = /(^|[^\w.$])(confirm|alert|prompt)\s*\(|\.(confirm|alert|prompt)\s*\(/;
  for (const kotu of ['if (!kok.confirm(m)) return;', 'confirm("x")', 'window.alert (1)', ' prompt(a)', 'x = self.prompt(1)']) assert.match(kotu, desen, kotu);
  for (const iyi of ['KC.platform.onayla(m)', 'onayla(m, is)', 'var confirmed = 1;', 'istemler.push(x)']) assert.doesNotMatch(iyi, desen, iyi);
});

// ---------------------------------------------------------------- Tauri dosya, kaydetme, son açılanlar, yedek
/**
 * Sahte Tauri penceresi: invoke çağrıları kaydedilir, yanıtlar `yanit[komut]` (değer ya da işlev) ile verilir.
 * setTimeout kuyruğu elle çalıştırılır (`zaman.calistir()`); DOM yalnız getElementById + olay dinleyicisi.
 */
function kurTauri({ yanit = {}, ogeler = {}, ls = null, depo = true, readyState = 'complete', dil = 'tr', diller } = {}) {
  const cagri = [];
  const dinleyici = {};
  const T = {
    core: {
      invoke(komut, arg, secenek) {
        cagri.push({ komut, arg, secenek });
        const y = yanit[komut];
        return Promise.resolve(typeof y === 'function' ? y(arg, secenek) : y);
      },
    },
    event: { listen: (ad, f) => { dinleyici[ad] = f; return Promise.resolve(() => {}); } },
    dialog: { ask: async () => true },
  };
  const bekleyen = [];
  let sayac = 0;
  const zaman = {
    kuyruk: bekleyen,
    calistir() { while (bekleyen.length) { const z = bekleyen.shift(); z.f(); } },
  };
  const belgeDinleyici = {};
  const belge = {
    readyState,
    getElementById: (id) => ogeler[id] || null,
    addEventListener: (ad, f) => { (belgeDinleyici[ad] = belgeDinleyici[ad] || []).push(f); },
    visibilityState: 'visible',
  };
  const bildirimler = [];
  const ctx = {
    __TAURI__: T, File, Blob, TextEncoder, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    document: belge, localStorage: ls, navigator: { languages: diller || (dil === 'tr' ? ['tr-TR'] : ['en-US']) },
    setTimeout: (f, ms) => { const id = ++sayac; bekleyen.push({ id, f, ms }); return id; },
    clearTimeout: (id) => { const i = bekleyen.findIndex((z) => z.id === id); if (i >= 0) bekleyen.splice(i, 1); },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  dilKur(ctx, dil);
  vm.runInContext(oku('platform.js'), ctx, { filename: 'platform.js' });
  const KC = ctx.KitapCilt;
  KC.ortak = { bildir: (m, t) => bildirimler.push([m, t]) };
  const acilan = [];
  const sekme = [];
  KC.duzenle = { dosyaAc: async (f) => { acilan.push({ ad: f.name, tur: f.type, metin: Buffer.from(await f.arrayBuffer()).toString() }); } };
  KC.uygulama = { sekmeAc: (s) => sekme.push(s) };
  if (depo) {
    const yazilan = [];
    KC.depo = { ANAHTAR: 'kitapCilt.v1', yaz: (v) => { yazilan.push(v); return true; }, temizle: () => { yazilan.push('TEMIZLE'); }, yazilan };
    KC.surecModel = { bosVeri: () => ({ surum: 1, kitaplar: [] }), dogrula: (v) => { if (!v || !Array.isArray(v.kitaplar)) throw new Error('geçersiz'); } };
  }
  vm.runInContext(oku('platform-tauri.js'), ctx, { filename: 'platform-tauri.js' });
  return { ctx, KC, P: KC.platform, cagri, dinleyici, zaman, bildirimler, acilan, sekme, belgeDinleyici };
}
/** Açılıştaki (hazir) yedek/kuyruk/dil çağrıları dışındaki invoke çağrıları (dil_oku + dil_ayarla da açılışta). */
const ACILIS = ['veri_oku', 'bekleyen_acilanlar', 'dil_oku', 'dil_ayarla'];
const isCagrisi = (s) => s.cagri.filter((c) => !ACILIS.includes(c.komut));
const ab = (s) => { const b = Buffer.from(s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const bekle = () => new Promise((r) => setImmediate(r));

test('dosyaSec: belge → dosya_ac {amac: belge} + dosya_oku {kimlik} → File (ad, tür, bayt); JSON → amac yedek', async () => {
  const s = kurTauri({ yanit: { dosya_ac: { kimlik: 'k-1', ad: 'Mavi Pusula.epub', tur: 'epub' }, dosya_oku: () => ab('EPUBBAYT') } });
  const f = await s.P.dosyaSec({ uzantilar: ['pdf', 'epub'], girdi: { click() { throw new Error('gizli girdi açılmamalı'); } } });
  assert.equal(f.name, 'Mavi Pusula.epub');
  assert.equal(f.type, 'application/epub+zip');
  assert.equal(Buffer.from(await f.arrayBuffer()).toString(), 'EPUBBAYT');
  assert.deepEqual(isCagrisi(s).map((c) => [c.komut, JSON.stringify(c.arg)]), [['dosya_ac', '{"amac":"belge"}'], ['dosya_oku', '{"kimlik":"k-1"}']]);
  const j = kurTauri({ yanit: { dosya_ac: { kimlik: 'k-2', ad: 'yedek.json', tur: 'json' }, dosya_oku: () => ab('{}') } });
  const fj = await j.P.dosyaSec({ uzantilar: ['json'] });
  assert.equal(fj.type, 'application/json');
  assert.equal(isCagrisi(j)[0].arg.amac, 'yedek');
});

test('dosyaSec: vazgeçilirse null (dosya_oku çağrılmaz); Rust hatası Promise reddine gider', async () => {
  const s = kurTauri({ yanit: { dosya_ac: null } });
  assert.equal(await s.P.dosyaSec({ uzantilar: ['pdf'] }), null);
  assert.deepEqual(isCagrisi(s).map((c) => c.komut), ['dosya_ac']);
  const h = kurTauri({ yanit: { dosya_ac: () => Promise.reject('desteklenmeyen dosya: a.txt') } });
  await assert.rejects(h.P.dosyaSec({ uzantilar: ['pdf'] }), /desteklenmeyen/);
});

test('kaydet: ham bayt gövde, x-ad encodeURIComponent (ASCII başlık), x-tur; sonuç {ad, yol} ya da false', async () => {
  const s = kurTauri({ yanit: { dosya_kaydet: (b, o) => (o.headers['x-tur'] === 'pdf' ? { ad: 'Çiğdemköy-dizilmis.pdf', yol: '/Users/x/Masaüstü/Çiğdemköy-dizilmis.pdf' } : null) } });
  const r = await s.P.kaydet('Çiğdemköy-dizilmis.pdf', new Uint8Array([37, 80, 68, 70]), 'application/pdf');
  assert.deepEqual({ ...r }, { ad: 'Çiğdemköy-dizilmis.pdf', yol: '/Users/x/Masaüstü/Çiğdemköy-dizilmis.pdf' });
  const k = () => s.cagri.filter((x) => x.komut === 'dosya_kaydet');
  const c = k()[0];
  assert.equal(c.komut, 'dosya_kaydet');
  assert.ok(ArrayBuffer.isView(c.arg), 'gövde ham bayt (Uint8Array)');
  assert.deepEqual([...c.arg], [37, 80, 68, 70]);
  assert.equal(c.secenek.headers['x-ad'], encodeURIComponent('Çiğdemköy-dizilmis.pdf'));
  assert.match(c.secenek.headers['x-ad'], /^[\x21-\x7e]+$/, 'başlık ASCII');
  assert.equal(c.secenek.headers['x-tur'], 'pdf');
  // JSON metni → UTF-8 bayt, tür json; Rust null (vazgeçildi) → false
  assert.equal(await s.P.kaydet('yedek.json', '{"ad":"ğ"}', 'application/json'), false);
  assert.equal(k()[1].secenek.headers['x-tur'], 'json');
  assert.equal(Buffer.from(k()[1].arg).toString(), '{"ad":"ğ"}');
  // Blob ve ArrayBuffer
  await s.P.kaydet('b.pdf', new Blob([Buffer.from('BLOB')]), 'application/pdf');
  assert.equal(Buffer.from(k()[2].arg).toString(), 'BLOB');
  await s.P.kaydet('c.pdf', ab('AB'), 'application/pdf');
  assert.equal(Buffer.from(k()[3].arg).toString(), 'AB');
  await assert.rejects(s.P.kaydet('d.pdf', 42, 'application/pdf'), /tanınmadı/);
  // Rust yolsuz/garip yanıt → false (başarı sayılmaz)
  const g = kurTauri({ yanit: { dosya_kaydet: { ad: 'x' } } });
  assert.equal(await g.P.kaydet('x.pdf', 'x', 'application/pdf'), false);
});

test('hepsiniKaydet: dosyalar SIRAYLA (ikinci pencere birinci kapanınca); vazgeç/hata sıradakini durdurmaz', async () => {
  const sira = [];
  let birinciBitir;
  const s = kurTauri({ yanit: { dosya_kaydet: (b, o) => {
    const ad = decodeURIComponent(o.headers['x-ad']);
    sira.push('basla ' + ad);
    if (ad === 'a-onler.pdf') return new Promise((r) => { birinciBitir = () => { sira.push('bitti ' + ad); r(null); }; });
    if (ad === 'a-arkalar.pdf') return { ad, yol: '/k/' + ad };
    return Promise.reject(new Error('disk dolu'));
  } } });
  const soz = s.P.hepsiniKaydet([{ ad: 'a-onler.pdf', bytes: new Uint8Array([1]) }, { ad: 'a-arkalar.pdf', bytes: new Uint8Array([2]) }, { ad: 'a-ucuncu.pdf', bytes: new Uint8Array([3]) }], 'application/pdf');
  await bekle();
  assert.deepEqual(sira, ['basla a-onler.pdf'], 'ikinci pencere birinci bitmeden açılmadı');
  birinciBitir();
  const r = await soz;
  assert.deepEqual(sira, ['basla a-onler.pdf', 'bitti a-onler.pdf', 'basla a-arkalar.pdf', 'basla a-ucuncu.pdf']);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { kaydedilen: [{ ad: 'a-arkalar.pdf', yol: '/k/a-arkalar.pdf' }], vazgecilen: ['a-onler.pdf'], hatali: [{ ad: 'a-ucuncu.pdf', mesaj: 'disk dolu' }] });
});

test('kayitMesaji (D7): başarıda gerçek yol, vazgeçte "kaydedilmedi"; "hazır" yanlış başarısı yok', () => {
  const { P } = kurTauri();
  const tam = P.kayitMesaji({ kaydedilen: [{ ad: 'a.pdf', yol: '/K/a.pdf' }], vazgecilen: [], hatali: [] }, 24);
  assert.deepEqual({ ...tam }, { metin: 'Kaydedildi: /K/a.pdf (24 yüz).', tur: undefined });
  const iki = P.kayitMesaji({ kaydedilen: [{ ad: 'o.pdf', yol: '/K/o.pdf' }, { ad: 'a.pdf', yol: '/K/a.pdf' }], vazgecilen: [], hatali: [] }, 12);
  assert.equal(iki.metin, 'Kaydedildi: /K/o.pdf, /K/a.pdf (12 yüz).');
  const hic = P.kayitMesaji({ kaydedilen: [], vazgecilen: ['a.pdf'], hatali: [] }, 24);
  assert.equal(hic.tur, 'hata');
  assert.match(hic.metin, /kaydedilmedi/);
  const yarim = P.kayitMesaji({ kaydedilen: [{ ad: 'o.pdf', yol: '/K/o.pdf', yuz: 12 }], vazgecilen: ['a.pdf'], hatali: [] }, 24);
  assert.equal(yarim.tur, 'hata');
  assert.match(yarim.metin, /^Kaydedildi: \/K\/o\.pdf \(12 yüz\)\. Kaydedilmedi \(vazgeçildi\): a\.pdf\.$/);
  const hatali = P.kayitMesaji({ kaydedilen: [], vazgecilen: [], hatali: [{ ad: 'a.pdf', mesaj: 'yazılamadı: izin yok' }] }, 24);
  assert.equal(hatali.tur, 'hata');
  assert.equal(hatali.metin, 'a.pdf kaydedilemedi: yazılamadı: izin yok');
  for (const m of [tam, iki, hic, yarim, hatali]) assert.doesNotMatch(m.metin, /hazır/);
});

test('sonAcilaniAc: listedeki kayıt → son_acilani_oku → File; BULUNAMADI/ERISIM/BILINMEYEN anlaşılır hataya; listede yoksa Rust çağrılmaz', async () => {
  const liste = [{ kimlik: 'u1', ad: 'Tez.pdf', tur: 'pdf', tarih: 1 }, { kimlik: 'u2', ad: 'Silik.epub', tur: 'epub', tarih: 1 }, { kimlik: 'u3', ad: 'Izin.pdf', tur: 'pdf', tarih: 1 }];
  const s = kurTauri({ yanit: { son_acilanlar: liste, son_acilani_oku: (a) => {
    if (a.kimlik === 'u1') return ab('%PDF-tez');
    if (a.kimlik === 'u2') return Promise.reject('BULUNAMADI: The file couldn’t be opened');
    if (a.kimlik === 'u3') return Promise.reject('ERISIM: sistem dosyaya erişim vermedi');
    return Promise.reject('BILINMEYEN: son açılanlarda böyle bir kayıt yok');
  } } });
  const f = await s.P.sonAcilaniAc('u1');
  assert.equal(f.name, 'Tez.pdf');
  assert.equal(f.type, 'application/pdf');
  assert.equal(Buffer.from(await f.arrayBuffer()).toString(), '%PDF-tez');
  await assert.rejects(s.P.sonAcilaniAc('u2'), /^Error: Silik\.epub bulunamadı .*çıkarıldı\.$/);
  await assert.rejects(s.P.sonAcilaniAc('u3'), /Izin\.pdf açılamadı: sistem dosyaya yeniden erişim izni vermedi/);
  const once = s.cagri.length;
  await assert.rejects(s.P.sonAcilaniAc('/etc/hosts'), /artık yok/);
  assert.deepEqual(s.cagri.slice(once).map((c) => c.komut), ['son_acilanlar'], 'listede olmayan kimlik Rust\'a okutulmaz');
  // tarayıcıda: boş liste, null
  const t = kur({}).KitapCilt.platform;
  assert.equal((await t.sonAcilanlar()).length, 0);
  assert.equal(await t.sonAcilaniAc('u1'), null);
});

test('menuOlayi: Dosya öğeleri doğru düğmeyi/sekmeyi tetikler; Kaydet kapalıysa bildirim; son:<kimlik> belgeyi açar; kusurlu kimlik yok sayılır', async () => {
  const tik = [];
  const dugme = (id, disabled) => ({ disabled: !!disabled, click() { tik.push(id); } });
  const ogeler = { 'pdf-sec': dugme('pdf-sec'), 'disa-aktar': dugme('disa-aktar', true), 'json-disa': dugme('json-disa'), 'json-ice-dugme': dugme('json-ice-dugme') };
  const s = kurTauri({ ogeler, yanit: { son_acilanlar: [{ kimlik: 'u1', ad: 'Tez.pdf', tur: 'pdf' }], son_acilani_oku: () => ab('%PDF') } });
  s.P.menuOlayi('dosya-ac');
  s.P.menuOlayi('dosya-kaydet');
  assert.deepEqual(tik, ['pdf-sec'], 'kapalı Kaydet düğmesine tıklanmadı');
  assert.match(s.bildirimler.at(-1)[0], /Önce bir PDF/);
  ogeler['disa-aktar'].disabled = false;
  s.P.menuOlayi('dosya-kaydet');
  s.P.menuOlayi('json-disa');
  s.P.menuOlayi('json-ice');
  assert.deepEqual(tik, ['pdf-sec', 'disa-aktar', 'json-disa', 'json-ice-dugme']);
  assert.deepEqual(s.sekme, ['duzenle', 'duzenle', 'surec', 'surec']);
  await s.P.menuOlayi('son:u1');
  assert.deepEqual(s.acilan, [{ ad: 'Tez.pdf', tur: 'application/pdf', metin: '%PDF' }]);
  // olay yolu da aynı işi yapar
  await s.dinleyici.menu({ payload: 'sekme-hesapla' });
  assert.equal(s.sekme.at(-1), 'hesapla');
  const once = { tik: tik.length, acilan: s.acilan.length, cagri: s.cagri.length, bildirim: s.bildirimler.length, sekme: s.sekme.length };
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'son', 'dosya', '', null, undefined, 42, {}]) {
    assert.doesNotThrow(() => s.P.menuOlayi(k), String(k));
  }
  await bekle();
  assert.equal(tik.length, once.tik);
  assert.equal(s.acilan.length, once.acilan);
  assert.equal(s.cagri.length, once.cagri);
  assert.equal(s.bildirimler.length, once.bildirim, 'kusurlu kimlik bildirim de üretmez');
  assert.equal(s.sekme.length, once.sekme);
});

test('Son Açılanlar menüsünden açılamayan belge bildirime gider (Promise reddedilmez)', async () => {
  const s = kurTauri({ yanit: { son_acilanlar: [{ kimlik: 'u2', ad: 'Silik.epub', tur: 'epub' }], son_acilani_oku: () => Promise.reject('BULUNAMADI: yok') } });
  await s.P.menuOlayi('son:u2');
  assert.equal(s.acilan.length, 0);
  assert.match(s.bildirimler.at(-1)[0], /^Dosya açılamadı: Silik\.epub bulunamadı/);
  assert.equal(s.bildirimler.at(-1)[1], 'hata');
});

test('hazir: localStorage boşsa geçerli yedek geri yüklenir ve bildirilir; dolu, bozuk ya da okunamayan yedekte dokunulmaz', async () => {
  const lsYap = (ilk) => { const m = new Map(ilk ? [['kitapCilt.v1', ilk]] : []); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };
  const yedek = JSON.stringify({ surum: 1, kitaplar: [{ id: 'k1', ad: 'Çiğdemköy' }] });
  const bos = lsYap();
  const s = kurTauri({ ls: bos, yanit: { veri_oku: yedek, bekleyen_acilanlar: [] } });
  await s.P.hazir;
  assert.equal(bos.m.get('kitapCilt.v1'), yedek);
  s.zaman.calistir();
  assert.ok(s.bildirimler.some((b) => /otomatik yedekten geri/.test(b[0])));
  const dolu = lsYap('{"surum":1,"kitaplar":[]}');
  await kurTauri({ ls: dolu, yanit: { veri_oku: yedek } }).P.hazir;
  assert.equal(dolu.m.get('kitapCilt.v1'), '{"surum":1,"kitaplar":[]}', 'mevcut veri ezilmedi');
  for (const kotu of ['{bozuk', '{"kitaplar":5}', '[]', null, 42]) {
    const l = lsYap();
    await kurTauri({ ls: l, yanit: { veri_oku: kotu } }).P.hazir;
    assert.equal(l.m.has('kitapCilt.v1'), false, String(kotu));
  }
  const l = lsYap();
  const r = kurTauri({ ls: l, yanit: { veri_oku: () => Promise.reject('okunamadı') } });
  await r.P.hazir; // reddedilmez: uygulama başlar
  assert.equal(l.m.has('kitapCilt.v1'), false);
  // localStorage erişimi hata atarsa da başlar
  await kurTauri({ ls: { getItem() { throw new Error('kapalı'); } }, yanit: { veri_oku: yedek } }).P.hazir;
});

test('hazir: sayfa betikleri yüklenene (DOMContentLoaded) kadar bekler; Kaydet düğmesi metni değişir', async () => {
  const dugme = { textContent: "Dizilmiş PDF'i indir" };
  const s = kurTauri({ readyState: 'loading', ogeler: { 'disa-aktar': dugme }, yanit: { veri_oku: null, bekleyen_acilanlar: [] } });
  let bitti = false;
  s.P.hazir.then(() => { bitti = true; });
  await bekle();
  assert.equal(bitti, false, 'DOMContentLoaded öncesi hazır değil');
  assert.deepEqual(s.cagri, [], 'yedek DOM hazır olmadan okunmaz');
  s.belgeDinleyici.DOMContentLoaded.forEach((f) => f());
  await s.P.hazir;
  assert.equal(dugme.textContent, "Dizilmiş PDF'i kaydet…");
});

test('depo yedeği: yaz/temizle asıl işlevi çağırır, sonucu korur, son hali yedekler; veri_yedekle reddi bildirilir', async () => {
  const s = kurTauri({ yanit: { veri_oku: null, bekleyen_acilanlar: [], veri_yedekle: undefined } });
  await s.P.hazir;
  s.zaman.calistir();
  const D = s.KC.depo;
  assert.equal(D.yaz({ surum: 1, kitaplar: [{ id: 'a' }] }), true, 'asıl yaz sonucu korunur');
  D.yaz({ surum: 1, kitaplar: [{ id: 'b' }] });
  const y = s.cagri.filter((c) => c.komut === 'veri_yedekle');
  assert.deepEqual(JSON.parse(y.at(-1).arg.json), { surum: 1, kitaplar: [{ id: 'b' }] }, 'son hali');
  assert.deepEqual(D.yazilan.map((v) => (v.kitaplar ? v.kitaplar[0].id : v)), ['a', 'b'], 'asıl yaz çağrıldı');
  D.temizle();
  assert.equal(D.yazilan.at(-1), 'TEMIZLE', 'asıl temizle çağrıldı');
  assert.deepEqual(JSON.parse(s.cagri.filter((c) => c.komut === 'veri_yedekle').at(-1).arg.json), { surum: 1, kitaplar: [] }, 'temizle → boş veri yedeklenir');
  assert.equal(s.zaman.kuyruk.length, 0, 'JS tarafında zamanlayıcı yok (bekletme Rust\'ta)');
  // yedek reddedilirse (geçersiz/çok büyük) bildirim
  const h = kurTauri({ yanit: { veri_oku: null, bekleyen_acilanlar: [], veri_yedekle: () => Promise.reject('yedek çok büyük (17000000 bayt)') } });
  await h.P.hazir;
  h.KC.depo.yaz({ surum: 1, kitaplar: [] });
  await bekle();
  assert.ok(h.bildirimler.some((b) => /otomatik yedeği yazılamadı: yedek çok büyük/.test(b[0]) && b[1] === 'hata'));
});

test('dış açılış (Dock/Finder): hazır olmadan gelen olay yok sayılır, açılışta kuyruk boşaltılır; sonra olayla açılır', async () => {
  let kuyruk = [{ kimlik: 'd1', ad: 'Bir.pdf', tur: 'pdf' }, { kimlik: 'd2', ad: 'Iki.epub', tur: 'epub' }];
  const s = kurTauri({ readyState: 'loading', yanit: {
    veri_oku: null,
    bekleyen_acilanlar: () => { const k = kuyruk; kuyruk = []; return k; },
    dosya_oku: (a) => ab('icerik-' + a.kimlik),
  } });
  s.dinleyici['dosya-acildi']({});
  await bekle();
  assert.equal(s.cagri.filter((c) => c.komut === 'bekleyen_acilanlar').length, 0, 'hazır olmadan kuyruk okunmaz');
  s.belgeDinleyici.DOMContentLoaded.forEach((f) => f());
  await s.P.hazir;
  s.zaman.calistir();
  for (let i = 0; i < 10; i++) await bekle();
  assert.deepEqual(s.acilan.map((a) => [a.ad, a.tur, a.metin]), [['Bir.pdf', 'application/pdf', 'icerik-d1'], ['Iki.epub', 'application/epub+zip', 'icerik-d2']], 'sırayla, son açılan en son');
  kuyruk = [{ kimlik: 'd3', ad: 'Uc.pdf', tur: 'pdf' }];
  s.dinleyici['dosya-acildi']({});
  for (let i = 0; i < 10; i++) await bekle();
  assert.equal(s.acilan.at(-1).ad, 'Uc.pdf');
});

// ----------------------------------------------------------------
test('O2 temizle: boş veri yedeği HEMEN gider (zamanlayıcı beklenmez; ⌘Q arada gelse de eski dolu yedek kalmaz)', async () => {
  const s = kurTauri({ yanit: { veri_oku: null, bekleyen_acilanlar: [], veri_yedekle: undefined } });
  await s.P.hazir;
  s.zaman.calistir();
  s.KC.depo.temizle();
  const y = s.cagri.filter((c) => c.komut === 'veri_yedekle');
  assert.equal(y.length, 1, 'temizle anında veri_yedekle (zamanlayıcı çalıştırılmadan)');
  assert.deepEqual(JSON.parse(y[0].arg.json), { surum: 1, kitaplar: [] });
});

test('O2 yaz: her değişiklik Rust\'a hemen gider (bekletme ve kapanışta yazma Rust\'ta); oturum + artan sıra', async () => {
  const s = kurTauri({ yanit: { veri_oku: null, bekleyen_acilanlar: [], veri_yedekle: undefined } });
  await s.P.hazir;
  s.zaman.calistir();
  s.KC.depo.yaz({ surum: 1, kitaplar: [{ id: 'a' }] });
  s.KC.depo.yaz({ surum: 1, kitaplar: [{ id: 'b' }] });
  const y = s.cagri.filter((c) => c.komut === 'veri_yedekle');
  assert.equal(y.length, 2, 'zamanlayıcı beklenmeden iki çağrı');
  assert.deepEqual(y.map((c) => JSON.parse(c.arg.json).kitaplar[0].id), ['a', 'b']);
  assert.equal(typeof y[0].arg.oturum, 'string');
  assert.ok(y[0].arg.oturum.length >= 8, 'oturum kimliği');
  assert.equal(y[0].arg.oturum, y[1].arg.oturum, 'aynı sayfa aynı oturum');
  assert.ok(Number.isSafeInteger(y[0].arg.sira) && y[1].arg.sira > y[0].arg.sira, 'sıra artar');
  const baska = kurTauri({ yanit: { veri_oku: null, bekleyen_acilanlar: [] } });
  await baska.P.hazir;
  baska.KC.depo.yaz({ surum: 1, kitaplar: [] });
  assert.notEqual(baska.cagri.find((c) => c.komut === 'veri_yedekle').arg.oturum, y[0].arg.oturum, 'yeni sayfa yeni oturum');
});

test('O2 boş yedek (kasıtlı temizlik) geri yüklenmez, "geri yüklendi" bildirimi çıkmaz', async () => {
  const lsYap = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };
  const l = lsYap();
  const s = kurTauri({ ls: l, yanit: { veri_oku: JSON.stringify({ surum: 1, kitaplar: [] }), bekleyen_acilanlar: [] } });
  await s.P.hazir;
  s.zaman.calistir();
  assert.equal(l.m.has('kitapCilt.v1'), false, 'boş yedek localStorage\'a yazılmaz');
  assert.ok(!s.bildirimler.some((b) => /geri yüklendi/.test(b[0])), 'bildirim yok: ' + JSON.stringify(s.bildirimler));
});

test('O2 Rust\'taki gecikmeli yazım başarısızsa (yedek-yazilamadi olayı) bildirilir', async () => {
  const s = kurTauri({ yanit: { veri_oku: null, bekleyen_acilanlar: [] } });
  await s.P.hazir;
  assert.equal(typeof s.dinleyici['yedek-yazilamadi'], 'function', 'olay dinleniyor');
  s.dinleyici['yedek-yazilamadi']({ payload: 'yedek yazılamadı: disk dolu' });
  assert.ok(s.bildirimler.some((b) => /otomatik yedeği yazılamadı: yedek yazılamadı: disk dolu/.test(b[0]) && b[1] === 'hata'));
});

test('O4 sonAcilaniAc: yalnız BULUNAMADI/GECERSIZ "çıkarıldı" der; ERISIM/DISKYOK/GECICI kaydın durduğunu ayrı metinle söyler', async () => {
  const liste = ['b', 'g', 'e', 'd', 'c'].map((k) => ({ kimlik: k, ad: k.toUpperCase() + '.pdf', tur: 'pdf', tarih: 1 }));
  const kod = { b: 'BULUNAMADI: The file doesn’t exist.', g: 'GECERSIZ: tür uyuşmuyor', e: 'ERISIM: sistem dosyaya erişim vermedi', d: 'DISKYOK: Yedek Disk', c: 'GECICI: Resource deadlock avoided' };
  const s = kurTauri({ yanit: { son_acilanlar: liste, son_acilani_oku: (a) => Promise.reject(kod[a.kimlik]) } });
  const m = {};
  for (const k of Object.keys(kod)) m[k] = await s.P.sonAcilaniAc(k).then(() => null, (e) => e.message);
  assert.match(m.b, /^B\.pdf bulunamadı .*Son Açılanlar'dan çıkarıldı\.$/);
  assert.match(m.g, /^G\.pdf .*çıkarıldı\.$/);
  for (const k of ['e', 'd', 'c']) {
    assert.doesNotMatch(m[k], /çıkarıldı/, k + ': ' + m[k]);
    assert.match(m[k], /Son Açılanlar'da duruyor/, k + ': ' + m[k]);
  }
  assert.match(m.e, /^E\.pdf açılamadı: sistem dosyaya yeniden erişim izni vermedi/);
  assert.match(m.d, /^D\.pdf açılamadı: bulunduğu disk \(Yedek Disk\) takılı değil/);
  assert.match(m.c, /^C\.pdf şu an açılamadı \(Resource deadlock avoided\)/);
  assert.equal(new Set(Object.values(m)).size, 5, 'beş ayrı metin');
});

test('D9 kayitMesaji: kısmi kayıtta yalnız kaydedilen dosyaların yüz sayısı; hepsiniKaydet dosya başına yüzü taşır', async () => {
  const { P } = kurTauri();
  const yarim = P.kayitMesaji({ kaydedilen: [{ ad: 'o.pdf', yol: '/K/o.pdf', yuz: 12 }], vazgecilen: ['a.pdf'], hatali: [] }, 24);
  assert.equal(yarim.metin, 'Kaydedildi: /K/o.pdf (12 yüz). Kaydedilmedi (vazgeçildi): a.pdf.');
  const iki = P.kayitMesaji({ kaydedilen: [{ ad: 'o.pdf', yol: '/K/o.pdf', yuz: 12 }, { ad: 'a.pdf', yol: '/K/a.pdf', yuz: 12 }], vazgecilen: [], hatali: [] }, 24);
  assert.equal(iki.metin, 'Kaydedildi: /K/o.pdf, /K/a.pdf (24 yüz).');
  const bilgisiz = P.kayitMesaji({ kaydedilen: [{ ad: 'o.pdf', yol: '/K/o.pdf' }], vazgecilen: ['a.pdf'], hatali: [] }, 24);
  assert.equal(bilgisiz.metin, 'Kaydedildi: /K/o.pdf. Kaydedilmedi (vazgeçildi): a.pdf.', 'dosya başı bilgi yoksa toplam yazılmaz');
  const s = kurTauri({ yanit: { dosya_kaydet: (b, o) => { const ad = decodeURIComponent(o.headers['x-ad']); return ad === 'x-onler.pdf' ? { ad, yol: '/K/' + ad } : null; } } });
  const r = await s.P.hepsiniKaydet([{ ad: 'x-onler.pdf', bytes: new Uint8Array([1]), yuz: 6 }, { ad: 'x-arkalar.pdf', bytes: new Uint8Array([2]), yuz: 6 }], 'application/pdf');
  assert.deepEqual(JSON.parse(JSON.stringify(r.kaydedilen)), [{ ad: 'x-onler.pdf', yol: '/K/x-onler.pdf', yuz: 6 }]);
  assert.equal(s.P.kayitMesaji(r, 12).metin, 'Kaydedildi: /K/x-onler.pdf (6 yüz). Kaydedilmedi (vazgeçildi): x-arkalar.pdf.');
});

test('D10 ⌘S: dizilmiş PDF hazırlanırken / Kaydet penceresi açıkken (düğme aria-busy) yok sayılır; yanlış "Önce bir PDF" yok', () => {
  const tik = [];
  const dugme = { disabled: true, getAttribute: (a) => (a === 'aria-busy' ? 'true' : null), click() { tik.push('disa-aktar'); } };
  const s = kurTauri({ ogeler: { 'disa-aktar': dugme } });
  s.P.menuOlayi('dosya-kaydet');
  assert.deepEqual(tik, []);
  assert.deepEqual(s.bildirimler, [], 'bildirim yok: ' + JSON.stringify(s.bildirimler));
  dugme.getAttribute = () => null; // meşgul değil, kapalı → eski bildirim
  s.P.menuOlayi('dosya-kaydet');
  assert.match(s.bildirimler.at(-1)[0], /Önce bir PDF/);
});

// ---------------------------------------------------------------- düzeltme
const lsBellek = (ilk = {}) => { const m = new Map(Object.entries(ilk)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const sonDilAyar = (s) => s.cagri.filter((c) => c.komut === 'dil_ayarla').map((c) => ({ ...c.arg })).slice(-1)[0];

test('Tauri\'de sistem dili Rust\'tan gelir (dil_oku.sistem; menü ile aynı kaynak); elle seçim yoksa arayüz o dilde', async () => {
  // WKWebView navigator.languages tr-TR derken macOS tercihi (Apple kuralı) en: arayüz ve "Sistem dili (X)" Rust'a uyar
  const s = kurTauri({ dil: 'tr', ls: lsBellek(), yanit: { dil_oku: { kod: 'en', secim: 'sistem', sistem: 'en' }, veri_oku: null, bekleyen_acilanlar: [] } });
  await s.P.hazir;
  const D = s.KC.dil;
  assert.equal(D.sistemKodu(), 'en');
  assert.equal(D.kod(), 'en');
  assert.deepEqual(sonDilAyar(s), { kod: 'en', secim: 'sistem' });
  // elle seçim varsa o kalır; sistem dili yine Rust'ınki
  const e = kurTauri({ dil: 'tr', ls: lsBellek({ 'kitapCilt.dil': 'tr' }), yanit: { dil_oku: { kod: 'tr', secim: 'tr', sistem: 'en' }, veri_oku: null, bekleyen_acilanlar: [] } });
  await e.P.hazir;
  assert.equal(e.KC.dil.kod(), 'tr');
  assert.equal(e.KC.dil.sistemKodu(), 'en');
  assert.deepEqual(sonDilAyar(e), { kod: 'tr', secim: 'tr' });
  // Rust tersini söylüyorsa (macOS tr, tarayıcı en) da Rust
  const t = kurTauri({ dil: 'en', ls: lsBellek(), yanit: { dil_oku: { kod: 'tr', secim: 'sistem', sistem: 'tr' }, veri_oku: null, bekleyen_acilanlar: [] } });
  await t.P.hazir;
  assert.equal(t.KC.dil.kod(), 'tr');
});

test('dil_oku eski/kusurlu yanıt (sistem yok, desteklenmeyen, hata) başlatmayı durdurmaz; tarayıcı dili kalır', async () => {
  for (const y of [{ kod: 'tr', secim: 'sistem' }, { kod: 'tr', secim: 'sistem', sistem: 'xx' }, { kod: 'tr', secim: 'sistem', sistem: 5 }, null, () => Promise.reject(new Error('yok'))]) {
    const s = kurTauri({ dil: 'tr', ls: lsBellek(), yanit: { dil_oku: y, veri_oku: null, bekleyen_acilanlar: [] } });
    await s.P.hazir;
    assert.equal(s.KC.dil.kod(), 'tr', String(y && JSON.stringify(y)));
    assert.equal(s.KC.dil.sistemKodu(), 'tr', String(y && JSON.stringify(y)));
  }
});

test('Mac uygulamasında tarayıcıya özgü metinler Mac metniyle (saklama ipucu, saklama uyarısı, denetim uyarısı); tarayıcıda eskisi', async () => {
  const ipucuYap = () => ({ textContent: '', nitelik: { 'data-dil': 'surec.saklama_ipucu' }, setAttribute(a, v) { this.nitelik[a] = v; }, getAttribute(a) { return this.nitelik[a]; } });
  const ipucu = ipucuYap();
  const s = kurTauri({ dil: 'en', ls: lsBellek(), ogeler: { 'saklama-ipucu': ipucu }, yanit: { dil_oku: { kod: 'en', secim: 'sistem', sistem: 'en' }, veri_oku: null, bekleyen_acilanlar: [] } });
  assert.equal(ipucu.nitelik['data-dil'], 'tauri.saklama_ipucu', 'betik yüklenince (hazir beklenmeden) değişir');
  assert.match(ipucu.textContent, /this Mac/);
  assert.doesNotMatch(ipucu.textContent, /browser/i);
  for (const ad of ['saklamaUyari', 'denetimUyari']) {
    assert.match(s.P.metin[ad], /\S/, ad);
    assert.doesNotMatch(s.P.metin[ad], /browser|private window|reload the page/i, ad);
  }
  await s.P.hazir;
  // tarayıcı: eski metinler (anahtarlar aynı)
  const b = kur({});
  const D = b.KitapCilt.dil;
  assert.equal(b.KitapCilt.platform.metin.saklamaUyari, D.t('surec.uyari.saklama'));
  assert.equal(b.KitapCilt.platform.metin.denetimUyari, D.t('duzenle.uyari.denetim'));
  // Türkçede de (tarayıcı metni "tarayıcı" der, Mac metni demez)
  const ipucuTr = ipucuYap();
  const tr = kurTauri({ dil: 'tr', ls: lsBellek(), ogeler: { 'saklama-ipucu': ipucuTr } });
  assert.match(ipucuTr.textContent, /Mac/);
  assert.doesNotMatch(ipucuTr.textContent, /tarayıcı/i);
  assert.match(tr.P.metin.saklamaUyari, /\S/);
  assert.doesNotMatch(tr.P.metin.saklamaUyari + tr.P.metin.denetimUyari, /tarayıcı|gizli pencere|sayfayı yenile/i);
});

// ----------------------------------------------------------------
test('dil.js yoksa (KC.dil yok) platform-tauri.js yüklenirken hata atmaz; metinler yüklü en sözlüğünden, o da yoksa anahtar', async () => {
  const ipucu = { nitelik: {}, textContent: 'statik', setAttribute(a, v) { this.nitelik[a] = v; } };
  const belge = { readyState: 'complete', getElementById: (id) => (id === 'saklama-ipucu' ? ipucu : null) };
  const calistir = (enSozluk) => {
    const T = sahteTauri(true);
    const cagri = [];
    T.core.invoke = (k) => { cagri.push(k); return Promise.resolve(k === 'veri_oku' ? null : k === 'bekleyen_acilanlar' ? [] : null); };
    const ctx = { __TAURI__: T, document: belge, setTimeout: () => 0, Blob };
    ctx.self = ctx;
    vm.createContext(ctx);
    if (enSozluk) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'dil', 'en.js'), 'utf8'), ctx);
    vm.runInContext(oku('platform.js'), ctx, { filename: 'platform.js' });
    vm.runInContext(oku('platform-tauri.js'), ctx, { filename: 'platform-tauri.js' }); // atarsa test KALDI
    return { P: ctx.KitapCilt.platform, cagri };
  };
  const { P, cagri } = calistir(true);
  assert.equal(P.ad, 'tauri');
  assert.equal(typeof P.onayla, 'function');
  assert.match(ipucu.textContent, /stored on this Mac/);
  assert.match(P.metin.kutuphaneIpucu, /^[A-Z]/);
  await P.hazir; // dil adımı atlanır, yedek okunur; reddedilmez
  assert.ok(!cagri.includes('dil_oku') && cagri.includes('veri_oku'), JSON.stringify(cagri));
  assert.equal(P.kayitMesaji({ kaydedilen: [], vazgecilen: ['a.pdf'], hatali: [] }).metin, "The imposed PDF wasn't saved (the Save dialog was canceled).");
  // en sözlüğü de yoksa anahtar (yine hata yok)
  ipucu.textContent = 'statik';
  calistir(false);
  assert.equal(ipucu.textContent, 'tauri.saklama_ipucu');
});

// ---------------------------------------------------------------- yazdırma
test('tarayıcı: yazdir ve onizlemedeAc yok (Yazdır düğmesi gizli kalır)', () => {
  const P = kur({}).KitapCilt.platform;
  assert.equal(P.yazdir, null);
  assert.equal(P.onizlemedeAc, null);
});

test('yazdir: Rust yazdir komutuna ham PDF baytı + x-ad (ASCII); true → true, false/garip yanıt → false, hata → red', async () => {
  const yanitlar = [true, false, 'evet', null];
  const s = kurTauri({ yanit: { yazdir: () => yanitlar.shift(), onizlemede_ac: (b, o) => decodeURIComponent(o.headers['x-ad']) } });
  assert.equal(await s.P.yazdir('Çiğdemköy-onler.pdf', new Uint8Array([37, 80, 68, 70])), true);
  const c = s.cagri.filter((x) => x.komut === 'yazdir');
  assert.ok(ArrayBuffer.isView(c[0].arg) && [...c[0].arg].join() === '37,80,68,70', 'gövde ham bayt');
  assert.equal(c[0].secenek.headers['x-ad'], encodeURIComponent('Çiğdemköy-onler.pdf'));
  assert.match(c[0].secenek.headers['x-ad'], /^[\x21-\x7e]+$/);
  assert.equal(await s.P.yazdir('a.pdf', 'x'), false);
  assert.equal(await s.P.yazdir('a.pdf', 'x'), false, '"evet" dizesi başarı sayılmaz');
  assert.equal(await s.P.yazdir('a.pdf', 'x'), false);
  const h = kurTauri({ yanit: { yazdir: () => Promise.reject('bu platformda yazdırma henüz yok') } });
  await assert.rejects(h.P.yazdir('a.pdf', 'x'), /henüz yok/);
  assert.equal((await s.P.onizlemedeAc('Ç.pdf', new Uint8Array([1]))).ad, 'Ç.pdf');
  const o = kurTauri({ yanit: { onizlemede_ac: () => Promise.reject('izin yok') } });
  await assert.rejects(o.P.onizlemedeAc('a.pdf', 'x'), /izin yok/);
});

test('menü ⌘P / ⌥⌘P: Düzenle\'deki düğmeye basar; meşgul (aria-busy) → yok sayılır; kapalı/gizli → "Önce bir PDF açın" bildirimi', () => {
  const tik = [];
  const dugme = (id, d = {}) => ({ disabled: !!d.disabled, hidden: !!d.hidden, mesgul: !!d.mesgul, click() { tik.push(id); }, getAttribute(a) { return a === 'aria-busy' && this.mesgul ? 'true' : null; } });
  const ogeler = { yazdir: dugme('yazdir', { disabled: true }), 'onizlemede-ac': dugme('onizlemede-ac', { hidden: true }) };
  const s = kurTauri({ ogeler });
  s.P.menuOlayi('dosya-yazdir');
  s.P.menuOlayi('dosya-onizleme');
  assert.deepEqual(tik, []);
  assert.deepEqual(s.bildirimler.map((b) => b[0]), ['Önce bir PDF açın, sonra yazdırın.', 'Önce bir PDF açın, sonra yazdırın.']);
  ogeler.yazdir.disabled = false; ogeler['onizlemede-ac'].hidden = false;
  s.P.menuOlayi('dosya-yazdir');
  s.P.menuOlayi('dosya-onizleme');
  assert.deepEqual(tik, ['yazdir', 'onizlemede-ac']);
  assert.deepEqual(s.sekme.slice(-2), ['duzenle', 'duzenle']);
  ogeler.yazdir.mesgul = true;
  const n = s.bildirimler.length;
  s.P.menuOlayi('dosya-yazdir');
  assert.deepEqual([tik.length, s.bildirimler.length], [2, n], 'baskı/kaydet sürerken ⌘P yok sayılır, yanlış bildirim yok');
});
