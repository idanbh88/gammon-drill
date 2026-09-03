"""Generate short explanations for problems with Claude and cache them into the problem set.

The prompt is built from the same data the app shows: the position from Blue's side, the
question, the ranked answers with equities / losses / probabilities and the classifier's
features. Output is 3-5 sentences of plain prose stored in ``explanation`` with provenance
in ``explanationMeta``. The API key comes from the environment (``ANTHROPIC_API_KEY``, or a
git-ignored ``.env`` file); it is never written anywhere.
"""

from __future__ import annotations

import datetime as dt
import os
import re
from pathlib import Path
from typing import Callable, Iterable

from .xgid import Position, acting_view, decision_kind, parse_xgid

DEFAULT_MODEL = "claude-opus-5"
MAX_TOKENS = 2048

SYSTEM_PROMPT = """You are an expert backgammon coach writing explanations for a position-training app.
The reader has just answered the problem and now sees the engine's ranking of the candidate plays with their equities. Explain the position the way a strong player would talk about it.

Write 3 to 5 sentences of plain prose: no headings, no lists, no markdown, no preamble. First say why the best play is right, naming the concrete idea it serves (safety, priming, blitzing, anchoring, timing, the race, gammons, cube ownership, match score). Then say what each listed alternative gives up, quoting the equity losses you were given. Use "Blue" and "White" and Blue's point numbering exactly as in the data (Blue moves from the 24-point down to the 1-point and off). Do not invent moves, dice, numbers or rules; do not restate the whole position; do not hedge.
"""


class ExplainError(RuntimeError):
    pass


def load_dotenv(paths: Iterable[Path]) -> None:
    """Load KEY=VALUE lines from the first existing file; never overrides variables already set."""
    for path in paths:
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            key, _, value = s.partition("=")
            key = key.strip()
            value = value.strip().strip("'\"")
            if key and value:
                os.environ.setdefault(key, value)
        return


def _pct(x: float) -> str:
    return f"{100 * x:.1f}%"


def describe_position(pos: Position) -> str:
    view = acting_view(pos)
    pts = view.points
    mine = [(i, pts[i]) for i in range(24, 0, -1) if pts[i] > 0]
    theirs = [(i, -pts[i]) for i in range(1, 25) if pts[i] < 0]
    blue = ", ".join(f"{i}-point x{n}" for i, n in mine) or "none on the board"
    white = ", ".join(f"Blue's {i}-point (White's {25 - i}-point) x{n}" for i, n in theirs) or "none on the board"
    lines = [
        f"Blue (to act): {blue}; bar {view.my_bar}; borne off {view.my_off}; pip count {view.my_pips}.",
        f"White: {white}; bar {view.their_bar}; borne off {view.their_off}; pip count {view.their_pips}.",
    ]
    if pos.match_length > 0:
        me = view.me
        my_score = pos.score[0] if me == 1 else pos.score[1]
        their_score = pos.score[1] if me == 1 else pos.score[0]
        score = f"{pos.match_length}-point match, Blue {my_score} - White {their_score}"
        if pos.crawford:
            score += ", Crawford game"
    else:
        score = "money game" + (", Jacoby" if pos.jacoby else "") + (", beavers" if pos.beavers else "")
    if pos.cube_owner == 0:
        cube = f"cube centred at {pos.cube_value}"
    else:
        owner = "Blue" if pos.cube_owner == view.me else "White"
        cube = f"cube at {pos.cube_value}, owned by {owner}"
    lines.append(f"Score: {score}. Cube: {cube}.")
    return "\n".join(lines)


def question_text(pos: Position) -> str:
    kind = decision_kind(pos)
    if kind == "checker":
        return f"Blue to play {pos.dice[0]}{pos.dice[1]}."
    if kind == "cube-double":
        return "Blue is on roll. Cube action?"
    verb = "doubles" if pos.cube_owner == 0 else "redoubles"
    return f"White {verb} to {pos.cube_value * 2}. Should Blue take or pass?"


def describe_answers(problem: dict) -> str:
    lines = []
    for i, a in enumerate(problem["answers"], 1):
        parts = [f"{i}. {a['label']}: equity {a['equity']:+.3f}"]
        parts.append("(best)" if a["equityLoss"] == 0 else f"(loses {a['equityLoss']:.3f})")
        p = a.get("probs")
        if p:
            parts.append(
                f"- wins {_pct(p['win'])}, gammons {_pct(p['winGammon'])}, backgammons {_pct(p['winBackgammon'])}; "
                f"loses gammons {_pct(p['loseGammon'])}, backgammons {_pct(p['loseBackgammon'])}"
            )
        lines.append(" ".join(parts))
    return "\n".join(lines)


