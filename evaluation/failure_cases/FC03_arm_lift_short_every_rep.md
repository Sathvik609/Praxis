# FC03 — Every rep short of the target or the hold in one session

**Source:** team test on the hosted 13 Oct build (person, T1) · **Status:** open (no ground truth)

## What happened
Session `7f69575a3bc7` (15 Oct): pain 4 at check-in gave a gentle day (side lift to 60°, shorter
hold). The arm state machine counted 12 reps and verified none: 7 `target_missed` (peaks
30.8–48.6°) and 5 `hold_too_short` (peaks 55.4–75.4°). The `missed_reps` stop rule (3 missed in a
row) fired 3 times and called a rest each time (133 s paused against 92 s active), and the Claude agent
raised a therapist flag: "0 of 6 reps reached target even at the lowest allowed 60°; peaks fell
from 75° to about 33°". The agent's proposal of a 1 s hold was refused by the clamp (FC06).
Across the 4 human sessions with reps, 14 of 37 were missed; 12 of them in this session.

## Evidence
- `evaluation/data/team_test_2026-10-21/sessions/7f69575a3bc7.json`: `summary.camera.peak_deg`, the `rep_complete` / `target_missed` events, `summary.flags`.
- `evaluation/data/team_test_2026-10-21/traces/7f69575a3bc7.json`: the `pain_tier` row (gentle, 60°) and the agent run that wrote the flag.
- `evaluation/results/team_test_2026-10-21.md`, per-session row `7f69575a3bc7`.

## Why
Unknown. Either the tester really lifted short and held briefly (healthy teammate, a quick test,
peaks falling through the set), or the camera-relative angle read low for this set-up: on
REHAB24-6 a 30–45° turn reads about 11° low (FC17), and nothing here records how the tester sat.
There are no labels and no frames, so the two cannot be separated.

## What we changed
Nothing. The product did what it is designed to do with what it saw: counted honestly, stopped
nagging through the stop rule, told the therapist, and did not lower the target beyond the
prescription.

## Status
Open. Needs labelled recordings with a goniometer reference (dataset v1, `evaluation/PROTOCOL.md`).
