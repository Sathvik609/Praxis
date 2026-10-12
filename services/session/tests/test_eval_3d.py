"""The 3-D render scenarios, their ground truth and the scorer (fast: no Blender, no video).

evaluation/blender/scenario.py is pure Python; Blender only draws what it says. The one test that
needs Blender renders a single still and is skipped unless Blender is installed and
PRAXIS_BLENDER_TESTS=1 (it takes ~20 s).
"""

import importlib.util
import json
import math
import os
import subprocess
import sys
from pathlib import Path

import cv2
import pytest

ROOT = Path(__file__).resolve().parents[3]
BLENDER_DIR = ROOT / "evaluation" / "blender"
SCRIPTS = ROOT / "evaluation" / "scripts"
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


sys.path.insert(0, str(BLENDER_DIR))
scenario = _load("scenario", BLENDER_DIR / "scenario.py")
make3d = _load("make_dataset_3d", BLENDER_DIR / "make_dataset_3d.py")


def _sheet(exercise):
    from praxis_session.perception.board_spec import SHEETS

    return scenario.SheetGeom.from_dict(make3d.sheet_geom(SHEETS[make3d.SHEET_OF[exercise]]))


def _cond(exercise, **kw):
    return next(c for c in scenario.default_conditions() if c.exercise == exercise).__class__(
        **{**next(c for c in scenario.default_conditions() if c.exercise == exercise).to_dict(), **kw}
    )


def test_nhpt_script_seats_nine_pegs_once_each_with_labels_in_the_real_schema():
    from tools.dataset_v1 import validate_labels

    s = scenario.build_script(_cond("nhpt"), _sheet("nhpt"))
    lab = scenario.labels(s, [4] * 400)
    assert validate_labels(lab) == []
    assert sorted(r["hole"] for r in lab["reps"]) == list(range(9))
    ts = [(r["t_start"], r["t_end"]) for r in lab["reps"]]
    assert all(a < b for a, b in ts) and all(ts[i][1] < ts[i + 1][0] for i in range(8))
    assert lab["nhpt"]["t_start"] == ts[0][0] and lab["nhpt"]["t_end"] == ts[-1][1]
    tr = scenario.truth(s, [4] * 400)
    assert abs(sum(tr["splits_s"]) - lab["nhpt"]["total_s"]) < 1e-3
    # every peg ends standing on the paper in its hole
    holes = [scenario.sheet_to_world(x, y) for x, y in s.sheet.targets]
    end = {k: tr_.at(s.duration_s) for k, tr_ in s.objects.items()}
    for r in s.reps:
        p = end[f"peg{r['peg']}"]
        assert math.dist(p[:2], holes[r["hole"]][:2]) < 1e-6 and abs(p[2] - scenario.PEG_LEN_MM / 2) < 1e-6


def test_cup_script_is_two_slow_and_two_fast_arcs_along_the_dot_sequence():
    s = scenario.build_script(_cond("cup"), _sheet("cup"))
    lab = scenario.labels(s)
    assert len(lab["reps"]) == 32
    assert [r["to_dot"] for r in lab["reps"]] == scenario.ARC[1:] * 4
    tr = scenario.truth(s)
    slow = [r["reach_ms"] for r in tr["reaches"] if r["phase"] == "slow"]
    fast = [r["reach_ms"] for r in tr["reaches"] if r["phase"] == "fast"]
    assert len(slow) == len(fast) == 16 and max(fast) < min(slow)


def test_the_hand_lands_its_pinch_point_or_grip_on_the_target():
    shoulder = (300.0, -600.0, 330.0)
    target = (120.0, -150.0, 30.0)
    h = scenario.solve_hand(target, scenario.pose_vector("pinch"), 40.0, 1, shoulder, grip=False)
    assert math.dist(h.pinch, target) < 1e-6
    gl = scenario.grip_point_local(scenario.cup_radius_at(scenario.CUP_GRIP_Z_MM))
    g = scenario.solve_hand(target, scenario.pose_vector("grip"), 10.0, -1, shoulder, grip=True, grip_local=gl)
    f, lat, u = g.frame
    centre = tuple(g.wrist[i] + f[i] * gl[0] + lat[i] * gl[1] + u[i] * gl[2] for i in range(3))
    assert math.dist(centre, target) < 1e-6
    # the right hand's thumb is on its left (-X) when it points away from the patient, palm down
    rf = scenario.hand_frame((0.0, 1.0, 0.0), 0.0, 1, grip=False)
    assert rf[1][0] < -0.99


