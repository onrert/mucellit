//! Native Open/Save and file read commands, recent files commands (§4.3).
//!
//! Security principle: **JS never gives a path.** The Open dialog (or opening from the Dock/Finder) puts the chosen path
//! into the session table in Rust and returns only a random id (uuid) to JS; `read_file` and
//! `read_recent_file` read only an id that is in the table/list. On saving only the user chooses the path in the Save
//! dialog; JS gives only the suggested name and the bytes.
//!
//! When a folder package EPUB (Apple Books) is chosen, `epub_folder::build_zip` builds an EPUB ZIP in memory; JS takes
//! it as an ordinary `.epub` (reason: the EPUB path of JS does not change, one read and one IPC transfer).

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

/// The upper limit of a single file to read (memory and IPC).
pub const MAX_FILE: u64 = 1 << 30;

// The texts the user sees are in the dictionary (`crate::i18n`): dialog titles `dialog.*`, errors `rust.*`.

/// A file opened in the session (only in Rust).
#[derive(Debug, Clone)]
struct Session {
    path: PathBuf,
}

/// The open information returned to JS (no path).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Opened {
    pub id: String,
    pub name: String,
    /// "pdf" | "epub" | "json"
    pub kind: String,
}

/// The saved file: the name and folder to show the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Saved {
    pub name: String,
    pub path: String,
}

/// App state (`tauri::Builder::manage`).
#[derive(Default)]
pub struct FileState {
    session: Mutex<HashMap<String, Session>>,
    /// Recent files; loaded from the file on first use.
    last: Mutex<Option<RecentList>>,
    /// Outside opens that arrive before the webview is ready (a drop on the Dock, Finder "Open With").
    pending: Mutex<Vec<Opened>>,
}

impl FileState {
    /// Adds to the session table, returns the id.
    fn add_to_table(&self, path: PathBuf) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.session
            .lock()
            .expect("session lock")
            .insert(id.clone(), Session { path });
        id
    }

    /// The path of the id; an id is **single use**: removed from the table when taken, the table does not grow for the
    /// life of the process. An unknown/invalid id (an arbitrary path included) is rejected. The recent files do not use
    /// this table (the persistent id is `recent::Entry`).
    fn take_from_table(&self, id: &str) -> Result<PathBuf, String> {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(unknown());
        }
        self.session
            .lock()
            .expect("session lock")
            .remove(id)
            .map(|o| o.path)
            .ok_or_else(unknown)
    }

    /// An operation on the recent files list (loads it from the file when needed).
    fn with_recent<R: Runtime, T>(
        &self,
        app: &AppHandle<R>,
        f: impl FnOnce(&mut RecentList) -> T,
    ) -> T {
        self.with_recent_loading(|| load_recent(app), f)
    }

    /// `with_recent`; when the list is not loaded yet it is loaded with `load` (no app handle needed in the test).
    fn with_recent_loading<T>(
        &self,
        load: impl FnOnce() -> RecentList,
        f: impl FnOnce(&mut RecentList) -> T,
    ) -> T {
        let mut lock = self.last.lock().expect("recent files lock");
        f(lock.get_or_insert_with(load))
    }

    /// The current summaries for the menu.
    pub fn recent_summaries<R: Runtime>(&self, app: &AppHandle<R>) -> Vec<Summary> {
        self.with_recent(app, |l| l.summaries())
    }
}

/// An error with the "UNKNOWN:" code (the code is fixed for the machine, the description in the current language).
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

/// Writes the list to disk and builds the Recent Items menu again.
fn save_recent_and_refresh_menu<R: Runtime>(app: &AppHandle<R>, state: &FileState) {
    if let Some(y) = recent_file_path(app) {
        let write = state.with_recent(app, |l| l.save(&y));
        if let Err(e) = write {
            eprintln!("recent files could not be written ({}): {e}", y.display());
        }
    }
    menu::refresh(app);
}

/// The kind of the file: from the extension; a folder is "epub" only when it is an EPUB package. Unknown → None.
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

/// The content of the file: the EPUB ZIP built in memory for a folder package EPUB, otherwise the bytes of the file.
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

