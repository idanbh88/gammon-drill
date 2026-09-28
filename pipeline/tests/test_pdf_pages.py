"""Book pages out of a scanned PDF: a two-page spread lying on its side, built in the test."""

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")
pytest.importorskip("pypdf")

from bgpipeline.pdf_pages import extract_pages, flatten, read_gray, read_index, spine_x, split_spread, upright  # noqa: E402


def spread_image() -> np.ndarray:
    """An upright spread 900 x 600: two pages with the spine's wide, gradual shadow centred at
    x = 470 (like the scan's), and a mark on each page."""
    img = np.full((600, 900), 235, np.uint8)
    for x in range(330, 611):
        img[:, x] = int(235 - 110 * max(0, 1 - abs(x - 470) / 140))
    cv2.putText(img, "L", (150, 300), cv2.FONT_HERSHEY_SIMPLEX, 4, 0, 8)
    cv2.putText(img, "R", (650, 300), cv2.FONT_HERSHEY_SIMPLEX, 4, 0, 8)
    return img


def make_pdf(path, jpeg: bytes, w: int, h: int, rotate: int) -> None:
    """A one-page PDF whose page is the JPEG drawn full-page, with /Rotate like the scan."""
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Rotate %d /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>" % (w, h, rotate),
        b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n" % (w, h, len(jpeg)) + jpeg + b"\nendstream",
    ]
    content = b"q %d 0 0 %d 0 0 cm /Im0 Do Q" % (w, h)
    objs.append(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
    out, offsets = bytearray(b"%PDF-1.3\n"), []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    path.write_bytes(bytes(out))


def test_spine_split_and_flatten():
    img = spread_image()
    assert abs(spine_x(img) - 470) <= 3
    left, right = split_spread(img)
    assert left.shape[1] + right.shape[1] == 900 and abs(left.shape[1] - 470) <= 3
    flat = flatten(img)
    assert int(flat[300, 430]) > int(img[300, 430]) + 40  # the shadow is lifted
    assert flat[250:350, 150:280].min() < 60  # ink stays dark


def test_extract_pages_from_a_rotated_scan(tmp_path):
    upright_img = spread_image()
    stored = cv2.rotate(upright_img, cv2.ROTATE_90_CLOCKWISE)  # the scan lies on its side
    ok, buf = cv2.imencode(".jpg", stored, [cv2.IMWRITE_JPEG_QUALITY, 95])
    pdf = tmp_path / "scan.pdf"
    make_pdf(pdf, buf.tobytes(), stored.shape[1], stored.shape[0], 270)
    assert upright(buf.tobytes(), 270).shape == upright_img.shape
    book = tmp_path / "book"
    pages = extract_pages(pdf, book)
    assert [p.name for p in pages] == ["s001-L", "s001-R"]
    assert read_index(book) == pages
    left = read_gray(book / pages[0].file)
    right = read_gray(book / pages[1].file)
    assert left[250:350, 130:280].min() < 80 and right[250:350, 180:330].min() < 80
    assert not pages[0].blank and not pages[1].blank
