"""Recorder, labeller and dataset_v1 bookkeeping (tools/), on synthetic frames and temp dirs.
No camera and no window: the recorder is driven with a fake capture, the labeller through its
key-driven LabelState."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from tools import dataset_v1 as ds
from tools import label_clip as lc
from tools import record_session as rs

TODAY = dt.date(2026, 10, 12)


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


class FakeCap:
    """`n` frames of 640x480 synthetic video; each read advances `clock` by `dt` seconds."""

    def __init__(self, n: int, clock: Clock | None = None, dt: float = 0.0, size=(640, 480)) -> None:
        self.n, self.i, self.clock, self.dt, self.size = n, 0, clock, dt, size

    def read(self):
        if self.i >= self.n:
            return False, None
        self.i += 1
        if self.clock is not None:
            self.clock.t += self.dt
        f = np.full((self.size[1], self.size[0], 3), (self.i * 7) % 255, np.uint8)
        cv2.circle(f, (100 + self.i % 400, 240), 30, (0, 0, 255), -1)
        return True, f

    def release(self) -> None:
        pass


def _frames(path: Path) -> tuple[int, float, tuple[int, int]]:
    cap = cv2.VideoCapture(str(path))
    n = 0
    size = (0, 0)
    while True:
        ok, f = cap.read()
        if not ok:
            break
        size = (f.shape[1], f.shape[0])
        n += 1
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    return n, fps, size


# ---- recorder ----------------------------------------------------------------------------
def test_record_clip_writes_a_15fps_640x480_file_and_no_partial(tmp_path: Path):
    out = tmp_path / "raw" / "p01" / "cup" / "20261012T100000.mp4"
    stats = rs.record_clip(FakeCap(20, size=(1280, 720)), out, show=False, pace=False)
    assert stats["frames"] == 20 and out.exists()
    assert not list(out.parent.glob("*.part.*"))
    n, fps, size = _frames(out)
    assert n == 20 and fps == pytest.approx(15.0) and size == (640, 480)  # resized to 640x480


def test_record_clip_paces_a_30fps_camera_down_to_15fps_without_a_preview(tmp_path: Path):
    clock = Clock()
    out = tmp_path / "c.mp4"
    stats = rs.record_clip(FakeCap(60, clock, 1 / 30), out, show=False, clock=clock)  # 2 s of 30 fps
    assert 28 <= stats["frames"] <= 32  # ~15 fps: one in two camera frames
    assert stats["fps_measured"] == pytest.approx(15.0, abs=1.0)


def test_record_clip_with_no_frames_leaves_nothing(tmp_path: Path):
    out = tmp_path / "c.mp4"
    with pytest.raises(RuntimeError, match="no frames"):
        rs.record_clip(FakeCap(0), out, show=False, pace=False)
    assert list(tmp_path.iterdir()) == []


def _answers(*xs: str):
    it = iter(xs)
    return lambda _prompt="": next(it)


def _record(tmp_path: Path, answers, exercise="cup", extra=()):
    argv = [
        "--raw-dir", str(tmp_path / "raw"), "--consent-dir", str(tmp_path / "consent"),
        "record", "--participant", "p01", "--exercise", exercise, "--side", "right",
        "--camera-note", "above table 50 cm", "--lighting", "room", "--errors", "occluded_cup",
        "--by", "ST", "--no-preview", "--no-pace", "--today", TODAY.isoformat(), *extra,
    ]
    return rs.main(argv, inp=_answers("", *answers), cap=FakeCap(15))  # "" = default camera view


def test_record_without_a_typed_yes_records_nothing(tmp_path: Path, capsys):
    assert _record(tmp_path, ["no"]) == 3
    assert "no consent" in capsys.readouterr().out
    assert not (tmp_path / "raw").exists() and not (tmp_path / "consent").exists()


def test_record_writes_clip_sidecar_and_consent_with_30_day_deletion(tmp_path: Path):
    assert _record(tmp_path, ["yes", "no", "yes"]) == 0
    clips = ds.discover(tmp_path / "raw")
    assert len(clips) == 1
    c = clips[0]
    assert c.video.exists() and c.exercise == "cup" and c.pipeline == "cup" and c.side == "right"
    m = c.meta
    assert m["synthetic"] is False and m["sheet"] == "cup_targets" and m["frames"] == 15
    assert m["consent"]["delete_after"] == (TODAY + dt.timedelta(days=30)).isoformat()
    assert m["consent"]["replay_demo"] is False and m["consent"]["consent_clips"] is True
    assert m["planned_errors"] == ["occluded_cup"] and m["cv2_version"].startswith("5.")
    rec = json.loads((tmp_path / "consent" / f"p01_{TODAY.isoformat()}.json").read_text())
    assert rec["confirmation"] == "yes" and rec["clips"] == [c.id] and rec["retention_days"] == 30
    assert c.consent_clips(TODAY) and not c.consent_clips(TODAY + dt.timedelta(days=30))


def test_record_refuses_hidden_and_unknown_exercises(tmp_path: Path):
    for ex in ("flexion", "pendulum", "external_rotation"):
        with pytest.raises(SystemExit):
            _record(tmp_path, ["yes"], exercise=ex)
        with pytest.raises(ValueError):
            ds.check_exercise(ex)
    assert set(ds.coached()) == {"abduction", "cup", "nhpt"}


def test_record_refuses_a_raw_dir_git_would_commit(tmp_path: Path, capsys):
    inside = ds.ROOT / "services" / "session" / "tools" / "_not_ignored_clips"
    argv = ["--raw-dir", str(inside), "--consent-dir", str(tmp_path / "consent"), "record",
            "--participant", "p01", "--exercise", "nhpt", "--side", "left", "--no-preview", "--no-pace"]
    assert rs.main(argv, inp=_answers("yes", "no", "no"), cap=FakeCap(5)) == 4
    assert "REFUSED" in capsys.readouterr().out and not inside.exists()
    assert not (tmp_path / "consent").exists()


def test_default_raw_dir_and_failure_frames_are_git_ignored():
    assert ds.video_dir_is_private(ds.RAW_DIR / "p01" / "cup") == (True, "git-ignored")
    assert ds.video_dir_is_private(ds.FAILURE_DIR / "p01_cup_x")[0] is True
    assert ds.video_dir_is_private(ds.ROOT / "docs")[0] is False


def test_consent_requires_a_pseudonym_and_yes():
    with pytest.raises(PermissionError):
        ds.consent_record("p01", "y")
    with pytest.raises(ValueError):
        ds.consent_record("Alice", "yes")


# ---- deletion ----------------------------------------------------------------------------
def _fake_clip(raw: Path, participant="p01", exercise="nhpt", ts="20261012T100000", today=TODAY, consent_clips=True, video=True) -> ds.Clip:
    paths = ds.clip_paths(raw, participant, exercise, ts)
    paths["dir"].mkdir(parents=True, exist_ok=True)
    rec = ds.consent_record(participant, "yes", today=today, consent_clips=consent_clips)
    meta = ds.build_sidecar(participant, exercise, ts, "left", rec, "consent.json", frames=10)
    paths["sidecar"].write_text(json.dumps(meta))
    if video:
        paths["video"].write_bytes(b"not really video")
    return ds.Clip(paths["sidecar"], meta)


def test_purge_expired_deletes_clip_and_failure_frames_but_keeps_labels(tmp_path: Path):
    raw, fail = tmp_path / "raw", tmp_path / "failure_cases"
    c = _fake_clip(raw)
    c.labels_path.write_text("{}")
    (fail / c.id).mkdir(parents=True)
    (fail / c.id / "miss_0.jpg").write_bytes(b"x")
    assert ds.purge_expired(raw, today=TODAY + dt.timedelta(days=29), failure_dir=fail) == []
    dry = ds.purge_expired(raw, today=TODAY + dt.timedelta(days=30), failure_dir=fail, dry_run=True)
    assert len(dry) == 1 and c.video.exists()
    out = ds.purge_expired(raw, today=TODAY + dt.timedelta(days=30), failure_dir=fail)
    assert out[0]["reason"] == "retention_30_days"
    assert not c.video.exists() and not (fail / c.id).exists() and c.labels_path.exists()
    meta = json.loads(c.sidecar_path.read_text())
    assert meta["clip_deleted_on"] == (TODAY + dt.timedelta(days=30)).isoformat()


def test_withdraw_deletes_only_that_participant(tmp_path: Path):
    raw = tmp_path / "raw"
    a, b = _fake_clip(raw, "p01"), _fake_clip(raw, "p02")
    ds.withdraw("p01", raw, today=TODAY, failure_dir=tmp_path / "f", remove_derived=True)
    assert not (raw / "p01").exists() and b.video.exists() and not a.video.exists()


def test_cli_purge_runs(tmp_path: Path, capsys):
    raw = tmp_path / "raw"
    _fake_clip(raw)
    assert rs.main(["--raw-dir", str(raw), "--failure-dir", str(tmp_path / "f"), "purge-expired", "--today", "2026-12-01"]) == 0
    assert json.loads(capsys.readouterr().out)["deleted"][0]["reason"] == "retention_30_days"


# ---- labeller ----------------------------------------------------------------------------
def _press(st: lc.LabelState, keys: list[tuple[str, float]]) -> None:
    for k, t in keys:
        st.key(k, t)


def test_labeller_nhpt_reps_holes_drop_and_timer_block_validate():
    st = lc.LabelState("p01_nhpt_x", "nhpt", "ST", 15.0)
    for i in range(9):
        _press(st, [("s", 1.0 + 2 * i), ("e", 2.0 + 2 * i), (str(i + 1), 2.0 + 2 * i)])
    _press(st, [("p", 5.5), ("o", 18.0), ("c", 18.0)])
    d = st.to_json()
    assert ds.validate_labels(d) == []
    assert [r["hole"] for r in d["reps"]] == list(range(9))
    assert d["nhpt"] == {"t_start": 1.0, "t_end": 18.0, "total_s": 17.0}
    assert d["drops"] == [5.5] and d["complete"] is True
    assert d["reps"][-1]["expected"] == "unverified" and d["reps"][-1]["reason"] == "occluded"
    assert ds.label_warnings(d) == []


def test_labeller_arm_compensation_gonio_reason_and_error():
    st = lc.LabelState("p01_abduction_x", "abduction", "ST", 15.0)
    st.apply_gonio([88.0, None, 95.5])
    _press(st, [("s", 1.0), ("e", 6.0), ("l", 6.0)])
    _press(st, [("s", 7.0), ("e", 12.0), ("h", 12.0), ("r", 12.0), ("r", 12.0), ("r", 12.0)])
    _press(st, [("s", 13.0), ("e", 18.0), ("d", 18.0), ("d", 18.0), ("d", 18.0)])
    _press(st, [("g", 18.0), ("9", 0), ("6", 0), ("enter", 0)])  # typed value wins over --gonio
    d = st.to_json()
    assert ds.validate_labels(d) == [], ds.validate_labels(d)
    r1, r2, r3 = d["reps"]
    assert r1["compensation"] == {"lean": True, "hike": False} and r1["peak_deg_goniometer"] == 88.0
    assert r2["compensation"]["hike"] and r2["expected"] == "unverified" and r2["reason"] == "hold_too_short"
    assert r2["peak_deg_goniometer"] is None
    assert r3["deliberate_error"] == "past_ceiling" and r3["peak_deg_goniometer"] == 96.0


def test_labeller_cup_dots_and_warnings():
    st = lc.LabelState("p01_cup_x", "cup", "ST", 15.0)
    _press(st, [("s", 1.0), ("e", 2.0), ("2", 2.0), ("s", 3.0), ("e", 4.0), ("2", 4.0)])
    d = st.to_json()
    assert ds.validate_labels(d) == [] and [r["to_dot"] for r in d["reps"]] == [1, 1]
    assert any("same dot" in w for w in ds.label_warnings(d))


def test_labeller_ignores_an_end_before_the_start_and_deletes_reps():
    st = lc.LabelState("p01_cup_x", "cup", "ST", 15.0)
    _press(st, [("s", 5.0), ("e", 4.0)])
    assert st.reps == [] and "ignored" in st.message
    _press(st, [("e", 6.0), ("x", 6.0)])
    assert st.reps == []


def test_schema_refuses_hidden_exercises_and_unexplained_unverified():
    d = lc.LabelState("p01_flexion_x", "flexion", "ST", 15.0).to_json()
    assert any("flexion" in e for e in ds.validate_labels(d))
    st = lc.LabelState("p01_cup_x", "cup", "ST", 15.0)
    _press(st, [("s", 1.0), ("e", 2.0)])
    d = st.to_json()
    d["reps"][0].update(expected="unverified", reason=None)
    assert any("needs a reason" in e for e in ds.validate_labels(d))
    d["reps"][0].update(expected="verified", t_end=0.5)
    assert any("t_end < t_start" in e for e in ds.validate_labels(d))


def test_label_clip_validate_only_and_friendly_errors(tmp_path: Path, capsys):
    c = _fake_clip(tmp_path / "raw", exercise="cup")
    assert lc.main([str(c.video), "--validate-only"]) == 1  # no labels yet
    st = lc.LabelState(c.id, "cup", "ST", 15.0)
    _press(st, [("s", 1.0), ("e", 2.0), ("2", 2.0), ("c", 2.0)])
    assert lc.write_labels(st, c.labels_path) == []
    capsys.readouterr()
    assert lc.main([str(c.video), "--validate-only"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["errors"] == [] and out["complete"] is True
    with pytest.raises(SystemExit):
        lc.main([str(c.video)])  # --labeller required when labelling


def test_label_clip_reads_fps_from_the_file(tmp_path: Path):
    p = tmp_path / "x.mp4"
    rs.record_clip(FakeCap(5), p, fps=10.0, show=False, pace=False)
    assert lc.clip_fps(p, {"fps": 15}) == pytest.approx(10.0)
    assert lc.clip_fps(tmp_path / "missing.mp4", {"fps": 15}) == 15.0


# ---- manifest + status -------------------------------------------------------------------
def _label(c: ds.Clip, n: int, complete=True) -> None:
    st = lc.LabelState(c.id, c.exercise, "ST", 15.0)
    for i in range(n):
        _press(st, [("s", 1.0 + 2 * i), ("e", 2.0 + 2 * i), (str(i % 5 + 1), 2.0 + 2 * i)])
    if complete:
        st.key("c", 0)
    lc.write_labels(st, c.labels_path)


def test_manifest_lists_complete_labelled_clips_and_says_why_others_are_skipped(tmp_path: Path):
    raw, dsd = tmp_path / "dataset_v1" / "raw", tmp_path / "dataset_v1"
    ok = _fake_clip(raw, "p01", "cup", "20261012T100000")
    _label(ok, 8)
    _label(_fake_clip(raw, "p02", "cup", "20261012T110000"), 3, complete=False)
    _fake_clip(raw, "p03", "nhpt", "20261012T120000")
    gone = _fake_clip(raw, "p04", "abduction", "20261012T130000", video=False)
    _label(gone, 2)
    path, m = ds.write_manifest(raw, dsd, today=TODAY)
    assert path == dsd / "manifest.json" and json.loads(path.read_text()) == m
    assert m["version"] == "v1" and [e["id"] for e in m["entries"]] == [ok.id]
    e = m["entries"][0]
    assert e["synthetic"] is False and e["mode"] == "cup" and e["sheet"] == "cup_targets"
    assert e["video"] == "raw/p01/cup/20261012T100000.mp4" and e["consent_clips"] is True
    reasons = {s["id"]: s["reason"] for s in m["skipped"]}
    assert "not marked complete" in reasons["p02_cup_20261012T110000"]
    assert "not labelled" in reasons["p03_nhpt_20261012T120000"]
    assert "cannot be scored" in reasons[gone.id]
    st = ds.status(raw)
    assert st["per_exercise"]["cup"]["reps"] == 8 and st["per_exercise"]["cup"]["clips"] == 2
    assert st["labelled_reps"] == 10 and st["target_met"] is False


def test_dataset_cli_status_validate_manifest(tmp_path: Path, capsys):
    raw, dsd = tmp_path / "raw", tmp_path
    c = _fake_clip(raw, "p01", "cup")
    _label(c, 4)
    assert ds.main(["--raw-dir", str(raw), "--dataset-dir", str(dsd), "status"]) == 0
    assert "4 / 300" in capsys.readouterr().out
    assert ds.main(["--raw-dir", str(raw), "validate"]) == 0
    assert ds.main(["--raw-dir", str(raw), "--dataset-dir", str(dsd), "manifest"]) == 0
    assert "1 entries" in capsys.readouterr().out and (dsd / "manifest.json").exists()
