from bgpipeline.moves import format_play, generate_plays, is_legal_play, legal_sequences, parse_play
from bgpipeline.xgid import acting_view, parse_xgid, view_from_counts

OPENING = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10"


def notations(view, dice):
    return [p.notation for p in generate_plays(view, dice)]


def test_opening_31():
    view = acting_view(parse_xgid(OPENING))
    ns = notations(view, (3, 1))
    assert "8/5 6/5" in ns
    assert "24/23 13/10" in ns
    assert "24/20" in ns
    assert "13/9" in ns
    assert not any("13/12" in n for n in ns)  # the 12 point is held
    assert all(len(p.steps) == 2 for p in generate_plays(view, (3, 1)))
    assert len(ns) == 16



def test_legal_sequences_every_order():
    # Mirrors "legalSequences" in src/lib/__tests__/move-input.test.ts.
    view = acting_view(parse_xgid(OPENING))
    seqs = legal_sequences(view, (3, 1))
    assert all(len(steps) == 2 and len(used) == 2 for steps, used in seqs)
    text = {" ".join(f"{st.src}/{st.dst}" for st in steps): used for steps, used in seqs}
    assert text["8/5 6/5"] == [3, 1] and text["6/5 8/5"] == [1, 3]
    assert len({p.result.key() for p in generate_plays(view, (3, 1))}) == 16


def test_bar_first_and_no_entry():
    theirs = {19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 1: 2, 12: 3}
    v = view_from_counts({13: 5, 8: 3, 6: 5, 24: 1}, theirs, my_bar=1)
    ns = notations(v, (2, 1))
    assert ns and all(n.startswith("bar/24") for n in ns)
    assert "bar/24 13/11" in ns
    assert not is_legal_play(v, (2, 1), "13/11 13/12")
    blocked = view_from_counts({13: 5, 8: 3, 6: 6}, {19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2, 12: 3}, my_bar=1)
    assert generate_plays(blocked, (2, 1)) == []
    assert is_legal_play(blocked, (2, 1), "")


def test_dice_rules():
    base_theirs = {2: 2, 3: 2, 4: 2, 5: 2, 7: 3, 8: 2}
    # both dice must be played when any order allows it
    v = view_from_counts({24: 1, 1: 14}, {**base_theirs, 18: 2})
    assert notations(v, (6, 5)) == ["24/13"]
    # only one die playable: the larger one
    v = view_from_counts({24: 1, 1: 14}, {**base_theirs, 13: 2})
    assert notations(v, (6, 5)) == ["24/18"]
    assert not is_legal_play(v, (6, 5), "24/19")
    # doubles play four moves
    v = acting_view(parse_xgid("-b----E-C---eE---c-e----B-:0:0:1:44:0:0:0:7:10"))
    ns = notations(v, (4, 4))
    assert "24/20(2) 13/9(2)" in ns and "13/5(2)" in ns
    assert all(len(p.steps) == 4 for p in generate_plays(v, (4, 4)))


def test_hitting():
    v = view_from_counts({24: 2, 13: 5, 8: 3, 6: 5}, {21: 1, 12: 5, 17: 3, 19: 5, 1: 1})
    plays = generate_plays(v, (3, 1))
    hit = next(p for p in plays if p.notation == "24/21* 6/5")
    assert hit.result.their_bar == 1 and hit.result.points[21] == 1
    assert any(p.notation == "24/21*/20" for p in plays)


def test_bear_off():
    theirs = {19: 2, 20: 2, 21: 3, 22: 2, 23: 1}
    v = view_from_counts({6: 2, 5: 3, 4: 2, 2: 2, 1: 1}, theirs)
    ns = notations(v, (5, 2))
    assert "5/off 2/off" in ns and "6/4 5/off" in ns
    assert not is_legal_play(v, (5, 2), "6/off 2/off")
    assert not is_legal_play(v, (5, 2), "4/off 2/off")
    v = view_from_counts({4: 2, 3: 1}, theirs)
    assert "4/off(2)" in notations(v, (6, 5))
    assert notations(view_from_counts({4: 1, 3: 1}, theirs), (6, 5)) == ["4/off 3/off"]
    outside = view_from_counts({7: 1, 6: 2, 5: 3}, theirs)
    assert not is_legal_play(outside, (6, 1), "7/1 6/off")
    assert is_legal_play(outside, (6, 1), "7/6 6/off")


def test_notation_round_trip():
    for n in ["bar/21* 24/21", "8/5(2) 6/5(2)", "24/18*/13", "6/off 5/off", "bar/22 13/9", "13/7"]:
        assert format_play(parse_play(n)) == n
    assert [(s.src, s.dst, s.hit) for s in parse_play("24/18*/13")] == [(24, 18, True), (18, 13, False)]


def test_equivalent_notations():
    v = acting_view(parse_xgid(OPENING))
    assert is_legal_play(v, (3, 1), "24/21 21/20")
    assert is_legal_play(v, (3, 1), "24/20")
    assert is_legal_play(v, (3, 1), "6/5 8/5")
    assert not is_legal_play(v, (3, 1), "13/10")
    assert not is_legal_play(v, (3, 1), "13/10 13/8")
