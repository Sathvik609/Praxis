"""Record one consented evaluation clip (OpenCV cv2.__version__ == 5.0.0: VideoCapture,
VideoWriter, imshow).

    uv run python tools/record_session.py record            # asks everything it needs
    uv run python tools/record_session.py record --participant p01 --exercise flexion --side left
    uv run python tools/record_session.py purge-expired [--dry-run]   # 30-day deletion
    uv run python tools/record_session.py withdraw p03 [--remove-derived]

`record` asks for the participant pseudonym, the exercise (the five camera-coached registry
entries only), the side and the setup notes, then the consent confirmation: the participant
must type `yes` or nothing is recorded. It writes a consent record (date + 30-day deletion
date), shows a 3-2-1 countdown in a preview window, records 640x480 at 15 fps until Space/q
(or `--seconds`), and writes the clip and its sidecar under
evaluation/dataset_v1/raw/<participant>/<exercise>/. The preview overlay (countdown, REC dot,
prompts) is drawn on the preview only, never into the file. Clips are git-ignored and never
leave this laptop; run `purge-expired` daily (PROTOCOL.md).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import platform
import sys
import time
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import dataset_v1 as ds  # noqa: E402

WINDOW = "Praxis recorder"
PROMPTS = {
    "pendulum": "Side view. Lean on the table, let the arm hang, swing gently.",
    "flexion": "Side view, seated. Lift the arm to the front to shoulder height, hold 3 s.",
    "abduction": "Front view, seated. Lift the arm out to the side to shoulder height, hold 3 s.",
    "cup": "Table view. Cup on dot 1, hand in lap. Two slow arcs, then two fast.",
    "nhpt": "Table view. Pegs in the dish. First lift starts the timer; nine pegs, any holes.",
}


def ask(prompt: str, default: str | None = None, check: Callable[[str], str] | None = None,
        inp: Callable[[str], str] = input) -> str:
    while True:
        raw = inp(f"{prompt}{f' [{default}]' if default else ''}: ").strip()
        val = raw or (default or "")
        try:
            return check(val) if check else val
        except ValueError as e:
            print(f"  {e}")


def overlay(frame: np.ndarray, lines: list[str], rec: bool = False, big: str | None = None) -> np.ndarray:
    """Preview-only annotations (the file gets the untouched frame)."""
    v = frame.copy()
    for i, s in enumerate(lines):
        cv2.putText(v, s, (12, 28 + 26 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4, cv2.LINE_AA)
        cv2.putText(v, s, (12, 28 + 26 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    if rec:
        cv2.circle(v, (v.shape[1] - 30, 30), 10, (43, 56, 185), -1, cv2.LINE_AA)
        cv2.putText(v, "REC", (v.shape[1] - 90, 37), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (43, 56, 185), 2, cv2.LINE_AA)
    if big:
        (w, h), _ = cv2.getTextSize(big, cv2.FONT_HERSHEY_SIMPLEX, 5, 10)
        org = ((v.shape[1] - w) // 2, (v.shape[0] + h) // 2)
        cv2.putText(v, big, org, cv2.FONT_HERSHEY_SIMPLEX, 5, (0, 0, 0), 16, cv2.LINE_AA)
        cv2.putText(v, big, org, cv2.FONT_HERSHEY_SIMPLEX, 5, (133, 169, 47), 10, cv2.LINE_AA)
    return v


def record_clip(
    cap: Any,
    out_path: Path,
    fps: float = ds.FPS,
    size: tuple[int, int] = ds.SIZE,
    seconds: float | None = None,
    countdown_s: int = 3,
    show: bool = True,
    prompt: str = "",
    max_frames: int | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """Countdown, then write frames paced to `fps` (extra camera frames are dropped, so a 30 fps
    webcam still yields a 15 fps file) until Space/q, `seconds` or `max_frames`.
    Returns {frames, duration_s, fps_measured}."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".part.mp4")
    writer = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    if not writer.isOpened():
        raise RuntimeError("cannot open a video writer (mp4v)")

    def grab() -> np.ndarray | None:
        ok, f = cap.read()
        if not ok or f is None:
            return None
        return f if (f.shape[1], f.shape[0]) == size else cv2.resize(f, size, interpolation=cv2.INTER_AREA)

    def key() -> int:
        return cv2.waitKey(1) & 0xFF if show else -1

    t0 = clock()
    while show and clock() - t0 < countdown_s:
        f = grab()
        if f is None:
            break
        n = countdown_s - int(clock() - t0)
        cv2.imshow(WINDOW, overlay(f, [prompt, "Get into the start position"], big=str(n)))
        if key() in (27,):
            writer.release()
            tmp.unlink(missing_ok=True)
            raise KeyboardInterrupt("cancelled during countdown")
    frames = 0
    start = clock()
    next_t = start
    try:
        while True:
            f = grab()
            if f is None:
                break
            now = clock()
            if now >= next_t or not show:
                writer.write(f)
                frames += 1
                next_t += 1.0 / fps
                if next_t < now - 1.0 / fps:  # camera stalled: do not burst-write to catch up
                    next_t = now + 1.0 / fps
            if show:
                el = now - start
                cv2.imshow(WINDOW, overlay(f, [prompt, f"{el:5.1f} s  {frames} frames", "Space or q: stop"], rec=True))
                if key() in (ord(" "), ord("q"), 27):
                    break
            if seconds is not None and clock() - start >= seconds:
                break
            if max_frames is not None and frames >= max_frames:
                break
    finally:
        writer.release()
        if show:
            cv2.destroyWindow(WINDOW)
    dur = max(clock() - start, 1e-6)
    tmp.replace(out_path)
    return {"frames": frames, "duration_s": round(dur, 2), "fps_measured": round(frames / dur, 2)}


