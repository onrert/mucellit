/* hesapla.js — Hesapla sekmesi arayüzü (hesap.js'i kullanır).
 * son çizimin girdisi ve sonucu KitapCilt.hesapla.durum() ile okunur (Öğren rehberinin sayı paneli aynı kaynağı
 * kullanır; ayrı hesap yapmaz). */
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};
  var O = KC.ortak, $ = O.$, el = O.el, D = KC.dil;
  function t(a, p) { return D.t(a, p); }
  var SAYI_ALANLARI = ['sayfaSayisi', 'formaYaprak', 'kagitKalinlik', 'forzaPayi', 'kitapGen', 'kitapYuk',
    'mukavvaKalinlik', 'tasma', 'egriBoyu', 'mafsal', 'kivirma', 'yedekKagit'];

  function girdiOku() {
    var g = { ciltTuru: $('h-ciltTuru').value, sonFormaKucult: $('h-sonFormaKucult').checked,
      sirtTipi: $('h-sirtTipi').value, sirtKurali: $('h-sirtKurali').value };
    var hatalar = [];
    SAYI_ALANLARI.forEach(function (k) {
      var ham = $('h-' + k).value; // "," ya da "."; ortak katı ayrıştırıcı
      var hata = O.sayiHatasi(ham);
      if (hata) hatalar.push(hata);
      g[k] = String(ham).trim() === '' ? undefined : O.sayiCoz(ham);
    });
    g.hatalar = hatalar;
    if (g.mafsal === undefined) g.mafsal = 'otomatik';
    return g;
  }

  function mm(x) { return D.sayi(Math.round(x * 10) / 10) + ' mm'; }
  function olcu(o) { return mm(o.gen) + ' × ' + mm(o.yuk); }

  // son çizimin girdisi/sonucu ya da hatası (Öğren sayı paneli okur)
  var son = { hata: null, girdi: null, sonuc: null };

  function ciz() {
    var tablo = $('h-sonuc'), hata = $('h-hata'), uyari = $('h-uyarilar');
    tablo.textContent = ''; hata.textContent = ''; uyari.textContent = '';
    $('h-egriBoyu').disabled = $('h-sirtTipi').value !== 'yuvarlak';
    $('h-sirtKurali').disabled = $('h-sirtTipi').value === 'yuvarlak';
    var r;
    var girdi = girdiOku();
    if (girdi.hatalar.length) { // geçersiz sayı: sessiz hesap yok, hata gösterilir
      girdi.hatalar.forEach(function (m) { hata.appendChild(el('div', { class: 'uyari', text: m })); });
      son = { hata: girdi.hatalar.join(' '), girdi: null, sonuc: null };
      return;
    }
    delete girdi.hatalar;
    if (girdi.sayfaSayisi === undefined) {
      hata.appendChild(el('div', { class: 'uyari', text: t('hesapla.sayfa_girin') }));
      son = { hata: t('hesapla.sayfa_girin'), girdi: null, sonuc: null };
      return;
    }
    try { r = KC.hesap.hesapla(girdi); } catch (e) {
      hata.appendChild(el('div', { class: 'uyari', text: e.message }));
      son = { hata: e.message, girdi: null, sonuc: null };
      return;
    }
    son = { hata: null, girdi: girdi, sonuc: r };
    var f = r.mafsal, tk = r.girdi.mukavvaKalinlik, k = r.girdi.tasma, e = r.girdi.kivirma; // tk: mukavva t (t() metin)
    var yuvarlak = r.girdi.sirtTipi === 'yuvarlak';
    var yalnizS = !yuvarlak && r.girdi.sirtKurali === 'yalnizS';
    var sf = t(yuvarlak ? 'hesapla.formul.sirt_yuvarlak' : yalnizS ? 'hesapla.formul.sirt_s' : 'hesapla.formul.sirt_s2t');
    var satirlar = [
      [t('hesapla.sonuc.toplam_sayfa'), r.bosSayfa ? t('hesapla.sonuc.toplam_bos', { n: r.toplamSayfa, bos: r.bosSayfa }) : String(r.toplamSayfa), 'toplamSayfa', ''],
      [t('hesapla.sonuc.kitap_yapragi'), String(r.kitapYaprak), 'kitapYaprak', ''],
      [t('hesapla.sonuc.forma_sayisi'), r.girdi.ciltTuru === 'formali' ? String(r.formaSayisi) : '—', 'formaSayisi', ''],
      [t('hesapla.sonuc.sirt'), mm(r.sirtKalinlik), 'sirtKalinlik', t('hesapla.formul.sirt_kalinlik')],
      [t('hesapla.sonuc.mafsal'), mm(r.mafsal), 'mafsal', t(r.girdi.mafsal === 'otomatik' ? 'hesapla.formul.mafsal_oto' : 'hesapla.formul.mafsal_elle')],
      [t('hesapla.sonuc.mukavva'), olcu(r.mukavva), 'mukavva', 'Db = W − f + k = ' + D.sayi(r.girdi.kitapGen) + ' − ' + D.sayi(f) + ' + ' + D.sayi(k) + ';  Dh = H + 2k'],
      [t('hesapla.sonuc.sirt_seridi'), olcu(r.sirtSeridi), 'sirtSeridi', sf],
      [t('hesapla.sonuc.kaplama'), olcu(r.kaplama), 'kaplama', t('hesapla.formul.kaplama', { fek: yalnizS ? "' (f' = f + t = " + mm(r.mafsalKaplama) + ')' : '', e: D.sayi(e), t: D.sayi(tk) })],
      [t('hesapla.sonuc.forza'), olcu(r.forza), 'forza', '2W × H'],
      [t('hesapla.sonuc.mull'), olcu(r.mull), 'mull', '(S + 50) × (H − 12)'],
      [t('hesapla.sonuc.kapital'), mm(r.kapital.uzunluk), 'kapital', t('hesapla.formul.kapital')],
      [t('hesapla.sonuc.baski_kagidi'), String(r.baskiKagidi), 'baskiKagidi', '']
    ];
    satirlar.forEach(function (s) {
      tablo.appendChild(el('tr', {}, [el('th', { text: s[0] }), el('td', { class: 'deger', 'data-sonuc': s[2], text: s[1] }),
        el('td', { class: 'kucuk formul', text: s[3] })]));
    });
    if (r.mafsalKaynakYok) uyari.appendChild(el('div', { class: 'uyari', 'data-uyari': 'mafsal', text: t('hesapla.uyari.mafsal') }));
    if (r.egriBoyuUyari) uyari.appendChild(el('div', { class: 'uyari', 'data-uyari': 'egri', text: t('hesapla.uyari.egri') }));
  }

  function duzenledenAl() {
    var o = KC.duzenle.ozet();
    if (o.sayfaSayisi) O.sayiYaz('h-sayfaSayisi', o.sayfaSayisi);
    $('h-ciltTuru').value = o.ayar.ciltTuru;
    if (isFinite(o.ayar.formaYaprak)) O.sayiYaz('h-formaYaprak', o.ayar.formaYaprak);
    $('h-sonFormaKucult').checked = !!o.ayar.sonFormaKucult;
    if (isFinite(o.ayar.kagitKalinlik)) O.sayiYaz('h-kagitKalinlik', o.ayar.kagitKalinlik);
    if (isFinite(o.ayar.kitapGen)) O.sayiYaz('h-kitapGen', o.ayar.kitapGen);
    if (isFinite(o.ayar.kitapYuk)) O.sayiYaz('h-kitapYuk', o.ayar.kitapYuk);
    ciz();
    O.bildir(t(o.sayfaSayisi ? 'hesapla.alindi' : 'hesapla.alindi_pdfsiz'));
  }

  function baslat() {
    var f = $('hesap-form');
    f.addEventListener('submit', function (e) { e.preventDefault(); });
    f.addEventListener('input', ciz);
    f.addEventListener('change', ciz);
    $('h-al').addEventListener('click', duzenledenAl);
    ciz();
  }

  /** son çizimin { hata, girdi, sonuc } kopyası (girdi hesap.hesapla'ya verilenin aynısı; sonuç onun sonucu). */
  function durum() {
    var g = null;
    if (son.girdi) { g = {}; Object.keys(son.girdi).forEach(function (k) { g[k] = son.girdi[k]; }); }
    return { hata: son.hata, girdi: g, sonuc: son.sonuc };
  }

  KC.hesapla = { baslat: baslat, ciz: ciz, durum: durum };
})(typeof self !== 'undefined' ? self : this);
