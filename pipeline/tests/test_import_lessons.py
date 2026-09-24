"""The lesson importer end to end, offline: a fake CDN serves tiny PNGs."""

import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

import import_lessons
from bgpipeline import image_fetch
from bgpipeline.image_fetch import ImageError

SYNTHETIC = Path(__file__).with_name("fixtures") / "galaxy_quiz_synthetic.json"
QUIZ = "5a5a5a5a5a5a5a5a5a5a5a5a"
IMAGES = sorted(
    ["p01.png", "p01-c1.png", "p01-c2.png", "p01-c3.png", "p02.png", "p03.png", "p04.png", "p04-c1.png", "p04-c2.png"]
    + ["p05.png", "p05-c1.png", "p05-c2.png", "p05-c3.png", "p06.png"]
)


class FakeCdn:
    """A distinct tiny PNG per URL with its MD5 as ETag; ``bad`` URLs get a wrong ETag and
    ``missing`` ones a 404. Records every URL asked for."""

    def __init__(self, make_png, *, bad=(), missing=()):
        self.make_png = make_png
        self.bad = bad
        self.missing = missing
        self.calls = []

    def __call__(self, url, timeout):
        self.calls.append(url)
        if any(m in url for m in self.missing):
            raise ImageError("HTTP 404 Not Found", retry=False)
        data = self.make_png(sum(url.encode()))
        etag = "0" * 32 if any(b in url for b in self.bad) else hashlib.md5(data).hexdigest()
        return data, f'"{etag}"'


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(image_fetch.time, "sleep", lambda seconds: None)


def run(tmp_path, cdn, **kw):
    events = []
    summary = import_lessons.import_file(
        kw.pop("path", SYNTHETIC),
        lessons_dir=tmp_path / "lessons",
        fetch=cdn,
        workers=3,
        emit=lambda event, **fields: events.append((event, fields)),
        **kw,
    )
    return summary, events


def db(tmp_path):
    conn = sqlite3.connect(str(tmp_path / "lessons" / "lessons.sqlite"))
    conn.row_factory = sqlite3.Row
    return conn


def counts(tmp_path):
    conn = db(tmp_path)
    try:
        return [conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("lesson_sets", "lesson_problems", "lesson_choices", "lesson_images")]
    finally:
        conn.close()


def test_import_then_skip_then_replace(tmp_path, make_png):
    cdn = FakeCdn(make_png)
    summary, events = run(tmp_path, cdn, source_name="Medium - Synthetic.json")
    names = [e for e, _ in events]
    assert names[:2] == ["start", "parsed"] and names[-1] == "done"
    assert names.count("warning") == 4 and names.count("images") == 2  # 14 pictures: progress at 10 and 14
    parsed = events[1][1]
    assert (parsed["quiz_id"], parsed["collection"], parsed["problems"], parsed["checker"], parsed["cube"]) == (QUIZ, "Medium", 6, 4, 2)
    assert parsed["images"] == 14 and parsed["with_analysis"] == 3
    assert (summary["problems"], summary["choices"], summary["images"], summary["downloaded"], summary["warnings"]) == (6, 20, 14, 14, 4)
    assert summary["replaced"] is False and len(cdn.calls) == 14

    folder = tmp_path / "lessons" / QUIZ
    assert (folder / "quiz.json").read_bytes() == SYNTHETIC.read_bytes()
    assert sorted(p.name for p in (folder / "images").iterdir()) == IMAGES  # no .part files left behind
    conn = db(tmp_path)
    try:
        s = conn.execute("SELECT * FROM lesson_sets").fetchone()
        assert (s["site"], s["site_quiz_id"], s["collection"], s["file_name"], s["problem_count"]) == (
            "BackgammonGalaxy", QUIZ, "Medium", "Medium - Synthetic.json", 6
        )
        assert s["file_sha256"] == hashlib.sha256(SYNTHETIC.read_bytes()).hexdigest() and s["imported_at"].endswith("Z")
        problems = conn.execute("SELECT * FROM lesson_problems ORDER BY number").fetchall()
        assert problems[0]["problem_id"] == "lesson-b00000000000000000000001" and problems[0]["image"] == f"{QUIZ}/images/p01.png"
        assert [p["kind"] for p in problems] == ["checker", "cube", "cube", "checker", "checker", "checker"]
        assert problems[1]["analysis"] is None and problems[2]["analysis"] == "Invented analysis with spaces around it."
        choices = conn.execute("SELECT * FROM lesson_choices WHERE problem_id = ? ORDER BY number", ("lesson-b00000000000000000000001",)).fetchall()
        assert [c["image"] for c in choices] == [f"{QUIZ}/images/p01-c1.png", f"{QUIZ}/images/p01-c2.png", f"{QUIZ}/images/p01-c3.png", None]
        assert [c["correct"] for c in choices] == [0, 0, 1, 0] and [c["loss"] for c in choices] == [0.062, 0.116, 0.0, 0.167]
        assert [c["answer"] for c in choices][3] == "7/2 6/1 5/Off(2)"
        wrong = conn.execute("SELECT description, loss FROM lesson_choices WHERE site_choice_id = 'c00000000000000000000201'").fetchone()
        assert (wrong["description"], wrong["loss"]) == ("Wrong", None)
        for img in conn.execute("SELECT * FROM lesson_images").fetchall():
            data = (tmp_path / "lessons" / img["path"]).read_bytes()
            assert img["md5"] == hashlib.md5(data).hexdigest() and img["bytes"] == len(data) and (img["width"], img["height"]) == (2, 1)
    finally:
        conn.close()
    assert counts(tmp_path) == [1, 6, 20, 14]

    # already imported: skipped without a download
    cdn.calls.clear()
    summary, events = run(tmp_path, cdn)
    assert summary["skipped"] is True and summary["missing_images"] == 0 and events[-1][0] == "skipped" and cdn.calls == []

    # a lost picture is counted on a skip; --replace downloads it and reuses the rest
    (folder / "images" / "p02.png").unlink()
    summary, _ = run(tmp_path, cdn)
    assert summary["missing_images"] == 1 and cdn.calls == []
    summary, _ = run(tmp_path, cdn, replace=True)
    assert summary["replaced"] is True and (summary["downloaded"], summary["reused"]) == (1, 13)
    assert len(cdn.calls) == 1 and cdn.calls[0].endswith("/Position%202.png")
    assert counts(tmp_path) == [1, 6, 20, 14]


