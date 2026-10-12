"""Two Arm out to the side thresholds set from REHAB24-6 real video (OpenCV cv2.__version__ ==
5.0.0 produced the cached per-frame runs this script reads; it runs no video itself).

    cd services/session
    uv run python ../../evaluation/scripts/rehab24_eval.py            # once: caches the product runs
    uv run python ../../evaluation/scripts/rehab24_thresholds.py      # writes results/rehab24_thresholds_v0.{md,json}

1. **Shoulder hike, angle-aware** (`perception/arm_fsm.py` `HEALTHY_HIKE_CURVE`). Healthy
   abduction raises the shoulder with the arm, so the fixed 0.08-trunk-length limit fired on most
   correct lifts near 90°. The healthy curve is the p95 of the product's own hike number (practising
   shoulder over the other, / trunk length, minus the state machine's own rest baseline) per 10°
   bin of the scored (smoothed) angle, over frames inside **correct** front-view repetitions of the
   **training subjects only**, made monotone non-decreasing. The flag fires when the hike exceeds
   curve + `HIKE_MARGIN` for `HIKE_PERSIST_FRAMES` consecutive frames. The margin (0.05 trunk
   lengths, ~2.5 cm) and the persistence (3 frames, as `above_ceiling`) are set a priori, not tuned
   on the held-out subjects. The real `ArmFSM` is replayed over the cached per-frame streams and
   its reps matched to the labelled ones, so the false-alarm numbers are what the product does. The
   swapped fold (fit on the test subjects, score the training ones) is reported as a check.
   REHAB24-6 does not label which incorrect repetitions were shrugs, so sensitivity cannot be
   measured here; a synthetic shrug is tested in `services/session/tests/`.

2. **Front-view gate** (`perception/pose.py` `FRONT_SEP_MIN`). The dataset gives each subject's
   orientation only as front / half-profile / side per repetition. A continuous yaw is recovered
   instead: the authors' projected 2D joints are an exact pinhole projection of the 3D mocap
   joints, so each camera's 3 × 4 projection matrix follows by DLT (reprojection error ~1e-10 px)
   and its centre is the matrix's null vector; the subject's yaw to the camera is then the angle,
   in the horizontal plane, between the mocap shoulder axis and the line at right angles to the
   camera direction (0° = square to the camera, 90° = side-on), per frame. The product's
   shoulder separation (cached, per product frame) is tabulated against that yaw, with the angle
   error vs the anatomical reference in each band, for candidate thresholds.

Nothing from the dataset is written into the repo; only these aggregates. CC BY-NC 4.0,
evaluation only (docs/LICENSES.md).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import platform
import sys
from pathlib import Path
from typing import Any

import numpy as np

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parent))
import rehab24_eval as R  # noqa: E402  (also puts services/session on sys.path)

from praxis_session.perception.arm_fsm import (  # noqa: E402
    HEALTHY_HIKE_CURVE,
    HIKE_MARGIN,
    HIKE_PERSIST_FRAMES,
    MIN_VISIBILITY,
    ArmFSM,
    ArmObservation,
)
from praxis_session.perception.pose import FRONT_SEP_MIN, SIDE_SEP_MAX  # noqa: E402

VERSION = "v0"
TRAIN_SUBJECTS = (1, 3, 5, 8)
TEST_SUBJECTS = (2, 4, 7, 9)
BIN_DEG = 10.0
MIN_BIN_FRAMES = 30
OLD_HIKE_LIMIT = 0.08
OLD_FRONT_SEP_MIN = 0.6
SEP_CANDIDATES = (0.45, 0.5, 0.55, 0.6)
YAW_BANDS = ((0, 10), (10, 20), (20, 30), (30, 45), (45, 60), (60, 90.01))


# ---- shoulder hike ------------------------------------------------------------------------
def observations(run: dict[str, Any], front_sep_min: float) -> list[ArmObservation]:
    """The cached per-frame product numbers as the state machine's observations."""
    out = []
    for k, fi in enumerate(run["frame_idx"]):
        a = run["angle"][k]
        present = bool(run["present"][k]) and np.isfinite(a)
        sep = float(run["sep"][k]) if np.isfinite(run["sep"][k]) else 0.0
        out.append(ArmObservation(
            t=float(fi) / R.FPS,
            shoulder_deg=float(a) if present else None,
            trunk_lean_deg=float(run["lean"][k]) if present else 0.0,
            shoulder_hike_norm=float(run["hike"][k]) if present else 0.0,
            view_ok=sep < SIDE_SEP_MAX,
            front_view_ok=sep >= front_sep_min,
            visibility=float(run["visibility"][k]) if present else 1.0,
        ))
    return out


