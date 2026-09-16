from praxis_session.perception.arm_fsm import ArmFSM, ArmObservation

FPS = 15.0


def rep_profile(
    peak: float, hold_s: float, lean: float = 0.0, hike: float = 0.0, rest_s: float = 0.5
):
    """Angle samples for one lift: 1 s up, hold, 1 s down, rest."""
    n_up = int(FPS)
    up = [5 + (peak - 5) * i / n_up for i in range(n_up + 1)]
    hold = [peak] * int(hold_s * FPS)
    down = list(reversed(up))
    rest = [5.0] * int(rest_s * FPS)
    return [(a, lean, hike) for a in up + hold + down + rest]


def run(fsm: ArmFSM, samples, t0: float = 0.0):
    evs, t = [], t0
    for angle, lean, hike in samples:
        evs += fsm.step(
            ArmObservation(
                t=t, shoulder_deg=angle, trunk_lean_deg=lean, shoulder_hike_norm=hike, view_ok=True
            )
        )
        t += 1 / FPS
    return evs, t


def types(evs):
    return [e.type for e in evs]


def test_good_rep_is_verified_and_walks_states():
    fsm = ArmFSM(target_deg=90, hold_s=3.0, sets=1, reps_per_set=1)
    evs, _ = run(fsm, rep_profile(90, 3.2))
    seq = [(e.payload["from"], e.payload["to"]) for e in evs if e.type == "state_change"]
    assert seq[:4] == [
        ("start_pose", "moving"),
        ("moving", "target_reached"),
        ("target_reached", "hold"),
        ("hold", "return"),
    ]
    rep = [e for e in evs if e.type == "rep_complete"][0].payload
    assert rep["verified"] and rep["peak_deg"] >= 89 and rep["hold_s"] >= 3.0
    assert fsm.finished and "arm_complete" in types(evs)


def test_short_hold_and_missed_target():
    fsm = ArmFSM(target_deg=90, hold_s=3.0, sets=1, reps_per_set=2)
    evs, t = run(fsm, rep_profile(90, 1.0))
    assert "hold_too_short" in types(evs)
    r1 = [e for e in evs if e.type == "rep_complete"][0].payload
    assert r1["verified"] is False and r1["reason"] == "hold_too_short"
    evs2, _ = run(fsm, rep_profile(70, 0.5), t)
    assert "target_missed" in types(evs2)
    r2 = [e for e in evs2 if e.type == "rep_complete"][0].payload
    assert r2["verified"] is False and r2["reason"] == "target_missed"
    assert fsm.finished


def test_trunk_lean_flags_after_three_events():
    fsm = ArmFSM(
        target_deg=90, hold_s=1.0, sets=1, reps_per_set=4, lean_limit_deg=12, lean_events_to_flag=3
    )
    t = 0.0
    evs = []
    for _ in range(3):
        e, t = run(fsm, rep_profile(90, 1.2, lean=15.0), t)
        evs += e
    assert types(evs).count("compensation_lean") == 3
    assert fsm.snapshot()["flags"]["lean"] is True
    assert fsm.snapshot()["flags"]["lean_count"] == 3


def test_shoulder_hike_is_baselined_and_flagged():
    fsm = ArmFSM(target_deg=90, hold_s=1.0, sets=1, reps_per_set=2, hike_limit=0.08)
    # start with a resting hike of 0.05 that should be baselined away
    evs, t = run(fsm, [(5.0, 0.0, 0.05)] * 15)
    e1, t = run(fsm, rep_profile(90, 1.2, hike=0.05), t)
    assert "shoulder_hiking" not in types(e1)
    e2, _ = run(fsm, rep_profile(90, 1.2, hike=0.20), t)
    assert "shoulder_hiking" in types(e2)


def test_two_sets_of_eight_complete_and_ceiling_clamps_target():
    fsm = ArmFSM(target_deg=120, ceiling_deg=90, hold_s=1.0, sets=2, reps_per_set=8)
    assert fsm.target_deg == 90 and fsm.clamped
    t = 0.0
    evs = []
    for _ in range(16):
        e, t = run(fsm, rep_profile(92, 1.2), t)
        evs += e
    assert types(evs).count("rep_complete") == 16 and types(evs).count("set_complete") == 2
    assert types(evs).count("arm_complete") == 1 and fsm.finished
    s = fsm.snapshot()
    assert s["set"] == 2 and s["rep"] == 8 and s["best_this_set"] >= 90


def test_pose_lost_freezes_without_events():
    fsm = ArmFSM()
    evs = fsm.step(
        ArmObservation(
            t=0.0, shoulder_deg=None, trunk_lean_deg=0.0, shoulder_hike_norm=0.0, view_ok=False
        )
    )
    assert evs == [] and fsm.snapshot()["angle_now"] is None
