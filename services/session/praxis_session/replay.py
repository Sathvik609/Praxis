"""Replay mode: play a recorded clip through the identical SessionPipeline (no webcam).

This is the guaranteed judge fallback. Timestamps are derived from the file's fps and frame
index, so results are deterministic. Uses cv2.VideoCapture (cv2.__version__ == 5.0.0).

    uv run python -m praxis_session.replay clip.mp4 --mode nhpt [--events-out ev.jsonl] [--quiet]
    uv run python -m praxis_session.replay --list          # every clip the app can replay

Clip discovery (`list_replay_clips`) has two sources:
  1. the synthetic dataset_v0 manifest (OpenCV renders, listed with `synthetic: true`);
  2. any `<name>.mp4` with a `<name>.json` sidecar naming a camera-coached exercise under the
     replay folders (`evaluation/dataset_v1/raw` and `evaluation/replay`, or
     `PRAXIS_REPLAY_DIRS`, os.pathsep-separated). A real (non-synthetic) clip is listed only if
     its sidecar carries the participant's replay-demo consent, the 30-day deletion date has not
     passed and the clip has not been deleted. Nothing is fabricated: no clip, no entry.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2

from praxis_session.events import Event, EventRing
from praxis_session.pipeline import MODES, Mode, SessionPipeline


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
    models: dict[str, bool] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        counts: dict[str, int] = {}
        for e in self.events:
            counts[e.type] = counts.get(e.type, 0) + 1
        return {
            "path": self.path,
            "mode": self.mode,
            "fps": self.fps,
            "frames": self.frames,
            "reps": self.reps,
            "nhpt_total_s": self.nhpt_total_s,
            "event_counts": counts,
            "snapshot": self.snapshot,
            "models": self.models,
        }


REPO = Path(__file__).resolve().parents[3]
DEFAULT_V0_DIR = REPO / "evaluation" / "dataset_v0"
DEFAULT_REPLAY_DIRS: tuple[Path, ...] = (REPO / "evaluation" / "dataset_v1" / "raw", REPO / "evaluation" / "replay")
SHEET_BY_PIPELINE = {"nhpt": "nhpt_board", "cup": "cup_targets", "arm": "none"}


@dataclass(frozen=True)
class ReplayClip:
    id: str
    exercise: str  # visible registry id (nhpt, cup, abduction)
    pipeline: str  # SessionPipeline mode (nhpt, cup, arm)
    sheet: str
    path: Path
    synthetic: bool
    source: str  # "manifest" (dataset_v0) or "sidecar"
    side: str | None = None
    view: str | None = None
    name: str = ""

    def to_api(self) -> dict[str, Any]:
        """`mode` is the registry exercise id: the web routes `/session?exercise=<mode>` on it
        (identical to the pipeline mode for nhpt and cup, the arm exercise id otherwise)."""
        return {
            "id": self.id,
            "mode": self.exercise,
            "exercise": self.exercise,
            "name": self.name,
            "pipeline": self.pipeline,
            "sheet": self.sheet,
            "side": self.side,
            "view": self.view,
            "path": self.path.name,
            "synthetic": self.synthetic,
            "source": self.source,
        }


def replay_dirs() -> list[Path]:
    env = os.environ.get("PRAXIS_REPLAY_DIRS")
    if env is not None:
        return [Path(p) for p in env.split(os.pathsep) if p]
    return list(DEFAULT_REPLAY_DIRS)


def _coached() -> dict[str, Any]:
    from praxis_session.perception.exercises import EXERCISES

    # 28 Sep: a hidden exercise (Pendulum, Arm to the front) is never offered for replay
    return {k: ex for k, ex in EXERCISES.items() if ex.mode == "coached" and ex.pipeline and ex.visible}


def _sidecar_clip(sidecar: Path, meta: dict[str, Any], today: dt.date) -> ReplayClip | None:
    ex = _coached().get(str(meta.get("exercise", "")))
    video = sidecar.with_suffix(".mp4")
    if ex is None or not video.exists():
        return None
    synthetic = bool(meta.get("synthetic", False))
    if not synthetic:
        consent = meta.get("consent") or {}
        try:
            until = dt.date.fromisoformat(str(consent.get("delete_after")))
        except ValueError:
            return None
        if not consent.get("replay_demo") or today >= until or meta.get("clip_deleted_on"):
            return None
    return ReplayClip(
        id=str(meta.get("clip_id") or sidecar.stem),
        exercise=ex.id,
        pipeline=ex.pipeline,
        sheet=SHEET_BY_PIPELINE[ex.pipeline],
        path=video,
        synthetic=synthetic,
        source="sidecar",
        side=meta.get("side"),
        view=meta.get("view") or ex.view,
        name=ex.name,
    )


def list_replay_clips(
    v0_dir: Path | None = None, dirs: list[Path] | None = None, today: dt.date | None = None
) -> list[ReplayClip]:
    """Every clip the app may replay, synthetic renders first; ids are unique."""
    v0_dir = DEFAULT_V0_DIR if v0_dir is None else Path(v0_dir)
    today = today or dt.date.today()
    reg = _coached()
    out: dict[str, ReplayClip] = {}
    manifest = v0_dir / "manifest.json"
    if manifest.exists():
        for e in json.loads(manifest.read_text()).get("entries", []):
            video = v0_dir / str(e.get("video", ""))
            if not e.get("video") or not video.exists() or e.get("mode") not in reg:
                continue
            out[e["id"]] = ReplayClip(
                id=e["id"], exercise=e["mode"], pipeline=e["mode"], sheet=e.get("sheet", "nhpt_board"),
                path=video, synthetic=bool(e.get("synthetic", False)), source="manifest",
                side=e.get("side"), view=reg[e["mode"]].view, name=reg[e["mode"]].name,
            )
    for d in replay_dirs() if dirs is None else dirs:
        if not Path(d).exists():
            continue
        for sc in sorted(Path(d).rglob("*.json")):
            if sc.name.endswith((".labels.json", ".pred.json")):
                continue
            try:
                meta = json.loads(sc.read_text())
            except (OSError, ValueError):
                continue
            clip = _sidecar_clip(sc, meta, today) if isinstance(meta, dict) else None
            if clip is not None and clip.id not in out:
                out[clip.id] = clip
    return list(out.values())


def find_replay_clip(
    clip_id: str, v0_dir: Path | None = None, dirs: list[Path] | None = None, today: dt.date | None = None
) -> ReplayClip | None:
    return next((c for c in list_replay_clips(v0_dir, dirs, today) if c.id == clip_id), None)


def run_replay(
    path: str | Path,
    mode: Mode = "nhpt",
    sheet: str = "nhpt_board",
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
    pipeline = SessionPipeline(mode=mode, sheet=sheet, ring=ring, **fsm_kwargs)
    events: list[Event] = []
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok or frame is None:
            break
        evs = pipeline.process(frame, i / fps, i)
        events += evs
        if on_event:
            for e in evs:
                on_event(e)
        i += 1
    cap.release()
    snap = pipeline.snapshot((i - 1) / fps if i else 0.0)
    return ReplayResult(
        path=str(p),
        mode=mode,
        fps=fps,
        frames=i,
        reps=snap["reps"],
        nhpt_total_s=snap["nhpt"]["total_s"] if snap.get("nhpt") else None,
        events=events,
        snapshot=snap,
        models={"hand": pipeline._hand is not None, "pose": pipeline._pose is not None},
    )


def run_landmark_replay(
    path: str | Path,
    side: str = "left",
    ring: EventRing | None = None,
    on_event: Any = None,
    **fsm_kwargs: Any,
) -> ReplayResult:
    """Arm mode from a JSONL landmark stream ({t, landmarks_px[33][2]} per line)."""
    import json

    import numpy as np

    from praxis_session.perception.pose import PoseResult

    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(p)
    pipeline = SessionPipeline(
        mode="arm", sheet="none", ring=ring, use_hand=False, use_pose=False, side=side, **fsm_kwargs
    )
    events: list[Event] = []
    i = 0
    t = 0.0
    for line in p.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        t = float(row["t"])
        lm = row.get("landmarks_px")
        res = None
        if lm is not None:
            res = PoseResult(
                landmarks_px=np.asarray(lm, np.float32),
                visibility=np.ones(33, np.float32),
                world=np.zeros((33, 3), np.float32),
                conf=1.0,
            )
        evs = pipeline.process_pose(res, t, i)
        events += evs
        if on_event:
            for e in evs:
                on_event(e)
        i += 1
    snap = pipeline.snapshot(t)
    return ReplayResult(
        path=str(p),
        mode="arm",
        fps=0.0,
        frames=i,
        reps=snap["reps"],
        nhpt_total_s=None,
        events=events,
        snapshot=snap,
    )


def write_events_jsonl(events: list[Event], out: str | Path) -> None:
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as f:
        for e in events:
            f.write(e.to_json() + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("video", nargs="?")
    ap.add_argument("--list", action="store_true", help="list every replayable clip and exit")
    ap.add_argument("--mode", choices=list(MODES), default="nhpt")
    ap.add_argument("--exercise", default=None, help="arm mode: registry id (pendulum, flexion, abduction)")
    ap.add_argument("--sheet", default="nhpt_board")
    ap.add_argument("--fps", type=float, default=None, help="override the file fps")
    ap.add_argument("--events-out", default=None, help="write events JSONL here")
    ap.add_argument("--debounce", type=int, default=2)
    ap.add_argument("--clear", type=int, default=3)
    ap.add_argument("--side", default="left")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    if args.list:
        print(json.dumps([c.to_api() for c in list_replay_clips()], indent=2))
        return 0
    if not args.video:
        ap.error("a video (or --list) is required")
    extra = {"exercise": args.exercise} if args.exercise else {}
    if str(args.video).endswith(".jsonl"):
        res = run_landmark_replay(args.video, side=args.side, **extra)
    elif args.mode == "arm":
        res = run_replay(args.video, mode="arm", sheet="none", fps_override=args.fps, side=args.side, **extra)
    else:
        res = run_replay(
            args.video,
            mode=args.mode,
            sheet=args.sheet,
            fps_override=args.fps,
            debounce_frames=args.debounce,
            clear_frames=args.clear,
        )
    if args.events_out:
        write_events_jsonl(res.events, args.events_out)
    if not args.quiet:
        for e in res.events:
            if e.type != "frame":
                print(e.to_json())
    print(json.dumps(res.summary(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
