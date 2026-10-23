//! Klasör paketi EPUB → bellekte EPUB (ZIP) baytı.
//!
//! Apple Books / iCloud Kitaplar EPUB'ları diskte **klasör paketi** olarak saklar (`stat`: Directory;
//! içinde `mimetype`, `META-INF/`, `OEBPS/`; tür `com.apple.ibooks.epub`, `com.apple.package`'a uyar).
//! Yerel Aç penceresi bunu tek dosya gibi seçtirir ama okunacak bir ZIP yoktur. Bu modül klasörü okuyup
//! web tarafının bugünkü EPUB okuyucusunun (app/js/plugins/epub/zip.js) açtığı bir ZIP üretir; böylece
//! JS tarafı klasör paketini sıradan bir `.epub` dosyası olarak alır ve değişmez.
//!
//! Biçim (EPUB OCF): `mimetype` ilk girdi ve sıkıştırmasız (STORED), ekstra alan yok. Diğer girdiler de
//! STORED (bağımlılık yok; okuyucu yöntem 0'ı destekliyor). Adlar `/` ayraçlı, UTF-8 bayrağı (bit 11) açık,
//! sıra belirlenimci (adına göre). ZIP64 yok: 65 535 girdi ve 4 GiB üstü reddedilir.
//! Atlananlar: gizli dosyalar (`.DS_Store` vb.), `__MACOSX/`, sembolik bağlar (paket dışına işaret
//! edebilir; sandbox zaten engeller).

use crate::i18n::metin;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

/// Üretilecek ZIP'in üst sınırı (bellek). EPUB'lar pratikte birkaç yüz MB'ı geçmez.
pub const EN_COK_TOPLAM: u64 = 1 << 30;
const EN_COK_GIRDI: usize = 65_535;
const MIMETYPE: &str = "mimetype";

/// Klasör bir EPUB paketi mi (EPUB'ın zorunlu kapsayıcı dosyası var mı)?
pub fn epub_klasoru_mu(yol: &Path) -> bool {
    yol.is_dir() && yol.join("META-INF").join("container.xml").is_file()
}

/// Kayıtlı bir klasör paketinin durumu: `Degil` yalnız klasörün içi okunabildiği halde EPUB
/// kapsayıcısı yoksa. İçi okunamıyorsa (izinsiz `META-INF`, iCloud'dan henüz inmemiş/dataless ya da boş
/// klasör) `Okunamadi`: kayıt silinmemeli, sonra yeniden denenebilir.
#[derive(Debug)]
pub enum PaketDurumu {
    Paket,
    Degil,
    Okunamadi(io::Error),
}

pub fn paket_durumu(yol: &Path) -> PaketDurumu {
    match fs::metadata(yol.join("META-INF").join("container.xml")) {
        Ok(m) if m.is_file() => PaketDurumu::Paket,
        Ok(_) => PaketDurumu::Degil,
        Err(e) if e.kind() == io::ErrorKind::NotFound => match fs::read_dir(yol) {
            Err(e) => PaketDurumu::Okunamadi(e),
            Ok(mut ic) => {
                if ic.next().is_none() {
                    return PaketDurumu::Okunamadi(io::Error::other(metin("rust.paket_bos", &[])));
                }
                match fs::read_dir(yol.join("META-INF")) {
                    Err(e) if e.kind() != io::ErrorKind::NotFound => PaketDurumu::Okunamadi(e),
                    _ => PaketDurumu::Degil,
                }
            }
        },
        Err(e) => PaketDurumu::Okunamadi(e),
    }
}

/// Okuma sınırları (testte küçültülür).
#[derive(Debug, Clone, Copy)]
pub struct Sinir {
    /// Üretilecek ZIP'in yaklaşık üst sınırı (bayt).
    pub toplam: u64,
    /// En çok dosya (ZIP girdisi).
    pub girdi: usize,
}

/// Uygulamanın kullandığı sınırlar.
pub const SINIR: Sinir = Sinir {
    toplam: EN_COK_TOPLAM,
    girdi: EN_COK_GIRDI,
};

/// Klasör paketinden EPUB ZIP baytı üretir.
pub fn zip_uret(kok: &Path) -> io::Result<Vec<u8>> {
    zip_uret_sinirli(kok, SINIR)
}

