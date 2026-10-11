# Praxis: an agentic vision coach for upper-limb rehab at home

**Technical report · OpenCV AI Competition 2026 (powered by AWS) · Team Praxis · 11 Oct 2026**

Live (AWS Graviton4 + COOL, HTTPS): **https://dl8xykmg8ki61.cloudfront.net** · Judge quick-start: [`docs/JUDGE_QUICKSTART.md`](JUDGE_QUICKSTART.md) · Diagrams: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) · Full engineering detail, module by module: [`docs/ENGINEERING_NOTES.md`](ENGINEERING_NOTES.md)

> Praxis is an adherence and coaching aid for exercises a therapist has already prescribed. **It is not a medical device.** It does not diagnose and does not choose exercises, and its angles and times are not clinical measurements.

## Summary

After a stroke or a shoulder injury, most of the work of recovery happens at home, between clinic visits, with nobody watching. Patients get a printed sheet of exercises. They do not know whether a repetition counted, they compensate without noticing, and the therapist sees nothing until the next visit.

Praxis uses **one ordinary laptop camera, a printed A4 sheet and a cup or a few pegs** to coach three therapist-prescribed exercises: **Arm out to the side** (shoulder abduction), **Waiter – cup** (a GRASP coordination task) and the **Nine-Hole Peg Test** (a standardized weekly assessment).

- **OpenCV 5 does the measuring.** ArUco markers on the printed sheet give a metric homography. Pegs, holes and the cup are found with Hough circles, HSV segmentation, contours and masked template matching. Hand and body landmarks come from OpenCV Zoo ONNX models run through `cv2.dnn`. Each exercise has a state machine that turns this into timestamped events: a rep, a reach, a peg seated, a trunk lean, tracking lost.
- **Stop rules in code run before any coach** (pain ≥ 7, new symptoms, repeated trunk lean, repeated reps the camera could not check, sustained exertion, tracking lost). They pause or stop the session and flag the therapist.
- **Two coaches share one interface.** A deterministic rule coach gives every in-rep cue. A **Claude agent coach** runs at checkpoints and calls OpenCV itself through MCP tools: `check_setup` runs a fresh ArUco/homography/pose check on the latest frame, and `resample_target_colour` re-segments a cup it cannot see. The camera result decides the agent's next step: name the covered corner, re-sample the colour, offer to resume only after the camera check passes. Every dose change and every resume is a prompt the patient answers.
- **It runs on AWS.** An EC2 **c8g.large (Graviton4)** launched from the **COOL AMI** runs the same service on COOL's OpenCV 5.1.0-dev behind CloudFront HTTPS. We measured COOL against the stock OpenCV wheel on the same instance.

What is measured and what is not, in one place:

| Area | Status (11 Oct 2026) |
|---|---|
| OpenCV 5 pipeline, three exercises, every screen, stop rules, rule coach, trace, replay | built; 636 service tests + 945 web tests green; CI on every push |
| Claude agent coach (17 tools over MCP, autonomy table, guardrails) | built; **real Claude**, 12 scenarios × 3: 32/36 passed, **0 guardrail violations** (§8.3) |
| AWS: Graviton4 + COOL + CloudFront | **live**; 634/636 tests pass on COOL; benchmark measured (§7) |
| Accuracy on real people | **not measured yet.** Every perception number so far is on synthetic renders (§8.1). Recording protocol and scorer are built (§8.4). |
| Usability (SUS), patient or therapist pilots | not run yet (§8.5) |
| Bedrock, S3, CloudWatch shipping, CDK | not built (§7.4) |

---

## 1. Problem

**Stroke is common, disabling and growing.** Stroke is the second-leading cause of death worldwide and the third-leading cause of death and disability combined. Between 1990 and 2019, new strokes rose 70 % and the number of people living after stroke rose 102 % [1]. More than 70 % of people who have a stroke have upper-limb deficits [2]. In a cohort of 102 patients with arm paresis after an acute stroke, only 11.6 % had complete functional recovery of the arm at six months [3]. Shoulder problems add to this: in one ultrasound screening of a whole village, 22.1 % of residents had a full-thickness rotator-cuff tear, rising to 36.6 % in their 80s [4].

**Recovery needs repetitions that clinic time does not provide.** Across 312 observed therapy sessions, task-specific upper-limb practice happened in only 51 % of sessions and averaged **32 repetitions** when it did [5]. The rest is meant to happen at home. But non-adherence to self-managed home physical therapy can reach **70 %** [6]. Access is the other constraint: about **2.4 billion** people live with a condition that could benefit from rehabilitation [7, 8]. In some low- and middle-income countries more than half of them do not receive the services they need, and many settings have fewer than 10 skilled practitioners per million people [7].

**Home programs work when people do them.** GRASP (Graded Repetitive Arm Supplementary Program, UBC) is a self-administered arm program. In a randomized trial of 103 stroke inpatients, it improved arm function on the CAHAI by 6.2 points over an education control (95 % CI 3.4–9.0), and the gain held at five months [2]. The **Nine-Hole Peg Test** is a standard, quick measure of finger dexterity with adult norms [9, 10]. In stroke its smallest real difference for the more-affected hand is large: 32.8 s [11]. That is one reason a weekly, consistently administered test with per-peg splits is more useful than an occasional clinic reading.

