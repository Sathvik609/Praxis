#!/usr/bin/env python3
"""Real-motion reference clips for the procedural avatar, retargeted from two public
rehabilitation motion datasets (licences in docs/LICENSES.md, fetched by
services/session/tools/fetch_rehab_datasets.py):

  UI-PRMD  (ODC PDDL 1.0)  Kinect, 22 joints, 30 Hz. Positions are parent-relative in the
                            parent's rotated frame and angles are Euler triplets stored x,y,z with
                            the composition R = Rz·Rx·Ry (chosen empirically: it is the only reading
                            under which the elbow angle is stable across m07/m09/m10; the paper's
                            literal "YXZ" reading doubles the elbow scatter). Forward kinematics
                            here rebuilds world joints. Movements used: m07 abduction and m09
                            internal–external rotation (90/90 position). m08 extension and m10
                            scaption were dropped with the locked exercise set of 23 Sep 2026.
  IRDS     (CC BY 4.0)     Kinect One, 25 joints, 30 Hz, metres, one repetition per file.
                            Gesture 2/3 "shoulder flexion" (straight arm to the front). The gesture
                            names and the Simplified column labels are mirror images of each other
                            (the "Left" gestures move the *Right columns), so the practising arm is
                            detected from wrist excursion, never from a label.

For every exercise ONE clean, correct repetition from a healthy subject is chosen (typical peak,
smooth, complete, no tracking dropouts; the choice is printed and written into the clip), the
repetition is segmented around the peak of the progress signal, joint angles are computed with the
rig's own conventions (web/src/avatar/rig.ts: y up, +z toward the viewer, figure's left = +x,
Euler XYZ per joint, R = Rx·Ry·Rz; shoulder pitch −90° = arm forward, left-arm roll +90° = arm
sideways, elbow pitch negative = flexion), the practising arm is always mapped to the rig's LEFT
arm (mirrored from a right-arm source; the panel mirrors it back for right-sided patients), the
other arm rests, and ~12 keyframes with holds at the extremes go to
web/src/avatar/clips/rehab/<exercise>.json. Pendulum exists in neither dataset and is authored
procedurally (labelled source "procedural"). evaluation/results/rehab_reference_ranges.json holds
the peak-angle mean ± sd across correct and incorrect repetitions per exercise.

The avatar plays these as a pacing reference only; it never scores the patient.
Angles are Kinect/camera-relative body-frame angles, not goniometry. numpy only.

    uv run python ../../evaluation/scripts/make_rehab_clips.py [--external DIR] [--clips DIR] [--ranges FILE]
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EXTERNAL = ROOT / "evaluation" / "external"
DEFAULT_CLIPS = ROOT / "web" / "src" / "avatar" / "clips" / "rehab"
DEFAULT_RANGES = ROOT / "evaluation" / "results" / "rehab_reference_ranges.json"
FPS = 30.0
D = math.pi / 180

# ---------------------------------------------------------------- rig conventions (rig.ts)
REST_UA = np.array([0.025, -0.27, 0.0]) / math.hypot(0.025, 0.27)  # left upper arm, rest
REST_FA = np.array([0.0, -1.0, 0.0])
FORWARD = np.array([0.0, 0.0, 1.0])
REST_OTHER_ARM = {"rShoulder": [-3.0, 0.0, -4.0], "rElbow": [-8.0, 0.0, 0.0]}  # clips.ts rest()


def rot_x(t: float) -> np.ndarray:
    c, s = math.cos(t), math.sin(t)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=float)


def rot_y(t: float) -> np.ndarray:
    c, s = math.cos(t), math.sin(t)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=float)


def rot_z(t: float) -> np.ndarray:
    c, s = math.cos(t), math.sin(t)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=float)


def euler_xyz(x: float, y: float, z: float) -> np.ndarray:
    """rig.ts `euler`: Rx · Ry · Rz (radians)."""
    return rot_x(x) @ rot_y(y) @ rot_z(z)


def decompose_xyz(R: np.ndarray) -> tuple[float, float, float]:
    """Inverse of `euler_xyz`; y is taken in (−90°, 90°) so the arm channels stay continuous."""
    y = math.asin(max(-1.0, min(1.0, float(R[0, 2]))))
    if abs(math.cos(y)) < 1e-6:  # gimbal lock: fold z into x
        return math.atan2(float(R[2, 1]), float(R[1, 1])), y, 0.0
    return math.atan2(-float(R[1, 2]), float(R[2, 2])), y, math.atan2(-float(R[0, 1]), float(R[0, 0]))


def unit(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def perp(v: np.ndarray, axis: np.ndarray) -> np.ndarray:
    return unit(v - np.dot(v, axis) * axis)


def triad(a: np.ndarray, p: np.ndarray) -> np.ndarray:
    """Right-handed frame with x along `a` and y along the part of `p` perpendicular to `a`."""
    x = unit(a)
    y = perp(p, x)
    return np.stack([x, y, np.cross(x, y)], axis=1)


def swing(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Minimal rotation taking unit vector a to unit vector b (Rodrigues)."""
    v = np.cross(a, b)
    s = np.linalg.norm(v)
    c = float(np.dot(a, b))
    if s < 1e-9:
        if c > 0:
            return np.eye(3)
        k = perp(np.array([1.0, 0, 0]) if abs(a[0]) < 0.9 else np.array([0, 1.0, 0]), a)
        return 2 * np.outer(k, k) - np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * ((1 - c) / (s * s))


def smoothstep(x: float, lo: float, hi: float) -> float:
    u = min(1.0, max(0.0, (x - lo) / (hi - lo)))
    return u * u * (3 - 2 * u)


