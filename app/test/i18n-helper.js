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

const KLASOR = path.join(__dirname, '..', 'i18n');
const SOZLUK_DOSYALARI = fs.readdirSync(KLASOR).filter((a) => /^[a-z]{2,3}\.js$/.test(a)).sort();

function dilKur(ctx, kod = 'tr') {
  for (const ad of SOZLUK_DOSYALARI) vm.runInContext(fs.readFileSync(path.join(KLASOR, ad), 'utf8'), ctx, { filename: 'i18n/' + ad });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'i18n.js'), 'utf8'), ctx, { filename: 'i18n.js' });
  ctx.KitapCilt.dil.ayarla(kod);
  return ctx.KitapCilt.dil;
}

module.exports = { dilKur, SOZLUK_DOSYALARI, KLASOR };
