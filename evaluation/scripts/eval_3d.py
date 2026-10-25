"""Score the 3-D synthetic renders (evaluation/dataset_3d_v0) through the identical pipeline.

    cd services/session
    uv run python ../../evaluation/blender/make_dataset_3d.py      # render the clips (Blender, ~25 min)
    uv run python ../../evaluation/scripts/eval_3d.py               # replay + score -> results/synthetic3d_v0.{md,json}
    uv run python ../../evaluation/scripts/eval_3d.py --use-cache   # score from the committed <clip>.pred.json (no clips needed)

**Synthetic 3-D renders, not real-camera evidence.** Every clip runs through
`praxis_session.replay.run_replay` (the same `SessionPipeline` as Live and Replay) at product
defaults (debounce 2, clear 3), with the hand model on. Matching, labels and the per-entry
scoring are `eval.py`'s (rep F1 on the same hole / dot within [-tol, tol + 1] s, verified
agreement, NHPT total-time MAE, reach-time MAE). On top this script reports what the 3-D
renders add: verified / unverified counts with reasons, NHPT seat-time and per-peg split errors,
the timer start, hand-model and calibration coverage, one row per rendered condition, and every
miss with its reason. Each clip's events (numbers only, no pixels) are cached next to it as
`<id>.pred.json`, so the tables regenerate without re-rendering.

`--tag before_fix` writes results/synthetic3d_v0_before_fix.* (used once, from a checkout of the
perception code before the 12 Oct parallax fixes); a later untagged run then shows before/after.
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[2] / "services" / "session"))
import cv2  # noqa: E402

_spec = importlib.util.spec_from_file_location("praxis_eval", HERE.parent / "eval.py")
ev = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(ev)

DEFAULT_DS = HERE.parents[1] / "dataset_3d_v0"
BANNER = "**Synthetic 3-D renders, not real-camera evidence.**"
COND_KEYS = ("tilt_deg", "yaw_deg", "dist_mm", "focal_per_width", "light", "side", "skin", "sleeve", "speed",
             "peg_colour", "peg_d_mm", "board_mm", "cup_colour", "noise_sigma")


# ---- replay -------------------------------------------------------------------------------
def replay_3d(e: dict[str, Any], ds_dir: Path, debounce: int, clear: int) -> dict[str, Any]:
    """eval.py's cache document plus per-frame coverage counts (hand model, calibration)."""
    from praxis_session.replay import run_replay

    res = run_replay(ds_dir / e["video"], mode=e["mode"], sheet=e["sheet"], debounce_frames=debounce, clear_frames=clear)
    events = []
    cov = {"frames": 0, "hand": 0, "calibrated": 0, "four_markers": 0, "three_markers": 0, "held": 0}
    for x in res.events:
        if x.type == "frame":
            p = x.payload
            cov["frames"] += 1
            cov["hand"] += int(bool(p.get("hand", {}).get("present")))
            if p.get("calibrated"):
                cov["calibrated"] += 1
                miss = len(p.get("missing") or [])
                cov["four_markers" if miss == 0 else "three_markers" if miss == 1 else "held"] += 1
            continue
        if x.type not in ev.CACHE_TYPES:
            continue
        d = x.to_dict()
        d.pop("reaches", None)
        events.append(d)
    return {
        "schema": ev.PRED_SCHEMA, "clip_id": e["id"], "mode": e["mode"], "exercise": e["mode"], "source": "video",
        "cv2_version": cv2.__version__, "settings": {"debounce_frames": debounce, "clear_frames": clear},
        "models": res.models, "fps": res.fps, "frames": res.frames, "nhpt_total_s": res.nhpt_total_s,
        "coverage": cov, "events": events,
    }


# ---- 3-D extras -----------------------------------------------------------------------------
def _mean(xs: list[float]) -> float | None:
    return round(sum(xs) / len(xs), 3) if xs else None


