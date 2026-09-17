"""Shoulder exercise registry for the guided flow (OpenCV cv2.__version__ == 5.0.0).

One entry per exercise: which camera view it needs, which camera-relative metric scores it
(the functions live in `pose.py` and run on the same BlazePose landmarks the tracker returns),
its target and hard ceiling in code, its dose, and the paraphrased steps shown to the patient.
`arm_fsm.ArmFSM` is driven entirely by an entry from here, so adding an exercise never touches
the state machine.

Two honesty notes carried into the UI and `docs/TECHNICAL_REPORT.md`:
- every number is **camera-relative progress in the image plane, never clinical goniometry**;
- the front view cannot separate scaption from abduction (the 30° forward offset projects
  away), and the rotation metric is an approximation of a motion that points at the camera.
  Both are validated on synthetic landmark streams only.

GRASP text is UBC / Heart & Stroke material: every `steps` line is our own paraphrase
(`docs/LICENSES.md`).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Callable, Literal

from praxis_session.perception.pose import (
    PoseResult,
    pendulum_swing_deg,
    rotation_deg,
    shoulder_elevation_deg,
)

Metric = Callable[[PoseResult, str], float]
View = Literal["side", "front"]
Kind = Literal["hold", "oscillation"]

# Optional targets from the labeled reference set. The file is produced by `evaluation/`; the
# registry works without it and falls back to the constants below.
REFERENCE_PATH = Path(__file__).resolve().parents[3] / "evaluation" / "results" / "rehab_reference_ranges.json"


def _internal_rotation_deg(res: PoseResult, side: str) -> float:
    """Internal rotation is the same measurement with the sign flipped, so the FSM always
    scores a rising positive number."""
    return round(-rotation_deg(res, side), 1)


@dataclass(frozen=True)
class Exercise:
    id: str
    name: str
    clip: str
    view: View
    metric: Metric = field(compare=False, repr=False)
    target_deg: float = 90.0
    ceiling_deg: float = 90.0
    tolerance_deg: float = 10.0
    start_below_deg: float = 25.0
    hold_s: float = 3.0
    sets: int = 2
    reps: int = 8
    kind: Kind = "hold"
    gentle: dict[str, Any] = field(default_factory=dict)
    steps: list[str] = field(default_factory=list)

    @property
    def dose(self) -> str:
        if self.kind == "oscillation":
            return f"{self.sets} × {self.reps} swings"
        return f"{self.sets} × {self.reps} · hold {self.hold_s:g} s"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "clip": self.clip,
            "view": self.view,
            "dose": self.dose,
            "sets": self.sets,
            "reps": self.reps,
            "hold_s": self.hold_s,
            "target_deg": self.target_deg,
            "ceiling_deg": self.ceiling_deg,
            "steps": list(self.steps),
        }


def _mean_minus_sd(block: Any) -> float | None:
    if not isinstance(block, dict):
        return None
    mean = next((block[k] for k in ("mean", "mean_deg") if isinstance(block.get(k), (int, float))), None)
    if mean is None:
        return None
    sd = next((block[k] for k in ("sd", "sd_deg", "std", "std_deg") if isinstance(block.get(k), (int, float))), 0.0)
    return float(mean) - float(sd)


def load_reference_ranges(path: Path | None = None) -> dict[str, float]:
    """`{exercise_id: reference_deg}` from the labeled reference set, or `{}` when the file is
    absent or unreadable.

    The shipped file (`evaluation/results/rehab_reference_ranges.json`) holds, per exercise, a
    `source` and `correct` / `incorrect` / `correct_healthy` blocks of `{mean, sd, n}`. We take
    **mean - 1 sd of the correct reps**. These are Kinect body-frame peaks from *healthy adults*
    (flexion ~160°, abduction ~155°), far above the GRASP ceiling, so `build_registry`
    clamps every target to the exercise's own `ceiling_deg` — the reference never raises a
    ceiling, it only ever lowers a target. `{"target_deg": x}` and a flat `{mean, sd}` are also
    accepted so an earlier or later file shape still loads.
    """
    p = REFERENCE_PATH if path is None else path
    try:
        raw = json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return {}
    table = raw.get("exercises", raw) if isinstance(raw, dict) else {}
    out: dict[str, float] = {}
    for key, val in table.items():
        if not isinstance(val, dict):
            continue
        if isinstance(val.get("target_deg"), (int, float)):
            out[key] = float(val["target_deg"])
            continue
        deg = next(
            (d for d in (_mean_minus_sd(val.get("correct")), _mean_minus_sd(val.get("correct_healthy")), _mean_minus_sd(val)) if d is not None),
            None,
        )
        if deg is not None:
            out[key] = deg
    return out


_STEPS: dict[str, list[str]] = {
    "pendulum": [
        "Stand and lean forward, resting your good hand on a table.",
        "Let the sore arm hang straight down, loose and heavy.",
        "Swing it gently forward and back — let the weight do the work, don't lift.",
        "Stop if anything sharpens. This one should feel easy.",
    ],
    "flexion": [
        "Sit tall, side-on to the camera, arm hanging by your side.",
        "Lift the arm straight in front of you, thumb leading, up to shoulder height.",
        "Hold there while I count three.",
        "Lower slowly. Keep your back against the chair — no leaning.",
    ],
    "abduction": [
        "Sit tall facing the camera, arm by your side.",
        "Lift the arm out to the side, palm down, up to shoulder height.",
        "Hold, then lower slowly.",
        "Keep the shoulder down — don't shrug it up toward your ear.",
    ],
    "scaption": [
        "Sit tall facing the camera, arm by your side.",
        "Lift the arm out at about half-way between front and side, thumb up.",
        "Hold, then lower slowly.",
        "This angle is usually the most comfortable of the three lifts.",
    ],
    "extension": [
        "Sit tall, side-on to the camera, arm hanging by your side.",
        "Draw the arm straight back behind you, elbow straight.",
        "Hold briefly, then return.",
        "Only go as far as is comfortable; the range here is small.",
    ],
    "external_rotation": [
        "Sit tall facing the camera, elbow tucked against your side and bent to a right angle.",
        "Keeping the elbow against you, swing the forearm outward, away from your tummy.",
        "Hold, then return slowly.",
        "The elbow stays glued to your side the whole time.",
    ],
    "internal_rotation": [
        "Sit tall facing the camera, elbow tucked against your side and bent to a right angle.",
        "Keeping the elbow against you, bring the forearm across toward your tummy.",
        "Hold, then return slowly.",
        "Small and slow beats big and fast.",
    ],
}

_BASE: tuple[Exercise, ...] = (
    Exercise(
        id="pendulum", name="Pendulum", clip="pendulum", view="side", metric=pendulum_swing_deg,
        target_deg=20.0, ceiling_deg=45.0, tolerance_deg=5.0, start_below_deg=5.0,
        hold_s=0.0, sets=2, reps=10, kind="oscillation",
        gentle={"reps": 8}, steps=_STEPS["pendulum"],
    ),
    Exercise(
        id="flexion", name="Arm to the front", clip="armFront", view="side",
        metric=shoulder_elevation_deg, target_deg=90.0, ceiling_deg=90.0, tolerance_deg=10.0,
        start_below_deg=25.0, hold_s=3.0, sets=2, reps=8,
        gentle={"hold_s": 2.0, "reps": 6}, steps=_STEPS["flexion"],
    ),
    Exercise(
        id="abduction", name="Arm out to the side", clip="armSide", view="front",
        metric=shoulder_elevation_deg, target_deg=90.0, ceiling_deg=90.0, tolerance_deg=10.0,
        start_below_deg=25.0, hold_s=3.0, sets=2, reps=8,
        gentle={"target_deg": 60.0, "hold_s": 2.0, "reps": 6}, steps=_STEPS["abduction"],
    ),
    Exercise(
        id="scaption", name="Arm out at an angle", clip="armScaption", view="front",
        metric=shoulder_elevation_deg, target_deg=75.0, ceiling_deg=90.0, tolerance_deg=10.0,
        start_below_deg=25.0, hold_s=3.0, sets=2, reps=8,
        gentle={"target_deg": 55.0, "hold_s": 2.0, "reps": 6}, steps=_STEPS["scaption"],
    ),
    Exercise(
        id="extension", name="Arm to the back", clip="armExtension", view="side",
        metric=shoulder_elevation_deg, target_deg=30.0, ceiling_deg=45.0, tolerance_deg=8.0,
        start_below_deg=10.0, hold_s=2.0, sets=2, reps=8,
        gentle={"target_deg": 20.0, "reps": 6}, steps=_STEPS["extension"],
    ),
    Exercise(
        id="external_rotation", name="Rotate out", clip="rotationOut", view="front",
        metric=rotation_deg, target_deg=30.0, ceiling_deg=60.0, tolerance_deg=8.0,
        start_below_deg=8.0, hold_s=3.0, sets=2, reps=8,
        gentle={"target_deg": 20.0, "hold_s": 2.0, "reps": 6}, steps=_STEPS["external_rotation"],
    ),
    Exercise(
        id="internal_rotation", name="Rotate in", clip="rotationIn", view="front",
        metric=_internal_rotation_deg, target_deg=25.0, ceiling_deg=45.0, tolerance_deg=8.0,
        start_below_deg=8.0, hold_s=3.0, sets=2, reps=8,
        gentle={"target_deg": 18.0, "hold_s": 2.0, "reps": 6}, steps=_STEPS["internal_rotation"],
    ),
)


def build_registry(ranges: dict[str, float] | None = None, items: tuple[Exercise, ...] = _BASE) -> dict[str, Exercise]:
    """The registry with reference targets applied where we have them. `None` reads the file;
    `{}` keeps every constant above. A reference can only lower a target, never raise the
    ceiling."""
    ranges = load_reference_ranges() if ranges is None else ranges
    out: dict[str, Exercise] = {}
    for ex in items:
        ref = ranges.get(ex.id)
        out[ex.id] = ex if ref is None else replace(ex, target_deg=min(float(ref), ex.ceiling_deg))
    return out


EXERCISES: dict[str, Exercise] = build_registry()
ORDER: tuple[str, ...] = tuple(ex.id for ex in _BASE)
DEFAULT_ID = "flexion"
# The gentle tier (pain 4-6) keeps the four exercises that stay below shoulder height or below
# the painful arc, at shorter holds and fewer reps (plan §Global Constraints).
GENTLE_IDS: tuple[str, ...] = ("pendulum", "flexion", "abduction", "external_rotation")
TIERS: tuple[str, ...] = ("full", "gentle", "rest")


def get(exercise_id: str | None) -> Exercise:
    """Registry lookup; anything unknown falls back to the shipped `flexion` entry so an old
    client that opens `/ws/session?mode=arm` with no exercise behaves exactly as before."""
    return EXERCISES.get(str(exercise_id or ""), EXERCISES[DEFAULT_ID])


def resolve(exercise: str | Exercise | None, tier: str = "full") -> Exercise:
    """The entry as the tier prescribes it. `gentle` applies the entry's own overrides; the
    ceiling is never raised by a tier."""
    ex = exercise if isinstance(exercise, Exercise) else get(exercise)
    if tier != "gentle" or not ex.gentle:
        return ex
    over = {k: v for k, v in ex.gentle.items() if k in {f.name for f in ex.__dataclass_fields__.values()}}
    if "target_deg" in over:
        over["target_deg"] = min(float(over["target_deg"]), ex.ceiling_deg)
    return replace(ex, **over)
