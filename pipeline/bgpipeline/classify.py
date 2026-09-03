"""Rule-based category tagging. Categories follow Robertie's chapter structure.

The rules are deliberately simple and readable; tune them against the feature log written
by ``classify.py --log``. A problem may carry several tags. Every problem gets at least one.
"""

from __future__ import annotations

from .features import app_features, compute_features
from .xgid import parse_xgid

CATEGORIES = [
    "opening",
    "early-game",
    "blitz",
    "holding-game",
    "priming-game",
    "back-game",
    "connectivity",
    "hit-or-not",
    "breaking-anchor",
    "crunch",
    "bearing-in",
    "bearing-off",
    "racing-cube",
    "contact-cube",
    "containment",
    "ace-point-game",
]


def is_opening(f: dict) -> bool:
    return (
        f["on_board_me"] == 15
        and f["on_board_them"] == 15
        and f["bar_me"] == 0
        and f["bar_them"] == 0
        and f["pips_me"] + f["pips_them"] >= 320
    )


def classify(f: dict) -> list[str]:
    tags: set[str] = set()
    checker = f["decision"] == "checker"
    cube = not checker
    contact = f["contact"]
    opening = is_opening(f)

    if opening:
        tags.add("opening")

    if cube:
        tags.add("contact-cube" if contact else "racing-cube")

    if not contact:
        if checker:
            tags.add("bearing-off" if f["all_home_me"] else "bearing-in")
    else:
        if not opening and f["pips_me"] >= 125 and f["pips_them"] >= 125:
            tags.add("early-game")

        # Structures.
        i_am_back = len(f["anchors_me"]) >= 2 and f["pip_diff"] <= -40
        they_are_back = len(f["anchors_them"]) >= 2 and f["pip_diff"] >= 40
        if i_am_back or they_are_back:
            tags.add("back-game")
        elif (f["anchors_them"] == [1] and f["back_them"] <= 3 and f["my_rearmost"] <= 12) or (
            f["anchors_me"] == [24] and f["back_me"] <= 3 and f["their_rearmost"] >= 13
        ):
            tags.add("ace-point-game")
        elif not opening and (
            any(a in (20, 21) for a in f["anchors_me"]) or any(a in (4, 5) for a in f["anchors_them"])
        ):
            tags.add("holding-game")

        if f["prime_me"] >= 4 or f["prime_them"] >= 4:
            tags.add("priming-game")

        attacking_them = (
            (f["bar_them"] >= 1 or f["their_blots_in_my_home"] >= 1)
            and f["home_points_me"] >= 3
            and not f["anchors_them"]
            and f["back_them"] >= 2
        )
        attacking_me = (
            (f["bar_me"] >= 1 or f["my_blots_in_their_home"] >= 1)
            and f["home_points_them"] >= 3
            and not f["anchors_me"]
            and f["back_me"] >= 2
        )
        if attacking_them or attacking_me:
            tags.add("blitz")

        if (f["back_them"] == 1 and f["pip_diff"] >= 15) or (f["back_me"] == 1 and f["pip_diff"] <= -15):
            tags.add("containment")

        if f["crunch_me"] or f["crunch_them"] or f["position_class"] == "crashed":
            tags.add("crunch")

        if checker:
            if f["all_home_me"] and f["anchors_them"]:
                tags.add("bearing-off")
            elif f["my_rearmost"] <= 12 and f["anchors_them"] and "back-game" not in tags:
                tags.add("bearing-in")

            if not opening and (
                f["my_outfield_blots"] >= 2 or (f["my_outfield_points"] >= 3 and f["my_outfield_checkers"] <= 6)
            ):
                tags.add("connectivity")

            if f["can_hit"] and not f["must_hit"]:
                tags.add("hit-or-not")

            if f["can_break_anchor"] and not opening and f["pips_me"] <= 140:
                tags.add("breaking-anchor")

    if not tags:
        tags.add("early-game" if contact else "bearing-in")
    return [c for c in CATEGORIES if c in tags]


def classify_problem(problem: dict) -> tuple[list[str], dict]:
    """Tags and the full feature dict for a Problem (uses gnubg's position class if present)."""
    pos = parse_xgid(problem["xgid"])
    cls = (problem.get("analysis") or {}).get("positionClass")
    f = compute_features(pos, cls)
    return classify(f), f


def apply_classification(problem: dict, *, merge: bool = False) -> dict:
    """Tag one problem in place; returns the full feature dict for logging."""
    tags, f = classify_problem(problem)
    if merge:
        existing = [c for c in problem.get("categories", []) if c in CATEGORIES]
        tags = [c for c in CATEGORIES if c in set(existing) | set(tags)]
    problem["categories"] = tags
    problem["features"] = app_features(f)
    return f
