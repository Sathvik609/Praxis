"""Height-aware NHPT occupancy (12 Oct 2026, found by the 3-D renders in evaluation/blender).

A real peg stands 32 mm tall in a board on the sheet. Seen from a laptop camera tilted 20–50°
from straight down, its body projects onto the sheet plane as a streak running away from the
camera, starting several mm past the hole (the board's thickness) and ending 10–40 mm past it.
The canonical (sheet-plane) view measured occupancy on the hole disc only, so a seated peg read
empty, its streak was counted as a loose "free peg", and at steeper angles it lit the next hole.
These tests draw upright cylinders through the true camera matrix (synth.draw_cylinder).
"""

import cv2
import numpy as np
import pytest

from praxis_session.perception.board import BoardState
from praxis_session.perception.board_spec import NHPT_BOARD
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.synth import SKIN_BGR, camera_frame, project, view_camera

H = NHPT_BOARD.targets_mm
SIZE = (640, 480)


def _frame(tilt, holes, board_mm=8.0, fpw=0.85, yaw=5.0, d=7.0, noise=2.0):
    pegs = [(H[k][0], H[k][1], board_mm, 32.0, d) for k in holes]
    frame, _ = camera_frame(NHPT_BOARD, tilt_deg=tilt, yaw_deg=yaw, focal_per_width=fpw,
                            pegs_3d=pegs, noise_sigma=noise, seed=3)
    return frame


def _run(tilt, holes, **kw):
    board = BoardState(NHPT_BOARD)
    cal = Calibrator(NHPT_BOARD)
    empty = _frame(tilt, [], **{k: v for k, v in kw.items() if k != "d"})
    c0 = cal.run(empty, 0.0)
    board.detect_holes(board.warp(empty, c0))  # holes + empty templates on the empty board
    frame = _frame(tilt, holes, **kw)
    c = cal.run(frame, 0.1)
    canon = board.warp(frame, c)
    occ = {int(k.split("_")[1]) for k, v in board.occupancy(canon).items() if v == "occupied"}
    return board, canon, c, occ


@pytest.mark.parametrize("fpw", [0.75, 0.85, 1.0, 1.4])
def test_single_view_calibration_recovers_the_laptop_focal_length(fpw):
    frame = _frame(40, [], fpw=fpw)
    c = Calibrator(NHPT_BOARD).run(frame, 0.0)
    assert c.calibrated and c.camera is not None
    assert c.camera.source == "fit"
    assert abs(c.camera.focal_px / SIZE[0] - fpw) < 0.04 * fpw


def test_focal_falls_back_to_nominal_when_the_camera_looks_straight_down():
    frame = _frame(4, [], yaw=0.0)
    c = Calibrator(NHPT_BOARD).run(frame, 0.0)
    assert c.calibrated and c.camera is not None and c.camera.source == "nominal"


@pytest.mark.parametrize("tilt", [20, 35, 50])
def test_lift_to_sheet_matches_the_true_parallax_of_a_peg_top(tilt):
    frame = _frame(tilt, [], fpw=0.85)
    c = Calibrator(NHPT_BOARD).run(frame, 0.0)
    P = view_camera(NHPT_BOARD, SIZE, tilt, 5.0, 1.0, focal_per_width=0.85)
    top_px = project(P, np.array([[H[4][0], H[4][1], 30.0]]))
    truth = c.to_mm(top_px)[0]
    est = c.lift_to_sheet_mm(np.array([H[4]]), 30.0)[0]
    shift = float(np.hypot(*(truth - np.array(H[4]))))
    assert shift > 9.0  # the parallax is real: 10-40 mm at these angles
    assert float(np.hypot(*(est - truth))) < 1.0


@pytest.mark.parametrize("tilt,board_mm", [(40, 8.0), (45, 12.0), (30, 5.0), (20, 12.0)])
def test_a_seated_3d_peg_reads_its_own_hole_and_is_not_a_free_peg(tilt, board_mm):
    board, canon, c, occ = _run(tilt, [4], board_mm=board_mm)
    assert occ == {4}
    assert board.free_pegs_mm(canon) == []


