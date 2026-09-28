"""The importer end to end, offline (recorded gnubg output) and, when gnubg is installed,
for real at 0-ply."""

import json
import shutil
import sqlite3
from pathlib import Path

import pytest

import import_match
from bgpipeline.gnubg_runner import find_gnubg
from bgpipeline.mat import parse_mat
from bgpipeline.store import schema_from_ts

FIXTURES = Path(__file__).with_name("fixtures")
GALAXY = FIXTURES / "galaxy_45552673.mat"
RAW = FIXTURES / "match_gnubg_plies0.json"


def test_expand_paths(tmp_path):
    (tmp_path / "b.mat").write_text("x")
    (tmp_path / "a.mat").write_text("x")
    (tmp_path / "c.txt").write_text("x")
    assert [p.name for p in import_match.expand_paths([str(tmp_path)])] == ["a.mat", "b.mat"]
    assert [p.name for p in import_match.expand_paths([str(tmp_path / "*.mat"), str(tmp_path / "a.mat")])] == ["a.mat", "b.mat"]


def test_played_at():
    assert import_match.played_at("2026.09.03", "18.37") == "2026-09-03T18:37:00"
    assert import_match.played_at("2026-09-03", None) == "2026-09-03T00:00:00"
    assert import_match.played_at(None, "18.37") is None
    assert import_match.played_at("2026.13.03", "18.37") is None


def test_user_player_from_galaxy_file_name():
    header = parse_mat(GALAXY.read_text(encoding="utf-8")).header  # Player 1 cjdjensnefff, Player 2 dcrc2
    assert import_match.user_player(header, "cjdjensnefff_dcrc2_03092026_45552673.mat") == 1
    assert import_match.user_player(header, "CJDJENSNEFFF_DCRC2_03092026_45552673.MAT") == 1
    assert import_match.user_player(header, "dcrc2_cjdjensnefff_03092026_45552673.mat") == 2
    for renamed in ("galaxy_45552673.mat", "cjdjensnefff.mat", "cjdjensnefff_dcrc2.mat", "cjdjensnefff_someone_03092026_1.mat"):
        assert import_match.user_player(header, renamed) is None
    spaced = parse_mat(GALAXY.read_text(encoding="utf-8").replace('"dcrc2"', '"dc rc2"')).header
    assert import_match.user_player(spaced, "dc_rc2_cjdjensnefff_03092026_45552673.mat") == 2  # as the app saves it
    real = FIXTURES / "cjdjensnefff_brickier_25092026_47133758.mat"  # Player 1 brickier, the user Player 2
    assert import_match.user_player(parse_mat(real.read_text(encoding="utf-8")).header, real.name) == 2


def test_import_offline_then_skip_then_replace(tmp_path):
    store = tmp_path / "store.sqlite"
    events = []

    def emit(event, **fields):
        events.append((event, fields))

    galaxy_named = tmp_path / "cjdjensnefff_dcrc2_03092026_45552673.mat"
    shutil.copy(GALAXY, galaxy_named)
    summary = import_match.import_file(galaxy_named, store=store, plies=0, raw_in=RAW, emit=emit)
    assert summary["decisions"] == 27 and summary["forced"] == 28 and summary["unscored"] == 0 and summary["warnings"] == 0
    assert summary["errors"] == 8 and summary["blunders"] == 3 and summary["totalLoss"] == pytest.approx(0.576, abs=0.001)
    assert [e for e, _ in events] == ["start", "parsed", "done"]
    parsed = events[1][1]
    assert parsed["players"] == ["cjdjensnefff", "dcrc2"] and parsed["to_evaluate"] == 27 and parsed["games"] == 1
    assert parsed["player"] == 1 and parsed["you"] == "cjdjensnefff"

    conn = sqlite3.connect(str(store))
    conn.row_factory = sqlite3.Row
    try:
        assert conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()[0] == str(schema_from_ts()[0])
        m = conn.execute("SELECT * FROM matches").fetchone()
        assert m["site"] == "BackgammonGalaxy" and m["site_match_id"] == "45552673" and m["played_at"] == "2026-09-03T18:37:00"
        assert m["player1"] == "cjdjensnefff" and m["match_length"] == 1 and m["analysed_player"] == 1 and m["plies"] == 0
        assert m["mat_text"].startswith("; [Site")
        g = conn.execute("SELECT * FROM games").fetchone()
        assert (g["number"], g["score1"], g["score2"], g["crawford"], g["winner"], g["points"]) == (1, 0, 0, 0, 2, 1)
        rows = conn.execute("SELECT * FROM decisions ORDER BY id").fetchall()
        assert len(rows) == 55 and all(r["player"] == 1 and r["kind"] == "checker" for r in rows)
        first = rows[0]
        assert first["decision_id"] == "match-45552673-g1-m1-checker" and first["dice"] == "41" and first["played"] == "24/23 13/9"
        assert first["xgid"] == "-b----E-C---eE---c-e----B-:0:0:1:41:0:0:0:1:10"
        assert json.loads(first["answers"])[0]["id"] == first["best_answer_id"]
        assert json.loads(first["categories"]) == ["opening"]
        forced = [r for r in rows if r["forced"]]
        assert len(forced) == 28 and all(r["loss"] is None and r["answers"] == "[]" for r in forced)
        scored = [r for r in rows if not r["forced"]]
        assert all(r["loss"] is not None and r["played_answer_id"] for r in scored)
        assert sum(1 for r in scored if r["loss"] >= 0.02) == 8
    finally:
        conn.close()

    events.clear()
    again = import_match.import_file(GALAXY, store=store, player=1, plies=0, raw_in=RAW, emit=emit)
    assert again["skipped"] is True and [e for e, _ in events] == ["start", "skipped"]

    events.clear()
    replaced = import_match.import_file(GALAXY, store=store, player=1, plies=0, raw_in=RAW, emit=emit, replace=True)
    assert replaced["replaced"] is True and replaced["errors"] == 8
    conn = sqlite3.connect(str(store))
    try:
        assert conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM decisions").fetchone()[0] == 55
    finally:
        conn.close()