# ---------------------------------------------------------------- source skeletons
@dataclass
class Rep:
    dataset: str
    movement: str
    subject: str
    rep_id: str
    correct: bool
    healthy: bool
    position: str
    fps: float
    hip: np.ndarray  # (F,3) pelvis centre
    chest: np.ndarray  # (F,3) top of the spine
    l_sh: np.ndarray
    r_sh: np.ndarray
    sh: np.ndarray  # practising arm
    el: np.ndarray
    wr: np.ndarray
    arm: str  # 'left' | 'right' as the source columns label it

    @property
    def frames(self) -> int:
        return int(self.hip.shape[0])


# UI-PRMD 22-joint Kinect model (paper table 2) and its parent tree.
UIPRMD_JOINTS = [
    "waist", "spine", "chest", "neck", "head", "head_tip",
    "l_collar", "l_upper_arm", "l_forearm", "l_hand",
    "r_collar", "r_upper_arm", "r_forearm", "r_hand",
    "l_upper_leg", "l_lower_leg", "l_foot", "l_toes",
    "r_upper_leg", "r_lower_leg", "r_foot", "r_toes",
]
UIPRMD_PARENT = {
    "waist": None, "spine": "waist", "chest": "spine", "neck": "chest", "head": "neck", "head_tip": "head",
    "l_collar": "chest", "l_upper_arm": "l_collar", "l_forearm": "l_upper_arm", "l_hand": "l_forearm",
    "r_collar": "chest", "r_upper_arm": "r_collar", "r_forearm": "r_upper_arm", "r_hand": "r_forearm",
    "l_upper_leg": "waist", "l_lower_leg": "l_upper_leg", "l_foot": "l_lower_leg", "l_toes": "l_foot",
    "r_upper_leg": "waist", "r_lower_leg": "r_upper_leg", "r_foot": "r_lower_leg", "r_toes": "r_foot",
}
UIPRMD_MOVEMENTS = {7: "standing shoulder abduction", 9: "standing shoulder internal-external rotation"}  # m08, m10 unused since 23 Sep
IRDS_GESTURES = {0: "elbow flexion", 1: "elbow flexion", 2: "shoulder flexion", 3: "shoulder flexion", 4: "shoulder abduction", 5: "shoulder abduction", 6: "shoulder forward elevation (both arms)"}
IRDS_COLS = {"SpineBase": 0, "SpineMid": 1, "Neck": 2, "Head": 3, "ShoulderLeft": 4, "ElbowLeft": 5, "WristLeft": 6, "HandLeft": 7, "ShoulderRight": 8, "ElbowRight": 9, "WristRight": 10, "HandRight": 11, "SpineShoulder": 20}


def uiprmd_local_rotation(a_deg: np.ndarray) -> np.ndarray:
    """One UI-PRMD Kinect angle triplet (stored x, y, z, degrees) → local rotation, R = Rz·Rx·Ry."""
    x, y, z = (float(v) * D for v in a_deg)
    return rot_z(z) @ rot_x(x) @ rot_y(y)


def uiprmd_forward_kinematics(pos: np.ndarray, ang: np.ndarray) -> np.ndarray:
    """(F,22,3) parent-relative positions + (F,22,3) angles → (F,22,3) world positions."""
    F = pos.shape[0]
    world = np.zeros_like(pos)
    idx = {n: i for i, n in enumerate(UIPRMD_JOINTS)}
    for f in range(F):
        rots: dict[str, np.ndarray] = {}
        for name in UIPRMD_JOINTS:
            j = idx[name]
            local = uiprmd_local_rotation(ang[f, j])
            parent = UIPRMD_PARENT[name]
            if parent is None:
                rots[name] = local
                world[f, j] = pos[f, j]
            else:
                rots[name] = rots[parent] @ local
                world[f, j] = world[f, idx[parent]] + rots[parent] @ pos[f, j]
    return world


def moving_arm(l_wr: np.ndarray, r_wr: np.ndarray, hip: np.ndarray) -> str:
    """The practising arm is the one whose wrist travels more relative to the pelvis."""
    ex = lambda w: float(np.ptp(w - hip, axis=0).max())  # noqa: E731
    return "left" if ex(l_wr) >= ex(r_wr) else "right"


def load_uiprmd_rep(positions: Path, angles: Path, correct: bool) -> Rep:
    m = re.match(r"m(\d+)_s(\d+)_e(\d+)", positions.name)
    assert m, positions.name
    pos = np.loadtxt(positions, delimiter=",").reshape(-1, 22, 3)
    ang = np.loadtxt(angles, delimiter=",").reshape(-1, 22, 3)
    n = min(pos.shape[0], ang.shape[0])
    W = uiprmd_forward_kinematics(pos[:n], ang[:n])
    idx = {n_: i for i, n_ in enumerate(UIPRMD_JOINTS)}
    arm = moving_arm(W[:, idx["l_hand"]], W[:, idx["r_hand"]], W[:, idx["waist"]])
    s = "l" if arm == "left" else "r"
    return Rep(
        dataset="ui-prmd", movement=f"m{int(m.group(1)):02d}", subject=f"s{int(m.group(2)):02d}", rep_id=f"e{int(m.group(3)):02d}",
        correct=correct, healthy=True, position="stand", fps=FPS,
        hip=W[:, idx["waist"]], chest=W[:, idx["chest"]], l_sh=W[:, idx["l_upper_arm"]], r_sh=W[:, idx["r_upper_arm"]],
        sh=W[:, idx[f"{s}_upper_arm"]], el=W[:, idx[f"{s}_forearm"]], wr=W[:, idx[f"{s}_hand"]], arm=arm,
    )


