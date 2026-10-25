"""How a live socket ended (21 Oct team test). A session is stored only when its feedback
arrives, so a socket that dropped mid-session left nothing in /api/review and the 13 Oct drops
(~20 s after an agent run) could not be counted. Every coach socket now ends with a
`socket_close` trace row and `ended_by` / `close_code` on the ops session_end line, and the
review counts live sockets that closed before their session was saved."""
import json

import pytest

import praxis_session.trace as trace_mod
from praxis_session.review import build_review, render_md, unsaved_closes

CHECKIN = '{"cmd":"checkin","pain":2,"energy":"comfortable","minutes":10,"new_symptoms":false}'


@pytest.fixture
def trace_dir(tmp_path, monkeypatch):
    d = tmp_path / "traces"
    monkeypatch.setattr(trace_mod, "DEFAULT_DIR", d)
    return d


def _rows(trace_dir, sid):
    return [json.loads(x) for x in (trace_dir / f"{sid}.jsonl").read_text().splitlines()]


def _end_line(out, sid):
    rows = [json.loads(x) for x in out.splitlines() if x.startswith("{")]
    return [r for r in rows if r.get("session") == sid and r.get("evt") == "session_end"][-1]


def test_a_socket_that_closes_before_the_feedback_says_so(client, trace_dir, capsys):
    with client.websocket_connect("/session?mode=cup&sheet=cup_targets") as ws:
        ws.send_text(CHECKIN)
        sid = ws.receive_json()["session_id"]
        ws.close(code=1006)
    close = [r for r in _rows(trace_dir, sid) if r["kind"] == "socket_close"]
    assert len(close) == 1
    c = close[0]
    assert c["saved"] is False and c["close_code"] == 1006 and c["source"] == "live"
    assert c["agent_run_in_flight"] is None and "s_since_last_message" in c
    end = _end_line(capsys.readouterr().out, sid)
    assert end["ended_by"] == "socket_closed" and end["close_code"] == 1006


def test_a_socket_closed_after_the_feedback_is_a_saved_session(client, trace_dir, capsys):
    with client.websocket_connect("/session?mode=cup&sheet=cup_targets") as ws:
        ws.send_text(CHECKIN)
        sid = ws.receive_json()["session_id"]
        ws.send_text('{"cmd":"feedback","pain_after":1,"ended_early":true,"end_reason":"finished"}')
        while ws.receive_json().get("cmd") != "feedback":
            pass
    (c,) = [r for r in _rows(trace_dir, sid) if r["kind"] == "socket_close"]
    assert c["saved"] is True
    assert _end_line(capsys.readouterr().out, sid)["ended_by"] == "feedback"


def test_the_review_counts_live_sockets_closed_before_their_session_was_saved(tmp_path):
    d = tmp_path / "t"
    d.mkdir()
    rows = {
        "drop1": [{"kind": "session", "mode": "arm", "exercise": "abduction", "user": "tester a"},
                  {"kind": "agent_run", "phase": "end", "ts": 100.0},
                  {"kind": "socket_close", "saved": False, "close_code": 1006, "source": "live", "agent_run_in_flight": None, "s_since_agent_run": 21.0, "ts": 121.0}],
        "drop2": [{"kind": "session", "mode": "arm", "exercise": "abduction", "user": "tester b"},
                  {"kind": "socket_close", "saved": False, "close_code": 1001, "source": "live", "agent_run_in_flight": "checkin", "s_since_agent_run": None}],
        "saved": [{"kind": "session", "mode": "cup"}, {"kind": "socket_close", "saved": True, "close_code": 1000, "source": "live"}],
        "replay": [{"kind": "session", "mode": "cup"}, {"kind": "socket_close", "saved": False, "close_code": 1000, "source": "replay"}],
        "stored": [{"kind": "session", "mode": "cup"}, {"kind": "socket_close", "saved": False, "close_code": 1006, "source": "live"}],
    }
    for sid, rs in rows.items():
        (d / f"{sid}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rs))
    drops = unsaved_closes(d, exclude={"stored"})
    assert sorted(x["session"] for x in drops) == ["drop1", "drop2"]
    r = build_review([], {}, None, drops)
    u = r["unsaved_sockets"]
    assert u["count"] == 2 and u["close_codes"] == {"1006": 1, "1001": 1}
    assert u["agent_run_in_flight"] == 1 and u["within_30s_of_agent_run"] == 1
    assert u["testers"] == {"tester a": 1, "tester b": 1}
    md = render_md(r)
    assert "Sockets closed before the session was saved: 2" in md and "1006 ×1" in md
