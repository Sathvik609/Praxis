"""End-to-end agent loops with the scripted planner (no network): perceive -> decide -> act ->
re-perceive, with the patient's tap as the only way anything is applied (design §1, §5, §6)."""
import asyncio

import numpy as np
import pytest

from praxis_session.agent import mcp_server
from praxis_session.agent import tools as T
from praxis_session.agent.model import ScriptedPlanner
from praxis_session.coach.agent import AgentCoach
from praxis_session.events import make_event
from praxis_session.perception.board_spec import CUP_TARGETS
from praxis_session.perception.synth import camera_frame
from praxis_session.pipeline import SessionPipeline
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.schema import validate_event
from praxis_session.session import RULE_LABEL_WITH_AGENT, CoachSession

LABEL = "Claude agent · scripted (test)"

RECOVERY = {
    "pause": [
        {"tool": "check_setup"},
        {"tool": "speak", "args": {"text": "{check_setup.first_hint}", "cue": "correct", "evidence": "$evidence"}},
        {"tool": "recalibrate"},
        {"tool": "request_resume", "if": "recalibrate.calibrated", "args": {"reason": "All four markers are back in view.", "evidence": "$evidence"}},
    ]
}


def build(tmp_path, mode="cup", scripts=None, transport="mcp", mcp_url=None, timeout_s=5.0, recal_wait_s=1.0):
    reg = T.Registry()
    if mode == "arm":
        p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="abduction")
    else:
        p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    s = CoachSession(mode=mode, prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="i1", exercise="abduction" if mode == "arm" else None, rule_label=RULE_LABEL_WITH_AGENT)
    h = reg.register(T.SessionHandle(session=s, pipeline=p, label=LABEL, recal_wait_s=recal_wait_s))
    servers = mcp_server.build_servers(reg) if transport == "mcp" and mcp_url is None else None
    planner = ScriptedPlanner(scripts or {}, transport=transport, servers=servers, mcp_url=mcp_url)
    s.agent = AgentCoach(planner, h, registry=reg, label=LABEL, timeout_s=timeout_s)
    return s, p, h


def unverified(t, reason="marker_lost"):
    return make_event("reach_complete", t=t, to_dot=1, from_dot=0, verified=False, reason=reason, reach_ms=900, arc=1, phase="slow")


def rows(s, kind):
    return [r for r in s.trace.tail(500) if r["kind"] == kind]


def coach_events(out, source="agent"):
    return [e for e in out if e.type == "coach" and e.payload["source"] == source]


# ---- (a) setup recovery ---------------------------------------------------------------------
def test_setup_recovery_loop(tmp_path):
    s, p, h = build(tmp_path, scripts=RECOVERY)
    covered, _ = camera_frame(CUP_TARGETS, hide_marker=2)
    clean, _ = camera_frame(CUP_TARGETS)
    p.process(covered, 0.0, 0)
    out = s.on_events([unverified(float(i)) for i in (1, 2, 3)], snapshot={}, t=3.0)
    assert s.paused and s.pause_rule == "failed_reps" and any(e.type == "pause" for e in out)
    assert s.agent.pending and s.agent.pending[0][0] == "pause:failed_reps"

    async def patient_fixes_the_sheet():
        # the patient uncovers marker 2 while the agent recalibrates: frames keep coming
        for i in range(40):
            await asyncio.sleep(0.02)
            p.process(clean, 3.1 + i * 0.1, i + 1)

    async def go():
        await asyncio.gather(s.agent.run_pending(), patient_fixes_the_sheet())

    asyncio.run(go())
    out = h.drain(8.0)
    types = [e.type for e in out]
    assert types[0] == "agent_status" and out[0].payload["state"] == "thinking"
    said = coach_events(out)
    assert said[0].payload["action"] == "correct" and "2" in said[0].payload["text"]  # names the covered marker
    cmd = next(e for e in out if e.type == "command")
    assert cmd.payload == {"cmd": "recalibrate", "source": "agent", "ok": True, "session_id": "i1", "reset": "calibrator"}
    prompt = said[-1].payload["ui"]["prompt"]
    assert prompt["kind"] == "resume" and prompt["options"][:2] == ["Yes, resume", "Not yet"]
    assert out[-1].type == "agent_status" and out[-1].payload["state"] == "idle"
    for e in out:
        validate_event(e.to_dict())
    tools = [(r["name"], r["ok"], r["transport"]) for r in rows(s, "tool") if "server" in r]
    assert [t[0] for t in tools] == ["check_setup", "speak", "recalibrate", "request_resume"]
    assert all(ok and tr == "mcp" for _, ok, tr in tools)
    rec = next(r for r in rows(s, "tool") if r.get("name") == "recalibrate")
    assert '"calibrated": true' in rec["result_summary"]
    # still paused: the agent never resumes on its own
    assert s.paused
    pcmd, evs = s.on_answer(prompt["id"], "Yes, resume", 9.0)
    assert pcmd is None and not s.paused
    assert [e.type for e in evs][:2] == ["resume", "command"] and evs[1].payload["cmd"] == "resume" and evs[1].payload["source"] == "agent"
    end = rows(s, "agent_run")[-1]
    assert end["phase"] == "end" and end["outcome"] == "done" and end["trigger"] == "pause:failed_reps"
    assert end["transport"] == "mcp" and end["first_action_ms"] is not None


