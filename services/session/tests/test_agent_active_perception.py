"""Active perception (10 Oct): the agent re-samples the target colour with OpenCV when the sheet
is calibrated but the cup or the pegs are not detected, and check_setup reports the target and
concrete pose facts the agent can act on. Synthetic frames only."""
import numpy as np
import pytest

from praxis_session.agent import tools as T
from praxis_session.events import make_event
from praxis_session.perception.board_spec import CUP_TARGETS, NHPT_BOARD
from praxis_session.perception.pose import PoseResult
from praxis_session.perception.synth import camera_frame
from praxis_session.pipeline import SETUP_BLOCK_S, SessionPipeline
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.session import RULE_LABEL_WITH_AGENT, CoachSession
from tests.test_pose import figure

GREEN = (60, 170, 40)  # BGR: a green cup, outside the default blue band
PASTEL = (170, 200, 150)  # BGR: pale green pegs, below the default peg saturation floor
DOTS = CUP_TARGETS.targets_mm


def cup_pipeline():
    return SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)


def frame(dot=0, bgr=GREEN, **kw):
    return camera_frame(CUP_TARGETS, cup_mm=None if dot is None else DOTS[dot], cup_bgr=bgr, **kw)[0]


def row(r, cid):
    return next(c for c in r["checks"] if c["id"] == cid)


# ---- check_setup: target row ---------------------------------------------------------------
def test_check_setup_reports_whether_the_cup_is_seen():
    p = cup_pipeline()
    p.process(frame(0, bgr=(200, 90, 30)), 0.0, 0)  # the default blue cup
    r = p.check_setup()
    assert r["all_pass"] and row(r, "target")["status"] == "pass" and r["measures"]["target_seen"] is True
    # 24 Oct: a green cup on the same dot is now seen too (it changed the sheet seen at the first
    # fix, cup.py), so the "not seen" path is a sheet with no cup on it
    p.process(frame(0), 0.1, 1)
    assert p.check_setup()["measures"]["target_seen"] is True
    p.process(frame(None), 0.2, 2)
    r = p.check_setup()
    assert "target" in r["failing"] and r["measures"]["target_seen"] is False
    assert r["measures"]["colour_source"] == "default" and row(r, "target")["hint"]
    # root cause first: the target row comes after markers, tilt, area and lighting
    assert [c["id"] for c in r["checks"]][-1] == "target"


# ---- resample: cup ---------------------------------------------------------------------
def test_resample_finds_a_green_cup_and_applies_only_after_detection_succeeds():
    p = cup_pipeline()
    p.process(frame(2), 0.0, 0)
    res = p.resample_target_colour("cup")
    assert res["ok"] and res["applied"] is True and res["sampled_at_dot"] == 2
    assert res["before"]["detected"] is False and res["after"]["detected"] is True
    assert abs(res["after"]["cup_mm"][0] - DOTS[2][0]) < 5 and abs(res["after"]["cup_mm"][1] - DOTS[2][1]) < 5
    assert 50 <= res["after"]["diameter_mm"] <= 70
    assert res["colour"]["source"] == "sampled"
    # the next frames detect the green cup with the sampled window
    p.process(frame(3), 0.2, 1)
    assert p.check_setup()["measures"]["target_seen"] is True
    ev = [e for e in p.process(frame(3), 0.3, 2) if e.type == "frame"][0]
    assert ev.payload["cup"]["cup_mm"] is not None


def test_resample_changes_nothing_when_no_dot_shows_a_cup():
    p = cup_pipeline()
    p.process(frame(None), 0.0, 0)
    res = p.resample_target_colour("cup")
    assert res["ok"] and res["applied"] is False and res["after"]["detected"] is False
    assert p._cup_sheet.colour_range is None
    assert len(res["tried"]) == len(DOTS)


def test_resample_does_nothing_when_the_cup_is_already_detected():
    p = cup_pipeline()
    p.process(frame(1, bgr=(200, 90, 30)), 0.0, 0)
    res = p.resample_target_colour("cup")
    assert res["applied"] is False and "already" in res["reason"] and p._cup_sheet.colour_range is None


