"""agent/tools.py: one implementation of every agent tool (design §4) and the guardrails of
§5, independent of transport (MCP or direct)."""
import time

import numpy as np
import pytest

from praxis_session.agent import tools as T
from praxis_session.events import make_event
from praxis_session.perception.board_spec import CUP_TARGETS
from praxis_session.perception.synth import camera_frame
from praxis_session.pipeline import SessionPipeline
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.schema import validate_event
from praxis_session.session import RULE_LABEL_WITH_AGENT, CoachSession

LABEL = "Claude agent · scripted (test)"


@pytest.fixture
def reg():
    r = T.Registry()
    yield r


def handle(reg, tmp_path, mode="cup", sid="s1", **kw):
    if mode == "arm":
        p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="abduction")
    else:
        p = SessionPipeline(mode=mode, sheet="cup_targets" if mode == "cup" else "nhpt_board", use_hand=False)
    s = CoachSession(mode=mode, prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id=sid, exercise="abduction" if mode == "arm" else None, rule_label=RULE_LABEL_WITH_AGENT)
    h = T.SessionHandle(session=s, pipeline=p, label=LABEL, **kw)
    reg.register(h)
    return h


def call(reg, name, transport="direct", **args):
    return T.invoke(name, args, transport, registry=reg)


def unverified(t):
    return make_event("reach_complete", t=t, to_dot=1, from_dot=0, verified=False, reason="marker_lost", reach_ms=900, arc=1, phase="slow")


def test_tool_catalogue_matches_the_design():
    assert set(T.SERVERS) == {"perception", "exertion", "coach"}
    assert set(T.SERVERS["perception"]) == {"get_events", "get_set_summary", "check_setup", "recalibrate"}
    assert set(T.SERVERS["exertion"]) == {"get_exertion_state", "get_prescription", "read_patient_model", "get_session_plan"}
    assert set(T.SERVERS["coach"]) == {"speak", "propose_adjustment", "request_rest", "request_resume", "flag_therapist", "end_session", "write_session_summary", "set_session_plan"}
    # every coach tool maps onto one of the six actions, and nothing else exists
    assert set(T.ACTION_OF.values()) <= {"instruct", "correct", "progress", "regress", "rest", "stop"}


def test_unknown_session_is_rejected(reg):
    with pytest.raises(T.ToolRejected, match="unknown session"):
        call(reg, "get_events", session_id="nope")


def test_get_events_and_set_summary_are_numbers_and_text(reg, tmp_path):
    h = handle(reg, tmp_path, mode="arm")
    evs = [
        make_event("rep_complete", t=1.0, set=1, rep=1, peak_deg=88.0, hold_s=3.1, verified=True, reason=None, lean=False, hike=False),
        make_event("rep_complete", t=5.0, set=1, rep=2, peak_deg=70.0, hold_s=1.2, verified=False, reason="target_missed", lean=True, hike=False),
        make_event("set_complete", t=5.0, set=1, reps=2, verified_reps=1, best_deg=88.0),
    ]
    h.session.on_events(evs, snapshot={}, t=5.0)
    out = call(reg, "get_events", session_id="s1", types=["rep_complete"], last_n=5)
    assert [e["type"] for e in out["events"]] == ["rep_complete", "rep_complete"]
    s = call(reg, "get_set_summary", session_id="s1")
    assert s["kind"] == "set" and s["reps"] == 2 and s["verified"] == 1
    assert s["peak_deg"] == [88.0, 70.0] and s["lean_count"] == 1
    assert s["not_verified"] == [{"id": evs[1].id, "reason": "target_missed", "kind": "missed"}]
    T.assert_no_pixels(out)
    T.assert_no_pixels(s)


def test_check_setup_on_the_latest_frame_names_the_failing_check(reg, tmp_path):
    h = handle(reg, tmp_path)
    frame, _ = camera_frame(CUP_TARGETS, hide_marker=3)
    h.pipeline.process(frame, 0.0, 0)
    r = call(reg, "check_setup", session_id="s1")
    assert r["failing"] == ["markers", "task_area", "angle"] or "markers" in r["failing"]
    T.assert_no_pixels(r)
    row = [x for x in h.session.trace.tail(5) if x["kind"] == "tool"][-1]
    assert row["server"] == "perception" and row["name"] == "check_setup" and row["ok"] is True
    assert row["transport"] == "direct" and isinstance(row["ms"], float) and "markers" in row["result_summary"]


