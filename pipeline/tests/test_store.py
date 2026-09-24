"""The app and the importer share data/store.sqlite: the schema is read out of
src/lib/store-schema.ts, the committed file must open with the standard library, and an older
file is upgraded in place."""

import sqlite3
from pathlib import Path

import pytest

from bgpipeline.store import (
    StoreError,
    delete_match,
    find_match,
    insert_decision,
    insert_game,
    insert_match,
    match_summary,
    added_columns_from_ts,
    open_store,
    schema_from_ts,
    schema_version,
)

STORE = Path(__file__).resolve().parents[2] / "data" / "store.sqlite"
SEEDS = {"seed-001", "seed-002", "seed-003", "seed-004", "seed-005"}
XGID = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10"


def test_schema_comes_from_the_typescript_file():
    version, sql = schema_from_ts()
    assert version >= 2
    for table in ("meta", "explanations", "translations", "matches", "games", "decisions"):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in sql


def test_committed_store_is_readable_with_stdlib_sqlite3():
    assert STORE.is_file(), STORE
    version, _ = schema_from_ts()
    conn = sqlite3.connect(str(STORE))  # non-ASCII path: Python passes it as UTF-8, sqlite handles it
    try:
        (stored,) = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
        assert stored == str(version)
        cols = [row[1] for row in conn.execute("PRAGMA table_info(explanations)")]
        assert cols[:3] == ["id", "xgid", "problem_id"]
        for needed in ("model", "prompt_version", "explanation", "raw_text", "generated_at", "served_by_fallback"):
            assert needed in cols
        rows = conn.execute("SELECT problem_id, model, prompt_version, length(explanation) FROM explanations ORDER BY id").fetchall()
        assert len(rows) >= 5
        assert {r[0] for r in rows} >= SEEDS
        assert all(r[3] > 0 for r in rows)
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        assert {"matches", "games", "decisions"} <= tables
    finally:
        conn.close()
    assert not STORE.with_name("store.sqlite-journal").exists()


def _decision(match_id, game_id, n, **over):
    row = {
        "match_id": match_id,
        "game_id": game_id,
        "decision_id": f"match-1-g1-m{n}-checker",
        "game_number": 1,
        "move_number": n,
        "player": 1,
        "kind": "checker",
        "xgid": XGID,
        "dice": "31",
        "played": "24/23 13/9",
        "played_answer_id": "24/23 13/9",
        "best_answer_id": "8/5 6/5",
        "best_equity": 0.22,
        "played_equity": 0.05,
        "loss": 0.17,
        "forced": False,
        "position_class": "contact",
        "categories": ["opening"],
        "features": {"pips_me": 167},
        "answers": [{"id": "8/5 6/5", "label": "8/5 6/5", "equity": 0.22, "equityLoss": 0}],
        "plies": 2,
        "analysed_at": "2026-09-04",
    }
    row.update(over)
    return row


def test_new_store_and_match_round_trip(tmp_path):
    version, _ = schema_from_ts()
    conn = open_store(tmp_path / "store.sqlite")
    try:
        assert schema_version(conn) == version
        assert find_match(conn, "BackgammonGalaxy", "1") is None
        mid = insert_match(
            conn,
            site="BackgammonGalaxy",
            site_match_id="1",
            player1="me",
            player2="them",
            match_length=5,
            played_at="2026-09-03T18:37:00",
            file_name="x.mat",
            file_sha256="abc",
            mat_text="5 point match",
            analysed_player=1,
            engine="gnubg",
            plies=2,
            imported_at="2026-09-04T08:00:00Z",
        )
        gid = insert_game(conn, match_id=mid, number=1, score1=0, score2=0, crawford=False, winner=2, points=1)
        insert_decision(conn, _decision(mid, gid, 1))
        insert_decision(conn, _decision(mid, gid, 2, loss=0.03, played_equity=0.19))
        insert_decision(conn, _decision(mid, gid, 3, forced=True, loss=None, played_answer_id=None, answers=[], categories=[], features=None))
        insert_decision(conn, _decision(mid, gid, 4, loss=None))
        conn.commit()
        assert find_match(conn, "BackgammonGalaxy", "1") == mid
        assert match_summary(conn, mid) == {"decisions": 3, "forced": 1, "errors": 2, "blunders": 1, "totalLoss": 0.2, "unscored": 1}
        cats, feats, answers = conn.execute("SELECT categories, features, answers FROM decisions WHERE move_number = 1").fetchone()
        assert cats == '["opening"]' and feats == '{"pips_me": 167}' and answers.startswith('[{"id": "8/5 6/5"')
        with pytest.raises(sqlite3.IntegrityError):
            insert_match(
                conn,
                site="BackgammonGalaxy",
                site_match_id="1",
                player1="a",
                player2="b",
                match_length=1,
                played_at=None,
                file_name="y",
                file_sha256="d",
                mat_text="",
                analysed_player=1,
                engine="gnubg",
                plies=0,
                imported_at="",
            )
        delete_match(conn, mid)
        conn.commit()
        assert find_match(conn, "BackgammonGalaxy", "1") is None
        assert conn.execute("SELECT COUNT(*) FROM decisions").fetchone()[0] == 0
    finally:
        conn.close()


def test_upgrades_a_version_1_file(tmp_path):
    file = tmp_path / "store.sqlite"
    conn = sqlite3.connect(str(file))
    conn.executescript(
        "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
        "CREATE TABLE explanations (id INTEGER PRIMARY KEY, xgid TEXT NOT NULL, problem_id TEXT NOT NULL, requested_model TEXT NOT NULL,"
        " model TEXT NOT NULL, prompt_version TEXT NOT NULL, prompt_sha256 TEXT NOT NULL, explanation TEXT NOT NULL, raw_text TEXT NOT NULL,"
        " generated_at TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, request_id TEXT,"
        " served_by_fallback INTEGER NOT NULL DEFAULT 0);"
        "INSERT INTO meta VALUES ('schema_version', '1');"
        "INSERT INTO explanations (xgid, problem_id, requested_model, model, prompt_version, prompt_sha256, explanation, raw_text, generated_at)"
        " VALUES ('x', 'seed-001', 'm', 'm', 'v1', 's', 'text', 'text', '2026-09-03');"
    )
    conn.commit()
    conn.close()
    version, _ = schema_from_ts()
    conn = open_store(file)
    try:
        assert schema_version(conn) == version
        assert conn.execute("SELECT COUNT(*) FROM explanations").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM translations").fetchone()[0] == 0
        # ADDED_COLUMNS: the explanations table of an older file gains the effort column.
        cols = [row[1] for row in conn.execute("PRAGMA table_info(explanations)")]
        assert "effort" in cols
        assert conn.execute("SELECT effort FROM explanations").fetchone()[0] is None
    finally:
        conn.close()
    # Opening again changes nothing.
    open_store(file).close()


def test_added_columns_come_from_the_typescript_file():
    assert ("explanations", "effort", "TEXT") in added_columns_from_ts()


def test_refuses_a_newer_file(tmp_path):
    file = tmp_path / "store.sqlite"
    conn = open_store(file)
    conn.execute("UPDATE meta SET value = '99' WHERE key = 'schema_version'")
    conn.commit()
    conn.close()
    with pytest.raises(StoreError):
        open_store(file)
