//! Arayüz dili, Rust tarafı: menüler, Aç/Kaydet pencere başlıkları ve kullanıcıya giden hata metinleri.
//!
//! Sözlükler JS ile ortaktır: `app/i18n/<kod>.js`, iki `/*JSON*/` işareti arasında katı JSON (bkz. app/js/i18n.js).
//! `build.rs` klasördeki her sözlüğü bulur ve derlemede gömer; yeni dil için Rust'ta kod değişmez.
//! Eksik anahtar İngilizceye (`en`), o da yoksa anahtarın kendisine düşer (testler eksik anahtarı yakalar).
//!
//! Seçim: JS (localStorage) asıl kayıttır; elle seçim ayrıca `app_data_dir/dil.txt`'ye yazılır (WebKit verisi
//! silinirse JS `dil_oku` ile geri alır). Açılışta menü JS'ten önce kurulur: dil.txt varsa o, yoksa sistem dili.
//! JS açılınca `dil_ayarla` ile kendi kararını bildirir.
//!
//! Sistem dili: Apple kuralı — macOS'un tercih edilen diller listesinde
//! (`NSLocale.preferredLanguages`) birincil alt etiketi desteklenen İLK dil; hiçbiri yoksa en. JS'e `dil_oku` ile
//! `sistem` olarak gider; menüdeki "Sistem dili (X)" ile seçicideki aynı kaynaktan (`sistem_kodu`) gelir.
//! Parametreler tek geçişte doldurulur (`doldur`; JS ile aynı). Ortak test vektörleri:
//! `app/test/fixtures/i18n-vectors.json`.

use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};
use tauri::{AppHandle, Manager, Runtime};

// `pub const SOZLUK_DOSYALARI: &[(&str, &str)]` — (kod, dosya metni); build.rs üretir.
include!(concat!(env!("OUT_DIR"), "/dictionaries.rs"));

/// Ana (öntanımlı, eksik anahtarda düşülen) dil.
pub const MAIN: &str = "en";
/// Elle seçimin yedeği (`app_data_dir` içinde): "en" | "tr" …; yoksa sistem dili.
pub const CHOICE_FILE: &str = "language.txt";
const MARKER: &str = "/*JSON*/";

/// Sözlük dosyası metninden JSON gövdesini (iki işaret arası) ayrıştırır.
pub fn extract_json(text: &str) -> Result<Map<String, Value>, String> {
    let a = text
        .find(MARKER)
        .ok_or_else(|| format!("dictionary: missing {MARKER} marker"))?;
    let b = text
        .rfind(MARKER)
        .filter(|b| *b > a)
        .ok_or("dictionary: missing closing marker")?;
    // Geliştirici hatası (sözlük dosyası bozuk); kullanıcıya gitmez, testler yakalar.
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
                    eprintln!("sözlük okunamadı ({code}): {e}");
                    None
                }
            })
            .collect()
    })
}

/// Desteklenen diller (en önce).
pub fn languages() -> Vec<String> {
    let mut l: Vec<String> = dictionaries().keys().cloned().collect();
    l.sort_by_key(|k| (k != MAIN, k.clone()));
    l
}

pub fn is_supported(code: &str) -> bool {
    dictionaries().contains_key(code)
}

/// Dilin kendi adı (`_ad`: "English", "Türkçe").
pub fn name(code: &str) -> String {
    dictionaries()
        .get(code)
        .and_then(|s| s.get("_name"))
        .and_then(Value::as_str)
        .unwrap_or(code)
        .to_string()
}

/// Seçili dil ve elle seçim (None = sistem dili).
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

/// Şu anki dil.
pub fn code() -> String {
    state()
        .read()
        .map(|d| d.code.clone())
        .unwrap_or_else(|_| MAIN.into())
}

/// Şu anki elle seçim ("sistem" ise None).
pub fn choice() -> Option<String> {
    state().read().ok().and_then(|d| d.choice.clone())
}

/// Dili ve seçimi ayarlar (desteklenmeyen kod → en). Değiştiyse true.
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

/// Metin (verilen dilde): eksikse en'e, o da yoksa anahtara düşer. Parametre `{ad}` biçiminde; tekil/çoğul
/// nesnede `n` parametresi 1 ise "one", değilse "other".
pub fn text_in(code: &str, key: &str, p: &[(&str, &str)]) -> String {
    let value = raw(code, key).or_else(|| raw(MAIN, key));
    let ham_metin = match value {
        Some(Value::String(s)) => s.as_str(),
        Some(Value::Object(m)) => {
            let bir = p.iter().any(|(a, d)| *a == "n" && *d == "1");
            m.get(if bir { "one" } else { "other" })
                .or_else(|| m.get("other"))
                .and_then(Value::as_str)
                .unwrap_or(key)
        }
        _ => key,
    };
    fill(ham_metin, p)
}

