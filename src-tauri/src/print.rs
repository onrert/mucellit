//! Yazdırma: seçenek A — PDFKit baskı işlemi, %100 ölçek; seçenek B — Önizleme'de Aç.
//!
//! A. `yazdir`: gövde ham PDF baytı (JS'in ürettiği dizilmiş PDF; dosya yolu yok). Ana iş parçacığında
//! `PDFDocument` → `NSPrintInfo` (kâğıt = ilk sayfanın MediaBox'ı, yön sayfaya göre, ölçek 1, ortalı, dört kenar eşit ve
//! yazıcının donanım kenarlarından büyük — bkz. [`simetrik_kenar`]) →
//! `printOperationForPrintInfo:scalingMode:autoRotate:` (`PageScaleNone`, döndürme yok) → pencereye bağlı baskı
//! sayfası (sheet). Komut kullanıcı Yazdır'a (ya da "PDF olarak kaydet"e) basınca `true`, vazgeçince `false` döner;
//! sayfa açıkken uygulama kilitlenmez (kip yalnız o pencere için). Pencere bulunamazsa uygulama kipli pencere.
//! Yazıcı sürücüsünün kendi "Sığdır" ayarı ölçeği yine bozabilir: JS baskı penceresinden önce not gösterir.
//!
//! B. `onizlemede_ac`: PDF `app_cache_dir/cikti/<ad>.pdf`'ye yazılır, `NSWorkspace` ile Önizleme'de
//! (`com.apple.Preview`) açılır. Sandbox'ta Önizleme'nin kap içi dosyayı açıp açamadığı elle sınanır; açılamazsa
//! hata JS'e gider, JS seçenek E'ye düşer (Kaydet + "Önizleme'de basın" notu).
//!
//! Apple dışı platform: iki komut da anlaşılır "henüz yok" hatası döner (sözlükten).

use crate::i18n::text;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// Baskı ayarı (platformdan bağımsız; `NSPrintInfo` buna göre kurulur). Ölçüler PostScript noktası (1/72 inç).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PrintSettings {
    /// Kâğıt genişliği ve yüksekliği = ilk sayfanın MediaBox'ı (sayfa döndürmesi uygulanmış).
    pub paper_width: f64,
    pub paper_height: f64,
    /// Yatay (genişlik > yükseklik).
    pub landscape: bool,
    /// Simetrik kenarın alt sınırı (pt). Gerçek kenar = en büyük donanım kenarı ile bunun büyüğü ([`simetrik_kenar`]);
    /// sayfa kenar dikdörtgeninden büyük olduğu için kırpılmaz, kenar yalnız ortalamayı simetrik yapar.
    pub margin_floor: f64,
    /// Ölçek çarpanı (1 = %100).
    pub scaling: f64,
    /// PDFKit'in otomatik döndürmesi (kapalı: kâğıt zaten sayfa yönünde).
    pub rotate_auto: bool,
}

/// İlk sayfanın ölçüsünden baskı ayarı. Ölçü sonlu ve pozitif değilse hata.
pub fn print_settings(width: f64, height: f64) -> Result<PrintSettings, String> {
    if !(width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0) {
        return Err(text("rust.pdf_unreadable", &[]));
    }
    Ok(PrintSettings {
        paper_width: width,
        paper_height: height,
        landscape: width > height,
        margin_floor: MARGIN_FLOOR.min(width.min(height) / 4.0),
        scaling: 1.0,
        rotate_auto: false,
    })
}

/// Simetrik kenarın öntanımlı alt sınırı: 1 inç (72 pt). Baskı penceresinde başka yazıcı seçilirse kenar o yazıcının
/// donanım kenarına göre yeniden hesaplanmaz; donanım kenarı ≤ 72 pt olan her yazıcıda ortalama yine simetrik kalır.
pub const MARGIN_FLOOR: f64 = 72.0;

/// S9 kök nedeni: AppKit sayfayı `kâğıt − etkin kenar` dikdörtgenine yerleştirir; etkin kenar =
/// max(NSPrintInfo kenarı, yazıcının donanım kenarı = `imageablePageBounds` dışı). Kenarlar 0 ve ortalı iken sayfa
/// yazdırılabilir alana ortalanır: donanım kenarları asimetrikse (yazıcısız A4 yatay: sol 18, sağ 41 pt) içerik
/// (sol − sağ) / 2 = −11,5 pt (−4,06 mm) kayar. Dört kenar eşit ve her donanım kenarından büyükse etkin kenarlar eşit
/// olur, ortalama kâğıda göre yapılır (kayma 0); sayfa kenar dikdörtgeninden büyük olduğundan içerik kırpılmaz.
///
/// `alan` = (x, y, genişlik, yükseklik) yazdırılabilir alan (pt), kâğıt `gen × yuk`. Alan geçersizse (sonlu değil,
/// boş) yalnız taban kullanılır. Dönen değer dört kenara da yazılır.
pub fn symmetric_margin(width: f64, height: f64, field: (f64, f64, f64, f64), base: f64) -> f64 {
    let (x, y, g, h) = field;
    let valid = [x, y, g, h].iter().all(|v| v.is_finite()) && g > 0.0 && h > 0.0;
    let hardware = if valid {
        [x, y, width - x - g, height - y - h]
            .into_iter()
            .fold(0.0_f64, f64::max)
    } else {
        0.0
    };
    hardware.max(if base.is_finite() { base } else { 0.0 })
}

/// Sayfa döndürmesi (derece) 90/270 ise genişlik ve yükseklik yer değiştirir.
pub fn frozen_size(width: f64, height: f64, rotation: i64) -> (f64, f64) {
    if rotation.rem_euclid(180) == 90 {
        (height, width)
    } else {
        (width, height)
    }
}

/// Gövde boyutu sınırı (düşük 5): dosya açmayla aynı (`files::EN_COK_DOSYA`, 1 GiB).
pub fn check_body_size(length: usize) -> Result<(), String> {
    if length as u64 > crate::files::MAX_FILE {
        return Err(text(
            "rust.file_large",
            &[("mb", &(length >> 20).to_string())],
        ));
    }
    Ok(())
}

