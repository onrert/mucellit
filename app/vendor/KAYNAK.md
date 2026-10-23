# Üçüncü taraf kütüphaneler (yerel kopya)

Dosyalar npm tarball'ından (Literata için GitHub'daki sabit commit'ten) olduğu gibi (değiştirilmeden) alınmıştır; uygulama internetsiz çalışır.
Tek istisna: `literata/literata-*.js` dosyaları TTF'lerin base64 halidir ve `araclar/yazitipi-js-uret.mjs` ile üretilir
(Chrome `file://` altında yerel dosyayı fetch ile okumaya izin vermez; `<script>` ile yüklenir).

| Paket | Sürüm | Lisans | Tarball |
|---|---|---|---|
| pdf-lib | 1.17.1 | MIT | https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz |
| pdfjs-dist | 3.11.174 | Apache-2.0 | https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-3.11.174.tgz |
| @pdf-lib/fontkit | 1.1.1 | MIT | https://registry.npmjs.org/@pdf-lib/fontkit/-/fontkit-1.1.1.tgz |
| Literata (yazı tipi) | 3.103 | OFL-1.1 | GitHub googlefonts/literata, commit 0c2761b727a1b3a7cffd313c37f0f5163dfc7a63, `fonts/ttf/` ve `OFL.txt`: https://raw.githubusercontent.com/googlefonts/literata/0c2761b727a1b3a7cffd313c37f0f5163dfc7a63/fonts/ttf/<ad>.ttf |

## Dosyalar ve sha256

| Yerel dosya | Tarball içindeki yol | sha256 |
|---|---|---|
| pdf-lib/pdf-lib.min.js | package/dist/pdf-lib.min.js | 0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f |
| pdf-lib/LICENSE.md | package/LICENSE.md | f2c9fc00fdb66eb99ac156ba52d734af66d8d309f65753ae809ad34ee2883bcb |
| pdfjs/pdf.min.js | package/build/pdf.min.js | 5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946 |
| pdfjs/pdf.worker.min.js | package/build/pdf.worker.min.js | feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b |
| pdfjs/LICENSE | package/LICENSE | 0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594 |
| fontkit/fontkit.umd.min.js | package/dist/fontkit.umd.min.js | d8df561b9fba98e24f2e5130e40948809281bbbc55a20c412359f1a0a5eb35a6 |
| fontkit/LICENSE | (tarball'da yok; MIT metni elle, dosyanın başındaki nota bakın) | 71f7278b1dd776325c801fbcd4ee096fe43889d27e42347a1aff0d1add3faa4d |
| literata/Literata-Regular.ttf | fonts/ttf/Literata-Regular.ttf | 0390890de9bb9d5862a6ba4125b82c61792ccc3d66b63e73eee75c1a16fcd208 |
| literata/Literata-Italic.ttf | fonts/ttf/Literata-Italic.ttf | 198f70cc9a17bab578553fa274b81984d58c440efe26bc06f1d841c194b6691a |
| literata/Literata-Bold.ttf | fonts/ttf/Literata-Bold.ttf | b6af95b3b443cdbce964aa06741596987f2f5c3ede46a2bc846e5addd99d061f |
| literata/Literata-BoldItalic.ttf | fonts/ttf/Literata-BoldItalic.ttf | 1dade59381ad02f4679d7e993a7a406472e587ac332af7a6168d3ad9214a99dc |
| literata/OFL.txt | OFL.txt | 8742963604cd89dc81437811a850018fc03b2bfad686d7422c8235967c87614e |
| literata/literata-regular.js | (üretilir: `node araclar/yazitipi-js-uret.mjs`) | 51a7dd0be0372ccb81876321a85007138334935ca07843c5cc33361c163f0014 |
| literata/literata-italic.js | (üretilir) | c4327ced89017bfe8be11228b9960fa8753420550e1ff02639511d46c91d05d7 |
| literata/literata-bold.js | (üretilir) | 3aaad55a0182205e57c35603188510f52311299c197ccf54a7d557b3ea03fe57 |
| literata/literata-bolditalic.js | (üretilir) | 71de88991a1d2811236ce8b88286b317fa0f42be7e0596a0c7fa69cc164a425f |

`app/vendor/fontkit/` ve `app/vendor/literata/` `.gitattributes`'ta `-text` işaretlidir: Windows'ta `core.autocrlf` satır sonlarını
değiştirip özetleri bozmasın diye.

## Güncelleme adımları

1. Yeni sürümün tarball'ını indir ve aç: `curl -sSfL -o paket.tgz <tarball URL'si> && tar xzf paket.tgz` (boş bir klasörde).
2. Yukarıdaki tablodaki "Tarball içindeki yol" dosyalarını `app/vendor/` altındaki yerlerine kopyala.
   Literata için: yeni commit'in `fonts/ttf/` altındaki 4 TTF'yi ve `OFL.txt`'yi indir; sonra font JS'lerini
   `node araclar/yazitipi-js-uret.mjs` ile yeniden üret (`--denetle` bayrağı JS'lerin TTF'lerle birebir olduğunu sınar).
3. `sha256sum` ile yeni özetleri hesaplayıp bu dosyadaki sürüm, URL ve özetleri güncelle.
4. `node araclar/yazitipi-js-uret.mjs --denetle`, `node --test app/test/` ve `node app/test/e2e.mjs` çalıştır; pdf.js yükseltildiyse README'deki `isEvalSupported: false` notunu gözden geçir.
