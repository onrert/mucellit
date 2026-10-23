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
 *                (oturum + artan sıra). Bekletme (1 sn) ve kapanışta yazma Rust'ta (src-tauri/src/backup.rs).
 * son açılan hataları ayrımlı (yalnız BULUNAMADI/GECERSIZ "çıkarıldı"); kısmi kayıtta dosya başı
 *   yüz sayısı; dizilmiş PDF hazırlanırken/kaydedilirken ⌘S yok sayılır (D10, düğme aria-busy).
 * metinler KitapCilt.dil'den (okundukları anda); açılışta dil_oku (Rust'ta yedeklenmiş elle seçim, localStorage
 *   boşsa geri gelir) ve dil_ayarla (menü dili JS ile aynı olsun); Görünüm > Dil menüsü (dil:<seçim>) → dilDegistir.
 * yazdir (Rust yazdir: PDFKit baskı penceresi, %100) ve onizlemedeAc (Rust onizlemede_ac); Dosya > Yazdır… ⌘P,
 *   Önizleme'de Aç ⌥⌘P (dosya-yazdir / dosya-onizleme → Düzenle'deki düğmeler; akış app/js/printing.js).
 * sistem dili Rust'tan (dil_oku.sistem: NSLocale + Apple kuralı; menüdeki "Sistem dili (X)" ile aynı
 *   kaynak; WKWebView navigator.languages tek dil verebilir). Tarayıcıya özgü metinler (saklama ipucu ve uyarısı,
 *   "sayfayı yenileyin") Mac metniyle; saklama ipucu betik yüklenir yüklenmez değişir.
 */
