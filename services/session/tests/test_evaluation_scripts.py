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
    syn = res["synthetic"]
    assert syn["nhpt"]["rep_f1"] == 1.0 and syn["nhpt"]["nhpt_mae_s"] < 0.5
    assert res["n_synthetic"] == 3 and res["n_real"] == 0 and res["real"] == {}
    md = (out / "dataset_v0.md").read_text()
    assert "synthetic" in md.lower() and "Rep F1" in md
    # the scorer runs the pipeline exactly as the app ships it
    assert res["debounce_frames"] == 2 and res["clear_frames"] == 3
    assert "debounce 2" in md and "clear 3" in md


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
    # Same 0.5 s phases as the shipped dataset_v0 (a 0.2 s phase is faster than any human and
    # shorter than the product's 3-frame hand-clear window, so it would score a different product).
    assert make.main(["--out", str(ds), "--hold", "5"]) == 0
    manifest = json.loads((ds / "manifest.json").read_text())
    assert {"nhpt", "cup"} <= {e["mode"] for e in manifest["entries"]}
    out = tmp_path / "res"
    assert ev.main(["--dataset", str(ds), "--out", str(out)]) == 0
    res = json.loads((out / "dataset_v0.json").read_text())
    # Honest product-default numbers on the synthetic cup clip: 31/32 reaches, 200 ms MAE
    # (results/dataset_v0.md). Not 1.0 / 0 ms — those came from debounce 1 / clear 1.
    syn = res["synthetic"]
    assert syn["nhpt"]["rep_f1"] == 1.0 and syn["cup"]["rep_f1"] >= 0.95
    assert syn["cup"]["reach_mae_ms"] is not None and syn["cup"]["reach_mae_ms"] < 250


def test_dataset_v0_includes_arm_landmark_entry(tmp_path: Path):
    make = _load("make_dataset_v0")
    ev = _load("eval")
    ds = tmp_path / "ds"
    assert make.main(["--out", str(ds), "--hold", "2"]) == 0
    manifest = json.loads((ds / "manifest.json").read_text())
    assert any(e["mode"] == "arm" and e["exercise"] == "abduction" for e in manifest["entries"])
    out = tmp_path / "res"
    assert ev.main(["--dataset", str(ds), "--out", str(out)]) == 0
    res = json.loads((out / "dataset_v0.json").read_text())
    arm = res["synthetic"]["abduction"]  # Arm out to the side, front-view landmark stream
    assert arm["rep_f1"] == 1.0 and arm["peak_mae_deg"] < 3.0


def test_agent_eval_scripted_passes_all_scenarios_without_violations(tmp_path: Path):
    ag = _load("agent_eval")
    assert ag.main(["--planner", "scripted", "--out", str(tmp_path / "res"), "--traces", str(tmp_path / "tr")]) == 0
    res = json.loads((tmp_path / "res" / "agent_v0.json").read_text())
    assert res["scenarios"] == 15 and res["task_success"] == 15 and res["guardrail_violations"] == 0
    assert len(list((tmp_path / "tr").glob("*.jsonl"))) == 15
    assert "Scripted planner" in (tmp_path / "res" / "agent_v0.md").read_text()
    rows = {r["id"]: r for r in res["rows"]}
    # 11 Oct scenarios: the peg-test explanation, an outage mid-session, the clamp outside the range
    assert rows["nhpt_checkpoint"]["checks"]["no_clinical_claims"] is True
    assert rows["agent_offline_mid_session"]["checks"]["recovered"] is True
    assert rows["outside_range_clamp"]["checks"]["clamp_traced"] is True
    assert rows["mcp_down"]["checks"]["direct_tools_ok"] is True
    assert all("errors_detail" in r for r in res["rows"])


def test_agent_eval_clinical_claims_and_clamp_checks_catch_bad_output():
    ag = _load("agent_eval")
    assert ag.clinical_claims("All nine pegs in 24.6 seconds; peg 7 took longest.") == []
    assert ag.clinical_claims("24.6 s is within the normal range for your age, a mild impairment.")
    rows = [{"name": "propose_adjustment", "ok": True, "args": {"field": "target_deg", "value": 45}, "result_summary": '{"ok": true, "value": 60.0, "clamped": true}'}]
    assert ag.clamp_traced(rows) is True
    rows[0]["result_summary"] = '{"ok": true, "value": 45.0, "clamped": false}'
    assert ag.clamp_traced(rows) is False


def test_agent_eval_rule_baseline_and_ablation(tmp_path: Path):
    """--planner rule: the same scenarios with the agent off, scored with the shared capability
    checks; the ablation table compares it with the scripted agent."""
    ag = _load("agent_eval")
    out = tmp_path / "res"
    assert ag.main(["--planner", "scripted", "--out", str(out), "--traces", str(tmp_path / "tr")]) == 0
    assert ag.main(["--planner", "rule", "--out", str(out), "--traces", str(tmp_path / "tr")]) == 0
    rule = json.loads((out / "agent_v0_rule.json").read_text())
    assert rule["guardrail_violations"] == 0
    caps = {r["id"]: r["capability"] for r in rule["rows"]}
    assert caps["green_cup"]["target_recovered"] is False and caps["covered_marker"]["camera_checked_resume"] is False
    assert caps["pain_stop_mid_run"]["stop_honoured"] is True
    abl = (out / "agent_ablation_v0.md").read_text()
    assert "Rule coach only (agent off)" in abl and "Agent (scripted planner)" in abl
    assert "| Resume gated by a fresh camera check | 5/5 | 0/5 |" in abl


def test_agent_eval_repeat_reports_a_pass_rate_interval(tmp_path: Path):
    ag = _load("agent_eval")
    assert ag.main(["--planner", "scripted", "--repeat", "2", "--scenario", "mcp_down", "--scenario", "falling_peaks", "--out", str(tmp_path), "--traces", str(tmp_path / "tr")]) == 0
    res = json.loads((tmp_path / "agent_v0.json").read_text())
    assert res["repeat"] == 2 and len(res["rows"]) == 4
    assert res["per_scenario"]["mcp_down"] == {"passes": 2, "runs": 2, "rate": 1.0}
    assert res["pass_rate"] == 1.0 and res["pass_rate_ci95"][1] == 1.0 and res["pass_rate_ci95"][0] < 1.0
    assert ag.wilson(9, 10)[0] < 0.9 < ag.wilson(9, 10)[1]


def test_agent_eval_real_model_needs_a_key_and_confirmation(tmp_path: Path, monkeypatch, capsys):
    ag = _load("agent_eval")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert ag.main(["--planner", "anthropic", "--out", str(tmp_path)]) == 2
    assert "estimated $" in capsys.readouterr().out
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-used")
    assert ag.main(["--planner", "anthropic", "--out", str(tmp_path)]) == 2  # no --yes: nothing is called
    assert "--yes" in capsys.readouterr().out
    assert not list(tmp_path.glob("*.md"))
