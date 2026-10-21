# FC13 — The cup on dot 1 hides a corner marker at the start

**Source:** synthetic 3-D renders (**not real-camera evidence**) · **Status:** open (locked rule)

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

## Why we did not change it
Four markers for the first fix is locked in `CLAUDE.md` §1. Options recorded in `docs/RISKS.md`
(2026-10-12): ask for the cup on dot 1 only after the session says it sees the sheet, or carry
the setup screen's fix into the session.

## Status
Open.
