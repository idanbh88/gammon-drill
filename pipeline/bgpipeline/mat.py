"""Jellyfish-style ``.mat`` match files, as exported by Backgammon Galaxy, XG and gnubg.

The format has no formal definition, so this follows the rules of gnubg's own importer
(``import.c``, ``ImportGame`` / ``ParseMatMove``):

- ``; [Key "Value"]`` header lines carry metadata (Site, Match ID, Player 1, Player 2,
  EventDate, EventTime, CubeLimit, ...). ``N point match`` gives the length (0 = money).
- `` Game N`` starts a game; the next non-blank line is the score line
  ``name : n   name : n`` with the score at the start of the game.
- A move line holds both players' records: when both rolled (two colons) the left half ends
  three characters before the second colon; otherwise, for lines longer than 15 characters,
  the halves are split at the first double space after column 15. The left half starts after
  the ``N)`` move number. An empty half is no record.
- A half is one of: ``dd: plays`` (``13/9 24/23``; bar written as 25, off as 0; a hit may or
  may not carry ``*``; repeated tokens instead of ``(2)``; no plays = no legal move),
  ``Doubles => N``, ``Takes``, ``Drops``, ``Wins N point(s) ...``, ``Resigns`` (ignored).
  Beavers/raccoons and Snowie "illegal play" records are refused; anything else is an error
  that names the line, so an unexpected export format cannot be imported silently wrong.

Plays are normalised to the gnubg notation the rest of the pipeline uses (``bar/22 22/21``,
``6/off``), in the mover's own numbering, which is how ``.mat`` files write them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_TAG = re.compile(r'^\s*;\s*\[(?P<key>[^"\]]+?)\s+"(?P<value>[^"]*)"\s*\]\s*$')
_LENGTH = re.compile(r"^\s*(?P<n>\d+)\s+point\s+match\b", re.IGNORECASE)
_GAME = re.compile(r"^\s*Game\s+(?P<n>\d+)\s*$", re.IGNORECASE)
_SCORE = re.compile(r"^\s*(?P<p1>[^:]+?)\s*:\s*(?P<s1>\d+)\s+(?P<p2>[^:]+?)\s*:\s*(?P<s2>\d+)\s*$")
_DICE = re.compile(r"^(?P<a>[1-6])(?P<b>[1-6]):(?P<rest>.*)$")
_DOUBLE = re.compile(r"^doubles?\b(?:\s*=>\s*(?P<to>\d+))?", re.IGNORECASE)
_WIN = re.compile(r"^wins?\s+(?P<n>\d+)", re.IGNORECASE)
_POINT = re.compile(r"^(?:\d{1,2}|bar|off)$", re.IGNORECASE)


class MatError(ValueError):
    """The file could not be read; ``line_no`` is 1-based."""

    def __init__(self, line_no: int, message: str):
        super().__init__(f"line {line_no}: {message}")
        self.line_no = line_no
        self.message = message


@dataclass(frozen=True)
class MatHeader:
    site: str | None
    match_id: str | None
    player1: str
    player2: str
    date: str | None
    """As written, e.g. ``2026.09.03``."""
    time: str | None
    """As written, e.g. ``18.37``."""
    cube_limit: int | None
    tags: dict[str, str]


@dataclass(frozen=True)
class HalfMove:
    player: int
    """1 = left column, 2 = right column."""
    line_no: int
    move_no: int | None
    action: str
    """``move`` | ``double`` | ``take`` | ``drop`` | ``win``."""
    dice: tuple[int, int] | None = None
    plays: str = ""
    """Normalised notation in the mover's numbering; empty = no play recorded."""
    cube_to: int | None = None
    points: int | None = None
    raw: str = ""


@dataclass
class MatGame:
    number: int
    score: tuple[int, int]
    """Score at the start of the game (player 1, player 2)."""
    line_no: int
    half_moves: list[HalfMove] = field(default_factory=list)


@dataclass
class MatMatch:
    header: MatHeader
    match_length: int
    games: list[MatGame]
    text: str


def _normalise_plays(rest: str, line_no: int) -> str:
    tokens = []
    for token in rest.split():
        hit = token.endswith("*")
        body = token[:-1] if hit else token
        parts = body.split("/")
        if len(parts) < 2 or not all(_POINT.match(p) for p in parts):
            raise MatError(line_no, f"bad move token {token!r}")
        names = []
        for k, p in enumerate(parts):
            low = p.lower()
            if low in ("bar", "off"):
                names.append(low)
                continue
            n = int(p)
            if n == 25 and k == 0:
                names.append("bar")
            elif n == 0 and k == len(parts) - 1:
                names.append("off")
            elif 1 <= n <= 24:
                names.append(str(n))
            else:
                raise MatError(line_no, f"point out of range in {token!r}")
        tokens.append("/".join(names) + ("*" if hit else ""))
    return " ".join(tokens)