/// `{ad}` parametrelerini TEK geçişte doldurur: yerine konan değer yeniden taranmaz (değer içindeki `{x}` aynen
/// kalır), parametre sırası önemsizdir; bilinmeyen parametre `{ad}` olarak kalır (JS `doldur` ile aynı).
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

/// Metin (şu anki dilde).
pub fn text(key: &str, p: &[(&str, &str)]) -> String {
    text_in(&code(), key, p)
}

/// Testlerde dilden bağımsız karşılaştırma: metnin ilk parametreye (`{`) kadarki sabit başı (şu anki dilde).
#[cfg(test)]
pub fn prefix_of(key: &str) -> String {
    let m = text(key, &[]);
    m.split('{').next().unwrap_or("").to_string()
}

/// Tercih edilen dil listesinden arayüz dili, Apple kuralı: birincil alt etiketi (bölge/yazı kodu atılır)
/// desteklenen İLK dil; hiçbiri yoksa en (JS `sistemDili` ile aynı kural, ortak vektörler).
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

/// Bu Mac'in sistem dili (menü, `dil_oku` ve açılış aynı kaynaktan).
pub fn system_code() -> String {
    system_language(&system_preferences())
}

/// sayfa betiklerinden önce çalışan ön betik (`WebviewWindowBuilder::initialization_script`): JS `i18n.js`
/// ilk karede de menüyle aynı sistem dilini kullanır (WKWebView `navigator.languages` tek dil verebilir; eskiden
/// açılışta önce tarayıcı dili, `dil_oku` dönünce Rust'ın dili görünüyordu). Değer JSON olarak kaçışlanır; nesne
/// dondurulur ve yeniden tanımlanamaz.
pub fn init_script_for(code: &str) -> String {
    let value = serde_json::json!({ "system": code });
    format!(
        "Object.defineProperty(window,'__MC_LANG__',{{value:Object.freeze({value}),writable:false,configurable:false}});"
    )
}

/// Bu Mac'in sistem diliyle ön betik (pencere kurulurken bir kez; JS `dil_oku` yine eşitler).
pub fn init_script() -> String {
    init_script_for(&system_code())
}

/// Görünüm > Dil menüsündeki "Sistem Dili (X)" öğesinin etiketi (şu anki dilde).
pub fn system_label() -> String {
    text("menu.language_system", &[("name", &name(&system_code()))])
}

/// İşletim sisteminin tercih ettiği diller (macOS: `NSLocale.preferredLanguages`, uygulamaya özel dil ayarı
/// dahil; başka platform: `LANG`).
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

/// Yedeklenmiş elle seçim (yoksa, boşsa ya da desteklenmiyorsa None).
pub fn read_choice(file: &Path) -> Option<String> {
    let s = fs::read_to_string(file).ok()?;
    let s = s.trim();
    is_supported(s).then(|| s.to_string())
}

/// Elle seçimi yedekler; None (sistem) dosyayı siler.
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

/// Açılışta (menü kurulmadan önce): yedeklenmiş elle seçim, yoksa sistem dili.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let choice = choice_file(app).as_deref().and_then(read_choice);
    let code = choice.clone().unwrap_or_else(system_code);
    set(&code, choice.as_deref());
}

/// JS'e verilen dil bilgisi.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LanguageInfo {
    pub code: String,
    /// "sistem" | dil kodu
    pub choice: String,
    /// Sistem dili (Apple kuralı; menüdeki "Sistem dili (X)" ile aynı kaynak). JS "sistem" seçiminde bunu kullanır.
    pub system: String,
}

/// Dil bilgisi; `secim`: yedeklenmiş elle seçim (None = sistem).
pub fn language_info(choice: Option<String>) -> LanguageInfo {
    LanguageInfo {
        code: code(),
        choice: choice.unwrap_or_else(|| "system".into()),
        system: system_code(),
    }
}

/// Rust'taki dil, yedeklenmiş elle seçim ve sistem dili.
#[tauri::command]
pub fn read_language<R: Runtime>(app: AppHandle<R>) -> LanguageInfo {
    let choice = choice_file(&app).as_deref().and_then(read_choice);
    language_info(choice)
}

