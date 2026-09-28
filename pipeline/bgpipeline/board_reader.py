"""The local board reader (stage 3 of ``import_robertie.py``): the book's diagrams to checker
counts, with numpy and OpenCV only.

The diagrams are drawn by one program in one style, which the reader relies on:

- a thin rectangular frame 13 columns wide: six points, the bar, six points, all about the same
  width; point numbers printed outside it (top 24..13, bottom 1..12, left to right: Black's
  numbering, Black's home board bottom left);
- checkers are ellipses about a column wide and a little over half as tall, stacked touching from
  the frame's edge toward the middle (a tall stack runs on past the middle); Black's are filled,
  White's are outlines;
- checkers on the bar sit in the bar column; borne-off checkers stand left of the frame (White's
  from the top, Black's from the bottom, a second column when there are many);
- the doubling cube is an empty square right of the frame, level with the top, the middle or
  the bottom.

``find_boards`` finds each board on a page (the frame, triangles and checkers are one connected
ink component), ``read_board`` straightens it and counts every point by probing ellipse slots
along each column. The result is in Black's point numbers, like the book.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from functools import lru_cache

import cv2
import numpy as np

# Board component size on a book page (pixels at the scan's ~200 dpi).
MIN_W, MAX_W = 450, 720
MIN_H, MAX_H = 230, 400


@dataclass(frozen=True)
class Box:
    x: int
    y: int
    w: int
    h: int

    def pad(self, left: int, top: int, right: int, bottom: int, shape) -> "Box":
        H, W = shape[:2]
        x0, y0 = max(0, self.x - left), max(0, self.y - top)
        x1, y1 = min(W, self.x + self.w + right), min(H, self.y + self.h + bottom)
        return Box(x0, y0, x1 - x0, y1 - y0)

    def cut(self, img: np.ndarray) -> np.ndarray:
        return img[self.y : self.y + self.h, self.x : self.x + self.w]


@dataclass
class LocalReading:
    """Checker counts in the book's (Black's) numbering. ``issues`` explains anything unsure."""

    black: dict[int, int] = field(default_factory=dict)
    white: dict[int, int] = field(default_factory=dict)
    black_bar: int = 0
    white_bar: int = 0
    black_off: int = 0
    white_off: int = 0
    cube_position: str = "none"  # top / middle / bottom / none
    notes: list[str] = field(default_factory=list)  # informational (two stacks meeting in a column)
    angle: float = 0.0
    frame: tuple[int, int, int, int] = (0, 0, 0, 0)  # x0, y0, x1, y1 in the straightened crop
    issues: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        d = asdict(self)
        d["black"] = {str(k): v for k, v in sorted(self.black.items())}
        d["white"] = {str(k): v for k, v in sorted(self.white.items())}
        return d

    def totals(self) -> tuple[int, int]:
        b = sum(self.black.values()) + self.black_bar + self.black_off
        w = sum(self.white.values()) + self.white_bar + self.white_off
        return b, w


def ink_mask(gray: np.ndarray) -> np.ndarray:
    """Dark strokes as 255 on 0, independent of the page's brightness."""
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 12)