def load_irds_rep(path: Path) -> Rep:
    m = re.match(r"(\d+)_(\d+)_(\d+)_(\d+)_(\d+)_([A-Za-z-]+)", path.stem)
    assert m, path.name
    subject, _date, gesture, rep_no, label, position = m.groups()
    d = np.loadtxt(path, delimiter=",").reshape(-1, 25, 3)
    c = IRDS_COLS
    arm = moving_arm(d[:, c["WristLeft"]], d[:, c["WristRight"]], d[:, c["SpineBase"]])
    side = "Left" if arm == "left" else "Right"
    return Rep(
        dataset="irds", movement=f"g{int(gesture)}", subject=subject, rep_id=f"rep{int(rep_no)}",
        correct=label == "1", healthy=subject[0] in "13", position=position.lower(), fps=FPS,
        hip=d[:, c["SpineBase"]], chest=d[:, c["SpineShoulder"]], l_sh=d[:, c["ShoulderLeft"]], r_sh=d[:, c["ShoulderRight"]],
        sh=d[:, c[f"Shoulder{side}"]], el=d[:, c[f"Elbow{side}"]], wr=d[:, c[f"Wrist{side}"]], arm=arm,
    )


# ---------------------------------------------------------------- body frame and angles
@dataclass
class Curves:
    """Per-frame body-frame arm vectors (already mirrored to the rig's left arm) and derived angles."""
    ua: np.ndarray  # (F,3) upper arm direction in the torso frame
    fa: np.ndarray  # (F,3) forearm direction in the torso frame
    spine: np.ndarray  # (F,3,3) torso rotation relative to the reference torso
    elevation: np.ndarray  # deg, angle of the upper arm from hanging straight down
    azimuth: np.ndarray  # deg, 0 = forward, +90 = out to the side, ±180 = backward
    bend: np.ndarray  # deg, elbow flexion (0 = straight)
    rotation: np.ndarray  # deg, forearm about the upper-arm axis: 0 = forward, + = external


def body_frame(hip: np.ndarray, chest: np.ndarray, l_sh: np.ndarray, r_sh: np.ndarray) -> np.ndarray:
    """Columns X (right→left), Y (pelvis→chest), Z = X×Y (anatomical forward in a right-handed set)."""
    y = unit(chest - hip)
    x = perp(l_sh - r_sh, y)
    return np.stack([x, y, np.cross(x, y)], axis=1)


def orthonormal(M: np.ndarray) -> np.ndarray:
    u, _, vt = np.linalg.svd(M)
    R = u @ vt
    if np.linalg.det(R) < 0:
        u[:, -1] *= -1
        R = u @ vt
    return R


def curves(rep: Rep, ref_frames: int = 5) -> Curves:
    F = rep.frames
    frames = np.stack([body_frame(rep.hip[f], rep.chest[f], rep.l_sh[f], rep.r_sh[f]) for f in range(F)])
    ref = orthonormal(frames[: max(1, min(ref_frames, F))].mean(axis=0))
    mirror = np.diag([-1.0, 1.0, 1.0]) if rep.arm == "right" else np.eye(3)
    ua = np.zeros((F, 3))
    fa = np.zeros((F, 3))
    spine = np.zeros((F, 3, 3))
    for f in range(F):
        B = frames[f]
        ua[f] = mirror @ (B.T @ unit(rep.el[f] - rep.sh[f]))
        fa[f] = mirror @ (B.T @ unit(rep.wr[f] - rep.el[f]))
        spine[f] = mirror @ (ref.T @ B) @ mirror
    elevation = np.degrees(np.arccos(np.clip(-ua[:, 1], -1, 1)))
    azimuth = np.degrees(np.arctan2(ua[:, 0], ua[:, 2]))
    bend = np.degrees(np.arccos(np.clip(np.einsum("ij,ij->i", ua, fa), -1, 1)))
    rotation = np.zeros(F)
    for f in range(F):
        n = ua[f]
        e1 = perp(FORWARD, n) if abs(np.dot(FORWARD, n)) < 0.98 else perp(np.array([0, -1.0, 0]), n)
        e2 = np.cross(e1, n)
        rotation[f] = math.degrees(math.atan2(float(np.dot(fa[f], e2)), float(np.dot(fa[f], e1))))
    return Curves(ua, fa, spine, elevation, azimuth, bend, rotation)


def shoulder_elbow(ua: np.ndarray, fa: np.ndarray) -> tuple[np.ndarray, float, float]:
    """Left-arm shoulder rotation (3×3, in the spine frame) and elbow pitch (radians) that put the
    rig's upper arm along `ua` and its forearm along `fa`. The elbow twist is measured from the
    forearm when the elbow is bent and blended toward the zero-twist swing when it is straight
    (a straight arm has no observable twist). Returns (R_shoulder, elbow_pitch, forearm_error_deg)."""
    bend = math.acos(max(-1.0, min(1.0, float(np.dot(ua, fa)))))
    # rig elbow: forearm = Rx(phi)·(0,−1,0); the rest upper arm is 5.3° off −y, so solve
    # angle(REST_UA, forearm(phi)) = bend rather than phi = −bend.
    cos_phi = math.cos(bend) / (-REST_UA[1])
    phi = -math.acos(min(1.0, cos_phi)) if cos_phi < 1.0 else 0.0
    fa_local = rot_x(phi) @ REST_FA
    p_loc = perp(FORWARD, REST_UA)  # elbow crease reference in the shoulder-local frame
    p_swing = swing(REST_UA, ua) @ p_loc
    w = smoothstep(math.degrees(bend), 8.0, 20.0)
    p_meas = perp(fa, ua) if w > 0 else p_swing
    p_tgt = unit(w * p_meas + (1 - w) * p_swing)
    R = triad(ua, p_tgt) @ triad(REST_UA, p_loc).T
    fit = math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(R @ fa_local, fa))))))
    return R, phi, fit


