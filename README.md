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

# 3. Replay mode (no webcam)             TODO Phase B
uv run python -m praxis_session.replay evaluation/dataset_v0/nhpt_01.mp4

# 4. Print the calibration board          TODO Phase A step 6
uv run python tools/make_board.py   # writes docs/board.pdf
```

Tests: `uv run pytest` (session) · `pnpm test` (web, infra) · `pnpm synth` (infra, no deploy).

## Status (Week 1, 13 Sep 2026)
Scaffold only. See `CLAUDE.md` for the locked decisions, `docs/TECHNICAL_REPORT.md` for what is real vs planned, and `docs/RISKS.md`.

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
