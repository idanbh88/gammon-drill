"""gnubg's verdict on Robertie's answers (stage 5 of ``import_robertie.py``).

A checker play is scored like a move played in a match (``match_score.score_decision``): it is
found in gnubg's full list of plays by its resulting position, its loss is gnubg's best equity
minus its own, and it is added to the ranked answers when it is outside the top ones. The
comparison is only fair when the book's play was evaluated as deeply as gnubg's best; the
import asks gnubg to evaluate every play fully (``run_gnubg(full_width=True)``) and records
whether that held for the book's play (``book_full_depth``).

A cube answer is one of the joint ids (``double-take`` ...), scored as that answer's loss in the
ranked joint answers; ``double`` (the book states only the doubling half) is scored as the
cheaper of ``double-take`` and ``double-pass``. (``match_score`` treats a bare ``no-double`` as a
half-decision too, which the book's "no double, take" is not, hence the separate rule here.)
"""

from __future__ import annotations

import datetime as dt

from .match_score import score_decision
from .replay import Decision
from .robertie import CHAPTER_CATEGORIES, BookProblem

TAXONOMY = (
    "opening", "early-game", "blitz", "holding-game", "priming-game", "back-game", "connectivity", "hit-or-not",
    "breaking-anchor", "crunch", "bearing-in", "bearing-off", "racing-cube", "contact-cube", "containment", "ace-point-game",
)


def categories_for(chapter: int | None, classified: list[str]) -> list[str]:
    """The chapter's own categories and the classifier's, in taxonomy order."""
    wanted = set(CHAPTER_CATEGORIES.get(chapter or 0, [])) | set(classified)
    return [c for c in TAXONOMY if c in wanted] or list(classified)


def score_problem(p: BookProblem, raw: dict | None, *, plies: int, today: dt.date | None = None) -> dict:
    """One ``robertie_analyses`` row for an accepted problem (``book_loss`` None when it could
    not be scored; ``notes`` says why)."""
    dice = (int(p.dice[0]), int(p.dice[1])) if p.kind == "checker" and p.dice else None
    played = p.book_answer or ""
    if p.kind == "cube" and played not in ("double-take", "double-pass", "too-good", "double"):
        played = "double-take"  # only to get the ranked answers; the loss is looked up below
    decision = Decision(0, 0, 1, "checker" if p.kind == "checker" else "cube", p.xgid, dice, played, False, 0, 0)
    scored = score_decision(decision, raw, max_answers=6, plies=plies, today=today)
    notes = list(scored.warnings)
    book_id, loss, full_depth = scored.played_answer_id, scored.loss, True
    if p.kind == "cube" and scored.answers:
        by_id = {a["id"]: a for a in scored.answers}
        if p.book_answer == "double":
            options = [by_id[o] for o in ("double-take", "double-pass") if o in by_id]
            chosen = min(options, key=lambda a: a["equityLoss"]) if options else None
        else:
            chosen = by_id.get(p.book_answer or "")
        book_id = chosen["id"] if chosen else None
        loss = chosen["equityLoss"] if chosen else None
        if chosen is None:
            notes.append(f"no answer matches {p.book_answer!r}")
    if p.kind == "checker" and raw and raw.get("chequer") and book_id:
        for m in raw["chequer"]["hint"]:
            if m["move"] == book_id:
                full_depth = (m.get("context") or {}).get("plies", plies) >= plies
                break
        if not full_depth:
            notes.append(f"the book's play was evaluated below {plies}-ply")
    return {
        "number": p.number,
        "plies": plies,
        "engine": "gnubg",
        "analysed_at": (today or dt.date.today()).isoformat(),
        "position_class": scored.position_class,
        "categories": categories_for(p.chapter, scored.categories),
        "features": scored.features,
        "answers": scored.answers,
        "best_answer_id": scored.best_answer_id,
        "book_answer_id": book_id,
        "book_loss": loss,
        "book_full_depth": full_depth,
        "notes": "; ".join(notes) or None,
    }


def agreement(loss: float | None) -> str | None:
    """same / close / differs / blunder, with the app's error (0.02) and blunder (0.08) lines."""
    if loss is None:
        return None
    if loss == 0:
        return "same"
    if loss < 0.02:
        return "close"
    if loss < 0.08:
        return "differs"
    return "blunder"
