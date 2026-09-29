"""Therapist prescription: dose, allowed adaptations and stop rules. Clamps live here, in code."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StopRuleThresholds(BaseModel):
    pain_max: int = 7  # pain at or above this ends the session = the rest tier (plan.py, 23 Sep)
    lean_deg: float = 12.0
    lean_events: int = 3
    failed_reps: int = 3  # consecutive reps the camera could not verify -> pause, check setup
    missed_reps: int = 3  # consecutive performance misses (target/hold/swing) -> gentle rest
    exertion_high_s: float = 60.0
    new_symptoms: bool = True  # new/worse symptoms -> review before practising


WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
SCHEDULE_MINUTES = 10  # = plan.DAY_MINUTES (plan imports this module; tests/test_schedule.py keeps them equal)


class NextVisit(BaseModel):
    """The next clinic visit the therapist booked: a local date-time and who it is with."""

    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    at: str  # ISO local date-time, e.g. "2026-10-01T14:30"
    with_: str = Field(alias="with", max_length=80)

    @field_validator("at")
    @classmethod
    def _iso(cls, v: str) -> str:
        datetime.fromisoformat(v)  # ValueError -> ValidationError
        return v

    @field_validator("with_")
    @classmethod
    def _named(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("next visit needs a clinician")
        return v

    def when(self) -> datetime:
        return datetime.fromisoformat(self.at)


class Schedule(BaseModel):
    """Practice days are part of the prescription (screen 12 · Calendar, 28 Sep 2026): the
    therapist sets them, the calendar and adherence read them. Weekdays 0 = Mon ... 6 = Sun."""

    practice_days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4])
    nhpt_day: int = Field(default=6, ge=0, le=6)
    next_visit: NextVisit | None = None
    minutes_per_day: int = Field(default=SCHEDULE_MINUTES, ge=1, le=120)

    @field_validator("practice_days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if not v:
            raise ValueError("at least one practice day")
        if len(set(v)) != len(v):
            raise ValueError("practice days must be unique")
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("practice days are weekdays 0 (Mon) to 6 (Sun)")
        return sorted(v)


SEED_SCHEDULE = Schedule(
    practice_days=[0, 1, 2, 3, 4],
    nhpt_day=6,
    # The old seed said "Thu 18 Sep, 2:30 PM", which is in the past on 28 Sep.
    next_visit=NextVisit(at="2026-10-01T14:30", with_="Dr. Anita Rao, OT"),
    minutes_per_day=SCHEDULE_MINUTES,
)


def visit_text(v: NextVisit | None) -> str | None:
    """The patient-facing label Home and the therapist view show, e.g. "Thu 1 Oct, 2:30 PM"."""
    if v is None:
        return None
    t = v.when()
    hour = t.hour % 12 or 12
    return f"{WEEKDAYS[t.weekday()]} {t.day} {MONTHS[t.month - 1]}, {hour}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


class Prescription(BaseModel):
    program: str
    version: int
    level: int
    side: str
    clinician: str
    exercises: dict[str, dict[str, Any]]
    allowed_adaptations: dict[str, dict[str, Any]] = Field(default_factory=dict)
    stop_rules: StopRuleThresholds = Field(default_factory=StopRuleThresholds)
    # Rows written before 28 Sep carry no schedule: they read as the seed schedule.
    schedule: Schedule = Field(default_factory=lambda: SEED_SCHEDULE.model_copy(deep=True))
    # Set on a version a person wrote (the therapist's schedule edit); the seed has none, and
    # `Store._refresh_seed_prescription` never rewrites a row that has it.
    edited: dict[str, Any] | None = None


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
    schedule=SEED_SCHEDULE,
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
