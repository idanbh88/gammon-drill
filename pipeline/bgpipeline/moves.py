"""Legal-play generation and move notation, in the acting player's numbering
(24 = farthest point, 1 = ace point, 25 = bar, 0 = off). Port of ``src/lib/moves.ts``.

Plays are identified by their resulting position, so ``13/10 10/7`` and ``13/7`` are the
same play; ``is_legal_play`` validates notation the same way.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .xgid import BAR_POINT, OFF_POINT, View


@dataclass(frozen=True)
class Step:
    src: int
    """25 = bar, otherwise 1..24."""
    dst: int
    """0 = off, otherwise 1..24."""
    hit: bool = False


@dataclass
class State:
    points: list[int]
    my_bar: int
    their_bar: int
    my_off: int
    their_off: int

    def copy(self) -> "State":
        return State(list(self.points), self.my_bar, self.their_bar, self.my_off, self.their_off)

    def key(self) -> tuple:
        return (tuple(self.points[1:]), self.my_bar, self.their_bar)


@dataclass
class Play:
    steps: list[Step]
    notation: str
    result: State
    dice_used: list[int] = field(default_factory=list)


def state_from_view(view: View) -> State:
    return State(list(view.points), view.my_bar, view.their_bar, view.my_off, view.their_off)


def _all_in_home(s: State) -> bool:
    if s.my_bar > 0:
        return False
    return all(s.points[i] <= 0 for i in range(7, 25))


def _highest_point(s: State) -> int:
    for i in range(24, 0, -1):
        if s.points[i] > 0:
            return i
    return 0


def _try_step(s: State, src: int, die: int) -> tuple[State, Step] | None:
    if s.my_bar > 0 and src != BAR_POINT:
        return None
    if src == BAR_POINT:
        if s.my_bar == 0:
            return None
    elif src < 1 or src > 24 or s.points[src] <= 0:
        return None
    dst = src - die
    if dst >= 1:
        if s.points[dst] < -1:
            return None
        nxt = s.copy()
        if src == BAR_POINT:
            nxt.my_bar -= 1
        else:
            nxt.points[src] -= 1
        hit = False
        if nxt.points[dst] == -1:
            hit = True
            nxt.points[dst] = 1
            nxt.their_bar += 1
        else:
            nxt.points[dst] += 1
        return nxt, Step(src, dst, hit)
    # bearing off
    if src == BAR_POINT or not _all_in_home(s):
        return None
    if dst < 0 and _highest_point(s) != src:
        return None
    nxt = s.copy()
    nxt.points[src] -= 1
    nxt.my_off += 1
    return nxt, Step(src, OFF_POINT, False)


def _dfs(state: State, order: list[int], idx: int, steps: list[Step], dice: list[int], out: list) -> None:
    if idx == len(order):
        out.append((steps, dice, state))
        return
    die = order[idx]
    moved = False
    sources = [BAR_POINT] if state.my_bar > 0 else [i for i in range(24, 0, -1) if state.points[i] > 0]
    for src in sources:
        r = _try_step(state, src, die)
        if r is None:
            continue
        moved = True
        _dfs(r[0], order, idx + 1, steps + [r[1]], dice + [die], out)
    if not moved:
        out.append((steps, dice, state))


def _complete_sequences(view: View, dice: tuple[int, int]) -> list[tuple[list[Step], list[int], State]]:
    """Every complete legal step sequence in every order (both-dice / larger-die rule applied)."""
    start = state_from_view(view)
    a, b = dice
    sequences: list[tuple[list[Step], list[int], State]] = []
    orders = [[a, a, a, a]] if a == b else [[a, b], [b, a]]
    for order in orders:
        _dfs(start, order, 0, [], [], sequences)
    max_steps = max(len(s[0]) for s in sequences)
    if max_steps == 0:
        return []
    candidates = [s for s in sequences if len(s[0]) == max_steps]
    if max_steps == 1 and a != b:
        big = max(a, b)
        with_big = [s for s in candidates if s[1][0] == big]
        if with_big:
            candidates = with_big
    return candidates


def legal_sequences(view: View, dice: tuple[int, int]) -> list[tuple[list[Step], list[int]]]:
    """Every legal play as (steps, die per step) in every order it can be entered (not
    de-duplicated by result); port of ``legalSequences`` in moves.ts. Empty = no legal move."""
    return [(steps, used) for steps, used, _state in _complete_sequences(view, dice)]


def generate_plays(view: View, dice: tuple[int, int]) -> list[Play]:
    """All distinct legal plays; empty list = no legal move. Applies the both-dice / larger-die rule."""
    seen: dict[tuple, Play] = {}
    for steps, used, state in _complete_sequences(view, dice):
        k = state.key()
        if k in seen:
            continue
        seen[k] = Play(steps, format_play(steps), state, used)
    return list(seen.values())


def _point_name(p: int) -> str:
    if p == BAR_POINT:
        return "bar"
    if p == OFF_POINT:
        return "off"
    return str(p)


def format_play(steps: list[Step]) -> str:
    """gnubg-style notation: ``24/18* 13/10``, ``8/5(2) 6/5(2)``, ``24/18*/13``."""
    tokens: list[tuple[list[int], list[bool]]] = []
    for st in steps:
        merged = False
        for pts, hits in reversed(tokens):
            if pts[-1] == st.src and st.src != OFF_POINT:
                if hits[-1]:
                    pts.append(st.dst)
                    hits.append(st.hit)
                else:
                    pts[-1] = st.dst
                    hits[-1] = st.hit
                merged = True
                break
        if not merged:
            tokens.append(([st.src, st.dst], [False, st.hit]))
    texts = ["/".join(_point_name(p) + ("*" if h else "") for p, h in zip(pts, hits)) for pts, hits in tokens]
    counts: dict[str, list] = {}
    for text, (pts, _) in zip(texts, tokens):
        if text in counts:
            counts[text][2] += 1
        else:
            counts[text] = [pts[0], pts[-1], 1]
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1][0], -kv[1][1]))
    return " ".join(f"{text}({n})" if n > 1 else text for text, (_, _, n) in ordered)


class NotationError(ValueError):
    """Malformed move notation."""


def _parse_point(raw: str) -> tuple[int, bool]:
    s = raw.strip().lower()
    hit = s.endswith("*")
    if hit:
        s = s[:-1]
    if s in ("bar", "b"):
        return BAR_POINT, hit
    if s in ("off", "o"):
        return OFF_POINT, hit
    if not re.fullmatch(r"\d{1,2}", s):
        raise NotationError(f"bad point {raw!r}")
    p = int(s)
    if not 1 <= p <= 24:
        raise NotationError(f"point out of range {raw!r}")
    return p, hit


def parse_play(notation: str) -> list[Step]:
    steps: list[Step] = []
    for token in notation.split():
        m = re.fullmatch(r"(.+?)(?:\((\d+)\))?", token)
        if not m:
            raise NotationError(f"bad token {token!r}")
        count = int(m.group(2)) if m.group(2) else 1
        if not 1 <= count <= 4:
            raise NotationError(f"bad repeat count in {token!r}")
        parts = m.group(1).split("/")
        if len(parts) < 2:
            raise NotationError(f"bad token {token!r}")
        pts = [_parse_point(p) for p in parts]
        if pts[0][1]:
            raise NotationError(f"origin cannot be a hit in {token!r}")
        for k in range(1, len(pts)):
            if pts[k - 1][0] == OFF_POINT:
                raise NotationError(f"cannot move from off in {token!r}")
            if pts[k][0] == BAR_POINT:
                raise NotationError(f"cannot move to the bar in {token!r}")
        for _ in range(count):
            for k in range(1, len(pts)):
                steps.append(Step(pts[k - 1][0], pts[k][0], pts[k][1]))
    return steps


def apply_steps(start: State, steps: list[Step]) -> State | None:
    """Apply steps mechanically (no dice check); None when a step is impossible on the board."""
    s = start.copy()
    for st in steps:
        if st.src == BAR_POINT:
            if s.my_bar == 0:
                return None
            s.my_bar -= 1
        else:
            if s.points[st.src] <= 0:
                return None
            s.points[st.src] -= 1
        if st.dst == OFF_POINT:
            s.my_off += 1
        else:
            if s.points[st.dst] < -1:
                return None
            if s.points[st.dst] == -1:
                s.points[st.dst] = 1
                s.their_bar += 1
            else:
                s.points[st.dst] += 1
    return s


def is_legal_play(view: View, dice: tuple[int, int], notation: str) -> bool:
    try:
        steps = parse_play(notation)
    except NotationError:
        return False
    plays = generate_plays(view, dice)
    if not steps:
        return not plays
    result = apply_steps(state_from_view(view), steps)
    if result is None:
        return False
    k = result.key()
    return any(p.result.key() == k for p in plays)
