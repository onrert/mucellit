'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../js/plugins/epub/zip.js');
const U = require('./epub-build.cjs');

async function errorCode(fn) {
  try { await fn(); } catch (e) { return { code: e.code, message: e.message }; }
  return { code: null };
}

test('zip: stored and deflated entries open byte for byte, the order is kept', async () => {
  const long = 'book binding '.repeat(500);
  const z = Z.read(U.makeZip([
    { name: 'mimetype', data: 'application/epub+zip', method: 0 },
    { name: 'a/b.txt', data: long, method: 8 },
    { name: 'folder/', data: '', method: 0 }
  ]));
  assert.deepEqual(z.names(), ['mimetype', 'a/b.txt']);
  assert.equal(await z.text('mimetype'), 'application/epub+zip');
  assert.equal(await z.text('a/b.txt'), long);
  assert.equal(z.has('A/B.TXT'), true, 'case-insensitive fallback match');
  assert.equal(z.has('missing.txt'), false);
});

test('zip: Turkish (UTF-8) entry name and Turkish content', async () => {
  const z = Z.read(U.makeZip([{ name: 'OEBPS/Bölüm-çğışöü İ.xhtml', data: 'Iğdır ılık İstanbul', method: 8 }]));  // turkish-ok: Turkish test text
  assert.deepEqual(z.names(), ['OEBPS/Bölüm-çğışöü İ.xhtml']);  // turkish-ok: Turkish test text
  assert.equal(await z.text('OEBPS/Bölüm-çğışöü İ.xhtml'), 'Iğdır ılık İstanbul');  // turkish-ok: Turkish test text
});

test('zip: random bytes → E1 (Turkish message)', async () => {
  const r = await errorCode(() => Z.read(U.ready.corrupt()));
  assert.equal(r.code, 'E1');
  assert.equal(r.message, 'Bu dosya okunamadı: geçerli bir EPUB (ZIP) değil ya da bozuk.');  // turkish-ok: expected Turkish UI text
});

test('zip: empty and truncated file → E1', async () => {
  assert.equal((await errorCode(() => Z.read(new Uint8Array(0)))).code, 'E1');
  const full = U.makeZip([{ name: 'a.txt', data: 'hello world '.repeat(50) }]);
  assert.equal((await errorCode(() => Z.read(full.subarray(0, full.length - 30)))).code, 'E1', 'EOCD cut off');
});

test('zip: CRC mismatch → E1 (when opening)', async () => {
  const z = Z.read(U.makeZip([{ name: 'a.txt', data: 'content', corruptCrc: true }]));
  assert.equal((await errorCode(() => z.open('a.txt'))).code, 'E1');
});

test('zip: encryption flag (bit 0) → E3 DRM message', async () => {
  const r = await errorCode(() => Z.read(U.makeZip([{ name: 'a.txt', data: 'x', flag: 0x801 }])));
  assert.equal(r.code, 'E3');
  assert.match(r.message, /^Bu EPUB DRM ile korunuyor \(şifreli içerik\)\. Mücellit DRM'li kitapları açmaz; DRM'siz bir kopya kullanın\.$/);  // turkish-ok: expected Turkish UI text
});