**What goes wrong at home is specific.** (1) *No feedback on quality*: the patient cannot tell whether the lift reached the target, whether it was held, or whether the trunk leaned to fake the range. (2) *No dose control*: on a bad day patients either push through pain or skip the session, and both are invisible. (3) *No signal to the therapist*: the clinician learns about a missed week, a pain spike or a compensation pattern at the next visit, weeks later. (4) *Outcome measures need the clinic*: the Nine-Hole Peg Test is quick, but it is timed by a clinician with a stopwatch.

**Why a camera, and why now.** Every patient with a laptop already owns the sensor. OpenCV 5 can turn a printed sheet into a calibrated measuring surface with four ArUco markers, run hand and pose networks on a laptop CPU in milliseconds, and do all of it in memory without storing video. What has been missing is a system that is honest about what one webcam can measure, keeps the therapist in charge, and stops itself when it should.

## 2. Users and design principles

| | **Patient (primary)** | **Therapist (secondary)** |
|---|---|---|
| Who | Adult after stroke or a shoulder injury, practising at home between visits; often older, often one-handed, may have low vision or reduced dexterity; not technical | Occupational or physiotherapist with a caseload of home programs |
| Needs | Know what to do and whether it counted; a safe dose on bad days; an easy way to stop; no surveillance feeling | Adherence they can trust; pain and safety events early; an objective trend (NHPT time, reach time, range); control of the prescription |
| In Praxis | Check-in → demonstration → camera setup → live session with captions → 3-question feedback → report | Read-only dashboard: adherence from real sessions only, flags with reasons, NHPT trend, and the prescription editor (practice days, versioned) |

**Principles we held to** (from the hi-fi wireframes, `docs/wireframes/`):

1. **The therapist prescribes; the coach proposes inside the prescription; code enforces it.** Dose, allowed adaptations and stop rules are a versioned prescription. Every proposed change is clamped to it.
2. **Unverified is not failed.** A rep the camera could not see (the hand covers the cup, a marker drops out) is counted as *unverified*, shown next to the verified count everywhere, and never held against the patient.
3. **Feeling is self-reported.** Pain and effort come from what the patient taps or says. The face is never analysed for pain or emotion, and person detection is used for presence and pose only.
4. **No composite score.** No "accuracy" or "recovery" number appears anywhere. The app shows reps (verified / unverified), times and camera-relative angles, each labelled as such.
5. **The patient can always stop.** Pause · Take a rest · Pain / feel unwell · End session are fixed on every live screen. A resume is always the patient's tap.
6. **Say what is simulated.** The rule coach says it is rule-based, a replay says "Replay", sample data says "Sample", and every trace row names its source.

## 3. What exists and what is new

Camera and sensor rehab products exist. Their makers describe them as follows (vendor claims, not independently checked):

| Product | Approach | How Praxis differs |
|---|---|---|
| Kemtai | software-only motion tracking on a phone, tablet or laptop camera, general exercise and musculoskeletal programs | Praxis adds a **metric printed surface** (ArUco homography) for hand and object tasks, a standardized dexterity test, and therapist stop rules in code |
| Neofect Smart Glove | wearable sensor glove with games for stroke hand and arm rehab | Praxis needs **no wearable**: one laptop camera, a printed sheet, a cup and pegs |
| MIRA | exergame platform for upper-limb rehab (feasibility study with 10 outpatients) | Praxis coaches the prescribed exercise itself (GRASP task, abduction) and **verifies each rep** from vision events, rather than scoring a game |

In our search we found no webcam product that times the Nine-Hole Peg Test at home and coaches therapist-prescribed upper-limb exercises with an agent. That is a negative search result, not proof that none exists.

**What is new in Praxis:**
- **A printed sheet as a metric instrument.** Four ArUco markers turn an A4 page into a calibrated plane (px ↔ mm, reprojection error reported). That plane is what lets a laptop camera time a Nine-Hole Peg Test peg by peg and measure cup reaches dot to dot without any wearable.
- **An agent whose tools are OpenCV.** The agent does not only read events. It can re-run calibration on the current frame, re-sample the target's colour, and re-check the camera before offering to resume. The vision result decides the next tool call (§6.3).
- **Safety outside the model.** Stop rules, clamps and the autonomy table are code the model cannot talk its way past, and the tests prove it (0 guardrail violations over 36 real-model runs, including a prompt-injection scenario).
- **Honest perception.** Verified / unverified / missed are separate outcomes with reasons. Tracking loss pauses the session with the reason on screen, and resumes on its own when tracking returns.

## 4. System architecture

