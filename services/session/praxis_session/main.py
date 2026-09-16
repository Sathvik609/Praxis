"""FastAPI entrypoint for the Praxis session service.

Edge/privacy mode: 640x480 JPEG frames arrive over WebSocket, are decoded in memory with
OpenCV 5 (cv2.__version__ == 5.0.0 at authoring), processed, and discarded. Only JSON events
leave the process. Cloud hooks are gated behind PRAXIS_CLOUD_ENABLED (default off).
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from pydantic import BaseModel

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from praxis_session.events import EventRing, make_event
from praxis_session.perception.hand import HAND_MODEL, MODELS_DIR, PALM_MODEL
from praxis_session.pipeline import MODES as PIPELINE_MODES, SessionPipeline
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.session import CoachSession
from praxis_session.store import DEFAULT_PATH, Store

POSE_MODELS = ("person_detection_mediapipe_2023mar.onnx", "pose_estimation_mediapipe_2023mar.onnx")

CLOUD_ENABLED = os.environ.get("PRAXIS_CLOUD_ENABLED", "0") == "1"
MODES = {"heartbeat", *PIPELINE_MODES}

app = FastAPI(title="Praxis session service", version="0.2.0")
ring = EventRing()
sessions: dict[str, CoachSession] = {}
store = Store(os.environ.get("PRAXIS_DB", str(DEFAULT_PATH)))
store.seed_if_empty()
EVAL_DIR = Path(__file__).resolve().parents[3] / "evaluation" / "dataset_v0"


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "praxis-session",
        "opencv_version": cv2.__version__,
        "mode": "cloud" if CLOUD_ENABLED else "edge",
        "models": {
            "hand": all((MODELS_DIR / n).exists() for n in (PALM_MODEL, HAND_MODEL)),
            "pose": all((MODELS_DIR / n).exists() for n in POSE_MODELS),
        },
    }


@app.get("/events")
def events(n: int = 50) -> dict[str, object]:
    return {"count": len(ring), "events": [e.to_dict() for e in ring.latest(n)]}


@app.get("/api/trace")
def api_trace(session: str | None = None, n: int = 100) -> dict[str, object]:
    """Decision trace rows (event -> stop rule -> decide -> tool -> action) for a session."""
    s = sessions.get(session) if session else (list(sessions.values())[-1] if sessions else None)
    if s is None:
        return {"session": None, "rows": []}
    return {"session": s.session_id, "rows": s.trace.tail(n)}


@app.get("/api/session/{session_id}/summary")
def api_summary(session_id: str) -> dict[str, object]:
    s = sessions.get(session_id)
    if s is None:
        return {"error": "unknown session"}
    return s.summary()


@app.get("/api/prescription")
def api_prescription() -> dict[str, object]:
    return store.prescription()


@app.get("/api/patients/me")
def api_me() -> dict[str, object]:
    return store.patient()


@app.get("/api/sessions")
def api_sessions(limit: int = 50) -> dict[str, object]:
    return {"sessions": store.sessions(limit)}


@app.get("/api/sessions/{session_id}")
def api_session(session_id: str) -> dict[str, object]:
    s = store.session(session_id)
    if s is None:
        live = sessions.get(session_id)
        return {"error": "unknown session"} if live is None else {"id": session_id, "live": True, "summary": live.summary()}
    return s


@app.get("/api/flags")
def api_flags() -> dict[str, object]:
    return {"flags": store.flags()}


@app.post("/api/flags/{flag_id}/reviewed")
def api_flag_reviewed(flag_id: int) -> dict[str, object]:
    store.mark_reviewed(flag_id)
    return {"ok": True}


class GoalNote(BaseModel):
    note: str = ""


@app.post("/api/goal-log")
def api_goal_log(body: GoalNote) -> dict[str, object]:
    return {"ok": True, "goal_attempts": store.log_goal(body.note)}


@app.get("/api/progress")
def api_progress() -> dict[str, object]:
    return store.progress()


@app.get("/api/therapist/patients")
def api_therapist_patients() -> dict[str, object]:
    return {"patients": store.therapist_patients()}


@app.get("/api/replay/list")
def api_replay_list() -> dict[str, object]:
    clips = []
    manifest = EVAL_DIR / "manifest.json"
    if manifest.exists():
        for e in json.loads(manifest.read_text()).get("entries", []):
            if e.get("video"):
                clips.append({"id": e["id"], "mode": e["mode"], "sheet": e.get("sheet", "nhpt_board"), "path": e["video"], "synthetic": e.get("synthetic", False)})
    return {"clips": clips}


def decode_jpeg(data: bytes) -> np.ndarray | None:
    arr = np.frombuffer(data, dtype=np.uint8)
    if arr.size == 0:
        return None
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


@app.websocket("/session")
async def session_ws(
    ws: WebSocket,
    mode: str = "heartbeat",
    sheet: str = "nhpt_board",
    debounce: int = 2,
    clear: int = 3,
    side: str = "left",
    target: float = 90.0,
    hold: float = 3.0,
    sets: int = 2,
    reps: int = 8,
) -> None:
    """Frame ingest. mode=heartbeat echoes frame info; other modes run the perception pipeline.

    One pipeline per connection; every event goes to the shared ring and back over the socket
    as one JSON text message per event. Frames are decoded in memory and dropped.
    """
    await ws.accept()
    if mode not in MODES:
        await ws.send_text(make_event("error", code="bad_mode", mode=mode).to_json())
        await ws.close()
        return
    pipeline: SessionPipeline | None = None
    if mode != "heartbeat":
        try:
            pipeline = SessionPipeline(
                mode=mode,  # type: ignore[arg-type]
                sheet=sheet,
                ring=ring,
                debounce_frames=debounce,
                clear_frames=clear,
                side=side,
                target_deg=target,
                hold_s=hold,
                sets=sets,
                reps=reps,
            )
        except ValueError:
            await ws.send_text(make_event("error", code="bad_sheet", sheet=sheet).to_json())
            await ws.close()
            return
    coach: CoachSession | None = None
    if pipeline is not None:
        coach = CoachSession(mode=mode, prescription=SEED_PRESCRIPTION)
        sessions[coach.session_id] = coach
        if len(sessions) > 50:
            sessions.pop(next(iter(sessions)))
    frame_index = 0
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                return
            if msg.get("text") is not None:
                try:
                    cmd = json.loads(msg["text"])
                except json.JSONDecodeError:
                    cmd = {}
                for e in _handle_command(cmd, pipeline, coach):
                    ring.append(e)
                    await ws.send_text(e.to_json())
                continue
            data = msg.get("bytes") or b""
            frame = decode_jpeg(data)
            if frame is None:
                await ws.send_text(make_event("error", code="bad_frame").to_json())
                continue
            if pipeline is None:
                h, w = frame.shape[:2]
                e = make_event(
                    "heartbeat",
                    frame_index=frame_index,
                    frame={"width": w, "height": h, "bytes": len(data)},
                )
                ring.append(e)
                await ws.send_text(e.to_json())
            else:
                now = time.time()
                evs = pipeline.process(frame, now, frame_index)
                for e in evs:
                    await ws.send_text(e.to_json())
                if coach is not None:
                    for e in coach.on_events(evs, pipeline.snapshot(now), now):
                        ring.append(e)
                        await ws.send_text(e.to_json())
            frame_index += 1
            del frame
    except WebSocketDisconnect:
        return


def _handle_command(cmd: dict, pipeline: SessionPipeline | None, coach: CoachSession | None) -> list:
    """Text commands from the browser: pipeline commands and coach-session inputs."""
    name = cmd.get("cmd")
    now = time.time()
    out: list = []
    if pipeline is None or coach is None:
        return [make_event("command", cmd=name, ok=False, error="no pipeline")]
    if name == "checkin":
        out += coach.on_checkin(int(cmd.get("pain", 0)), str(cmd.get("energy", "")), int(cmd.get("minutes", 0)), bool(cmd.get("new_symptoms", False)), now, rpe=cmd.get("rpe"))
        return [make_event("command", cmd=name, ok=True, session_id=coach.session_id), *out]
    if name == "pain":
        out += coach.on_pain(int(cmd.get("pain", 0)), now)
        return [make_event("command", cmd=name, ok=True, session_id=coach.session_id), *out]
    if name == "rpe":
        return [make_event("command", cmd=name, ok=True, session_id=coach.session_id), *coach.on_rpe(int(cmd.get("rpe", 0)), now)]
    if name == "pause":
        return [make_event("command", cmd=name, ok=True, session_id=coach.session_id), *coach.pause(now)]
    if name == "resume":
        return [make_event("command", cmd=name, ok=True, session_id=coach.session_id), *coach.resume(now)]
    if name == "answer":
        pcmd, evs = coach.on_answer(str(cmd.get("prompt", "")), str(cmd.get("choice", "")), now)
        result = pipeline.command(pcmd) if pcmd else {"ok": True}
        return [make_event("command", cmd=name, session_id=coach.session_id, **result), *evs]
    if name == "feedback":
        coach.feedback = {k: v for k, v in cmd.items() if k != "cmd"}
        coach.trace.log("feedback", **coach.feedback)
        summary = coach.summary(now)
        store.save_session(summary, coach.checkin, coach.feedback, [r for r in coach.trace.tail(2000) if r.get("kind") == "event"])
        return [make_event("command", cmd=name, ok=True, session_id=coach.session_id, summary=summary)]
    result = pipeline.command(cmd)
    return [make_event("command", cmd=name, session_id=coach.session_id, **result)]
