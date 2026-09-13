"""FastAPI entrypoint for the Praxis session service.

Edge/privacy mode: frames arrive as 640x480 JPEG over WebSocket, are decoded in memory with
OpenCV 5 (cv2.__version__ == 5.0.0 at authoring), processed, and discarded. Only JSON events
leave the process. Cloud hooks are gated behind PRAXIS_CLOUD_ENABLED (default off).
"""
from __future__ import annotations

import os
import time

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from praxis_session.events import EventRing, make_event
from praxis_session.pipeline import SessionPipeline

CLOUD_ENABLED = os.environ.get("PRAXIS_CLOUD_ENABLED", "0") == "1"

app = FastAPI(title="Praxis session service", version="0.1.0")
ring = EventRing()


@app.get("/events")
def events(n: int = 50) -> dict[str, object]:
    """Tail of the in-process event ring (the same buffer the perception MCP server will read)."""
    return {"count": len(ring), "events": [e.to_dict() for e in ring.latest(n)]}


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


def _parse_targets(raw: str | None) -> list[int] | None:
    if not raw:
        return None
    return [int(x) for x in raw.split(",") if x.strip()]


@app.websocket("/session")
async def session_ws(
    ws: WebSocket,
    mode: str = "heartbeat",
    targets: str | None = None,
    debounce: int = 2,
    clear: int = 3,
) -> None:
    """Frame ingest. mode=heartbeat echoes frame info; calibrate|pegboard|nhpt run the pipeline.

    One pipeline per connection; every event goes to the shared ring and back over the socket
    as one JSON text message. Frames are decoded in memory and dropped after processing.
    """
    await ws.accept()
    pipeline: SessionPipeline | None = None
    if mode != "heartbeat":
        try:
            pipeline = SessionPipeline(
                mode=mode, targets=_parse_targets(targets), ring=ring,  # type: ignore[arg-type]
                debounce_frames=debounce, clear_frames=clear,
            )
        except ValueError:
            await ws.send_text(make_event("error", code="bad_mode", mode=mode).to_json())
            await ws.close()
            return
    frame_index = 0
    try:
        while True:
            data = await ws.receive_bytes()
            frame = decode_jpeg(data)
            if frame is None:
                ev = make_event("error", code="bad_frame", frame_index=frame_index)
                ring.append(ev)
                await ws.send_text(ev.to_json())
            elif pipeline is None:
                h, w = frame.shape[:2]
                ev = make_event(
                    "heartbeat",
                    frame_index=frame_index,
                    frame={"width": int(w), "height": int(h), "bytes": len(data)},
                )
                ring.append(ev)
                await ws.send_text(ev.to_json())
            else:
                for ev in pipeline.process(frame, time.time()):
                    await ws.send_text(ev.to_json())
            frame_index += 1
    except WebSocketDisconnect:
        return
