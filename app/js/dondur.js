/*
 * dondur.js — Object.prototype'ı dondurur (prototip kirletmeye karşı).
 * Tauri'nin `freezePrototype: true` ayarı bunu sayfa betiklerinden ÖNCE yapar; pdf-lib 1.17.1 (ES5 derlemesi)
 * yüklenirken `X.prototype.toString = …` atamasında hata verip yarım kalır (PDFLib.PDFDocument tanımsız).
 * Bu yüzden dondurma burada, vendor kütüphaneleri yüklendikten hemen sonra ve uygulama betiklerinden önce
 * yapılır (index.html sırası; app/test/tauri-guvenlik.test.js denetler). Tarayıcıda ve Tauri'de aynı.
 */
Object.freeze(Object.prototype);
