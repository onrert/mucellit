'use strict';
/*
 * i18n-scan.js — small string extractors for the "no fixed Turkish string left in the interface" scan.
 * Not a `.test.js`; i18n.test.js uses it. It is tested with faulty/hard input in i18n.test.js.
 *
 *   jsStrings(source)    → [{ text, line }]  '…' "…" `…` (the text outside ${} of a template separately, the inside
 *                          scanned again); comments and regular expression literals are skipped.
 *   rustStrings(source)  → [{ text, line, log }]  "…", r"…", r#"…"#, b"…", char literals; comments are skipped;
 *                          nothing after the test module (#[cfg(test)] mod …) is scanned. log: the literal is inside
 *                          eprintln!, println!, panic!, the assert family or expect(…) (it does not reach the user).
 *   htmlTexts(source)    → [{ text, line }]  text nodes + visible attributes (title, aria-label, placeholder, alt);
 *                          <script>, <style> and comments are skipped.
 */

// turkish-data: begin (Turkish letters, words and suffixes the UI scan looks for)
const TURKISH_LETTER = /[çğıöşüÇĞİÖŞÜ]/;
// A helper heuristic for Turkish sentences without Turkish letters (folded to ASCII); only in a literal that contains
// a space (a single word may be an identifier in the source: 'sewn', 'projects'). Two signals (26 words in the past):
//   1. common Turkish words (ASCII form). Words that clash with English are left out on purpose: once, her, su, sure, sec, o, mi.
//   2. common Turkish suffixes at the end of a word: -amadı/-emedi, -ıyor/-uyor, -ları/-leri, -siniz, -ilsin, -ildi, -ecek …
// False alarm test: i18n.test.js checks that no text of the en dictionary and no technical string counts as Turkish.
const WORDS = ['ve', 'bir', 'ile', 'icin', 'veya', 'ya da', 'gibi', 'kadar', 'daha', 'cok', 'hic', 'tum', 'tumu', 'butun', 'lutfen', 'tekrar',
  'yeniden', 'simdi', 'sonra', 'yok', 'degil', 'gerekli', 'olmali', 'sayfa', 'sayfaya', 'sayfalar', 'sayfasi', 'kitap', 'kitaba', 'kitabi',
  'kitaplar', 'forma', 'formalar', 'yaprak', 'dosya', 'dosyasi', 'dosyalar', 'hata', 'hatasi', 'uyari', 'bos', 'secin', 'secili', 'yukle',
  'yuklendi', 'kaydet', 'kaydedildi', 'alinir', 'kagit', 'kalinlik', 'genislik', 'yukseklik', 'olcu', 'olcusu', 'olculer', 'ayar', 'ayarlar',
  'ayari', 'sirt', 'mukavva', 'cilt', 'kapak', 'adim', 'adimlar', 'baski', 'onizleme', 'cikti', 'iptal', 'tamam', 'vazgec', 'silindi',
  'kaldir', 'islem', 'deger', 'gecersiz', 'bulunamadi'];
