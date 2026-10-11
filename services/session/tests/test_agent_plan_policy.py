"""Orchestration and autonomy (10 Oct): the session plan the agent sets at check-in and revises
only on new OpenCV evidence, and the AUTONOMY table the tool layer enforces."""
import asyncio
from pathlib import Path

import pytest

from praxis_session.agent import tools as T
from praxis_session.agent.model import DEFAULT_SCRIPT, SYSTEM_PROMPT, TRIGGER_JOB, ScriptedPlanner, build_prompt
from praxis_session.coach.agent import AgentCoach
from praxis_session.events import make_event
from praxis_session.pipeline import SessionPipeline
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.session import RULE_LABEL_WITH_AGENT, CoachSession

ROOT = Path(__file__).resolve().parents[3]


def handle(reg, tmp_path, mode="arm"):
    if mode == "arm":
        p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="abduction")
    else:
        p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    s = CoachSession(mode=mode, prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="pl", exercise="abduction" if mode == "arm" else None, rule_label=RULE_LABEL_WITH_AGENT)
    return reg.register(T.SessionHandle(session=s, pipeline=p, label="Claude agent · scripted (test)"))


def call(reg, name, **args):
    return T.invoke(name, {"session_id": "pl", **args}, "direct", registry=reg)


def ev(h, typ, **kw):
    e = make_event(typ, t=kw.pop("t", 1.0), **kw)
    h.session.on_events([e], snapshot={}, t=e.t)
    return e


# ---- plan ---------------------------------------------------------------------------------
def test_plan_is_set_at_checkin_and_stored_traced_and_reported(tmp_path):
    reg = T.Registry()
    h = handle(reg, tmp_path)
    e = ev(h, "exercise_start", exercise="abduction")
    h.begin_run("checkin")
    r = call(reg, "set_session_plan", goals=["2 sets of 8 to 90°", "hold 3 s"], watch=["trunk lean"], evidence=[e.id])
    assert r == {"ok": True, "version": 1, "revised": False}
    got = call(reg, "get_session_plan")
    assert got["plan"]["goals"] == ["2 sets of 8 to 90°", "hold 3 s"] and got["versions"] == 1
    rows = [x for x in h.session.trace.tail(50) if x["kind"] == "plan"]
    assert rows and rows[-1]["version"] == 1 and rows[-1]["evidence"] == [e.id]
    plan = h.session.summary()["coach"]["plan"]
    assert plan["version"] == 1 and plan["goals"][0] == "2 sets of 8 to 90°" and len(plan["history"]) == 1


def test_a_revision_needs_new_evidence_and_a_because(tmp_path):
    reg = T.Registry()
    h = handle(reg, tmp_path)
    e1 = ev(h, "exercise_start", exercise="abduction")
    h.begin_run("checkin")
    call(reg, "set_session_plan", goals=["2 x 8 to 90°"], watch=["lean"], evidence=[e1.id])
    h.end_run()
    e2 = ev(h, "set_complete", t=20.0, set=1, reps=8, verified_reps=5)
    h.begin_run("set_complete")
    with pytest.raises(T.ToolRejected, match="because"):
        call(reg, "set_session_plan", goals=["80° target"], watch=["falling peaks"], evidence=[e2.id])
    with pytest.raises(T.ToolRejected, match="new evidence"):
        call(reg, "set_session_plan", goals=["80° target"], watch=["falling peaks"], evidence=[e1.id], because="peaks fell")
    r = call(reg, "set_session_plan", goals=["80° target for set 2"], watch=["falling peaks", "lean"], evidence=[e1.id, e2.id], because="Set 1 peaks slid from 90° to 78°.")
    assert r == {"ok": True, "version": 2, "revised": True}
    plan = h.session.summary()["coach"]["plan"]
    assert plan["version"] == 2 and plan["because"] == "Set 1 peaks slid from 90° to 78°." and [p["version"] for p in plan["history"]] == [1, 2]


def test_plan_limits(tmp_path):
    reg = T.Registry()
    h = handle(reg, tmp_path)
    e = ev(h, "exercise_start", exercise="abduction")
    h.begin_run("checkin")
    with pytest.raises(T.ToolRejected, match="at most 3"):
        call(reg, "set_session_plan", goals=["a", "b", "c", "d"], watch=[], evidence=[e.id])
    with pytest.raises(T.ToolRejected, match="characters"):
        call(reg, "set_session_plan", goals=["x" * 200], watch=[], evidence=[e.id])
    with pytest.raises(T.ToolRejected, match="evidence"):
        call(reg, "set_session_plan", goals=["a"], watch=[], evidence=[999999])
    h.end_run()
    with pytest.raises(T.ToolRejected, match="checkpoint"):
        call(reg, "set_session_plan", goals=["a"], watch=[], evidence=[e.id])


