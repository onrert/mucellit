'use strict';
/*
 * turkish-scan.js — checks that the code base is written in English: file and folder names, identifiers, comments,
 * strings, script output and documentation. Not a `.test.js`; turkish-scan.test.js uses it (and tests it with faulty
 * inputs). CLI: `node app/test/turkish-scan.js` prints every finding and exits with 1 when there is one.
 *
 * A finding is Turkish text on a line or in a path:
 *   - a Turkish letter (c-cedilla, g-breve, dotless i, o/u-umlaut, s-cedilla, a/i/u-circumflex, capitals included), or
 *   - a common Turkish word or a Turkish suffix in its ASCII form (see the word list below), as a word or as a
 *     part of an identifier (camelCase, PascalCase, snake_case, kebab-case and dotted names are split into words).
 *
 * Allowlist (the only places where Turkish may stay):
 *   - app/i18n/tr.js: the dictionary VALUES (keys, comments and code of the file are scanned);
 *   - README.tr.md: the Turkish readme;
 *   - app/test/fixtures/**: test data (legacy-format files, Turkish test text); their paths are scanned and so are
 *     README files there;
 *   - the lines of a "turkish-data" block (Turkish hyphenation data, Turkish test text, this word list) and of a
 *     "legacy-names" block (storage names of earlier versions, read once for the data migration); a block starts with
 *     a line containing "<name>: begin" and ends with a line containing "<name>: end";
 *   - a single line marked "turkish-ok: <reason>" (the reason is required);
 *   - the product name Mücellit (productName; written as Mucellit in code);
 *   - app/vendor/** (third-party code) and binary files are not scanned.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const TURKISH_LETTER = /[çğıöşüâîûÇĞİÖŞÜÂÎÛ]/; // turkish-ok: the letters the scan looks for
const BRAND = /Mücellit|MÜCELLİT/g; // turkish-ok: the product name
const BINARY = /\.(png|jpe?g|gif|ico|icns|pdf|epub|ttf|otf|woff2?|gz|zip|lock)$/i;
const SKIP_DIR = /^app\/vendor\//;
const WHOLE_FILE = new Set(['README.tr.md']);
const FIXTURES = /^app\/test\/fixtures\//;
const DICT_VALUES = new Set(['app/i18n/tr.js']);
const BLOCKS = ['turkish-data', 'legacy-names'];
const OK_MARK = 'turkish' + '-ok'; // built so that this line is not a marker itself
const OK_ANY = new RegExp(OK_MARK + '\\b');
const OK_REASON = new RegExp(OK_MARK + ':\\s*\\S');

// turkish-data: begin (common Turkish words, ASCII-folded; words that are also English are left out on purpose)
const WORDS = new Set([
    'acar aci acik aciklama acilamadi acilamaz acilan acilani acilanlar acilanlari acildi acilis acilista acilmis',
    'adaylari adi adim adimlar adla adlar adlari adres adresi adresler agirlik akis akisi akiskan aktar',
    'aktarilamadi aktarildi alani alanlar alanlari algoritma alinan alindi alinir alir almaz altta amac amaz',
    'anahtar anahtarlar anahtarlari ancak anilacak anlik arac araci araclar araclari araligi aralik arayuz',
    'arayuzleri arayuzu arka arkalar arkaya artigi artik asagi asama asamalar asan asenkron asgari asil asimi',
    'asimiyla asiyor asmaz atilan atilir atla atlanan atlandi atlanir atomik ayar ayari ayarla ayarlanamadi',
    'ayarlar ayarlari ayarli aygit ayikla ayir ayni ayrac ayraci ayrilir ayrinti ayrintili ayristir',
    'ayristirilamadi azalt bacak baglam baglama baglanti bagli basa basamak basarili basi basit baska baski',
    'baskisi basladi baslangic baslat baslatilamadi baslik basta bastan bayat bayatsa bayrak bayt bayta bayti',
    'baytlari baytlik bekle beklenen beklenir bekleyen bekleyenleri bekliyor belge belgeler belgeyi belirlenimci',
    'belirsiz bellek benzeri benzersiz benzetim benzetimi besik betigi betik betikler betikleri bezi bicim',
    'bicimle bildir bildirilen bildirim bildirimler bildirir bilgi bilgili bilinen bilinmeyen binlik bir birak',
    'birakma birim birinci birincil biten bitir bitis bitti blogu blok bloklar bloklara bol bolme bolum bolumler',
    'bolunen bolunmus bomba bos bosalt boslugu bosluk bosluklu bostayken bostu boylar boyle boyu boyunu boyut',
    'boyutlar boyutu boz bozuk bozuklar bugun bul bulgu bulucu bulunamadi bulunan bulundu bunun burada burasi',
    'butce butceli butun buyuk buyut cagir cagri cagrisi calisma calistir canli carpan cekirdek cene cevap cevir',
    'cevirme cift ciftler cik cikar cikti ciktilar ciktilari cilt ciz cizgi cizgiler cizgileri cizgisi cizilen',
    'cizim cocuklar cogul cok cozucu cozulemedi cozulemeyen cozulemez cozulen cozumle cubugu cubuk cumle daha',
    'deger degeri degerler degil degisen degismedi degisti degistir delik delikler delindi delinen delme deneme',
    'denendi denetim denetimler denetimli denetle denetlenemedi denetlenir denetler depo derin derinlik ders',
    'dersler desen deseni desteklenen desteklenmeyen desteklenmiyor destekli desteksiz desteyi detay devam diger',
    'digeri digerleri digerlerini dik dikey dikili dikis dikkat dil dilde dili dilini diller dilleri dinamik',
    'dinle dinlen dinleyici dipnot dis disa disari disarida disaridan disi disini diskyok disla dista diz dizgi',
    'dizgileri dizi dizilim dizilmis dizin dogal dogrula dokunma dokunuldu dokunulmaz dolayli doldur doldurma',
    'dolu doluluk donanim dondur dondurme dondurulsun donen doner donmus donsun donuk donus donustur',
    'donusturuculer donusturuluyor dort dosya dosyalar dosyalari dosyasi dosyaya dugme dugmeler dugmeleri dugmesi',
    'dugum duman dur durdu durdur durgun durum durumlar durumu durur duruyor dus dusuk dusulen duz duzeldi duzelt',
    'duzeltme duzen duzenle duzenleden duzenleye duzey eger egri ekle eklendi eklenen eklenti eklentiler ekler',
    'ekran eksik eksikler ekstra elemanlar enaz encok engel enjekte eris erisim esanli esik esitle eski esle',
    'esleme eszamanli etiket etiketi etiketler etkin evet exitten eylem fabrika fark farklar farkli fazla figur',
    'figurler filtre fontlar forma formalar formali formul forza gecen gecerli gecersiz gecici geciciler',
    'gecicileri gecikme gecikmeyle gecir gecis gecisli gecti gelen gelmeyen genel genis genisligi genislik genler',
    'gercek gerek gerekli gereksiz geri gezinme gibi gidis girdi girdiler girdisi girin girinti girintili giris',
    'gizle gizleme gizlenmis gizli gizlilik golge gom gomuldu gomulecek gomulemedi gomulu gonder gonderildi',
    'gonderir goreli goreliyse gorulen gorunen gorunmez goruntu goruntusu gorunum gorunur gorunurlugu gorunurluk',
    'goster govde govdesi gozle gozlemi guncel guncelle gunluk guvenli guvenlik hakkinda halka hangi hareket',
    'harekete harf haric harita hata hatalar hatali hatasi hatayi hazir hazirla hazirlama hazirlaniyor hazirlik',
    'hece hecele hedef hemen hepsi hepsini hesap hesapla hesapladan hic hiz hiza hizali hizmetler hucre hucreler',
    'icerigi icerigine icerik icermez ici icin icinde icini icte idleri ifade igne ihlal iki ikilenir ikili',
    'ikinci ikisi ile ilerleme iletilir iletilmez ilgili ilk imini imsiz imza incele indir indirme indis indisler',
    'ingiliz inmemis iplik iplikler iptal iptalsiz ipucu isaret isaretcisi isareti isaretle isaretler isci ise',
    'isi iskelet isle islem islemi islemler istasyon istasyonlar istege istek istekler istemler istenen italik',
    'iyi izgara izin izinli izinsiz izle izlenen izler kaba kabul kac kacan kacis kacislayarak kadar kagidi kagit',
    'kagitlar kalan kalanlar kaldi kaldir kalici kalin kalinligi kalinlik kalinti kalintisi kalip kalipsiz',
    'kalipta kalir kalk kalmaz kamera kancali kancasi kap kapa kapak kapali kapandi kapanis kapanista kapat kapi',
    'kapital kaplama kapsam kapsayici kapsiz karakter karakterler karar karari kare kareler karisik karsilastir',
    'karsiligi kart kartlar kartlari katla katlama katlar katli kaydedildi kaydedilemedi kaydedilen kaydedilmedi',
    'kaydedilsin kaydet kaydi kaydir kayip kayit kayitlar kayitli kayitta kayma kaynak kaynaklar kaynaklari',
    'kaynakta kelime kelimeler kelimelere kemer kemik kenar kenardan kenari kenarlar kes kesik kesilen kesim',
    'kesimi kesimler kesit kesme keyfi kez kilit kilitli kilitliler kimligi kimligini kimlik kimlikler kimlikleri',
    'kimliksiz kir kirim kirli kirma kirp kisa kisayol kisayolla kisayollar kisisel kitaba kitabi kitap kitapcilt',
    'kitaplar kitapli kivir kivirma klasor klasoru kod kodla kodlama kodlamalar kodlamasi kodlu kodu kok kokeni',
    'kokler kokte komut komutlari konf konsol kontrol kontrolleri konum kopya kopyala kopyalanan koruma korunur',
    'korunuyor kose kosu kosul kotu koy koyu kucuk kucult kullanici kullanilan kullanildi kullanilmayan',
    'kullanimlik kume kur kural kurali kurallar kuru kurudu kurulamadi kurulu kurulum kurulumu kuruma kurut',
    'kurutma kusur kusurlu kutu kutular kutuphane kuyruk lisans lisanslar liste listeden listele listeleri',
    'listesi lutfen mafsal masaustu medya menusu merhaba merkez mesaj mesaji mesgul metin metinler metinleri',
    'metinli metinsiz metne metni modu modul modulu muk mukavva mumlu mutasyon mutasyonlar mutlak neden nefes',
    'negatif nesil nesilli nesne nesneler nitelik nokta noktalar noktalari noktali nolar notsuz notu numarali',
    'obur ofset oge ogeler ogeleri ogesi ogren oku okuma okumadan okunamadi okunamazsa okunan okunmadan okunur',
    'okurken okuyucu okuyucusu olabilir olan olarak olay olayi olaylari olc olcek olcer olcu olcucu olculer',
    'olcusu olcut oldu olmali olmayan olmayanlar olu oluk olumsuz olustur olusturma olusturuldu omru omur omurlu',
    'onalti onay onayla onaylar onbellek onbellekli onceki oncesi ondalik onden onek oneki onekli onemli',
    'onerilmez onizle onizleme onizlemede onler ontanimli oran ornek ornekler orta ortak ortam oteki otomatik',
    'oturum oynarken oynat oynatici oynuyor ozel ozellik ozellikler ozet ozetler oznitelik paket paketi',
    'paketinden paneli panelsiz paragraf parametre parametreler parca parcaciginda parcalar parcalari parcali',
    'parola parolali payi pdfe pdfsiz pencere pencerede penceresinde pencereyi performans piksel pngye pozitif',
    'presleme preste proje projeler rapor rastgele reddeder reddedildi reddedilir reddet reddi redler rehber',
    'resim resimler resimleri resimli rol saat sabit sablon sablonlar sade sadece sag sahip sahne sahte sakin',
    'saklama satir satirlar satirlari sayac sayfa sayfalar sayfasi sayfaya sayfayi sayi sayilan sayilar sayilari',
    'sayili sayisi sec secenek secenekler secici secildi secili secim secimi secin segler sekil sekiller sekiz',
    'sekme sekmeler sekmesi serbest seridi serit sessiz sifir sifirla sifrele sifreleme sifreli sigan sigdir',
    'sigmiyor sikili sikisik sikistirmasiz silik silindi silinecek silinemedi silinir silinmemeli silinmis',
    'simdi simetrik simgeler sinama sinamasi sinif siniflandir sinir sinirda siniri sinirinda sinirlar sinirli',
    'sira sirada siralama sirali sirasi sirasinda sirt sistem siyah sizan sizinti sokum sola soluk sona sonek',
    'sonra sonraki sonrasinda sonu sonuc sonuclar sonuclari sonucu sor sorular sorun sorunlari sorunlu sorunu soz',
    'sozcugu sozcuk sozcukler sozcuksel sozluk sozlukler sozlukleri sozlukte sozu statik stil stilleri sunucu',
    'supheli surec surecteki surukle surukleniyor surum suruyor sutun taban tabandan tabani tablo tablodan',
    'tabloya tahmini takildi takili takma tamam tamamla tamamlandi tamamlaniyor tamamlanmis tanim tanimlar',
    'tanimlayici tanimli taninmadi tarafi tarama tarayici tarih tarihi tasi tasindi tasir tasma taze tek tekrar',
    'temel temiz temizle temizlenir temizligi temsilci temsilcisi temsili tercihleri terim ters testler tetik tik',
    'tikla tiklandi tipi tipleri tireli tiresiz tirnak tohum topla toplam toplayici tum tumu tumunu turkce turler',
    'turu tutar tutkal tutkalla tutkallama tutulmaz tuvali ucuncu unlu unluler unsuz unut uret uretec uretilemedi',
    'uretilen urun ust uuidsiz uyan uyanma uyanmaz uyar uyari uyarilar uyarisi uygula uygulama uygulanir uymuyor',
    'uyum uyusmuyor uzak uzaklas uzanti uzantilar uzantili uzantisiz uzun uzunluk varlik varsayilan vazgec',
    'vazgecildi vazgecilen ve vekil vektor vektorler vektorleri veri verilen verir vermedi veya vida vurgu',
    'yabanci yakalanan yakalandi yakin yakinlas yaklasik yalniz yani yanit yanitlar yanlis yapi yapilamadi',
    'yapildi yapisik yapistir yapistirma yapragi yaprak yapraklar yapraklari yardimci yardimcilari yari yarida',
    'yarim yasi yasli yatak yatay yatir yavas yaz yazar yazdir yazdirma yazi yazici yazilamadi yazilamazsa',
    'yazilan yazilir yazma yedegi yedek yedekci yedekle yedeklenir yedekten yedi yeni yeniden yenile yenilenecek',
    'yeniler yeniyi yerel yeri yerimi yerimsiz yerinde yerine yerle yerlesim yerlesimi yerlesmedi yerlestir yetim',
    'yetimler yetki yigin yildiz yinele yinelenen yok yoksa yol yola yoldan yolla yollar yolu yolunu yon yonerge',
    'yontem yorum yuk yukari yukle yukleme yuklendi yuklenen yukleyerek yuksek yuksekligi yukseklik yumusak yuru',
    'yuva yuvalar yuvarla yuvarlak yuvarlatma yuz yuzey yuzler yyon zaten zemin zincir zinciri zipi zipli zorunlu'
].join(' ').split(' '));
const SUFFIX = /^[a-z]{2,}(?:amadi|emedi|amiyor|emiyor|iyor|uyor|lari|leri|larin|lerin|siniz|sunuz|ilsin|insin|ildi|uldu|ilir|ulur|ecek|acak|landi|lendi)$/;
// turkish-data: end

/** Lower case without Turkish letters (c-cedilla → c, dotless i → i …), for the word check. */
const FOLD = { 0xe7: 'c', 0x11f: 'g', 0x131: 'i', 0xee: 'i', 0xf6: 'o', 0x15f: 's', 0xfc: 'u', 0xfb: 'u', 0xe2: 'a' };
function fold(s) {
  let out = '';
  for (const ch of s.toLowerCase()) {
    const c = ch.codePointAt(0);
    if (c !== 0x307) out += FOLD[c] || ch; // 0x307: the dot that lower-casing a dotted capital I leaves
  }
  return out;
}
const LOWER = 'a-z\\u00e7\\u011f\\u0131\\u00f6\\u015f\\u00fc\\u00e2\\u00ee\\u00fb';
const UPPER = 'A-Z\\u00c7\\u011e\\u0130\\u00d6\\u015e\\u00dc\\u00c2\\u00ce\\u00db';
const WORD_RE = new RegExp('[' + LOWER + UPPER + ']+', 'g');
const LOWER_UPPER = new RegExp('([' + LOWER + '])([' + UPPER + '])', 'g');
const UPPER_RUN = new RegExp('([' + UPPER + ']+)([' + UPPER + '][' + LOWER + '])', 'g');