/// Ham PDF gövdesi (kopyasız ödünç; boş ya da sınırdan büyükse hata).
fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(b) if !b.is_empty() => {
            check_body_size(b.len())?;
            Ok(b)
        }
        _ => Err(text("rust.raw_bytes", &[])),
    }
}

fn title(request: &Request<'_>, name: &str) -> String {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

/// Önizleme için yazılan çıktıların klasörü (uygulamanın önbelleği; sandbox'ta kabın içi).
pub const OUTPUT_FOLDER: &str = "output";
/// Bu yaştan eski önizleme çıktıları yeni çıktı yazılırken silinir (Önizleme açık tutuyor olabilir: hemen silinmez).
pub const OUTPUT_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);

/// Çökme artığı `.gecici` dosyalarının silinmesi için en az yaş (taze olan şu an yazılıyor olabilir).
pub const TEMP_LEFTOVER_AGE: Duration = Duration::from_secs(10 * 60);

/// Önizleme klasörü temizliği (düşük 6): `omur`'den eski `.pdf` çıktılar ve çökme artığı `.gecici`
/// dosyaları (`atomik_yaz` kalıbı, `GECICI_ARTIK_YASI`'ndan eski). Dönüş: (silinen pdf, silinen geçici).
pub fn clear_cache(folder: &Path, now: SystemTime) -> (usize, usize) {
    (
        clear_old_outputs(folder, OUTPUT_LIFETIME, now),
        crate::recent::remove_leftover_temps(folder, TEMP_LEFTOVER_AGE),
    )
}

/// Açılışta Önizleme önbelleğini arka planda temizler (eskiden yalnız yeni çıktı yazılırken; `.gecici` hiç).
pub fn clean_on_startup<R: Runtime>(app: &AppHandle<R>) {
    let Ok(d) = app.path().app_cache_dir() else {
        return;
    };
    let folder = d.join(OUTPUT_FOLDER);
    std::thread::spawn(move || {
        clear_cache(&folder, SystemTime::now());
    });
}

/// Baskı penceresi sonucunun en uzun bekleme süresi (düşük 4): `didRun` gelmezse komut sonsuza dek beklemez.
pub const PRINTING_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// Kanaldan sonucu `sure` boyunca bekler (engelleyici bekleme ayrı iş parçacığında). Dönüş: (sonuç, zaman aşımı mı).
/// Zaman aşımında "yanıt yok", kanal kapandıysa "kurulamadı" hatası.
pub async fn wait_result<T: Send + 'static>(
    al: std::sync::mpsc::Receiver<Result<T, String>>,
    sure: Duration,
) -> (Result<T, String>, bool) {
    use std::sync::mpsc::RecvTimeoutError;
    match tauri::async_runtime::spawn_blocking(move || al.recv_timeout(sure)).await {
        Ok(Ok(s)) => (s, false),
        Ok(Err(RecvTimeoutError::Timeout)) => (
            Err(text(
                "rust.no_printing_answer",
                &[("dk", &(sure.as_secs() / 60).to_string())],
            )),
            true,
        ),
        Ok(Err(RecvTimeoutError::Disconnected)) => {
            (Err(text("rust.printing_setup_failed", &[])), false)
        }
        Err(e) => (Err(e.to_string()), false),
    }
}

/// Klasördeki `omur`'den eski `.pdf` dosyalarını siler; silinen sayısı.
pub fn clear_old_outputs(folder: &Path, lifetime: Duration, now: SystemTime) -> usize {
    let Ok(l) = fs::read_dir(folder) else {
        return 0;
    };
    l.filter_map(Result::ok)
        .filter(|g| {
            let path = g.path();
            path.extension()
                .is_some_and(|u| u.eq_ignore_ascii_case("pdf"))
                && g.file_type().is_ok_and(|t| t.is_file())
                && g.metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|z| now.duration_since(z).ok())
                    .is_some_and(|age| age > lifetime)
        })
        .filter(|g| fs::remove_file(g.path()).is_ok())
        .count()
}

/// Önizleme çıktısını yazar: `<klasor>/<güvenli ad>.pdf` (aynı ad varsa üzerine). Yazılan yol.
pub fn write_output(folder: &Path, encoded_name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(folder)
        .map_err(|e| text("rust.writeFailed", &[("error", &e.to_string())]))?;
    clear_cache(folder, SystemTime::now());
    let path = folder.join(crate::files::safe_name(encoded_name, "pdf"));
    crate::recent::write_atomic(&path, bytes)
        .map_err(|e| text("rust.writeFailed", &[("error", &e.to_string())]))?;
    Ok(path)
}

/// Dizilmiş PDF'i yazdırır (baskı penceresi). Gövde ham PDF baytı, `x-ad` başlığı iş adı (encodeURIComponent).
/// `true`: kullanıcı yazdırdı (ya da PDF olarak kaydetti); `false`: vazgeçti.
#[tauri::command]
pub async fn print<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    request: Request<'_>,
) -> Result<bool, String> {
    // Tek kopya: bayt ana iş parçacığına taşınır; PDFKit'e kopyasız verilir (NSData::from_vec).
    let bytes = raw_body(&request)?.to_vec();
    let name = crate::files::safe_name(&title(&request, "x-name"), "pdf");
    #[cfg(target_os = "macos")]
    {
        mac::print(&app, &window, bytes, name).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, window, bytes, name);
        Err(text("rust.no_printing", &[]))
    }
}

/// Dizilmiş PDF'i önbelleğe yazar ve Önizleme'de açar. Gövde ham PDF baytı, `x-ad` önerilen ad. Açılan dosyanın adı.
#[tauri::command]
pub async fn open_in_preview<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let folder = app
            .path()
            .app_cache_dir()
            .map_err(|e| text("rust.writeFailed", &[("error", &e.to_string())]))?
            .join(OUTPUT_FOLDER);
        // Gövde kopyalanmadan yazılır (düşük 5).
        let path = write_output(&folder, &title(&request, "x-name"), raw_body(&request)?)?;
        mac::open_in_preview(&path).await?;
        Ok(path
            .file_name()
            .map(|a| a.to_string_lossy().into_owned())
            .unwrap_or_default())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, raw_body(&request)?);
        Err(text("rust.no_printing", &[]))
    }
}

