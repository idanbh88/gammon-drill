"""robertie.sqlite: the schema read from the TypeScript file, and a re-import that keeps the
tables the app writes."""

import re

from bgpipeline.robertie import BookProblem, Chapter
from bgpipeline.robertie_store import SCHEMA_TS, app_rows, open_robertie_store, replace_book
from bgpipeline.store import SCHEMA_TS as MAIN_SCHEMA_TS
from bgpipeline.store import schema_from_ts


def test_schema_literal_is_regex_safe():
    text = SCHEMA_TS.read_text(encoding="utf-8")
    sql = re.search(r"SCHEMA_SQL\s*=\s*`([^`]*)`", text).group(1)
    assert "${" not in sql and "\\" not in sql


def _tables(sql: str) -> dict[str, str]:
    return {m.group(1): m.group(0) for m in re.finditer(r"CREATE (?:TABLE|INDEX) IF NOT EXISTS (\w+)[^;]*;", sql)}


def test_explanation_tables_are_copies_of_the_main_store():
    _v, book_sql = schema_from_ts(SCHEMA_TS)
    _v, main_sql = schema_from_ts(MAIN_SCHEMA_TS)
    book, main = _tables(book_sql), _tables(main_sql)
    for name in ("explanations", "explanations_xgid", "translations", "translations_explanation"):
        assert book[name] == main[name], name


def problem(n, status="ok"):
    return BookProblem(
        number=n, chapter=5, chapter_title="The Opening", caption=f"Problem {n}: Black to play 31.", kind="checker", dice="31",
        problem_page="s001-R", diagram="s001-R-1", solution_pages=["s002-L"], solution="Invented text.", play_as_printed="8/5 6/5",
        cube_verdict=None, book_answer="8/5 6/5", local=None, claude=None, xgid="-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:0:10",
        status=status, issues=[], fix=None,
    )


def analysis(n, plies=2):
    return {"number": n, "plies": plies, "analysed_at": "2026-09-28", "answers": [{"id": "8/5 6/5", "label": "8/5 6/5", "equity": 0.2, "equityLoss": 0}], "best_answer_id": "8/5 6/5", "book_answer_id": "8/5 6/5", "book_loss": 0.0, "categories": ["opening"]}


def test_replace_book_rewrites_the_book_and_keeps_the_app_tables(tmp_path):
    path = tmp_path / "robertie.sqlite"
    conn = open_robertie_store(path)
    source = {"file_name": "scan.pdf", "file_sha256": "0" * 64, "pages": 350}
    replace_book(conn, source=source, chapters=[Chapter(5, "The Opening", 1, 2, "s001-R")], problems=[problem(1), problem(2)], analyses=[analysis(1), analysis(1, 3)])
    conn.execute("INSERT INTO robertie_reports (number, note, reported_at) VALUES (1, 'looks wrong', '2026-09-28')")
    conn.execute(
        "INSERT INTO explanations (xgid, problem_id, requested_model, model, prompt_version, prompt_sha256, explanation, raw_text, generated_at) VALUES ('x', 'robertie-1', 'm', 'm', 'v5', 's', 'e', 'e', 'now')"
    )
    conn.commit()
    replace_book(conn, source=source, chapters=[Chapter(5, "The Opening", 1, 1, "s001-R")], problems=[problem(1, "fixed")], analyses=[analysis(1)])
    assert conn.execute("SELECT COUNT(*) FROM robertie_problems").fetchone()[0] == 1
    assert tuple(conn.execute("SELECT reading_status, solution_sha256 IS NOT NULL FROM robertie_problems").fetchone()) == ("fixed", 1)
    assert conn.execute("SELECT COUNT(*) FROM robertie_analyses").fetchone()[0] == 1
    assert conn.execute("SELECT categories FROM robertie_chapters").fetchone()[0] == '["opening"]'
    assert app_rows(conn) == {"explanations": 1, "translations": 0, "robertie_translations": 0, "robertie_reports": 1}
    conn.close()