(function (root) {
  'use strict';
  var T = root.__TAURI__;
  var MC = root.Mucellit;
  if (!T || !T.core || !MC || !MC.platform) return;
  var P = MC.platform;
  var D = MC.i18n;
  /**
   * Metin (o anki dilde). i18n.js yüklenemediyse (KC.dil yok) yüklenmiş en sözlüğünden düz metin, o da yoksa
   * anahtar; böylece bu dosya yüklenirken hata atmaz (fazladan konsol hatası yok) ve Mac metinleri İngilizce kalır.
   */
  function t(a, p) {
    if (D) return D.t(a, p);
    var en = (Array.isArray(root.MucellitDictionaries) ? root.MucellitDictionaries : []).filter(function (s) { return s && s._lang === 'en'; })[0];
    var m = en && Object.prototype.hasOwnProperty.call(en, a) ? en[a] : a;
    if (m && typeof m === 'object') m = m.other;
    m = typeof m === 'string' ? m : a;
    return p ? m.replace(/\{([a-zA-Z0-9_]+)\}/g, function (x, k) { return Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : x; }) : m;
  }
  var KIND_MIME = { pdf: 'application/pdf', epub: 'application/epub+zip', json: 'application/json' };
  // Bu sayfanın yedek oturumu: Rust aynı oturumdan geç gelen eski yedeği yok sayar, yeni sayfa her zaman yazar.
  var BACKUP_SESSION = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

  function invoke(command, arg, options) {
    try { return Promise.resolve(T.core.invoke(command, arg, options)); } catch (e) { return Promise.reject(e); }
  }
  function notify(m, kind) { if (MC.common) MC.common.notify(m, kind); }
  function element(id) { return root.document ? root.document.getElementById(id) : null; }
  function errorText(e) { return String(e && e.message ? e.message : e); }

  P.name = 'tauri';
  P.localFile = true;
  [['libraryHint', 'tauri.library_hint'], ['storageWarning', 'tauri.warning_storage'], ['checkWarning', 'tauri.warning_check']].forEach(function (m) {
    Object.defineProperty(P.text, m[0], {
      get: function () { return t(m[1]); }, enumerable: true, configurable: true
    });
  });
  // Süreç sekmesindeki saklama ipucu: "bu tarayıcıda" değil "bu Mac'te" (betikler gövde sonunda: öğe var).
  (function () {
    var s = element('storage-hint');
    if (!s || typeof s.setAttribute !== 'function') return;
    s.setAttribute('data-i18n', 'tauri.storage_hint');
    s.textContent = t('tauri.storage_hint');
  })();

  P.ask = function (message) {
    var d = T.dialog;
    var result;
    try {
      result = (d && typeof d.ask === 'function')
        ? d.ask(String(message), { title: t('app.name'), kind: 'warning', okLabel: t('common.done'), cancelLabel: t('common.cancel') })
        : root.confirm(String(message)); // eklentinin ezdiği confirm de Promise<boolean> döner
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve(result).then(function (ok) { return ok === true; });
  };

  // ---------------------------------------------------------------- dosya açma
  function makeFile(bytes, name, kind) {
    return new root.File([bytes], String(name), { type: KIND_MIME[kind] || '' });
  }

  /** Yerel Aç penceresi. uzantilar 'json' içeriyorsa JSON yedeği, değilse PDF/EPUB. Vazgeçilirse null. */
  P.pickFile = function (options) {
    var u = (options && options.extensions) || [];
    var purpose = u.indexOf('json') >= 0 ? 'backup' : 'document';
    return invoke('open_file', { purpose: purpose }).then(function (a) {
      if (!a) return null;
      return invoke('read_file', { id: a.id }).then(function (b) { return makeFile(b, a.name, a.kind); });
    });
  };

  P.recentFiles = function () { return invoke('recent_files').then(function (l) { return Array.isArray(l) ? l : []; }); };

  /** Son açılan kaydı açar → File. Kayıt okunamazsa (Rust listeden çıkarır) anlaşılır hata ile reddedilir. */
  P.openRecent = function (id) {
    return P.recentFiles().then(function (list) {
      var k = list.filter(function (x) { return x && x.id === id; })[0];
      if (!k) throw new Error(t('recent.none'));
      return invoke('read_recent_file', { id: id }).then(function (b) { return makeFile(b, k.name, k.kind); }, function (e) {
        var m = errorText(e);
        var detail = m.replace(/^[A-Z]+:\s*/, '');
        var p = { name: k.name, detail: detail };
        if (/^NOTFOUND:/.test(m)) throw new Error(t('recent.notFound', p));
        if (/^INVALID:/.test(m)) throw new Error(t('recent.invalid', p));
        if (/^ACCESS:/.test(m)) throw new Error(t('recent.access', p));
        if (/^NODISK:/.test(m)) throw new Error(t('recent.no_disk', p));
        if (/^TRANSIENT:/.test(m)) throw new Error(t('recent.temp', p));
        if (/^UNKNOWN:/.test(m)) throw new Error(t('recent.none'));
        throw new Error(k.name + ': ' + m);
      });
    });
  };

  // ---------------------------------------------------------------- kaydetme
  function toBytes(data) {
    if (typeof data === 'string') return Promise.resolve(new root.TextEncoder().encode(data));
    if (data && ArrayBuffer.isView(data)) return Promise.resolve(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (data && Object.prototype.toString.call(data) === '[object ArrayBuffer]') return Promise.resolve(new Uint8Array(data));
    if (data && typeof data.arrayBuffer === 'function') return data.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return Promise.reject(new Error(t('tauri.data_unrecognized')));
  }

  /** Yerel Kaydet penceresi. Promise<false | { ad, yol }>. */
  P.save = function (name, data, mime) {
    var kind = (/json/i.test(mime || '') || /\.json$/i.test(String(name))) ? 'json' : 'pdf';
    return toBytes(data).then(function (b) {
      return invoke('save_file', b, { headers: { 'x-name': encodeURIComponent(String(name)), 'x-kind': kind } });
    }).then(function (s) { return s && s.path ? { name: String(s.name), path: String(s.path) } : false; });
  };

  /**
   * Dosyaları SIRAYLA kaydeder (her biri için ayrı Kaydet penceresi). Biri vazgeçilse ya da hata verse de
   * sıradakine geçer. Promise<{ kaydedilen: [{ad, yol, yuz?}], vazgecilen: [ad], hatali: [{ad, mesaj}] }> (hiç
   * reddedilmez). Dosyada `yuz` (o dosyadaki yüz sayısı) varsa kaydedilene taşınır.
   */
  P.saveAll = function (files, mime) {
    var s = { saved: [], cancelled: [], failed: [] };
    return (files || []).reduce(function (chain, d) {
      return chain.then(function () {
        return P.save(d.name, d.bytes, mime).then(function (r) {
          if (r && typeof d.side === 'number' && isFinite(d.side)) r.side = d.side;
          if (r) s.saved.push(r); else s.cancelled.push(d.name);
        }, function (e) { s.failed.push({ name: d.name, message: errorText(e) }); });
      });
    }, Promise.resolve()).then(function () { return s; });
  };

  /**
   * hepsiniKaydet sonucundan bildirim: { metin, tur } (tur 'hata' = en az biri yazılmadı). Yüz sayısı: kaydedilen
   * dosyaların `yuz` toplamı; dosya başı bilgi yoksa `yuzSayisi` yalnız hepsi yazıldıysa (kısmi kayıtta toplamı
   * yazmak yanlış olurdu, D9).
   */
  P.saveMessage = function (s, sideCount) {
    var number = null;
    var allHaveSides = s.saved.length > 0 && s.saved.every(function (k) { return typeof k.side === 'number' && isFinite(k.side); });
    if (allHaveSides) number = s.saved.reduce(function (top, k) { return top + k.side; }, 0);
    else if (!s.cancelled.length && !s.failed.length && typeof sideCount === 'number' && isFinite(sideCount)) number = sideCount;
    if (!s.saved.length && !s.failed.length) return { text: t('save.pdf_not_saved'), kind: 'error' };
    var part = [];
    if (s.saved.length) {
      var paths = s.saved.map(function (k) { return k.path; }).join(', ');
      part.push(number !== null ? t('save.saved_side', { paths: paths, n: number }) : t('save.saved', { paths: paths }));
    }
    if (s.cancelled.length) part.push(t('save.notSaved', { names: s.cancelled.join(', ') }));
    s.failed.forEach(function (h) { part.push(t('save.saveFailed', { name: h.name, error: h.message })); });
    return { text: part.join(' '), kind: (s.cancelled.length || s.failed.length) ? 'error' : undefined };
  };

  // ---------------------------------------------------------------- yazdırma
  /**
   * Yerel baskı penceresi (Rust yazdir: PDFKit, %100 ölçek, kâğıt = sayfa). Gövde ham PDF baytı, x-ad iş adı.
   * Promise<boolean>: true = yazdırıldı (ya da PDF olarak kaydedildi), false = vazgeçildi; hata reddedilir.
   */
  P.print = function (name, data) {
    return toBytes(data).then(function (b) {
      return invoke('print', b, { headers: { 'x-name': encodeURIComponent(String(name)) } });
    }).then(function (r) { return r === true; });
  };

  /** Önizleme'de Aç (Rust onizlemede_ac: önbelleğe yazar, NSWorkspace ile açar). Promise<{ ad }>; açılamazsa reddedilir. */
  P.openInPreview = function (name, data) {
    return toBytes(data).then(function (b) {
      return invoke('open_in_preview', b, { headers: { 'x-name': encodeURIComponent(String(name)) } });
    }).then(function (r) { return { name: typeof r === 'string' && r ? r : String(name) }; });
  };

  // ---------------------------------------------------------------- menü ve dış açılış
  function openDocument(filePromise) {
    return filePromise.then(function (f) {
      if (!f) return;
      if (MC.app) MC.app.openTab('impose');
      return MC.impose && MC.impose.openFile(f);
    }).catch(function (e) { notify(t('impose.file_open_failed', { error: errorText(e) }), 'error'); });
  }

  function click(id, tab) {
    if (tab && MC.app) MC.app.openTab(tab);
    var b = element(id);
    if (b) b.click();
  }

  /** Düzenle'deki çıktı düğmesine (yazdır / Önizleme) menüden basar: meşgulse yok sayar, kapalıysa bildirir. */
  function clickOutputButton(id) {
    var b = element(id);
    if (b && typeof b.getAttribute === 'function' && b.getAttribute('aria-busy') === 'true') return;
    if (!b || b.disabled || b.hidden) return notify(t('print.closed'), 'error');
    if (MC.app) MC.app.openTab('impose');
    b.click();
  }

  var TAB_ITEMS = { 'tab-impose': 'impose', 'tab-projects': 'projects', 'tab-calculator': 'calculator', 'tab-learn': 'learn' }; // Öğren ⌘4
  var FILE_ITEMS = {
    'file-open': function () { click('pdf-select', 'impose'); },
    'file-save': function () {
      var b = element('export-transfer');
      // D10: çıktı hazırlanıyor ya da Kaydet penceresi açık (duzenle.disaAktar düğmeyi aria-busy yapar): yok say.
      if (b && typeof b.getAttribute === 'function' && b.getAttribute('aria-busy') === 'true') return;
      if (!b || b.disabled) return notify(t('save.save_closed'), 'error');
      if (MC.app) MC.app.openTab('impose');
      b.click();
    },
    // Yazdır… ⌘P / Önizleme'de Aç ⌥⌘P — çıktı hazırlanırken ya da pencere açıkken (aria-busy) yok sayılır
    'file-print': function () { clickOutputButton('print'); },
    'file-preview': function () { clickOutputButton('inPreview-open'); },
    'json-export': function () { click('json-export', 'projects'); },
    'json-import': function () { click('json-import-button', 'projects'); }
  };
  var RECENT_PREFIX = 'last:';
  var LANGUAGE_PREFIX = 'i18n:';

  /** Yerel menü öğesi (src-tauri/src/menu.rs) → arayüz işlemi. */
  P.onMenu = function (id) {
    if (typeof id !== 'string') return;
    if (Object.prototype.hasOwnProperty.call(TAB_ITEMS, id)) { if (MC.app) MC.app.openTab(TAB_ITEMS[id]); return; }
    if (Object.prototype.hasOwnProperty.call(FILE_ITEMS, id)) { FILE_ITEMS[id](); return; }
    if (id.indexOf(RECENT_PREFIX) === 0) return openDocument(P.openRecent(id.slice(RECENT_PREFIX.length)));
    if (id.indexOf(LANGUAGE_PREFIX) === 0 && MC.app && MC.app.changeLanguage) return MC.app.changeLanguage(id.slice(LANGUAGE_PREFIX.length));
  };

  /** Dock/Finder'dan gelen ve henüz işlenmemiş dosyaları sırayla açar (son açılan ekranda kalır). */
  P.openPending = function () {
    return invoke('pending_opens').then(function (l) {
      return (Array.isArray(l) ? l : []).reduce(function (z, a) {
        return z.then(function () {
          return openDocument(invoke('read_file', { id: a.id }).then(function (b) { return makeFile(b, a.name, a.kind); }));
        });
      }, Promise.resolve());
    }).catch(function (e) { notify(t('impose.file_open_failed', { error: errorText(e) }), 'error'); });
  };

  if (T.event && typeof T.event.listen === 'function') {
    T.event.listen('menu', function (on_event) { P.onMenu(on_event && on_event.payload); });
    T.event.listen('file-opened', function () { if (P.isReady) P.openPending(); });
    // Rust'taki gecikmeli yazım başarısız oldu (src-tauri/src/backup.rs HATA_OLAYI).
    T.event.listen('backup-writeFailed', function (on_event) { notify(t('backup.writeFailed', { error: String(on_event && on_event.payload) }), 'error'); });
  }

  // ---------------------------------------------------------------- Süreç verisi otomatik yedeği
  var backupSeq = 0;
  /** Değişikliği HEMEN Rust'a gönderir: bekletme ve kapanışta diske yazma Rust'ta. */
  function sendBackup(data) {
    var j;
    try { j = JSON.stringify(data); } catch (e) { return Promise.resolve(); }
    backupSeq += 1;
    return invoke('backup_data', { json: j, session: BACKUP_SESSION, order: backupSeq })
      .catch(function (e) { notify(t('backup.writeFailed', { error: errorText(e) }), 'error'); });
  }

  /**
   * localStorage'da Süreç verisi yoksa ve yedek geçerliyse yedeği yazar. true: geri yüklendi. Boş yedek (hiç kitap
   * yok: kasıtlı temizlik ya da hiç veri girilmemiş) geri yüklenmez: yüklenecek bir şey yok, bildirim yanıltır.
   */
  function restore(json) {
    if (typeof json !== 'string' || !MC.storage) return false;
    var ls;
    try { ls = root.localStorage; if (ls.getItem(MC.storage.KEY) !== null) return false; } catch (e) { return false; }
    try {
      var data = JSON.parse(json);
      if (MC.migrate) data = MC.migrate.projects(data); // backup written by an earlier version
      if (MC.projectModel) MC.projectModel.validate(data);
      if (!data || !Array.isArray(data.projects) || data.projects.length === 0) return false;
      ls.setItem(MC.storage.KEY, JSON.stringify(data));
      return true;
    } catch (e) { return false; }
  }

  function hookStorage() {
    if (!MC.storage || MC.storage.backupHooked) return;
    var originalWrite = MC.storage.write, originalClear = MC.storage.clear;
    MC.storage.write = function (data) { var ok = originalWrite.apply(this, arguments); sendBackup(data); return ok; };
    MC.storage.clear = function () {
      var r = originalClear.apply(this, arguments);
      if (MC.projectModel) sendBackup(MC.projectModel.emptyData());
      return r;
    };
    MC.storage.backupHooked = true;
  }

  function pageLoaded() {
    var d = root.document;
    if (!d || d.readyState !== 'loading') return Promise.resolve();
    return new Promise(function (parse) { d.addEventListener('DOMContentLoaded', function () { parse(); }, { once: true }); });
  }

  // ---------------------------------------------------------------- dil
  /** Dil değişikliğini Rust'a bildirir (menü dili + elle seçimin yedeği). secim: 'sistem' | kod. */
  P.notifyLanguage = function (code, choice) { return invoke('set_language', { code: code, choice: choice }); };

  /**
   * Açılışta: localStorage'da elle seçim yoksa ve Rust'ta yedeklenmiş elle seçim varsa (WebKit verisi silinmiş)
   * o geri gelir; sonra Rust'a güncel dil bildirilir (menü JS ile aynı dilde kurulsun). Hata başlatmayı durdurmaz.
   */
  function syncLanguage() {
    if (!D) return Promise.resolve(); // dil altyapısı yok; başlatma hatası app.js'te bildirilir
    return invoke('read_language').then(function (r) {
      if (r && D.isSupported(r.system)) D.setSystemCode(r.system);
      if (!D.readChoice() && r && D.isSupported(r.choice)) D.writeChoice(r.choice);
      var target = D.readChoice() || D.systemCode();
      if (target !== D.code()) {
        D.set(target);
        D.apply(root.document);
      }
    }, function () {}).then(function () {
      return P.notifyLanguage(D.code(), D.readChoice() || 'system').catch(function () {});
    });
  }

  // Bütün klasik betikler (storage.js, impose.js …) yüklendikten sonra çalışır; app.js baslat()'ı bunu
  // bekleyerek çağırır. Yedek ya da dil okunamazsa başlatma durmaz.
  P.ready = pageLoaded().then(syncLanguage).then(function () {
    return invoke('read_backup').then(function (json) { return restore(json); }, function () { return false; });
  }).then(function (restored) {
    hookStorage();
    var b = element('export-transfer');
    if (b) { if (typeof b.setAttribute === 'function') b.setAttribute('data-i18n', 'impose.save'); b.textContent = t('impose.save'); }
    P.isReady = true;
    if (restored) setTimeout(function () { notify(t('backup.restored')); }, 0);
    setTimeout(function () { P.openPending(); }, 0);
  });
})(typeof self !== 'undefined' ? self : this);
