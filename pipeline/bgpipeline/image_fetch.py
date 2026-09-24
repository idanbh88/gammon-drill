"""Downloading the lesson pictures: PNGs from Galaxy's quiz CDN, checked before they are kept.

A picture counts as good when it is a complete PNG (signature, IHDR first, the IEND chunk at the
very end, so a cut-off download fails) and, when the server's ETag is an MD5 (Galaxy's CDN sends
the MD5 of the bytes), its MD5 matches. Network errors, 5xx answers, cut-off files and MD5
mismatches are retried; a 4xx is not.
"""

from __future__ import annotations

import hashlib
import re
import struct
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable

USER_AGENT = "gammon-drill lesson importer (https://github.com/idanbh88/gammon-drill)"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_BYTES = 20_000_000
_ETAG_MD5 = re.compile(r'^(?:W/)?"?([0-9a-fA-F]{32})"?$')

Fetch = Callable[[str, float], "tuple[bytes, str | None]"]
"""``fetch(url, timeout) -> (body, ETag header or None)``; raises ImageError."""


class ImageError(RuntimeError):
    """A picture could not be downloaded or is not a complete PNG; ``retry`` says whether trying
    again can help."""

    def __init__(self, message: str, *, retry: bool = False):
        super().__init__(message)
        self.retry = retry


@dataclass(frozen=True)
class PngInfo:
    width: int
    height: int


def png_info(data: bytes) -> PngInfo:
    """Width and height of a complete PNG; ImageError for anything else."""
    if len(data) < 45 or not data.startswith(PNG_SIGNATURE) or data[12:16] != b"IHDR":
        raise ImageError("not a PNG file")
    if data[-12:-4] != b"\x00\x00\x00\x00IEND":
        raise ImageError("incomplete PNG (no IEND chunk at the end)")
    width, height = struct.unpack(">II", data[16:24])
    if not width or not height:
        raise ImageError("PNG without pixels")
    return PngInfo(width, height)


def md5_hex(data: bytes) -> str:
    return hashlib.md5(data, usedforsecurity=False).hexdigest()


def etag_md5(etag: str | None) -> str | None:
    """The MD5 an ETag carries, or None for any other kind of ETag (a multipart "...-2")."""
    m = _ETAG_MD5.match((etag or "").strip())
    return m.group(1).lower() if m else None


def http_fetch(url: str, timeout: float) -> tuple[bytes, str | None]:
    """One GET. The URL is used exactly as given: Galaxy's paths are already percent-encoded."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            data = res.read(MAX_BYTES + 1)
            etag = res.headers.get("ETag")
    except urllib.error.HTTPError as e:
        raise ImageError(f"HTTP {e.code} {e.reason}", retry=e.code >= 500 or e.code == 429) from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ImageError(str(getattr(e, "reason", e)), retry=True) from None
    if len(data) > MAX_BYTES:
        raise ImageError(f"larger than {MAX_BYTES} bytes")
    return data, etag


def fetch_png(
    url: str,
    *,
    fetch: Fetch | None = None,
    timeout: float = 30.0,
    attempts: int = 3,
    sleep: Callable[[float], None] | None = None,
) -> tuple[bytes, PngInfo, str]:
    """Download one picture and check it; returns (bytes, size, md5)."""
    fetch = fetch or http_fetch
    sleep = sleep or time.sleep
    last: ImageError | None = None
    for attempt in range(attempts):
        if attempt:
            sleep(0.5 * 2**attempt)
        try:
            data, etag = fetch(url, timeout)
        except ImageError as e:
            last = e
            if e.retry:
                continue
            break
        try:
            info = png_info(data)
        except ImageError as e:
            last = e
            continue
        md5 = md5_hex(data)
        expected = etag_md5(etag)
        if expected and expected != md5:
            last = ImageError(f"the download does not match its ETag (md5 {md5}, ETag {expected})")
            continue
        return data, info, md5
    raise ImageError(f"{url}: {last}")
