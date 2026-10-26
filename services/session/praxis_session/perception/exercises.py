"""Exercise registry (OpenCV cv2.__version__ == 5.0.0): the 28 Sep 2026 lock.

Seven entries, of which **three are visible** (28 Sep, supersedes the 23 Sep seven): Arm out
to the side, Waiter – cup and the Nine-Hole Peg Test. The other four are `visible=False`:
their code, clips, GLB actions and perception tests stay, dormant, so the decision is
reversible, but nothing may show, schedule, self-tick, replay or run them (the socket refuses
them with `not_offered`). Depth over breadth: 300+ real reps are feasible on three.

| group    | id                | name                | camera                                     | visible |
|----------|-------------------|---------------------|--------------------------------------------|---------|
| exercise | pendulum          | Pendulum (warm-up)  | coached, side view, arm FSM (oscillation)  | hidden  |
| exercise | flexion           | Arm to the front    | coached, side view, arm FSM                | hidden  |
| exercise | abduction         | Arm out to the side | coached, front view, arm FSM               | yes     |
| activity | cup               | Waiter – cup        | coached, 5-dot sheet, cup FSM              | yes     |
| activity | nhpt              | Nine-Hole Peg Test  | coached, board sheet, peg FSM (weekly)     | yes     |
| demo     | external_rotation | Rotate out          | **demo only**: avatar + patient self-tick  | hidden  |
| demo     | internal_rotation | Rotate in           | **demo only**: avatar + patient self-tick  | hidden  |

`get()` still falls back to `flexion` so the dormant perception code and its tests behave as
they always did; the service boundary (`main.py`) runs `DEFAULT_VISIBLE_ID` instead.

`mode="coached"` entries are verified from OpenCV events only. `mode="demo"` entries have no
metric and no pipeline, so nothing can produce a camera-verified rep for them: a single webcam
cannot honestly measure a forearm that rotates toward it. Scaption (indistinguishable from
abduction in the front view) and extension (small, noisy range) were dropped on 23 Sep.

For the arm-FSM entries the registry says which camera view the exercise needs, which
camera-relative metric scores it (the functions live in `pose.py` and run on the BlazePose
landmarks the tracker returns), its target and hard ceiling in code, its dose and the
paraphrased steps shown to the patient. `arm_fsm.ArmFSM` is driven entirely by an entry, so
adding a lift never touches the state machine. Every number is **camera-relative progress in
the image plane, never clinical goniometry**; pendulum counting is validated on synthetic
landmark streams only.

The gentle pain tier (`resolve(..., "gentle")`) applies an entry's `gentle` overrides **only
where the prescription's `allowed_adaptations` allow the field, clamped into the allowed
range** (`prescription.clamp`); a tier never raises a ceiling. The default day order and the
pain tiers themselves live in `praxis_session/plan.py`.

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
    shoulder_elevation_deg,
)
from praxis_session.prescription import SEED_PRESCRIPTION, Prescription, clamp

Metric = Callable[[PoseResult, str], float]
View = Literal["side", "front", "sheet"]
Kind = Literal["hold", "oscillation", "arcs", "timed"]
Mode = Literal["coached", "demo"]
Category = Literal["exercise", "activity"]
Pipeline = Literal["arm", "cup", "nhpt"]
Frequency = Literal["daily", "weekly"]

# Optional targets from the labeled reference set. The file is produced by `evaluation/`; the
# registry works without it and falls back to the constants below.
REFERENCE_PATH = Path(__file__).resolve().parents[3] / "evaluation" / "results" / "rehab_reference_ranges.json"


@dataclass(frozen=True)
class Exercise:
    id: str
    name: str
    clip: str  # avatar clip the web can play (`CLIPS` or `REHAB_CLIPS` in web/src/avatar)
    view: View
    metric: Metric | None = field(default=None, compare=False, repr=False)
    mode: Mode = "coached"
    visible: bool = True  # 28 Sep: False = dormant (kept in code, never shown, scheduled or run)
    category: Category = "exercise"
    pipeline: Pipeline | None = "arm"  # which camera pipeline verifies it; None = demo only
    frequency: Frequency = "daily"
    rx_key: str = ""  # prescription key when it differs from `id` (flexion -> "arm")
    target_deg: float = 90.0
    ceiling_deg: float = 90.0
    tolerance_deg: float = 10.0
    start_below_deg: float = 25.0
    hold_s: float = 3.0
    sets: int = 2
    reps: int = 8
    kind: Kind = "hold"
    slow_arcs: int = 0
    fast_arcs: int = 0
    gentle: dict[str, Any] = field(default_factory=dict)
    steps: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.mode == "demo" and (self.pipeline is not None or self.metric is not None):
            raise ValueError(f"{self.id}: a demo-only exercise has no camera pipeline and no metric")
        if self.pipeline == "arm" and self.metric is None:
            raise ValueError(f"{self.id}: an arm-FSM exercise needs a metric")

    @property
    def rx(self) -> str:
        """The prescription key this entry's dose and allowed adaptations live under."""
        return self.rx_key or self.id

    @property
    def group(self) -> str:
        """The heading the exercise list files it under: exercise, activity or demo."""
        return "demo" if self.mode == "demo" else self.category

    @property
    def dose(self) -> str:
        if self.kind == "timed":
            return "One timed try"
        if self.kind == "arcs":
            if not self.fast_arcs:
                return f"{self.slow_arcs} slow arcs only"
            return f"{self.slow_arcs} slow arcs, then {self.fast_arcs} fast"
        if self.kind == "oscillation":
            return f"{self.sets} × {self.reps} swings"
        return f"{self.sets} sets of {self.reps} · hold {self.hold_s:g} s"  # same words as the web library (24 Oct)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "clip": self.clip,
            "view": self.view,
            "mode": self.mode,
            "visible": self.visible,
            "category": self.category,
            "group": self.group,
            "pipeline": self.pipeline,
            "frequency": self.frequency,
            "kind": self.kind,
            "camera_verified": self.mode == "coached",
            "self_ticked": self.mode == "demo",
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
    "cup": [
        "Sit at the table with the printed five-dot sheet in front of you, cup in your practising hand.",
        "Keep the cup off the sheet until the camera finds all four corners, then put it on dot 1 and rest your hand in your lap.",
        "Reach, lift the cup and set it down on the next dot, one dot at a time.",
        "After dot 5 come back the same way. Two slow arcs, then two as quick as feels safe.",
    ],
    "nhpt": [
        "Board on its printed sheet, the nine pegs in the dish on your practising side.",
        "When you're ready, pick up the first peg: the timer starts on that lift.",
        "Put the pegs in any holes, one at a time, as quickly as you comfortably can.",
        "The timer stops when the ninth peg is seated. Once a week is enough.",
    ],
    "external_rotation": [
        "Sit tall, elbow tucked against your side and bent to a right angle.",
        "Keeping the elbow against you, swing the forearm outward, away from your tummy.",
        "Hold, then return slowly.",
        "The elbow stays glued to your side the whole time.",
    ],
    "internal_rotation": [
        "Sit tall, elbow tucked against your side and bent to a right angle.",
        "Keeping the elbow against you, bring the forearm across toward your tummy.",
        "Hold, then return slowly.",
        "Small and slow beats big and fast.",
    ],
}

