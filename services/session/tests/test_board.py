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


# ---- Colour sampling, skin/hand exclusion, Hough + template used ----------
from dataclasses import replace  # noqa: E402

from praxis_session.perception.synth import WOOD_BGR  # noqa: E402

SRC = (160.0, 148.5)


def _canon_kw(pegs_mm, **kw):
    frame, _ = camera_frame(NHPT_BOARD, tilt_deg=15, yaw_deg=5, pegs_mm=pegs_mm, **kw)
    cal = Calibrator(NHPT_BOARD).run(frame)
    assert cal.calibrated
    board = BoardState(NHPT_BOARD)
    return board, board.warp(frame, cal), cal


def test_skin_blob_over_board_does_not_flip_occupancy_or_add_free_pegs():
    # A hand-sized skin patch over holes 4/5 and another beside the grid: no peg anywhere.
    board, canon, _ = _canon_kw([], skin_blobs_mm=[(H[4][0] + 8, H[4][1], 14.0), (150, 120, 12)])
    assert set(board.occupancy(canon).values()) == {"empty"}
    assert board.free_pegs_mm(canon) == []
    # ... and a real peg next to skin is still found.
    board, canon, _ = _canon_kw([H[0]], skin_blobs_mm=[(H[4][0] + 8, H[4][1], 14.0)])
    assert board.occupancy(canon)["hole_0"] == "occupied"


def test_hand_rect_exclusion_removes_free_peg_blobs_only():
    board, canon, _ = _canon_kw([SRC, H[4]])
    assert len(board.free_pegs_mm(canon)) == 1
    rect = (SRC[0] - 10, SRC[1] - 10, SRC[0] + 10, SRC[1] + 10)
    assert board.free_pegs_mm(canon, exclude_mm=[rect]) == []
    # Hole occupancy is never blanked by the hand box (the hand covers a hole right after seating).
    assert board.occupancy(canon, exclude_mm=[rect])["hole_4"] == "occupied"


def test_wooden_board_tint_is_not_a_peg_and_sampled_colour_still_finds_pegs():
    board, canon, _ = _canon_kw([H[0], SRC], board_bgr=WOOD_BGR)
    assert [k for k, v in board.occupancy(canon).items() if v == "occupied"] == ["hole_0"]
    assert len(board.free_pegs_mm(canon)) == 1
    rng = board.sample_peg_colour(canon, H[0])
    assert rng["source"] == "sampled" and rng["h_lo"] <= rng["h"] <= rng["h_hi"]
    assert board.occupancy(canon)["hole_0"] == "occupied"
    assert len(board.free_pegs_mm(canon)) == 1


def test_wooden_pegs_need_sampling_which_lifts_the_skin_exclusion():
    board, canon, _ = _canon_kw([H[4], SRC], peg_bgr=WOOD_BGR)
    assert board.occupancy(canon)["hole_4"] == "empty"  # wood sits in the skin band by default
    assert board.colour_range is None
    rng = board.sample_peg_colour(canon, SRC)
    assert rng["skin_excluded"] is False
    assert board.occupancy(canon)["hole_4"] == "occupied"
    assert len(board.free_pegs_mm(canon)) == 1
    assert board.colour_range == rng


def test_sample_peg_colour_is_a_12_degree_window_with_floors_and_wraps_red():
    board, canon, _ = _canon_kw([H[4]])  # default peg BGR (40, 40, 220) -> hue 0
    rng = board.sample_peg_colour(canon, H[4])
    assert rng["h"] == 0 and rng["h_lo"] == -6 and rng["h_hi"] == 6  # ±12° in OpenCV's 0-180
    assert rng["s_min"] >= 40 and rng["v_min"] >= 40 and rng["skin_excluded"] is True
    assert board.occupancy(canon)["hole_4"] == "occupied"  # red wraps around 180


def test_hough_centres_refine_occupancy_on_a_misprinted_grid():
    # The printed grid sits 2 mm right of the spec; the peg is seated in the printed hole.
    shifted = replace(NHPT_BOARD, targets_mm=tuple((x + 2.0, y) for x, y in H))
    frame, _ = camera_frame(shifted, pegs_mm=[shifted.targets_mm[4]])
    cal = Calibrator(NHPT_BOARD).run(frame)
    board = BoardState(NHPT_BOARD)
    canon = board.warp(frame, cal)
    holes = board.detect_holes(canon)
    assert board.hole_source == "hough"
    ex, _ = board.mm_to_canonical(H[4])
    assert holes[4].x - ex > 1.0 * board.px_per_mm  # Hough moved the centre off the spec
    # An 8 mm peg fills at most (4/5)^2 = 0.64 of the 10 mm hole disc; the disc on the Hough
    # centre sees nearly all of it, the spec-centred disc (2 mm off) would see far less.
    assert board.hole_scores(canon)[4]["peg_fraction"] > 0.6


def test_template_score_breaks_ties_near_the_fraction_threshold():
    # Templates are captured per hole when the holes are detected (board empty). A peg hovering
    # 5 mm off hole 4 covers ~0.23 of the disc: inside the ±0.1 tie zone of threshold 0.2.
    board, canon0, _ = _canon_kw([])
    board.detect_holes(canon0)
    board.occupied_fraction = 0.2
    _, canon, _ = _canon_kw([(H[4][0] + 5, H[4][1])])
    s = board.hole_scores(canon)[4]
    assert 0.2 <= s["peg_fraction"] <= 0.3 and s["empty_template_score"] > 0.75
    assert board.occupancy(canon)["hole_4"] == "empty"  # template: still looks like an empty hole
    board.template_empty_score = None  # tie-break off: the fraction alone decides
    assert board.occupancy(canon)["hole_4"] == "occupied"
    _, canon2, _ = _canon_kw([H[4]])
    assert board.hole_scores(canon2)[4]["empty_template_score"] < 0.7  # a seated peg


def test_pegs_still_read_from_a_laptop_camera_angle():
    # Laptop camera only (10 Oct): the screen tilted forward looks down at ~45°. Synthetic pegs are
    # flat discs, so this checks the warp and Hough, not 3D peg parallax (report §10).
    frame, _ = camera_frame(NHPT_BOARD, tilt_deg=45, yaw_deg=5, pegs_mm=[H[0], H[4], H[8]], noise_sigma=2.0)
    cal = Calibrator(NHPT_BOARD).run(frame)
    board = BoardState(NHPT_BOARD)
    canon = board.warp(frame, cal)
    assert len(board.detect_holes(canon)) == 9
    assert {k for k, v in board.occupancy(canon).items() if v == "occupied"} == {"hole_0", "hole_4", "hole_8"}
