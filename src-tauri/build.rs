use std::fmt::Write as _;
use std::path::PathBuf;

fn main() {
    embed_dictionaries();
    // Uygulama komutları için allow-/deny- izinleri üretilir; capabilities/default.json yalnız kullanılanları
    // açar (komut listesi lib.rs generate_handler! ile aynı olmalı; app/test/tauri-security.test.js denetler).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_file",
            "read_file",
            "save_file",
            "recent_files",
            "read_recent_file",
            "pending_opens",
            "backup_data",
            "read_backup",
            "read_language",
            "set_language",
            "print",
            "open_in_preview",
        ]),
    ))
    .expect("tauri-build başarısız");
}

/// Arayüz sözlükleri: `../app/i18n/<kod>.js` dosyalarının hepsi `OUT_DIR/sozlukler.rs` içinde
/// `include_str!` ile gömülür (src/i18n.rs). Yeni dil için Rust'ta kod değişmez.
fn embed_dictionaries() {
    let folder = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("app")
        .join("i18n");
    println!("cargo:rerun-if-changed={}", folder.display());
    let mut files: Vec<(String, PathBuf)> = std::fs::read_dir(&folder)
        .unwrap_or_else(|e| panic!("sözlük klasörü okunamadı ({}): {e}", folder.display()))
        .filter_map(Result::ok)
        .filter_map(|g| {
            let path = g.path();
            let name = path.file_name()?.to_str()?.to_string();
            let code = name.strip_suffix(".js")?;
            let valid =
                (2..=3).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase());
            valid.then(|| (code.to_string(), path.canonicalize().unwrap_or(path)))
        })
        .collect();
    files.sort();
    assert!(
        files.iter().any(|(k, _)| k == "en"),
        "app/i18n/en.js (ana sözlük) yok"
    );
    let mut source = String::from("pub const DICTIONARY_FILES: &[(&str, &str)] = &[\n");
    for (code, path) in &files {
        println!("cargo:rerun-if-changed={}", path.display());
        writeln!(
            source,
            "    ({code:?}, include_str!({:?})),",
            path.display().to_string()
        )
        .unwrap();
    }
    source.push_str("];\n");
    let output = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR")).join("dictionaries.rs");
    std::fs::write(output, source).expect("sozlukler.rs yazılamadı");
}
