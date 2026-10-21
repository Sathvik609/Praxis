# FC14 — Dim light: 6 mm yellow pegs and a grey cup

**Source:** synthetic 3-D renders (**not real-camera evidence**) · **Status:** open

## What happened
- `nhpt3d_04` (dim light, yellow 6 mm pegs): 0 of 9 seats found, 3 false reports, no NHPT time.
- `cup3d_04` (dim light, grey cup): 9 of 32 reaches, reach-time MAE 5225 ms, 0 of 4 arcs.

## Evidence
`evaluation/results/synthetic3d_v0.md`, per-clip rows `nhpt3d_04` and `cup3d_04`;
`docs/TECHNICAL_REPORT.md` §8.1 and `docs/RISKS.md` (2026-10-12) give the reading below.

## Why
The default HSV windows: in dim light a 6 mm yellow peg is only 20–30 % peg-coloured in its seat
column, so no seat is confirmed; a grey cup's sensor noise reads as blue band. The product has
tap-to-sample for both, but the evaluation never replays a tap.

## What we changed
Nothing for these clips. The 11 Oct paper-referenced normalisation (FC19's sweep) already fixed
the flat dim-room case; the 3-D clips show it is not enough for small yellow pegs.

## Status
Open. Proposed: prompt a colour sample when a hole's column stays partly peg-coloured for > 1 s
or the cup is lost while calibrated; keep "add light" in setup.
