# Praxis — Architecture

Three diagrams for judges: (1) the whole system, (2) the OpenCV 5 pipeline per exercise, (3) one concrete agent loop where OpenCV output changes what the agent does next. Every module and function named here exists in `services/session/praxis_session/` as of 10 Oct 2026.

**Legend.** Solid boxes and arrows are built and tested. **Dashed boxes and arrows are planned for W6 (14–20 Oct) and do not exist yet**: there is no EC2 instance, no Bedrock run, no CDK app, no S3 bucket and no COOL benchmark. The `infra/`, `benchmark/` and `services/tools-lambda/` folders listed in `CLAUDE.md` §2 are not in the tree yet.

## 1. System architecture

```mermaid
flowchart LR
    subgraph BROWSER["Browser · React 19 + TS + Vite"]
        CAM["Webcam<br/>640×480 JPEG, ack-paced, 12 fps ceiling<br/>8-byte capture-time prefix"]
        UI["Screens 03–11<br/>captions, prompts Yes / Not yet,<br/>Pause · Take a rest · Pain · End"]
        AV["Three.js avatar<br/>Blender GLB + AnimationMixer<br/>reference only, never scores"]
        TR["Show trace panel<br/>Settings › Show technical details"]
    end

    subgraph SVC["Session service · one Python 3.12 process · FastAPI (main.py)"]
        WS["WS /session (alias /ws/session)<br/>frames decoded with cv2.imdecode,<br/>drop-oldest, thread pool"]
        RP["Replay mode<br/>?replay=clip id · cv2.VideoCapture<br/>same pipeline, no webcam"]
        subgraph PIPE["SessionPipeline (pipeline.py) · OpenCV 5.0.0"]
            CAL["Calibrator: cv2.aruco + findHomography<br/>+ solvePnP tilt"]
            BRD["BoardState: warpPerspective,<br/>HoughCircles, HSV inRange,<br/>findContours, matchTemplate"]
            CUP["CupSheetState + CupFSM"]
            HND["HandTracker: cv2.dnn<br/>palm + hand-landmark ONNX"]
            POS["PoseTracker: cv2.dnn<br/>person + pose ONNX, OneEuro"]
            FSM["PegFSM / NHPT · CupFSM · ArmFSM"]
        end
        CS["CoachSession (session.py)"]
        EX["Exertion (exertion.py)<br/>behavioural index"]
        SR{"StopRules (stop_rules.py)<br/>run first, always"}
        RC["RuleCoach (coach/rules.py)<br/>every in-rep cue"]
        subgraph AG["Agent coach (built; off by default)"]
            AC["AgentCoach (coach/agent.py)<br/>at checkpoints only"]
            PL["StrandsPlanner · Claude Sonnet 5<br/>Anthropic API (dev) today"]
            MCP["FastMCP 3.4 servers in-app<br/>/mcp/perception · /mcp/exertion · /mcp/coach"]
            TL["agent/tools.py<br/>14 tools, guardrails, clamps"]
        end
        TRC["Trace (trace.py)<br/>traces/&lt;id&gt;.jsonl · GET /api/trace"]
        DB[("SQLite Store (store.py)<br/>patients, prescriptions vN,<br/>sessions, events, flags")]
    end

    CAM -->|"JPEG over WebSocket"| WS
    WS --> PIPE
    RP --> PIPE
    CAL --> BRD --> FSM
    CAL --> CUP --> FSM
    HND --> FSM
    POS --> FSM
    PIPE -->|"JSON events + overlay geometry,<br/>never pixels"| CS
    CS --> EX --> SR
    SR -->|"stop / pause / rest + therapist_flag"| CS
    SR --> RC
    CS -->|"checkpoint"| AC
    AC --> PL -->|"MCP streamable HTTP"| MCP --> TL
    TL -->|"check_setup / recalibrate<br/>on latest frame in memory"| PIPE
    TL -->|"intents, drained by socket loop,<br/>stop re-checked"| CS
    CS --> TRC
    CS -->|"on feedback"| DB
    CS -->|"events, captions, prompts"| UI
    TRC --> TR
    UI -->|"answer, pain, pause, commands"| WS

    subgraph AWS["AWS · planned W6, NOT BUILT"]
        EC2["c8g Graviton EC2<br/>from the COOL AMI (OpenCV 5 / COOL)<br/>service under systemd"]
        BR["Amazon Bedrock<br/>Claude via BedrockModel"]
        S3["S3: event logs, traces,<br/>reports, consented clips only"]
        CW["CloudWatch logs + metrics"]
        CDK["AWS CDK (TypeScript)<br/>one-command deploy"]
        MORE["Polly · Cognito · DynamoDB ·<br/>Lambda arm64 + AgentCore Gateway"]
    end

    SVC -.->|"same container, cloud mode"| EC2
    PL -.->|"PRAXIS_AGENT=bedrock<br/>needs PRAXIS_CLOUD_ENABLED=1"| BR
    TRC -.-> S3
    DB -.->|"same schema"| MORE
    SVC -.-> CW
    CDK -.-> EC2

    classDef planned stroke-dasharray: 6 4,stroke:#A15C00,fill:#FFF8EC,color:#5A3A00
    class EC2,BR,S3,CW,CDK,MORE planned
    style AWS stroke-dasharray: 6 4,stroke:#A15C00,fill:#FFFDF8
```

