"""Runs INSIDE GNU Backgammon as the app's live engine: ``gnubg-cli -t -q -p gnubg_server.py``.

The app (``src/lib/engine.ts``) keeps one such process per dev server. This script reads one
JSON request per line on stdin and answers each with one line on stdout that starts with
``@@BG `` (gnubg prints boards and messages on the same stream; every other line is noise).
``BG_PIPELINE_DIR`` names the pipeline folder, so a decision is ranked, scored and classified by
the same code as the match importer (``gnubg_parse``, ``match_score``, ``classify``).

Requests::

    {"id": 1, "op": "analyse", "xgid": "...", "played": "13/7 8/7"}   # or double / no-double / take / pass
    {"id": 2, "op": "analyse", "xgid": "..."}                          # no "played": gnubg's own choice
    {"id": 3, "op": "ping"}
    {"id": 4, "op": "quit"}

Responses::

    {"event": "ready", "plies": 2}                                     # once, after start-up
    {"id": 1, "ok": true, "kind": "checker", "best": "...", "played": "...", "answers": [...], ...}
    {"id": 1, "ok": false, "error": "..."}

The decision kind follows the XGID: rolled dice = ``checker``, dice ``D`` = ``take`` (the
responder's take or pass), otherwise ``cube`` (double or not, before the roll). Cube decisions
come from ``gnubg.cfevaluate``: the Python ``hint()`` refuses them, and cfevaluate's equities are
the ones the text-mode ``hint`` prints. Standard library only (gnubg embeds its own Python).
"""

import datetime as dt
import json
import os
import sys
import time

PREFIX = "@@BG "


def emit(obj, out=None):
    out = out or sys.stdout
    out.write(PREFIX + json.dumps(obj) + "\n")
    out.flush()


def analyse(gnubg, req, plies, today=None):
    """Evaluate one position with gnubg and score ``req["played"]`` (gnubg's own choice when
    it is missing) exactly like the match importer scores a recorded decision."""
    from bgpipeline.gnubg_parse import cube_from_cfevaluate
    from bgpipeline.match_score import score_decision
    from bgpipeline.replay import Decision
    from bgpipeline.xgid import acting_player, decision_kind, parse_xgid

    xgid = str(req["xgid"])
    pos = parse_xgid(xgid)
    kind = decision_kind(pos)
    gnubg.command("set xgid XGID=" + xgid)
    board = gnubg.board()
    raw = {"xgid": xgid, "ok": True, "class": gnubg.classifypos(board)}
    cube = None
    if kind == "checker":
        hint = gnubg.hint()
        moves = (hint or {}).get("hint") or []
        if not moves:
            raise ValueError("gnubg returned no moves for " + xgid)
        raw["chequer"] = hint
        dkind = "checker"
        best = moves[0]["move"]
    else:
        ci = gnubg.cubeinfo()
        ec = gnubg.evalcontext()
        cube = cube_from_cfevaluate(gnubg.cfevaluate(board, ci, ec), gnubg.evaluate(board, ci, ec))
        raw["cube"] = cube
        if kind == "cube-take":
            # The doubler's equities: the responder takes when a take leaves the doubler less.
            dkind = "take"
            best = "take" if cube["dt"] <= cube["dp"] else "pass"
        else:
            dkind = "cube"
            best = "double" if cube["correct"] in ("double-take", "double-pass") else "no-double"
    played = req.get("played")
    if played is None:
        played = best
    dice = pos.dice if kind == "checker" else None
    decision = Decision(0, 0, acting_player(pos), dkind, xgid, dice, str(played), False, 0, 0)
    scored = score_decision(decision, raw, max_answers=6, plies=plies, today=today or dt.date.today())
    return {
        "kind": dkind,
        "best": best,
        "played": played,
        "answers": scored.answers,
        "playedAnswerId": scored.played_answer_id,
        "bestAnswerId": scored.best_answer_id,
        "bestEquity": scored.best_equity,
        "playedEquity": scored.played_equity,
        "loss": scored.loss,
        "positionClass": scored.position_class,
        "categories": scored.categories,
        "features": scored.features,
        "warnings": scored.warnings,
        "cube": None if cube is None else {k: cube[k] for k in ("nd", "dt", "dp", "proper")},
        "plies": plies,
    }


def serve(gnubg, lines, out=None, plies=2):
    """Answer requests until ``quit`` or the end of input (the app closed the pipe)."""
    for line in lines:
        line = line.strip()
        if not line:
            continue
        t0 = time.time()
        try:
            req = json.loads(line)
        except ValueError as e:
            emit({"id": None, "ok": False, "error": "bad request: %s" % e}, out)
            continue
        rid = req.get("id")
        op = req.get("op")
        try:
            if op == "quit":
                emit({"id": rid, "ok": True}, out)
                return
            if op == "ping":
                result = {}
            elif op == "analyse":
                result = analyse(gnubg, req, plies)
            else:
                raise ValueError("unknown op %r" % (op,))
            result.update(id=rid, ok=True, ms=round((time.time() - t0) * 1000))
            emit(result, out)
        except Exception as e:  # noqa: BLE001 - one bad request must not stop the engine
            emit({"id": rid, "ok": False, "error": repr(e)}, out)


def main():
    import gnubg  # type: ignore  # provided by gnubg at runtime

    # gnubg_inner runs its batch job on import when BG_XGIDS is set; this process never is one.
    os.environ.pop("BG_XGIDS", None)
    pipeline_dir = os.environ.get("BG_PIPELINE_DIR")
    if pipeline_dir and pipeline_dir not in sys.path:
        sys.path.insert(0, pipeline_dir)
    from bgpipeline.gnubg_inner import setup_commands

    plies = int(os.environ.get("BG_PLIES", "2"))
    for cmd in setup_commands(plies, plies):
        gnubg.command(cmd)
    emit({"event": "ready", "plies": plies})
    serve(gnubg, sys.stdin, plies=plies)


if __name__ == "__main__" or os.environ.get("BG_SERVE") == "1":
    main()
