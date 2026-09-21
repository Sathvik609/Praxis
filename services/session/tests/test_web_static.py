"""Single-origin deploy: the built web app is served by FastAPI next to /api and the WebSocket."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from praxis_session.web import mount_web


def _dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Praxis</title>")
    (dist / "assets" / "app.js").write_text("console.log('praxis')")
    (dist / "favicon.svg").write_text("<svg/>")
    return dist


def test_mount_web_returns_false_without_a_build(tmp_path):
    app = FastAPI()
    assert mount_web(app, tmp_path / "missing") is False


def test_spa_routes_fall_back_to_index_and_api_routes_win(tmp_path):
    app = FastAPI()

    @app.get("/api/ping")
    def ping():
        return {"ok": True}

    assert mount_web(app, _dist(tmp_path)) is True
    c = TestClient(app)
    assert "Praxis" in c.get("/").text
    assert "Praxis" in c.get("/session?exercise=nhpt&hand=left").text
    assert "Praxis" in c.get("/therapist").text
    assert c.get("/assets/app.js").text == "console.log('praxis')"
    assert c.get("/favicon.svg").text == "<svg/>"
    assert c.get("/api/ping").json() == {"ok": True}
    assert c.get("/api/nope").status_code == 404
    assert c.get("/health").status_code == 404  # service route, never the SPA


def test_no_path_traversal(tmp_path):
    app = FastAPI()
    dist = _dist(tmp_path)
    (tmp_path / "secret.txt").write_text("nope")
    mount_web(app, dist)
    c = TestClient(app)
    r = c.get("/../secret.txt")
    assert "nope" not in r.text


def test_ws_session_alias_for_single_origin(client):
    import cv2
    import numpy as np

    _, buf = cv2.imencode(".jpg", np.zeros((480, 640, 3), np.uint8))
    with client.websocket_connect("/ws/session?mode=heartbeat") as ws:
        ws.send_bytes(buf.tobytes())
        assert ws.receive_json()["type"] == "heartbeat"


def test_index_revalidates_and_hashed_assets_are_immutable(tmp_path):
    """A fresh deploy must show on the first click: the HTML is never served from a heuristic
    browser cache, while Vite's content-hashed bundles can be cached for a year."""
    app = FastAPI()
    mount_web(app, _dist(tmp_path))
    c = TestClient(app)
    assert c.get("/").headers["cache-control"] == "no-cache"
    assert c.get("/details").headers["cache-control"] == "no-cache"
    assert c.get("/favicon.svg").headers["cache-control"] == "no-cache"
    assert c.get("/assets/app.js").headers["cache-control"] == "public, max-age=31536000, immutable"
