# Developing Praxis

Everything here is for running, testing and deploying the code. The project overview is in the [README](../README.md).

## Full local commands (edge / laptop mode)

<details>
<summary>Show the commands (print sheets, service, web app, Replay, evaluation, recordings)</summary>

```bash
# 0. Print the sheets at 100 % (A4 or US Letter). Check the scale bar measures 80 mm.
#    docs/sheets/nhpt_board.pdf · docs/sheets/cup_targets.pdf

# 1. Session service (Python 3.12 + uv). fetch_models downloads the Apache-2.0 OpenCV Zoo ONNX files (25 MB).
cd services/session && uv sync && uv run python tools/fetch_models.py && uv run uvicorn praxis_session.main:app --port 8000
#    → http://127.0.0.1:8000/health  {"status":"ok","opencv_version":"5.0.0","mode":"edge"}

# 2. Web app (pnpm). No sign-in: the app opens straight on Home (`/` redirects to `/details`).
cd web && pnpm install && pnpm dev
#    → http://localhost:5173/details  Home (affected areas) → Start session → Choose → Demonstration → check-in · /details/demo?exercise=cup&side=left shows the demonstration
#    → http://localhost:5173/details/setup?exercise=nhpt  (Vite picks the next port if 5173 is busy)
#    Click Allow on the camera prompt. Lay the printed NHPT sheet flat 25–35 cm in front of the
#    laptop and tilt the screen forward until the whole sheet shows (laptop camera only):
#    the checklist ticks over and "Continue" starts the session (setup never blocks: "Continue anyway").
#    → http://localhost:5173/session?hand=left            runs the Nine-Hole Peg Test live.
#      Pegs are found by colour. Bright pegs on a white sheet work out of the box; for wooden
#      or pale pegs, or a coloured/wooden board, seat one peg and tap that hole in the Board view
#      ("Pegs not showing? Seat one and tap that hole to sample its colour.") — the service samples a 6 mm patch and uses a
#      ±12° hue window from then on (WebSocket command {"cmd":"sample_colour","hole":k}), or press
#      "Pegs not found? Tap a peg on the picture" and tap a peg on the camera view.
#    → http://localhost:5173/session?exercise=cup&side=left runs Waiter – cup (any cup: keep it beside the sheet until the four corners are found, then on dot 1;
#      it is found as what changed on the empty sheet; docs/sheets/cup_targets.pdf. A blue band still works, and for
#      a band colour: press "Cup not found? Tap the cup base on the picture" and tap it, or Enter
#      for the cup on its dot; sends {"cmd":"sample_colour","x_px":..,"y_px":..}. Black/grey/white is refused with the reason).
#    → http://localhost:5173/session?exercise=abduction&side=left runs Arm out to the side (face the camera,
#      no sheet needed). A link to a hidden exercise (pendulum, arm, external_rotation, ...) goes back to Choose.
#    → http://localhost:8000/api/plan?pain=5  today's plan at the gentle tier.
#
#    Socket form (ids in services/session/praxis_session/perception/exercises.py):
#    ws://localhost:8000/ws/session?mode=arm&exercise=abduction&tier=gentle&side=left

# 3. Replay mode (no webcam) — the judge fallback, identical pipeline
#    In the app: Settings → Demo and judging → "Replay a recorded session" → pick a clip.
#    A replayed session is saved as `source: replay`: listed with a Replay badge (Progress,
#    therapist view, report, Home), never counted in trends, practice totals, pain lists,
#    adherence or the NHPT trend.
#    From the CLI:
cd services/session
uv run python -m praxis_session.replay ../../evaluation/dataset_v0/synthetic_nhpt_01.mp4 --mode nhpt --quiet

# 4. Regenerate every evaluation number
uv run python ../../evaluation/scripts/make_dataset_v0.py && uv run python ../../evaluation/scripts/eval.py
uv run python ../../evaluation/scripts/latency.py --replay          # results/latency_v0.{md,json}
uv run python tools/fetch_rehab24.py                                 # REHAB24-6 arm abduction, ~0.55 GB, git-ignored, CC BY-NC (evaluation only)
uv run python ../../evaluation/scripts/rehab24_eval.py               # real video vs motion capture: results/rehab24_v0.{md,json}
uv run python ../../evaluation/scripts/rehab24_thresholds.py         # hike allowance + front-gate fit/held-out: results/rehab24_thresholds_v0.{md,json}
uv run python ../../evaluation/blender/make_dataset_3d.py            # 3-D Blender renders of NHPT + Waiter – cup (~35 min, Blender 5.2; clips git-ignored)
uv run python ../../evaluation/scripts/eval_3d.py                    # synthetic 3-D results: results/synthetic3d_v0.{md,json} (--use-cache: no clips needed)

# 5. Real recordings (step by step for the whole team: evaluation/PROTOCOL.md)
uv run python tools/record_session.py record                         # consented clip, git-ignored, 30-day deletion
uv run python tools/label_clip.py <clip.mp4> --labeller <initials>   # keyboard labeller
uv run python tools/dataset_v1.py manifest                           # labelled clips -> manifest
uv run python ../../evaluation/scripts/eval.py --dataset ../../evaluation/dataset_v1
uv run python ../../evaluation/scripts/sus.py                        # SUS questionnaire scores
uv run python tools/record_session.py purge-expired                  # daily: deletes clips past 30 days
```

