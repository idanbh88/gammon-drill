"""Shared test helpers."""

import struct
import zlib

import pytest


def tiny_png(shade: int = 0) -> bytes:
    """A valid 2x1 greyscale PNG; ``shade`` changes the bytes (and so the MD5)."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 2, 1, 8, 0, 0, 0, 0)
    pixels = zlib.compress(bytes([0, shade % 256, 255]))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", pixels) + chunk(b"IEND", b"")


@pytest.fixture
def make_png():
    return tiny_png
