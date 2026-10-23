//! Printing: option A — a PDFKit print operation, 100% scale; option B — Open in Preview.
//!
//! A. `print`: the body is the raw PDF bytes (the imposed PDF made by JS; no file path). On the main thread
//! `PDFDocument` → `NSPrintInfo` (paper = the MediaBox of the first page, orientation by the page, scale 1, centred, four
//! equal margins larger than the printer's hardware margins — see [`symmetric_margin`]) →
//! `printOperationForPrintInfo:scalingMode:autoRotate:` (`PageScaleNone`, no rotation) → a print sheet attached to the
//! window. The command returns `true` when the user presses Print (or "Save as PDF"), `false` on cancel; the app does
//! not lock while the sheet is open (modal only for that window). When the window is not found, an app-modal dialog.
//! The printer driver's own "Scale to fit" setting can still spoil the scale: JS shows a note before the print dialog.
//!
//! B. `open_in_preview`: the PDF is written to `app_cache_dir/output/<name>.pdf` and opened in Preview
//! (`com.apple.Preview`) with `NSWorkspace`. Whether Preview can open a file inside the container in the sandbox is
//! tested by hand; when it cannot, the error goes to JS and JS falls back to option E (Save + a "print from Preview" note).
//!
//! Non-Apple platform: both commands return a clear "not available yet" error (from the dictionary).

use crate::i18n::text;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// Print settings (platform independent; `NSPrintInfo` is set up from them). Sizes in PostScript points (1/72 inch).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PrintSettings {
    /// Paper width and height = the MediaBox of the first page (with the page rotation applied).
    pub paper_width: f64,
    pub paper_height: f64,
    /// Landscape (width > height).
    pub landscape: bool,
    /// The lower limit of the symmetric margin (pt). The real margin = the larger of the largest hardware margin and this
    /// ([`symmetric_margin`]); as the page is larger than the margin rectangle it is not cropped, the margin only makes the centring symmetric.
    pub margin_floor: f64,
    /// Scale factor (1 = 100%).
    pub scaling: f64,
    /// PDFKit's automatic rotation (off: the paper already has the page orientation).
    pub rotate_auto: bool,
}

/// Print settings from the size of the first page. An error when the size is not finite and positive.
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

/// The default lower limit of the symmetric margin: 1 inch (72 pt). When another printer is chosen in the print dialog the
/// margin is not calculated again for that printer's hardware margin; on every printer with a hardware margin ≤ 72 pt the centring stays symmetric.
pub const MARGIN_FLOOR: f64 = 72.0;

/// S9 root cause: AppKit places the page into the `paper − effective margin` rectangle; effective margin =
/// max(NSPrintInfo margin, the printer's hardware margin = outside `imageablePageBounds`). With margins 0 and centred the
/// page is centred in the printable area: when the hardware margins are asymmetric (A4 landscape without a printer: left
/// 18, right 41 pt) the content shifts by (left − right) / 2 = −11.5 pt (−4.06 mm). With four equal margins each larger
/// than every hardware margin the effective margins are equal and the centring is by the paper (shift 0); as the page is larger than the margin rectangle the content is not cropped.
///
/// `field` = (x, y, width, height) printable area (pt), paper `width × height`. When the area is invalid (not finite,
/// empty) only the floor is used. The returned value is written to all four margins.
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

/// With a page rotation (degrees) of 90/270 width and height swap.
pub fn rotated_size(width: f64, height: f64, rotation: i64) -> (f64, f64) {
    if rotation.rem_euclid(180) == 90 {
        (height, width)
    } else {
        (width, height)
    }
}

/// Body size limit (low 5): the same as opening a file (`files::MAX_FILE`, 1 GiB).
pub fn check_body_size(length: usize) -> Result<(), String> {
    if length as u64 > crate::files::MAX_FILE {
        return Err(text(
            "rust.file_large",
            &[("mb", &(length >> 20).to_string())],
        ));
    }
    Ok(())
}

/// Raw PDF body (borrowed without a copy; an error when empty or over the limit).
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