/// Adds the chosen/dropped document to the session and (for PDF/EPUB) to the recent files.
pub fn save_document<R: Runtime>(
    app: &AppHandle<R>,
    state: &FileState,
    path: PathBuf,
) -> Result<Opened, String> {
    let kind = detect_kind(&path)
        .ok_or_else(|| text("rust.unsupported", &[("name", &path.display().to_string())]))?;
    let name = find_name(&path);
    if kind == "pdf" || kind == "epub" {
        // the bookmark at the moment of the choice, while the access is alive
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

/// Open dialog. `purpose`: "document" (PDF/EPUB, folder package EPUB included) or "backup" (JSON).
/// `None` when cancelled.
#[tauri::command]
pub async fn open_file<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, FileState>,
    purpose: String,
) -> Result<Option<Opened>, String> {
    let (title, filter, extensions): (String, String, &[&str]) = match purpose.as_str() {
        // "com.apple.ibooks.epub": the folder package type of Apple Books (conforms to com.apple.package). NSOpenPanel
        // setAllowedFileTypes accepts type ids besides extensions; so the package stays selectable.
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

/// The bytes of a file opened in the session (raw ArrayBuffer). Only an id; no arbitrary path.
#[tauri::command]
pub async fn read_file(state: State<'_, FileState>, id: String) -> Result<Response, String> {
    let path = state.take_from_table(&id)?;
    read_content(&path)
        .map(Response::new)
        .map_err(|e| text("rust.unreadable", &[("error", &e.to_string())]))
}

/// Recent files (the newest first; no path and no bookmark given).
#[tauri::command]
pub async fn recent_files<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, FileState>,
) -> Result<Vec<Summary>, String> {
    Ok(state.recent_summaries(&app))
}

/// The bytes of a recent file entry (resolve the bookmark → read → release the access). Only an id; no arbitrary path.
/// An unreadable entry leaves the list; the error text starts with "NOTFOUND:" / "ACCESS:" / "UNKNOWN:".
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
            eprintln!("recent file could not be read ({id}): {e}");
            if e.is_permanent() {
                save_recent_and_refresh_menu(&app, &state);
            }
            Err(e.to_string())
        }
    }
}

/// Reads a recent file entry and updates the list: the entry is **copied** under the lock, the lock is released, the
/// read (resolving the bookmark + a big EPUB) is done without the lock, the result is applied under the lock again. So
/// the main thread (building the menu, opening from the Dock, Clear Menu) does not wait during the read.
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

/// Clears the recent files (File > Open Recent > Clear Menu).
pub fn clear_recent_files<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<FileState>();
    state.with_recent(app, |l| l.entries.clear());
    save_recent_and_refresh_menu(app, &state);
}

/// Gives the outside opens that arrived before the webview was ready and empties the queue.
#[tauri::command]
pub async fn pending_opens(state: State<'_, FileState>) -> Result<Vec<Opened>, String> {
    Ok(std::mem::take(
        &mut *state.pending.lock().expect("pending lock"),
    ))
}

/// Files dropped on the Dock / coming from Finder "Open With" (`RunEvent::Opened`). Every supported
/// document is added to the session and the recent files and queued; the `file-opened` event goes to the webview
/// (when the webview is not listening yet it takes them with `pending_opens` at start-up).
pub fn opened_from_outside<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    let state = app.state::<FileState>();
    let mut added = false;
    for path in paths {
        match detect_kind(&path) {
            Some("pdf" | "epub") => match save_document(app, &state, path) {
                Ok(a) => {
                    state.pending.lock().expect("pending lock").push(a);
                    added = true;
                }
                Err(e) => eprintln!("could not be opened from outside: {e}"),
            },
            _ => eprintln!("unsupported file opened from outside: {}", path.display()),
        }
    }
    if added {
        if let Err(e) = app.emit("file-opened", ()) {
            eprintln!("the file-opened event could not be sent: {e}");
        }
    }
}

/// In the sandbox `HOME` is the app container (`/Users/<k>/Library/Containers/<id>/Data`); the user's real home
/// folder is its prefix. As it is outside a container.
pub fn actual_home(home_dir: &Path) -> PathBuf {
    let parts: Vec<_> = home_dir.components().collect();
    let n = parts.len();
    if n >= 4
        && parts[n - 1].as_os_str() == "Data"
        && parts[n - 3].as_os_str() == "Containers"
        && parts[n - 4].as_os_str() == "Library"
    {
        return parts[..n - 4].iter().collect();
    }
    home_dir.to_path_buf()
}

