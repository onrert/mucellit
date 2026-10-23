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
include!(concat!(env!("OUT_DIR"), "/sozlukler.rs"));

/// Ana (öntanımlı, eksik anahtarda düşülen) dil.
pub const ANA: &str = "en";
/// Elle seçimin yedeği (`app_data_dir` içinde): "en" | "tr" …; yoksa sistem dili.
pub const SECIM_DOSYASI: &str = "dil.txt";
const ISARET: &str = "/*JSON*/";

/// Sözlük dosyası metninden JSON gövdesini (iki işaret arası) ayrıştırır.
pub fn json_ayikla(metin: &str) -> Result<Map<String, Value>, String> {
    let a = metin
        .find(ISARET)
        .ok_or_else(|| format!("dictionary: missing {ISARET} marker"))?;
    let b = metin
        .rfind(ISARET)
        .filter(|b| *b > a)
        .ok_or("dictionary: missing closing marker")?;
    // Geliştirici hatası (sözlük dosyası bozuk); kullanıcıya gitmez, testler yakalar.
    match serde_json::from_str::<Value>(&metin[a + ISARET.len()..b]) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Err("dictionary: body must be a JSON object".into()),
        Err(e) => Err(format!("dictionary: invalid JSON: {e}")),
    }
}

fn sozlukler() -> &'static BTreeMap<String, Map<String, Value>> {
    static S: OnceLock<BTreeMap<String, Map<String, Value>>> = OnceLock::new();
    S.get_or_init(|| {
        SOZLUK_DOSYALARI
            .iter()
            .filter_map(|(kod, metin)| match json_ayikla(metin) {
                Ok(m) => Some((kod.to_string(), m)),
                Err(e) => {
                    eprintln!("sözlük okunamadı ({kod}): {e}");
                    None
                }
            })
            .collect()
    })
}

/// Desteklenen diller (en önce).
pub fn diller() -> Vec<String> {
    let mut l: Vec<String> = sozlukler().keys().cloned().collect();
    l.sort_by_key(|k| (k != ANA, k.clone()));
    l
}

pub fn destekli(kod: &str) -> bool {
    sozlukler().contains_key(kod)
}

/// Dilin kendi adı (`_ad`: "English", "Türkçe").
pub fn ad(kod: &str) -> String {
    sozlukler()
        .get(kod)
        .and_then(|s| s.get("_ad"))
        .and_then(Value::as_str)
        .unwrap_or(kod)
        .to_string()
}

/// Seçili dil ve elle seçim (None = sistem dili).
struct Durum {
    kod: String,
    secim: Option<String>,
}

fn durum() -> &'static RwLock<Durum> {
    static D: OnceLock<RwLock<Durum>> = OnceLock::new();
    D.get_or_init(|| {
        RwLock::new(Durum {
            kod: ANA.into(),
            secim: None,
        })
    })
}

/// Şu anki dil.
pub fn kod() -> String {
    durum()
        .read()
        .map(|d| d.kod.clone())
        .unwrap_or_else(|_| ANA.into())
}

/// Şu anki elle seçim ("sistem" ise None).
pub fn secim() -> Option<String> {
    durum().read().ok().and_then(|d| d.secim.clone())
}

/// Dili ve seçimi ayarlar (desteklenmeyen kod → en). Değiştiyse true.
pub fn ayarla(kod: &str, secim: Option<&str>) -> bool {
    let kod = if destekli(kod) { kod } else { ANA };
    let secim = secim.filter(|s| destekli(s)).map(str::to_string);
    let Ok(mut d) = durum().write() else {
        return false;
    };
    let degisti = d.kod != kod || d.secim != secim;
    d.kod = kod.to_string();
    d.secim = secim;
    degisti
}

fn ham<'a>(kod: &str, anahtar: &str) -> Option<&'a Value> {
    if anahtar.starts_with('_') {
        return None;
    }
    sozlukler().get(kod).and_then(|s| s.get(anahtar))
}