def extras(e: dict[str, Any], labels: dict[str, Any], truth: dict[str, Any], pred_doc: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
    """Metrics the flat dataset could not have: timing per rep, splits, verification reasons."""
    mode = e["mode"]
    pred = ev.predictions(pred_doc["events"], mode)
    lab = ev.normalise_labels(labels, mode)["reps"]
    ev.match_reps(pred, lab, row["tol"], key="key", t_key="t")
    matched = sorted(((p["matched"], p) for p in pred if "matched" in p), key=lambda m: m[0])
    out: dict[str, Any] = {
        "verified": sum(1 for p in pred if p["verified"]), "unverified": sum(1 for p in pred if not p["verified"]),
        "unverified_reasons": {}, "expected_unverified": sum(1 for r in lab if not r["expected_verified"]),
        "coverage": pred_doc.get("coverage"),
    }
    for p in pred:
        if not p["verified"]:
            k = p.get("reason") or "unspecified"
            out["unverified_reasons"][k] = out["unverified_reasons"].get(k, 0) + 1
    signed = [p["t"] - lab[j]["t"] for j, p in matched]
    out["event_time_bias_s"] = _mean(signed)
    out["event_time_mae_s"] = _mean([abs(x) for x in signed])
    out["event_time_signed_s"] = [round(x, 4) for x in signed]
    if mode == "nhpt":
        start = next((x for x in pred_doc["events"] if x["type"] == "nhpt_start"), None)
        out["timer_start_inferred"] = None if start is None else bool(start.get("inferred", False))
        out["timer_start_err_s"] = None if start is None else round(start["t_start"] - labels["nhpt"]["t_start"], 3)
        done = next((x for x in pred_doc["events"] if x["type"] == "nhpt_complete"), None)
        out["completed"] = done is not None
        # split k = seat k - seat k-1 (peg 1: seat - timer start), on consecutive matched pegs
        by_label = {j: p for j, p in matched}
        lab_splits = truth.get("splits_s") or []
        errs = []
        for j in range(1, len(lab)):
            if j in by_label and (j - 1) in by_label:
                errs.append(round((by_label[j]["t"] - by_label[j - 1]["t"]) - lab_splits[j], 3))
        if 0 in by_label and start is not None:
            errs.insert(0, round((by_label[0]["t"] - start["t_start"]) - lab_splits[0], 3))
        out["split_errors_s"] = errs
        out["split_mae_s"] = _mean([abs(x) for x in errs])
    else:
        reach_err = []
        for j, p in matched:
            lr = lab[j]
            reach_err.append(round(p["reach_ms"] - lr["reach_ms"], 1))
        out["reach_bias_ms"] = _mean(reach_err)
        out["reach_signed_ms"] = reach_err
        out["arcs_completed"] = sum(1 for x in pred_doc["events"] if x["type"] == "arc_complete")
    return out


def summarise_3d(rows: list[dict[str, Any]]) -> dict[str, Any]:
    base = ev.summarise(rows)
    for ex, m in base.items():
        rs = [r for r in rows if r["exercise"] == ex]
        m["verified"] = sum(r["x"]["verified"] for r in rs)
        m["unverified"] = sum(r["x"]["unverified"] for r in rs)
        reasons: dict[str, int] = {}
        for r in rs:
            for k, v in r["x"]["unverified_reasons"].items():
                reasons[k] = reasons.get(k, 0) + v
        m["unverified_reasons"] = reasons
        m["expected_unverified"] = sum(r["x"]["expected_unverified"] for r in rs)
        signed = [x for r in rs for x in r["x"]["event_time_signed_s"]]  # pooled over reps
        m["event_time_mae_s"] = _mean([abs(x) for x in signed])
        m["event_time_bias_s"] = _mean(signed)
        cov = [r["x"]["coverage"] for r in rs if r["x"].get("coverage")]
        if cov:
            fr = sum(c["frames"] for c in cov)
            m["hand_model_frames_pct"] = round(100.0 * sum(c["hand"] for c in cov) / fr, 1) if fr else None
            m["calibrated_frames_pct"] = round(100.0 * sum(c["calibrated"] for c in cov) / fr, 1) if fr else None
            m["three_or_held_frames_pct"] = round(100.0 * sum(c["three_markers"] + c["held"] for c in cov) / fr, 1) if fr else None
        if rs[0]["mode"] == "nhpt":
            se = [abs(x) for r in rs for x in r["x"]["split_errors_s"]]
            m["split_mae_s"] = _mean(se)
            m["split_n"] = len(se)
            m["completed"] = sum(1 for r in rs if r["x"]["completed"])
            m["timer_start_inferred"] = sum(1 for r in rs if r["x"]["timer_start_inferred"])
        else:
            m["reach_bias_ms"] = _mean([x for r in rs for x in r["x"]["reach_signed_ms"]])
    return base


# ---- report -------------------------------------------------------------------------------
NAMES = {"nhpt": "Nine-Hole Peg Test", "cup": "Waiter – cup"}


def _f(v: Any, unit: str = "") -> str:
    return "–" if v is None else f"{v}{unit}"


def _cond(c: dict[str, Any], mode: str) -> str:
    parts = [f"tilt {c['tilt_deg']}°", f"yaw {c['yaw_deg']}°", f"{c['dist_mm']:.0f} mm", f"f {c['focal_per_width']}·w", c["light"].replace("_", " "),
             f"{c['side']} hand", f"{c['skin']} skin", "sleeve" if c["sleeve"] else "bare arm"]
    if mode == "nhpt":
        parts += [f"{c['peg_colour']} {c['peg_d_mm']:.0f} mm pegs", f"board {c['board_mm']:.0f} mm"]
    else:
        parts += [f"{c['cup_colour']} cup"]
    return ", ".join(parts)


def _miss_text(m: dict[str, Any]) -> str:
    lab, pred = m.get("label") or {}, m.get("pred") or {}
    if m["kind"] == "false_negative":
        return f"missed: labelled {lab.get('key')} at {lab.get('t', 0):.2f} s"
    if m["kind"] == "false_positive":
        return f"extra: reported {pred.get('key')} at {pred.get('t', 0):.2f} s ({'verified' if pred.get('verified') else 'unverified: ' + str(pred.get('reason'))})"
    if m["kind"] == "status_mismatch":
        return f"status: {lab.get('key')} at {lab.get('t', 0):.2f} s expected {'verified' if lab.get('expected_verified') else 'unverified'}, got {'verified' if pred.get('verified') else 'unverified (' + str(pred.get('reason')) + ')'}"
    if m["kind"] in ("nhpt_timer_error", "nhpt_no_time"):
        return f"{m['kind']}: labelled {lab.get('total_s')} s, reported {pred.get('total_s')}"
    return m["kind"]


def report(results: dict[str, Any], before: dict[str, Any] | None) -> str:
    s = results["summary"]
    md = [
        "# Synthetic 3-D renders v0 — NHPT and Waiter – cup",
        "",
        f"{BANNER} Physically based Blender (Eevee) renders of a laptop-camera view: 32 mm pegs standing in a "
        "perforated board on the printed sheet, a tapered cup with a blue tape ring and a handle, a skin-toned hand and forearm "
        "proxy built from primitives, shading, shadows, specular highlights, motion blur, sensor noise and JPEG q70. "
        "They exercise parallax, occlusion and lighting that the flat 2-D renders cannot; they are not people, real "
        "pegs or a real webcam, and the hand proxy is not a real hand (see *Limits*).",
        "",
        "Regenerate: `cd services/session && uv run python ../../evaluation/blender/make_dataset_3d.py && "
        "uv run python ../../evaluation/scripts/eval_3d.py` (or `eval_3d.py --use-cache` to rescore the committed events).",
        "",
        f"OpenCV {results['cv2_version']} · generated {results['generated_on']} · pipeline at product defaults "
        f"(debounce {results['debounce_frames']}, clear {results['clear_frames']}), hand model on · matching ±{results['tol_s']} s "
        f"plus {ev.SLACK_S} s after the labelled time (eval.py) · {results['n_clips']} clips, {results['n_frames']} frames.",
        "",
        "## Summary",
        "",
        "| exercise | clips | labelled reps | reported | TP | FP | FN | Rep F1 (P / R) | verified / unverified (expected unverified) | timing |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for ex, m in s.items():
        if ex == "nhpt":
            timing = (f"NHPT total MAE {_f(m.get('nhpt_mae_s'), ' s')} (n={m.get('nhpt_n')}, completed {m['completed']}/{m['entries']}, "
                      f"start inferred {m['timer_start_inferred']}); seat time MAE {_f(m['event_time_mae_s'], ' s')} (bias {_f(m['event_time_bias_s'], ' s')}); "
                      f"per-peg split MAE {_f(m['split_mae_s'], ' s')} (n={m['split_n']})")
        else:
            timing = (f"reach-time MAE {_f(m.get('reach_mae_ms'), ' ms')} (bias {_f(m.get('reach_bias_ms'), ' ms')}, n={m.get('reach_n')}); "
                      f"placement time MAE {_f(m['event_time_mae_s'], ' s')}")
        md.append(f"| {NAMES.get(ex, ex)} | {m['entries']} | {m['labeled_reps']} | {m['pred_reps']} | {m['tp']} | {m['fp']} | {m['fn']} | "
                  f"**{m['rep_f1']}** ({m['rep_precision']} / {m['rep_recall']}) | {m['verified']} / {m['unverified']} ({m['expected_unverified']}) | {timing} |")
    md += ["", "Unverified reasons and coverage:", ""]
    for ex, m in s.items():
        rs = ", ".join(f"{k} {v}" for k, v in sorted(m["unverified_reasons"].items())) or "none"
        md.append(f"- **{NAMES.get(ex, ex)}**: unverified reasons: {rs}. Verified agreement on matched reps {_f(m['verified_agreement'])} "
                  f"(n={m['verified_n']}). Hand model found a hand in {_f(m.get('hand_model_frames_pct'), ' %')} of frames; calibrated "
                  f"{_f(m.get('calibrated_frames_pct'), ' %')} of frames, of which {_f(m.get('three_or_held_frames_pct'), ' %')} of all frames on three markers or a held fix.")
    if before is not None:
        md += ["", "## Before / after the 12 Oct fixes (same clips, same settings)", "",
               "| exercise | | Rep F1 (P / R) | TP / FP / FN | verified / unverified | timing |", "|---|---|---|---|---|---|"]
        for ex in s:
            for tag, res in (("before", before["summary"].get(ex)), ("after", s[ex])):
                if res is None:
                    continue
                t = (f"NHPT total MAE {_f(res.get('nhpt_mae_s'), ' s')} (n={res.get('nhpt_n')})" if ex == "nhpt"
                     else f"reach-time MAE {_f(res.get('reach_mae_ms'), ' ms')} (n={res.get('reach_n')})")
                md.append(f"| {NAMES.get(ex, ex)} | {tag} | {res['rep_f1']} ({res['rep_precision']} / {res['rep_recall']}) | {res['tp']} / {res['fp']} / {res['fn']} | "
                          f"{res.get('verified', '–')} / {res.get('unverified', '–')} | {t} |")
        md += ["", results.get("fix_note", ""), ""]
    md += ["", "## Per clip (one rendered condition each)", "",
           "| clip | condition | labelled | TP | FP | FN | verified / unverified | timing | hand model frames | markers: 4 / 3 / held |",
           "|---|---|---|---|---|---|---|---|---|---|"]
    for r in results["entries"]:
        x, c = r["x"], r["condition"]
        cov = x.get("coverage") or {}
        if r["mode"] == "nhpt":
            timing = (f"total {_f(r.get('nhpt_pred_s'), ' s')} vs {_f(r.get('nhpt_labeled_s'), ' s')}; start {'inferred' if x['timer_start_inferred'] else 'lift'} "
                      f"({_f(x['timer_start_err_s'], ' s')}); split MAE {_f(x['split_mae_s'], ' s')}")
        else:
            errs = r["abs_err"]
            timing = f"reach MAE {_f(round(sum(errs) / len(errs), 1) if errs else None, ' ms')} (bias {_f(x['reach_bias_ms'], ' ms')}); arcs {x['arcs_completed']}/4"
        fr = cov.get("frames") or 0
        hand = f"{round(100 * cov.get('hand', 0) / fr)} %" if fr else "–"
        mk = f"{cov.get('four_markers', 0)} / {cov.get('three_markers', 0)} / {cov.get('held', 0)}" if fr else "–"
        md.append(f"| {r['id']} | {_cond(c, r['mode'])} | {r['labeled_reps']} | {r['tp']} | {r['fp']} | {r['fn']} | {x['verified']} / {x['unverified']} | {timing} | {hand} | {mk} |")
    md += ["", "## Misses with reasons", ""]
    any_miss = False
    for r in results["entries"]:
        ms = r["misses"]
        if not ms:
            continue
        any_miss = True
        md.append(f"- **{r['id']}** ({len(ms)}): " + "; ".join(_miss_text(m) for m in ms[:12]) + (" …" if len(ms) > 12 else ""))
    if not any_miss:
        md.append("_None._")
    md += ["", "## Limits", "", *[f"- {x}" for x in results["limits"]], ""]
    return "\n".join(md)


LIMITS = [
    "Renders, not recordings: no real webcam auto-exposure, rolling shutter, lens distortion, real skin, real plastic or real paper.",
    "The hand is a proxy built from primitives (palm box, capsule fingers): the OpenCV Zoo hand model rarely detects it "
    "(see the hand-model coverage above), so pinch grasps, hand-near-hole verification and the cup's hand-based placement "
    "are under-exercised and the verified/unverified split mostly reflects the proxy, not the product. Real hands are expected "
    "to be detected far more often; that is unmeasured until real recordings exist.",
    "Labels come from the animation script (the instant the peg reaches the bottom of its hole, the cup touches down), "
    "not a human labeller; the product times events when it can see them, so a constant lag is expected.",
    "One motion script per exercise, varied by seed and speed; no tremor, hesitation, drops or wrong holes.",
]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="eval_3d.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", default=str(DEFAULT_DS))
    ap.add_argument("--out", default=str(HERE.parents[1] / "results"))
    ap.add_argument("--use-cache", action="store_true", help="score from <id>.pred.json, never replay")
    ap.add_argument("--no-cache-write", action="store_true", help="do not (re)write <id>.pred.json")
    ap.add_argument("--tag", default="", help="suffix for the result files (e.g. before_fix)")
    ap.add_argument("--tol", type=float, default=1.0)
    ap.add_argument("--debounce", type=int, default=2)
    ap.add_argument("--clear", type=int, default=3)
    ap.add_argument("--today", type=dt.date.fromisoformat, default=None, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    ds, out = Path(args.dataset), Path(args.out)
    manifest_path = ds / "manifest.json"
    if not manifest_path.exists():
        print(f"no manifest at {manifest_path}; render first: uv run python ../../evaluation/blender/make_dataset_3d.py")
        return 2
    manifest = json.loads(manifest_path.read_text())
    rows = []
    skipped = []
    n_frames = 0
    settings = {"debounce_frames": args.debounce, "clear_frames": args.clear}
    for e in manifest["entries"]:
        labels = json.loads((ds / e["labels"]).read_text())
        truth = json.loads((ds / e["truth"]).read_text()) if e.get("truth") and (ds / e["truth"]).exists() else {}
        cache = ds / f"{e['id']}{('.' + args.tag) if args.tag else ''}.pred.json"
        video = ds / e["video"]
        if args.use_cache or not video.exists():
            if not cache.exists():
                skipped.append({"id": e["id"], "reason": "no clip and no cached events"})
                continue
            pred_doc = json.loads(cache.read_text())
            if pred_doc.get("settings") != settings:
                skipped.append({"id": e["id"], "reason": "cached events were made with other settings"})
                continue
        else:
            pred_doc = replay_3d(e, ds, args.debounce, args.clear)
            if not pred_doc["models"].get("hand"):
                print(f"ERROR: the hand model is missing, so {e['id']} would not run as the product does. Run tools/fetch_models.py.")
                return 2
            if not args.no_cache_write:
                cache.write_text(json.dumps(pred_doc, indent=1, default=str) + "\n")
        lab = ev.normalise_labels(labels, e["mode"])
        row = ev.score_entry(e, lab, pred_doc, args.tol)
        row["tol"] = args.tol
        row["condition"] = e.get("condition") or truth.get("condition") or {}
        row["x"] = extras(e, labels, truth, pred_doc, row)
        n_frames += int(pred_doc.get("frames") or 0)
        rows.append(row)
    today = args.today or dt.date.today()
    results: dict[str, Any] = {
        "dataset": manifest.get("version", "3d_v0"), "synthetic": True, "banner": BANNER.strip("*"),
        "generated_on": today.isoformat(), "cv2_version": cv2.__version__, "tol_s": args.tol, **settings,
        "n_clips": len(rows), "n_frames": n_frames, "summary": summarise_3d(rows), "entries": rows, "skipped": skipped,
        "limits": LIMITS,
        "fix_note": ("Fixes (12 Oct, test-first, tests/test_parallax.py and tests/test_nhpt.py): height-aware hole occupancy from a "
                     "single-view cv2.calibrateCamera focal + cv2.projectPoints seat column (a seated 32 mm peg read empty and its "
                     "streak was a free peg); a hole covered by the hand keeps its state (the forearm flipped seated pegs empty and "
                     "they were re-counted); a seat whose grasp was not seen is counted unverified (grasp_not_seen) instead of "
                     "being dropped, and an inferred timer start is labelled; the cup is found from a circle fit to its blue ring's "
                     "camera-side edge (the ring seen from a laptop angle is a crescent under the 30 mm disc gate) with a session-learned "
                     "radius (tests/test_cup3d.py). No threshold was loosened. Before = the perception code at commit 008e236."),
    }
    out.mkdir(parents=True, exist_ok=True)
    name = f"synthetic3d_v0{('_' + args.tag) if args.tag else ''}"
    (out / f"{name}.json").write_text(json.dumps(results, indent=1, default=str) + "\n")
    before_path = out / "synthetic3d_v0_before_fix.json"
    before = json.loads(before_path.read_text()) if not args.tag and before_path.exists() else None
    (out / f"{name}.md").write_text(report(results, before))
    print(json.dumps({"n_clips": len(rows), "summary": {k: {kk: v[kk] for kk in ("rep_f1", "tp", "fp", "fn", "verified", "unverified")} for k, v in results["summary"].items()},
                      "skipped": skipped}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
