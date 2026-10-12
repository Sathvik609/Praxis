"""Body pose for Arm to the front (OpenCV cv2.__version__ == 5.0.0, cv2.dnn).

OpenCV Zoo MediaPipe pair (Apache-2.0, docs/LICENSES.md): person detection (224x224) then
BlazePose landmarks (256x256) -> 33 points in frame px with visibility. Angles are computed in
the image plane and are camera-relative progress, never clinical goniometry. Side view
(practising side toward the camera) is the documented assumption; `view_ok` reports it.

Region of interest (11 Oct, from real video, `evaluation/results/rehab24_v0.md`): MediaPipe's
policy, not a detector call per frame. The landmark region is tracked from the previous frame's
alignment points and enlarged 1.25x like MediaPipe's; the person detector runs only on the first
frame or after the pose is lost; a region wholly off the frame is no pose, never an exception.
The detector, and so the whole pose stage, needs the head in view.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

MODELS_DIR = Path(__file__).resolve().parents[2] / "models"
PERSON_MODEL = "person_detection_mediapipe_2023mar.onnx"
POSE_MODEL = "pose_estimation_mediapipe_2023mar.onnx"

# BlazePose indices (left, right)
SHOULDER = (11, 12)
ELBOW = (13, 14)
WRIST = (15, 16)
HIP = (23, 24)
SKELETON = [(11, 13), (13, 15), (12, 14), (14, 16), (11, 12), (11, 23), (12, 24), (23, 24)]

# View gates from the shoulder separation in trunk lengths (|L-R shoulder| / |shoulder mid - hip
# mid|). Front (Arm out to the side): ≥ FRONT_SEP_MIN. Set 12 Oct from REHAB24-6 with the
# subject's yaw to each camera recovered from the mocap (`evaluation/scripts/rehab24_thresholds.py`,
# `evaluation/results/rehab24_thresholds_v0.md`): 0.55 passes ~all frames up to 20 deg of turn
# and ~90 % at 20-30 deg, where the angle error is still 6-8 deg; it rejects ~90 % at 45-50 deg
# and every side-on frame. Until 11 Oct it was 0.6, which front-on adults clear only just
# (p5 0.61). Side (the hidden side-view exercises): < SIDE_SEP_MAX, unchanged.
FRONT_SEP_MIN = 0.55
SIDE_SEP_MAX = 0.6


@dataclass
class PoseResult:
    landmarks_px: np.ndarray  # (33, 2)
    visibility: np.ndarray  # (33,)
    world: np.ndarray  # (33, 3)
    conf: float

    def to_dict(self) -> dict:
        return {
            "present": True,
            "landmarks_px": np.round(self.landmarks_px, 1).tolist(),
            "visibility": np.round(self.visibility, 2).tolist(),
            "conf": round(float(self.conf), 3),
        }


class PoseTracker:
    def __init__(self, models_dir: Path = MODELS_DIR, conf_threshold: float = 0.5) -> None:
        self.models_dir = Path(models_dir)
        self.available = False
        self.last_ms = 0.0
        person, pose = self.models_dir / PERSON_MODEL, self.models_dir / POSE_MODEL
        if person.exists() and pose.exists():
            from praxis_session.perception.hand import _quiet_cv_logs
            from praxis_session.perception.zoo.mp_persondet import MPPersonDet
            from praxis_session.perception.zoo.mp_pose import MPPose

            class _PersonDet(MPPersonDet):  # type: ignore[misc]
                """OpenCV 5's graph engine returns this model's outputs as (scores, boxes);
                the vendored wrapper expects (boxes, scores). Order them by width."""

                def infer(self, image):
                    h, w, _ = image.shape
                    blob, pad_bias = self._preprocess(image)
                    self.model.setInput(blob)
                    outs = list(self.model.forward(self.model.getUnconnectedOutLayersNames()))
                    outs.sort(key=lambda o: -o.shape[-1])
                    return self._postprocess(outs, np.array([w, h]), pad_bias)

            with _quiet_cv_logs():
                self._person = _PersonDet(
                    str(person), nmsThreshold=0.3, scoreThreshold=0.5, topK=50
                )
                self._pose = MPPose(str(pose), confThreshold=conf_threshold)
            self.available = True
        # Region tracking state (see `detect`); `last_source` says what placed the last pose.
        self._track: np.ndarray | None = None
        self.last_source: str | None = None

    def reset(self) -> None:
        """Forget the tracked region: the next frame runs the person detector."""
        self._track = None
        self.last_source = None

    def _infer(self, frame_bgr: np.ndarray, person: np.ndarray):
        """Landmarks for one region, or None when the region misses the frame or the landmark
        confidence is below the threshold. A region wholly outside the image used to reach
        `cv2.copyMakeBorder` with negative padding and raise (seen on REHAB24-6 with the head
        masked), which would have ended a live session; now that frame simply has no pose."""
        person = scale_roi(person)
        if not _roi_in_frame(person, frame_bgr.shape):
            return None
        try:
            return self._pose.infer(frame_bgr, person)
        except cv2.error:
            return None

    def detect(self, frame_bgr: np.ndarray) -> PoseResult | None:
        """One frame. MediaPipe's tracking policy (REHAB24-6 finding, 11 Oct): the region comes
        from the previous frame's landmark alignment points while that pose was confident, and
        the person detector runs only for the first frame or when tracking is lost. On real
        video the detector misplaces its mid-hip keypoint when the arm goes overhead, so a
        detector region on every frame shrank onto the face and the landmarks collapsed."""
        if not self.available:
            return None
        t0 = time.perf_counter()
        out, source = None, None
        try:
            if self._track is not None:
                out, source = self._infer(frame_bgr, self._track), "track"
            if out is None:
                persons = self._person.infer(frame_bgr)
                if persons is not None and len(persons) > 0:
                    best = persons[np.argmax(persons[:, -1])]
                    out, source = self._infer(frame_bgr, best), "detector"
        finally:
            self.last_ms = (time.perf_counter() - t0) * 1000.0
        if out is None:
            self.reset()
            return None
        _bbox, landmarks, world, _mask, _heatmap, conf = out
        lm_all = np.asarray(landmarks)
        self._track = roi_from_landmarks(lm_all)
        self.last_source = source
        lm = lm_all[:33]
        return PoseResult(
            landmarks_px=lm[:, :2].astype(np.float32),
            visibility=lm[:, 3].astype(np.float32),
            world=np.asarray(world)[:33].astype(np.float32),
            conf=float(conf),
        )


# BlazePose's landmark model returns 39 points: the 33 body landmarks, then two alignment points
# (33 = mid-hip centre, 34 = full-body size/rotation point) that MediaPipe uses to place the next
# frame's region, in the same layout as the person detector's first two keypoints.
ALIGN_HIP, ALIGN_FULL = 33, 34
MIN_TRACK_PX = 8.0  # alignment points closer than this cannot define a body-sized region
# MediaPipe enlarges the alignment-point rectangle 1.25x before cropping, for the detector's
# region and the tracked one alike (`pose_detection_to_roi` / `pose_landmarks_to_roi`, scale
# 1.25); the OpenCV Zoo port crops at 1.0x, which cut off an arm raised overhead. On REHAB24-6
# (front camera) tracking plus this scale removed every hip estimate > 100 px off (was up to 44 %
# of a dim recording's frames).
ROI_SCALE = 1.25


def scale_roi(person: np.ndarray, scale: float = ROI_SCALE) -> np.ndarray:
    """A copy of a person row with the full-body keypoint pushed away from the mid-hip centre by
    `scale` (the vendored MPPose crop's half-size is their distance)."""
    row = np.array(person, np.float32, copy=True)
    row[6:8] = row[4:6] + scale * (row[6:8] - row[4:6])
    return row


def roi_from_landmarks(lm: np.ndarray) -> np.ndarray | None:
    """A person-detector-shaped row (box, 4 keypoints, score) whose first two keypoints are the
    landmarks' alignment points, for `MPPose.infer`; None if the points are missing or too close."""
    if lm.shape[0] <= ALIGN_FULL:
        return None
    hip, full = lm[ALIGN_HIP, :2].astype(np.float32), lm[ALIGN_FULL, :2].astype(np.float32)
    if not (np.all(np.isfinite(hip)) and np.all(np.isfinite(full))) or float(np.linalg.norm(full - hip)) < MIN_TRACK_PX:
        return None
    row = np.zeros(13, np.float32)
    row[4:6], row[6:8], row[8:10], row[10:12] = hip, full, hip, full
    row[12] = 1.0
    return row


def _roi_in_frame(person: np.ndarray, shape: tuple[int, ...]) -> bool:
    """Whether the square region `MPPose` builds from the first two keypoints (centre = mid-hip,
    half-size = hip-to-full-body distance) overlaps the image at all."""
    hip, full = np.asarray(person[4:6], np.float64), np.asarray(person[6:8], np.float64)
    r = float(np.linalg.norm(full - hip))
    h, w = shape[:2]
    if not np.isfinite(r) or r < 1.0:
        return False
    return hip[0] + r > 0 and hip[0] - r < w and hip[1] + r > 0 and hip[1] - r < h


class OneEuro:
    """One-Euro filter (Casiez et al. 2012) for a scalar signal with irregular timestamps."""

    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.02, d_cutoff: float = 1.0) -> None:
        self.min_cutoff, self.beta, self.d_cutoff = min_cutoff, beta, d_cutoff
        self._t: float | None = None
        self._x: float | None = None
        self._dx = 0.0

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1.0 / (2 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / max(dt, 1e-6))

    def filter(self, t: float, x: float) -> float:
        if self._t is None or self._x is None:
            self._t, self._x = t, x
            return x
        dt = max(t - self._t, 1e-6)
        dx = (x - self._x) / dt
        a_d = self._alpha(self.d_cutoff, dt)
        self._dx = a_d * dx + (1 - a_d) * self._dx
        cutoff = self.min_cutoff + self.beta * abs(self._dx)
        a = self._alpha(cutoff, dt)
        self._x = a * x + (1 - a) * self._x
        self._t = t
        return self._x

    def reset(self) -> None:
        self._t = self._x = None
        self._dx = 0.0