def replay(run: dict[str, Any], front_sep_min: float = FRONT_SEP_MIN, **hike: Any) -> tuple[ArmFSM, list[dict[str, Any]]]:
    """Replay the real ArmFSM (Arm out to the side, dose lifted like rehab24_eval) over one run."""
    fsm = ArmFSM(R.EXERCISE, sets=R.DOSE["sets"], reps_per_set=R.DOSE["reps"], **hike)
    evs: list[dict[str, Any]] = []
    for obs in observations(run, front_sep_min):
        evs += [e.to_dict() for e in fsm.step(obs)]
    return fsm, evs


def front_recordings(recs: list[R.Recording]) -> list[R.Recording]:
    return [r for r in recs if "front" in r.views("c17")]


def healthy_frames(rec: R.Recording, run: dict[str, Any], front_sep_min: float) -> tuple[np.ndarray, np.ndarray]:
    """(scored angle, hike over the FSM's own rest baseline) on open frames inside correct
    front-view repetitions."""
    fsm, _ = replay(run, front_sep_min, hike_limit=np.inf)
    base = fsm._hike_baseline
    fi, a, h = run["frame_idx"], run["angle"], run["hike"]
    open_ = run["present"] & np.isfinite(a) & (run["sep"] >= front_sep_min) & (run["visibility"] >= MIN_VISIBILITY)
    span = np.zeros(len(fi), bool)
    for rp in rec.reps:
        if rp["correct"] and R.view_of(rp["orientation"], "c17") == "front":
            span |= (fi >= rp["first"]) & (fi <= rp["last"])
    m = open_ & span & np.isfinite(h)
    return a[m], h[m] - base


def fit_curve(angle: np.ndarray, hike: np.ndarray) -> tuple[list[dict[str, Any]], tuple[tuple[float, float], ...]]:
    """p95 hike per angle bin (bins with ≥ MIN_BIN_FRAMES), then a running maximum."""
    bins, knots, run_max = [], [], -np.inf
    for lo in np.arange(0.0, 180.0, BIN_DEG):
        m = (angle >= lo) & (angle < lo + BIN_DEG)
        n = int(m.sum())
        p95 = float(np.percentile(hike[m], 95)) if n >= MIN_BIN_FRAMES else None
        p50 = float(np.median(hike[m])) if n else None
        bins.append({"lo": float(lo), "hi": float(lo + BIN_DEG), "frames": n, "p50": _r(p50), "p95": _r(p95)})
        if p95 is not None:
            run_max = max(run_max, p95)
            knots.append((float(lo + BIN_DEG / 2), round(run_max, 3)))
    return bins, tuple(knots)


