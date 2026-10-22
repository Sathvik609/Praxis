"""Draws docs/img/agent_qualifier_green_cup.svg from a committed agent trace (21 Oct 2026).

Every number in the figure is read from the trace here, never typed in, and the figure cites
the trace line it came from. Default trace: the real Claude Sonnet 5.5 run of the `green_cup`
scenario (`traces/agent/anthropic-sonnet-5-5/green_cup.jsonl`).

    python docs/img/make_agent_qualifier.py [trace.jsonl]

White background, dark text: readable in GitHub's light and dark themes.
"""
from __future__ import annotations

import json
import sys
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TRACE = ROOT / "traces" / "agent" / "anthropic-sonnet-5-5" / "green_cup.jsonl"
OUT = Path(__file__).resolve().parent / "agent_qualifier_green_cup.svg"

INK, MUTED, LINE = "#1B2233", "#4A5468", "#C9D1E0"
BLUE, AMBER, GREEN = "#3D62E3", "#A15C00", "#1F7A4D"


def load(path: Path) -> list[tuple[int, dict]]:
    return [(i, json.loads(t)) for i, t in enumerate(path.read_text().splitlines(), start=1) if t.strip()]


def find(rows: list[tuple[int, dict]], pred, after: int = 0) -> tuple[int, dict]:
    for n, r in rows:
        if n > after and pred(r):
            return n, r
    raise SystemExit("trace row not found: the trace does not show the qualifier chain")


def tool(name: str):
    return lambda r: r.get("kind") == "tool" and r.get("name") == name and "server" in r


def facts(rows: list[tuple[int, dict]]) -> dict:
    n_chk, chk = find(rows, tool("check_setup"))
    n_rs, rs = find(rows, tool("resample_target_colour"), n_chk)
    n_win, win = find(rows, lambda r: r.get("kind") == "resample", n_chk)
    n_say, say = find(rows, lambda r: tool("speak")(r) and r.get("run") == chk.get("run"), n_chk)
    n_rec, rec = find(rows, tool("recalibrate"), n_rs)
    n_req, req = find(rows, tool("request_resume"), n_rs)
    n_pr, pr = find(rows, lambda r: r.get("kind") == "action" and ((r.get("ui") or {}).get("prompt") or {}).get("kind") == "resume", n_req)
    n_ans, ans = find(rows, lambda r: r.get("kind") == "answer", n_pr)
    n_rep, rep = find(rows, lambda r: r.get("kind") == "event" and r.get("type") == "reach_complete" and r.get("verified") is True, n_ans)
    n_run, run = find(rows, lambda r: r.get("kind") == "agent_run" and r.get("phase") == "start" and r.get("run") == chk.get("run"))
    unver = [r for _, r in rows if r.get("kind") == "event" and r.get("type") == "reach_complete" and r.get("verified") is False]
    o, a = chk["opencv"], rs["opencv"]
    return {
        "model": run["model"], "trigger": run["trigger"], "policy": run.get("policy_version"), "n_run": n_run,
        "unverified": len(unver), "unverified_reason": unver[0]["reason"] if unver else None,
        "n_chk": n_chk, "failing": o["failing"], "target_seen": o["target_seen"], "colour_source": o["colour_source"],
        "frame_age": o["frame_age_s"], "markers": o["markers_found"], "rms": o["rms_mm"],
        "n_rs": n_rs, "rs_args": rs["args"], "before": a["before"]["detected"], "after": a["after"]["detected"],
        "diam": a["after"]["diameter_mm"], "cup_mm": a["after"]["cup_mm"], "dot": a.get("sampled_at_dot"),
        "n_win": n_win, "h": (win["colour"]["h_lo"], win["colour"]["h_hi"]), "s_min": win["colour"]["s_min"], "v_min": win["colour"]["v_min"],
        "n_say": n_say, "say": say["args"]["text"],
        "n_rec": n_rec, "rec_frames": rec["opencv"]["frames_seen"], "rec_markers": rec["opencv"]["markers_found"], "rec_rms": rec["opencv"]["rms_mm"],
        "n_req": n_req, "n_pr": n_pr, "prompt_title": pr["ui"]["prompt"]["title"],
        "n_ans": n_ans, "answer": ans["choice"],
        "n_rep": n_rep, "rep_id": rep["id"], "rep_dot": rep["to_dot"],
    }