```mermaid
flowchart LR
    subgraph B["Browser (React + TS + Three.js)"]
      CAM["Laptop camera<br/>640×480 JPEG, ack-paced"]
      UI["Screens · captions · prompts<br/>Pause · Rest · Pain · End"]
    end
    subgraph S["Session service · one Python 3.12 process (FastAPI)"]
      P["OpenCV 5 pipeline<br/>ArUco → homography · Hough · HSV · contours<br/>matchTemplate · cv2.dnn hand + pose"]
      F["State machines<br/>peg · cup · arm"]
      R{"Stop rules<br/>(always first)"}
      RC["Rule coach<br/>in-rep cues"]
      AG["Claude agent coach<br/>checkpoints · MCP tools"]
      T["Trace JSONL · SQLite store"]
    end
    CAM -->|"WSS frames"| P --> F -->|"JSON events,<br/>never pixels"| R --> RC --> UI
    R -->|"pause / stop + therapist flag"| UI
    R --> AG
    AG -->|"check_setup · recalibrate ·<br/>resample_target_colour"| P
    AG -->|"speak · prompts (patient decides)"| UI
    RC --> T
    AG --> T
    subgraph A["AWS us-east-2"]
      CF["CloudFront HTTPS"] --> EC2["EC2 c8g.large Graviton4<br/>COOL AMI · OpenCV 5.1.0-dev"]
    end
    B -. "hosted mode" .-> CF
    EC2 -. "runs" .-> S
```

**One process, events not frames.** The browser sends 640 × 480 JPEGs over a WebSocket, each prefixed with its capture time. It sends the next frame only after the service has answered the previous one, so a slow host gets fewer, fresher frames instead of a growing queue. The service decodes each frame with `cv2.imdecode`, runs the pipeline in a thread pool (OpenCV releases the GIL), and returns JSON: events, overlay geometry in frame pixels, captions and prompts. Frames are dropped after processing. **No frame, pixel or image is written to disk, put in an event or a trace row, or sent to the model**, and a test checks every agent tool result for pixels.

**Two deployment modes, same code.** *Edge mode* runs the service on the patient's laptop (`uvicorn`), where no frame leaves the machine; this is the privacy story. *Hosted mode* runs the identical service on the c8g instance behind CloudFront (§7); frames travel over TLS and are processed in memory and dropped. The camera-setup screen names where processing happens. **Replay mode** pushes a recorded clip through the identical pipeline and coach with no webcam. It is the judges' fallback and is badged "Replay" everywhere.

