/*
 * make-font-js.mjs — Literata TTF dosyalarını tarayıcının file:// altında da
 * yükleyebileceği klasik <script> dosyalarına (base64) çevirir.
 *
 * Neden: Chrome file:// altında fetch/XHR ile yerel dosya okumayı engeller; <script>
 * enjeksiyonu ise çalışır. EPUB eklentisi (js/plugins/epub.js) bu JS'leri tembel yükler.
 *
 * Çalıştırma (repo kökünden):
 *   node tools/make-font-js.mjs            → app/vendor/literata/literata-<stil>.js dosyalarını yazar
 *   node tools/make-font-js.mjs --denetle  → yeniden üretip var olan dosyalarla bayt bayt karşılaştırır;
 *                                                 fark, eksik ya da fazla dosyada çıkış 1
 *   --kok <dizin>  repo kökü yerine başka bir dizin (kusurlu girdi sınaması için)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const verify = argv.includes('--verify');
const rootIndex = argv.indexOf('--root');
const ROOT = rootIndex >= 0 ? resolve(argv[rootIndex + 1] || '.') : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'app', 'vendor', 'literata');

// stil anahtarı → TTF adı (anahtar, pdf-writer.js ve epub.js'te aynı)
const STYLES = [
  ['regular', 'Literata-Regular.ttf'],
  ['italic', 'Literata-Italic.ttf'],
  ['bold', 'Literata-Bold.ttf'],
  ['bolditalic', 'Literata-BoldItalic.ttf']
];

function makeContent(style, ttfAd, ttf) {
  return '/* ' + ttfAd + ' (SIL OFL 1.1, bkz. OFL.txt) base64 hali. tools/make-font-js.mjs üretir; elle düzenlemeyin. */\n' +
    '(self.Mucellit = self.Mucellit || {}); (Mucellit.fonts = Mucellit.fonts || {})[\'' + style + '\'] = \'' +
    Buffer.from(ttf).toString('base64') + '\';\n';
}

let error = 0;
for (const [style, ttfAd] of STYLES) {
  const ttfPath = join(DIR, ttfAd);
  const jsPath = join(DIR, 'literata-' + style + '.js');
  if (!existsSync(ttfPath)) { console.log(`HATA ${ttfAd} yok (${ttfPath})`); error += 1; continue; }
  const ttf = readFileSync(ttfPath);
  if (ttf.length < 1024 || ttf.readUInt32BE(0) !== 0x00010000) { console.log(`HATA ${ttfAd} TrueType değil ya da kırpık (${ttf.length} bytes)`); error += 1; continue; }
  const expected = Buffer.from(makeContent(style, ttfAd, ttf), 'utf8');
  if (verify) {
    if (!existsSync(jsPath)) { console.log(`FAIL ${jsPath} none`); error += 1; continue; }
    const var_ = readFileSync(jsPath);
    if (Buffer.compare(var_, expected) !== 0) { console.log(`FAIL literata-${style}.js ${ttfAd} ile uyuşmuyor (${var_.length} ≠ ${expected.length} bayt ya da içerik farklı)`); error += 1; }
    else console.log(`GEÇTİ literata-${style}.js ${expected.length} bayt, ${ttfAd} ile birebir`);
  } else {
    writeFileSync(jsPath, expected);
    console.log(`yazıldı literata-${style}.js (${expected.length} bytes)`);
  }
}
process.exit(error ? 1 : 0);
