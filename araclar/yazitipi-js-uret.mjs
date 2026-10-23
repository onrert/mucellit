/*
 * yazitipi-js-uret.mjs — Literata TTF dosyalarını tarayıcının file:// altında da
 * yükleyebileceği klasik <script> dosyalarına (base64) çevirir.
 *
 * Neden: Chrome file:// altında fetch/XHR ile yerel dosya okumayı engeller; <script>
 * enjeksiyonu ise çalışır. EPUB eklentisi (js/eklentiler/epub.js) bu JS'leri tembel yükler.
 *
 * Çalıştırma (repo kökünden):
 *   node araclar/yazitipi-js-uret.mjs            → app/vendor/literata/literata-<stil>.js dosyalarını yazar
 *   node araclar/yazitipi-js-uret.mjs --denetle  → yeniden üretip var olan dosyalarla bayt bayt karşılaştırır;
 *                                                 fark, eksik ya da fazla dosyada çıkış 1
 *   --kok <dizin>  repo kökü yerine başka bir dizin (kusurlu girdi sınaması için)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const denetle = argv.includes('--denetle');
const kokIndis = argv.indexOf('--kok');
const KOK = kokIndis >= 0 ? resolve(argv[kokIndis + 1] || '.') : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIZIN = join(KOK, 'app', 'vendor', 'literata');

// stil anahtarı → TTF adı (anahtar, pdf-yaz.js ve epub.js'te aynı)
const STILLER = [
  ['regular', 'Literata-Regular.ttf'],
  ['italic', 'Literata-Italic.ttf'],
  ['bold', 'Literata-Bold.ttf'],
  ['bolditalic', 'Literata-BoldItalic.ttf']
];

function icerikUret(stil, ttfAd, ttf) {
  return '/* ' + ttfAd + ' (SIL OFL 1.1, bkz. OFL.txt) base64 hali. araclar/yazitipi-js-uret.mjs üretir; elle düzenlemeyin. */\n' +
    '(self.KitapCilt = self.KitapCilt || {}); (KitapCilt.yaziTipleri = KitapCilt.yaziTipleri || {})[\'' + stil + '\'] = \'' +
    Buffer.from(ttf).toString('base64') + '\';\n';
}

let hata = 0;
for (const [stil, ttfAd] of STILLER) {
  const ttfYol = join(DIZIN, ttfAd);
  const jsYol = join(DIZIN, 'literata-' + stil + '.js');
  if (!existsSync(ttfYol)) { console.log(`HATA ${ttfAd} yok (${ttfYol})`); hata += 1; continue; }
  const ttf = readFileSync(ttfYol);
  if (ttf.length < 1024 || ttf.readUInt32BE(0) !== 0x00010000) { console.log(`HATA ${ttfAd} TrueType değil ya da kırpık (${ttf.length} bayt)`); hata += 1; continue; }
  const beklenen = Buffer.from(icerikUret(stil, ttfAd, ttf), 'utf8');
  if (denetle) {
    if (!existsSync(jsYol)) { console.log(`KALDI ${jsYol} yok`); hata += 1; continue; }
    const var_ = readFileSync(jsYol);
    if (Buffer.compare(var_, beklenen) !== 0) { console.log(`KALDI literata-${stil}.js ${ttfAd} ile uyuşmuyor (${var_.length} ≠ ${beklenen.length} bayt ya da içerik farklı)`); hata += 1; }
    else console.log(`GEÇTİ literata-${stil}.js ${beklenen.length} bayt, ${ttfAd} ile birebir`);
  } else {
    writeFileSync(jsYol, beklenen);
    console.log(`yazıldı literata-${stil}.js (${beklenen.length} bayt)`);
  }
}
process.exit(hata ? 1 : 0);
