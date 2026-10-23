//! Mucellit Mac app (Tauri 2). The web interface is `dist/` (from app/ with `tools/prepare-dist.mjs`).
//! window, dialog plug-in (native confirm dialogs), native menu.
//! native Open/Save (`files`), folder package EPUB (`epub_folder`), recent files + bookmarks
//! (`recent`), the automatic backup of the project data (`backup`), opening from the Dock/Finder (`RunEvent::Opened`).
//! printing (`print`: a PDFKit print operation at 100% scale; Open in Preview).
//!
//! Security: the main window is set up here with the settings of `tauri.conf.json` (`create: false`);
//! navigation to an address outside the app and new windows (window.open, target=_blank) are rejected. The CSP is in the conf.

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

/// The label of the main window (the same as in `tauri.conf.json` and `capabilities/default.json`).
const MAIN_WINDOW: &str = "main";

/// May the web view go to this address? Only the app's own content: `tauri://localhost` on macOS,
/// the Windows/Android form `http(s)://tauri.localhost`; `blob:` addresses with these origins (downloads the page makes
/// itself). An address with a user name/password/port, and every other address, is rejected.
pub fn navigation_allowed(url: &Url) -> bool {
    let without_credentials =
        url.username().is_empty() && url.password().is_none() && url.port().is_none();
    match url.scheme() {
        "tauri" => without_credentials && url.host_str() == Some("localhost"),
        "http" | "https" => without_credentials && url.host_str() == Some("tauri.localhost"),
        // blob:<origin>/<id> — the origin must be the app itself too (no nested blob:).
        "blob" => Url::parse(url.path())
            .map(|inner| inner.scheme() != "blob" && navigation_allowed(&inner))
            .unwrap_or(false),
        _ => false,
    }
}

/// The decision function given to `on_navigation` itself (the tests call it directly; logic embedded in a closure could
/// not be tested: in the test, the `true || navigation_allowed(url)` mutant was not caught).
/// A rejected address is written to stderr.
pub fn navigation_decision(url: &Url) -> bool {
    let permission = navigation_allowed(url);
    if !permission {
        eprintln!("navigation rejected: {url}");
    }
    permission
}

/// The decision given to `on_new_window`: every new window request (window.open, target=_blank) is rejected.
pub fn new_window_decision<R: Runtime>(url: &Url) -> NewWindowResponse<R> {
    eprintln!("fresh window rejected: {url}");
    NewWindowResponse::Deny
}

/// Starts the app.
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
        // Menu language: the backed-up manual choice or the system language (JS syncs it with set_language when it opens).
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
                // the first frame in the same system language as the menu (app/js/i18n.js __MC_LANG__)
                .initialization_script(i18n::init_script())
                .on_navigation(navigation_decision)
                .on_new_window(|url, _| new_window_decision(&url))
                .build()?;
            backup::start_worker(app.handle());
            // The Preview cache (old outputs, crash leftover .temp) is cleaned at start-up.
            print::clean_on_startup(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Mucellit could not start")
        .run(|app, on_event| match on_event {
            // Files dropped on the Dock icon or coming from Finder "Open With" (macOS; the system starts the security-scoped access
            // for these files itself).
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            tauri::RunEvent::Opened { urls } => {
                let paths = urls
                    .into_iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .collect();
                files::opened_from_outside(app, paths);
            }
            // ⌘Q / Quit from the Dock / the last window closed (tao: applicationWillTerminate → LoopDestroyed → Exit):
            // the pending project backup is written without waiting.
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
            assert!(permission(a), "{a} must be allowed");
        }
    }

    /// Does the function given to `on_navigation` at setup (`navigation_decision`) really reject: when the check is
    /// turned off (e.g. `true || …`, `|_| true`) this test fails.
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
                "{a} must be rejected by the decision function of the setup"
            );
        }
        for a in ["tauri://localhost/index.html", "https://tauri.localhost/"] {
            assert!(
                decision(a),
                "{a} must be allowed by the decision function of the setup"
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
            assert!(!permission(a), "{a} must be rejected");
        }
    }
}
