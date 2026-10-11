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


# ---- Sprint D-SEG-2: pinch-driven grasp, hand-gated seating -----------------------------------
DISH = (190.0, 148.5)  # a dish of pegs beside the board: no free-peg blob is ever visible


def hobs(t, o, hand, pinch=None, free=(), zone=False):
    return Observation(
        t=t,
        occupancy=o,
        free_pegs_mm=list(free),
        hand_mm=hand,
        pinch_mm=pinch,
        hand_in_source_zone=zone,
    )


def test_pinch_in_source_zone_starts_a_transfer_from_a_dish():
    fsm = PegFSM(targets=None, debounce_frames=1, clear_frames=1)
    far = (H[4][0] - 40, H[4][1] + 40)
    evs = fsm.step(hobs(0.0, occ(), DISH, pinch=45.0, zone=True))  # open hand over the dish
    evs += fsm.step(hobs(0.1, occ(), DISH, pinch=20.0, zone=True))  # first pinched frame
    assert fsm.state == "at_source" and evs == []
    evs += fsm.step(hobs(0.2, occ(), DISH, pinch=18.0, zone=True))  # second consecutive
    assert fsm.state == "grasped"
    assert evs[-1].type == "state_change" and evs[-1].payload["grasp"] == "pinch"
    evs += fsm.step(hobs(0.4, occ(), far, pinch=18.0))  # hand carries it away (> 20 mm)
    assert fsm.state == "in_transit"
    evs += fsm.step(hobs(0.6, occ(), (H[4][0] + 3, H[4][1]), pinch=18.0))  # hand over hole 4
    assert fsm.state == "over_target"
    evs += fsm.step(hobs(0.8, occ(4), (H[4][0] + 3, H[4][1]), pinch=30.0))  # seated
    assert fsm.state == "seated"
    evs += fsm.step(hobs(1.0, occ(4), DISH, pinch=45.0))  # hand back at the dish: clear
    reps = [e for e in evs if e.type == "rep_complete"]
    assert len(reps) == 1 and reps[0].payload["verified"] is True
    assert reps[0].payload["reason"] is None and reps[0].payload["hole"] == 4
    assert abs(reps[0].payload["t_grasp"] - 0.1) < 1e-9  # timed from the first pinched frame (11 Oct)


def test_pinch_outside_the_source_zone_or_a_single_frame_does_not_grasp():
    fsm = PegFSM(targets=None, debounce_frames=1, clear_frames=1)
    for i in range(4):  # pinching over the grid (not the zone) never grasps
        fsm.step(hobs(i * 0.1, occ(), H[4], pinch=15.0, zone=False))
    assert fsm.state == "at_source"
    fsm.step(hobs(1.0, occ(), DISH, pinch=15.0, zone=True))
    fsm.step(hobs(1.1, occ(), DISH, pinch=40.0, zone=True))  # opened again: streak resets
    fsm.step(hobs(1.2, occ(), DISH, pinch=15.0, zone=True))
    assert fsm.state == "at_source"


def test_occupancy_change_without_the_hand_near_the_hole_is_unverified_but_counted():
    fsm = PegFSM(targets=None, debounce_frames=1, clear_frames=1)
    far = (H[4][0] + 60, H[4][1] + 60)  # hand seen, but 85 mm from hole 4 the whole time
    evs = run(fsm, transfer(0.0, 4)[:3])  # peg count drop -> grasped -> in_transit
    assert fsm.state == "in_transit"
    evs += fsm.step(hobs(0.6, occ(), far, free=[(H[4][0] + 5, H[4][1])]))  # peg near the hole
    assert fsm.state == "over_target"
    evs += fsm.step(hobs(0.8, occ(4), far))  # hole fills while the hand is far away
    assert fsm.state == "seated"
    evs += fsm.step(hobs(1.0, occ(4), far))
    reps = [e for e in evs if e.type == "rep_complete"]
    assert len(reps) == 1 and fsm.reps == 1
    assert reps[0].payload["verified"] is False
    assert reps[0].payload["reason"] == "no_hand_near_hole"


def test_hand_seen_near_the_hole_within_half_a_second_verifies_the_seat():
    fsm = PegFSM(targets=None, debounce_frames=1, clear_frames=1)
    evs = run(fsm, transfer(0.0, 4)[:3])
    evs += fsm.step(hobs(0.6, occ(), (H[4][0] + 10, H[4][1]), free=[(H[4][0] + 5, H[4][1])]))
    evs += fsm.step(hobs(0.9, occ(4), None))  # hand lost at the moment of seating (0.3 s later)
    evs += fsm.step(hobs(1.1, occ(4), None))
    for j in range(3):
        evs += fsm.step(hobs(1.3 + 0.2 * j, occ(4), None, free=[SRC]))
    reps = [e for e in evs if e.type == "rep_complete"]
    assert len(reps) == 1 and reps[0].payload["verified"] is True


def test_without_any_hand_data_reps_stay_verified():
    fsm = PegFSM(targets=[3], debounce_frames=1, clear_frames=1)
    evs = run(fsm, transfer(0.0, 3))
    rep = next(e for e in evs if e.type == "rep_complete")
    assert rep.payload["verified"] is True and rep.payload["reason"] is None