/// The folder of the outputs written for Preview (the app cache; inside the container in the sandbox).
pub const OUTPUT_FOLDER: &str = "output";
/// Preview outputs older than this are removed when a new output is written (Preview may be holding it: not removed at once).
pub const OUTPUT_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);

/// The minimum age for removing crash leftover `.temp` files (a fresh one may be being written now).
pub const TEMP_LEFTOVER_AGE: Duration = Duration::from_secs(10 * 60);

/// Preview folder clean-up (low 6): `.pdf` outputs older than `lifetime` and crash leftover `.temp`
/// files (the `write_atomic` pattern, older than `TEMP_LEFTOVER_AGE`). Returns: (pdfs removed, temps removed).
pub fn clear_cache(folder: &Path, now: SystemTime) -> (usize, usize) {
    (
        clear_old_outputs(folder, OUTPUT_LIFETIME, now),
        crate::recent::remove_leftover_temps(folder, TEMP_LEFTOVER_AGE),
    )
}

/// Cleans the Preview cache in the background at start-up (in the past only when writing a new output; `.temp` never).
pub fn clean_on_startup<R: Runtime>(app: &AppHandle<R>) {
    let Ok(d) = app.path().app_cache_dir() else {
        return;
    };
    let folder = d.join(OUTPUT_FOLDER);
    std::thread::spawn(move || {
        clear_cache(&folder, SystemTime::now());
    });
}

/// The longest wait for the print dialog result (low 4): when `didRun` does not come the command does not wait forever.
pub const PRINTING_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// Waits for the result from the channel for `duration` (the blocking wait on a separate thread). Returns: (result, timed out).
/// On timeout a "no answer" error, when the channel closed a "could not be set up" error.
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

/// Removes the `.pdf` files in the folder older than `lifetime`; the number removed.
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

/// Writes the Preview output: `<folder>/<safe name>.pdf` (overwritten when the same name exists). The written path.
pub fn write_output(folder: &Path, encoded_name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(folder)
        .map_err(|e| text("rust.writeFailed", &[("error", &e.to_string())]))?;
    clear_cache(folder, SystemTime::now());
    let path = folder.join(crate::files::safe_name(encoded_name, "pdf"));
    crate::recent::write_atomic(&path, bytes)
        .map_err(|e| text("rust.writeFailed", &[("error", &e.to_string())]))?;
    Ok(path)
}

