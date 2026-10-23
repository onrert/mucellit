'use strict';
/*
 * i18n-helper.js — testler için arayüz dili. `.test.js` değildir (index.js yüklemez).
 *   dilKur(ctx, kod)  vm bağlamına sözlükleri ve i18n.js'i yükler (tarayıcıdaki sırayla), dili ayarlar.
 *   SOZLUK_DOSYALARI  app/i18n/*.js adları (alfabetik).
 * Mevcut testler Türkçe metni doğrular: öntanımlı kod 'tr'.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FOLDER = path.join(__dirname, '..', 'i18n');
const DICTIONARY_FILES = fs.readdirSync(FOLDER).filter((a) => /^[a-z]{2,3}\.js$/.test(a)).sort();

function setupI18n(ctx, code = 'tr') {
  for (const name of DICTIONARY_FILES) vm.runInContext(fs.readFileSync(path.join(FOLDER, name), 'utf8'), ctx, { filename: 'i18n/' + name });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'i18n.js'), 'utf8'), ctx, { filename: 'i18n.js' });
  ctx.Mucellit.i18n.set(code);
  return ctx.Mucellit.i18n;
}

module.exports = { setupI18n, DICTIONARY_FILES, FOLDER };
