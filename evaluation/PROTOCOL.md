# Recording protocol — dataset_v1 (real sessions)

How to record, label and score real sessions of the three Praxis exercises so every number in
the technical report can be regenerated. Written for a teammate who has not touched the code:
follow it top to bottom. Every command is run from `services/session` in a terminal.

| exercise | id in the tools | camera | one rep is |
|---|---|---|---|
| Arm out to the side | `abduction` | laptop on a table in front of the person | one lift: arm up to shoulder height, hold 3 s, back down |
| Waiter – cup | `cup` | laptop screen tilted forward over the cup sheet | one move of the cup from one dot to the next |
| Nine-Hole Peg Test | `nhpt` | laptop screen tilted forward over the peg board | one peg seated in a hole |

**Only the laptop's built-in camera is used** (product decision, 10 Oct 2026): no phone, no USB
webcam, no mirror, no stand. Record with the same laptop camera the app uses.

Goal: **at least 300 labelled reps from at least 5 participants**, across all three exercises
(§4 has the arithmetic). Participants are healthy adult volunteers (team, friends, family), not
patients; the report says so.

---

## 0. Checklist for a recording day

- [ ] Laptop with the repo, `uv sync` done, models fetched (§1)
- [ ] iCloud / OneDrive / Dropbox **not** syncing the repo folder (§1.3)
- [ ] Both sheets printed at 100 % and checked with a ruler (§1.4)
- [ ] A plastic cup with a blue tape ring round its base; nine coloured pegs, a dish and the peg board (§1.5)
- [ ] A tape measure, to place the sheet 25–35 cm in front of the laptop (§3)
- [ ] A phone with a goniometer / inclinometer app, and a second teammate to read it (§6)
- [ ] Printed consent sheets and the paper pseudonym key (§2)
- [ ] The take sheet for each participant (§5) and a pen

## 1. One-time setup

### 1.1 Install and fetch the models
```bash
cd services/session
uv sync
uv run python tools/fetch_models.py      # hand + pose ONNX models (eval refuses to run without them)
uv run pytest -q tests/test_dataset_tools.py   # 1 minute: the recorder and labeller work on this laptop
```

### 1.2 Check the camera opens
```bash
uv run python tools/record_session.py record --help
```
The laptop's built-in camera is `--camera 0` (the only camera we use; unplug any other camera so
the number does not change). macOS asks for camera permission for the Terminal the first time:
allow it, then run the command again.

### 1.3 Make sure clips cannot leave the laptop
Clips are written to `evaluation/dataset_v1/raw/` and git ignores every video and image type
there; the recorder asks git before every recording and refuses a folder that is not ignored.
**A repo in a synced folder (Desktop, Documents)**: if *System Settings › Apple ID › iCloud › iCloud Drive ›
Desktop & Documents Folders* is on (or OneDrive/Dropbox syncs the Desktop), clips would be
uploaded. Turn that sync off for the recording laptop, or record with
`--raw-dir ~/praxis_clips` (outside the repo and outside any synced folder) and copy only the
`.json` files into `evaluation/dataset_v1/raw/` afterwards (§8.5).

### 1.4 Print the sheets at 100 %
Open `docs/sheets/nhpt_board.pdf` (portrait) and `docs/sheets/cup_targets.pdf` (landscape); each page is 210 × 279.4 mm, so it prints on A4 or US Letter without clipping a marker (11 Oct 2026; the earlier full-A4 pages lost two markers on Letter in some viewers). In the print dialog choose **Actual size / 100 % / no scaling** — never "Fit to page".
Check with a ruler:

- the scale bar under the title is **80 mm** long;
- every black square marker is **40 mm** wide;
- NHPT sheet: marker centres 130 mm apart left–right; the hole rings are **32 mm** apart;
- cup sheet: marker centres 217 mm apart left–right.

If a number is off by more than 1 mm, reprint. Tape each sheet flat to the table; a curled
corner breaks the camera's measurement.

Number the targets in pencil, small, next to each ring or dot, so the labeller can read them in
the video. Hold the sheet upright with the small "Praxis … print at 100%" line at the bottom:

- NHPT holes: **1 2 3** top row left to right, **4 5 6** middle row, **7 8 9** bottom row;
- cup dots: **1** to **5** from left to right (the cup starts on dot 1).

These are the numbers the camera uses (`hole` 0–8 and `to_dot` 0–4 in the files are these minus 1).

### 1.5 Objects
- **Cup:** a light plastic cup with a ring of **blue** electrical tape or a blue sticker round
  the bottom edge. The scorer replays clips with the default blue cup colour; the app's
  tap-to-sample colour is not replayed, so use blue.
