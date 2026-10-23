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

use crate::i18n::metin;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// Baskı ayarı (platformdan bağımsız; `NSPrintInfo` buna göre kurulur). Ölçüler PostScript noktası (1/72 inç).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BaskiAyari {
    /// Kâğıt genişliği ve yüksekliği = ilk sayfanın MediaBox'ı (sayfa döndürmesi uygulanmış).
    pub kagit_gen: f64,
    pub kagit_yuk: f64,
    /// Yatay (genişlik > yükseklik).
    pub yatay: bool,
    /// Simetrik kenarın alt sınırı (pt). Gerçek kenar = en büyük donanım kenarı ile bunun büyüğü ([`simetrik_kenar`]);
    /// sayfa kenar dikdörtgeninden büyük olduğu için kırpılmaz, kenar yalnız ortalamayı simetrik yapar.
    pub kenar_tabani: f64,
    /// Ölçek çarpanı (1 = %100).
    pub olcek: f64,
    /// PDFKit'in otomatik döndürmesi (kapalı: kâğıt zaten sayfa yönünde).
    pub otomatik_dondur: bool,
}

/// İlk sayfanın ölçüsünden baskı ayarı. Ölçü sonlu ve pozitif değilse hata.
pub fn baski_ayari(gen: f64, yuk: f64) -> Result<BaskiAyari, String> {
    if !(gen.is_finite() && yuk.is_finite() && gen > 0.0 && yuk > 0.0) {
        return Err(metin("rust.pdf_okunamadi", &[]));
    }
    Ok(BaskiAyari {
        kagit_gen: gen,
        kagit_yuk: yuk,
        yatay: gen > yuk,
        kenar_tabani: KENAR_TABANI.min(gen.min(yuk) / 4.0),
        olcek: 1.0,
        otomatik_dondur: false,
    })
}

/// Simetrik kenarın öntanımlı alt sınırı: 1 inç (72 pt). Baskı penceresinde başka yazıcı seçilirse kenar o yazıcının
/// donanım kenarına göre yeniden hesaplanmaz; donanım kenarı ≤ 72 pt olan her yazıcıda ortalama yine simetrik kalır.
pub const KENAR_TABANI: f64 = 72.0;

/// S9 kök nedeni: AppKit sayfayı `kâğıt − etkin kenar` dikdörtgenine yerleştirir; etkin kenar =
/// max(NSPrintInfo kenarı, yazıcının donanım kenarı = `imageablePageBounds` dışı). Kenarlar 0 ve ortalı iken sayfa
/// yazdırılabilir alana ortalanır: donanım kenarları asimetrikse (yazıcısız A4 yatay: sol 18, sağ 41 pt) içerik
/// (sol − sağ) / 2 = −11,5 pt (−4,06 mm) kayar. Dört kenar eşit ve her donanım kenarından büyükse etkin kenarlar eşit
/// olur, ortalama kâğıda göre yapılır (kayma 0); sayfa kenar dikdörtgeninden büyük olduğundan içerik kırpılmaz.
///
/// `alan` = (x, y, genişlik, yükseklik) yazdırılabilir alan (pt), kâğıt `gen × yuk`. Alan geçersizse (sonlu değil,
/// boş) yalnız taban kullanılır. Dönen değer dört kenara da yazılır.
pub fn simetrik_kenar(gen: f64, yuk: f64, alan: (f64, f64, f64, f64), taban: f64) -> f64 {
    let (x, y, g, h) = alan;
    let gecerli = [x, y, g, h].iter().all(|v| v.is_finite()) && g > 0.0 && h > 0.0;
    let donanim = if gecerli {
        [x, y, gen - x - g, yuk - y - h]
            .into_iter()
            .fold(0.0_f64, f64::max)
    } else {
        0.0
    };
    donanim.max(if taban.is_finite() { taban } else { 0.0 })
}

/// Sayfa döndürmesi (derece) 90/270 ise genişlik ve yükseklik yer değiştirir.
pub fn donmus_olcu(gen: f64, yuk: f64, dondurme: i64) -> (f64, f64) {
    if dondurme.rem_euclid(180) == 90 {
        (yuk, gen)
    } else {
        (gen, yuk)
    }
}

/// Gövde boyutu sınırı (düşük 5): dosya açmayla aynı (`files::EN_COK_DOSYA`, 1 GiB).
pub fn govde_boyutu_denetle(uzunluk: usize) -> Result<(), String> {
    if uzunluk as u64 > crate::files::EN_COK_DOSYA {
        return Err(metin(
            "rust.dosya_buyuk",
            &[("mb", &(uzunluk >> 20).to_string())],
        ));
    }
    Ok(())
}

/// Ham PDF gövdesi (kopyasız ödünç; boş ya da sınırdan büyükse hata).
fn ham_govde<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(b) if !b.is_empty() => {
            govde_boyutu_denetle(b.len())?;
            Ok(b)
        }
        _ => Err(metin("rust.ham_bayt", &[])),
    }
}

