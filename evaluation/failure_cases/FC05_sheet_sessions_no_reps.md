# FC05 — The human NHPT and Waiter – cup sessions recorded nothing

**Source:** team test on the hosted 13 Oct build (people) · **Status:** open (cause not recorded)

## What happened
The only human sessions of the two sheet exercises produced no reps at all:
- `156b6707b4f2`, Waiter – cup (T3, 13 Oct): 17.6 s active, pain 6 before and after, difficulty "hard", ended early, reason "tired".
- `439eb3848e9c`, Nine-Hole Peg Test (T1, 14 Oct): 16.6 s active, ended early, reason "finished"; the agent's note says "No peg test time or splits were recorded by the camera".

Each stored session holds only the check-in and the feedback events: no calibration, peg, cup,
`perception_lost` or `setup_blocked` event in between. The automated cup session on a synthetic
clip counted 31 of 31 reaches on the same build, so the pipeline itself ran.

## Evidence
- `evaluation/data/team_test_2026-10-21/sessions/156b6707b4f2.json` and `439eb3848e9c.json` (`events`, `summary.camera`, `feedback`).
- `evaluation/data/team_test_2026-10-21/traces/439eb3848e9c.json` (agent runs at check-in and feedback; `get_set_summary` returns 0 reps).
- `evaluation/results/team_test_2026-10-21.md`, "Per exercise".

## Why
Not known. About 17 s is too short to place a cup on all dots or seat nine pegs, so the testers may
simply have ended a first look. But the stored events cannot say whether the sheet was ever
calibrated or the cup / pegs ever seen, and the cup tester reported pain 6 and "hard".

## What we changed
Nothing yet. FC13 and FC14 (renders) are known ways for these exercises to see nothing at the
start, but there is no evidence either happened here.

## Status
Open. In the next team test, ask sheet-exercise testers to run the full task, and read the
setup screen's calibration state before the session starts.
