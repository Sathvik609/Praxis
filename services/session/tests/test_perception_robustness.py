"""Robustness fixes found by evaluation/scripts/robustness.py (11 Oct 2026), on synthetic renders.

Each test pins one failure the sweep exposed and its negative twin (no phantom pegs / cup).
"""

import math

import cv2
import numpy as np
import pytest

from praxis_session.perception.board import BoardState
from praxis_session.perception.board_spec import CUP_TARGETS, NHPT_BOARD
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.cup import CupSheetState
from praxis_session.perception.synth import camera_frame

H = NHPT_BOARD.targets_mm
DOT = CUP_TARGETS.targets_mm[2]
WARM = np.array([0.55, 0.85, 1.15], np.float32)  # tungsten cast (B, G, R gains)
DEEP_SKIN = (35, 45, 75)  # BGR, a deep skin tone (V < 80)


def _jpeg(img: np.ndarray, q: int = 70) -> np.ndarray:
    return cv2.imdecode(cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])[1], cv2.IMREAD_COLOR)


def _photo(frame: np.ndarray, gain=1.0, cast=None, noise=3.0, seed=0) -> np.ndarray:
    f = frame.astype(np.float32) * gain
    if cast is not None:
        f = f * cast
    f = f + np.random.default_rng(seed).normal(0, noise, f.shape)
    return _jpeg(np.clip(f, 0, 255).astype(np.uint8))


def _board(frame_empty, frame):
    cal_e = Calibrator(NHPT_BOARD).run(frame_empty, 0.0)
    cal = Calibrator(NHPT_BOARD).run(frame, 0.0)
    assert cal_e.calibrated and cal.calibrated
    board = BoardState(NHPT_BOARD)
    board.detect_holes(board.warp(frame_empty, cal_e))
    return board, board.warp(frame, cal)


def _occupied(board, canon) -> set[int]:
    return {int(k.split("_")[1]) for k, v in board.occupancy(canon).items() if v == "occupied"}


# ---- light: paper-referenced normalisation before HSV -----------------------------------------
@pytest.mark.parametrize("gain", [0.16, 0.25])  # mean luma ~30 and ~45: a dim room
def test_pegs_read_in_a_dim_room(gain):
    pegs = [H[0], H[4], H[8], (160.0, 192.0)]
    e, _ = camera_frame(NHPT_BOARD, tilt_deg=40)
    f, _ = camera_frame(NHPT_BOARD, tilt_deg=40, pegs_mm=pegs)
    board, canon = _board(_photo(e, gain, seed=1), _photo(f, gain, seed=2))
    assert _occupied(board, canon) == {0, 4, 8}
    free = board.free_pegs_mm(canon)
    assert len(free) == 1 and math.dist(free[0], (160.0, 192.0)) < 4.0


def test_warm_light_paper_is_not_a_field_of_pegs():
    e, _ = camera_frame(NHPT_BOARD, tilt_deg=40)
    board, canon = _board(_photo(e, cast=WARM, noise=6, seed=1), _photo(e, cast=WARM, noise=6, seed=2))
    assert _occupied(board, canon) == set()
    assert board.free_pegs_mm(canon) == []


def test_warm_dim_light_reads_pegs_without_phantoms():
    e, _ = camera_frame(NHPT_BOARD, tilt_deg=40)
    f, _ = camera_frame(NHPT_BOARD, tilt_deg=40, pegs_mm=[H[2], H[6]])
    board, canon = _board(_photo(e, 0.22, WARM, 8, 1), _photo(f, 0.22, WARM, 8, 2))
    assert _occupied(board, canon) == {2, 6}
    assert board.free_pegs_mm(canon) == []


