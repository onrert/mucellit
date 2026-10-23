#!/usr/bin/env node
/*
 * prepare-dist.mjs — Tauri paketine ve statik siteye (--web) girecek web dosyalarını hazırlar: app/ → dist/.
 * Hariç: kökteki test/ klasörü (birim/e2e testleri, şifreli PDF fixture'ları), bütün *.ttf (Literata'nın JS
 * kopyaları zaten var), adı nokta ile başlayan bütün gizli dosya ve klasörler (.DS_Store, .env, .git/…).
 * Lisans dosyaları dist'e GİRER; varlıkları ve içerikleri (boş/iskelet değil) denetlenir.
 *
 * Hedef güvenliği (silme yalnız betiğin kendi kurduğu klasörde): hedef repo içinde olmalı (bağlar çözülerek),
 * repo kökü/kaynak ile çakışamaz; var olan DOLU hedef, ancak betiğin önceki koşuda hedefin YANINA bıraktığı
 * işaret dosyası (`.<hedef-adı>.dist-hazirla`, içinde hedefin gerçek yolu) varsa silinip yeniden kurulur.
 * İşaret pakete girmesin diye hedefin içine değil yanına yazılır (Tauri frontendDist'teki her dosyayı gömer).
 *
 * --web (statik site, ör. GitHub Pages): repo kökündeki LICENSE ve THIRD_PARTY_NOTICES.md de hedefin köküne
 *   kopyalanır ve zorunludur (boş/iskelet olamaz); bildirim dosyası her vendor/ alt klasörünün adını,
 *   Colorfigures'ı ve derlenmiş paketlerin içine gömülü kodların adlarını (GOMULU) anmalıdır (yeni kütüphane
 *   bildirimsiz yayına girmesin).
 *
 * Kullanım:  node tools/prepare-dist.mjs [--kaynak app] [--hedef dist] [--web] [--sessiz]
 * Çıkış kodu: 0 = hazır; 1 = eksik/yanlış girdi (eksik/boş lisans, index.html yok, hedef repo dışında,
 *   işaretsiz dolu hedef, hedef kaynakla çakışıyor, --web ile kök lisans/bildirim eksik…).
 */
import { readdirSync, readFileSync, writeFileSync, statSync, lstatSync, realpathSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

function arg(name, defaults) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaults;
}
const SOURCE = resolve(arg('--source', join(REPO, 'app')));
const TARGET = resolve(arg('--target', join(REPO, 'dist')));
const QUIET = process.argv.includes('--quiet');
const WEB = process.argv.includes('--web');
/** --web: repo kökünden hedefin köküne kopyalanan zorunlu dosyalar. */
const WEB_ROOT = ['LICENSE', 'THIRD_PARTY_NOTICES.md'];
/** --web: derlenmiş (minify) paketlerin içine gömülü kodlar; paket dosyası kaynakta varsa bildirim bunları da anmalı. */
const EMBEDDED = {
  'vendor/pdf-lib/pdf-lib.min.js': ['pako', '@pdf-lib/upng', '@pdf-lib/standard-fonts', 'tslib'],
  'vendor/fontkit/fontkit.umd.min.js': ['pako', '@pdf-lib/brotli', '@pdf-lib/restructure', '@pdf-lib/unicode-properties',
    'unicode-trie', 'dfa', 'clone', 'deep-equal', 'iconv-lite', 'base64-js', 'base64-arraybuffer', 'buffer', 'ieee754',
    'isarray', 'inherits', 'readable-stream', 'process-es6', 'regenerator-runtime'],
};

/** Kaynakta bulunması zorunlu dosyalar (kaynağa göre). Lisanslar: app/vendor/SOURCES.md; Öğren: app/js/learn/LICENSE. */
const REQUIRED = [
  'index.html',
  'vendor/SOURCES.md',
  'vendor/pdf-lib/LICENSE.md',
  'vendor/pdfjs/LICENSE',
  'vendor/fontkit/LICENSE',
  'vendor/literata/OFL.txt',
  'js/learn/LICENSE', // Öğren rehberinin Colorfigures motoru (MIT; April Zhu, Tolga Cohce)
];
const LICENSE_PATTERN = /^(LICENSE|LICENCE|COPYING|OFL)(\.[a-z]+)?$/i;
/** Lisans metni sayılmak için: boşluksuz en az bu kadar karakter ve bir lisans/telif sözcüğü. */
const LICENSE_MIN = 200;
const LICENSE_WORD = /\b(copyright|license|licence|permission)\b/i;
const MARK_TOOL = 'dist-prepare';