_BASE: tuple[Exercise, ...] = (
    Exercise(
        id="pendulum", name="Pendulum", clip="pendulum", view="side", metric=pendulum_swing_deg,
        visible=False, target_deg=20.0, ceiling_deg=45.0, tolerance_deg=5.0, start_below_deg=5.0,
        hold_s=0.0, sets=2, reps=10, kind="oscillation",
        gentle={"reps": 8}, steps=_STEPS["pendulum"],
    ),
    Exercise(
        id="flexion", name="Arm to the front", clip="armFront", view="side", rx_key="arm", visible=False,
        metric=shoulder_elevation_deg, target_deg=90.0, ceiling_deg=90.0, tolerance_deg=10.0,
        start_below_deg=25.0, hold_s=3.0, sets=2, reps=8,
        gentle={"hold_s": 2.0, "reps": 6}, steps=_STEPS["flexion"],
    ),
    Exercise(
        id="abduction", name="Arm out to the side", clip="abduction", view="front",
        metric=shoulder_elevation_deg, target_deg=90.0, ceiling_deg=90.0, tolerance_deg=10.0,
        start_below_deg=25.0, hold_s=3.0, sets=2, reps=8,
        gentle={"target_deg": 60.0, "hold_s": 2.0, "reps": 6}, steps=_STEPS["abduction"],
    ),
    Exercise(
        id="cup", name="Waiter – cup", clip="cup", view="sheet", category="activity", pipeline="cup",
        kind="arcs", slow_arcs=2, fast_arcs=2, sets=1, reps=4, hold_s=0.0,
        gentle={"fast_arcs": 0}, steps=_STEPS["cup"],
    ),
    Exercise(
        id="nhpt", name="Nine-Hole Peg Test", clip="nhpt", view="sheet", category="activity",
        pipeline="nhpt", frequency="weekly", kind="timed", sets=1, reps=9, hold_s=0.0,
        steps=_STEPS["nhpt"],
    ),
    Exercise(
        id="external_rotation", name="Rotate out", clip="external_rotation", view="front",
        mode="demo", visible=False, pipeline=None, sets=2, reps=8, hold_s=3.0,
        steps=_STEPS["external_rotation"],
    ),
    Exercise(
        id="internal_rotation", name="Rotate in", clip="internal_rotation", view="front",
        mode="demo", visible=False, pipeline=None, sets=2, reps=8, hold_s=3.0,
        steps=_STEPS["internal_rotation"],
    ),
)