fn baslik(request: &Request<'_>, ad: &str) -> String {
    request
        .headers()
        .get(ad)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

/// Önizleme için yazılan çıktıların klasörü (uygulamanın önbelleği; sandbox'ta kabın içi).
pub const CIKTI_KLASORU: &str = "cikti";
/// Bu yaştan eski önizleme çıktıları yeni çıktı yazılırken silinir (Önizleme açık tutuyor olabilir: hemen silinmez).
pub const CIKTI_OMRU: Duration = Duration::from_secs(24 * 60 * 60);

/// Çökme artığı `.gecici` dosyalarının silinmesi için en az yaş (taze olan şu an yazılıyor olabilir).
pub const GECICI_ARTIK_YASI: Duration = Duration::from_secs(10 * 60);

/// Önizleme klasörü temizliği (düşük 6): `omur`'den eski `.pdf` çıktılar ve çökme artığı `.gecici`
/// dosyaları (`atomik_yaz` kalıbı, `GECICI_ARTIK_YASI`'ndan eski). Dönüş: (silinen pdf, silinen geçici).
pub fn onbellek_temizle(klasor: &Path, simdi: SystemTime) -> (usize, usize) {
    (
        eski_ciktilari_temizle(klasor, CIKTI_OMRU, simdi),
        crate::recent::artik_gecicileri_temizle(klasor, GECICI_ARTIK_YASI),
    )
}

/// Açılışta Önizleme önbelleğini arka planda temizler (eskiden yalnız yeni çıktı yazılırken; `.gecici` hiç).
pub fn acilista_temizle<R: Runtime>(app: &AppHandle<R>) {
    let Ok(d) = app.path().app_cache_dir() else {
        return;
    };
    let klasor = d.join(CIKTI_KLASORU);
    std::thread::spawn(move || {
        onbellek_temizle(&klasor, SystemTime::now());
    });
}

/// Baskı penceresi sonucunun en uzun bekleme süresi (düşük 4): `didRun` gelmezse komut sonsuza dek beklemez.
pub const BASKI_ZAMAN_ASIMI: Duration = Duration::from_secs(30 * 60);

/// Kanaldan sonucu `sure` boyunca bekler (engelleyici bekleme ayrı iş parçacığında). Dönüş: (sonuç, zaman aşımı mı).
/// Zaman aşımında "yanıt yok", kanal kapandıysa "kurulamadı" hatası.
pub async fn sonuc_bekle<T: Send + 'static>(
    al: std::sync::mpsc::Receiver<Result<T, String>>,
    sure: Duration,
) -> (Result<T, String>, bool) {
    use std::sync::mpsc::RecvTimeoutError;
    match tauri::async_runtime::spawn_blocking(move || al.recv_timeout(sure)).await {
        Ok(Ok(s)) => (s, false),
        Ok(Err(RecvTimeoutError::Timeout)) => (
            Err(metin(
                "rust.baski_cevap_yok",
                &[("dk", &(sure.as_secs() / 60).to_string())],
            )),
            true,
        ),
        Ok(Err(RecvTimeoutError::Disconnected)) => {
            (Err(metin("rust.baski_kurulamadi", &[])), false)
        }
        Err(e) => (Err(e.to_string()), false),
    }
}

/// Klasördeki `omur`'den eski `.pdf` dosyalarını siler; silinen sayısı.
pub fn eski_ciktilari_temizle(klasor: &Path, omur: Duration, simdi: SystemTime) -> usize {
    let Ok(l) = fs::read_dir(klasor) else {
        return 0;
    };
    l.filter_map(Result::ok)
        .filter(|g| {
            let yol = g.path();
            yol.extension()
                .is_some_and(|u| u.eq_ignore_ascii_case("pdf"))
                && g.file_type().is_ok_and(|t| t.is_file())
                && g.metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|z| simdi.duration_since(z).ok())
                    .is_some_and(|yas| yas > omur)
        })
        .filter(|g| fs::remove_file(g.path()).is_ok())
        .count()
}

/// Önizleme çıktısını yazar: `<klasor>/<güvenli ad>.pdf` (aynı ad varsa üzerine). Yazılan yol.
pub fn cikti_yaz(klasor: &Path, kodlu_ad: &str, bayt: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(klasor)
        .map_err(|e| metin("rust.yazilamadi", &[("hata", &e.to_string())]))?;
    onbellek_temizle(klasor, SystemTime::now());
    let yol = klasor.join(crate::files::guvenli_ad(kodlu_ad, "pdf"));
    crate::recent::atomik_yaz(&yol, bayt)
        .map_err(|e| metin("rust.yazilamadi", &[("hata", &e.to_string())]))?;
    Ok(yol)
}

/// Dizilmiş PDF'i yazdırır (baskı penceresi). Gövde ham PDF baytı, `x-ad` başlığı iş adı (encodeURIComponent).
/// `true`: kullanıcı yazdırdı (ya da PDF olarak kaydetti); `false`: vazgeçti.
#[tauri::command]
pub async fn yazdir<R: Runtime>(
    app: AppHandle<R>,
    pencere: WebviewWindow<R>,
    request: Request<'_>,
) -> Result<bool, String> {
    // Tek kopya: bayt ana iş parçacığına taşınır; PDFKit'e kopyasız verilir (NSData::from_vec).
    let bayt = ham_govde(&request)?.to_vec();
    let ad = crate::files::guvenli_ad(&baslik(&request, "x-ad"), "pdf");
    #[cfg(target_os = "macos")]
    {
        mac::yazdir(&app, &pencere, bayt, ad).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, pencere, bayt, ad);
        Err(metin("rust.yazdirma_yok", &[]))
    }
}

/// Dizilmiş PDF'i önbelleğe yazar ve Önizleme'de açar. Gövde ham PDF baytı, `x-ad` önerilen ad. Açılan dosyanın adı.
#[tauri::command]
pub async fn onizlemede_ac<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let klasor = app
            .path()
            .app_cache_dir()
            .map_err(|e| metin("rust.yazilamadi", &[("hata", &e.to_string())]))?
            .join(CIKTI_KLASORU);
        // Gövde kopyalanmadan yazılır (düşük 5).
        let yol = cikti_yaz(&klasor, &baslik(&request, "x-ad"), ham_govde(&request)?)?;
        mac::onizlemede_ac(&yol).await?;
        Ok(yol
            .file_name()
            .map(|a| a.to_string_lossy().into_owned())
            .unwrap_or_default())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, ham_govde(&request)?);
        Err(metin("rust.yazdirma_yok", &[]))
    }
}

#[cfg(target_os = "macos")]
pub mod mac {
    //! macOS: PDFKit / AppKit çağrıları. `NSPrintInfo` ve `PDFDocument` her iş parçacığında kurulabilir (birim
    //! testleri baskı penceresi açmadan sınar); baskı işlemi ve sayfa ana iş parçacığında.
    use super::{baski_ayari, donmus_olcu, sonuc_bekle, BaskiAyari, BASKI_ZAMAN_ASIMI};
    use crate::i18n::metin;
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
    pub const OLCEK_MODU: PDFPrintScalingMode = PDFPrintScalingMode::PageScaleNone;
    /// Önizleme'nin paket kimliği.
    pub const ONIZLEME: &str = "com.apple.Preview";

