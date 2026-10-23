/*
 * freeze.js — freezes Object.prototype (against prototype pollution).
 * Tauri's `freezePrototype: true` setting does this BEFORE the page scripts; pdf-lib 1.17.1 (an ES5 build) then fails
 * on its `X.prototype.toString = …` assignment while loading and stays half set up (PDFLib.PDFDocument undefined).
 * So the freeze happens here, right after the vendor libraries are loaded and before the app scripts (index.html order;
 * checked by app/test/tauri-security.test.js). The same in the browser and in Tauri.
 */
Object.freeze(Object.prototype);
