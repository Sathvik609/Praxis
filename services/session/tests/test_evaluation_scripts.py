"""The evaluation scripts must regenerate the synthetic dataset and score it end to end."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "evaluation" / "scripts"


def test_make_and_eval_dataset_v0(tmp_path: Path) -> None:
    ds = tmp_path / "dataset_v0"
    subprocess.run([sys.executable, str(SCRIPTS / "make_dataset_v0.py"), "--out", str(ds), "--hold", "3"],
                   check=True, cwd=Path(__file__).resolve().parents[1])
    manifest = json.loads((ds / "manifest.json").read_text())
    assert len(manifest["entries"]) >= 2
    assert all(e["synthetic"] is True for e in manifest["entries"])
    assert {e["mode"] for e in manifest["entries"]} == {"nhpt", "pegboard"}
    for e in manifest["entries"]:
        assert (ds / e["video"]).exists()
        assert (ds / e["labels"]).exists()

    res_dir = tmp_path / "results"
    subprocess.run([sys.executable, str(SCRIPTS / "eval_dataset_v0.py"), "--dataset", str(ds), "--out", str(res_dir)],
                   check=True, cwd=Path(__file__).resolve().parents[1])
    results = json.loads((res_dir / "dataset_v0.json").read_text())
    assert (res_dir / "dataset_v0.md").exists()
    assert results["rep_f1"] == 1.0
    assert results["nhpt_mae_s"] <= 0.5
    assert results["n_labeled_reps"] >= 29  # 9 (nhpt) + 20 (pegboard)