def test_resume_prompt_not_yet_keeps_the_pause(tmp_path):
    s, p, h = build(tmp_path, scripts={"pause": [{"tool": "request_resume", "args": {"reason": "Looks fixed.", "evidence": "$evidence"}}]})
    s.on_events([unverified(float(i)) for i in (1, 2, 3)], snapshot={}, t=3.0)
    asyncio.run(s.agent.run_pending())
    prompt = coach_events(h.drain(4.0))[-1].payload["ui"]["prompt"]
    _, evs = s.on_answer(prompt["id"], "Not yet", 5.0)
    assert s.paused and not any(e.type in ("resume", "command") for e in evs)


# ---- (b) dose adaptation --------------------------------------------------------------------
def falling_set(s):
    peaks = [90, 88, 84, 80, 77, 74, 71, 70]
    evs = [make_event("rep_complete", t=float(i), set=1, rep=i + 1, peak_deg=float(pk), hold_s=3.0, verified=pk >= 80, reason=None if pk >= 80 else "target_missed", lean=False, hike=False) for i, pk in enumerate(peaks)]
    evs.append(make_event("set_complete", t=8.0, set=1, reps=8, verified_reps=4, best_deg=90.0))
    s.on_events(evs, snapshot={}, t=8.0)
    return evs


ADAPT = {
    "set_complete": [
        {"tool": "get_set_summary"},
        {"tool": "get_exertion_state"},
        {"tool": "propose_adjustment", "args": {"exercise": "abduction", "field": "target_deg", "value": 75, "reason": "Your last reps peaked around 70-77°, so a 75° line keeps them countable.", "evidence": "$evidence"}},
    ]
}


@pytest.mark.parametrize("choice,applied", [("Yes, change it", True), ("Keep as is", False)])
def test_dose_adaptation_applies_only_on_yes(tmp_path, choice, applied):
    s, p, h = build(tmp_path, mode="arm", scripts=ADAPT)
    falling_set(s)
    asyncio.run(s.agent.run_pending())
    out = h.drain(9.0)
    proposal = coach_events(out)[-1]
    assert proposal.payload["action"] == "regress"
    prompt = proposal.payload["ui"]["prompt"]
    assert prompt["proposal"]["value"] == 75.0 and 60.0 <= prompt["proposal"]["value"] <= 90.0
    assert p.snapshot()["arm"]["target_deg"] == 90  # nothing yet
    _, why = s.on_answer(prompt["id"], "Why?", 9.5)
    assert why[0].payload["text"].startswith("Your last reps") and p.snapshot()["arm"]["target_deg"] == 90
    pcmd, evs = s.on_answer(prompt["id"], choice, 10.0)
    if applied:
        assert pcmd["cmd"] == "set_target" and pcmd["source"] == "agent"
        r = p.command(pcmd)
        assert r["ok"] and p.snapshot()["arm"]["target_deg"] == 75.0
    else:
        assert pcmd is None and p.snapshot()["arm"]["target_deg"] == 90
    assert s.prompts == {}


