# Praxis — Technical Report

> Status: **Phase 0–2 (16 Sep 2026)**. Every section is filled in the same commit that ships the feature it describes. Anything simulated, rule-based or fallback is labeled here, in the UI, and in the trace.

## 1. Problem and clinical framing
Adherence and coaching aid for therapist-prescribed upper-limb rehab at home. Not a medical device. The therapist prescribes; the coach proposes within the prescription; hard-coded stop rules override the coach. Three camera-coached tasks (NHPT, Waiter – cup, Arm to the front); all other GRASP exercises are instructions-only.

## 2. System architecture
One Python 3.12 process: FastAPI + WebSocket frame ingest (640×480 JPEG from the browser) → OpenCV 5 perception → stop rules → coach (rule-based first, Strands/Bedrock agent in W6) → JSON events, captions, overlay geometry back to the browser. Raw frames never leave the process. Design: `docs/superpowers/specs/2026-09-16-praxis-rebuild-design.md`.

### 2.1 What is built as of this report
| Component | State |
|---|---|
| `GET /health`, `GET /events`, `WS /session?mode=heartbeat` | built, tested |
| Event ring + `events.schema.json` contract validator | built, tested |
| Sheet geometry (`board_spec.py`) + printable PDFs (`tools/make_sheets.py`) | built, tested |
| Synthetic camera-frame renderer (`perception/synth.py`) | built, tested |
| ArUco → homography calibration, refuse until four markers | built, tested on synthetic frames |
| Setup quality checks (lighting, steadiness, task area, presence fallback) | built, tested on synthetic frames |
| Pipeline `calibrate` mode, perception-lost/regained events | built, tested |
| Web: shell, tokens (light/dark), primitives, webcam → WS hook, Live indicator | built, tested |
| Web screen 05 Camera setup with gated checklist and overlay | built, tested; manual browser check done without camera permission |
| Board state (warp, cached Hough holes, HSV/contour occupancy, masked template score, free pegs) | built, tested on synthetic frames |
| Peg FSM (six states, debounce, wrong hole, drop) and NHPT timer with splits | built, tested on scripted observations |
| Pipeline `nhpt` mode: `frame` events with overlay geometry + FSM/NHPT events; FSM frozen on perception loss | built, tested |
| Replay mode (`python -m praxis_session.replay`) | built, tested on the synthetic clip |
| Web screen 07 Live NHPT (overlay, board view, elapsed, dots, captions, controls, trace) + assessment result | built, tested |
| Evaluation dataset_v0 (synthetic) + scorer (rep F1, NHPT MAE) | built; **no real recordings yet** |
| Hand; cup; pose; avatar; exertion; stop rules; coach; trace decisions; store; other screens | not started (Phases 3–8) |
| Agent on Bedrock, AWS, COOL | deferred (W6) |

## 3. Perception (OpenCV 5.0.0, `opencv-python-headless==5.0.0.93`)

### 3.1 Sheets and calibration (ArUco → homography → mm)
`perception/board_spec.py` is the single source of truth for both printed sheets: the NHPT board sheet (A4 portrait, ArUco DICT_4X4_50 ids 0–3 of 40 mm at known centres, nine 10 mm hole rings at 32 mm pitch) and the Waiter – cup target sheet (A4 landscape, same markers, five 20 mm dots on a 250 mm-radius arc spanning ±26°, ~219 mm chord). `perception/render.py` draws the canonical sheet with `cv2.aruco.generateImageMarker` and `cv2.circle`; `tools/make_sheets.py` writes `docs/sheets/*.pdf` at true scale.

`perception/calibration.py`: `cv2.aruco.ArucoDetector` with sub-pixel corner refinement finds the four markers; their 16 corners (sheet mm from the spec) go to `cv2.findHomography` (frame px → sheet mm). `calibrated` is only true with all four markers present; the event carries the missing ids, per-marker corners, and the RMS reprojection error. On synthetic frames (`perception/synth.py`: pinhole projection with tilt 20°, yaw 8°, Gaussian noise σ 3) the RMS is about 0.2 mm and target positions round-trip within 0.5 mm. **Real-camera accuracy is unmeasured** until Phase 2's first recording.

### 3.2 Setup quality checks
`perception/quality.py` feeds the five rows of wireframe screen 05: camera permission (browser-side), one person in view, hand and task area in view (all targets project inside the frame with a 16 px margin), sheet found (all four markers), lighting and steady tracking (mean luma 60–200, variance of Laplacian ≥ 40, mean marker-corner jitter < 2 px over 10 frames). "One person in view" is a **frame-difference motion fallback** (`method: frame_difference`) until the pose model lands in Phase 5; it is not a required check for Continue.

### 3.3 Pipeline and events
`pipeline.py` composes calibration and quality per frame into `calibration`, `quality`, `setup_checks` events (validated against `events.schema.json`). Five consecutive uncalibrated frames after a calibrated one emit `perception_lost` (with missing ids); recovery emits `perception_regained`. One pipeline per WebSocket connection; frames are dropped after processing.

