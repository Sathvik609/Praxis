# Praxis

An agentic vision coach for therapist-prescribed upper-limb rehab at home, using one ordinary webcam and everyday objects. Team Praxis' entry in the **OpenCV AI Competition 2026 (powered by AWS)**.

> Praxis is an adherence and coaching aid. **It is not a medical device.** The therapist prescribes; the coach works within the prescription; hard-coded stop rules always win.

Built on **OpenCV 5.0.0** (`opencv-python-headless==5.0.0.93`, pinned). Video is processed in memory and never stored by default; only events, metrics and logs leave the device.

## 60-second quickstart (edge / laptop mode)

```bash
# 1. Session service (Python 3.12 + uv)
cd services/session && uv sync && uv run uvicorn praxis_session.main:app --port 8000
#    → http://127.0.0.1:8000/health  {"status":"ok","opencv_version":"5.0.0","mode":"edge"}

# 2. Web app (pnpm)
cd web && pnpm install && pnpm dev
#    → http://localhost:5173  press "Start camera test"; you should see heartbeat events

# 3. Replay mode (no webcam) — the judge fallback
cd services/session
uv run python -m praxis_session.replay ../../evaluation/dataset_v0/synthetic_nhpt_01.mp4 --mode nhpt --quiet
uv run python -m praxis_session.replay ../../evaluation/dataset_v0/synthetic_pegboard_01.mp4 --mode pegboard --targets 0,1,2,3,4,5,6,7,8,0,1,2,3,4,5,6,7,8,0,1 --quiet

# 4. Print the calibration board (A4, 100% scale)
uv run python tools/make_board.py   # writes docs/board.pdf

# 5. Regenerate every evaluation number
uv run python ../../evaluation/scripts/make_dataset_v0.py && uv run python ../../evaluation/scripts/eval_dataset_v0.py
```

Tests: `uv run pytest` (session) · `pnpm test` (web, infra) · `pnpm synth` (infra, no deploy).

## Status (Week 1, 13 Sep 2026)
Perception core runs on a laptop: ArUco calibration → canonical board view → Hough holes → HSV/template occupancy → six-state pegboard FSM → NHPT timer, streamed as timestamped JSON events over a WebSocket and drawn as an overlay in the web session screen. Replay mode plays recorded video through the identical pipeline. Everything is verified on **synthetic renders only** so far; real recordings are the next step. See `CLAUDE.md` for the locked decisions, `docs/TECHNICAL_REPORT.md` for what is real vs planned, and `docs/RISKS.md`.

In the web app, open **Start Nine-Hole Peg Test** or **Start pegboard transfer** from Home (`/session?mode=nhpt|pegboard`). The dev server proxies `/ws` and `/api` to the session service on port 8000; if port 5173 is busy, Vite picks the next one.

AWS deployment is deferred: infra synthesizes but nothing is deployed. Cloud/judge mode (Graviton c8g from the COOL AMI, Bedrock, AgentCore Gateway) lands W3–W5 behind `PRAXIS_CLOUD_ENABLED=1`.

## Layout
```
services/session/   FastAPI + OpenCV 5 + FastMCP + Strands (one process)
services/tools-lambda/  arm64 Lambda behind AgentCore Gateway (W3)
web/                React + TS + Vite, Radix + Tailwind
infra/              AWS CDK (TypeScript)
evaluation/         dataset, scripts, results, failure cases
benchmark/          COOL harness
traces/             agent JSON traces
docs/               technical report, licenses, risks, board.pdf
```

## Licenses and attribution
See `docs/LICENSES.md`. GRASP concepts are paraphrased from UBC / Heart & Stroke material with our own illustrations.