def find_boards(page: np.ndarray) -> list[Box]:
    """The boards on a page, top to bottom: ink components the size of a board. Small gaps are
    closed first: a faint frame line can break a board into pieces (pages s037-R, s122-L)."""
    mask = cv2.morphologyEx(ink_mask(page), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    boxes = [
        Box(int(x), int(y), int(w), int(h))
        for x, y, w, h, _area in stats[1:]
        if MIN_W <= w <= MAX_W and MIN_H <= h <= MAX_H and 1.4 <= w / h <= 2.4
    ]
    return sorted(boxes, key=lambda b: (b.y, b.x))


def diagram_crop(page: np.ndarray, board: Box) -> tuple[np.ndarray, Box]:
    """The board with room for the point numbers, the borne-off tray (left) and the cube (right)."""
    box = board.pad(160, 45, 110, 45, page.shape)
    return box.cut(page), box


def _board_component(mask: np.ndarray) -> np.ndarray | None:
    """The pixels (x, y) of the largest board-sized ink component."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    best, area = None, 0
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        if MIN_W - 40 <= w <= MAX_W + 40 and MIN_H - 40 <= h <= MAX_H + 40 and w * h > area:
            best, area = i, w * h
    if best is None:
        return None
    ys, xs = np.nonzero(labels == best)
    return np.stack([xs, ys], axis=1).astype(np.float32)


def skew_angle(mask: np.ndarray, max_deg: float = 4.0, step: float = 0.1) -> float:
    """The board's tilt in degrees: the rotation that makes the frame's long lines sharpest,
    judged on the board component's own pixels (the rows' ink counts peak when a line is level)."""
    pts = _board_component(mask)
    if pts is None or len(pts) < 500:
        return 0.0
    cx, cy = pts.mean(axis=0)
    x, y = pts[:, 0] - cx, pts[:, 1] - cy
    best, best_score = 0.0, -1.0
    for deg in np.arange(-max_deg, max_deg + step / 2, step):
        a = np.radians(deg)
        yr = np.round(-x * np.sin(a) + y * np.cos(a)).astype(int)
        counts = np.bincount(yr - yr.min())
        score = float((counts.astype(np.float64) ** 2).sum())
        if score > best_score:
            best, best_score = float(deg), score
    return best


def straighten(crop: np.ndarray) -> tuple[np.ndarray, float]:
    angle = skew_angle(ink_mask(crop))
    if abs(angle) < 0.05:
        return crop, 0.0
    h, w = crop.shape
    # Rotating the picture by the measured angle levels the frame (checked: the skew measured
    # after straightening is 0).
    rot = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(crop, rot, (w, h), flags=cv2.INTER_LINEAR, borderValue=255), angle


def _clusters(idx: list[int]) -> list[tuple[int, int]]:
    """Runs of consecutive indexes as (first, last)."""
    out: list[tuple[int, int]] = []
    for i in idx:
        if out and i <= out[-1][1] + 2:
            out[-1] = (out[-1][0], i)
        else:
            out.append((i, i))
    return out


def _bar_fits(vl: list[tuple[int, int]], left: int, right: int) -> bool:
    """Whether lines stand where the bar belongs in a frame from left to right (6/13 and 7/13)."""
    width = right - left
    tol = width / 26
    at = lambda f: any(abs(c[1] - (left + f * width)) < tol or abs(c[0] - (left + f * width)) < tol for c in vl)  # noqa: E731
    return width >= MIN_W - 60 and at(6 / 13) and at(7 / 13)


def _bar_lines(vl: list[tuple[int, int]], centre: float) -> tuple[int, int] | None:
    """The bar's two lines: the pair of long vertical lines about a column apart (28-55 px)
    nearest the board's middle, as (right end of the left one, left end of the right one)."""
    best = None
    for i, a in enumerate(vl):
        for b in vl[i + 1 :]:
            gap = b[0] - a[1]
            if 28 <= gap <= 55:
                d = abs((a[1] + b[0]) / 2 - centre)
                if d < 90 and (best is None or d < best[0]):
                    best = (d, a[1], b[0])
    return (best[1], best[2]) if best else None


