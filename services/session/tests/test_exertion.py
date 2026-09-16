from praxis_session.events import make_event
from praxis_session.exertion import Exertion
from praxis_session.prescription import SEED_PRESCRIPTION


def reps(durations, t0=0.0, kind="rep_complete", **extra):
    evs, t = [], t0
    for d in durations:
        t += d + 1.0
        evs.append(make_event(kind, t=t, duration_s=d, **extra))
    return evs


def test_low_when_steady_and_no_rpe():
    ex = Exertion(SEED_PRESCRIPTION)
    state = ex.update(reps([2.0] * 8))
    assert state["level"] == "low" and state["method"] == "behavioural" and state["reasons"] == []


def test_slowing_reps_and_high_rpe_raise_level():
    ex = Exertion(SEED_PRESCRIPTION)
    state = ex.update(reps([2.0, 2.2, 2.5, 2.9, 3.4, 4.0, 4.8, 5.6]))
    assert state["level"] in ("moderate", "high") and any("slow" in r for r in state["reasons"])
    state = ex.update([], rpe=8)
    assert state["level"] == "high" and any("RPE" in r for r in state["reasons"])


def test_falling_peak_angles_and_tremor_add_reasons():
    ex = Exertion(SEED_PRESCRIPTION)
    arm = [make_event("rep_complete", t=i * 8.0, peak_deg=92 - i * 3, hold_s=3.0, verified=True, set=1, rep=i + 1) for i in range(8)]
    frames = [make_event("frame", t=60 + i, hand={"present": True, "tremor_ratio": 0.7, "tremor_hz": 8.0}) for i in range(5)]
    state = ex.update(arm + frames)
    assert any("peak" in r for r in state["reasons"]) and any("tremor" in r for r in state["reasons"])
    assert state["level"] == "high"


def test_high_for_seconds_tracks_duration():
    ex = Exertion(SEED_PRESCRIPTION)
    ex.update([], rpe=9, t=0.0)
    assert ex.high_for_s(10.0) == 10.0
    ex.update([], rpe=2, t=20.0)
    assert ex.high_for_s(25.0) == 0.0
