/*
 * mutasyon-sinamasi.mjs — testlerin kusurlu uygulamayı yakaladığını gösterir.
 * Çalıştırma (repo kökünden): node araclar/mutasyon-sinamasi.mjs
 *
 *  geçici bir dizine kopyalanır; her mutasyonda kopyadaki
 * bir dosya bilerek bozulur, birim testleri ve/veya e2e çalıştırılır. Beklenen:
 * her mutasyonda en az bir test KALIR (çıkış kodu ≠ 0). Bozulmamış kopya ise
 * geçmelidir (kontrol koşusu). Asıl dosyalara dokunulmaz.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MUTASYONLAR = [
  { ad: 'formalı ön yüz sol/sağ yer değiştirmiş', dosya: 'app/js/dizilim.js', bul: 'on: [ofset + n - 2 * i, ofset + 1 + 2 * i]', koy: 'on: [ofset + 1 + 2 * i, ofset + n - 2 * i]', kosu: ['birim', 'e2e'] },
  { ad: 'forma boş sayfayla tamamlanmıyor (son forma hep küçük)', dosya: 'app/js/dizilim.js', bul: "formaYapraklari.push(ayar.sonFormaKucult ? Math.ceil(kalan / 4) : k)", koy: 'formaYapraklari.push(Math.ceil(kalan / 4))', kosu: ['birim', 'e2e'] },
  { ad: '2-up arka yüz yanlış', dosya: 'app/js/dizilim.js', bul: 'arka: [2 * N + 2 * i + 2, 2 * i + 2]', koy: 'arka: [2 * i + 2, 2 * N + 2 * i + 2]', kosu: ['birim'] },
  { ad: 'kayma yarım', dosya: 'app/js/dizilim.js', bul: 'return yuvarla(i * k);', koy: 'return yuvarla(i * k / 2);', kosu: ['birim'] },
  { ad: 'sırt kalınlığı forza payını iki kez sayıyor / yanlış', dosya: 'app/js/hesap.js', bul: "sayi(yaprak, 'yaprak', 0) * sayi(kalinlik, 'kagit_kalinligi', 0)", koy: "sayi(yaprak, 'yaprak', 0) * 2 * sayi(kalinlik, 'kagit_kalinligi', 0)", kosu: ['birim'] },
  { ad: 'çıktı kağıdı dikey (gen/yük ters)', dosya: 'app/js/cikti.js', bul: 'doc.addPage([pt(yer.kagit.gen), pt(yer.kagit.yuk)])', koy: 'doc.addPage([pt(yer.kagit.yuk), pt(yer.kagit.gen)])', kosu: ['e2e'] },
  { ad: 'süreç verisi saklanmıyor', dosya: 'app/js/depo.js', bul: 'kok.localStorage.setItem(ANAHTAR, JSON.stringify(veri));', koy: '/* yazma yok */', kosu: ['e2e'] },
  { ad: 'içe aktarma notları düşürüyor', dosya: 'app/js/surec.js', bul: '        veri = yeni;\n', koy: '        yeni.kitaplar.forEach(function (k) { k.adimlar.forEach(function (a) { a.not = ""; }); });\n        veri = yeni;\n', kosu: ['e2e'] },
  { ad: 'başlangıçta console.error', dosya: 'app/js/uygulama.js', bul: "document.documentElement.setAttribute('data-hazir', 'evet');", koy: "console.error('deneme hatası'); document.documentElement.setAttribute('data-hazir', 'evet');", kosu: ['e2e'] },
  { ad: 'izinsiz dış ağ isteği', dosya: 'app/js/uygulama.js', bul: "document.documentElement.setAttribute('data-hazir', 'evet');", koy: "try { new Image().src = 'https://example.com/izle.gif'; } catch (e) {} document.documentElement.setAttribute('data-hazir', 'evet');", kosu: ['e2e', 'grep'] },
  { ad: 'kütüphane yeniden CDN\'den yükleniyor', dosya: 'app/index.html', bul: 'vendor/pdf-lib/pdf-lib.min.js', koy: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', kosu: ['grep'] },
  { ad: 'yerel kütüphane yolu bozuk (pdf.js)', dosya: 'app/index.html', bul: 'vendor/pdfjs/pdf.min.js', koy: 'vendor/pdfjs/yok.min.js', kosu: ['e2e'] },
  // ---- düzeltme turu ----
  { ad: 'arkalar ters sıra (arkaTers) uygulanmıyor', dosya: 'app/js/cikti.js', bul: 'if (ayar.arkaTers) arkalar = arkalar.slice().reverse();', koy: '', kosu: ['e2e'] },
  { ad: '"başa boş" sona ekleniyor', dosya: 'app/js/duzenle.js', bul: "D.sayfalar.unshift({ id: yeniId(), tur: 'bos' })", koy: "D.sayfalar.push({ id: yeniId(), tur: 'bos' })", kosu: ['e2e'] },
  { ad: 'cikti: arka yüz 180° dönüşü uygulanmıyor', dosya: 'app/js/cikti.js', bul: '(yuz.dondur180 ? 180 : 0)', koy: '0', kosu: ['e2e'] },
  { ad: 'cikti: CropBox/MediaBox kutusu embedPages\'e verilmiyor', dosya: 'app/js/cikti.js', bul: 'await doc.embedPages(gomulecek, kutular)', koy: 'await doc.embedPages(gomulecek)', kosu: ['e2e'] },
  { ad: 'cikti: /Contents\'siz sayfa korumasız', dosya: 'app/js/cikti.js', bul: "if (!icerik || (icerik instanceof PDFLib.PDFArray && icerik.size() === 0)) {", koy: 'if (false) {', kosu: ['e2e'] },
  { ad: 'şifreli/kısıtlı PDF algılanmıyor', dosya: 'app/js/duzenle.js', bul: 'D.sifreli = sifreli === true;', koy: 'D.sifreli = false;', kosu: ['e2e'] },
  { ad: 'kağıda sığmayan yerleşimde indirme açık', dosya: 'app/js/duzenle.js', bul: 'D.engel = D.sifreli || D.denetimYok || !!r.yerlesim.sigmiyor;', koy: 'D.engel = D.sifreli || D.denetimYok;', kosu: ['e2e'] },
  { ad: 'depo.oku kota doluyken eski kaydı döndürüyor', dosya: 'app/js/depo.js', bul: 'if (!kalici && bellek) return bellekKopya();', koy: '', kosu: ['birim'] },
  { ad: 'negatif kenar/cilt payı kabul ediliyor', dosya: 'app/js/yerlesim.js', bul: 'if (dis < 0 || cilt < 0) throw', koy: 'if (false) throw', kosu: ['birim'] },
  { ad: 'sırt işareti yeni turda yana kayıyor (katlama çizgisinden ayrılıyor)', dosya: 'app/js/yerlesim.js', bul: 'x: yuvarla(ortaX - SIRT_GEN / 2),', koy: 'x: yuvarla(ortaX - SIRT_GEN / 2 + tur2 * 4),', kosu: ['birim'] },
  { ad: 'sırt işareti biçimi turla değişmiyor (hep dolu)', dosya: 'app/js/yerlesim.js', bul: 'stil: tur2 % SIRT_STIL', koy: 'stil: 0', kosu: ['birim'] },
  { ad: 'sifreliMi hata dalında false döndürüyor (kapalı başarısız yerine açık)', dosya: 'app/js/duzenle.js', bul: '} catch { return null; }', koy: '} catch { return false; }', kosu: ['e2e'] },
  { ad: 'Db <= 0 sonucu reddedilmiyor', dosya: 'app/js/hesap.js', bul: "if (!(c[1] > 0)) throw new RangeError(t('hesap.sifir_negatif'", koy: "if (false) throw new RangeError(t('hesap.sifir_negatif'", kosu: ['birim'] },
  { ad: 'taşma 0 reddediliyor', dosya: 'app/js/hesap.js', bul: 'if (!(k >= 0)) throw', koy: 'if (!(k > 0)) throw', kosu: ['birim'] },
  { ad: 'depo.temizle belleği boş veri yapmıyor (eski kayıt dönebilir)', dosya: 'app/js/depo.js', bul: 'bellek = KC.surecModel.bosVeri();\n    bozukKayit = false;', koy: 'bellek = null;', kosu: ['birim'] },
  { ad: 'guncelVeri canlı nesneyi döndürüyor', dosya: 'app/js/duzenle.js', bul: 'return JSON.parse(JSON.stringify(v)); // kopya', koy: 'return v; // kopya', kosu: ['e2e'] },
  { ad: 'parolalı PDF için window.prompt geri geldi', dosya: 'app/js/duzenle.js', bul: "if (e && e.name === 'PasswordException') return parolaliBelge(ad);", koy: "if (e && e.name === 'PasswordException') { window.prompt('parola'); return parolaliBelge(ad); }", kosu: ['e2e'] },
  { ad: 'içe aktarmada adım id tekrarı kabul ediliyor', dosya: 'app/js/surec-model.js', bul: 'if (a.id in adimIdleri) throw', koy: 'if (false) throw', kosu: ['birim'] },
  { ad: 'Hesapla forma yaprağını yuvarlıyor', dosya: 'app/js/hesap.js', bul: 'if (!Number.isInteger(formaYaprak) || formaYaprak > 8) throw', koy: 'if (formaYaprak > 8) throw', kosu: ['birim'] },
  // ---- AH: sert kapak ölçü formülleri ----
  { ad: 'mukavva genişliğinde mafsal düşülmüyor (Db = W + k)', dosya: 'app/js/hesap.js', bul: 'var Db = yuvarla(W - f + k);', koy: 'var Db = yuvarla(W + k);', kosu: ['birim', 'e2e'] },
  { ad: 'sırt şeridinde 2t atılıyor (R = S)', dosya: 'app/js/hesap.js', bul: 'R = yuvarla(sirt + 2 * tm);', koy: 'R = yuvarla(sirt);', kosu: ['birim', 'e2e'] },
  // Bütün uygulama betikleri ES module olur: sunucuda çalışır, file:// altında (CORS) yüklenmez → yalnız ölçüt 6 kalmalı
  { ad: 'uygulama ES module olarak yükleniyor', dosya: 'app/index.html', bul: '<script src="js/', koy: '<script type="module" src="js/', hepsi: true, kosu: ['e2e'] },
  // ---- EPUB → PDF ----
  { ad: 'EPUB: DRM denetimi kapalı', dosya: 'app/js/eklentiler/epub/epub-paket.js', bul: 'await drmDenetle(zip);', koy: '/* DRM denetimi yok */', kosu: ['e2e'] },
  { ad: 'EPUB: heceleme iki ünsüz kuralı ters (ikisi de sonraki heceye)', dosya: 'app/js/eklentiler/epub/hece.js', bul: 's.push(unsuz === 0 ? sonraki : sonraki - 1);', koy: 's.push(unsuz === 0 ? sonraki : unsuz === 2 ? sonraki - 2 : sonraki - 1);', kosu: ['birim'] },
  { ad: 'EPUB: bölüm başı yeni sayfa açmıyor', dosya: 'app/js/eklentiler/epub/dizgi.js', bul: 'if (!bos()) yeniSayfa();', koy: 'if (false) yeniSayfa();', kosu: ['birim'] },
  { ad: 'EPUB: sayfa genişliğinden cilt payı düşülmüyor', dosya: 'app/js/eklentiler/epub.js', bul: 'var sayfaGenMm = kitapGen - ciltPayi - disKenar;', koy: 'var sayfaGenMm = kitapGen - disKenar;', kosu: ['e2e'] },
  { ad: 'EPUB: yazı tipi Literata yerine StandardFonts.TimesRoman', dosya: 'app/js/eklentiler/epub/pdf-yaz.js', bul: 'fontlar[st] = await doc.embedFont(kaynaklar.fontlar[st], { subset: altKume, features: { liga: false } });', koy: 'fontlar[st] = await doc.embedFont(PDFLib.StandardFonts.TimesRoman);', kosu: ['birim', 'e2e'] },
  { ad: 'EPUB: XHTML hatasında text/html yedeği kapalı', dosya: 'app/js/eklentiler/epub/xhtml-blok.js', bul: "return new DOMParser().parseFromString(metin, 'text/html');", koy: 'return d;', kosu: ['e2e'] },
  { ad: 'EPUB: tembel yükleme yolu bozuk (fontkit)', dosya: 'app/js/eklentiler/epub.js', bul: "var FONTKIT_JS = 'vendor/fontkit/fontkit.umd.min.js';", koy: "var FONTKIT_JS = 'vendor/fontkit/yok.umd.min.js';", kosu: ['e2e'] },
  // ---- EPUB düzeltme turu (kodlama dahil) ----
  { ad: 'BD/O1: girinti tavanı yok (W ≤ 0 → boş satırlar)', dosya: 'app/js/eklentiler/epub/dizgi.js', bul: 'if (solG + sagG > alanGen - enAzGen) {', koy: 'if (false) {', kosu: ['birim'] },
  { ad: 'BD/O2: uzun kelimede tam kelime her satırda ölçülüyor', dosya: 'app/js/eklentiler/epub/dizgi.js', bul: 'var g = kelimeGenSinirli(w, W - curW - ek, olc);', koy: 'var g = kelimeGen(w, olc);', kosu: ['birim'] },
  { ad: 'BD/D3: ayraç boş sayfada da yeni sayfa açıyor', dosya: 'app/js/eklentiler/epub/dizgi.js', bul: 'if (oncesi + L > kalan() + 1e-6 && !bos()) yeniSayfa();', koy: 'if (oncesi + L > kalan() + 1e-6) yeniSayfa();', kosu: ['birim'] },
  { ad: 'BD/O3: bozuk resim yakalanmıyor', dosya: 'app/js/eklentiler/epub/pdf-yaz.js', bul: '} catch (e) { img = null; atlanan += 1; }', koy: '} catch (e) { throw e; }', kosu: ['birim', 'e2e'] },
  { ad: 'BD/O4: uyarı varken EPUB ayarları açılmıyor', dosya: 'app/js/eklentiler/epub.js', bul: 'if (d) d.open = true;', koy: '', kosu: ['e2e'] },
  { ad: 'BD/D1: açılan veri boyut denetimi yok', dosya: 'app/js/eklentiler/epub/zip.js', bul: 'if (n + p.length > beklenen) {', koy: 'if (false) {', kosu: ['birim'] },
  { ad: 'BD/D2: girdi tablosu yine düz nesne', dosya: 'app/js/eklentiler/epub/zip.js', bul: 'var girdiler = Object.create(null);', koy: 'var girdiler = {};', kosu: ['birim'] },
  { ad: 'BD/D4: bayat yükleme sonucu atılmıyor', dosya: 'app/js/duzenle.js', bul: 'function bayat() { return no !== D.istekNo; }', koy: 'function bayat() { return false; }', kosu: ['e2e'] },
  { ad: 'BD/D5: tablo hücresi yine textContent ile', dosya: 'app/js/eklentiler/epub/xhtml-blok.js', bul: '}).map(hucreMetni).filter(Boolean);', koy: '}).map(function (c) { return String(c.textContent || \'\').trim(); }).filter(Boolean);', kosu: ['e2e'] },
  { ad: 'BD/kodlama: XML bildirimindeki kodlama yok sayılıyor', dosya: 'app/js/eklentiler/epub/zip.js', bul: 'var kod = xmlKodlamasi(d);', koy: 'var kod = null;', kosu: ['birim', 'e2e'] },
  { ad: 'BD/madde 13: hatalı dosyada önceki belge kalıyor', dosya: 'app/js/duzenle.js', bul: "hataliBelge(dosya.name || t('duzenle.belge'));", koy: '', kosu: ['e2e'] },
  // D6: URL kapısı .cjs/.mjs dosyalarını da tarar; app altında yeni bir .cjs dosyasına konan adres yakalanmalı
  { ad: 'BD/D6: app/js altında .cjs dosyasında dış adres', dosya: 'app/js/eklentiler/epub/sizinti.cjs', yeni: true, koy: "module.exports = 'https://example.com/izle.gif';\n", kosu: ['grep'] }
];

