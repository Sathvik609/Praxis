"""Arm out to the side on real video: REHAB24-6 Ex1 (arm abduction) through the product pipeline,
scored against motion capture (OpenCV cv2.__version__ == 5.0.0 for every frame decode, resize,
JPEG round-trip and `cv2.dnn` pose inference).

    cd services/session
    uv run python tools/fetch_rehab24.py                         # once, ~0.55 GB, git-ignored
    uv run python ../../evaluation/scripts/rehab24_eval.py       # writes results/rehab24_v0.{md,json}
    uv run python ../../evaluation/scripts/rehab24_eval.py --rescore   # reuse the cached runs

Dataset: Černek, Sedmidubsky, Budikova, *REHAB24-6: Physical Therapy Dataset for Analyzing Pose
Estimation Methods*, SISAP 2024 (Springer); Zenodo 10.5281/zenodo.13305826, CC BY-NC 4.0, used
for evaluation only (docs/LICENSES.md). 10 healthy adults in a motion-capture lab; Ex1 is
"sideways raising of the straightened right arm", 13 recordings of 9 subjects, 178 segmented
repetitions with a correct/incorrect label, two synchronised 30 fps RGB cameras (Camera17
horizontal, Camera18 vertical) and a 26-joint OptiTrack skeleton (3D, metres) also projected
into each camera (2D, px). Nothing from the dataset is written into the repo: the per-frame runs
are cached under the git-ignored `evaluation/external/rehab24_6/praxis_runs/`, and only the
aggregate numbers go to `evaluation/results/`.

**What runs.** Each video is decoded with `cv2.VideoCapture`, sub-sampled to 15 fps (every 2nd
frame, the product streams 10–15 fps), scaled to fit 640 × 480 (the product's capture size,
aspect kept), JPEG-encoded at quality 80 and decoded (what the browser sends), and passed frame by
frame to the **same `SessionPipeline`** the live and Replay sockets build: `mode="arm"`,
`exercise="abduction"`, `side="right"` (every Ex1 recording uses the right arm), every threshold at
its product default. One thing differs from a patient session: the dose is lifted to 1 × 999 so the
state machine keeps counting through recordings with up to 22 repetitions (the shipped 2 × 8 dose
would stop it after 16; the dose changes no detection logic). Timestamps are `frame_index / 30`.

**Reference angles** (per 30 fps frame; the joint files are indexed like the video frames, which is
how Segmentation.csv indexes repetitions):
  - `ref_frontal` (headline): the anatomical abduction angle: the angle between the upper arm
    (`RightArm` → `RightForeArm`) and the trunk-down vector (neck → mid-hip) after both are
    projected onto the subject's frontal plane (spanned by the shoulder-to-shoulder axis and the
    trunk axis). This is what a clinician means.
  - `ref_3d`: the same two vectors in 3D, unprojected (humeral elevation in any plane).
  - `ref_cam`: the product's own formula applied to the mocap joints projected into the camera
    that recorded the video (angle at `RightArm` between `RightForeArm` and `RightUpLeg`). It
    looks like the like-for-like reference but is not: mocap joint centres are not BlazePose's
    surface landmarks (the mocap hip joint sits much nearer the midline than the shoulder joint,
    which opens the angle by ~11° on front views), so it carries a definition gap and is reported
    for completeness only.

**Metrics.** Per-frame MAE, bias, RMSE and p95 absolute error of the product's One-Euro-smoothed
angle (`frame.arm.angles.metric_deg`, what the state machine scores) over frames where the pose was
found and the product's gate was open; Bland–Altman bias and 95 % limits per frame and per rep;
per-rep peak error; rep precision/recall/F1 of the state machine's `rep_complete` against the
labelled repetitions (one-to-one, matched when the two intervals overlap by ≥ 50 % of the shorter);
a hold-independent movement-detection F1 (a peak of the product angle, ≥ 40° and ≥ 20° of
hysteresis, inside a labelled repetition); gate closures; the lighting label; and the
correct/incorrect label against the product's lean/hike flags.

A head-visibility ablation (`--head` subjects, Camera17 front view) re-runs the pipeline with the
head masked grey and with the frame cropped below the neck, using the projected mocap joints to
place the mask and the crop line.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import platform
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np

HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "services" / "session"))
import cv2  # noqa: E402

from praxis_session.perception.arm_fsm import hike_allowance  # noqa: E402
from praxis_session.perception.pose import FRONT_SEP_MIN  # noqa: E402

DATA_DIR = ROOT / "evaluation" / "external" / "rehab24_6"
OUT_DIR = ROOT / "evaluation" / "results"
VERSION = "v0"
FPS = 30.0
STRIDE = 2  # 30 fps -> 15 fps, the top of the product's 10-15 fps stream
MAX_W, MAX_H = 640, 480
JPEG_QUALITY = 80
SIDE = "right"
EXERCISE = "abduction"
DOSE = {"sets": 1, "reps": 999}
# joints_names.txt (OptiTrack skeleton)
J = {"Hips": 0, "Neck": 3, "Head": 4, "Head_end": 5, "LeftArm": 7, "RightArm": 12, "RightForeArm": 13,
     "RightHand": 14, "LeftUpLeg": 16, "RightUpLeg": 21}
GATE_CODES = {None: 0, "turn_front": 1, "turn_side": 2, "hips_out_of_view": 3}
GATE_NAMES = {v: k for k, v in GATE_CODES.items()}
# hold-independent movement detector
PEAK_MIN_DEG = 40.0
PEAK_HYST_DEG = 20.0
OVERLAP_MIN = 0.5
# ArmFSM's fixed shoulder-hike limit until 11 Oct (fraction of trunk length over the rest
# baseline); kept as the 'before' column. Since 12 Oct the product's limit is
# `hike_allowance(angle)` (evaluation/scripts/rehab24_thresholds.py).
HIKE_LIMIT = 0.08
IN_RANGE_DEG = 100.0  # the abduction ceiling (90°) plus a 10° margin, on the anatomical reference
DATASET_CITATION = (
    "Černek, A., Sedmidubsky, J., Budikova, P.: REHAB24-6: Physical Therapy Dataset for Analyzing Pose "
    "Estimation Methods. 17th International Conference on Similarity Search and Applications (SISAP 2024), "
    "Springer LNCS. Data: Zenodo, doi:10.5281/zenodo.13305826, CC BY-NC 4.0."
)


# ---- dataset ----------------------------------------------------------------------------
@dataclass(frozen=True)
class Recording:
    video_id: str
    person: int
    lights_on: bool
    subtype: str
    reps: tuple[dict[str, Any], ...]  # each carries its own `orientation` toward Camera17

    def views(self, cam: str) -> set[str]:
        """The subject's orientations toward `cam` over the recording (front | half-profile | side)."""
        return {view_of(rp["orientation"], cam) for rp in self.reps}


def load_segmentation(path: Path, exercise_id: str = "1") -> list[Recording]:
    with open(path, newline="") as f:
        rows = [r for r in csv.DictReader(f, delimiter=";") if r["exercise_id"] == exercise_id]
    by: dict[str, list[dict[str, str]]] = {}
    for r in rows:
        by.setdefault(r["video_id"], []).append(r)
    out = []
    for vid, rs in by.items():
        r0 = rs[0]
        reps = tuple(
            {"rep": int(r["repetition_number"]), "first": int(r["first_frame"]), "last": int(r["last_frame"]),
             "orientation": r["cam17_orientation"],
             "correct": r["correctness"] == "1", "mocap_erroneous": r["mocap_erroneous"] == "1",
             "extra17": int(r["extra_person_in_cam17"]), "extra18": int(r["extra_person_in_cam18"])}
            for r in sorted(rs, key=lambda r: int(r["repetition_number"]))
        )
        out.append(Recording(vid, int(r0["person_id"]), r0["lights_on"] == "1", r0["exercise_subtype"], reps))
    return out


def video_path(root: Path, vid: str, cam: str) -> Path:
    return root / "videos" / "Ex1" / (f"{vid}-Camera17-30fps.mp4" if cam == "c17" else f"{vid}-Camera18-30fps-transposed.mp4")


