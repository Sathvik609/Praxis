import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    import praxis_session.main as main
    from praxis_session.store import Store

    st = Store(tmp_path / "test.db")
    st.seed_if_empty()
    monkeypatch.setattr(main, "store", st)
    app = main.app

    with TestClient(app) as c:
        # Signed-in client: every API and WebSocket route requires a bearer token.
        r = c.post("/api/auth/login", json={"username": "Sathvik", "password": "example-password"})
        assert r.status_code == 200, r.text
        c.headers["authorization"] = f"Bearer {r.json()['token']}"
        yield c


@pytest.fixture
def anon(tmp_path, monkeypatch):
    """Signed-out client for the auth tests."""
    import praxis_session.main as main
    from praxis_session.store import Store

    st = Store(tmp_path / "anon.db")
    st.seed_if_empty()
    monkeypatch.setattr(main, "store", st)
    with TestClient(main.app) as c:
        yield c