def test_recalibrate_reports_after_the_next_frames(reg, tmp_path):
    h = handle(reg, tmp_path, recal_wait_s=0.05)
    frame, _ = camera_frame(CUP_TARGETS)
    h.pipeline.process(frame, 0.0, 0)
    h.begin_run("pause:failed_reps")
    r = call(reg, "recalibrate", session_id="s1")
    # no frames arrive in this unit test: the tool says so and checks the last frame instead
    assert r["ok"] is True and r["reset"] == "calibrator" and r["frames_seen"] == 0
    assert r["markers_found"] == [0, 1, 2, 3] and r["rms_mm"] is not None
    cmd = [e for e in h.drain(1.0) if e.type == "command"]
    assert cmd and cmd[0].payload["cmd"] == "recalibrate" and cmd[0].payload["source"] == "agent"
    validate_event(cmd[0].to_dict())


def test_action_tools_need_an_active_run_and_valid_evidence(reg, tmp_path):
    h = handle(reg, tmp_path)
    h.session.on_events([unverified(1.0)], snapshot={}, t=1.0)
    ev = h.session.recent_events()[-1].id
    with pytest.raises(T.ToolRejected, match="checkpoint"):
        call(reg, "speak", session_id="s1", text="Hi", cue="instruct", evidence=[ev])
    h.begin_run("arc_complete")
    for bad in ([], [10**9], ["x"]):
        with pytest.raises(T.ToolRejected, match="evidence"):
            call(reg, "speak", session_id="s1", text="Hi", cue="instruct", evidence=bad)
    assert h.drain(1.0) == []  # nothing was emitted
    r = call(reg, "speak", session_id="s1", text="Keep the markers clear.", cue="correct", evidence=[ev])
    assert r["ok"] is True and r["action"] == "correct"
    out = h.drain(2.0)
    coach = next(e for e in out if e.type == "coach")
    assert coach.payload["source"] == "agent" and coach.payload["label"] == LABEL
    assert coach.payload["action"] == "correct" and coach.payload["evidence"] == [ev]
    validate_event(coach.to_dict())


def test_speak_text_and_rate_limits(reg, tmp_path):
    h = handle(reg, tmp_path)
    h.session.on_events([unverified(1.0)], snapshot={}, t=1.0)
    ev = h.session.recent_events()[-1].id
    h.begin_run("arc_complete")
    with pytest.raises(T.ToolRejected, match="160"):
        call(reg, "speak", session_id="s1", text="x" * 161, cue="instruct", evidence=[ev])
    with pytest.raises(T.ToolRejected, match="cue"):
        call(reg, "speak", session_id="s1", text="hi", cue="progress", evidence=[ev])
    call(reg, "speak", session_id="s1", text="One.", cue="instruct", evidence=[ev])
    with pytest.raises(T.ToolRejected, match="rate"):
        call(reg, "speak", session_id="s1", text="Two.", cue="instruct", evidence=[ev])


def test_propose_adjustment_is_clamped_and_needs_the_patients_tap(reg, tmp_path):
    h = handle(reg, tmp_path, mode="arm")
    e = make_event("set_complete", t=5.0, set=1, reps=8, verified_reps=6, best_deg=74.0)
    h.session.on_events([e], snapshot={}, t=5.0)
    h.begin_run("set_complete")
    r = call(reg, "propose_adjustment", session_id="s1", exercise="abduction", field="target_deg", value=40, reason="Peaks fell over the set.", evidence=[e.id])
    assert r["value"] == 60.0 and r["clamped"] is True and r["action"] == "regress"
    out = h.drain(6.0)
    coach = next(x for x in out if x.type == "coach")
    prompt = coach.payload["ui"]["prompt"]
    assert prompt["kind"] == "adjustment" and prompt["options"][:2] == ["Yes, change it", "Keep as is"] and "Why?" in prompt["options"]
    assert prompt["within_prescription"] is True
    assert prompt["proposal"] == {"exercise": "abduction", "field": "target_deg", "value": 60.0, "requested": 40.0, "clamped": True, "unit": "°"}
    assert h.pipeline.snapshot()["arm"]["target_deg"] == 90  # nothing applied yet
    # a second proposal while one waits is refused
    with pytest.raises(T.ToolRejected, match="waiting"):
        call(reg, "propose_adjustment", session_id="s1", exercise="abduction", field="hold_s", value=2, reason="r", evidence=[e.id])


