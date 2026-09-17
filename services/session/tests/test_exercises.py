"""E-SVC-2: the shoulder exercise registry and its camera-relative metrics.

Synthetic landmark figures only (never a live camera). The figures are the same 33-point
BlazePose layout the tracker returns; `tests/test_pose.py::figure` builds the side view.
"""

import numpy as np
import pytest

from praxis_session.perception.exercises import EXERCISES, GENTLE_IDS, ORDER, get, resolve
from praxis_session.perception.pose import (
    ELBOW,
    HIP,
    SHOULDER,
    WRIST,
    PoseResult,
    pendulum_swing_deg,
    rotation_deg,
    shoulder_elevation_deg,
)
from tests.test_pose import figure


def _res(lm):
    return PoseResult(
        landmarks_px=lm,
        visibility=np.ones(33, np.float32),
        world=np.zeros((33, 3), np.float32),
        conf=0.9,
    )


def front_figure(lateral: float = 0.0, side: str = "left"):
    """Front view, elbow tucked at the waist and bent 90° so the forearm points at the camera.

    `lateral` is the wrist's sideways offset from the elbow in px: positive = away from the
    body (external rotation), negative = across the body (internal). Upper arm is 120 px, so
    lateral = 120 is a 90° rotation in the image plane.
    """
    lm = np.zeros((33, 2), np.float32)
    hip_mid = np.array([320.0, 400.0])
    sh_mid = hip_mid + [0.0, -200.0]
    sep = 160.0  # front view: shoulders 0.8 torso lengths apart
    li, ri = (0, 1) if side == "left" else (1, 0)
    out = -1.0 if side == "left" else 1.0  # away from the other shoulder, in +/- x
    lm[SHOULDER[li]], lm[SHOULDER[ri]] = sh_mid, sh_mid + [-out * sep, 0.0]
    lm[HIP[li]], lm[HIP[ri]] = hip_mid, hip_mid + [-out * sep, 0.0]
    lm[ELBOW[li]] = lm[SHOULDER[li]] + [0.0, 120.0]
    lm[WRIST[li]] = lm[ELBOW[li]] + [out * lateral, 0.0]
    lm[ELBOW[ri]] = lm[SHOULDER[ri]] + [0.0, 120.0]
    lm[WRIST[ri]] = lm[ELBOW[ri]] + [0.0, 100.0]
    return lm


def swing_figure(deg: float, side: str = "left"):
    """Side view, arm hanging: the wrist swings `deg` forward (+) or back (-) of vertical."""
    lm = figure(0.0, side=side)
    i = 0 if side == "left" else 1
    sh = lm[SHOULDER[i]]
    a = np.radians(deg)
    lm[ELBOW[i]] = sh + 120.0 * np.array([np.sin(a), np.cos(a)])
    lm[WRIST[i]] = sh + 220.0 * np.array([np.sin(a), np.cos(a)])
    return lm


# ---- metrics ---------------------------------------------------------------------------
def test_flexion_ninety_in_the_side_view():
    assert abs(shoulder_elevation_deg(_res(figure(90)), "left") - 90) < 2
    assert abs(shoulder_elevation_deg(_res(figure(0)), "left")) < 2


def test_abduction_ninety_in_the_front_view():
    assert abs(shoulder_elevation_deg(_res(figure(90, frontal=True)), "left") - 90) < 2
    assert abs(shoulder_elevation_deg(_res(figure(45, frontal=True)), "left") - 45) < 2


def test_external_rotation_is_positive_and_internal_negative():
    assert abs(rotation_deg(_res(front_figure(0.0)), "left")) < 2
    assert rotation_deg(_res(front_figure(60.0)), "left") > 25
    assert abs(rotation_deg(_res(front_figure(120.0)), "left") - 90) < 2
    assert rotation_deg(_res(front_figure(-60.0)), "left") < -25
    # mirrored on the right side
    assert abs(rotation_deg(_res(front_figure(120.0, side="right")), "right") - 90) < 2


def test_pendulum_swing_is_signed_and_zero_at_rest():
    assert abs(pendulum_swing_deg(_res(swing_figure(0.0)), "left")) < 1
    assert abs(pendulum_swing_deg(_res(swing_figure(20.0)), "left") - 20) < 2
    assert abs(pendulum_swing_deg(_res(swing_figure(-20.0)), "left") + 20) < 2
    # an arm lifted above the shoulder is not a pendulum swing
    assert pendulum_swing_deg(_res(figure(120)), "left") == 0.0


# ---- registry --------------------------------------------------------------------------
def test_registry_holds_the_seven_shoulder_exercises():
    assert set(EXERCISES) == {
        "pendulum",
        "flexion",
        "abduction",
        "scaption",
        "extension",
        "external_rotation",
        "internal_rotation",
    }
    assert ORDER[0] == "pendulum" and set(ORDER) == set(EXERCISES)
    for ex in EXERCISES.values():
        assert ex.view in ("side", "front") and ex.kind in ("hold", "oscillation")
        assert 0 < ex.target_deg <= ex.ceiling_deg
        assert ex.steps and all(isinstance(s, str) for s in ex.steps)
        assert ex.metric(_res(figure(0)), "left") is not None


def test_flexion_defaults_match_the_shipped_arm_exercise():
    ex = EXERCISES["flexion"]
    assert (ex.target_deg, ex.ceiling_deg, ex.hold_s, ex.sets, ex.reps) == (90.0, 90.0, 3.0, 2, 8)
    assert ex.tolerance_deg == 10.0 and ex.start_below_deg == 25.0 and ex.view == "side"


def test_gentle_tier_softens_the_four_gentle_exercises():
    assert GENTLE_IDS == ("pendulum", "flexion", "abduction", "external_rotation")
    g = resolve("abduction", "gentle")
    assert g.target_deg == 60.0 and g.hold_s == 2.0 and g.reps == 6
    assert resolve("abduction", "full").target_deg == 90.0
    assert resolve("flexion", "gentle").hold_s == 2.0
    assert "×" in g.dose


def test_unknown_exercise_falls_back_to_flexion():
    assert get("nope").id == "flexion" and get(None).id == "flexion"
    assert get("pendulum").id == "pendulum"


def test_reference_ranges_loader_reads_mean_minus_one_sd(tmp_path, monkeypatch):
    import json

    import praxis_session.perception.exercises as ex_mod

    path = tmp_path / "rehab_reference_ranges.json"
    path.write_text(json.dumps({"exercises": {"abduction": {"mean_deg": 80.0, "sd_deg": 6.0}}}))
    monkeypatch.setattr(ex_mod, "REFERENCE_PATH", path)
    ranges = ex_mod.load_reference_ranges()
    assert ranges["abduction"] == pytest.approx(74.0)
    assert ex_mod.load_reference_ranges(tmp_path / "missing.json") == {}