/// Metin (verilen dilde): eksikse en'e, o da yoksa anahtara düşer. Parametre `{ad}` biçiminde; tekil/çoğul
/// nesnede `n` parametresi 1 ise "one", değilse "other".
pub fn metin_dilde(kod: &str, anahtar: &str, p: &[(&str, &str)]) -> String {
    let deger = ham(kod, anahtar).or_else(|| ham(ANA, anahtar));
    let ham_metin = match deger {
        Some(Value::String(s)) => s.as_str(),
        Some(Value::Object(m)) => {
            let bir = p.iter().any(|(a, d)| *a == "n" && *d == "1");
            m.get(if bir { "one" } else { "other" })
                .or_else(|| m.get("other"))
                .and_then(Value::as_str)
                .unwrap_or(anahtar)
        }
        _ => anahtar,
    };
    doldur(ham_metin, p)
}

/// `{ad}` parametrelerini TEK geçişte doldurur: yerine konan değer yeniden taranmaz (değer içindeki `{x}` aynen
/// kalır), parametre sırası önemsizdir; bilinmeyen parametre `{ad}` olarak kalır (JS `doldur` ile aynı).
pub fn doldur(metin: &str, p: &[(&str, &str)]) -> String {
    let mut s = String::with_capacity(metin.len());
    let mut kalan = metin;
    while let Some(ac) = kalan.find('{') {
        s.push_str(&kalan[..ac]);
        let sonra = &kalan[ac + 1..];
        let ad_uz = sonra
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(sonra.len());
        let ad = &sonra[..ad_uz];
        let deger = (!ad.is_empty() && sonra[ad_uz..].starts_with('}'))
            .then(|| p.iter().find(|(a, _)| *a == ad).map(|(_, d)| *d))
            .flatten();
        match deger {
            Some(d) => {
                s.push_str(d);
                kalan = &sonra[ad_uz + 1..];
            }
            None => {
                s.push('{');
                kalan = sonra;
            }
        }
    }
    s.push_str(kalan);
    s
}

/// Metin (şu anki dilde).
pub fn metin(anahtar: &str, p: &[(&str, &str)]) -> String {
    metin_dilde(&kod(), anahtar, p)
}

/// Testlerde dilden bağımsız karşılaştırma: metnin ilk parametreye (`{`) kadarki sabit başı (şu anki dilde).
#[cfg(test)]
pub fn kalip(anahtar: &str) -> String {
    let m = metin(anahtar, &[]);
    m.split('{').next().unwrap_or("").to_string()
}

/// Tercih edilen dil listesinden arayüz dili, Apple kuralı: birincil alt etiketi (bölge/yazı kodu atılır)
/// desteklenen İLK dil; hiçbiri yoksa en (JS `sistemDili` ile aynı kural, ortak vektörler).
pub fn sistem_dili(liste: &[String]) -> String {
    liste
        .iter()
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.to_lowercase()
                .split(['-', '_'])
                .next()
                .unwrap_or("")
                .to_string()
        })
        .find(|k| destekli(k))
        .unwrap_or_else(|| ANA.into())
}

/// Bu Mac'in sistem dili (menü, `dil_oku` ve açılış aynı kaynaktan).
pub fn sistem_kodu() -> String {
    sistem_dili(&sistem_tercihleri())
}

/// sayfa betiklerinden önce çalışan ön betik (`WebviewWindowBuilder::initialization_script`): JS `i18n.js`
/// ilk karede de menüyle aynı sistem dilini kullanır (WKWebView `navigator.languages` tek dil verebilir; eskiden
/// açılışta önce tarayıcı dili, `dil_oku` dönünce Rust'ın dili görünüyordu). Değer JSON olarak kaçışlanır; nesne
/// dondurulur ve yeniden tanımlanamaz.
pub fn baslangic_betigi_kod(kod: &str) -> String {
    let deger = serde_json::json!({ "sistem": kod });
    format!(
        "Object.defineProperty(window,'__KC_DIL__',{{value:Object.freeze({deger}),writable:false,configurable:false}});"
    )
}

/// Bu Mac'in sistem diliyle ön betik (pencere kurulurken bir kez; JS `dil_oku` yine eşitler).
pub fn baslangic_betigi() -> String {
    baslangic_betigi_kod(&sistem_kodu())
}

/// Görünüm > Dil menüsündeki "Sistem Dili (X)" öğesinin etiketi (şu anki dilde).
pub fn sistem_etiketi() -> String {
    metin("menu.dil_sistem", &[("ad", &ad(&sistem_kodu()))])
}

