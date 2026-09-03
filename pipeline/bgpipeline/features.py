"""Board features for the rule-based classifier, all from the acting player's side (Blue).

Every feature is logged next to the resulting tags (see classify.py CLI) so the rules can
be tuned against real positions later.
"""

from __future__ import annotations

from .moves import generate_plays
from .xgid import Position, View, acting_view, decision_kind


def longest_run(flags: list[bool]) -> int:
    best = cur = 0
    for f in flags:
        cur = cur + 1 if f else 0
        best = max(best, cur)
    return best


def features_from_view(
    view: View,
    *,
    decision: str = "checker",
    dice: tuple[int, int] | None = None,
    cube_value: int = 1,
    cube_owner: str = "center",
    match_length: int = 0,
    score_me: int = 0,
    score_them: int = 0,
    crawford: bool = False,
    position_class: str | None = None,
) -> dict:
    pts = view.points
    mine = {i: pts[i] for i in range(1, 25) if pts[i] > 0}
    theirs = {i: -pts[i] for i in range(1, 25) if pts[i] < 0}
    my_points = sorted(i for i, n in mine.items() if n >= 2)
    their_points = sorted(i for i, n in theirs.items() if n >= 2)
    my_blots = sorted(i for i, n in mine.items() if n == 1)
    their_blots = sorted(i for i, n in theirs.items() if n == 1)

    my_rearmost = 25 if view.my_bar else (max(mine) if mine else 0)
    their_rearmost = 0 if view.their_bar else (min(theirs) if theirs else 25)
    contact = my_rearmost > their_rearmost
    all_home_me = view.my_bar == 0 and my_rearmost <= 6
    all_home_them = view.their_bar == 0 and their_rearmost >= 19

    back_me = view.my_bar + sum(n for i, n in mine.items() if i >= 19)
    back_them = view.their_bar + sum(n for i, n in theirs.items() if i <= 6)
    anchors_me = [i for i in my_points if i >= 19]
    anchors_them = [i for i in their_points if i <= 6]
    home_points_me = len([i for i in my_points if i <= 6])
    home_points_them = len([i for i in their_points if i >= 19])

    # Primes in front of the opponent's rearmost checker (what actually blocks them).
    prime_me = longest_run([pts[i] >= 2 for i in range(their_rearmost + 1, 25)]) if their_rearmost < 24 else 0
    prime_them = longest_run([pts[i] <= -2 for i in range(1, my_rearmost)]) if my_rearmost > 1 else 0
    prime_me_any = longest_run([pts[i] >= 2 for i in range(1, 25)])
    prime_them_any = longest_run([pts[i] <= -2 for i in range(1, 25)])

    deep_me = mine.get(1, 0) + mine.get(2, 0)
    deep_them = theirs.get(24, 0) + theirs.get(23, 0)
    low_me = deep_me + mine.get(3, 0)
    low_them = deep_them + theirs.get(22, 0)
    high_home_points_me = len([i for i in my_points if 4 <= i <= 6])
    high_home_points_them = len([i for i in their_points if 19 <= i <= 21])
    crunch_me = contact and low_me >= 5 and high_home_points_me <= 1
    crunch_them = contact and low_them >= 5 and high_home_points_them <= 1

    my_outfield = {i: n for i, n in mine.items() if 7 <= i <= 18}
    their_outfield = {i: n for i, n in theirs.items() if 7 <= i <= 18}

    on_board_me = 15 - view.my_off
    on_board_them = 15 - view.their_off

    n_plays = hitting = 0
    can_break_anchor = False
    if decision == "checker" and dice:
        plays = generate_plays(view, dice)
        n_plays = len(plays)
        hitting = sum(1 for p in plays if any(s.hit for s in p.steps))
        for a in anchors_me:
            keeps = any(p.result.points[a] >= 2 for p in plays)
            breaks = any(p.result.points[a] < 2 for p in plays)
            if keeps and breaks:
                can_break_anchor = True

    if position_class is None:
        if not contact:
            position_class = "bearoff" if (all_home_me and all_home_them) else "race"
        else:
            position_class = "contact"

    return {
        "decision": decision,
        "dice": list(dice) if dice else None,
        "doubles": bool(dice and dice[0] == dice[1]),
        "position_class": position_class,
        "contact": contact,
        "pips_me": view.my_pips,
        "pips_them": view.their_pips,
        "pip_diff": view.their_pips - view.my_pips,
        "on_board_me": on_board_me,
        "on_board_them": on_board_them,
        "off_me": view.my_off,
        "off_them": view.their_off,
        "bar_me": view.my_bar,
        "bar_them": view.their_bar,
        "back_me": back_me,
        "back_them": back_them,
        "anchors_me": anchors_me,
        "anchors_them": anchors_them,
        "home_points_me": home_points_me,
        "home_points_them": home_points_them,
        "my_rearmost": my_rearmost,
        "their_rearmost": their_rearmost,
        "all_home_me": all_home_me,
        "all_home_them": all_home_them,
        "prime_me": prime_me,
        "prime_them": prime_them,
        "prime_me_any": prime_me_any,
        "prime_them_any": prime_them_any,
        "deep_me": deep_me,
        "deep_them": deep_them,
        "crunch_me": crunch_me,
        "crunch_them": crunch_them,
        "my_blots": len(my_blots),
        "their_blots": len(their_blots),
        "my_blots_in_their_home": len([i for i in my_blots if i >= 19]),
        "their_blots_in_my_home": len([i for i in their_blots if i <= 6]),
        "my_outfield_checkers": sum(my_outfield.values()),
        "my_outfield_points": len(my_outfield),
        "my_outfield_blots": len([i for i, n in my_outfield.items() if n == 1]),
        "their_outfield_checkers": sum(their_outfield.values()),
        "n_plays": n_plays,
        "hitting_plays": hitting,
        "can_hit": hitting > 0,
        "must_hit": n_plays > 0 and hitting == n_plays,
        "can_break_anchor": can_break_anchor,
        "cube_value": cube_value,
        "cube_owner": cube_owner,
        "match_length": match_length,
        "score_me": score_me,
        "score_them": score_them,
        "crawford": crawford,
    }


def compute_features(pos: Position, position_class: str | None = None) -> dict:
    view = acting_view(pos)
    me = view.me
    if pos.cube_owner == 0:
        owner = "center"
    else:
        owner = "me" if pos.cube_owner == me else "them"
    score_me = pos.score[0] if me == 1 else pos.score[1]
    score_them = pos.score[1] if me == 1 else pos.score[0]
    return features_from_view(
        view,
        decision=decision_kind(pos),
        dice=pos.dice,
        cube_value=pos.cube_value,
        cube_owner=owner,
        match_length=pos.match_length,
        score_me=score_me,
        score_them=score_them,
        crawford=pos.crawford,
        position_class=position_class,
    )


# Compact subset stored on each problem (Record<string, number | boolean | string> in the app).
APP_FEATURE_KEYS = [
    "position_class",
    "contact",
    "pips_me",
    "pips_them",
    "pip_diff",
    "back_me",
    "back_them",
    "anchors_me",
    "anchors_them",
    "home_points_me",
    "home_points_them",
    "prime_me",
    "prime_them",
    "bar_me",
    "bar_them",
    "can_hit",
]


def app_features(f: dict) -> dict:
    out = {}
    for k in APP_FEATURE_KEYS:
        v = f.get(k)
        if isinstance(v, list):
            v = ",".join(str(x) for x in v)
        if v is None:
            continue
        out[k] = v
    return out
