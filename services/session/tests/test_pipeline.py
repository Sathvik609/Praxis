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