function hariçMi(relPath, name, isFolder) {
  if (isFolder && relPath === 'test') return true;
  if (name.startsWith('.')) return true; // gizli dosya/klasör (.DS_Store, .env, .git/ …)
  if (!isFolder && /\.ttf$/i.test(name)) return true;
  return false;
}

/** Boş ya da iskelet (yer tutucu, tek satır başlık) lisans dosyası mı? Sorun metni ya da null. */
function licenseProblem(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return 'okunamadı'; }
  if (text.replace(/\s+/g, '').length < LICENSE_MIN) return 'boş ya da iskelet (çok kısa)';
  if (!LICENSE_WORD.test(text)) return 'lisans/telif metni değil';
  return null;
}

/** Yolun gerçek (bağları çözülmüş) karşılığı; yol yoksa var olan en yakın üst klasörden kurulur. */
function actualPath(path) {
  const suffixes = [];
  let y = path;
  while (!existsSync(y)) {
    const top = dirname(y);
    if (top === y) break;
    suffixes.unshift(basename(y));
    y = top;
  }
  return join(realpathSync(y), ...suffixes);
}

function stop(message) {
  console.error('dist-prepare: ' + message);
  process.exit(1);
}

function isInside(inner, outer) { return inner === outer || inner.startsWith(outer + sep); }

if (!existsSync(SOURCE) || !statSync(SOURCE).isDirectory()) stop(`kaynak klasör yok: ${SOURCE}`);
const ACTUAL_SOURCE = realpathSync(SOURCE);
const ACTUAL_TARGET = actualPath(TARGET);
if (!isInside(ACTUAL_TARGET, REPO)) stop(`hedef repo dışında (${REPO}): ${TARGET}${ACTUAL_TARGET !== TARGET ? ' → ' + ACTUAL_TARGET : ''}`);
if (ACTUAL_TARGET === REPO) stop(`hedef olarak repo kökü verilemez: ${TARGET}`);
if (isInside(ACTUAL_TARGET, ACTUAL_SOURCE) || isInside(ACTUAL_SOURCE, ACTUAL_TARGET)) stop(`hedef kaynakla çakışıyor (biri ötekinin içinde): ${TARGET}`);
if (existsSync(TARGET) && !lstatSync(TARGET).isDirectory()) stop(`hedef bir klasör değil (dosya ya da bağ): ${TARGET}`);

// İşaret dosyası hedefin yanında; içinde hedefin gerçek yolu. Başka hedeften kopyalanmış işaret geçmez.
const MARKER = join(dirname(ACTUAL_TARGET), '.' + basename(ACTUAL_TARGET) + '.dist-prepare');
// legacy-names: begin (marker written by the script under its earlier name; accepted once, then replaced)
const LEGACY_MARKER = join(dirname(ACTUAL_TARGET), '.' + basename(ACTUAL_TARGET) + '.dist-hazirla');
function legacyMarkValid() {
  try {
    const i = JSON.parse(readFileSync(LEGACY_MARKER, 'utf8'));
    return !!i && i.arac === 'dist-hazirla' && i.hedef === ACTUAL_TARGET;
  } catch { return false; }
}
// legacy-names: end
function markValid() {
  try {
    const i = JSON.parse(readFileSync(MARKER, 'utf8'));
    if (i && i.tool === MARK_TOOL && i.target === ACTUAL_TARGET) return true;
  } catch { /* no current marker: try the legacy one */ }
  return legacyMarkValid();
}
if (existsSync(TARGET) && readdirSync(TARGET).length && !markValid()) {
  stop(`hedef dolu ve dist-prepare işaret dosyası yok (${MARKER}); betiğin kurmadığı klasör silinmez: ${TARGET}`);
}

