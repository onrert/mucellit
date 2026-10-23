'use strict';
// tools/prepare-dist.mjs: gerçek app/ ile çıktı, kusurlu girdilerle (boş, iskelet, eksik/boş lisans, lisanssız
// vendor, çakışan hedef, repo dışı hedef, işaretsiz dolu hedef, olmayan kaynak) çıkış kodu 1.
// Her test betiğin bir kopyasını geçici bir "sahte repo"nun tools/ klasörüne koyar: betik repo kökünü kendi
// konumundan bulduğu için hedefin "repo içinde" kuralı gerçek repoya dokunmadan sınanır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BETIK = path.join(__dirname, '..', '..', 'tools', 'prepare-dist.mjs');
const APP = path.join(__dirname, '..');
const ISARET_ONEK = '.';
const ISARET_SONEK = '.dist-hazirla';

const GECICILER = [];
function gecici() { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kc-dist-'))); GECICILER.push(d); return d; }
test.after(() => { for (const d of GECICILER) fs.rmSync(d, { recursive: true, force: true }); });

/** Betiğin kopyasını taşıyan geçici repo kökü. */
function sahteRepo() {
  const r = gecici();
  fs.mkdirSync(path.join(r, 'tools'));
  fs.copyFileSync(BETIK, path.join(r, 'tools', 'prepare-dist.mjs'));
  return r;
}
function kos(repo, ...argv) {
  const r = spawnSync(process.execPath, [path.join(repo, 'tools', 'prepare-dist.mjs'), ...argv], { encoding: 'utf8' });
  return { kod: r.status, cikti: r.stdout + r.stderr };
}
function yaz(kok, goreli, icerik = 'x') {
  const y = path.join(kok, goreli);
  fs.mkdirSync(path.dirname(y), { recursive: true });
  fs.writeFileSync(y, icerik);
}
function listele(kok) {
  const l = [];
  (function gez(d) {
    for (const g of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, g.name);
      if (g.isDirectory()) gez(y); else l.push(path.relative(kok, y).split(path.sep).join('/'));
    }
  })(kok);
  return l.sort();
}
const LISANS = 'MIT License\n\nCopyright (c) 2026 Deneme Yazari\n\nPermission is hereby granted, free of charge, to any person obtaining a copy '
  + 'of this software and associated documentation files (the "Software"), to deal in the Software without restriction.\n';
// js/learn/LICENSE (Öğren rehberinin Colorfigures motoru, MIT) da zorunlu lisans
const LISANSLAR = ['vendor/pdf-lib/LICENSE.md', 'vendor/pdfjs/LICENSE', 'vendor/fontkit/LICENSE', 'vendor/literata/OFL.txt', 'js/learn/LICENSE'];
/** Geçerli en küçük kaynak ağacı (repo içinde app-xxx/). */
function iskelet(repo) {
  const k = fs.mkdtempSync(path.join(repo, 'app-'));
  for (const g of ['index.html', 'vendor/SOURCES.md', 'vendor/pdf-lib/pdf-lib.min.js', 'vendor/literata/literata-regular.js', 'js/a.js']) yaz(k, g);
  for (const g of LISANSLAR) yaz(k, g, LISANS);
  return k;
}
const isaretYolu = (hedef) => path.join(path.dirname(hedef), ISARET_ONEK + path.basename(hedef) + ISARET_SONEK);

test('gerçek app/: çıkış 0; test/, .ttf ve gizli dosya yok; lisanslar ve index.html var; JS sayısı kaynakla aynı', () => {
  const repo = sahteRepo();
  const h = path.join(repo, 'dist');
  const r = kos(repo, '--kaynak', APP, '--hedef', h, '--sessiz');
  assert.equal(r.kod, 0, r.cikti);
  const l = listele(h);
  assert.deepEqual(l.filter((g) => g.startsWith('test/') || /\.ttf$/i.test(g) || g.split('/').some((p) => p.startsWith('.'))), []);
  for (const g of ['index.html', 'vendor/SOURCES.md', 'js/platform.js', 'js/platform-tauri.js', 'vendor/literata/literata-regular.js', ...LISANSLAR]) assert.ok(l.includes(g), g);
  const kaynakJs = listele(APP).filter((g) => g.endsWith('.js') && !g.startsWith('test/') && !g.split('/').some((p) => p.startsWith('.')));
  assert.deepEqual(l.filter((g) => g.endsWith('.js')), kaynakJs);
});

