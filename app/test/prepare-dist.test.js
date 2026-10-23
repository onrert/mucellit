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

const SCRIPT = path.join(__dirname, '..', '..', 'tools', 'prepare-dist.mjs');
const APP = path.join(__dirname, '..');
const MARK_PREFIX = '.';
const MARK_SUFFIX = '.dist-prepare';

const TEMPS = [];
function temp() { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-dist-'))); TEMPS.push(d); return d; }
test.after(() => { for (const d of TEMPS) fs.rmSync(d, { recursive: true, force: true }); });

/** Betiğin kopyasını taşıyan geçici repo kökü. */
function fakeRepo() {
  const r = temp();
  fs.mkdirSync(path.join(r, 'tools'));
  fs.copyFileSync(SCRIPT, path.join(r, 'tools', 'prepare-dist.mjs'));
  return r;
}
function run(repo, ...argv) {
  const r = spawnSync(process.execPath, [path.join(repo, 'tools', 'prepare-dist.mjs'), ...argv], { encoding: 'utf8' });
  return { code: r.status, output: r.stdout + r.stderr };
}
function write(root, relPath, content = 'x') {
  const y = path.join(root, relPath);
  fs.mkdirSync(path.dirname(y), { recursive: true });
  fs.writeFileSync(y, content);
}
function list(root) {
  const l = [];
  (function walk(d) {
    for (const g of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, g.name);
      if (g.isDirectory()) walk(y); else l.push(path.relative(root, y).split(path.sep).join('/'));
    }
  })(root);
  return l.sort();
}
const LICENSE = 'MIT License\n\nCopyright (c) 2026 Deneme Yazari\n\nPermission is hereby granted, free of charge, to any person obtaining a copy '
  + 'of this software and associated documentation files (the "Software"), to deal in the Software without restriction.\n';
// js/learn/LICENSE (Öğren rehberinin Colorfigures motoru, MIT) da zorunlu lisans
const LICENSES = ['vendor/pdf-lib/LICENSE.md', 'vendor/pdfjs/LICENSE', 'vendor/fontkit/LICENSE', 'vendor/literata/OFL.txt', 'js/learn/LICENSE'];
/** Geçerli en küçük kaynak ağacı (repo içinde app-xxx/). */
function skeleton(repo) {
  const k = fs.mkdtempSync(path.join(repo, 'app-'));
  for (const g of ['index.html', 'vendor/SOURCES.md', 'vendor/pdf-lib/pdf-lib.min.js', 'vendor/literata/literata-regular.js', 'js/a.js']) write(k, g);
  for (const g of LICENSES) write(k, g, LICENSE);
  return k;
}
const markPath = (target) => path.join(path.dirname(target), MARK_PREFIX + path.basename(target) + MARK_SUFFIX);

test('gerçek app/: çıkış 0; test/, .ttf ve gizli dosya yok; lisanslar ve index.html var; JS sayısı kaynakla aynı', () => {
  const repo = fakeRepo();
  const h = path.join(repo, 'dist');
  const r = run(repo, '--source', APP, '--target', h, '--quiet');
  assert.equal(r.code, 0, r.output);
  const l = list(h);
  assert.deepEqual(l.filter((g) => g.startsWith('test/') || /\.ttf$/i.test(g) || g.split('/').some((p) => p.startsWith('.'))), []);
  for (const g of ['index.html', 'vendor/SOURCES.md', 'js/platform.js', 'js/platform-tauri.js', 'vendor/literata/literata-regular.js', ...LICENSES]) assert.ok(l.includes(g), g);
  const sourceJs = list(APP).filter((g) => g.endsWith('.js') && !g.startsWith('test/') && !g.split('/').some((p) => p.startsWith('.')));
  assert.deepEqual(l.filter((g) => g.endsWith('.js')), sourceJs);
});

test('iskelet: çıkış 0; iç içe .ttf, kökteki test/ ve .DS_Store atlanır; js/test/ (kök dışı) kopyalanır', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  write(k, 'test/e2e.mjs'); write(k, 'test/fixtures/a.pdf'); write(k, 'vendor/literata/Literata-Regular.ttf'); write(k, 'css/B.TTF');
  write(k, '.DS_Store'); write(k, 'js/.DS_Store'); write(k, 'js/test/inner.js');
  const h = path.join(repo, 'dist');
  const r = run(repo, '--source', k, '--target', h);
  assert.equal(r.code, 0, r.output);
  const l = list(h);
  assert.ok(!l.some((g) => g.startsWith('test/') || /\.ttf$/i.test(g) || g.includes('.DS_Store')), l.join(','));
  assert.ok(l.includes('js/test/inner.js'));
  assert.match(r.output, /- test\/ \(hariç\)/);
});

