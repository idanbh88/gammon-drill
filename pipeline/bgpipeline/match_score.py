"""Score what a player actually did against gnubg's ranking of the same position.

Checker plays are located in gnubg's complete candidate list by resulting position (the file
may write ``13/10 10/7`` where gnubg says ``13/7``); the loss is the best equity minus the
played equity. Cube decisions charge only the half the player decided: a double is scored as
the cheaper of ``double-take`` / ``double-pass``, a non-double as the cheaper of ``no-double`` /
``too-good``, a take or pass as itself (see SPEC § 5 for the joint-answer loss rule).

Anything that cannot be scored (gnubg failed on the position, the played move is missing from
the list) becomes an unscored decision with a warning, never a failed import.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from .classify import apply_classification
from .gnubg_parse import CLASS_NAMES, ParseError, build_problem
from .moves import NotationError, apply_steps, parse_play, state_from_view
from .replay import Decision
from .xgid import acting_view, parse_xgid


@dataclass
class Scored:
    answers: list[dict] = field(default_factory=list)
    """Ranked answers (Problem shape), including the played one."""
    played_answer_id: str | None = None
    best_answer_id: str | None = None
    best_equity: float | None = None
    played_equity: float | None = None
    loss: float | None = None
    position_class: str | None = None
    categories: list[str] = field(default_factory=list)
    features: dict | None = None
    warnings: list[str] = field(default_factory=list)


def _r(x: float) -> float:
    return round(x + 0.0, 4)


def _answer_from_hint(m: dict, best: float) -> dict:
    a = {"id": m["move"], "label": m["move"], "equity": _r(m["equity"]), "equityLoss": _r(max(0.0, best - m["equity"]))}
    p = (m.get("details") or {}).get("probs")
    if p and len(p) >= 5:
        a["probs"] = {"win": _r(p[0]), "winGammon": _r(p[1]), "winBackgammon": _r(p[2]), "loseGammon": _r(p[3]), "loseBackgammon": _r(p[4])}
    return a


def _classify(scored: Scored, xgid: str, raw: dict | None) -> None:
    cls = CLASS_NAMES.get((raw or {}).get("class", -1))
    problem = {"xgid": xgid, "analysis": {"positionClass": cls} if cls else {}, "categories": []}
    apply_classification(problem)
    scored.position_class = cls
    scored.categories = problem["categories"]
    scored.features = problem["features"]


def score_decision(
    decision: Decision,
    raw: dict | None,
    *,
    max_answers: int = 6,
    plies: int = 2,
    today: dt.date | None = None,
) -> Scored:
    """Score one decision from its raw ``run_gnubg`` record (``None`` when gnubg was not asked)."""
    scored = Scored()
    if decision.forced:
        return scored
    _classify(scored, decision.xgid, raw)
    if raw is None:
        scored.warnings.append("not evaluated")
        return scored
    try:
        problem = build_problem(raw, problem_id=decision.decision_id, max_answers=max(2, max_answers), plies=plies, today=today)
    except ParseError as e:
        scored.warnings.append(str(e))
        return scored
    answers = problem["answers"]

    if decision.kind == "checker":
        view = acting_view(parse_xgid(decision.xgid))
        start = state_from_view(view)
        played_state = apply_steps(start, parse_play(decision.played))
        key = played_state.key() if played_state else None
        hints = raw["chequer"]["hint"]
        best = hints[0]["equity"]
        played = None
        for m in hints:
            try:
                st = apply_steps(start, parse_play(m["move"]))
            except NotationError:
                continue
            if st is not None and st.key() == key:
                played = m
                break
        if played is None:
            scored.warnings.append(f"played move {decision.played!r} is not in gnubg's list")
        else:
            if all(a["id"] != played["move"] for a in answers):
                answers.append(_answer_from_hint(played, best))
                answers.sort(key=lambda a: a["equityLoss"])
            scored.played_answer_id = played["move"]
            scored.played_equity = _r(played["equity"])
            scored.loss = _r(max(0.0, best - played["equity"]))
    else:
        by_id = {a["id"]: a for a in answers}
        if decision.played == "double":
            options = ["double-take", "double-pass"]
        elif decision.played == "no-double":
            options = ["no-double", "too-good"]
        else:
            options = [decision.played]
        chosen = min((by_id[o] for o in options if o in by_id), key=lambda a: a["equityLoss"], default=None)
        if chosen is None:
            scored.warnings.append(f"no answer matches {decision.played!r}")
        else:
            scored.played_answer_id = chosen["id"]
            scored.played_equity = chosen["equity"]
            scored.loss = chosen["equityLoss"]

    scored.answers = answers
    scored.best_answer_id = answers[0]["id"]
    scored.best_equity = answers[0]["equity"]
    return scored
