# failure_cases/

Two things live here, both so the team (and judges) can see where Praxis got it wrong and why:

1. **Documented cases `FC*.md` (committed, no pixels).** One file per real miss found so far: what
   happened, the evidence (a committed results file, data file, trace row or commit), the root
   cause, what we changed or why we did not, and the status. Every number in them is copied from
   a file that a script regenerates; the case files only explain. No frame of a person is here or
   anywhere in the repo: the team-test service never stores frames, REHAB24-6 frames may not be
   redistributed (CC BY-NC 4.0, `docs/RISKS.md`), and the 3-D renders are synthetic.
2. **Per-clip frame folders `<clip_id>/` (local only).** Every miss on a consented **real**
   recording, with a few frames around it, written by `evaluation/scripts/eval.py`; nothing in
   them is made by hand. None exist yet (no dataset v1 recordings; `docs/RISKS.md`).

## Documented cases

Status: **fixed** = code changed and re-measured on the same data; **fixed, untested on people** =
code changed, re-measured only offline or not re-measurable; **mitigated** = the symptom is
reduced, the cause remains; **open** = not changed (reason given); **explained** = not a product
defect.

| case | source | what went wrong | status |
|---|---|---|---|
| [FC01](FC01_arm_setup_pause_hips.md) | team test (people) | Arm setup pause on a brief "hips not in view": 14 events in 9/12 sessions | fixed (25 Oct), measured on laptop-cropped REHAB24-6; not yet re-tested live |
| [FC02](FC02_shoulder_hike_cue_spam.md) | team test (people) | Shoulder-hike cue on nearly every rep: 31 flags in 5 sessions | mitigated (cue rationed; flag needs both hips since 25 Oct) |
| [FC03](FC03_arm_lift_short_every_rep.md) | team test (people) | One session: 12 of 12 reps short of target or hold | open (no ground truth) |
| [FC04](FC04_sessions_ended_early.md) | team test (people + automated) | 9 of 12 Arm sessions ended early | explained (tester pressed End); linked to FC01 |
| [FC05](FC05_sheet_sessions_no_reps.md) | team test (people) | Human NHPT and Waiter – cup sessions recorded no reps | open (cause not recorded); real pegs and cups fixed 24 Oct |
| [FC06](FC06_agent_tool_failures.md) | team test (agent) | 4 "failed" agent tool calls: 3 were guardrail refusals, 1 a real bug | fixed |
| [FC07](FC07_socket_drops.md) | team test (people) | Sockets dropped before the session was saved; nothing stored | mitigated; cause open (instrumented) |
| [FC08](FC08_agent_covered_marker_pause.md) | agent re-check (synthetic frames, real model) | Agent left the patient paused after a covered marker (1/3 pass) | fixed (3/3, 15/15) |
| [FC09](FC09_agent_real_video_unsupported_claims.md) | REHAB24-6 real video + agent | Agent claims mocap does not support, mostly about the hold | open |
| [FC10](FC10_nhpt_seated_peg_parallax.md) | 3-D renders | Seated peg read empty; phantom free pegs (parallax) | fixed (renders only) |
| [FC11](FC11_cup_ring_crescent.md) | 3-D renders | The cup was never found (blue ring seen as a crescent) | fixed (renders only) |
| [FC12](FC12_hand_model_coverage.md) | 3-D renders | Hand found on 3–9 % of frames, so nearly every peg is unverified | open (render limit) |
| [FC13](FC13_cup_hides_marker_at_start.md) | 3-D renders | Cup on dot 1 hides a corner marker; first reaches lost, one clip never calibrated | mitigated (instructions and caption, 24 Oct) |
| [FC14](FC14_dim_light_colour_windows.md) | 3-D renders | Dim light: 6 mm yellow pegs and a grey cup | pegs fixed (renders only); grey cup open |
| [FC15](FC15_nhpt_recount_and_wrong_row.md) | 3-D renders | Hole counted twice or before its peg arrived: 6 extra reports at 40–50° | partly fixed |
| [FC16](FC16_pose_collapse_overhead.md) | REHAB24-6 real video | Pose skeleton collapsed overhead; off-frame region crashed | fixed |
| [FC17](FC17_pose_half_profile_and_head.md) | REHAB24-6 real video | Half-profile reads ~12° low; no pose with the head out of frame | open |
| [FC18](FC18_hike_false_alarms_healthy.md) | REHAB24-6 real video | Hike flag on 47/47 correct reps | fixed on REHAB24-6; see FC02 |
| [FC19](FC19_sheet_blur_curl_black.md) | 2-D robustness renders | Blur/defocus kill the markers; 20 mm curl unflagged; black pegs | open (physics / by design) |

Synthetic sources are labelled as such in every case; they are not real-camera evidence.

The defects found in the team's later live sessions (23–24 Oct: uncoloured pegs, an ordinary cup,
double counts, a too-strict stop rule, the hips out of a laptop's frame) and their fixes are in
`docs/TECHNICAL_REPORT.md` §8.1.1 and §8.4; FC01, FC05, FC11, FC13 and FC14 note where they
overlap. Those defects are fixed and re-tested on renders, not yet re-tested live (the arm fix on
REHAB24-6 video cropped to laptop framing).

## Per-clip frame folders (real recordings, consented, local only)

```
failure_cases/<clip_id>/
  reason.json                              what was missed, when, the label and the prediction
  miss00_false_negative_0012.40s.jpg       frames at -1, -0.5, 0, +0.5, +1 s around each miss
  ...
```

Miss kinds: `false_negative` (a labelled rep the product never reported), `false_positive`
(a rep the product reported that was not labelled), `status_mismatch` (verified vs unverified
disagrees with the label), `lean_missed` / `lean_false_alarm` / `hike_missed` /
`hike_false_alarm` (Arm out to the side compensation), `nhpt_timer_error` (NHPT total time off by
more than the tolerance), `nhpt_no_time` (the product never finished the NHPT timer).

## Policy (privacy)

- Frames are cut **only** from clips whose participant answered the separate question "May a few
  still frames around moments the camera got it wrong be kept as failure examples?" with `yes`
  (`consent_clips: true` in the sidecar and the manifest), and only while that clip's 30-day
  consent holds. Synthetic renders never write here.
- Everything in this folder except this README and the `FC*.md` case files is **git-ignored**:
  frames never leave the laptop the clip was recorded on and are never committed, uploaded or put
  in the report as-is. A case file never embeds or links a frame of a person.
- Frames are deleted **with the clip**: `tools/record_session.py purge-expired` (30 days) and
  `tools/record_session.py withdraw <participant>` remove `failure_cases/<clip_id>/`.
- Re-running `eval.py` replaces a clip's folder, it never accumulates frames.
- The misses themselves (kinds, times, labels, predictions; no pixels) are also listed in
  `evaluation/results/dataset_v1.json`, which is committed and outlives the frames.
- A figure for the technical report or video is made only by re-drawing or describing a miss, or
  from a clip whose participant separately agreed to that use in writing.
