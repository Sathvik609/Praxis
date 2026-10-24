import numpy as np
import pytest

from praxis_session.perception.board_spec import NHPT_BOARD
from praxis_session.perception.synth import camera_frame
from praxis_session.pipeline import SessionPipeline
from praxis_session.schema import validate_event


def _types(events):
    return [e.type for e in events]


def test_calibrate_mode_emits_three_validated_events():
    p = SessionPipeline(mode="calibrate", sheet="nhpt_board")
    frame, _ = camera_frame(NHPT_BOARD)
    evs = p.process(frame, t=0.0, frame_index=0)
    assert _types(evs) == ["calibration", "quality", "setup_checks"]
    for e in evs:
        validate_event(e.to_dict())
    cal = evs[0].to_dict()
    assert cal["calibrated"] and len(cal["targets_px"]) == 9
    checks = evs[2].to_dict()
    assert checks["checks"][3]["status"] == "pass"
    assert checks["all_required_pass"] is True  # 'person' is not required


def test_setup_rows_say_which_checks_gate_the_start():
    """e2e 11 Oct: the camera-setup screen walks the rows in order, so it has to know that the
    frame-difference 'person' row is advice, not a gate (it never passes for a still patient)."""
    frame, _ = camera_frame(NHPT_BOARD)
    rows = SessionPipeline(mode="calibrate", sheet="nhpt_board").process(frame, 0.0, 0)[2].to_dict()["checks"]
    assert {r["id"]: r["required"] for r in rows} == {
        "camera": True,
        "person": False,
        "task_area": True,
        "markers": True,
        "angle": True,
        "lighting": True,
    }
    arm = SessionPipeline(mode="calibrate", sheet="nhpt_board", for_mode="arm")
    rows = arm.process(frame, 0.0, 0)[2].to_dict()["checks"]
    assert {r["id"] for r in rows if r["required"]} == {"camera", "lighting"}


def test_perception_lost_and_regained():
    """Every marker gone (the sheet pushed out of view): the homography is held 1.5 s, then
    LOSS_FRAMES (20) uncalibrated frames are needed before `perception_lost` (D-CAL-1). At 0.5 s
    steps: 15 bad frames (3 held + 12 lost) stay quiet, 25 (3 held + 22 lost) pause. Two markers
    covered but unmoved never pause (24 Oct, anchored hold)."""
    from tests.test_calibration import hide_markers

    good, H = camera_frame(NHPT_BOARD)
    two = hide_markers(good, H, NHPT_BOARD, [1, 2])
    p2 = SessionPipeline(mode="calibrate", sheet="nhpt_board")
    p2.process(good, 0.0, 0)
    assert "perception_lost" not in [t for i in range(1, 40) for t in _types(p2.process(two, i * 0.5, i))]
    bad = hide_markers(good, H, NHPT_BOARD, [0, 1, 2, 3])
    p = SessionPipeline(mode="calibrate", sheet="nhpt_board")
    p.process(good, 0.0, 0)
    seen = []
    for i in range(1, 16):
        seen += _types(p.process(bad, i * 0.5, i))
    assert "perception_lost" not in seen
    for i in range(16, 26):
        seen += _types(p.process(bad, i * 0.5, i))
    assert seen.count("perception_lost") == 1
    assert "perception_regained" in _types(p.process(good, 14.0, 26))


def test_one_covered_marker_never_loses_tracking_after_a_fresh_calibration():
    from tests.test_calibration import hide_markers

    good, H = camera_frame(NHPT_BOARD)
    partial = hide_markers(good, H, NHPT_BOARD, [2])
    p = SessionPipeline(mode="calibrate", sheet="nhpt_board")
    p.process(good, 0.0, 0)
    seen = []
    for i in range(1, 60):
        evs = p.process(partial, i * 0.5, i)
        seen += _types(evs)
    assert "perception_lost" not in seen
    cal = evs[0].to_dict()
    assert cal["calibrated"] and cal["source"] == "partial" and cal["missing"] == [2]
    # setup still wants all four markers before Continue (CLAUDE.md: refuse to start)
    checks = evs[2].to_dict()
    markers = next(c for c in checks["checks"] if c["id"] == "markers")
    assert markers["status"] == "check" and checks["all_required_pass"] is False


def _check(evs, id_):
    return next(c for c in evs[2].to_dict()["checks"] if c["id"] == id_)


