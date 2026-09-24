"""data/lessons/lessons.sqlite through the standard library."""

import sqlite3

import pytest

from bgpipeline.lesson_store import (
    LESSON_SCHEMA_TS,
    delete_set,
    find_set,
    insert_choice,
    insert_image,
    insert_problem,
    insert_set,
    open_lesson_store,
    owner_of_problem,
    set_images,
    set_summary,
)
from bgpipeline.store import StoreError, schema_from_ts

TABLES = ["lesson_choices", "lesson_images", "lesson_problems", "lesson_sets", "meta"]


def test_schema_comes_from_the_ts_file():
    version, sql = schema_from_ts(LESSON_SCHEMA_TS)
    assert version == 1
    for table in TABLES:
        assert f"CREATE TABLE IF NOT EXISTS {table} (" in sql
    # the TypeScript template literal and the regex must see the same text
    assert "`" not in sql and "${" not in sql and "\\" not in sql


def add_set(conn, quiz_id, problem_ids):
    set_id = insert_set(
        conn,
        site="BackgammonGalaxy",
        site_quiz_id=quiz_id,
        name=f"Set {quiz_id}",
        author=None,
        collection="Hard",
        problem_count=len(problem_ids),
        file_name=f"Hard - {quiz_id}.json",
        file_sha256="0" * 64,
        imported_at="2026-09-11T00:00:00Z",
    )
    for n, pid in enumerate(problem_ids, 1):
        image = f"{quiz_id}/images/p{n:02d}.png"
        insert_image(conn, path=image, url=f"https://x/{quiz_id}/{n}.png", md5="a" * 32, bytes=10, width=2, height=1)
        insert_problem(conn, set_id=set_id, problem_id=pid, number=n, site_problem_id=pid[7:], kind="checker", image=image, analysis=None)
        for m in (1, 2):
            insert_choice(
                conn, problem_id=pid, number=m, site_choice_id=f"{pid}-{m}", answer="13/10", description="(-0.1)" if m == 2 else "+0.2",
                loss=0.1 if m == 2 else 0.0, correct=m == 1, image=None,
            )
    return set_id


def count(conn, table):
    return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def test_round_trip_and_delete_one_set(tmp_path):
    path = tmp_path / "new-folder" / "lessons.sqlite"
    conn = open_lesson_store(path)  # creates the folder
    try:
        assert sorted(r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")) == TABLES
        a = add_set(conn, "aaa", ["lesson-p1", "lesson-p2"])
        b = add_set(conn, "bbb", ["lesson-p3"])
        conn.commit()
        assert find_set(conn, "BackgammonGalaxy", "aaa") == a and find_set(conn, "BackgammonGalaxy", "zzz") is None
        assert set_summary(conn, a) == {"problems": 2, "choices": 4}
        assert set(set_images(conn, "aaa")) == {"aaa/images/p01.png", "aaa/images/p02.png"}
        assert owner_of_problem(conn, "lesson-p3") == "bbb" and owner_of_problem(conn, "lesson-p9") is None

        delete_set(conn, a)
        conn.commit()
        assert count(conn, "lesson_sets") == 1 and count(conn, "lesson_problems") == 1
        assert count(conn, "lesson_choices") == 2 and count(conn, "lesson_images") == 1
        assert find_set(conn, "BackgammonGalaxy", "bbb") == b
    finally:
        conn.close()


def test_problem_ids_are_unique_across_sets(tmp_path):
    conn = open_lesson_store(tmp_path / "lessons.sqlite")
    try:
        add_set(conn, "aaa", ["lesson-p1"])
        with pytest.raises(sqlite3.IntegrityError):
            add_set(conn, "bbb", ["lesson-p1"])
    finally:
        conn.close()


def test_reopen_and_refuse_a_newer_file(tmp_path):
    path = tmp_path / "lessons.sqlite"
    open_lesson_store(path).close()
    conn = open_lesson_store(path)
    conn.execute("UPDATE meta SET value = '99' WHERE key = 'schema_version'")
    conn.commit()
    conn.close()
    with pytest.raises(StoreError, match="schema version 99"):
        open_lesson_store(path)
