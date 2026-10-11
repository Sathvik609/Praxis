"""Unit tests for evaluation/scripts/rehab24_eval.py on tiny synthetic inputs (no dataset
files, no video): reference-angle maths, interval / point matching, the hold-independent
movement detector, error statistics and the segmentation parser."""
import importlib.util
import math
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[3]


def _load():
    spec = importlib.util.spec_from_file_location("rehab24_eval", ROOT / "evaluation" / "scripts" / "rehab24_eval.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["rehab24_eval"] = mod
    spec.loader.exec_module(mod)
    return mod


ev = _load()


def _skeleton(abd_deg: float, flex_deg: float = 0.0, yaw_deg: float = 0.0) -> np.ndarray:
    """One frame of the 26-joint mocap layout (metres, y up, subject facing +z), right upper arm
    abducted by `abd_deg` in the frontal plane and then flexed forward by `flex_deg`; the whole
    body is rotated about the vertical by `yaw_deg` (the frontal plane follows the body)."""
    p = np.zeros((26, 4))
    p[:, 3] = 1.0
    sh_r, sh_l = np.array([-0.2, 1.4, 0.0]), np.array([0.2, 1.4, 0.0])
    p[ev.J["RightArm"], :3] = sh_r
    p[ev.J["LeftArm"], :3] = sh_l
    p[ev.J["Neck"], :3] = [0.0, 1.5, 0.0]
    p[ev.J["Hips"], :3] = [0.0, 1.0, 0.0]
    p[ev.J["RightUpLeg"], :3] = [-0.1, 1.0, 0.0]
    p[ev.J["LeftUpLeg"], :3] = [0.1, 1.0, 0.0]
    a, f = math.radians(abd_deg), math.radians(flex_deg)
    # abduction: rotate "down" (0,-1,0) toward the subject's right (-x) in the x-y plane
    v = np.array([-math.sin(a), -math.cos(a), 0.0])
    # then flexion: tilt toward the front (+z) out of the frontal plane
    v = math.cos(f) * v + math.sin(f) * np.array([0.0, 0.0, 1.0])
    p[ev.J["RightForeArm"], :3] = sh_r + 0.3 * v
    y = math.radians(yaw_deg)
    rot = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    p[:, :3] = p[:, :3] @ rot.T
    return p


@pytest.mark.parametrize("abd", [0.0, 30.0, 60.0, 90.0, 135.0])
def test_ref_angles_pure_abduction_equal_in_3d_and_frontal(abd):
    r = ev.ref_angles_3d(_skeleton(abd)[None])
    assert r["ref_3d"][0] == pytest.approx(abd, abs=1e-6)
    assert r["ref_frontal"][0] == pytest.approx(abd, abs=1e-6)


def test_frontal_projection_drops_the_forward_component():
    # 60° abduction then 40° forward: 3D elevation grows past 60°, the frontal-plane angle shrinks
    r = ev.ref_angles_3d(_skeleton(60.0, flex_deg=40.0)[None])
    assert r["ref_3d"][0] > 60.0
    a = math.radians(60.0)
    expected = math.degrees(math.atan2(math.sin(a), math.cos(a)))  # projection keeps x/y ratio
    assert r["ref_frontal"][0] == pytest.approx(expected, abs=1e-6)
    # pure forward flexion has no frontal component beyond "down"
    r0 = ev.ref_angles_3d(_skeleton(0.0, flex_deg=70.0)[None])
    assert r0["ref_frontal"][0] == pytest.approx(0.0, abs=1e-6)
    assert r0["ref_3d"][0] == pytest.approx(70.0, abs=1e-6)


def test_frontal_plane_follows_the_body_not_the_room():
    for yaw in (0.0, 45.0, 90.0, -120.0):
        r = ev.ref_angles_3d(_skeleton(75.0, yaw_deg=yaw)[None])
        assert r["ref_frontal"][0] == pytest.approx(75.0, abs=1e-6)


def test_ref_angle_cam_is_the_product_formula():
    # right shoulder at the origin, hip straight down, elbow out to image-left at 90°
    j2d = np.zeros((1, 26, 2))
    j2d[0, ev.J["RightArm"]] = [100.0, 100.0]
    j2d[0, ev.J["RightUpLeg"]] = [100.0, 300.0]
    j2d[0, ev.J["RightForeArm"]] = [0.0, 100.0]
    assert ev.ref_angle_cam(j2d)[0] == pytest.approx(90.0)
    j2d[0, ev.J["RightForeArm"]] = [100.0 - 70.7107, 100.0 + 70.7107]
    assert ev.ref_angle_cam(j2d)[0] == pytest.approx(45.0, abs=1e-3)


def test_angle_between_degenerate_is_nan():
    out = ev.angle_between(np.array([[0.0, 0.0], [1.0, 0.0]]), np.array([[1.0, 0.0], [0.0, 1.0]]))
    assert math.isnan(out[0]) and out[1] == pytest.approx(90.0)


def test_err_stats_and_bland_altman():
    pred = np.array([10.0, 12.0, 14.0, np.nan])
    ref = np.array([9.0, 10.0, 11.0, 5.0])
    s = ev.err_stats(pred, ref)
    assert s["n"] == 3 and s["bias"] == 2.0 and s["mae"] == 2.0
    assert s["sd"] == 1.0 and s["loa_low"] == pytest.approx(2 - 1.96) and s["loa_high"] == pytest.approx(2 + 1.96)
    assert ev.err_stats(np.array([np.nan]), np.array([1.0]))["n"] == 0


def test_match_intervals_one_to_one_by_overlap():
    labels = [(0.0, 4.0), (4.0, 8.0), (8.0, 12.0)]
    pred = [(0.5, 3.5), (3.9, 12.0), (13.0, 14.0)]  # second spans two labels: matches one
    pairs = ev.match_intervals(pred, labels)
    assert (0, 0) in pairs and len(pairs) == 2
    assert all(i != 2 for i, _ in pairs)
    # a sliver of overlap is not a match
    assert ev.match_intervals([(3.8, 6.0)], [(0.0, 4.0)]) == []


def test_match_points_inside_windows():
    labels = [(0.0, 4.0), (4.0, 8.0)]
    assert ev.match_points([1.0, 2.0, 5.0, 9.0], labels) == [(0, 0), (2, 1)]


def test_detect_movements_counts_lifts_without_any_hold():
    t = np.arange(0, 20, 1 / 15)
    a = 20 + 55 * np.clip(np.sin(2 * np.pi * t / 4), 0, None)  # 5 lifts to 75° with no hold
    a[30:33] = np.nan  # a dropped pose does not split or create a lift
    mv = ev.detect_movements(t, a)
    assert len(mv) == 5
    assert all(m["peak"] == pytest.approx(75, abs=0.5) for m in mv)
    # small wobble below the peak threshold is not a movement
    assert ev.detect_movements(t, 20 + 10 * np.sin(t)) == []


def test_lag_estimate_finds_a_delay():
    t = np.arange(0, 20, 1 / 15)
    ref = 40 + 30 * np.sin(2 * np.pi * t / 5)
    pred = np.roll(ref, 3)  # 3 samples behind
    assert ev.lag_s(t, pred, ref) == pytest.approx(0.2, abs=1e-6)


def test_load_segmentation_parses_ex1(tmp_path):
    csv = tmp_path / "Segmentation.csv"
    csv.write_text(
        "video_id;repetition_number;exercise_id;person_id;first_frame;last_frame;cam17_orientation;mocap_erroneous;"
        "exercise_subtype;lights_on;extra_person_in_cam17;extra_person_in_cam18;correctness\n"
        "PM_9;2;1;4;300;500;front;0;right arm;1;0;0;0\n"
        "PM_9;1;1;4;100;299;front;0;right arm;1;0;0;1\n"
        "PM_8;1;2;4;100;299;front;0;;1;0;0;1\n"
    )
    recs = ev.load_segmentation(csv)
    assert len(recs) == 1
    r = recs[0]
    assert r.video_id == "PM_9" and r.person == 4 and r.lights_on and [x["rep"] for x in r.reps] == [1, 2]
    assert r.reps[0]["correct"] and not r.reps[1]["correct"]
    assert r.views("c17") == {"front"} and r.views("c18") == {"side"}


def test_orientation_is_per_repetition_not_per_recording(tmp_path):
    # five Ex1 recordings turn from front to half-profile halfway; the label is on each row
    csv = tmp_path / "Segmentation.csv"
    csv.write_text(
        "video_id;repetition_number;exercise_id;person_id;first_frame;last_frame;cam17_orientation;mocap_erroneous;"
        "exercise_subtype;lights_on;extra_person_in_cam17;extra_person_in_cam18;correctness\n"
        "PM_9;1;1;4;100;299;front;0;right arm;1;0;0;1\n"
        "PM_9;2;1;4;400;600;half-profile;0;right arm;1;0;0;1\n"
    )
    r = ev.load_segmentation(csv)[0]
    assert r.views("c17") == {"front", "half-profile"} and r.views("c18") == {"side", "half-profile"}
    assert ev.view_of("side", "c18") == "front"


def test_assign_views_by_containing_or_nearest_repetition():
    labels, views = [(0.0, 4.0), (10.0, 14.0)], ["front", "half-profile"]
    assert ev.assign_views([2.0, 6.0, 9.0, 20.0], labels, views) == ["front", "front", "half-profile", "half-profile"]


def test_head_box_covers_the_head_and_stops_at_the_neck():
    j = np.zeros((26, 2))
    j[ev.J["Neck"]] = [100.0, 200.0]
    j[ev.J["Head_end"]] = [100.0, 100.0]
    x0, y0, x1, y1 = ev.head_box(j)
    assert x0 < 100 < x1 and y0 < 100 and y1 == 200