</details>

Tests: `uv run pytest -q` and `uv run ruff check .` (session) · `pnpm test && pnpm typecheck && pnpm lint` (web).

### Browser end-to-end check with a simulated camera

A real Chrome plays an OpenCV-rendered clip as if it were its webcam (`--use-file-for-fake-video-capture`). This way the whole path runs exactly as a judge sees it: camera setup → detection → session → coach → feedback → report, with no person and no printout. The clips show what a laptop camera sees of a printed sheet 25–35 cm in front of it (~40° tilt, upside down in the raw frame, sensor noise). They cover:

- the NHPT run
- Waiter – cup (2 slow + 2 fast arcs)
- the sheet leaving the view for 4 s
- a fingertip on one corner marker (setup)
- a hand over the two near corners mid-session (agent run)
- setups that are too dark, blurred or half out of frame

This is synthetic. It checks the product path, not real-world accuracy.

```bash
cd services/session && uv run python tools/make_fake_camera.py      # ~3 min, writes evaluation/fake_camera/ (git-ignored)
cd ../../web && pnpm build
cd ../services/session && PRAXIS_WEB_DIST=../../web/dist PRAXIS_DB=/tmp/praxis-e2e.db uv run uvicorn praxis_session.main:app --port 8100
cd ../../web && node scripts/e2e-fake-camera.mjs --origin http://127.0.0.1:8100 --out /tmp/praxis-e2e   # ~12 min
#   --only setup,arm,nhpt,cup,loss,replay (default) · agent (needs PRAXIS_AGENT=anthropic on the service: real model calls, a few cents) · --headed
```

It checks:

- the setup rows, and the hint the patient sees for each failure
- the overlay geometry against where the renderer put the sheet (and that the canvas mirrors with the video while the frames sent stay unmirrored)
- live counts, the timer and splits, and captions
- the trace and the latency line
- perception loss with pause and resume
- replay, and the report

Screenshots, the service's events for each run and `results.json` are saved in `--out`. The exit code is 1 when a check fails.

## Agent coach (Claude + OpenCV tools over MCP, optional)

This is off by default (`PRAXIS_AGENT=off`: rule coach only, exactly as before). When it is on, Claude Sonnet 5.5 (through Strands Agents) runs at checkpoints: check-in, the end of a set or arc, a stop-rule pause after unverified reps or lost tracking, the end of the peg test, and the end of the session. It calls OpenCV 5 tools served by FastMCP at `/mcp/perception`, `/mcp/exertion` and `/mcp/coach` (streamable HTTP, same port). Every dose change and every resume is a prompt the patient has to accept. Stop rules still run first. Details and the workflow diagram are in [`AGENT.md`](AGENT.md).

```bash
cd services/session
cp .env.example .env              # set ANTHROPIC_API_KEY and PRAXIS_AGENT=anthropic (.env is git-ignored)
uv run uvicorn praxis_session.main:app --port 8000 --env-file .env
curl -s localhost:8000/health     # "agent": {"mode": "anthropic", "model": "claude-sonnet-5-5", "mcp": true, "ready": true, "runs_today": 0, "daily_runs_limit": 100}
PRAXIS_AGENT=scripted uv run uvicorn praxis_session.main:app --port 8000   # no key: canned tool calls, for UI work
uv run python ../../evaluation/scripts/agent_eval.py --planner scripted    # 16 scenarios (scripted passes 15; mixed_signals needs judgement), free (CI)
uv run python ../../evaluation/scripts/agent_eval.py --planner rule        # baseline: agent off; writes the ablation table
uv run python ../../evaluation/scripts/agent_eval.py --planner anthropic --yes   # real model, prints the cost first (add --repeat N)
curl -s localhost:8000/api/agent/metrics   # runs today, outcomes, errors, first-action p50/p95, cap
```

Agent results and why we chose this model: report §8.3 and [`AGENT.md`](AGENT.md). To run the agent on real video:

```bash
uv run python ../../evaluation/scripts/agent_video_eval.py --planner rule                    # real video, free (needs tools/fetch_rehab24.py)
uv run --env-file .env python ../../evaluation/scripts/agent_video_eval.py --planner anthropic --model claude-sonnet-5-5 --repeat 2 --yes   # ~$2.00 on Sonnet 5.5
```

## One-container deploy (Railway / any Docker host)

<details>
<summary>Show deploy details (single origin, team-test mode, therapist-only writes, Docker)</summary>

