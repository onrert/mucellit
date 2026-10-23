/*
 * `node --test app/test/` runs this folder as one module (Node 22 resolves the folder argument to index.js). This file
 * loads every *.test.js unit test file of the folder (readdirSync, alphabetical); a new test file needs no registration.
 * e2e.mjs is NOT loaded here (it is not a .test.js); it runs on its own:
 *   node app/test/e2e.mjs
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

fs.readdirSync(__dirname)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .forEach((name) => require(path.join(__dirname, name)));
