# FC14 — Dim light: 6 mm yellow pegs and a grey cup

**Source:** synthetic 3-D renders (**not real-camera evidence**) · **Status:** pegs fixed on the renders (24 Oct); grey cup open

## What happened
On the 12 Oct build:
- `nhpt3d_04` (dim light, yellow 6 mm pegs): 0 of 9 seats found, 3 false reports, no NHPT time.
- `cup3d_04` (dim light, grey cup): 9 of 32 reaches, reach-time MAE 5225 ms, 0 of 4 arcs.

On the 25 Oct build: `nhpt3d_04` finds 9 of 9 seats with 1 extra report and finishes the timer
(23.5 s vs 24.0 s labelled); `cup3d_04` finds 10 of 32 reaches, reach-time MAE 3984 ms, 0 of 4
arcs.

## Evidence
`evaluation/results/synthetic3d_v0.md`, per-clip rows `nhpt3d_04` and `cup3d_04`;
`docs/TECHNICAL_REPORT.md` §8.1 and `docs/RISKS.md` (2026-10-12) give the reading below.

## Why (12 Oct reading)
The default HSV windows: in dim light a 6 mm yellow peg is only 20–30 % peg-coloured in its seat
column, so no seat is confirmed; a grey cup's sensor noise reads as blue band. The product has
tap-to-sample for both, but the evaluation never replays a tap.

## What we changed
Nothing aimed at these clips. The 11 Oct paper-referenced normalisation (FC19's sweep) fixed the
flat dim-room case but not small yellow pegs. `4bbfa37` (24 Oct, for the team's uncoloured real
pegs) adds change from the empty board to the peg mask, which also finds the dim yellow pegs (report
§8.1.1). The cup is now found as change from the empty sheet too (FC11), but the dim grey cup is
still mostly missed; why has not been re-analysed on the new detector.

## Status
Pegs: fixed on the renders. Grey cup in dim light: open. Proposed: prompt a colour sample when the
cup is lost while calibrated; keep "add light" in setup.