def find_frame(crop: np.ndarray) -> tuple[int, int, int, int, int, int] | None:
    """The frame in a straightened crop as (left, top, right, bottom, bar left, bar right).

    The frame's four sides and the bar's two lines are the only long straight lines in a
    diagram crop. They are thin and grey, so the ink is taken with a light threshold, small gaps
    are closed, and only runs over 60% of the board's size are kept (checkers, triangles, numbers
    and the tray do not survive). A stack of black checkers against the frame merges with its line
    into one wide run: the frame is that run's outer end, a bar line the end of its run that faces
    the bar. The board's ink component only sets the scale and the fallback."""
    mask = ink_mask(crop)
    for attempt in range(2):
        n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        comps = [tuple(map(int, st[:4])) for st in stats[1:] if MIN_W - 60 <= st[2] <= MAX_W and MIN_H - 80 <= st[3] <= MAX_H]
        if comps:
            break
        # A faint frame line broke the board into pieces: close small gaps, as find_boards does
        # (only then: closing also joins the point numbers to the frame).
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    if not comps:
        return None
    x, y, w, h = max(comps, key=lambda c: c[2] * c[3])
    left, top, right, bottom = x, y, x + w - 1, y + h - 1
    ink = ((crop < 215) * 255).astype(np.uint8)
    horiz = cv2.morphologyEx(cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((1, 7), np.uint8)), cv2.MORPH_OPEN, np.ones((1, int(w * 0.6)), np.uint8))
    rows = horiz[:, max(0, x - 20) : x + w + 20].sum(axis=1) // 255
    # Near the board's ink only: a crop can reach the page's edge or the spine's shadow.
    hl = [c for c in _clusters([i for i in range(len(rows)) if rows[i] > 0.7 * w]) if y - 70 <= c[0] and c[1] <= y + h + 70]
    if len(hl) >= 2 and hl[-1][1] - hl[0][0] >= MIN_H - 40:
        top, bottom = hl[0][0], hl[-1][1]
    hh = bottom - top
    vert = cv2.morphologyEx(cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((7, 1), np.uint8)), cv2.MORPH_OPEN, np.ones((int(hh * 0.6), 1), np.uint8))
    cols = vert[top : bottom + 1, :].sum(axis=0) // 255
    W = crop.shape[1]
    # Long vertical lines anywhere in the crop but its very edges (the spine's shadow).
    vl = [c for c in _clusters([i for i in range(len(cols)) if cols[i] > 0.6 * hh]) if c[0] > 12 and c[1] < W - 12]
    near = [c for c in vl if x - 25 <= c[0] and c[1] <= x + w + 25]
    if len(near) >= 2 and near[-1][1] - near[0][0] >= MIN_W - 60:
        left, right = near[0][0], near[-1][1]
    if not _bar_fits(vl, left, right):
        # The component or a frame line was broken, so the sides above do not match the bar.
        # The bar is one column wide with six columns on each side: take the sides from it.
        bar = _bar_lines(vl, x + w / 2)
        if bar is not None:
            bl, br = bar
            col = br - bl
            want_l, want_r = bl - 6 * col, br + 6 * col
            cand_l = [c for c in vl if abs(c[0] - want_l) <= 0.4 * col]
            cand_r = [c for c in vl if abs(c[1] - want_r) <= 0.4 * col]
            left = min(cand_l, key=lambda c: abs(c[0] - want_l))[0] if cand_l else int(round(want_l))
            right = min(cand_r, key=lambda c: abs(c[1] - want_r))[1] if cand_r else int(round(want_r))
            return left, top, right, bottom, int(bl), int(br)
    vl = near
    width = right - left
    bar_l, bar_r = left + 6 * width / 13, left + 7 * width / 13
    tol = width / 26
    for c0, c1 in vl:
        if c0 > left + 2 * tol and c1 < right - 2 * tol:
            mid = (c0 + c1) / 2
            if abs(c1 - (left + 6 * width / 13)) < tol or abs(mid - (left + 6 * width / 13)) < tol:
                bar_l = c1
            if abs(c0 - (left + 7 * width / 13)) < tol or abs(mid - (left + 7 * width / 13)) < tol:
                bar_r = c0
    return left, top, right, bottom, int(round(bar_l)), int(round(bar_r))


# Checker size, measured on the scan: a column is about 42.3 px, a checker about 44.6 x 26.4 px
# (a little wider than its column, so neighbouring stacks cover each other's sides), and the
# frame is 11 checkers high (291 px): stacks touch, so the pitch is the checker's height.
CHECKER_W = 1.05  # of the column width
ROWS = 11  # checker heights in the frame's height


@dataclass(frozen=True)
class Geometry:
    """A board's layout: the frame, and the bar's two lines, which split it into two halves of
    six columns each (their widths can differ by a pixel or two)."""

    x0: float
    y0: float
    x1: float
    y1: float
    bar_l: float | None = None
    bar_r: float | None = None

    @property
    def left_w(self) -> float:
        return ((self.bar_l if self.bar_l is not None else self.x0 + 6 * (self.x1 - self.x0) / 13) - self.x0) / 6

    @property
    def right_w(self) -> float:
        return (self.x1 - (self.bar_r if self.bar_r is not None else self.x0 + 7 * (self.x1 - self.x0) / 13)) / 6

    @property
    def col_w(self) -> float:
        return (self.left_w + self.right_w) / 2

    @property
    def pitch(self) -> float:
        return (self.y1 - self.y0) / ROWS

    @property
    def rx(self) -> float:
        return self.col_w * CHECKER_W / 2

    @property
    def ry(self) -> float:
        return self.pitch / 2

    @property
    def template(self) -> np.ndarray:
        return _template_cache(round(self.rx, 1), round(self.ry, 1))

    def column_x(self, c: int) -> float:
        if c < 6:
            return self.x0 + (c + 0.5) * self.left_w
        if c > 6:
            return self.x1 - (12 - c + 0.5) * self.right_w
        bl = self.bar_l if self.bar_l is not None else self.x0 + 6 * self.left_w
        br = self.bar_r if self.bar_r is not None else self.x1 - 6 * self.right_w
        return (bl + br) / 2

    def point_column(self, point: int) -> tuple[int, bool]:
        """(column, top row) of a point in Black's numbering: columns 0-5 left half, 6 bar,
        7-12 right half. Bottom row 1..12 left to right, top row 24..13 left to right."""
        if 1 <= point <= 12:
            i = point - 1
            return (i if i < 6 else i + 1), False
        i = 24 - point
        return (i if i < 6 else i + 1), True

    def slot_y(self, top: bool, k: int) -> float:
        if top:
            return self.y0 + self.ry + k * self.pitch
        return self.y1 - self.ry - k * self.pitch