test('iskelet: çıkış 0; iç içe .ttf, kökteki test/ ve .DS_Store atlanır; js/test/ (kök dışı) kopyalanır', () => {
  const repo = sahteRepo();
  const k = iskelet(repo);
  yaz(k, 'test/e2e.mjs'); yaz(k, 'test/fixtures/a.pdf'); yaz(k, 'vendor/literata/Literata-Regular.ttf'); yaz(k, 'css/B.TTF');
  yaz(k, '.DS_Store'); yaz(k, 'js/.DS_Store'); yaz(k, 'js/test/ic.js');
  const h = path.join(repo, 'dist');
  const r = kos(repo, '--kaynak', k, '--hedef', h);
  assert.equal(r.kod, 0, r.cikti);
  const l = listele(h);
  assert.ok(!l.some((g) => g.startsWith('test/') || /\.ttf$/i.test(g) || g.includes('.DS_Store')), l.join(','));
  assert.ok(l.includes('js/test/ic.js'));
  assert.match(r.cikti, /- test\/ \(hariç\)/);
});

test('D5: gizli dosya ve klasörler (.env, .git/, js/.gizli.js, vendor/*/.npmignore) pakete girmez', () => {
  const repo = sahteRepo();
  const k = iskelet(repo);
  yaz(k, '.env', 'ANAHTAR=gizli'); yaz(k, '.git/config'); yaz(k, 'js/.gizli.js'); yaz(k, 'vendor/pdfjs/.npmignore'); yaz(k, 'css/.eski/style.css');
  const h = path.join(repo, 'dist');
  const r = kos(repo, '--kaynak', k, '--hedef', h);
  assert.equal(r.kod, 0, r.cikti);
  const l = listele(h);
  assert.deepEqual(l.filter((g) => g.split('/').some((p) => p.startsWith('.'))), [], l.join(','));
  assert.ok(l.includes('js/a.js') && l.includes('index.html'));
  for (const g of ['.env', '.git/', 'js/.gizli.js', 'vendor/pdfjs/.npmignore', 'css/.eski/']) assert.ok(r.cikti.includes(`- ${g} (hariç)`), g);
});

test('O3: işaret dosyası hedefin YANINA yazılır (paketin içine değil); yeniden hazırlamada eski kalıntı kalmaz', () => {
  const repo = sahteRepo();
  const k = iskelet(repo);
  const h = path.join(repo, 'dist');
  assert.equal(kos(repo, '--kaynak', k, '--hedef', h, '--sessiz').kod, 0);
  assert.ok(fs.existsSync(isaretYolu(h)), 'işaret dosyası yok');
  assert.ok(!listele(h).some((g) => g.includes('dist-hazirla')), 'işaret paketin içinde');
  yaz(h, 'eski-kalinti.txt');
  const r = kos(repo, '--kaynak', k, '--hedef', h, '--sessiz');
  assert.equal(r.kod, 0, r.cikti);
  assert.ok(!fs.existsSync(path.join(h, 'eski-kalinti.txt')));
});

test('O3: var olan BOŞ hedef klasör (işaretsiz) kabul edilir', () => {
  const repo = sahteRepo();
  const k = iskelet(repo);
  const h = path.join(repo, 'bos-dist');
  fs.mkdirSync(h);
  assert.equal(kos(repo, '--kaynak', k, '--hedef', h, '--sessiz').kod, 0);
  assert.ok(fs.existsSync(path.join(h, 'index.html')));
});

