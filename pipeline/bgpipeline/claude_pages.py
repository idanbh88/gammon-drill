"""Claude's readings of the book (stage 2 of ``import_robertie.py``).

Two kinds of request, each with a fixed instruction and a JSON schema (structured output):

- ``page``: one book page. Claude returns the chapter heading, each diagram's caption (number,
  roll or cube question) and each solution's text with the play or cube action Robertie
  recommends, written the way the book writes it.
- ``board``: one diagram, cropped by the local reader and enlarged twice. Claude returns its own
  count of every point, the bar, the borne-off checkers and where the cube stands: the second,
  independent reading of the board (``board_reader.py`` is the first). A test on a page image
  showed that Claude undercounts stacks at the page's resolution; enlarged it counted correctly.

Answers are cached one file per item under ``claude/<kind>/`` so a paid request is never
repeated; ``submit_batch`` sends many items through the Message Batches API (half price), and
``read_direct`` sends one with the server-side refusal fallback while developing.

Needs the ``book`` extra (anthropic). The key is ANTHROPIC_API_KEY, read from the repo-root .env
by ``load_api_key`` when it is not already in the environment; it is never printed.
"""

from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

MODEL = "claude-opus-5"
MAX_TOKENS = 16000
FALLBACK_BETA = "server-side-fallback-2026-07-01"
CACHE_DIR = "claude"

# $ per million tokens (input, output) at list price; the batch API halves both.
PRICES = {
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-fable-5-1": (10.0, 50.0),
}

SYSTEM = """You read a scanned backgammon book, Bill Robertie's "501 Essential Backgammon \
Problems", for the private study database of the person who owns the scan. You return exactly \
what the image shows, as JSON in the given schema. Accuracy matters more than anything: every \
caption, move and checker count is checked against a second, independent reading, so never \
guess to fill a gap; say what you cannot read in `notes`."""

PAGE_INSTRUCTIONS = """This image is one page of the book. It may hold a chapter heading, problem \
diagrams with captions, solutions, or ordinary text. Ignore the running header ("Cardoza \
Publishing - Bill Robertie" / "501 ESSENTIAL BACKGAMMON PROBLEMS"); report the printed page \
number in `page_number`.

CHAPTER HEADING: a heading like "9. The Blitz" gives chapter {number: 9, title: "The Blitz"}; \
otherwise chapter is null.

DIAGRAMS: one entry in `problems` per board diagram, top to bottom. Do not read the boards \
themselves. `caption` is the text under the diagram exactly as printed, e.g. "Problem 12: \
Black to play 41." The book writes a roll as two digits: "41" is a 4 and a 1. `kind` is \
"checker" when the caption asks for a play and gives a roll, "cube" when it asks about \
doubling or taking. `dice` is the two digits for a checker play, null for a cube question.

SOLUTIONS: one entry in `solutions` per solution, in page order.
- A solution starts with a bold heading like "Problem 12: Black to play 41." Copy the heading \
into `heading` and its number into `number`.
- `text` is the solution's full text exactly as printed, every paragraph in order, paragraphs \
separated by a blank line. Join words hyphenated across a line break; keep the book's move \
notation exactly (24/20*(2), Bar/21*, 6/1*, 13/7*/1, 5/off). Do not summarise or correct.
- Text at the top of the page that continues a solution from the previous page is an entry with \
`number` null and `heading` null.
- `continues_on_next_page` is true when the page ends in the middle of this solution.
- `play`: for a checker-play problem, the play the book recommends as correct, written in the \
book's notation with Black's point numbers and complete (both numbers of the roll, all four \
moves of a double), e.g. "13/11 6/5" or "24/20*(2) 13/9(2)". If the book gives the play in \
words or in pieces, write the whole play in notation. null when this part of the solution does \
not state the recommended play.
- `cube`: for a cube problem, the book's verdict: `double` is "double", "no-double" or \
"too-good" (too good to double, playing on for a gammon); `take` is "take", "pass" or null when \
not stated. null for a checker play or when this part of the solution gives no verdict.

Return empty lists when the page has no diagrams or no solutions."""