def test_hard_shadow_across_the_grid_does_not_hide_pegs():
    e, _ = camera_frame(NHPT_BOARD, tilt_deg=40)
    f, Hm = camera_frame(NHPT_BOARD, tilt_deg=40, pegs_mm=[H[0], H[4], H[8]])

    def shade(img):
        out = img.astype(np.float32)
        out[:, img.shape[1] // 2 :] *= 0.3  # a lamp's hard shadow over the right half
        return out.astype(np.uint8)

    board, canon = _board(_photo(shade(e), seed=1), _photo(shade(f), seed=2))
    assert _occupied(board, canon) == {0, 4, 8}


@pytest.mark.parametrize("gain,cast", [(0.16, None), (0.25, WARM), (1.0, WARM)])
def test_cup_base_found_in_dim_or_warm_light(gain, cast):
    f, _ = camera_frame(CUP_TARGETS, tilt_deg=40, cup_mm=DOT)
    f = _photo(f, gain, cast, seed=3)
    cal = Calibrator(CUP_TARGETS).run(f, 0.0)
    sheet = CupSheetState(CUP_TARGETS)
    got = sheet.cup_mm(sheet.warp(f, cal))
    assert got is not None and math.dist(got[:2], DOT) < 3.0


@pytest.mark.parametrize("gain,cast", [(0.16, None), (0.25, WARM), (1.0, WARM)])
def test_no_phantom_cup_in_dim_or_warm_light(gain, cast):
    f, _ = camera_frame(CUP_TARGETS, tilt_deg=40)
    f = _photo(f, gain, cast, noise=8, seed=4)
    cal = Calibrator(CUP_TARGETS).run(f, 0.0)
    sheet = CupSheetState(CUP_TARGETS)
    assert sheet.cup_mm(sheet.warp(f, cal)) is None


# ---- skin: every tone is excluded, not just light ones -----------------------------------------
def test_deep_skin_hand_over_the_grid_is_not_a_peg():
    hand = [(120.0, 140.0, 30.0), (95.0, 120.0, 9.0), (105.0, 110.0, 9.0), (118.0, 106.0, 9.0)]
    e, _ = camera_frame(NHPT_BOARD, tilt_deg=40)
    f, _ = camera_frame(NHPT_BOARD, tilt_deg=40, pegs_mm=[H[0]], skin_blobs_mm=hand, skin_bgr=DEEP_SKIN)
    board, canon = _board(_photo(e, seed=1), _photo(f, seed=2))
    assert _occupied(board, canon) == {0}
    assert board.free_pegs_mm(canon) == []


# ---- shape: a pen is neither a peg nor a cup --------------------------------------------------
def _pen(frame, Hm, a_mm, b_mm, bgr, width_mm=9.0):
    pa = cv2.perspectiveTransform(np.array([[a_mm]], np.float32), Hm)[0, 0]
    pb = cv2.perspectiveTransform(np.array([[b_mm]], np.float32), Hm)[0, 0]
    ppm = float(np.linalg.norm(pb - pa)) / math.dist(a_mm, b_mm)
    out = frame.copy()
    cv2.line(out, tuple(np.round(pa).astype(int)), tuple(np.round(pb).astype(int)), bgr, max(2, round(width_mm * ppm)), cv2.LINE_AA)
    return out


def test_a_pen_on_the_board_is_not_a_free_peg():
    e, _ = camera_frame(NHPT_BOARD, tilt_deg=40)
    f, Hm = camera_frame(NHPT_BOARD, tilt_deg=40, pegs_mm=[(160.0, 192.0)])
    f = _pen(f, Hm, (60.0, 92.0), (150.0, 94.0), (200, 80, 30))
    board, canon = _board(_photo(e, seed=1), _photo(f, seed=2))
    free = board.free_pegs_mm(canon)
    assert len(free) == 1 and math.dist(free[0], (160.0, 192.0)) < 4.0


def test_a_peg_lying_on_its_side_is_still_a_free_peg():
    e, Hm = camera_frame(NHPT_BOARD, tilt_deg=40)
    f = _pen(e, Hm, (150.0, 195.0), (175.0, 195.0), (40, 40, 220), width_mm=7.0)  # 32 mm peg
    board, canon = _board(_photo(e, seed=1), _photo(f, seed=2))
    assert len(board.free_pegs_mm(canon)) == 1


def test_a_blue_pen_on_the_sheet_is_not_the_cup():
    f, Hm = camera_frame(CUP_TARGETS, tilt_deg=40)
    f = _photo(_pen(f, Hm, (90.0, 175.0), (210.0, 180.0), (200, 80, 30)), seed=5)
    cal = Calibrator(CUP_TARGETS).run(f, 0.0)
    sheet = CupSheetState(CUP_TARGETS)
    assert sheet.cup_mm(sheet.warp(f, cal)) is None


def test_the_cup_is_found_next_to_a_blue_pen():
    f, Hm = camera_frame(CUP_TARGETS, tilt_deg=40, cup_mm=DOT)
    f = _photo(_pen(f, Hm, (90.0, 175.0), (230.0, 180.0), (200, 80, 30), width_mm=12.0), seed=5)
    cal = Calibrator(CUP_TARGETS).run(f, 0.0)
    sheet = CupSheetState(CUP_TARGETS)
    got = sheet.cup_mm(sheet.warp(f, cal))
    assert got is not None and math.dist(got[:2], DOT) < 3.0


# ---- occlusion: fingers splitting the base band ------------------------------------------------
def _fingers(n, width_mm, spacing_mm, x0_mm, angle_deg=80.0):
    a = math.radians(angle_deg)
    out = []
    for k in range(n):
        cx = x0_mm + k * spacing_mm
        for s in np.linspace(-45, 45, 19):
            out.append((cx + s * math.cos(a), DOT[1] + s * math.sin(a), width_mm / 2))
    return out


def test_cup_base_split_by_two_fingers_is_still_found():
    # ~55 % of the base visible, in three pieces none of which is cup-sized on its own
    f, _ = camera_frame(CUP_TARGETS, tilt_deg=40, cup_mm=DOT, skin_blobs_mm=_fingers(2, 12, 22, 138))
    f = _photo(f, seed=6)
    cal = Calibrator(CUP_TARGETS).run(f, 0.0)
    sheet = CupSheetState(CUP_TARGETS)
    got = sheet.cup_mm(sheet.warp(f, cal))
    assert got is not None and math.dist(got[:2], DOT) < 8.0


def test_small_blue_stickers_are_not_a_cup_even_together():
    f, Hm = camera_frame(CUP_TARGETS, tilt_deg=40)
    for x in (120.0, 150.0, 230.0):  # three 16 mm blue stickers, two of them 30 mm apart
        p = cv2.perspectiveTransform(np.array([[[x, 160.0]]], np.float32), Hm)[0, 0]
        cv2.circle(f, tuple(int(v) for v in np.round(p)), 11, (200, 90, 30), -1, cv2.LINE_AA)
    f = _photo(f, seed=7)
    cal = Calibrator(CUP_TARGETS).run(f, 0.0)
    sheet = CupSheetState(CUP_TARGETS)
    assert sheet.cup_mm(sheet.warp(f, cal)) is None