const missing = REQUIRED.filter((g) => !existsSync(join(SOURCE, g)));
// Zorunlu lisanslar boş/iskelet olmamalı.
for (const g of REQUIRED) {
  if (!LICENSE_PATTERN.test(basename(g)) || !existsSync(join(SOURCE, g))) continue;
  const problem = licenseProblem(join(SOURCE, g));
  if (problem) missing.push(`${g} (${problem})`);
}
// Her vendor alt klasöründe geçerli bir lisans dosyası olmalı (yeni eklenen kütüphane lisanssız pakete girmesin).
const vendor = join(SOURCE, 'vendor');
if (existsSync(vendor)) {
  for (const g of readdirSync(vendor, { withFileTypes: true })) {
    if (!g.isDirectory() || hariçMi('vendor/' + g.name, g.name, true)) continue;
    const licenses = readdirSync(join(vendor, g.name)).filter((a) => LICENSE_PATTERN.test(a));
    if (!licenses.length) missing.push(`vendor/${g.name}/ (lisans dosyası yok)`);
    else if (licenses.every((a) => licenseProblem(join(vendor, g.name, a)))) {
      missing.push(`vendor/${g.name}/ (lisans dosyası boş ya da iskelet: ${licenses.join(', ')})`);
    }
  }
}
if (WEB) {
  for (const a of WEB_ROOT) {
    const y = join(REPO, a);
    if (existsSync(join(SOURCE, a))) missing.push(`${a} (kaynakta da var; kökteki dosyayla çakışır)`);
    if (!existsSync(y) || !statSync(y).isFile()) { missing.push(`${a} (repo kökünde yok)`); continue; }
    const problem = licenseProblem(y);
    if (problem) missing.push(`${a} (${problem})`);
  }
  const noticePath = join(REPO, 'THIRD_PARTY_NOTICES.md');
  if (existsSync(noticePath)) {
    const notice = readFileSync(noticePath, 'utf8').toLowerCase();
    const toMention = existsSync(vendor)
      ? readdirSync(vendor, { withFileTypes: true }).filter((g) => g.isDirectory() && !g.name.startsWith('.')).map((g) => g.name)
      : [];
    if (existsSync(join(SOURCE, 'js/learn/LICENSE'))) toMention.push('Colorfigures');
    for (const [pkg, names] of Object.entries(EMBEDDED)) {
      if (existsSync(join(SOURCE, pkg))) toMention.push(...names);
    }
    for (const name of new Set(toMention)) if (!notice.includes(name.toLowerCase())) missing.push(`THIRD_PARTY_NOTICES.md (${name} anılmıyor)`);
  }
}
if (missing.length) stop('eksik zorunlu dosya: ' + [...new Set(missing)].join(', '));

rmSync(ACTUAL_TARGET, { recursive: true, force: true });
mkdirSync(ACTUAL_TARGET, { recursive: true });
writeFileSync(MARKER, JSON.stringify({ tool: MARK_TOOL, target: ACTUAL_TARGET }) + '\n');
if (existsSync(LEGACY_MARKER)) rmSync(LEGACY_MARKER, { force: true }); // replaced by the current marker
const copied = [];
const skipped = [];
(function walk(d) {
  for (const g of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const tam = join(d, g.name);
    const relPath = relative(SOURCE, tam).split(sep).join('/');
    if (hariçMi(relPath, g.name, g.isDirectory())) { skipped.push(relPath + (g.isDirectory() ? '/' : '')); continue; }
    if (g.isDirectory()) { walk(tam); continue; }
    if (!g.isFile()) { skipped.push(relPath + ' (dosya değil)'); continue; }
    const targetPath = join(ACTUAL_TARGET, relPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(tam, targetPath);
    copied.push(relPath);
  }
})(SOURCE);

if (WEB) {
  for (const a of WEB_ROOT) {
    if (existsSync(join(ACTUAL_TARGET, a))) stop(`inSource da ${a} var; kökteki dosyayla çakışır`);
    copyFileSync(join(REPO, a), join(ACTUAL_TARGET, a));
    copied.push(a + ' (repo kökünden)');
  }
}

// Son denetim: hedefte hariç tutulan bir şey kalmadı, zorunlular geldi.
const leaking = copied.filter((g) => g === 'test' || g.startsWith('test/') || /\.ttf$/i.test(g) || g.split('/').some((p) => p.startsWith('.')));
if (leaking.length) stop('hariç tutulması gereken dosya kopyalandı: ' + leaking.join(', '));
const absent = [...REQUIRED, ...(WEB ? WEB_ROOT : [])].filter((g) => !existsSync(join(ACTUAL_TARGET, g)));
if (absent.length) stop('zorunlu dosya hedefe gelmedi: ' + absent.join(', '));

if (!QUIET) {
  for (const g of copied) console.log('  + ' + g);
  for (const g of skipped) console.log('  - ' + g + ' (hariç)');
}
console.log(`dist-prepare: ${copied.length} dosya → ${relative(process.cwd(), TARGET) || TARGET}; hariç ${skipped.length}`);
