'use strict';
/*
 * dil-tarama.js — "arayüzde Türkçe sabit dizgi kalmadı" taraması için küçük sözcük çözümleyiciler.
 * `.test.js` değildir; dil.test.js kullanır. Kusurlu/zor girdilerle sınaması dil.test.js'te.
 *
 *   jsDizgileri(kaynak)    → [{ metin, satir }]  '…' "…" `…` (şablonun ${} dışı metni ayrıca, içi yeniden taranır);
 *                            yorumlar ve düzenli ifade (regex) değişmezleri atlanır.
 *   rustDizgileri(kaynak)  → [{ metin, satir, gunluk }]  "…", r"…", r#"…"#, b"…", karakter değişmezi; yorumlar
 *                            atlanır; test modülünden (#[cfg(test)] mod …) sonrası taranmaz. gunluk: değişmez
 *                            eprintln!, println!, panic!, assert ailesi ya da expect(…) içinde (kullanıcıya gitmez).
 *   htmlMetinleri(kaynak)  → [{ metin, satir }]  metin düğümleri + görünen öznitelikler (title, aria-label,
 *                            placeholder, alt); <script>, <style> ve yorumlar atlanır.
 */

const TURKCE_HARF = /[çğıöşüÇĞİÖŞÜ]/;
// Türkçe karakter taşımayan (ASCII'ye indirgenmiş) Türkçe cümleler için yardımcı sezgi; yalnız boşluk içeren
// değişmezde (tek sözcük kaynakta tanıtıcı olabilir: 'formali', 'kitaplar'). İki işaret (eskiden 26 sözcük):
//   1. sık Türkçe sözcük (ASCII biçimi). İngilizceyle çakışanlar bilerek yok: once, her, su, sure, sec, o, mi.
//   2. sık Türkçe ek, sözcük sonunda: -amadı/-emedi, -ıyor/-uyor, -ları/-leri, -siniz, -ilsin, -ildi, -ecek …
// Yanlış alarm sınaması: dil.test.js bütün en sözlüğü metinlerinin ve teknik dizgilerin Türkçe sayılmadığını denetler.
const SOZCUKLER = ['ve', 'bir', 'ile', 'icin', 'veya', 'ya da', 'gibi', 'kadar', 'daha', 'cok', 'hic', 'tum', 'tumu', 'butun', 'lutfen', 'tekrar',
  'yeniden', 'simdi', 'sonra', 'yok', 'degil', 'gerekli', 'olmali', 'sayfa', 'sayfaya', 'sayfalar', 'sayfasi', 'kitap', 'kitaba', 'kitabi',
  'kitaplar', 'forma', 'formalar', 'yaprak', 'dosya', 'dosyasi', 'dosyalar', 'hata', 'hatasi', 'uyari', 'bos', 'secin', 'secili', 'yukle',
  'yuklendi', 'kaydet', 'kaydedildi', 'alinir', 'kagit', 'kalinlik', 'genislik', 'yukseklik', 'olcu', 'olcusu', 'olculer', 'ayar', 'ayarlar',
  'ayari', 'sirt', 'mukavva', 'cilt', 'kapak', 'adim', 'adimlar', 'baski', 'onizleme', 'cikti', 'iptal', 'tamam', 'vazgec', 'silindi',
  'kaldir', 'islem', 'deger', 'gecersiz', 'bulunamadi'];
