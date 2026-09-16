import cv2
import numpy as np

from praxis_session.main import decode_jpeg


def test_health_reports_opencv_5_and_edge_mode(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["opencv_version"].startswith("5.")
    assert body["mode"] == "edge"


def test_decode_jpeg_roundtrip_and_empty():
    img = np.zeros((480, 640, 3), np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    out = decode_jpeg(buf.tobytes())
    assert out is not None and out.shape == (480, 640, 3)
    assert decode_jpeg(b"") is None


def test_ws_heartbeat_echoes_frame_info(client):
    img = np.zeros((480, 640, 3), np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    with client.websocket_connect("/session?mode=heartbeat") as ws:
        ws.send_bytes(buf.tobytes())
        msg = ws.receive_json()
    assert msg["type"] == "heartbeat"
    assert msg["frame"] == {"width": 640, "height": 480, "bytes": len(buf.tobytes())}
    assert msg["frame_index"] == 0


def test_ws_bad_mode_returns_error(client):
    with client.websocket_connect("/session?mode=nope") as ws:
        msg = ws.receive_json()
    assert msg["type"] == "error" and msg["code"] == "bad_mode"


def test_events_tail_lists_recent(client):
    img = np.zeros((480, 640, 3), np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    with client.websocket_connect("/session?mode=heartbeat") as ws:
        ws.send_bytes(buf.tobytes())
        ws.receive_json()
    r = client.get("/events?n=5")
    assert r.json()["count"] >= 1
    assert r.json()["events"][-1]["type"] == "heartbeat"


def test_ws_calibrate_returns_setup_checks(client):
    from praxis_session.perception.board_spec import NHPT_BOARD
    from praxis_session.perception.synth import camera_frame

    frame, _ = camera_frame(NHPT_BOARD)
    _, buf = cv2.imencode(".jpg", frame)
    with client.websocket_connect("/session?mode=calibrate&sheet=nhpt_board") as ws:
        ws.send_bytes(buf.tobytes())
        types = [ws.receive_json()["type"] for _ in range(3)]
    assert types == ["calibration", "quality", "setup_checks"]


def test_ws_bad_sheet(client):
    with client.websocket_connect("/session?mode=calibrate&sheet=zzz") as ws:
        assert ws.receive_json()["code"] == "bad_sheet"
