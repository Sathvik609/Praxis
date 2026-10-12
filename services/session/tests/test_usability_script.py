"""evaluation/scripts/usability.py (moderated usability test: task outcomes, SEQ, issues, therapist table)."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
KIT = ROOT / "evaluation" / "usability"


def _load():
    spec = importlib.util.spec_from_file_location("usability_script", ROOT / "evaluation" / "scripts" / "usability.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["usability_script"] = mod
    spec.loader.exec_module(mod)
    return mod


def _csv(path: Path, template: str, rows: list[str]) -> Path:
    header = (KIT / template).read_text().strip()
    path.write_text("\n".join([header, *rows]) + "\n")
    return path


def test_wilson_interval():
    u = _load()
    lo, hi = u.wilson(5, 5)
    assert hi == 1.0 and 0.56 < lo < 0.57  # 5/5 -> [0.566, 1]
    lo, hi = u.wilson(0, 4)
    assert lo == 0.0 and 0.48 < hi < 0.50
    assert u.wilson(0, 0) == (None, None)


def test_task_summary(tmp_path):
    u = _load()
    p = _csv(tmp_path / "tasks.csv", "tasks_template.csv", [
        "p01,2026-10-14,T1,live,success,40,0,7,",
        "p02,2026-10-14,T1,live,assisted,150,2,4,looked in Settings",
        "p03,2026-10-14,T1,live,failed,240,5,2,",
        "p01,2026-10-14,T7,replay,success,60,0,6,",
    ])
    rows = u.read_tasks(p)
    s = u.summarise_tasks(rows)
    t1 = s["T1"]
    assert t1["n"] == 3 and t1["success"] == 1 and t1["assisted"] == 1 and t1["failed"] == 1
    assert t1["unaided_rate"] == pytest.approx(1 / 3, abs=1e-3)
    assert t1["completion_rate"] == pytest.approx(2 / 3, abs=1e-3)
    assert t1["median_time_s"] == 95.0  # median of completed tasks only (40, 150)
    assert t1["mean_seq"] == pytest.approx(13 / 3, abs=0.01)
    assert s["T7"]["modes"] == {"replay": 1}


@pytest.mark.parametrize("row,msg", [
    ("Sathvik,2026-10-14,T1,live,success,40,0,7,", "pseudonym"),
    ("p01,2026-10-14,T99,live,success,40,0,7,", "task"),
    ("p01,2026-10-14,T1,live,great,40,0,7,", "outcome"),
    ("p01,2026-10-14,T1,live,success,40,0,9,", "seq"),
    ("p01,2026-10-14,T1,phone,success,40,0,7,", "mode"),
])
def test_bad_rows_stop_the_run(tmp_path, row, msg):
    u = _load()
    p = _csv(tmp_path / "tasks.csv", "tasks_template.csv", [row])
    with pytest.raises(ValueError, match=msg):
        u.read_tasks(p)


def test_duplicate_task_row_rejected(tmp_path):
    u = _load()
    p = _csv(tmp_path / "tasks.csv", "tasks_template.csv", ["p01,2026-10-14,T1,live,success,40,0,7,"] * 2)
    with pytest.raises(ValueError, match="twice"):
        u.read_tasks(p)


def test_main_writes_results_with_issues_and_therapists(tmp_path):
    u = _load()
    tasks = _csv(tmp_path / "tasks.csv", "tasks_template.csv", [
        f"p0{i},2026-10-14,T{t},live,success,30,0,6," for i in range(1, 6) for t in (1, 2, 5)
    ])
    issues = _csv(tmp_path / "issues.csv", "issues_template.csv", [
        "i1,T5,pain button not noticed,1,2,",
        "i2,T3,setup list unclear,3,3,reworded 15 Oct",
    ])
    ther = _csv(tmp_path / "therapist.csv", "therapist_template.csv", ["t01,2026-10-15,PT,8,4,5,3,3,4,4,7,wants exportable report"])
    out = tmp_path / "out"
    assert u.main(["--tasks", str(tasks), "--issues", str(issues), "--therapists", str(ther), "--out", str(out)]) == 0
    doc = json.loads((out / "usability_v0.json").read_text())
    assert doc["participants"] == 5
    assert doc["issues"][0]["id"] == "i2"  # severity 3 before severity 2
    assert doc["therapists"]["n"] == 1 and doc["therapists"]["item_means"]["q2"] == 5
    md = (out / "usability_v0.md").read_text()
    assert "T5" in md and "Wilson" in md and "not a validated scale" in md
    assert "wants exportable report" not in md  # notes stay in the CSV


def test_main_without_responses(tmp_path):
    u = _load()
    assert u.main(["--tasks", str(tmp_path / "none.csv"), "--out", str(tmp_path)]) == 2


def test_templates_and_plan_agree():
    u = _load()
    plan = (KIT / "PLAN.md").read_text()
    for t in u.TASKS:
        assert f"| {t} |" in plan
