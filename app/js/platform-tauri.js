/*
 * platform-tauri.js — Tauri penceresinde KitapCilt.platform'un farklı olan işlevlerini ezer.
 * Tarayıcıda (window.__TAURI__ yok) hiçbir şey yapmaz. platform.js'ten sonra yüklenir.
 *
 * ad, onayla (yerel NSAlert, dialog eklentisi), menü olayları (Görünüm ⌘1-3; ⌘4 Öğren).
 * Yerel işlevler:
 *   dosyaSec   → Rust dosya_ac (yerel Aç penceresi; klasör paketi EPUB dahil) + dosya_oku (ham bayt) → File.
 *                JS hiçbir zaman yol görmez/vermez; Rust yalnız kimlik döner.
 *   kaydet     → Rust dosya_kaydet (yerel Kaydet penceresi; gövde ham bayt). Dönüş: false (vazgeçildi) ya da
 *                { ad, yol } (yazıldı). Tarayıcının <a download>'u Tauri'de iptal edilir.
 *   hepsiniKaydet / kayitMesaji → dizilmiş PDF(ler) sırayla kaydedilir, bildirim gerçek sonuca göre yazılır.
 *   sonAcilanlar / sonAcilaniAc → Rust son_acilanlar / son_acilani_oku (yer imi; kısa ömürlü erişim).
 *   Dosya menüsü (Aç ⌘O, Son Açılanlar, Kaydet ⌘S, JSON yedeği) ve Dock/Finder'dan açılan dosyalar
 *   (dosya-acildi olayı + bekleyen_acilanlar).
 *   hazir      → sayfa betikleri yüklenince: localStorage boşsa Süreç verisi otomatik yedekten geri yüklenir
 *                (boş yedek geri yüklenmez, bildirim çıkmaz); her depo.yaz/temizle sonrası HEMEN veri_yedekle
 *                (oturum + artan sıra). Bekletme (1 sn) ve kapanışta yazma Rust'ta (src-tauri/src/veri.rs).
 * son açılan hataları ayrımlı (yalnız BULUNAMADI/GECERSIZ "çıkarıldı"); kısmi kayıtta dosya başı
 *   yüz sayısı; dizilmiş PDF hazırlanırken/kaydedilirken ⌘S yok sayılır (D10, düğme aria-busy).
 * metinler KitapCilt.dil'den (okundukları anda); açılışta dil_oku (Rust'ta yedeklenmiş elle seçim, localStorage
 *   boşsa geri gelir) ve dil_ayarla (menü dili JS ile aynı olsun); Görünüm > Dil menüsü (dil:<seçim>) → dilDegistir.
 * yazdir (Rust yazdir: PDFKit baskı penceresi, %100) ve onizlemedeAc (Rust onizlemede_ac); Dosya > Yazdır… ⌘P,
 *   Önizleme'de Aç ⌥⌘P (dosya-yazdir / dosya-onizleme → Düzenle'deki düğmeler; akış app/js/yazdirma.js).
 * sistem dili Rust'tan (dil_oku.sistem: NSLocale + Apple kuralı; menüdeki "Sistem dili (X)" ile aynı
 *   kaynak; WKWebView navigator.languages tek dil verebilir). Tarayıcıya özgü metinler (saklama ipucu ve uyarısı,
 *   "sayfayı yenileyin") Mac metniyle; saklama ipucu betik yüklenir yüklenmez değişir.
 */
