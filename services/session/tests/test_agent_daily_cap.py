"""Daily cap on agent runs (PRAXIS_AGENT_DAILY_RUNS): spend safety for the public, login-free
site. Over the cap the model is never called, the session goes offline once with the reason, a
trace row says why, and the rule coach carries on; the next UTC day the agent runs again."""
import asyncio
from datetime import datetime, timezone

import pytest

from praxis_session.agent import tools as T
from praxis_session.agent.budget import DAILY_CAP_REASON, DEFAULT_DAILY_RUNS, DailyRunBudget
from praxis_session.agent.model import PlanResult, load_config
from praxis_session.coach.agent import AgentCoach
from praxis_session.events import make_event
from praxis_session.pipeline import SessionPipeline
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.session import RULE_LABEL_WITH_AGENT, CoachSession

LABEL = "Claude agent · scripted (test)"
DAY1 = datetime(2026, 10, 10, 23, 59, 0, tzinfo=timezone.utc).timestamp()
DAY2 = datetime(2026, 10, 11, 0, 0, 1, tzinfo=timezone.utc).timestamp()


class Clock:
    def __init__(self, t: float) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


class CountingPlanner:
    """Stands in for the model: counts how often it is asked to run."""

    transport = "direct"
    model = "counting"

    def __init__(self) -> None:
        self.calls = 0

    async def run(self, ctx):
        self.calls += 1
        return PlanResult(transport="direct")


# ---- the counter ----------------------------------------------------------------------------
def test_budget_allows_up_to_the_limit_then_refuses():
    b = DailyRunBudget(2, now=Clock(DAY1))
    assert [b.acquire() for _ in range(3)] == [True, True, False]
    assert b.runs_today == 2
    assert b.health() == {"runs_today": 2, "daily_runs_limit": 2}


def test_zero_means_unlimited():
    b = DailyRunBudget(0, now=Clock(DAY1))
    assert all(b.acquire() for _ in range(1000))
    assert b.runs_today == 1000 and b.health()["daily_runs_limit"] == 0


def test_the_count_resets_at_utc_midnight():
    clock = Clock(DAY1)
    b = DailyRunBudget(1, now=clock)
    assert b.acquire() and not b.acquire()
    clock.t = DAY2
    assert b.runs_today == 0
    assert b.acquire() and not b.acquire()


@pytest.mark.parametrize("raw,limit", [(None, DEFAULT_DAILY_RUNS), ("0", 0), ("5", 5), (" 12 ", 12), ("abc", DEFAULT_DAILY_RUNS), ("-3", DEFAULT_DAILY_RUNS)])
def test_config_reads_the_daily_limit(raw, limit):
    env = {"PRAXIS_AGENT": "scripted"} | ({"PRAXIS_AGENT_DAILY_RUNS": raw} if raw is not None else {})
    cfg = load_config(env)
    assert cfg.budget.limit == limit
    assert cfg.health(False)["daily_runs_limit"] == limit and cfg.health(False)["runs_today"] == 0
    assert DEFAULT_DAILY_RUNS == 100


# ---- the coach obeys it ---------------------------------------------------------------------
def build(tmp_path, budget):
    reg = T.Registry()
    p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    s = CoachSession(mode="cup", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="cap1", rule_label=RULE_LABEL_WITH_AGENT)
    h = reg.register(T.SessionHandle(session=s, pipeline=p, label=LABEL))
    planner = CountingPlanner()
    s.agent = AgentCoach(planner, h, registry=reg, label=LABEL, daily=budget)
    return s, h, planner


def arc(s, n):
    s.on_events([make_event("arc_complete", t=float(n), arc=n, reaches=4, unverified=0)], snapshot={}, t=float(n))
    asyncio.run(s.agent.run_pending())


def rows(s, kind):
    return [r for r in s.trace.tail(500) if r["kind"] == kind]


def statuses(h, t):
    return [e.payload for e in h.drain(t) if e.type == "agent_status"]


def test_cap_blocks_the_next_run_without_calling_the_model(tmp_path):
    clock = Clock(DAY1)
    s, h, planner = build(tmp_path, DailyRunBudget(1, now=clock))
    arc(s, 1)
    assert planner.calls == 1 and [st["state"] for st in statuses(h, 1.5)][-1] == "idle"

    arc(s, 2)  # the (cap + 1)th run
    assert planner.calls == 1
    st = statuses(h, 2.5)
    assert [x["state"] for x in st] == ["offline"]
    assert st[0]["reason"] == DAILY_CAP_REASON == "Daily agent limit reached · rule coach continues"
    err = rows(s, "agent_error")
    assert len(err) == 1 and err[0]["error_kind"] == "daily_cap" and err[0]["message"]
    assert len([r for r in rows(s, "agent_run") if r["phase"] == "start"]) == 1
    assert s.agent.offline

    arc(s, 3)  # still capped: no second status, no second error row, still no model call
    assert planner.calls == 1 and statuses(h, 3.5) == [] and len(rows(s, "agent_error")) == 1

    # the rule coach carries on
    ok = make_event("reach_complete", t=4.0, to_dot=2, from_dot=1, verified=True, reason=None, reach_ms=800, arc=4, phase="slow")
    rule = [e for e in s.on_events([ok], snapshot={"cup": {"phase": "slow"}}, t=4.0) if e.type == "coach"]
    assert rule and rule[0].payload["source"] == "rule"

    # next UTC day: the agent runs again and clears offline
    clock.t = DAY2
    arc(s, 5)
    assert planner.calls == 2 and [x["state"] for x in statuses(h, 5.5)][-1] == "idle" and not s.agent.offline


def test_cap_counts_runs_across_sessions(tmp_path):
    budget = DailyRunBudget(1, now=Clock(DAY1))
    s1, h1, p1 = build(tmp_path / "a", budget)
    s2, h2, p2 = build(tmp_path / "b", budget)
    arc(s1, 1)
    arc(s2, 1)
    assert (p1.calls, p2.calls) == (1, 0)
    assert rows(s2, "agent_error")[0]["error_kind"] == "daily_cap"


def test_unlimited_budget_never_blocks(tmp_path):
    s, h, planner = build(tmp_path, DailyRunBudget(0, now=Clock(DAY1)))
    for n in range(1, 6):
        arc(s, n)
    assert planner.calls == 5 and rows(s, "agent_error") == []


# ---- /health --------------------------------------------------------------------------------
def test_health_reports_runs_today_and_the_limit(client, monkeypatch):
    import praxis_session.main as main

    cfg = load_config({"PRAXIS_AGENT": "scripted", "PRAXIS_AGENT_DAILY_RUNS": "7"})
    cfg.budget.acquire()
    monkeypatch.setattr(main, "AGENT_CFG", cfg)
    agent = client.get("/health").json()["agent"]
    assert agent["runs_today"] == 1 and agent["daily_runs_limit"] == 7
    assert agent["mode"] == "scripted"
