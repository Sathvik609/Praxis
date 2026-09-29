"""Contract for the agent coach batch (29 Sep): every coach event says who made it (`source`)
and carries its label; the session keeps its own ring of non-frame events so an agent's
evidence ids can be checked against this session only."""
from praxis_session.coach.base import Decision
from praxis_session.coach.rules import LABEL
from praxis_session.events import make_event
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.schema import validate_event
from praxis_session.session import RULE_LABEL_WITH_AGENT, CoachSession


def make(mode="cup", tmp_path=None, **kw):
    return CoachSession(mode=mode, prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="t", **kw)


def reach(t, verified=True, reason=None):
    return make_event("reach_complete", t=t, to_dot=1, from_dot=0, verified=verified, reason=reason, reach_ms=1200, arc=1, phase="slow")


def test_decision_defaults_to_rule_source():
    d = Decision("instruct", "x", "hi", "why", [1])
    assert d.source == "rule" and d.to_dict()["source"] == "rule"


def test_rule_coach_event_carries_source_and_pending_label_when_agent_off(tmp_path):
    s = make(tmp_path=tmp_path)
    out = s.on_events([reach(5.0)], snapshot={"cup": {"phase": "slow"}}, t=5.0)
    coach = next(x for x in out if x.type == "coach")
    assert coach.payload["source"] == "rule" and coach.payload["label"] == LABEL
    validate_event(coach.to_dict())
    action = [r for r in s.trace.tail(10) if r["kind"] == "action"][-1]
    assert action["label"] == LABEL


def test_rule_label_drops_pending_when_an_agent_is_configured(tmp_path):
    s = make(tmp_path=tmp_path, rule_label=RULE_LABEL_WITH_AGENT)
    out = s.on_events([reach(5.0)], snapshot={"cup": {"phase": "slow"}}, t=5.0)
    coach = next(x for x in out if x.type == "coach")
    assert coach.payload["label"] == "Rule-based coach" == RULE_LABEL_WITH_AGENT


def test_session_ring_holds_non_frame_and_stop_rule_events(tmp_path):
    s = make(tmp_path=tmp_path)
    evs = [make_event("frame", t=1.0), reach(1.0, False, "cup_occluded"), reach(2.0, False, "cup_occluded"), reach(3.0, False, "cup_occluded")]
    out = s.on_events(evs, snapshot={}, t=3.0)
    pause = next(x for x in out if x.type == "pause")
    assert s.has_event(evs[1].id) and s.has_event(pause.id)
    assert not s.has_event(evs[0].id)  # frames are never evidence
    assert not s.has_event(10**9)
    assert [e.type for e in s.recent_events(types=["pause"])] == ["pause"]


def test_agent_status_and_agent_source_validate_against_the_schema():
    validate_event(make_event("agent_status", state="thinking", trigger="set_complete", label="Claude agent · scripted (test)").to_dict())
    validate_event(make_event("command", cmd="resume", source="agent", ok=True).to_dict())
