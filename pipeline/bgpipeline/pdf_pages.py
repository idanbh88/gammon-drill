"""Book pages out of the scanned PDF (stage 1 of ``import_robertie.py``).

The scan of *501 Essential Backgammon Problems* is one JPEG per PDF page (DCTDecode, no text
layer), each a two-page spread lying on its side; the page's ``/Rotate`` says how a viewer turns
it upright. Every spread is decoded, turned upright, cut at the spine (the darkest column band
near the middle, where the binding casts its shadow), its lighting evened out (``flatten``) and
written as two grayscale JPEGs, ``pages/s<NNN>-L.jpg`` and ``pages/s<NNN>-R.jpg``, with an index
in ``pages.json``.

Needs the ``book`` extra (pypdf, numpy, opencv-python-headless).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np

INDEX = "pages.json"
JPEG_QUALITY = 90
# A side with less ink than this (share of dark pixels) is blank and gets no Claude request.
BLANK_INK = 0.002


class PagesError(RuntimeError):
    pass


@dataclass(frozen=True)
class PageImage:
    name: str  # "s011-R"
    spread: int  # 1-based PDF page
    side: str  # "L" or "R"
    file: str  # relative to the book folder, forward slashes: "pages/s011-R.jpg"
    width: int
    height: int
    ink: float  # share of dark pixels; about 0 for a blank side

    @property
    def blank(self) -> bool:
        return self.ink < BLANK_INK


def page_name(spread: int, side: str) -> str:
    return f"s{spread:03d}-{side}"


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def spread_jpegs(pdf: Path) -> Iterator[tuple[int, bytes, int]]:
    """(1-based page, the page's JPEG as stored, its /Rotate) for every page of the PDF."""
    from pypdf import PdfReader

    reader = PdfReader(str(pdf))
    for index, page in enumerate(reader.pages, start=1):
        xobjects = page["/Resources"].get("/XObject")
        images = [xobjects[k].get_object() for k in xobjects] if xobjects else []
        images = [o for o in images if o.get("/Subtype") == "/Image"]
        if len(images) != 1:
            raise PagesError(f"page {index}: expected one image, found {len(images)}")
        image = images[0]
        if image.get("/Filter") != "/DCTDecode":
            raise PagesError(f"page {index}: image filter {image.get('/Filter')}, expected /DCTDecode")
        # The DCTDecode stream is the JPEG file itself; take it undecoded.
        yield index, bytes(image._data), int(page.get("/Rotate", 0) or 0) % 360


_ROTATIONS = {
    0: None,
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}


def upright(jpeg: bytes, rotate: int) -> np.ndarray:
    """The spread decoded to grayscale and turned the way the PDF's /Rotate shows it."""
    img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise PagesError("could not decode the page JPEG")
    code = _ROTATIONS.get(rotate)
    if rotate not in _ROTATIONS:
        raise PagesError(f"unexpected /Rotate {rotate}")
    return img if code is None else cv2.rotate(img, code)


def spine_x(spread: np.ndarray) -> int:
    """The spine's column: the darkest smoothed column in the middle sixth of the spread."""
    h, w = spread.shape
    band = spread[h // 5 : h - h // 5].astype(np.float32)
    means = band.mean(axis=0)
    kernel = np.ones(15, np.float32) / 15
    smooth = np.convolve(means, kernel, mode="same")
    lo, hi = int(w * 0.42), int(w * 0.58)
    return lo + int(np.argmin(smooth[lo:hi]))


def ink_share(page: np.ndarray, margin: int = 40) -> float:
    """Share of dark pixels away from the edges (the spine shadow and the scan border)."""
    h, w = page.shape
    inner = page[margin : h - margin, margin : w - margin]
    return float((inner < 128).mean()) if inner.size else 0.0


def split_spread(spread: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    x = spine_x(spread)
    return spread[:, :x], spread[:, x:]


def flatten(page: np.ndarray) -> np.ndarray:
    """Evens out the lighting: the spine's shadow and uneven scanning darken the paper near the
    fold. The paper's brightness is estimated with a wide maximum filter (wider than a stack of
    checkers, so the diagrams' filled discs do not count as paper) and a blur, and each pixel is
    divided by it."""
    paper = cv2.dilate(page, np.ones((61, 61), np.uint8))
    paper = cv2.GaussianBlur(paper, (0, 0), 25)
    return cv2.divide(page, np.maximum(paper, 1), scale=255)


def extract_pages(pdf: Path, book_dir: Path, *, refresh: bool = False, log=None) -> list[PageImage]:
    """Writes every book page under ``book_dir/pages`` (skipping files already there unless
    ``refresh``) and returns the index, which is also saved as ``book_dir/pages.json``."""
    pages_dir = book_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    known = {p.name: p for p in read_index(book_dir)} if not refresh else {}
    out: list[PageImage] = []
    for spread, jpeg, rotate in spread_jpegs(pdf):
        names = [page_name(spread, "L"), page_name(spread, "R")]
        if all(n in known and (book_dir / known[n].file).exists() for n in names):
            out.extend(known[n] for n in names)
            continue
        left, right = split_spread(upright(jpeg, rotate))
        for side, img in (("L", flatten(left)), ("R", flatten(right))):
            name = page_name(spread, side)
            rel = f"pages/{name}.jpg"
            ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            if not ok:
                raise PagesError(f"{name}: could not encode")
            (book_dir / rel).write_bytes(buf.tobytes())
            out.append(PageImage(name, spread, side, rel, img.shape[1], img.shape[0], round(ink_share(img), 5)))
        if log and spread % 25 == 0:
            log(f"pages: {spread} spreads")
    write_index(book_dir, out)
    return out


def read_index(book_dir: Path) -> list[PageImage]:
    path = book_dir / INDEX
    if not path.exists():
        return []
    return [PageImage(**row) for row in json.loads(path.read_text(encoding="utf-8"))]


def write_index(book_dir: Path, pages: list[PageImage]) -> None:
    (book_dir / INDEX).write_text(json.dumps([asdict(p) for p in pages], indent=1), encoding="utf-8")


def read_gray(path: Path) -> np.ndarray:
    """An image file as grayscale. cv2.imread cannot open this machine's non-ASCII paths, so
    the bytes are read by Python and decoded in memory."""
    img = cv2.imdecode(np.frombuffer(path.read_bytes(), np.uint8), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise PagesError(f"{path.name}: cannot decode")
    return img


def write_png(path: Path, img: np.ndarray) -> None:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise PagesError(f"{path.name}: could not encode")
    path.write_bytes(buf.tobytes())


def load_page(book_dir: Path, page: PageImage) -> np.ndarray:
    return read_gray(book_dir / page.file)