const TURKCE_SOZCUK = new RegExp('(^|[\\s(])(' + SOZCUKLER.join('|') + ')(?=$|[\\s.,;:)!?])', 'i');
// Ek yalnız sözcük başından başlayan sözcükte (CSS sınıfı '.surukleniyor', '#kimlik', 'a-b' tanıtıcıları sayılmaz).
const TURKCE_EK = /(?<![A-Za-z0-9_.#$@-])[a-z]{2,}(?:amadi|emedi|amiyor|emiyor|amaz|emez|iyor|uyor|lari|leri|larin|lerin|siniz|sunuz|iniz|unuz|ilsin|insin|ulsun|unsun|ildi|uldu|ilir|ulur|ecek|acak|landi|lendi)(?=$|[^a-z0-9_-])/i;

function satirSay(s, bas, son) {
  let n = 0;
  for (let i = bas; i < son; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

const REGEX_ONCESI_ANAHTAR = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

function jsDizgileri(kaynak, satirBas = 1) {
  const s = String(kaynak);
  const n = s.length;
  const cikti = [];
  let i = 0, satir = satirBas, son = 'bas';
  const dizgiOku = (tirnak) => {
    const bas = i, basSatir = satir;
    i++;
    let metin = '';
    while (i < n && s[i] !== tirnak) {
      if (s[i] === '\\') { metin += s[i + 1] === undefined ? '' : s[i + 1]; if (s[i + 1] === '\n') satir++; i += 2; continue; }
      if (s[i] === '\n') break; // kapanmamış dizgi: satır sonunda bitir
      metin += s[i];
      i++;
    }
    i++;
    void bas;
    cikti.push({ metin, satir: basSatir });
  };
  while (i < n) {
    const c = s[i];
    if (c === '\n') { satir++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i + 2);
      const bit = e < 0 ? n : e + 2;
      satir += satirSay(s, i, bit);
      i = bit;
      continue;
    }
    if (c === "'" || c === '"') { dizgiOku(c); son = 'deger'; continue; }
    if (c === '`') {
      const basSatir = satir;
      i++;
      let metin = '';
      while (i < n && s[i] !== '`') {
        if (s[i] === '\\') { metin += s[i + 1] || ''; i += 2; continue; }
        if (s[i] === '$' && s[i + 1] === '{') {
          // ${ ifade }: eşleşen } (iç içe { } ve dizgiler atlanarak); ifade yeniden taranır
          let derinlik = 1, j = i + 2;
          while (j < n && derinlik > 0) {
            const d = s[j];
            if (d === '{') derinlik++;
            else if (d === '}') derinlik--;
            else if (d === "'" || d === '"' || d === '`') {
              const t = d; j++;
              while (j < n && s[j] !== t) { if (s[j] === '\\') j++; j++; }
            }
            j++;
          }
          const ifade = s.slice(i + 2, j - 1);
          cikti.push(...jsDizgileri(ifade, satir));
          satir += satirSay(s, i, j);
          metin += ' ';
          i = j;
          continue;
        }
        if (s[i] === '\n') satir++;
        metin += s[i];
        i++;
      }
      i++;
      cikti.push({ metin, satir: basSatir });
      son = 'deger';
      continue;
    }
    if (c === '/') {
      if (son !== 'deger' && son !== 'ad' && son !== 'kapa') {
        // düzenli ifade değişmezi: kaçışlar ve [ … ] içi atlanır
        i++;
        let sinif = false;
        while (i < n && s[i] !== '\n') {
          if (s[i] === '\\') { i += 2; continue; }
          if (s[i] === '[') sinif = true;
          else if (s[i] === ']') sinif = false;
          else if (s[i] === '/' && !sinif) break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/i.test(s[i])) i++;
        son = 'deger';
        continue;
      }
      i++; son = 'isaret'; continue;
    }
    if (/[A-Za-z_$\u0080-￿]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$\u0080-￿]/.test(s[j])) j++;
      const ad = s.slice(i, j);
      son = REGEX_ONCESI_ANAHTAR.has(ad) ? 'isaret' : 'ad';
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) { while (i < n && /[0-9a-fA-FxXoObBn._]/.test(s[i])) i++; son = 'deger'; continue; }
    son = (c === ')' || c === ']' || c === '}') ? 'kapa' : 'isaret';
    i++;
  }
  return cikti;
}

const GUNLUK = new Set(['eprintln!', 'println!', 'eprint!', 'print!', 'panic!', 'unreachable!', 'todo!', 'assert!',
  'assert_eq!', 'assert_ne!', 'debug_assert!', 'debug_assert_eq!', 'expect', 'expect_err']);
const TEST_MODULU = /#\[cfg\(test\)\]\s*(pub(\([a-z]+\))?\s+)?mod\s/;

function rustDizgileri(kaynak) {
  let s = String(kaynak);
  const m = TEST_MODULU.exec(s);
  if (m) s = s.slice(0, m.index);
  const n = s.length;
  const cikti = [];
  const yigin = []; // açık parantezlerin sahibi (önceki ad)
  let i = 0, satir = 1, sonAd = '';
  const gunlukMu = () => yigin.some((a) => GUNLUK.has(a));
  while (i < n) {
    const c = s[i];
    if (c === '\n') { satir++; i++; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') {
      let derinlik = 1, j = i + 2;
      while (j < n && derinlik > 0) {
        if (s[j] === '/' && s[j + 1] === '*') { derinlik++; j += 2; continue; }
        if (s[j] === '*' && s[j + 1] === '/') { derinlik--; j += 2; continue; }
        j++;
      }
      satir += satirSay(s, i, j); i = j; continue;
    }
    // ham dizgi r"…", r#"…"#, br"…"
    const ham = /^b?r(#*)"/.exec(s.slice(i, i + 12));
    if (ham && !/[A-Za-z0-9_]/.test(s[i - 1] || '')) {
      const kapanis = '"' + ham[1];
      const bas = i + ham[0].length;
      const e = s.indexOf(kapanis, bas);
      const bit = e < 0 ? n : e;
      cikti.push({ metin: s.slice(bas, bit), satir, gunluk: gunlukMu() });
      satir += satirSay(s, i, bit);
      i = bit + kapanis.length; sonAd = ''; continue;
    }
    if (c === '"' || (c === 'b' && s[i + 1] === '"' && !/[A-Za-z0-9_]/.test(s[i - 1] || ''))) {
      if (c === 'b') i++;
      const basSatir = satir;
      i++;
      let metin = '';
      while (i < n && s[i] !== '"') {
        if (s[i] === '\\') { metin += s[i + 1] || ''; if (s[i + 1] === '\n') satir++; i += 2; continue; }
        if (s[i] === '\n') satir++;
        metin += s[i]; i++;
      }
      i++;
      cikti.push({ metin, satir: basSatir, gunluk: gunlukMu() });
      sonAd = ''; continue;
    }
    if (c === "'") {
      // karakter değişmezi ('x', '\n', '\u{..}') ya da ömür ('a)
      if (s[i + 1] === '\\') {
        const e = s.indexOf("'", i + 2);
        cikti.push({ metin: s.slice(i + 1, e), satir, gunluk: gunlukMu() });
        i = e + 1; continue;
      }
      const kod = s.codePointAt(i + 1);
      const uz = kod > 0xffff ? 2 : 1;
      if (s[i + 1 + uz] === "'") { cikti.push({ metin: s.slice(i + 1, i + 1 + uz), satir, gunluk: gunlukMu() }); i += 2 + uz; continue; }
      i++; continue; // ömür
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(s[j])) j++;
      sonAd = s.slice(i, j) + (s[j] === '!' ? '!' : '');
      i = s[j] === '!' ? j + 1 : j;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { yigin.push(sonAd); sonAd = ''; i++; continue; }
    if (c === ')' || c === ']' || c === '}') { yigin.pop(); sonAd = ''; i++; continue; }
    if (!/\s/.test(c)) sonAd = c === '.' || c === ':' ? sonAd : '';
    i++;
  }
  return cikti;
}

const GORUNEN_OZNITELIK = /\s(title|aria-label|placeholder|alt)\s*=\s*"([^"]*)"/g;

