#!/usr/bin/env node
/*
 * i18n-html.mjs — writes the static text of the data-i18n / data-i18n-attr elements in app/index.html from the en dictionary.
 * Goal: even when i18n.js does not run at all (could not load, threw) the interface is not empty and shows English
 * text. At run time i18n.js replaces this text with the chosen language at once.
 *
 * Usage (from the repository root):
 *   node tools/i18n-html.mjs            updates index.html; prints the number of changed elements
 *   node tools/i18n-html.mjs --verify   writes nothing; lists the differences, exit 1 when there are any
 * Exit: 0 = up to date/written; 1 = a difference (--verify) or an element that cannot be written (a nested element, a
 *   key that is not plain text in the dictionary). Independent check: app/test/startup.test.js (tests the same rule
 *   with its own parser).
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

const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (s) => escapeText(s).replace(/"/g, '&quot;');

/** Updates the HTML with the en dictionary. { html, changed, problem[] } */
export function update(html, en) {
  const problem = [];
  let changed = 0;
  const ATTRS = '(?:[^>"\']|"[^"]*"|\'[^\']*\')*';
  // 1) data-i18n: <tag … data-i18n="a" …>TEXT</tag>  (no nested element)
  const total = (html.match(/\sdata-i18n="/g) || []).length;
  let found = 0;
  let h = html.replace(new RegExp(`(<([a-z][a-z0-9]*)\\b${ATTRS}\\sdata-i18n="([^"]+)"${ATTRS}>)([^<]*)(</\\2\\s*>)`, 'gi'), (whole, open, tag, a, inner, close) => {
    found++;
    if (typeof en[a] !== 'string') { problem.push(`${a}: not plain text in the en dictionary`); return whole; }
    const fresh = escapeText(en[a]);
    if (fresh !== inner) changed++;
    return open + fresh + close;
  });
  if (found !== total) problem.push(`${total - found} data-i18n elements could not be written (another element inside or no closing tag)`);
  // 2) data-i18n-attr: the attribute value for every "attribute:key" (added when missing)
  h = h.replace(new RegExp(`<[a-z][a-z0-9]*\\b${ATTRS}\\sdata-i18n-attr="([^"]+)"${ATTRS}>`, 'gi'), (label, list) => {
    let e = label;
    for (const pair of list.split(';')) {
      const b = pair.indexOf(':');
      if (b <= 0) continue;
      const name = pair.slice(0, b).trim(), a = pair.slice(b + 1).trim();
      if (typeof en[a] !== 'string') { problem.push(`${name}:${a}: not plain text in the en dictionary`); continue; }
      const value = escapeAttribute(en[a]);
      const re = new RegExp(`\\s${name}="[^"]*"`);
      if (re.test(e)) {
        const once = e;
        e = e.replace(re, ` ${name}="${value}"`);
        if (e !== once) changed++;
      } else {
        e = e.replace(/\sdata-i18n-attr="/, ` ${name}="${value}" data-i18n-attr="`);
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
    if (r.html !== old) { console.error(`i18n-html: index.html is not up to date (${r.changed} elements); run node tools/i18n-html.mjs`); process.exit(1); }
    console.log('i18n-html: index.html up to date');
  } else {
    if (r.html !== old) writeFileSync(HTML_PATH, r.html);
    console.log(`i18n-html: ${r.changed} elements updated`);
  }
}
