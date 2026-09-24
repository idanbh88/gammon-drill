#!/usr/bin/env python
"""Import Backgammon Galaxy quiz exports (JSON) as lessons for the app's /lessons page: every
picture is downloaded and the set is written into data/lessons/lessons.sqlite.

    uv run import_lessons.py "C:/Temp/bg/*.json"
    uv run import_lessons.py "Medium - Lesson 1 - Double 5s Blitzes.json" --replace
    uv run import_lessons.py copy.json --json --source-name "Medium - Lesson 1.json"   # the app's upload

Files and folders (every ``*.json`` inside) can be mixed; globs are expanded here because
PowerShell does not. A set is kept as data/lessons/<quiz id>/quiz.json (the file as received)
and its pictures as data/lessons/<quiz id>/images/pNN.png (problem NN's position) and
pNN-cM.png (the position after its choice M). The text before the first " - " of the file name
("Medium", "Hard") becomes the set's collection.

A set that is already imported is skipped without touching the network (missing pictures are
counted). ``--replace`` imports it again: pictures on disk that still match are reused and only
missing or changed ones are downloaded, so it is also the way to repair a set. Nothing is
written to the database unless every picture is on disk. The whole data/lessons/ folder is
git-ignored: it is Galaxy's material.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bgpipeline.cli import Emit, ImportError_, expand_paths, json_emit  # noqa: E402
from bgpipeline.galaxy_quiz import SITE, Quiz, QuizError, collection_from_name, image_file, parse_quiz, unknown_losses  # noqa: E402
from bgpipeline.image_fetch import Fetch, ImageError, fetch_png, http_fetch, md5_hex, png_info  # noqa: E402
from bgpipeline.lesson_store import (  # noqa: E402
    DEFAULT_LESSONS_DIR,
    LESSON_STORE_FILE,
    delete_set,
    find_set,
    insert_choice,
    insert_image,
    insert_problem,
    insert_set,
    open_lesson_store,
    owner_of_problem,
    set_images,
)
from bgpipeline.store import StoreError  # noqa: E402

PROGRESS_EVERY = 10


def image_jobs(quiz: Quiz) -> list[tuple[str, str]]:
    """``(path relative to the lessons folder, URL)`` for every picture of the quiz, in order."""
    jobs = []
    for p in quiz.problems:
        jobs.append((f"{quiz.site_id}/images/{image_file(p.number)}", p.image_url))
        for c in p.choices:
            if c.image_url:
                jobs.append((f"{quiz.site_id}/images/{image_file(p.number, c.number)}", c.image_url))
    return jobs


def write_atomic(dest: Path, data: bytes) -> None:
    """Write through a temporary file, so a file under its final name is always complete."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(f"{dest.name}.{os.getpid()}.part")
    part.write_bytes(data)
    for attempt in range(5):
        try:
            os.replace(part, dest)
            return
        except PermissionError:  # Windows: the file is open elsewhere for a moment (the dev server)
            if attempt == 4:
                part.unlink(missing_ok=True)
                raise
            time.sleep(0.2)


def _ensure_one(rel: str, url: str, *, lessons_dir: Path, prior: dict[str, tuple[str, str]], fetch: Fetch, timeout: float) -> dict:
    """One picture on disk: reuse a complete PNG that has no database row yet (an earlier run
    stopped before writing rows) or whose row has the same URL and MD5; download it otherwise."""
    dest = lessons_dir / rel
    if dest.is_file():
        data = dest.read_bytes()
        try:
            info = png_info(data)
        except ImageError:
            info = None
        if info is not None:
            md5 = md5_hex(data)
            known = prior.get(rel)
            if known is None or known == (url, md5):
                return {"path": rel, "url": url, "md5": md5, "bytes": len(data), "width": info.width, "height": info.height, "downloaded": False}
    data, info, md5 = fetch_png(url, fetch=fetch, timeout=timeout)
    write_atomic(dest, data)
    return {"path": rel, "url": url, "md5": md5, "bytes": len(data), "width": info.width, "height": info.height, "downloaded": True}


