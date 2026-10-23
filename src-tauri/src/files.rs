//! Yerel Aç/Kaydet ve dosya okuma komutları, son açılanlar komutları (§4.3).
//!
//! Güvenlik ilkesi: **JS hiçbir zaman yol vermez.** Aç penceresi (ya da Dock/Finder'dan açma) seçilen yolu
//! Rust'taki oturum tablosuna koyar ve JS'e yalnız rastgele bir kimlik (uuid) döner; `dosya_oku` ve
//! `son_acilani_oku` yalnız tabloda/listede olan kimliği okur. Kaydetmede yolu yalnız kullanıcı Kaydet
//! penceresinde seçer; JS yalnız önerilen adı ve baytı verir.
//!
//! Klasör paketi EPUB (Apple Kitaplar) seçilirse `epub_folder::zip_uret` bellekte EPUB ZIP'i üretir; JS onu
//! sıradan bir `.epub` olarak alır (gerekçe: JS'in EPUB yolu değişmez, tek okuma ile tek IPC aktarımı).

use crate::i18n::text;
use crate::recent::{self, AppleBookmarks, Bookmarks, ReadError, RecentList, Summary};
use crate::{epub_folder, menu};
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
pub const MAX_FILE: u64 = 1 << 30;

// Kullanıcıya görünen metinler sözlükte (`crate::dil`): pencere başlıkları `dialog.*`, hatalar `rust.*`.

/// Oturumda açılmış bir dosya (yalnız Rust'ta).
#[derive(Debug, Clone)]
struct Session {
    path: PathBuf,
}

/// JS'e dönen açılış bilgisi (yol yok).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Opened {
    pub id: String,
    pub name: String,
    /// "pdf" | "epub" | "json"
    pub kind: String,
}

/// Kaydedilen dosya: kullanıcıya gösterilecek ad ve klasör.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Saved {
    pub name: String,
    pub path: String,
}

/// Uygulama durumu (`tauri::Builder::manage`).
#[derive(Default)]
pub struct FileState {
    session: Mutex<HashMap<String, Session>>,
    /// Son açılanlar; ilk kullanımda dosyadan yüklenir.
    last: Mutex<Option<RecentList>>,
    /// Webview hazır olmadan gelen dış açılışlar (Dock'a bırakma, Finder "Birlikte Aç").
    pending: Mutex<Vec<Opened>>,
}

impl FileState {
    /// Oturum tablosuna ekler, kimliği döner.
    fn add_to_table(&self, path: PathBuf) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.session
            .lock()
            .expect("oturum kilidi")
            .insert(id.clone(), Session { path });
        id
    }

    /// Kimliğin yolu; kimlik **tek kullanımlıktır**: alınınca tablodan silinir, tablo süreç boyunca
    /// büyümez. Bilinmeyen/geçersiz kimlik (keyfi yol dahil) reddedilir. Son açılanlar bu tabloyu
    /// kullanmaz (kalıcı kimlik `recent::Kayit`).
    fn take_from_table(&self, id: &str) -> Result<PathBuf, String> {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(unknown());
        }
        self.session
            .lock()
            .expect("oturum kilidi")
            .remove(id)
            .map(|o| o.path)
            .ok_or_else(unknown)
    }

    /// Son açılanlar listesi üzerinde işlem (gerekirse dosyadan yükler).
    fn with_recent<R: Runtime, T>(
        &self,
        app: &AppHandle<R>,
        f: impl FnOnce(&mut RecentList) -> T,
    ) -> T {
        self.with_recent_loading(|| load_recent(app), f)
    }

    /// `son_ile`; liste henüz yüklenmediyse `yukle` ile yüklenir (testte uygulama tutamacı gerekmez).
    fn with_recent_loading<T>(
        &self,
        load: impl FnOnce() -> RecentList,
        f: impl FnOnce(&mut RecentList) -> T,
    ) -> T {
        let mut lock = self.last.lock().expect("son açılanlar kilidi");
        f(lock.get_or_insert_with(load))
    }

    /// Menü için güncel özetler.
    pub fn recent_summaries<R: Runtime>(&self, app: &AppHandle<R>) -> Vec<Summary> {
        self.with_recent(app, |l| l.summaries())
    }
}