# ---- angle maths ------------------------------------------------------------------------
def angle_between(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Row-wise angle in degrees between vectors a and b (..., d); NaN where either is ~0."""
    na, nb = np.linalg.norm(a, axis=-1), np.linalg.norm(b, axis=-1)
    with np.errstate(invalid="ignore", divide="ignore"):
        c = np.einsum("...i,...i->...", a, b) / (na * nb)
    out = np.degrees(np.arccos(np.clip(c, -1.0, 1.0)))
    return np.where((na < 1e-9) | (nb < 1e-9), np.nan, out)


def ref_angles_3d(j3d: np.ndarray) -> dict[str, np.ndarray]:
    """(T, 26, ≥3) mocap joints (metres, y up) -> right-arm `ref_3d` and `ref_frontal` (deg)."""
    p = j3d[..., :3].astype(np.float64)
    sh, el = p[:, J["RightArm"]], p[:, J["RightForeArm"]]
    neck = p[:, J["Neck"]]
    hip_mid = (p[:, J["LeftUpLeg"]] + p[:, J["RightUpLeg"]]) / 2.0
    arm, down = el - sh, hip_mid - neck
    lr = p[:, J["LeftArm"]] - sh  # right -> left shoulder
    up = -down
    n = np.cross(lr, up)  # frontal-plane normal (forward or backward; the sign does not matter)
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-9)

    def proj(v: np.ndarray) -> np.ndarray:
        return v - np.einsum("ti,ti->t", v, n)[:, None] * n

    trunk_len = np.maximum(np.linalg.norm(down, axis=-1), 1e-9)
    rise = (sh[:, 1] - p[:, J["LeftArm"], 1]) / trunk_len  # + = right shoulder higher (y up)
    return {"ref_3d": angle_between(arm, down), "ref_frontal": angle_between(proj(arm), proj(down)), "shoulder_rise": rise}


def ref_angle_cam(j2d: np.ndarray) -> np.ndarray:
    """The product's formula (`pose.shoulder_elevation_deg`, right side) on projected mocap
    joints (T, 26, 2): image-plane angle at the shoulder between elbow and same-side hip."""
    sh = j2d[:, J["RightArm"]]
    return angle_between(j2d[:, J["RightForeArm"]] - sh, j2d[:, J["RightUpLeg"]] - sh)


# ---- metrics ----------------------------------------------------------------------------
def err_stats(pred: np.ndarray, ref: np.ndarray) -> dict[str, Any]:
    """MAE / bias / RMSE / p95 |err| / Bland–Altman 95 % limits of pred − ref over finite pairs."""
    m = np.isfinite(pred) & np.isfinite(ref)
    d = (pred - ref)[m]
    if d.size == 0:
        return {"n": 0, "mae": None, "bias": None, "rmse": None, "p95_abs": None, "loa_low": None, "loa_high": None, "sd": None}
    sd = float(np.std(d, ddof=1)) if d.size > 1 else 0.0
    bias = float(np.mean(d))
    return {
        "n": int(d.size),
        "mae": round(float(np.mean(np.abs(d))), 2),
        "bias": round(bias, 2),
        "rmse": round(float(np.sqrt(np.mean(d**2))), 2),
        "p95_abs": round(float(np.percentile(np.abs(d), 95)), 2),
        "sd": round(sd, 2),
        "loa_low": round(bias - 1.96 * sd, 2),
        "loa_high": round(bias + 1.96 * sd, 2),
    }


def prf(tp: int, fp: int, fn: int) -> dict[str, Any]:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "precision": round(p, 4), "recall": round(r, 4),
            "f1": round(2 * p * r / (p + r), 4) if p + r else 0.0}


def match_intervals(pred: list[tuple[float, float]], labels: list[tuple[float, float]],
                    min_overlap: float = OVERLAP_MIN) -> list[tuple[int, int]]:
    """One-to-one matching of predicted to labelled intervals, largest overlap first. A pair
    counts when the overlap is ≥ `min_overlap` × the shorter interval. Returns (pred_i, label_j)."""
    cands = []
    for i, (a0, a1) in enumerate(pred):
        for j, (b0, b1) in enumerate(labels):
            ov = min(a1, b1) - max(a0, b0)
            short = max(min(a1 - a0, b1 - b0), 1e-9)
            if ov > 0 and ov / short >= min_overlap:
                cands.append((ov / short, ov, i, j))
    cands.sort(reverse=True)
    used_p: set[int] = set()
    used_l: set[int] = set()
    pairs = []
    for _, _, i, j in cands:
        if i in used_p or j in used_l:
            continue
        used_p.add(i)
        used_l.add(j)
        pairs.append((i, j))
    return sorted(pairs)


def match_points(times: list[float], labels: list[tuple[float, float]]) -> list[tuple[int, int]]:
    """One-to-one: a detected movement peak matches the labelled repetition containing it
    (the earliest unused peak per repetition)."""
    pairs, used = [], set()
    for j, (b0, b1) in enumerate(labels):
        for i, t in enumerate(times):
            if i not in used and b0 <= t <= b1:
                used.add(i)
                pairs.append((i, j))
                break
    return pairs


def detect_movements(t: np.ndarray, a: np.ndarray, min_peak: float = PEAK_MIN_DEG,
                     hyst: float = PEAK_HYST_DEG) -> list[dict[str, float]]:
    """Hold-independent lift detector on an angle trace (NaN = no pose, skipped): a lift is a
    rise of ≥ `hyst` from the running minimum to a peak ≥ `min_peak` followed by a fall of
    ≥ `hyst`. Returns [{t_peak, peak}] in time order."""
    out: list[dict[str, float]] = []
    lo, hi, t_hi, rising = math.inf, -math.inf, 0.0, False
    for ti, ai in zip(t, a):
        if not np.isfinite(ai):
            continue
        if not rising:
            lo = min(lo, ai)
            if ai >= lo + hyst and ai >= min_peak:
                rising, hi, t_hi = True, ai, ti
        else:
            if ai > hi:
                hi, t_hi = ai, ti
            elif ai <= hi - hyst:
                out.append({"t_peak": float(t_hi), "peak": float(hi)})
                rising, lo = False, ai
    return out


def lag_s(t: np.ndarray, pred: np.ndarray, ref: np.ndarray, max_lag: int = 15) -> float | None:
    """Lag (s, + = prediction behind the reference) maximising the correlation of the two traces
    sampled on the same frames (`max_lag` samples either way)."""
    m = np.isfinite(pred) & np.isfinite(ref)
    if m.sum() < 60:
        return None
    p, r = np.where(m, pred, np.nan), np.where(m, ref, np.nan)
    best, best_k = -2.0, 0
    for k in range(-max_lag, max_lag + 1):
        a, b = (p[k:], r[: len(r) - k]) if k >= 0 else (p[:k], r[-k:])
        mm = np.isfinite(a) & np.isfinite(b)
        if mm.sum() < 60:
            continue
        c = float(np.corrcoef(a[mm], b[mm])[0, 1])
        if c > best:
            best, best_k = c, k
    dt_ = float(np.median(np.diff(t))) if len(t) > 1 else 1 / FPS
    return round(best_k * dt_, 3)


# ---- running the product ----------------------------------------------------------------
def to_product_frame(frame: np.ndarray) -> np.ndarray:
    """Scale to fit 640 × 480 (aspect kept) and JPEG round-trip at q80, like the browser."""
    h, w = frame.shape[:2]
    s = min(MAX_W / w, MAX_H / h, 1.0)
    if s < 1.0:
        frame = cv2.resize(frame, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR) if ok else frame


def head_box(j2d_row: np.ndarray, pad: float = 0.45) -> tuple[int, int, int, int]:
    """Box covering the head from the projected Neck / Head / Head_end joints (px, orig frame):
    width and height grow with the neck-to-head-top distance; the bottom stops at the neck."""
    neck, top = j2d_row[J["Neck"]], j2d_row[J["Head_end"]]
    size = float(np.linalg.norm(top - neck))
    cx = float((neck[0] + top[0]) / 2)
    x0, x1 = cx - (0.5 + pad) * size, cx + (0.5 + pad) * size
    y0 = float(min(neck[1], top[1]) - pad * size)
    y1 = float(neck[1])
    return int(x0), int(y0), int(math.ceil(x1)), int(math.ceil(y1))


def make_variant(name: str, j2d: np.ndarray | None) -> Callable[[np.ndarray, int], np.ndarray] | None:
    if name == "orig":
        return None
    assert j2d is not None
    if name == "head_masked":
        def mask(frame: np.ndarray, i: int) -> np.ndarray:
            if i >= len(j2d):
                return frame
            x0, y0, x1, y1 = head_box(j2d[i])
            h, w = frame.shape[:2]
            out = frame.copy()
            out[max(0, y0):min(h, y1), max(0, x0):min(w, x1)] = (128, 128, 128)
            return out
        return mask
    if name == "head_cropped":
        # one crop line per video (a moving crop would shake the image): the median neck height
        y_cut = int(np.nanmedian(j2d[:, J["Neck"], 1]))

        def crop(frame: np.ndarray, i: int) -> np.ndarray:
            return frame[max(0, y_cut):]
        return crop
    raise ValueError(name)


def run_product(video: Path, transform: Callable[[np.ndarray, int], np.ndarray] | None = None,
                stride: int = STRIDE, max_frames: int | None = None) -> dict[str, Any]:
    """Replay one video through the product's SessionPipeline; per-frame arrays + events."""
    from praxis_session.pipeline import SessionPipeline
    from praxis_session.perception.pose import shoulder_elevation_deg, PoseResult

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {video}")
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or FPS
    pipe = SessionPipeline(mode="arm", sheet="none", use_hand=False, side=SIDE, exercise=EXERCISE, **DOSE)
    if pipe._pose is None:
        raise RuntimeError("pose model missing: run `uv run python tools/fetch_models.py`")
    idx, present, smooth, raw, gate, vis = [], [], [], [], [], []
    sep, lean, hike, lms = [], [], [], []
    events: list[dict[str, Any]] = []
    size = None
    i = 0
    t0 = time.perf_counter()
    while True:
        if i % stride:
            if not cap.grab():
                break
            i += 1
            continue
        ok, frame = cap.read()
        if not ok or frame is None:
            break
        if max_frames is not None and i >= max_frames:
            break
        if transform is not None:
            frame = transform(frame, i)
        frame = to_product_frame(frame)
        size = frame.shape[1], frame.shape[0]
        for e in pipe.process(frame, i / fps, i):
            if e.type != "frame":
                events.append(e.to_dict())
                continue
            arm, pose = e.payload["arm"], e.payload["pose"]
            ang = arm.get("angles")
            idx.append(i)
            present.append(bool(pose.get("present")))
            gate.append(GATE_CODES.get(arm.get("gate"), 9))
            if ang is None:
                smooth.append(np.nan)
                raw.append(np.nan)
                vis.append(np.nan)
                sep.append(np.nan)
                lean.append(np.nan)
                hike.append(np.nan)
                lms.append(np.full((33, 2), np.nan, np.float32))
            else:
                smooth.append(float(ang["metric_deg"]))
                lm = np.asarray(pose["landmarks_px"], np.float32)
                res = PoseResult(landmarks_px=lm, visibility=np.ones(33, np.float32), world=np.zeros((33, 3), np.float32), conf=1.0)
                raw.append(float(shoulder_elevation_deg(res, SIDE)))
                vis.append(float(ang["visibility"]))
                sep.append(float(ang["shoulder_sep_norm"]))
                lean.append(float(ang["trunk_lean_deg"]))
                hike.append(float(ang["shoulder_hike_norm"]))
                lms.append(lm)
        i += 1
    cap.release()
    return {
        "frame_idx": np.asarray(idx, np.int32), "present": np.asarray(present, bool),
        "angle": np.asarray(smooth, np.float64), "angle_raw": np.asarray(raw, np.float64),
        "gate": np.asarray(gate, np.int8), "visibility": np.asarray(vis, np.float64),
        "sep": np.asarray(sep, np.float64), "lean": np.asarray(lean, np.float64), "hike": np.asarray(hike, np.float64),
        "landmarks": np.asarray(lms, np.float32).reshape(-1, 33, 2),
        "events": events, "fps": fps, "frames_total": i, "size": size,
        "wall_s": round(time.perf_counter() - t0, 1),
    }


def pipeline_fingerprint() -> str:
    """Short SHA-256 over the sources that turn a frame into the scored angle and events, so a
    cached run is reused only by the code that produced it."""
    import hashlib

    base = ROOT / "services" / "session" / "praxis_session"
    h = hashlib.sha256()
    for rel in ("perception/pose.py", "perception/arm_fsm.py", "perception/exercises.py", "perception/zoo/mp_pose.py",
                "perception/zoo/mp_persondet.py", "pipeline.py"):
        h.update((base / rel).read_bytes())
    return h.hexdigest()[:12]


FINGERPRINT = pipeline_fingerprint()


def _cache_path(cache: Path, vid: str, cam: str, variant: str, fingerprint: str | None = None) -> Path:
    return cache / f"{vid}-{cam}-{variant}-s{STRIDE}-{fingerprint or FINGERPRINT}.npz"


def _run_job(job: tuple[str, str, str, str, str]) -> str:
    """Worker: run one (video, camera, variant) and cache it as .npz (numbers only)."""
    data_dir, cache_dir, vid, cam, variant = job
    data, cache = Path(data_dir), Path(cache_dir)
    cv2.setNumThreads(2)
    j2d = np.load(data / "2d_joints" / "Ex1" / f"{vid}-{cam}-30fps.npy") if variant != "orig" else None
    run = run_product(video_path(data, vid, cam), make_variant(variant, j2d))
    out = _cache_path(cache, vid, cam, variant)
    np.savez_compressed(
        out, frame_idx=run["frame_idx"], present=run["present"], angle=run["angle"], angle_raw=run["angle_raw"],
        gate=run["gate"], visibility=run["visibility"], sep=run["sep"], lean=run["lean"], hike=run["hike"],
        landmarks=run["landmarks"],
        meta=np.array(json.dumps({"events": run["events"], "fps": run["fps"], "frames_total": run["frames_total"],
                                  "size": run["size"], "wall_s": run["wall_s"], "cv2": cv2.__version__,
                                  "stride": STRIDE, "variant": variant})),
    )
    return f"{vid} {cam} {variant}: {len(run['frame_idx'])} frames in {run['wall_s']} s"


def load_run(cache: Path, vid: str, cam: str, variant: str, fingerprint: str | None = None) -> dict[str, Any]:
    z = np.load(_cache_path(cache, vid, cam, variant, fingerprint), allow_pickle=False)
    meta = json.loads(str(z["meta"]))
    n = len(z["frame_idx"])
    return {k: (z[k] if k in z.files else np.full(n, np.nan)) for k in
            ("frame_idx", "present", "angle", "angle_raw", "gate", "visibility", "sep", "lean", "hike")} | meta


# ---- scoring one run --------------------------------------------------------------------
def view_of(orientation: str, cam: str) -> str:
    """The subject's orientation toward `cam` given its orientation toward Camera17
    (Segmentation.txt: Camera18 is orthogonal, so front <-> side swap and half-profile stays)."""
    if cam == "c17":
        return orientation
    return {"front": "side", "side": "front"}.get(orientation, orientation)


def assign_views(times: list[float], labels: list[tuple[float, float]], views: list[str]) -> list[str]:
    """The view of each predicted time: the labelled repetition containing it, else the nearest
    one (a recording can switch orientation halfway, so predictions are split by time)."""
    out = []
    for t in times:
        best, dist = views[0], float("inf")
        for (b0, b1), v in zip(labels, views):
            d = 0.0 if b0 <= t <= b1 else min(abs(t - b0), abs(t - b1))
            if d < dist:
                best, dist = v, d
        out.append(best)
    return out


def score_run(rec: Recording, cam: str, run: dict[str, Any], refs: dict[str, np.ndarray]) -> list[dict[str, Any]]:
    """Score one product run; one row per subject orientation toward this camera (Segmentation.csv
    labels orientation per repetition and five Ex1 recordings turn from front to half-profile
    halfway through)."""
    fi = run["frame_idx"]
    n_ref = len(refs["ref_frontal"])
    keep = fi < n_ref
    fi = fi[keep]
    t = fi / FPS
    pred, pred_raw = run["angle"][keep], run["angle_raw"][keep]
    present, gate = run["present"][keep], run["gate"][keep]
    sep, hike = run["sep"][keep], run["hike"][keep]
    open_ = present & (gate == 0)
    r = {k: v[fi] for k, v in refs.items()}
    # shoulder-hike baselines at rest (the FSM takes its own from its first start-pose frames)
    rest = present & (r["ref_frontal"] < 30.0)
    hike_rel = hike - (float(np.nanmedian(hike[rest])) if rest.any() else 0.0)
    rise_rel = r["shoulder_rise"] - (float(np.nanmedian(r["shoulder_rise"][rest])) if rest.any() else 0.0)
    all_labels = [(rp["first"] / FPS, rp["last"] / FPS) for rp in rec.reps]
    rep_views = [view_of(rp["orientation"], cam) for rp in rec.reps]
    fsm_all = [e for e in run["events"] if e["type"] == "rep_complete"]
    fsm_views = assign_views([(e["t_start"] + e["t_end"]) / 2 for e in fsm_all], all_labels, rep_views)
    mv_all = detect_movements(t, np.where(present, pred, np.nan))
    mv_views = assign_views([x["t_peak"] for x in mv_all], all_labels, rep_views)
    mvo_all = detect_movements(t, np.where(open_, pred, np.nan))
    mvo_views = assign_views([x["t_peak"] for x in mvo_all], all_labels, rep_views)
    other_events = [e for e in run["events"] if e["type"] != "rep_complete"]
    ev_views = assign_views([float(e["t"]) for e in other_events], all_labels, rep_views)
    rows = []
    for view in sorted(set(rep_views)):
        reps = [rp for rp, v in zip(rec.reps, rep_views) if v == view]
        labels = [(rp["first"] / FPS, rp["last"] / FPS) for rp in reps]
        span = np.zeros_like(open_)
        for rp in reps:
            span |= (fi >= rp["first"]) & (fi <= rp["last"])
        m = open_ & span
        row: dict[str, Any] = {
            "video": rec.video_id, "person": rec.person, "camera": cam, "view": view,
            "lights_on": rec.lights_on, "labelled_reps": len(reps), "frames_in_reps": int(span.sum()),
            "pose_rate": round(float(present[span].mean()), 4) if span.any() else None,
            "gate_open_rate": round(float(open_[span].mean()), 4) if span.any() else None,
            "gates": {GATE_NAMES.get(int(c), str(c)) or "open": int(((gate == c) & present & span).sum()) for c in np.unique(gate[span])},
            "no_pose_frames": int((~present & span).sum()),
            "size": run.get("size"),
        }
        row["frame"] = {ref: err_stats(np.where(m, pred, np.nan), r[ref]) for ref in ("ref_cam", "ref_frontal", "ref_3d")}
        row["frame_raw"] = {ref: err_stats(np.where(m, pred_raw, np.nan), r[ref]) for ref in ("ref_cam", "ref_frontal")}
        row["lag_s"] = lag_s(t, np.where(m, pred, np.nan), r["ref_cam"])
        row["lag_raw_s"] = lag_s(t, np.where(m, pred_raw, np.nan), r["ref_cam"])
        # first frame over the old fixed limit / over the product's angle-aware allowance (one
        # frame, rest-median baseline: a frame-level view; the FSM's own flags are in `events`)
        allow = np.array([hike_allowance(x) if np.isfinite(x) else np.inf for x in pred])
        row["hike_first_deg"], row["hike_allow_first_deg"] = [], []
        for rp in reps:
            inside = m & (fi >= rp["first"]) & (fi <= rp["last"])
            w = np.where(inside & (hike_rel > HIKE_LIMIT))[0]
            row["hike_first_deg"].append(float(r["ref_frontal"][w[0]]) if len(w) else None)
            w = np.where(inside & (hike_rel > allow))[0]
            row["hike_allow_first_deg"].append(float(r["ref_frontal"][w[0]]) if len(w) else None)
        row["_pairs"] = {"pred": pred[m].tolist(), "pred_raw": pred_raw[m].tolist(), "sep": sep[present & span].tolist(),
                         "hike": hike_rel[m].tolist(), "rise": rise_rel[m].tolist(),
                         **{ref: r[ref][m].tolist() for ref in ("ref_cam", "ref_frontal", "ref_3d")}}
        # per-rep peaks over open frames inside each labelled repetition
        peaks = []
        for rp in reps:
            allw = (fi >= rp["first"]) & (fi <= rp["last"])
            w = m & allw
            if w.sum() < max(3, 0.5 * allw.sum()):
                peaks.append(None)
                continue
            peaks.append({"rep": rp["rep"], "correct": rp["correct"], "pred": float(np.max(pred[w])),
                          **{ref: float(np.nanmax(r[ref][allw])) for ref in ("ref_cam", "ref_frontal", "ref_3d")}})
        row["rep_peaks"] = peaks
        # state machine reps (verified or not), matched by interval overlap
        fsm = [e for e, v in zip(fsm_all, fsm_views) if v == view]
        pairs = match_intervals([(e["t_start"], e["t_end"]) for e in fsm], labels)
        row["fsm"] = prf(len(pairs), len(fsm) - len(pairs), len(labels) - len(pairs))
        row["fsm"]["verified"] = sum(1 for e in fsm if e.get("verified"))
        reasons: dict[str, int] = {}
        for e in fsm:
            k = "verified" if e.get("verified") else str(e.get("reason"))
            reasons[k] = reasons.get(k, 0) + 1
        row["fsm"]["reasons"] = reasons
        row["fsm"]["above_ceiling"] = sum(1 for e in fsm if e.get("above_ceiling"))
        row["fsm_peak_err"] = {ref: [fsm[i]["peak_deg"] - peaks[j][ref] for i, j in pairs if peaks[j]] for ref in ("ref_cam", "ref_frontal")}
        matched = {j: i for i, j in pairs}
        row["compensation"] = [
            {"correct": rp["correct"], "matched": j in matched,
             "lean": bool(j in matched and fsm[matched[j]].get("lean")),
             "hike": bool(j in matched and fsm[matched[j]].get("hike"))}
            for j, rp in enumerate(reps)
        ]
        # hold-independent movement detection on the same product angle (gate ignored: the signal)
        mv = [x for x, v in zip(mv_all, mv_views) if v == view]
        mp = match_points([x["t_peak"] for x in mv], labels)
        row["movement"] = prf(len(mp), len(mv) - len(mp), len(labels) - len(mp))
        mvo = [x for x, v in zip(mvo_all, mvo_views) if v == view]
        mpo = match_points([x["t_peak"] for x in mvo], labels)
        row["movement_gated"] = prf(len(mpo), len(mvo) - len(mpo), len(labels) - len(mpo))
        evs = [e for e, v in zip(other_events, ev_views) if v == view]
        row["events"] = {k: sum(1 for e in evs if e["type"] == k) for k in
                         ("compensation_lean", "shoulder_hiking", "above_ceiling", "perception_lost", "setup_blocked",
                          "target_missed", "hold_too_short")}
        rows.append(row)
    return rows


# ---- aggregation ------------------------------------------------------------------------
def aggregate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {}
    cat = {ref: np.asarray([x for r in rows for x in r["_pairs"][ref]], np.float64) for ref in ("ref_cam", "ref_frontal", "ref_3d")}
    pred = np.asarray([x for r in rows for x in r["_pairs"]["pred"]], np.float64)
    pred_raw = np.asarray([x for r in rows for x in r["_pairs"]["pred_raw"]], np.float64)
    peaks = [p for r in rows for p in r["rep_peaks"] if p]
    pk = {ref: err_stats(np.asarray([p["pred"] for p in peaks]), np.asarray([p[ref] for p in peaks])) for ref in ("ref_cam", "ref_frontal", "ref_3d")}
    span = sum(r["frames_in_reps"] for r in rows)
    pose_frames = sum(round((r["pose_rate"] or 0) * r["frames_in_reps"]) for r in rows)
    gates: dict[str, int] = {}
    for r in rows:
        for k, v in r["gates"].items():
            gates[k] = gates.get(k, 0) + v
    out = {
        "recordings": len(rows), "subjects": len({r["person"] for r in rows}),
        "labelled_reps": sum(r["labelled_reps"] for r in rows),
        "frames_in_reps": span,
        "pose_rate": round(pose_frames / span, 4) if span else None,
        "gate_open_rate": round(sum(round((r["gate_open_rate"] or 0) * r["frames_in_reps"]) for r in rows) / span, 4) if span else None,
        "gate_frames": gates,
        "frame": {ref: err_stats(pred, cat[ref]) for ref in cat},
        # stratified by the anatomical reference: inside the prescribed range (≤ 90° ceiling +
        # 10° margin) versus overhead, which the product never asks for but Ex1 subjects did
        "frame_in_range": {ref: err_stats(np.where(cat["ref_frontal"] <= IN_RANGE_DEG, pred, np.nan), cat[ref]) for ref in ("ref_cam", "ref_frontal")},
        "frame_overhead": {ref: err_stats(np.where(cat["ref_frontal"] > IN_RANGE_DEG, pred, np.nan), cat[ref]) for ref in ("ref_cam", "ref_frontal")},
        "frame_raw_in_range": {ref: err_stats(np.where(cat["ref_frontal"] <= IN_RANGE_DEG, pred_raw, np.nan), cat[ref]) for ref in ("ref_cam", "ref_frontal")},
        "frame_raw": {ref: err_stats(pred_raw, cat[ref]) for ref in ("ref_cam", "ref_frontal")},
        "rep_peak": pk, "rep_peak_n": len(peaks),
        "peak_range": ({"min": round(min(p["ref_frontal"] for p in peaks), 1), "max": round(max(p["ref_frontal"] for p in peaks), 1),
                        "p50": round(float(np.median([p["ref_frontal"] for p in peaks])), 1),
                        "correct_min": round(min((p["ref_frontal"] for p in peaks if p["correct"]), default=float("nan")), 1)} if peaks else {}),
        "fsm": prf(*(sum(r["fsm"][k] for r in rows) for k in ("tp", "fp", "fn"))),
        "fsm_verified": sum(r["fsm"]["verified"] for r in rows),
        "fsm_reasons": _sum_dicts([r["fsm"]["reasons"] for r in rows]),
        "fsm_peak_err": {ref: err_stats(np.asarray([x for r in rows for x in r["fsm_peak_err"][ref]], np.float64),
                                        np.zeros(sum(len(r["fsm_peak_err"][ref]) for r in rows))) for ref in ("ref_cam", "ref_frontal")},
        "movement": prf(*(sum(r["movement"][k] for r in rows) for k in ("tp", "fp", "fn"))),
        "movement_gated": prf(*(sum(r["movement_gated"][k] for r in rows) for k in ("tp", "fp", "fn"))),
        "lag_s_median": _median([r["lag_s"] for r in rows]),
        "lag_raw_s_median": _median([r["lag_raw_s"] for r in rows]),
        # how far the product's camera-plane formula on mocap joint centres sits from anatomical
        # abduction on the same frames (a definition gap, not a landmark error)
        "ref_cam_minus_frontal": err_stats(cat["ref_cam"], cat["ref_frontal"]),
        "shoulder_sep": _pcts([x for r in rows for x in r["_pairs"]["sep"]]),
        "hike_bands": _hike_bands(rows),
        "hike_first_deg": _pcts([x for r in rows for x in r["hike_first_deg"] if x is not None]),
        "hike_first_below_90": sum(1 for r in rows for x in r["hike_first_deg"] if x is not None and x < 90.0),
        "hike_reps": sum(len(r["hike_first_deg"]) for r in rows),
        "hike_allow_first_deg": _pcts([x for r in rows for x in r.get("hike_allow_first_deg", []) if x is not None]),
        "hike_allow_first_below_90": sum(1 for r in rows for x in r.get("hike_allow_first_deg", []) if x is not None and x < 90.0),
        "hike_flagged_reps": sum(1 for r in rows for c in r["compensation"] if c["hike"]),
        "hike_flagged_correct": sum(1 for r in rows for c in r["compensation"] if c["hike"] and c["correct"]),
        "correct_matched": sum(1 for r in rows for c in r["compensation"] if c["matched"] and c["correct"]),
        "events": _sum_dicts([r["events"] for r in rows]),
    }
    return out


def _pcts(xs: list[float]) -> dict[str, Any]:
    v = np.asarray([x for x in xs if x is not None and np.isfinite(x)], np.float64)
    if v.size == 0:
        return {"n": 0}
    q = np.percentile(v, [5, 25, 50, 75, 95])
    return {"n": int(v.size), "p5": round(float(q[0]), 3), "p25": round(float(q[1]), 3), "p50": round(float(q[2]), 3),
            "p75": round(float(q[3]), 3), "p95": round(float(q[4]), 3)}


HIKE_BANDS = ((0, 60), (60, 80), (80, 95), (95, 120), (120, 180))


def _hike_bands(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Product shoulder-hike (vs rest) and the mocap shoulder-joint rise, by anatomical angle."""
    a = np.asarray([x for r in rows for x in r["_pairs"]["ref_frontal"]], np.float64)
    h = np.asarray([x for r in rows for x in r["_pairs"]["hike"]], np.float64)
    m = np.asarray([x for r in rows for x in r["_pairs"]["rise"]], np.float64)
    p = np.asarray([x for r in rows for x in r["_pairs"]["pred"]], np.float64)
    allow = np.array([hike_allowance(x) if np.isfinite(x) else np.inf for x in p])
    out = []
    for lo, hi in HIKE_BANDS:
        b = (a >= lo) & (a < hi) & np.isfinite(h) & np.isfinite(m)
        if not b.any():
            continue
        out.append({"band": f"{lo}–{hi}°", "n": int(b.sum()), "product_p50": round(float(np.median(h[b])), 3),
                    "product_p90": round(float(np.percentile(h[b], 90)), 3), "mocap_p50": round(float(np.median(m[b])), 3),
                    "mocap_p90": round(float(np.percentile(m[b], 90)), 3),
                    "frac_over_limit": round(float(np.mean(h[b] > HIKE_LIMIT)), 3),
                    "frac_over_allowance": round(float(np.mean(h[b] > allow[b])), 3)})
    return out


def _median(xs: list[float | None]) -> float | None:
    v = [x for x in xs if x is not None]
    return round(float(np.median(v)), 3) if v else None


def _sum_dicts(ds: list[dict[str, int]]) -> dict[str, int]:
    out: dict[str, int] = {}
    for d in ds:
        for k, v in d.items():
            out[k] = out.get(k, 0) + v
    return out


def compensation_table(rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    tab = {"correct": {"flagged": 0, "not_flagged": 0, "no_rep": 0}, "incorrect": {"flagged": 0, "not_flagged": 0, "no_rep": 0}}
    for r in rows:
        for c in r["compensation"]:
            k = "correct" if c["correct"] else "incorrect"
            col = "no_rep" if not c["matched"] else ("flagged" if (c["lean"] or c["hike"]) else "not_flagged")
            tab[k][col] += 1
    return tab


# ---- report -----------------------------------------------------------------------------
def _f(x: Any, unit: str = "") -> str:
    return "–" if x is None else f"{x}{unit}"


def _stat_row(label: str, s: dict[str, Any], n_unit: str = "") -> str:
    return (f"| {label} | {s['n']}{n_unit} | {_f(s['mae'], '°')} | {_f(s['bias'], '°')} | {_f(s['rmse'], '°')} | "
            f"{_f(s['p95_abs'], '°')} | {_f(s['loa_low'])}° to {_f(s['loa_high'])}° |")


def _headline_line(name: str, a: dict[str, Any]) -> str:
    fr, pk = a["frame"]["ref_frontal"], a["rep_peak"]["ref_frontal"]
    return (f"| {name} | {a['recordings']} / {a['subjects']} | {a['labelled_reps']} | {_pct(a['pose_rate'])} | {_pct(a['gate_open_rate'])} | "
            f"{_f(fr['mae'], '°')} / {_f(fr['bias'], '°')} [{_f(fr['loa_low'])}, {_f(fr['loa_high'])}] (n={fr['n']}) | "
            f"{_f(pk['mae'], '°')} / {_f(pk['bias'], '°')} (n={pk['n']}) | "
            f"{a['fsm']['f1']} ({a['fsm']['precision']} / {a['fsm']['recall']}) | {a['movement']['f1']} ({a['movement']['precision']} / {a['movement']['recall']}) |")


def _pct(x: float | None) -> str:
    return "–" if x is None else f"{100 * x:.1f} %"


def write_report(res: dict[str, Any], out: Path) -> None:
    c = res["conditions"]
    a = c.get("front") or {}
    md: list[str] = [
        "# REHAB24-6 arm abduction: Arm out to the side on real video", "",
        f"`{res['name']}` · regenerated by `evaluation/scripts/rehab24_eval.py` on {res['generated_on']} (OpenCV {res['cv2_version']}, "
        f"Python {res['python']}, {res['host']}); pipeline fingerprint `{res['pipeline_fingerprint']}` (SHA-256 of the perception "
        f"sources that produce the angle). **Do not hand-edit**: every number is in `{res['name']}.json`.", "",
        *([f"> **Superseded numbers.** This file scores cached runs of an older pipeline (fingerprint `{res['pipeline_fingerprint']}`, "
             f"before the pose fixes) and is kept only as the 'before' of the comparison in `rehab24_{VERSION}.md`.", ""]
          if res["pipeline_fingerprint"] != FINGERPRINT else []),
        "## Honest reading", "",
        "- **Real RGB video of 9 healthy adults (25–50 y) in a motion-capture lab, against a motion-capture reference.** These are the "
        "first real-video numbers for Arm out to the side. The subjects are not patients. The cameras are lab cameras in the corners "
        "of an 8.2 × 7 m room, several metres from a standing subject in a black mocap suit: Camera17 with the subject facing it is "
        "close to our front view, but it is **not a laptop webcam at chest height 1.5–2 m away**, and nobody is seated.",
        "- The headline reference is anatomical abduction in the subject's frontal plane (`ref_frontal`). Our angle is a 2D, "
        "camera-relative number, so this agreement holds for a front-on view; off-axis views are reported separately and are worse.",
        "- Ex1's lifts go overhead (front-view rep peaks "
        f"{_f(a.get('peak_range', {}).get('min'))}–{_f(a.get('peak_range', {}).get('max'))}°, median {_f(a.get('peak_range', {}).get('p50'))}°; "
        f"every rep labelled correct ≥ {_f(a.get('peak_range', {}).get('correct_min'))}°), past "
        "the 90° the product prescribes, and no repetition holds for 3 s. So the product counts the reps but marks most of them "
        "**unverified (`hold_too_short`) by design** and raises `above_ceiling`. The rep F1 counts every rep the product reported, "
        "verified or not; the movement F1 drops the hold rule.",
        ("- The angle, rep logic and lean thresholds were **not** tuned on this data. Two pose-stage defects it exposed were fixed "
         "(below), and two thresholds were set from it on 12 Oct (`rehab24_thresholds_v0.md`): the shoulder-hike limit became an "
         "angle-aware allowance fitted on four subjects and checked on four held-out ones, and the front-view gate moved from 0.6 to "
         f"{FRONT_SEP_MIN} trunk lengths using each subject's yaw recovered from the mocap. Those two are **in-sample here** (the gate "
         "and half of the hike subjects); the before/after tables show what each change did."
         if res["pipeline_fingerprint"] == FINGERPRINT else
         "- These are the numbers **before** the pose fixes; separation and shoulder-hike data were not cached by that run."),
        "",
    ]
    if res.get("compare"):
        b = res["compare"]
        md += ["## Before and after the pose fixes (front view)", "",
               f"`{b['name']}` = the code before the fixes (fingerprint `{b['pipeline_fingerprint']}`), scored identically. The fixes, "
               "both in `services/session/praxis_session/perception/pose.py` and tested in `tests/test_pose.py`: (1) **region tracking**: "
               "MediaPipe's own policy (the next frame's region comes from the previous landmarks' alignment points; the person "
               "detector runs only when tracking is lost) instead of a fresh detector region every frame, whose mid-hip keypoint "
               "lands on the chest when the arm goes overhead and collapsed the skeleton onto the face; (2) **region scale 1.25**, "
               "as MediaPipe crops (the OpenCV Zoo port crops at 1.0 and cut off a raised arm). A third defect, a crash, is fixed too: "
               "a region wholly outside the frame raised `cv2.error` in `copyMakeBorder` (it killed the first head-masked run here and "
               "would have ended a live session); that frame now has no pose.", "",
               "| front view | pose found | gate open | frame MAE vs `ref_frontal` | frame 95 % LoA | rep-peak MAE vs `ref_frontal` | rep F1 (state machine) | movement F1 |",
               "|---|---|---|---|---|---|---|---|"]
        for label, x in (("before", b["front"]), ("after", a)):
            fr, pk = x["frame"]["ref_frontal"], x["rep_peak"]["ref_frontal"]
            md.append(f"| {label} | {_pct(x['pose_rate'])} | {_pct(x['gate_open_rate'])} | {_f(fr['mae'], '°')} | {_f(fr['loa_low'])}° to {_f(fr['loa_high'])}° | "
                      f"{_f(pk['mae'], '°')} (n={pk['n']}) | {x['fsm']['f1']} | {x['movement']['f1']} |")
        md += [""]
    ct = res.get("compare_thresholds")
    if ct and ct.get("before") and ct.get("after"):
        b0 = ct["before"]
        md += ["## Before and after the 12 Oct thresholds", "",
               f"Before = `{b0['name']}` at pipeline `{b0['pipeline_fingerprint']}` (fixed hike limit 0.08, front gate 0.6); after = this "
               f"file (angle-aware hike allowance, front gate {FRONT_SEP_MIN}). Same videos, same scoring. Both thresholds were set from "
               "this dataset (hike curve on subjects 1, 3, 5, 8), so these rows are partly in-sample; the held-out hike numbers are in "
               "`rehab24_thresholds_v0.md`.", "",
               "| view | | gate open | frames scored | frame MAE vs `ref_frontal` | reps counted | rep F1 | `shoulder_hiking` events | correct reps flagged | incorrect reps flagged |",
               "|---|---|---|---|---|---|---|---|---|---|"]
        for key, label in (("front", "front"), ("half-profile", "half-profile (~45°)"), ("side", "side")):
            for when in ("before", "after"):
                x = (ct[when].get("views") or {}).get(key)
                if not x:
                    continue
                cf = f"{x['correct_flagged']} / {x['correct_matched']}" if "correct_flagged" in x else ""
                inf = f"{x['incorrect_flagged']} / {x['incorrect_matched']}" if "incorrect_flagged" in x else ""
                md.append(f"| {label} | {when} | {_pct(x['gate_open_rate'])} | {x['frames_scored']} | {_f(x['frame_mae'], '°')} | {x['reps_counted']} | "
                          f"{x['fsm_f1']} | {x['hike_events']} | {cf} | {inf} |")
        md += ["", "At half-profile the wider gate lets more frames through, and those read low (the angle error grows past ~20° of "
               "turn; `rehab24_thresholds_v0.md` §2): that is the price of not asking a slightly turned patient to turn.", ""]
    md += [
        "## Headline by camera view", "",
        "Angle error = product angle (One-Euro smoothed, what the state machine scores) minus `ref_frontal`, over frames inside labelled "
        "repetitions where the pose was found and the product's view gate was open. Bland–Altman 95 % limits in brackets.", "",
        "| subject facing | recordings / subjects | labelled reps | pose found | gate open | frame MAE / bias [95 % LoA] | rep-peak MAE / bias | "
        "rep F1, state machine (P / R) | movement F1 (P / R) |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for name, key in (("**Camera17, front** (our setup)", "front"), ("Camera18, side / profile", "side"), ("either camera, half-profile (~45°)", "half-profile")):
        if c.get(key):
            md.append(_headline_line(name, c[key]))
    md += ["", "Side-on, the product's front-view gate stays closed (it asks the patient to turn), so nothing is scored: that is the "
           f"intended behaviour, not a miss. At half-profile (labelled ~45°) the gate is open on "
           f"{_pct((c.get('half-profile') or {}).get('gate_open_rate'))} of frames; where it opens, the angle reads low.", ""]
    if a:
        md += ["## Front view in detail", "",
               "| comparison | n | MAE | bias | RMSE | p95 abs | 95 % limits of agreement |", "|---|---|---|---|---|---|---|"]
        for ref in ("ref_frontal", "ref_3d", "ref_cam"):
            md.append(_stat_row(f"per frame vs `{ref}`", a["frame"][ref], " frames"))
        for key, label in (("frame_in_range", f"per frame, `ref_frontal` ≤ {IN_RANGE_DEG:.0f}° (prescribed range)"),
                           ("frame_overhead", f"per frame, `ref_frontal` > {IN_RANGE_DEG:.0f}° (overhead)")):
            md.append(_stat_row(f"{label} vs `ref_frontal`", a[key]["ref_frontal"], " frames"))
        md.append(_stat_row("per frame, prescribed range, **unsmoothed** angle vs `ref_frontal`", a["frame_raw_in_range"]["ref_frontal"], " frames"))
        for ref in ("ref_frontal", "ref_3d", "ref_cam"):
            md.append(_stat_row(f"rep peak vs `{ref}`", a["rep_peak"][ref], " reps"))
        md.append(_stat_row("state machine `peak_deg` vs `ref_frontal` peak (matched reps)", a["fsm_peak_err"]["ref_frontal"], " reps"))
        g = a["ref_cam_minus_frontal"]
        md += [
            "",
            f"- **Why `ref_cam` differs by ~{abs(a['frame']['ref_cam']['bias'] or 0):.0f}°.** `ref_cam` applies our formula (angle at the shoulder "
            "between elbow and same-side hip) to the mocap *joint centres* projected into Camera17. The mocap hip joint sits ~0.1 m from "
            "the midline and the shoulder joint ~0.2 m, so that shoulder→hip line leans inward and opens the angle: on the same frames "
            f"`ref_cam` − `ref_frontal` = {_f(g['bias'], '°')} ± {_f(g['sd'], '°')} (SD). BlazePose's hip landmark sits wider, on the body outline, "
            "so the product's line is near the trunk axis and it agrees with anatomical abduction instead. `ref_cam` is therefore a "
            "definition gap plus projection error, not the landmark error alone, and is reported for completeness only.",
            f"- **State machine:** {a['fsm']['tp']} TP, {a['fsm']['fp']} FP, {a['fsm']['fn']} FN against {a['labelled_reps']} labelled reps; "
            f"of the {a['fsm']['tp'] + a['fsm']['fp']} reps it counted, {a['fsm_verified']} were verified; outcomes {json.dumps(a['fsm_reasons'])}. "
            f"With the gate respected, the movement detector scores F1 {a['movement_gated']['f1']} (P {a['movement_gated']['precision']} / R {a['movement_gated']['recall']}).",
            f"- **One-Euro lag:** the smoothed angle's cross-correlation lag against the reference is {_f(a['lag_s_median'], ' s')} (median per "
            f"recording; raw {_f(a['lag_raw_s_median'], ' s')}; resolution 1/15 s), and smoothing changes the in-range MAE by "
            f"{_f(round((a['frame_in_range']['ref_frontal']['mae'] or 0) - (a['frame_raw_in_range']['ref_frontal']['mae'] or 0), 2), '°')}. No lag problem.",
            f"- **Gate:** inside front-view repetitions the pose was found on {_pct(a['pose_rate'])} of frames and the gate was open on "
            f"{_pct(a['gate_open_rate'])} ({json.dumps(a['gate_frames'])} frames). Events: {json.dumps(a['events'])}.",
            "",
            "### The front-view gate on real people", "",
            f"The gate closes (`turn_front`) when the shoulder separation is below {FRONT_SEP_MIN} × the trunk length (0.6 until 11 Oct). "
            "Measured separation:", "",
            "| subject facing the camera | frames | p5 | p25 | median | p75 | p95 |", "|---|---|---|---|---|---|---|"]
        for key, label in (("front", "front"), ("half-profile", "half-profile (~45°)"), ("side", "side / profile")):
            s = c.get(key, {}).get("shoulder_sep", {})
            if s.get("n"):
                md.append(f"| {label} | {s['n']} | {s['p5']} | {s['p25']} | {s['p50']} | {s['p75']} | {s['p95']} |")
    if a and a["hike_first_deg"].get("n"):
        md += ["", "A front-on standing adult sits only just above 0.6 (p5 ≈ 0.61), so until 11 Oct a patient turned ~15–25° was asked "
               f"to turn. With each subject's yaw recovered from the mocap (`rehab24_thresholds_v0.md` §2), {FRONT_SEP_MIN} passes every "
               "frame up to 20° of turn and ~93 % at 20–30°, and still closes on ~97 % of frames at 45–60° and all side-on frames.", "",
               "### Shoulder hike on normal movement", "",
               f"The product's hike number (practising shoulder height above the other, / trunk length, over the rest baseline) tracks the "
               f"mocap shoulder-joint rise closely, and healthy abduction raises the shoulder by about the old fixed limit ({HIKE_LIMIT}) by "
               "90°. Since 12 Oct the flag uses an angle-aware allowance (healthy p95 at the same scored angle + a margin, "
               "`HEALTHY_HIKE_CURVE` in `perception/arm_fsm.py`, held for 3 frames):", "",
               "| anatomical angle | frames | product hike p50 / p90 | mocap shoulder rise p50 / p90 | frames over the old 0.08 | frames over the allowance |",
               "|---|---|---|---|---|---|"]
        for hb in a["hike_bands"]:
            md.append(f"| {hb['band']} | {hb['n']} | {hb['product_p50']} / {hb['product_p90']} | {hb['mocap_p50']} / {hb['mocap_p90']} | "
                      f"{_pct(hb['frac_over_limit'])} | {_pct(hb.get('frac_over_allowance'))} |")
        hf, ha = a["hike_first_deg"], a.get("hike_allow_first_deg") or {}
        md += ["", f"Frame level (rest-median baseline, no persistence): the old limit was first crossed at a median {hf.get('p50', 0):.0f}° "
               f"(p5–p95 {hf.get('p5', 0):.0f}–{hf.get('p95', 0):.0f}°) and **below 90° on {a['hike_first_below_90']} of {a['hike_reps']}** "
               f"front-view reps; the allowance is crossed below 90° on {a.get('hike_allow_first_below_90', '–')} of {a['hike_reps']}"
               + (f" (first crossing median {ha['p50']:.0f}°)." if ha.get("n") else ".")
               + f" The state machine itself (persistence, its own baseline) flagged {a.get('hike_flagged_correct', '–')} of "
               f"{a.get('correct_matched', '–')} matched **correct** reps and {a.get('hike_flagged_reps', '–')} reps in all. "
               "The dataset does not say which incorrect reps were shrugs, so the flag's sensitivity on real shrugs is not measured; a "
               "synthetic shrug still fires (`tests/test_pipeline.py`). Held-out false alarms: `rehab24_thresholds_v0.md` §1.", ""]
    md += ["## Lighting (front view)", "", "| lights | recordings | pose found | frame MAE vs `ref_frontal` | rep-peak MAE | rep F1 | movement F1 |", "|---|---|---|---|---|---|---|"]
    for k, g in res["lighting"].items():
        if g:
            md.append(f"| {k} | {g['recordings']} | {_pct(g['pose_rate'])} | {_f(g['frame']['ref_frontal']['mae'], '°')} | "
                      f"{_f(g['rep_peak']['ref_frontal']['mae'], '°')} | {g['fsm']['f1']} | {g['movement']['f1']} |")
    md += ["", "The lights-off recordings are subjects 1–3 only, so lighting and subject are confounded.", ""]
    md += ["## Correct / incorrect repetitions vs the product's compensation flags (front view)", "",
           "REHAB24-6 labels each repetition correct or incorrect; the physiotherapist chose a different mistake per subject and the "
           "mistake is not labelled. The product flags trunk lean and shoulder hike only, so an unflagged incorrect rep is expected "
           "whenever the chosen mistake was something else (elbow bent, arm forward of the frontal plane, speed).", "",
           "| label | flagged (lean or hike) | not flagged | no matching rep |", "|---|---|---|---|"]
    for k, v in res["compensation_front"].items():
        md.append(f"| {k} | {v['flagged']} | {v['not_flagged']} | {v['no_rep']} |")
    md += [""]
    if res.get("head"):
        h = res["head"]
        md += ["## Does the head need to be visible? (front view, subset)", "",
               f"Subjects {', '.join(str(s) for s in h['subjects'])} (recordings {', '.join(h['recordings'])}), Camera17, front-view repetitions. "
               "(a) original frames; (b) a grey box over the head, placed per frame from the projected mocap Neck / Head / Head_end joints "
               "with a 45 % margin and stopping at the neck; (c) the frame cropped at the recording's median neck height, so the head is "
               "out of frame. A turned head cannot be reproduced from this data and is not tested.", "",
               "| variant | frames in reps | pose found | gate open | frame MAE vs `ref_frontal` | rep-peak MAE | rep F1 (state machine) | movement F1 |",
               "|---|---|---|---|---|---|---|---|"]
        for k, g in h["variants"].items():
            md.append(f"| {k} | {g['frames_in_reps']} | {_pct(g['pose_rate'])} | {_pct(g['gate_open_rate'])} | {_f(g['frame']['ref_frontal']['mae'], '°')} | "
                      f"{_f(g['rep_peak']['ref_frontal']['mae'], '°')} (n={g['rep_peak']['ref_frontal']['n']}) | {g['fsm']['f1']} | {g['movement']['f1']} |")
        md += ["", h["reading"], ""]
    md += ["## Per subject (front view)", "",
           "| subject | recording | lights | front reps | pose found | gate open | frame MAE / bias vs `ref_frontal` | rep-peak MAE | rep F1 | movement F1 | lean / hike / above-ceiling events |",
           "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in res["rows"]:
        if r["view"] != "front":
            continue
        pk = [p for p in r["rep_peaks"] if p]
        pk_mae = round(float(np.mean([abs(p["pred"] - p["ref_frontal"]) for p in pk])), 2) if pk else None
        fr = r["frame"]["ref_frontal"]
        md.append(f"| {r['person']} | {r['video']} | {'on' if r['lights_on'] else 'off'} | {r['labelled_reps']} | {_pct(r['pose_rate'])} | {_pct(r['gate_open_rate'])} | "
                  f"{_f(fr['mae'], '°')} / {_f(fr['bias'], '°')} | {_f(pk_mae, '°')} | {r['fsm']['f1']} | {r['movement']['f1']} | "
                  f"{r['events']['compensation_lean']} / {r['events']['shoulder_hiking']} / {r['events']['above_ceiling']} |")
    md += ["", "## Every recording, camera and view", "",
           "| recording | camera | subject facing | frame size | reps | pose found | gate open | gates (frames) | frame MAE vs `ref_frontal` | rep F1 | movement F1 |",
           "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in res["rows"]:
        md.append(f"| {r['video']} | {r['camera']} | {r['view']} | {r['size']} | {r['labelled_reps']} | {_pct(r['pose_rate'])} | {_pct(r['gate_open_rate'])} | "
                  f"{json.dumps(r['gates'])} | {_f(r['frame']['ref_frontal']['mae'], '°')} | {r['fsm']['f1']} | {r['movement']['f1']} |")
    md += ["", "## Method", "",
           "- **Data:** " + DATASET_CITATION + " Ex1 = sideways raising of the straightened right arm; 13 recordings of 9 subjects; "
           "178 segmented repetitions (start/end frame at 30 fps), each labelled correct/incorrect, with the subject's orientation "
           "toward Camera17 (per repetition: five recordings turn from front to half-profile halfway) and a lights-on/off label. "
           "Camera18 is orthogonal to Camera17 (Segmentation.txt), so a front view for Camera17 is a profile for Camera18.",
           f"- **Product run:** each video decoded with `cv2.VideoCapture`, every 2nd frame (15 fps, the top of the product's 10–15 fps "
           f"stream), scaled to fit {MAX_W} × {MAX_H} (aspect kept: Camera17 → 640 × 360, Camera18 → 270 × 480), JPEG q{JPEG_QUALITY} "
           "round-trip as the browser sends, then `SessionPipeline(mode=\"arm\", exercise=\"abduction\", side=\"right\")` with every "
           "threshold at its product default. Only the dose is lifted to 1 × 999 so counting does not stop after the shipped 2 × 8 "
           "(no detection logic depends on the dose). Timestamps = frame index / 30 s, the dataset's own clock.",
           "- **References** (per 30 fps frame; the joint files and the videos have the same frame count and the segmentation indexes "
           "both): `ref_frontal` = angle between the upper arm (`RightArm` → `RightForeArm`) and the trunk-down vector (`Neck` → mid-hip "
           "of `LeftUpLeg`/`RightUpLeg`), both projected onto the subject's frontal plane (spanned by the shoulder-to-shoulder axis and "
           "the trunk axis, so it follows the subject, not the room); `ref_3d` = the same vectors unprojected (elevation in any plane); "
           "`ref_cam` = our formula on the mocap joints projected into the recording camera (the authors' estimated pinhole model).",
           "- **Frame errors** use frames inside labelled repetitions with a pose and an open gate. Frames are serially correlated, so the "
           "per-rep peak numbers (one per repetition: the product's maximum over the repetition vs the reference maximum) are the "
           "fairer sample; a rep peak needs ≥ 50 % of the repetition's frames scored.",
           f"- **Rep F1 (state machine):** every `rep_complete` (verified or not), one-to-one against labelled repetitions, matched when the "
           f"intervals overlap by ≥ {int(OVERLAP_MIN * 100)} % of the shorter. **Movement F1:** a lift is a rise of ≥ {PEAK_HYST_DEG:.0f}° to a "
           f"peak ≥ {PEAK_MIN_DEG:.0f}° then a fall of ≥ {PEAK_HYST_DEG:.0f}° in the product angle (pose frames, gate ignored), matched when the "
           "peak lies inside a labelled repetition. The second shows what the angle signal supports without the hold and start-pose "
           "rules; the first is what a patient gets. Predictions in a recording that changes orientation are assigned to the view of "
           "the repetition containing them (or the nearest).",
           "", "## Environment", "",
           f"OpenCV {res['cv2_version']}, Python {res['python']}, {res['host']}; the product runs behind these numbers took {res['wall_s']} s "
           "of wall time in total (summed over runs; 4 worker processes in parallel).", "",
           "Raw data stays in the git-ignored `evaluation/external/rehab24_6/` (fetched by `services/session/tools/fetch_rehab24.py`, "
           "≈ 0.55 GB, SHA-256 pinned); it is never committed or redistributed (CC BY-NC 4.0, evaluation only). Per-frame runs are cached "
           "under `evaluation/external/rehab24_6/praxis_runs/` (numbers only).", ""]
    (out / f"{res['name']}.md").write_text("\n".join(md))


def head_reading(variants: dict[str, dict[str, Any]]) -> str:
    o, m, c = variants.get("a_original"), variants.get("b_head_masked"), variants.get("c_head_cropped")
    if not (o and m and c):
        return ""
    m_mae = m["frame"]["ref_frontal"]["mae"]
    return (f"**The head must be in frame.** Pose found on {o['pose_rate']:.0%} of frames with the head visible, {m['pose_rate']:.0%} "
            f"with the head masked and {c['pose_rate']:.0%} with it cropped out; the poses found with the head masked are mostly wrong "
            f"(frame MAE {_f(m_mae, '°')} where the gate opened, rep F1 {m['fsm']['f1']}). Our code never reads the face, but the "
            "pose stage does: the MediaPipe person detector anchors on the face and upper body before the landmark model runs, and "
            "region tracking cannot start without it.")


# ---- main -------------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="rehab24_eval.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(DATA_DIR))
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--rescore", action="store_true", help="score from cached runs; never re-run the pipeline")
    ap.add_argument("--rerun", action="store_true", help="re-run every pipeline pass even if cached")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--head", default="2,4,8", help="subjects for the head-visibility ablation (front-view recordings)")
    ap.add_argument("--name", default=f"rehab24_{VERSION}", help="results file stem (default: %(default)s)")
    ap.add_argument("--fingerprint", default=None, help="score cached runs of another pipeline fingerprint (implies --rescore)")
    ap.add_argument("--compare", default=None, help="a previous results JSON to show as 'before' (front view)")
    ap.add_argument("--only", default=None, help="comma-separated video ids (debugging)")
    ap.add_argument("--compare-thresholds", default=None,
                    help="results JSON from before the 12 Oct threshold changes (e.g. `git show 898b608:evaluation/results/rehab24_v0.json`); "
                         "without it the block already in the output JSON is kept")
    args = ap.parse_args(argv)
    if args.fingerprint:
        args.rescore = True
    fp = args.fingerprint or FINGERPRINT
    data, out = Path(args.data), Path(args.out)
    if not (data / "Segmentation.csv").exists():
        print(f"no REHAB24-6 data at {data}. Run first: uv run python tools/fetch_rehab24.py")
        return 2
    cache = data / "praxis_runs"
    cache.mkdir(parents=True, exist_ok=True)
    recs = load_segmentation(data / "Segmentation.csv")
    if args.only:
        keep = set(args.only.split(","))
        recs = [r for r in recs if r.video_id in keep]
    head_subjects = {int(s) for s in args.head.split(",") if s}
    head_recs = []
    for s in sorted(head_subjects):
        cand = [r for r in recs if r.person == s and "front" in r.views("c17")]
        if cand:
            head_recs.append(cand[0])
    jobs = [(r.video_id, cam, "orig") for r in recs for cam in ("c17", "c18")]
    jobs += [(r.video_id, "c17", v) for r in head_recs for v in ("head_masked", "head_cropped")]
    todo = [j for j in jobs if args.rerun or not _cache_path(cache, *j, fp).exists()]
    if todo and args.rescore:
        print(f"--rescore but {len(todo)} runs are not cached")
        return 2
    t0 = time.perf_counter()
    if todo:
        with ProcessPoolExecutor(max_workers=args.workers) as ex:
            for msg in ex.map(_run_job, [(str(data), str(cache), *j) for j in todo]):
                print(msg, flush=True)
    wall = round(time.perf_counter() - t0, 1)

    rows: list[dict[str, Any]] = []
    refs_by: dict[tuple[str, str], dict[str, np.ndarray]] = {}
    for rec in recs:
        j3d = np.load(data / "3d_joints" / "Ex1" / f"{rec.video_id}-30fps.npy")
        r3 = ref_angles_3d(j3d)
        for cam in ("c17", "c18"):
            j2d = np.load(data / "2d_joints" / "Ex1" / f"{rec.video_id}-{cam}-30fps.npy")
            refs = {"ref_cam": ref_angle_cam(j2d), **r3}
            refs_by[(rec.video_id, cam)] = refs
            rows.extend(score_run(rec, cam, load_run(cache, rec.video_id, cam, "orig", fp), refs))

    conds = {k: aggregate([r for r in rows if r["view"] == k]) for k in ("front", "side", "half-profile")}
    front = [r for r in rows if r["view"] == "front"]
    lighting = {"lights on": aggregate([r for r in front if r["lights_on"]]), "lights off (evening light)": aggregate([r for r in front if not r["lights_on"]])}
    head: dict[str, Any] | None = None
    if head_recs:
        variants: dict[str, Any] = {}
        for label, v in (("a_original", "orig"), ("b_head_masked", "head_masked"), ("c_head_cropped", "head_cropped")):
            vr = [row for rec in head_recs for row in score_run(rec, "c17", load_run(cache, rec.video_id, "c17", v, fp), refs_by[(rec.video_id, "c17")])
                  if row["view"] == "front"]
            variants[label] = aggregate(vr)
            variants[label]["frames_in_reps"] = sum(r["frames_in_reps"] for r in vr)
        head = {"subjects": [r.person for r in head_recs], "recordings": [r.video_id for r in head_recs], "variants": variants,
                "reading": head_reading(variants)}
    # wall time of the product runs behind these numbers (from the cache, so a rescore reports it too)
    wall = round(sum(float(load_run(cache, v, c_, var, fp).get("wall_s") or 0.0) for v, c_, var in jobs), 1)
    for r in rows:
        r.pop("_pairs", None)
    res = {
        "name": args.name, "pipeline_fingerprint": fp,
        "dataset": "REHAB24-6 Ex1 (arm abduction)", "version": VERSION, "citation": DATASET_CITATION,
        "licence": "CC BY-NC 4.0, evaluation only, never redistributed",
        "generated_on": dt.date.today().isoformat(), "cv2_version": cv2.__version__, "python": platform.python_version(),
        "host": f"{platform.system()} {platform.machine()}", "wall_s": wall,
        "settings": {"stride": STRIDE, "fps_in": FPS, "max_size": [MAX_W, MAX_H], "jpeg_quality": JPEG_QUALITY, "side": SIDE,
                     "exercise": EXERCISE, "dose_override": DOSE, "peak_min_deg": PEAK_MIN_DEG, "peak_hyst_deg": PEAK_HYST_DEG,
                     "overlap_min": OVERLAP_MIN},
        "conditions": conds, "lighting": lighting, "compensation_front": compensation_table(front),
        "head": head, "rows": rows,
        "compare": _compare(args.compare),
    }
    prev = out / f"{args.name}.json"
    if args.compare_thresholds:
        res["compare_thresholds"] = {"before": thresholds_summary(json.loads(Path(args.compare_thresholds).read_text()))}
    elif prev.exists():
        res["compare_thresholds"] = json.loads(prev.read_text()).get("compare_thresholds")
    if res.get("compare_thresholds"):
        res["compare_thresholds"]["after"] = thresholds_summary(res)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{args.name}.json").write_text(json.dumps(res, indent=1, default=_json_default) + "\n")
    write_report(res, out)
    print(json.dumps({k: {kk: c.get(kk) for kk in ("pose_rate", "gate_open_rate", "fsm", "movement")} | {"frame_cam": c["frame"]["ref_cam"], "frame_frontal": c["frame"]["ref_frontal"], "peak_frontal": c["rep_peak"]["ref_frontal"]}
                      for k, c in conds.items() if c}, indent=1, default=_json_default))
    return 0


def _thr_summary(c: dict[str, Any] | None, comp: dict[str, dict[str, int]] | None = None) -> dict[str, Any] | None:
    """The numbers the 12 Oct threshold changes move, for one view."""
    if not c:
        return None
    out = {"gate_open_rate": c["gate_open_rate"], "frame_mae": c["frame"]["ref_frontal"]["mae"], "frames_scored": c["frame"]["ref_frontal"]["n"],
           "fsm_f1": c["fsm"]["f1"], "reps_counted": c["fsm"]["tp"] + c["fsm"]["fp"], "hike_events": c["events"].get("shoulder_hiking", 0)}
    if comp:
        out |= {"correct_flagged": comp["correct"]["flagged"], "correct_matched": comp["correct"]["flagged"] + comp["correct"]["not_flagged"],
                "incorrect_flagged": comp["incorrect"]["flagged"], "incorrect_matched": comp["incorrect"]["flagged"] + comp["incorrect"]["not_flagged"]}
    return out


def thresholds_summary(res: dict[str, Any]) -> dict[str, Any]:
    return {"name": res["name"], "pipeline_fingerprint": res["pipeline_fingerprint"],
            "views": {k: _thr_summary(res["conditions"].get(k), res.get("compensation_front") if k == "front" else None)
                      for k in ("front", "half-profile", "side")}}


def _compare(path: str | None) -> dict[str, Any] | None:
    if not path:
        return None
    b = json.loads(Path(path).read_text())
    return {"name": b["name"], "pipeline_fingerprint": b["pipeline_fingerprint"], "front": b["conditions"]["front"]}


def _json_default(o: Any) -> Any:
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else round(float(o), 4)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, tuple):
        return list(o)
    raise TypeError(type(o))


if __name__ == "__main__":
    sys.exit(main())
