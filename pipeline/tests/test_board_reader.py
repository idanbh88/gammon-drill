"""The local board reader on synthetic diagrams drawn in the book's style (render_book_board)."""

import pytest

cv2 = pytest.importorskip("cv2")

from bgpipeline import board_reader as br  # noqa: E402
from render_book_board import render  # noqa: E402

OPENING_BLACK = {24: 2, 13: 5, 8: 3, 6: 5}
OPENING_WHITE = {1: 2, 12: 5, 17: 3, 19: 5}


def read(**kw):
    return br.read_board(render(**kw))


def test_opening_position():
    r = read(black=OPENING_BLACK, white=OPENING_WHITE)
    assert r.black == OPENING_BLACK
    assert r.white == OPENING_WHITE
    assert r.totals() == (15, 15)
    assert r.cube_position == "middle"
    assert not r.issues


@pytest.mark.parametrize("angle", [-2.5, -0.8, 1.2, 3.0])
def test_tilted_scan_is_straightened(angle):
    r = read(black=OPENING_BLACK, white=OPENING_WHITE, angle=angle, seed=3)
    assert abs(r.angle + angle) < 0.35 or abs(r.angle - angle) < 0.35
    assert r.black == OPENING_BLACK and r.white == OPENING_WHITE


def test_bar_checkers_of_both_colours():
    r = read(black={6: 4, 8: 3, 13: 5, 24: 2}, white={1: 2, 12: 4, 17: 3, 19: 5}, black_bar=1, white_bar=1)
    assert (r.black_bar, r.white_bar) == (1, 1)
    assert r.totals() == (15, 15)


def test_tall_stacks_that_meet_in_a_column():
    # 7 black from the bottom of the 5-point and 4 white from the top of the 20-point fill the column
    r = read(black={5: 7, 6: 5, 4: 3}, white={20: 4, 19: 4, 21: 3, 22: 2, 23: 1, 17: 1})
    assert r.black == {5: 7, 6: 5, 4: 3}
    assert r.white == {20: 4, 19: 4, 21: 3, 22: 2, 23: 1, 17: 1}


def test_borne_off_tray_in_several_columns():
    r = read(black={2: 1, 4: 1}, white={24: 2}, black_off=13, white_off=13, cube="bottom")
    assert (r.black_off, r.white_off) == (13, 13)
    assert r.totals() == (15, 15)
    assert r.cube_position == "bottom"


@pytest.mark.parametrize("cube", ["top", "middle", "bottom"])
def test_cube_position(cube):
    assert read(black=OPENING_BLACK, white=OPENING_WHITE, cube=cube).cube_position == cube


def test_find_boards_on_a_page():
    import numpy as np

    page = np.full((1650, 1170), 255, np.uint8)
    board = render(black=OPENING_BLACK, white=OPENING_WHITE)
    for y in (100, 600, 1100):
        page[y : y + board.shape[0], 100 : 100 + board.shape[1]] = board
    boxes = br.find_boards(page)
    assert len(boxes) == 3
    assert [b.y for b in boxes] == sorted(b.y for b in boxes)
    crop, _ = br.diagram_crop(page, boxes[1])
    assert br.read_board(crop).white == OPENING_WHITE


def test_a_frame_broken_by_faint_lines_is_still_found():
    import render_book_board as rb

    img = render(black=OPENING_BLACK, white=OPENING_WHITE)
    # Two-pixel gaps half-way down every vertical line: the board falls apart into its two halves,
    # each too low to be taken for a board, as on the faint diagrams of pages s037-R and s122-L.
    mid = rb.Y0 + rb.H // 2
    for x in (rb.X0, rb.X0 + 6 * rb.W / 13, rb.X0 + 7 * rb.W / 13, rb.X0 + rb.W):
        x = int(round(x))
        img[mid : mid + 2, x - 2 : x + 3] = 255
    n, _, stats, _ = cv2.connectedComponentsWithStats(br.ink_mask(img), connectivity=8)
    assert not any(st[3] >= br.MIN_H - 80 and st[2] >= br.MIN_W - 60 for st in stats[1:])
    r = br.read_board(img)
    assert r.black == OPENING_BLACK and r.white == OPENING_WHITE and not r.issues
