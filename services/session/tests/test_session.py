from praxis_session.events import make_event
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.session import CoachSession


def make(mode="cup", tmp_path=None):
    return CoachSession(mode=mode, prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="t")


def test_events_flow_through_stop_rules_then_coach(tmp_path):
    s = make(tmp_path=tmp_path)
    e = make_event("reach_complete", t=5.0, to_dot=1, from_dot=0, verified=True, reason=None, reach_ms=1200, arc=1, phase="slow")
    out = s.on_events([e], snapshot={"cup": {"phase": "slow"}}, t=5.0)
    types = [x.type for x in out]
    assert "coach" in types
    coach = next(x for x in out if x.type == "coach")
    assert coach.payload["action"] == "instruct" and coach.payload["evidence"] == [e.id]
    kinds = [x["kind"] for x in s.trace.tail(10)]
    assert kinds[:3] == ["event", "decide", "action"] or "decide" in kinds


def test_pain_stop_silences_the_coach(tmp_path):
    s = make(tmp_path=tmp_path)
    out = s.on_pain(6, t=3.0)
    assert [x.type for x in out] == ["stop", "therapist_flag"] and s.stopped
    e = make_event("reach_complete", t=5.0, to_dot=1, from_dot=0, verified=True, reason=None, reach_ms=1200, arc=1, phase="slow")
    assert [x.type for x in s.on_events([e], snapshot={}, t=5.0)] == []


def test_checkin_sets_rpe_and_symptoms_stop(tmp_path):
    s = make(tmp_path=tmp_path)
    assert s.on_checkin(pain=2, energy="tired", minutes=14, new_symptoms=False, t=0.0) == []
    assert s.checkin["pain_before"] == 2
    s2 = make(tmp_path=tmp_path)
    out = s2.on_checkin(pain=2, energy="tired", minutes=14, new_symptoms=True, t=0.0)
    assert out[0].type == "stop" and out[0].payload["rule"] == "symptoms"


def test_progression_answer_returns_pipeline_command(tmp_path):
    s = make(tmp_path=tmp_path)
    e = make_event("arc_complete", t=30.0, arc=2, phase="slow", mean_reach_ms=1200, unverified=0, awaiting_phase=True)
    out = s.on_events([e], snapshot={"cup": {"awaiting_phase": True, "phase": "slow"}}, t=30.0)
    prompt = next(x for x in out if x.type == "coach")
    assert prompt.payload["ui"]["prompt"]["id"] == "progression"
    cmd, evs = s.on_answer("progression", "Yes, go faster", t=31.0)
    assert cmd == {"cmd": "set_phase", "phase": "fast"} and evs[0].type == "coach"
    cmd2, _ = s.on_answer("progression", "Keep pace", t=32.0)
    assert cmd2 is None


def test_pause_resume_and_summary(tmp_path):
    s = make(mode="arm", tmp_path=tmp_path)
    s.on_events([make_event("compensation_lean", t=5.0, lean_deg=15, count=3, flagged=True)], snapshot={}, t=5.0)
    assert s.paused
    e = make_event("rep_complete", t=6.0, set=1, rep=1, peak_deg=88, hold_s=3.0, verified=True, reason=None)
    assert [x.type for x in s.on_events([e], snapshot={}, t=6.0)] == []  # paused: no coaching
    s.resume(t=7.0)
    assert not s.paused
    s.on_events([make_event("rep_complete", t=8.0, set=1, rep=2, peak_deg=70, hold_s=1.0, verified=False, reason="target_missed")], snapshot={}, t=8.0)
    summ = s.summary(t=9.0)
    assert summ["camera"]["reps_total"] == 2 and summ["camera"]["unverified"] == 1
    assert summ["coach"]["label"].startswith("Rule-based")
    assert any(n["confidence"] in ("high", "medium") for n in summ["coach"]["notes"])
    assert summ["flags"] and summ["flags"][0]["rule"] == "lean"
    assert summ["exertion"]["method"] == "behavioural"


