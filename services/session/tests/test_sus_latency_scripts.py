"""evaluation/scripts/sus.py (SUS scoring) and evaluation/scripts/latency.py (latency numbers)."""

from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "evaluation" / "scripts"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(f"{name}_script", SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"{name}_script"] = mod
    spec.loader.exec_module(mod)
    return mod


# ---- SUS ---------------------------------------------------------------------------------
def test_sus_score_follows_brooke():
    sus = _load("sus")
    assert sus.sus_score([5, 1] * 5) == 100.0  # best possible
    assert sus.sus_score([1, 5] * 5) == 0.0  # worst possible
    assert sus.sus_score([3] * 10) == 50.0  # neutral
    assert sus.sus_score([4, 2, 4, 1, 4, 2, 5, 2, 4, 2]) == 80.0  # (3+3+3+4+3+3+4+3+3+3) * 2.5
    with pytest.raises(ValueError):
        sus.sus_score([3] * 9)
    with pytest.raises(ValueError):
        sus.sus_score([0] + [3] * 9)


def _csv(path: Path, rows: list[str]) -> Path:
    header = (ROOT / "evaluation" / "sus" / "responses_template.csv").read_text().strip()
    path.write_text("\n".join([header, *rows]) + "\n")
    return path


def test_sus_script_writes_mean_sd_n_and_item_means(tmp_path: Path):
    sus = _load("sus")
    csv = _csv(tmp_path / "r.csv", [
        "p01,2026-10-14,4,2,4,1,4,2,5,2,4,2,used tap fallback",  # 80
        "p02,2026-10-14,5,1,5,1,5,1,5,1,5,1,",  # 100
        "",
        "P03,2026-10-15,3,3,3,3,3,3,3,3,3,3,",  # 50 (pseudonym case-folded)
    ])
    assert sus.main(["--csv", str(csv), "--out", str(tmp_path / "res")]) == 0
    doc = json.loads((tmp_path / "res" / "sus_v0.json").read_text())
    assert doc["n"] == 3 and doc["mean"] == pytest.approx(76.7) and doc["sd"] == pytest.approx(25.2)
    assert (doc["min"], doc["max"], doc["target_met"]) == (50.0, 100.0, True)
    assert doc["item_means"]["q1"] == 4.0 and [p["participant"] for p in doc["participants"]] == ["p01", "p02", "p03"]
    md = (tmp_path / "res" / "sus_v0.md").read_text()
    assert "n = 3" in md and "mean 76.7" in md and "Brooke 1996" in md and "too few" in md
    assert "tap fallback" not in md + json.dumps(doc)  # notes stay in the CSV


@pytest.mark.parametrize("row,msg", [
    ("Alice,2026-10-14,3,3,3,3,3,3,3,3,3,3,", "pseudonym"),
    ("p01,2026-10-14,3,3,3,3,,3,3,3,3,3,", "whole number"),
    ("p01,2026-10-14,3,3,3,3,6,3,3,3,3,3,", "1-5"),
])
def test_sus_script_refuses_bad_rows(tmp_path: Path, capsys, row, msg):
    sus = _load("sus")
    assert sus.main(["--csv", str(_csv(tmp_path / "r.csv", [row])), "--out", str(tmp_path)]) == 1
    assert msg in capsys.readouterr().out and not (tmp_path / "sus_v0.md").exists()


def test_sus_script_refuses_duplicates_and_missing_file(tmp_path: Path, capsys):
    sus = _load("sus")
    rows = ["p01,2026-10-14,3,3,3,3,3,3,3,3,3,3,"] * 2
    assert sus.main(["--csv", str(_csv(tmp_path / "r.csv", rows)), "--out", str(tmp_path)]) == 1
    assert "twice" in capsys.readouterr().out
    assert sus.main(["--csv", str(tmp_path / "none.csv"), "--out", str(tmp_path)]) == 2
    assert "responses_template.csv" in capsys.readouterr().out


# ---- latency -----------------------------------------------------------------------------
def test_latency_script_measures_the_real_socket_and_restores_the_app(tmp_path: Path):
    import praxis_session.main as main
    import praxis_session.trace as trace

    store_before, trace_before = main.store, trace.DEFAULT_DIR
    lat = _load("latency")
    assert lat.main(["--clips", "synthetic_nhpt_01,synthetic_cup_01", "--frames", "6", "--out", str(tmp_path), "--name", "lat_test"]) == 0
    doc = json.loads((tmp_path / "lat_test.json").read_text())
    assert doc["host"]["cv2_version"].startswith("5.") and len(doc["runs"]) == 2
    for r in doc["runs"]:
        assert r["kind"] == "live-style" and r["frames"] == 6 and r["dropped"] == 0
        assert r["capture_to_event_ms"]["n"] == 6 and r["capture_to_event_ms"]["p50"] >= 0
        assert r["proc_ms"]["p95"] >= r["proc_ms"]["p50"] > 0
        assert r["summary_latency"]["frames"] == 6  # the session summary agrees with the events
        assert "_capture_to_event_ms" not in r  # raw samples only feed the pooled row
    assert doc["pooled_live"]["capture_to_event_ms"]["n"] == 12
    md = (tmp_path / "lat_test.md").read_text()
    assert "capture→event" in md and "Not included" in md and "synthetic_cup_01" in md
    assert main.store is store_before and trace.DEFAULT_DIR == trace_before  # nothing leaks


def test_latency_script_lists_live_sessions_from_a_store_read_only(tmp_path: Path):
    from praxis_session.store import Store

    db = tmp_path / "praxis.db"
    st = Store(db)
    live = {"source": "live", "latency": {"frames": 300, "dropped": 2, "capture_to_event_p50": 41.0, "capture_to_event_p95": 88.5,
                                          "event_to_cue_p50": 1.2, "event_to_cue_p95": 3.4}}
    replay = {"source": "replay", "latency": {"frames": 10}}
    for sid, s in (("live1", live), ("rep1", replay)):
        st._db.execute("INSERT INTO sessions(id, mode, exercise, started_at, summary_json) VALUES (?,?,?,?,?)",
                       (sid, "cup", "cup", "2026-10-12T10:00:00", json.dumps(s)))
    st._db.commit()
    before = sqlite3.connect(db).execute("SELECT count(*) FROM sessions").fetchone()[0]
    lat = _load("latency")
    assert lat.main(["--clips", "", "--store", str(db), "--out", str(tmp_path)]) == 0
    doc = json.loads((tmp_path / "latency_v0.json").read_text())
    assert [s["session_id"] for s in doc["store"]] == ["live1"] and doc["store"][0]["capture_to_event_p95"] == 88.5
    assert "| live1 | cup |" in (tmp_path / "latency_v0.md").read_text()
    assert sqlite3.connect(db).execute("SELECT count(*) FROM sessions").fetchone()[0] == before


def test_latency_script_rejects_unknown_clips(tmp_path: Path, capsys):
    assert _load("latency").main(["--clips", "nope", "--out", str(tmp_path)]) == 2
    assert "unknown clip" in capsys.readouterr().out