def test_resample_needs_the_sheet_calibrated():
    p = cup_pipeline()
    f = camera_frame(CUP_TARGETS, cup_mm=DOTS[0], cup_bgr=GREEN, hide_marker=1)[0]
    f2 = camera_frame(CUP_TARGETS, cup_mm=DOTS[0], cup_bgr=GREEN, hide_marker=2)[0]
    mixed = f.copy()
    mixed[:, 320:] = f2[:, 320:]  # two markers covered
    p.process(mixed, 0.0, 0)
    res = p.resample_target_colour("cup")
    assert res["ok"] is False and "markers" in res["error"]


def test_resample_never_returns_pixels():
    p = cup_pipeline()
    p.process(frame(0), 0.0, 0)
    T.assert_no_pixels(p.resample_target_colour("cup"))


# ---- resample: pegs --------------------------------------------------------------------
def test_resample_finds_pale_pegs_on_the_board():
    p = SessionPipeline(mode="nhpt", sheet="nhpt_board", use_hand=False)
    pegs = [(70.0 + 15.0 * k, 212.0) for k in range(3)]  # in the dish below the grid, inside the canonical view
    p.process(camera_frame(NHPT_BOARD, pegs_mm=pegs, peg_bgr=PASTEL)[0], 0.0, 0)
    assert p.check_setup()["measures"]["target_seen"] is False
    res = p.resample_target_colour("pegs")
    assert res["ok"] and res["applied"] is True
    assert res["before"]["pegs_detected"] == 0 and res["after"]["pegs_detected"] >= 3
    assert p.check_setup()["measures"]["target_seen"] is True


# ---- the tool -------------------------------------------------------------------------
def tool_handle(tmp_path, reg):
    p = cup_pipeline()
    s = CoachSession(mode="cup", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="ap", rule_label=RULE_LABEL_WITH_AGENT)
    return reg.register(T.SessionHandle(session=s, pipeline=p, label="Claude agent · scripted (test)"))


def test_tool_applies_traces_and_tells_the_browser(tmp_path):
    reg = T.Registry()
    h = tool_handle(tmp_path, reg)
    h.pipeline.process(frame(0), 0.0, 0)
    e = make_event("reach_complete", t=1.0, to_dot=1, from_dot=0, verified=False, reason="cup_occluded", reach_ms=900, arc=1, phase="slow")
    h.session.on_events([e], snapshot={}, t=1.0)
    h.begin_run("pause:failed_reps")
    r = T.invoke("resample_target_colour", {"session_id": "ap", "target": "cup", "evidence": [e.id]}, "direct", reg)
    assert r["applied"] is True
    assert any(x["kind"] == "resample" and x["applied"] for x in h.session.trace.tail(20))
    cmd = [x for x in h.drain(2.0) if x.type == "command"]
    assert cmd and cmd[0].payload["cmd"] == "sample_colour" and cmd[0].payload["source"] == "agent"
    assert T.AUTONOMY["resample_target_colour"][0] == "forbidden_after_stop"
    assert "resample_target_colour" in T.SERVERS["perception"]


def test_tool_rejects_a_target_that_is_not_this_task(tmp_path):
    reg = T.Registry()
    h = tool_handle(tmp_path, reg)
    h.pipeline.process(frame(0), 0.0, 0)
    e = make_event("arc_complete", t=1.0, arc=1, reaches=4, unverified=0)
    h.session.on_events([e], snapshot={}, t=1.0)
    h.begin_run("arc_complete")
    with pytest.raises(T.ToolRejected):
        T.invoke("resample_target_colour", {"session_id": "ap", "target": "pegs", "evidence": [e.id]}, "direct", reg)
    with pytest.raises(T.ToolRejected):
        T.invoke("resample_target_colour", {"session_id": "ap", "target": "ball", "evidence": [e.id]}, "direct", reg)


# ---- arm: pose facts and the setup pause ------------------------------------------------
def pose(frontal=True, lean=0.0, hips_vis=1.0, elbows_vis=1.0):
    vis = np.ones(33, np.float32)
    vis[[23, 24]] = hips_vis
    vis[[13, 14]] = elbows_vis
    return PoseResult(landmarks_px=figure(5.0, lean_deg=lean, frontal=frontal), visibility=vis, world=np.zeros((33, 3), np.float32), conf=0.9)