/// JS'in kararı: `kod` görünen dil, `secim` "sistem" ya da elle seçilen dil. Seçim yedeklenir, dil
/// değiştiyse menü yeniden kurulur.
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

    /// ön betik sistem dilini JSON kaçışıyla taşır (kusurlu kod da betiği bozmaz).
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
        assert_eq!(name("tr"), "Türkçe");
        // derlemede gömülen dosya sayısı = app/i18n/*.js sayısı (yeni dil kendiliğinden gelir)
        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../app/i18n");
        let n = fs::read_dir(folder)
            .unwrap()
            .filter(|g| {
                g.as_ref()
                    .is_ok_and(|g| g.file_name().to_string_lossy().ends_with(".js"))
            })
            .count();
        assert_eq!(DICTIONARY_FILES.len(), n);
        assert_eq!(dictionaries().len(), n, "her sözlük ayrıştırıldı");
    }

    #[test]
    fn text_parameters_plurals_and_missing_keys() {
        assert_eq!(text_in("tr", "menu.file", &[]), "Dosya");
        assert_eq!(text_in("en", "menu.file", &[]), "File");
        assert_eq!(
            text_in("en", "rust.unsupported", &[("name", "a.txt")]),
            "unsupported file: a.txt"
        );
        assert_eq!(
            text_in("tr", "rust.unsupported", &[("name", "a.txt")]),
            "desteklenmeyen dosya: a.txt"
        );
        // eksik anahtar: bilinmeyen dil → en; hiçbir dilde yok → anahtar
        assert_eq!(text_in("xx", "menu.file", &[]), "File");
        assert_eq!(text_in("tr", "none.such.key", &[]), "none.such.key");
        assert_eq!(
            text_in("tr", "_name", &[]),
            "_name",
            "üst veri metin değildir"
        );
        // tekil/çoğul (en'de nesne, tr'de tek biçim)
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
            "3 sayfa seçildi."
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
            "Apple kuralı: listede desteklenen ilk dil"
        );
        assert_eq!(system_language(&l(&["de-DE", "fr-FR"])), "en");
        assert_eq!(system_language(&l(&[])), "en");
        assert_eq!(system_language(&l(&["", "tr"])), "tr", "boş girdi atlanır");
        assert_eq!(system_language(&l(&["kind"])), "en");
    }

    #[test]
    fn choice_file_round_trip_and_faulty_input() {
        let d = std::env::temp_dir().join(format!("mc-i18n-{}", uuid::Uuid::new_v4()));
        let y = d.join(CHOICE_FILE);
        assert_eq!(read_choice(&y), None, "dosya yok");
        write_choice(&y, Some("tr")).unwrap();
        assert_eq!(read_choice(&y).as_deref(), Some("tr"));
        for bad in ["", "xx", "../tr", "tr tr", "TR"] {
            fs::write(&y, bad).unwrap();
            assert_eq!(read_choice(&y), None, "{bad:?}");
        }
        fs::write(&y, " en \n").unwrap();
        assert_eq!(read_choice(&y).as_deref(), Some("en"), "boşluk kırpılır");
        write_choice(&y, None).unwrap();
        assert!(!y.exists(), "sistem seçimi dosyayı siler");
        write_choice(&y, None).unwrap();
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn extract_json_faulty_dictionary() {
        assert!(extract_json("{}").is_err(), "işaret yok");
        assert!(extract_json("/*JSON*/{}").is_err(), "kapanış yok");
        assert!(extract_json("/*JSON*/[1]/*JSON*/").is_err(), "nesne değil");
        assert!(
            extract_json("/*JSON*/{\"a\":}/*JSON*/").is_err(),
            "bozuk JSON"
        );
        assert_eq!(
            extract_json("x(/*JSON*/{\"a\":\"b\"}/*JSON*/);").unwrap()["a"],
            "b"
        );
    }

    /// JS ile ortak vektörler (app/test/fixtures/i18n-vectors.json; i18n.test.js aynı dosyayı sınar).
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

    /// menüdeki "Sistem dili (X)" ve JS'e giden sistem dili aynı kaynaktan (`sistem_kodu`).
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
            "menü Title Case"
        );
    }

    /// Rust kaynaklarında `metin("…")` / `metin_dilde(_, "…")` ile kullanılan her anahtar her sözlükte var.
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
            // test modülünden önceki kısım (cfg(test) işlevler, ör. `kalip`, dahil)
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
        assert!(keys.len() > 30, "key taraması çalışıyor: {keys:?}");
        for code in languages() {
            let s = &dictionaries()[&code];
            let missing: Vec<_> = keys.iter().filter(|a| !s.contains_key(*a)).collect();
            assert!(missing.is_empty(), "{code} sözlüğünde eksik: {missing:?}");
        }
    }
}