@lru_cache(maxsize=64)
def _template_cache(rx: float, ry: float) -> np.ndarray:
    return outline_template(rx, ry)


def _ellipse_samples(cx: float, cy: float, rx: float, ry: float, scale: float, t: np.ndarray) -> np.ndarray:
    return np.stack([cx + scale * rx * np.cos(t), cy + scale * ry * np.sin(t)], axis=1)


def _values(gray: np.ndarray, pts: np.ndarray) -> np.ndarray:
    h, w = gray.shape
    xs = np.clip(np.round(pts[:, 0]).astype(int), 0, w - 1)
    ys = np.clip(np.round(pts[:, 1]).astype(int), 0, h - 1)
    return gray[ys, xs]


_ALL = np.linspace(0, 2 * np.pi, 16, endpoint=False)
# A white checker is an ellipse outline filled white. The outline is thin, anti-aliased and
# partly hidden where the neighbouring points' checkers overlap it, so it is found by normalised
# correlation with a drawn outline, searched a few pixels around the expected slot, rather than
# by thresholding single pixels. Measured on the scan: white checkers score 0.33-0.67, empty
# slots at most 0.30 (the frame line and a triangle's sides meeting the probe). The interior,
# taken where the outline matched, separates what is left: a white checker is smooth (spread
# under 3.5 grey levels, 230-254 bright depending on the page), a dotted triangle is speckled
# (5-25).
WHITE_NCC = 0.30  # the whole outline
# The half of the outline that faces the middle of the board: next to the frame the frame line
# and a triangle's sides imitate the other half, so an empty slot at the edge matches the whole
# outline almost as well as a checker (0.33 against 0.33) but its inner half poorly (at most
# 0.26 against at least 0.32 for a white checker).
INNER_NCC = 0.29
WHITE_STRONG = 0.40  # an inner-half match this good is a white checker on its own
WHITE_MIN = 200
WHITE_STD = 5.5
SEARCH = 4


def _interior_samples(cx: float, cy: float, rx: float, ry: float) -> np.ndarray:
    return np.concatenate([_ellipse_samples(cx, cy, rx, ry, s, _ALL) for s in (0.2, 0.45, 0.65)] + [np.array([[cx, cy]])])


def interior_mean(gray: np.ndarray, cx: float, cy: float, rx: float, ry: float) -> float:
    return float(_values(gray, _interior_samples(cx, cy, rx, ry)).astype(np.float32).mean())


def interior_stats(gray: np.ndarray, cx: float, cy: float, rx: float, ry: float) -> tuple[float, float]:
    v = _values(gray, _interior_samples(cx, cy, rx, ry)).astype(np.float32)
    return float(v.mean()), float(v.std())


