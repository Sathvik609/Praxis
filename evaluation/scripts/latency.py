"""Regenerate the latency numbers (report §8.2): capture->event, processing and
event->cue, p50/p95 (nearest rank, `praxis_session.latency.percentile`).

    cd services/session
    uv run python ../../evaluation/scripts/latency.py                    # synthetic clips, live-style
    uv run python ../../evaluation/scripts/latency.py --replay           # + the Replay socket (slow: real time)
    uv run python ../../evaluation/scripts/latency.py --video ../../evaluation/dataset_v1/raw/p01/abduction/<ts>.mp4 --mode arm
    uv run python ../../evaluation/scripts/latency.py --store praxis.db  # + browser-measured live sessions

Method. The real FastAPI WebSocket handler (`praxis_session.main`, `fastapi.testclient`, in
process, rule coach, a temporary store and trace folder so nothing real is written) is driven
the way the browser drives it: every frame of a clip is JPEG-encoded, prefixed with an 8-byte
float64 `t_capture` (ms since the epoch, taken just before sending) and the next frame is sent
only after the service's `frame` ack (ack-driven, like `useSessionSocket`). Samples come from
the events themselves, exactly as the live screen shows them:
  - capture->event = `frame.latency.capture_to_event_ms` (JPEG decode + queue + OpenCV + rules);
  - proc            = `frame.latency.proc_ms` (pipeline.process only);
  - event->cue      = `coach.latency.event_to_cue_ms` (stop rules + coach decision);
  - round trip      = client clock, send -> `frame` ack received.
`--replay` also streams each clip through the Replay socket (clip time, proc and event->cue only,
no capture time). `--store` lists the `summary.latency` block of every live session saved in a
Praxis SQLite store (read-only): those come from a real browser + webcam and include the JPEG
encode in the browser and the WebSocket hop; they are per-session percentiles, never pooled.

Not included in the in-process numbers: browser capture and JPEG encode, the network hop and the
render. Writes results/<name>.{json,md} (default latency_v0).
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import json
import os
import platform
import sqlite3
import struct
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve()
SESSION_DIR = HERE.parents[2] / "services" / "session"
sys.path.insert(0, str(SESSION_DIR))
import cv2  # noqa: E402

from praxis_session.latency import percentile  # noqa: E402

V0_DIR = HERE.parents[1] / "dataset_v0"
JPEG_QUALITY = 80  # the browser sends canvas.toBlob(..., "image/jpeg", 0.8)


def _r(v: float | None) -> float | None:
    return None if v is None else round(v, 1)


def stats(xs: list[float]) -> dict[str, Any]:
    return {"n": len(xs), "p50": _r(percentile(xs, 50)), "p95": _r(percentile(xs, 95)), "max": _r(max(xs)) if xs else None}


@contextlib.contextmanager
def _client(tmp: Path):
    """TestClient on the real app with a throwaway store and trace folder; everything it
    changed (environment, `main.store`, the trace folder) is put back afterwards."""
    env = {"PRAXIS_DB": str(tmp / "latency.db"), "PRAXIS_TRACE_DIR": str(tmp / "traces"), "PRAXIS_AGENT": "off"}
    old_env = {k: os.environ.get(k) for k in env}
    os.environ.update(env)  # only matters if praxis_session.main is imported for the first time
    from fastapi.testclient import TestClient

    import praxis_session.main as main
    import praxis_session.trace as trace
    from praxis_session.store import Store

    old_store, old_trace = main.store, trace.DEFAULT_DIR
    st = Store(tmp / "latency_store.db")
    st.seed_if_empty()
    main.store, trace.DEFAULT_DIR = st, tmp / "traces"
    try:
        with TestClient(main.app) as c:
            yield c
    finally:
        main.store, trace.DEFAULT_DIR = old_store, old_trace
        for k, v in old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _frames(path: Path, limit: int | None) -> tuple[list[bytes], float]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise SystemExit(f"cannot open {path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or 10.0
    out: list[bytes] = []
    while limit is None or len(out) < limit:
        ok, f = cap.read()
        if not ok:
            break
        if (f.shape[1], f.shape[0]) != (640, 480):
            f = cv2.resize(f, (640, 480), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        out.append(buf.tobytes())
    cap.release()
    return out, fps


def _url(mode: str, sheet: str, exercise: str | None, replay: str | None = None) -> str:
    q = f"/session?mode={mode}&sheet={sheet}"
    if exercise:
        q += f"&exercise={exercise}"
    if replay:
        q += f"&replay={replay}"
    return q


def _finish(ws) -> dict[str, Any]:
    """Send the screen-08 feedback and return the session summary (carries `latency`)."""
    ws.send_text(json.dumps({"cmd": "feedback", "pain_after": 1, "effort": 3, "compared": "same"}))
    while True:
        m = ws.receive_json()
        if m["type"] == "command" and m.get("cmd") == "feedback":
            return m["summary"]


def run_live(client, name: str, video: Path, mode: str, sheet: str, exercise: str | None, limit: int | None) -> dict[str, Any]:
    jpegs, fps = _frames(video, limit)
    cap_ev, proc, cue, rtt = [], [], [], []
    models: dict[str, Any] = {}
    with client.websocket_connect(_url(mode, sheet, exercise)) as ws:
        for jpeg in jpegs:
            t_send = time.time()
            ws.send_bytes(struct.pack("<d", t_send * 1000.0) + jpeg)
            while True:
                m = ws.receive_json()
                if m["type"] == "coach" and (m.get("latency") or {}).get("event_to_cue_ms") is not None:
                    cue.append(float(m["latency"]["event_to_cue_ms"]))
                if m["type"] == "frame":
                    rtt.append((time.time() - t_send) * 1000.0)
                    models = m.get("models") or models
                    lat = m.get("latency") or {}
                    if lat.get("capture_to_event_ms") is not None:
                        cap_ev.append(float(lat["capture_to_event_ms"]))
                    if lat.get("proc_ms") is not None:
                        proc.append(float(lat["proc_ms"]))
                    break
                if m["type"] == "error":
                    raise SystemExit(f"{name}: service error {m}")
        summary = _finish(ws)
    lat = summary.get("latency") or {}
    return {
        "_capture_to_event_ms": cap_ev, "_event_to_cue_ms": cue,  # raw samples for the pooled row
        "name": name, "kind": "live-style", "clip": str(video.name), "mode": mode, "exercise": exercise, "clip_fps": fps,
        "frames": len(jpegs), "dropped": lat.get("dropped"), "models": models,
        "capture_to_event_ms": stats(cap_ev), "proc_ms": stats(proc), "event_to_cue_ms": stats(cue), "round_trip_ms": stats(rtt),
        "summary_latency": lat, "coach": (summary.get("coach") or {}).get("label"),
    }


def run_replay(client, name: str, clip_id: str, mode: str, sheet: str) -> dict[str, Any]:
    proc, cue = [], []
    models: dict[str, Any] = {}
    with client.websocket_connect(_url(mode, sheet, None, clip_id)) as ws:
        first = ws.receive_json()
        if first["type"] != "replay_start":
            raise SystemExit(f"{name}: replay did not start: {first}")
        while True:
            m = ws.receive_json()
            if m["type"] == "frame" and (m.get("latency") or {}).get("proc_ms") is not None:
                proc.append(float(m["latency"]["proc_ms"]))
                models = m.get("models") or models
            if m["type"] == "coach" and (m.get("latency") or {}).get("event_to_cue_ms") is not None:
                cue.append(float(m["latency"]["event_to_cue_ms"]))
            if m["type"] == "replay_end":
                break
        summary = _finish(ws)
    return {"name": name, "kind": "replay", "clip": clip_id, "mode": mode, "frames": first.get("frames"), "models": models,
            "proc_ms": stats(proc), "event_to_cue_ms": stats(cue), "summary_latency": summary.get("latency") or {}}


def store_sessions(db: Path) -> list[dict[str, Any]]:
    """Per-session latency of live sessions in a Praxis store, read-only (no migration, no seed)."""
    from praxis_session.store import session_source

    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = []
    for r in con.execute("SELECT id, mode, exercise, started_at, summary_json FROM sessions ORDER BY started_at"):
        s = json.loads(r["summary_json"] or "{}")
        lat = s.get("latency")
        if not lat or session_source(s) != "live":
            continue
        rows.append({"session_id": r["id"], "mode": r["mode"], "exercise": r["exercise"], "started_at": r["started_at"], **lat})
    con.close()
    return rows


def host() -> dict[str, Any]:
    return {
        "platform": platform.platform(), "machine": platform.machine(), "processor": platform.processor(),
        "cpu_count": os.cpu_count(), "python": platform.python_version(), "cv2_version": cv2.__version__,
    }


def _cell(s: dict[str, Any] | None) -> str:
    if not s or s.get("p50") is None:
        return "–"
    return f"{s['p50']} / {s['p95']} (n={s['n']})"


def write_md(doc: dict[str, Any], path: Path) -> None:
    h = doc["host"]
    md = [
        f"# {path.stem}", "",
        f"Regenerated by `evaluation/scripts/latency.py` on {doc['date']} · {h['platform']} · {h['machine']} · "
        f"{h['cpu_count']} CPUs · Python {h['python']} · OpenCV {h['cv2_version']} · coach: rule-based.",
        "", "In process (`fastapi.testclient`), the real WebSocket handler, ack-driven like the browser. "
        "Times in ms, p50 / p95 (nearest rank). **Not included:** browser capture and JPEG encode, the network hop and render.",
        "", "Live-style runs send the next frame as soon as the ack returns, faster than real time on wall-clock "
        "timestamps, so the coach's cue rate limit lets fewer cues through than in the Replay runs (clip time); "
        "event→cue n is therefore small there. Replay runs carry no capture time by design.",
        "", "| run | kind | clip | models on | frames | capture→event | proc | event→cue | round trip |", "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in doc["runs"]:
        on = ", ".join(k for k, v in (r.get("models") or {}).items() if v) or "–"
        md.append(f"| {r['name']} | {r['kind']} | {r['clip']} | {on} | {r['frames']} | {_cell(r.get('capture_to_event_ms'))} | "
                  f"{_cell(r.get('proc_ms'))} | {_cell(r.get('event_to_cue_ms'))} | {_cell(r.get('round_trip_ms'))} |")
    p = doc.get("pooled_live") or {}
    if p:
        md += ["", f"**Pooled over the live-style runs:** capture→event {_cell(p['capture_to_event_ms'])}, "
               f"event→cue {_cell(p['event_to_cue_ms'])}."]
    if doc.get("store") is not None:
        md += ["", "## Live sessions in the store (browser + webcam, per session, not pooled)", ""]
        if not doc["store"]:
            md.append("_No live session with a latency block in this store._")
        else:
            md += ["| session | exercise | started | frames | dropped | capture→event p50 / p95 | event→cue p50 / p95 |", "|---|---|---|---|---|---|---|"]
            for s in doc["store"]:
                md.append(f"| {s['session_id']} | {s.get('exercise') or s.get('mode')} | {s.get('started_at')} | {s.get('frames')} | {s.get('dropped')} | "
                          f"{s.get('capture_to_event_p50')} / {s.get('capture_to_event_p95')} | {s.get('event_to_cue_p50')} / {s.get('event_to_cue_p95')} |")
    path.write_text("\n".join(md) + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="latency.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clips", default="synthetic_nhpt_01,synthetic_cup_01", help="dataset_v0 clip ids, comma list ('' = none)")
    ap.add_argument("--frames", type=int, default=None, help="at most this many frames per clip (default: all)")
    ap.add_argument("--replay", action="store_true", help="also run each clip through the Replay socket (real time)")
    ap.add_argument("--video", default=None, help="also measure this clip (e.g. a real dataset_v1 recording)")
    ap.add_argument("--mode", default="nhpt", choices=["nhpt", "cup", "arm"], help="pipeline for --video")
    ap.add_argument("--exercise", default="abduction", help="arm exercise for --video --mode arm (default abduction)")
    ap.add_argument("--store", default=None, help="a Praxis SQLite store whose live sessions to list (read-only)")
    ap.add_argument("--out", default=str(HERE.parents[1] / "results"))
    ap.add_argument("--name", default="latency_v0", help="output file stem (default: %(default)s)")
    args = ap.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((V0_DIR / "manifest.json").read_text())
    entries = {e["id"]: e for e in manifest["entries"] if e.get("video")}
    wanted = [c for c in args.clips.split(",") if c.strip()]
    unknown = [c for c in wanted if c not in entries]
    if unknown:
        print(f"unknown clip(s) {unknown}; known: {sorted(entries)}")
        return 2
    runs: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory() as td:
        with _client(Path(td)) as client:
            for cid in wanted:
                e = entries[cid]
                runs.append(run_live(client, cid, V0_DIR / e["video"], e["mode"], e.get("sheet", "nhpt_board"), None, args.frames))
            if args.video:
                sheet = {"nhpt": "nhpt_board", "cup": "cup_targets", "arm": "none"}[args.mode]
                runs.append(run_live(client, Path(args.video).stem, Path(args.video), args.mode, sheet,
                                     args.exercise if args.mode == "arm" else None, args.frames))
            if args.replay:
                for cid in wanted:
                    e = entries[cid]
                    runs.append(run_replay(client, f"{cid} (replay)", cid, e["mode"], e.get("sheet", "nhpt_board")))
    live = [r for r in runs if r["kind"] == "live-style"]
    doc: dict[str, Any] = {
        "date": dt.date.today().isoformat(), "host": host(), "method": "in-process fastapi.testclient, real WebSocket handler, ack-driven, rule coach",
        "pooled_live": _pooled(live) if live else {},  # from the raw samples, then dropped
        "runs": runs,
    }
    doc["store"] = store_sessions(Path(args.store)) if args.store else None
    (out / f"{args.name}.json").write_text(json.dumps(doc, indent=1) + "\n")
    write_md(doc, out / f"{args.name}.md")
    print(json.dumps({"runs": [{k: r.get(k) for k in ("name", "frames", "capture_to_event_ms", "proc_ms", "event_to_cue_ms")} for r in runs],
                      "pooled_live": doc["pooled_live"]}, indent=1))
    return 0


def _pooled(live: list[dict[str, Any]]) -> dict[str, Any]:
    """Pooled percentiles over the live-style runs' raw samples (removed from the runs so the
    JSON stays small)."""
    raw = {k: [x for r in live for x in r.pop(f"_{k}", [])] for k in ("capture_to_event_ms", "event_to_cue_ms")}
    return {k: stats(v) for k, v in raw.items()}


if __name__ == "__main__":
    sys.exit(main())
