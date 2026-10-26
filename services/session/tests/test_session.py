from praxis_session.events import make_event
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.session import CoachSession


def make(mode="cup", tmp_path=None):
    return CoachSession(mode=mode, prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="t")


# ---- Auto-resume when tracking returns after a perception pause ----------


def test_perception_pause_auto_resumes_when_tracking_returns(tmp_path):
    s = make(mode="nhpt", tmp_path=tmp_path)
    out = s.on_events([make_event("perception_lost", t=3.0, missing=[1, 2])], snapshot={}, t=3.0)
    assert [x.type for x in out] == ["pause"] and out[0].payload["rule"] == "perception"
    assert s.paused and s.pause_rule == "perception"
    # still lost: nothing new, still paused
    assert s.on_events([make_event("frame", t=3.5, calibrated=False, missing=[1, 2])], snapshot={}, t=3.5) == []
    assert s.paused
    out = s.on_events([make_event("perception_regained", t=4.0)], snapshot={}, t=4.0)
    resume = next(x for x in out if x.type == "resume")
    assert resume.payload["rule"] == "perception" and resume.payload["text"] == "Tracking is back. Carry on."
    assert not s.paused and s.pause_rule is None
    kinds = [(r["kind"], r.get("rule")) for r in s.trace.tail(10)]
    assert ("resume", "perception") in kinds


def test_patient_pause_is_not_cleared_by_tracking_regain(tmp_path):
    s = make(mode="cup", tmp_path=tmp_path)
    s.pause(t=1.0)  # rule="patient"
    out = s.on_events([make_event("perception_regained", t=2.0)], snapshot={}, t=2.0)
    assert not any(x.type == "resume" for x in out)
    assert s.paused and s.pause_rule == "patient"


def test_other_rule_pauses_are_not_cleared_by_tracking_regain(tmp_path):
    s = make(mode="arm", tmp_path=tmp_path)
    s.on_events([make_event("compensation_lean", t=5.0, lean_deg=15, count=3, flagged=True)], snapshot={}, t=5.0)
    assert s.paused and s.pause_rule == "lean"
    out = s.on_events([make_event("perception_regained", t=6.0)], snapshot={}, t=6.0)
    assert not any(x.type == "resume" for x in out) and s.paused


def test_regain_without_a_pause_emits_nothing(tmp_path):
    s = make(mode="nhpt", tmp_path=tmp_path)
    out = s.on_events([make_event("perception_regained", t=6.0)], snapshot={}, t=6.0)
    assert not any(x.type == "resume" for x in out) and not s.paused


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
    out = s.on_pain(7, t=3.0)
    assert [x.type for x in out] == ["stop", "therapist_flag"] and s.stopped
    e = make_event("reach_complete", t=5.0, to_dot=1, from_dot=0, verified=True, reason=None, reach_ms=1200, arc=1, phase="slow")
    assert [x.type for x in s.on_events([e], snapshot={}, t=5.0)] == []


def test_summary_carries_the_last_in_session_pain_report(tmp_path):
    """10 Oct walkthrough: pain reported with "Pain / feel unwell" must reach the report even
    when the patient skips the feedback screen."""
    s = make(tmp_path=tmp_path)
    assert s.summary()["reported_pain"] is None
    s.on_pain(3, t=2.0)
    assert s.summary()["reported_pain"] == {"pain": 3, "t": 2.0}
    s.on_pain(8, t=5.5)
    assert s.summary()["reported_pain"] == {"pain": 8, "t": 5.5}
    assert s.stopped


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
    # a missed target is the patient's performance, not a rep the camera could not verify
    assert summ["camera"]["reps_total"] == 2 and summ["camera"]["missed"] == 1
    assert summ["camera"]["unverified"] == 0
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


def test_summary_carries_the_exercise_and_the_signed_in_user():
    s = CoachSession(mode="arm", prescription=SEED_PRESCRIPTION, exercise="abduction", username="T1")
    out = s.summary()
    assert out["exercise"] == "abduction" and out["username"] == "t1"
    assert CoachSession(mode="cup", prescription=SEED_PRESCRIPTION).summary()["exercise"] is None


# ---- 24 Sep review ------------------------------------------------------------------------
def _drive_arm(tmp_path, fsm, samples, lean=0.0):
    """Feed angle samples through a real ArmFSM and a CoachSession, like main._run_frame."""
    from praxis_session.perception.arm_fsm import ArmObservation

    s = CoachSession(mode="arm", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, exercise=fsm.exercise.id)
    out, t = [], 0.0
    for angle in samples:
        evs = fsm.step(ArmObservation(t=t, shoulder_deg=angle, trunk_lean_deg=lean, shoulder_hike_norm=0.0, view_ok=fsm.view != "front"))
        out += evs + s.on_events(evs, snapshot={"arm": fsm.snapshot()}, t=t)
        t += 1 / 15
    return s, out


