#!/usr/bin/env python
"""Import Backgammon Galaxy (Jellyfish ``.mat``) matches, analyse one player's decisions with
GNU Backgammon and write the result into data/store.sqlite for the app's /matches page.

    uv run import_match.py match.mat
    uv run import_match.py "C:/Users/me/Downloads" --replace --plies 2
    uv run import_match.py match.mat --json          # progress as NDJSON (used by the app)

Files and folders (every ``*.mat`` inside) can be mixed; globs are expanded here because
PowerShell does not. A match already in the store (same site and match id) is skipped unless
``--replace``, which deletes and rewrites its games and decisions. Explanations are never
touched: they are keyed by XGID and survive a re-import.

What is evaluated for the tracked player (``--player``, default 1 = the left column): every
roll with a choice, the pre-roll cube decision whenever their cube was live, their doubles,
takes and passes. Forced plays and dances are stored (``forced``) but not evaluated.
``--raw-out`` / ``--raw-in`` save and reuse gnubg's raw output (test fixtures, re-scoring).
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bgpipeline.cli import Emit, ImportError_, expand_paths, json_emit  # noqa: E402
from bgpipeline.gnubg_runner import GnubgError, find_gnubg, run_gnubg  # noqa: E402
from bgpipeline.mat import MatError, parse_mat  # noqa: E402
from bgpipeline.match_score import score_decision  # noqa: E402
from bgpipeline.replay import replay  # noqa: E402
from bgpipeline.store import (  # noqa: E402
    DEFAULT_STORE,
    StoreError,
    delete_match,
    find_match,
    insert_decision,
    insert_game,
    insert_match,
    match_summary,
    open_store,
)


def played_at(date: str | None, time: str | None) -> str | None:
    """``2026.09.03`` + ``18.37`` -> ``2026-09-03T18:37:00`` (best effort)."""
    if not date:
        return None
    parts = date.replace("-", ".").replace("/", ".").split(".")
    if len(parts) != 3 or not all(x.isdigit() for x in parts):
        return None
    y, m, d = (int(x) for x in parts)
    hh = mm = 0
    if time:
        t = time.replace(":", ".").split(".")
        if len(t) >= 2 and all(x.isdigit() for x in t[:2]):
            hh, mm = int(t[0]), int(t[1])
    try:
        return dt.datetime(y, m, d, hh, mm).isoformat(timespec="seconds")
    except ValueError:
        return None


def import_file(
    path: Path,
    *,
    store: Path = DEFAULT_STORE,
    player: int = 1,
    plies: int = 2,
    cube_plies: int | None = None,
    gnubg: str | None = None,
    timeout: float | None = None,
    max_answers: int = 6,
    replace: bool = False,
    raw_in: Path | None = None,
    raw_out: Path | None = None,
    emit: Emit = lambda event, **fields: None,
    today: dt.date | None = None,
) -> dict:
    """Import one file. Returns the summary dict; raises ImportError_ / GnubgError / StoreError."""
    emit("start", file=path.name)
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        raise ImportError_(f"{path}: {e}") from e
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    try:
        match = parse_mat(text)
        rep = replay(match, player)
    except MatError as e:
        raise ImportError_(f"{path.name}: {e}") from e
    site = match.header.site or "unknown"
    site_match_id = match.header.match_id or sha[:16]

    conn = open_store(store)
    try:
        existing = find_match(conn, site, site_match_id)
        if existing is not None and not replace:
            emit("skipped", file=path.name, match_id=existing, reason="already imported (use --replace to analyse it again)")
            return {"skipped": True, "match_id": existing}

        to_eval = [d for d in rep.decisions if not d.forced]
        xgids = list(dict.fromkeys(d.xgid for d in to_eval))
        emit(
            "parsed",
            file=path.name,
            site=site,
            site_match_id=site_match_id,
            players=[match.header.player1, match.header.player2],
            match_length=match.match_length,
            games=len(rep.games),
            decisions=len(rep.decisions),
            to_evaluate=len(to_eval),
            positions=len(xgids),
        )

        raw_by_xgid: dict[str, dict] = {}
        if raw_in:
            for rec in json.loads(raw_in.read_text(encoding="utf-8")):
                raw_by_xgid[rec["xgid"]] = rec
            missing = [x for x in xgids if x not in raw_by_xgid]
            if missing:
                raise ImportError_(f"{raw_in}: {len(missing)} position(s) missing from the recorded gnubg output")
        elif xgids:
            emit("gnubg", message=f"evaluating {len(xgids)} positions at {plies}-ply, this takes about a second each")
            raw = run_gnubg(xgids, plies=plies, cube_plies=cube_plies, gnubg=gnubg, timeout=timeout, log=lambda m: emit("gnubg", message=m))
            if raw_out:
                raw_out.write_text(json.dumps(raw, indent=1), encoding="utf-8")
            raw_by_xgid = {r["xgid"]: r for r in raw}

        rows = []
        warnings = 0
        for d in rep.decisions:
            s = score_decision(d, raw_by_xgid.get(d.xgid), max_answers=max_answers, plies=plies, today=today)
            for w in s.warnings:
                warnings += 1
                emit("warning", decision=d.decision_id, message=w)
            rows.append((d, s))

        if existing is not None:
            delete_match(conn, existing)
        imported_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        mid = insert_match(
            conn,
            site=site,
            site_match_id=site_match_id,
            player1=match.header.player1,
            player2=match.header.player2,
            match_length=match.match_length,
            played_at=played_at(match.header.date, match.header.time),
            file_name=path.name,
            file_sha256=sha,
            mat_text=text,
            analysed_player=player,
            engine="gnubg",
            plies=plies,
            imported_at=imported_at,
        )
        game_ids = {}
        for g in rep.games:
            game_ids[g.number] = insert_game(
                conn, match_id=mid, number=g.number, score1=g.score[0], score2=g.score[1], crawford=g.crawford, winner=g.winner, points=g.points
            )
        analysed_at = (today or dt.date.today()).isoformat()
        for d, s in rows:
            insert_decision(
                conn,
                {
                    "match_id": mid,
                    "game_id": game_ids[d.game],
                    "decision_id": f"match-{site_match_id}-{d.decision_id}",
                    "game_number": d.game,
                    "move_number": d.move_no,
                    "player": d.player,
                    "kind": d.kind,
                    "xgid": d.xgid,
                    "dice": f"{d.dice[0]}{d.dice[1]}" if d.dice else None,
                    "played": d.played,
                    "played_answer_id": s.played_answer_id,
                    "best_answer_id": s.best_answer_id,
                    "best_equity": s.best_equity,
                    "played_equity": s.played_equity,
                    "loss": s.loss,
                    "forced": d.forced,
                    "position_class": s.position_class,
                    "categories": s.categories,
                    "features": s.features,
                    "answers": s.answers,
                    "plies": plies,
                    "analysed_at": analysed_at,
                },
            )
        conn.commit()
        summary = match_summary(conn, mid)
        summary.update({"match_id": mid, "warnings": warnings, "replaced": existing is not None})
        emit("done", file=path.name, **summary)
        return summary
    finally:
        conn.close()


def _human_emit(event: str, **fields) -> None:
    if event == "done":
        print(
            f"{fields.get('file')}: match {fields.get('match_id')} - {fields.get('decisions')} decisions evaluated, "
            f"{fields.get('errors')} errors ({fields.get('blunders')} blunders), total loss {fields.get('totalLoss'):.3f}"
            + (f", {fields.get('unscored')} unscored" if fields.get("unscored") else "")
            + (" (replaced)" if fields.get("replaced") else "")
        )
    elif event == "skipped":
        print(f"{fields.get('file')}: skipped, {fields.get('reason')}")
    elif event == "error":
        print(f"error: {fields.get('message')}", file=sys.stderr)
    elif event == "parsed":
        print(
            f"{fields.get('file')}: {fields.get('players')[0]} vs {fields.get('players')[1]}, {fields.get('match_length')}-point match, "
            f"{fields.get('games')} game(s), {fields.get('to_evaluate')} decisions to evaluate ({fields.get('positions')} positions)",
            file=sys.stderr,
        )
    elif event == "warning":
        print(f"warning: {fields.get('decision')}: {fields.get('message')}", file=sys.stderr)
    elif event == "gnubg":
        print(fields.get("message"), file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", help=".mat files, folders or globs")
    ap.add_argument("--player", type=int, default=1, choices=(1, 2), help="whose decisions to analyse (default 1, the left column)")
    ap.add_argument("--plies", type=int, default=2, help="chequer-play evaluation depth (default 2)")
    ap.add_argument("--cube-plies", type=int, default=None, help="cube evaluation depth (default: --plies)")
    ap.add_argument("--gnubg", help="path to gnubg-cli.exe (default: auto-detect, or $BG_GNUBG)")
    ap.add_argument("--store", type=Path, default=DEFAULT_STORE, help=f"sqlite store (default {DEFAULT_STORE})")
    ap.add_argument("--replace", action="store_true", help="re-import a match that is already in the store")
    ap.add_argument("--max-answers", type=int, default=6, help="ranked answers to keep per decision (default 6)")
    ap.add_argument("--timeout", type=float, default=None, help="seconds before giving up on gnubg")
    ap.add_argument("--json", action="store_true", help="print progress as NDJSON on stdout")
    ap.add_argument("--raw-in", type=Path, help="reuse recorded gnubg output instead of running gnubg")
    ap.add_argument("--raw-out", type=Path, help="record gnubg's raw output to this JSON file")
    args = ap.parse_args(argv)

    emit: Emit = json_emit if args.json else _human_emit
    paths = expand_paths(args.paths, "*.mat")
    if not paths:
        emit("error", message="no .mat files found")
        return 4
    if not args.raw_in and not find_gnubg(args.gnubg):
        emit("error", message="gnubg-cli.exe not found. Install GNU Backgammon (winget install GNU.gnubg --location C:\\gnubg)")
        return 2

    code = 0
    for p in paths:
        if not p.is_file():
            emit("error", file=str(p), message=f"{p}: not a file")
            code = max(code, 4)
            continue
        try:
            import_file(
                p,
                store=args.store,
                player=args.player,
                plies=args.plies,
                cube_plies=args.cube_plies,
                gnubg=args.gnubg,
                timeout=args.timeout,
                max_answers=args.max_answers,
                replace=args.replace,
                raw_in=args.raw_in,
                raw_out=args.raw_out,
                emit=emit,
            )
        except ImportError_ as e:
            emit("error", file=p.name, message=str(e))
            code = max(code, e.code)
        except GnubgError as e:
            emit("error", file=p.name, message=f"gnubg failed: {e}")
            code = max(code, 3)
        except StoreError as e:
            emit("error", file=p.name, message=str(e))
            code = max(code, 5)
    return code


if __name__ == "__main__":
    sys.exit(main())
