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
    println!("baski_pdf: yalnız macOS (atlandı)");
}

#[cfg(target_os = "macos")]
fn main() {
    std::process::exit(mac::calistir());
}

#[cfg(target_os = "macos")]
mod mac {
    use kitap_cilt_lib::print::{baski_ayari, mac as baski};
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob};
    use objc2_foundation::{NSPoint, NSURL};
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument, PDFPage};
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const MM: f64 = 72.0 / 25.4;
    const OLCU_TOL_MM: f64 = 0.5;
    const KAYMA_TOL_MM: f64 = 0.5;
    const OLCEK_TOL: f64 = 0.002;

    /// Metinli test PDF'i: her sayfada sol üstte "Mücellit <n>", sağ altta "SON" (Helvetica, gömülü değil).
    pub fn metinli_pdf(gen: f64, yuk: f64, sayfa: usize) -> Vec<u8> {
        let mut nesneler = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            String::new(), // sayfalar (çocuk listesi aşağıda)
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
                .to_string(),
        ];
        let mut cocuklar = Vec::new();
        for i in 0..sayfa {
            let akis = format!(
                "BT /F1 12 Tf {:.3} {:.3} Td (Mücellit {}) Tj ET\nBT /F1 12 Tf {:.3} {:.3} Td (SON) Tj ET\n",
                20.0 * MM,
                yuk - 20.0 * MM,
                i + 1,
                gen - 30.0 * MM,
                20.0 * MM
            );
            let sayfa_no = nesneler.len() + 1;
            nesneler.push(format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {gen} {yuk}] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>",
                sayfa_no + 1
            ));
            nesneler.push(format!(
                "<< /Length {} >>\nstream\n{akis}endstream",
                akis.len()
            ));
            cocuklar.push(format!("{sayfa_no} 0 R"));
        }
        nesneler[1] = format!(
            "<< /Type /Pages /Kids [{}] /Count {sayfa} >>",
            cocuklar.join(" ")
        );
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

    /// Uygulamanın baskı yolunu panelsiz, PDF'e kaydederek çalıştırır. Kâğıt ve yazdırılabilir alan döner.
    fn pdfe_bas(
        mtm: MainThreadMarker,
        bayt: &[u8],
        cikti: &Path,
    ) -> Result<(String, String), String> {
        let (belge, g, y) = baski::pdf_ac(bayt.to_vec())?;
        let a = baski_ayari(g, y)?;
        let info: Retained<NSPrintInfo> = baski::print_info_kur(&a);
        info.setJobDisposition(unsafe { NSPrintSaveJob });
        let url = NSURL::from_file_path(cikti).ok_or("çıktı adresi kurulamadı")?;
        unsafe {
            let sozluk = info.dictionary();
            let deger: &AnyObject = &url;
            sozluk.insert(NSPrintJobSavingURL, deger);
        }
        // Güvenlik: yalnız dosyaya kaydetme işi başlatılır.
        if info.jobDisposition().to_string() != unsafe { NSPrintSaveJob }.to_string() {
            return Err("iş NSPrintSaveJob değil: baskı başlatılmadı".into());
        }
        let k = info.paperSize();
        let ib = info.imageablePageBounds();
        let bilgi = format!(
            "NSPrintInfo kâğıt {:.2} × {:.2} pt, kenar sol {:.1} sağ {:.1} üst {:.1} alt {:.1}, ortalı {}/{}",
            k.width,
            k.height,
            info.leftMargin(),
            info.rightMargin(),
            info.topMargin(),
            info.bottomMargin(),
            info.isHorizontallyCentered(),
            info.isVerticallyCentered()
        );
        let alan = format!(
            "yazdırılabilir alan x {:.1} y {:.1} g {:.1} y {:.1} (donanım kenarı sol {:.1} sağ {:.1} alt {:.1} üst {:.1})",
            ib.origin.x,
            ib.origin.y,
            ib.size.width,
            ib.size.height,
            ib.origin.x,
            k.width - ib.origin.x - ib.size.width,
            ib.origin.y,
            k.height - ib.origin.y - ib.size.height
        );
        let islem =
            baski::baski_islemi(&belge, &info, &a, mtm).ok_or("PDFKit baskı işlemi kurulamadı")?;
        islem.setShowsPrintPanel(false);
        islem.setShowsProgressPanel(false);
        if !islem.runOperation() {
            return Err("runOperation false".into());
        }
        Ok((bilgi, alan))
    }

    fn olcu_mm(p: &PDFPage) -> (f64, f64) {
        let b = unsafe { p.boundsForBox(PDFDisplayBox::MediaBox) };
        let (g, y) = (b.size.width / MM, b.size.height / MM);
        if unsafe { p.rotation() }.rem_euclid(180) == 90 {
            (y, g)
        } else {
            (g, y)
        }
    }

    /// Sınır kutusu boş olmayan karakterlerin merkezleri (sayfa köşesine göre, pt), dizinle.
    fn karakterler(p: &PDFPage) -> (String, Vec<Option<NSPoint>>) {
        let metin = unsafe { p.string() }
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
        (metin, m)
    }

    fn belge_ac(yol: &Path) -> Result<Retained<PDFDocument>, String> {
        let bayt = std::fs::read(yol).map_err(|e| format!("{}: {e}", yol.display()))?;
        Ok(baski::pdf_ac(bayt)?.0)
    }

    /// Girdi ve çıktıyı karşılaştırır; satırlar ve geçti mi.
    pub fn karsilastir(girdi: &Path, cikti: &Path) -> Result<(Vec<String>, bool), String> {
        let (gb, cb) = (belge_ac(girdi)?, belge_ac(cikti)?);
        let (gn, cn) = unsafe { (gb.pageCount(), cb.pageCount()) };
        let mut satir = vec![format!("sayfa: girdi {gn}, çıktı {cn}")];
        let mut tamam = gn == cn;
        for i in 0..gn.min(cn) {
            let (gp, cp) = unsafe { (gb.pageAtIndex(i).unwrap(), cb.pageAtIndex(i).unwrap()) };
            let ((gg, gy), (cg, cy)) = (olcu_mm(&gp), olcu_mm(&cp));
            let iyi = (gg - cg).abs() <= OLCU_TOL_MM && (gy - cy).abs() <= OLCU_TOL_MM;
            tamam &= iyi;
            if i == 0 || !iyi {
                satir.push(format!(
                    "s.{}: girdi {gg:.2} × {gy:.2} mm, çıktı {cg:.2} × {cy:.2} mm → {}",
                    i + 1,
                    if iyi { "GEÇTİ (±0,5 mm)" } else { "KALDI" }
                ));
            }
        }
        let (gp, cp) = unsafe { (gb.pageAtIndex(0).unwrap(), cb.pageAtIndex(0).unwrap()) };
        let ((gm, gk), (cm, ck)) = (karakterler(&gp), karakterler(&cp));
        let sade = |s: &str| s.split_whitespace().collect::<String>();
        if sade(&gm).is_empty() || sade(&gm) != sade(&cm) || gk.len() != ck.len() {
            return Err(format!(
                "ölçek ölçülemedi: 1. sayfa metni farklı ya da yok ({gm:?} / {cm:?})"
            ));
        }
        let ortak: Vec<(NSPoint, NSPoint)> = gk
            .iter()
            .zip(ck.iter())
            .filter_map(|(a, b)| Some(((*a)?, (*b)?)))
            .collect();
        let (Some(ilk), Some(son)) = (ortak.first(), ortak.last()) else {
            return Err("ölçek ölçülemedi: ölçülebilir karakter yok".into());
        };
        let uzak = |a: NSPoint, b: NSPoint| (b.x - a.x).hypot(b.y - a.y);
        let (dg, dc) = (uzak(ilk.0, son.0), uzak(ilk.1, son.1));
        if dg < 10.0 * MM {
            return Err("ölçek ölçülemedi: metin çok dar".into());
        }
        let olcek = dc / dg;
        let kayma = ((ilk.1.x - ilk.0.x) / MM, (ilk.1.y - ilk.0.y) / MM);
        let olcek_iyi = (olcek - 1.0).abs() <= OLCEK_TOL;
        let kayma_iyi = kayma.0.abs() <= KAYMA_TOL_MM && kayma.1.abs() <= KAYMA_TOL_MM;
        satir.push(format!(
            "ölçek {olcek:.4} ({}), kayma {:.2} / {:.2} mm ({})",
            if olcek_iyi { "GEÇTİ ±%0,2" } else { "KALDI" },
            kayma.0,
            kayma.1,
            if kayma_iyi {
                "GEÇTİ ±0,5 mm"
            } else {
                "KALDI"
            }
        ));
        tamam &= olcek_iyi && kayma_iyi;
        Ok((satir, tamam))
    }

    fn klasor() -> PathBuf {
        std::env::var_os("KC_BASKI_KLASOR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("baski-pdf"))
    }

    /// Ölçücünün kendisi kusurlu girdiyle sınanır (aynı → geçer; kaymış, ölçekli, eksik sayfa, farklı boy → kalır;
    /// metinsiz/bozuk → ölçülemez). Ölçücü yanlışsa baskı ölçümüne güvenilmez.
    fn olcucu_sinamasi(d: &Path) -> Result<(), String> {
        let (g, y) = (297.0 * MM, 210.0 * MM);
        let yaz = |ad: &str, b: &[u8]| -> PathBuf {
            let p = d.join(ad);
            std::fs::write(&p, b).unwrap();
            p
        };
        let girdi = yaz("sina-girdi.pdf", &metinli_pdf(g, y, 2));
        let kaydir = |dx: f64, olcek: f64, gen: f64, yuk: f64, sayfa: usize| -> Vec<u8> {
            // aynı içerik, dönüşümlü (cm): önce ölçek, sonra öteleme
            let s = String::from_utf8(metinli_pdf(g, y, sayfa)).unwrap();
            let s = s.replace("BT /F1", &format!("q {olcek} 0 0 {olcek} {dx} 0 cm BT /F1"));
            let s = s.replace("Tj ET\n", "Tj ET Q\n");
            let s = s.replace(&format!("[0 0 {g} {y}]"), &format!("[0 0 {gen} {yuk}]"));
            // /Length ve xref eskidi: PDFKit onarır (sınama girdisi; ölçülen bayt değil)
            s.into_bytes()
        };
        let durumlar: Vec<(&str, Vec<u8>, Option<bool>)> = vec![
            ("aynı", metinli_pdf(g, y, 2), Some(true)),
            ("2 mm kaymış", kaydir(2.0 * MM, 1.0, g, y, 2), Some(false)),
            ("0,4 mm kaymış (sınır içi)", kaydir(0.4 * MM, 1.0, g, y, 2), Some(true)),
            ("%97 ölçek", kaydir(0.0, 0.97, g, y, 2), Some(false)),
            ("eksik sayfa", metinli_pdf(g, y, 1), Some(false)),
            ("297 × 212 mm", kaydir(0.0, 1.0, g, 212.0 * MM, 2), Some(false)),
            ("metinsiz", b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj 2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj 3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n".to_vec(), None),
            ("boş", Vec::new(), None),
            ("iskelet", b"%PDF-1.4\n%%EOF\n".to_vec(), None),
        ];
        for (ad, b, beklenen) in durumlar {
            let c = yaz("sina-cikti.pdf", &b);
            let sonuc = karsilastir(&girdi, &c).map(|(_, t)| t).ok();
            if sonuc != beklenen {
                return Err(format!(
                    "ölçücü sınaması: {ad} → {sonuc:?}, beklenen {beklenen:?}"
                ));
            }
            println!("ölçücü sınaması: {ad} → {sonuc:?} (beklenen)");
        }
        Ok(())
    }

    pub fn calistir() -> i32 {
        let Some(mtm) = MainThreadMarker::new() else {
            eprintln!("baski_pdf: ana iş parçacığında değil");
            return 1;
        };
        let d = klasor();
        std::fs::create_dir_all(&d).unwrap();
        if let Err(e) = olcucu_sinamasi(&d) {
            eprintln!("KALDI: {e}");
            return 1;
        }
        let olcek_araci = std::env::var_os("KC_PDF_OLCEK").map(PathBuf::from);
        let mut kalan = 0;
        let mut kagitlar: Vec<(String, Vec<u8>)> = [
            ("a4-yatay", 297.0 * MM, 210.0 * MM),
            ("a5-dikey", 148.0 * MM, 210.0 * MM),
            ("ozel-320x220", 320.0 * MM, 220.0 * MM),
        ]
        .into_iter()
        .map(|(ad, g, y)| (ad.to_string(), metinli_pdf(g, y, 3)))
        .collect();
        // İsteğe bağlı: uygulamanın ürettiği gerçek bir dizilmiş PDF (ör. elle S9 girdisi) aynı yoldan.
        if let Some(ek) = std::env::var_os("KC_BASKI_EK") {
            match std::fs::read(&ek) {
                Ok(b) => kagitlar.push(("ek".to_string(), b)),
                Err(e) => {
                    println!("KC_BASKI_EK okunamadı: {e}");
                    kalan += 1;
                }
            }
        }
        for (ad, bayt) in &kagitlar {
            let girdi = d.join(format!("{ad}-girdi.pdf"));
            let cikti = d.join(format!("{ad}-baski.pdf"));
            let _ = std::fs::remove_file(&cikti);
            std::fs::write(&girdi, bayt).unwrap();
            println!("== {ad}");
            let sonuc = pdfe_bas(mtm, bayt, &cikti).and_then(|(bilgi, alan)| {
                println!("{bilgi}\n{alan}");
                karsilastir(&girdi, &cikti)
            });
            match sonuc {
                Ok((satirlar, tamam)) => {
                    for s in satirlar {
                        println!("{s}");
                    }
                    println!("SONUÇ ({ad}): {}", if tamam { "GEÇTİ" } else { "KALDI" });
                    if !tamam {
                        kalan += 1;
                    }
                }
                Err(e) => {
                    println!("SONUÇ ({ad}): KALDI ({e})");
                    kalan += 1;
                }
            }
            if let Some(arac) = &olcek_araci {
                match Command::new(arac).arg(&girdi).arg(&cikti).output() {
                    Ok(o) => {
                        print!("pdf-olcek ({ad}):\n{}", String::from_utf8_lossy(&o.stdout));
                        if !o.status.success() {
                            kalan += 1;
                        }
                    }
                    Err(e) => {
                        println!("pdf-olcek çalıştırılamadı: {e}");
                        kalan += 1;
                    }
                }
            }
        }
        println!("girdi/çıktı: {}", d.display());
        if kalan == 0 {
            println!("baski_pdf: {} kâğıt GEÇTİ", kagitlar.len());
            0
        } else {
            println!("baski_pdf: {kalan} KALDI");
            1
        }
    }
}
