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


def test_visibility_split_by_joint_group():
    from praxis_session.perception.pose import PoseResult

    vis = np.ones(33, np.float32)
    vis[HIP[0]] = 0.9
    vis[HIP[1]] = 0.2  # far hip hidden by the chair
    vis[SHOULDER[1]] = 0.4  # far shoulder
    res = PoseResult(
        landmarks_px=figure(30), visibility=vis, world=np.zeros((33, 3), np.float32), conf=0.9
    )
    a = arm_angles(res, "left")
    assert a["visibility"] == 0.9  # practising-side shoulder, elbow, hip
    assert a["hip_visibility"] == 0.2 and a["shoulders_visibility"] == 0.4


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


# ---- ROI tracking (REHAB24-6 finding, 11 Oct) -------------------------------------------
# On real video (evaluation/results/rehab24_v0.md) the MediaPipe person detector misplaces its
# mid-hip keypoint when the arm is raised overhead, so a region of interest taken from the
# detector on every frame shrinks onto the face and the 33 landmarks collapse. MediaPipe's own
# pipeline tracks: the next frame's region comes from the previous landmarks' two alignment
# points (index 33 = mid-hip, 34 = full-body point), and the detector runs only when tracking
# is lost. These fakes stand in for the two networks so the policy is tested without models.
class _FakeDet:
    def __init__(self, persons):
        self.persons, self.calls = persons, 0

    def infer(self, image):
        self.calls += 1
        return self.persons


class _FakePose:
    """Returns 39 landmarks whose alignment points sit where `aux` says; `fail` = low confidence."""

    def __init__(self, aux=((100.0, 300.0), (100.0, 60.0))):
        self.rois, self.fail, self.aux = [], False, aux

    def infer(self, image, person):
        self.rois.append(np.asarray(person, np.float32).copy())
        if self.fail:
            return None
        lm = np.zeros((39, 5), np.float32)
        lm[:, 3] = 1.0
        lm[33, :2], lm[34, :2] = self.aux
        return (None, lm, np.zeros((39, 3), np.float32), None, None, 0.9)


def _tracker(persons, pose=None):
    from pathlib import Path

    tr = PoseTracker(models_dir=Path("/nonexistent"))
    tr._person, tr._pose, tr.available = _FakeDet(persons), pose or _FakePose(), True
    return tr


DET = np.array([[0, 0, 10, 10, 50.0, 200.0, 50.0, 20.0, 0, 0, 0, 0, 0.9]], np.float32)
FRAME = np.zeros((480, 640, 3), np.uint8)


def test_tracker_reuses_previous_alignment_points_as_next_roi():
    tr = _tracker(DET)
    assert tr.detect(FRAME) is not None and tr.last_source == "detector"
    assert tr._person.calls == 1
    # MediaPipe's region is 1.25x the alignment span about the mid-hip point (both sources)
    np.testing.assert_allclose(tr._pose.rois[0][4:8], [50.0, 200.0, 50.0, 200.0 - 1.25 * 180.0])
    assert tr.detect(FRAME) is not None and tr.last_source == "track"
    assert tr._person.calls == 1  # the detector did not run on the tracked frame
    np.testing.assert_allclose(tr._pose.rois[1][4:8], [100.0, 300.0, 100.0, 300.0 - 1.25 * 240.0])


def test_region_scale_matches_mediapipe():
    from praxis_session.perception.pose import ROI_SCALE, scale_roi

    assert ROI_SCALE == 1.25
    row = scale_roi(DET[0])
    np.testing.assert_allclose(row[4:6], DET[0][4:6])  # the centre does not move
    np.testing.assert_allclose(np.linalg.norm(row[6:8] - row[4:6]), 1.25 * 180.0)
    np.testing.assert_allclose(DET[0][6:8], [50.0, 20.0])  # the input is not modified


def test_tracker_falls_back_to_the_detector_in_the_same_frame():
    tr = _tracker(DET)
    tr.detect(FRAME)
    tr._pose.fail = True  # the tracked region no longer holds a confident pose
    assert tr.detect(FRAME) is None
    assert tr._person.calls == 2 and len(tr._pose.rois) == 3  # tracked try, then the detector's
    tr._pose.fail = False
    assert tr.detect(FRAME) is not None and tr.last_source == "detector"


def test_tracker_drops_tracking_when_nobody_is_found():
    tr = _tracker(None)
    assert tr.detect(FRAME) is None and tr._pose.rois == []
    tr._person.persons = DET
    tr.detect(FRAME)
    tr._person.persons = None
    tr._pose.fail = True
    assert tr.detect(FRAME) is None
    tr._pose.fail = False
    assert tr.detect(FRAME) is None and tr.last_source is None


def test_tracker_ignores_degenerate_alignment_points():
    tr = _tracker(DET, _FakePose(aux=((100.0, 100.0), (100.5, 100.0))))
    tr.detect(FRAME)
    tr.detect(FRAME)
    assert tr._person.calls == 2 and tr.last_source == "detector"


def test_tracker_reset_forces_the_detector():
    tr = _tracker(DET)
    tr.detect(FRAME)
    tr.reset()
    tr.detect(FRAME)
    assert tr._person.calls == 2


def test_region_outside_the_frame_is_no_pose_not_a_crash():
    # REHAB24-6 head-masked frames: a detector region wholly off the image made the vendored
    # MPPose call cv2.copyMakeBorder with negative padding and raise.
    off = DET.copy()
    off[0, 4:8] = [2000.0, 300.0, 2000.0, 200.0]  # centre far right of a 640-px frame
    tr = _tracker(off)
    assert tr.detect(FRAME) is None and tr._pose.rois == []


@pytest.mark.skipif(not (MODELS_DIR / POSE_MODEL).exists(), reason="models not downloaded")
def test_real_tracker_survives_regions_off_and_half_off_the_frame():
    tr = PoseTracker()
    off = np.array([[0, 0, 0, 0, 900.0, 240.0, 900.0, 100.0, 0, 0, 0, 0, 0.9]], np.float32)
    tr._person = _FakeDet(off)
    assert tr.detect(FRAME) is None  # used to raise cv2.error in copyMakeBorder
    half = off.copy()
    half[0, [4, 6]] = 700.0
    tr._person = _FakeDet(half)
    tr.detect(FRAME)  # must not raise
