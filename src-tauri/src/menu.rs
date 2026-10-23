//! Yerel menü. Uygulama menüsü; Dosya (Aç ⌘O, Son Açılanlar alt menüsü, Dizilmiş PDF'i
//! Kaydet ⌘S, Yazdır… ⌘P ve Önizleme'de Aç ⌥⌘P, JSON yedeği, Pencereyi Kapat ⌘W); Düzen (öntanımlı öğeler; WKWebView metin kutularında
//! ⌘C/⌘V/⌘Z bunlarla çalışır); Görünüm (⌘1-4 sekmeler — ⌘4 Öğren —, tam ekran); Pencere.
//! Menü olayı webview'e `menu` olayıyla öğe kimliği olarak gider (app/js/platform-tauri.js dinler);
//! "Menüyü Temizle" Rust'ta işlenir. Son Açılanlar her değişimde `yenile` ile yeniden kurulur.
//! bütün etiketler (öntanımlı öğeler dahil: Hakkında, Gizle, Çık, Pencereyi Kapat, Geri Al …) sözlükten,
//! şu anki dilde (`crate::dil`); Görünüm > Dil alt menüsü (`dil:<seçim>`, JS işler); dil değişince menü yeniden kurulur.

use crate::dil::{self, metin};
use crate::dosya::Durum;
use tauri::menu::{
    CheckMenuItemBuilder, Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Görünüm menüsündeki sekme öğeleri: (kimlik, sözlük anahtarı, kısayol). Kimlikler platform-tauri.js'teki
/// `SEKME_OGESI` ile aynı olmalı.
pub const SEKMELER: [(&str, &str, &str); 4] = [
    ("sekme-duzenle", "sekme.duzenle", "CmdOrCtrl+1"),
    ("sekme-surec", "sekme.surec", "CmdOrCtrl+2"),
    ("sekme-hesapla", "sekme.hesapla", "CmdOrCtrl+3"),
    ("sekme-ogren", "sekme.ogren", "CmdOrCtrl+4"),
];

/// Dosya menüsünün webview'e giden öğeleri: (kimlik, sözlük anahtarı, kısayol). Kimlikler platform-tauri.js'teki
/// `DOSYA_OGESI` ile aynı olmalı.
/// Yazdır… ⌘P (HIG: Dosya menüsü), Önizleme'de Aç ⌥⌘P.
pub const DOSYA_OGELERI: [(&str, &str, Option<&str>); 6] = [
    ("dosya-ac", "menu.ac", Some("CmdOrCtrl+O")),
    ("dosya-kaydet", "menu.kaydet", Some("CmdOrCtrl+S")),
    ("dosya-yazdir", "menu.yazdir", Some("CmdOrCtrl+P")),
    ("dosya-onizleme", "menu.onizleme", Some("Alt+CmdOrCtrl+P")),
    ("json-disa", "menu.json_disa", None),
    ("json-ice", "menu.json_ice", None),
];

/// Son açılan öğesinin kimlik öneki: "son:<uuid>".
pub const SON_ONEK: &str = "son:";
/// Dil öğesinin kimlik öneki: "dil:sistem" | "dil:<kod>" (JS `KitapCilt.uygulama.dilDegistir`).
pub const DIL_ONEK: &str = "dil:";
/// Rust'ta işlenen öğe.
pub const SON_TEMIZLE: &str = "son-temizle";

/// Webview'e iletilecek menü öğesi mi?
pub fn iletilir_mi(kimlik: &str) -> bool {
    SEKMELER.iter().any(|(k, _, _)| *k == kimlik)
        || DOSYA_OGELERI.iter().any(|(k, _, _)| *k == kimlik)
        || kimlik.strip_prefix(SON_ONEK).is_some_and(|u| {
            uuid::Uuid::parse_str(u).is_ok_and(|v| v.hyphenated().to_string() == u)
        })
        || kimlik
            .strip_prefix(DIL_ONEK)
            .is_some_and(|s| s == "sistem" || dil::destekli(s))
}

/// Menü etiketi: muda macOS'ta tek `&`'yi (anımsatıcı) siler; dosya adındaki `&` görünsün diye ikilenir.
pub fn etiket_kac(ad: &str) -> String {
    ad.replace('&', "&&")
}

pub fn olustur<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let ad = app.package_info().name.clone();
    let uygulama = SubmenuBuilder::new(app, &ad)
        .about_with_text(metin("menu.hakkinda", &[("ad", &ad)]), None)
        .separator()
        .services_with_text(metin("menu.hizmetler", &[]))
        .separator()
        .hide_with_text(metin("menu.gizle", &[("ad", &ad)]))
        .hide_others_with_text(metin("menu.digerlerini_gizle", &[]))
        .show_all_with_text(metin("menu.tumunu_goster", &[]))
        .separator()
        .quit_with_text(metin("menu.cik", &[("ad", &ad)]))
        .build()?;

    let mut son = SubmenuBuilder::new(app, metin("menu.son_acilanlar", &[]));
    let ozetler = app
        .try_state::<Durum>()
        .map(|d| d.son_ozetler(app))
        .unwrap_or_default();
    if ozetler.is_empty() {
        son = son.item(
            &MenuItemBuilder::with_id("son-bos", metin("menu.son_bos", &[]))
                .enabled(false)
                .build(app)?,
        );
    } else {
        for o in &ozetler {
            son = son.item(
                &MenuItemBuilder::with_id(format!("{SON_ONEK}{}", o.kimlik), etiket_kac(&o.ad))
                    .build(app)?,
            );
        }
        son = son.separator().item(
            &MenuItemBuilder::with_id(SON_TEMIZLE, metin("menu.son_temizle", &[])).build(app)?,
        );
    }
    let son = son.build()?;

    let [ac, kaydet, yazdir, onizleme, json_disa, json_ice] =
        DOSYA_OGELERI.map(|(kimlik, anahtar, kisayol)| {
            let mut b = MenuItemBuilder::with_id(kimlik, metin(anahtar, &[]));
            if let Some(k) = kisayol {
                b = b.accelerator(k);
            }
            b.build(app)
        });
    let dosya = SubmenuBuilder::new(app, metin("menu.dosya", &[]))
        .item(&ac?)
        .item(&son)
        .separator()
        .item(&kaydet?)
        .separator()
        .item(&yazdir?)
        .item(&onizleme?)
        .separator()
        .item(&json_disa?)
        .item(&json_ice?)
        .separator()
        .close_window_with_text(metin("menu.pencereyi_kapat", &[]))
        .build()?;

    let duzen = SubmenuBuilder::new(app, metin("menu.duzen", &[]))
        .undo_with_text(metin("menu.geri_al", &[]))
        .redo_with_text(metin("menu.yinele", &[]))
        .separator()
        .cut_with_text(metin("menu.kes", &[]))
        .copy_with_text(metin("menu.kopyala", &[]))
        .paste_with_text(metin("menu.yapistir", &[]))
        .select_all_with_text(metin("menu.tumunu_sec", &[]))
        .build()?;

    let mut gorunum = SubmenuBuilder::new(app, metin("menu.gorunum", &[]));
    for (kimlik, anahtar, kisayol) in SEKMELER {
        gorunum = gorunum.item(
            &MenuItemBuilder::with_id(kimlik, metin(anahtar, &[]))
                .accelerator(kisayol)
                .build(app)?,
        );
    }
    let gorunum = gorunum
        .separator()
        .item(&dil_menusu(app)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(
            app,
            Some(&metin("menu.tam_ekran", &[])),
        )?)
        .build()?;

    let pencere = SubmenuBuilder::new(app, metin("menu.pencere", &[]))
        .minimize_with_text(metin("menu.kucult", &[]))
        .maximize_with_text(metin("menu.buyut", &[]))
        .build()?;

    Menu::with_items(app, &[&uygulama, &dosya, &duzen, &gorunum, &pencere])
}