### 3.4 Board state (warp, Hough holes, HSV pegs, masked template)
`perception/board.py`. `cv2.warpPerspective` maps the frame through the calibration homography to a canonical 3 px/mm top-down view of a 140 mm square around the hole grid. Holes are found once with `cv2.HoughCircles` and cached; each circle is snapped to the nearest expected hole (≤ 4 mm) and any hole Hough misses falls back to the spec position (`hole_source` = hough | mixed | spec is reported in every event). Pegs are segmented in HSV (`cv2.inRange`, S ≥ 90, V ≥ 60, morphological open) and blobbed with `cv2.findContours`; occupancy per hole is the fraction of peg mask inside the hole disc (≥ 0.35 → occupied), and a masked `cv2.matchTemplate` (TM_CCORR_NORMED) score against a synthetic empty-hole template is logged alongside. Free pegs (blobs not in any hole) are reported in mm. **Limitation:** the HSV range assumes saturated pegs on a white sheet and printed holes are flat rings; both must be re-tuned on the physical board (Phase 2 real recording, still pending).

### 3.4.1 Peg FSM and NHPT timing
`perception/peg_fsm.py`: `at_source → grasped → in_transit → over_target → seated → hand_clear`. Occupancy is debounced (N consecutive frames). Grasp = a free peg disappears; in-transit = a free peg or the hand is > 20 mm from where it was picked up; over-target = a free peg or hand within 10 mm of an empty hole; seated = a hole becomes occupied; hand-clear = hand > 25 mm from the hole (or, without hand landmarks, no free peg within 15 mm for `clear_frames`). Events: `state_change`, `rep_complete` (with grasp/seat/clear timestamps), `wrong_hole`, `drop` (a free peg stationary for 1.5 s without hand data, 0.3 s when the hand is visibly away). Hand landmarks are optional inputs today (Phase 3).
`perception/nhpt.py` runs the FSM in any-hole mode: the timer starts at the first `grasped` transition and stops at the ninth `seated`; per-peg splits are seated-to-seated. The FSM keeps running after completion so the final `rep_complete` still fires.

### 3.4.2 Pipeline, events, replay
`pipeline.py` mode `nhpt` emits one `frame` event per frame (calibrated flag, NHPT snapshot, occupancy, hole/marker geometry in frame pixels, suggested next hole) plus every FSM/NHPT event; the FSM is not stepped while uncalibrated, and the Phase 1 perception-lost/regained logic applies. `replay.py` drives the identical pipeline from a video with timestamps from the file fps, so results are deterministic.
### 3.5 Hand (ONNX via `cv2.dnn`) — Phase 3 (not started; license recorded before download)
### 3.6 Waiter – cup — Phase 4 (not started)
### 3.7 Pose and Arm to the front — Phase 5 (not started)
### 3.8 Exertion context — Phase 7 (not started)

## 4. Coach
Phase 7: rule-based coach labeled "Rule-based coach · LLM agent pending"; W6: Strands agent on Bedrock behind the same interface. Actions `instruct | correct | progress | regress | rest | stop`; guardrails in code; every decision logged event → decision → tool → action.

## 5. AWS deployment
Deferred to W6. `PRAXIS_CLOUD_ENABLED` (default 0) gates every cloud call.

## 6. Evaluation
Metrics: rep F1, NHPT MAE, reach-time MAE, angle error vs goniometer app, compensation detection rate, event-to-cue latency p50/p95, scripted coach scenarios, SUS.

### 6.1 dataset_v0 (16 Sep 2026) — synthetic only
`evaluation/results/dataset_v0.md`, regenerated by `evaluation/scripts/eval.py`. One OpenCV-rendered NHPT clip (perspective tilt/yaw, Gaussian noise, mp4v, scrambled hole order). Rep F1 = 1.0 (9/9), NHPT absolute error = 0.0 s. **These numbers validate the replay pipeline, not real-world accuracy**: no real lighting, hands, shadows or pegs are involved. Real recordings (first NHPT run on the printed sheet, then 300+ reps / ≥ 5 participants) are Phase 2's open item and Phase 9's work.

## 7. COOL benchmark
W6.

## 8. Privacy and safety
Video processed in memory only; never stored by default. Only events, metrics, logs leave the device. Clips only with explicit consent, 30-day deletion. Feeling is self-reported, never read from the face; face analysis limited to presence.

## 9. Limitations and honest scope
Exercise ceiling: NHPT, Waiter – cup, Arm to the front. Angles are camera-relative progress, not goniometry. NHPT is a timing aid, not a clinical instrument. Everything so far is validated on synthetic renders only.

## 10. Reproducibility
Every number in §6–7 will be regenerated by scripts in `evaluation/` and `benchmark/`.
