#!/usr/bin/env python
"""Collect XGIDs (and the best-liked replies, where the forum exposes likes) from forum threads.

    uv run import_forum.py urls.txt -o positions.txt --answers answers.json

``urls.txt`` has one thread URL per line. Discourse forums (URLs like ``/t/<slug>/<id>``,
e.g. backgammonforums.com) are read through their JSON API, which gives every post with its
like count; any other page is fetched as HTML and scanned for ``XGID=`` strings.

Output ``positions.txt`` is ready for ``analyze.py`` (one XGID per line, source URL as a
comment). ``answers.json`` lists, per XGID, the posts that mention or follow it with their
like counts and an excerpt, most-liked first, as raw material for explanations.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from pathlib import Path

XGID_RE = re.compile(r"XGID=([-a-pA-P]{26}:-?\d+:-?\d+:-?\d+:[0-9DBRdbr]{1,2}:\d+:\d+:\d+:\d+:\d+)")
DISCOURSE_RE = re.compile(r"^(https?://[^/]+)/t/([^/]+)/(\d+)")
USER_AGENT = "bg-trainer-import/0.1 (+https://github.com/)"


def extract_xgids(text: str) -> list[str]:
    seen: list[str] = []
    for m in XGID_RE.finditer(text):
        x = m.group(1)
        if x not in seen:
            seen.append(x)
    return seen


def html_to_text(markup: str) -> str:
    try:
        from bs4 import BeautifulSoup  # type: ignore

        return BeautifulSoup(markup, "html.parser").get_text(" ")
    except ImportError:
        return html.unescape(re.sub(r"<[^>]+>", " ", markup))


def fetch(url: str, *, retries: int = 3) -> str:
    import requests  # type: ignore

    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
            r.raise_for_status()
            return r.text
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1 + attempt)
    raise RuntimeError(f"failed to fetch {url}: {last}")


def discourse_posts(url: str) -> list[dict] | None:
    """All posts of a Discourse topic: number, author, likes, text. None if not Discourse."""
    m = DISCOURSE_RE.match(url)
    if not m:
        return None
    base, slug, topic_id = m.groups()
    posts: list[dict] = []
    data = json.loads(fetch(f"{base}/t/{slug}/{topic_id}.json"))
    stream = data.get("post_stream", {})
    ids = stream.get("stream", [])
    loaded = {p["id"]: p for p in stream.get("posts", [])}
    missing = [i for i in ids if i not in loaded]
    for start in range(0, len(missing), 20):
        chunk = missing[start : start + 20]
        q = "&".join(f"post_ids[]={i}" for i in chunk)
        more = json.loads(fetch(f"{base}/t/{topic_id}/posts.json?{q}"))
        for p in more.get("post_stream", {}).get("posts", []):
            loaded[p["id"]] = p
    for pid in ids:
        p = loaded.get(pid)
        if not p:
            continue
        likes = 0
        for a in p.get("actions_summary", []):
            if a.get("id") == 2:
                likes = a.get("count", 0)
        posts.append(
            {
                "number": p.get("post_number"),
                "author": p.get("username"),
                "likes": likes,
                "text": html_to_text(p.get("cooked", "")),
            }
        )
    return posts


def collect(url: str) -> tuple[list[str], list[dict]]:
    """XGIDs in a thread plus candidate answer posts."""
    posts = discourse_posts(url)
    if posts is None:
        text = html_to_text(fetch(url))
        return extract_xgids(text), []
    xgids: list[str] = []
    answers: list[dict] = []
    current: str | None = None
    for p in posts:
        found = extract_xgids(p["text"])
        for x in found:
            if x not in xgids:
                xgids.append(x)
        if found:
            current = found[0]
        elif current:
            excerpt = re.sub(r"\s+", " ", p["text"]).strip()[:600]
            answers.append({"xgid": current, "url": url, "post": p["number"], "author": p["author"], "likes": p["likes"], "excerpt": excerpt})
    return xgids, answers


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("urls", type=Path, help="text file with one thread URL per line")
    ap.add_argument("-o", "--out", type=Path, default=Path("positions.txt"))
    ap.add_argument("--answers", type=Path, help="write candidate answer posts as JSON")
    args = ap.parse_args(argv)

    urls = [u.strip() for u in args.urls.read_text(encoding="utf-8").splitlines() if u.strip() and not u.startswith("#")]
    lines: list[str] = []
    all_answers: list[dict] = []
    seen: set[str] = set()
    for url in urls:
        try:
            xgids, answers = collect(url)
        except Exception as e:  # noqa: BLE001
            print(f"{url}: {e}", file=sys.stderr)
            continue
        new = [x for x in xgids if x not in seen]
        seen.update(new)
        print(f"{url}: {len(xgids)} XGID(s), {len(new)} new, {len(answers)} reply post(s)", file=sys.stderr)
        if new:
            lines.append(f"# {url}")
            lines.extend(new)
        all_answers.extend(answers)
    args.out.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    if args.answers:
        all_answers.sort(key=lambda a: (a["xgid"], -a["likes"], a["post"]))
        args.answers.write_text(json.dumps(all_answers, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(seen)} XGID(s) to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