def test_the_streak_of_a_tall_peg_does_not_light_the_next_hole_at_50_degrees():
    # A thin (3 mm) board: each peg is 29 mm proud and its top projects ~38 mm away, across
    # the next row's hole at 32 mm pitch.
    board, canon, c, occ = _run(50, [0, 1, 2], board_mm=3.0)
    assert occ == {0, 1, 2}
    assert board.free_pegs_mm(canon) == []


def test_a_partly_segmented_peg_does_not_light_the_next_hole():
    # Dim light: only the peg's upper part reads as peg colour (its lower part is a dark grey here),
    # so its own column is not confirmed - but its top still lands on the next row's disc. That
    # disc is another peg's streak, not a peg (render nhpt3d_04 read hole 7 for hole 4).
    from praxis_session.perception.synth import draw_cylinder

    board, cal = _session(45, board_mm=12.0)
    P = view_camera(NHPT_BOARD, SIZE, 45, 5.0, 1.0, focal_per_width=0.85)
    frame, _ = camera_frame(NHPT_BOARD, tilt_deg=45, yaw_deg=5.0, focal_per_width=0.85,
                            pegs_3d=[(H[1][0], H[1][1], 18.0, 32.0, 7.0)], noise_sigma=2.0, seed=3)
    draw_cylinder(frame, P, H[1], 12.0, 18.0, 3.5, (70, 70, 70))
    canon = board.warp(frame, cal.run(frame, 0.1))
    s = board.hole_scores(canon)
    assert s[4]["peg_fraction"] >= 0.35  # the streak's top is on hole 4's disc
    assert 0.15 <= s[1]["column_fraction"] < 0.5  # seen, but not confirmed
    occ = {int(k.split("_")[1]) for k, v in board.occupancy(canon).items() if v == "occupied"}
    assert 4 not in occ


def test_all_nine_3d_pegs_at_a_laptop_angle():
    board, canon, c, occ = _run(45, list(range(9)), board_mm=8.0)
    assert occ == set(range(9))
    assert board.free_pegs_mm(canon) == []


def test_a_peg_lying_on_the_sheet_beside_the_board_is_still_a_free_peg():
    frame, _ = camera_frame(NHPT_BOARD, tilt_deg=40, yaw_deg=5, focal_per_width=0.85, pegs_mm=[(165.0, 148.5)], noise_sigma=2.0)
    c = Calibrator(NHPT_BOARD).run(frame, 0.0)
    board = BoardState(NHPT_BOARD)
    canon = board.warp(frame, c)
    free = board.free_pegs_mm(canon)
    assert len(free) == 1 and abs(free[0][0] - 165.0) < 3 and abs(free[0][1] - 148.5) < 3


def _session(tilt, board_mm=8.0):
    """A board + calibrator primed on the empty board, like a live session."""
    board, cal = BoardState(NHPT_BOARD), Calibrator(NHPT_BOARD)
    empty = _frame(tilt, [], board_mm=board_mm)
    board.detect_holes(board.warp(empty, cal.run(empty, 0.0)))
    return board, cal


def _occupied(board, cal, frame, t):
    canon = board.warp(frame, cal.run(frame, t))
    return {int(k.split("_")[1]) for k, v in board.occupancy(canon).items() if v == "occupied"}


def _hand_over(frame, tilt, hole):
    """A skin-coloured, finger-width band over the hole and everything above it up to 40 mm."""
    P = view_camera(NHPT_BOARD, SIZE, tilt, 5.0, 1.0, focal_per_width=0.85)
    a, b = project(P, np.array([[H[hole][0], H[hole][1] - 6, 0.0], [H[hole][0], H[hole][1] + 6, 40.0]]))
    out = frame.copy()
    cv2.line(out, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), SKIN_BGR, 34)
    return out


def test_a_hand_over_a_seated_peg_holds_its_hole_occupied_and_an_empty_hole_empty():
    board, cal = _session(40)
    assert _occupied(board, cal, _frame(40, [4]), 0.1) == {4}
    # the hand covers hole 4 (and its peg) and hole 1 (empty): hidden is not a change
    hidden = _hand_over(_hand_over(_frame(40, [4]), 40, 4), 40, 1)
    assert _occupied(board, cal, hidden, 0.2) == {4}
    assert _occupied(board, cal, _frame(40, [4]), 0.3) == {4}