const TURKISH_WORD = new RegExp('(^|[\\s(])(' + WORDS.join('|') + ')(?=$|[\\s.,;:)!?])', 'i');
// turkish-data: end
// The suffix only in a word that starts at a word start (a CSS class '.surukleniyor', '#kimlik', 'a-b' identifiers do not count).  // turkish-ok: the UI scan's own patterns (Turkish words in examples)
const TURKISH_SUFFIX = /(?<![A-Za-z0-9_.#$@-])[a-z]{2,}(?:amadi|emedi|amiyor|emiyor|amaz|emez|iyor|uyor|lari|leri|larin|lerin|siniz|sunuz|iniz|unuz|ilsin|insin|ulsun|unsun|ildi|uldu|ilir|ulur|ecek|acak|landi|lendi)(?=$|[^a-z0-9_-])/i;  // turkish-ok: the UI scan's own patterns (Turkish words in examples)

function countLine(s, head, last) {
  let n = 0;
  for (let i = head; i < last; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

const REGEX_BEFORE_KEY = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

function jsStrings(source, lineHead = 1) {
  const s = String(source);
  const n = s.length;
  const output = [];
  let i = 0, line = lineHead, last = 'bas';
  const readString = (quote) => {
    const head = i, headLine = line;
    i++;
    let text = '';
    while (i < n && s[i] !== quote) {
      if (s[i] === '\\') { text += s[i + 1] === undefined ? '' : s[i + 1]; if (s[i + 1] === '\n') line++; i += 2; continue; }
      if (s[i] === '\n') break; // unclosed string: end at the end of the line
      text += s[i];
      i++;
    }
    i++;
    void head;
    output.push({ text, line: headLine });
  };
  while (i < n) {
    const c = s[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i + 2);
      const bit = e < 0 ? n : e + 2;
      line += countLine(s, i, bit);
      i = bit;
      continue;
    }
    if (c === "'" || c === '"') { readString(c); last = 'value'; continue; }
    if (c === '`') {
      const headLine = line;
      i++;
      let text = '';
      while (i < n && s[i] !== '`') {
        if (s[i] === '\\') { text += s[i + 1] || ''; i += 2; continue; }
        if (s[i] === '$' && s[i + 1] === '{') {
          // ${ expression }: the matching } (nested { } and strings skipped); the expression is scanned again
          let depth = 1, j = i + 2;
          while (j < n && depth > 0) {
            const d = s[j];
            if (d === '{') depth++;
            else if (d === '}') depth--;
            else if (d === "'" || d === '"' || d === '`') {
              const t = d; j++;
              while (j < n && s[j] !== t) { if (s[j] === '\\') j++; j++; }
            }
            j++;
          }
          const expression = s.slice(i + 2, j - 1);
          output.push(...jsStrings(expression, line));
          line += countLine(s, i, j);
          text += ' ';
          i = j;
          continue;
        }
        if (s[i] === '\n') line++;
        text += s[i];
        i++;
      }
      i++;
      output.push({ text, line: headLine });
      last = 'value';
      continue;
    }
    if (c === '/') {
      if (last !== 'value' && last !== 'name' && last !== 'close') {
        // regular expression literal: escapes and the inside of [ … ] are skipped
        i++;
        let cls = false;
        while (i < n && s[i] !== '\n') {
          if (s[i] === '\\') { i += 2; continue; }
          if (s[i] === '[') cls = true;
          else if (s[i] === ']') cls = false;
          else if (s[i] === '/' && !cls) break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/i.test(s[i])) i++;
        last = 'value';
        continue;
      }
      i++; last = 'operator'; continue;
    }
    if (/[A-Za-z_$\u0080-￿]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$\u0080-￿]/.test(s[j])) j++;
      const name = s.slice(i, j);
      last = REGEX_BEFORE_KEY.has(name) ? 'operator' : 'name';
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) { while (i < n && /[0-9a-fA-FxXoObBn._]/.test(s[i])) i++; last = 'value'; continue; }
    last = (c === ')' || c === ']' || c === '}') ? 'close' : 'operator';
    i++;
  }
  return output;
}

const LOG = new Set(['eprintln!', 'println!', 'eprint!', 'print!', 'panic!', 'unreachable!', 'todo!', 'assert!',
  'assert_eq!', 'assert_ne!', 'debug_assert!', 'debug_assert_eq!', 'expect', 'expect_err']);
const TEST_MODULE = /#\[cfg\(test\)\]\s*(pub(\([a-z]+\))?\s+)?mod\s/;

function rustStrings(source) {
  let s = String(source);
  const m = TEST_MODULE.exec(s);
  if (m) s = s.slice(0, m.index);
  const n = s.length;
  const output = [];
  const stack = []; // the owner of the open parentheses (the name before)
  let i = 0, line = 1, sonAd = '';
  const isLog = () => stack.some((a) => LOG.has(a));
  while (i < n) {
    const c = s[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') {
      let depth = 1, j = i + 2;
      while (j < n && depth > 0) {
        if (s[j] === '/' && s[j + 1] === '*') { depth++; j += 2; continue; }
        if (s[j] === '*' && s[j + 1] === '/') { depth--; j += 2; continue; }
        j++;
      }
      line += countLine(s, i, j); i = j; continue;
    }
    // raw string r"…", r#"…"#, br"…"
    const raw = /^b?r(#*)"/.exec(s.slice(i, i + 12));
    if (raw && !/[A-Za-z0-9_]/.test(s[i - 1] || '')) {
      const exit = '"' + raw[1];
      const head = i + raw[0].length;
      const e = s.indexOf(exit, head);
      const bit = e < 0 ? n : e;
      output.push({ text: s.slice(head, bit), line, log: isLog() });
      line += countLine(s, i, bit);
      i = bit + exit.length; sonAd = ''; continue;
    }
    if (c === '"' || (c === 'b' && s[i + 1] === '"' && !/[A-Za-z0-9_]/.test(s[i - 1] || ''))) {
      if (c === 'b') i++;
      const headLine = line;
      i++;
      let text = '';
      while (i < n && s[i] !== '"') {
        if (s[i] === '\\') { text += s[i + 1] || ''; if (s[i + 1] === '\n') line++; i += 2; continue; }
        if (s[i] === '\n') line++;
        text += s[i]; i++;
      }
      i++;
      output.push({ text, line: headLine, log: isLog() });
      sonAd = ''; continue;
    }
    if (c === "'") {
      // char literal ('x', '\n', '\u{..}') or lifetime ('a)
      if (s[i + 1] === '\\') {
        const e = s.indexOf("'", i + 2);
        output.push({ text: s.slice(i + 1, e), line, log: isLog() });
        i = e + 1; continue;
      }
      const code = s.codePointAt(i + 1);
      const uz = code > 0xffff ? 2 : 1;
      if (s[i + 1 + uz] === "'") { output.push({ text: s.slice(i + 1, i + 1 + uz), line, log: isLog() }); i += 2 + uz; continue; }
      i++; continue; // lifetime
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(s[j])) j++;
      sonAd = s.slice(i, j) + (s[j] === '!' ? '!' : '');
      i = s[j] === '!' ? j + 1 : j;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { stack.push(sonAd); sonAd = ''; i++; continue; }
    if (c === ')' || c === ']' || c === '}') { stack.pop(); sonAd = ''; i++; continue; }
    if (!/\s/.test(c)) sonAd = c === '.' || c === ':' ? sonAd : '';
    i++;
  }
  return output;
}

const VISIBLE_ATTRIBUTE = /\s(title|aria-label|placeholder|alt)\s*=\s*"([^"]*)"/g;

