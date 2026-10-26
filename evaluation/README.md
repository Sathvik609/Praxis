# Evaluation

This folder holds the datasets, the scripts that regenerate every number, the result tables and the failure cases.
**Recording real sessions? Follow `PROTOCOL.md` step by step.**

## Results at a glance

| What | Data | Result | File |
|---|---|---|---|
| Arm out to the side, angle and reps | REHAB24-6, real lab video vs motion capture (front view: 8 of its 9 healthy adults, 88 reps) | angle MAE 3.8°, rep F1 0.96 | `results/rehab24_v0.md` |
| The same, cropped to laptop framing | REHAB24-6, 35 reps, hips at or below the frame edge | rep F1 0.91–0.93, angle MAE 5.0–7.5° | `results/rehab24_laptop_framing_v0.md` |
| Agent coach on real video | REHAB24-6 through the product, 40 sessions | our agent named a fault that motion capture confirmed, and gave a correction, in 41 of 44 set reviews (patient taps simulated); 0 guardrail violations | `results/agent_video_v0.md` |
| Agent coach, scripted scenarios | 15 of 16 scenarios, Claude Sonnet 5.5 (21 Oct) | 15/15; the harder `mixed_signals` fails 0/3 | `results/agent_recheck_2026-10-21_all.md` |
| NHPT and Waiter – cup | synthetic 3-D Blender renders | NHPT F1 0.97, total-time MAE 1.2 s; cup F1 0.79, reach-time MAE 0.7 s | `results/synthetic3d_v0.md` |
| Camera robustness | 2-D renders: 81 NHPT and 91 cup sheet conditions | first fix 74/81 and 83/91; all holes right 61/74, cup found within 10 mm 71/77; setup advice right 80/81 and 90/91 | `results/robustness_v0.md` |
| Live sessions, speed only | our Railway test build (not AWS), 24 Oct, one teammate, 5 sessions (4 cup, 1 NHPT) | capture → event p50 132–177 ms; server processing p95 10–75 ms; not accuracy | `results/live_sessions_2026-10-24.md` |

The NHPT and the cup have no labelled real-camera number yet. Our own live sessions stored events only, no video.

## Datasets

- `external/rehab24_6/` (git-ignored): REHAB24-6 [Černek et al. 2024, CC BY-NC 4.0], fetched by
  `services/session/tools/fetch_rehab24.py`. We use its arm-abduction exercise: real RGB video of 9 healthy
  adults with motion capture and a physiotherapist's rep labels. Evaluation only, never redistributed; only derived numbers are committed.

- `dataset_v0/`: synthetic only (`"synthetic": true`). It has an OpenCV-rendered NHPT clip, a rendered
  Waiter – cup clip, and a front-view landmark stream for Arm out to the side (we use landmarks here
  because the pose DNN cannot see a drawn figure). `scripts/make_dataset_v0.py` regenerates them.
  They check the pipeline, not real-world accuracy.
- `dataset_v1/` (not recorded yet): real recordings (`"synthetic": false`), made with `PROTOCOL.md`. Layout:
  `raw/<participant>/<exercise>/<timestamp>.{mp4,json,labels.json,pred.json}` (the clip, a sidecar,
  the ground truth and the cached pipeline events), `consent/<participant>_<date>.json` and `manifest.json`.
  Clips (`.mp4`) are git-ignored and deleted after 30 days. Everything else is committed, so the
  numbers can still be regenerated after a clip is deleted. Pseudonyms only.
