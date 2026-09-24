"""Helpers shared by the command-line importers (import_match.py, import_lessons.py)."""

from __future__ import annotations

import glob
import json
import sys
from pathlib import Path
from typing import Callable

Emit = Callable[..., None]


class ImportError_(RuntimeError):
    """A file could not be imported; ``code`` is the process exit code to use."""

    def __init__(self, message: str, code: int = 4):
        super().__init__(message)
        self.code = code


def expand_paths(args: list[str], pattern: str = "*.mat") -> list[Path]:
    """Files, folders (every ``pattern`` inside, sorted) and globs, de-duplicated in order.

    Globs are expanded here because PowerShell does not; a path that exists is taken as is, so
    a file name with ``[`` in it is not mistaken for a glob.
    """
    out: list[Path] = []
    for a in args:
        p = Path(a)
        if p.is_dir():
            out.extend(sorted(p.glob(pattern)))
        elif p.exists() or not any(ch in a for ch in "*?["):
            out.append(p)
        else:
            out.extend(Path(m) for m in sorted(glob.glob(a)))
    seen: set[Path] = set()
    unique = []
    for p in out:
        r = p.resolve()
        if r not in seen:
            seen.add(r)
            unique.append(p)
    return unique


def json_emit(event: str, **fields) -> None:
    """One NDJSON progress line on stdout. ``json.dumps`` keeps it ASCII (non-ASCII is escaped),
    which matters on Windows, where a piped stdout uses the ANSI code page."""
    sys.stdout.write(json.dumps({"event": event, **fields}) + "\n")
    sys.stdout.flush()