test('O3 kusurlu: dolu ve işaretsiz hedef (ör. --hedef src-tauri) → çıkış 1, içerik silinmez', () => {
  const repo = sahteRepo();
  const k = iskelet(repo);
  const h = path.join(repo, 'src-tauri');
  yaz(h, 'Cargo.toml', '[package]'); yaz(h, 'src/lib.rs', 'fn main() {}');
  const r = kos(repo, '--kaynak', k, '--hedef', h);
  assert.equal(r.kod, 1, r.cikti);
  assert.match(r.cikti, /işaret/);
  assert.deepEqual(listele(h), ['Cargo.toml', 'src/lib.rs']);
});

test('O3 kusurlu: başka hedefin işaret dosyası kopyalanmış ya da işareti boş/bozuk dolu hedef → çıkış 1', () => {
  const repo = sahteRepo();
  const k = iskelet(repo);
  const dist = path.join(repo, 'dist');
  assert.equal(kos(repo, '--kaynak', k, '--hedef', dist, '--sessiz').kod, 0);
  const h = path.join(repo, 'belgeler');
  yaz(h, 'onemli.md', 'silinmemeli');
  fs.copyFileSync(isaretYolu(dist), isaretYolu(h));
  assert.equal(kos(repo, '--kaynak', k, '--hedef', h).kod, 1, 'kopya işaret');
  fs.writeFileSync(isaretYolu(h), '');
  assert.equal(kos(repo, '--kaynak', k, '--hedef', h).kod, 1, 'boş işaret');
  fs.writeFileSync(isaretYolu(h), '{bozuk');
  assert.equal(kos(repo, '--kaynak', k, '--hedef', h).kod, 1, 'bozuk işaret');
  fs.writeFileSync(isaretYolu(h), JSON.stringify({ arac: 'dist-hazirla' }));
  assert.equal(kos(repo, '--kaynak', k, '--hedef', h).kod, 1, 'hedefsiz işaret');
  assert.ok(fs.existsSync(path.join(h, 'onemli.md')));
});

test('O3 kusurlu: repo dışındaki hedef (mutlak yol, ../ ile çıkış, repo dışını gösteren bağ) → çıkış 1, dokunulmaz', () => {
  const repo = sahteRepo();
  const k = iskelet(repo);
  const dis = gecici();
  yaz(dis, 'kisisel.txt', 'dokunma');
  assert.equal(kos(repo, '--kaynak', k, '--hedef', dis).kod, 1, 'mutlak dış yol');
  assert.equal(kos(repo, '--kaynak', k, '--hedef', path.join(dis, 'yeni-dist')).kod, 1, 'dışarıda yeni klasör');
  assert.ok(!fs.existsSync(path.join(dis, 'yeni-dist')));
  assert.equal(kos(repo, '--kaynak', k, '--hedef', path.join(repo, 'dist', '..', '..', path.basename(dis))).kod, 1, '../ ile çıkış');
  fs.symlinkSync(dis, path.join(repo, 'bag'));
  assert.equal(kos(repo, '--kaynak', k, '--hedef', path.join(repo, 'bag')).kod, 1, 'dışarıyı gösteren bağ');
  assert.equal(kos(repo, '--kaynak', k, '--hedef', path.join(repo, 'bag', 'dist')).kod, 1, 'bağın altındaki yeni klasör');
  assert.deepEqual(listele(dis), ['kisisel.txt']);
});

test('O3 kusurlu: hedef bir dosya ya da repo kökü → çıkış 1', () => {
  const repo = sahteRepo();
  const k = iskelet(repo);
  yaz(repo, 'README.md', 'okubeni');
  assert.equal(kos(repo, '--kaynak', k, '--hedef', path.join(repo, 'README.md')).kod, 1);
  assert.equal(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), 'okubeni');
  assert.equal(kos(repo, '--kaynak', k, '--hedef', repo).kod, 1);
  assert.ok(fs.existsSync(path.join(repo, 'tools', 'prepare-dist.mjs')));
});

