"""Replay mode: play a recorded MJPEG/MP4 through the identical SessionPipeline (no webcam).

This is the guaranteed judge fallback. Timestamps are derived from the file's fps and frame
index, so results are deterministic and independent of wall-clock speed. Uses cv2.VideoCapture
(OpenCV 5, cv2.__version__ == 5.0.0 at authoring).

    uv run python -m praxis_session.replay evaluation/dataset_v0/synthetic_nhpt_01.mp4 --mode nhpt
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2

from praxis_session.events import Event, EventRing
from praxis_session.pipeline import Mode, SessionPipeline


@dataclass
class ReplayResult:
    path: str
    mode: str
    fps: float
    frames: int
    reps: int
    nhpt_total_s: float | None
    events: list[Event] = field(default_factory=list)
    snapshot: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        counts: dict[str, int] = {}
        for e in self.events:
            counts[e.type] = counts.get(e.type, 0) + 1
        return {
            "path": self.path, "mode": self.mode, "fps": self.fps, "frames": self.frames,
            "reps": self.reps, "nhpt_total_s": self.nhpt_total_s, "event_counts": counts,
            "snapshot": self.snapshot,
        }


def run_replay(
    path: str | Path,
    mode: Mode = "nhpt",
    targets: list[int] | None = None,
    fps_override: float | None = None,
    ring: EventRing | None = None,
    on_event: Any = None,
    **fsm_kwargs: Any,
) -> ReplayResult:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(p)
    cap = cv2.VideoCapture(str(p))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video {p}")
    fps = fps_override or float(cap.get(cv2.CAP_PROP_FPS)) or 10.0
    pipeline = SessionPipeline(mode=mode, targets=targets, ring=ring, **fsm_kwargs)
    events: list[Event] = []
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok or frame is None:
            break
        evs = pipeline.process(frame, i / fps)
        events += evs
        if on_event:
            for e in evs:
                on_event(e)
        i += 1
    cap.release()
    snap = pipeline.snapshot()
    return ReplayResult(
        path=str(p), mode=mode, fps=fps, frames=i, reps=snap["reps"],
        nhpt_total_s=snap["nhpt"]["total_s"] if snap.get("nhpt") else None,
        events=events, snapshot=snap,
    )


def write_events_jsonl(events: list[Event], out: str | Path) -> None:
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as f:
        for e in events:
            f.write(e.to_json() + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--mode", choices=["calibrate", "pegboard", "nhpt"], default="nhpt")
    ap.add_argument("--targets", default=None, help="comma-separated hole indices for pegboard mode")
    ap.add_argument("--fps", type=float, default=None, help="override the file fps")
    ap.add_argument("--events-out", default=None, help="write events JSONL here")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    targets = [int(x) for x in args.targets.split(",")] if args.targets else None
    res = run_replay(args.video, mode=args.mode, targets=targets, fps_override=args.fps)
    if args.events_out:
        write_events_jsonl(res.events, args.events_out)
    if not args.quiet:
        for e in res.events:
            if e.type not in ("frame",):
                print(e.to_json())
    print(json.dumps(res.summary(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
