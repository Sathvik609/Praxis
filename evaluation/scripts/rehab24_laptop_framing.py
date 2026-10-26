"""Arm out to the side with laptop framing: REHAB24-6 front-view recordings cropped the way a laptop
camera sees a seated patient (OpenCV cv2.__version__ == 5.0.0 for the crop, resize, JPEG round-trip
and `cv2.dnn` pose inference).

    cd services/session
    uv run python ../../evaluation/scripts/rehab24_laptop_framing.py   # writes results/rehab24_laptop_framing_v0.{md,json}

Why (25 Oct 2026): in the team's laptop sessions the hips were below the frame. 9 of 14 Arm out to
the side sessions paused on `hips_out_of_view`, and one counted 16 reps with 0 verified, many under
a second long with 32-46 deg peaks, plus shoulder-hike flags at 26 deg of arm angle. REHAB24-6 is
filmed full-body, so its headline (`rehab24_v0.md`) never saw this.

What runs: the recordings whose subject faces Camera17 throughout (4 recordings, 4 subjects, 35
labelled reps). Each frame is cut to a 4:3 window from a little above the head down to a line set
from the subject's median projected mocap joints, centred on the neck, scaled to 640 x 480 (so the
person fills the frame as on a laptop) and passed through `rehab24_eval.run_product`, the same
`SessionPipeline` the live socket builds, with every product default. Three framings:
  - full: the original frame (as in `rehab24_v0.md`),
  - hips_at_edge: the bottom of the frame on the hip line,
  - hips_out: the bottom of the frame 60 % of the way from shoulder to hip (hips well below it).
Scoring reuses `rehab24_eval.score_run` against the motion-capture reference (`ref_frontal`).
The crop is fixed per video. The subjects are healthy adults standing in a lab, so this tests the
framing, not seated patients.
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np

HERE = Path(__file__).resolve()
_spec = importlib.util.spec_from_file_location("rehab24_eval", HERE.parent / "rehab24_eval.py")
r24 = importlib.util.module_from_spec(_spec)
sys.modules["rehab24_eval"] = r24
_spec.loader.exec_module(r24)  # type: ignore[union-attr]
import cv2  # noqa: E402

FRAMINGS = {"full": None, "hips_at_edge": 1.0, "hips_out": 0.6}
NAME = "rehab24_laptop_framing_v0"


def laptop_crop(j2d: np.ndarray, frac: float):
    J = r24.J
    sh = np.nanmedian(j2d[:, J["RightArm"], 1])
    hp = np.nanmedian(j2d[:, J["RightUpLeg"], 1])
    top = np.nanmedian(j2d[:, J["Head_end"], 1])
    nx = np.nanmedian(j2d[:, J["Neck"], 0])
    y1 = int(sh + frac * (hp - sh))
    y0 = int(top - 0.25 * (y1 - top))
    w = int(4 / 3 * (y1 - y0))
    x0 = int(nx - w / 2)
    x1 = x0 + w

    def crop(frame: np.ndarray, _i: int) -> np.ndarray:
        pad = cv2.copyMakeBorder(frame, max(0, -y0), 0, max(0, -x0), max(0, x1 - frame.shape[1]), cv2.BORDER_CONSTANT)
        out = pad[max(0, y0):y1 + max(0, -y0), x0 + max(0, -x0):x1 + max(0, -x0)]
        return cv2.resize(out, (r24.MAX_W, r24.MAX_H), interpolation=cv2.INTER_AREA)
    return crop


def _run(job: tuple[str, str, str]) -> dict[str, Any]:
    vid, cam, framing = job
    cv2.setNumThreads(2)
    j2d = np.load(r24.DATA_DIR / "2d_joints" / "Ex1" / f"{vid}-{cam}-30fps.npy")
    frac = FRAMINGS[framing]
    run = r24.run_product(r24.video_path(r24.DATA_DIR, vid, cam), None if frac is None else laptop_crop(j2d, frac))
    run.pop("landmarks", None)
    return {"vid": vid, "cam": cam, "framing": framing, "run": run}


def main() -> int:
    recs = {r.video_id: r for r in r24.load_segmentation(r24.DATA_DIR / "Segmentation.csv")}
    pick = [(r.video_id, "c17") for r in recs.values() if r.views("c17") == {"front"}]
    jobs = [(v, c, f) for v, c in pick for f in FRAMINGS]
    with ProcessPoolExecutor(max_workers=4) as ex:
        runs = list(ex.map(_run, jobs))
    out: dict[str, Any] = {}
    for framing in FRAMINGS:
        rows, fast, hikes, blocked = [], 0, 0, 0
        for x in (x for x in runs if x["framing"] == framing):
            vid, cam, run = x["vid"], x["cam"], x["run"]
            j3d = np.load(r24.DATA_DIR / "3d_joints" / "Ex1" / f"{vid}-30fps.npy")
            j2d = np.load(r24.DATA_DIR / "2d_joints" / "Ex1" / f"{vid}-{cam}-30fps.npy")
            refs = {"ref_cam": r24.ref_angle_cam(j2d), **r24.ref_angles_3d(j3d)}
            rows += r24.score_run(recs[vid], cam, run, refs)
            evs = run["events"]
            fast += sum(1 for e in evs if e["type"] == "rep_complete" and e["t_end"] - e["t_start"] < 1.0)
            hikes += sum(1 for e in evs if e["type"] == "shoulder_hiking")
            blocked += sum(1 for e in evs if e["type"] == "setup_blocked")
        a = r24.aggregate(rows)
        tp, fp, fn = (sum(r["fsm"][k] for r in rows) for k in ("tp", "fp", "fn"))
        out[framing] = {
            "labelled_reps": sum(r["labelled_reps"] for r in rows),
            "rep": r24.prf(tp, fp, fn),
            "reps_under_1s": fast,
            "gate_open_rate": round(float(np.mean([r["gate_open_rate"] or 0.0 for r in rows])), 3),
            "angle_mae_deg": a["frame"]["ref_frontal"]["mae"],
            "angle_p95_deg": a["frame"]["ref_frontal"].get("p95"),
            "shoulder_hiking": hikes,
            "setup_blocked": blocked,
        }
    res = {"name": NAME, "generated_on": dt.date.today().isoformat(), "cv2_version": cv2.__version__,
           "pipeline_fingerprint": r24.FINGERPRINT, "recordings": [v for v, _ in pick], "framings": out,
           "citation": r24.DATASET_CITATION}
    (r24.OUT_DIR / f"{NAME}.json").write_text(json.dumps(res, indent=2) + "\n")
    lines = [
        "# Arm out to the side with laptop framing (REHAB24-6, cropped)", "",
        f"Generated {res['generated_on']} by `evaluation/scripts/rehab24_laptop_framing.py`, OpenCV {cv2.__version__}, "
        f"pipeline {r24.FINGERPRINT}. Recordings {', '.join(res['recordings'])} (Camera17, subject facing it throughout), "
        "healthy adults standing in a lab; the frame is cropped so the person fills a 640 x 480 laptop-like view. "
        "Angle error is against motion capture (`ref_frontal`), on frames where the product scored the angle.", "",
        "| framing | labelled reps | reps found | false reps | rep F1 | reps < 1 s | angle scored | angle MAE | shoulder-hike flags | setup pauses |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for f, o in out.items():
        lines.append(f"| {f} | {o['labelled_reps']} | {o['rep']['tp']} | {o['rep']['fp']} | {o['rep']['f1']:.2f} | {o['reps_under_1s']} | "
                     f"{o['gate_open_rate']:.0%} | {o['angle_mae_deg']:.1f}° | {o['shoulder_hiking']} | {o['setup_blocked']} |")
    before_path = r24.OUT_DIR / f"{NAME}_before_fix.json"
    if before_path.exists():  # the same script run on commit d750879 (before the 25 Oct fix)
        b = json.loads(before_path.read_text())
        lines += ["", f"**Before the 25 Oct fix** (the same script on commit d750879, pipeline {b['pipeline_fingerprint']}; "
                  "the angle gate needed the hip, and a dip over the start line of any length was a rep):", "",
                  lines[4], lines[5]]
        for f, o in b["framings"].items():
            lines.append(f"| {f} | {o['labelled_reps']} | {o['rep']['tp']} | {o['rep']['fp']} | {o['rep']['f1']:.2f} | {o['reps_under_1s']} | "
                         f"{o['gate_open_rate']:.0%} | {o['angle_mae_deg']:.1f}° | {o['shoulder_hiking']} | {o['setup_blocked']} |")
    lines += ["", "Dataset: " + r24.DATASET_CITATION, ""]
    (r24.OUT_DIR / f"{NAME}.md").write_text("\n".join(lines))
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
