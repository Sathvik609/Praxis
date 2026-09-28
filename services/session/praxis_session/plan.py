"""Today's plan: the default day order and the pain tier (no OpenCV here).

Pain tiers locked on 23 Sep 2026, default day on 28 Sep 2026. The tier is a **rule in code, not a diagnosis and not the coach's call**:

| pain at check-in | tier   | what the patient gets                                                   |
|------------------|--------|-------------------------------------------------------------------------|
| 0-3              | full   | the day at the prescribed dose                                          |
| 4-6              | gentle | the same day, reduced dose/range within the allowed adaptations          |
| >= 7             | rest   | nothing today; the pain stop rule ends the session and flags the therapist |

Default day (~10 min, 28 Sep): Arm out to the side -> Waiter – cup. The Nine-Hole Peg Test is
weekly. Pendulum, Arm to the front, Rotate out and Rotate in are hidden (`visible=False` in the
registry): dormant code, never scheduled, so `demo` is always empty now.

The rest threshold is `min(7, prescription.stop_rules.pain_max)`: a therapist can make it
stricter, never looser. The seed prescription's `pain_max` is 7, so the `>= 7` flag is written
by exactly one place, the pain stop rule (`stop_rules.py`), when the same number arrives at
check-in. The service also enforces the tier on the live session (`main._handle_command` ->
`SessionPipeline.apply_tier`), so a client that asks for `full` with pain 5 still runs gentle.
"""

from __future__ import annotations

from typing import Any

from praxis_session.perception.exercises import DEMO_IDS, EXERCISES, resolve
from praxis_session.prescription import SEED_PRESCRIPTION, Prescription

FULL_MAX = 3  # 0-3 full
GENTLE_MAX = 6  # 4-6 gentle
REST_AT = 7  # >= 7 rest + therapist flag
DAY_ORDER: tuple[str, ...] = ("abduction", "cup")
WEEKLY: tuple[str, ...] = ("nhpt",)
DAY_MINUTES = 10
TIER_RANK: dict[str, int] = {"full": 0, "gentle": 1, "rest": 2}
REST_ADVICE = (
    "Pain of 7 or more today. Rest the arm and try again tomorrow. "
    "Your therapist has been told."
)


def rest_at(prescription: Prescription | None = None) -> int:
    rx = SEED_PRESCRIPTION if prescription is None else prescription
    return min(REST_AT, int(rx.stop_rules.pain_max))


def tier_for(pain: int, prescription: Prescription | None = None) -> str:
    """`full | gentle | rest` for a 0-10 pain score (clamped)."""
    p = max(0, min(10, int(pain)))
    if p >= rest_at(prescription):
        return "rest"
    return "full" if p <= FULL_MAX else "gentle"


def stricter(a: str, b: str) -> str:
    """The more careful of two tiers; a tier from the check-in can tighten a session, never
    loosen it."""
    return a if TIER_RANK[a] >= TIER_RANK[b] else b


def tier_reason(tier: str, pain: int) -> str:
    if tier == "full":
        return f"Pain {pain} today: the full day at your prescribed dose."
    if tier == "gentle":
        return (
            f"Pain {pain} today: a gentle day. Fewer reps, shorter holds, the side lift to 60°, "
            "and no fast arcs, all inside what your therapist allows."
        )
    return f"Pain {pain} today: a rest day. No exercises."


def _shown(ids: tuple[str, ...]) -> list[str]:
    return [i for i in ids if EXERCISES[i].visible]


def day_plan(pain: int = 0, prescription: Prescription | None = None, nhpt_due: bool = True) -> dict[str, Any]:
    """The day in order at the tier's dose. `items` are the camera-coached day, `weekly` the
    peg test when it is due, `demo` any visible self-ticked exercise (none since 28 Sep). A rest
    day has none of them. A hidden exercise is never scheduled, whatever the order says."""
    rx = SEED_PRESCRIPTION if prescription is None else prescription
    p = max(0, min(10, int(pain)))
    tier = tier_for(p, rx)
    rest = tier == "rest"

    def item(ex_id: str, **extra: Any) -> dict[str, Any]:
        return resolve(EXERCISES[ex_id], tier, rx).to_dict() | {"tier": tier} | extra

    return {
        "pain": p,
        "tier": tier,
        "reason": tier_reason(tier, p),
        "minutes": 0 if rest else DAY_MINUTES,
        "items": [] if rest else [item(i, order=n + 1) for n, i in enumerate(_shown(DAY_ORDER))],
        "weekly": [] if rest or not nhpt_due else [item(i) for i in _shown(WEEKLY)],
        "demo": [] if rest else [EXERCISES[i].to_dict() | {"tier": tier} for i in _shown(DEMO_IDS)],
        "rest_advice": REST_ADVICE if rest else None,
        "therapist_flag": rest,
    }