def retarget(c: Curves) -> dict[str, np.ndarray]:
    """Per-frame rig joint angles in degrees (unwrapped, so keys interpolate along the short way)."""
    F = c.ua.shape[0]
    out = {"lShoulder": np.zeros((F, 3)), "lElbow": np.zeros((F, 3)), "spine": np.zeros((F, 3)), "fit": np.zeros(F)}
    for f in range(F):
        R, phi, fit = shoulder_elbow(c.ua[f], c.fa[f])
        out["lShoulder"][f] = np.degrees(decompose_xyz(R))
        out["lElbow"][f] = [math.degrees(phi), 0.0, 0.0]
        out["spine"][f] = np.degrees(decompose_xyz(c.spine[f]))
        out["fit"][f] = fit
    for k in ("lShoulder", "lElbow", "spine"):
        out[k] = np.degrees(np.unwrap(np.radians(out[k]), axis=0))
    return out


def smooth(x: np.ndarray, width: int = 5) -> np.ndarray:
    if x.shape[0] < width or width < 2:
        return x
    k = np.ones(width) / width
    pad = width // 2
    xp = np.concatenate([np.repeat(x[:1], pad, axis=0), x, np.repeat(x[-1:], pad, axis=0)], axis=0)
    if x.ndim == 1:
        return np.convolve(xp, k, mode="valid")
    return np.stack([np.convolve(xp[:, i], k, mode="valid") for i in range(x.shape[1])], axis=1)


# ---------------------------------------------------------------- segmentation and keys
def segment(signal: np.ndarray, frac: float = 0.08, pad: int = 2) -> tuple[int, int, int]:
    """(start, peak, end) frame indices of the single rise-and-fall around the maximum of `signal`:
    the movement starts at the last frame before the peak within `frac` of the range above the
    resting level and ends at the first such frame after it."""
    peak = int(np.argmax(signal))
    base = float(min(signal[: peak + 1].min(), signal[peak:].min()))
    level = base + frac * (float(signal[peak]) - base)
    start = peak
    while start > 0 and signal[start - 1] > level:
        start -= 1
    end = peak
    n = signal.shape[0]
    while end < n - 1 and signal[end + 1] > level:
        end += 1
    return max(0, start - pad), peak, min(n - 1, end + pad)


def key_frames(start: int, peak: int, end: int, n_rise: int = 4, n_fall: int = 5) -> list[int]:
    """Start, `n_rise` frames evenly through the rise, the peak, `n_fall` through the fall, end."""
    rise = np.linspace(start, peak, n_rise + 2)[1:-1]
    fall = np.linspace(peak, end, n_fall + 2)[1:-1]
    idx = [start, *np.round(rise).astype(int).tolist(), peak, *np.round(fall).astype(int).tolist(), end]
    out: list[int] = []
    for i in idx:
        if not out or i > out[-1]:
            out.append(int(i))
    return out


# ---------------------------------------------------------------- exercises
@dataclass(frozen=True)
class Exercise:
    name: str
    title: str
    dataset: str  # 'ui-prmd' | 'irds' | 'procedural'
    movements: tuple[str, ...]  # clip source movements (UI-PRMD m.. or IRDS g..)
    range_sources: tuple[tuple[str, str], ...]  # (dataset, movement) populations for the ranges
    plane: str
    camera: str
    signal: str  # 'elevation' | 'rotation' | '-rotation'
    captions: tuple[str, str, str]


EXERCISES: tuple[Exercise, ...] = (
    Exercise("flexion", "Shoulder flexion", "irds", ("g2", "g3"), (("irds", "g2"), ("irds", "g3")), "sagittal", "side", "elevation",
             ("Lift the straight arm forward, thumb up, trunk still", "Hold at the top, shoulders level", "Lower slowly back to your side")),
    Exercise("abduction", "Shoulder abduction", "ui-prmd", ("m07",), (("ui-prmd", "m07"), ("irds", "g4"), ("irds", "g5")), "frontal", "front", "elevation",
             ("Raise the straight arm out to the side, palm forward", "Hold at the top, no shrugging", "Lower slowly")),
    # The rotations are demo only in the app (a single webcam cannot score them): the avatar
    # performs them and the patient ticks the set. They are authored, not recorded: the app
    # instructs them sitting, elbow tucked at the side and bent to a right angle, and the only
    # dataset rep (UI-PRMD m09) is performed in the 90/90 position, a different exercise.
    Exercise("external_rotation", "Shoulder external rotation", "procedural", (), (), "transverse", "front", "rotation",
             ("Elbow tucked at your side, bent to a right angle", "Swing the forearm outward, away from your tummy, and hold", "Return slowly to the start")),
    Exercise("internal_rotation", "Shoulder internal rotation", "procedural", (), (), "transverse", "front", "-rotation",
             ("Elbow tucked at your side, bent to a right angle", "Bring the forearm across toward your tummy, and hold", "Return slowly to the start")),
    Exercise("pendulum", "Pendulum", "procedural", (), (), "sagittal", "side", "elevation",
             ("Lean forward on a table, let the arm hang loose", "Swing gently in small circles, no muscle effort", "Stand up slowly")),
)
LICENSE = {"ui-prmd": "ODC PDDL 1.0", "irds": "CC BY 4.0", "procedural": "n/a (authored)"}
SOURCE_NAME = {"ui-prmd": "UI-PRMD (University of Idaho Physical Rehabilitation Movements Data Set)", "irds": "IntelliRehabDS (IRDS)"}