def test_import_as_player_2(tmp_path, monkeypatch):
    """The user in the right column: their decisions only, ids with -p2, analysed_player 2."""
    store = tmp_path / "store.sqlite"
    asked = []
    monkeypatch.setattr(import_match, "run_gnubg", lambda xgids, **kw: asked.extend(xgids) or [])
    galaxy_named = tmp_path / "dcrc2_cjdjensnefff_03092026_45552673.mat"
    shutil.copy(GALAXY, galaxy_named)
    events = []
    summary = import_match.import_file(galaxy_named, store=store, plies=0, emit=lambda e, **f: events.append((e, f)))
    parsed = dict(events)["parsed"]
    assert parsed["player"] == 2 and parsed["you"] == "dcrc2"
    assert summary["unscored"] == summary["decisions"] > 0  # the stub gnubg answered nothing
    conn = sqlite3.connect(str(store))
    conn.row_factory = sqlite3.Row
    try:
        assert conn.execute("SELECT analysed_player FROM matches").fetchone()[0] == 2
        rows = conn.execute("SELECT * FROM decisions ORDER BY id").fetchall()
        assert rows and all(r["player"] == 2 and "-p2-" in r["decision_id"] for r in rows)
        assert rows[0]["decision_id"] == "match-45552673-g1-m1-p2-checker" and rows[0]["played"] == "24/20 13/8"
        assert set(asked) == {r["xgid"] for r in rows if not r["forced"]}
    finally:
        conn.close()


def test_renamed_file_needs_the_player(tmp_path, capsys):
    store = tmp_path / "store.sqlite"
    code = import_match.main([str(GALAXY), "--store", str(store), "--plies", "0", "--raw-in", str(RAW), "--json"])
    assert code == 4
    last = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert last["event"] == "error" and "cannot tell whether you are cjdjensnefff (Player 1) or dcrc2 (Player 2)" in last["message"]
    assert not store.exists()  # refused before the store is opened


def test_main_json_output(tmp_path, capsys):
    store = tmp_path / "store.sqlite"
    code = import_match.main([str(GALAXY), "--store", str(store), "--player", "1", "--plies", "0", "--raw-in", str(RAW), "--json"])
    assert code == 0
    lines = [json.loads(line) for line in capsys.readouterr().out.strip().splitlines()]
    assert [ev["event"] for ev in lines] == ["start", "parsed", "done"]
    assert lines[-1]["decisions"] == 27 and lines[-1]["match_id"] == 1


def test_main_reports_bad_files(tmp_path, capsys):
    bad = tmp_path / "bad.mat"
    bad.write_text("5 point match\n Game 1\n A : 0   B : 0\n  1) 31: 8/5 6/6\n", encoding="utf-8")
    code = import_match.main([str(bad), "--store", str(tmp_path / "s.sqlite"), "--player", "1", "--raw-in", str(RAW), "--json"])
    assert code == 4
    lines = [json.loads(line) for line in capsys.readouterr().out.strip().splitlines()]
    assert lines[-1]["event"] == "error" and "illegal play" in lines[-1]["message"]
    assert import_match.main([str(tmp_path / "missing.mat"), "--store", str(tmp_path / "s.sqlite"), "--raw-in", str(RAW), "--json"]) == 4


@pytest.mark.skipif(find_gnubg() is None, reason="gnubg-cli not installed")
def test_import_with_real_gnubg(tmp_path):
    summary = import_match.import_file(GALAXY, store=tmp_path / "store.sqlite", player=1, plies=0, timeout=600)
    assert summary["decisions"] == 27 and summary["unscored"] == 0
