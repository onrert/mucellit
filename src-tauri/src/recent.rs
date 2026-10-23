//! Recent files: at most 10 entries, the newest first, `app_data_dir/recent-files.json`.
//!
//! In the macOS sandbox the app has no access to a file the user chose earlier once it is reopened;
//! access comes back only with a **security-scoped bookmark**. The bookmark is made at the moment of the choice (Open
//! dialog, a drop on the Dock, Finder "Open With": while the access is alive). Reading goes "resolve → start access → read →
//! release access" and is **short lived** (`apple_scoped_bookmarks::ScopedAccess` dropping calls
//! `stopAccessingSecurityScopedResource`); no entry is resolved at start-up. When the bookmark is stale (the file moved)
//! it is made again while the access is alive and saved.
//!
//! An entry that cannot be read leaves the list for good only when the file really **does not exist** (`NOTFOUND`) or
//! the entry is invalid (`INVALID`: kind mismatch, broken bookmark). Access denied (`ACCESS`), a disk that is not
//! mounted (`NODISK`: the saved path is `/Volumes/<name>/…` and there is no disk) and a transient error (`TRANSIENT`) keep the entry.
//! When a bookmark cannot be resolved (macOS gives NSCocoaErrorDomain 4 "The file doesn't exist" in every case; in a
//! locked folder too) the cases are told apart with `lstat` of the saved path; in the sandbox `lstat` works on a path
//! without permission too (exists: OK, missing: ENOENT; only reading gives EPERM).
//!
//! On a non-Apple platform (`Error::Unsupported`) there is no bookmark and the entry is read with the plain path (ready for Windows).
//! The bookmark operations are behind the `Bookmarks` trait: the tests run with a fake implementation (a real bookmark
//! needs a signed + sandboxed process; see the manual tests S11/S12).

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The most entries kept in the list.
pub const MAX_ENTRIES: usize = 10;
/// Name of the entry file (inside `app_data_dir`).
pub const FILE_NAME: &str = "recent-files.json";

/// One recent file entry. `path` stays on the Rust side only (JS gets a `Summary`).
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
    /// Puts the entry first. An entry with the same path is removed (its id is kept: the menu item stays the same).
    /// At most `MAX_ENTRIES` entries stay. Returns the id of the entry put first.
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

    /// Removes the entry; true when it was there.
    pub fn forget(&mut self, id: &str) -> bool {
        let once = self.entries.len();
        self.entries.retain(|k| k.id != id);
        once != self.entries.len()
    }

    /// Moves the entry to the front (opened again), writes its date and the optional new bookmark/path.
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

    /// Reads from the file. When it is missing, unreadable or broken: an empty list (the app start-up never breaks).
    /// Invalid entries (id not a uuid, unknown kind) are dropped; the extra ones are cut off.
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

    /// Writes to a temp file and renames it (no half-written file is left).
    pub fn save(&self, path: &Path) -> io::Result<()> {
        let json = serde_json::to_vec_pretty(self).map_err(io::Error::other)?;
        write_atomic(path, &json)
    }
}

/// Bytes the temp name adds to the real name: "." + "." + uuid (36) + ".temp" (5).
pub const TEMP_SUFFIX_BYTES: usize = 1 + 1 + 36 + 5;

/// Writes to `path` with a temp file + rename; creates the parent folder when needed. The temp file name is unique on
/// every write (concurrent writes do not overwrite each other) and the content is synced to disk before the rename.
/// The temp name is `.<name>.<uuid>.temp`; `<name>` is cut to 255 − 43 bytes (O2, ENAMETOOLONG on a long name).
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
        // make the rename itself durable too (the folder entry); a failure does not break the write.
        let _ = fs::File::open(top).and_then(|k| k.sync_all());
    }
    result
}

/// The result of a bookmark read.
pub struct ReadResult {
    pub bytes: Vec<u8>,
    /// The resolved (current) path: changes when the file moved.
    pub path: PathBuf,
    /// The bookmark was stale and was made again: the new bytes to save.
    pub new_bookmark: Option<Vec<u8>>,
}