def score_hike(recs: list[R.Recording], runs: dict[str, dict[str, Any]], front_sep_min: float, **hike: Any) -> dict[str, Any]:
    """Labelled front-view repetitions vs the replayed FSM's hike flag."""
    out = {"correct": {"reps": 0, "matched": 0, "flagged": 0, "flagged_below_90": 0},
           "incorrect": {"reps": 0, "matched": 0, "flagged": 0, "flagged_below_90": 0},
           "first_flag_deg": []}
    for rec in recs:
        _, evs = replay(runs[rec.video_id], front_sep_min, **hike)
        reps = [e for e in evs if e["type"] == "rep_complete"]
        hikes = [e for e in evs if e["type"] == "shoulder_hiking"]
        labels = [(rp["first"] / R.FPS, rp["last"] / R.FPS) for rp in rec.reps]
        views = [R.view_of(rp["orientation"], "c17") for rp in rec.reps]
        rep_views = R.assign_views([(e["t_start"] + e["t_end"]) / 2 for e in reps], labels, views)
        front_idx = [j for j, v in enumerate(views) if v == "front"]
        fr = [e for e, v in zip(reps, rep_views) if v == "front"]
        pairs = R.match_intervals([(e["t_start"], e["t_end"]) for e in fr], [labels[j] for j in front_idx])
        matched = {front_idx[j]: fr[i] for i, j in pairs}
        for j in front_idx:
            rp = rec.reps[j]
            c = out["correct" if rp["correct"] else "incorrect"]
            c["reps"] += 1
            e = matched.get(j)
            if e is None:
                continue
            c["matched"] += 1
            if e.get("hike"):
                c["flagged"] += 1
                first = next((h for h in hikes if e["t_start"] <= h["t"] <= e["t_end"]), None)
                if first is not None:
                    out["first_flag_deg"].append(first["angle_deg"])
                    if first["angle_deg"] < 90.0:
                        c["flagged_below_90"] += 1
    for k in ("correct", "incorrect"):
        c = out[k]
        c["flag_rate"] = round(c["flagged"] / c["matched"], 4) if c["matched"] else None
    out["first_flag_deg"] = R._pcts(out["first_flag_deg"])
    return out


def hike_section(recs: list[R.Recording], runs: dict[str, dict[str, Any]]) -> dict[str, Any]:
    front = front_recordings(recs)

    def subset(subjects: tuple[int, ...]) -> list[R.Recording]:
        return [r for r in front if r.person in subjects]

    def fit(subjects: tuple[int, ...]) -> tuple[list[dict[str, Any]], tuple[tuple[float, float], ...], int]:
        aa, hh = [], []
        for r in subset(subjects):
            a, h = healthy_frames(r, runs[r.video_id], FRONT_SEP_MIN)
            aa.append(a)
            hh.append(h)
        a, h = np.concatenate(aa), np.concatenate(hh)
        bins, curve = fit_curve(a, h)
        return bins, curve, int(len(a))

    def configs(curve: tuple[tuple[float, float], ...]) -> dict[str, dict[str, Any]]:
        return {
            "fixed 0.08, 1 frame (until 11 Oct)": {"hike_limit": OLD_HIKE_LIMIT},
            "fixed 0.08, 3 frames": {"hike_limit": OLD_HIKE_LIMIT, "hike_persist_frames": HIKE_PERSIST_FRAMES},
            f"healthy curve + {HIKE_MARGIN}, 1 frame": {"hike_curve": curve, "hike_margin": HIKE_MARGIN, "hike_persist_frames": 1},
            f"healthy curve + {HIKE_MARGIN}, {HIKE_PERSIST_FRAMES} frames (shipped)": {"hike_curve": curve, "hike_margin": HIKE_MARGIN,
                                                                                      "hike_persist_frames": HIKE_PERSIST_FRAMES},
            f"healthy curve + 0.03, {HIKE_PERSIST_FRAMES} frames": {"hike_curve": curve, "hike_margin": 0.03, "hike_persist_frames": HIKE_PERSIST_FRAMES},
            f"healthy curve + 0.08, {HIKE_PERSIST_FRAMES} frames": {"hike_curve": curve, "hike_margin": 0.08, "hike_persist_frames": HIKE_PERSIST_FRAMES},
        }

    bins, curve, n = fit(TRAIN_SUBJECTS)
    held_out = {name: score_hike(subset(TEST_SUBJECTS), runs, FRONT_SEP_MIN, **cfg) for name, cfg in configs(curve).items()}
    in_sample = {name: score_hike(subset(TRAIN_SUBJECTS), runs, FRONT_SEP_MIN, **cfg) for name, cfg in configs(curve).items()}
    s_bins, s_curve, s_n = fit(TEST_SUBJECTS)
    swapped = {name: score_hike(subset(TRAIN_SUBJECTS), runs, FRONT_SEP_MIN, **cfg) for name, cfg in configs(s_curve).items()}
    return {
        "train_subjects": list(TRAIN_SUBJECTS), "test_subjects": list(TEST_SUBJECTS),
        "train_recordings": [r.video_id for r in subset(TRAIN_SUBJECTS)], "test_recordings": [r.video_id for r in subset(TEST_SUBJECTS)],
        "bin_deg": BIN_DEG, "min_bin_frames": MIN_BIN_FRAMES, "fit_frames": n,
        "margin": HIKE_MARGIN, "persist_frames": HIKE_PERSIST_FRAMES,
        "fit_bins": bins, "shipped_curve": [list(k) for k in curve],
        "code_curve_matches": [list(k) for k in curve] == [list(k) for k in HEALTHY_HIKE_CURVE],
        "held_out": held_out, "in_sample": in_sample,
        "swapped_fold": {"fit_frames": s_n, "curve": [list(k) for k in s_curve], "scored_on_train": swapped},
    }


