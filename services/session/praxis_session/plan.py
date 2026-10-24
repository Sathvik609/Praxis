"""Today's plan: the default day order and the pain tier (no OpenCV here).

Pain tiers locked on 23 Sep 2026, default day on 28 Sep 2026. The tier is a **rule in code, not a diagnosis and not the coach's call**:

| pain at check-in | tier   | what the patient gets                                                   |
|------------------|--------|-------------------------------------------------------------------------|
| 0-3              | full   | the day at the prescribed dose                                          |
| 4-6              | gentle | the same day, reduced dose/range within the allowed adaptations          |
| >= 7             | rest   | rest is advised and the check-in flags the therapist (so does new/worse symptoms) |

24 Oct 2026: at or above the stop level the patient sees a careful warning and may choose
**Continue gently** (`continue_gently=True`) instead of resting: the day then runs at the gentle
dose, the `checkin_pain` therapist flag is still written, and the in-session stop rules stay on.

Default day (~10 min, 28 Sep): Arm out to the side -> Waiter – cup. The Nine-Hole Peg Test is
weekly. Pendulum, Arm to the front, Rotate out and Rotate in are hidden (`visible=False` in the
registry): dormant code, never scheduled, so `demo` is always empty now.

The rest threshold is `min(7, prescription.stop_rules.pain_max)`: a therapist can make it
stricter, never looser. The seed prescription's `pain_max` is 7. The day's check-in
(`POST /api/checkin`, `checkin_outcome`) writes a `checkin_pain` therapist flag at or above it and
a `checkin_symptoms` flag for new or worse symptoms (both a rest day), once per patient, day and
reason; inside a session the pain stop rule (`stop_rules.py`) writes its own `pain` flag when the
same number arrives on the socket. The service also enforces the tier on the live session (`main._handle_command` ->
`SessionPipeline.apply_tier`), so a client that asks for `full` with pain 5 still runs gentle.
"""

from __future__ import annotations

from typing import Any

from praxis_session.perception.exercises import DEMO_IDS, EXERCISES, resolve
from praxis_session.prescription import SEED_PRESCRIPTION, Prescription

FULL_MAX = 3  # 0-3 full
GENTLE_MAX = 6  # 4-6 gentle
REST_AT = 7  # >= 7 rest (or gentle by choice) + therapist flag
DAY_ORDER: tuple[str, ...] = ("abduction", "cup")
WEEKLY: tuple[str, ...] = ("nhpt",)
DAY_MINUTES = 10
TIER_RANK: dict[str, int] = {"full": 0, "gentle": 1, "rest": 2}
SYMPTOMS_REASON = "New or worse symptoms today: a rest day. Check with your therapist before practising."
SYMPTOMS_ADVICE = "New or worse symptoms since last time. Rest the arm today and check with your therapist before practising."


def rest_at(prescription: Prescription | None = None) -> int:
    rx = SEED_PRESCRIPTION if prescription is None else prescription
    return min(REST_AT, int(rx.stop_rules.pain_max))


def tier_for(pain: int, prescription: Prescription | None = None, continue_gently: bool = False) -> str:
    """`full | gentle | rest` for a 0-10 pain score (clamped). At or above the stop level it is
    `rest`, or `gentle` when the patient chose to continue gently after the warning."""
    p = max(0, min(10, int(pain)))
    if p >= rest_at(prescription):
        return "gentle" if continue_gently else "rest"
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


def rest_advice(prescription: Prescription | None = None, symptoms: bool = False) -> str:
    """What a rest day tells the patient. The stop level is the prescription's, never a fixed 7.
    Whether the therapist was told is not claimed here: only a written flag says so
    (`/api/checkin`'s `flagged`, which the web turns into its own line)."""
    if symptoms:
        return SYMPTOMS_ADVICE
    return f"Pain of {rest_at(prescription)} or more today. Rest the arm and try again tomorrow."


def symptoms_rest(new_symptoms: bool, prescription: Prescription | None = None) -> bool:
    """New or worse symptoms make a rest day when the prescription's stop rules say so (the
    seed does), exactly as the in-session stop rule (`StopRules.on_checkin`)."""
    rx = SEED_PRESCRIPTION if prescription is None else prescription
    return bool(new_symptoms) and bool(rx.stop_rules.new_symptoms)


