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


def test_an_existing_database_picks_up_the_current_seed_prescription(tmp_path):
    """A database seeded before 23 Sep holds pain_max 5 and the old exercise list. The seed
    prescription is code, so the same version is rewritten on start; a newer version (a real
    therapist edit) is never touched."""
    import json

    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    old = st.prescription() | {"stop_rules": st.prescription()["stop_rules"] | {"pain_max": 5}, "exercises": {"blocks": {}}}
    st._db.execute("UPDATE prescriptions SET json=?", (json.dumps(old),))
    st._db.commit()
    assert st.prescription()["stop_rules"]["pain_max"] == 5
    st.seed_if_empty()
    p = st.prescription()
    assert p["stop_rules"]["pain_max"] == 7 and "abduction" in p["exercises"] and "blocks" not in p["exercises"]
    newer = p | {"version": 4, "stop_rules": p["stop_rules"] | {"pain_max": 6}}
    st._db.execute("INSERT INTO prescriptions(patient_id, version, json) VALUES('alex', 4, ?)", (json.dumps(newer),))
    st._db.commit()
    st.seed_if_empty()
    assert st.prescription()["version"] == 4 and st.prescription()["stop_rules"]["pain_max"] == 6


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


def test_no_seeded_session_names_a_hidden_exercise(tmp_path):
    """28 Sep: the illustrative history only names the three visible exercises."""
    import json

    from praxis_session.perception.exercises import EXERCISES, HIDDEN_IDS

    hidden = [EXERCISES[i].name.lower() for i in HIDDEN_IDS] + ["pendulum", "arm to the front", "rotate "]
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    for s in st.sessions():
        blob = json.dumps(s, ensure_ascii=False).lower()
        assert not [h for h in hidden if h in blob], s["id"]
        assert s["exercise"] not in HIDDEN_IDS
    assert [s["exercise"] for s in st.sessions() if s["mode"] == "arm"] == ["abduction"]


def test_an_existing_database_gets_the_relabelled_seed_history(tmp_path):
    """A database seeded before 28 Sep holds seed rows titled Arm to the front: they are
    rewritten from the code seed on start. Real (non-seed) sessions are not touched."""
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    st._db.execute("UPDATE sessions SET title='Arm to the front', exercise=NULL WHERE id='s-0908-arm'")
    st._db.commit()
    st.save_session(_summary(session_id="real1", mode="cup"), checkin={}, feedback={}, events=[])
    before = st.session("real1")
    st.seed_if_empty()
    row = st.session("s-0908-arm")
    assert row["title"] == "Arm out to the side" and row["exercise"] == "abduction"
    assert st.session("real1") == before


def test_sessions_of_a_hidden_exercise_are_not_listed(tmp_path):
    """A session saved before 28 Sep for a now-hidden exercise stays in the database (data is
    never deleted) but is not listed, so no screen shows a hidden exercise name."""
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    n = len(st.sessions())
    st.save_session(_summary(session_id="s-old-flexion", mode="arm", exercise="flexion"), checkin={}, feedback={}, events=[])
    assert st._db.execute("SELECT COUNT(*) FROM sessions WHERE id='s-old-flexion'").fetchone()[0] == 1  # kept
    assert st.session("s-old-flexion") is None  # but a report link cannot open it either
    assert len(st.sessions()) == n and "s-old-flexion" not in [s["id"] for s in st.sessions()]
    st.save_session(_summary(session_id="s-side", mode="arm", exercise="abduction"), checkin={}, feedback={}, events=[])
    assert "s-side" in [s["id"] for s in st.sessions()]


# ---- 28 Sep review: replays are marked end-to-end and kept out of every trend ---------------


def _replay(**over):
    """A replay summary as the service writes it: clip clock, `source: replay`."""
    return _summary(t_start=0.0, t_end=40.0, clock="clip", source="replay", replay_clip="synthetic_cup_01") | over