def test_propose_adjustment_rejects_fields_outside_the_prescription(reg, tmp_path):
    h = handle(reg, tmp_path, mode="arm")
    e = make_event("set_complete", t=5.0, set=1, reps=8, verified_reps=8, best_deg=90.0)
    h.session.on_events([e], snapshot={}, t=5.0)
    h.begin_run("set_complete")
    with pytest.raises(T.ToolRejected, match="not an allowed adaptation|field"):
        call(reg, "propose_adjustment", session_id="s1", exercise="abduction", field="weight_lb", value=2, reason="r", evidence=[e.id])
    with pytest.raises(T.ToolRejected, match="running"):
        call(reg, "propose_adjustment", session_id="s1", exercise="cup", field="phase", value="fast", reason="r", evidence=[e.id])
    with pytest.raises(T.ToolRejected, match="no change"):
        call(reg, "propose_adjustment", session_id="s1", exercise="abduction", field="target_deg", value=95, reason="r", evidence=[e.id])


def clean(h):
    """A clean camera frame (four markers, the cup on dot 0): request_resume's fresh check passes."""
    h.pipeline.process(camera_frame(CUP_TARGETS, cup_mm=CUP_TARGETS.targets_mm[0])[0], 0.0, 0)


def test_request_resume_only_while_a_rule_pause_holds(reg, tmp_path):
    h = handle(reg, tmp_path)
    clean(h)
    evs = [unverified(float(i)) for i in range(1, 4)]
    h.session.on_events(evs, snapshot={}, t=3.0)
    assert h.session.paused and h.session.pause_rule == "failed_reps"
    pause = h.session.recent_events(types=["pause"])[-1]
    h.begin_run("pause:failed_reps")
    r = call(reg, "request_resume", session_id="s1", reason="All four markers are visible again.", evidence=[pause.id])
    out = h.drain(4.0)
    coach = next(x for x in out if x.type == "coach")
    assert coach.payload["ui"]["prompt"]["kind"] == "resume" and coach.payload["ui"]["prompt"]["id"] == r["prompt_id"]
    assert h.session.paused  # never resumes on its own


@pytest.mark.parametrize(
    ("reason", "caption"),
    [
        ("All four corners are visible again.", "All four corners are visible again. Ready to carry on?"),
        ("Setup looks good now — ready to continue?", "Setup looks good now — ready to continue?"),
        ("Sheet markers are all visible now", "Sheet markers are all visible now. Ready to carry on?"),
    ],
)
def test_request_resume_caption_asks_once(reg, tmp_path, reason, caption):
    h = handle(reg, tmp_path)
    clean(h)
    h.session.on_events([unverified(float(i)) for i in range(1, 4)], snapshot={}, t=3.0)
    pause = h.session.recent_events(types=["pause"])[-1]
    h.begin_run("pause:failed_reps")
    call(reg, "request_resume", session_id="s1", reason=reason, evidence=[pause.id])
    coach = next(x for x in h.drain(4.0) if x.type == "coach")
    assert coach.payload["text"] == caption


def test_request_resume_refused_when_not_paused(reg, tmp_path):
    h = handle(reg, tmp_path)
    h.session.on_events([unverified(1.0)], snapshot={}, t=1.0)
    h.begin_run("arc_complete")
    with pytest.raises(T.ToolRejected, match="not paused"):
        call(reg, "request_resume", session_id="s1", reason="r", evidence=[h.session.recent_events()[-1].id])


def test_nothing_happens_once_the_session_is_stopped(reg, tmp_path):
    h = handle(reg, tmp_path)
    h.session.on_events([unverified(1.0)], snapshot={}, t=1.0)
    ev = h.session.recent_events()[-1].id
    h.begin_run("arc_complete")
    call(reg, "speak", session_id="s1", text="Queued before the stop.", cue="instruct", evidence=[ev])
    h.session.on_pain(8, t=2.0)
    assert h.session.stopped
    with pytest.raises(T.ToolRejected, match="stopped"):
        call(reg, "speak", session_id="s1", text="After.", cue="instruct", evidence=[ev])
    out = h.drain(3.0)
    assert not any(e.type == "coach" for e in out)  # the queued output is dropped too
    assert any(r["kind"] == "agent_drop" for r in h.session.trace.tail(20))