def cmd_record(args: argparse.Namespace, inp: Callable[[str], str] = input, cap: Any = None) -> int:
    reg = ds.coached()
    print("Praxis evaluation recorder. Pseudonyms only (p01, p02, ...), never names.")
    participant = args.participant or ask("Participant pseudonym", check=ds.check_participant, inp=inp)
    participant = ds.check_participant(participant)
    print("Exercises: " + ", ".join(f"{k} ({v.name})" for k, v in reg.items()))
    exercise = ds.check_exercise(args.exercise or ask("Exercise id", check=ds.check_exercise, inp=inp))
    ex = reg[exercise]

    def side_ok(s: str) -> str:
        if s not in ("left", "right"):
            raise ValueError("left or right")
        return s

    side = side_ok(args.side or ask("Practising side (left/right)", "left", side_ok, inp=inp))
    view = args.view or ask("Camera view", ex.view, inp=inp)
    camera_note = args.camera_note if args.camera_note is not None else ask(
        "Camera placement (height, distance)", {"side": "side, shoulder height, 1.5-2 m", "front": "front, chest height, 2-2.5 m", "sheet": "above table, 45-60 cm"}[ex.view], inp=inp)
    lighting = args.lighting if args.lighting is not None else ask("Lighting note", "room light, window behind camera", inp=inp)
    planned = args.errors if args.errors is not None else ask("Planned deliberate errors (comma list or blank)", "", inp=inp)
    planned_errors = [s.strip() for s in planned.split(",") if s.strip()]
    print()
    print("Read to the participant: 'This clip stays on this laptop, is never uploaded, and is")
    print("deleted within 30 days or whenever you ask. Only measurements from it are kept.'")
    confirmation = inp("Participant consents to this recording - type yes: ")
    record = ds.consent_record(participant, confirmation, today=args.today, recorded_by=args.by or "")
    demo = inp("May the clip also run in the in-app Replay demo on this laptop? (yes/no) [no]: ")
    record["replay_demo"] = demo.strip().lower() == "yes"
    consent_path = ds.write_consent(record, Path(args.consent_dir))

    ts = ds.stamp()
    paths = ds.clip_paths(Path(args.raw_dir), participant, exercise, ts)
    own_cap = cap is None
    if own_cap:
        cap = cv2.VideoCapture(args.camera)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, ds.SIZE[0])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, ds.SIZE[1])
        cap.set(cv2.CAP_PROP_FPS, ds.FPS)
        if not cap.isOpened():
            print(f"cannot open camera {args.camera}")
            return 2
    try:
        stats = record_clip(cap, paths["video"], seconds=args.seconds, show=not args.no_preview,
                            prompt=PROMPTS[exercise], max_frames=args.max_frames)
    finally:
        if own_cap:
            cap.release()
    cid = ds.clip_id(participant, exercise, ts)
    ds.add_clip_to_consent(consent_path, cid)
    device = args.device or f"{platform.system()} {platform.machine()} · camera {args.camera}"
    side_meta = ds.build_sidecar(
        participant, exercise, ts, side, record, str(consent_path.relative_to(ds.ROOT)) if consent_path.is_relative_to(ds.ROOT) else str(consent_path),
        view=view, camera_note=camera_note, lighting=lighting, device=device,
        fps_measured=stats["fps_measured"], frames=stats["frames"], planned_errors=planned_errors,
    )
    paths["sidecar"].write_text(json.dumps(side_meta, indent=1) + "\n")
    print(json.dumps({"clip_id": cid, "video": str(paths["video"]), **stats}, indent=1))
    if stats["fps_measured"] < ds.FPS * 0.9:
        print(f"WARNING: measured {stats['fps_measured']} fps < 13.5: replay time will stretch. Check light/camera and re-record.")
    print(f"Next: uv run python tools/label_clip.py {paths['video']}")
    return 0


