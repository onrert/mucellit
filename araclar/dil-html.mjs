#!/usr/bin/env node
/*
 * dil-html.mjs — app/index.html'deki data-dil / data-dil-oz öğelerinin statik metnini en sözlüğünden yazar
 * Amaç: dil.js hiç çalışmasa (yüklenemedi, hata attı) da arayüz boş değil
 * İngilizce metinli görünsün. Çalışma anında dil.js bu metni seçili dille hemen değiştirir.
 *
 * Kullanım (repo kökünden):
 *   node araclar/dil-html.mjs            index.html'i günceller; değişen öğe sayısını yazar
 *   node araclar/dil-html.mjs --denetle  yazmaz; fark varsa listeler, çıkış 1
 * Çıkış: 0 = güncel/yazıldı; 1 = fark var (--denetle) ya da yazılamayan öğe (iç içe öğe, sözlükte düz metin
 *   olmayan anahtar). Bağımsız denetim: app/test/acilis.test.js (aynı kuralı kendi ayrıştırıcısıyla sınar).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_YOLU = join(REPO, 'app', 'index.html');
const Dil = require(join(REPO, 'app', 'js', 'dil.js'));
const EN = Dil.jsonAyikla(readFileSync(join(REPO, 'app', 'dil', 'en.js'), 'utf8'));

const metinKac = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const oznitelikKac = (s) => metinKac(s).replace(/"/g, '&quot;');

/** HTML'i en sözlüğüyle günceller. { html, degisen, sorun[] } */
export function guncelle(html, en) {
  const sorun = [];
  let degisen = 0;
  const OZ = '(?:[^>"\']|"[^"]*"|\'[^\']*\')*';
  // 1) data-dil: <etiket … data-dil="a" …>METİN</etiket>  (iç içe öğe yok)
  const toplam = (html.match(/\sdata-dil="/g) || []).length;
  let bulunan = 0;
  let h = html.replace(new RegExp(`(<([a-z][a-z0-9]*)\\b${OZ}\\sdata-dil="([^"]+)"${OZ}>)([^<]*)(</\\2\\s*>)`, 'gi'), (tam, ac, et, a, ic, kapa) => {
    bulunan++;
    if (typeof en[a] !== 'string') { sorun.push(`${a}: en sözlüğünde düz metin değil`); return tam; }
    const yeni = metinKac(en[a]);
    if (yeni !== ic) degisen++;
    return ac + yeni + kapa;
  });
  if (bulunan !== toplam) sorun.push(`${toplam - bulunan} data-dil öğesi yazılamadı (içinde başka öğe var ya da kapanışı yok)`);
  // 2) data-dil-oz: her "öznitelik:anahtar" için öznitelik değeri (yoksa eklenir)
  h = h.replace(new RegExp(`<[a-z][a-z0-9]*\\b${OZ}\\sdata-dil-oz="([^"]+)"${OZ}>`, 'gi'), (etiket, liste) => {
    let e = etiket;
    for (const cift of liste.split(';')) {
      const b = cift.indexOf(':');
      if (b <= 0) continue;
      const ad = cift.slice(0, b).trim(), a = cift.slice(b + 1).trim();
      if (typeof en[a] !== 'string') { sorun.push(`${ad}:${a}: en sözlüğünde düz metin değil`); continue; }
      const deger = oznitelikKac(en[a]);
      const re = new RegExp(`\\s${ad}="[^"]*"`);
      if (re.test(e)) {
        const once = e;
        e = e.replace(re, ` ${ad}="${deger}"`);
        if (e !== once) degisen++;
      } else {
        e = e.replace(/\sdata-dil-oz="/, ` ${ad}="${deger}" data-dil-oz="`);
        degisen++;
      }
    }
    return e;
  });
  return { html: h, degisen, sorun };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const denetle = process.argv.includes('--denetle');
  const eski = readFileSync(HTML_YOLU, 'utf8');
  const r = guncelle(eski, EN);
  if (r.sorun.length) { console.error('dil-html: ' + r.sorun.join('\n  ')); process.exit(1); }
  if (denetle) {
    if (r.html !== eski) { console.error(`dil-html: index.html güncel değil (${r.degisen} öğe); node araclar/dil-html.mjs çalıştırın`); process.exit(1); }
    console.log('dil-html: index.html güncel');
  } else {
    if (r.html !== eski) writeFileSync(HTML_YOLU, r.html);
    console.log(`dil-html: ${r.degisen} öğe güncellendi`);
  }
}