def test_every_condition_is_framed_like_camera_setup_leaves_it():
    # screen 05 will not start until all four markers are in view, so a condition whose near
    # corner falls outside the frame is moved back (and says so), and the others are untouched
    for c in scenario.default_conditions():
        sh = _sheet(c.exercise)
        f = scenario.framed(c, sh)
        aim = sh.targets_centre if c.exercise == "nhpt" else (sh.width_mm / 2, sh.height_mm / 2)
        half = sh.marker_size_mm / 2
        corners = [scenario.sheet_to_world(x + dx, y + dy) for x, y in sh.markers.values() for dx in (-half, half) for dy in (-half, half)]
        px = scenario.project_px(scenario.camera_pose(f, aim), corners)
        assert all(0 <= x <= 640 and 0 <= y <= 480 for x, y in px), c.id
        assert f.dist_mm >= c.dist_mm and (f.dist_mm == c.dist_mm or "moved back" in f.notes)


def test_marker_loss_spans_need_more_than_the_calibration_hold():
    fps = 10.0
    vis = [4] * 10 + [2] * 14 + [4] * 10 + [1] * 20 + [4] * 5
    spans = scenario.marker_loss_spans(vis, fps)
    assert len(spans) == 1  # 1.4 s under three markers is held; 2.0 s is not
    a, b = spans[0]
    assert abs(a - (3.4 + 1.5)) < 1e-9 and abs(b - 5.4) < 1e-9


def test_a_rep_overlapping_a_marker_loss_is_expected_unverified():
    s = scenario.build_script(_cond("cup"), _sheet("cup"))
    r0 = s.reps[3]
    fps = s.cond.fps
    n = int(s.duration_s * fps) + 1
    vis = [4] * n
    lo, hi = int((r0["t_start"] - 1.6) * fps), int((r0["t_end"]) * fps)
    for i in range(lo, hi):
        vis[i] = 2
    lab = scenario.labels(s, vis)
    assert lab["reps"][3]["expected"] == "unverified" and lab["reps"][3]["reason"] == "marker_lost"
    assert lab["reps"][0]["expected"] == "verified"


