import numpy as np
import pytest

from praxis_session.perception.board_spec import CUP_TARGETS
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.cup import ARC, CupFSM, CupObservation, CupSheetState
from praxis_session.perception.synth import camera_frame

D = CUP_TARGETS.targets_mm


def test_cup_base_found_on_synthetic_sheet_within_3mm():
    frame, _ = camera_frame(CUP_TARGETS, cup_mm=D[2])
    cal = Calibrator(CUP_TARGETS).run(frame)
    assert cal.calibrated
    st = CupSheetState()
    canon = st.warp(frame, cal)
    cup = st.cup_mm(canon)
    assert cup is not None
    assert np.hypot(cup[0] - D[2][0], cup[1] - D[2][1]) < 3.0
    assert 50 < cup[2] < 70
    assert len(st.dots_frame_px(cal)) == 5


def test_cup_base_found_from_a_laptop_camera_angle():
    frame, _ = camera_frame(CUP_TARGETS, tilt_deg=45, yaw_deg=5, cup_mm=D[2], noise_sigma=2.0)
    cal = Calibrator(CUP_TARGETS).run(frame)
    st = CupSheetState()
    cup = st.cup_mm(st.warp(frame, cal))
    assert cup is not None and np.hypot(cup[0] - D[2][0], cup[1] - D[2][1]) < 3.0


def test_no_cup_on_empty_sheet():
    frame, _ = camera_frame(CUP_TARGETS)
    cal = Calibrator(CUP_TARGETS).run(frame)
    st = CupSheetState()
    assert st.cup_mm(st.warp(frame, cal)) is None


def obs(t, cup=None, hand=None, calibrated=True):
    return CupObservation(t=t, cup_mm=cup, hand_mm=hand, calibrated=calibrated)


def move(
    fsm: CupFSM,
    t0: float,
    src: int,
    dst: int,
    hold: int = 3,
    dt: float = 0.1,
    calibrated=True,
    occlude=False,
):
    """Scripted reach from dot src to dot dst. Returns (events, t_end)."""
    evs = []
    t = t0
    for _ in range(hold):  # resting at src
        evs += fsm.step(obs(t, cup=D[src], calibrated=calibrated))
        t += dt
    for _ in range(hold):  # lifted: base hidden
        evs += fsm.step(obs(t, cup=None, calibrated=calibrated))
        t += dt
    for i in range(hold):  # in transit: base glimpsed moving across the middle
        s = 0.35 + 0.3 * i / max(1, hold - 1)
        mid = (D[src][0] + (D[dst][0] - D[src][0]) * s, D[src][1] + (D[dst][1] - D[src][1]) * s)
        evs += fsm.step(obs(t, cup=None if occlude else mid, calibrated=calibrated))
        t += dt
    for _ in range(hold + 2):  # placed on dst
        evs += fsm.step(
            obs(
                t,
                cup=None if occlude else D[dst],
                hand=D[dst] if occlude else None,
                calibrated=calibrated,
            )
        )
        t += dt
    if occlude:
        for _ in range(hold + 2):  # hand leaves, cup still hidden
            evs += fsm.step(
                obs(t, cup=None, hand=(D[dst][0] + 80, D[dst][1] + 80), calibrated=calibrated)
            )
            t += dt
    return evs, t


def arc(fsm: CupFSM, t0: float, **kw):
    evs = []
    t = t0
    for a, b in zip(ARC[:-1], ARC[1:]):
        e, t = move(fsm, t, a, b, **kw)
        evs += e
    return evs, t


def test_full_slow_arc_gives_eight_verified_reaches_and_arc_complete():
    fsm = CupFSM(clear_frames=2)
    for _ in range(3):
        fsm.step(obs(0.0, cup=D[0]))
    evs, _ = arc(fsm, 0.3)
    reaches = [e for e in evs if e.type == "reach_complete"]
    assert len(reaches) == 8
    assert all(r.payload["verified"] for r in reaches)
    assert [r.payload["to_dot"] for r in reaches] == ARC[1:]
    assert reaches[0].payload["reach_ms"] > 0
    arcs = [e for e in evs if e.type == "arc_complete"]
    assert len(arcs) == 1 and arcs[0].payload["arc"] == 1 and arcs[0].payload["phase"] == "slow"
    assert fsm.arcs_done == 1 and fsm.expected_next == 1


def test_marker_loss_during_reach_marks_unverified():
    fsm = CupFSM(clear_frames=2)
    for _ in range(3):
        fsm.step(obs(0.0, cup=D[0]))
    evs, _ = move(fsm, 0.3, 0, 1, calibrated=False)
    evs2, _ = move(fsm, 5.0, 1, 2)
    r = [e for e in evs + evs2 if e.type == "reach_complete"]
    assert len(r) >= 1
    first = r[0].payload
    assert first["verified"] is False and first["reason"] == "marker_lost"