def test_angle_check_passes_for_an_overhead_camera_and_gates_a_steep_one():
    """D-CAL-3: the synthetic default view (tilt 15°, yaw 5°) passes; 40° must be fixed."""
    p = SessionPipeline(mode="calibrate", sheet="nhpt_board")
    evs = p.process(camera_frame(NHPT_BOARD)[0], 0.0, 0)
    row = _check(evs, "angle")
    assert row["status"] == "pass" and row["hint"] is None
    assert row["label"] == "Camera looks down at the sheet"
    assert evs[2].to_dict()["all_required_pass"] is True
    assert evs[0].to_dict()["tilt_deg"] is not None
    for e in evs:
        validate_event(e.to_dict())

    steep = SessionPipeline(mode="calibrate", sheet="cup_targets")
    from praxis_session.perception.board_spec import CUP_TARGETS

    evs = steep.process(camera_frame(CUP_TARGETS, tilt_deg=58, yaw_deg=5)[0], 0.0, 0)
    row = _check(evs, "angle")
    assert row["status"] == "check" and "laptop screen forward" in row["hint"]
    assert _check(evs, "markers")["status"] == "pass"
    assert evs[2].to_dict()["all_required_pass"] is False


def test_angle_check_is_pending_without_a_sheet_fix_and_absent_for_the_arm():
    p = SessionPipeline(mode="calibrate", sheet="nhpt_board")
    evs = p.process(np.zeros((480, 640, 3), np.uint8), 0.0, 0)
    assert _check(evs, "angle")["status"] == "pending"
    arm = SessionPipeline(mode="calibrate", sheet="nhpt_board", for_mode="arm")
    evs = arm.process(camera_frame(NHPT_BOARD)[0], 0.0, 0)
    assert "angle" not in [c["id"] for c in evs[2].to_dict()["checks"]]


def test_no_loss_event_before_first_calibration():
    p = SessionPipeline(mode="calibrate", sheet="nhpt_board")
    bad, _ = camera_frame(NHPT_BOARD, hide_marker=1)
    seen = []
    for i in range(10):
        seen += _types(p.process(bad, i * 0.1, i))
    assert "perception_lost" not in seen
    assert p.process(bad, 2.0, 11)[0].to_dict()["calibrated"] is False


def test_bad_sheet_and_mode_raise():
    with pytest.raises(ValueError):
        SessionPipeline(mode="calibrate", sheet="nope")
    with pytest.raises(ValueError):
        SessionPipeline(mode="nope", sheet="nhpt_board")  # type: ignore[arg-type]


def _nhpt_frames():
    """Synthetic frames for one full NHPT run: peg at source, lifted, seated per hole."""
    from praxis_session.perception.board_spec import NHPT_BOARD as B

    src = (160.0, 148.5)
    holes = B.targets_mm
    order = [4, 0, 8, 2, 6, 1, 7, 3, 5]
    seated: list[int] = []
    seq = []
    seq.append([holes[k] for k in seated] + [src])
    for k in order:
        seq.append([holes[j] for j in seated])  # lifted
        seq.append([holes[j] for j in seated] + [(holes[k][0] + 5, holes[k][1])])  # over hole
        seated.append(k)
        seq.append([holes[j] for j in seated])  # seated
        seq.append([holes[j] for j in seated] + [src])  # next peg at source
    return [camera_frame(NHPT_BOARD, pegs_mm=p)[0] for p in seq]


def test_nhpt_mode_runs_a_full_test_from_synthetic_frames():
    from praxis_session.schema import validate_event

    p = SessionPipeline(mode="nhpt", sheet="nhpt_board", debounce_frames=1, clear_frames=1)
    evs = []
    for i, f in enumerate(_nhpt_frames()):
        evs += p.process(f, t=i * 0.5, frame_index=i)
    for e in evs:
        validate_event(e.to_dict())
    types = _types(evs)
    assert types[0] == "frame"
    assert types.count("nhpt_complete") == 1 and types.count("rep_complete") == 9
    fr = evs[0].to_dict()
    assert fr["calibrated"] and len(fr["overlay"]["holes_px"]) == 9
    assert fr["board"]["occupancy"]["hole_4"] == "empty"
    snap = p.snapshot()
    assert snap["mode"] == "nhpt" and snap["reps"] == 9 and snap["nhpt"]["completed"]
    assert snap["nhpt"]["total_s"] > 0


