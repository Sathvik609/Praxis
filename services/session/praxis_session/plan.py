"""Today's plan: which exercises the guided flow offers, at what dose (no OpenCV here).

The pain tier is a **rule, not a diagnosis**, and it is applied in code, never by the coach:

| pain today | tier   | what the patient gets                                               |
|------------|--------|---------------------------------------------------------------------|
| 0-3        | full   | every exercise in the registry, full range, full holds               |
| 4-6        | gentle | pendulum, flexion, abduction to 60°, external rotation; short holds  |
| >= 7       | rest   | nothing today, rest advice; the pain stop rule raises the flag       |

The `>= 7` case does not itself write a therapist flag: the existing pain stop rule
(`stop_rules.py`, threshold from the prescription) does that when the same number arrives at
check-in, so there is exactly one place that flags pain.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable

from praxis_session.perception.exercises import EXERCISES, GENTLE_IDS, ORDER, resolve

REST_ADVICE = (
    "Pain of 7 or more today. Rest the arm, ice it if that helps, and we'll try again "
    "tomorrow. Your therapist has been told."
)
FULL_MAX, GENTLE_MAX = 3, 6


def tier_for(pain: int) -> str:
    if pain <= FULL_MAX:
        return "full"
    return "gentle" if pain <= GENTLE_MAX else "rest"


def tier_reason(tier: str, pain: int) -> str:
    if tier == "full":
        return f"Pain {pain} today: the full program, full range and holds."
    if tier == "gentle":
        return (
            f"Pain {pain} today: a gentle set — four exercises, shorter holds, fewer reps, "
            "and nothing above shoulder height."
        )
    return f"Pain {pain} today: a rest day. No exercises."


def _weeks_since(iso: str | None) -> int:
    if not iso:
        return 1
    try:
        started = datetime.fromisoformat(iso)
    except ValueError:
        return 1
    return max(0, (datetime.now() - started).days) // 7 + 1


def goal_line(profile: dict[str, Any] | None) -> str:
    goal = (profile or {}).get("goal") or "your goal"
    week = _weeks_since((profile or {}).get("created_at"))
    return f"Toward {goal}: shoulder range, week {week}"


def _done_ids(sessions_today: Iterable[dict[str, Any]]) -> set[str]:
    """An exercise counts as done when a session for it finished today (`status` complete)."""
    return {
        str(s.get("exercise"))
        for s in sessions_today or []
        if s.get("exercise") and s.get("status") == "complete"
    }


def items_for(tier: str, done: set[str]) -> list[dict[str, Any]]:
    if tier == "rest":
        return []
    ids = ORDER if tier == "full" else GENTLE_IDS
    out = []
    for ex_id in ids:
        ex = resolve(EXERCISES[ex_id], tier)
        out.append(ex.to_dict() | {"done_today": ex_id in done})
    return out


def today(
    profile: dict[str, Any] | None,
    pain: int | None = None,
    sessions_today: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    """The Today screen's whole payload. `pain` overrides the profile's last answer (the daily
    pain check); without either we assume 0 and show the full program."""
    if pain is None:
        pain = int((profile or {}).get("pain_last") or 0)
    pain = max(0, min(10, int(pain)))
    tier = tier_for(pain)
    return {
        "tier": tier,
        "tier_reason": tier_reason(tier, pain),
        "goal_line": goal_line(profile),
        "items": items_for(tier, _done_ids(sessions_today)),
        "rest_advice": REST_ADVICE if tier == "rest" else None,
        # Extras the guided screens use; the contract's five keys above are unchanged.
        "pain": pain,
        "side": (profile or {}).get("side", "left"),
    }
