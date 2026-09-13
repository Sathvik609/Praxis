from __future__ import annotations

import cv2
import numpy as np

from praxis_session.perception.board_spec import BOARD
from praxis_session.perception.calibration import Calibrator
from tests.synth import perspective_from_mm, project_mm, render_frame


def test_all_four_markers_yield_calibration_with_mm_accuracy() -> None:
    H = perspective_from_mm()
    frame = render_frame(H)
    cal = Calibrator().calibrate(frame)
    assert cal.calibrated is True
    assert sorted(cal.marker_ids) == [0, 1, 2, 3]
    assert cal.missing_ids == []
    # px -> mm on the hole centres must land within 1.5 mm of the truth.
    holes_px = project_mm(H, BOARD.hole_centers_mm)
    holes_mm = cal.px_to_mm(holes_px)
    err = np.linalg.norm(holes_mm - np.array(BOARD.hole_centers_mm), axis=1)
    assert err.max() < 1.5, err
    assert cal.reprojection_error_mm < 1.0


def test_mm_to_px_is_inverse_of_px_to_mm() -> None:
    frame = render_frame(perspective_from_mm())
    cal = Calibrator().calibrate(frame)
    pts = np.array([[100.0, 100.0], [320.0, 240.0]], dtype=np.float32)
    back = cal.mm_to_px(cal.px_to_mm(pts))
    assert np.allclose(back, pts, atol=0.05)


def test_refuses_when_a_marker_is_occluded() -> None:
    H = perspective_from_mm()
    frame = render_frame(H)
    # Cover marker 2 with a grey square.
    c = project_mm(H, [BOARD.marker_centers_mm[2]])[0]
    cv2.rectangle(frame, (int(c[0]) - 60, int(c[1]) - 60), (int(c[0]) + 60, int(c[1]) + 60), (110, 110, 110), -1)
    cal = Calibrator().calibrate(frame)
    assert cal.calibrated is False
    assert cal.missing_ids == [2]
    assert sorted(cal.marker_ids) == [0, 1, 3]


def test_blank_frame_is_not_calibrated() -> None:
    frame = np.full((480, 640, 3), 110, dtype=np.uint8)
    cal = Calibrator().calibrate(frame)
    assert cal.calibrated is False
    assert cal.missing_ids == [0, 1, 2, 3]
    assert cal.homography is None


def test_calibration_event_payload_is_json_ready() -> None:
    frame = render_frame(perspective_from_mm())
    cal = Calibrator().calibrate(frame)
    d = cal.to_event_payload()
    assert d["calibrated"] is True
    assert d["marker_ids"] == [0, 1, 2, 3]
    assert isinstance(d["reprojection_error_mm"], float)
    assert isinstance(d["homography_px_to_mm"], list) and len(d["homography_px_to_mm"]) == 3
