"""Uncoloured pegs (24 Oct 2026, team test): wooden, white and grey pegs.

The peg mask was colour only (saturated, not skin), so a natural-wood peg (inside the skin band)
or a white / grey plastic peg was never seen: the team's real NHPT session logged
`pegs_detected: 0` with the default window and the agent's resample found no peg-sized coloured
patch (traces 318bb209a917). Occupancy now also reads change from the empty board captured when
the holes are first found (NHPT starts with every hole empty); changed regions far larger than a
peg are a hand or forearm (covering, not a peg), so a covered hole keeps its last decision.
"""

import cv2
import numpy as np
import pytest

from praxis_session.perception.board import BoardState
from praxis_session.perception.board_spec import NHPT_BOARD
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.synth import SKIN_BGR, WOOD_BGR, camera_frame, project, view_camera

H = NHPT_BOARD.targets_mm
SIZE = (640, 480)
LIGHT_WOOD = (130, 175, 215)  # BGR: natural wood, inside the skin hue band
WHITE = (238, 238, 238)
GREY = (150, 150, 150)


def _frame(holes, peg_bgr, board_bgr=None, tilt=35.0, hand=None):
    pegs = [(H[k][0], H[k][1], 8.0, 32.0, 7.0) for k in holes]
    frame, _ = camera_frame(NHPT_BOARD, tilt_deg=tilt, yaw_deg=5.0, focal_per_width=0.85, pegs_3d=pegs,
                            peg_bgr=peg_bgr, board_bgr=board_bgr, noise_sigma=2.0, seed=3)
    if hand is not None:  # a hand over the board, drawn after the pegs so it occludes them
        P = view_camera(NHPT_BOARD, SIZE, tilt, 5.0, 1.0, focal_per_width=0.85)
        x, y, rx, ry = hand
        a = np.linspace(0, 2 * np.pi, 40, endpoint=False)
        pts = project(P, np.stack([x + rx * np.cos(a), y + ry * np.sin(a), np.full(40, 40.0)], axis=1))
        cv2.fillPoly(frame, [np.round(pts).astype(np.int32)], SKIN_BGR, cv2.LINE_AA)
    return frame


def _board(peg_bgr, board_bgr=None):
    board, cal = BoardState(NHPT_BOARD), Calibrator(NHPT_BOARD)
    empty = _frame([], peg_bgr, board_bgr)
    board.detect_holes(board.warp(empty, cal.run(empty, 0.0)))
    return board, cal


def _occupied(board, cal, frame, t):
    canon = board.warp(frame, cal.run(frame, t))
    return {int(k.split("_")[1]) for k, v in board.occupancy(canon).items() if v == "occupied"}


def _settled(board, cal, frame, t):
    """The same view for a few frames: a peg seen by change alone counts once the board is quiet."""
    for i in range(board.quiet_frames + 1):  # the frame it appears in is movement
        got = _occupied(board, cal, frame, t + 0.08 * i)
    return got


@pytest.mark.parametrize(
    ("peg", "board_bgr"),
    [(LIGHT_WOOD, None), (WHITE, WOOD_BGR), (GREY, None), (GREY, WOOD_BGR)],
    ids=["wood-on-paper", "white-on-wood", "grey-on-paper", "grey-on-wood"],
)
def test_uncoloured_pegs_standing_in_holes_are_seen(peg, board_bgr):
    board, cal = _board(peg, board_bgr)
    assert _settled(board, cal, _frame([0, 4, 8], peg, board_bgr), 0.1) == {0, 4, 8}


def test_a_hand_over_the_board_is_covering_not_pegs_and_seated_pegs_stay_seated():
    board, cal = _board(LIGHT_WOOD)
    assert _settled(board, cal, _frame([0, 1], LIGHT_WOOD), 0.1) == {0, 1}
    # the hand covers the middle and top rows (holes 0-5), seated pegs included
    covered = _occupied(board, cal, _frame([0, 1], LIGHT_WOOD, hand=(105.0, 125.0, 60.0, 35.0)), 0.2)
    assert covered == {0, 1}
    assert _settled(board, cal, _frame([0, 1], LIGHT_WOOD), 0.5) == {0, 1}


def test_coloured_pegs_still_work_the_same():
    board, cal = _board((40, 40, 220))
    assert _occupied(board, cal, _frame([2, 6], (40, 40, 220)), 0.1) == {2, 6}  # colour: no wait


