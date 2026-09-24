from pathlib import Path

import pytest

from bgpipeline.mat import MatError, parse_mat, parse_move_line, split_halves

FIXTURES = Path(__file__).with_name("fixtures")
GALAXY = (FIXTURES / "galaxy_45552673.mat").read_text(encoding="utf-8")


def test_galaxy_header_and_shape():
    m = parse_mat(GALAXY)
    h = m.header
    assert h.site == "BackgammonGalaxy" and h.match_id == "45552673"
    assert h.player1 == "cjdjensnefff" and h.player2 == "dcrc2"
    assert h.date == "2026.09.03" and h.time == "18.37" and h.cube_limit == 1024
    assert h.tags["Crawford"] == "On"
    assert m.match_length == 1
    assert len(m.games) == 1
    game = m.games[0]
    assert game.number == 1 and game.score == (0, 0)
    moves = [hm for hm in game.half_moves if hm.action == "move"]
    assert len(moves) == 110
    assert sum(1 for hm in moves if hm.player == 1) == 55
    assert [hm.action for hm in game.half_moves][-1] == "win"
    win = game.half_moves[-1]
    assert win.player == 2 and win.points == 1


def test_galaxy_records_are_normalised():
    game = parse_mat(GALAXY).games[0]
    by_line = {(hm.line_no, hm.player): hm for hm in game.half_moves}
    first = by_line[(18, 1)]
    assert first.move_no == 1 and first.dice == (4, 1) and first.plays == "13/9 24/23"
    assert by_line[(18, 2)].plays == "13/8 24/20"
    entering = by_line[(19, 2)]
    assert entering.dice == (3, 1) and entering.plays == "bar/22 22/21"
    dance = by_line[(26, 2)]
    assert dance.dice == (6, 1) and dance.plays == ""
    assert by_line[(39, 1)].plays == "6/off 6/1"
    assert by_line[(72, 2)].plays == "1/off 1/off"
    assert (42, 1) in by_line and by_line[(42, 1)].plays == ""  # " 25) 33:" with no player 2 half


def test_split_halves_like_gnubg():
    assert split_halves("  1) 41: 13/9 24/23              54: 13/8 24/20") == ("  1) 41: 13/9 24/23             ", "54: 13/8 24/20")
    left, right = split_halves("  1)                            54: 13/8 24/20")
    assert not left[4:].strip() and right.strip() == "54: 13/8 24/20"
    assert split_halves(" 25) 33:") == (" 25) 33:", None)
    left, right = split_halves("  7) Doubles => 2                Takes")
    assert left == "  7) Doubles => 2" and right.strip() == "Takes"
    left, right = split_halves("  8) 31: 8/5 6/5                 Doubles => 2")
    assert left == "  8) 31: 8/5 6/5" and right.strip() == "Doubles => 2"
    left, right = split_halves("                                  Wins 1 point and the match")
    assert not left.strip() and right.strip().startswith("Wins")


def test_parse_move_line_cube_records():
    (d, t) = parse_move_line("  7) Doubles => 2                Takes", 7)
    assert d.player == 1 and d.action == "double" and d.cube_to == 2 and d.move_no == 7
    assert t.player == 2 and t.action == "take"
    (only,) = parse_move_line("  9)                             Drops", 9)
    assert only.player == 2 and only.action == "drop"
    (w,) = parse_move_line("  Wins 2 points", 10)
    assert w.player == 1 and w.action == "win" and w.points == 2
    (hit,) = parse_move_line("  3) 62: 24/18* 13/11", 3)
    assert hit.plays == "24/18* 13/11"
    assert parse_move_line("  4) 55: Cannot Move", 4)[0].plays == ""
    assert parse_move_line("  5) Resigns", 5) == []


@pytest.mark.parametrize(
    "line,message",
    [
        ("  3) 62: 24/18 13/x", "bad move token"),
        ("  3) 62: 24/18 30/11", "point out of range"),
        ("  3) Beavers", "beavers"),
        ("  3) Something odd", "unrecognised record"),
        ("  3) Wins the match", "points"),
    ],
)
def test_bad_records_name_the_line(line, message):
    with pytest.raises(MatError) as info:
        parse_move_line(line, 3)
    assert info.value.line_no == 3
    assert message in str(info.value)


SYNTHETIC = """; [Site "Test"]
; [Match ID "77"]
; [Player 1 "A"]
; [Player 2 "B"]
5 point match

 Game 1
 A : 0                B : 0
  1)                            31: 8/5 6/5
  2) 52: 13/8 13/11             Doubles => 2
  3) Takes                      42: 8/4 6/4
                                 Wins 2 points

 Game 2
 A : 0                B : 2
  1) 31: 8/5 6/5                 52: 13/8 13/11
"""


def test_synthetic_match():
    m = parse_mat(SYNTHETIC)
    assert m.match_length == 5 and m.header.match_id == "77" and m.header.cube_limit is None
    g1, g2 = m.games
    assert g1.score == (0, 0) and g2.score == (0, 2)
    acts = [(hm.player, hm.action) for hm in g1.half_moves]
    assert acts == [(2, "move"), (1, "move"), (2, "double"), (1, "take"), (2, "move"), (2, "win")]
    assert g1.half_moves[0].move_no == 1 and g1.half_moves[2].cube_to == 2
    assert [(hm.player, hm.action) for hm in g2.half_moves] == [(1, "move"), (2, "move")]


def test_missing_length_or_games():
    with pytest.raises(MatError):
        parse_mat("; [Site \"x\"]\n Game 1\n A : 0   B : 0\n")
    with pytest.raises(MatError):
        parse_mat("5 point match\n")
    with pytest.raises(MatError) as info:
        parse_mat("5 point match\n Game 1\n not a score line\n")
    assert info.value.line_no == 3
