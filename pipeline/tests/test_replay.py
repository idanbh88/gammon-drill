from pathlib import Path

import pytest

from bgpipeline.mat import MatError, parse_mat
from bgpipeline.moves import is_legal_play
from bgpipeline.replay import cube_live, replay
from bgpipeline.xgid import acting_view, parse_xgid, to_perspective

FIXTURES = Path(__file__).with_name("fixtures")
GALAXY = parse_mat((FIXTURES / "galaxy_45552673.mat").read_text(encoding="utf-8"))


def test_galaxy_replay_player_1():
    r = replay(GALAXY, player=1)
    assert all(d.player == 1 for d in r.decisions)
    assert {d.kind for d in r.decisions} == {"checker"}  # 1-point match: the cube is dead
    assert r.decisions[0].xgid == "-b----E-C---eE---c-e----B-:0:0:1:41:0:0:0:1:10"
    assert r.decisions[0].played == "24/23 13/9" and r.decisions[0].move_no == 1  # canonical order
    assert len(r.decisions) == 55
    dances = [d for d in r.decisions if d.n_plays == 0]
    assert len(dances) == 18 and all(d.forced and d.played == "" for d in dances)
    open_choices = [d for d in r.decisions if not d.forced]
    assert 20 <= len(open_choices) < 55 - 18
    for d in open_choices:
        pos = parse_xgid(d.xgid)
        assert pos.turn == 1 and pos.dice == d.dice
        assert is_legal_play(acting_view(pos), d.dice, d.played), d
    (game,) = r.games
    assert game.winner == 2 and game.points == 1 and not game.crawford
    assert to_perspective(parse_xgid(game.final_xgid), 2).my_off == 15
    assert r.final_score == (0, 1)


def test_galaxy_replay_player_2_sees_the_other_side():
    r = replay(GALAXY, player=2)
    assert all(d.player == 2 for d in r.decisions)
    assert len(r.decisions) == 55
    first = r.decisions[0]
    assert first.xgid == "-b----E-CA--eD---c-e---AA-:0:0:-1:54:0:0:0:1:10"  # after 13/9 24/23, player 2 to play 54
    assert first.played == "24/20 13/8"


CUBE_MATCH = """; [Site "Test"]
; [Match ID "1"]
5 point match

 Game 1
 A : 0                B : 0
  1) 31: 8/5 6/5                 52: 13/8 13/11
  2) Doubles => 2                Takes
  3) 66: 24/18 24/18 13/7 13/7   44: 13/9 13/9 6/2 6/2
  4)                             Doubles => 4
  5) Drops
                                  Wins 2 points

 Game 2
 A : 0                B : 2
  1) 31: 8/5 6/5                 52: 13/8 13/11
  2) 42: 8/4 6/4                 Wins 3 points

 Game 3
 A : 0                B : 5
"""


def test_cube_decisions_and_scores():
    m = parse_mat(CUBE_MATCH)
    r = replay(m, player=1)
    kinds = [(d.game, d.move_no, d.kind, d.played) for d in r.decisions]
    assert kinds == [
        (1, 1, "cube", "no-double"),
        (1, 1, "checker", "8/5 6/5"),
        (1, 2, "cube", "double"),
        (1, 3, "checker", "24/18(2) 13/7(2)"),
        (1, 5, "take", "pass"),
        (2, 1, "cube", "no-double"),
        (2, 1, "checker", "8/5 6/5"),
        (2, 2, "cube", "no-double"),
        (2, 2, "checker", "8/4 6/4"),
    ]
    pre_roll, first, double, later, drop = r.decisions[:5]
    assert pre_roll.xgid == "-b----E-C---eE---c-e----B-:0:0:1:00:0:0:0:5:10"
    assert first.xgid == "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:5:10"
    assert double.xgid == "-b---BD-B---cEa--d-e----B-:0:0:1:00:0:0:0:5:10"
    assert parse_xgid(later.xgid).cube_owner == 2  # B took, B owns the cube: no pre-roll decision on move 3
    offered = parse_xgid(drop.xgid)
    assert drop.xgid.split(":")[4] == "D" and offered.turn == 2 and offered.cube_value == 2 and offered.cube_owner == 2
    g1, g2, g3 = r.games
    assert (g1.winner, g1.points, g1.crawford) == (2, 2, False)
    assert (g2.winner, g2.points) == (2, 3)  # a win while the game runs = A resigned
    assert g3.winner is None and g3.records == 0
    assert r.final_score == (0, 5)

    as_b = replay(m, player=2)
    b_kinds = [(d.game, d.move_no, d.kind, d.played) for d in as_b.decisions]
    assert b_kinds[:4] == [(1, 1, "cube", "no-double"), (1, 1, "checker", "13/11 13/8"), (1, 2, "take", "take"), (1, 3, "cube", "no-double")]
    assert (1, 4, "cube", "double") in b_kinds
    redouble = next(d for d in as_b.decisions if d.move_no == 4 and d.kind == "cube")
    pos = parse_xgid(redouble.xgid)
    assert pos.cube_value == 2 and pos.cube_owner == 2 and pos.turn == 2 and pos.dice is None


