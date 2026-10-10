# failure_cases/

Every miss on a **real** clip, with a few frames around it and the reason, so the team can see
why the camera got it wrong. Written by `evaluation/scripts/eval.py`; nothing here is made by hand.

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
- Everything in this folder except this README is **git-ignored**: frames never leave the laptop
  the clip was recorded on and are never committed, uploaded or put in the report as-is.
- Frames are deleted **with the clip**: `tools/record_session.py purge-expired` (30 days) and
  `tools/record_session.py withdraw <participant>` remove `failure_cases/<clip_id>/`.
- Re-running `eval.py` replaces a clip's folder, it never accumulates frames.
- The misses themselves (kinds, times, labels, predictions; no pixels) are also listed in
  `evaluation/results/dataset_v1.json`, which is committed and outlives the frames.
- A figure for the technical report or video is made only by re-drawing or describing a miss, or
  from a clip whose participant separately agreed to that use in writing.
