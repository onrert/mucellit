'use strict';
// tools/prepare-dist.mjs: output with the real app/; exit code 1 with faulty inputs (empty, skeleton, missing/empty licence,
// vendor without a licence, clashing target, target outside the repository, non-empty target without a marker, missing source).
// Every test puts a copy of the script into the tools/ folder of a temporary "fake repository": the script finds the
// repository root from its own location, so the "inside the repository" rule of the target is tested without touching the real one.
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

/** A temporary repository root that holds a copy of the script. */
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
const LICENSE = 'MIT License\n\nCopyright (c) 2026 Sample Author\n\nPermission is hereby granted, free of charge, to any person obtaining a copy '
  + 'of this software and associated documentation files (the "Software"), to deal in the Software without restriction.\n';
// js/learn/LICENSE (the Colorfigures engine of the Learn guide, MIT) is a required licence too
const LICENSES = ['vendor/pdf-lib/LICENSE.md', 'vendor/pdfjs/LICENSE', 'vendor/fontkit/LICENSE', 'vendor/literata/OFL.txt', 'js/learn/LICENSE'];
/** The smallest valid source tree (app-xxx/ inside the repository). */
function skeleton(repo) {
  const k = fs.mkdtempSync(path.join(repo, 'app-'));
  for (const g of ['index.html', 'vendor/SOURCES.md', 'vendor/pdf-lib/pdf-lib.min.js', 'vendor/literata/literata-regular.js', 'js/a.js']) write(k, g);
  for (const g of LICENSES) write(k, g, LICENSE);
  return k;
}
const markPath = (target) => path.join(path.dirname(target), MARK_PREFIX + path.basename(target) + MARK_SUFFIX);

test('real app/: exit 0; no test/, .ttf or hidden file; the licences and index.html are there; the JS count is the same as the source', () => {
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

test('skeleton: exit 0; a nested .ttf, test/ at the root and .DS_Store are skipped; js/test/ (not at the root) is copied', () => {
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
  assert.match(r.output, /- test\/ \(excluded\)/);
});

test('D5: hidden files and folders (.env, .git/, js/.hidden.js, vendor/*/.npmignore) do not go into the package', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  write(k, '.env', 'KEY=hidden'); write(k, '.git/config'); write(k, 'js/.hidden.js'); write(k, 'vendor/pdfjs/.npmignore'); write(k, 'css/.old/style.css');
  const h = path.join(repo, 'dist');
  const r = run(repo, '--source', k, '--target', h);
  assert.equal(r.code, 0, r.output);
  const l = list(h);
  assert.deepEqual(l.filter((g) => g.split('/').some((p) => p.startsWith('.'))), [], l.join(','));
  assert.ok(l.includes('js/a.js') && l.includes('index.html'));
  for (const g of ['.env', '.git/', 'js/.hidden.js', 'vendor/pdfjs/.npmignore', 'css/.old/']) assert.ok(r.output.includes(`- ${g} (excluded)`), g);
});

test('O3: the marker file is written NEXT TO the target (not inside the package); no old leftover stays when preparing again', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  const h = path.join(repo, 'dist');
  assert.equal(run(repo, '--source', k, '--target', h, '--quiet').code, 0);
  assert.ok(fs.existsSync(markPath(h)), 'no marker file');
  assert.ok(!list(h).some((g) => g.includes('dist-prepare')), 'marker inside the package');
  write(h, 'old-leftover.txt');
  const r = run(repo, '--source', k, '--target', h, '--quiet');
  assert.equal(r.code, 0, r.output);
  assert.ok(!fs.existsSync(path.join(h, 'old-leftover.txt')));
});

test('O3: an existing EMPTY target folder (without a marker) is accepted', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  const h = path.join(repo, 'blank-dist');
  fs.mkdirSync(h);
  assert.equal(run(repo, '--source', k, '--target', h, '--quiet').code, 0);
  assert.ok(fs.existsSync(path.join(h, 'index.html')));
});

