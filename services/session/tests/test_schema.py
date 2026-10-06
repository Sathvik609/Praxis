import pytest
from jsonschema import ValidationError

from praxis_session.events import make_event
from praxis_session.schema import EVENT_TYPES, validate_event


def test_heartbeat_validates():
    validate_event(
        make_event(
            "heartbeat", frame_index=0, frame={"width": 640, "height": 480, "bytes": 10}
        ).to_dict()
    )


def test_unknown_type_rejected():
    with pytest.raises(ValidationError):
        validate_event(make_event("banana").to_dict())


def test_missing_t_rejected():
    with pytest.raises(ValidationError):
        validate_event({"type": "heartbeat", "id": 1})


def test_types_listed():
    assert {"heartbeat", "error", "calibration", "quality", "setup_checks"} <= EVENT_TYPES


def test_feedback_ack_summary_validates_and_note_categories_are_constrained(tmp_path):
    from praxis_session.prescription import SEED_PRESCRIPTION
    from praxis_session.session import CoachSession

    s = CoachSession(mode="arm", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="sch")
    s.on_events([make_event("compensation_lean", t=1.0, lean_deg=14, count=1)], snapshot={}, t=1.0)
    s.on_feedback({"pain_after": 8, "difficulty": "hard", "effort": 7, "again_tomorrow": "no", "ended_early": True, "barriers": ["pain"]}, t=2.0)
    summary = s.summary(2.0)
    validate_event(make_event("command", cmd="feedback", ok=True, summary=summary).to_dict())
    bad = summary | {"coach": summary["coach"] | {"notes": [summary["coach"]["notes"][0] | {"cat": "Mood"}]}}
    with pytest.raises(ValidationError):
        validate_event(make_event("command", cmd="feedback", ok=True, summary=bad).to_dict())
