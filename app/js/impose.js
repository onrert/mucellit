/*
 * impose.js — Düzenle sekmesi: PDF yükleme, sayfa ızgarası (sil, sırala,
 * döndür, boş sayfa), dizilim ayarları, yaprak önizlemesi, dışa aktarma.
 */
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};
  var O = KC.ortak, $ = O.$, el = O.el, DIL = KC.dil; // (D bu dosyada belge durumu)
  function t(a, p) { return DIL.t(a, p); }
  var AYAR_ANAHTAR = 'kitapCilt.duzenleAyar';

  var D = {
    kaynakAd: '',
    kaynakBytes: null,
    pdf: null,
    resimler: {},
    sayfalar: [],
    secili: {},
    surukle: null,
    yuklemeNo: 0,
    istekNo: 0,       // dosya seçimi sıra numarası: bayat yükleme sonucu atılır
    ciktiPdf: null,
    sifreli: false,   // kaynak PDF şifreli/izin kısıtlı: pdf-lib çözemez, dışa aktarma kapalı
    denetimYok: false, // şifre/kısıt durumu denetlenemedi: dışa aktarma kapalı (kapalı başarısız)
    parolali: false,  // parolalı PDF seçildi: önizleme açılmadı
    eklentiOlcu: null, // eklentiyle (ör. EPUB) dönüştürüldüyse o andaki ölçüler {kitapGen, kitapYuk, ciltPayi, disKenar}
    engel: false      // dışa aktarma düğmesi kapalı olmalı mı (şifreli, kağıda sığmıyor, hata)
  };
  // Uyarı metinleri okundukları anda o anki dilde.
  function SIFRELI_UYARI() { return t('duzenle.uyari.sifreli'); }
  function PAROLALI_UYARI() { return t('duzenle.uyari.parolali'); }
  // ortama göre (tarayıcı: "sayfayı yenileyin"; Mac uygulaması: tauri.uyari_denetim)
  function DENETIM_UYARI() { return (KC.platform && KC.platform.metin && KC.platform.metin.denetimUyari) || t('duzenle.uyari.denetim'); }
  var sayac = 0;
  function yeniId() { sayac += 1; return 's' + sayac; }

  // ---------------- ayarlar ----------------
  var ALANLAR = {
    ciltTuru: ['cilt-turu', 'metin'], formaYaprak: ['forma-yaprak', 'sayi'], sonFormaKucult: ['son-forma-kucult', 'isaret'],
    kayma: ['kayma', 'isaret'], kagitKalinlik: ['kagit-kalinlik', 'sayi'], kagitGen: ['kagit-gen', 'sayi'], kagitYuk: ['kagit-yuk', 'sayi'],
    kitapGen: ['kitap-gen', 'sayi'], kitapYuk: ['kitap-yuk', 'sayi'], olcek: ['olcek', 'metin'], disKenar: ['dis-kenar', 'sayi'],
    ciltPayi: ['cilt-payi', 'sayi'], kirim: ['kirim', 'isaret'], katlama: ['katlama', 'isaret'], sirtIsareti: ['sirt-isareti', 'isaret'],
    cevirme: ['cevirme', 'metin'], ciktiModu: ['cikti-modu', 'metin'], arkaTers: ['arka-ters', 'isaret']
  };

  function ayarOku() {
    var a = {};
    Object.keys(ALANLAR).forEach(function (k) {
      var id = ALANLAR[k][0], tur = ALANLAR[k][1], e = $(id);
      if (tur === 'isaret') a[k] = e.checked;
      else if (tur === 'sayi') a[k] = O.sayi(id, NaN);
      else a[k] = e.value;
    });
    return a;
  }

  function ayarUygula(a) {
    if (!a) return;
    Object.keys(ALANLAR).forEach(function (k) {
      if (a[k] === undefined || a[k] === null) return;
      var id = ALANLAR[k][0], tur = ALANLAR[k][1], e = $(id);
      if (tur === 'isaret') e.checked = !!a[k];
      else if (tur === 'sayi') O.sayiYaz(e, a[k]); // dilin ondalık ayracı
      else e.value = a[k];
    });
    gorunurlukGuncelle();
    guncelle();
  }

  function gorunurlukGuncelle() {
    var tur = $('cilt-turu').value;
    $('forma-alanlari').hidden = tur !== 'formali';
    var ikili = $('cikti-modu').value === 'ikili';
    $('arka-ters-alan').hidden = !ikili;
    var etiket = ikili ? 'duzenle.cevirme.ikili' : 'duzenle.cevirme.tek';
    $('cevirme-etiket').setAttribute('data-dil', etiket);
    $('cevirme-etiket').textContent = t(etiket);
    var gen = O.sayi('kagit-gen', 0), yuk = O.sayi('kagit-yuk', 0);
    var doner = KC.yerlesim.arkaDondurulsunMu($('cevirme').value, gen, yuk);
    $('cevirme-ipucu').textContent = t(doner ? 'duzenle.cevirme.ipucu_donuk' : 'duzenle.cevirme.ipucu_duz',
      { yon: t(gen > yuk ? 'duzenle.yon.yatay' : 'duzenle.yon.dikey') });
    if (KC.platform && typeof KC.platform.yazdir === 'function') $('yazdir-not').textContent = yazdirNotu();
  }

  // ---------------- PDF yükleme ----------------
  function pdfjs() {
    var p = kok.pdfjsLib;
    if (!p) throw new Error(t('hata.pdfjs'));
    return p;
  }

  function belgeAc(bytes) {
    // isEvalSupported:false — kötü niyetli yazı tipi ile kod çalıştırma açığına karşı (pdf.js < 4.2.67)
    // Parola istemi yok (tarayıcı iletişim kutusu kullanılmaz): parolalı PDF PasswordException ile reddedilir, dosyaYukle yakalar.
    return pdfjs().getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  }

  /**
   * pdf-lib ile yüklenince belge şifreli mi (sahip parolalı/izin kısıtlı dahil)? pdf-lib şifre ÇÖZMEZ.
   * true: şifreli, false: değil, null: DENETLENEMEDİ (pdf-lib yok ya da ayrıştıramadı) → kapalı başarısız:
   * çağıran dışa aktarmayı kapatır.
   */
  async function sifreliMi(bytes) {
    try {
      if (!kok.PDFLib) throw new Error(t('hata.pdflib'));
      var d = await kok.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      return !!d.isEncrypted;
    } catch { return null; }
  }

  function parolaliBelge(ad) {
    if (D.pdf) { try { D.pdf.destroy(); } catch { /* yok say */ } }
    D.yuklemeNo += 1;
    D.pdf = null; D.kaynakBytes = null; D.kaynakAd = ad;
    D.sifreli = false; D.denetimYok = false; D.parolali = true; D.eklentiOlcu = null;
    D.resimler = {}; D.secili = {}; D.sayfalar = [];
    $('kaynak-bilgi').removeAttribute('data-dil');
    $('kaynak-bilgi').textContent = t('duzenle.kaynak.parolali', { ad: ad });
    kartlariCiz();
    guncelle();
    O.bildir(ad + ': ' + PAROLALI_UYARI(), 'hata');
  }

  /**
   * Yeni seçilen dosya açılamadı: önceki belge bırakılmaz (kullanıcı hata gördüğü halde eski belgeyi
   * indiremesin). Belge, kartlar ve eklenti uyarıları temizlenir, dışa aktarma kapanır. PDF ve EPUB için aynı.
   */
  function hataliBelge(ad) {
    if (D.pdf) { try { D.pdf.destroy(); } catch { /* yok say */ } }
    D.yuklemeNo += 1;
    D.pdf = null; D.kaynakBytes = null; D.kaynakAd = ad;
    D.sifreli = false; D.denetimYok = false; D.parolali = false; D.eklentiOlcu = null;
    D.resimler = {}; D.secili = {}; D.sayfalar = [];
    KC.eklentiler.hepsiniSifirla();
    $('kaynak-bilgi').removeAttribute('data-dil');
    $('kaynak-bilgi').textContent = t('duzenle.kaynak.acilamadi', { ad: ad });
    D.engel = true;
    ciktiDugmeleri(true);
    kartlariCiz();
    guncelle();
  }

  /**
   * Dosya seçimi sırası: her yükleme bir sıra numarası alır; await'ten dönünce daha yeni bir seçim varsa
   * bu (bayat) sonuç atılır, durum ve bildirim değişmez. Yeni yükleme başlarken eklenti uyarıları temizlenir.
   * Güncel istek hata verirse önceki belge temizlenir (hataliBelge) ve hata çağırana iletilir (bildirim).
   */
  async function dosyaYukle(dosya) {
    var no = ++D.istekNo;
    function bayat() { return no !== D.istekNo; }
    KC.eklentiler.hepsiniSifirla();
    try {
      return await yukle(dosya, bayat);
    } catch (e) {
      if (bayat()) return; // eski isteğin hatası yeni seçimin bildirimini ve durumunu bozmaz
      hataliBelge(dosya.name || t('duzenle.belge'));
      throw e;
    }
  }

  async function yukle(dosya, bayat) {
    var ad = dosya.name || t('duzenle.belge') + '.pdf';
    var bytes;
    var pdfMi = /\.pdf$/i.test(ad) || dosya.type === 'application/pdf';
    var eklentiOlcu = null;
    if (pdfMi) {
      bytes = new Uint8Array(await dosya.arrayBuffer());
    } else {
      var d = KC.eklentiler.bul(dosya);
      if (!d) throw new Error(t('duzenle.tur_desteklenmiyor', { ad: ad }));
      O.bildir(t('duzenle.donusturuluyor', { ad: d.ad }));
      eklentiOlcu = guncelOlcu();
      bytes = await d.donustur(dosya, {
        kitapGen: eklentiOlcu.kitapGen, kitapYuk: eklentiOlcu.kitapYuk,
        ciltPayi: eklentiOlcu.ciltPayi, disKenar: eklentiOlcu.disKenar,
        ilerleme: function (m) { if (!bayat()) O.bildir(m); },
        guncelMi: function () { return !bayat(); }
      });
      if (bayat()) return;
      if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
      ad = ad.replace(/(\.epub\.zip|\.[^.]+)$/i, '') + '.pdf'; // "Kitap.epub.zip" → "Kitap.pdf"
    }
    if (bayat()) return;
    var bas = String.fromCharCode.apply(null, bytes.subarray(0, 1024));
    if (bas.indexOf('%PDF') < 0) throw new Error(t('duzenle.pdf_degil', { ad: ad }));
    var pdf;
    try { pdf = await belgeAc(bytes); } catch (e) {
      if (bayat()) return;
      if (e && e.name === 'PasswordException') return parolaliBelge(ad);
      // pdf.js'in ham (İngilizce) hata metni kullanıcıya gösterilmez
      var h = new Error(t('duzenle.pdf_bozuk', { ad: ad }));
      h.cause = e;
      throw h;
    }
    var sifreli = await sifreliMi(bytes);
    if (bayat()) { try { pdf.destroy(); } catch { /* yok say */ } return; }
    if (D.pdf) { try { D.pdf.destroy(); } catch { /* yok say */ } }
    D.yuklemeNo += 1;
    D.pdf = pdf;
    D.kaynakBytes = bytes;
    D.kaynakAd = ad;
    D.sifreli = sifreli === true;
    D.denetimYok = sifreli === null;
    D.parolali = false;
    D.eklentiOlcu = eklentiOlcu;
    D.resimler = {};
    D.secili = {};
    D.sayfalar = [];
    for (var i = 0; i < pdf.numPages; i++) D.sayfalar.push({ id: yeniId(), tur: 'pdf', kaynak: i, dondur: 0 });
    var ilk = await pdf.getPage(1);
    var vp = ilk.getViewport({ scale: 1 });
    $('kaynak-bilgi').removeAttribute('data-dil');
    $('kaynak-bilgi').textContent = t('duzenle.kaynak.bilgi', { ad: ad, n: pdf.numPages,
      gen: Math.round(vp.width / KC.cikti.MM), yuk: Math.round(vp.height / KC.cikti.MM) });
    ciktiDugmeleri(true);  // onizlemeCiz şifreli/sığmıyor durumuna göre açar
    D.engel = true;
    kartlariCiz();
    guncelle();
    kucukResimleriUret(D.yuklemeNo);
    if (sifreli === null) O.bildir(t('duzenle.yuklendi_ama', { ad: ad, uyari: DENETIM_UYARI() }), 'hata');
    else if (sifreli) O.bildir(t('duzenle.yuklendi_ama', { ad: ad, uyari: SIFRELI_UYARI() }), 'hata');
    else O.bildir(t('duzenle.yuklendi', { ad: ad, n: pdf.numPages }));
  }

  async function kucukResimleriUret(no) {
    var pdf = D.pdf;
    for (var i = 0; i < pdf.numPages; i++) {
      if (no !== D.yuklemeNo) return;
      try {
        var sayfa = await pdf.getPage(i + 1);
        var vp1 = sayfa.getViewport({ scale: 1 });
        var olcek = Math.min(232 / vp1.height, 200 / vp1.width);
        var vp = sayfa.getViewport({ scale: olcek });
        var c = document.createElement('canvas');
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        await sayfa.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        if (no !== D.yuklemeNo) return;
        D.resimler[i] = c.toDataURL('image/png');
        var imgs = document.querySelectorAll('#kucuk-resimler img[data-kaynak="' + i + '"]');
        for (var j = 0; j < imgs.length; j++) imgs[j].src = D.resimler[i];
      } catch (e) {
        if (no !== D.yuklemeNo) return;
        O.bildir(t('duzenle.kucuk_resim_hatasi', { n: i + 1, hata: e.message }), 'hata');
      }
    }
    var izgara = $('kucuk-resimler');
    if (izgara) izgara.setAttribute('data-resimler-hazir', 'evet');
  }

  // ---------------- sayfa ızgarası ----------------
  function indisBul(id) {
    for (var i = 0; i < D.sayfalar.length; i++) if (D.sayfalar[i].id === id) return i;
    return -1;
  }

  function degisti() { kartlariCiz(); guncelle(); }

  function tasi(id, yeniIndis) {
    var i = indisBul(id);
    if (i < 0) return;
    var s = D.sayfalar.splice(i, 1)[0];
    if (yeniIndis > i) yeniIndis -= 1;
    D.sayfalar.splice(Math.max(0, Math.min(D.sayfalar.length, yeniIndis)), 0, s);
    degisti();
  }

  function kartlariCiz() {
    var izgara = $('kucuk-resimler');
    izgara.removeAttribute('data-resimler-hazir');
    izgara.textContent = '';
    var parca = document.createDocumentFragment();
    D.sayfalar.forEach(function (s, i) {
      var resim;
      if (s.tur === 'bos') {
        resim = el('div', { class: 'resim bos-sayfa', text: t('duzenle.kart.bos_sayfa') });
      } else {
        var img = el('img', { alt: t('duzenle.kart.kaynak_sayfa', { n: s.kaynak + 1 }), 'data-kaynak': String(s.kaynak), draggable: 'false' });
        if (D.resimler[s.kaynak]) img.src = D.resimler[s.kaynak];
        var d = s.dondur || 0;
        img.style.transform = 'rotate(' + d + 'deg)' + (d % 180 ? ' scale(0.7)' : '');
        resim = el('div', { class: 'resim' }, [img]);
      }
      var kart = el('div', {
        class: 'kart' + (D.secili[s.id] ? ' secili' : ''), draggable: 'true', 'data-id': s.id,
        'data-sira': String(i + 1), 'data-tur': s.tur, 'data-kaynak': s.tur === 'pdf' ? String(s.kaynak + 1) : ''
      }, [
        resim,
        el('div', { class: 'etiket' }, [
          el('label', {}, [
            el('input', { type: 'checkbox', class: 'kart-sec', checked: !!D.secili[s.id], 'aria-label': t('duzenle.kart.sec', { n: i + 1 }) }),
            ' ' + (i + 1)
          ]),
          el('span', { class: 'kucuk', text: s.tur === 'pdf' ? t('duzenle.kart.kaynak', { n: s.kaynak + 1 }) + (s.dondur ? ' · ' + s.dondur + '°' : '') : t('duzenle.kart.bos') })
        ]),
        el('div', { class: 'dugmeler' }, [
          el('button', { type: 'button', 'data-is': 'sol', title: t('duzenle.kart.one_al'), text: '◀' }),
          el('button', { type: 'button', 'data-is': 'dondur', title: t('duzenle.kart.dondur'), text: '⟳', disabled: s.tur === 'bos' }),
          el('button', { type: 'button', 'data-is': 'sil', title: t('duzenle.kart.sil'), text: '✕' }),
          el('button', { type: 'button', 'data-is': 'sag', title: t('duzenle.kart.arkaya_al'), text: '▶' })
        ])
      ]);
      parca.appendChild(kart);
    });
    izgara.appendChild(parca);
    if (D.pdf && Object.keys(D.resimler).length >= D.pdf.numPages) izgara.setAttribute('data-resimler-hazir', 'evet');
  }

  function kartOlaylari() {
    var izgara = $('kucuk-resimler');
    izgara.addEventListener('click', function (e) {
      var kart = e.target.closest('.kart');
      if (!kart) return;
      var id = kart.getAttribute('data-id');
      var i = indisBul(id);
      var is = e.target.getAttribute('data-is');
      if (e.target.classList.contains('kart-sec')) {
        if (e.target.checked) D.secili[id] = true; else delete D.secili[id];
        kart.classList.toggle('secili', !!D.secili[id]);
        return;
      }
      if (!is) return;
      if (is === 'sol') tasi(id, i - 1);
      else if (is === 'sag') tasi(id, i + 2);
      else if (is === 'sil') { D.sayfalar.splice(i, 1); delete D.secili[id]; degisti(); }
      else if (is === 'dondur') { var s = D.sayfalar[i]; s.dondur = ((s.dondur || 0) + 90) % 360; degisti(); }
    });
    izgara.addEventListener('dragstart', function (e) {
      var kart = e.target.closest('.kart');
      if (!kart) return;
      D.surukle = kart.getAttribute('data-id');
      kart.classList.add('surukleniyor');
      try { e.dataTransfer.setData('text/plain', D.surukle); e.dataTransfer.effectAllowed = 'move'; } catch { /* yok say */ }
    });
    izgara.addEventListener('dragend', function () {
      D.surukle = null;
      var k = izgara.querySelectorAll('.surukleniyor, .hedef');
      for (var i = 0; i < k.length; i++) k[i].classList.remove('surukleniyor', 'hedef');
    });
    izgara.addEventListener('dragover', function (e) {
      var kart = e.target.closest('.kart');
      if (!kart || !D.surukle) return;
      e.preventDefault();
      var onceki = izgara.querySelector('.hedef');
      if (onceki && onceki !== kart) onceki.classList.remove('hedef');
      kart.classList.add('hedef');
    });
    izgara.addEventListener('drop', function (e) {
      var kart = e.target.closest('.kart');
      if (!kart || !D.surukle) return;
      e.preventDefault();
      var hedefId = kart.getAttribute('data-id');
      if (hedefId === D.surukle) return;
      var r = kart.getBoundingClientRect();
      var sonra = e.clientX > r.left + r.width / 2;
      var j = indisBul(hedefId) + (sonra ? 1 : 0);
      var id = D.surukle;
      D.surukle = null;
      tasi(id, j);
    });
  }

  /** "1-4, 9" → [1,2,3,4,9] (1'den, geçerli sıra numaraları). */
  function aralikCoz(metin, enCok) {
    var sonuc = {};
    String(metin || '').split(/[,;\s]+/).forEach(function (p) {
      if (!p) return;
      var m = p.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) throw new Error(t('duzenle.aralik_hatali', { parca: p }));
      var a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
      if (a > b) { var gecici = a; a = b; b = gecici; }
      for (var i = Math.max(1, a); i <= Math.min(enCok, b); i++) sonuc[i] = true;
    });
    return Object.keys(sonuc).map(Number);
  }

  function seciliIndisler() {
    var l = [];
    D.sayfalar.forEach(function (s, i) { if (D.secili[s.id]) l.push(i); });
    return l;
  }

  /** Dosyayı açar; hata bildirime gider (Promise reddedilmez). Menü/Son Açılanlar/Dock'tan da çağrılır. */
  function dosyaAc(f) {
    return dosyaYukle(f).catch(function (err) { O.bildir(t('duzenle.dosya_acilamadi', { hata: err.message }), 'hata'); });
  }

  function aracOlaylari() {
    $('pdf-sec').addEventListener('click', function () {
      // Tarayıcıda gizli girdi açılır ve seçim aşağıdaki change olayıyla gelir (null döner);
      // yerel diyalog doğrudan File döndürür.
      KC.platform.dosyaSec({ girdi: $('pdf-dosya'), uzantilar: ['pdf', 'epub'], mime: 'application/pdf' })
        .then(function (f) { if (f) return dosyaAc(f); }, function (err) { O.bildir(t('duzenle.dosya_acilamadi', { hata: err.message }), 'hata'); });
    });
    $('pdf-dosya').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      dosyaAc(f).then(function () { e.target.value = ''; });
    });
    // Pencereye/sayfaya dosya bırakma: yalnız dışarıdan dosya sürüklenince; ızgaradaki sayfa
    // sürüklemesine (D.surukle) dokunulmaz. Bırakılmayan yerde tarayıcının dosyayı açıp sayfadan
    // ayrılması da önlenir.
    function dosyaSurukleniyor(e) {
      var turler = e.dataTransfer && e.dataTransfer.types;
      return !D.surukle && !!turler && Array.prototype.indexOf.call(turler, 'Files') >= 0;
    }
    document.addEventListener('dragover', function (e) {
      if (!dosyaSurukleniyor(e)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch { /* yok say */ }
    });
    document.addEventListener('drop', function (e) {
      if (e.defaultPrevented || !dosyaSurukleniyor(e)) return;
      e.preventDefault();
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (KC.uygulama) KC.uygulama.sekmeAc('duzenle');
      dosyaAc(f);
    });
    $('aralik-sec').addEventListener('click', function () {
      try {
        var l = aralikCoz($('aralik').value, D.sayfalar.length);
        D.secili = {};
        l.forEach(function (n) { D.secili[D.sayfalar[n - 1].id] = true; });
        kartlariCiz();
        O.bildir(t('duzenle.secildi', { n: l.length }));
      } catch (err) { O.bildir(err.message, 'hata'); }
    });
    $('tumunu-sec').addEventListener('click', function () {
      D.secili = {}; D.sayfalar.forEach(function (s) { D.secili[s.id] = true; }); kartlariCiz();
    });
    $('secimi-kaldir').addEventListener('click', function () { D.secili = {}; kartlariCiz(); });
    $('secili-sil').addEventListener('click', function () {
      var n = seciliIndisler().length;
      if (!n) return O.bildir(t('duzenle.once_sec'), 'hata');
      D.sayfalar = D.sayfalar.filter(function (s) { return !D.secili[s.id]; });
      D.secili = {}; degisti(); O.bildir(t('duzenle.silindi', { n: n }));
    });
    $('secili-disini-sil').addEventListener('click', function () {
      if (!seciliIndisler().length) return O.bildir(t('duzenle.once_sec'), 'hata');
      D.sayfalar = D.sayfalar.filter(function (s) { return D.secili[s.id]; });
      degisti();
    });
    $('secili-dondur').addEventListener('click', function () {
      var l = seciliIndisler();
      if (!l.length) return O.bildir(t('duzenle.once_sec'), 'hata');
      l.forEach(function (i) { var s = D.sayfalar[i]; if (s.tur === 'pdf') s.dondur = ((s.dondur || 0) + 90) % 360; });
      degisti();
    });
    $('bos-basa').addEventListener('click', function () { D.sayfalar.unshift({ id: yeniId(), tur: 'bos' }); degisti(); });
    $('bos-sona').addEventListener('click', function () { D.sayfalar.push({ id: yeniId(), tur: 'bos' }); degisti(); });
    $('bos-once').addEventListener('click', function () {
      var l = seciliIndisler();
      if (!l.length) return O.bildir(t('duzenle.once_sec'), 'hata');
      D.sayfalar.splice(l[0], 0, { id: yeniId(), tur: 'bos' });
      degisti();
    });
  }

  // ---------------- önizleme ----------------
  var guncelleBekliyor = false;
  function guncelle() {
    if (guncelleBekliyor) return;
    guncelleBekliyor = true;
    (kok.requestAnimationFrame || setTimeout)(function () { guncelleBekliyor = false; onizlemeCiz(); });
  }

  function dizilimHesapla() {
    var a = ayarOku();
    var dz = KC.dizilim.diz(a.ciltTuru, {
      sayfaSayisi: D.sayfalar.length, formaYaprak: a.formaYaprak, sonFormaKucult: a.sonFormaKucult,
      kaymaAcik: a.kayma, kagitKalinlik: a.kagitKalinlik
    });
    return { ayar: a, dizilim: dz, yerlesim: KC.yerlesim.yerlesim(dz, a) };
  }

  /** Eklentiye verilen ölçüler (mm): Düzenle > Ölçüler. */
  function guncelOlcu() {
    return { kitapGen: O.sayi('kitap-gen', 148), kitapYuk: O.sayi('kitap-yuk', 210), ciltPayi: O.sayi('cilt-payi', 0), disKenar: O.sayi('dis-kenar', 0) };
  }

  /** Eklentiyle dönüştürülmüş belge, şimdiki ölçülerden farklı ölçülerle dizildiyse uyarı metni; değilse null. */
  function eklentiOlcuUyarisi() {
    var e = D.eklentiOlcu;
    if (!e) return null;
    var g = guncelOlcu();
    var ayni = ['kitapGen', 'kitapYuk', 'ciltPayi', 'disKenar'].every(function (k) { return Math.abs(e[k] - g[k]) < 1e-9; });
    if (ayni) return null;
    return t('duzenle.uyari.eklenti_olcu', { gen: e.kitapGen, yuk: e.kitapYuk, cilt: e.ciltPayi, dis: e.disKenar });
  }

  function onizlemeCiz() {
    var kap = $('yaprak-onizleme'), uy = $('uyarilar'), oz = $('dizilim-ozet');
    kap.textContent = ''; uy.textContent = ''; oz.textContent = '';
    O.yerelYaz(AYAR_ANAHTAR, JSON.stringify(ayarOku()));
    var olcuUyari = D.sayfalar.length ? eklentiOlcuUyarisi() : null;
    if (olcuUyari) uy.appendChild(el('div', { class: 'uyari', id: 'eklenti-olcu-uyari', text: olcuUyari }));
    if (!D.sayfalar.length) {
      oz.textContent = t('duzenle.onizleme_icin');
      if (D.parolali) uy.appendChild(el('div', { class: 'uyari', id: 'parolali-uyari', text: PAROLALI_UYARI() }));
      D.engel = true; ciktiDugmeleri(true);
      return;
    }
    if (D.sifreli) uy.appendChild(el('div', { class: 'uyari', id: 'sifreli-uyari', text: SIFRELI_UYARI() }));
    if (D.denetimYok) uy.appendChild(el('div', { class: 'uyari', id: 'denetim-uyari', text: DENETIM_UYARI() }));
    var r;
    try { r = dizilimHesapla(); } catch (e) {
      uy.appendChild(el('div', { class: 'uyari', text: e.message }));
      D.engel = true; ciktiDugmeleri(true);
      return;
    }
    // Şifreli PDF ya da kağıda sığmayan yerleşim: indirme kapalı (uyarı yukarıda/aşağıda görünür)
    D.engel = D.sifreli || D.denetimYok || !!r.yerlesim.sigmiyor;
    ciktiDugmeleri(D.engel);
    var dz = r.dizilim;
    var parcalar = [t('duzenle.ozet.tamamlandi', { n: D.sayfalar.length, toplam: dz.toplamSayfa, bos: dz.toplamSayfa - D.sayfalar.length })];
    if (dz.tur === 'formali') parcalar.push(t('duzenle.ozet.forma', { n: dz.formalar.length }));
    parcalar.push(t('duzenle.ozet.kagit', { n: dz.yapraklar.length, yuz: 2 * dz.yapraklar.length }));
    oz.textContent = parcalar.join(' · ');
    r.yerlesim.uyarilar.forEach(function (u) { uy.appendChild(el('div', { class: 'uyari', text: u })); });

    var yuzler = r.yerlesim.yuzler;
    for (var i = 0; i < yuzler.length; i += 2) {
      var on = yuzler[i], arka = yuzler[i + 1];
      var baslik = dz.tur === 'formali'
        ? t(on.formaIci === 0 ? 'duzenle.yaprak.forma_dis' : 'duzenle.yaprak.forma', { forma: on.forma + 1, yaprak: on.formaIci + 1 })
        : t('duzenle.yaprak.kagit', { n: on.yaprak + 1 });
      kap.appendChild(el('div', { class: 'yaprak-kart', 'data-yaprak': String(on.yaprak) }, [
        el('div', { class: 'baslik' }, [el('span', { text: baslik }), el('span', { text: t('duzenle.yaprak.cikti_sayfa', { a: i + 1, b: i + 2 }) })]),
        el('div', { class: 'yuzler' }, [
          el('div', {}, [yuzTuvali(r.yerlesim, on), el('div', { class: 'yuz-adi', text: t('duzenle.yaprak.on', { sayfalar: on.yuvalar.map(sayfaAdi).join(' | ') }) })]),
          el('div', {}, [yuzTuvali(r.yerlesim, arka), el('div', { class: 'yuz-adi', text: t(arka.dondur180 ? 'duzenle.yaprak.arka_donuk' : 'duzenle.yaprak.arka', { sayfalar: arka.yuvalar.map(sayfaAdi).join(' | ') }) })])
        ])
      ]));
    }
  }

  function sayfaAdi(yv) { return yv.bos ? t('duzenle.yaprak.bos_sayfa', { n: yv.sayfa }) : String(yv.sayfa); }

  function yuzTuvali(yer, yuz) {
    var W = 280, PW = yer.kagit.gen, PH = yer.kagit.yuk;
    var k = W / PW, H = Math.round(PH * k);
    var c = el('canvas', { width: W, height: H, 'aria-label': t(yuz.yuz === 'on' ? 'duzenle.yaprak.on_yuz' : 'duzenle.yaprak.arka_yuz', { sayfalar: yuz.yuvalar.map(sayfaAdi).join(', ') }) });
    var g = c.getContext('2d');
    function X(x) { return x * k; }
    function Y(y) { return H - y * k; } // PDF: alt sol başlangıç
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#9a8f82'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, W - 1, H - 1);
    yuz.yuvalar.forEach(function (yv) {
      var v = yv.yuva;
      var x = X(v.x), y = Y(v.y + v.h), w = v.w * k, h = v.h * k;
      if (yv.bos) {
        g.fillStyle = '#ebe6de'; g.fillRect(x, y, w, h);
        g.strokeStyle = '#d6cfc4'; g.lineWidth = 1;
        g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
        for (var ti = -h; ti < w; ti += 8) { g.beginPath(); g.moveTo(x + ti, y + h); g.lineTo(x + ti + h, y); g.stroke(); }
        g.restore();
      } else {
        g.fillStyle = '#f7efe4'; g.fillRect(x, y, w, h);
        var ic = yv.icerik;
        g.strokeStyle = '#d9b99b'; g.setLineDash([3, 2]);
        g.strokeRect(X(ic.x) + 0.5, Y(ic.y + ic.h) + 0.5, ic.w * k - 1, ic.h * k - 1);
        g.setLineDash([]);
      }
      g.strokeStyle = '#7a6f62'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      // sırt tarafı: kalın çizgi
      g.strokeStyle = '#8a3b12'; g.lineWidth = 3;
      var sirtSol = (yv.sirtTaraf === 'sol') !== !!yuz.dondur180;
      g.beginPath(); var sx = sirtSol ? x + 1.5 : x + w - 1.5; g.moveTo(sx, y); g.lineTo(sx, y + h); g.stroke();
      g.save();
      g.translate(x + w / 2, y + h / 2);
      if (yuz.dondur180) g.rotate(Math.PI);
      g.fillStyle = yv.bos ? '#9a8f82' : '#2a241d';
      g.font = '600 ' + Math.round(Math.min(w, h) * 0.32) + 'px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(yv.sayfa), 0, 0);
      if (yv.kayma) { g.font = '10px system-ui, sans-serif'; g.fillText(t('duzenle.yaprak.kayma', { mm: yv.kayma }), 0, h * 0.3); }
      g.restore();
    });
    g.strokeStyle = '#333'; g.lineWidth = 1;
    yuz.cizgiler.forEach(function (cz) {
      g.setLineDash(cz.kesik ? [3, 3] : []);
      g.beginPath(); g.moveTo(X(cz.x1), Y(cz.y1)); g.lineTo(X(cz.x2), Y(cz.y2)); g.stroke();
    });
    g.setLineDash([]);
    // forma sırt işareti: önizlemede okunur olsun diye en az 6 px
    yuz.kareler.forEach(function (kr) {
      var w = Math.max(6, kr.w * k), h = Math.max(6, kr.h * k);
      var cx = X(kr.x + kr.w / 2), cy = Y(kr.y + kr.h / 2);
      g.fillStyle = '#fff'; g.fillRect(cx - w / 2 - 1, cy - h / 2 - 1, w + 2, h + 2); // okunur zemin
      g.fillStyle = '#000';
      // biçim (dolu / çerçeve / küçük kareler) en az 6 × 6 px kutuya ölçeklenir
      var ox = w / (kr.w * k), oy = h / (kr.h * k);
      KC.yerlesim.isaretParcalari(kr).forEach(function (pr) {
        g.fillRect(cx - w / 2 + (pr.x - kr.x) * k * ox, cy - h / 2 + (kr.y + kr.h - pr.y - pr.h) * k * oy, Math.max(1, pr.w * k * ox), Math.max(1, pr.h * k * oy));
      });
    });
    return c;
  }

  // ---------------- dışa aktarma ----------------
  // Çıktı düğmeleri: Kaydet/İndir, Yazdır…, Önizleme'de Aç (son ikisi yalnız platform.yazdir varsa görünür).
  var CIKTI_DUGMELERI = ['disa-aktar', 'yazdir', 'onizlemede-ac'];
  // bir çıktı işi sürerken (PDF üretimi, Kaydet/baskı penceresi) düğmeler kapalı kalır; ayar
  // değişince yeniden çizilen önizleme (onizlemeCiz → ciktiDugmeleri(D.engel)) onları açmaz, ikinci iş başlamaz.
  var ciktiSuruyor = false;
  function ciktiDugmeleri(kapali) {
    CIKTI_DUGMELERI.forEach(function (id) { var b = $(id); if (b) b.disabled = kapali || ciktiSuruyor; });
  }

  /** yazdırma düğmeleri yalnız yerel baskı varsa (Mac uygulaması); not araçtaki çift yüz seçimini söyler. */
  function yazdirmaGorunurlugu() {
    var var_ = !!(KC.platform && typeof KC.platform.yazdir === 'function');
    $('yazdir-alani').hidden = !var_;
    $('yazdir-not').hidden = !var_;
    $('onizlemede-ac').hidden = !(var_ && typeof KC.platform.onizlemedeAc === 'function');
    if (var_) $('yazdir-not').textContent = yazdirNotu();
  }
  function yazdirNotu() {
    return KC.yazdirma.not({ t: t }, $('cikti-modu').value === 'ikili', $('cevirme').value);
  }

  /**
   * Çıktıyı üretip işe verir (Kaydet/İndir, Yazdır, Önizleme). Çalışırken bütün çıktı düğmeleri kapalı ve tıklanan
   * aria-busy (D10: menü kısayolları bu sırada yok sayılır, "önce PDF açın" denmez). is(sonuc) Promise döner.
   */
  async function ciktiIsi(dugmeId, is) {
    if (ciktiSuruyor) return; // aria-busy: iş sürüyor (düğme/menü/kısayol ikinci işi başlatmaz)
    if (!D.sayfalar.length) return O.bildir(t('duzenle.once_pdf'), 'hata');
    if (D.sifreli) return O.bildir(SIFRELI_UYARI(), 'hata');
    if (D.denetimYok) return O.bildir(DENETIM_UYARI(), 'hata');
    var btn = $(dugmeId);
    ciktiSuruyor = true;
    ciktiDugmeleri(true);
    CIKTI_DUGMELERI.forEach(function (id) { var b = $(id); if (b) b.setAttribute('aria-busy', 'true'); });
    var eskiYazi = btn.textContent;
    btn.textContent = t('duzenle.hazirlaniyor');
    try {
      var sonuc = await KC.cikti.uret({ kaynakBytes: D.kaynakBytes, sayfalar: D.sayfalar, ayar: ayarOku(), dosyaAdi: D.kaynakAd });
      await is(sonuc);
    } catch (e) {
      O.bildir(t('duzenle.cikti_uretilemedi', { hata: e.message }), 'hata');
    } finally {
      ciktiSuruyor = false;
      CIKTI_DUGMELERI.forEach(function (id) { var b = $(id); if (b) b.removeAttribute('aria-busy'); });
      ciktiDugmeleri(D.engel);
      btn.textContent = eskiYazi;
    }
  }

  /** Yazdır… (tek PDF ya da önler → çevir onayı → arkalar); not baskı penceresinden önce gösterilir. */
  function yazdir() {
    return ciktiIsi('yazdir', async function (sonuc) {
      await ciktiOnizle(sonuc.dosyalar[0].bytes);
      O.bildir(yazdirNotu());
      var r = await KC.yazdirma.yazdir(sonuc.dosyalar, { platform: KC.platform, t: t });
      O.bildir(r.metin, r.tur);
    });
  }

  /** Önizleme'de Aç (açılamazsa Kaydet + "Önizleme'de basın" notu: printing.js). */
  function onizlemedeAc() {
    return ciktiIsi('onizlemede-ac', async function (sonuc) {
      await ciktiOnizle(sonuc.dosyalar[0].bytes);
      var r = await KC.yazdirma.onizlemedeAc(sonuc.dosyalar, { platform: KC.platform, t: t });
      O.bildir(r.metin, r.tur);
    });
  }

  function disaAktar() {
    return ciktiIsi('disa-aktar', async function (sonuc) {
      if (KC.platform.yerelDosya) {
        // Yerel Kaydet penceresi (Tauri): dosyalar sırayla kaydedilir, bildirim gerçek sonucu söyler.
        await ciktiOnizle(sonuc.dosyalar[0].bytes);
        var kayit = await KC.platform.hepsiniKaydet(sonuc.dosyalar, 'application/pdf');
        var m = KC.platform.kayitMesaji(kayit, sonuc.yerlesim.yuzler.length);
        O.bildir(m.metin, m.tur);
        return;
      }
      sonuc.dosyalar.forEach(function (d, i) {
        setTimeout(function () {
          O.indir(d.ad, d.bytes, 'application/pdf').catch(function (err) { O.bildir(t('kayit.kaydedilemedi', { ad: d.ad, hata: err.message }), 'hata'); });
        }, i * 600);
      });
      await ciktiOnizle(sonuc.dosyalar[0].bytes);
      O.bildir(t('duzenle.hazir', { adlar: sonuc.dosyalar.map(function (d) { return d.ad; }).join(t('uygulama.ve')), n: sonuc.yerlesim.yuzler.length }));
    });
  }

  async function ciktiOnizle(bytes) {
    var kap = $('cikti-onizleme');
    kap.textContent = '';
    kap.removeAttribute('data-hazir');
    if (D.ciktiPdf) { try { D.ciktiPdf.destroy(); } catch { /* yok say */ } D.ciktiPdf = null; }
    var pdf = await belgeAc(bytes);
    D.ciktiPdf = pdf;
    var adet = Math.min(2, pdf.numPages);
    for (var i = 1; i <= adet; i++) {
      var s = await pdf.getPage(i);
      var vp1 = s.getViewport({ scale: 1 });
      var vp = s.getViewport({ scale: 520 / vp1.width });
      var c = el('canvas', { width: Math.ceil(vp.width), height: Math.ceil(vp.height), 'aria-label': t('duzenle.cikti_sayfa', { n: i }) });
      c.style.width = Math.ceil(vp.width / 1.3) + 'px';
      await s.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      kap.appendChild(c);
    }
    kap.setAttribute('data-hazir', 'evet');
  }

  // ---------------- kitaba kaydet ----------------
  /** Süreç sekmesinin bellekteki güncel verisi (saklama dolu olsa da en yenisi); yoksa depodan. */
  function guncelVeri() {
    var v = (KC.surec && KC.surec.veri && KC.surec.veri()) || KC.depo.oku();
    return JSON.parse(JSON.stringify(v)); // kopya: çağıran canlı veriyi değiştiremez
  }

  function kitapListesiYenile() {
    var sec = $('ayar-kitap');
    var onceki = sec.value;
    var veri = guncelVeri();
    sec.textContent = '';
    if (!veri.kitaplar.length) sec.appendChild(el('option', { value: '', text: t('duzenle.kitap_yok_once') }));
    veri.kitaplar.forEach(function (k) { sec.appendChild(el('option', { value: k.id, text: k.ad })); });
    if (onceki && KC.surecModel.kitapBul(veri, onceki)) sec.value = onceki;
  }

  function kaydetOlaylari() {
    $('ayar-kaydet').addEventListener('click', function () {
      var id = $('ayar-kitap').value;
      if (!id) return O.bildir(t('duzenle.once_kitap'), 'hata');
      var a = ayarOku();
      KC.surec.ayarKaydet(id, a, D.kaynakAd);
      O.bildir(t('duzenle.ayar_kaydedildi'));
    });
    $('ayar-yukle').addEventListener('click', function () {
      var id = $('ayar-kitap').value;
      var veri = guncelVeri();
      var k = id && KC.surecModel.kitapBul(veri, id);
      if (!k || !k.ayar) return O.bildir(t('duzenle.ayar_yok'), 'hata');
      ayarUygula(k.ayar);
      O.bildir(k.pdfAdi ? t('duzenle.ayar_yuklendi_pdf', { ad: k.ad, pdf: k.pdfAdi }) : t('duzenle.ayar_yuklendi', { ad: k.ad }));
    });
  }

  // ---------------- başlat ----------------
  function hazirOlcuDoldur(secId, genId, yukId, yatay) {
    var sec = $(secId);
    O.HAZIR_OLCULER.forEach(function (o) {
      sec.appendChild(el('option', { value: o.gen + 'x' + o.yuk, text: t('duzenle.hazir.dikey', { ad: o.ad, gen: o.gen, yuk: o.yuk }) }));
      if (yatay) sec.appendChild(el('option', { value: o.yuk + 'x' + o.gen, text: t('duzenle.hazir.yatay', { ad: o.ad, gen: o.yuk, yuk: o.gen }) }));
    });
    sec.addEventListener('change', function () {
      if (!sec.value) return;
      var p = sec.value.split('x');
      O.sayiYaz(genId, Number(p[0])); O.sayiYaz(yukId, Number(p[1]));
      sec.value = '';
      guncelle();
    });
  }

  function cevir(genId, yukId) {
    var g = $(genId).value; $(genId).value = $(yukId).value; $(yukId).value = g; guncelle();
  }

  function baslat() {
    hazirOlcuDoldur('kagit-hazir', 'kagit-gen', 'kagit-yuk', true);
    hazirOlcuDoldur('kitap-hazir', 'kitap-gen', 'kitap-yuk', false);
    $('kagit-cevir').addEventListener('click', function () { cevir('kagit-gen', 'kagit-yuk'); });
    $('kitap-cevir').addEventListener('click', function () { cevir('kitap-gen', 'kitap-yuk'); });
    var kayitli = O.yerelOku(AYAR_ANAHTAR);
    if (kayitli) { try { ayarUygula(JSON.parse(kayitli)); } catch { /* bozuk kayıt: varsayılanlar */ } }
    $('ayarlar').addEventListener('input', function () { gorunurlukGuncelle(); guncelle(); });
    $('ayarlar').addEventListener('change', function () { gorunurlukGuncelle(); guncelle(); });
    $('disa-aktar').addEventListener('click', disaAktar);
    $('yazdir').addEventListener('click', yazdir);
    $('onizlemede-ac').addEventListener('click', onizlemedeAc);
    yazdirmaGorunurlugu();
    $('pdf-dosya').setAttribute('accept', KC.eklentiler.kabul());
    if (KC.eklentiler.liste().length > 0) { $('pdf-sec').setAttribute('data-dil', 'duzenle.pdf_epub_sec'); $('pdf-sec').textContent = t('duzenle.pdf_epub_sec'); }
    KC.eklentiler.arayuzleriKur($('eklenti-ayarlari'));
    kartOlaylari();
    aracOlaylari();
    kaydetOlaylari();
    kitapListesiYenile();
    gorunurlukGuncelle();
    guncelle();
  }

  function ozet() {
    var a = ayarOku();
    return { sayfaSayisi: D.sayfalar.length, ayar: a };
  }

  KC.duzenle = { baslat: baslat, dosyaAc: dosyaAc, ayarOku: ayarOku, ayarUygula: ayarUygula, guncelVeri: guncelVeri, kitapListesiYenile: kitapListesiYenile, ozet: ozet, aralikCoz: aralikCoz };
})(typeof self !== 'undefined' ? self : this);
