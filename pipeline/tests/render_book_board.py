"""Synthetic diagrams in the style of the scanned book, for the board reader's tests.

Nothing from the book itself is committed (the repository is public): these pictures are drawn
from invented positions with the measured geometry (a 13-column frame, ellipse checkers a little
wider than a column and 1/11 of the frame's height, dotted triangles on every other point, a
borne-off tray left of the frame and an empty cube box right of it), then blurred, noised,
turned slightly and put through JPEG like a scan.
"""

from __future__ import annotations

import cv2
import numpy as np

X0, Y0, W, H = 161, 45, 550, 291
PAD_R, PAD_B = 110, 45


def _slot(top: bool, k: int, pitch: float) -> float:
    return Y0 + pitch / 2 + k * pitch if top else Y0 + H - pitch / 2 - k * pitch


def _column(point: int) -> tuple[int, bool]:
    if 1 <= point <= 12:
        i = point - 1
        return (i if i < 6 else i + 1), False
    i = 24 - point
    return (i if i < 6 else i + 1), True


def _checker(img, cx, cy, rx, ry, black: bool) -> None:
    center, axes = (int(round(cx)), int(round(cy))), (int(round(rx)), int(round(ry)))
    if black:
        cv2.ellipse(img, center, axes, 0, 0, 360, 45, -1, cv2.LINE_AA)
    else:
        cv2.ellipse(img, center, axes, 0, 0, 360, 255, -1, cv2.LINE_AA)
        cv2.ellipse(img, center, axes, 0, 0, 360, 70, 1, cv2.LINE_AA)


def render(
    black: dict[int, int],
    white: dict[int, int],
    *,
    black_bar: int = 0,
    white_bar: int = 0,
    black_off: int = 0,
    white_off: int = 0,
    cube: str = "middle",
    angle: float = 0.0,
    seed: int = 0,
) -> np.ndarray:
    """A grayscale diagram crop like ``board_reader.diagram_crop`` returns."""
    cw = W / 13
    pitch = H / 11
    rx, ry = cw * 1.05 / 2, pitch / 2
    img = np.full((Y0 + H + PAD_B, X0 + W + PAD_R), 255, np.uint8)
    # triangles, every other one dotted
    for c in list(range(6)) + list(range(7, 13)):
        xl, xr = X0 + c * cw, X0 + (c + 1) * cw
        for top in (True, False):
            base = Y0 if top else Y0 + H
            apex = Y0 + 0.45 * H if top else Y0 + H - 0.45 * H
            tri = np.array([[xl, base], [xr, base], [(xl + xr) / 2, apex]], np.int32)
            if (c + (1 if top else 0)) % 2:
                mask = np.zeros_like(img)
                cv2.fillPoly(mask, [tri], 255)
                dots = np.zeros_like(img)
                dots[::3, ::3] = 1
                img[(mask > 0) & (dots > 0)] = 150
            cv2.polylines(img, [tri], True, 110, 1, cv2.LINE_AA)
    # frame and bar
    cv2.rectangle(img, (X0, Y0), (X0 + W, Y0 + H), 120, 1)
    for bx in (X0 + 6 * cw, X0 + 7 * cw):
        cv2.line(img, (int(round(bx)), Y0), (int(round(bx)), Y0 + H), 120, 1)
    cv2.rectangle(img, (int(X0 + 6 * cw) + 1, Y0 + 1), (int(X0 + 7 * cw) - 1, Y0 + H - 1), 255, -1)
    # checkers on points
    for colour, counts in (("black", black), ("white", white)):
        for point, n in counts.items():
            c, top = _column(point)
            cx = X0 + (c + 0.5) * cw
            for k in range(n):
                _checker(img, cx, _slot(top, k, pitch), rx, ry, colour == "black")
    # bar: white above the middle, black below
    bx = X0 + 6.5 * cw
    for k in range(white_bar):
        _checker(img, bx, Y0 + H / 2 - ry - 2 - k * pitch, rx, ry, False)
    for k in range(black_bar):
        _checker(img, bx, Y0 + H / 2 + ry + 2 + k * pitch, rx, ry, True)
    # tray: columns of up to 5 left of the frame, White's from the top, Black's from the bottom
    for colour, n in (("white", white_off), ("black", black_off)):
        for i in range(n):
            col, k = divmod(i, 5)
            cx = X0 - cw - col * 1.03 * cw
            _checker(img, cx, _slot(colour == "white", k, pitch), rx, ry, colour == "black")
    # cube box
    cy = {"top": Y0 + 25, "middle": Y0 + H / 2, "bottom": Y0 + H - 25}.get(cube)
    if cy is not None:
        cv2.rectangle(img, (X0 + W + 22, int(cy - 20)), (X0 + W + 62, int(cy + 20)), 80, 1)
    # the scan: a slight turn, blur, noise, JPEG
    if angle:
        h, w = img.shape
        rot = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        img = cv2.warpAffine(img, rot, (w, h), flags=cv2.INTER_LINEAR, borderValue=255)
    img = cv2.GaussianBlur(img, (0, 0), 0.7)
    rng = np.random.default_rng(seed)
    img = np.clip(img.astype(np.float32) + rng.normal(0, 4, img.shape), 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)