(function (kok) {
  'use strict';
  var T = kok.__TAURI__;
  var KC = kok.KitapCilt;
  if (!T || !T.core || !KC || !KC.platform) return;
  var P = KC.platform;
  var D = KC.dil;
  /**
   * Metin (o anki dilde). dil.js yüklenemediyse (KC.dil yok) yüklenmiş en sözlüğünden düz metin, o da yoksa
   * anahtar; böylece bu dosya yüklenirken hata atmaz (fazladan konsol hatası yok) ve Mac metinleri İngilizce kalır.
   */
  function t(a, p) {
    if (D) return D.t(a, p);
    var en = (Array.isArray(kok.KitapCiltSozlukleri) ? kok.KitapCiltSozlukleri : []).filter(function (s) { return s && s._dil === 'en'; })[0];
    var m = en && Object.prototype.hasOwnProperty.call(en, a) ? en[a] : a;
    if (m && typeof m === 'object') m = m.other;
    m = typeof m === 'string' ? m : a;
    return p ? m.replace(/\{([a-zA-Z0-9_]+)\}/g, function (x, k) { return Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : x; }) : m;
  }
  var TUR_MIME = { pdf: 'application/pdf', epub: 'application/epub+zip', json: 'application/json' };
  // Bu sayfanın yedek oturumu: Rust aynı oturumdan geç gelen eski yedeği yok sayar, yeni sayfa her zaman yazar.
  var YEDEK_OTURUM = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

  function cagir(komut, arg, secenek) {
    try { return Promise.resolve(T.core.invoke(komut, arg, secenek)); } catch (e) { return Promise.reject(e); }
  }
  function bildir(m, tur) { if (KC.ortak) KC.ortak.bildir(m, tur); }
  function oge(id) { return kok.document ? kok.document.getElementById(id) : null; }
  function hataMetni(e) { return String(e && e.message ? e.message : e); }

  P.ad = 'tauri';
  P.yerelDosya = true;
  [['kutuphaneIpucu', 'tauri.kutuphane_ipucu'], ['saklamaUyari', 'tauri.uyari_saklama'], ['denetimUyari', 'tauri.uyari_denetim']].forEach(function (m) {
    Object.defineProperty(P.metin, m[0], {
      get: function () { return t(m[1]); }, enumerable: true, configurable: true
    });
  });
  // Süreç sekmesindeki saklama ipucu: "bu tarayıcıda" değil "bu Mac'te" (betikler gövde sonunda: öğe var).
  (function () {
    var s = oge('saklama-ipucu');
    if (!s || typeof s.setAttribute !== 'function') return;
    s.setAttribute('data-dil', 'tauri.saklama_ipucu');
    s.textContent = t('tauri.saklama_ipucu');
  })();

  P.onayla = function (mesaj) {
    var d = T.dialog;
    var sonuc;
    try {
      sonuc = (d && typeof d.ask === 'function')
        ? d.ask(String(mesaj), { title: t('uygulama.ad'), kind: 'warning', okLabel: t('ortak.tamam'), cancelLabel: t('ortak.vazgec') })
        : kok.confirm(String(mesaj)); // eklentinin ezdiği confirm de Promise<boolean> döner
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve(sonuc).then(function (ok) { return ok === true; });
  };

  // ---------------------------------------------------------------- dosya açma
  function dosyaYap(bayt, ad, tur) {
    return new kok.File([bayt], String(ad), { type: TUR_MIME[tur] || '' });
  }

  /** Yerel Aç penceresi. uzantilar 'json' içeriyorsa JSON yedeği, değilse PDF/EPUB. Vazgeçilirse null. */
  P.dosyaSec = function (secenek) {
    var u = (secenek && secenek.uzantilar) || [];
    var amac = u.indexOf('json') >= 0 ? 'yedek' : 'belge';
    return cagir('dosya_ac', { amac: amac }).then(function (a) {
      if (!a) return null;
      return cagir('dosya_oku', { kimlik: a.kimlik }).then(function (b) { return dosyaYap(b, a.ad, a.tur); });
    });
  };

  P.sonAcilanlar = function () { return cagir('son_acilanlar').then(function (l) { return Array.isArray(l) ? l : []; }); };

  /** Son açılan kaydı açar → File. Kayıt okunamazsa (Rust listeden çıkarır) anlaşılır hata ile reddedilir. */
  P.sonAcilaniAc = function (kimlik) {
    return P.sonAcilanlar().then(function (liste) {
      var k = liste.filter(function (x) { return x && x.kimlik === kimlik; })[0];
      if (!k) throw new Error(t('son.yok'));
      return cagir('son_acilani_oku', { kimlik: kimlik }).then(function (b) { return dosyaYap(b, k.ad, k.tur); }, function (e) {
        var m = hataMetni(e);
        var ayrinti = m.replace(/^[A-Z]+:\s*/, '');
        var p = { ad: k.ad, ayrinti: ayrinti };
        if (/^BULUNAMADI:/.test(m)) throw new Error(t('son.bulunamadi', p));
        if (/^GECERSIZ:/.test(m)) throw new Error(t('son.gecersiz', p));
        if (/^ERISIM:/.test(m)) throw new Error(t('son.erisim', p));
        if (/^DISKYOK:/.test(m)) throw new Error(t('son.disk_yok', p));
        if (/^GECICI:/.test(m)) throw new Error(t('son.gecici', p));
        if (/^BILINMEYEN:/.test(m)) throw new Error(t('son.yok'));
        throw new Error(k.ad + ': ' + m);
      });
    });
  };

  // ---------------------------------------------------------------- kaydetme
  function bayta(veri) {
    if (typeof veri === 'string') return Promise.resolve(new kok.TextEncoder().encode(veri));
    if (veri && ArrayBuffer.isView(veri)) return Promise.resolve(new Uint8Array(veri.buffer, veri.byteOffset, veri.byteLength));
    if (veri && Object.prototype.toString.call(veri) === '[object ArrayBuffer]') return Promise.resolve(new Uint8Array(veri));
    if (veri && typeof veri.arrayBuffer === 'function') return veri.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return Promise.reject(new Error(t('tauri.veri_taninmadi')));
  }

  /** Yerel Kaydet penceresi. Promise<false | { ad, yol }>. */
  P.kaydet = function (ad, veri, mime) {
    var tur = (/json/i.test(mime || '') || /\.json$/i.test(String(ad))) ? 'json' : 'pdf';
    return bayta(veri).then(function (b) {
      return cagir('dosya_kaydet', b, { headers: { 'x-ad': encodeURIComponent(String(ad)), 'x-tur': tur } });
    }).then(function (s) { return s && s.yol ? { ad: String(s.ad), yol: String(s.yol) } : false; });
  };

  /**
   * Dosyaları SIRAYLA kaydeder (her biri için ayrı Kaydet penceresi). Biri vazgeçilse ya da hata verse de
   * sıradakine geçer. Promise<{ kaydedilen: [{ad, yol, yuz?}], vazgecilen: [ad], hatali: [{ad, mesaj}] }> (hiç
   * reddedilmez). Dosyada `yuz` (o dosyadaki yüz sayısı) varsa kaydedilene taşınır.
   */
  P.hepsiniKaydet = function (dosyalar, mime) {
    var s = { kaydedilen: [], vazgecilen: [], hatali: [] };
    return (dosyalar || []).reduce(function (zincir, d) {
      return zincir.then(function () {
        return P.kaydet(d.ad, d.bytes, mime).then(function (r) {
          if (r && typeof d.yuz === 'number' && isFinite(d.yuz)) r.yuz = d.yuz;
          if (r) s.kaydedilen.push(r); else s.vazgecilen.push(d.ad);
        }, function (e) { s.hatali.push({ ad: d.ad, mesaj: hataMetni(e) }); });
      });
    }, Promise.resolve()).then(function () { return s; });
  };

  /**
   * hepsiniKaydet sonucundan bildirim: { metin, tur } (tur 'hata' = en az biri yazılmadı). Yüz sayısı: kaydedilen
   * dosyaların `yuz` toplamı; dosya başı bilgi yoksa `yuzSayisi` yalnız hepsi yazıldıysa (kısmi kayıtta toplamı
   * yazmak yanlış olurdu, D9).
   */
  P.kayitMesaji = function (s, yuzSayisi) {
    var sayi = null;
    var hepsiBilgili = s.kaydedilen.length > 0 && s.kaydedilen.every(function (k) { return typeof k.yuz === 'number' && isFinite(k.yuz); });
    if (hepsiBilgili) sayi = s.kaydedilen.reduce(function (top, k) { return top + k.yuz; }, 0);
    else if (!s.vazgecilen.length && !s.hatali.length && typeof yuzSayisi === 'number' && isFinite(yuzSayisi)) sayi = yuzSayisi;
    if (!s.kaydedilen.length && !s.hatali.length) return { metin: t('kayit.pdf_kaydedilmedi'), tur: 'hata' };
    var parca = [];
    if (s.kaydedilen.length) {
      var yollar = s.kaydedilen.map(function (k) { return k.yol; }).join(', ');
      parca.push(sayi !== null ? t('kayit.kaydedildi_yuz', { yollar: yollar, n: sayi }) : t('kayit.kaydedildi', { yollar: yollar }));
    }
    if (s.vazgecilen.length) parca.push(t('kayit.kaydedilmedi', { adlar: s.vazgecilen.join(', ') }));
    s.hatali.forEach(function (h) { parca.push(t('kayit.kaydedilemedi', { ad: h.ad, hata: h.mesaj })); });
    return { metin: parca.join(' '), tur: (s.vazgecilen.length || s.hatali.length) ? 'hata' : undefined };
  };

  // ---------------------------------------------------------------- yazdırma
  /**
   * Yerel baskı penceresi (Rust yazdir: PDFKit, %100 ölçek, kâğıt = sayfa). Gövde ham PDF baytı, x-ad iş adı.
   * Promise<boolean>: true = yazdırıldı (ya da PDF olarak kaydedildi), false = vazgeçildi; hata reddedilir.
   */
  P.yazdir = function (ad, veri) {
    return bayta(veri).then(function (b) {
      return cagir('yazdir', b, { headers: { 'x-ad': encodeURIComponent(String(ad)) } });
    }).then(function (r) { return r === true; });
  };

  /** Önizleme'de Aç (Rust onizlemede_ac: önbelleğe yazar, NSWorkspace ile açar). Promise<{ ad }>; açılamazsa reddedilir. */
  P.onizlemedeAc = function (ad, veri) {
    return bayta(veri).then(function (b) {
      return cagir('onizlemede_ac', b, { headers: { 'x-ad': encodeURIComponent(String(ad)) } });
    }).then(function (r) { return { ad: typeof r === 'string' && r ? r : String(ad) }; });
  };

  // ---------------------------------------------------------------- menü ve dış açılış
  function belgeAc(sozFile) {
    return sozFile.then(function (f) {
      if (!f) return;
      if (KC.uygulama) KC.uygulama.sekmeAc('duzenle');
      return KC.duzenle && KC.duzenle.dosyaAc(f);
    }).catch(function (e) { bildir(t('duzenle.dosya_acilamadi', { hata: hataMetni(e) }), 'hata'); });
  }

  function tikla(id, sekme) {
    if (sekme && KC.uygulama) KC.uygulama.sekmeAc(sekme);
    var b = oge(id);
    if (b) b.click();
  }

  /** Düzenle'deki çıktı düğmesine (yazdır / Önizleme) menüden basar: meşgulse yok sayar, kapalıysa bildirir. */
  function ciktiDugmesi(id) {
    var b = oge(id);
    if (b && typeof b.getAttribute === 'function' && b.getAttribute('aria-busy') === 'true') return;
    if (!b || b.disabled || b.hidden) return bildir(t('yazdir.kapali'), 'hata');
    if (KC.uygulama) KC.uygulama.sekmeAc('duzenle');
    b.click();
  }

  var SEKME_OGESI = { 'sekme-duzenle': 'duzenle', 'sekme-surec': 'surec', 'sekme-hesapla': 'hesapla', 'sekme-ogren': 'ogren' }; // Öğren ⌘4
  var DOSYA_OGESI = {
    'dosya-ac': function () { tikla('pdf-sec', 'duzenle'); },
    'dosya-kaydet': function () {
      var b = oge('disa-aktar');
      // D10: çıktı hazırlanıyor ya da Kaydet penceresi açık (duzenle.disaAktar düğmeyi aria-busy yapar): yok say.
      if (b && typeof b.getAttribute === 'function' && b.getAttribute('aria-busy') === 'true') return;
      if (!b || b.disabled) return bildir(t('kayit.kaydet_kapali'), 'hata');
      if (KC.uygulama) KC.uygulama.sekmeAc('duzenle');
      b.click();
    },
    // Yazdır… ⌘P / Önizleme'de Aç ⌥⌘P — çıktı hazırlanırken ya da pencere açıkken (aria-busy) yok sayılır
    'dosya-yazdir': function () { ciktiDugmesi('yazdir'); },
    'dosya-onizleme': function () { ciktiDugmesi('onizlemede-ac'); },
    'json-disa': function () { tikla('json-disa', 'surec'); },
    'json-ice': function () { tikla('json-ice-dugme', 'surec'); }
  };
  var SON_ONEK = 'son:';
  var DIL_ONEK = 'dil:';

  /** Yerel menü öğesi (src-tauri/src/menu.rs) → arayüz işlemi. */
  P.menuOlayi = function (kimlik) {
    if (typeof kimlik !== 'string') return;
    if (Object.prototype.hasOwnProperty.call(SEKME_OGESI, kimlik)) { if (KC.uygulama) KC.uygulama.sekmeAc(SEKME_OGESI[kimlik]); return; }
    if (Object.prototype.hasOwnProperty.call(DOSYA_OGESI, kimlik)) { DOSYA_OGESI[kimlik](); return; }
    if (kimlik.indexOf(SON_ONEK) === 0) return belgeAc(P.sonAcilaniAc(kimlik.slice(SON_ONEK.length)));
    if (kimlik.indexOf(DIL_ONEK) === 0 && KC.uygulama && KC.uygulama.dilDegistir) return KC.uygulama.dilDegistir(kimlik.slice(DIL_ONEK.length));
  };

  /** Dock/Finder'dan gelen ve henüz işlenmemiş dosyaları sırayla açar (son açılan ekranda kalır). */
  P.bekleyenleriAc = function () {
    return cagir('bekleyen_acilanlar').then(function (l) {
      return (Array.isArray(l) ? l : []).reduce(function (z, a) {
        return z.then(function () {
          return belgeAc(cagir('dosya_oku', { kimlik: a.kimlik }).then(function (b) { return dosyaYap(b, a.ad, a.tur); }));
        });
      }, Promise.resolve());
    }).catch(function (e) { bildir(t('duzenle.dosya_acilamadi', { hata: hataMetni(e) }), 'hata'); });
  };

  if (T.event && typeof T.event.listen === 'function') {
    T.event.listen('menu', function (olay) { P.menuOlayi(olay && olay.payload); });
    T.event.listen('dosya-acildi', function () { if (P.hazirOldu) P.bekleyenleriAc(); });
    // Rust'taki gecikmeli yazım başarısız oldu (src-tauri/src/veri.rs HATA_OLAYI).
    T.event.listen('yedek-yazilamadi', function (olay) { bildir(t('yedek.yazilamadi', { hata: String(olay && olay.payload) }), 'hata'); });
  }

  // ---------------------------------------------------------------- Süreç verisi otomatik yedeği
  var yedekSira = 0;
  /** Değişikliği HEMEN Rust'a gönderir: bekletme ve kapanışta diske yazma Rust'ta. */
  function yedekGonder(veri) {
    var j;
    try { j = JSON.stringify(veri); } catch (e) { return Promise.resolve(); }
    yedekSira += 1;
    return cagir('veri_yedekle', { json: j, oturum: YEDEK_OTURUM, sira: yedekSira })
      .catch(function (e) { bildir(t('yedek.yazilamadi', { hata: hataMetni(e) }), 'hata'); });
  }

  /**
   * localStorage'da Süreç verisi yoksa ve yedek geçerliyse yedeği yazar. true: geri yüklendi. Boş yedek (hiç kitap
   * yok: kasıtlı temizlik ya da hiç veri girilmemiş) geri yüklenmez: yüklenecek bir şey yok, bildirim yanıltır.
   */
  function geriYukle(json) {
    if (typeof json !== 'string' || !KC.depo) return false;
    var ls;
    try { ls = kok.localStorage; if (ls.getItem(KC.depo.ANAHTAR) !== null) return false; } catch (e) { return false; }
    try {
      var veri = JSON.parse(json);
      if (KC.surecModel) KC.surecModel.dogrula(veri);
      if (!veri || !Array.isArray(veri.kitaplar) || veri.kitaplar.length === 0) return false;
      ls.setItem(KC.depo.ANAHTAR, json);
      return true;
    } catch (e) { return false; }
  }

  function depoKancasi() {
    if (!KC.depo || KC.depo.yedekKancali) return;
    var asilYaz = KC.depo.yaz, asilTemizle = KC.depo.temizle;
    KC.depo.yaz = function (veri) { var ok = asilYaz.apply(this, arguments); yedekGonder(veri); return ok; };
    KC.depo.temizle = function () {
      var r = asilTemizle.apply(this, arguments);
      if (KC.surecModel) yedekGonder(KC.surecModel.bosVeri());
      return r;
    };
    KC.depo.yedekKancali = true;
  }

  function sayfaYuklendi() {
    var d = kok.document;
    if (!d || d.readyState !== 'loading') return Promise.resolve();
    return new Promise(function (coz) { d.addEventListener('DOMContentLoaded', function () { coz(); }, { once: true }); });
  }

  // ---------------------------------------------------------------- dil
  /** Dil değişikliğini Rust'a bildirir (menü dili + elle seçimin yedeği). secim: 'sistem' | kod. */
  P.dilBildir = function (kod, secim) { return cagir('dil_ayarla', { kod: kod, secim: secim }); };

  /**
   * Açılışta: localStorage'da elle seçim yoksa ve Rust'ta yedeklenmiş elle seçim varsa (WebKit verisi silinmiş)
   * o geri gelir; sonra Rust'a güncel dil bildirilir (menü JS ile aynı dilde kurulsun). Hata başlatmayı durdurmaz.
   */
  function dilEsitle() {
    if (!D) return Promise.resolve(); // dil altyapısı yok; başlatma hatası uygulama.js'te bildirilir
    return cagir('dil_oku').then(function (r) {
      if (r && D.destekli(r.sistem)) D.sistemKoduAyarla(r.sistem);
      if (!D.secimOku() && r && D.destekli(r.secim)) D.secimYaz(r.secim);
      var hedef = D.secimOku() || D.sistemKodu();
      if (hedef !== D.kod()) {
        D.ayarla(hedef);
        D.uygula(kok.document);
      }
    }, function () {}).then(function () {
      return P.dilBildir(D.kod(), D.secimOku() || 'sistem').catch(function () {});
    });
  }

  // Bütün klasik betikler (depo.js, duzenle.js …) yüklendikten sonra çalışır; uygulama.js baslat()'ı bunu
  // bekleyerek çağırır. Yedek ya da dil okunamazsa başlatma durmaz.
  P.hazir = sayfaYuklendi().then(dilEsitle).then(function () {
    return cagir('veri_oku').then(function (json) { return geriYukle(json); }, function () { return false; });
  }).then(function (geri) {
    depoKancasi();
    var b = oge('disa-aktar');
    if (b) { if (typeof b.setAttribute === 'function') b.setAttribute('data-dil', 'duzenle.kaydet'); b.textContent = t('duzenle.kaydet'); }
    P.hazirOldu = true;
    if (geri) setTimeout(function () { bildir(t('yedek.geri_yuklendi')); }, 0);
    setTimeout(function () { P.bekleyenleriAc(); }, 0);
  });
})(typeof self !== 'undefined' ? self : this);
