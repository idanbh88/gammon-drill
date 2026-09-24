"""The live engine script (bgpipeline/gnubg_server.py): request handling against a fake gnubg
module built from recorded gnubg 1.08.003 output, plus one live round trip when gnubg is
installed."""

import io
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from bgpipeline.gnubg_parse import correct_from_proper, cube_answers, cube_from_cfevaluate, flip_probs
from bgpipeline.gnubg_runner import ascii_path, find_gnubg
from bgpipeline.gnubg_server import PREFIX, analyse, serve

FIXTURES = Path(__file__).parent / "fixtures"
PIPELINE_DIR = Path(__file__).resolve().parents[1]

OPENING_31 = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10"
RACE_CUBE = "---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10"
RACE_OFFERED = "---BCCD-B-A--a-a-b-dcca---:0:0:1:D:2:1:0:7:10"
# gnubg.cfevaluate / gnubg.evaluate for RACE_CUBE at 2-ply (recorded 2026-09-24); the text
# hint of the same position says ND +0.752, DT +0.792, DP +1.000, "Double, take".
RACE_CF = (0.7919792532920837, 0.7522466778755188, 0.7919792532920837, 1.0, 0, "Double, take")
RACE_EV = (0.7589450478553772, 4.7771947720320895e-05, 0.0, 1.3936710274720099e-05, 0.0, 0.517920732498169)


class FakeGnubg:
    """Just the calls gnubg_server makes, answered from recordings."""

    def __init__(self, hint=None, cf=None, ev=None, cls=10):
        self.commands = []
        self._hint, self._cf, self._ev, self._cls = hint, cf, ev, cls

    def command(self, cmd):
        self.commands.append(cmd)

    def board(self):
        return ((0,) * 25, (0,) * 25)

    def classifypos(self, board):
        return self._cls

    def hint(self):
        return self._hint

    def cubeinfo(self):
        return {"cube": 1}

    def evalcontext(self):
        return {"plies": 2}

    def cfevaluate(self, board, ci, ec):
        return self._cf

    def evaluate(self, board, ci, ec):
        return self._ev


@pytest.fixture(scope="module")
def opening_hint():
    records = json.loads((FIXTURES / "hint_api.json").read_text(encoding="utf-8"))
    return records[0]["hint"]


def test_checker_best_move_when_nothing_played(opening_hint):
    g = FakeGnubg(hint=opening_hint)
    r = analyse(g, {"xgid": OPENING_31}, plies=2)
    assert g.commands == ["set xgid XGID=" + OPENING_31]
    assert r["kind"] == "checker" and r["best"] == "8/5 6/5" and r["played"] == "8/5 6/5"
    assert r["playedAnswerId"] == "8/5 6/5" and r["loss"] == 0
    assert r["answers"][0]["id"] == "8/5 6/5" and len(r["answers"]) >= 4
    assert r["positionClass"] == "contact" and "opening" in r["categories"]
    assert r["cube"] is None and r["warnings"] == []


def test_checker_played_move_is_found_by_resulting_position(opening_hint):
    r = analyse(FakeGnubg(hint=opening_hint), {"xgid": OPENING_31, "played": "13/10 24/23"}, plies=2)
    assert r["playedAnswerId"] == "24/23 13/10"
    assert r["loss"] == pytest.approx(0.2307, abs=1e-4)
    assert r["best"] == "8/5 6/5"


def test_cube_decision_missed_double():
    g = FakeGnubg(cf=RACE_CF, ev=RACE_EV, cls=8)
    r = analyse(g, {"xgid": RACE_CUBE, "played": "no-double"}, plies=2)
    assert r["kind"] == "cube" and r["best"] == "double"
    assert r["answers"][0]["id"] == "double-take"
    assert r["playedAnswerId"] == "no-double" and r["loss"] == pytest.approx(0.0397, abs=1e-4)
    assert r["cube"] == {"nd": RACE_CF[1], "dt": RACE_CF[2], "dp": 1.0, "proper": "Double, take"}
    assert r["positionClass"] == "race"
    assert analyse(g, {"xgid": RACE_CUBE}, plies=2)["loss"] == 0


def test_take_decision_is_scored_from_the_responders_side():
    r = analyse(FakeGnubg(cf=RACE_CF, ev=RACE_EV, cls=8), {"xgid": RACE_OFFERED, "played": "pass"}, plies=2)
    assert r["kind"] == "take" and r["best"] == "take"
    assert [a["id"] for a in r["answers"]] == ["take", "pass"]
    assert r["loss"] == pytest.approx(0.2080, abs=1e-4)
    take = r["answers"][0]
    assert take["equity"] == pytest.approx(-0.792, abs=1e-3)
    assert take["probs"]["win"] == pytest.approx(1 - RACE_EV[0], abs=1e-4)