CRAWFORD_MATCH = """5 point match

 Game 1
 A : 4                B : 2
  1) 31: 8/5 6/5                 52: 13/8 13/11
  2) 42: 8/4 6/4                 Wins 1 point

 Game 2
 A : 4                B : 3
  1) 31: 8/5 6/5                 52: 13/8 13/11
"""


def test_crawford_and_post_crawford():
    m = parse_mat(CRAWFORD_MATCH)
    a = replay(m, player=1)
    assert a.games[0].crawford and not a.games[1].crawford
    assert [d.kind for d in a.decisions] == ["checker", "checker", "checker"]  # Crawford, then a dead cube at 4-away... 4 + 1 >= 5
    assert a.decisions[0].xgid.split(":")[7] == "1"  # Crawford flag in the XGID
    b = replay(m, player=2)
    assert [(d.game, d.kind) for d in b.decisions] == [(1, "checker"), (2, "cube"), (2, "checker")]
    assert b.decisions[1].xgid == "-b---BD-B---eE---c-e----B-:0:0:-1:00:4:3:0:5:10"


def test_cube_live_rules():
    base = parse_xgid("-b----E-C---eE---c-e----B-:0:0:1:00:0:0:0:7:10")
    assert cube_live(base, 1) and cube_live(base, 2)
    assert not cube_live(parse_xgid("-b----E-C---eE---c-e----B-:0:0:1:00:6:4:1:7:10"), 1)  # Crawford
    assert not cube_live(parse_xgid("-b----E-C---eE---c-e----B-:1:-1:1:00:0:0:0:7:10"), 1)  # B owns it
    assert cube_live(parse_xgid("-b----E-C---eE---c-e----B-:1:-1:1:00:0:0:0:7:10"), 2)
    assert not cube_live(parse_xgid("-b----E-C---eE---c-e----B-:1:1:1:00:5:0:0:7:10"), 1)  # 5 + 2 >= 7
    assert cube_live(parse_xgid("-b----E-C---eE---c-e----B-:1:1:1:00:4:0:0:7:10"), 1)
    assert cube_live(parse_xgid("-b----E-C---eE---c-e----B-:0:0:1:00:0:0:0:0:10"), 1)  # money


@pytest.mark.parametrize(
    "text,message",
    [
        ("5 point match\n Game 1\n A : 0   B : 0\n  1) 31: 8/5 6/6\n", "illegal play"),
        ("5 point match\n Game 1\n A : 0   B : 0\n  1) 31:\n  2) 52: 13/8 13/11\n", "no play is recorded"),
        ("5 point match\n Game 1\n A : 0   B : 0\n  1) Takes\n", "without a double"),
        ("5 point match\n Game 1\n A : 0   B : 0\n  1) Doubles => 4\n", "double to 4"),
        ("1 point match\n Game 1\n A : 0   B : 0\n  1) Doubles => 2\n", "not available"),
        ("5 point match\n Game 1\n A : 0   B : 0\n  1) 31: 8/5 6/5   52: 13/8 13/11\n   Wins 1 point\n Game 2\n A : 0   B : 0\n", "starts at 0-0"),
    ],
)
def test_replay_errors(text, message):
    with pytest.raises(MatError) as info:
        replay(parse_mat(text))
    assert message in str(info.value)