# ---- front-view gate ----------------------------------------------------------------------
def camera_centre(j3d: np.ndarray, j2d: np.ndarray, step: int = 40) -> tuple[np.ndarray, float]:
    """Camera centre (mocap coordinates) from 3D↔2D joint pairs by DLT; and the median
    reprojection error in px (the authors' 2D joints are a pinhole projection, so ~0)."""
    X = j3d[::step, :, :3].reshape(-1, 3).astype(np.float64)
    x = j2d[::step].reshape(-1, 2).astype(np.float64)
    ok = np.isfinite(X).all(1) & np.isfinite(x).all(1)
    X, x = X[ok], x[ok]
    A = np.zeros((2 * len(X), 12))
    Xh = np.c_[X, np.ones(len(X))]
    A[0::2, 0:4], A[0::2, 8:12] = Xh, -x[:, :1] * Xh
    A[1::2, 4:8], A[1::2, 8:12] = Xh, -x[:, 1:] * Xh
    P = np.linalg.svd(A)[2][-1].reshape(3, 4)
    pr = Xh @ P.T
    err = float(np.median(np.linalg.norm(pr[:, :2] / pr[:, 2:] - x, axis=1)))
    C = np.linalg.svd(P)[2][-1]
    return C[:3] / C[3], err


def yaw_to_camera(j3d: np.ndarray, centre: np.ndarray) -> np.ndarray:
    """Per frame: 0° = shoulders square to the camera, 90° = side-on (folded; y is up)."""
    lsh, rsh = j3d[:, R.J["LeftArm"], :3], j3d[:, R.J["RightArm"], :3]
    lr = (lsh - rsh)[:, [0, 2]]
    d = (centre[None, :] - (lsh + rsh) / 2)[:, [0, 2]]
    lr = lr / np.linalg.norm(lr, axis=1, keepdims=True)
    d = d / np.linalg.norm(d, axis=1, keepdims=True)
    return np.degrees(np.arcsin(np.clip(np.abs((lr * d).sum(1)), 0.0, 1.0)))


