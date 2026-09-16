"""Illustrative seed matching the wireframes (Alex M., Dr. Rao, Hospital GRASP L2 v3).

Loaded once into an empty store. Every number here is illustrative and labeled so in the UI.
"""
from __future__ import annotations

from praxis_session.prescription import SEED_PRESCRIPTION

PATIENT = {
    "id": "alex",
    "name": "Alex M.",
    "initial": "A",
    "side": "left",
    "goal": "Use a cup on my own.",
    "goal_attempts": 2,
    "program_code": "GR-4471-L2",
    "program": {
        "label": "Hospital GRASP, Level 2 · Left side",
        "short": "Hospital GRASP L2 · v3 · Dr. Rao",
        "clinician": SEED_PRESCRIPTION.clinician,
        "next_visit": "Thu 18 Sep, 2:30 PM",
        "level": 2,
        "version": 3,
    },
}

# (date iso, total_s) — six assessments, same board and camera setup
NHPT_TREND = [
    ("2026-08-01", 68.0), ("2026-08-10", 61.5), ("2026-08-19", 55.2),
    ("2026-08-28", 49.0), ("2026-09-05", 44.0), ("2026-09-12", 41.2),
]


def _summary(mode, camera, notes, exertion="low", flags=(), stopped=False, nhpt=None):
    s = {
        "mode": mode,
        "camera": camera,
        "told_us": {},
        "exertion": {"level": exertion, "reasons": [], "method": "behavioural"},
        "coach": {"label": "Rule-based coach · LLM agent pending", "notes": notes, "decisions": len(notes) * 3},
        "flags": list(flags),
        "stopped": stopped,
        "delivery": "queued · not yet delivered",
    }
    if nhpt is not None:
        s["camera"]["nhpt_total_s"] = nhpt
    return s


SESSIONS = [
    {
        "id": "s-0908-arm", "mode": "arm", "started_at": "2026-09-08T10:02:00", "ended_at": "2026-09-08T10:09:00",
        "status": "ended_early", "tracking": "usable", "title": "Arm to the front",
        "checkin": {"pain_before": 3, "energy": "tired", "minutes": 14, "new_symptoms": False},
        "feedback": {"pain_after": 5, "effort": 7, "compared": "harder"},
        "summary": _summary("arm", {"reps_total": 6, "verified": 5, "unverified": 1, "corrections": 2, "coverage_pct": 91, "posture_cues": 1, "active_s": 380},
                            [{"text": "stop: pain 5/10 during Arm to the front, rep 6 of set 2", "confidence": "high", "evidence": [41]}],
                            exertion="high", flags=[{"t": 380.0, "rule": "pain", "detail": "pain 5/10 reported (stop level 5)"}], stopped=True),
        "events": [],
    },
    {
        "id": "s-0910-cup", "mode": "cup", "started_at": "2026-09-10T09:30:00", "ended_at": "2026-09-10T09:41:00",
        "status": "complete", "tracking": "limited", "title": "Waiter – cup",
        "checkin": {"pain_before": 2, "energy": "comfortable", "minutes": 14, "new_symptoms": False},
        "feedback": {"pain_after": 2, "effort": 4, "compared": "same"},
        "summary": _summary("cup", {"reps_total": 14, "verified": 8, "unverified": 6, "corrections": 3, "coverage_pct": 62, "posture_cues": 0, "active_s": 540},
                            [{"text": "correct: six reaches could not be verified (markers lost); not comparable", "confidence": "medium", "evidence": [12, 15]}]),
        "events": [],
    },
    {
        "id": "s-0912-nhpt", "mode": "nhpt", "started_at": "2026-09-12T09:00:00", "ended_at": "2026-09-12T09:02:00",
        "status": "complete", "tracking": "usable", "title": "Nine-Hole Peg Test · 41.2 s",
        "checkin": {"pain_before": 2, "energy": "comfortable", "minutes": 14, "new_symptoms": False},
        "feedback": {"pain_after": 2, "effort": 3, "compared": "easier"},
        "summary": _summary("nhpt", {"reps_total": 9, "verified": 9, "unverified": 0, "corrections": 0, "coverage_pct": 100, "posture_cues": 0, "active_s": 41, "splits_s": [5.1, 4.4, 4.6, 4.9, 4.2, 4.5, 4.8, 4.3, 4.4]},
                            [{"text": "instruct: all nine seated, 2.8 s faster than last week", "confidence": "high", "evidence": [9]}], nhpt=41.2),
        "events": [],
    },
    {
        "id": "s-0912-cuparm", "mode": "cup", "started_at": "2026-09-12T09:05:00", "ended_at": "2026-09-12T09:19:00",
        "status": "complete", "tracking": "usable", "title": "Waiter – cup + Arm to the front",
        "checkin": {"pain_before": 2, "energy": "comfortable", "minutes": 14, "new_symptoms": False},
        "feedback": {"pain_after": 2, "effort": 4, "compared": "same"},
        "summary": _summary("cup", {"reps_total": 20, "verified": 17, "unverified": 3, "corrections": 2, "coverage_pct": 86, "posture_cues": 2, "active_s": 702,
                                    "reach_ms": [1420, 1380, 1290, 1210, 1180, 1250, 1300, 1150, 900, 980, 940, 910, 870, 990, 950, 900],
                                    "reach_verified": [True, True, True, False, True, True, True, True, True, False, True, True, True, False, True, True],
                                    "peak_deg": [88, 89, 90, 87, 90, 90, 89, 88, 90, 90, 88, 90, 90, 89, 90, 90],
                                    "peak_verified": [True, True, True, True, True, True, True, True, False, True, True, True, True, True, True, True]},
                            [{"text": "progress: reach time fell across the slow arcs; fast arcs accepted by patient and completed without drops", "confidence": "high", "evidence": [22, 31]},
                             {"text": "correct: trunk lean appeared in 2 of 16 lifts, late in set 2. Hold time kept at 3 s; no change made", "confidence": "medium", "evidence": [58, 61]},
                             {"text": "instruct: no shoulder hiking observed this session (3 events last session)", "confidence": "high", "evidence": [64]}],
                            flags=[{"t": 610.0, "rule": "lean", "detail": "trunk lean > 12° in 2 lifts, late set 2 (below flag threshold; logged)"}]),
        "events": [],
    },
]
