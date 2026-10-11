"""The session service with the agent: /health agent block, labels, async delivery over the
replay socket, and the answer path. PRAXIS_AGENT=off stays the default (test_main.py)."""
import pytest

from praxis_session.agent.model import ScriptedPlanner, load_config
from praxis_session.coach.rules import LABEL as PENDING_LABEL

SCRIPTS = {
    "arc_complete": [
        {"tool": "get_set_summary"},
        {"tool": "speak", "args": {"text": "Arc {get_set_summary.boundary.arc} checked by the camera.", "cue": "instruct", "evidence": "$evidence"}},
    ],
    "feedback": [
        {"tool": "write_session_summary", "args": {"note": "Replay reviewed: arcs completed on the target sheet.", "evidence": "$evidence"}},
    ],
}


def test_health_reports_the_agent_off_by_default(client):
    agent = client.get("/health").json()["agent"]
    assert agent == {"mode": "off", "model": None, "mcp": False, "ready": False, "reason": "PRAXIS_AGENT=off", "runs_today": 0, "daily_runs_limit": 100}


def test_agent_off_keeps_the_pending_label_and_no_agent_events(client):
    with client.websocket_connect("/session?mode=cup&sheet=cup_targets&replay=synthetic_cup_01&clear=1") as ws:
        assert ws.receive_json()["type"] == "replay_start"  # no session_start / agent_status first
        ws.send_text('{"cmd":"checkin","pain":2,"energy":"ok","minutes":10}')
        seen = []
        for _ in range(400):
            e = ws.receive_json()
            seen.append(e)
            if e["type"] == "coach":
                break
    assert not any(e["type"] in ("agent_status", "session_start") for e in seen)
    coach = [e for e in seen if e["type"] == "coach"]
    assert coach and all(e["label"] == PENDING_LABEL and e["source"] == "rule" for e in coach)


@pytest.fixture
def agent_on(monkeypatch):
    import praxis_session.main as main

    monkeypatch.setattr(main, "AGENT_CFG", load_config({"PRAXIS_AGENT": "scripted"}))
    monkeypatch.setattr(main, "make_planner", lambda cfg: ScriptedPlanner(SCRIPTS, transport="direct"))
    return main


def test_replay_with_the_scripted_agent_delivers_agent_events(client, agent_on):
    with client.websocket_connect("/session?mode=cup&sheet=cup_targets&replay=synthetic_cup_01&clear=1") as ws:
        first = ws.receive_json()
        assert first["type"] == "session_start" and first["session_id"] and first["label"] == "Rule-based coach"
        assert first["agent"]["mode"] == "scripted" and first["agent"]["label"] == "Claude agent · scripted (test)"
        seen = []
        for _ in range(6000):
            e = ws.receive_json()
            seen.append(e)
            if e["type"] == "replay_end":
                break
        ws.send_text('{"cmd":"feedback","pain_after":2,"effort":4,"compared":"same"}')
        for _ in range(400):  # the feedback run's status arrives on the drain timer
            e = ws.receive_json()
            seen.append(e)
            if e["type"] == "agent_status" and e.get("trigger") == "feedback" and e["state"] != "thinking":
                break
    status = [e for e in seen if e["type"] == "agent_status"]
    assert status and {"thinking", "idle"} <= {e["state"] for e in status}
    agent_lines = [e for e in seen if e["type"] == "coach" and e["source"] == "agent"]
    assert agent_lines and agent_lines[0]["label"] == "Claude agent · scripted (test)"
    assert agent_lines[0]["text"].startswith("Arc ")
    rules = [e for e in seen if e["type"] == "coach" and e["source"] == "rule"]
    assert rules and all(e["label"] == "Rule-based coach" for e in rules)
    rows = client.get(f"/api/trace?session={first['session_id']}&n=2000").json()["rows"]
    kinds = {r["kind"] for r in rows}
    assert {"agent_run", "tool", "decide", "action"} <= kinds
    tool = next(r for r in rows if r["kind"] == "tool" and "server" in r)
    assert set(tool) >= {"server", "name", "args", "ok", "ms", "transport", "result_summary"}
    run_end = next(r for r in rows if r["kind"] == "agent_run" and r["phase"] == "end")
    assert set(run_end) >= {"trigger", "model", "transport", "ms", "input_tokens", "output_tokens", "outcome"}