def gate_section(recs: list[R.Recording], data: Path, fp: str) -> dict[str, Any]:
    yaw_all, sep_all, err_all, person_all = [], [], [], []
    reproj = []
    for rec in recs:
        j3d = np.load(data / "3d_joints" / "Ex1" / f"{rec.video_id}-30fps.npy")
        ref = R.ref_angles_3d(j3d)["ref_frontal"]
        for cam in ("c17", "c18"):
            j2d = np.load(data / "2d_joints" / "Ex1" / f"{rec.video_id}-{cam}-30fps.npy")
            centre, e = camera_centre(j3d, j2d)
            reproj.append(e)
            yaw = yaw_to_camera(j3d, centre)
            run = R.load_run(data / "praxis_runs", rec.video_id, cam, "orig", fp)
            fi = run["frame_idx"]
            keep = (fi < len(yaw)) & run["present"] & np.isfinite(run["sep"])
            fi = fi[keep]
            yaw_all.append(yaw[fi])
            sep_all.append(run["sep"][keep])
            err_all.append(run["angle"][keep] - ref[fi])
            person_all.append(np.full(len(fi), rec.person))
    yaw, sep, err, person = (np.concatenate(v) for v in (yaw_all, sep_all, err_all, person_all))
    bands = []
    for lo, hi in YAW_BANDS:
        m = (yaw >= lo) & (yaw < hi)
        n = int(m.sum())
        row: dict[str, Any] = {"yaw_lo": lo, "yaw_hi": round(min(hi, 90.0)), "frames": n, "subjects": len(set(person[m].tolist()))}
        if n:
            row |= {"sep_p5": _r(np.percentile(sep[m], 5)), "sep_p50": _r(np.median(sep[m])), "sep_p95": _r(np.percentile(sep[m], 95)),
                    "angle_mae": _r(np.nanmean(np.abs(err[m])), 2), "angle_bias": _r(np.nanmean(err[m]), 2),
                    "pass": {f"{c:.2f}": _r(float(np.mean(sep[m] >= c))) for c in SEP_CANDIDATES}}
            # per-subject p5 so one broad- or narrow-shouldered subject is visible
            row["subject_sep_p5_min"] = _r(min(np.percentile(sep[m & (person == p)], 5) for p in set(person[m].tolist())
                                              if (m & (person == p)).sum() >= 20)) if any((m & (person == p)).sum() >= 20 for p in set(person[m].tolist())) else None
        bands.append(row)
    return {"frames": int(len(yaw)), "dlt_reprojection_px_max": float(max(reproj)), "candidates": list(SEP_CANDIDATES),
            "shipped": FRONT_SEP_MIN, "before": OLD_FRONT_SEP_MIN, "side_sep_max": SIDE_SEP_MAX, "bands": bands}


# ---- report --------------------------------------------------------------------------------
def _r(x: Any, nd: int = 3) -> Any:
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def _pct(x: float | None) -> str:
    return "–" if x is None else f"{100 * x:.0f} %"