/// İşletim sisteminin tercih ettiği diller (macOS: `NSLocale.preferredLanguages`, uygulamaya özel dil ayarı
/// dahil; başka platform: `LANG`).
pub fn sistem_tercihleri() -> Vec<String> {
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
pub fn secim_oku(dosya: &Path) -> Option<String> {
    let s = fs::read_to_string(dosya).ok()?;
    let s = s.trim();
    destekli(s).then(|| s.to_string())
}

/// Elle seçimi yedekler; None (sistem) dosyayı siler.
pub fn secim_yaz(dosya: &Path, secim: Option<&str>) -> io::Result<()> {
    match secim {
        Some(s) => crate::recent::atomik_yaz(dosya, format!("{s}\n").as_bytes()),
        None => match fs::remove_file(dosya) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        },
    }
}

fn secim_dosyasi<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(SECIM_DOSYASI))
}

/// Açılışta (menü kurulmadan önce): yedeklenmiş elle seçim, yoksa sistem dili.
pub fn baslat<R: Runtime>(app: &AppHandle<R>) {
    let secim = secim_dosyasi(app).as_deref().and_then(secim_oku);
    let kod = secim.clone().unwrap_or_else(sistem_kodu);
    ayarla(&kod, secim.as_deref());
}

/// JS'e verilen dil bilgisi.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Bilgi {
    pub kod: String,
    /// "sistem" | dil kodu
    pub secim: String,
    /// Sistem dili (Apple kuralı; menüdeki "Sistem dili (X)" ile aynı kaynak). JS "sistem" seçiminde bunu kullanır.
    pub sistem: String,
}

/// Dil bilgisi; `secim`: yedeklenmiş elle seçim (None = sistem).
pub fn bilgi(secim: Option<String>) -> Bilgi {
    Bilgi {
        kod: kod(),
        secim: secim.unwrap_or_else(|| "sistem".into()),
        sistem: sistem_kodu(),
    }
}

/// Rust'taki dil, yedeklenmiş elle seçim ve sistem dili.
#[tauri::command]
pub fn dil_oku<R: Runtime>(app: AppHandle<R>) -> Bilgi {
    let secim = secim_dosyasi(&app).as_deref().and_then(secim_oku);
    bilgi(secim)
}

/// JS'in kararı: `kod` görünen dil, `secim` "sistem" ya da elle seçilen dil. Seçim yedeklenir, dil
/// değiştiyse menü yeniden kurulur.
#[tauri::command]
pub fn dil_ayarla<R: Runtime>(app: AppHandle<R>, kod: String, secim: String) -> Result<(), String> {
    if !destekli(&kod) {
        return Err(metin("rust.dil_desteklenmiyor", &[("kod", &kod)]));
    }
    let elle = match secim.as_str() {
        "sistem" => None,
        s if destekli(s) => Some(s),
        s => return Err(metin("rust.dil_desteklenmiyor", &[("kod", s)])),
    };
    if let Some(d) = secim_dosyasi(&app) {
        if secim_oku(&d).as_deref() != elle {
            secim_yaz(&d, elle)
                .map_err(|e| metin("rust.dil_yazilamadi", &[("hata", &e.to_string())]))?;
        }
    }
    if ayarla(&kod, elle) {
        crate::menu::yenile(&app);
    }
    Ok(())
}

#[cfg(test)]
mod testler {
    use super::*;

