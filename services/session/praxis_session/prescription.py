"""Therapist prescription: dose, allowed adaptations and stop rules. Clamps live here, in code."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class StopRuleThresholds(BaseModel):
    pain_max: int = 7  # pain at or above this ends the session = the rest tier (plan.py, 23 Sep)
    lean_deg: float = 12.0
    lean_events: int = 3
    failed_reps: int = 3  # consecutive unverified reps -> pause
    exertion_high_s: float = 60.0
    new_symptoms: bool = True  # new/worse symptoms -> review before practising


class Prescription(BaseModel):
    program: str
    version: int
    level: int
    side: str
    clinician: str
    exercises: dict[str, dict[str, Any]]
    allowed_adaptations: dict[str, dict[str, Any]] = Field(default_factory=dict)
    stop_rules: StopRuleThresholds = Field(default_factory=StopRuleThresholds)


SEED_PRESCRIPTION = Prescription(
    program="Hospital GRASP",
    version=3,
    level=2,
    side="left",
    clinician="Dr. Anita Rao, OT",
    # The locked set of 23 Sep 2026, keyed by the registry's `rx` (flexion keeps "arm").
    exercises={
        "pendulum": {"sets": 2, "reps": 10},
        "arm": {"sets": 2, "reps": 8, "hold_s": 3.0, "target_deg": 90.0, "ceiling_deg": 90.0, "weight_lb": 0.5},
        "abduction": {"sets": 2, "reps": 8, "hold_s": 3.0, "target_deg": 90.0, "ceiling_deg": 90.0},
        "cup": {"slow_arcs": 2, "fast_arcs": 2},
        "nhpt": {"frequency": "weekly", "hands": ["left"]},
        "external_rotation": {"sets": 2, "reps": 8, "hold_s": 3.0, "mode": "demo"},
        "internal_rotation": {"sets": 2, "reps": 8, "hold_s": 3.0, "mode": "demo"},
    },
    # What the gentle pain tier (and the coach) may change, and how far. Nothing else moves.
    allowed_adaptations={
        "pendulum": {"reps": [8, 10]},
        "arm": {"hold_s": [2.0, 3.0], "target_deg": [60.0, 90.0], "reps": [6, 8]},
        "abduction": {"hold_s": [2.0, 3.0], "target_deg": [60.0, 90.0], "reps": [6, 8]},
        "cup": {"fast_arcs": True},
    },
    stop_rules=StopRuleThresholds(),
)


def clamp(p: Prescription, exercise: str, field: str, value: float) -> float:
    """Clamp an adaptation to the prescribed range; unknown fields are not adaptable."""
    rng = p.allowed_adaptations.get(exercise, {}).get(field)
    if not isinstance(rng, list) or len(rng) != 2:
        raise KeyError(f"{exercise}.{field} is not an allowed adaptation")
    lo, hi = float(rng[0]), float(rng[1])
    ceiling = p.exercises.get(exercise, {}).get("ceiling_deg") if field == "target_deg" else None
    if ceiling is not None:
        hi = min(hi, float(ceiling))
    return max(lo, min(hi, float(value)))
