"""gnubg's verdict on the book's answers, from the recorded gnubg output used by the match tests
(0-ply numbers: every path is exercised offline, the values are not advice)."""

import json
from pathlib import Path

import pytest

from bgpipeline.book_score import agreement, categories_for, score_problem
from bgpipeline.robertie import BookProblem

FIXTURES = Path(__file__).with_name("fixtures")
RAW = json.loads((FIXTURES / "match_gnubg_plies0.json").read_text(encoding="utf-8"))
CUBE_TEXT = (FIXTURES / "hint_cube.txt").read_text(encoding="utf-8", errors="replace")
RACE_CUBE = "---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10"


def problem(xgid, kind, answer, dice=None, chapter=9):
    return BookProblem(
        number=12, chapter=chapter, chapter_title="The Blitz", caption="", kind=kind, dice=dice, problem_page=None,
        diagram=None, solution_pages=[], solution=None, play_as_printed=answer, cube_verdict=None, book_answer=answer,
        local=None, claude=None, xgid=xgid, status="ok", issues=[], fix=None,
    )


def checker_record():
    for rec in RAW:
        hint = (rec.get("chequer") or {}).get("hint") or []
        if len(hint) >= 8:
            return rec, hint
    pytest.fail("no checker record with 8 plays in the fixture")


def test_the_book_play_is_found_by_resulting_position_and_scored():
    rec, hint = checker_record()
    dice = "".join(str(d) for d in rec["posinfo"]["dice"])
    best, seventh = hint[0], hint[7]
    p = problem(rec["xgid"], "checker", seventh["move"], dice)
    a = score_problem(p, rec, plies=0)
    assert a["book_answer_id"] == seventh["move"]
    assert a["book_loss"] == pytest.approx(best["equity"] - seventh["equity"], abs=2e-4)
    assert any(x["id"] == seventh["move"] for x in a["answers"])  # appended although outside the top 6
    assert a["best_answer_id"] == best["move"] and a["book_full_depth"]
    same = score_problem(problem(rec["xgid"], "checker", best["move"], dice), rec, plies=0)
    assert same["book_loss"] == 0 and agreement(same["book_loss"]) == "same"


def test_below_full_depth_is_noted():
    rec, hint = checker_record()
    dice = "".join(str(d) for d in rec["posinfo"]["dice"])
    shallow = json.loads(json.dumps(rec))
    for m in shallow["chequer"]["hint"]:
        m.setdefault("context", {})["plies"] = 0
    a = score_problem(problem(rec["xgid"], "checker", hint[1]["move"], dice), shallow, plies=2)
    assert not a["book_full_depth"] and "below 2-ply" in a["notes"]


def cube_raw():
    return {"xgid": RACE_CUBE, "ok": True, "class": 8, "chequer": None, "needs_cube": True, "cube_text": CUBE_TEXT}


@pytest.mark.parametrize(
    "answer, loss",
    [("double-take", 0.0), ("double", 0.0), ("no-double", 0.04), ("double-pass", 0.208), ("too-good", 0.248)],
)
def test_cube_answers_are_scored_as_joint_answers(answer, loss):
    # hint_cube.txt: ND 0.752, DT 0.792, DP 1.0 -> double, take
    a = score_problem(problem(RACE_CUBE, "cube", answer, chapter=29), cube_raw(), plies=0)
    assert a["book_loss"] == pytest.approx(loss)
    assert a["best_answer_id"] == "double-take"
    assert "racing-cube" in a["categories"]


def test_agreement_marks():
    assert [agreement(x) for x in (None, 0, 0.019, 0.02, 0.079, 0.08)] == [None, "same", "close", "differs", "differs", "blunder"]


def test_categories_join_the_chapter_and_the_classifier_in_taxonomy_order():
    assert categories_for(9, ["contact-cube"]) == ["blitz", "contact-cube"]
    assert categories_for(7, ["early-game"]) == ["early-game"]  # chapter 7 has no category of its own
    assert categories_for(None, ["race"]) == ["race"]
