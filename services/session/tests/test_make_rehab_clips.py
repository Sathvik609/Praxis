"""evaluation/scripts/make_rehab_clips.py on tiny synthetic skeleton files (no network, no
real dataset): parsing both layouts, the rig-convention retargeting, segmentation, key
selection, the end-to-end build and the reference-range table."""
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "evaluation" / "scripts" / "make_rehab_clips.py"


def _load():
    spec = importlib.util.spec_from_file_location("make_rehab_clips", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["make_rehab_clips"] = mod
    spec.loader.exec_module(mod)
    return mod


mk = _load()
D = math.pi / 180


# ----------------------------------------------------------------- synthetic skeletons
def _standing_body(n: int):
    """Pelvis, chest, shoulders for an upright body facing +z (rig frame), n frames."""
    hip = np.tile([0.0, 1.0, 0.0], (n, 1))
    chest = np.tile([0.0, 1.5, 0.0], (n, 1))
    l_sh = np.tile([0.2, 1.45, 0.0], (n, 1))
    r_sh = np.tile([-0.2, 1.45, 0.0], (n, 1))
    return hip, chest, l_sh, r_sh


def _arm(sh: np.ndarray, elev_deg: np.ndarray, az_deg: np.ndarray, bend_deg: float = 0.0, upper=0.3, fore=0.25):
    """Elbow and wrist for a straight-ish arm at the given elevation/azimuth per frame."""
    el = np.zeros_like(sh)
    wr = np.zeros_like(sh)
    for i, (e, a) in enumerate(zip(elev_deg * D, az_deg * D)):
        d = np.array([math.sin(e) * math.sin(a), -math.cos(e), math.sin(e) * math.cos(a)])
        el[i] = sh[i] + upper * d
        # forearm bent `bend_deg` toward the body's forward
        fwd = np.array([0.0, 0.0, 1.0])
        p = fwd - np.dot(fwd, d) * d
        p = p / (np.linalg.norm(p) or 1)
        fd = math.cos(bend_deg * D) * d + math.sin(bend_deg * D) * p
        wr[i] = el[i] + fore * fd
    return el, wr


def _abduction_profile(n: int, peak: float = 90.0):
    t = np.linspace(0, 1, n)
    return peak * 0.5 * (1 - np.cos(2 * math.pi * t))  # 0 → peak → 0


def _rep(n=60, peak=90.0, az=90.0, arm="left", correct=True, healthy=True, position="stand", bend=0.0):
    hip, chest, l_sh, r_sh = _standing_body(n)
    elev = _abduction_profile(n, peak)
    sh = l_sh if arm == "left" else r_sh
    azs = np.full(n, az if arm == "left" else -az)
    el, wr = _arm(sh, elev, azs, bend)
    return mk.Rep("test", "m00", "s01", "e01", correct, healthy, position, 30.0, hip, chest, l_sh, r_sh, sh, el, wr, arm)


# ----------------------------------------------------------------- rig conventions
def test_euler_xyz_round_trips_random_rotations():
    rng = np.random.default_rng(1)
    for _ in range(200):
        x, y, z = rng.uniform(-math.pi, math.pi), rng.uniform(-1.4, 1.4), rng.uniform(-math.pi, math.pi)
        R = mk.euler_xyz(x, y, z)
        x2, y2, z2 = mk.decompose_xyz(R)
        assert np.allclose(mk.euler_xyz(x2, y2, z2), R, atol=1e-9)


def test_retarget_matches_rig_conventions_for_abduction_and_flexion():
    # rig.ts: shoulder pitch −90° = arm forward (+z); left-arm roll +90° = arm out to the side (+x)
    rest = mk.REST_UA
    up = np.array([1.0, 0.0, 0.0])  # abducted, horizontal, to the left
    R, phi, fit = mk.shoulder_elbow(up, up)
    assert np.allclose(R @ rest, up, atol=1e-9)
    x, y, z = np.degrees(mk.decompose_xyz(R))
    assert abs(z - 90) < 6 and abs(x) < 6 and phi == 0.0
    fwd = np.array([0.0, 0.0, 1.0])
    R, phi, fit = mk.shoulder_elbow(fwd, fwd)
    x, y, z = np.degrees(mk.decompose_xyz(R))
    assert abs(x + 90) < 6 and abs(z) < 6
    # a 90° bent elbow with the forearm pointing forward while the arm hangs: elbow pitch −90°
    down = np.array([0.0, -1.0, 0.0])
    R, phi, fit = mk.shoulder_elbow(down, fwd)
    assert abs(math.degrees(phi) + 90) < 6
    assert fit < 1.0
    forearm = R @ mk.rot_x(phi) @ mk.REST_FA
    assert np.allclose(forearm, fwd, atol=0.02)


def test_curves_body_frame_cancels_camera_pose_and_mirrors_right_arm():
    left = mk.curves(_rep(arm="left"))
    right = mk.curves(_rep(arm="right"))
    assert abs(left.elevation.max() - 90) < 1 and abs(right.elevation.max() - 90) < 1
    i = int(left.elevation.argmax())
    assert abs(left.azimuth[i] - 90) < 1 and abs(right.azimuth[i] - 90) < 1  # mirrored to +x
    assert np.allclose(left.spine, np.eye(3), atol=1e-6)
    ang = mk.retarget(left)
    assert abs(ang["lShoulder"][i][2] - 90) < 6  # roll +90 at the peak
    assert np.all(np.isfinite(ang["lShoulder"]))


def test_segment_and_key_frames_hold_at_the_extremes():
    s = np.concatenate([np.zeros(10), _abduction_profile(40, 60), np.zeros(10)])
    start, peak, end = mk.segment(s)
    assert 8 <= start <= 14 and peak == 30 and 46 <= end <= 52
    idx = mk.key_frames(start, peak, end)
    assert idx[0] == start and idx[-1] == end and peak in idx
    assert len(idx) == 12 and idx == sorted(idx)


def test_choose_prefers_healthy_correct_standing_complete_reps():
    good = mk.candidate(_rep(peak=90), "elevation")
    typical = [mk.candidate(_rep(n=n, peak=p), "elevation") for n, p in ((54, 86), (66, 94), (58, 88), (62, 92))]
    patient = mk.candidate(_rep(peak=90, healthy=False), "elevation")
    wrong = mk.candidate(_rep(peak=90, correct=False), "elevation")
    seated = mk.candidate(_rep(peak=90, position="chair"), "elevation")
    odd = mk.candidate(_rep(peak=40), "elevation")
    # Among near-identical clean reps the exact winner depends on float noise (CI vs laptop),
    # so assert the property: a healthy, correct, standing, complete rep is chosen, never the
    # patient, incorrect, seated or atypical one; and with no rivals the typical rep wins outright.
    chosen = mk.choose([patient, wrong, seated, odd, *typical, good])
    assert any(chosen is c for c in (good, *typical))  # identity: candidates hold numpy arrays
    assert not any(chosen is c for c in (patient, wrong, seated, odd))
    assert mk.choose([patient, wrong, seated, odd, good]) is good


# ----------------------------------------------------------------- file layouts
def _write_irds(path: Path, n=60, peak=90.0, moving="Right"):
    """IRDS Simplified layout: 25 joints × XYZ per line; the column-labelled `moving` arm moves."""
    d = np.zeros((n, 25, 3))
    hip, chest, l_sh, r_sh = _standing_body(n)
    c = mk.IRDS_COLS
    d[:, c["SpineBase"]], d[:, c["SpineShoulder"]], d[:, c["ShoulderLeft"]], d[:, c["ShoulderRight"]] = hip, chest, l_sh, r_sh
    still = np.full(n, 0.0)
    for side, sh in (("Left", l_sh), ("Right", r_sh)):
        elev = _abduction_profile(n, peak) if side == moving else still
        az = np.full(n, 90.0 if side == "Left" else -90.0)
        el, wr = _arm(sh, elev, az)
        d[:, c[f"Elbow{side}"]], d[:, c[f"Wrist{side}"]] = el, wr
    np.savetxt(path, d.reshape(n, 75), delimiter=",", fmt="%.6f")


def _write_uiprmd(pos_path: Path, ang_path: Path, n=60, peak=90.0):
    """UI-PRMD Kinect layout: parent-relative offsets in the parent's rotated frame plus x,y,z
    Euler angles composed Rz·Rx·Ry; only the right upper arm rotates (abduction)."""
    J = mk.UIPRMD_JOINTS
    off = {j: np.zeros(3) for j in J}
    off["waist"] = np.array([0, 100.0, 0])
    off["spine"] = np.array([0, 20.0, 0])
    off["chest"] = np.array([0, 20.0, 0])
    off["neck"] = np.array([0, 10.0, 0])
    off["head"] = np.array([0, 8.0, 0])
    off["head_tip"] = np.array([0, 8.0, 0])
    for s, sign in (("l", 1), ("r", -1)):
        off[f"{s}_collar"] = np.array([sign * 5.0, 0, 0])
        off[f"{s}_upper_arm"] = np.array([sign * 15.0, 0, 0])
        off[f"{s}_forearm"] = np.array([0, -28.0, 0])
        off[f"{s}_hand"] = np.array([0, -25.0, 0])
        off[f"{s}_upper_leg"] = np.array([sign * 10.0, -5, 0])
        off[f"{s}_lower_leg"] = np.array([0, -40.0, 0])
        off[f"{s}_foot"] = np.array([0, -40.0, 0])
        off[f"{s}_toes"] = np.array([0, -5.0, 10.0])
    pos = np.tile(np.stack([off[j] for j in J]), (n, 1, 1))
    ang = np.zeros((n, 22, 3))
    # right arm abducts: rotate the r_upper_arm joint about z by −elev (the arm hangs along −y and
    # Rz(−e) turns −y toward −x, out to the right side; the loader mirrors it to the rig's left)
    ang[:, J.index("r_upper_arm"), 2] = -_abduction_profile(n, peak)
    np.savetxt(pos_path, pos.reshape(n, 66), delimiter=",", fmt="%.6f")
    np.savetxt(ang_path, ang.reshape(n, 66), delimiter=",", fmt="%.6f")


def test_irds_loader_detects_the_moving_arm_from_the_columns(tmp_path: Path):
    f = tmp_path / "103_18_4_2_1_stand.txt"
    _write_irds(f, moving="Right")
    rep = mk.load_irds_rep(f)
    assert rep.arm == "right" and rep.correct and rep.healthy and rep.position == "stand"
    c = mk.curves(rep)
    assert abs(c.elevation.max() - 90) < 1 and abs(c.azimuth[int(c.elevation.argmax())] - 90) < 1
    patient = tmp_path / "205_18_4_2_2_wheelchair.txt"
    _write_irds(patient)
    p = mk.load_irds_rep(patient)
    assert not p.correct and not p.healthy and p.position == "wheelchair"


def test_uiprmd_forward_kinematics_rebuilds_world_joints(tmp_path: Path):
    p, a = tmp_path / "m07_s02_e03_positions.txt", tmp_path / "m07_s02_e03_angles.txt"
    _write_uiprmd(p, a, peak=90)
    rep = mk.load_uiprmd_rep(p, a, correct=True)
    assert rep.arm == "right" and rep.subject == "s02" and rep.rep_id == "e03"
    c = mk.curves(rep)
    assert abs(c.elevation.max() - 90) < 1.5
    assert abs(c.azimuth[int(c.elevation.argmax())] - 90) < 2  # mirrored to the rig's left


def _fixture_tree(root: Path):
    ui = root / "ui-prmd"
    for folder, suffix in (("Segmented Movements", ""), ("Incorrect Segmented Movements", "_inc")):
        for sub in ("Positions", "Angles"):
            (ui / folder / "Kinect" / sub).mkdir(parents=True)
        for m in (7, 8, 9, 10):
            for s in (1, 2):
                for e in (1, 2):
                    peak = {7: 150.0, 8: 60.0, 9: 100.0, 10: 100.0}[m] * (0.7 if suffix else 1.0) + 3 * e
                    _write_uiprmd(ui / folder / "Kinect" / "Positions" / f"m{m:02d}_s{s:02d}_e{e:02d}_positions{suffix}.txt", ui / folder / "Kinect" / "Angles" / f"m{m:02d}_s{s:02d}_e{e:02d}_angles{suffix}.txt", peak=peak)
    ir = root / "irds" / "SkeletonData" / "Simplified"
    ir.mkdir(parents=True)
    for subj, label, pos in (("103", "1", "stand"), ("104", "1", "stand"), ("205", "2", "chair"), ("206", "1", "wheelchair")):
        for g in (2, 3, 4, 5):
            for r in (1, 2):
                _write_irds(ir / f"{subj}_18_{g}_{r}_{label}_{pos}.txt", peak=160.0 if label == "1" else 80.0, moving="Right" if g in (2, 4) else "Left")


def test_main_builds_every_clip_and_the_reference_ranges(tmp_path: Path):
    ext = tmp_path / "external"
    _fixture_tree(ext)
    clips = tmp_path / "clips"
    ranges = tmp_path / "ranges.json"
    assert mk.main(["--external", str(ext), "--clips", str(clips), "--ranges", str(ranges)]) == 0
    names = {"pendulum", "flexion", "abduction", "scaption", "extension", "external_rotation", "internal_rotation"}
    assert {p.stem for p in clips.glob("*.json")} == names
    for name in names:
        clip = json.loads((clips / f"{name}.json").read_text())
        assert clip["side"] == "left" and clip["camera"] in ("front", "side") and clip["keys"][0]["t"] == 0
        assert clip["keys"][0]["hold"] and clip["keys"][-1]["hold"]
        assert len(clip["steps"]) == 3 and all("Step" in s["caption"] for s in clip["steps"])
        for k in clip["keys"]:
            for j in ("lShoulder", "lElbow", "spine"):
                assert len(k[j]) == 3 and all(abs(v) <= 360 for v in k[j])
        if name == "pendulum":
            assert clip["source"]["dataset"] == "procedural"
        else:
            assert clip["source"]["license"] in ("ODC PDDL 1.0", "CC BY 4.0")
            assert clip["source"]["subject"] and clip["source"]["rep"]
            for k in clip["keys"]:
                ch = k["check"]
                # the stored ua/fa are the rig-convention FK of the stored angles
                ua, fa = mk.rig_arm_directions(np.array(k["lShoulder"]), np.array(k["lElbow"]), np.array(k["spine"]))
                assert np.allclose(ua, ch["ua"], atol=1e-3) and np.allclose(fa, ch["fa"], atol=1e-3)
                # and they stay within the smoothing of the recorded skeleton
                src = np.array(ch["src_ua"]) / np.linalg.norm(ch["src_ua"])
                assert np.degrees(np.arccos(np.clip(np.dot(ua, src), -1, 1))) < 6
    abd = json.loads((clips / "abduction.json").read_text())
    assert "s0" in abd["source"]["subject"] and abd["target_deg"] > 100
    fl = json.loads((clips / "flexion.json").read_text())
    assert fl["source"]["subject"] in ("103", "104")  # healthy, standing, correct
    r = json.loads(ranges.read_text())
    src = r["exercises"]["abduction"]["sources"]
    ui = next(s for s in src if s["dataset"] == "ui-prmd")
    assert ui["correct"]["n"] == 4 and ui["incorrect"]["n"] == 4
    assert ui["correct"]["mean"] > ui["incorrect"]["mean"]
    assert {"mean", "sd", "n"} <= set(ui["correct"])
    assert r["exercises"]["pendulum"]["sources"] == []


def test_main_fails_clearly_without_data(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        mk.main(["--external", str(tmp_path / "nothing"), "--clips", str(tmp_path / "c"), "--ranges", str(tmp_path / "r.json"), "--only", "abduction"])
