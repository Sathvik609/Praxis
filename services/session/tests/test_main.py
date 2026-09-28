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
        ws.send_text('{"cmd":"pain","pain":7}')  # stop level = rest tier (23 Sep)
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


def test_ws_arm_takes_an_exercise_and_tier(client):
    """E-SVC-3 contract: the frame's `arm` block names the exercise, the view it needs and the
    avatar's phase."""
    import cv2 as _cv2
    import numpy as _np

    from praxis_session.schema import validate_event

    img = _np.zeros((480, 640, 3), _np.uint8)
    _, buf = _cv2.imencode(".jpg", img)
    with client.websocket_connect("/session?mode=arm&exercise=abduction&tier=gentle&side=right") as ws:
        ws.send_bytes(buf.tobytes())
        msg = ws.receive_json()
    validate_event(msg)
    arm = msg["arm"]
    assert arm["exercise"] == "abduction" and arm["view_required"] == "front"
    assert arm["tier"] == "gentle" and arm["target_deg"] == 60.0 and arm["hold_s"] == 2.0
    assert arm["phase"] == "start" and arm["rep_progress"] == 0.0
    assert arm["reps_per_set"] == 6 and arm["dose"]


def test_ws_arm_without_an_exercise_is_still_arm_to_the_front(client):
    import cv2 as _cv2
    import numpy as _np

    img = _np.zeros((480, 640, 3), _np.uint8)
    _, buf = _cv2.imencode(".jpg", img)
    with client.websocket_connect("/session?mode=arm") as ws:
        ws.send_bytes(buf.tobytes())
        arm = ws.receive_json()["arm"]
    assert arm["exercise"] == "flexion" and arm["view_required"] == "side"
    assert (arm["target_deg"], arm["hold_s"], arm["sets"], arm["reps_per_set"]) == (90.0, 3.0, 2, 8)


def test_ws_arm_session_is_saved_with_its_exercise(client):
    import cv2 as _cv2
    import numpy as _np

    img = _np.zeros((480, 640, 3), _np.uint8)
    _, buf = _cv2.imencode(".jpg", img)
    with client.websocket_connect("/session?mode=arm&exercise=abduction&tier=gentle") as ws:
        ws.send_bytes(buf.tobytes())
        ws.receive_json()
        ws.send_text('{"cmd":"feedback","pain_after":2,"effort":3}')
        m = ws.receive_json()
        while not (m["type"] == "command" and m.get("cmd") == "feedback"):
            m = ws.receive_json()
        sid = m["session_id"]
        assert m["summary"]["exercise"] == "abduction"
    row = client.get(f"/api/sessions/{sid}").json()
    assert row["exercise"] == "abduction"
    assert row["title"] == "Arm out to the side"


def test_ws_arm_refuses_a_demo_only_exercise(client):
    """Rotate out / Rotate in are demo only (23 Sep): the socket never scores them."""
    for ex in ("external_rotation", "internal_rotation"):
        with client.websocket_connect(f"/session?mode=arm&exercise={ex}") as ws:
            msg = ws.receive_json()
        assert msg["type"] == "error" and msg["code"] == "demo_only" and msg["exercise"] == ex


def test_ws_arm_refuses_a_sheet_activity_and_an_unknown_tier(client):
    with client.websocket_connect("/session?mode=arm&exercise=cup") as ws:
        msg = ws.receive_json()
    assert msg["type"] == "error" and msg["code"] == "bad_exercise"
    with client.websocket_connect("/session?mode=arm&exercise=flexion&tier=turbo") as ws:
        msg = ws.receive_json()
    assert msg["type"] == "error" and msg["code"] == "bad_tier"
    with client.websocket_connect("/session?mode=arm&exercise=flexion&tier=rest") as ws:
        msg = ws.receive_json()
    assert msg["type"] == "error" and msg["code"] == "rest_day"


# ---- pain tier from the check-in, enforced by the service (23 Sep) -------------------------
def _checkin(ws, pain: int) -> list[dict]:
    """Everything the check-in produced, ending with its ack. A trailing `rpe` command marks
    the end (its ack is the first message that is not the check-in's)."""
    ws.send_text(json.dumps({"cmd": "checkin", "pain": pain, "energy": "comfortable", "minutes": 14, "new_symptoms": False}))
    ws.send_text(json.dumps({"cmd": "rpe", "rpe": 2}))
    out = [ws.receive_json()]
    while not (out[-1]["type"] == "command" and out[-1].get("cmd") == "rpe"):
        out.append(ws.receive_json())
    out.pop()
    ack = next(m for m in out if m["type"] == "command" and m.get("cmd") == "checkin")
    return [m for m in out if m is not ack] + [ack]