/// Görünüm > Dil: sistem dili ("Sistem Dili (X)", Title Case: menu.dil_sistem) + her sözlük (kendi adıyla); şu anki
/// seçim işaretli.
fn dil_menusu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    let secim = dil::secim();
    // seçicideki "Sistem dili (X)" ile aynı kaynak (dil::sistem_kodu; JS dil_oku.sistem ile alır)
    let mut m = SubmenuBuilder::new(app, metin("menu.dil", &[])).item(
        &CheckMenuItemBuilder::with_id(format!("{DIL_ONEK}sistem"), dil::sistem_etiketi())
            .checked(secim.is_none())
            .build(app)?,
    );
    for kod in dil::diller() {
        m = m.item(
            &CheckMenuItemBuilder::with_id(format!("{DIL_ONEK}{kod}"), etiket_kac(&dil::ad(&kod)))
                .checked(secim.as_deref() == Some(kod.as_str()))
                .build(app)?,
        );
    }
    m.build()
}

/// Menüyü (Son Açılanlar dahil) yeniden kurar.
pub fn yenile<R: Runtime>(app: &AppHandle<R>) {
    match olustur(app).and_then(|m| app.set_menu(m)) {
        Ok(_) => {}
        Err(e) => eprintln!("menü yenilenemedi: {e}"),
    }
}

