//! S9 ölçümü: uygulamanın gerçek baskı yolu (`pdf_ac` → `baski_ayari` → `print_info_kur` →
//! `baski_islemi`) panel göstermeden PDF'e "basılır" (`NSPrintSaveJob` + `NSPrintJobSavingURL`); çıktı girdiyle
//! karşılaştırılır: sayfa sayısı, her sayfanın ölçüsü ±0,5 mm, 1. sayfada ölçek (ilk–son karakter uzaklığı, ±%0,2) ve
//! kayma (ilk karakterin sayfa köşesine göre yeri, ±0,5 mm). Kâğıtlar: A4 yatay, A5 dikey, 320 × 220 mm (standart dışı).
//!
//! Bu Mac'te yazıcı olmasa da çalışır (AppKit'in "yazıcı yok" kâğıt biçimi; `imageablePageBounds` raporlanır).
//! Baskı işlemi ana iş parçacığı ister: test `harness = false` ile kendi `main`'inde koşar (Cargo.toml `[[test]]`).
//!
//! Ortam: `KC_BASKI_KLASOR` girdi/çıktı PDF'lerinin klasörü (öntanımlı `CARGO_TARGET_TMPDIR/baski-pdf`);
//! `KC_PDF_OLCEK` verilirse her çifti o araçla da ölçer (`pdf-olcek <girdi> <cikti>`, çıkış 0 = GEÇTİ) ve sonucu
//! testin sonucuna katar. Güvenlik: iş `NSPrintSaveJob` değilse baskı başlatılmaz (gerçek yazıcıya gitmesin).

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("printing_pdf: yalnız macOS (atlandı)");
}

#[cfg(target_os = "macos")]
fn main() {
    std::process::exit(mac::run());
}

