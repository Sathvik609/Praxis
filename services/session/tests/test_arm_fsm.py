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


def run_obs(fsm: ArmFSM, samples, t0: float = 0.0, **fields):
    """Like run() but with extra ArmObservation fields (view and visibility gates)."""
    evs, t = [], t0
    for angle, lean, hike in samples:
        evs += fsm.step(
            ArmObservation(
                t=t,
                shoulder_deg=angle,
                trunk_lean_deg=lean,
                shoulder_hike_norm=hike,
                **({"view_ok": True} | fields),
            )
        )
        t += 1 / FPS
    return evs, t


def test_front_facing_freezes_fsm_with_turn_side_gate():
    fsm = ArmFSM(target_deg=90, hold_s=1.0, sets=1, reps_per_set=1)
    evs, _ = run_obs(fsm, rep_profile(90, 1.2), view_ok=False)
    assert evs == [] and fsm.state == "start_pose"
    assert fsm.gate == "turn_side" and fsm.snapshot()["gate"] == "turn_side"
    # turning to the side unfreezes: the same lift now counts
    evs, _ = run_obs(fsm, rep_profile(90, 1.2), t0=10.0, view_ok=True)
    assert types(evs).count("rep_complete") == 1 and fsm.gate is None


def test_low_joint_visibility_freezes_with_hips_gate():
    fsm = ArmFSM(target_deg=90, hold_s=1.0, sets=1, reps_per_set=1)
    evs, _ = run_obs(fsm, rep_profile(90, 1.2, lean=20.0), visibility=0.3)
    assert evs == [] and fsm.gate == "hips_out_of_view"
    assert fsm.snapshot()["angle_now"] is not None  # still displayed, just not scored


def test_lean_needs_visible_hips():
    fsm = ArmFSM(target_deg=90, hold_s=1.0, sets=1, reps_per_set=1, lean_limit_deg=12)
    evs, _ = run_obs(fsm, rep_profile(90, 1.2, lean=20.0), hip_visibility=0.3)
    assert types(evs).count("rep_complete") == 1  # the rep itself is still scored
    assert "compensation_lean" not in types(evs)


def test_lean_must_persist_half_a_second():
    def spike(seconds: float):
        prof = rep_profile(90, 1.5)
        n = int(seconds * FPS)
        start = int(FPS) + 2  # inside the hold
        return [
            (a, 20.0 if start <= i < start + n else 0.0, h) for i, (a, _l, h) in enumerate(prof)
        ]

    short = ArmFSM(target_deg=90, hold_s=1.0, sets=1, reps_per_set=1)
    evs, _ = run_obs(short, spike(0.3))
    assert "compensation_lean" not in types(evs)
    long = ArmFSM(target_deg=90, hold_s=1.0, sets=1, reps_per_set=1)
    evs, _ = run_obs(long, spike(0.6))
    assert types(evs).count("compensation_lean") == 1


def test_hike_needs_both_shoulders_visible():
    fsm = ArmFSM(target_deg=90, hold_s=1.0, sets=1, reps_per_set=1, hike_limit=0.08)
    evs, _ = run_obs(fsm, rep_profile(90, 1.2, hike=0.3), shoulders_visibility=0.4)
    assert "shoulder_hiking" not in types(evs) and types(evs).count("rep_complete") == 1


# ---- Sprint E: the FSM is driven by a registry entry ------------------------------------
def swing(peak: float, cycles: int = 1, fps: float = FPS):
    """One-second sine swings about vertical, `peak` degrees each way."""
    import math

    n = int(fps)
    out = []
    for _c in range(cycles):
        for i in range(n):
            out.append((peak * math.sin(2 * math.pi * i / n), 0.0, 0.0))
    return out


def test_registry_entry_sets_target_view_and_dose():
    f = ArmFSM("abduction")
    assert f.target_deg == 90.0 and f.view == "front" and f.exercise.id == "abduction"
    s = f.snapshot()
    assert s["exercise"] == "abduction" and s["view_required"] == "front"
    assert s["phase"] == "start" and s["rep_progress"] == 0.0 and s["tier"] == "full"
    assert ArmFSM().exercise.id == "flexion"  # unchanged default


