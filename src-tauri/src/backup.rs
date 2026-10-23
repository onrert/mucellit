//! Süreç verisinin otomatik yedeği: localStorage birincil kalır; Tauri'de her `depo.yaz` /
//! `temizle` sonrası JSON `app_data_dir/surec.json`'a da yazılır (geçici dosya + rename). Açılışta
//! localStorage boşsa web tarafı bu yedeği geri yükler (app/js/platform-tauri.js).
//! Uygulama kabında yazma ek entitlement istemez ("full read and write access to its sandbox container").
//!
//! bekletme JS'ten Rust'a taşındı. JS her değişikliği **hemen** `veri_yedekle` ile gönderir;
//! `Yedekci` en yenisini bellekte tutar, işçi iş parçacığı `GECIKME` sonra diske yazar (sık yazımı birleştirir).
//! Uygulama kapanırken (`RunEvent::Exit`: ⌘Q, Dock'tan Çık, son pencere kapandı) bekleyen yedek beklemeden
//! yazılır. Böylece "Tümünü temizle → hemen ⌘Q" sonrası eski dolu yedek kalmaz. Sıra: JS oturum kimliği +
//! artan sayı; aynı oturumdan geç gelen eski çağrı yok sayılır.

use crate::i18n::text;
use crate::recent::write_atomic;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub const FILE_NAME: &str = "projects.json";
/// Yedeğin üst sınırı; süreç verisi metin ve küçük (kitap + adım listesi).
pub const MAX_ENTRIES: usize = 16 << 20;

fn file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join(FILE_NAME))
        .map_err(|e| e.to_string())
}

/// Diske yazmadan önceki bekleme (sık değişiklik tek yazımda birleşir).
pub const DELAY: Duration = Duration::from_secs(1);
/// İşçinin yazamadığını webview'e bildirdiği olay (yük: hata metni).
pub const ERROR_EVENT: &str = "backup-writeFailed";

