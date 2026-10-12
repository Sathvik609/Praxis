"""Team test review (12 Oct 2026): where to improve, read from the sessions Praxis already stores.

Teammates run sessions on the hosted review build under a tester name (`PRAXIS_TEAM_TEST=1`
asks for it once per browser; the WebSocket carries it as `tester`, saved as the session's
`username`). This module turns the stored sessions (summary + events, never frames) into a
per-exercise, per-tester table and a ranked list of problem spots. It reads only what the
pipeline and the screen-08 answers wrote; nothing here is a clinical or usability score.

Sample (illustrative seed) sessions are never counted. Replays are counted separately: they
are recorded clips, so they say nothing about how a person got on.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

TESTER_RE = re.compile(r"[^a-z0-9 _.-]")
UNTAGGED = "(no name)"

# Events that mark something going wrong, with the plain words the report uses.
PROBLEM_EVENTS: dict[str, str] = {
    "perception_lost": "camera lost tracking (session paused)",
    "target_missed": "lift fell short of the target",
    "hold_too_short": "hold shorter than prescribed",
    "shoulder_hiking": "shoulder hiking cue",
    "compensation_lean": "trunk lean cue",
    "wrong_hole": "peg in the wrong hole",
    "drop": "peg dropped",
    "wrong_dot": "cup put on the wrong dot",
    "setup_blocked": "setup could not see the sheet",
}
REP_EVENTS = ("rep_complete", "reach_complete")


def clean_tester(raw: str | None) -> str | None:
    """A tester name as stored: lower case, letters/digits/space/._- only, at most 24 chars."""
    if not raw:
        return None
    name = TESTER_RE.sub("", raw.strip().lower())[:24].strip()
    return name or None


def _exercise(s: dict[str, Any]) -> str:
    if s.get("mode") == "arm":
        return s.get("title") or s.get("exercise") or "arm"
    return {"cup": "Waiter – cup", "nhpt": "Nine-Hole Peg Test"}.get(s.get("mode", ""), s.get("title") or "session")


def _median(xs: list[float]) -> float | None:
    if not xs:
        return None
    ys = sorted(xs)
    n = len(ys)
    return ys[n // 2] if n % 2 else (ys[n // 2 - 1] + ys[n // 2]) / 2


def _one(s: dict[str, Any]) -> dict[str, Any]:
    """The numbers one session contributes."""
    summ = s.get("summary") or {}
    cam = summ.get("camera") or {}
    events = s.get("events") or []
    kinds = Counter(e.get("type") for e in events)
    reasons = Counter(e.get("reason") for e in events if e.get("type") in REP_EVENTS and not e.get("verified") and e.get("reason"))
    problems = Counter({k: kinds[k] for k in PROBLEM_EVENTS if kinds.get(k)})
    # What the camera could not see when tracking was lost: marker ids, "pose", ...
    lost_what = Counter((f"marker {m}" if isinstance(m, int) else str(m)) for e in events if e.get("type") == "perception_lost" for m in e.get("missing") or [])
    fb = s.get("feedback") or {}
    return {
        "reps": int(cam.get("reps_total") or 0),
        "verified": int(cam.get("verified") or 0),
        "unverified": int(cam.get("unverified") or 0),
        "missed": int(cam.get("missed") or 0),
        "tracking_lost": int(summ.get("tracking_lost_events") or cam.get("tracking_lost_events") or 0),
        "paused_s": float(cam.get("paused_s") or 0),
        "coverage_pct": cam.get("coverage_pct"),
        "ended_early": s.get("status") == "ended_early",
        "flags": [f.get("rule") for f in summ.get("flags") or [] if f.get("rule")],
        "unverified_reasons": reasons,
        "lost_what": lost_what,
        "problems": problems,
        "corrections": [n.get("text", "") for n in (summ.get("coach") or {}).get("notes") or [] if str(n.get("text", "")).startswith("correct")],
        "exertion": (summ.get("exertion") or {}).get("level"),
        "difficulty": fb.get("difficulty"),
        "barriers": list(fb.get("barriers") or []),
        "detail": (fb.get("detail") or "").strip(),
        "cue_p50": (summ.get("latency") or {}).get("event_to_cue_p50"),
        "nhpt_s": cam.get("nhpt_total_s"),
    }


def build_review(sessions: list[dict[str, Any]]) -> dict[str, Any]:
    """Sessions as `Store.session()` returns them (with events). Live ones are analysed."""
    live = [s for s in sessions if s.get("source") == "live"]
    replays = sum(1 for s in sessions if s.get("source") == "replay")
    by_ex: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    testers: Counter[str] = Counter()
    for s in live:
        who = s.get("username") or UNTAGGED
        testers[who] += 1
        by_ex[_exercise(s)].append((who, _one(s)))

    exercises = []
    issues = []
    for ex, rows in sorted(by_ex.items()):
        n = len(rows)
        reps = sum(r["reps"] for _, r in rows)
        ver = sum(r["verified"] for _, r in rows)
        unver = sum(r["unverified"] for _, r in rows)
        missed = sum(r["missed"] for _, r in rows)
        problems: Counter[str] = Counter()
        sessions_with: Counter[str] = Counter()
        reasons: Counter[str] = Counter()
        flags: Counter[str] = Counter()
        corrections: Counter[str] = Counter()
        lost_what: Counter[str] = Counter()
        for _, r in rows:
            lost_what.update(r["lost_what"])
            problems.update(r["problems"])
            sessions_with.update(set(r["problems"]))
            reasons.update(r["unverified_reasons"])
            flags.update(r["flags"])
            corrections.update(r["corrections"])
        per_tester = []
        for who in sorted({w for w, _ in rows}):
            mine = [r for w, r in rows if w == who]
            per_tester.append({
                "tester": who, "sessions": len(mine),
                "reps": sum(r["reps"] for r in mine), "verified": sum(r["verified"] for r in mine),
                "unverified": sum(r["unverified"] for r in mine), "missed": sum(r["missed"] for r in mine),
                "tracking_lost": sum(r["tracking_lost"] for r in mine),
                "ended_early": sum(r["ended_early"] for r in mine),
            })
        entry = {
            "exercise": ex, "sessions": n, "testers": len({w for w, _ in rows}),
            "reps": reps, "verified": ver, "unverified": unver, "missed": missed,
            "verified_pct": round(100 * ver / reps) if reps else None,
            "tracking_lost": sum(r["tracking_lost"] for _, r in rows),
            "sessions_with_tracking_lost": sum(1 for _, r in rows if r["tracking_lost"]),
            "ended_early": sum(r["ended_early"] for _, r in rows),
            "median_paused_s": _median([r["paused_s"] for _, r in rows]),
            "median_cue_p50_s": _median([r["cue_p50"] for _, r in rows if r["cue_p50"] is not None]),
            "nhpt_times_s": [r["nhpt_s"] for _, r in rows if r["nhpt_s"]],
            "problems": dict(problems.most_common()),
            "sessions_with_problem": dict(sessions_with),
            "unverified_reasons": dict(reasons.most_common()),
            "lost_what": dict(lost_what.most_common()),
            "flags": dict(flags.most_common()),
            "top_corrections": corrections.most_common(5),
            "exertion": dict(Counter(r["exertion"] for _, r in rows if r["exertion"])),
            "difficulty": dict(Counter(r["difficulty"] for _, r in rows if r["difficulty"])),
            "barriers": dict(Counter(b for _, r in rows for b in r["barriers"]).most_common()),
            "comments": [{"tester": w, "text": r["detail"]} for w, r in rows if r["detail"]],
            "per_tester": per_tester,
        }
        exercises.append(entry)
        issues.extend(_issues(entry))

    issues.sort(key=lambda i: (-i["share"], -i["count"]))
    return {
        "live_sessions": len(live), "replay_sessions": replays,
        "testers": dict(testers.most_common()), "exercises": exercises, "issues": issues,
    }


def _issues(e: dict[str, Any]) -> list[dict[str, Any]]:
    """Problem spots for one exercise, each with how many of its sessions it touched."""
    n = e["sessions"]
    out = []

    def add(what: str, count: int, sessions_hit: int) -> None:
        if count:
            out.append({"exercise": e["exercise"], "what": what, "count": count, "sessions_hit": sessions_hit, "of": n, "share": round(sessions_hit / n, 2)})

    for kind, count in e["problems"].items():
        what = PROBLEM_EVENTS[kind]
        if kind == "perception_lost" and e["lost_what"]:
            what += " — missing: " + ", ".join(f"{k} ×{v}" for k, v in e["lost_what"].items())
        add(what, count, e["sessions_with_problem"].get(kind, 0))
    if e["unverified"] and e["reps"]:
        add(f"{e['unverified']} of {e['reps']} reps unverified ({', '.join(e['unverified_reasons']) or 'no reason given'})", e["unverified"], sum(1 for t in e["per_tester"] if t["unverified"]))
    if e["ended_early"]:
        add("session ended early", e["ended_early"], e["ended_early"])
    for rule, count in e["flags"].items():
        add(f"stop rule fired: {rule}", count, count)
    hard = e["difficulty"].get("hard", 0) + e["difficulty"].get("couldnt_finish", 0)
    if hard:
        add("tester said it was hard or could not finish", hard, hard)
    return out


def _pct(a: int, b: int) -> str:
    return f"{a}/{b} ({round(100 * a / b)} %)" if b else "–"


def render_md(r: dict[str, Any]) -> str:
    lines = ["# Praxis team test — where to improve", ""]
    if not r["live_sessions"]:
        lines += ["No live sessions yet. Each teammate opens the review link, enters a name, and runs the default day.", ""]
        if r["replay_sessions"]:
            lines.append(f"({r['replay_sessions']} replay sessions are stored; replays are recorded clips and are not analysed.)")
        return "\n".join(lines) + "\n"
    who = ", ".join(f"{k} ({v})" for k, v in r["testers"].items())
    lines += [f"{r['live_sessions']} live sessions · testers: {who} · {r['replay_sessions']} replays not counted.",
              "Counts come from the OpenCV events and the screen-08 answers; small numbers, a guide to what to fix, not a score.", ""]
    lines += ["## Problem spots (most widespread first)", ""]
    if r["issues"]:
        lines += ["| exercise | what | times | sessions hit |", "|---|---|---:|---:|"]
        lines += [f"| {i['exercise']} | {i['what']} | {i['count']} | {i['sessions_hit']}/{i['of']} |" for i in r["issues"]]
    else:
        lines.append("None seen.")
    for e in r["exercises"]:
        lines += ["", f"## {e['exercise']}", "",
                  f"- {e['sessions']} sessions by {e['testers']} testers · reps verified {_pct(e['verified'], e['reps'])}, unverified {e['unverified']}, missed {e['missed']}",
                  f"- tracking lost {e['tracking_lost']}× in {e['sessions_with_tracking_lost']}/{e['sessions']} sessions · median pause {e['median_paused_s'] or 0:.0f} s · ended early {e['ended_early']}"]
        if e["median_cue_p50_s"] is not None:
            lines.append(f"- event-to-cue latency (median of session p50s): {e['median_cue_p50_s']:.2f} s")
        if e["nhpt_times_s"]:
            lines.append("- NHPT times: " + ", ".join(f"{t:.1f} s" for t in e["nhpt_times_s"]))
        if e["top_corrections"]:
            lines.append("- coach corrections: " + "; ".join(f"{t.removeprefix('correct: ')} ×{c}" for t, c in e["top_corrections"]))
        if e["difficulty"]:
            lines.append("- difficulty answers: " + ", ".join(f"{k} {v}" for k, v in e["difficulty"].items()))
        if e["barriers"]:
            lines.append("- barriers ticked: " + ", ".join(f"{k} {v}" for k, v in e["barriers"].items()))
        for c in e["comments"]:
            lines.append(f"- {c['tester']}: “{c['text']}”")
        lines += ["", "| tester | sessions | reps | verified | unverified | missed | tracking lost | ended early |", "|---|---:|---:|---:|---:|---:|---:|---:|"]
        lines += [f"| {t['tester']} | {t['sessions']} | {t['reps']} | {t['verified']} | {t['unverified']} | {t['missed']} | {t['tracking_lost']} | {t['ended_early']} |" for t in e["per_tester"]]
    return "\n".join(lines) + "\n"
