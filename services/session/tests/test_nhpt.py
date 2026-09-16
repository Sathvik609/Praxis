from praxis_session.perception.nhpt import NHPT
from praxis_session.perception.peg_fsm import Observation
from tests.test_peg_fsm import transfer


def run(n: NHPT, seq):
    out = []
    for t, o, free in seq:
        out += n.step(Observation(t=t, occupancy=o, free_pegs_mm=free))
    return out


def test_timer_runs_from_first_lift_to_ninth_seat_with_splits():
    n = NHPT(debounce_frames=1, clear_frames=1)
    order = [4, 0, 8, 2, 6, 1, 7, 3, 5]
    seated: tuple[int, ...] = ()
    evs = []
    for i, hole in enumerate(order):
        evs += run(n, transfer(i * 2.0, hole, seated))
        seated = (*seated, hole)
    types = [e.type for e in evs]
    assert types.count("nhpt_start") == 1 and types.count("nhpt_split") == 9
    assert types.count("nhpt_complete") == 1
    done = next(e for e in evs if e.type == "nhpt_complete")
    # first lift at t=0.2 (source peg disappears), ninth seat at 8*2.0+0.8
    assert abs(done.payload["total_s"] - (16.8 - 0.2)) < 1e-6
    assert abs(sum(done.payload["splits_s"]) - done.payload["total_s"]) < 1e-6
    assert [p["hole"] for p in done.payload["pegs"]] == order
    assert n.completed and n.snapshot(20.0)["pegs_done"] == 9
    assert n.snapshot(20.0)["elapsed_s"] == done.payload["total_s"]
    # the FSM still fires the final rep_complete after completion
    assert types.count("rep_complete") == 9


def test_elapsed_before_start_is_zero_and_counts_after():
    n = NHPT(debounce_frames=1, clear_frames=1)
    assert n.snapshot(5.0)["elapsed_s"] == 0.0 and not n.started
    run(n, transfer(0.0, 4)[:3])
    assert n.started and abs(n.snapshot(1.2)["elapsed_s"] - 1.0) < 1e-6
