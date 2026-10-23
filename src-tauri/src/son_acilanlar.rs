//! Son açılanlar: en çok 10 kayıt, en yeni başta, `app_data_dir/son-acilanlar.json`.
//!
//! macOS sandbox'ında uygulama yeniden açılınca kullanıcının daha önce seçtiği dosyaya erişimi yoktur;
//! erişim yalnız **güvenlik kapsamlı yer imiyle** geri gelir. Yer imi seçim anında (Aç penceresi, Dock'a
//! bırakma, Finder "Birlikte Aç": erişim o an canlıyken) oluşturulur. Okuma "çöz → erişimi başlat → oku →
//! erişimi bırak" sırasıyla ve **kısa ömürlü** yapılır (`apple_scoped_bookmarks::ScopedAccess` düşünce
//! `stopAccessingSecurityScopedResource`); açılışta hiçbir kayıt çözülmez. Yer imi bayatsa (dosya taşındı)
//! erişim canlıyken yeniden oluşturulur ve kaydedilir.
//!
//! Okunamayan kayıt: yalnız dosya gerçekten **yoksa** (`BULUNAMADI`) ya da kayıt geçersizse
//! (`GECERSIZ`: tür uymuyor, yer imi bozuk) listeden kalıcı çıkar. Erişim reddi (`ERISIM`), takılı olmayan
//! disk (`DISKYOK`: kayıtlı yol `/Volumes/<ad>/…` ve disk yok) ve geçici hata (`GECICI`) kaydı tutar.
//! Yer imi çözülemediğinde (macOS her durumda NSCocoaErrorDomain 4 "The file doesn't exist" veriyor; kilitli
//! klasörde de) ayrım kayıtlı yolun `lstat` sonucuyla yapılır; sandbox'ta `lstat` izinsiz yolda da çalışır
//! (var: VAR, yok: ENOENT; yalnız okuma EPERM).
//!
//! Apple dışı platformda (`Error::Unsupported`) yer imi yoktur, kayıt düz yolla okunur (Windows için hazır).
//! Yer imi işlemleri `YerImi` özelliğinin arkasında: testler sahte uygulamayla koşar (gerçek yer imi
//! imzalı + sandbox'lı süreç ister; bkz. elle sınama S11/S12).

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Listede tutulan en çok kayıt.
pub const EN_COK: usize = 10;
/// Kayıt dosyasının adı (`app_data_dir` içinde).
pub const DOSYA_ADI: &str = "son-acilanlar.json";

/// Bir son açılan kaydı. `yol` yalnız Rust tarafında kalır (JS'e `Ozet` gider).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kayit {
    /// Kalıcı kimlik (uuid v4); menü öğesi ve `son_acilani_oku` bununla çağrılır.
    pub kimlik: String,
    pub ad: String,
    /// "pdf" | "epub"
    pub tur: String,
    /// Son açılış (Unix saniye).
    pub tarih: u64,
    /// Seçildiği andaki yol: aynı dosyanın yeniden eklenmesini tanımak ve yer imi yoksa okumak için.
    pub yol: String,
    /// Güvenlik kapsamlı yer imi (base64). `None`: platform desteklemiyor ya da oluşturulamadı.
    #[serde(default)]
    pub yerimi: Option<String>,
}

/// JS'e verilen özet (yol ve yer imi verilmez).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Ozet {
    pub kimlik: String,
    pub ad: String,
    pub tur: String,
    pub tarih: u64,
}

impl From<&Kayit> for Ozet {
    fn from(k: &Kayit) -> Self {
        Ozet {
            kimlik: k.kimlik.clone(),
            ad: k.ad.clone(),
            tur: k.tur.clone(),
            tarih: k.tarih,
        }
    }
}

/// MRU listesi (saf veri yapısı; dosya ve yer imi işi dışarıda).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Liste {
    pub kayitlar: Vec<Kayit>,
}

impl Liste {
    /// Kaydı başa koyar. Aynı yol varsa eskisi çıkar (kimliği korunur: menü öğesi aynı kalır).
    /// En çok `EN_COK` kayıt kalır. Dönüş: başa konan kaydın kimliği.
    pub fn ekle(&mut self, mut yeni: Kayit) -> String {
        if let Some(i) = self.kayitlar.iter().position(|k| k.yol == yeni.yol) {
            let eski = self.kayitlar.remove(i);
            yeni.kimlik = eski.kimlik;
        }
        let kimlik = yeni.kimlik.clone();
        self.kayitlar.insert(0, yeni);
        self.kayitlar.truncate(EN_COK);
        kimlik
    }

    pub fn bul(&self, kimlik: &str) -> Option<&Kayit> {
        self.kayitlar.iter().find(|k| k.kimlik == kimlik)
    }

    /// Kaydı çıkarır; vardıysa true.
    pub fn unut(&mut self, kimlik: &str) -> bool {
        let once = self.kayitlar.len();
        self.kayitlar.retain(|k| k.kimlik != kimlik);
        once != self.kayitlar.len()
    }

    /// Kaydı başa alır (yeniden açıldı), tarihini ve isteğe bağlı yeni yer imini/yolunu yazar.
    pub fn one_al(
        &mut self,
        kimlik: &str,
        tarih: u64,
        yeni_yerimi: Option<String>,
        yeni_yol: Option<String>,
    ) {
        if let Some(i) = self.kayitlar.iter().position(|k| k.kimlik == kimlik) {
            let mut k = self.kayitlar.remove(i);
            k.tarih = tarih;
            if let Some(y) = yeni_yerimi {
                k.yerimi = Some(y);
            }
            if let Some(y) = yeni_yol {
                k.yol = y;
            }
            self.kayitlar.insert(0, k);
        }
    }

    pub fn ozetler(&self) -> Vec<Ozet> {
        self.kayitlar.iter().map(Ozet::from).collect()
    }

    /// Dosyadan okur. Yoksa, okunamıyorsa ya da bozuksa boş liste (uygulama açılışı hiçbir zaman bozulmaz).
    /// Geçersiz kayıtlar (kimliği uuid değil, türü bilinmiyor) atılır; fazlası kırpılır.
    pub fn yukle(yol: &Path) -> Liste {
        let mut l: Liste = fs::read(yol)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        l.kayitlar.retain(|k| {
            uuid::Uuid::parse_str(&k.kimlik).is_ok() && matches!(k.tur.as_str(), "pdf" | "epub")
        });
        l.kayitlar.truncate(EN_COK);
        l
    }

    /// Geçici dosyaya yazıp yeniden adlandırır (yarım yazılmış dosya kalmaz).
    pub fn kaydet(&self, yol: &Path) -> io::Result<()> {
        let json = serde_json::to_vec_pretty(self).map_err(io::Error::other)?;
        atomik_yaz(yol, &json)
    }
}

/// Geçici adın asıl ada eklediği bayt: "." + "." + uuid (36) + ".gecici" (7).
pub const GECICI_EK_BAYT: usize = 1 + 1 + 36 + 7;

