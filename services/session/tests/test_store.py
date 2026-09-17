from praxis_session.store import Store


def test_seed_matches_wireframe(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    pat = st.patient()
    assert pat["name"] == "Alex M." and pat["side"] == "left" and pat["goal"].startswith("Use a cup")
    p = st.prescription()
    assert p["version"] == 3 and p["level"] == 2 and p["clinician"].startswith("Dr. Anita Rao")
    sessions = st.sessions()
    assert len(sessions) >= 4
    modes = [s["mode"] for s in sessions]
    assert "nhpt" in modes and "cup" in modes and "arm" in modes
    nhpt = [s for s in sessions if s["mode"] == "nhpt"]
    assert nhpt[0]["summary"]["camera"]["nhpt_total_s"] == 41.2
    flags = st.flags()
    assert len(flags) == 2 and all(f["reviewed"] is False for f in flags)
    trend = st.nhpt_trend()
    assert trend[0]["total_s"] == 68.0 and trend[-1]["total_s"] == 41.2 and len(trend) == 6
    st.seed_if_empty()  # idempotent
    assert len(st.sessions()) == len(sessions)


def test_save_session_and_report(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    summary = {"session_id": "abc", "mode": "cup", "t_start": 100.0, "t_end": 700.0, "camera": {"reps_total": 20, "verified": 17, "unverified": 3, "corrections": 2}, "told_us": {}, "exertion": {"level": "low", "reasons": [], "method": "behavioural"}, "coach": {"label": "Rule-based coach · LLM agent pending", "notes": [{"text": "progress: two clean arcs", "confidence": "high", "evidence": [3]}], "decisions": 9}, "flags": [{"t": 300.0, "rule": "lean", "detail": "lean"}], "stopped": False, "delivery": "queued · not yet delivered"}
    sid = st.save_session(summary, checkin={"pain_before": 2}, feedback={"pain_after": 2, "effort": 4, "compared": "same"}, events=[{"type": "reach_complete", "t": 120.0, "to_dot": 1, "verified": True}])
    assert sid == "abc"
    rep = st.session("abc")
    assert rep["status"] == "complete" and rep["tracking"] == "usable"
    assert rep["feedback"]["effort"] == 4 and rep["checkin"]["pain_before"] == 2
    assert rep["summary"]["camera"]["verified"] == 17 and rep["events"][0]["type"] == "reach_complete"
    assert rep["next_practice"]["proposal"] and rep["delivery"] == "queued · not yet delivered"
    assert any(f["rule"] == "lean" and f["session_id"] == "abc" for f in st.flags())
    fid = [f for f in st.flags() if f["session_id"] == "abc"][0]["id"]
    st.mark_reviewed(fid)
    assert [f for f in st.flags() if f["id"] == fid][0]["reviewed"] is True


def test_goal_log_and_patient_model(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    n0 = st.patient()["goal_attempts"]
    st.log_goal("used a cup at breakfast")
    assert st.patient()["goal_attempts"] == n0 + 1
    model = st.read_patient_model("alex")
    assert model["patient_id"] == "alex" and len(model["history"]) >= 4 and model["nhpt_trend"][-1]["total_s"] == 41.2
    assert all(h["illustrative"] for h in model["history"])  # seed rows are labeled for the coach too


def _summary(**over):
    base = {"session_id": "real1", "mode": "cup", "t_start": 1.7e9, "t_end": 1.7e9 + 600, "clock": "wall", "camera": {"reps_total": 10, "verified": 9, "unverified": 1, "corrections": 1, "active_s": 720.0}, "told_us": {}, "exertion": {"level": "low", "reasons": [], "method": "behavioural"}, "coach": {"label": "Rule-based coach · LLM agent pending", "notes": [], "decisions": 3}, "flags": [], "stopped": False, "delivery": "queued · not yet delivered"}
    return base | over


def test_progress_counts_real_sessions_only_and_labels_the_sample(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    p = st.progress()
    assert p["practice"] == {"done": 0, "planned": None, "hours": 0.0}
    assert p["sample"] == {"done": 19, "planned": 22, "hours": 3.4, "illustrative": True}
    assert p["adherence_pct"] is None
    assert all(s["illustrative"] for s in st.sessions())
    st.save_session(_summary(), checkin={}, feedback={"pain_after": 2}, events=[])
    p = st.progress()
    assert p["practice"] == {"done": 1, "planned": None, "hours": 0.2}
    assert [s for s in st.sessions() if s["id"] == "real1"][0]["illustrative"] is False
    me = st.therapist_patients()[0]
    assert me["adherence_pct"] is None and not me.get("illustrative")
    assert all(x["illustrative"] for x in st.therapist_patients()[1:])


def test_replay_sessions_get_wall_clock_dates(tmp_path):
    from datetime import datetime

    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    before = datetime.now().replace(microsecond=0)
    st.save_session(_summary(session_id="rp", t_start=0.0, t_end=40.0, clock="clip"), checkin={}, feedback={}, events=[])
    row = st.session("rp")
    started, ended = datetime.fromisoformat(row["started_at"]), datetime.fromisoformat(row["ended_at"])
    assert started >= before and (ended - started).total_seconds() == 40.0


def test_nhpt_with_tracking_loss_is_limited(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    st.save_session(_summary(session_id="n1", mode="nhpt", tracking_lost_events=1, camera={"reps_total": 9, "verified": 9, "unverified": 0, "corrections": 0, "nhpt_total_s": 30.0}), checkin={}, feedback={}, events=[])
    assert st.session("n1")["tracking"] == "limited"