/// "BILINMEYEN:" kodlu hata (kod makine için sabit, açıklama şu anki dilde).
fn unknown() -> String {
    format!("UNKNOWN: {}", text("rust.unknown_id", &[]))
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn recent_file_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(recent::FILE_NAME))
}

fn load_recent<R: Runtime>(app: &AppHandle<R>) -> RecentList {
    match recent_file_path(app) {
        Some(y) => RecentList::load(&y),
        None => RecentList::default(),
    }
}

/// Listeyi diske yazar ve Son Açılanlar menüsünü yeniden kurar.
fn save_recent_and_refresh_menu<R: Runtime>(app: &AppHandle<R>, state: &FileState) {
    if let Some(y) = recent_file_path(app) {
        let write = state.with_recent(app, |l| l.save(&y));
        if let Err(e) = write {
            eprintln!("son açılanlar yazılamadı ({}): {e}", y.display());
        }
    }
    menu::refresh(app);
}

/// Dosyanın türü: uzantıdan; klasör ancak EPUB paketiyse "epub". Bilinmeyen → None.
pub fn detect_kind(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_string_lossy().to_lowercase();
    if path.is_dir() {
        return (extension == "epub" && epub_folder::is_epub_folder(path)).then_some("epub");
    }
    match extension.as_str() {
        "pdf" => Some("pdf"),
        "epub" => Some("epub"),
        "json" => Some("json"),
        _ => None,
    }
}

fn find_name(path: &Path) -> String {
    path.file_name()
        .map(|a| a.to_string_lossy().into_owned())
        .unwrap_or_else(|| text("impose.document", &[]))
}

/// Dosyanın içeriği: klasör paketi EPUB ise bellekte üretilen EPUB ZIP'i, değilse dosyanın baytları.
pub fn read_content(path: &Path) -> io::Result<Vec<u8>> {
    if path.is_dir() {
        return epub_folder::build_zip(path);
    }
    let size = fs::metadata(path)?.len();
    if size > MAX_FILE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            text("rust.file_large", &[("mb", &(size >> 20).to_string())]),
        ));
    }
    fs::read(path)
}

/// Seçilen/bırakılan belgeyi oturuma ve (PDF/EPUB ise) son açılanlara ekler.
pub fn save_document<R: Runtime>(
    app: &AppHandle<R>,
    state: &FileState,
    path: PathBuf,
) -> Result<Opened, String> {
    let kind = detect_kind(&path)
        .ok_or_else(|| text("rust.unsupported", &[("name", &path.display().to_string())]))?;
    let name = find_name(&path);
    if kind == "pdf" || kind == "epub" {
        // yer imi seçim anında, erişim canlıyken
        let entry = recent::make_entry(&AppleBookmarks, &path, &name, kind, now());
        state.with_recent(app, |l| l.add(entry));
        save_recent_and_refresh_menu(app, state);
    }
    let id = state.add_to_table(path);
    Ok(Opened {
        id,
        name,
        kind: kind.to_string(),
    })
}

/// Aç penceresi. `amac`: "belge" (PDF/EPUB, klasör paketi EPUB dahil) ya da "yedek" (JSON).
/// Vazgeçilirse `None`.
#[tauri::command]
pub async fn open_file<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, FileState>,
    purpose: String,
) -> Result<Option<Opened>, String> {
    let (title, filter, extensions): (String, String, &[&str]) = match purpose.as_str() {
        // "com.apple.ibooks.epub": Apple Kitaplar'ın klasör paketi türü (com.apple.package'a uyar). NSOpenPanel
        // setAllowedFileTypes uzantıların yanında tür kimliği de kabul eder; paket böylece seçilebilir kalır.
        "document" => (
            text("dialog.open_title", &[]),
            text("dialog.filter_document", &[]),
            &["pdf", "epub", "com.apple.ibooks.epub"],
        ),
        "backup" => (
            text("dialog.backup_title", &[]),
            text("dialog.filter_backup", &[]),
            &["json"],
        ),
        _ => return Err(text("rust.unknown_purpose", &[("purpose", &purpose)])),
    };
    let choice = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(&title)
        .add_filter(&filter, extensions)
        .blocking_pick_file();
    let Some(choice) = choice else {
        return Ok(None);
    };
    let path = choice.into_path().map_err(|e| e.to_string())?;
    let kind = detect_kind(&path)
        .ok_or_else(|| text("rust.unsupported", &[("name", &find_name(&path))]))?;
    match (purpose.as_str(), kind) {
        ("document", "pdf" | "epub") => save_document(&app, &state, path).map(Some),
        ("backup", "json") => Ok(Some(Opened {
            name: find_name(&path),
            id: state.add_to_table(path),
            kind: kind.into(),
        })),
        _ => Err(text("rust.in_window_cannot_open", &[("kind", kind)])),
    }
}

