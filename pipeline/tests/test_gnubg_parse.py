"""Parsing of captured gnubg output (fixtures recorded from gnubg 1.08.003)."""

import datetime as dt
import json
from pathlib import Path

import pytest

from bgpipeline.gnubg_inner import setup_commands as inner_setup
from bgpipeline.gnubg_parse import ParseError, build_problem, chequer_answers, cube_answers, parse_cube_text
from bgpipeline.gnubg_runner import setup_commands as runner_setup
from bgpipeline.moves import is_legal_play
from bgpipeline.xgid import acting_view, parse_xgid

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def api_records():
    return json.loads((FIXTURES / "hint_api.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def cube_text():
    text = (FIXTURES / "hint_cube.txt").read_text(encoding="utf-8", errors="replace")
    return "Cube analysis" + text.split("Cube analysis")[1]


def test_setup_commands_in_sync():
    for plies in (0, 1, 2, 3):
        assert inner_setup(plies, plies) == runner_setup(plies, plies)
    assert "set evaluation movefilter 2 0 -1 0 0" in runner_setup(2, 2)
    assert "set evaluation movefilter 2 1 10 4 0.16" in runner_setup(2, 2)


def test_parse_cube_text(cube_text):
    p = parse_cube_text(cube_text)
    assert p["nd"] == pytest.approx(0.752)
    assert p["dt"] == pytest.approx(0.792)
    assert p["dp"] == pytest.approx(1.0)
    assert p["correct"] == "double-take"
    assert p["proper"] == "Double, take"
    assert p["probs"]["win"] == pytest.approx(0.759)
    assert p["cubeless"] == pytest.approx(0.518)


def test_parse_cube_variants():
    text = """Cube analysis
2-ply cubeless equity +0.300
  0.650 0.100 0.010 - 0.350 0.050 0.002
Cubeful equities:
1. No redouble         +0.610
2. Redouble, take      +0.590  (-0.020)
3. Redouble, pass      +1.000  (+0.390)
Proper cube action: No redouble, take (12.3%)
"""
    p = parse_cube_text(text)
    assert p["correct"] == "no-double" and p["nd"] == 0.61 and p["dt"] == 0.59
    too_good = text.replace("Proper cube action: No redouble, take (12.3%)", "Proper cube action: Too good to redouble, pass")
    assert parse_cube_text(too_good)["correct"] == "too-good"
    with pytest.raises(ParseError):
        parse_cube_text("Cube analysis\nnothing useful\n")


def test_cube_answers_joint(cube_text):
    p = parse_cube_text(cube_text)
    answers = cube_answers(p, "cube-double", centered=True, probs=p["probs"])
    by_id = {a["id"]: a for a in answers}
    assert answers[0]["id"] == "double-take" and answers[0]["equityLoss"] == 0
    assert by_id["no-double"]["equityLoss"] == pytest.approx(0.04, abs=1e-6)
    assert by_id["double-pass"]["equityLoss"] == pytest.approx(0.208, abs=1e-6)
    assert by_id["too-good"]["equityLoss"] == pytest.approx(0.248, abs=1e-6)
    assert by_id["double-take"]["label"] == "Double, take"
    assert cube_answers(p, "cube-double", centered=False, probs=None)[0]["label"] == "Redouble, take"
    assert all(a["probs"]["win"] == pytest.approx(0.759) for a in answers)


def test_cube_answers_take_pass(cube_text):
    p = parse_cube_text(cube_text)
    answers = cube_answers(p, "cube-take", centered=True, probs=None)
    assert [a["id"] for a in answers] == ["take", "pass"]
    assert answers[0]["equityLoss"] == 0 and answers[1]["equityLoss"] == pytest.approx(0.208, abs=1e-6)
    assert answers[0]["equity"] == pytest.approx(-0.792)


def test_chequer_answers(api_records):
    hint = api_records[0]["hint"]
    answers = chequer_answers(hint, 4)
    assert [a["id"] for a in answers] == ["8/5 6/5", "24/23 13/10", "24/20", "13/9"]
    assert answers[0]["equityLoss"] == 0
    assert answers[1]["equityLoss"] == pytest.approx(0.2307, abs=1e-4)
    assert answers[0]["probs"]["win"] == pytest.approx(0.5515, abs=1e-4)
    assert answers[0]["probs"]["loseBackgammon"] == pytest.approx(0.0048, abs=1e-4)


def test_build_problem_checker(api_records):
    rec = dict(api_records[0], ok=True, chequer=api_records[0]["hint"], needs_cube=False)
    rec["class"] = 10
    p = build_problem(rec, problem_id="x-1", max_answers=5, plies=2, source="fixture", today=dt.date(2026, 9, 2))
    assert p["type"] == "checker" and p["id"] == "x-1" and p["source"] == "fixture"
    assert p["analysis"] == {"engine": "gnubg", "plies": 2, "analysedAt": "2026-09-02", "positionClass": "contact"}
    view = acting_view(parse_xgid(p["xgid"]))
    for a in p["answers"]:
        assert is_legal_play(view, (3, 1), a["id"]), a["id"]


def test_build_problem_player2_on_roll(api_records):
    rec = dict(api_records[3], ok=True, chequer=api_records[3]["hint"], needs_cube=False)
    rec["class"] = 6
    p = build_problem(rec, problem_id="x-5", plies=2)
    assert p["answers"][0]["id"] == "5/off 2/off"
    assert p["analysis"]["positionClass"] == "bearoff"
    view = acting_view(parse_xgid(p["xgid"]))
    assert view.me == 2
    for a in p["answers"]:
        assert is_legal_play(view, (5, 2), a["id"]), a["id"]


def test_build_problem_cube(cube_text):
    rec = {"xgid": "---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10", "ok": True, "chequer": None, "needs_cube": True, "cube_text": cube_text, "class": 8}
    p = build_problem(rec, problem_id="x-3", plies=2)
    assert p["type"] == "cube" and p["answers"][0]["id"] == "double-take"
    assert p["analysis"]["positionClass"] == "race"
    offered = dict(rec, xgid="---BCCD-B-A--a-a-b-dcca---:0:0:1:D:2:1:0:7:10")
    q = build_problem(offered, problem_id="x-4", plies=2)
    assert [a["id"] for a in q["answers"]] == ["take", "pass"]


def test_build_problem_failures():
    with pytest.raises(ParseError):
        build_problem({"xgid": "x", "ok": False, "error": "boom"}, problem_id="f")
    with pytest.raises(ParseError):
        build_problem({"xgid": "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10", "ok": True, "chequer": None}, problem_id="f")