/// Yedek geçerli mi: JSON nesnesi ve en çok `EN_COK` bayt.
pub fn validate(json: &str) -> Result<(), String> {
    if json.len() > MAX_ENTRIES {
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

/// Yedeği hemen yazar. Geçerli JSON nesnesi değilse ya da çok büyükse reddeder (eski yedek bozulmaz).
pub fn write_backup(path: &Path, json: &str) -> Result<(), String> {
    validate(json)?;
    write_atomic(path, json.as_bytes())
        .map_err(|e| text("rust.backup_write_failed", &[("error", &e.to_string())]))
}

/// Bekleyen yedek ve sıra (uygulama durumu, `manage`).
#[derive(Default)]
pub struct BackupWriter {
    inner: Mutex<Inner>,
    wake: Condvar,
    /// Diske yazım tek tek: bekleyen ancak bu kilit alındıktan sonra alınır (sonra alınan sonra yazılır).
    write_lock: Mutex<()>,
    /// İşçinin bekleme sırasında kaç kez uyandığı (L7: boşta uyanmamalı).
    wakeups: AtomicU64,
}

#[derive(Default)]
struct Inner {
    /// Yazılmayı bekleyen en yeni yedek ve nesli.
    pending: Option<(String, u64)>,
    generation: u64,
    /// Son kabul edilen (oturum, sıra).
    last: Option<(String, u64)>,
    /// İşçi dursun (yalnız testte; `durdur`).
    stop: bool,
}

impl BackupWriter {
    /// JS'ten gelen yedeği doğrular ve bekleyen yapar. Aynı oturumdan sırası eski/eşit çağrı yok sayılır
    /// (`Ok(false)`); yeni oturum (sayfa yeniden yüklendi) her zaman kabul edilir.
    pub fn accept(&self, json: String, session: &str, order: u64) -> Result<bool, String> {
        validate(&json)?;
        let mut inner = self.inner.lock().expect("yedek kilidi");
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

    /// İşçiyi durdurur (testte; üretimde işçi süreç boyunca yaşar).
    pub fn stop(&self) {
        self.inner.lock().expect("yedek kilidi").stop = true;
        self.wake.notify_all();
    }

    /// İşçinin bekleme sırasında kaç kez uyandığı.
    pub fn wakeup_count(&self) -> u64 {
        self.wakeups.load(Ordering::Relaxed)
    }

    /// Henüz diske yazılmamış en yeni yedek.
    pub fn pending(&self) -> Option<String> {
        self.inner
            .lock()
            .expect("yedek kilidi")
            .pending
            .as_ref()
            .map(|b| b.0.clone())
    }

    /// Bekleyeni hemen diske yazar (kapanışta da bu). `Ok(false)`: bekleyen yoktu. Yazılamazsa bekleyen
    /// (bu arada daha yenisi gelmediyse) geri konur: kapanışta yeniden denenir.
    pub fn flush(&self, path: &Path) -> Result<bool, String> {
        self.flush_generation(path)
            .map(|n| n.is_some())
            .map_err(|(m, _)| m)
    }

    fn flush_generation(&self, path: &Path) -> Result<Option<u64>, (String, u64)> {
        let _order = self.write_lock.lock().expect("yazma kilidi");
        let Some((json, n)) = self.inner.lock().expect("yedek kilidi").pending.take() else {
            return Ok(None);
        };
        match write_atomic(path, json.as_bytes()) {
            Ok(()) => Ok(Some(n)),
            Err(e) => {
                let mut inner = self.inner.lock().expect("yedek kilidi");
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

    /// İşçi döngüsü: neslini görmediği bir bekleyen gelince `bekle(gecikme)` (üretimde `thread::sleep`;
    /// testte denetimli) bekler, en yenisini yazar. Yazım hatası `hata` ile bir kez bildirilir; aynı yedek
    /// için yeniden denenmez (yeni değişiklik ya da kapanış dener). L7: bekleyen yokken zaman aşımsız
    /// `wait` ile uyur (boşta uyanmaz); yalnız `kabul` ya da `durdur` uyandırır.
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
                let mut inner = self.inner.lock().expect("yedek kilidi");
                while !matches!(&inner.pending, Some((_, n)) if *n > seen) {
                    if inner.stop {
                        return;
                    }
                    inner = self.wake.wait(inner).expect("yedek kilidi");
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

/// Açılışta artık geçici dosyalar bu yaştan eskiyse silinir (L7; daha tazesi şu an yazılıyor olabilir).
pub const LEFTOVER_AGE: Duration = Duration::from_secs(60);

/// İşçi iş parçacığını başlatır (kurulumda bir kez). Önce uygulama veri klasöründeki çökme artığı geçici
/// dosyaları temizler.
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
            eprintln!("{n} artık geçici dosya silindi");
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
                    eprintln!("{ERROR_EVENT} olayı iletilemedi: {e}");
                }
            });
        });
    if let Err(e) = start {
        eprintln!("auto backup iş parçacığı başlatılamadı: {e}");
    }
}

/// Kapanışta (`RunEvent::Exit`) bekleyen yedeği beklemeden yazar.
pub fn flush_on_exit<R: Runtime>(app: &AppHandle<R>) {
    let Some(backups) = app.try_state::<BackupWriter>() else {
        return;
    };
    match file(app) {
        Ok(path) => flush_on_exit_to(&backups, &path),
        Err(e) => eprintln!("kapanışta yedek yolu yok: {e}"),
    }
}

/// `kapanista_bosalt`'ın kendisi, yol verilerek (testte geçici klasör).
pub fn flush_on_exit_to(backups: &BackupWriter, path: &Path) {
    if let Err(e) = backups.flush(path) {
        eprintln!("kapanışta {e}");
    }
}

/// Yedeği okur; yoksa, okunamıyorsa ya da bozuksa `None`.
pub fn read(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Object(_)) => Some(text),
        _ => None,
    }
}

/// JS'ten gelen yedek: doğrulanır ve bekleyen olur (diske işçi ya da kapanış yazar). L6: eşzamanlı (sync)
/// komut: Tauri onu IPC isteğini alan ana iş parçacığında hemen işler; `RunEvent::Exit` de ana iş
/// parçacığında olduğundan Exit'ten önce alınmış her yedek kapanışta yazılır. Sınır: istek ⌘Q'dan sonra
/// ana sürece ulaşırsa (WebContent sürecinde yolda) kaybolur; localStorage birincil kayıt olarak kalır.
#[tauri::command]
pub fn backup_data(
    backups: State<'_, BackupWriter>,
    json: String,
    session: String,
    order: u64,
) -> Result<(), String> {
    backups.accept(json, &session, order).map(|_| ())
}

