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
pub const MAX_ENTRIES: usize = 10;
/// Kayıt dosyasının adı (`app_data_dir` içinde).
pub const FILE_NAME: &str = "recent-files.json";

/// Bir son açılan kaydı. `yol` yalnız Rust tarafında kalır (JS'e `Ozet` gider).
// legacy-names: begin (serde aliases: field names of the recent files list written by earlier versions)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    /// Kalıcı kimlik (uuid v4); menü öğesi ve `son_acilani_oku` bununla çağrılır.
    #[serde(alias = "kimlik")]
    pub id: String,
    #[serde(alias = "ad")]
    pub name: String,
    /// "pdf" | "epub"
    #[serde(alias = "tur")]
    pub kind: String,
    /// Son açılış (Unix saniye).
    #[serde(alias = "tarih")]
    pub date: u64,
    /// Seçildiği andaki yol: aynı dosyanın yeniden eklenmesini tanımak ve yer imi yoksa okumak için.
    #[serde(alias = "yol")]
    pub path: String,
    /// Güvenlik kapsamlı yer imi (base64). `None`: platform desteklemiyor ya da oluşturulamadı.
    #[serde(default, alias = "yerimi")]
    pub bookmark: Option<String>,
}

/// JS'e verilen özet (yol ve yer imi verilmez).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Summary {
    #[serde(alias = "kimlik")]
    pub id: String,
    #[serde(alias = "ad")]
    pub name: String,
    #[serde(alias = "tur")]
    pub kind: String,
    pub date: u64,
}

impl From<&Entry> for Summary {
    fn from(k: &Entry) -> Self {
        Summary {
            id: k.id.clone(),
            name: k.name.clone(),
            kind: k.kind.clone(),
            date: k.date,
        }
    }
}

/// MRU listesi (saf veri yapısı; dosya ve yer imi işi dışarıda).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentList {
    #[serde(alias = "kayitlar")]
    pub entries: Vec<Entry>,
}
// legacy-names: end

impl RecentList {
    /// Kaydı başa koyar. Aynı yol varsa eskisi çıkar (kimliği korunur: menü öğesi aynı kalır).
    /// En çok `EN_COK` kayıt kalır. Dönüş: başa konan kaydın kimliği.
    pub fn add(&mut self, mut new_entry: Entry) -> String {
        if let Some(i) = self.entries.iter().position(|k| k.path == new_entry.path) {
            let old = self.entries.remove(i);
            new_entry.id = old.id;
        }
        let id = new_entry.id.clone();
        self.entries.insert(0, new_entry);
        self.entries.truncate(MAX_ENTRIES);
        id
    }

    pub fn find(&self, id: &str) -> Option<&Entry> {
        self.entries.iter().find(|k| k.id == id)
    }

    /// Kaydı çıkarır; vardıysa true.
    pub fn forget(&mut self, id: &str) -> bool {
        let once = self.entries.len();
        self.entries.retain(|k| k.id != id);
        once != self.entries.len()
    }

    /// Kaydı başa alır (yeniden açıldı), tarihini ve isteğe bağlı yeni yer imini/yolunu yazar.
    pub fn move_to_front(
        &mut self,
        id: &str,
        date: u64,
        new_bookmark: Option<String>,
        new_path: Option<String>,
    ) {
        if let Some(i) = self.entries.iter().position(|k| k.id == id) {
            let mut k = self.entries.remove(i);
            k.date = date;
            if let Some(y) = new_bookmark {
                k.bookmark = Some(y);
            }
            if let Some(y) = new_path {
                k.path = y;
            }
            self.entries.insert(0, k);
        }
    }

    pub fn summaries(&self) -> Vec<Summary> {
        self.entries.iter().map(Summary::from).collect()
    }

    /// Dosyadan okur. Yoksa, okunamıyorsa ya da bozuksa boş liste (uygulama açılışı hiçbir zaman bozulmaz).
    /// Geçersiz kayıtlar (kimliği uuid değil, türü bilinmiyor) atılır; fazlası kırpılır.
    pub fn load(path: &Path) -> RecentList {
        let mut l: RecentList = fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        l.entries.retain(|k| {
            uuid::Uuid::parse_str(&k.id).is_ok() && matches!(k.kind.as_str(), "pdf" | "epub")
        });
        l.entries.truncate(MAX_ENTRIES);
        l
    }

    /// Geçici dosyaya yazıp yeniden adlandırır (yarım yazılmış dosya kalmaz).
    pub fn save(&self, path: &Path) -> io::Result<()> {
        let json = serde_json::to_vec_pretty(self).map_err(io::Error::other)?;
        write_atomic(path, &json)
    }
}

/// Geçici adın asıl ada eklediği bayt: "." + "." + uuid (36) + ".gecici" (7).
pub const TEMP_SUFFIX_BYTES: usize = 1 + 1 + 36 + 5;

/// `yol`'a geçici dosya + rename ile yazar; üst klasörü gerekirse oluşturur. Geçici dosyanın adı her yazımda
/// benzersizdir (eşzamanlı yazımlar birbirini ezmez) ve içerik rename'den önce diske eşitlenir.
/// Geçici ad `.<ad>.<uuid>.gecici`; `<ad>` 255 − 45 bayta kırpılır (O2, uzun adda ENAMETOOLONG).
pub fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    use std::io::Write as _;
    let top = path.parent().filter(|u| !u.as_os_str().is_empty());
    if let Some(top) = top {
        fs::create_dir_all(top)?;
    }
    let name = path
        .file_name()
        .map(|a| a.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name =
        crate::files::truncate_bytes(&name, crate::files::NAME_MAX_BYTES - TEMP_SUFFIX_BYTES);
    let temp = path.with_file_name(format!(".{name}.{}.temp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut f = fs::File::create(&temp)?;
        f.write_all(data)?;
        f.sync_all()?;
        fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    } else if let Some(top) = top {
        // rename'in kendisi de kalıcı olsun (klasör girdisi); başarısızlık yazımı bozmaz.
        let _ = fs::File::open(top).and_then(|k| k.sync_all());
    }
    result
}

/// Yer imi okumasının sonucu.
pub struct ReadResult {
    pub bytes: Vec<u8>,
    /// Çözülen (güncel) yol: dosya taşındıysa değişir.
    pub path: PathBuf,
    /// Yer imi bayattı ve yeniden oluşturuldu: kaydedilecek yeni bayt.
    pub new_bookmark: Option<Vec<u8>>,
}

/// Okuma hatası; JS'e `KOD: mesaj` biçiminde gider (app/js/platform-tauri.js `sonAcilaniAc`).
#[derive(Debug, PartialEq, Eq)]
pub enum ReadError {
    /// Kimlik listede yok (ya da geçersiz kimlik). Keyfi yol da burada biter.
    Unknown,
    /// Dosya yok (silinmiş; taşınmışsa yer imi bulamadı). Kayıt kalıcı çıkar.
    NotFound(String),
    /// Kayıt geçersiz (yolun türü kayıttakiyle uyuşmuyor, yer imi bozuk: L3). Kayıt kalıcı çıkar.
    Invalid(String),
    /// Sistem erişim vermedi (entitlement eksik, farklı imzalı derleme, izinsiz klasör). Kayıt durur.
    Access(String),
    /// Dosyanın bulunduğu disk takılı değil (mesaj: diskin adı). Kayıt durur.
    NoDisk(String),
    /// Başka/geçici okuma hatası (dosya yerinde). Kayıt durur.
    Transient(String),
}

impl ReadError {
    /// Kayıt listeden kalıcı çıkarılır mı? Yalnız dosya yoksa ya da kayıt geçersizse.
    pub fn is_permanent(&self) -> bool {
        matches!(self, ReadError::NotFound(_) | ReadError::Invalid(_))
    }
}

impl std::fmt::Display for ReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReadError::Unknown => write!(
                f,
                "UNKNOWN: {}",
                crate::i18n::text("rust.last_unknown", &[])
            ),
            ReadError::NotFound(m) => write!(f, "NOTFOUND: {m}"),
            ReadError::Invalid(m) => write!(f, "INVALID: {m}"),
            ReadError::Access(m) => write!(f, "ACCESS: {m}"),
            ReadError::NoDisk(m) => write!(f, "NODISK: {m}"),
            ReadError::Transient(m) => write!(f, "TRANSIENT: {m}"),
        }
    }
}