def test_nhpt_sheet_gone_during_the_hold_never_counts_a_peg_twice():
    """e2e 11 Oct (fake camera, sheet out of view ~4 s after peg 4): during the 1.5 s hold the
    last homography warped an empty table, every hole read empty, and on regain an already
    seated hole was counted as a new peg, so the test 'finished' one peg early. With no marker
    in view the held fix must not feed the board to the peg FSM."""
    p = SessionPipeline(mode="nhpt", sheet="nhpt_board", debounce_frames=1, clear_frames=1)
    frames = _nhpt_frames()
    table = np.full_like(frames[0], 90)
    seq = frames[:9] + [table, table] + frames[9:]  # the sheet leaves after peg 2, for 1 s
    evs = []
    for i, f in enumerate(seq):
        evs += p.process(f, t=i * 0.5, frame_index=i)
    seated = [e.payload["hole"] for e in evs if e.type == "rep_complete"]
    assert sorted(seated) == list(range(9)), seated
    done = [e for e in evs if e.type == "nhpt_complete"]
    assert len(done) == 1 and sorted(pg["hole"] for pg in done[0].payload["pegs"]) == list(range(9))


def test_nhpt_mode_freezes_fsm_when_uncalibrated():
    p = SessionPipeline(mode="nhpt", sheet="nhpt_board", debounce_frames=1, clear_frames=1)
    bad, _ = camera_frame(NHPT_BOARD, hide_marker=0)
    evs = p.process(bad, 0.0, 0)
    d = evs[0].to_dict()
    assert d["type"] == "frame" and d["calibrated"] is False and d["nhpt"]["state"] == "at_source"
    assert d["overlay"]["holes_px"] == []


def test_nhpt_frame_carries_hand_block_and_proc_ms_without_models():
    p = SessionPipeline(mode="nhpt", sheet="nhpt_board", use_hand=False)
    frame, _ = camera_frame(NHPT_BOARD)
    d = p.process(frame, 0.0, 0)[0].to_dict()
    assert d["hand"] == {"present": False}
    assert d["proc_ms"] >= 0.0
    assert d["models"] == {"hand": False}


def test_nhpt_frame_with_hand_tracker_on_synthetic_board():
    import pytest

    from praxis_session.perception.hand import HAND_MODEL, MODELS_DIR

    if not (MODELS_DIR / HAND_MODEL).exists():
        pytest.skip("models not downloaded")
    p = SessionPipeline(mode="nhpt", sheet="nhpt_board", use_hand=True)
    frame, _ = camera_frame(NHPT_BOARD)
    d = p.process(frame, 0.0, 0)[0].to_dict()
    assert d["models"]["hand"] is True
    assert d["hand"]["present"] is False  # no real hand in a synthetic render
    assert d["proc_ms"] > 0.0


def _cup_frames(dst_seq):
    """Frames: cup resting at dot 0, then for each dst: hidden (lifted), resting at dst."""
    from praxis_session.perception.board_spec import CUP_TARGETS as C

    seq = [C.targets_mm[0]] * 3
    for k in dst_seq:
        seq += [None] * 3 + [C.targets_mm[k]] * 5
    return [camera_frame(C, cup_mm=p)[0] for p in seq]


def test_cup_mode_emits_reach_events_and_frame_block():
    from praxis_session.schema import validate_event

    p = SessionPipeline(mode="cup", sheet="cup_targets", clear_frames=2, use_hand=False)
    evs = []
    for i, f in enumerate(_cup_frames([1, 2])):
        evs += p.process(f, t=i * 0.1, frame_index=i)
    for e in evs:
        validate_event(e.to_dict())
    d = evs[0].to_dict()
    assert d["type"] == "frame" and d["cup"]["mode"] == "cup" and len(d["overlay"]["dots_px"]) == 5
    assert d["overlay"]["cup_px"] is not None
    reaches = [e for e in evs if e.type == "reach_complete"]
    assert [r.payload["to_dot"] for r in reaches] == [1, 2]
    assert all(r.payload["verified"] for r in reaches)
    assert p.snapshot()["cup"]["reaches_total"] == 2


def test_cup_sheet_gone_during_the_hold_never_counts_a_reach():
    """The same e2e finding for Waiter - cup: an empty table warped through the held fix reads
    as 'cup lifted', and the cup still on its dot on regain would be a phantom reach."""
    p = SessionPipeline(mode="cup", sheet="cup_targets", clear_frames=2, use_hand=False)
    frames = _cup_frames([1])
    table = np.full_like(frames[0], 90)
    seq = frames + [table] * 3 + [frames[-1]] * 6  # sheet gone 0.3 s, back with the cup on dot 2
    evs = []
    for i, f in enumerate(seq):
        evs += p.process(f, t=i * 0.1, frame_index=i)
    assert [e.payload["to_dot"] for e in evs if e.type == "reach_complete"] == [1]


