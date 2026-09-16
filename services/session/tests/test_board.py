import numpy as np

from praxis_session.perception.board import BoardState
from praxis_session.perception.board_spec import NHPT_BOARD
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.synth import camera_frame

H = NHPT_BOARD.targets_mm


def _canon(pegs_mm):
    frame, _ = camera_frame(NHPT_BOARD, tilt_deg=15, yaw_deg=5, pegs_mm=pegs_mm)
    cal = Calibrator(NHPT_BOARD).run(frame)
    assert cal.calibrated
    board = BoardState(NHPT_BOARD)
    return board, board.warp(frame, cal), cal


def test_pitch_is_32mm():
    assert abs(BoardState(NHPT_BOARD).pitch_mm - 32.0) < 1e-6


def test_holes_found_by_hough_and_cached():
    board, canon, _ = _canon([])
    holes = board.detect_holes(canon)
    assert len(holes) == 9 and board.hole_source == "hough"
    assert board.holes_cached
    assert board.detect_holes(canon) is holes
    for k, h in enumerate(holes):
        ex, ey = board.mm_to_canonical(H[k])
        assert abs(h.x - ex) < 2.0 * board.px_per_mm and abs(h.y - ey) < 2.0 * board.px_per_mm


def test_occupancy_marks_only_holes_with_pegs():
    board, canon, _ = _canon([H[0], H[4], H[8]])
    occ = board.occupancy(canon)
    assert {k for k, v in occ.items() if v == "occupied"} == {"hole_0", "hole_4", "hole_8"}
    assert board.free_pegs_mm(canon) == []


def test_blank_board_is_empty():
    board, canon, _ = _canon([])
    assert set(board.occupancy(canon).values()) == {"empty"}
    assert board.free_pegs_mm(canon) == []


def test_free_peg_off_grid_is_reported_in_mm():
    board, canon, _ = _canon([(160.0, 148.5)])
    free = board.free_pegs_mm(canon)
    assert len(free) == 1
    assert np.hypot(free[0][0] - 160.0, free[0][1] - 148.5) < 3.0
    assert set(board.occupancy(canon).values()) == {"empty"}


def test_event_payload_and_frame_px_overlay():
    board, canon, cal = _canon([H[1]])
    p = board.to_event_payload(canon)
    assert p["occupancy"]["hole_1"] == "occupied" and p["hole_source"] == "hough"
    assert len(p["holes_canonical_px"]) == 9 and p["px_per_mm"] == 3.0
    px = board.holes_frame_px(cal)
    assert len(px) == 9
    truth = cal.to_px(np.array(H, np.float32))
    assert np.allclose(np.array(px), truth, atol=2.5)
