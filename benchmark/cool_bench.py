"""COOL vs stock OpenCV on Praxis's own per-frame work, on one Graviton instance.

Run the same script twice on the same host: once with COOL's cv2 (PYTHONPATH=/opt/cool/...,
OpenCV 5.1.0-dev, KleidiCV HAL) and once with the pinned `opencv-python-headless==5.0.0.93`
wheel. The build under test is whatever `import cv2` resolves to; `cv2.__version__`,
`cv2.__file__` and the HAL line of `cv2.getBuildInformation()` are written into the result.

Inputs are fixed: `--prep` decodes the two replay clips once and writes 640x480 JPEGs
(quality 80, what the browser sends) so both builds time the same bytes.

Stages (classical OpenCV only, as in the session's hot path):
  decode        cv2.imdecode of the JPEG
  aruco_H       Calibrator.run: cvtColor + ArucoDetector.detectMarkers + findHomography + solvePnP
  warp          cv2.warpPerspective to the canonical sheet
  hough         BoardState.detect_holes: GaussianBlur + HoughCircles (cache cleared each time)
  peg_mask      cvtColor(HSV) + inRange
  peg_blobs     mask + findContours + moments
  hole_match    hole_scores: masked matchTemplate per hole
  cup           CupSheetState warp + inRange + findContours (cup clip)
  pipeline_*    SessionPipeline.process per frame, hand model off (classical end to end)
  hand_dnn      HandTracker.detect (cv2.dnn palm + landmark ONNX), reported separately

    python benchmark/cool_bench.py --prep benchmark/frames
    python benchmark/cool_bench.py --frames benchmark/frames --label cool --out benchmark/results/cool.json
"""

from __future__ import annotations

import argparse
import json
import platform
import statistics
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/session"))

from praxis_session.perception.board import BoardState  # noqa: E402
from praxis_session.perception.board_spec import CUP_TARGETS, NHPT_BOARD  # noqa: E402
from praxis_session.perception.calibration import Calibrator  # noqa: E402
from praxis_session.perception.cup import CupSheetState  # noqa: E402
from praxis_session.perception.hand import HandTracker  # noqa: E402
from praxis_session.pipeline import SessionPipeline  # noqa: E402

CLIPS = {"nhpt": "synthetic_nhpt_01.mp4", "cup": "synthetic_cup_01.mp4"}


def prep(out: Path) -> None:
    for name, clip in CLIPS.items():
        d = out / name
        d.mkdir(parents=True, exist_ok=True)
        cap = cv2.VideoCapture(str(ROOT / "evaluation/dataset_v0" / clip))
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame = cv2.resize(frame, (640, 480), interpolation=cv2.INTER_AREA)
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            (d / f"{i:04d}.jpg").write_bytes(buf.tobytes())
            i += 1
        print(f"{name}: {i} frames -> {d}")


def load(frames: Path, name: str) -> list[bytes]:
    return [p.read_bytes() for p in sorted((frames / name).glob("*.jpg"))]


def timed(fn, items, repeats: int) -> list[float]:
    """Per-call milliseconds over `repeats` passes of `items` (one warm-up pass first)."""
    for it in items:
        fn(it)
    ms = []
    for _ in range(repeats):
        for it in items:
            t0 = time.perf_counter_ns()
            fn(it)
            ms.append((time.perf_counter_ns() - t0) / 1e6)
    return ms