test('zip: compression method 12 (bzip2) → E7, the method in the detail', async () => {
  const z = Z.read(U.makeZip([{ name: 'a.txt', data: 'x', method: 12 }]));
  const r = await errorCode(() => z.open('a.txt'));
  assert.equal(r.code, 'E7');
  assert.match(r.message, /^Bu EPUB'un ZIP biçimi desteklenmiyor \(sıkıştırma yöntemi 12/);  // turkish-ok: expected Turkish UI text
});

test('zip: ZIP64 locator → E7 (ZIP64)', async () => {
  const r = await errorCode(() => Z.read(U.makeZip([{ name: 'a.txt', data: 'x' }], { zip64Locator: true })));
  assert.equal(r.code, 'E7');
  assert.match(r.message, /\(ZIP64\)\.$/);
});

test('zip: ".." and root paths do not leave the ZIP; parsePath resolves a relative path', async () => {
  const z = Z.read(U.makeZip([{ name: '../../etc/x.txt', data: 'a' }, { name: '/root.txt', data: 'b' }]));
  assert.deepEqual(z.names(), ['etc/x.txt', 'root.txt']);
  assert.equal(Z.parsePath('OEBPS/text/b1.xhtml', '../img/a%20b.png#x'), 'OEBPS/img/a b.png');
  assert.equal(Z.parsePath('OEBPS/content.opf', 'text/b1.xhtml'), 'OEBPS/text/b1.xhtml');
  assert.equal(Z.parsePath('OEBPS/', '../../../x.css'), 'x.css');
});

test('zip: in the ready EPUB fixture (trMini) mimetype is first and stored', async () => {
  const z = Z.read(U.ready.trMini());
  assert.equal(z.names()[0], 'mimetype');
  assert.equal(z.input('mimetype').method, 0);
  assert.ok(z.has('META-INF/container.xml'));
  assert.match(await z.text('OEBPS/b1.xhtml'), /ÖĞÜŞÇ ğüşıöçİ/);  // turkish-ok: expected Turkish UI text
});

// ---- fix tests (encoding included) ----
const zlib = require('node:zlib');

test('zip D1: a deflate stream bigger than the declared size is cut while reading → E1 (compression bomb)', async () => {
  const bomb = Buffer.alloc(8 * 1024 * 1024); // 8 MB of zeros ≈ 8 KB deflated
  const z = Z.read(U.makeZip([{ name: 'bomb.xhtml', data: bomb, reportedSize: 1000 }]));
  const r = await errorCode(() => z.open('bomb.xhtml'));
  assert.equal(r.code, 'E1');
  assert.match(r.message, /^Bu dosya okunamadı/);  // turkish-ok: expected Turkish UI text
  const e = await (async () => { try { await z.open('bomb.xhtml'); } catch (x) { return x; } })();
  assert.match(e.detail, /açılan veri bildirilen boyutu aşıyor/, 'cut while reading: ' + e.detail);  // turkish-ok: expected Turkish UI text
});

test('zip D1: when the declared unpacked size passes the absolute limit, E1 without opening', async () => {
  const data = 'a'.repeat(5000);
  const z = Z.read(U.makeZip([{ name: 'a.txt', data }, { name: 'b.txt', data: 'small' }]), { maxOpened: 4096 });
  const e = await (async () => { try { await z.open('a.txt'); } catch (x) { return x; } return null; })();
  assert.ok(e, 'a 5000 byte entry must not open with a 4096 limit');
  assert.equal(e.code, 'E1');
  assert.match(e.detail, /sınırı aşıyor/);  // turkish-ok: expected Turkish UI text
  assert.equal(await z.text('b.txt'), 'small', 'an entry under the limit opens');
});

test('zip D2: the entry table has no prototype; toString/constructor/__proto__ names do not mix in', async () => {
  const z = Z.read(U.makeZip([{ name: 'a.txt', data: 'a' }, { name: '__proto__', data: 'proto content' }, { name: 'constructor', data: 'constructor content' }]));
  assert.equal(z.has('toString'), false);
  assert.equal(z.has('hasOwnProperty'), false);
  assert.equal(z.has('TOSTRING'), false);
  const r = await errorCode(() => z.open('valueOf'));
  assert.equal(r.code, 'NONE');
  assert.equal(await z.text('__proto__'), 'proto content');
  assert.equal(await z.text('constructor'), 'constructor content');
  assert.deepEqual(z.names(), ['a.txt', '__proto__', 'constructor']);
});

test('zip D6: entries with a data descriptor (flag bit 3) open correctly from the central directory', async () => {
  const long = 'Iğdır ılık İstanbul '.repeat(300);  // turkish-ok: Turkish test text
  const z = Z.read(U.makeZip([
    { name: 'mimetype', data: 'application/epub+zip', method: 0 },
    { name: 'a.xhtml', data: long, dataIdentifier: true },
    { name: 'b.bin', data: Buffer.from([1, 2, 3, 4, 5]), method: 0, dataIdentifier: true },
    { name: 'c.txt', data: 'last entry', dataIdentifier: true }
  ]));
  assert.equal(z.input('a.xhtml').flag & 8, 8);
  assert.equal(await z.text('a.xhtml'), long);
  assert.deepEqual(Array.from(await z.open('b.bin')), [1, 2, 3, 4, 5]);
  assert.equal(await z.text('c.txt'), 'last entry');
});

test('zip D6: a ZIP comment at the end of the EOCD (short and 60 000 bytes) does not break the EOCD search', async () => {
  for (const comment of ['Mucellit test comment', 'y'.repeat(60000)]) {
    const z = Z.read(U.makeZip([{ name: 'a.txt', data: 'hello' }, { name: 'b.txt', data: 'world' }], { comment }));
    assert.deepEqual(z.names(), ['a.txt', 'b.txt']);
    assert.equal(await z.text('b.txt'), 'world');
  }
});

test('zip encoding: with an XML declaration of windows-1254 / iso-8859-9 the text is decoded with that encoding', async () => {
  const tr = 'Iğdır ılık İstanbul; ÖĞÜŞÇ ğüşıöçİ';  // turkish-ok: Turkish test text
  // windows-1254 bytes: the Turkish letters are one byte each
  const w1254 = { 'ğ': 0xf0, 'ı': 0xfd, 'İ': 0xdd, 'Ö': 0xd6, 'Ğ': 0xd0, 'Ü': 0xdc, 'Ş': 0xde, 'Ç': 0xc7, 'ü': 0xfc, 'ş': 0xfe, 'ö': 0xf6, 'ç': 0xe7 };  // turkish-ok: Turkish test text
  const encode = (s) => Buffer.from([...s].map((c) => w1254[c] !== undefined ? w1254[c] : c.charCodeAt(0)));
  for (const name of ['windows-1254', 'ISO-8859-9']) {
    const xml = Buffer.concat([Buffer.from(`<?xml version="1.0" encoding="${name}"?>\n<html><body><p>`), encode(tr), Buffer.from('</p></body></html>')]);
    const z = Z.read(U.makeZip([{ name: 'b.xhtml', data: xml }]));
    const m = await z.text('b.xhtml');
    assert.ok(m.includes(tr), `${name}: ${m.slice(0, 120)}`);
    assert.ok(!m.includes('�'));
    assert.deepEqual(z.unsupportedEncodings(), []);
  }
});

test('zip encoding: a UTF-8 declaration and text without a declaration are unchanged; an unsupported encoding is read as UTF-8 and reported', async () => {
  const z = Z.read(U.makeZip([
    { name: 'u.xhtml', data: '<?xml version="1.0" encoding="UTF-8"?><p>ğüş</p>' },  // turkish-ok: Turkish test text
    { name: 'c.css', data: 'p { font-style: italic } /* ğ */' },  // turkish-ok: Turkish test text
    { name: 'x.xhtml', data: '<?xml version="1.0" encoding="x-unknown-code"?><p>abc ğ</p>' }  // turkish-ok: Turkish test text
  ]));
  assert.equal(await z.text('u.xhtml'), '<?xml version="1.0" encoding="UTF-8"?><p>ğüş</p>');  // turkish-ok: Turkish test text
  assert.equal(await z.text('c.css'), 'p { font-style: italic } /* ğ */');  // turkish-ok: Turkish test text
  assert.equal(await z.text('x.xhtml'), '<?xml version="1.0" encoding="x-unknown-code"?><p>abc ğ</p>');  // turkish-ok: Turkish test text
  assert.deepEqual(z.unsupportedEncodings(), ['x-unknown-code']);
});

test('zip encoding D-2: UTF-8 content declared as iso-8859-1 is read as UTF-8; a real windows-1254 byte declaration is kept', async () => {
  const tr = 'Iğdır ılık İstanbul';  // turkish-ok: Turkish test text
  const z = Z.read(U.makeZip([{ name: 'u.xhtml', data: `<?xml version="1.0" encoding="iso-8859-1"?><p>${tr}</p>` }]));
  const m = await z.text('u.xhtml');
  assert.ok(m.includes(tr), m);
  assert.ok(!m.includes('Ä'), 'no mojibake');
  const w1254 = { 'ğ': 0xf0, 'ı': 0xfd, 'İ': 0xdd };  // turkish-ok: Turkish test text
  const bytes = Buffer.from([...tr].map((c) => w1254[c] !== undefined ? w1254[c] : c.charCodeAt(0)));
  const xml = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="windows-1254"?><p>'), bytes, Buffer.from('</p>')]);
  const z2 = Z.read(U.makeZip([{ name: 'w.xhtml', data: xml }]));
  assert.ok((await z2.text('w.xhtml')).includes(tr));
});

// ---- the browser's compression of a folder package EPUB ("<name>.epub.zip", one top folder) ----
async function prefixedZip(prefix, suffixes) {
  const raw = Z.read(U.epub(U.trMiniDefinition()));
  const g = [];
  for (const a of raw.names()) g.push({ name: prefix + a, data: Buffer.from(await raw.open(a)), method: 8 });
  return U.makeZip(g.concat(suffixes || []));
}

test('zip (.epub.zip): the single top folder prefix is dropped; __MACOSX and .DS_Store are ignored; same content', async () => {
  const z = Z.read(await prefixedZip('Mavi Pusula.epub/', [
    { name: 'Mavi Pusula.epub/', data: '', method: 0 },
    { name: '__MACOSX/Mavi Pusula.epub/._mimetype', data: 'x' },
    { name: 'Mavi Pusula.epub/.DS_Store', data: 'x' },
  ]));
  assert.equal(z.rootPrefix(), 'Mavi Pusula.epub/');
  const original = Z.read(U.epub(U.trMiniDefinition()));
  assert.deepEqual(z.names(), original.names());
  assert.equal(z.has('META-INF/container.xml'), true);
  assert.equal(await z.text('mimetype'), 'application/epub+zip');
  assert.equal(await z.text('OEBPS/b1.xhtml'), await original.text('OEBPS/b1.xhtml'));
  assert.equal(z.has('.DS_Store'), false);
  assert.equal(z.names().some((a) => /__MACOSX|DS_Store/.test(a)), false);
});

test('zip (.epub.zip): cases where the prefix is kept (container at the root, two top folders, a root file without the prefix, no container)', async () => {
  // an ordinary EPUB: no prefix
  assert.equal(Z.read(U.epub(U.trMiniDefinition())).rootPrefix(), '');
  // container.xml at the root too → untouched
  const both = Z.read(U.makeZip([
    { name: 'META-INF/container.xml', data: '<c/>' },
    { name: 'X.epub/META-INF/container.xml', data: '<c/>' },
  ]));
  assert.equal(both.rootPrefix(), '');
  assert.equal(both.has('X.epub/META-INF/container.xml'), true);
  // a container at the root and every entry under META-INF/ (nested META-INF/META-INF/container.xml) → untouched
  const nested = Z.read(U.makeZip([
    { name: 'META-INF/container.xml', data: '<c/>' },
    { name: 'META-INF/META-INF/container.xml', data: '<c/>' },
  ]));
  assert.equal(nested.rootPrefix(), '');
  assert.equal(nested.has('META-INF/META-INF/container.xml'), true);
  // two separate top folders
  const two = Z.read(await prefixedZip('A.epub/', [{ name: 'B/x.txt', data: 'x' }]));
  assert.equal(two.rootPrefix(), '');
  assert.equal(two.has('META-INF/container.xml'), false);
  // a file at the root outside the prefix
  const rootFile = Z.read(await prefixedZip('A.epub/', [{ name: 'readme.txt', data: 'x' }]));
  assert.equal(rootFile.rootPrefix(), '');
  // one folder but no container inside
  const noContainer = Z.read(U.makeZip([{ name: 'A/mimetype', data: 'application/epub+zip' }, { name: 'A/OEBPS/b.xhtml', data: '<x/>' }]));
  assert.equal(noContainer.rootPrefix(), '');
  assert.equal(noContainer.has('A/mimetype'), true);
  // only system leftovers
  assert.equal(Z.read(U.makeZip([{ name: '__MACOSX/._a', data: 'x' }])).rootPrefix(), '');
});

test('zip (.epub.zip): the container is found with a different case of the prefix too (meta-inf/CONTAINER.XML)', async () => {
  const z = Z.read(U.makeZip([
    { name: 'K.epub/mimetype', data: 'application/epub+zip', method: 0 },
    { name: 'K.epub/meta-inf/CONTAINER.XML', data: '<c/>' },
  ]));
  assert.equal(z.rootPrefix(), 'K.epub/');
  assert.equal(z.has('META-INF/container.xml'), true);
});

test('repo fixture: folder package (app/test/fixtures/folder-package.epub) with the epub-read-cli checker; faulty inputs fail', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { verify } = require('./epub-read-cli.cjs');
  const root = path.join(__dirname, 'fixtures', 'folder-package.epub');
  const files = [];
  (function walk(d) {
    for (const g of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (g.name.startsWith('.')) continue;
      const y = path.join(d, g.name);
      if (g.isDirectory()) walk(y); else files.push(path.relative(root, y).split(path.sep).join('/'));
    }
  })(root);
  files.sort((a, b) => (a === 'mimetype' ? -1 : b === 'mimetype' ? 1 : a < b ? -1 : 1));
  const input = (name, ek) => Object.assign({ name, data: fs.readFileSync(path.join(root, name)), method: name === 'mimetype' ? 0 : 8 }, ek);
  const good = await verify(U.makeZip(files.map((a) => input(a))));
  assert.equal(good.title, 'Klasör Paketi Deneme Kitabı');  // turkish-ok: Turkish test text
  assert.deepEqual(good.warnings, []);
  // faulty: mimetype compressed / in second place / a manifest file missing / no container
  const tight = await verify(U.makeZip(files.map((a) => input(a, a === 'mimetype' ? { method: 8 } : {}))));
  assert.ok(tight.warnings.some((u) => /compressed/.test(u)), JSON.stringify(tight));
  const order = files.slice(1).concat(['mimetype']);
  assert.ok((await verify(U.makeZip(order.map((a) => input(a))))).warnings.some((u) => /first entry/.test(u)));
  const missing = files.filter((a) => a !== 'OEBPS/chapter-2.xhtml');
  assert.ok((await verify(U.makeZip(missing.map((a) => input(a))))).warnings.some((u) => /manifest file missing/.test(u)));
  await assert.rejects(verify(U.makeZip(files.filter((a) => !a.startsWith('META-INF/')).map((a) => input(a)))), /container/);
  await assert.rejects(verify(Buffer.alloc(0)), /./);
});

test('without deflate (no DecompressionStream) the browser suggests Chrome/Edge, the Mac app gives the macOS text', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const { setupI18n } = require('./i18n-helper.js');
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'plugins', 'epub', 'zip.js'), 'utf8');
  const bytes = U.makeZip([{ name: 'a.txt', data: 'x'.repeat(100), method: 8 }]);
  for (const [platform, expected, non] of [['browser', /Chrome\/Edge/, null], ['tauri', /macOS/, /Chrome|Edge|browser/i]]) {
    const ctx = {};
    ctx.self = ctx;
    vm.createContext(ctx);
    setupI18n(ctx, 'en');
    ctx.Mucellit.platform = { name: platform };
    vm.runInContext(source, ctx, { filename: 'zip.js' });
    const z = ctx.Mucellit.epubZip.read(vm.runInContext('Uint8Array', ctx).from(bytes));
    const r = await errorCode(() => z.open('a.txt'));
    assert.equal(r.code, 'E7', platform);
    assert.match(r.message, expected, platform);
    if (non) assert.doesNotMatch(r.message, non, platform);
  }
});
