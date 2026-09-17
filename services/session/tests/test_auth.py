from praxis_session.auth import verify


def test_only_the_three_accounts_sign_in():
    assert verify("Rinky", "example-password") == {"username": "rinky", "name": "Rinky", "initial": "R"}
    assert verify("shruthi", "example-password")["name"] == "Shruthi"
    assert verify("SATHVIK", "example-password")["initial"] == "S"
    assert verify("Rinky", "wrong") is None
    assert verify("rinky", "example-password") is None  # passwords are case-sensitive
    assert verify("someone", "example-password") is None


def test_login_endpoint_issues_a_token_and_me_reads_it(client, anon):
    bad = client.post("/api/auth/login", json={"username": "Rinky", "password": "nope"})
    assert bad.status_code == 401 and bad.json()["ok"] is False
    r = client.post("/api/auth/login", json={"username": "Sathvik", "password": "example-password"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] and body["user"]["name"] == "Sathvik" and body["token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200 and me.json()["user"]["username"] == "sathvik"
    assert anon.get("/api/auth/me").status_code == 401
    out = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {body['token']}"})
    assert out.json()["ok"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"}).status_code == 401


def test_api_and_events_require_a_token(anon):
    assert anon.get("/api/patients/me").status_code == 401
    assert anon.get("/api/replay/list").status_code == 401
    assert anon.get("/events").status_code == 401
    assert anon.get("/health").status_code == 200  # Railway health check stays public
    assert anon.get("/api/auth/me").status_code == 401


def test_websocket_requires_a_token(anon, client):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with anon.websocket_connect("/session?mode=heartbeat"):
            pass
    with pytest.raises(WebSocketDisconnect):
        with anon.websocket_connect("/session?mode=heartbeat&token=not-a-token"):
            pass
    token = client.headers["authorization"].split(" ", 1)[1]
    with anon.websocket_connect(f"/ws/session?mode=heartbeat&token={token}") as ws:
        import cv2
        import numpy as np

        _, buf = cv2.imencode(".jpg", np.zeros((480, 640, 3), np.uint8))
        ws.send_bytes(buf.tobytes())
        assert ws.receive_json()["type"] == "heartbeat"


def test_tokens_are_signed_and_expire():
    from praxis_session import auth

    t = auth.issue_token("rinky", ttl_s=1)
    assert auth.user_for_token(t)["name"] == "Rinky"
    assert auth.user_for_token(t[:-2] + "zz") is None  # tampered signature
    expired = auth.issue_token("rinky", ttl_s=-1)
    assert auth.user_for_token(expired) is None


def test_login_is_rate_limited(anon):
    from praxis_session import auth

    auth.reset_rate_limit()
    for _ in range(auth.MAX_FAILURES):
        assert anon.post("/api/auth/login", json={"username": "Rinky", "password": "bad"}).status_code == 401
    r = anon.post("/api/auth/login", json={"username": "Rinky", "password": "example-password"})
    assert r.status_code == 429
    auth.reset_rate_limit()
    assert anon.post("/api/auth/login", json={"username": "Rinky", "password": "example-password"}).status_code == 200
