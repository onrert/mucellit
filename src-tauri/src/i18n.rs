//! Interface language, Rust side: menus, Open/Save dialog titles and the error texts that go to the user.
//!
//! The dictionaries are shared with JS: `app/i18n/<code>.js`, strict JSON between two `/*JSON*/` markers (see app/js/i18n.js).
//! `build.rs` finds every dictionary in the folder and embeds it at build time; a new language needs no code change in Rust.
//! A missing key falls back to English (`en`), and without that to the key itself (the tests catch missing keys).
//!
//! Choice: JS (localStorage) is the main record; a manual choice is also written to `app_data_dir/language.txt` (when the
//! WebKit data is removed JS takes it back with `read_language`). At start-up the menu is built before JS: language.txt when it exists, otherwise the system language.
//! When JS opens it reports its own decision with `set_language`.
//!
//! System language: the Apple rule — in the preferred languages list of macOS
//! (`NSLocale.preferredLanguages`) the FIRST language whose primary subtag is supported; en when there is none. It goes to
//! JS with `read_language` as `system`; the "System Language (X)" item of the menu and the picker come from the same source (`system_code`).
//! Parameters are filled in a single pass (`fill`; the same as JS). Shared test vectors:
//! `app/test/fixtures/i18n-vectors.json`.

use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};
use tauri::{AppHandle, Manager, Runtime};

// `pub const DICTIONARY_FILES: &[(&str, &str)]` — (code, file text); written by build.rs.
include!(concat!(env!("OUT_DIR"), "/dictionaries.rs"));

/// The main language (the default, the fallback for a missing key).
pub const MAIN: &str = "en";
/// The backup of the manual choice (inside `app_data_dir`): "en" | "tr" …; the system language when missing.
pub const CHOICE_FILE: &str = "language.txt";
const MARKER: &str = "/*JSON*/";

/// Parses the JSON body (between the two markers) from the text of a dictionary file.
pub fn extract_json(text: &str) -> Result<Map<String, Value>, String> {
    let a = text
        .find(MARKER)
        .ok_or_else(|| format!("dictionary: missing {MARKER} marker"))?;
    let b = text
        .rfind(MARKER)
        .filter(|b| *b > a)
        .ok_or("dictionary: missing closing marker")?;
    // A developer error (a broken dictionary file); it does not reach the user, the tests catch it.
    match serde_json::from_str::<Value>(&text[a + MARKER.len()..b]) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Err("dictionary: body must be a JSON object".into()),
        Err(e) => Err(format!("dictionary: invalid JSON: {e}")),
    }
}

fn dictionaries() -> &'static BTreeMap<String, Map<String, Value>> {
    static S: OnceLock<BTreeMap<String, Map<String, Value>>> = OnceLock::new();
    S.get_or_init(|| {
        DICTIONARY_FILES
            .iter()
            .filter_map(|(code, text)| match extract_json(text) {
                Ok(m) => Some((code.to_string(), m)),
                Err(e) => {
                    eprintln!("dictionary could not be read ({code}): {e}");
                    None
                }
            })
            .collect()
    })
}

/// The supported languages (en first).
pub fn languages() -> Vec<String> {
    let mut l: Vec<String> = dictionaries().keys().cloned().collect();
    l.sort_by_key(|k| (k != MAIN, k.clone()));
    l
}

pub fn is_supported(code: &str) -> bool {
    dictionaries().contains_key(code)
}

/// The language's own name (`_name`: "English", "Türkçe").  // turkish-ok: expected Turkish UI text
pub fn name(code: &str) -> String {
    dictionaries()
        .get(code)
        .and_then(|s| s.get("_name"))
        .and_then(Value::as_str)
        .unwrap_or(code)
        .to_string()
}

/// The chosen language and the manual choice (None = the system language).
struct LanguageState {
    code: String,
    choice: Option<String>,
}

fn state() -> &'static RwLock<LanguageState> {
    static D: OnceLock<RwLock<LanguageState>> = OnceLock::new();
    D.get_or_init(|| {
        RwLock::new(LanguageState {
            code: MAIN.into(),
            choice: None,
        })
    })
}

