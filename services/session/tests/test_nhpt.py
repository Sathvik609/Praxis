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


EMPTY = {f"hole_{k}": "empty" for k in range(9)}
OCC3 = {f"hole_{k}": "occupied" if k == 3 else "empty" for k in range(9)}
SRC = [(160.0, 148.5)]


def test_time_based_debounce_ignores_100ms_flicker_at_12fps():
    n = NHPT(debounce_frames=1, clear_frames=1, debounce_s=0.25)
    dt = 1 / 12
    evs = run(n, [(i * dt, EMPTY, SRC) for i in range(6)])  # 0.5 s steady
    assert n.fsm.debounce_frames == 3  # ceil(0.25 s / 83 ms)
    evs += run(n, [(6 * dt, OCC3, SRC), (7 * dt, EMPTY, SRC)])  # one-frame (~100 ms) flicker
    assert evs == [] and n.fsm._stable[3] is False
    run(n, [((8 + j) * dt, OCC3, SRC) for j in range(4)])  # 0.3 s sustained change
    assert n.fsm._stable[3] is True


def test_frame_debounce_stays_a_floor_when_frames_are_slow():
    n = NHPT(debounce_frames=2, clear_frames=1, debounce_s=0.25)
    run(n, [(i * 0.5, EMPTY, []) for i in range(5)])  # 2 fps: 0.25 s is under one frame
    assert n.fsm.debounce_frames == 2


def test_no_debounce_s_keeps_frame_count_fixed():
    n = NHPT(debounce_frames=1, clear_frames=1)
    run(n, [(i / 30, EMPTY, []) for i in range(10)])
    assert n.fsm.debounce_frames == 1