/// `yol`'a geçici dosya + rename ile yazar; üst klasörü gerekirse oluşturur. Geçici dosyanın adı her yazımda
/// benzersizdir (eşzamanlı yazımlar birbirini ezmez) ve içerik rename'den önce diske eşitlenir.
/// Geçici ad `.<ad>.<uuid>.gecici`; `<ad>` 255 − 45 bayta kırpılır (O2, uzun adda ENAMETOOLONG).
pub fn atomik_yaz(yol: &Path, veri: &[u8]) -> io::Result<()> {
    use std::io::Write as _;
    let ust = yol.parent().filter(|u| !u.as_os_str().is_empty());
    if let Some(ust) = ust {
        fs::create_dir_all(ust)?;
    }
    let ad = yol
        .file_name()
        .map(|a| a.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ad = crate::dosya::bayta_kirp(&ad, crate::dosya::AD_EN_COK_BAYT - GECICI_EK_BAYT);
    let gecici = yol.with_file_name(format!(".{ad}.{}.gecici", uuid::Uuid::new_v4()));
    let sonuc = (|| {
        let mut f = fs::File::create(&gecici)?;
        f.write_all(veri)?;
        f.sync_all()?;
        fs::rename(&gecici, yol)
    })();
    if sonuc.is_err() {
        let _ = fs::remove_file(&gecici);
    } else if let Some(ust) = ust {
        // rename'in kendisi de kalıcı olsun (klasör girdisi); başarısızlık yazımı bozmaz.
        let _ = fs::File::open(ust).and_then(|k| k.sync_all());
    }
    sonuc
}

/// Yer imi okumasının sonucu.
pub struct Okunan {
    pub bayt: Vec<u8>,
    /// Çözülen (güncel) yol: dosya taşındıysa değişir.
    pub yol: PathBuf,
    /// Yer imi bayattı ve yeniden oluşturuldu: kaydedilecek yeni bayt.
    pub yeni_yerimi: Option<Vec<u8>>,
}

/// Okuma hatası; JS'e `KOD: mesaj` biçiminde gider (app/js/platform-tauri.js `sonAcilaniAc`).
#[derive(Debug, PartialEq, Eq)]
pub enum OkumaHatasi {
    /// Kimlik listede yok (ya da geçersiz kimlik). Keyfi yol da burada biter.
    Bilinmeyen,
    /// Dosya yok (silinmiş; taşınmışsa yer imi bulamadı). Kayıt kalıcı çıkar.
    Bulunamadi(String),
    /// Kayıt geçersiz (yolun türü kayıttakiyle uyuşmuyor, yer imi bozuk: L3). Kayıt kalıcı çıkar.
    Gecersiz(String),
    /// Sistem erişim vermedi (entitlement eksik, farklı imzalı derleme, izinsiz klasör). Kayıt durur.
    Erisim(String),
    /// Dosyanın bulunduğu disk takılı değil (mesaj: diskin adı). Kayıt durur.
    DiskYok(String),
    /// Başka/geçici okuma hatası (dosya yerinde). Kayıt durur.
    Gecici(String),
}

impl OkumaHatasi {
    /// Kayıt listeden kalıcı çıkarılır mı? Yalnız dosya yoksa ya da kayıt geçersizse.
    pub fn kalici_silinir(&self) -> bool {
        matches!(self, OkumaHatasi::Bulunamadi(_) | OkumaHatasi::Gecersiz(_))
    }
}

impl std::fmt::Display for OkumaHatasi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OkumaHatasi::Bilinmeyen => write!(
                f,
                "BILINMEYEN: {}",
                crate::dil::metin("rust.son_bilinmeyen", &[])
            ),
            OkumaHatasi::Bulunamadi(m) => write!(f, "BULUNAMADI: {m}"),
            OkumaHatasi::Gecersiz(m) => write!(f, "GECERSIZ: {m}"),
            OkumaHatasi::Erisim(m) => write!(f, "ERISIM: {m}"),
            OkumaHatasi::DiskYok(m) => write!(f, "DISKYOK: {m}"),
            OkumaHatasi::Gecici(m) => write!(f, "GECICI: {m}"),
        }
    }
}

/// Yer imi katmanının ham hatası; sınıflandırma (`siniflandir`) kayıtlı yolla yapılır.
#[derive(Debug)]
pub enum HamHata {
    /// Yer imi çözülemedi (Cocoa hata açıklaması).
    Cozulemedi(String),
    /// Yer imi çözüldü, sistem güvenlik kapsamlı erişimi vermedi.
    ErisimReddi(String),
    /// Erişim alındı, okuma başarısız.
    Okuma(io::Error),
}

/// Yer imi işlemleri (gerçek: `AppleYerImi`; testte sahte).
pub trait YerImi {
    /// Seçim anında (erişim canlıyken) yer imi oluşturur. `Ok(None)`: platform desteklemiyor.
    fn olustur(&self, yol: &Path) -> Result<Option<Vec<u8>>, String>;
    /// Yer imini çözer, erişimi başlatır, `oku` ile içeriği okur, bayatsa yeni yer imi oluşturur ve erişimi
    /// **bırakır** (dönmeden önce).
    fn eris_ve_oku(
        &self,
        yerimi: &[u8],
        oku: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
    ) -> Result<Okunan, HamHata>;
}

/// `apple-scoped-bookmarks` ile gerçek uygulama.
pub struct AppleYerImi;

impl YerImi for AppleYerImi {
    fn olustur(&self, yol: &Path) -> Result<Option<Vec<u8>>, String> {
        match apple_scoped_bookmarks::Bookmark::create(yol) {
            Ok(b) => Ok(Some(b.into_bytes())),
            Err(apple_scoped_bookmarks::Error::Unsupported) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn eris_ve_oku(
        &self,
        yerimi: &[u8],
        oku: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
    ) -> Result<Okunan, HamHata> {
        use apple_scoped_bookmarks::{Bookmark, Error};
        let erisim = match Bookmark::from_bytes(yerimi.to_vec()).resolve() {
            Ok(e) => e,
            Err(Error::AccessDenied(p)) => {
                return Err(HamHata::ErisimReddi(crate::dil::metin(
                    "rust.erisim_vermedi",
                    &[("yol", &p.display().to_string())],
                )))
            }
            Err(e) => return Err(HamHata::Cozulemedi(e.to_string())),
        };
        // `erisim` bu blok bitince düşer: stopAccessingSecurityScopedResource (kısa ömürlü erişim).
        let bayt = oku(erisim.path()).map_err(HamHata::Okuma)?;
        let yeni_yerimi = if erisim.is_stale() {
            Bookmark::create(erisim.path()).ok().map(|b| b.into_bytes())
        } else {
            None
        };
        Ok(Okunan {
            bayt,
            yol: erisim.path().to_path_buf(),
            yeni_yerimi,
        })
    }
}

/// Yeni kayıt kurar (yer imini seçim anında oluşturur). Yer imi oluşturulamazsa kayıt yine eklenir
/// (yalnız bu oturumda / Apple dışı platformda düz yolla açılabilir); hata stderr'e yazılır.
pub fn kayit_kur(yi: &dyn YerImi, yol: &Path, ad: &str, tur: &str, tarih: u64) -> Kayit {
    let yerimi = match yi.olustur(yol) {
        Ok(v) => v.map(|b| base64::engine::general_purpose::STANDARD.encode(b)),
        Err(e) => {
            eprintln!("yer imi oluşturulamadı ({}): {e}", yol.display());
            None
        }
    };
    Kayit {
        kimlik: uuid::Uuid::new_v4().to_string(),
        ad: ad.to_string(),
        tur: tur.to_string(),
        tarih,
        yol: yol.to_string_lossy().into_owned(),
        yerimi,
    }
}

/// Kayıtlı yol takılı olmayan bir diskte mi (`/Volumes/<ad>/…` ve `/Volumes/<ad>` yok)? Diskin adı.
pub fn takili_olmayan_disk(yol: &Path) -> Option<String> {
    takili_olmayan_disk_kokte(yol, Path::new("/Volumes"))
}

/// `takili_olmayan_disk`, bağlama klasörü verilerek (testte geçici klasör). L4: `/Volumes/<ad>` yoksa ya da
/// bir klasör olarak duruyor ama üzerine disk bağlı değilse (aygıtı `/Volumes` ile aynı: düzgün çıkarılmamış
/// diskten kalan boş klasör) disk takılı değildir. Sembolik bağ (`Macintosh HD -> /`) takılı sayılır.
pub fn takili_olmayan_disk_kokte(yol: &Path, volumes: &Path) -> Option<String> {
    let ic = yol.strip_prefix(volumes).ok()?;
    let ad = ic.components().next()?.as_os_str();
    let kok = volumes.join(ad);
    let takili = match fs::symlink_metadata(&kok) {
        Err(_) => false,
        Ok(m) if m.file_type().is_symlink() => true,
        Ok(m) => !m.is_dir() || !ayni_aygit(&kok, volumes),
    };
    (!takili).then(|| ad.to_string_lossy().into_owned())
}

/// İki yol aynı dosya sisteminde mi (bağlama noktası değil)? Bilinemezse false (takılı sayılır).
fn ayni_aygit(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        matches!((fs::metadata(a), fs::metadata(b)), (Ok(x), Ok(y)) if x.dev() == y.dev())
    }
    #[cfg(not(unix))]
    {
        let _ = (a, b);
        false
    }
}

/// Çökme artığı geçici dosyaları siler: `atomik_yaz`'ın `.<ad>.<uuid>.gecici` kalıbına uyan, sıradan
/// dosya olan ve `en_az_yas`'tan eski olanlar (taze olan şu an yazılıyor olabilir). Dönüş: silinen sayısı.
pub fn artik_gecicileri_temizle(klasor: &Path, en_az_yas: std::time::Duration) -> usize {
    let Ok(ic) = fs::read_dir(klasor) else {
        return 0;
    };
    let simdi = std::time::SystemTime::now();
    let mut n = 0;
    for g in ic.flatten() {
        let ad = g.file_name();
        let ad = ad.to_string_lossy();
        let kalip = ad
            .strip_prefix('.')
            .and_then(|a| a.strip_suffix(".gecici"))
            .and_then(|a| a.rsplit_once('.'))
            .is_some_and(|(asil, u)| !asil.is_empty() && uuid::Uuid::parse_str(u).is_ok());
        if !kalip {
            continue;
        }
        let eski = g
            .metadata()
            .ok()
            .filter(|m| m.file_type().is_file())
            .is_some_and(|m| {
                m.modified()
                    .ok()
                    .and_then(|t| simdi.duration_since(t).ok())
                    .is_some_and(|yas| yas >= en_az_yas)
            });
        if eski && fs::remove_file(g.path()).is_ok() {
            n += 1;
        }
    }
    n
}

/// Bir yol çözülürken izlenecek en çok sembolik bağ sayısı (macOS `MAXSYMLINKS` ile aynı: 32).
pub const BAG_SINIRI: usize = 32;

/// L4: yolu, var olan bileşenlerindeki sembolik bağları izleyerek (zincir, göreli hedef, ara klasör
/// bağı) ve `.`/`..`'yı sözcüksel normalize ederek çözer. Var olmayan bileşenden sonrası yalnız normalize edilir
/// (takılı olmayan diskteki hedef de böylece `/Volumes/<ad>/…` olarak görünür). En çok `BAG_SINIRI` bağ izlenir;
/// döngüde ya da aşırı uzun zincirde o ana kadar çözülen yol döner (sonsuz döngü yok).
pub fn bag_cozumle(yol: &Path) -> PathBuf {
    use std::collections::VecDeque;
    use std::path::Component;
    let mut kalan: VecDeque<std::ffi::OsString> = VecDeque::new();
    let mut cozulen = PathBuf::new();
    let ekle =
        |k: &mut VecDeque<std::ffi::OsString>, cozulen: &mut PathBuf, p: &Path, basa: bool| {
            let mut parcalar = Vec::new();
            for c in p.components() {
                match c {
                    Component::RootDir => {
                        *cozulen = PathBuf::from("/");
                        parcalar.clear();
                    }
                    Component::Prefix(_) => {}
                    Component::CurDir => {}
                    Component::ParentDir => parcalar.push(std::ffi::OsString::from("..")),
                    Component::Normal(n) => parcalar.push(n.to_os_string()),
                }
            }
            if basa {
                for p in parcalar.into_iter().rev() {
                    k.push_front(p);
                }
            } else {
                k.extend(parcalar);
            }
        };
    ekle(&mut kalan, &mut cozulen, yol, false);
    let mut izlenen = 0usize;
    let mut var_olabilir = true;
    while let Some(p) = kalan.pop_front() {
        if p == ".." {
            cozulen.pop();
            continue;
        }
        let aday = cozulen.join(&p);
        if var_olabilir && izlenen < BAG_SINIRI {
            match fs::symlink_metadata(&aday) {
                Ok(m) if m.file_type().is_symlink() => {
                    if let Ok(hedef) = fs::read_link(&aday) {
                        izlenen += 1;
                        // göreli hedef bağın klasörüne göre (cozulen), mutlak hedef kökten
                        ekle(&mut kalan, &mut cozulen, &hedef, true);
                        continue;
                    }
                }
                Ok(_) => {}
                Err(_) => var_olabilir = false, // sonrası diskte yok: yalnız normalize
            }
        }
        cozulen = aday;
    }
    if cozulen.as_os_str().is_empty() {
        cozulen.push(".");
    }
    cozulen
}

/// Ham hatayı kullanıcıya gidecek koda çevirir. Disk takılı değilse her hata `DiskYok`: kayıtlı yol ya da
/// sembolik bağları çözülmüş hali (`bag_cozumle`: zincir, göreli hedef, ara klasör bağı) takılı
/// olmayan diskteyse. Yer imi çözülemediyse kayıtlı yolun `lstat`'ı belirler (yok → Bulunamadi, izinsiz → Erisim,
/// var → Gecici; bağsa hedefin `stat`'ı: yok → Bulunamadi, döngü/başka → Gecici).
pub fn siniflandir(kayitli_yol: &Path, ham: HamHata) -> OkumaHatasi {
    if let Some(disk) =
        takili_olmayan_disk(kayitli_yol).or_else(|| takili_olmayan_disk(&bag_cozumle(kayitli_yol)))
    {
        return OkumaHatasi::DiskYok(disk);
    }
    match ham {
        HamHata::ErisimReddi(m) => OkumaHatasi::Erisim(m),
        HamHata::Okuma(e) => match e.kind() {
            io::ErrorKind::NotFound => OkumaHatasi::Bulunamadi(e.to_string()),
            io::ErrorKind::PermissionDenied => OkumaHatasi::Erisim(e.to_string()),
            io::ErrorKind::InvalidInput => OkumaHatasi::Gecersiz(e.to_string()),
            _ => OkumaHatasi::Gecici(e.to_string()),
        },
        HamHata::Cozulemedi(m) => match fs::symlink_metadata(kayitli_yol) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => OkumaHatasi::Bulunamadi(m),
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied => OkumaHatasi::Erisim(m),
            // L4: kayıtlı yol sembolik bağsa hedefine bakılır (ölü bağ sonsuza dek "geçici" kalmasın); hedef
            // takılı olmayan diskteyse yukarıda DiskYok döndü.
            Ok(b) if b.file_type().is_symlink() => match fs::metadata(kayitli_yol) {
                Err(e) if e.kind() == io::ErrorKind::NotFound => OkumaHatasi::Bulunamadi(m),
                Err(e) if e.kind() == io::ErrorKind::PermissionDenied => OkumaHatasi::Erisim(m),
                _ => OkumaHatasi::Gecici(m),
            },
            _ => OkumaHatasi::Gecici(m),
        },
    }
}

