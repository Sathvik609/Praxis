"""Score the moderated usability test (evaluation/usability/PLAN.md) into results/usability_v0.{md,json}.

    cd services/session
    uv run python ../../evaluation/scripts/usability.py [--tasks CSV] [--issues CSV] [--therapists CSV] [--out DIR]

Input (copy each *_template.csv once, never a name in any file):
- tasks.csv: participant (p01..), date, task (T1..T9), mode (live/replay), outcome
  (success = unaided, assisted = after the hint, failed), time_s, errors, seq (1-7), notes.
- issues.csv (optional): id, task, description, participants_hit, severity (Nielsen 0-4), fix.
- therapist.csv (optional): therapist (t01..), date, role, years, q1..q6 (1-5), would_recommend
  (0-10), notes.

Per task: n, unaided and completion rates with Wilson 95 % intervals, median time of completed
attempts, mean errors, mean SEQ (Sauro & Dumas 2009). Issues sorted by severity then frequency.
Notes stay in the CSVs and are never copied into the results. Malformed rows stop the run with
the row number: nothing is guessed. SUS is scored separately by sus.py.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import statistics
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve()
KIT = HERE.parents[1] / "usability"
TASKS = [f"T{i}" for i in range(1, 10)]
TASK_NAMES = {
    "T1": "Check-in (pain 2, right arm)",
    "T2": "Watch the demonstration",
    "T3": "Camera setup → live",
    "T4": "Read the verified count",
    "T5": "Report sharp pain",
    "T6": "Find the coach's note in the report",
    "T7": "Waiter – cup, one round",
    "T8": "Find progress over weeks",
    "T9": "Therapist: find a safety flag",
}
OUTCOMES = ("success", "assisted", "failed")
MODES = ("live", "replay")
PSEUDONYM = re.compile(r"^p\d{2,3}$")
THERAPIST = re.compile(r"^t\d{2,3}$")
Z = 1.96


def wilson(k: int, n: int) -> tuple[float | None, float | None]:
    """Wilson score 95 % interval for k successes out of n."""
    if n == 0:
        return (None, None)
    p = k / n
    denom = 1 + Z * Z / n
    centre = (p + Z * Z / (2 * n)) / denom
    margin = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / denom
    return (round(max(0.0, centre - margin), 3), round(min(1.0, centre + margin), 3))


def _rows(path: Path, required: list[str]) -> list[tuple[int, dict[str, str]]]:
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        missing = [c for c in required if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"{path}: missing columns {missing} (copy the template)")
        return [(n, {k: (v or "").strip() for k, v in r.items() if k}) for n, r in enumerate(reader, start=2)
                if any((v or "").strip() for v in r.values())]


def _int(value: str, what: str, lo: int, hi: int, n: int) -> int:
    try:
        x = int(value)
    except ValueError:
        raise ValueError(f"row {n}: {what} must be a whole number {lo}-{hi}, got {value!r}") from None
    if not lo <= x <= hi:
        raise ValueError(f"row {n}: {what} must be {lo}-{hi}, got {x}")
    return x


def read_tasks(path: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for n, r in _rows(path, ["participant", "date", "task", "mode", "outcome", "time_s", "errors", "seq"]):
        p = r["participant"].lower()
        if not PSEUDONYM.match(p):
            raise ValueError(f"row {n}: participant must be a pseudonym like p01, got {r['participant']!r}")
        t = r["task"].upper()
        if t not in TASKS:
            raise ValueError(f"row {n}: task must be one of T1-T9, got {r['task']!r}")
        if (p, t) in seen:
            raise ValueError(f"row {n}: {p} {t} appears twice")
        seen.add((p, t))
        if r["outcome"].lower() not in OUTCOMES:
            raise ValueError(f"row {n}: outcome must be success, assisted or failed, got {r['outcome']!r}")
        if r["mode"].lower() not in MODES:
            raise ValueError(f"row {n}: mode must be live or replay, got {r['mode']!r}")
        try:
            time_s = float(r["time_s"])
        except ValueError:
            raise ValueError(f"row {n}: time_s must be seconds, got {r['time_s']!r}") from None
        out.append({
            "participant": p, "date": r["date"], "task": t, "mode": r["mode"].lower(),
            "outcome": r["outcome"].lower(), "time_s": time_s,
            "errors": _int(r["errors"], "errors", 0, 1000, n), "seq": _int(r["seq"], "seq", 1, 7, n),
        })
    return out


def summarise_tasks(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for t in TASKS:
        rs = [r for r in rows if r["task"] == t]
        if not rs:
            continue
        n = len(rs)
        counts = {o: sum(r["outcome"] == o for r in rs) for o in OUTCOMES}
        done = [r["time_s"] for r in rs if r["outcome"] != "failed"]
        modes: dict[str, int] = {}
        for r in rs:
            modes[r["mode"]] = modes.get(r["mode"], 0) + 1
        out[t] = {
            "name": TASK_NAMES[t], "n": n, **counts,
            "unaided_rate": round(counts["success"] / n, 3), "unaided_ci": wilson(counts["success"], n),
            "completion_rate": round((n - counts["failed"]) / n, 3), "completion_ci": wilson(n - counts["failed"], n),
            "median_time_s": statistics.median(done) if done else None,
            "mean_errors": round(sum(r["errors"] for r in rs) / n, 2),
            "mean_seq": round(sum(r["seq"] for r in rs) / n, 2),
            "modes": modes,
        }
    return out


def read_issues(path: Path) -> list[dict[str, Any]]:
    out = []
    for n, r in _rows(path, ["id", "task", "description", "participants_hit", "severity", "fix"]):
        out.append({"id": r["id"], "task": r["task"].upper(), "description": r["description"],
                    "participants_hit": _int(r["participants_hit"], "participants_hit", 0, 1000, n),
                    "severity": _int(r["severity"], "severity", 0, 4, n), "fix": r["fix"]})
    return sorted(out, key=lambda i: (-i["severity"], -i["participants_hit"], i["id"]))


def read_therapists(path: Path) -> dict[str, Any]:
    items = [f"q{i}" for i in range(1, 7)]
    rows = []
    for n, r in _rows(path, ["therapist", "date", "role", "years", *items, "would_recommend"]):
        t = r["therapist"].lower()
        if not THERAPIST.match(t):
            raise ValueError(f"row {n}: therapist must be a code like t01, got {r['therapist']!r}")
        rows.append({"therapist": t, "role": r["role"], "years": r["years"],
                     **{q: _int(r[q], q, 1, 5, n) for q in items},
                     "would_recommend": _int(r["would_recommend"], "would_recommend", 0, 10, n)})
    k = len(rows)
    return {"n": k, "rows": rows,
            "item_means": {q: round(sum(r[q] for r in rows) / k, 2) for q in items} if k else {},
            "would_recommend_mean": round(sum(r["would_recommend"] for r in rows) / k, 1) if k else None}


def _pct(x: float | None) -> str:
    return "–" if x is None else f"{100 * x:.0f} %"


def _ci(ci: tuple[float | None, float | None]) -> str:
    return "–" if ci[0] is None else f"{100 * ci[0]:.0f}–{100 * ci[1]:.0f} %"


THERAPIST_ITEMS = {
    "q1": "Therapist view would help me review home practice",
    "q2": "Stop rules are appropriate for home use",
    "q3": "I would trust the verified rep counts",
    "q4": "Patients could set up camera and sheets alone",
    "q5": "Coach corrections are the feedback I would give",
    "q6": "I would consider prescribing a tool like this",
}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="usability.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tasks", default=str(KIT / "tasks.csv"))
    ap.add_argument("--issues", default=str(KIT / "issues.csv"))
    ap.add_argument("--therapists", default=str(KIT / "therapist.csv"))
    ap.add_argument("--out", default=str(HERE.parents[1] / "results"))
    args = ap.parse_args(argv)
    tasks_path = Path(args.tasks)
    if not tasks_path.exists():
        print(f"no task results at {tasks_path}: copy evaluation/usability/tasks_template.csv to tasks.csv")
        return 2
    try:
        rows = read_tasks(tasks_path)
        issues = read_issues(Path(args.issues)) if Path(args.issues).exists() else []
        ther = read_therapists(Path(args.therapists)) if Path(args.therapists).exists() else {"n": 0, "rows": [], "item_means": {}, "would_recommend_mean": None}
    except ValueError as e:
        print(f"ERROR: {e}")
        return 1
    if not rows:
        print(f"{tasks_path} has no rows yet")
        return 2
    summary = summarise_tasks(rows)
    participants = sorted({r["participant"] for r in rows})
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    doc = {"study": "moderated usability test, evaluation/usability/PLAN.md", "participants": len(participants),
           "tasks": summary, "issues": issues,
           "therapists": {k: ther[k] for k in ("n", "item_means", "would_recommend_mean")}}
    (out / "usability_v0.json").write_text(json.dumps(doc, indent=1) + "\n")

    md = [
        "# usability_v0", "",
        "Moderated usability test (`evaluation/usability/PLAN.md`), regenerated by `evaluation/scripts/usability.py`. "
        f"**{len(participants)} participants**, first-time users, no patients. Rates carry Wilson 95 % intervals; with "
        "this few people they are rough indications, not benchmarks. SEQ is the Single Ease Question (1 very difficult – "
        "7 very easy, Sauro & Dumas 2009). SUS is in `sus_v0.md`.", "",
        "| task | n | unaided | (95 % CI) | completed | (95 % CI) | median time | mean errors | mean SEQ | mode |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for t, s in summary.items():
        mode = ", ".join(f"{m} {c}" for m, c in sorted(s["modes"].items()))
        tm = "–" if s["median_time_s"] is None else f"{s['median_time_s']:g} s"
        md.append(f"| {t} {s['name']} | {s['n']} | {_pct(s['unaided_rate'])} | {_ci(s['unaided_ci'])} | "
                  f"{_pct(s['completion_rate'])} | {_ci(s['completion_ci'])} | {tm} | {s['mean_errors']:g} | {s['mean_seq']:g} | {mode} |")
    if issues:
        md += ["", "## Issues (Nielsen severity 4 = blocks the task … 1 = cosmetic)", "",
               "| id | task | issue | participants | severity | fix |", "|---|---|---|---|---|---|",
               *[f"| {i['id']} | {i['task']} | {i['description']} | {i['participants_hit']} | {i['severity']} | {i['fix'] or 'open'} |" for i in issues]]
    if ther["n"]:
        md += ["", f"## Therapist feedback (n = {ther['n']}; our own six items, not a validated scale; expert opinion, not clinical evidence)", "",
               "| item | mean (1–5) |", "|---|---|",
               *[f"| {THERAPIST_ITEMS[q]} | {v:g} |" for q, v in ther["item_means"].items()],
               "", f"Would recommend to a colleague (0–10): mean {ther['would_recommend_mean']:g}."]
    if len(participants) < 5:
        md += ["", f"_Only {len(participants)} participant(s): too few to report as a usability result._"]
    (out / "usability_v0.md").write_text("\n".join(md) + "\n")
    print(json.dumps({"participants": len(participants), "tasks": len(summary), "issues": len(issues), "therapists": ther["n"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
