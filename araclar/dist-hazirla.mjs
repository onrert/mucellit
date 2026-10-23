#!/usr/bin/env node
/*
 * dist-hazirla.mjs — Tauri paketine ve statik siteye (--web) girecek web dosyalarını hazırlar: app/ → dist/.
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
 * Kullanım:  node araclar/dist-hazirla.mjs [--kaynak app] [--hedef dist] [--web] [--sessiz]
 * Çıkış kodu: 0 = hazır; 1 = eksik/yanlış girdi (eksik/boş lisans, index.html yok, hedef repo dışında,
 *   işaretsiz dolu hedef, hedef kaynakla çakışıyor, --web ile kök lisans/bildirim eksik…).
 */
import { readdirSync, readFileSync, writeFileSync, statSync, lstatSync, realpathSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

function arg(ad, varsayilan) {
  const i = process.argv.indexOf(ad);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : varsayilan;
}
const KAYNAK = resolve(arg('--kaynak', join(REPO, 'app')));
const HEDEF = resolve(arg('--hedef', join(REPO, 'dist')));
const SESSIZ = process.argv.includes('--sessiz');
const WEB = process.argv.includes('--web');
/** --web: repo kökünden hedefin köküne kopyalanan zorunlu dosyalar. */
const WEB_KOK = ['LICENSE', 'THIRD_PARTY_NOTICES.md'];
/** --web: derlenmiş (minify) paketlerin içine gömülü kodlar; paket dosyası kaynakta varsa bildirim bunları da anmalı. */
const GOMULU = {
  'vendor/pdf-lib/pdf-lib.min.js': ['pako', '@pdf-lib/upng', '@pdf-lib/standard-fonts', 'tslib'],
  'vendor/fontkit/fontkit.umd.min.js': ['pako', '@pdf-lib/brotli', '@pdf-lib/restructure', '@pdf-lib/unicode-properties',
    'unicode-trie', 'dfa', 'clone', 'deep-equal', 'iconv-lite', 'base64-js', 'base64-arraybuffer', 'buffer', 'ieee754',
    'isarray', 'inherits', 'readable-stream', 'process-es6', 'regenerator-runtime'],
};

/** Kaynakta bulunması zorunlu dosyalar (kaynağa göre). Lisanslar: app/vendor/KAYNAK.md; Öğren: app/js/ogren/LICENSE. */
const ZORUNLU = [
  'index.html',
  'vendor/KAYNAK.md',
  'vendor/pdf-lib/LICENSE.md',
  'vendor/pdfjs/LICENSE',
  'vendor/fontkit/LICENSE',
  'vendor/literata/OFL.txt',
  'js/ogren/LICENSE', // Öğren rehberinin Colorfigures motoru (MIT; April Zhu, Tolga Cohce)
];
const LISANS_DESENI = /^(LICENSE|LICENCE|COPYING|OFL)(\.[a-z]+)?$/i;
/** Lisans metni sayılmak için: boşluksuz en az bu kadar karakter ve bir lisans/telif sözcüğü. */
const LISANS_EN_AZ = 200;
const LISANS_SOZCUGU = /\b(copyright|license|licence|permission)\b/i;
const ISARET_ARAC = 'dist-hazirla';

function hariçMi(goreli, ad, klasorMu) {
  if (klasorMu && goreli === 'test') return true;
  if (ad.startsWith('.')) return true; // gizli dosya/klasör (.DS_Store, .env, .git/ …)
  if (!klasorMu && /\.ttf$/i.test(ad)) return true;
  return false;
}

/** Boş ya da iskelet (yer tutucu, tek satır başlık) lisans dosyası mı? Sorun metni ya da null. */
function lisansSorunu(yol) {
  let metin;
  try { metin = readFileSync(yol, 'utf8'); } catch { return 'okunamadı'; }
  if (metin.replace(/\s+/g, '').length < LISANS_EN_AZ) return 'boş ya da iskelet (çok kısa)';
  if (!LISANS_SOZCUGU.test(metin)) return 'lisans/telif metni değil';
  return null;
}

/** Yolun gerçek (bağları çözülmüş) karşılığı; yol yoksa var olan en yakın üst klasörden kurulur. */
function gercekYol(yol) {
  const ekler = [];
  let y = yol;
  while (!existsSync(y)) {
    const ust = dirname(y);
    if (ust === y) break;
    ekler.unshift(basename(y));
    y = ust;
  }
  return join(realpathSync(y), ...ekler);
}

function dur(mesaj) {
  console.error('dist-hazirla: ' + mesaj);
  process.exit(1);
}

function icindeMi(ic, dis) { return ic === dis || ic.startsWith(dis + sep); }

if (!existsSync(KAYNAK) || !statSync(KAYNAK).isDirectory()) dur(`kaynak klasör yok: ${KAYNAK}`);
const GERCEK_KAYNAK = realpathSync(KAYNAK);
const GERCEK_HEDEF = gercekYol(HEDEF);
if (!icindeMi(GERCEK_HEDEF, REPO)) dur(`hedef repo dışında (${REPO}): ${HEDEF}${GERCEK_HEDEF !== HEDEF ? ' → ' + GERCEK_HEDEF : ''}`);
if (GERCEK_HEDEF === REPO) dur(`hedef olarak repo kökü verilemez: ${HEDEF}`);
if (icindeMi(GERCEK_HEDEF, GERCEK_KAYNAK) || icindeMi(GERCEK_KAYNAK, GERCEK_HEDEF)) dur(`hedef kaynakla çakışıyor (biri ötekinin içinde): ${HEDEF}`);
if (existsSync(HEDEF) && !lstatSync(HEDEF).isDirectory()) dur(`hedef bir klasör değil (dosya ya da bağ): ${HEDEF}`);

// İşaret dosyası hedefin yanında; içinde hedefin gerçek yolu. Başka hedeften kopyalanmış işaret geçmez.
const ISARET = join(dirname(GERCEK_HEDEF), '.' + basename(GERCEK_HEDEF) + '.dist-hazirla');
function isaretGecerli() {
  try {
    const i = JSON.parse(readFileSync(ISARET, 'utf8'));
    return i && i.arac === ISARET_ARAC && i.hedef === GERCEK_HEDEF;
  } catch { return false; }
}
if (existsSync(HEDEF) && readdirSync(HEDEF).length && !isaretGecerli()) {
  dur(`hedef dolu ve dist-hazirla işaret dosyası yok (${ISARET}); betiğin kurmadığı klasör silinmez: ${HEDEF}`);
}

const eksik = ZORUNLU.filter((g) => !existsSync(join(KAYNAK, g)));
// Zorunlu lisanslar boş/iskelet olmamalı.
for (const g of ZORUNLU) {
  if (!LISANS_DESENI.test(basename(g)) || !existsSync(join(KAYNAK, g))) continue;
  const sorun = lisansSorunu(join(KAYNAK, g));
  if (sorun) eksik.push(`${g} (${sorun})`);
}
// Her vendor alt klasöründe geçerli bir lisans dosyası olmalı (yeni eklenen kütüphane lisanssız pakete girmesin).
const vendor = join(KAYNAK, 'vendor');
if (existsSync(vendor)) {
  for (const g of readdirSync(vendor, { withFileTypes: true })) {
    if (!g.isDirectory() || hariçMi('vendor/' + g.name, g.name, true)) continue;
    const lisanslar = readdirSync(join(vendor, g.name)).filter((a) => LISANS_DESENI.test(a));
    if (!lisanslar.length) eksik.push(`vendor/${g.name}/ (lisans dosyası yok)`);
    else if (lisanslar.every((a) => lisansSorunu(join(vendor, g.name, a)))) {
      eksik.push(`vendor/${g.name}/ (lisans dosyası boş ya da iskelet: ${lisanslar.join(', ')})`);
    }
  }
}
if (WEB) {
  for (const a of WEB_KOK) {
    const y = join(REPO, a);
    if (existsSync(join(KAYNAK, a))) eksik.push(`${a} (kaynakta da var; kökteki dosyayla çakışır)`);
    if (!existsSync(y) || !statSync(y).isFile()) { eksik.push(`${a} (repo kökünde yok)`); continue; }
    const sorun = lisansSorunu(y);
    if (sorun) eksik.push(`${a} (${sorun})`);
  }
  const bildirimYolu = join(REPO, 'THIRD_PARTY_NOTICES.md');
  if (existsSync(bildirimYolu)) {
    const bildirim = readFileSync(bildirimYolu, 'utf8').toLowerCase();
    const anilacak = existsSync(vendor)
      ? readdirSync(vendor, { withFileTypes: true }).filter((g) => g.isDirectory() && !g.name.startsWith('.')).map((g) => g.name)
      : [];
    if (existsSync(join(KAYNAK, 'js/ogren/LICENSE'))) anilacak.push('Colorfigures');
    for (const [paket, adlar] of Object.entries(GOMULU)) {
      if (existsSync(join(KAYNAK, paket))) anilacak.push(...adlar);
    }
    for (const ad of new Set(anilacak)) if (!bildirim.includes(ad.toLowerCase())) eksik.push(`THIRD_PARTY_NOTICES.md (${ad} anılmıyor)`);
  }
}
if (eksik.length) dur('eksik zorunlu dosya: ' + [...new Set(eksik)].join(', '));

rmSync(GERCEK_HEDEF, { recursive: true, force: true });
mkdirSync(GERCEK_HEDEF, { recursive: true });
writeFileSync(ISARET, JSON.stringify({ arac: ISARET_ARAC, hedef: GERCEK_HEDEF }) + '\n');
const kopyalanan = [];
const atlanan = [];
(function gez(d) {
  for (const g of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const tam = join(d, g.name);
    const goreli = relative(KAYNAK, tam).split(sep).join('/');
    if (hariçMi(goreli, g.name, g.isDirectory())) { atlanan.push(goreli + (g.isDirectory() ? '/' : '')); continue; }
    if (g.isDirectory()) { gez(tam); continue; }
    if (!g.isFile()) { atlanan.push(goreli + ' (dosya değil)'); continue; }
    const hedefYol = join(GERCEK_HEDEF, goreli);
    mkdirSync(dirname(hedefYol), { recursive: true });
    copyFileSync(tam, hedefYol);
    kopyalanan.push(goreli);
  }
})(KAYNAK);

if (WEB) {
  for (const a of WEB_KOK) {
    if (existsSync(join(GERCEK_HEDEF, a))) dur(`kaynakta da ${a} var; kökteki dosyayla çakışır`);
    copyFileSync(join(REPO, a), join(GERCEK_HEDEF, a));
    kopyalanan.push(a + ' (repo kökünden)');
  }
}

// Son denetim: hedefte hariç tutulan bir şey kalmadı, zorunlular geldi.
const sizan = kopyalanan.filter((g) => g === 'test' || g.startsWith('test/') || /\.ttf$/i.test(g) || g.split('/').some((p) => p.startsWith('.')));
if (sizan.length) dur('hariç tutulması gereken dosya kopyalandı: ' + sizan.join(', '));
const gelmeyen = [...ZORUNLU, ...(WEB ? WEB_KOK : [])].filter((g) => !existsSync(join(GERCEK_HEDEF, g)));
if (gelmeyen.length) dur('zorunlu dosya hedefe gelmedi: ' + gelmeyen.join(', '));

if (!SESSIZ) {
  for (const g of kopyalanan) console.log('  + ' + g);
  for (const g of atlanan) console.log('  - ' + g + ' (hariç)');
}
console.log(`dist-hazirla: ${kopyalanan.length} dosya → ${relative(process.cwd(), HEDEF) || HEDEF}; hariç ${atlanan.length}`);
