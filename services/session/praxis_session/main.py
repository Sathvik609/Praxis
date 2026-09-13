"""FastAPI entrypoint for the Praxis session service.

Edge/privacy mode: frames arrive as 640x480 JPEG over WebSocket, are decoded in memory with
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

app = FastAPI(title="Praxis session service", version="0.1.0")
ring = EventRing()


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "praxis-session",
        "opencv_version": cv2.__version__,
        "mode": "cloud" if CLOUD_ENABLED else "edge",
    }


def decode_jpeg(data: bytes) -> np.ndarray | None:
    arr = np.frombuffer(data, dtype=np.uint8)
    if arr.size == 0:
        return None
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


@app.websocket("/session")
async def session_ws(ws: WebSocket) -> None:
    await ws.accept()
    frame_index = 0
    try:
        while True:
            data = await ws.receive_bytes()
            frame = decode_jpeg(data)
            if frame is None:
                ev = make_event("error", code="bad_frame", frame_index=frame_index)
            else:
                h, w = frame.shape[:2]
                ev = make_event(
                    "heartbeat",
                    frame_index=frame_index,
                    frame={"width": int(w), "height": int(h), "bytes": len(data)},
                )
            ring.append(ev)
            await ws.send_text(ev.to_json())
            frame_index += 1
    except WebSocketDisconnect:
        return