BOARD_INSTRUCTIONS = """This image is one board diagram from the book, enlarged. Read the \
position.
- The board is drawn from Black's side. Point numbers are printed above the board (24 down to \
13, left to right) and below it (1 up to 12, left to right). Use those printed numbers.
- Black checkers are solid black ellipses. White checkers are hollow ellipses (white inside, \
black outline). Checkers stack from the board's edge toward the middle, touching each other; a \
tall stack can run past the middle of the board, and then two stacks can meet in one column.
- The bar is the empty vertical strip between the two halves of the board. Count the Black and \
White checkers drawn in it.
- Checkers drawn outside the board's frame, to its left, are borne off (White's at the top, \
Black's at the bottom, possibly in several columns). Count them per colour.
- The small square box to the right of the board is the doubling cube. Report whether it sits \
level with the top of the board, its middle or its bottom (none if there is no box), and any \
number printed in it (usually it is empty).
Work point by point: for each of the 24 points, the bar and the tray, count the ellipses one by \
one before writing the number. Each side has 15 checkers in all (on points, on the bar and \
borne off); if your counts do not add up to 15 for a side, look again, and if they still do not, \
report what you see and explain in `notes`. `confidence` is "high" when every count is certain."""


def _nullable(schema: dict) -> dict:
    return {"anyOf": [schema, {"type": "null"}]}


def _strict(properties: dict) -> dict:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


_COUNTS = {"type": "array", "items": _strict({"point": {"type": "integer"}, "count": {"type": "integer"}})}

PAGE_SCHEMA = _strict(
    {
        "page_number": _nullable({"type": "integer"}),
        "chapter": _nullable(_strict({"number": {"type": "integer"}, "title": {"type": "string"}})),
        "problems": {
            "type": "array",
            "items": _strict(
                {
                    "number": {"type": "integer"},
                    "caption": {"type": "string"},
                    "kind": {"type": "string", "enum": ["checker", "cube"]},
                    "dice": _nullable({"type": "string"}),
                }
            ),
        },
        "solutions": {
            "type": "array",
            "items": _strict(
                {
                    "number": _nullable({"type": "integer"}),
                    "heading": _nullable({"type": "string"}),
                    "text": {"type": "string"},
                    "continues_on_next_page": {"type": "boolean"},
                    "play": _nullable({"type": "string"}),
                    "cube": _nullable(
                        _strict(
                            {
                                "double": {"type": "string", "enum": ["double", "no-double", "too-good"]},
                                "take": _nullable({"type": "string", "enum": ["take", "pass"]}),
                            }
                        )
                    ),
                }
            ),
        },
        "notes": {"type": "string"},
    }
)

BOARD_SCHEMA = _strict(
    {
        "black": _COUNTS,
        "white": _COUNTS,
        "black_bar": {"type": "integer"},
        "white_bar": {"type": "integer"},
        "black_off": {"type": "integer"},
        "white_off": {"type": "integer"},
        "cube_position": {"type": "string", "enum": ["top", "middle", "bottom", "none"]},
        "cube_text": _nullable({"type": "string"}),
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "notes": {"type": "string"},
    }
)


@dataclass(frozen=True)
class Kind:
    instructions: str
    schema: dict
    effort: str
    version: str  # bump when the instructions or the schema change


KINDS = {
    "page": Kind(PAGE_INSTRUCTIONS, PAGE_SCHEMA, "low", "page-1"),
    "board": Kind(BOARD_INSTRUCTIONS, BOARD_SCHEMA, "medium", "board-1"),
}


@dataclass(frozen=True)
class Item:
    kind: str  # "page" | "board"
    key: str  # "s003-L" (page) or "s003-L-1" (board)
    image: bytes
    media_type: str = "image/jpeg"

    @property
    def custom_id(self) -> str:
        return f"{self.kind}-{self.key}"


class ClaudePagesError(RuntimeError):
    pass


def load_api_key(repo_root: Path) -> bool:
    """Puts ANTHROPIC_API_KEY from the repo-root .env into the environment when it is not set
    already. Returns whether a key (or auth token) is now available."""
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    env = repo_root / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.strip().partition("=")
            if sep and key.strip() == "ANTHROPIC_API_KEY" and value.strip():
                os.environ["ANTHROPIC_API_KEY"] = value.strip().strip('"').strip("'")
                return True
    return False


def params(item: Item, *, model: str = MODEL, effort: str | None = None) -> dict:
    """The Messages API request for one item (shared by direct and batch calls)."""
    kind = KINDS[item.kind]
    return {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": item.media_type, "data": base64.b64encode(item.image).decode("ascii")}},
                    {"type": "text", "text": kind.instructions},
                ],
            }
        ],
        "output_config": {"effort": effort or kind.effort, "format": {"type": "json_schema", "schema": kind.schema}},
    }