/// Oturumda açılmış dosyanın baytları (ham ArrayBuffer). Yalnız kimlik; keyfi yol yok.
#[tauri::command]
pub async fn read_file(state: State<'_, FileState>, id: String) -> Result<Response, String> {
    let path = state.take_from_table(&id)?;
    read_content(&path)
        .map(Response::new)
        .map_err(|e| text("rust.unreadable", &[("error", &e.to_string())]))
}

/// Son açılanlar (en yeni başta; yol ve yer imi verilmez).
#[tauri::command]
pub async fn recent_files<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, FileState>,
) -> Result<Vec<Summary>, String> {
    Ok(state.recent_summaries(&app))
}

/// Son açılan kaydın baytları (yer imini çöz → oku → erişimi bırak). Yalnız kimlik; keyfi yol yok.
/// Okunamayan kayıt listeden çıkar; hata metni "BULUNAMADI:" / "ERISIM:" / "BILINMEYEN:" ile başlar.
#[tauri::command]
pub async fn read_recent_file<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, FileState>,
    id: String,
) -> Result<Response, String> {
    let result = read_recent_entry(
        &state,
        || load_recent(&app),
        &AppleBookmarks,
        &id,
        now(),
        &read_content,
    );
    match result {
        Ok(bytes) => {
            save_recent_and_refresh_menu(&app, &state);
            Ok(Response::new(bytes))
        }
        Err(ReadError::Unknown) => Err(ReadError::Unknown.to_string()),
        Err(e) => {
            eprintln!("son açılan okunamadı ({id}): {e}");
            if e.is_permanent() {
                save_recent_and_refresh_menu(&app, &state);
            }
            Err(e.to_string())
        }
    }
}

/// Son açılan kaydı okur ve listeyi günceller: kayıt kilitle **kopyalanır**, kilit bırakılır, okuma
/// (yer imi çözme + büyük EPUB) kilitsiz yapılır, sonuç yeniden kilitle işlenir. Böylece ana iş parçacığı
/// (menü kurma, Dock'tan açma, Menüyü Temizle) okuma boyunca beklemez.
pub fn read_recent_entry(
    state: &FileState,
    load: impl FnOnce() -> RecentList,
    yi: &dyn Bookmarks,
    id: &str,
    date: u64,
    content: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
) -> Result<Vec<u8>, ReadError> {
    let entry = state.with_recent_loading(load, |l| recent::take_entry(l, id))?;
    let result = recent::read_entry(&entry, yi, content);
    state
        .with_recent_loading(RecentList::default, |l| {
            recent::apply_result(l, &entry, date, result)
        })
        .map(|(b, _)| b)
}

/// Son açılanları temizler (Dosya > Son Açılanlar > Menüyü Temizle).
pub fn clear_recent_files<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<FileState>();
    state.with_recent(app, |l| l.entries.clear());
    save_recent_and_refresh_menu(app, &state);
}

/// Webview hazır olmadan gelen dış açılışları verir ve kuyruğu boşaltır.
#[tauri::command]
pub async fn pending_opens(state: State<'_, FileState>) -> Result<Vec<Opened>, String> {
    Ok(std::mem::take(
        &mut *state.pending.lock().expect("bekleyen kilidi"),
    ))
}