test('O3 faulty: a non-empty target without a marker (e.g. --target src-tauri) → exit 1, the content is not removed', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  const h = path.join(repo, 'src-tauri');
  write(h, 'Cargo.toml', '[package]'); write(h, 'src/lib.rs', 'fn main() {}');
  const r = run(repo, '--source', k, '--target', h);
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /marker/);
  assert.deepEqual(list(h), ['Cargo.toml', 'src/lib.rs']);
});

test('O3 faulty: a marker file copied from another target, or a non-empty target with an empty/broken marker → exit 1', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  const dist = path.join(repo, 'dist');
  assert.equal(run(repo, '--source', k, '--target', dist, '--quiet').code, 0);
  const h = path.join(repo, 'documents');
  write(h, 'important.md', 'mustNotDelete');
  fs.copyFileSync(markPath(dist), markPath(h));
  assert.equal(run(repo, '--source', k, '--target', h).code, 1, 'copied marker');
  fs.writeFileSync(markPath(h), '');
  assert.equal(run(repo, '--source', k, '--target', h).code, 1, 'empty marker');
  fs.writeFileSync(markPath(h), '{corrupt');
  assert.equal(run(repo, '--source', k, '--target', h).code, 1, 'broken marker');
  fs.writeFileSync(markPath(h), JSON.stringify({ tool: 'dist-prepare' }));
  assert.equal(run(repo, '--source', k, '--target', h).code, 1, 'marker without a target');
  assert.ok(fs.existsSync(path.join(h, 'important.md')));
});

test('O3 faulty: a target outside the repository (absolute path, leaving with ../, a link pointing outside) → exit 1, untouched', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  const outer = temp();
  write(outer, 'personal.txt', 'touch');
  assert.equal(run(repo, '--source', k, '--target', outer).code, 1, 'absolute outside path');
  assert.equal(run(repo, '--source', k, '--target', path.join(outer, 'fresh-dist')).code, 1, 'new folder outside');
  assert.ok(!fs.existsSync(path.join(outer, 'fresh-dist')));
  assert.equal(run(repo, '--source', k, '--target', path.join(repo, 'dist', '..', '..', path.basename(outer))).code, 1, 'leaving with ../');
  fs.symlinkSync(outer, path.join(repo, 'bag'));
  assert.equal(run(repo, '--source', k, '--target', path.join(repo, 'bag')).code, 1, 'a link pointing outside');
  assert.equal(run(repo, '--source', k, '--target', path.join(repo, 'bag', 'dist')).code, 1, 'a new folder under the link');
  assert.deepEqual(list(outer), ['personal.txt']);
});

test('O3 faulty: the target is a file or the repository root → exit 1', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  write(repo, 'README.md', 'readme');
  assert.equal(run(repo, '--source', k, '--target', path.join(repo, 'README.md')).code, 1);
  assert.equal(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), 'readme');
  assert.equal(run(repo, '--source', k, '--target', repo).code, 1);
  assert.ok(fs.existsSync(path.join(repo, 'tools', 'prepare-dist.mjs')));
});

test('faulty: an empty source folder → exit 1, the missing files are named', () => {
  const repo = fakeRepo();
  const r = run(repo, '--source', fs.mkdtempSync(path.join(repo, 'blank-')), '--target', path.join(repo, 'dist'));
  assert.equal(r.code, 1);
  assert.match(r.output, /index\.html/);
  assert.match(r.output, /OFL\.txt/);
});

test('faulty: a single licence missing (pdfjs/LICENSE) → exit 1 and no target', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  fs.rmSync(path.join(k, 'vendor/pdfjs/LICENSE'));
  const h = path.join(repo, 'dist');
  const r = run(repo, '--source', k, '--target', h);
  assert.equal(r.code, 1);
  assert.match(r.output, /vendor\/pdfjs\/LICENSE/);
  assert.ok(!fs.existsSync(h));
});

