"""Turn raw gnubg results (from gnubg_runner) into Problem entries for data/*.json."""

from __future__ import annotations

import datetime as dt
import re

from .xgid import Position, decision_kind, parse_xgid

# gnubg's positionclass enum (eval.h).
CLASS_NAMES = {
    0: "over",
    1: "hypergammon",
    2: "hypergammon",
    3: "hypergammon",
    4: "bearoff",
    5: "bearoff",
    6: "bearoff",
    7: "bearoff",
    8: "race",
    9: "crashed",
    10: "contact",
}

_CUBE_LINE = re.compile(r"^\s*\d+\.\s+(?P<label>[A-Za-z][A-Za-z ,]*?)\s+(?P<eq>[-+]?\d+\.\d+)(?:\s+\((?P<diff>[-+]?\d+\.\d+)\))?\s*$", re.M)
_PROPER = re.compile(r"^Proper cube action:\s*(?P<action>.+?)\s*$", re.M)
_PROBS = re.compile(r"^\s*(\d\.\d+)\s+(\d\.\d+)\s+(\d\.\d+)\s+-\s+(\d\.\d+)\s+(\d\.\d+)\s+(\d\.\d+)\s*$", re.M)
_CUBELESS = re.compile(r"cubeless equity\s+([-+]?\d+\.\d+)")


class ParseError(ValueError):
    pass


def parse_cube_text(text: str) -> dict:
    """Parse gnubg's ``hint`` output for a cube decision.

    Returns ``{"nd", "dt", "dp", "proper", "correct", "probs", "cubeless"}`` where ``correct``
    is one of the joint answer ids ``no-double``, ``double-take``, ``double-pass``, ``too-good``.
    """
    eqs: dict[str, float] = {}
    for m in _CUBE_LINE.finditer(text):
        label = m.group("label").strip().lower()
        eq = float(m.group("eq"))
        if label.startswith("no"):
            eqs["nd"] = eq
        elif "pass" in label:
            eqs["dp"] = eq
        elif "take" in label or "beaver" in label:
            eqs["dt"] = eq
    missing = [k for k in ("nd", "dt", "dp") if k not in eqs]
    if missing:
        raise ParseError(f"cube equities missing {missing} in gnubg output:\n{text[-1500:]}")
    pm = _PROPER.search(text)
    if not pm:
        raise ParseError(f"no 'Proper cube action' line in gnubg output:\n{text[-1500:]}")
    proper = re.sub(r"\s*\([^)]*\)\s*$", "", pm.group("action")).strip()
    a = proper.lower()
    if "too good" in a:
        correct = "too-good"
    elif a.startswith("no"):
        correct = "no-double"
    elif "pass" in a:
        correct = "double-pass"
    else:
        correct = "double-take"
    probs = None
    pr = _PROBS.search(text)
    if pr:
        w, wg, wbg, _l, lg, lbg = (float(x) for x in pr.groups())
        probs = {"win": w, "winGammon": wg, "winBackgammon": wbg, "loseGammon": lg, "loseBackgammon": lbg}
    cm = _CUBELESS.search(text)
    return {
        "nd": eqs["nd"],
        "dt": eqs["dt"],
        "dp": eqs["dp"],
        "proper": proper,
        "correct": correct,
        "probs": probs,
        "cubeless": float(cm.group(1)) if cm else None,
    }


def _r(x: float) -> float:
    return round(x + 0.0, 4)