test('D5: gizli dosya ve klasörler (.env, .git/, js/.gizli.js, vendor/*/.npmignore) pakete girmez', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  write(k, '.env', 'KEY=hidden'); write(k, '.git/config'); write(k, 'js/.hidden.js'); write(k, 'vendor/pdfjs/.npmignore'); write(k, 'css/.eski/style.css');
  const h = path.join(repo, 'dist');
  const r = run(repo, '--source', k, '--target', h);
  assert.equal(r.code, 0, r.output);
  const l = list(h);
  assert.deepEqual(l.filter((g) => g.split('/').some((p) => p.startsWith('.'))), [], l.join(','));
  assert.ok(l.includes('js/a.js') && l.includes('index.html'));
  for (const g of ['.env', '.git/', 'js/.hidden.js', 'vendor/pdfjs/.npmignore', 'css/.eski/']) assert.ok(r.output.includes(`- ${g} (hariç)`), g);
});

test('O3: işaret dosyası hedefin YANINA yazılır (paketin içine değil); yeniden hazırlamada eski kalıntı kalmaz', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  const h = path.join(repo, 'dist');
  assert.equal(run(repo, '--source', k, '--target', h, '--quiet').code, 0);
  assert.ok(fs.existsSync(markPath(h)), 'işaret dosyası yok');
  assert.ok(!list(h).some((g) => g.includes('dist-prepare')), 'işaret paketin içinde');
  write(h, 'eski-kalinti.txt');
  const r = run(repo, '--source', k, '--target', h, '--quiet');
  assert.equal(r.code, 0, r.output);
  assert.ok(!fs.existsSync(path.join(h, 'eski-kalinti.txt')));
});

test('O3: var olan BOŞ hedef klasör (işaretsiz) kabul edilir', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  const h = path.join(repo, 'blank-dist');
  fs.mkdirSync(h);
  assert.equal(run(repo, '--source', k, '--target', h, '--quiet').code, 0);
  assert.ok(fs.existsSync(path.join(h, 'index.html')));
});

test('O3 kusurlu: dolu ve işaretsiz hedef (ör. --target src-tauri) → çıkış 1, içerik silinmez', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  const h = path.join(repo, 'src-tauri');
  write(h, 'Cargo.toml', '[package]'); write(h, 'src/lib.rs', 'fn main() {}');
  const r = run(repo, '--source', k, '--target', h);
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /işaret/);
  assert.deepEqual(list(h), ['Cargo.toml', 'src/lib.rs']);
});

test('O3 kusurlu: başka hedefin işaret dosyası kopyalanmış ya da işareti boş/bozuk dolu hedef → çıkış 1', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  const dist = path.join(repo, 'dist');
  assert.equal(run(repo, '--source', k, '--target', dist, '--quiet').code, 0);
  const h = path.join(repo, 'documents');
  write(h, 'onemli.md', 'mustNotDelete');
  fs.copyFileSync(markPath(dist), markPath(h));
  assert.equal(run(repo, '--source', k, '--target', h).code, 1, 'kopya işaret');
  fs.writeFileSync(markPath(h), '');
  assert.equal(run(repo, '--source', k, '--target', h).code, 1, 'boş işaret');
  fs.writeFileSync(markPath(h), '{corrupt');
  assert.equal(run(repo, '--source', k, '--target', h).code, 1, 'bozuk işaret');
  fs.writeFileSync(markPath(h), JSON.stringify({ tool: 'dist-prepare' }));
  assert.equal(run(repo, '--source', k, '--target', h).code, 1, 'hedefsiz işaret');
  assert.ok(fs.existsSync(path.join(h, 'onemli.md')));
});

test('O3 kusurlu: repo dışındaki hedef (mutlak yol, ../ ile çıkış, repo dışını gösteren bağ) → çıkış 1, dokunulmaz', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  const outer = temp();
  write(outer, 'kisisel.txt', 'touch');
  assert.equal(run(repo, '--source', k, '--target', outer).code, 1, 'mutlak dış yol');
  assert.equal(run(repo, '--source', k, '--target', path.join(outer, 'fresh-dist')).code, 1, 'dışarıda yeni klasör');
  assert.ok(!fs.existsSync(path.join(outer, 'fresh-dist')));
  assert.equal(run(repo, '--source', k, '--target', path.join(repo, 'dist', '..', '..', path.basename(outer))).code, 1, '../ ile çıkış');
  fs.symlinkSync(outer, path.join(repo, 'bag'));
  assert.equal(run(repo, '--source', k, '--target', path.join(repo, 'bag')).code, 1, 'dışarıyı gösteren bağ');
  assert.equal(run(repo, '--source', k, '--target', path.join(repo, 'bag', 'dist')).code, 1, 'bağın altındaki yeni klasör');
  assert.deepEqual(list(outer), ['kisisel.txt']);
});