/// `zip_uret`, verilen sınırlarla.
pub fn zip_uret_sinirli(kok: &Path, sinir: Sinir) -> io::Result<Vec<u8>> {
    if !kok.is_dir() {
        return Err(hata(metin(
            "rust.klasor_degil",
            &[("yol", &kok.display().to_string())],
        )));
    }
    if !epub_klasoru_mu(kok) {
        return Err(hata(metin("rust.kapsayici_yok", &[])));
    }
    // O1: dosya sayısı ve toplam boyut TARAMA sırasında (`metadata` ile, okumadan) denetlenir; sınırı aşan
    // paket hiçbir dosyası okunmadan reddedilir, bellek şişmez.
    let mut t = Toplayici {
        sinir,
        dosyalar: Vec::new(),
        toplam: 0,
    };
    t.topla(kok, kok)?;
    let mut dosyalar = t.dosyalar;
    // mimetype önce (OCF şartı), sonra adına göre.
    dosyalar.sort_by(|a, b| (a.0 != MIMETYPE, &a.0).cmp(&(b.0 != MIMETYPE, &b.0)));
    let mut yazici = ZipYazici::default();
    let mut toplam: u64 = 0;
    for (ad, yol) in &dosyalar {
        // Tarama ile okuma arasında büyüyen dosya da sınırı aşamaz: en çok kalan pay + 1 bayt okunur.
        let pay = sinir.toplam.saturating_sub(toplam);
        let mut veri = Vec::new();
        fs::File::open(yol)?.take(pay + 1).read_to_end(&mut veri)?;
        toplam += ek_boyut(ad, veri.len() as u64);
        if toplam > sinir.toplam {
            return Err(cok_buyuk(sinir));
        }
        yazici.ekle(ad, &veri)?;
    }
    yazici.bitir()
}

/// Bir girdinin ZIP'te kapladığı yaklaşık yer (içerik + başlıklar + ad iki kez).
fn ek_boyut(ad: &str, icerik: u64) -> u64 {
    icerik + 128 + ad.len() as u64 * 2
}

fn cok_buyuk(sinir: Sinir) -> io::Error {
    hata(metin(
        "rust.paket_buyuk",
        &[("mb", &(sinir.toplam >> 20).to_string())],
    ))
}

fn hata(m: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, m)
}

/// Tarama durumu: toplanan dosyalar ve `metadata` ile toplanan boyut.
struct Toplayici {
    sinir: Sinir,
    dosyalar: Vec<(String, PathBuf)>,
    toplam: u64,
}

impl Toplayici {
    /// `kok` altındaki düzenli dosyaları (ZIP adı, yol) olarak toplar; sınır aşılınca hemen durur. Klasör
    /// girdileri adına göre sıralı gezilir (belirlenimci: sınır hep aynı noktada aşılır).
    fn topla(&mut self, kok: &Path, klasor: &Path) -> io::Result<()> {
        let mut girdiler = fs::read_dir(klasor)?.collect::<io::Result<Vec<_>>>()?;
        girdiler.sort_by_key(|g| g.file_name());
        for girdi in girdiler {
            let ad = girdi.file_name();
            let ad = ad.to_string_lossy();
            if ad.starts_with('.') || ad == "__MACOSX" {
                continue;
            }
            let tur = girdi.file_type()?; // bağı izlemez
            let yol = girdi.path();
            if tur.is_symlink() {
                continue;
            }
            if tur.is_dir() {
                self.topla(kok, &yol)?;
            } else if tur.is_file() {
                if self.dosyalar.len() >= self.sinir.girdi {
                    return Err(hata(metin(
                        "rust.cok_dosya_sinirli",
                        &[("n", &self.sinir.girdi.to_string())],
                    )));
                }
                let goreli = yol
                    .strip_prefix(kok)
                    .map_err(|_| hata(metin("rust.yol_disarida", &[])))?;
                let parcalar: Vec<String> = goreli
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect();
                let zip_adi = parcalar.join("/");
                self.toplam += ek_boyut(&zip_adi, girdi.metadata()?.len());
                if self.toplam > self.sinir.toplam {
                    return Err(cok_buyuk(self.sinir));
                }
                self.dosyalar.push((zip_adi, yol));
            }
        }
        Ok(())
    }
}

/// En küçük STORED ZIP yazıcısı.
#[derive(Default)]
struct ZipYazici {
    veri: Vec<u8>,
    merkez: Vec<u8>,
    adet: usize,
}

