import pytest

from praxis_session.prescription import SEED_PRESCRIPTION, Prescription, clamp


def test_seed_prescription_matches_wireframe():
    p = SEED_PRESCRIPTION
    assert p.program == "Hospital GRASP" and p.level == 2 and p.version == 3 and p.side == "left"
    assert p.exercises["cup"]["slow_arcs"] == 2 and p.exercises["cup"]["fast_arcs"] == 2
    assert p.exercises["arm"]["sets"] == 2 and p.exercises["arm"]["reps"] == 8
    assert p.exercises["arm"]["hold_s"] == 3.0 and p.exercises["arm"]["ceiling_deg"] == 90
    assert p.stop_rules.pain_max == 5 and p.stop_rules.lean_deg == 12 and p.stop_rules.lean_events == 3


def test_clamp_never_exceeds_allowed_range():
    p = SEED_PRESCRIPTION
    assert clamp(p, "arm", "hold_s", 5.0) == 3.0
    assert clamp(p, "arm", "hold_s", 1.0) == 2.0
    assert clamp(p, "arm", "target_deg", 120) == 90
    assert clamp(p, "arm", "target_deg", 75) == 75
    with pytest.raises(KeyError):
        clamp(p, "arm", "weight_lb", 3)


def test_prescription_roundtrip_json():
    d = SEED_PRESCRIPTION.model_dump()
    assert Prescription.model_validate(d) == SEED_PRESCRIPTION
