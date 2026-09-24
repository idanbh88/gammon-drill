"""Backgammon Galaxy quiz exports: the JSON behind a finished quiz on backgammongalaxy.com.

A quiz is a list of multiple-choice problems whose positions exist only as pictures. Every
problem has a position image, two to four choices (a checker play or a cube action, written the
way Galaxy writes them) with Galaxy's equity text, the id of the correct choice and, in most
sets, the author's analysis. Checker choices usually carry a second picture: the position after
that play, with arrows.

``parse_quiz`` checks the shape and refuses anything unexpected, so a changed export format fails
loudly instead of importing half a set. The user's own Galaxy session (``userSession``,
``level``, ``selectedAnswerId``, ``isCorrect`` ...) is deliberately not read: the app keeps its
own progress. Answers and descriptions are kept exactly as written; the only interpretation is
``loss``, the equity a choice gives up, where Galaxy's text makes that unambiguous.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Sequence
from urllib.parse import urlsplit

SITE = "BackgammonGalaxy"  # spelled as matches.site (the .mat header)
CDN_HOST = "cdn-quizzes.backgammongalaxy.com"

_ID = re.compile(r"^[0-9a-f]{24}$")
_MOVE = r"(?:bar|\d{1,2})(?:/(?:\d{1,2}|off)\*?)+(?:\(\d\))?"
_CHECKER = re.compile(rf"^{_MOVE}(?:\s+{_MOVE})*$", re.IGNORECASE)
_CUBE = re.compile(r"double|take|pass|too good", re.IGNORECASE)
_NUMBER = re.compile(r"^(\()?\s*([+-]?\d+(?:\.\d+)?)\s*(\))?$")
_ZERO = re.compile(r"^[+-]?0(?:\.0+)?$")
_COLLECTION = re.compile(r"^([A-Za-z]+) - \S")
MIN_CHOICES, MAX_CHOICES = 2, 6


class QuizError(ValueError):
    pass


@dataclass(frozen=True)
class Choice:
    number: int  # 1-based, the order in the file (= display order)
    site_id: str
    answer: str
    description: str | None
    correct: bool
    loss: float | None
    image_url: str | None


@dataclass(frozen=True)
class Problem:
    number: int  # 1-based, the order in the file
    site_id: str
    kind: str  # "checker" | "cube"
    image_url: str
    analysis: str | None
    choices: tuple[Choice, ...]

    @property
    def problem_id(self) -> str:
        """The app's key for this problem (progress in localStorage)."""
        return f"lesson-{self.site_id}"


@dataclass(frozen=True)
class Quiz:
    site_id: str
    name: str
    author: str | None
    problems: tuple[Problem, ...]

    @property
    def checker_count(self) -> int:
        return sum(1 for p in self.problems if p.kind == "checker")

    @property
    def with_analysis(self) -> int:
        return sum(1 for p in self.problems if p.analysis)


def answer_kind(answers: Sequence[str]) -> str:
    """``checker`` when every answer is a play ("Bar/20 13/10", "7/2 6/1 5/Off(2)"), ``cube``
    when every answer is a cube action (any of Galaxy's spellings); anything else is refused."""
    kinds = set()
    for a in answers:
        if _CHECKER.match(a):
            kinds.add("checker")
        elif _CUBE.search(a):
            kinds.add("cube")
        else:
            raise QuizError(f"answer {a!r} is neither a checker play nor a cube action")
    if len(kinds) != 1:
        raise QuizError("the choices mix checker plays and cube actions: " + " | ".join(answers))
    return kinds.pop()


def parse_loss(description: str | None, *, correct: bool, bare_differences: bool) -> float | None:
    """The equity a choice gives up, from Galaxy's text, or None when the text does not say.

    The correct choice gives up nothing. Galaxy writes the others as the difference to the best,
    in parentheses ("(-0.062)"); a few sets write bare differences ("-0.049") and then the correct
    choice reads "0.000" (``bare_differences``); elsewhere a bare number is an equity, not a
    difference. A positive difference ("(+0.392)", from the doubler's side on a cube action the
    opponent would not choose) and text such as "Wrong" say nothing about the loss.
    """
    if correct:
        return 0.0
    m = _NUMBER.match((description or "").strip())
    if not m:
        return None
    opened, value, closed = m.group(1), float(m.group(2)), m.group(3)
    if bool(opened) != bool(closed):
        return None
    if not opened and not bare_differences:
        return None
    return round(abs(value), 6) if value <= 0 else None


def collection_from_name(file_name: str) -> str | None:
    """``Medium - Lesson 1 - Double 5s Blitzes.json`` -> ``Medium``: the group the export was
    filed under, when the file name starts with a single word followed by " - "."""
    base = re.split(r"[\\/]", file_name)[-1]
    m = _COLLECTION.match(base)
    return m.group(1) if m else None


def image_file(number: int, choice: int | None = None) -> str:
    """File name of a problem's position (``p01.png``) or of the position after one of its
    choices (``p01-c2.png``)."""
    base = f"p{number:02d}"
    return f"{base}.png" if choice is None else f"{base}-c{choice}.png"