/// The current language.
pub fn code() -> String {
    state()
        .read()
        .map(|d| d.code.clone())
        .unwrap_or_else(|_| MAIN.into())
}

/// The current manual choice (None when "system").
pub fn choice() -> Option<String> {
    state().read().ok().and_then(|d| d.choice.clone())
}

/// Sets the language and the choice (an unsupported code → en). true when it changed.
pub fn set(code: &str, choice: Option<&str>) -> bool {
    let code = if is_supported(code) { code } else { MAIN };
    let choice = choice.filter(|s| is_supported(s)).map(str::to_string);
    let Ok(mut d) = state().write() else {
        return false;
    };
    let changed = d.code != code || d.choice != choice;
    d.code = code.to_string();
    d.choice = choice;
    changed
}

fn raw<'a>(code: &str, key: &str) -> Option<&'a Value> {
    if key.starts_with('_') {
        return None;
    }
    dictionaries().get(code).and_then(|s| s.get(key))
}

/// Text (in the given language): falls back to en when missing, and to the key without that. Parameters in the
/// `{name}` form; in a singular/plural object "one" when the `n` parameter is 1, otherwise "other".
pub fn text_in(code: &str, key: &str, p: &[(&str, &str)]) -> String {
    let value = raw(code, key).or_else(|| raw(MAIN, key));
    let raw_text = match value {
        Some(Value::String(s)) => s.as_str(),
        Some(Value::Object(m)) => {
            let is_one = p.iter().any(|(a, d)| *a == "n" && *d == "1");
            m.get(if is_one { "one" } else { "other" })
                .or_else(|| m.get("other"))
                .and_then(Value::as_str)
                .unwrap_or(key)
        }
        _ => key,
    };
    fill(raw_text, p)
}

/// Fills the `{name}` parameters in ONE pass: a value put in is not scanned again (a `{x}` inside a value stays as it
/// is), the parameter order does not matter; an unknown parameter stays as `{name}` (the same as JS `fill`).
pub fn fill(text: &str, p: &[(&str, &str)]) -> String {
    let mut s = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        s.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let ad_uz = after
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(after.len());
        let name = &after[..ad_uz];
        let value = (!name.is_empty() && after[ad_uz..].starts_with('}'))
            .then(|| p.iter().find(|(a, _)| *a == name).map(|(_, d)| *d))
            .flatten();
        match value {
            Some(d) => {
                s.push_str(d);
                rest = &after[ad_uz + 1..];
            }
            None => {
                s.push('{');
                rest = after;
            }
        }
    }
    s.push_str(rest);
    s
}

/// Text (in the current language).
pub fn text(key: &str, p: &[(&str, &str)]) -> String {
    text_in(&code(), key, p)
}

/// For language independent comparisons in the tests: the fixed start of the text up to the first parameter (`{`) (in the current language).
#[cfg(test)]
pub fn prefix_of(key: &str) -> String {
    let m = text(key, &[]);
    m.split('{').next().unwrap_or("").to_string()
}

/// The interface language from the preferred languages list, the Apple rule: the FIRST language whose primary subtag
/// (region/script code dropped) is supported; en when there is none (the same rule as JS `systemLanguage`, shared vectors).
pub fn system_language(list: &[String]) -> String {
    list.iter()
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.to_lowercase()
                .split(['-', '_'])
                .next()
                .unwrap_or("")
                .to_string()
        })
        .find(|k| is_supported(k))
        .unwrap_or_else(|| MAIN.into())
}

/// The system language of this Mac (the menu, `read_language` and the start-up from the same source).
pub fn system_code() -> String {
    system_language(&system_preferences())
}

/// The pre-script that runs before the page scripts (`WebviewWindowBuilder::initialization_script`): JS `i18n.js`
/// uses the same system language as the menu in the first frame too (WKWebView `navigator.languages` may give one
/// language; in the past at start-up first the browser language showed, then Rust's when `read_language` returned).
/// The value is escaped as JSON; the object is frozen and cannot be redefined.
pub fn init_script_for(code: &str) -> String {
    let value = serde_json::json!({ "system": code });
    format!(
        "Object.defineProperty(window,'__MC_LANG__',{{value:Object.freeze({value}),writable:false,configurable:false}});"
    )
}

