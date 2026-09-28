"""Assembly of Robertie's 501 problems (stage 4 of ``import_robertie.py``).

Inputs, all under the book folder (``data/robertie/``, git-ignored): the page index
(``pages.json``), Claude's page readings (``claude/page/``), both readings of every diagram (the
local reader's in ``readings/local.json``, Claude's in ``claude/board/``) and the hand-written
``fixes.json``. Output: one ``BookProblem`` per problem number with its chapter, caption, the
book's answer, the position as an XGID and a status:

- ``ok``: both readings agree and every check passes;
- ``fixed``: ``fixes.json`` gives the position (or overrides a field) and the checks pass;
- ``check``: something needs a look; ``issues`` says what.

The position is built the way the book draws it: Black is player 1 (uppercase) and on roll,
points in Black's numbering, White's checkers on Black's point k at index k. Money play without
the Jacoby rule (the book discusses positions too good to double), no beavers. The cube box
carries no number: centred means a 1-cube, a box by Black's side (bottom) a 2-cube Black owns,
by White's side (top) one White owns; for money play only the owner matters.

``fixes.json`` is written by hand and never by the pipeline:
``{"<n>": {"xgid": "...", "accept": "local"|"claude", "set": {"white": {"23": 1}, "white_bar": 0}, "play": "...", "cube": "double-take", "dice": "41", "exclude": true, "note": "..."}}``:
a whole position, or the reading to trust (optionally with points set by hand), or a corrected
answer, dice or caption field; the checks still run on the result.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .book_notation import cube_answer, normalise_play
from .moves import NotationError, generate_plays, is_legal_play
from .xgid import Position, XgidError, acting_view, parse_xgid, to_xgid

TOTAL = 501
MAX_CUBE = 1024
FIXES = "fixes.json"
LOCAL_READINGS = "readings/local.json"

# The app's categories (SPEC § 7) per chapter; chapters with none of their own are left to the
# classifier. Cube problems also get racing-cube or contact-cube from the classifier.
CHAPTER_CATEGORIES: dict[int, list[str]] = {
    5: ["opening"],
    6: ["early-game"],
    8: ["early-game"],
    9: ["blitz"],
    11: ["holding-game"],
    12: ["priming-game"],
    13: ["connectivity"],
    14: ["hit-or-not"],
    15: ["breaking-anchor"],
    16: ["crunch"],
    17: ["contact-cube"],
    18: ["blitz"],
    19: ["blitz"],
    20: ["contact-cube"],
    21: ["ace-point-game"],
    22: ["back-game"],
    23: ["containment"],
    24: ["ace-point-game"],
    27: ["bearing-off"],
    29: [],  # the race: racing-cube comes from the classifier for the cube problems
    30: ["bearing-off"],
}


@dataclass
class Counts:
    """One reading of a diagram, in the book's (Black's) point numbers."""

    black: dict[int, int]
    white: dict[int, int]
    black_bar: int = 0
    white_bar: int = 0
    black_off: int = 0
    white_off: int = 0
    cube: str = "middle"  # top / middle / bottom / none

    @classmethod
    def from_local(cls, d: dict) -> "Counts":
        return cls(
            {int(k): v for k, v in d["black"].items() if v},
            {int(k): v for k, v in d["white"].items() if v},
            d["black_bar"], d["white_bar"], d["black_off"], d["white_off"], d["cube_position"],
        )

    @classmethod
    def from_claude(cls, d: dict) -> "Counts":
        def pts(rows):
            out: dict[int, int] = {}
            for r in rows:
                if r["count"]:
                    out[int(r["point"])] = out.get(int(r["point"]), 0) + int(r["count"])
            return out

        return cls(pts(d["black"]), pts(d["white"]), d["black_bar"], d["white_bar"], d["black_off"], d["white_off"], d["cube_position"])

    def totals(self) -> tuple[int, int]:
        return (
            sum(self.black.values()) + self.black_bar + self.black_off,
            sum(self.white.values()) + self.white_bar + self.white_off,
        )

    def diff(self, other: "Counts") -> list[str]:
        """What differs, point by point (empty when the readings agree on the position; the cube
        compares by owner, so "none" and "middle" are equal)."""
        out = []
        for p in range(1, 25):
            a = (self.black.get(p, 0), self.white.get(p, 0))
            b = (other.black.get(p, 0), other.white.get(p, 0))
            if a != b:
                out.append(f"point {p}: {_desc(a)} / {_desc(b)}")
        for name in ("black_bar", "white_bar", "black_off", "white_off"):
            if getattr(self, name) != getattr(other, name):
                out.append(f"{name.replace('_', ' ')}: {getattr(self, name)} / {getattr(other, name)}")
        if _owner(self.cube) != _owner(other.cube):
            out.append(f"cube: {self.cube} / {other.cube}")
        return out


def _desc(pair: tuple[int, int]) -> str:
    b, w = pair
    if b and w:
        return f"{b} black + {w} white"
    if b:
        return f"{b} black"
    if w:
        return f"{w} white"
    return "empty"


def _owner(cube: str) -> int:
    return {"bottom": 1, "top": 2}.get(cube, 0)


def _patched(c: Counts, patch: dict) -> Counts:
    """A reading with some points (or bar, tray, cube) set by hand:
    {"white": {"23": 1}, "black": {"4": 0}, "white_bar": 0, "cube": "bottom"}."""
    black, white = dict(c.black), dict(c.white)
    for colour, counts in (("black", black), ("white", white)):
        for point, n in (patch.get(colour) or {}).items():
            if n:
                counts[int(point)] = int(n)
            else:
                counts.pop(int(point), None)
    return Counts(
        black, white,
        patch.get("black_bar", c.black_bar), patch.get("white_bar", c.white_bar),
        patch.get("black_off", c.black_off), patch.get("white_off", c.white_off),
        patch.get("cube", c.cube),
    )


def position_of(c: Counts, dice: str | None) -> Position:
    board = [0] * 26
    for p, n in c.black.items():
        board[p] += n
    for p, n in c.white.items():
        if board[p] > 0:
            raise ValueError(f"point {p} has checkers of both colours")
        board[p] -= n
    board[25] = c.black_bar
    board[0] = -c.white_bar
    owner = _owner(c.cube)
    return Position(
        board=tuple(board),
        cube_value=1 if owner == 0 else 2,
        cube_owner=owner,
        turn=1,
        dice=(int(dice[0]), int(dice[1])) if dice else None,
        cube_action="none",
        score=(0, 0),
        match_length=0,
        crawford=False,
        jacoby=False,
        beavers=False,
        max_cube=MAX_CUBE,
    )


@dataclass
class Solution:
    number: int
    text: str
    pages: list[str]
    plays: list[str] = field(default_factory=list)
    cubes: list[dict] = field(default_factory=list)


@dataclass
class BookProblem:
    number: int
    chapter: int | None
    chapter_title: str | None
    caption: str
    kind: str
    dice: str | None
    problem_page: str | None
    diagram: str | None
    solution_pages: list[str]
    solution: str | None
    play_as_printed: str | None
    cube_verdict: dict | None
    book_answer: str | None
    local: dict | None
    claude: dict | None
    xgid: str | None
    status: str
    issues: list[str]
    fix: dict | None

    @property
    def problem_id(self) -> str:
        return f"robertie-{self.number}"

    def to_json(self) -> dict:
        return asdict(self)


@dataclass
class Chapter:
    number: int
    title: str
    first_problem: int | None = None
    last_problem: int | None = None
    intro_page: str | None = None

    @property
    def categories(self) -> list[str]:
        return CHAPTER_CATEGORIES.get(self.number, [])


def load_fixes(book_dir: Path) -> dict[int, dict]:
    path = book_dir / FIXES
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {int(k): v for k, v in raw.items() if not k.startswith("_")}


def _join(a: str, b: str) -> str:
    a, b = a.rstrip(), b.lstrip()
    if not a:
        return b
    if a.endswith("-") and b[:1].islower():
        return a[:-1] + b
    return a + " " + b


_ON_BAR = re.compile(r"\bon (the )?bar\b", re.IGNORECASE)
_OPENING = re.compile(r"\bopening roll\b", re.IGNORECASE)
OPENING_BOARD = parse_xgid("-b----E-C---eE---c-e----B-:0:0:1:00:0:0:0:0:10").board


def assemble(book_dir: Path, pages: list, page_readings: dict[str, dict], local: dict[str, dict], claude_boards: dict[str, dict], fixes: dict[int, dict] | None = None):
    """(chapters, problems, notes): every problem 1..501 with its status. ``pages`` is the page
    index in book order; the readings are keyed by page name and diagram id."""
    fixes = fixes if fixes is not None else {}
    chapters: dict[int, Chapter] = {}
    captions: dict[int, dict] = {}
    solutions: dict[int, Solution] = {}
    notes: list[str] = []
    chapter = None
    last: Solution | None = None
    # Text at the top of a page continues the last solution of the page before, when that page
    # was read and ended in a solution (the reading's continues_on_next_page is not trusted: it
    # missed real run-ons). After a page that was not read, or on a page that opens a chapter
    # (its text is the chapter's introduction), it belongs to nothing known.
    runs_on = False
    for page in pages:
        r = page_readings.get(page.name)
        if r is None:
            if not page.blank:
                notes.append(f"{page.name}: no page reading")
            runs_on = False
            continue
        if r.get("chapter"):
            ch = r["chapter"]
            chapter = chapters.setdefault(ch["number"], Chapter(ch["number"], ch["title"].strip(), intro_page=page.name))
        diagrams = sorted((k for k in local if k.rsplit("-", 1)[0] == page.name), key=lambda k: int(k.rsplit("-", 1)[1]))
        probs = r.get("problems", [])
        if probs and len(probs) != len(diagrams):
            notes.append(f"{page.name}: {len(probs)} captions but {len(diagrams)} diagrams found")
        for i, p in enumerate(probs):
            n = p["number"]
            if n in captions:
                notes.append(f"problem {n}: caption on {captions[n]['page']} and {page.name}")
                continue
            captions[n] = {**p, "page": page.name, "diagram": diagrams[i] if len(probs) == len(diagrams) else None, "chapter": chapter}
            if chapter is not None:
                chapter.first_problem = n if chapter.first_problem is None else min(chapter.first_problem, n)
                chapter.last_problem = n if chapter.last_problem is None else max(chapter.last_problem, n)
        if r.get("chapter"):
            runs_on = False
        for s in r.get("solutions", []):
            if s["number"] is None:
                if last is None or not runs_on:
                    notes.append(f"{page.name}: continuation text without a solution before it on the previous page")
                    continue
                last.text = _join(last.text, s["text"])
                if page.name not in last.pages:
                    last.pages.append(page.name)
                target = last
            else:
                target = Solution(s["number"], s["text"].strip(), [page.name])
                if s["number"] in solutions:
                    notes.append(f"problem {s['number']}: two solutions ({solutions[s['number']].pages[0]} and {page.name})")
                solutions[s["number"]] = target
                last = target
            if s.get("play"):
                target.plays.append(s["play"])
            if s.get("cube"):
                target.cubes.append(s["cube"])
        runs_on = bool(r.get("solutions"))

    problems = []
    for n in range(1, TOTAL + 1):
        problems.append(_problem(n, captions.get(n), solutions.get(n), local, claude_boards, fixes.get(n)))
    return sorted(chapters.values(), key=lambda c: c.number), problems, notes


def _problem(n, cap, sol, local, claude_boards, fix) -> BookProblem:
    issues: list[str] = []
    fix = fix or {}
    ch = cap["chapter"] if cap else None
    kind = (cap or {}).get("kind") or "checker"
    dice = fix.get("dice") or (cap or {}).get("dice")
    diagram = (cap or {}).get("diagram")
    prob = BookProblem(
        number=n,
        chapter=ch.number if ch else None,
        chapter_title=ch.title if ch else None,
        caption=(cap or {}).get("caption", ""),
        kind=kind,
        dice=dice if kind == "checker" else None,
        problem_page=(cap or {}).get("page"),
        diagram=diagram,
        solution_pages=sol.pages if sol else [],
        solution=sol.text if sol else None,
        play_as_printed=(sol.plays[0] if sol and sol.plays else None),
        cube_verdict=(sol.cubes[0] if sol and sol.cubes else None),
        book_answer=None,
        local=local.get(diagram) if diagram else None,
        claude=claude_boards.get(diagram) if diagram else None,
        xgid=None,
        status="check",
        issues=issues,
        fix=fix or None,
    )
    if fix.get("exclude"):
        issues.append("excluded in fixes.json" + (f": {fix['note']}" if fix.get("note") else ""))
        return prob
    if cap is None:
        issues.append("no caption found")
    if sol is None:
        issues.append("no solution found")

    # The position: a fixed XGID, else the reading both readers agree on.
    pos = None
    if fix.get("xgid"):
        try:
            pos = parse_xgid(fix["xgid"])
        except XgidError as e:
            issues.append(f"fixes.json xgid: {e}")
    elif diagram is None:
        issues.append("diagram not found on the page")
    else:
        loc = Counts.from_local(prob.local) if prob.local else None
        cla = Counts.from_claude(prob.claude) if prob.claude else None
        chosen = None
        if fix.get("accept") == "local" and loc:
            chosen = loc
        elif fix.get("accept") == "claude" and cla:
            chosen = cla
        elif loc is None or cla is None:
            issues.append("only one reading of the diagram" if (loc or cla) else "no reading of the diagram")
        else:
            d = loc.diff(cla)
            if d:
                issues.append("readings differ (local / Claude): " + "; ".join(d))
            else:
                chosen = loc
        if chosen is not None and fix.get("set"):
            chosen = _patched(chosen, fix["set"])
        if chosen is not None:
            b, w = chosen.totals()
            if (b, w) != (15, 15):
                issues.append(f"checker totals black {b}, white {w}")
            try:
                pos = position_of(chosen, dice if kind == "checker" else None)
            except ValueError as e:
                issues.append(str(e))
    if pos is not None:
        if kind == "checker" and not pos.dice:
            issues.append("checker play without dice")
        if kind == "checker" and fix.get("xgid") and dice and pos.dice != (int(dice[0]), int(dice[1])):
            issues.append(f"fixes.json xgid dice {pos.dice} differ from the caption's {dice}")
        prob.xgid = to_xgid(pos)
        caption = prob.caption
        if _ON_BAR.search(caption) and pos.board[25] <= 0:
            issues.append("the caption says Black is on the bar, the reading has no Black checker there")
        if _OPENING.search(caption) and pos.board != OPENING_BOARD:
            issues.append("the caption says opening roll, the reading is not the opening position")
        if kind == "cube" and pos.cube_owner == 2:
            issues.append("a doubling question with the cube on White's side")

    # The book's answer, checked against the position. When the solution names more than one
    # play (a restatement, a part of it, a rejected alternative), the first that is a whole legal
    # play in the position is Robertie's answer; a disagreement between two legal ones is flagged.
    if kind == "checker" and sol and len(set(sol.plays)) > 1 and not fix.get("play"):
        legal = []
        if pos is not None and pos.dice:
            view = acting_view(pos)
            for text in sol.plays:
                try:
                    if is_legal_play(view, pos.dice, normalise_play(text)):
                        legal.append(text)
                except NotationError:
                    pass
        if legal:
            prob.play_as_printed = legal[0]
        if len({normalise_play(t) for t in legal}) > 1:
            issues.append(f"the solution states more than one legal play: {' | '.join(legal)}")
    if kind == "checker":
        text = fix.get("play") or prob.play_as_printed
        if not text:
            issues.append("the solution states no play")
        else:
            try:
                prob.book_answer = normalise_play(text)
            except NotationError as e:
                issues.append(f"the book's play {text!r} is not notation: {e}")
            if prob.book_answer and pos is not None and pos.dice:
                view = acting_view(pos)
                if len(generate_plays(view, pos.dice)) < 2:
                    issues.append("forced: fewer than two legal plays")
                if not is_legal_play(view, pos.dice, prob.book_answer):
                    issues.append(f"the book's play {prob.book_answer} is not legal in this position")
    else:
        if fix.get("cube"):
            prob.book_answer = fix["cube"]
        elif prob.cube_verdict:
            try:
                prob.book_answer = cube_answer(prob.cube_verdict["double"], prob.cube_verdict.get("take"))
            except ValueError as e:
                issues.append(str(e))
        else:
            issues.append("the solution gives no cube verdict")

    if not issues:
        prob.status = "fixed" if any(fix.get(k) for k in ("xgid", "accept", "set", "play", "cube", "dice")) else "ok"
    return prob