def test_replace_downloads_a_picture_that_changed_on_disk(tmp_path, make_png):
    cdn = FakeCdn(make_png)
    run(tmp_path, cdn)
    p03 = tmp_path / "lessons" / QUIZ / "images" / "p03.png"
    original = p03.read_bytes()
    p03.write_bytes(next(png for png in map(make_png, range(256)) if png != original))  # valid PNG, other bytes
    cdn.calls.clear()
    summary, _ = run(tmp_path, cdn, replace=True)
    assert summary["downloaded"] == 1 and cdn.calls[0].endswith("/03_no_analysis_png.png")


def test_failed_pictures_write_no_rows_and_the_next_run_fetches_only_those(tmp_path, make_png):
    with pytest.raises(import_lessons.ImportError_) as err:
        run(tmp_path, FakeCdn(make_png, bad=("4_2_",)))
    assert err.value.code == 6 and "1 of 14 pictures" in str(err.value) and "ETag" in str(err.value)
    folder = tmp_path / "lessons" / QUIZ
    assert len(list((folder / "images").iterdir())) == 13 and not (folder / "quiz.json").exists()
    assert counts(tmp_path) == [0, 0, 0, 0]

    cdn = FakeCdn(make_png)
    summary, _ = run(tmp_path, cdn)
    assert summary["downloaded"] == 1 and len(cdn.calls) == 1
    assert counts(tmp_path) == [1, 6, 20, 14]


def test_a_404_fails_with_code_6(tmp_path, make_png):
    with pytest.raises(import_lessons.ImportError_) as err:
        run(tmp_path, FakeCdn(make_png, missing=(f"{QUIZ}/1.png",)))
    assert err.value.code == 6 and "404" in str(err.value)


def test_a_problem_owned_by_another_set_is_a_store_error(tmp_path, make_png):
    run(tmp_path, FakeCdn(make_png))
    data = json.loads(SYNTHETIC.read_text(encoding="utf-8"))
    data["id"] = "6b" * 12
    other = tmp_path / "other.json"
    other.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(import_lessons.StoreError, match="already belongs to the set 5a5a"):
        run(tmp_path, FakeCdn(make_png), path=other)
    assert counts(tmp_path)[0] == 1


def test_a_utf8_bom_is_accepted_and_the_file_kept_as_received(tmp_path, make_png):
    bom = tmp_path / "Hard - with BOM.json"
    bom.write_bytes(b"\xef\xbb\xbf" + SYNTHETIC.read_bytes())
    summary, events = run(tmp_path, FakeCdn(make_png), path=bom)
    assert summary["problems"] == 6 and events[1][1]["collection"] == "Hard"
    assert (tmp_path / "lessons" / QUIZ / "quiz.json").read_bytes() == bom.read_bytes()


def test_main_json_output(tmp_path, capsys, monkeypatch, make_png):
    monkeypatch.setattr(import_lessons, "http_fetch", FakeCdn(make_png))
    argv = [str(SYNTHETIC), "--lessons-dir", str(tmp_path / "lessons"), "--json", "--source-name", "Hard - Upload.json", "--workers", "2"]
    assert import_lessons.main(argv) == 0
    lines = [json.loads(line) for line in capsys.readouterr().out.strip().splitlines()]
    assert lines[0] == {"event": "start", "file": "Hard - Upload.json"}
    assert lines[-1]["event"] == "done" and lines[-1]["problems"] == 6 and lines[-1]["set_id"] == 1
    assert {ev["event"] for ev in lines} == {"start", "parsed", "warning", "images", "done"}


def test_main_human_output(tmp_path, capsys, monkeypatch, make_png):
    monkeypatch.setattr(import_lessons, "http_fetch", FakeCdn(make_png))
    argv = [str(SYNTHETIC), "--lessons-dir", str(tmp_path / "lessons")]
    assert import_lessons.main(argv) == 0
    assert "6 problems, 14 pictures (14 downloaded, 0 already here)" in capsys.readouterr().out
    assert import_lessons.main(argv) == 0
    assert "skipped, already imported" in capsys.readouterr().out


def test_main_reports_bad_input(tmp_path, capsys, monkeypatch, make_png):
    monkeypatch.setattr(import_lessons, "http_fetch", FakeCdn(make_png))
    common = ["--lessons-dir", str(tmp_path / "lessons"), "--json"]
    survey = tmp_path / "survey.json"
    survey.write_text('{"id": "5a5a5a5a5a5a5a5a5a5a5a5a", "name": "x", "type": "survey", "problems": []}', encoding="utf-8")
    assert import_lessons.main([str(survey), *common]) == 4
    last = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert last["event"] == "error" and "not supported" in last["message"]

    notes = tmp_path / "notes.json"
    notes.write_text("hello", encoding="utf-8")
    assert import_lessons.main([str(notes), *common]) == 4
    assert import_lessons.main([str(tmp_path / "missing.json"), *common]) == 4
    assert import_lessons.main([str(survey), str(notes), "--source-name", "x.json", *common]) == 4
    assert import_lessons.main([str(tmp_path / "nothing-*.json"), *common]) == 4
