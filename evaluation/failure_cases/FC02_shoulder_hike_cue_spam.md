# FC02 — Shoulder-hike correction on nearly every rep

**Source:** team test on the hosted 13 Oct build (people) · **Status:** mitigated (cue rationed; since 25 Oct the flag needs both hips)

## What happened
`shoulder_hiking` fired 31 times in 5 of 12 Arm out to the side sessions, at arm angles of
35.9–81.6°. 30 of the 31 came from one human tester (T1) across 4 sessions (up to 11 in one
session of 12 reps); the automated sessions produced 1. On the 13 Oct build every flag was a coach
correction ("Let the shoulder drop…"), so a tester could see the same line on almost every lift.

## Evidence
- `evaluation/results/team_test_2026-10-21.md`: "shoulder-hike flags (sessions hit)" and the per-session column "hike flags → 21 Oct captions".
- Stored events with `angle_deg`, e.g. `evaluation/data/team_test_2026-10-21/sessions/c797f70a2c35.json` (11 flags) and `304b1d084da5.json` (10).

## Why
The flag uses the angle-aware allowance fitted on REHAB24-6 (standing adults, lab cameras), where
it flags 0 of 47 correct reps (FC18). Seated at a laptop it fired far more often. Whether T1
really hiked is unknown: nobody labelled the reps, no frames exist, and the 13 Oct events did not
store the hike magnitude or the limit, so the margin by which the flag fired cannot be read back.
That one tester produced 30 of 31 flags points at that person's posture or set-up as much as at
the threshold.

## What we changed
`3ff1eaf` (21 Oct): the rule coach says the hike correction at most `HIKE_CUES_PER_SET` = 2 times
per set, `HIKE_CUE_GAP_S` = 20 s apart. On the same stored events that is 14 captions instead of
31 (computed by `team_test_report.py` with the shipped constants; 13 for the humans, 1 automated).
Detection, events, counts in the report and stop rules are unchanged, and stored events now keep
`hike` and `limit`.

`e12f0fc` (25 Oct): the flag now needs both hips in view as well as both shoulders, because the
hike is measured in trunk lengths (shoulder to hip); with the hips guessed below a laptop's frame
the number was noise. On REHAB24-6 cropped to laptop framing it fired once in 35 reps with the
hips out of frame, and not at all with the full body or the hips at the bottom edge (`evaluation/results/rehab24_laptop_framing_v0.md`).
A seated patient whose hips are out of frame now gets no hike flag at all.

## Why the threshold was not raised
No hike magnitudes and no labels from this test, and the REHAB24-6 held-out numbers support the
current allowance. Raising it blind would trade nagging for missed compensation.

## Status
Mitigated. Decide the threshold from the next test's stored `hike` / `limit` values or dataset v1's
scripted hikes.