def test_each_session_row_says_where_it_came_from(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    st.save_session(_summary(source="live"), checkin={}, feedback={"pain_after": 2, "effort": 4}, events=[])
    st.save_session(_replay(session_id="rp1"), checkin={}, feedback={}, events=[])
    rows = {s["id"]: s for s in st.sessions()}
    assert rows["real1"]["source"] == "live" and rows["real1"]["replay"] is False
    assert rows["rp1"]["source"] == "replay" and rows["rp1"]["replay"] is True  # still listed, badged by the UI
    assert rows["s-0910-cup"]["source"] == "sample" and rows["s-0910-cup"]["replay"] is False
    assert st.session("rp1")["replay"] is True


def test_legacy_replay_rows_without_a_source_are_recognised_by_their_clip_clock(tmp_path):
    """Rows saved before 28 Sep carry no `source`: a clip-time start (< 1e9) is a replay, whether
    or not the summary had `clock`. A live session that saw no frame (t_start None) is not."""
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    st.save_session(_summary(session_id="old-rp", t_start=0.0, t_end=30.0, clock=None), checkin={}, feedback={}, events=[])
    st.save_session(_summary(session_id="old-rp2", t_start=0.0, t_end=30.0, clock="clip"), checkin={}, feedback={}, events=[])
    st.save_session(_summary(session_id="no-frames", t_start=None, t_end=None, clock="clip"), checkin={}, feedback={}, events=[])
    rows = {s["id"]: s for s in st.sessions()}
    assert rows["old-rp"]["source"] == "replay" and rows["old-rp2"]["source"] == "replay"
    assert rows["no-frames"]["source"] == "live"


def test_replays_are_left_out_of_trends_practice_pain_and_adherence(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    st.save_session(_summary(source="live"), checkin={"pain_before": 2}, feedback={"pain_after": 3, "effort": 4}, events=[])
    st.save_session(_replay(session_id="rp-cup"), checkin={}, feedback={}, events=[])
    nhpt_cam = {"reps_total": 9, "verified": 9, "unverified": 0, "corrections": 0, "nhpt_total_s": 17.1, "active_s": 17.0}
    st.save_session(_replay(session_id="rp-nhpt", mode="nhpt", camera=nhpt_cam), checkin={}, feedback={}, events=[])
    p = st.progress()
    assert p["practice"]["done"] == 1  # the live cup session only
    assert [v for v in p["verified_per_session"] if not v["illustrative"]] == [
        {"date": st.session("real1")["date"], "verified": 9, "limited": False, "mode": "cup", "exercise": None, "illustrative": False, "source": "live"}
    ]
    assert all(x["source"] != "replay" for x in p["pain_effort"])
    assert [x for x in p["pain_effort"] if not x["illustrative"]][0]["pain_after"] == 3
    assert 17.1 not in [t["total_s"] for t in p["nhpt_trend"]]
    assert 17.1 not in [t["total_s"] for t in st.nhpt_trend()]
    assert "rp-cup" not in [h["id"] for h in st.read_patient_model("alex")["history"]]


def test_nhpt_trend_points_say_sample_or_live(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    assert {t["kind"] for t in st.nhpt_trend()} == {"sample"}
    cam = {"reps_total": 9, "verified": 9, "unverified": 0, "corrections": 0, "nhpt_total_s": 38.5}
    st.save_session(_summary(session_id="live-nhpt", mode="nhpt", camera=cam, source="live"), checkin={}, feedback={}, events=[])
    live = [t for t in st.nhpt_trend() if t["kind"] == "live"]
    assert [t["total_s"] for t in live] == [38.5]


def test_therapist_nhpt_numbers_never_span_sample_and_live(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    me = st.therapist_patients()[0]
    assert (me["nhpt_first_s"], me["nhpt_last_s"], me["nhpt_sample"]) == (68.0, 41.2, True)
    cam = {"reps_total": 9, "verified": 9, "unverified": 0, "corrections": 0, "nhpt_total_s": 38.5}
    st.save_session(_summary(session_id="live-nhpt", mode="nhpt", camera=cam, source="live"), checkin={}, feedback={}, events=[])
    st.save_session(_replay(session_id="rp-nhpt", mode="nhpt", camera=cam | {"nhpt_total_s": 17.2}), checkin={}, feedback={}, events=[])
    me = st.therapist_patients()[0]
    assert (me["nhpt_first_s"], me["nhpt_last_s"], me["nhpt_sample"]) == (38.5, 38.5, False)


def test_replay_rows_already_in_the_nhpt_trend_are_removed_on_start(tmp_path):
    """Before 28 Sep a replayed peg test wrote its time into `nhpt_trend` (17.1 s from the
    synthetic clip). On start those rows go; seed rows and live results stay."""
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    cam = {"reps_total": 9, "verified": 9, "unverified": 0, "corrections": 0, "nhpt_total_s": 17.1}
    st.save_session(_summary(session_id="old-rp", mode="nhpt", t_start=0.0, t_end=17.0, camera=cam), checkin={}, feedback={}, events=[])
    day = st.session("old-rp")["date"]
    st._db.execute("INSERT OR REPLACE INTO nhpt_trend(patient_id, date, total_s) VALUES('alex', ?, 17.1)", (day,))
    st._db.execute("INSERT OR REPLACE INTO nhpt_trend(patient_id, date, total_s) VALUES('alex', '2026-09-20', 39.0)")  # no session behind it
    st._db.commit()
    st.save_session(_summary(session_id="live-nhpt", mode="nhpt", camera=cam | {"nhpt_total_s": 38.5}, source="live"), checkin={}, feedback={}, events=[])
    st.seed_if_empty()
    trend = st.nhpt_trend()
    assert [t["total_s"] for t in trend if t["kind"] == "live"] == [38.5]
    assert [t["total_s"] for t in trend if t["kind"] == "sample"] == [68.0, 61.5, 55.2, 49.0, 44.0, 41.2]


# ---- 28 Sep review: the seed story uses the real stop level (7) ------------------------------


def test_seed_pain_stop_uses_the_stop_level_seven(tmp_path):
    import json

    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    row = st.session("s-0908-arm")
    blob = json.dumps(row)
    assert "stop level 5" not in blob and "pain 5/10" not in blob
    assert row["feedback"]["pain_after"] == 7
    (flag,) = [f for f in st.flags() if f["session_id"] == "s-0908-arm"]
    assert flag["detail"] == "pain 7/10 reported (stop level 7)"


def test_an_existing_database_gets_the_corrected_seed_flag_and_keeps_its_review_state(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    st._db.execute("UPDATE flags SET detail='pain 5/10 reported (stop level 5)', reviewed=1 WHERE session_id='s-0908-arm'")
    st._db.execute("UPDATE sessions SET feedback_json='{\"pain_after\": 5}' WHERE id='s-0908-arm'")
    st._db.commit()
    st.save_session(_summary(session_id="real1", flags=[{"t": 5.0, "rule": "pain", "detail": "pain 5/10 reported (stop level 5)"}], source="live"), checkin={}, feedback={}, events=[])
    st.seed_if_empty()
    (seed_flag,) = [f for f in st.flags() if f["session_id"] == "s-0908-arm"]
    assert seed_flag["detail"] == "pain 7/10 reported (stop level 7)" and seed_flag["reviewed"] is True
    assert st.session("s-0908-arm")["feedback"]["pain_after"] == 7
    (real_flag,) = [f for f in st.flags() if f["session_id"] == "real1"]
    assert real_flag["detail"] == "pain 5/10 reported (stop level 5)"  # never touched