def _lift(peak=90.0, hold_frames=50):
    up = [5 + (peak - 5) * i / 15 for i in range(16)]
    return up + [peak] * hold_frames + list(reversed(up)) + [5.0] * 8


def test_pendulum_lean_never_pauses_or_flags_but_flexion_does(tmp_path):
    """P0: Pendulum is done leaning forward on a table; a 35° sustained lean must not raise
    compensation_lean, a pause or a therapist flag. Flexion still does."""
    import math

    from praxis_session.perception.arm_fsm import ArmFSM

    swings = [20.0 * math.sin(2 * math.pi * i / 15) for i in range(15 * 25)]
    s, out = _drive_arm(tmp_path, ArmFSM("pendulum"), swings, lean=35.0)
    seen = [e.type for e in out]
    assert "compensation_lean" not in seen and "pause" not in seen and "therapist_flag" not in seen
    assert not s.paused and s.summary()["flags"] == []

    s, out = _drive_arm(tmp_path, ArmFSM("flexion"), _lift() * 4, lean=35.0)
    seen = [e.type for e in out]
    assert "compensation_lean" in seen and "pause" in seen and "therapist_flag" in seen


def test_summary_counts_unverified_and_missed_apart(tmp_path):
    """Unverified (the camera could not check it) is not failed (the camera saw a miss):
    tracking quality only looks at the unverified share."""
    s = make(mode="arm", tmp_path=tmp_path)
    reps = [
        make_event("rep_complete", t=float(i), set=1, rep=i + 1, peak_deg=60.0, hold_s=0.5, verified=False, reason="target_missed")
        for i in range(2)
    ] + [make_event("rep_complete", t=3.0, set=1, rep=3, peak_deg=90.0, hold_s=3.0, verified=True, reason=None)]
    s.on_events(reps, snapshot={}, t=3.0)
    summ = s.summary(t=4.0)
    cam = summ["camera"]
    assert (cam["reps_total"], cam["verified"], cam["unverified"], cam["missed"]) == (3, 1, 0, 2)
    assert summ["tracking"] == "usable"  # two misses say nothing about the camera
    c = make(mode="cup", tmp_path=tmp_path)
    c.on_events([reach(1.0, verified=False), reach(2.0)], snapshot={}, t=2.0)
    cam = c.summary(t=3.0)["camera"]
    assert (cam["unverified"], cam["missed"]) == (1, 0)


def test_second_lean_regresses_and_queues_a_clamped_set_hold(tmp_path):
    """The regress now happens (second lean, before the third-lean pause) and becomes a
    pipeline command for the running exercise's prescription key."""
    from praxis_session.perception.arm_fsm import ArmFSM

    fsm = ArmFSM("abduction")
    s, out = _drive_arm(tmp_path, fsm, [a for a in _lift()] * 2, lean=20.0)
    coach = [e for e in out if e.type == "coach"]
    reg = [e for e in coach if e.payload["action"] == "regress"]
    assert reg and reg[0].payload["ui"]["apply"] == {"abduction": {"hold_s": 2.0}}
    lean2 = next(e for e in out if e.type == "compensation_lean" and e.payload["count"] == 2)
    assert reg[0].payload["evidence"] == [lean2.id]
    assert not s.paused  # the third-lean pause has not happened yet
    cmds = s.take_commands()
    assert cmds == [{"cmd": "set_hold", "hold_s": 2.0, "rx": "abduction", "evidence": [lean2.id]}]
    assert s.take_commands() == []


# ---- 6 Oct design v2 (Task 17): honest report data -----------------------------------------


def test_feedback_pain_at_stop_level_flags_therapist(tmp_path):
    s = make(mode="cup", tmp_path=tmp_path)
    pain_max = SEED_PRESCRIPTION.stop_rules.pain_max
    s.on_feedback({"pain_after": pain_max, "ended_early": False}, t=5.0)
    flags = [f for f in s.summary(5.0)["flags"] if f["rule"] == "pain_after"]
    assert len(flags) == 1 and flags[0]["detail"] == f"pain {pain_max}/10 after the session (stop level {pain_max})"
    # the session is already over: a flag only, never a stop
    assert s.summary(5.0)["stopped"] is False and not s.stopped
    assert ("flag", "pain_after") in [(r["kind"], r.get("rule")) for r in s.trace.tail(10)]
    s.on_feedback({"pain_after": pain_max + 1}, t=6.0)  # sent again: still one flag
    assert sum(f["rule"] == "pain_after" for f in s.summary(6.0)["flags"]) == 1