def test_wood_grain_specks_are_not_loose_pegs():
    # stress run 24 Oct: grey pegs on a wooden board at 45 deg left 5-30 mm2 specks of the colour
    # mask in the grain; read as loose pegs by a seated hole, they held the FSM in "seated" (no hand
    # seen) and the test stopped after five pegs. A peg's top alone is ~40 mm2.
    board, cal = BoardState(NHPT_BOARD), Calibrator(NHPT_BOARD)
    empty = _frame([], GREY, WOOD_BGR, tilt=45.0)
    board.detect_holes(board.warp(empty, cal.run(empty, 0.0)))
    holes = [4, 0, 8, 2, 6]
    pegs = [(H[k][0], H[k][1], 8.0, 32.0, 7.0) for k in holes] + [(160.0, 148.5, 0.0, 24.0, 7.0)]
    frame, _ = camera_frame(NHPT_BOARD, tilt_deg=45.0, yaw_deg=5.0, focal_per_width=0.85, pegs_3d=pegs,
                            peg_bgr=GREY, board_bgr=WOOD_BGR, noise_sigma=3.0, seed=9)
    free = board.free_pegs_mm(board.warp(frame, cal.run(frame, 0.1)))
    # loose pegs come from colour only (a grey peg is not a colour), and no speck is a peg
    assert free == [], free


def _fingers(frame, P, x, y, n=3):
    """Fingertips and their shadow over the board, no palm: the small pieces a real hand leaves
    when most of it is off the sheet (team test 24 Oct, Rinky: 9 'pegs' from one)."""
    for i in range(n):
        fx = x - 10.0 + 10.0 * i
        a = np.linspace(0, 2 * np.pi, 20, endpoint=False)
        pts = project(P, np.stack([fx + 4.5 * np.cos(a), y + 12.0 * np.sin(a), np.full(20, 15.0)], axis=1))
        cv2.fillPoly(frame, [np.round(pts).astype(np.int32)], SKIN_BGR, cv2.LINE_AA)
        sh = project(P, np.stack([fx + 6.0 + 5.0 * np.cos(a), y + 6.0 + 12.0 * np.sin(a), np.zeros(20)], axis=1))
        cv2.fillPoly(frame, [np.round(sh).astype(np.int32)], (150, 150, 150), cv2.LINE_AA)


def test_a_hand_moving_over_the_board_is_never_counted_as_pegs():
    board, cal = _board(LIGHT_WOOD)
    P = view_camera(NHPT_BOARD, SIZE, 35.0, 5.0, 1.0, focal_per_width=0.85)
    seen: set[int] = set()
    t = 0.1
    # fingertips and their shadows sweep over every hole, three frames at each, no peg placed
    for k in [0, 4, 8, 2, 6, 3, 5, 1, 7]:
        for _ in range(3):
            f = _frame([], LIGHT_WOOD)
            _fingers(f, P, H[k][0], H[k][1] + 4.0)
            seen |= _occupied(board, cal, f, t)
            t += 0.08
    assert seen == set(), seen
    # one real peg then goes in and the hand leaves: that one is counted
    for _ in range(4):
        got = _occupied(board, cal, _frame([4], LIGHT_WOOD), t)
        t += 0.08
    assert got == {4}


def test_change_alone_never_makes_a_loose_peg():
    board, cal = _board(LIGHT_WOOD)
    P = view_camera(NHPT_BOARD, SIZE, 35.0, 5.0, 1.0, focal_per_width=0.85)
    f = _frame([], LIGHT_WOOD)
    _fingers(f, P, 160.0, 200.0)
    assert board.free_pegs_mm(board.warp(f, cal.run(f, 0.1))) == []


def test_fingertips_held_still_over_an_empty_hole_are_not_a_peg():
    # deep run 24 Oct: fingertips frozen over a hole for 0.5 s made the board "quiet", the hole
    # read occupied, and the NHPT timer started early and stopped two pegs early. Change mostly
    # outside the peg footprints (fingers, their shadow) is never a peg.
    board, cal = _board(GREY)
    P = view_camera(NHPT_BOARD, SIZE, 35.0, 5.0, 1.0, focal_per_width=0.85)
    rng = np.random.default_rng(0)
    for k in (1, 4, 2):
        f = _frame([], GREY)
        _fingers(f, P, H[k][0], H[k][1] + 4.0)
        seen = set()
        for i in range(6):
            seen |= _occupied(board, cal, f, 1.0 + k + 0.08 * i)
        assert seen == set(), (k, seen)
    del rng
