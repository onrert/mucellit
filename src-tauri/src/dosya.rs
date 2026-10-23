//! Yerel Aç/Kaydet ve dosya okuma komutları, son açılanlar komutları (§4.3).
//!
//! Güvenlik ilkesi: **JS hiçbir zaman yol vermez.** Aç penceresi (ya da Dock/Finder'dan açma) seçilen yolu
//! Rust'taki oturum tablosuna koyar ve JS'e yalnız rastgele bir kimlik (uuid) döner; `dosya_oku` ve
//! `son_acilani_oku` yalnız tabloda/listede olan kimliği okur. Kaydetmede yolu yalnız kullanıcı Kaydet
//! penceresinde seçer; JS yalnız önerilen adı ve baytı verir.
//!
//! Klasör paketi EPUB (Apple Kitaplar) seçilirse `epub_klasor::zip_uret` bellekte EPUB ZIP'i üretir; JS onu
//! sıradan bir `.epub` olarak alır (gerekçe: JS'in EPUB yolu değişmez, tek okuma ile tek IPC aktarımı).

use crate::dil::metin;
use crate::son_acilanlar::{self, AppleYerImi, Liste, OkumaHatasi, Ozet, YerImi};
use crate::{epub_klasor, menu};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// Okunacak tek dosyanın üst sınırı (bellek ve IPC).
pub const EN_COK_DOSYA: u64 = 1 << 30;

// Kullanıcıya görünen metinler sözlükte (`crate::dil`): pencere başlıkları `dialog.*`, hatalar `rust.*`.

/// Oturumda açılmış bir dosya (yalnız Rust'ta).
#[derive(Debug, Clone)]
struct Oturum {
    yol: PathBuf,
}

/// JS'e dönen açılış bilgisi (yol yok).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Acilan {
    pub kimlik: String,
    pub ad: String,
    /// "pdf" | "epub" | "json"
    pub tur: String,
}

/// Kaydedilen dosya: kullanıcıya gösterilecek ad ve klasör.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Kaydedilen {
    pub ad: String,
    pub yol: String,
}

/// Uygulama durumu (`tauri::Builder::manage`).
#[derive(Default)]
pub struct Durum {
    oturum: Mutex<HashMap<String, Oturum>>,
    /// Son açılanlar; ilk kullanımda dosyadan yüklenir.
    son: Mutex<Option<Liste>>,
    /// Webview hazır olmadan gelen dış açılışlar (Dock'a bırakma, Finder "Birlikte Aç").
    bekleyen: Mutex<Vec<Acilan>>,
}

impl Durum {
    /// Oturum tablosuna ekler, kimliği döner.
    fn tabloya_ekle(&self, yol: PathBuf) -> String {
        let kimlik = uuid::Uuid::new_v4().to_string();
        self.oturum
            .lock()
            .expect("oturum kilidi")
            .insert(kimlik.clone(), Oturum { yol });
        kimlik
    }

    /// Kimliğin yolu; kimlik **tek kullanımlıktır**: alınınca tablodan silinir, tablo süreç boyunca
    /// büyümez. Bilinmeyen/geçersiz kimlik (keyfi yol dahil) reddedilir. Son açılanlar bu tabloyu
    /// kullanmaz (kalıcı kimlik `son_acilanlar::Kayit`).
    fn tablodan_al(&self, kimlik: &str) -> Result<PathBuf, String> {
        if uuid::Uuid::parse_str(kimlik).is_err() {
            return Err(bilinmeyen());
        }
        self.oturum
            .lock()
            .expect("oturum kilidi")
            .remove(kimlik)
            .map(|o| o.yol)
            .ok_or_else(bilinmeyen)
    }

    /// Son açılanlar listesi üzerinde işlem (gerekirse dosyadan yükler).
    fn son_ile<R: Runtime, T>(&self, app: &AppHandle<R>, f: impl FnOnce(&mut Liste) -> T) -> T {
        self.son_ile_yukleyerek(|| son_yukle(app), f)
    }

    /// `son_ile`; liste henüz yüklenmediyse `yukle` ile yüklenir (testte uygulama tutamacı gerekmez).
    fn son_ile_yukleyerek<T>(
        &self,
        yukle: impl FnOnce() -> Liste,
        f: impl FnOnce(&mut Liste) -> T,
    ) -> T {
        let mut kilit = self.son.lock().expect("son açılanlar kilidi");
        f(kilit.get_or_insert_with(yukle))
    }

    /// Menü için güncel özetler.
    pub fn son_ozetler<R: Runtime>(&self, app: &AppHandle<R>) -> Vec<Ozet> {
        self.son_ile(app, |l| l.ozetler())
    }
}