def wrap(text: str, width: int) -> list[str]:
    out, cur = [], ""
    for w in text.split():
        if cur and len(cur) + 1 + len(w) > width:
            out.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    return out + ([cur] if cur else [])


def box(x: int, y: int, w: int, h: int, head: str, lines: list[tuple[str, str]], accent: str, cite: str) -> str:
    """lines: (text, style) with style 'b' bold, 'm' monospace, '' plain."""
    s = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="#FFFFFF" stroke="{LINE}" stroke-width="1.5"/>',
         f'<rect x="{x}" y="{y}" width="6" height="{h}" rx="3" fill="{accent}"/>',
         f'<text x="{x + 18}" y="{y + 26}" font-size="15" font-weight="700" fill="{accent}">{escape(head)}</text>']
    ty = y + 50
    for text, style in lines:
        for part in wrap(text, 31 if style == "m" else 36):
            fam = ' font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12.5"' if style == "m" else ' font-size="13.5"'
            wt = ' font-weight="700"' if style == "b" else ""
            s.append(f'<text x="{x + 18}" y="{ty}"{fam}{wt} fill="{INK}">{escape(part)}</text>')
            ty += 18
        ty += 4
    s.append(f'<text x="{x + 18}" y="{y + h - 12}" font-size="11.5" fill="{MUTED}">{escape(cite)}</text>')
    return "\n".join(s)


def arrow(x1: int, y: int, x2: int) -> str:
    return f'<line x1="{x1}" y1="{y}" x2="{x2 - 8}" y2="{y}" stroke="{MUTED}" stroke-width="2"/><path d="M{x2 - 9},{y - 6} L{x2},{y} L{x2 - 9},{y + 6} Z" fill="{MUTED}"/>'