/// Dock'a bırakılan / Finder'dan "Birlikte Aç" ile gelen dosyalar (`RunEvent::Opened`). Desteklenen her
/// belge oturuma ve son açılanlara eklenir, kuyruğa konur, webview'e `dosya-acildi` olayı gider (webview
/// henüz dinlemiyorsa açılışta `bekleyen_acilanlar` ile alır).
pub fn opened_from_outside<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    let state = app.state::<FileState>();
    let mut added = false;
    for path in paths {
        match detect_kind(&path) {
            Some("pdf" | "epub") => match save_document(app, &state, path) {
                Ok(a) => {
                    state.pending.lock().expect("bekleyen kilidi").push(a);
                    added = true;
                }
                Err(e) => eprintln!("dışarıdan açılamadı: {e}"),
            },
            _ => eprintln!("dışarıdan açılan unsupported file: {}", path.display()),
        }
    }
    if added {
        if let Err(e) = app.emit("file-opened", ()) {
            eprintln!("file-opened olayı iletilemedi: {e}");
        }
    }
}

/// Sandbox'ta `HOME` uygulama kabıdır (`/Users/<k>/Library/Containers/<kimlik>/Data`); kullanıcının asıl ev
/// klasörü onun önekidir. Kap dışındaysa olduğu gibi.
pub fn actual_ev(ev: &Path) -> PathBuf {
    let parts: Vec<_> = ev.components().collect();
    let n = parts.len();
    if n >= 4
        && parts[n - 1].as_os_str() == "Data"
        && parts[n - 3].as_os_str() == "Containers"
        && parts[n - 4].as_os_str() == "Library"
    {
        return parts[..n - 4].iter().collect();
    }
    ev.to_path_buf()
}

/// Kaydet penceresinin açılacağı klasör: son kaydedilen klasör (hâlâ klasörse), yoksa kullanıcının
/// asıl Belgeler klasörü (`<ev>/Documents`), o da yoksa `None` (sistem öntanımlısı). Kaynak dosyanın
/// klasörü (macOS'un son panel klasörü: repo, Apple Kitaplar kabı) önerilmez. L5: yalnız mutlak yollar
/// (göreli yol sürecin çalışma klasörüne göre çözülürdü).
pub fn select_save_folder(last: Option<&Path>, ev: Option<&Path>) -> Option<PathBuf> {
    if let Some(s) = last.filter(|s| s.is_absolute() && s.is_dir()) {
        return Some(s.to_path_buf());
    }
    let documents = ev.filter(|e| e.is_absolute())?.join("Documents");
    documents.is_dir().then_some(documents)
}

/// Kullanıcının asıl ev klasörü (`HOME`'dan, sandbox kabı soyulmuş). L5: `HOME` yoksa, boşsa ya da
/// göreliyse `None` (göreli "Documents" önerilmez).
pub fn ev_find(home: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let ev = Path::new(home?);
    ev.is_absolute().then(|| actual_ev(ev))
}

/// Son kaydedilen klasörün tutulduğu dosya (`app_data_dir` içinde).
pub const SAVE_FOLDER_FILE: &str = "son-kayit-klasoru.txt";

/// Son kaydedilen klasörü okur (yoksa/boşsa `None`).
pub fn read_last_save_folder(file: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(file).ok()?;
    let text = text.trim_end_matches('\n');
    (!text.is_empty()).then(|| PathBuf::from(text))
}

fn save_folder_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(SAVE_FOLDER_FILE))
}

/// Dosya adının bayt sınırı (APFS/HFS+: 255 bayt UTF-8).
pub const NAME_MAX_BYTES: usize = 255;