    /// Ham bayttan PDF belgesi ve ilk sayfanın (döndürmesi uygulanmış) MediaBox ölçüsü (pt).
    pub fn pdf_ac(bayt: Vec<u8>) -> Result<(Retained<PDFDocument>, f64, f64), String> {
        let veri = NSData::from_vec(bayt); // kopyasız (düşük 5)
        let belge = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &veri) }
            .ok_or_else(|| metin("rust.pdf_okunamadi", &[]))?;
        if unsafe { belge.pageCount() } == 0 {
            return Err(metin("rust.pdf_okunamadi", &[]));
        }
        let sayfa =
            unsafe { belge.pageAtIndex(0) }.ok_or_else(|| metin("rust.pdf_okunamadi", &[]))?;
        let kutu = unsafe { sayfa.boundsForBox(PDFDisplayBox::MediaBox) };
        let (g, y) = donmus_olcu(
            kutu.size.width,
            kutu.size.height,
            unsafe { sayfa.rotation() } as i64,
        );
        Ok((belge, g, y))
    }

    /// `NSPrintInfo` kurulumu: kâğıt = sayfa, yön, ölçek 1, ortalı, sayfalama kırpar (ölçeklemez); dört kenar eşit ve
    /// donanım kenarlarından büyük ([`simetrik_kenar`]: kenar 0 iken asimetrik donanım kenarı içeriği kaydırıyordu, S9).
    /// Önce yön, sonra kâğıt boyu (AppKit yön değişince kâğıdı çevirebilir; sonuç testte okunur); kenar, kâğıt
    /// kurulduktan sonra o kâğıdın yazdırılabilir alanından.
    pub fn print_info_kur(a: &BaskiAyari) -> Retained<NSPrintInfo> {
        let info = NSPrintInfo::new();
        info.setOrientation(if a.yatay {
            NSPaperOrientation::Landscape
        } else {
            NSPaperOrientation::Portrait
        });
        info.setPaperSize(NSSize::new(a.kagit_gen, a.kagit_yuk));
        let k = info.paperSize();
        let ib = info.imageablePageBounds();
        let kenar = super::simetrik_kenar(
            k.width,
            k.height,
            (ib.origin.x, ib.origin.y, ib.size.width, ib.size.height),
            a.kenar_tabani,
        );
        info.setTopMargin(kenar);
        info.setBottomMargin(kenar);
        info.setLeftMargin(kenar);
        info.setRightMargin(kenar);
        info.setScalingFactor(a.olcek);
        info.setHorizontallyCentered(true);
        info.setVerticallyCentered(true);
        info.setHorizontalPagination(NSPrintingPaginationMode::Clip);
        info.setVerticalPagination(NSPrintingPaginationMode::Clip);
        info
    }

    /// Belge + ayar → PDFKit baskı işlemi (ana iş parçacığı). `None`: PDFKit işlem kuramadı.
    pub fn baski_islemi(
        belge: &PDFDocument,
        info: &NSPrintInfo,
        a: &BaskiAyari,
        mtm: MainThreadMarker,
    ) -> Option<Retained<NSPrintOperation>> {
        unsafe {
            belge.printOperationForPrintInfo_scalingMode_autoRotate(
                Some(info),
                OLCEK_MODU,
                a.otomatik_dondur,
                mtm,
            )
        }
    }

    type Sonuc = Result<bool, String>;

    /// Baskı sayfası bitince (`printOperationDidRun:success:contextInfo:`) sonucu gönderir. Belge ve işlem,
    /// sayfa açıkken düşmesin diye burada tutulur.
    pub struct Ivarlar {
        gonder: RefCell<Option<mpsc::Sender<Sonuc>>>,
        _belge: RefCell<Option<Retained<PDFDocument>>>,
        _islem: RefCell<Option<Retained<NSPrintOperation>>>,
    }

    define_class!(
        // SAFETY: NSObject'in alt sınıf koşulu yok; Drop uygulanmıyor.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "KitapCiltBaskiTemsilcisi"]
        #[ivars = Ivarlar]
        pub struct BaskiTemsilcisi;

        impl BaskiTemsilcisi {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn baski_bitti(
                &self,
                _islem: Option<&NSPrintOperation>,
                basarili: Bool,
                _baglam: *mut c_void,
            ) {
                if let Some(g) = self.ivars().gonder.borrow_mut().take() {
                    let _ = g.send(Ok(basarili.as_bool()));
                }
            }
        }

        unsafe impl NSObjectProtocol for BaskiTemsilcisi {}
    );

    impl BaskiTemsilcisi {
        /// Sonucu `gonder`e iletecek temsilci (belge ve işlem sayfa kapanana dek tutulur).
        pub fn yeni(
            mtm: MainThreadMarker,
            gonder: mpsc::Sender<Sonuc>,
            belge: Option<Retained<PDFDocument>>,
            islem: Option<Retained<NSPrintOperation>>,
        ) -> Retained<Self> {
            let t = Self::alloc(mtm).set_ivars(Ivarlar {
                gonder: RefCell::new(Some(gonder)),
                _belge: RefCell::new(belge),
                _islem: RefCell::new(islem),
            });
            unsafe { msg_send![super(t), init] }
        }

        /// Baskı sayfası açık mı (sonuç henüz gönderilmedi)?
        pub fn bekliyor(&self) -> bool {
            self.ivars().gonder.borrow().is_some()
        }
    }

    thread_local! {
        /// Açık (ya da son) baskı sayfasının temsilcisi: AppKit temsilciyi tutmaz; sonuç gelince bırakılır.
        static ETKIN: RefCell<Option<Retained<BaskiTemsilcisi>>> = const { RefCell::new(None) };
        /// Zaman aşımına uğramış temsilciler (düşük 4): sayfa hâlâ açık olabilir ve AppKit temsilciyi tutmadığından
        /// bırakılmaz (geç gelen didRun sarkan işaretçiye gitmesin); süreç boyunca yaşar (yalnız olağan dışı durumda).
        static YETIMLER: RefCell<Vec<Retained<BaskiTemsilcisi>>> = const { RefCell::new(Vec::new()) };
    }

    pub(crate) fn sayfa_acik() -> bool {
        ETKIN.with(|e| e.borrow().as_ref().is_some_and(|t| t.bekliyor()))
    }

    /// Test için: açık sayfa temsilcisini ayarlar (gerçekte `baslat` ayarlar).
    #[cfg(test)]
    pub(crate) fn etkin_ayarla(t: Retained<BaskiTemsilcisi>) {
        ETKIN.with(|e| *e.borrow_mut() = Some(t));
    }

    #[cfg(test)]
    pub(crate) fn yetim_sayisi() -> usize {
        YETIMLER.with(|y| y.borrow().len())
    }

    /// Zaman aşımı (ana iş parçacığı): temsilcinin sonuç kanalı kapatılır (sayfa "açık" sayılmaz, yeni ⌘P açılabilir;
    /// geç gelen sonuç yok sayılır), temsilci yetim listesine taşınır (bırakılmaz).
    pub(crate) fn zaman_asimi_birak() {
        ETKIN.with(|e| {
            if let Some(t) = e.borrow_mut().take() {
                t.ivars().gonder.borrow_mut().take();
                YETIMLER.with(|y| y.borrow_mut().push(t));
            }
        });
    }

    /// Ana iş parçacığında: belgeyi aç, ayarı kur, baskı sayfasını pencereye bağla (pencere yoksa kipli).
    fn baslat(
        mtm: MainThreadMarker,
        pencere: Option<Retained<NSWindow>>,
        bayt: Vec<u8>,
        ad: String,
        gonder: mpsc::Sender<Sonuc>,
    ) {
        if sayfa_acik() {
            let _ = gonder.send(Err(metin("rust.baski_acik", &[])));
            return;
        }
        let kur = move || -> Result<(Retained<PDFDocument>, Retained<NSPrintOperation>), String> {
            let (belge, g, y) = pdf_ac(bayt)?;
            let a = baski_ayari(g, y)?;
            let info = print_info_kur(&a);
            let islem = baski_islemi(&belge, &info, &a, mtm)
                .ok_or_else(|| metin("rust.baski_kurulamadi", &[]))?;
            islem.setJobTitle(Some(&NSString::from_str(&ad)));
            islem.setShowsPrintPanel(true);
            islem.setShowsProgressPanel(true);
            Ok((belge, islem))
        };
        let (belge, islem) = match kur() {
            Ok(k) => k,
            Err(e) => {
                let _ = gonder.send(Err(e));
                return;
            }
        };
        match pencere {
            Some(p) => {
                let t = BaskiTemsilcisi::yeni(mtm, gonder, Some(belge), Some(islem.clone()));
                ETKIN.with(|e| *e.borrow_mut() = Some(t.clone()));
                let temsilci: &AnyObject = &t;
                unsafe {
                    islem.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                        &p,
                        Some(temsilci),
                        Some(sel!(printOperationDidRun:success:contextInfo:)),
                        std::ptr::null_mut(),
                    );
                }
            }
            None => {
                // Pencere yok (beklenmez): uygulama kipli baskı penceresi; dönünce sonuç hazır.
                let _ = gonder.send(Ok(islem.runOperation()));
                drop(belge);
            }
        }
    }

    /// Sonuç gelince temsilciyi (belge + işlem) bırakır; sonraki baskı için yer açılır.
    fn birak() {
        ETKIN.with(|e| {
            let biten = e.borrow().as_ref().is_some_and(|t| !t.bekliyor());
            if biten {
                e.borrow_mut().take();
            }
        });
    }

    pub async fn yazdir<R: Runtime>(
        app: &AppHandle<R>,
        pencere: &WebviewWindow<R>,
        bayt: Vec<u8>,
        ad: String,
    ) -> Result<bool, String> {
        let (gonder, al) = mpsc::channel::<Sonuc>();
        let hata = gonder.clone();
        let pencere = pencere.clone();
        app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                let _ = hata.send(Err(metin("rust.baski_kurulamadi", &[])));
                return;
            };
            // Düşük 3: NSWindow işaretçisi ana iş parçacığında alınır ve hemen tutulur (retain);
            // eskiden çağıran iş parçacığında alınıp sayı olarak taşınıyordu (arada pencere kapanırsa sarkan işaretçi).
            let p = pencere
                .ns_window()
                .ok()
                .and_then(|p| unsafe { Retained::retain(p.cast::<NSWindow>()) });
            baslat(mtm, p, bayt, ad, gonder);
        })
        .map_err(|e| e.to_string())?;
        // Düşük 4: süreli bekleme; zaman aşımında açık sayfa kaydı temizlenir (ETKIN takılı kalmaz).
        let (sonuc, zaman_asimi) = sonuc_bekle(al, BASKI_ZAMAN_ASIMI).await;
        let _ = if zaman_asimi {
            app.run_on_main_thread(zaman_asimi_birak)
        } else {
            app.run_on_main_thread(birak)
        };
        sonuc
    }

    /// Önizleme'de açmayı başlatır (eşzamanlı; AppKit nesneleri burada kalır); sonuç kanaldan gelir.
    fn onizleme_baslat(yol: &Path) -> Result<mpsc::Receiver<Result<(), String>>, String> {
        let calisma = NSWorkspace::sharedWorkspace();
        let uygulama = calisma
            .URLForApplicationWithBundleIdentifier(&NSString::from_str(ONIZLEME))
            .ok_or_else(|| metin("rust.onizleme_yok", &[]))?;
        let url = NSURL::from_file_path(yol)
            .ok_or_else(|| metin("rust.yazilamadi", &[("hata", &yol.display().to_string())]))?;
        let ayar = NSWorkspaceOpenConfiguration::configuration();
        ayar.setActivates(true);
        let (gonder, al) = mpsc::channel::<Result<(), String>>();
        let blok = block2::RcBlock::new(
            move |_uyg: *mut objc2_app_kit::NSRunningApplication, hata: *mut NSError| {
                let s = match unsafe { hata.as_ref() } {
                    Some(h) => Err(h.localizedDescription().to_string()),
                    None => Ok(()),
                };
                let _ = gonder.send(s);
            },
        );
        calisma.openURLs_withApplicationAtURL_configuration_completionHandler(
            &NSArray::from_retained_slice(&[url]),
            &uygulama,
            &ayar,
            Some(&blok),
        );
        Ok(al)
    }

    /// Dosyayı Önizleme'de açar; Önizleme yoksa ya da açamazsa hata (NSError metni). 30 sn içinde yanıt yoksa hata.
    pub async fn onizlemede_ac(yol: &Path) -> Result<(), String> {
        let al = onizleme_baslat(yol)?;
        tauri::async_runtime::spawn_blocking(move || al.recv_timeout(Duration::from_secs(30)))
            .await
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|_| Err(metin("rust.onizleme_cevap_yok", &[])))
    }
}