function htmlMetinleri(kaynak) {
  const s = String(kaynak);
  const cikti = [];
  // yorum, script, style: aynı uzunlukta boşlukla değiştirilir (satır numaraları korunur)
  const sil = (t) => t.replace(/[^\n]/g, ' ');
  const temiz = s.replace(/<!--[\s\S]*?-->/g, sil).replace(/<script\b[\s\S]*?<\/script>/gi, sil).replace(/<style\b[\s\S]*?<\/style>/gi, sil);
  const satirBul = (k) => 1 + satirSay(temiz, 0, k);
  const etiket = /<[^>]*>/g;
  let m, onceki = 0;
  while ((m = etiket.exec(temiz)) !== null) {
    const metin = temiz.slice(onceki, m.index);
    if (metin.trim()) cikti.push({ metin: metin.trim(), satir: satirBul(onceki) });
    let o;
    GORUNEN_OZNITELIK.lastIndex = 0;
    while ((o = GORUNEN_OZNITELIK.exec(m[0])) !== null) cikti.push({ metin: o[2], satir: satirBul(m.index), oznitelik: o[1] });
    onceki = m.index + m[0].length;
  }
  const kalan = temiz.slice(onceki);
  if (kalan.trim()) cikti.push({ metin: kalan.trim(), satir: satirBul(onceki) });
  return cikti;
}

/** Türkçe görünen metin mi? (Türkçe harf ya da boşluklu değişmezde sık Türkçe sözcük / ek.) */
function turkceMi(metin) {
  // uygulama adı (çalışma adı) çevrilmez; Öğren'in kitap kapağı çiziminde büyük harfle (en: "MUCELLIT", tr: "MÜCELLİT").
  // yalnız tam ad (sözcük sınırı); "Mücellitler", "Mücellitin" gibi Türkçe sözcükler muaf değil.
  const m = String(metin).replace(/\b(?:Mücellit|MUCELLIT)\b/g, '');
  if (TURKCE_HARF.test(m)) return true;
  // Makine kodu öneki (BULUNAMADI:, GECERSIZ: …; Rust → JS hata öneki, JS'te dile göre metne çevrilir) sözcük
  // sayılmaz. yalnız ":" ile biten BÜYÜK HARFLİ önek atılır; tamamı büyük harfli Türkçe cümle ("DOSYA
  // ACILAMADI") artık taranır (eskiden her büyük harfli sözcük atılıyordu).
  const s = m.replace(/(^|[^A-Za-z0-9_])[A-Z][A-Z0-9_]{2,}:(?=\s|$)/g, '$1');
  return /\s/.test(s.trim()) && (TURKCE_SOZCUK.test(s) || TURKCE_EK.test(s));
}

module.exports = { jsDizgileri, rustDizgileri, htmlMetinleri, turkceMi, TURKCE_HARF };
