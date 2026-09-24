import pytest

from bgpipeline.moves import apply_steps, parse_play, state_from_view
from bgpipeline.xgid import (
    XgidError,
    acting_player,
    acting_view,
    decision_kind,
    parse_xgid,
    pip_counts,
    to_perspective,
    to_xgid,
    with_state,
)

OPENING = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10"
SEEDS = [
    OPENING,
    "-b----E-C---eE---c-e----B-:0:0:1:63:0:0:0:7:10",
    "---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10",
    "-b---BD-C---dD---c-cba--AA:0:0:1:43:0:0:0:7:10",
    "--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10",
]


@pytest.mark.parametrize("xgid", SEEDS)
def test_round_trip(xgid):
    assert to_xgid(parse_xgid(xgid)) == xgid
    assert to_xgid(parse_xgid("XGID=" + xgid)) == xgid


@pytest.mark.parametrize(
    "xgid,p1,p2",
    [
        (OPENING, 167, 167),
        ("---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10", 83, 92),
        ("-b---BD-C---dD---c-cba--AA:0:0:1:43:0:0:0:7:10", 159, 156),
        ("--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10", 42, 40),
    ],
)
def test_pips(xgid, p1, p2):
    assert pip_counts(parse_xgid(xgid)) == (p1, p2)


def test_fields():
    pos = parse_xgid("--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10")
    assert pos.cube_value == 2 and pos.cube_owner == 2 and pos.turn == 2
    assert pos.dice == (5, 2) and pos.score == (2, 3) and pos.match_length == 7
    assert acting_player(pos) == 2
    view = acting_view(pos)
    assert view.my_pips == 40 and view.their_pips == 42 and view.my_off == 5 and view.their_off == 5
    mirror = to_perspective(parse_xgid("-AB-BCB------------bbcba--:1:1:1:52:3:2:0:7:10"), 1)
    assert mirror.points == view.points


def test_decisions():
    assert decision_kind(parse_xgid(OPENING)) == "checker"
    cube = parse_xgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10")
    assert decision_kind(cube) == "cube-double" and acting_player(cube) == 1
    offered = parse_xgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:D:2:1:0:7:10")
    assert decision_kind(offered) == "cube-take" and acting_player(offered) == 2
    money = parse_xgid("-b----E-C---eE---c-e----B-:0:0:1:00:0:0:3:0:10")
    assert money.jacoby and money.beavers and not money.crawford


@pytest.mark.parametrize("xgid", SEEDS)
def test_with_state_round_trip(xgid):
    pos = parse_xgid(xgid)
    for me in (1, 2):
        assert to_xgid(with_state(pos, me, state_from_view(to_perspective(pos, me)))) == xgid


def test_with_state_after_a_play():
    pos = parse_xgid(OPENING)
    as_one = apply_steps(state_from_view(to_perspective(pos, 1)), parse_play("8/5 6/5"))
    assert to_xgid(with_state(pos, 1, as_one)) == "-b---BD-B---eE---c-e----B-:0:0:1:31:0:0:0:7:10"
    as_two = apply_steps(state_from_view(to_perspective(pos, 2)), parse_play("8/5 6/5"))
    assert to_xgid(with_state(pos, 2, as_two)) == "-b----E-C---eE---b-db---B-:0:0:1:31:0:0:0:7:10"
    assert pos.board[5] == 0  # input not mutated


@pytest.mark.parametrize(
    "bad",
    [
        "-b----E-C---eE---c-e----B:0:0:1:31:0:0:0:7:10",
        "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7",
        "-b----E-C---eE---c-e----Bz:0:0:1:31:0:0:0:7:10",
        "-b----E-C---eE---c-e---PB-:0:0:1:31:0:0:0:7:10",
        "Ab----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10",
        "-b----E-C---eE---c-e----B-:0:0:0:31:0:0:0:7:10",
        "-b----E-C---eE---c-e----B-:0:0:1:37:0:0:0:7:10",
    ],
)
def test_rejects(bad):
    with pytest.raises(XgidError):
        parse_xgid(bad)
