use std::fmt::Write as _;
use std::path::PathBuf;

fn main() {
    sozlukleri_gom();
    // Uygulama komutları için allow-/deny- izinleri üretilir; capabilities/default.json yalnız kullanılanları
    // açar (komut listesi lib.rs generate_handler! ile aynı olmalı; app/test/tauri-guvenlik.test.js denetler).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "dosya_ac",
            "dosya_oku",
            "dosya_kaydet",
            "son_acilanlar",
            "son_acilani_oku",
            "bekleyen_acilanlar",
            "veri_yedekle",
            "veri_oku",
            "dil_oku",
            "dil_ayarla",
            "yazdir",
            "onizlemede_ac",
        ]),
    ))
    .expect("tauri-build başarısız");
}

/// Arayüz sözlükleri: `../app/dil/<kod>.js` dosyalarının hepsi `OUT_DIR/sozlukler.rs` içinde
/// `include_str!` ile gömülür (src/dil.rs). Yeni dil için Rust'ta kod değişmez.
fn sozlukleri_gom() {
    let klasor = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("app")
        .join("dil");
    println!("cargo:rerun-if-changed={}", klasor.display());
    let mut dosyalar: Vec<(String, PathBuf)> = std::fs::read_dir(&klasor)
        .unwrap_or_else(|e| panic!("sözlük klasörü okunamadı ({}): {e}", klasor.display()))
        .filter_map(Result::ok)
        .filter_map(|g| {
            let yol = g.path();
            let ad = yol.file_name()?.to_str()?.to_string();
            let kod = ad.strip_suffix(".js")?;
            let gecerli =
                (2..=3).contains(&kod.len()) && kod.bytes().all(|b| b.is_ascii_lowercase());
            gecerli.then(|| (kod.to_string(), yol.canonicalize().unwrap_or(yol)))
        })
        .collect();
    dosyalar.sort();
    assert!(
        dosyalar.iter().any(|(k, _)| k == "en"),
        "app/dil/en.js (ana sözlük) yok"
    );
    let mut kaynak = String::from("pub const SOZLUK_DOSYALARI: &[(&str, &str)] = &[\n");
    for (kod, yol) in &dosyalar {
        println!("cargo:rerun-if-changed={}", yol.display());
        writeln!(
            kaynak,
            "    ({kod:?}, include_str!({:?})),",
            yol.display().to_string()
        )
        .unwrap();
    }
    kaynak.push_str("];\n");
    let cikti = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR")).join("sozlukler.rs");
    std::fs::write(cikti, kaynak).expect("sozlukler.rs yazılamadı");
}