test('O3 kusurlu: hedef bir dosya ya da repo kökü → çıkış 1', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  write(repo, 'README.md', 'okubeni');
  assert.equal(run(repo, '--source', k, '--target', path.join(repo, 'README.md')).code, 1);
  assert.equal(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), 'okubeni');
  assert.equal(run(repo, '--source', k, '--target', repo).code, 1);
  assert.ok(fs.existsSync(path.join(repo, 'tools', 'prepare-dist.mjs')));
});

test('kusurlu: boş kaynak klasör → çıkış 1, eksikler adlandırılır', () => {
  const repo = fakeRepo();
  const r = run(repo, '--source', fs.mkdtempSync(path.join(repo, 'blank-')), '--target', path.join(repo, 'dist'));
  assert.equal(r.code, 1);
  assert.match(r.output, /index\.html/);
  assert.match(r.output, /OFL\.txt/);
});

test('kusurlu: tek bir lisans eksik (pdfjs/LICENSE) → çıkış 1 ve hedef oluşmaz', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  fs.rmSync(path.join(k, 'vendor/pdfjs/LICENSE'));
  const h = path.join(repo, 'dist');
  const r = run(repo, '--source', k, '--target', h);
  assert.equal(r.code, 1);
  assert.match(r.output, /vendor\/pdfjs\/LICENSE/);
  assert.ok(!fs.existsSync(h));
});

test('kusurlu: Öğren lisansı (js/learn/LICENSE) eksik ya da boş → çıkış 1, dosya adlandırılır, hedef oluşmaz', () => {
  for (const [name, corrupt] of [['missing', (y) => fs.rmSync(y)], ['boş', (y) => fs.writeFileSync(y, '')], ['skeleton', (y) => fs.writeFileSync(y, 'MIT License\n')]]) {
    const repo = fakeRepo();
    const k = skeleton(repo);
    corrupt(path.join(k, 'js/learn/LICENSE'));
    const h = path.join(repo, 'dist');
    const r = run(repo, '--source', k, '--target', h);
    assert.equal(r.code, 1, name);
    assert.match(r.output, /js\/learn\/LICENSE/, name);
    assert.ok(!fs.existsSync(h), name);
  }
});

test('D5 kusurlu: boş ya da iskelet lisans dosyası → çıkış 1, dosya adlandırılır, hedef oluşmaz', () => {
  const examples = {
    'boş': '',
    'yalnız boşluk': '  \n\t\n',
    'yalnız başlık': 'LICENSE\n',
    'yer tutucu': 'TODO: lisans metni eklenecek',
    'kısa telif satırı': 'Copyright (c) 2026',
    'anahtar sözcüksüz uzun metin': 'x'.repeat(400),
  };
  for (const [name, content] of Object.entries(examples)) {
    const repo = fakeRepo();
    const k = skeleton(repo);
    fs.writeFileSync(path.join(k, 'vendor/fontkit/LICENSE'), content);
    const h = path.join(repo, 'dist');
    const r = run(repo, '--source', k, '--target', h);
    assert.equal(r.code, 1, `${name}: ${r.output}`);
    assert.match(r.output, /vendor\/fontkit\/LICENSE/, name);
    assert.ok(!fs.existsSync(h), name);
  }
});

test('kusurlu: lisanssız yeni vendor kütüphanesi → çıkış 1; lisans dosyası boşsa da 1; gerçek lisansla 0', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  write(k, 'vendor/fresh-library/fresh.min.js');
  let r = run(repo, '--source', k, '--target', path.join(repo, 'dist'));
  assert.equal(r.code, 1);
  assert.match(r.output, /fresh-library/);
  write(k, 'vendor/fresh-library/LICENSE', '');
  r = run(repo, '--source', k, '--target', path.join(repo, 'dist'));
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /fresh-library/);
  write(k, 'vendor/fresh-library/LICENSE', LICENSE);
  r = run(repo, '--source', k, '--target', path.join(repo, 'dist'));
  assert.equal(r.code, 0, r.output);
});

