"""Waiter – cup with a real (3-D) cup seen from a laptop camera (12 Oct 2026, found by the 3-D
renders in evaluation/blender).

The blue tape ring round the cup's bottom is a vertical band, not a disc on the paper. From a
camera 25-50° off vertical only its camera-facing half shows, and in the sheet-plane view it is a
thin crescent whose area is well under the 30 mm disc gate, so the cup was never found (0 of 32
reaches on the first render). The crescent's camera-side edge is the bottom edge of the cup,
which lies ON the paper, so a circle fitted to that edge gives the true base centre and radius.
synth.draw_cup paints the cup through the true camera matrix.
"""

import cv2
import numpy as np
import pytest

from praxis_session.perception.board_spec import CUP_TARGETS
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.cup import CupSheetState
from praxis_session.perception.synth import camera_frame

D = CUP_TARGETS.targets_mm


def _cup(tilt, dot=None, lift=0.0, yaw=5.0, xy=None, fpw=0.85):
    cal = Calibrator(CUP_TARGETS)
    empty, _ = camera_frame(CUP_TARGETS, tilt_deg=tilt, yaw_deg=yaw, focal_per_width=fpw, noise_sigma=2.0, seed=1)
    cal.run(empty, 0.0)  # the session's first fix, before the cup hides a corner
    pos = xy if xy is not None else D[dot]
    frame, _ = camera_frame(CUP_TARGETS, tilt_deg=tilt, yaw_deg=yaw, focal_per_width=fpw, noise_sigma=2.0, seed=2,
                            cup_3d=(pos[0], pos[1], lift))
    c = cal.run(frame, 0.1)
    assert c.calibrated
    cs = CupSheetState(CUP_TARGETS)
    return cs.cup_mm(cs.warp(frame, c))


@pytest.mark.parametrize("tilt", [25, 40, 50])
@pytest.mark.parametrize("dot", [0, 2, 4])
def test_a_3d_cup_on_a_dot_is_found_at_its_base_centre(tilt, dot):
    cm = _cup(tilt, dot)
    assert cm is not None
    assert float(np.hypot(cm[0] - D[dot][0], cm[1] - D[dot][1])) < 6.0
    assert 45.0 < cm[2] < 75.0  # base diameter 58 mm


def test_a_partly_hidden_band_keeps_the_learned_cup_radius():
    # The cup does not change size within a session: after a few tight fits the base radius is
    # known, and a frame where fingers hide part of the band is fitted for its centre only
    # (render cup3d_02: the free fit flipped between r 16 and 28 mm and the cup never settled).
    cal = Calibrator(CUP_TARGETS)
    empty, _ = camera_frame(CUP_TARGETS, tilt_deg=45, yaw_deg=-8, focal_per_width=0.8, noise_sigma=3.0, seed=1)
    cal.run(empty, 0.0)
    cs = CupSheetState(CUP_TARGETS)
    d = D[2]
    for k in range(6):  # the cup resting on dot 3, fully visible
        f, _ = camera_frame(CUP_TARGETS, tilt_deg=45, yaw_deg=-8, focal_per_width=0.8, noise_sigma=3.0, seed=10 + k, cup_3d=(d[0], d[1], 0.0))
        assert cs.cup_mm(cs.warp(f, cal.run(f, 0.1 * (k + 1)))) is not None
    f, _ = camera_frame(CUP_TARGETS, tilt_deg=45, yaw_deg=-8, focal_per_width=0.8, noise_sigma=3.0, seed=30, cup_3d=(d[0], d[1], 0.0))
    c = cal.run(f, 1.0)
    canon = cs.warp(f, c)
    # fingers over the left two thirds of the band (drawn in the sheet-plane view)
    x0 = int((d[0] - 40) * cs.px_per_mm)
    cv2.rectangle(canon, (x0, int((d[1] - 45) * cs.px_per_mm)), (int((d[0] + 2) * cs.px_per_mm), int((d[1] + 10) * cs.px_per_mm)), (150, 170, 210), -1)
    cm = cs.cup_mm(canon)
    assert cm is not None
    assert float(np.hypot(cm[0] - d[0], cm[1] - d[1])) < 5.0
    assert abs(cm[2] - 58.0) < 6.0


def test_a_lifted_3d_cup_has_left_its_dot():
    cm = _cup(40, 2, lift=40.0)
    assert cm is None or float(np.hypot(cm[0] - D[2][0], cm[1] - D[2][1])) > 20.0


def test_a_blue_pen_is_still_not_a_cup():
    frame, _ = camera_frame(CUP_TARGETS, tilt_deg=40, yaw_deg=5, focal_per_width=0.85, noise_sigma=2.0)
    c = Calibrator(CUP_TARGETS).run(frame, 0.0)
    cs = CupSheetState(CUP_TARGETS)
    canon = cs.warp(frame, c)
    # a pen (140 x 7 mm) and a short, slightly curved blue strip, drawn on the canonical view
    cv2.rectangle(canon, (int(60 * 2), int(150 * 2)), (int(200 * 2), int(157 * 2)), (200, 90, 30), -1)
    assert cs.cup_mm(canon) is None