#[cfg(test)]
mod testler {
    use super::*;

    /// Test PDF'i: verilen MediaBox ve /Rotate ile tek sayfa (doğru xref).
    pub(crate) fn tek_sayfa_pdf(gen: f64, yuk: f64, dondur: i64) -> Vec<u8> {
        let nesneler = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {gen} {yuk}] /Rotate {dondur} /Contents 4 0 R >>"),
            "<< /Length 0 >>\nstream\n\nendstream".to_string(),
        ];
        let mut s = String::from("%PDF-1.4\n");
        let mut ofs = Vec::new();
        for (i, n) in nesneler.iter().enumerate() {
            ofs.push(s.len());
            s.push_str(&format!("{} 0 obj\n{n}\nendobj\n", i + 1));
        }
        let xref = s.len();
        s.push_str(&format!(
            "xref\n0 {}\n0000000000 65535 f \n",
            nesneler.len() + 1
        ));
        for o in ofs {
            s.push_str(&format!("{o:010} 00000 n \n"));
        }
        s.push_str(&format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            nesneler.len() + 1
        ));
        s.into_bytes()
    }

    const A4_YATAY: (f64, f64) = (841.889_763_779_527_6, 595.275_590_551_181_1); // 297 × 210 mm

    #[test]
    fn baski_ayari_kagit_sayfa_kenar_tabani_olcek_bir_dondurme_yok() {
        let a = baski_ayari(A4_YATAY.0, A4_YATAY.1).unwrap();
        assert_eq!(
            a,
            BaskiAyari {
                kagit_gen: A4_YATAY.0,
                kagit_yuk: A4_YATAY.1,
                yatay: true,
                kenar_tabani: KENAR_TABANI,
                olcek: 1.0,
                otomatik_dondur: false
            }
        );
        assert!(!baski_ayari(419.53, 595.28).unwrap().yatay, "A5 dikey");
        // küçük kâğıtta taban kısa kenarın dörtte biri (kenar dikdörtgeni boş kalmasın)
        assert_eq!(baski_ayari(200.0, 100.0).unwrap().kenar_tabani, 25.0);
        for (g, y) in [
            (0.0, 10.0),
            (10.0, -1.0),
            (f64::NAN, 10.0),
            (10.0, f64::INFINITY),
        ] {
            assert!(baski_ayari(g, y).is_err(), "{g} × {y}");
        }
        assert_eq!(donmus_olcu(100.0, 200.0, 90), (200.0, 100.0));
        assert_eq!(donmus_olcu(100.0, 200.0, -90), (200.0, 100.0));
        assert_eq!(donmus_olcu(100.0, 200.0, 180), (100.0, 200.0));
        assert_eq!(donmus_olcu(100.0, 200.0, 270), (200.0, 100.0));
    }

    #[test]
    fn eski_ciktilar_temizlenir_yeniler_ve_pdf_olmayanlar_kalir() {
        let d = std::env::temp_dir().join(format!("kc-cikti-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        for a in ["eski.pdf", "yeni.pdf", "not.txt"] {
            fs::write(d.join(a), b"x").unwrap();
        }
        fs::create_dir(d.join("klasor.pdf")).unwrap();
        // "şimdi" 2 gün sonrası: üç dosya da eski; yalnız .pdf dosyası silinir (klasör ve .txt kalır)
        let sonra = SystemTime::now() + Duration::from_secs(2 * 24 * 3600);
        assert_eq!(eski_ciktilari_temizle(&d, CIKTI_OMRU, sonra), 2);
        assert!(d.join("not.txt").exists() && d.join("klasor.pdf").is_dir());
        // yeni yazılan kalır; aynı ad üzerine yazılır; ad güvenli (yol ayracı yok)
        let y = cikti_yaz(&d, "..%2Fkotu%2Fad-onler", b"%PDF-1").unwrap();
        assert_eq!(y.parent().unwrap(), d);
        assert_eq!(
            y.file_name().unwrap().to_string_lossy(),
            "-kotu-ad-onler.pdf"
        );
        cikti_yaz(&d, "..%2Fkotu%2Fad-onler", b"%PDF-2").unwrap();
        assert_eq!(fs::read(&y).unwrap(), b"%PDF-2");
        assert_eq!(eski_ciktilari_temizle(&d, CIKTI_OMRU, SystemTime::now()), 0);
        assert_eq!(eski_ciktilari_temizle(&d.join("yok"), CIKTI_OMRU, sonra), 0);
        let _ = fs::remove_dir_all(&d);
    }

    /// S9 kök nedeni: AppKit sayfayı yazdırılabilir alana ortalar; kenar = en büyük donanım kenarı (ya da taban), dört
    /// kenara aynı. Asimetrik donanım kenarında (yazıcısız A4 yatay: sol 18, sağ 41) eski kenar 0 −11,5 pt kaydırıyordu.
    #[test]
    fn simetrik_kenar_en_buyuk_donanim_kenari_ya_da_taban() {
        let (g, y) = (842.0, 595.0);
        // yazıcısız A4 yatay (gözlem): x 18, y 18, 783 × 559 → sol 18, alt 18, sağ 41, üst 18
        assert_eq!(simetrik_kenar(g, y, (18.0, 18.0, 783.0, 559.0), 0.0), 41.0);
        assert_eq!(simetrik_kenar(g, y, (18.0, 18.0, 783.0, 559.0), 72.0), 72.0);
        // donanım kenarı tabandan büyükse donanım (üst 100)
        assert_eq!(
            simetrik_kenar(g, y, (10.0, 10.0, 822.0, 485.0), 72.0),
            100.0
        );
        // kenarsız kâğıt (320 × 220 gözlemi): taban
        assert_eq!(
            simetrik_kenar(907.09, 623.62, (0.0, 0.0, 907.09, 623.62), 72.0),
            72.0
        );
        // kusurlu alan: NaN, sonsuz, boş, negatif boy → yalnız taban; taban NaN → 0 (donanım yine sayılır)
        for alan in [
            (f64::NAN, 18.0, 783.0, 559.0),
            (18.0, 18.0, f64::INFINITY, 559.0),
            (18.0, 18.0, 0.0, 559.0),
            (18.0, 18.0, 783.0, -1.0),
        ] {
            assert_eq!(simetrik_kenar(g, y, alan, 72.0), 72.0, "{alan:?}");
        }
        assert_eq!(
            simetrik_kenar(g, y, (18.0, 18.0, 783.0, 559.0), f64::NAN),
            41.0
        );
        // eski davranış (kenar 0) bu testi geçemez: asimetrik alanda 0 dönmez
        assert_ne!(simetrik_kenar(g, y, (18.0, 18.0, 783.0, 559.0), 0.0), 0.0);
    }

    /// O2: uzun Türkçe adla Önizleme çıktısı yazılır (geçici ad dahil hiçbir ad 255 baytı aşmaz; eskiden
    /// `.<ad>.<uuid>.gecici` +45 bayt ENAMETOOLONG → Önizleme her zaman seçenek E'ye düşüyordu).
    #[test]
    fn onizleme_uzun_turkce_adla_yazilir_gecici_ad_255_bayti_asmaz() {
        let d = std::env::temp_dir().join(format!("kc-cikti-uzun-{}", uuid::Uuid::new_v4()));
        // "Uzun Türkçe kitap adı " ×20 = 440 karakter / 500 bayt; JS encodeURIComponent biçiminde (her bayt %XX).
        // Gözlem: APFS sınırı karakter sayar (yalnız çok baytlı karakterli ad 255 baytta ~150 karakter kalıp geçerdi);
        // bu ad güvenli_ad'dan sonra 255 bayt ≈ 240 karakter, geçici ad +45 → sınır aşılıyordu.
        let ad: String = "Uzun Türkçe kitap adı ".repeat(20) + "-dizilmis.pdf";
        let kodlu: String = ad.bytes().map(|b| format!("%{b:02X}")).collect();
        for (n, b) in [(1, &b"%PDF-1"[..]), (2, &b"%PDF-2"[..])] {
            let y = cikti_yaz(&d, &kodlu, b).unwrap_or_else(|e| panic!("{n}. yazım: {e}"));
            let a = y.file_name().unwrap().to_string_lossy().into_owned();
            assert!(a.len() <= crate::files::AD_EN_COK_BAYT, "{} bayt", a.len());
            assert!(a.ends_with(".pdf") && a.starts_with("Uzun Türkçe"), "{a}");
            assert_eq!(fs::read(&y).unwrap(), b);
        }
        let kalan: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .map(|g| g.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(kalan.len(), 1, "geçici dosya kaldı: {kalan:?}");
        let _ = fs::remove_dir_all(&d);
    }

    /// NSPrintInfo kurulumu (baskı penceresi açmadan): kâğıt = ilk sayfanın MediaBox'ı, kenar simetrik, yön, ölçek 1;
    /// ölçek modu PageScaleNone, otomatik döndürme kapalı.
    #[cfg(target_os = "macos")]
    #[test]
    fn nsprintinfo_kurulumu_kagit_kenar_yon_olcek() {
        use objc2_app_kit::{NSPaperOrientation, NSPrintingPaginationMode};
        use objc2_pdf_kit::PDFPrintScalingMode;
        // Kabul toleransı ±0,5 mm. Gözlem (macOS 26.6.2): AppKit standart kâğıda yakın ölçüyü yazıcının kâğıdına oturtur
        // (A4 841,89 × 595,28 → 842 × 595; A5 419,53 × 595,28 → 420 × 595; fark ≤ 0,17 mm), standart dışını aynen tutar.
        let yakin = |a: f64, b: f64| (a - b).abs() <= 0.5 * 72.0 / 25.4;
        for (g, y, dondur, beklenen_g, beklenen_y, yatay) in [
            (A4_YATAY.0, A4_YATAY.1, 0, A4_YATAY.0, A4_YATAY.1, true),
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
            let (_belge, pg, py) = mac::pdf_ac(tek_sayfa_pdf(g, y, dondur)).unwrap();
            assert!(
                yakin(pg, beklenen_g) && yakin(py, beklenen_y),
                "{pg} × {py}"
            );
            let a = baski_ayari(pg, py).unwrap();
            let info = mac::print_info_kur(&a);
            let k = info.paperSize();
            eprintln!("gözlem: istenen {pg:.2} × {py:.2} pt → NSPrintInfo {} × {} pt, yön {:?}, ölçek {}", k.width, k.height, info.orientation(), info.scalingFactor());
            assert!(
                yakin(k.width, beklenen_g) && yakin(k.height, beklenen_y),
                "kâğıt {} × {} (beklenen {beklenen_g} × {beklenen_y})",
                k.width,
                k.height
            );
            assert_eq!(
                info.orientation(),
                if yatay {
                    NSPaperOrientation::Landscape
                } else {
                    NSPaperOrientation::Portrait
                }
            );
            // dört kenar eşit, ≥ taban ve ≥ her donanım kenarı (S9: ortalama kâğıda göre, kayma yok)
            let kenarlar = [
                info.topMargin(),
                info.bottomMargin(),
                info.leftMargin(),
                info.rightMargin(),
            ];
            let ib = info.imageablePageBounds();
            let donanim = [
                ib.origin.x,
                ib.origin.y,
                k.width - ib.origin.x - ib.size.width,
                k.height - ib.origin.y - ib.size.height,
            ];
            eprintln!("gözlem: yazdırılabilir alan {ib:?}, donanım kenarı {donanim:?}, kenar {kenarlar:?}");
            assert!(kenarlar.iter().all(|&m| m == kenarlar[0]), "{kenarlar:?}");
            assert!(kenarlar[0] >= a.kenar_tabani);
            assert!(
                donanim.iter().all(|&d| kenarlar[0] >= d),
                "{donanim:?} / {kenarlar:?}"
            );
            assert_eq!(info.scalingFactor(), 1.0);
            assert_eq!(info.horizontalPagination(), NSPrintingPaginationMode::Clip);
            assert_eq!(info.verticalPagination(), NSPrintingPaginationMode::Clip);
            assert!(info.isHorizontallyCentered() && info.isVerticallyCentered());
        }
        assert_eq!(mac::OLCEK_MODU, PDFPrintScalingMode::PageScaleNone);
        assert_eq!(mac::OLCEK_MODU.0, 0, "kPDFPrintPageScaleNone");
        // bozuk / boş / sayfasız girdi
        for b in [&b""[..], b"bu bir pdf degil", b"%PDF-1.4\n%%EOF\n"] {
            assert!(mac::pdf_ac(b.to_vec()).is_err());
        }
    }

    /// Baskı sayfası temsilcisi: AppKit'in çağıracağı seçici (`printOperationDidRun:success:contextInfo:`) sınıfta
    /// var; çağrılınca sonuç (yazdırıldı/vazgeçildi) bir kez gönderilir, sonra temsilci "bitti" sayılır.
    #[cfg(target_os = "macos")]
    #[test]
    fn baski_temsilcisi_secici_sonucu_bir_kez_gonderir() {
        use objc2::runtime::{AnyObject, Bool};
        use objc2::{msg_send, sel, MainThreadMarker};
        // SAFETY: yalnız kendi NSObject alt sınıfımız kurulur ve çağrılır (AppKit nesnesi yok); ana iş parçacığı
        // koşulu AppKit nesneleri içindir. Gerçek kullanımda temsilci ana iş parçacığında kurulur.
        let mtm = unsafe { MainThreadMarker::new_unchecked() };
        for (basarili, beklenen) in [(Bool::YES, true), (Bool::NO, false)] {
            let (gonder, al) = std::sync::mpsc::channel();
            let t = mac::BaskiTemsilcisi::yeni(mtm, gonder, None, None);
            let nesne: &AnyObject = &t;
            let yanitlar: bool = unsafe {
                msg_send![nesne, respondsToSelector: sel!(printOperationDidRun:success:contextInfo:)]
            };
            assert!(yanitlar);
            assert!(t.bekliyor());
            let bos: *mut std::ffi::c_void = std::ptr::null_mut();
            let islem: Option<&objc2_app_kit::NSPrintOperation> = None;
            let _: () = unsafe {
                msg_send![nesne, printOperationDidRun: islem, success: basarili, contextInfo: bos]
            };
            assert_eq!(al.try_recv().unwrap(), Ok(beklenen));
            assert!(!t.bekliyor());
            // ikinci çağrı yeni sonuç göndermez
            let _: () = unsafe {
                msg_send![nesne, printOperationDidRun: islem, success: Bool::YES, contextInfo: bos]
            };
            assert!(al.try_recv().is_err());
        }
    }

    /// `mac::yazdir` gövdesi (kaynak denetimi: ana iş parçacığı gerektiren yol testte çalıştırılamaz).
    fn mac_yazdir_govdesi() -> &'static str {
        let k = include_str!("print.rs");
        let bas = k.find("    pub async fn yazdir<R: Runtime>(").unwrap();
        &k[bas..bas + k[bas..].find("\n    }\n").unwrap()]
    }

    /// Düşük 3: NSWindow işaretçisi ana iş parçacığında alınır (eskiden çağıran iş parçacığında alınıp
    /// usize olarak taşınıyordu; arada pencere kapanırsa sarkan işaretçi).
    #[test]
    fn pencere_isaretcisi_ana_is_parcaciginda_alinir() {
        let g = mac_yazdir_govdesi();
        let ana = g
            .find("run_on_main_thread(move ||")
            .expect("run_on_main_thread yok");
        let ns = g.find("ns_window()").expect("ns_window yok");
        assert!(
            ns > ana,
            "ns_window() ana iş parçacığı kapanışından önce çağrılıyor"
        );
        assert!(!g.contains("as usize"), "işaretçi usize olarak taşınıyor");
    }

    /// Düşük 4: `didRun` gelmezse sonsuz beklenmez (zaman aşımı) ve açık sayfa kaydı (ETKIN) temizlenir.
    #[test]
    fn baski_sonucu_zaman_asimiyla_beklenir_kaynak() {
        let g = mac_yazdir_govdesi();
        assert!(!g.contains("al.recv()"), "sonuç süresiz bekleniyor");
        assert!(
            g.contains("sonuc_bekle(") && g.contains("zaman_asimi_birak"),
            "{g}"
        );
    }

    /// Düşük 5: gövde boyutu sınırlı (dosya açmayla aynı sınır); Önizleme gövdeyi kopyalamaz; PDFKit'e bayt
    /// kopyalanmadan verilir (NSData::from_vec).
    #[test]
    fn govde_boyutu_sinirli_ve_gereksiz_kopya_yok_kaynak() {
        let k = include_str!("print.rs");
        let tanim = &k[..k.find("#[cfg(test)]").unwrap()];
        assert!(tanim.contains("EN_COK_DOSYA"), "boyut sınırı yok");
        assert!(
            tanim.contains("NSData::from_vec(") && !tanim.contains("NSData::with_bytes("),
            "PDFKit'e kopya"
        );
        let on = &tanim[tanim.find("pub async fn onizlemede_ac").unwrap()..];
        let on = &on[..on.find("\n}\n").unwrap()];
        assert!(
            tanim
                .contains("fn ham_govde<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String>")
                && !tanim.contains("b.clone()"),
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
    fn sonuc_bekle_zaman_asimi_ve_yetim_temsilci() {
        use objc2::runtime::{AnyObject, Bool};
        use objc2::{msg_send, MainThreadMarker};
        let kisa = Duration::from_millis(50);
        let (g, al) = std::sync::mpsc::channel::<Result<bool, String>>();
        g.send(Ok(true)).unwrap();
        assert_eq!(
            tauri::async_runtime::block_on(sonuc_bekle(al, kisa)),
            (Ok(true), false)
        );
        let (_g, al) = std::sync::mpsc::channel::<Result<bool, String>>();
        let (s, za) = tauri::async_runtime::block_on(sonuc_bekle(al, kisa));
        assert!(za && s.as_ref().unwrap_err().contains('0'), "{s:?}");
        assert_eq!(s, Err(metin("rust.baski_cevap_yok", &[("dk", "0")])));
        let (g, al) = std::sync::mpsc::channel::<Result<bool, String>>();
        drop(g);
        assert_eq!(
            tauri::async_runtime::block_on(sonuc_bekle(al, kisa)),
            (Err(metin("rust.baski_kurulamadi", &[])), false)
        );
        // SAFETY: yalnız kendi NSObject alt sınıfımız (bkz. baski_temsilcisi testi).
        let mtm = unsafe { MainThreadMarker::new_unchecked() };
        let (gonder, al) = std::sync::mpsc::channel();
        let t = mac::BaskiTemsilcisi::yeni(mtm, gonder, None, None);
        mac::etkin_ayarla(t.clone());
        assert!(mac::sayfa_acik());
        let once = mac::yetim_sayisi();
        mac::zaman_asimi_birak();
        assert!(
            !mac::sayfa_acik(),
            "zaman aşımından sonra sayfa açık sayılmamalı"
        );
        assert_eq!(
            mac::yetim_sayisi(),
            once + 1,
            "temsilci bırakılmamalı (yetim)"
        );
        // geç gelen didRun: çökmez, sonuç gönderilmez
        let nesne: &AnyObject = &t;
        let bos: *mut std::ffi::c_void = std::ptr::null_mut();
        let islem: Option<&objc2_app_kit::NSPrintOperation> = None;
        let _: () = unsafe {
            msg_send![nesne, printOperationDidRun: islem, success: Bool::YES, contextInfo: bos]
        };
        assert!(al.try_recv().is_err());
    }

    /// Düşük 5 (davranış): sınır = dosya açma sınırı; aşan gövde anlaşılır hatayla reddedilir.
    #[test]
    fn govde_boyutu_siniri() {
        let sinir = crate::files::EN_COK_DOSYA as usize;
        assert!(govde_boyutu_denetle(1).is_ok() && govde_boyutu_denetle(sinir).is_ok());
        assert_eq!(
            govde_boyutu_denetle(sinir + 1),
            Err(metin("rust.dosya_buyuk", &[("mb", "1024")]))
        );
    }

    /// Düşük 6 (davranış): eski .pdf ve eski çökme artığı .gecici silinir; taze .gecici, yeni .pdf ve başka dosya kalır.
    #[test]
    fn onbellek_temizligi_eski_pdf_ve_artik_gecici() {
        let d = std::env::temp_dir().join(format!("kc-onbellek-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        let eski = SystemTime::now() - Duration::from_secs(2 * 24 * 3600);
        let yaz = |ad: &str, z: Option<SystemTime>| {
            fs::write(d.join(ad), b"x").unwrap();
            if let Some(z) = z {
                fs::File::options()
                    .write(true)
                    .open(d.join(ad))
                    .unwrap()
                    .set_modified(z)
                    .unwrap();
            }
        };
        let u = uuid::Uuid::new_v4();
        yaz("eski.pdf", Some(eski));
        yaz("yeni.pdf", None);
        yaz(&format!(".eski.pdf.{u}.gecici"), Some(eski));
        yaz(&format!(".taze.pdf.{}.gecici", uuid::Uuid::new_v4()), None);
        yaz("not.txt", Some(eski));
        assert_eq!(onbellek_temizle(&d, SystemTime::now()), (1, 1));
        let mut kalan: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .map(|g| g.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        kalan.sort();
        assert_eq!(kalan.len(), 3, "{kalan:?}");
        assert!(
            kalan.iter().any(|a| a.starts_with(".taze.pdf."))
                && kalan.contains(&"yeni.pdf".into())
                && kalan.contains(&"not.txt".into())
        );
        assert_eq!(onbellek_temizle(&d.join("yok"), SystemTime::now()), (0, 0));
        let _ = fs::remove_dir_all(&d);
    }

    /// Düşük 6: açılışta Önizleme önbelleği (eski .pdf ve çökme artığı .gecici) temizlenir.
    #[test]
    fn acilista_onbellek_temizligi_bagli_kaynak() {
        let lib = include_str!("lib.rs");
        let kurulum = &lib[lib.find(".setup(|app|").unwrap()..];
        let kurulum = &kurulum[..kurulum.find("Ok(())").unwrap()];
        assert!(
            kurulum.contains("print::acilista_temizle(app.handle())"),
            "kurulumda temizlik yok"
        );
    }

    /// Baskı işlemi PDFKit'e PageScaleNone ve otomatik döndürme kapalı olarak kurulur (kaynak denetimi: ana iş
    /// parçacığı gerektiren çağrı testte çalıştırılamaz).
    #[test]
    fn baski_islemi_olcek_modu_ve_dondurme_kaynakta_sabit() {
        let k = include_str!("print.rs");
        let bas = k.find("pub fn baski_islemi(").unwrap();
        let govde = &k[bas..bas + k[bas..].find("\n    }\n").unwrap()];
        assert!(govde.contains("printOperationForPrintInfo_scalingMode_autoRotate("));
        assert!(govde.contains("OLCEK_MODU,") && govde.contains("a.otomatik_dondur,"));
        assert!(k.contains(
            "pub const OLCEK_MODU: PDFPrintScalingMode = PDFPrintScalingMode::PageScaleNone;"
        ));
        assert!(
            !k.contains(&["PageScale", "ToFit"].concat())
                && !k.contains(&["PageScale", "DownToFit"].concat())
        );
    }
}
