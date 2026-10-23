'use strict';
/*
 * i18n-helper.js — interface language for the tests. Not a `.test.js` (index.js does not load it).
 *   setupI18n(ctx, code)  loads the dictionaries and i18n.js into a vm context (in the browser's order), sets the language.
 *   DICTIONARY_FILES      names of app/i18n/*.js (alphabetical).
 * The tests check the Turkish texts: the default code is 'tr'.
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
