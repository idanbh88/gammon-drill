"""Picture checks and download retries, offline."""

import pytest

from bgpipeline.image_fetch import ImageError, etag_md5, fetch_png, md5_hex, png_info


def test_png_info(make_png):
    assert (png_info(make_png()).width, png_info(make_png()).height) == (2, 1)
    with pytest.raises(ImageError, match="not a PNG"):
        png_info(b"<html>not found</html>" * 5)
    with pytest.raises(ImageError, match="incomplete"):
        png_info(make_png()[:-12])


def test_etag_md5():
    digest = "36ae61cf6264ce5abdb5cbfd32b7ef54"
    assert etag_md5(f'"{digest}"') == digest
    assert etag_md5(f'W/"{digest.upper()}"') == digest
    assert etag_md5(digest) == digest
    assert etag_md5('"36ae61cf6264ce5abdb5cbfd32b7ef54-2"') is None
    assert etag_md5(None) is None


def test_fetch_png_checks_the_etag(make_png):
    data = make_png()
    got, info, md5 = fetch_png("https://x/1.png", fetch=lambda url, timeout: (data, f'"{md5_hex(data)}"'))
    assert got == data and (info.width, info.height) == (2, 1) and md5 == md5_hex(data)
    # no usable ETag: the PNG check alone decides
    assert fetch_png("https://x/1.png", fetch=lambda url, timeout: (data, None))[0] == data


def test_fetch_png_retries_network_errors_and_bad_downloads(make_png):
    data = make_png()
    answers = [ImageError("timed out", retry=True), (data[:-12], None), (data, '"' + "0" * 32 + '"'), (data, None)]
    sleeps = []

    def flaky(url, timeout):
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    assert fetch_png("https://x/1.png", fetch=flaky, attempts=4, sleep=sleeps.append)[0] == data
    assert len(sleeps) == 3 and answers == []


def test_fetch_png_gives_up(make_png):
    calls = []

    def missing(url, timeout):
        calls.append(url)
        raise ImageError("HTTP 404 Not Found", retry=False)

    with pytest.raises(ImageError, match="404"):
        fetch_png("https://x/1.png", fetch=missing, sleep=lambda s: None)
    assert len(calls) == 1  # a 4xx is not retried

    data = make_png()
    with pytest.raises(ImageError, match="does not match its ETag"):
        fetch_png("https://x/1.png", fetch=lambda url, timeout: (data, '"' + "0" * 32 + '"'), sleep=lambda s: None)