// English contractions (we've, don't …) are dropped before the split, so that their endings are not read as words
const CONTRACTION = new RegExp("([A-Za-z])['\u2019](?:v" + "e|s|t|re|ll|d|m)\\b", 'g');

/** The words of a text: identifiers are split at case changes, digits and separators; English contractions dropped. */
function words(text) {
  const out = [];
  const clean = text.replace(CONTRACTION, '$1');
  for (const w of clean.match(WORD_RE) || []) {
    w.replace(LOWER_UPPER, '$1 $2').replace(UPPER_RUN, '$1 $2')
      .split(' ').forEach((p) => { if (p) out.push(fold(p)); });
  }
  return out;
}

/** Why this text counts as Turkish (a short reason), or null. */
function turkishIn(text) {
  text = String(text).replace(BRAND, 'Mucellit');
  const m = TURKISH_LETTER.exec(text);
  if (m) return 'letter "' + m[0] + '"';
  for (const w of words(text)) {
    if (WORDS.has(w)) return 'word "' + w + '"';
    if (SUFFIX.test(w)) return 'suffix "' + w + '"';
  }
  return null;
}

/** String literal contents replaced by spaces (the quotes stay), for the dictionary file. */
function maskStrings(line) {
  return line.replace(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g, (all, q, body) => q + ' '.repeat(body.length) + q);
}

