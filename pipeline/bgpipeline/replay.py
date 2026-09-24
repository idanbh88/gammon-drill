"""Replay a parsed ``.mat`` match and collect one player's decisions.

Every game starts from the opening position with the score of its score line; each record is
validated against the legal-play generator and applied, so the XGID before every decision is
exact. For the tracked player the replay yields:

- ``cube``: the pre-roll "should I double?" decision (played ``no-double``) whenever the cube is
  live for them, and their actual doubles (played ``double``);
- ``take``: their takes and passes after an opponent's double (XGID with dice ``D``);
- ``checker``: every roll they played. Rolls with no legal play or exactly one legal play are
  kept with ``forced=True`` so the review can list them, but nothing evaluates them.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from .mat import HalfMove, MatError, MatMatch
from .moves import NotationError, apply_steps, generate_plays, parse_play, state_from_view
from .xgid import Position, opponent, parse_xgid, to_perspective, to_xgid, with_state

OPENING_BOARD = parse_xgid("-b----E-C---eE---c-e----B-:0:0:1:00:0:0:0:0:10").board
DEFAULT_MAX_CUBE = 1024


@dataclass(frozen=True)
class Decision:
    game: int
    move_no: int
    player: int
    kind: str
    """``checker`` | ``cube`` | ``take``."""
    xgid: str
    """The position before the decision; the tracked player is the acting player."""
    dice: tuple[int, int] | None
    played: str
    """Checker: normalised notation (empty for a dance). Cube: ``double`` / ``no-double``.
    Take: ``take`` / ``pass``."""
    forced: bool
    """Checker only: no choice (0 or 1 legal plays). Never evaluated."""
    n_plays: int
    line_no: int

    @property
    def decision_id(self) -> str:
        return f"g{self.game}-m{self.move_no}-{self.kind}"


@dataclass
class GameResult:
    number: int
    score: tuple[int, int]
    """At the start of the game."""
    crawford: bool
    winner: int | None
    points: int | None
    records: int
    final_xgid: str


@dataclass
class Replay:
    decisions: list[Decision]
    games: list[GameResult]
    final_score: tuple[int, int]


def cube_live(pos: Position, player: int) -> bool:
    """Whether ``player`` could double in this position, i.e. a pre-roll cube decision exists:
    not the Crawford game, cube centred or theirs, below the cube limit, and (in a match) a
    double could still change the outcome for them."""
    if pos.crawford:
        return False
    if pos.cube_owner not in (0, player):
        return False
    if pos.cube_value >= pos.max_cube:
        return False
    if pos.match_length > 0 and pos.score[player - 1] + pos.cube_value >= pos.match_length:
        return False
    return True


def _start_position(score: tuple[int, int], match_length: int, crawford: bool, max_cube: int) -> Position:
    return Position(
        board=OPENING_BOARD,
        cube_value=1,
        cube_owner=0,
        turn=1,
        dice=None,
        cube_action="none",
        score=score,
        match_length=match_length,
        crawford=crawford,
        jacoby=False,
        beavers=False,
        max_cube=max_cube,
    )


def _dice_text(d: tuple[int, int]) -> str:
    return f"{d[0]}{d[1]}"


def replay(match: MatMatch, player: int = 1) -> Replay:
    if player not in (1, 2):
        raise ValueError("player must be 1 or 2")
    length = match.match_length
    max_cube = match.header.cube_limit or DEFAULT_MAX_CUBE
    if max_cube <= 0 or max_cube & (max_cube - 1):
        max_cube = DEFAULT_MAX_CUBE
    decisions: list[Decision] = []
    results: list[GameResult] = []
    score: tuple[int, int] | None = None
    post_crawford = False

    for game in match.games:
        s1, s2 = game.score
        if score is not None and (s1, s2) != score:
            raise MatError(game.line_no, f"game {game.number} starts at {s1}-{s2}, but the previous games give {score[0]}-{score[1]}")
        crawford = False
        if length > 0 and not post_crawford and ((s1 == length - 1) != (s2 == length - 1)):
            crawford = True
            post_crawford = True
        pos = _start_position((s1, s2), length, crawford, max_cube)
        winner: int | None = None
        points: int | None = None
        records = game.half_moves

        for idx, hm in enumerate(records):
            p = hm.player
            move_no = hm.move_no or 0
            if winner is not None:
                # After a drop the file still says who won; anything else is out of place.
                if hm.action == "win" and hm.player == winner:
                    if hm.points is not None and hm.points != points:
                        raise MatError(hm.line_no, f"the file says {hm.points} point(s) but the drop gives {points}")
                    continue
                raise MatError(hm.line_no, "a record after the game ended")
            if hm.action == "move":
                if pos.cube_action != "none":
                    raise MatError(hm.line_no, "a roll while a double is waiting for an answer")
                pos = replace(pos, turn=p, dice=None)
                if p == player and cube_live(pos, p):
                    decisions.append(Decision(game.number, move_no, p, "cube", to_xgid(pos), None, "no-double", False, 0, hm.line_no))
                view = to_perspective(pos, p)
                plays = generate_plays(view, hm.dice)  # type: ignore[arg-type]
                rolled = replace(pos, dice=hm.dice)
                if not plays:
                    if hm.plays:
                        raise MatError(hm.line_no, f"no legal play with {_dice_text(hm.dice)} but the file has {hm.plays!r}")
                    if p == player:
                        decisions.append(Decision(game.number, move_no, p, "checker", to_xgid(rolled), hm.dice, "", True, 0, hm.line_no))
                    pos = replace(pos, turn=opponent(p), dice=None)
                    continue
                if not hm.plays:
                    if all(later.action == "win" for later in records[idx + 1 :]):
                        break  # rolled, then resigned
                    raise MatError(hm.line_no, f"{len(plays)} legal plays with {_dice_text(hm.dice)} but no play is recorded")
                try:
                    steps = parse_play(hm.plays)
                except NotationError as e:
                    raise MatError(hm.line_no, str(e)) from e
                result = apply_steps(state_from_view(view), steps)
                matched = next((pl for pl in plays if result is not None and pl.result.key() == result.key()), None)
                if matched is None:
                    raise MatError(hm.line_no, f"illegal play {hm.plays!r} with {_dice_text(hm.dice)}")
                if p == player:
                    # Canonical notation from the generator: "24/18(2) 13/7(2)", hits marked.
                    decisions.append(
                        Decision(game.number, move_no, p, "checker", to_xgid(rolled), hm.dice, matched.notation, len(plays) == 1, len(plays), hm.line_no)
                    )
                pos = with_state(pos, p, result)
                pos = replace(pos, turn=opponent(p), dice=None)
            elif hm.action == "double":
                if pos.cube_action != "none":
                    raise MatError(hm.line_no, "a double while a double is waiting for an answer")
                pos = replace(pos, turn=p, dice=None)
                if not cube_live(pos, p):
                    raise MatError(hm.line_no, f"player {p} doubled although the cube was not available to them")
                if hm.cube_to is not None and hm.cube_to != pos.cube_value * 2:
                    raise MatError(hm.line_no, f"double to {hm.cube_to} with the cube at {pos.cube_value}")
                if p == player:
                    decisions.append(Decision(game.number, move_no, p, "cube", to_xgid(pos), None, "double", False, 0, hm.line_no))
                pos = replace(pos, cube_action="double")
            elif hm.action in ("take", "drop"):
                if pos.cube_action != "double":
                    raise MatError(hm.line_no, f"{hm.action} without a double")
                doubler = pos.turn
                if p != opponent(doubler):
                    raise MatError(hm.line_no, f"{hm.action} by the player who doubled")
                if p == player:
                    played = "take" if hm.action == "take" else "pass"
                    decisions.append(Decision(game.number, move_no, p, "take", to_xgid(pos), None, played, False, 0, hm.line_no))
                if hm.action == "take":
                    pos = replace(pos, cube_value=pos.cube_value * 2, cube_owner=p, cube_action="none")
                else:
                    winner, points = doubler, pos.cube_value
                    pos = replace(pos, cube_action="none")
            elif hm.action == "win":
                if hm.points is None or hm.points <= 0:
                    raise MatError(hm.line_no, "a win without points")
                winner, points = p, hm.points
            else:  # pragma: no cover - the parser only produces the actions above
                raise MatError(hm.line_no, f"unknown record {hm.action}")

        if winner is None:
            # No win line: a bear-off that ended the game still decides it.
            for side in (1, 2):
                if to_perspective(pos, side).my_off == 15:
                    winner, points = side, pos.cube_value
        if winner is not None and points:
            score = (s1 + points, s2) if winner == 1 else (s1, s2 + points)
        else:
            score = (s1, s2)
        results.append(GameResult(game.number, (s1, s2), crawford, winner, points, len(records), to_xgid(pos)))

    return Replay(decisions, results, score or (0, 0))
