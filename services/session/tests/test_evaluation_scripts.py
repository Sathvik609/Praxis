import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "evaluation" / "scripts"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_make_and_eval_dataset_v0_on_synthetic_clip(tmp_path: Path):
    make = _load("make_dataset_v0")
    ev = _load("eval")
    ds = tmp_path / "ds"
    assert make.main(["--out", str(ds), "--hold", "3"]) == 0
    manifest = json.loads((ds / "manifest.json").read_text())
    assert manifest["entries"][0]["synthetic"] is True
    out = tmp_path / "res"
    assert ev.main(["--dataset", str(ds), "--out", str(out)]) == 0
    res = json.loads((out / "dataset_v0.json").read_text())
    assert res["rep_f1"] == 1.0 and res["nhpt_mae_s"] < 0.5
    assert res["n_synthetic"] == 2 and res["n_real"] == 0
    md = (out / "dataset_v0.md").read_text()
    assert "synthetic" in md.lower() and "Rep F1" in md


def test_match_reps_counts_fp_and_fn():
    ev = _load("eval")
    pred = [{"t": 1.0, "hole": 0}, {"t": 5.0, "hole": 2}]
    labeled = [{"t_seated": 1.1, "hole": 0}, {"t_seated": 3.0, "hole": 1}]
    tp, fp, fn, misses = ev.match_reps(pred, labeled, tol=0.5)
    assert (tp, fp, fn) == (1, 1, 1) and len(misses) == 2


def test_dataset_v0_includes_cup_and_reach_metrics(tmp_path: Path):
    make = _load("make_dataset_v0")
    ev = _load("eval")
    ds = tmp_path / "ds"
    assert make.main(["--out", str(ds), "--hold", "2"]) == 0
    manifest = json.loads((ds / "manifest.json").read_text())
    assert {e["mode"] for e in manifest["entries"]} == {"nhpt", "cup"}
    out = tmp_path / "res"
    assert ev.main(["--dataset", str(ds), "--out", str(out)]) == 0
    res = json.loads((out / "dataset_v0.json").read_text())
    assert res["rep_f1"] == 1.0 and res["reach_f1"] == 1.0
    assert res["reach_mae_ms"] is not None and res["reach_mae_ms"] < 150
