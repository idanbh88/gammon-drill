"""Drive GNU Backgammon from the outside.

Two passes over a batch of XGIDs:

1. ``gnubg-cli -t -q -p gnubg_inner.py`` (Python inside gnubg) gives structured checker-play
   hints plus board / cube / position-class metadata for every position.
2. For positions without dice (cube decisions, or an offered double) gnubg's Python API has no
   hint support, so a second run uses a command file (``-c``) and the text output of ``hint``
   is captured and parsed by ``gnubg_parse.parse_cube_text``.

The approach follows xgid2anki (Python inside gnubg) and AnkiGammon (command file).
"""

from __future__ import annotations

import ctypes
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_LOCATIONS = [
    r"C:\gnubg\gnubg-cli.exe",
    r"C:\Program Files (x86)\gnubg\gnubg-cli.exe",
    r"C:\Program Files\gnubg\gnubg-cli.exe",
    "/usr/bin/gnubg",
    "/usr/local/bin/gnubg",
]

INNER_SCRIPT = Path(__file__).with_name("gnubg_inner.py")


class GnubgError(RuntimeError):
    pass


def find_gnubg(explicit: str | None = None) -> str | None:
    """Locate the gnubg CLI: explicit path, $BG_GNUBG, PATH, then the usual install folders."""
    candidates = [explicit, os.environ.get("BG_GNUBG")]
    for name in ("gnubg-cli", "gnubg-cli.exe", "gnubg"):
        found = shutil.which(name)
        if found:
            candidates.append(found)
    candidates.extend(DEFAULT_LOCATIONS)
    for c in candidates:
        if c and Path(c).is_file():
            return str(Path(c))
    return None


def ascii_path(path: Path) -> Path:
    """gnubg's C code opens paths with the ANSI code page, so non-ASCII paths fail. Prefer the
    8.3 short name on Windows; otherwise copy the file to an ASCII location."""
    s = str(path)
    if s.isascii():
        return path
    if sys.platform == "win32":
        buf = ctypes.create_unicode_buffer(512)
        n = ctypes.windll.kernel32.GetShortPathNameW(s, buf, 512)  # type: ignore[attr-defined]
        if n and buf.value.isascii():
            return Path(buf.value)
    fallback = Path(os.environ.get("PUBLIC", "C:/Users/Public")) / "bg-pipeline"
    fallback.mkdir(parents=True, exist_ok=True)
    target = fallback / path.name
    shutil.copyfile(path, target)
    return target


def setup_commands(plies: int, cube_plies: int) -> list[str]:
    """Same settings as gnubg_inner.setup_commands (kept in sync by test)."""
    cmds = [
        "set lang en",
        "set automatic game off",
        "set automatic roll off",
        "set output mwc off",
        "set output matchpc off",
        f"set evaluation chequerplay evaluation plies {plies}",
        f"set evaluation cubedecision evaluation plies {cube_plies}",
    ]
    if plies >= 1:
        cmds.append(f"set evaluation movefilter {plies} 0 -1 0 0")
        for level in range(1, plies):
            cmds.append(f"set evaluation movefilter {plies} {level} 10 4 0.16")
    return cmds


def _run(exe: str, args: list[str], env: dict[str, str] | None, timeout: float | None) -> str:
    proc = subprocess.run(
        [exe, *args],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        cwd=str(Path(exe).parent),
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.stdout


def run_cube_text(exe: str, xgids: list[str], plies: int, cube_plies: int, timeout: float | None = None) -> list[str]:
    """Text-mode ``hint`` for cube positions; returns one text chunk per XGID."""
    if not xgids:
        return []
    with tempfile.TemporaryDirectory(prefix="bg-cube-") as tmp:
        cmd_file = Path(tmp) / "cmds.txt"
        lines = setup_commands(plies, cube_plies)
        for x in xgids:
            lines.append(f"set xgid XGID={x}")
            lines.append("hint")
        cmd_file.write_text("\n".join(lines) + "\n", encoding="ascii")
        out = _run(exe, ["-t", "-q", "-c", str(ascii_path(cmd_file))], None, timeout)
    chunks = out.split("Cube analysis")[1:]
    if len(chunks) != len(xgids):
        raise GnubgError(
            f"expected {len(xgids)} cube analyses, found {len(chunks)}. gnubg output tail:\n{out[-3000:]}"
        )
    return ["Cube analysis" + c for c in chunks]


def run_gnubg(
    xgids: list[str],
    *,
    plies: int = 2,
    cube_plies: int | None = None,
    gnubg: str | None = None,
    timeout: float | None = None,
    log=None,
) -> list[dict]:
    """Analyse XGIDs. Returns one raw record per XGID (see gnubg_inner) with ``cube_text``
    filled in for cube decisions. Raises GnubgError when gnubg is missing or fails."""
    exe = find_gnubg(gnubg)
    if not exe:
        raise GnubgError("gnubg-cli not found; pass --gnubg or set BG_GNUBG")
    cube_plies = plies if cube_plies is None else cube_plies
    if not xgids:
        return []
    with tempfile.TemporaryDirectory(prefix="bg-analyze-") as tmp:
        tmpdir = Path(tmp)
        script = tmpdir / "gnubg_inner.py"
        shutil.copyfile(INNER_SCRIPT, script)
        xg_file = tmpdir / "xgids.txt"
        out_file = tmpdir / "out.json"
        xg_file.write_text("\n".join(xgids) + "\n", encoding="utf-8")
        env = dict(os.environ)
        env.update(
            BG_XGIDS=str(xg_file),
            BG_OUT=str(out_file),
            BG_PLIES=str(plies),
            BG_CUBE_PLIES=str(cube_plies),
        )
        if log:
            log(f"gnubg: {exe} ({len(xgids)} positions, {plies}-ply chequer, {cube_plies}-ply cube)")
        stdout = _run(exe, ["-t", "-q", "-p", str(ascii_path(script))], env, timeout)
        if not out_file.exists():
            raise GnubgError(f"gnubg produced no output. Output tail:\n{stdout[-3000:]}")
        results: list[dict] = json.loads(out_file.read_text(encoding="utf-8"))
    if len(results) != len(xgids):
        raise GnubgError(f"gnubg analysed {len(results)} of {len(xgids)} positions. Output tail:\n{stdout[-3000:]}")

    cube_idx = [i for i, r in enumerate(results) if r.get("ok") and r.get("needs_cube")]
    if cube_idx:
        if log:
            log(f"gnubg: text pass for {len(cube_idx)} cube decisions")
        texts = run_cube_text(exe, [results[i]["xgid"] for i in cube_idx], plies, cube_plies, timeout)
        for i, text in zip(cube_idx, texts):
            results[i]["cube_text"] = text
    return results
