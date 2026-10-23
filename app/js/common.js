/* common.js — arayüz yardımcıları (DOM). */
(function (kok) {
  'use strict';
  var KC = kok.KitapCilt = kok.KitapCilt || {};

  function $(id) { return document.getElementById(id); }

  function el(etiket, ozellik, cocuklar) {
    var e = document.createElement(etiket);
    if (ozellik) {
      Object.keys(ozellik).forEach(function (k) {
        var v = ozellik[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'text') e.textContent = v;
        else if (k === 'class') e.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k in e && typeof v !== 'string') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
      });
    }
    (cocuklar || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  var bildirimZaman = null;
  function bildir(mesaj, tur) {
    var b = $('bildirim');
    if (!b) return;
    b.textContent = mesaj;
    b.className = 'goster' + (tur === 'hata' ? ' hata' : '');
    clearTimeout(bildirimZaman);
    bildirimZaman = setTimeout(function () { b.className = ''; }, tur === 'hata' ? 8000 : 3500);
  }

  /** Dosyayı kullanıcıya verir (tarayıcıda indirme). Promise<boolean>: false = kullanıcı vazgeçti. */
  function indir(ad, veri, mime) {
    return KC.platform.kaydet(ad, veri, mime);
  }

  // tek katı sayı ayrıştırıcı. İşaret, rakamlar ve en çok bir ondalık ayracı ("," ya da ".";
  // arayüz dilinden bağımsız kabul). Çoklu ayraç ("1.234,5"), sondaki çöp ("12abc", "12 mm"), üs ("1e3"), boşluklu
  // ("1 200"), sonsuz → NaN. Binliğe benzeyen girdi — dilin ondalık ayracı OLMAYAN ayraç + tam 3 hane, baş kısım 1–3
  // hane ve 0 değil (tr "1.200", en "1,200") — açık hata (NaN): tr'de "1.200" = 1200 mü 1,2 mi belirsiz; sessizce 1,2
  // okumak (eski parseFloat) sırtı yanlış hesaplatıyordu, 1200 okumak "1.125 mm" gibi ondalık yazan kullanıcıyı
  // yanıltırdı. Kayıtlı veri (secenek.kayit) binlik denetimine girmez: eski kayıtlar ("0.1", "0,1") okunmaya devam.
  var SAYI_DESENI = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;

  /** Arayüz dilinin ondalık ayracı ("," ya da "."); dil yüklü değilse ".". */
  function ondalikAyraci() {
    var D = KC.dil;
    var o = D && D.sayiAlan ? D.sayiAlan(1.5) : '1.5';
    return o.indexOf(',') >= 0 ? ',' : '.';
  }

  /** Binliğe benzeyen (belirsiz) girdi mi: dilin ondalık ayracı olmayan ayraç + tam 3 hane ("1.200" tr, "1,200" en). */
  function binlikGibi(s) {
    var obur = ondalikAyraci() === ',' ? '.' : ',';
    return new RegExp('^[+-]?[1-9]\\d{0,2}\\' + obur + '\\d{3}$').test(s);
  }

  /**
   * Kullanıcının yazdığı ya da kayıtlı sayı → sayı; geçersizse NaN. Sayı türü girdi aynen (sonlu değilse NaN).
   * secenek.kayit: kayıtlı veri (binlik denetimi yok).
   */
  function sayiCoz(metin, secenek) {
    if (metin === null || metin === undefined) return NaN;
    if (typeof metin === 'number') return isFinite(metin) ? metin : NaN;
    var s = String(metin).trim();
    if (!SAYI_DESENI.test(s)) return NaN;
    if (!(secenek && secenek.kayit) && binlikGibi(s)) return NaN;
    var n = Number(s.replace(',', '.'));
    return isFinite(n) ? n : NaN;
  }

  /** Geçersiz sayı girdisi için kullanıcıya gösterilecek hata metni; geçerli ya da boşsa null. */
  function sayiHatasi(metin) {
    if (metin === null || metin === undefined) return null;
    var s = String(metin).trim();
    if (s === '' || isFinite(sayiCoz(s))) return null;
    var D = KC.dil;
    var binlik = SAYI_DESENI.test(s) && binlikGibi(s);
    if (!D || !D.t) return (binlik ? 'Ambiguous number (thousands separator?): ' : 'Not a valid number: ') + s;
    return D.t(binlik ? 'sayi.binlik' : 'sayi.gecersiz', { deger: s, ayrac: ondalikAyraci() });
  }

  /** Alandaki sayı; boş ya da geçersizse varsayilan (geçersizlik alan düzeyinde bildirilir: sayiAlanlariKur). */
  function sayi(id, varsayilan) {
    var n = sayiCoz($(id).value);
    return isFinite(n) ? n : varsayilan;
  }

  /** Alandaki sayı; boşsa varsayilan, geçersizse anlaşılır hata atar (sessiz öntanımlı yok). */
  function sayiZorunlu(id, varsayilan) {
    var v = $(id).value;
    if (v === null || v === undefined || String(v).trim() === '') return varsayilan;
    var n = sayiCoz(v);
    if (!isFinite(n)) throw new Error(sayiHatasi(v));
    return n;
  }

  /** Sayı alanına değeri arayüz dilinin biçimiyle yazar (KitapCilt.dil yoksa düz). oge: kimlik ya da öğe. */
  function sayiYaz(oge, n) {
    var e = typeof oge === 'string' ? $(oge) : oge;
    if (!e) return;
    var D = KC.dil;
    var x = typeof n === 'string' ? sayiCoz(n, { kayit: true }) : n; // kayıtlı/programdan gelen değer
    e.value = D && D.sayiAlan ? D.sayiAlan(x) : (isFinite(x) ? String(x) : '');
  }

  function sayiAlaniMi(e) { return !!(e && e.tagName === 'INPUT' && e.hasAttribute && e.hasAttribute('data-sayi')); }

  /**
   * Sayı alanları (input[data-sayi], type=text inputmode=decimal): type=number WebKit'te sistem bölgesinin
   * ayracıyla görünüyordu (İngilizce arayüzde "0,1"). Burada (1) mevcut değerler dilin biçimine çevrilir, (2) alandan
   * çıkınca (change, yakalama evresinde: diğer dinleyiciler biçimli değeri görür) yazılan değer dilin biçimine döner,
   * (3) ↑/↓ eski type=number gibi step/min/max ile adımlar ve input + change olayı yayar. Belgeye bir kez bağlanır.
   */
  var sayiKurulu = false;
  function sayiAlanlariKur(kokOge) {
    var k = kokOge || document;
    var l = k.querySelectorAll ? k.querySelectorAll('input[data-sayi]') : [];
    for (var i = 0; i < l.length; i++) { var n = sayiCoz(l[i].value, { kayit: true }); if (isFinite(n)) sayiYaz(l[i], n); }
    if (sayiKurulu || !document.addEventListener) return;
    sayiKurulu = true;
    document.addEventListener('change', function (e) {
      if (!sayiAlaniMi(e.target)) return;
      var n = sayiCoz(e.target.value);
      var hata = sayiHatasi(e.target.value); // geçersiz girdi kullanıcıya bildirilir
      if (hata) { e.target.setAttribute('aria-invalid', 'true'); e.target.title = hata; bildir(hata, 'hata'); return; }
      if (e.target.getAttribute('aria-invalid') === 'true') { e.target.removeAttribute('aria-invalid'); e.target.removeAttribute('title'); }
      if (isFinite(n)) sayiYaz(e.target, n);
    }, true);
    document.addEventListener('keydown', function (e) {
      if (!sayiAlaniMi(e.target) || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.target.disabled || e.altKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      var g = e.target;
      var adim = sayiCoz(g.getAttribute('step'), { kayit: true });
      if (!(adim > 0)) adim = 1;
      var en = sayiCoz(g.getAttribute('min'), { kayit: true }), ec = sayiCoz(g.getAttribute('max'), { kayit: true });
      var v = sayiCoz(g.value);
      if (!isFinite(v)) v = isFinite(en) ? en : 0;
      v = v + (e.key === 'ArrowUp' ? adim : -adim);
      v = Math.round(v * 1e6) / 1e6;
      if (isFinite(en) && v < en) v = en;
      if (isFinite(ec) && v > ec) v = ec;
      sayiYaz(g, v);
      g.dispatchEvent(new Event('input', { bubbles: true }));
      g.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function bugun() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function yerelOku(anahtar) { try { return kok.localStorage.getItem(anahtar); } catch { return null; } }
  function yerelYaz(anahtar, deger) { try { kok.localStorage.setItem(anahtar, deger); } catch { /* yok say */ } }

  var HAZIR_OLCULER = [
    { ad: 'A3', gen: 297, yuk: 420 },
    { ad: 'A4', gen: 210, yuk: 297 },
    { ad: 'A5', gen: 148, yuk: 210 },
    { ad: 'A6', gen: 105, yuk: 148 },
    { ad: 'Letter', gen: 215.9, yuk: 279.4 }
  ];

  KC.ortak = { $: $, el: el, bildir: bildir, indir: indir, sayi: sayi, sayiZorunlu: sayiZorunlu, sayiCoz: sayiCoz, sayiHatasi: sayiHatasi, sayiYaz: sayiYaz, sayiAlanlariKur: sayiAlanlariKur, bugun: bugun, yerelOku: yerelOku, yerelYaz: yerelYaz, HAZIR_OLCULER: HAZIR_OLCULER };
})(typeof self !== 'undefined' ? self : this);
