"""evaluation/scripts/robustness.py: the synthetic perturbation sweep runs the real perception."""

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _load():
    spec = importlib.util.spec_from_file_location("robustness", ROOT / "evaluation" / "scripts" / "robustness.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["robustness"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_sweep_writes_labelled_synthetic_tables(tmp_path: Path):
    rb = _load()
    assert rb.main(["--out", str(tmp_path), "--only", "rotation"]) == 0
    res = json.loads((tmp_path / "robustness_v0.json").read_text())
    assert res["synthetic"] is True and res["opencv"].startswith("5.")
    groups = {c["group"] for c in res["conditions"]}
    assert groups == {"baseline", "rotation"}
    for c in res["conditions"]:  # a sheet laid sideways or upside down still reads
        n, cup = c["nhpt"], c["cup"]
        assert n["calibrated"] and n["occupancy_ok"] and n["free_peg_found"] and n["phantom_free"] == 0
        assert cup["calibrated"] and cup["cup_ok"] and cup["cup_err_mm"] < 3.0
        assert n["hint_ok"] and cup["hint_ok"]
        assert abs(n["tilt_deg"] - c["true_tilt_deg"]) < 2.0
    md = (tmp_path / "robustness_v0.md").read_text()
    assert "Synthetic renders, not real-camera evidence" in md
    assert "## NHPT board sheet" in md and "## Waiter – cup target sheet" in md


def test_every_condition_group_renders_a_frame():
    rb = _load()
    seen = set()
    for i, cond in enumerate(rb.conditions()):
        if cond.group in seen:
            continue
        seen.add(cond.group)
        for spec in (rb.NHPT_BOARD, rb.CUP_TARGETS):
            frame, H = rb.render(spec, rb.apply_marker_hands(cond, spec), {}, i)
            assert frame.shape == (480, 640, 3) and H.shape == (3, 3)
    assert {"tilt", "rotation", "distance", "light", "colour", "shadow", "noise", "blur", "jpeg",
            "occlusion", "hand", "peg colour", "cup colour", "background", "print", "paper",
            "mirror", "aspect", "combined", "lens"} <= seen


def test_mirrored_render_is_the_flipped_view():
    rb = _load()
    base = rb.Condition("b", "x", {"jpeg": 0, "noise": 0.0})
    mir = rb.Condition("m", "x", {"jpeg": 0, "noise": 0.0, "mirror": True})
    a, _ = rb.render(rb.NHPT_BOARD, base, {}, 1)
    b, _ = rb.render(rb.NHPT_BOARD, mir, {}, 1)
    assert (a[:, ::-1] == b).all()
