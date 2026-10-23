'use strict';
// The code base is in English: no Turkish in file names, code, comments, strings or docs outside the allowlist
// (app/test/turkish-scan.js documents the allowlist). The scanner itself is tested with faulty inputs below.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./turkish-scan.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const reasons = (file, text) => S.scanText(file, text).map((f) => f.line + ': ' + f.reason);

test('Turkish scan: no Turkish outside the allowlist in the repository (file names, code, comments, docs)', (t) => {
  const r = S.scanRepo();
  const problems = S.resultProblems(r);
  assert.deepEqual(problems.slice(0, 30), [], `${problems.length} problems`);
  for (const f of ['app/js/app.js', 'app/i18n/tr.js', 'src-tauri/src/lib.rs', 'README.md', 'README.tr.md', 'tools/prepare-dist.mjs']) {
    assert.ok(S.isScanned(f) && fs.existsSync(path.join(ROOT, f)), f);
  }
  const files = Object.keys(r.allow);
  const lines = files.reduce((n, f) => n + r.allow[f].lines, 0);
  const blocks = files.reduce((n, f) => n + r.allow[f].blocks, 0);
  t.diagnostic(`${r.files} files scanned; allowlist: ${files.length} files, ${blocks} blocks, ${lines} marked lines`);
});

test('Turkish scan faulty input: Turkish letters, ASCII Turkish words, identifiers, suffixes and CSS names are caught', () => {
  // turkish-data: begin (faulty test inputs)
  const bad = [
    ['app/js/a.js', '// sayfa sayısı'],
    ['app/js/a.js', '// sayfa sayisi yanlis'],
    ['app/js/a.js', 'const kitapGen = 1;'],
    ['app/js/a.js', "throw new Error('Yükleniyor');"],
    ['app/js/a.js', '// dosyalari okunuyor'],
    ['src-tauri/src/a.rs', 'let kagit_kalinlik = 0.1;'],
    ['app/css/a.css', ':root { --zemin: #fff; }'],
    ['app/index.html', '<button id="kaydet-dugmesi">Save</button>'],
    ['README.md', 'Kurulum: dosyayi acin.'],
    ['src-tauri/Cargo.toml', 'description = "kitap ciltleme"'],
    ['.github/workflows/pages.yml', '# kitap sayfasi'],
  ];
  // turkish-data: end
  for (const [file, text] of bad) assert.ok(S.scanText(file, text).length > 0, `${file}: ${text}`);
});

test('Turkish scan faulty input: paths, a dictionary with Turkish keys and copies into the wrong file are caught', () => {
  // turkish-data: begin (faulty test inputs)
  assert.deepEqual(reasons('app/js/sayfa.js', 'var a = 1;').map((r) => r.split(':')[0]), ['0'], 'a Turkish file name');
  assert.ok(reasons('app/kitaplar/a.js', '').length > 0, 'a Turkish folder name');
  assert.ok(reasons('app/i18n/tr.js', '  "impose.sayfa_sec": "Sayfa seç",').some((r) => /dictionary key/.test(r)), 'a Turkish key in tr.js');
  assert.deepEqual(reasons('app/i18n/tr.js', '  "impose.select_page": "Sayfa seç",'), [], 'a Turkish value in tr.js is allowed');
  assert.deepEqual(reasons('app/i18n/tr.js', '// sayfa seçimi\n  "a.b": "c",').map((r) => r.split(':')[0]), ['1'], 'a Turkish comment in tr.js is caught');
  const tr = read('app/i18n/tr.js');
  assert.ok(S.scanText('app/i18n/en.js', tr).length > 50, 'the tr dictionary copied into en.js');
  const readmeTr = read('README.tr.md');
  assert.deepEqual(S.scanText('README.tr.md', readmeTr), [], 'README.tr.md is allowed');
  assert.ok(S.scanText('README.md', readmeTr).length > 10, 'README.tr.md copied into README.md');
  assert.deepEqual(reasons('app/test/fixtures/legacy/a.json', '{"ad": "Dikiş"}'), [], 'fixture data is allowed');
  assert.ok(reasons('app/test/fixtures/legacy/README.txt', 'Sentetik kayıtlar').length > 0, 'a fixture README is scanned');
  // turkish-data: end
  assert.equal(S.isScanned('app/vendor/pdfjs/pdf.min.js'), false, 'vendor code is not scanned');
  assert.equal(S.isScanned('docs/preview.png'), false, 'binary files are not scanned');
});

