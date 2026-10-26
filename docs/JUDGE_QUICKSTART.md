# Praxis: quick start for judges

This takes five minutes and needs no install. If you have a webcam, you can try one exercise live. If you don't, the **Replay** path runs a recorded session through the same OpenCV 5 pipeline and coach.

> Praxis is an adherence and coaching aid for exercises a therapist has already prescribed. **It is not a medical device.** The hosted build holds no real patient data. There is no sign-in, so please don't enter real health information.

## 1. Open the app

**https://d235zashbh751z.cloudfront.net** (Chrome or Edge, desktop or landscape tablet, 1280 × 800 or larger).

This is our AWS deployment. It is an EC2 c8g.large (Graviton4) in us-east-2, launched from the COOL AMI. It runs the session service on COOL's OpenCV 5.1.0-dev behind CloudFront HTTPS. To check what is running, open [`/health`](https://d235zashbh751z.cloudfront.net/health) and look for `opencv_build.cool: true` and `arch: aarch64`.

The endpoint is up from submission until 10 Nov 2026 (judging ends 10 Nov, 2:45 am EST). If it does not answer, please use §5 (local run, about 3 minutes) and tell us.

## 2. Turn on the judge view (10 s)

Go to Settings (the gear in the left rail) → **Demo and judging** → **Show technical details**. This adds:
- the decision trace on every live screen ("Show trace"): OpenCV event → stop-rule check → coach decision → tool call → action, with timestamps;
- the OpenCV status line (calibration source, reprojection error, fps, latency p50/p95);
- the camera-setup telemetry.

<img src="img/screens/replay_cup_trace.png" width="640" alt="Judge view during a Waiter – cup replay: the trace lists OpenCV events, the coach decision with its evidence event id, and the spoken action, with timestamps and latency">

## 3. Without a webcam: Replay (2 min)

Go to Settings → Demo and judging → **Replay a recorded session** (or tap **No camera? Use a recorded session** on any camera setup screen) and pick a clip. There are clips for Waiter – cup and the peg test; Arm out to the side has no replay clip, because the real arm videos we measure on (REHAB24-6) can't be redistributed.

<img src="img/screens/replay_picker.png" width="640" alt="Replay a recorded session: two computer-made clips (OpenCV renders), Nine-Hole Peg Test and Waiter – cup">

| Clip | What to watch |
|---|---|
| `synthetic_cup_01` (Waiter – cup) | ArUco calibration → warped target sheet → finding the cup base → reach state machine. 32 reaches over 2 slow and 2 fast arcs. Watch the verified vs unverified counts and the progression prompt (Yes, go faster / Keep pace / Why?) before the fast arcs. On the AWS endpoint, also watch our agent's lines at the end of each arc (`source: agent` in the trace). |
| `synthetic_nhpt_01` (Nine-Hole Peg Test) | Board warp, Hough holes, HSV + contour pegs, masked `matchTemplate` occupancy, the peg state machine, the NHPT timer and per-peg splits. |

The replay clips are rendered, not filmed, so they show the pipeline working, not real-world accuracy (report §8.1). A replayed session gets a report just like a live one, but it is never counted in progress, adherence or trends.

<table><tr>
<td width="50%"><img src="img/screens/replay_nhpt.png" alt="Nine-Hole Peg Test replay: holes and seated pegs on the warped board, the timer from first peg lift, 4 of 9 seated, the coach caption and the Replay badge"></td>
<td width="50%"><img src="img/screens/report_cup.png" alt="Session report after the Waiter – cup replay, marked Replay · not counted, with verified and unverified movements and reach time per dot"></td>
</tr><tr>
<td><sub>NHPT replay mid-run (Replay badge top right)</sub></td>
<td><sub>The report after a cup replay: "Replay · not counted"</sub></td>
</tr></table>

## 4. With a webcam: try one exercise live (3 min)

The camera feed is processed in memory on the server and never stored. The red **"Live · not recording"** marker shows whenever the camera is on.