def arm_pipeline():
    return SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="abduction")


def test_arm_check_setup_gives_concrete_pose_facts():
    p = arm_pipeline()
    p.process_pose(pose(frontal=False), 0.0, 0)
    r = p.check_setup()
    assert r["ok"] is True  # landmarks alone are enough for the arm (no image: lighting not judged)
    m = r["measures"]
    assert m["facing"] == "side" and m["needed_view"] == "front" and m["gate"] == "turn_front"
    assert m["shoulders_visibility"] == 1.0 and isinstance(m["trunk_lean_deg"], float)
    assert "view" in r["failing"] and "face the camera" in r["first_hint"].lower()
    p.process_pose(pose(frontal=True), 0.1, 1)
    r = p.check_setup()
    assert r["all_pass"] and r["measures"]["facing"] == "front"


def test_arm_check_setup_passes_with_the_hips_below_the_frame():
    """25 Oct: Arm out to the side measures with the hips out of a laptop's frame, so the agent's
    check and the pause hint must not ask the patient to bring the hips into view."""
    from praxis_session.pipeline import GATE_HINTS

    p = arm_pipeline()
    p.process_pose(pose(hips_vis=0.1), 0.0, 0)
    r = p.check_setup()
    assert r["all_pass"] and r["first_hint"] is None
    assert not any("hip" in c["label"].lower() for c in r["checks"])
    p.process_pose(pose(hips_vis=0.1, elbows_vis=0.1), 0.1, 1)
    r = p.check_setup()
    assert r["failing"] == ["arm"] and "elbow" in r["first_hint"].lower() and "hip" not in r["first_hint"].lower()
    assert "hip" not in GATE_HINTS["hips_out_of_view"].lower()


def test_a_brief_hips_out_of_view_dip_does_not_pause_but_a_held_one_does(tmp_path):
    """21 Oct team test: all 14 `setup_blocked` on Arm out to the side were `hips_out_of_view`
    (none `turn_front`), most mid-set on a laptop with reps verified right after the resume. The
    hips gate now needs HIPS_BLOCK_S before it pauses; the scoring freeze itself is unchanged,
    and the event carries the visibility numbers so the next test shows how close it was.
    25 Oct: Arm out to the side no longer needs the hips at all (a laptop cuts them off); the
    same gate, still named `hips_out_of_view`, now fires on the shoulder or elbow."""
    from praxis_session.pipeline import HIPS_BLOCK_S

    assert HIPS_BLOCK_S > SETUP_BLOCK_S
    p = arm_pipeline()
    s = CoachSession(mode="arm", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="arm3", exercise="abduction")
    blocked, paused = [], []
    i = 0
    for _ in range(int((HIPS_BLOCK_S + 1.0) / 0.1)):  # hips below the frame: no gate at all
        evs = p.process_pose(pose(hips_vis=0.3), 0.1 * i, i)
        blocked += [e for e in evs if e.type == "setup_blocked"]
        i += 1
    assert blocked == [] and p.last_pose["gate"] is None
    for _ in range(int((HIPS_BLOCK_S - 1.0) / 0.1)):  # held 1 s short of the pause
        evs = p.process_pose(pose(elbows_vis=0.3), 0.1 * i, i)
        blocked += [e for e in evs if e.type == "setup_blocked"]
        paused += [e for e in s.on_events(evs, snapshot=p.snapshot(), t=0.1 * i) if e.type == "pause"]
        i += 1
    assert blocked == [] and paused == [] and p.last_pose["gate"] == "hips_out_of_view"
    p.process_pose(pose(), 0.1 * i, i)  # the hips come back for one frame: a new episode
    i += 1
    for _ in range(int(HIPS_BLOCK_S / 0.1) + 5):
        evs = p.process_pose(pose(elbows_vis=0.3), 0.1 * i, i)
        blocked += [e for e in evs if e.type == "setup_blocked"]
        paused += [e for e in s.on_events(evs, snapshot=p.snapshot(), t=0.1 * i) if e.type == "pause"]
        i += 1
    assert len(blocked) == 1 and len(paused) == 1 and s.pause_rule == "setup"
    b = blocked[0].payload
    assert b["reason"] == "hips_out_of_view" and b["held_s"] >= HIPS_BLOCK_S
    assert b["visibility"] == 0.3 and b["hip_visibility"] == 1.0 and b["shoulders_visibility"] == 1.0
    # the stored event (a trace line) keeps the numbers, not only the reason
    row = next(r for r in s.trace.tail(500) if r["kind"] == "event" and r.get("type") == "setup_blocked")
    assert row["reason"] == "hips_out_of_view" and row["visibility"] == 0.3 and row["held_s"] >= HIPS_BLOCK_S