def test_cup_command_switches_phase():
    p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    assert p.command({"cmd": "set_phase", "phase": "fast"}) == {"ok": True, "phase": "fast"}
    assert p.snapshot()["cup"]["phase"] == "fast"
    assert p.command({"cmd": "nope"})["ok"] is False


def test_arm_mode_frame_block_without_models():
    from praxis_session.schema import validate_event

    p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, side="left")
    frame = np.zeros((480, 640, 3), np.uint8)
    evs = p.process(frame, 0.0, 0)
    d = evs[0].to_dict()
    validate_event(d)
    assert d["type"] == "frame" and d["arm"]["mode"] == "arm" and d["pose"] == {"present": False}
    assert d["models"] == {"hand": False, "pose": False}
    assert d["overlay"]["skeleton_px"] == []
    assert p.snapshot()["arm"]["target_deg"] == 90


def test_arm_mode_from_landmarks_runs_fsm():
    from praxis_session.perception.pose import PoseResult
    from tests.test_pose import figure

    p = SessionPipeline(
        mode="arm",
        sheet="none",
        use_hand=False,
        use_pose=False,
        side="left",
        hold_s=1.0,
        sets=1,
        reps=1,
    )
    evs = []
    profile = (
        [5 + 85 * i / 15 for i in range(16)]
        + [90] * 20
        + [90 - 85 * i / 15 for i in range(16)]
        + [5] * 8
    )
    for i, ang in enumerate(profile):
        res = PoseResult(
            landmarks_px=figure(ang),
            visibility=np.ones(33, np.float32),
            world=np.zeros((33, 3), np.float32),
            conf=0.9,
        )
        evs += p.process_pose(res, t=i / 15.0, frame_index=i)
    types = [e.type for e in evs]
    assert types.count("rep_complete") == 1 and "arm_complete" in types
    fr = [e for e in evs if e.type == "frame"][20].to_dict()
    assert len(fr["overlay"]["skeleton_px"]) == 8 and fr["overlay"]["ghost_target_px"] is not None
    assert fr["pose"]["present"] and abs(fr["arm"]["angle_now"] - 90) < 3


def test_set_hold_changes_the_fsm_hold_clamped_to_the_allowed_adaptation():
    """24 Sep review: the coach's regress named a hold but nothing applied it. `set_hold` is
    the pipeline command that does, clamped in code to `allowed_adaptations[rx].hold_s`."""
    p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="abduction")
    r = p.command({"cmd": "set_hold", "hold_s": 2.0})
    assert r == {"ok": True, "exercise": "abduction", "rx": "abduction", "hold_s": 2.0, "requested_hold_s": 2.0, "clamped": False}
    assert p.snapshot()["arm"]["hold_s"] == 2.0
    assert p.command({"cmd": "set_hold", "hold_s": 0.5})["hold_s"] == 2.0  # floor of [2, 3]
    r = p.command({"cmd": "set_hold", "hold_s": 9})
    assert r["hold_s"] == 3.0 and r["clamped"] is True  # never above the prescription
    assert p.command({"cmd": "set_hold"})["ok"] is False


def test_set_hold_is_refused_for_the_pendulum_and_the_sheet_tasks():
    pend = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="pendulum")
    assert pend.command({"cmd": "set_hold", "hold_s": 2.0})["ok"] is False
    cup = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    assert cup.command({"cmd": "set_hold", "hold_s": 2.0})["ok"] is False


def test_arm_lean_thresholds_come_from_the_prescription():
    from praxis_session.prescription import SEED_PRESCRIPTION

    rx = SEED_PRESCRIPTION.model_copy(deep=True)
    rx.stop_rules.lean_deg, rx.stop_rules.lean_events = 25.0, 2
    p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, prescription=rx)
    assert (p._arm.lean_limit_deg, p._arm.lean_events_to_flag) == (25.0, 2)
    d = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False)
    assert (d._arm.lean_limit_deg, d._arm.lean_events_to_flag) == (12.0, 3)


def test_arm_pose_loss_after_15_frames():
    p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, side="left")
    from praxis_session.perception.pose import PoseResult
    from tests.test_pose import figure

    res = PoseResult(
        landmarks_px=figure(5),
        visibility=np.ones(33, np.float32),
        world=np.zeros((33, 3), np.float32),
        conf=0.9,
    )
    p.process_pose(res, 0.0, 0)
    seen = []
    for i in range(1, 20):
        seen += [e.type for e in p.process_pose(None, i * 0.1, i)]
    assert seen.count("perception_lost") == 1
    assert "perception_regained" in [e.type for e in p.process_pose(res, 3.0, 30)]


