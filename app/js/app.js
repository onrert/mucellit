/*
 * app.js — sekmeler ve başlatma. En son yüklenir.
 * statik etiketleri i18n.js kendisi yükler yüklenmez yazar; burada dil seçici de hemen doldurulur
 * (platform.hazir reddedilse de arayüz metinli). baslat() etiketleri yeniden uygular (Tauri dil eşitlemesi dili
 * değiştirmiş olabilir). i18n.js hiç çalışmadıysa (KC.dil yok) arayüz index.html'in statik İngilizcesiyle kalır ve
 * başlatma hatası İngilizce bildirilir.
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  var O = MC.common, $ = O.$, D = MC.i18n;
  var TAB_KEY = 'mucellit.tab';
  var TABS = ['impose', 'projects', 'calculator', 'learn']; // 4. sekme Öğren (Görünüm > Öğren ⌘4)

  /**
   * Öğren sekmesi açılınca rehber kurulur (ilk kez) ya da figürü yeniden kurulur; başka sekmeye geçince
   * "baştan sona" durur ve figür sökülür (gizli sekmede animasyon/rAF çalışmaz). Sekme gizlendikten SONRA gizle,
   * gösterildikten SONRA goster çağrılır (figür ölçüsü görünür panelde alınır).
   */
  function learnTab() { return MC.learn && MC.learn.tab ? MC.learn.tab : null; }

  function openTab(name) {
    if (TABS.indexOf(name) < 0) name = 'impose';
    TABS.forEach(function (s) {
      $('tab-' + s).hidden = s !== name;
      $('tab-button-' + s).setAttribute('aria-selected', s === name ? 'true' : 'false');
    });
    O.writeLocal(TAB_KEY, name);
    var og = learnTab();
    if (og) {
      try { if (name === 'learn') og.show(); else og.hide(); }
      catch (e) { // sekme geçişi yarıda kalmaz; hata bildirilir ve gizlenmez (konsolda da görünür)
        O.notify(D.t('learn.openFailed', { error: e && e.message ? e.message : e }), 'error');
        setTimeout(function () { throw e; }, 0);
      }
    }
  }

  function start() {
    var missing = [];
    if (!root.PDFLib) missing.push('pdf-lib');
    if (!root.pdfjsLib) missing.push('pdf.js');
    if (missing.length) {
      O.notify(D.t('app.no_library', { names: missing.join(D.t('app.ve')), hint: MC.platform.text.libraryHint }), 'error');
    }
    D.apply(document);
    if (O.setupNumberFields) O.setupNumberFields(document); // sayı alanları dilin ondalık ayracıyla
    fillLanguagePicker();
    var tabs = document.querySelectorAll('nav [role="tab"]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function (e) { openTab(e.currentTarget.getAttribute('data-tab')); });
    }
    MC.projects.start();
    MC.impose.start();
    MC.calculator.start();
    openTab(O.readLocal(TAB_KEY) || 'impose');
    document.documentElement.setAttribute('data-ready', 'yes');
  }

  // ---------------------------------------------------------------- dil seçimi
  /**
   * Seçimin karşılığı olan dil: 'sistem' → sistem dili (Tauri'de Rust'ın bildirdiği, menüdeki "Sistem dili (X)"
   * ile aynı kaynak; tarayıcıda navigator.languages). Apple kuralı i18n.js'te.
   */
  function languageForChoice(choice) { return D.isSupported(choice) ? choice : D.systemCode(); }

  /** Dil seçicinin seçenekleri (yeniden çağrılabilir: Tauri eşitlemesinden sonra sistem dilinin adı değişebilir). */
  function fillLanguagePicker() {
    var select = $('i18n-select');
    if (!select) return;
    // ipucu statik değil (index.html'de title yok): yeniden yüklemede eski dilde "Language" görünmez; her
    // doldurmada (açılış, Tauri eşitlemesi sonrası baslat) seçili dilde yazılır.
    if (typeof select.setAttribute === 'function') select.setAttribute('title', D.t('language.label'));
    if (typeof select.appendChild !== 'function') return;
    select.textContent = '';
    var options = [['system', D.t('language.system', { name: D.name(languageForChoice('system')) })]].concat(D.languages().map(function (k) { return [k, D.name(k)]; }));
    options.forEach(function (s) { select.appendChild(O.el('option', { value: s[0], text: s[1], lang: s[0] === 'system' ? null : s[0] })); });
    select.value = D.readChoice() || 'system';
  }

  /** Dil seçici: hemen doldurulur, değişiklik dinleyicisi bir kez bağlanır. */
  function setupLanguagePicker() {
    var select = $('i18n-select');
    fillLanguagePicker();
    if (!select || typeof select.appendChild !== 'function') return;
    select.addEventListener('change', function () {
      var requested = select.value;
      select.value = D.readChoice() || 'system'; // değişiklik dilDegistir onaylanınca yansır
      changeLanguage(requested);
    });
  }

  /**
   * Arayüz dilini değiştirir: secim 'sistem' | 'en' | 'tr'. Seçim saklanır (localStorage; Tauri'de Rust da
   * menüyü yeniden kurar ve seçimi yedekler); görünen dil değişiyorsa sayfa yeniden yüklenir (açık belge
   * varsa önce onay istenir). Promise<boolean>: değişti mi.
   */
  function changeLanguage(choice) {
    if (choice !== 'system' && !D.isSupported(choice)) return Promise.resolve(false);
    var previous = D.readChoice() || 'system';
    if (choice === previous) return Promise.resolve(false);
    var target = languageForChoice(choice);
    var needsReload = target !== D.code();
    var hasDocument = !!(MC.impose && MC.impose.summary && MC.impose.summary().pageCount > 0);
    var ask = needsReload && hasDocument ? MC.platform.ask(D.t('language.refresh_confirm')) : Promise.resolve(true);
    return ask.then(function (ok) {
      if (!ok) return false;
      // Önce Rust (Tauri: menü + yedek); başarısızsa seçim değişmez.
      return Promise.resolve(MC.platform.notifyLanguage ? MC.platform.notifyLanguage(target, choice) : null).then(function () {
        D.writeChoice(choice === 'system' ? null : choice);
        var select = $('i18n-select');
        if (select) select.value = choice;
        if (needsReload) root.location.reload();
        return true;
      });
    }).catch(function (e) {
      O.notify(D.t('language.setFailed', { error: e && e.message ? e.message : e }), 'error');
      return false;
    });
  }

  MC.app = { openTab: openTab, changeLanguage: changeLanguage };
  // seçici hemen dolar (hazir beklenmez); i18n.js yoksa seçici boş, statik İngilizce kalır.
  try { if (D) setupLanguagePicker(); } catch (e) { /* başlatma sürer; hata baslat'ta yeniden görünür */ }
  function prepareAndStart() {
    // .catch: platform.hazir reddi de, baslat() içinde atılan hata da bildirime gider. Dil altyapısı yoksa
    // (i18n.js yüklenemedi/hata attı) bildirim en sözlüğünün metniyle (statik arayüz de İngilizce).
    MC.platform.ready.then(start).catch(function (e) {
      var error = e && e.message ? e.message : e;
      O.notify(D ? D.t('app.startFailed', { error: error }) : "The app couldn't start: " + error, 'error');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepareAndStart);
  else prepareAndStart();
})(typeof self !== 'undefined' ? self : this);