def test_out_of_range_proposal_is_clamped(tmp_path):
    scripts = {"set_complete": [{"tool": "propose_adjustment", "args": {"exercise": "abduction", "field": "target_deg", "value": 30, "reason": "Smaller.", "evidence": "$evidence"}}]}
    s, p, h = build(tmp_path, mode="arm", scripts=scripts)
    falling_set(s)
    asyncio.run(s.agent.run_pending())
    prop = coach_events(h.drain(9.0))[-1].payload["ui"]["prompt"]["proposal"]
    assert prop == {"exercise": "abduction", "field": "target_deg", "value": 60.0, "requested": 30.0, "clamped": True, "unit": "°"}


# ---- (c) guardrail --------------------------------------------------------------------------
def test_action_without_valid_evidence_is_rejected_and_nothing_is_emitted(tmp_path):
    scripts = {"arc_complete": [{"tool": "speak", "args": {"text": "Trust me.", "cue": "instruct", "evidence": [999999]}}]}
    s, p, h = build(tmp_path, scripts=scripts)
    s.on_events([make_event("arc_complete", t=1.0, arc=1, reaches=4, unverified=0)], snapshot={}, t=1.0)
    asyncio.run(s.agent.run_pending())
    out = h.drain(2.0)
    assert coach_events(out) == []
    bad = [r for r in rows(s, "tool") if r.get("name") == "speak"][-1]
    assert bad["ok"] is False and "evidence" in bad["result_summary"]


# ---- (d) pain stop mid-run ------------------------------------------------------------------
def test_pain_stop_mid_run_drops_agent_output(tmp_path):
    scripts = {"arc_complete": [
        {"tool": "speak", "args": {"text": "Queued before the stop.", "cue": "instruct", "evidence": "$evidence"}},
        {"sleep": 0.1},
        {"tool": "propose_adjustment", "args": {"exercise": "cup", "field": "phase", "value": "fast", "reason": "Clean arc.", "evidence": "$evidence"}},
    ]}
    s, p, h = build(tmp_path, scripts=scripts)
    s.on_events([make_event("arc_complete", t=1.0, arc=1, reaches=4, unverified=0, awaiting_phase=False)], snapshot={}, t=1.0)

    async def pain():
        await asyncio.sleep(0.05)
        s.on_pain(8, t=1.5)

    async def go():
        await asyncio.gather(s.agent.run_pending(), pain())

    asyncio.run(go())
    assert s.stopped
    out = h.drain(2.0)
    assert coach_events(out) == []
    assert [e.payload["state"] for e in out if e.type == "agent_status"] == ["thinking", "idle"]
    assert any(r["kind"] == "agent_drop" for r in s.trace.tail(100))
    assert rows(s, "agent_run")[-1]["outcome"] == "stale"
    late = [r for r in rows(s, "tool") if r.get("name") == "propose_adjustment"][-1]
    assert late["ok"] is False and "stopped" in late["result_summary"]
    # and no new run is scheduled once stopped
    s.on_events([make_event("arc_complete", t=3.0, arc=2, reaches=4, unverified=0)], snapshot={}, t=3.0)
    assert s.agent.pending == []


# ---- (e) planner failure --------------------------------------------------------------------
@pytest.mark.parametrize("step,kind,timeout", [({"raise": "boom"}, "model_error", 5.0), ({"sleep": 1.0}, "timeout", 0.05)])
def test_planner_failure_goes_offline_and_the_rule_coach_carries_on(tmp_path, step, kind, timeout):
    scripts = {"arc_complete": [step], "set_complete": [], "checkin": [{"tool": "get_prescription"}]}
    s, p, h = build(tmp_path, scripts=scripts, timeout_s=timeout)
    s.on_events([make_event("arc_complete", t=1.0, arc=1, reaches=4, unverified=0)], snapshot={}, t=1.0)
    asyncio.run(s.agent.run_pending())
    out = h.drain(2.0)
    status = [e for e in out if e.type == "agent_status"]
    assert status[-1].payload["state"] == "offline" and kind in status[-1].payload["reason"]
    err = rows(s, "agent_error")[-1]
    assert err["error_kind"] == kind and "message" in err
    assert s.agent.offline
    # rule coach still coaches
    ok = make_event("reach_complete", t=2.0, to_dot=2, from_dot=1, verified=True, reason=None, reach_ms=800, arc=2, phase="slow")
    rule = s.on_events([ok], snapshot={"cup": {"phase": "slow"}}, t=2.0)
    assert coach_events(rule, "rule") and coach_events(rule, "rule")[0].payload["label"] == "Rule-based coach"
    # the next checkpoint succeeds and clears offline
    s.on_checkin(2, "ok", 10, False, t=3.0)
    asyncio.run(s.agent.run_pending())
    out = h.drain(3.0)
    assert [e.payload["state"] for e in out if e.type == "agent_status"][-1] == "idle" and not s.agent.offline


