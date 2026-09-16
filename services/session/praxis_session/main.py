"""FastAPI entrypoint for the Praxis session service.

Edge/privacy mode: 640x480 JPEG frames arrive over WebSocket, are decoded in memory with
OpenCV 5 (cv2.__version__ == 5.0.0 at authoring), processed, and discarded. Only JSON events
leave the process. Cloud hooks are gated behind PRAXIS_CLOUD_ENABLED (default off).
"""
from __future__ import annotations

import json
import os
import time

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from praxis_session.events import EventRing, make_event
from praxis_session.perception.hand import HAND_MODEL, MODELS_DIR, PALM_MODEL
from praxis_session.pipeline import MODES as PIPELINE_MODES, SessionPipeline

POSE_MODELS = ("person_detection_mediapipe_2023mar.onnx", "pose_estimation_mediapipe_2023mar.onnx")

CLOUD_ENABLED = os.environ.get("PRAXIS_CLOUD_ENABLED", "0") == "1"
MODES = {"heartbeat", *PIPELINE_MODES}

app = FastAPI(title="Praxis session service", version="0.2.0")
ring = EventRing()


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
            )
        except ValueError:
            await ws.send_text(make_event("error", code="bad_sheet", sheet=sheet).to_json())
            await ws.close()
            return
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
                result = pipeline.command(cmd) if pipeline is not None else {"ok": False}
                e = make_event("command", cmd=cmd.get("cmd"), **result)
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
                for e in pipeline.process(frame, time.time(), frame_index):
                    await ws.send_text(e.to_json())
            frame_index += 1
            del frame
    except WebSocketDisconnect:
        return
