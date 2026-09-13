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


def _jpeg(frame) -> bytes:
    import cv2 as _cv2
    ok, buf = _cv2.imencode(".jpg", frame, [_cv2.IMWRITE_JPEG_QUALITY, 90])
    assert ok
    return buf.tobytes()


def test_session_websocket_pegboard_mode_streams_pipeline_events() -> None:
    from tests.synth import perspective_from_mm, render_frame

    H = perspective_from_mm()
    client = TestClient(app)
    with client.websocket_connect("/session?mode=pegboard&targets=4&debounce=1&clear=1") as ws:
        ws.send_bytes(_jpeg(render_frame(H, pegs_mm=[(160.0, 148.5)])))
        msgs = [json.loads(ws.receive_text()) for _ in range(2)]
    types = [m["type"] for m in msgs]
    assert types == ["calibration", "frame"]
    assert msgs[0]["calibrated"] is True
    assert msgs[1]["fsm"]["state"] == "at_source"
    assert msgs[1]["overlay"]["target"] == 4
    assert msgs[1]["frame_index"] == 0


def test_session_websocket_rejects_unknown_mode() -> None:
    client = TestClient(app)
    with client.websocket_connect("/session?mode=bogus") as ws:
        msg = json.loads(ws.receive_text())
    assert msg["type"] == "error" and msg["code"] == "bad_mode"


def test_events_endpoint_returns_ring_tail() -> None:
    client = TestClient(app)
    r = client.get("/events?n=5")
    assert r.status_code == 200
    body = r.json()
    assert "events" in body and isinstance(body["events"], list)
    assert body["count"] >= len(body["events"])