/// A read error; goes to JS as `CODE: message` (app/js/platform-tauri.js `openRecent`).
#[derive(Debug, PartialEq, Eq)]
pub enum ReadError {
    /// The id is not in the list (or an invalid id). An arbitrary path ends here too.
    Unknown,
    /// The file does not exist (deleted; when moved, the bookmark could not find it). The entry leaves for good.
    NotFound(String),
    /// The entry is invalid (the kind of the path does not match the entry, broken bookmark: L3). The entry leaves for good.
    Invalid(String),
    /// The system gave no access (missing entitlement, a differently signed build, a folder without permission). The entry stays.
    Access(String),
    /// The disk of the file is not mounted (message: the disk name). The entry stays.
    NoDisk(String),
    /// Another/transient read error (the file is in place). The entry stays.
    Transient(String),
}

impl ReadError {
    /// Does the entry leave the list for good? Only when the file does not exist or the entry is invalid.
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

/// The raw error of the bookmark layer; it is classified (`classify`) with the saved path.
#[derive(Debug)]
pub enum RawError {
    /// The bookmark could not be resolved (Cocoa error description).
    Unresolved(String),
    /// The bookmark was resolved, the system did not give security-scoped access.
    AccessDenied(String),
    /// Access taken, the read failed.
    Read(io::Error),
}

/// Bookmark operations (real: `AppleBookmarks`; fake in the tests).
pub trait Bookmarks {
    /// Makes a bookmark at the moment of the choice (while the access is alive). `Ok(None)`: the platform does not support it.
    fn create(&self, path: &Path) -> Result<Option<Vec<u8>>, String>;
    /// Resolves the bookmark, starts the access, reads the content with `read`, makes a new bookmark when stale and
    /// **releases** the access (before returning).
    fn access_and_read(
        &self,
        bookmark: &[u8],
        read: &dyn Fn(&Path) -> io::Result<Vec<u8>>,
    ) -> Result<ReadResult, RawError>;
}

/// The real implementation with `apple-scoped-bookmarks`.
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
        // `access` is dropped at the end of this block: stopAccessingSecurityScopedResource (short-lived access).
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

/// Builds a new entry (makes the bookmark at the moment of the choice). When the bookmark cannot be made the entry is
/// still added (it can be opened with the plain path only in this session / on a non-Apple platform); the error goes to stderr.
pub fn make_entry(yi: &dyn Bookmarks, path: &Path, name: &str, kind: &str, date: u64) -> Entry {
    let bookmark = match yi.create(path) {
        Ok(v) => v.map(|b| base64::engine::general_purpose::STANDARD.encode(b)),
        Err(e) => {
            eprintln!("bookmark could not be made ({}): {e}", path.display());
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

/// Is the saved path on a disk that is not mounted (`/Volumes/<name>/…` and no `/Volumes/<name>`)? The disk name.
pub fn unmounted_disk(path: &Path) -> Option<String> {
    unmounted_disk_in(path, Path::new("/Volumes"))
}

/// `unmounted_disk` with the mount folder given (a temp folder in the test). L4: when `/Volumes/<name>` is missing, or
/// exists as a folder but no disk is mounted on it (same device as `/Volumes`: an empty folder left by a disk that was
/// not ejected properly), the disk is not mounted. A symbolic link (`Macintosh HD -> /`) counts as mounted.
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

/// Are the two paths on the same file system (not a mount point)? false when unknown (counted as mounted).
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

/// Removes crash leftover temp files: those matching the `.<name>.<uuid>.temp` pattern of `write_atomic`, that are plain
/// files and older than `min_age` (a fresh one may be being written now). Returns the number removed.
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

/// The most symbolic links followed while resolving a path (the same as macOS `MAXSYMLINKS`: 32).
pub const SYMLINK_LIMIT: usize = 32;

/// L4: resolves the path by following the symbolic links in its existing components (chain, relative target,
/// intermediate folder link) and normalising `.`/`..` lexically. After a component that does not exist it is only normalised
/// (so a target on an unmounted disk shows as `/Volumes/<name>/…`). At most `SYMLINK_LIMIT` links are followed;
/// on a loop or a too long chain the path resolved so far is returned (no endless loop).
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
                        // a relative target relative to the folder of the link (resolved), an absolute target from the root
                        add(&mut rest, &mut resolved, &target, true);
                        continue;
                    }
                }
                Ok(_) => {}
                Err(_) => var_may = false, // the rest does not exist on disk: only normalise
            }
        }
        resolved = candidate;
    }
    if resolved.as_os_str().is_empty() {
        resolved.push(".");
    }
    resolved
}

