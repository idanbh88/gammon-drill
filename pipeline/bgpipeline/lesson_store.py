"""``data/lessons/lessons.sqlite`` from Python, with the standard library.

A separate database from data/store.sqlite on purpose: the lessons are Backgammon Galaxy's
material, so the whole data/lessons/ folder (this file, the original exports and their
pictures) is git-ignored, while store.sqlite is committed. The schema lives in
``src/lib/lesson-store-schema.ts`` and is read from there like the main store's
(``store.schema_from_ts``), so the app and the importer cannot drift apart.

Lesson rows are a copy of an export, so a re-import may delete and rewrite one set
(``delete_set``); the pictures on disk are kept and reused. None of these functions commit.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from .store import ROOT, open_store, schema_from_ts

LESSON_SCHEMA_TS = ROOT / "src" / "lib" / "lesson-store-schema.ts"
DEFAULT_LESSONS_DIR = ROOT / "data" / "lessons"
LESSON_STORE_FILE = "lessons.sqlite"


def open_lesson_store(path: Path) -> sqlite3.Connection:
    """Open (creating the folder and the file, or upgrading) the lesson database."""
    path.parent.mkdir(parents=True, exist_ok=True)
    return open_store(path, schema_from_ts(LESSON_SCHEMA_TS))


def find_set(conn: sqlite3.Connection, site: str, site_quiz_id: str) -> int | None:
    row = conn.execute("SELECT id FROM lesson_sets WHERE site = ? AND site_quiz_id = ?", (site, site_quiz_id)).fetchone()
    return int(row[0]) if row else None


def set_images(conn: sqlite3.Connection, site_quiz_id: str) -> dict[str, tuple[str, str]]:
    """``path -> (url, md5)`` of the pictures stored for one quiz (their paths start with its id)."""
    rows = conn.execute("SELECT path, url, md5 FROM lesson_images WHERE path LIKE ?", (f"{site_quiz_id}/%",)).fetchall()
    return {r[0]: (r[1], r[2]) for r in rows}


def owner_of_problem(conn: sqlite3.Connection, problem_id: str) -> str | None:
    """Quiz id of the set that already holds this problem, if any."""
    row = conn.execute(
        "SELECT s.site_quiz_id FROM lesson_problems p JOIN lesson_sets s ON s.id = p.set_id WHERE p.problem_id = ?",
        (problem_id,),
    ).fetchone()
    return row[0] if row else None


def delete_set(conn: sqlite3.Connection, set_id: int) -> None:
    """Delete one set's rows. The schema has no foreign keys (Python's sqlite3 would not enforce
    them anyway), so the children go explicitly: choices, problems, pictures, then the set."""
    row = conn.execute("SELECT site_quiz_id FROM lesson_sets WHERE id = ?", (set_id,)).fetchone()
    if row is None:
        return
    conn.execute("DELETE FROM lesson_choices WHERE problem_id IN (SELECT problem_id FROM lesson_problems WHERE set_id = ?)", (set_id,))
    conn.execute("DELETE FROM lesson_problems WHERE set_id = ?", (set_id,))
    conn.execute("DELETE FROM lesson_images WHERE path LIKE ?", (f"{row[0]}/%",))
    conn.execute("DELETE FROM lesson_sets WHERE id = ?", (set_id,))


def insert_set(
    conn: sqlite3.Connection,
    *,
    site: str,
    site_quiz_id: str,
    name: str,
    author: str | None,
    collection: str | None,
    problem_count: int,
    file_name: str,
    file_sha256: str,
    imported_at: str,
) -> int:
    cur = conn.execute(
        "INSERT INTO lesson_sets (site, site_quiz_id, name, author, collection, problem_count, file_name, file_sha256, imported_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (site, site_quiz_id, name, author, collection, problem_count, file_name, file_sha256, imported_at),
    )
    return int(cur.lastrowid)


def insert_problem(
    conn: sqlite3.Connection,
    *,
    set_id: int,
    problem_id: str,
    number: int,
    site_problem_id: str,
    kind: str,
    image: str,
    analysis: str | None,
) -> None:
    conn.execute(
        "INSERT INTO lesson_problems (set_id, problem_id, number, site_problem_id, kind, image, analysis) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (set_id, problem_id, number, site_problem_id, kind, image, analysis),
    )


def insert_choice(
    conn: sqlite3.Connection,
    *,
    problem_id: str,
    number: int,
    site_choice_id: str,
    answer: str,
    description: str | None,
    loss: float | None,
    correct: bool,
    image: str | None,
) -> None:
    conn.execute(
        "INSERT INTO lesson_choices (problem_id, number, site_choice_id, answer, description, loss, correct, image) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (problem_id, number, site_choice_id, answer, description, loss, 1 if correct else 0, image),
    )


def insert_image(conn: sqlite3.Connection, *, path: str, url: str, md5: str, bytes: int, width: int, height: int) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO lesson_images (path, url, md5, bytes, width, height) VALUES (?, ?, ?, ?, ?, ?)",
        (path, url, md5, bytes, width, height),
    )


def set_summary(conn: sqlite3.Connection, set_id: int) -> dict:
    problems = conn.execute("SELECT COUNT(*) FROM lesson_problems WHERE set_id = ?", (set_id,)).fetchone()[0]
    choices = conn.execute(
        "SELECT COUNT(*) FROM lesson_choices WHERE problem_id IN (SELECT problem_id FROM lesson_problems WHERE set_id = ?)",
        (set_id,),
    ).fetchone()[0]
    return {"problems": int(problems), "choices": int(choices)}
