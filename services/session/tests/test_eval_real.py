"""eval.py on a dataset_v1 (real-recording) manifest, end to end:
record layout (tools/dataset_v1) -> praxis.labels/1 labels -> manifest -> replay through the
identical pipeline -> real-only tables, event cache, failure cases with consent only.

The clips are OpenCV renders standing in for recordings (the sidecars say `synthetic: false`
so the real code path runs); Arm out to the side runs from a VIDEO through `mode=arm` with the
pose model replaced by a stub that returns a scripted front-view figure per frame, because the
pose DNN cannot see a drawn figure. These tests check plumbing, never accuracy."""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

from praxis_session.perception.pose import PoseResult
from praxis_session.perception.synth import write_arm_landmarks, write_cup_clip, write_nhpt_clip
from tools import dataset_v1 as ds

ROOT = Path(__file__).resolve().parents[3]
TODAY = dt.date(2026, 10, 12)
NHPT_ORDER = [4, 0, 8, 2, 6, 1, 7, 3, 5]


def _load_eval():
    spec = importlib.util.spec_from_file_location("eval_real", ROOT / "evaluation" / "scripts" / "eval.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["eval_real"] = mod
    spec.loader.exec_module(mod)
    return mod


class StubPose:
    """Stands in for the pose ONNX models: returns the next scripted landmark set per frame."""

    stream: list[np.ndarray] = []
    available = True

    def __init__(self, *a, **k) -> None:
        self.i, self.last_ms = 0, 0.0

    def detect(self, frame):
        lm = StubPose.stream[self.i] if self.i < len(StubPose.stream) else None
        self.i += 1
        if lm is None:
            return None
        return PoseResult(landmarks_px=lm, visibility=np.ones(33, np.float32), world=np.zeros((33, 3), np.float32), conf=0.9)


class NoPose(StubPose):
    available = False


def _sidecar(raw: Path, participant: str, exercise: str, ts: str, consent_clips: bool, frames: int) -> ds.Clip:
    paths = ds.clip_paths(raw, participant, exercise, ts)
    paths["dir"].mkdir(parents=True, exist_ok=True)
    rec = ds.consent_record(participant, "yes", today=TODAY, consent_clips=consent_clips)
    meta = ds.build_sidecar(participant, exercise, ts, "left", rec, "consent.json", frames=frames)
    paths["sidecar"].write_text(json.dumps(meta, indent=1))
    return ds.Clip(paths["sidecar"], meta)


def _labels(c: ds.Clip, reps: list[dict], **extra) -> None:
    d = {"schema": ds.LABEL_SCHEMA, "clip_id": c.id, "exercise": c.exercise, "labeller": "T", "fps": 15.0,
         "complete": True, "reps": reps, **extra}
    assert ds.validate_labels(d) == [], ds.validate_labels(d)
    c.labels_path.write_text(json.dumps(d, indent=1))


def _rep(i: int, t0: float, t1: float, **kw) -> dict:
    return {"rep": i, "t_start": round(t0, 3), "t_end": round(t1, 3), "expected": "verified", "reason": None, "deliberate_error": None, **kw}


@pytest.fixture(scope="module")
def real_ds(tmp_path_factory):
    root = tmp_path_factory.mktemp("dataset_v1")
    raw = root / "raw"
    # NHPT (consent_clips yes; a clean run -> no misses -> no failure folder)
    c = _sidecar(raw, "p01", "nhpt", "20261012T100000", True, 0)
    lab = write_nhpt_clip(c.video, NHPT_ORDER, 10.0, 5, seed=1)
    reps = [_rep(r["rep"], r["t_lift"], r["t_seated"], hole=r["hole"]) for r in lab["reps"]]
    _labels(c, reps, nhpt=ds.nhpt_block(reps), drops=[])
    # Waiter – cup (consent_clips yes; one extra labelled reach the clip never shows -> a miss)
    c = _sidecar(raw, "p02", "cup", "20261012T110000", True, 0)
    lab = write_cup_clip(c.video, 10.0, 5, seed=3, phases=("slow",))
    reps = [_rep(r["rep"], r["t_lift"], r["t_placed"], to_dot=r["to_dot"]) for r in lab["reaches"]]
    last = reps[-1]["t_end"]
    reps.append(_rep(len(reps) + 1, last + 0.5, last + 1.2, to_dot=3))
    _labels(c, reps)
    # Arm out to the side from VIDEO (consent_clips NO; rep 2 labelled as a lean the stub never shows)
    c = _sidecar(raw, "p03", "abduction", "20261012T120000", False, 0)
    arm = write_arm_landmarks(root / "arm.jsonl", sets=1, reps=3, hold_s=3.4, fps=15, seed=2, frontal=True)
    stream = [np.asarray(json.loads(line)["landmarks_px"], np.float32) for line in (root / "arm.jsonl").read_text().splitlines() if line.strip()]
    w = cv2.VideoWriter(str(c.video), cv2.VideoWriter_fourcc(*"mp4v"), 15.0, (640, 480))
    for i in range(len(stream)):
        w.write(np.full((480, 640, 3), 40 + i % 100, np.uint8))
    w.release()
    reps = []
    for r in arm["reps"]:
        reps.append(_rep(r["rep"], r["t_start"], r["t_end"], peak_deg_goniometer=round(r["peak_deg"] + 3.0, 1),
                         compensation={"lean": r["rep"] == 2, "hike": False}))
    _labels(c, reps)
    path, m = ds.write_manifest(raw, root, today=TODAY)
    assert len(m["entries"]) == 3 and m["skipped"] == []
    return {"root": root, "raw": raw, "stream": stream, "manifest": m}


def _run(ev, real_ds, out: Path, *extra: str, pose=StubPose) -> int:
    StubPose.stream = real_ds["stream"]
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("praxis_session.pipeline.PoseTracker", pose)
        return ev.main(["--dataset", str(real_ds["root"]), "--out", str(out), "--failures", str(out / "failure_cases"),
                        "--today", TODAY.isoformat(), *extra])


@pytest.fixture(scope="module")
def first_run(real_ds, tmp_path_factory):
    ev = _load_eval()
    out = tmp_path_factory.mktemp("res")
    assert _run(ev, real_ds, out) == 0
    return ev, out, json.loads((out / "dataset_v1.json").read_text())


def test_real_manifest_scores_all_three_exercises_in_the_real_table_only(first_run):
    _, out, res = first_run
    assert res["n_real"] == 3 and res["n_synthetic"] == 0 and res["synthetic"] == {}
    real = res["real"]
    assert set(real) == {"nhpt", "cup", "abduction"}
    assert real["nhpt"]["rep_f1"] == 1.0 and real["nhpt"]["nhpt_mae_s"] < 0.5
    assert real["cup"]["fn"] >= 1 and real["cup"]["reach_mae_ms"] is not None
    a = real["abduction"]
    assert a["rep_f1"] == 1.0 and a["peak_n"] == 3
    assert a["peak_mae_deg"] == pytest.approx(3.0, abs=1.5) and a["peak_bias_deg"] < 0  # camera vs goniometer
    assert a["lean"] == {"labelled": 1, "detected": 0, "clean": 2, "false_alarm": 0, "detection_rate": 0.0, "false_alarm_rate": 0.0}
    arm_row = next(r for r in res["entries"] if r["exercise"] == "abduction")
    assert arm_row["source"] == "video" and arm_row["models"]["pose"] is True  # through mode=arm, not landmarks
    md = (out / "dataset_v1.md").read_text()
    assert "## Real recordings" in md and "Arm out to the side" in md and "goniometer" in md
    assert md.split("## Synthetic renders")[1].strip().splitlines()[2] == "_No entries in this group._"


def test_events_are_cached_without_pixels_next_to_the_labels(first_run, real_ds):
    for e in real_ds["manifest"]["entries"]:
        doc = json.loads((real_ds["root"] / e["pred"]).read_text())
        assert doc["schema"] == "praxis.pred/1" and doc["settings"] == {"debounce_frames": 2, "clear_frames": 3}
        types = {x["type"] for x in doc["events"]}
        assert "frame" not in types and "calibration" not in types
        assert types & {"rep_complete", "reach_complete"}


def test_failure_frames_only_for_consented_clips_with_misses(first_run, real_ds):
    _, out, res = first_run
    fc = out / "failure_cases"
    ids = {e["exercise"]: e["id"] for e in real_ds["manifest"]["entries"]}
    cup = fc / ids["cup"]
    reason = json.loads((cup / "reason.json").read_text())
    assert reason["consent_clips"] is True and reason["misses"]
    assert any(m["kind"] == "false_negative" for m in reason["misses"])
    jpgs = sorted(cup.glob("*.jpg"))
    assert jpgs and all(f.name in sum((m["frames"] for m in reason["misses"]), []) for f in jpgs)
    assert cv2.imread(str(jpgs[0])).shape == (480, 640, 3)
    arm_row = next(r for r in res["entries"] if r["exercise"] == "abduction")
    assert any(m["kind"] == "lean_missed" for m in arm_row["misses"])
    assert not (fc / ids["abduction"]).exists()  # a miss, but no consent for frames
    assert not (fc / ids["nhpt"]).exists()  # consent, but nothing missed
    assert res["failure_case_dirs"] == [str(cup)]


def test_after_deletion_the_cache_scores_and_no_clip_is_read(first_run, real_ds, tmp_path):
    ev, _, res = first_run
    later = (TODAY + dt.timedelta(days=31)).isoformat()
    StubPose.stream = []  # any replay of the arm clip would now find no person
    assert ev.main(["--dataset", str(real_ds["root"]), "--out", str(tmp_path), "--failures", str(tmp_path / "fc"), "--today", later]) == 0
    again = json.loads((tmp_path / "dataset_v1.json").read_text())
    assert all(r["from_cache"] for r in again["entries"])
    assert again["real"] == res["real"] and again["failure_case_dirs"] == [] and not (tmp_path / "fc").exists()


def test_missing_pose_model_refuses_to_score_a_real_arm_clip(real_ds, tmp_path, capsys):
    ev = _load_eval()
    assert _run(ev, real_ds, tmp_path, "--no-failure-frames", pose=NoPose) == 2
    assert "pose model is missing" in capsys.readouterr().out


def test_synthetic_and_real_entries_are_never_pooled(first_run, real_ds, tmp_path):
    ev, _, res = first_run
    root = tmp_path / "mixed"
    root.mkdir()
    v0 = ROOT / "evaluation" / "dataset_v0"
    m = dict(real_ds["manifest"])
    m["entries"] = [{**e, "video": str((real_ds["root"] / e["video"]).resolve()), "labels": str((real_ds["root"] / e["labels"]).resolve()),
                     "pred": str((real_ds["root"] / e["pred"]).resolve())} for e in m["entries"] if e["exercise"] == "nhpt"]
    syn = json.loads((v0 / "manifest.json").read_text())["entries"][0]
    m["entries"].append({**syn, "video": str(v0 / syn["video"]), "labels": str(v0 / syn["labels"])})
    (root / "manifest.json").write_text(json.dumps(m))
    assert ev.main(["--dataset", str(root), "--out", str(tmp_path), "--no-failure-frames", "--today", TODAY.isoformat(), "--use-cache"]) == 0
    mixed = json.loads((tmp_path / "dataset_v1.json").read_text())
    assert mixed["n_real"] == 1 and mixed["n_synthetic"] == 1
    assert mixed["real"]["nhpt"]["entries"] == 1 and mixed["synthetic"]["nhpt"]["entries"] == 1
    assert mixed["real"]["nhpt"]["labeled_reps"] == 9 and mixed["synthetic"]["nhpt"]["labeled_reps"] == 9


def test_a_sidecar_colour_sample_reaches_the_replay_and_keys_the_cache(tmp_path, monkeypatch):
    """RISKS 10 Oct: a clip recorded with a tap-sampled colour (non-blue cup band, wooden pegs)
    is replayed with that sample, not the default colours; the cache is keyed by it."""
    raw = tmp_path / "raw"
    c = _sidecar(raw, "p04", "cup", "20261012T130000", False, 0)
    meta = {**c.meta, "colour_sample": {"t": 0.5, "x_mm": 105.0, "y_mm": 60.0}}
    c.sidecar_path.write_text(json.dumps(meta))
    c = ds.Clip(c.sidecar_path, meta)
    entry = ds.manifest_entry(c, tmp_path, today=TODAY)
    assert entry["colour_sample"] == {"t": 0.5, "x_mm": 105.0, "y_mm": 60.0}
    plain = ds.manifest_entry(_sidecar(raw, "p05", "cup", "20261012T140000", False, 0), tmp_path, today=TODAY)
    assert "colour_sample" not in plain
    ev = _load_eval()
    seen = {}

    def fake_run_replay(path, **kw):
        seen.update(kw)
        from praxis_session.replay import ReplayResult

        return ReplayResult(path=str(path), mode=kw["mode"], fps=15.0, frames=0, reps=0, nhpt_total_s=None)

    monkeypatch.setattr(ev, "run_replay", fake_run_replay)
    import argparse

    doc = ev.replay_entry(entry, tmp_path, argparse.Namespace(debounce=2, clear=3))
    assert seen["colour_sample"] == entry["colour_sample"]
    assert doc["settings"] == {"debounce_frames": 2, "clear_frames": 3, "colour_sample": entry["colour_sample"]}


def test_no_manifest_says_how_to_make_one(tmp_path, capsys):
    assert _load_eval().main(["--dataset", str(tmp_path), "--out", str(tmp_path)]) == 2
    assert "dataset_v1.py manifest" in capsys.readouterr().out