The image builds the web app and serves it from the session service. So the browser talks to **one origin** for the page, `/api`, `/health`, `/events` and the WebSocket (`/ws/session`). The build context is the repo root. Models are fetched (SHA256-pinned) at build time. The SQLite store lives in `/app/data` and does not persist unless a volume is mounted. `PORT` is honoured, and `railway.json` points Railway at the Dockerfile and the `/health` check.

**Team test (review build only).** With `PRAXIS_TEAM_TEST=1`, the app asks each browser once "Who's testing?" (a name, no password; **Skip** saves the sessions as `guest`) and saves every session under that name. `GET /api/review?format=md` (also in Settings › Demo and judging › Team test report) lists, for each exercise and tester:

- verified and unverified reps, and why
- tracking losses, and which marker or body part went missing
- stop rules that fired
- coach corrections
- the screen-08 answers

The most widespread problems come first (`praxis_session/review.py`). With the agent on (`PRAXIS_AGENT=anthropic`), an "AI coach" section reads each session's trace. It shows runs and outcomes, triggers, tools called and tools that failed (a guardrail refusal, for example a stale run or a dose already in force, is listed separately from a failure), MCP vs direct transport, errors (the rule coach takes over), dropped output, time from checkpoint to first action, tokens and an estimated cost. Only live sessions count; replays and the sample history do not. A session is stored only when its feedback arrives, so the review also counts live sockets that closed before that (close code, whether an agent run was in flight, seconds since the last agent run; trace row `socket_close`). On Railway the store sits on a volume at `/app/data`, so it survives redeploys. The service runs in US East (`us-east4-eqdc4a`); we moved it from Amsterdam on 13 Oct to cut live-frame lag. The flag is off by default.

**Therapist-only writes (21 Oct).** There is no sign-in (Cognito is deferred). So the two therapist actions, Edit practice days (`PUT /api/prescription/schedule`) and Mark reviewed (`POST /api/flags/{id}/reviewed`), are guarded by `PRAXIS_THERAPIST_TOKEN`:

- If it is set, only a request carrying `X-Praxis-Therapist-Token: <token>` can write.
- If it is unset (the default), only a local request with no proxy headers can write (your laptop). Every request through Railway, CloudFront or the EC2 proxy gets 403, and the therapist screen shows "Therapist only … Nothing was changed".

To edit from a browser on a hosted build, set the token on the server and run `localStorage.setItem('praxis.therapistToken', '<token>')` in that browser's console. `/health` says which rule is active (`therapist_writes: token | local_only`). Reads and the patient's own writes (check-in, goal log, self-report, feedback edit) stay open.

```bash
docker build -f services/session/Dockerfile -t praxis .
docker run -p 8000:8000 praxis            # → http://127.0.0.1:8000/
```

You can also serve a build locally without Docker: `cd web && pnpm build`, then start uvicorn with `PRAXIS_WEB_DIST=../../web/dist`. This is still the **edge build** (`PRAXIS_CLOUD_ENABLED=0`, rule-based coach). If you host it remotely, webcam frames travel to the host over TLS, where they are processed in memory and thrown away, never stored. The AWS cloud mode is separate: Graviton4 c8g + COOL OpenCV behind CloudFront HTTPS (`infra/ec2/`, `docs/ENGINEERING_NOTES.md` §5).

</details>

## Static design preview (for designers; not the product)

`cd web && pnpm build:design` (optionally `--outDir <dir>`) builds a click-through copy of the app into `web/dist-design/`. It needs **no service and no camera**. It uses relative asset URLs, hash routing and unminified output. Only `--mode design` includes `src/designPreview/`; `pnpm build` is unchanged.

Every screen reads fixtures captured from the live service (`node scripts/capture-design-fixtures.mjs`). Sessions replay recorded event streams. For NHPT and Waiter – cup, these are the synthetic replay clips recorded over the service's WebSocket. For Arm out to the side and Camera setup, they come from the service's pipeline run offline on synthetic input (`uv run python ../../web/scripts/record-design-streams.py` from `services/session`). The camera shows a labelled placeholder, and every page has a "Design preview · sample data · no camera" tab. Nothing is measured or stored. Writes (flag reviewed, schedule edit, check-in) live in page memory until you reload.

## Layout

```
services/session/   FastAPI + OpenCV 5 + stop rules + coach (one process)
web/                React + TS + Vite, Radix + Tailwind 4, Three.js avatar
infra/ec2/          AWS deploy script, systemd unit, CloudWatch setup (no CDK app)
evaluation/         dataset, scripts, results
benchmark/          COOL vs stock OpenCV harness + results (11 Oct)
traces/             coach JSON traces
video/              video kit: capture script, slides
docs/               TECHNICAL_REPORT.md (submission), JUDGE_QUICKSTART.md, ARCHITECTURE.md, AGENT.md, ENGINEERING_NOTES.md, ACCESSIBILITY.md, LICENSES.md, sheets/, wireframes/, img/
```
