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


def test_build_checks_has_the_wireframe_rows_plus_angle_in_order():
    frame, _ = camera_frame(NHPT_BOARD)
    cal = Calibrator(NHPT_BOARD).run(frame)
    rows = build_checks(
        cal,
        lighting(frame),
        {"ok": True, "jitter_px": 0.1},
        task_area_in_view(cal, NHPT_BOARD, frame.shape),
        {"present": True},
    )
    assert [r["id"] for r in rows] == [
        "camera",
        "person",
        "task_area",
        "markers",
        "angle",
        "lighting",
    ]
    assert all(r["status"] == "pass" for r in rows)


def test_camera_angle_gate_from_calibration_tilt():
    from praxis_session.perception.quality import camera_angle

    # Laptop camera only (10 Oct): a screen tilted forward looks down at ~40–50°; flatter than
    # 50° the seated pegs start to hide the next hole.
    laptop, _ = camera_frame(NHPT_BOARD, tilt_deg=45, yaw_deg=5)
    assert camera_angle(Calibrator(NHPT_BOARD).run(laptop))["ok"] is True
    frame, _ = camera_frame(NHPT_BOARD, tilt_deg=58, yaw_deg=5)
    steep = camera_angle(Calibrator(NHPT_BOARD).run(frame))
    assert steep["ok"] is False and steep["tilt_deg"] > 50 and "laptop screen forward" in steep["hint"]
    flat = camera_angle(Calibrator(NHPT_BOARD).run(camera_frame(NHPT_BOARD, tilt_deg=10)[0]))
    assert flat["ok"] is True and flat["hint"] is None
    none = camera_angle(Calibrator(NHPT_BOARD).run(np.zeros((480, 640, 3), np.uint8)))
    assert none["ok"] is None and none["tilt_deg"] is None


def test_build_checks_marks_missing_markers_with_hint():
    cal = Calibrator(NHPT_BOARD).run(np.zeros((480, 640, 3), np.uint8))
    rows = build_checks(
        cal, {"ok": True, "hint": None}, {"ok": True}, {"ok": False, "hint": "x"}, {"present": None}
    )
    by_id = {r["id"]: r for r in rows}
    assert by_id["markers"]["status"] == "check" and "0, 1, 2, 3" in by_id["markers"]["hint"]
    assert by_id["person"]["status"] == "pending"


def test_missing_marker_hint_names_the_corner_of_the_sheet():
    # The patient cannot see marker ids; the hint says which corner to clear (sheet as printed).
    from praxis_session.perception.board_spec import CUP_TARGETS

    frame, _ = camera_frame(CUP_TARGETS, hide_marker=2)
    cal = Calibrator(CUP_TARGETS).run(frame)
    rows = build_checks(cal, lighting(frame), {"ok": True}, task_area_in_view(cal, CUP_TARGETS, frame.shape), {"present": True}, spec=CUP_TARGETS)
    hint = {r["id"]: r for r in rows}["markers"]["hint"]
    assert "bottom-right corner" in hint and "2" in hint


def test_missing_marker_hint_lists_every_hidden_corner():
    cal = Calibrator(NHPT_BOARD).run(np.zeros((480, 640, 3), np.uint8))
    rows = build_checks(cal, {"ok": True, "hint": None}, {"ok": True}, {"ok": False, "hint": "x"}, {"present": None}, spec=NHPT_BOARD)
    hint = {r["id"]: r for r in rows}["markers"]["hint"]
    for corner in ("top-left", "top-right", "bottom-right", "bottom-left"):
        assert corner in hint


def test_task_area_refuses_a_sheet_too_far_away():
    # A sheet that calibrates but is tiny in the frame leaves pegs under ~6 px: ask to come closer.
    from praxis_session.perception.board_spec import CUP_TARGETS

    for spec in (NHPT_BOARD, CUP_TARGETS):
        far, _ = camera_frame(spec, scale=0.35)
        cal = Calibrator(spec).run(far)
        assert cal.calibrated
        d = task_area_in_view(cal, spec, far.shape)
        assert d["ok"] is False and "closer" in d["hint"] and d["px_per_mm"] < 0.75
        near, _ = camera_frame(spec)
        ok = task_area_in_view(Calibrator(spec).run(near), spec, near.shape)
        assert ok["ok"] is True and ok["px_per_mm"] >= 0.75


def test_blur_threshold_passes_a_real_webcam_and_catches_real_blur():
    # A focused 640x480 Mac webcam on a plain wall measured ~33 (10 Oct); heavy blur is < 10.
    import cv2

    f, _ = camera_frame(NHPT_BOARD, noise_sigma=2.0)
    assert lighting(cv2.GaussianBlur(f, (0, 0), 1.5))["ok"] is True  # ~22: mild softness passes
    blurry = lighting(cv2.GaussianBlur(f, (0, 0), 2.5))  # ~5
    assert blurry["ok"] is False and "blurry" in blurry["hint"]
