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

const CRC_TABLE = (() => {
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
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bytes(data) {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(data);
}

/**
 * girdiler: [{ ad, veri, yontem = 8 (0 stored, 8 deflate, başka sayı: veri olduğu gibi yazılır),
 *              bayrak = 0x800 (UTF-8 ad), crcBoz = false,
 *              veriTanimlayici: true → bayrak bit 3; yerel başlıkta CRC/boyutlar 0, veriden sonra imzalı tanımlayıcı,
 *              bildirilenBoyut: sayı → merkezi dizin ve yerel başlıkta açılmış boyut bu yazılır (gerçeği değil) }]
 * secenek: { zip64Bulucu: true → EOCD'den önce ZIP64 bulucu imzası yazılır, yorum: EOCD sonuna ZIP yorumu (metin) }
 */
function makeZip(inputs, options) {
  const local = [];
  const center = [];
  let offset = 0;
  for (const g of inputs) {
    const name = Buffer.from(g.name, 'utf8');
    const raw = bytes(g.data);
    const method = g.method === undefined ? 8 : g.method;
    const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const identifier = !!g.dataIdentifier;
    const flag = (g.flag === undefined ? 0x800 : g.flag) | (identifier ? 0x8 : 0);
    let crc = crc32(raw);
    if (g.corruptCrc) crc = (crc ^ 1) >>> 0;
    const isOpen = g.reportedSize === undefined ? raw.length : g.reportedSize;
    const lb = Buffer.alloc(30);
    lb.writeUInt32LE(0x04034b50, 0); lb.writeUInt16LE(20, 4); lb.writeUInt16LE(flag, 6); lb.writeUInt16LE(method, 8);
    lb.writeUInt32LE(0, 10); lb.writeUInt32LE(identifier ? 0 : crc, 14); lb.writeUInt32LE(identifier ? 0 : data.length, 18); lb.writeUInt32LE(identifier ? 0 : isOpen, 22);
    lb.writeUInt16LE(name.length, 26); lb.writeUInt16LE(0, 28);
    local.push(lb, name, data);
    let dt = Buffer.alloc(0);
    if (identifier) {
      dt = Buffer.alloc(16);
      dt.writeUInt32LE(0x08074b50, 0); dt.writeUInt32LE(crc, 4); dt.writeUInt32LE(data.length, 8); dt.writeUInt32LE(isOpen, 12);
      local.push(dt);
    }
    const cb = Buffer.alloc(46);
    cb.writeUInt32LE(0x02014b50, 0); cb.writeUInt16LE(20, 4); cb.writeUInt16LE(20, 6); cb.writeUInt16LE(flag, 8);
    cb.writeUInt16LE(method, 10); cb.writeUInt32LE(0, 12); cb.writeUInt32LE(crc, 16); cb.writeUInt32LE(data.length, 20);
    cb.writeUInt32LE(isOpen, 24); cb.writeUInt16LE(name.length, 28); cb.writeUInt32LE(offset, 42);
    center.push(cb, name);
    offset += 30 + name.length + data.length + dt.length;
  }
  const cd = Buffer.concat(center);
  const parts = [...local, cd];
  if (options && options.zip64Locator) {
    const z = Buffer.alloc(20);
    z.writeUInt32LE(0x07064b50, 0);
    parts.push(z);
  }
  const comment = Buffer.from((options && options.comment) || '', 'utf8');
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(inputs.length, 8); e.writeUInt16LE(inputs.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16); e.writeUInt16LE(comment.length, 20);
  parts.push(e, comment);
  return Buffer.concat(parts);
}

// ---- küçük resimler ----
function makePng(w, h, color) {
  const [r, g, b] = color || [180, 60, 20];
  const line = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { line[1 + x * 3] = (r + x * 7) & 255; line[2 + x * 3] = g; line[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => line));
  const part = (kind, data) => {
    const u = Buffer.alloc(4); u.writeUInt32BE(data.length);
    const tv = Buffer.concat([Buffer.from(kind, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(tv));
    return Buffer.concat([u, tv, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), part('IHDR', ihdr), part('IDAT', zlib.deflateSync(raw)), part('IEND', Buffer.alloc(0))]);
}
// 1×1 GIF (createImageBitmap → PNG yolunu sınar)
const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAEALAAAAAABAAEAAAICTAEAOw==', 'base64');

// ---- metin üretimi (belirlenimci, Türkçe) ----
const WORDS = ('kitap sayfa cilt forma kağıt mürekkep dikiş sırt kapak yaprak kalem defter masa pencere ışık gölge ' +
  'akşam sabah güneş yağmur rüzgâr deniz dağ ağaç çiçek bahçe köprü sokak şehir köy ırmak göl orman yol ' +
  'öğretmen öğrenci çocuk ihtiyar kadın adam kardeş arkadaş komşu yolcu usta çırak terzi berber kâtip ' +
  'güzel uzun kısa eski yeni büyük küçük sessiz kalabalık ılık soğuk sıcak yorgun mutlu üzgün çalışkan ' +
  'okudu yazdı gördü düşündü anlattı bekledi yürüdü gülümsedi sordu söyledi taşıdı dinledi hatırladı ' +
  'İstanbul İzmir Iğdır Ankara Bursa Çanakkale Şanlıurfa Ödemiş Üsküdar Ağrı').split(' ');

function random(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function paragraphText(r, wordCount) {
  const l = [];
  let sentenceStart = true;
  for (let i = 0; i < wordCount; i++) {
    let k = WORDS[Math.floor(r() * WORDS.length)];
    if (sentenceStart) { k = k.charAt(0).toLocaleUpperCase('tr') + k.slice(1); sentenceStart = false; }
    const last = i === wordCount - 1 || r() < 0.08;
    if (last) { k += '.'; sentenceStart = true; } else if (r() < 0.06) k += ',';
    l.push(k);
  }
  return l.join(' ');
}

const NS = {
  xhtml: 'http://www.w3.org/1999/xhtml',
  ops: 'http://www.idpf.org/2007/ops',
  opf: 'http://www.idpf.org/2007/opf',
  dc: 'http://purl.org/dc/elements/1.1/',
  container: 'urn:oasis:names:tc:opendocument:xmlns:container',
  xlink: 'http://www.w3.org/1999/xlink',
  svg: 'http://www.w3.org/2000/svg',
  ncx: 'http://www.daisy.org/z3986/2005/ncx/',
  enc: 'http://www.w3.org/2001/04/xmlenc#',
  hiding: 'http://www.idpf.org/2008/embedding',
  aes: 'http://www.w3.org/2001/04/xmlenc#aes128-cbc'
};

function xhtml(body, s) {
  s = s || {};
  const css = (s.css || []).map((c) => `<link rel="stylesheet" type="text/css" href="${c}"/>`).join('');
  const style = s.style ? `<style type="text/css">${s.style}</style>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="${NS.xhtml}" xmlns:epub="${NS.ops}" xml:lang="${s.i18n || 'tr'}" lang="${s.i18n || 'tr'}">` +
    `<head><title>${s.title || 'Bölüm'}</title>${css}${style}</head><body>${body}</body></html>`;
}

const MEDIA = { xhtml: 'application/xhtml+xml', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', ncx: 'application/x-dtbncx+xml', otf: 'font/otf' };

/**
 * tanim: { surum = 3, baslik, yazar, dil = 'tr', bolumler: [{ ad, xhtml, linear = true, ozellik }],
 *          dosyalar: { 'ad': veri } (OEBPS altına), kapak: 'resim adı' (cover-image), fxl: bool,
 *          ncx: bool, sifreleme: xml metni, container = true, opfEkMeta: '', ekGirdiler: [{ad, veri}] }
 */
function epub(t) {
  const version = t.version || 3;
  const i18n = t.i18n || 'tr';
  const g = [{ name: 'mimetype', data: 'application/epub+zip', method: 0 }];
  if (t.container !== false) {
    g.push({ name: 'META-INF/container.xml', data: `<?xml version="1.0"?><container version="1.0" xmlns="${NS.container}"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` });
  }
  if (t.encryption) g.push({ name: 'META-INF/encryption.xml', data: t.encryption });
  const manifest = [];
  const spine = [];
  t.sections.forEach((b, i) => {
    const id = 'b' + i;
    manifest.push(`<item id="${id}" href="${b.name}" media-type="${MEDIA.xhtml}"${b.property ? ` properties="${b.property}"` : ''}/>`);
    spine.push(`<itemref idref="${id}"${b.linear === false ? ' linear="no"' : ''}${b.itemrefProperty ? ` properties="${b.itemrefProperty}"` : ''}/>`);
  });
  const files = t.files || {};
  Object.keys(files).forEach((name, i) => {
    const uz = name.split('.').pop();
    const cover = t.cover === name;
    manifest.push(`<item id="d${i}" href="${name}" media-type="${MEDIA[uz] || 'application/octet-stream'}"${cover && version >= 3 ? ' properties="cover-image"' : ''}/>`);
  });
  let coverMeta = '';
  if (t.cover && version < 3) {
    const i = Object.keys(files).indexOf(t.cover);
    coverMeta = `<meta name="cover" content="d${i}"/>`;
  }
  if (t.ncx) manifest.push(`<item id="ncx" href="toc.ncx" media-type="${MEDIA.ncx}"/>`);
  const fxl = t.fxl ? '<meta property="rendition:layout">pre-paginated</meta>' : '';
  const opf = `<?xml version="1.0" encoding="UTF-8"?><package xmlns="${NS.opf}" version="${version}.0" unique-identifier="kimlik"${version >= 3 ? ' prefix="rendition: http://www.idpf.org/vocab/rendition/#"' : ''}>` +
    `<metadata xmlns:dc="${NS.dc}"><dc:identifier id="kimlik">kitap-cilt-test</dc:identifier><dc:title>${t.title || 'Deneme'}</dc:title>` +
    `<dc:creator>${t.writes || 'Mücellit'}</dc:creator><dc:language>${i18n}</dc:language>${coverMeta}${fxl}${t.opfEkMeta || ''}</metadata>` +
    `<manifest>${manifest.join('')}</manifest><spine${t.ncx ? ' toc="ncx"' : ''}>${spine.join('')}</spine></package>`;
  g.push({ name: 'OEBPS/content.opf', data: opf });
  if (t.ncx) {
    g.push({ name: 'OEBPS/toc.ncx', data: `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="${NS.ncx}" version="2005-1"><head/><docTitle><text>${t.title || 'Deneme'}</text></docTitle><navMap>` +
      t.sections.map((b, i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${i + 1}</text></navLabel><content src="${b.name}"/></navPoint>`).join('') + '</navMap></ncx>' });
  }
  t.sections.forEach((b) => g.push({ name: 'OEBPS/' + b.name, data: b.xhtml }));
  Object.keys(files).forEach((name) => g.push({ name: 'OEBPS/' + name, data: files[name], method: /\.(png|jpg|gif)$/.test(name) ? 0 : 8 }));
  (t.ekInputs || []).forEach((e) => g.push(e));
  return makeZip(g);
}

// ---- hazır tanımlar ----
const B3_SENTENCE = "Iğdır'da ılık bir İstanbul sabahı; şöyle güzel çiçekler: ÖĞÜŞÇ ğüşıöçİ.";
const TR_CSS = '@import url("yok.css");\n.vurgu { font-style: italic }\n.koyu { font-weight: 700 }\n.ortala { text-align: center }\n' +
  '.gizli { display: none }\n@media print { p { display: none } }\nh1 + p, .ilk { text-indent: 0 }\n.yeni-sayfa { page-break-before: always }\n';

function trMiniDefinition() {
  const r = random(42);
  const p = (n) => `<p>${paragraphText(r, n)}</p>`;
  const b1 = xhtml(
    '<h1>Birinci Bölüm</h1>' +
    `<p class="ilk">Bu kitapta <span class="vurgu">eğik yazılmış</span> ve <strong>kalın yazılmış</strong> sözcükler var; <span class="koyu">sınıfla kalın</span> da var.</p>` +
    `<p>Iğdır'da ılık bir İstanbul sabahı;<br/>şöyle güzel çiçekler: ÖĞÜŞÇ ğüşıöçİ.</p>` +
    '<p class="gizli">GIZLIMETIN bu paragraf görünmemeli.</p>' +
    p(120) + p(90) + '<hr/>' + p(140) +
    `<blockquote><p>${paragraphText(r, 40)}</p></blockquote>` +
    '<ul><li>birinci madde</li><li>ikinci madde</li></ul><ol><li>sıralı bir</li><li>sıralı iki</li></ol>' +
    '<p><img src="resim/kucuk.png" alt="küçük resim"/></p>' +
    '<p><img src="resim/cizim.svg" alt="vektör çizim"/></p>' +
    '<p><img src="resim/nokta.gif" alt="gif"/></p>' +
    '<table><tr><td>hücre bir</td><td>hücre iki</td></tr><tr><td>alt bir</td><td>alt iki</td></tr></table>' +
    p(160) + p(110),
    { css: ['style.css'], title: 'Birinci' });
  const b2 = xhtml('<h2 class="ortala">İkinci Bölüm</h2>' + p(150) + p(130) + p(170) + `<p class="yeni-sayfa">YENISAYFA ${paragraphText(r, 30)}</p>` + p(80),
    { css: ['style.css'], title: 'İkinci' });
  const b3 = xhtml('<h2>Üçüncü Bölüm</h2>' + `<p>Dipnot işareti<a epub:type="noteref" href="#n1">1</a> burada.</p>` + p(200) +
    `<aside epub:type="footnote" id="n1"><p>1. Dipnot metni.</p></aside>` + `<p style="font-style: italic; text-align: right">SATIRICI eğik ve sağa yaslı.</p>`,
    { css: ['style.css'], title: 'Üçüncü' });
  const coverX = xhtml('<div><img src="resim/kapak.png" alt="kapak"/></div>', { title: 'Kapak' });
  return {
    title: 'Deneme Kitabı', writes: 'Mücellit', i18n: 'tr', cover: 'resim/kapak.png',
    sections: [{ name: 'kapak.xhtml', xhtml: coverX }, { name: 'b1.xhtml', xhtml: b1 }, { name: 'b2.xhtml', xhtml: b2 }, { name: 'b3.xhtml', xhtml: b3 }],
    files: {
      'style.css': TR_CSS,
      'resim/kapak.png': makePng(60, 90, [20, 60, 140]),
      'resim/kucuk.png': makePng(40, 30),
      'resim/cizim.svg': `<svg xmlns="${NS.svg}" width="10" height="10"><rect width="10" height="10"/></svg>`,
      'resim/nokta.gif': GIF_1X1
    }
  };
}

const ready = {
  trMini: () => epub(trMiniDefinition()),
  enMini: () => {
    // EPUB 2 + NCX; XHTML'de DTD'siz &nbsp; → application/xhtml+xml ayrıştırması parsererror verir
    const b = '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="' + NS.xhtml + '" xml:lang="en"><head><title>One</title></head><body>' +
      '<h1>Chapter One</h1><p>Hello&nbsp;world, this is an English paragraph with a non&#8209;breaking hyphen and an em&mdash;dash.</p>' +
      '<p>The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.</p></body></html>';
    return epub({ version: 2, ncx: true, i18n: 'en', title: 'English Mini', sections: [{ name: 'one.xhtml', xhtml: b }] });
  },
  drm: () => {
    const t = trMiniDefinition();
    t.encryption = `<?xml version="1.0"?><encryption xmlns="${NS.container}" xmlns:enc="${NS.enc}"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${NS.aes}"/>` +
      '<enc:CipherData><enc:CipherReference URI="OEBPS/b1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>';
    return epub(t);
  },
  fontHidden: () => {
    const t = trMiniDefinition();
    t.files['font/gizli.otf'] = Buffer.from('gizlenmis-font-baytlari-gecersiz');
    t.encryption = `<?xml version="1.0"?><encryption xmlns="${NS.container}" xmlns:enc="${NS.enc}"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${NS.hiding}"/>` +
      '<enc:CipherData><enc:CipherReference URI="OEBPS/font/gizli.otf"/></enc:CipherData></enc:EncryptedData></encryption>';
    return epub(t);
  },
  fxl: () => { const t = trMiniDefinition(); t.fxl = true; return epub(t); },
  noContainer: () => { const t = trMiniDefinition(); t.container = false; return epub(t); },
  corrupt: () => { const r = random(7); return Buffer.from(Array.from({ length: 4096 }, () => Math.floor(r() * 256))); },
  long: (word) => {
    // ~90 000 kelime: 30 bölüm × 25 paragraf × 120 kelime
    const target = word || 90000;
    const r = random(2026);
    const countChapter = 30, parSay = 25, parWord = Math.round(target / countChapter / parSay);
    const sections = [];
    for (let i = 0; i < countChapter; i++) {
      let body = `<h1>Bölüm ${i + 1}</h1>`;
      for (let j = 0; j < parSay; j++) body += `<p>${paragraphText(r, parWord)}</p>`;
      sections.push({ name: `b${i + 1}.xhtml`, xhtml: xhtml(body, { title: 'Bölüm ' + (i + 1) }) });
    }
    return epub({ title: 'Uzun Kitap', sections });
  }
};

module.exports = { makeZip, epub, xhtml, makePng, crc32, ready, B3_SENTENCE, NS, trMiniDefinition, paragraphText, random };