impl ZipYazici {
    fn ekle(&mut self, ad: &str, icerik: &[u8]) -> io::Result<()> {
        let boyut = u32::try_from(icerik.len())
            .map_err(|_| hata(metin("rust.girdi_buyuk", &[("ad", ad)])))?;
        let ofset =
            u32::try_from(self.veri.len()).map_err(|_| hata(metin("rust.zip_4gib", &[])))?;
        let ad_b = ad.as_bytes();
        let ad_uz =
            u16::try_from(ad_b.len()).map_err(|_| hata(metin("rust.ad_uzun", &[("ad", ad)])))?;
        let crc = crc32(icerik);
        const BAYRAK: u16 = 0x0800; // UTF-8 ad
        const SAAT: u16 = 0; // 00:00:00
        const TARIH: u16 = (1 << 5) | 1; // 1980-01-01 (belirlenimci çıktı)

        let v = &mut self.veri;
        v.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        v.extend_from_slice(&20u16.to_le_bytes()); // gereken sürüm
        v.extend_from_slice(&BAYRAK.to_le_bytes());
        v.extend_from_slice(&0u16.to_le_bytes()); // yöntem: STORED
        v.extend_from_slice(&SAAT.to_le_bytes());
        v.extend_from_slice(&TARIH.to_le_bytes());
        v.extend_from_slice(&crc.to_le_bytes());
        v.extend_from_slice(&boyut.to_le_bytes()); // sıkışık
        v.extend_from_slice(&boyut.to_le_bytes()); // açık
        v.extend_from_slice(&ad_uz.to_le_bytes());
        v.extend_from_slice(&0u16.to_le_bytes()); // ekstra alan yok (mimetype için şart)
        v.extend_from_slice(ad_b);
        v.extend_from_slice(icerik);

        let m = &mut self.merkez;
        m.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        m.extend_from_slice(&20u16.to_le_bytes()); // yapan sürüm
        m.extend_from_slice(&20u16.to_le_bytes()); // gereken sürüm
        m.extend_from_slice(&BAYRAK.to_le_bytes());
        m.extend_from_slice(&0u16.to_le_bytes());
        m.extend_from_slice(&SAAT.to_le_bytes());
        m.extend_from_slice(&TARIH.to_le_bytes());
        m.extend_from_slice(&crc.to_le_bytes());
        m.extend_from_slice(&boyut.to_le_bytes());
        m.extend_from_slice(&boyut.to_le_bytes());
        m.extend_from_slice(&ad_uz.to_le_bytes());
        m.extend_from_slice(&0u16.to_le_bytes()); // ekstra
        m.extend_from_slice(&0u16.to_le_bytes()); // yorum
        m.extend_from_slice(&0u16.to_le_bytes()); // disk
        m.extend_from_slice(&0u16.to_le_bytes()); // iç öznitelik
        m.extend_from_slice(&0u32.to_le_bytes()); // dış öznitelik
        m.extend_from_slice(&ofset.to_le_bytes());
        m.extend_from_slice(ad_b);
        self.adet += 1;
        Ok(())
    }

    fn bitir(mut self) -> io::Result<Vec<u8>> {
        let cd_ofset =
            u32::try_from(self.veri.len()).map_err(|_| hata(metin("rust.zip_4gib", &[])))?;
        let cd_boyut =
            u32::try_from(self.merkez.len()).map_err(|_| hata(metin("rust.zip_4gib", &[])))?;
        let adet = u16::try_from(self.adet).map_err(|_| hata(metin("rust.cok_dosya", &[])))?;
        u32::try_from(self.veri.len() + self.merkez.len() + 22)
            .map_err(|_| hata(metin("rust.zip_4gib", &[])))?;
        self.veri.extend_from_slice(&self.merkez);
        let v = &mut self.veri;
        v.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        v.extend_from_slice(&0u16.to_le_bytes()); // disk
        v.extend_from_slice(&0u16.to_le_bytes()); // CD diski
        v.extend_from_slice(&adet.to_le_bytes());
        v.extend_from_slice(&adet.to_le_bytes());
        v.extend_from_slice(&cd_boyut.to_le_bytes());
        v.extend_from_slice(&cd_ofset.to_le_bytes());
        v.extend_from_slice(&0u16.to_le_bytes()); // yorum
        Ok(self.veri)
    }
}

