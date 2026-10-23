/*
 * epub-read-cli.cjs — YALNIZ TEST: bir EPUB (ZIP) dosyasını uygulamanın kendi okuyucusuyla (zip.js) açar,
 * OCF yapısını denetler ve sonucu tek satır JSON olarak yazar. Rust testi (src-tauri/src/epub_folder.rs)
 * klasör paketinden ürettiği ZIP'i bununla sınar: Rust çıktısını JS tarafı gerçekten okuyabiliyor mu.
 *
 *   node app/test/epub-read-cli.cjs <dosya.epub>
 *   çıktı: {"adlar":[…],"baslik":"…","uyarilar":[…]}  — uyarı varsa da çıkış 0; okunamazsa çıkış 1.
 *
 * DOMParser Node'da yok; container.xml ve OPF burada düzenli ifadeyle okunur (yalnız test amaçlı).
 */
'use strict';
const fs = require('node:fs');
const Z = require('../js/plugins/epub/zip.js');

async function verify(bytes) {
  const zip = Z.read(new Uint8Array(bytes));
  const names = zip.names();
  const warnings = [];
  if (names[0] !== 'mimetype') warnings.push('ilk girdi mimetype değil: ' + names[0]);
  const mg = zip.input('mimetype');
  if (!mg) warnings.push('mimetype yok');
  else {
    if (mg.method !== 0) warnings.push('mimetype sıkıştırılmış');
    if ((await zip.text('mimetype')) !== 'application/epub+zip') warnings.push('mimetype içeriği yanlış');
  }
  if (!zip.has('META-INF/container.xml')) throw new Error('META-INF/container.xml yok');
  const container = await zip.text('META-INF/container.xml');
  const opfPath = (/full-path="([^"]+)"/.exec(container) || [])[1];
  if (!opfPath || !zip.has(opfPath)) throw new Error('OPF bulunamadı: ' + opfPath);
  const opf = await zip.text(opfPath);
  const title = ((/<dc:title[^>]*>([^<]*)<\/dc:title>/.exec(opf)) || [])[1] || null;
  const base = opfPath.replace(/[^/]*$/, '');
  for (const m of opf.matchAll(/<item\b[^>]*\bhref="([^"]+)"/g)) {
    const y = Z.parsePath(base, m[1]);
    if (!zip.has(y)) warnings.push('manifest dosyası yok: ' + y);
    else await zip.open(y); // CRC ve boyut denetimi zip.js'te
  }
  return { names, title, warnings };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('kullanım: node app/test/epub-read-cli.cjs <dosya.epub>'); process.exit(2); }
  verify(fs.readFileSync(file)).then(
    (s) => { console.log(JSON.stringify(s)); },
    (e) => { console.error('okunamadı: ' + (e && e.message)); process.exit(1); }
  );
}

module.exports = { verify };
