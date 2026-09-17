"""Body pose for Arm to the front (OpenCV cv2.__version__ == 5.0.0, cv2.dnn).

OpenCV Zoo MediaPipe pair (Apache-2.0, docs/LICENSES.md): person detection (224x224) then
BlazePose landmarks (256x256) -> 33 points in frame px with visibility. Angles are computed in
the image plane and are camera-relative progress, never clinical goniometry. Side view
(practising side toward the camera) is the documented assumption; `view_ok` reports it.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from pathlib import Path

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

    def detect(self, frame_bgr: np.ndarray) -> PoseResult | None:
        if not self.available:
            return None
        t0 = time.perf_counter()
        try:
            persons = self._person.infer(frame_bgr)
            if persons is None or len(persons) == 0:
                return None
            best = persons[np.argmax(persons[:, -1])]
            out = self._pose.infer(frame_bgr, best)
        finally:
            self.last_ms = (time.perf_counter() - t0) * 1000.0
        if out is None:
            return None
        _bbox, landmarks, world, _mask, _heatmap, conf = out
        lm = np.asarray(landmarks)[:33]
        return PoseResult(
            landmarks_px=lm[:, :2].astype(np.float32),
            visibility=lm[:, 3].astype(np.float32),
            world=np.asarray(world)[:33].astype(np.float32),
            conf=float(conf),
        )


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

    In the **side** view this is shoulder flexion (arm to the front) or extension (arm to the
    back) — the sign is not recoverable, so both read as a positive elevation. In the **front**
    view the same number is abduction; scaption (the arm 30° forward of the frontal plane)
    projects onto the same measurement, so the registry treats scaption as abduction with a
    lower target and says so. Cross-body motion is indistinguishable from abduction here.
    """
    i, _ = _sides(side)
    lm = res.landmarks_px
    sh, el, hp = lm[SHOULDER[i]], lm[ELBOW[i]], lm[HIP[i]]
    return round(_angle(el - sh, hp - sh), 1)


def rotation_deg(res: PoseResult, side: str) -> float:
    """Front-view shoulder rotation with the elbow tucked and bent ~90°: **positive = external**
    (the wrist swings away from the body), negative = internal (the wrist crosses toward it).

    The forearm points at the camera, so its image length is a projection. We take the wrist's
    sideways offset from the elbow and divide by the *upper arm* length as a stand-in for the
    forearm's true length (they are close in these landmarks), then arcsine it. This is an
    approximation validated on synthetic landmarks only — see docs/RISKS.md.
    """
    i, j = _sides(side)
    lm = res.landmarks_px
    sh, el, wr, sh_o = lm[SHOULDER[i]], lm[ELBOW[i]], lm[WRIST[i]], lm[SHOULDER[j]]
    inward = 1.0 if sh_o[0] >= sh[0] else -1.0  # +x points at the other shoulder
    ref = float(np.linalg.norm(el - sh))
    if ref < 1e-6:
        return 0.0
    lateral = -float(wr[0] - el[0]) * inward  # + = away from the body
    return round(float(np.degrees(np.arcsin(np.clip(lateral / ref, -1.0, 1.0)))), 1)


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
        "view_ok": sep < 0.6,
        # Sprint E: front-view exercises want the opposite of `view_ok` (shoulders separated,
        # not stacked); both come from the same shoulder separation.
        "front_view_ok": sep >= 0.6,
        "shoulder_sep_norm": round(sep, 3),
        "visibility": round(float(np.min(vis[angle_joints])), 2),
        "hip_visibility": round(float(np.min(vis[[HIP[i], HIP[j]]])), 2),
        "shoulders_visibility": round(float(np.min(vis[[SHOULDER[i], SHOULDER[j]]])), 2),
    }
