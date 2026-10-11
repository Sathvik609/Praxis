# Praxis — Judge quick-start

Five minutes, no install. If you have a webcam you can try one exercise live; without one, the **Replay** path runs a recorded session through the identical OpenCV 5 pipeline and coach.

> Praxis is an adherence and coaching aid for exercises a therapist has already prescribed. **It is not a medical device.** The hosted build holds sample data only. There is no sign-in, so please don't enter real health information.

## 1. Open the app

**https://dl8xykmg8ki61.cloudfront.net** (Chrome or Edge, desktop or landscape tablet, 1280 × 800 or larger).

This is the AWS deployment: an EC2 **c8g.large (Graviton4)** in us-east-2, launched from the **COOL AMI**, running the session service on COOL's OpenCV 5.1.0-dev behind CloudFront HTTPS. To confirm what is running, open [`/health`](https://dl8xykmg8ki61.cloudfront.net/health) and look for `opencv_build.cool: true` and `arch: aarch64`.

The team keeps the endpoint up for the judging period (through 9 Nov 2026). If it does not answer, use §5 (local run, about 3 minutes) and tell us. We start the instance on request.

## 2. Turn on the judge view (10 s)

Settings (gear in the left rail) → **Demo and judging** → **Show technical details**. This adds:
- the **decision trace** on every live screen ("Show trace"): OpenCV event → stop-rule check → coach decision → tool call → action, with timestamps;
- the OpenCV status line (calibration source, reprojection error, fps, latency p50/p95);
- the camera-setup telemetry.

## 3. Without a webcam: Replay (2 min)

Settings → Demo and judging → **Replay a recorded session** → pick a clip:

| Clip | What to watch |
|---|---|
| `synthetic_cup_01` (Waiter – cup) | ArUco calibration → warped target sheet → cup-base segmentation → reach state machine. 32 reaches over 2 slow and 2 fast arcs. Watch the verified vs unverified counts, the progression prompt (Yes / Not yet / Why) before the fast arcs, and, on the AWS endpoint, the Claude agent coach's lines at the end of each arc (`source: agent` in the trace). |
| `synthetic_nhpt_01` (Nine-Hole Peg Test) | Board warp, Hough holes, HSV + contour pegs, masked `matchTemplate` occupancy, the peg state machine, the NHPT timer and per-peg splits. |

The replays are **OpenCV-rendered synthetic clips** (labelled "Replay"). They show the pipeline working; they are not evidence of real-world accuracy (report §6). A replayed session gets a report like a live one but is never counted in progress, adherence or trends.

## 4. With a webcam: try one exercise live (3 min)

The camera is processed in memory on the server and never stored. The red **"Live · not recording"** marker is shown whenever the camera is on.

**Arm out to the side** needs no printout:
1. Home → **Start session** → **Arm out to the side** → watch the demonstration → answer the check-in (pain 0–10).
2. Camera setup: put the laptop on a table about 2 m away, facing you, so that your **head, shoulders and hips** are in view. The face is never analysed, but the pose model finds a person by the head, so a cropped-out head means no detection (measured, report §8.4).
3. Lift the arm out to the side to about shoulder height, hold for 3 s, then lower it. The angle shown is a camera-relative progress estimate, not a clinical measurement, and the 90° ceiling is enforced in code.
4. Things to try: **lean your trunk** sideways while lifting (a posture correction appears; the third lean pauses the set and flags the therapist), or **walk out of view** (the session pauses and says why, then resumes when you come back). Tapping **Pain / feel unwell** with a 7 or higher stops the session.

**Waiter – cup** and the **Nine-Hole Peg Test** need a printed sheet (A4 or US Letter, at 100 % / actual size: [`docs/sheets/cup_targets.pdf`](sheets/cup_targets.pdf), [`docs/sheets/nhpt_board.pdf`](sheets/nhpt_board.pdf)). Lay it flat 25–35 cm in front of the laptop and tilt the screen forward until the camera sees the whole sheet. Cover a corner marker with your hand to see the setup hint name that corner.

## 5. Run it locally instead (edge / privacy mode, ~3 min)

```bash
git clone <repo> praxis && cd praxis
cd services/session && uv sync && uv run python tools/fetch_models.py   # SHA256-pinned Apache-2.0 ONNX models
uv run uvicorn praxis_session.main:app --port 8000
cd ../../web && pnpm install && pnpm dev                                # → http://localhost:5173
```

In this mode no frame leaves the laptop. The agent coach is off unless `PRAXIS_AGENT=anthropic` and an API key are set (README → Agent coach). The rule coach and every stop rule work without it.

## 6. Where the evidence is

| Claim | Evidence |
|---|---|
| OpenCV 5 does the substantive vision work | [`docs/TECHNICAL_REPORT.md`](TECHNICAL_REPORT.md) §4, [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) §2, `services/session/praxis_session/perception/` |
| Runs on AWS Graviton with COOL | report §6, `/health` above, `infra/ec2/deploy.sh` |
| COOL vs stock OpenCV, measured | [`benchmark/results/cool_vs_stock_c8g.md`](../benchmark/results/cool_vs_stock_c8g.md) (regenerate: `benchmark/cool_bench.py`) |
| OpenCV output changes the agent's next action | `traces/agent/anthropic/covered_marker.jsonl`, [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) §3 |
| Agent evaluation (real Claude, 15 scenarios × 3) and the rule-only ablation | [`evaluation/results/agent_v0_anthropic.md`](../evaluation/results/agent_v0_anthropic.md), [`agent_ablation_v0.md`](../evaluation/results/agent_ablation_v0.md) |
| Arm angle on real video vs motion capture (REHAB24-6) | [`evaluation/results/rehab24_v0.md`](../evaluation/results/rehab24_v0.md), report §8.4 |
| Camera robustness (107 synthetic conditions) and the browser run with a simulated camera | [`evaluation/results/robustness_v0.md`](../evaluation/results/robustness_v0.md), `web/scripts/e2e-fake-camera.mjs`, report §8.1 and §8.5 |
| Safety lives in code | `services/session/praxis_session/stop_rules.py`, `prescription.py` (clamps), report §8 |
| What is not done yet | report §9 (Limitations) |