def outline_template(rx: float, ry: float, pad: int = 4) -> np.ndarray:
    w, h = int(round(2 * rx + 2 * pad)), int(round(2 * ry + 2 * pad))
    t = np.full((h, w), 255, np.uint8)
    cv2.ellipse(t, (w // 2, h // 2), (int(round(rx)), int(round(ry))), 0, 0, 360, 60, 2, cv2.LINE_AA)
    return t


def outline_match(gray: np.ndarray, cx: float, cy: float, template: np.ndarray, search: int = SEARCH) -> tuple[float, float, float]:
    """(best correlation, dx, dy): how well an ellipse outline fits near (cx, cy), and where."""
    th, tw = template.shape
    x0, y0 = int(round(cx - tw / 2)) - search, int(round(cy - th / 2)) - search
    if x0 < 0 or y0 < 0:
        return -1.0, 0.0, 0.0
    patch = gray[y0 : y0 + th + 2 * search, x0 : x0 + tw + 2 * search]
    if patch.shape[0] < th or patch.shape[1] < tw:
        return -1.0, 0.0, 0.0
    res = cv2.matchTemplate(patch, template, cv2.TM_CCOEFF_NORMED)
    _mn, mx, _lmn, (bx, by) = cv2.minMaxLoc(res)
    return float(mx), float(bx - search), float(by - search)


def outline_score(gray: np.ndarray, cx: float, cy: float, template: np.ndarray, search: int = SEARCH) -> float:
    return outline_match(gray, cx, cy, template, search)[0]


def half_template(rx: float, ry: float, lower: bool, pad: int = 4) -> np.ndarray:
    """The lower (or upper) half of the outline template, from the centre line outward."""
    t = outline_template(rx, ry, pad)
    h = t.shape[0]
    half = np.full_like(t, 255)
    w = t.shape[1]
    cv2.ellipse(half, (w // 2, h // 2), (int(round(rx)), int(round(ry))), 0, 0 if lower else 180, 180 if lower else 360, 60, 2, cv2.LINE_AA)
    return half[h // 2 :, :] if lower else half[: h // 2 + 1, :]


@lru_cache(maxsize=128)
def _half_cache(rx: float, ry: float, lower: bool) -> np.ndarray:
    return half_template(rx, ry, lower)


def inner_score(gray: np.ndarray, g: "Geometry", cx: float, cy: float, top: bool, search: int = SEARCH) -> float:
    """How well the half of an outline that faces the board's middle fits: the lower half for a
    stack from the top edge, the upper half for one from the bottom."""
    t = _half_cache(round(g.rx, 1), round(g.ry, 1), top)
    th, tw = t.shape
    x0 = int(round(cx - tw / 2)) - search
    y0 = (int(round(cy)) if top else int(round(cy)) - th + 1) - search
    if x0 < 0 or y0 < 0:
        return -1.0
    patch = gray[y0 : y0 + th + 2 * search, x0 : x0 + tw + 2 * search]
    if patch.shape[0] < th or patch.shape[1] < tw:
        return -1.0
    return float(cv2.matchTemplate(patch, t, cv2.TM_CCOEFF_NORMED).max())


def classify_slot(gray: np.ndarray, g: "Geometry", cx: float, cy: float, top: bool | None = None) -> tuple[str, float]:
    """("black" | "white" | "empty", outline score) for the ellipse slot centred at (cx, cy).
    ``top`` is the edge the stack grows from (None for the bar, where checkers sit mid-column)."""
    if interior_mean(gray, cx, cy, g.rx, g.ry) < 110:
        return "black", 0.0
    score, dx, dy = outline_match(gray, cx, cy, g.template)
    if score < WHITE_NCC:
        return "empty", score
    # On the bar a checker sits mid-column, and the bar's two edge lines match an outline's sides:
    # there both the upper and the lower half must show.
    inner = inner_score(gray, g, cx, cy, top) if top is not None else min(inner_score(gray, g, cx, cy, True), inner_score(gray, g, cx, cy, False))
    if inner < INNER_NCC:
        return "empty", score
    mean, spread = interior_stats(gray, cx + dx, cy + dy, g.rx, g.ry)
    if mean > WHITE_MIN and (inner >= WHITE_STRONG or spread < WHITE_STD):
        return "white", score
    return "empty", score


def count_stack(gray: np.ndarray, g: Geometry, cx: float, top: bool, *, limit: int = 15, want: str | None = None) -> tuple[str | None, int, list[str]]:
    """The colour and number of checkers stacked from one edge at column centre ``cx``."""
    colour, n, notes = None, 0, []
    for k in range(limit):
        cy = g.slot_y(top, k)
        if not (g.y0 - 1 < cy < g.y1 + 1):
            break
        kind, _score = classify_slot(gray, g, cx, cy, top)
        if kind == "empty" or (want is not None and kind != want):
            break
        if colour is None:
            colour = kind
        elif kind != colour:
            notes.append(f"mixed colours {'from the top' if top else 'from the bottom'} at slot {k}")
            break
        n += 1
    return colour, n, notes


def count_bar(gray: np.ndarray, g: Geometry) -> tuple[int, int]:
    """Checkers in the bar column: every slot from top to bottom, black and white counted apart."""
    cx = g.column_x(6)
    black = white = 0
    y = g.y0 + g.ry
    while y <= g.y1 - g.ry:
        kind, _score = classify_slot(gray, g, cx, y)
        if kind == "black":
            black += 1
            y += g.pitch
        elif kind == "white":
            white += 1
            y += g.pitch
        else:
            y += 2
    return black, white


def count_tray(gray: np.ndarray, g: Geometry, max_columns: int = 4) -> tuple[int, int]:
    """Borne-off checkers left of the frame, White's stacked from the top and Black's from the
    bottom, in columns about a column's width apart, the first about a column's width left of
    the frame (measured on the scan: 1.0-1.06 column widths). Each column's position is searched
    within a few pixels."""
    black = white = 0
    cx = None
    for i in range(max_columns):
        best = (0, 0, None)
        centre = (g.x0 - g.col_w) if cx is None else cx - 1.03 * g.col_w
        for d in np.arange(-0.2, 0.21, 0.05):
            x = centre + d * g.col_w
            if x - g.rx < -2:
                continue
            _c, w, _n = count_stack(gray, g, x, True, want="white")
            _c, b, _n = count_stack(gray, g, x, False, want="black")
            if w + b > best[0] + best[1]:
                best = (b, w, x)
        b, w, x = best
        if x is None or b + w == 0:
            break
        black, white, cx = black + b, white + w, x
    return black, white


def cube_position(crop: np.ndarray, g: Geometry) -> str:
    """Where the empty cube square stands right of the frame."""
    mask = ink_mask(crop)
    x_lo, x_hi = int(g.x1 + 4), min(crop.shape[1], int(g.x1 + 3 * g.col_w))
    if x_hi - x_lo < 10:
        return "none"
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask[:, x_lo:x_hi], connectivity=8)
    height = g.y1 - g.y0
    for x, y, w, h, _area in stats[1:]:
        if 0.6 * g.col_w <= w <= 1.8 * g.col_w and 0.6 * g.col_w <= h <= 1.8 * g.col_w:
            cy = y + h / 2
            rel = (cy - g.y0) / height
            return "top" if rel < 0.33 else "bottom" if rel > 0.67 else "middle"
    return "none"


def read_board(crop: np.ndarray) -> LocalReading:
    """Reads one diagram crop (from ``diagram_crop``)."""
    reading = LocalReading()
    gray, angle = straighten(crop)
    reading.angle = round(angle, 2)
    frame = find_frame(gray)
    if frame is None:
        reading.issues.append("no board frame found")
        return reading
    reading.frame = tuple(frame[:4])
    g = Geometry(*map(float, frame))
    for point in range(1, 25):
        column, top = g.point_column(point)
        colour, n, notes = count_stack(gray, g, g.column_x(column), top)
        reading.notes.extend(f"point {point}: {m}" for m in notes)
        if colour == "black" and n:
            reading.black[point] = n
        elif colour == "white" and n:
            reading.white[point] = n
    reading.black_bar, reading.white_bar = count_bar(gray, g)
    reading.black_off, reading.white_off = count_tray(gray, g)
    reading.cube_position = cube_position(gray, g)
    b, w = reading.totals()
    if b != 15 or w != 15:
        reading.issues.append(f"totals black {b}, white {w}")
    return reading


def overlay(crop: np.ndarray) -> np.ndarray:
    """A colour picture of what the reader saw: the frame, and every probed slot (red = black,
    blue = white, grey = empty) for checking a reading by eye."""
    gray, _angle = straighten(crop)
    out = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    frame = find_frame(gray)
    if frame is None:
        return out
    g = Geometry(*map(float, frame))
    cv2.rectangle(out, (int(g.x0), int(g.y0)), (int(g.x1), int(g.y1)), (0, 160, 0), 1)
    for c in range(14):
        x = int(g.x0 + c * g.col_w)
        cv2.line(out, (x, int(g.y0)), (x, int(g.y1)), (0, 200, 0), 1)
    for column in list(range(6)) + list(range(7, 13)):
        for top in (True, False):
            for k in range(8):
                cx, cy = g.column_x(column), g.slot_y(top, k)
                kind, _score = classify_slot(gray, g, cx, cy, top)
                color = {"black": (0, 0, 255), "white": (255, 0, 0), "empty": (150, 150, 150)}[kind]
                cv2.ellipse(out, (int(cx), int(cy)), (int(g.rx), int(g.ry)), 0, 0, 360, color, 1)
                if kind == "empty":
                    break
    return out


def read_diagram_files(diagram_dir, keys) -> dict[str, dict]:
    """The local reading of every saved diagram crop (``diagrams/<key>.png``), keyed like it."""
    from .pdf_pages import read_gray

    out = {}
    for key in keys:
        out[key] = read_board(read_gray(diagram_dir / f"{key}.png")).to_json()
    return out
