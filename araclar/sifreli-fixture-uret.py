#!/usr/bin/env python3
"""
sifreli-fixture-uret.py — e2e testi için şifreli PDF örnekleri üretir (yalnız test aracı).
Kullanım (repo kökünden):  python3 araclar/sifreli-fixture-uret.py
Gerekli: pypdf (RC4 için ek paket yok; AES için cryptography). Çıktı: app/test/fixtures/
  sifreli-sahip-rc4.pdf   RC4-128, kullanıcı parolası boş, sahip parolası 'sahip' (izin kısıtlı)
  sifreli-sahip-aes.pdf   AES-128, aynı
  sifreli-kullanici.pdf   AES-128, kullanıcı parolası 'gizli'
Kaynak: 2 sayfalık A5 PDF, sayfalarda '1' ve '2' yazar (elle yazılmış en küçük PDF).
"""
import io, os, sys
from pypdf import PdfReader, PdfWriter

def kaynak_pdf():
    icerik = [b"BT /F1 120 Tf 150 300 Td (%d) Tj ET" % n for n in (1, 2)]
    nesneler = [b"<< /Type /Catalog /Pages 2 0 R >>",
                b"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>"]
    nesneler.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>")
    nesneler.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(icerik[0]), icerik[0]))
    nesneler.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>")
    nesneler.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(icerik[1]), icerik[1]))
    nesneler.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = io.BytesIO(); out.write(b"%PDF-1.4\n"); ofs = []
    for i, n in enumerate(nesneler, 1):
        ofs.append(out.tell()); out.write(b"%d 0 obj\n%s\nendobj\n" % (i, n))
    x = out.tell(); out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(nesneler) + 1))
    for o in ofs: out.write(b"%010d 00000 n \n" % o)
    out.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(nesneler) + 1, x))
    return out.getvalue()

def sifrele(ad, user, algo):
    r = PdfReader(io.BytesIO(kaynak_pdf())); w = PdfWriter()
    for s in r.pages: w.add_page(s)
    w.encrypt(user_password=user, owner_password="sahip", algorithm=algo)
    yol = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "test", "fixtures", ad)
    with open(yol, "wb") as f: w.write(f)
    print("yazıldı", os.path.normpath(yol))

sifrele("sifreli-sahip-rc4.pdf", "", "RC4-128")
sifrele("sifreli-sahip-aes.pdf", "", "AES-128")
sifrele("sifreli-kullanici.pdf", "gizli", "AES-128")
