//! Native menu. The app menu; File (Open ⌘O, the Open Recent submenu, Save Imposed PDF
//! ⌘S, Print… ⌘P and Open in Preview ⌥⌘P, JSON backup, Close Window ⌘W); Edit (default items; ⌘C/⌘V/⌘Z work with
//! them in the WKWebView text boxes); View (⌘1-4 tabs — ⌘4 Learn —, full screen); Window.
//! A menu event goes to the webview as the item id with the `menu` event (app/js/platform-tauri.js listens);
//! "Clear Menu" is handled in Rust. Open Recent is built again with `refresh` on every change.
//! every label (the default items included: About, Hide, Quit, Close Window, Undo …) comes from the dictionary,
//! in the current language (`crate::i18n`); the View > Language submenu (`i18n:<choice>`, handled by JS); the menu is built again when the language changes.

use crate::files::FileState;
use crate::i18n::{self, text};
use tauri::menu::{
    CheckMenuItemBuilder, Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The tab items in the View menu: (id, dictionary key, shortcut). The ids must be the same as `TAB_ITEMS` in
/// platform-tauri.js.
pub const TABS: [(&str, &str, &str); 4] = [
    ("tab-impose", "tab.impose", "CmdOrCtrl+1"),
    ("tab-projects", "tab.projects", "CmdOrCtrl+2"),
    ("tab-calculator", "tab.calculator", "CmdOrCtrl+3"),
    ("tab-learn", "tab.learn", "CmdOrCtrl+4"),
];

/// The File menu items that go to the webview: (id, dictionary key, shortcut). The ids must be the same as
/// `FILE_ITEMS` in platform-tauri.js.
/// Print… ⌘P (HIG: File menu), Open in Preview ⌥⌘P.
pub const FILE_ITEMS: [(&str, &str, Option<&str>); 6] = [
    ("file-open", "menu.open", Some("CmdOrCtrl+O")),
    ("file-save", "menu.save", Some("CmdOrCtrl+S")),
    ("file-print", "menu.print", Some("CmdOrCtrl+P")),
    ("file-preview", "menu.preview", Some("Alt+CmdOrCtrl+P")),
    ("json-export", "menu.json_export", None),
    ("json-import", "menu.json_import", None),
];

/// The id prefix of a recent file item: "last:<uuid>".
pub const RECENT_PREFIX: &str = "last:";
/// The id prefix of a language item: "i18n:system" | "i18n:<code>" (JS `Mucellit.app.changeLanguage`).
pub const LANGUAGE_PREFIX: &str = "i18n:";
/// An item handled in Rust.
pub const CLEAR_LAST: &str = "last-clear";

/// Is it a menu item to pass to the webview?
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

/// Menu label: muda removes a single `&` (mnemonic) on macOS; doubled so that a `&` in a file name shows.
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
            &MenuItemBuilder::with_id("recent-empty", text("menu.recent_empty", &[]))
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

    let [open, save, print, preview, json_export, json_import] =
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
        .item(&json_export?)
        .item(&json_import?)
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

/// View > Language: the system language ("System Language (X)", Title Case: menu.language_system) + every dictionary
/// (with its own name); the current choice is checked.
fn language_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    let choice = i18n::choice();
    // the same source as "System language (X)" in the picker (i18n::system_code; JS gets it with read_language.system)
    let mut m = SubmenuBuilder::new(app, text("menu.language", &[])).item(
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

/// Builds the menu (Open Recent included) again.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    match create(app).and_then(|m| app.set_menu(m)) {
        Ok(_) => {}
        Err(e) => eprintln!("the menu could not be refreshed: {e}"),
    }
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, on_event: MenuEvent) {
    let id = on_event.id().as_ref();
    if id == CLEAR_LAST {
        crate::files::clear_recent_files(app);
    } else if is_forwarded(id) {
        if id.starts_with(LANGUAGE_PREFIX) {
            // A checked item changes on its own when clicked; so that it does not stay wrong when JS cancels, the menu is built
            // again with the current choice (when JS accepts, set_language builds it again).
            refresh(app);
        }
        if let Err(e) = app.emit("menu", id) {
            eprintln!("the menu event could not be sent ({id}): {e}");
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
            "tab-learn2",
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
            "recent-empty",
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
            "i18n:tr ",
            "i18n:../en",
            "i18n:system2",
            "i18n",
        ] {
            assert!(!is_forwarded(k), "{k:?}");
        }
    }

    /// Every dictionary key in the menu exists in every language (a missing key would show as the key name in the menu).
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
            "Pencereyi Kapat" // turkish-ok: expected Turkish UI text
        );
        // AppKit renames the toggleFullScreen: item with its own text when the menu is validated; the dictionary has that
        // text (MenuCommands.loctable "Enter Full Screen": en/tr), the name does not change before/after validation.
        assert_eq!(
            crate::i18n::text_in("en", "menu.full_screen", &[]),
            "Enter Full Screen"
        );
        assert_eq!(
            crate::i18n::text_in("tr", "menu.full_screen", &[]),
            "Tam Ekrana Geç" // turkish-ok: expected Turkish UI text
        );
    }

    /// In the View menu the 4th tab is Learn ⌘4; the label from the dictionary in both languages ("Learn" / "Öğren").  // turkish-ok: expected Turkish UI text
    #[test]
    fn learn_tab_has_shortcut_four_in_both_languages() {
        assert_eq!(TABS.len(), 4);
        assert_eq!(TABS[3], ("tab-learn", "tab.learn", "CmdOrCtrl+4"));
        for (i, (_, _, k)) in TABS.iter().enumerate() {
            assert_eq!(
                *k,
                format!("CmdOrCtrl+{}", i + 1),
                "tab shortcuts in order ⌘1-⌘4"
            );
        }
        assert_eq!(crate::i18n::text_in("en", "tab.learn", &[]), "Learn");
        assert_eq!(crate::i18n::text_in("tr", "tab.learn", &[]), "Öğren"); // turkish-ok: expected Turkish UI text
    }

    #[test]
    fn label_ampersand_is_doubled() {
        assert_eq!(
            escape_label("Crime & Punishment.epub"),
            "Crime && Punishment.epub"
        );
        assert_eq!(escape_label("plain.pdf"), "plain.pdf");
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
                "{id} not in platform-tauri.js"
            );
        }
        assert!(
            js.contains(&format!("'{RECENT_PREFIX}'")),
            "platform-tauri.js last: prefix"
        );
        let mut all: Vec<&str> = TABS.iter().map(|(_, _, k)| *k).collect();
        all.extend(FILE_ITEMS.iter().filter_map(|(_, _, k)| *k));
        let n = all.len();
        all.sort_unstable();
        all.dedup();
        assert_eq!(all.len(), n, "unique shortcuts");
    }
}
