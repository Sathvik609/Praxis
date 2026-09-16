import numpy as np
import pytest

from praxis_session.perception.board_spec import NHPT_BOARD
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.hand import (
    MODELS_DIR,
    HandMetrics,
    HandResult,
    HandTracker,
    pinch_mm,
    sparc,
    tremor,
)
from praxis_session.perception.synth import camera_frame

HAVE_MODELS = (MODELS_DIR / "palm_detection_mediapipe_2023feb.onnx").exists() and (
    MODELS_DIR / "handpose_estimation_mediapipe_2023feb.onnx"
).exists()


def _min_jerk_velocity(n=200, fs=100.0):
    t = np.linspace(0, 1, n)
    v = 30 * t**2 - 60 * t**3 + 30 * t**4  # minimum-jerk speed profile
    return v, fs


def test_sparc_is_higher_for_smoother_movement():
    v, fs = _min_jerk_velocity()
    rng = np.random.default_rng(0)
    jerky = v + 0.3 * np.sin(2 * np.pi * 10 * np.linspace(0, 1, v.size)) + 0.05 * rng.normal(size=v.size)
    assert sparc(v, fs) > sparc(jerky, fs)
    assert -4 < sparc(v, fs) < 0


def test_tremor_finds_8hz_peak_and_none_when_still():
    fs = 60.0
    t = np.arange(0, 3, 1 / fs)
    trace = np.c_[2.0 * np.sin(2 * np.pi * 8 * t) + 0.1 * t, 0.5 * np.cos(2 * np.pi * 8 * t)]
    hz, ratio = tremor(trace, fs)
    assert hz is not None and abs(hz - 8.0) < 0.6 and ratio > 0.5
    hz2, ratio2 = tremor(np.zeros((180, 2)) + 5.0, fs)
    assert hz2 is None and ratio2 == 0.0


def _fake_hand(x: float, y: float, pinch_px: float = 30.0) -> HandResult:
    lm = np.zeros((21, 2), np.float32) + [x, y]
    lm[4] = [x, y]  # thumb tip
    lm[8] = [x + pinch_px, y]  # index tip
    return HandResult(landmarks_px=lm, z=np.zeros(21, np.float32), conf=0.95, handedness=0.1, bbox=np.array([x - 20, y - 20, x + 40, y + 20], np.float32))


def test_pinch_and_metrics_in_mm_with_calibration():
    frame, _ = camera_frame(NHPT_BOARD)
    cal = Calibrator(NHPT_BOARD).run(frame)
    assert cal.calibrated
    origin = cal.to_px(np.array([[100.0, 150.0]], np.float32))[0]
    res = _fake_hand(float(origin[0]), float(origin[1]), pinch_px=30.0)
    p = pinch_mm(res, cal)
    assert p is not None and 5 < p < 40
    m = HandMetrics(window_s=2.0)
    fs = 20.0
    d = {}
    # move the index tip along +x in mm at 50 mm/s for 2 s
    for i in range(41):
        t = i / fs
        px = cal.to_px(np.array([[100.0 + 50.0 * t, 150.0]], np.float32))[0]
        d = m.update(t, _fake_hand(float(px[0]), float(px[1])), cal)
    assert d["present"] and d["pinch_mm"] is not None
    assert abs(d["path_mm_s"] - 50.0) < 8.0
    assert d["sparc"] is not None and d["tremor_hz"] is None
    d2 = m.update(2.1, None, cal)
    assert d2["present"] is False and d2["pinch_mm"] is None


def test_tracker_unavailable_without_models(tmp_path):
    tr = HandTracker(models_dir=tmp_path)
    assert tr.available is False
    assert tr.detect(np.zeros((480, 640, 3), np.uint8)) is None


@pytest.mark.skipif(not HAVE_MODELS, reason="models not downloaded (tools/fetch_models.py)")
def test_tracker_runs_on_blank_frame_and_synthetic_board():
    tr = HandTracker()
    assert tr.available
    assert tr.detect(np.zeros((480, 640, 3), np.uint8)) is None
    frame, _ = camera_frame(NHPT_BOARD)
    assert tr.detect(frame) is None
    assert tr.last_ms >= 0.0
