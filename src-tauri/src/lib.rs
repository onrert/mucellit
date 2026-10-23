//! Mücellit Mac uygulaması (Tauri 2). Web arayüzü `dist/` (app/'ten `tools/prepare-dist.mjs` ile).
//! pencere, dialog eklentisi (yerel onay pencereleri), yerel menü.
//! yerel Aç/Kaydet (`dosya`), klasör paketi EPUB (`epub_klasor`), son açılanlar + yer imi
//! (`son_acilanlar`), Süreç verisi otomatik yedeği (`veri`), Dock/Finder'dan açma (`RunEvent::Opened`).
//! yazdırma (`yazdir`: PDFKit baskı işlemi %100 ölçek; Önizleme'de Aç).
//!
//! Güvenlik: ana pencere `tauri.conf.json`'daki ayarla (`create: false`) burada kurulur;
//! uygulama dışı adrese gezinme ve yeni pencere (window.open, target=_blank) reddedilir. CSP conf'ta.

pub mod i18n;
pub mod files;
pub mod epub_folder;
mod menu;
pub mod recent;
pub mod backup;
pub mod print;

use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{Runtime, Url};

/// Ana pencerenin etiketi (`tauri.conf.json` ve `capabilities/default.json` ile aynı).
const ANA_PENCERE: &str = "main";

/// Web görünümü bu adrese gidebilir mi? Yalnız uygulamanın kendi içeriği: macOS'ta `tauri://localhost`,
/// Windows/Android biçimi `http(s)://tauri.localhost`; bunların kökenli `blob:` adresleri (sayfanın kendi
/// ürettiği indirme). Kullanıcı adı/parola/bağlantı noktası taşıyan ya da başka her adres reddedilir.
pub fn gezinme_izinli(url: &Url) -> bool {
    let kimliksiz = url.username().is_empty() && url.password().is_none() && url.port().is_none();
    match url.scheme() {
        "tauri" => kimliksiz && url.host_str() == Some("localhost"),
        "http" | "https" => kimliksiz && url.host_str() == Some("tauri.localhost"),
        // blob:<köken>/<kimlik> — köken de uygulamanın kendisi olmalı (iç içe blob: yok).
        "blob" => Url::parse(url.path())
            .map(|ic| ic.scheme() != "blob" && gezinme_izinli(&ic))
            .unwrap_or(false),
        _ => false,
    }
}

/// `on_navigation`'a verilen karar işlevinin kendisi (testler bunu doğrudan çağırır; kapanış içine
/// gömülü mantık sınanamıyordu: sınaması, `true || gezinme_izinli(url)` mutantı yakalanmadı).
/// Reddedilen adres stderr'e yazılır.
pub fn gezinme_karari(url: &Url) -> bool {
    let izin = gezinme_izinli(url);
    if !izin {
        eprintln!("gezinme reddedildi: {url}");
    }
    izin
}

/// `on_new_window`'a verilen karar: her yeni pencere isteği (window.open, target=_blank) reddedilir.
pub fn yeni_pencere_karari<R: Runtime>(url: &Url) -> NewWindowResponse<R> {
    eprintln!("yeni pencere reddedildi: {url}");
    NewWindowResponse::Deny
}