/// `s`'yi en çok `n` bayta, UTF-8 karakter sınırında kırpar.
pub fn truncate_bytes(s: &str, n: usize) -> &str {
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
pub fn safe_name(encoded: &str, extension: &str) -> String {
    let mut bytes = Vec::with_capacity(encoded.len());
    let b = encoded.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let sixteen = |c: u8| (c as char).to_digit(16);
            if let (Some(y), Some(a)) = (sixteen(b[i + 1]), sixteen(b[i + 2])) {
                bytes.push((y * 16 + a) as u8);
                i += 3;
                continue;
            }
        }
        bytes.push(b[i]);
        i += 1;
    }
    let raw = String::from_utf8_lossy(&bytes);
    let clean: String = raw
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':') || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let clean = clean.trim().trim_start_matches('.').trim();
    let last = format!(".{extension}");
    // Uzantı zaten varsa (büyük/küçük harf korunur) gövdeden ayrılır; kırpma yalnız gövdeye uygulanır.
    let cutting = clean.len().saturating_sub(last.len());
    let (body, uz) = if clean.len() >= last.len()
        && clean.is_char_boundary(cutting)
        && clean[cutting..].eq_ignore_ascii_case(&last)
    {
        (&clean[..cutting], &clean[cutting..])
    } else {
        (clean, last.as_str())
    };
    let body = truncate_bytes(body, NAME_MAX_BYTES - uz.len());
    if body.trim().is_empty() {
        return format!("mucellit{last}");
    }
    format!("{body}{uz}")
}