#[cfg(target_os = "macos")]
mod mac {
    use mucellit_lib::print::{mac as printing, print_settings};
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob};
    use objc2_foundation::{NSPoint, NSURL};
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument, PDFPage};
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const MM: f64 = 72.0 / 25.4;
    const SIZE_TOL_MM: f64 = 0.5;
    const CREEP_TOL_MM: f64 = 0.5;
    const SCALE_TOL: f64 = 0.002;

    /// Metinli test PDF'i: her sayfada sol üstte "Mücellit <n>", sağ altta "SON" (Helvetica, gömülü değil).
    pub fn with_text_pdf(width: f64, height: f64, page: usize) -> Vec<u8> {
        let mut objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            String::new(), // sayfalar (çocuk listesi aşağıda)
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
                .to_string(),
        ];
        let mut children = Vec::new();
        for i in 0..page {
            let flow = format!(
                "BT /F1 12 Tf {:.3} {:.3} Td (Mücellit {}) Tj ET\nBT /F1 12 Tf {:.3} {:.3} Td (LAST) Tj ET\n",
                20.0 * MM,
                height - 20.0 * MM,
                i + 1,
                width - 30.0 * MM,
                20.0 * MM
            );
            let page_no = objects.len() + 1;
            objects.push(format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>",
                page_no + 1
            ));
            objects.push(format!(
                "<< /Length {} >>\nstream\n{flow}endstream",
                flow.len()
            ));
            children.push(format!("{page_no} 0 R"));
        }
        objects[1] = format!(
            "<< /Type /Pages /Kids [{}] /Count {page} >>",
            children.join(" ")
        );
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

    /// Uygulamanın baskı yolunu panelsiz, PDF'e kaydederek çalıştırır. Kâğıt ve yazdırılabilir alan döner.
    fn print_to_pdf(
        mtm: MainThreadMarker,
        bytes: &[u8],
        output: &Path,
    ) -> Result<(String, String), String> {
        let (document, g, y) = printing::pdf_ac(bytes.to_vec())?;
        let a = print_settings(g, y)?;
        let info: Retained<NSPrintInfo> = printing::setup_print_info(&a);
        info.setJobDisposition(unsafe { NSPrintSaveJob });
        let url = NSURL::from_file_path(output).ok_or("çıktı adresi kurulamadı")?;
        unsafe {
            let dictionary = info.dictionary();
            let value: &AnyObject = &url;
            dictionary.insert(NSPrintJobSavingURL, value);
        }
        // Güvenlik: yalnız dosyaya kaydetme işi başlatılır.
        if info.jobDisposition().to_string() != unsafe { NSPrintSaveJob }.to_string() {
            return Err("iş NSPrintSaveJob değil: baskı başlatılmadı".into());
        }
        let k = info.paperSize();
        let ib = info.imageablePageBounds();
        let info_text = format!(
            "NSPrintInfo kâğıt {:.2} × {:.2} pt, margin left {:.1} sağ {:.1} üst {:.1} alt {:.1}, ortalı {}/{}",
            k.width,
            k.height,
            info.leftMargin(),
            info.rightMargin(),
            info.topMargin(),
            info.bottomMargin(),
            info.isHorizontallyCentered(),
            info.isVerticallyCentered()
        );
        let field = format!(
            "yazdırılabilir field x {:.1} y {:.1} g {:.1} y {:.1} (donanım kenarı left {:.1} sağ {:.1} alt {:.1} üst {:.1})",
            ib.origin.x,
            ib.origin.y,
            ib.size.width,
            ib.size.height,
            ib.origin.x,
            k.width - ib.origin.x - ib.size.width,
            ib.origin.y,
            k.height - ib.origin.y - ib.size.height
        );
        let operation = printing::print_operation(&document, &info, &a, mtm)
            .ok_or("PDFKit baskı işlemi kurulamadı")?;
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        if !operation.runOperation() {
            return Err("runOperation false".into());
        }
        Ok((info_text, field))
    }

    fn size_mm(p: &PDFPage) -> (f64, f64) {
        let b = unsafe { p.boundsForBox(PDFDisplayBox::MediaBox) };
        let (g, y) = (b.size.width / MM, b.size.height / MM);
        if unsafe { p.rotation() }.rem_euclid(180) == 90 {
            (y, g)
        } else {
            (g, y)
        }
    }

    /// Sınır kutusu boş olmayan karakterlerin merkezleri (sayfa köşesine göre, pt), dizinle.
    fn chars(p: &PDFPage) -> (String, Vec<Option<NSPoint>>) {
        let text = unsafe { p.string() }
            .map(|s| s.to_string())
            .unwrap_or_default();
        let n = unsafe { p.string() }.map(|s| s.length()).unwrap_or(0);
        let k = unsafe { p.boundsForBox(PDFDisplayBox::MediaBox) }.origin;
        let m = (0..n)
            .map(|i| {
                let b = unsafe { p.characterBoundsAtIndex(i as isize) };
                (b.size.width > 0.0 && b.size.height > 0.0).then(|| {
                    NSPoint::new(
                        b.origin.x + b.size.width / 2.0 - k.x,
                        b.origin.y + b.size.height / 2.0 - k.y,
                    )
                })
            })
            .collect();
        (text, m)
    }

    fn open_document(path: &Path) -> Result<Retained<PDFDocument>, String> {
        let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(printing::pdf_ac(bytes)?.0)
    }

    /// Girdi ve çıktıyı karşılaştırır; satırlar ve geçti mi.
    pub fn compare(input: &Path, output: &Path) -> Result<(Vec<String>, bool), String> {
        let (gb, cb) = (open_document(input)?, open_document(output)?);
        let (gn, cn) = unsafe { (gb.pageCount(), cb.pageCount()) };
        let mut line = vec![format!("sayfa: girdi {gn}, çıktı {cn}")];
        let mut done = gn == cn;
        for i in 0..gn.min(cn) {
            let (gp, cp) = unsafe { (gb.pageAtIndex(i).unwrap(), cb.pageAtIndex(i).unwrap()) };
            let ((gg, gy), (cg, cy)) = (size_mm(&gp), size_mm(&cp));
            let good = (gg - cg).abs() <= SIZE_TOL_MM && (gy - cy).abs() <= SIZE_TOL_MM;
            done &= good;
            if i == 0 || !good {
                line.push(format!(
                    "s.{}: input {gg:.2} × {gy:.2} mm, çıktı {cg:.2} × {cy:.2} mm → {}",
                    i + 1,
                    if good { "GEÇTİ (±0,5 mm)" } else { "FAIL" }
                ));
            }
        }
        let (gp, cp) = unsafe { (gb.pageAtIndex(0).unwrap(), cb.pageAtIndex(0).unwrap()) };
        let ((gm, gk), (cm, ck)) = (chars(&gp), chars(&cp));
        let plain = |s: &str| s.split_whitespace().collect::<String>();
        if plain(&gm).is_empty() || plain(&gm) != plain(&cm) || gk.len() != ck.len() {
            return Err(format!(
                "ölçek ölçülemedi: 1. page text farklı ya da none ({gm:?} / {cm:?})"
            ));
        }
        let common: Vec<(NSPoint, NSPoint)> = gk
            .iter()
            .zip(ck.iter())
            .filter_map(|(a, b)| Some(((*a)?, (*b)?)))
            .collect();
        let (Some(first), Some(last)) = (common.first(), common.last()) else {
            return Err("ölçek ölçülemedi: ölçülebilir karakter yok".into());
        };
        let far = |a: NSPoint, b: NSPoint| (b.x - a.x).hypot(b.y - a.y);
        let (dg, dc) = (far(first.0, last.0), far(first.1, last.1));
        if dg < 10.0 * MM {
            return Err("ölçek ölçülemedi: metin çok dar".into());
        }
        let scaling = dc / dg;
        let creep = ((first.1.x - first.0.x) / MM, (first.1.y - first.0.y) / MM);
        let scale_good = (scaling - 1.0).abs() <= SCALE_TOL;
        let creep_good = creep.0.abs() <= CREEP_TOL_MM && creep.1.abs() <= CREEP_TOL_MM;
        line.push(format!(
            "ölçek {scaling:.4} ({}), creep {:.2} / {:.2} mm ({})",
            if scale_good { "GEÇTİ ±%0,2" } else { "FAIL" },
            creep.0,
            creep.1,
            if creep_good {
                "GEÇTİ ±0,5 mm"
            } else {
                "FAIL"
            }
        ));
        done &= scale_good && creep_good;
        Ok((line, done))
    }

    fn folder() -> PathBuf {
        std::env::var_os("MC_PRINT_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("printing-pdf"))
    }

    /// Ölçücünün kendisi kusurlu girdiyle sınanır (aynı → geçer; kaymış, ölçekli, eksik sayfa, farklı boy → kalır;
    /// metinsiz/bozuk → ölçülemez). Ölçücü yanlışsa baskı ölçümüne güvenilmez.
    fn measurer_test(d: &Path) -> Result<(), String> {
        let (g, y) = (297.0 * MM, 210.0 * MM);
        let write = |name: &str, b: &[u8]| -> PathBuf {
            let p = d.join(name);
            std::fs::write(&p, b).unwrap();
            p
        };
        let input = write("sina-girdi.pdf", &with_text_pdf(g, y, 2));
        let shift = |dx: f64, scaling: f64, width: f64, height: f64, page: usize| -> Vec<u8> {
            // aynı içerik, dönüşümlü (cm): önce ölçek, sonra öteleme
            let s = String::from_utf8(with_text_pdf(g, y, page)).unwrap();
            let s = s.replace(
                "BT /F1",
                &format!("q {scaling} 0 0 {scaling} {dx} 0 cm BT /F1"),
            );
            let s = s.replace("Tj ET\n", "Tj ET Q\n");
            let s = s.replace(
                &format!("[0 0 {g} {y}]"),
                &format!("[0 0 {width} {height}]"),
            );
            // /Length ve xref eskidi: PDFKit onarır (sınama girdisi; ölçülen bayt değil)
            s.into_bytes()
        };
        let states: Vec<(&str, Vec<u8>, Option<bool>)> = vec![
            ("aynı", with_text_pdf(g, y, 2), Some(true)),
            ("2 mm kaymış", shift(2.0 * MM, 1.0, g, y, 2), Some(false)),
            ("0,4 mm kaymış (sınır içi)", shift(0.4 * MM, 1.0, g, y, 2), Some(true)),
            ("%97 ölçek", shift(0.0, 0.97, g, y, 2), Some(false)),
            ("missing page", with_text_pdf(g, y, 1), Some(false)),
            ("297 × 212 mm", shift(0.0, 1.0, g, 212.0 * MM, 2), Some(false)),
            ("withoutText", b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj 2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj 3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n".to_vec(), None),
            ("boş", Vec::new(), None),
            ("skeleton", b"%PDF-1.4\n%%EOF\n".to_vec(), None),
        ];
        for (name, b, expected) in states {
            let c = write("sina-cikti.pdf", &b);
            let result = compare(&input, &c).map(|(_, t)| t).ok();
            if result != expected {
                return Err(format!(
                    "ölçücü sınaması: {name} → {result:?}, expected {expected:?}"
                ));
            }
            println!("ölçücü sınaması: {name} → {result:?} (expected)");
        }
        Ok(())
    }

    pub fn run() -> i32 {
        let Some(mtm) = MainThreadMarker::new() else {
            eprintln!("printing_pdf: ana iş parçacığında değil");
            return 1;
        };
        let d = folder();
        std::fs::create_dir_all(&d).unwrap();
        if let Err(e) = measurer_test(&d) {
            eprintln!("FAIL: {e}");
            return 1;
        }
        let scale_tool = std::env::var_os("MC_PDF_MEASURE").map(PathBuf::from);
        let mut rest = 0;
        let mut papers: Vec<(String, Vec<u8>)> = [
            ("a4-landscape", 297.0 * MM, 210.0 * MM),
            ("a5-portrait", 148.0 * MM, 210.0 * MM),
            ("custom-320x220", 320.0 * MM, 220.0 * MM),
        ]
        .into_iter()
        .map(|(name, g, y)| (name.to_string(), with_text_pdf(g, y, 3)))
        .collect();
        // İsteğe bağlı: uygulamanın ürettiği gerçek bir dizilmiş PDF (ör. elle S9 girdisi) aynı yoldan.
        if let Some(ek) = std::env::var_os("MC_PRINT_EXTRA") {
            match std::fs::read(&ek) {
                Ok(b) => papers.push(("ek".to_string(), b)),
                Err(e) => {
                    println!("MC_PRINT_EXTRA okunamadı: {e}");
                    rest += 1;
                }
            }
        }
        for (name, bytes) in &papers {
            let input = d.join(format!("{name}-girdi.pdf"));
            let output = d.join(format!("{name}-baski.pdf"));
            let _ = std::fs::remove_file(&output);
            std::fs::write(&input, bytes).unwrap();
            println!("== {name}");
            let result = print_to_pdf(mtm, bytes, &output).and_then(|(info_text, field)| {
                println!("{info_text}\n{field}");
                compare(&input, &output)
            });
            match result {
                Ok((rows, done)) => {
                    for s in rows {
                        println!("{s}");
                    }
                    println!("SONUÇ ({name}): {}", if done { "GEÇTİ" } else { "FAIL" });
                    if !done {
                        rest += 1;
                    }
                }
                Err(e) => {
                    println!("SONUÇ ({name}): FAIL ({e})");
                    rest += 1;
                }
            }
            if let Some(tool) = &scale_tool {
                match Command::new(tool).arg(&input).arg(&output).output() {
                    Ok(o) => {
                        print!(
                            "pdf-scaling ({name}):\n{}",
                            String::from_utf8_lossy(&o.stdout)
                        );
                        if !o.status.success() {
                            rest += 1;
                        }
                    }
                    Err(e) => {
                        println!("pdf-scaling çalıştırılamadı: {e}");
                        rest += 1;
                    }
                }
            }
        }
        println!("girdi/çıktı: {}", d.display());
        if rest == 0 {
            println!("printing_pdf: {} kâğıt GEÇTİ", papers.len());
            0
        } else {
            println!("printing_pdf: {rest} FAIL");
            1
        }
    }
}
