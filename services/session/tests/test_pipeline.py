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


def test_perception_lost_and_regained():
    """Two markers gone: the homography is held 1.5 s, then LOSS_FRAMES (20) uncalibrated
    frames are needed before `perception_lost` (D-CAL-1). At 0.5 s steps: 15 bad frames
    (3 held + 12 lost) stay quiet, 25 (3 held + 22 lost) pause."""
    from tests.test_calibration import hide_markers

    good, H = camera_frame(NHPT_BOARD)
    bad = hide_markers(good, H, NHPT_BOARD, [1, 2])
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

    evs = steep.process(camera_frame(CUP_TARGETS, tilt_deg=40, yaw_deg=5)[0], 0.0, 0)
    row = _check(evs, "angle")
    assert row["status"] == "check" and "above the table" in row["hint"]
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


def test_nhpt_next_hole_is_null_in_any_hole_mode():
    p = SessionPipeline(mode="nhpt", sheet="nhpt_board", use_hand=False)
    frame, _ = camera_frame(NHPT_BOARD)
    d = p.process(frame, 0.0, 0)[0].to_dict()
    assert d["calibrated"] and d["overlay"]["next_hole"] is None
