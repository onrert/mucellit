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

use crate::i18n::text;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

/// Üretilecek ZIP'in üst sınırı (bellek). EPUB'lar pratikte birkaç yüz MB'ı geçmez.
pub const MAX_TOTAL: u64 = 1 << 30;
const MAX_INPUT: usize = 65_535;
const MIMETYPE: &str = "mimetype";

/// Klasör bir EPUB paketi mi (EPUB'ın zorunlu kapsayıcı dosyası var mı)?
pub fn is_epub_folder(path: &Path) -> bool {
    path.is_dir() && path.join("META-INF").join("container.xml").is_file()
}

/// Kayıtlı bir klasör paketinin durumu: `Degil` yalnız klasörün içi okunabildiği halde EPUB
/// kapsayıcısı yoksa. İçi okunamıyorsa (izinsiz `META-INF`, iCloud'dan henüz inmemiş/dataless ya da boş
/// klasör) `Okunamadi`: kayıt silinmemeli, sonra yeniden denenebilir.
#[derive(Debug)]
pub enum PackageState {
    Package,
    NotPackage,
    Unreadable(io::Error),
}

pub fn package_state(path: &Path) -> PackageState {
    match fs::metadata(path.join("META-INF").join("container.xml")) {
        Ok(m) if m.is_file() => PackageState::Package,
        Ok(_) => PackageState::NotPackage,
        Err(e) if e.kind() == io::ErrorKind::NotFound => match fs::read_dir(path) {
            Err(e) => PackageState::Unreadable(e),
            Ok(mut inner) => {
                if inner.next().is_none() {
                    return PackageState::Unreadable(io::Error::other(text(
                        "rust.package_blank",
                        &[],
                    )));
                }
                match fs::read_dir(path.join("META-INF")) {
                    Err(e) if e.kind() != io::ErrorKind::NotFound => PackageState::Unreadable(e),
                    _ => PackageState::NotPackage,
                }
            }
        },
        Err(e) => PackageState::Unreadable(e),
    }
}

/// Okuma sınırları (testte küçültülür).
#[derive(Debug, Clone, Copy)]
pub struct Limit {
    /// Üretilecek ZIP'in yaklaşık üst sınırı (bayt).
    pub total: u64,
    /// En çok dosya (ZIP girdisi).
    pub input: usize,
}

/// Uygulamanın kullandığı sınırlar.
pub const LIMIT: Limit = Limit {
    total: MAX_TOTAL,
    input: MAX_INPUT,
};

/// Klasör paketinden EPUB ZIP baytı üretir.
pub fn build_zip(root: &Path) -> io::Result<Vec<u8>> {
    build_zip_limited(root, LIMIT)
}

/// `zip_uret`, verilen sınırlarla.
pub fn build_zip_limited(root: &Path, limit: Limit) -> io::Result<Vec<u8>> {
    if !root.is_dir() {
        return Err(error(text(
            "rust.folder_not",
            &[("path", &root.display().to_string())],
        )));
    }
    if !is_epub_folder(root) {
        return Err(error(text("rust.no_container", &[])));
    }
    // O1: dosya sayısı ve toplam boyut TARAMA sırasında (`metadata` ile, okumadan) denetlenir; sınırı aşan
    // paket hiçbir dosyası okunmadan reddedilir, bellek şişmez.
    let mut t = Collector {
        limit,
        files: Vec::new(),
        total: 0,
    };
    t.collect(root, root)?;
    let mut files = t.files;
    // mimetype önce (OCF şartı), sonra adına göre.
    files.sort_by(|a, b| (a.0 != MIMETYPE, &a.0).cmp(&(b.0 != MIMETYPE, &b.0)));
    let mut writer = ZipWriter::default();
    let mut total: u64 = 0;
    for (name, path) in &files {
        // Tarama ile okuma arasında büyüyen dosya da sınırı aşamaz: en çok kalan pay + 1 bayt okunur.
        let pay = limit.total.saturating_sub(total);
        let mut data = Vec::new();
        fs::File::open(path)?.take(pay + 1).read_to_end(&mut data)?;
        total += extra_size(name, data.len() as u64);
        if total > limit.total {
            return Err(too_large(limit));
        }
        writer.add(name, &data)?;
    }
    writer.finish()
}

/// Bir girdinin ZIP'te kapladığı yaklaşık yer (içerik + başlıklar + ad iki kez).
fn extra_size(name: &str, content: u64) -> u64 {
    content + 128 + name.len() as u64 * 2
}