def _parse_half(text: str, player: int, line_no: int, move_no: int | None) -> HalfMove | None:
    s = text.strip()
    if not s:
        return None
    m = _DICE.match(s)
    if m:
        rest = m.group("rest").strip()
        low = rest.lower()
        if low.startswith("???") or low.startswith("cannot move"):
            rest = ""
        elif low.startswith("illegal play"):
            raise MatError(line_no, "Snowie 'illegal play' records are not supported")
        return HalfMove(
            player=player,
            line_no=line_no,
            move_no=move_no,
            action="move",
            dice=(int(m.group("a")), int(m.group("b"))),
            plays=_normalise_plays(rest, line_no),
            raw=s,
        )
    low = s.lower()
    if low.startswith("double"):
        dm = _DOUBLE.match(s)
        to = int(dm.group("to")) if dm and dm.group("to") else None
        return HalfMove(player=player, line_no=line_no, move_no=move_no, action="double", cube_to=to, raw=s)
    if low.startswith("beaver") or low.startswith("raccoon"):
        raise MatError(line_no, f"beavers are not supported ({s!r})")
    if low.startswith("take"):
        return HalfMove(player=player, line_no=line_no, move_no=move_no, action="take", raw=s)
    if low.startswith("drop"):
        return HalfMove(player=player, line_no=line_no, move_no=move_no, action="drop", raw=s)
    if low.startswith("win"):
        wm = _WIN.match(s)
        if not wm:
            raise MatError(line_no, f"cannot read the points in {s!r}")
        return HalfMove(player=player, line_no=line_no, move_no=move_no, action="win", points=int(wm.group("n")), raw=s)
    if low.startswith("resign"):
        return None
    raise MatError(line_no, f"unrecognised record {s!r}")


def split_halves(line: str) -> tuple[str, str | None]:
    """Split a move line into the two players' halves the way gnubg does. The left half still
    carries the ``N)`` move number."""
    body = line.rstrip("\r\n")
    c1 = body.find(":")
    c2 = body.find(":", c1 + 1) if c1 >= 0 else -1
    if c1 >= 0 and c2 > 3:
        return body[: c2 - 3], body[c2 - 2 :]
    if len(body) > 15:
        k = body.find("  ", 15)
        if k >= 0:
            return body[:k], body[k + 1 :]
    return body, None


def parse_move_line(line: str, line_no: int) -> list[HalfMove]:
    left, right = split_halves(line)
    move_no: int | None = None
    paren = left.find(")")
    if paren >= 0:
        num = left[:paren].strip()
        if num.isdigit():
            move_no = int(num)
        left = left[paren + 1 :]
    out = []
    h = _parse_half(left, 1, line_no, move_no)
    if h:
        out.append(h)
    if right is not None:
        h = _parse_half(right, 2, line_no, move_no)
        if h:
            out.append(h)
    return out


def parse_mat(text: str) -> MatMatch:
    lines = text.lstrip("﻿").splitlines()
    n = len(lines)
    tags: dict[str, str] = {}
    match_length: int | None = None
    i = 0
    while i < n:
        line = lines[i]
        tm = _TAG.match(line)
        if tm:
            tags[tm.group("key").strip()] = tm.group("value")
        elif line.lstrip().startswith(";") or not line.strip():
            pass
        elif _LENGTH.match(line):
            match_length = int(_LENGTH.match(line).group("n"))  # type: ignore[union-attr]
        elif _GAME.match(line):
            break
        else:
            raise MatError(i + 1, f"unexpected line before the first game: {line.strip()!r}")
        i += 1
    if match_length is None:
        raise MatError(min(i, n - 1) + 1 if n else 1, "no 'N point match' line")

    games: list[MatGame] = []
    names: tuple[str, str] | None = None
    while i < n:
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        gm = _GAME.match(line)
        if not gm:
            raise MatError(i + 1, f"expected ' Game N', got {line.strip()!r}")
        game_line = i + 1
        i += 1
        while i < n and not lines[i].strip():
            i += 1
        if i >= n:
            raise MatError(game_line, "game has no score line")
        sm = _SCORE.match(lines[i])
        if not sm:
            raise MatError(i + 1, f"expected a score line 'name : n   name : n', got {lines[i].strip()!r}")
        if names is None:
            names = (sm.group("p1").strip(), sm.group("p2").strip())
        game = MatGame(int(gm.group("n")), (int(sm.group("s1")), int(sm.group("s2"))), game_line)
        games.append(game)
        i += 1
        while i < n:
            line = lines[i]
            if _GAME.match(line):
                break
            if line.strip() and not line.lstrip().startswith(";"):
                game.half_moves.extend(parse_move_line(line, i + 1))
            i += 1
    if not games:
        raise MatError(n, "no games")

    limit = tags.get("CubeLimit")
    header = MatHeader(
        site=tags.get("Site"),
        match_id=tags.get("Match ID"),
        player1=tags.get("Player 1") or (names[0] if names else "Player 1"),
        player2=tags.get("Player 2") or (names[1] if names else "Player 2"),
        date=tags.get("EventDate"),
        time=tags.get("EventTime"),
        cube_limit=int(limit) if limit and limit.isdigit() else None,
        tags=tags,
    )
    return MatMatch(header, match_length, games, text)
