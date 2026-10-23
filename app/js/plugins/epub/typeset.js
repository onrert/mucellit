/*
 * typeset.js — EPUB blok listesini (IR) sayfalara dizer; DOM'suz saf modül
 * (KitapCilt.epubDizgi / module.exports). Node'da birim testlenir.
 *
 *   diz(bloklar, ayar, olcer)      → { sayfalar, uyarilar }       (eşzamanlı)
 *   dizAsync(bloklar, ayar, olcer) → Promise<{ sayfalar, uyarilar }> (her 200 blokta olay döngüsüne nefes)
 *   fontkitOlcer(fontlar)          → olcer (fontkit yazı tipleriyle; pdf-lib'in widthOfTextAtSize hesabının aynısı)
 *
 * ayar (pt): { sayfaGen, sayfaYuk, kenar: { ust, alt, ic, dis }, boy, satirAraligi, tireBol, sayfaNo, sayfaNoBoy = 9 }
 * olcer: { genislik(metin, stil, boy) → pt }   stil: 'R' | 'I' | 'B' | 'BI'
 *
 * BLOK (IR):
 *   { tur: 'paragraf', hiza: 'iki'|'sol'|'orta'|'sag', girinti, solGirinti (em), sagGirinti (em), kucuk, onEk, dil,
 *     parcalar: [{ metin, italik, kalin, ust, kucuk, dil } | { kir: true }] }   (kir: <br>)
 *   { tur: 'baslik', duzey: 1..6, hiza, parcalar }
 *   { tur: 'resim', resim: { anahtar, pikselGen, pikselYuk } }
 *   { tur: 'ayrac' } | { tur: 'sayfaSonu' } | { tur: 'bolumBasi' }
 * SAYFA: { no, bolumBasi, ogeler: [{ tur: 'metin', x, y, metin, stil, boy, bosluk, blok, satir, rol? }
 *                                  | { tur: 'resim', x, y, w, h, anahtar, blok }] }   pt, sol alt köken.
 *   bosluk: true → pdf-yaz bu parçadan sonra bir boşluk yazar (aranabilir metin için kelime ayırıcı).
 *
 * Kurallar: açgözlü satır kırma; sığmayan kelimede satır doluluğu < %92 ise en uzun sığan hece noktası "-" ile;
 * iki yana yaslı satırda fazlalık boşluklara eşit dağıtılır, son satır ve <br> öncesi sola; U+00A0 kırılmaz;
 * dul/öksüz en az 2 satır (≤3 satırlık paragraf bölünmez); başlık sonraki 2 satırla aynı sayfada; bolumBasi ve
 * sayfaSonu yeni sayfa (sayfa zaten boşsa boş sayfa üretilmez); bölüm açılış sayfasına numara basılmaz.
 */
