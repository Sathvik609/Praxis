"""The exercise registry (locked set of 23 Sep 2026) and its camera-relative metrics.

Synthetic landmark figures only (never a live camera). The figures are the same 33-point
BlazePose layout the tracker returns; `tests/test_pose.py::figure` builds the side view.
"""

import numpy as np
import pytest

from praxis_session.perception.exercises import (
    DEFAULT_VISIBLE_ID,
    DEMO_IDS,
    EXERCISES,
    HIDDEN_IDS,
    ORDER,
    VISIBLE_IDS,
    Exercise,
    get,
    resolve,
)
from praxis_session.perception.pose import (
    ELBOW,
    SHOULDER,
    WRIST,
    PoseResult,
    pendulum_swing_deg,
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


def test_pendulum_swing_is_signed_and_zero_at_rest():
    assert abs(pendulum_swing_deg(_res(swing_figure(0.0)), "left")) < 1
    assert abs(pendulum_swing_deg(_res(swing_figure(20.0)), "left") - 20) < 2
    assert abs(pendulum_swing_deg(_res(swing_figure(-20.0)), "left") + 20) < 2
    # an arm lifted above the shoulder is not a pendulum swing
    assert pendulum_swing_deg(_res(figure(120)), "left") == 0.0


# ---- registry --------------------------------------------------------------------------
LOCKED = {
    "pendulum",
    "flexion",
    "abduction",
    "cup",
    "nhpt",
    "external_rotation",
    "internal_rotation",
}


def test_registry_holds_the_locked_seven_of_23_sep():
    """Three exercises + two activities camera-coached, two rotations demo-only (23 Sep)."""
    assert set(EXERCISES) == LOCKED
    assert "scaption" not in EXERCISES and "extension" not in EXERCISES
    assert ORDER == ("pendulum", "flexion", "abduction", "cup", "nhpt", "external_rotation", "internal_rotation")
    groups = {ex.id: ex.group for ex in EXERCISES.values()}
    assert [i for i in ORDER if groups[i] == "exercise"] == ["pendulum", "flexion", "abduction"]
    assert [i for i in ORDER if groups[i] == "activity"] == ["cup", "nhpt"]
    assert [i for i in ORDER if groups[i] == "demo"] == ["external_rotation", "internal_rotation"]
    for ex in EXERCISES.values():
        assert ex.mode in ("coached", "demo") and ex.category in ("exercise", "activity")
        assert ex.steps and all(isinstance(s, str) for s in ex.steps)
        assert ex.dose
        if ex.pipeline == "arm":
            assert ex.view in ("side", "front") and ex.kind in ("hold", "oscillation")
            assert 0 < ex.target_deg <= ex.ceiling_deg
            assert ex.metric is not None and ex.metric(_res(figure(0)), "left") is not None


def test_only_the_three_of_28_sep_are_visible_and_the_rest_stay_dormant():
    """28 Sep lock: Arm out to the side, Waiter – cup, Nine-Hole Peg Test. Pendulum, Arm to the
    front and the two rotations stay in the registry (code, clips, tests) but are hidden."""
    assert VISIBLE_IDS == ("abduction", "cup", "nhpt")
    assert HIDDEN_IDS == ("pendulum", "flexion", "external_rotation", "internal_rotation")
    assert set(VISIBLE_IDS) | set(HIDDEN_IDS) == set(ORDER)
    for i in VISIBLE_IDS:
        assert EXERCISES[i].visible and EXERCISES[i].mode == "coached"
        assert EXERCISES[i].to_dict()["visible"] is True
    for i in HIDDEN_IDS:
        assert not EXERCISES[i].visible and EXERCISES[i].to_dict()["visible"] is False
    assert DEFAULT_VISIBLE_ID == "abduction" and EXERCISES[DEFAULT_VISIBLE_ID].pipeline == "arm"
    # dormant, not deleted: the hidden lifts keep their metric and still resolve
    assert EXERCISES["pendulum"].metric is not None and EXERCISES["flexion"].metric is not None


def test_the_lifts_are_scored_from_the_view_that_shows_them():
    assert EXERCISES["flexion"].view == "side" and EXERCISES["flexion"].name == "Arm to the front"
    assert EXERCISES["abduction"].view == "front" and EXERCISES["abduction"].name == "Arm out to the side"
    assert EXERCISES["pendulum"].kind == "oscillation"
    assert EXERCISES["cup"].pipeline == "cup" and EXERCISES["nhpt"].pipeline == "nhpt"
    assert EXERCISES["nhpt"].frequency == "weekly" and EXERCISES["cup"].frequency == "daily"


def test_demo_exercises_have_no_camera_metric_and_no_pipeline():
    """A single webcam cannot measure the rotations honestly, so nothing can score them."""
    assert DEMO_IDS == ("external_rotation", "internal_rotation")
    for i in DEMO_IDS:
        ex = EXERCISES[i]
        assert ex.mode == "demo" and ex.pipeline is None and ex.metric is None
        d = ex.to_dict()
        assert d["mode"] == "demo" and d["group"] == "demo"
        assert d["camera_verified"] is False and d["self_ticked"] is True
    for i in ("pendulum", "flexion", "abduction", "cup", "nhpt"):
        d = EXERCISES[i].to_dict()
        assert d["mode"] == "coached" and d["camera_verified"] is True and d["self_ticked"] is False


def test_a_demo_entry_with_a_pipeline_or_an_arm_entry_without_a_metric_is_refused():
    with pytest.raises(ValueError):
        Exercise(id="x", name="X", clip="x", view="front", mode="demo", pipeline="arm", metric=shoulder_elevation_deg)
    with pytest.raises(ValueError):
        Exercise(id="y", name="Y", clip="y", view="front", pipeline="arm", metric=None)


def test_flexion_defaults_match_the_shipped_arm_exercise():
    ex = EXERCISES["flexion"]
    assert (ex.target_deg, ex.ceiling_deg, ex.hold_s, ex.sets, ex.reps) == (90.0, 90.0, 3.0, 2, 8)
    assert ex.tolerance_deg == 10.0 and ex.start_below_deg == 25.0 and ex.view == "side"


def test_gentle_tier_softens_within_the_prescription():
    g = resolve("abduction", "gentle")
    assert g.target_deg == 60.0 and g.hold_s == 2.0 and g.reps == 6
    assert resolve("abduction", "full").target_deg == 90.0
    assert resolve("flexion", "gentle").hold_s == 2.0
    assert resolve("pendulum", "gentle").reps == 8
    cup = resolve("cup", "gentle")
    assert cup.slow_arcs == 2 and cup.fast_arcs == 0 and "fast" not in cup.dose
    assert "fast" in resolve("cup", "full").dose
    assert g.dose == "2 sets of 6 · hold 2 s"


def test_gentle_overrides_outside_the_allowed_adaptations_are_dropped_or_clamped():
    """Guardrail in code: a tier can only move a field the prescription allows, inside its range."""
    from praxis_session.prescription import SEED_PRESCRIPTION

    narrow = SEED_PRESCRIPTION.model_copy(deep=True)
    narrow.allowed_adaptations["abduction"] = {"target_deg": [70.0, 90.0]}  # no hold_s, no reps
    g = resolve("abduction", "gentle", narrow)
    assert g.target_deg == 70.0  # clamped up into the allowed range
    assert g.hold_s == EXERCISES["abduction"].hold_s and g.reps == EXERCISES["abduction"].reps
    nothing = SEED_PRESCRIPTION.model_copy(deep=True)
    nothing.allowed_adaptations.pop("cup")
    assert resolve("cup", "gentle", nothing).fast_arcs == 2


def test_rest_and_unknown_tiers_are_not_runnable():
    with pytest.raises(ValueError):
        resolve("flexion", "rest")
    with pytest.raises(ValueError):
        resolve("flexion", "turbo")


def test_unknown_exercise_falls_back_to_flexion():
    assert get("nope").id == "flexion" and get(None).id == "flexion"
    assert get("pendulum").id == "pendulum"
    assert get("scaption").id == "flexion" and get("extension").id == "flexion"


def test_reference_ranges_loader_reads_mean_minus_one_sd_of_correct_reps(tmp_path, monkeypatch):
    """The shipped file is healthy-adult Kinect peaks with correct/incorrect blocks."""
    import json

    import praxis_session.perception.exercises as ex_mod

    path = tmp_path / "rehab_reference_ranges.json"
    path.write_text(
        json.dumps(
            {
                "exercises": {
                    "abduction": {
                        "source": "UI-PRMD m07",
                        "correct": {"mean": 155.0, "sd": 9.0, "n": 90},
                        "incorrect": {"mean": 120.0, "sd": 20.0, "n": 90},
                        "correct_healthy": {"mean": 158.0, "sd": 8.0, "n": 40},
                    },
                    "internal_rotation": {"correct": {"mean": 30.0, "sd": 8.0, "n": 30}},
                    "bogus": "not a block",
                }
            }
        )
    )
    monkeypatch.setattr(ex_mod, "REFERENCE_PATH", path)
    ranges = ex_mod.load_reference_ranges()
    assert ranges["abduction"] == pytest.approx(146.0)
    assert ranges["internal_rotation"] == pytest.approx(22.0)
    assert "bogus" not in ranges


def test_registry_falls_back_to_constants_without_the_reference_file(tmp_path):
    import praxis_session.perception.exercises as ex_mod

    assert ex_mod.load_reference_ranges(tmp_path / "missing.json") == {}
    plain = ex_mod.build_registry({})
    assert plain["abduction"].target_deg == 90.0 and plain["pendulum"].target_deg == 20.0


def test_reference_targets_are_clamped_to_the_in_code_ceiling():
    """Healthy-adult references sit far above the GRASP ceiling; they may lower a target but
    must never raise one."""
    import praxis_session.perception.exercises as ex_mod

    reg = ex_mod.build_registry({"abduction": 146.0, "flexion": 70.0, "internal_rotation": 22.0})
    assert reg["abduction"].target_deg == 90.0 == reg["abduction"].ceiling_deg
    assert reg["flexion"].target_deg == 70.0
    # demo entries have nothing to score, so a reference never gives them a target
    assert reg["internal_rotation"] == ex_mod.build_registry({})["internal_rotation"]
