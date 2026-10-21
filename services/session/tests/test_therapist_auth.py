"""Therapist-only writes (21 Oct team test): `PUT /api/prescription/schedule` and
`POST /api/flags/{id}/reviewed` were open to anyone with the public link. They now need the
therapist token (`PRAXIS_THERAPIST_TOKEN`, header `X-Praxis-Therapist-Token`); with no token
configured only a local, unproxied request (laptop dev) may write. Reads stay open."""
import pytest
from fastapi.testclient import TestClient

from praxis_session.auth import THERAPIST_HEADER

SCHEDULE = {"practice_days": [0, 2, 4], "nhpt_day": 5, "next_visit": None}


@pytest.fixture
def app_store(tmp_path, monkeypatch):
    import praxis_session.main as main
    from praxis_session.store import Store

    st = Store(tmp_path / "test.db")
    st.seed_if_empty()
    monkeypatch.setattr(main, "store", st)
    monkeypatch.setattr(main, "THERAPIST_TOKEN", None)
    return main


def _client(main, host="203.0.113.7"):
    return TestClient(main.app, client=(host, 40000))


def _writes(c, headers=None):
    flag = c.get("/api/flags").json()["flags"][0]["id"]
    return (
        c.put("/api/prescription/schedule", json=SCHEDULE, headers=headers or {}),
        c.post(f"/api/flags/{flag}/reviewed", headers=headers or {}),
    )


def test_a_public_visitor_cannot_write_without_a_token_configured(app_store):
    with _client(app_store) as c:
        for r in _writes(c):
            assert r.status_code == 403
            assert r.json()["detail"]["error"] == "therapist_only"
        assert c.get("/api/prescription").json()["version"] == 3  # nothing changed
        assert not any(f["reviewed"] for f in c.get("/api/flags").json()["flags"])


def test_loopback_through_a_proxy_is_still_a_public_visitor(app_store):
    # Railway / CloudFront / uvicorn --proxy-headers: the client may look local, the headers say not
    with _client(app_store, "127.0.0.1") as c:
        for r in _writes(c, {"X-Forwarded-For": "198.51.100.4"}):
            assert r.status_code == 403


def test_local_dev_without_a_token_may_write(app_store):
    with _client(app_store, "127.0.0.1") as c:
        sched, reviewed = _writes(c)
        assert sched.status_code == 200 and sched.json()["version"] == 4
        assert reviewed.status_code == 200


def test_with_a_token_configured_only_the_right_header_writes(app_store, monkeypatch):
    monkeypatch.setattr(app_store, "THERAPIST_TOKEN", "s3cret-token")
    with _client(app_store) as c:
        assert all(r.status_code == 403 for r in _writes(c))
        assert all(r.status_code == 403 for r in _writes(c, {THERAPIST_HEADER: "wrong"}))
        sched, reviewed = _writes(c, {THERAPIST_HEADER: "s3cret-token"})
        assert sched.status_code == 200 and reviewed.status_code == 200
    with _client(app_store, "127.0.0.1") as c:  # a token, once set, is needed from loopback too
        assert all(r.status_code == 403 for r in _writes(c))


def test_the_patient_writes_and_all_reads_stay_open(app_store):
    with _client(app_store) as c:
        assert c.get("/api/prescription").status_code == 200
        assert c.get("/api/therapist/patients").status_code == 200
        assert c.post("/api/goal-log", json={"note": "cup at lunch"}).status_code == 200
        assert c.post("/api/checkin", json={"pain": 2, "new_symptoms": False}).status_code == 200


def test_health_says_whether_therapist_writes_need_a_token(app_store, monkeypatch):
    with _client(app_store) as c:
        assert c.get("/health").json()["therapist_writes"] == "local_only"
    monkeypatch.setattr(app_store, "THERAPIST_TOKEN", "t")
    with _client(app_store) as c:
        assert c.get("/health").json()["therapist_writes"] == "token"