def build_registry(ranges: dict[str, float] | None = None, items: tuple[Exercise, ...] = _BASE) -> dict[str, Exercise]:
    """The registry with reference targets applied where we have them. `None` reads the file;
    `{}` keeps every constant above. A reference can only lower a target, never raise the
    ceiling, and only arm-FSM entries have a target to lower."""
    ranges = load_reference_ranges() if ranges is None else ranges
    out: dict[str, Exercise] = {}
    for ex in items:
        ref = ranges.get(ex.id) if ex.pipeline == "arm" else None
        out[ex.id] = ex if ref is None else replace(ex, target_deg=min(float(ref), ex.ceiling_deg))
    return out


EXERCISES: dict[str, Exercise] = build_registry()
ORDER: tuple[str, ...] = tuple(ex.id for ex in _BASE)
DEMO_IDS: tuple[str, ...] = tuple(ex.id for ex in _BASE if ex.mode == "demo")
VISIBLE_IDS: tuple[str, ...] = tuple(ex.id for ex in _BASE if ex.visible)
HIDDEN_IDS: tuple[str, ...] = tuple(ex.id for ex in _BASE if not ex.visible)
DEFAULT_ID = "flexion"  # dormant perception default (see the module docstring)
DEFAULT_VISIBLE_ID = "abduction"  # what a bare `/session?mode=arm` runs since 28 Sep
TIERS: tuple[str, ...] = ("full", "gentle", "rest")
RUNNABLE_TIERS: tuple[str, ...] = ("full", "gentle")


def get(exercise_id: str | None) -> Exercise:
    """Registry lookup; anything unknown falls back to the shipped `flexion` entry so an old
    client that opens `/session?mode=arm` with no exercise behaves exactly as before."""
    return EXERCISES.get(str(exercise_id or ""), EXERCISES[DEFAULT_ID])


def resolve(exercise: str | Exercise | None, tier: str = "full", prescription: Prescription | None = None) -> Exercise:
    """The entry as the tier prescribes it. `full` is the entry itself. `gentle` applies the
    entry's own overrides, but only for fields the prescription lists under
    `allowed_adaptations[ex.rx]`: a `[lo, hi]` range is clamped with `prescription.clamp`
    (which also honours the prescribed ceiling), `True` allows the value as is, anything else
    drops the override. `rest` is not runnable: there is no exercise on a rest day.
    `prescription=None` means the seed prescription."""
    if tier not in RUNNABLE_TIERS:
        raise ValueError(f"tier {tier!r} has no exercise to run")
    ex = exercise if isinstance(exercise, Exercise) else get(exercise)
    if tier != "gentle" or not ex.gentle:
        return ex
    rx = SEED_PRESCRIPTION if prescription is None else prescription
    allowed = rx.allowed_adaptations.get(ex.rx, {})
    names = {f.name for f in ex.__dataclass_fields__.values()}
    over: dict[str, Any] = {}
    for key, value in ex.gentle.items():
        rng = allowed.get(key)
        if key not in names or rng is None or rng is False:
            continue
        if rng is True:
            over[key] = value
            continue
        clamped = clamp(rx, ex.rx, key, float(value))
        over[key] = int(round(clamped)) if isinstance(getattr(ex, key), int) else clamped
    if "target_deg" in over:
        over["target_deg"] = min(float(over["target_deg"]), ex.ceiling_deg)
    return replace(ex, **over)