def main(argv: list[str] | None = None, inp: Callable[[str], str] = input, cap: Any = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw-dir", default=str(ds.RAW_DIR))
    ap.add_argument("--consent-dir", default=str(ds.CONSENT_DIR))
    ap.add_argument("--failure-dir", default=str(ds.FAILURE_DIR))
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record", help="record one consented clip")
    r.add_argument("--participant")
    r.add_argument("--exercise")
    r.add_argument("--side", choices=["left", "right"])
    r.add_argument("--view")
    r.add_argument("--camera-note", dest="camera_note")
    r.add_argument("--lighting")
    r.add_argument("--errors", help="planned deliberate errors, comma list")
    r.add_argument("--device")
    r.add_argument("--by", help="initials of the team member recording")
    r.add_argument("--camera", type=int, default=0)
    r.add_argument("--seconds", type=float, default=None)
    r.add_argument("--max-frames", type=int, default=None)
    r.add_argument("--no-preview", action="store_true")
    r.add_argument("--today", type=dt.date.fromisoformat, default=None, help=argparse.SUPPRESS)
    p = sub.add_parser("purge-expired", help="delete clips past their 30-day date")
    p.add_argument("--today", type=dt.date.fromisoformat, default=None)
    p.add_argument("--dry-run", action="store_true")
    w = sub.add_parser("withdraw", help="consent withdrawn: delete a participant's clips now")
    w.add_argument("participant")
    w.add_argument("--remove-derived", action="store_true", help="also remove sidecars, labels and cached events")
    w.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    if args.cmd == "record":
        try:
            return cmd_record(args, inp=inp, cap=cap)
        except PermissionError as e:
            print(e)
            return 3
    if args.cmd == "purge-expired":
        res = ds.purge_expired(Path(args.raw_dir), today=args.today, dry_run=args.dry_run, failure_dir=Path(args.failure_dir))
    else:
        res = ds.withdraw(args.participant, Path(args.raw_dir), dry_run=args.dry_run, failure_dir=Path(args.failure_dir), remove_derived=args.remove_derived)
    print(json.dumps({"dry_run": args.dry_run, "deleted": res}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
