/*
 * epub-oku-cli.cjs — YALNIZ TEST: bir EPUB (ZIP) dosyasını uygulamanın kendi okuyucusuyla (zip.js) açar,
 * OCF yapısını denetler ve sonucu tek satır JSON olarak yazar. Rust testi (src-tauri/src/epub_klasor.rs)
 * klasör paketinden ürettiği ZIP'i bununla sınar: Rust çıktısını JS tarafı gerçekten okuyabiliyor mu.
 *
 *   node app/test/epub-oku-cli.cjs <dosya.epub>
 *   çıktı: {"adlar":[…],"baslik":"…","uyarilar":[…]}  — uyarı varsa da çıkış 0; okunamazsa çıkış 1.
 *
 * DOMParser Node'da yok; container.xml ve OPF burada düzenli ifadeyle okunur (yalnız test amaçlı).
 */
'use strict';
const fs = require('node:fs');
const Z = require('../js/eklentiler/epub/zip.js');

async function denetle(bayt) {
  const zip = Z.oku(new Uint8Array(bayt));
  const adlar = zip.adlar();
  const uyarilar = [];
  if (adlar[0] !== 'mimetype') uyarilar.push('ilk girdi mimetype değil: ' + adlar[0]);
  const mg = zip.girdi('mimetype');
  if (!mg) uyarilar.push('mimetype yok');
  else {
    if (mg.yontem !== 0) uyarilar.push('mimetype sıkıştırılmış');
    if ((await zip.metin('mimetype')) !== 'application/epub+zip') uyarilar.push('mimetype içeriği yanlış');
  }
  if (!zip.var('META-INF/container.xml')) throw new Error('META-INF/container.xml yok');
  const kap = await zip.metin('META-INF/container.xml');
  const opfYolu = (/full-path="([^"]+)"/.exec(kap) || [])[1];
  if (!opfYolu || !zip.var(opfYolu)) throw new Error('OPF bulunamadı: ' + opfYolu);
  const opf = await zip.metin(opfYolu);
  const baslik = ((/<dc:title[^>]*>([^<]*)<\/dc:title>/.exec(opf)) || [])[1] || null;
  const taban = opfYolu.replace(/[^/]*$/, '');
  for (const m of opf.matchAll(/<item\b[^>]*\bhref="([^"]+)"/g)) {
    const y = Z.yolCoz(taban, m[1]);
    if (!zip.var(y)) uyarilar.push('manifest dosyası yok: ' + y);
    else await zip.ac(y); // CRC ve boyut denetimi zip.js'te
  }
  return { adlar, baslik, uyarilar };
}

if (require.main === module) {
  const dosya = process.argv[2];
  if (!dosya) { console.error('kullanım: node app/test/epub-oku-cli.cjs <dosya.epub>'); process.exit(2); }
  denetle(fs.readFileSync(dosya)).then(
    (s) => { console.log(JSON.stringify(s)); },
    (e) => { console.error('okunamadı: ' + (e && e.message)); process.exit(1); }
  );
}

module.exports = { denetle };