/** Is this path scanned at all? (vendor code and binary files are not) */
function isScanned(file) {
  return !SKIP_DIR.test(file) && !BINARY.test(file) && !/(^|\/)mimetype$/.test(file);
}

/**
 * Findings in one file: [{ file, line, reason, text }]. line 0 is the path itself.
 * file: path relative to the repository root, with forward slashes.
 */
function scanText(file, text) {
  const found = [];
  const add = (line, reason, t) => found.push({ file, line, reason, text: String(t).trim().slice(0, 120) });
  const p = turkishIn(file.replace(/\.[^./]+$/, ''));
  if (p) add(0, 'path: ' + p, file);
  if (WHOLE_FILE.has(file)) return found;
  if (FIXTURES.test(file) && !/(^|\/)README[^/]*$/i.test(file)) return found;
  const dict = DICT_VALUES.has(file);
  let open = null; // [name, line] of the open block
  String(text).split('\n').forEach((raw, i) => {
    const n = i + 1;
    for (const b of BLOCKS) {
      if (raw.includes(b + ': begin')) {
        if (open) add(n, 'block "' + b + '" opened inside "' + open[0] + '"', raw);
        open = [b, n];
      } else if (raw.includes(b + ': end')) {
        if (!open || open[0] !== b) add(n, 'block "' + b + '" closed without begin', raw);
        else { open = null; return; }
      }
    }
    if (open) return;
    if (OK_ANY.test(raw)) {
      if (!OK_REASON.test(raw)) add(n, OK_MARK + ' without a reason', raw);
      return;
    }
    let line = raw;
    if (dict) {
      const key = /^\s*"([^"]*)"\s*:/.exec(raw);
      const r = key && turkishIn(key[1]);
      if (r) add(n, 'dictionary key: ' + r, key[1]);
      line = maskStrings(raw);
    }
    const r = turkishIn(line);
    if (r) add(n, r, raw);
  });
  if (open) add(open[1], 'block "' + open[0] + '" is never closed', open[0] + ': begin');
  return found;
}