/// The pre-script with the system language of this Mac (once when the window is set up; JS `read_language` still syncs).
pub fn init_script() -> String {
    init_script_for(&system_code())
}

/// The label of the "System Language (X)" item in the View > Language menu (in the current language).
pub fn system_label() -> String {
    text("menu.language_system", &[("name", &name(&system_code()))])
}

/// The languages the operating system prefers (macOS: `NSLocale.preferredLanguages`, the per-app language setting
/// included; other platforms: `LANG`).
pub fn system_preferences() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        objc2_foundation::NSLocale::preferredLanguages()
            .iter()
            .map(|s| s.to_string())
            .collect()
    }
    #[cfg(not(target_os = "macos"))]
    {
        std::env::var("LANG").map(|l| vec![l]).unwrap_or_default()
    }
}

/// The backed-up manual choice (None when missing, empty or unsupported).
pub fn read_choice(file: &Path) -> Option<String> {
    let s = fs::read_to_string(file).ok()?;
    let s = s.trim();
    is_supported(s).then(|| s.to_string())
}

/// Backs up the manual choice; None (system) removes the file.
pub fn write_choice(file: &Path, choice: Option<&str>) -> io::Result<()> {
    match choice {
        Some(s) => crate::recent::write_atomic(file, format!("{s}\n").as_bytes()),
        None => match fs::remove_file(file) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        },
    }
}

fn choice_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(CHOICE_FILE))
}

/// At start-up (before the menu is built): the backed-up manual choice, otherwise the system language.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let choice = choice_file(app).as_deref().and_then(read_choice);
    let code = choice.clone().unwrap_or_else(system_code);
    set(&code, choice.as_deref());
}

/// The language information given to JS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LanguageInfo {
    pub code: String,
    /// "system" | a language code
    pub choice: String,
    /// The system language (the Apple rule; the same source as "System Language (X)" in the menu). JS uses it for the "system" choice.
    pub system: String,
}

/// Language information; `choice`: the backed-up manual choice (None = system).
pub fn language_info(choice: Option<String>) -> LanguageInfo {
    LanguageInfo {
        code: code(),
        choice: choice.unwrap_or_else(|| "system".into()),
        system: system_code(),
    }
}

/// The language in Rust, the backed-up manual choice and the system language.
#[tauri::command]
pub fn read_language<R: Runtime>(app: AppHandle<R>) -> LanguageInfo {
    let choice = choice_file(&app).as_deref().and_then(read_choice);
    language_info(choice)
}