fn too_large(limit: Limit) -> io::Error {
    error(text(
        "rust.package_large",
        &[("mb", &(limit.total >> 20).to_string())],
    ))
}

fn error(m: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, m)
}

/// Tarama durumu: toplanan dosyalar ve `metadata` ile toplanan boyut.
struct Collector {
    limit: Limit,
    files: Vec<(String, PathBuf)>,
    total: u64,
}

impl Collector {
    /// `kok` altındaki düzenli dosyaları (ZIP adı, yol) olarak toplar; sınır aşılınca hemen durur. Klasör
    /// girdileri adına göre sıralı gezilir (belirlenimci: sınır hep aynı noktada aşılır).
    fn collect(&mut self, root: &Path, folder: &Path) -> io::Result<()> {
        let mut inputs = fs::read_dir(folder)?.collect::<io::Result<Vec<_>>>()?;
        inputs.sort_by_key(|g| g.file_name());
        for input in inputs {
            let name = input.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || name == "__MACOSX" {
                continue;
            }
            let kind = input.file_type()?; // bağı izlemez
            let path = input.path();
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                self.collect(root, &path)?;
            } else if kind.is_file() {
                if self.files.len() >= self.limit.input {
                    return Err(error(text(
                        "rust.many_file_limited",
                        &[("n", &self.limit.input.to_string())],
                    )));
                }
                let relative = path
                    .strip_prefix(root)
                    .map_err(|_| error(text("rust.path_outside", &[])))?;
                let parts: Vec<String> = relative
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect();
                let zip_name = parts.join("/");
                self.total += extra_size(&zip_name, input.metadata()?.len());
                if self.total > self.limit.total {
                    return Err(too_large(self.limit));
                }
                self.files.push((zip_name, path));
            }
        }
        Ok(())
    }
}

/// En küçük STORED ZIP yazıcısı.
#[derive(Default)]
struct ZipWriter {
    data: Vec<u8>,
    center: Vec<u8>,
    count: usize,
}

impl ZipWriter {
    fn add(&mut self, name: &str, content: &[u8]) -> io::Result<()> {
        let size = u32::try_from(content.len())
            .map_err(|_| error(text("rust.input_large", &[("name", name)])))?;
        let offset =
            u32::try_from(self.data.len()).map_err(|_| error(text("rust.zip_4gib", &[])))?;
        let ad_b = name.as_bytes();
        let ad_uz = u16::try_from(ad_b.len())
            .map_err(|_| error(text("rust.name_long", &[("name", name)])))?;
        let crc = crc32(content);
        const FLAG: u16 = 0x0800; // UTF-8 ad
        const CLOCKWISE: u16 = 0; // 00:00:00
        const DATE: u16 = (1 << 5) | 1; // 1980-01-01 (belirlenimci çıktı)

        let v = &mut self.data;
        v.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        v.extend_from_slice(&20u16.to_le_bytes()); // gereken sürüm
        v.extend_from_slice(&FLAG.to_le_bytes());
        v.extend_from_slice(&0u16.to_le_bytes()); // yöntem: STORED
        v.extend_from_slice(&CLOCKWISE.to_le_bytes());
        v.extend_from_slice(&DATE.to_le_bytes());
        v.extend_from_slice(&crc.to_le_bytes());
        v.extend_from_slice(&size.to_le_bytes()); // sıkışık
        v.extend_from_slice(&size.to_le_bytes()); // açık
        v.extend_from_slice(&ad_uz.to_le_bytes());
        v.extend_from_slice(&0u16.to_le_bytes()); // ekstra alan yok (mimetype için şart)
        v.extend_from_slice(ad_b);
        v.extend_from_slice(content);

        let m = &mut self.center;
        m.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        m.extend_from_slice(&20u16.to_le_bytes()); // yapan sürüm
        m.extend_from_slice(&20u16.to_le_bytes()); // gereken sürüm
        m.extend_from_slice(&FLAG.to_le_bytes());
        m.extend_from_slice(&0u16.to_le_bytes());
        m.extend_from_slice(&CLOCKWISE.to_le_bytes());
        m.extend_from_slice(&DATE.to_le_bytes());
        m.extend_from_slice(&crc.to_le_bytes());
        m.extend_from_slice(&size.to_le_bytes());
        m.extend_from_slice(&size.to_le_bytes());
        m.extend_from_slice(&ad_uz.to_le_bytes());
        m.extend_from_slice(&0u16.to_le_bytes()); // ekstra
        m.extend_from_slice(&0u16.to_le_bytes()); // yorum
        m.extend_from_slice(&0u16.to_le_bytes()); // disk
        m.extend_from_slice(&0u16.to_le_bytes()); // iç öznitelik
        m.extend_from_slice(&0u32.to_le_bytes()); // dış öznitelik
        m.extend_from_slice(&offset.to_le_bytes());
        m.extend_from_slice(ad_b);
        self.count += 1;
        Ok(())
    }