def write_report(res: dict[str, Any], out: Path) -> None:
    h, g = res["hike"], res["gate"]
    L = [
        "# REHAB24-6: shoulder-hike allowance and front-view gate for Arm out to the side", "",
        f"`rehab24_thresholds_{VERSION}` · regenerated by `evaluation/scripts/rehab24_thresholds.py` on {res['generated_on']} "
        f"(OpenCV {res['cv2_version']}, Python {res['python']}) from the cached product runs of pipeline `{res['pipeline_fingerprint']}`. "
        "**Do not hand-edit**: every number is in `rehab24_thresholds_v0.json`.", "",
        "## Honest reading", "",
        "- 8 healthy adults standing in a motion-capture lab (REHAB24-6 Ex1, Camera17 front view), not patients and not seated at a laptop. "
        "The healthy curve is a population p95 of *their* shoulder elevation; a patient with a stiff or painful shoulder may elevate more "
        "without shrugging, or less.",
        "- REHAB24-6 does not say which incorrect repetitions were shrugs, so the flag's **sensitivity on real shrugs is not measured**. "
        "A synthetic shrug (landmark streams) still fires (`tests/test_pipeline.py`, `tests/test_arm_fsm.py`). Dataset v1's scripted hikes "
        "would measure it.",
        f"- The curve is fitted on subjects {', '.join(map(str, h['train_subjects']))} only and scored on subjects "
        f"{', '.join(map(str, h['test_subjects']))}; the margin ({h['margin']} trunk lengths) and persistence ({h['persist_frames']} frames) "
        "were set before scoring the held-out subjects. The swapped fold is the check that the split is not lucky.",
        "- The gate's yaw is recovered from the mocap (camera centres by DLT); standing adults several metres from a lab camera.", "",
        "## 1. Shoulder hike", "",
        f"Healthy curve (shipped as `HEALTHY_HIKE_CURVE` in `perception/arm_fsm.py`; code and fit agree: {h['code_curve_matches']}), "
        f"from {h['fit_frames']} frames inside correct front-view repetitions of the training subjects ({', '.join(h['train_recordings'])}). "
        f"Hike = practising shoulder over the other / trunk length, minus the state machine's own rest baseline; angle = the scored, "
        f"smoothed product angle (camera-relative).", "",
        "| scored angle | frames | hike p50 | hike p95 | curve knot | flag above (curve + margin) |", "|---|---|---|---|---|---|",
    ]
    knots = {k[0]: k[1] for k in h["shipped_curve"]}
    for b in h["fit_bins"]:
        c = knots.get(b["lo"] + h["bin_deg"] / 2)
        L.append(f"| {b['lo']:.0f}–{b['hi']:.0f}° | {b['frames']} | {_f(b['p50'])} | {_f(b['p95'])} | {_f(c)} | {_f(None if c is None else c + h['margin'])} |")
    L += ["", "Between knots the allowance is linear; outside them it is flat.", "",
          f"### False alarms on healthy movement: held-out subjects ({', '.join(h['test_recordings'])})", "",
          "The real `ArmFSM` replayed over the cached per-frame product streams (gate at the shipped `FRONT_SEP_MIN`), reps matched to the "
          "labelled ones as in `rehab24_eval.py`. A correct repetition flagged is a false alarm.", "",
          "| rule | correct reps flagged | … first flag below 90° | incorrect reps flagged | first flag angle p50 (p5–p95) |", "|---|---|---|---|---|"]
    for name, s in h["held_out"].items():
        L.append(_hike_row(name, s))
    L += ["", f"In-sample (training subjects, {', '.join(h['train_recordings'])}; optimistic by construction):", "",
          "| rule | correct reps flagged | … first flag below 90° | incorrect reps flagged | first flag angle p50 (p5–p95) |", "|---|---|---|---|---|"]
    for name, s in h["in_sample"].items():
        L.append(_hike_row(name, s))
    sw = h["swapped_fold"]
    L += ["", f"Swapped fold (curve fitted on the test subjects, {sw['fit_frames']} frames, knots {sw['curve']}; scored on the training subjects):", "",
          "| rule | correct reps flagged | … first flag below 90° | incorrect reps flagged | first flag angle p50 (p5–p95) |", "|---|---|---|---|---|"]
    for name, s in sw["scored_on_train"].items():
        L.append(_hike_row(name, s))
    L += ["", "Ex1 lifts go overhead (median peak ~124°), past the 90° the product prescribes; flags above 90° are on lifts the product "
          "would already cue with `above_ceiling`. Incorrect repetitions are flagged more often than correct ones only if the "
          "physiotherapist's chosen mistake raised the shoulder; the mistake is not labelled.", "",
          "## 2. Front-view gate", "",
          f"Shoulder separation (product, trunk lengths) against the subject's yaw to the camera, {g['frames']} product frames with a pose, "
          f"both cameras, all 13 recordings (DLT reprojection error ≤ {g['dlt_reprojection_px_max']:.1e} px). Angle error = scored angle − "
          "anatomical abduction (`ref_frontal`), all frames with a pose (gate ignored).", "",
          "| yaw | frames | subjects | separation p5 / p50 / p95 | lowest subject p5 | angle MAE / bias | pass ≥ 0.45 | ≥ 0.50 | **≥ 0.55** | ≥ 0.60 (before) |",
          "|---|---|---|---|---|---|---|---|---|---|"]
    for b in g["bands"]:
        if not b["frames"]:
            L.append(f"| {b['yaw_lo']}–{b['yaw_hi']}° | 0 | – | – | – | – | – | – | – | – |")
            continue
        p = b["pass"]
        L.append(f"| {b['yaw_lo']}–{b['yaw_hi']}° | {b['frames']} | {b['subjects']} | {_f(b['sep_p5'])} / {_f(b['sep_p50'])} / {_f(b['sep_p95'])} | "
                 f"{_f(b['subject_sep_p5_min'])} | {b['angle_mae']}° / {b['angle_bias']}° | {_pct(p['0.45'])} | {_pct(p['0.50'])} | **{_pct(p['0.55'])}** | {_pct(p['0.60'])} |")
    L += ["", f"Shipped: `FRONT_SEP_MIN = {g['shipped']}` (was {g['before']}). It scores a patient turned up to ~20° (where the angle "
          "error is unchanged from square-on), passes most frames at 20–30° (error grows to 6–8°, mostly a low bias), and asks a patient "
          "turned ~45° or more to face the camera. Between 30° and 45° most frames still pass, with a ~10–14° low bias: a turn the setup "
          "screen cannot yet tell apart from a broad-shouldered patient square-on. The side-view gate of the hidden exercises "
          f"(`SIDE_SEP_MAX = {g['side_sep_max']}`) is unchanged.", ""]
    out.write_text("\n".join(L) + "\n")