def progress_signal(c: Curves, kind: str) -> np.ndarray:
    if kind == "elevation":
        return c.elevation
    if kind == "rotation":
        return c.rotation
    if kind == "-rotation":
        return -c.rotation
    raise ValueError(kind)


def peak_metric(c: Curves, kind: str) -> float:
    return float(progress_signal(c, kind).max())


# ---------------------------------------------------------------- data discovery
def find_reps(external: Path, dataset: str, movement: str) -> list[tuple[Path, Path | None, bool]]:
    """(positions file, angles file or None, correct) for every repetition of a movement."""
    out: list[tuple[Path, Path | None, bool]] = []
    if dataset == "ui-prmd":
        for folder, correct, suffix in (("Segmented Movements", True, ""), ("Incorrect Segmented Movements", False, "_inc")):
            base = external / "ui-prmd" / folder / "Kinect"
            for p in sorted((base / "Positions").glob(f"{movement}_s*_e*_positions{suffix}.txt")):
                a = base / "Angles" / p.name.replace("positions", "angles")
                if a.exists():
                    out.append((p, a, correct))
    elif dataset == "irds":
        g = movement[1:]
        base = external / "irds" / "SkeletonData" / "Simplified"
        for p in sorted(base.glob(f"*_*_{g}_*_*_*.txt")):
            label = p.stem.split("_")[4]
            if label in ("1", "2"):
                out.append((p, None, label == "1"))
    return out


def load_rep(dataset: str, entry: tuple[Path, Path | None, bool]) -> Rep:
    p, a, correct = entry
    if dataset == "ui-prmd":
        assert a is not None
        return load_uiprmd_rep(p, a, correct)
    return load_irds_rep(p)


# ---------------------------------------------------------------- selection
@dataclass
class Candidate:
    rep: Rep
    curves: Curves
    peak: float
    jerk: float
    duration: float
    complete: bool
    stable: bool
    plane: float  # azimuth (deg) on the rise at ~70° elevation: the plane the arm travels in
    bend: float  # mean elbow bend (deg); Kinect reads a straight arm as 10–20° bent


def candidate(rep: Rep, kind: str) -> Candidate:
    c = curves(rep)
    s = progress_signal(c, kind)
    start, peak, end = segment(s)
    seg = s[start : end + 1]
    jerk = float(np.abs(np.diff(seg, n=2)).mean()) if seg.shape[0] > 3 else 1e9
    rng = float(s[peak] - min(s[start], s[end]))
    complete = rng > 15 and abs(float(s[start]) - float(s[end])) < 0.35 * rng
    ua_len = np.linalg.norm(rep.el - rep.sh, axis=1)
    stable = bool(ua_len.std() / max(1e-9, ua_len.mean()) < 0.12 and np.abs(np.diff(seg)).max() < 20)
    i70 = start + int(np.argmin(np.abs(c.elevation[start : peak + 1] - 70)))
    return Candidate(rep, c, float(s[peak]), jerk, (end - start + 1) / rep.fps, complete, stable, float(c.azimuth[i70]), float(c.bend[start : end + 1].mean()))


def choose(cands: list[Candidate], kind: str = "elevation") -> Candidate:
    """The most typical clean repetition: correct, healthy, standing, complete, stable, then the
    smallest combined z-score of peak, jerk, duration and movement plane against that population,
    with a mild preference for a straighter elbow on the straight-arm (elevation) exercises."""
    pool = [c for c in cands if c.rep.correct and c.rep.healthy and c.rep.position == "stand" and c.complete and c.stable]
    if not pool:
        pool = [c for c in cands if c.rep.correct and c.complete] or cands
    col = lambda f: np.array([f(c) for c in pool])  # noqa: E731
    peaks, jerks, durs, planes, bends = col(lambda c: c.peak), col(lambda c: c.jerk), col(lambda c: c.duration), col(lambda c: c.plane), col(lambda c: c.bend)
    z = lambda v, arr: abs(v - arr.mean()) / (arr.std() + 1e-9)  # noqa: E731
    zs = lambda v, arr: (v - arr.mean()) / (arr.std() + 1e-9)  # noqa: E731

    def score(c: Candidate) -> float:
        s = z(c.peak, peaks) + zs(c.jerk, jerks) + z(c.duration, durs)
        if kind == "elevation":
            s += z(c.plane, planes) + 0.5 * zs(c.bend, bends)
        return s

    return min(pool, key=score)


