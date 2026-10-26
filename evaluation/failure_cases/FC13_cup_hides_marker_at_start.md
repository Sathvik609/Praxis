# FC13 — The cup on dot 1 hides a corner marker at the start

**Source:** synthetic 3-D renders (**not real-camera evidence**) · **Status:** mitigated (instructions and caption changed 24 Oct; renders not re-made with the new order)

## What happened
Every good cup clip loses its first one or two reaches (dot 1 at ~2.7 s, dot 2 at ~5.5 s), and
`cup3d_05` (camera tilt 20°) never calibrated at all: 0 of 32 reaches, marker counts 0 / 0 / 0.

## Evidence
`evaluation/results/synthetic3d_v0.md`: per-clip rows (markers 4 / 3 / held) and "Misses with
reasons" for `cup3d_01`, `02`, `03`, `05`, `06`; `evaluation/dataset_3d_v0/cup3d_05.truth.json`
(marker visibility from ray casts).

## Why
The instructions put the cup on dot 1 before the session starts. At laptop angles the cup (and
at ~20° the resting hand too) stands between the camera and the corner marker behind it. The
first calibration needs all four markers (a locked decision), so nothing is counted until the
cup moves; at 20° a corner stays hidden for the whole run.

## What we changed
Four markers for the first fix is a product rule, so the rule stays. `82cf274` (24 Oct,
after the same thing happened in the team's real cup sessions) changed the order instead: the cup
steps say "Keep the cup beside the sheet until the camera finds all four corners, then put it on
dot 1" (`perception/exercises.py`), and while the sheet is not found the live caption adds "Keep
the cup and your hand off the sheet for a moment" (`web/src/session/liveStatus.ts`). The same
commit lets one or two markers hold the fix, however long they are covered, once the first fix
exists, so a cup that hides a corner later no longer loses tracking.

## Status
Mitigated. The renders still start with the cup on dot 1, so the 25 Oct results show the old
order: `cup3d_01`, `02`, `03` and `06` lose their first one or two reaches and `cup3d_05` is
still 0 of 32. Not yet re-tested live.
