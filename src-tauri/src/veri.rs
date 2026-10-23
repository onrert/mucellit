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

use crate::dil::metin;
use crate::son_acilanlar::atomik_yaz;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub const DOSYA_ADI: &str = "surec.json";
/// Yedeğin üst sınırı; süreç verisi metin ve küçük (kitap + adım listesi).
pub const EN_COK: usize = 16 << 20;

fn dosya<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join(DOSYA_ADI))
        .map_err(|e| e.to_string())
}

/// Diske yazmadan önceki bekleme (sık değişiklik tek yazımda birleşir).
pub const GECIKME: Duration = Duration::from_secs(1);
/// İşçinin yazamadığını webview'e bildirdiği olay (yük: hata metni).
pub const HATA_OLAYI: &str = "yedek-yazilamadi";

/// Yedek geçerli mi: JSON nesnesi ve en çok `EN_COK` bayt.
pub fn dogrula(json: &str) -> Result<(), String> {
    if json.len() > EN_COK {
        return Err(metin(
            "rust.yedek_buyuk",
            &[("bayt", &json.len().to_string())],
        ));
    }
    match serde_json::from_str::<serde_json::Value>(json) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        Ok(_) => Err(metin("rust.yedek_nesne", &[])),
        Err(e) => Err(metin("rust.yedek_json", &[("hata", &e.to_string())])),
    }
}

/// Yedeği hemen yazar. Geçerli JSON nesnesi değilse ya da çok büyükse reddeder (eski yedek bozulmaz).
pub fn yedekle(yol: &Path, json: &str) -> Result<(), String> {
    dogrula(json)?;
    atomik_yaz(yol, json.as_bytes())
        .map_err(|e| metin("rust.yedek_yazilamadi", &[("hata", &e.to_string())]))
}

/// Bekleyen yedek ve sıra (uygulama durumu, `manage`).
#[derive(Default)]
pub struct Yedekci {
    ic: Mutex<Ic>,
    uyan: Condvar,
    /// Diske yazım tek tek: bekleyen ancak bu kilit alındıktan sonra alınır (sonra alınan sonra yazılır).
    yazma: Mutex<()>,
    /// İşçinin bekleme sırasında kaç kez uyandığı (L7: boşta uyanmamalı).
    uyanma: AtomicU64,
}

#[derive(Default)]
struct Ic {
    /// Yazılmayı bekleyen en yeni yedek ve nesli.
    bekleyen: Option<(String, u64)>,
    nesil: u64,
    /// Son kabul edilen (oturum, sıra).
    son: Option<(String, u64)>,
    /// İşçi dursun (yalnız testte; `durdur`).
    dur: bool,
}

impl Yedekci {
    /// JS'ten gelen yedeği doğrular ve bekleyen yapar. Aynı oturumdan sırası eski/eşit çağrı yok sayılır
    /// (`Ok(false)`); yeni oturum (sayfa yeniden yüklendi) her zaman kabul edilir.
    pub fn kabul(&self, json: String, oturum: &str, sira: u64) -> Result<bool, String> {
        dogrula(&json)?;
        let mut ic = self.ic.lock().expect("yedek kilidi");
        if let Some((o, s)) = &ic.son {
            if o == oturum && sira <= *s {
                return Ok(false);
            }
        }
        ic.son = Some((oturum.to_string(), sira));
        ic.nesil += 1;
        let n = ic.nesil;
        ic.bekleyen = Some((json, n));
        self.uyan.notify_all();
        Ok(true)
    }

    /// İşçiyi durdurur (testte; üretimde işçi süreç boyunca yaşar).
    pub fn durdur(&self) {
        self.ic.lock().expect("yedek kilidi").dur = true;
        self.uyan.notify_all();
    }

    /// İşçinin bekleme sırasında kaç kez uyandığı.
    pub fn uyanma_sayisi(&self) -> u64 {
        self.uyanma.load(Ordering::Relaxed)
    }

    /// Henüz diske yazılmamış en yeni yedek.
    pub fn bekleyen(&self) -> Option<String> {
        self.ic
            .lock()
            .expect("yedek kilidi")
            .bekleyen
            .as_ref()
            .map(|b| b.0.clone())
    }