def test_run_and_session_budgets(reg, tmp_path):
    h = handle(reg, tmp_path)
    h.begin_run("arc_complete")
    for _ in range(T.RUN_TOOL_CALLS):
        call(reg, "get_exertion_state", session_id="s1")
    with pytest.raises(T.ToolRejected, match="budget"):
        call(reg, "get_exertion_state", session_id="s1")
    h.end_run()
    h.tool_calls = T.SESSION_TOOL_CALLS
    h.begin_run("arc_complete")
    with pytest.raises(T.ToolRejected, match="budget"):
        call(reg, "get_prescription", session_id="s1")


def test_rest_flag_end_and_note(reg, tmp_path):
    h = handle(reg, tmp_path)
    h.session.on_events([unverified(1.0)], snapshot={}, t=1.0)
    ev = h.session.recent_events()[-1].id
    h.begin_run("arc_complete")
    r = call(reg, "request_rest", session_id="s1", seconds=500, reason="Reach times slowed.", evidence=[ev])
    assert r["seconds"] == 120
    out = h.drain(2.0)
    assert [e.type for e in out] == ["coach", "rest"] and out[0].payload["action"] == "rest"
    time.sleep(0)  # rate limit only applies to speak
    call(reg, "flag_therapist", session_id="s1", reason="Asked to review setup.", evidence=[ev])
    out = h.drain(3.0)
    assert [e.type for e in out] == ["therapist_flag"] and h.session.stop_rules.flags[-1]["rule"] == "agent"
    n = call(reg, "write_session_summary", session_id="s1", note="Two clean arcs; markers were covered once.", evidence=[ev])
    assert n["ok"] is True and h.session.summary()["coach"]["note"]["text"].startswith("Two clean")
    with pytest.raises(T.ToolRejected, match="400"):
        call(reg, "write_session_summary", session_id="s1", note="x" * 401, evidence=[ev])
    call(reg, "end_session", session_id="s1", reason="Patient seems unwell.", evidence=[ev])
    out = h.drain(4.0)
    assert [e.type for e in out][:2] == ["coach", "stop"] and h.session.stopped
    assert any(e.type == "therapist_flag" for e in out)


def test_exertion_prescription_and_patient_model(reg, tmp_path):
    from praxis_session.store import Store

    st = Store(tmp_path / "t.db")
    st.seed_if_empty()
    handle(reg, tmp_path, mode="arm", store=st)
    x = call(reg, "get_exertion_state", session_id="s1")
    assert x["level"] == "low"
    rx = call(reg, "get_prescription", session_id="s1")
    assert rx["allowed_adaptations"] == {"hold_s": [2.0, 3.0], "target_deg": [60.0, 90.0], "reps": [6, 8]}
    assert rx["running"]["target_deg"] == 90 and rx["stop_rules"]["pain_max"] == 7
    pm = call(reg, "read_patient_model", session_id="s1")
    assert "sessions" in pm and len(pm["sessions"]) <= 5
    for r in (x, rx, pm):
        T.assert_no_pixels(r)


def test_patient_model_is_empty_for_a_replay(reg, tmp_path):
    h = handle(reg, tmp_path)
    h.session.replay_clip = "synthetic_cup_01"
    pm = call(reg, "read_patient_model", session_id="s1")
    assert pm["sessions"] == [] and "replay" in pm["note"]


def test_assert_no_pixels_catches_frames_bytes_and_base64():
    T.assert_no_pixels({"a": [1, 2.0, "text", None, {"b": True}]})
    for bad in ({"f": np.zeros((2, 2), np.uint8)}, {"b": b"\xff\xd8"}, {"s": "iVBORw0KGgo" + "A" * 300}, [bytearray(3)]):
        with pytest.raises(AssertionError):
            T.assert_no_pixels(bad)


def test_every_tool_result_is_pixel_free(reg, tmp_path):
    """Privacy: run every read tool on a session with a real frame in memory."""
    h = handle(reg, tmp_path)
    frame, _ = camera_frame(CUP_TARGETS)
    h.pipeline.process(frame, 0.0, 0)
    h.recal_wait_s = 0.01
    h.begin_run("arc_complete")
    for name in ("get_events", "get_set_summary", "check_setup", "recalibrate", "get_exertion_state", "get_prescription"):
        T.assert_no_pixels(call(reg, name, session_id="s1"))
    for row in h.session.trace.tail(50):
        T.assert_no_pixels(row)