def ensure_images(
    jobs: list[tuple[str, str]],
    *,
    lessons_dir: Path,
    prior: dict[str, tuple[str, str]],
    fetch: Fetch,
    workers: int,
    timeout: float,
    emit: Emit,
    file: str,
) -> list[dict]:
    """Every picture on disk and checked; results in job order. Fails (exit code 6) only after
    every job ran, so the pictures that did arrive are kept for the next run."""
    results: list[dict] = [{} for _ in jobs]
    failures: list[str] = []
    done = downloaded = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {
            pool.submit(_ensure_one, rel, url, lessons_dir=lessons_dir, prior=prior, fetch=fetch, timeout=timeout): i
            for i, (rel, url) in enumerate(jobs)
        }
        for fut in as_completed(futures):
            i = futures[fut]
            try:
                results[i] = fut.result()
                downloaded += results[i]["downloaded"]
            except (ImageError, OSError) as e:
                failures.append(f"{jobs[i][0]}: {e}")
            done += 1
            if done % PROGRESS_EVERY == 0 or done == len(jobs):
                emit("images", file=file, done=done, total=len(jobs), downloaded=downloaded, reused=done - downloaded - len(failures))
    if failures:
        failures.sort()
        more = f" (and {len(failures) - 1} more)" if len(failures) > 1 else ""
        raise ImportError_(f"{file}: {len(failures)} of {len(jobs)} pictures could not be downloaded: {failures[0]}{more}", code=6)
    return results


def import_file(
    path: Path,
    *,
    lessons_dir: Path = DEFAULT_LESSONS_DIR,
    store: Path | None = None,
    source_name: str | None = None,
    replace: bool = False,
    workers: int = 8,
    timeout: float = 30.0,
    fetch: Fetch | None = None,
    emit: Emit = lambda event, **fields: None,
    now: dt.datetime | None = None,
) -> dict:
    """Import one export. Returns the summary dict; raises ImportError_ / StoreError."""
    name = source_name or path.name
    emit("start", file=name)
    try:
        raw = path.read_bytes()
    except OSError as e:
        raise ImportError_(f"{path}: {e}") from e
    sha = hashlib.sha256(raw).hexdigest()
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except ValueError as e:  # UnicodeDecodeError and JSONDecodeError are ValueErrors
        raise ImportError_(f"{name}: not a JSON file ({e})") from e
    try:
        quiz = parse_quiz(data)
    except QuizError as e:
        raise ImportError_(f"{name}: {e}") from e
    collection = collection_from_name(name)
    jobs = image_jobs(quiz)
    checker = quiz.checker_count
    emit(
        "parsed",
        file=name,
        quiz_id=quiz.site_id,
        name=quiz.name,
        author=quiz.author,
        collection=collection,
        problems=len(quiz.problems),
        checker=checker,
        cube=len(quiz.problems) - checker,
        with_analysis=quiz.with_analysis,
        images=len(jobs),
    )
    warnings = unknown_losses(quiz)
    for problem, choice, desc in warnings:
        emit("warning", file=name, problem=problem, choice=choice, message=f"description {desc!r} is not an equity difference; loss unknown")

    store = store or lessons_dir / LESSON_STORE_FILE
    conn = _open(store)
    try:
        existing = find_set(conn, SITE, quiz.site_id)
        prior = set_images(conn, quiz.site_id)
    finally:
        conn.close()  # no connection is held while downloading
    if existing is not None and not replace:
        missing = sum(1 for rel, _ in jobs if not (lessons_dir / rel).is_file())
        emit("skipped", file=name, quiz_id=quiz.site_id, set_id=existing, reason="already imported (use --replace to import it again)", missing_images=missing)
        return {"skipped": True, "quiz_id": quiz.site_id, "set_id": existing, "missing_images": missing}

    images = ensure_images(
        jobs, lessons_dir=lessons_dir, prior=prior, fetch=fetch or http_fetch, workers=workers, timeout=timeout, emit=emit, file=name
    )
    write_atomic(lessons_dir / quiz.site_id / "quiz.json", raw)
    stamp = (now or dt.datetime.now(dt.timezone.utc)).isoformat(timespec="seconds").replace("+00:00", "Z")

    conn = _open(store)
    try:
        try:
            existing = find_set(conn, SITE, quiz.site_id)
            if existing is not None and not replace:
                raise StoreError(f"{name}: another import wrote this set while the pictures were downloading")
            if existing is not None:
                delete_set(conn, existing)
            set_id = insert_set(
                conn,
                site=SITE,
                site_quiz_id=quiz.site_id,
                name=quiz.name,
                author=quiz.author,
                collection=collection,
                problem_count=len(quiz.problems),
                file_name=name,
                file_sha256=sha,
                imported_at=stamp,
            )
            for img in images:
                insert_image(conn, path=img["path"], url=img["url"], md5=img["md5"], bytes=img["bytes"], width=img["width"], height=img["height"])
            for p in quiz.problems:
                owner = owner_of_problem(conn, p.problem_id)
                if owner is not None:
                    raise StoreError(f"{name}: problem {p.number} ({p.site_id}) already belongs to the set {owner}")
                insert_problem(
                    conn,
                    set_id=set_id,
                    problem_id=p.problem_id,
                    number=p.number,
                    site_problem_id=p.site_id,
                    kind=p.kind,
                    image=f"{quiz.site_id}/images/{image_file(p.number)}",
                    analysis=p.analysis,
                )
                for c in p.choices:
                    insert_choice(
                        conn,
                        problem_id=p.problem_id,
                        number=c.number,
                        site_choice_id=c.site_id,
                        answer=c.answer,
                        description=c.description,
                        loss=c.loss,
                        correct=c.correct,
                        image=f"{quiz.site_id}/images/{image_file(p.number, c.number)}" if c.image_url else None,
                    )
            conn.commit()
        except sqlite3.Error as e:
            raise StoreError(f"{name}: {e}") from e
    finally:
        conn.close()

    downloaded = sum(1 for img in images if img["downloaded"])
    summary = {
        "quiz_id": quiz.site_id,
        "set_id": set_id,
        "name": quiz.name,
        "problems": len(quiz.problems),
        "choices": sum(len(p.choices) for p in quiz.problems),
        "images": len(images),
        "downloaded": downloaded,
        "reused": len(images) - downloaded,
        "bytes": sum(img["bytes"] for img in images),
        "warnings": len(warnings),
        "replaced": existing is not None,
    }
    emit("done", file=name, **summary)
    return summary


