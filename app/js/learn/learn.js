/*
 * learn.js — "Öğren" rehberinin denetleyicisi: aşama listesi, adım kartı (açıklama, araç/malzeme, Dikkat), ilerleme,
 * adım oynatma, "baştan sona oynat", kitabın sayıları paneli. Figürleri cfKur (cf-page.js) ile kurar.
 * Bütün kullanıcı metinleri sözlükten (KitapCilt.dil.t); burada sabit kullanıcı metni yok.
 * Dışa açık tek arayüz KitapCilt.ogren.sekme (goster/gizle; app.js sekmeAc çağırır). Test arayüzü üründe yok:
 * e2e kendi test kopyasına ekler (app/test/ altındaki enjeksiyon betiği).
 * (uygulamaya ekleme; Öğren prototipinden uyarlandı):
 *  - Öğren sekmesinde (#sekme-ogren) çalışır; öğe kimlikleri "og-" önekli (uygulamanın kimlikleriyle çakışmasın).
 *  - Kendi dil seçicisi yok: uygulamanın dili (KitapCilt.dil); dil değişince uygulama sayfayı yeniden yükler, rehber
 *    yeni dilde kurulur; aşama/adım konumu ve aşamaların ilerlemesi (tamam) sessionStorage'da kalır (yeniden yüklemede
 *    kaybolmaz).
 *  - Tembel kurulum: sekme ilk açıldığında kurulur (KitapCilt.ogren.sekme.goster); sekmeden çıkınca
 *    (KitapCilt.ogren.sekme.gizle) "baştan sona" durur, figür sökülür (animasyon, rAF, dinleyiciler bırakılır).
 *  - Sayı paneli öntanımlı olarak Hesapla sekmesinin girdileri ve sonucu (KitapCilt.hesapla.durum); elle
 *    değişiklik yalnız rehberde kalır; "Hesapla'dan al" yeniden Hesapla'ya bağlar. Belge başlığı ve URL değişmez.
 * LİSANS NOTU: Mücellit kodu (MIT, kökteki LICENSE); Colorfigures kodu içermez. Bu klasördeki Colorfigures parçaları MIT lisanslı
 * (April Zhu, Tolga Cohce), tam metin: LICENSE.
 */