/// Prints the imposed PDF (print dialog). The body is the raw PDF bytes, the `x-name` header the job name (encodeURIComponent).
/// `true`: the user printed (or saved as PDF); `false`: cancelled.
#[tauri::command]
pub async fn print<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    request: Request<'_>,
) -> Result<bool, String> {
    // One copy: the bytes move to the main thread; given to PDFKit without a copy (NSData::from_vec).
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

/// Writes the imposed PDF to the cache and opens it in Preview. The body is the raw PDF bytes, `x-name` the suggested name. The name of the opened file.
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
        // The body is written without a copy (low 5).
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
    //! macOS: PDFKit / AppKit calls. `NSPrintInfo` and `PDFDocument` can be set up on any thread (the unit tests test
    //! them without opening a print dialog); the print operation and the sheet on the main thread.
    use super::{print_settings, rotated_size, wait_result, PrintSettings, PRINTING_TIMEOUT};
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

    /// Scale mode: no scale is applied to the page ("Do not apply scaling to the page when printing").
    pub const SCALE_MODE: PDFPrintScalingMode = PDFPrintScalingMode::PageScaleNone;
    /// The bundle id of Preview.
    pub const PREVIEW: &str = "com.apple.Preview";

    /// A PDF document from raw bytes and the MediaBox size (pt) of the first page (rotation applied).
    pub fn open_pdf(bytes: Vec<u8>) -> Result<(Retained<PDFDocument>, f64, f64), String> {
        let data = NSData::from_vec(bytes); // without a copy (low 5)
        let document = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &data) }
            .ok_or_else(|| text("rust.pdf_unreadable", &[]))?;
        if unsafe { document.pageCount() } == 0 {
            return Err(text("rust.pdf_unreadable", &[]));
        }
        let page =
            unsafe { document.pageAtIndex(0) }.ok_or_else(|| text("rust.pdf_unreadable", &[]))?;
        let rect = unsafe { page.boundsForBox(PDFDisplayBox::MediaBox) };
        let (g, y) = rotated_size(
            rect.size.width,
            rect.size.height,
            unsafe { page.rotation() } as i64,
        );
        Ok((document, g, y))
    }

    /// `NSPrintInfo` setup: paper = page, orientation, scale 1, centred, pagination clips (does not scale); four equal
    /// margins larger than the hardware margins ([`symmetric_margin`]: with margin 0 an asymmetric hardware margin shifted the content, S9).
    /// First the orientation, then the paper size (AppKit may turn the paper when the orientation changes; the result is
    /// read in the test); the margin from the printable area of that paper once the paper is set up.
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

    /// Document + settings → PDFKit print operation (main thread). `None`: PDFKit could not set up an operation.
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

    /// Sends the result when the print sheet ends (`printOperationDidRun:success:contextInfo:`). The document and the
    /// operation are held here so that they do not drop while the sheet is open.
    pub struct Ivars {
        send: RefCell<Option<mpsc::Sender<PrintOutcome>>>,
        _document: RefCell<Option<Retained<PDFDocument>>>,
        _operation: RefCell<Option<Retained<NSPrintOperation>>>,
    }

    define_class!(
        // SAFETY: no subclass requirement for NSObject; Drop is not implemented.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "MucellitPrintDelegate"]
        #[ivars = Ivars]
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
        /// The delegate that passes the result to `send` (the document and the operation are held until the sheet closes).
        pub fn new_entry(
            mtm: MainThreadMarker,
            send: mpsc::Sender<PrintOutcome>,
            document: Option<Retained<PDFDocument>>,
            operation: Option<Retained<NSPrintOperation>>,
        ) -> Retained<Self> {
            let t = Self::alloc(mtm).set_ivars(Ivars {
                send: RefCell::new(Some(send)),
                _document: RefCell::new(document),
                _operation: RefCell::new(operation),
            });
            unsafe { msg_send![super(t), init] }
        }

        /// Is the print sheet open (the result not sent yet)?
        pub fn pending(&self) -> bool {
            self.ivars().send.borrow().is_some()
        }
    }

    thread_local! {
        /// The delegate of the open (or last) print sheet: AppKit does not hold the delegate; released when the result comes.
        static ENABLED: RefCell<Option<Retained<PrintDelegate>>> = const { RefCell::new(None) };
        /// Timed out delegates (low 4): the sheet may still be open and since AppKit does not hold the delegate it is not
        /// released (a late didRun must not reach a dangling pointer); lives for the whole process (only in an unusual case).
        static ORPHANS: RefCell<Vec<Retained<PrintDelegate>>> = const { RefCell::new(Vec::new()) };
    }

    pub(crate) fn page_open() -> bool {
        ENABLED.with(|e| e.borrow().as_ref().is_some_and(|t| t.pending()))
    }

    /// For the test: sets the open sheet delegate (`start` sets it in real use).
    #[cfg(test)]
    pub(crate) fn set_active(t: Retained<PrintDelegate>) {
        ENABLED.with(|e| *e.borrow_mut() = Some(t));
    }

    #[cfg(test)]
    pub(crate) fn orphan_count() -> usize {
        ORPHANS.with(|y| y.borrow().len())
    }

    /// Timeout (main thread): the result channel of the delegate is closed (the sheet does not count as "open", a new ⌘P
    /// can open; a late result is ignored), the delegate moves to the orphan list (not released).
    pub(crate) fn release_timeout() {
        ENABLED.with(|e| {
            if let Some(t) = e.borrow_mut().take() {
                t.ivars().send.borrow_mut().take();
                ORPHANS.with(|y| y.borrow_mut().push(t));
            }
        });
    }

    /// On the main thread: open the document, set up the settings, attach the print sheet to the window (modal when there is no window).
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
                let (document, g, y) = open_pdf(bytes)?;
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
                // No window (not expected): an app-modal print dialog; the result is ready on return.
                let _ = send.send(Ok(operation.runOperation()));
                drop(document);
            }
        }
    }

    /// Releases the delegate (document + operation) when the result comes; makes room for the next print.
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
            // Low 3: the NSWindow pointer is taken on the main thread and retained at once;
            // in the past it was taken on the calling thread and carried as a number (a dangling pointer if the window closed meanwhile).
            let p = window
                .ns_window()
                .ok()
                .and_then(|p| unsafe { Retained::retain(p.cast::<NSWindow>()) });
            start(mtm, p, bytes, name, send);
        })
        .map_err(|e| e.to_string())?;
        // Low 4: a timed wait; on timeout the open sheet record is cleared (ENABLED does not get stuck).
        let (result, timeout) = wait_result(al, PRINTING_TIMEOUT).await;
        let _ = if timeout {
            app.run_on_main_thread(release_timeout)
        } else {
            app.run_on_main_thread(release)
        };
        result
    }

    /// Starts opening in Preview (synchronous; the AppKit objects stay here); the result comes from the channel.
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

    /// Opens the file in Preview; an error when there is no Preview or it cannot open (the NSError text). An error when there is no answer in 30 s.
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

    /// Test PDF: one page with the given MediaBox and /Rotate (a correct xref).
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
            "A5 portrait"
        );
        // on small paper the floor is a quarter of the short edge (so that the margin rectangle is not empty)
        assert_eq!(print_settings(200.0, 100.0).unwrap().margin_floor, 25.0);
        for (g, y) in [
            (0.0, 10.0),
            (10.0, -1.0),
            (f64::NAN, 10.0),
            (10.0, f64::INFINITY),
        ] {
            assert!(print_settings(g, y).is_err(), "{g} × {y}");
        }
        assert_eq!(rotated_size(100.0, 200.0, 90), (200.0, 100.0));
        assert_eq!(rotated_size(100.0, 200.0, -90), (200.0, 100.0));
        assert_eq!(rotated_size(100.0, 200.0, 180), (100.0, 200.0));
        assert_eq!(rotated_size(100.0, 200.0, 270), (200.0, 100.0));
    }

    #[test]
    fn old_outputs_removed_new_ones_and_non_pdfs_stay() {
        let d = std::env::temp_dir().join(format!("mc-output-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        for a in ["old.pdf", "new.pdf", "not.txt"] {
            fs::write(d.join(a), b"x").unwrap();
        }
        fs::create_dir(d.join("folder.pdf")).unwrap();
        // "now" is 2 days later: all three files are old; only the .pdf file is removed (the folder and the .txt stay)
        let after = SystemTime::now() + Duration::from_secs(2 * 24 * 3600);
        assert_eq!(clear_old_outputs(&d, OUTPUT_LIFETIME, after), 2);
        assert!(d.join("not.txt").exists() && d.join("folder.pdf").is_dir());
        // the newly written one stays; the same name is overwritten; the name is safe (no path separator)
        let y = write_output(&d, "..%2Fbad%2Fname-fronts", b"%PDF-1").unwrap();
        assert_eq!(y.parent().unwrap(), d);
        assert_eq!(
            y.file_name().unwrap().to_string_lossy(),
            "-bad-name-fronts.pdf"
        );
        write_output(&d, "..%2Fbad%2Fname-fronts", b"%PDF-2").unwrap();
        assert_eq!(fs::read(&y).unwrap(), b"%PDF-2");
        assert_eq!(clear_old_outputs(&d, OUTPUT_LIFETIME, SystemTime::now()), 0);
        assert_eq!(
            clear_old_outputs(&d.join("none"), OUTPUT_LIFETIME, after),
            0
        );
        let _ = fs::remove_dir_all(&d);
    }

    /// S9 root cause: AppKit centres the page in the printable area; margin = the largest hardware margin (or the floor),
    /// the same on all four. With an asymmetric hardware margin (A4 landscape without a printer: left 18, right 41) the old margin 0 shifted by −11.5 pt.
    #[test]
    fn symmetric_margin_is_largest_hardware_margin_or_floor() {
        let (g, y) = (842.0, 595.0);
        // A4 landscape without a printer (observed): x 18, y 18, 783 × 559 → left 18, bottom 18, right 41, top 18
        assert_eq!(
            symmetric_margin(g, y, (18.0, 18.0, 783.0, 559.0), 0.0),
            41.0
        );
        assert_eq!(
            symmetric_margin(g, y, (18.0, 18.0, 783.0, 559.0), 72.0),
            72.0
        );
        // when a hardware margin is larger than the floor, the hardware one (top 100)
        assert_eq!(
            symmetric_margin(g, y, (10.0, 10.0, 822.0, 485.0), 72.0),
            100.0
        );
        // paper without margins (the 320 × 220 observation): the floor
        assert_eq!(
            symmetric_margin(907.09, 623.62, (0.0, 0.0, 907.09, 623.62), 72.0),
            72.0
        );
        // faulty area: NaN, infinite, empty, negative size → only the floor; floor NaN → 0 (the hardware still counts)
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
        // the old behaviour (margin 0) cannot pass this test: it does not return 0 on an asymmetric area
        assert_ne!(symmetric_margin(g, y, (18.0, 18.0, 783.0, 559.0), 0.0), 0.0);
    }

    /// O2: the Preview output is written with a long Turkish name (no name, the temp name included, passes 255 bytes; in
    /// the past `.<name>.<uuid>.temp` +45 bytes gave ENAMETOOLONG → Preview always fell back to option E).
    #[test]
    fn preview_written_with_long_turkish_name_temp_name_within_255_bytes() {
        let d = std::env::temp_dir().join(format!("mc-output-long-{}", uuid::Uuid::new_v4()));
        // "Uzun Türkçe kitap adı " ×20 = 440 characters / 500 bytes; in JS encodeURIComponent form (every byte %XX).  // turkish-ok: Turkish test text (a long Turkish name)
        // Observation: the APFS limit counts characters (only a name with multi-byte characters stayed at ~150 characters in 255 bytes and passed);
        // this name is 255 bytes ≈ 240 characters after safe_name, the temp name +45 → the limit was passed.
        let name: String = "Uzun Türkçe kitap adı ".repeat(20) + "-dizilmis.pdf"; // turkish-ok: Turkish test text (a long Turkish name)
        let encoded: String = name.bytes().map(|b| format!("%{b:02X}")).collect();
        for (n, b) in [(1, &b"%PDF-1"[..]), (2, &b"%PDF-2"[..])] {
            let y = write_output(&d, &encoded, b).unwrap_or_else(|e| panic!("write {n}: {e}"));
            let a = y.file_name().unwrap().to_string_lossy().into_owned();
            assert!(a.len() <= crate::files::NAME_MAX_BYTES, "{} bytes", a.len());
            assert!(a.ends_with(".pdf") && a.starts_with("Uzun Türkçe"), "{a}"); // turkish-ok: Turkish test text (a long Turkish name)
            assert_eq!(fs::read(&y).unwrap(), b);
        }
        let rest: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .map(|g| g.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(rest.len(), 1, "a temp file was left: {rest:?}");
        let _ = fs::remove_dir_all(&d);
    }

    /// NSPrintInfo setup (without opening a print dialog): paper = the MediaBox of the first page, symmetric margin,
    /// orientation, scale 1; scale mode PageScaleNone, automatic rotation off.
    #[cfg(target_os = "macos")]
    #[test]
    fn nsprintinfo_setup_paper_margins_orientation_scale() {
        use objc2_app_kit::{NSPaperOrientation, NSPrintingPaginationMode};
        use objc2_pdf_kit::PDFPrintScalingMode;
        // Acceptance tolerance ±0.5 mm. Observation (macOS 26.6.2): AppKit fits a size close to a standard paper to the printer's paper
        // (A4 841.89 × 595.28 → 842 × 595; A5 419.53 × 595.28 → 420 × 595; difference ≤ 0.17 mm), keeps a non-standard one as it is.
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
            (419.527_559, 595.275_591, 0, 419.527_559, 595.275_591, false), // A5 portrait
            (
                595.275_591,
                419.527_559,
                90,
                419.527_559,
                595.275_591,
                false,
            ), // rotated page
            (907.09, 623.62, 0, 907.09, 623.62, true), // 320 × 220 mm, non-standard
        ] {
            let (_document, pg, py) = mac::open_pdf(single_page_pdf(g, y, rotate)).unwrap();
            assert!(near(pg, expected_g) && near(py, expected_y), "{pg} × {py}");
            let a = print_settings(pg, py).unwrap();
            let info = mac::setup_print_info(&a);
            let k = info.paperSize();
            eprintln!("observation: requested {pg:.2} × {py:.2} pt → NSPrintInfo {} × {} pt, orientation {:?}, scale {}", k.width, k.height, info.orientation(), info.scalingFactor());
            assert!(
                near(k.width, expected_g) && near(k.height, expected_y),
                "paper {} × {} (expected {expected_g} × {expected_y})",
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
            // four equal margins, ≥ the floor and ≥ every hardware margin (S9: centred by the paper, no shift)
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
            eprintln!("observation: printable field {ib:?}, hardware margin {hardware:?}, margin {margins:?}");
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
        // broken / empty / pageless input
        for b in [&b""[..], b"this is not a pdf", b"%PDF-1.4\n%%EOF\n"] {
            assert!(mac::open_pdf(b.to_vec()).is_err());
        }
    }

    /// Print sheet delegate: the selector AppKit will call (`printOperationDidRun:success:contextInfo:`) is in the class;
    /// when called the result (printed/cancelled) is sent once, then the delegate counts as "done".
    #[cfg(target_os = "macos")]
    #[test]
    fn print_delegate_sends_selector_result_once() {
        use objc2::runtime::{AnyObject, Bool};
        use objc2::{msg_send, sel, MainThreadMarker};
        // SAFETY: only our own NSObject subclass is set up and called (no AppKit object); the main thread
        // requirement is for the AppKit objects. In real use the delegate is set up on the main thread.
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
            // a second call sends no new result
            let _: () = unsafe {
                msg_send![object, printOperationDidRun: operation, success: Bool::YES, contextInfo: blank]
            };
            assert!(al.try_recv().is_err());
        }
    }

    /// The body of `mac::print` (source check: the path that needs the main thread cannot be run in the test).
    fn mac_print_body() -> &'static str {
        let k = include_str!("print.rs");
        let head = k.find("    pub async fn print<R: Runtime>(").unwrap();
        &k[head..head + k[head..].find("\n    }\n").unwrap()]
    }

    /// Low 3: the NSWindow pointer is taken on the main thread (in the past it was taken on the calling thread and
    /// carried as a usize; a dangling pointer if the window closed meanwhile).
    #[test]
    fn window_pointer_taken_on_main_thread() {
        let g = mac_print_body();
        let main = g
            .find("run_on_main_thread(move ||")
            .expect("no run_on_main_thread");
        let ns = g.find("ns_window()").expect("no ns_window");
        assert!(
            ns > main,
            "ns_window() is called before the main thread closure"
        );
        assert!(!g.contains("as usize"), "the pointer is carried as a usize");
    }

    /// Low 4: no endless wait when `didRun` does not come (timeout) and the open sheet record (ENABLED) is cleared.
    #[test]
    fn print_result_awaited_with_timeout_in_source() {
        let g = mac_print_body();
        assert!(
            !g.contains("al.recv()"),
            "the result is awaited without a limit"
        );
        assert!(
            g.contains("wait_result(") && g.contains("release_timeout"),
            "{g}"
        );
    }

    /// Low 5: the body size is limited (the same limit as opening a file); Preview does not copy the body; the bytes go
    /// to PDFKit without a copy (NSData::from_vec).
    #[test]
    fn body_size_limited_and_no_needless_copy_in_source() {
        let k = include_str!("print.rs");
        let definition = &k[..k.find("#[cfg(test)]").unwrap()];
        assert!(definition.contains("MAX_FILE"), "no size limit");
        assert!(
            definition.contains("NSData::from_vec(") && !definition.contains("NSData::with_bytes("),
            "a copy to PDFKit"
        );
        let on = &definition[definition.find("pub async fn open_in_preview").unwrap()..];
        let on = &on[..on.find("\n}\n").unwrap()];
        assert!(
            definition
                .contains("fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String>")
                && !definition.contains("b.clone()"),
            "the body is taken with a copy"
        );
        assert!(
            !on.contains(".to_vec()") && !on.contains(".clone()"),
            "Preview copies the body"
        );
    }

    /// Low 4 (behaviour): a result within the time comes as it is; otherwise "no answer" + timeout; when the channel
    /// closed "could not be set up". On timeout the delegate moves to the orphans, the sheet does not count as open, a late result is ignored.
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
        // SAFETY: only our own NSObject subclass (see the print_delegate test).
        let mtm = unsafe { MainThreadMarker::new_unchecked() };
        let (send, al) = std::sync::mpsc::channel();
        let t = mac::PrintDelegate::new_entry(mtm, send, None, None);
        mac::set_active(t.clone());
        assert!(mac::page_open());
        let once = mac::orphan_count();
        mac::release_timeout();
        assert!(
            !mac::page_open(),
            "the sheet must not count as open after the timeout"
        );
        assert_eq!(
            mac::orphan_count(),
            once + 1,
            "the delegate must not be released (orphan)"
        );
        // a late didRun: no crash, no result sent
        let object: &AnyObject = &t;
        let blank: *mut std::ffi::c_void = std::ptr::null_mut();
        let operation: Option<&objc2_app_kit::NSPrintOperation> = None;
        let _: () = unsafe {
            msg_send![object, printOperationDidRun: operation, success: Bool::YES, contextInfo: blank]
        };
        assert!(al.try_recv().is_err());
    }

    /// Low 5 (behaviour): limit = the file open limit; a bigger body is rejected with a clear error.
    #[test]
    fn body_size_limit() {
        let limit = crate::files::MAX_FILE as usize;
        assert!(check_body_size(1).is_ok() && check_body_size(limit).is_ok());
        assert_eq!(
            check_body_size(limit + 1),
            Err(text("rust.file_large", &[("mb", "1024")]))
        );
    }

    /// Low 6 (behaviour): an old .pdf and an old crash leftover .temp are removed; a fresh .temp, a new .pdf and other files stay.
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
        write("old.pdf", Some(old));
        write("new.pdf", None);
        write(&format!(".old.pdf.{u}.temp"), Some(old));
        write(&format!(".fresh.pdf.{}.temp", uuid::Uuid::new_v4()), None);
        write("not.txt", Some(old));
        assert_eq!(clear_cache(&d, SystemTime::now()), (1, 1));
        let mut rest: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .map(|g| g.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        rest.sort();
        assert_eq!(rest.len(), 3, "{rest:?}");
        assert!(
            rest.iter().any(|a| a.starts_with(".fresh.pdf."))
                && rest.contains(&"new.pdf".into())
                && rest.contains(&"not.txt".into())
        );
        assert_eq!(clear_cache(&d.join("none"), SystemTime::now()), (0, 0));
        let _ = fs::remove_dir_all(&d);
    }

    /// Low 6: at start-up the Preview cache (old .pdf and crash leftover .temp) is cleaned.
    #[test]
    fn cache_cleanup_on_startup_is_wired_in_source() {
        let lib = include_str!("lib.rs");
        let setup = &lib[lib.find(".setup(|app|").unwrap()..];
        let setup = &setup[..setup.find("Ok(())").unwrap()];
        assert!(
            setup.contains("print::clean_on_startup(app.handle())"),
            "no clean-up at setup"
        );
    }

    /// The print operation is set up in PDFKit with PageScaleNone and automatic rotation off (source check: the call that
    /// needs the main thread cannot be run in the test).
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
