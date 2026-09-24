"""``data/store.sqlite`` from Python, with the standard library.

The schema has one home, ``src/lib/store-schema.ts``; this module reads ``SCHEMA_VERSION`` and
``SCHEMA_SQL`` out of that file, so the app and the importer cannot drift apart. Every schema
version so far is additive, so opening a file runs the DDL and bumps ``meta.schema_version``,
exactly like ``openStore`` in ``src/lib/store.ts``.

Explanations are never touched here. Match rows are reproducible engine output, so
``delete_match`` exists for a re-import.
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_TS = ROOT / "src" / "lib" / "store-schema.ts"
DEFAULT_STORE = ROOT / "data" / "store.sqlite"

_VERSION = re.compile(r"SCHEMA_VERSION\s*=\s*(\d+)")
_SQL = re.compile(r"SCHEMA_SQL\s*=\s*`([^`]*)`")
_ADDED = re.compile(r"ADDED_COLUMNS\s*=\s*`([^`]*)`")


class StoreError(RuntimeError):
    pass


def schema_from_ts(path: Path = SCHEMA_TS) -> tuple[int, str]:
    """``(SCHEMA_VERSION, SCHEMA_SQL)`` read out of the TypeScript source."""
    text = path.read_text(encoding="utf-8")
    vm = _VERSION.search(text)
    sm = _SQL.search(text)
    if not vm or not sm:
        raise StoreError(f"{path}: cannot find SCHEMA_VERSION and SCHEMA_SQL")
    return int(vm.group(1)), sm.group(1)


def added_columns_from_ts(path: Path = SCHEMA_TS) -> list[tuple[str, str, str]]:
    """``ADDED_COLUMNS`` from the TypeScript source as (table, column, type); none when absent."""
    m = _ADDED.search(path.read_text(encoding="utf-8"))
    out = []
    for line in (m.group(1) if m else "").splitlines():
        parts = line.split()
        if len(parts) >= 3:
            out.append((parts[0], parts[1], " ".join(parts[2:])))
    return out


def open_store(
    path: Path,
    schema: tuple[int, str] | None = None,
    added: list[tuple[str, str, str]] | None = None,
) -> sqlite3.Connection:
    """Open (creating or upgrading) the store. Refuses a file newer than this schema.

    CREATE TABLE IF NOT EXISTS leaves an older table as it is, so the columns listed in
    ``ADDED_COLUMNS`` are added when missing (the main store's, unless ``schema`` is given)."""
    if added is None:
        added = [] if schema is not None else added_columns_from_ts()
    version, sql = schema or schema_from_ts()
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(sql)
        for table, column, typ in added:
            existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {typ}")
        conn.execute("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)", (str(version),))
        (current,) = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
        current = int(current)
        if current < 1 or current > version:
            raise StoreError(f"{path}: schema version {current}, this pipeline expects {version}")
        if current < version:
            conn.execute("UPDATE meta SET value = ? WHERE key = 'schema_version'", (str(version),))
        conn.commit()
    except Exception:
        conn.close()
        raise
    return conn


def schema_version(conn: sqlite3.Connection) -> int:
    (value,) = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    return int(value)


def find_match(conn: sqlite3.Connection, site: str, site_match_id: str) -> int | None:
    row = conn.execute("SELECT id FROM matches WHERE site = ? AND site_match_id = ?", (site, site_match_id)).fetchone()
    return int(row[0]) if row else None


def delete_match(conn: sqlite3.Connection, match_id: int) -> None:
    conn.execute("DELETE FROM decisions WHERE match_id = ?", (match_id,))
    conn.execute("DELETE FROM games WHERE match_id = ?", (match_id,))
    conn.execute("DELETE FROM matches WHERE id = ?", (match_id,))


def insert_match(
    conn: sqlite3.Connection,
    *,
    site: str,
    site_match_id: str,
    player1: str,
    player2: str,
    match_length: int,
    played_at: str | None,
    file_name: str,
    file_sha256: str,
    mat_text: str,
    analysed_player: int,
    engine: str,
    plies: int,
    imported_at: str,
) -> int:
    cur = conn.execute(
        "INSERT INTO matches (site, site_match_id, player1, player2, match_length, played_at, file_name, file_sha256, mat_text, "
        "analysed_player, engine, plies, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (site, site_match_id, player1, player2, match_length, played_at, file_name, file_sha256, mat_text, analysed_player, engine, plies, imported_at),
    )
    return int(cur.lastrowid)


def insert_game(
    conn: sqlite3.Connection,
    *,
    match_id: int,
    number: int,
    score1: int,
    score2: int,
    crawford: bool,
    winner: int | None,
    points: int | None,
) -> int:
    cur = conn.execute(
        "INSERT INTO games (match_id, number, score1, score2, crawford, winner, points) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (match_id, number, score1, score2, 1 if crawford else 0, winner, points),
    )
    return int(cur.lastrowid)


DECISION_COLUMNS = (
    "match_id, game_id, decision_id, game_number, move_number, player, kind, xgid, dice, played, played_answer_id, "
    "best_answer_id, best_equity, played_equity, loss, forced, position_class, categories, features, answers, plies, analysed_at"
)


def insert_decision(conn: sqlite3.Connection, row: dict) -> int:
    """``row`` uses the column names; ``categories`` / ``features`` / ``answers`` are given as
    Python values and stored as JSON."""
    values = (
        row["match_id"],
        row["game_id"],
        row["decision_id"],
        row["game_number"],
        row["move_number"],
        row["player"],
        row["kind"],
        row["xgid"],
        row.get("dice"),
        row["played"],
        row.get("played_answer_id"),
        row.get("best_answer_id"),
        row.get("best_equity"),
        row.get("played_equity"),
        row.get("loss"),
        1 if row.get("forced") else 0,
        row.get("position_class"),
        json.dumps(row.get("categories") or []),
        json.dumps(row["features"]) if row.get("features") is not None else None,
        json.dumps(row.get("answers") or []),
        row["plies"],
        row["analysed_at"],
    )
    cur = conn.execute(f"INSERT INTO decisions ({DECISION_COLUMNS}) VALUES ({', '.join('?' * 22)})", values)
    return int(cur.lastrowid)


def match_summary(conn: sqlite3.Connection, match_id: int, *, error: float = 0.02, blunder: float = 0.08) -> dict:
    row = conn.execute(
        "SELECT SUM(CASE WHEN forced = 0 THEN 1 ELSE 0 END) AS decisions, "
        "SUM(CASE WHEN forced <> 0 THEN 1 ELSE 0 END) AS forced, "
        "SUM(CASE WHEN loss >= ? THEN 1 ELSE 0 END) AS errors, "
        "SUM(CASE WHEN loss >= ? THEN 1 ELSE 0 END) AS blunders, "
        "COALESCE(SUM(loss), 0) AS total_loss, "
        "SUM(CASE WHEN forced = 0 AND loss IS NULL THEN 1 ELSE 0 END) AS unscored "
        "FROM decisions WHERE match_id = ?",
        (error, blunder, match_id),
    ).fetchone()
    return {
        "decisions": int(row["decisions"] or 0),
        "forced": int(row["forced"] or 0),
        "errors": int(row["errors"] or 0),
        "blunders": int(row["blunders"] or 0),
        "totalLoss": round(float(row["total_loss"] or 0.0), 4),
        "unscored": int(row["unscored"] or 0),
    }