/// Yer imi katmanının ham hatası; sınıflandırma (`siniflandir`) kayıtlı yolla yapılır.
#[derive(Debug)]
pub enum RawError {
    /// Yer imi çözülemedi (Cocoa hata açıklaması).
    Unresolved(String),
    /// Yer imi çözüldü, sistem güvenlik kapsamlı erişimi vermedi.
    AccessDenied(String),
    /// Erişim alındı, okuma başarısız.
    Read(io::Error),
}

/// Yer imi işlemleri (gerçek: `AppleYerImi`; testte sahte).
pub trait Bookmarks {
    /// Seçim anında (erişim canlıyken) yer imi oluşturur. `Ok(None)`: platform desteklemiyor.
    fn create(&self, path: &Path) -> Result<Option<Vec<u8>>, String>;
    /// Yer imini çözer, erişimi başlatır, `oku` ile içeriği okur, bayatsa yeni yer imi oluşturur ve erişimi
    /// **bırakır** (dönmeden önce).
    fn access_and_read(
        &self,
        bookmark: &[u8],
        read: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
    ) -> Result<ReadResult, RawError>;
}

/// `apple-scoped-bookmarks` ile gerçek uygulama.
pub struct AppleBookmarks;

impl Bookmarks for AppleBookmarks {
    fn create(&self, path: &Path) -> Result<Option<Vec<u8>>, String> {
        match apple_scoped_bookmarks::Bookmark::create(path) {
            Ok(b) => Ok(Some(b.into_bytes())),
            Err(apple_scoped_bookmarks::Error::Unsupported) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn access_and_read(
        &self,
        bookmark: &[u8],
        read: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
    ) -> Result<ReadResult, RawError> {
        use apple_scoped_bookmarks::{Bookmark, Error};
        let access = match Bookmark::from_bytes(bookmark.to_vec()).resolve() {
            Ok(e) => e,
            Err(Error::AccessDenied(p)) => {
                return Err(RawError::AccessDenied(crate::i18n::text(
                    "rust.access_denied",
                    &[("path", &p.display().to_string())],
                )))
            }
            Err(e) => return Err(RawError::Unresolved(e.to_string())),
        };
        // `erisim` bu blok bitince düşer: stopAccessingSecurityScopedResource (kısa ömürlü erişim).
        let bytes = read(access.path()).map_err(RawError::Read)?;
        let new_bookmark = if access.is_stale() {
            Bookmark::create(access.path()).ok().map(|b| b.into_bytes())
        } else {
            None
        };
        Ok(ReadResult {
            bytes,
            path: access.path().to_path_buf(),
            new_bookmark,
        })
    }
}

/// Yeni kayıt kurar (yer imini seçim anında oluşturur). Yer imi oluşturulamazsa kayıt yine eklenir
/// (yalnız bu oturumda / Apple dışı platformda düz yolla açılabilir); hata stderr'e yazılır.
pub fn make_entry(yi: &dyn Bookmarks, path: &Path, name: &str, kind: &str, date: u64) -> Entry {
    let bookmark = match yi.create(path) {
        Ok(v) => v.map(|b| base64::engine::general_purpose::STANDARD.encode(b)),
        Err(e) => {
            eprintln!("yer imi oluşturulamadı ({}): {e}", path.display());
            None
        }
    };
    Entry {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        kind: kind.to_string(),
        date,
        path: path.to_string_lossy().into_owned(),
        bookmark,
    }
}

/// Kayıtlı yol takılı olmayan bir diskte mi (`/Volumes/<ad>/…` ve `/Volumes/<ad>` yok)? Diskin adı.
pub fn unmounted_disk(path: &Path) -> Option<String> {
    unmounted_disk_in(path, Path::new("/Volumes"))
}

/// `takili_olmayan_disk`, bağlama klasörü verilerek (testte geçici klasör). L4: `/Volumes/<ad>` yoksa ya da
/// bir klasör olarak duruyor ama üzerine disk bağlı değilse (aygıtı `/Volumes` ile aynı: düzgün çıkarılmamış
/// diskten kalan boş klasör) disk takılı değildir. Sembolik bağ (`Macintosh HD -> /`) takılı sayılır.
pub fn unmounted_disk_in(path: &Path, volumes: &Path) -> Option<String> {
    let inner = path.strip_prefix(volumes).ok()?;
    let name = inner.components().next()?.as_os_str();
    let root = volumes.join(name);
    let mounted = match fs::symlink_metadata(&root) {
        Err(_) => false,
        Ok(m) if m.file_type().is_symlink() => true,
        Ok(m) => !m.is_dir() || !same_device(&root, volumes),
    };
    (!mounted).then(|| name.to_string_lossy().into_owned())
}

/// İki yol aynı dosya sisteminde mi (bağlama noktası değil)? Bilinemezse false (takılı sayılır).
fn same_device(a: &Path, b: &Path) -> bool {
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
pub fn remove_leftover_temps(folder: &Path, min_age: std::time::Duration) -> usize {
    let Ok(inner) = fs::read_dir(folder) else {
        return 0;
    };
    let now = std::time::SystemTime::now();
    let mut n = 0;
    for g in inner.flatten() {
        let name = g.file_name();
        let name = name.to_string_lossy();
        let prefix_of = name
            .strip_prefix('.')
            .and_then(|a| {
                a.strip_suffix(".temp")
                    .or_else(|| a.strip_suffix(crate::legacy::LEGACY_TEMP_SUFFIX))
            })
            .and_then(|a| a.rsplit_once('.'))
            .is_some_and(|(original, u)| !original.is_empty() && uuid::Uuid::parse_str(u).is_ok());
        if !prefix_of {
            continue;
        }
        let old = g
            .metadata()
            .ok()
            .filter(|m| m.file_type().is_file())
            .is_some_and(|m| {
                m.modified()
                    .ok()
                    .and_then(|t| now.duration_since(t).ok())
                    .is_some_and(|age| age >= min_age)
            });
        if old && fs::remove_file(g.path()).is_ok() {
            n += 1;
        }
    }
    n
}

/// Bir yol çözülürken izlenecek en çok sembolik bağ sayısı (macOS `MAXSYMLINKS` ile aynı: 32).
pub const SYMLINK_LIMIT: usize = 32;

/// L4: yolu, var olan bileşenlerindeki sembolik bağları izleyerek (zincir, göreli hedef, ara klasör
/// bağı) ve `.`/`..`'yı sözcüksel normalize ederek çözer. Var olmayan bileşenden sonrası yalnız normalize edilir
/// (takılı olmayan diskteki hedef de böylece `/Volumes/<ad>/…` olarak görünür). En çok `BAG_SINIRI` bağ izlenir;
/// döngüde ya da aşırı uzun zincirde o ana kadar çözülen yol döner (sonsuz döngü yok).
pub fn resolve_symlinks(path: &Path) -> PathBuf {
    use std::collections::VecDeque;
    use std::path::Component;
    let mut rest: VecDeque<std::ffi::OsString> = VecDeque::new();
    let mut resolved = PathBuf::new();
    let add =
        |k: &mut VecDeque<std::ffi::OsString>, resolved: &mut PathBuf, p: &Path, to_start: bool| {
            let mut parts = Vec::new();
            for c in p.components() {
                match c {
                    Component::RootDir => {
                        *resolved = PathBuf::from("/");
                        parts.clear();
                    }
                    Component::Prefix(_) => {}
                    Component::CurDir => {}
                    Component::ParentDir => parts.push(std::ffi::OsString::from("..")),
                    Component::Normal(n) => parts.push(n.to_os_string()),
                }
            }
            if to_start {
                for p in parts.into_iter().rev() {
                    k.push_front(p);
                }
            } else {
                k.extend(parts);
            }
        };
    add(&mut rest, &mut resolved, path, false);
    let mut followed = 0usize;
    let mut var_may = true;
    while let Some(p) = rest.pop_front() {
        if p == ".." {
            resolved.pop();
            continue;
        }
        let candidate = resolved.join(&p);
        if var_may && followed < SYMLINK_LIMIT {
            match fs::symlink_metadata(&candidate) {
                Ok(m) if m.file_type().is_symlink() => {
                    if let Ok(target) = fs::read_link(&candidate) {
                        followed += 1;
                        // göreli hedef bağın klasörüne göre (cozulen), mutlak hedef kökten
                        add(&mut rest, &mut resolved, &target, true);
                        continue;
                    }
                }
                Ok(_) => {}
                Err(_) => var_may = false, // sonrası diskte yok: yalnız normalize
            }
        }
        resolved = candidate;
    }
    if resolved.as_os_str().is_empty() {
        resolved.push(".");
    }
    resolved
}

/// Ham hatayı kullanıcıya gidecek koda çevirir. Disk takılı değilse her hata `DiskYok`: kayıtlı yol ya da
/// sembolik bağları çözülmüş hali (`bag_cozumle`: zincir, göreli hedef, ara klasör bağı) takılı
/// olmayan diskteyse. Yer imi çözülemediyse kayıtlı yolun `lstat`'ı belirler (yok → Bulunamadi, izinsiz → Erisim,
/// var → Gecici; bağsa hedefin `stat`'ı: yok → Bulunamadi, döngü/başka → Gecici).
pub fn classify(saved_path: &Path, raw: RawError) -> ReadError {
    if let Some(disk) =
        unmounted_disk(saved_path).or_else(|| unmounted_disk(&resolve_symlinks(saved_path)))
    {
        return ReadError::NoDisk(disk);
    }
    match raw {
        RawError::AccessDenied(m) => ReadError::Access(m),
        RawError::Read(e) => match e.kind() {
            io::ErrorKind::NotFound => ReadError::NotFound(e.to_string()),
            io::ErrorKind::PermissionDenied => ReadError::Access(e.to_string()),
            io::ErrorKind::InvalidInput => ReadError::Invalid(e.to_string()),
            _ => ReadError::Transient(e.to_string()),
        },
        RawError::Unresolved(m) => match fs::symlink_metadata(saved_path) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => ReadError::NotFound(m),
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied => ReadError::Access(m),
            // L4: kayıtlı yol sembolik bağsa hedefine bakılır (ölü bağ sonsuza dek "geçici" kalmasın); hedef
            // takılı olmayan diskteyse yukarıda DiskYok döndü.
            Ok(b) if b.file_type().is_symlink() => match fs::metadata(saved_path) {
                Err(e) if e.kind() == io::ErrorKind::NotFound => ReadError::NotFound(m),
                Err(e) if e.kind() == io::ErrorKind::PermissionDenied => ReadError::Access(m),
                _ => ReadError::Transient(m),
            },
            _ => ReadError::Transient(m),
        },
    }
}

/// Adım 1 (liste kilitliyken, kısa): kimliği doğrular ve kaydın kopyasını verir. Bilinmeyen/geçersiz
/// kimlik → `Bilinmeyen` (dosya sistemine hiç dokunulmaz).
pub fn take_entry(list: &RecentList, id: &str) -> Result<Entry, ReadError> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(ReadError::Unknown);
    }
    list.find(id).cloned().ok_or(ReadError::Unknown)
}

