"""Robertie's answers as printed, turned into the app's notation and answer ids."""

import pytest

from bgpipeline.book_notation import cube_answer, normalise_play
from bgpipeline.moves import NotationError


@pytest.mark.parametrize(
    "printed, expected",
    [
        ("13/11 6/5", "13/11 6/5"),
        ("13/11 6/5!", "13/11 6/5"),
        ("6/5* 24/20", "6/5* 24/20"),
        ("24/20*(2) 13/9(2)", "24/20*(2) 13/9(2)"),
        ("Bar/21*", "bar/21*"),
        ("Bar/23 6/1.", "bar/23 6/1"),
        ("5/off 1/off", "5/off 1/off"),
        ("13/7*/1", "13/7*/1"),
        ("24/18, 13/9", "24/18 13/9"),
        ("24/18 and 13/9", "24/18 13/9"),
        ("24 / 21", "24/21"),
        ("25/21 6/0", "bar/21 6/off"),
        ("8/7∗ 13/11", "8/7* 13/11"),
    ],
)
def test_normalise_play(printed, expected):
    assert normalise_play(printed) == expected


@pytest.mark.parametrize("printed", ["", "!", "hit loose", "13/11 six/5", "24"])
def test_not_a_play(printed):
    with pytest.raises(NotationError):
        normalise_play(printed)


@pytest.mark.parametrize(
    "double, take, expected",
    [
        ("double", "take", "double-take"),
        ("double", "pass", "double-pass"),
        ("double", None, "double"),
        ("no-double", "take", "no-double"),
        ("no-double", None, "no-double"),
        ("no-double", "pass", "too-good"),
        ("too-good", None, "too-good"),
        ("too-good", "pass", "too-good"),
    ],
)
def test_cube_answer(double, take, expected):
    assert cube_answer(double, take) == expected


def test_unknown_verdict():
    with pytest.raises(ValueError):
        cube_answer("redouble", None)
