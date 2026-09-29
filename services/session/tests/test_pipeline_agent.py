"""Pipeline support for the agent's OpenCV tools (29 Sep): the latest frame is kept by
reference only (overwritten each frame), `check_setup` runs the quality checks and a fresh
ArUco detection on it on demand, `recalibrate` resets the calibrator / pose gate, and
`set_target` / `set_reps` are clamped to the prescription like `set_hold`."""
import numpy as np

from praxis_session.perception.board_spec import CUP_TARGETS
from praxis_session.perception.synth import camera_frame
from praxis_session.pipeline import SessionPipeline


def cup():
    return SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)


def arm(**kw):
    return SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="abduction", **kw)


def test_latest_frame_is_a_reference_overwritten_each_frame():
    p = cup()
    assert p.latest_frame is None
    f1, _ = camera_frame(CUP_TARGETS)
    f2, _ = camera_frame(CUP_TARGETS, hide_marker=1)
    p.process(f1, 0.0, 0)
    assert p.latest_frame is f1
    p.process(f2, 0.1, 1)
    assert p.latest_frame is f2  # the previous frame is no longer held


def test_check_setup_without_a_frame_says_so():
    r = cup().check_setup()
    assert r["ok"] is False and "no camera frame" in r["error"]


def test_check_setup_names_the_covered_marker_and_passes_when_clear():
    p = cup()
    f, _ = camera_frame(CUP_TARGETS, hide_marker=2)
    p.process(f, 0.0, 0)
    r = p.check_setup()
    assert r["ok"] is True and "markers" in r["failing"] and r["all_pass"] is False
    markers = next(c for c in r["checks"] if c["id"] == "markers")
    assert markers["status"] == "check" and "2" in markers["hint"]
    assert r["measures"]["markers_missing"] == [2]
    clean, _ = camera_frame(CUP_TARGETS)
    p.process(clean, 0.1, 1)
    r = p.check_setup()
    assert r["all_pass"] is True and r["failing"] == []
    assert r["measures"]["markers_found"] == [0, 1, 2, 3] and r["measures"]["rms_mm"] is not None
    assert {"markers", "angle", "task_area", "lighting"} <= {c["id"] for c in r["checks"]}


def test_check_setup_flags_a_dark_frame():
    p = cup()
    f, _ = camera_frame(CUP_TARGETS)
    p.process((f * 0.15).astype(np.uint8), 0.0, 0)
    r = p.check_setup()
    assert "lighting" in r["failing"]
    light = next(c for c in r["checks"] if c["id"] == "lighting")
    assert "dark" in light["hint"].lower()


def test_recalibrate_resets_the_calibrator_on_the_next_frame():
    p = cup()
    f, _ = camera_frame(CUP_TARGETS)
    p.process(f, 0.0, 0)
    assert p.last_calibration["calibrated"] is True
    r = p.command({"cmd": "recalibrate"})
    assert r["ok"] is True and r["reset"] == "calibrator"
    assert p.frames_since_recalibrate == 0
    hidden, _ = camera_frame(CUP_TARGETS, hide_marker=0)
    p.process(hidden, 0.1, 1)  # fresh calibrator: three markers are not enough for a first fix
    assert p.last_calibration["calibrated"] is False and p.last_calibration["missing"] == [0]
    assert p.frames_since_recalibrate == 1


def test_recalibrate_on_arm_resets_the_pose_gate():
    p = arm()
    p.process(np.zeros((480, 640, 3), np.uint8), 0.0, 0)
    r = p.command({"cmd": "recalibrate"})
    assert r["ok"] is True and r["reset"] == "pose_gate"
    p.process(np.zeros((480, 640, 3), np.uint8), 0.1, 1)
    assert p.frames_since_recalibrate == 1
    s = p.check_setup()
    assert s["ok"] is True and "person" in s["failing"]


def test_set_target_is_clamped_to_the_allowed_adaptation_and_ceiling():
    p = arm()
    r = p.command({"cmd": "set_target", "target_deg": 75})
    assert r == {"ok": True, "exercise": "abduction", "rx": "abduction", "target_deg": 75.0, "requested_target_deg": 75.0, "clamped": False}
    assert p.snapshot()["arm"]["target_deg"] == 75.0
    assert p.command({"cmd": "set_target", "target_deg": 40})["target_deg"] == 60.0
    r = p.command({"cmd": "set_target", "target_deg": 120})
    assert r["target_deg"] == 90.0 and r["clamped"] is True
    assert p.command({"cmd": "set_target"})["ok"] is False
    assert cup().command({"cmd": "set_target", "target_deg": 70})["ok"] is False


def test_set_reps_is_clamped_to_the_allowed_adaptation():
    p = arm()
    r = p.command({"cmd": "set_reps", "reps": 6})
    assert r["ok"] is True and r["reps"] == 6 and p.snapshot()["arm"]["reps_per_set"] == 6
    assert p.command({"cmd": "set_reps", "reps": 20})["reps"] == 8
    assert p.command({"cmd": "set_reps", "reps": "x"})["ok"] is False
