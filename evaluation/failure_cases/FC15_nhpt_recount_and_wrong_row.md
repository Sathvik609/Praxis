# FC15 — NHPT: a hole counted again after the hand hid it; a peg put in another row

**Source:** synthetic 3-D renders (**not real-camera evidence**) · **Status:** partly fixed

## What happened
Before the 12 Oct fixes the forearm passing over seated pegs flipped them to empty, and they were
counted again when it moved on. After the fixes 14 extra NHPT reports remain on 90 pegs: 10
re-count a seated hole after the hand hid it, and 4 put a peg in another row's hole at 42–50° of
camera tilt.

## Evidence
`evaluation/results/synthetic3d_v0.md` (NHPT FP 14; "Misses with reasons": extra reports per clip)
and `synthetic3d_v0_before_fix.md`; the 10 / 4 breakdown is read from that miss list in
`docs/TECHNICAL_REPORT.md` §8.1 and `docs/RISKS.md` (2026-10-12).

## Why
A hand over a hole makes it look empty; a hole whose state flips back and forth produces a new
seat. At steep angles a standing peg's top projects onto the next row's hole (FC10).

## What we changed
12 Oct (`services/session/tests/test_nhpt.py`, `test_parallax.py`): a hole keeps its state while
something covers it.

## Status
Partly fixed. The remaining re-counts happen when the hand hides a hole for only part of the
time; not changed further before real recordings.