FEATURE_LABELS = {
    "position_class": "engine position class",
    "back_me": "Blue checkers back (bar + White's home board)",
    "back_them": "White checkers back",
    "anchors_me": "Blue anchors in White's board (Blue's points)",
    "anchors_them": "White anchors in Blue's board (Blue's points)",
    "home_points_me": "Blue home-board points made",
    "home_points_them": "White home-board points made",
    "prime_me": "longest Blue prime in front of White's back checkers",
    "prime_them": "longest White prime in front of Blue's back checkers",
    "bar_me": "Blue on the bar",
    "bar_them": "White on the bar",
    "can_hit": "a hit is available",
}


def describe_features(problem: dict) -> str:
    f = problem.get("features") or {}
    parts = []
    for key, label in FEATURE_LABELS.items():
        if key not in f:
            continue
        v = f[key]
        if isinstance(v, bool):
            v = "yes" if v else "no"
        elif v == "":
            v = "none"
        parts.append(f"{label}: {v}")
    return "; ".join(parts)


def build_prompt(problem: dict) -> str:
    pos = parse_xgid(problem["xgid"])
    engine = problem.get("analysis") or {}
    source = f"GNU Backgammon {engine.get('plies', '?')}-ply evaluation" if engine.get("engine") == "gnubg" else "the engine"
    sections = [
        f"Question: {question_text(pos)}",
        f"Categories: {', '.join(problem.get('categories') or []) or 'unknown'}.",
        "Position (Blue's numbering, 24 = Blue's farthest point, 1 = Blue's ace point):",
        describe_position(pos),
        f"Candidate plays ranked by {source}, equities from Blue's side "
        "(cubeful; normalised money equity in match play):",
        describe_answers(problem),
    ]
    feats = describe_features(problem)
    if feats:
        sections.append(f"Board features: {feats}.")
    sections.append("Write the explanation now.")
    return "\n\n".join(sections)


def clean_explanation(text: str) -> str:
    """Plain prose only: strip markdown bullets/headings, code fences and a leading label."""
    lines = []
    fenced = False
    for line in text.strip().splitlines():
        s = line.strip()
        if s.startswith("```"):
            fenced = not fenced
            continue
        if fenced or not s:
            continue
        s = re.sub(r"^(#+\s*|[-*]\s+|\d+[.)]\s+)", "", s)
        s = re.sub(r"^\**explanation\**\s*:\s*", "", s, flags=re.IGNORECASE)
        s = s.replace("**", "")
        lines.append(s)
    return re.sub(r"[ \t]+", " ", " ".join(lines)).strip()


Generator = Callable[[str], "tuple[str, dict]"]


def make_generator(model: str = DEFAULT_MODEL, client=None, effort: str | None = None) -> Generator:
    """Return a function prompt -> (explanation, meta) backed by the Anthropic SDK."""
    import anthropic

    client = client or anthropic.Anthropic()

    def generate(prompt: str) -> tuple[str, dict]:
        kwargs = {}
        if effort:
            kwargs["output_config"] = {"effort": effort}
        response = client.messages.create(
            model=model,
            max_tokens=MAX_TOKENS,
            system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": prompt}],
            **kwargs,
        )
        if response.stop_reason == "refusal":
            details = getattr(response, "stop_details", None)
            raise ExplainError(f"model declined the request ({getattr(details, 'category', None) or 'refusal'})")
        text = "".join(block.text for block in response.content if block.type == "text")
        if response.stop_reason == "max_tokens":
            raise ExplainError("response was cut off at max_tokens")
        cleaned = clean_explanation(text)
        if not cleaned:
            raise ExplainError("empty response")
        usage = response.usage
        meta = {
            "model": response.model,
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "cache_read_input_tokens": getattr(usage, "cache_read_input_tokens", 0) or 0,
            "request_id": getattr(response, "_request_id", None),
        }
        return cleaned, meta

    return generate


def explain_problems(
    problems: list[dict],
    generate: Generator,
    *,
    force: bool = False,
    only: set[str] | None = None,
    limit: int | None = None,
    on_done: Callable[[dict, dict], None] | None = None,
    today: dt.date | None = None,
) -> int:
    """Fill ``explanation`` / ``explanationMeta`` in place; returns how many were generated."""
    count = 0
    for p in problems:
        if only and p["id"] not in only:
            continue
        if p.get("explanation") and not force:
            continue
        if limit is not None and count >= limit:
            break
        text, meta = generate(build_prompt(p))
        p["explanation"] = text
        p["explanationMeta"] = {"model": meta["model"], "generatedAt": (today or dt.date.today()).isoformat()}
        count += 1
        if on_done:
            on_done(p, meta)
    return count
