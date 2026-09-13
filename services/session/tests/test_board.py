from __future__ import annotations

import numpy as np

from praxis_session.perception.board import BoardState
from praxis_session.perception.board_spec import BOARD
from praxis_session.perception.calibration import Calibrator
from tests.synth import perspective_from_mm, render_frame

H = perspective_from_mm()
SOURCE_MM = (150.0, 148.5)  # a peg lying to the right of the grid, not in any hole


def _state_for(frame: np.ndarray) -> tuple[BoardState, np.ndarray]:
    cal = Calibrator().calibrate(frame)
    assert cal.calibrated
    bs = BoardState()
    canon = bs.warp(frame, cal)
    return bs, canon


def test_warp_produces_canonical_view_with_expected_size() -> None:
    bs, canon = _state_for(render_frame(H))
    assert canon.shape == (bs.canonical_h, bs.canonical_w, 3)
    assert bs.canonical_w == bs.canonical_h


def test_holes_detected_once_and_cached() -> None:
    bs, canon = _state_for(render_frame(H))
    holes = bs.detect_holes(canon)
    assert len(holes) == 9
    assert bs.holes_cached is True
    # Hole k must be within 1.5 mm of the spec position (converted to canonical px).
    for k, (hx, hy) in enumerate(BOARD.hole_centers_mm):
        ex, ey = bs.mm_to_canonical((hx, hy))
        assert abs(holes[k].x - ex) < 1.5 * bs.px_per_mm
        assert abs(holes[k].y - ey) < 1.5 * bs.px_per_mm
    assert bs.hole_source == "hough"
    # Second call returns the cache without re-detecting.
    again = bs.detect_holes(np.zeros_like(canon))
    assert again is holes


def test_empty_board_is_all_empty() -> None:
    bs, canon = _state_for(render_frame(H))
    bs.detect_holes(canon)
    occ = bs.occupancy(canon)
    assert [occ[f"hole_{k}"] for k in range(9)] == ["empty"] * 9


def test_pegs_in_holes_are_occupied_and_free_pegs_are_reported() -> None:
    pegs = [BOARD.hole_centers_mm[0], BOARD.hole_centers_mm[4], BOARD.hole_centers_mm[8], SOURCE_MM]
    bs, canon = _state_for(render_frame(H, pegs_mm=pegs))
    bs.detect_holes(canon)
    occ = bs.occupancy(canon)
    assert [occ[f"hole_{k}"] for k in range(9)] == [
        "occupied", "empty", "empty",
        "empty", "occupied", "empty",
        "empty", "empty", "occupied",
    ]
    free = bs.free_pegs_mm(canon)
    assert len(free) == 1
    assert np.linalg.norm(np.array(free[0]) - np.array(SOURCE_MM)) < 2.0


def test_occupancy_is_stable_against_hole_neighbours() -> None:
    # A peg in hole 4 must not light up holes 1, 3, 5, 7.
    bs, canon = _state_for(render_frame(H, pegs_mm=[BOARD.hole_centers_mm[4]]))
    bs.detect_holes(canon)
    occ = bs.occupancy(canon)
    assert sum(v == "occupied" for v in occ.values()) == 1
    assert occ["hole_4"] == "occupied"


def test_falls_back_to_spec_positions_when_hough_finds_nothing() -> None:
    bs = BoardState()
    holes = bs.detect_holes(np.full((bs.canonical_h, bs.canonical_w, 3), 255, np.uint8))
    assert len(holes) == 9
    assert bs.hole_source == "spec"


def test_board_event_payload() -> None:
    bs, canon = _state_for(render_frame(H, pegs_mm=[BOARD.hole_centers_mm[2]]))
    bs.detect_holes(canon)
    payload = bs.to_event_payload(canon)
    assert payload["occupancy"]["hole_2"] == "occupied"
    assert payload["hole_source"] == "hough"
    assert len(payload["holes_canonical_px"]) == 9
    assert payload["free_pegs_mm"] == []