/// "BILINMEYEN:" kodlu hata (kod makine için sabit, açıklama şu anki dilde).
fn bilinmeyen() -> String {
    format!("BILINMEYEN: {}", metin("rust.bilinmeyen_kimlik", &[]))
}

fn simdi() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn son_dosyasi<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(son_acilanlar::DOSYA_ADI))
}

fn son_yukle<R: Runtime>(app: &AppHandle<R>) -> Liste {
    match son_dosyasi(app) {
        Some(y) => Liste::yukle(&y),
        None => Liste::default(),
    }
}

/// Listeyi diske yazar ve Son Açılanlar menüsünü yeniden kurar.
fn son_kaydet_ve_menu<R: Runtime>(app: &AppHandle<R>, durum: &Durum) {
    if let Some(y) = son_dosyasi(app) {
        let yaz = durum.son_ile(app, |l| l.kaydet(&y));
        if let Err(e) = yaz {
            eprintln!("son açılanlar yazılamadı ({}): {e}", y.display());
        }
    }
    menu::yenile(app);
}

/// Dosyanın türü: uzantıdan; klasör ancak EPUB paketiyse "epub". Bilinmeyen → None.
pub fn tur_bul(yol: &Path) -> Option<&'static str> {
    let uzanti = yol.extension()?.to_string_lossy().to_lowercase();
    if yol.is_dir() {
        return (uzanti == "epub" && epub_klasor::epub_klasoru_mu(yol)).then_some("epub");
    }
    match uzanti.as_str() {
        "pdf" => Some("pdf"),
        "epub" => Some("epub"),
        "json" => Some("json"),
        _ => None,
    }
}

fn ad_bul(yol: &Path) -> String {
    yol.file_name()
        .map(|a| a.to_string_lossy().into_owned())
        .unwrap_or_else(|| metin("duzenle.belge", &[]))
}

/// Dosyanın içeriği: klasör paketi EPUB ise bellekte üretilen EPUB ZIP'i, değilse dosyanın baytları.
pub fn icerik_oku(yol: &Path) -> io::Result<Vec<u8>> {
    if yol.is_dir() {
        return epub_klasor::zip_uret(yol);
    }
    let boyut = fs::metadata(yol)?.len();
    if boyut > EN_COK_DOSYA {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            metin("rust.dosya_buyuk", &[("mb", &(boyut >> 20).to_string())]),
        ));
    }
    fs::read(yol)
}

/// Seçilen/bırakılan belgeyi oturuma ve (PDF/EPUB ise) son açılanlara ekler.
pub fn belge_kaydet<R: Runtime>(
    app: &AppHandle<R>,
    durum: &Durum,
    yol: PathBuf,
) -> Result<Acilan, String> {
    let tur = tur_bul(&yol)
        .ok_or_else(|| metin("rust.desteklenmeyen", &[("ad", &yol.display().to_string())]))?;
    let ad = ad_bul(&yol);
    if tur == "pdf" || tur == "epub" {
        // yer imi seçim anında, erişim canlıyken
        let kayit = son_acilanlar::kayit_kur(&AppleYerImi, &yol, &ad, tur, simdi());
        durum.son_ile(app, |l| l.ekle(kayit));
        son_kaydet_ve_menu(app, durum);
    }
    let kimlik = durum.tabloya_ekle(yol);
    Ok(Acilan {
        kimlik,
        ad,
        tur: tur.to_string(),
    })
}

/// Aç penceresi. `amac`: "belge" (PDF/EPUB, klasör paketi EPUB dahil) ya da "yedek" (JSON).
/// Vazgeçilirse `None`.
#[tauri::command]
pub async fn dosya_ac<R: Runtime>(
    app: AppHandle<R>,
    pencere: WebviewWindow<R>,
    durum: State<'_, Durum>,
    amac: String,
) -> Result<Option<Acilan>, String> {
    let (baslik, filtre, uzantilar): (String, String, &[&str]) = match amac.as_str() {
        // "com.apple.ibooks.epub": Apple Kitaplar'ın klasör paketi türü (com.apple.package'a uyar). NSOpenPanel
        // setAllowedFileTypes uzantıların yanında tür kimliği de kabul eder; paket böylece seçilebilir kalır.
        "belge" => (
            metin("dialog.ac_baslik", &[]),
            metin("dialog.filtre_belge", &[]),
            &["pdf", "epub", "com.apple.ibooks.epub"],
        ),
        "yedek" => (
            metin("dialog.yedek_baslik", &[]),
            metin("dialog.filtre_yedek", &[]),
            &["json"],
        ),
        _ => return Err(metin("rust.bilinmeyen_amac", &[("amac", &amac)])),
    };
    let secim = app
        .dialog()
        .file()
        .set_parent(&pencere)
        .set_title(&baslik)
        .add_filter(&filtre, uzantilar)
        .blocking_pick_file();
    let Some(secim) = secim else {
        return Ok(None);
    };
    let yol = secim.into_path().map_err(|e| e.to_string())?;
    let tur =
        tur_bul(&yol).ok_or_else(|| metin("rust.desteklenmeyen", &[("ad", &ad_bul(&yol))]))?;
    match (amac.as_str(), tur) {
        ("belge", "pdf" | "epub") => belge_kaydet(&app, &durum, yol).map(Some),
        ("yedek", "json") => Ok(Some(Acilan {
            ad: ad_bul(&yol),
            kimlik: durum.tabloya_ekle(yol),
            tur: tur.into(),
        })),
        _ => Err(metin("rust.pencerede_acilamaz", &[("tur", tur)])),
    }
}

