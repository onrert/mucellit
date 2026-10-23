/*
 * app.js — sekmeler ve başlatma. En son yüklenir.
 * statik etiketleri i18n.js kendisi yükler yüklenmez yazar; burada dil seçici de hemen doldurulur
 * (platform.hazir reddedilse de arayüz metinli). baslat() etiketleri yeniden uygular (Tauri dil eşitlemesi dili
 * değiştirmiş olabilir). i18n.js hiç çalışmadıysa (KC.dil yok) arayüz index.html'in statik İngilizcesiyle kalır ve
 * başlatma hatası İngilizce bildirilir.
 */
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};
  var O = KC.ortak, $ = O.$, D = KC.dil;
  var SEKME_ANAHTAR = 'kitapCilt.sekme';
  var SEKMELER = ['duzenle', 'surec', 'hesapla', 'ogren']; // 4. sekme Öğren (Görünüm > Öğren ⌘4)

  /**
   * Öğren sekmesi açılınca rehber kurulur (ilk kez) ya da figürü yeniden kurulur; başka sekmeye geçince
   * "baştan sona" durur ve figür sökülür (gizli sekmede animasyon/rAF çalışmaz). Sekme gizlendikten SONRA gizle,
   * gösterildikten SONRA goster çağrılır (figür ölçüsü görünür panelde alınır).
   */
  function ogrenSekmesi() { return KC.ogren && KC.ogren.sekme ? KC.ogren.sekme : null; }

  function sekmeAc(ad) {
    if (SEKMELER.indexOf(ad) < 0) ad = 'duzenle';
    SEKMELER.forEach(function (s) {
      $('sekme-' + s).hidden = s !== ad;
      $('sekme-dugme-' + s).setAttribute('aria-selected', s === ad ? 'true' : 'false');
    });
    O.yerelYaz(SEKME_ANAHTAR, ad);
    var og = ogrenSekmesi();
    if (og) {
      try { if (ad === 'ogren') og.goster(); else og.gizle(); }
      catch (e) { // sekme geçişi yarıda kalmaz; hata bildirilir ve gizlenmez (konsolda da görünür)
        O.bildir(D.t('ogren.acilamadi', { hata: e && e.message ? e.message : e }), 'hata');
        setTimeout(function () { throw e; }, 0);
      }
    }
  }

  function baslat() {
    var eksik = [];
    if (!kok.PDFLib) eksik.push('pdf-lib');
    if (!kok.pdfjsLib) eksik.push('pdf.js');
    if (eksik.length) {
      O.bildir(D.t('uygulama.kutuphane_yok', { adlar: eksik.join(D.t('uygulama.ve')), ipucu: KC.platform.metin.kutuphaneIpucu }), 'hata');
    }
    D.uygula(document);
    if (O.sayiAlanlariKur) O.sayiAlanlariKur(document); // sayı alanları dilin ondalık ayracıyla
    dilSeciciDoldur();
    var sekmeler = document.querySelectorAll('nav [role="tab"]');
    for (var i = 0; i < sekmeler.length; i++) {
      sekmeler[i].addEventListener('click', function (e) { sekmeAc(e.currentTarget.getAttribute('data-sekme')); });
    }
    KC.surec.baslat();
    KC.duzenle.baslat();
    KC.hesapla.baslat();
    sekmeAc(O.yerelOku(SEKME_ANAHTAR) || 'duzenle');
    document.documentElement.setAttribute('data-hazir', 'evet');
  }

  // ---------------------------------------------------------------- dil seçimi
  /**
   * Seçimin karşılığı olan dil: 'sistem' → sistem dili (Tauri'de Rust'ın bildirdiği, menüdeki "Sistem dili (X)"
   * ile aynı kaynak; tarayıcıda navigator.languages). Apple kuralı i18n.js'te.
   */
  function secimDili(secim) { return D.destekli(secim) ? secim : D.sistemKodu(); }

  /** Dil seçicinin seçenekleri (yeniden çağrılabilir: Tauri eşitlemesinden sonra sistem dilinin adı değişebilir). */
  function dilSeciciDoldur() {
    var sec = $('dil-sec');
    if (!sec) return;
    // ipucu statik değil (index.html'de title yok): yeniden yüklemede eski dilde "Language" görünmez; her
    // doldurmada (açılış, Tauri eşitlemesi sonrası baslat) seçili dilde yazılır.
    if (typeof sec.setAttribute === 'function') sec.setAttribute('title', D.t('dil.etiket'));
    if (typeof sec.appendChild !== 'function') return;
    sec.textContent = '';
    var secenekler = [['sistem', D.t('dil.sistem', { ad: D.ad(secimDili('sistem')) })]].concat(D.diller().map(function (k) { return [k, D.ad(k)]; }));
    secenekler.forEach(function (s) { sec.appendChild(O.el('option', { value: s[0], text: s[1], lang: s[0] === 'sistem' ? null : s[0] })); });
    sec.value = D.secimOku() || 'sistem';
  }

  /** Dil seçici: hemen doldurulur, değişiklik dinleyicisi bir kez bağlanır. */
  function dilSeciciKur() {
    var sec = $('dil-sec');
    dilSeciciDoldur();
    if (!sec || typeof sec.appendChild !== 'function') return;
    sec.addEventListener('change', function () {
      var istenen = sec.value;
      sec.value = D.secimOku() || 'sistem'; // değişiklik dilDegistir onaylanınca yansır
      dilDegistir(istenen);
    });
  }

  /**
   * Arayüz dilini değiştirir: secim 'sistem' | 'en' | 'tr'. Seçim saklanır (localStorage; Tauri'de Rust da
   * menüyü yeniden kurar ve seçimi yedekler); görünen dil değişiyorsa sayfa yeniden yüklenir (açık belge
   * varsa önce onay istenir). Promise<boolean>: değişti mi.
   */
  function dilDegistir(secim) {
    if (secim !== 'sistem' && !D.destekli(secim)) return Promise.resolve(false);
    var onceki = D.secimOku() || 'sistem';
    if (secim === onceki) return Promise.resolve(false);
    var hedef = secimDili(secim);
    var yenilenecek = hedef !== D.kod();
    var belgeVar = !!(KC.duzenle && KC.duzenle.ozet && KC.duzenle.ozet().sayfaSayisi > 0);
    var sor = yenilenecek && belgeVar ? KC.platform.onayla(D.t('dil.onay_yenile')) : Promise.resolve(true);
    return sor.then(function (ok) {
      if (!ok) return false;
      // Önce Rust (Tauri: menü + yedek); başarısızsa seçim değişmez.
      return Promise.resolve(KC.platform.dilBildir ? KC.platform.dilBildir(hedef, secim) : null).then(function () {
        D.secimYaz(secim === 'sistem' ? null : secim);
        var sec = $('dil-sec');
        if (sec) sec.value = secim;
        if (yenilenecek) kok.location.reload();
        return true;
      });
    }).catch(function (e) {
      O.bildir(D.t('dil.ayarlanamadi', { hata: e && e.message ? e.message : e }), 'hata');
      return false;
    });
  }

  KC.uygulama = { sekmeAc: sekmeAc, dilDegistir: dilDegistir };
  // seçici hemen dolar (hazir beklenmez); i18n.js yoksa seçici boş, statik İngilizce kalır.
  try { if (D) dilSeciciKur(); } catch (e) { /* başlatma sürer; hata baslat'ta yeniden görünür */ }
  function hazirlaVeBaslat() {
    // .catch: platform.hazir reddi de, baslat() içinde atılan hata da bildirime gider. Dil altyapısı yoksa
    // (i18n.js yüklenemedi/hata attı) bildirim en sözlüğünün metniyle (statik arayüz de İngilizce).
    KC.platform.hazir.then(baslat).catch(function (e) {
      var hata = e && e.message ? e.message : e;
      O.bildir(D ? D.t('uygulama.baslatilamadi', { hata: hata }) : "The app couldn't start: " + hata, 'hata');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hazirlaVeBaslat);
  else hazirlaVeBaslat();
})(typeof self !== 'undefined' ? self : this);