def _open(store: Path):
    try:
        return open_lesson_store(store)
    except (sqlite3.Error, OSError) as e:
        raise StoreError(f"{store}: {e}") from e


def _human_emit(event: str, **f) -> None:
    if event == "done":
        print(
            f"{f['file']}: {f['name']} - {f['problems']} problems, {f['images']} pictures "
            f"({f['downloaded']} downloaded, {f['reused']} already here)" + (", replaced" if f.get("replaced") else "")
        )
    elif event == "skipped":
        missing = f.get("missing_images") or 0
        print(f"{f['file']}: skipped, already imported" + (f"; {missing} pictures missing, use --replace to download them" if missing else ""))
    elif event == "parsed":
        print(f"{f['file']}: {f['name']}, {f['problems']} problems ({f['checker']} checker, {f['cube']} cube), {f['images']} pictures", file=sys.stderr)
    elif event == "warning":
        print(f"warning: {f['file']} problem {f['problem']} choice {f['choice']}: {f['message']}", file=sys.stderr)
    elif event == "error":
        print(f"error: {f.get('message')}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", help="quiz exports (.json), folders or globs")
    ap.add_argument("--lessons-dir", type=Path, default=DEFAULT_LESSONS_DIR, help=f"where sets and pictures go (default {DEFAULT_LESSONS_DIR})")
    ap.add_argument("--store", type=Path, default=None, help="lesson database (default <lessons-dir>/lessons.sqlite)")
    ap.add_argument("--replace", action="store_true", help="import a set again that is already imported (also repairs its pictures)")
    ap.add_argument("--source-name", help="the file's original name when importing a copy (the app's upload); one file only")
    ap.add_argument("--workers", type=int, default=8, help="parallel downloads (default 8)")
    ap.add_argument("--timeout", type=float, default=30.0, help="seconds per download attempt (default 30)")
    ap.add_argument("--json", action="store_true", help="print progress as NDJSON on stdout")
    args = ap.parse_args(argv)

    if not args.json:
        for stream in (sys.stdout, sys.stderr):
            reconfigure = getattr(stream, "reconfigure", None)
            if reconfigure:
                reconfigure(errors="replace")  # a quiz name the console code page cannot show
    emit: Emit = json_emit if args.json else _human_emit
    paths = expand_paths(args.paths, "*.json")
    if not paths:
        emit("error", message="no .json files found")
        return 4
    if args.source_name and len(paths) != 1:
        emit("error", message="--source-name needs exactly one file")
        return 4

    code = 0
    counts = {"imported": 0, "skipped": 0, "failed": 0}
    for p in paths:
        label = args.source_name or p.name
        if not p.is_file():
            emit("error", file=str(p), message=f"{p}: not a file")
            code = max(code, 4)
            counts["failed"] += 1
            continue
        try:
            summary = import_file(
                p,
                lessons_dir=args.lessons_dir,
                store=args.store,
                source_name=args.source_name,
                replace=args.replace,
                workers=args.workers,
                timeout=args.timeout,
                emit=emit,
            )
            counts["skipped" if summary.get("skipped") else "imported"] += 1
        except ImportError_ as e:
            emit("error", file=label, message=str(e))
            code = max(code, e.code)
            counts["failed"] += 1
        except StoreError as e:
            emit("error", file=label, message=str(e))
            code = max(code, 5)
            counts["failed"] += 1
    if not args.json and len(paths) > 1:
        print(f"{len(paths)} files: {counts['imported']} imported, {counts['skipped']} skipped, {counts['failed']} failed")
    return code


if __name__ == "__main__":
    sys.exit(main())
