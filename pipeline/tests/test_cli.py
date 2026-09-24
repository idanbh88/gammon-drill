"""Helpers shared by the importers."""

from bgpipeline.cli import expand_paths


def test_expand_paths_folder_uses_the_pattern(tmp_path):
    for name in ("b.json", "a.json", "c.mat"):
        (tmp_path / name).write_text("x")
    assert [p.name for p in expand_paths([str(tmp_path)], "*.json")] == ["a.json", "b.json"]
    assert [p.name for p in expand_paths([str(tmp_path)], "*.mat")] == ["c.mat"]


def test_expand_paths_glob_and_explicit_path_are_deduplicated(tmp_path):
    for name in ("a.json", "b.json"):
        (tmp_path / name).write_text("x")
    got = expand_paths([str(tmp_path / "*.json"), str(tmp_path / "a.json")], "*.json")
    assert [p.name for p in got] == ["a.json", "b.json"]


def test_expand_paths_takes_existing_names_literally(tmp_path):
    odd = tmp_path / "Quiz [1].json"
    odd.write_text("x")
    assert expand_paths([str(odd)], "*.json") == [odd]


def test_expand_paths_passes_missing_paths_through(tmp_path):
    missing = tmp_path / "missing.json"
    assert expand_paths([str(missing)], "*.json") == [missing]
    assert expand_paths([str(tmp_path / "nothing-*.json")], "*.json") == []
