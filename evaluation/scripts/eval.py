"""Score every manifest entry by replaying it through the identical pipeline.

Metrics: rep F1 (a predicted rep_complete matches a labeled rep if it is on the labeled hole
and lands within [-tol, tol + 1.0] s of the labeled seat time), NHPT MAE (|pred - labeled|).
Writes results/dataset_v0.json and results/dataset_v0.md. Synthetic entries are marked.

    uv run python ../../evaluation/scripts/eval.py [--dataset DIR] [--out DIR] [--tol 1.0]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[2] / "services" / "session"))
from praxis_session.replay import run_replay  # noqa: E402


def match_reps(pred: list[dict], labeled: list[dict], tol: float, key: str = "hole", t_key: str = "t_seated"):
    """Greedy one-to-one matching in time order. Returns tp, fp, fn, misses."""
    used: set[int] = set()
    tp = 0
    misses = []
    for p in pred:
        best = None
        for j, lab in enumerate(labeled):
            if j in used or lab[key] != p[key]:
                continue
            dt = p["t"] - lab[t_key]
            if -tol <= dt <= tol + 1.0 and (best is None or abs(dt) < abs(best[1])):
                best = (j, dt)
        if best is None:
            misses.append({"kind": "false_positive", "pred": p})
        else:
            used.add(best[0])
            tp += 1
            p["matched"] = best[0]
    fn = [lab for j, lab in enumerate(labeled) if j not in used]
    misses += [{"kind": "false_negative", "label": lab} for lab in fn]
    return tp, len(pred) - tp, len(fn), misses


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=str(HERE.parents[1] / "dataset_v0"))
    ap.add_argument("--out", default=str(HERE.parents[1] / "results"))
    ap.add_argument("--tol", type=float, default=1.0)
    args = ap.parse_args(argv)
    ds, out = Path(args.dataset), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ds / "manifest.json").read_text())

    rows = []
    tp = fp = fn = 0
    rtp = rfp = rfn = 0
    nhpt_err = []
    reach_err_ms = []
    n_labeled = 0
    for e in manifest["entries"]:
        labels = json.loads((ds / e["labels"]).read_text())
        res = run_replay(
            ds / e["video"], mode=e["mode"], sheet=e.get("sheet", "nhpt_board"),
            debounce_frames=1, clear_frames=1,
        )
        if e["mode"] == "cup":
            pred = [
                {"t": ev.payload["t_placed"], "to_dot": ev.payload["to_dot"], "reach_ms": ev.payload["reach_ms"]}
                for ev in res.events if ev.type == "reach_complete"
            ]
            a, b, c, misses = match_reps(pred, labels["reaches"], args.tol, key="to_dot", t_key="t_placed")
            rtp, rfp, rfn = rtp + a, rfp + b, rfn + c
            for p in pred:
                if "matched" in p:
                    reach_err_ms.append(abs(p["reach_ms"] - labels["reaches"][p["matched"]]["reach_ms"]))
            row = {
                "id": e["id"], "mode": e["mode"], "synthetic": e.get("synthetic", False),
                "frames": res.frames, "labeled_reps": len(labels["reaches"]), "pred_reps": len(pred),
                "tp": a, "fp": b, "fn": c, "misses": misses,
            }
            rows.append(row)
            continue
        pred = [
            {"t": ev.t, "hole": ev.payload["hole"]} for ev in res.events if ev.type == "rep_complete"
        ]
        a, b, c, misses = match_reps(pred, labels["reps"], args.tol)
        tp, fp, fn = tp + a, fp + b, fn + c
        n_labeled += len(labels["reps"])
        row = {
            "id": e["id"], "mode": e["mode"], "synthetic": e.get("synthetic", False),
            "frames": res.frames, "labeled_reps": len(labels["reps"]), "pred_reps": len(pred),
            "tp": a, "fp": b, "fn": c, "misses": misses,
        }
        if e["mode"] == "nhpt":
            lab_total = labels["nhpt"]["total_s"]
            row["nhpt_labeled_s"] = lab_total
            row["nhpt_pred_s"] = res.nhpt_total_s
            if res.nhpt_total_s is not None:
                row["nhpt_abs_err_s"] = round(abs(res.nhpt_total_s - lab_total), 3)
                nhpt_err.append(row["nhpt_abs_err_s"])
        rows.append(row)

    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    rprec = rtp / (rtp + rfp) if rtp + rfp else 0.0
    rrec = rtp / (rtp + rfn) if rtp + rfn else 0.0
    rf1 = 2 * rprec * rrec / (rprec + rrec) if rprec + rrec else 0.0
    results = {
        "reach_f1": round(rf1, 4), "reach_tp": rtp, "reach_fp": rfp, "reach_fn": rfn,
        "reach_mae_ms": round(sum(reach_err_ms) / len(reach_err_ms), 1) if reach_err_ms else None,
        "dataset": manifest.get("version", "v0"), "tol_s": args.tol, "n_entries": len(rows),
        "n_labeled_reps": n_labeled, "tp": tp, "fp": fp, "fn": fn,
        "rep_precision": round(prec, 4), "rep_recall": round(rec, 4), "rep_f1": round(f1, 4),
        "nhpt_mae_s": round(sum(nhpt_err) / len(nhpt_err), 3) if nhpt_err else None,
        "n_synthetic": sum(bool(r["synthetic"]) for r in rows),
        "n_real": sum(not r["synthetic"] for r in rows),
        "entries": rows,
    }
    (out / "dataset_v0.json").write_text(json.dumps(results, indent=1))

    md = [
        "# dataset_v0 results", "",
        f"Regenerated by `evaluation/scripts/eval.py` (tolerance ±{args.tol}s).",
        f"**{results['n_synthetic']} synthetic, {results['n_real']} real** entries. "
        "Synthetic clips validate the pipeline only; they are not evidence about real-world accuracy.",
        "",
        "| id | mode | synthetic | labeled reps | predicted | TP | FP | FN | NHPT labeled | NHPT pred | abs err |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        md.append(
            f"| {r['id']} | {r['mode']} | {r['synthetic']} | {r['labeled_reps']} | {r['pred_reps']} | "
            f"{r['tp']} | {r['fp']} | {r['fn']} | {r.get('nhpt_labeled_s', '')} | "
            f"{r.get('nhpt_pred_s', '')} | {r.get('nhpt_abs_err_s', '')} |"
        )
    md += [
        "",
        f"**Rep F1 (NHPT): {results['rep_f1']}** (P {results['rep_precision']}, R {results['rep_recall']}) · "
        f"**NHPT MAE: {results['nhpt_mae_s']} s** · "
        f"**Reach F1 (cup): {results['reach_f1']}** · **Reach-time MAE: {results['reach_mae_ms']} ms**",
        "",
    ]
    (out / "dataset_v0.md").write_text("\n".join(md))
    print(json.dumps({k: v for k, v in results.items() if k != "entries"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