def stats(ms: list[float]) -> dict[str, float]:
    s = sorted(ms)
    return {
        "n": len(s),
        "mean_ms": round(statistics.fmean(s), 4),
        "p50_ms": round(s[len(s) // 2], 4),
        "p95_ms": round(s[int(len(s) * 0.95) - 1], 4),
    }


def build_info() -> dict[str, object]:
    hal = [ln.strip() for ln in cv2.getBuildInformation().splitlines() if "HAL" in ln or "Baseline" in ln]
    try:
        cpu = subprocess.run(["lscpu"], capture_output=True, text=True).stdout
        model = next((ln.split(":", 1)[1].strip() for ln in cpu.splitlines() if ln.startswith("Model name")), "")
    except OSError:
        model = ""
    return {
        "cv2_version": cv2.__version__,
        "cv2_file": cv2.__file__,
        "build": hal,
        "threads": cv2.getNumThreads(),
        "python": platform.python_version(),
        "machine": platform.machine(),
        "cpu": model,
        "numpy": np.__version__,
    }


def run(frames: Path, repeats: int) -> dict[str, object]:
    nhpt_jpg, cup_jpg = load(frames, "nhpt"), load(frames, "cup")
    nhpt = [cv2.imdecode(np.frombuffer(b, np.uint8), cv2.IMREAD_COLOR) for b in nhpt_jpg]
    cup = [cv2.imdecode(np.frombuffer(b, np.uint8), cv2.IMREAD_COLOR) for b in cup_jpg]
    out: dict[str, object] = {}

    out["decode"] = stats(timed(lambda b: cv2.imdecode(np.frombuffer(b, np.uint8), cv2.IMREAD_COLOR), nhpt_jpg, repeats))

    cal = Calibrator(NHPT_BOARD)
    out["aruco_H"] = stats(timed(lambda f: cal.run(f, 0.0), nhpt, repeats))

    # Calibrated frames only for the sheet stages.
    cals = [(f, cal.run(f, 0.0)) for f in nhpt]
    cals = [(f, c) for f, c in cals if c.calibrated]
    board = BoardState(NHPT_BOARD)
    out["warp"] = stats(timed(lambda fc: board.warp(*fc), cals, repeats))
    canon = [board.warp(f, c) for f, c in cals]

    def hough(c):
        board.reset_holes()
        board.detect_holes(c)

    out["hough"] = stats(timed(hough, canon, repeats))
    board.reset_holes()
    board.detect_holes(canon[0])
    out["peg_mask"] = stats(timed(board.peg_mask, canon, repeats))
    out["peg_blobs"] = stats(timed(board.peg_blobs, canon, repeats))
    out["hole_match"] = stats(timed(board.hole_scores, canon, repeats))

    ccal = Calibrator(CUP_TARGETS)
    cup_cals = [(f, ccal.run(f, 0.0)) for f in cup]
    cup_cals = [(f, c) for f, c in cup_cals if c.calibrated]
    cs = CupSheetState(CUP_TARGETS)
    out["cup"] = stats(timed(lambda fc: cs.cup_mm(cs.warp(*fc)), cup_cals, repeats))

    for name, frames_, sheet in (("nhpt", nhpt, "nhpt_board"), ("cup", cup, "cup_targets")):
        ms: list[float] = []
        for r in range(repeats + 1):
            p = SessionPipeline(mode=name, sheet=sheet, use_hand=False, use_pose=False)
            for i, f in enumerate(frames_):
                t0 = time.perf_counter_ns()
                p.process(f, i / 10.0, i)
                if r:  # pass 0 is the warm-up
                    ms.append((time.perf_counter_ns() - t0) / 1e6)
        out[f"pipeline_{name}"] = stats(ms)

    hand = HandTracker()
    if hand.available:
        sample = cup[:: max(1, len(cup) // 40)]
        out["hand_dnn"] = stats(timed(hand.detect, sample, repeats))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prep", type=Path)
    ap.add_argument("--frames", type=Path, default=ROOT / "benchmark/frames")
    ap.add_argument("--label", default="")
    ap.add_argument("--repeats", type=int, default=5)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args(argv)
    if a.prep:
        prep(a.prep)
        return 0
    res = {"label": a.label, "env": build_info(), "repeats": a.repeats, "stages": run(a.frames, a.repeats)}
    js = json.dumps(res, indent=1)
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(js + "\n")
    print(js)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