def _angle(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na < 1e-6 or nb < 1e-6:
        return 0.0
    return float(np.degrees(np.arccos(np.clip(np.dot(a, b) / (na * nb), -1.0, 1.0))))


# ---- per-exercise metrics (Sprint E; camera-relative degrees, never goniometry) ---------
def _sides(side: str) -> tuple[int, int]:
    i = 0 if side == "left" else 1
    return i, 1 - i


def shoulder_elevation_deg(res: PoseResult, side: str) -> float:
    """Image-plane angle at the shoulder between the upper arm and the trunk.

    In the **side** view this is shoulder flexion (Arm to the front); the sign is not
    recoverable, so a reach behind the body would also read as a positive elevation. In the
    **front** view the same number is abduction (Arm out to the side); cross-body motion is
    indistinguishable from abduction here, which is one reason scaption was dropped (23 Sep).
    Shoulder rotation has no metric at all: the forearm points at a single webcam, so Rotate
    out / Rotate in are demo-only and self-ticked (`exercises.py`).
    """
    i, _ = _sides(side)
    lm = res.landmarks_px
    sh, el, hp = lm[SHOULDER[i]], lm[ELBOW[i]], lm[HIP[i]]
    return round(_angle(el - sh, hp - sh), 1)


def pendulum_swing_deg(res: PoseResult, side: str) -> float:
    """Side-view swing of the hanging arm: the signed angle of shoulder→wrist from vertical
    (+ forward in +x). 0 when the wrist is not below the shoulder, which is not a pendulum."""
    i, _ = _sides(side)
    lm = res.landmarks_px
    v = lm[WRIST[i]] - lm[SHOULDER[i]]
    if v[1] <= 0 or float(np.linalg.norm(v)) < 1e-6:
        return 0.0
    return round(float(np.degrees(np.arctan2(float(v[0]), float(v[1])))), 1)


def arm_angles(res: PoseResult, side: str) -> dict:
    """Shoulder flexion, elbow angle, trunk lean (signed, + = shoulders behind hips toward the
    camera-left), shoulder hike (practising shoulder height above the other one, normalised by
    torso length), view_ok (side view), and the minimum visibility of the joints used."""
    i = 0 if side == "left" else 1
    j = 1 - i
    lm = res.landmarks_px
    sh, el, wr, hp = lm[SHOULDER[i]], lm[ELBOW[i]], lm[WRIST[i]], lm[HIP[i]]
    sh_o, hp_o = lm[SHOULDER[j]], lm[HIP[j]]
    sh_mid, hp_mid = (sh + sh_o) / 2, (hp + hp_o) / 2
    torso = float(np.linalg.norm(sh_mid - hp_mid)) or 1.0
    shoulder_deg = _angle(el - sh, hp - sh)
    elbow_deg = _angle(sh - el, wr - el)
    trunk = sh_mid - hp_mid  # points up (negative y)
    lean = float(np.degrees(np.arctan2(-trunk[0], -trunk[1])))  # 0 when vertical
    hike = float((sh_o[1] - sh[1]) / torso)
    sep = float(np.linalg.norm(sh - sh_o)) / torso
    vis = res.visibility
    # Three visibility groups gate three different things (arm_fsm.py): the practising-side
    # shoulder/elbow/hip make the angle (freeze below 0.5); both hips make the lean; both
    # shoulders make the hike.
    angle_joints = [SHOULDER[i], ELBOW[i], HIP[i]]
    return {
        "shoulder_deg": round(shoulder_deg, 1),
        "elbow_deg": round(elbow_deg, 1),
        "trunk_lean_deg": round(lean, 1),
        "shoulder_hike_norm": round(hike, 3),
        "view_ok": sep < SIDE_SEP_MAX,
        # Sprint E: front-view exercises want shoulders separated, not stacked; both flags come
        # from the same separation (12 Oct: separate thresholds, see FRONT_SEP_MIN).
        "front_view_ok": sep >= FRONT_SEP_MIN,
        "shoulder_sep_norm": round(sep, 3),
        "visibility": round(float(np.min(vis[angle_joints])), 2),
        "hip_visibility": round(float(np.min(vis[[HIP[i], HIP[j]]])), 2),
        "shoulders_visibility": round(float(np.min(vis[[SHOULDER[i], SHOULDER[j]]])), 2),
    }