def day_plan(pain: int = 0, prescription: Prescription | None = None, nhpt_due: bool = True, new_symptoms: bool = False, continue_gently: bool = False) -> dict[str, Any]:
    """The day in order at the tier's dose. `items` are the camera-coached day, `weekly` the
    peg test when it is due, `demo` any visible self-ticked exercise (none since 28 Sep). A rest
    day has none of them. A hidden exercise is never scheduled, whatever the order says.
    New or worse symptoms (`symptoms_rest`) make a rest day whatever the pain."""
    rx = SEED_PRESCRIPTION if prescription is None else prescription
    p = max(0, min(10, int(pain)))
    symptoms = symptoms_rest(new_symptoms, rx) and tier_for(p, rx, continue_gently) != "rest"
    tier = "rest" if symptoms else tier_for(p, rx, continue_gently)
    rest = tier == "rest"

    def item(ex_id: str, **extra: Any) -> dict[str, Any]:
        return resolve(EXERCISES[ex_id], tier, rx).to_dict() | {"tier": tier} | extra

    return {
        "pain": p,
        "tier": tier,
        "reason": SYMPTOMS_REASON if symptoms else tier_reason(tier, p),
        "minutes": 0 if rest else DAY_MINUTES,
        "items": [] if rest else [item(i, order=n + 1) for n, i in enumerate(_shown(DAY_ORDER))],
        "weekly": [] if rest or not nhpt_due else [item(i) for i in _shown(WEEKLY)],
        "demo": [] if rest else [EXERCISES[i].to_dict() | {"tier": tier} for i in _shown(DEMO_IDS)],
        "rest_advice": rest_advice(rx, symptoms) if rest else None,
        "therapist_flag": rest or p >= rest_at(rx),
    }


def checkin_outcome(pain: int, new_symptoms: bool, prescription: Prescription | None = None, nhpt_due: bool = True, continue_gently: bool = False) -> dict[str, Any]:
    """The check-in, decided in code (`POST /api/checkin`): the tier, plain reasons, the therapist
    flags it calls for as `(rule, detail)` and the day's plan at that tier.

    - pain at or above the stop level (`rest_at`) -> rest + `checkin_pain` flag, or gentle + the
      same flag when the patient chose to continue gently (24 Oct);
    - new or worse symptoms (`symptoms_rest`) -> rest + `checkin_symptoms` flag, whatever the pain;
    - otherwise 0-3 full, 4-6 gentle, no flag.
    The flag rules are `checkin_*`, not the in-session `pain` / `symptoms` stop rules, so the
    therapist view never reads a check-in as "Session ended by stop rule"."""
    rx = SEED_PRESCRIPTION if prescription is None else prescription
    p = max(0, min(10, int(pain)))
    stop = rest_at(rx)
    plan = day_plan(p, rx, nhpt_due=nhpt_due, new_symptoms=new_symptoms, continue_gently=continue_gently)
    reasons: list[str] = []
    flags: list[tuple[str, str]] = []
    if p >= stop and continue_gently:
        reasons.append(f"pain {p}/10 is at or above your stop level ({stop}): you chose a lighter session; stop if it gets worse")
        flags.append(("checkin_pain", f"pain {p}/10 at check-in (stop level {stop}): chose to continue gently"))
    elif p >= stop:
        reasons.append(f"pain {p}/10 is at or above your stop level ({stop}): rest today")
        flags.append(("checkin_pain", f"pain {p}/10 at check-in (stop level {stop}): rest day"))
    if symptoms_rest(new_symptoms, rx):
        reasons.append("new or worse symptoms since last time: rest today and check with your therapist")
        flags.append(("checkin_symptoms", "new or worse symptoms reported at check-in: rest day"))
    if not reasons:
        reasons.append(tier_reason(plan["tier"], p))
    return {"tier": plan["tier"], "reasons": reasons, "flags": flags, "plan": plan}
