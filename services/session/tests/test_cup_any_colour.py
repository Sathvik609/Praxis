"""Waiter – cup with an ordinary cup (24 Oct 2026, team test).

The cup was found only by a blue tape ring round its base, and the app never asked for one: the
team's real cup sessions logged no state change at all (shruthi, 1751 frames). The empty sheet
seen at the session's first fix is now kept as a reference, and a cup of any colour (a white mug
included) is what changed on it; its camera-side bottom edge gives the base, as for the band.
"""

import numpy as np
import pytest

from praxis_session.perception.board_spec import CUP_TARGETS
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.cup import CupSheetState
from praxis_session.perception.synth import camera_frame, draw_cup, view_camera

D = CUP_TARGETS.targets_mm
SIZE = (640, 480)
# A white mug's side faces sideways and catches less light than the paper facing up; one exactly
# as bright as the paper shows no change and is a known limit (docs/RISKS.md, 24 Oct).
WHITE = (188, 190, 193)
RED = (45, 40, 190)
GREEN = (60, 150, 60)


def _scene(tilt, colour, xy=None):
    frame, _ = camera_frame(CUP_TARGETS, tilt_deg=tilt, yaw_deg=5.0, focal_per_width=0.85, noise_sigma=2.0, seed=2)
    if xy is not None:
        P = view_camera(CUP_TARGETS, SIZE, tilt, 5.0, 1.0, focal_per_width=0.85)
        draw_cup(frame, P, xy, band_bgr=colour, body_bgr=colour)  # a plain cup: no band
    return frame


def _found(tilt, colour, dot):
    cal, cs = Calibrator(CUP_TARGETS), CupSheetState(CUP_TARGETS)
    empty = _scene(tilt, colour)
    cs.warp(empty, cal.run(empty, 0.0))
    cs.capture_reference()  # the session's first fix: the sheet before the cup goes on it
    frame = _scene(tilt, colour, D[dot])
    return cs.cup_mm(cs.warp(frame, cal.run(frame, 0.1)))


@pytest.mark.parametrize("colour", [WHITE, RED, GREEN], ids=["white", "red", "green"])
@pytest.mark.parametrize("dot", [0, 2, 4])
def test_a_plain_cup_of_any_colour_is_found_on_its_dot(colour, dot):
    cm = _found(40, colour, dot)
    assert cm is not None
    assert float(np.hypot(cm[0] - D[dot][0], cm[1] - D[dot][1])) < 8.0
    assert 40.0 < cm[2] < 80.0  # base diameter 58 mm


def test_without_a_reference_a_plain_cup_is_still_not_guessed():
    cal, cs = Calibrator(CUP_TARGETS), CupSheetState(CUP_TARGETS)
    cal.run(_scene(40, WHITE), 0.0)
    frame = _scene(40, WHITE, D[2])
    assert cs.cup_mm(cs.warp(frame, cal.run(frame, 0.1))) is None


def test_an_empty_sheet_after_the_reference_has_no_cup():
    cal, cs = Calibrator(CUP_TARGETS), CupSheetState(CUP_TARGETS)
    empty = _scene(40, WHITE)
    cs.warp(empty, cal.run(empty, 0.0))
    cs.capture_reference()
    again = camera_frame(CUP_TARGETS, tilt_deg=40, yaw_deg=5.0, focal_per_width=0.85, noise_sigma=2.0, seed=7)[0]
    assert cs.cup_mm(cs.warp(again, cal.run(again, 0.1))) is None
