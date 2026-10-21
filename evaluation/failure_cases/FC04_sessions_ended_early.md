# FC04 — Most Arm out to the side sessions ended early

**Source:** team test on the hosted 13 Oct build (people + automated) · **Status:** explained (tester pressed End); linked to FC01

## What happened
9 of 12 Arm out to the side sessions were ended early by the tester's own answer on screen 08
(8 by the stored status): human 3 of 6, automated 6 of 6. 7 of those 9 had a setup pause first.
Reasons given: human "finished" 3; automated "finished" 3, "paused" 2, "tired" 1. No session was
stopped by a stop rule (0 of 15 `stopped`).

## Evidence
- `evaluation/results/team_test_2026-10-21.md`: rows "ended early (stored status)", "ended early (tester's answer)", "ended early (answer) in a session that had a setup pause", "stopped by a stop rule".
- `feedback.ended_early` / `feedback.end_reason` and `summary.stopped` in `evaluation/data/team_test_2026-10-21/sessions/*.json`.

## Why
Not a crash: every one arrived with its feedback over a live socket. The automated sessions are
short scripted checks of the flow (3.0–5.4 s of active time in five of them), ended on purpose.
The human early endings follow the setup pause (FC01) or a very short try.

## What we changed
FC01's 6 s hips gate is meant to remove the most common trigger. `4f8c384` (13 Oct, during this
test) made End always end and store the session as `ended_early`.

## Status
Explained. Re-measure on the next test once FC01's gate is deployed.
