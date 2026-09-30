"""Record, offline, the event streams the static design preview (`pnpm build:design`) replays
where the live service has no replay clip to record: the Arm out to the side session, and the
Camera setup (`mode=calibrate`) streams for the three exercises.

Camera setup always runs on the live camera, so there is nothing to replay over the service's
socket; here the repo's synthetic sheet renders (`evaluation/dataset_v0/synthetic_{nhpt,cup}_01.mp4`)
go through the service's own `SessionPipeline(mode="calibrate")` and the calibration / quality /
setup_checks events are stored (12 s each). The arm setup needs no sheet, so its frames are a
plain OpenCV render made here: the front-view stick figure of the arm stream below, framed at
1.5x (upper body filling the picture, as the setup copy asks) on a lit wall, swaying a few pixels as a seated person does, with Gaussian sensor noise (sigma 6) as a
webcam has; `for=arm`, so the person row is the service's own motion-energy presence fallback
deciding on those frames.

Arm out to the side session:

There is no replay video for the arm exercise (the replay list has the NHPT and cup renders
only), so this runs the repo's synthetic 33-point landmark stream
(`evaluation/dataset_v0/synthetic_arm_01.jsonl`, 15 fps, left side) through the service's own
`SessionPipeline.process_pose` + `CoachSession`, emitting the messages the WebSocket would send
(frame events with the latency block, coach events, coach-applied commands).

That stream is a side-view figure (it was made for Arm to the front, now hidden); Arm out to the
side needs the front view, so the other shoulder and hip are moved out to 0.8 torso lengths
(the test suite's `figure(frontal=True)` geometry) and the other arm hangs. The practising arm's
image-plane angle is unchanged. `pose.landmarks_px`/`visibility` are dropped from frame events
(the web app never reads them; the overlay uses `overlay.skeleton_px`) to keep the bundle small.
Nothing is written to the repo: the SQLite store and traces go to a temp dir.

    cd services/session && uv run python ../../web/scripts/record-design-streams.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="praxis-design-")
os.environ.setdefault("PRAXIS_DB", str(Path(_TMP) / "praxis.db"))
os.environ.setdefault("PRAXIS_TRACE_DIR", _TMP)

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from praxis_session import main as svc  # noqa: E402
from praxis_session.perception.pose import PoseResult  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SRC = REPO / "evaluation" / "dataset_v0" / "synthetic_arm_01.jsonl"
WS_DIR = REPO / "web" / "src" / "designPreview" / "fixtures" / "ws"
OUT = WS_DIR / "abduction.json"
DATASET = REPO / "evaluation" / "dataset_v0"
SETUP_SECONDS = 12.0


def frontal(lm: np.ndarray) -> np.ndarray:
    """Side view -> front view for the left arm: right shoulder/hip 0.8 torso lengths to image-left
    of the left ones (the left arm moves to image-right, away from the body), right arm hanging."""
    lm = lm.copy()
    torso = float(np.linalg.norm(lm[11] - lm[23])) or 200.0
    sep = np.array([-0.8 * torso, 0.0], np.float32)
    lm[12], lm[24] = lm[11] + sep, lm[23] + sep
    lm[14] = lm[12] + np.array([-0.05 * torso, 0.6 * torso], np.float32)
    lm[16] = lm[14] + np.array([0.0, 0.5 * torso], np.float32)
    return lm


def figure_frames(fps: float = 15.0):
    """Front-view stick figure (the arm stream's landmarks) on a lit wall, with sensor noise."""
    rows = [json.loads(line) for line in SRC.read_text().splitlines() if line.strip()]
    rng = np.random.default_rng(7)
    bones = [(11, 13), (13, 15), (12, 14), (14, 16), (11, 12), (11, 23), (12, 24), (23, 24)]
    for i, row in enumerate(rows[: int(SETUP_SECONDS * fps) + 1]):
        sway = np.array([4.0 * np.sin(2 * np.pi * 0.4 * i / fps), 2.0 * np.sin(2 * np.pi * 0.25 * i / fps)], np.float32)
        lm = frontal(np.asarray(row["landmarks_px"], np.float32))
        lm = (lm - np.array([320.0, 300.0], np.float32)) * 1.5 + np.array([400.0, 300.0], np.float32) + sway  # upper body framed as the setup asks
        img = np.full((480, 640, 3), (178, 190, 196), np.uint8)
        pts = lambda k: tuple(int(v) for v in lm[k])  # noqa: E731
        torso = np.array([lm[11], lm[12], lm[24], lm[23]], np.int32)
        cv2.fillConvexPoly(img, torso, (92, 110, 60))
        for a, b in bones:
            cv2.line(img, pts(a), pts(b), (70, 86, 48), 18, cv2.LINE_AA)
        head = (lm[11] + lm[12]) / 2 + np.array([0, -0.35 * np.linalg.norm(lm[11] - lm[23])])
        cv2.circle(img, tuple(int(v) for v in head), 34, (120, 150, 190), -1, cv2.LINE_AA)
        noisy = np.clip(img.astype(np.int16) + rng.normal(0, 6, img.shape).astype(np.int16), 0, 255).astype(np.uint8)
        yield noisy


def record_setup(key: str, video: str | None, sheet: str, for_mode: str) -> None:
    cap = cv2.VideoCapture(str(DATASET / video)) if video else None
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or 15.0 if cap else 15.0
    frames = figure_frames(fps) if cap is None else None
    pipeline = svc.SessionPipeline(mode="calibrate", sheet=sheet, ring=svc.ring, for_mode=for_mode or None)
    messages: list[dict] = []
    i = 0
    while i / fps < SETUP_SECONDS:
        if cap is not None:
            ok, frame = cap.read()
        else:
            frame = next(frames, None)
            ok = frame is not None
        if not ok or frame is None:
            break
        t = i / fps
        for e in pipeline.process(frame, t, i):
            messages.append({"at": round(t * 1000), "msg": e.to_dict()})
        i += 1
    if cap is not None:
        cap.release()
    rec = {
        "exercise": key,
        "mode": "calibrate",
        "clip": video.removesuffix(".mp4") if video else "figure_render",
        "source": (f"evaluation/dataset_v0/{video} (synthetic OpenCV render)" if video else "an OpenCV render of the synthetic front-view arm figure with body sway and sensor noise (no sheet)")
        + f" run offline through the service's SessionPipeline(mode=calibrate, sheet={sheet}{', for=' + for_mode if for_mode else ''})",
        "synthetic_clip": True,
        "session_id": None,
        "summary": None,
        "trace": None,
        "messages": messages,
    }
    (WS_DIR / f"calibrate-{key}.json").write_text(json.dumps(rec, default=float))
    print(f"calibrate-{key}: {len(messages)} messages over {i / fps:.1f}s", file=sys.stderr)


def main() -> None:
    record_setup("nhpt", "synthetic_nhpt_01.mp4", "nhpt_board", "")
    record_setup("cup", "synthetic_cup_01.mp4", "cup_targets", "")
    record_setup("arm", None, "nhpt_board", "arm")  # the web app sends sheet=nhpt_board with for=arm

    rows = [json.loads(line) for line in SRC.read_text().splitlines() if line.strip()]
    pipeline = svc.SessionPipeline(mode="arm", sheet="none", ring=svc.ring, side="left", exercise="abduction", tier="full")
    # Marked as a replay (source: replay) so a preview report never passes it off as the patient's own session.
    coach = svc.CoachSession(mode="arm", prescription=svc.SEED_PRESCRIPTION, exercise="abduction", replay_clip="synthetic_arm_01")
    messages: list[dict] = []

    def emit(e, t: float) -> None:
        messages.append({"at": round(t * 1000), "msg": e.to_dict()})

    # What the app sends on open when a check-in is stored (useSessionFlow): a pain-2 day.
    for e in svc._handle_command({"cmd": "checkin", "pain": 2, "energy": "ok", "minutes": 10, "new_symptoms": False}, pipeline, coach, now=0.0):
        emit(e, 0.0)
    t = 0.0
    for i, row in enumerate(rows):
        t = float(row["t"])
        res = PoseResult(
            landmarks_px=frontal(np.asarray(row["landmarks_px"], np.float32)),
            visibility=np.ones(33, np.float32),
            world=np.zeros((33, 3), np.float32),
            conf=0.9,
        )
        evs = pipeline.process_pose(res, t, i)
        for e in evs:
            if e.type == "frame":
                e = svc._replace_event(e, payload={**e.payload, "pose": {k: v for k, v in e.payload["pose"].items() if k not in ("landmarks_px", "visibility")}})
                lat = {"capture_to_event_ms": None, "proc_ms": e.payload.get("proc_ms", 0.0)}
                e = svc._replace_event(e, payload={**e.payload, "t_capture": None, "dropped": 0, "latency": lat})
            emit(e, t)
        for e in coach.on_events(evs, pipeline.snapshot(t), t):
            if e.type == "coach":
                e = svc._replace_event(e, payload={**e.payload, "latency": {"event_to_cue_ms": 0.5, "capture_to_cue_ms": None}})
            emit(e, t)
        for e in svc._apply_coach_commands(pipeline, coach):
            emit(e, t)
    rec = {
        "exercise": "abduction",
        "mode": "arm",
        "clip": "synthetic_arm_01",
        "source": "synthetic 33-point landmark stream (evaluation/dataset_v0/synthetic_arm_01.jsonl, side view re-posed to a front view) run offline through the service's SessionPipeline.process_pose + rule coach; no replay video exists for this exercise",
        "synthetic_clip": True,
        "session_id": coach.session_id,
        "summary": coach.summary(t),
        "trace": {"session": coach.session_id, "rows": coach.trace.tail(200)},
        "messages": messages,
    }
    OUT.write_text(json.dumps(rec, default=float))
    types: dict[str, int] = {}
    for m in messages:
        types[m["msg"]["type"]] = types.get(m["msg"]["type"], 0) + 1
    print(f"{OUT}: {len(messages)} messages over {t:.1f}s {types}", file=sys.stderr)


if __name__ == "__main__":
    main()
