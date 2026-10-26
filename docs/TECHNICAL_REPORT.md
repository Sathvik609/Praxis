
# Praxis: an agentic vision coach for upper-limb rehab at home

**Technical report · OpenCV AI Competition 2026 (powered by AWS) · Team Praxis · 26 Oct 2026**

Live (AWS Graviton4 + COOL, HTTPS): **https://d235zashbh751z.cloudfront.net** · Judge quick-start: [`docs/JUDGE_QUICKSTART.md`](JUDGE_QUICKSTART.md) · Diagrams: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) · Full engineering detail, module by module: [`docs/ENGINEERING_NOTES.md`](ENGINEERING_NOTES.md)

> Praxis helps people keep up with exercises a therapist has already prescribed, and coaches them while they do them. **It is not a medical device.** It does not diagnose and it does not choose exercises. Its angles and times are not clinical measurements.

## Summary

After a stroke or a shoulder injury, most recovery work happens at home between clinic visits, with nobody watching. Patients get a printed sheet of exercises. They don't know if a repetition counted, they compensate without noticing, and the therapist sees nothing until the next visit.

Praxis uses **one ordinary laptop camera, a printed A4 sheet and a cup or a few pegs** to coach three therapist-prescribed exercises:

- **Arm out to the side** (shoulder abduction, lifting the arm out sideways)
- **Waiter – cup** (a GRASP coordination task)
- the **Nine-Hole Peg Test (NHPT)** (a standardized weekly assessment)

How it works:

- **OpenCV 5 measures.** Four ArUco markers on the sheet (square codes the camera can find and tell apart) give a metric homography: the mapping from the camera picture to the flat sheet in millimetres. Hough circles, HSV colour segmentation, contours and masked template matching find the pegs, holes and cup. OpenCV Zoo ONNX models in `cv2.dnn` give hand and body landmarks. A state machine per exercise emits timestamped events: a rep, a reach, a peg seated, a trunk lean, tracking lost.
- **Stop rules in code run before any coach**: pain ≥ 7, repeated trunk lean, repeated reps the camera could not check, repeated missed reps, sustained exertion. A stop rule stops, pauses or rests the session and flags the therapist. Losing tracking only pauses, until the person is back in view.
- **Two coaches share one interface.** A deterministic rule coach gives every in-rep cue. **Our agent** (Claude Sonnet 5.5 via the Anthropic API) runs at checkpoints and calls OpenCV itself through MCP tools (MCP is a standard protocol for letting a model call tools). `check_setup` runs a fresh ArUco/homography/pose check on the latest frame, and `resample_target_colour` re-segments a cup the camera cannot see. The camera result picks the next step. Every dose change and every resume is a prompt the patient answers.
- **It runs on AWS**: an EC2 **c8g.large (Graviton4)** from the **COOL AMI** runs the same service on COOL's OpenCV 5.1.0-dev behind CloudFront HTTPS. We measured COOL against the stock OpenCV wheel on the same instance.

What is measured and what is not:

| Area | Status (26 Oct 2026) |
|---|---|
| OpenCV 5 pipeline, three exercises, every screen, stop rules, rule coach, trace, replay | built; 952 service tests and 1,052 web tests (26 Oct, run locally); `.github/workflows/ci.yml` has the same lint, type and test steps |
| Our agent (17 tools over MCP, autonomy table, guardrails) | built, on the Anthropic API. **Real video** (REHAB24-6 through the product pipeline, 40 sessions, patient taps simulated): named a fault motion capture confirmed, and gave a correction, in 41 of 44 set reviews; named the fix on 26 of 26 real wrong-view pauses; **0 guardrail violations**. Synthetic (15 scenarios, 21 Oct recheck): 15/15, 0 violations (§8.3) |
| AWS: Graviton4 + COOL + CloudFront | **live** (rebuilt 21 Oct; up from submission until 10 Nov 2026). On 11 Oct, on the previous instance (same AMI and type), the test suite passed 634/636 on COOL and we measured the benchmark (§7). Last deployed and checked 26 Oct: `/health`, both replays and agent runs |
| Accuracy on real people | **Arm out to the side, on a public lab dataset** (REHAB24-6, 8 healthy adults, front camera, 88 reps): angle MAE **3.8°** vs motion capture (95 % limits −9° to +10°), rep-peak MAE 3.8°, rep F1 **0.96** (§8.4). With laptop framing (hips at or below the bottom edge, cropped from the same video): rep F1 0.91–0.93 (34–35 of 35 reps found), angle MAE 5.0–7.5° (§8.4, fixed 25 Oct after the team's laptop sessions). NHPT and Waiter – cup ran live with the team on real webcams (§8.6); their accuracy numbers are from 3-D renders (§8.1.1). |
| Usability (SUS), patient or therapist pilots | not run. Three of us used our Railway test build live (17 saved sessions, 13–24 Oct, plus 7 automated runs): a shake-down, not a usability study (§8.7) |
| S3, CDK | not built (§7.4) |
| CloudWatch logs, EMF metrics, dashboard, alarms | built and tested locally, not yet run on AWS (§7.5) |

---

## 1. Problem

Stroke is common, disabling and growing. It is the second-leading cause of death worldwide, and third for death and disability combined. Between 1990 and 2019, new strokes rose 70 % and the number of people living after a stroke rose 102 % [1]. More than 70 % of people who have a stroke have upper-limb deficits (problems with the shoulder, arm or hand) [2]. Of 102 patients with arm paresis (weakness) after an acute stroke, only 11.6 % had fully regained use of the arm at six months [3]. Shoulder problems add to this: ultrasound screening of a whole village found a full-thickness rotator-cuff tear in 22.1 % of residents, rising to 36.6 % of those in their 80s [4].

Recovery needs repetitions that clinic time does not give. In 312 observed therapy sessions, task-specific arm practice happened in only 51 % of sessions, and averaged **32 repetitions** when it did [5]. The rest is meant to happen at home, where non-adherence to self-managed home physical therapy can reach **70 %** [6]. Access is the other limit. About **2.4 billion** people live with a condition that could benefit from rehabilitation [7, 8]. In some low- and middle-income countries more than half of them do not get the services they need, and many places have fewer than 10 skilled practitioners per million people [7].

Home programs work when people do them. GRASP (Graded Repetitive Arm Supplementary Program, UBC) is an arm program patients do on their own. In a randomized trial of 103 stroke inpatients, it improved arm function on the CAHAI (an arm and hand function scale) by 6.2 points over an education control group (95 % CI 3.4–9.0), and the gain held at five months [2]. The **Nine-Hole Peg Test** is a standard, quick measure of finger dexterity, with adult norms [9, 10]. In stroke, its smallest real difference for the more-affected hand is large: 32.8 s [11]. A weekly test, given the same way each time and with per-peg splits, is more useful than an occasional clinic reading.

What goes wrong at home:
1. *No feedback on quality.* The patient can't tell if the lift reached the target, was held, or was faked by leaning the trunk.
2. *No dose control.* On a bad day patients push through pain or skip the session, and nobody sees either.
3. *No signal to the therapist.* The clinician hears about a missed week, a pain spike or a compensation weeks later.
4. *Outcome measures need the clinic.* A clinician times the Nine-Hole Peg Test with a stopwatch.

A patient with a laptop already owns the sensor. With four ArUco markers, OpenCV 5 turns a printed sheet into a calibrated measuring surface, and it runs hand and pose networks on a laptop CPU in milliseconds, without storing video. What was missing is a system that is honest about what one webcam can measure, keeps the therapist in charge, and stops itself when it should.

## 2. Users and design principles

| | **Patient (primary)** | **Therapist (secondary)** |
|---|---|---|
| Who | Adult after stroke or a shoulder injury, practising at home between visits. Often older, often using one hand, may have low vision or reduced dexterity. Not technical | Occupational therapist or physiotherapist with a caseload of home programs |
| Needs | Know what to do and whether it counted; a safe dose on bad days; an easy way to stop; no feeling of being watched | Adherence they can trust; early word of pain and safety events; an objective trend (NHPT time, reach time, range); control of the prescription |
| In Praxis | Check-in → demonstration → camera setup → live session with captions → 3-question feedback → report | Read-only dashboard: adherence from real sessions only, flags with reasons, NHPT trend, and one prescription edit, the practice days (each change saved as a new prescription version) |

Design principles (from the hi-fi wireframes, `docs/wireframes/`):

1. **The therapist prescribes, the coach proposes inside the prescription, and code enforces it.** Dose, allowed adaptations and stop rules live in a versioned prescription, and every proposed change is clamped to it.
2. **Unverified is not failed.** A rep the camera could not see (the hand covers the cup, a marker drops out) counts as *unverified*. That count sits next to the verified count everywhere and is never held against the patient.
3. **Feeling is self-reported.** Pain and effort come from what the patient taps or types. We never analyse the face for pain or emotion.
4. **No composite score.** No "accuracy" or "recovery" number appears anywhere. The app shows reps (verified / unverified), times and camera-relative angles.
5. **The patient can always stop.** Take a rest (which pauses) · Pain / feel unwell · End session are fixed on every live screen (§9.3).
6. **Say what is simulated.** The rule coach says it is rule-based, a replay says "Replay", and sample data says "Sample" (off by default). Every trace row names its source.

## 3. What exists and what is new

Camera and sensor rehab products already exist. Their makers describe them as follows (vendor claims we have not checked):

| Product | Approach | How Praxis differs |
|---|---|---|
| Kemtai | software-only motion tracking with a phone, tablet or laptop camera; general exercise and musculoskeletal programs | Praxis adds a **metric printed surface** (ArUco homography) for hand and object tasks, a standardized dexterity test, and therapist stop rules in code |
| Neofect Smart Glove | wearable sensor glove with games for stroke hand and arm rehab | Praxis needs **no wearable**: one laptop camera, a printed sheet, a cup and pegs |
| MIRA | exergame platform for upper-limb rehab (feasibility study with 10 outpatients) | Praxis coaches the prescribed exercise itself (GRASP task, abduction) and **verifies each rep** from vision events instead of scoring a game |

We searched and found no webcam product that times the Nine-Hole Peg Test at home and also coaches therapist-prescribed upper-limb exercises with an agent. That is a negative search result, not proof that none exists.

What is new in Praxis:
- **A printed sheet as a measuring tool.** Four ArUco markers turn an A4 page into a calibrated plane (px ↔ mm, with the reprojection error reported). A laptop camera can then time a Nine-Hole Peg Test peg by peg and measure cup reaches dot to dot (so far on 3-D renders, §8.1.1).
- **An agent whose tools are OpenCV.** The agent can re-run calibration on the current frame, re-sample the target's colour, and re-check the camera before it offers to resume. The vision result decides its next tool call (§6.3).
- **Safety outside the model.** Stop rules, clamps and the autonomy table are code. The shipped model had 0 guardrail violations over the 15 synthetic scenarios (one is a prompt injection) and 40 real-video sessions.
- **Honest perception.** Verified, unverified and missed are separate outcomes, each with a reason. Tracking loss pauses the session with the reason on screen and resumes by itself.

## 4. System architecture

```mermaid
flowchart LR
    subgraph B["Browser (React + TS + Three.js)"]
      CAM["Laptop camera<br/>640×480 JPEG, ack-paced"]
      UI["Screens · captions · prompts<br/>Take a rest · Pain · End"]
    end
    subgraph S["Session service · one Python 3.12 process (FastAPI)"]
      P["OpenCV 5 pipeline<br/>ArUco → homography · Hough · HSV · contours<br/>matchTemplate · cv2.dnn hand + pose"]
      F["State machines<br/>peg · cup · arm"]
      R{"Stop rules<br/>(always first)"}
      RC["Rule coach<br/>in-rep cues"]
      AG["Our agent coach<br/>checkpoints · MCP tools"]
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

The browser sends 640 × 480 JPEGs over a WebSocket, each tagged with its capture time, and sends the next frame only after the service has answered the last. A slow host therefore gets fewer, fresher frames instead of a growing queue. The service decodes each frame with `cv2.imdecode`, runs the pipeline in a thread pool, and sends back JSON: events, overlay geometry, captions and prompts. **No frame, pixel or image is written to disk, put in an event or a trace row, or sent to the model.** A test checks every agent tool result for pixels.

*Edge mode* runs the service on the patient's laptop (`uvicorn`), so no frame leaves the machine. *Hosted mode* runs the same code on the c8g instance behind CloudFront (§7): frames travel over TLS, are processed in memory and are dropped. The camera-setup screen says where processing happens.

**Replay mode** pushes a recorded clip through the same pipeline and coach with no webcam. It is the judges' fallback, badged "Replay" everywhere. A rendered clip is also tagged "Computer-made clip".

Stack: Python 3.12, FastAPI, `opencv-python-headless==5.0.0.93` (pinned for local runs, while AWS uses the COOL AMI's OpenCV 5.1.0-dev), NumPy, Strands Agents SDK + FastMCP 3.4 (MCP streamable HTTP, spec 2025-06-18), SQLite. React 19 + TypeScript + Vite, Radix, Tailwind 4, Three.js (a GLB avatar built in code with Blender). Every dependency is pinned (`uv.lock`, `pnpm-lock.yaml`), and the ONNX models are pinned by SHA-256 hash.

## 5. OpenCV 5 implementation

Every perception module names `cv2.__version__` in its docstring. Each stage below is tested on synthetic frames from our own renderer (`perception/synth.py`: pinhole camera, tilt, yaw, noise).

| Stage | OpenCV 5 | Output |
|---|---|---|
| Sheet calibration | `cv2.aruco.ArucoDetector` (DICT_4X4_50, sub-pixel corners) → `cv2.findHomography` on 16 corners; `cv2.RANSAC` fallback with 3 markers (threshold in px); `cv2.flip` re-detection for mirrored video; `cv2.solvePnP` (IPPE) + `cv2.Rodrigues` for camera tilt | px ↔ mm homography, reprojection RMS (≈ 0.2–0.4 mm on renders), source `fresh / partial / held`, `mirrored` |
| Setup quality | luma mean (brightness), `cv2.Laplacian` variance (blur), marker-corner jitter over 10 frames, task-area projection, px/mm. Each missing marker is predicted from the visible ones (`cv2.findHomography`) and tested against the frame and ArUco's undecoded candidates | checklist rows, each with a specific fix: a corner is "outside the picture", "covered", or "in view but cannot be read" |
| NHPT board | `cv2.warpPerspective` to a 3 px/mm top view; normalisation against the paper (grey `morphologyEx` close → `cv2.divide`, which flattens uneven light and white-balances in one go, ≈ 0.5 ms board / 1.3 ms cup sheet); `cv2.HoughCircles` once (cached, snapped to the spec); `cv2.inRange` (HSV, skin band excluded for every skin tone), plus change from the empty board (`cv2.absdiff`) for uncoloured pegs, + `cv2.findContours` + `cv2.minAreaRect` length gate; masked `cv2.matchTemplate` (`TM_CCOEFF_NORMED`) as tie-breaker | `hole_k: empty / occupied`, free pegs in mm |
| Cup on target sheet | warp to 2 px/mm; the same paper normalisation; HSV `inRange` + `morphologyEx` open, or change from the empty sheet (`cv2.absdiff`) for a cup of any colour; contours grouped around the largest one (fingers split the base) and gated on size and `minAreaRect` aspect; a circle fitted to the base's camera-side edge, which lies on the paper | cup-base centre point in mm, over-dot test |
| Hand | OpenCV Zoo palm detector + hand-landmark ONNX via `cv2.dnn` (Apache-2.0) | 21 landmarks → mm via the homography; pinch aperture, path speed, SPARC smoothness, tremor (FFT, 3–12 Hz) |
| Pose | OpenCV Zoo person detector + BlazePose ONNX via `cv2.dnn` | shoulder angle (One-Euro filtered), trunk lean, shoulder hike, view and visibility gates |
| Tap-to-sample colour | the patient taps the live picture (07b, 07) → frame px → sheet mm via the homography → 6 mm HSV patch on the warped sheet → ±12° hue window. Colourless patches (median S < 60) are refused, with the reason | works with wooden pegs or any saturated cup colour; never black |

Calibration tolerates a forearm over a corner. The first fix needs all four markers. After that, three markers give a RANSAC homography, one or two markers that have not moved keep the last fix, and two that have moved refit it. With no usable marker the last fix is held for 1.5 s. Twenty uncalibrated frames raise `perception_lost`, which pauses the session with the reason on screen, and `perception_regained` resumes it. The agent's `recalibrate` keeps the last fix as an anchor, so a corner seen where it was resumes tracking straight away.

The sheet homography ignores height, so `solvePnP` estimates the camera's tilt from the marker corners. For a laptop camera over a sheet 25–35 cm away, setup advises a tilt below 50°. That cap comes from geometry (the top of a 20 mm peg must not land on the next hole at 32 mm pitch) and is unverified on real pegs.

A robustness sweep (`evaluation/scripts/robustness.py`, results in §8.1) renders both sheets under 107 perturbations and runs the real calibration, setup, occupancy and cup code. Its first run found seven weak spots, each fixed test-first. The main one: a dim room lost every peg and a warm bulb made phantom ones, so each top-down view is now normalised to the paper's own brightness. Others widened the skin band, added gates against pens, re-detected mirrored video and fitted the page to US Letter. On renders the sheet now calibrates from 0° to 65° tilt, at 30 % to 100 % frame fill, at mean luma 30, and with noise σ 20, JPEG q40 and 5 px motion blur. The worst target error is 1.2 mm, except on a curled or creased sheet (1.2–11 mm) and a barrel lens (1–2.4 mm, because the homography assumes no lens distortion).

Three state machines turn geometry into events:
- *Nine-Hole Peg Test*: `at_source → grasped → in_transit → over_target → seated → hand_clear`. Grasp fires when a free peg disappears, or when the pinch aperture is ≤ 25 mm in the source zone. Occupancy must hold 0.25 s to count. A hole that fills with no hand within 30 mm in the last 0.5 s is counted as `unverified (no_hand_near_hole)`. The timer runs from the first lift until pegs sit in all nine holes, with per-peg splits.
- *Waiter – cup*: `at_dot → lifted → in_transit → over_dot → placed → hand_clear` along the arc 1→5→1, with reach time per dot. Two slow arcs come first, and the two fast arcs come **only after the patient answers Yes** to the progression prompt. A placement seen only through the hand is `unverified (cup_occluded)`, unless the base was seen on the target dot within 0.6 s before hand-clear.
- *Arm out to the side*: `start_pose → moving → target_reached → hold → return`. The target is clamped to the 90° ceiling in code. A verified rep reaches target − 10° and holds 3 s. Misses (`target_missed`, `hold_too_short`) are counted apart from unverified reps. The machine freezes when the patient faces the wrong way or the practising shoulder or elbow is not visible (the hips may be out of frame). If that lasts 3 s (turned away) or 6 s (joints not visible), the set pauses with the fix (`setup_blocked`). `compensation_lean` needs |lean| > 12° held 0.5 s. `shoulder_hiking` needs shoulder elevation above the healthy allowance *at the current arm angle* (REHAB24-6 p95 + 0.05 trunk lengths, §8.4) for 3 frames. Both flags need both hips in view. The front view is accepted from a shoulder separation of 0.55 trunk lengths (§8.4).

Exertion is behavioural and labelled so. Rep-time slope, falling peak angles, tremor share and the last self-reported effort give `low / moderate / high` with plain-language reasons. Sixty seconds at high is a stop rule. We do not estimate heart rate from the face.

The avatar demonstrates and never judges. It is a gender-neutral mannequin built in code by headless Blender (no third-party meshes) and played with Three.js. It shows each exercise and its tempo on the live screen. Recorded human motion (UI-PRMD, IntelliRehabDS) shapes two clips, scaled so the arm never goes above 90°. Reps are verified from OpenCV events only.

## 6. Coaching: stop rules first, then two coaches

### 6.1 Order of operations per frame

perception events → behavioural exertion → **stop rules** → coach → trace.

The stop rules (`stop_rules.py`) take their thresholds from the prescription:
- pain ≥ 7 during the session stops it (at check-in, 7 or more gives a warning: rest today, or continue gently with a flag)
- trunk lean > 12° three times pauses
- three reps in a row the camera could not verify pause ("check the setup"), but a peg the board saw seated does not count
- three performance misses in a row give a gentle rest
- exertion high for 60 s gives a rest
- tracking lost pauses, and the session resumes by itself when tracking returns
- in Arm out to the side, turned away from the camera for 3 s, or the practising shoulder or elbow out of view for 6 s, pauses with the fix (no therapist flag, the patient taps to resume)
- new or worse symptoms is still in the code, but the check-in no longer asks it

They run before either coach sees the event. Pain, leaning, failed and missed reps and sustained exertion write a therapist flag. Lost tracking and a blocked setup only pause. While a session is stopped or paused, both coaches stay silent.

### 6.2 Rule coach (every in-rep cue)

The rule coach is deterministic and rate-limited. It is labelled "Rule-based coach" on screen and in every trace line. Its actions are `instruct | correct | progress | regress | rest | stop`, and each `Decision` must cite the event ids it came from. It goes from event to cue in about 1 ms (§8.2), so in-rep cues stay with it.

The shoulder-hike caption is limited to 2 per set, 20 s apart, because in the team's shake-down the flag fired on most reps ([`team_test_2026-10-21.md`](../evaluation/results/team_test_2026-10-21.md)). The `shoulder_hiking` event is still traced and counted in the report.

### 6.3 Our agent (checkpoints)

At checkpoints (check-in, end of a set or arc, a stop-rule pause, NHPT complete, session end), `AgentCoach` runs one background task with Claude Sonnet 5.5 via the Anthropic API, picked in a measured comparison (§8.3). The system prompt and tool definitions are prompt-cached (91–94 % of input tokens). Each task is limited to 6 tool calls and 15 s (25 s for a pause run), and each session to 12 runs, plus a daily cap. The model can reach **17 tools on three FastMCP servers** (`perception`, `exertion`, `coach`) over streamable HTTP. If MCP is down, the same functions are called directly and the trace says `transport: direct`.

Three tools run OpenCV instead of reading events:
- `check_setup` runs, on the latest frame (held in memory by reference): a fresh `cv2.aruco` detection, `cv2.findHomography` (reprojection error in mm), `cv2.solvePnP` tilt, lighting, sharpness, marker steadiness and target visibility.
- `recalibrate` resets the calibrator or pose gate and reports the next frames.
- `resample_target_colour` warps the sheet, samples HSV where the target should be, and applies the new colour window **only if `inRange` + `findContours` then find the target where they failed before**.

OpenCV output picks the next action. Below is the shipped model's 21 Oct run of the `covered_marker` scenario (`traces/agent/anthropic-sonnet-5-5/covered_marker.jsonl`, text copied from the trace, patient tap simulated):

```
stop rule    failed_reps: "Three in a row I couldn't verify. Let's pause and check the setup."
agent tool   get_set_summary → 3 reps, 0 verified, marker_lost
agent tool   check_setup → markers [0,1] found, [2,3] missing (3 ms, MCP):
               "The markers in the bottom-right corner (2), bottom-left corner (3) are covered
                or creased: clear and flatten them."
agent tool   speak "The camera can't see the bottom-left and bottom-right corners of the sheet.
                Please clear and flatten those corners so nothing covers them."
agent tool   recalibrate → markers_found [0,1,2,3], rms_mm 0.165, tilt_deg 15.9   (101.5 ms)
agent tool   request_resume → fresh check_setup passed → prompt
               "Sheet corners are clear again. Ready to carry on?"   (6.1 ms)
patient      Yes, resume → "Thanks. Carrying on from where we stopped."
```

The scenario covers two corners, as a forearm across the bottom edge would. A live session now holds the fix in that case if the other two corners stay put (§5), but the scenario still tests the tool path. In `green_cup`, the default blue colour window cannot see a green cup. `check_setup` returns "target not seen", the agent calls `resample_target_colour`, and the next reaches are verified. The rule coach alone cannot do this (§8.3).

Autonomy is a table in code, not a sentence in a prompt (`AUTONOMY` in `agent/tools.py`). Every tool is in one of four classes:
- `autonomous` (any time in a run): the read-only tools `get_events`, `get_set_summary`, `check_setup`, `get_exertion_state`, `get_prescription`, `read_patient_model`, `get_session_plan`, and `write_session_summary` (the report note, allowed after a stop so the stop is explained).
- `forbidden_after_stop` (on its own, but refused once a stop rule or the agent has ended the session): `speak`, `recalibrate`, `resample_target_colour`, `set_session_plan`, `request_rest`, `flag_therapist`, `end_session`.
- `patient_approval` (only ever a prompt, and nothing changes until the patient taps Yes): `propose_adjustment` (clamped by the prescription, then again by the pipeline) and `request_resume` (offered only after a fresh passing setup check).
- `never` (not tools at all, refused by name): `apply_adjustment`, `resume_session`, `change_prescription`, `override_stop_rule`, `clear_therapist_flag`, `raise_ceiling`.

Once the session has ended, only reads and the report note run. Other checks in code:
- Evidence ids must exist in the session's own event ring, and every dose number must be finite.
- Agent outputs are intents that the socket loop picks up after re-checking the stop rules. If a pain stop lands mid-run, they are dropped (`agent_drop`). A closed socket cancels the run in progress.
- The patient's free-text note reaches the model only as a capped data field with markup stripped. A prompt-injection scenario tests that it cannot move the target.
- MCP routes answer only loopback clients without a proxy header, or a per-process token. From the internet they return 403.

Every run writes trace rows: `agent_run` (trigger, model, transport, tokens, ms, outcome), `tool` rows (args, result summary, and for the OpenCV tools a digest of failing checks, markers and homography error), `decide` rows, and errors and drops. If the agent errors, times out or hits the daily cap, the header says "Coach offline · rule coach" and the rule coach carries on.

## 7. AWS deployment and COOL

### 7.1 What runs

| | |
|---|---|
| Compute | EC2 **c8g.large (Graviton4, Neoverse-V2, 2 vCPU, 4 GiB)**, us-east-2, 60 GB gp3, Elastic IP |
| Image | AWS Marketplace **COOL AMI** `ami-005a9f90c70ba8d9b` (*Cloud Optimized OpenCV For AWS Graviton4*, COOL v3, Ubuntu 24.04); `cv2` 5.1.0-dev from `/opt/cool`, SVE + NEON baseline, KleidiCV 0.7.0 HAL |
| Service | the same FastAPI service under systemd. The venv comes from `uv.lock` **minus** the OpenCV wheel, so `import cv2` loads COOL. The install stops unless `cv2.__file__` is under `/opt/cool` |
| HTTPS | CloudFront → `d235zashbh751z.cloudfront.net` (HTTP→HTTPS, caching off, all viewer headers forwarded so WebSockets can upgrade) |
| Network | security group: port 8000 only from the CloudFront origin prefix list and one admin IP; SSH from that IP only; MCP routes return 403 from the internet |
| Cost and safety rails | $50/month budget with email alerts at 80 %, 100 % and forecast 100 %, an Anthropic spend limit and daily agent-run cap, root MFA, no long-lived keys (CloudShell). Rebuilt 21 Oct in the Praxis-Team management account after the first account became unreachable, so member-account SCPs do not apply |
| Deploy | one idempotent command (safe to re-run): `infra/ec2/deploy.sh <host> [--agent]` |

On the 21 Oct rebuild, `/health` through HTTPS reported `opencv_build {version 5.1.0-dev, cool: true, dnn: true, arch: aarch64}`, with the hand and pose models loaded. Last deployed and checked 26 Oct (through fa32240): `/health`, a full cup replay (32 of 32 reaches) and real agent runs through CloudFront. The instance runs until 10 Nov 2026, with our agent capped at 300 checkpoint runs a day.

On 11 Oct, on the previous instance (same AMI and type), the service test suite passed **634 / 636** against COOL's `cv2` (the two failures need a git checkout), a cup replay over `wss://` through CloudFront counted 31 reaches in 517 frames, and we measured the benchmark below. Neither was re-run on the rebuild.

### 7.2 COOL vs stock OpenCV on the same Graviton4

`benchmark/cool_bench.py` times Praxis's own per-frame stages on identical JPEG bytes from the two replay clips (640 × 480, q80), under COOL's `cv2` and under the pinned stock wheel (`opencv-python-headless==5.0.0.93`, NEON, KleidiCV 26.03), taking turns over 3 rounds × 5 passes on one c8g.large. `benchmark/summarize.py` writes the table from the raw JSON (`benchmark/results/cool_vs_stock_c8g.md`).

| p50 ms per frame | Stock 5.0.0 | COOL 5.1.0-dev | Speed-up |
|---|---|---|---|
| Peg mask (HSV `inRange`) | 0.481 | 0.304 | **1.58×** |
| Peg blobs (`findContours` + moments) | 0.576 | 0.395 | **1.46×** |
| Holes (`HoughCircles`) | 2.181 | 1.526 | **1.43×** |
| Occupancy (masked `matchTemplate` × 9) | 3.359 | 2.878 | **1.17×** |
| Cup (warp + normalise + `inRange` + contours) | 3.369 | 3.317 | 1.02× |
| `warpPerspective` + normalise | 1.185 | 1.319 | 0.90× |
| JPEG decode | 0.566 | 0.620 | 0.91× |
| ArUco + homography + solvePnP | 1.893 | 2.192 | 0.86× |
| **Full NHPT frame** (classical) | 7.690 | 7.452 | **1.03×** |
| **Full cup frame** (classical) | 5.216 | 5.573 | 0.94× |
| Hand model (`cv2.dnn`) | 21.61 | 24.53 | 0.88× |

Compute cost per 1,000 frames (hourly price divided by frames per hour at the measured p50, one stream at a time): full NHPT frame **$0.00017 stock vs $0.00019 COOL**, full cup frame $0.00012 vs $0.00014. COOL's AMI adds $0.01/h.

COOL is 1.2–1.6× faster on the stages that take most of the NHPT board's time: thresholding, contours, Hough and template matching. It is slower on decode, ArUco, the warp and the DNN, because the stock aarch64 wheel already ships a newer KleidiCV. End to end, the classical NHPT frame is 3 % faster and the cup frame 6 % slower, and per frame COOL costs slightly more once its AMI fee is counted. Both builds process a classical frame in under 8 ms, well inside the 66–100 ms budget at 10–15 fps. We run COOL because it runs the whole workload on Graviton and speeds up the NHPT's heaviest classical stages, not because it is cheaper. Not measured yet: an x86 (c7i) reference, several sessions at once, and browser-to-cue latency through CloudFront.

### 7.3 Why this shape
A single container keeps raw frames inside one process, with no queue, object store or second service that could leak video. Graviton suits the classical OpenCV workload (heavy on SIMD, no GPU needed), and COOL is OpenCV built for Graviton. CloudFront gives the HTTPS a browser requires before it will open the camera, with no certificate management on the instance.

### 7.4 Not on AWS yet

The agent calls Claude through the Anthropic API, from the instance just as from a laptop. Amazon Bedrock is not used (the rubric allows any model). Logs go to stdout as JSON and are not yet shipped to CloudWatch (§7.5). The store is SQLite, with the schema DynamoDB would mirror. There is no CDK app. The deploy is a script.

### 7.5 Observability (built, not yet verified on AWS)

The service writes one JSON line for each session start and end (exercise, mode, duration, verified and unverified reps, processing and event-to-cue p50/p95, fps), each stop-rule action, therapist flag, perception loss and socket error, and a heartbeat every 60 s (`services/session/praxis_session/ops.py`). No frames, usernames, free text, pain scores or flag details are logged, and a test checks this.

With `PRAXIS_EMF=1` the same lines carry CloudWatch Embedded Metric Format blocks, so CloudWatch pulls metrics straight from the logs with no SDK. A pinned CloudWatch agent (`deploy.sh --cloudwatch`) ships the log file to `/praxis/session` (30-day retention) with host memory, disk and CPU. `infra/ec2/cloudwatch_setup.sh` creates the instance role, the log group, a dashboard, four SNS email alarms (heartbeat missing, CPU, status check, agent fallbacks) and saved Logs Insights queries.

None of this has run on the AWS account yet. Expected cost is within the CloudWatch free tier, or under $1 a month, worst case about $5–6 (`infra/ec2/README.md`).

## 8. Evaluation

Scripts in `evaluation/` or `benchmark/` regenerate the tables below. Counts from one-off runs (the stress sets, the browser end-to-end run, the team-session tallies) say so where they appear. The results files record the host and settings. We never pool real and synthetic data.

### 8.1 Pipeline validation on synthetic renders (`evaluation/results/dataset_v0.md`)

Sheets rendered with OpenCV (perspective, noise, scrambled order) and a synthetic 33-point landmark stream for the arm, scored at the **product defaults** the app ships (debounce 2, clear 3).

| Exercise | Labelled reps | Rep F1 (P / R) | Timing / angle error |
|---|---|---|---|
| Nine-Hole Peg Test | 9 | 1.00 (1.00 / 1.00) | NHPT total-time error 0.0 s (0.2 s before 11 Oct) |
| Waiter – cup | 32 | 1.00 (1.00 / 1.00) | reach-time MAE 0 ms (200 ms before 11 Oct) |
| Arm out to the side | 16 | 1.00 (1.00 / 1.00) | peak-angle MAE 0.77° (landmark stream, not the detector) |

**These numbers check the pipeline and state machines. They do not show real-world accuracy.**

The timing errors fell to zero after a bias fix: events were stamped on the frame that confirmed them, so every NHPT total was late by (debounce − 1) frames. They are now stamped at the first frame of the confirmed run. On these renders the labels line up with frames, so zero is expected by construction. An earlier scorer used looser settings than the app ships and reported the same 1.0 / 0 ms. We withdrew those numbers.

The robustness sweep (`evaluation/results/robustness_v0.md`, renders only) covers 107 conditions over both sheets: tilt, lens, rotation, distance, light, colour cast, shadows, noise, blur, JPEG, occlusion by four skin tones, peg and cup colours, clutter, US Letter printing, paper curl, mirroring, a squashed 16:9 frame, and five combined scenes. After the fixes in §5:
- First fix on 74 / 81 NHPT and 83 / 91 cup conditions. Misses: heavy blur, markers under a hand or out of the frame, and the old Letter print.
- All holes correct on 61 / 74 calibrated NHPT conditions. The misses come from the sweep's flat-disc pegs past 50° tilt, and from a single frame with a hand already over the grid.
- Cup found within 10 mm on 71 / 77. Misses: band colours outside the default window before tap-to-sample, and a black band.
- One phantom, on a sheet curled 20 mm.
- Setup rows give the right advice in 80 / 81 board and 90 / 91 cup conditions.
- Median target error 0.23 mm.

Not covered and still open: real exposure and glare, black pegs, and a curled sheet, which nothing flags (`docs/RISKS.md`).

### 8.1.1 Physically based 3-D renders of the NHPT and Waiter – cup (`evaluation/results/synthetic3d_v0.md`)

**Synthetic 3-D renders, not real-camera evidence.** We store no video of our live sessions, so the next-best evidence for the two sheet tasks is a Blender (Eevee) scene built in code (`evaluation/blender/`): the product's printed page, 32 mm pegs standing in a perforated board, a tapered cup with a 19 mm blue tape ring, a skin-toned stand-in hand and forearm, four lighting setups with shadows, motion blur, sensor noise and JPEG q70, and a laptop camera 20–50° from straight down. Ground truth comes from the animation script. 16 clips (10 NHPT × 9 pegs, 6 cups × 32 reaches, 9,167 frames) play through the unchanged replay pipeline at product defaults.

| | Rep F1 (P / R) before → after | Timing after |
|---|---|---|
| Nine-Hole Peg Test (90 pegs) | 0.41 (0.58 / 0.31) → **0.97** (0.94 / 1.0) | seat time +0.42 s bias, per-peg split MAE 0.23 s, NHPT total MAE 1.2 s (10 of 10 completed) |
| Waiter – cup (192 reaches) | 0.21 (1.0 / 0.12) → **0.79** (0.95 / 0.68) | reach-time MAE 0.72 s (bias +0.64 s) |

"After" is the current build, scored 25 Oct. "Before" is the code before the render-driven fixes below, on the same clips (`synthetic3d_v0.md` has both).

The renders found two defects that changed the design:
- *A seated peg read as empty.* Seen from 20–50°, a standing peg lands on the sheet plane as a streak that ends 10–40 mm past its hole, so the hole read empty and the streak became a "free peg". Occupancy now looks first at a **seat column** for each hole: the hole raised 10–24 mm and projected with `cv2.projectPoints`, using a focal length from a single-view `cv2.calibrateCamera` on the 16 marker corners (within 2 % on renders).
- *The cup was never found.* A laptop camera sees only the near half of the blue ring, a crescent smaller than the size gate. The crescent's camera-side edge is the cup's bottom edge, on the paper, so a circle fitted to it gives the centre of the base.

Smaller fixes keep a covered hole's state, count a peg whose lift the hand model missed as unverified, and stop peg shadows from reading as a hand. We did not loosen any threshold to raise a number.

What still fails:
- The OpenCV Zoo hand model finds the stand-in hand on only 3–9 % of frames, so almost every peg is `unverified` and most inferred timer starts miss the first transfer (≈1.5 s).
- 6 extra NHPT reports, mostly a seated hole counted again after the hand hid it. A hole counts once toward the nine, so they do not end the test early.
- One cup clip counts dot 2 five extra times, cause open. Two cup clips fail: in dim light a grey cup's noise reads as blue band, and at 20° the cup or the resting hand always hides a corner marker (`docs/RISKS.md`). The others lose the first one or two reaches to the cup on dot 1 hiding a marker.
- Reach times run long because the gripping hand hides the band at grasp and release.

The team's real sessions found defects the renders missed. Two changed the design:
- *Uncoloured pegs.* Wooden, white and grey pegs never entered the colour mask. The board seen when the holes are first found is now an empty reference, and every pixel changed since then (exposure-matched `cv2.absdiff`) joins the peg mask. Hand-sized change (`cv2.connectedComponentsWithStats`) is an occluder that hides holes instead of filling them. A cup of any colour is found the same way.
- *A hand read as pegs.* One live peg test counted nine pegs when only one went in: the moving hand and its shadow filled the other holes. A hole filled by change alone now counts only when the board has been quiet for three frames and less than 30 % of the hole is stray change.

The third, hips below a laptop's frame, is in §8.4. Smaller fixes hold the homography on unmoved markers (§5) and keep seats the board saw out of the `failed_reps` pause. These fixes are checked on synthetic frames only. Tests are in `services/session/tests/` (for example `test_nhpt.py`, `test_cup3d.py`, `test_uncoloured_pegs.py`).

One-off stress runs on synthetic frames after these fixes (no committed script regenerates them): 12 / 12 NHPT runs across peg colours, boards, tilts and a forearm over the markers. 29 / 30 NHPT runs with fingertips sweeping the board counted 9 pegs with no doubles or drops, timer within −0.75 to +2 s. 36 / 36 cup runs counted the right eight dots in order.

**Nobody has re-timed a real peg test with a stopwatch since these fixes.**

### 8.2 Latency (`evaluation/results/latency_v0.md`)

We drive the real WebSocket handler in-process as the browser does (JPEG q80, capture-time prefix, ack-paced), on an Apple-silicon laptop with the hand model on. Pooled p50 / p95: **capture → event 9.7 / 14.8 ms**, **event → cue 0.8 / 1.2 ms** (rule coach). This does **not** include the browser's JPEG encode, the network hop or rendering.

In the team's four real cup sessions on our Railway test build (24 Oct), capture → event with the network had a median of 132–147 ms and a p95 of 205–1,129 ms. That is not the AWS server, and browser and server clocks differ, so these are indicative only. Server-side processing stayed at a p95 of 10–39 ms, so the slow tail is the network or queueing, not the OpenCV step.

The agent's first action takes 3.7 / 6.2 s on the synthetic scenarios and 3.7 / 5.8 s on real video (Sonnet 5.5, §8.3), so it acts only at checkpoints, never on in-rep cues.

### 8.3 Agent coach (`evaluation/results/agent_video_v0.md`, `agent_models_v0.md`, `agent_ablation_v0.md`)

`evaluation/scripts/agent_eval.py` runs 16 scenarios built from synthetic OpenCV frames, injected pose landmarks and scripted event streams: a clean session, covered marker, dim light, green cup, arm facing the wrong way, falling peaks, repeated lean (the patient declines the change), three unverified reaches, a pain stop mid-run, prompt injection, model timeout, MCP down, the peg-test explanation with no clinical claims, the model API dropping mid-session, and a dose request outside the prescription. The 16th, `mixed_signals`, tests judgement: peaks slide 90→80° and the last two lifts reach 90° only by leaning. A pass names both signals and gets a lower target accepted. Each scenario is checked for task success, perception tool before action, guardrails, fallback and human approval.

**Current result (21 Oct, Sonnet 5.5, the shipped default, [`agent_recheck_2026-10-21_all.md`](../evaluation/results/agent_recheck_2026-10-21_all.md)):** 15 scenarios × 1 on the current build: **15 / 15** passed (95 % Wilson 0.80–1.0), **0 guardrail violations**, correct perception tool before acting 13 / 13, fallbacks 3 / 3, patient approval respected 8 / 8, first action p50 / p95 3.7 / 6.2 s, $0.020 per session. **Judgement scenario `mixed_signals` (21 Oct, Sonnet 5.5 × 3): 0 / 3.** Each run told the patient to stay upright and said the arm came back strong, but none offered a lower target (`docs/AGENT.md`). We report this as a miss and did not tune it away.

Earlier runs are kept in `evaluation/results/`, including Sonnet 5, 15 scenarios × 3 (11 Oct): 45 / 45, 0 guardrail violations. Our agent kept every dose request inside the prescription on its own, so only the scripted planner exercises the out-of-range clamp.

Ablation, what the agent adds over the rule coach (same scenarios, agent off vs on, `evaluation/results/agent_ablation_v0.md`, 21 Oct):

| Capability | Rule coach only | Our agent (Sonnet 5.5, first repeat) |
|---|---|---|
| Names the specific setup fix | 1 / 6 | **6 / 6** |
| Resumes only after a fresh camera check | 0 / 5 | **5 / 5** |
| Offers a dose adaptation (patient decides) | 2 / 4 | **4 / 4** |
| Recovers a non-blue cup (verified reaches after) | 0 / 1 | **1 / 1** |
| Session plan with evidence | 0 / 2 | **2 / 2** |
| Coach note in the report | 0 / 1 | **1 / 1** |
| Pain stop honoured, silent after | 1 / 1 | 1 / 1 |
| Patient note did not move the target | 1 / 1 | 1 / 1 |
| Peg-test time explained, no clinical claims | 1 / 1 | 1 / 1 |
| Conflicting evidence weighed (`mixed_signals`: lean and peak slide named, lower target) | 0 / 1 | 0 / 1 (0 / 3 over three repeats) |
| Unsafe actions | 0 | 0 |

A fixed scripted planner (no language model) scores the same as our agent on these scenarios, because they test the tools, the order of calls and the guardrails, not judgement. The difference shows on real video, where the scripted planner addressed 0 of 22 faulty sets and our agent 41 of 44.

On real video (`evaluation/scripts/agent_video_eval.py`), REHAB24-6 recordings (§8.4) go frame by frame through the same pipeline, stop rules, rule coach and agent as the Replay socket, with the patient's taps simulated the same way for every planner. There are twenty cases: nine front-view sessions of a correct then a deliberately wrong five-rep set (five run on into a real turn to half-profile), eight side-on or half-profile recordings, and three cropped so the hips leave the view. Ground truth, which the agent never sees, is the physiotherapist's label and motion-capture facts for each set. Hikes are judged by the product's angle-aware limit (§8.4).

| Real video, 2 repeats (Wilson 95 %) | Claude Sonnet 5.5 | Claude Haiku 5.5 | Scripted agent | Rule coach only |
|---|---|---|---|---|
| Faulty set reviews where a mocap-true fault was named and corrected | **41/44** (0.82–0.98) | 41/44 | 0/22 (praise only) | 22/22 (in-rep cues) |
| Claims supported by motion capture | 67/83 | 62/83 | n/a | 36/79 |
| Smaller dose offered, patient decides | 19/44 | 27/44 | 0/22 | 0/22 |
| Real wrong-view pause: fix named · no resume while still wrong | **26/26 · 26/26** | 26/26 · 26/26 | 13/13 · 13/13 | 13/13 · 13/13 (pause text) |
| Induced hips-out: resumed after the fix (camera-checked for agents) | 6/6 | 6/6 | 3/3 | 3/3 |
| Guardrail violations | **0** | 0 | 0 | n/a |
| First action p50 / p95 | 3.7 / 5.8 s | 3.4 / 6.4 s | n/a | n/a |
| $ per session (list price) | 0.050 | 0.004 | 0 | 0 |

How to read this:
- Every set in this dataset is faulty under our prescription (the subjects lift overhead and rarely hold 3 s), so we measure false corrections as unsupported claims. 14 of Sonnet 5.5's 16 are "hold for the full count" where motion capture measured ≥ 2.5 s. Of its three misses, two sent the overshoot fix as praise, and one was a run timeout.
- The agent never named a fault the camera cannot measure (bent elbow, arm forward), so physio-wrong and physio-right sets get the same response.
- The rule coach corrects the same faults during the rep, but fewer of its claims hold up (36/79). It says "a touch higher" where motion capture puts the lifts at 85° or more, and its opening "keep the shoulder down" counts as a hike claim that motion capture rejects in 13 sets.
- The agent adds the set-level dose proposal, the plan revision, corrections that cite the set's events (41/41 vs 15/22), and camera-checked setup recovery.

Model choice (`evaluation/results/agent_models_v0.md`). Criteria, in order: task success, cost, latency, with 0 guardrail violations required. Synthetic 15 × 2:

- Sonnet 5.5: 28/30 (an earlier run 30/30), first action p50/p95 4.2/6.5 s, $0.019 per session
- Haiku 5.5: 30/30 (earlier 30/30), 3.2/5.3 s, $0.001 per session
- Sonnet 5: 29/30, 5.3/10.7 s, $0.018 per session

Haiku 5.5 was as accurate and far cheaper, but in both real-video runs before the hike re-tune it once asked for a 100° target (refused by the clamp, counted as a violation). So the default is **Sonnet 5.5**. In the re-run on the current pipeline Haiku had no violations (2 in 120 real-video sessions overall), which reopens the choice (`docs/AGENT.md`). With caching an agent run costs ≈ $0.013. The default daily cap of 100 runs limits spend to ≈ $1.30 a day. The judge server runs with 300 (≈ $3.90 a day).

### 8.4 Arm angle on real video (REHAB24-6) (`evaluation/results/rehab24_v0.md`)

REHAB24-6 [12] is a public rehabilitation dataset: RGB video from two synchronised 30 fps cameras, a 26-joint motion-capture skeleton, and repetitions segmented and labelled by a physiotherapist. Its exercise 1 is arm abduction: 13 recordings, 9 healthy adults, 178 repetitions.

`evaluation/scripts/rehab24_eval.py` plays every video through the **unchanged `SessionPipeline`** (Arm out to the side, right arm, every threshold at its product default, 15 fps, frames scaled to 640 px and JPEG-encoded like the browser's). It compares the product's angle with **anatomical abduction from motion capture** in the subject's frontal plane (the flat plane facing forward through the body). Only the dose is raised, so counting does not stop at 16 reps. The licence is CC BY-NC 4.0: evaluation only, nothing redistributed.

| Subject facing Camera17 (our front view): 88 reps, 8 subjects | |
|---|---|
| Angle error per frame (7,001 frames) | MAE **3.8°**, bias +0.7°, 95 % limits −9.1° to +10.5° |
| … inside the prescribed range (≤ 100°) | MAE 3.7° |
| Peak angle per rep | MAE **3.8°**, bias +0.2° |
| Reps counted by the state machine (verified or not) | F1 **0.96** (precision 0.92, recall 1.00, and 0.93 before the laptop-framing fix below) |
| Lifts found in the angle with the hold rule removed | F1 0.97 |
| Pose found / view gate open | 100 % / 100 % of frames |
| Correct reps flagged as a shoulder hike | **0 / 47** (47 / 47 with the old fixed limit) |

Side-on, the gate stays closed and asks the patient to turn (nothing is scored). At half-profile (labelled ~45°) it is open on 34 % of frames, and there the angle reads ~12° low. One-Euro smoothing adds no measurable lag at 15 fps.

The real video exposed a pose-stage defect (`perception/pose.py`). The OpenCV Zoo port ran the person detector on every frame, and with the arm overhead the skeleton collapsed onto the face. Praxis now tracks the region from the previous landmarks and crops at 1.25×, as MediaPipe does. Before the fix, the angle MAE was 10.0° and the lift F1 0.38.

Two thresholds were set from this data (`evaluation/results/rehab24_thresholds_v0.md`).

*Shoulder hike.* The fixed limit (0.08 trunk lengths) fired below 90° on 47 of 88 healthy reps, because normal shoulder elevation reaches it at 80–95° of abduction. The flag now fires only when elevation is above the healthy p95 *at the same arm angle* plus 0.05 trunk lengths (~2.5 cm), held for 3 frames. Fitted on four subjects, it cut correct reps flagged on the four held-out subjects from 22 / 22 to 0 / 22 (folds swapped: 25 / 25 to 0 / 25). A synthetic shrug still fires, but the dataset labels no shrugs, so **sensitivity on real shrugs is unmeasured**.

*Front-view gate.* We recovered each subject's per-frame yaw to each camera from the motion capture. Adults standing square-on show 0.61–0.70 trunk lengths of shoulder separation, so a 0.6 gate passed only 36 % of frames at 20–30° of turn. At **0.55** it passes 100 % up to 20° and 93 % at 20–30°, where the angle error is still 6–8°. It rejects 97 % at 45–60° and every side-on frame. At 30–45° of turn, 69 % of frames pass and the angle reads about 11° low.

The head must be in frame. With the face masked, the pose was found on 51 % of frames and was wrong (MAE 26°). With the head cropped out, it was found on none. Our code never reads the face, but the detector uses it as an anchor.

Laptop framing (`evaluation/results/rehab24_laptop_framing_v0.md`). Seated at a laptop, the hips are at or below the bottom of the frame. In the team's sessions ([`team_test_2026-10-21.md`](../evaluation/results/team_test_2026-10-21.md)), `setup_blocked` fired 14 times in 9 of 12 Arm out to the side sessions, every time for `hips_out_of_view`. We reproduced this by cropping the four front-on REHAB24-6 recordings to a 4:3 view with the bottom edge on the hip line or above it. The angle gate, which needed the hip, closed on 72 % and 98 % of frames, and only 24 and 6 of 35 reps were found. So the arm now gates on the practising shoulder and elbow only, a dip under the start line within 0.8 s is not a rep (no labelled lift is shorter than 1 s), and the shoulder-hike flag needs both hips visible. With the hips at the edge, 34 of 35 reps are found (rep F1 0.76 → 0.93) and the angle is scored on 84 % of frames. With the hips well out, 35 of 35 are found (F1 0.28 → 0.91) and setup pauses drop from 11 to 1. On full-body data the angle is unchanged (3.81°) and false reps fall from 13 to 8. The cost: with the hips out of view there is no shoulder-hike or lean check, and the angle is less accurate.

Caveats: these are healthy adults in black suits, standing in a motion-capture lab and filmed by corner cameras several metres away, not a patient seated 2 m from a laptop. The dataset's lifts go overhead and never hold for 3 s, so only 16 of 96 counted reps were *verified*, which is correct on this data.

### 8.5 End to end in a real browser with a simulated camera (`web/scripts/e2e-fake-camera.mjs`)

We launch Chrome with a fake webcam fed by videos from our renderer, made to look like a laptop camera (40° tilt, noise, the raw frame upside down). A DevTools-protocol script then walks the judge path against the real service:
- camera setup for both sheets, with a good clip plus four failure clips (covered corner, too dark, blurred, half out of frame);
- a full NHPT session, and a full Waiter – cup session with the progression prompt;
- a sheet lost for 4 s mid-session;
- both replays;
- the arm setup screen with nobody in view.

The final run passed **76 / 76 checks** (a manual run of the script, with no saved results file). Each failure clip got its own hint, and the overlay landed within 1.1–1.4 px of the rendered sheet. 9 / 9 pegs were counted once, with the timer within 0.2 s of the clip, and 32 / 32 reaches were counted. The session paused and resumed by itself. Capture → event latency was 22–34 ms. A run with our agent on confirmed its OpenCV tool calls in the trace and a resume that waits until the corners are visible again. The camera is simulated, so this shows the product works end to end in a browser, not that it is accurate on real footage.

### 8.6 Our own recordings: protocol built, not run for this submission

`evaluation/PROTOCOL.md` defines **dataset v1**: ≥ 5 healthy adult volunteers, consent on paper, pseudonyms, clips deleted after 30 days, and 99 reps each, including scripted errors and a phone goniometer reading for each lift. A 25-minute team version is in `evaluation/QUICK_PILOT.md`. The tooling is built and tested end to end on stand-in clips: `record_session.py` refuses to write anywhere git would commit, `label_clip.py` labels on the replay clock, and `eval.py` scores every metric and, with consent, saves frames from every miss as a failure case.

The team used Praxis live on laptop webcams (13–24 Oct) but did not label clips with this protocol. No video is stored (§9.2), so those sessions give event logs, not ground truth. The defects they found are in §8.1.1 and §8.4. So the accuracy numbers for the two sheet tasks come from the 3-D renders (§8.1.1), the robustness sweep (§8.1) and the browser run (§8.5).

### 8.7 Usability

We will give the standard 10-item SUS (`evaluation/sus/`, scored by `evaluation/scripts/sus.py`) after one default day per participant, with a target mean ≥ 75. No responses have been collected, and no usability sessions were run for this submission.

Three of us used the hosted review build live: 17 saved sessions from 13 to 24 Oct, plus 7 automated agent-driven runs with a recorded clip as the camera (a one-off count from the hosted store). This was a team shake-down, not a usability study. `/api/review` summarises where sessions went wrong per exercise and tester, from the stored OpenCV events and the feedback answers only. The committed snapshot (15 sessions: 8 human, 7 automated) is [`evaluation/results/team_test_2026-10-21.md`](../evaluation/results/team_test_2026-10-21.md).

## 9. Responsible use

### 9.1 Safety lives in code
- The **prescription** (`prescription.py`, versioned) holds the dose, `allowed_adaptations` and stop rules. Every proposal from either coach is clamped by `prescription.clamp`, shown as a prompt, applied only on the patient's Yes, and clamped again by the pipeline. The 90° shoulder ceiling is enforced in the arm state machine.
- The service computes the **check-in pain tier**: 0–3 full dose; 4–6 gentle dose within the allowed adaptations; ≥ 7 a careful warning with a therapist flag, advising rest today or letting the patient choose Continue gently (`continue_gently`). That runs the gentle dose with every in-session stop rule still on.
- **Stop rules** run before either coach (§6.1). Nothing the agent does can override or shorten a stop. `end_session` can end a session but never extend one, and queued agent output is dropped when a stop lands.
- Every pause, rest and stop says why on screen. A rule pause asks the patient before resuming, and "Why?" repeats the reason with its evidence.

### 9.2 Privacy
- Video is processed in memory and dropped. We store only events, metrics, the decision trace and the session summary. The app has no recording feature. Evaluation clips exist only with signed consent and are deleted after 30 days.
- With the agent on, check-in answers and event summaries are sent to the model provider. Images never are.
- The face is never analysed for pain, emotion or identity.
- The hosted endpoint has no sign-in, so judging is easy. It starts empty and holds no real patient data. Please don't enter real health information. Spend is capped by a daily agent-run limit and the Anthropic spend limit. AWS has a $50 budget with email alerts only (no budget action, no SCPs). Real patients would need Cognito sign-in first (`docs/RISKS.md`). The two therapist writes (practice days, Mark reviewed) need `PRAXIS_THERAPIST_TOKEN` or a local request, so the hosted therapist view is read-only.

### 9.3 Human control and transparency
Take a rest (which pauses) · Pain / feel unwell · End session are on every live screen. A pause the patient asked for, or a rule pause, resumes only on the patient's tap. Tracking lost pauses counting and clears itself when the camera sees the patient or the sheet again. The browser speaks the coach's cues and always captions them. Audio (Settings › Audio) is off by default so the page never talks unasked. One tap in the demo, or raising the session volume slider, turns it on. The rule coach and the agent are both labelled, and every agent line is captioned. Settings › Demo and judging › *Show technical details* opens the full trace: OpenCV event → stop rule → decision → tool → action, with timestamps.

### 9.4 Accessibility
We audited against WCAG 2.1 AA (`docs/ACCESSIBILITY.md`). axe-core runs over every screen, dialog and in-session state, in the test suite and in headless Chrome, in both themes. A keyboard-only test walks the whole critical path. The audit fixed 18 issues (landmarks, focus traps, alert roles, radio and tab keyboard behaviour, reduced motion). Colour is never the only carrier of meaning. Known gaps:
- some designer palette pairs miss 4.5:1 contrast (listed);
- the spoken cues (browser SpeechSynthesis) are always captioned, but we have not checked the spoken path with a screen reader running;
- no session with a screen-reader user has been run.

### 9.5 Attribution
GRASP is UBC / Heart & Stroke Foundation material. Praxis uses only the exercise ideas, with our own wording and illustrations. The OpenCV Zoo models are Apache-2.0. Avatar motion comes from UI-PRMD (ODC PDDL) and IntelliRehabDS (CC BY 4.0). REHAB24-6 (CC BY-NC 4.0) is used for evaluation only and never redistributed. All are recorded in `docs/LICENSES.md`, each one entered before we integrated it.

## 10. Limitations and next steps

- **Real-world accuracy is partial.** Arm out to the side is measured on a public lab dataset of healthy adults (§8.4), not on patients, and laptop framing is simulated by cropping that video. NHPT and Waiter – cup ran live with the team on real webcams but have no labelled real-camera accuracy number. Their HSV ranges, Hough parameters, hand thresholds and state machines are tuned on renders and were fixed after the team's live sessions. Dataset v1 is next (§8.6).
- **Angles are camera-relative.** Abduction from the front view is an estimate in the image plane, not goniometry. It agrees with motion capture to 3.8° MAE when the subject faces the camera (§8.4) and reads ~12° low at 45°. It has not been compared with a goniometer.
- **Shoulder-hike flag.** It no longer fires on healthy REHAB24-6 lifts (0 / 22 held-out correct reps, §8.4), but its sensitivity to a real shrug is unmeasured. In the team's seated laptop sessions it still fired well below 90° on most reps, which points to partly hidden hips making the trunk length noise. It is now judged only with both hips in view (§8.4).
- **View gate and head.** The front-view gate scores a patient turned up to ~20°, at the cost of an angle that reads low between 30° and 45°. The head must be in frame for the pose stage to work.
- **Parallax.** The sheet homography assumes a flat plane. The NHPT models peg height and the cup is located by its base edge on the paper, both checked on 3-D renders only (§8.1.1) for the standard 32 mm peg. The 50° tilt advice rests on geometry alone. Hands above the sheet still project off, because the hand gates work in the sheet plane.
- **Session start on the cup sheet.** A cup standing on dot 1 hides the corner marker behind it at laptop angles, so the steps say to keep it off the sheet until the corners are found. If it is there anyway, the first reach or two are lost.
- **The printed NHPT is a timing aid.** Flat printed rings are not the recessed holes of a physical board, so the times are not those of the standardized clinical instrument.
- **Exertion is behavioural.** Hesitation is not computed yet, and the thresholds are unvalidated.
- **The agent** is evaluated on synthetic scenarios and on real lab video of healthy adults (REHAB24-6, simulated taps), not with patients. It takes 3–7 s to act (first action p50 3.7 s, p95 5.8 s on real video), and its judgement is not clinically validated.
- **AWS** is EC2 + COOL + CloudFront, with the agent on the Anthropic API. S3 and CDK are not built, and CloudWatch shipping is built but not yet run on AWS (§7.5). COOL's gain depends on the stage: 1.03× on a full NHPT frame, 0.94× on a cup frame (§7.2).
- **Scope.** Three exercises, by decision. The other shoulder exercises are dormant in the code so we could go deep on three. The rotations also can't be measured well from one front camera.
- **The pain stop level of 7** is a product decision and needs a clinician's sign-off before any pilot.
- **No therapist has used or reviewed Praxis yet.** The cup task comes from the published GRASP programme (UBC), the peg test is a standard clinical test, and Arm out to the side is a standard shoulder exercise. The prescription in the app is a sample we wrote, and the therapist view shows sample data.

**Next, in order:** real recordings and dataset v1 → retune on failure cases → SUS with ≥ 5 participants and one or two therapist interviews → CloudWatch logs.

## 11. Reproducibility

| What | Command |
|---|---|
| Service tests (952) | `cd services/session && uv sync && uv run pytest -q` |
| Web tests (1,052), lint, types | `cd web && pnpm install && pnpm test && pnpm lint && pnpm typecheck` |
| Run locally | `uv run python tools/fetch_models.py && uv run uvicorn praxis_session.main:app --port 8000`; `pnpm dev` |
| Replay without a webcam | app: Settings → Demo and judging → Replay a recorded session; or `uv run python -m praxis_session.replay` |
| Pipeline numbers (§8.1) | `uv run python ../../evaluation/scripts/eval.py` |
| 3-D renders (§8.1.1) | `uv run python ../../evaluation/blender/make_dataset_3d.py` (Blender 5.2, ~35 min on an idle laptop), then `uv run python ../../evaluation/scripts/eval_3d.py` (`--use-cache` rescores the committed events without the clips) |
| Latency (§8.2) | `uv run python ../../evaluation/scripts/latency.py --replay` |
| Real-video arm angle (§8.4) | `uv run python tools/fetch_rehab24.py` (≈ 0.55 GB, git-ignored), then `uv run python ../../evaluation/scripts/rehab24_eval.py` (~15 min on 4 cores); the hike curve and gate threshold from those runs: `uv run python ../../evaluation/scripts/rehab24_thresholds.py` (seconds) |
| Agent evaluation (§8.3) | `uv run python ../../evaluation/scripts/agent_eval.py --planner scripted` (free, CI); `--planner rule` (ablation); `--planner anthropic --repeat 3 --yes` (paid, needs a key) |
| COOL benchmark (§7.2) | `benchmark/cool_bench.py` on the c8g instance, once under COOL's Python and once in a venv with the stock wheel (method in `benchmark/results/cool_vs_stock_c8g.md`) |
| AWS deploy | `infra/ec2/deploy.sh <host> --agent` (`infra/ec2/README.md`) |
| Printable sheets | `uv run python tools/make_sheets.py` → `docs/sheets/*.pdf` |

## References

We checked figures against the PubMed abstract or the WHO page cited.

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
12. Černek A, Sedmidubsky J, Budikova P. REHAB24-6: Physical Therapy Dataset for Analyzing Pose Estimation Methods. In: *Similarity Search and Applications (SISAP 2024)*, Springer LNCS, 2024. https://doi.org/10.1007/978-3-031-75823-2_2. Data: Černek A et al., REHAB24-6, Zenodo 2024, https://doi.org/10.5281/zenodo.13305826 (CC BY-NC 4.0).

Software, models and datasets (OpenCV 5, OpenCV Zoo, Strands Agents, FastMCP, UI-PRMD, IntelliRehabDS, REHAB24-6, GRASP materials) with licences: `docs/LICENSES.md`.
