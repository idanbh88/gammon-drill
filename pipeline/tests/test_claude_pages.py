"""Claude's reading requests: their shape, the strict schemas, the cache and batch collection,
with a fake client (no network)."""

import json
from types import SimpleNamespace

import pytest

pytest.importorskip("anthropic")

from bgpipeline import claude_pages as cp  # noqa: E402


def _objects(schema):
    if isinstance(schema, dict):
        if schema.get("type") == "object":
            yield schema
        for v in schema.values():
            yield from _objects(v)
    elif isinstance(schema, list):
        for v in schema:
            yield from _objects(v)


@pytest.mark.parametrize("kind", ["page", "board"])
def test_schemas_are_strict(kind):
    for obj in _objects(cp.KINDS[kind].schema):
        assert obj["additionalProperties"] is False
        assert sorted(obj["required"]) == sorted(obj["properties"])


def test_request_shape():
    item = cp.Item("board", "s003-L-1", b"\xff\xd8jpeg")
    p = cp.params(item)
    assert p["model"] == cp.MODEL and p["max_tokens"] == cp.MAX_TOKENS
    image, text = p["messages"][0]["content"]
    assert image["source"]["media_type"] == "image/jpeg" and image["type"] == "image"
    assert text["text"] == cp.BOARD_INSTRUCTIONS
    assert p["output_config"]["effort"] == "medium" and p["output_config"]["format"]["schema"] is cp.BOARD_SCHEMA
    assert "temperature" not in p and "thinking" not in p
    assert item.custom_id == "board-s003-L-1"


def message(payload, stop="end_turn"):
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=json.dumps(payload))],
        stop_reason=stop,
        usage=SimpleNamespace(input_tokens=1000, output_tokens=200),
        model="claude-opus-5",
    )


BOARD = {"black": [{"point": 6, "count": 5}], "white": [], "black_bar": 0, "white_bar": 0, "black_off": 10, "white_off": 15, "cube_position": "middle", "cube_text": None, "confidence": "high", "notes": ""}


def test_cache_round_trip_and_version(tmp_path):
    a = cp._parse("board", "s003-L-1", message(BOARD), model="claude-opus-5", effort="medium", batch=True, request_id=None)
    cp.save_answer(tmp_path, a)
    cached = cp.load_cached(tmp_path, "board", "s003-L-1")
    assert cached["reading"] == BOARD and cached["version"] == cp.KINDS["board"].version
    assert cp.board_totals(cached["reading"]) == (15, 15)
    path = cp.cache_path(tmp_path, "board", "s003-L-1")
    stale = json.loads(path.read_text(encoding="utf-8")) | {"version": "board-0"}
    path.write_text(json.dumps(stale), encoding="utf-8")
    assert cp.load_cached(tmp_path, "board", "s003-L-1") is None  # made with other instructions
    assert cp.cost([a]) == pytest.approx(0.5 * (1000 * 5 + 200 * 25) / 1e6)


def test_refusals_and_cut_offs_are_errors():
    refused = cp._parse("page", "s001-L", message({}, "refusal"), model="m", effort="low", batch=False, request_id=None)
    assert refused.reading is None and refused.error == "refused"
    cut = cp._parse("page", "s001-L", message({}, "max_tokens"), model="m", effort="low", batch=False, request_id=None)
    assert cut.error == "cut off at max_tokens"


class FakeBatches:
    def __init__(self):
        self.created = []

    def create(self, requests):
        self.created.append(requests)
        return SimpleNamespace(id=f"msgbatch_{len(self.created)}")

    def retrieve(self, batch_id):
        return SimpleNamespace(processing_status="ended", request_counts=SimpleNamespace(succeeded=1, processing=0, errored=0))

    def results(self, batch_id):
        n = int(batch_id.rsplit("_", 1)[1])
        for r in self.created[n - 1]:
            if r["custom_id"].endswith("-2"):
                yield SimpleNamespace(custom_id=r["custom_id"], result=SimpleNamespace(type="errored"))
            else:
                yield SimpleNamespace(custom_id=r["custom_id"], result=SimpleNamespace(type="succeeded", message=message(BOARD)))


def test_run_batches_journals_caches_and_skips_cached_items(tmp_path):
    client = SimpleNamespace(messages=SimpleNamespace(batches=FakeBatches()))
    items = [cp.Item("board", f"s003-L-{i}", b"x") for i in (1, 2, 3)]
    answers = cp.run_batches(client, items, tmp_path, chunk=2, poll=0)
    assert [len(b) for b in client.messages.batches.created] == [2, 1]
    assert [j["batch_id"] for j in cp.journal(tmp_path)] == ["msgbatch_1", "msgbatch_2"]
    assert sorted(a.key for a in answers if a.reading) == ["s003-L-1", "s003-L-3"]
    assert cp.load_cached(tmp_path, "board", "s003-L-2") is None
    again = cp.run_batches(client, items, tmp_path, chunk=2, poll=0)
    assert [a.key for a in again] == ["s003-L-2"]  # only the failed one is sent again


def test_page_issues():
    good = {"problems": [{"number": 1, "kind": "checker", "dice": "31"}, {"number": 2, "kind": "cube", "dice": None}], "solutions": [{"number": 1}, {"number": None}, {"number": 2}]}
    assert cp.page_issues(good) == []
    bad = {"problems": [{"number": 3, "kind": "checker", "dice": "71"}, {"number": 2, "kind": "checker", "dice": "3-1"}], "solutions": []}
    issues = cp.page_issues(bad)
    assert any("out of order" in i for i in issues) and any("'71'" in i for i in issues) and any("'3-1'" in i for i in issues)


def test_load_api_key_reads_the_env_file(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    assert not cp.load_api_key(tmp_path)
    (tmp_path / ".env").write_text("OTHER=1\nANTHROPIC_API_KEY='sk-test'\n", encoding="utf-8")
    assert cp.load_api_key(tmp_path)
    import os

    assert os.environ["ANTHROPIC_API_KEY"] == "sk-test"


class FakeStream:
    def __init__(self, key):
        self.key = key
        self.request_id = f"req_{key}"

    def __enter__(self):
        if self.key.endswith("-2"):
            raise ConnectionError("overloaded")
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return message(BOARD)


def test_read_many_direct_caches_each_answer_and_survives_a_failed_request(tmp_path):
    def stream(**req):
        assert req["fallbacks"] == "default" and req["betas"] == [cp.FALLBACK_BETA]
        text = req["messages"][0]["content"][0]["source"]["data"]
        return FakeStream({cp.base64.b64encode(f"s003-L-{i}".encode()).decode(): f"s003-L-{i}" for i in (1, 2, 3)}[text])

    client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(stream=stream)))
    items = [cp.Item("board", f"s003-L-{i}", f"s003-L-{i}".encode()) for i in (1, 2, 3)]
    lines = []
    answers = cp.read_many_direct(client, items, tmp_path, workers=2, log=lines.append)
    by_key = {a.key: a for a in answers}
    assert by_key["s003-L-2"].reading is None and "overloaded" in by_key["s003-L-2"].error
    assert by_key["s003-L-1"].request_id == "req_s003-L-1" and not by_key["s003-L-1"].batch
    assert cp.load_cached(tmp_path, "board", "s003-L-3")["reading"] == BOARD
    assert cp.load_cached(tmp_path, "board", "s003-L-2") is None
    assert len(lines) == 3 and lines[-1].startswith("3 of 3 read")