@dataclass
class Answer:
    kind: str
    key: str
    reading: dict | None
    model: str
    effort: str
    batch: bool
    input_tokens: int
    output_tokens: int
    stop_reason: str | None
    request_id: str | None
    error: str | None = None

    def to_json(self) -> dict:
        return {
            "kind": self.kind,
            "key": self.key,
            "version": KINDS[self.kind].version,
            "model": self.model,
            "effort": self.effort,
            "batch": self.batch,
            "usage": {"input_tokens": self.input_tokens, "output_tokens": self.output_tokens},
            "stop_reason": self.stop_reason,
            "request_id": self.request_id,
            "error": self.error,
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "reading": self.reading,
        }


def cost(answers: list[Answer]) -> float:
    total = 0.0
    for a in answers:
        pin, pout = PRICES.get(a.model, PRICES[MODEL])
        share = 0.5 if a.batch else 1.0
        total += share * (a.input_tokens * pin + a.output_tokens * pout) / 1e6
    return total


def _text(content) -> str:
    return "".join(getattr(b, "text", "") for b in content if getattr(b, "type", None) == "text")


def _parse(kind: str, key: str, message, *, model: str, effort: str, batch: bool, request_id: str | None) -> Answer:
    usage = message.usage
    stop = message.stop_reason
    reading, error = None, None
    if stop == "refusal":
        error = "refused"
    elif stop == "max_tokens":
        error = "cut off at max_tokens"
    else:
        try:
            reading = json.loads(_text(message.content))
        except json.JSONDecodeError as e:
            error = f"not JSON: {e}"
    return Answer(kind, key, reading, getattr(message, "model", model), effort, batch, usage.input_tokens, usage.output_tokens, stop, request_id, error)


def read_direct(client, item: Item, *, model: str = MODEL, effort: str | None = None) -> Answer:
    """One item, one streamed request, with the server-side refusal fallback."""
    req = params(item, model=model, effort=effort)
    with client.beta.messages.stream(**req, betas=[FALLBACK_BETA], fallbacks="default") as stream:
        message = stream.get_final_message()
        request_id = getattr(stream, "request_id", None)
    return _parse(item.kind, item.key, message, model=model, effort=req["output_config"]["effort"], batch=False, request_id=request_id)