test('faulty: the Learn licence (js/learn/LICENSE) missing or empty → exit 1, the file is named, no target', () => {
  for (const [name, corrupt] of [['missing', (y) => fs.rmSync(y)], ['empty', (y) => fs.writeFileSync(y, '')], ['skeleton', (y) => fs.writeFileSync(y, 'MIT License\n')]]) {
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

test('D5 faulty: an empty or skeleton licence file → exit 1, the file is named, no target', () => {
  const examples = {
    'empty': '',
    'only spaces': '  \n\t\n',
    'only a heading': 'LICENSE\n',
    'yer tutucu': 'TODO: add the licence text',
    'short copyright line': 'Copyright (c) 2026',
    'long text without a key word': 'x'.repeat(400),
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

test('faulty: a new vendor library without a licence → exit 1; also 1 when the licence file is empty; 0 with a real licence', () => {
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

test('faulty: no index.html (only licences) → exit 1', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  fs.rmSync(path.join(k, 'index.html'));
  const r = run(repo, '--source', k, '--target', path.join(repo, 'dist'));
  assert.equal(r.code, 1);
  assert.match(r.output, /index\.html/);
});

test('faulty: the target inside the source or containing the source → exit 1, the source is not removed', () => {
  const repo = fakeRepo();
  const k = skeleton(repo);
  assert.equal(run(repo, '--source', k, '--target', path.join(k, 'dist')).code, 1);
  assert.equal(run(repo, '--source', k, '--target', k).code, 1);
  assert.equal(run(repo, '--source', k, '--target', path.dirname(k)).code, 1);
  assert.ok(fs.existsSync(path.join(k, 'index.html')));
});

test('faulty: a missing source → exit 1', () => {
  const repo = fakeRepo();
  const r = run(repo, '--source', path.join(repo, 'none'), '--target', path.join(repo, 'dist'));
  assert.equal(r.code, 1);
  assert.match(r.output, /no source folder/);
});

// ---------------------------------------------------------------- --web (static site / GitHub Pages)
const EMBEDDED_NAME = ['pako', '@pdf-lib/upng', '@pdf-lib/standard-fonts', 'tslib', '@pdf-lib/brotli', '@pdf-lib/restructure', '@pdf-lib/unicode-properties', 'unicode-trie', 'dfa', 'clone',
  'deep-equal', 'iconv-lite', 'base64-js', 'base64-arraybuffer', 'buffer', 'ieee754', 'isarray', 'inherits', 'readable-stream',
  'process-es6', 'regenerator-runtime'];
const NOTICE = '# Third-party notices\n\n' + ['pdf-lib', 'pdfjs', 'fontkit', 'literata', 'Colorfigures', ...EMBEDDED_NAME].map((a) => `- ${a}: MIT license, copyright holders`).join('\n')
  + '\n\nEach component keeps its own license and copyright notice; full texts ship next to the files.\n' + 'x'.repeat(120) + '\n';
/** A fake repository with LICENSE and THIRD_PARTY_NOTICES.md at its root + a skeleton source (the vendor subfolders are named in the notices). */
function webRepo() {
  const repo = fakeRepo();
  const k = skeleton(repo);
  write(k, 'vendor/pdfjs/pdf.min.js'); write(k, 'vendor/fontkit/fontkit.umd.min.js');
  write(repo, 'LICENSE', LICENSE);
  write(repo, 'THIRD_PARTY_NOTICES.md', NOTICE);
  return { repo, k, h: path.join(repo, 'dist') };
}

test('--web: LICENSE and THIRD_PARTY_NOTICES.md at the root are copied byte for byte to the root of the target; not copied without --web', () => {
  const { repo, k, h } = webRepo();
  let r = run(repo, '--source', k, '--target', h, '--web');
  assert.equal(r.code, 0, r.output);
  for (const a of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) assert.equal(fs.readFileSync(path.join(h, a), 'utf8'), fs.readFileSync(path.join(repo, a), 'utf8'), a);
  for (const g of LICENSES) assert.ok(fs.existsSync(path.join(h, g)), g);
  r = run(repo, '--source', k, '--target', h);
  assert.equal(r.code, 0, r.output);
  assert.ok(!fs.existsSync(path.join(h, 'LICENSE')) && !fs.existsSync(path.join(h, 'THIRD_PARTY_NOTICES.md')));
});

test('real repository --web: exit 0 with app/ + LICENSE/THIRD_PARTY_NOTICES.md at the root', () => {
  const repo = fakeRepo();
  for (const a of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(APP, '..', a), path.join(repo, a));
  const h = path.join(repo, 'dist');
  const r = run(repo, '--source', APP, '--target', h, '--web', '--quiet');
  assert.equal(r.code, 0, r.output);
  for (const a of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'index.html', ...LICENSES]) assert.ok(fs.existsSync(path.join(h, a)), a);
});

test('faulty --web: root LICENSE missing / empty / skeleton, notices missing / empty → exit 1, the file is named, no target', () => {
  const states = {
    'LICENSE missing': (repo) => fs.rmSync(path.join(repo, 'LICENSE')),
    'LICENSE empty': (repo) => fs.writeFileSync(path.join(repo, 'LICENSE'), ''),
    'LICENSE skeleton': (repo) => fs.writeFileSync(path.join(repo, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026\n'),
    'LICENSE is a folder': (repo) => { fs.rmSync(path.join(repo, 'LICENSE')); fs.mkdirSync(path.join(repo, 'LICENSE')); },
    'notices missing': (repo) => fs.rmSync(path.join(repo, 'THIRD_PARTY_NOTICES.md')),
    'notices empty': (repo) => fs.writeFileSync(path.join(repo, 'THIRD_PARTY_NOTICES.md'), '\n\n'),
  };
  for (const [name, corrupt] of Object.entries(states)) {
    const { repo, k, h } = webRepo();
    corrupt(repo);
    const r = run(repo, '--source', k, '--target', h, '--web');
    assert.equal(r.code, 1, name);
    assert.match(r.output, name.startsWith('LICENSE') ? /LICENSE/ : /THIRD_PARTY_NOTICES\.md/, name);
    assert.ok(!fs.existsSync(h), name + ': target created');
  }
});

test('faulty --web: the notices do not name a vendor library or Colorfigures → exit 1, the missing name is written', () => {
  for (const missingName of ['pdfjs', 'fontkit', 'Colorfigures']) {
    const { repo, k, h } = webRepo();
    fs.writeFileSync(path.join(repo, 'THIRD_PARTY_NOTICES.md'), NOTICE.split('\n').filter((s) => !s.includes(missingName)).join('\n'));
    const r = run(repo, '--source', k, '--target', h, '--web');
    assert.equal(r.code, 1, missingName);
    assert.match(r.output, new RegExp(missingName + ' not named'), missingName);
  }
  // when code embedded in a built package is not named
  for (const missingName of ['pako', 'iconv-lite', 'ieee754']) {
    const w = webRepo();
    fs.writeFileSync(path.join(w.repo, 'THIRD_PARTY_NOTICES.md'), NOTICE.split('\n').filter((s) => !s.includes(missingName)).join('\n'));
    const rr = run(w.repo, '--source', w.k, '--target', w.h, '--web');
    assert.equal(rr.code, 1, missingName);
    assert.match(rr.output, new RegExp(missingName + ' not named'), missingName);
  }
  // when a new vendor library is added and not written into the notices
  const { repo, k, h } = webRepo();
  write(k, 'vendor/fresh-library/LICENSE', LICENSE);
  const r = run(repo, '--source', k, '--target', h, '--web');
  assert.equal(r.code, 1);
  assert.match(r.output, /fresh-library not named/);
});

test('faulty --web: a LICENSE in the source too (clash with the root file) → exit 1', () => {
  const { repo, k, h } = webRepo();
  write(k, 'LICENSE', LICENSE);
  const r = run(repo, '--source', k, '--target', h, '--web');
  assert.equal(r.code, 1);
  assert.match(r.output, /clashes/);
  assert.ok(!fs.existsSync(h), 'target created');
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