test('kusurlu: boş kaynak klasör → çıkış 1, eksikler adlandırılır', () => {
  const repo = sahteRepo();
  const r = kos(repo, '--kaynak', fs.mkdtempSync(path.join(repo, 'bos-')), '--hedef', path.join(repo, 'dist'));
  assert.equal(r.kod, 1);
  assert.match(r.cikti, /index\.html/);
  assert.match(r.cikti, /OFL\.txt/);
});

test('kusurlu: tek bir lisans eksik (pdfjs/LICENSE) → çıkış 1 ve hedef oluşmaz', () => {
  const repo = sahteRepo();
  const k = iskelet(repo);
  fs.rmSync(path.join(k, 'vendor/pdfjs/LICENSE'));
  const h = path.join(repo, 'dist');
  const r = kos(repo, '--kaynak', k, '--hedef', h);
  assert.equal(r.kod, 1);
  assert.match(r.cikti, /vendor\/pdfjs\/LICENSE/);
  assert.ok(!fs.existsSync(h));
});

test('kusurlu: Öğren lisansı (js/learn/LICENSE) eksik ya da boş → çıkış 1, dosya adlandırılır, hedef oluşmaz', () => {
  for (const [ad, boz] of [['eksik', (y) => fs.rmSync(y)], ['boş', (y) => fs.writeFileSync(y, '')], ['iskelet', (y) => fs.writeFileSync(y, 'MIT License\n')]]) {
    const repo = sahteRepo();
    const k = iskelet(repo);
    boz(path.join(k, 'js/learn/LICENSE'));
    const h = path.join(repo, 'dist');
    const r = kos(repo, '--kaynak', k, '--hedef', h);
    assert.equal(r.kod, 1, ad);
    assert.match(r.cikti, /js\/learn\/LICENSE/, ad);
    assert.ok(!fs.existsSync(h), ad);
  }
});

test('D5 kusurlu: boş ya da iskelet lisans dosyası → çıkış 1, dosya adlandırılır, hedef oluşmaz', () => {
  const ornekler = {
    'boş': '',
    'yalnız boşluk': '  \n\t\n',
    'yalnız başlık': 'LICENSE\n',
    'yer tutucu': 'TODO: lisans metni eklenecek',
    'kısa telif satırı': 'Copyright (c) 2026',
    'anahtar sözcüksüz uzun metin': 'x'.repeat(400),
  };
  for (const [ad, icerik] of Object.entries(ornekler)) {
    const repo = sahteRepo();
    const k = iskelet(repo);
    fs.writeFileSync(path.join(k, 'vendor/fontkit/LICENSE'), icerik);
    const h = path.join(repo, 'dist');
    const r = kos(repo, '--kaynak', k, '--hedef', h);
    assert.equal(r.kod, 1, `${ad}: ${r.cikti}`);
    assert.match(r.cikti, /vendor\/fontkit\/LICENSE/, ad);
    assert.ok(!fs.existsSync(h), ad);
  }
});

test('kusurlu: lisanssız yeni vendor kütüphanesi → çıkış 1; lisans dosyası boşsa da 1; gerçek lisansla 0', () => {
  const repo = sahteRepo();
  const k = iskelet(repo);
  yaz(k, 'vendor/yeni-kutuphane/yeni.min.js');
  let r = kos(repo, '--kaynak', k, '--hedef', path.join(repo, 'dist'));
  assert.equal(r.kod, 1);
  assert.match(r.cikti, /yeni-kutuphane/);
  yaz(k, 'vendor/yeni-kutuphane/LICENSE', '');
  r = kos(repo, '--kaynak', k, '--hedef', path.join(repo, 'dist'));
  assert.equal(r.kod, 1, r.cikti);
  assert.match(r.cikti, /yeni-kutuphane/);
  yaz(k, 'vendor/yeni-kutuphane/LICENSE', LISANS);
  r = kos(repo, '--kaynak', k, '--hedef', path.join(repo, 'dist'));
  assert.equal(r.kod, 0, r.cikti);
});