/// Oturumda açılmış dosyanın baytları (ham ArrayBuffer). Yalnız kimlik; keyfi yol yok.
#[tauri::command]
pub async fn dosya_oku(durum: State<'_, Durum>, kimlik: String) -> Result<Response, String> {
    let yol = durum.tablodan_al(&kimlik)?;
    icerik_oku(&yol)
        .map(Response::new)
        .map_err(|e| metin("rust.okunamadi", &[("hata", &e.to_string())]))
}

/// Son açılanlar (en yeni başta; yol ve yer imi verilmez).
#[tauri::command]
pub async fn son_acilanlar<R: Runtime>(
    app: AppHandle<R>,
    durum: State<'_, Durum>,
) -> Result<Vec<Ozet>, String> {
    Ok(durum.son_ozetler(&app))
}

/// Son açılan kaydın baytları (yer imini çöz → oku → erişimi bırak). Yalnız kimlik; keyfi yol yok.
/// Okunamayan kayıt listeden çıkar; hata metni "BULUNAMADI:" / "ERISIM:" / "BILINMEYEN:" ile başlar.
#[tauri::command]
pub async fn son_acilani_oku<R: Runtime>(
    app: AppHandle<R>,
    durum: State<'_, Durum>,
    kimlik: String,
) -> Result<Response, String> {
    let sonuc = son_kaydi_oku(
        &durum,
        || son_yukle(&app),
        &AppleYerImi,
        &kimlik,
        simdi(),
        &icerik_oku,
    );
    match sonuc {
        Ok(bayt) => {
            son_kaydet_ve_menu(&app, &durum);
            Ok(Response::new(bayt))
        }
        Err(OkumaHatasi::Bilinmeyen) => Err(OkumaHatasi::Bilinmeyen.to_string()),
        Err(e) => {
            eprintln!("son açılan okunamadı ({kimlik}): {e}");
            if e.kalici_silinir() {
                son_kaydet_ve_menu(&app, &durum);
            }
            Err(e.to_string())
        }
    }
}

/// Son açılan kaydı okur ve listeyi günceller: kayıt kilitle **kopyalanır**, kilit bırakılır, okuma
/// (yer imi çözme + büyük EPUB) kilitsiz yapılır, sonuç yeniden kilitle işlenir. Böylece ana iş parçacığı
/// (menü kurma, Dock'tan açma, Menüyü Temizle) okuma boyunca beklemez.
pub fn son_kaydi_oku(
    durum: &Durum,
    yukle: impl FnOnce() -> Liste,
    yi: &dyn YerImi,
    kimlik: &str,
    tarih: u64,
    icerik: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
) -> Result<Vec<u8>, OkumaHatasi> {
    let kayit = durum.son_ile_yukleyerek(yukle, |l| son_acilanlar::kaydi_al(l, kimlik))?;
    let sonuc = son_acilanlar::kaydi_oku(&kayit, yi, icerik);
    durum
        .son_ile_yukleyerek(Liste::default, |l| {
            son_acilanlar::sonucu_isle(l, &kayit, tarih, sonuc)
        })
        .map(|(b, _)| b)
}

/// Son açılanları temizler (Dosya > Son Açılanlar > Menüyü Temizle).
pub fn son_acilanlari_temizle<R: Runtime>(app: &AppHandle<R>) {
    let durum = app.state::<Durum>();
    durum.son_ile(app, |l| l.kayitlar.clear());
    son_kaydet_ve_menu(app, &durum);
}

/// Webview hazır olmadan gelen dış açılışları verir ve kuyruğu boşaltır.
#[tauri::command]
pub async fn bekleyen_acilanlar(durum: State<'_, Durum>) -> Result<Vec<Acilan>, String> {
    Ok(std::mem::take(
        &mut *durum.bekleyen.lock().expect("bekleyen kilidi"),
    ))
}