**What runs where today.** Edge mode: everything above the AWS box runs on one laptop (`uv run uvicorn praxis_session.main:app`), or in one container (`services/session/Dockerfile`) hosted on Railway for team review. On the laptop no frame leaves the machine; on Railway frames travel over TLS to the container and are processed in memory and dropped (`docs/RISKS.md`, 17 Sep row). `PRAXIS_CLOUD_ENABLED` defaults to `0` and gates every cloud call; the `bedrock` planner refuses to start without it (`agent/model.py` `load_config`).

**Agent status.** The agent coach is built (29 Sep) and is off by default (`PRAXIS_AGENT=off`). It has been tested offline with `ScriptedPlanner` (CI) and, as of 10 Oct, is being run against real Claude through the Anthropic API (dev key). The Bedrock path (`BedrockModel`) is constructed and unit-tested but has never been called.

> **Real model (10 Oct 2026, Claude Sonnet 5 via the Anthropic API, dev):** 9/9 scenarios on each of four consecutive full runs, correct perception tool before action 7/7, 0 guardrail violations, fallback 2/2, human approval 5/5, checkpoint → first action p50 / p95 ≈ 3.9 / 6.3 s, ~19.7k tokens and ~$0.39 per full run (`evaluation/results/agent_v0_anthropic.md`, traces `traces/agent/anthropic/`). Bedrock not run yet.

## 2. OpenCV 5 pipeline per exercise

`SessionPipeline.process(frame_bgr, t, frame_index)` picks the mode the socket was opened with. Each mode returns one `frame` event per frame (overlay geometry in frame pixels, never pixels themselves) plus the state-machine events below. Module docstrings note `cv2.__version__` (5.0.0, `opencv-python-headless==5.0.0.93`).