def test_arm_frame_carries_gate_and_freezes_when_frontal():
    from praxis_session.perception.pose import PoseResult
    from tests.test_pose import figure

    p = SessionPipeline(
        mode="arm", sheet="none", use_hand=False, use_pose=False, side="left", hold_s=1.0
    )
    profile = [5 + 85 * i / 15 for i in range(16)] + [90] * 20 + [5] * 20
    evs = []
    for i, ang in enumerate(profile):
        res = PoseResult(
            landmarks_px=figure(ang, frontal=True),
            visibility=np.ones(33, np.float32),
            world=np.zeros((33, 3), np.float32),
            conf=0.9,
        )
        evs += p.process_pose(res, t=i / 15.0, frame_index=i)
    frames = [e.to_dict() for e in evs if e.type == "frame"]
    assert frames[5]["arm"]["gate"] == "turn_side"
    assert not [e for e in evs if e.type in ("state_change", "rep_complete")]
    # low hip visibility: the gate names the hips; pose absence carries no gate
    vis = np.ones(33, np.float32)
    vis[23] = 0.2
    res = PoseResult(
        landmarks_px=figure(5), visibility=vis, world=np.zeros((33, 3), np.float32), conf=0.9
    )
    d = p.process_pose(res, t=10.0, frame_index=100)[0].to_dict()
    assert d["arm"]["gate"] == "hips_out_of_view"
    assert p.process_pose(None, t=10.1, frame_index=101)[0].to_dict()["arm"]["gate"] is None


def test_arm_setup_needs_no_sheet():
    """Arm to the front uses no printed sheet: calibration for it must not require markers or
    the task area, and must never report perception loss for missing markers (audit A3)."""
    p = SessionPipeline(mode="calibrate", sheet="nhpt_board", for_mode="arm")
    frame, _ = camera_frame(NHPT_BOARD, hide_marker=1)
    seen = []
    for i in range(8):
        evs = p.process(frame, i * 0.1, i)
        seen += _types(evs)
    checks = evs[2].to_dict()
    ids = [c["id"] for c in checks["checks"]]
    assert "markers" not in ids and "task_area" not in ids
    assert "side_view" in ids
    assert checks["all_required_pass"] is True
    assert "perception_lost" not in seen
    for e in evs:
        validate_event(e.to_dict())


def test_sheet_setup_still_requires_markers():
    p = SessionPipeline(mode="calibrate", sheet="nhpt_board")
    frame, _ = camera_frame(NHPT_BOARD, hide_marker=1)
    checks = p.process(frame, 0.0, 0)[2].to_dict()
    assert checks["all_required_pass"] is False


# ---- Sprint D-SEG ---------------------------------------------------------------------------
def test_sample_colour_command_sets_peg_range_and_frames_report_it():
    from praxis_session.perception.synth import WOOD_BGR

    B = NHPT_BOARD
    p = SessionPipeline(mode="nhpt", sheet="nhpt_board", use_hand=False)
    assert p.command({"cmd": "sample_colour", "hole": 4})["ok"] is False  # nothing seen yet
    frame, _ = camera_frame(B, pegs_mm=[B.targets_mm[4]], peg_bgr=WOOD_BGR)
    d = p.process(frame, 0.0, 0)[0].to_dict()
    assert d["board"]["occupancy"]["hole_4"] == "empty" and d["board"]["colour"] is None
    r = p.command({"cmd": "sample_colour", "hole": 4})
    assert r["ok"] and r["colour"]["source"] == "sampled" and r["mode"] == "nhpt"
    d = p.process(frame, 0.1, 1)[0].to_dict()
    assert d["board"]["occupancy"]["hole_4"] == "occupied"
    assert d["board"]["colour"]["h"] == r["colour"]["h"]
    validate_event(d)
    x, y = B.targets_mm[4]
    assert p.command({"cmd": "sample_colour", "x_mm": x, "y_mm": y})["ok"]
    assert p.command({"cmd": "sample_colour"})["ok"] is False
    assert p.command({"cmd": "sample_colour", "hole": 42})["ok"] is False


