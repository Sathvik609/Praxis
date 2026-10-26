"""Team-test report (21 Oct 2026 snapshot of the hosted 13 Oct build).

    cd services/session
    uv run python ../../evaluation/scripts/team_test_report.py      # -> results/team_test_2026-10-21.{md,json}
    uv run python ../../evaluation/scripts/team_test_report.py --check   # exit 1 if the committed files differ

Reads only the committed, pseudonymised snapshot in `evaluation/data/team_test_2026-10-21/`
(stored session summaries + events, 6 trace files, the server's own `/api/review` aggregate;
no frames exist anywhere). Every number in the output is computed here from those files, split
into **human testers** (T1–T3, team members) and **automated** sessions (`test-claude`:
an AI agent drove the site in a browser with a synthetic clip as the camera, not a person). Deterministic: the
same snapshot always gives byte-identical output.

What this is: a team shake-down of the 13 Oct build (healthy teammates, home laptops), not a
usability study, not a clinical measurement, and not ground-truthed (nobody labelled the reps).
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import Counter
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "services" / "session"))

from praxis_session.agent.model import PRICES  # noqa: E402
from praxis_session.coach.rules import HIKE_CUE_GAP_S, HIKE_CUES_PER_SET  # noqa: E402
from praxis_session.pipeline import HIPS_BLOCK_S, SETUP_BLOCK_S  # noqa: E402
from praxis_session.review import _refusal_kind  # noqa: E402  (the 21 Oct refused-vs-failed classifier)

DATA = ROOT / "evaluation" / "data" / "team_test_2026-10-21"
OUT = ROOT / "evaluation" / "results" / "team_test_2026-10-21"
AUTOMATED = "test-claude"
GROUPS = ("human", "automated")
EXERCISE = {"arm": "Arm out to the side", "cup": "Waiter – cup", "nhpt": "Nine-Hole Peg Test"}
HEADER = ("15 live sessions, 4 testers including automated agent-driven sessions; team shake-down "
          "on the 13 Oct build, not a usability study; small numbers")

# What changed afterwards (21 Oct, merged in 6d3ba8f, then db487c4). Text only;
# the effect on these sessions is computed below where the stored events allow it.
FIXES = [
    ("bd69790", "Arm setup gate: `hips_out_of_view` must hold for `HIPS_BLOCK_S` before the setup pause (other view gates keep `SETUP_BLOCK_S`); `setup_blocked` carries the visibility numbers"),
    ("bd69790", "Hike cue rationing in the rule coach: at most `HIKE_CUES_PER_SET` captions per set, `HIKE_CUE_GAP_S` apart; detection, events, counts and stop rules unchanged"),
    ("f45c1d9", "Review labels are exercise-aware: the arm's `setup_blocked` reads \"camera view check paused the set\" (the arm has no sheet), counted by setup pauses, with the failing checks listed; hike reported as a flag"),
    ("d08a995", "Agent tool calls: guardrail refusals (stale, no_change, ...) are traced with `error_kind` + `refused` and counted apart from failures; the feedback answers are a typed event so the end-of-session note always has evidence to cite"),
    ("6c9ce02", "Socket-close instrumentation: every live socket writes a `socket_close` trace row (saved, close code, agent run in flight, seconds since the last agent run); `/api/review` counts sockets that closed before their session was saved"),
    ("7663363", "Therapist-only writes: schedule changes need `PRAXIS_THERAPIST_TOKEN` (the shared review site could change the prescription)"),
    ("db487c4", "Agent pause ordering: after the fix line, `recalibrate` alone, wait, then `request_resume`; never stop after the fix line. Verified 15/15 scenarios and covered_marker 3/3 (`agent_recheck_2026-10-21_all.md`, `agent_recheck_2026-10-21_covered_marker_x3.md`)"),
]


def group_of(s: dict[str, Any]) -> str:
    return "automated" if s.get("username") == AUTOMATED else "human"


def med(xs: list[float]) -> float | None:
    return round(statistics.median(xs), 2) if xs else None


def load() -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]], dict[str, Any], dict[str, Any]]:
    sessions = [json.loads(p.read_text()) for p in sorted((DATA / "sessions").glob("*.json"))]
    sessions.sort(key=lambda s: (s["started_at"], s["id"]))
    traces = {p.stem: json.loads(p.read_text())["rows"] for p in sorted((DATA / "traces").glob("*.json"))}
    server = json.loads((DATA / "review_server.json").read_text())
    meta = json.loads((DATA / "meta.json").read_text())
    return sessions, traces, server, meta


def hike_cues_rationed(events: list[dict[str, Any]]) -> int:
    """Hike captions the 21 Oct rule coach would say on these events (`coach/rules.py`: reset at
    exercise_start / set_complete, at most HIKE_CUES_PER_SET per set, HIKE_CUE_GAP_S apart)."""
    said, last, n = 0, -1e9, 0
    for e in events:
        if e.get("type") in ("exercise_start", "set_complete"):
            said, last = 0, -1e9
        elif e.get("type") == "shoulder_hiking":
            if said >= HIKE_CUES_PER_SET or e["t"] - last < HIKE_CUE_GAP_S:
                continue
            said, last, n = said + 1, e["t"], n + 1
    return n


def one(s: dict[str, Any]) -> dict[str, Any]:
    summ = s.get("summary") or {}
    cam = summ.get("camera") or {}
    ev = s.get("events") or []
    kinds = Counter(e.get("type") for e in ev)
    fb = s.get("feedback") or {}
    lat = summ.get("latency") or {}
    coach = summ.get("coach") or {}
    return {
        "id": s["id"], "group": group_of(s), "tester": s.get("username"), "mode": s["mode"],
        "exercise": EXERCISE[s["mode"]], "date": s["date"], "status": s["status"],
        "ended_early": s["status"] == "ended_early", "ended_early_answer": fb.get("ended_early") is True,
        "stopped": bool(summ.get("stopped")), "end_reason": fb.get("end_reason"),
        "reps": int(cam.get("reps_total") or 0), "verified": int(cam.get("verified") or 0),
        "unverified": int(cam.get("unverified") or 0), "missed": int(cam.get("missed") or 0),
        "active_s": cam.get("active_s"), "paused_s": cam.get("paused_s"),
        "setup_blocked": kinds["setup_blocked"],
        "setup_blocked_why": dict(Counter(str(e.get("reason")) for e in ev if e.get("type") == "setup_blocked")),
        "setup_pauses": sum(1 for e in ev if e.get("type") == "pause" and e.get("rule") == "setup"),
        "hike_events": kinds["shoulder_hiking"], "hike_cues_21oct": hike_cues_rationed(ev),
        "target_missed": kinds["target_missed"], "hold_too_short": kinds["hold_too_short"],
        "lean": kinds["compensation_lean"], "tracking_lost": kinds["perception_lost"],
        "peaks_deg": cam.get("peak_deg") or [],
        "flags": [f.get("rule") for f in summ.get("flags") or []],
        "agent": bool(coach.get("agent")), "agent_decisions": int(coach.get("agent_decisions") or 0),
        "capture_to_event_p50_ms": lat.get("capture_to_event_p50"), "event_to_cue_p50_ms": lat.get("event_to_cue_p50"),
        "frames": lat.get("frames"), "dropped": lat.get("dropped"),
        "difficulty": fb.get("difficulty"),
    }


def rollup(rows: list[dict[str, Any]]) -> dict[str, Any]:
    reps = sum(r["reps"] for r in rows)
    ver = sum(r["verified"] for r in rows)
    sb = [r for r in rows if r["setup_blocked"]]
    return {
        "sessions": len(rows), "testers": len({r["tester"] for r in rows}),
        "reps": reps, "verified": ver, "unverified": sum(r["unverified"] for r in rows), "missed": sum(r["missed"] for r in rows),
        "verified_pct": round(100 * ver / reps) if reps else None,
        "sessions_with_reps": sum(1 for r in rows if r["reps"]),
        "setup_blocked_events": sum(r["setup_blocked"] for r in rows), "sessions_with_setup_blocked": len(sb),
        "setup_blocked_why": dict(sum((Counter(r["setup_blocked_why"]) for r in rows), Counter())),
        "setup_pauses": sum(r["setup_pauses"] for r in rows),
        "hike_events": sum(r["hike_events"] for r in rows), "sessions_with_hike": sum(1 for r in rows if r["hike_events"]),
        "hike_cues_21oct": sum(r["hike_cues_21oct"] for r in rows),
        "target_missed": sum(r["target_missed"] for r in rows), "sessions_with_target_missed": sum(1 for r in rows if r["target_missed"]),
        "hold_too_short": sum(r["hold_too_short"] for r in rows), "lean": sum(r["lean"] for r in rows),
        "tracking_lost": sum(r["tracking_lost"] for r in rows),
        "therapist_flags": dict(sorted(Counter(f for r in rows for f in r["flags"]).items())),
        "ended_early": sum(r["ended_early"] for r in rows),
        "ended_early_answer": sum(r["ended_early_answer"] for r in rows),
        "stopped_by_rule": sum(r["stopped"] for r in rows),
        "end_reasons": dict(sorted(Counter(str(r["end_reason"]) for r in rows if r["ended_early_answer"]).items())),
        "ended_early_after_setup_pause": sum(1 for r in rows if r["ended_early_answer"] and r["setup_pauses"]),
        "active_s": sorted(r["active_s"] for r in rows if r["active_s"] is not None),
        "median_paused_s": med([r["paused_s"] for r in rows if r["paused_s"] is not None]),
        "median_capture_to_event_p50_ms": med([r["capture_to_event_p50_ms"] for r in rows if r["capture_to_event_p50_ms"] is not None]),
        "median_event_to_cue_p50_ms": med([r["event_to_cue_p50_ms"] for r in rows if r["event_to_cue_p50_ms"] is not None]),
        "difficulty": dict(sorted(Counter(r["difficulty"] for r in rows if r["difficulty"]).items())),
        "agent_sessions": sum(r["agent"] for r in rows), "agent_decisions": sum(r["agent_decisions"] for r in rows),
    }


def agent_from_traces(traces: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    runs: Counter[str] = Counter()
    tools: Counter[str] = Counter()
    failed: list[dict[str, Any]] = []
    refused: list[dict[str, Any]] = []
    first, whole = [], []
    tok = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    cost = 0.0
    for sid, rows in sorted(traces.items()):
        for r in rows:
            kind = r.get("kind")
            if kind == "agent_run" and r.get("phase") == "end":
                runs[str(r.get("outcome"))] += 1
                if r.get("first_action_ms") is not None:
                    first.append(float(r["first_action_ms"]))
                if r.get("ms") is not None:
                    whole.append(float(r["ms"]))
                row = {k: int(r.get(f"{k}_tokens") or 0) for k in tok}
                for k, v in row.items():
                    tok[k] += v
                p = PRICES[str(r.get("model"))]
                cost += sum(row[k] * p[k] for k in row) / 1e6
            elif kind == "tool" and "server" in r:
                tools[str(r.get("name"))] += 1
                if r.get("ok") is False:
                    k = _refusal_kind(r)
                    item = {"session": sid, "tool": r.get("name"), "seq": r.get("seq"), "kind": k or "failure"}
                    (refused if k else failed).append(item)
    return {
        "sessions": len(traces), "runs": sum(runs.values()), "outcomes": dict(sorted(runs.items())),
        "tool_calls": sum(tools.values()), "tools": dict(sorted(tools.items())),
        "refused_by_guardrail": refused, "failed": failed,
        "first_action_ms_p50": med(first), "run_ms_p50": med(whole),
        "tokens": tok, "cost_usd_list_price": round(cost, 4),
    }


def build() -> dict[str, Any]:
    sessions, traces, server, meta = load()
    rows = [one(s) for s in sessions]
    by: dict[str, dict[str, Any]] = {}
    for mode in ("arm", "cup", "nhpt"):
        mine = [r for r in rows if r["mode"] == mode]
        by[EXERCISE[mode]] = {g: rollup([r for r in mine if r["group"] == g]) for g in GROUPS} | {"all": rollup(mine)}
    trace_groups = sorted({group_of(s) for s in sessions if s["id"] in traces})
    sa = server["agent"]
    return {
        "header": HEADER, "meta": meta,
        "groups": {g: {"sessions": sum(1 for r in rows if r["group"] == g), "testers": sorted({r["tester"] for r in rows if r["group"] == g})} for g in GROUPS},
        "sessions": rows,
        "by_exercise": by,
        "totals": {g: rollup([r for r in rows if r["group"] == g]) for g in GROUPS} | {"all": rollup(rows)},
        "agent": {
            "server_all_15": {k: sa[k] for k in ("sessions", "runs", "agent_decisions", "outcomes", "triggers", "models", "transports", "errors", "tools", "tool_failures", "first_action_ms_p50", "run_ms_p50", "tokens", "cost_usd")},
            "traces": agent_from_traces(traces) | {"groups": trace_groups, "testers": sorted({s["username"] for s in sessions if s["id"] in traces})},
        },
        "constants_21oct": {"SETUP_BLOCK_S": SETUP_BLOCK_S, "HIPS_BLOCK_S": HIPS_BLOCK_S, "HIKE_CUES_PER_SET": HIKE_CUES_PER_SET, "HIKE_CUE_GAP_S": HIKE_CUE_GAP_S},
        "fixes_21oct": [{"commit": c, "what": w} for c, w in FIXES],
    }


def _n(x: Any) -> str:
    return "–" if x is None else f"{x:g}" if isinstance(x, float) else str(x)


def _d(d: dict[str, Any]) -> str:
    return ", ".join(f"{k} {v}" for k, v in d.items()) or "none"


def render(r: dict[str, Any]) -> str:
    L: list[str] = []
    m = r["meta"]
    L += ["# Team test 21 Oct 2026 — 13 Oct build", "",
          f"**{r['header']}.**", "",
          f"Sessions run {m['sessions_run']} on the hosted review build; snapshot taken {m['snapshot_taken']} (GET only). "
          "Healthy teammates on their own laptops, nobody labelled the reps, so nothing here is accuracy: it says where the product got in the way. "
          "**Human** = T1–T3 (team members, pseudonyms). **Automated** = `test-claude`: an AI agent drove the site in a browser with a synthetic clip as the camera, not a person; "
          "they exercise the flow, not a human body.", "",
          "Regenerate: `cd services/session && uv run python ../../evaluation/scripts/team_test_report.py` "
          "(reads `evaluation/data/team_test_2026-10-21/`, pseudonymised, no frames).", ""]
    g = r["groups"]
    L += [f"Testers: human {len(g['human']['testers'])} ({', '.join(g['human']['testers'])}) in {g['human']['sessions']} sessions; "
          f"automated 1 (`test-claude`) in {g['automated']['sessions']} sessions.", ""]

    L += ["## Per exercise", "",
          "| exercise | group | sessions | sessions with reps | reps | verified | unverified | missed | ended early (status / tester's answer) | therapist flags |",
          "|---|---|---:|---:|---:|---:|---:|---:|---:|---|"]
    for ex, d in r["by_exercise"].items():
        for grp in GROUPS:
            x = d[grp]
            if not x["sessions"]:
                continue
            L.append(f"| {ex} | {grp} | {x['sessions']} | {x['sessions_with_reps']} | {x['reps']} | {x['verified']}"
                     f"{f' ({x['verified_pct']} %)' if x['verified_pct'] is not None else ''} | {x['unverified']} | {x['missed']} | {x['ended_early']} / {x['ended_early_answer']} | {_d(x['therapist_flags'])} |")
    hc, hn = r["by_exercise"]["Waiter – cup"]["human"], r["by_exercise"]["Nine-Hole Peg Test"]["human"]
    tot = r["totals"]["all"]
    L += ["", "Missed = a rep the arm state machine counted that did not reach the target or hold long enough (`target_missed` / `hold_too_short`). "
          "Ended early: the stored status, and the tester's own answer on screen 08 (they differ where the server stored `complete` but the answer says the session was ended early). "
          f"Stopped by a stop rule: {tot['stopped_by_rule']} of {tot['sessions']}. "
          "Therapist flags: `missed_reps` = stop rule (3 consecutive missed reps); `agent` = the agent's `flag_therapist`. "
          f"The human Waiter – cup and NHPT sessions recorded no reps (active time {', '.join(f'{x:g}' for x in hc['active_s'] + hn['active_s'])} s); "
          "the automated cup session's result is a synthetic clip.", ""]

    a = r["by_exercise"]["Arm out to the side"]
    L += ["## Arm out to the side: where it got in the way", "",
          "| | human | automated | all |", "|---|---:|---:|---:|"]

    def row(label: str, key: str, sess: str | None = None) -> None:
        cells = []
        for grp in ("human", "automated", "all"):
            x = a[grp]
            cells.append(f"{x[key]}" + (f" in {x[sess]}/{x['sessions']}" if sess else ""))
        L.append(f"| {label} | " + " | ".join(cells) + " |")

    row("sessions", "sessions")
    row("`setup_blocked` events (sessions hit)", "setup_blocked_events", "sessions_with_setup_blocked")
    row("setup pauses the tester saw", "setup_pauses")
    row("shoulder-hike flags (sessions hit)", "hike_events", "sessions_with_hike")
    row(f"hike captions under the 21 Oct rationing ({r['constants_21oct']['HIKE_CUES_PER_SET']}/set, {r['constants_21oct']['HIKE_CUE_GAP_S']:g} s gap), same events", "hike_cues_21oct")
    row("lift short of the target (sessions hit)", "target_missed", "sessions_with_target_missed")
    row("hold shorter than prescribed", "hold_too_short")
    row("trunk lean", "lean")
    row("tracking lost", "tracking_lost")
    row("ended early (stored status)", "ended_early")
    row("ended early (tester's answer)", "ended_early_answer")
    row("ended early (answer) in a session that had a setup pause", "ended_early_after_setup_pause")
    row("stopped by a stop rule", "stopped_by_rule")
    L += ["", f"- `setup_blocked` reasons: {_d(a['all']['setup_blocked_why'])}. A repeat `setup_blocked` while the set was already paused did not pause again, so pauses ≤ events.",
          f"- Ended-early reasons the tester gave: human {_d(a['human']['end_reasons'])}; automated {_d(a['automated']['end_reasons'])}. "
          "Each was the tester pressing End (stored with its feedback over a live socket), not a crash.",
          f"- Therapist flags: human {_d(a['human']['therapist_flags'])}; automated {_d(a['automated']['therapist_flags'])}.",
          f"- Median paused time per session: human {_n(a['human']['median_paused_s'])} s, automated {_n(a['automated']['median_paused_s'])} s.",
          f"- The 6 s hips gate (`HIPS_BLOCK_S` = {r['constants_21oct']['HIPS_BLOCK_S']:g} s, was {r['constants_21oct']['SETUP_BLOCK_S']:g} s) cannot be replayed on these sessions: the 13 Oct events do not carry how long the gate was held. Its effect is untested on people.", ""]

    L += ["## Per session", "",
          "| session | date | group | tester | exercise | status (reason) | reps V/U/M | setup blocked / pauses | hike flags → 21 Oct captions | therapist flags | agent decisions |",
          "|---|---|---|---|---|---|---|---|---|---|---:|"]
    for s in r["sessions"]:
        L.append(f"| `{s['id']}` | {s['date']} | {s['group']} | {s['tester']} | {s['exercise']} | {s['status']} ({s['end_reason'] or '–'}) | "
                 f"{s['verified']}/{s['unverified']}/{s['missed']} | {s['setup_blocked']} / {s['setup_pauses']} | {s['hike_events']} → {s['hike_cues_21oct']} | "
                 f"{', '.join(s['flags']) or '–'} | {s['agent_decisions']} |")

    ag = r["agent"]
    sv, tr = ag["server_all_15"], ag["traces"]
    t = r["totals"]
    L += ["", "## AI coach (Claude agent, Anthropic API)", "",
          f"- Sessions with the agent on: human {t['human']['agent_sessions']}/{t['human']['sessions']}, automated {t['automated']['agent_sessions']}/{t['automated']['sessions']}; "
          f"agent coach decisions: human {t['human']['agent_decisions']}, automated {t['automated']['agent_decisions']} (session summaries).",
          f"- All 15 sessions (the server's `/api/review` aggregate, which read every trace file; not splittable by group): {sv['runs']} runs ({_d(sv['outcomes'])}), "
          f"model {_d(sv['models'])}, transport {_d(sv['transports'])}, errors {_d(sv['errors'])}; "
          f"checkpoint → first action median {sv['first_action_ms_p50'] / 1000:.1f} s, whole run {sv['run_ms_p50'] / 1000:.1f} s; "
          f"tokens {sv['tokens']['input']} in / {sv['tokens']['output']} out / {sv['tokens']['cache_read']} cache read / {sv['tokens']['cache_write']} cache write; est. ${sv['cost_usd']:.2f} at list price.",
          f"- Tool calls failed as reported by the 13 Oct review: {_d(sv['tool_failures'])} ({sum(sv['tool_failures'].values())}).",
          f"- Trace files kept for {tr['sessions']} sessions ({', '.join(tr['groups'])} only): {tr['runs']} runs ({_d(tr['outcomes'])}), {tr['tool_calls']} agent tool calls, "
          f"first action median {tr['first_action_ms_p50'] / 1000:.1f} s, est. ${tr['cost_usd_list_price']:.2f}. Re-classified with the 21 Oct rule (d08a995): "
          f"{len(tr['refused_by_guardrail'])} refused by a guardrail ("
          + ", ".join(f"`{x['tool']}` {x['kind']} in `{x['session']}`" for x in tr["refused_by_guardrail"])
          + f"), {len(tr['failed'])} real failures in these traces.",
          "- The fourth reported failure (`write_session_summary`) is in an automated session whose trace is not in the snapshot; commit d08a995 identifies it as `098b067da2b5`, a session ended before any check-in or OpenCV event, so the note had no evidence id to cite (fixed there).",
          "", "## Latency (browser-measured, per session p50, median across sessions)", "",
          "| | capture → event p50 (ms) | event → cue p50 (ms) |", "|---|---:|---:|"]
    for grp in GROUPS:
        L.append(f"| {grp} | {_n(t[grp]['median_capture_to_event_p50_ms'])} | {_n(t[grp]['median_event_to_cue_p50_ms'])} |")
    L += ["", "## Socket closes", "", f"- {m['socket_close']}. Two 13 Oct sockets that dropped before saving are known only from the team's notes (nothing was stored for them).", ""]

    L += ["## Fixed afterwards (21 Oct; not deployed on the 13 Oct build these sessions ran on)", "",
          "| commit | change |", "|---|---|"]
    L += [f"| `{f['commit']}` | {f['what']} |" for f in r["fixes_21oct"]]
    c = r["constants_21oct"]
    L += ["", f"Current constants: `SETUP_BLOCK_S` = {c['SETUP_BLOCK_S']:g} s, `HIPS_BLOCK_S` = {c['HIPS_BLOCK_S']:g} s, `HIKE_CUES_PER_SET` = {c['HIKE_CUES_PER_SET']}, `HIKE_CUE_GAP_S` = {c['HIKE_CUE_GAP_S']:g} s. "
          "None of these fixes has been re-tested with people yet. Failure cases: `evaluation/failure_cases/`.", "",
          "## Limits", "",
          f"- {len(g['human']['testers'])} healthy teammates and 1 automated tester; {g['human']['sessions']} human sessions, "
          f"{max(Counter(s['tester'] for s in r['sessions'] if s['group'] == 'human').values())} of them by one tester. Not patients, not a usability study, no SUS.",
          "- No ground truth: verified / missed are what the product said, not whether the tester really lifted to the target.",
          f"- Agent numbers by group are partial: only {tr['sessions']} traces ({', '.join(tr['testers'])}) were still in server memory.", ""]
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="compare with the committed outputs instead of writing")
    ap.add_argument("--out", type=Path, default=OUT, help="output path without extension")
    a = ap.parse_args(argv)
    r = build()
    md, js = render(r), json.dumps(r, indent=1, ensure_ascii=False) + "\n"
    if a.check:
        same = a.out.with_suffix(".md").read_text() == md and a.out.with_suffix(".json").read_text() == js
        print("identical" if same else "DIFFERS")
        return 0 if same else 1
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.with_suffix(".md").write_text(md)
    a.out.with_suffix(".json").write_text(js)
    print(a.out.with_suffix(".md"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
