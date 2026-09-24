"""XGID parsing/formatting and perspective views.

Mirrors ``src/lib/xgid.ts`` and ``src/lib/board.ts`` in the app; keep the two in sync.

Layout: ``[XGID=]<pos>:<cube>:<owner>:<turn>:<dice>:<score1>:<score2>:<cj>:<len>:<maxcube>``.
The 26-character position has player 2's bar at index 0, points 1..24 numbered from
player 1's side (1 = player 1's ace point) and player 1's bar at index 25. Uppercase letters
are player 1's checkers, lowercase player 2's; borne-off checkers are implied.
"""

from __future__ import annotations

import dataclasses
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - moves imports this module
    from .moves import State

CHECKERS_PER_SIDE = 15
BOARD_LEN = 26
P2_BAR = 0
P1_BAR = 25
BAR_POINT = 25
OFF_POINT = 0


class XgidError(ValueError):
    """Malformed XGID."""


@dataclass(frozen=True)
class Position:
    """Absolute position, exactly as the XGID encodes it."""

    board: tuple[int, ...]
    """Length 26, signed: +n = player 1 checkers, -n = player 2 checkers."""
    cube_value: int
    cube_owner: int
    """0 = centered, 1 = player 1, 2 = player 2."""
    turn: int
    dice: tuple[int, int] | None
    cube_action: str
    """'none', 'double', 'beaver' or 'raccoon'."""
    score: tuple[int, int]
    match_length: int
    crawford: bool
    jacoby: bool
    beavers: bool
    max_cube: int


def strip_prefix(s: str) -> str:
    return re.sub(r"^xgid=", "", s.strip(), flags=re.IGNORECASE)


def _int_field(field: str, name: str, lo: int, hi: int | None = None) -> int:
    if not re.fullmatch(r"-?\d+", field):
        raise XgidError(f"{name}: expected an integer, got {field!r}")
    n = int(field)
    if n < lo or (hi is not None and n > hi):
        raise XgidError(f"{name}: {n} is out of range")
    return n


def _parse_board(pos: str) -> tuple[int, ...]:
    if len(pos) != BOARD_LEN:
        raise XgidError(f"position must be {BOARD_LEN} characters, got {len(pos)}")
    board = [0] * BOARD_LEN
    p1 = p2 = 0
    for i, ch in enumerate(pos):
        if ch == "-":
            continue
        if "A" <= ch <= "P":
            n = ord(ch) - 64
            board[i] = n
            p1 += n
        elif "a" <= ch <= "p":
            n = ord(ch) - 96
            board[i] = -n
            p2 += n
        else:
            raise XgidError(f"invalid character {ch!r} at position index {i}")
    if board[P2_BAR] > 0:
        raise XgidError("index 0 is the player 2 bar; it cannot hold player 1 checkers")
    if board[P1_BAR] < 0:
        raise XgidError("index 25 is the player 1 bar; it cannot hold player 2 checkers")
    if p1 > CHECKERS_PER_SIDE:
        raise XgidError(f"player 1 has {p1} checkers on the board (max {CHECKERS_PER_SIDE})")
    if p2 > CHECKERS_PER_SIDE:
        raise XgidError(f"player 2 has {p2} checkers on the board (max {CHECKERS_PER_SIDE})")
    return tuple(board)


def parse_xgid(text: str) -> Position:
    fields = strip_prefix(text).split(":")
    if len(fields) != 10:
        raise XgidError(f"expected 10 colon-separated fields, got {len(fields)}")
    pos, cube_f, owner_f, turn_f, dice_f, s1_f, s2_f, cj_f, len_f, max_f = fields
    board = _parse_board(pos)
    cube_exp = _int_field(cube_f, "cube", 0, 30)
    owner = _int_field(owner_f, "cube owner", -1, 1)
    turn = _int_field(turn_f, "turn", -1, 1)
    if turn == 0:
        raise XgidError("turn must be 1 or -1")

    dice: tuple[int, int] | None = None
    cube_action = "none"
    d = dice_f.upper()
    if d in ("", "00"):
        pass
    elif d == "D":
        cube_action = "double"
    elif d == "B":
        cube_action = "beaver"
    elif d == "R":
        cube_action = "raccoon"
    elif re.fullmatch(r"[1-6]{2}", d):
        dice = (int(d[0]), int(d[1]))
    else:
        raise XgidError(f"dice: expected 00, two digits 1-6, D, B or R, got {dice_f!r}")

    score1 = _int_field(s1_f, "score 1", 0)
    score2 = _int_field(s2_f, "score 2", 0)
    cj = _int_field(cj_f, "crawford/jacoby", 0, 3)
    match_length = _int_field(len_f, "match length", 0)
    max_exp = _int_field(max_f, "max cube", 0, 30)
    is_match = match_length > 0
    return Position(
        board=board,
        cube_value=2**cube_exp,
        cube_owner=0 if owner == 0 else (1 if owner == 1 else 2),
        turn=1 if turn == 1 else 2,
        dice=dice,
        cube_action=cube_action,
        score=(score1, score2),
        match_length=match_length,
        crawford=is_match and bool(cj & 1),
        jacoby=(not is_match) and bool(cj & 1),
        beavers=(not is_match) and bool(cj & 2),
        max_cube=2**max_exp,
    )