def test_sample_colour_command_in_cup_mode():
    from praxis_session.perception.board_spec import CUP_TARGETS as C

    p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    frame, _ = camera_frame(C, cup_mm=C.targets_mm[0], cup_bgr=(30, 200, 60))  # a green base
    d = p.process(frame, 0.0, 0)[0].to_dict()
    assert d["cup"]["cup_mm"] is None and d["cup"]["colour"] is None
    r = p.command({"cmd": "sample_colour", "x_mm": C.targets_mm[0][0], "y_mm": C.targets_mm[0][1]})
    assert r["ok"] and r["mode"] == "cup"
    d = p.process(frame, 0.1, 1)[0].to_dict()
    assert d["cup"]["cup_mm"] is not None and d["cup"]["colour"]["h"] == r["colour"]["h"]
    validate_event(d)


# ---- tap-to-sample from the live screen (12 Oct) ---------------------------------------------
def _frame_px(H_mm_to_px: np.ndarray, xy_mm) -> tuple[float, float]:
    import cv2

    p = cv2.perspectiveTransform(np.array([[xy_mm]], np.float32), H_mm_to_px)[0, 0]
    return float(p[0]), float(p[1])


def test_a_tap_in_frame_pixels_samples_the_cup_on_the_warped_sheet():
    from praxis_session.perception.board_spec import CUP_TARGETS as C

    p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    assert p.command({"cmd": "sample_colour", "x_px": 10, "y_px": 10})["reason"] == "not_calibrated"
    frame, H = camera_frame(C, cup_mm=C.targets_mm[2], cup_bgr=(30, 200, 60))  # a green base
    assert p.process(frame, 0.0, 0)[0].to_dict()["cup"]["cup_mm"] is None
    x, y = _frame_px(H, C.targets_mm[2])
    r = p.command({"cmd": "sample_colour", "x_px": x, "y_px": y})
    assert r["ok"] and r["applied"] and r["detected"] is True and r["target"] == "cup"
    assert abs(r["at_mm"][0] - C.targets_mm[2][0]) < 3 and abs(r["at_mm"][1] - C.targets_mm[2][1]) < 3
    assert "cup" in r["message"].lower()
    d = p.process(frame, 0.1, 1)[0].to_dict()
    assert d["cup"]["cup_mm"] is not None and d["cup"]["colour"]["h"] == r["colour"]["h"]


def test_a_tap_on_paper_or_a_black_band_is_refused_and_says_why():
    from praxis_session.perception.board_spec import CUP_TARGETS as C

    p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    frame, H = camera_frame(C, cup_mm=C.targets_mm[2], cup_bgr=(25, 25, 25))  # a black base
    p.process(frame, 0.0, 0)
    r = p.command({"cmd": "sample_colour", **dict(zip(("x_px", "y_px"), _frame_px(H, C.targets_mm[2])))})
    assert r["ok"] is False and r["reason"] == "no_colour" and r["applied"] is False
    assert "colour" in r["message"].lower()
    # blank paper between the dots: also no colour; the window in use is untouched
    r = p.command({"cmd": "sample_colour", **dict(zip(("x_px", "y_px"), _frame_px(H, (20.0, 20.0))))})
    assert r["reason"] == "no_colour" and p._cup_sheet.colour_range is None


def test_a_tap_off_the_sheet_is_refused():
    from praxis_session.perception.board_spec import CUP_TARGETS as C

    p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    frame, H = camera_frame(C, cup_mm=C.targets_mm[0])
    p.process(frame, 0.0, 0)
    r = p.command({"cmd": "sample_colour", "x_px": 1.0, "y_px": 1.0})
    assert r["ok"] is False and r["reason"] == "off_sheet" and "sheet" in r["message"].lower()
    assert p.command({"cmd": "sample_colour", "x_px": "nan", "y_px": 3})["ok"] is False


def test_a_tap_on_a_wooden_peg_samples_the_peg_colour():
    from praxis_session.perception.synth import WOOD_BGR

    B = NHPT_BOARD
    p = SessionPipeline(mode="nhpt", sheet="nhpt_board", use_hand=False)
    frame, H = camera_frame(B, pegs_mm=[B.targets_mm[4]], peg_bgr=WOOD_BGR)
    assert p.process(frame, 0.0, 0)[0].to_dict()["board"]["occupancy"]["hole_4"] == "empty"
    x, y = _frame_px(H, B.targets_mm[4])
    r = p.command({"cmd": "sample_colour", "x_px": x, "y_px": y})
    assert r["ok"] and r["target"] == "pegs" and r["detected"] is True
    assert p.process(frame, 0.1, 1)[0].to_dict()["board"]["occupancy"]["hole_4"] == "occupied"