/// Adım 2 (KİLİTSİZ; büyük EPUB'da uzun sürebilir): kaydı yer imiyle ya da düz yolla okur. Yolun türü
/// kayıttakiyle uyuşmazsa (D7; yer imli kayıtta çözülen yol) hiç okunmaz: `Gecersiz`.
pub fn read_entry(
    entry: &Entry,
    yi: &dyn Bookmarks,
    read_content: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
) -> Result<ReadResult, ReadError> {
    let kind = entry.kind.as_str();
    let mismatch = || {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            crate::i18n::text("rust.kind_mismatch", &[("kind", kind)]),
        )
    };
    let checked = |p: &Path| -> io::Result<Vec<u8>> {
        let epub_with_extension = p
            .extension()
            .is_some_and(|u| u.eq_ignore_ascii_case("epub"));
        if kind == "epub" && epub_with_extension && p.is_dir() {
            // L1: klasör paketi; içi okunamıyorsa (izin, iCloud'dan inmemiş) kalıcı "geçersiz" değil.
            use crate::epub_folder::{package_state, PackageState};
            match package_state(p) {
                PackageState::Package => {}
                PackageState::NotPackage => return Err(mismatch()),
                PackageState::Unreadable(e) => return Err(e),
            }
        } else if crate::files::detect_kind(p) != Some(kind) {
            return Err(mismatch());
        }
        read_content(p)
    };
    let registered = Path::new(&entry.path);
    match entry.bookmark.as_deref() {
        Some(b64) => match base64::engine::general_purpose::STANDARD.decode(b64) {
            Ok(b) => yi
                .access_and_read(&b, &checked)
                .map_err(|h| classify(registered, h)),
            Err(e) => Err(ReadError::Invalid(crate::i18n::text(
                "rust.bookmark_corrupt",
                &[("error", &e.to_string())],
            ))),
        },
        None => checked(registered)
            .map(|bytes| ReadResult {
                bytes,
                path: registered.to_path_buf(),
                new_bookmark: None,
            })
            .map_err(|e| classify(registered, RawError::Read(e))),
    }
}

/// Adım 3 (liste kilitliyken, kısa): başarıda kayıt başa alınır (bayatsa yer imi/yol yenilenir); hata
/// kalıcıysa kayıt çıkar, değilse durur. Kayıt bu arada temizlendiyse liste değişmez.
pub fn apply_result(
    list: &mut RecentList,
    entry: &Entry,
    date: u64,
    result: Result<ReadResult, ReadError>,
) -> Result<(Vec<u8>, Summary), ReadError> {
    match result {
        Ok(o) => {
            let new_path = o.path.to_string_lossy().into_owned();
            let new_path = (new_path != entry.path && !new_path.is_empty()).then_some(new_path);
            let new_bookmark = o
                .new_bookmark
                .map(|b| base64::engine::general_purpose::STANDARD.encode(b));
            list.move_to_front(&entry.id, date, new_bookmark, new_path);
            let summary = list
                .find(&entry.id)
                .map(Summary::from)
                .unwrap_or_else(|| Summary::from(entry));
            Ok((o.bytes, summary))
        }
        Err(e) => {
            if e.is_permanent() {
                list.forget(&entry.id);
            }
            Err(e)
        }
    }
}