def test_sheet_texture_is_the_printed_page_and_its_markers_decode():
    from praxis_session.perception.board_spec import NHPT_BOARD, page_mm
    from praxis_session.perception.calibration import Calibrator

    img = make3d.sheet_texture(NHPT_BOARD, 4.0)
    pw, ph, _, _ = page_mm(NHPT_BOARD)
    assert abs(img.shape[1] - pw * 4) <= 1 and abs(img.shape[0] - ph * 4) <= 1
    frame = cv2.cvtColor(cv2.resize(img, (img.shape[1] // 2, img.shape[0] // 2)), cv2.COLOR_GRAY2BGR)
    assert Calibrator(NHPT_BOARD).run(frame, 0.0).missing == []


def _fake_dataset(tmp: Path) -> Path:
    """One NHPT and one cup entry with labels from the scripts and cached 'predictions' that
    reproduce the labels (cup) or miss and add a peg (NHPT)."""
    ds = tmp / "ds"
    ds.mkdir()
    entries = []
    for ex in ("nhpt", "cup"):
        c = _cond(ex)
        s = scenario.build_script(c, _sheet(ex))
        lab, tr = scenario.labels(s), scenario.truth(s)
        (ds / f"{c.id}.labels.json").write_text(json.dumps(lab))
        (ds / f"{c.id}.truth.json").write_text(json.dumps(tr))
        evs = []
        if ex == "nhpt":
            evs.append({"type": "nhpt_start", "t": lab["reps"][0]["t_end"], "t_start": lab["reps"][0]["t_end"], "inferred": True})
            for r in lab["reps"][:-1]:  # the last peg is missed
                evs.append({"type": "rep_complete", "t": r["t_end"] + 0.5, "hole": r["hole"], "t_seated": r["t_end"] + 0.3,
                            "verified": False, "reason": "grasp_not_seen"})
            evs.append({"type": "rep_complete", "t": 99.0, "hole": 0, "t_seated": 99.0, "verified": True, "reason": None})
        else:
            for r in lab["reps"]:
                evs.append({"type": "reach_complete", "t": r["t_end"] + 0.4, "to_dot": r["to_dot"], "t_placed": r["t_end"] + 0.1,
                            "reach_ms": round((r["t_end"] - r["t_start"]) * 1000 + 50, 1), "verified": True, "reason": None})
        pred = {"schema": "praxis.pred/1", "clip_id": c.id, "mode": ex, "exercise": ex, "source": "video",
                "settings": {"debounce_frames": 2, "clear_frames": 3}, "models": {"hand": True}, "frames": 100, "fps": 12.0,
                "nhpt_total_s": None, "coverage": {"frames": 100, "hand": 10, "calibrated": 100, "four_markers": 90, "three_markers": 10, "held": 0},
                "events": evs}
        (ds / f"{c.id}.pred.json").write_text(json.dumps(pred))
        entries.append({"id": c.id, "mode": ex, "sheet": make3d.SHEET_OF[ex], "video": f"{c.id}.avi", "labels": f"{c.id}.labels.json",
                        "truth": f"{c.id}.truth.json", "synthetic": True, "participant": "render3d", "condition": c.to_dict()})
    (ds / "manifest.json").write_text(json.dumps({"version": "3d_v0", "entries": entries}))
    return ds


def test_eval_3d_scores_cached_events_and_writes_a_labelled_synthetic_report(tmp_path):
    ev3 = _load("eval_3d", SCRIPTS / "eval_3d.py")
    ds = _fake_dataset(tmp_path)
    out = tmp_path / "res"
    assert ev3.main(["--dataset", str(ds), "--out", str(out), "--use-cache", "--today", "2026-10-12"]) == 0
    res = json.loads((out / "synthetic3d_v0.json").read_text())
    n, c = res["summary"]["nhpt"], res["summary"]["cup"]
    assert (n["tp"], n["fp"], n["fn"]) == (8, 1, 1)
    assert n["unverified_reasons"] == {"grasp_not_seen": 8} and n["timer_start_inferred"] == 1
    assert abs(n["event_time_bias_s"] - 0.3) < 1e-6 and n["split_n"] >= 7
    assert c["rep_f1"] == 1.0 and abs(c["reach_mae_ms"] - 50.0) < 0.2 and c["verified"] == 32
    md = (out / "synthetic3d_v0.md").read_text()
    assert md.splitlines()[0].startswith("# Synthetic 3-D renders")
    assert "Synthetic 3-D renders, not real-camera evidence" in md and "uv run python ../../evaluation/scripts/eval_3d.py" in md
    assert "OpenCV " + cv2.__version__ in md and "Misses with reasons" in md and "missed" in md


@pytest.mark.skipif(not (Path(BLENDER).exists() and os.environ.get("PRAXIS_BLENDER_TESTS") == "1"),
                    reason="needs Blender and PRAXIS_BLENDER_TESTS=1")
def test_blender_renders_a_still_where_all_four_markers_decode(tmp_path):
    r = subprocess.run([sys.executable, str(BLENDER_DIR / "make_dataset_3d.py"), "--only", "nhpt3d_01", "--still", "5",
                        "--out", str(tmp_path)], capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, r.stdout + r.stderr
    from praxis_session.perception.board_spec import NHPT_BOARD
    from praxis_session.perception.calibration import Calibrator

    img = cv2.imread(str(tmp_path / "work" / "nhpt3d_01" / "frames" / "still.png"))
    assert Calibrator(NHPT_BOARD).run(img, 0.0).missing == []
