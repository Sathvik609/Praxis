"""Six-state pegboard FSM driven by occupancy deltas + free-peg / hand proximity."""
from __future__ import annotations

from praxis_session.perception.board_spec import BOARD
from praxis_session.perception.pegboard_fsm import Observation, PegboardFSM

EMPTY = {f"hole_{k}": "empty" for k in range(9)}
SRC = (160.0, 148.5)
H = BOARD.hole_centers_mm


def occ(*occupied: int) -> dict[str, str]:
    d = dict(EMPTY)
    for k in occupied:
        d[f"hole_{k}"] = "occupied"
    return d


def near(k: int, dx: float = 3.0) -> tuple[float, float]:
    return (H[k][0] + dx, H[k][1])


def run(fsm: PegboardFSM, obs_list: list[Observation]):
    events = []
    for o in obs_list:
        events += fsm.step(o)
    return events


def types(events) -> list[str]:
    return [e.type for e in events]


def make(targets=(4,), **kw) -> PegboardFSM:
    return PegboardFSM(targets=list(targets), debounce_frames=1, clear_frames=2, **kw)


def test_initial_state_is_at_source_with_first_target() -> None:
    fsm = make(targets=(4, 5))
    assert fsm.state == "at_source"
    assert fsm.target == 4
    assert fsm.reps == 0


def test_free_peg_count_drop_moves_to_grasped() -> None:
    fsm = make()
    fsm.step(Observation(0.0, occ(), [SRC, (170.0, 148.5)]))
    ev = fsm.step(Observation(0.1, occ(), [(170.0, 148.5)]))
    assert fsm.state == "grasped"
    assert types(ev) == ["state_change"]
    assert ev[0].payload == {"from": "at_source", "to": "grasped", "target": 4}


def test_free_peg_away_from_source_moves_to_in_transit() -> None:
    fsm = make()
    fsm.step(Observation(0.0, occ(), [SRC]))
    fsm.step(Observation(0.1, occ(), []))  # grasped
    fsm.step(Observation(0.2, occ(), [(120.0, 148.5)]))  # visible mid-air, 40 mm from source
    assert fsm.state == "in_transit"


def test_hand_leaving_source_zone_moves_to_in_transit() -> None:
    fsm = make()
    fsm.step(Observation(0.0, occ(), [SRC], hand_mm=SRC))
    fsm.step(Observation(0.1, occ(), [], hand_mm=SRC))  # grasped
    fsm.step(Observation(0.2, occ(), [], hand_mm=(125.0, 148.5)))
    assert fsm.state == "in_transit"


def test_peg_near_target_moves_to_over_target() -> None:
    fsm = make()
    fsm.step(Observation(0.0, occ(), [SRC]))
    fsm.step(Observation(0.1, occ(), []))
    fsm.step(Observation(0.2, occ(), [(120.0, 148.5)]))
    fsm.step(Observation(0.3, occ(), [near(4)]))
    assert fsm.state == "over_target"


def test_target_occupied_moves_to_seated_then_hand_clear_emits_rep_complete() -> None:
    fsm = make(targets=(4, 5))
    obs = [
        Observation(0.0, occ(), [SRC]),
        Observation(0.1, occ(), []),
        Observation(0.2, occ(), [(120.0, 148.5)]),
        Observation(0.3, occ(), [near(4)]),
        Observation(0.4, occ(4), []),        # seated
        Observation(0.5, occ(4), []),        # clear frame 1
        Observation(0.6, occ(4), []),        # clear frame 2 -> hand_clear -> rep_complete
    ]
    ev = run(fsm, obs)
    assert "rep_complete" in types(ev)
    rc = next(e for e in ev if e.type == "rep_complete")
    assert rc.payload["rep"] == 1
    assert rc.payload["hole"] == 4
    assert rc.payload["target"] == 4
    assert abs(rc.payload["duration_s"] - 0.3) < 1e-6  # grasp at 0.1 -> seated at 0.4
    assert fsm.reps == 1
    assert fsm.target == 5
    assert fsm.state == "at_source"
    seq = [e.payload["to"] for e in ev if e.type == "state_change"]
    assert seq == ["grasped", "in_transit", "over_target", "seated", "hand_clear", "at_source"]


