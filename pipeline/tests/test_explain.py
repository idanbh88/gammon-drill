import datetime as dt
import json
import os
from pathlib import Path

import pytest

from bgpipeline.explain import (
    build_prompt,
    clean_explanation,
    describe_position,
    explain_problems,
    load_dotenv,
    question_text,
)
from bgpipeline.xgid import parse_xgid

DATA = Path(__file__).resolve().parents[2] / "data" / "problems.json"


@pytest.fixture(scope="module")
def seeds():
    return json.loads(DATA.read_text(encoding="utf-8"))["problems"]


def test_question_text():
    assert question_text(parse_xgid("-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10")) == "Blue to play 31."
    assert question_text(parse_xgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10")) == "Blue is on roll. Cube action?"
    assert question_text(parse_xgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:D:2:1:0:7:10")) == "White doubles to 2. Should Blue take or pass?"


def test_describe_position_uses_blue_numbering():
    text = describe_position(parse_xgid("--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10"))
    assert "Blue (to act): 6-point x2, 5-point x3, 4-point x2, 2-point x2, 1-point x1" in text
    assert "borne off 5; pip count 40" in text
    assert "Blue's 23-point (White's 2-point) x1" in text and "Blue's 19-point (White's 6-point) x2" in text
    assert "7-point match, Blue 3 - White 2" in text and "owned by Blue" in text


def test_build_prompt_contains_the_facts(seeds):
    by_id = {p["id"]: p for p in seeds}
    prompt = build_prompt(by_id["seed-001"])
    assert "Blue to play 31." in prompt
    assert "1. 8/5 6/5: equity +0.220 (best)" in prompt
    assert "24/23 13/10" in prompt and "loses 0.231" in prompt
    assert "pip count 167" in prompt
    assert "wins 55.1%" in prompt
    assert "Categories: opening." in prompt
    cube = build_prompt(by_id["seed-003"])
    assert "Cube action?" in cube and "Double, take: equity +0.792 (best)" in cube and "cube centred at 1" in cube
    assert "engine position class: race" in cube


def test_clean_explanation():
    raw = "**Explanation:**\n\n- 8/5 6/5 makes the **5-point**.\n\n1. The alternatives split.\n```\nx\n```\n"
    assert clean_explanation(raw) == "8/5 6/5 makes the 5-point. The alternatives split."


def _problem(pid, xgid, explanation=""):
    return {
        "id": pid,
        "xgid": xgid,
        "type": "checker",
        "categories": ["opening"],
        "explanation": explanation,
        "answers": [
            {"id": "8/5 6/5", "label": "8/5 6/5", "equity": 0.2, "equityLoss": 0},
            {"id": "13/9", "label": "13/9", "equity": 0.0, "equityLoss": 0.2},
        ],
    }


def test_explain_problems_fills_and_skips():
    problems = [
        _problem("a", "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10"),
        _problem("b", "-b----E-C---eE---c-e----B-:0:0:1:63:0:0:0:7:10", "already there"),
    ]
    calls = []

    def fake(prompt):
        calls.append(prompt)
        return "Making the 5-point is right.", {"model": "test-model", "input_tokens": 1, "output_tokens": 1}

    done = []
    n = explain_problems(problems, fake, on_done=lambda p, m: done.append(p["id"]), today=dt.date(2026, 9, 3))
    assert n == 1 and done == ["a"]
    assert problems[0]["explanation"] == "Making the 5-point is right."
    assert problems[0]["explanationMeta"] == {"model": "test-model", "generatedAt": "2026-09-03"}
    assert problems[1]["explanation"] == "already there" and "explanationMeta" not in problems[1]
    assert "Blue to play 31." in calls[0]

    assert explain_problems(problems, fake, force=True, only={"b"}) == 1
    assert problems[1]["explanation"] == "Making the 5-point is right."
    assert explain_problems(problems, fake, force=True, limit=1) == 1


def test_load_dotenv_does_not_override(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("# comment\nANTHROPIC_API_KEY='from-file'\nOTHER_VAR=x\n", encoding="utf-8")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "from-env")
    monkeypatch.delenv("OTHER_VAR", raising=False)
    load_dotenv([tmp_path / "missing", env])
    assert os.environ["ANTHROPIC_API_KEY"] == "from-env"
    assert os.environ["OTHER_VAR"] == "x"