pub fn olay<R: Runtime>(app: &AppHandle<R>, olay: MenuEvent) {
    let kimlik = olay.id().as_ref();
    if kimlik == SON_TEMIZLE {
        crate::dosya::son_acilanlari_temizle(app);
    } else if iletilir_mi(kimlik) {
        if kimlik.starts_with(DIL_ONEK) {
            // İşaretli öğe tıklanınca kendiliğinden değişir; JS vazgeçerse yanlış kalmasın diye menü şimdiki
            // seçimle yeniden kurulur (JS kabul ederse dil_ayarla yeniden kurar).
            yenile(app);
        }
        if let Err(e) = app.emit("menu", kimlik) {
            eprintln!("menü olayı iletilemedi ({kimlik}): {e}");
        }
    }
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn sekme_kimlikleri_iletilir_digerleri_iletilmez() {
        for k in [
            "sekme-duzenle",
            "sekme-surec",
            "sekme-hesapla",
            "sekme-ogren",
        ] {
            assert!(iletilir_mi(k), "{k}");
        }
        for k in [
            "",
            "sekme",
            "quit",
            "sekme-duzenle ",
            "SEKME-SUREC",
            "sekme-ogren ",
            "sekme-OGREN",
            "sekme-ogren2",
        ] {
            assert!(!iletilir_mi(k), "{k:?}");
        }
    }

    #[test]
    fn dosya_ve_son_acilan_ogeleri_iletilir_kusurlu_kimlik_iletilmez() {
        for k in [
            "dosya-ac",
            "dosya-kaydet",
            "dosya-yazdir",
            "dosya-onizleme",
            "json-disa",
            "json-ice",
            "son:7f0c3a7e-1d2b-4c5d-8e9f-0a1b2c3d4e5f",
        ] {
            assert!(iletilir_mi(k), "{k}");
        }
        for k in [
            "son:",
            "son:../../etc/passwd",
            "son:/etc/hosts",
            "son:7F0C3A7E-1D2B-4C5D-8E9F-0A1B2C3D4E5F",
            "son:7f0c3a7e1d2b4c5d8e9f0a1b2c3d4e5f",
            "son:7f0c3a7e-1d2b-4c5d-8e9f-0a1b2c3d4e5f ",
            "son-temizle",
            "son-bos",
            "dosya-ac ",
        ] {
            assert!(!iletilir_mi(k), "{k:?}");
        }
    }

    #[test]
    fn dil_ogeleri_iletilir_kusurlu_dil_iletilmez() {
        for k in ["dil:sistem", "dil:en", "dil:tr"] {
            assert!(iletilir_mi(k), "{k}");
        }
        for k in [
            "dil:",
            "dil:xx",
            "dil:TR",
            "dil:tr ",
            "dil:../en",
            "dil:sistem2",
            "dil",
        ] {
            assert!(!iletilir_mi(k), "{k:?}");
        }
    }

    /// Menüdeki her sözlük anahtarı her dilde var (eksik anahtar menüde anahtar adı olarak görünürdü).
    #[test]
    fn menu_anahtarlari_her_dilde() {
        let mut anahtarlar: Vec<&str> = SEKMELER.iter().map(|(_, a, _)| *a).collect();
        anahtarlar.extend(DOSYA_OGELERI.iter().map(|(_, a, _)| *a));
        for kod in crate::dil::diller() {
            for a in &anahtarlar {
                let m = crate::dil::metin_dilde(&kod, a, &[]);
                assert_ne!(&m, a, "{kod}: {a} eksik");
            }
        }
        assert_eq!(
            crate::dil::metin_dilde("en", "menu.pencereyi_kapat", &[]),
            "Close Window"
        );
        assert_eq!(
            crate::dil::metin_dilde("tr", "menu.pencereyi_kapat", &[]),
            "Pencereyi Kapat"
        );
        // AppKit toggleFullScreen: öğesini menü doğrulanırken kendi metniyle yeniden adlandırır; sözlük o
        // metinle aynı (MenuCommands.loctable "Enter Full Screen": en/tr), doğrulamadan önce/sonra ad değişmez.
        assert_eq!(
            crate::dil::metin_dilde("en", "menu.tam_ekran", &[]),
            "Enter Full Screen"
        );
        assert_eq!(
            crate::dil::metin_dilde("tr", "menu.tam_ekran", &[]),
            "Tam Ekrana Geç"
        );
    }

    /// Görünüm menüsünde 4. sekme Öğren ⌘4; etiket iki dilde sözlükten ("Learn" / "Öğren").
    #[test]
    fn ogren_sekmesi_dort_numarali_kisayolla_iki_dilde() {
        assert_eq!(SEKMELER.len(), 4);
        assert_eq!(SEKMELER[3], ("sekme-ogren", "sekme.ogren", "CmdOrCtrl+4"));
        for (i, (_, _, k)) in SEKMELER.iter().enumerate() {
            assert_eq!(
                *k,
                format!("CmdOrCtrl+{}", i + 1),
                "sekme kısayolları sırayla ⌘1-⌘4"
            );
        }
        assert_eq!(crate::dil::metin_dilde("en", "sekme.ogren", &[]), "Learn");
        assert_eq!(crate::dil::metin_dilde("tr", "sekme.ogren", &[]), "Öğren");
    }

    #[test]
    fn etiket_ampersand_ikilenir() {
        assert_eq!(etiket_kac("Suç & Ceza.epub"), "Suç && Ceza.epub");
        assert_eq!(etiket_kac("düz.pdf"), "düz.pdf");
    }

    #[test]
    fn kisayollar_benzersiz_ve_platform_tauri_ile_ayni_kimlikler() {
        let js = include_str!("../../app/js/platform-tauri.js");
        let mut kisayol: Vec<&str> = SEKMELER.iter().map(|(_, _, k)| *k).collect();
        kisayol.sort_unstable();
        kisayol.dedup();
        assert_eq!(kisayol.len(), SEKMELER.len());
        let mut kimlikler: Vec<&str> = SEKMELER.iter().map(|(k, _, _)| *k).collect();
        kimlikler.extend(DOSYA_OGELERI.iter().map(|(k, _, _)| *k));
        for kimlik in kimlikler {
            assert!(
                js.contains(&format!("'{kimlik}'")),
                "platform-tauri.js içinde {kimlik} yok"
            );
        }
        assert!(
            js.contains(&format!("'{SON_ONEK}'")),
            "platform-tauri.js son: öneki"
        );
        let mut tum: Vec<&str> = SEKMELER.iter().map(|(_, _, k)| *k).collect();
        tum.extend(DOSYA_OGELERI.iter().filter_map(|(_, _, k)| *k));
        let n = tum.len();
        tum.sort_unstable();
        tum.dedup();
        assert_eq!(tum.len(), n, "kısayollar benzersiz");
    }
}
