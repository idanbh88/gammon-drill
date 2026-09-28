"""``data/robertie/robertie.sqlite`` from Python, with the standard library.

The schema's one home is ``src/lib/robertie-store-schema.ts`` (read here by regex, like the main
store's). The importer owns robertie_source, robertie_chapters, robertie_problems and
robertie_analyses and rewrites them on every import, in one transaction; the tables the app
writes (explanations, translations, robertie_translations, robertie_reports) are never touched.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .store import ROOT, added_columns_from_ts, open_store, schema_from_ts

SCHEMA_TS = ROOT / "src" / "lib" / "robertie-store-schema.ts"
STORE_NAME = "robertie.sqlite"
IMPORTER_TABLES = ("robertie_source", "robertie_chapters", "robertie_problems", "robertie_analyses")


def open_robertie_store(path: Path) -> sqlite3.Connection:
    conn = open_store(path, schema_from_ts(SCHEMA_TS), added_columns_from_ts(SCHEMA_TS))
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def _j(x) -> str | None:
    return None if x is None else json.dumps(x, ensure_ascii=False)


def sha256(text: str | None) -> str | None:
    return None if text is None else hashlib.sha256(text.encode("utf-8")).hexdigest()


def replace_book(conn: sqlite3.Connection, *, source: dict, chapters: list, problems: list, analyses: list[dict]) -> None:
    """Rewrites the importer's tables in one transaction. ``chapters`` are ``robertie.Chapter``,
    ``problems`` ``robertie.BookProblem``, ``analyses`` dicts with the robertie_analyses columns."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with conn:
        for t in IMPORTER_TABLES:
            conn.execute(f"DELETE FROM {t}")
        conn.execute(
            "INSERT INTO robertie_source (id, file_name, file_sha256, pages, imported_at) VALUES (1, ?, ?, ?, ?)",
            (source["file_name"], source["file_sha256"], source["pages"], now),
        )
        for c in chapters:
            conn.execute(
                "INSERT INTO robertie_chapters (number, title, first_problem, last_problem, categories, intro_page) VALUES (?, ?, ?, ?, ?, ?)",
                (c.number, c.title, c.first_problem, c.last_problem, _j(c.categories), c.intro_page),
            )
        for p in problems:
            conn.execute(
                """INSERT INTO robertie_problems (number, problem_id, chapter, kind, caption, dice, problem_page, diagram,
                   solution_pages, solution, solution_sha256, play_as_printed, cube_verdict, book_answer, reading_status,
                   reading_issues, reading_local, reading_claude, fix, xgid, imported_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    p.number, p.problem_id, p.chapter, p.kind, p.caption, p.dice, p.problem_page, p.diagram,
                    _j(p.solution_pages), p.solution, sha256(p.solution), p.play_as_printed, _j(p.cube_verdict), p.book_answer,
                    p.status, _j(p.issues), _j(p.local), _j(p.claude), _j(p.fix), p.xgid, now,
                ),
            )
        for a in analyses:
            conn.execute(
                """INSERT INTO robertie_analyses (number, plies, engine, analysed_at, position_class, categories, features,
                   answers, best_answer_id, book_answer_id, book_loss, book_full_depth, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    a["number"], a["plies"], a.get("engine", "gnubg"), a["analysed_at"], a.get("position_class"),
                    _j(a.get("categories", [])), _j(a.get("features")), _j(a["answers"]), a["best_answer_id"],
                    a.get("book_answer_id"), a.get("book_loss"), 1 if a.get("book_full_depth", True) else 0, a.get("notes"),
                ),
            )


def app_rows(conn: sqlite3.Connection) -> dict[str, int]:
    """Row counts of the app's tables (the report shows them; a re-import keeps them)."""
    out = {}
    for t in ("explanations", "translations", "robertie_translations", "robertie_reports"):
        out[t] = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    return out
