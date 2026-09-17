# Praxis

An agentic vision coach for therapist-prescribed upper-limb rehab at home, using one ordinary webcam, two printed sheets and everyday objects. Team Praxis' entry in the **OpenCV AI Competition 2026 (powered by AWS)**.

> Praxis is an adherence and coaching aid. **It is not a medical device.** The therapist prescribes; the coach proposes within the prescription; hard-coded stop rules always win.

Built on **OpenCV 5.0.0** (`opencv-python-headless==5.0.0.93`, pinned). Video is processed in memory and never stored by default; only events, metrics and logs leave the device.

Three camera-coached tasks ship: **Nine-Hole Peg Test** (assessment), **Waiter – cup** (GRASP coordination) and **Arm to the front** (GRASP arm strengthening). Every other GRASP exercise is instructions-only. Design source of truth: `docs/wireframes/Praxis_HiFi_Wireframes_v1.1.pdf`. Build plan: `docs/PLAN.md`.

## 60-second quickstart (edge / laptop mode)

```bash
# 0. Print the sheets at 100 % (A4). Check a marker measures 40 mm with a ruler.
#    docs/sheets/nhpt_board.pdf · docs/sheets/cup_targets.pdf

# 1. Session service (Python 3.12 + uv). fetch_models downloads the Apache-2.0 OpenCV Zoo ONNX files (25 MB).
cd services/session && uv sync && uv run python tools/fetch_models.py && uv run uvicorn praxis_session.main:app --port 8000
#    → http://127.0.0.1:8000/health  {"status":"ok","opencv_version":"5.0.0","mode":"edge"}

# 2. Web app (pnpm). Every screen is behind sign-in: accounts Rinky, Shruthi, Sathvik (team-managed, no self sign-up yet).
cd web && pnpm install && pnpm dev
#    → http://localhost:5173/  Home (body map) → Start session → check-in (Phase 8) · /demo?exercise=cup&side=left shows the demonstration
#    → http://localhost:5173/setup?exercise=nhpt  (Vite picks the next port if 5173 is busy)
#    Click Allow on the camera prompt, hold the printed NHPT sheet in view:
#    the checklist turns Pass and "Continue to demonstration" unlocks.
#    → http://localhost:5173/session?hand=left            runs the Nine-Hole Peg Test live.
#    → http://localhost:5173/session?exercise=cup&side=left runs Waiter – cup (blue band on the cup base, docs/sheets/cup_targets.pdf).
#    → http://localhost:5173/session?exercise=arm&side=left runs Arm to the front (side view, no sheet needed).

# 3. Replay mode (no webcam) — the judge fallback, identical pipeline
#    In the app: Settings → "Replay synthetic_nhpt_01" (or Home → "Replay a recorded session").
#    From the CLI:
cd services/session
uv run python -m praxis_session.replay ../../evaluation/dataset_v0/synthetic_nhpt_01.mp4 --mode nhpt --quiet

# 4. Regenerate every evaluation number
uv run python ../../evaluation/scripts/make_dataset_v0.py && uv run python ../../evaluation/scripts/eval.py
```

Tests: `uv run pytest -q` and `uv run ruff check .` (session) · `pnpm test && pnpm typecheck && pnpm lint` (web).

## One-container deploy (Railway / any Docker host)

The image builds the web app and serves it from the session service, so the browser talks to **one origin** for the page, `/api`, `/health`, `/events` and the WebSocket (`/ws/session`). Build context is the repo root; models are fetched (SHA256-pinned) at build time; the SQLite store lives in `/app/data` (ephemeral unless a volume is mounted). `PORT` is honoured; `railway.json` points Railway at the Dockerfile and the `/health` check.

```bash
docker build -f services/session/Dockerfile -t praxis .
docker run -p 8000:8000 praxis            # → http://127.0.0.1:8000/
```

Locally you can serve a build the same way without Docker: `cd web && pnpm build`, then start uvicorn with `PRAXIS_WEB_DIST=../../web/dist`. This is still the **edge build** (`PRAXIS_CLOUD_ENABLED=0`, rule-based coach); hosting it remotely means webcam frames travel to the host over TLS, where they are processed in memory and discarded, never stored. The AWS/COOL cloud mode in `CLAUDE.md` §4 is separate and deferred to W6.

## Status (Phase 0–8 + Sprints A–C, 17 Sep 2026)