/// Adım 1 (liste kilitliyken, kısa): kimliği doğrular ve kaydın kopyasını verir. Bilinmeyen/geçersiz
/// kimlik → `Bilinmeyen` (dosya sistemine hiç dokunulmaz).
pub fn kaydi_al(liste: &Liste, kimlik: &str) -> Result<Kayit, OkumaHatasi> {
    if uuid::Uuid::parse_str(kimlik).is_err() {
        return Err(OkumaHatasi::Bilinmeyen);
    }
    liste.bul(kimlik).cloned().ok_or(OkumaHatasi::Bilinmeyen)
}

/// Adım 2 (KİLİTSİZ; büyük EPUB'da uzun sürebilir): kaydı yer imiyle ya da düz yolla okur. Yolun türü
/// kayıttakiyle uyuşmazsa (D7; yer imli kayıtta çözülen yol) hiç okunmaz: `Gecersiz`.
pub fn kaydi_oku(
    kayit: &Kayit,
    yi: &dyn YerImi,
    icerik_oku: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
) -> Result<Okunan, OkumaHatasi> {
    let tur = kayit.tur.as_str();
    let uymuyor = || {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            crate::dil::metin("rust.tur_uyusmuyor", &[("tur", tur)]),
        )
    };
    let denetimli = |p: &Path| -> io::Result<Vec<u8>> {
        let epub_uzantili = p
            .extension()
            .is_some_and(|u| u.eq_ignore_ascii_case("epub"));
        if tur == "epub" && epub_uzantili && p.is_dir() {
            // L1: klasör paketi; içi okunamıyorsa (izin, iCloud'dan inmemiş) kalıcı "geçersiz" değil.
            use crate::epub_klasor::{paket_durumu, PaketDurumu};
            match paket_durumu(p) {
                PaketDurumu::Paket => {}
                PaketDurumu::Degil => return Err(uymuyor()),
                PaketDurumu::Okunamadi(e) => return Err(e),
            }
        } else if crate::dosya::tur_bul(p) != Some(tur) {
            return Err(uymuyor());
        }
        icerik_oku(p)
    };
    let kayitli = Path::new(&kayit.yol);
    match kayit.yerimi.as_deref() {
        Some(b64) => match base64::engine::general_purpose::STANDARD.decode(b64) {
            Ok(b) => yi
                .eris_ve_oku(&b, &denetimli)
                .map_err(|h| siniflandir(kayitli, h)),
            Err(e) => Err(OkumaHatasi::Gecersiz(crate::dil::metin(
                "rust.yer_imi_bozuk",
                &[("hata", &e.to_string())],
            ))),
        },
        None => denetimli(kayitli)
            .map(|bayt| Okunan {
                bayt,
                yol: kayitli.to_path_buf(),
                yeni_yerimi: None,
            })
            .map_err(|e| siniflandir(kayitli, HamHata::Okuma(e))),
    }
}

/// Adım 3 (liste kilitliyken, kısa): başarıda kayıt başa alınır (bayatsa yer imi/yol yenilenir); hata
/// kalıcıysa kayıt çıkar, değilse durur. Kayıt bu arada temizlendiyse liste değişmez.
pub fn sonucu_isle(
    liste: &mut Liste,
    kayit: &Kayit,
    tarih: u64,
    sonuc: Result<Okunan, OkumaHatasi>,
) -> Result<(Vec<u8>, Ozet), OkumaHatasi> {
    match sonuc {
        Ok(o) => {
            let yeni_yol = o.yol.to_string_lossy().into_owned();
            let yeni_yol = (yeni_yol != kayit.yol && !yeni_yol.is_empty()).then_some(yeni_yol);
            let yeni_yerimi = o
                .yeni_yerimi
                .map(|b| base64::engine::general_purpose::STANDARD.encode(b));
            liste.one_al(&kayit.kimlik, tarih, yeni_yerimi, yeni_yol);
            let ozet = liste
                .bul(&kayit.kimlik)
                .map(Ozet::from)
                .unwrap_or_else(|| Ozet::from(kayit));
            Ok((o.bayt, ozet))
        }
        Err(e) => {
            if e.kalici_silinir() {
                liste.unut(&kayit.kimlik);
            }
            Err(e)
        }
    }
}

