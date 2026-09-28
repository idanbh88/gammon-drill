"""Assembly of the book's problems from invented page readings and board readings (nothing
from the book itself is committed)."""

from bgpipeline.pdf_pages import PageImage
from bgpipeline.robertie import Counts, assemble, position_of
from bgpipeline.xgid import parse_xgid

OPENING_BLACK = {24: 2, 13: 5, 8: 3, 6: 5}
OPENING_WHITE = {1: 2, 12: 5, 17: 3, 19: 5}


def page(name, ink=0.05):
    return PageImage(name, int(name[1:4]), name[-1], f"pages/{name}.jpg", 1169, 1653, ink)


def local(black, white, **kw):
    return {
        "black": {str(k): v for k, v in black.items()},
        "white": {str(k): v for k, v in white.items()},
        "black_bar": kw.get("black_bar", 0), "white_bar": kw.get("white_bar", 0),
        "black_off": kw.get("black_off", 0), "white_off": kw.get("white_off", 0),
        "cube_position": kw.get("cube", "middle"), "issues": [], "notes": [], "angle": 0, "frame": [0, 0, 0, 0],
    }


def claude(black, white, **kw):
    return {
        "black": [{"point": k, "count": v} for k, v in black.items()],
        "white": [{"point": k, "count": v} for k, v in white.items()],
        "black_bar": kw.get("black_bar", 0), "white_bar": kw.get("white_bar", 0),
        "black_off": kw.get("black_off", 0), "white_off": kw.get("white_off", 0),
        "cube_position": kw.get("cube", "middle"), "cube_text": None, "confidence": "high", "notes": "",
    }


def caption(n, dice=None, text=None):
    kind = "checker" if dice else "cube"
    return {"number": n, "caption": text or (f"Problem {n}: Black to play {dice}." if dice else f"Problem {n}: Should Black double?"), "kind": kind, "dice": dice}


def solution(n, text, play=None, cube=None, cont=False):
    return {"number": n, "heading": None if n is None else f"Problem {n}:", "text": text, "continues_on_next_page": cont, "play": play, "cube": cube}


def book(readings, boards_local, boards_claude, fixes=None, pages=None):
    pages = pages or [page(n) for n in readings]
    return assemble(None, pages, readings, boards_local, boards_claude, fixes or {})


def test_opening_position_builds_the_standard_xgid():
    pos = position_of(Counts(OPENING_BLACK, OPENING_WHITE), "31")
    assert pos.board == parse_xgid("-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:0:10").board
    assert pos.dice == (3, 1) and pos.turn == 1 and pos.match_length == 0 and not pos.jacoby
    owned = position_of(Counts(OPENING_BLACK, OPENING_WHITE, cube="bottom"), None)
    assert (owned.cube_value, owned.cube_owner) == (2, 1)
    theirs = position_of(Counts(OPENING_BLACK, OPENING_WHITE, cube="top"), None)
    assert (theirs.cube_value, theirs.cube_owner) == (2, 2)


