"""FastAPI entrypoint for the Praxis session service.

Edge/privacy mode: 640x480 JPEG frames arrive over WebSocket, are decoded in memory with
OpenCV 5 (cv2.__version__ == 5.0.0 at authoring), processed, and discarded. Only JSON events
leave the process. Cloud hooks are gated behind PRAXIS_CLOUD_ENABLED (default off).
"""
from __future__ import annotations

import os

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from praxis_session.events import EventRing, make_event

CLOUD_ENABLED = os.environ.get("PRAXIS_CLOUD_ENABLED", "0") == "1"
MODES = {"heartbeat"}

app = FastAPI(title="Praxis session service", version="0.2.0")
ring = EventRing()


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "praxis-session",
        "opencv_version": cv2.__version__,
        "mode": "cloud" if CLOUD_ENABLED else "edge",
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
async def session_ws(ws: WebSocket, mode: str = "heartbeat") -> None:
    await ws.accept()
    if mode not in MODES:
        await ws.send_text(make_event("error", code="bad_mode", mode=mode).to_json())
        await ws.close()
        return
    frame_index = 0
    try:
        while True:
            data = await ws.receive_bytes()
            frame = decode_jpeg(data)
            if frame is None:
                await ws.send_text(make_event("error", code="bad_frame").to_json())
                continue
            h, w = frame.shape[:2]
            e = make_event(
                "heartbeat",
                frame_index=frame_index,
                frame={"width": w, "height": h, "bytes": len(data)},
            )
            ring.append(e)
            await ws.send_text(e.to_json())
            frame_index += 1
            del frame
    except WebSocketDisconnect:
        return