// turkish-data: begin (faulty test inputs of the marker tests)
test('Turkish scan faulty input: broken allowlist markers are caught; a marker covers only its block or line', () => {
  const B = 'turkish' + '-data', L = 'legacy' + '-names';
  assert.ok(reasons('app/js/a.js', `// ${B}: begin\nvar s = 'şeker';`).some((r) => /never closed/.test(r)), 'an unclosed block');
  assert.ok(reasons('app/js/a.js', `var a = 1;\n// ${B}: end`).some((r) => /without begin/.test(r)), 'an end without begin');
  assert.ok(reasons('app/js/a.js', `// ${B}: begin\n// ${L}: begin\n// ${L}: end\n// ${B}: end`).some((r) => /inside/.test(r)), 'nested blocks');
  assert.deepEqual(reasons('app/js/a.js', `// ${B}: begin (test words)\nvar s = 'şeker';\n// ${B}: end\nvar t = 1;`), [], 'a closed block');
  assert.deepEqual(reasons('app/js/a.js', `// ${B}: begin (test words)\nvar s = 'şeker';\n// ${B}: end\nvar t = 'ılık';`).map((r) => r.split(':')[0]), ['4'], 'after the block it is scanned again');
  const OK = 'turkish' + '-ok';
  assert.ok(reasons('app/js/a.js', `var s = 'şeker'; // ${OK}`).some((r) => /without a reason/.test(r)), 'a marker without a reason');
  assert.deepEqual(reasons('app/js/a.js', `var s = 'şeker'; // ${OK}: test data`), [], 'a marker with a reason');
  assert.deepEqual(reasons('app/js/a.js', `var s = 'şeker'; // ${OK}: test data\nvar t = 'ılık';`).map((r) => r.split(':')[0]), ['2'], 'the marker covers its line only');
});
// turkish-data: end

test('Turkish scan faulty input: an empty or skeleton scan does not pass; one bad line among clean lines is found exactly', () => {
  assert.ok(S.resultProblems({ files: 0, findings: [] }).length > 0, 'nothing scanned');
  assert.ok(S.resultProblems({ files: 5, findings: [] }).length > 0, 'a skeleton file list');
  assert.ok(S.resultProblems(null).length > 0, 'no result');
  assert.deepEqual(S.resultProblems({ files: 150, findings: [] }), [], 'a full clean scan passes');
  assert.deepEqual(S.scanText('app/js/a.js', ''), [], 'an empty file has no finding');
  const clean = Array.from({ length: 200 }, (_, i) => `var value${i} = ${i}; // the value number ${i}`);
  clean[137] = 'var yeniAd = 1;'; // turkish-ok: the one faulty line of this test
  assert.deepEqual(reasons('app/js/a.js', clean.join('\n')).map((r) => r.split(':')[0]), ['138']);
});

test('Turkish scan has no false alarm on English text, the product name and the author name', () => {
  const english = [
    "We've set up the menu; once the page loads, the cancel button shows.",
    'The spine and the boards are cut; the covering is glued and turned in.',
    'Mücellit is the app name; MÜCELLİT on the cover drawing.',
    'Copyright (c) 2026 Onur Mert Ertuğrul',
    'SIL Open Font License 1.1 (OFL-1.1)',
    'const sheetsPerSignature = 4; // signatures, sheets, leaves, pages',
  ];
  for (const s of english) assert.deepEqual(reasons('app/js/a.js', s), [], s);
  // turkish-data: begin (a split test with Turkish words)
  assert.deepEqual(S.words('kitapGen ÜstBaşlık HTMLParser'), ['kitap', 'gen', 'ust', 'baslik', 'html', 'parser']);
  // turkish-data: end
});