# ---- (f) MCP down ---------------------------------------------------------------------------
def test_mcp_down_falls_back_to_direct_tools(tmp_path):
    scripts = {"arc_complete": [{"tool": "speak", "args": {"text": "Smooth arc.", "cue": "instruct", "evidence": "$evidence"}}]}
    s, p, h = build(tmp_path, scripts=scripts, mcp_url="http://127.0.0.1:9/mcp")
    s.on_events([make_event("arc_complete", t=1.0, arc=1, reaches=4, unverified=0)], snapshot={}, t=1.0)
    asyncio.run(s.agent.run_pending())
    out = h.drain(2.0)
    assert coach_events(out)[0].payload["text"] == "Smooth arc."
    assert rows(s, "agent_error")[-1]["error_kind"] == "mcp"
    assert rows(s, "agent_run")[-1]["transport"] == "direct"
    assert [r["transport"] for r in rows(s, "tool") if "server" in r] == ["direct"]


# ---- coalescing, budgets, feedback note -----------------------------------------------------
def test_checkpoints_coalesce_while_a_run_is_busy(tmp_path):
    scripts = {"*": [{"sleep": 0.05}]}
    s, p, h = build(tmp_path, scripts=scripts)

    async def go():
        s.on_events([make_event("arc_complete", t=1.0, arc=1, reaches=4, unverified=0)], snapshot={}, t=1.0)
        await asyncio.sleep(0.01)
        s.on_events([make_event("arc_complete", t=2.0, arc=2, reaches=4, unverified=0)], snapshot={}, t=2.0)
        s.on_events([unverified(float(i)) for i in (3, 4, 5)], snapshot={}, t=5.0)
        await s.agent.run_pending()

    asyncio.run(go())
    starts = [r for r in rows(s, "agent_run") if r["phase"] == "start"]
    assert [r["trigger"] for r in starts] == ["arc_complete", "pause:failed_reps"]
    assert starts[1]["also"] == ["arc_complete"]


def test_feedback_note_is_written_with_the_report(tmp_path):
    from praxis_session.store import Store

    scripts = {"feedback": [{"tool": "write_session_summary", "args": {"note": "Four arcs, three verified; one covered marker.", "evidence": "$evidence"}}]}
    s, p, h = build(tmp_path, scripts=scripts)
    st = Store(tmp_path / "n.db")
    st.seed_if_empty()
    h.store = st
    s.on_events([make_event("arc_complete", t=1.0, arc=1, reaches=4, unverified=1)], snapshot={}, t=1.0)
    asyncio.run(s.agent.run_pending())
    s.on_feedback({"pain_after": 2}, t=2.0)
    st.save_session(s.summary(2.0), s.checkin, s.feedback, [])
    asyncio.run(s.agent.run_pending())
    assert st.session("i1")["summary"]["coach"]["note"]["text"].startswith("Four arcs")
    assert s.summary()["coach"]["note"]["label"] == LABEL


def test_no_frame_pixels_anywhere_in_the_trace(tmp_path):
    s, p, h = build(tmp_path, scripts=RECOVERY, recal_wait_s=0.05)
    f, _ = camera_frame(CUP_TARGETS, hide_marker=1)
    p.process(f, 0.0, 0)
    s.on_events([unverified(float(i)) for i in (1, 2, 3)], snapshot={}, t=3.0)
    asyncio.run(s.agent.run_pending())
    h.drain(4.0)
    assert isinstance(p.latest_frame, np.ndarray)  # held in memory by reference only
    for r in s.trace.tail(500):
        T.assert_no_pixels(r)