def test_serve_protocol():
    out = io.StringIO()
    lines = [
        '{"id": 1, "op": "ping"}',
        "not json",
        '{"id": 2, "op": "analyse", "xgid": "nonsense"}',
        '{"id": 3, "op": "nope"}',
        "",
        '{"id": 4, "op": "quit"}',
        '{"id": 5, "op": "ping"}',
    ]
    serve(FakeGnubg(), lines, out)
    replies = [json.loads(line[len(PREFIX) :]) for line in out.getvalue().splitlines()]
    assert all(line.startswith(PREFIX) for line in out.getvalue().splitlines())
    assert [(r["id"], r["ok"]) for r in replies] == [(1, True), (None, False), (2, False), (3, False), (4, True)]
    assert "ms" in replies[0]


def test_correct_from_proper():
    cases = {
        "Double, take": "double-take",
        "Redouble, pass": "double-pass",
        "No double, take": "no-double",
        "No redouble, take (12.3%)": "no-double",
        "Too good to double, pass": "too-good",
        "Too good to redouble, take": "too-good",
        "Never double, take (dead cube)": "no-double",
        "Optional double, take": "double-take",
        "Optional redouble, pass": "double-pass",
        "Double, beaver": "double-take",
    }
    for text, want in cases.items():
        assert correct_from_proper(text) == want, text


def test_cube_from_cfevaluate():
    c = cube_from_cfevaluate(RACE_CF, RACE_EV)
    assert (c["nd"], c["dt"], c["dp"], c["correct"]) == (RACE_CF[1], RACE_CF[2], 1.0, "double-take")
    assert c["probs"]["win"] == pytest.approx(0.759, abs=1e-3) and c["cubeless"] == pytest.approx(0.518, abs=1e-3)
    assert cube_from_cfevaluate(RACE_CF)["probs"] is None


def test_take_answers_flip_probabilities():
    c = cube_from_cfevaluate(RACE_CF, RACE_EV)
    p = {"win": 0.7, "winGammon": 0.2, "winBackgammon": 0.01, "loseGammon": 0.05, "loseBackgammon": 0.002}
    assert flip_probs(p) == {"win": pytest.approx(0.3), "winGammon": 0.05, "winBackgammon": 0.002, "loseGammon": 0.2, "loseBackgammon": 0.01}
    take = cube_answers(c, "cube-take", centered=True, probs=p)
    joint = cube_answers(c, "cube-double", centered=True, probs=p)
    assert take[0]["probs"]["win"] == pytest.approx(0.3) and take[0]["probs"]["loseGammon"] == pytest.approx(0.2)
    assert joint[0]["probs"]["win"] == pytest.approx(0.7)


@pytest.mark.skipif(find_gnubg() is None, reason="gnubg-cli not installed")
def test_live_round_trip(tmp_path):
    exe = find_gnubg()
    script = tmp_path / "bg-gnubg-server.py"
    shutil.copyfile(PIPELINE_DIR / "bgpipeline" / "gnubg_server.py", script)
    env = dict(os.environ, BG_PIPELINE_DIR=str(PIPELINE_DIR), BG_PLIES="0", BG_SERVE="1", PYTHONIOENCODING="utf-8")
    env.pop("BG_XGIDS", None)
    requests = [
        {"id": 1, "op": "analyse", "xgid": OPENING_31},
        {"id": 2, "op": "analyse", "xgid": RACE_CUBE, "played": "no-double"},
        {"id": 3, "op": "quit"},
    ]
    proc = subprocess.run(
        [exe, "-t", "-q", "-p", str(ascii_path(script))],
        input="".join(json.dumps(r) + "\n" for r in requests),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        cwd=str(Path(exe).parent),
        timeout=300,
    )
    replies = [json.loads(line[len(PREFIX) :]) for line in proc.stdout.splitlines() if line.startswith(PREFIX)]
    assert replies[0] == {"event": "ready", "plies": 0}, proc.stdout[-2000:] + proc.stderr[-2000:]
    by_id = {r.get("id"): r for r in replies[1:]}
    assert by_id[1]["ok"] and by_id[1]["kind"] == "checker" and by_id[1]["best"] == "8/5 6/5" and by_id[1]["loss"] == 0
    cube = by_id[2]
    assert cube["ok"] and cube["kind"] == "cube" and cube["best"] in ("double", "no-double")
    assert {a["id"] for a in cube["answers"]} == {"no-double", "double-take", "double-pass", "too-good"}
    assert by_id[3]["ok"]