def test_replay_reuses_a_colour_sample_from_the_sidecar(tmp_path):
    """eval.py replays a clip with the colour the patient sampled (sidecar `colour_sample`)."""
    import cv2

    from praxis_session.perception.board_spec import CUP_TARGETS as C
    from praxis_session.replay import run_replay

    frame, _ = camera_frame(C, cup_mm=C.targets_mm[2], cup_bgr=(30, 200, 60))
    path = tmp_path / "green.mp4"
    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (frame.shape[1], frame.shape[0]))
    for _ in range(5):
        w.write(frame)
    w.release()
    plain = run_replay(path, mode="cup", sheet="cup_targets", use_hand=False)
    assert all(e.payload["cup"]["cup_mm"] is None for e in plain.events if e.type == "frame")
    x, y = C.targets_mm[2]
    res = run_replay(path, mode="cup", sheet="cup_targets", use_hand=False, colour_sample={"t": 0.1, "x_mm": x, "y_mm": y})
    frames = [e.payload for e in res.events if e.type == "frame"]
    assert frames[0]["cup"]["cup_mm"] is None and frames[-1]["cup"]["cup_mm"] is not None
    assert res.colour_sample and res.colour_sample["ok"]


def test_nhpt_next_hole_is_null_in_any_hole_mode():
    p = SessionPipeline(mode="nhpt", sheet="nhpt_board", use_hand=False)
    frame, _ = camera_frame(NHPT_BOARD)
    d = p.process(frame, 0.0, 0)[0].to_dict()
    assert d["calibrated"] and d["overlay"]["next_hole"] is None


# ---- Sprint E: the registry drives arm mode ---------------------------------------------
def _pose_res(lm):
    from praxis_session.perception.pose import PoseResult

    return PoseResult(
        landmarks_px=lm,
        visibility=np.ones(33, np.float32),
        world=np.zeros((33, 3), np.float32),
        conf=0.9,
    )


def test_arm_mode_runs_a_front_view_exercise_from_the_registry():
    """Gentle abduction: front view, target 60, 2 s hold - all from `perception/exercises.py`."""
    from praxis_session.schema import validate_event
    from tests.test_pose import figure

    p = SessionPipeline(
        mode="arm", sheet="none", use_hand=False, use_pose=False, side="left",
        exercise="abduction", tier="gentle", sets=1, reps=1,
    )
    assert p._arm is not None and p._arm.target_deg == 60.0 and p._arm.hold_s == 2.0
    profile = [5 + 60 * i / 15 for i in range(16)] + [65] * 40 + [65 - 60 * i / 15 for i in range(16)] + [5] * 8
    evs = []
    for i, ang in enumerate(profile):
        evs += p.process_pose(_pose_res(figure(ang, frontal=True)), t=i / 15.0, frame_index=i)
    types = [e.type for e in evs]
    assert types.count("rep_complete") == 1 and "arm_complete" in types
    assert types.count("exercise_start") == 1
    fr = [e for e in evs if e.type == "frame"][20].to_dict()
    validate_event(fr)
    arm = fr["arm"]
    assert arm["exercise"] == "abduction" and arm["view_required"] == "front"
    assert arm["tier"] == "gentle" and arm["gate"] is None
    assert arm["phase"] in ("lift", "hold") and 0.0 <= arm["rep_progress"] <= 1.0
    assert fr["arm"]["angles"]["metric"] == "abduction"


def test_front_view_exercise_gates_when_the_patient_is_side_on():
    from tests.test_pose import figure

    p = SessionPipeline(
        mode="arm", sheet="none", use_hand=False, use_pose=False, side="left",
        exercise="abduction", sets=1, reps=1,
    )
    evs = []
    for i, ang in enumerate([5 + 85 * i / 15 for i in range(16)] + [90] * 20):
        evs += p.process_pose(_pose_res(figure(ang)), t=i / 15.0, frame_index=i)  # side view
    assert [e for e in evs if e.type in ("state_change", "rep_complete")] == []
    assert [e.to_dict() for e in evs if e.type == "frame"][10]["arm"]["gate"] == "turn_front"


def _abduction_stream(sep_px: float | None = None, hike_at=lambda a: 0.0):
    """One Arm out to the side lift from synthetic landmarks (front view), through the pipeline."""
    from tests.test_pose import figure

    p = SessionPipeline(
        mode="arm", sheet="none", use_hand=False, use_pose=False, side="left",
        exercise="abduction", sets=1, reps=1,
    )
    profile = [5.0] * 12 + [5 + 85 * i / 15 for i in range(16)] + [90] * 50 + [90 - 85 * i / 15 for i in range(16)] + [5] * 8
    evs = []
    for i, ang in enumerate(profile):
        lm = figure(ang, frontal=True, sep_px=sep_px, hike=hike_at(ang))
        evs += p.process_pose(_pose_res(lm), t=i / 15.0, frame_index=i)
    return evs