/** Allowlist uses in one file: { blocks: n, lines: n } (for the report). */
function allowances(text) {
  const t = String(text);
  return {
    blocks: BLOCKS.reduce((s, b) => s + (t.split(b + ': begin').length - 1), 0),
    lines: (t.match(new RegExp(OK_REASON.source, 'g')) || []).length
  };
}

/** Files of the repository (tracked and new, not ignored), relative paths with forward slashes. */
function repoFiles(root = ROOT) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root });
  return [...new Set(out.toString('utf8').split('\0').filter(Boolean))]
    .filter((f) => fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile())
    .sort();
}

/** Scans the repository: { files (scanned), findings, allow: { file: { blocks, lines } } }. */
function scanRepo(root = ROOT) {
  const files = repoFiles(root);
  const findings = [];
  const allow = {};
  let scanned = 0;
  for (const f of files) {
    if (!isScanned(f)) {
      const p = turkishIn(f.replace(/\.[^./]+$/, ''));
      if (p && !SKIP_DIR.test(f)) findings.push({ file: f, line: 0, reason: 'path: ' + p, text: f });
      continue;
    }
    scanned++;
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    findings.push(...scanText(f, text));
    const a = allowances(text);
    if (a.blocks || a.lines || WHOLE_FILE.has(f) || DICT_VALUES.has(f) || FIXTURES.test(f)) allow[f] = a;
  }
  return { files: scanned, findings, allow };
}

module.exports = { turkishIn, words, scanText, scanRepo, repoFiles, isScanned, allowances, WORDS };

if (require.main === module) {
  const r = scanRepo();
  for (const f of r.findings) console.log(f.file + ':' + f.line + ': ' + f.reason + ': ' + f.text);
  console.log('turkish-scan: ' + r.files + ' files scanned, ' + r.findings.length + ' findings');
  process.exitCode = r.findings.length ? 1 : 0;
}
