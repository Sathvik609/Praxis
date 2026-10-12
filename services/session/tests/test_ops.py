"""Ops logs + CloudWatch EMF (12 Oct): line format, the EMF block, the privacy guard, the
heartbeat, and the session_start / stop_rule / session_end lines from a real socket."""
import asyncio
import json

import numpy as np
import pytest

from praxis_session import ops
from praxis_session.agent.metrics import AgentMetrics
from praxis_session.events import make_event
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.session import CoachSession


def lines(capsys):
    return [json.loads(x) for x in capsys.readouterr().out.splitlines() if x.startswith("{")]


def test_emf_block_follows_the_spec(monkeypatch):
    f = ops.emf_fields({"Sessions": 1, "FrameProcP95Ms": 41.5, "EventToCueP95Ms": None}, {"Exercise": "cup", "Mode": "live", "Service": "session"}, 1_760_000_000_000)
    aws = f["_aws"]
    assert aws["Timestamp"] == 1_760_000_000_000
    (d,) = aws["CloudWatchMetrics"]
    assert d["Namespace"] == "Praxis" and d["Dimensions"] == [["Exercise", "Mode"]]
    assert {m["Name"]: m["Unit"] for m in d["Metrics"]} == {"Sessions": "Count", "FrameProcP95Ms": "Milliseconds"}
    # dimension values and metric values are top-level members; a None metric is left out
    assert f["Exercise"] == "cup" and f["Mode"] == "live" and "Service" not in f
    assert f["Sessions"] == 1.0 and f["FrameProcP95Ms"] == 41.5 and "EventToCueP95Ms" not in f


def test_emf_groups_by_dimension_set_and_rejects_unknown_names():
    f = ops.emf_fields({"Sessions": 1, "WsErrors": 1}, {"Exercise": "nhpt", "Mode": "replay", "Service": "session"}, 0)
    dsets = sorted(tuple(d["Dimensions"][0]) for d in f["_aws"]["CloudWatchMetrics"])
    assert dsets == [("Exercise", "Mode"), ("Service",)] and f["Service"] == "session"
    with pytest.raises(KeyError):
        ops.emf_fields({"NotAMetric": 1}, {"Service": "session"}, 0)
    with pytest.raises(KeyError):
        ops.emf_fields({"Sessions": 1}, {"Service": "session"}, 0)  # Exercise/Mode missing
    assert ops.emf_fields({"Sessions": None}, {}, 0) == {}


def test_emf_is_off_by_default_and_on_with_the_env(monkeypatch):
    monkeypatch.delenv("PRAXIS_EMF", raising=False)
    assert "_aws" not in ops.build("ws_error", {"code": "x"}, {"WsErrors": 1})
    monkeypatch.setenv("PRAXIS_EMF", "1")
    row = ops.build("ws_error", {"code": "x"}, {"WsErrors": 1}, now=1000.0)
    assert row["_aws"]["Timestamp"] == 1_000_000 and row["WsErrors"] == 1.0 and row["Service"] == "session"
    assert row["evt"] == "ws_error" and row["ts"] == 1000.0


def test_clean_drops_pii_frames_and_free_text_at_any_depth():
    dirty = {
        "session": "abc", "username": "maria", "notes": "my shoulder hurts", "frame": b"\xff\xd8\xff",
        "img": np.zeros((4, 4, 3), np.uint8), "nested": {"told_us": {"pain": 8}, "ok": 1, "raw": bytearray(b"x")},
        "list": [b"jpeg", {"detail": "pain 8/10", "rule": "pain"}], "long": "x" * 1000,
    }
    c = ops.clean(dirty)
    text = json.dumps(c)
    for leak in ("maria", "shoulder", "told_us", "pain 8/10", "\\u00ff", "jpeg"):
        assert leak not in text
    assert c["session"] == "abc" and c["nested"] == {"ok": 1} and c["list"] == [{"rule": "pain"}]
    assert len(c["long"]) == ops.MAX_STR


def _session(tmp_path):
    s = CoachSession(mode="cup", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="ops1", username="Maria")
    s.on_checkin(2, "comfortable", 14, False, 1.0, notes="I slept badly, my neighbour Joan helped")
    return s


def test_session_end_line_has_counts_and_latency_but_no_pii(tmp_path, capsys, monkeypatch):
    monkeypatch.setenv("PRAXIS_EMF", "1")
    s = _session(tmp_path)
    s.counts.update(reps_total=5, verified=4, unverified=1)
    so = ops.SessionOps("ops1", "cup", None, "live", now=100.0)
    so.observe([make_event("pause", rule="failed_reps", text="check the setup"), make_event("pause", rule="patient"), make_event("therapist_flag", rule="pain", detail="pain 8/10"), make_event("perception_lost", missing=[2, 3])])
    lat = {"frames": 120, "dropped": 2, "proc_p50": 18.0, "proc_p95": 33.3, "event_to_cue_p50": 1.2, "event_to_cue_p95": 4.0, "capture_to_event_p95": 90.0, "cues": 6}
    row = so.end(s.summary(), lat, now=110.0)
    assert so.end(s.summary(), lat) is None  # once only
    assert row["evt"] == "session_end" and row["session"] == "ops1" and row["source"] == "live"
    assert row["verified"] == 4 and row["unverified"] == 1 and row["duration_s"] == 10.0 and row["fps"] == 12.0
    assert row["proc_p95_ms"] == 33.3 and row["event_to_cue_p95_ms"] == 4.0
    assert row["stop_rule_actions"] == {"pause:failed_reps": 1} and row["flag_rules"] == ["pain"] and row["perception_lost"] == 1
    assert row["Exercise"] == "cup" and row["Mode"] == "live" and row["RepsVerified"] == 4.0 and row["StopRuleActions"] == 1.0
    out = capsys.readouterr().out
    for leak in ("Maria", "maria", "Joan", "slept", "pain 8/10", "check the setup"):
        assert leak not in out
    evts = [json.loads(x)["evt"] for x in out.splitlines()]
    assert evts == ["stop_rule", "therapist_flag", "perception_lost", "session_end"]  # the patient's own pause is not a stop rule


