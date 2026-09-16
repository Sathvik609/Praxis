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