/// Kaydet penceresi + yazma. Gövde ham bayt (`invoke('dosya_kaydet', bytes, { headers })`); başlıklar
/// `x-ad` (encodeURIComponent ile önerilen ad) ve `x-tur` ("pdf" | "json"). Vazgeçilirse `None`.
#[tauri::command]
pub async fn save_file<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    request: Request<'_>,
) -> Result<Option<Saved>, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(text("rust.raw_bytes", &[]));
    };
    let title = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string()
    };
    let kind = title("x-kind");
    let (filter, extension) = match kind.as_str() {
        "pdf" => (text("dialog.filter_pdf", &[]), "pdf"),
        "json" => (text("dialog.filter_backup", &[]), "json"),
        _ => return Err(text("rust.unknown_kind", &[("kind", &kind)])),
    };
    let name = safe_name(&title("x-name"), extension);
    let folder_file = save_folder_file(&app);
    let ev = ev_find(std::env::var_os("HOME").as_deref());
    let last = folder_file.as_deref().and_then(read_last_save_folder);
    let mut setup_window = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(text("dialog.save_title", &[]))
        .set_file_name(&name)
        .add_filter(&filter, &[extension]);
    if let Some(k) = select_save_folder(last.as_deref(), ev.as_deref()) {
        setup_window = setup_window.set_directory(k);
    }
    let Some(choice) = setup_window.blocking_save_file() else {
        return Ok(None);
    };
    let path = choice.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| text("rust.writeFailed", &[("error", &e.to_string())]))?;
    if let (Some(d), Some(k)) = (folder_file, path.parent()) {
        let mut line = k.as_os_str().to_owned();
        line.push("\n");
        if let Err(e) = recent::write_atomic(&d, line.as_encoded_bytes()) {
            eprintln!("son kayıt klasörü yazılamadı: {e}");
        }
    }
    Ok(Some(Saved {
        name: find_name(&path),
        path: path.to_string_lossy().into_owned(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_rejects_unknown_and_arbitrary_path_id() {
        let d = FileState::default();
        let actual = std::env::temp_dir().join(format!("kc-dosya-{}.pdf", uuid::Uuid::new_v4()));
        fs::write(&actual, b"%PDF").unwrap();
        let id = d.add_to_table(actual.clone());
        let second = d.add_to_table(actual.clone());
        assert_eq!(d.take_from_table(&second).unwrap(), actual);
        for bad in [
            "",
            actual.to_str().unwrap(),
            "/etc/hosts",
            "../../../etc/passwd",
            "file:///etc/hosts",
            "~/Library",
            &uuid::Uuid::new_v4().to_string(),
            &id.to_uppercase().replace('-', ""), // biçim farkı: aynı uuid ama farklı yazım tabloda yok
        ] {
            assert_eq!(d.take_from_table(bad).unwrap_err(), unknown(), "{bad}");
        }
        fs::remove_file(&actual).unwrap();
    }

    /// Komut imzaları: okuma komutları yalnız `kimlik: String` alır (yol, PathBuf, Path parametresi yok).
    #[test]
    fn read_commands_take_no_path_from_js() {
        let source = include_str!("files.rs");
        for command in ["pub async fn read_file", "pub async fn read_recent_file"] {
            let head = source
                .find(command)
                .unwrap_or_else(|| panic!("{command} none"));
            let signature = &source[head..head + source[head..].find('{').unwrap()];
            // tür parametrelerinin içindeki virgüller (State<'_, Durum>) bölmeyi bozmasın
            let mut depth = 0;
            let flat: String = signature
                .chars()
                .filter(|c| {
                    match c {
                        '<' => depth += 1,
                        '>' if depth > 0 => {
                            depth -= 1;
                            return false;
                        }
                        _ => {}
                    }
                    depth == 0
                })
                .collect();
            let signature = flat.as_str();
            let params: Vec<&str> = signature
                [signature.find('(').unwrap() + 1..signature.rfind(')').unwrap()]
                .split(',')
                .map(str::trim)
                .filter(|p| !p.is_empty() && !p.starts_with("->"))
                .collect();
            let js_params: Vec<&&str> = params
                .iter()
                .filter(|p| !p.starts_with("app:") && !p.starts_with("state:"))
                .collect();
            assert_eq!(js_params, [&"id: String"], "{command}: {params:?}");
        }
        for command in ["open_file", "save_file"] {
            let head = source.find(&format!("pub async fn {command}")).unwrap();
            let signature = &source[head..head + source[head..].find('{').unwrap()];
            assert!(
                !signature.contains("PathBuf")
                    && !signature.contains("Path")
                    && !signature.contains("path"),
                "{command}: {signature}"
            );
        }
    }

    #[test]
    fn detect_kind_extension_and_folder_package() {
        let d = std::env::temp_dir().join(format!("mc-kind-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(d.join("Kitap.epub/META-INF")).unwrap();
        fs::write(d.join("Kitap.epub/META-INF/container.xml"), "<c/>").unwrap();
        fs::create_dir_all(d.join("Bos.epub")).unwrap();
        fs::create_dir_all(d.join("klasor.pdf")).unwrap();
        for (name, expected) in [
            ("a.pdf", Some("pdf")),
            ("A.PDF", Some("pdf")),
            ("b.epub", Some("epub")),
            ("c.json", Some("json")),
            ("d.txt", None),
            ("withoutExtension", None),
        ] {
            fs::write(d.join(name), b"x").unwrap();
            assert_eq!(detect_kind(&d.join(name)), expected, "{name}");
        }
        assert_eq!(detect_kind(&d.join("Kitap.epub")), Some("epub"));
        assert_eq!(
            detect_kind(&d.join("Bos.epub")),
            None,
            "container.xml'siz klasör"
        );
        assert_eq!(detect_kind(&d.join("klasor.pdf")), None, "PDF adlı klasör");
        // klasör paketi içeriği EPUB ZIP olarak okunur
        let z = read_content(&d.join("Kitap.epub")).unwrap();
        assert_eq!(&z[0..4], b"PK\x03\x04");
        assert_eq!(read_content(&d.join("a.pdf")).unwrap(), b"x");
        assert!(read_content(&d.join("yok.pdf")).is_err());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn safe_name_faulty_inputs() {
        let encode = |s: &str| {
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
            safe_name(&encode("Mavi Pusula-dizilmis.pdf"), "pdf"),
            "Mavi Pusula-dizilmis.pdf"
        );
        assert_eq!(
            safe_name(&encode("Çğüşİ ılık-önler.pdf"), "pdf"),
            "Çğüşİ ılık-önler.pdf"
        );
        assert_eq!(
            safe_name(&encode("../../etc/passwd"), "pdf"),
            "-..-etc-passwd.pdf"
        );
        assert_eq!(safe_name(&encode("a/b\\c:d.pdf"), "pdf"), "a-b-c-d.pdf");
        assert_eq!(safe_name(&encode(".gizli.pdf"), "pdf"), "gizli.pdf");
        assert_eq!(safe_name(&encode("backup"), "json"), "backup.json");
        assert_eq!(safe_name(&encode("report.PDF"), "pdf"), "report.PDF");
        assert_eq!(safe_name("", "pdf"), "mucellit.pdf");
        assert_eq!(safe_name("%2E%2E", "pdf"), "mucellit.pdf");
        assert_eq!(safe_name("   ", "json"), "mucellit.json");
        assert_eq!(safe_name("a%0Ab%00c", "pdf"), "a-b-c.pdf");
        assert_eq!(
            safe_name("%ZZ%4", "pdf"),
            "%ZZ%4.pdf",
            "bozuk % kodu olduğu gibi"
        );
        assert_eq!(safe_name("%C3", "pdf"), "\u{FFFD}.pdf", "yarım UTF-8");
    }

    /// D5: ad bayta göre kırpılır (APFS: en çok 255 bayt), UTF-8 karakter sınırında; uzantı korunur.
    #[test]
    fn safe_name_byte_limit_on_utf8_boundary() {
        for (input, uz) in [
            ("ç".repeat(400), "pdf"),
            ("a".repeat(400), "pdf"),
            ("🙂".repeat(100), "json"),
            (format!("{}.pdf", "ğ".repeat(200)), "pdf"),
            (format!("x{}", "ş".repeat(127)), "pdf"),
        ] {
            let name = safe_name(&input, uz);
            assert!(name.len() <= 255, "{} bytes: {name}", name.len());
            assert!(name.ends_with(&format!(".{uz}")), "{name}");
            assert!(!name.contains('\u{FFFD}'), "yarım karakter: {name}");
            let body = &name[..name.len() - uz.len() - 1];
            assert!(
                input.starts_with(body),
                "gövde girdinin öneki olmalı: {name}"
            );
        }
        assert_eq!(
            safe_name(&"a".repeat(400), "pdf").len(),
            255,
            "sınır dolu kullanılır"
        );
        let short = "Mavi Pusula-dizilmis.pdf";
        assert_eq!(safe_name(short, "pdf"), short, "kısa ad değişmez");
    }

    /// D6: oturum kimliği tek kullanımlık (okununca tablodan silinir; tablo büyümez).
    #[test]
    fn session_id_single_use() {
        let d = FileState::default();
        let p = std::env::temp_dir().join("kc-tek.pdf");
        let k = d.add_to_table(p.clone());
        assert_eq!(d.take_from_table(&k).unwrap(), p);
        assert_eq!(d.take_from_table(&k).unwrap_err(), unknown(), "second read");
        assert!(d.session.lock().unwrap().is_empty(), "tablo boşaldı");
    }

    /// O3: son açılan okunurken `son` kilidi TUTULMAZ (ana iş parçacığı menüyü kurarken beklemesin); okuma
    /// bitince liste kilitle güncellenir.
    #[test]
    fn no_lock_held_while_reading_recent_file() {
        let d = FileState::default();
        let file = std::env::temp_dir().join(format!("kc-kilit-{}.pdf", uuid::Uuid::new_v4()));
        fs::write(&file, b"%PDF-lock").unwrap();
        let mut list = RecentList::default();
        let entry = recent::Entry {
            id: uuid::Uuid::new_v4().to_string(),
            name: "kilit.pdf".into(),
            kind: "pdf".into(),
            date: 1,
            path: file.to_string_lossy().into_owned(),
            bookmark: None,
        };
        let id = entry.id.clone();
        list.add(entry);
        list.add(recent::Entry {
            id: uuid::Uuid::new_v4().to_string(),
            path: "/baska.pdf".into(),
            ..list.entries[0].clone()
        });
        let lock_free = std::cell::Cell::new(None);
        let read = |p: &Path| {
            lock_free.set(Some(d.last.try_lock().is_ok()));
            fs::read(p)
        };
        let bytes = read_recent_entry(&d, || list, &AppleBookmarks, &id, 77, &read).unwrap();
        fs::remove_file(&file).ok();
        assert_eq!(bytes, b"%PDF-lock");
        assert_eq!(
            lock_free.get(),
            Some(true),
            "okuma sırasında son kilidi boş olmalı"
        );
        let l = d.last.lock().unwrap();
        let l = l.as_ref().unwrap();
        assert_eq!(l.entries[0].id, id, "okunan başa alındı");
        assert_eq!(l.entries[0].date, 77);
    }

    /// D12: Kaydet penceresi son kaydedilen klasörde açılır; yoksa (ya da silindiyse) kullanıcının asıl
    /// Belgeler klasöründe; o da yoksa sistem öntanımlısı.
    #[test]
    fn save_folder_is_last_saved_else_documents() {
        let ev = std::env::temp_dir().join(format!("mc-ev-{}", uuid::Uuid::new_v4()));
        let documents = ev.join("Documents");
        let last = ev.join("Kitaplar");
        fs::create_dir_all(&documents).unwrap();
        fs::create_dir_all(&last).unwrap();
        let e = Some(ev.as_path());
        assert_eq!(select_save_folder(Some(&last), e), Some(last.clone()));
        assert_eq!(select_save_folder(None, e), Some(documents.clone()));
        assert_eq!(
            select_save_folder(Some(&ev.join("deleted")), e),
            Some(documents.clone()),
            "silinmiş son klasör"
        );
        let file = ev.join("dosya.pdf");
        fs::write(&file, b"x").unwrap();
        assert_eq!(
            select_save_folder(Some(&file), e),
            Some(documents.clone()),
            "klasör değil"
        );
        fs::remove_dir_all(&documents).unwrap();
        assert_eq!(select_save_folder(None, e), None, "Belgeler de yok");
        // son klasör dosyası: gidiş-dönüş, boş/eksik → None
        let kd = ev.join(SAVE_FOLDER_FILE);
        assert_eq!(read_last_save_folder(&kd), None, "dosya yok");
        recent::write_atomic(&kd, "/Users/x/Kitaplar ğ\n".as_bytes()).unwrap();
        assert_eq!(
            read_last_save_folder(&kd),
            Some(PathBuf::from("/Users/x/Kitaplar ğ"))
        );
        fs::write(&kd, "").unwrap();
        assert_eq!(read_last_save_folder(&kd), None, "boş");
        fs::remove_dir_all(&ev).unwrap();
        // sandbox kabı → asıl ev; kap dışı değişmez
        assert_eq!(
            actual_ev(Path::new(
                "/Users/kullanici/Library/Containers/com.onurmert.kitapcilt/Data"
            )),
            PathBuf::from("/Users/kullanici")
        );
        assert_eq!(
            actual_ev(Path::new("/Users/kullanici")),
            PathBuf::from("/Users/kullanici")
        );
        assert_eq!(
            actual_ev(Path::new("/Users/kullanici/Library/Containers")),
            PathBuf::from("/Users/kullanici/Library/Containers"),
            "kap kimliği yok"
        );
    }
    /// L5: `HOME` yoksa, boşsa ya da göreliyse ev klasörü yok sayılır (göreli "Documents" önerilmez); son
    /// kaydedilen klasör de göreli olamaz (elle bozulmuş son-kayit-klasoru.txt).
    #[test]
    fn no_relative_folder_suggested_when_home_missing_or_relative() {
        use std::ffi::OsStr;
        assert_eq!(ev_find(None), None, "HOME yok");
        assert_eq!(ev_find(Some(OsStr::new(""))), None, "HOME boş");
        assert_eq!(ev_find(Some(OsStr::new("goreli/ev"))), None, "HOME göreli");
        assert_eq!(
            ev_find(Some(OsStr::new(
                "/Users/kullanici/Library/Containers/com.onurmert.kitapcilt/Data"
            ))),
            Some(PathBuf::from("/Users/kullanici"))
        );
        assert_eq!(
            ev_find(Some(OsStr::new("/Users/kullanici"))),
            Some(PathBuf::from("/Users/kullanici"))
        );
        // cargo test src-tauri/ klasöründe koşar: göreli "src" bir klasördür
        assert!(Path::new("src").is_dir());
        assert_eq!(
            select_save_folder(Some(Path::new("src")), None),
            None,
            "göreli son klasör önerilmez"
        );
        assert_eq!(
            select_save_folder(None, Some(Path::new(""))),
            None,
            "boş ev → göreli Documents yok"
        );
        assert_eq!(read_last_save_folder(Path::new("/yok/dosya")), None);
    }
}