def test_occluded_placement_inferred_from_hand_is_unverified():
    fsm = CupFSM(clear_frames=2)
    for _ in range(3):
        fsm.step(obs(0.0, cup=D[0]))
    evs, _ = move(fsm, 0.3, 0, 1, occlude=True)
    r = [e for e in evs if e.type == "reach_complete"]
    assert (
        len(r) == 1
        and r[0].payload["verified"] is False
        and r[0].payload["reason"] == "cup_occluded"
    )


def test_wrong_dot_emits_event_and_reanchors():
    fsm = CupFSM(clear_frames=2)
    for _ in range(3):
        fsm.step(obs(0.0, cup=D[0]))
    evs, t = move(fsm, 0.3, 0, 2)  # expected dot 1, went to dot 2
    for i in range(4):  # the cup rests on dot 2 (it passed over dot 1 on the way: AWAY_READINGS)
        evs += fsm.step(obs(t + 0.1 * i, cup=D[2]))
    assert any(e.type == "wrong_dot" and e.payload["expected"] == 1 for e in evs)
    assert fsm.dot == 2 and fsm.expected_next == 3


def test_phase_switch_is_explicit_and_completion_after_four_arcs():
    fsm = CupFSM(clear_frames=2, slow_arcs=2, fast_arcs=2)
    for _ in range(3):
        fsm.step(obs(0.0, cup=D[0]))
    t = 0.3
    all_evs = []
    for _ in range(2):
        e, t = arc(fsm, t)
        all_evs += e
    assert fsm.arcs_done == 2 and fsm.phase == "slow" and not fsm.finished
    assert fsm.snapshot()["awaiting_phase"] is True
    fsm.set_phase("fast")
    for _ in range(2):
        e, t = arc(fsm, t)
        all_evs += e
    assert fsm.finished
    done = [e for e in all_evs if e.type == "cup_complete"]
    assert len(done) == 1 and done[0].payload["arcs"] == 4
    phases = [e.payload["phase"] for e in all_evs if e.type == "arc_complete"]
    assert phases == ["slow", "slow", "fast", "fast"]
    with pytest.raises(ValueError):
        fsm.set_phase("turbo")


# ---- Sprint D-SEG-3: colour sampling, resting-window verification ------------------------------
def test_cup_colour_sampling_switches_from_the_default_blue_band():
    frame, _ = camera_frame(CUP_TARGETS, cup_mm=D[2], cup_bgr=(30, 200, 60))  # a green base
    cal = Calibrator(CUP_TARGETS).run(frame)
    st = CupSheetState()
    canon = st.warp(frame, cal)
    assert st.cup_mm(canon) is None and st.colour_range is None  # blue band assumed by default
    rng = st.sample_cup_colour(canon, D[2])
    assert rng["source"] == "sampled" and st.colour_range == rng
    cup = st.cup_mm(canon)
    assert cup is not None and np.hypot(cup[0] - D[2][0], cup[1] - D[2][1]) < 3.0


def _occluded_reach_then(fsm: CupFSM, t: float, glimpse_at: float | None, dt: float = 0.1):
    """Lift from dot 0, place on dot 1 inferred from the hand only (cup hidden); optionally the
    base is glimpsed resting on dot 1 at `glimpse_at` s after placement while the hand is still
    over it; then the hand leaves, cup still hidden."""
    evs = []
    for _ in range(3):
        evs += fsm.step(obs(t, cup=None))
        t += dt
    for _ in range(3):
        evs += fsm.step(obs(t, cup=None, hand=D[1]))  # over dot 1 by the hand -> placed
        t += dt
    assert fsm.state == "placed"
    t_placed = t
    while glimpse_at is not None and t < t_placed + glimpse_at:
        evs += fsm.step(obs(t, cup=None, hand=D[1]))
        t += dt
    if glimpse_at is not None:
        evs += fsm.step(obs(t, cup=D[1], hand=D[1]))
        t += dt
    for _ in range(3):
        evs += fsm.step(obs(t, cup=None, hand=(D[1][0] + 80, D[1][1] + 80)))
        t += dt
    return [e for e in evs if e.type == "reach_complete"]


def test_placement_occluded_but_base_seen_resting_within_window_is_verified():
    fsm = CupFSM(clear_frames=2, rest_window_s=0.6)
    for _ in range(3):
        fsm.step(obs(0.0, cup=D[0]))
    r = _occluded_reach_then(fsm, 0.3, glimpse_at=0.2)
    assert len(r) == 1
    assert r[0].payload["verified"] is True and r[0].payload["reason"] is None


