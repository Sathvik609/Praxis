# Praxis: Architecture

This page has three diagrams for judges:

1. the whole system;
2. the OpenCV 5 pipeline for each exercise;
3. one real agent loop where the OpenCV output changes what the agent does next.

Every module and function named here exists in `services/session/praxis_session/` (checked again on 25 Oct 2026).

**How to read the diagrams.** Solid boxes and arrows are built and tested. **Dashed boxes and arrows are planned or not yet running on AWS.**

Since 11 Oct 2026 the session service runs on AWS. We rebuilt it on 21 Oct in a new account. It is a Graviton4 c8g.large launched from the COOL AMI (COOL's OpenCV 5.1.0-dev) behind CloudFront HTTPS. The COOL vs stock benchmark is in `benchmark/`. Still not built: S3, CDK and the tools Lambda (there is no `services/tools-lambda/` folder). CloudWatch logs, metrics, dashboard and alarms are built but not yet verified on AWS (`infra/ec2/README.md`). Our agent uses Claude via the Anthropic API; Bedrock is not used.

## 1. System architecture

```mermaid
flowchart LR
    subgraph BROWSER["Browser · React 19 + TS + Vite"]
        CAM["Laptop built-in camera<br/>640×480 JPEG, ack-paced, 12 fps ceiling<br/>8-byte capture-time prefix"]
        UI["Screens 03–11<br/>captions, prompts Yes / Not yet,<br/>Take a rest · Pain · End session"]
        AV["Three.js avatar<br/>Blender GLB + AnimationMixer<br/>reference only, never scores"]
        TR["Show trace panel<br/>Settings › Demo and judging ›<br/>Show technical details"]
    end

    subgraph SVC["Session service · one Python 3.12 process · FastAPI (main.py)"]
        WS["WS /session (alias /ws/session)<br/>frames decoded with cv2.imdecode,<br/>drop-oldest, thread pool"]
        RP["Replay mode<br/>?replay=clip id · cv2.VideoCapture<br/>same pipeline, no webcam"]
        subgraph PIPE["SessionPipeline (pipeline.py) · OpenCV 5 (COOL 5.1.0-dev on AWS)"]
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
        subgraph AG["Agent coach · built, off by default locally, on in the hosted build"]
            AC["AgentCoach (coach/agent.py)<br/>at checkpoints only"]
            PL["StrandsPlanner · Claude Sonnet 5.5<br/>Anthropic API (prompt-cached)"]
            MCP["FastMCP 3.4 servers in-app<br/>/mcp/perception · /mcp/exertion · /mcp/coach<br/>loopback or X-Praxis-MCP-Token, else 403"]
            TL["agent/tools.py<br/>17 tools, AUTONOMY policy,<br/>guardrails, clamps"]
            MET["agent/metrics.py<br/>JSON line per run / error → stdout<br/>GET /api/agent/metrics"]
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
    TL -->|"check_setup / recalibrate /<br/>resample_target_colour<br/>on latest frame in memory"| PIPE
    AC --> MET
    TL -->|"intents, drained by socket loop,<br/>stop re-checked"| CS
    CS --> TRC
    CS -->|"on feedback"| DB
    CS -->|"events, captions, prompts"| UI
    TRC --> TR
    UI -->|"answer, pain, pause, commands"| WS

    subgraph AWS["AWS us-east-2 · rebuilt 21 Oct 2026"]
        CF["CloudFront HTTPS<br/>d235zashbh751z.cloudfront.net<br/>WSS upgrade, caching off"]
        EC2["EC2 c8g.large · Graviton4<br/>COOL AMI · OpenCV 5.1.0-dev (/opt/cool)<br/>same service under systemd"]
        GRD["Guardrails: SG from CloudFront prefix list only,<br/>$50 budget with email alerts<br/>(no budget action, no SCPs)"]
        S3["S3: event logs, traces,<br/>reports (planned)"]
        CW["CloudWatch: /praxis/session logs, EMF metrics,<br/>dashboard, alarms (built, not yet verified on AWS)"]
        CDK["AWS CDK (planned;<br/>infra/ec2/deploy.sh today)"]
    end
    ANT["Anthropic API<br/>Claude · the agent's only model provider,<br/>no Bedrock"]

    UI -->|"HTTPS / WSS"| CF --> EC2
    SVC ==>|"infra/ec2/deploy.sh: same code,<br/>cv2 = COOL"| EC2
    GRD --- EC2
    PL -->|"HTTPS · numbers and short text only,<br/>never frames · prompt-cached prefix"| ANT
    TRC -.-> S3
    MET -.-> CW
    CDK -.-> EC2

    classDef planned stroke-dasharray: 6 4,stroke:#A15C00,fill:#FFF8EC,color:#5A3A00
    class S3,CW,CDK planned
```

**What runs where today.** In edge mode, everything above the AWS box runs on one laptop (`uv run uvicorn praxis_session.main:app`). The same service also runs on the c8g instance for the hosted judge endpoint (the AWS box), and in one container (`services/session/Dockerfile`) hosted on Railway for team review. On the laptop, no frame leaves the machine. On Railway, frames travel over TLS to the container, where they are processed in memory and dropped (`docs/RISKS.md`, 17 Sep row). `PRAXIS_CLOUD_ENABLED` defaults to `0` and gates every cloud call. The agent's model is Claude via the Anthropic API, called from wherever the service runs (the laptop or the c8g instance). `PRAXIS_AGENT=bedrock` falls back to the rule coach alone (12 Oct).

**Agent status.** Our agent is built (29 Sep). It is off by default locally (`PRAXIS_AGENT=off`) and on in the hosted build (`deploy.sh --agent`). We tested it offline with `ScriptedPlanner` (in CI) and since 10 Oct against real Claude through the Anthropic API (Sonnet 5.5 since 12 Oct). The real-model run below includes (`docs/AGENT.md`):

- MCP access control, quoted patient text, the camera-checked resume, the praise limit, metrics, the session plan, the autonomy table and `resample_target_colour` (10 Oct);
- the 11 Oct audit fixes: closing the socket cancels the agent run, feedback replaces stale checkpoints, and ended sessions are read-only for the agent.

> **Real model:** the default is Claude Sonnet 5.5 via the Anthropic API. We picked it over Sonnet 5 and Haiku 5.5 after measuring them side by side (`docs/AGENT.md` § Model choice).
> - **On real video** (REHAB24-6 through this pipeline, `evaluation/results/agent_video_v0.md`): 40 sessions. It named a fault that motion capture confirmed, and gave a correction, in 41 of 44 set reviews (patient taps simulated). It named the specific fix on 26/26 real wrong-view pauses, and offered no resume while the view stayed wrong. 0 guardrail violations, $0.050 per session.
> - Synthetic, 15 scenarios, latest run (21 Oct): 15/15, 0 guardrail violations, first action p50/p95 3.7/6.2 s, $0.020 per session. A harder 16th scenario (`mixed_signals`) fails 0/3 and stays open.
> - Agent vs rule-only: `evaluation/results/agent_ablation_v0.md`.

## 2. OpenCV 5 pipeline per exercise

`SessionPipeline.process(frame_bgr, t, frame_index)` uses the mode the socket was opened with. Each mode returns one `frame` event per frame plus the state-machine events below. The `frame` event holds overlay geometry in frame pixel coordinates, never the pixels themselves. Module docstrings note `cv2.__version__` (5.0.0, `opencv-python-headless==5.0.0.93`).

```mermaid
flowchart TB
    IN["JPEG bytes → cv2.imdecode → BGR frame"]

    subgraph SHEET["Shared by the two sheet tasks · perception/calibration.py + quality.py"]
        A1["cv2.cvtColor BGR→GRAY"]
        A2["cv2.aruco.ArucoDetector.detectMarkers<br/>DICT_4X4_50 ids 0–3, CORNER_REFINE_SUBPIX"]
        A3["cv2.findHomography px → sheet mm<br/>4 markers fresh · 3 markers cv2.RANSAC partial ·<br/>1–2 markers that have not moved: held · 2 moved markers: refit ·<br/>otherwise held ≤ 1.5 s"]
        A4["cv2.solvePnP SOLVEPNP_IPPE + cv2.Rodrigues<br/>camera tilt_deg, setup check ≤ 50° (laptop screen tilted forward)"]
        A5["quality: cv2.Laplacian sharpness, mean luma,<br/>marker jitter, task area in view"]
        A1 --> A2 --> A3 --> A4
        A3 --> A5
    end

    subgraph NHPT["Nine-Hole Peg Test · perception/board.py, peg_fsm.py, nhpt.py"]
        N1["BoardState.warp: cv2.warpPerspective<br/>canonical 3 px/mm"]
        N2["detect_holes: cv2.GaussianBlur + cv2.HoughCircles<br/>once, cached, snapped to spec"]
        N3["peg_mask: cv2.cvtColor HSV + cv2.inRange<br/>+ cv2.absdiff change from the empty board (uncoloured pegs)<br/>minus skin band, minus hand box"]
        N4["peg_blobs: cv2.findContours + cv2.moments"]
        N5["hole_scores: disc fraction,<br/>masked cv2.matchTemplate TM_CCOEFF_NORMED tie-break"]
        N6["PegFSM at_source → grasped → in_transit →<br/>over_target → seated → hand_clear · NHPT timer"]
        N1 --> N2 --> N5
        N1 --> N3 --> N4 --> N6
        N5 --> N6
    end

    subgraph CUPS["Waiter – cup · perception/cup.py"]
        C1["CupSheetState.warp: cv2.warpPerspective<br/>canonical 2 px/mm"]
        C2["cup_mask: HSV cv2.inRange + cv2.morphologyEx MORPH_OPEN<br/>no colour match: cv2.absdiff change from the empty sheet"]
        C3["cup_mm: cv2.findContours + circle fit to the base edge<br/>(on the paper) → base centre mm"]
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

Some notes so the diagram is not read as more than it is:

- A rep the camera could not check is **unverified, not failed**. Examples: `reach_complete` with `cup_occluded` or `marker_lost`, and NHPT `rep_complete` with `no_hand_near_hole`. Performance misses (`target_missed`, `hold_too_short`) are counted separately.
- Arm angles are progress numbers measured in the image, relative to the camera. They are **never goniometry** (clinical joint-angle measurement). From the front view, abduction cannot be told apart from a lift in the scaption plane.
- The sheet-task thresholds (HSV windows, Hough, hand gates) were tuned on renders and fixed after our live team sessions; they have no labelled real-camera accuracy yet. The arm's hike allowance and front-view gate were set from REHAB24-6 real video (`evaluation/results/rehab24_thresholds_v0.md`).
- The hidden exercises (Pendulum, Arm to the front, Rotate out, Rotate in) still have code in `ArmFSM` and the registry. But `visible: False` keeps them off every screen, and the socket refuses them (`not_offered`).

## 3. Agent workflow: one perception → decision → action loop

This diagram follows the committed scenario `evaluation/agent/scenarios/covered_marker.json` (trace `traces/agent/covered_marker.jsonl`, scripted planner). The scenario hides ArUco markers 2 and 3 (the two bottom corners, where a resting forearm would lie) in the frame the tools see, and sends three `reach_complete` events marked unverified (`marker_lost`). In a live session, `marker_lost` means the sheet could not be tracked: no marker in view (or the visible ones moved) for more than 1.5 s. One covered marker leaves a three-marker RANSAC fit. Since 24 Oct, two covered markers also hold the fix as long as the other two have not moved (and two that have moved refit it), so live this case is rarer than in the scenario; the scenario still tests the tool path.

Here is what happens. The stop rules pause the session before the agent sees anything. The agent then runs OpenCV on the latest frame, tells the patient the specific fix, recalibrates, and asks whether to resume. Only the patient's "Yes" resumes the session.

```mermaid
sequenceDiagram
    autonumber
    actor P as Patient
    participant B as Browser
    participant PL as SessionPipeline (OpenCV 5)
    participant SR as StopRules
    participant CS as CoachSession
    participant AG as Our agent · AgentCoach + Claude (Strands)
    participant T as MCP tools (agent/tools.py)

    P->>B: forearm and cup cover the sheet's markers
    B->>PL: JPEG frames
    Note over PL: Calibrator: 4 markers fresh, 3 partial RANSAC,<br/>1–2 unmoved markers held, 2 moved markers: refit,<br/>none held ≤ 1.5 s, then uncalibrated
    PL->>CS: reach_complete verified:false reason:marker_lost (×3)
    CS->>SR: on_events (runs before any coach)
    SR-->>CS: pause rule failed_reps + therapist_flag
    Note over CS: rule coach silent while paused<br/>trace: stop_rule, flag
    CS->>AG: checkpoint pause:failed_reps (evidence = pause event id)
    AG->>T: get_set_summary
    T-->>AG: 3 reps, 0 verified, reasons marker_lost
    AG->>T: check_setup
    T->>PL: fresh Calibrator.run on latest in-memory frame<br/>(cv2.aruco + cv2.findHomography + solvePnP + quality)
    T-->>AG: markers [0,1] found, [2,3] missing · first_hint "The markers in the bottom-right corner (2),<br/>bottom-left corner (3) are covered or creased: clear and flatten them."
    AG->>T: speak "The markers in the bottom-right corner (2), bottom-left corner (3)<br/>are covered or creased: clear and flatten them." · cue correct
    Note over T: guardrails: evidence ids must be in this session's ring,<br/>≤ 160 chars, ≤ 1 per 4 s, ≤ 6 calls per run
    P->>B: moves the forearm, flattens the sheet
    AG->>T: recalibrate
    T->>PL: command recalibrate → new Calibrator (keeps the last fix as an anchor)
    T-->>AG: calibrated, markers_found [0,1,2,3], rms_mm 0.165, tilt_deg 15.9
    AG->>T: request_resume(reason, evidence)
    T->>PL: fresh check_setup on the latest frame
    Note over T: allowed only while a rule pause holds and every check<br/>now passes, else {ok:false, "setup still failing: …"}, nothing shown
    T-->>CS: intent queued: prompt kind resume
    Note over CS: socket loop drains intents and re-checks stop:<br/>a pain stop mid-run drops them (agent_drop)
    CS->>B: prompt "Setup looks good — resume?" (Yes, resume · Not yet)
    B->>P: caption on screen, spoken by the browser (SpeechSynthesis)
    P->>B: taps "Yes, resume"   (human approval)
    B->>CS: answer resume-1 choice Yes
    CS->>B: resume · "Thanks. Carrying on from where we stopped."
```

Who controls what in this loop:

| Layer | What it does here | Code |
|---|---|---|
| Stop rules | Pause and flag the therapist after three unverified reps (a peg the board saw seated does not count). Also: pain ≥ 7 in session stops; three missed reps in a row and 60 s of high exertion give a rest; three trunk leans and lost tracking pause. Runs before any coach. | `stop_rules.py` `StopRules.on_events`, `on_exertion`, `on_checkin`, `on_pain` |
| Checkpoint | Only these start an agent run: `checkin`, `set_complete`, `arc_complete`, `nhpt_complete`, `pause:failed_reps`, `pause:perception`, `pause:setup`, `feedback`. | `session.py` `CHECKPOINT_EVENTS`, `CHECKPOINT_PAUSES` |
| Autonomy | One table marks each tool as `autonomous`, `forbidden_after_stop`, `patient_approval` or `never`. `invoke` enforces it, and every `agent_run` row records `policy_version`. | `agent/tools.py` `AUTONOMY`, `invoke` |
| Plan | `set_session_plan` runs at check-in. Changing the plan needs new evidence ids and a `because`. It shows up as `plan` trace rows and as `summary.coach.plan` in the report. | `agent/tools.py`, `session.py` `set_plan` |
| Evidence | Every coach tool must cite event ids that exist in this session's ring buffer, or the call is refused. | `agent/tools.py` `_action_guard` |
| Clamps | Dose changes (`propose_adjustment`) are clamped to the prescription by `prescription.clamp` and turned into a Yes / Keep / Why prompt. On Yes, `SessionPipeline.command` clamps them again. | `agent/tools.py`, `prescription.py`, `pipeline.py` |
| Budgets | ≤ 6 tool calls and ≤ 15 s per run (25 s for a pause run), ≤ 60 calls and ≤ 12 runs per session; rest 10–120 s. | `agent/tools.py` constants, `agent/model.py` `RUN_TIMEOUT_S`, `coach/agent.py` |
| Human approval | A resume or a dose change happens only when the patient taps to accept. A resume is offered only after a fresh `check_setup` passes. Saying no changes nothing. | `session.py` `on_answer`, `_answer_agent_prompt`; `agent/tools.py` `request_resume` |
| Security | MCP routes accept only loopback requests without proxy headers, or requests with the per-process `X-Praxis-MCP-Token`. Patient text reaches the model only as length-capped, quoted data. | `agent/mcp_server.py` `MCPAccessGuard`; `agent/model.py` `quote_patient_text` |
| Observability | One JSON log line at the end of each run and for each error. With `PRAXIS_EMF=1` it adds CloudWatch EMF metrics (runs, fallbacks, errors, cost estimate, first action). Also `/api/agent/metrics`. Session/ops lines and the CloudWatch agent, dashboard and alarms are in `infra/ec2/README.md` (built, not yet verified on AWS). | `agent/metrics.py`, `ops.py`, `main.py` |
| Privacy | No tool result, trace row or model message holds pixels (`assert_no_pixels` on every result). | `agent/tools.py` |
| Failure | On a model error, timeout or refusal: `agent_error`, `agent_status offline`, and the rule coach carries on. If MCP is down, the same functions are called directly as tools (`transport: direct`). | `coach/agent.py`, `agent/model.py` |

`pause:perception` (tracking lost for about 3 s) follows the same `check_setup → speak → recalibrate → request_resume` path. A perception pause also clears itself when `perception_regained` arrives, so the patient is never stuck behind a pop-up. `pause:setup` follows the same path too. It happens in Arm out to the side when the pose is seen but the view check fails: 3 s turned away from the camera (for example standing side-on), or 6 s with the practising shoulder or elbow out of view. Here the pose facts (`facing` vs `needed_view`, both shoulders, elbow, trunk lean) are used to name the fix (`arm_setup` scenario). Since 25 Oct the hips do not need to be in view for Arm out to the side.

### 3.1 Active perception: the camera result changes the next tool call (green cup)

Scenario `evaluation/agent/scenarios/green_cup.json` (trace `traces/agent/green_cup.jsonl`): the patient uses a green cup. The default HSV colour band looks for the blue base, so the cup is never seen. (Since 24 Oct a live session also finds a cup of any colour by its change from the empty sheet, so this case is now rarer; the scenario still tests the tool path.) With the hand model on, placements are worked out from the hand position and reported as unverified (`cup_occluded`). Three in a row pause the session.

```mermaid
sequenceDiagram
    autonumber
    participant PL as SessionPipeline (OpenCV 5)
    participant CS as CoachSession + StopRules
    participant AG as AgentCoach
    participant T as tools (MCP)
    actor P as Patient
    PL->>CS: reach_complete verified:false reason:cup_occluded (×3)
    CS->>AG: pause failed_reps → checkpoint
    AG->>T: get_set_summary · check_setup
    T->>PL: fresh ArUco + homography, warpPerspective, cup mask with the current window
    T-->>AG: markers pass, lighting pass, target: check (cup not seen, colour_source default)
    AG->>T: resample_target_colour(cup)
    T->>PL: HSV patch on dot 1 (paper, skipped), dot 0 (green, S 195) → inRange + findContours test
    T-->>AG: applied: before detected false → after detected true, cup ≈ 60 mm on dot 0
    AG->>T: speak("…I've tuned the camera to it…") · request_resume
    T->>PL: fresh check_setup: every check passes (target seen)
    T-->>CS: resume prompt (Yes / Not yet)
    P->>CS: Yes, resume
    PL->>CS: cup moves dot 0 → dot 1: reach_complete verified:true
```

With the agent off, the same scenario stays paused with a generic message, and no reach is ever verified (`evaluation/results/agent_ablation_v0.md`).

More detail: `docs/AGENT.md` (tools table, configuration, web contract) and `docs/ENGINEERING_NOTES.md` §2–§4.
