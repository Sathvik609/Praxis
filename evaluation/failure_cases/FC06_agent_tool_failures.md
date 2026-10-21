# FC06 — Four "failed" agent tool calls: three guardrails, one bug

**Source:** team test on the hosted 13 Oct build (Claude agent) · **Status:** fixed

## What happened
The 13 Oct review listed 4 failed agent tool calls in 42 runs: `propose_adjustment`, `recalibrate`,
`speak` and `write_session_summary`, one each.

## Evidence
- `evaluation/data/team_test_2026-10-21/review_server.json` → `agent.tool_failures`.
- `evaluation/data/team_test_2026-10-21/traces/7f69575a3bc7.json`, seq 206: `propose_adjustment` hold 1 s → `"no change: hold_s is already 2 (after clamping 1 to the prescription)", "kind": "no_change"`.
- `evaluation/data/team_test_2026-10-21/traces/c797f70a2c35.json`, seq 24 and 25: `recalibrate` and `speak` → `"stale: the session moved on since this checkpoint"`.
- `evaluation/results/team_test_2026-10-21.md`, "AI coach": re-classified with the 21 Oct rule, 3 refused by a guardrail, 0 real failures in the 6 traces kept.
- Commit `12145c3` message for the fourth (session `098b067da2b5`, automated; its trace is not in the snapshot).

## Why
Three were the guardrails working: the clamp refused a hold below the prescription's floor, and
the stale-checkpoint check refused actions from a run that the session had already moved past.
The review counted any `ok: false` as a failure. The fourth was a real bug: a session ended
before any check-in or OpenCV event, so the end-of-session run had no evidence id to cite, and
the report note was refused (every coach action must trace to an event).

## What we changed
`12145c3` (21 Oct): tool trace rows carry `error_kind` and `refused`, and the review counts
guardrail refusals apart from failures; the feedback answers are now a typed event on the ring,
so the end-of-session note always has evidence to cite.

## Status
Fixed and tested offline; not yet seen on a live session.