def test_base_glimpsed_too_long_before_hand_clear_stays_unverified():
    fsm = CupFSM(clear_frames=2, rest_window_s=0.6)
    for _ in range(3):
        fsm.step(obs(0.0, cup=D[0]))
    # glimpse 0.2 s after placement, but the hand then lingers 1.5 s: outside the 0.6 s window
    evs = []
    t = 0.3
    for _ in range(3):
        evs += fsm.step(obs(t, cup=None))
        t += 0.1
    for _ in range(3):
        evs += fsm.step(obs(t, cup=None, hand=D[1]))
        t += 0.1
    evs += fsm.step(obs(t, cup=D[1], hand=D[1]))
    t += 0.1
    for _ in range(15):
        evs += fsm.step(obs(t, cup=None, hand=D[1]))
        t += 0.1
    for _ in range(3):
        evs += fsm.step(obs(t, cup=None, hand=(D[1][0] + 80, D[1][1] + 80)))
        t += 0.1
    r = [e for e in evs if e.type == "reach_complete"]
    assert len(r) == 1 and r[0].payload["verified"] is False
    assert r[0].payload["reason"] == "cup_occluded"


def test_never_seen_resting_stays_unverified():
    fsm = CupFSM(clear_frames=2)
    for _ in range(3):
        fsm.step(obs(0.0, cup=D[0]))
    r = _occluded_reach_then(fsm, 0.3, glimpse_at=None)
    assert len(r) == 1 and r[0].payload["reason"] == "cup_occluded"


def test_before_the_cup_is_on_a_dot_the_next_dot_is_dot_1():
    # team test 24 Oct: the cup started beside the sheet and the screen already
    # highlighted dot 2, so every count looked one dot ahead
    fsm = CupFSM(clear_frames=2)
    fsm.step(obs(0.0))
    assert fsm.dot is None and fsm.expected_next == 0
    fsm.step(obs(0.1, (*D[0], 58.0)))
    assert fsm.dot == 0 and fsm.expected_next == 1


def test_one_stray_reading_does_not_knock_the_cup_off_its_dot():
    # the same session: over_dot / in_transit flipped every 0.1-0.3 s and dot 2 took 5 s to count
    fsm = CupFSM(clear_frames=3)
    fsm.step(obs(0.0, (*D[0], 58.0)))
    fsm.step(obs(0.1))  # lifted
    fsm.step(obs(0.2, (*D[1], 58.0)))
    assert fsm.state == "over_dot"
    far = (D[1][0] + 40.0, D[1][1] + 30.0, 58.0)
    fsm.step(obs(0.3, far))  # one bad reading
    assert fsm.state == "over_dot"
    evs = []
    for i in range(6):  # placed after three still frames, counted after three more (hand away)
        evs += fsm.step(obs(0.4 + 0.1 * i, (*D[1], 58.0)))
    assert any(e.type == "reach_complete" and e.payload["to_dot"] == 1 for e in evs)
    # three in a row really is the cup moving on
    fsm2 = CupFSM(clear_frames=3)
    for t, c in [(0.0, D[0]), (0.1, None), (0.2, D[1])]:
        fsm2.step(obs(t, None if c is None else (*c, 58.0)))
    for t in (0.3, 0.4):
        fsm2.step(obs(t, far))
        assert fsm2.state == "over_dot"
    fsm2.step(obs(0.5, far))
    assert fsm2.state == "in_transit"


def test_stray_readings_while_placed_do_not_restart_the_count():
    # team test 24 Oct: placed -> in_transit -> over_dot -> placed up to 38 times for one
    # placement (5-23 s to count); placed now ignores up to two stray readings in a row too
    fsm = CupFSM(clear_frames=3)
    for t, c in [(0.0, D[0]), (0.1, None)]:
        fsm.step(obs(t, None if c is None else (*c, 58.0)))
    t = 0.2
    for _ in range(3):
        fsm.step(obs(t, (*D[1], 58.0)))
        t += 0.1
    assert fsm.state == "placed"
    far = (D[1][0] + 40.0, D[1][1] + 30.0, 58.0)
    evs = fsm.step(obs(t, far)) + fsm.step(obs(t + 0.1, far))
    assert fsm.state == "placed"
    for i in range(3):
        evs += fsm.step(obs(t + 0.2 + 0.1 * i, (*D[1], 58.0)))
    assert [e.payload["to_dot"] for e in evs if e.type == "reach_complete"] == [1]


def test_a_cup_seen_resting_with_no_hand_near_counts_without_a_second_wait():
    # deep run 24 Oct: a plain (change-found) cup is unseen while gripped, so the three still
    # frames and the three hand-clear frames ran one after the other (0.5 s after letting go);
    # a quick next reach skipped the dot. Frames with no hand near now count for both.
    fsm = CupFSM(clear_frames=3)
    for t, c in [(0.0, D[0]), (0.1, None)]:
        fsm.step(obs(t, None if c is None else (*c, 58.0)))
    evs = []
    for i in range(4):
        evs += fsm.step(obs(0.2 + 0.1 * i, (*D[1], 58.0)))
    assert [e.payload["to_dot"] for e in evs if e.type == "reach_complete"] == [1]
