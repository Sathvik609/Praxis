import numpy as np
import pytest

from praxis_session.perception.pose import (
    HIP,
    ELBOW,
    MODELS_DIR,
    POSE_MODEL,
    SHOULDER,
    WRIST,
    OneEuro,
    PoseTracker,
    arm_angles,
)


def figure(
    arm_deg: float = 0.0,
    lean_deg: float = 0.0,
    hike: float = 0.0,
    side: str = "left",
    frontal: bool = False,
):
    """33x2 landmarks (px, y down) for a side-view figure: torso 200 px, upper arm 120 px, forearm 100 px.
    arm_deg = 0 arm hanging down, 90 = horizontal forward (+x). lean_deg tilts the trunk (shoulders back, -x).
    hike lifts the practising shoulder by hike * torso length."""
    lm = np.zeros((33, 2), np.float32)
    hip_mid = np.array([320.0, 400.0])
    lean = np.radians(lean_deg)
    sh_mid = hip_mid + 200.0 * np.array([-np.sin(lean), -np.cos(lean)])
    sep = 160.0 if frontal else 20.0  # frontal: shoulders ~0.8 torso lengths apart
    li, ri = (0, 1) if side == "left" else (1, 0)
    lm[SHOULDER[li]] = sh_mid + [0, -hike * 200.0]
    lm[SHOULDER[ri]] = sh_mid + [sep, 0]
    lm[HIP[li]] = hip_mid
    lm[HIP[ri]] = hip_mid + [sep, 0]
    a = np.radians(arm_deg)
    # upper arm direction rotated from "down" (0,1) toward "forward" (+x)
    up = lm[SHOULDER[li]] + 120.0 * np.array([np.sin(a), np.cos(a)])
    lm[ELBOW[li]] = up
    lm[WRIST[li]] = up + 100.0 * np.array([np.sin(a), np.cos(a)])
    lm[ELBOW[ri]] = lm[SHOULDER[ri]] + [0, 120]
    lm[WRIST[ri]] = lm[ELBOW[ri]] + [0, 100]
    return lm


def _res(lm):
    from praxis_session.perception.pose import PoseResult

    return PoseResult(
        landmarks_px=lm,
        visibility=np.ones(33, np.float32),
        world=np.zeros((33, 3), np.float32),
        conf=0.9,
    )


def test_arm_down_is_zero_and_forward_is_ninety():
    a0 = arm_angles(_res(figure(0)), "left")
    a90 = arm_angles(_res(figure(90)), "left")
    assert abs(a0["shoulder_deg"]) < 2 and abs(a90["shoulder_deg"] - 90) < 2
    assert abs(a90["elbow_deg"] - 180) < 2
    assert a0["view_ok"] and not arm_angles(_res(figure(0, frontal=True)), "left")["view_ok"]


def test_trunk_lean_and_shoulder_hike():
    assert abs(arm_angles(_res(figure(30, lean_deg=10)), "left")["trunk_lean_deg"] - 10) < 1.0
    assert abs(arm_angles(_res(figure(30)), "left")["trunk_lean_deg"]) < 0.5
    assert abs(arm_angles(_res(figure(30, hike=0.1)), "left")["shoulder_hike_norm"] - 0.1) < 0.02
    assert abs(arm_angles(_res(figure(30)), "left")["shoulder_hike_norm"]) < 0.01


def test_right_side_mirrors_left():
    assert abs(arm_angles(_res(figure(60, side="right")), "right")["shoulder_deg"] - 60) < 2


def test_one_euro_smooths_without_overshoot():
    f = OneEuro(min_cutoff=1.0, beta=0.0)
    ys = [f.filter(i / 30.0, 0.0 if i < 10 else 10.0) for i in range(60)]
    assert ys[10] < 10.0 and max(ys) <= 10.0 + 1e-6 and ys[-1] > 9.0


def test_tracker_unavailable_without_models(tmp_path):
    tr = PoseTracker(models_dir=tmp_path)
    assert not tr.available and tr.detect(np.zeros((480, 640, 3), np.uint8)) is None


@pytest.mark.skipif(not (MODELS_DIR / POSE_MODEL).exists(), reason="models not downloaded")
def test_tracker_runs_on_blank_frame():
    tr = PoseTracker()
    assert tr.available
    assert tr.detect(np.zeros((480, 640, 3), np.uint8)) is None