Built and tested on synthetic renders: session service (`/health`, `/events`, WebSocket frame ingest), event JSON schema, sheet geometry + printable PDFs, ArUco → homography calibration that refuses until all four markers are visible, setup quality checks, perception-loss events, wireframe screen 05 (Camera setup), **and the full Nine-Hole Peg Test**: canonical board warp → cached Hough holes → HSV/contour peg occupancy → six-state peg FSM → timer from first lift to ninth seat with per-peg splits, streamed as `frame` + FSM events, drawn on screen 07 (live NHPT with board view, controls, trace) and summarised on the assessment result. Replay mode plays a recorded clip through the identical pipeline. **Hand landmarks** come from the OpenCV Zoo palm + hand ONNX models through `cv2.dnn` (run `uv run python tools/fetch_models.py` once), giving pinch aperture, smoothness (SPARC) and tremor in millimetres and gating the peg FSM. **Waiter – cup** tracks a cup with a blue base band across the printed 5-dot sheet: reach time per dot, verified vs unverified reaches, two slow arcs then two fast arcs after the patient accepts the progression prompt (screen 07b). **Arm to the front** uses the OpenCV Zoo pose model: shoulder angle vs a 90° ceiling, 3 s holds, trunk-lean and shoulder-hike flags (screen 07c); the FSM freezes with an on-frame `gate` (`turn_side`, `hips_out_of_view`) unless the practising side faces the camera with the shoulder, elbow and hip visible, and a lean must persist 0.5 s with both hips visible before it counts. The **avatar** is a procedural Three.js ceramic mannequin (lathe-turned bust, ball joints, mitt hands, PBR material on a gradient stage, all primitives in code) with keyframed, IK-solved clips and stage props (target sheet, cup, peg board, 90° ceiling line): Home body map, Demonstration (screen 06) and the live reference panels, mirrored for the practising side; it never scores anyone. A **rule-based coach** (labeled as such) speaks captioned cues from perception events, proposes progression only within the prescription, and is preceded by hard-coded **stop rules** that flag the therapist; every decision is in the JSON trace (`traces/`, `/api/trace`). All wireframe screens exist: sign-in, check-in, choose exercise, camera setup, demonstration, three live sessions, feedback, report, progress, therapist dashboard, settings, coach drawer; sessions persist to a local SQLite store and **replay mode** (Settings → Replay) runs a recorded clip through the identical pipeline with no webcam. `evaluation/` regenerates rep F1 and NHPT MAE (1.0 and 0.0 s on the synthetic clip — pipeline validation only). **Nothing has been verified on a real recording yet.** See `docs/TECHNICAL_REPORT.md` §2.1, `docs/RISKS.md`, `docs/PLAN.md`.

**17 Sep, Sprint A (demo unblockers, from `docs/AUDIT_2026-09-17.md`):** replay works for all three tasks and replay commands use clip time so the coach keeps speaking after a prompt; Arm to the front sets up without a sheet; the rule coach uses per-cue cooldowns, short in-rep cues, phrase pools and arc summaries that cite the numbers; the browser queues speech instead of cutting it off; one live status drives the header chip, feed label and coach fallback; captions expire back to state captions; every screen fits 1280 × 800 with the session controls and FlowBar pinned; a blocked camera shows a card with "Use a recorded session"; the replay entry sits on Home.

**17 Sep, Sprint B (avatar rebuild):** the mannequin is a seamless ceramic bust (lathe torso, neck, egg head, ball joints, mitt hands that close on the cup and peg) seated in a plinth on a shadow-receiving gradient stage, physically based material with clearcoat, sheen and a mint rim light, spline motion with hold keys, breathing idle and anticipation, stage props (table, five-dot sheet, cup, peg board, dish, 90° line), the amber ring on the next target and the mint path for the current reach only, right-side mirroring, legible labels with leaders. Still procedural, still never scores.

**17 Sep, Sprint C (design craft):** AA-measured light/dark tokens with a contrast test, primitives with hover/focus/pressed states (Button, Chip, Card, Pill, Field, Checkbox, Stat, Panel, icons from lucide), Bars/Line charts with axes and hatched unverified bars, every screen migrated: hubs with real filters, an editable goal, a coach drawer, a clinician header on the therapist view and sign-in outside the shell; flow screens with keyboard-operable scales, a designed camera setup and report with download and sharing; live screens with a designed overlay (numbered holes, bracket corners, cup and dots, hand skeleton, arm ghost), pinned controls, trace with copy. Dev copy and inert controls are gone.

Not started: real recordings and dataset v1 (Phase 9, needs participants). Bedrock agent, AWS deployment and COOL cloud mode are deferred to W6 (`CLAUDE.md` §4).

## Layout
```
services/session/   FastAPI + OpenCV 5 + stop rules + coach (one process)
services/tools-lambda/  arm64 Lambda behind AgentCore Gateway (W6)
web/                React + TS + Vite, Radix + Tailwind 4, Three.js avatar
infra/              AWS CDK (TypeScript), synth only until W6
evaluation/         dataset, scripts, results, failure cases
benchmark/          COOL harness (W6)
traces/             coach JSON traces
docs/               PLAN.md, TECHNICAL_REPORT.md, LICENSES.md, RISKS.md, sheets/, wireframes/, superpowers/
```

## Licenses and attribution
See `docs/LICENSES.md`. GRASP concepts are paraphrased from UBC / Heart & Stroke material with our own illustrations.
