/*
 * epub-build.cjs — YALNIZ TEST: tanım nesnesinden ZIP / EPUB baytı üretir.
 *
 * Birim testler (require) ve e2e.mjs (createRequire) kullanır; fixture'lar test sırasında
 * üretilir, repoya ikili EPUB girmez, lisans sorunu yoktur (metinler burada yazılmış).
 *
 * Uzantı .cjs: dosya CommonJS'tir ve uygulama kodu değildir. XML ad alanı tanımlayıcıları
 * (xmlns değerleri) içerir; A paketinin "app altında http(s) adresi yok" denetimi yalnız
 * tarayıcıda çalışan *.js / *.html dosyalarına bakar.
 *
 *   const U = require('./epub-build.cjs');
 *   U.zipUret([{ ad, veri, yontem?, bayrak? }]) → Buffer
 *   U.epub(tanim) → Buffer
 *   U.hazir.trMini() / enMini() / drm() / fontGizli() / fxl() / containerYok() / bozuk() / uzun()
 *   U.B3_CUMLE: trMini'de birebir geçen Türkçe cümle
 */
'use strict';
const zlib = require('node:zlib');

const CRC_TABLO = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLO[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bayt(veri) {
  if (typeof veri === 'string') return Buffer.from(veri, 'utf8');
  return Buffer.from(veri);
}

/**
 * girdiler: [{ ad, veri, yontem = 8 (0 stored, 8 deflate, başka sayı: veri olduğu gibi yazılır),
 *              bayrak = 0x800 (UTF-8 ad), crcBoz = false,
 *              veriTanimlayici: true → bayrak bit 3; yerel başlıkta CRC/boyutlar 0, veriden sonra imzalı tanımlayıcı,
 *              bildirilenBoyut: sayı → merkezi dizin ve yerel başlıkta açılmış boyut bu yazılır (gerçeği değil) }]
 * secenek: { zip64Bulucu: true → EOCD'den önce ZIP64 bulucu imzası yazılır, yorum: EOCD sonuna ZIP yorumu (metin) }
 */
function zipUret(girdiler, secenek) {
  const yerel = [];
  const merkez = [];
  let ofset = 0;
  for (const g of girdiler) {
    const ad = Buffer.from(g.ad, 'utf8');
    const ham = bayt(g.veri);
    const yontem = g.yontem === undefined ? 8 : g.yontem;
    const veri = yontem === 8 ? zlib.deflateRawSync(ham) : ham;
    const tanimlayici = !!g.veriTanimlayici;
    const bayrak = (g.bayrak === undefined ? 0x800 : g.bayrak) | (tanimlayici ? 0x8 : 0);
    let crc = crc32(ham);
    if (g.crcBoz) crc = (crc ^ 1) >>> 0;
    const acik = g.bildirilenBoyut === undefined ? ham.length : g.bildirilenBoyut;
    const lb = Buffer.alloc(30);
    lb.writeUInt32LE(0x04034b50, 0); lb.writeUInt16LE(20, 4); lb.writeUInt16LE(bayrak, 6); lb.writeUInt16LE(yontem, 8);
    lb.writeUInt32LE(0, 10); lb.writeUInt32LE(tanimlayici ? 0 : crc, 14); lb.writeUInt32LE(tanimlayici ? 0 : veri.length, 18); lb.writeUInt32LE(tanimlayici ? 0 : acik, 22);
    lb.writeUInt16LE(ad.length, 26); lb.writeUInt16LE(0, 28);
    yerel.push(lb, ad, veri);
    let dt = Buffer.alloc(0);
    if (tanimlayici) {
      dt = Buffer.alloc(16);
      dt.writeUInt32LE(0x08074b50, 0); dt.writeUInt32LE(crc, 4); dt.writeUInt32LE(veri.length, 8); dt.writeUInt32LE(acik, 12);
      yerel.push(dt);
    }
    const cb = Buffer.alloc(46);
    cb.writeUInt32LE(0x02014b50, 0); cb.writeUInt16LE(20, 4); cb.writeUInt16LE(20, 6); cb.writeUInt16LE(bayrak, 8);
    cb.writeUInt16LE(yontem, 10); cb.writeUInt32LE(0, 12); cb.writeUInt32LE(crc, 16); cb.writeUInt32LE(veri.length, 20);
    cb.writeUInt32LE(acik, 24); cb.writeUInt16LE(ad.length, 28); cb.writeUInt32LE(ofset, 42);
    merkez.push(cb, ad);
    ofset += 30 + ad.length + veri.length + dt.length;
  }
  const cd = Buffer.concat(merkez);
  const parcalar = [...yerel, cd];
  if (secenek && secenek.zip64Bulucu) {
    const z = Buffer.alloc(20);
    z.writeUInt32LE(0x07064b50, 0);
    parcalar.push(z);
  }
  const yorum = Buffer.from((secenek && secenek.yorum) || '', 'utf8');
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(girdiler.length, 8); e.writeUInt16LE(girdiler.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(ofset, 16); e.writeUInt16LE(yorum.length, 20);
  parcalar.push(e, yorum);
  return Buffer.concat(parcalar);
}

// ---- küçük resimler ----
function pngUret(w, h, renk) {
  const [r, g, b] = renk || [180, 60, 20];
  const satir = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { satir[1 + x * 3] = (r + x * 7) & 255; satir[2 + x * 3] = g; satir[3 + x * 3] = b; }
  const ham = Buffer.concat(Array.from({ length: h }, () => satir));
  const parca = (tur, veri) => {
    const u = Buffer.alloc(4); u.writeUInt32BE(veri.length);
    const tv = Buffer.concat([Buffer.from(tur, 'latin1'), veri]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(tv));
    return Buffer.concat([u, tv, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), parca('IHDR', ihdr), parca('IDAT', zlib.deflateSync(ham)), parca('IEND', Buffer.alloc(0))]);
}
// 1×1 GIF (createImageBitmap → PNG yolunu sınar)
const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAEALAAAAAABAAEAAAICTAEAOw==', 'base64');

// ---- metin üretimi (belirlenimci, Türkçe) ----
const KELIMELER = ('kitap sayfa cilt forma kağıt mürekkep dikiş sırt kapak yaprak kalem defter masa pencere ışık gölge ' +
  'akşam sabah güneş yağmur rüzgâr deniz dağ ağaç çiçek bahçe köprü sokak şehir köy ırmak göl orman yol ' +
  'öğretmen öğrenci çocuk ihtiyar kadın adam kardeş arkadaş komşu yolcu usta çırak terzi berber kâtip ' +
  'güzel uzun kısa eski yeni büyük küçük sessiz kalabalık ılık soğuk sıcak yorgun mutlu üzgün çalışkan ' +
  'okudu yazdı gördü düşündü anlattı bekledi yürüdü gülümsedi sordu söyledi taşıdı dinledi hatırladı ' +
  'İstanbul İzmir Iğdır Ankara Bursa Çanakkale Şanlıurfa Ödemiş Üsküdar Ağrı').split(' ');

function rastgele(tohum) {
  let s = tohum >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function paragrafMetni(r, kelimeSayisi) {
  const l = [];
  let cumleBasi = true;
  for (let i = 0; i < kelimeSayisi; i++) {
    let k = KELIMELER[Math.floor(r() * KELIMELER.length)];
    if (cumleBasi) { k = k.charAt(0).toLocaleUpperCase('tr') + k.slice(1); cumleBasi = false; }
    const son = i === kelimeSayisi - 1 || r() < 0.08;
    if (son) { k += '.'; cumleBasi = true; } else if (r() < 0.06) k += ',';
    l.push(k);
  }
  return l.join(' ');
}

const NS = {
  xhtml: 'http://www.w3.org/1999/xhtml',
  ops: 'http://www.idpf.org/2007/ops',
  opf: 'http://www.idpf.org/2007/opf',
  dc: 'http://purl.org/dc/elements/1.1/',
  kap: 'urn:oasis:names:tc:opendocument:xmlns:container',
  xlink: 'http://www.w3.org/1999/xlink',
  svg: 'http://www.w3.org/2000/svg',
  ncx: 'http://www.daisy.org/z3986/2005/ncx/',
  enc: 'http://www.w3.org/2001/04/xmlenc#',
  gizleme: 'http://www.idpf.org/2008/embedding',
  aes: 'http://www.w3.org/2001/04/xmlenc#aes128-cbc'
};

function xhtml(govde, s) {
  s = s || {};
  const css = (s.css || []).map((c) => `<link rel="stylesheet" type="text/css" href="${c}"/>`).join('');
  const stil = s.stil ? `<style type="text/css">${s.stil}</style>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="${NS.xhtml}" xmlns:epub="${NS.ops}" xml:lang="${s.dil || 'tr'}" lang="${s.dil || 'tr'}">` +
    `<head><title>${s.baslik || 'Bölüm'}</title>${css}${stil}</head><body>${govde}</body></html>`;
}

const MEDYA = { xhtml: 'application/xhtml+xml', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', ncx: 'application/x-dtbncx+xml', otf: 'font/otf' };

/**
 * tanim: { surum = 3, baslik, yazar, dil = 'tr', bolumler: [{ ad, xhtml, linear = true, ozellik }],
 *          dosyalar: { 'ad': veri } (OEBPS altına), kapak: 'resim adı' (cover-image), fxl: bool,
 *          ncx: bool, sifreleme: xml metni, container = true, opfEkMeta: '', ekGirdiler: [{ad, veri}] }
 */
function epub(t) {
  const surum = t.surum || 3;
  const dil = t.dil || 'tr';
  const g = [{ ad: 'mimetype', veri: 'application/epub+zip', yontem: 0 }];
  if (t.container !== false) {
    g.push({ ad: 'META-INF/container.xml', veri: `<?xml version="1.0"?><container version="1.0" xmlns="${NS.kap}"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` });
  }
  if (t.sifreleme) g.push({ ad: 'META-INF/encryption.xml', veri: t.sifreleme });
  const manifest = [];
  const spine = [];
  t.bolumler.forEach((b, i) => {
    const id = 'b' + i;
    manifest.push(`<item id="${id}" href="${b.ad}" media-type="${MEDYA.xhtml}"${b.ozellik ? ` properties="${b.ozellik}"` : ''}/>`);
    spine.push(`<itemref idref="${id}"${b.linear === false ? ' linear="no"' : ''}${b.itemrefOzellik ? ` properties="${b.itemrefOzellik}"` : ''}/>`);
  });
  const dosyalar = t.dosyalar || {};
  Object.keys(dosyalar).forEach((ad, i) => {
    const uz = ad.split('.').pop();
    const kapak = t.kapak === ad;
    manifest.push(`<item id="d${i}" href="${ad}" media-type="${MEDYA[uz] || 'application/octet-stream'}"${kapak && surum >= 3 ? ' properties="cover-image"' : ''}/>`);
  });
  let kapakMeta = '';
  if (t.kapak && surum < 3) {
    const i = Object.keys(dosyalar).indexOf(t.kapak);
    kapakMeta = `<meta name="cover" content="d${i}"/>`;
  }
  if (t.ncx) manifest.push(`<item id="ncx" href="toc.ncx" media-type="${MEDYA.ncx}"/>`);
  const fxl = t.fxl ? '<meta property="rendition:layout">pre-paginated</meta>' : '';
  const opf = `<?xml version="1.0" encoding="UTF-8"?><package xmlns="${NS.opf}" version="${surum}.0" unique-identifier="kimlik"${surum >= 3 ? ' prefix="rendition: http://www.idpf.org/vocab/rendition/#"' : ''}>` +
    `<metadata xmlns:dc="${NS.dc}"><dc:identifier id="kimlik">kitap-cilt-test</dc:identifier><dc:title>${t.baslik || 'Deneme'}</dc:title>` +
    `<dc:creator>${t.yazar || 'Mücellit'}</dc:creator><dc:language>${dil}</dc:language>${kapakMeta}${fxl}${t.opfEkMeta || ''}</metadata>` +
    `<manifest>${manifest.join('')}</manifest><spine${t.ncx ? ' toc="ncx"' : ''}>${spine.join('')}</spine></package>`;
  g.push({ ad: 'OEBPS/content.opf', veri: opf });
  if (t.ncx) {
    g.push({ ad: 'OEBPS/toc.ncx', veri: `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="${NS.ncx}" version="2005-1"><head/><docTitle><text>${t.baslik || 'Deneme'}</text></docTitle><navMap>` +
      t.bolumler.map((b, i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${i + 1}</text></navLabel><content src="${b.ad}"/></navPoint>`).join('') + '</navMap></ncx>' });
  }
  t.bolumler.forEach((b) => g.push({ ad: 'OEBPS/' + b.ad, veri: b.xhtml }));
  Object.keys(dosyalar).forEach((ad) => g.push({ ad: 'OEBPS/' + ad, veri: dosyalar[ad], yontem: /\.(png|jpg|gif)$/.test(ad) ? 0 : 8 }));
  (t.ekGirdiler || []).forEach((e) => g.push(e));
  return zipUret(g);
}

// ---- hazır tanımlar ----
const B3_CUMLE = "Iğdır'da ılık bir İstanbul sabahı; şöyle güzel çiçekler: ÖĞÜŞÇ ğüşıöçİ.";
const TR_CSS = '@import url("yok.css");\n.vurgu { font-style: italic }\n.koyu { font-weight: 700 }\n.ortala { text-align: center }\n' +
  '.gizli { display: none }\n@media print { p { display: none } }\nh1 + p, .ilk { text-indent: 0 }\n.yeni-sayfa { page-break-before: always }\n';

function trMiniTanim() {
  const r = rastgele(42);
  const p = (n) => `<p>${paragrafMetni(r, n)}</p>`;
  const b1 = xhtml(
    '<h1>Birinci Bölüm</h1>' +
    `<p class="ilk">Bu kitapta <span class="vurgu">eğik yazılmış</span> ve <strong>kalın yazılmış</strong> sözcükler var; <span class="koyu">sınıfla kalın</span> da var.</p>` +
    `<p>Iğdır'da ılık bir İstanbul sabahı;<br/>şöyle güzel çiçekler: ÖĞÜŞÇ ğüşıöçİ.</p>` +
    '<p class="gizli">GIZLIMETIN bu paragraf görünmemeli.</p>' +
    p(120) + p(90) + '<hr/>' + p(140) +
    `<blockquote><p>${paragrafMetni(r, 40)}</p></blockquote>` +
    '<ul><li>birinci madde</li><li>ikinci madde</li></ul><ol><li>sıralı bir</li><li>sıralı iki</li></ol>' +
    '<p><img src="resim/kucuk.png" alt="küçük resim"/></p>' +
    '<p><img src="resim/cizim.svg" alt="vektör çizim"/></p>' +
    '<p><img src="resim/nokta.gif" alt="gif"/></p>' +
    '<table><tr><td>hücre bir</td><td>hücre iki</td></tr><tr><td>alt bir</td><td>alt iki</td></tr></table>' +
    p(160) + p(110),
    { css: ['style.css'], baslik: 'Birinci' });
  const b2 = xhtml('<h2 class="ortala">İkinci Bölüm</h2>' + p(150) + p(130) + p(170) + `<p class="yeni-sayfa">YENISAYFA ${paragrafMetni(r, 30)}</p>` + p(80),
    { css: ['style.css'], baslik: 'İkinci' });
  const b3 = xhtml('<h2>Üçüncü Bölüm</h2>' + `<p>Dipnot işareti<a epub:type="noteref" href="#n1">1</a> burada.</p>` + p(200) +
    `<aside epub:type="footnote" id="n1"><p>1. Dipnot metni.</p></aside>` + `<p style="font-style: italic; text-align: right">SATIRICI eğik ve sağa yaslı.</p>`,
    { css: ['style.css'], baslik: 'Üçüncü' });
  const kapakX = xhtml('<div><img src="resim/kapak.png" alt="kapak"/></div>', { baslik: 'Kapak' });
  return {
    baslik: 'Deneme Kitabı', yazar: 'Mücellit', dil: 'tr', kapak: 'resim/kapak.png',
    bolumler: [{ ad: 'kapak.xhtml', xhtml: kapakX }, { ad: 'b1.xhtml', xhtml: b1 }, { ad: 'b2.xhtml', xhtml: b2 }, { ad: 'b3.xhtml', xhtml: b3 }],
    dosyalar: {
      'style.css': TR_CSS,
      'resim/kapak.png': pngUret(60, 90, [20, 60, 140]),
      'resim/kucuk.png': pngUret(40, 30),
      'resim/cizim.svg': `<svg xmlns="${NS.svg}" width="10" height="10"><rect width="10" height="10"/></svg>`,
      'resim/nokta.gif': GIF_1X1
    }
  };
}

const hazir = {
  trMini: () => epub(trMiniTanim()),
  enMini: () => {
    // EPUB 2 + NCX; XHTML'de DTD'siz &nbsp; → application/xhtml+xml ayrıştırması parsererror verir
    const b = '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="' + NS.xhtml + '" xml:lang="en"><head><title>One</title></head><body>' +
      '<h1>Chapter One</h1><p>Hello&nbsp;world, this is an English paragraph with a non&#8209;breaking hyphen and an em&mdash;dash.</p>' +
      '<p>The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.</p></body></html>';
    return epub({ surum: 2, ncx: true, dil: 'en', baslik: 'English Mini', bolumler: [{ ad: 'one.xhtml', xhtml: b }] });
  },
  drm: () => {
    const t = trMiniTanim();
    t.sifreleme = `<?xml version="1.0"?><encryption xmlns="${NS.kap}" xmlns:enc="${NS.enc}"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${NS.aes}"/>` +
      '<enc:CipherData><enc:CipherReference URI="OEBPS/b1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>';
    return epub(t);
  },
  fontGizli: () => {
    const t = trMiniTanim();
    t.dosyalar['font/gizli.otf'] = Buffer.from('gizlenmis-font-baytlari-gecersiz');
    t.sifreleme = `<?xml version="1.0"?><encryption xmlns="${NS.kap}" xmlns:enc="${NS.enc}"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${NS.gizleme}"/>` +
      '<enc:CipherData><enc:CipherReference URI="OEBPS/font/gizli.otf"/></enc:CipherData></enc:EncryptedData></encryption>';
    return epub(t);
  },
  fxl: () => { const t = trMiniTanim(); t.fxl = true; return epub(t); },
  containerYok: () => { const t = trMiniTanim(); t.container = false; return epub(t); },
  bozuk: () => { const r = rastgele(7); return Buffer.from(Array.from({ length: 4096 }, () => Math.floor(r() * 256))); },
  uzun: (kelime) => {
    // ~90 000 kelime: 30 bölüm × 25 paragraf × 120 kelime
    const hedef = kelime || 90000;
    const r = rastgele(2026);
    const bolumSay = 30, parSay = 25, parKelime = Math.round(hedef / bolumSay / parSay);
    const bolumler = [];
    for (let i = 0; i < bolumSay; i++) {
      let govde = `<h1>Bölüm ${i + 1}</h1>`;
      for (let j = 0; j < parSay; j++) govde += `<p>${paragrafMetni(r, parKelime)}</p>`;
      bolumler.push({ ad: `b${i + 1}.xhtml`, xhtml: xhtml(govde, { baslik: 'Bölüm ' + (i + 1) }) });
    }
    return epub({ baslik: 'Uzun Kitap', bolumler });
  }
};

module.exports = { zipUret, epub, xhtml, pngUret, crc32, hazir, B3_CUMLE, NS, trMiniTanim, paragrafMetni, rastgele };