- `dataset_3d_v0/`: synthetic 3-D renders (`"synthetic": true`, **not real-camera evidence**).
  These are headless Blender (Eevee) clips of the NHPT and Waiter – cup, seen from a laptop-camera angle.
  `blender/make_dataset_3d.py` builds them from two files:
  - `blender/scenario.py`: the script and ground truth, pure Python;
  - `blender/render_tasks.py`: the scene. It has the printed sheet (from the product's own sheet code),
    32 mm pegs in a perforated board, a cup with a blue tape ring and a handle, a simple hand/forearm
    stand-in, four lighting presets, motion blur, noise and JPEG q70.

  Committed: `manifest.json`, `<id>.labels.json` (`praxis.labels/1`), `<id>.truth.json` (condition,
  splits, and marker visibility from ray casts) and `<id>.pred.json` (cached events, no pixels).
  The `.avi` clips and `work/` are git-ignored and regenerate the same way every time.
- `labels.schema.json`: the ground-truth schema (`praxis.labels/1`). Each rep has a start and end time,
  the hole (NHPT) or dot (cup), whether it should be verified or unverified and why, and any scripted
  error. For Arm out to the side it also has the goniometer-app angle (`peak_deg_goniometer`) and
  trunk lean / shoulder hike.
- `data/team_test_2026-10-21/`: the team shake-down on our Railway test build (13 Oct build, not AWS): 15 live
  sessions, 12–15 Oct, 8 by three of us and 7 automated; snapshot taken 21 Oct, GET requests only. It has the stored session summaries
  and events, 6 traces, the server's `/api/review` summary and `meta.json` (where the data came from).
  Testers are pseudonymised (T1–T3; `test-claude` = automated, an AI agent in a browser, synthetic clip). No frames
  exist. Not labelled.
- `data/live_sessions_2026-10-24/`: the latency blocks of 5 stored sessions from one teammate (T1) on
  the hosted build, 24 Oct (home laptop webcam, real pegs and a real cup). Speed only: no frames, no
  labels, and the sessions ran before the 24–25 Oct fixes.

## Tools (`services/session/tools/`, run from `services/session`)

| tool | does |
|---|---|
| `record_session.py record` | records one consented clip (refuses without a typed `yes`; refuses a folder git would commit) |
| `record_session.py purge-expired` / `withdraw pNN` | 30-day deletion / consent withdrawn (clips and failure frames) |
| `label_clip.py <clip> --labeller XX [--gonio …]` | keyboard labeller; `--validate-only` checks a labels file |
| `dataset_v1.py status` / `validate` / `manifest` | progress to 300 reps / 5 participants; check labels; write the manifest |

## Scripts (`evaluation/scripts/`)

- `rehab24_eval.py`: runs the REHAB24-6 arm-abduction videos through the product's `SessionPipeline` and
  scores angle and reps against motion capture → `results/rehab24_v0.{md,json}` (~15 min on 4 cores).
  `rehab24_laptop_framing.py` does the same on frames cropped like a laptop camera;
  `rehab24_thresholds.py` derives the shoulder-hike allowance and the front-view gate.
- `agent_video_eval.py`: the agent coach end to end on REHAB24-6 → `results/agent_video_v0.md`.
- `robustness.py`: the rendered camera-robustness sweep → `results/robustness_v0.md`.
- `live_sessions_report.py`: latency of the 24 Oct live sessions → `results/live_sessions_2026-10-24.md` (speed only).

- `eval.py [--dataset DIR]`: replays every manifest entry through the same pipeline the app uses,
  **at product defaults** (`--debounce 2 --clear 3`, the values the app ships with). Change them only to
  study sensitivity, never for the headline table. Arm out to the side runs from the **video**
  through the pose model (for synthetic data, from the landmark stream). **Real and synthetic results
  go in separate tables and are never pooled.** For each exercise it reports:
  - rep F1 (hole/dot match within [-tol, tol + 1 s] of the labelled end time) and verified agreement;
  - NHPT total-time MAE and cup reach-time MAE;
  - arm peak-angle MAE and bias vs the goniometer;
  - lean/hike detection and false-alarm rates.

  It writes `results/dataset_<version>.{json,md}`. Real clips also get `<clip>.pred.json` (events,
  no pixels). `--use-cache` re-scores from that file, and an expired or deleted clip is scored from
  it without reading the video. It also writes failure cases (see below).
- `eval_3d.py [--use-cache] [--tag before_fix]`: scores `dataset_3d_v0` with the same matching as
  `eval.py`, plus what the 3-D renders add: verified/unverified with reasons, NHPT seat-time and
  per-peg split error, timer start, hand-model and calibration coverage, one row per rendered
  condition, and every miss. Writes `results/synthetic3d_v0.{json,md}` with the banner "Synthetic 3-D
  renders, not real-camera evidence".
- `latency.py [--replay] [--video CLIP --mode arm] [--store praxis.db]`: measures capture→event, proc,
  event→cue and round-trip p50/p95 through the real WebSocket handler, driven like the browser.
  `--store` lists live sessions measured in the browser. Writes `results/latency_v0.{json,md}`.
- `sus.py`: scores `sus/responses.csv` (standard SUS, Brooke 1996; `sus/questionnaire.md`,
  `sus/responses_template.csv`) into `results/sus_v0.{json,md}`: n, mean, SD, min, max.
- `usability.py`: scores the moderated usability test (`usability/PLAN.md`: nine tasks, an observer
  sheet and a therapist interview guide; no video recorded) from `usability/tasks.csv` (+ optional
  `issues.csv`, `therapist.csv`) into `results/usability_v0.{json,md}`. It reports unaided and completion
  rates with Wilson 95 % intervals, median time, errors, SEQ per task, issues by severity, and the
  therapist table (our own six items, labelled as not a validated scale).
- `team_test_report.py [--check]`: turns `data/team_test_2026-10-21/` into
  `results/team_test_2026-10-21.{md,json}`. Per exercise it shows verified / unverified / missed, setup
  pauses, sessions ended early, hike flags (and the captions the 21 Oct rationing would show), therapist
  flags, and agent runs / refused vs failed tool calls / latency / cost. Human testers and automated
  sessions are always kept apart. It also lists what the 21 Oct fixes changed. `--check` fails if the
  committed output differs.
- `agent_eval.py` + `agent/scenarios/*.json`: the agent coach's 16 scenarios (covered marker,
  dim light, three unverified, falling peaks + exertion, repeated lean, pain stop mid-run, model
  timeout, MCP down, clean session, and seven more listed in `docs/AGENT.md`). They run through the real session, OpenCV setup checks on synthetic
  frames, the tools and the guardrails. `--planner scripted` (CI, free) writes `results/agent_v0.{md,json}`
  and sample traces to `traces/agent/`. `--planner anthropic --yes` runs Claude and writes
  `results/agent_v0_anthropic_sonnet-5-5.{md,json}` for the default model (`--model` picks another;
  `agent_v0_anthropic.{md,json}` is kept for Claude Sonnet 5) and prints an estimated cost first. The scripted numbers
  check plumbing and guardrails, not model judgement. `agent/make_scenarios.py` regenerates
  the JSON.

## Failure cases

`failure_cases/FC*.md`: 19 documented misses so far (team test, agent re-checks, REHAB24-6 real
video, 3-D and 2-D renders). Each one has the evidence, root cause, change and status. They are text
only, with no pixels, and are indexed in `failure_cases/README.md`.

`failure_cases/<clip_id>/`: JPEG frames around every miss on a real clip, plus `reason.json`.
`eval.py` writes these only for clips whose participant agreed (`consent_clips: true`). The folder is
git-ignored except its README, and is deleted with the clip; see `failure_cases/README.md`.

```bash
cd services/session
uv run python ../../evaluation/scripts/make_dataset_v0.py
uv run python ../../evaluation/scripts/eval.py                                        # synthetic
uv run python tools/dataset_v1.py manifest
uv run python ../../evaluation/scripts/eval.py --dataset ../../evaluation/dataset_v1  # real
uv run python ../../evaluation/scripts/latency.py --replay
uv run python ../../evaluation/scripts/sus.py
uv run python ../../evaluation/scripts/usability.py
uv run python ../../evaluation/scripts/team_test_report.py
```

Synthetic numbers only check the pipeline. They are not evidence about real-world accuracy.
