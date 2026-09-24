"""Parsing Backgammon Galaxy quiz exports (a synthetic fixture, no Galaxy material)."""

import json
from pathlib import Path

import pytest

from bgpipeline.galaxy_quiz import (
    QuizError,
    answer_kind,
    collection_from_name,
    image_file,
    parse_loss,
    parse_quiz,
    unknown_losses,
)

SYNTHETIC = Path(__file__).with_name("fixtures") / "galaxy_quiz_synthetic.json"


def synthetic() -> dict:
    return json.loads(SYNTHETIC.read_text(encoding="utf-8"))


def test_parses_every_shape():
    quiz = parse_quiz(synthetic())
    assert quiz.site_id == "5a5a5a5a5a5a5a5a5a5a5a5a" and quiz.author == "Test Author"
    assert quiz.name == "Synthetic lesson: every shape of a Galaxy quiz export"
    assert [p.number for p in quiz.problems] == [1, 2, 3, 4, 5, 6]
    assert [p.kind for p in quiz.problems] == ["checker", "cube", "cube", "checker", "checker", "checker"]
    assert quiz.checker_count == 4 and quiz.with_analysis == 3
    assert quiz.problems[0].problem_id == "lesson-b00000000000000000000001"
    assert [p.analysis for p in quiz.problems][1:4] == [None, "Invented analysis with spaces around it.", None]

    first = quiz.problems[0]
    assert [c.answer for c in first.choices] == ["13/10", "Bar/20 6/3*", "7/5 6/5", "7/2 6/1 5/Off(2)"]
    assert [c.correct for c in first.choices] == [False, False, True, False]
    assert [c.loss for c in first.choices] == [0.062, 0.116, 0.0, 0.167]
    assert first.choices[2].description == "+0.458" and first.choices[3].image_url is None
    # URLs are kept exactly as given (already percent-encoded)
    assert quiz.problems[5].image_url.endswith("/6%20rnd1%20A%20v%20B.png")


def test_losses_follow_the_text():
    quiz = parse_quiz(synthetic())
    losses = [[c.loss for c in p.choices] for p in quiz.problems]
    assert losses[1] == [None, 0.0, None, None]  # "Wrong", correct "No double +0.784", "(+0.392)", "("
    assert losses[2] == [0.049, 0.0, 0.094, 0.143]  # bare differences: the correct choice reads 0.000
    assert losses[3] == [0.0, 0.097]  # the best equity is negative
    assert losses[4] == [0.0, 0.0, None]  # a wrong play that loses nothing; a bare equity is not a loss
    assert losses[5] == [0.17, 0.0, 0.285]
    wrong_but_free = quiz.problems[4].choices[0]
    assert wrong_but_free.correct is False and wrong_but_free.loss == 0.0
    assert unknown_losses(quiz) == [(2, 1, "Wrong"), (2, 3, "(+0.392)"), (2, 4, "("), (5, 3, "-0.310")]


def test_empty_images_and_descriptions_become_none():
    data = synthetic()
    data["problems"][1]["choices"][0]["description"] = "  "
    quiz = parse_quiz(data)
    assert quiz.problems[1].choices[0].description is None and quiz.problems[1].choices[0].image_url is None


@pytest.mark.parametrize(
    "text, correct, bare, loss",
    [
        ("(-0.062)", False, False, 0.062),
        ("( -0.5 )", False, False, 0.5),
        ("(-0.000)", False, False, 0.0),
        ("-0.049", False, True, 0.049),
        ("-0.049", False, False, None),
        ("(+0.392)", False, False, None),
        ("Wrong", False, False, None),
        ("(", False, False, None),
        ("(-0.1", False, False, None),
        (None, False, False, None),
        ("+0.458", True, False, 0.0),
        ("Double +0.797", True, False, 0.0),
    ],
)
def test_parse_loss(text, correct, bare, loss):
    assert parse_loss(text, correct=correct, bare_differences=bare) == loss