def read_many_direct(client, items: list[Item], book_dir: Path, *, model: str = MODEL, workers: int = 4, log=None) -> list[Answer]:
    """Direct requests for many items, a few at a time, each answer cached as it arrives (the
    fallback when the batch API is slow)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    answers: list[Answer] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(read_direct, client, it, model=model): it for it in items}
        for fut in as_completed(futures):
            it = futures[fut]
            try:
                a = fut.result()
            except Exception as e:  # noqa: BLE001 - one failed request must not stop the others
                a = Answer(it.kind, it.key, None, model, KINDS[it.kind].effort, False, 0, 0, None, None, error=repr(e))
            if a.reading is not None:
                save_answer(book_dir, a)
            answers.append(a)
            if log:
                log(f"{len(answers)} of {len(items)} read ({it.kind} {it.key}{': ' + a.error if a.error else ''})")
    return answers


def submit_batch(client, items: list[Item], *, model: str = MODEL) -> str:
    """Sends the items as one Message Batch (no fallbacks: the batch API refuses them; a refused
    item is retried directly). Returns the batch id."""
    requests = [{"custom_id": it.custom_id, "params": params(it, model=model)} for it in items]
    return client.messages.batches.create(requests=requests).id


def wait_batch(client, batch_id: str, *, poll: float = 30.0, log=None):
    while True:
        batch = client.messages.batches.retrieve(batch_id)
        if batch.processing_status == "ended":
            return batch
        if log:
            c = batch.request_counts
            log(f"batch {batch_id}: {c.succeeded} done, {c.processing} processing, {c.errored} errored")
        time.sleep(poll)


def collect_batch(client, batch_id: str, *, model: str = MODEL) -> list[Answer]:
    out = []
    for result in client.messages.batches.results(batch_id):
        kind, _, key = result.custom_id.partition("-")
        effort = KINDS[kind].effort
        if result.result.type == "succeeded":
            out.append(_parse(kind, key, result.result.message, model=model, effort=effort, batch=True, request_id=None))
        else:
            out.append(Answer(kind, key, None, model, effort, True, 0, 0, None, None, error=f"batch result {result.result.type}"))
    return out


def cache_path(book_dir: Path, kind: str, key: str) -> Path:
    return book_dir / CACHE_DIR / kind / f"{key}.json"


def load_cached(book_dir: Path, kind: str, key: str) -> dict | None:
    """The cached answer when it has a reading made with the current instructions."""
    path = cache_path(book_dir, kind, key)
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("reading") is None or data.get("version") != KINDS[kind].version:
        return None
    return data


def save_answer(book_dir: Path, answer: Answer) -> None:
    path = cache_path(book_dir, answer.kind, answer.key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(answer.to_json(), ensure_ascii=False, indent=1), encoding="utf-8")


def page_issues(reading: dict) -> list[str]:
    """Checks on a page reading; a reading with issues is kept (assembly flags its problems)."""
    issues = []
    numbers = [p["number"] for p in reading.get("problems", [])]
    if numbers != sorted(numbers) or len(set(numbers)) != len(numbers):
        issues.append(f"problem numbers out of order: {numbers}")
    for p in reading.get("problems", []):
        n = p["number"]
        if not 1 <= n <= 501:
            issues.append(f"problem number {n} out of range")
        if p["kind"] == "checker":
            d = p.get("dice") or ""
            if not (len(d) == 2 and d.isdigit() and all("1" <= c <= "6" for c in d)):
                issues.append(f"problem {n}: dice {d!r}")
    nums = [s["number"] for s in reading.get("solutions", []) if s["number"] is not None]
    if nums != sorted(nums):
        issues.append(f"solution numbers out of order: {nums}")
    return issues


def board_totals(reading: dict) -> tuple[int, int]:
    b = sum(c["count"] for c in reading["black"]) + reading["black_bar"] + reading["black_off"]
    w = sum(c["count"] for c in reading["white"]) + reading["white_bar"] + reading["white_off"]
    return b, w


JOURNAL = "batches.jsonl"


def journal_path(book_dir: Path) -> Path:
    return book_dir / CACHE_DIR / JOURNAL


def record_batch(book_dir: Path, batch_id: str, custom_ids: list[str], model: str) -> None:
    """Appends a submitted batch to the journal at once, so a crash never loses a paid batch."""
    path = journal_path(book_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps({"batch_id": batch_id, "model": model, "items": custom_ids, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}) + "\n")


def journal(book_dir: Path) -> list[dict]:
    path = journal_path(book_dir)
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def run_batches(client, items: list[Item], book_dir: Path, *, model: str = MODEL, chunk: int = 10, poll: float = 30.0, log=None) -> list[Answer]:
    """Submits the items not cached yet in batches of ``chunk`` (small batches: on 2026-09-28
    fourteen batches of 60 sat unstarted for three hours while one of a single request finished in
    two and a half minutes), journals each batch, then watches all of them and caches the answers
    of each one as soon as it ends."""
    todo = [it for it in items if load_cached(book_dir, it.kind, it.key) is None]
    pending = []
    for i in range(0, len(todo), chunk):
        part = todo[i : i + chunk]
        batch_id = submit_batch(client, part, model=model)
        record_batch(book_dir, batch_id, [it.custom_id for it in part], model)
        pending.append(batch_id)
        if log:
            log(f"submitted {batch_id} with {len(part)} requests")
    return collect_batches(client, pending, book_dir, model=model, poll=poll, log=log)


def collect_batches(client, batch_ids: list[str], book_dir: Path, *, model: str = MODEL, poll: float = 30.0, log=None) -> list[Answer]:
    """Waits for the batches, in whatever order they end, caching each answer that has a reading."""
    pending, answers = list(batch_ids), []
    while pending:
        still = []
        for batch_id in pending:
            if client.messages.batches.retrieve(batch_id).processing_status != "ended":
                still.append(batch_id)
                continue
            for a in collect_batch(client, batch_id, model=model):
                if a.reading is not None:
                    save_answer(book_dir, a)
                answers.append(a)
        pending = still
        if log:
            log(f"{len(batch_ids) - len(pending)} of {len(batch_ids)} batches ended, {sum(a.reading is not None for a in answers)} answers saved")
        if pending:
            time.sleep(poll)
    return answers


def cancel_batches(client, batch_ids: list[str]) -> None:
    """Cancels batches that are still running (requests not processed yet are not billed); their
    finished requests stay collectable with ``collect_batches``."""
    for batch_id in batch_ids:
        if client.messages.batches.retrieve(batch_id).processing_status == "in_progress":
            client.messages.batches.cancel(batch_id)
