# evaluation

Labeled datasets, scripts that regenerate every number, result tables and failure cases.
**Recording real sessions? Follow `PROTOCOL.md` step by step.**

## Datasets

- `dataset_v0/` — synthetic only (`"synthetic": true`): an OpenCV-rendered NHPT clip, a rendered
  Waiter – cup clip and a front-view landmark stream for Arm out to the side (the pose DNN cannot
  see a drawn figure). `scripts/make_dataset_v0.py` regenerates them. They validate the pipeline,
  not real-world accuracy.
- `dataset_v1/` — real recordings (`"synthetic": false`), made with `PROTOCOL.md`:
  `raw/<participant>/<exercise>/<timestamp>.{mp4,json,labels.json,pred.json}` (clip, sidecar,
  ground truth, cached pipeline events), `consent/<participant>_<date>.json` and `manifest.json`.
  Clips (`.mp4`) are git-ignored and deleted after 30 days; everything else is committed and
  keeps the numbers regenerable after deletion. Pseudonyms only.
- `labels.schema.json` — the ground-truth schema (`praxis.labels/1`): reps with start/end time,
  hole (NHPT) or dot (cup), expected verified/unverified + reason, scripted error, and for Arm
  out to the side the goniometer-app angle (`peak_deg_goniometer`) and trunk lean / shoulder hike.

## Tools (`services/session/tools/`, run from `services/session`)

| tool | does |
|---|---|
| `record_session.py record` | records one consented clip (refuses without a typed `yes`; refuses a folder git would commit) |
| `record_session.py purge-expired` / `withdraw pNN` | 30-day deletion / consent withdrawn (clips and failure frames) |
| `label_clip.py <clip> --labeller XX [--gonio …]` | keyboard labeller; `--validate-only` checks a labels file |
| `dataset_v1.py status` / `validate` / `manifest` | progress to 300 reps / 5 participants; check labels; write the manifest |

## Scripts (`evaluation/scripts/`)

- `eval.py [--dataset DIR]` — replays every manifest entry through the identical pipeline **at
  product defaults** (`--debounce 2 --clear 3`, the values the app ships; change them only to
  study sensitivity, never for the headline table). Arm out to the side runs from the **video**
  through the pose model (synthetic: the landmark stream). Per exercise, with **real and
  synthetic results in separate tables, never pooled**: rep F1 (hole/dot match within
  [-tol, tol + 1 s] of the labelled end time), verified agreement, NHPT total-time MAE, cup
  reach-time MAE, arm peak-angle MAE and bias vs the goniometer, lean/hike detection and
  false-alarm rates. Writes `results/dataset_<version>.{json,md}`; real clips also get
  `<clip>.pred.json` (events, no pixels; `--use-cache` re-scores from it, and an expired or
  deleted clip is scored from it without being read) and failure cases (below).
- `latency.py [--replay] [--video CLIP --mode arm] [--store praxis.db]` — capture→event, proc,
  event→cue and round trip p50/p95 through the real WebSocket handler, driven like the browser;
  `--store` lists browser-measured live sessions. Writes `results/latency_v0.{json,md}`.
- `sus.py` — scores `sus/responses.csv` (standard SUS, Brooke 1996; `sus/questionnaire.md`,
  `sus/responses_template.csv`) into `results/sus_v0.{json,md}`: n, mean, SD, min, max.
- `usability.py` — scores the moderated usability test (`usability/PLAN.md`: nine tasks, observer
  sheet, therapist interview guide; no video recorded) from `usability/tasks.csv` (+ optional
  `issues.csv`, `therapist.csv`) into `results/usability_v0.{json,md}`: unaided and completion
  rates with Wilson 95 % intervals, median time, errors, SEQ per task, issues by severity, and the
  therapist table (our own six items, labelled as not a validated scale).
- `agent_eval.py` + `agent/scenarios/*.json` — the agent coach's nine scenarios (covered marker,
  dim light, three unverified, falling peaks + exertion, repeated lean, pain stop mid-run, model
  timeout, MCP down, clean session) through the real session, OpenCV setup checks on synthetic
  frames, tools and guardrails. `--planner scripted` (CI, free) writes `results/agent_v0.{md,json}`
  and sample traces to `traces/agent/`; `--planner anthropic --yes` runs Claude and writes
  `results/agent_v0_anthropic.{md,json}` (prints an estimated cost first). Scripted numbers
  validate plumbing and guardrails, not model judgement. `agent/make_scenarios.py` regenerates
  the JSON.

## Failure cases

`failure_cases/<clip_id>/` — JPEG frames around every miss on a real clip plus `reason.json`,
written by `eval.py` only for clips whose participant agreed (`consent_clips: true`). Git-ignored
except its README and deleted with the clip; see `failure_cases/README.md`.

```bash
cd services/session
uv run python ../../evaluation/scripts/make_dataset_v0.py
uv run python ../../evaluation/scripts/eval.py                                        # synthetic
uv run python tools/dataset_v1.py manifest
uv run python ../../evaluation/scripts/eval.py --dataset ../../evaluation/dataset_v1  # real
uv run python ../../evaluation/scripts/latency.py --replay
uv run python ../../evaluation/scripts/sus.py
uv run python ../../evaluation/scripts/usability.py
```

Synthetic numbers validate the pipeline only; they are not evidence about real-world accuracy.
