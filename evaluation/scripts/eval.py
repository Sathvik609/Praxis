"""Score every manifest entry by replaying it through the identical pipeline the app uses.

    cd services/session
    uv run python ../../evaluation/scripts/eval.py                                         # dataset_v0 (synthetic)
    uv run python ../../evaluation/scripts/eval.py --dataset ../../evaluation/dataset_v1   # real recordings

Every video entry runs through `praxis_session.replay.run_replay` (cv2.__version__ == 5.0.0):
the same `SessionPipeline` the live and Replay sockets build, at **product defaults**
(`--debounce 2 --clear 3`; change them only to study sensitivity, never for a headline table).
Arm out to the side runs from the VIDEO through the pose model (`mode=arm`, `exercise=abduction`,
the clip's side), exactly like a Replay session; only the synthetic dataset_v0 entry uses a
landmark stream (the pose DNN cannot see a drawn figure).

Metrics, per exercise, computed separately for **real** and **synthetic** entries (never mixed):
  - rep F1: a predicted rep matches a labelled rep on the same hole / dot when its time (NHPT
    seat, cup placement, arm back down) lands within [-tol, tol + 1.0] s of the labelled time
    (the extra second allows for the pipeline's debounce / hand-clear confirmation);
  - verified agreement: matched reps where the product's verified/unverified equals the label;
  - NHPT total-time MAE (s), cup reach-time MAE (ms);
  - Arm out to the side peak-angle error (deg) against the goniometer-app reading
    (`peak_deg_goniometer`; synthetic: the rendered angle), MAE and mean signed error;
  - compensation detection (trunk lean, shoulder hike) where labelled: detected / labelled and
    false alarms / clean reps, on matched reps.

Real entries (dataset_v1) also:
  - cache their events in `<clip>.pred.json` (events and numbers only, no pixels) so the numbers
    stay regenerable after the 30-day clip deletion; a deleted or expired clip is scored from
    the cache, never read;
  - write every miss to `evaluation/failure_cases/<clip_id>/` (JPEG frames around the miss +
    reason.json), only when the manifest entry says `consent_clips: true` and the clip's consent
    still holds. That folder is git-ignored and deleted with the clip.

Writes results/dataset_<version>.{json,md}.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[2] / "services" / "session"))
import cv2  # noqa: E402

from praxis_session.replay import run_landmark_replay, run_replay  # noqa: E402

EXERCISE_BY_MODE = {"nhpt": "nhpt", "cup": "cup", "arm": "abduction"}
NAMES = {"nhpt": "Nine-Hole Peg Test", "cup": "Waiter – cup", "abduction": "Arm out to the side", "flexion": "Arm to the front (hidden)"}
PRED_SCHEMA = "praxis.pred/1"
CACHE_TYPES = {
    "rep_complete", "reach_complete", "nhpt_start", "nhpt_complete", "compensation_lean",
    "shoulder_hiking", "target_missed", "hold_too_short", "perception_lost", "perception_regained",
    "wrong_hole", "wrong_dot", "drop", "set_complete", "arm_complete", "arc_complete",
}
FRAME_OFFSETS_S = (-1.0, -0.5, 0.0, 0.5, 1.0)
SLACK_S = 1.0


# ---- matching ----------------------------------------------------------------------------
def match_reps(pred: list[dict], labeled: list[dict], tol: float, key: str = "hole", t_key: str = "t_seated"):
    """Greedy one-to-one matching in time order. Returns tp, fp, fn, misses. A matched
    prediction gets `matched` = the label's index."""
    used: set[int] = set()
    tp = 0
    misses = []
    for p in pred:
        best = None
        for j, lab in enumerate(labeled):
            if j in used or lab[key] != p[key]:
                continue
            d = p["t"] - lab[t_key]
            if -tol <= d <= tol + SLACK_S and (best is None or abs(d) < abs(best[1])):
                best = (j, d)
        if best is None:
            misses.append({"kind": "false_positive", "pred": p})
        else:
            used.add(best[0])
            tp += 1
            p["matched"] = best[0]
    fn = [lab for j, lab in enumerate(labeled) if j not in used]
    misses += [{"kind": "false_negative", "label": lab} for lab in fn]
    return tp, len(pred) - tp, len(fn), misses


