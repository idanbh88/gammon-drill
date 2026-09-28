"""Robertie's answers as the app stores them.

A checker play arrives the way the book prints it (``Bar/21*``, ``24/20*(2) 13/9(2)``,
``13/11 6/5!``, ``5/off 1/off``); ``normalise_play`` turns it into the notation ``moves.parse_play``
reads, which then decides legality by the resulting position. A cube verdict arrives as the
doubling half (double / no-double / too-good) and the taking half (take / pass / not stated);
``cube_answer`` turns it into one of the app's joint answer ids, or a half-decision when the
book states only the doubling half.
"""

from __future__ import annotations

import re

from .moves import NotationError, parse_play

_PUNCT = re.compile(r"[!?.,;:]+")
_SPACE_SLASH = re.compile(r"\s*/\s*")
_WORDS = re.compile(r"\b(and|then|plus)\b", re.IGNORECASE)


def normalise_play(text: str) -> str:
    """The book's play in ``parse_play`` notation; raises ``NotationError`` when it is not a
    play. ``!`` / ``?`` marks, commas and joining words go; ``25/`` and ``/0`` become ``bar/`` and
    ``/off``; ``x(2)`` repeats are kept."""
    s = text.replace("∗", "*").replace("⁄", "/").replace("–", "-").strip()
    s = _WORDS.sub(" ", s)
    s = _SPACE_SLASH.sub("/", s)
    s = _PUNCT.sub(" ", s)
    tokens = []
    for tok in s.split():
        tok = re.sub(r"^25/", "bar/", tok, flags=re.IGNORECASE)
        tok = re.sub(r"/0(\*?)(?=(\(|$))", r"/off\1", tok)
        tok = re.sub(r"^b/", "bar/", tok, flags=re.IGNORECASE)
        tokens.append(tok.lower())
    out = " ".join(tokens)
    if not out:
        raise NotationError("empty play")
    parse_play(out)  # raises NotationError when a token is not a move
    return out


JOINT = ("no-double", "double-take", "double-pass", "too-good")
HALF = ("double",)


def cube_answer(double: str, take: str | None) -> str:
    """The joint answer id for the book's verdict, or ``double`` (a half-decision: the take is
    not stated). "No double" with a pass is too good to double."""
    if double == "too-good":
        return "too-good"
    if double == "double":
        return {"take": "double-take", "pass": "double-pass"}.get(take or "", "double")
    if double == "no-double":
        return "too-good" if take == "pass" else "no-double"
    raise ValueError(f"unknown doubling verdict {double!r}")