/// Uygulamayı başlatır.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(files::Durum::default())
        .manage(backup::Yedekci::default())
        .invoke_handler(tauri::generate_handler![
            files::dosya_ac,
            files::dosya_oku,
            files::dosya_kaydet,
            files::son_acilanlar,
            files::son_acilani_oku,
            files::bekleyen_acilanlar,
            backup::veri_yedekle,
            backup::veri_oku,
            i18n::dil_oku,
            i18n::dil_ayarla,
            print::yazdir,
            print::onizlemede_ac,
        ])
        // Menü dili: yedeklenmiş elle seçim ya da sistem dili (JS açılınca dil_ayarla ile eşitler).
        .menu(|app| {
            i18n::baslat(app);
            menu::olustur(app)
        })
        .on_menu_event(menu::olay)
        .setup(|app| {
            let ayar = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == ANA_PENCERE)
                .cloned()
                .ok_or("tauri.conf.json: no main window")?;
            WebviewWindowBuilder::from_config(app.handle(), &ayar)?
                // ilk kare menüyle aynı sistem dilinde (app/js/i18n.js __KC_DIL__)
                .initialization_script(i18n::baslangic_betigi())
                .on_navigation(gezinme_karari)
                .on_new_window(|url, _| yeni_pencere_karari(&url))
                .build()?;
            backup::isci_baslat(app.handle());
            // Önizleme önbelleği (eski çıktı, çökme artığı .gecici) açılışta temizlenir.
            print::acilista_temizle(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Mücellit başlatılamadı")
        .run(|app, olay| match olay {
            // Dock simgesine bırakılan ya da Finder'da "Birlikte Aç" ile gelen dosyalar (macOS; sistem bu
            // dosyalar için güvenlik kapsamlı erişimi kendisi başlatır).
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            tauri::RunEvent::Opened { urls } => {
                let yollar = urls
                    .into_iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .collect();
                files::disaridan_acildi(app, yollar);
            }
            // ⌘Q / Dock'tan Çık / son pencere kapandı (tao: applicationWillTerminate → LoopDestroyed → Exit):
            // bekleyen Süreç yedeği beklemeden yazılır.
            tauri::RunEvent::Exit => backup::kapanista_bosalt(app),
            _ => {}
        });
}

#[cfg(test)]
mod testler {
    use super::*;

    fn izin(adres: &str) -> bool {
        gezinme_izinli(&Url::parse(adres).unwrap_or_else(|e| panic!("{adres}: {e}")))
    }

    #[test]
    fn uygulama_icerigi_izinli() {
        for a in [
            "tauri://localhost",
            "tauri://localhost/",
            "tauri://localhost/index.html",
            "tauri://localhost/index.html?sekme=surec#x",
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
            "blob:tauri://localhost/7f0c3a7e-1d2b-4c5d-8e9f-0a1b2c3d4e5f",
        ] {
            assert!(izin(a), "{a} izinli olmalı");
        }
    }

    /// Kurulumda `on_navigation`'a verilen işlev (`gezinme_karari`) gerçekten reddediyor mu: denetim
    /// devre dışı bırakılırsa (ör. `true || …`, `|_| true`) bu test kalır.
    #[test]
    fn gezinme_karari_dis_adresi_reddeder_uygulama_icerigine_izin_verir() {
        let karar = |a: &str| gezinme_karari(&Url::parse(a).unwrap());
        for a in [
            "https://example.com/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "tauri://localhost.evil.com/",
            "blob:https://example.com/1234",
        ] {
            assert!(!karar(a), "{a} kurulumdaki karar işlevinde reddedilmeli");
        }
        for a in ["tauri://localhost/index.html", "https://tauri.localhost/"] {
            assert!(karar(a), "{a} kurulumdaki karar işlevinde izinli olmalı");
        }
    }

    #[test]
    fn yeni_pencere_her_zaman_reddedilir() {
        for a in ["https://example.com/", "tauri://localhost/index.html"] {
            assert!(matches!(
                yeni_pencere_karari::<tauri::Wry>(&Url::parse(a).unwrap()),
                NewWindowResponse::Deny
            ));
        }
    }

    #[test]
    fn dis_ve_supheli_adresler_reddedilir() {
        for a in [
            "https://example.com/",
            "http://example.com/",
            "tauri://localhost.evil.com/",
            "tauri://evil/",
            "tauri://localhost:8080/",
            "tauri://kullanici@localhost/",
            "tauri://kullanici:parola@localhost/",
            "https://tauri.localhost.evil.com/",
            "https://evil.com/tauri.localhost",
            "http://tauri.localhost:1430/",
            "http://localhost/",
            "http://127.0.0.1/",
            "http://ipc.localhost/",
            "ipc://localhost/plugin%3Adialog%7Cmessage",
            "file:///etc/passwd",
            "data:text/html,<script>alert(1)</script>",
            "javascript:alert(1)",
            "about:blank",
            "blob:https://example.com/1234",
            "blob:blob:tauri://localhost/1234",
            "asset://localhost/x",
            "mailto:a@b.c",
            "ws://tauri.localhost/",
        ] {
            assert!(!izin(a), "{a} reddedilmeli");
        }
    }
}