def test_feedback_pain_below_stop_level_no_flag(tmp_path):
    s = make(mode="cup", tmp_path=tmp_path)
    s.on_feedback({"pain_after": SEED_PRESCRIPTION.stop_rules.pain_max - 1}, t=5.0)
    assert not any(f["rule"] == "pain_after" for f in s.summary(5.0)["flags"])
    s.on_feedback({"ended_early": False}, t=6.0)  # skipped pain question
    s.on_feedback({"pain_after": True}, t=7.0)  # not a pain score
    assert not any(f["rule"] == "pain_after" for f in s.summary(7.0)["flags"])


def test_feedback_keeps_the_new_keys_in_told_us(tmp_path):
    s = make(mode="cup", tmp_path=tmp_path)
    s.on_checkin(pain=2, energy="comfortable", minutes=10, new_symptoms=False, t=1.0)
    fb = {"pain_after": 3, "difficulty": "just_right", "effort": 4, "again_tomorrow": "yes_probably", "ended_early": True, "barriers": ["tired", "camera"]}
    s.on_feedback(fb, t=5.0)
    assert s.summary(5.0)["told_us"] == {"pain_before": 2, "energy": "comfortable", "minutes": 10, "new_symptoms": False, **fb}


def test_wrong_dot_counted(tmp_path):
    s = make(mode="cup", tmp_path=tmp_path)
    assert s.summary(0.0)["camera"]["wrong_dot"] == 0
    s.on_events([make_event("wrong_dot", t=1.0, dot=4, expected=3)], snapshot={}, t=1.0)
    assert s.summary(1.0)["camera"]["wrong_dot"] == 1


def test_posture_split(tmp_path):
    s = make(mode="arm", tmp_path=tmp_path)
    s.on_events([make_event("compensation_lean", t=1.0, lean_deg=12), make_event("shoulder_hiking", t=2.0)], snapshot={}, t=2.0)
    c = s.summary(2.0)["camera"]
    assert (c["lean_cues"], c["hiking_cues"], c["posture_cues"]) == (1, 1, 2)


def test_above_ceiling_is_counted_per_set_corrected_and_never_stops(tmp_path):
    import json

    s = make(mode="arm", tmp_path=tmp_path)
    snap = {"arm": {"exercise": "abduction", "kind": "hold", "reps_per_set": 8, "sets": 2}}
    out = s.on_events([make_event("above_ceiling", t=1.0, set=1, rep=1, angle_deg=101.0, ceiling_deg=90.0)], snapshot=snap, t=1.0)
    out += s.on_events([make_event("above_ceiling", t=30.0, set=2, rep=1, angle_deg=99.0, ceiling_deg=90.0)], snapshot=snap, t=30.0)
    out += s.on_events([make_event("above_ceiling", t=60.0, set=2, rep=4, angle_deg=99.0, ceiling_deg=90.0)], snapshot=snap, t=60.0)
    coach = [e for e in out if e.type == "coach"]
    assert len(coach) == 3 and all(e.payload["action"] == "correct" and e.payload["cue_id"] == "arm_above_ceiling" for e in coach)
    assert not any(e.type in ("stop", "pause", "rest", "therapist_flag") for e in out)
    summary = s.summary(60.0)
    c = summary["camera"]
    assert c["above_ceiling"] == 3 and c["above_ceiling_by_set"] == {"1": 1, "2": 2}
    assert c["posture_cues"] == 0  # not a posture cue
    assert summary["stopped"] is False and summary["flags"] == []
    rows = [json.loads(line) for line in (tmp_path / "t.jsonl").read_text().splitlines()]
    assert any(r["kind"] == "event" and r.get("type") == "above_ceiling" for r in rows)
    assert any(r["kind"] == "decide" and r.get("cue_id") == "arm_above_ceiling" for r in rows)


def test_coach_notes_have_categories(tmp_path):
    s = make(mode="arm", tmp_path=tmp_path)
    s.decisions.append({"action": "correct", "cue_id": "arm_lean", "reason": "trunk lean 14°", "evidence": [1], "source": "rule"})
    s.decisions.append({"action": "correct", "cue_id": "arm_hike", "reason": "shoulder hiking", "evidence": [2], "source": "rule"})
    s.decisions.append({"action": "correct", "cue_id": "arm_unverified", "reason": "unverified rep (pose_lost)", "evidence": [3], "source": "rule"})
    s.decisions.append({"action": "correct", "cue_id": "cup_wrong_dot", "reason": "wrong dot", "evidence": [4], "source": "rule"})
    s.decisions.append({"action": "progress", "cue_id": "cup_fast", "reason": "slow arcs verified", "evidence": [5], "source": "rule"})
    s.decisions.append({"action": "regress", "cue_id": "arm_regress", "reason": "second lean", "evidence": [6], "source": "rule"})
    cats = [n["cat"] for n in s.summary(1.0)["coach"]["notes"]]
    assert cats == ["Posture", "Posture", "Data quality", "Performance", "Performance", "Performance"]
    rest = make(mode="cup", tmp_path=tmp_path)
    rest.decisions.append({"action": "rest", "cue_id": "rest", "reason": "exertion high", "evidence": [7], "source": "rule"})
    assert [n["cat"] for n in rest.summary(1.0)["coach"]["notes"]] == ["Safety"]


