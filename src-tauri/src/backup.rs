//! The automatic backup of the project data: localStorage stays primary; in Tauri after every `storage.write` /
//! `clear` the JSON is also written to `app_data_dir/projects.json` (temp file + rename). At start-up, when
//! localStorage is empty the web side restores this backup (app/js/platform-tauri.js).
//! Writing inside the app container needs no extra entitlement ("full read and write access to its sandbox container").
//!
//! the debounce moved from JS to Rust. JS sends every change **at once** with `backup_data`;
//! `BackupWriter` keeps the newest in memory, a worker thread writes it to disk after `DELAY` (merges frequent writes).
//! When the app quits (`RunEvent::Exit`: ⌘Q, Quit from the Dock, the last window closed) the pending backup is written
//! without waiting. So no old filled backup is left after "Clear all → ⌘Q at once". Order: the JS session id + an
//! increasing number; an old call from the same session that arrives late is ignored.

use crate::i18n::text;
use crate::recent::write_atomic;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub const FILE_NAME: &str = "projects.json";
/// The upper limit of the backup; the project data is text and small (projects + step lists).
pub const MAX_BYTES: usize = 16 << 20;

fn file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join(FILE_NAME))
        .map_err(|e| e.to_string())
}

/// The wait before writing to disk (frequent changes merge into one write).
pub const DELAY: Duration = Duration::from_secs(1);
/// The event with which the worker tells the webview it could not write (payload: the error text).
pub const ERROR_EVENT: &str = "backup-writeFailed";

/// Is the backup valid: a JSON object and at most `MAX_BYTES` bytes.
pub fn validate(json: &str) -> Result<(), String> {
    if json.len() > MAX_BYTES {
        return Err(text(
            "rust.backup_large",
            &[("bytes", &json.len().to_string())],
        ));
    }
    match serde_json::from_str::<serde_json::Value>(json) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        Ok(_) => Err(text("rust.backup_object", &[])),
        Err(e) => Err(text("rust.backup_json", &[("error", &e.to_string())])),
    }
}

/// Writes the backup at once. Rejects it when it is not a valid JSON object or too big (the old backup is not spoiled).
pub fn write_backup(path: &Path, json: &str) -> Result<(), String> {
    validate(json)?;
    write_atomic(path, json.as_bytes())
        .map_err(|e| text("rust.backup_write_failed", &[("error", &e.to_string())]))
}

/// The pending backup and the order (app state, `manage`).
#[derive(Default)]
pub struct BackupWriter {
    inner: Mutex<Inner>,
    wake: Condvar,
    /// Disk writes one at a time: the pending one is taken only after this lock is taken (taken later, written later).
    write_lock: Mutex<()>,
    /// How many times the worker woke while waiting (L7: must not wake when idle).
    wakeups: AtomicU64,
}

#[derive(Default)]
struct Inner {
    /// The newest backup waiting to be written and its generation.
    pending: Option<(String, u64)>,
    generation: u64,
    /// The last accepted (session, sequence).
    last: Option<(String, u64)>,
    /// The worker should stop (only in the test; `stop`).
    stop: bool,
}

impl BackupWriter {
    /// Validates the backup from JS and makes it pending. A call from the same session with an older/equal sequence is
    /// ignored (`Ok(false)`); a new session (the page reloaded) is always accepted.
    pub fn accept(&self, json: String, session: &str, order: u64) -> Result<bool, String> {
        validate(&json)?;
        let mut inner = self.inner.lock().expect("backup lock");
        if let Some((o, s)) = &inner.last {
            if o == session && order <= *s {
                return Ok(false);
            }
        }
        inner.last = Some((session.to_string(), order));
        inner.generation += 1;
        let n = inner.generation;
        inner.pending = Some((json, n));
        self.wake.notify_all();
        Ok(true)
    }

    /// Stops the worker (in the test; in production the worker lives for the whole process).
    pub fn stop(&self) {
        self.inner.lock().expect("backup lock").stop = true;
        self.wake.notify_all();
    }

    /// How many times the worker woke while waiting.
    pub fn wakeup_count(&self) -> u64 {
        self.wakeups.load(Ordering::Relaxed)
    }

    /// The newest backup not written to disk yet.
    pub fn pending(&self) -> Option<String> {
        self.inner
            .lock()
            .expect("backup lock")
            .pending
            .as_ref()
            .map(|b| b.0.clone())
    }

