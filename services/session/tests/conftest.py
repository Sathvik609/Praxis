import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    import praxis_session.main as main
    from praxis_session.store import Store

    st = Store(tmp_path / "test.db")
    st.seed_if_empty()
    monkeypatch.setattr(main, "store", st)
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def therapist(monkeypatch):
    """Headers for a therapist-only write (21 Oct, praxis_session.auth): sets a test token."""
    import praxis_session.main as main
    from praxis_session.auth import THERAPIST_HEADER

    monkeypatch.setattr(main, "THERAPIST_TOKEN", "test-therapist-token")
    return {THERAPIST_HEADER: "test-therapist-token"}