/// CRC-32 (IEEE, ZIP'in kullandığı), tablosuz.
pub fn crc32(veri: &[u8]) -> u32 {
    let mut c: u32 = 0xffff_ffff;
    for &b in veri {
        c ^= u32::from(b);
        for _ in 0..8 {
            c = if c & 1 != 0 {
                0xedb8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
        }
    }
    !c
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::i18n::kalip;

    /// Testte üretilen ZIP'i okuyan küçük çözümleyici: (ad, yöntem, ekstra uzunluğu, içerik) yerel başlık
    /// sırasıyla; merkezi dizinle tutarlılık ve CRC da denetlenir.
    fn coz(z: &[u8]) -> Vec<(String, u16, u16, Vec<u8>)> {
        let u16_ = |o: usize| u16::from_le_bytes([z[o], z[o + 1]]);
        let u32_ = |o: usize| u32::from_le_bytes([z[o], z[o + 1], z[o + 2], z[o + 3]]);
        let eocd = z.len() - 22;
        assert_eq!(u32_(eocd), 0x0605_4b50, "EOCD");
        let adet = u16_(eocd + 10) as usize;
        let cd = u32_(eocd + 16) as usize;
        let mut sonuc = Vec::new();
        let mut p = cd;
        for _ in 0..adet {
            assert_eq!(u32_(p), 0x0201_4b50, "merkezi dizin imzası");
            let crc = u32_(p + 16);
            let boyut = u32_(p + 24) as usize;
            let ad_uz = u16_(p + 28) as usize;
            let ofset = u32_(p + 42) as usize;
            let ad = String::from_utf8(z[p + 46..p + 46 + ad_uz].to_vec()).unwrap();
            assert_eq!(u32_(ofset), 0x0403_4b50, "yerel başlık imzası");
            assert_eq!(u16_(ofset + 6) & 0x0800, 0x0800, "UTF-8 bayrağı");
            let yontem = u16_(ofset + 8);
            let ekstra = u16_(ofset + 28);
            let bas = ofset + 30 + u16_(ofset + 26) as usize + ekstra as usize;
            let icerik = z[bas..bas + boyut].to_vec();
            assert_eq!(crc32(&icerik), crc, "CRC {ad}");
            sonuc.push((ad, yontem, ekstra, icerik));
            p += 46 + ad_uz;
        }
        sonuc
    }

    fn fixture() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../app/test/fixtures/folder-package.epub")
    }

    #[test]
    fn crc32_bilinen_degerler() {
        assert_eq!(crc32(b""), 0);
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
        assert_eq!(crc32(b"application/epub+zip"), 0x2cab_616f);
    }

    #[test]
    fn repo_fixture_klasor_paketinden_zip_mimetype_ilk_ve_sikistirmasiz() {
        let kok = fixture();
        assert!(
            epub_klasoru_mu(&kok),
            "fixture EPUB paketi olmalı: {}",
            kok.display()
        );
        let z = zip_uret(&kok).expect("zip");
        // ilk 38 bayt: yerel başlık + "mimetype" adı + içerik başı (OCF'nin sihirli ofseti)
        assert_eq!(&z[0..4], b"PK\x03\x04");
        assert_eq!(&z[30..38], b"mimetype");
        assert_eq!(&z[38..58], b"application/epub+zip");
        let girdiler = coz(&z);
        assert_eq!(girdiler[0].0, "mimetype");
        assert_eq!(girdiler[0].1, 0, "mimetype STORED");
        assert_eq!(girdiler[0].2, 0, "mimetype ekstra alansız");
        let adlar: Vec<&str> = girdiler.iter().map(|g| g.0.as_str()).collect();
        assert!(adlar.contains(&"META-INF/container.xml"), "{adlar:?}");
        assert!(adlar.contains(&"OEBPS/content.opf"), "{adlar:?}");
        assert!(
            adlar
                .iter()
                .all(|a| !a.contains('\\') && !a.starts_with('/')),
            "{adlar:?}"
        );
        let mut sirali = adlar[1..].to_vec();
        sirali.sort_unstable();
        assert_eq!(
            adlar[1..],
            sirali[..],
            "mimetype'tan sonra adına göre sıralı"
        );
        // içerik birebir
        for (ad, _, _, icerik) in &girdiler {
            assert_eq!(icerik, &fs::read(kok.join(ad)).unwrap(), "{ad}");
        }
        // belirlenimci
        assert_eq!(z, zip_uret(&kok).unwrap());
    }

    #[test]
    fn gizli_dosya_macosx_ve_bag_atlanir_alt_klasor_alinir() {
        let gecici = std::env::temp_dir().join(format!("kc-epub-{}", uuid::Uuid::new_v4()));
        let k = gecici.join("Kitap ğüş.epub");
        fs::create_dir_all(k.join("META-INF")).unwrap();
        fs::create_dir_all(k.join("OEBPS/derin/alt")).unwrap();
        fs::create_dir_all(k.join("__MACOSX")).unwrap();
        fs::write(k.join("META-INF/container.xml"), "<container/>").unwrap();
        fs::write(k.join("OEBPS/derin/alt/ç.xhtml"), "x").unwrap();
        fs::write(k.join("aaa-once.txt"), "a").unwrap(); // mimetype'tan önce gelmemeli
        fs::write(k.join("mimetype"), "application/epub+zip").unwrap();
        fs::write(k.join(".DS_Store"), "gizli").unwrap();
        fs::write(k.join("__MACOSX/._x"), "gizli").unwrap();
        fs::write(gecici.join("disarida.txt"), "paket dışı").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(gecici.join("disarida.txt"), k.join("OEBPS/bag.txt")).unwrap();
        let adlar: Vec<String> = coz(&zip_uret(&k).unwrap())
            .into_iter()
            .map(|g| g.0)
            .collect();
        assert_eq!(
            adlar,
            [
                "mimetype",
                "META-INF/container.xml",
                "OEBPS/derin/alt/ç.xhtml",
                "aaa-once.txt"
            ]
        );
        fs::remove_dir_all(&gecici).unwrap();
    }

    #[test]
    fn epub_olmayan_klasor_ve_dosya_reddedilir() {
        let gecici = std::env::temp_dir().join(format!("kc-epub-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(gecici.join("bos.epub")).unwrap();
        fs::write(gecici.join("duz.epub"), "PK").unwrap();
        assert!(!epub_klasoru_mu(&gecici.join("bos.epub")));
        assert!(
            zip_uret(&gecici.join("bos.epub")).is_err(),
            "container.xml'siz klasör"
        );
        assert!(zip_uret(&gecici.join("duz.epub")).is_err(), "dosya");
        assert!(zip_uret(&gecici.join("yok.epub")).is_err(), "olmayan yol");
        fs::remove_dir_all(&gecici).unwrap();
    }

    /// Geçici klasör paketi: `META-INF/container.xml`, `mimetype` ve verilen ek dosyalar.
    fn gecici_paket(ekler: &[&str]) -> (PathBuf, PathBuf) {
        let gecici = std::env::temp_dir().join(format!("kc-epub-{}", uuid::Uuid::new_v4()));
        let k = gecici.join("Sinir.epub");
        fs::create_dir_all(k.join("META-INF")).unwrap();
        fs::write(k.join("META-INF/container.xml"), "<container/>").unwrap();
        fs::write(k.join("mimetype"), "application/epub+zip").unwrap();
        for ad in ekler {
            let y = k.join(ad);
            fs::create_dir_all(y.parent().unwrap()).unwrap();
            fs::write(y, "x").unwrap();
        }
        (gecici, k)
    }

    #[cfg(unix)]
    fn izin(yol: &Path, kip: u32) {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(yol, fs::Permissions::from_mode(kip)).unwrap();
    }

    /// O1: sınırı aşan dosya OKUNMADAN reddedilir (boyut `metadata` ile toplanır). Dosya seyrek (diskte yer
    /// tutmaz) ve okunamaz (000): okumaya kalkışan kod "çok büyük" yerine izin hatası verir.
    #[cfg(unix)]
    #[test]
    fn sinir_asan_dosya_okunmadan_reddedilir() {
        let (gecici, k) = gecici_paket(&[]);
        fs::create_dir_all(k.join("OEBPS")).unwrap();
        let buyuk = k.join("OEBPS/buyuk.bin");
        fs::File::create(&buyuk)
            .unwrap()
            .set_len(EN_COK_TOPLAM + 1)
            .unwrap();
        izin(&buyuk, 0o000);
        let bas = std::time::Instant::now();
        let sonuc = zip_uret(&k);
        let sure = bas.elapsed();
        izin(&buyuk, 0o644);
        fs::remove_dir_all(&gecici).unwrap();
        let hata = sonuc.expect_err("1 GiB üstü reddedilmeli").to_string();
        assert!(
            hata.starts_with(&kalip("rust.paket_buyuk")),
            "okunmadan boyut hatası: {hata}"
        );
        assert!(sure.as_secs() < 5, "{sure:?}");
    }

    /// O1: dosya sayısı sınırı TARAMA sırasında uygulanır (bütün ağaç toplanmadan). Sınırdan sonra gelen
    /// okunamaz klasöre hiç girilmez; bütün ağacı toplayan kod izin hatası verir.
    #[cfg(unix)]
    #[test]
    fn girdi_siniri_tarama_sirasinda_uygulanir() {
        let (gecici, k) = gecici_paket(&["OEBPS/a.xhtml", "OEBPS/b.xhtml", "OEBPS/c.xhtml"]);
        // Adına göre hepsi sınırdan sonra gelen 20 okunamaz klasör: sırasız gezinme (dizin girdisi sırası
        // ada göre değil) büyük olasılıkla birine sınırdan önce girer; sıralı gezinme hiçbirine girmez.
        let kilitliler: Vec<PathBuf> = (0..20)
            .map(|_| k.join(format!("z-{}", uuid::Uuid::new_v4())))
            .collect();
        for kilitli in &kilitliler {
            fs::create_dir_all(kilitli).unwrap();
            fs::write(kilitli.join("ic.txt"), "x").unwrap();
            izin(kilitli, 0o000);
        }
        let sonuc = zip_uret_sinirli(
            &k,
            Sinir {
                toplam: EN_COK_TOPLAM,
                girdi: 3,
            },
        );
        for kilitli in &kilitliler {
            izin(kilitli, 0o755);
        }
        fs::remove_dir_all(&gecici).unwrap();
        let hata = sonuc.expect_err("3 dosya sınırı aşıldı").to_string();
        assert!(hata.starts_with(&kalip("rust.cok_dosya_sinirli")), "{hata}");
    }

    /// O1: toplam sınır da okumadan önce: iki küçük dosya sınırı birlikte aşar, ikincisi okunamaz.
    #[cfg(unix)]
    #[test]
    fn toplam_siniri_okumadan_once_uygulanir() {
        let (gecici, k) = gecici_paket(&["OEBPS/a.xhtml"]);
        let b = k.join("OEBPS/b.xhtml");
        fs::write(&b, vec![b'x'; 4096]).unwrap();
        izin(&b, 0o000);
        let sonuc = zip_uret_sinirli(
            &k,
            Sinir {
                toplam: 2048,
                girdi: EN_COK_GIRDI,
            },
        );
        izin(&b, 0o644);
        fs::remove_dir_all(&gecici).unwrap();
        let hata = sonuc.expect_err("toplam sınır aşıldı").to_string();
        assert!(hata.starts_with(&kalip("rust.paket_buyuk")), "{hata}");
    }

    /// Üretilen ZIP'i uygulamanın kendi JS okuyucusu (zip.js + epub-package.js) açabiliyor mu? `node` yoksa
    /// atlanır (yalnız bilgi yazar); varsa okuyucunun hatası test hatasıdır.
    #[test]
    fn js_epub_okuyucusu_uretilen_zipi_acar() {
        let z = zip_uret(&fixture()).unwrap();
        let dosya = std::env::temp_dir().join(format!("kc-epub-{}.epub", uuid::Uuid::new_v4()));
        fs::write(&dosya, &z).unwrap();
        let betik = Path::new(env!("CARGO_MANIFEST_DIR")).join("../app/test/epub-read-cli.cjs");
        let cikti = match std::process::Command::new("node")
            .arg(&betik)
            .arg(&dosya)
            .output()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("node bulunamadı, JS okuyucu sınaması atlandı: {e}");
                return;
            }
        };
        fs::remove_file(&dosya).ok();
        let yazi = String::from_utf8_lossy(&cikti.stdout);
        assert!(
            cikti.status.success(),
            "{yazi}\n{}",
            String::from_utf8_lossy(&cikti.stderr)
        );
        assert!(
            yazi.contains("\"baslik\":\"Klasör Paketi Deneme Kitabı\""),
            "{yazi}"
        );
        assert!(yazi.contains("\"uyarilar\":[]"), "{yazi}");
    }
}
