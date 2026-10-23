#!/usr/bin/env node
/*
 * i18n-html.mjs — app/index.html'deki data-dil / data-dil-oz öğelerinin statik metnini en sözlüğünden yazar
 * Amaç: i18n.js hiç çalışmasa (yüklenemedi, hata attı) da arayüz boş değil
 * İngilizce metinli görünsün. Çalışma anında i18n.js bu metni seçili dille hemen değiştirir.
 *
 * Kullanım (repo kökünden):
 *   node tools/i18n-html.mjs            index.html'i günceller; değişen öğe sayısını yazar
 *   node tools/i18n-html.mjs --denetle  yazmaz; fark varsa listeler, çıkış 1
 * Çıkış: 0 = güncel/yazıldı; 1 = fark var (--denetle) ya da yazılamayan öğe (iç içe öğe, sözlükte düz metin
 *   olmayan anahtar). Bağımsız denetim: app/test/startup.test.js (aynı kuralı kendi ayrıştırıcısıyla sınar).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = join(REPO, 'app', 'index.html');
const I18n = require(join(REPO, 'app', 'js', 'i18n.js'));
const EN = I18n.extractJson(readFileSync(join(REPO, 'app', 'i18n', 'en.js'), 'utf8'));

const metinKac = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (s) => metinKac(s).replace(/"/g, '&quot;');

/** HTML'i en sözlüğüyle günceller. { html, degisen, sorun[] } */
export function update(html, en) {
  const problem = [];
  let changed = 0;
  const OZ = '(?:[^>"\']|"[^"]*"|\'[^\']*\')*';
  // 1) data-dil: <etiket … data-dil="a" …>METİN</etiket>  (iç içe öğe yok)
  const total = (html.match(/\sdata-i18n="/g) || []).length;
  let found = 0;
  let h = html.replace(new RegExp(`(<([a-z][a-z0-9]*)\\b${OZ}\\sdata-i18n="([^"]+)"${OZ}>)([^<]*)(</\\2\\s*>)`, 'gi'), (tam, open, et, a, inner, close) => {
    found++;
    if (typeof en[a] !== 'string') { problem.push(`${a}: en sözlüğünde düz metin değil`); return tam; }
    const fresh = metinKac(en[a]);
    if (fresh !== inner) changed++;
    return open + fresh + close;
  });
  if (found !== total) problem.push(`${total - found} data-i18n öğesi yazılamadı (içinde başka öğe var ya da kapanışı yok)`);
  // 2) data-dil-oz: her "öznitelik:anahtar" için öznitelik değeri (yoksa eklenir)
  h = h.replace(new RegExp(`<[a-z][a-z0-9]*\\b${OZ}\\sdata-i18n-oz="([^"]+)"${OZ}>`, 'gi'), (label, list) => {
    let e = label;
    for (const double of list.split(';')) {
      const b = double.indexOf(':');
      if (b <= 0) continue;
      const name = double.slice(0, b).trim(), a = double.slice(b + 1).trim();
      if (typeof en[a] !== 'string') { problem.push(`${name}:${a}: en sözlüğünde düz metin değil`); continue; }
      const value = escapeAttribute(en[a]);
      const re = new RegExp(`\\s${name}="[^"]*"`);
      if (re.test(e)) {
        const once = e;
        e = e.replace(re, ` ${name}="${value}"`);
        if (e !== once) changed++;
      } else {
        e = e.replace(/\sdata-i18n-oz="/, ` ${name}="${value}" data-i18n-oz="`);
        changed++;
      }
    }
    return e;
  });
  return { html: h, changed, problem };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const verify = process.argv.includes('--verify');
  const old = readFileSync(HTML_PATH, 'utf8');
  const r = update(old, EN);
  if (r.problem.length) { console.error('i18n-html: ' + r.problem.join('\n  ')); process.exit(1); }
  if (verify) {
    if (r.html !== old) { console.error(`i18n-html: index.html güncel değil (${r.changed} öğe); node tools/i18n-html.mjs çalıştırın`); process.exit(1); }
    console.log('i18n-html: index.html güncel');
  } else {
    if (r.html !== old) writeFileSync(HTML_PATH, r.html);
    console.log(`i18n-html: ${r.changed} öğe güncellendi`);
  }
}