def test_arm_sessions_use_the_exercise_id_as_dimension():
    assert ops.SessionOps("a", "arm", "abduction", "replay").dims == {"Exercise": "abduction", "Mode": "replay"}
    assert ops.SessionOps("b", "nhpt", None, "live").dims == {"Exercise": "nhpt", "Mode": "live"}


def test_heartbeat_line_and_loop(capsys, monkeypatch):
    monkeypatch.setenv("PRAXIS_EMF", "1")
    row = ops.heartbeat(2, started_at=0.0, now=60.0)
    assert row["Heartbeat"] == 1.0 and row["ActiveSessions"] == 2.0 and row["uptime_s"] == 60

    async def run():
        task = asyncio.ensure_future(ops.heartbeat_loop(lambda: 0, interval_s=0.01))
        await asyncio.sleep(0.05)
        task.cancel()

    capsys.readouterr()
    asyncio.run(run())
    beats = [x for x in lines(capsys) if x["evt"] == "heartbeat"]
    assert len(beats) >= 2 and all(b["_aws"]["CloudWatchMetrics"][0]["Dimensions"] == [["Service"]] for b in beats)


def test_agent_lines_gain_emf_and_the_provider(capsys, monkeypatch):
    monkeypatch.setenv("PRAXIS_EMF", "1")
    monkeypatch.setenv("PRAXIS_AGENT", "anthropic")
    m = AgentMetrics()
    m.run(session="s", trigger="checkin", outcome="done", first_action_ms=800.0, input_tokens=1000, output_tokens=100, model="claude-x")
    m.run(session="s", trigger="checkin", outcome="error")
    m.error(session="s", error_kind="timeout", message="slow")
    a, b, c = lines(capsys)
    assert a["provider"] == "anthropic" and a["model"] == "claude-x"
    assert a["AgentRuns"] == 1.0 and a["AgentFirstActionMs"] == 800.0 and a["AgentCostUSD"] > 0 and "AgentFallbacks" not in a
    assert b["AgentFallbacks"] == 1.0 and "AgentCostUSD" not in b
    assert c["AgentErrors"] == 1.0 and c["Service"] == "session"
    # provider and model are fields, never dimensions
    for row in (a, b, c):
        assert row["_aws"]["CloudWatchMetrics"][0]["Dimensions"] == [["Service"]]
    # the in-memory aggregate never sees the EMF keys
    assert all("_aws" not in r for r in m._rows)


def test_agent_lines_without_emf_are_unchanged(capsys, monkeypatch):
    monkeypatch.delenv("PRAXIS_EMF", raising=False)
    AgentMetrics().run(session="s", trigger="checkin", outcome="done")
    (a,) = lines(capsys)
    assert "_aws" not in a and "AgentRuns" not in a


def test_a_socket_writes_start_stop_rule_and_end_lines(client, capsys, monkeypatch):
    monkeypatch.setenv("PRAXIS_EMF", "1")
    capsys.readouterr()
    with client.websocket_connect("/session?mode=cup&sheet=cup_targets") as ws:
        ws.send_text('{"cmd":"checkin","pain":2,"energy":"comfortable","minutes":14,"new_symptoms":false,"notes":"call me Maria"}')
        sid = ws.receive_json()["session_id"]
        ws.send_text('{"cmd":"pain","pain":7}')
        [ws.receive_json() for _ in range(3)]
        ws.send_bytes(b"not a jpeg")
        assert ws.receive_json()["code"] == "bad_frame"
    out = capsys.readouterr().out
    rows = [json.loads(x) for x in out.splitlines() if x.startswith("{")]
    mine = [r for r in rows if r.get("session") == sid]
    evts = [r["evt"] for r in mine]
    assert evts[0] == "session_start" and evts[-1] == "session_end"
    assert {"evt": "stop_rule", "action": "stop", "rule": "pain"}.items() <= next(r for r in mine if r["evt"] == "stop_rule").items()
    end = mine[-1]
    assert end["stopped"] is True and end["bad_frames"] == 1 and end["Sessions"] == 1.0 and end["Mode"] == "live"
    assert "Maria" not in out
    import praxis_session.main as main

    assert sid not in main.ops_sessions  # closed sockets leave the heartbeat count


def test_a_refused_socket_writes_a_ws_error_line(client, capsys, monkeypatch):
    monkeypatch.setenv("PRAXIS_EMF", "1")
    capsys.readouterr()
    with client.websocket_connect("/session?mode=nope") as ws:
        assert ws.receive_json()["code"] == "bad_mode"
    errs = [r for r in lines(capsys) if r["evt"] == "ws_error"]
    assert errs and errs[0]["code"] == "bad_mode" and errs[0]["WsErrors"] == 1.0
