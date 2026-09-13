# Praxis — Technical Report

> Status: **stub, Week 1 (13 Sep 2026)**. Every section is filled in the same commit that ships the feature it describes. Anything simulated is labeled here, in the UI, and in the trace.

## 1. Problem and clinical framing
Adherence and coaching aid for therapist-prescribed upper-limb rehab at home. Not a medical device. Therapist prescribes; agent coaches within the prescription; hard-coded stop rules override the agent.

## 2. System architecture
One Python 3.12 process: FastAPI + WebSocket frame ingest → OpenCV 5 perception → FastMCP servers (`perception`, `exertion`) → Strands agent (Claude on Bedrock). Managed tools: arm64 Lambda behind AgentCore Gateway. See `architecture.svg` (TODO W2) and `agent_workflow.mmd` (TODO W3).

Edge/privacy mode (laptop) is the default. Cloud/judge mode runs the same container-equivalent code under systemd on a Graviton c8g EC2 instance launched from the COOL AMI (OpenCV 5.0 / COOL 3.1, `/opt/cool`). **Not ECS**: earlier planning mentioned ECS; that is superseded because COOL's tuned OpenCV build lives on the AMI, not in a container image.

### 2.1 What is built as of this report
| Component | State |
|---|---|
| `GET /health`, `WS /session` heartbeat | built, tested |
| Event ring buffer (`praxis_session.events`) | built, tested |
| Web: nav, CAM ON, webcam→WS hook, Home | built, tested |
| CDK: 4 empty stacks, synth in CI | built, **not deployed** |
| Calibration (ArUco → homography), board state, pegboard FSM, NHPT | built, tested on synthetic renders (§3) |
| Per-frame pipeline with perception-loss pause, overlay geometry | built, tested |
| Replay mode (`python -m praxis_session.replay`) | built, tested on synthetic MP4 |
| Web session screen v0 (overlay, state, reps, timer, Stop/Pain, trace) | built, tested |
| Evaluation scripts + dataset_v0 (synthetic only) | built; **no real recordings yet** |
| Agent, Bedrock, Lambda, hand/pose, exertion, arm exercises | not started (W3–W4) |

## 3. Perception (OpenCV 5.0.0, `opencv-python-headless==5.0.0.93`)
### 3.1 Calibration (ArUco → homography → mm)
`perception/calibration.py`. `cv2.aruco.ArucoDetector` (DICT_4X4_50, sub-pixel corner refinement) finds markers 0–3 whose 40 mm squares sit at known sheet coordinates (`perception/board_spec.py`, the single source of truth that also generates `docs/board.pdf`). The 16 corner correspondences go to `cv2.findHomography` (frame px → sheet mm). `calibrated` is only true with all four markers visible; the event payload carries the missing ids, the homography, and the RMS reprojection error (sub-millimetre on synthetic frames). Tested on rendered, perspective-warped, noise-free boards; real-camera accuracy is unmeasured until dataset_v0 has real clips.

### 3.2 Board state (warp, Hough holes, HSV pegs, masked template)
`perception/board.py`. `cv2.warpPerspective` maps the frame to a canonical 3 px/mm top-down view of a 140 mm square around the board centre. Holes are found once with `cv2.HoughCircles` and cached; each circle is snapped to the nearest expected hole (≤ 4 mm) and any hole Hough misses falls back to the spec position (`hole_source` = hough | mixed | spec is reported in every event). Pegs are segmented in HSV (`cv2.inRange`, S ≥ 90, V ≥ 60, morphological open) and blobbed with `cv2.findContours`; occupancy per hole is the fraction of peg mask inside the hole disc (≥ 0.35 → occupied), and a masked `cv2.matchTemplate` (TM_CCORR_NORMED) score against a synthetic empty-hole template is logged alongside for the trace. Free pegs (blobs not in any hole) are reported in mm. Limitation: the HSV range assumes saturated pegs on a white sheet; it must be re-tuned on the physical board and lighting (W2).

