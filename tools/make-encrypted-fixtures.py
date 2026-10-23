#!/usr/bin/env python3
"""
make-encrypted-fixtures.py — builds encrypted PDF samples for the e2e test (a test tool only).
Usage (from the repository root):  python3 tools/make-encrypted-fixtures.py
Needs: pypdf (no extra package for RC4; cryptography for AES). Output: app/test/fixtures/
  encrypted-owner-rc4.pdf   RC4-128, empty user password, owner password 'sahip' (restricted permissions)  # turkish-ok: the passwords of the committed fixtures (test data)
  encrypted-owner-aes.pdf   AES-128, the same
  encrypted-user.pdf        AES-128, user password 'gizli'  # turkish-ok: the passwords of the committed fixtures (test data)
Source: a 2-page A5 PDF with '1' and '2' on the pages (the smallest PDF, written by hand).
The passwords are kept as they are: the committed fixtures were made with them.
"""
import io, os, sys
from pypdf import PdfReader, PdfWriter

def source_pdf():
    content = [b"BT /F1 120 Tf 150 300 Td (%d) Tj ET" % n for n in (1, 2)]
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
                b"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>"]
    objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>")
    objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content[0]), content[0]))
    objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>")
    objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content[1]), content[1]))
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = io.BytesIO(); out.write(b"%PDF-1.4\n"); ofs = []
    for i, n in enumerate(objects, 1):
        ofs.append(out.tell()); out.write(b"%d 0 obj\n%s\nendobj\n" % (i, n))
    x = out.tell(); out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    for o in ofs: out.write(b"%010d 00000 n \n" % o)
    out.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, x))
    return out.getvalue()

def encrypt(name, user, algo):
    r = PdfReader(io.BytesIO(source_pdf())); w = PdfWriter()
    for s in r.pages: w.add_page(s)
    w.encrypt(user_password=user, owner_password="sahip", algorithm=algo)  # turkish-ok: the passwords of the committed fixtures (test data)
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "test", "fixtures", name)
    with open(path, "wb") as f: w.write(f)
    print("written", os.path.normpath(path))

encrypt("encrypted-owner-rc4.pdf", "", "RC4-128")
encrypt("encrypted-owner-aes.pdf", "", "AES-128")
encrypt("encrypted-user.pdf", "gizli", "AES-128")  # turkish-ok: the passwords of the committed fixtures (test data)