    /// Bekleyeni hemen diske yazar (kapanışta da bu). `Ok(false)`: bekleyen yoktu. Yazılamazsa bekleyen
    /// (bu arada daha yenisi gelmediyse) geri konur: kapanışta yeniden denenir.
    pub fn bosalt(&self, yol: &Path) -> Result<bool, String> {
        self.bosalt_nesilli(yol)
            .map(|n| n.is_some())
            .map_err(|(m, _)| m)
    }

    fn bosalt_nesilli(&self, yol: &Path) -> Result<Option<u64>, (String, u64)> {
        let _sira = self.yazma.lock().expect("yazma kilidi");
        let Some((json, n)) = self.ic.lock().expect("yedek kilidi").bekleyen.take() else {
            return Ok(None);
        };
        match atomik_yaz(yol, json.as_bytes()) {
            Ok(()) => Ok(Some(n)),
            Err(e) => {
                let mut ic = self.ic.lock().expect("yedek kilidi");
                if ic.bekleyen.is_none() {
                    ic.bekleyen = Some((json, n));
                }
                Err((
                    metin("rust.yedek_yazilamadi", &[("hata", &e.to_string())]),
                    n,
                ))
            }
        }
    }

    /// İşçi döngüsü: neslini görmediği bir bekleyen gelince `bekle(gecikme)` (üretimde `thread::sleep`;
    /// testte denetimli) bekler, en yenisini yazar. Yazım hatası `hata` ile bir kez bildirilir; aynı yedek
    /// için yeniden denenmez (yeni değişiklik ya da kapanış dener). L7: bekleyen yokken zaman aşımsız
    /// `wait` ile uyur (boşta uyanmaz); yalnız `kabul` ya da `durdur` uyandırır.
    pub fn isci(
        &self,
        yol: &Path,
        gecikme: Duration,
        bekle: &dyn Fn(Duration),
        hata: &dyn Fn(String),
    ) {
        let mut gorulen = 0u64;
        loop {
            {
                let mut ic = self.ic.lock().expect("yedek kilidi");
                while !matches!(&ic.bekleyen, Some((_, n)) if *n > gorulen) {
                    if ic.dur {
                        return;
                    }
                    ic = self.uyan.wait(ic).expect("yedek kilidi");
                    self.uyanma.fetch_add(1, Ordering::Relaxed);
                }
            }
            bekle(gecikme);
            match self.bosalt_nesilli(yol) {
                Ok(Some(n)) => gorulen = n,
                Ok(None) => {}
                Err((m, n)) => {
                    gorulen = n;
                    hata(m);
                }
            }
        }
    }
}

/// Açılışta artık geçici dosyalar bu yaştan eskiyse silinir (L7; daha tazesi şu an yazılıyor olabilir).
pub const ARTIK_YASI: Duration = Duration::from_secs(60);

/// İşçi iş parçacığını başlatır (kurulumda bir kez). Önce uygulama veri klasöründeki çökme artığı geçici
/// dosyaları temizler.
pub fn isci_baslat<R: Runtime>(app: &AppHandle<R>) {
    let yol = match dosya(app) {
        Ok(y) => y,
        Err(e) => {
            eprintln!("otomatik yedek yolu yok: {e}");
            return;
        }
    };
    if let Some(klasor) = yol.parent() {
        let n = crate::son_acilanlar::artik_gecicileri_temizle(klasor, ARTIK_YASI);
        if n > 0 {
            eprintln!("{n} artık geçici dosya silindi");
        }
    }
    let app = app.clone();
    let baslat = std::thread::Builder::new()
        .name("kc-yedek".into())
        .spawn(move || {
            let yedekci = app.state::<Yedekci>();
            yedekci.isci(&yol, GECIKME, &std::thread::sleep, &|m| {
                eprintln!("{m}");
                if let Err(e) = app.emit(HATA_OLAYI, m) {
                    eprintln!("{HATA_OLAYI} olayı iletilemedi: {e}");
                }
            });
        });
    if let Err(e) = baslat {
        eprintln!("otomatik yedek iş parçacığı başlatılamadı: {e}");
    }
}