def cube_answers(parsed: dict, kind: str, centered: bool, probs: dict | None) -> list[dict]:
    """Quiz answers for a cube decision.

    Joint answers (dice 00) are scored like gnubg's own error report: a wrong doubling
    decision costs |min(DT, DP) - ND|, a wrong take/pass claim costs |DT - DP|, and both are
    added when both halves are wrong. Take/pass answers (dice D) cost |DT - DP|.
    """
    nd, dt, dp = parsed["nd"], parsed["dt"], parsed["dp"]
    d_value = min(dt, dp)
    correct = parsed["correct"]
    doubler_err = abs(d_value - nd)
    taker_err = abs(dt - dp)
    verb = "Redouble" if not centered else "Double"
    noun = "redouble" if not centered else "double"

    if kind == "cube-take":
        take_right = dt <= dp
        answers = [
            {"id": "take", "label": "Take", "equity": _r(-dt), "equityLoss": 0.0 if take_right else _r(taker_err)},
            {"id": "pass", "label": "Pass", "equity": _r(-dp), "equityLoss": _r(taker_err) if take_right else 0.0},
        ]
    else:
        correct_double = correct in ("double-take", "double-pass")
        correct_take = correct in ("no-double", "double-take")
        spec = [
            ("no-double", f"No {noun}, take", nd, False, True),
            ("double-take", f"{verb}, take", dt, True, True),
            ("double-pass", f"{verb}, pass", dp, True, False),
            ("too-good", f"No {noun}, pass (too good)", nd, False, False),
        ]
        answers = []
        for aid, label, eq, doubles, takes in spec:
            loss = 0.0
            if doubles != correct_double:
                loss += doubler_err
            if takes != correct_take:
                loss += taker_err
            answers.append({"id": aid, "label": label, "equity": _r(eq), "equityLoss": _r(loss)})
    answers.sort(key=lambda a: a["equityLoss"])
    if answers[0]["equityLoss"] != 0.0:
        answers[0]["equityLoss"] = 0.0
    if probs:
        for a in answers:
            a["probs"] = {k: _r(v) for k, v in probs.items()}
    return answers


def chequer_answers(hint: dict, max_answers: int) -> list[dict]:
    moves = hint.get("hint") or []
    if not moves:
        raise ParseError("gnubg returned no moves")
    best = moves[0]["equity"]
    answers = []
    for m in moves[:max_answers]:
        p = (m.get("details") or {}).get("probs")
        a = {
            "id": m["move"],
            "label": m["move"],
            "equity": _r(m["equity"]),
            "equityLoss": _r(max(0.0, best - m["equity"])),
        }
        if p and len(p) >= 5:
            a["probs"] = {
                "win": _r(p[0]),
                "winGammon": _r(p[1]),
                "winBackgammon": _r(p[2]),
                "loseGammon": _r(p[3]),
                "loseBackgammon": _r(p[4]),
            }
        answers.append(a)
    return answers


def build_problem(
    raw: dict,
    *,
    problem_id: str,
    max_answers: int = 6,
    plies: int = 2,
    source: str | None = None,
    today: dt.date | None = None,
) -> dict:
    """Build a Problem dict (matching src/types/problem.ts) from one raw gnubg record."""
    if not raw.get("ok"):
        raise ParseError(f"gnubg failed on {raw.get('xgid')}: {raw.get('error')}")
    xgid = raw["xgid"]
    pos: Position = parse_xgid(xgid)
    kind = decision_kind(pos)
    if kind == "checker":
        if not raw.get("chequer"):
            raise ParseError(f"no chequer hint for {xgid}")
        answers = chequer_answers(raw["chequer"], max_answers)
        ptype = "checker"
    else:
        if not raw.get("cube_text"):
            raise ParseError(f"no cube analysis for {xgid}")
        parsed = parse_cube_text(raw["cube_text"])
        answers = cube_answers(parsed, kind, pos.cube_owner == 0, parsed.get("probs"))
        ptype = "cube"
    if len(answers) < 2:
        raise ParseError(f"only {len(answers)} answer(s) for {xgid}")
    analysis = {
        "engine": "gnubg",
        "plies": plies,
        "analysedAt": (today or dt.date.today()).isoformat(),
    }
    cls = CLASS_NAMES.get(raw.get("class", -1))
    if cls:
        analysis["positionClass"] = cls
    problem = {
        "id": problem_id,
        "xgid": xgid,
        "type": ptype,
        "categories": [],
        "explanation": "",
        "analysis": analysis,
        "answers": answers,
    }
    if source:
        problem["source"] = source
    return problem
