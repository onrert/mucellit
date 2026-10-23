/*
 * mutation-test.mjs — testlerin kusurlu uygulamayı yakaladığını gösterir.
 * Çalıştırma (repo kökünden): node tools/mutation-test.mjs
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

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MUTATIONS = [
  { name: 'formalı ön yüz sol/sağ yer değiştirmiş', file: 'app/js/imposition.js', find: 'front: [offset + n - 2 * i, offset + 1 + 2 * i]', put: 'front: [offset + 1 + 2 * i, offset + n - 2 * i]', run: ['unit', 'e2e'] },
  { name: 'forma boş sayfayla tamamlanmıyor (son forma hep küçük)', file: 'app/js/imposition.js', find: "signatureSheetCounts.push(settings.shrinkLastSignature ? Math.ceil(rest / 4) : k)", put: 'signatureSheetCounts.push(Math.ceil(rest / 4))', run: ['unit', 'e2e'] },
  { name: '2-up arka yüz yanlış', file: 'app/js/imposition.js', find: 'back: [2 * N + 2 * i + 2, 2 * i + 2]', put: 'back: [2 * i + 2, 2 * N + 2 * i + 2]', run: ['unit'] },
  { name: 'kayma yarım', file: 'app/js/imposition.js', find: 'return roundOff(i * k);', put: 'return roundOff(i * k / 2);', run: ['unit'] },
  { name: 'sırt kalınlığı forza payını iki kez sayıyor / yanlış', file: 'app/js/calc.js', find: "number(sheet, 'sheet', 0) * number(thickness, 'paper_thickness', 0)", put: "number(sheet, 'sheet', 0) * 2 * number(thickness, 'paper_thickness', 0)", run: ['unit'] },
  { name: 'çıktı kağıdı dikey (gen/yük ters)', file: 'app/js/output.js', find: 'doc.addPage([pt(place.paper.width), pt(place.paper.height)])', put: 'doc.addPage([pt(place.paper.height), pt(place.paper.width)])', run: ['e2e'] },
  { name: 'süreç verisi saklanmıyor', file: 'app/js/storage.js', find: 'root.localStorage.setItem(KEY, JSON.stringify(data));', put: '/* yazma yok */', run: ['e2e'] },
  { name: 'içe aktarma notları düşürüyor', file: 'app/js/projects.js', find: '        data = fresh;\n', put: '        fresh.projects.forEach(function (k) { k.steps.forEach(function (a) { a.note = ""; }); });\n        data = fresh;\n', run: ['e2e'] },
  { name: 'başlangıçta console.error', file: 'app/js/app.js', find: "document.documentElement.setAttribute('data-ready', 'yes');", put: "console.error('deneme hatası'); document.documentElement.setAttribute('data-ready', 'evet');", run: ['e2e'] },
  { name: 'izinsiz dış ağ isteği', file: 'app/js/app.js', find: "document.documentElement.setAttribute('data-ready', 'yes');", put: "try { new Image().src = 'https://example.com/watch.gif'; } catch (e) {} document.documentElement.setAttribute('data-ready', 'yes');", run: ['e2e', 'grep'] },
  { name: 'kütüphane yeniden CDN\'den yükleniyor', file: 'app/index.html', find: 'vendor/pdf-lib/pdf-lib.min.js', put: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', run: ['grep'] },
  { name: 'yerel kütüphane yolu bozuk (pdf.js)', file: 'app/index.html', find: 'vendor/pdfjs/pdf.min.js', put: 'vendor/pdfjs/none.min.js', run: ['e2e'] },
  // ---- düzeltme turu ----
  { name: 'arkalar ters sıra (backsReversed) uygulanmıyor', file: 'app/js/output.js', find: 'if (settings.backsReversed) backs = backs.slice().reverse();', put: '', run: ['e2e'] },
  { name: '"başa boş" sona ekleniyor', file: 'app/js/impose.js', find: "D.pages.unshift({ id: newId(), kind: 'blank' })", put: "D.pages.push({ id: newId(), kind: 'blank' })", run: ['e2e'] },
  { name: 'cikti: arka yüz 180° dönüşü uygulanmıyor', file: 'app/js/output.js', find: '(side.rotate180 ? 180 : 0)', put: '0', run: ['e2e'] },
  { name: 'cikti: CropBox/MediaBox kutusu embedPages\'e verilmiyor', file: 'app/js/output.js', find: 'await doc.embedPages(toEmbed, boxes)', put: 'await doc.embedPages(toEmbed)', run: ['e2e'] },
  { name: 'cikti: /Contents\'siz sayfa korumasız', file: 'app/js/output.js', find: "if (!content || (content instanceof PDFLib.PDFArray && content.size() === 0)) {", put: 'if (false) {', run: ['e2e'] },
  { name: 'şifreli/kısıtlı PDF algılanmıyor', file: 'app/js/impose.js', find: 'D.encrypted = encrypted === true;', put: 'D.encrypted = false;', run: ['e2e'] },
  { name: 'kağıda sığmayan yerleşimde indirme açık', file: 'app/js/impose.js', find: 'D.blocked = D.encrypted || D.uncheckable || !!r.layout.doesNotFit;', put: 'D.blocked = D.encrypted || D.uncheckable;', run: ['e2e'] },
  { name: 'storage.read kota doluyken eski kaydı döndürüyor', file: 'app/js/storage.js', find: 'if (!persistent && memory) return memoryCopy();', put: '', run: ['unit'] },
  { name: 'negatif kenar/cilt payı kabul ediliyor', file: 'app/js/layout.js', find: 'if (dis < 0 || cilt < 0) throw', put: 'if (false) throw', run: ['unit'] },
  { name: 'sırt işareti yeni turda yana kayıyor (katlama çizgisinden ayrılıyor)', file: 'app/js/layout.js', find: 'x: roundOff(middleX - SPINE_MARK_WIDTH / 2),', put: 'x: roundOff(middleX - SPINE_MARK_WIDTH / 2 + cycle * 4),', run: ['unit'] },
  { name: 'sırt işareti biçimi turla değişmiyor (hep dolu)', file: 'app/js/layout.js', find: 'stil: tur2 % SPINE_MARK_STYLES', put: 'stil: 0', run: ['unit'] },
  { name: 'isEncrypted hata dalında false döndürüyor (kapalı başarısız yerine açık)', file: 'app/js/impose.js', find: '} catch { return null; }', put: '} catch { return false; }', run: ['e2e'] },
  { name: 'Db <= 0 sonucu reddedilmiyor', file: 'app/js/calc.js', find: "if (!(c[1] > 0)) throw new RangeError(t('calc.zero_or_negative'", put: "if (false) throw new RangeError(t('calc.zero_or_negative'", run: ['unit'] },
  { name: 'taşma 0 reddediliyor', file: 'app/js/calc.js', find: 'if (!(k >= 0)) throw', put: 'if (!(k > 0)) throw', run: ['unit'] },
  { name: 'storage.clear belleği boş veri yapmıyor (eski kayıt dönebilir)', file: 'app/js/storage.js', find: 'memory = MC.projectModel.emptyData();\n    corruptRecord = false;', put: 'memory = null;', run: ['unit'] },
  { name: 'currentData canlı nesneyi döndürüyor', file: 'app/js/impose.js', find: 'return JSON.parse(JSON.stringify(v)); // copy', put: 'return v; // kopya', run: ['e2e'] },
  { name: 'parolalı PDF için window.prompt geri geldi', file: 'app/js/impose.js', find: "if (e && e.name === 'PasswordException') return passwordDocument(name);", put: "if (e && e.name === 'PasswordException') { window.prompt('password'); return passwordDocument(name); }", run: ['e2e'] },
  { name: 'içe aktarmada adım id tekrarı kabul ediliyor', file: 'app/js/project-model.js', find: 'if (a.id in stepIds) throw', put: 'if (false) throw', run: ['unit'] },
  { name: 'Hesapla forma yaprağını yuvarlıyor', file: 'app/js/calc.js', find: 'if (!Number.isInteger(sheetsPerSignature) || sheetsPerSignature > 8) throw', put: 'if (sheetsPerSignature > 8) throw', run: ['unit'] },
  // ---- AH: sert kapak ölçü formülleri ----
  { name: 'board genişliğinde jointGap düşülmüyor (Db = W + k)', file: 'app/js/calc.js', find: 'var Db = roundOff(W - f + k);', put: 'var Db = roundOff(W + k);', run: ['unit', 'e2e'] },
  { name: 'sırt şeridinde 2t atılıyor (R = S)', file: 'app/js/calc.js', find: 'R = roundOff(spine + 2 * tm);', put: 'R = roundOff(spine);', run: ['unit', 'e2e'] },
  // Bütün uygulama betikleri ES module olur: sunucuda çalışır, file:// altında (CORS) yüklenmez → yalnız ölçüt 6 kalmalı
  { name: 'uygulama ES module olarak yükleniyor', file: 'app/index.html', find: '<script src="js/', put: '<script type="module" src="js/', all: true, run: ['e2e'] },
  // ---- EPUB → PDF ----
  { name: 'EPUB: DRM denetimi kapalı', file: 'app/js/plugins/epub/epub-package.js', find: 'await checkDrm(zip);', put: '/* DRM denetimi yok */', run: ['e2e'] },
  { name: 'EPUB: heceleme iki ünsüz kuralı ters (ikisi de sonraki heceye)', file: 'app/js/plugins/epub/hyphenation.js', find: 's.push(consonant === 0 ? next : next - 1);', put: 's.push(consonant === 0 ? next : consonant === 2 ? next - 2 : next - 1);', run: ['unit'] },
  { name: 'EPUB: bölüm başı yeni sayfa açmıyor', file: 'app/js/plugins/epub/typeset.js', find: 'if (!blank()) newPage();', put: 'if (false) newPage();', run: ['unit'] },
  { name: 'EPUB: sayfa genişliğinden cilt payı düşülmüyor', file: 'app/js/plugins/epub.js', find: 'var pageWidthMm = bookWidth - gutter - outerMargin;', put: 'var pageWidthMm = bookWidth - outerMargin;', run: ['e2e'] },
  { name: 'EPUB: yazı tipi Literata yerine StandardFonts.TimesRoman', file: 'app/js/plugins/epub/pdf-writer.js', find: 'fonts[st] = await doc.embedFont(sources.fonts[st], { subset: subset, features: { liga: false } });', put: 'fonts[st] = await doc.embedFont(PDFLib.StandardFonts.TimesRoman);', run: ['unit', 'e2e'] },
  { name: 'EPUB: XHTML hatasında text/html yedeği kapalı', file: 'app/js/plugins/epub/xhtml-blocks.js', find: "return new DOMParser().parseFromString(text, 'text/html');", put: 'return d;', run: ['e2e'] },
  { name: 'EPUB: tembel yükleme yolu bozuk (fontkit)', file: 'app/js/plugins/epub.js', find: "var FONTKIT_JS = 'vendor/fontkit/fontkit.umd.min.js';", put: "var FONTKIT_JS = 'vendor/fontkit/none.umd.min.js';", run: ['e2e'] },
  // ---- EPUB düzeltme turu (kodlama dahil) ----
  { name: 'BD/O1: girinti tavanı yok (W ≤ 0 → boş satırlar)', file: 'app/js/plugins/epub/typeset.js', find: 'if (solG + sagG > alanGen - minWidth) {', put: 'if (false) {', run: ['unit'] },
  { name: 'BD/O2: uzun kelimede tam kelime her satırda ölçülüyor', file: 'app/js/plugins/epub/typeset.js', find: 'var g = wordWidthLimited(w, W - curW - ek, measure);', put: 'var g = wordWidth(w, measure);', run: ['unit'] },
  { name: 'BD/D3: ayraç boş sayfada da yeni sayfa açıyor', file: 'app/js/plugins/epub/typeset.js', find: 'if (before + L > rest() + 1e-6 && !blank()) newPage();', put: 'if (before + L > rest() + 1e-6) newPage();', run: ['unit'] },
  { name: 'BD/O3: bozuk resim yakalanmıyor', file: 'app/js/plugins/epub/pdf-writer.js', find: '} catch (e) { img = null; skipped += 1; }', put: '} catch (e) { throw e; }', run: ['unit', 'e2e'] },
  { name: 'BD/O4: uyarı varken EPUB ayarları açılmıyor', file: 'app/js/plugins/epub.js', find: 'if (d) d.open = true;', put: '', run: ['e2e'] },
  { name: 'BD/D1: açılan veri boyut denetimi yok', file: 'app/js/plugins/epub/zip.js', find: 'if (n + p.length > beklenen) {', put: 'if (false) {', run: ['unit'] },
  { name: 'BD/D2: girdi tablosu yine düz nesne', file: 'app/js/plugins/epub/zip.js', find: 'var inputs = Object.create(null);', put: 'var inputs = {};', run: ['unit'] },
  { name: 'BD/D4: bayat yükleme sonucu atılmıyor', file: 'app/js/impose.js', find: 'function stale() { return no !== D.requestNo; }', put: 'function stale() { return false; }', run: ['e2e'] },
  { name: 'BD/D5: tablo hücresi yine textContent ile', file: 'app/js/plugins/epub/xhtml-blocks.js', find: '}).map(cellText).filter(Boolean);', put: '}).map(function (c) { return String(c.textContent || \'\').trim(); }).filter(Boolean);', run: ['e2e'] },
  { name: 'BD/kodlama: XML bildirimindeki kodlama yok sayılıyor', file: 'app/js/plugins/epub/zip.js', find: 'var code = xmlEncoding(d);', put: 'var code = null;', run: ['unit', 'e2e'] },
  { name: 'BD/madde 13: hatalı dosyada önceki belge kalıyor', file: 'app/js/impose.js', find: "failedDocument(file.name || t('impose.document'));", put: '', run: ['e2e'] },
  // D6: URL kapısı .cjs/.mjs dosyalarını da tarar; app altında yeni bir .cjs dosyasına konan adres yakalanmalı
  { name: 'BD/D6: app/js altında .cjs dosyasında dış adres', file: 'app/js/plugins/epub/leak.cjs', fresh: true, put: "module.exports = 'https://example.com/watch.gif';\n", run: ['grep'] }
];