def prf(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


# ---- labels: dataset_v0 (synthetic) and praxis.labels/1 (real) -> one shape ------------
def normalise_labels(labels: dict[str, Any], exercise: str) -> dict[str, Any]:
    """{reps: [{key, t, expected_verified, reach_ms?, angle_ref?, lean?, hike?}], total_s, complete}"""
    out: dict[str, Any] = {"reps": [], "total_s": None, "complete": True}
    if labels.get("schema") == "praxis.labels/1":
        out["complete"] = bool(labels.get("complete"))
        for r in labels["reps"]:
            row = {"key": 0, "t": r["t_end"], "t_start": r["t_start"], "expected_verified": r["expected"] == "verified",
                   "reason": r.get("reason"), "deliberate_error": r.get("deliberate_error"), "rep": r["rep"]}
            if exercise == "nhpt":
                row["key"] = r["hole"]
            elif exercise == "cup":
                row["key"] = r["to_dot"]
                row["reach_ms"] = round((r["t_end"] - r["t_start"]) * 1000.0, 1)
            else:
                row["angle_ref"] = r.get("peak_deg_goniometer")
                comp = r.get("compensation") or {}
                row["lean"], row["hike"] = comp.get("lean"), comp.get("hike")
            out["reps"].append(row)
        if exercise == "nhpt" and labels.get("nhpt"):
            out["total_s"] = labels["nhpt"]["total_s"]
        return out
    # dataset_v0 synthetic renders: every rendered rep is a correct, fully visible rep
    if exercise == "nhpt":
        out["reps"] = [{"key": r["hole"], "t": r["t_seated"], "expected_verified": True, "rep": r["rep"]} for r in labels["reps"]]
        out["total_s"] = labels["nhpt"]["total_s"]
    elif exercise == "cup":
        out["reps"] = [{"key": r["to_dot"], "t": r["t_placed"], "reach_ms": r["reach_ms"], "expected_verified": True, "rep": r["rep"]} for r in labels["reaches"]]
    else:
        out["reps"] = [{"key": 0, "t": r["t_end"], "angle_ref": r["peak_deg"], "expected_verified": True, "rep": r["rep"]} for r in labels["reps"]]
    return out


# ---- predictions ------------------------------------------------------------------------
def predictions(events: list[dict[str, Any]], mode: str) -> list[dict[str, Any]]:
    """Rep-level predictions from the pipeline's events (dicts, as cached)."""
    out = []
    for e in events:
        if mode == "nhpt" and e["type"] == "rep_complete":
            out.append({"key": e["hole"], "t": e.get("t_seated", e["t"]), "verified": e.get("verified", True), "reason": e.get("reason")})
        elif mode == "cup" and e["type"] == "reach_complete":
            out.append({"key": e["to_dot"], "t": e["t_placed"], "reach_ms": e["reach_ms"], "verified": e.get("verified", True), "reason": e.get("reason")})
        elif mode == "arm" and e["type"] == "rep_complete":
            out.append({"key": 0, "t": e["t_end"], "peak_deg": e["peak_deg"], "verified": e.get("verified", True),
                        "reason": e.get("reason"), "lean": bool(e.get("lean")), "hike": bool(e.get("hike"))})
    return out


def entry_settings(e: dict[str, Any], debounce: int, clear: int) -> dict[str, Any]:
    """What a cached prediction depends on: the pipeline settings and any replayed colour sample."""
    s: dict[str, Any] = {"debounce_frames": debounce, "clear_frames": clear}
    if e.get("colour_sample") and e.get("mode") != "arm":
        s["colour_sample"] = e["colour_sample"]
    return s


def replay_entry(e: dict[str, Any], ds_dir: Path, args: argparse.Namespace) -> dict[str, Any]:
    """Run the entry through the pipeline; returns the cache document (events without frames)."""
    mode = e["mode"]
    exercise = e.get("exercise") or EXERCISE_BY_MODE[mode]
    if mode == "arm" and e.get("landmarks") and not e.get("video"):
        res = run_landmark_replay(ds_dir / e["landmarks"], side=e.get("side", "left"), **({"exercise": e["exercise"]} if e.get("exercise") else {}))
        source = "landmarks"
        exercise = e.get("exercise") or "flexion"  # the arm FSM's own default
    elif mode == "arm":
        res = run_replay(ds_dir / e["video"], mode="arm", sheet="none", debounce_frames=args.debounce,
                         clear_frames=args.clear, side=e.get("side", "left"), exercise=exercise)
        source = "video"
    else:
        # A sidecar's `colour_sample` (the patient's tap-to-sample) is replayed as the same
        # `sample_colour` command, so a non-blue cup band or wooden pegs are scored as the app ran.
        res = run_replay(ds_dir / e["video"], mode=mode, sheet=e.get("sheet", "nhpt_board"),
                         debounce_frames=args.debounce, clear_frames=args.clear,
                         **({"colour_sample": e["colour_sample"]} if e.get("colour_sample") else {}))
        source = "video"
    events = []
    for ev in res.events:
        if ev.type not in CACHE_TYPES:
            continue
        d = ev.to_dict()
        d.pop("reaches", None)
        events.append(d)
    return {
        "schema": PRED_SCHEMA, "clip_id": e["id"], "mode": mode, "exercise": exercise, "source": source,
        "cv2_version": cv2.__version__, "settings": entry_settings(e, args.debounce, args.clear),
        "models": res.models, "fps": res.fps, "frames": res.frames, "nhpt_total_s": res.nhpt_total_s,
        "events": events,
    }


def clip_readable(e: dict[str, Any], ds_dir: Path, today: dt.date) -> tuple[bool, str]:
    """Synthetic renders are always readable. A real clip only while it exists, has not been
    deleted and its 30-day consent has not run out."""
    if e.get("synthetic"):
        return True, "synthetic"
    if e.get("clip_deleted_on"):
        return False, "clip deleted"
    try:
        until = dt.date.fromisoformat(str(e.get("delete_after")))
    except ValueError:
        return False, "no consent deletion date"
    if today >= until:
        return False, "consent period over (run record_session.py purge-expired)"
    if not (ds_dir / str(e.get("video", ""))).is_file():
        return False, "video file missing"
    return True, "ok"


# ---- scoring ----------------------------------------------------------------------------
def score_entry(e: dict[str, Any], lab: dict[str, Any], pred_doc: dict[str, Any], tol: float) -> dict[str, Any]:
    mode = e["mode"]
    pred = predictions(pred_doc["events"], mode)
    labeled = lab["reps"]
    tp, fp, fn, misses = match_reps(pred, labeled, tol, key="key", t_key="t")
    row: dict[str, Any] = {
        "id": e["id"], "exercise": pred_doc.get("exercise") or EXERCISE_BY_MODE[mode], "mode": mode,
        "synthetic": bool(e.get("synthetic", False)), "participant": e.get("participant"),
        "source": pred_doc.get("source"), "from_cache": bool(pred_doc.get("_from_cache")),
        "frames": pred_doc.get("frames"), "models": pred_doc.get("models"),
        "labeled_reps": len(labeled), "pred_reps": len(pred), "tp": tp, "fp": fp, "fn": fn,
        "status_agree": 0, "status_n": 0, "abs_err": [], "signed_err": [],
        "lean": {"labelled": 0, "detected": 0, "clean": 0, "false_alarm": 0},
        "hike": {"labelled": 0, "detected": 0, "clean": 0, "false_alarm": 0},
    }
    for p in pred:
        if "matched" not in p:
            continue
        lb = labeled[p["matched"]]
        row["status_n"] += 1
        if p["verified"] == lb["expected_verified"]:
            row["status_agree"] += 1
        else:
            misses.append({"kind": "status_mismatch", "label": lb, "pred": p})
        if mode == "cup" and lb.get("reach_ms") is not None:
            row["abs_err"].append(abs(p["reach_ms"] - lb["reach_ms"]))
        if mode == "arm" and lb.get("angle_ref") is not None:
            row["abs_err"].append(abs(p["peak_deg"] - lb["angle_ref"]))
            row["signed_err"].append(p["peak_deg"] - lb["angle_ref"])
        if mode == "arm":
            for flag in ("lean", "hike"):
                if lb.get(flag) is None:
                    continue
                c = row[flag]
                if lb[flag]:
                    c["labelled"] += 1
                    c["detected"] += int(p[flag])
                    if not p[flag]:
                        misses.append({"kind": f"{flag}_missed", "label": lb, "pred": p})
                else:
                    c["clean"] += 1
                    c["false_alarm"] += int(p[flag])
                    if p[flag]:
                        misses.append({"kind": f"{flag}_false_alarm", "label": lb, "pred": p})
    if mode == "nhpt":
        row["nhpt_labeled_s"] = lab["total_s"]
        row["nhpt_pred_s"] = pred_doc.get("nhpt_total_s")
        t_last = max((r["t"] for r in labeled), default=0.0)
        if lab["total_s"] is not None and row["nhpt_pred_s"] is not None:
            row["nhpt_abs_err_s"] = round(abs(row["nhpt_pred_s"] - lab["total_s"]), 3)
            if row["nhpt_abs_err_s"] > tol:
                misses.append({"kind": "nhpt_timer_error", "label": {"t": t_last, "total_s": lab["total_s"]}, "pred": {"t": t_last, "total_s": row["nhpt_pred_s"]}})
        elif lab["total_s"] is not None:
            misses.append({"kind": "nhpt_no_time", "label": {"t": t_last, "total_s": lab["total_s"]}})
    row["misses"] = misses
    return row


def summarise(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Per-exercise metrics over one group of rows (all real, or all synthetic)."""
    out: dict[str, Any] = {}
    for ex in sorted({r["exercise"] for r in rows}):
        rs = [r for r in rows if r["exercise"] == ex]
        tp, fp, fn = (sum(r[k] for r in rs) for k in ("tp", "fp", "fn"))
        p, rcl, f1 = prf(tp, fp, fn)
        sn, sa = sum(r["status_n"] for r in rs), sum(r["status_agree"] for r in rs)
        errs = [x for r in rs for x in r["abs_err"]]
        signed = [x for r in rs for x in r["signed_err"]]
        m: dict[str, Any] = {
            "entries": len(rs), "participants": len({r["participant"] for r in rs}),
            "labeled_reps": sum(r["labeled_reps"] for r in rs), "pred_reps": sum(r["pred_reps"] for r in rs),
            "tp": tp, "fp": fp, "fn": fn, "rep_precision": round(p, 4), "rep_recall": round(rcl, 4), "rep_f1": round(f1, 4),
            "verified_agreement": round(sa / sn, 4) if sn else None, "verified_n": sn,
        }
        mode = rs[0]["mode"]
        if mode == "nhpt":
            e = [r["nhpt_abs_err_s"] for r in rs if r.get("nhpt_abs_err_s") is not None]
            m["nhpt_mae_s"] = round(sum(e) / len(e), 3) if e else None
            m["nhpt_n"] = len(e)
        if mode == "cup":
            m["reach_mae_ms"] = round(sum(errs) / len(errs), 1) if errs else None
            m["reach_n"] = len(errs)
        if mode == "arm":
            m["peak_mae_deg"] = round(sum(errs) / len(errs), 2) if errs else None
            m["peak_bias_deg"] = round(sum(signed) / len(signed), 2) if signed else None
            m["peak_n"] = len(errs)
            for flag in ("lean", "hike"):
                c: dict[str, Any] = {k: sum(r[flag][k] for r in rs) for k in ("labelled", "detected", "clean", "false_alarm")}
                c["detection_rate"] = round(c["detected"] / c["labelled"], 4) if c["labelled"] else None
                c["false_alarm_rate"] = round(c["false_alarm"] / c["clean"], 4) if c["clean"] else None
                m[flag] = c
        out[ex] = m
    return out


# ---- failure cases -----------------------------------------------------------------------
def _miss_time(m: dict[str, Any]) -> float:
    return float((m.get("label") or m.get("pred") or {}).get("t", 0.0))


def write_failure_cases(e: dict[str, Any], row: dict[str, Any], video: Path, out_root: Path, settings: dict[str, Any]) -> Path | None:
    """JPEG frames around every miss + reason.json under out_root/<clip_id>/. The caller has
    checked `consent_clips` and that the clip may still be read."""
    d = out_root / e["id"]
    if d.exists():
        shutil.rmtree(d)  # a re-run replaces, never accumulates
    if not row["misses"]:
        return None
    d.mkdir(parents=True)
    cap = cv2.VideoCapture(str(video))
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or float(e.get("fps") or 15.0)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    misses = []
    for i, m in enumerate(sorted(row["misses"], key=_miss_time)):
        t = _miss_time(m)
        names = []
        for off in FRAME_OFFSETS_S:
            idx = int(round((t + off) * fps))
            if idx < 0 or (n > 0 and idx >= n):
                continue
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            name = f"miss{i:02d}_{m['kind']}_{idx / fps:07.2f}s.jpg"
            text = f"{m['kind']}  t={idx / fps:.2f}s ({off:+.1f}s)"
            cv2.putText(frame, text, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 3, cv2.LINE_AA)
            cv2.putText(frame, text, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.imwrite(str(d / name), frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            names.append(name)
        misses.append({"index": i, "kind": m["kind"], "t": round(t, 3), "label": m.get("label"), "pred": m.get("pred"), "frames": names})
    cap.release()
    (d / "reason.json").write_text(json.dumps({
        "clip_id": e["id"], "exercise": row["exercise"], "participant": e.get("participant"),
        "consent_clips": True, "delete_after": e.get("delete_after"),
        "policy": "Local only (git-ignored). Deleted with the clip by record_session.py purge-expired / withdraw.",
        "generated_by": "evaluation/scripts/eval.py", "settings": settings, "misses": misses,
    }, indent=1, default=str) + "\n")
    return d


# ---- report ------------------------------------------------------------------------------
def _f(v: Any, unit: str = "") -> str:
    return "–" if v is None else f"{v}{unit}"


def group_md(title: str, rows: list[dict[str, Any]], summ: dict[str, Any], note: str) -> list[str]:
    md = [f"## {title}", "", note, ""]
    if not rows:
        return md + ["_No entries in this group._", ""]
    md += [
        "| exercise | entries | participants | labelled reps | predicted | TP | FP | FN | Rep F1 (P / R) | verified agreement | timing / angle error |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for ex, m in summ.items():
        if "nhpt_mae_s" in m:
            err = f"NHPT total-time MAE {_f(m['nhpt_mae_s'], ' s')} (n={m['nhpt_n']})"
        elif "reach_mae_ms" in m:
            err = f"reach-time MAE {_f(m['reach_mae_ms'], ' ms')} (n={m['reach_n']})"
        else:
            err = f"peak-angle MAE {_f(m['peak_mae_deg'], '°')}, bias {_f(m['peak_bias_deg'], '°')} (n={m['peak_n']})"
        agree = "–" if m["verified_agreement"] is None else f"{m['verified_agreement']} (n={m['verified_n']})"
        md.append(
            f"| {NAMES.get(ex, ex)} | {m['entries']} | {m['participants']} | {m['labeled_reps']} | {m['pred_reps']} | {m['tp']} | {m['fp']} | {m['fn']} | "
            f"**{m['rep_f1']}** ({m['rep_precision']} / {m['rep_recall']}) | {agree} | {err} |"
        )
    comp = [(ex, m) for ex, m in summ.items() if "lean" in m and (m["lean"]["labelled"] + m["lean"]["clean"] + m["hike"]["labelled"] + m["hike"]["clean"])]
    if comp:
        md += ["", "| exercise | compensation | labelled reps | detected | detection rate | clean reps | false alarms | false-alarm rate |", "|---|---|---|---|---|---|---|---|"]
        for ex, m in comp:
            for flag, label in (("lean", "trunk lean"), ("hike", "shoulder hike")):
                c = m[flag]
                md.append(f"| {NAMES.get(ex, ex)} | {label} | {c['labelled']} | {c['detected']} | {_f(c['detection_rate'])} | {c['clean']} | {c['false_alarm']} | {_f(c['false_alarm_rate'])} |")
    md += ["", "| id | exercise | source | labelled | predicted | TP | FP | FN | NHPT labelled | NHPT pred | abs err | misses |", "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        src = r["source"] + (" (cached events)" if r["from_cache"] else "")
        md.append(
            f"| {r['id']} | {r['exercise']} | {src} | {r['labeled_reps']} | {r['pred_reps']} | {r['tp']} | {r['fp']} | {r['fn']} | "
            f"{r.get('nhpt_labeled_s', '')} | {r.get('nhpt_pred_s', '')} | {r.get('nhpt_abs_err_s', '')} | {len(r['misses'])} |"
        )
    return md + [""]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="eval.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", default=str(HERE.parents[1] / "dataset_v0"), help="folder with manifest.json (default: %(default)s)")
    ap.add_argument("--out", default=str(HERE.parents[1] / "results"), help="where dataset_<version>.{json,md} go (default: %(default)s)")
    ap.add_argument("--failures", default=str(HERE.parents[1] / "failure_cases"), help="failure-case frames, consented real clips only (default: %(default)s)")
    ap.add_argument("--no-failure-frames", action="store_true", help="do not write failure-case frames")
    ap.add_argument("--use-cache", action="store_true", help="score real clips from their .pred.json when it matches these settings (no replay)")
    ap.add_argument("--allow-missing-models", action="store_true", help="score real clips even if the hand/pose ONNX models are missing (not the product)")
    ap.add_argument("--tol", type=float, default=1.0, help="matching tolerance in seconds (default: %(default)s)")
    # Product defaults (SessionPipeline / main.py): the scorer must run the pipeline exactly
    # as the app ships it, or the numbers describe a different product.
    ap.add_argument("--debounce", type=int, default=2, help="occupancy debounce frames (product default 2)")
    ap.add_argument("--clear", type=int, default=3, help="hand-clear frames (product default 3)")
    ap.add_argument("--today", type=dt.date.fromisoformat, default=None, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    ds_dir, out = Path(args.dataset), Path(args.out)
    today = args.today or dt.date.today()
    manifest_path = ds_dir / "manifest.json"
    if not manifest_path.exists():
        print(f"no manifest at {manifest_path}. For real recordings run first: uv run python tools/dataset_v1.py manifest")
        return 2
    manifest = json.loads(manifest_path.read_text())
    version = manifest.get("version", "v0")
    out.mkdir(parents=True, exist_ok=True)
    settings = {"debounce_frames": args.debounce, "clear_frames": args.clear, "tol_s": args.tol}
    pipe_settings = {"debounce_frames": args.debounce, "clear_frames": args.clear}

    rows: list[dict[str, Any]] = []
    skipped = list(manifest.get("skipped", []))
    failure_dirs: list[str] = []
    for e in manifest["entries"]:
        e = {**e, "mode": e.get("mode") or {"abduction": "arm"}.get(e.get("exercise", ""), e.get("exercise"))}
        real = not e.get("synthetic", False)
        exercise = e.get("exercise") or EXERCISE_BY_MODE[e["mode"]]
        lab = normalise_labels(json.loads((ds_dir / e["labels"]).read_text()), exercise)
        if not lab["complete"]:
            skipped.append({"id": e["id"], "reason": "labels not marked complete"})
            continue
        readable, why = clip_readable(e, ds_dir, today)
        pred_path = ds_dir / e["pred"] if real and e.get("pred") else None
        cached = json.loads(pred_path.read_text()) if pred_path is not None and pred_path.exists() else None
        cache_ok = cached is not None and cached.get("settings") == entry_settings(e, pipe_settings["debounce_frames"], pipe_settings["clear_frames"])
        if readable and not (args.use_cache and cache_ok):
            pred_doc = replay_entry(e, ds_dir, args)
            need = "pose" if e["mode"] == "arm" else "hand"
            if real and pred_doc["source"] == "video" and not pred_doc["models"].get(need) and not args.allow_missing_models:
                print(f"ERROR: the {need} model is missing, so {e['id']} would not run as the product does. "
                      "Run `uv run python tools/fetch_models.py` (or pass --allow-missing-models).")
                return 2
            if pred_path is not None:
                pred_path.parent.mkdir(parents=True, exist_ok=True)
                pred_path.write_text(json.dumps(pred_doc, indent=1, default=str) + "\n")
        elif cache_ok:
            pred_doc = {**cached, "_from_cache": True}
        else:
            skipped.append({"id": e["id"], "reason": f"cannot read the clip ({why}) and no cached events for these settings"})
            continue
        row = score_entry(e, lab, pred_doc, args.tol)
        rows.append(row)
        if real and readable and e.get("consent_clips") is True and not args.no_failure_frames:
            d = write_failure_cases(e, row, ds_dir / e["video"], Path(args.failures), settings)
            if d is not None:
                failure_dirs.append(str(d))

    real_rows = [r for r in rows if not r["synthetic"]]
    syn_rows = [r for r in rows if r["synthetic"]]
    results = {
        "dataset": version, "generated_on": today.isoformat(), "cv2_version": cv2.__version__,
        **settings, "n_real": len(real_rows), "n_synthetic": len(syn_rows),
        "real": summarise(real_rows), "synthetic": summarise(syn_rows),
        "entries": rows, "skipped": skipped, "failure_case_dirs": failure_dirs,
    }
    (out / f"dataset_{version}.json").write_text(json.dumps(results, indent=1, default=str) + "\n")

    md = [
        f"# dataset_{version} results", "",
        f"Regenerated by `evaluation/scripts/eval.py --dataset {ds_dir.name}` (OpenCV {cv2.__version__}, "
        f"tolerance ±{args.tol} s plus {SLACK_S} s after the labelled time) with the pipeline at "
        f"**product defaults (debounce {args.debounce} frames, clear {args.clear} frames)**, the same settings the app ships with.",
        "",
        f"**{len(real_rows)} real, {len(syn_rows)} synthetic** entries, reported in separate tables and never pooled. "
        "Rep F1 counts every rep the product reported (verified or unverified); verified agreement is how often its "
        "verified/unverified call matched the label on matched reps. Angles are camera-relative progress, not goniometry.",
        "",
    ]
    md += group_md("Real recordings", real_rows, results["real"],
                   "Recorded under `evaluation/PROTOCOL.md`; arm angles are compared with the goniometer-app reading.")
    md += group_md("Synthetic renders", syn_rows, results["synthetic"],
                   "OpenCV-rendered sheets and a synthetic landmark stream: they validate the pipeline only and are not evidence about real-world accuracy.")
    if skipped:
        md += ["## Skipped", ""] + [f"- {s['id']}: {s['reason']}" for s in skipped] + [""]
    if failure_dirs:
        md += [f"Failure-case frames written for {len(failure_dirs)} clip(s) under `evaluation/failure_cases/` (local only, consented clips only).", ""]
    (out / f"dataset_{version}.md").write_text("\n".join(md))
    print(json.dumps({k: results[k] for k in ("dataset", "n_real", "n_synthetic", "real", "synthetic")}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
