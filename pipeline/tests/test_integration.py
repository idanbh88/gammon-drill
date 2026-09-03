"""End-to-end run against a real gnubg, skipped when it is not installed."""

import pytest

from bgpipeline.gnubg_parse import build_problem
from bgpipeline.gnubg_runner import find_gnubg, run_gnubg
from bgpipeline.moves import is_legal_play
from bgpipeline.xgid import acting_view, parse_xgid

OPENING = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10"
RACE_CUBE = "---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10"

pytestmark = pytest.mark.skipif(find_gnubg() is None, reason="gnubg-cli not installed")


def test_run_gnubg_end_to_end():
    raw = run_gnubg([OPENING, RACE_CUBE], plies=0, timeout=600)
    assert [r["ok"] for r in raw] == [True, True]
    checker = build_problem(raw[0], problem_id="t-1", plies=0)
    assert checker["type"] == "checker"
    assert checker["answers"][0]["id"] == "8/5 6/5"
    assert checker["analysis"]["positionClass"] == "contact"
    view = acting_view(parse_xgid(OPENING))
    for a in checker["answers"]:
        assert is_legal_play(view, (3, 1), a["id"]), a["id"]
    cube = build_problem(raw[1], problem_id="t-2", plies=0)
    assert cube["type"] == "cube"
    assert cube["analysis"]["positionClass"] == "race"
    assert {a["id"] for a in cube["answers"]} == {"no-double", "double-take", "double-pass", "too-good"}
    assert cube["answers"][0]["equityLoss"] == 0