def _arm_frame(ws) -> dict:
    img = np.zeros((480, 640, 3), np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    ws.send_bytes(buf.tobytes())
    m = ws.receive_json()
    while m["type"] != "frame":
        m = ws.receive_json()
    return m["arm"]


def test_checkin_pain_4_to_6_makes_the_session_gentle_even_if_the_client_asked_for_full(client):
    with client.websocket_connect("/session?mode=arm&exercise=abduction&tier=full") as ws:
        ack = _checkin(ws, 5)[-1]
        assert ack["ok"] is True and ack["tier"] == "gentle" and ack["tier_applied"] is True
        arm = _arm_frame(ws)
    assert (arm["tier"], arm["target_deg"], arm["hold_s"], arm["reps_per_set"]) == ("gentle", 60.0, 2.0, 6)


def test_checkin_low_pain_never_loosens_a_gentle_session(client):
    with client.websocket_connect("/session?mode=arm&exercise=abduction&tier=gentle") as ws:
        ack = _checkin(ws, 1)[-1]
        assert ack["tier"] == "gentle"
        assert _arm_frame(ws)["target_deg"] == 60.0


def test_checkin_pain_7_is_a_rest_day_stop_and_therapist_flag(client):
    with client.websocket_connect("/session?mode=arm&exercise=flexion") as ws:
        msgs = _checkin(ws, 7)
    types = [m["type"] for m in msgs]
    assert "stop" in types and "therapist_flag" in types
    stop = next(m for m in msgs if m["type"] == "stop")
    assert stop["rule"] == "pain" and stop["pain"] == 7
    assert msgs[-1]["tier"] == "rest"


def test_checkin_pain_6_does_not_stop_the_session(client):
    with client.websocket_connect("/session?mode=arm&exercise=flexion") as ws:
        msgs = _checkin(ws, 6)
    assert "stop" not in [m["type"] for m in msgs] and msgs[-1]["tier"] == "gentle"


# ---- demo-only exercises are self-ticked and traced as such --------------------------------
def test_self_report_logs_a_demo_set_as_self_ticked_never_verified(client, monkeypatch, tmp_path):
    import praxis_session.main as main
    import praxis_session.trace as trace
    from praxis_session.schema import validate_event

    monkeypatch.setattr(trace, "DEFAULT_DIR", tmp_path / "traces")
    monkeypatch.setattr(main, "_self_ticks", {})
    r = client.post("/api/self_report", json={"exercise": "external_rotation"}).json()
    assert r["ok"] is True and r["verified"] is False and r["source"] == "self_ticked"
    assert r["label"] == "Demo only · self-ticked, not camera-verified"
    assert r["sets_today"] == 1
    assert client.post("/api/self_report", json={"exercise": "external_rotation"}).json()["sets_today"] == 2
    rows = [json.loads(line) for f in (tmp_path / "traces").glob("*.jsonl") for line in f.read_text().splitlines()]
    ticks = [row for row in rows if row["kind"] == "self_report"]
    assert len(ticks) == 2 and all(t["verified"] is False and t["mode"] == "demo" for t in ticks)
    assert all(t["label"] == "Demo only · self-ticked, not camera-verified" for t in ticks)
    ev = client.get("/events?n=5").json()["events"][-1]
    validate_event(ev)
    assert ev["type"] == "self_report" and ev["verified"] is False


def test_self_report_refuses_a_camera_coached_exercise(client):
    """A coached exercise is only ever counted from OpenCV events, never from a tap."""
    for ex in ("flexion", "cup", "nhpt", "scaption"):
        r = client.post("/api/self_report", json={"exercise": ex}).json()
        assert r["ok"] is False and r["error"] in ("not_demo", "unknown_exercise")


# ---- 24 Sep review: a coach regress reaches the FSM -----------------------------------------
def test_coach_set_hold_is_applied_to_the_pipeline_and_traced(tmp_path):
    import praxis_session.main as main
    from praxis_session.pipeline import SessionPipeline
    from praxis_session.prescription import SEED_PRESCRIPTION
    from praxis_session.schema import validate_event
    from praxis_session.session import CoachSession

    p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="abduction")
    c = CoachSession(mode="arm", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, exercise="abduction")
    c.commands.append({"cmd": "set_hold", "hold_s": 1.0, "rx": "abduction", "evidence": [7]})
    evs = main._apply_coach_commands(p, c)
    assert len(evs) == 1
    d = evs[0].to_dict()
    validate_event(d)
    assert d["type"] == "command" and d["cmd"] == "set_hold" and d["source"] == "coach"
    assert d["ok"] is True and d["hold_s"] == 2.0 and d["clamped"] is True  # clamped in code
    assert p.snapshot()["arm"]["hold_s"] == 2.0
    row = [r for r in c.trace.tail(5) if r["kind"] == "apply"][0]
    assert row["cmd"] == "set_hold" and row["hold_s"] == 2.0 and row["evidence"] == [7]
    assert main._apply_coach_commands(p, c) == []
