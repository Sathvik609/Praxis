"""API surface: /health reports the pinned OpenCV version; /session echoes a heartbeat per frame."""
from __future__ import annotations

import json

import cv2
from fastapi.testclient import TestClient

from praxis_session.main import app


def test_health_reports_opencv_version() -> None:
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["opencv_version"] == cv2.__version__
    assert body["opencv_version"].startswith("5.")


def test_session_websocket_heartbeat_for_jpeg_frame(blank_jpeg: bytes) -> None:
    client = TestClient(app)
    with client.websocket_connect("/session") as ws:
        ws.send_bytes(blank_jpeg)
        msg = json.loads(ws.receive_text())
    assert msg["type"] == "heartbeat"
    assert msg["frame"]["width"] == 640
    assert msg["frame"]["height"] == 480
    assert msg["frame_index"] == 0
    assert isinstance(msg["t"], float)


def test_session_websocket_rejects_undecodable_frame() -> None:
    client = TestClient(app)
    with client.websocket_connect("/session") as ws:
        ws.send_bytes(b"not a jpeg")
        msg = json.loads(ws.receive_text())
    assert msg["type"] == "error"
    assert msg["code"] == "bad_frame"