    /// ön betik sistem dilini JSON kaçışıyla taşır (kusurlu kod da betiği bozmaz).
    #[test]
    fn baslangic_betigi_sistem_dilini_kacislayarak_tasir() {
        assert_eq!(
            baslangic_betigi_kod("tr"),
            "Object.defineProperty(window,'__KC_DIL__',{value:Object.freeze({\"sistem\":\"tr\"}),writable:false,configurable:false});"
        );
        let kotu = baslangic_betigi_kod("x\"});alert(1);//</script>");
        assert!(
            kotu.contains(r#""sistem":"x\"});alert(1);//</script>""#),
            "{kotu}"
        );
        assert_eq!(baslangic_betigi(), baslangic_betigi_kod(&sistem_kodu()));
        assert!(destekli(&sistem_kodu()));
    }

    #[test]
    fn sozlukler_gomuldu_en_once_tr_var() {
        let d = diller();
        assert_eq!(d.first().map(String::as_str), Some("en"), "{d:?}");
        assert!(d.iter().any(|k| k == "tr"), "{d:?}");
        assert_eq!(ad("en"), "English");
        assert_eq!(ad("tr"), "Türkçe");
        // derlemede gömülen dosya sayısı = app/i18n/*.js sayısı (yeni dil kendiliğinden gelir)
        let klasor = Path::new(env!("CARGO_MANIFEST_DIR")).join("../app/i18n");
        let n = fs::read_dir(klasor)
            .unwrap()
            .filter(|g| {
                g.as_ref()
                    .is_ok_and(|g| g.file_name().to_string_lossy().ends_with(".js"))
            })
            .count();
        assert_eq!(SOZLUK_DOSYALARI.len(), n);
        assert_eq!(sozlukler().len(), n, "her sözlük ayrıştırıldı");
    }

    #[test]
    fn metin_parametre_cogul_ve_eksik_anahtar() {
        assert_eq!(metin_dilde("tr", "menu.dosya", &[]), "Dosya");
        assert_eq!(metin_dilde("en", "menu.dosya", &[]), "File");
        assert_eq!(
            metin_dilde("en", "rust.desteklenmeyen", &[("ad", "a.txt")]),
            "unsupported file: a.txt"
        );
        assert_eq!(
            metin_dilde("tr", "rust.desteklenmeyen", &[("ad", "a.txt")]),
            "desteklenmeyen dosya: a.txt"
        );
        // eksik anahtar: bilinmeyen dil → en; hiçbir dilde yok → anahtar
        assert_eq!(metin_dilde("xx", "menu.dosya", &[]), "File");
        assert_eq!(
            metin_dilde("tr", "yok.boyle.anahtar", &[]),
            "yok.boyle.anahtar"
        );
        assert_eq!(
            metin_dilde("tr", "_ad", &[]),
            "_ad",
            "üst veri metin değildir"
        );
        // tekil/çoğul (en'de nesne, tr'de tek biçim)
        assert_eq!(
            metin_dilde("en", "duzenle.secildi", &[("n", "1")]),
            "1 page selected."
        );
        assert_eq!(
            metin_dilde("en", "duzenle.secildi", &[("n", "3")]),
            "3 pages selected."
        );
        assert_eq!(
            metin_dilde("tr", "duzenle.secildi", &[("n", "3")]),
            "3 sayfa seçildi."
        );
    }

    #[test]
    fn sistem_dili_apple_kurali() {
        let l = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(sistem_dili(&l(&["tr-TR", "en-US"])), "tr");
        assert_eq!(sistem_dili(&l(&["TR"])), "tr");
        assert_eq!(sistem_dili(&l(&["tr_TR"])), "tr");
        assert_eq!(sistem_dili(&l(&["en-GB", "tr-TR"])), "en");
        assert_eq!(
            sistem_dili(&l(&["de-DE", "tr-TR"])),
            "tr",
            "Apple kuralı: listede desteklenen ilk dil"
        );
        assert_eq!(sistem_dili(&l(&["de-DE", "fr-FR"])), "en");
        assert_eq!(sistem_dili(&l(&[])), "en");
        assert_eq!(sistem_dili(&l(&["", "tr"])), "tr", "boş girdi atlanır");
        assert_eq!(sistem_dili(&l(&["tur"])), "en");
    }

    #[test]
    fn secim_dosyasi_gidis_donus_ve_kusurlu_girdi() {
        let d = std::env::temp_dir().join(format!("kc-dil-{}", uuid::Uuid::new_v4()));
        let y = d.join(SECIM_DOSYASI);
        assert_eq!(secim_oku(&y), None, "dosya yok");
        secim_yaz(&y, Some("tr")).unwrap();
        assert_eq!(secim_oku(&y).as_deref(), Some("tr"));
        for kotu in ["", "xx", "../tr", "tr tr", "TR"] {
            fs::write(&y, kotu).unwrap();
            assert_eq!(secim_oku(&y), None, "{kotu:?}");
        }
        fs::write(&y, " en \n").unwrap();
        assert_eq!(secim_oku(&y).as_deref(), Some("en"), "boşluk kırpılır");
        secim_yaz(&y, None).unwrap();
        assert!(!y.exists(), "sistem seçimi dosyayı siler");
        secim_yaz(&y, None).unwrap();
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn json_ayikla_kusurlu_sozluk() {
        assert!(json_ayikla("{}").is_err(), "işaret yok");
        assert!(json_ayikla("/*JSON*/{}").is_err(), "kapanış yok");
        assert!(json_ayikla("/*JSON*/[1]/*JSON*/").is_err(), "nesne değil");
        assert!(
            json_ayikla("/*JSON*/{\"a\":}/*JSON*/").is_err(),
            "bozuk JSON"
        );
        assert_eq!(
            json_ayikla("x(/*JSON*/{\"a\":\"b\"}/*JSON*/);").unwrap()["a"],
            "b"
        );
    }

    /// JS ile ortak vektörler (app/test/fixtures/i18n-vectors.json; i18n.test.js aynı dosyayı sınar).
    fn vektorler() -> Value {
        serde_json::from_str(include_str!("../../app/test/fixtures/i18n-vectors.json")).unwrap()
    }
    fn metinler(x: &Value) -> Vec<String> {
        x.as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn ortak_vektorler_apple_kurali() {
        let v = vektorler();
        let sistem = v["sistem_dili"].as_array().unwrap();
        assert!(sistem.len() >= 5);
        let hatali: Vec<String> = sistem
            .iter()
            .filter_map(|o| {
                let liste = metinler(&o["liste"]);
                let b = sistem_dili(&liste);
                (b != o["beklenen"].as_str().unwrap())
                    .then(|| format!("{liste:?} → {b} (beklenen {})", o["beklenen"]))
            })
            .collect();
        assert!(hatali.is_empty(), "{hatali:#?}");
    }

    #[test]
    fn ortak_vektorler_tek_gecisli_doldurma() {
        let v = vektorler();
        let doldur = v["doldur"].as_array().unwrap();
        assert!(!doldur.is_empty());
        let mut hatali = Vec::new();
        for o in doldur {
            let p: Vec<Vec<String>> = o["p"].as_array().unwrap().iter().map(metinler).collect();
            let p: Vec<(&str, &str)> = p.iter().map(|c| (c[0].as_str(), c[1].as_str())).collect();
            let m = metin_dilde(
                o["dil"].as_str().unwrap(),
                o["anahtar"].as_str().unwrap(),
                &p,
            );
            if m != o["beklenen"].as_str().unwrap() {
                hatali.push(format!("{p:?} → {m}"));
            }
        }
        assert!(hatali.is_empty(), "{hatali:#?}");
    }

    /// menüdeki "Sistem dili (X)" ve JS'e giden sistem dili aynı kaynaktan (`sistem_kodu`).
    #[test]
    fn sistem_dili_menu_ve_js_ayni_kaynak() {
        let b = bilgi(None);
        assert_eq!(b.secim, "sistem");
        assert_eq!(b.sistem, sistem_kodu());
        assert!(destekli(&b.sistem));
        assert_eq!(
            sistem_etiketi(),
            metin("menu.dil_sistem", &[("ad", &ad(&b.sistem))])
        );
        assert_eq!(bilgi(Some("tr".into())).secim, "tr");
        assert_eq!(
            metin_dilde("en", "menu.dil_sistem", &[("ad", "English")]),
            "System Language (English)",
            "menü Title Case"
        );
    }

    /// Rust kaynaklarında `metin("…")` / `metin_dilde(_, "…")` ile kullanılan her anahtar her sözlükte var.
    #[test]
    fn rust_anahtarlari_her_sozlukte_var() {
        let kaynaklar = [
            include_str!("i18n.rs"),
            include_str!("files.rs"),
            include_str!("menu.rs"),
            include_str!("backup.rs"),
            include_str!("recent.rs"),
            include_str!("epub_folder.rs"),
            include_str!("lib.rs"),
        ];
        let mut anahtarlar = std::collections::BTreeSet::new();
        for k in kaynaklar {
            // test modülünden önceki kısım (cfg(test) işlevler, ör. `kalip`, dahil)
            let govde = k
                .split("#[cfg(test)]\nmod testler")
                .next()
                .unwrap()
                .split("#[cfg(test)]\npub(crate) mod testler")
                .next()
                .unwrap();
            for parca in govde.split("metin(\"").skip(1) {
                anahtarlar.insert(parca.split('"').next().unwrap().to_string());
            }
        }
        assert!(
            anahtarlar.len() > 30,
            "anahtar taraması çalışıyor: {anahtarlar:?}"
        );
        for kod in diller() {
            let s = &sozlukler()[&kod];
            let eksik: Vec<_> = anahtarlar.iter().filter(|a| !s.contains_key(*a)).collect();
            assert!(eksik.is_empty(), "{kod} sözlüğünde eksik: {eksik:?}");
        }
    }
}