# ---------------------------------------------------------------- clip assembly
def rig_arm_directions(shoulder_deg: np.ndarray, elbow_deg: np.ndarray, spine_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Upper-arm and forearm world directions the rig's forward kinematics produces for these
    key angles (rig.ts: rot[lShoulder] = rot[spine] · euler(lShoulder); neck and hips at zero)."""
    r_spine = euler_xyz(*(np.radians(spine_deg)))
    r_sh = euler_xyz(*(np.radians(shoulder_deg)))
    ua = r_spine @ r_sh @ REST_UA
    fa = r_spine @ r_sh @ rot_x(math.radians(float(elbow_deg[0]))) @ REST_FA
    return ua, fa


def clip_from_frames(ex: Exercise, rep_label: dict, c: Curves, ang: dict[str, np.ndarray], start: int, peak: int, end: int, fps: float, target: float) -> dict:
    idx = key_frames(start, peak, end)
    t0 = start / fps
    keys = []
    for i in idx:
        sh = [round(float(v), 2) for v in ang["lShoulder"][i]]
        el = [round(float(v), 2) for v in ang["lElbow"][i]]
        sp = [round(float(v), 2) for v in ang["spine"][i]]
        ua, fa = rig_arm_directions(np.array(sh), np.array(el), np.array(sp))
        keys.append({
            "t": round(i / fps - t0, 3),
            "hold": i in (start, peak, end),
            "lShoulder": sh,
            "lElbow": el,
            "spine": sp,
            # ua/fa: what the rig's FK must reproduce from these very angles (convention check);
            # src_*: the source skeleton's directions in the reference torso frame (fidelity,
            # differs from ua/fa by the key smoothing and the forearm fit)
            "check": {
                "ua": [round(float(v), 6) for v in ua],
                "fa": [round(float(v), 6) for v in fa],
                "src_ua": [round(float(v), 6) for v in (c.spine[i] @ c.ua[i])],
                "src_fa": [round(float(v), 6) for v in (c.spine[i] @ c.fa[i])],
                "elevation_deg": round(float(c.elevation[i]), 1),
                "bend_deg": round(float(c.bend[i]), 1),
                "rotation_deg": round(float(c.rotation[i]), 1),
            },
        })
    duration = keys[-1]["t"]
    t_peak = round(peak / fps - t0, 3)
    steps = [
        {"t": 0.0, "step": 1, "caption": f"Step 1 of 3 · {ex.captions[0]}"},
        {"t": t_peak, "step": 2, "caption": f"Step 2 of 3 · {ex.captions[1]}"},
        {"t": round(min(duration, t_peak + max(0.25, 0.15 * (duration - t_peak))), 3), "step": 3, "caption": f"Step 3 of 3 · {ex.captions[2]}"},
    ]
    fit = ang["fit"][start : end + 1]
    return {
        "name": ex.name,
        "title": ex.title,
        "source": rep_label,
        "side": "left",
        "camera": ex.camera,
        "plane": ex.plane,
        "focus_joint": "lShoulder",
        "metric": ex.signal.lstrip("-"),
        "target_deg": round(float(target), 1),
        "duration": duration,
        "rest": REST_OTHER_ARM,
        "keys": keys,
        "steps": steps,
        "fit": {"forearm_error_deg_mean": round(float(fit.mean()), 2), "forearm_error_deg_max": round(float(fit.max()), 2)},
        "note": "Reference motion of one healthy adult, camera-relative body-frame angles; the avatar never scores the patient.",
    }


def rep_label_of(rep: Rep, extra: str = "") -> dict:
    mv = UIPRMD_MOVEMENTS.get(int(rep.movement[1:]), rep.movement) if rep.dataset == "ui-prmd" else IRDS_GESTURES.get(int(rep.movement[1:]), rep.movement)
    return {
        "dataset": SOURCE_NAME[rep.dataset],
        "license": LICENSE[rep.dataset],
        "movement": f"{rep.movement} {mv}",
        "subject": rep.subject,
        "rep": rep.rep_id + (f" {extra}" if extra else ""),
        "arm": f"{rep.arm} column, {'mirrored to the left' if rep.arm == 'right' else 'kept left'}",
        "position": rep.position,
        "fps_original": rep.fps,
    }


def build_dataset_clip(ex: Exercise, external: Path, log) -> tuple[dict, dict]:
    """Choose the rep, segment, retarget. Returns (clip json, per-source peak populations)."""
    cands: list[Candidate] = []
    populations: dict[str, dict[str, list[float]]] = {}
    for dataset, movement in ex.range_sources:
        pop = populations.setdefault(f"{dataset}:{movement}", {"correct": [], "incorrect": [], "correct_healthy": []})
        entries = find_reps(external, dataset, movement)
        for e in entries:
            rep = load_rep(dataset, e)
            if rep.frames < 8:
                continue
            cand = candidate(rep, ex.signal)
            (pop["correct"] if rep.correct else pop["incorrect"]).append(cand.peak)
            if rep.correct and rep.healthy:
                pop["correct_healthy"].append(cand.peak)
            if dataset == ex.dataset and movement in ex.movements:
                cands.append(cand)
        log(f"  {dataset} {movement}: {len(entries)} reps")
    if not cands:
        raise FileNotFoundError(f"no repetitions for {ex.name}; run services/session/tools/fetch_rehab_datasets.py")
    best = choose(cands, ex.signal.lstrip("-"))
    c = best.curves
    s = progress_signal(c, ex.signal)
    start, peak, end = segment(s)
    ang = retarget(c)
    for k in ("lShoulder", "lElbow", "spine"):
        ang[k] = smooth(ang[k])
    extra = ""
    if ex.name == "external_rotation":
        # m09 episodes run external → internal → external; a full "out and back" needs the return
        # half of this episode followed by the outward half of the next, which is continuous in
        # the original recording. Fall back to the half rep when the next episode is missing.
        nxt = next_episode(external, best.rep)
        if nxt is not None:
            best, c, ang, start, peak, end, extra = stitch_rotation(best, nxt, ex, log)
    label = rep_label_of(best.rep, extra)
    log(f"  chosen {best.rep.dataset} {best.rep.movement} {best.rep.subject} {best.rep.rep_id} {extra} ({best.rep.arm} arm, {best.rep.position}); frames {start}-{peak}-{end} of {best.rep.frames}; peak {best.peak:.1f}°; forearm fit {ang['fit'][start:end + 1].mean():.1f}° mean")
    clip = clip_from_frames(ex, label, c, ang, start, peak, end, best.rep.fps, target=float(s[peak]) if not extra else best.peak)
    return clip, populations


def next_episode(external: Path, rep: Rep) -> Rep | None:
    if rep.dataset != "ui-prmd":
        return None
    e = int(rep.rep_id[1:]) + 1
    base = external / "ui-prmd" / ("Segmented Movements" if rep.correct else "Incorrect Segmented Movements") / "Kinect"
    p = base / "Positions" / f"{rep.movement}_{rep.subject}_e{e:02d}_positions{'' if rep.correct else '_inc'}.txt"
    a = base / "Angles" / p.name.replace("positions", "angles")
    return load_uiprmd_rep(p, a, rep.correct) if p.exists() and a.exists() else None


def concat_reps(a: Rep, b: Rep, ia: int, ib: int) -> Rep:
    """Frames [ia:] of `a` followed by frames [:ib+1] of `b`."""
    cat = lambda x, y: np.concatenate([x[ia:], y[: ib + 1]], axis=0)  # noqa: E731
    return Rep(a.dataset, a.movement, a.subject, a.rep_id, a.correct, a.healthy, a.position, a.fps,
               cat(a.hip, b.hip), cat(a.chest, b.chest), cat(a.l_sh, b.l_sh), cat(a.r_sh, b.r_sh), cat(a.sh, b.sh), cat(a.el, b.el), cat(a.wr, b.wr), a.arm)


def stitch_rotation(best: Candidate, nxt: Rep, ex: Exercise, log):
    """External rotation: from this episode's internal extreme up to its end, then the next
    episode from its start down to its internal extreme."""
    ca, cb = best.curves, curves(nxt)
    ia = int(np.argmin(ca.rotation))
    ib = int(np.argmin(cb.rotation))
    jump = float(np.abs(ca.ua[-1] - cb.ua[0]).max() + np.abs(ca.fa[-1] - cb.fa[0]).max())
    if jump > 0.25:
        log(f"  next episode {nxt.rep_id} is not continuous (jump {jump:.2f}); keeping the half repetition")
        c = ca
        s = progress_signal(c, ex.signal)
        start, peak, end = segment(s)
        ang = retarget(c)
        for k in ("lShoulder", "lElbow", "spine"):
            ang[k] = smooth(ang[k])
        return best, c, ang, start, peak, end, "(half repetition)"
    rep = concat_reps(best.rep, nxt, ia, ib)
    c = curves(rep)
    s = progress_signal(c, ex.signal)
    start, peak, end = segment(s)
    ang = retarget(c)
    for k in ("lShoulder", "lElbow", "spine"):
        ang[k] = smooth(ang[k])
    cand = Candidate(rep, c, float(s[peak]), best.jerk, (end - start + 1) / rep.fps, True, True, best.plane, best.bend)
    return cand, c, ang, start, peak, end, f"(return half) + {nxt.rep_id} (outward half)"


def pendulum_clip() -> dict:
    """Authored, not recorded: lean forward 35°, let the arm hang plumb (shoulder pitch cancels
    the lean), three gentle 10° circles at ~0.5 Hz, straighten up. Labelled procedural."""
    lean = 35.0
    keys = []
    add = lambda t, sh, el, sp, hold=False: keys.append({"t": round(t, 3), "hold": hold, "lShoulder": [round(v, 2) for v in sh], "lElbow": el, "spine": sp})  # noqa: E731
    add(0.0, [-3.0, 0.0, 4.0], [-8.0, 0.0, 0.0], [0.0, 0.0, 0.0], True)
    add(1.6, [-lean, 0.0, 4.0], [-4.0, 0.0, 0.0], [lean, 0.0, 0.0], True)
    t = 1.6
    r = 10.0
    for k in range(12):
        t += 0.5
        a = 2 * math.pi * (k + 1) / 4
        add(t, [-lean + r * math.cos(a), 0.0, 4.0 + r * math.sin(a)], [-4.0, 0.0, 0.0], [lean, 0.0, 0.0])
    add(t + 0.6, [-lean, 0.0, 4.0], [-4.0, 0.0, 0.0], [lean, 0.0, 0.0], True)
    add(t + 2.2, [-3.0, 0.0, 4.0], [-8.0, 0.0, 0.0], [0.0, 0.0, 0.0], True)
    ex = EXERCISES[-1]
    return {
        "name": ex.name, "title": ex.title,
        "source": {"dataset": "procedural", "license": LICENSE["procedural"], "movement": "authored: neither dataset records a pendulum", "subject": None, "rep": None, "arm": "left", "position": "stand", "fps_original": None},
        "side": "left", "camera": ex.camera, "plane": ex.plane, "focus_joint": "lShoulder", "metric": "elevation",
        "target_deg": lean, "duration": keys[-1]["t"], "rest": REST_OTHER_ARM, "keys": keys,
        "steps": [
            {"t": 0.0, "step": 1, "caption": f"Step 1 of 3 · {ex.captions[0]}"},
            {"t": 1.6, "step": 2, "caption": f"Step 2 of 3 · {ex.captions[1]}"},
            {"t": round(t + 0.6, 3), "step": 3, "caption": f"Step 3 of 3 · {ex.captions[2]}"},
        ],
        "fit": None,
        "note": "Authored procedurally (no dataset has a pendulum); the avatar never scores the patient.",
    }


ROTATION_DEG = {"external_rotation": 50.0, "internal_rotation": -55.0}  # forearm swing, + = outward (left arm)


def rotation_clip(ex: Exercise) -> dict:
    """Authored, not recorded: sitting, upper arm at the side, elbow at a right angle so the
    forearm points straight ahead; the forearm swings about the upper arm (shoulder rotation) out
    to 50° (external) or across toward the tummy to 55° (internal), holds, and returns.
    Labelled procedural; the check block is the rig's own FK of each key."""
    swing = ROTATION_DEG[ex.name]
    keys = []

    def add(t: float, rot: float, hold: bool = False) -> None:
        sh = np.array([0.0, rot, 0.0])
        el = np.array([-90.0, 0.0, 0.0])
        sp = np.array([0.0, 0.0, 0.0])
        ua, fa = rig_arm_directions(sh, el, sp)
        # key times sit on 30 fps frames, as the Blender avatar is keyed
        keys.append({
            "t": round(round(t * 30) / 30, 4), "hold": hold, "lShoulder": [round(float(v), 2) for v in sh], "lElbow": [round(float(v), 2) for v in el],
            "spine": [0.0, 0.0, 0.0],
            "check": {"ua": [round(float(v), 6) for v in ua], "fa": [round(float(v), 6) for v in fa],
                      "src_ua": [round(float(v), 6) for v in ua], "src_fa": [round(float(v), 6) for v in fa],
                      "elevation_deg": round(float(np.degrees(np.arccos(-ua[1]))), 1), "bend_deg": 90.0, "rotation_deg": round(rot, 1)},
        })
    add(0.0, 0.0, True)
    add(0.8, 0.0, True)
    for f in (0.25, 0.6, 0.9):
        add(0.8 + 1.4 * f, swing * (0.5 - 0.5 * math.cos(math.pi * f)))
    add(2.2, swing, True)
    add(3.2, swing, True)
    for f in (0.25, 0.6, 0.9):
        add(3.2 + 1.4 * f, swing * (0.5 + 0.5 * math.cos(math.pi * f)))
    add(4.6, 0.0, True)
    add(5.2, 0.0, True)
    return {
        "name": ex.name, "title": ex.title,
        "source": {"dataset": "procedural", "license": LICENSE["procedural"], "movement": "authored: elbow at the side, as the app instructs (the dataset rep is the 90/90 variant)", "subject": None, "rep": None, "arm": "left", "position": "sit", "fps_original": None},
        "side": "left", "camera": ex.camera, "plane": ex.plane, "focus_joint": "lShoulder", "metric": "rotation",
        "target_deg": abs(swing), "duration": keys[-1]["t"], "rest": REST_OTHER_ARM, "keys": keys,
        "steps": [
            {"t": 0.0, "step": 1, "caption": f"Step 1 of 3 · {ex.captions[0]}"},
            {"t": 0.8, "step": 2, "caption": f"Step 2 of 3 · {ex.captions[1]}"},
            {"t": 3.2, "step": 3, "caption": f"Step 3 of 3 · {ex.captions[2]}"},
        ],
        "fit": None,
        "note": "Authored procedurally to match the app's instructions (elbow at the side); the avatar never scores the patient.",
    }


def stats(values: list[float]) -> dict | None:
    if not values:
        return None
    a = np.array(values, dtype=float)
    return {"n": int(a.shape[0]), "mean": round(float(a.mean()), 1), "sd": round(float(a.std(ddof=1)), 1) if a.shape[0] > 1 else 0.0, "min": round(float(a.min()), 1), "max": round(float(a.max()), 1)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--external", default=str(DEFAULT_EXTERNAL))
    ap.add_argument("--clips", default=str(DEFAULT_CLIPS))
    ap.add_argument("--ranges", default=str(DEFAULT_RANGES))
    ap.add_argument("--only", nargs="*", default=None, help="exercise names to build (default: all)")
    args = ap.parse_args(argv)
    external, clips_dir, ranges_path = Path(args.external), Path(args.clips), Path(args.ranges)
    clips_dir.mkdir(parents=True, exist_ok=True)
    ranges_path.parent.mkdir(parents=True, exist_ok=True)
    log = lambda s: print(s, file=sys.stderr)  # noqa: E731
    ranges: dict = {
        "generated": date.today().isoformat(),
        "metric": "peak of the progress signal per repetition, degrees: elevation = upper arm from hanging straight down (Kinect body-frame, camera-relative, not goniometry); rotation = forearm about the upper-arm axis, + external",
        "note": "Healthy adults (UI-PRMD: 10 healthy subjects, incorrect = the same subjects performing deliberately suboptimal; IRDS: 14 healthy + 15 patients, incorrect = annotated incorrect executions). Not patient norms.",
        "licenses": {"ui-prmd": LICENSE["ui-prmd"], "irds": LICENSE["irds"]},
        "exercises": {},
    }
    for ex in EXERCISES:
        if args.only and ex.name not in args.only:
            continue
        log(f"{ex.name}:")
        if ex.dataset == "procedural":
            clip = pendulum_clip() if ex.name == "pendulum" else rotation_clip(ex)
            ranges["exercises"][ex.name] = {"sources": [], "note": "procedural clip; no dataset reference"}
        else:
            clip, populations = build_dataset_clip(ex, external, log)
            ranges["exercises"][ex.name] = {
                "metric": ex.signal,
                "clip_source": clip["source"],
                "target_deg": clip["target_deg"],
                "sources": [
                    {"dataset": k.split(":")[0], "movement": k.split(":")[1], "correct": stats(v["correct"]), "incorrect": stats(v["incorrect"]), "correct_healthy": stats(v["correct_healthy"])}
                    for k, v in populations.items()
                ],
            }
        (clips_dir / f"{ex.name}.json").write_text(json.dumps(clip, indent=1) + "\n")
        log(f"  wrote {clips_dir / (ex.name + '.json')} ({len(clip['keys'])} keys, {clip['duration']} s, target {clip['target_deg']}°)")
    if args.only and ranges_path.exists():  # a partial run updates its entries and keeps the rest
        merged = json.loads(ranges_path.read_text())
        merged["exercises"].update(ranges["exercises"])
        ranges = {**merged, "generated": ranges["generated"]}
    ranges_path.write_text(json.dumps(ranges, indent=1) + "\n")
    log(f"wrote {ranges_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
