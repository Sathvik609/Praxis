from praxis_session.perception.board_spec import NHPT_BOARD
from praxis_session.perception.peg_fsm import Observation, PegFSM

H = NHPT_BOARD.targets_mm
SRC = (160.0, 148.5)


def occ(*occupied: int) -> dict[str, str]:
    return {f"hole_{k}": "occupied" if k in occupied else "empty" for k in range(9)}


def run(fsm: PegFSM, seq: list[tuple[float, dict, list]]) -> list:
    out = []
    for t, o, free in seq:
        out += fsm.step(Observation(t=t, occupancy=o, free_pegs_mm=free))
    return out


def types(evs):
    return [e.type for e in evs]


def transfer(t0: float, hole: int, seated: tuple[int, ...] = ()) -> list:
    """Scripted observations for one transfer of a peg from SRC into `hole`."""
    mid = ((SRC[0] + H[hole][0]) / 2, (SRC[1] + H[hole][1]) / 2)
    return [
        (t0 + 0.0, occ(*seated), [SRC]),
        (t0 + 0.2, occ(*seated), []),  # peg lifted (source peg disappears)
        (t0 + 0.4, occ(*seated), [mid]),  # in transit
        (t0 + 0.6, occ(*seated), [(H[hole][0] + 5, H[hole][1])]),  # over target
        (t0 + 0.8, occ(*seated, hole), []),  # seated
        (t0 + 1.0, occ(*seated, hole), []),
        (t0 + 1.2, occ(*seated, hole), []),
        (t0 + 1.4, occ(*seated, hole), [SRC]),  # next peg appears at source
    ]


def test_one_transfer_walks_all_six_states_and_completes_a_rep():
    fsm = PegFSM(targets=[3], debounce_frames=1, clear_frames=1)
    evs = run(fsm, transfer(0.0, 3))
    changes = [(e.payload["from"], e.payload["to"]) for e in evs if e.type == "state_change"]
    assert changes[:5] == [
        ("at_source", "grasped"),
        ("grasped", "in_transit"),
        ("in_transit", "over_target"),
        ("over_target", "seated"),
        ("seated", "hand_clear"),
    ]
    reps = [e for e in evs if e.type == "rep_complete"]
    assert len(reps) == 1 and reps[0].payload["hole"] == 3 and reps[0].payload["rep"] == 1
    assert reps[0].payload["duration_s"] > 0
    assert fsm.finished and fsm.state == "at_source"


def test_wrong_hole_emits_event_and_waits_for_correction():
    fsm = PegFSM(targets=[3], debounce_frames=1, clear_frames=1)
    seq = transfer(0.0, 3)
    seq[4] = (0.8, occ(5), [])  # seated in the wrong hole
    seq[5] = (1.0, occ(5), [])
    evs = run(fsm, seq[:6])
    assert "wrong_hole" in types(evs)
    assert "rep_complete" not in types(evs)
    assert not fsm.finished


def test_drop_after_stationary_free_peg():
    fsm = PegFSM(targets=[3], debounce_frames=1, clear_frames=1, drop_after_s=1.5)
    mid = (130.0, 148.5)  # 30 mm from the source: past the transit threshold
    seq = [(0.0, occ(), [SRC]), (0.2, occ(), []), (0.4, occ(), [mid])]
    seq += [(0.4 + 0.2 * i, occ(), [mid]) for i in range(1, 12)]
    evs = run(fsm, seq)
    assert "drop" in types(evs)
    assert fsm.state == "at_source" and fsm.reps == 0


def test_any_hole_mode_finishes_when_board_full():
    fsm = PegFSM(targets=None, debounce_frames=1, clear_frames=1)
    seated: tuple[int, ...] = ()
    evs = []
    for i, hole in enumerate([4, 0, 8, 2, 6, 1, 7, 3, 5]):
        evs += run(fsm, transfer(i * 2.0, hole, seated))
        seated = (*seated, hole)
    assert types(evs).count("rep_complete") == 9
    assert fsm.finished and fsm.target is None


def test_debounce_ignores_single_frame_flicker():
    fsm = PegFSM(targets=[3], debounce_frames=2, clear_frames=1)
    evs = run(fsm, [(0.0, occ(), [SRC]), (0.1, occ(3), [SRC]), (0.2, occ(), [SRC])])
    assert types(evs) == []
    assert fsm.state == "at_source"


def test_snapshot_shape():
    fsm = PegFSM(targets=[2, 5])
    assert fsm.snapshot() == {"state": "at_source", "target": 2, "reps": 0, "finished": False}