// URL kapısında açıkça dışlanan dosyalar ve gerekçeleri. epub-build.cjs yalnız Node'da çalışan test fixture
// üreticisidir; tarayıcı hiç yüklemez; içindeki adresler XML ad alanı kimlikleridir (xmlns), ağ isteği değildir.
// Çalışma zamanındaki ağ isteklerini ayrıca e2e "dış ağ isteği yok" denetimi sınar.
const EXCLUDE_URL = ['app/test/epub-build.cjs'];

function run(copy, kind) {
  if (kind === 'unit') {
    const r = spawnSync(process.execPath, ['--test', join(copy, 'app', 'test') + '/'], { encoding: 'utf8' });
    const m = (r.stdout || '').match(/# fail (\d+)/);
    return { code: r.status, summary: `birim: fail ${m ? m[1] : '?'}` };
  }
  if (kind === 'e2e') {
    const r = spawnSync(process.execPath, [join(copy, 'app', 'test', 'e2e.mjs')], { encoding: 'utf8', timeout: 240000 });
    const rows = (r.stdout || '').split('\n');
    const remaining = rows.filter((s) => s.startsWith('FAIL')).map((s) => s.slice(0, 110));
    const previousServer = rows.filter((s) => s.startsWith('GEÇTİ') && s.includes('server')).length;
    return { code: r.status, summary: `e2e: ${remaining.length} FAIL, sunucu koşusunda ${previousServer} GEÇTİ${remaining.length ? ' (first: ' + remaining[0] + ')' : ''}` };
  }
  // grep: ölçüt 3 — app altında (app/vendor hariç) hiçbir http(s) adresi olmamalı.
  // *.cjs ve *.mjs de taranır; yalnız URL_DISLA'daki dosyalar (gerekçesi yukarıda) açıkça dışlanır.
  const r = spawnSync('grep', ['-rnoE', '--include=*.html', '--include=*.js', '--include=*.cjs', '--include=*.mjs', '--exclude-dir=vendor', 'https?://[^"\' )]+', join(copy, 'app')], { encoding: 'utf8' });
  const exclude = EXCLUDE_URL.map((d) => join(copy, d).replace(/\\/g, '/') + ':');
  const bad = (r.stdout || '').split('\n').filter(Boolean)
    .filter((s) => !exclude.some((d) => s.replace(/\\/g, '/').startsWith(d)))
    .map((s) => s.replace(/^.*?:\d+:/, ''));
  return { code: bad.length ? 1 : 0, summary: `grep: ${bad.length} izinsiz URL${bad.length ? ' (' + bad[0] + ')' : ''}` };
}

const root = mkdtempSync(join(tmpdir(), 'book-binding-mutation-'));
let error = 0;
try {
  const clean = join(root, 'clean', 'projects', 'book-binding');
  cpSync(PROJECT, clean, { recursive: true });
  for (const kind of ['unit', 'e2e', 'grep']) {
    const r = run(clean, kind);
    const good = r.code === 0;
    if (!good) error += 1;
    console.log(`${good ? 'GEÇTİ' : 'FAIL'} kontrol koşusu (bozulmamış kopya) ${kind}: çıkış ${r.code} — ${r.summary}`);
  }
  MUTATIONS.forEach((m, i) => {
    const copy = join(root, 'm' + i, 'projects', 'book-binding');
    cpSync(PROJECT, copy, { recursive: true });
    const path = join(copy, m.file);
    if (m.fresh) {
      if (existsSync(path)) { error += 1; console.log(`HATA  mutasyon uygulanamadı: ${m.name} (file already var)`); return; }
      writeFileSync(path, m.put);
    } else {
      // Windows (core.autocrlf=true) ağacında dosya CRLF'dir: çok satırlı arama metni tutsun diye LF'ye çevrilir
      const content = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
      if (!content.includes(m.find)) { error += 1; console.log(`HATA  mutasyon uygulanamadı: ${m.name} (metin bulunamadı)`); return; }
      writeFileSync(path, m.all ? content.split(m.find).join(m.put) : content.replace(m.find, m.put));
    }
    for (const kind of m.run) {
      const r = run(copy, kind);
      const caught = r.code !== 0;
      if (!caught) error += 1;
      console.log(`${caught ? 'CAUGHT' : 'KAÇTI    '} [${kind}] ${m.name} — çıkış ${r.code}; ${r.summary}`);
    }
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(error ? `\nSONUÇ: ${error} sorun (kaçan mutasyon ya da bozuk kontrol koşusu)` : '\nSONUÇ: bütün mutasyonlar yakalandı, kontrol koşusu temiz');
process.exit(error ? 1 : 0);
