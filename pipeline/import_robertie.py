#!/usr/bin/env python
"""Import Bill Robertie's "501 Essential Backgammon Problems" from the user's scan into
data/robertie/robertie.sqlite for the app's /robertie section and the quiz.

    uv run import_robertie.py "C:/Users/<me>/Downloads/<scan>.pdf"                # every stage, no paid calls
    uv run import_robertie.py "<pdf>" --spend                                     # + Claude's readings, directly, 4 at a time
    uv run import_robertie.py "<pdf>" --spend --batch                             # the same through the batch API
    uv run import_robertie.py "<pdf>" --spend --only s011-R,s003-L-1              # a few Claude readings, directly
    uv run import_robertie.py "<pdf>" --stages assemble,gnubg,store,report        # after editing fixes.json

Stages, in order (``--stages`` picks some; each reuses what earlier runs left on disk):

  pages      the PDF's page images, turned upright, cut at the spine, lighting evened out
  diagrams   every board found on a page, cropped (diagrams/<page>-<n>.png)
  claude     Claude reads every page (captions, solutions, Robertie's answers) and every enlarged
             diagram (a second, independent count). Paid: runs only with --spend; answers are
             cached, so nothing is ever paid for twice. Direct requests by default; --batch
             uses the Message Batches API (half price, but batches have sat for hours).
  local      the local board reader counts every diagram (readings/local.json)
  assemble   captions, solutions, both readings and fixes.json into one problem per number, with
             the XGID and a status (ok / fixed / check); readings/assembled.json for inspection
  gnubg      gnubg analyses the accepted problems (every play at full depth) and scores
             Robertie's answer; disagreements are analysed again at --recheck-plies
  store      writes robertie.sqlite (the app's own tables in it are kept)
  report     statuses, agreement with gnubg, what needs a look (report.json)

Everything goes under data/robertie/, which is git-ignored: it is the book's material and the
repository is public. fixes.json there is written by hand (see bgpipeline/robertie.py).

Exit codes: 2 no gnubg, 3 gnubg failed, 4 the PDF could not be read, 5 store error, 6 Claude error.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bgpipeline.cli import Emit, json_emit  # noqa: E402
from bgpipeline.store import ROOT, StoreError  # noqa: E402

STAGES = ["pages", "diagrams", "claude", "local", "assemble", "gnubg", "store", "report"]
DEFAULT_BOOK_DIR = ROOT / "data" / "robertie"
DIAGRAMS_INDEX = "diagrams.json"
ASSEMBLED = "readings/assembled.json"
BOARD_SCALE = 2


def _human_emit(event: str, **f) -> None:
    if event in ("error", "warning"):
        print(f"{event}: {f.get('message')}", file=sys.stderr)
    elif event == "log":
        print(f.get("message"), file=sys.stderr)
    else:
        print(f"{event}: " + ", ".join(f"{k}={v}" for k, v in f.items()))


# --- stages -------------------------------------------------------------------------------


def stage_pages(pdf: Path, book: Path, emit: Emit):
    from bgpipeline.pdf_pages import extract_pages

    pages = extract_pages(pdf, book, log=lambda m: emit("log", message=m))
    emit("pages", pages=len(pages), blank=sum(p.blank for p in pages))
    return pages


def stage_diagrams(book: Path, pages, emit: Emit) -> dict[str, dict]:
    from bgpipeline import board_reader as br
    from bgpipeline.pdf_pages import load_page, write_png

    (book / "diagrams").mkdir(parents=True, exist_ok=True)
    index = {}
    for p in pages:
        if p.blank:
            continue
        page = load_page(book, p)
        for i, b in enumerate(br.find_boards(page), 1):
            crop, box = br.diagram_crop(page, b)
            key = f"{p.name}-{i}"
            write_png(book / "diagrams" / f"{key}.png", crop)
            index[key] = {"page": p.name, "n": i, "box": [box.x, box.y, box.w, box.h]}
    (book / DIAGRAMS_INDEX).write_text(json.dumps(index, indent=0), encoding="utf-8")
    emit("diagrams", diagrams=len(index))
    return index


def _claude_items(book: Path, pages, diagrams: dict[str, dict]):
    import cv2

    from bgpipeline import claude_pages as cp
    from bgpipeline.pdf_pages import read_gray

    items = [cp.Item("page", p.name, (book / p.file).read_bytes()) for p in pages if not p.blank]
    for key in diagrams:
        crop = read_gray(book / "diagrams" / f"{key}.png")
        big = cv2.resize(crop, None, fx=BOARD_SCALE, fy=BOARD_SCALE, interpolation=cv2.INTER_CUBIC)
        ok, buf = cv2.imencode(".jpg", big, [cv2.IMWRITE_JPEG_QUALITY, 92])
        items.append(cp.Item("board", key, buf.tobytes()))
    return items


def stage_claude(book: Path, pages, diagrams, *, spend: bool, batch: bool, only: list[str] | None, model: str, emit: Emit) -> int:
    from bgpipeline import claude_pages as cp

    items = _claude_items(book, pages, diagrams)
    if only:
        items = [it for it in items if it.key in only]
    todo = [it for it in items if cp.load_cached(book, it.kind, it.key) is None]
    per = {"page": (4800, 1100), "board": (2900, 650)}  # measured tokens per request (in, out)
    pin, pout = cp.PRICES.get(model, cp.PRICES[cp.MODEL])
    estimate = sum((per[it.kind][0] * pin + per[it.kind][1] * pout) / 1e6 for it in todo) * (0.5 if batch else 1.0)
    if not todo:
        emit("claude", pending=0, message="every reading is cached")
        return 0
    if not spend:
        emit("pending", requests=len(todo), estimate_usd=round(estimate, 2), message="paid stage skipped; add --spend to run it")
        return 0
    if not cp.load_api_key(ROOT):
        emit("error", message="no ANTHROPIC_API_KEY in the environment or the repo-root .env")
        return 6
    import anthropic

    client = anthropic.Anthropic()
    emit("claude", requests=len(todo), estimate_usd=round(estimate, 2), batch=batch)
    if batch:
        answers = cp.run_batches(client, todo, book, model=model, chunk=10, log=lambda m: emit("log", message=m))
    else:
        answers = cp.read_many_direct(client, todo, book, model=model, workers=4, log=lambda m: emit("log", message=m))
    failed = [a for a in answers if a.reading is None]
    emit("claude", done=len(answers) - len(failed), failed=len(failed), cost_usd=round(cp.cost(answers), 2), failed_keys=[f"{a.kind}-{a.key}" for a in failed][:50])
    return 6 if failed else 0


def stage_local(book: Path, diagrams, emit: Emit) -> dict[str, dict]:
    from bgpipeline import board_reader as br

    readings = br.read_diagram_files(book / "diagrams", sorted(diagrams))
    (book / "readings").mkdir(parents=True, exist_ok=True)
    (book / "readings" / "local.json").write_text(json.dumps(readings, indent=0), encoding="utf-8")
    ok = sum(1 for r in readings.values() if not r["issues"])
    emit("local", diagrams=len(readings), clean=ok)
    return readings


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def stage_assemble(book: Path, pages, emit: Emit):
    from bgpipeline import claude_pages as cp
    from bgpipeline.robertie import assemble, load_fixes

    page_readings, boards = {}, {}
    for p in pages:
        c = cp.load_cached(book, "page", p.name)
        if c:
            page_readings[p.name] = c["reading"]
    for f in sorted((book / cp.CACHE_DIR / "board").glob("*.json")):
        c = cp.load_cached(book, "board", f.stem)
        if c:
            boards[f.stem] = c["reading"]
    local = load_json(book / "readings" / "local.json", {})
    chapters, problems, notes = assemble(book, pages, page_readings, local, boards, load_fixes(book))
    out = {"chapters": [c.__dict__ | {"categories": c.categories} for c in chapters], "notes": notes, "problems": [p.to_json() for p in problems]}
    (book / ASSEMBLED).parent.mkdir(parents=True, exist_ok=True)
    (book / ASSEMBLED).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = {s: sum(p.status == s for p in problems) for s in ("ok", "fixed", "check")}
    emit("assemble", chapters=len(chapters), **counts, notes=len(notes))
    return chapters, problems, notes


def _gnubg_cache(book: Path, plies: int) -> Path:
    return book / "gnubg" / f"{plies}-ply.json"


def run_engine(book: Path, xgids: list[str], *, plies: int, full_width: bool, gnubg: str | None, timeout: float | None, emit: Emit) -> dict[str, dict]:
    """gnubg's raw record per XGID, cached per depth so an unchanged position is never analysed
    twice."""
    from bgpipeline.gnubg_runner import run_gnubg

    path = _gnubg_cache(book, plies)
    cache = load_json(path, {})
    todo = sorted(set(x for x in xgids if x not in cache))
    if todo:
        t = time.time()
        for rec in run_gnubg(todo, plies=plies, gnubg=gnubg, timeout=timeout, full_width=full_width, log=lambda m: emit("log", message=m)):
            cache[rec["xgid"]] = rec
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(cache), encoding="utf-8")
        emit("gnubg", plies=plies, analysed=len(todo), seconds=round(time.time() - t))
    return cache


def stage_gnubg(book: Path, problems, *, plies: int, recheck: int, gnubg: str | None, timeout: float | None, emit: Emit) -> list[dict]:
    from bgpipeline.book_score import agreement, score_problem

    playable = [p for p in problems if p.status in ("ok", "fixed") and p.xgid]
    today = dt.date.today()
    raw = run_engine(book, [p.xgid for p in playable], plies=plies, full_width=True, gnubg=gnubg, timeout=timeout, emit=emit)
    analyses = [score_problem(p, raw.get(p.xgid), plies=plies, today=today) for p in playable]
    disputed = [p for p, a in zip(playable, analyses) if agreement(a["book_loss"]) in ("differs", "blunder")]
    if recheck and recheck > plies and disputed:
        deep = run_engine(book, [p.xgid for p in disputed], plies=recheck, full_width=True, gnubg=gnubg, timeout=timeout, emit=emit)
        analyses += [score_problem(p, deep.get(p.xgid), plies=recheck, today=today) for p in disputed]
    return analyses


def stage_store(book: Path, pdf: Path, pages, chapters, problems, analyses, emit: Emit) -> None:
    from bgpipeline.pdf_pages import file_sha256
    from bgpipeline.robertie_store import STORE_NAME, app_rows, open_robertie_store, replace_book

    path = book / STORE_NAME
    try:
        conn = open_robertie_store(path)
        try:
            replace_book(
                conn,
                source={"file_name": pdf.name, "file_sha256": file_sha256(pdf), "pages": len(pages)},
                chapters=chapters,
                problems=problems,
                analyses=analyses,
            )
            kept = app_rows(conn)
        finally:
            conn.close()
    except (sqlite3.Error, OSError) as e:
        raise StoreError(f"{path}: {e}") from e
    emit("store", file=str(path), problems=len(problems), analyses=len(analyses), app_rows_kept=kept)


def stage_report(book: Path, chapters, problems, analyses, notes, emit: Emit) -> None:
    from bgpipeline.book_score import agreement

    deepest: dict[int, dict] = {}
    for a in analyses:
        if a["number"] not in deepest or a["plies"] > deepest[a["number"]]["plies"]:
            deepest[a["number"]] = a
    marks: dict[str, int] = {}
    for a in deepest.values():
        m = agreement(a["book_loss"]) or "unscored"
        marks[m] = marks.get(m, 0) + 1
    worst = sorted((a for a in deepest.values() if a["book_loss"]), key=lambda a: -a["book_loss"])[:20]
    report = {
        "chapters": [{"number": c.number, "title": c.title, "problems": [c.first_problem, c.last_problem]} for c in chapters],
        "status": {s: sum(p.status == s for p in problems) for s in ("ok", "fixed", "check")},
        "agreement": marks,
        "largest_disagreements": [{"number": a["number"], "book": a["book_answer_id"], "best": a["best_answer_id"], "loss": a["book_loss"], "plies": a["plies"]} for a in worst],
        "check": [{"number": p.number, "issues": p.issues} for p in problems if p.status == "check"],
        "notes": notes,
    }
    (book / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    emit("report", **report["status"], agreement=marks, file=str(book / "report.json"))


# --- main ---------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path, help="the scanned book (PDF)")
    ap.add_argument("--book-dir", type=Path, default=DEFAULT_BOOK_DIR, help=f"where everything goes (default {DEFAULT_BOOK_DIR})")
    ap.add_argument("--stages", default=",".join(STAGES), help=f"comma-separated subset of {','.join(STAGES)}")
    ap.add_argument("--spend", action="store_true", help="allow the paid Claude stage to send requests")
    ap.add_argument("--batch", action="store_true", help="send Claude requests through the Message Batches API (half price, can take hours) instead of directly")
    ap.add_argument("--only", help="comma-separated page or diagram keys for the Claude stage (s011-R, s003-L-1)")
    ap.add_argument("--model", default="claude-opus-5", help="Claude model for the readings (default claude-opus-5)")
    ap.add_argument("--plies", type=int, default=2, help="gnubg depth for every problem (default 2)")
    ap.add_argument("--recheck-plies", type=int, default=3, help="depth for disagreements with the book (default 3; 0 = none)")
    ap.add_argument("--gnubg", help="path to gnubg-cli (default: BG_GNUBG, PATH, C:\\gnubg)")
    ap.add_argument("--timeout", type=float, default=None, help="seconds for one gnubg run")
    ap.add_argument("--json", action="store_true", help="print progress as NDJSON on stdout")
    args = ap.parse_args(argv)

    if not args.json:
        for stream in (sys.stdout, sys.stderr):
            reconfigure = getattr(stream, "reconfigure", None)
            if reconfigure:
                reconfigure(errors="replace")  # the console code page cannot show every character
    emit: Emit = json_emit if args.json else _human_emit
    stages = [s.strip() for s in args.stages.split(",") if s.strip()]
    unknown = [s for s in stages if s not in STAGES]
    if unknown:
        emit("error", message=f"unknown stages: {', '.join(unknown)}")
        return 4
    book = args.book_dir
    book.mkdir(parents=True, exist_ok=True)

    from bgpipeline.pdf_pages import PagesError, read_index

    code = 0
    try:
        pages = stage_pages(args.pdf, book, emit) if "pages" in stages else read_index(book)
    except (PagesError, OSError) as e:
        emit("error", message=f"{args.pdf}: {e}")
        return 4
    if not pages:
        emit("error", message="no pages yet: run the pages stage first")
        return 4
    diagrams = stage_diagrams(book, pages, emit) if "diagrams" in stages else load_json(book / DIAGRAMS_INDEX, {})
    if "claude" in stages:
        code = max(code, stage_claude(book, pages, diagrams, spend=args.spend, batch=args.batch, only=args.only.split(",") if args.only else None, model=args.model, emit=emit))
    if "local" in stages:
        stage_local(book, diagrams, emit)
    if not ({"assemble", "gnubg", "store", "report"} & set(stages)):
        return code
    chapters, problems, notes = stage_assemble(book, pages, emit)
    analyses: list[dict] = []
    if {"gnubg", "store", "report"} & set(stages):
        from bgpipeline.gnubg_runner import GnubgError, find_gnubg

        if "gnubg" in stages and not find_gnubg(args.gnubg):
            emit("error", message="gnubg-cli not found; pass --gnubg or set BG_GNUBG")
            return 2
        try:
            if "gnubg" in stages:
                analyses = stage_gnubg(book, problems, plies=args.plies, recheck=args.recheck_plies, gnubg=args.gnubg, timeout=args.timeout, emit=emit)
            else:
                analyses = _cached_analyses(book, problems, plies=args.plies, recheck=args.recheck_plies)
        except GnubgError as e:
            emit("error", message=str(e))
            return 3
    if "store" in stages:
        try:
            stage_store(book, args.pdf, pages, chapters, problems, analyses, emit)
        except StoreError as e:
            emit("error", message=str(e))
            return 5
    if "report" in stages:
        stage_report(book, chapters, problems, analyses, notes, emit)
    return code


def _cached_analyses(book: Path, problems, *, plies: int, recheck: int) -> list[dict]:
    """Analyses from the cached gnubg records only (store/report without the gnubg stage)."""
    from bgpipeline.book_score import agreement, score_problem

    today = dt.date.today()
    shallow = load_json(_gnubg_cache(book, plies), {})
    deep = load_json(_gnubg_cache(book, recheck), {}) if recheck and recheck > plies else {}
    out = []
    for p in problems:
        if p.status not in ("ok", "fixed") or not p.xgid or p.xgid not in shallow:
            continue
        a = score_problem(p, shallow[p.xgid], plies=plies, today=today)
        out.append(a)
        if p.xgid in deep and agreement(a["book_loss"]) in ("differs", "blunder"):
            out.append(score_problem(p, deep[p.xgid], plies=recheck, today=today))
    return out


if __name__ == "__main__":
    sys.exit(main())