def test_health_with_agent_configured(client, agent_on):
    agent = client.get("/health").json()["agent"]
    assert agent["mode"] == "scripted" and agent["ready"] is True and agent["model"] == "scripted"


def test_missing_key_keeps_the_rule_coach_and_says_why(client, monkeypatch):
    import praxis_session.main as main

    monkeypatch.setattr(main, "AGENT_CFG", load_config({"PRAXIS_AGENT": "anthropic"}))
    with client.websocket_connect("/session?mode=cup&sheet=cup_targets&replay=synthetic_cup_01&clear=1") as ws:
        first, second = ws.receive_json(), ws.receive_json()
    assert first["type"] == "session_start" and first["label"] == "Rule-based coach"
    assert second["type"] == "agent_status" and second["state"] == "offline" and "ANTHROPIC_API_KEY" in second["reason"]


def test_answer_accepting_an_agent_adjustment_emits_an_agent_command(tmp_path):
    import praxis_session.main as main
    from praxis_session.pipeline import SessionPipeline
    from praxis_session.prescription import SEED_PRESCRIPTION
    from praxis_session.session import CoachSession

    p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="abduction")
    s = CoachSession(mode="arm", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="a1", exercise="abduction")
    prompt = {"id": "adj-1", "kind": "adjustment", "title": "t", "text": "why", "options": ["Yes, change it", "Keep as is", "Why?"], "within_prescription": True, "proposal": {"exercise": "abduction", "field": "target_deg", "value": 75.0, "requested": 75.0, "clamped": False, "unit": "°"}}
    s.add_prompt(prompt, "adjustment", "why", {"cmd": "set_target", "target_deg": 75.0}, [1], "Claude agent · scripted (test)", "regress")
    out = main._handle_command({"cmd": "answer", "prompt": "adj-1", "choice": "Yes, change it"}, p, s, now=1.0)
    cmds = [e for e in out if e.type == "command"]
    assert cmds[-1].payload["cmd"] == "set_target" and cmds[-1].payload["source"] == "agent" and cmds[-1].payload["target_deg"] == 75.0
    assert p.snapshot()["arm"]["target_deg"] == 75.0
    confirm = next(e for e in out if e.type == "coach")
    assert confirm.payload["text"] == "Done. Target is now 75.0°."


def test_malformed_commands_are_refused_without_killing_the_session(tmp_path):
    """A bad value from the browser (or anyone on the socket) is a refused command event,
    never an exception that ends the session; pain outside 0-10 is refused, not clamped."""
    import praxis_session.main as main
    from praxis_session.pipeline import SessionPipeline
    from praxis_session.prescription import SEED_PRESCRIPTION
    from praxis_session.session import CoachSession

    p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="abduction")
    s = CoachSession(mode="arm", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="m1", exercise="abduction")
    bad = [
        {"cmd": "checkin", "pain": "seven"},
        {"cmd": "checkin", "pain": 3, "minutes": "lots"},
        {"cmd": "pain", "pain": None},
        {"cmd": "pain", "pain": 11},
        {"cmd": "pain", "pain": -1},
        {"cmd": "rpe", "rpe": [5]},
        {"cmd": "set_target", "target_deg": "high"},
        {"cmd": "sample_colour", "hole": "x"},
    ]
    for cmd in bad:
        out = main._handle_command(cmd, p, s, now=1.0)
        assert out and out[0].type == "command" and out[0].payload["ok"] is False, cmd
        assert not s.stopped, cmd
    # A non-object JSON body is treated like garbage, not a crash.
    assert main._handle_command(main._as_command([1, 2]), p, s, now=1.0)[0].payload["ok"] is False
    # The session still works afterwards.
    ok = main._handle_command({"cmd": "pain", "pain": 2}, p, s, now=2.0)
    assert ok[0].payload["ok"] is True