def test_a_patient_turned_about_20_degrees_is_still_scored_from_the_front():
    """sep 0.57 trunk lengths (REHAB24-6: ~10-25 deg turned) gated as turn_front before 12 Oct."""
    evs = _abduction_stream(sep_px=0.57 * 200)
    assert [e.type for e in evs].count("rep_complete") == 1
    assert all(e.payload["arm"]["gate"] is None for e in evs if e.type == "frame")
    evs = _abduction_stream(sep_px=0.45 * 200)  # ~45 deg or more: asked to turn
    assert [e.type for e in evs].count("rep_complete") == 0
    assert [e.to_dict() for e in evs if e.type == "frame"][20]["arm"]["gate"] == "turn_front"


def test_synthetic_shrug_fires_and_healthy_rhythm_does_not():
    """Landmark streams: the practising shoulder rising with the arm at the healthy rate (scaled
    from the REHAB24-6 median, ~0.085 trunk lengths at 90 deg) is not a hike; the same lift with
    a shrug of 0.15 trunk lengths (~7 cm) from 30 deg on is."""
    from praxis_session.perception.arm_fsm import hike_allowance

    healthy = _abduction_stream(hike_at=lambda a: 0.085 * max(0.0, a - 5) / 85)
    assert "shoulder_hiking" not in [e.type for e in healthy]
    shrug = _abduction_stream(hike_at=lambda a: 0.085 * max(0.0, a - 5) / 85 + (0.15 if a >= 30 else 0.0))
    hikes = [e.payload for e in shrug if e.type == "shoulder_hiking"]
    assert len(hikes) == 1 and hikes[0]["hike"] > hike_allowance(hikes[0]["angle_deg"])
    assert [e.payload for e in shrug if e.type == "rep_complete"][0]["hike"] is True


def test_pendulum_mode_counts_swings_without_a_hold():
    import math

    from tests.test_exercises import swing_figure

    p = SessionPipeline(
        mode="arm", sheet="none", use_hand=False, use_pose=False, side="left",
        exercise="pendulum", sets=1, reps=2,
    )
    evs = []
    for i in range(int(15 * 4)):
        deg = 22.0 * math.sin(2 * math.pi * i / 15.0)
        evs += p.process_pose(_pose_res(swing_figure(deg)), t=i / 15.0, frame_index=i)
    types = [e.type for e in evs]
    assert types.count("rep_complete") == 2 and "arm_complete" in types
    assert "hold_too_short" not in types
    fr = [e for e in evs if e.type == "frame"][10].to_dict()
    assert fr["arm"]["kind"] == "oscillation" and fr["overlay"]["ghost_target_px"] is None


# ---- pain tiers in the pipeline (23 Sep) ------------------------------------------------
def test_gentle_cup_runs_the_slow_arcs_only():
    p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False, tier="gentle")
    cup = p.snapshot()["cup"]
    assert cup["arcs_planned"] == {"slow": 2, "fast": 0}
    full = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    assert full.snapshot()["cup"]["arcs_planned"] == {"slow": 2, "fast": 2}


def test_apply_tier_only_ever_makes_the_session_more_careful():
    p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="abduction")
    assert p.apply_tier("gentle") == {"tier": "gentle", "changed": True}
    arm = p.snapshot()["arm"]
    assert (arm["tier"], arm["target_deg"], arm["hold_s"], arm["reps_per_set"]) == ("gentle", 60.0, 2.0, 6)
    assert p.apply_tier("full") == {"tier": "gentle", "changed": False}  # never loosened
    assert p.snapshot()["arm"]["target_deg"] == 60.0
    cup = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    assert cup.apply_tier("gentle")["changed"] is True
    assert cup.snapshot()["cup"]["arcs_planned"]["fast"] == 0


def test_apply_tier_keeps_the_running_dose_once_reps_have_started():
    from tests.test_pose import figure

    p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="flexion", hold_s=0.5, sets=1, reps=3)
    profile = [5 + 85 * i / 15 for i in range(16)] + [90] * 10 + [90 - 85 * i / 15 for i in range(16)] + [5] * 8
    for i, ang in enumerate(profile):
        p.process_pose(_pose_res(figure(ang)), t=i / 15.0, frame_index=i)
    assert p.snapshot()["arm"]["reps_total"] == 1
    assert p.apply_tier("gentle") == {"tier": "full", "changed": False}