- **Pegs:** nine pegs in one **saturated colour** (red, blue, green — not natural wood or white),
  for the same reason. Pegs start in a small dish on the practising side, off the sheet.
- **Board:** the peg board sits on the printed NHPT sheet with its holes over the nine printed
  rings.

## 2. Consent

Participants must be 18 or over, have no current shoulder, arm or hand injury and no pain at
rest. Before anything is recorded, give the participant the paper consent sheet, read it aloud,
and let them ask questions. The recorder then reads its own short script and asks them to type
`yes`; nothing is recorded without it.

**Consent sheet (print one per participant; the signed paper stays with the team lead):**

> **Praxis evaluation recording — consent**
>
> Praxis is a student project (OpenCV AI Competition 2026). It is a coaching aid for home arm
> exercises, **not a medical device**. We are testing whether its camera counts and times the
> exercises correctly.
>
> - You will do three short exercises (arm lifts, moving a cup between dots, a peg test) while a
>   webcam films you, for about 45 minutes in total. You may rest or stop at any time, for any
>   reason, without giving one. Stop immediately if anything hurts.
> - The video stays on one laptop. It is never uploaded, emailed, shared or put in our code, and
>   it is **deleted within 30 days**, or straight away if you ask.
> - We keep only measurements from it (counts, times, angles) under a code such as p03, never
>   your name. The key from code to name is on paper with the team lead and is destroyed after
>   the competition.
> - Two optional extras, each a separate yes or no (default no):
>   (a) a clip may be shown in the app's Replay demo on this laptop during the 30 days;
>   (b) a few still frames from moments where the camera got it wrong may be kept on this laptop
>   as failure examples, deleted together with the video.
> - You can withdraw at any time by telling any team member; your video and, if you wish, all
>   measurements from it are deleted that day.
>
> Name ______________ Code p__ Signature ______________ Date __________
> Optional (a) Replay demo: yes / no   (b) failure frames: yes / no

The recorder asks the two optional questions again for each clip and stores the answers in the
clip's sidecar (`consent.replay_demo`, `consent.consent_clips`) and in
`evaluation/dataset_v1/consent/<code>_<date>.json` together with the deletion date. Use the
next free code (`p01`, `p02`, …); never type a name anywhere.

## 3. Camera placement and lighting

### Arm out to the side (`abduction`) — front view
- Participant sits on a chair **without arm rests**, facing the camera, the practising arm free
  to lift out to the side.
- The laptop stands on a table so its camera is at about the seated participant's **chest
  height**, **2–2.5 m** away, straight on. The frame must
  show the head to below the hips and both shoulders with a hand-width of space above the lifted
  arm. Hips must be visible: the trunk-lean check needs them.
- Plain wall behind, nobody else in the frame.

### Waiter – cup (`cup`) and NHPT (`nhpt`) — laptop tilted over the sheet
- The laptop sits on the table; the printed sheet lies **flat 25–35 cm in front of the laptop**,
  between the laptop and the participant (measure from the laptop's front edge to the middle of
  the sheet).
- **Tilt the screen forward** until the whole sheet shows in the picture. The camera then looks
  down at about 40–50° from straight down. The participant's face does not need to be in view.
- The app's setup check "Camera looks down at the sheet" passes up to **50° from straight down**
  (`MAX_TILT_DEG`, `perception/quality.py`). Flatter than that, seated pegs hide the next hole
  and hands project off the sheet; the hint then reads "Tilt the laptop screen forward and move
  the sheet closer, so the camera looks down at it."
- Write the tilt the setup check shows in `--camera-note` (e.g. `laptop, sheet 30 cm, tilt 44°`).
- All **four** corner markers in view with a finger-width margin; the participant's hand and the
  dish must not leave the frame.
- Optional but recommended: open the app (`uv run uvicorn praxis_session.main:app --port 8000`,
  then the web app), pick the exercise and pass screen 05 *Camera setup* (all rows green), then
  close the browser tab before recording.

### Lighting (all exercises)
- Room light on, the main light or window **behind or beside the camera**, never behind the
  participant. No hard shadow across the sheet.
- For the dim-light take (§5) switch the main light off and leave one lamp on at the side.

## 4. How many reps (the arithmetic)

Per participant, the full plan in §5:

| take | exercise | reps |
|---|---|---|
| A1 clean | Arm out to the side, 2 sets × 8 lifts | 16 |
| A2 errors | Arm out to the side, 8 scripted lifts | 8 |
| C1 clean | Waiter – cup, 2 slow + 2 fast arcs × 8 moves per arc (1→5→1) | 32 |
| C2 errors | Waiter – cup, 1 arc with scripted errors | 8 |
| C3 dim light | Waiter – cup, 1 arc with the main light off | 8 |
| N1 clean | NHPT, 9 pegs | 9 |
| N2 errors | NHPT, 9 pegs with a dropped peg and covered markers | 9 |
| N3 too flat | NHPT, 9 pegs with the screen tilted back past 50° | 9 |
| **total** | | **99** |

- **5 participants × 99 = 495 labelled reps** (abduction 5 × 24 = 120, cup 5 × 48 = 240,
  NHPT 5 × 27 = 135, i.e. 15 NHPT trials for the total-time error, 5 of them deliberately too
  flat).
- **Minimum** if time runs short: A1 + A2 + C1 + N1 = 16 + 8 + 32 + 9 = 65 per person,
  × 5 = **325 ≥ 300**. Never drop the error takes entirely: they are the failure cases.
- Clips get discarded (camera bumped, participant interrupted), so aim for the full plan.
- About 45 minutes per participant including setup, rests and the SUS (§9.3).

`uv run python tools/dataset_v1.py status` shows the running count against 300 / 5.

## 5. The takes, including the deliberate errors

One take = one clip = one run of the recorder. Start each take with the participant in the
start position, wait for the 3-2-1 countdown, stop with **Space** when the take is done.
Pass the planned errors with `--errors` so they are on the record, e.g.:

```bash
uv run python tools/record_session.py record --participant p03 --exercise abduction --side right --by XX --errors lean,hike,past_ceiling,short_hold,low_lift
```

The recorder asks anything you did not pass as a flag, then the consent questions, then opens
the preview. Prompts per take:

