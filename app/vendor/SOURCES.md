# Third-party libraries (local copies)

The files are taken as they are (unchanged) from the npm tarballs (for Literata from a pinned commit on GitHub); the app
works without internet. The only exception: the `literata/literata-*.js` files are base64 forms of the TTFs and are
made with `tools/make-font-js.mjs` (Chrome does not allow reading a local file with fetch under `file://`; they are
loaded with `<script>`).

| Package | Version | License | Tarball |
|---|---|---|---|
| pdf-lib | 1.17.1 | MIT | https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz |
| pdfjs-dist | 3.11.174 | Apache-2.0 | https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-3.11.174.tgz |
| @pdf-lib/fontkit | 1.1.1 | MIT | https://registry.npmjs.org/@pdf-lib/fontkit/-/fontkit-1.1.1.tgz |
| Literata (typeface) | 3.103 | OFL-1.1 | GitHub googlefonts/literata, commit 0c2761b727a1b3a7cffd313c37f0f5163dfc7a63, `fonts/ttf/` and `OFL.txt`: https://raw.githubusercontent.com/googlefonts/literata/0c2761b727a1b3a7cffd313c37f0f5163dfc7a63/fonts/ttf/<name>.ttf |

## Files and sha256

| Local file | Path in the tarball | sha256 |
|---|---|---|
| pdf-lib/pdf-lib.min.js | package/dist/pdf-lib.min.js | 0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f |
| pdf-lib/LICENSE.md | package/LICENSE.md | f2c9fc00fdb66eb99ac156ba52d734af66d8d309f65753ae809ad34ee2883bcb |
| pdfjs/pdf.min.js | package/build/pdf.min.js | 5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946 |
| pdfjs/pdf.worker.min.js | package/build/pdf.worker.min.js | feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b |
| pdfjs/LICENSE | package/LICENSE | 0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594 |
| fontkit/fontkit.umd.min.js | package/dist/fontkit.umd.min.js | d8df561b9fba98e24f2e5130e40948809281bbbc55a20c412359f1a0a5eb35a6 |
| fontkit/LICENSE | (not in the tarball; the MIT text written by hand, see the note at the top of the file) | eb674aaf1f36a008d16a82d421159e7bc3853c875f03405af1a544df76779c05 |
| literata/Literata-Regular.ttf | fonts/ttf/Literata-Regular.ttf | 0390890de9bb9d5862a6ba4125b82c61792ccc3d66b63e73eee75c1a16fcd208 |
| literata/Literata-Italic.ttf | fonts/ttf/Literata-Italic.ttf | 198f70cc9a17bab578553fa274b81984d58c440efe26bc06f1d841c194b6691a |
| literata/Literata-Bold.ttf | fonts/ttf/Literata-Bold.ttf | b6af95b3b443cdbce964aa06741596987f2f5c3ede46a2bc846e5addd99d061f |
| literata/Literata-BoldItalic.ttf | fonts/ttf/Literata-BoldItalic.ttf | 1dade59381ad02f4679d7e993a7a406472e587ac332af7a6168d3ad9214a99dc |
| literata/OFL.txt | OFL.txt | 8742963604cd89dc81437811a850018fc03b2bfad686d7422c8235967c87614e |
| literata/literata-regular.js | (generated: `node tools/make-font-js.mjs`) | d87b77c3038f557391d6334c764c5efb30a2b40f548b4d3b6f041a17f448a329 |
| literata/literata-italic.js | (generated) | 8f9e01899d77f437c3740aeb46d0ac4152b4aabf265cf13de05fc2b954945f36 |
| literata/literata-bold.js | (generated) | d9b6f3e22cffb8ff505cf316bc954db3fcf3ccd074342c90bedbbdc68f6dc9af |
| literata/literata-bolditalic.js | (generated) | 46f22729a2dfaa99b5133d940737c350b2e57510b87b2bd6e38e76a939002e2f |

`app/vendor/fontkit/` and `app/vendor/literata/` are marked `-text` in `.gitattributes`, so that `core.autocrlf` on
Windows does not change the line endings and spoil the checksums.

## Update steps

1. Download and unpack the tarball of the new version: `curl -sSfL -o package.tgz <tarball URL> && tar xzf package.tgz` (in an empty folder).
2. Copy the files of the "Path in the tarball" column above to their places under `app/vendor/`.
   For Literata: download the 4 TTFs under `fonts/ttf/` and `OFL.txt` of the new commit; then build the font JS files
   again with `node tools/make-font-js.mjs` (the `--verify` flag checks that the JS files match the TTFs exactly).
3. Compute the new checksums with `sha256sum` and update the version, URL and checksums in this file.
4. Run `node tools/make-font-js.mjs --verify`, `node --test app/test/` and `node app/test/e2e.mjs`; when pdf.js was
   upgraded, review the `isEvalSupported: false` note in THIRD_PARTY_NOTICES.md.
