import json

import cv2
import numpy as np

from praxis_session.main import decode_jpeg


def test_health_reports_opencv_5_and_edge_mode(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["opencv_version"].startswith("5.")
    assert body["mode"] == "edge"


def test_decode_jpeg_roundtrip_and_empty():
    img = np.zeros((480, 640, 3), np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    out = decode_jpeg(buf.tobytes())
    assert out is not None and out.shape == (480, 640, 3)
    assert decode_jpeg(b"") is None


def test_ws_heartbeat_echoes_frame_info(client):
    img = np.zeros((480, 640, 3), np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    with client.websocket_connect("/session?mode=heartbeat") as ws:
        ws.send_bytes(buf.tobytes())
        msg = ws.receive_json()
    assert msg["type"] == "heartbeat"
    assert msg["frame"] == {"width": 640, "height": 480, "bytes": len(buf.tobytes())}
    assert msg["frame_index"] == 0


def test_ws_bad_mode_returns_error(client):
    with client.websocket_connect("/session?mode=nope") as ws:
        msg = ws.receive_json()
    assert msg["type"] == "error" and msg["code"] == "bad_mode"


def test_events_tail_lists_recent(client):
    img = np.zeros((480, 640, 3), np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    with client.websocket_connect("/session?mode=heartbeat") as ws:
        ws.send_bytes(buf.tobytes())
        ws.receive_json()
    r = client.get("/events?n=5")
    assert r.json()["count"] >= 1
    assert r.json()["events"][-1]["type"] == "heartbeat"


def test_ws_calibrate_returns_setup_checks(client):
    from praxis_session.perception.board_spec import NHPT_BOARD
    from praxis_session.perception.synth import camera_frame

    frame, _ = camera_frame(NHPT_BOARD)
    _, buf = cv2.imencode(".jpg", frame)
    with client.websocket_connect("/session?mode=calibrate&sheet=nhpt_board") as ws:
        ws.send_bytes(buf.tobytes())
        types = [ws.receive_json()["type"] for _ in range(3)]
    assert types == ["calibration", "quality", "setup_checks"]


def test_ws_bad_sheet(client):
    with client.websocket_connect("/session?mode=calibrate&sheet=zzz") as ws:
        assert ws.receive_json()["code"] == "bad_sheet"


def test_ws_nhpt_returns_frame_event_first(client):
    from praxis_session.perception.board_spec import NHPT_BOARD
    from praxis_session.perception.synth import camera_frame

    frame, _ = camera_frame(NHPT_BOARD, pegs_mm=[(160.0, 148.5)])
    _, buf = cv2.imencode(".jpg", frame)
    with client.websocket_connect("/session?mode=nhpt&sheet=nhpt_board") as ws:
        ws.send_bytes(buf.tobytes())
        msg = ws.receive_json()
    assert msg["type"] == "frame" and msg["calibrated"] and msg["nhpt"]["mode"] == "nhpt"


def test_health_reports_models_block(client):
    body = client.get("/health").json()
    assert set(body["models"]) == {"hand", "pose"}
    assert all(isinstance(v, bool) for v in body["models"].values())


def test_ws_cup_text_command_switches_phase(client):
    from praxis_session.perception.board_spec import CUP_TARGETS
    from praxis_session.perception.synth import camera_frame

    frame, _ = camera_frame(CUP_TARGETS, cup_mm=CUP_TARGETS.targets_mm[0])
    _, buf = cv2.imencode(".jpg", frame)
    with client.websocket_connect("/session?mode=cup&sheet=cup_targets") as ws:
        ws.send_text('{"cmd":"set_phase","phase":"fast"}')
        ack = ws.receive_json()
        assert ack["type"] == "command" and ack["ok"] is True
        ws.send_bytes(buf.tobytes())
        msg = ws.receive_json()
    assert msg["type"] == "frame" and msg["cup"]["phase"] == "fast"


def _cup_frame_bytes(dot=0):
    from praxis_session.perception.board_spec import CUP_TARGETS
    from praxis_session.perception.synth import camera_frame

    frame, _ = camera_frame(CUP_TARGETS, cup_mm=CUP_TARGETS.targets_mm[dot])
    _, buf = cv2.imencode(".jpg", frame)
    return buf.tobytes()


def test_ws_checkin_pain_stop_rule_and_trace(client):
    with client.websocket_connect("/session?mode=cup&sheet=cup_targets") as ws:
        ws.send_text('{"cmd":"checkin","pain":2,"energy":"comfortable","minutes":14,"new_symptoms":false}')
        ack = ws.receive_json()
        assert ack["type"] == "command" and ack["ok"] is True and ack["session_id"]
        sid = ack["session_id"]
        ws.send_text('{"cmd":"pain","pain":6}')
        msgs = [ws.receive_json() for _ in range(3)]
        types = [m["type"] for m in msgs]
        assert "stop" in types and "therapist_flag" in types
    r = client.get(f"/api/trace?session={sid}&n=20")
    kinds = [row["kind"] for row in r.json()["rows"]]
    assert "checkin" in kinds and "stop_rule" in kinds and "flag" in kinds
    s = client.get(f"/api/session/{sid}/summary").json()
    assert s["stopped"] is True and s["flags"][0]["rule"] == "pain"


def test_ws_coach_event_follows_perception_events(client):
    with client.websocket_connect("/session?mode=cup&sheet=cup_targets&clear=1") as ws:
        seen = []
        for dot in [0, 0, 0, None, None, None, 1, 1, 1, 1]:
            ws.send_bytes(_cup_frame_bytes(dot) if dot is not None else _blank_bytes())
            # drain everything that arrived for this frame
            msg = ws.receive_json()
            seen.append(msg["type"])
            while msg["type"] != "frame" or _pending(ws):
                try:
                    msg = ws.receive_json()
                    seen.append(msg["type"])
                except Exception:
                    break
    assert "reach_complete" in seen and "coach" in seen


def _blank_bytes():
    from praxis_session.perception.board_spec import CUP_TARGETS
    from praxis_session.perception.synth import camera_frame

    frame, _ = camera_frame(CUP_TARGETS)  # sheet visible, no cup (lifted)
    _, buf = cv2.imencode(".jpg", frame)
    return buf.tobytes()


def _pending(ws) -> bool:
    return False


def test_rest_store_endpoints(client):
    me = client.get("/api/patients/me").json()
    assert me["name"] == "Alex M."
    sessions = client.get("/api/sessions").json()["sessions"]
    assert len(sessions) >= 4
    one = client.get(f"/api/sessions/{sessions[0]['id']}").json()
    assert one["id"] == sessions[0]["id"] and "summary" in one
    flags = client.get("/api/flags").json()["flags"]
    assert flags and "rule" in flags[0]
    r = client.post(f"/api/flags/{flags[0]['id']}/reviewed").json()
    assert r["ok"] is True
    g = client.post("/api/goal-log", json={"note": "cup at lunch"}).json()
    assert g["ok"] is True and g["goal_attempts"] >= 1
    th = client.get("/api/therapist/patients").json()["patients"]
    assert th[0]["name"] == "Alex M." and "open_flags" in th[0]
    rp = client.get("/api/replay/list").json()["clips"]
    assert any(c["id"] == "synthetic_nhpt_01" for c in rp)


def test_ws_feedback_persists_session(client):
    with client.websocket_connect("/session?mode=cup&sheet=cup_targets") as ws:
        ws.send_text('{"cmd":"checkin","pain":2,"energy":"comfortable","minutes":14,"new_symptoms":false}')
        sid = ws.receive_json()["session_id"]
        ws.send_text('{"cmd":"feedback","pain_after":2,"effort":4,"compared":"same"}')
        ack = ws.receive_json()
        assert ack["ok"] is True and ack["summary"]["session_id"] == sid
    one = client.get(f"/api/sessions/{sid}").json()
    assert one["feedback"]["effort"] == 4 and one["mode"] == "cup"


def test_ws_replay_streams_a_recorded_clip_without_client_frames(client):
    with client.websocket_connect("/session?mode=nhpt&sheet=nhpt_board&replay=synthetic_nhpt_01&clear=1") as ws:
        first = ws.receive_json()
        assert first["type"] == "replay_start" and first["clip"] == "synthetic_nhpt_01" and first["frames"] > 0
        types = []
        for _ in range(6):
            types.append(ws.receive_json()["type"])
    assert "frame" in types


def test_ws_replay_unknown_clip_errors(client):
    with client.websocket_connect("/session?mode=nhpt&replay=nope") as ws:
        assert ws.receive_json()["code"] == "bad_replay"


def test_ws_replay_coach_keeps_speaking_after_an_answer(client):
    """Replay frames carry clip time; commands must use the same clock or the coach's
    rate limiter silences every later instruct cue (audit 17 Sep, A2)."""
    with client.websocket_connect("/session?mode=cup&sheet=cup_targets&replay=synthetic_cup_01&clear=1") as ws:
        assert ws.receive_json()["type"] == "replay_start"
        prompt_seen = False
        after_answer: list[str] = []
        for _ in range(4000):
            e = ws.receive_json()
            if e["type"] == "replay_end":
                break
            if e["type"] == "coach" and not prompt_seen and e.get("ui", {}).get("prompt"):
                prompt_seen = True
                ws.send_text(json.dumps({"cmd": "answer", "prompt": "progression", "choice": "Yes, go faster"}))
                continue
            if prompt_seen and e["type"] == "coach" and e["action"] == "instruct":
                after_answer.append(e["cue_id"])
    assert prompt_seen, "the progression prompt never appeared on the synthetic cup clip"
    assert after_answer, "no instruct cue after the answer: replay commands used wall-clock time"


# ---- Sprint D, D-LAT: capture-time prefix, off-loop processing, drop-oldest, latency -------


def _prefixed(jpeg: bytes, t_capture_ms: float) -> bytes:
    import struct

    return struct.pack("<d", t_capture_ms) + jpeg


def _nhpt_bytes():
    from praxis_session.perception.board_spec import NHPT_BOARD
    from praxis_session.perception.synth import camera_frame

    frame, _ = camera_frame(NHPT_BOARD, pegs_mm=[(160.0, 148.5)])
    _, buf = cv2.imencode(".jpg", frame)
    return buf.tobytes()


def test_ws_heartbeat_prefixed_frame_echoes_t_capture(client):
    import time

    img = np.zeros((480, 640, 3), np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    t_capture = time.time() * 1000.0 - 40.0
    with client.websocket_connect("/session?mode=heartbeat") as ws:
        ws.send_bytes(_prefixed(buf.tobytes(), t_capture))
        msg = ws.receive_json()
    assert msg["type"] == "heartbeat" and msg["t_capture"] == t_capture
    assert msg["frame"]["bytes"] == len(buf.tobytes())  # the prefix is not part of the JPEG
    assert 40.0 <= msg["latency"]["capture_to_event_ms"] < 5000.0


def test_ws_nhpt_frame_carries_latency_block_and_dropped_count(client):
    import time

    from praxis_session.schema import validate_event

    with client.websocket_connect("/session?mode=nhpt&sheet=nhpt_board") as ws:
        ws.send_bytes(_prefixed(_nhpt_bytes(), time.time() * 1000.0))
        msg = ws.receive_json()
    assert msg["type"] == "frame" and msg["calibrated"]
    validate_event(msg)
    assert msg["dropped"] == 0 and isinstance(msg["t_capture"], float)
    assert msg["latency"]["proc_ms"] > 0 and msg["latency"]["capture_to_event_ms"] >= 0
    # the pipeline's own proc_ms stays; the latency block adds the wall-clock view
    assert msg["proc_ms"] > 0


def test_ws_burst_drops_older_queued_frames(client, monkeypatch):
    """Frames that pile up while one is being processed are dropped oldest-first; the
    processed frame reports how many it replaced."""
    import time

    import praxis_session.main as main

    real = main.SessionPipeline.process

    def slow(self, frame, t, i):
        time.sleep(0.15)
        return real(self, frame, t, i)

    monkeypatch.setattr(main.SessionPipeline, "process", slow)
    data = _nhpt_bytes()
    with client.websocket_connect("/session?mode=nhpt&sheet=nhpt_board") as ws:
        for _ in range(4):
            ws.send_bytes(_prefixed(data, time.time() * 1000.0))
        seen, accounted = [], 0
        while accounted < 4:
            m = ws.receive_json()
            if m["type"] == "frame":
                seen.append(m)
                accounted += 1 + m["dropped"]
    assert len(seen) < 4 and sum(m["dropped"] for m in seen) >= 1
    assert seen[-1]["frame_index"] == 3  # indices count received frames, so gaps show drops


def test_ws_coach_event_carries_event_to_cue_latency(client):
    from praxis_session.schema import validate_event

    coach_events = []
    with client.websocket_connect("/session?mode=cup&sheet=cup_targets&clear=1") as ws:
        for dot in [0, 0, 0, None, None, None, 1, 1, 1, 1]:
            ws.send_bytes(_cup_frame_bytes(dot) if dot is not None else _blank_bytes())
            msg = ws.receive_json()
            while msg["type"] != "frame":
                if msg["type"] == "coach":
                    coach_events.append(msg)
                msg = ws.receive_json()
        ws.send_text('{"cmd":"feedback","effort":3}')
        while True:
            m = ws.receive_json()
            if m["type"] == "coach":
                coach_events.append(m)
            if m["type"] == "command" and m.get("cmd") == "feedback":
                summary = m["summary"]
                break
    assert coach_events, "no coach cue in the cup scenario"
    for e in coach_events:
        validate_event(e)
        assert e["latency"]["event_to_cue_ms"] >= 0
    assert summary["latency"]["cues"] == len(coach_events)
    assert summary["latency"]["event_to_cue_p50"] is not None


def test_summary_carries_latency_percentiles_live_and_over_rest(client):
    import time

    with client.websocket_connect("/session?mode=nhpt&sheet=nhpt_board") as ws:
        for _ in range(3):
            ws.send_bytes(_prefixed(_nhpt_bytes(), time.time() * 1000.0 - 20.0))
            m = ws.receive_json()
            while m["type"] != "frame":
                m = ws.receive_json()
        ws.send_text('{"cmd":"feedback","pain_after":1,"effort":3,"compared":"same"}')
        m = ws.receive_json()
        while not (m["type"] == "command" and m.get("cmd") == "feedback"):
            m = ws.receive_json()
        sid, summary = m["session_id"], m["summary"]
    lat = summary["latency"]
    assert lat["frames"] == 3 and lat["dropped"] == 0
    assert lat["capture_to_event_p50"] >= 20.0 and lat["capture_to_event_p95"] >= lat["capture_to_event_p50"]
    assert lat["proc_p50"] > 0
    assert client.get(f"/api/session/{sid}/summary").json()["latency"] == lat
    assert client.get(f"/api/sessions/{sid}").json()["summary"]["latency"] == lat  # persisted


def test_ws_replay_frames_carry_proc_ms_only(client):
    from praxis_session.schema import validate_event

    with client.websocket_connect("/session?mode=nhpt&sheet=nhpt_board&replay=synthetic_nhpt_01&clear=1") as ws:
        assert ws.receive_json()["type"] == "replay_start"
        frames = []
        while len(frames) < 3:
            m = ws.receive_json()
            if m["type"] == "frame":
                frames.append(m)
    for f in frames:
        validate_event(f)
        assert f["latency"]["proc_ms"] > 0 and f["latency"]["capture_to_event_ms"] is None
        assert f["dropped"] == 0 and f["t_capture"] is None


def test_ws_calibrate_socket_creates_no_coach_session_or_trace_file(client, monkeypatch, tmp_path):
    import praxis_session.main as main
    import praxis_session.trace as trace

    monkeypatch.setattr(trace, "DEFAULT_DIR", tmp_path / "traces")
    from praxis_session.perception.board_spec import NHPT_BOARD
    from praxis_session.perception.synth import camera_frame

    frame, _ = camera_frame(NHPT_BOARD)
    _, buf = cv2.imencode(".jpg", frame)
    before = set(main.sessions)
    with client.websocket_connect("/session?mode=calibrate&sheet=nhpt_board") as ws:
        ws.send_bytes(buf.tobytes())
        types = [ws.receive_json()["type"] for _ in range(3)]
    assert types == ["calibration", "quality", "setup_checks"]
    assert set(main.sessions) == before
    assert not (tmp_path / "traces").exists()
