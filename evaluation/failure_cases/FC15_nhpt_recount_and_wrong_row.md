# FC15 — NHPT: a hole counted again after the hand hid it; a peg put in another row

**Source:** synthetic 3-D renders (**not real-camera evidence**) · **Status:** partly fixed

## What happened
Before the 12 Oct fixes the forearm passing over seated pegs flipped them to empty, and they were
counted again when it moved on. After them 14 extra NHPT reports remained on 90 pegs (12 Oct). On
the 25 Oct build 6 remain, in 4 of 10 clips, all at 40–50° of camera tilt (`nhpt3d_01`, `02`,
`04`, `07`; 3 of them in `nhpt3d_07`). Read against the labels: 2 report a hole that was already
seated a second time, and 4 report a hole before its own peg arrived, each within 0.5 s of a peg
being seated in another hole.

## Evidence
`evaluation/results/synthetic3d_v0.md` (NHPT FP 6; "Misses with reasons": extra reports per clip)
and `synthetic3d_v0_before_fix.md`. The 2 / 4 breakdown is our reading of that miss list against
the labelled seat times in the same file.

## Why
A hand over a hole makes it look empty; a hole whose state flips back and forth produces a new
seat. At steep angles a standing peg's top projects onto the next row's hole (FC10).

## What we changed
12 Oct (`services/session/tests/test_nhpt.py`, `test_parallax.py`): a hole keeps its state while
something covers it. 25 Oct (`58a0503`): the test ends when nine **different** holes are filled,
so a hole counted twice no longer ends the test early (before, one clip counted one hole three
times and ended before all nine holes were filled).

## Status
Partly fixed: 6 extra reports remain, and they no longer end the test early (10 of 10 clips
finish). Not changed further before real recordings.