def test_answer_kind():
    plays = ["24/14", "Bar/20 13/10", "16/13* 7/1", "7/2 6/1 5/Off(2)", "4/3 4/Off", "24/18*/14", "6/4(2)", "bar/22*(2)"]
    assert answer_kind(plays) == "checker"
    cube = [
        "No double", "No Double / Take", "Clear No double", "No Redouble", "Double/Take", "Double / Take",
        "Redouble/Take", "Redouble / Take", "Borderline Double", "Double/Pass", "Double / Pass",
        "Double / Clear Pass", "Redouble/Pass", "Redouble / Pass", "Borderline Take/Pass", "Too good/Pass",
        "Too Good / Pass", "Too good to double / Pass",
    ]
    assert answer_kind(cube) == "cube"
    with pytest.raises(QuizError, match="mix"):
        answer_kind(["13/10", "No double"])
    with pytest.raises(QuizError, match="neither"):
        answer_kind(["13/10", "resign"])


def test_collection_from_name():
    assert collection_from_name("Medium - Lesson 1 - Double 5s Blitzes.json") == "Medium"
    assert collection_from_name("Hard - BGWC Quiz 1.json") == "Hard"
    assert collection_from_name(r"C:\Temp\bg\Hard - Prime or Blitz.json") == "Hard"
    assert collection_from_name("Lesson 1 - Foo.json") is None
    assert collection_from_name("Hard -x.json") is None
    assert collection_from_name("quiz.json") is None


def test_image_file():
    assert image_file(1) == "p01.png"
    assert image_file(12, 3) == "p12-c3.png"


def _set(path, value):
    def mutate(data):
        target = data
        for key in path[:-1]:
            target = target[key]
        if value is _DELETE:
            del target[path[-1]]
        else:
            target[path[-1]] = value

    return mutate


_DELETE = object()


@pytest.mark.parametrize(
    "mutate, message",
    [
        (_set(["type"], "survey"), "not supported"),
        (_set(["problems"], []), "no problems"),
        (_set(["problemsCount"], 12), "6 of the quiz's 12"),
        (_set(["id"], "../etc"), "not a Galaxy id"),
        (_set(["name"], " "), "missing name"),
        (_set(["problems", 0, "correctAnswerId"], None), "no correct answer"),
        (_set(["problems", 0, "correctAnswerId"], "c00000000000000000000999"), "not among the choices"),
        (_set(["problems", 0, "choices"], []), "choices"),
        (_set(["problems", 0, "choices", 0, "answer"], " "), "missing answer"),
        (_set(["problems", 0, "choices", 0, "answer"], "No double"), "mix"),
        (_set(["problems", 0, "choices", 1, "id"], "c00000000000000000000101"), "appears twice"),
        (_set(["problems", 1, "id"], "b00000000000000000000001"), "appears twice"),
        (_set(["problems", 0, "imageURL"], None), "no position image"),
        (_set(["problems", 0, "imageURL"], "http://cdn-quizzes.backgammongalaxy.com/x/1.png"), "not a PNG on https"),
        (_set(["problems", 0, "imageURL"], "https://example.com/x/1.png"), "not a PNG on https"),
        (_set(["problems", 0, "imageURL"], "https://cdn-quizzes.backgammongalaxy.com/x/1.gif"), "not a PNG on https"),
        (_set(["problems", 0, "imageURL"], "https://cdn-quizzes.backgammongalaxy.com/x/a b.png"), "not a plain URL"),
        (_set(["problems", 0, "choices", 0, "imageURL"], "https://evil.example/1.png"), "not a PNG on https"),
        (_set(["problems", 0, "analysis"], 42), "analysis is not text"),
        (_set(["problems", 0, "choices", 0, "description"], 1.5), "description is not text"),
    ],
)
def test_refuses_unexpected_exports(mutate, message):
    data = synthetic()
    mutate(data)
    with pytest.raises(QuizError, match=message):
        parse_quiz(data)


def test_refuses_non_objects():
    with pytest.raises(QuizError, match="JSON object"):
        parse_quiz([])
