/*
 * surec.js — Süreç sekmesi: kitap listesi, adımlar (işaret, tarih, not,
 * ekle/çıkar/sırala), kitap bilgileri, JSON dışa/içe aktarma.
 */
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};
  var O = KC.ortak, $ = O.$, el = O.el, M = KC.surecModel, D = KC.dil;
  function t(a, p) { return D.t(a, p); }
  var SECILI_ANAHTAR = 'kitapCilt.seciliKitap';

  var veri = null;
  var seciliId = null;

  function kaydet() {
    var ok = KC.depo.yaz(veri);
    depoUyarisi(!ok);
    if (KC.duzenle) KC.duzenle.kitapListesiYenile();
  }

  function depoUyarisi(goster) {
    var k = $('depo-uyari');
    k.textContent = '';
    if (KC.depo.bozukMu()) {
      k.appendChild(el('div', { class: 'uyari', text: t('surec.uyari.bozuk', { anahtar: KC.depo.ANAHTAR + '.bozuk' }) }));
    }
    if (goster || !KC.depo.kaliciMi()) {
      // ortama göre (tarayıcı: surec.uyari.saklama; Mac uygulaması: tauri.uyari_saklama)
      k.appendChild(el('div', { class: 'uyari', text: (KC.platform && KC.platform.metin && KC.platform.metin.saklamaUyari) || t('surec.uyari.saklama') }));
    }
  }

  function secili() { return seciliId ? M.kitapBul(veri, seciliId) : null; }

  /** Kayıtlı Düzenle ayarındaki cilt türü (Türkçede bugünkü gibi ham değer, ör. "formali"; İngilizcede adı). */
  function ayarTuru(tur) { return D.var('surec.ayar_turu.' + tur) ? t('surec.ayar_turu.' + tur) : String(tur); }

  /** Onay penceresi (KC.platform.onayla, Promise) "evet" derse is() çalışır; "hayır"da hiçbir şey olmaz. */
  function onayla(mesaj, is) {
    return KC.platform.onayla(mesaj).then(function (ok) { if (ok) is(); })
      .catch(function (err) { O.bildir(t('surec.islem_yapilamadi', { hata: err && err.message ? err.message : err }), 'hata'); });
  }

  function sec(id) {
    seciliId = id;
    O.yerelYaz(SECILI_ANAHTAR, id || '');
    listeCiz();
    detayCiz();
  }

  function listeCiz() {
    var ul = $('kitap-listesi');
    ul.textContent = '';
    $('kitap-yok').hidden = veri.kitaplar.length > 0;
    veri.kitaplar.forEach(function (k) {
      var il = M.ilerleme(k);
      ul.appendChild(el('li', {}, [
        el('button', { type: 'button', 'data-kitap': k.id, 'aria-current': k.id === seciliId ? 'true' : 'false', onclick: function () { sec(k.id); } }, [
          el('strong', { text: k.ad }),
          el('span', { class: 'kucuk', text: t('surec.liste_ozet', { tur: M.turAdi(k.ciltTuru), biten: il.biten, n: il.toplam }) }),
          el('span', { class: 'ilerleme' }, [el('i', { style: 'width:' + Math.round(il.oran * 100) + '%' })])
        ])
      ]));
    });
  }

  function alan(etiket, girdi) { return el('label', { class: 'alan' }, [el('span', { text: etiket }), girdi]); }

  function detayCiz() {
    var kap = $('kitap-detay');
    kap.textContent = '';
    var k = secili();
    if (!k) {
      kap.appendChild(el('p', { class: 'kucuk', text: t('surec.detay_bos') }));
      return;
    }
    // sayı alanı type=text + data-sayi (dilin ondalık ayracı; "," ya da "." kabul, ortak.sayiAlanlariKur)
    function bilgiGirdisi(anahtar, tur, ek) {
      var sayiMi = tur === 'sayi';
      var deger = k[anahtar] === undefined ? '' : sayiMi ? D.sayiAlan(k[anahtar]) : String(k[anahtar]);
      var oz = sayiMi ? { type: 'text', inputmode: 'decimal', 'data-sayi': '' } : { type: tur };
      var g = el('input', Object.assign(oz, { value: deger, 'data-alan': anahtar }, ek || {}));
      g.addEventListener('change', function () {
        var n = sayiMi ? O.sayiCoz(g.value) : g.value;
        if (sayiMi && !isFinite(n)) return; // geçersiz sayı saklanmaz (alan hatası ortak.sayiAlanlariKur'da)
        k[anahtar] = n;
        kaydet(); listeCiz();
      });
      return g;
    }
    var il = M.ilerleme(k);
    kap.appendChild(el('h2', { text: k.ad }));
    kap.appendChild(el('p', { class: 'ozet', id: 'kitap-ilerleme', text: t('surec.ilerleme', { tur: M.turAdi(k.ciltTuru), biten: il.biten, n: il.toplam, tarih: k.olusturma }) }));
    kap.appendChild(el('div', { class: 'alanlar-izgara' }, [
      alan(t('surec.alan.ad'), bilgiGirdisi('ad', 'text')),
      alan(t('surec.alan.genislik'), bilgiGirdisi('kitapGen', 'sayi', { step: '0.1', min: '1' })),
      alan(t('surec.alan.yukseklik'), bilgiGirdisi('kitapYuk', 'sayi', { step: '0.1', min: '1' })),
      alan(t('surec.alan.kagit'), bilgiGirdisi('kagit', 'text')),
      alan(t('alan.kagit_kalinlik'), bilgiGirdisi('kagitKalinlik', 'sayi', { step: '0.01', min: '0' })),
      alan(t('surec.alan.pdf_adi'), bilgiGirdisi('pdfAdi', 'text'))
    ]));
    if (k.ayar) {
      var a = k.ayar;
      var ap = { tur: ayarTuru(a.ciltTuru), kg: a.kagitGen, ky: a.kagitYuk, bg: a.kitapGen, by: a.kitapYuk, n: a.formaYaprak };
      kap.appendChild(el('p', { class: 'kucuk', text: t(a.ciltTuru === 'formali' ? 'surec.kayitli_ayar_forma' : 'surec.kayitli_ayar', ap) }));
    }
    kap.appendChild(el('div', { class: 'satir' }, [
      el('button', { type: 'button', id: 'ayari-duzenleye', disabled: !k.ayar, text: t('surec.ayari_yukle'), onclick: function () {
        KC.duzenle.ayarUygula(k.ayar); KC.uygulama.sekmeAc('duzenle');
        O.bildir(k.pdfAdi ? t('surec.ayar_yuklendi_pdf', { pdf: k.pdfAdi }) : t('surec.ayar_yuklendi'));
      } }),
      el('button', { type: 'button', id: 'kitap-sil', text: t('surec.kitabi_sil'), onclick: function () {
        onayla(t('surec.onay.kitap_sil', { ad: k.ad }), function () {
          veri.kitaplar = veri.kitaplar.filter(function (x) { return x.id !== k.id; });
          kaydet(); sec(veri.kitaplar[0] ? veri.kitaplar[0].id : null);
        });
      } })
    ]));

    kap.appendChild(el('h3', { text: t('surec.adimlar') }));
    var ul = el('ul', { id: 'adimlar' });
    k.adimlar.forEach(function (a, i) {
      var adi = M.adimAdi(a);
      var kutu = el('input', { type: 'checkbox', class: 'adim-tamam', checked: a.tamam, 'aria-label': t('surec.adim.tamamlandi', { ad: adi }) });
      kutu.addEventListener('change', function () {
        M.adimIsaretle(k, a.id, kutu.checked, O.bugun());
        kaydet(); listeCiz(); detayCiz();
      });
      var tarih = el('input', { type: 'date', class: 'adim-tarih', value: a.tarih || '', 'aria-label': t('surec.adim.tarihi', { ad: adi }) });
      tarih.addEventListener('change', function () { a.tarih = tarih.value; kaydet(); });
      var not = el('textarea', { class: 'adim-not', rows: 1, placeholder: t('surec.adim.not'), 'aria-label': t('surec.adim.notu', { ad: adi }) });
      not.value = a.not || '';
      not.addEventListener('input', function () { a.not = not.value; kaydet(); });
      ul.appendChild(el('li', { class: 'adim' + (a.tamam ? ' tamam' : ''), 'data-adim': a.id }, [
        kutu,
        el('div', {}, [el('div', { class: 'adim-ad', text: (i + 1) + '. ' + adi }), a.istegeBagli ? el('div', { class: 'kucuk', text: t('surec.adim.istege_bagli') }) : null]),
        tarih,
        el('div', { class: 'adim-dugmeler' }, [
          el('button', { type: 'button', title: t('surec.adim.yukari'), text: '▲', disabled: i === 0, onclick: function () { M.adimTasi(k, a.id, -1); kaydet(); detayCiz(); } }),
          el('button', { type: 'button', title: t('surec.adim.asagi'), text: '▼', disabled: i === k.adimlar.length - 1, onclick: function () { M.adimTasi(k, a.id, 1); kaydet(); detayCiz(); } }),
          el('button', { type: 'button', title: t('surec.adim.cikar'), class: 'adim-sil', text: '✕', onclick: function () {
            onayla(t('surec.onay.adim_cikar', { ad: adi }), function () {
              M.adimSil(k, a.id); kaydet(); listeCiz(); detayCiz();
            });
          } })
        ]),
        not
      ]));
    });
    kap.appendChild(ul);
    var yeniAd = el('input', { type: 'text', id: 'adim-yeni-ad', placeholder: t('surec.adim.yeni_ad') });
    kap.appendChild(el('div', { class: 'satir' }, [
      yeniAd,
      el('button', { type: 'button', id: 'adim-ekle', text: t('surec.adim.ekle'), onclick: function () {
        try { M.adimEkle(k, yeniAd.value); kaydet(); listeCiz(); detayCiz(); } catch (e) { O.bildir(e.message, 'hata'); }
      } })
    ]));
  }

  function yeniKitapOlaylari() {
    $('yeni-kitap-form').addEventListener('submit', function (e) {
      e.preventDefault();
      try {
        var k = M.yeniKitap({
          ad: $('yk-ad').value, ciltTuru: $('yk-tur').value,
          kitapGen: O.sayiZorunlu('yk-gen', 148), kitapYuk: O.sayiZorunlu('yk-yuk', 210), // O1: geçersiz → hata
          kagit: $('yk-kagit').value, kagitKalinlik: O.sayiZorunlu('yk-kalinlik', 0.1), pdfAdi: $('yk-pdf').value,
          olusturma: O.bugun()
        });
        veri.kitaplar.push(k);
        kaydet();
        $('yk-ad').value = '';
        sec(k.id);
        O.bildir(t('surec.olusturuldu', { ad: k.ad }));
      } catch (err) { O.bildir(err.message, 'hata'); }
    });
  }

  function yedekOlaylari() {
    $('json-disa').addEventListener('click', function () {
      var metin = JSON.stringify(veri, null, 2);
      var adet = veri.kitaplar.length;
      // ok: true (tarayıcı indirmesi), { ad, yol } (yerel Kaydet penceresi yazdı) ya da false (vazgeçildi)
      O.indir(t('surec.yedek_dosya_adi', { tarih: O.bugun() }) + '.json', metin, 'application/json').then(function (ok) {
        if (ok) O.bildir(ok.yol ? t('surec.disa_aktarildi_yol', { n: adet, yol: ok.yol }) : t('surec.disa_aktarildi', { n: adet }));
        else O.bildir(t('surec.json_kaydedilmedi'), 'hata');
      }, function (err) { O.bildir(t('surec.disa_aktarilamadi', { hata: err.message }), 'hata'); });
    });
    // Tarayıcıda gizli girdi açılır ve seçim aşağıdaki change olayıyla gelir (null döner); yerel diyalog
    // doğrudan File döndürür (duzenle.js "PDF seç" ile aynı kalıp). Seçici reddi de bildirime gider.
    $('json-ice-dugme').addEventListener('click', function () {
      KC.platform.dosyaSec({ girdi: $('json-ice'), uzantilar: ['json'], mime: 'application/json' })
        .then(function (f) { if (f) return iceAktar(f); }, function (err) { O.bildir(t('surec.ice_aktarilamadi', { hata: err.message }), 'hata'); });
    });
    $('json-ice').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      iceAktar(f).then(function () { e.target.value = ''; });
    });
    /** Seçilen yedek dosyasını içe aktarır; hatalar bildirime gider, Promise hiç reddedilmez. */
    function iceAktar(f) {
      return f.text().then(function (metin) {
        var yeni;
        try { yeni = JSON.parse(metin); } catch (x) { throw new Error(t('surec.json_degil'), { cause: x }); }
        M.dogrula(yeni);
        var sor = veri.kitaplar.length
          ? KC.platform.onayla(t('surec.onay.degistir', { n: veri.kitaplar.length, yeni: yeni.kitaplar.length }))
          : Promise.resolve(true);
        return sor.then(function (ok) {
          if (!ok) return;
          veri = yeni;
          kaydet();
          sec(veri.kitaplar[0] ? veri.kitaplar[0].id : null);
          O.bildir(t('surec.ice_aktarildi', { n: veri.kitaplar.length }));
        });
      }).catch(function (err) { O.bildir(t('surec.ice_aktarilamadi', { hata: err.message }), 'hata'); });
    }
    $('veri-temizle').addEventListener('click', function () {
      onayla(t('surec.onay.temizle'), function () {
        KC.depo.temizle();
        veri = M.bosVeri();
        kaydet();
        sec(null);
        O.bildir(t('surec.silindi'));
      });
    });
  }

  /** Düzenle sekmesinden çağrılır. */
  function ayarKaydet(id, ayar, pdfAdi) {
    var k = M.kitapBul(veri, id);
    if (!k) throw new Error(t('surec.kitap_bulunamadi'));
    k.ayar = JSON.parse(JSON.stringify(ayar));
    if (isFinite(ayar.kitapGen)) k.kitapGen = ayar.kitapGen;
    if (isFinite(ayar.kitapYuk)) k.kitapYuk = ayar.kitapYuk;
    if (isFinite(ayar.kagitKalinlik) && ayar.ciltTuru === 'formali') k.kagitKalinlik = ayar.kagitKalinlik;
    if (pdfAdi) k.pdfAdi = pdfAdi;
    kaydet();
    if (k.id === seciliId) detayCiz();
    listeCiz();
  }

  function baslat() {
    veri = KC.depo.oku();
    var s = O.yerelOku(SECILI_ANAHTAR);
    seciliId = s && M.kitapBul(veri, s) ? s : (veri.kitaplar[0] ? veri.kitaplar[0].id : null);
    yeniKitapOlaylari();
    yedekOlaylari();
    depoUyarisi(false);
    listeCiz();
    detayCiz();
  }

  KC.surec = { baslat: baslat, ayarKaydet: ayarKaydet, veri: function () { return veri; }, secili: secili };
})(typeof self !== 'undefined' ? self : this);
