# Praxis

An agentic vision coach for therapist-prescribed upper-limb rehab at home, using one ordinary webcam, two printed sheets and everyday objects. Team Praxis' entry in the **OpenCV AI Competition 2026 (powered by AWS)**.

> Praxis is an adherence and coaching aid. **It is not a medical device.** The therapist prescribes; the coach proposes within the prescription; hard-coded stop rules always win.

Built on **OpenCV 5.0.0** (`opencv-python-headless==5.0.0.93`, pinned). Video is processed in memory and never stored by default; only events, metrics and logs leave the device.

Three camera-coached tasks ship: **Nine-Hole Peg Test** (assessment), **Waiter – cup** (GRASP coordination) and **Arm to the front** (GRASP arm strengthening). Every other GRASP exercise is instructions-only. Design source of truth: `docs/wireframes/Praxis_HiFi_Wireframes_v1.1.pdf`. Build plan: `docs/PLAN.md`.

## 60-second quickstart (edge / laptop mode)

```bash
# 0. Print the sheets at 100 % (A4). Check a marker measures 40 mm with a ruler.
#    docs/sheets/nhpt_board.pdf · docs/sheets/cup_targets.pdf

# 1. Session service (Python 3.12 + uv)
cd services/session && uv sync && uv run uvicorn praxis_session.main:app --port 8000
#    → http://127.0.0.1:8000/health  {"status":"ok","opencv_version":"5.0.0","mode":"edge"}

# 2. Web app (pnpm)
cd web && pnpm install && pnpm dev
#    → http://localhost:5173/setup?exercise=nhpt  (Vite picks the next port if 5173 is busy)
#    Click Allow on the camera prompt, hold the printed NHPT sheet in view:
#    the checklist turns Pass and "Continue to demonstration" unlocks.
#    → http://localhost:5173/session?hand=left  runs the Nine-Hole Peg Test live.

# 3. Replay mode (no webcam) — the judge fallback, identical pipeline
cd services/session
uv run python -m praxis_session.replay ../../evaluation/dataset_v0/synthetic_nhpt_01.mp4 --mode nhpt --quiet

# 4. Regenerate every evaluation number
uv run python ../../evaluation/scripts/make_dataset_v0.py && uv run python ../../evaluation/scripts/eval.py
```

Tests: `uv run pytest -q` and `uv run ruff check .` (session) · `pnpm test && pnpm typecheck && pnpm lint` (web).

## Status (Phase 0–2, 16 Sep 2026)

Built and tested on synthetic renders: session service (`/health`, `/events`, WebSocket frame ingest), event JSON schema, sheet geometry + printable PDFs, ArUco → homography calibration that refuses until all four markers are visible, setup quality checks, perception-loss events, wireframe screen 05 (Camera setup), **and the full Nine-Hole Peg Test**: canonical board warp → cached Hough holes → HSV/contour peg occupancy → six-state peg FSM → timer from first lift to ninth seat with per-peg splits, streamed as `frame` + FSM events, drawn on screen 07 (live NHPT with board view, controls, trace) and summarised on the assessment result. Replay mode plays a recorded clip through the identical pipeline. `evaluation/` regenerates rep F1 and NHPT MAE (1.0 and 0.0 s on the synthetic clip — pipeline validation only). **Nothing has been verified on a real recording yet.** See `docs/TECHNICAL_REPORT.md` §2.1, `docs/RISKS.md`, `docs/PLAN.md`.

Not started: hand model (Phase 3), Waiter – cup (4), pose + Arm to the front (5), avatar (6), exertion / stop rules / rule coach / trace (7), remaining screens and local store (8), real dataset (9). Bedrock agent, AWS deployment and COOL cloud mode are deferred to W6 (`CLAUDE.md` §4).

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
