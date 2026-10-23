//! Yerel menü. Uygulama menüsü; Dosya (Aç ⌘O, Son Açılanlar alt menüsü, Dizilmiş PDF'i
//! Kaydet ⌘S, Yazdır… ⌘P ve Önizleme'de Aç ⌥⌘P, JSON yedeği, Pencereyi Kapat ⌘W); Düzen (öntanımlı öğeler; WKWebView metin kutularında
//! ⌘C/⌘V/⌘Z bunlarla çalışır); Görünüm (⌘1-4 sekmeler — ⌘4 Öğren —, tam ekran); Pencere.
//! Menü olayı webview'e `menu` olayıyla öğe kimliği olarak gider (app/js/platform-tauri.js dinler);
//! "Menüyü Temizle" Rust'ta işlenir. Son Açılanlar her değişimde `yenile` ile yeniden kurulur.
//! bütün etiketler (öntanımlı öğeler dahil: Hakkında, Gizle, Çık, Pencereyi Kapat, Geri Al …) sözlükten,
//! şu anki dilde (`crate::dil`); Görünüm > Dil alt menüsü (`dil:<seçim>`, JS işler); dil değişince menü yeniden kurulur.

use crate::files::FileState;
use crate::i18n::{self, text};
use tauri::menu::{
    CheckMenuItemBuilder, Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Görünüm menüsündeki sekme öğeleri: (kimlik, sözlük anahtarı, kısayol). Kimlikler platform-tauri.js'teki
/// `SEKME_OGESI` ile aynı olmalı.
pub const TABS: [(&str, &str, &str); 4] = [
    ("tab-impose", "tab.impose", "CmdOrCtrl+1"),
    ("tab-projects", "tab.projects", "CmdOrCtrl+2"),
    ("tab-calculator", "tab.calculator", "CmdOrCtrl+3"),
    ("tab-learn", "tab.learn", "CmdOrCtrl+4"),
];

/// Dosya menüsünün webview'e giden öğeleri: (kimlik, sözlük anahtarı, kısayol). Kimlikler platform-tauri.js'teki
/// `DOSYA_OGESI` ile aynı olmalı.
/// Yazdır… ⌘P (HIG: Dosya menüsü), Önizleme'de Aç ⌥⌘P.
pub const FILE_ITEMS: [(&str, &str, Option<&str>); 6] = [
    ("file-open", "menu.open", Some("CmdOrCtrl+O")),
    ("file-save", "menu.save", Some("CmdOrCtrl+S")),
    ("file-print", "menu.print", Some("CmdOrCtrl+P")),
    ("file-preview", "menu.preview", Some("Alt+CmdOrCtrl+P")),
    ("json-export", "menu.json_disa", None),
    ("json-import", "menu.json_ice", None),
];

/// Son açılan öğesinin kimlik öneki: "son:<uuid>".
pub const RECENT_PREFIX: &str = "last:";
/// Dil öğesinin kimlik öneki: "dil:sistem" | "dil:<kod>" (JS `KitapCilt.uygulama.dilDegistir`).
pub const LANGUAGE_PREFIX: &str = "i18n:";
/// Rust'ta işlenen öğe.
pub const CLEAR_LAST: &str = "last-clear";

/// Webview'e iletilecek menü öğesi mi?
pub fn is_forwarded(id: &str) -> bool {
    TABS.iter().any(|(k, _, _)| *k == id)
        || FILE_ITEMS.iter().any(|(k, _, _)| *k == id)
        || id.strip_prefix(RECENT_PREFIX).is_some_and(|u| {
            uuid::Uuid::parse_str(u).is_ok_and(|v| v.hyphenated().to_string() == u)
        })
        || id
            .strip_prefix(LANGUAGE_PREFIX)
            .is_some_and(|s| s == "system" || i18n::is_supported(s))
}

/// Menü etiketi: muda macOS'ta tek `&`'yi (anımsatıcı) siler; dosya adındaki `&` görünsün diye ikilenir.
pub fn escape_label(name: &str) -> String {
    name.replace('&', "&&")
}

pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let name = app.package_info().name.clone();
    let app_menu = SubmenuBuilder::new(app, &name)
        .about_with_text(text("menu.about", &[("name", &name)]), None)
        .separator()
        .services_with_text(text("menu.services", &[]))
        .separator()
        .hide_with_text(text("menu.hide", &[("name", &name)]))
        .hide_others_with_text(text("menu.hide_others", &[]))
        .show_all_with_text(text("menu.show_all", &[]))
        .separator()
        .quit_with_text(text("menu.quit", &[("name", &name)]))
        .build()?;

    let mut last = SubmenuBuilder::new(app, text("menu.recent_files", &[]));
    let summaries = app
        .try_state::<FileState>()
        .map(|d| d.recent_summaries(app))
        .unwrap_or_default();
    if summaries.is_empty() {
        last = last.item(
            &MenuItemBuilder::with_id("last-blank", text("menu.son_bos", &[]))
                .enabled(false)
                .build(app)?,
        );
    } else {
        for o in &summaries {
            last = last.item(
                &MenuItemBuilder::with_id(
                    format!("{RECENT_PREFIX}{}", o.id),
                    escape_label(&o.name),
                )
                .build(app)?,
            );
        }
        last = last
            .separator()
            .item(&MenuItemBuilder::with_id(CLEAR_LAST, text("menu.clear_last", &[])).build(app)?);
    }
    let last = last.build()?;

    let [open, save, print, preview, json_disa, json_ice] =
        FILE_ITEMS.map(|(id, key, shortcut)| {
            let mut b = MenuItemBuilder::with_id(id, text(key, &[]));
            if let Some(k) = shortcut {
                b = b.accelerator(k);
            }
            b.build(app)
        });
    let file = SubmenuBuilder::new(app, text("menu.file", &[]))
        .item(&open?)
        .item(&last)
        .separator()
        .item(&save?)
        .separator()
        .item(&print?)
        .item(&preview?)
        .separator()
        .item(&json_disa?)
        .item(&json_ice?)
        .separator()
        .close_window_with_text(text("menu.close_window", &[]))
        .build()?;

    let layout = SubmenuBuilder::new(app, text("menu.layout", &[]))
        .undo_with_text(text("menu.undo", &[]))
        .redo_with_text(text("menu.redo", &[]))
        .separator()
        .cut_with_text(text("menu.cut", &[]))
        .copy_with_text(text("menu.copy", &[]))
        .paste_with_text(text("menu.paste", &[]))
        .select_all_with_text(text("menu.select_all", &[]))
        .build()?;

    let mut view = SubmenuBuilder::new(app, text("menu.view", &[]));
    for (id, key, shortcut) in TABS {
        view = view.item(
            &MenuItemBuilder::with_id(id, text(key, &[]))
                .accelerator(shortcut)
                .build(app)?,
        );
    }
    let view = view
        .separator()
        .item(&language_menu(app)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(
            app,
            Some(&text("menu.full_screen", &[])),
        )?)
        .build()?;

    let window = SubmenuBuilder::new(app, text("menu.window", &[]))
        .minimize_with_text(text("menu.shrink", &[]))
        .maximize_with_text(text("menu.zoom", &[]))
        .build()?;

    Menu::with_items(app, &[&app_menu, &file, &layout, &view, &window])
}