def test_problems_are_paired_with_diagrams_solutions_and_chapters():
    readings = {
        "s001-R": {"chapter": {"number": 5, "title": "The Opening"}, "problems": [caption(1, "31", "Problem 1: Opening roll, Black to play 31."), caption(2, "64")], "solutions": []},
        "s002-L": {"chapter": None, "problems": [caption(3, None)], "solutions": [solution(1, "Make the point.", "8/5 6/5!")]},
        "s002-R": {"chapter": None, "problems": [], "solutions": [solution(2, "Run with the six", None, cont=True)]},
        "s003-L": {"chapter": None, "problems": [], "solutions": [solution(None, "and split: 24/18 13/9.", "24/18 13/9"), solution(3, "A double and a take.", cube={"double": "double", "take": "take"})]},
    }
    loc = {"s001-R-1": local(OPENING_BLACK, OPENING_WHITE), "s001-R-2": local(OPENING_BLACK, OPENING_WHITE), "s002-L-1": local(OPENING_BLACK, OPENING_WHITE)}
    cla = {"s001-R-1": claude(OPENING_BLACK, OPENING_WHITE), "s001-R-2": claude(OPENING_BLACK, OPENING_WHITE), "s002-L-1": claude(OPENING_BLACK, OPENING_WHITE)}
    chapters, problems, notes = book(readings, loc, cla)
    assert [(c.number, c.title, c.first_problem, c.last_problem) for c in chapters] == [(5, "The Opening", 1, 3)]
    p1, p2, p3 = problems[:3]
    assert p1.status == "ok", p1.issues
    assert p1.book_answer == "8/5 6/5" and p1.diagram == "s001-R-1" and p1.chapter == 5
    assert p1.xgid.startswith("-b----E-C---eE---c-e----B-:0:0:1:31:")
    assert p2.status == "ok", p2.issues
    assert p2.solution == "Run with the six and split: 24/18 13/9." and p2.solution_pages == ["s002-R", "s003-L"]
    assert p3.kind == "cube" and p3.book_answer == "double-take" and p3.xgid.split(":")[4] == "00"
    assert all(p.status == "check" and "no caption found" in p.issues for p in problems[3:])


def test_disagreeing_readings_and_bad_plays_are_flagged():
    readings = {"s010-L": {"chapter": {"number": 9, "title": "The Blitz"}, "problems": [caption(50, "31"), caption(51, "31")], "solutions": [solution(50, "x", "8/5 6/5"), solution(51, "x", "13/9 6/5")]}}
    other = {**OPENING_WHITE, 12: 4, 11: 1}
    loc = {"s010-L-1": local(OPENING_BLACK, OPENING_WHITE), "s010-L-2": local(OPENING_BLACK, OPENING_WHITE)}
    cla = {"s010-L-1": claude(OPENING_BLACK, other), "s010-L-2": claude(OPENING_BLACK, OPENING_WHITE)}
    _c, problems, _n = book(readings, loc, cla)
    p50, p51 = problems[49], problems[50]
    assert p50.status == "check" and "point 11: empty / 1 white" in p50.issues[0] and "point 12: 5 white / 4 white" in p50.issues[0]
    assert p51.status == "check" and any("not legal" in i for i in p51.issues)  # 13/9 6/5 is not a 3-1


def test_fixes_accept_a_reading_or_replace_the_position():
    readings = {"s010-L": {"chapter": None, "problems": [caption(60, "31"), caption(61, "31")], "solutions": [solution(60, "x", "8/5 6/5"), solution(61, "x", "8/5 6/5")]}}
    other = {**OPENING_WHITE, 12: 4, 11: 1}
    loc = {"s010-L-1": local(OPENING_BLACK, OPENING_WHITE), "s010-L-2": local(OPENING_BLACK, other)}
    cla = {"s010-L-1": claude(OPENING_BLACK, other), "s010-L-2": claude(OPENING_BLACK, other)}
    fixes = {60: {"accept": "local"}, 61: {"xgid": "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:0:10", "note": "set by hand"}}
    _c, problems, _n = book(readings, loc, cla, fixes)
    assert problems[59].status == "fixed" and problems[59].xgid.startswith("-b----E-C---eE---c-e----B-")
    assert problems[60].status == "fixed" and problems[60].fix["note"] == "set by hand"


def test_totals_and_caption_checks():
    readings = {"s011-L": {"chapter": None, "problems": [caption(70, "43", "Problem 70: Black, on bar, to play 43."), caption(71, "31")], "solutions": [solution(70, "x", "bar/21 6/3"), solution(71, "x", "8/5 6/5")]}}
    short = {**OPENING_BLACK, 13: 4}
    loc = {"s011-L-1": local(OPENING_BLACK, OPENING_WHITE), "s011-L-2": local(short, OPENING_WHITE)}
    cla = {"s011-L-1": claude(OPENING_BLACK, OPENING_WHITE), "s011-L-2": claude(short, OPENING_WHITE)}
    _c, problems, _n = book(readings, loc, cla)
    assert any("on the bar" in i for i in problems[69].issues)
    assert any("totals black 14" in i for i in problems[70].issues)


