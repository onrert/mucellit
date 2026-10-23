English | [Türkçe](README.tr.md)

# Mücellit

Turn any PDF or EPUB into a book you can print, fold, sew and bind at home — free, in your browser.

### [Open Mücellit →](https://onrert.github.io/mucellit/)

![Sheet preview: which pages land on each side of every sheet](docs/preview.png)

Mücellit is an old Turkish word for bookbinder.

## What it does

- **Arranges your pages for printing** so they come out in the right order when you fold the sheets into booklets.
- **Works out the cover sizes**: boards, cloth or paper, spine and endpapers, from your page count and paper.
- **Keeps track of each book** you are binding, step by step, with dates and notes.
- **Teaches you how to bind** with an illustrated, step-by-step guide, from printed sheets to a finished hardcover.
- **Speaks English and Turkish.**

## How to use

1. Open the site and choose your PDF or EPUB file.
2. Download the prepared PDF and print it double-sided at **actual size (100%)**.
3. Fold the sheets and stack them in order.
4. Open the **Learn** tab and follow the steps to sew and bind your book.

Tip: print just the first booklet before the whole book, to check your printer settings.

## Privacy

Your files never leave your computer: there is no account, nothing is uploaded, and it is free.

## For developers

- **Run locally:** open `app/index.html` in Chrome or Edge, or run `node tools/prepare-dist.mjs --web` and
  `python3 -m http.server --directory dist 8000`, then visit http://localhost:8000/. No build step, no internet needed.
- **Tests:** `node --test app/test/` (Node.js 24+). End-to-end tests use Playwright: `node app/test/e2e.mjs` and
  `node app/test/web-subpath.mjs` (add `--engine=webkit` for Safari's engine; set `MC_PLAYWRIGHT` to your
  `node_modules/playwright`). `node app/test/turkish-scan.js` lists any Turkish left in the code base (the unit tests
  run the same check).
- **Code:** plain HTML, CSS and JavaScript in `app/`; libraries and fonts are bundled in `app/vendor/`; interface
  texts are in `app/i18n/` (`en.js`, `tr.js`); developer tools are in `tools/`.
- **Publishing:** every push to `main` runs the tests and deploys the site with GitHub Pages
  (`.github/workflows/pages.yml`).
- **Desktop (experimental):** `src-tauri/` wraps the same app in a macOS window with Tauri 2 (`cargo tauri dev`).
  It is not distributed; the web version is the supported one.
- **Data of earlier versions:** projects, settings and the Mac app's files saved by versions before the English code
  base are migrated once on start-up (`app/js/migrate.js`, `src-tauri/src/legacy.rs`).
- **Browsers:** current Chrome or Edge recommended; Safari is tested too; Firefox is not tested.
- **Cover calculator:** values follow common workshop practice, so measure and adjust on your first book. Sources:
  [print-assistant.de](https://print-assistant.de/tools/prepress/abmasse-deckenueberzug-berechnen/),
  [mediencommunity.de](https://mediencommunity.de/system/files/05.09%20Deckenmachen.pdf),
  [LIS Academy](https://lis.academy/preservation-conservation-of-library-material/cutting-attaching-boards-gluing-book-binding/),
  [University of Brighton](https://blogs.brighton.ac.uk/viscommtech/bookarts/worksheets-for-bookbinders/hard-cover-for-multi-section/),
  [AIC/BPG Conservation Wiki](https://www.conservation-wiki.com/wiki/BPG_Case_Binding),
  [Indiana University Libraries](https://libpres.sitehost.iu.edu/manual/treatments/qj/qj.html),
  [J. Hewit & Sons](https://www.hewit.com/skin_deep/?article=2&volume=15),
  [PrintNinja](https://printninja.com/spine-width-calculator/).

## License

[MIT License](LICENSE) © 2026 Onur Mert Ertuğrul. Third-party libraries and fonts keep their own licenses: see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The Learn guide's drawings are made with Colorfigures (MIT License,
© 2026 April Zhu and Tolga Cohce; full text in `app/js/learn/LICENSE`).
