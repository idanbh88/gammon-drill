"""Scoring of played moves against gnubg's ranking, from recorded gnubg output (0-ply, so the
numbers are not meaningful as backgammon advice, but every path is exercised offline)."""

import json
from pathlib import Path

import pytest

from bgpipeline.mat import parse_mat
from bgpipeline.match_score import score_decision
from bgpipeline.moves import apply_steps, is_legal_play, parse_play, state_from_view
from bgpipeline.replay import Decision, replay
from bgpipeline.xgid import acting_view, parse_xgid

FIXTURES = Path(__file__).with_name("fixtures")
GALAXY = parse_mat((FIXTURES / "galaxy_45552673.mat").read_text(encoding="utf-8"))
RAW = {r["xgid"]: r for r in json.loads((FIXTURES / "match_gnubg_plies0.json").read_text(encoding="utf-8"))}
CUBE_TEXT = (FIXTURES / "hint_cube.txt").read_text(encoding="utf-8", errors="replace")
RACE_CUBE = "---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10"


def test_every_evaluated_decision_is_scored():
    rep = replay(GALAXY, player=1)
    evaluated = [d for d in rep.decisions if not d.forced]
    assert len(evaluated) == 27 and len(rep.decisions) == 55
    losses = []
    for d in evaluated:
        s = score_decision(d, RAW[d.xgid], plies=0)
        assert s.warnings == [], (d, s.warnings)
        assert s.played_answer_id is not None and s.best_answer_id == s.answers[0]["id"]
        assert s.answers[0]["equityLoss"] == 0
        assert [a["equityLoss"] for a in s.answers] == sorted(a["equityLoss"] for a in s.answers)
        played = next(a for a in s.answers if a["id"] == s.played_answer_id)
        assert played["equityLoss"] == s.loss and played["equity"] == s.played_equity
        assert s.loss == pytest.approx(max(0.0, s.best_equity - s.played_equity), abs=2e-4)  # three roundings to 4 places
        view = acting_view(parse_xgid(d.xgid))
        assert is_legal_play(view, d.dice, s.played_answer_id)
        assert s.position_class in ("contact", "race", "crashed", "bearoff") and s.categories
        assert s.features and "pips_me" in s.features
        losses.append(s.loss)
    assert any(x > 0 for x in losses) and any(x == 0 for x in losses)


def test_forced_and_unevaluated_decisions():
    rep = replay(GALAXY, player=1)
    dance = next(d for d in rep.decisions if d.n_plays == 0)
    s = score_decision(dance, None)
    assert s.answers == [] and s.loss is None and s.warnings == [] and s.categories == []
    open_choice = next(d for d in rep.decisions if not d.forced)
    s = score_decision(open_choice, None)
    assert s.loss is None and s.warnings == ["not evaluated"] and s.categories  # still classified
    broken = dict(RAW[open_choice.xgid], ok=False, error="boom")
    s = score_decision(open_choice, broken)
    assert s.loss is None and "boom" in s.warnings[0]


def _played_key(d: Decision):
    start = state_from_view(acting_view(parse_xgid(d.xgid)))
    return apply_steps(start, parse_play(d.played)).key()


def test_played_move_outside_the_top_answers_is_appended():
    rep = replay(GALAXY, player=1)
    for d in rep.decisions:
        if d.forced:
            continue
        s = score_decision(d, RAW[d.xgid], plies=0)
        full = RAW[d.xgid]["chequer"]["hint"]
        rank = next(i for i, m in enumerate(full) if m["move"] == s.played_answer_id)
        if rank >= 3:
            top = score_decision(d, RAW[d.xgid], plies=0, max_answers=2)
            assert [a["id"] for a in top.answers[:2]] == [m["move"] for m in full[:2]]
            assert top.answers[-1]["id"] == s.played_answer_id and top.answers[-1]["equityLoss"] == s.loss
            assert len(top.answers) == 3
            return
    pytest.fail("no decision in the fixture was played outside gnubg's top three")


def test_played_move_missing_from_the_list():
    rep = replay(GALAXY, player=1)
    d = next(d for d in rep.decisions if not d.forced)
    raw = json.loads(json.dumps(RAW[d.xgid]))
    start = state_from_view(acting_view(parse_xgid(d.xgid)))
    key = _played_key(d)
    raw["chequer"]["hint"] = [m for m in raw["chequer"]["hint"] if apply_steps(start, parse_play(m["move"])).key() != key][:3]
    s = score_decision(d, raw, plies=0)
    assert s.loss is None and "not in gnubg's list" in s.warnings[0]
    assert len(s.answers) == 3 and s.best_answer_id  # the ranking is still stored


def _cube_raw(xgid: str) -> dict:
    return {"xgid": xgid, "ok": True, "class": 8, "chequer": None, "needs_cube": True, "cube_text": CUBE_TEXT}


def _cube_decision(kind: str, played: str, xgid: str) -> Decision:
    return Decision(1, 3, 1, kind, xgid, None, played, False, 0, 10)


def test_cube_decisions_charge_only_the_half_the_player_decided():
    # hint_cube.txt: ND 0.752, DT 0.792, DP 1.0, proper "Double, take".
    doubled = score_decision(_cube_decision("cube", "double", RACE_CUBE), _cube_raw(RACE_CUBE))
    assert doubled.played_answer_id == "double-take" and doubled.loss == 0
    missed = score_decision(_cube_decision("cube", "no-double", RACE_CUBE), _cube_raw(RACE_CUBE))
    assert missed.played_answer_id == "no-double" and missed.loss == pytest.approx(0.04)
    assert missed.best_answer_id == "double-take" and missed.categories == ["racing-cube"]
    offered = RACE_CUBE.replace(":00:", ":D:")
    take = score_decision(_cube_decision("take", "take", offered), _cube_raw(offered))
    assert take.played_answer_id == "take" and take.loss == 0 and take.played_equity == pytest.approx(-0.792)
    drop = score_decision(_cube_decision("take", "pass", offered), _cube_raw(offered))
    assert drop.played_answer_id == "pass" and drop.loss == pytest.approx(0.208)
