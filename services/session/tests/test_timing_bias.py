"""Timing must not depend on the confirmation delay (11 Oct 2026 review).

Debounce and stationary confirmation decide *whether* a peg is seated or a cup is placed; the
*time* of the event is the first frame of the confirmed run. Before this fix the NHPT stop and
the cup placement were stamped on the confirming frame, so both carried a systematic bias of
(debounce - 1) or (clear_frames - 1) frame periods that changed with the frame rate (dataset_v0:
NHPT +0.2 s, every reach +200 ms at 10 fps).
"""

import pytest

from praxis_session.perception.board_spec import CUP_TARGETS
from praxis_session.perception.cup import CupFSM, CupObservation
from praxis_session.perception.nhpt import NHPT
from praxis_session.perception.peg_fsm import Observation
from tests.test_peg_fsm import transfer

D = CUP_TARGETS.targets_mm


@pytest.mark.parametrize("debounce", [1, 2, 3])
def test_nhpt_total_time_does_not_depend_on_the_debounce(debounce):
    n = NHPT(debounce_frames=debounce, clear_frames=1)
    order = [4, 0, 8, 2, 6, 1, 7, 3, 5]
    seated: tuple[int, ...] = ()
    evs = []
    for i, hole in enumerate(order):
        evs += [e for t, o, free in transfer(i * 2.0, hole, seated) for e in n.step(Observation(t=t, occupancy=o, free_pegs_mm=free))]
        seated = (*seated, hole)
    done = next(e for e in evs if e.type == "nhpt_complete")
    assert done.payload["total_s"] == pytest.approx(16.8 - 0.2)  # first lift -> ninth seat
    reps = [e for e in evs if e.type == "rep_complete"]
    assert reps[0].payload["t_seated"] == pytest.approx(0.8)
    assert reps[0].payload["duration_s"] == pytest.approx(0.6)


def _reach(fps: float, clear_frames: int = 3) -> float:
    fsm = CupFSM(clear_frames=clear_frames)
    dt = 1.0 / fps
    t = 0.0
    evs = []

    def step(cup, until):
        nonlocal t
        while t < until - 1e-9:
            evs.extend(fsm.step(CupObservation(t=round(t, 6), cup_mm=cup, hand_mm=None, calibrated=True)))
            t += dt

    step(D[0], 1.0)  # resting on dot 1
    step(None, 1.5)  # lifted at t = 1.0 (base hidden)
    step(D[1], 3.0)  # arrives on dot 2 at t = 1.5 and stays
    r = [e for e in evs if e.type == "reach_complete"]
    assert len(r) == 1
    return r[0].payload["reach_ms"]


@pytest.mark.parametrize("fps", [10.0, 15.0, 30.0])
def test_cup_reach_time_is_lift_to_arrival_at_any_frame_rate(fps):
    assert _reach(fps) == pytest.approx(500.0, abs=1000.0 / fps + 1.0)  # within one frame of the truth


def test_cup_placement_still_needs_the_stationary_frames():
    fsm = CupFSM(clear_frames=3)
    fsm.step(CupObservation(t=0.0, cup_mm=D[0], hand_mm=None, calibrated=True))
    fsm.step(CupObservation(t=0.1, cup_mm=None, hand_mm=None, calibrated=True))
    evs = fsm.step(CupObservation(t=0.2, cup_mm=D[1], hand_mm=None, calibrated=True))
    evs += fsm.step(CupObservation(t=0.3, cup_mm=D[1], hand_mm=None, calibrated=True))
    assert fsm.state == "over_dot" and not any(e.payload.get("to") == "placed" for e in evs)
    evs = fsm.step(CupObservation(t=0.4, cup_mm=D[1], hand_mm=None, calibrated=True))
    placed = [e for e in evs if e.payload.get("to") == "placed"]
    assert placed and placed[0].t == pytest.approx(0.4) and placed[0].payload["t_placed"] == pytest.approx(0.2)
