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
    mid = ((D[src][0] + D[dst][0]) / 2, (D[src][1] + D[dst][1]) / 2)
    for _ in range(hold):  # in transit (base glimpsed mid-way)
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
    evs, _ = move(fsm, 0.3, 0, 2)  # expected dot 1, went to dot 2
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
