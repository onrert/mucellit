use std::fmt::Write as _;
use std::path::PathBuf;

fn main() {
    embed_dictionaries();
    // allow-/deny- permissions are made for the app commands; capabilities/default.json turns on only the used ones
    // (the command list must be the same as lib.rs generate_handler!; app/test/tauri-security.test.js checks it).
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
    .expect("tauri-build failed");
}

/// Interface dictionaries: every `../app/i18n/<code>.js` file is embedded in `OUT_DIR/dictionaries.rs` with
/// `include_str!` (src/i18n.rs). A new language needs no code change in Rust.
fn embed_dictionaries() {
    let folder = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("app")
        .join("i18n");
    println!("cargo:rerun-if-changed={}", folder.display());
    let mut files: Vec<(String, PathBuf)> = std::fs::read_dir(&folder)
        .unwrap_or_else(|e| {
            panic!(
                "the dictionary folder could not be read ({}): {e}",
                folder.display()
            )
        })
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
        "app/i18n/en.js (the main dictionary) missing"
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
    std::fs::write(output, source).expect("dictionaries.rs could not be written");
}