def test_diagram_count_mismatch_is_noted():
    readings = {"s012-L": {"chapter": None, "problems": [caption(80, "31"), caption(81, "31")], "solutions": []}}
    loc = {"s012-L-1": local(OPENING_BLACK, OPENING_WHITE)}
    _c, problems, notes = book(readings, loc, {})
    assert any("2 captions but 1 diagrams" in n for n in notes)
    assert "diagram not found on the page" in problems[79].issues


def test_text_after_an_unread_page_is_not_joined_to_an_earlier_solution():
    readings = {
        "s020-L": {"chapter": None, "problems": [], "solutions": [solution(90, "Hold the anchor", None, cont=True)]},
        # s020-R was not read
        "s021-L": {"chapter": None, "problems": [], "solutions": [solution(None, "and wait.", "8/5 6/5"), solution(92, "x", "8/5 6/5")]},
    }
    pages = [page("s020-L"), page("s020-R"), page("s021-L")]
    _c, problems, notes = book(readings, {}, {}, pages=pages)
    assert problems[89].solution == "Hold the anchor"
    assert any("s020-R: no page reading" in n for n in notes) and any("s021-L: continuation text" in n for n in notes)


def test_text_at_the_top_of_a_page_continues_the_solution_before_it_unless_a_chapter_opens():
    readings = {
        "s022-L": {"chapter": None, "problems": [], "solutions": [solution(93, "Hold the anchor", None, cont=False)]},
        "s022-R": {"chapter": None, "problems": [], "solutions": [solution(None, "and wait: 8/5 6/5.", "8/5 6/5"), solution(94, "Run.", None)]},
        "s023-L": {"chapter": {"number": 10, "title": "One Man Back"}, "problems": [], "solutions": [solution(None, "Chapter introduction.", None)]},
    }
    _c, problems, notes = book(readings, {}, {})
    assert problems[92].solution == "Hold the anchor and wait: 8/5 6/5." and problems[92].solution_pages == ["s022-L", "s022-R"]
    assert problems[93].solution == "Run." and any("s023-L: continuation text" in n for n in notes)


def test_a_restated_part_of_the_play_is_not_a_second_answer():
    readings = {"s030-L": {"chapter": None, "problems": [caption(95, "44")], "solutions": [solution(95, "x", "24/20*(2) 13/9(2)"), solution(None, "y", None)]}}
    readings["s030-L"]["solutions"] = [solution(95, "x", "24/20(2) 13/9(2)")]
    _c, problems, _n = book(readings, {"s030-L-1": local(OPENING_BLACK, OPENING_WHITE)}, {"s030-L-1": claude(OPENING_BLACK, OPENING_WHITE)})
    assert problems[94].status == "ok", problems[94].issues


def test_fix_can_set_points_on_the_chosen_reading():
    readings = {"s031-L": {"chapter": None, "problems": [caption(96, "31")], "solutions": [solution(96, "x", "8/5 6/5")]}}
    wrong = {**OPENING_WHITE, 12: 4}
    loc = {"s031-L-1": local(OPENING_BLACK, wrong)}
    cla = {"s031-L-1": claude(OPENING_BLACK, {**OPENING_WHITE, 17: 2, 12: 6})}
    fixes = {96: {"accept": "local", "set": {"white": {"12": 5}}, "note": "one white hidden behind the 13-point stack"}}
    _c, problems, _n = book(readings, loc, cla, fixes)
    assert problems[95].status == "fixed", problems[95].issues
    assert problems[95].xgid.startswith("-b----E-C---eE---c-e----B-")