/// Turns the raw error into the code that goes to the user. When the disk is not mounted every error is `NoDisk`: when
/// the saved path or its symlink-resolved form (`resolve_symlinks`: chain, relative target, intermediate folder link) is
/// on an unmounted disk. When the bookmark could not be resolved, `lstat` of the saved path decides (missing → NotFound,
/// no permission → Access, exists → Transient; for a link the `stat` of the target: missing → NotFound, loop/other → Transient).
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
            // L4: when the saved path is a symbolic link its target is checked (a dead link must not stay "transient" forever); a
            // target on an unmounted disk already returned NoDisk above.
            Ok(b) if b.file_type().is_symlink() => match fs::metadata(saved_path) {
                Err(e) if e.kind() == io::ErrorKind::NotFound => ReadError::NotFound(m),
                Err(e) if e.kind() == io::ErrorKind::PermissionDenied => ReadError::Access(m),
                _ => ReadError::Transient(m),
            },
            _ => ReadError::Transient(m),
        },
    }
}

/// Step 1 (with the list locked, short): checks the id and gives a copy of the entry. An unknown/invalid id →
/// `Unknown` (the file system is not touched at all).
pub fn take_entry(list: &RecentList, id: &str) -> Result<Entry, ReadError> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(ReadError::Unknown);
    }
    list.find(id).cloned().ok_or(ReadError::Unknown)
}

/// Step 2 (NOT locked; may take long for a big EPUB): reads the entry with the bookmark or the plain path. When the kind
/// of the path does not match the entry (D7; the resolved path for an entry with a bookmark) it is not read at all: `Invalid`.
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
            // L1: a folder package; when its content cannot be read (permission, not downloaded from iCloud) it is not permanently "invalid".
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

/// Step 3 (with the list locked, short): on success the entry moves to the front (a stale bookmark/path is renewed); a
/// permanent error removes the entry, otherwise it stays. When the entry was cleared meanwhile the list does not change.
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