/// Yedek: henüz yazılmamış bekleyen varsa o (sayfa yeniden yüklendiyse), yoksa diskteki.
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
        assert_eq!(read(&y), None, "yedek yok");
        let good = r#"{"version":2,"projects":[{"id":"k1","name":"Çiğdemköy"}]}"#;
        write_backup(&y, good).unwrap();
        assert_eq!(read(&y).as_deref(), Some(good));
        for bad in ["", "{", "[]", "null", "42", "\"text\"", "{\"a\":1}x"] {
            assert!(write_backup(&y, bad).is_err(), "{bad:?} reddedilmeli");
            assert_eq!(
                read(&y).as_deref(),
                Some(good),
                "kusurlu yedek eskisini bozmamalı"
            );
        }
        let large = format!("{{\"x\":\"{}\"}}", "a".repeat(MAX_ENTRIES));
        assert!(write_backup(&y, &large).is_err());
        fs::write(&y, "{corrupt").unwrap();
        assert_eq!(read(&y), None, "diskteki bozuk yedek geri yüklenmez");
        assert_eq!(
            crate::recent::tests::temp_files(&d.join("alt")),
            Vec::<String>::new(),
            "geçici dosya kalmadı (L2: klasör listelenir)"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// öncesi `surec.json` (Türkçe adım adları, şablon anahtarı yok) okunur ve yedek olarak kabul
    /// edilir (JS geriYukle → surecModel.dogrula ayrıca i18n.test.js'te).
    #[test]
    fn legacy_projects_backup_is_read() {
        let y = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../app/test/fixtures/legacy/projects-v1.json");
        let json = read(&y).expect("eski surec.json okunmalı");
        assert!(json.contains("Hazırlık / PDF"));
        let k = BackupWriter::default();
        assert_eq!(k.accept(json.clone(), "o", 1), Ok(true));
        assert_eq!(k.pending().as_deref(), Some(json.as_str()));
    }

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("mc-backups-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// O2: kabul doğrular ve sırayı denetler; kapanıştaki gibi hemen boşaltma EN YENİ yedeği bekletmeden yazar.
    #[test]
    fn accept_checks_order_newest_written_immediately_on_exit() {
        let d = temp();
        let y = d.join(FILE_NAME);
        let k = BackupWriter::default();
        assert!(k.accept("{corrupt".into(), "o1", 1).is_err());
        assert!(k.accept("[]".into(), "o1", 1).is_err());
        assert_eq!(k.pending(), None, "kusurlu yedek bekleyen olmaz");
        assert_eq!(k.accept(r#"{"n":1}"#.into(), "o1", 1), Ok(true));
        assert_eq!(k.accept(r#"{"n":3}"#.into(), "o1", 3), Ok(true));
        assert_eq!(
            k.accept(r#"{"n":2}"#.into(), "o1", 2),
            Ok(false),
            "geç gelen eski"
        );
        assert_eq!(
            k.accept(r#"{"n":3}"#.into(), "o1", 3),
            Ok(false),
            "aynı sıra"
        );
        assert_eq!(k.pending().as_deref(), Some(r#"{"n":3}"#));
        assert_eq!(read(&y), None, "henüz diske yazılmadı");
        assert_eq!(k.flush(&y), Ok(true));
        assert_eq!(
            read(&y).as_deref(),
            Some(r#"{"n":3}"#),
            "kapanışta beklemeden yazıldı"
        );
        assert_eq!(k.pending(), None);
        assert_eq!(k.flush(&y), Ok(false), "bekleyen yok");
        // temizlik: boş veri gelir ve hemen yazılır
        assert_eq!(
            k.accept(r#"{"version":2,"projects":[]}"#.into(), "o2", 1),
            Ok(true),
            "yeni oturum"
        );
        k.flush(&y).unwrap();
        assert_eq!(read(&y).as_deref(), Some(r#"{"version":2,"projects":[]}"#));
        fs::remove_dir_all(&d).unwrap();
    }

    /// Yazılamayan yedek kaybolmaz: bekleyen geri konur, kapanışta (yol düzelince) yazılır.
    #[test]
    fn pending_kept_when_write_fails() {
        let d = temp();
        let blocked = d.join("file");
        fs::write(&blocked, "x").unwrap();
        let bad = blocked.join("alt").join(FILE_NAME); // üst "klasör" bir dosya
        let k = BackupWriter::default();
        k.accept(r#"{"a":1}"#.into(), "o", 1).unwrap();
        assert!(k
            .flush(&bad)
            .unwrap_err()
            .starts_with(&crate::i18n::prefix_of("rust.backup_write_failed")));
        assert_eq!(k.pending().as_deref(), Some(r#"{"a":1}"#), "geri kondu");
        let good = d.join(FILE_NAME);
        assert_eq!(k.flush(&good), Ok(true));
        assert_eq!(read(&good).as_deref(), Some(r#"{"a":1}"#));
        fs::remove_dir_all(&d).unwrap();
    }

    /// İşçi: gecikmeden önce yazmaz, ardışık değişikliklerin en yenisini yazar; hata bir kez bildirilir,
    /// aynı yedek için yinelenmez, yeni değişiklikte yeniden denenir. L7: gecikme test tarafından denetlenir
    /// (kanal), olumlu koşullar zaman aşımlı beklenir; sabit uyku yok (yavaş makinede yanlış KALDI vermez).
    #[test]
    fn worker_writes_newest_after_delay_reports_error_once() {
        use std::sync::{mpsc, Arc};
        const LONG: Duration = Duration::from_secs(10);
        /// İşçiyi başlatır: gecikmeye girince `girdi` kanalına haber verir, `birak` gelene dek bekler.
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
        input.recv_timeout(LONG).expect("işçi gecikmeye girmedi");
        assert_eq!(read(&y), None, "gecikmeden önce yazılmaz");
        release.send(()).unwrap();
        assert!(
            wait_until(|| read(&y).as_deref() == Some(r#"{"n":2}"#)),
            "en yenisi yazıldı: {:?}",
            read(&y)
        );
        k.stop();
        t.join().unwrap();
        // hata yolu (yeni yedekçi; üst "klasör" bir dosya)
        let blocked = d.join("blocked");
        fs::write(&blocked, "x").unwrap();
        let k = Arc::new(BackupWriter::default());
        let (t, input, release, error) = start(&k, blocked.join(FILE_NAME));
        k.accept(r#"{"n":3}"#.into(), "o", 3).unwrap();
        input.recv_timeout(LONG).expect("işçi gecikmeye girmedi");
        release.send(()).unwrap();
        assert!(error.recv_timeout(LONG).is_ok(), "hata bildirildi");
        assert!(
            input.recv_timeout(Duration::from_millis(300)).is_err(),
            "aynı yedek için yeniden denenmez (yeni gecikme yok)"
        );
        assert!(error.try_recv().is_err(), "aynı yedek için tek bildirim");
        k.accept(r#"{"n":4}"#.into(), "o", 4).unwrap();
        input
            .recv_timeout(LONG)
            .expect("yeni değişiklikte yeniden denendi");
        release.send(()).unwrap();
        assert!(error.recv_timeout(LONG).is_ok(), "second notice");
        assert_eq!(
            k.pending().as_deref(),
            Some(r#"{"n":4}"#),
            "kapanış için duruyor"
        );
        k.stop();
        t.join().unwrap();
        fs::remove_dir_all(&d).unwrap();
    }

    /// L7: işçi boşta (bekleyen yokken) uyanmaz; yalnız yeni yedek gelince ya da durdurulunca uyanır
    /// (eski döngü saniyede 5 kez `wait_timeout` ile uyanıyordu).
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
        assert!(n <= 1, "boşta {n} kez uyandı");
        fs::remove_dir_all(&d).unwrap();
    }

    /// L6: `veri_yedekle` eşzamanlı (sync) komuttur: Tauri onu IPC isteğini alan ana iş parçacığında hemen
    /// işler; `RunEvent::Exit` de ana iş parçacığındadır, böylece kapanıştan önce alınmış yedek Exit'teki
    /// boşaltmayı kaçırmaz (async komut tokio görevinde Exit'ten sonra koşabilirdi).
    #[test]
    fn backup_data_is_sync_command() {
        let source = include_str!("backup.rs");
        // satır başında arar (bu testin kendi dizgileri satır başında değil)
        let head = source
            .find("\npub fn backup_data(")
            .or_else(|| source.find("\npub async fn backup_data("))
            .expect("backup_data yok");
        let once = &source[..head];
        let attribute = &once[once.rfind("#[tauri::command").expect("komut niteliği yok")..];
        assert!(
            source[head..].starts_with("\npub fn backup_data("),
            "backup_data async olmamalı"
        );
        assert!(
            !attribute.contains("async"),
            "komut niteliği async olmamalı: {attribute}"
        );
    }

    /// (L6, davranışsal): `veri_yedekle` IPC isteği gerçek Tauri komut sarmalayıcısından geçer
    /// (`tauri::test` sahte çalışma zamanı). Eşzamanlı komut isteği alan iş parçacığında, `on_message` dönmeden
    /// işlenir ve yanıtlanır; dolayısıyla ana iş parçacığında Exit'ten önce alınmış yedek, Exit işleyicisinin
    /// (`kapanista_bosalt`) boşaltmasında diske yazılır. async komutta işleme tokio görevine kalır (bu test kalır).
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
        let json = r#"{"version":2,"projects":[{"id":"k1","name":"Exit öncesi"}]}"#;
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
        // on_message döndü: istek bu iş parçacığında işlenmiş ve yanıtlanmış olmalı
        assert_eq!(
            response.lock().unwrap().clone(),
            vec![(std::thread::current().id(), true)],
            "eşzamanlı komut: yanıt aynı iş parçacığında, on_message dönmeden"
        );
        let backups = app.state::<BackupWriter>();
        assert_eq!(
            backups.pending().as_deref(),
            Some(json),
            "Exit öncesi bekleyen"
        );
        // RunEvent::Exit işleyicisinin yaptığı (yalnız yol geçici klasörde)
        let d = temp();
        let path = d.join(FILE_NAME);
        flush_on_exit_to(&backups, &path);
        assert_eq!(read(&path).as_deref(), Some(json), "kapanışta yazıldı");
        assert_eq!(backups.pending(), None);
        fs::remove_dir_all(&d).unwrap();
    }
}