def svg(f: dict, trace_rel: str) -> str:
    W, H = 1240, 640
    cols = [24, 330, 636, 942]
    bw, bh = 274, 214
    rows_y = [96, 376]
    lst = lambda xs: "[" + ", ".join(str(x) for x in xs) + "]"  # noqa: E731
    before = [
        box(cols[0], rows_y[0], bw, bh, "1 · Frame state", [
            ("Synthetic sheet frame, green cup on dot 0 (default cup window is blue).", ""),
            (f"{f['unverified']} reaches unverified ({f['unverified_reason']}) → stop rule pauses → agent run {f['trigger']}", ""),
            (f"frame_age_s {f['frame_age']}", "m"),
        ], MUTED, f"trace lines {f['n_run']}, {f['n_chk']}"),
        box(cols[1], rows_y[0], bw, bh, "2 · OpenCV: check_setup", [
            (f"failing {json.dumps(f['failing'])}", "m"),
            (f"target_seen {json.dumps(f['target_seen'])}", "m"),
            (f"colour_source \"{f['colour_source']}\"", "m"),
            (f"markers_found {lst(f['markers'])}", "m"),
            (f"rms_mm {f['rms']}", "m"),
            ("ArUco + homography pass; only the cup is unseen on the warped sheet.", ""),
        ], AMBER, f"trace line {f['n_chk']}"),
        box(cols[2], rows_y[0], bw, bh, "3 · Agent decision", [
            ("The setup is fine, so the cause is the cup's colour, not the camera: re-sample it instead of telling the patient to move anything.", ""),
            ("(Claude's next call, read from the trace; the reasoning text is ours.)", ""),
        ], BLUE, f"trace line {f['n_rs']}"),
        box(cols[3], rows_y[0], bw, bh, "4 · Next action", [
            ("resample_target_colour(", "m"),
            (f"  target=\"{f['rs_args']['target']}\",", "m"),
            (f"  evidence={lst(f['rs_args']['evidence'])})", "m"),
            ("Autonomous: retunes perception only, applied only if detection then succeeds.", ""),
        ], BLUE, f"trace line {f['n_rs']}"),
    ]
    after = [
        box(cols[0], rows_y[1], bw, bh, "1 · Frame state", [
            (f"Same scene; colour window re-sampled at dot {f['dot']}:", ""),
            (f"H {f['h'][0]}–{f['h'][1]}, S ≥ {f['s_min']}, V ≥ {f['v_min']}", "m"),
            ("recalibrate, on new frames:", ""),
            (f"frames_seen {f['rec_frames']}", "m"),
            (f"markers {lst(f['rec_markers'])}", "m"),
        ], MUTED, f"trace lines {f['n_win']}, {f['n_rec']}"),
        box(cols[1], rows_y[1], bw, bh, "2 · OpenCV: re-sample result", [
            (f"before.detected {json.dumps(f['before'])}", "m"),
            (f"after.detected {json.dumps(f['after'])}", "m"),
            (f"after.diameter_mm {f['diam']}", "m"),
            (f"after.cup_mm {lst(f['cup_mm'])}", "m"),
            ("warpPerspective, HSV sample, then inRange + findContours find the cup base.", ""),
        ], GREEN, f"trace line {f['n_rs']}"),
        box(cols[2], rows_y[1], bw, bh, "3 · Agent decision", [
            (f"speak: “{f['say']}”", ""),
            ("request_resume → a fresh check_setup runs inside the tool and passes", ""),
        ], BLUE, f"trace lines {f['n_say']}, {f['n_req']}"),
        box(cols[3], rows_y[1], bw, bh, "4 · Next action", [
            (f"Prompt “{f['prompt_title']}”", ""),
            (f"Patient taps “{f['answer']}”", ""),
            (f"Next reach (event {f['rep_id']}, to dot {f['rep_dot']}):", ""),
            ("verified: true", "b"),
        ], GREEN, f"trace lines {f['n_pr']}, {f['n_ans']}, {f['n_rep']}"),
    ]
    arrows = [arrow(cols[i] + bw, y + bh // 2, cols[i + 1]) for y in rows_y for i in range(3)]
    # the decision change: before's next action leads to after's OpenCV result
    link = (f'<path d="M{cols[3] + bw // 2},{rows_y[0] + bh} C{cols[3] + bw // 2},{rows_y[0] + bh + 40} {cols[1] + bw // 2},{rows_y[1] - 46} {cols[1] + bw // 2},{rows_y[1] - 8}" '
            f'fill="none" stroke="{BLUE}" stroke-width="2" stroke-dasharray="6 5"/>'
            f'<path d="M{cols[1] + bw // 2 - 6},{rows_y[1] - 14} L{cols[1] + bw // 2},{rows_y[1] - 2} L{cols[1] + bw // 2 + 6},{rows_y[1] - 14} Z" fill="{BLUE}"/>'
            f'<text x="{cols[3] + bw // 2 + 12}" y="{rows_y[0] + bh + 24}" font-size="12.5" font-weight="700" fill="{BLUE}">the tool result</text>'
            f'<text x="{cols[3] + bw // 2 + 12}" y="{rows_y[0] + bh + 40}" font-size="12.5" font-weight="700" fill="{BLUE}">decides the next call</text>')
    head = [
        f'<rect x="0" y="0" width="{W}" height="{H}" fill="#FFFFFF"/>',
        f'<text x="24" y="38" font-size="21" font-weight="800" fill="{INK}">OpenCV result → agent decision → next action (green cup, before and after)</text>',
        f'<text x="24" y="64" font-size="13.5" fill="{MUTED}">{escape(f["model"])} via the Anthropic API, policy {escape(str(f["policy"]))}; synthetic frames, real model. Values copied from {escape(trace_rel)} by docs/img/make_agent_qualifier.py.</text>',
        f'<text x="24" y="{rows_y[0] - 8}" font-size="14" font-weight="700" fill="{AMBER}">BEFORE · cup not seen with the default colour window</text>',
        f'<text x="24" y="{rows_y[1] - 8}" font-size="14" font-weight="700" fill="{GREEN}">AFTER · colour re-sampled by OpenCV, cup detected</text>',
        f'<text x="24" y="{H - 14}" font-size="12" fill="{MUTED}">Rule coach alone on the same scenario: the cup is never re-sampled and 0 reaches are verified after the pause (evaluation/results/agent_v0_rule.md).</text>',
    ]
    body = "\n".join(head + before + after + arrows + [link])
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
            f'font-family="Mulish, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" role="img" '
            f'aria-label="Green cup trace: check_setup reports the target unseen, the agent re-samples the cup colour, OpenCV then detects the cup, the resume prompt passes a fresh check and the next reach is verified.">\n'
            f'<title>Agent qualifier: green cup before and after</title>\n{body}\n</svg>\n')


def main(argv: list[str]) -> int:
    trace = Path(argv[0]).resolve() if argv else TRACE
    f = facts(load(trace))
    try:
        rel = str(trace.relative_to(ROOT))
    except ValueError:
        rel = trace.name
    OUT.write_text(svg(f, rel))
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