    /// Writes the pending one to disk at once (also on quit). `Ok(false)`: nothing was pending. When it cannot be written
    /// the pending one is put back (if no newer one came meanwhile): tried again on quit.
    pub fn flush(&self, path: &Path) -> Result<bool, String> {
        self.flush_generation(path)
            .map(|n| n.is_some())
            .map_err(|(m, _)| m)
    }

    fn flush_generation(&self, path: &Path) -> Result<Option<u64>, (String, u64)> {
        let _order = self.write_lock.lock().expect("write lock");
        let Some((json, n)) = self.inner.lock().expect("backup lock").pending.take() else {
            return Ok(None);
        };
        match write_atomic(path, json.as_bytes()) {
            Ok(()) => Ok(Some(n)),
            Err(e) => {
                let mut inner = self.inner.lock().expect("backup lock");
                if inner.pending.is_none() {
                    inner.pending = Some((json, n));
                }
                Err((
                    text("rust.backup_write_failed", &[("error", &e.to_string())]),
                    n,
                ))
            }
        }
    }

    /// The worker loop: when a pending one with an unseen generation arrives it waits `wait(delay)` (`thread::sleep` in
    /// production; controlled in the test) and writes the newest. A write error is reported once with `error`; it is not
    /// tried again for the same backup (a new change or the quit tries). L7: with nothing pending it sleeps with `wait`
    /// without a timeout (does not wake when idle); only `accept` or `stop` wakes it.
    pub fn worker(
        &self,
        path: &Path,
        delay: Duration,
        wait: &dyn Fn(Duration),
        error: &dyn Fn(String),
    ) {
        let mut seen = 0u64;
        loop {
            {
                let mut inner = self.inner.lock().expect("backup lock");
                while !matches!(&inner.pending, Some((_, n)) if *n > seen) {
                    if inner.stop {
                        return;
                    }
                    inner = self.wake.wait(inner).expect("backup lock");
                    self.wakeups.fetch_add(1, Ordering::Relaxed);
                }
            }
            wait(delay);
            match self.flush_generation(path) {
                Ok(Some(n)) => seen = n,
                Ok(None) => {}
                Err((m, n)) => {
                    seen = n;
                    error(m);
                }
            }
        }
    }
}

/// At start-up leftover temp files older than this are removed (L7; a fresher one may be being written now).
pub const LEFTOVER_AGE: Duration = Duration::from_secs(60);

/// Starts the worker thread (once at setup). First removes the crash leftover temp files in the app data
/// folder.
pub fn start_worker<R: Runtime>(app: &AppHandle<R>) {
    let path = match file(app) {
        Ok(y) => y,
        Err(e) => {
            eprintln!("auto backup path none: {e}");
            return;
        }
    };
    if let Some(folder) = path.parent() {
        let n = crate::recent::remove_leftover_temps(folder, LEFTOVER_AGE);
        if n > 0 {
            eprintln!("{n} leftover temp files removed");
        }
    }
    let app = app.clone();
    let start = std::thread::Builder::new()
        .name("mc-backup".into())
        .spawn(move || {
            let backups = app.state::<BackupWriter>();
            backups.worker(&path, DELAY, &std::thread::sleep, &|m| {
                eprintln!("{m}");
                if let Err(e) = app.emit(ERROR_EVENT, m) {
                    eprintln!("the {ERROR_EVENT} event could not be sent: {e}");
                }
            });
        });
    if let Err(e) = start {
        eprintln!("the automatic backup thread could not be started: {e}");
    }
}

/// On quit (`RunEvent::Exit`) writes the pending backup without waiting.
pub fn flush_on_exit<R: Runtime>(app: &AppHandle<R>) {
    let Some(backups) = app.try_state::<BackupWriter>() else {
        return;
    };
    match file(app) {
        Ok(path) => flush_on_exit_to(&backups, &path),
        Err(e) => eprintln!("no backup path on quit: {e}"),
    }
}

/// `flush_on_exit` itself, with the path given (a temp folder in the test).
pub fn flush_on_exit_to(backups: &BackupWriter, path: &Path) {
    if let Err(e) = backups.flush(path) {
        eprintln!("on quit {e}");
    }
}

/// Reads the backup; `None` when it is missing, unreadable or broken.
pub fn read(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Object(_)) => Some(text),
        _ => None,
    }
}

