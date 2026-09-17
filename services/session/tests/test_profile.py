"""E-SVC-1: the per-user profile behind the guided flow (side, goal, last pain)."""

from praxis_session.store import Store


def test_store_profile_round_trip(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    assert st.profile("sathvik") is None
    p = st.save_profile("sathvik", side="left", goal="play badminton", pain=3)
    assert p["side"] == "left" and p["goal"] == "play badminton" and p["pain_last"] == 3
    assert p["created_at"] and p["updated_at"]
    again = st.save_profile("sathvik", side="right", goal="lift a kettle", pain=6)
    assert again["created_at"] == p["created_at"] and again["side"] == "right"
    assert again["pain_last"] == 6
    assert st.profile("sathvik") == again
    assert st.profile("rinky") is None  # profiles are per user


def test_get_profile_is_null_before_onboarding(client):
    assert client.get("/api/profile").json() == {"profile": None}


def test_post_profile_then_get_returns_it(client):
    r = client.post("/api/profile", json={"side": "left", "goal": "play badminton", "pain": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    prof = body["profile"]
    assert prof["side"] == "left" and prof["goal"] == "play badminton" and prof["pain_last"] == 3
    assert set(prof) == {"side", "goal", "pain_last", "created_at", "updated_at"}
    assert client.get("/api/profile").json()["profile"] == prof


def test_profile_validation(client):
    bad = [
        {"side": "middle", "goal": "x", "pain": 3},
        {"side": "left", "goal": "", "pain": 3},
        {"side": "left", "goal": "x" * 121, "pain": 3},
        {"side": "left", "goal": "x", "pain": 11},
        {"side": "left", "goal": "x", "pain": -1},
    ]
    for body in bad:
        r = client.post("/api/profile", json=body)
        assert r.status_code == 400, body
        assert r.json()["ok"] is False and r.json()["error"]
    assert client.get("/api/profile").json()["profile"] is None


def test_profile_requires_sign_in(anon):
    assert anon.get("/api/profile").status_code == 401
    assert anon.post("/api/profile", json={"side": "left", "goal": "x", "pain": 1}).status_code == 401