test('kusurlu: index.html yok (yalnız lisanslar) → çıkış 1', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  fs.rmSync(path.join(k, 'index.html'));
  const r = run(repo, '--source', k, '--target', path.join(repo, 'dist'));
  assert.equal(r.code, 1);
  assert.match(r.output, /index\.html/);
});

test('kusurlu: hedef kaynağın içinde ya da kaynağı kapsıyor → çıkış 1, kaynak silinmez', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  assert.equal(run(repo, '--source', k, '--target', path.join(k, 'dist')).code, 1);
  assert.equal(run(repo, '--source', k, '--target', k).code, 1);
  assert.equal(run(repo, '--source', k, '--target', path.dirname(k)).code, 1);
  assert.ok(fs.existsSync(path.join(k, 'index.html')));
});

test('kusurlu: olmayan kaynak → çıkış 1', () => {
  const repo = fakeRepo();
  const r = run(repo, '--source', path.join(repo, 'none'), '--target', path.join(repo, 'dist'));
  assert.equal(r.code, 1);
  assert.match(r.output, /kaynak klasör yok/);
});

// ---------------------------------------------------------------- --web (statik site / GitHub Pages)
const EMBEDDED_NAME = ['pako', '@pdf-lib/upng', '@pdf-lib/standard-fonts', 'tslib', '@pdf-lib/brotli', '@pdf-lib/restructure', '@pdf-lib/unicode-properties', 'unicode-trie', 'dfa', 'clone',
  'deep-equal', 'iconv-lite', 'base64-js', 'base64-arraybuffer', 'buffer', 'ieee754', 'isarray', 'inherits', 'readable-stream',
  'process-es6', 'regenerator-runtime'];
const NOTICE = '# Third-party notices\n\n' + ['pdf-lib', 'pdfjs', 'fontkit', 'literata', 'Colorfigures', ...EMBEDDED_NAME].map((a) => `- ${a}: MIT license, copyright holders`).join('\n')
  + '\n\nEach component keeps its own license and copyright notice; full texts ship next to the files.\n' + 'x'.repeat(120) + '\n';
/** Kökünde LICENSE ve THIRD_PARTY_NOTICES.md olan sahte repo + iskelet kaynak (vendor alt klasörleri bildirimde anılır). */
function webRepo() {
  const repo = fakeRepo();
  const k = skeleton(repo);
  write(k, 'vendor/pdfjs/pdf.min.js'); write(k, 'vendor/fontkit/fontkit.umd.min.js');
  write(repo, 'LICENSE', LICENSE);
  write(repo, 'THIRD_PARTY_NOTICES.md', NOTICE);
  return { repo, k, h: path.join(repo, 'dist') };
}

test('--web: kökteki LICENSE ve THIRD_PARTY_NOTICES.md hedefin köküne birebir kopyalanır; --web yokken kopyalanmaz', () => {
  const { repo, k, h } = webRepo();
  let r = run(repo, '--source', k, '--target', h, '--web');
  assert.equal(r.code, 0, r.output);
  for (const a of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) assert.equal(fs.readFileSync(path.join(h, a), 'utf8'), fs.readFileSync(path.join(repo, a), 'utf8'), a);
  for (const g of LICENSES) assert.ok(fs.existsSync(path.join(h, g)), g);
  r = run(repo, '--source', k, '--target', h);
  assert.equal(r.code, 0, r.output);
  assert.ok(!fs.existsSync(path.join(h, 'LICENSE')) && !fs.existsSync(path.join(h, 'THIRD_PARTY_NOTICES.md')));
});

test('gerçek repo --web: app/ + kökteki LICENSE/THIRD_PARTY_NOTICES.md ile çıkış 0', () => {
  const repo = fakeRepo();
  for (const a of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(APP, '..', a), path.join(repo, a));
  const h = path.join(repo, 'dist');
  const r = run(repo, '--source', APP, '--target', h, '--web', '--quiet');
  assert.equal(r.code, 0, r.output);
  for (const a of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'index.html', ...LICENSES]) assert.ok(fs.existsSync(path.join(h, a)), a);
});