def _f(x: Any) -> str:
    return "–" if x is None else f"{x:.3f}"


def _hike_row(name: str, s: dict[str, Any]) -> str:
    c, i, d = s["correct"], s["incorrect"], s["first_flag_deg"]
    ang = "–" if not d.get("n") else f"{d['p50']:.0f}° ({d['p5']:.0f}–{d['p95']:.0f}°)"
    return (f"| {name} | {c['flagged']} / {c['matched']} ({_pct(c['flag_rate'])}) | {c['flagged_below_90']} | "
            f"{i['flagged']} / {i['matched']} ({_pct(i['flag_rate'])}) | {ang} |")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="rehab24_thresholds.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(R.DATA_DIR))
    ap.add_argument("--out", default=str(R.OUT_DIR))
    ap.add_argument("--fingerprint", default=None, help="cached runs of this pipeline fingerprint (default: the current code's, "
                    "else the newest cached one)")
    args = ap.parse_args(argv)
    data, out = Path(args.data), Path(args.out)
    if not (data / "Segmentation.csv").exists():
        print(f"no REHAB24-6 data at {data}. Run first: uv run python tools/fetch_rehab24.py")
        return 2
    cache = data / "praxis_runs"
    fp = args.fingerprint or R.FINGERPRINT
    recs = R.load_segmentation(data / "Segmentation.csv")
    if not all(R._cache_path(cache, r.video_id, c, "orig", fp).exists() for r in recs for c in ("c17", "c18")):
        cached = sorted(cache.glob("PM_000-c17-orig-s2-*.npz"), key=lambda p: p.stat().st_mtime)
        if args.fingerprint or not cached:
            print(f"runs for pipeline {fp} are not cached: run rehab24_eval.py first")
            return 2
        fp = cached[-1].stem.rsplit("-", 1)[-1]
        print(f"note: scoring the cached runs of pipeline {fp} (the per-frame signals; thresholds are applied here)")
    runs = {r.video_id: R.load_run(cache, r.video_id, "c17", "orig", fp) for r in front_recordings(recs)}
    import cv2

    res = {"name": f"rehab24_thresholds_{VERSION}", "pipeline_fingerprint": fp, "generated_on": dt.date.today().isoformat(),
           "cv2_version": cv2.__version__, "python": platform.python_version(), "citation": R.DATASET_CITATION,
           "hike": hike_section(recs, runs), "gate": gate_section(recs, data, fp)}
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{res['name']}.json").write_text(json.dumps(res, indent=1, default=R._json_default) + "\n")
    write_report(res, out / f"{res['name']}.md")
    print(json.dumps({"shipped_curve": res["hike"]["shipped_curve"], "code_curve_matches": res["hike"]["code_curve_matches"],
                      "held_out": {k: v["correct"] for k, v in res["hike"]["held_out"].items()}}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