/// Dock'a bırakılan / Finder'dan "Birlikte Aç" ile gelen dosyalar (`RunEvent::Opened`). Desteklenen her
/// belge oturuma ve son açılanlara eklenir, kuyruğa konur, webview'e `dosya-acildi` olayı gider (webview
/// henüz dinlemiyorsa açılışta `bekleyen_acilanlar` ile alır).
pub fn disaridan_acildi<R: Runtime>(app: &AppHandle<R>, yollar: Vec<PathBuf>) {
    let durum = app.state::<Durum>();
    let mut eklendi = false;
    for yol in yollar {
        match tur_bul(&yol) {
            Some("pdf" | "epub") => match belge_kaydet(app, &durum, yol) {
                Ok(a) => {
                    durum.bekleyen.lock().expect("bekleyen kilidi").push(a);
                    eklendi = true;
                }
                Err(e) => eprintln!("dışarıdan açılamadı: {e}"),
            },
            _ => eprintln!("dışarıdan açılan desteklenmeyen dosya: {}", yol.display()),
        }
    }
    if eklendi {
        if let Err(e) = app.emit("dosya-acildi", ()) {
            eprintln!("dosya-acildi olayı iletilemedi: {e}");
        }
    }
}

/// Sandbox'ta `HOME` uygulama kabıdır (`/Users/<k>/Library/Containers/<kimlik>/Data`); kullanıcının asıl ev
/// klasörü onun önekidir. Kap dışındaysa olduğu gibi.
pub fn gercek_ev(ev: &Path) -> PathBuf {
    let parcalar: Vec<_> = ev.components().collect();
    let n = parcalar.len();
    if n >= 4
        && parcalar[n - 1].as_os_str() == "Data"
        && parcalar[n - 3].as_os_str() == "Containers"
        && parcalar[n - 4].as_os_str() == "Library"
    {
        return parcalar[..n - 4].iter().collect();
    }
    ev.to_path_buf()
}

/// Kaydet penceresinin açılacağı klasör: son kaydedilen klasör (hâlâ klasörse), yoksa kullanıcının
/// asıl Belgeler klasörü (`<ev>/Documents`), o da yoksa `None` (sistem öntanımlısı). Kaynak dosyanın
/// klasörü (macOS'un son panel klasörü: repo, Apple Kitaplar kabı) önerilmez. L5: yalnız mutlak yollar
/// (göreli yol sürecin çalışma klasörüne göre çözülürdü).
pub fn kayit_klasoru_sec(son: Option<&Path>, ev: Option<&Path>) -> Option<PathBuf> {
    if let Some(s) = son.filter(|s| s.is_absolute() && s.is_dir()) {
        return Some(s.to_path_buf());
    }
    let belgeler = ev.filter(|e| e.is_absolute())?.join("Documents");
    belgeler.is_dir().then_some(belgeler)
}

/// Kullanıcının asıl ev klasörü (`HOME`'dan, sandbox kabı soyulmuş). L5: `HOME` yoksa, boşsa ya da
/// göreliyse `None` (göreli "Documents" önerilmez).
pub fn ev_bul(home: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let ev = Path::new(home?);
    ev.is_absolute().then(|| gercek_ev(ev))
}

/// Son kaydedilen klasörün tutulduğu dosya (`app_data_dir` içinde).
pub const KAYIT_KLASORU_DOSYASI: &str = "son-kayit-klasoru.txt";

/// Son kaydedilen klasörü okur (yoksa/boşsa `None`).
pub fn son_kayit_klasoru_oku(dosya: &Path) -> Option<PathBuf> {
    let metin = fs::read_to_string(dosya).ok()?;
    let metin = metin.trim_end_matches('\n');
    (!metin.is_empty()).then(|| PathBuf::from(metin))
}

fn kayit_klasoru_dosyasi<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(KAYIT_KLASORU_DOSYASI))
}

/// Dosya adının bayt sınırı (APFS/HFS+: 255 bayt UTF-8).
pub const AD_EN_COK_BAYT: usize = 255;

/// `s`'yi en çok `n` bayta, UTF-8 karakter sınırında kırpar.
pub fn bayta_kirp(s: &str, n: usize) -> &str {
    if s.len() <= n {
        return s;
    }
    let mut i = n;
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    &s[..i]
}