def test_demo_only_and_sheet_exercises_cannot_run_in_the_arm_fsm():
    """Rotate out/in are demo only: no camera-verified rep can exist for them."""
    import pytest

    for ex in ("external_rotation", "internal_rotation", "cup", "nhpt"):
        with pytest.raises(ValueError):
            ArmFSM(ex)
    with pytest.raises(ValueError):
        ArmFSM("flexion", tier="rest")


def test_gentle_tier_lowers_target_hold_and_reps():
    f = ArmFSM("abduction", tier="gentle")
    assert (f.target_deg, f.hold_s, f.reps_per_set) == (60.0, 2.0, 6)
    assert f.snapshot()["tier"] == "gentle"


def test_front_view_exercise_gates_until_the_shoulders_separate():
    f = ArmFSM("abduction", hold_s=1.0, sets=1, reps_per_set=1)
    evs, t = run_obs(f, rep_profile(90, 1.2), view_ok=True)  # side-on: wrong view for abduction
    assert evs == [] and f.gate == "turn_front"
    evs, _ = run_obs(f, rep_profile(90, 1.2), t0=t, view_ok=False)
    assert types(evs).count("rep_complete") == 1 and f.gate is None


def test_exercise_start_is_emitted_once_with_the_dose():
    f = ArmFSM("flexion", hold_s=1.0, sets=1, reps_per_set=2)
    evs, t = run(f, rep_profile(90, 1.2))
    starts = [e for e in evs if e.type == "exercise_start"]
    assert len(starts) == 1
    assert starts[0].payload["exercise"] == "flexion" and starts[0].payload["view"] == "side"
    assert starts[0].payload["dose"] and starts[0].payload["sets"] == 1
    evs2, _ = run(f, rep_profile(90, 1.2), t)
    assert "exercise_start" not in types(evs2)


def test_phase_and_rep_progress_follow_the_state():
    f = ArmFSM("flexion", hold_s=1.0, sets=1, reps_per_set=2)
    seen = {}
    t = 0.0
    for angle, lean, hike in rep_profile(90, 1.2):
        f.step(
            ArmObservation(
                t=t, shoulder_deg=angle, trunk_lean_deg=lean, shoulder_hike_norm=hike, view_ok=True
            )
        )
        s = f.snapshot()
        seen.setdefault(s["phase"], s["rep_progress"])
        t += 1 / FPS
    assert set(seen) >= {"start", "lift", "hold", "lower"}
    assert 0.0 <= seen["lift"] <= seen["hold"] <= seen["lower"] <= 1.0


def test_set_complete_carries_verified_count_and_best_angle():
    f = ArmFSM("flexion", hold_s=1.0, sets=1, reps_per_set=2)
    t = 0.0
    evs = []
    for peak in (92.0, 60.0):  # one good rep, one that never reaches the line
        e, t = run(f, rep_profile(peak, 1.2), t)
        evs += e
    done = [e for e in evs if e.type == "set_complete"][0].payload
    assert done["reps"] == 2 and done["verified_reps"] == 1
    assert done["best_deg"] >= 90


# ---- pendulum: oscillations, no hold ----------------------------------------------------
def test_pendulum_counts_full_oscillations():
    f = ArmFSM("pendulum", sets=1, reps_per_set=3)
    evs, _ = run(f, swing(20.0, cycles=5))
    reps = [e for e in evs if e.type == "rep_complete"]
    assert len(reps) == 3 and all(r.payload["verified"] for r in reps)
    assert reps[0].payload["swing_deg"] >= 15 and reps[0].payload["hold_s"] == 0.0
    assert "hold_too_short" not in types(evs) and "target_missed" not in types(evs)
    assert f.finished and "arm_complete" in types(evs)


def test_pendulum_small_swings_are_counted_but_unverified():
    f = ArmFSM("pendulum", sets=1, reps_per_set=2)
    evs, _ = run(f, swing(5.0, cycles=4))  # 10 deg peak-to-peak, under the 15 deg the plan asks
    reps = [e for e in evs if e.type == "rep_complete"]
    assert reps and all(not r.payload["verified"] for r in reps)
    assert reps[0].payload["reason"] == "swing_too_small"


def test_pendulum_at_rest_produces_no_reps():
    f = ArmFSM("pendulum", sets=1, reps_per_set=2)
    evs, _ = run(f, [(0.5, 0.0, 0.0)] * 60)
    assert "rep_complete" not in types(evs) and f.snapshot()["phase"] == "start"
