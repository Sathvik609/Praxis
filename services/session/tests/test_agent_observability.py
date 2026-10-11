"""Agent observability (10 Oct): one JSON line per agent run end and per agent error on stdout,
and the `/api/agent/metrics` aggregate."""
import asyncio
import json

from praxis_session.agent import tools as T
from praxis_session.agent.budget import DailyRunBudget
from praxis_session.agent.metrics import AgentMetrics
from praxis_session.agent.model import ScriptedPlanner
from praxis_session.coach.agent import AgentCoach
from praxis_session.events import make_event
from praxis_session.pipeline import SessionPipeline
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.session import RULE_LABEL_WITH_AGENT, CoachSession

RUN_KEYS = {"evt", "ts", "session", "trigger", "outcome", "ms", "first_action_ms", "tool_calls", "tokens", "transport", "cost_usd_est", "policy_version"}


def coach(tmp_path, scripts, metrics, daily=None, timeout_s=5.0):
    reg = T.Registry()
    p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    s = CoachSession(mode="cup", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="obs1", rule_label=RULE_LABEL_WITH_AGENT)
    h = reg.register(T.SessionHandle(session=s, pipeline=p, label="Claude agent · scripted (test)"))
    s.agent = AgentCoach(ScriptedPlanner(scripts, transport="direct"), h, registry=reg, timeout_s=timeout_s, daily=daily, metrics=metrics)
    return s


def arc(s):
    e = make_event("arc_complete", t=1.0, arc=1, reaches=4, unverified=0)
    s.on_events([e], snapshot={}, t=1.0)
    return e


def lines(capsys):
    return [json.loads(x) for x in capsys.readouterr().out.splitlines() if x.startswith("{")]


def test_a_run_writes_one_json_line_with_the_cloudwatch_fields(tmp_path, capsys):
    m = AgentMetrics()
    s = coach(tmp_path, {"arc_complete": [{"tool": "get_set_summary"}, {"tool": "speak", "args": {"text": "Arc done.", "cue": "instruct", "evidence": "$evidence"}}]}, m)
    arc(s)
    asyncio.run(s.agent.run_pending())
    runs = [x for x in lines(capsys) if x["evt"] == "agent_run"]
    assert len(runs) == 1
    r = runs[0]
    assert RUN_KEYS <= set(r)
    assert r["session"] == "obs1" and r["trigger"] == "arc_complete" and r["outcome"] == "done"
    assert r["tool_calls"] == 2 and r["transport"] == "direct" and r["first_action_ms"] is not None
    assert r["cost_usd_est"] == 0 and r["policy_version"] == T.POLICY_VERSION


def test_an_error_writes_an_agent_error_line_and_counts_as_a_fallback(tmp_path, capsys):
    m = AgentMetrics()
    s = coach(tmp_path, {"arc_complete": [{"sleep": 1.0}]}, m, timeout_s=0.05)
    arc(s)
    asyncio.run(s.agent.run_pending())
    out = lines(capsys)
    err = [x for x in out if x["evt"] == "agent_error"]
    assert err and err[0]["error_kind"] == "timeout" and err[0]["session"] == "obs1"
    summ = m.summary()
    assert summ["runs_today"] == 1 and summ["by_outcome"] == {"error": 1}
    assert summ["errors_by_kind"] == {"timeout": 1} and summ["fallbacks"]["rule_coach"] == 1


def test_daily_cap_is_logged_and_reported(tmp_path, capsys):
    m = AgentMetrics()
    budget = DailyRunBudget(limit=1)
    budget.acquire()
    s = coach(tmp_path, {"arc_complete": [{"tool": "get_set_summary"}]}, m, daily=budget)
    arc(s)
    asyncio.run(s.agent.run_pending())
    assert any(x["evt"] == "agent_error" and x["error_kind"] == "daily_cap" for x in lines(capsys))
    summ = m.summary(budget)
    assert summ["by_outcome"] == {"daily_cap": 1}
    assert summ["cap"] == {"runs_today": 1, "daily_runs_limit": 1, "reached": True}


def test_summary_percentiles_and_means():
    m = AgentMetrics(emit=False)
    for i, fa in enumerate([100.0, 200.0, 300.0, 400.0]):
        m.run(session=f"s{i % 2}", trigger="arc_complete", outcome="done", first_action_ms=fa, tool_calls=2 + i % 2, transport="mcp" if i else "direct", input_tokens=1000, output_tokens=100)
    s = m.summary()
    assert s["runs_today"] == 4 and s["sessions"] == 2
    assert s["first_action_ms_p50"] in (200.0, 300.0) and s["first_action_ms_p95"] == 400.0
    assert s["mean_tool_calls"] == 2.5 and s["fallbacks"]["direct_tools"] == 1
    assert s["tokens"] == 4400 and s["cost_usd_est"] > 0


def test_yesterday_is_not_today():
    clock = [86400.0 * 10 + 5]
    m = AgentMetrics(now=lambda: clock[0], emit=False)
    m.run(session="a", trigger="checkin", outcome="done")
    clock[0] += 86400
    assert m.summary()["runs_today"] == 0


def test_metrics_endpoint(client):
    r = client.get("/api/agent/metrics")
    assert r.status_code == 200
    body = r.json()
    assert {"runs_today", "by_outcome", "errors_by_kind", "first_action_ms_p50", "first_action_ms_p95", "mean_tool_calls", "fallbacks", "cap", "mode", "policy_version"} <= set(body)