def test_hand_still_over_hole_delays_hand_clear() -> None:
    fsm = make()
    run(fsm, [
        Observation(0.0, occ(), [SRC], hand_mm=SRC),
        Observation(0.1, occ(), [], hand_mm=SRC),
        Observation(0.2, occ(), [], hand_mm=(120.0, 148.5)),
        Observation(0.3, occ(), [], hand_mm=near(4)),
        Observation(0.4, occ(4), [], hand_mm=near(4)),
    ])
    assert fsm.state == "seated"
    for i in range(5):
        fsm.step(Observation(0.5 + i * 0.1, occ(4), [], hand_mm=near(4)))
    assert fsm.state == "seated"  # hand never left
    ev = fsm.step(Observation(1.2, occ(4), [], hand_mm=SRC))
    assert fsm.state in ("hand_clear", "at_source")
    ev += fsm.step(Observation(1.3, occ(4), [], hand_mm=SRC))
    assert "rep_complete" in types(ev)


def test_wrong_hole_emits_event_and_waits_for_correction() -> None:
    fsm = make(targets=(4,))
    ev = run(fsm, [
        Observation(0.0, occ(), [SRC]),
        Observation(0.1, occ(), []),
        Observation(0.2, occ(), [(120.0, 148.5)]),
        Observation(0.3, occ(1), []),  # seated in hole 1 instead of 4
    ])
    assert types(ev)[-1] == "wrong_hole"
    assert ev[-1].payload == {"hole": 1, "target": 4}
    assert fsm.state == "in_transit"
    assert fsm.reps == 0
    # Lift it back out and seat correctly.
    ev = run(fsm, [
        Observation(0.4, occ(), [(110.0, 148.5)]),
        Observation(0.5, occ(), [near(4)]),
        Observation(0.6, occ(4), []),
        Observation(0.7, occ(4), []),
        Observation(0.8, occ(4), []),
    ])
    assert "rep_complete" in types(ev)
    assert fsm.reps == 1


def test_drop_emits_event_and_returns_to_at_source() -> None:
    fsm = make()
    ev = run(fsm, [
        Observation(0.0, occ(), [SRC]),
        Observation(0.1, occ(), []),                 # grasped
        Observation(0.2, occ(), [(120.0, 148.5)]),   # in transit
        Observation(0.3, occ(), [(118.0, 150.0)]),   # stationary on the table...
        Observation(0.4, occ(), [(118.0, 150.0)]),
        Observation(0.5, occ(), [(118.0, 150.0)]),
        Observation(0.6, occ(), [(118.0, 150.0)]),
    ])
    assert "drop" in types(ev)
    assert fsm.state == "at_source"
    assert fsm.reps == 0


def test_occupancy_debounce_ignores_single_frame_flicker() -> None:
    fsm = PegboardFSM(targets=[4], debounce_frames=2, clear_frames=2)
    run(fsm, [
        Observation(0.0, occ(), [SRC]),
        Observation(0.1, occ(), []),
        Observation(0.2, occ(), [(120.0, 148.5)]),
        Observation(0.3, occ(), [near(4)]),
    ])
    fsm.step(Observation(0.4, occ(4), []))  # one frame only
    assert fsm.state == "over_target"
    fsm.step(Observation(0.5, occ(4), []))  # now stable
    assert fsm.state == "seated"


def test_any_hole_target_mode_accepts_any_empty_hole() -> None:
    fsm = PegboardFSM(targets=None, debounce_frames=1, clear_frames=1)
    ev = run(fsm, [
        Observation(0.0, occ(), [SRC]),
        Observation(0.1, occ(), []),
        Observation(0.2, occ(), [(120.0, 148.5)]),
        Observation(0.3, occ(7), []),
        Observation(0.4, occ(7), []),
    ])
    assert "wrong_hole" not in types(ev)
    assert "rep_complete" in types(ev)
    assert next(e for e in ev if e.type == "rep_complete").payload["hole"] == 7


def test_all_targets_done_sets_finished() -> None:
    fsm = PegboardFSM(targets=[0], debounce_frames=1, clear_frames=1)
    run(fsm, [
        Observation(0.0, occ(), [SRC]),
        Observation(0.1, occ(), []),
        Observation(0.2, occ(), [(120.0, 148.5)]),
        Observation(0.3, occ(0), []),
        Observation(0.4, occ(0), []),
    ])
    assert fsm.finished is True
    assert fsm.target is None
