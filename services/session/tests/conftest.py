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
