"""NHPT = pegboard FSM in test mode: timer from first-peg lift to ninth-peg seated, per-peg splits."""
from __future__ import annotations

from praxis_session.perception.board_spec import BOARD
from praxis_session.perception.nhpt import NHPT
from praxis_session.perception.pegboard_fsm import Observation

EMPTY = {f"hole_{k}": "empty" for k in range(9)}
SRC = (160.0, 148.5)


def occ(*occupied: int) -> dict[str, str]:
    d = dict(EMPTY)
    for k in occupied:
        d[f"hole_{k}"] = "occupied"
    return d


def place_all(nhpt: NHPT, per_peg_s: float = 1.0, t0: float = 10.0, order=range(9)):
    """Simulate nine transfers: lift at t, seat at t+0.6, clear at t+0.8."""
    events = []
    done: list[int] = []
    t = t0
    events += nhpt.step(Observation(t - 0.5, occ(*done), [SRC]))
    for k in order:
        events += nhpt.step(Observation(t, occ(*done), []))                       # lift
        events += nhpt.step(Observation(t + 0.3, occ(*done), [(120.0, 148.5)]))    # transit
        done.append(k)
        events += nhpt.step(Observation(t + 0.6, occ(*done), []))                 # seated
        events += nhpt.step(Observation(t + 0.8, occ(*done), [SRC]))              # clear, next peg visible
        t += per_peg_s
    return events


def test_timer_starts_at_first_lift_and_stops_at_ninth_seat() -> None:
    nhpt = NHPT(debounce_frames=1, clear_frames=1)
    ev = place_all(nhpt, per_peg_s=1.0, t0=10.0)
    types = [e.type for e in ev]
    assert types.count("nhpt_start") == 1
    assert types.count("nhpt_complete") == 1
    start = next(e for e in ev if e.type == "nhpt_start")
    done = next(e for e in ev if e.type == "nhpt_complete")
    assert start.t == 10.0
    assert done.t == 18.6                    # 9th lift at 18.0, seated at 18.6
    assert abs(done.payload["total_s"] - 8.6) < 1e-9
    assert nhpt.completed is True
    assert nhpt.total_s == done.payload["total_s"]


def test_per_peg_splits_are_reported() -> None:
    nhpt = NHPT(debounce_frames=1, clear_frames=1)
    ev = place_all(nhpt, per_peg_s=2.0, t0=0.0)
    splits = [e for e in ev if e.type == "nhpt_split"]
    assert len(splits) == 9
    assert [s.payload["peg"] for s in splits] == list(range(1, 10))
    # First split: lift at 0.0 -> seated at 0.6. Later splits: seated-to-seated = 2.0 s.
    assert abs(splits[0].payload["split_s"] - 0.6) < 1e-9
    assert all(abs(s.payload["split_s"] - 2.0) < 1e-9 for s in splits[1:])
    assert abs(splits[-1].payload["elapsed_s"] - 16.6) < 1e-9
    done = next(e for e in ev if e.type == "nhpt_complete")
    assert len(done.payload["splits_s"]) == 9
    assert [s["hole"] for s in done.payload["pegs"]] == list(range(9))


def test_elapsed_is_live_before_completion_and_frozen_after() -> None:
    nhpt = NHPT(debounce_frames=1, clear_frames=1)
    assert nhpt.elapsed(5.0) == 0.0
    nhpt.step(Observation(0.0, occ(), [SRC]))
    nhpt.step(Observation(1.0, occ(), []))  # first lift
    assert nhpt.started is True
    assert abs(nhpt.elapsed(3.5) - 2.5) < 1e-9
    place_all(nhpt, per_peg_s=1.0, t0=2.0)
    assert nhpt.completed
    assert nhpt.elapsed(100.0) == nhpt.total_s


def test_nhpt_accepts_any_hole_order_and_never_reports_wrong_hole() -> None:
    nhpt = NHPT(debounce_frames=1, clear_frames=1)
    ev = place_all(nhpt, order=[8, 0, 4, 2, 6, 1, 7, 3, 5])
    assert not any(e.type == "wrong_hole" for e in ev)
    assert nhpt.completed


def test_snapshot_for_ui() -> None:
    nhpt = NHPT(debounce_frames=1, clear_frames=1)
    nhpt.step(Observation(0.0, occ(), [SRC]))
    s = nhpt.snapshot(t=0.0)
    assert s == {"mode": "nhpt", "state": "at_source", "started": False, "completed": False,
                 "pegs_done": 0, "elapsed_s": 0.0, "total_s": None, "target": None, "reps": 0,
                 "finished": False}
    assert len(BOARD.hole_centers_mm) == 9