def unknown_losses(quiz: Quiz) -> list[tuple[int, int, str | None]]:
    """(problem, choice, description) for every wrong choice whose loss is unknown."""
    return [(p.number, c.number, c.description) for p in quiz.problems for c in p.choices if c.loss is None]


def parse_quiz(data: object) -> Quiz:
    """Check a parsed export and turn it into a Quiz; QuizError says what is wrong."""
    if not isinstance(data, dict):
        raise QuizError("not a Galaxy quiz export (expected a JSON object)")
    quiz_id = _galaxy_id(data, "id", "the quiz")
    name = _text(data, "name", "the quiz")
    if data.get("type") != "mcq":
        raise QuizError(f"quiz type {data.get('type')!r} is not supported (only multiple choice, 'mcq')")
    raw_problems = data.get("problems")
    if not isinstance(raw_problems, list) or not raw_problems:
        raise QuizError("the quiz has no problems")
    count = data.get("problemsCount")
    if count is not None and count != len(raw_problems):
        raise QuizError(f"the file has {len(raw_problems)} of the quiz's {count} problems; export it again after finishing the quiz")
    author = data.get("createdBy")
    author = author.strip() if isinstance(author, str) and author.strip() else None

    problems: list[Problem] = []
    seen: set[str] = {quiz_id}
    if len(raw_problems) > 99:
        raise QuizError(f"{len(raw_problems)} problems; at most 99 are supported")
    for n, raw in enumerate(raw_problems, 1):
        where = f"problem {n}"
        if not isinstance(raw, dict):
            raise QuizError(f"{where}: not an object")
        pid = _galaxy_id(raw, "id", where)
        if pid in seen:
            raise QuizError(f"{where}: id {pid} appears twice")
        seen.add(pid)
        image = _image_url(raw.get("imageURL"), where)
        if image is None:
            raise QuizError(f"{where}: no position image")
        correct_id = raw.get("correctAnswerId")
        if not isinstance(correct_id, str) or not correct_id:
            raise QuizError(f"{where}: no correct answer (finish the quiz on Galaxy before exporting it)")
        raw_choices = raw.get("choices")
        if not isinstance(raw_choices, list) or not MIN_CHOICES <= len(raw_choices) <= MAX_CHOICES:
            raise QuizError(f"{where}: expected {MIN_CHOICES} to {MAX_CHOICES} choices")

        parsed = []
        for m, c in enumerate(raw_choices, 1):
            cwhere = f"{where}, choice {m}"
            if not isinstance(c, dict):
                raise QuizError(f"{cwhere}: not an object")
            cid = _galaxy_id(c, "id", cwhere)
            if cid in seen:
                raise QuizError(f"{cwhere}: id {cid} appears twice")
            seen.add(cid)
            desc = c.get("description")
            if desc is not None and not isinstance(desc, str):
                raise QuizError(f"{cwhere}: description is not text")
            desc = desc.strip() if desc and desc.strip() else None
            parsed.append((m, cid, _text(c, "answer", cwhere), desc, cid == correct_id, _image_url(c.get("imageURL"), cwhere)))
        right = [p for p in parsed if p[4]]
        if len(right) != 1:
            raise QuizError(f"{where}: the correct answer {correct_id} is not among the choices")
        bare = bool(right[0][3] and _ZERO.match(right[0][3]))
        choices = tuple(
            Choice(m, cid, answer, desc, ok, parse_loss(desc, correct=ok, bare_differences=bare), img)
            for m, cid, answer, desc, ok, img in parsed
        )
        try:
            kind = answer_kind([c.answer for c in choices])
        except QuizError as e:
            raise QuizError(f"{where}: {e}") from None
        analysis = raw.get("analysis")
        if analysis is not None and not isinstance(analysis, str):
            raise QuizError(f"{where}: analysis is not text")
        analysis = analysis.strip() if analysis and analysis.strip() else None
        problems.append(Problem(n, pid, kind, image, analysis, choices))
    return Quiz(quiz_id, name, author, tuple(problems))


def _text(obj: dict, key: str, where: str) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not value.strip():
        raise QuizError(f"{where}: missing {key}")
    return value.strip()


def _galaxy_id(obj: dict, key: str, where: str) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not _ID.match(value):
        raise QuizError(f"{where}: {key} {value!r} is not a Galaxy id (24 hex digits)")
    return value


def _image_url(value: object, where: str) -> str | None:
    """A picture on Galaxy's quiz CDN, kept exactly as given (the paths are already
    percent-encoded); None when there is no picture."""
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise QuizError(f"{where}: image URL is not text")
    if not value.isascii() or any(ch.isspace() for ch in value):
        raise QuizError(f"{where}: image URL {value!r} is not a plain URL")
    parts = urlsplit(value)
    if parts.scheme != "https" or parts.hostname != CDN_HOST or not parts.path.lower().endswith(".png"):
        raise QuizError(f"{where}: image {value} is not a PNG on https://{CDN_HOST}/")
    return value