/// Listedeki kaydı okur (üç adım tek kilitte; uygulama `files::son_kaydi_oku` ile okumayı kilitsiz yapar).
/// Dönüş: (bayt, kaydın özeti). `liste` değiştiyse çağıran kaydeder ve menüyü yeniler.
pub fn read(
    list: &mut RecentList,
    yi: &dyn Bookmarks,
    id: &str,
    date: u64,
    read_content: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
) -> Result<(Vec<u8>, Summary), ReadError> {
    let entry = take_entry(list, id)?;
    let result = read_entry(&entry, yi, read_content);
    apply_result(list, &entry, date, result)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::cell::RefCell;

    fn k(path: &str) -> Entry {
        Entry {
            id: uuid::Uuid::new_v4().to_string(),
            name: Path::new(path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            kind: if path.ends_with(".epub") {
                "epub"
            } else {
                "pdf"
            }
            .into(),
            date: 1,
            path: path.into(),
            bookmark: None,
        }
    }

    fn temp_folder() -> PathBuf {
        let d = std::env::temp_dir().join(format!("mc-last-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// (L4 elle adımı için gözlem): kayıt, Rust'a verilen yolu (sembolik bağın kendi yolu) OLDUĞU GİBİ tutar
    /// (çözmez). Gerçek Apple yer imi bağ yolundan oluşturulur; çözümünde dönen yol aşağıda sabitlenir. Hangi yolun
    /// geldiği Aç penceresine bağlıdır: NSOpenPanel `resolvesAliases` öntanımlı açık (rfd değiştirmiyor).
    #[cfg(target_os = "macos")]
    #[test]
    fn entry_keeps_symlink_path_bookmark_observation() {
        use std::os::unix::fs::symlink;
        let d = temp_folder().canonicalize().unwrap();
        let target = d.join("hedef.pdf");
        fs::write(&target, b"%PDF-1.4 0b").unwrap();
        let bag = d.join("bag.pdf");
        symlink(&target, &bag).unwrap();
        let entry = make_entry(&AppleBookmarks, &bag, "bag.pdf", "pdf", 1);
        assert_eq!(entry.path, bag.to_string_lossy(), "kayıt bağ yolunu tutar");
        assert_eq!(entry.name, "bag.pdf");
        let bookmark = entry
            .bookmark
            .as_deref()
            .map(|b| base64::engine::general_purpose::STANDARD.decode(b).unwrap());
        eprintln!(
            "0b gözlem: yer imi {}",
            if bookmark.is_some() {
                "oluştu"
            } else {
                "none"
            }
        );
        if let Some(b) = bookmark {
            let o = AppleBookmarks
                .access_and_read(&b, &|p: &Path| fs::read(p))
                .unwrap_or_else(|e| panic!("yer imi çözülemedi: {e:?}"));
            eprintln!("0b gözlem: çözülen yol {}", o.path.display());
            assert_eq!(o.bytes, b"%PDF-1.4 0b");
            // Gözlem (macOS 26.6.2): bağ yolundan oluşturulan yer imi HEDEF dosyaya çözülür.
            assert_eq!(o.path, target, "yer imi bağı izler, hedefin yolunu verir");
            // Son Açılanlar'dan ilk başarılı açılışta kayıt yolu çözülen (hedef) yola güncellenir; ad aynı kalır.
            let mut l = RecentList::default();
            let id = l.add(entry.clone());
            let (bytes, summary) =
                read(&mut l, &AppleBookmarks, &id, 2, &|p: &Path| fs::read(p)).unwrap();
            assert_eq!(bytes, b"%PDF-1.4 0b");
            assert_eq!(summary.name, "bag.pdf");
            assert_eq!(
                l.find(&id).unwrap().path,
                target.to_string_lossy(),
                "açılıştan sonra kayıt hedef yolu tutar"
            );
        }
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn mru_newest_first_same_path_moves_up_keeps_id_max_10() {
        let mut l = RecentList::default();
        let first = l.add(k("/a/0.pdf"));
        for i in 1..12 {
            l.add(k(&format!("/a/{i}.pdf")));
        }
        assert_eq!(l.entries.len(), MAX_ENTRIES);
        let paths: Vec<&str> = l.entries.iter().map(|k| k.path.as_str()).collect();
        assert_eq!(paths[0], "/a/11.pdf");
        assert_eq!(paths[9], "/a/2.pdf");
        assert!(
            l.entries
                .iter()
                .all(|k| k.path != "/a/0.pdf" && k.path != "/a/1.pdf"),
            "en eskiler düştü"
        );
        assert!(l.find(&first).is_none());
        // aynı yol yeniden: başa gelir, tek kalır, kimliği korunur
        let old = l.entries[5].id.clone();
        let path = l.entries[5].path.clone();
        let returned = l.add(k(&path));
        assert_eq!(returned, old);
        assert_eq!(l.entries[0].id, old);
        assert_eq!(l.entries.iter().filter(|k| k.path == path).count(), 1);
        assert_eq!(l.entries.len(), MAX_ENTRIES);
    }

    #[test]
    fn forget_and_move_to_front() {
        let mut l = RecentList::default();
        let a = l.add(k("/a.pdf"));
        let b = l.add(k("/b.pdf"));
        l.move_to_front(&a, 99, Some("NEW".into()), Some("/tasindi/a.pdf".into()));
        assert_eq!(l.entries[0].id, a);
        assert_eq!(l.entries[0].date, 99);
        assert_eq!(l.entries[0].bookmark.as_deref(), Some("NEW"));
        assert_eq!(l.entries[0].path, "/tasindi/a.pdf");
        assert!(l.forget(&b));
        assert!(!l.forget(&b));
        assert_eq!(l.entries.len(), 1);
    }

    #[test]
    fn corrupt_json_or_missing_file_gives_empty_list_invalid_entries_dropped() {
        let d = temp_folder();
        let path = d.join(FILE_NAME);
        assert_eq!(RecentList::load(&path), RecentList::default(), "dosya yok");
        for corrupt in [
            "",
            "{",
            "null",
            "[]",
            "{\"entries\": 5}",
            "\u{0}\u{1}",
            "{\"entries\":[{\"id\":1}]}",
        ] {
            fs::write(&path, corrupt).unwrap();
            assert_eq!(
                RecentList::load(&path),
                RecentList::default(),
                "{corrupt:?}"
            );
        }
        // geçerli + geçersiz kimlik + bilinmeyen tür + 12 kayıt → 10 geçerli
        let mut l = RecentList::default();
        for i in 0..12 {
            l.entries.push(k(&format!("/x/{i}.pdf")));
        }
        l.entries[0].id = "../../etc/passwd".into();
        l.entries[1].kind = "exe".into();
        l.save(&path).unwrap();
        let restored = RecentList::load(&path);
        assert_eq!(restored.entries.len(), 10);
        assert!(restored
            .entries
            .iter()
            .all(|k| k.path != "/x/0.pdf" && k.path != "/x/1.pdf"));
        assert_eq!(temp_files(&d), Vec::<String>::new(), "geçici dosya kalmadı");
        fs::remove_dir_all(&d).unwrap();
    }

    /// L2: klasördeki `.gecici` uzantılı dosyalar (atomik_yaz'ın adı `.<ad>.<uuid>.gecici`; eski denetim sabit
    /// `<ad>.gecici` adını aradığı için hep geçiyordu).
    pub(crate) fn temp_files(d: &Path) -> Vec<String> {
        let mut l: Vec<String> = fs::read_dir(d)
            .unwrap()
            .map(|g| g.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|a| a.ends_with(".temp"))
            .collect();
        l.sort();
        l
    }

    /// L1: klasör paketi EPUB'un içi okunamıyorsa (iCloud'dan inmemiş/dataless, izinsiz META-INF) kayıt
    /// SİLİNMEZ; içi okunabilen ama container.xml'i olmayan klasör gerçekten geçersizdir (silinir).
    #[cfg(unix)]
    #[test]
    fn entry_stays_when_folder_package_contents_unreadable() {
        use std::os::unix::fs::PermissionsExt;
        let d = temp_folder();
        let locked = d.join("Kilitli.epub");
        fs::create_dir_all(locked.join("META-INF")).unwrap();
        fs::write(locked.join("META-INF/container.xml"), "<c/>").unwrap();
        fs::write(locked.join("mimetype"), "application/epub+zip").unwrap();
        let blank = d.join("Inmemis.epub");
        fs::create_dir_all(&blank).unwrap();
        let fake = d.join("Sahte.epub");
        fs::create_dir_all(&fake).unwrap();
        fs::write(fake.join("not.txt"), "x").unwrap();
        let mut l = RecentList::default();
        let ka = l.add(k(locked.to_str().unwrap()));
        let kb = l.add(make_entry(&Fake::new(), &locked, "Kilitli.epub", "epub", 1));
        let mc = l.add(k(blank.to_str().unwrap()));
        let kd = l.add(k(fake.to_str().unwrap()));
        fs::set_permissions(locked.join("META-INF"), fs::Permissions::from_mode(0o000)).unwrap();
        let read_fn = |p: &Path| crate::files::read_content(p);
        let result: Vec<String> = [&ka, &kb, &mc, &kd]
            .iter()
            .map(|id| {
                read(&mut l, &Fake::new(), id, 2, &read_fn)
                    .map(|_| "OK".to_string())
                    .unwrap_or_else(|h| h.to_string())
            })
            .collect();
        fs::set_permissions(locked.join("META-INF"), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(
            result[0].starts_with("ACCESS:"),
            "unpermitted META-INF (place noBookmark): {}",
            result[0]
        );
        assert!(
            result[1].starts_with("ACCESS:"),
            "unpermitted META-INF (place imli): {}",
            result[1]
        );
        assert!(
            result[2].starts_with("TRANSIENT:"),
            "içi boş (inmemiş) paket: {}",
            result[2]
        );
        assert!(
            result[3].starts_with("INVALID:"),
            "container.xml'siz klasör: {}",
            result[3]
        );
        for id in [&ka, &kb, &mc] {
            assert!(l.find(id).is_some(), "içi okunamayan paket kaydı durur");
        }
        assert!(l.find(&kd).is_none(), "gerçekten geçersiz klasör çıkarılır");
        // izin geri gelince aynı kayıt açılır
        assert!(read(&mut l, &Fake::new(), &ka, 3, &read_fn).is_ok());
        fs::remove_dir_all(&d).unwrap();
    }

    /// L4: hedefi silinmiş sembolik bağ "geçici" değil "bulunamadı" (kalıcı çıkar); hedefi takılı olmayan
    /// diskteyse "disk yok". Boş kalmış bağlama klasörü (`/Volumes/<ad>` var ama disk bağlı değil) disk
    /// takılı sayılmaz; `/Volumes/Macintosh HD` gibi sembolik bağ takılıdır.
    #[cfg(unix)]
    #[test]
    fn dead_symlink_not_found_empty_mount_folder_no_disk() {
        use std::os::unix::fs::symlink;
        struct Unresolvable;
        impl Bookmarks for Unresolvable {
            fn create(&self, path: &Path) -> Result<Option<Vec<u8>>, String> {
                Ok(Some(path.to_string_lossy().as_bytes().to_vec()))
            }
            fn access_and_read(
                &self,
                _: &[u8],
                _: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
            ) -> Result<ReadResult, RawError> {
                Err(RawError::Unresolved("The file doesn’t exist.".into()))
            }
        }
        let d = temp_folder();
        let target = d.join("hedef.pdf");
        fs::write(&target, b"%PDF").unwrap();
        let bag = d.join("bag.pdf");
        symlink(&target, &bag).unwrap();
        let bag2 = d.join("bag2.pdf");
        symlink(&target, &bag2).unwrap();
        let disk = format!("mc-mounted-non-{}", uuid::Uuid::new_v4());
        let disk_bag = d.join("disk-bag.pdf");
        symlink(format!("/Volumes/{disk}/a.pdf"), &disk_bag).unwrap();
        fs::remove_file(&target).unwrap();
        let mut l = RecentList::default();
        let ka = l.add(make_entry(&Unresolvable, &bag, "bag.pdf", "pdf", 1));
        let kb = l.add(k(bag2.to_str().unwrap()));
        let mc = l.add(make_entry(
            &Unresolvable,
            &disk_bag,
            "disk-bag.pdf",
            "pdf",
            1,
        ));
        let read_fn = |p: &Path| fs::read(p);
        let error = |l: &mut RecentList, id: &str| {
            read(l, &Unresolvable, id, 2, &read_fn)
                .unwrap_err()
                .to_string()
        };
        let ha = error(&mut l, &ka);
        let hb = error(&mut l, &kb);
        let hc = error(&mut l, &mc);
        assert!(ha.starts_with("NOTFOUND:"), "ölü bağ (yer imli): {ha}");
        assert!(hb.starts_with("NOTFOUND:"), "ölü bağ (yer imsiz): {hb}");
        assert!(
            hc.starts_with("NODISK:") && hc.contains(&disk),
            "bağın hedefi takılı olmayan diskte: {hc}"
        );
        assert!(
            l.find(&ka).is_none() && l.find(&kb).is_none(),
            "ölü bağ kaydı çıkar"
        );
        assert!(l.find(&mc).is_some(), "disk yoksa kayıt durur");
        // bağlama klasörü
        let vol = d.join("Volumes");
        fs::create_dir_all(vol.join("Bos")).unwrap();
        symlink("/", vol.join("Kok")).unwrap();
        assert_eq!(
            unmounted_disk_in(&vol.join("Bos/Kitap/a.pdf"), &vol),
            Some("Bos".into()),
            "boş bağlama klasörü: disk takılı değil"
        );
        assert_eq!(
            unmounted_disk_in(&vol.join("Yok/a.pdf"), &vol),
            Some("Yok".into())
        );
        assert_eq!(
            unmounted_disk_in(&vol.join("Kok/Users/a.pdf"), &vol),
            None,
            "sembolik bağ (Macintosh HD gibi) takılı"
        );
        assert_eq!(
            unmounted_disk_in(Path::new("/Users/x/a.pdf"), &vol),
            None,
            "Volumes dışı"
        );
        assert_eq!(unmounted_disk_in(&vol, &vol), None, "disk adı yok");
        assert_eq!(
            unmounted_disk(Path::new("/Volumes/Macintosh HD/Users/a.pdf")),
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
    fn symlink_chain_relative_target_intermediate_folder_no_disk() {
        use std::os::unix::fs::symlink;
        struct Unresolvable;
        impl Bookmarks for Unresolvable {
            fn create(&self, path: &Path) -> Result<Option<Vec<u8>>, String> {
                Ok(Some(path.to_string_lossy().as_bytes().to_vec()))
            }
            fn access_and_read(
                &self,
                _: &[u8],
                _: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
            ) -> Result<ReadResult, RawError> {
                Err(RawError::Unresolved("The file doesn’t exist.".into()))
            }
        }
        let d = temp_folder();
        let disk = format!("mc-mounted-non-{}", uuid::Uuid::new_v4());
        let vol = format!("/Volumes/{disk}");
        let deep = "../".repeat(d.components().count() + 3);
        // zincir: zincir1 -> zincir2 -> /Volumes/<disk>/a.pdf
        symlink(format!("{vol}/a.pdf"), d.join("zincir2.pdf")).unwrap();
        symlink(d.join("zincir2.pdf"), d.join("zincir1.pdf")).unwrap();
        // göreli hedef (normalize edilmeden /Volumes önekini taşımaz) ve göreli zincir
        symlink(format!("{deep}Volumes/{disk}/b.pdf"), d.join("goreli.pdf")).unwrap();
        symlink("goreli.pdf", d.join("goreli-zincir.pdf")).unwrap();
        symlink(
            format!("./alt/../{deep}Volumes/./{disk}/c.pdf"),
            d.join("noktali.pdf"),
        )
        .unwrap();
        // ara klasör bağı: d/disk-klasor -> /Volumes/<disk>/Kitaplar; kayıt d/disk-klasor/c.pdf
        symlink(format!("{vol}/Kitaplar"), d.join("disk-folder")).unwrap();
        // 10 halkalı zincir
        symlink(format!("{vol}/uzun.pdf"), d.join("halka0.pdf")).unwrap();
        for i in 1..10 {
            symlink(
                format!("halka{}.pdf", i - 1),
                d.join(format!("halka{i}.pdf")),
            )
            .unwrap();
        }
        let paths = [
            d.join("zincir1.pdf"),
            d.join("goreli.pdf"),
            d.join("goreli-zincir.pdf"),
            d.join("noktali.pdf"),
            d.join("disk-folder/c.pdf"),
            d.join("halka9.pdf"),
        ];
        let read_fn = |p: &Path| fs::read(p);
        let mut failed = Vec::new();
        for y in &paths {
            let name = y.file_name().unwrap().to_string_lossy().into_owned();
            // aynı yolda tek kayıt olur (Liste::ekle): yer imli ve yer imsiz ayrı listelerde
            for (entry, kind) in [
                (make_entry(&Unresolvable, y, &name, "pdf", 1), "yer imli"),
                (k(y.to_str().unwrap()), "yer imsiz"),
            ] {
                assert_eq!(entry.bookmark.is_some(), kind == "yer imli");
                let mut l = RecentList::default();
                let id = l.add(entry);
                let h = read(&mut l, &Unresolvable, &id, 2, &read_fn)
                    .unwrap_err()
                    .to_string();
                if !(h.starts_with("NODISK:") && h.contains(&disk)) || l.find(&id).is_none() {
                    failed.push(format!(
                        "{kind} {}: {h} (kayıt {})",
                        name,
                        if l.find(&id).is_some() {
                            "stopped"
                        } else {
                            "SİLİNDİ"
                        }
                    ));
                }
            }
        }
        assert!(failed.is_empty(), "{failed:#?}");
        let mut l = RecentList::default();
        // döngü ve sınırı aşan zincir: biter, DISKYOK değil, kayıt durur (kalıcı silme yok)
        symlink(d.join("dongu2.pdf"), d.join("dongu1.pdf")).unwrap();
        symlink(d.join("dongu1.pdf"), d.join("dongu2.pdf")).unwrap();
        symlink(format!("{vol}/cok-uzun.pdf"), d.join("u0.pdf")).unwrap();
        for i in 1..=SYMLINK_LIMIT + 5 {
            symlink(format!("u{}.pdf", i - 1), d.join(format!("u{i}.pdf"))).unwrap();
        }
        for y in [
            d.join("dongu1.pdf"),
            d.join(format!("u{}.pdf", SYMLINK_LIMIT + 5)),
        ] {
            let id = l.add(make_entry(&Unresolvable, &y, "x.pdf", "pdf", 1));
            let h = read(&mut l, &Unresolvable, &id, 2, &read_fn)
                .unwrap_err()
                .to_string();
            assert!(!h.starts_with("NODISK:"), "{}: {h}", y.display());
            assert!(l.find(&id).is_some(), "{}: {h}", y.display());
        }
        // yol çözücünün kendisi: normalize + sınır
        assert_eq!(
            resolve_symlinks(&d.join("goreli.pdf")),
            PathBuf::from(format!("{vol}/b.pdf"))
        );
        assert_eq!(
            resolve_symlinks(Path::new("/a/./b/../c")),
            PathBuf::from("/a/c"),
            "bağsız yol yalnız normalize edilir"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// L7: çökme artığı geçici dosyalar (`.<ad>.<uuid>.gecici`, belli bir yaştan eski) açılışta silinir;
    /// taze olanlar (şu an yazılıyor olabilir), kalıba uymayanlar, klasör ve bağlar dokunulmaz.
    #[cfg(unix)]
    #[test]
    fn leftover_temp_files_are_removed() {
        use std::time::{Duration, SystemTime};
        let d = temp_folder();
        let old = |name: &str| {
            let y = d.join(name);
            let f = fs::File::create(&y).unwrap();
            f.set_modified(SystemTime::now() - Duration::from_secs(7200))
                .unwrap();
            y
        };
        let u = || uuid::Uuid::new_v4().to_string();
        let artik1 = old(&format!(".projects.json.{}.temp", u()));
        let artik2 = old(&format!(".recent-files.json.{}.temp", u()));
        let fresh = d.join(format!(".projects.json.{}.temp", u()));
        fs::write(&fresh, "{}").unwrap();
        let without_pattern = old(".hidden.temp");
        let without_uuid = old(".projects.json.abc.temp");
        let original = old("projects.json");
        let folder = d.join(format!(".x.{}.temp", u()));
        fs::create_dir_all(&folder).unwrap();
        let bag_target = old("hedef.txt");
        let bag = d.join(format!(".bag.{}.temp", u()));
        std::os::unix::fs::symlink(&bag_target, &bag).unwrap();
        let n = remove_leftover_temps(&d, Duration::from_secs(60));
        assert_eq!(n, 2, "iki eski artık silindi");
        assert!(
            !artik1.exists() && !artik2.exists(),
            "eski artıklar silindi"
        );
        for rest in [
            &fresh,
            &without_pattern,
            &without_uuid,
            &original,
            &folder,
            &bag_target,
        ] {
            assert!(rest.exists(), "dokunulmamalı: {}", rest.display());
        }
        assert!(fs::symlink_metadata(&bag).is_ok(), "bağ dokunulmadı");
        assert_eq!(
            remove_leftover_temps(&d.join("none"), Duration::from_secs(60)),
            0,
            "klasör yok"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// Sahte yer imi: bayt = yolun kendisi; `bayat` ve `reddet` ile davranış seçilir; erişim sayacı açık
    /// erişim kalmadığını (kısa ömürlü) denetler.
    struct Fake {
        stale: bool,
        reject: bool,
        is_open: RefCell<i32>,
        max_open: RefCell<i32>,
    }
    impl Fake {
        fn new() -> Self {
            Fake {
                stale: false,
                reject: false,
                is_open: RefCell::new(0),
                max_open: RefCell::new(0),
            }
        }
    }
    impl Bookmarks for Fake {
        fn create(&self, path: &Path) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(path.to_string_lossy().as_bytes().to_vec()))
        }
        /// Gerçek macOS gibi: dosya yoksa (ya da diski takılı değilse) yer imi çözülemez.
        fn access_and_read(
            &self,
            b: &[u8],
            read: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
        ) -> Result<ReadResult, RawError> {
            if self.reject {
                return Err(RawError::AccessDenied("rejected".into()));
            }
            let path = PathBuf::from(String::from_utf8(b.to_vec()).unwrap());
            if !path.exists() {
                return Err(RawError::Unresolved("The file doesn’t exist.".into()));
            }
            *self.is_open.borrow_mut() += 1;
            let now_open = *self.is_open.borrow();
            let mut max = self.max_open.borrow_mut();
            *max = (*max).max(now_open);
            drop(max);
            let r = read(&path);
            *self.is_open.borrow_mut() -= 1;
            let bytes = r.map_err(RawError::Read)?;
            Ok(ReadResult {
                bytes,
                path: path.clone(),
                new_bookmark: self.stale.then(|| b"NEW".to_vec()),
            })
        }
    }

    #[test]
    fn read_rejects_unknown_and_arbitrary_path_id_without_touching_files() {
        let d = temp_folder();
        let actual = d.join("gizli.pdf");
        fs::write(&actual, b"%PDF-hidden").unwrap();
        let mut l = RecentList::default();
        l.add(make_entry(
            &Fake::new(),
            &d.join("var.pdf"),
            "var.pdf",
            "pdf",
            1,
        ));
        let touched = RefCell::new(Vec::<PathBuf>::new());
        let read_fn = |p: &Path| {
            touched.borrow_mut().push(p.to_path_buf());
            fs::read(p)
        };
        for id in [
            "",
            actual.to_str().unwrap(),
            "/etc/hosts",
            "../../etc/passwd",
            "file:///etc/hosts",
            &uuid::Uuid::new_v4().to_string(),
            "00000000-0000-0000-0000-000000000000",
        ] {
            assert_eq!(
                read(&mut l, &Fake::new(), id, 2, &read_fn).unwrap_err(),
                ReadError::Unknown,
                "{id}"
            );
        }
        assert!(
            touched.borrow().is_empty(),
            "bilinmeyen kimlikte dosya okunmamalı"
        );
        assert_eq!(l.entries.len(), 1, "bilinmeyen kimlik listeyi değiştirmez");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn read_success_moves_to_front_renews_stale_bookmark_short_lived_access() {
        let d = temp_folder();
        let a = d.join("a.pdf");
        let b = d.join("b.pdf");
        fs::write(&a, b"%PDF-a").unwrap();
        fs::write(&b, b"%PDF-b").unwrap();
        let yi = Fake {
            stale: true,
            ..Fake::new()
        };
        let mut l = RecentList::default();
        let ka = l.add(make_entry(&yi, &a, "a.pdf", "pdf", 1));
        l.add(make_entry(&yi, &b, "b.pdf", "pdf", 1));
        let (bytes, summary) = read(&mut l, &yi, &ka, 50, &|p: &Path| fs::read(p)).unwrap();
        assert_eq!(bytes, b"%PDF-a");
        assert_eq!(summary.name, "a.pdf");
        assert_eq!(l.entries[0].id, ka, "okunan başa alındı");
        assert_eq!(l.entries[0].date, 50);
        assert_eq!(
            l.entries[0].bookmark.as_deref(),
            Some("TkVX"),
            "stale place mark yenilendi (base64 'NEW')"
        );
        assert_eq!(*yi.is_open.borrow(), 0, "erişim bırakıldı");
        assert_eq!(*yi.max_open.borrow(), 1);
        fs::remove_dir_all(&d).unwrap();
    }

    /// S11c: silinmiş dosya "bulunamadı" ve listeden kalıcı çıkar (yer imli ve yer imsiz kayıt).
    #[test]
    fn read_deleted_entry_not_found_and_removed_from_list() {
        let d = temp_folder();
        let a = d.join("silinecek.pdf");
        let b = d.join("duz-silinecek.pdf");
        fs::write(&a, b"%PDF").unwrap();
        fs::write(&b, b"%PDF").unwrap();
        let mut l = RecentList::default();
        let ka = l.add(make_entry(&Fake::new(), &a, "silinecek.pdf", "pdf", 1));
        let kb = l.add(k(b.to_str().unwrap()));
        let mc = l.add(k(d.join("kalan.pdf").to_str().unwrap()));
        fs::remove_file(&a).unwrap();
        fs::remove_file(&b).unwrap();
        for id in [&ka, &kb] {
            let h = read(&mut l, &Fake::new(), id, 2, &|p: &Path| fs::read(p)).unwrap_err();
            assert!(h.to_string().starts_with("NOTFOUND:"), "{h}");
            assert!(l.find(id).is_none(), "bulunamayan çıkarıldı");
        }
        assert!(l.find(&mc).is_some(), "ötekiler durur");
        fs::remove_dir_all(&d).unwrap();
    }

    /// O4: erişim reddi kaydı SİLMEZ (entitlement/imza farkı geçici olabilir); ayrımlı "ERISIM:" kodu.
    #[test]
    fn access_denied_keeps_the_entry() {
        let d = temp_folder();
        let a = d.join("izinsiz.pdf");
        fs::write(&a, b"%PDF").unwrap();
        let mut l = RecentList::default();
        let ka = l.add(make_entry(&Fake::new(), &a, "izinsiz.pdf", "pdf", 1));
        let red = Fake {
            reject: true,
            ..Fake::new()
        };
        let h = read(&mut l, &red, &ka, 2, &|p: &Path| fs::read(p)).unwrap_err();
        assert!(h.to_string().starts_with("ACCESS:"), "{h}");
        assert!(l.find(&ka).is_some(), "erişim reddinde kayıt durur");
        // yer imsiz kayıtta okuma izin hatası (sandbox EPERM) de kaydı tutar
        let kb = l.add(k(a.to_str().unwrap()));
        let unpermitted = |_: &Path| -> io::Result<Vec<u8>> {
            Err(io::Error::from(io::ErrorKind::PermissionDenied))
        };
        let h = read(&mut l, &Fake::new(), &kb, 2, &unpermitted).unwrap_err();
        assert!(h.to_string().starts_with("ACCESS:"), "{h}");
        assert!(l.find(&kb).is_some());
        fs::remove_dir_all(&d).unwrap();
    }

    /// O4: takılı olmayan diskteki (`/Volumes/<ad>` yok) kayıt silinmez; "DISKYOK:" kodu diskin adını verir.
    #[test]
    fn unmounted_disk_keeps_the_entry() {
        let disk = format!("mc-mounted-non-{}", uuid::Uuid::new_v4());
        let path = format!("/Volumes/{disk}/Kitaplar/tez.pdf");
        let mut l = RecentList::default();
        let ka = l.add(k(&path)); // yer imsiz
        let kb = l.add(make_entry(
            &Fake::new(),
            Path::new(&path.replace("tez", "iki")),
            "iki.pdf",
            "pdf",
            1,
        )); // yer imli: çözülemez
        for id in [&ka, &kb] {
            let h = read(&mut l, &Fake::new(), id, 2, &|p: &Path| fs::read(p)).unwrap_err();
            let m = h.to_string();
            assert!(m.starts_with("NODISK:") && m.contains(&disk), "{m}");
            assert!(l.find(id).is_some(), "takılı olmayan diskteki kayıt durur");
        }
    }

    /// O4: geçici okuma hatası (dosya yerinde) kaydı tutar; "GECICI:" kodu.
    #[test]
    fn transient_read_error_keeps_the_entry() {
        let d = temp_folder();
        let a = d.join("yerinde.pdf");
        fs::write(&a, b"%PDF").unwrap();
        let mut l = RecentList::default();
        let ka = l.add(k(a.to_str().unwrap()));
        let kb = l.add(make_entry(&Fake::new(), &a, "yerinde.pdf", "pdf", 1));
        let mounted = |_: &Path| -> io::Result<Vec<u8>> {
            Err(io::Error::other("Resource deadlock avoided"))
        };
        for id in [&ka, &kb] {
            let h = read(&mut l, &Fake::new(), id, 2, &mounted).unwrap_err();
            assert!(h.to_string().starts_with("TRANSIENT:"), "{h}");
            assert!(l.find(id).is_some(), "geçici hatada kayıt durur");
        }
        fs::remove_dir_all(&d).unwrap();
    }

    /// O4: yer imi çözülemedi ama dosya yerinde (lstat: var) → GECICI; üst klasör kilitli (lstat: EACCES;
    /// gerçek macOS burada da "The file doesn't exist" veriyor) → ERISIM. İkisinde de kayıt durur.
    #[cfg(unix)]
    #[test]
    fn unresolvable_bookmark_classified_by_saved_path() {
        use std::os::unix::fs::PermissionsExt;
        struct Unresolvable;
        impl Bookmarks for Unresolvable {
            fn create(&self, path: &Path) -> Result<Option<Vec<u8>>, String> {
                Ok(Some(path.to_string_lossy().as_bytes().to_vec()))
            }
            fn access_and_read(
                &self,
                _: &[u8],
                _: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
            ) -> Result<ReadResult, RawError> {
                Err(RawError::Unresolved("The file doesn’t exist.".into()))
            }
        }
        let d = temp_folder();
        let in_place = d.join("yerinde.pdf");
        fs::write(&in_place, b"%PDF").unwrap();
        let locked = d.join("locked");
        fs::create_dir_all(&locked).unwrap();
        fs::write(locked.join("ic.pdf"), b"%PDF").unwrap();
        let mut l = RecentList::default();
        let ka = l.add(make_entry(
            &Unresolvable,
            &in_place,
            "yerinde.pdf",
            "pdf",
            1,
        ));
        let kb = l.add(make_entry(
            &Unresolvable,
            &locked.join("ic.pdf"),
            "ic.pdf",
            "pdf",
            1,
        ));
        let mc = l.add(make_entry(
            &Unresolvable,
            &d.join("yok.pdf"),
            "yok.pdf",
            "pdf",
            1,
        ));
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let read_fn = |p: &Path| fs::read(p);
        let ha = read(&mut l, &Unresolvable, &ka, 2, &read_fn)
            .unwrap_err()
            .to_string();
        let hb = read(&mut l, &Unresolvable, &kb, 2, &read_fn)
            .unwrap_err()
            .to_string();
        let hc = read(&mut l, &Unresolvable, &mc, 2, &read_fn)
            .unwrap_err()
            .to_string();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(ha.starts_with("TRANSIENT:"), "{ha}");
        assert!(hb.starts_with("ACCESS:"), "{hb}");
        assert!(hc.starts_with("NOTFOUND:"), "{hc}");
        assert!(
            l.find(&ka).is_some() && l.find(&kb).is_some(),
            "yerinde/kilitli kayıt durur"
        );
        assert!(l.find(&mc).is_none(), "yok olan çıkar");
        fs::remove_dir_all(&d).unwrap();
    }

    /// D7: yer imsiz kayıtta yol türü denetlenir (elle düzenlenmiş son-acilanlar.json keyfi dosya okutamaz).
    #[test]
    fn kind_checked_for_entry_without_bookmark() {
        let d = temp_folder();
        let txt = d.join("not.txt");
        fs::write(&txt, b"text").unwrap();
        let folder = d.join("klasor.pdf");
        fs::create_dir_all(&folder).unwrap();
        let mut l = RecentList::default();
        let touched = RefCell::new(Vec::<PathBuf>::new());
        let read_fn = |p: &Path| {
            touched.borrow_mut().push(p.to_path_buf());
            fs::read(p)
        };
        for path in [
            "/etc/hosts",
            txt.to_str().unwrap(),
            folder.to_str().unwrap(),
        ] {
            let mut entry = k("/x/a.pdf");
            entry.path = path.into();
            let id = l.add(entry);
            let h = read(&mut l, &Fake::new(), &id, 2, &read_fn).unwrap_err();
            assert!(h.to_string().starts_with("INVALID:"), "{path}: {h}");
            assert!(l.find(&id).is_none(), "geçersiz kayıt çıkarılır: {path}");
        }
        assert!(
            touched.borrow().is_empty(),
            "tür uymayan yol okunmamalı: {:?}",
            touched.borrow()
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// O2: hedef adı 255 bayta dek (UTF-8 çok baytlı dahil) — geçici ad `.<ad>.<uuid>.gecici` de
    /// 255 baytı aşmamalı (eskiden +45 bayt → ENAMETOOLONG).
    #[test]
    fn write_atomic_with_255_byte_name_temp_name_matches_pattern_and_limit() {
        let d = temp_folder();
        for name in [
            "ğ".repeat(126) + ".pdf", // 256 bayt → 255'e kırpılır (karakter sınırında: 254)
            "a".repeat(251) + ".pdf", // tam 255
            "Ş".repeat(100) + &"x".repeat(51), // 251
        ] {
            let name =
                crate::files::truncate_bytes(&name, crate::files::NAME_MAX_BYTES).to_string();
            let target = d.join(&name);
            write_atomic(&target, b"data").unwrap_or_else(|e| panic!("{} bytes: {e}", name.len()));
            assert_eq!(fs::read(&target).unwrap(), b"data");
        }
        assert!(temp_files(&d).is_empty(), "{:?}", temp_files(&d));
        // geçici ad kalıbı (artik_gecicileri_temizle tanır) ve sınır: kırpılmış ad + uuid
        let source = include_str!("recent.rs");
        let body = &source[source.find("pub fn write_atomic").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        assert!(
            body.contains("TEMP_SUFFIX_BYTES") && body.contains("truncate_bytes("),
            "geçici ad kırpılmıyor"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// D8: eşzamanlı atomik yazımlar birbirinin geçici dosyasını ezmez (hepsi başarılı, son içerik
    /// yazılanlardan biri, geçici dosya kalmaz); yazım rename'den önce diske eşitlenir (sync_all).
    #[test]
    fn write_atomic_concurrent_and_no_temp_file_left() {
        let d = temp_folder();
        let target = d.join("projects.json");
        let threads: Vec<_> = (0..8)
            .map(|i| {
                let target = target.clone();
                std::thread::spawn(move || {
                    (0..40)
                        .map(|j| {
                            write_atomic(&target, format!("{{\"i\":{i},\"j\":{j}}}").as_bytes())
                        })
                        .filter(|r| r.is_err())
                        .count()
                })
            })
            .collect();
        let failed: usize = threads.into_iter().map(|t| t.join().unwrap()).sum();
        assert_eq!(failed, 0, "eşzamanlı yazımda hata");
        let last: serde_json::Value = serde_json::from_slice(&fs::read(&target).unwrap()).unwrap();
        assert!(last["i"].is_u64() && last["j"].is_u64(), "{last}");
        let rest: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .map(|g| g.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|a| a != "projects.json")
            .collect();
        assert!(rest.is_empty(), "geçici dosya kaldı: {rest:?}");
        let source = include_str!("recent.rs");
        let body = &source[source.find("pub fn write_atomic").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        assert!(body.contains(".sync_all()"), "rename öncesi sync_all yok");
        fs::remove_dir_all(&d).unwrap();
    }

    /// L3: bozuk (base64 olmayan) yer imi "bulunamadı (silinmiş ya da taşınmış)" değil "geçersiz kayıt".
    #[test]
    fn entry_without_bookmark_read_by_path_corrupt_bookmark_invalid() {
        let d = temp_folder();
        let a = d.join("a.pdf");
        fs::write(&a, b"%PDF-flat").unwrap();
        let mut l = RecentList::default();
        let mut entry = k(a.to_str().unwrap());
        let id = entry.id.clone();
        l.add(entry.clone());
        assert_eq!(
            read(&mut l, &Fake::new(), &id, 2, &|p: &Path| fs::read(p))
                .unwrap()
                .0,
            b"%PDF-flat"
        );
        entry.bookmark = Some("%%% base64 değil".into());
        entry.path = "/baska".into();
        let k2 = l.add(entry);
        let h = read(&mut l, &Fake::new(), &k2, 2, &|p: &Path| fs::read(p));
        assert!(matches!(&h, Err(ReadError::Invalid(_))), "{:?}", h.err());
        assert!(l.find(&k2).is_none(), "bozuk yer imli kayıt çıkarılır");
        fs::remove_dir_all(&d).unwrap();
    }

    /// öncesi `son-acilanlar.json` olduğu gibi açılır (biçim değişmedi; arayüz dili kaydı etkilemez).
    #[test]
    fn legacy_recent_files_record_is_read() {
        let y = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../app/test/fixtures/legacy/recent-files-v1.json");
        assert!(y.is_file(), "{}", y.display());
        let l = RecentList::load(&y);
        assert_eq!(l.entries.len(), 2);
        assert_eq!(l.entries[0].name, "Mavi Pusula.epub");
        assert_eq!(l.entries[0].kind, "epub");
        assert!(l.entries[0].bookmark.is_some());
        assert_eq!(l.entries[1].name, "Çiğdemköy & Ekler.pdf");
        assert_eq!(
            l.entries[1].bookmark, None,
            "yerimi alanı olmayan eski kayıt"
        );
        let summary = serde_json::to_string(&l.summaries()).unwrap();
        assert!(
            summary.contains("Çiğdemköy & Ekler.pdf") && !summary.contains("/Users/"),
            "{summary}"
        );
    }

    #[test]
    fn summary_has_no_path_or_bookmark() {
        let mut entry = k("/gizli/yol/a.pdf");
        entry.bookmark = Some("QUJD".into());
        let json = serde_json::to_string(&Summary::from(&entry)).unwrap();
        assert!(
            !json.contains("hidden") && !json.contains("QUJD") && !json.contains("path"),
            "{json}"
        );
    }
}