/// The folder the Save dialog opens in: the last saved folder (when it is still a folder), otherwise the user's real
/// Documents folder (`<home>/Documents`), otherwise `None` (the system default). The folder of the source file (the
/// last panel folder of macOS: the repository, the Apple Books container) is not suggested. L5: only absolute paths
/// (a relative path would be resolved against the working folder of the process).
pub fn select_save_folder(last: Option<&Path>, home_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(s) = last.filter(|s| s.is_absolute() && s.is_dir()) {
        return Some(s.to_path_buf());
    }
    let documents = home_dir.filter(|e| e.is_absolute())?.join("Documents");
    documents.is_dir().then_some(documents)
}

/// The user's real home folder (from `HOME`, with the sandbox container stripped). L5: `None` when `HOME` is missing,
/// empty or relative (no relative "Documents" is suggested).
pub fn find_home(home: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let home_dir = Path::new(home?);
    home_dir.is_absolute().then(|| actual_home(home_dir))
}

/// The file that keeps the last saved folder (inside `app_data_dir`).
pub const SAVE_FOLDER_FILE: &str = "last-save-folder.txt";

/// Reads the last saved folder (`None` when missing/empty).
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

/// The byte limit of a file name (APFS/HFS+: 255 bytes UTF-8).
pub const NAME_MAX_BYTES: usize = 255;

/// Cuts `s` to at most `n` bytes at a UTF-8 character boundary.
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

/// Decodes the suggested name JS encoded with `encodeURIComponent` and makes it safe as a file name: path separators
/// and control characters are dropped, leading dots removed, the extension becomes `.pdf`/`.json`, the name with its
/// extension is at most 255 **bytes** (D5; cut at a UTF-8 character boundary). When nothing is left, the default name.
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
    // When the extension is already there (case kept) it is split from the body; cutting applies only to the body.
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