/// Görünüm > Dil: sistem dili ("Sistem Dili (X)", Title Case: menu.dil_sistem) + her sözlük (kendi adıyla); şu anki
/// seçim işaretli.
fn language_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    let choice = i18n::choice();
    // seçicideki "Sistem dili (X)" ile aynı kaynak (i18n::sistem_kodu; JS dil_oku.sistem ile alır)
    let mut m = SubmenuBuilder::new(app, text("menu.i18n", &[])).item(
        &CheckMenuItemBuilder::with_id(format!("{LANGUAGE_PREFIX}system"), i18n::system_label())
            .checked(choice.is_none())
            .build(app)?,
    );
    for code in i18n::languages() {
        m = m.item(
            &CheckMenuItemBuilder::with_id(
                format!("{LANGUAGE_PREFIX}{code}"),
                escape_label(&i18n::name(&code)),
            )
            .checked(choice.as_deref() == Some(code.as_str()))
            .build(app)?,
        );
    }
    m.build()
}

/// Menüyü (Son Açılanlar dahil) yeniden kurar.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    match create(app).and_then(|m| app.set_menu(m)) {
        Ok(_) => {}
        Err(e) => eprintln!("menü yenilenemedi: {e}"),
    }
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, on_event: MenuEvent) {
    let id = on_event.id().as_ref();
    if id == CLEAR_LAST {
        crate::files::clear_recent_files(app);
    } else if is_forwarded(id) {
        if id.starts_with(LANGUAGE_PREFIX) {
            // İşaretli öğe tıklanınca kendiliğinden değişir; JS vazgeçerse yanlış kalmasın diye menü şimdiki
            // seçimle yeniden kurulur (JS kabul ederse dil_ayarla yeniden kurar).
            refresh(app);
        }
        if let Err(e) = app.emit("menu", id) {
            eprintln!("menü olayı iletilemedi ({id}): {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tab_ids_are_forwarded_others_are_not() {
        for k in ["tab-impose", "tab-projects", "tab-calculator", "tab-learn"] {
            assert!(is_forwarded(k), "{k}");
        }
        for k in [
            "",
            "tab",
            "quit",
            "tab-impose ",
            "TAB-PROJECTS",
            "tab-learn ",
            "tab-LEARN",
            "tab-ogren2",
        ] {
            assert!(!is_forwarded(k), "{k:?}");
        }
    }

    #[test]
    fn file_and_recent_items_are_forwarded_faulty_id_is_not() {
        for k in [
            "file-open",
            "file-save",
            "file-print",
            "file-preview",
            "json-export",
            "json-import",
            "last:7f0c3a7e-1d2b-4c5d-8e9f-0a1b2c3d4e5f",
        ] {
            assert!(is_forwarded(k), "{k}");
        }
        for k in [
            "last:",
            "son:../../etc/passwd",
            "son:/etc/hosts",
            "last:7F0C3A7E-1D2B-4C5D-8E9F-0A1B2C3D4E5F",
            "last:7f0c3a7e1d2b4c5d8e9f0a1b2c3d4e5f",
            "son:7f0c3a7e-1d2b-4c5d-8e9f-0a1b2c3d4e5f ",
            "last-clear",
            "last-blank",
            "file-open ",
        ] {
            assert!(!is_forwarded(k), "{k:?}");
        }
    }

    #[test]
    fn language_items_are_forwarded_faulty_language_is_not() {
        for k in ["i18n:system", "i18n:en", "i18n:tr"] {
            assert!(is_forwarded(k), "{k}");
        }
        for k in [
            "i18n:",
            "i18n:xx",
            "i18n:TR",
            "dil:tr ",
            "dil:../en",
            "i18n:sistem2",
            "i18n",
        ] {
            assert!(!is_forwarded(k), "{k:?}");
        }
    }

    /// Menüdeki her sözlük anahtarı her dilde var (eksik anahtar menüde anahtar adı olarak görünürdü).
    #[test]
    fn menu_keys_in_every_language() {
        let mut keys: Vec<&str> = TABS.iter().map(|(_, a, _)| *a).collect();
        keys.extend(FILE_ITEMS.iter().map(|(_, a, _)| *a));
        for code in crate::i18n::languages() {
            for a in &keys {
                let m = crate::i18n::text_in(&code, a, &[]);
                assert_ne!(&m, a, "{code}: {a} missing");
            }
        }
        assert_eq!(
            crate::i18n::text_in("en", "menu.close_window", &[]),
            "Close Window"
        );
        assert_eq!(
            crate::i18n::text_in("tr", "menu.close_window", &[]),
            "Pencereyi Kapat"
        );
        // AppKit toggleFullScreen: öğesini menü doğrulanırken kendi metniyle yeniden adlandırır; sözlük o
        // metinle aynı (MenuCommands.loctable "Enter Full Screen": en/tr), doğrulamadan önce/sonra ad değişmez.
        assert_eq!(
            crate::i18n::text_in("en", "menu.full_screen", &[]),
            "Enter Full Screen"
        );
        assert_eq!(
            crate::i18n::text_in("tr", "menu.full_screen", &[]),
            "Tam Ekrana Geç"
        );
    }

    /// Görünüm menüsünde 4. sekme Öğren ⌘4; etiket iki dilde sözlükten ("Learn" / "Öğren").
    #[test]
    fn learn_tab_has_shortcut_four_in_both_languages() {
        assert_eq!(TABS.len(), 4);
        assert_eq!(TABS[3], ("tab-learn", "tab.learn", "CmdOrCtrl+4"));
        for (i, (_, _, k)) in TABS.iter().enumerate() {
            assert_eq!(
                *k,
                format!("CmdOrCtrl+{}", i + 1),
                "sekme kısayolları sırayla ⌘1-⌘4"
            );
        }
        assert_eq!(crate::i18n::text_in("en", "tab.learn", &[]), "Learn");
        assert_eq!(crate::i18n::text_in("tr", "tab.learn", &[]), "Öğren");
    }

    #[test]
    fn label_ampersand_is_doubled() {
        assert_eq!(escape_label("Suç & Ceza.epub"), "Suç && Ceza.epub");
        assert_eq!(escape_label("düz.pdf"), "düz.pdf");
    }

    #[test]
    fn shortcuts_unique_and_ids_match_platform_tauri() {
        let js = include_str!("../../app/js/platform-tauri.js");
        let mut shortcut: Vec<&str> = TABS.iter().map(|(_, _, k)| *k).collect();
        shortcut.sort_unstable();
        shortcut.dedup();
        assert_eq!(shortcut.len(), TABS.len());
        let mut ids: Vec<&str> = TABS.iter().map(|(k, _, _)| *k).collect();
        ids.extend(FILE_ITEMS.iter().map(|(k, _, _)| *k));
        for id in ids {
            assert!(
                js.contains(&format!("'{id}'")),
                "platform-tauri.js içinde {id} yok"
            );
        }
        assert!(
            js.contains(&format!("'{RECENT_PREFIX}'")),
            "platform-tauri.js son: öneki"
        );
        let mut all: Vec<&str> = TABS.iter().map(|(_, _, k)| *k).collect();
        all.extend(FILE_ITEMS.iter().filter_map(|(_, _, k)| *k));
        let n = all.len();
        all.sort_unstable();
        all.dedup();
        assert_eq!(all.len(), n, "kısayollar benzersiz");
    }
}
