"""Read, write and merge ProblemSet JSON files (the app's data/*.json format)."""

from __future__ import annotations

import json
import re
from pathlib import Path


def new_problem_set(name: str, source: str | None = None) -> dict:
    ps: dict = {"name": name}
    if source:
        ps["source"] = source
    ps["problems"] = []
    return ps


def load_problem_set(path: Path) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, list):
        data = {"name": Path(path).stem, "problems": data}
    if not isinstance(data, dict) or not isinstance(data.get("problems"), list):
        raise ValueError(f"{path}: not a ProblemSet (expected an object with a 'problems' list)")
    return data


def write_problem_set(path: Path, ps: dict) -> None:
    Path(path).write_text(json.dumps(ps, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def next_id(prefix: str, existing: set[str]) -> str:
    """Smallest unused ``<prefix>-NNN`` above the highest existing number."""
    pat = re.compile(r"^" + re.escape(prefix) + r"-(\d+)$")
    top = 0
    for i in existing:
        m = pat.match(i)
        if m:
            top = max(top, int(m.group(1)))
    return f"{prefix}-{top + 1:03d}"


def merge_problems(target: dict, new: list[dict], *, keep_categories: bool = True) -> dict:
    """Update problems with the same XGID in place (keeping id, explanation and, optionally,
    categories); append the rest with unique ids."""
    by_xgid = {p["xgid"]: p for p in target["problems"]}
    ids = {p["id"] for p in target["problems"]}
    for np_ in new:
        old = by_xgid.get(np_["xgid"])
        if old:
            old["type"] = np_["type"]
            old["answers"] = np_["answers"]
            old["analysis"] = np_["analysis"]
            if np_.get("features"):
                old["features"] = np_["features"]
            if np_.get("source") and not old.get("source"):
                old["source"] = np_["source"]
            if np_.get("categories") and (not keep_categories or not old.get("categories")):
                old["categories"] = np_["categories"]
            continue
        pid = np_["id"]
        if pid in ids:
            base = pid
            n = 2
            while f"{base}-{n}" in ids:
                n += 1
            pid = f"{base}-{n}"
            np_["id"] = pid
        ids.add(pid)
        target["problems"].append(np_)
        by_xgid[np_["xgid"]] = np_
    return target