/// Listedeki kaydı okur (üç adım tek kilitte; uygulama `dosya::son_kaydi_oku` ile okumayı kilitsiz yapar).
/// Dönüş: (bayt, kaydın özeti). `liste` değiştiyse çağıran kaydeder ve menüyü yeniler.
pub fn oku(
    liste: &mut Liste,
    yi: &dyn YerImi,
    kimlik: &str,
    tarih: u64,
    icerik_oku: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
) -> Result<(Vec<u8>, Ozet), OkumaHatasi> {
    let kayit = kaydi_al(liste, kimlik)?;
    let sonuc = kaydi_oku(&kayit, yi, icerik_oku);
    sonucu_isle(liste, &kayit, tarih, sonuc)
}

#[cfg(test)]
pub(crate) mod testler {
    use super::*;
    use std::cell::RefCell;

    fn k(yol: &str) -> Kayit {
        Kayit {
            kimlik: uuid::Uuid::new_v4().to_string(),
            ad: Path::new(yol)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            tur: if yol.ends_with(".epub") {
                "epub"
            } else {
                "pdf"
            }
            .into(),
            tarih: 1,
            yol: yol.into(),
            yerimi: None,
        }
    }

    fn gecici_klasor() -> PathBuf {
        let d = std::env::temp_dir().join(format!("kc-son-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// (L4 elle adımı için gözlem): kayıt, Rust'a verilen yolu (sembolik bağın kendi yolu) OLDUĞU GİBİ tutar
    /// (çözmez). Gerçek Apple yer imi bağ yolundan oluşturulur; çözümünde dönen yol aşağıda sabitlenir. Hangi yolun
    /// geldiği Aç penceresine bağlıdır: NSOpenPanel `resolvesAliases` öntanımlı açık (rfd değiştirmiyor).
    #[cfg(target_os = "macos")]
    #[test]
    fn kayit_bag_yolunu_tutar_yer_imi_gozlemi() {
        use std::os::unix::fs::symlink;
        let d = gecici_klasor().canonicalize().unwrap();
        let hedef = d.join("hedef.pdf");
        fs::write(&hedef, b"%PDF-1.4 0b").unwrap();
        let bag = d.join("bag.pdf");
        symlink(&hedef, &bag).unwrap();
        let kayit = kayit_kur(&AppleYerImi, &bag, "bag.pdf", "pdf", 1);
        assert_eq!(kayit.yol, bag.to_string_lossy(), "kayıt bağ yolunu tutar");
        assert_eq!(kayit.ad, "bag.pdf");
        let yerimi = kayit
            .yerimi
            .as_deref()
            .map(|b| base64::engine::general_purpose::STANDARD.decode(b).unwrap());
        eprintln!(
            "0b gözlem: yer imi {}",
            if yerimi.is_some() { "oluştu" } else { "yok" }
        );
        if let Some(b) = yerimi {
            let o = AppleYerImi
                .eris_ve_oku(&b, &|p: &Path| fs::read(p))
                .unwrap_or_else(|e| panic!("yer imi çözülemedi: {e:?}"));
            eprintln!("0b gözlem: çözülen yol {}", o.yol.display());
            assert_eq!(o.bayt, b"%PDF-1.4 0b");
            // Gözlem (macOS 26.6.2): bağ yolundan oluşturulan yer imi HEDEF dosyaya çözülür.
            assert_eq!(o.yol, hedef, "yer imi bağı izler, hedefin yolunu verir");
            // Son Açılanlar'dan ilk başarılı açılışta kayıt yolu çözülen (hedef) yola güncellenir; ad aynı kalır.
            let mut l = Liste::default();
            let kimlik = l.ekle(kayit.clone());
            let (bayt, ozet) =
                oku(&mut l, &AppleYerImi, &kimlik, 2, &|p: &Path| fs::read(p)).unwrap();
            assert_eq!(bayt, b"%PDF-1.4 0b");
            assert_eq!(ozet.ad, "bag.pdf");
            assert_eq!(
                l.bul(&kimlik).unwrap().yol,
                hedef.to_string_lossy(),
                "açılıştan sonra kayıt hedef yolu tutar"
            );
        }
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn mru_en_yeni_basta_ayni_yol_basa_alinir_kimligi_korunur_en_cok_10() {
        let mut l = Liste::default();
        let ilk = l.ekle(k("/a/0.pdf"));
        for i in 1..12 {
            l.ekle(k(&format!("/a/{i}.pdf")));
        }
        assert_eq!(l.kayitlar.len(), EN_COK);
        let yollar: Vec<&str> = l.kayitlar.iter().map(|k| k.yol.as_str()).collect();
        assert_eq!(yollar[0], "/a/11.pdf");
        assert_eq!(yollar[9], "/a/2.pdf");
        assert!(
            l.kayitlar
                .iter()
                .all(|k| k.yol != "/a/0.pdf" && k.yol != "/a/1.pdf"),
            "en eskiler düştü"
        );
        assert!(l.bul(&ilk).is_none());
        // aynı yol yeniden: başa gelir, tek kalır, kimliği korunur
        let eski = l.kayitlar[5].kimlik.clone();
        let yol = l.kayitlar[5].yol.clone();
        let donen = l.ekle(k(&yol));
        assert_eq!(donen, eski);
        assert_eq!(l.kayitlar[0].kimlik, eski);
        assert_eq!(l.kayitlar.iter().filter(|k| k.yol == yol).count(), 1);
        assert_eq!(l.kayitlar.len(), EN_COK);
    }

    #[test]
    fn unut_ve_one_al() {
        let mut l = Liste::default();
        let a = l.ekle(k("/a.pdf"));
        let b = l.ekle(k("/b.pdf"));
        l.one_al(&a, 99, Some("YENI".into()), Some("/tasindi/a.pdf".into()));
        assert_eq!(l.kayitlar[0].kimlik, a);
        assert_eq!(l.kayitlar[0].tarih, 99);
        assert_eq!(l.kayitlar[0].yerimi.as_deref(), Some("YENI"));
        assert_eq!(l.kayitlar[0].yol, "/tasindi/a.pdf");
        assert!(l.unut(&b));
        assert!(!l.unut(&b));
        assert_eq!(l.kayitlar.len(), 1);
    }

    #[test]
    fn bozuk_json_ve_eksik_dosya_bos_liste_gecersiz_kayit_atilir() {
        let d = gecici_klasor();
        let yol = d.join(DOSYA_ADI);
        assert_eq!(Liste::yukle(&yol), Liste::default(), "dosya yok");
        for bozuk in [
            "",
            "{",
            "null",
            "[]",
            "{\"kayitlar\": 5}",
            "\u{0}\u{1}",
            "{\"kayitlar\":[{\"kimlik\":1}]}",
        ] {
            fs::write(&yol, bozuk).unwrap();
            assert_eq!(Liste::yukle(&yol), Liste::default(), "{bozuk:?}");
        }
        // geçerli + geçersiz kimlik + bilinmeyen tür + 12 kayıt → 10 geçerli
        let mut l = Liste::default();
        for i in 0..12 {
            l.kayitlar.push(k(&format!("/x/{i}.pdf")));
        }
        l.kayitlar[0].kimlik = "../../etc/passwd".into();
        l.kayitlar[1].tur = "exe".into();
        l.kaydet(&yol).unwrap();
        let geri = Liste::yukle(&yol);
        assert_eq!(geri.kayitlar.len(), 10);
        assert!(geri
            .kayitlar
            .iter()
            .all(|k| k.yol != "/x/0.pdf" && k.yol != "/x/1.pdf"));
        assert_eq!(
            gecici_dosyalar(&d),
            Vec::<String>::new(),
            "geçici dosya kalmadı"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// L2: klasördeki `.gecici` uzantılı dosyalar (atomik_yaz'ın adı `.<ad>.<uuid>.gecici`; eski denetim sabit
    /// `<ad>.gecici` adını aradığı için hep geçiyordu).
    pub(crate) fn gecici_dosyalar(d: &Path) -> Vec<String> {
        let mut l: Vec<String> = fs::read_dir(d)
            .unwrap()
            .map(|g| g.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|a| a.ends_with(".gecici"))
            .collect();
        l.sort();
        l
    }

    /// L1: klasör paketi EPUB'un içi okunamıyorsa (iCloud'dan inmemiş/dataless, izinsiz META-INF) kayıt
    /// SİLİNMEZ; içi okunabilen ama container.xml'i olmayan klasör gerçekten geçersizdir (silinir).
    #[cfg(unix)]
    #[test]
    fn klasor_paketi_ici_okunamazsa_kayit_durur() {
        use std::os::unix::fs::PermissionsExt;
        let d = gecici_klasor();
        let kilitli = d.join("Kilitli.epub");
        fs::create_dir_all(kilitli.join("META-INF")).unwrap();
        fs::write(kilitli.join("META-INF/container.xml"), "<c/>").unwrap();
        fs::write(kilitli.join("mimetype"), "application/epub+zip").unwrap();
        let bos = d.join("Inmemis.epub");
        fs::create_dir_all(&bos).unwrap();
        let sahte = d.join("Sahte.epub");
        fs::create_dir_all(&sahte).unwrap();
        fs::write(sahte.join("not.txt"), "x").unwrap();
        let mut l = Liste::default();
        let ka = l.ekle(k(kilitli.to_str().unwrap()));
        let kb = l.ekle(kayit_kur(
            &Sahte::new(),
            &kilitli,
            "Kilitli.epub",
            "epub",
            1,
        ));
        let kc = l.ekle(k(bos.to_str().unwrap()));
        let kd = l.ekle(k(sahte.to_str().unwrap()));
        fs::set_permissions(kilitli.join("META-INF"), fs::Permissions::from_mode(0o000)).unwrap();
        let oku_fn = |p: &Path| crate::dosya::icerik_oku(p);
        let sonuc: Vec<String> = [&ka, &kb, &kc, &kd]
            .iter()
            .map(|kimlik| {
                oku(&mut l, &Sahte::new(), kimlik, 2, &oku_fn)
                    .map(|_| "OK".to_string())
                    .unwrap_or_else(|h| h.to_string())
            })
            .collect();
        fs::set_permissions(kilitli.join("META-INF"), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(
            sonuc[0].starts_with("ERISIM:"),
            "izinsiz META-INF (yer imsiz): {}",
            sonuc[0]
        );
        assert!(
            sonuc[1].starts_with("ERISIM:"),
            "izinsiz META-INF (yer imli): {}",
            sonuc[1]
        );
        assert!(
            sonuc[2].starts_with("GECICI:"),
            "içi boş (inmemiş) paket: {}",
            sonuc[2]
        );
        assert!(
            sonuc[3].starts_with("GECERSIZ:"),
            "container.xml'siz klasör: {}",
            sonuc[3]
        );
        for kimlik in [&ka, &kb, &kc] {
            assert!(l.bul(kimlik).is_some(), "içi okunamayan paket kaydı durur");
        }
        assert!(l.bul(&kd).is_none(), "gerçekten geçersiz klasör çıkarılır");
        // izin geri gelince aynı kayıt açılır
        assert!(oku(&mut l, &Sahte::new(), &ka, 3, &oku_fn).is_ok());
        fs::remove_dir_all(&d).unwrap();
    }

    /// L4: hedefi silinmiş sembolik bağ "geçici" değil "bulunamadı" (kalıcı çıkar); hedefi takılı olmayan
    /// diskteyse "disk yok". Boş kalmış bağlama klasörü (`/Volumes/<ad>` var ama disk bağlı değil) disk
    /// takılı sayılmaz; `/Volumes/Macintosh HD` gibi sembolik bağ takılıdır.
    #[cfg(unix)]
    #[test]
    fn olu_bag_bulunamadi_bos_baglama_klasoru_disk_yok() {
        use std::os::unix::fs::symlink;
        struct Cozulemez;
        impl YerImi for Cozulemez {
            fn olustur(&self, yol: &Path) -> Result<Option<Vec<u8>>, String> {
                Ok(Some(yol.to_string_lossy().as_bytes().to_vec()))
            }
            fn eris_ve_oku(
                &self,
                _: &[u8],
                _: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
            ) -> Result<Okunan, HamHata> {
                Err(HamHata::Cozulemedi("The file doesn’t exist.".into()))
            }
        }
        let d = gecici_klasor();
        let hedef = d.join("hedef.pdf");
        fs::write(&hedef, b"%PDF").unwrap();
        let bag = d.join("bag.pdf");
        symlink(&hedef, &bag).unwrap();
        let bag2 = d.join("bag2.pdf");
        symlink(&hedef, &bag2).unwrap();
        let disk = format!("kc-takili-olmayan-{}", uuid::Uuid::new_v4());
        let disk_bag = d.join("disk-bag.pdf");
        symlink(format!("/Volumes/{disk}/a.pdf"), &disk_bag).unwrap();
        fs::remove_file(&hedef).unwrap();
        let mut l = Liste::default();
        let ka = l.ekle(kayit_kur(&Cozulemez, &bag, "bag.pdf", "pdf", 1));
        let kb = l.ekle(k(bag2.to_str().unwrap()));
        let kc = l.ekle(kayit_kur(&Cozulemez, &disk_bag, "disk-bag.pdf", "pdf", 1));
        let oku_fn = |p: &Path| fs::read(p);
        let hata = |l: &mut Liste, kimlik: &str| {
            oku(l, &Cozulemez, kimlik, 2, &oku_fn)
                .unwrap_err()
                .to_string()
        };
        let ha = hata(&mut l, &ka);
        let hb = hata(&mut l, &kb);
        let hc = hata(&mut l, &kc);
        assert!(ha.starts_with("BULUNAMADI:"), "ölü bağ (yer imli): {ha}");
        assert!(hb.starts_with("BULUNAMADI:"), "ölü bağ (yer imsiz): {hb}");
        assert!(
            hc.starts_with("DISKYOK:") && hc.contains(&disk),
            "bağın hedefi takılı olmayan diskte: {hc}"
        );
        assert!(
            l.bul(&ka).is_none() && l.bul(&kb).is_none(),
            "ölü bağ kaydı çıkar"
        );
        assert!(l.bul(&kc).is_some(), "disk yoksa kayıt durur");
        // bağlama klasörü
        let vol = d.join("Volumes");
        fs::create_dir_all(vol.join("Bos")).unwrap();
        symlink("/", vol.join("Kok")).unwrap();
        assert_eq!(
            takili_olmayan_disk_kokte(&vol.join("Bos/Kitap/a.pdf"), &vol),
            Some("Bos".into()),
            "boş bağlama klasörü: disk takılı değil"
        );
        assert_eq!(
            takili_olmayan_disk_kokte(&vol.join("Yok/a.pdf"), &vol),
            Some("Yok".into())
        );
        assert_eq!(
            takili_olmayan_disk_kokte(&vol.join("Kok/Users/a.pdf"), &vol),
            None,
            "sembolik bağ (Macintosh HD gibi) takılı"
        );
        assert_eq!(
            takili_olmayan_disk_kokte(Path::new("/Users/x/a.pdf"), &vol),
            None,
            "Volumes dışı"
        );
        assert_eq!(takili_olmayan_disk_kokte(&vol, &vol), None, "disk adı yok");
        assert_eq!(
            takili_olmayan_disk(Path::new("/Volumes/Macintosh HD/Users/a.pdf")),
            None,
            "açılış diski takılı"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// Bağ zinciri, göreli hedef (`..` dahil, normalize) ve ara klasör bağı
    /// takılı olmayan diske gidiyorsa DISKYOK (kayıt durur); yer imli ve yer imsiz kayıtta aynı. Döngü ve çok
    /// uzun zincir sınırlı derinlikte biter (DISKYOK sayılmaz, kayıt silinmez).
    #[cfg(unix)]
    #[test]
    fn bag_zinciri_goreli_hedef_ara_klasor_disk_yok() {
        use std::os::unix::fs::symlink;
        struct Cozulemez;
        impl YerImi for Cozulemez {
            fn olustur(&self, yol: &Path) -> Result<Option<Vec<u8>>, String> {
                Ok(Some(yol.to_string_lossy().as_bytes().to_vec()))
            }
            fn eris_ve_oku(
                &self,
                _: &[u8],
                _: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
            ) -> Result<Okunan, HamHata> {
                Err(HamHata::Cozulemedi("The file doesn’t exist.".into()))
            }
        }
        let d = gecici_klasor();
        let disk = format!("kc-takili-olmayan-{}", uuid::Uuid::new_v4());
        let vol = format!("/Volumes/{disk}");
        let derin = "../".repeat(d.components().count() + 3);
        // zincir: zincir1 -> zincir2 -> /Volumes/<disk>/a.pdf
        symlink(format!("{vol}/a.pdf"), d.join("zincir2.pdf")).unwrap();
        symlink(d.join("zincir2.pdf"), d.join("zincir1.pdf")).unwrap();
        // göreli hedef (normalize edilmeden /Volumes önekini taşımaz) ve göreli zincir
        symlink(format!("{derin}Volumes/{disk}/b.pdf"), d.join("goreli.pdf")).unwrap();
        symlink("goreli.pdf", d.join("goreli-zincir.pdf")).unwrap();
        symlink(
            format!("./alt/../{derin}Volumes/./{disk}/c.pdf"),
            d.join("noktali.pdf"),
        )
        .unwrap();
        // ara klasör bağı: d/disk-klasor -> /Volumes/<disk>/Kitaplar; kayıt d/disk-klasor/c.pdf
        symlink(format!("{vol}/Kitaplar"), d.join("disk-klasor")).unwrap();
        // 10 halkalı zincir
        symlink(format!("{vol}/uzun.pdf"), d.join("halka0.pdf")).unwrap();
        for i in 1..10 {
            symlink(
                format!("halka{}.pdf", i - 1),
                d.join(format!("halka{i}.pdf")),
            )
            .unwrap();
        }
        let yollar = [
            d.join("zincir1.pdf"),
            d.join("goreli.pdf"),
            d.join("goreli-zincir.pdf"),
            d.join("noktali.pdf"),
            d.join("disk-klasor/c.pdf"),
            d.join("halka9.pdf"),
        ];
        let oku_fn = |p: &Path| fs::read(p);
        let mut hatali = Vec::new();
        for y in &yollar {
            let ad = y.file_name().unwrap().to_string_lossy().into_owned();
            // aynı yolda tek kayıt olur (Liste::ekle): yer imli ve yer imsiz ayrı listelerde
            for (kayit, tur) in [
                (kayit_kur(&Cozulemez, y, &ad, "pdf", 1), "yer imli"),
                (k(y.to_str().unwrap()), "yer imsiz"),
            ] {
                assert_eq!(kayit.yerimi.is_some(), tur == "yer imli");
                let mut l = Liste::default();
                let kimlik = l.ekle(kayit);
                let h = oku(&mut l, &Cozulemez, &kimlik, 2, &oku_fn)
                    .unwrap_err()
                    .to_string();
                if !(h.starts_with("DISKYOK:") && h.contains(&disk)) || l.bul(&kimlik).is_none() {
                    hatali.push(format!(
                        "{tur} {}: {h} (kayıt {})",
                        ad,
                        if l.bul(&kimlik).is_some() {
                            "durdu"
                        } else {
                            "SİLİNDİ"
                        }
                    ));
                }
            }
        }
        assert!(hatali.is_empty(), "{hatali:#?}");
        let mut l = Liste::default();
        // döngü ve sınırı aşan zincir: biter, DISKYOK değil, kayıt durur (kalıcı silme yok)
        symlink(d.join("dongu2.pdf"), d.join("dongu1.pdf")).unwrap();
        symlink(d.join("dongu1.pdf"), d.join("dongu2.pdf")).unwrap();
        symlink(format!("{vol}/cok-uzun.pdf"), d.join("u0.pdf")).unwrap();
        for i in 1..=BAG_SINIRI + 5 {
            symlink(format!("u{}.pdf", i - 1), d.join(format!("u{i}.pdf"))).unwrap();
        }
        for y in [
            d.join("dongu1.pdf"),
            d.join(format!("u{}.pdf", BAG_SINIRI + 5)),
        ] {
            let kimlik = l.ekle(kayit_kur(&Cozulemez, &y, "x.pdf", "pdf", 1));
            let h = oku(&mut l, &Cozulemez, &kimlik, 2, &oku_fn)
                .unwrap_err()
                .to_string();
            assert!(!h.starts_with("DISKYOK:"), "{}: {h}", y.display());
            assert!(l.bul(&kimlik).is_some(), "{}: {h}", y.display());
        }
        // yol çözücünün kendisi: normalize + sınır
        assert_eq!(
            bag_cozumle(&d.join("goreli.pdf")),
            PathBuf::from(format!("{vol}/b.pdf"))
        );
        assert_eq!(
            bag_cozumle(Path::new("/a/./b/../c")),
            PathBuf::from("/a/c"),
            "bağsız yol yalnız normalize edilir"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// L7: çökme artığı geçici dosyalar (`.<ad>.<uuid>.gecici`, belli bir yaştan eski) açılışta silinir;
    /// taze olanlar (şu an yazılıyor olabilir), kalıba uymayanlar, klasör ve bağlar dokunulmaz.
    #[cfg(unix)]
    #[test]
    fn artik_gecici_dosyalar_temizlenir() {
        use std::time::{Duration, SystemTime};
        let d = gecici_klasor();
        let eski = |ad: &str| {
            let y = d.join(ad);
            let f = fs::File::create(&y).unwrap();
            f.set_modified(SystemTime::now() - Duration::from_secs(7200))
                .unwrap();
            y
        };
        let u = || uuid::Uuid::new_v4().to_string();
        let artik1 = eski(&format!(".surec.json.{}.gecici", u()));
        let artik2 = eski(&format!(".son-acilanlar.json.{}.gecici", u()));
        let taze = d.join(format!(".surec.json.{}.gecici", u()));
        fs::write(&taze, "{}").unwrap();
        let kalipsiz = eski(".gizli.gecici");
        let uuidsiz = eski(".surec.json.abc.gecici");
        let asil = eski("surec.json");
        let klasor = d.join(format!(".x.{}.gecici", u()));
        fs::create_dir_all(&klasor).unwrap();
        let bag_hedef = eski("hedef.txt");
        let bag = d.join(format!(".bag.{}.gecici", u()));
        std::os::unix::fs::symlink(&bag_hedef, &bag).unwrap();
        let n = artik_gecicileri_temizle(&d, Duration::from_secs(60));
        assert_eq!(n, 2, "iki eski artık silindi");
        assert!(
            !artik1.exists() && !artik2.exists(),
            "eski artıklar silindi"
        );
        for kalan in [&taze, &kalipsiz, &uuidsiz, &asil, &klasor, &bag_hedef] {
            assert!(kalan.exists(), "dokunulmamalı: {}", kalan.display());
        }
        assert!(fs::symlink_metadata(&bag).is_ok(), "bağ dokunulmadı");
        assert_eq!(
            artik_gecicileri_temizle(&d.join("yok"), Duration::from_secs(60)),
            0,
            "klasör yok"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// Sahte yer imi: bayt = yolun kendisi; `bayat` ve `reddet` ile davranış seçilir; erişim sayacı açık
    /// erişim kalmadığını (kısa ömürlü) denetler.
    struct Sahte {
        bayat: bool,
        reddet: bool,
        acik: RefCell<i32>,
        en_cok_acik: RefCell<i32>,
    }
    impl Sahte {
        fn new() -> Self {
            Sahte {
                bayat: false,
                reddet: false,
                acik: RefCell::new(0),
                en_cok_acik: RefCell::new(0),
            }
        }
    }
    impl YerImi for Sahte {
        fn olustur(&self, yol: &Path) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(yol.to_string_lossy().as_bytes().to_vec()))
        }
        /// Gerçek macOS gibi: dosya yoksa (ya da diski takılı değilse) yer imi çözülemez.
        fn eris_ve_oku(
            &self,
            b: &[u8],
            oku: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
        ) -> Result<Okunan, HamHata> {
            if self.reddet {
                return Err(HamHata::ErisimReddi("reddedildi".into()));
            }
            let yol = PathBuf::from(String::from_utf8(b.to_vec()).unwrap());
            if !yol.exists() {
                return Err(HamHata::Cozulemedi("The file doesn’t exist.".into()));
            }
            *self.acik.borrow_mut() += 1;
            let simdi_acik = *self.acik.borrow();
            let mut en_cok = self.en_cok_acik.borrow_mut();
            *en_cok = (*en_cok).max(simdi_acik);
            drop(en_cok);
            let r = oku(&yol);
            *self.acik.borrow_mut() -= 1;
            let bayt = r.map_err(HamHata::Okuma)?;
            Ok(Okunan {
                bayt,
                yol: yol.clone(),
                yeni_yerimi: self.bayat.then(|| b"YENI".to_vec()),
            })
        }
    }

    #[test]
    fn oku_bilinmeyen_ve_keyfi_yol_kimligi_reddedilir_dosyaya_dokunulmaz() {
        let d = gecici_klasor();
        let gercek = d.join("gizli.pdf");
        fs::write(&gercek, b"%PDF-gizli").unwrap();
        let mut l = Liste::default();
        l.ekle(kayit_kur(
            &Sahte::new(),
            &d.join("var.pdf"),
            "var.pdf",
            "pdf",
            1,
        ));
        let dokunuldu = RefCell::new(Vec::<PathBuf>::new());
        let oku_fn = |p: &Path| {
            dokunuldu.borrow_mut().push(p.to_path_buf());
            fs::read(p)
        };
        for kimlik in [
            "",
            gercek.to_str().unwrap(),
            "/etc/hosts",
            "../../etc/passwd",
            "file:///etc/hosts",
            &uuid::Uuid::new_v4().to_string(),
            "00000000-0000-0000-0000-000000000000",
        ] {
            assert_eq!(
                oku(&mut l, &Sahte::new(), kimlik, 2, &oku_fn).unwrap_err(),
                OkumaHatasi::Bilinmeyen,
                "{kimlik}"
            );
        }
        assert!(
            dokunuldu.borrow().is_empty(),
            "bilinmeyen kimlikte dosya okunmamalı"
        );
        assert_eq!(l.kayitlar.len(), 1, "bilinmeyen kimlik listeyi değiştirmez");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn oku_basarili_basa_alir_bayatsa_yer_imini_yeniler_erisim_kisa_omurlu() {
        let d = gecici_klasor();
        let a = d.join("a.pdf");
        let b = d.join("b.pdf");
        fs::write(&a, b"%PDF-a").unwrap();
        fs::write(&b, b"%PDF-b").unwrap();
        let yi = Sahte {
            bayat: true,
            ..Sahte::new()
        };
        let mut l = Liste::default();
        let ka = l.ekle(kayit_kur(&yi, &a, "a.pdf", "pdf", 1));
        l.ekle(kayit_kur(&yi, &b, "b.pdf", "pdf", 1));
        let (bayt, ozet) = oku(&mut l, &yi, &ka, 50, &|p: &Path| fs::read(p)).unwrap();
        assert_eq!(bayt, b"%PDF-a");
        assert_eq!(ozet.ad, "a.pdf");
        assert_eq!(l.kayitlar[0].kimlik, ka, "okunan başa alındı");
        assert_eq!(l.kayitlar[0].tarih, 50);
        assert_eq!(
            l.kayitlar[0].yerimi.as_deref(),
            Some("WUVOSQ=="),
            "bayat yer imi yenilendi (base64 'YENI')"
        );
        assert_eq!(*yi.acik.borrow(), 0, "erişim bırakıldı");
        assert_eq!(*yi.en_cok_acik.borrow(), 1);
        fs::remove_dir_all(&d).unwrap();
    }

    /// S11c: silinmiş dosya "bulunamadı" ve listeden kalıcı çıkar (yer imli ve yer imsiz kayıt).
    #[test]
    fn oku_silinmis_kayit_bulunamadi_ve_listeden_cikar() {
        let d = gecici_klasor();
        let a = d.join("silinecek.pdf");
        let b = d.join("duz-silinecek.pdf");
        fs::write(&a, b"%PDF").unwrap();
        fs::write(&b, b"%PDF").unwrap();
        let mut l = Liste::default();
        let ka = l.ekle(kayit_kur(&Sahte::new(), &a, "silinecek.pdf", "pdf", 1));
        let kb = l.ekle(k(b.to_str().unwrap()));
        let kc = l.ekle(k(d.join("kalan.pdf").to_str().unwrap()));
        fs::remove_file(&a).unwrap();
        fs::remove_file(&b).unwrap();
        for kimlik in [&ka, &kb] {
            let h = oku(&mut l, &Sahte::new(), kimlik, 2, &|p: &Path| fs::read(p)).unwrap_err();
            assert!(h.to_string().starts_with("BULUNAMADI:"), "{h}");
            assert!(l.bul(kimlik).is_none(), "bulunamayan çıkarıldı");
        }
        assert!(l.bul(&kc).is_some(), "ötekiler durur");
        fs::remove_dir_all(&d).unwrap();
    }

    /// O4: erişim reddi kaydı SİLMEZ (entitlement/imza farkı geçici olabilir); ayrımlı "ERISIM:" kodu.
    #[test]
    fn erisim_reddi_kaydi_tutar() {
        let d = gecici_klasor();
        let a = d.join("izinsiz.pdf");
        fs::write(&a, b"%PDF").unwrap();
        let mut l = Liste::default();
        let ka = l.ekle(kayit_kur(&Sahte::new(), &a, "izinsiz.pdf", "pdf", 1));
        let red = Sahte {
            reddet: true,
            ..Sahte::new()
        };
        let h = oku(&mut l, &red, &ka, 2, &|p: &Path| fs::read(p)).unwrap_err();
        assert!(h.to_string().starts_with("ERISIM:"), "{h}");
        assert!(l.bul(&ka).is_some(), "erişim reddinde kayıt durur");
        // yer imsiz kayıtta okuma izin hatası (sandbox EPERM) de kaydı tutar
        let kb = l.ekle(k(a.to_str().unwrap()));
        let izinsiz = |_: &Path| -> io::Result<Vec<u8>> {
            Err(io::Error::from(io::ErrorKind::PermissionDenied))
        };
        let h = oku(&mut l, &Sahte::new(), &kb, 2, &izinsiz).unwrap_err();
        assert!(h.to_string().starts_with("ERISIM:"), "{h}");
        assert!(l.bul(&kb).is_some());
        fs::remove_dir_all(&d).unwrap();
    }

    /// O4: takılı olmayan diskteki (`/Volumes/<ad>` yok) kayıt silinmez; "DISKYOK:" kodu diskin adını verir.
    #[test]
    fn takili_olmayan_disk_kaydi_tutar() {
        let disk = format!("kc-takili-olmayan-{}", uuid::Uuid::new_v4());
        let yol = format!("/Volumes/{disk}/Kitaplar/tez.pdf");
        let mut l = Liste::default();
        let ka = l.ekle(k(&yol)); // yer imsiz
        let kb = l.ekle(kayit_kur(
            &Sahte::new(),
            Path::new(&yol.replace("tez", "iki")),
            "iki.pdf",
            "pdf",
            1,
        )); // yer imli: çözülemez
        for kimlik in [&ka, &kb] {
            let h = oku(&mut l, &Sahte::new(), kimlik, 2, &|p: &Path| fs::read(p)).unwrap_err();
            let m = h.to_string();
            assert!(m.starts_with("DISKYOK:") && m.contains(&disk), "{m}");
            assert!(
                l.bul(kimlik).is_some(),
                "takılı olmayan diskteki kayıt durur"
            );
        }
    }

    /// O4: geçici okuma hatası (dosya yerinde) kaydı tutar; "GECICI:" kodu.
    #[test]
    fn gecici_okuma_hatasi_kaydi_tutar() {
        let d = gecici_klasor();
        let a = d.join("yerinde.pdf");
        fs::write(&a, b"%PDF").unwrap();
        let mut l = Liste::default();
        let ka = l.ekle(k(a.to_str().unwrap()));
        let kb = l.ekle(kayit_kur(&Sahte::new(), &a, "yerinde.pdf", "pdf", 1));
        let takildi = |_: &Path| -> io::Result<Vec<u8>> {
            Err(io::Error::other("Resource deadlock avoided"))
        };
        for kimlik in [&ka, &kb] {
            let h = oku(&mut l, &Sahte::new(), kimlik, 2, &takildi).unwrap_err();
            assert!(h.to_string().starts_with("GECICI:"), "{h}");
            assert!(l.bul(kimlik).is_some(), "geçici hatada kayıt durur");
        }
        fs::remove_dir_all(&d).unwrap();
    }

    /// O4: yer imi çözülemedi ama dosya yerinde (lstat: var) → GECICI; üst klasör kilitli (lstat: EACCES;
    /// gerçek macOS burada da "The file doesn't exist" veriyor) → ERISIM. İkisinde de kayıt durur.
    #[cfg(unix)]
    #[test]
    fn cozulemeyen_yer_imi_kayitli_yolla_ayrilir() {
        use std::os::unix::fs::PermissionsExt;
        struct Cozulemez;
        impl YerImi for Cozulemez {
            fn olustur(&self, yol: &Path) -> Result<Option<Vec<u8>>, String> {
                Ok(Some(yol.to_string_lossy().as_bytes().to_vec()))
            }
            fn eris_ve_oku(
                &self,
                _: &[u8],
                _: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
            ) -> Result<Okunan, HamHata> {
                Err(HamHata::Cozulemedi("The file doesn’t exist.".into()))
            }
        }
        let d = gecici_klasor();
        let yerinde = d.join("yerinde.pdf");
        fs::write(&yerinde, b"%PDF").unwrap();
        let kilitli = d.join("kilitli");
        fs::create_dir_all(&kilitli).unwrap();
        fs::write(kilitli.join("ic.pdf"), b"%PDF").unwrap();
        let mut l = Liste::default();
        let ka = l.ekle(kayit_kur(&Cozulemez, &yerinde, "yerinde.pdf", "pdf", 1));
        let kb = l.ekle(kayit_kur(
            &Cozulemez,
            &kilitli.join("ic.pdf"),
            "ic.pdf",
            "pdf",
            1,
        ));
        let kc = l.ekle(kayit_kur(
            &Cozulemez,
            &d.join("yok.pdf"),
            "yok.pdf",
            "pdf",
            1,
        ));
        fs::set_permissions(&kilitli, fs::Permissions::from_mode(0o000)).unwrap();
        let oku_fn = |p: &Path| fs::read(p);
        let ha = oku(&mut l, &Cozulemez, &ka, 2, &oku_fn)
            .unwrap_err()
            .to_string();
        let hb = oku(&mut l, &Cozulemez, &kb, 2, &oku_fn)
            .unwrap_err()
            .to_string();
        let hc = oku(&mut l, &Cozulemez, &kc, 2, &oku_fn)
            .unwrap_err()
            .to_string();
        fs::set_permissions(&kilitli, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(ha.starts_with("GECICI:"), "{ha}");
        assert!(hb.starts_with("ERISIM:"), "{hb}");
        assert!(hc.starts_with("BULUNAMADI:"), "{hc}");
        assert!(
            l.bul(&ka).is_some() && l.bul(&kb).is_some(),
            "yerinde/kilitli kayıt durur"
        );
        assert!(l.bul(&kc).is_none(), "yok olan çıkar");
        fs::remove_dir_all(&d).unwrap();
    }

    /// D7: yer imsiz kayıtta yol türü denetlenir (elle düzenlenmiş son-acilanlar.json keyfi dosya okutamaz).
    #[test]
    fn yer_imsiz_kayitta_tur_denetlenir() {
        let d = gecici_klasor();
        let txt = d.join("not.txt");
        fs::write(&txt, b"metin").unwrap();
        let klasor = d.join("klasor.pdf");
        fs::create_dir_all(&klasor).unwrap();
        let mut l = Liste::default();
        let dokunuldu = RefCell::new(Vec::<PathBuf>::new());
        let oku_fn = |p: &Path| {
            dokunuldu.borrow_mut().push(p.to_path_buf());
            fs::read(p)
        };
        for yol in [
            "/etc/hosts",
            txt.to_str().unwrap(),
            klasor.to_str().unwrap(),
        ] {
            let mut kayit = k("/x/a.pdf");
            kayit.yol = yol.into();
            let kimlik = l.ekle(kayit);
            let h = oku(&mut l, &Sahte::new(), &kimlik, 2, &oku_fn).unwrap_err();
            assert!(h.to_string().starts_with("GECERSIZ:"), "{yol}: {h}");
            assert!(l.bul(&kimlik).is_none(), "geçersiz kayıt çıkarılır: {yol}");
        }
        assert!(
            dokunuldu.borrow().is_empty(),
            "tür uymayan yol okunmamalı: {:?}",
            dokunuldu.borrow()
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// O2: hedef adı 255 bayta dek (UTF-8 çok baytlı dahil) — geçici ad `.<ad>.<uuid>.gecici` de
    /// 255 baytı aşmamalı (eskiden +45 bayt → ENAMETOOLONG).
    #[test]
    fn atomik_yaz_255_baytlik_adla_yazar_gecici_ad_kalipta_ve_sinirda() {
        let d = gecici_klasor();
        for ad in [
            "ğ".repeat(126) + ".pdf", // 256 bayt → 255'e kırpılır (karakter sınırında: 254)
            "a".repeat(251) + ".pdf", // tam 255
            "Ş".repeat(100) + &"x".repeat(51), // 251
        ] {
            let ad = crate::dosya::bayta_kirp(&ad, crate::dosya::AD_EN_COK_BAYT).to_string();
            let hedef = d.join(&ad);
            atomik_yaz(&hedef, b"veri").unwrap_or_else(|e| panic!("{} bayt: {e}", ad.len()));
            assert_eq!(fs::read(&hedef).unwrap(), b"veri");
        }
        assert!(gecici_dosyalar(&d).is_empty(), "{:?}", gecici_dosyalar(&d));
        // geçici ad kalıbı (artik_gecicileri_temizle tanır) ve sınır: kırpılmış ad + uuid
        let kaynak = include_str!("son_acilanlar.rs");
        let govde = &kaynak[kaynak.find("pub fn atomik_yaz").unwrap()..];
        let govde = &govde[..govde.find("\n}\n").unwrap()];
        assert!(
            govde.contains("GECICI_EK_BAYT") && govde.contains("bayta_kirp("),
            "geçici ad kırpılmıyor"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// D8: eşzamanlı atomik yazımlar birbirinin geçici dosyasını ezmez (hepsi başarılı, son içerik
    /// yazılanlardan biri, geçici dosya kalmaz); yazım rename'den önce diske eşitlenir (sync_all).
    #[test]
    fn atomik_yaz_eszamanli_ve_gecici_dosya_kalmaz() {
        let d = gecici_klasor();
        let hedef = d.join("surec.json");
        let iplikler: Vec<_> = (0..8)
            .map(|i| {
                let hedef = hedef.clone();
                std::thread::spawn(move || {
                    (0..40)
                        .map(|j| atomik_yaz(&hedef, format!("{{\"i\":{i},\"j\":{j}}}").as_bytes()))
                        .filter(|r| r.is_err())
                        .count()
                })
            })
            .collect();
        let hatali: usize = iplikler.into_iter().map(|t| t.join().unwrap()).sum();
        assert_eq!(hatali, 0, "eşzamanlı yazımda hata");
        let son: serde_json::Value = serde_json::from_slice(&fs::read(&hedef).unwrap()).unwrap();
        assert!(son["i"].is_u64() && son["j"].is_u64(), "{son}");
        let kalan: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .map(|g| g.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|a| a != "surec.json")
            .collect();
        assert!(kalan.is_empty(), "geçici dosya kaldı: {kalan:?}");
        let kaynak = include_str!("son_acilanlar.rs");
        let govde = &kaynak[kaynak.find("pub fn atomik_yaz").unwrap()..];
        let govde = &govde[..govde.find("\n}\n").unwrap()];
        assert!(govde.contains(".sync_all()"), "rename öncesi sync_all yok");
        fs::remove_dir_all(&d).unwrap();
    }

    /// L3: bozuk (base64 olmayan) yer imi "bulunamadı (silinmiş ya da taşınmış)" değil "geçersiz kayıt".
    #[test]
    fn yer_imi_olmayan_kayit_duz_yoldan_okunur_bozuk_yer_imi_gecersiz() {
        let d = gecici_klasor();
        let a = d.join("a.pdf");
        fs::write(&a, b"%PDF-duz").unwrap();
        let mut l = Liste::default();
        let mut kayit = k(a.to_str().unwrap());
        let kimlik = kayit.kimlik.clone();
        l.ekle(kayit.clone());
        assert_eq!(
            oku(&mut l, &Sahte::new(), &kimlik, 2, &|p: &Path| fs::read(p))
                .unwrap()
                .0,
            b"%PDF-duz"
        );
        kayit.yerimi = Some("%%% base64 değil".into());
        kayit.yol = "/baska".into();
        let k2 = l.ekle(kayit);
        let h = oku(&mut l, &Sahte::new(), &k2, 2, &|p: &Path| fs::read(p));
        assert!(matches!(&h, Err(OkumaHatasi::Gecersiz(_))), "{:?}", h.err());
        assert!(l.bul(&k2).is_none(), "bozuk yer imli kayıt çıkarılır");
        fs::remove_dir_all(&d).unwrap();
    }

    /// öncesi `son-acilanlar.json` olduğu gibi açılır (biçim değişmedi; arayüz dili kaydı etkilemez).
    #[test]
    fn eski_m2_son_acilanlar_kaydi_okunur() {
        let y = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../app/test/fixtures/eski-kayit/son-acilanlar.json");
        assert!(y.is_file(), "{}", y.display());
        let l = Liste::yukle(&y);
        assert_eq!(l.kayitlar.len(), 2);
        assert_eq!(l.kayitlar[0].ad, "Mavi Pusula.epub");
        assert_eq!(l.kayitlar[0].tur, "epub");
        assert!(l.kayitlar[0].yerimi.is_some());
        assert_eq!(l.kayitlar[1].ad, "Çiğdemköy & Ekler.pdf");
        assert_eq!(
            l.kayitlar[1].yerimi, None,
            "yerimi alanı olmayan eski kayıt"
        );
        let ozet = serde_json::to_string(&l.ozetler()).unwrap();
        assert!(
            ozet.contains("Çiğdemköy & Ekler.pdf") && !ozet.contains("/Users/"),
            "{ozet}"
        );
    }

    #[test]
    fn ozet_yol_ve_yer_imi_icermez() {
        let mut kayit = k("/gizli/yol/a.pdf");
        kayit.yerimi = Some("QUJD".into());
        let json = serde_json::to_string(&Ozet::from(&kayit)).unwrap();
        assert!(
            !json.contains("gizli") && !json.contains("QUJD") && !json.contains("yol"),
            "{json}"
        );
    }
}