def test_summary_carries_task_measurements(tmp_path):
    s = make(mode="nhpt", tmp_path=tmp_path)
    s.on_events([make_event("nhpt_start", t=1.0)], snapshot={}, t=1.0)
    s.on_events([make_event("nhpt_complete", t=42.0, total_s=41.2, splits_s=[4.0, 5.0], pegs=[])], snapshot={}, t=42.0)
    cam = s.summary(t=43.0)["camera"]
    assert cam["nhpt_total_s"] == 41.2 and cam["splits_s"] == [4.0, 5.0] and cam["active_s"] == 41.0
    c = make(mode="cup", tmp_path=tmp_path)
    c.on_events([make_event("reach_complete", t=5.0, to_dot=1, from_dot=0, verified=True, reason=None, reach_ms=1200, arc=1, phase="slow"),
                 make_event("reach_complete", t=8.0, to_dot=2, from_dot=1, verified=False, reason="cup_occluded", reach_ms=900, arc=1, phase="slow")], snapshot={}, t=8.0)
    cam = c.summary(t=9.0)["camera"]
    assert cam["reach_ms"] == [1200, 900] and cam["reach_verified"] == [True, False] and cam["coverage_pct"] == 50
    a = make(mode="arm", tmp_path=tmp_path)
    a.on_events([make_event("rep_complete", t=5.0, set=1, rep=1, peak_deg=88.0, hold_s=3.1, verified=True, reason=None, lean=False, hike=False),
                 make_event("compensation_lean", t=6.0, lean_deg=14, count=1, flagged=False)], snapshot={}, t=6.0)
    cam = a.summary(t=7.0)["camera"]
    assert cam["peak_deg"] == [88.0] and cam["peak_verified"] == [True] and cam["posture_cues"] == 1


def reach(t, verified=True):
    return make_event("reach_complete", t=t, to_dot=1, from_dot=0, verified=verified, reason=None if verified else "cup_occluded", reach_ms=1200, arc=1, phase="slow")


def test_active_time_excludes_paused_and_rest_time(tmp_path):
    s = make(mode="cup", tmp_path=tmp_path)
    s.on_events([reach(0.0)], snapshot={}, t=0.0)
    s.pause(t=10.0)  # patient tap
    s.resume(t=30.0)
    s.on_events([reach(40.0)], snapshot={}, t=40.0)
    assert s.summary(t=40.0)["camera"]["active_s"] == 20.0
    assert s.summary(t=40.0)["camera"]["paused_s"] == 20.0
    # a stop-rule pause counts the same way, and an open pause is excluded up to `t`
    s.on_events([make_event("perception_lost", t=50.0, missing=[1])], snapshot={}, t=50.0)
    assert s.paused
    assert s.summary(t=60.0)["camera"]["active_s"] == 30.0
    s.resume(t=65.0)
    # a forced rest stops the clock until the patient taps "Rested — continue"
    s._log_stop([make_event("rest", t=70.0, rule="exertion", text="rest")])
    s.resume(t=80.0)
    s.on_events([reach(90.0)], snapshot={}, t=90.0)
    assert s.summary(t=90.0)["camera"]["paused_s"] == 45.0  # 20 + 15 + 10
    assert s.summary(t=90.0)["camera"]["active_s"] == 45.0


def test_nhpt_tracking_loss_is_counted_and_limits_tracking(tmp_path):
    s = make(mode="nhpt", tmp_path=tmp_path)
    s.on_events([make_event("nhpt_start", t=1.0)], snapshot={}, t=1.0)
    assert s.summary(t=2.0)["tracking"] == "usable" and s.summary(t=2.0)["tracking_lost_events"] == 0
    s.on_events([make_event("perception_lost", t=5.0, missing=[2, 3])], snapshot={}, t=5.0)
    summ = s.summary(t=6.0)
    assert summ["tracking_lost_events"] == 1 and summ["tracking"] == "limited"
    assert summ["camera"]["tracking_lost_events"] == 1


def test_summary_reports_which_clock_it_used(tmp_path):
    clip = make(mode="cup", tmp_path=tmp_path)
    clip.on_events([reach(5.0)], snapshot={}, t=5.0)
    assert clip.summary(t=6.0)["clock"] == "clip"
    wall = make(mode="cup", tmp_path=tmp_path)
    wall.on_events([reach(1.7e9)], snapshot={}, t=1.7e9)
    assert wall.summary(t=1.7e9 + 1)["clock"] == "wall"