#[cfg(target_os = "macos")]
pub mod mac {
    //! macOS: PDFKit / AppKit çağrıları. `NSPrintInfo` ve `PDFDocument` her iş parçacığında kurulabilir (birim
    //! testleri baskı penceresi açmadan sınar); baskı işlemi ve sayfa ana iş parçacığında.
    use super::{frozen_size, print_settings, wait_result, PrintSettings, PRINTING_TIMEOUT};
    use crate::i18n::text;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool, NSObject, NSObjectProtocol};
    use objc2::{
        define_class, msg_send, sel, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly,
    };
    use objc2_app_kit::{
        NSPaperOrientation, NSPrintInfo, NSPrintOperation, NSPrintingPaginationMode, NSWindow,
        NSWorkspace, NSWorkspaceOpenConfiguration,
    };
    use objc2_foundation::{NSArray, NSData, NSError, NSSize, NSString, NSURL};
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument, PDFPrintScalingMode};
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::path::Path;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::{AppHandle, Runtime, WebviewWindow};

    /// Ölçek modu: sayfaya hiçbir ölçek uygulanmaz ("Do not apply scaling to the page when printing").
    pub const SCALE_MODE: PDFPrintScalingMode = PDFPrintScalingMode::PageScaleNone;
    /// Önizleme'nin paket kimliği.
    pub const PREVIEW: &str = "com.apple.Preview";

    /// Ham bayttan PDF belgesi ve ilk sayfanın (döndürmesi uygulanmış) MediaBox ölçüsü (pt).
    pub fn pdf_ac(bytes: Vec<u8>) -> Result<(Retained<PDFDocument>, f64, f64), String> {
        let data = NSData::from_vec(bytes); // kopyasız (düşük 5)
        let document = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &data) }
            .ok_or_else(|| text("rust.pdf_unreadable", &[]))?;
        if unsafe { document.pageCount() } == 0 {
            return Err(text("rust.pdf_unreadable", &[]));
        }
        let page =
            unsafe { document.pageAtIndex(0) }.ok_or_else(|| text("rust.pdf_unreadable", &[]))?;
        let rect = unsafe { page.boundsForBox(PDFDisplayBox::MediaBox) };
        let (g, y) = frozen_size(
            rect.size.width,
            rect.size.height,
            unsafe { page.rotation() } as i64,
        );
        Ok((document, g, y))
    }

    /// `NSPrintInfo` kurulumu: kâğıt = sayfa, yön, ölçek 1, ortalı, sayfalama kırpar (ölçeklemez); dört kenar eşit ve
    /// donanım kenarlarından büyük ([`simetrik_kenar`]: kenar 0 iken asimetrik donanım kenarı içeriği kaydırıyordu, S9).
    /// Önce yön, sonra kâğıt boyu (AppKit yön değişince kâğıdı çevirebilir; sonuç testte okunur); kenar, kâğıt
    /// kurulduktan sonra o kâğıdın yazdırılabilir alanından.
    pub fn setup_print_info(a: &PrintSettings) -> Retained<NSPrintInfo> {
        let info = NSPrintInfo::new();
        info.setOrientation(if a.landscape {
            NSPaperOrientation::Landscape
        } else {
            NSPaperOrientation::Portrait
        });
        info.setPaperSize(NSSize::new(a.paper_width, a.paper_height));
        let k = info.paperSize();
        let ib = info.imageablePageBounds();
        let margin = super::symmetric_margin(
            k.width,
            k.height,
            (ib.origin.x, ib.origin.y, ib.size.width, ib.size.height),
            a.margin_floor,
        );
        info.setTopMargin(margin);
        info.setBottomMargin(margin);
        info.setLeftMargin(margin);
        info.setRightMargin(margin);
        info.setScalingFactor(a.scaling);
        info.setHorizontallyCentered(true);
        info.setVerticallyCentered(true);
        info.setHorizontalPagination(NSPrintingPaginationMode::Clip);
        info.setVerticalPagination(NSPrintingPaginationMode::Clip);
        info
    }

    /// Belge + ayar → PDFKit baskı işlemi (ana iş parçacığı). `None`: PDFKit işlem kuramadı.
    pub fn print_operation(
        document: &PDFDocument,
        info: &NSPrintInfo,
        a: &PrintSettings,
        mtm: MainThreadMarker,
    ) -> Option<Retained<NSPrintOperation>> {
        unsafe {
            document.printOperationForPrintInfo_scalingMode_autoRotate(
                Some(info),
                SCALE_MODE,
                a.rotate_auto,
                mtm,
            )
        }
    }

    type PrintOutcome = Result<bool, String>;

    /// Baskı sayfası bitince (`printOperationDidRun:success:contextInfo:`) sonucu gönderir. Belge ve işlem,
    /// sayfa açıkken düşmesin diye burada tutulur.
    pub struct Ivarlar {
        send: RefCell<Option<mpsc::Sender<PrintOutcome>>>,
        _document: RefCell<Option<Retained<PDFDocument>>>,
        _operation: RefCell<Option<Retained<NSPrintOperation>>>,
    }

    define_class!(
        // SAFETY: NSObject'in alt sınıf koşulu yok; Drop uygulanmıyor.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "MucellitPrintDelegate"]
        #[ivars = Ivarlar]
        pub struct PrintDelegate;

        impl PrintDelegate {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn print_finished(
                &self,
                _operation: Option<&NSPrintOperation>,
                success: Bool,
                _context: *mut c_void,
            ) {
                if let Some(g) = self.ivars().send.borrow_mut().take() {
                    let _ = g.send(Ok(success.as_bool()));
                }
            }
        }

        unsafe impl NSObjectProtocol for PrintDelegate {}
    );

    impl PrintDelegate {
        /// Sonucu `gonder`e iletecek temsilci (belge ve işlem sayfa kapanana dek tutulur).
        pub fn new_entry(
            mtm: MainThreadMarker,
            send: mpsc::Sender<PrintOutcome>,
            document: Option<Retained<PDFDocument>>,
            operation: Option<Retained<NSPrintOperation>>,
        ) -> Retained<Self> {
            let t = Self::alloc(mtm).set_ivars(Ivarlar {
                send: RefCell::new(Some(send)),
                _document: RefCell::new(document),
                _operation: RefCell::new(operation),
            });
            unsafe { msg_send![super(t), init] }
        }

        /// Baskı sayfası açık mı (sonuç henüz gönderilmedi)?
        pub fn pending(&self) -> bool {
            self.ivars().send.borrow().is_some()
        }
    }

    thread_local! {
        /// Açık (ya da son) baskı sayfasının temsilcisi: AppKit temsilciyi tutmaz; sonuç gelince bırakılır.
        static ENABLED: RefCell<Option<Retained<PrintDelegate>>> = const { RefCell::new(None) };
        /// Zaman aşımına uğramış temsilciler (düşük 4): sayfa hâlâ açık olabilir ve AppKit temsilciyi tutmadığından
        /// bırakılmaz (geç gelen didRun sarkan işaretçiye gitmesin); süreç boyunca yaşar (yalnız olağan dışı durumda).
        static ORPHANS: RefCell<Vec<Retained<PrintDelegate>>> = const { RefCell::new(Vec::new()) };
    }

    pub(crate) fn page_open() -> bool {
        ENABLED.with(|e| e.borrow().as_ref().is_some_and(|t| t.pending()))
    }

    /// Test için: açık sayfa temsilcisini ayarlar (gerçekte `baslat` ayarlar).
    #[cfg(test)]
    pub(crate) fn set_active(t: Retained<PrintDelegate>) {
        ENABLED.with(|e| *e.borrow_mut() = Some(t));
    }

    #[cfg(test)]
    pub(crate) fn orphan_count() -> usize {
        ORPHANS.with(|y| y.borrow().len())
    }

    /// Zaman aşımı (ana iş parçacığı): temsilcinin sonuç kanalı kapatılır (sayfa "açık" sayılmaz, yeni ⌘P açılabilir;
    /// geç gelen sonuç yok sayılır), temsilci yetim listesine taşınır (bırakılmaz).
    pub(crate) fn release_timeout() {
        ENABLED.with(|e| {
            if let Some(t) = e.borrow_mut().take() {
                t.ivars().send.borrow_mut().take();
                ORPHANS.with(|y| y.borrow_mut().push(t));
            }
        });
    }

    /// Ana iş parçacığında: belgeyi aç, ayarı kur, baskı sayfasını pencereye bağla (pencere yoksa kipli).
    fn start(
        mtm: MainThreadMarker,
        window: Option<Retained<NSWindow>>,
        bytes: Vec<u8>,
        name: String,
        send: mpsc::Sender<PrintOutcome>,
    ) {
        if page_open() {
            let _ = send.send(Err(text("rust.printing_open", &[])));
            return;
        }
        let setup =
            move || -> Result<(Retained<PDFDocument>, Retained<NSPrintOperation>), String> {
                let (document, g, y) = pdf_ac(bytes)?;
                let a = print_settings(g, y)?;
                let info = setup_print_info(&a);
                let operation = print_operation(&document, &info, &a, mtm)
                    .ok_or_else(|| text("rust.printing_setup_failed", &[]))?;
                operation.setJobTitle(Some(&NSString::from_str(&name)));
                operation.setShowsPrintPanel(true);
                operation.setShowsProgressPanel(true);
                Ok((document, operation))
            };
        let (document, operation) = match setup() {
            Ok(k) => k,
            Err(e) => {
                let _ = send.send(Err(e));
                return;
            }
        };
        match window {
            Some(p) => {
                let t =
                    PrintDelegate::new_entry(mtm, send, Some(document), Some(operation.clone()));
                ENABLED.with(|e| *e.borrow_mut() = Some(t.clone()));
                let delegate: &AnyObject = &t;
                unsafe {
                    operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                        &p,
                        Some(delegate),
                        Some(sel!(printOperationDidRun:success:contextInfo:)),
                        std::ptr::null_mut(),
                    );
                }
            }
            None => {
                // Pencere yok (beklenmez): uygulama kipli baskı penceresi; dönünce sonuç hazır.
                let _ = send.send(Ok(operation.runOperation()));
                drop(document);
            }
        }
    }

    /// Sonuç gelince temsilciyi (belge + işlem) bırakır; sonraki baskı için yer açılır.
    fn release() {
        ENABLED.with(|e| {
            let done = e.borrow().as_ref().is_some_and(|t| !t.pending());
            if done {
                e.borrow_mut().take();
            }
        });
    }

    pub async fn print<R: Runtime>(
        app: &AppHandle<R>,
        window: &WebviewWindow<R>,
        bytes: Vec<u8>,
        name: String,
    ) -> Result<bool, String> {
        let (send, al) = mpsc::channel::<PrintOutcome>();
        let error = send.clone();
        let window = window.clone();
        app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                let _ = error.send(Err(text("rust.printing_setup_failed", &[])));
                return;
            };
            // Düşük 3: NSWindow işaretçisi ana iş parçacığında alınır ve hemen tutulur (retain);
            // eskiden çağıran iş parçacığında alınıp sayı olarak taşınıyordu (arada pencere kapanırsa sarkan işaretçi).
            let p = window
                .ns_window()
                .ok()
                .and_then(|p| unsafe { Retained::retain(p.cast::<NSWindow>()) });
            start(mtm, p, bytes, name, send);
        })
        .map_err(|e| e.to_string())?;
        // Düşük 4: süreli bekleme; zaman aşımında açık sayfa kaydı temizlenir (ETKIN takılı kalmaz).
        let (result, timeout) = wait_result(al, PRINTING_TIMEOUT).await;
        let _ = if timeout {
            app.run_on_main_thread(release_timeout)
        } else {
            app.run_on_main_thread(release)
        };
        result
    }

    /// Önizleme'de açmayı başlatır (eşzamanlı; AppKit nesneleri burada kalır); sonuç kanaldan gelir.
    fn start_preview(path: &Path) -> Result<mpsc::Receiver<Result<(), String>>, String> {
        let work = NSWorkspace::sharedWorkspace();
        let app_menu = work
            .URLForApplicationWithBundleIdentifier(&NSString::from_str(PREVIEW))
            .ok_or_else(|| text("rust.no_preview", &[]))?;
        let url = NSURL::from_file_path(path).ok_or_else(|| {
            text(
                "rust.writeFailed",
                &[("error", &path.display().to_string())],
            )
        })?;
        let settings = NSWorkspaceOpenConfiguration::configuration();
        settings.setActivates(true);
        let (send, al) = mpsc::channel::<Result<(), String>>();
        let block = block2::RcBlock::new(
            move |_uyg: *mut objc2_app_kit::NSRunningApplication, error: *mut NSError| {
                let s = match unsafe { error.as_ref() } {
                    Some(h) => Err(h.localizedDescription().to_string()),
                    None => Ok(()),
                };
                let _ = send.send(s);
            },
        );
        work.openURLs_withApplicationAtURL_configuration_completionHandler(
            &NSArray::from_retained_slice(&[url]),
            &app_menu,
            &settings,
            Some(&block),
        );
        Ok(al)
    }

    /// Dosyayı Önizleme'de açar; Önizleme yoksa ya da açamazsa hata (NSError metni). 30 sn içinde yanıt yoksa hata.
    pub async fn open_in_preview(path: &Path) -> Result<(), String> {
        let al = start_preview(path)?;
        tauri::async_runtime::spawn_blocking(move || al.recv_timeout(Duration::from_secs(30)))
            .await
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|_| Err(text("rust.no_preview_answer", &[])))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test PDF'i: verilen MediaBox ve /Rotate ile tek sayfa (doğru xref).
    pub(crate) fn single_page_pdf(width: f64, height: f64, rotate: i64) -> Vec<u8> {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Rotate {rotate} /Contents 4 0 R >>"),
            "<< /Length 0 >>\nstream\n\nendstream".to_string(),
        ];
        let mut s = String::from("%PDF-1.4\n");
        let mut ofs = Vec::new();
        for (i, n) in objects.iter().enumerate() {
            ofs.push(s.len());
            s.push_str(&format!("{} 0 obj\n{n}\nendobj\n", i + 1));
        }
        let xref = s.len();
        s.push_str(&format!(
            "xref\n0 {}\n0000000000 65535 f \n",
            objects.len() + 1
        ));
        for o in ofs {
            s.push_str(&format!("{o:010} 00000 n \n"));
        }
        s.push_str(&format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        ));
        s.into_bytes()
    }

    const A4_LANDSCAPE: (f64, f64) = (841.889_763_779_527_6, 595.275_590_551_181_1); // 297 × 210 mm

    #[test]
    fn print_settings_paper_is_page_margin_floor_scale_one_no_rotation() {
        let a = print_settings(A4_LANDSCAPE.0, A4_LANDSCAPE.1).unwrap();
        assert_eq!(
            a,
            PrintSettings {
                paper_width: A4_LANDSCAPE.0,
                paper_height: A4_LANDSCAPE.1,
                landscape: true,
                margin_floor: MARGIN_FLOOR,
                scaling: 1.0,
                rotate_auto: false
            }
        );
        assert!(
            !print_settings(419.53, 595.28).unwrap().landscape,
            "A5 dikey"
        );
        // küçük kâğıtta taban kısa kenarın dörtte biri (kenar dikdörtgeni boş kalmasın)
        assert_eq!(print_settings(200.0, 100.0).unwrap().margin_floor, 25.0);
        for (g, y) in [
            (0.0, 10.0),
            (10.0, -1.0),
            (f64::NAN, 10.0),
            (10.0, f64::INFINITY),
        ] {
            assert!(print_settings(g, y).is_err(), "{g} × {y}");
        }
        assert_eq!(frozen_size(100.0, 200.0, 90), (200.0, 100.0));
        assert_eq!(frozen_size(100.0, 200.0, -90), (200.0, 100.0));
        assert_eq!(frozen_size(100.0, 200.0, 180), (100.0, 200.0));
        assert_eq!(frozen_size(100.0, 200.0, 270), (200.0, 100.0));
    }

    #[test]
    fn old_outputs_removed_new_ones_and_non_pdfs_stay() {
        let d = std::env::temp_dir().join(format!("mc-output-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        for a in ["eski.pdf", "yeni.pdf", "not.txt"] {
            fs::write(d.join(a), b"x").unwrap();
        }
        fs::create_dir(d.join("klasor.pdf")).unwrap();
        // "şimdi" 2 gün sonrası: üç dosya da eski; yalnız .pdf dosyası silinir (klasör ve .txt kalır)
        let after = SystemTime::now() + Duration::from_secs(2 * 24 * 3600);
        assert_eq!(clear_old_outputs(&d, OUTPUT_LIFETIME, after), 2);
        assert!(d.join("not.txt").exists() && d.join("klasor.pdf").is_dir());
        // yeni yazılan kalır; aynı ad üzerine yazılır; ad güvenli (yol ayracı yok)
        let y = write_output(&d, "..%2Fkotu%2Fad-onler", b"%PDF-1").unwrap();
        assert_eq!(y.parent().unwrap(), d);
        assert_eq!(
            y.file_name().unwrap().to_string_lossy(),
            "-kotu-ad-onler.pdf"
        );
        write_output(&d, "..%2Fkotu%2Fad-onler", b"%PDF-2").unwrap();
        assert_eq!(fs::read(&y).unwrap(), b"%PDF-2");
        assert_eq!(clear_old_outputs(&d, OUTPUT_LIFETIME, SystemTime::now()), 0);
        assert_eq!(
            clear_old_outputs(&d.join("none"), OUTPUT_LIFETIME, after),
            0
        );
        let _ = fs::remove_dir_all(&d);
    }

    /// S9 kök nedeni: AppKit sayfayı yazdırılabilir alana ortalar; kenar = en büyük donanım kenarı (ya da taban), dört
    /// kenara aynı. Asimetrik donanım kenarında (yazıcısız A4 yatay: sol 18, sağ 41) eski kenar 0 −11,5 pt kaydırıyordu.
    #[test]
    fn symmetric_margin_is_largest_hardware_margin_or_floor() {
        let (g, y) = (842.0, 595.0);
        // yazıcısız A4 yatay (gözlem): x 18, y 18, 783 × 559 → sol 18, alt 18, sağ 41, üst 18
        assert_eq!(
            symmetric_margin(g, y, (18.0, 18.0, 783.0, 559.0), 0.0),
            41.0
        );
        assert_eq!(
            symmetric_margin(g, y, (18.0, 18.0, 783.0, 559.0), 72.0),
            72.0
        );
        // donanım kenarı tabandan büyükse donanım (üst 100)
        assert_eq!(
            symmetric_margin(g, y, (10.0, 10.0, 822.0, 485.0), 72.0),
            100.0
        );
        // kenarsız kâğıt (320 × 220 gözlemi): taban
        assert_eq!(
            symmetric_margin(907.09, 623.62, (0.0, 0.0, 907.09, 623.62), 72.0),
            72.0
        );
        // kusurlu alan: NaN, sonsuz, boş, negatif boy → yalnız taban; taban NaN → 0 (donanım yine sayılır)
        for field in [
            (f64::NAN, 18.0, 783.0, 559.0),
            (18.0, 18.0, f64::INFINITY, 559.0),
            (18.0, 18.0, 0.0, 559.0),
            (18.0, 18.0, 783.0, -1.0),
        ] {
            assert_eq!(symmetric_margin(g, y, field, 72.0), 72.0, "{field:?}");
        }
        assert_eq!(
            symmetric_margin(g, y, (18.0, 18.0, 783.0, 559.0), f64::NAN),
            41.0
        );
        // eski davranış (kenar 0) bu testi geçemez: asimetrik alanda 0 dönmez
        assert_ne!(symmetric_margin(g, y, (18.0, 18.0, 783.0, 559.0), 0.0), 0.0);
    }

    /// O2: uzun Türkçe adla Önizleme çıktısı yazılır (geçici ad dahil hiçbir ad 255 baytı aşmaz; eskiden
    /// `.<ad>.<uuid>.gecici` +45 bayt ENAMETOOLONG → Önizleme her zaman seçenek E'ye düşüyordu).
    #[test]
    fn preview_written_with_long_turkish_name_temp_name_within_255_bytes() {
        let d = std::env::temp_dir().join(format!("mc-output-long-{}", uuid::Uuid::new_v4()));
        // "Uzun Türkçe kitap adı " ×20 = 440 karakter / 500 bayt; JS encodeURIComponent biçiminde (her bayt %XX).
        // Gözlem: APFS sınırı karakter sayar (yalnız çok baytlı karakterli ad 255 baytta ~150 karakter kalıp geçerdi);
        // bu ad güvenli_ad'dan sonra 255 bayt ≈ 240 karakter, geçici ad +45 → sınır aşılıyordu.
        let name: String = "Uzun Türkçe kitap adı ".repeat(20) + "-dizilmis.pdf";
        let encoded: String = name.bytes().map(|b| format!("%{b:02X}")).collect();
        for (n, b) in [(1, &b"%PDF-1"[..]), (2, &b"%PDF-2"[..])] {
            let y = write_output(&d, &encoded, b).unwrap_or_else(|e| panic!("{n}. yazım: {e}"));
            let a = y.file_name().unwrap().to_string_lossy().into_owned();
            assert!(a.len() <= crate::files::NAME_MAX_BYTES, "{} bytes", a.len());
            assert!(a.ends_with(".pdf") && a.starts_with("Uzun Türkçe"), "{a}");
            assert_eq!(fs::read(&y).unwrap(), b);
        }
        let rest: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .map(|g| g.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(rest.len(), 1, "geçici dosya kaldı: {rest:?}");
        let _ = fs::remove_dir_all(&d);
    }

    /// NSPrintInfo kurulumu (baskı penceresi açmadan): kâğıt = ilk sayfanın MediaBox'ı, kenar simetrik, yön, ölçek 1;
    /// ölçek modu PageScaleNone, otomatik döndürme kapalı.
    #[cfg(target_os = "macos")]
    #[test]
    fn nsprintinfo_setup_paper_margins_orientation_scale() {
        use objc2_app_kit::{NSPaperOrientation, NSPrintingPaginationMode};
        use objc2_pdf_kit::PDFPrintScalingMode;
        // Kabul toleransı ±0,5 mm. Gözlem (macOS 26.6.2): AppKit standart kâğıda yakın ölçüyü yazıcının kâğıdına oturtur
        // (A4 841,89 × 595,28 → 842 × 595; A5 419,53 × 595,28 → 420 × 595; fark ≤ 0,17 mm), standart dışını aynen tutar.
        let near = |a: f64, b: f64| (a - b).abs() <= 0.5 * 72.0 / 25.4;
        for (g, y, rotate, expected_g, expected_y, landscape) in [
            (
                A4_LANDSCAPE.0,
                A4_LANDSCAPE.1,
                0,
                A4_LANDSCAPE.0,
                A4_LANDSCAPE.1,
                true,
            ),
            (419.527_559, 595.275_591, 0, 419.527_559, 595.275_591, false), // A5 dikey
            (
                595.275_591,
                419.527_559,
                90,
                419.527_559,
                595.275_591,
                false,
            ), // döndürülmüş sayfa
            (907.09, 623.62, 0, 907.09, 623.62, true), // 320 × 220 mm, standart dışı
        ] {
            let (_document, pg, py) = mac::pdf_ac(single_page_pdf(g, y, rotate)).unwrap();
            assert!(near(pg, expected_g) && near(py, expected_y), "{pg} × {py}");
            let a = print_settings(pg, py).unwrap();
            let info = mac::setup_print_info(&a);
            let k = info.paperSize();
            eprintln!("gözlem: requested {pg:.2} × {py:.2} pt → NSPrintInfo {} × {} pt, yön {:?}, ölçek {}", k.width, k.height, info.orientation(), info.scalingFactor());
            assert!(
                near(k.width, expected_g) && near(k.height, expected_y),
                "kâğıt {} × {} (expected {expected_g} × {expected_y})",
                k.width,
                k.height
            );
            assert_eq!(
                info.orientation(),
                if landscape {
                    NSPaperOrientation::Landscape
                } else {
                    NSPaperOrientation::Portrait
                }
            );
            // dört kenar eşit, ≥ taban ve ≥ her donanım kenarı (S9: ortalama kâğıda göre, kayma yok)
            let margins = [
                info.topMargin(),
                info.bottomMargin(),
                info.leftMargin(),
                info.rightMargin(),
            ];
            let ib = info.imageablePageBounds();
            let hardware = [
                ib.origin.x,
                ib.origin.y,
                k.width - ib.origin.x - ib.size.width,
                k.height - ib.origin.y - ib.size.height,
            ];
            eprintln!("gözlem: yazdırılabilir field {ib:?}, donanım kenarı {hardware:?}, margin {margins:?}");
            assert!(margins.iter().all(|&m| m == margins[0]), "{margins:?}");
            assert!(margins[0] >= a.margin_floor);
            assert!(
                hardware.iter().all(|&d| margins[0] >= d),
                "{hardware:?} / {margins:?}"
            );
            assert_eq!(info.scalingFactor(), 1.0);
            assert_eq!(info.horizontalPagination(), NSPrintingPaginationMode::Clip);
            assert_eq!(info.verticalPagination(), NSPrintingPaginationMode::Clip);
            assert!(info.isHorizontallyCentered() && info.isVerticallyCentered());
        }
        assert_eq!(mac::SCALE_MODE, PDFPrintScalingMode::PageScaleNone);
        assert_eq!(mac::SCALE_MODE.0, 0, "kPDFPrintPageScaleNone");
        // bozuk / boş / sayfasız girdi
        for b in [&b""[..], b"bu bir pdf degil", b"%PDF-1.4\n%%EOF\n"] {
            assert!(mac::pdf_ac(b.to_vec()).is_err());
        }
    }

    /// Baskı sayfası temsilcisi: AppKit'in çağıracağı seçici (`printOperationDidRun:success:contextInfo:`) sınıfta
    /// var; çağrılınca sonuç (yazdırıldı/vazgeçildi) bir kez gönderilir, sonra temsilci "bitti" sayılır.
    #[cfg(target_os = "macos")]
    #[test]
    fn print_delegate_sends_selector_result_once() {
        use objc2::runtime::{AnyObject, Bool};
        use objc2::{msg_send, sel, MainThreadMarker};
        // SAFETY: yalnız kendi NSObject alt sınıfımız kurulur ve çağrılır (AppKit nesnesi yok); ana iş parçacığı
        // koşulu AppKit nesneleri içindir. Gerçek kullanımda temsilci ana iş parçacığında kurulur.
        let mtm = unsafe { MainThreadMarker::new_unchecked() };
        for (success, expected) in [(Bool::YES, true), (Bool::NO, false)] {
            let (send, al) = std::sync::mpsc::channel();
            let t = mac::PrintDelegate::new_entry(mtm, send, None, None);
            let object: &AnyObject = &t;
            let responses: bool = unsafe {
                msg_send![object, respondsToSelector: sel!(printOperationDidRun:success:contextInfo:)]
            };
            assert!(responses);
            assert!(t.pending());
            let blank: *mut std::ffi::c_void = std::ptr::null_mut();
            let operation: Option<&objc2_app_kit::NSPrintOperation> = None;
            let _: () = unsafe {
                msg_send![object, printOperationDidRun: operation, success: success, contextInfo: blank]
            };
            assert_eq!(al.try_recv().unwrap(), Ok(expected));
            assert!(!t.pending());
            // ikinci çağrı yeni sonuç göndermez
            let _: () = unsafe {
                msg_send![object, printOperationDidRun: operation, success: Bool::YES, contextInfo: blank]
            };
            assert!(al.try_recv().is_err());
        }
    }

    /// `mac::yazdir` gövdesi (kaynak denetimi: ana iş parçacığı gerektiren yol testte çalıştırılamaz).
    fn mac_print_body() -> &'static str {
        let k = include_str!("print.rs");
        let head = k.find("    pub async fn print<R: Runtime>(").unwrap();
        &k[head..head + k[head..].find("\n    }\n").unwrap()]
    }

    /// Düşük 3: NSWindow işaretçisi ana iş parçacığında alınır (eskiden çağıran iş parçacığında alınıp
    /// usize olarak taşınıyordu; arada pencere kapanırsa sarkan işaretçi).
    #[test]
    fn window_pointer_taken_on_main_thread() {
        let g = mac_print_body();
        let main = g
            .find("run_on_main_thread(move ||")
            .expect("run_on_main_thread yok");
        let ns = g.find("ns_window()").expect("ns_window yok");
        assert!(
            ns > main,
            "ns_window() ana iş parçacığı kapanışından önce çağrılıyor"
        );
        assert!(!g.contains("as usize"), "işaretçi usize olarak taşınıyor");
    }

    /// Düşük 4: `didRun` gelmezse sonsuz beklenmez (zaman aşımı) ve açık sayfa kaydı (ETKIN) temizlenir.
    #[test]
    fn print_result_awaited_with_timeout_in_source() {
        let g = mac_print_body();
        assert!(!g.contains("al.recv()"), "sonuç süresiz bekleniyor");
        assert!(
            g.contains("wait_result(") && g.contains("release_timeout"),
            "{g}"
        );
    }

    /// Düşük 5: gövde boyutu sınırlı (dosya açmayla aynı sınır); Önizleme gövdeyi kopyalamaz; PDFKit'e bayt
    /// kopyalanmadan verilir (NSData::from_vec).
    #[test]
    fn body_size_limited_and_no_needless_copy_in_source() {
        let k = include_str!("print.rs");
        let definition = &k[..k.find("#[cfg(test)]").unwrap()];
        assert!(definition.contains("MAX_FILE"), "boyut sınırı yok");
        assert!(
            definition.contains("NSData::from_vec(") && !definition.contains("NSData::with_bytes("),
            "PDFKit'e kopya"
        );
        let on = &definition[definition.find("pub async fn open_in_preview").unwrap()..];
        let on = &on[..on.find("\n}\n").unwrap()];
        assert!(
            definition
                .contains("fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String>")
                && !definition.contains("b.clone()"),
            "gövde kopyalanarak alınıyor"
        );
        assert!(
            !on.contains(".to_vec()") && !on.contains(".clone()"),
            "Önizleme gövdeyi kopyalıyor"
        );
    }

    /// Düşük 4 (davranış): sonuç süresi içinde gelirse aynen; gelmezse "yanıt yok" + zaman aşımı; kanal kapandıysa
    /// "kurulamadı". Zaman aşımında temsilci yetime taşınır, sayfa açık sayılmaz, geç sonuç yok sayılır.
    #[cfg(target_os = "macos")]
    #[test]
    fn wait_result_timeout_and_orphan_delegate() {
        use objc2::runtime::{AnyObject, Bool};
        use objc2::{msg_send, MainThreadMarker};
        let short = Duration::from_millis(50);
        let (g, al) = std::sync::mpsc::channel::<Result<bool, String>>();
        g.send(Ok(true)).unwrap();
        assert_eq!(
            tauri::async_runtime::block_on(wait_result(al, short)),
            (Ok(true), false)
        );
        let (_g, al) = std::sync::mpsc::channel::<Result<bool, String>>();
        let (s, za) = tauri::async_runtime::block_on(wait_result(al, short));
        assert!(za && s.as_ref().unwrap_err().contains('0'), "{s:?}");
        assert_eq!(s, Err(text("rust.no_printing_answer", &[("dk", "0")])));
        let (g, al) = std::sync::mpsc::channel::<Result<bool, String>>();
        drop(g);
        assert_eq!(
            tauri::async_runtime::block_on(wait_result(al, short)),
            (Err(text("rust.printing_setup_failed", &[])), false)
        );
        // SAFETY: yalnız kendi NSObject alt sınıfımız (bkz. baski_temsilcisi testi).
        let mtm = unsafe { MainThreadMarker::new_unchecked() };
        let (send, al) = std::sync::mpsc::channel();
        let t = mac::PrintDelegate::new_entry(mtm, send, None, None);
        mac::set_active(t.clone());
        assert!(mac::page_open());
        let once = mac::orphan_count();
        mac::release_timeout();
        assert!(
            !mac::page_open(),
            "zaman aşımından sonra sayfa açık sayılmamalı"
        );
        assert_eq!(
            mac::orphan_count(),
            once + 1,
            "temsilci bırakılmamalı (yetim)"
        );
        // geç gelen didRun: çökmez, sonuç gönderilmez
        let object: &AnyObject = &t;
        let blank: *mut std::ffi::c_void = std::ptr::null_mut();
        let operation: Option<&objc2_app_kit::NSPrintOperation> = None;
        let _: () = unsafe {
            msg_send![object, printOperationDidRun: operation, success: Bool::YES, contextInfo: blank]
        };
        assert!(al.try_recv().is_err());
    }

    /// Düşük 5 (davranış): sınır = dosya açma sınırı; aşan gövde anlaşılır hatayla reddedilir.
    #[test]
    fn body_size_limit() {
        let limit = crate::files::MAX_FILE as usize;
        assert!(check_body_size(1).is_ok() && check_body_size(limit).is_ok());
        assert_eq!(
            check_body_size(limit + 1),
            Err(text("rust.file_large", &[("mb", "1024")]))
        );
    }

    /// Düşük 6 (davranış): eski .pdf ve eski çökme artığı .gecici silinir; taze .gecici, yeni .pdf ve başka dosya kalır.
    #[test]
    fn cache_cleanup_old_pdf_and_leftover_temp() {
        let d = std::env::temp_dir().join(format!("mc-cache-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        let old = SystemTime::now() - Duration::from_secs(2 * 24 * 3600);
        let write = |name: &str, z: Option<SystemTime>| {
            fs::write(d.join(name), b"x").unwrap();
            if let Some(z) = z {
                fs::File::options()
                    .write(true)
                    .open(d.join(name))
                    .unwrap()
                    .set_modified(z)
                    .unwrap();
            }
        };
        let u = uuid::Uuid::new_v4();
        write("eski.pdf", Some(old));
        write("yeni.pdf", None);
        write(&format!(".eski.pdf.{u}.temp"), Some(old));
        write(&format!(".taze.pdf.{}.temp", uuid::Uuid::new_v4()), None);
        write("not.txt", Some(old));
        assert_eq!(clear_cache(&d, SystemTime::now()), (1, 1));
        let mut rest: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .map(|g| g.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        rest.sort();
        assert_eq!(rest.len(), 3, "{rest:?}");
        assert!(
            rest.iter().any(|a| a.starts_with(".taze.pdf."))
                && rest.contains(&"yeni.pdf".into())
                && rest.contains(&"not.txt".into())
        );
        assert_eq!(clear_cache(&d.join("none"), SystemTime::now()), (0, 0));
        let _ = fs::remove_dir_all(&d);
    }

    /// Düşük 6: açılışta Önizleme önbelleği (eski .pdf ve çökme artığı .gecici) temizlenir.
    #[test]
    fn cache_cleanup_on_startup_is_wired_in_source() {
        let lib = include_str!("lib.rs");
        let setup = &lib[lib.find(".setup(|app|").unwrap()..];
        let setup = &setup[..setup.find("Ok(())").unwrap()];
        assert!(
            setup.contains("print::clean_on_startup(app.handle())"),
            "kurulumda temizlik yok"
        );
    }

    /// Baskı işlemi PDFKit'e PageScaleNone ve otomatik döndürme kapalı olarak kurulur (kaynak denetimi: ana iş
    /// parçacığı gerektiren çağrı testte çalıştırılamaz).
    #[test]
    fn print_operation_scaling_mode_and_rotation_fixed_in_source() {
        let k = include_str!("print.rs");
        let head = k.find("pub fn print_operation(").unwrap();
        let body = &k[head..head + k[head..].find("\n    }\n").unwrap()];
        assert!(body.contains("printOperationForPrintInfo_scalingMode_autoRotate("));
        assert!(body.contains("SCALE_MODE,") && body.contains("a.rotate_auto,"));
        assert!(k.contains(
            "pub const SCALE_MODE: PDFPrintScalingMode = PDFPrintScalingMode::PageScaleNone;"
        ));
        assert!(
            !k.contains(&["PageScale", "ToFit"].concat())
                && !k.contains(&["PageScale", "DownToFit"].concat())
        );
    }
}