def test_coach_note_categories_from_the_real_rule_coach(tmp_path):
    s = make(mode="arm", tmp_path=tmp_path)
    s.on_events([make_event("compensation_lean", t=1.0, lean_deg=14, count=1)], snapshot={}, t=1.0)
    notes = s.summary(1.0)["coach"]["notes"]
    assert notes and notes[0]["cat"] == "Posture"


def test_coach_notes_read_as_plain_sentences_for_a_clinician(tmp_path):
    """10 Oct walkthrough: notes read like code ("progress: patient accepted progression")."""
    s = make(mode="cup", tmp_path=tmp_path)
    s.decisions += [
        {"action": "progress", "cue_id": "cup_progress", "reason": "two clean slow arcs, mean reach 1.2 s, 0 unverified", "evidence": [1], "source": "rule"},
        {"action": "progress", "cue_id": "cup_fast", "reason": "patient accepted progression", "evidence": [], "source": "rule"},
        {"action": "correct", "cue_id": "cup_unverified", "reason": "unverified reach (cup_occluded)", "evidence": [2], "source": "rule"},
        {"action": "correct", "cue_id": "cup_wrong_dot", "reason": "wrong dot", "evidence": [3], "source": "rule"},
        {"action": "rest", "cue_id": "rest_exertion", "reason": "behavioural exertion high: rep time rising, tremor", "evidence": [4], "source": "rule"},
    ]
    notes = s.summary(1.0)["coach"]["notes"]
    assert [n["text"] for n in notes] == [
        "Progression offered: two clean slow arcs, mean reach 1.2 s, 0 unverified.",
        "Patient accepted the faster arcs.",
        "Reach not verified by the camera: cup occluded.",
        "Correction: the cup went to a different dot than the next one.",
        "Rest suggested: exertion high from behaviour (rep time rising, tremor).",
    ]
    assert [n["cat"] for n in notes] == ["Performance", "Performance", "Data quality", "Performance", "Safety"]  # chips unchanged
    arm = make(mode="arm", tmp_path=tmp_path)
    arm.decisions += [
        {"action": "correct", "cue_id": "arm_lean", "reason": "trunk lean 14°", "evidence": [1], "source": "rule"},
        {"action": "correct", "cue_id": "arm_hike", "reason": "shoulder hiking", "evidence": [2], "source": "rule"},
        {"action": "correct", "cue_id": "arm_above_ceiling", "reason": "lift 97° past the 90° ceiling (rep 3)", "evidence": [3], "source": "rule"},
        {"action": "correct", "cue_id": "arm_short_hold", "reason": "hold too short", "evidence": [4], "source": "rule"},
        {"action": "correct", "cue_id": "arm_missed", "reason": "target missed", "evidence": [5], "source": "rule"},
        {"action": "regress", "cue_id": "arm_regress_hold", "reason": "2 lean events in Arm out to the side; hold_s 3 → 2, clamped to abduction.hold_s within the prescription", "evidence": [6], "source": "rule"},
    ]
    assert [n["text"] for n in arm.summary(1.0)["coach"]["notes"]] == [
        "Posture correction: trunk lean 14°.",
        "Posture correction: shoulder hiking.",
        "Range correction: lift 97° past the 90° ceiling (rep 3).",
        "Correction: the hold at the top was too short.",
        "Correction: the lift stopped short of the target.",
        "Made easier after 2 lean events in Arm out to the side: hold 3 s → 2 s, within the prescription.",
    ]


def test_an_agent_decision_note_keeps_its_reason_in_a_sentence(tmp_path):
    s = make(mode="cup", tmp_path=tmp_path)
    s.decisions.append({"action": "progress", "cue_id": "agent_progress", "reason": "Reach times fell 15% over two arcs", "evidence": [1], "source": "agent"})
    assert s.summary(1.0)["coach"]["notes"][0]["text"] == "Progression offered: reach times fell 15% over two arcs."