'use strict';
(function (kok) {
  const KC = kok.KitapCilt.ogren, Dil = kok.KitapCilt.dil, doc = kok.document;
  const t = (a, p) => Dil.t(a, p);
  const $ = id => doc.getElementById('og-' + id);   // kimlikler og- önekli
  const DERS = KC.dersler;
  const SAYI_ALANLARI = ['formaSayisi', 'formaYaprak', 'kitapGen', 'kitapYuk', 'kagitKalinlik'];

  const durum = {
    a: 0, i: 0, ui: null, fig: null, olcu: null, girdi: Object.assign({}, KC.olcu.VARSAYILAN),
    tamam: DERS.map(() => 0), oynuyor: false, akis: false, akisId: 0, xr: 0, etiket: false, bitti: false,
    kurulu: false, gorunur: false, elle: false, taban: null, uyum: true
  };
  const KONUM = 'kitapCilt.ogren.konum';
  function konumYaz() { try { kok.sessionStorage.setItem(KONUM, JSON.stringify({ a: durum.a, i: durum.i, tamam: durum.tamam })); } catch (_) { /* depolama yok */ } }
  /** Kayıtlı konum ve ilerleme; bozuk ilerleme (uzunluk, tür, sınır) yok sayılır, konum yine kullanılır. */
  function konumOku() {
    try { const k = JSON.parse(kok.sessionStorage.getItem(KONUM) || 'null');
      if (k && Number.isInteger(k.a) && k.a >= 0 && k.a < DERS.length && Number.isInteger(k.i) && k.i >= 0) {
        const t = Array.isArray(k.tamam) && k.tamam.length === DERS.length &&
          k.tamam.every((v, a) => Number.isInteger(v) && v >= 0 && v <= DERS[a].adimlar.length) ? k.tamam.slice() : null;
        return { a: k.a, i: Math.min(k.i, DERS[k.a].adimlar.length), tamam: t };
      }
    } catch (_) { /* bozuk ya da yok */ }
    return null;
  }

  /* ---------- sayılar ---------- */
  const sayi = (n, b) => Dil.sayi(n, b === undefined ? 2 : b);
  const olcu2 = (a, b) => t('ogren.olcu_iki', { a: sayi(a), b: sayi(b) });
  /** Metinlerdeki {yer tutucu} değerleri (dile göre sayı yazımı). */
  function degerler(o) {
    return {
      forma: o.N, formaYaprak: o.y, formaSayfa: o.y * 4, sayfa: o.sayfa, baskiKagidi: o.baskiKagidi, yaprak: o.yaprak,
      W: sayi(o.W), H: sayi(o.H), kagitGen: sayi(2 * o.W), kagit: sayi(o.kagit, 3),
      sirt: sayi(o.S), mafsal: sayi(o.f), t: sayi(o.t), k: sayi(o.k), e: sayi(o.e),
      mukavva: olcu2(o.Db, o.Dh), sirtSeridi: olcu2(o.R, o.Dh), kaplama: olcu2(o.kaplama.gen, o.kaplama.yuk),
      forza: olcu2(o.forza.gen, o.forza.yuk), mull: olcu2(o.mull.gen, o.mull.yuk), kapital: sayi(o.kapital),
      delik: o.istasyon.sayi, aralik: sayi(o.istasyon.aralik, 0), ucPayi: sayi(o.istasyon.ucPayi), iplik: sayi(o.iplik, 0),
      koseAlt: sayi(o.kose[0]), koseUst: sayi(o.kose[1]),
      sonSayfa: o.y * 4, arka2: o.y * 4 - 1, kalan: Math.max(0, o.N - 3)
    };
  }

  /* ---------- figür ---------- */
  const metinCF = () => ({
    gorunum: t('ogren.cf.gorunum'), onden: t('ogren.cf.onden'),
    doner: t('ogren.cf.doner'), icini_gor: t('ogren.cf.icini_gor'), etiketler: t('ogren.cf.etiketler'),
    yakinlas: t('ogren.cf.yakinlas'), uzaklas: t('ogren.cf.uzaklas'), sifirla: t('ogren.cf.sifirla')
  });

  function sok() { if (durum.ui) { try { durum.ui.sok(); } catch (_) { /* söküldü */ } durum.ui = null; durum.fig = null; } }
  function kur(a, i) {
    durum.akisId += durum.akis ? 0 : 1;
    sok();
    durum.a = a; durum.i = Math.max(0, Math.min(DERS[a].adimlar.length, i)); durum.oynuyor = false;
    konumYaz();
    if (!durum.gorunur) { ciz(); return; }   // gizli sekmede figür kurulmaz (animasyon, rAF yok)
    const d = DERS[a], o = { olcu: durum.olcu, t, sayi, deger: degerler(durum.olcu), asama: d.id,
      calistir: id => { const j = d.adimlar.indexOf(id); if (j >= 0 && !durum.akis) calistir(j); } };
    const fig = KC.sekil[d.sekil](o);
    durum.fig = fig;
    const st = fig.cfg.state;
    for (const id of (d.hazir || [])) fig.adim[id].son(st);
    for (let j = 0; j < durum.i; j++) fig.adim[d.adimlar[j]].son(st);
    const cfg = Object.assign({}, fig.cfg, {
      kok: $('sahne'), metin: metinCF(), xr: durum.xr, etiket: durum.etiket, turn: 'full',
      buttons: d.adimlar.map((id, j) => ({ id, label: t(`ogren.${d.id}.${id}.dugme`), onClick: () => calistir(j) })),
      gorunumDegisti: g => { if ('xr' in g) durum.xr = g.xr ? 1 : 0; if ('etiket' in g) durum.etiket = g.etiket; }
    });
    durum.ui = KC.cfKur(cfg);
    ciz();
  }

  /** Adımı oynatır; bitince (animasyon durunca) ilerlemeyi yazar. Başladıysa söz (bitince çözülür), başlamadıysa false. */
  function calistir(j) {
    const ui = durum.ui, d = DERS[durum.a];
    if (!ui || !durum.gorunur) return false;
    if (durum.oynuyor || ui.mesgul()) { ui.flash(t('ogren.f.mesgul')); return false; }
    const ad = d.adimlar[j], basladi = durum.fig.adim[ad].eylem(ui.st, ui);
    ui.render();
    if (!basladi) return false;
    durum.oynuyor = true; ciz();
    const a = durum.a, ui0 = ui;
    return new Promise(coz => {
      const bekle = () => {
        if (durum.ui !== ui0) { coz(false); return; }
        if (ui0.mesgul()) { requestAnimationFrame(bekle); return; }
        durum.oynuyor = false;
        if (j >= durum.i) durum.i = j + 1;
        durum.tamam[a] = Math.max(durum.tamam[a], durum.i);
        if (a === DERS.length - 1 && durum.i === d.adimlar.length) durum.bitti = true;
        konumYaz();   // oynanan adımdan sonra da konum ve ilerleme saklanır (dil değişiminde kaybolmaz)
        ciz(); coz(true);
      };
      requestAnimationFrame(bekle);
    });
  }

  /* ---------- oynatma düğmeleri ---------- */
  function oynat() {
    const d = DERS[durum.a];
    if (durum.i >= d.adimlar.length) { if (durum.a < DERS.length - 1) { kur(durum.a + 1, 0); return calistir(0); } return false; }
    return calistir(durum.i);
  }
  function onceki() {
    if (durum.akis) return;
    if (durum.i > 0) kur(durum.a, durum.i - 1);
    else if (durum.a > 0) kur(durum.a - 1, DERS[durum.a - 1].adimlar.length - 1);
  }
  function sonraki() {
    if (durum.akis) return;
    const n = DERS[durum.a].adimlar.length;
    if (durum.i < n) { durum.tamam[durum.a] = Math.max(durum.tamam[durum.a], durum.i + 1); kur(durum.a, durum.i + 1); }
    else if (durum.a < DERS.length - 1) kur(durum.a + 1, 0);
  }
  function yeniden() {
    if (durum.akis) return;
    const j = Math.max(0, durum.i - 1);
    kur(durum.a, j); calistir(j);
  }
  const bekle = ms => new Promise(r => setTimeout(r, ms / (KC.hiz || 1)));
  async function bastanSona() {
    if (durum.akis) { durum.akis = false; durum.akisId++; ciz(); return; }
    durum.akis = true; durum.bitti = false; const id = ++durum.akisId; ciz();
    try {
      for (let a = 0; a < DERS.length; a++) {
        kur(a, 0);
        for (let j = 0; j < DERS[a].adimlar.length; j++) {
          await bekle(700);
          if (!durum.akis || durum.akisId !== id) return;
          const p = calistir(j);
          if (p && p.then) await p;
          if (!durum.akis || durum.akisId !== id) return;
          await bekle(500);
        }
      }
      durum.bitti = true;
    } finally {
      if (durum.akisId === id) { durum.akis = false; ciz(); }
    }
  }

  /* ---------- çizim (adım kartı, aşama listesi, ilerleme) ---------- */
  function metinVar(a) { return Dil.var(a); }
  function ciz() {
    const d = DERS[durum.a], n = d.adimlar.length, D = degerler(durum.olcu);
    // aşama listesi
    const ol = $('asamalar'); ol.textContent = '';
    DERS.forEach((x, a) => {
      const li = doc.createElement('li'), b = doc.createElement('button'); b.type = 'button';
      b.className = 'asama' + (a === durum.a ? ' guncel' : '') + (durum.tamam[a] >= x.adimlar.length ? ' bitti' : '');
      const no = doc.createElement('span'); no.className = 'no'; no.textContent = String(a + 1);
      const ad = doc.createElement('span'); ad.className = 'ad'; ad.textContent = t(`ogren.${x.id}.ad`);
      const sy = doc.createElement('span'); sy.className = 'sy'; sy.textContent = t('ogren.adim_sayisi', { i: durum.tamam[a], n: x.adimlar.length });
      b.append(no, ad, sy); b.disabled = durum.akis;
      b.onclick = () => kur(a, 0);
      li.appendChild(b); ol.appendChild(li);
    });
    // genel ilerleme
    const top = DERS.reduce((s, x) => s + x.adimlar.length, 0), biten = durum.tamam.reduce((s, v) => s + v, 0);
    $('ilerleme-cubuk').style.width = (100 * biten / top).toFixed(1) + '%';
    $('ilerleme-cubuk').parentNode.setAttribute('aria-valuenow', String(biten));
    $('ilerleme-cubuk').parentNode.setAttribute('aria-valuemax', String(top));
    $('ilerleme-metin').textContent = t('ogren.genel', { i: biten, n: top });
    // adım kartı
    $('asama-ad').textContent = t('ogren.asama_no', { a: durum.a + 1, an: DERS.length }) + ' · ' + t(`ogren.${d.id}.ad`);
    $('asama-ozet').textContent = t(`ogren.${d.id}.ozet`, D);
    const adl = $('adimlar'); adl.textContent = '';
    d.adimlar.forEach((id, j) => {
      const li = doc.createElement('li');
      li.className = (j < durum.i ? 'bitti' : '') + (j === durum.i ? ' guncel' : '');
      li.textContent = t(`ogren.${d.id}.${id}.baslik`, D);
      adl.appendChild(li);
    });
    const kart = $('kart');
    if (durum.i < n) {
      const id = d.adimlar[durum.i], k = `ogren.${d.id}.${id}`;
      const az = d.az && d.az[id] && d.az[id](durum.olcu);
      $('adim-no').textContent = t('ogren.adim_no', { i: durum.i + 1, n });
      $('adim-baslik').textContent = t(k + '.baslik', D);
      $('adim-aciklama').textContent = t(k + (az && metinVar(k + '.aciklama_az') ? '.aciklama_az' : '.aciklama'), D);
      const arac = metinVar(k + '.arac'), dikkat = metinVar(k + '.dikkat');
      $('arac-kutu').hidden = !arac; $('arac').textContent = arac ? t(k + '.arac', D) : '';
      $('dikkat-kutu').hidden = !dikkat; $('dikkat').textContent = dikkat ? t(k + '.dikkat', D) : '';
      kart.classList.remove('son');
    } else {
      const sonA = durum.a === DERS.length - 1;
      $('adim-no').textContent = t('ogren.asama_tamam');
      $('adim-baslik').textContent = sonA ? t('ogren.bitti_baslik') : t('ogren.sonraki_asama', { ad: t(`ogren.${DERS[durum.a + 1].id}.ad`) });
      $('adim-aciklama').textContent = sonA ? t('ogren.bitti_metin', D) : t(`ogren.${DERS[durum.a + 1].id}.ozet`, D);
      $('arac-kutu').hidden = true; $('dikkat-kutu').hidden = true;
      kart.classList.add('son');
    }
    const ui = durum.ui;
    if (ui && ui.dugmeler) ui.dugmeler.forEach((b, j) => { b.classList.toggle('yapildi', j < durum.i); b.classList.toggle('sirada', j === durum.i); });
    $('oynat').disabled = durum.oynuyor || durum.akis || (durum.a === DERS.length - 1 && durum.i >= n);
    $('oynat').textContent = durum.i >= n && durum.a < DERS.length - 1 ? t('ogren.sonraki_asama_oynat') : t('ogren.oynat');
    $('onceki').disabled = durum.akis || (durum.a === 0 && durum.i === 0);
    $('sonraki').disabled = durum.akis || (durum.a === DERS.length - 1 && durum.i >= n);
    $('yeniden').disabled = durum.akis || durum.oynuyor || durum.i === 0;
    $('bastan-sona').textContent = durum.akis ? t('ogren.durdur') : t('ogren.bastan_sona');
    $('bastan-sona').setAttribute('aria-pressed', durum.akis ? 'true' : 'false');
    const kokOge = $('kok');
    if (kokOge) { kokOge.dataset.durum = durum.akis ? 'akis' : durum.oynuyor ? 'oynuyor' : 'hazir'; kokOge.dataset.bitti = durum.bitti ? '1' : '0'; }
  }

  /* ---------- sayı paneli ---------- */
  function sonuclariYaz() {
    const o = durum.olcu, tb = $('sonuclar'); tb.textContent = '';
    const satir = (k, v, ipucu) => { const tr = doc.createElement('tr'); const th = doc.createElement('th'); th.scope = 'row'; th.textContent = t(k);
      const td = doc.createElement('td'); td.textContent = v; td.dataset.k = k.split('.').pop(); if (ipucu) td.title = ipucu; tr.append(th, td); tb.appendChild(tr); };
    const mm = v => t('ogren.mm', { v });
    satir('ogren.p.sayfa', String(o.sayfa));
    satir('ogren.p.forma', String(o.N));
    satir('ogren.p.yaprak', String(o.yaprak));
    satir('ogren.p.baski', String(o.baskiKagidi));
    satir('ogren.p.sirt', mm(sayi(o.S)));
    satir('ogren.p.mukavva', mm(olcu2(o.Db, o.Dh)));
    satir('ogren.p.serit', mm(olcu2(o.R, o.Dh)));
    satir('ogren.p.mafsal', mm(sayi(o.f)));
    satir('ogren.p.tasma', mm(sayi(o.k)));
    satir('ogren.p.kivirma', mm(sayi(o.e)));
    satir('ogren.p.kose', t('ogren.mm_aralik', { a: sayi(o.kose[0]), b: sayi(o.kose[1]) }));
    satir('ogren.p.kaplama', mm(olcu2(o.kaplama.gen, o.kaplama.yuk)));
    satir('ogren.p.forza', mm(olcu2(o.forza.gen, o.forza.yuk)));
    satir('ogren.p.mull', mm(olcu2(o.mull.gen, o.mull.yuk)));
    satir('ogren.p.kapital', mm(sayi(o.kapital)));
    satir('ogren.p.delik', t('ogren.p.delik_deger', { n: o.istasyon.sayi, a: sayi(o.istasyon.aralik, 0) }));
    satir('ogren.p.iplik', t('ogren.yaklasik_mm', { v: sayi(o.iplik, 0) }));
    $('uyum').hidden = !(durum.taban && !durum.elle && !durum.uyum);
  }
  function alanlariYaz() {
    for (const a of SAYI_ALANLARI) $('g-' + a).value = Dil.sayiAlan(durum.girdi[a]);
  }
  function sayilarDegisti() {
    const g = {};
    $('sayi-not').hidden = true;
    for (const a of SAYI_ALANLARI) g[a] = $('g-' + a).value;
    const hatali = KC.olcu.gecersizAlanlar(g);
    for (const a of SAYI_ALANLARI) $('g-' + a).setAttribute('aria-invalid', hatali.includes(a) ? 'true' : 'false');
    if (hatali.length) {
      $('sayi-hata').hidden = false;
      $('sayi-hata').textContent = t('ogren.gecersiz', { alanlar: hatali.map(a => t('ogren.g.' + a)).join(', ') });
      return false;
    }
    $('sayi-hata').hidden = true;
    for (const a of SAYI_ALANLARI) g[a] = KC.olcu.sayiOku(g[a]);
    const o = KC.olcu.hesapla(g, durum.taban);
    durum.elle = o.kaynak !== 'hesapla';   // Hesapla'nın değerleriyle aynıysa bağ sürer
    durum.girdi = g; durum.olcu = o;
    sonuclariYaz();
    if (!durum.akis) kur(durum.a, durum.i); else ciz();
    return true;
  }

  /* ---------- Hesapla sekmesi ---------- */
  function hesaplaDurumu() { return kok.KitapCilt.hesapla && kok.KitapCilt.hesapla.durum ? kok.KitapCilt.hesapla.durum() : null; }
  /**
   * Sayıları Hesapla sekmesinden alır (taban). Hesapla hatalı ya da rehberin sınırları dışındaysa önceki sayılar kalır ve
   * not gösterilir; ilk kurulumda taban yoksa yedek öntanımlı (Örnek Kitap). Değişti mi döner.
   */
  function hesapladanAl() {
    const tb = KC.olcu.tabandan(hesaplaDurumu());
    const not = $('sayi-not');
    $('sayi-hata').hidden = true;
    for (const a of SAYI_ALANLARI) $('g-' + a).setAttribute('aria-invalid', 'false');
    if (!tb.girdi) {
      not.hidden = false;
      not.textContent = tb.alanlar ? t('ogren.hesapla_disi', { alanlar: tb.alanlar.map(a => t('ogren.g.' + a)).join(', ') }) : t('ogren.hesapla_hata');
      if (!durum.olcu) { durum.taban = null; durum.olcu = KC.olcu.hesapla(durum.girdi); alanlariYaz(); sonuclariYaz(); return true; }
      return false;
    }
    not.hidden = true;
    const eski = durum.olcu && JSON.stringify(durum.olcu.hesap.girdi) + JSON.stringify(durum.olcu.girdi);
    durum.taban = tb; durum.uyum = tb.uyum; durum.elle = false;
    durum.girdi = Object.assign({}, tb.bes); durum.olcu = KC.olcu.hesapla(durum.girdi, tb);
    alanlariYaz(); sonuclariYaz();
    return eski !== JSON.stringify(durum.olcu.hesap.girdi) + JSON.stringify(durum.olcu.girdi);
  }

  /* ---------- kurulum ve sekme ---------- */
  function ilkKur() {
    durum.kurulu = true;
    hesapladanAl();
    for (const a of SAYI_ALANLARI) $('g-' + a).addEventListener('change', sayilarDegisti);
    $('sayi-form').addEventListener('submit', e => { e.preventDefault(); sayilarDegisti(); });
    $('hesapladan-al').addEventListener('click', () => { const degisti = hesapladanAl(); if (!durum.akis && (degisti || !durum.ui)) kur(durum.a, durum.i); else ciz(); });
    $('oynat').onclick = () => { oynat(); };
    $('onceki').onclick = onceki; $('sonraki').onclick = sonraki; $('yeniden').onclick = yeniden;
    $('bastan-sona').onclick = () => { bastanSona(); };
    $('hiz').onchange = () => { KC.hiz = Number($('hiz').value) || 1; };
    KC.hiz = Number($('hiz').value) || 1;
    const k = konumOku();
    if (k) { durum.a = k.a; durum.i = k.i; if (k.tamam) durum.tamam = k.tamam; }
  }
  /**
   * Sekme açıldı: ilk kez kurulur; Hesapla'ya bağlıysa (elle değişiklik yoksa) sayılar yenilenir; figür kurulur.
   * Sekme zaten görünür ve figür kuruluysa (⌘4 / menü / sekme yeniden basıldı) hiçbir şey yapılmaz: figür söküp
   * yeniden kurulsaydı oynayan adım yarıda kalır, "baştan sona" sonraki adıma geçip birini atlardı.
   */
  function goster() {
    if (durum.gorunur && durum.ui) return;
    durum.gorunur = true;
    if (!durum.kurulu) ilkKur();
    else if (!durum.elle) hesapladanAl();
    kur(durum.a, durum.i);
  }
  /** Sekmeden çıkıldı: baştan sona durur, figür sökülür (gizli sekmede animasyon ve rAF çalışmaz). */
  function gizle() {
    durum.gorunur = false;
    if (durum.akis) { durum.akis = false; durum.akisId++; }
    durum.oynuyor = false;
    sok();
    if (durum.kurulu) ciz();
  }
  KC.sekme = { goster, gizle };
})(typeof self !== 'undefined' ? self : this);