    fn finish(mut self) -> io::Result<Vec<u8>> {
        let cd_offset =
            u32::try_from(self.data.len()).map_err(|_| error(text("rust.zip_4gib", &[])))?;
        let cd_size =
            u32::try_from(self.center.len()).map_err(|_| error(text("rust.zip_4gib", &[])))?;
        let count = u16::try_from(self.count).map_err(|_| error(text("rust.many_file", &[])))?;
        u32::try_from(self.data.len() + self.center.len() + 22)
            .map_err(|_| error(text("rust.zip_4gib", &[])))?;
        self.data.extend_from_slice(&self.center);
        let v = &mut self.data;
        v.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        v.extend_from_slice(&0u16.to_le_bytes()); // disk
        v.extend_from_slice(&0u16.to_le_bytes()); // CD diski
        v.extend_from_slice(&count.to_le_bytes());
        v.extend_from_slice(&count.to_le_bytes());
        v.extend_from_slice(&cd_size.to_le_bytes());
        v.extend_from_slice(&cd_offset.to_le_bytes());
        v.extend_from_slice(&0u16.to_le_bytes()); // yorum
        Ok(self.data)
    }
}

/// CRC-32 (IEEE, ZIP'in kullandığı), tablosuz.
pub fn crc32(data: &[u8]) -> u32 {
    let mut c: u32 = 0xffff_ffff;
    for &b in data {
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
mod tests {
    use super::*;
    use crate::i18n::prefix_of;

    /// Testte üretilen ZIP'i okuyan küçük çözümleyici: (ad, yöntem, ekstra uzunluğu, içerik) yerel başlık
    /// sırasıyla; merkezi dizinle tutarlılık ve CRC da denetlenir.
    fn parse(z: &[u8]) -> Vec<(String, u16, u16, Vec<u8>)> {
        let u16_ = |o: usize| u16::from_le_bytes([z[o], z[o + 1]]);
        let u32_ = |o: usize| u32::from_le_bytes([z[o], z[o + 1], z[o + 2], z[o + 3]]);
        let eocd = z.len() - 22;
        assert_eq!(u32_(eocd), 0x0605_4b50, "EOCD");
        let count = u16_(eocd + 10) as usize;
        let cd = u32_(eocd + 16) as usize;
        let mut result = Vec::new();
        let mut p = cd;
        for _ in 0..count {
            assert_eq!(u32_(p), 0x0201_4b50, "merkezi dizin imzası");
            let crc = u32_(p + 16);
            let size = u32_(p + 24) as usize;
            let ad_uz = u16_(p + 28) as usize;
            let offset = u32_(p + 42) as usize;
            let name = String::from_utf8(z[p + 46..p + 46 + ad_uz].to_vec()).unwrap();
            assert_eq!(u32_(offset), 0x0403_4b50, "yerel başlık imzası");
            assert_eq!(u16_(offset + 6) & 0x0800, 0x0800, "UTF-8 bayrağı");
            let method = u16_(offset + 8);
            let extra = u16_(offset + 28);
            let head = offset + 30 + u16_(offset + 26) as usize + extra as usize;
            let content = z[head..head + size].to_vec();
            assert_eq!(crc32(&content), crc, "CRC {name}");
            result.push((name, method, extra, content));
            p += 46 + ad_uz;
        }
        result
    }

    fn fixture() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../app/test/fixtures/folder-package.epub")
    }

    #[test]
    fn crc32_known_values() {
        assert_eq!(crc32(b""), 0);
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
        assert_eq!(crc32(b"application/epub+zip"), 0x2cab_616f);
    }

    #[test]
    fn repo_fixture_folder_package_zip_mimetype_first_and_stored() {
        let root = fixture();
        assert!(
            is_epub_folder(&root),
            "fixture EPUB paketi olmalı: {}",
            root.display()
        );
        let z = build_zip(&root).expect("zip");
        // ilk 38 bayt: yerel başlık + "mimetype" adı + içerik başı (OCF'nin sihirli ofseti)
        assert_eq!(&z[0..4], b"PK\x03\x04");
        assert_eq!(&z[30..38], b"mimetype");
        assert_eq!(&z[38..58], b"application/epub+zip");
        let inputs = parse(&z);
        assert_eq!(inputs[0].0, "mimetype");
        assert_eq!(inputs[0].1, 0, "mimetype STORED");
        assert_eq!(inputs[0].2, 0, "mimetype ekstra alansız");
        let names: Vec<&str> = inputs.iter().map(|g| g.0.as_str()).collect();
        assert!(names.contains(&"META-INF/container.xml"), "{names:?}");
        assert!(names.contains(&"OEBPS/content.opf"), "{names:?}");
        assert!(
            names
                .iter()
                .all(|a| !a.contains('\\') && !a.starts_with('/')),
            "{names:?}"
        );
        let mut ordered = names[1..].to_vec();
        ordered.sort_unstable();
        assert_eq!(
            names[1..],
            ordered[..],
            "mimetype'tan sonra adına göre sıralı"
        );
        // içerik birebir
        for (name, _, _, content) in &inputs {
            assert_eq!(content, &fs::read(root.join(name)).unwrap(), "{name}");
        }
        // belirlenimci
        assert_eq!(z, build_zip(&root).unwrap());
    }

    #[test]
    fn hidden_files_macosx_and_symlinks_skipped_subfolders_included() {
        let temp = std::env::temp_dir().join(format!("mc-epub-{}", uuid::Uuid::new_v4()));
        let k = temp.join("Kitap ğüş.epub");
        fs::create_dir_all(k.join("META-INF")).unwrap();
        fs::create_dir_all(k.join("OEBPS/derin/alt")).unwrap();
        fs::create_dir_all(k.join("__MACOSX")).unwrap();
        fs::write(k.join("META-INF/container.xml"), "<container/>").unwrap();
        fs::write(k.join("OEBPS/derin/alt/ç.xhtml"), "x").unwrap();
        fs::write(k.join("aaa-once.txt"), "a").unwrap(); // mimetype'tan önce gelmemeli
        fs::write(k.join("mimetype"), "application/epub+zip").unwrap();
        fs::write(k.join(".DS_Store"), "hidden").unwrap();
        fs::write(k.join("__MACOSX/._x"), "hidden").unwrap();
        fs::write(temp.join("disarida.txt"), "paket dışı").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(temp.join("disarida.txt"), k.join("OEBPS/bag.txt")).unwrap();
        let names: Vec<String> = parse(&build_zip(&k).unwrap())
            .into_iter()
            .map(|g| g.0)
            .collect();
        assert_eq!(
            names,
            [
                "mimetype",
                "META-INF/container.xml",
                "OEBPS/derin/alt/ç.xhtml",
                "aaa-once.txt"
            ]
        );
        fs::remove_dir_all(&temp).unwrap();
    }

    #[test]
    fn non_epub_folder_and_file_are_rejected() {
        let temp = std::env::temp_dir().join(format!("mc-epub-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(temp.join("bos.epub")).unwrap();
        fs::write(temp.join("duz.epub"), "PK").unwrap();
        assert!(!is_epub_folder(&temp.join("bos.epub")));
        assert!(
            build_zip(&temp.join("bos.epub")).is_err(),
            "container.xml'siz klasör"
        );
        assert!(build_zip(&temp.join("duz.epub")).is_err(), "file");
        assert!(build_zip(&temp.join("yok.epub")).is_err(), "non path");
        fs::remove_dir_all(&temp).unwrap();
    }

    /// Geçici klasör paketi: `META-INF/container.xml`, `mimetype` ve verilen ek dosyalar.
    fn temp_package(suffixes: &[&str]) -> (PathBuf, PathBuf) {
        let temp = std::env::temp_dir().join(format!("mc-epub-{}", uuid::Uuid::new_v4()));
        let k = temp.join("Sinir.epub");
        fs::create_dir_all(k.join("META-INF")).unwrap();
        fs::write(k.join("META-INF/container.xml"), "<container/>").unwrap();
        fs::write(k.join("mimetype"), "application/epub+zip").unwrap();
        for name in suffixes {
            let y = k.join(name);
            fs::create_dir_all(y.parent().unwrap()).unwrap();
            fs::write(y, "x").unwrap();
        }
        (temp, k)
    }

    #[cfg(unix)]
    fn permission(path: &Path, kip: u32) {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(kip)).unwrap();
    }

    /// O1: sınırı aşan dosya OKUNMADAN reddedilir (boyut `metadata` ile toplanır). Dosya seyrek (diskte yer
    /// tutmaz) ve okunamaz (000): okumaya kalkışan kod "çok büyük" yerine izin hatası verir.
    #[cfg(unix)]
    #[test]
    fn file_over_limit_rejected_before_reading() {
        let (temp, k) = temp_package(&[]);
        fs::create_dir_all(k.join("OEBPS")).unwrap();
        let large = k.join("OEBPS/buyuk.bin");
        fs::File::create(&large)
            .unwrap()
            .set_len(MAX_TOTAL + 1)
            .unwrap();
        permission(&large, 0o000);
        let head = std::time::Instant::now();
        let result = build_zip(&k);
        let sure = head.elapsed();
        permission(&large, 0o644);
        fs::remove_dir_all(&temp).unwrap();
        let error = result.expect_err("1 GiB üstü reddedilmeli").to_string();
        assert!(
            error.starts_with(&prefix_of("rust.package_large")),
            "okunmadan boyut hatası: {error}"
        );
        assert!(sure.as_secs() < 5, "{sure:?}");
    }

    /// O1: dosya sayısı sınırı TARAMA sırasında uygulanır (bütün ağaç toplanmadan). Sınırdan sonra gelen
    /// okunamaz klasöre hiç girilmez; bütün ağacı toplayan kod izin hatası verir.
    #[cfg(unix)]
    #[test]
    fn entry_limit_applied_while_scanning() {
        let (temp, k) = temp_package(&["OEBPS/a.xhtml", "OEBPS/b.xhtml", "OEBPS/c.xhtml"]);
        // Adına göre hepsi sınırdan sonra gelen 20 okunamaz klasör: sırasız gezinme (dizin girdisi sırası
        // ada göre değil) büyük olasılıkla birine sınırdan önce girer; sıralı gezinme hiçbirine girmez.
        let locked: Vec<PathBuf> = (0..20)
            .map(|_| k.join(format!("z-{}", uuid::Uuid::new_v4())))
            .collect();
        for locked in &locked {
            fs::create_dir_all(locked).unwrap();
            fs::write(locked.join("ic.txt"), "x").unwrap();
            permission(locked, 0o000);
        }
        let result = build_zip_limited(
            &k,
            Limit {
                total: MAX_TOTAL,
                input: 3,
            },
        );
        for locked in &locked {
            permission(locked, 0o755);
        }
        fs::remove_dir_all(&temp).unwrap();
        let error = result.expect_err("3 dosya sınırı aşıldı").to_string();
        assert!(
            error.starts_with(&prefix_of("rust.many_file_limited")),
            "{error}"
        );
    }

    /// O1: toplam sınır da okumadan önce: iki küçük dosya sınırı birlikte aşar, ikincisi okunamaz.
    #[cfg(unix)]
    #[test]
    fn total_limit_applied_before_reading() {
        let (temp, k) = temp_package(&["OEBPS/a.xhtml"]);
        let b = k.join("OEBPS/b.xhtml");
        fs::write(&b, vec![b'x'; 4096]).unwrap();
        permission(&b, 0o000);
        let result = build_zip_limited(
            &k,
            Limit {
                total: 2048,
                input: MAX_INPUT,
            },
        );
        permission(&b, 0o644);
        fs::remove_dir_all(&temp).unwrap();
        let error = result.expect_err("toplam sınır aşıldı").to_string();
        assert!(
            error.starts_with(&prefix_of("rust.package_large")),
            "{error}"
        );
    }

    /// Üretilen ZIP'i uygulamanın kendi JS okuyucusu (zip.js + epub-package.js) açabiliyor mu? `node` yoksa
    /// atlanır (yalnız bilgi yazar); varsa okuyucunun hatası test hatasıdır.
    #[test]
    fn js_epub_reader_opens_generated_zip() {
        let z = build_zip(&fixture()).unwrap();
        let file = std::env::temp_dir().join(format!("kc-epub-{}.epub", uuid::Uuid::new_v4()));
        fs::write(&file, &z).unwrap();
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../app/test/epub-read-cli.cjs");
        let output = match std::process::Command::new("node")
            .arg(&script)
            .arg(&file)
            .output()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("node bulunamadı, JS reader sınaması atlandı: {e}");
                return;
            }
        };
        fs::remove_file(&file).ok();
        let text = String::from_utf8_lossy(&output.stdout);
        assert!(
            output.status.success(),
            "{text}\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            text.contains("\"title\":\"Klasör Paketi Deneme Kitabı\""),
            "{text}"
        );
        assert!(text.contains("\"warnings\":[]"), "{text}");
    }
}