def test_the_plan_is_in_the_next_prompt_and_the_jobs_say_when_to_revise(tmp_path):
    reg = T.Registry()
    h = handle(reg, tmp_path)
    e = ev(h, "exercise_start", exercise="abduction")
    h.begin_run("checkin")
    call(reg, "set_session_plan", goals=["2 x 8 to 90°"], watch=["lean"], evidence=[e.id])
    h.end_run()
    assert '"plan": {"version": 1' in build_prompt(h, "set_complete", [e.id], [])
    assert "set_session_plan" in TRIGGER_JOB["checkin"] and "set_session_plan" in TRIGGER_JOB["set_complete"]
    assert "set_session_plan" in SYSTEM_PROMPT
    assert any(step.get("tool") == "set_session_plan" for step in DEFAULT_SCRIPT["checkin"])


def test_scripted_checkin_sets_the_plan_end_to_end(tmp_path):
    reg = T.Registry()
    p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    s = CoachSession(mode="cup", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="pl2", rule_label=RULE_LABEL_WITH_AGENT)
    h = reg.register(T.SessionHandle(session=s, pipeline=p, label="Claude agent · scripted (test)"))
    s.agent = AgentCoach(ScriptedPlanner(DEFAULT_SCRIPT, transport="direct"), h, registry=reg)
    s.on_checkin(2, "ok", 10, False, 0.0)
    asyncio.run(s.agent.run_pending())
    assert s.plan is not None and s.plan["version"] == 1 and s.plan["trigger"] == "checkin"


# ---- autonomy policy ----------------------------------------------------------------------
def test_every_tool_has_a_policy_and_none_of_them_is_never():
    assert set(T.TOOLS) <= set(T.AUTONOMY)
    for name in T.TOOLS:
        level, reason = T.AUTONOMY[name]
        assert level in T.AUTONOMY_LEVELS and level != "never" and reason
    never = [n for n, (lvl, _) in T.AUTONOMY.items() if lvl == "never"]
    assert {"apply_adjustment", "resume_session", "change_prescription", "override_stop_rule"} <= set(never)
    assert not set(never) & set(T.TOOLS)
    assert T.AUTONOMY["propose_adjustment"][0] == T.AUTONOMY["request_resume"][0] == "patient_approval"


def test_a_never_action_is_refused_by_the_tool_layer(tmp_path):
    reg = T.Registry()
    h = handle(reg, tmp_path)
    h.begin_run("set_complete")
    with pytest.raises(T.ToolRejected, match="never") as err:
        call(reg, "apply_adjustment", field="target_deg", value=120)
    assert err.value.kind == "policy"
    assert any(x["kind"] == "tool" and x["name"] == "apply_adjustment" and not x["ok"] for x in h.session.trace.tail(20))


@pytest.mark.parametrize("name,args", [("recalibrate", {}), ("set_session_plan", {"goals": ["a"], "watch": [], "evidence": [1]}), ("request_rest", {"seconds": 30, "reason": "r", "evidence": [1]})])
def test_forbidden_after_stop(tmp_path, name, args):
    reg = T.Registry()
    h = handle(reg, tmp_path)
    h.session.on_pain(8, 1.0)
    assert h.session.stopped
    h.begin_run("set_complete")
    with pytest.raises(T.ToolRejected, match="stop") as err:
        call(reg, name, **args)
    assert err.value.kind == "stopped"


def test_reads_and_the_summary_note_stay_allowed_after_a_stop(tmp_path):
    reg = T.Registry()
    h = handle(reg, tmp_path)
    h.session.on_pain(8, 1.0)
    h.begin_run("feedback")
    assert "events" in call(reg, "get_events")
    ev_id = h.session.recent_events()[-1].id
    assert call(reg, "write_session_summary", note="Stopped for pain 8.", evidence=[ev_id])["ok"]


def test_policy_table_is_rendered_into_the_docs():
    md = T.autonomy_markdown()
    assert md.startswith("| Tool | Autonomy | Why |") and "`propose_adjustment`" in md
    assert md in (ROOT / "docs" / "AGENT.md").read_text()