def _log2_exact(n: int, name: str) -> int:
    e = n.bit_length() - 1
    if n <= 0 or 2**e != n:
        raise XgidError(f"{name}: {n} is not a power of two")
    return e


def to_xgid(pos: Position) -> str:
    if len(pos.board) != BOARD_LEN:
        raise XgidError(f"board must have {BOARD_LEN} entries")
    chars = []
    for i, v in enumerate(pos.board):
        if v == 0:
            chars.append("-")
        elif v > 0:
            if v > 16:
                raise XgidError(f"too many checkers ({v}) at index {i}")
            chars.append(chr(64 + v))
        else:
            if v < -16:
                raise XgidError(f"too many checkers ({-v}) at index {i}")
            chars.append(chr(96 - v))
    owner = 0 if pos.cube_owner == 0 else (1 if pos.cube_owner == 1 else -1)
    turn = 1 if pos.turn == 1 else -1
    if pos.dice:
        dice = f"{pos.dice[0]}{pos.dice[1]}"
    else:
        dice = {"double": "D", "beaver": "B", "raccoon": "R"}.get(pos.cube_action, "00")
    if pos.match_length > 0:
        cj = 1 if pos.crawford else 0
    else:
        cj = (1 if pos.jacoby else 0) | (2 if pos.beavers else 0)
    return ":".join(
        str(x)
        for x in (
            "".join(chars),
            _log2_exact(pos.cube_value, "cube"),
            owner,
            turn,
            dice,
            pos.score[0],
            pos.score[1],
            cj,
            pos.match_length,
            _log2_exact(pos.max_cube, "max cube"),
        )
    )


def opponent(player: int) -> int:
    return 2 if player == 1 else 1


def decision_kind(pos: Position) -> str:
    """'checker', 'cube-double' (player on roll may double) or 'cube-take' (a double was offered)."""
    if pos.dice:
        return "checker"
    if pos.cube_action != "none":
        return "cube-take"
    return "cube-double"


def acting_player(pos: Position) -> int:
    """The player who has to act: the player on roll, or the opponent when a double is offered."""
    if pos.cube_action in ("double", "raccoon"):
        return opponent(pos.turn)
    return pos.turn


@dataclass
class View:
    """The board from one player's side. points[i] for i in 1..24 = my point i; + mine, - theirs."""

    me: int
    them: int
    points: list[int]
    my_bar: int
    their_bar: int
    my_off: int
    their_off: int
    my_pips: int
    their_pips: int


def _finish_view(me: int, points: list[int], my_bar: int, their_bar: int) -> View:
    mine = my_bar
    theirs = their_bar
    my_pips = BAR_POINT * my_bar
    their_pips = BAR_POINT * their_bar
    for i in range(1, 25):
        v = points[i]
        if v > 0:
            mine += v
            my_pips += v * i
        elif v < 0:
            theirs += -v
            their_pips += -v * (25 - i)
    return View(
        me=me,
        them=opponent(me),
        points=points,
        my_bar=my_bar,
        their_bar=their_bar,
        my_off=CHECKERS_PER_SIDE - mine,
        their_off=CHECKERS_PER_SIDE - theirs,
        my_pips=my_pips,
        their_pips=their_pips,
    )


def to_perspective(pos: Position, me: int) -> View:
    points = [0] * 25
    if me == 1:
        for i in range(1, 25):
            points[i] = pos.board[i]
        my_bar = pos.board[P1_BAR]
        their_bar = -pos.board[P2_BAR]
    else:
        for i in range(1, 25):
            points[i] = -pos.board[25 - i]
        my_bar = -pos.board[P2_BAR]
        their_bar = pos.board[P1_BAR]
    return _finish_view(me, points, my_bar, their_bar)


def acting_view(pos: Position) -> View:
    return to_perspective(pos, acting_player(pos))


def with_state(pos: Position, me: int, state: State) -> Position:
    """The position with the board replaced by ``state`` (a ``moves.State`` in ``me``'s
    numbering). Inverse of ``to_perspective`` + ``state_from_view``; other fields are kept."""
    board = [0] * BOARD_LEN
    if me == 1:
        for i in range(1, 25):
            board[i] = state.points[i]
        board[P1_BAR] = state.my_bar
        board[P2_BAR] = -state.their_bar
    else:
        for i in range(1, 25):
            board[25 - i] = -state.points[i]
        board[P2_BAR] = -state.my_bar
        board[P1_BAR] = state.their_bar
    return dataclasses.replace(pos, board=tuple(board))


def view_from_counts(
    mine: dict[int, int] | None = None,
    theirs: dict[int, int] | None = None,
    my_bar: int = 0,
    their_bar: int = 0,
    me: int = 1,
) -> View:
    """Build a view directly from counts (tests, hand-made positions)."""
    points = [0] * 25
    for p, n in (mine or {}).items():
        if not 1 <= p <= 24:
            raise ValueError(f"bad point {p}")
        points[p] += n
    for p, n in (theirs or {}).items():
        if not 1 <= p <= 24:
            raise ValueError(f"bad point {p}")
        if points[p] > 0 and n > 0:
            raise ValueError(f"point {p} has checkers of both players")
        points[p] -= n
    return _finish_view(me, points, my_bar, their_bar)


def pip_counts(pos: Position) -> tuple[int, int]:
    v = to_perspective(pos, 1)
    return v.my_pips, v.their_pips