/// JS'in `encodeURIComponent` ile kodladığı önerilen adı çözer ve dosya adı olarak güvenli kılar:
/// yol ayraçları ve denetim karakterleri atılır, baştaki noktalar kalkar, uzantı `.pdf`/`.json` olur, ad
/// uzantısıyla birlikte en çok 255 **bayt** (D5; UTF-8 karakter sınırında kırpılır). Boş kalırsa öntanımlı ad.
pub fn guvenli_ad(kodlu: &str, uzanti: &str) -> String {
    let mut bayt = Vec::with_capacity(kodlu.len());
    let b = kodlu.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let onalti = |c: u8| (c as char).to_digit(16);
            if let (Some(y), Some(a)) = (onalti(b[i + 1]), onalti(b[i + 2])) {
                bayt.push((y * 16 + a) as u8);
                i += 3;
                continue;
            }
        }
        bayt.push(b[i]);
        i += 1;
    }
    let ham = String::from_utf8_lossy(&bayt);
    let temiz: String = ham
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':') || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let temiz = temiz.trim().trim_start_matches('.').trim();
    let son = format!(".{uzanti}");
    // Uzantı zaten varsa (büyük/küçük harf korunur) gövdeden ayrılır; kırpma yalnız gövdeye uygulanır.
    let kesim = temiz.len().saturating_sub(son.len());
    let (govde, uz) = if temiz.len() >= son.len()
        && temiz.is_char_boundary(kesim)
        && temiz[kesim..].eq_ignore_ascii_case(&son)
    {
        (&temiz[..kesim], &temiz[kesim..])
    } else {
        (temiz, son.as_str())
    };
    let govde = bayta_kirp(govde, AD_EN_COK_BAYT - uz.len());
    if govde.trim().is_empty() {
        return format!("mucellit{son}");
    }
    format!("{govde}{uz}")
}