| take | what the participant does | what the label should say (§7) |
|---|---|---|
| **A1** | 2 sets of 8 normal lifts to shoulder height, 3 s hold, short rest between sets. Teammate reads the goniometer at the top of every lift (§6). | every lift `verified`, no compensation |
| **A2** | 8 lifts in this order: 2 with a **trunk lean** (lean the upper body away from the lifting arm, well past 15°), 2 with a **shoulder shrug** (hike the shoulder toward the ear), 2 **past 90°** (lift to about 120°), 1 **short hold** (lower after 1 s), 1 **low lift** (only to about 45°). Goniometer on every lift. | lean: `verified`, lean ticked, error `lean` · shrug: `verified`, hike ticked, error `hike` · past 90°: `verified`, error `past_ceiling` · short hold: `unverified`, reason `hold_too_short`, error `short_hold` · low lift: `unverified`, reason `target_missed`, error `low_lift` |
| **C1** | Cup on dot 1, hand in lap. 2 slow arcs (1→5→1), then 2 as quick as feels safe. | every move `verified`, dot = the dot the cup lands on |
| **C2** | One arc. On moves 2 and 3 keep the whole hand **cupped over the cup** for 2 s after setting it down. On move 5 a teammate holds a sheet of paper over **two** corner markers for about 5 s while the move happens. On move 7 cover **one** marker for 5 s. | moves 2, 3: `unverified`, reason `occluded`, error `occluded_cup` · move 5: `unverified`, reason `marker_lost`, error `covered_marker` · move 7: `verified` (one covered marker is tolerated by design), error `covered_marker` · others `verified` |
| **C3** | One normal arc with the main light off (`--lighting "dim: main light off, side lamp"`, `--errors dim_light`). | label what a person can see: a clearly visible move is `verified`; error `dim_light` on every move |
| **N1** | Pegs in the dish. Pick up the first peg (the timer starts on that lift), put all nine in any holes, one at a time, as quickly as comfortable. | every peg `verified`, hole = the hole it went into |
| **N2** | As N1, but drop the 4th peg on the table on purpose and pick it up again; during the 7th peg a teammate covers **two** markers with paper for about 5 s. | dropped peg: press `p` at the drop; that peg's rep is `verified` when it is seated, error `dropped_peg` · 7th peg: `unverified`, reason `marker_lost`, error `covered_marker` (today the NHPT marks the whole test "limited" on marker loss rather than the single peg, so expect this rep to show as a disagreement: that is a finding, not a labelling error) |
| **N3** | As N1, but first tilt the screen **back** (or slide the sheet further away) until the setup check shows the camera **more than 50° from straight down**, e.g. 55–65°, with all four markers still in view. Note the tilt in `--camera-note` and pass `--errors too_flat`. This is the deliberate test of the 50° cap: it is set from geometry (peg height vs hole pitch), not measured on real pegs. Report N3 next to, not inside, the N1/N2 numbers. | label what a person can see: a peg seated in a hole you can see is `verified`; error `other` (the labeller has no `too_flat` code; the sidecar's `planned_errors` says `too_flat`) |

Rules: the participant uses the same (practising) arm for the whole session; rest whenever they
ask; if anything hurts, stop and do not continue that exercise. Re-record a take rather than
"fixing" it in labelling if the camera was bumped or someone walked into the frame (delete the
spoiled clip with its `.json` sidecar).

## 6. Goniometer readings (Arm out to the side)

The camera's angle is compared with a phone goniometer, so a second teammate measures every
lift in A1 and A2:

1. Use a phone goniometer / inclinometer app in "angle from vertical" mode. Write the app name
   and version in the recorder's `--lighting` note or the sidecar's `notes`.
2. At the top of each lift, during the 3 s hold, lay the phone's long edge along the outside of
   the upper arm (shoulder to elbow) and read the angle from vertical (arm down = 0°, arm level
   with the shoulder = 90°). Say it out loud; the recorder writes it on the take sheet.
3. Write `-` for a lift you could not measure. Do not guess.
4. When labelling, pass the readings in lift order: `--gonio 88,91,86,-,90,...` (§7).

The camera's angle is camera-relative progress, not goniometry; this comparison measures how
far apart they are, nothing more.

## 7. Labelling a clip

Label each clip soon after recording, ideally by a teammate who did not record it and **without
looking at the app's counts first**.

```bash
uv run python tools/label_clip.py ../../evaluation/dataset_v1/raw/p03/abduction/20261012T101500.mp4 --labeller XX --gonio 88,91,86,-,90,92,89,90
```

A window opens on the clip; the keys are printed on the frame and in `--help`. For each rep:

1. Step to the start (`space` to pause, `,` `.` one frame, `[` `]` one second) and press **`s`**:
   arm starts to lift · cup leaves its dot · peg leaves the dish.
2. Step to the end and press **`e`**: arm back down by the side · cup set down on the next dot ·
   peg seated in its hole. The rep now exists and is "current".
3. Describe it:
   - NHPT: press the hole number **`1`–`9`** (the pencil numbers from §1.4); Waiter – cup: the
     dot number **`1`–`5`** the cup landed on.
   - Arm out to the side: **`l`** trunk lean, **`h`** shoulder hike, **`g`** type a goniometer
     reading if you did not pass `--gonio`.
   - If the product *should not* count it as a clean rep: **`u`** (unverified) and **`r`** to pick
     the reason (`occluded`, `marker_lost`, `hold_too_short`, `target_missed`, `other`), or
     **`o`** for occluded directly.
   - **`d`** cycles the deliberate error the take sheet says was scripted.
   - NHPT: **`p`** at the moment a peg drops.
4. Mistake? **`x`** deletes the current rep.
5. When every rep is labelled, press **`c`** (complete), then **`q`** (write and quit). Unfinished
   files can be saved with `w` and reopened later; only complete files are scored.

The file `<clip>.labels.json` appears next to the clip. Check it:
```bash
uv run python tools/label_clip.py <clip>.mp4 --validate-only
uv run python tools/dataset_v1.py validate          # every labels file
```
Warnings (a hole used twice, a cup move that "lands" on the dot it left, no goniometer
readings) are hints, not errors; fix them if they are mistakes.

"Verified" means the rep was a correct, fully visible rep that the product should count as
clean. Label what happened, not what you expect the app to say.

## 8. Score everything

### 8.1 Progress and manifest
```bash
uv run python tools/dataset_v1.py status      # reps per exercise vs 300 / 5 participants
uv run python tools/dataset_v1.py manifest    # writes evaluation/dataset_v1/manifest.json
```
The manifest lists every clip with a complete, valid labels file; the others are printed with
the reason they were skipped.

### 8.2 Accuracy
```bash
uv run python ../../evaluation/scripts/eval.py --dataset ../../evaluation/dataset_v1
```
Replays every clip through the same pipeline the app runs (Arm out to the side through the pose
model, from the video), at the app's own settings. Takes about as long as the clips. Writes
`evaluation/results/dataset_v1.{md,json}`: per exercise rep F1, verified agreement, NHPT
total-time error, cup reach-time error, arm peak-angle error against the goniometer, and
trunk-lean / shoulder-hike detection. Real and synthetic results are always in separate tables.
It also writes `<clip>.pred.json` next to each clip (the product's events, no pictures) so the
numbers can be regenerated after the clips are deleted (`--use-cache` re-scores from them without
replaying), and the failure cases (§8.3).

### 8.3 Failure cases
For every miss on a clip whose participant said yes to failure frames, `eval.py` writes a few
JPEG frames around the miss and a `reason.json` to `evaluation/failure_cases/<clip_id>/`. That
folder is git-ignored and deleted with the clip; see `evaluation/failure_cases/README.md`. Look
through them after each recording day: they show what to fix first.

### 8.4 Latency
```bash
uv run python ../../evaluation/scripts/latency.py --replay                         # synthetic clips, in process
uv run python ../../evaluation/scripts/latency.py --video ../../evaluation/dataset_v1/raw/p01/abduction/<ts>.mp4 --mode arm
uv run python ../../evaluation/scripts/latency.py --store praxis.db                # browser-measured live sessions
```
Writes `evaluation/results/latency_v0.{md,json}`. For browser-measured numbers, run a few live
sessions in the app with a real webcam first (they land in `services/session/praxis.db`).

### 8.5 If you recorded outside the repo
Copy the `.json` files (sidecar, labels, pred; never the `.mp4`) from `~/praxis_clips/<code>/...`
into `evaluation/dataset_v1/raw/<code>/...`, or pass `--raw-dir ~/praxis_clips` to
`dataset_v1.py` and `--dataset` to `eval.py` accordingly.

## 9. Usability (SUS)

1. After the participant's recording takes, let them use the app for one default day (check-in
   → Arm out to the side → Waiter – cup → feedback) without help unless they are stuck.
2. Give `evaluation/sus/questionnaire.md` on paper (or read it aloud), one answer 1–5 per item.
3. Copy `evaluation/sus/responses_template.csv` to `evaluation/sus/responses.csv` (once) and add
   one row per participant (code, date, q1–q10, short note).
4. Score: `uv run python ../../evaluation/scripts/sus.py` → `evaluation/results/sus_v0.{md,json}`
   (n, mean, SD, min, max, per-item means). Target mean ≥ 75.

## 10. Where things land

| what | where | committed? |
|---|---|---|
| clips `*.mp4` | `evaluation/dataset_v1/raw/<code>/<exercise>/` | **never** (git-ignored), deleted after 30 days |
| sidecars, labels, cached events `*.json` | next to the clips | yes |
| consent records | `evaluation/dataset_v1/consent/` | yes (codes and dates only) |
| manifest | `evaluation/dataset_v1/manifest.json` | yes |
| accuracy results | `evaluation/results/dataset_v1.{md,json}` | yes |
| latency results | `evaluation/results/latency_v0.{md,json}` | yes |
| SUS answers and results | `evaluation/sus/responses.csv`, `evaluation/results/sus_v0.{md,json}` | yes |
| failure frames | `evaluation/failure_cases/<clip_id>/` | **never**, deleted with the clip |
| signed consent sheets, code→name key | paper, team lead | never digitised |

Commit the `.json` and results files after each recording day (`git status` must show no
`.mp4` or `.jpg`; if it ever does, stop and tell the team).

## 11. Deletion (30 days) and withdrawal

- Every clip's deletion date is in its sidecar and consent record (recording date + 30 days).
- **Every day** during and after the recording period:
  ```bash
  uv run python tools/record_session.py purge-expired --dry-run   # what would go
  uv run python tools/record_session.py purge-expired
  ```
  It deletes expired clips and their failure frames and stamps `clip_deleted_on` in the sidecar;
  labels and cached events stay, so `eval.py` still scores them from the cache.
- A participant withdraws: `uv run python tools/record_session.py withdraw p03` deletes their
  clips and failure frames now; add `--remove-derived` if they also want their labels and
  measurements gone (then re-run the manifest and `eval.py`).
- The recording laptop is the only copy. No backups of clips, no copying to phones or drives.

## 12. Troubleshooting

| symptom | fix |
|---|---|
| `cannot open camera 0` | allow camera access for Terminal (System Settings › Privacy › Camera), or try `--camera 1` |
| `WARNING: measured … fps < 13.5` | the room is too dark or the camera is busy (close the browser tab using it); re-record |
| `REFUSED: … NOT git-ignored` | you passed a `--raw-dir` inside the repo; use the default or a folder outside the repo |
| `no consent` | the participant did not type exactly `yes`; nothing was recorded |
| label window does not open | run it on the macOS laptop (the pinned OpenCV wheel opens windows there) |
| `eval.py`: `the pose model is missing` | `uv run python tools/fetch_models.py` |
| a clip shows as skipped | `tools/dataset_v1.py manifest` prints why (not labelled, not complete, invalid) |