/// Reads an entry of the list (the three steps under one lock; the app reads without the lock with `files::read_recent_entry`).
/// Returns: (bytes, the entry summary). When `list` changed the caller saves it and refreshes the menu.
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

    /// (observation for the manual L4 step): the entry keeps the path given to Rust (the path of the symbolic link itself)
    /// AS IT IS (does not resolve it). A real Apple bookmark is made from the link path; the path returned on resolving is
    /// fixed below. Which path arrives depends on the Open dialog: NSOpenPanel `resolvesAliases` is on by default (rfd does not change it).
    #[cfg(target_os = "macos")]
    #[test]
    fn entry_keeps_symlink_path_bookmark_observation() {
        use std::os::unix::fs::symlink;
        let d = temp_folder().canonicalize().unwrap();
        let target = d.join("target.pdf");
        fs::write(&target, b"%PDF-1.4 0b").unwrap();
        let bag = d.join("bag.pdf");
        symlink(&target, &bag).unwrap();
        let entry = make_entry(&AppleBookmarks, &bag, "bag.pdf", "pdf", 1);
        assert_eq!(entry.path, bag.to_string_lossy(), "the entry keeps the link path");
        assert_eq!(entry.name, "bag.pdf");
        let bookmark = entry
            .bookmark
            .as_deref()
            .map(|b| base64::engine::general_purpose::STANDARD.decode(b).unwrap());
        eprintln!(
            "0b observation: bookmark {}",
            if bookmark.is_some() {
                "made"
            } else {
                "none"
            }
        );
        if let Some(b) = bookmark {
            let o = AppleBookmarks
                .access_and_read(&b, &|p: &Path| fs::read(p))
                .unwrap_or_else(|e| panic!("bookmark could not be resolved: {e:?}"));
            eprintln!("0b observation: resolved path {}", o.path.display());
            assert_eq!(o.bytes, b"%PDF-1.4 0b");
            // Observation (macOS 26.6.2): a bookmark made from a link path resolves to the TARGET file.
            assert_eq!(o.path, target, "the bookmark follows the link, gives the path of the target");
            // on the first successful open from Recent Items the entry path is updated to the resolved (target) path; the name stays.
            let mut l = RecentList::default();
            let id = l.add(entry.clone());
            let (bytes, summary) =
                read(&mut l, &AppleBookmarks, &id, 2, &|p: &Path| fs::read(p)).unwrap();
            assert_eq!(bytes, b"%PDF-1.4 0b");
            assert_eq!(summary.name, "bag.pdf");
            assert_eq!(
                l.find(&id).unwrap().path,
                target.to_string_lossy(),
                "after opening the entry keeps the target path"
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
            "the oldest dropped"
        );
        assert!(l.find(&first).is_none());
        // the same path again: comes first, stays single, keeps its id
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
        l.move_to_front(&a, 99, Some("NEW".into()), Some("/moved/a.pdf".into()));
        assert_eq!(l.entries[0].id, a);
        assert_eq!(l.entries[0].date, 99);
        assert_eq!(l.entries[0].bookmark.as_deref(), Some("NEW"));
        assert_eq!(l.entries[0].path, "/moved/a.pdf");
        assert!(l.forget(&b));
        assert!(!l.forget(&b));
        assert_eq!(l.entries.len(), 1);
    }

    #[test]
    fn corrupt_json_or_missing_file_gives_empty_list_invalid_entries_dropped() {
        let d = temp_folder();
        let path = d.join(FILE_NAME);
        assert_eq!(RecentList::load(&path), RecentList::default(), "no file");
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
        // valid + invalid id + unknown kind + 12 entries → 10 valid
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
        assert_eq!(temp_files(&d), Vec::<String>::new(), "no temp file left");
        fs::remove_dir_all(&d).unwrap();
    }

    /// L2: the files with the `.temp` extension in the folder (the name of write_atomic is `.<name>.<uuid>.temp`; the old
    /// check looked for a fixed `<name>.temp` name, so it always passed).
    pub(crate) fn temp_files(d: &Path) -> Vec<String> {
        let mut l: Vec<String> = fs::read_dir(d)
            .unwrap()
            .map(|g| g.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|a| a.ends_with(".temp"))
            .collect();
        l.sort();
        l
    }

    /// L1: when the content of a folder package EPUB cannot be read (not downloaded from iCloud/dataless, META-INF without
    /// permission) the entry is NOT REMOVED; a folder whose content can be read but has no container.xml is really invalid (removed).
    #[cfg(unix)]
    #[test]
    fn entry_stays_when_folder_package_contents_unreadable() {
        use std::os::unix::fs::PermissionsExt;
        let d = temp_folder();
        let locked = d.join("Locked.epub");
        fs::create_dir_all(locked.join("META-INF")).unwrap();
        fs::write(locked.join("META-INF/container.xml"), "<c/>").unwrap();
        fs::write(locked.join("mimetype"), "application/epub+zip").unwrap();
        let blank = d.join("NotDownloaded.epub");
        fs::create_dir_all(&blank).unwrap();
        let fake = d.join("Fake.epub");
        fs::create_dir_all(&fake).unwrap();
        fs::write(fake.join("not.txt"), "x").unwrap();
        let mut l = RecentList::default();
        let ka = l.add(k(locked.to_str().unwrap()));
        let kb = l.add(make_entry(&Fake::new(), &locked, "Locked.epub", "epub", 1));
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
            "empty (not downloaded) package: {}",
            result[2]
        );
        assert!(
            result[3].starts_with("INVALID:"),
            "folder without container.xml: {}",
            result[3]
        );
        for id in [&ka, &kb, &mc] {
            assert!(l.find(id).is_some(), "the entry of a package whose content cannot be read stays");
        }
        assert!(l.find(&kd).is_none(), "a really invalid folder is removed");
        // the same entry opens when the permission comes back
        assert!(read(&mut l, &Fake::new(), &ka, 3, &read_fn).is_ok());
        fs::remove_dir_all(&d).unwrap();
    }

    /// L4: a symbolic link whose target was deleted is "not found" (removed for good), not "transient"; when its target is
    /// on an unmounted disk it is "no disk". An empty mount folder (`/Volumes/<name>` exists but no disk is mounted) does
    /// not count as mounted; a symbolic link like `/Volumes/Macintosh HD` is mounted.
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
        let target = d.join("target.pdf");
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
        assert!(ha.starts_with("NOTFOUND:"), "dead link (with bookmark): {ha}");
        assert!(hb.starts_with("NOTFOUND:"), "dead link (without bookmark): {hb}");
        assert!(
            hc.starts_with("NODISK:") && hc.contains(&disk),
            "the target of the link is on an unmounted disk: {hc}"
        );
        assert!(
            l.find(&ka).is_none() && l.find(&kb).is_none(),
            "the dead link entry is removed"
        );
        assert!(l.find(&mc).is_some(), "without the disk the entry stays");
        // mount folder
        let vol = d.join("Volumes");
        fs::create_dir_all(vol.join("Empty")).unwrap();
        symlink("/", vol.join("Root")).unwrap();
        assert_eq!(
            unmounted_disk_in(&vol.join("Empty/Book/a.pdf"), &vol),
            Some("Empty".into()),
            "empty mount folder: the disk is not mounted"
        );
        assert_eq!(
            unmounted_disk_in(&vol.join("Missing/a.pdf"), &vol),
            Some("Missing".into())
        );
        assert_eq!(
            unmounted_disk_in(&vol.join("Root/Users/a.pdf"), &vol),
            None,
            "a symbolic link (like Macintosh HD) is mounted"
        );
        assert_eq!(
            unmounted_disk_in(Path::new("/Users/x/a.pdf"), &vol),
            None,
            "outside Volumes"
        );
        assert_eq!(unmounted_disk_in(&vol, &vol), None, "no disk name");
        assert_eq!(
            unmounted_disk(Path::new("/Volumes/Macintosh HD/Users/a.pdf")),
            None,
            "the startup disk is mounted"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// When a link chain, a relative target (`..` included, normalised) or an intermediate folder link
    /// leads to an unmounted disk: NODISK (the entry stays); the same with and without a bookmark. A loop and a very
    /// long chain end at a limited depth (not counted as NODISK, the entry is not removed).
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
        // chain: chain1 -> chain2 -> /Volumes/<disk>/a.pdf
        symlink(format!("{vol}/a.pdf"), d.join("chain2.pdf")).unwrap();
        symlink(d.join("chain2.pdf"), d.join("chain1.pdf")).unwrap();
        // a relative target (does not carry the /Volumes prefix without normalising) and a relative chain
        symlink(format!("{deep}Volumes/{disk}/b.pdf"), d.join("relative.pdf")).unwrap();
        symlink("relative.pdf", d.join("relative-chain.pdf")).unwrap();
        symlink(
            format!("./alt/../{deep}Volumes/./{disk}/c.pdf"),
            d.join("dotted.pdf"),
        )
        .unwrap();
        // intermediate folder link: d/disk-folder -> /Volumes/<disk>/Books; the entry d/disk-folder/c.pdf
        symlink(format!("{vol}/Books"), d.join("disk-folder")).unwrap();
        // a chain of 10 links
        symlink(format!("{vol}/long.pdf"), d.join("link0.pdf")).unwrap();
        for i in 1..10 {
            symlink(
                format!("link{}.pdf", i - 1),
                d.join(format!("link{i}.pdf")),
            )
            .unwrap();
        }
        let paths = [
            d.join("chain1.pdf"),
            d.join("relative.pdf"),
            d.join("relative-chain.pdf"),
            d.join("dotted.pdf"),
            d.join("disk-folder/c.pdf"),
            d.join("link9.pdf"),
        ];
        let read_fn = |p: &Path| fs::read(p);
        let mut failed = Vec::new();
        for y in &paths {
            let name = y.file_name().unwrap().to_string_lossy().into_owned();
            // one entry per path (RecentList::add): with and without a bookmark in separate lists
            for (entry, kind) in [
                (make_entry(&Unresolvable, y, &name, "pdf", 1), "yer imli"),
                (k(y.to_str().unwrap()), "without bookmark"),
            ] {
                assert_eq!(entry.bookmark.is_some(), kind == "yer imli");
                let mut l = RecentList::default();
                let id = l.add(entry);
                let h = read(&mut l, &Unresolvable, &id, 2, &read_fn)
                    .unwrap_err()
                    .to_string();
                if !(h.starts_with("NODISK:") && h.contains(&disk)) || l.find(&id).is_none() {
                    failed.push(format!(
                        "{kind} {}: {h} (entry {})",
                        name,
                        if l.find(&id).is_some() {
                            "stopped"
                        } else {
                            "REMOVED"
                        }
                    ));
                }
            }
        }
        assert!(failed.is_empty(), "{failed:#?}");
        let mut l = RecentList::default();
        // a loop and a chain over the limit: it ends, not NODISK, the entry stays (no permanent removal)
        symlink(d.join("dongu2.pdf"), d.join("dongu1.pdf")).unwrap();
        symlink(d.join("dongu1.pdf"), d.join("dongu2.pdf")).unwrap();
        symlink(format!("{vol}/very-long.pdf"), d.join("u0.pdf")).unwrap();
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
        // the path resolver itself: normalise + limit
        assert_eq!(
            resolve_symlinks(&d.join("relative.pdf")),
            PathBuf::from(format!("{vol}/b.pdf"))
        );
        assert_eq!(
            resolve_symlinks(Path::new("/a/./b/../c")),
            PathBuf::from("/a/c"),
            "a path without links is only normalised"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// L7: crash leftover temp files (`.<name>.<uuid>.temp`, older than a given age) are removed at start-up;
    /// fresh ones (may be being written now), ones not matching the pattern, folders and links are not touched.
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
        let bag_target = old("target.txt");
        let bag = d.join(format!(".bag.{}.temp", u()));
        std::os::unix::fs::symlink(&bag_target, &bag).unwrap();
        let n = remove_leftover_temps(&d, Duration::from_secs(60));
        assert_eq!(n, 2, "two old leftovers removed");
        assert!(
            !artik1.exists() && !artik2.exists(),
            "old leftovers removed"
        );
        for rest in [
            &fresh,
            &without_pattern,
            &without_uuid,
            &original,
            &folder,
            &bag_target,
        ] {
            assert!(rest.exists(), "must not be touched: {}", rest.display());
        }
        assert!(fs::symlink_metadata(&bag).is_ok(), "the link was not touched");
        assert_eq!(
            remove_leftover_temps(&d.join("none"), Duration::from_secs(60)),
            0,
            "no folder"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// A fake bookmark: bytes = the path itself; the behaviour is chosen with `stale` and `deny`; an access counter checks
    /// that no access stays open (short lived).
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
        /// Like the real macOS: a bookmark cannot be resolved when the file is missing (or its disk is not mounted).
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
        let actual = d.join("secret.pdf");
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
            "a file must not be read for an unknown id"
        );
        assert_eq!(l.entries.len(), 1, "an unknown id does not change the list");
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
        assert_eq!(l.entries[0].id, ka, "the read entry moved to the front");
        assert_eq!(l.entries[0].date, 50);
        assert_eq!(
            l.entries[0].bookmark.as_deref(),
            Some("TkVX"),
            "stale bookmark renewed (base64 'NEW')"
        );
        assert_eq!(*yi.is_open.borrow(), 0, "access released");
        assert_eq!(*yi.max_open.borrow(), 1);
        fs::remove_dir_all(&d).unwrap();
    }

    /// S11c: a deleted file is "not found" and leaves the list for good (entries with and without a bookmark).
    #[test]
    fn read_deleted_entry_not_found_and_removed_from_list() {
        let d = temp_folder();
        let a = d.join("to-delete.pdf");
        let b = d.join("plain-to-delete.pdf");
        fs::write(&a, b"%PDF").unwrap();
        fs::write(&b, b"%PDF").unwrap();
        let mut l = RecentList::default();
        let ka = l.add(make_entry(&Fake::new(), &a, "to-delete.pdf", "pdf", 1));
        let kb = l.add(k(b.to_str().unwrap()));
        let mc = l.add(k(d.join("remaining.pdf").to_str().unwrap()));
        fs::remove_file(&a).unwrap();
        fs::remove_file(&b).unwrap();
        for id in [&ka, &kb] {
            let h = read(&mut l, &Fake::new(), id, 2, &|p: &Path| fs::read(p)).unwrap_err();
            assert!(h.to_string().starts_with("NOTFOUND:"), "{h}");
            assert!(l.find(id).is_none(), "the one not found was removed");
        }
        assert!(l.find(&mc).is_some(), "the others stay");
        fs::remove_dir_all(&d).unwrap();
    }

    /// O4: access denied does NOT REMOVE the entry (an entitlement/signature difference may be temporary); a separate "ACCESS:" code.
    #[test]
    fn access_denied_keeps_the_entry() {
        let d = temp_folder();
        let a = d.join("denied.pdf");
        fs::write(&a, b"%PDF").unwrap();
        let mut l = RecentList::default();
        let ka = l.add(make_entry(&Fake::new(), &a, "denied.pdf", "pdf", 1));
        let red = Fake {
            reject: true,
            ..Fake::new()
        };
        let h = read(&mut l, &red, &ka, 2, &|p: &Path| fs::read(p)).unwrap_err();
        assert!(h.to_string().starts_with("ACCESS:"), "{h}");
        assert!(l.find(&ka).is_some(), "the entry stays on access denied");
        // a read permission error (sandbox EPERM) on an entry without a bookmark keeps the entry too
        let kb = l.add(k(a.to_str().unwrap()));
        let unpermitted = |_: &Path| -> io::Result<Vec<u8>> {
            Err(io::Error::from(io::ErrorKind::PermissionDenied))
        };
        let h = read(&mut l, &Fake::new(), &kb, 2, &unpermitted).unwrap_err();
        assert!(h.to_string().starts_with("ACCESS:"), "{h}");
        assert!(l.find(&kb).is_some());
        fs::remove_dir_all(&d).unwrap();
    }

    /// O4: an entry on an unmounted disk (no `/Volumes/<name>`) is not removed; the "NODISK:" code gives the disk name.
    #[test]
    fn unmounted_disk_keeps_the_entry() {
        let disk = format!("mc-mounted-non-{}", uuid::Uuid::new_v4());
        let path = format!("/Volumes/{disk}/Books/thesis.pdf");
        let mut l = RecentList::default();
        let ka = l.add(k(&path)); // without a bookmark
        let kb = l.add(make_entry(
            &Fake::new(),
            Path::new(&path.replace("tez", "two")),
            "two.pdf",
            "pdf",
            1,
        )); // with a bookmark: cannot be resolved
        for id in [&ka, &kb] {
            let h = read(&mut l, &Fake::new(), id, 2, &|p: &Path| fs::read(p)).unwrap_err();
            let m = h.to_string();
            assert!(m.starts_with("NODISK:") && m.contains(&disk), "{m}");
            assert!(l.find(id).is_some(), "the entry on an unmounted disk stays");
        }
    }

    /// O4: a transient read error (the file is in place) keeps the entry; the "TRANSIENT:" code.
    #[test]
    fn transient_read_error_keeps_the_entry() {
        let d = temp_folder();
        let a = d.join("in-place.pdf");
        fs::write(&a, b"%PDF").unwrap();
        let mut l = RecentList::default();
        let ka = l.add(k(a.to_str().unwrap()));
        let kb = l.add(make_entry(&Fake::new(), &a, "in-place.pdf", "pdf", 1));
        let mounted = |_: &Path| -> io::Result<Vec<u8>> {
            Err(io::Error::other("Resource deadlock avoided"))
        };
        for id in [&ka, &kb] {
            let h = read(&mut l, &Fake::new(), id, 2, &mounted).unwrap_err();
            assert!(h.to_string().starts_with("TRANSIENT:"), "{h}");
            assert!(l.find(id).is_some(), "the entry stays on a transient error");
        }
        fs::remove_dir_all(&d).unwrap();
    }

    /// O4: the bookmark could not be resolved but the file is in place (lstat: exists) → TRANSIENT; the parent folder is locked
    /// (lstat: EACCES; the real macOS also gives "The file doesn't exist" here) → ACCESS. The entry stays in both.
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
        let in_place = d.join("in-place.pdf");
        fs::write(&in_place, b"%PDF").unwrap();
        let locked = d.join("locked");
        fs::create_dir_all(&locked).unwrap();
        fs::write(locked.join("ic.pdf"), b"%PDF").unwrap();
        let mut l = RecentList::default();
        let ka = l.add(make_entry(
            &Unresolvable,
            &in_place,
            "in-place.pdf",
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
            &d.join("missing.pdf"),
            "missing.pdf",
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
            "the in-place/locked entries stay"
        );
        assert!(l.find(&mc).is_none(), "the missing one is removed");
        fs::remove_dir_all(&d).unwrap();
    }

    /// D7: the kind of the path is checked for an entry without a bookmark (a hand-edited recent-files.json cannot make an arbitrary file be read).
    #[test]
    fn kind_checked_for_entry_without_bookmark() {
        let d = temp_folder();
        let txt = d.join("not.txt");
        fs::write(&txt, b"text").unwrap();
        let folder = d.join("folder.pdf");
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
            assert!(l.find(&id).is_none(), "an invalid entry is removed: {path}");
        }
        assert!(
            touched.borrow().is_empty(),
            "a path with a mismatching kind must not be read: {:?}",
            touched.borrow()
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// O2: a target name up to 255 bytes (UTF-8 multi-byte included) — the temp name `.<name>.<uuid>.temp` must not
    /// pass 255 bytes either (+45 bytes in the past → ENAMETOOLONG).
    #[test]
    fn write_atomic_with_255_byte_name_temp_name_matches_pattern_and_limit() {
        let d = temp_folder();
        for name in [
            "ğ".repeat(126) + ".pdf", // 256 bytes → cut to 255 (at a character boundary: 254)  // turkish-ok: Turkish test text (UTF-8 names)
            "a".repeat(251) + ".pdf", // tam 255
            "Ş".repeat(100) + &"x".repeat(51), // 251  // turkish-ok: Turkish test text (UTF-8 names)
        ] {
            let name =
                crate::files::truncate_bytes(&name, crate::files::NAME_MAX_BYTES).to_string();
            let target = d.join(&name);
            write_atomic(&target, b"data").unwrap_or_else(|e| panic!("{} bytes: {e}", name.len()));
            assert_eq!(fs::read(&target).unwrap(), b"data");
        }
        assert!(temp_files(&d).is_empty(), "{:?}", temp_files(&d));
        // the temp name pattern (remove_leftover_temps knows it) and the limit: the cut name + uuid
        let source = include_str!("recent.rs");
        let body = &source[source.find("pub fn write_atomic").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        assert!(
            body.contains("TEMP_SUFFIX_BYTES") && body.contains("truncate_bytes("),
            "the temp name is not cut"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// D8: concurrent atomic writes do not overwrite each other's temp file (all succeed, the last content is one of the
    /// written ones, no temp file left); the write is synced to disk before the rename (sync_all).
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
        assert_eq!(failed, 0, "error in a concurrent write");
        let last: serde_json::Value = serde_json::from_slice(&fs::read(&target).unwrap()).unwrap();
        assert!(last["i"].is_u64() && last["j"].is_u64(), "{last}");
        let rest: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .map(|g| g.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|a| a != "projects.json")
            .collect();
        assert!(rest.is_empty(), "a temp file was left: {rest:?}");
        let source = include_str!("recent.rs");
        let body = &source[source.find("pub fn write_atomic").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        assert!(body.contains(".sync_all()"), "no sync_all before the rename");
        fs::remove_dir_all(&d).unwrap();
    }

    /// L3: a broken (not base64) bookmark is not "not found (deleted or moved)" but "invalid entry".
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
        entry.bookmark = Some("%%% not base64".into());
        entry.path = "/other".into();
        let k2 = l.add(entry);
        let h = read(&mut l, &Fake::new(), &k2, 2, &|p: &Path| fs::read(p));
        assert!(matches!(&h, Err(ReadError::Invalid(_))), "{:?}", h.err());
        assert!(l.find(&k2).is_none(), "a broken bookmark entry is removed");
        fs::remove_dir_all(&d).unwrap();
    }

    /// An old `son-acilanlar.json` (the legacy file name) opens as it is (the legacy field names are read through serde aliases).  // turkish-ok: legacy file name (migration)
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
        assert_eq!(l.entries[1].name, "Çiğdemköy & Ekler.pdf");  // turkish-ok: Turkish test text (UTF-8 names)
        assert_eq!(
            l.entries[1].bookmark, None,
            "an old entry without the bookmark field"
        );
        let summary = serde_json::to_string(&l.summaries()).unwrap();
        assert!(
            summary.contains("Çiğdemköy & Ekler.pdf") && !summary.contains("/Users/"),  // turkish-ok: Turkish test text (UTF-8 names)
            "{summary}"
        );
    }

    #[test]
    fn summary_has_no_path_or_bookmark() {
        let mut entry = k("/secret/path/a.pdf");
        entry.bookmark = Some("QUJD".into());
        let json = serde_json::to_string(&Summary::from(&entry)).unwrap();
        assert!(
            !json.contains("hidden") && !json.contains("QUJD") && !json.contains("path"),
            "{json}"
        );
    }
}