/// The decision of JS: `code` the shown language, `choice` "system" or the manually chosen language. The choice is
/// backed up; when the language changed the menu is built again.
#[tauri::command]
pub fn set_language<R: Runtime>(
    app: AppHandle<R>,
    code: String,
    choice: String,
) -> Result<(), String> {
    if !is_supported(&code) {
        return Err(text("rust.i18n_unsupported", &[("code", &code)]));
    }
    let manual = match choice.as_str() {
        "system" => None,
        s if is_supported(s) => Some(s),
        s => return Err(text("rust.i18n_unsupported", &[("code", s)])),
    };
    if let Some(d) = choice_file(&app) {
        if read_choice(&d).as_deref() != manual {
            write_choice(&d, manual)
                .map_err(|e| text("rust.i18n_write_failed", &[("error", &e.to_string())]))?;
        }
    }
    if set(&code, manual) {
        crate::menu::refresh(&app);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// the pre-script carries the system language with JSON escaping (a faulty code does not break the script either).
    #[test]
    fn init_script_carries_system_language_escaped() {
        assert_eq!(
            init_script_for("tr"),
            "Object.defineProperty(window,'__MC_LANG__',{value:Object.freeze({\"system\":\"tr\"}),writable:false,configurable:false});"
        );
        let bad = init_script_for("x\"});alert(1);//</script>");
        assert!(
            bad.contains(r#""system":"x\"});alert(1);//</script>""#),
            "{bad}"
        );
        assert_eq!(init_script(), init_script_for(&system_code()));
        assert!(is_supported(&system_code()));
    }

    #[test]
    fn dictionaries_embedded_en_first_tr_present() {
        let d = languages();
        assert_eq!(d.first().map(String::as_str), Some("en"), "{d:?}");
        assert!(d.iter().any(|k| k == "tr"), "{d:?}");
        assert_eq!(name("en"), "English");
        assert_eq!(name("tr"), "Türkçe"); // turkish-ok: expected Turkish UI text
                                          // the number of files embedded at build time = the number of app/i18n/*.js (a new language comes on its own)
        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../app/i18n");
        let n = fs::read_dir(folder)
            .unwrap()
            .filter(|g| {
                g.as_ref()
                    .is_ok_and(|g| g.file_name().to_string_lossy().ends_with(".js"))
            })
            .count();
        assert_eq!(DICTIONARY_FILES.len(), n);
        assert_eq!(dictionaries().len(), n, "every dictionary parsed");
    }

    #[test]
    fn text_parameters_plurals_and_missing_keys() {
        assert_eq!(text_in("tr", "menu.file", &[]), "Dosya"); // turkish-ok: expected Turkish UI text
        assert_eq!(text_in("en", "menu.file", &[]), "File");
        assert_eq!(
            text_in("en", "rust.unsupported", &[("name", "a.txt")]),
            "unsupported file: a.txt"
        );
        assert_eq!(
            text_in("tr", "rust.unsupported", &[("name", "a.txt")]),
            "desteklenmeyen dosya: a.txt" // turkish-ok: expected Turkish UI text
        );
        // missing key: an unknown language → en; in no language → the key
        assert_eq!(text_in("xx", "menu.file", &[]), "File");
        assert_eq!(text_in("tr", "none.such.key", &[]), "none.such.key");
        assert_eq!(text_in("tr", "_name", &[]), "_name", "metadata is not text");
        // singular/plural (an object in en, one form in tr)
        assert_eq!(
            text_in("en", "impose.selected", &[("n", "1")]),
            "1 page selected."
        );
        assert_eq!(
            text_in("en", "impose.selected", &[("n", "3")]),
            "3 pages selected."
        );
        assert_eq!(
            text_in("tr", "impose.selected", &[("n", "3")]),
            "3 sayfa seçildi." // turkish-ok: expected Turkish UI text
        );
    }

    #[test]
    fn system_language_apple_rule() {
        let l = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(system_language(&l(&["tr-TR", "en-US"])), "tr");
        assert_eq!(system_language(&l(&["TR"])), "tr");
        assert_eq!(system_language(&l(&["tr_TR"])), "tr");
        assert_eq!(system_language(&l(&["en-GB", "tr-TR"])), "en");
        assert_eq!(
            system_language(&l(&["de-DE", "tr-TR"])),
            "tr",
            "Apple rule: the first supported language in the list"
        );
        assert_eq!(system_language(&l(&["de-DE", "fr-FR"])), "en");
        assert_eq!(system_language(&l(&[])), "en");
        assert_eq!(
            system_language(&l(&["", "tr"])),
            "tr",
            "an empty entry is skipped"
        );
        assert_eq!(system_language(&l(&["kind"])), "en");
    }

    #[test]
    fn choice_file_round_trip_and_faulty_input() {
        let d = std::env::temp_dir().join(format!("mc-i18n-{}", uuid::Uuid::new_v4()));
        let y = d.join(CHOICE_FILE);
        assert_eq!(read_choice(&y), None, "no file");
        write_choice(&y, Some("tr")).unwrap();
        assert_eq!(read_choice(&y).as_deref(), Some("tr"));
        for bad in ["", "xx", "../tr", "tr tr", "TR"] {
            fs::write(&y, bad).unwrap();
            assert_eq!(read_choice(&y), None, "{bad:?}");
        }
        fs::write(&y, " en \n").unwrap();
        assert_eq!(read_choice(&y).as_deref(), Some("en"), "spaces are trimmed");
        write_choice(&y, None).unwrap();
        assert!(!y.exists(), "the system choice removes the file");
        write_choice(&y, None).unwrap();
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn extract_json_faulty_dictionary() {
        assert!(extract_json("{}").is_err(), "no markers");
        assert!(extract_json("/*JSON*/{}").is_err(), "no closing");
        assert!(
            extract_json("/*JSON*/[1]/*JSON*/").is_err(),
            "not an object"
        );
        assert!(
            extract_json("/*JSON*/{\"a\":}/*JSON*/").is_err(),
            "broken JSON"
        );
        assert_eq!(
            extract_json("x(/*JSON*/{\"a\":\"b\"}/*JSON*/);").unwrap()["a"],
            "b"
        );
    }

    /// Vectors shared with JS (app/test/fixtures/i18n-vectors.json; i18n.test.js tests the same file).
    fn vectors() -> Value {
        serde_json::from_str(include_str!("../../app/test/fixtures/i18n-vectors.json")).unwrap()
    }
    fn texts(x: &Value) -> Vec<String> {
        x.as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn shared_vectors_apple_rule() {
        let v = vectors();
        let system = v["system_language"].as_array().unwrap();
        assert!(system.len() >= 5);
        let failed: Vec<String> = system
            .iter()
            .filter_map(|o| {
                let list = texts(&o["list"]);
                let b = system_language(&list);
                (b != o["expected"].as_str().unwrap())
                    .then(|| format!("{list:?} → {b} (expected {})", o["expected"]))
            })
            .collect();
        assert!(failed.is_empty(), "{failed:#?}");
    }

    #[test]
    fn shared_vectors_single_pass_fill() {
        let v = vectors();
        let fill = v["fill"].as_array().unwrap();
        assert!(!fill.is_empty());
        let mut failed = Vec::new();
        for o in fill {
            let p: Vec<Vec<String>> = o["p"].as_array().unwrap().iter().map(texts).collect();
            let p: Vec<(&str, &str)> = p.iter().map(|c| (c[0].as_str(), c[1].as_str())).collect();
            let m = text_in(o["i18n"].as_str().unwrap(), o["key"].as_str().unwrap(), &p);
            if m != o["expected"].as_str().unwrap() {
                failed.push(format!("{p:?} → {m}"));
            }
        }
        assert!(failed.is_empty(), "{failed:#?}");
    }

    /// "System Language (X)" in the menu and the system language that goes to JS come from the same source (`system_code`).
    #[test]
    fn system_language_menu_and_js_share_source() {
        let b = language_info(None);
        assert_eq!(b.choice, "system");
        assert_eq!(b.system, system_code());
        assert!(is_supported(&b.system));
        assert_eq!(
            system_label(),
            text("menu.language_system", &[("name", &name(&b.system))])
        );
        assert_eq!(language_info(Some("tr".into())).choice, "tr");
        assert_eq!(
            text_in("en", "menu.language_system", &[("name", "English")]),
            "System Language (English)",
            "menu in Title Case"
        );
    }

    /// Every key used in the Rust sources with `text("…")` / `text_in(_, "…")` is in every dictionary.
    #[test]
    fn rust_keys_exist_in_every_dictionary() {
        let sources = [
            include_str!("i18n.rs"),
            include_str!("files.rs"),
            include_str!("menu.rs"),
            include_str!("backup.rs"),
            include_str!("recent.rs"),
            include_str!("epub_folder.rs"),
            include_str!("lib.rs"),
        ];
        let mut keys = std::collections::BTreeSet::new();
        for k in sources {
            // the part before the test module (cfg(test) functions included)
            let body = k
                .split("#[cfg(test)]\nmod tests")
                .next()
                .unwrap()
                .split("#[cfg(test)]\npub(crate) mod tests")
                .next()
                .unwrap();
            for part in body.split("text(\"").skip(1) {
                keys.insert(part.split('"').next().unwrap().to_string());
            }
        }
        assert!(keys.len() > 30, "the key scan works: {keys:?}");
        for code in languages() {
            let s = &dictionaries()[&code];
            let missing: Vec<_> = keys.iter().filter(|a| !s.contains_key(*a)).collect();
            assert!(
                missing.is_empty(),
                "missing in the {code} dictionary: {missing:?}"
            );
        }
    }
}