**Stack.** Python 3.12, FastAPI, `opencv-python-headless==5.0.0.93` (pinned; COOL's build on AWS), NumPy, Strands Agents SDK + FastMCP 3.4 (MCP streamable HTTP, spec 2025-06-18), SQLite; React 19 + TypeScript + Vite, Radix, Tailwind 4, Three.js (a Blender-built GLB avatar, generated in code). Every dependency is pinned (`uv.lock`, `pnpm-lock.yaml`) and the ONNX models are SHA-256 pinned.

## 5. OpenCV 5 implementation

Every perception module names `cv2.__version__` in its docstring. Each stage below is substantive OpenCV work, and each is tested on synthetic frames rendered by our own projector (`perception/synth.py`: pinhole camera, tilt, yaw, noise).

| Stage | OpenCV 5 | Output |
|---|---|---|
| Sheet calibration | `cv2.aruco.ArucoDetector` (DICT_4X4_50, sub-pixel corners) → `cv2.findHomography` on 16 corners; `cv2.RANSAC` 3-marker fallback; `cv2.solvePnP` (IPPE) + `cv2.Rodrigues` for camera tilt | px ↔ mm homography, reprojection RMS (≈ 0.2 mm on renders), source `fresh / partial / held` |
| Setup quality | luma mean, `cv2.Laplacian` variance (blur), marker-corner jitter over 10 frames, task-area projection, px/mm | five checklist rows with a specific fix each (e.g. "show the bottom-right corner") |
| NHPT board | `cv2.warpPerspective` to a 3 px/mm top view; `cv2.HoughCircles` once (cached, snapped to spec); `cv2.inRange` (HSV, skin band excluded) + `cv2.findContours`; masked `cv2.matchTemplate` (`TM_CCOEFF_NORMED`) as tie-breaker | `hole_k: empty / occupied`, free pegs in mm |
| Cup on target sheet | warp to 2 px/mm; HSV `inRange` + `morphologyEx` open + largest contour (`cv2.moments`) | cup-base centroid in mm, over-dot test |
| Hand | OpenCV Zoo palm detector + hand-landmark ONNX via `cv2.dnn` (Apache-2.0) | 21 landmarks → mm via the homography; pinch aperture, path speed, SPARC smoothness, tremor (FFT, 3–12 Hz) |
| Pose | OpenCV Zoo person detector + BlazePose ONNX via `cv2.dnn` | shoulder angle (One-Euro filtered), trunk lean, shoulder hike, view and visibility gates |
| Tap-to-sample colour | 6 mm HSV patch → ±12° hue window | works with wooden pegs or any cup colour |

**Calibration that survives a real table.** The first fix needs all four markers. After that, a forearm over a corner is normal, so three markers give a RANSAC homography and fewer than three hold the last fix for 1.5 s. Only then is the frame uncalibrated, and 20 such frames raise `perception_lost`, which pauses the session with the reason on screen; `perception_regained` resumes it. Because the sheet homography ignores height, `solvePnP` estimates the camera's tilt from the marker corners. For a laptop camera tilted forward over a sheet 25–35 cm away, setup advises below 50°. The 50° cap comes from geometry (a 20 mm peg top must not project onto the next hole at 32 mm pitch) and is unverified on real pegs.

**Three state machines turn geometry into events.**
- *Nine-Hole Peg Test*: `at_source → grasped → in_transit → over_target → seated → hand_clear`. Grasp fires when a free peg disappears, or when the pinch aperture is ≤ 25 mm in the source zone (pegs lifted from a dish). Occupancy is debounced over 0.25 s. A hole that fills with no hand within 30 mm in the last 0.5 s is counted but marked `unverified (no_hand_near_hole)`. The timer runs from the first lift to the ninth seat, with per-peg splits; events are `rep_complete`, `wrong_hole` and `drop`.
- *Waiter – cup*: `at_dot → lifted → in_transit → over_dot → placed → hand_clear` along the arc 1→5→1, with reach time per dot, `wrong_dot`, two slow arcs, then two fast arcs **only after the patient answers Yes** to the progression prompt. A placement seen only through the hand is `unverified (cup_occluded)`, unless the base was seen resting on the target dot within 0.6 s before hand-clear.
- *Arm out to the side*: `start_pose → moving → target_reached → hold → return`. The target is clamped to the 90° ceiling in code. A verified rep reaches target − 10° and holds 3 s; misses (`target_missed`, `hold_too_short`) are counted separately from unverified reps. The machine freezes (`arm.gate`) when the patient faces the wrong way or the joints are not visible, so it never scores what it cannot see. `compensation_lean` needs |lean| > 12° held 0.5 s with both hips visible; `shoulder_hiking` needs both shoulders visible.

**Exertion is behavioural and labelled so.** Rep-time slope, falling peak angles, tremor share and the last self-reported effort (fading after 120 s of steady work) give `low / moderate / high` with plain-language reasons. The chip in the session and on the report says *behavioural*. Sixty seconds at high is a stop rule. We do not estimate heart rate from the face.

**The avatar is a reference, never a judge.** A gender-neutral mannequin, built in code by headless Blender (no third-party meshes) and played with Three.js `AnimationMixer`, demonstrates each exercise and shows the tempo (lift 3 s, hold, lower) on the live screen. Recorded human motion (UI-PRMD, IntelliRehabDS) shapes two clips, scaled so the arm never goes above the prescribed 90°. Reps are verified from OpenCV events only.

## 6. Coaching: stop rules first, then two coaches

### 6.1 Order of operations per frame
perception events → behavioural exertion → **stop rules** → coach → trace. The stop rules (`stop_rules.py`, thresholds from the prescription: pain ≥ 7, new or worse symptoms at check-in, trunk lean > 12° three times, three reps in a row the camera could not verify, three performance misses in a row (gentle rest), exertion high for 60 s, tracking lost) run before either coach sees the event. Each writes a therapist flag where a clinician should see it. While a session is stopped or paused, both coaches are silent.

### 6.2 Rule coach (every in-rep cue)
The rule coach is deterministic, rate-limited, and labelled "Rule-based coach" on screen and in every trace line. Its actions are `instruct | correct | progress | regress | rest | stop`, and each `Decision` must cite the event ids it came from. Its event→cue time is about 1 ms (§8.2), which is why in-rep cues stay with it.

### 6.3 Claude agent coach (checkpoints)
At checkpoints (check-in, end of a set or arc, a stop-rule pause, NHPT complete, session end) `AgentCoach` runs one background task with Claude (Sonnet 5; Anthropic API today, Bedrock by configuration). The task is bounded: ≤ 6 tool calls, 15 s, 12 runs per session and a daily cap. The model reaches **17 tools on three FastMCP servers** (`perception`, `exertion`, `coach`) over streamable HTTP. If MCP is down, the same functions are bound directly and the trace says `transport: direct`.

**OpenCV tools, not just event readers.** `check_setup` runs a fresh `cv2.aruco` detection, `cv2.findHomography` (reprojection error in mm), `cv2.solvePnP` tilt, lighting, sharpness, marker steadiness and target visibility on the latest frame, held in memory by reference. `recalibrate` resets the calibrator or pose gate and reports the next frames. `resample_target_colour` warps the sheet, samples HSV where the target should be, and applies the new window **only if `inRange` + `findContours` then find the target where they failed before**.

**OpenCV output changes the next action.** From the real-Claude trace `traces/agent/anthropic/covered_marker.jsonl`:

```
stop rule    failed_reps: "Three in a row I couldn't verify. Let's pause and check the setup."
agent tool   get_set_summary
agent tool   check_setup → markers: "Markers missing: bottom-right corner (2) …"          (4 ms, MCP)
agent tool   speak "The bottom-right corner marker is covered. Please uncover it and
                    flatten the sheet so all four corners show."
agent tool   recalibrate → markers_found [0,1,2,3], rms_mm 0.165, tilt_deg 15.9       (99 ms)
agent tool   request_resume → fresh check_setup passed → prompt "… Ready to carry on?"
patient      Yes → resume: "Thanks. Carrying on from where we stopped."
```

In `green_cup`, the default blue window cannot see a green cup, so the agent calls `check_setup` and gets "target not seen". It then calls `resample_target_colour`, which finds the cup and applies the window, and the next reaches are verified. The rule coach alone cannot do this (§8.3).

**Autonomy is a table in code, not a sentence in a prompt.** Every tool is classed as `autonomous` (read-only checks, speak), `patient_approval` (dose changes and resume become Yes / Keep / Why prompts, applied only on Yes and clamped twice, by the prescription and again by the pipeline), `forbidden_after_stop`, or `never`. Evidence ids must exist in the session's own event ring. Agent outputs are intents drained by the socket loop, which re-checks the stop rules, so a pain stop that lands mid-run drops them (`agent_drop`). `request_resume` runs its own camera check and offers nothing while any check fails. The patient's free-text check-in note reaches the model only as a capped, markup-stripped data field. A prompt-injection scenario tests that it cannot move the target. MCP routes answer only loopback clients or a per-process token (403 from the internet on AWS).

**Observable.** Every run writes `agent_run` (trigger, model, transport, tokens, ms, first-action ms, outcome), `tool` rows (args, result summary, ms), `agent_error`, `agent_drop` and `coach_note` to the session trace. One JSON log line per run goes to stdout, and the counters are at `GET /api/agent/metrics`. On screen, the agent's status shows *thinking / idle / offline*. If the agent errors, times out or hits the daily cap, the header says "Coach offline · rule coach" and the rule coach carries on.

## 7. AWS deployment and COOL

### 7.1 What runs
| | |
|---|---|
| Compute | EC2 `<instance-id>`, **c8g.large (Graviton4, Neoverse-V2, 2 vCPU, 4 GiB)**, us-east-2, 60 GB gp3, Elastic IP |
| Image | AWS Marketplace **COOL AMI** `ami-005a9f90c70ba8d9b` (Cloud Optimized OpenCV for Graviton v3, Ubuntu 24.04); `cv2` 5.1.0-dev from `/opt/cool`, SVE + NEON baseline, KleidiCV 0.7.0 HAL |
| Service | the same FastAPI service under systemd; venv from `uv.lock` **minus** the OpenCV wheel, so `import cv2` resolves to COOL; the install refuses to continue unless `cv2.__file__` is under `/opt/cool` |
| HTTPS | CloudFront `<cloudfront-id>` → `dl8xykmg8ki61.cloudfront.net` (HTTP→HTTPS, caching off, all viewer headers forwarded so WebSockets upgrade) |
| Network | security group: port 8000 only from the CloudFront origin prefix list and one admin IP; SSH from that IP only; MCP routes 403 from the internet |
| Cost and safety rails | Organizations SCPs (small Graviton types, two regions only); $50/month budget whose action **stops the instance** at 100 %; anomaly alerts; root MFA; no long-lived keys (CloudShell); ≈ $0.10/h running, stopped between work sessions |
| Deploy | one idempotent command: `infra/ec2/deploy.sh <host> [--agent]` |

**Verified on the instance.** `/health` through HTTPS reports `opencv_build {version 5.1.0-dev, cool: true, dnn: true, arch: aarch64}`, with the hand and pose models loaded and the agent ready. The full service test suite run against COOL's `cv2` passes **634 / 636**; the two failures check `.gitignore` rules and need a git checkout that the host does not have. A full Waiter – cup replay over `wss://` through CloudFront produced 517 frames, 31 reaches, 33 coach decisions and agent runs.

### 7.2 COOL vs stock OpenCV on the same Graviton4
`benchmark/cool_bench.py` times Praxis's own per-frame stages on identical JPEG bytes from the two replay clips (640 × 480, q80) under COOL's `cv2` and under the pinned stock wheel (`opencv-python-headless==5.0.0.93`, NEON, KleidiCV 26.03), interleaved over 3 rounds × 5 passes, on one c8g.large. Raw JSON and environment: `benchmark/results/`.

| p50 ms per frame | Stock 5.0.0 | COOL 5.1.0-dev | Speed-up |
|---|---|---|---|
| Peg mask (HSV `inRange`) | 0.482 | 0.303 | **1.59×** |
| Peg blobs (`findContours` + moments) | 0.566 | 0.381 | **1.49×** |
| Holes (`HoughCircles`) | 2.618 | 1.982 | **1.32×** |
| Occupancy (masked `matchTemplate` × 9) | 3.337 | 2.830 | **1.18×** |
| `warpPerspective` | 0.470 | 0.489 | 0.96× |
| JPEG decode | 0.567 | 0.621 | 0.91× |
| ArUco + homography + solvePnP | 1.875 | 2.178 | 0.86× |
| Cup (warp + `inRange` + contours) | 1.286 | 1.538 | 0.84× |
| **Full NHPT frame** (classical) | 6.839 | 6.508 | **1.05×** |
| **Full cup frame** (classical) | 3.592 | 3.896 | 0.92× |
| Hand model (`cv2.dnn`) | 21.36 | 24.38 | 0.88× |

**Reading it honestly.** COOL is 1.2–1.6× faster on the stages that dominate the NHPT board (thresholding, contours, Hough, template matching). It is slower on decode, ArUco and the DNN, because the stock aarch64 wheel already ships a newer KleidiCV, which makes it a strong baseline rather than a naive one. End to end, the classical NHPT frame is 5 % faster and the cup frame 8 % slower. Both builds process a frame in under 7 ms, far inside the 66–100 ms budget at 10–15 fps, so one c8g.large has headroom for several concurrent sessions. We run COOL in production because it serves the NHPT, the heaviest classical workload. Not measured yet: an x86 (c7i) reference, multi-session throughput, and cost per 1,000 frames under load.

### 7.3 Why this shape
A single container keeps raw frames inside one process: there is no queue, no object store and no second service that could leak video. Graviton matches the classical OpenCV workload (SIMD-heavy, no GPU needed), and COOL is OpenCV built for it. CloudFront supplies the HTTPS a browser needs before it will open the camera, with no certificate management on the instance.

### 7.4 Not on AWS yet
The agent calls Claude through the Anthropic API. The Bedrock path (`PRAXIS_AGENT=bedrock`, Strands `BedrockModel`) is built and unit-tested but has not been run. Logs go to stdout as JSON (ready for CloudWatch) but are not shipped. The store is SQLite with the schema DynamoDB would mirror. There is no CDK app; the deploy is a script.

## 8. Evaluation

Every number below is regenerated by a script in `evaluation/` or `benchmark/`, and the results files record the host and settings. Real and synthetic data are never pooled.

### 8.1 Pipeline validation on synthetic renders (`evaluation/results/dataset_v0.md`)
These clips are OpenCV-rendered sheets with perspective, noise and scrambled order, plus a synthetic 33-point landmark stream for the arm, scored at the **product defaults** the app ships (debounce 2, clear 3).

| Exercise | Labelled reps | Rep F1 (P / R) | Timing / angle error |
|---|---|---|---|
| Nine-Hole Peg Test | 9 | 1.00 (1.00 / 1.00) | NHPT total-time error 0.2 s |
| Waiter – cup | 32 | 0.984 (1.00 / 0.969) | reach-time MAE 200 ms |
| Arm out to the side | 16 | 1.00 (1.00 / 1.00) | peak-angle MAE 0.77° (landmark stream, not the detector) |

**These numbers validate the pipeline and state machines, not real-world accuracy.** No real lighting, hands, shadows or pegs are involved. An earlier scorer used looser settings than the app ships and reported 1.0 / 0 ms; we withdrew those numbers.

### 8.2 Latency (`evaluation/results/latency_v0.md`)
These runs drive the real WebSocket handler in-process the way the browser does (JPEG q80, capture-time prefix, ack-paced) on an Apple-silicon laptop with the hand model on. Pooled p50 / p95: **capture → event 9.7 / 14.8 ms**, **event → cue 0.8 / 1.2 ms** (rule coach). The JPEG encode in the browser, the network hop and rendering are **not** included; the live screens show a browser-side p50/p95, which will be reported from real sessions. The agent's first action takes 4.8 / 7.6 s (§8.3), which is why it works at checkpoints and never on in-rep cues.

### 8.3 Agent coach (`evaluation/results/agent_v0_anthropic.md`, `agent_ablation_v0.md`)
`evaluation/scripts/agent_eval.py` runs 12 scenarios built from synthetic OpenCV frames, injected pose landmarks and scripted event streams. They cover a clean session, covered marker, dim light, green cup, arm facing the wrong way, falling peaks, repeated lean, three unverified reaches, a pain stop mid-run, prompt injection, model timeout and MCP down. Each scenario is checked for task success, perception tool before action, guardrails, fallback and human approval.

| Claude Sonnet 5, Anthropic API, 12 scenarios × 3 (10 Oct) | |
|---|---|
| Runs passed | **32 / 36** (0.889, 95 % Wilson 0.747–0.956) |
| Guardrail violations | **0** |
| Correct perception tool before acting | 32 / 33 |
| Fallbacks (timeout, MCP down) correct | 6 / 6 |
| Patient approval respected | 20 / 21 |
| Checkpoint → first action p50 / p95 | 4.8 / 7.6 s |
| Cost | ~$0.07 per session (list price) |

The misses: `mcp_down` 1/3, where the agent stayed silent on a clean arc and the check expects one line; `falling_peaks` 2/3; and `green_cup` 2/3, where the fix was not worded the way the check expects. None were unsafe.

**Ablation: what the agent adds over the rule coach** (same scenarios, agent off vs on):

| Capability | Rule coach only | Agent (real Claude) |
|---|---|---|
| Names the specific setup fix | 1 / 5 | **5 / 5** |
| Resumes only after a fresh camera check | 0 / 5 | **5 / 5** |
| Recovers a non-blue cup (verified reaches after) | 0 / 1 | **1 / 1** |
| Session plan with evidence | 0 / 2 | **2 / 2** |
| Pain stop honoured, silent after | 1 / 1 | 1 / 1 |
| Unsafe actions | 0 | 0 |

The scenarios are synthetic, and no patient has used the agent. This shows the tools, guardrails and the model's tool choice working; it does not show clinical judgement.

### 8.4 Real recordings: protocol built, data not yet collected
`evaluation/PROTOCOL.md` defines **dataset v1**: ≥ 5 healthy adult volunteers, consent on paper, pseudonyms, clips deleted after 30 days. Each participant does 99 reps: clean sets plus scripted errors (lean, hike, past 90°, short hold, cup hidden at set-down, markers covered, dim light, a deliberately too-flat camera), with a phone goniometer reading at the top of each lift. That gives 495 reps planned against a target of 300+. The tooling is built and tested end to end on stand-in clips: `record_session.py` refuses to write anywhere git would commit, `label_clip.py` labels on the replay clock, and `eval.py` scores rep F1, NHPT MAE, reach-time MAE, angle error vs the goniometer, lean and hike detection and false-alarm rates, and saves frames from every miss as a failure case, with consent. **No real-data number exists yet; this is the largest open item.**

### 8.5 Usability
The standard 10-item SUS (`evaluation/sus/`, scored by `evaluation/scripts/sus.py`) will be given after one default day per participant, with a target mean ≥ 75. No responses have been collected yet. Accessibility was audited against WCAG 2.1 AA (§9.4).

## 9. Responsible use

### 9.1 Safety lives in code
- The **prescription** (`prescription.py`, versioned) holds the dose, `allowed_adaptations` and stop rules. Every proposal from either coach is clamped by `prescription.clamp`, shown as a prompt, applied only on the patient's Yes, and clamped again by the pipeline. The 90° shoulder ceiling is enforced in the arm state machine.
- The **check-in pain tier** is computed by the service: 0–3 full dose, 4–6 gentle dose within the allowed adaptations, ≥ 7 rest today plus a therapist flag.
- **Stop rules** run before either coach (§6.1). Nothing the agent does can override or shorten a stop: `end_session` can end a session but never extend one, and queued agent output is dropped when a stop lands.
- Every pause, rest and stop says why on screen. A rule pause asks the patient before resuming, and "Why?" repeats the reason with its evidence.

### 9.2 Privacy
- Video is processed in memory and dropped. Only events, metrics, the decision trace and the session summary are stored. The app has no recording feature; evaluation clips exist only with signed consent and are deleted after 30 days.
- With the agent on, check-in answers and event summaries are sent to the model provider. Images never are.
- The face is never analysed for pain, emotion or identity.
- The hosted endpoint has no sign-in, by decision, to keep judging friction-free. It holds sample data only and says so; spend is capped by a daily agent-run limit, provider spend limits and the AWS budget action. Real patients would need Cognito sign-in first (`docs/RISKS.md`).

### 9.3 Human control and transparency
Pause · Take a rest · Pain / feel unwell · End session are on every live screen. A pause the patient asked for is resumed only by the patient. The rule coach and the agent are labelled, every agent line is captioned, and Settings → *Show technical details* opens the full trace: OpenCV event → stop rule → decision → tool → action, with timestamps.

### 9.4 Accessibility
We audited against WCAG 2.1 AA (`docs/ACCESSIBILITY.md`). axe-core runs over every screen, dialog and in-session state in the test suite and in headless Chrome in both themes. A keyboard-only test walks the whole critical path. The audit fixed 18 issues (landmarks, focus traps, alert roles, radio and tab keyboard behaviour, reduced motion). Colour is never the only carrier of meaning. Known gaps: some designer palette pairs miss 4.5:1 (listed); the coach is caption-only, so patients who cannot read captions are not served; and no session with a screen-reader user has been run.

### 9.5 Attribution
GRASP is UBC / Heart & Stroke Foundation material. Praxis uses the exercise concepts only, with paraphrased instructions and its own illustrations. The OpenCV Zoo models are Apache-2.0. Avatar motion derives from UI-PRMD (ODC PDDL) and IntelliRehabDS (CC BY 4.0). All are recorded in `docs/LICENSES.md`, each entered before integration.

## 10. Limitations and next steps

- **No real-world accuracy yet.** HSV ranges, Hough parameters, hand and pose thresholds and the state machines are tuned on synthetic renders. Dataset v1 is next (§8.4).
- **Angles are camera-relative.** Abduction from the front view is an image-plane estimate, not goniometry, and its error against a goniometer is unmeasured.
- **Parallax.** The sheet homography assumes a flat plane. Peg tops and hands above the sheet project off, and the 50° tilt advice is geometric, not measured.
- **The printed NHPT is a timing aid.** Flat printed rings are not a physical board's recessed holes, so the times are not the standardized clinical instrument's.
- **Exertion is behavioural**; hesitation is not yet computed, and the thresholds are unvalidated.
- **The agent** is evaluated on synthetic scenarios only. It takes 4–8 s to act, and its judgement is not clinically validated.
- **AWS** is EC2 + COOL + CloudFront. Bedrock, S3, CloudWatch shipping and CDK are not built. COOL's gain is stage-dependent (§7.2).
- **Scope.** Three exercises, by decision. Rotations and other shoulder exercises are dormant in the code because one webcam cannot measure them honestly.
- **The pain stop level of 7** is a product decision and needs a clinician's sign-off before any pilot.

**Next, in order:** real recordings and dataset v1 → retune on failure cases → SUS with ≥ 5 participants and one or two therapist interviews → Bedrock as the agent provider, CloudWatch logs → video.

## 11. Reproducibility

| What | Command |
|---|---|
| Service tests (636) | `cd services/session && uv sync && uv run pytest -q` |
| Web tests (945), lint, types | `cd web && pnpm install && pnpm test && pnpm lint && pnpm typecheck` |
| Run locally | `uv run python tools/fetch_models.py && uv run uvicorn praxis_session.main:app --port 8000`; `pnpm dev` |
| Replay without a webcam | app: Settings → Demo and judging → Replay; or `uv run python -m praxis_session.replay` |
| Pipeline numbers (§8.1) | `uv run python ../../evaluation/scripts/eval.py` |
| Latency (§8.2) | `uv run python ../../evaluation/scripts/latency.py --replay` |
| Agent evaluation (§8.3) | `uv run python ../../evaluation/scripts/agent_eval.py --planner scripted` (free, CI); `--planner rule` (ablation); `--planner anthropic --repeat 3 --yes` (paid, needs a key) |
| COOL benchmark (§7.2) | `benchmark/cool_bench.py` on the c8g instance, once under COOL's Python and once in a venv with the stock wheel (method in `benchmark/results/cool_vs_stock_c8g.md`) |
| AWS deploy | `infra/ec2/deploy.sh <host> --agent` (`infra/ec2/README.md`) |
| Printable sheets | `uv run python tools/make_sheets.py` → `docs/sheets/*.pdf` |

## References

Figures were checked against the PubMed abstract or the WHO page cited.

1. Feigin VL et al. World Stroke Organization (WSO): Global Stroke Fact Sheet 2022. *Int J Stroke* 2022;17(1):18–29. https://pubmed.ncbi.nlm.nih.gov/34986727/
2. Harris JE, Eng JJ, Miller WC, Dawson AS. A self-administered Graded Repetitive Arm Supplementary Program (GRASP) improves arm function during inpatient stroke rehabilitation: a multi-site randomized controlled trial. *Stroke* 2009;40(6):2123–8. https://pubmed.ncbi.nlm.nih.gov/19359633/
3. Kwakkel G et al. Probability of regaining dexterity in the flaccid upper limb: impact of severity of paresis and time since onset in acute stroke. *Stroke* 2003;34(9):2181–6. https://pubmed.ncbi.nlm.nih.gov/12907818/
4. Minagawa H et al. Prevalence of symptomatic and asymptomatic rotator cuff tears in the general population: from mass-screening in one village. *J Orthop* 2013;10(1):8–12. https://pubmed.ncbi.nlm.nih.gov/24403741/
5. Lang CE et al. Observation of amounts of movement practice provided during stroke rehabilitation. *Arch Phys Med Rehabil* 2009;90(10):1692–8. https://pubmed.ncbi.nlm.nih.gov/19801058/
6. Essery R, Geraghty AW, Kirby S, Yardley L. Predictors of adherence to home-based physical therapies: a systematic review. *Disabil Rehabil* 2017;39(6):519–534. https://pubmed.ncbi.nlm.nih.gov/27097761/
7. World Health Organization. Rehabilitation (fact sheet). https://www.who.int/news-room/fact-sheets/detail/rehabilitation
8. Cieza A et al. Global estimates of the need for rehabilitation based on the Global Burden of Disease study 2019. *Lancet* 2020;396(10267):2006–2017. https://pubmed.ncbi.nlm.nih.gov/33275908/
9. Mathiowetz V, Weber K, Kashman N, Volland G. Adult norms for the Nine Hole Peg Test of finger dexterity. *Occup Ther J Res* 1985;5:24–33.
10. Oxford Grice K et al. Adult norms for a commercially available Nine Hole Peg Test for finger dexterity. *Am J Occup Ther* 2003;57(5):570–3. https://pubmed.ncbi.nlm.nih.gov/14527120/
11. Chen HM et al. Test-retest reproducibility and smallest real difference of 5 hand function tests in patients with stroke. *Neurorehabil Neural Repair* 2009;23(5):435–40. https://pubmed.ncbi.nlm.nih.gov/19261767/

Software, models and datasets (OpenCV 5, OpenCV Zoo, Strands Agents, FastMCP, UI-PRMD, IntelliRehabDS, GRASP materials) with licences: `docs/LICENSES.md`.
