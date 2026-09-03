"""Runs INSIDE GNU Backgammon: ``gnubg-cli -t -q -p gnubg_inner.py``.

Standard library only (gnubg embeds its own Python 3.10). Reads XGIDs from the file named by
the ``BG_XGIDS`` environment variable, evaluates each one and writes a JSON list to
``BG_OUT``. ``BG_PLIES`` / ``BG_CUBE_PLIES`` set the evaluation depth.

For each XGID the record holds gnubg's position info, cube info, board, position class and,
for checker plays, the structured ``hint`` result. gnubg's Python ``hint()`` does not support
cube decisions ("not yet implemented"), so those are flagged with ``needs_cube`` and the
caller runs a text-mode pass for them (see ``gnubg_runner.run_cube_text``).
"""

import json
import os
import sys


def setup_commands(plies, cube_plies):
    cmds = [
        "set lang en",
        "set automatic game off",
        "set automatic roll off",
        "set output mwc off",
        "set output matchpc off",
        "set evaluation chequerplay evaluation plies %d" % plies,
        "set evaluation cubedecision evaluation plies %d" % cube_plies,
    ]
    # Move filters: without them gnubg keeps everything at 0-ply. Level 0 sends every move to
    # 1-ply, later levels keep the top 10 (+4 within 0.16) for the next ply.
    if plies >= 1:
        cmds.append("set evaluation movefilter %d 0 -1 0 0" % plies)
        for level in range(1, plies):
            cmds.append("set evaluation movefilter %d %d 10 4 0.16" % (plies, level))
    return cmds


def main():
    import gnubg  # type: ignore  # provided by gnubg at runtime

    xgids_file = os.environ["BG_XGIDS"]
    out_file = os.environ["BG_OUT"]
    plies = int(os.environ.get("BG_PLIES", "2"))
    cube_plies = int(os.environ.get("BG_CUBE_PLIES", str(plies)))

    with open(xgids_file, "r", encoding="utf-8") as f:
        xgids = [line.strip() for line in f if line.strip() and not line.startswith("#")]

    for cmd in setup_commands(plies, cube_plies):
        gnubg.command(cmd)

    results = []

    def flush():
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(results, f, default=str)

    for xgid in xgids:
        rec = {"xgid": xgid, "ok": False}
        try:
            gnubg.command("set xgid XGID=" + xgid)
            rec["posinfo"] = gnubg.posinfo()
            rec["cubeinfo"] = gnubg.cubeinfo()
            board = gnubg.board()
            rec["board"] = board
            rec["class"] = gnubg.classifypos(board)
            dice = rec["posinfo"].get("dice", (0, 0))
            if dice[0] and dice[1]:
                rec["chequer"] = gnubg.hint()
                rec["needs_cube"] = False
            else:
                rec["chequer"] = None
                rec["needs_cube"] = True
            rec["ok"] = True
        except Exception as e:  # noqa: BLE001 - one bad position must not abort the batch
            rec["error"] = repr(e)
        results.append(rec)
        flush()
    flush()
    sys.stdout.write("BG_INNER_DONE %d\n" % len(results))


if __name__ == "__main__" or os.environ.get("BG_XGIDS"):
    main()