test('kusurlu --web: kök LICENSE yok / boş / iskelet, bildirim yok / boş → çıkış 1, dosya adlandırılır, hedef oluşmaz', () => {
  const states = {
    'LICENSE yok': (repo) => fs.rmSync(path.join(repo, 'LICENSE')),
    'LICENSE boş': (repo) => fs.writeFileSync(path.join(repo, 'LICENSE'), ''),
    'LICENSE iskelet': (repo) => fs.writeFileSync(path.join(repo, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026\n'),
    'LICENSE klasör': (repo) => { fs.rmSync(path.join(repo, 'LICENSE')); fs.mkdirSync(path.join(repo, 'LICENSE')); },
    'bildirim yok': (repo) => fs.rmSync(path.join(repo, 'THIRD_PARTY_NOTICES.md')),
    'bildirim boş': (repo) => fs.writeFileSync(path.join(repo, 'THIRD_PARTY_NOTICES.md'), '\n\n'),
  };
  for (const [name, corrupt] of Object.entries(states)) {
    const { repo, k, h } = webRepo();
    corrupt(repo);
    const r = run(repo, '--source', k, '--target', h, '--web');
    assert.equal(r.code, 1, name);
    assert.match(r.output, name.startsWith('LICENSE') ? /LICENSE/ : /THIRD_PARTY_NOTICES\.md/, name);
    assert.ok(!fs.existsSync(h), name + ': hedef oluştu');
  }
});

test('kusurlu --web: bildirim bir vendor kütüphanesini ya da Colorfigures\'ı anmıyor → çıkış 1, eksik ad yazılır', () => {
  for (const missingName of ['pdfjs', 'fontkit', 'Colorfigures']) {
    const { repo, k, h } = webRepo();
    fs.writeFileSync(path.join(repo, 'THIRD_PARTY_NOTICES.md'), NOTICE.split('\n').filter((s) => !s.includes(missingName)).join('\n'));
    const r = run(repo, '--source', k, '--target', h, '--web');
    assert.equal(r.code, 1, missingName);
    assert.match(r.output, new RegExp(missingName + ' anılmıyor'), missingName);
  }
  // derlenmiş pakete gömülü bir kod anılmıyorsa
  for (const missingName of ['pako', 'iconv-lite', 'ieee754']) {
    const w = webRepo();
    fs.writeFileSync(path.join(w.repo, 'THIRD_PARTY_NOTICES.md'), NOTICE.split('\n').filter((s) => !s.includes(missingName)).join('\n'));
    const rr = run(w.repo, '--source', w.k, '--target', w.h, '--web');
    assert.equal(rr.code, 1, missingName);
    assert.match(rr.output, new RegExp(missingName + ' anılmıyor'), missingName);
  }
  // yeni vendor kütüphanesi eklenip bildirime yazılmazsa
  const { repo, k, h } = webRepo();
  write(k, 'vendor/fresh-library/LICENSE', LICENSE);
  const r = run(repo, '--source', k, '--target', h, '--web');
  assert.equal(r.code, 1);
  assert.match(r.output, /fresh-library anılmıyor/);
});

test('kusurlu --web: kaynakta da LICENSE varsa (kökteki dosyayla çakışma) → çıkış 1', () => {
  const { repo, k, h } = webRepo();
  write(k, 'LICENSE', LICENSE);
  const r = run(repo, '--source', k, '--target', h, '--web');
  assert.equal(r.code, 1);
  assert.match(r.output, /çakışır/);
  assert.ok(!fs.existsSync(h), 'hedef oluştu');
});

test('legacy marker: a target prepared by the script under its earlier name is accepted once and the marker replaced; faulty legacy markers are rejected', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  const h = path.join(repo, 'dist');
  write(h, 'old-output.txt');
  // legacy-names: begin (marker format of the earlier script name)
  const legacy = path.join(repo, '.dist.dist-hazirla');
  fs.writeFileSync(legacy, JSON.stringify({ arac: 'dist-hazirla', hedef: h }) + '\n');
  const r = run(repo, '--source', k, '--target', h, '--quiet');
  assert.equal(r.code, 0, r.output);
  assert.ok(!fs.existsSync(legacy), 'legacy marker replaced');
  assert.ok(fs.existsSync(markPath(h)), 'current marker written');
  assert.ok(!fs.existsSync(path.join(h, 'old-output.txt')));
  for (const [name, content] of [['other target', { arac: 'dist-hazirla', hedef: path.join(repo, 'other') }], ['other tool', { arac: 'x', hedef: h }],
    ['empty', ''], ['broken', '{']]) {
    const t = path.join(repo, 'dist2-' + name.replace(/ /g, '-'));
    write(t, 'keep.txt');
    fs.writeFileSync(path.join(repo, '.' + path.basename(t) + '.dist-hazirla'), typeof content === 'string' ? content : JSON.stringify(content));
    const q = run(repo, '--source', k, '--target', t, '--quiet');
    assert.equal(q.code, 1, name + ': ' + q.output);
    assert.deepEqual(list(t), ['keep.txt'], name + ': content not deleted');
  }
  // legacy-names: end
});