test('kusurlu: index.html yok (yalnız lisanslar) → çıkış 1', () => {
  const repo = sahteRepo();
  const k = iskelet(repo);
  fs.rmSync(path.join(k, 'index.html'));
  const r = kos(repo, '--kaynak', k, '--hedef', path.join(repo, 'dist'));
  assert.equal(r.kod, 1);
  assert.match(r.cikti, /index\.html/);
});

test('kusurlu: hedef kaynağın içinde ya da kaynağı kapsıyor → çıkış 1, kaynak silinmez', () => {
  const repo = sahteRepo();
  const k = iskelet(repo);
  assert.equal(kos(repo, '--kaynak', k, '--hedef', path.join(k, 'dist')).kod, 1);
  assert.equal(kos(repo, '--kaynak', k, '--hedef', k).kod, 1);
  assert.equal(kos(repo, '--kaynak', k, '--hedef', path.dirname(k)).kod, 1);
  assert.ok(fs.existsSync(path.join(k, 'index.html')));
});

test('kusurlu: olmayan kaynak → çıkış 1', () => {
  const repo = sahteRepo();
  const r = kos(repo, '--kaynak', path.join(repo, 'yok'), '--hedef', path.join(repo, 'dist'));
  assert.equal(r.kod, 1);
  assert.match(r.cikti, /kaynak klasör yok/);
});

// ---------------------------------------------------------------- --web (statik site / GitHub Pages)
const GOMULU_AD = ['pako', '@pdf-lib/upng', '@pdf-lib/standard-fonts', 'tslib', '@pdf-lib/brotli', '@pdf-lib/restructure', '@pdf-lib/unicode-properties', 'unicode-trie', 'dfa', 'clone',
  'deep-equal', 'iconv-lite', 'base64-js', 'base64-arraybuffer', 'buffer', 'ieee754', 'isarray', 'inherits', 'readable-stream',
  'process-es6', 'regenerator-runtime'];
const BILDIRIM = '# Third-party notices\n\n' + ['pdf-lib', 'pdfjs', 'fontkit', 'literata', 'Colorfigures', ...GOMULU_AD].map((a) => `- ${a}: MIT license, copyright holders`).join('\n')
  + '\n\nEach component keeps its own license and copyright notice; full texts ship next to the files.\n' + 'x'.repeat(120) + '\n';
/** Kökünde LICENSE ve THIRD_PARTY_NOTICES.md olan sahte repo + iskelet kaynak (vendor alt klasörleri bildirimde anılır). */
function webRepo() {
  const repo = sahteRepo();
  const k = iskelet(repo);
  yaz(k, 'vendor/pdfjs/pdf.min.js'); yaz(k, 'vendor/fontkit/fontkit.umd.min.js');
  yaz(repo, 'LICENSE', LISANS);
  yaz(repo, 'THIRD_PARTY_NOTICES.md', BILDIRIM);
  return { repo, k, h: path.join(repo, 'dist') };
}

test('--web: kökteki LICENSE ve THIRD_PARTY_NOTICES.md hedefin köküne birebir kopyalanır; --web yokken kopyalanmaz', () => {
  const { repo, k, h } = webRepo();
  let r = kos(repo, '--kaynak', k, '--hedef', h, '--web');
  assert.equal(r.kod, 0, r.cikti);
  for (const a of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) assert.equal(fs.readFileSync(path.join(h, a), 'utf8'), fs.readFileSync(path.join(repo, a), 'utf8'), a);
  for (const g of LISANSLAR) assert.ok(fs.existsSync(path.join(h, g)), g);
  r = kos(repo, '--kaynak', k, '--hedef', h);
  assert.equal(r.kod, 0, r.cikti);
  assert.ok(!fs.existsSync(path.join(h, 'LICENSE')) && !fs.existsSync(path.join(h, 'THIRD_PARTY_NOTICES.md')));
});

test('gerçek repo --web: app/ + kökteki LICENSE/THIRD_PARTY_NOTICES.md ile çıkış 0', () => {
  const repo = sahteRepo();
  for (const a of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(APP, '..', a), path.join(repo, a));
  const h = path.join(repo, 'dist');
  const r = kos(repo, '--kaynak', APP, '--hedef', h, '--web', '--sessiz');
  assert.equal(r.kod, 0, r.cikti);
  for (const a of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'index.html', ...LISANSLAR]) assert.ok(fs.existsSync(path.join(h, a)), a);
});