```mermaid
flowchart TB
    IN["JPEG bytes → cv2.imdecode → BGR frame"]

    subgraph SHEET["Shared by the two sheet tasks · perception/calibration.py + quality.py"]
        A1["cv2.cvtColor BGR→GRAY"]
        A2["cv2.aruco.ArucoDetector.detectMarkers<br/>DICT_4X4_50 ids 0–3, CORNER_REFINE_SUBPIX"]
        A3["cv2.findHomography px → sheet mm<br/>4 markers fresh · 3 markers cv2.RANSAC partial · else held ≤ 1.5 s"]
        A4["cv2.solvePnP SOLVEPNP_IPPE + cv2.Rodrigues<br/>camera tilt_deg, setup gate ≤ 25°"]
        A5["quality: cv2.Laplacian sharpness, mean luma,<br/>marker jitter, task area in view"]
        A1 --> A2 --> A3 --> A4
        A3 --> A5
    end

    subgraph NHPT["Nine-Hole Peg Test · perception/board.py, peg_fsm.py, nhpt.py"]
        N1["BoardState.warp: cv2.warpPerspective<br/>canonical 3 px/mm"]
        N2["detect_holes: cv2.GaussianBlur + cv2.HoughCircles<br/>once, cached, snapped to spec"]
        N3["peg_mask: cv2.cvtColor HSV + cv2.inRange<br/>minus skin band, minus hand box"]
        N4["peg_blobs: cv2.findContours + cv2.moments"]
        N5["hole_scores: disc fraction,<br/>masked cv2.matchTemplate TM_CCOEFF_NORMED tie-break"]
        N6["PegFSM at_source → grasped → in_transit →<br/>over_target → seated → hand_clear · NHPT timer"]
        N1 --> N2 --> N5
        N1 --> N3 --> N4 --> N6
        N5 --> N6
    end

    subgraph CUPS["Waiter – cup · perception/cup.py"]
        C1["CupSheetState.warp: cv2.warpPerspective<br/>canonical 2 px/mm"]
        C2["cup_mask: HSV cv2.inRange<br/>+ cv2.morphologyEx MORPH_OPEN"]
        C3["cup_mm: cv2.findContours + cv2.contourArea<br/>+ cv2.moments → base centroid mm"]
        C4["CupFSM at_dot → lifted → in_transit →<br/>over_dot → placed → hand_clear"]
        C1 --> C2 --> C3 --> C4
    end

    subgraph HANDS["Hand (NHPT + cup) · perception/hand.py, zoo/"]
        H1["cv2.dnn.readNet palm_detection_mediapipe_2023feb.onnx<br/>+ cv2.dnn.NMSBoxes"]
        H2["cv2.warpAffine crop → cv2.dnn<br/>handpose_estimation_mediapipe_2023feb.onnx → 21 landmarks"]
        H3["cv2.perspectiveTransform → sheet mm<br/>pinch, SPARC, tremor FFT"]
        H1 --> H2 --> H3
    end

    subgraph ARM["Arm out to the side · perception/pose.py, arm_fsm.py"]
        P1["cv2.dnn person_detection_mediapipe_2023mar.onnx<br/>+ cv2.dnn.NMSBoxes"]
        P2["cv2.warpAffine crop → cv2.dnn<br/>pose_estimation_mediapipe_2023mar.onnx → 33 landmarks"]
        P3["shoulder_elevation_deg, trunk lean, shoulder hike<br/>OneEuro filter"]
        P4["ArmFSM start_pose → moving → target_reached → hold → return<br/>view gate turn_front, 90° ceiling in code"]
        P1 --> P2 --> P3 --> P4
    end

    IN --> A1
    IN --> H1
    IN --> P1
    A3 --> N1
    A3 --> C1
    H3 --> N6
    H3 --> C4

    N6 --> EN["nhpt_start · state_change · rep_complete verified/reason ·<br/>wrong_hole · drop · nhpt_complete total_s, splits_s"]
    C4 --> EC["state_change · reach_complete reach_ms, verified/reason ·<br/>wrong_dot · arc_complete · cup_complete"]
    P4 --> EA["exercise_start · state_change · rep_complete peak_deg ·<br/>target_missed · hold_too_short · compensation_lean ·<br/>shoulder_hiking · set_complete · arm_complete"]
    A3 --> EP["calibration source fresh/partial/held · setup_checks ·<br/>perception_lost after 20 uncalibrated frames · perception_regained"]
```

Notes that keep the diagram honest:

- A rep the camera could not check is **unverified, not failed**: `reach_complete` with `cup_occluded` or `marker_lost`, NHPT `rep_complete` with `no_hand_near_hole`. Performance misses (`target_missed`, `hold_too_short`) are a separate count.
- Arm angles are image-plane, camera-relative progress numbers, **never goniometry**. Abduction from the front view cannot be told apart from a scaption-plane lift.
- Every threshold above was tuned on synthetic renders (`perception/synth.py`) and synthetic landmark streams. Real-camera accuracy is unmeasured until dataset v1 (`docs/PLAN.md` Phase 9).
- The hidden exercises (Pendulum, Arm to the front, Rotate out, Rotate in) still have code in `ArmFSM` and the registry, but `visible: False` keeps them off every screen and the socket refuses them (`not_offered`).

## 3. Agent workflow: one perception → decision → action loop

The diagram traces the committed scenario `evaluation/agent/scenarios/covered_marker.json` (trace `traces/agent/covered_marker.jsonl`, scripted planner): the scenario hides ArUco marker 2 in the frame the tools see and feeds three `reach_complete` events marked unverified (`marker_lost`). In a live session `marker_lost` means fewer than three markers for more than 1.5 s; a single covered marker is ridden through with a three-marker RANSAC fit. Stop rules pause the session before the agent sees anything. The agent then runs OpenCV on the latest frame, says the specific fix, recalibrates, and asks the patient whether to resume. Only the patient's "Yes" resumes the session.