/// Kapanışta (`RunEvent::Exit`) bekleyen yedeği beklemeden yazar.
pub fn kapanista_bosalt<R: Runtime>(app: &AppHandle<R>) {
    let Some(yedekci) = app.try_state::<Yedekci>() else {
        return;
    };
    match dosya(app) {
        Ok(yol) => kapanista_bosalt_yola(&yedekci, &yol),
        Err(e) => eprintln!("kapanışta yedek yolu yok: {e}"),
    }
}

/// `kapanista_bosalt`'ın kendisi, yol verilerek (testte geçici klasör).
pub fn kapanista_bosalt_yola(yedekci: &Yedekci, yol: &Path) {
    if let Err(e) = yedekci.bosalt(yol) {
        eprintln!("kapanışta {e}");
    }
}

/// Yedeği okur; yoksa, okunamıyorsa ya da bozuksa `None`.
pub fn oku(yol: &Path) -> Option<String> {
    let metin = fs::read_to_string(yol).ok()?;
    match serde_json::from_str::<serde_json::Value>(&metin) {
        Ok(serde_json::Value::Object(_)) => Some(metin),
        _ => None,
    }
}

/// JS'ten gelen yedek: doğrulanır ve bekleyen olur (diske işçi ya da kapanış yazar). L6: eşzamanlı (sync)
/// komut: Tauri onu IPC isteğini alan ana iş parçacığında hemen işler; `RunEvent::Exit` de ana iş
/// parçacığında olduğundan Exit'ten önce alınmış her yedek kapanışta yazılır. Sınır: istek ⌘Q'dan sonra
/// ana sürece ulaşırsa (WebContent sürecinde yolda) kaybolur; localStorage birincil kayıt olarak kalır.
#[tauri::command]
pub fn veri_yedekle(
    yedekci: State<'_, Yedekci>,
    json: String,
    oturum: String,
    sira: u64,
) -> Result<(), String> {
    yedekci.kabul(json, &oturum, sira).map(|_| ())
}

