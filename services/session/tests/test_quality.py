import numpy as np

from praxis_session.perception.board_spec import NHPT_BOARD
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.quality import (
    MarkerSteadiness,
    Presence,
    build_checks,
    lighting,
    task_area_in_view,
)
from praxis_session.perception.synth import camera_frame


def test_lighting_dark_frame_fails_with_hint():
    d = lighting(np.full((480, 640, 3), 20, np.uint8))
    assert not d["ok"] and "light" in d["hint"].lower()


def test_lighting_sharp_synthetic_frame_ok():
    frame, _ = camera_frame(NHPT_BOARD)
    assert lighting(frame)["ok"]


def test_steadiness_flags_jitter():
    s = MarkerSteadiness(window=5)
    base = {0: np.zeros((4, 2), np.float32)}
    for _ in range(5):
        assert s.update(base)["ok"]
    for k in range(5):
        s.update({0: np.full((4, 2), 6.0 * (k % 2), np.float32)})
    assert not s.update(base)["ok"]


def test_task_area_inside_for_synthetic_and_outside_when_frame_is_cropped():
    frame, _ = camera_frame(NHPT_BOARD)
    cal = Calibrator(NHPT_BOARD).run(frame)
    assert task_area_in_view(cal, NHPT_BOARD, frame.shape)["ok"]
    assert not task_area_in_view(cal, NHPT_BOARD, (200, 200, 3))["ok"]


def test_task_area_needs_calibration():
    cal = Calibrator(NHPT_BOARD).run(np.zeros((480, 640, 3), np.uint8))
    d = task_area_in_view(cal, NHPT_BOARD, (480, 640, 3))
    assert not d["ok"] and d["hint"]


def test_presence_from_motion():
    p = Presence()
    still = np.zeros((480, 640, 3), np.uint8)
    d = None
    for _ in range(31):
        d = p.update(still)
    assert d["present"] is False and d["method"] == "frame_difference"
    rng = np.random.default_rng(0)
    for _ in range(31):
        d = p.update(rng.integers(0, 255, (480, 640, 3), dtype=np.uint8))
    assert d["present"] is True


def test_presence_is_pending_before_window_fills():
    assert Presence().update(np.zeros((480, 640, 3), np.uint8))["present"] is None


def test_build_checks_has_five_rows_in_wireframe_order():
    frame, _ = camera_frame(NHPT_BOARD)
    cal = Calibrator(NHPT_BOARD).run(frame)
    rows = build_checks(
        cal,
        lighting(frame),
        {"ok": True, "jitter_px": 0.1},
        task_area_in_view(cal, NHPT_BOARD, frame.shape),
        {"present": True},
    )
    assert [r["id"] for r in rows] == ["camera", "person", "task_area", "markers", "lighting"]
    assert all(r["status"] == "pass" for r in rows)


def test_build_checks_marks_missing_markers_with_hint():
    cal = Calibrator(NHPT_BOARD).run(np.zeros((480, 640, 3), np.uint8))
    rows = build_checks(cal, {"ok": True, "hint": None}, {"ok": True}, {"ok": False, "hint": "x"}, {"present": None})
    by_id = {r["id"]: r for r in rows}
    assert by_id["markers"]["status"] == "check" and "0, 1, 2, 3" in by_id["markers"]["hint"]
    assert by_id["person"]["status"] == "pending"