### 3.3 Pegboard FSM and NHPT timing
`perception/pegboard_fsm.py`. States `at_source → grasped → in_transit → over_target → seated → hand_clear`. Occupancy is debounced (N consecutive frames). Grasp = a free peg disappears; in-transit = a free peg or the hand is > 20 mm from where it was picked up; over-target = a free peg or hand within 10 mm of the target hole; seated = the target hole becomes occupied; hand-clear = hand > 25 mm from the hole (or, without hand landmarks, no free peg within 15 mm for `clear_frames`). Events: `state_change`, `rep_complete` (with grasp/seat/clear timestamps), `wrong_hole` (non-target hole occupied while carrying; the FSM waits for the correction), `drop` (a free peg stationary for 1.5 s without hand data, 0.3 s when the hand is visibly away). Hand landmarks are optional inputs today (W4 integrates the model); every rule works on occupancy + free-peg geometry alone.
`perception/nhpt.py` runs the same FSM in any-hole mode: the timer starts at the first `grasped` transition and stops at the ninth `seated`; per-peg splits are seated-to-seated. The FSM keeps running after completion so the final `rep_complete` still fires.

### 3.4 Pipeline, events, replay
`pipeline.py` composes 3.1–3.3 per frame, emits a `frame` event (calibration flag, FSM/NHPT snapshot, occupancy, overlay geometry in frame pixels) plus every FSM event into an in-process `EventRing` (the buffer the `perception` MCP server will read) and over the WebSocket. Missing markers for 5 consecutive frames → `perception_lost` (with the missing ids), the FSM is frozen, and the UI shows why; `perception_regained` resumes. `replay.py` drives the identical pipeline from a video file with timestamps derived from the file fps, so results are deterministic.
### 3.5 Hand and pose (ONNX via `cv2.dnn`)
TODO W4. Licenses recorded in `LICENSES.md` before integration.
### 3.6 Exertion context
TODO W4. Behavioural fatigue index; rPPG is P1 and, if present, labeled.

## 4. Agent
TODO W3. Actions `instruct | correct | progress | regress | rest | stop`; guardrails in code; every decision logged event → decision → tool call → action.

## 5. AWS deployment
TODO W5. Deferred: nothing is deployed as of Week 1. Feature flag `PRAXIS_CLOUD_ENABLED` gates every cloud call so edge mode never depends on AWS.

## 6. Evaluation
Metrics: rep F1, NHPT MAE, angle error, compensation detection rate, event-to-voice latency p50/p95, scripted agent scenarios, SUS.

### 6.1 dataset_v0 (13 Sep 2026) — synthetic only
`evaluation/results/dataset_v0.md`, regenerated by `evaluation/scripts/eval_dataset_v0.py`. Two OpenCV-rendered clips (perspective jitter + Gaussian noise, mp4v): NHPT with scrambled hole order and a 20-rep pegboard sequence. Rep F1 = 1.0 (29/29), NHPT absolute error = 0.0 s (17.0 s labeled vs 17.0 s predicted). **These numbers validate the replay pipeline, not real-world accuracy**: no real lighting, hands, shadows or pegs are involved. Real recordings (≥ 1 pegboard 20-rep + 1 NHPT, then 300+ reps / ≥ 5 participants) are the W2–W5 work.

## 7. COOL benchmark
TODO W5. Classical stage only; c8g COOL vs c8g stock vs optional c7i; fps, p50/p95, cost per 1k frames, COOL version, AMI ID, instance type, region.

## 8. Privacy and safety
Video processed in memory only; never stored by default. Only events, metrics, logs leave the device. Clips only with explicit consent, 30-day deletion. Face analysis limited to presence + disclosed attention proxy.

## 9. Limitations and honest scope
Exercise ceiling: shoulder flexion, shoulder abduction, pegboard transfer, NHPT. Angles are camera-relative progress, not goniometry. Wider GRASP library is design vision only.

## 10. Reproducibility
Every number in §6–7 is regenerated by scripts in `evaluation/` and `benchmark/`.