/// Yedek: henüz yazılmamış bekleyen varsa o (sayfa yeniden yüklendiyse), yoksa diskteki.
#[tauri::command]
pub async fn veri_oku<R: Runtime>(
    app: AppHandle<R>,
    yedekci: State<'_, Yedekci>,
) -> Result<Option<String>, String> {
    Ok(yedekci
        .bekleyen()
        .or_else(|| dosya(&app).ok().and_then(|y| oku(&y))))
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn yedekle_oku_gidis_donus_ve_kusurlu_girdi() {
        let d = std::env::temp_dir().join(format!("kc-veri-{}", uuid::Uuid::new_v4()));
        let y = d.join("alt").join(DOSYA_ADI);
        assert_eq!(oku(&y), None, "yedek yok");
        let iyi = r#"{"surum":1,"kitaplar":[{"id":"k1","ad":"Çiğdemköy"}]}"#;
        yedekle(&y, iyi).unwrap();
        assert_eq!(oku(&y).as_deref(), Some(iyi));
        for kotu in ["", "{", "[]", "null", "42", "\"metin\"", "{\"a\":1}x"] {
            assert!(yedekle(&y, kotu).is_err(), "{kotu:?} reddedilmeli");
            assert_eq!(
                oku(&y).as_deref(),
                Some(iyi),
                "kusurlu yedek eskisini bozmamalı"
            );
        }
        let buyuk = format!("{{\"x\":\"{}\"}}", "a".repeat(EN_COK));
        assert!(yedekle(&y, &buyuk).is_err());
        fs::write(&y, "{bozuk").unwrap();
        assert_eq!(oku(&y), None, "diskteki bozuk yedek geri yüklenmez");
        assert_eq!(
            crate::son_acilanlar::testler::gecici_dosyalar(&d.join("alt")),
            Vec::<String>::new(),
            "geçici dosya kalmadı (L2: klasör listelenir)"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// öncesi `surec.json` (Türkçe adım adları, şablon anahtarı yok) okunur ve yedek olarak kabul
    /// edilir (JS geriYukle → surecModel.dogrula ayrıca dil.test.js'te).
    #[test]
    fn eski_m2_surec_yedegi_okunur() {
        let y = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../app/test/fixtures/eski-kayit/surec.json");
        let json = oku(&y).expect("eski surec.json okunmalı");
        assert!(json.contains("Hazırlık / PDF"));
        let k = Yedekci::default();
        assert_eq!(k.kabul(json.clone(), "o", 1), Ok(true));
        assert_eq!(k.bekleyen().as_deref(), Some(json.as_str()));
    }

    fn gecici() -> PathBuf {
        let d = std::env::temp_dir().join(format!("kc-yedekci-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// O2: kabul doğrular ve sırayı denetler; kapanıştaki gibi hemen boşaltma EN YENİ yedeği bekletmeden yazar.
    #[test]
    fn kabul_sira_denetler_kapanista_en_yeni_hemen_yazilir() {
        let d = gecici();
        let y = d.join(DOSYA_ADI);
        let k = Yedekci::default();
        assert!(k.kabul("{bozuk".into(), "o1", 1).is_err());
        assert!(k.kabul("[]".into(), "o1", 1).is_err());
        assert_eq!(k.bekleyen(), None, "kusurlu yedek bekleyen olmaz");
        assert_eq!(k.kabul(r#"{"n":1}"#.into(), "o1", 1), Ok(true));
        assert_eq!(k.kabul(r#"{"n":3}"#.into(), "o1", 3), Ok(true));
        assert_eq!(
            k.kabul(r#"{"n":2}"#.into(), "o1", 2),
            Ok(false),
            "geç gelen eski"
        );
        assert_eq!(
            k.kabul(r#"{"n":3}"#.into(), "o1", 3),
            Ok(false),
            "aynı sıra"
        );
        assert_eq!(k.bekleyen().as_deref(), Some(r#"{"n":3}"#));
        assert_eq!(oku(&y), None, "henüz diske yazılmadı");
        assert_eq!(k.bosalt(&y), Ok(true));
        assert_eq!(
            oku(&y).as_deref(),
            Some(r#"{"n":3}"#),
            "kapanışta beklemeden yazıldı"
        );
        assert_eq!(k.bekleyen(), None);
        assert_eq!(k.bosalt(&y), Ok(false), "bekleyen yok");
        // temizlik: boş veri gelir ve hemen yazılır
        assert_eq!(
            k.kabul(r#"{"surum":1,"kitaplar":[]}"#.into(), "o2", 1),
            Ok(true),
            "yeni oturum"
        );
        k.bosalt(&y).unwrap();
        assert_eq!(oku(&y).as_deref(), Some(r#"{"surum":1,"kitaplar":[]}"#));
        fs::remove_dir_all(&d).unwrap();
    }

    /// Yazılamayan yedek kaybolmaz: bekleyen geri konur, kapanışta (yol düzelince) yazılır.
    #[test]
    fn yazilamazsa_bekleyen_korunur() {
        let d = gecici();
        let engel = d.join("dosya");
        fs::write(&engel, "x").unwrap();
        let kotu = engel.join("alt").join(DOSYA_ADI); // üst "klasör" bir dosya
        let k = Yedekci::default();
        k.kabul(r#"{"a":1}"#.into(), "o", 1).unwrap();
        assert!(k
            .bosalt(&kotu)
            .unwrap_err()
            .starts_with(&crate::dil::kalip("rust.yedek_yazilamadi")));
        assert_eq!(k.bekleyen().as_deref(), Some(r#"{"a":1}"#), "geri kondu");
        let iyi = d.join(DOSYA_ADI);
        assert_eq!(k.bosalt(&iyi), Ok(true));
        assert_eq!(oku(&iyi).as_deref(), Some(r#"{"a":1}"#));
        fs::remove_dir_all(&d).unwrap();
    }

    /// İşçi: gecikmeden önce yazmaz, ardışık değişikliklerin en yenisini yazar; hata bir kez bildirilir,
    /// aynı yedek için yinelenmez, yeni değişiklikte yeniden denenir. L7: gecikme test tarafından denetlenir
    /// (kanal), olumlu koşullar zaman aşımlı beklenir; sabit uyku yok (yavaş makinede yanlış KALDI vermez).
    #[test]
    fn isci_gecikmeyle_en_yeniyi_yazar_hatayi_bir_kez_bildirir() {
        use std::sync::{mpsc, Arc};
        const UZUN: Duration = Duration::from_secs(10);
        /// İşçiyi başlatır: gecikmeye girince `girdi` kanalına haber verir, `birak` gelene dek bekler.
        fn baslat(
            k: &Arc<Yedekci>,
            yol: PathBuf,
        ) -> (
            std::thread::JoinHandle<()>,
            mpsc::Receiver<()>,
            mpsc::Sender<()>,
            mpsc::Receiver<String>,
        ) {
            let (girdi_tx, girdi) = mpsc::channel();
            let (birak, birak_rx) = mpsc::channel::<()>();
            let (hata_tx, hata) = mpsc::channel();
            let k = k.clone();
            let t = std::thread::spawn(move || {
                k.isci(
                    &yol,
                    Duration::from_millis(150),
                    &|_| {
                        girdi_tx.send(()).ok();
                        birak_rx.recv().ok();
                    },
                    &|m| {
                        hata_tx.send(m).ok();
                    },
                )
            });
            (t, girdi, birak, hata)
        }
        fn bekle_ki(kosul: impl Fn() -> bool) -> bool {
            let son = std::time::Instant::now() + UZUN;
            while std::time::Instant::now() < son {
                if kosul() {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            kosul()
        }
        let d = gecici();
        let y = d.join(DOSYA_ADI);
        let k = Arc::new(Yedekci::default());
        let (t, girdi, birak, _) = baslat(&k, y.clone());
        k.kabul(r#"{"n":1}"#.into(), "o", 1).unwrap();
        k.kabul(r#"{"n":2}"#.into(), "o", 2).unwrap();
        girdi.recv_timeout(UZUN).expect("işçi gecikmeye girmedi");
        assert_eq!(oku(&y), None, "gecikmeden önce yazılmaz");
        birak.send(()).unwrap();
        assert!(
            bekle_ki(|| oku(&y).as_deref() == Some(r#"{"n":2}"#)),
            "en yenisi yazıldı: {:?}",
            oku(&y)
        );
        k.durdur();
        t.join().unwrap();
        // hata yolu (yeni yedekçi; üst "klasör" bir dosya)
        let engel = d.join("engel");
        fs::write(&engel, "x").unwrap();
        let k = Arc::new(Yedekci::default());
        let (t, girdi, birak, hata) = baslat(&k, engel.join(DOSYA_ADI));
        k.kabul(r#"{"n":3}"#.into(), "o", 3).unwrap();
        girdi.recv_timeout(UZUN).expect("işçi gecikmeye girmedi");
        birak.send(()).unwrap();
        assert!(hata.recv_timeout(UZUN).is_ok(), "hata bildirildi");
        assert!(
            girdi.recv_timeout(Duration::from_millis(300)).is_err(),
            "aynı yedek için yeniden denenmez (yeni gecikme yok)"
        );
        assert!(hata.try_recv().is_err(), "aynı yedek için tek bildirim");
        k.kabul(r#"{"n":4}"#.into(), "o", 4).unwrap();
        girdi
            .recv_timeout(UZUN)
            .expect("yeni değişiklikte yeniden denendi");
        birak.send(()).unwrap();
        assert!(hata.recv_timeout(UZUN).is_ok(), "ikinci bildirim");
        assert_eq!(
            k.bekleyen().as_deref(),
            Some(r#"{"n":4}"#),
            "kapanış için duruyor"
        );
        k.durdur();
        t.join().unwrap();
        fs::remove_dir_all(&d).unwrap();
    }

    /// L7: işçi boşta (bekleyen yokken) uyanmaz; yalnız yeni yedek gelince ya da durdurulunca uyanır
    /// (eski döngü saniyede 5 kez `wait_timeout` ile uyanıyordu).
    #[test]
    fn isci_bostayken_uyanmaz() {
        use std::sync::Arc;
        let d = gecici();
        let k = Arc::new(Yedekci::default());
        let t = {
            let (k, y) = (k.clone(), d.join(DOSYA_ADI));
            std::thread::spawn(move || {
                k.isci(&y, Duration::from_millis(10), &std::thread::sleep, &|_| {})
            })
        };
        std::thread::sleep(Duration::from_millis(700));
        let n = k.uyanma_sayisi();
        k.durdur();
        t.join().unwrap();
        assert!(n <= 1, "boşta {n} kez uyandı");
        fs::remove_dir_all(&d).unwrap();
    }

    /// L6: `veri_yedekle` eşzamanlı (sync) komuttur: Tauri onu IPC isteğini alan ana iş parçacığında hemen
    /// işler; `RunEvent::Exit` de ana iş parçacığındadır, böylece kapanıştan önce alınmış yedek Exit'teki
    /// boşaltmayı kaçırmaz (async komut tokio görevinde Exit'ten sonra koşabilirdi).
    #[test]
    fn veri_yedekle_esanli_komut() {
        let kaynak = include_str!("veri.rs");
        // satır başında arar (bu testin kendi dizgileri satır başında değil)
        let bas = kaynak
            .find("\npub fn veri_yedekle(")
            .or_else(|| kaynak.find("\npub async fn veri_yedekle("))
            .expect("veri_yedekle yok");
        let once = &kaynak[..bas];
        let nitelik = &once[once.rfind("#[tauri::command").expect("komut niteliği yok")..];
        assert!(
            kaynak[bas..].starts_with("\npub fn veri_yedekle("),
            "veri_yedekle async olmamalı"
        );
        assert!(
            !nitelik.contains("async"),
            "komut niteliği async olmamalı: {nitelik}"
        );
    }

    /// (L6, davranışsal): `veri_yedekle` IPC isteği gerçek Tauri komut sarmalayıcısından geçer
    /// (`tauri::test` sahte çalışma zamanı). Eşzamanlı komut isteği alan iş parçacığında, `on_message` dönmeden
    /// işlenir ve yanıtlanır; dolayısıyla ana iş parçacığında Exit'ten önce alınmış yedek, Exit işleyicisinin
    /// (`kapanista_bosalt`) boşaltmasında diske yazılır. async komutta işleme tokio görevine kalır (bu test kalır).
    #[test]
    fn exitten_once_alinan_yedek_kapanista_yazilir() {
        use std::sync::{Arc, Mutex};
        use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse};
        use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
        let app = mock_builder()
            .manage(Yedekci::default())
            .invoke_handler(tauri::generate_handler![veri_yedekle])
            .build(mock_context(noop_assets()))
            .expect("sahte uygulama");
        let w = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("sahte pencere");
        let json = r#"{"surum":1,"kitaplar":[{"id":"k1","ad":"Exit öncesi"}]}"#;
        let istek = |sira: u64| tauri::webview::InvokeRequest {
            cmd: "veri_yedekle".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(
                serde_json::json!({ "json": json, "oturum": "o1", "sira": sira }),
            ),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        };
        let yanit: Arc<Mutex<Vec<(std::thread::ThreadId, bool)>>> = Arc::default();
        let y = yanit.clone();
        w.as_ref().clone().on_message(
            istek(1),
            Box::new(move |_, _, r, _, _| {
                y.lock().unwrap().push((
                    std::thread::current().id(),
                    matches!(r, InvokeResponse::Ok(_)),
                ));
            }),
        );
        // on_message döndü: istek bu iş parçacığında işlenmiş ve yanıtlanmış olmalı
        assert_eq!(
            yanit.lock().unwrap().clone(),
            vec![(std::thread::current().id(), true)],
            "eşzamanlı komut: yanıt aynı iş parçacığında, on_message dönmeden"
        );
        let yedekci = app.state::<Yedekci>();
        assert_eq!(
            yedekci.bekleyen().as_deref(),
            Some(json),
            "Exit öncesi bekleyen"
        );
        // RunEvent::Exit işleyicisinin yaptığı (yalnız yol geçici klasörde)
        let d = gecici();
        let yol = d.join(DOSYA_ADI);
        kapanista_bosalt_yola(&yedekci, &yol);
        assert_eq!(oku(&yol).as_deref(), Some(json), "kapanışta yazıldı");
        assert_eq!(yedekci.bekleyen(), None);
        fs::remove_dir_all(&d).unwrap();
    }
}