(function (kok, fabrika) {
  var m = fabrika(typeof module === 'object' && module.exports ? require('./hyphenation.js') : null);
  if (typeof module === 'object' && module.exports) {
    module.exports = m;
  } else {
    kok.KitapCilt = kok.KitapCilt || {};
    kok.KitapCilt.epubDizgi = m;
  }
})(typeof self !== 'undefined' ? self : this, function (heceModul) {
  'use strict';

  function H() { return heceModul || (typeof self !== 'undefined' && self.KitapCilt && self.KitapCilt.hece); }

  var BASLIK_CARPAN = [1.6, 1.35, 1.15, 1, 1, 1];
  var DOLULUK_ESIK = 0.92;
  var BOSLUK_RE = /[ \t\n\r\f]+/;
  var YUMUSAK = '­';

  function stilAdi(p) { return (p.kalin ? 'B' : '') + (p.italik ? 'I' : '') || 'R'; }
  function gorunen(s) { return s.replace(/­/g, '').replace(/ /g, ' '); }

  // Ölçüm önbelleği sınırlı: yalnız kısa metinler (kelime/parça) saklanır, dolunca boşaltılır.
  // Uzun kelime bölünürken ölçülen önekler (her biri ayrı metin) önbelleği şişirmez.
  var ONBELLEK_METIN = 64;
  var ONBELLEK_ENCOK = 20000;
  function onbellekliOlcer(olcer) {
    var harita = new Map();
    var f = function (metin, stil, boy) {
      var t = gorunen(metin);
      if (!t) return 0;
      if (t.length > ONBELLEK_METIN) return olcer.genislik(t, stil, boy);
      var k = stil + '|' + boy + '|' + t;
      var v = harita.get(k);
      if (v === undefined) {
        v = olcer.genislik(t, stil, boy);
        if (harita.size >= ONBELLEK_ENCOK) harita.clear();
        harita.set(k, v);
      }
      return v;
    };
    f.boyut = function () { return harita.size; };
    return f;
  }

  // ---------- kelimelere ayırma ----------
  // Kelime: boşlukla ayrılmamış parça dizisi. seg: { metin, stil, boy, ust }
  function kelimelereAyir(blok, boy) {
    var simgeler = [];
    var cur = null;
    function bitir() { if (cur && cur.segler.length) simgeler.push(cur); cur = null; }
    (blok.parcalar || []).forEach(function (p) {
      if (p.kir) { bitir(); simgeler.push({ kir: true }); return; }
      var segBoy = boy * (p.kucuk ? 0.85 : 1) * (p.ust ? 0.7 : 1);
      var stil = stilAdi(p);
      var dil = p.dil || blok.dil || '';
      var parcalar = String(p.metin || '').split(/([ \t\n\r\f]+)/);
      parcalar.forEach(function (t) {
        if (!t) return;
        if (BOSLUK_RE.test(t) && !t.replace(BOSLUK_RE, '')) { bitir(); return; }
        if (!cur) cur = { segler: [], dil: dil };
        cur.segler.push({ metin: t, stil: stil, boy: segBoy, ust: !!p.ust });
      });
    });
    bitir();
    while (simgeler.length && simgeler[simgeler.length - 1].kir) simgeler.pop();
    while (simgeler.length && simgeler[0].kir) simgeler.shift();
    return simgeler;
  }

  function kelimeMetni(w) { return w.segler.map(function (s) { return s.metin; }).join(''); }
  function kelimeGen(w, olc) { return w.segler.reduce(function (t, s) { return t + olc(s.metin, s.stil, s.boy); }, 0); }
  function kelimeUz(w) { return w.segler.reduce(function (t, s) { return t + s.metin.length; }, 0); }

  /** İlk k karakterin genişliği (tiresiz); yalnız sol parça kurulur (sağ kalan kopyalanmaz). */
  function onekGen(w, k, olc) {
    var t = 0, i = 0;
    for (var j = 0; j < w.segler.length && i < k; j++) {
      var s = w.segler[j];
      var son = i + s.metin.length;
      t += olc(son <= k ? s.metin : s.metin.slice(0, k - i), s.stil, s.boy);
      i = son;
    }
    return t;
  }

  function yuksekVekil(c) { return c >= 0xd800 && c <= 0xdbff; }

  /**
   * Tahmini sığan önek: tek karakter genişliklerinin (önbellekli) önek toplamı yer'i aşana kadar sayılır.
   * En çok k+1 karakter gezilir (satır boyu kadar), kelimenin kalanına bakılmaz.
   */
  function tahminiOnek(w, yer, olc) {
    var t = 0, k = 0;
    for (var j = 0; j < w.segler.length; j++) {
      var s = w.segler[j];
      for (var i = 0; i < s.metin.length; i++) {
        t += olc(s.metin.charAt(i), s.stil, s.boy);
        if (t > yer + 1e-6) return k;
        k++;
      }
    }
    return k;
  }

  /**
   * [0, n−1] içinde yer'e sığan en büyük k (önek genişliği k ile artar; glif genişlikleri ≥ 0).
   * Önek toplamı tahmininden başlar, gerçek ölçümle doğrular (çoğu satırda 2 ölçüm); tahmin şaşarsa
   * oradan üstel + ikili arama. Satır başına O(log n) ölçüm, her biri satır boyu kadar metin.
   */
  function enUzunOnek(w, n, yer, olc) {
    if (n <= 1 || !(yer >= 0)) return 0;
    function sig(k) { return onekGen(w, k, olc) <= yer + 1e-6; }
    var k0 = Math.min(n - 1, tahminiOnek(w, yer, olc));
    var lo, hi, a;
    if (k0 === 0 || sig(k0)) {
      lo = k0; hi = n; // n: bütün kelime (çağıran için zaten sığmıyor)
      for (a = 1; lo + a < hi; a *= 2) { if (sig(lo + a)) lo += a; else { hi = lo + a; break; } }
    } else {
      lo = 0; hi = k0;
      for (a = 1; hi - a > 0; a *= 2) { if (sig(hi - a)) { lo = hi - a; break; } hi -= a; }
    }
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (sig(m)) lo = m; else hi = m; }
    return lo;
  }

  // Uzun kelimede (> UZUN karakter) tam genişlik ölçülmeden önce sığma denetlenir: tahmini taşma noktasındaki
  // gerçek önek bile sığmıyorsa kelime sığmaz (kelimenin tamamı her satırda yeniden ölçülmez).
  var UZUN = 64;
  function kelimeGenSinirli(w, yer, olc) {
    var n = kelimeUz(w);
    if (n > UZUN) {
      var k = tahminiOnek(w, yer, olc);
      if (k < n && onekGen(w, k + 1, olc) > yer + 1e-6) return Infinity;
    }
    return kelimeGen(w, olc);
  }

  /** Kelimeyi k karakterinden böler; tire true ise sol parçaya '-' eklenir. */
  function kelimeBol(w, k, tire) {
    var sol = [], sag = [], i = 0;
    w.segler.forEach(function (s) {
      var bas = i, son = i + s.metin.length;
      if (son <= k) sol.push(s);
      else if (bas >= k) sag.push(s);
      else {
        sol.push(Object.assign({}, s, { metin: s.metin.slice(0, k - bas) }));
        sag.push(Object.assign({}, s, { metin: s.metin.slice(k - bas) }));
      }
      i = son;
    });
    if (tire && sol.length) {
      var son_ = sol[sol.length - 1];
      sol[sol.length - 1] = Object.assign({}, son_, { metin: son_.metin.replace(/­$/, '') + '-' });
    }
    var kalan = { segler: sag, dil: w.dil };
    // bölme noktaları kelimenin aslından devralınır (kalan parça için baştan hesaplanmaz)
    if (w.nk) kalan.nk = { l: w.nk.l, o: w.nk.o + k };
    return [{ segler: sol, dil: w.dil }, kalan];
  }

  /**
   * Kelimenin aslındaki bölme noktaları, bir kez hesaplanır: { l: [{ k, tire, sol }] (artan, mutlak), o: ofset }.
   * sol: kalan parçada noktanın geçerli olması için gereken en az göreli k (sağ taraf aslıyla aynı kalır).
   * Bölünen kelimenin kalan parçası aynı listeyi devralır (nk.o = kalanın asıldaki başlangıcı); böylece uzun
   * kelimede heceleme her satırda baştan yapılmaz.
   */
  function noktaListesi(w, tireBol) {
    if (w.nk) return w.nk;
    var t = kelimeMetni(w);
    var l = [];
    var gor = {};
    function ekle(k, tire, sol) { if (k > 0 && k < t.length && !gor[k]) { gor[k] = 1; l.push({ k: k, tire: tire, sol: sol }); } }
    for (var i = 1; i < t.length - 1; i++) {
      var c = t.charAt(i);
      // var olan kısa çizgi: sonrasında tiresiz bölünür (her iki yanda en az 2 karakter)
      if ((c === '-' || c === '‐') && i >= 2 && t.length - i - 1 >= 2) ekle(i + 1, false, 3);
      if (tireBol && c === YUMUSAK) ekle(i + 1, true, 2);
    }
    if (tireBol && /^tr\b/i.test(w.dil || '') && H()) {
      // '-', U+2010 ve U+00AD ile ayrılmış her alt dizi ayrı hecelenir (heceleyici tire görünce hiç nokta vermiyordu)
      var altBas = 0;
      var altEkle = function (alt, ofs) {
        H().bolmeNoktalari(alt).forEach(function (k) { ekle(ofs + k, !H().tiresizMi(alt, k), 2); });
      };
      for (var j = 0; j <= t.length; j++) {
        var cj = j < t.length ? t.charAt(j) : '';
        if (j === t.length || cj === '-' || cj === '‐' || cj === YUMUSAK) {
          if (j > altBas) altEkle(t.slice(altBas, j), altBas);
          altBas = j + 1;
        }
      }
    }
    l.sort(function (a, b) { return a.k - b.k; });
    w.nk = { l: l, o: 0 };
    return w.nk;
  }

  /** Bölme noktaları (bu parçaya göre): [{ k, tire }] artan. */
  function noktalar(w, tireBol) {
    var nk = noktaListesi(w, tireBol);
    var n = kelimeUz(w);
    var l = [];
    nk.l.forEach(function (p) {
      var k = p.k - nk.o;
      if (k > 0 && k < n && (nk.o === 0 || k >= p.sol)) l.push({ k: k, tire: p.tire });
    });
    return l;
  }

  /** Artan l içinde mutlak k ≤ sinir olan son noktanın indisi (yoksa −1); ikili arama. */
  function sonNokta(l, sinir) {
    var lo = 0, hi = l.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (l[m].k <= sinir) lo = m + 1; else hi = m; }
    return lo - 1;
  }

  /** Kelimenin i. UTF-16 birimi (parçaları birleştirmeden). */
  function birimKodu(w, i) {
    for (var j = 0; j < w.segler.length; j++) {
      var m = w.segler[j].metin;
      if (i < m.length) return m.charCodeAt(i);
      i -= m.length;
    }
    return NaN;
  }

  // ---------- satırlara bölme ----------
  /**
   * Bir paragraf/başlık bloğunu satırlara böler.
   * Dönüş: [{ ogeler: [{ x (alan soluna göre), dy (satır üstünden taban çizgisi), metin, stil, boy, bosluk }] }]
   */
  function satirlar(blok, boy, alanGen, ayar, olc) {
    var em = boy;
    var solG = (blok.solGirinti || 0) * em, sagG = (blok.sagGirinti || 0) * em;
    // İç içe liste/alıntı girintisi birikir ve üst sınırı yoktur: satır genişliği en az min(alan, 4 em) kalsın,
    // fazlası sol/sağ girintiden orantılı düşülür (W ≤ 0 olursa her kelime boş satır üretiyordu).
    var enAzGen = Math.min(alanGen, 4 * em);
    if (solG + sagG > alanGen - enAzGen) {
      var oran = (alanGen - enAzGen) / (solG + sagG);
      solG *= oran; sagG *= oran;
    }
    var W0 = alanGen - solG - sagG;
    var hiza = blok.hiza || 'iki';
    var girinti = !!blok.girinti && hiza !== 'orta' && hiza !== 'sag' && W0 > 2 * em;
    var L = boy * ayar.satirAraligi;
    var tabanDy = (L - boy) / 2 + 0.8 * boy;
    var bosluk = olc(' ', 'R', boy);
    var simgeler = kelimelereAyir(blok, boy);
    var cikti = [];
    var cur = [], curW = 0, ilk = true;

    function satirGen() { return W0 - (ilk && girinti ? em : 0); }

    function bitir(sola) {
      var W = satirGen();
      var bas = solG + (ilk && girinti ? em : 0);
      var genler = cur.map(function (w) { return kelimeGen(w, olc); });
      var dogal = genler.reduce(function (a, b) { return a + b; }, 0) + bosluk * Math.max(0, cur.length - 1);
      var aralik = bosluk;
      var x = bas;
      if (hiza === 'iki' && !sola && cur.length > 1) aralik = bosluk + (W - dogal) / (cur.length - 1);
      else if (hiza === 'orta') x = bas + Math.max(0, (W - dogal) / 2);
      else if (hiza === 'sag') x = bas + Math.max(0, W - dogal);
      var ogeler = [];
      if (ilk && blok.onEk) {
        var oe = olc(blok.onEk, 'R', boy);
        ogeler.push({ x: Math.max(0, solG - oe - 0.4 * em), dy: tabanDy, metin: blok.onEk, stil: 'R', boy: boy, bosluk: true });
      }
      cur.forEach(function (w, i) {
        var sx = x;
        w.segler.forEach(function (s, j) {
          var t = gorunen(s.metin);
          if (t) {
            ogeler.push({ x: sx, dy: tabanDy - (s.ust ? 0.33 * boy : 0), metin: t, stil: s.stil, boy: s.boy, bosluk: j === w.segler.length - 1 && i < cur.length - 1 });
          }
          sx += olc(s.metin, s.stil, s.boy);
        });
        x += genler[i] + aralik;
      });
      cikti.push({ ogeler: ogeler, yukseklik: L });
      cur = []; curW = 0; ilk = false;
    }

    function enUzunSigan(w, yer, zorunlu) {
      var n = kelimeUz(w);
      // tiresiz sığan en uzun önek (üstel + ikili arama); hiçbir bölme noktası bundan ileride sığamaz
      var kDuz = enUzunOnek(w, n, yer, olc);
      var nk = noktaListesi(w, ayar.tireBol);
      for (var i = sonNokta(nk.l, nk.o + kDuz); i >= 0; i--) {
        var kr = nk.l[i].k - nk.o;
        if (kr <= 0) break;
        if (nk.o > 0 && kr < nk.l[i].sol) continue;
        var p = kelimeBol(w, kr, nk.l[i].tire);
        if (kelimeGen(p[0], olc) <= yer + 1e-6) return p;
      }
      if (!zorunlu) return null;
      // hiç nokta sığmıyor ve satır boş: karakterden böl (kelime satırdan uzun); vekil çift bölünmez
      var k = kDuz;
      if (k > 1 && k < n && yuksekVekil(birimKodu(w, k - 1))) k -= 1;
      if (k < 1) k = n > 1 && yuksekVekil(birimKodu(w, 0)) ? 2 : 1;
      return kelimeBol(w, k, false);
    }

    simgeler.forEach(function (s) {
      if (s.kir) { bitir(true); return; }
      var w = s;
      for (var koruma = 0; koruma < 10000; koruma++) {
        if (!w.segler.length) return; // bölmeden boş kalan parça: döngü biter
        var W = satirGen();
        var ek = cur.length ? bosluk : 0;
        var g = kelimeGenSinirli(w, W - curW - ek, olc);
        if (curW + ek + g <= W + 1e-6) { cur.push(w); curW += ek + g; return; }
        if (!cur.length || curW / W < DOLULUK_ESIK) {
          var p = enUzunSigan(w, W - curW - ek, !cur.length);
          if (p) { cur.push(p[0]); curW += ek + kelimeGen(p[0], olc); bitir(false); w = p[1]; continue; }
        }
        bitir(false);
      }
    });
    if (cur.length || !cikti.length) bitir(true);
    return cikti;
  }

  /** Arayüz metni: tarayıcıda KitapCilt.dil, Node'da ../../i18n.js. */
  function dilT(a, p) {
    var k = typeof self !== 'undefined' ? self : globalThis;
    return ((k && k.KitapCilt && k.KitapCilt.dil) || require('../../i18n.js')).t(a, p);
  }

  // ---------- sayfalama ----------
  function* dizUretec(bloklar, ayar, olcer) {
    var olc = onbellekliOlcer(olcer);
    var k = ayar.kenar;
    var alanGen = ayar.sayfaGen - k.ic - k.dis;
    var alanYuk = ayar.sayfaYuk - k.ust - k.alt;
    if (!(alanGen > 0) || !(alanYuk > 0)) throw new Error(dilT('dizgi.kenar_sigmiyor', { gen: Math.round(alanGen), yuk: Math.round(alanYuk) }));
    var ust = ayar.sayfaYuk - k.ust;
    var sayfalar = [];
    var sayfa = { no: 1, bolumBasi: false, ogeler: [] };
    var kullanilan = 0;
    var uyarilar = { dusukDpi: 0 };
    var satirOnbellek = {};

    function bos() { return sayfa.ogeler.length === 0 && kullanilan === 0; }
    function yeniSayfa() {
      sayfalar.push(sayfa);
      sayfa = { no: sayfalar.length + 1, bolumBasi: false, ogeler: [] };
      kullanilan = 0;
    }
    function blokBoy(b) {
      if (b.tur === 'baslik') return ayar.boy * BASLIK_CARPAN[Math.min(6, Math.max(1, b.duzey || 1)) - 1];
      return ayar.boy * (b.kucuk ? 0.85 : 1);
    }
    function onceki(i) { return i > 0 ? bloklar[i - 1] : null; }
    function blokGirintili(i) {
      var b = bloklar[i], o = onceki(i);
      if (!b.girinti || b.onEk) return false;
      return !!o && o.tur === 'paragraf' && !o.onEk;
    }
    function satirlariAl(i) {
      if (satirOnbellek[i]) return satirOnbellek[i];
      var b = bloklar[i];
      var bb = Object.assign({}, b, { girinti: b.tur === 'paragraf' ? blokGirintili(i) : false });
      if (b.tur === 'baslik') {
        bb.hiza = b.hiza || (b.duzey <= 2 ? 'orta' : 'sol');
        bb.parcalar = (b.parcalar || []).map(function (p) { return p.kir ? p : Object.assign({}, p, { kalin: true }); });
      }
      var r = satirlar(bb, blokBoy(b), alanGen, ayar, olc);
      satirOnbellek[i] = r;
      return r;
    }
    function satirKoy(s, i, no) {
      s.ogeler.forEach(function (o) {
        sayfa.ogeler.push({ tur: 'metin', x: k.ic + o.x, y: ust - kullanilan - o.dy, metin: o.metin, stil: o.stil, boy: o.boy, bosluk: o.bosluk, blok: i, satir: no });
      });
      kullanilan += s.yukseklik;
    }
    function bosluguKoy(h) { if (!bos()) kullanilan += h; }
    function kalan() { return alanYuk - kullanilan; }

    for (var i = 0; i < bloklar.length; i++) {
      if (i > 0 && i % 200 === 0) yield i;
      var b = bloklar[i];
      var L = blokBoy(b) * ayar.satirAraligi;
      if (b.tur === 'bolumBasi' || b.tur === 'sayfaSonu') {
        if (!bos()) yeniSayfa();
        if (b.tur === 'bolumBasi') sayfa.bolumBasi = true;
        continue;
      }
      if (b.tur === 'ayrac') {
        var oncesi = bos() ? 0 : 0.5 * L;
        if (oncesi + L > kalan() + 1e-6 && !bos()) yeniSayfa(); else bosluguKoy(oncesi);
        var yildiz = '* * *';
        var yg = olc(yildiz, 'R', ayar.boy);
        satirKoy({ ogeler: [{ x: (alanGen - yg) / 2, dy: (L - ayar.boy) / 2 + 0.8 * ayar.boy, metin: yildiz, stil: 'R', boy: ayar.boy, bosluk: false }], yukseklik: L }, i, 0);
        kullanilan += Math.max(0, Math.min(0.5 * L, kalan()));
        continue;
      }
      if (b.tur === 'resim') {
        var r = b.resim || {};
        var w = (r.pikselGen || 1) * 0.75, h = (r.pikselYuk || 1) * 0.75;
        var olcek = Math.min(1, alanGen / w, alanYuk / h);
        w *= olcek; h *= olcek;
        var once = bos() ? 0 : 0.5 * L;
        if (once + h > kalan() + 1e-6) yeniSayfa(); else bosluguKoy(once);
        sayfa.ogeler.push({ tur: 'resim', x: k.ic + (alanGen - w) / 2, y: ust - kullanilan - h, w: w, h: h, anahtar: r.anahtar, blok: i });
        kullanilan += h;
        if (r.pikselGen / (w / 72) < 300 - 1e-6) uyarilar.dusukDpi += 1;
        kullanilan += Math.min(0.5 * L, kalan());
        continue;
      }
      // paragraf / başlık
      var sl = satirlariAl(i);
      if (!sl.length) continue;
      var baslik = b.tur === 'baslik';
      var onBosluk = baslik ? L : 0;
      if (baslik) {
        // başlık + sonraki bloğun ilk 2 satırı aynı sayfada
        var gerek = (bos() ? 0 : onBosluk) + sl.length * L + 0.5 * L;
        var j = i + 1;
        if (j < bloklar.length && (bloklar[j].tur === 'paragraf' || bloklar[j].tur === 'baslik')) {
          var sonraki = satirlariAl(j);
          gerek += Math.min(2, sonraki.length) * (sonraki.length ? sonraki[0].yukseklik : 0);
        } else if (j < bloklar.length && bloklar[j].tur === 'resim') {
          gerek += L; // en az bir satırlık yer: resim sayfaya sığmazsa başlık onunla birlikte iner
        }
        if (gerek > kalan() + 1e-6 && !bos()) yeniSayfa();
        bosluguKoy(onBosluk);
        sl.forEach(function (s, n) { if (s.yukseklik > kalan() + 1e-6 && !bos()) yeniSayfa(); satirKoy(s, i, n); });
        kullanilan += Math.min(0.5 * L, kalan());
        continue;
      }
      var n = 0;
      while (n < sl.length) {
        var kalanSatir = sl.length - n;
        var sigan = Math.floor((kalan() + 1e-6) / L);
        if (sigan >= kalanSatir) { for (; n < sl.length; n++) satirKoy(sl[n], i, n); break; }
        // bölünmesi gerek
        var koy;
        if (bos()) {
          // boş sayfaya bile sığmıyor: sığanı koy, alttakine en az 2 satır bırak
          koy = Math.max(1, Math.min(sigan, kalanSatir - 2));
        } else if (kalanSatir <= 3 || sigan < 2 || (n === 0 && sl.length <= 3)) {
          yeniSayfa();
          continue;
        } else {
          koy = Math.min(sigan, kalanSatir - 2);
          if (koy < 2) { yeniSayfa(); continue; }
        }
        for (var t = 0; t < koy; t++, n++) satirKoy(sl[n], i, n);
        yeniSayfa();
      }
    }
    if (sayfa.ogeler.length) sayfalar.push(sayfa);
    // sayfa numaraları (bölüm açılış sayfasına basılmaz)
    if (ayar.sayfaNo) {
      var nb = ayar.sayfaNoBoy || 9;
      sayfalar.forEach(function (s, idx) {
        if (s.bolumBasi) return;
        var t = String(idx + 1);
        s.ogeler.push({ tur: 'metin', rol: 'sayfaNo', x: (ayar.sayfaGen - olc(t, 'R', nb)) / 2, y: k.alt / 2, metin: t, stil: 'R', boy: nb, bosluk: false });
      });
    }
    sayfalar.forEach(function (s, idx) { s.no = idx + 1; });
    return { sayfalar: sayfalar, uyarilar: uyarilar, alan: { x: k.ic, y: k.alt, w: alanGen, h: alanYuk } };
  }

  function diz(bloklar, ayar, olcer) {
    var it = dizUretec(bloklar, ayar, olcer);
    var r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  async function dizAsync(bloklar, ayar, olcer) {
    var it = dizUretec(bloklar, ayar, olcer);
    var r = it.next();
    while (!r.done) {
      await new Promise(function (ok) { setTimeout(ok, 0); });
      r = it.next();
    }
    return r.value;
  }

  /**
   * fontlar: { R, I, B, BI } fontkit yazı tipi nesneleri. Genişlik = Σ glyph.advanceWidth × boy / unitsPerEm
   * (pdf-lib CustomFontEmbedder.widthOfTextAtSize ile aynı; kerning yok, liga kapalı).
   */
  function fontkitOlcer(fontlar, ozellikler) {
    var oz = ozellikler || { liga: false };
    return {
      genislik: function (metin, stil, boy) {
        var f = fontlar[stil] || fontlar.R;
        var gl = f.layout(metin, oz).glyphs;
        var t = 0;
        for (var i = 0; i < gl.length; i++) t += gl[i].advanceWidth;
        return t * boy / f.unitsPerEm;
      }
    };
  }

  return { diz: diz, dizAsync: dizAsync, fontkitOlcer: fontkitOlcer, satirlar: satirlar, kelimelereAyir: kelimelereAyir, noktalar: noktalar, onbellekliOlcer: onbellekliOlcer };
});
