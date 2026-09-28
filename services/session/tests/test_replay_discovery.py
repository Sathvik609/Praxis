"""Replay lists every clip that has a sidecar naming a camera-coached exercise, and nothing else:
real clips need replay-demo consent inside their 30-day window (no fabricated entries)."""

import datetime as dt
import json
from pathlib import Path

import cv2
import numpy as np

from praxis_session.replay import DEFAULT_V0_DIR, find_replay_clip, list_replay_clips

TODAY = dt.date(2026, 9, 26)


def _tiny_clip(path: Path, n: int = 6) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 15, (64, 48))
    rng = np.random.default_rng(0)
    for _ in range(n):
        w.write(rng.integers(0, 255, (48, 64, 3), dtype=np.uint8))
    w.release()


def _sidecar(path: Path, **over) -> None:
    meta = {
        "schema": "praxis.sidecar/1",
        "clip_id": path.stem,
        "exercise": "abduction",
        "side": "right",
        "view": "front",
        "synthetic": False,
        "consent": {"file": "consent/p01.json", "consented_on": "2026-09-20", "delete_after": "2026-10-20", "replay_demo": True},
        "clip_deleted_on": None,
    }
    meta.update(over)
    path.write_text(json.dumps(meta))


def _make(d: Path, name: str, video: bool = True, **over) -> None:
    if video:
        _tiny_clip(d / f"{name}.mp4")
    else:
        d.mkdir(parents=True, exist_ok=True)
    _sidecar(d / f"{name}.json", clip_id=name, **over)


def test_empty_dirs_list_only_the_synthetic_manifest(tmp_path: Path):
    clips = list_replay_clips(DEFAULT_V0_DIR, dirs=[tmp_path / "none"], today=TODAY)
    assert clips and all(c.synthetic and c.source == "manifest" for c in clips)
    assert {c.exercise for c in clips} == {"nhpt", "cup"}  # the arm entry is a landmark stream, not a video


def test_a_hidden_exercise_clip_cannot_be_replayed(client, tmp_path: Path, monkeypatch):
    _make(tmp_path, "p03_pendulum_1", exercise="pendulum", view="side")
    monkeypatch.setenv("PRAXIS_REPLAY_DIRS", str(tmp_path))
    assert not [c for c in client.get("/api/replay/list").json()["clips"] if c["id"] == "p03_pendulum_1"]
    assert find_replay_clip("p03_pendulum_1", tmp_path / "no_v0", dirs=[tmp_path], today=TODAY) is None


def test_recorded_arm_clips_appear_with_their_exercise_and_side(tmp_path: Path):
    _make(tmp_path / "p01" / "abduction", "p01_abduction_2")
    _make(tmp_path / "p01" / "abduction", "p01_abduction_1", side="left")
    clips = {c.id: c for c in list_replay_clips(tmp_path / "no_v0", dirs=[tmp_path], today=TODAY)}
    assert set(clips) == {"p01_abduction_2", "p01_abduction_1"}
    right = clips["p01_abduction_2"]
    assert (right.pipeline, right.sheet, right.side, right.synthetic) == ("arm", "none", "right", False)
    api = clips["p01_abduction_1"].to_api()
    assert api["mode"] == "abduction" and api["pipeline"] == "arm" and api["name"] == "Arm out to the side"
    assert api["path"] == "p01_abduction_1.mp4"


def test_nothing_is_listed_without_consent_a_video_or_a_coached_exercise(tmp_path: Path):
    _make(tmp_path, "no_demo_consent", consent={"file": "c.json", "delete_after": "2026-10-20", "replay_demo": False})
    _make(tmp_path, "expired", consent={"file": "c.json", "delete_after": "2026-09-26", "replay_demo": True})
    _make(tmp_path, "deleted", clip_deleted_on="2026-09-25")
    _make(tmp_path, "no_consent", consent=None)
    _make(tmp_path, "no_video", video=False)
    _make(tmp_path, "demo_only", exercise="external_rotation")
    # 28 Sep: hidden exercises are never offered for replay, even with consent
    _make(tmp_path, "hidden_pendulum", exercise="pendulum", view="side")
    _make(tmp_path, "hidden_flexion", exercise="flexion", view="side", synthetic=True, consent=None)
    _make(tmp_path, "unknown", exercise="scaption")
    (tmp_path / "x.labels.json").write_text("{}")
    (tmp_path / "broken.json").write_text("{not json")
    assert list_replay_clips(tmp_path / "no_v0", dirs=[tmp_path], today=TODAY) == []


def test_a_synthetic_sidecar_clip_needs_no_consent_and_stays_labelled(tmp_path: Path):
    _make(tmp_path, "render_abduction", synthetic=True, consent=None)
    (c,) = list_replay_clips(tmp_path / "no_v0", dirs=[tmp_path], today=TODAY)
    assert c.synthetic and c.exercise == "abduction"
    assert find_replay_clip("render_abduction", tmp_path / "no_v0", dirs=[tmp_path], today=TODAY) == c
    assert find_replay_clip("nope", tmp_path / "no_v0", dirs=[tmp_path], today=TODAY) is None


def test_env_var_sets_the_replay_folders(tmp_path: Path, monkeypatch):
    from praxis_session import replay

    _make(tmp_path / "a", "clip_a")
    monkeypatch.setenv("PRAXIS_REPLAY_DIRS", str(tmp_path / "a"))
    assert replay.replay_dirs() == [tmp_path / "a"]
    assert [c.id for c in list_replay_clips(tmp_path / "no_v0", today=TODAY)] == ["clip_a"]


def test_cli_list_prints_json(capsys, monkeypatch, tmp_path: Path):
    from praxis_session.replay import main

    monkeypatch.setenv("PRAXIS_REPLAY_DIRS", str(tmp_path))
    assert main(["--list"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert any(c["id"] == "synthetic_nhpt_01" and c["synthetic"] for c in out)


def test_api_lists_recorded_clip_and_ws_replays_it_as_its_own_exercise(client, tmp_path: Path, monkeypatch):
    _make(tmp_path, "p02_abduction_1", side="right")
    monkeypatch.setenv("PRAXIS_REPLAY_DIRS", str(tmp_path))
    clips = client.get("/api/replay/list").json()["clips"]
    rec = [c for c in clips if c["id"] == "p02_abduction_1"]
    assert rec and rec[0]["mode"] == "abduction" and rec[0]["side"] == "right" and not rec[0]["synthetic"]
    assert any(c["id"] == "synthetic_nhpt_01" and c["synthetic"] for c in clips)
    # the client asks for the wrong mode and side: the clip's sidecar wins
    with client.websocket_connect("/session?mode=nhpt&side=left&replay=p02_abduction_1") as ws:
        first = ws.receive_json()
        assert first["type"] == "replay_start" and first["clip"] == "p02_abduction_1"
        frame = ws.receive_json()
        while frame["type"] != "frame":
            frame = ws.receive_json()
        assert "arm" in frame and frame["arm"]["exercise"] == "abduction"