```mermaid
sequenceDiagram
    autonumber
    actor P as Patient
    participant B as Browser
    participant PL as SessionPipeline (OpenCV 5)
    participant SR as StopRules
    participant CS as CoachSession
    participant AG as AgentCoach + Claude (Strands)
    participant T as MCP tools (agent/tools.py)

    P->>B: forearm and cup cover the sheet's markers
    B->>PL: JPEG frames
    Note over PL: Calibrator: 4 markers fresh, 3 partial RANSAC,<br/>fewer than 3 held ≤ 1.5 s, then uncalibrated
    PL->>CS: reach_complete verified:false reason:marker_lost (×3)
    CS->>SR: on_events (runs before any coach)
    SR-->>CS: pause rule failed_reps + therapist_flag
    Note over CS: rule coach silent while paused<br/>trace: stop_rule, flag
    CS->>AG: checkpoint pause:failed_reps (evidence = pause event id)
    AG->>T: get_set_summary
    T-->>AG: 3 reps, 0 verified, reasons marker_lost
    AG->>T: check_setup
    T->>PL: fresh Calibrator.run on latest in-memory frame<br/>(cv2.aruco + cv2.findHomography + solvePnP + quality)
    T-->>AG: markers check: "Markers missing: 2 …", first_hint
    AG->>T: speak("Markers missing: 2. Flatten the sheet and keep it in view.", cue correct)
    Note over T: guardrails: evidence ids must be in this session's ring,<br/>≤ 160 chars, ≤ 1 per 4 s, ≤ 6 calls per run
    P->>B: moves the forearm, flattens the sheet
    AG->>T: recalibrate
    T->>PL: command recalibrate → new Calibrator (4 markers needed again)
    T-->>AG: calibrated, markers_found [0,1,2,3], rms_mm 0.165, tilt_deg 15.9
    AG->>T: request_resume(reason, evidence)
    Note over T: allowed only while a rule pause holds,<br/>refused if the patient paused themselves
    T-->>CS: intent queued: prompt kind resume
    Note over CS: socket loop drains intents and re-checks stop:<br/>a pain stop mid-run drops them (agent_drop)
    CS->>B: prompt "Setup looks good — resume?" (Yes, resume · Not yet)
    B->>P: caption + spoken cue
    P->>B: taps "Yes, resume"   (human approval)
    B->>CS: answer resume-1 choice Yes
    CS->>B: resume · "Thanks. Carrying on from where we stopped."
```

Where control sits in this loop:

| Layer | What it does here | Code |
|---|---|---|
| Stop rules | Pause + therapist flag on three unverified reps; also pain ≥ 7, new/worse symptoms, trunk lean ×3, exertion high 60 s, perception loss. Runs before any coach. | `stop_rules.py` `StopRules.on_events`, `on_exertion`, `on_checkin`, `on_pain` |
| Checkpoint | Only `checkin`, `set_complete`, `arc_complete`, `nhpt_complete`, `pause:failed_reps`, `pause:perception`, `feedback` start an agent run. | `session.py` `CHECKPOINT_EVENTS`, `CHECKPOINT_PAUSES` |
| Evidence | Every coach tool must cite event ids that exist in this session's ring, or the call is refused. | `agent/tools.py` `_action_guard` |
| Clamps | Dose changes (`propose_adjustment`) are clamped by `prescription.clamp`, become a Yes / Keep / Why prompt, and are clamped again by `SessionPipeline.command` on Yes. | `agent/tools.py`, `prescription.py`, `pipeline.py` |
| Budgets | ≤ 6 tool calls and ≤ 15 s per run, ≤ 60 calls and ≤ 12 runs per session; rest ≤ 120 s. | `agent/tools.py` constants, `agent/model.py` `RUN_TIMEOUT_S`, `coach/agent.py` |
| Human approval | Resume and every dose change happen only on the patient's tap. Decline changes nothing. | `session.py` `on_answer`, `_answer_agent_prompt` |
| Privacy | No tool result, trace row or model message holds pixels (`assert_no_pixels` on every result). | `agent/tools.py` |
| Failure | Model error, timeout or refusal → `agent_error`, `agent_status offline`, the rule coach carries on. MCP down → same functions as direct tools (`transport: direct`). | `coach/agent.py`, `agent/model.py` |

`pause:perception` (lost tracking for about 3 s) follows the same `check_setup → speak → recalibrate → request_resume` path. A perception pause also clears itself when `perception_regained` arrives, so the patient is never stuck behind a modal.

More detail: `docs/AGENT.md` (tools table, configuration, web contract) and `docs/TECHNICAL_REPORT.md` §2–§4.