// URL kapısında açıkça dışlanan dosyalar ve gerekçeleri. epub-uret.cjs yalnız Node'da çalışan test fixture
// üreticisidir; tarayıcı hiç yüklemez; içindeki adresler XML ad alanı kimlikleridir (xmlns), ağ isteği değildir.
// Çalışma zamanındaki ağ isteklerini ayrıca e2e "dış ağ isteği yok" denetimi sınar.
const URL_DISLA = ['app/test/epub-uret.cjs'];

function calistir(kopya, tur) {
  if (tur === 'birim') {
    const r = spawnSync(process.execPath, ['--test', join(kopya, 'app', 'test') + '/'], { encoding: 'utf8' });
    const m = (r.stdout || '').match(/# fail (\d+)/);
    return { kod: r.status, ozet: `birim: fail ${m ? m[1] : '?'}` };
  }
  if (tur === 'e2e') {
    const r = spawnSync(process.execPath, [join(kopya, 'app', 'test', 'e2e.mjs')], { encoding: 'utf8', timeout: 240000 });
    const satirlar = (r.stdout || '').split('\n');
    const kalanlar = satirlar.filter((s) => s.startsWith('KALDI')).map((s) => s.slice(0, 110));
    const gecenSunucu = satirlar.filter((s) => s.startsWith('GEÇTİ') && s.includes('sunucu')).length;
    return { kod: r.status, ozet: `e2e: ${kalanlar.length} KALDI, sunucu koşusunda ${gecenSunucu} GEÇTİ${kalanlar.length ? ' (ilk: ' + kalanlar[0] + ')' : ''}` };
  }
  // grep: ölçüt 3 — app altında (app/vendor hariç) hiçbir http(s) adresi olmamalı.
  // *.cjs ve *.mjs de taranır; yalnız URL_DISLA'daki dosyalar (gerekçesi yukarıda) açıkça dışlanır.
  const r = spawnSync('grep', ['-rnoE', '--include=*.html', '--include=*.js', '--include=*.cjs', '--include=*.mjs', '--exclude-dir=vendor', 'https?://[^"\' )]+', join(kopya, 'app')], { encoding: 'utf8' });
  const disla = URL_DISLA.map((d) => join(kopya, d).replace(/\\/g, '/') + ':');
  const kotu = (r.stdout || '').split('\n').filter(Boolean)
    .filter((s) => !disla.some((d) => s.replace(/\\/g, '/').startsWith(d)))
    .map((s) => s.replace(/^.*?:\d+:/, ''));
  return { kod: kotu.length ? 1 : 0, ozet: `grep: ${kotu.length} izinsiz URL${kotu.length ? ' (' + kotu[0] + ')' : ''}` };
}

const kok = mkdtempSync(join(tmpdir(), 'kitap-cilt-mutasyon-'));
let hata = 0;
try {
  const temiz = join(kok, 'temiz', 'projeler', 'kitap-cilt');
  cpSync(PROJE, temiz, { recursive: true });
  for (const tur of ['birim', 'e2e', 'grep']) {
    const r = calistir(temiz, tur);
    const iyi = r.kod === 0;
    if (!iyi) hata += 1;
    console.log(`${iyi ? 'GEÇTİ' : 'KALDI'} kontrol koşusu (bozulmamış kopya) ${tur}: çıkış ${r.kod} — ${r.ozet}`);
  }
  MUTASYONLAR.forEach((m, i) => {
    const kopya = join(kok, 'm' + i, 'projeler', 'kitap-cilt');
    cpSync(PROJE, kopya, { recursive: true });
    const yol = join(kopya, m.dosya);
    if (m.yeni) {
      if (existsSync(yol)) { hata += 1; console.log(`HATA  mutasyon uygulanamadı: ${m.ad} (dosya zaten var)`); return; }
      writeFileSync(yol, m.koy);
    } else {
      // Windows (core.autocrlf=true) ağacında dosya CRLF'dir: çok satırlı arama metni tutsun diye LF'ye çevrilir
      const icerik = readFileSync(yol, 'utf8').replace(/\r\n/g, '\n');
      if (!icerik.includes(m.bul)) { hata += 1; console.log(`HATA  mutasyon uygulanamadı: ${m.ad} (metin bulunamadı)`); return; }
      writeFileSync(yol, m.hepsi ? icerik.split(m.bul).join(m.koy) : icerik.replace(m.bul, m.koy));
    }
    for (const tur of m.kosu) {
      const r = calistir(kopya, tur);
      const yakalandi = r.kod !== 0;
      if (!yakalandi) hata += 1;
      console.log(`${yakalandi ? 'YAKALANDI' : 'KAÇTI    '} [${tur}] ${m.ad} — çıkış ${r.kod}; ${r.ozet}`);
    }
  });
} finally {
  rmSync(kok, { recursive: true, force: true });
}
console.log(hata ? `\nSONUÇ: ${hata} sorun (kaçan mutasyon ya da bozuk kontrol koşusu)` : '\nSONUÇ: bütün mutasyonlar yakalandı, kontrol koşusu temiz');
process.exit(hata ? 1 : 0);