**Arm out to the side** needs no printout:
1. Home → **Start session** → **Arm out to the side** → watch the demonstration → answer the check-in (pain 0–10).
2. Camera setup: stand or sit about 2–2.5 m from the laptop, facing it, so your head, both shoulders and both elbows are in view. Your hips can be out of the picture. We never analyse the face, but the pose model finds a person by the head, so keep it in view (report §8.4).
3. Lift your arm out to the side to about shoulder height, hold for 3 s, then lower it. The angle shown is a progress estimate relative to the camera, not a clinical measurement. The 90° ceiling is enforced in code.
4. Things to try:
   - Lean your trunk sideways while lifting. A posture correction appears, and the third lean pauses the set and flags the therapist. This check needs your hips in view, so step back for it.
   - Walk out of view. The session pauses and says why, then carries on when you come back.
   - Tap **Pain / feel unwell** and give a 7 or higher. This stops the session.

**Waiter – cup** and the **Nine-Hole Peg Test** need a printed sheet (A4 or US Letter, at 100 % / actual size). The Home card links the sheet the day needs, each card on the Exercises screen has a **Get the sheet (PDF)** button, or use [`docs/sheets/cup_targets.pdf`](sheets/cup_targets.pdf) and [`docs/sheets/nhpt_board.pdf`](sheets/nhpt_board.pdf). Lay it flat 25–35 cm in front of the laptop and tilt the screen forward until the camera sees the whole sheet. Cover a corner marker with your hand and the setup hint will name that corner.

## 5. Run it locally instead (edge / privacy mode, ~3 min)

```bash
git clone https://github.com/Sathvik609/Praxis.git praxis && cd praxis
cd services/session && uv sync && uv run python tools/fetch_models.py   # SHA256-pinned Apache-2.0 ONNX models
uv run uvicorn praxis_session.main:app --port 8000
# in a second terminal, from the repo root
cd web && pnpm install && pnpm dev                                      # → http://localhost:5173
```

In this mode no frame leaves the laptop. The agent coach is off unless `PRAXIS_AGENT=anthropic` and an API key are set ([`docs/DEVELOPING.md`](DEVELOPING.md) → Agent coach). The rule coach and every stop rule work without it.

## 6. Where the evidence is

| Claim | Evidence |
|---|---|
| OpenCV 5 does the real vision work | [`docs/TECHNICAL_REPORT.md`](TECHNICAL_REPORT.md) §5, [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) §2, `services/session/praxis_session/perception/` |
| Runs on AWS Graviton with COOL | report §7, `/health` above, `infra/ec2/deploy.sh` |
| COOL vs stock OpenCV, measured | [`benchmark/results/cool_vs_stock_c8g.md`](../benchmark/results/cool_vs_stock_c8g.md) (regenerate: `benchmark/cool_bench.py`) |
| OpenCV output changes the agent's next action | `traces/agent/anthropic-sonnet-5-5/covered_marker.jsonl` and `green_cup.jsonl` (Claude Sonnet 5.5, 21 Oct; the earlier Sonnet 5 run is in `traces/agent/anthropic/`), [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) §3 |
| Agent evaluation: Claude Sonnet 5.5 on real video (REHAB24-6, 40 sessions) and on 15 scripted scenarios (15/15, 0 guardrail violations; a harder 16th, `mixed_signals`, passes 0 of 3 runs), plus the same runs with the agent off | [`evaluation/results/agent_recheck_2026-10-21_all.md`](../evaluation/results/agent_recheck_2026-10-21_all.md), [`agent_video_v0.md`](../evaluation/results/agent_video_v0.md), [`agent_ablation_v0.md`](../evaluation/results/agent_ablation_v0.md), report §8.3 |
| Arm angle on real video vs motion capture (REHAB24-6) | [`evaluation/results/rehab24_v0.md`](../evaluation/results/rehab24_v0.md), report §8.4 |
| Camera robustness (107 rendered conditions) and the browser run with a simulated camera | [`evaluation/results/robustness_v0.md`](../evaluation/results/robustness_v0.md), `web/scripts/e2e-fake-camera.mjs`, report §8.1 and §8.5 |
| Safety lives in code | `services/session/praxis_session/stop_rules.py`, `prescription.py` (clamps), report §9.1 |
| What is not done yet | report §10 (Limitations) |