/// Kaydet penceresi + yazma. Gövde ham bayt (`invoke('dosya_kaydet', bytes, { headers })`); başlıklar
/// `x-ad` (encodeURIComponent ile önerilen ad) ve `x-tur` ("pdf" | "json"). Vazgeçilirse `None`.
#[tauri::command]
pub async fn dosya_kaydet<R: Runtime>(
    app: AppHandle<R>,
    pencere: WebviewWindow<R>,
    request: Request<'_>,
) -> Result<Option<Kaydedilen>, String> {
    let InvokeBody::Raw(bayt) = request.body() else {
        return Err(metin("rust.ham_bayt", &[]));
    };
    let baslik = |ad: &str| {
        request
            .headers()
            .get(ad)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string()
    };
    let tur = baslik("x-tur");
    let (filtre, uzanti) = match tur.as_str() {
        "pdf" => (metin("dialog.filtre_pdf", &[]), "pdf"),
        "json" => (metin("dialog.filtre_yedek", &[]), "json"),
        _ => return Err(metin("rust.bilinmeyen_tur", &[("tur", &tur)])),
    };
    let ad = guvenli_ad(&baslik("x-ad"), uzanti);
    let klasor_dosyasi = kayit_klasoru_dosyasi(&app);
    let ev = ev_bul(std::env::var_os("HOME").as_deref());
    let son = klasor_dosyasi.as_deref().and_then(son_kayit_klasoru_oku);
    let mut pencere_kur = app
        .dialog()
        .file()
        .set_parent(&pencere)
        .set_title(metin("dialog.kaydet_baslik", &[]))
        .set_file_name(&ad)
        .add_filter(&filtre, &[uzanti]);
    if let Some(k) = kayit_klasoru_sec(son.as_deref(), ev.as_deref()) {
        pencere_kur = pencere_kur.set_directory(k);
    }
    let Some(secim) = pencere_kur.blocking_save_file() else {
        return Ok(None);
    };
    let yol = secim.into_path().map_err(|e| e.to_string())?;
    fs::write(&yol, bayt).map_err(|e| metin("rust.yazilamadi", &[("hata", &e.to_string())]))?;
    if let (Some(d), Some(k)) = (klasor_dosyasi, yol.parent()) {
        let mut satir = k.as_os_str().to_owned();
        satir.push("\n");
        if let Err(e) = son_acilanlar::atomik_yaz(&d, satir.as_encoded_bytes()) {
            eprintln!("son kayıt klasörü yazılamadı: {e}");
        }
    }
    Ok(Some(Kaydedilen {
        ad: ad_bul(&yol),
        yol: yol.to_string_lossy().into_owned(),
    }))
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn tablo_bilinmeyen_ve_keyfi_yol_kimligini_reddeder() {
        let d = Durum::default();
        let gercek = std::env::temp_dir().join(format!("kc-dosya-{}.pdf", uuid::Uuid::new_v4()));
        fs::write(&gercek, b"%PDF").unwrap();
        let kimlik = d.tabloya_ekle(gercek.clone());
        let ikinci = d.tabloya_ekle(gercek.clone());
        assert_eq!(d.tablodan_al(&ikinci).unwrap(), gercek);
        for kotu in [
            "",
            gercek.to_str().unwrap(),
            "/etc/hosts",
            "../../../etc/passwd",
            "file:///etc/hosts",
            "~/Library",
            &uuid::Uuid::new_v4().to_string(),
            &kimlik.to_uppercase().replace('-', ""), // biçim farkı: aynı uuid ama farklı yazım tabloda yok
        ] {
            assert_eq!(d.tablodan_al(kotu).unwrap_err(), bilinmeyen(), "{kotu}");
        }
        fs::remove_file(&gercek).unwrap();
    }

    /// Komut imzaları: okuma komutları yalnız `kimlik: String` alır (yol, PathBuf, Path parametresi yok).
    #[test]
    fn okuma_komutlari_js_ten_yol_almaz() {
        let kaynak = include_str!("dosya.rs");
        for komut in ["pub async fn dosya_oku", "pub async fn son_acilani_oku"] {
            let bas = kaynak.find(komut).unwrap_or_else(|| panic!("{komut} yok"));
            let imza = &kaynak[bas..bas + kaynak[bas..].find('{').unwrap()];
            // tür parametrelerinin içindeki virgüller (State<'_, Durum>) bölmeyi bozmasın
            let mut derinlik = 0;
            let duz: String = imza
                .chars()
                .filter(|c| {
                    match c {
                        '<' => derinlik += 1,
                        '>' if derinlik > 0 => {
                            derinlik -= 1;
                            return false;
                        }
                        _ => {}
                    }
                    derinlik == 0
                })
                .collect();
            let imza = duz.as_str();
            let params: Vec<&str> = imza[imza.find('(').unwrap() + 1..imza.rfind(')').unwrap()]
                .split(',')
                .map(str::trim)
                .filter(|p| !p.is_empty() && !p.starts_with("->"))
                .collect();
            let js_params: Vec<&&str> = params
                .iter()
                .filter(|p| !p.starts_with("app:") && !p.starts_with("durum:"))
                .collect();
            assert_eq!(js_params, [&"kimlik: String"], "{komut}: {params:?}");
        }
        for komut in ["dosya_ac", "dosya_kaydet"] {
            let bas = kaynak.find(&format!("pub async fn {komut}")).unwrap();
            let imza = &kaynak[bas..bas + kaynak[bas..].find('{').unwrap()];
            assert!(
                !imza.contains("PathBuf") && !imza.contains("Path") && !imza.contains("yol"),
                "{komut}: {imza}"
            );
        }
    }

    #[test]
    fn tur_bul_uzanti_ve_klasor_paketi() {
        let d = std::env::temp_dir().join(format!("kc-tur-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(d.join("Kitap.epub/META-INF")).unwrap();
        fs::write(d.join("Kitap.epub/META-INF/container.xml"), "<c/>").unwrap();
        fs::create_dir_all(d.join("Bos.epub")).unwrap();
        fs::create_dir_all(d.join("klasor.pdf")).unwrap();
        for (ad, beklenen) in [
            ("a.pdf", Some("pdf")),
            ("A.PDF", Some("pdf")),
            ("b.epub", Some("epub")),
            ("c.json", Some("json")),
            ("d.txt", None),
            ("uzantisiz", None),
        ] {
            fs::write(d.join(ad), b"x").unwrap();
            assert_eq!(tur_bul(&d.join(ad)), beklenen, "{ad}");
        }
        assert_eq!(tur_bul(&d.join("Kitap.epub")), Some("epub"));
        assert_eq!(
            tur_bul(&d.join("Bos.epub")),
            None,
            "container.xml'siz klasör"
        );
        assert_eq!(tur_bul(&d.join("klasor.pdf")), None, "PDF adlı klasör");
        // klasör paketi içeriği EPUB ZIP olarak okunur
        let z = icerik_oku(&d.join("Kitap.epub")).unwrap();
        assert_eq!(&z[0..4], b"PK\x03\x04");
        assert_eq!(icerik_oku(&d.join("a.pdf")).unwrap(), b"x");
        assert!(icerik_oku(&d.join("yok.pdf")).is_err());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn guvenli_ad_kusurlu_girdiler() {
        let kodla = |s: &str| {
            s.bytes()
                .map(|b| {
                    if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                        (b as char).to_string()
                    } else {
                        format!("%{b:02X}")
                    }
                })
                .collect::<String>()
        };
        assert_eq!(
            guvenli_ad(&kodla("Mavi Pusula-dizilmis.pdf"), "pdf"),
            "Mavi Pusula-dizilmis.pdf"
        );
        assert_eq!(
            guvenli_ad(&kodla("Çğüşİ ılık-önler.pdf"), "pdf"),
            "Çğüşİ ılık-önler.pdf"
        );
        assert_eq!(
            guvenli_ad(&kodla("../../etc/passwd"), "pdf"),
            "-..-etc-passwd.pdf"
        );
        assert_eq!(guvenli_ad(&kodla("a/b\\c:d.pdf"), "pdf"), "a-b-c-d.pdf");
        assert_eq!(guvenli_ad(&kodla(".gizli.pdf"), "pdf"), "gizli.pdf");
        assert_eq!(guvenli_ad(&kodla("yedek"), "json"), "yedek.json");
        assert_eq!(guvenli_ad(&kodla("rapor.PDF"), "pdf"), "rapor.PDF");
        assert_eq!(guvenli_ad("", "pdf"), "mucellit.pdf");
        assert_eq!(guvenli_ad("%2E%2E", "pdf"), "mucellit.pdf");
        assert_eq!(guvenli_ad("   ", "json"), "mucellit.json");
        assert_eq!(guvenli_ad("a%0Ab%00c", "pdf"), "a-b-c.pdf");
        assert_eq!(
            guvenli_ad("%ZZ%4", "pdf"),
            "%ZZ%4.pdf",
            "bozuk % kodu olduğu gibi"
        );
        assert_eq!(guvenli_ad("%C3", "pdf"), "\u{FFFD}.pdf", "yarım UTF-8");
    }

    /// D5: ad bayta göre kırpılır (APFS: en çok 255 bayt), UTF-8 karakter sınırında; uzantı korunur.
    #[test]
    fn guvenli_ad_bayt_siniri_utf8_sinirinda() {
        for (girdi, uz) in [
            ("ç".repeat(400), "pdf"),
            ("a".repeat(400), "pdf"),
            ("🙂".repeat(100), "json"),
            (format!("{}.pdf", "ğ".repeat(200)), "pdf"),
            (format!("x{}", "ş".repeat(127)), "pdf"),
        ] {
            let ad = guvenli_ad(&girdi, uz);
            assert!(ad.len() <= 255, "{} bayt: {ad}", ad.len());
            assert!(ad.ends_with(&format!(".{uz}")), "{ad}");
            assert!(!ad.contains('\u{FFFD}'), "yarım karakter: {ad}");
            let govde = &ad[..ad.len() - uz.len() - 1];
            assert!(
                girdi.starts_with(govde),
                "gövde girdinin öneki olmalı: {ad}"
            );
        }
        assert_eq!(
            guvenli_ad(&"a".repeat(400), "pdf").len(),
            255,
            "sınır dolu kullanılır"
        );
        let kisa = "Mavi Pusula-dizilmis.pdf";
        assert_eq!(guvenli_ad(kisa, "pdf"), kisa, "kısa ad değişmez");
    }

    /// D6: oturum kimliği tek kullanımlık (okununca tablodan silinir; tablo büyümez).
    #[test]
    fn oturum_kimligi_tek_kullanimlik() {
        let d = Durum::default();
        let p = std::env::temp_dir().join("kc-tek.pdf");
        let k = d.tabloya_ekle(p.clone());
        assert_eq!(d.tablodan_al(&k).unwrap(), p);
        assert_eq!(d.tablodan_al(&k).unwrap_err(), bilinmeyen(), "ikinci okuma");
        assert!(d.oturum.lock().unwrap().is_empty(), "tablo boşaldı");
    }

    /// O3: son açılan okunurken `son` kilidi TUTULMAZ (ana iş parçacığı menüyü kurarken beklemesin); okuma
    /// bitince liste kilitle güncellenir.
    #[test]
    fn son_acilani_okurken_kilit_tutulmaz() {
        let d = Durum::default();
        let dosya = std::env::temp_dir().join(format!("kc-kilit-{}.pdf", uuid::Uuid::new_v4()));
        fs::write(&dosya, b"%PDF-kilit").unwrap();
        let mut liste = Liste::default();
        let kayit = son_acilanlar::Kayit {
            kimlik: uuid::Uuid::new_v4().to_string(),
            ad: "kilit.pdf".into(),
            tur: "pdf".into(),
            tarih: 1,
            yol: dosya.to_string_lossy().into_owned(),
            yerimi: None,
        };
        let kimlik = kayit.kimlik.clone();
        liste.ekle(kayit);
        liste.ekle(son_acilanlar::Kayit {
            kimlik: uuid::Uuid::new_v4().to_string(),
            yol: "/baska.pdf".into(),
            ..liste.kayitlar[0].clone()
        });
        let kilit_bostu = std::cell::Cell::new(None);
        let oku = |p: &Path| {
            kilit_bostu.set(Some(d.son.try_lock().is_ok()));
            fs::read(p)
        };
        let bayt = son_kaydi_oku(&d, || liste, &AppleYerImi, &kimlik, 77, &oku).unwrap();
        fs::remove_file(&dosya).ok();
        assert_eq!(bayt, b"%PDF-kilit");
        assert_eq!(
            kilit_bostu.get(),
            Some(true),
            "okuma sırasında son kilidi boş olmalı"
        );
        let l = d.son.lock().unwrap();
        let l = l.as_ref().unwrap();
        assert_eq!(l.kayitlar[0].kimlik, kimlik, "okunan başa alındı");
        assert_eq!(l.kayitlar[0].tarih, 77);
    }

    /// D12: Kaydet penceresi son kaydedilen klasörde açılır; yoksa (ya da silindiyse) kullanıcının asıl
    /// Belgeler klasöründe; o da yoksa sistem öntanımlısı.
    #[test]
    fn kayit_klasoru_son_kaydedilen_yoksa_belgeler() {
        let ev = std::env::temp_dir().join(format!("kc-ev-{}", uuid::Uuid::new_v4()));
        let belgeler = ev.join("Documents");
        let son = ev.join("Kitaplar");
        fs::create_dir_all(&belgeler).unwrap();
        fs::create_dir_all(&son).unwrap();
        let e = Some(ev.as_path());
        assert_eq!(kayit_klasoru_sec(Some(&son), e), Some(son.clone()));
        assert_eq!(kayit_klasoru_sec(None, e), Some(belgeler.clone()));
        assert_eq!(
            kayit_klasoru_sec(Some(&ev.join("silindi")), e),
            Some(belgeler.clone()),
            "silinmiş son klasör"
        );
        let dosya = ev.join("dosya.pdf");
        fs::write(&dosya, b"x").unwrap();
        assert_eq!(
            kayit_klasoru_sec(Some(&dosya), e),
            Some(belgeler.clone()),
            "klasör değil"
        );
        fs::remove_dir_all(&belgeler).unwrap();
        assert_eq!(kayit_klasoru_sec(None, e), None, "Belgeler de yok");
        // son klasör dosyası: gidiş-dönüş, boş/eksik → None
        let kd = ev.join(KAYIT_KLASORU_DOSYASI);
        assert_eq!(son_kayit_klasoru_oku(&kd), None, "dosya yok");
        son_acilanlar::atomik_yaz(&kd, "/Users/x/Kitaplar ğ\n".as_bytes()).unwrap();
        assert_eq!(
            son_kayit_klasoru_oku(&kd),
            Some(PathBuf::from("/Users/x/Kitaplar ğ"))
        );
        fs::write(&kd, "").unwrap();
        assert_eq!(son_kayit_klasoru_oku(&kd), None, "boş");
        fs::remove_dir_all(&ev).unwrap();
        // sandbox kabı → asıl ev; kap dışı değişmez
        assert_eq!(
            gercek_ev(Path::new(
                "/Users/kullanici/Library/Containers/com.onurmert.kitapcilt/Data"
            )),
            PathBuf::from("/Users/kullanici")
        );
        assert_eq!(
            gercek_ev(Path::new("/Users/kullanici")),
            PathBuf::from("/Users/kullanici")
        );
        assert_eq!(
            gercek_ev(Path::new("/Users/kullanici/Library/Containers")),
            PathBuf::from("/Users/kullanici/Library/Containers"),
            "kap kimliği yok"
        );
    }
    /// L5: `HOME` yoksa, boşsa ya da göreliyse ev klasörü yok sayılır (göreli "Documents" önerilmez); son
    /// kaydedilen klasör de göreli olamaz (elle bozulmuş son-kayit-klasoru.txt).
    #[test]
    fn ev_yoksa_ya_da_goreliyse_goreli_klasor_onerilmez() {
        use std::ffi::OsStr;
        assert_eq!(ev_bul(None), None, "HOME yok");
        assert_eq!(ev_bul(Some(OsStr::new(""))), None, "HOME boş");
        assert_eq!(ev_bul(Some(OsStr::new("goreli/ev"))), None, "HOME göreli");
        assert_eq!(
            ev_bul(Some(OsStr::new(
                "/Users/kullanici/Library/Containers/com.onurmert.kitapcilt/Data"
            ))),
            Some(PathBuf::from("/Users/kullanici"))
        );
        assert_eq!(
            ev_bul(Some(OsStr::new("/Users/kullanici"))),
            Some(PathBuf::from("/Users/kullanici"))
        );
        // cargo test src-tauri/ klasöründe koşar: göreli "src" bir klasördür
        assert!(Path::new("src").is_dir());
        assert_eq!(
            kayit_klasoru_sec(Some(Path::new("src")), None),
            None,
            "göreli son klasör önerilmez"
        );
        assert_eq!(
            kayit_klasoru_sec(None, Some(Path::new(""))),
            None,
            "boş ev → göreli Documents yok"
        );
        assert_eq!(son_kayit_klasoru_oku(Path::new("/yok/dosya")), None);
    }
}