/// The backup from JS: validated and made pending (the worker or the quit writes it to disk). L6: a synchronous (sync)
/// command: Tauri handles it at once on the main thread that receives the IPC request; `RunEvent::Exit` is on the main
/// thread too, so every backup received before Exit is written on quit. Limit: when the request reaches the main
/// process after ⌘Q (on its way in the WebContent process) it is lost; localStorage stays the primary record.
#[tauri::command]
pub fn backup_data(
    backups: State<'_, BackupWriter>,
    json: String,
    session: String,
    order: u64,
) -> Result<(), String> {
    backups.accept(json, &session, order).map(|_| ())
}

/// The backup: the pending one not written yet when there is one (the page reloaded), otherwise the one on disk.
#[tauri::command]
pub async fn read_backup<R: Runtime>(
    app: AppHandle<R>,
    backups: State<'_, BackupWriter>,
) -> Result<Option<String>, String> {
    Ok(backups
        .pending()
        .or_else(|| file(&app).ok().and_then(|y| read(&y))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_backup_read_round_trip_and_faulty_input() {
        let d = std::env::temp_dir().join(format!("mc-data-{}", uuid::Uuid::new_v4()));
        let y = d.join("alt").join(FILE_NAME);
        assert_eq!(read(&y), None, "no backup");
        let good = r#"{"version":2,"projects":[{"id":"k1","name":"Çiğdemköy"}]}"#; // turkish-ok: Turkish test text
        write_backup(&y, good).unwrap();
        assert_eq!(read(&y).as_deref(), Some(good));
        for bad in ["", "{", "[]", "null", "42", "\"text\"", "{\"a\":1}x"] {
            assert!(write_backup(&y, bad).is_err(), "{bad:?} must be rejected");
            assert_eq!(
                read(&y).as_deref(),
                Some(good),
                "a faulty backup must not spoil the old one"
            );
        }
        let large = format!("{{\"x\":\"{}\"}}", "a".repeat(MAX_BYTES));
        assert!(write_backup(&y, &large).is_err());
        fs::write(&y, "{corrupt").unwrap();
        assert_eq!(read(&y), None, "a broken backup on disk is not restored");
        assert_eq!(
            crate::recent::tests::temp_files(&d.join("alt")),
            Vec::<String>::new(),
            "no temp file left (L2: the folder is listed)"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// An earlier `surec.json` (Turkish step names, no template keys) is read and accepted as a backup (the JS restore →  // turkish-ok: legacy file name (migration)
    /// migrate.projects → projectModel.validate path separately in i18n.test.js and migrate.test.js).
    #[test]
    fn legacy_projects_backup_is_read() {
        let y = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../app/test/fixtures/legacy/projects-v1.json");
        let json = read(&y).expect("the old projects backup must be read");
        assert!(json.contains("Hazırlık / PDF")); // turkish-ok: expected Turkish UI text (legacy record step name)
        let k = BackupWriter::default();
        assert_eq!(k.accept(json.clone(), "o", 1), Ok(true));
        assert_eq!(k.pending().as_deref(), Some(json.as_str()));
    }

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("mc-backups-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// O2: accept validates and checks the order; flushing at once as on quit writes the NEWEST backup without waiting.
    #[test]
    fn accept_checks_order_newest_written_immediately_on_exit() {
        let d = temp();
        let y = d.join(FILE_NAME);
        let k = BackupWriter::default();
        assert!(k.accept("{corrupt".into(), "o1", 1).is_err());
        assert!(k.accept("[]".into(), "o1", 1).is_err());
        assert_eq!(k.pending(), None, "a faulty backup does not become pending");
        assert_eq!(k.accept(r#"{"n":1}"#.into(), "o1", 1), Ok(true));
        assert_eq!(k.accept(r#"{"n":3}"#.into(), "o1", 3), Ok(true));
        assert_eq!(
            k.accept(r#"{"n":2}"#.into(), "o1", 2),
            Ok(false),
            "a late old one"
        );
        assert_eq!(
            k.accept(r#"{"n":3}"#.into(), "o1", 3),
            Ok(false),
            "the same sequence"
        );
        assert_eq!(k.pending().as_deref(), Some(r#"{"n":3}"#));
        assert_eq!(read(&y), None, "not written to disk yet");
        assert_eq!(k.flush(&y), Ok(true));
        assert_eq!(
            read(&y).as_deref(),
            Some(r#"{"n":3}"#),
            "written without waiting on quit"
        );
        assert_eq!(k.pending(), None);
        assert_eq!(k.flush(&y), Ok(false), "nothing pending");
        // clean-up: empty data comes and is written at once
        assert_eq!(
            k.accept(r#"{"version":2,"projects":[]}"#.into(), "o2", 1),
            Ok(true),
            "new session"
        );
        k.flush(&y).unwrap();
        assert_eq!(read(&y).as_deref(), Some(r#"{"version":2,"projects":[]}"#));
        fs::remove_dir_all(&d).unwrap();
    }

    /// A backup that cannot be written is not lost: the pending one is put back and written on quit (once the path is fixed).
    #[test]
    fn pending_kept_when_write_fails() {
        let d = temp();
        let blocked = d.join("file");
        fs::write(&blocked, "x").unwrap();
        let bad = blocked.join("alt").join(FILE_NAME); // the parent "folder" is a file
        let k = BackupWriter::default();
        k.accept(r#"{"a":1}"#.into(), "o", 1).unwrap();
        assert!(k
            .flush(&bad)
            .unwrap_err()
            .starts_with(&crate::i18n::prefix_of("rust.backup_write_failed")));
        assert_eq!(k.pending().as_deref(), Some(r#"{"a":1}"#), "put back");
        let good = d.join(FILE_NAME);
        assert_eq!(k.flush(&good), Ok(true));
        assert_eq!(read(&good).as_deref(), Some(r#"{"a":1}"#));
        fs::remove_dir_all(&d).unwrap();
    }

    /// Worker: does not write before the delay, writes the newest of consecutive changes; an error is reported once, not
    /// repeated for the same backup, tried again on a new change. L7: the delay is controlled by the test (a channel), the
    /// positive conditions are awaited with a timeout; no fixed sleep (no false FAIL on a slow machine).
    #[test]
    fn worker_writes_newest_after_delay_reports_error_once() {
        use std::sync::{mpsc, Arc};
        const LONG: Duration = Duration::from_secs(10);
        /// Starts the worker: tells the `entered` channel when it enters the delay, waits until `release` comes.
        fn start(
            k: &Arc<BackupWriter>,
            path: PathBuf,
        ) -> (
            std::thread::JoinHandle<()>,
            mpsc::Receiver<()>,
            mpsc::Sender<()>,
            mpsc::Receiver<String>,
        ) {
            let (input_tx, input) = mpsc::channel();
            let (release, release_rx) = mpsc::channel::<()>();
            let (error_tx, error) = mpsc::channel();
            let k = k.clone();
            let t = std::thread::spawn(move || {
                k.worker(
                    &path,
                    Duration::from_millis(150),
                    &|_| {
                        input_tx.send(()).ok();
                        release_rx.recv().ok();
                    },
                    &|m| {
                        error_tx.send(m).ok();
                    },
                )
            });
            (t, input, release, error)
        }
        fn wait_until(condition: impl Fn() -> bool) -> bool {
            let last = std::time::Instant::now() + LONG;
            while std::time::Instant::now() < last {
                if condition() {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            condition()
        }
        let d = temp();
        let y = d.join(FILE_NAME);
        let k = Arc::new(BackupWriter::default());
        let (t, input, release, _) = start(&k, y.clone());
        k.accept(r#"{"n":1}"#.into(), "o", 1).unwrap();
        k.accept(r#"{"n":2}"#.into(), "o", 2).unwrap();
        input
            .recv_timeout(LONG)
            .expect("the worker did not enter the delay");
        assert_eq!(read(&y), None, "not written before the delay");
        release.send(()).unwrap();
        assert!(
            wait_until(|| read(&y).as_deref() == Some(r#"{"n":2}"#)),
            "the newest was written: {:?}",
            read(&y)
        );
        k.stop();
        t.join().unwrap();
        // error path (a new backup writer; the parent "folder" is a file)
        let blocked = d.join("blocked");
        fs::write(&blocked, "x").unwrap();
        let k = Arc::new(BackupWriter::default());
        let (t, input, release, error) = start(&k, blocked.join(FILE_NAME));
        k.accept(r#"{"n":3}"#.into(), "o", 3).unwrap();
        input
            .recv_timeout(LONG)
            .expect("the worker did not enter the delay");
        release.send(()).unwrap();
        assert!(error.recv_timeout(LONG).is_ok(), "error reported");
        assert!(
            input.recv_timeout(Duration::from_millis(300)).is_err(),
            "not tried again for the same backup (no new delay)"
        );
        assert!(error.try_recv().is_err(), "one report for the same backup");
        k.accept(r#"{"n":4}"#.into(), "o", 4).unwrap();
        input
            .recv_timeout(LONG)
            .expect("tried again on a new change");
        release.send(()).unwrap();
        assert!(error.recv_timeout(LONG).is_ok(), "second notice");
        assert_eq!(
            k.pending().as_deref(),
            Some(r#"{"n":4}"#),
            "kept for the quit"
        );
        k.stop();
        t.join().unwrap();
        fs::remove_dir_all(&d).unwrap();
    }

    /// L7: the worker does not wake when idle (nothing pending); it wakes only when a new backup comes or when stopped
    /// (the old loop woke 5 times a second with `wait_timeout`).
    #[test]
    fn worker_does_not_wake_when_idle() {
        use std::sync::Arc;
        let d = temp();
        let k = Arc::new(BackupWriter::default());
        let t = {
            let (k, y) = (k.clone(), d.join(FILE_NAME));
            std::thread::spawn(move || {
                k.worker(&y, Duration::from_millis(10), &std::thread::sleep, &|_| {})
            })
        };
        std::thread::sleep(Duration::from_millis(700));
        let n = k.wakeup_count();
        k.stop();
        t.join().unwrap();
        assert!(n <= 1, "woke {n} times when idle");
        fs::remove_dir_all(&d).unwrap();
    }

    /// L6: `backup_data` is a synchronous (sync) command: Tauri handles it at once on the main thread that receives the
    /// IPC request; `RunEvent::Exit` is on the main thread too, so a backup received before quit does not miss the flush
    /// on Exit (an async command could run in a tokio task after Exit).
    #[test]
    fn backup_data_is_sync_command() {
        let source = include_str!("backup.rs");
        // searches at the start of a line (the strings of this test itself are not at the start of a line)
        let head = source
            .find("\npub fn backup_data(")
            .or_else(|| source.find("\npub async fn backup_data("))
            .expect("no backup_data");
        let once = &source[..head];
        let attribute = &once[once
            .rfind("#[tauri::command")
            .expect("no command attribute")..];
        assert!(
            source[head..].starts_with("\npub fn backup_data("),
            "backup_data must not be async"
        );
        assert!(
            !attribute.contains("async"),
            "the command attribute must not be async: {attribute}"
        );
    }

    /// (L6, behaviour): the `backup_data` IPC request goes through the real Tauri command wrapper (the `tauri::test`
    /// mock runtime). A synchronous command request is handled and answered on the receiving thread before `on_message`
    /// returns; so a backup received on the main thread before Exit is written to disk by the flush of the Exit handler
    /// (`flush_on_exit`). With an async command the handling is left to a tokio task (this test fails).
    #[test]
    fn backup_received_before_exit_is_written_on_exit() {
        use std::sync::{Arc, Mutex};
        use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse};
        use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
        let app = mock_builder()
            .manage(BackupWriter::default())
            .invoke_handler(tauri::generate_handler![backup_data])
            .build(mock_context(noop_assets()))
            .expect("fake app");
        let w = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("fake window");
        let json = r#"{"version":2,"projects":[{"id":"k1","name":"before Exit"}]}"#;
        let request = |order: u64| tauri::webview::InvokeRequest {
            cmd: "backup_data".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(
                serde_json::json!({ "json": json, "session": "o1", "order": order }),
            ),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        };
        let response: Arc<Mutex<Vec<(std::thread::ThreadId, bool)>>> = Arc::default();
        let y = response.clone();
        w.as_ref().clone().on_message(
            request(1),
            Box::new(move |_, _, r, _, _| {
                y.lock().unwrap().push((
                    std::thread::current().id(),
                    matches!(r, InvokeResponse::Ok(_)),
                ));
            }),
        );
        // on_message returned: the request must have been handled and answered on this thread
        assert_eq!(
            response.lock().unwrap().clone(),
            vec![(std::thread::current().id(), true)],
            "synchronous command: the answer on the same thread, before on_message returns"
        );
        let backups = app.state::<BackupWriter>();
        assert_eq!(
            backups.pending().as_deref(),
            Some(json),
            "pending before Exit"
        );
        // what the RunEvent::Exit handler does (only the path in a temp folder)
        let d = temp();
        let path = d.join(FILE_NAME);
        flush_on_exit_to(&backups, &path);
        assert_eq!(read(&path).as_deref(), Some(json), "written on quit");
        assert_eq!(backups.pending(), None);
        fs::remove_dir_all(&d).unwrap();
    }
}
