"""E-SVC-4: the pain-tiered plan for today. The tier is a rule, never a diagnosis."""

import time
from datetime import datetime

from praxis_session.plan import REST_ADVICE, tier_for, today
from praxis_session.store import Store

PROFILE = {
    "side": "left",
    "goal": "badminton",
    "pain_last": 3,
    "created_at": "2026-09-17T09:00:00",
    "updated_at": "2026-09-17T09:00:00",
}


def test_tier_boundaries():
    assert [tier_for(p) for p in (0, 3)] == ["full", "full"]
    assert [tier_for(p) for p in (4, 6)] == ["gentle", "gentle"]
    assert [tier_for(p) for p in (7, 10)] == ["rest", "rest"]


def test_full_tier_lists_every_exercise_at_full_range():
    plan = today(PROFILE, pain=2, sessions_today=[])
    assert plan["tier"] == "full" and plan["rest_advice"] is None
    assert "Pain 2" in plan["tier_reason"]
    assert plan["goal_line"].startswith("Toward badminton:") and "week" in plan["goal_line"]
    ids = [i["id"] for i in plan["items"]]
    assert ids[0] == "pendulum" and len(ids) == 7
    flexion = [i for i in plan["items"] if i["id"] == "flexion"][0]
    assert flexion["target_deg"] == 90.0 and flexion["hold_s"] == 3.0 and flexion["reps"] == 8
    assert flexion["view"] == "side" and flexion["clip"] and flexion["dose"]
    assert flexion["steps"] and flexion["done_today"] is False
    assert flexion["ceiling_deg"] == 90.0
    assert set(flexion) == {
        "id", "name", "dose", "sets", "reps", "hold_s", "target_deg", "ceiling_deg",
        "view", "done_today", "clip", "steps",
    }


def test_gentle_tier_is_four_exercises_with_shorter_holds():
    plan = today(PROFILE, pain=5, sessions_today=[])
    assert plan["tier"] == "gentle" and plan["rest_advice"] is None
    ids = [i["id"] for i in plan["items"]]
    assert ids == ["pendulum", "flexion", "abduction", "external_rotation"]
    by_id = {i["id"]: i for i in plan["items"]}
    assert by_id["abduction"]["target_deg"] == 60.0 and by_id["abduction"]["hold_s"] == 2.0
    assert by_id["flexion"]["reps"] == 6
    assert "gentle" in plan["tier_reason"].lower()


def test_rest_tier_has_no_exercises_and_says_why():
    plan = today(PROFILE, pain=8, sessions_today=[])
    assert plan["tier"] == "rest" and plan["items"] == []
    assert plan["rest_advice"] == REST_ADVICE
    assert "8" in plan["tier_reason"]


def test_pain_defaults_to_the_profile_and_survives_no_profile():
    assert today(PROFILE | {"pain_last": 5}, pain=None, sessions_today=[])["tier"] == "gentle"
    plan = today(None, pain=None, sessions_today=[])
    assert plan["tier"] == "full" and plan["items"] and "Toward" in plan["goal_line"]


def test_done_today_comes_from_completed_sessions():
    rows = [
        {"exercise": "flexion", "status": "complete"},
        {"exercise": "abduction", "status": "ended_early"},
    ]
    by_id = {i["id"]: i for i in today(PROFILE, pain=1, sessions_today=rows)["items"]}
    assert by_id["flexion"]["done_today"] is True
    assert by_id["abduction"]["done_today"] is False


def test_goal_line_counts_weeks_since_the_profile_was_made():
    old = PROFILE | {"created_at": "2026-09-01T09:00:00"}
    week = (datetime.now() - datetime.fromisoformat(old["created_at"])).days // 7 + 1
    assert today(old, pain=1, sessions_today=[])["goal_line"].endswith(f"week {week}")


# ---- store + endpoint --------------------------------------------------------------------
def test_store_sessions_carry_exercise_and_username(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    summary = {
        "session_id": "e1", "mode": "arm", "exercise": "abduction", "username": "sathvik",
        "t_start": time.time(), "t_end": time.time() + 300, "clock": "wall",
        "camera": {"reps_total": 8, "verified": 8, "unverified": 0, "corrections": 0},
        "told_us": {}, "exertion": {}, "coach": {}, "flags": [], "stopped": False,
    }
    st.save_session(summary, {}, {}, [])
    row = st.session("e1")
    assert row["exercise"] == "abduction" and row["username"] == "sathvik"
    assert row["title"].startswith("Arm out to the side")
    assert [s["id"] for s in st.sessions_today("sathvik")] == ["e1"]
    assert st.sessions_today("rinky") == []
    assert [s["id"] for s in st.sessions(username="sathvik")] == ["e1"]


def test_plan_today_endpoint_follows_the_profile_and_the_pain_override(client):
    plan = client.get("/api/plan/today").json()
    assert plan["tier"] == "full" and plan["items"]  # no profile yet
    client.post("/api/profile", json={"side": "left", "goal": "badminton", "pain": 5})
    assert client.get("/api/plan/today").json()["tier"] == "gentle"
    over = client.get("/api/plan/today?pain=9").json()
    assert over["tier"] == "rest" and over["rest_advice"] and over["items"] == []
    assert client.get("/api/plan/today?pain=0").json()["tier"] == "full"


def test_plan_today_marks_a_finished_exercise_done(client):
    import praxis_session.main as main

    client.post("/api/profile", json={"side": "left", "goal": "badminton", "pain": 1})
    main.store.save_session(
        {
            "session_id": "d1", "mode": "arm", "exercise": "flexion", "username": "sathvik",
            "t_start": None, "t_end": None,
            "camera": {"reps_total": 8, "verified": 8, "unverified": 0}, "flags": [],
        },
        {}, {}, [],
    )
    by_id = {i["id"]: i for i in client.get("/api/plan/today").json()["items"]}
    assert by_id["flexion"]["done_today"] is True and by_id["abduction"]["done_today"] is False


def test_plan_today_requires_sign_in(anon):
    assert anon.get("/api/plan/today").status_code == 401