def test_arm_gate_held_for_3_s_emits_setup_blocked_once_and_pauses_the_session(tmp_path):
    p = arm_pipeline()
    s = CoachSession(mode="arm", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="arm1", exercise="abduction")
    blocked, paused = [], []
    n = int(SETUP_BLOCK_S / 0.1) + 10
    for i in range(n):
        evs = p.process_pose(pose(frontal=False), 0.1 * i, i)
        blocked += [e for e in evs if e.type == "setup_blocked"]
        paused += [e for e in s.on_events(evs, snapshot=p.snapshot(), t=0.1 * i) if e.type == "pause"]
    assert len(blocked) == 1 and blocked[0].payload["reason"] == "turn_front"
    assert "face the camera" in blocked[0].payload["hint"].lower()
    assert len(paused) == 1 and s.paused and s.pause_rule == "setup"
    assert "face the camera" in paused[0].payload["text"].lower()
    assert not s.stop_rules.flags  # a setup pause is not a therapist flag


def test_a_setup_pause_is_not_repeated_while_the_session_is_already_paused_for_it(tmp_path):
    """Real video, 12 Oct (agent_video_eval, a subject who never turns): the agent's
    `recalibrate` resets the pose gate, the gate stays closed, `setup_blocked` fires again 3 s
    later and a second `pause:setup` (and a second agent checkpoint) followed, every 3 s until the
    session's run budget ran out. The same pause while already paused for it is now dropped:
    no new pause event, no new checkpoint, one trace row."""
    p = arm_pipeline()
    s = CoachSession(mode="arm", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="arm2", exercise="abduction")
    checkpoints: list[str] = []
    s._checkpoint = lambda trigger, ev, t: checkpoints.append(trigger)  # type: ignore[method-assign]
    s.agent = object()  # the agent is on (only its checkpoint hook is used here)
    paused = []
    n = int(SETUP_BLOCK_S / 0.1) + 10
    i = 0
    for _ in range(3):  # three gate episodes, the pose gate reset (recalibrate) between them
        for _ in range(n):
            evs = p.process_pose(pose(frontal=False), 0.1 * i, i)
            paused += [e for e in s.on_events(evs, snapshot=p.snapshot(), t=0.1 * i) if e.type == "pause"]
            i += 1
        p.command({"cmd": "recalibrate"})
    assert len(paused) == 1 and s.paused and s.pause_rule == "setup"
    assert checkpoints == ["pause:setup"]
    assert len([r for r in s.trace.tail(500) if r["kind"] == "pause_repeat"]) == 2
    # a resume, then the same problem again: a new pause (it is a new episode)
    s.resume(0.1 * i)
    for _ in range(n):
        evs = p.process_pose(pose(frontal=False), 0.1 * i, i)
        paused += [e for e in s.on_events(evs, snapshot=p.snapshot(), t=0.1 * i) if e.type == "pause"]
        i += 1
    assert len(paused) == 2 and checkpoints == ["pause:setup", "pause:setup"]


def test_recalibrate_counts_landmark_frames_too():
    p = arm_pipeline()
    p.process_pose(pose(), 0.0, 0)
    assert p.command({"cmd": "recalibrate"})["reset"] == "pose_gate"
    p.process_pose(pose(), 0.1, 1)
    p.process_pose(pose(), 0.2, 2)
    assert p.frames_since_recalibrate == 2