test('kusurlu --web: kök LICENSE yok / boş / iskelet, bildirim yok / boş → çıkış 1, dosya adlandırılır, hedef oluşmaz', () => {
  const durumlar = {
    'LICENSE yok': (repo) => fs.rmSync(path.join(repo, 'LICENSE')),
    'LICENSE boş': (repo) => fs.writeFileSync(path.join(repo, 'LICENSE'), ''),
    'LICENSE iskelet': (repo) => fs.writeFileSync(path.join(repo, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026\n'),
    'LICENSE klasör': (repo) => { fs.rmSync(path.join(repo, 'LICENSE')); fs.mkdirSync(path.join(repo, 'LICENSE')); },
    'bildirim yok': (repo) => fs.rmSync(path.join(repo, 'THIRD_PARTY_NOTICES.md')),
    'bildirim boş': (repo) => fs.writeFileSync(path.join(repo, 'THIRD_PARTY_NOTICES.md'), '\n\n'),
  };
  for (const [ad, boz] of Object.entries(durumlar)) {
    const { repo, k, h } = webRepo();
    boz(repo);
    const r = kos(repo, '--kaynak', k, '--hedef', h, '--web');
    assert.equal(r.kod, 1, ad);
    assert.match(r.cikti, ad.startsWith('LICENSE') ? /LICENSE/ : /THIRD_PARTY_NOTICES\.md/, ad);
    assert.ok(!fs.existsSync(h), ad + ': hedef oluştu');
  }
});

test('kusurlu --web: bildirim bir vendor kütüphanesini ya da Colorfigures\'ı anmıyor → çıkış 1, eksik ad yazılır', () => {
  for (const eksikAd of ['pdfjs', 'fontkit', 'Colorfigures']) {
    const { repo, k, h } = webRepo();
    fs.writeFileSync(path.join(repo, 'THIRD_PARTY_NOTICES.md'), BILDIRIM.split('\n').filter((s) => !s.includes(eksikAd)).join('\n'));
    const r = kos(repo, '--kaynak', k, '--hedef', h, '--web');
    assert.equal(r.kod, 1, eksikAd);
    assert.match(r.cikti, new RegExp(eksikAd + ' anılmıyor'), eksikAd);
  }
  // derlenmiş pakete gömülü bir kod anılmıyorsa
  for (const eksikAd of ['pako', 'iconv-lite', 'ieee754']) {
    const w = webRepo();
    fs.writeFileSync(path.join(w.repo, 'THIRD_PARTY_NOTICES.md'), BILDIRIM.split('\n').filter((s) => !s.includes(eksikAd)).join('\n'));
    const rr = kos(w.repo, '--kaynak', w.k, '--hedef', w.h, '--web');
    assert.equal(rr.kod, 1, eksikAd);
    assert.match(rr.cikti, new RegExp(eksikAd + ' anılmıyor'), eksikAd);
  }
  // yeni vendor kütüphanesi eklenip bildirime yazılmazsa
  const { repo, k, h } = webRepo();
  yaz(k, 'vendor/yeni-kutuphane/LICENSE', LISANS);
  const r = kos(repo, '--kaynak', k, '--hedef', h, '--web');
  assert.equal(r.kod, 1);
  assert.match(r.cikti, /yeni-kutuphane anılmıyor/);
});

test('kusurlu --web: kaynakta da LICENSE varsa (kökteki dosyayla çakışma) → çıkış 1', () => {
  const { repo, k, h } = webRepo();
  yaz(k, 'LICENSE', LISANS);
  const r = kos(repo, '--kaynak', k, '--hedef', h, '--web');
  assert.equal(r.kod, 1);
  assert.match(r.cikti, /çakışır/);
  assert.ok(!fs.existsSync(h), 'hedef oluştu');
});
