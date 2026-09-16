import numpy as np
import pytest

from praxis_session.perception.board_spec import CUP_TARGETS, NHPT_BOARD
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.synth import camera_frame


@pytest.mark.parametrize("spec", [NHPT_BOARD, CUP_TARGETS])
def test_calibrates_on_synthetic_frame_with_submm_error(spec):
    frame, _ = camera_frame(spec, tilt_deg=20, yaw_deg=8, noise_sigma=3.0)
    res = Calibrator(spec).run(frame)
    assert res.calibrated and res.missing == []
    assert res.rms_mm is not None and res.rms_mm < 1.0
    targets = np.array(spec.targets_mm, np.float32)
    px = res.to_px(targets)
    back = res.to_mm(px)
    assert np.allclose(back, targets, atol=0.5)


def test_synthetic_targets_land_where_the_true_homography_says():
    frame, H_true = camera_frame(NHPT_BOARD, tilt_deg=20, yaw_deg=8)
    res = Calibrator(NHPT_BOARD).run(frame)
    targets = np.array(NHPT_BOARD.targets_mm, np.float32).reshape(-1, 1, 2)
    import cv2

    truth = cv2.perspectiveTransform(targets, H_true.astype(np.float32)).reshape(-1, 2)
    assert np.allclose(res.to_px(targets.reshape(-1, 2)), truth, atol=1.5)


def test_refuses_when_a_marker_is_hidden():
    frame, _ = camera_frame(NHPT_BOARD, hide_marker=2)
    res = Calibrator(NHPT_BOARD).run(frame)
    assert not res.calibrated and res.missing == [2] and res.H_px_to_mm is None


def test_blank_frame_reports_all_missing():
    res = Calibrator(NHPT_BOARD).run(np.zeros((480, 640, 3), np.uint8))
    assert res.missing == [0, 1, 2, 3]
    d = res.to_dict()
    assert d["calibrated"] is False and d["sheet"] == "nhpt_board"