/// Save dialog + write. The body is raw bytes (`invoke('save_file', bytes, { headers })`); the headers are
/// `x-name` (the suggested name encoded with encodeURIComponent) and `x-kind` ("pdf" | "json"). `None` when cancelled.
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
    let home_dir = find_home(std::env::var_os("HOME").as_deref());
    let last = folder_file.as_deref().and_then(read_last_save_folder);
    let mut setup_window = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(text("dialog.save_title", &[]))
        .set_file_name(&name)
        .add_filter(&filter, &[extension]);
    if let Some(k) = select_save_folder(last.as_deref(), home_dir.as_deref()) {
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
            eprintln!("the last save folder could not be written: {e}");
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
        let actual = std::env::temp_dir().join(format!("mc-file-{}.pdf", uuid::Uuid::new_v4()));
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
            &id.to_uppercase().replace('-', ""), // a format difference: the same uuid written differently is not in the table
        ] {
            assert_eq!(d.take_from_table(bad).unwrap_err(), unknown(), "{bad}");
        }
        fs::remove_file(&actual).unwrap();
    }

    /// Command signatures: the read commands take only `id: String` (no path, PathBuf or Path parameter).
    #[test]
    fn read_commands_take_no_path_from_js() {
        let source = include_str!("files.rs");
        for command in ["pub async fn read_file", "pub async fn read_recent_file"] {
            let head = source
                .find(command)
                .unwrap_or_else(|| panic!("{command} none"));
            let signature = &source[head..head + source[head..].find('{').unwrap()];
            // the commas inside type parameters (State<'_, FileState>) must not break the split
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
        fs::create_dir_all(d.join("Book.epub/META-INF")).unwrap();
        fs::write(d.join("Book.epub/META-INF/container.xml"), "<c/>").unwrap();
        fs::create_dir_all(d.join("Empty.epub")).unwrap();
        fs::create_dir_all(d.join("folder.pdf")).unwrap();
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
        assert_eq!(detect_kind(&d.join("Book.epub")), Some("epub"));
        assert_eq!(
            detect_kind(&d.join("Empty.epub")),
            None,
            "folder without container.xml"
        );
        assert_eq!(
            detect_kind(&d.join("folder.pdf")),
            None,
            "a folder named PDF"
        );
        // the content of a folder package is read as an EPUB ZIP
        let z = read_content(&d.join("Book.epub")).unwrap();
        assert_eq!(&z[0..4], b"PK\x03\x04");
        assert_eq!(read_content(&d.join("a.pdf")).unwrap(), b"x");
        assert!(read_content(&d.join("missing.pdf")).is_err());
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
            safe_name(&encode("Blue Compass-imposed.pdf"), "pdf"),
            "Blue Compass-imposed.pdf"
        );
        assert_eq!(
            safe_name(&encode("Çğüşİ ılık-önler.pdf"), "pdf"), // turkish-ok: Turkish test text (UTF-8 names)
            "Çğüşİ ılık-önler.pdf" // turkish-ok: Turkish test text (UTF-8 names)
        );
        assert_eq!(
            safe_name(&encode("../../etc/passwd"), "pdf"),
            "-..-etc-passwd.pdf"
        );
        assert_eq!(safe_name(&encode("a/b\\c:d.pdf"), "pdf"), "a-b-c-d.pdf");
        assert_eq!(safe_name(&encode(".hidden.pdf"), "pdf"), "hidden.pdf");
        assert_eq!(safe_name(&encode("backup"), "json"), "backup.json");
        assert_eq!(safe_name(&encode("report.PDF"), "pdf"), "report.PDF");
        assert_eq!(safe_name("", "pdf"), "mucellit.pdf");
        assert_eq!(safe_name("%2E%2E", "pdf"), "mucellit.pdf");
        assert_eq!(safe_name("   ", "json"), "mucellit.json");
        assert_eq!(safe_name("a%0Ab%00c", "pdf"), "a-b-c.pdf");
        assert_eq!(
            safe_name("%ZZ%4", "pdf"),
            "%ZZ%4.pdf",
            "a broken % code as it is"
        );
        assert_eq!(
            safe_name("%C3", "pdf"),
            "\u{FFFD}.pdf",
            "half a UTF-8 character"
        );
    }

    /// D5: the name is cut by bytes (APFS: at most 255 bytes), at a UTF-8 character boundary; the extension is kept.
    #[test]
    fn safe_name_byte_limit_on_utf8_boundary() {
        for (input, uz) in [
            ("ç".repeat(400), "pdf"), // turkish-ok: Turkish test text (UTF-8 names)
            ("a".repeat(400), "pdf"),
            ("🙂".repeat(100), "json"),
            (format!("{}.pdf", "ğ".repeat(200)), "pdf"), // turkish-ok: Turkish test text (UTF-8 names)
            (format!("x{}", "ş".repeat(127)), "pdf"), // turkish-ok: Turkish test text (UTF-8 names)
        ] {
            let name = safe_name(&input, uz);
            assert!(name.len() <= 255, "{} bytes: {name}", name.len());
            assert!(name.ends_with(&format!(".{uz}")), "{name}");
            assert!(!name.contains('\u{FFFD}'), "half a character: {name}");
            let body = &name[..name.len() - uz.len() - 1];
            assert!(
                input.starts_with(body),
                "the body must be a prefix of the input: {name}"
            );
        }
        assert_eq!(
            safe_name(&"a".repeat(400), "pdf").len(),
            255,
            "the limit is used in full"
        );
        let short = "Blue Compass-imposed.pdf";
        assert_eq!(
            safe_name(short, "pdf"),
            short,
            "a short name does not change"
        );
    }

    /// D6: the session id is single use (removed from the table when read; the table does not grow).
    #[test]
    fn session_id_single_use() {
        let d = FileState::default();
        let p = std::env::temp_dir().join("mc-single.pdf");
        let k = d.add_to_table(p.clone());
        assert_eq!(d.take_from_table(&k).unwrap(), p);
        assert_eq!(d.take_from_table(&k).unwrap_err(), unknown(), "second read");
        assert!(d.session.lock().unwrap().is_empty(), "the table is empty");
    }

    /// O3: the recent files lock is NOT HELD while a recent file is read (the main thread must not wait while building the
    /// menu); when the read ends the list is updated under the lock.
    #[test]
    fn no_lock_held_while_reading_recent_file() {
        let d = FileState::default();
        let file = std::env::temp_dir().join(format!("mc-lock-{}.pdf", uuid::Uuid::new_v4()));
        fs::write(&file, b"%PDF-lock").unwrap();
        let mut list = RecentList::default();
        let entry = recent::Entry {
            id: uuid::Uuid::new_v4().to_string(),
            name: "lock.pdf".into(),
            kind: "pdf".into(),
            date: 1,
            path: file.to_string_lossy().into_owned(),
            bookmark: None,
        };
        let id = entry.id.clone();
        list.add(entry);
        list.add(recent::Entry {
            id: uuid::Uuid::new_v4().to_string(),
            path: "/other.pdf".into(),
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
            "the recent files lock must be free during the read"
        );
        let l = d.last.lock().unwrap();
        let l = l.as_ref().unwrap();
        assert_eq!(l.entries[0].id, id, "the read entry moved to the front");
        assert_eq!(l.entries[0].date, 77);
    }

    /// D12: the Save dialog opens in the last saved folder; when there is none (or it was deleted) in the user's real
    /// Documents folder; otherwise the system default.
    #[test]
    fn save_folder_is_last_saved_else_documents() {
        let home_dir = std::env::temp_dir().join(format!("mc-home_dir-{}", uuid::Uuid::new_v4()));
        let documents = home_dir.join("Documents");
        let last = home_dir.join("Books");
        fs::create_dir_all(&documents).unwrap();
        fs::create_dir_all(&last).unwrap();
        let e = Some(home_dir.as_path());
        assert_eq!(select_save_folder(Some(&last), e), Some(last.clone()));
        assert_eq!(select_save_folder(None, e), Some(documents.clone()));
        assert_eq!(
            select_save_folder(Some(&home_dir.join("deleted")), e),
            Some(documents.clone()),
            "deleted last folder"
        );
        let file = home_dir.join("file.pdf");
        fs::write(&file, b"x").unwrap();
        assert_eq!(
            select_save_folder(Some(&file), e),
            Some(documents.clone()),
            "not a folder"
        );
        fs::remove_dir_all(&documents).unwrap();
        assert_eq!(select_save_folder(None, e), None, "no Documents either");
        // the last folder file: round trip, empty/missing → None
        let kd = home_dir.join(SAVE_FOLDER_FILE);
        assert_eq!(read_last_save_folder(&kd), None, "no file");
        recent::write_atomic(&kd, "/Users/x/Books ğ\n".as_bytes()).unwrap(); // turkish-ok: Turkish test text (UTF-8 names)
        assert_eq!(
            read_last_save_folder(&kd),
            Some(PathBuf::from("/Users/x/Books ğ")) // turkish-ok: Turkish test text (UTF-8 names)
        );
        fs::write(&kd, "").unwrap();
        assert_eq!(read_last_save_folder(&kd), None, "empty");
        fs::remove_dir_all(&home_dir).unwrap();
        // sandbox container → the real home; outside a container unchanged
        assert_eq!(
            actual_home(Path::new(
                "/Users/user/Library/Containers/com.onurmert.mucellit/Data"
            )),
            PathBuf::from("/Users/user")
        );
        assert_eq!(
            actual_home(Path::new("/Users/user")),
            PathBuf::from("/Users/user")
        );
        assert_eq!(
            actual_home(Path::new("/Users/user/Library/Containers")),
            PathBuf::from("/Users/user/Library/Containers"),
            "no container id"
        );
    }
    /// L5: when `HOME` is missing, empty or relative the home folder is ignored (no relative "Documents" is suggested); the
    /// last saved folder cannot be relative either (a hand-broken last-save-folder.txt).
    #[test]
    fn no_relative_folder_suggested_when_home_missing_or_relative() {
        use std::ffi::OsStr;
        assert_eq!(find_home(None), None, "HOME missing");
        assert_eq!(find_home(Some(OsStr::new(""))), None, "HOME empty");
        assert_eq!(
            find_home(Some(OsStr::new("relative/home"))),
            None,
            "HOME relative"
        );
        assert_eq!(
            find_home(Some(OsStr::new(
                "/Users/user/Library/Containers/com.onurmert.mucellit/Data"
            ))),
            Some(PathBuf::from("/Users/user"))
        );
        assert_eq!(
            find_home(Some(OsStr::new("/Users/user"))),
            Some(PathBuf::from("/Users/user"))
        );
        // cargo test runs in the src-tauri/ folder: the relative "src" is a folder
        assert!(Path::new("src").is_dir());
        assert_eq!(
            select_save_folder(Some(Path::new("src")), None),
            None,
            "a relative last folder is not suggested"
        );
        assert_eq!(
            select_save_folder(None, Some(Path::new(""))),
            None,
            "empty home → no relative Documents"
        );
        assert_eq!(read_last_save_folder(Path::new("/missing/file")), None);
    }
}