function htmlTexts(source) {
  const s = String(source);
  const output = [];
  // comment, script, style: replaced by spaces of the same length (line numbers kept)
  const remove = (t) => t.replace(/[^\n]/g, ' ');
  const clean = s.replace(/<!--[\s\S]*?-->/g, remove).replace(/<script\b[\s\S]*?<\/script>/gi, remove).replace(/<style\b[\s\S]*?<\/style>/gi, remove);
  const findLine = (k) => 1 + countLine(clean, 0, k);
  const label = /<[^>]*>/g;
  let m, previous = 0;
  while ((m = label.exec(clean)) !== null) {
    const text = clean.slice(previous, m.index);
    if (text.trim()) output.push({ text: text.trim(), line: findLine(previous) });
    let o;
    VISIBLE_ATTRIBUTE.lastIndex = 0;
    while ((o = VISIBLE_ATTRIBUTE.exec(m[0])) !== null) output.push({ text: o[2], line: findLine(m.index), attribute: o[1] });
    previous = m.index + m[0].length;
  }
  const rest = clean.slice(previous);
  if (rest.trim()) output.push({ text: rest.trim(), line: findLine(previous) });
  return output;
}

/** Does the text look Turkish? (A Turkish letter, or a common Turkish word / suffix in a literal with a space.) */
function isTurkish(text) {
  // the app name (working name) is not translated; in capitals on the book cover drawing of Learn (en: "MUCELLIT", tr: "MÜCELLİT").
  // only the full name (word bounded); Turkish words like "Mücellitler", "Mücellitin" are not exempt.
  const m = String(text).replace(/\b(?:Mücellit|MUCELLIT)\b/g, '');  // turkish-ok: the UI scan's own patterns (Turkish words in examples)
  if (TURKISH_LETTER.test(m)) return true;
  // A machine code prefix (NOTFOUND:, INVALID: …; a Rust → JS error prefix, turned into text by language in JS) is not
  // a word. Only an UPPER CASE prefix that ends with ":" is dropped; a Turkish sentence all in capitals ("DOSYA  // turkish-ok: the UI scan's own patterns (Turkish words in examples)
  // ACILAMADI") is scanned now (every word in capitals was dropped in the past).  // turkish-ok: the UI scan's own patterns (Turkish words in examples)
  const s = m.replace(/(^|[^A-Za-z0-9_])[A-Z][A-Z0-9_]{2,}:(?=\s|$)/g, '$1');
  return /\s/.test(s.trim()) && (TURKISH_WORD.test(s) || TURKISH_SUFFIX.test(s));
}

module.exports = { jsStrings, rustStrings, htmlTexts, isTurkish, TURKISH_LETTER };
