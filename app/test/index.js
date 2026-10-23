/*
 * `node --test app/test/` bu dizini tek bir modül olarak
 * çalıştırır (Node 22 dizin argümanını index.js'e çözer). Bu dosya dizindeki
 * bütün *.test.js birim test dosyalarını (readdirSync ile, alfabetik) yükler;
 * yeni test dosyası eklemek için ayrıca kayıt gerekmez.
 * e2e.mjs burada YÜKLENMEZ (.test.js değil); ayrı çalıştırılır:
 *   node app/test/e2e.mjs
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

fs.readdirSync(__dirname)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .forEach((name) => require(path.join(__dirname, name)));
