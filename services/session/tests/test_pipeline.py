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
    p = SessionPipeline(mode="calibrate", sheet="nhpt_board")
    good, _ = camera_frame(NHPT_BOARD)
    bad, _ = camera_frame(NHPT_BOARD, hide_marker=1)
    p.process(good, 0.0, 0)
    seen = []
    for i in range(1, 8):
        seen += _types(p.process(bad, i * 0.1, i))
    assert seen.count("perception_lost") == 1
    assert "perception_regained" in _types(p.process(good, 1.0, 8))


def test_no_loss_event_before_first_calibration():
    p = SessionPipeline(mode="calibrate", sheet="nhpt_board")
    bad, _ = camera_frame(NHPT_BOARD, hide_marker=1)
    seen = []
    for i in range(10):
        seen += _types(p.process(bad, i * 0.1, i))
    assert "perception_lost" not in seen


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
