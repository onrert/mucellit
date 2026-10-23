//! Mücellit Mac uygulaması (Tauri 2). Web arayüzü `dist/` (app/'ten `tools/prepare-dist.mjs` ile).
//! pencere, dialog eklentisi (yerel onay pencereleri), yerel menü.
//! yerel Aç/Kaydet (`dosya`), klasör paketi EPUB (`epub_klasor`), son açılanlar + yer imi
//! (`son_acilanlar`), Süreç verisi otomatik yedeği (`veri`), Dock/Finder'dan açma (`RunEvent::Opened`).
//! yazdırma (`yazdir`: PDFKit baskı işlemi %100 ölçek; Önizleme'de Aç).
//!
//! Güvenlik: ana pencere `tauri.conf.json`'daki ayarla (`create: false`) burada kurulur;
//! uygulama dışı adrese gezinme ve yeni pencere (window.open, target=_blank) reddedilir. CSP conf'ta.

pub mod backup;
pub mod epub_folder;
pub mod files;
pub mod i18n;
pub mod legacy;
mod menu;
pub mod print;
pub mod recent;

use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{Runtime, Url};

/// Ana pencerenin etiketi (`tauri.conf.json` ve `capabilities/default.json` ile aynı).
const MAIN_WINDOW: &str = "main";

/// Web görünümü bu adrese gidebilir mi? Yalnız uygulamanın kendi içeriği: macOS'ta `tauri://localhost`,
/// Windows/Android biçimi `http(s)://tauri.localhost`; bunların kökenli `blob:` adresleri (sayfanın kendi
/// ürettiği indirme). Kullanıcı adı/parola/bağlantı noktası taşıyan ya da başka her adres reddedilir.
pub fn navigation_allowed(url: &Url) -> bool {
    let without_credentials =
        url.username().is_empty() && url.password().is_none() && url.port().is_none();
    match url.scheme() {
        "tauri" => without_credentials && url.host_str() == Some("localhost"),
        "http" | "https" => without_credentials && url.host_str() == Some("tauri.localhost"),
        // blob:<köken>/<kimlik> — köken de uygulamanın kendisi olmalı (iç içe blob: yok).
        "blob" => Url::parse(url.path())
            .map(|inner| inner.scheme() != "blob" && navigation_allowed(&inner))
            .unwrap_or(false),
        _ => false,
    }
}

/// `on_navigation`'a verilen karar işlevinin kendisi (testler bunu doğrudan çağırır; kapanış içine
/// gömülü mantık sınanamıyordu: sınaması, `true || gezinme_izinli(url)` mutantı yakalanmadı).
/// Reddedilen adres stderr'e yazılır.
pub fn navigation_decision(url: &Url) -> bool {
    let permission = navigation_allowed(url);
    if !permission {
        eprintln!("navigation rejected: {url}");
    }
    permission
}

/// `on_new_window`'a verilen karar: her yeni pencere isteği (window.open, target=_blank) reddedilir.
pub fn new_window_decision<R: Runtime>(url: &Url) -> NewWindowResponse<R> {
    eprintln!("fresh window rejected: {url}");
    NewWindowResponse::Deny
}

/// Uygulamayı başlatır.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(files::FileState::default())
        .manage(backup::BackupWriter::default())
        .invoke_handler(tauri::generate_handler![
            files::open_file,
            files::read_file,
            files::save_file,
            files::recent_files,
            files::read_recent_file,
            files::pending_opens,
            backup::backup_data,
            backup::read_backup,
            i18n::read_language,
            i18n::set_language,
            print::print,
            print::open_in_preview,
        ])
        // Menü dili: yedeklenmiş elle seçim ya da sistem dili (JS açılınca dil_ayarla ile eşitler).
        .menu(|app| {
            // files of earlier versions are renamed before anything reads them
            legacy::migrate_app_data(app);
            i18n::start(app);
            menu::create(app)
        })
        .on_menu_event(menu::on_event)
        .setup(|app| {
            let settings = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == MAIN_WINDOW)
                .cloned()
                .ok_or("tauri.conf.json: no main window")?;
            WebviewWindowBuilder::from_config(app.handle(), &settings)?
                // ilk kare menüyle aynı sistem dilinde (app/js/i18n.js __KC_DIL__)
                .initialization_script(i18n::init_script())
                .on_navigation(navigation_decision)
                .on_new_window(|url, _| new_window_decision(&url))
                .build()?;
            backup::start_worker(app.handle());
            // Önizleme önbelleği (eski çıktı, çökme artığı .gecici) açılışta temizlenir.
            print::clean_on_startup(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Mücellit başlatılamadı")
        .run(|app, on_event| match on_event {
            // Dock simgesine bırakılan ya da Finder'da "Birlikte Aç" ile gelen dosyalar (macOS; sistem bu
            // dosyalar için güvenlik kapsamlı erişimi kendisi başlatır).
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            tauri::RunEvent::Opened { urls } => {
                let paths = urls
                    .into_iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .collect();
                files::opened_from_outside(app, paths);
            }
            // ⌘Q / Dock'tan Çık / son pencere kapandı (tao: applicationWillTerminate → LoopDestroyed → Exit):
            // bekleyen Süreç yedeği beklemeden yazılır.
            tauri::RunEvent::Exit => backup::flush_on_exit(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn permission(address: &str) -> bool {
        navigation_allowed(&Url::parse(address).unwrap_or_else(|e| panic!("{address}: {e}")))
    }

    #[test]
    fn app_content_allowed() {
        for a in [
            "tauri://localhost",
            "tauri://localhost/",
            "tauri://localhost/index.html",
            "tauri://localhost/index.html?tab=projects#x",
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
            "blob:tauri://localhost/7f0c3a7e-1d2b-4c5d-8e9f-0a1b2c3d4e5f",
        ] {
            assert!(permission(a), "{a} izinli olmalı");
        }
    }

    /// Kurulumda `on_navigation`'a verilen işlev (`gezinme_karari`) gerçekten reddediyor mu: denetim
    /// devre dışı bırakılırsa (ör. `true || …`, `|_| true`) bu test kalır.
    #[test]
    fn navigation_decision_rejects_external_allows_app_content() {
        let decision = |a: &str| navigation_decision(&Url::parse(a).unwrap());
        for a in [
            "https://example.com/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "tauri://localhost.evil.com/",
            "blob:https://example.com/1234",
        ] {
            assert!(
                !decision(a),
                "{a} kurulumdaki decision işlevinde reddedilmeli"
            );
        }
        for a in ["tauri://localhost/index.html", "https://tauri.localhost/"] {
            assert!(
                decision(a),
                "{a} kurulumdaki decision işlevinde allowed olmalı"
            );
        }
    }

    #[test]
    fn new_window_always_rejected() {
        for a in ["https://example.com/", "tauri://localhost/index.html"] {
            assert!(matches!(
                new_window_decision::<tauri::Wry>(&Url::parse(a).unwrap()),
                NewWindowResponse::Deny
            ));
        }
    }

    #[test]
    fn external_and_suspicious_addresses_are_rejected() {
        for a in [
            "https://example.com/",
            "http://example.com/",
            "tauri://localhost.evil.com/",
            "tauri://evil/",
            "tauri://localhost:8080/",
            "tauri://user@localhost/",
            "tauri://user:password@localhost/",
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
            assert!(!permission(a), "{a} reddedilmeli");
        }
    }
}
