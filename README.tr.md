[English](README.md) | Türkçe

# Mücellit

PDF ya da EPUB dosyanı evde basıp katlayabileceğin, dikip ciltleyebileceğin bir kitaba dönüştür. Ücretsiz, tarayıcıda
çalışır.

### [Mücellit'i aç →](https://onrert.github.io/mucellit/)

![Kâğıt önizlemesi: her kâğıdın iki yüzüne hangi sayfalar gelir](docs/preview.png)

Mücellit, ciltçi demek.

## Neler yapar

- **Sayfaları baskıya dizer:** kâğıtları katlayınca sayfalar doğru sırada çıkar.
- **Kapak ölçülerini hesaplar:** mukavva, kaplama, sırt ve forza; sayfa sayısına ve kâğıda göre.
- **Her kitabın sürecini takip eder:** adım adım, tarih ve notlarla.
- **Ciltlemeyi öğretir:** basılı kâğıttan bitmiş sert kapaklı kitaba kadar resimli, adım adım bir rehber.
- **Türkçe ve İngilizce.**

## Nasıl kullanılır

1. Siteyi aç, PDF ya da EPUB dosyanı seç.
2. Hazırlanan PDF'i indir; çift taraflı ve **gerçek boyutta (%100)** bas.
3. Kâğıtları katla, sırasıyla üst üste koy.
4. **Öğren** sekmesini aç, adımları izleyerek kitabını dik ve ciltle.

İpucu: bütün kitabı basmadan önce yalnız ilk formayı basıp yazıcı ayarını dene.

## Gizlilik

Dosyaların bilgisayarından çıkmaz: hesap yok, hiçbir şey yüklenmez, ücretsiz.

## Geliştiriciler için

- **Yerelde çalıştırma:** `app/index.html`'i Chrome ya da Edge'de aç ya da `node tools/prepare-dist.mjs --web` ve
  `python3 -m http.server --directory dist 8000` çalıştırıp http://localhost:8000/ adresine git. Derleme adımı yok,
  internet gerekmez.
- **Testler:** `node --test app/test/` (Node.js 24+). Uçtan uca testler Playwright kullanır: `node app/test/e2e.mjs` ve
  `node app/test/web-subpath.mjs` (Safari motoru için `--engine=webkit` ekle; `MC_PLAYWRIGHT` ile
  `node_modules/playwright` klasörünü göster). `node app/test/turkish-scan.js` kod tabanında kalan Türkçeyi listeler
  (birim testleri aynı denetimi yapar).
- **Kod:** `app/` altında düz HTML, CSS ve JavaScript; kütüphaneler ve yazı tipleri `app/vendor/` altında; arayüz
  metinleri `app/i18n/` altında (`en.js`, `tr.js`); geliştirici araçları `tools/` altında. Kod, yorumlar ve test adları
  İngilizce; Türkçe yalnız `tr.js` sözlüğünde, Türkçe heceleme verisinde, Türkçe test verisinde ve bu dosyada.
- **Yayın:** `main`'e her push testleri çalıştırır ve siteyi GitHub Pages ile yayınlar (`.github/workflows/pages.yml`).
- **Masaüstü (deneysel):** `src-tauri/` aynı uygulamayı Tauri 2 ile bir macOS penceresine sarar (`cargo tauri dev`).
  Dağıtılmaz; desteklenen sürüm web sürümüdür.
- **Eski sürümlerin verisi:** İngilizce kod tabanından önceki sürümlerin tarayıcıda kaydettiği süreç verisi ve ayarlar
  açılışta bir kez taşınır (`app/js/migrate.js`). Masaüstü sürümü deneyseldir: paket kimliği değiştiği için
  (`com.onurmert.kitapcilt` → `com.onurmert.mucellit`) eski masaüstü sürümlerinin verisi yeni sürümde görünmez.
- **Tarayıcılar:** güncel Chrome ya da Edge önerilir; Safari de sınanır; Firefox sınanmaz.
- **Kapak hesabı:** değerler yaygın atölye uygulamasıdır; ilk kitabında ölçüp ayarla. Kaynaklar README.md'de.

## Lisans

MIT ([LICENSE](LICENSE)), © 2026 Onur Mert Ertuğrul. Üçüncü taraf bileşenler:
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Öğren rehberinin çizimleri Colorfigures ile yapıldı (MIT, © 2026
April Zhu ve Tolga Cohce; tam metin `app/js/learn/LICENSE`).
