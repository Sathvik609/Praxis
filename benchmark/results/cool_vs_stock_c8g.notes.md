## Which run this is
- **v1 (this table, 11 Oct 2026 19:40 UTC, `raw_v1/`)** times the 11 Oct code, after that day's perception audit, which added a brightness normalisation of the warped sheet. It makes the board and cup sheets work in dim and warm light, and it is why `warpPerspective` and the cup stage grew by about 0.7 ms and 2 ms against v0.
- **v0 (earlier on 11 Oct, `raw_v0/`)** is the first measurement, kept for comparison: `python benchmark/summarize.py --raw benchmark/results/raw_v0 --out /tmp/v0.md`.
- Same instance, AMI, inputs and method for both runs. That was the 11 Oct c8g.large; the judge server rebuilt on 21 Oct uses the same COOL AMI and instance type, and the benchmark was not re-run on it. The perception changes made after 11 Oct are not timed here.

## Reading it honestly
- **COOL is faster on the stages that dominate board perception:** HSV thresholding 1.6x, contour extraction 1.5x, `HoughCircles` 1.4x and masked `matchTemplate` 1.2x.
- **It is slower on JPEG decode, ArUco detection, the warp and the `cv2.dnn` hand model** (0.86–0.91x). The stock 5.0.0 wheel already bundles a newer KleidiCV (26.03) than COOL's build (0.7.0), so the wheel is a strong baseline on Graviton, not an unoptimised one.
- **End to end:** the classical NHPT frame is 1.03x with COOL and the cup frame 0.94x. Both builds process a classical frame in under 8 ms, far inside the 66–100 ms budget at 10–15 fps.
- **Per frame, COOL costs slightly more:** its AMI adds $0.01/h, and the end-to-end speed-up does not offset that. At these rates either build costs well under $0.001 per 1,000 frames, so compute cost is not the deciding factor for one patient session.
- **Why Praxis still runs COOL in production** (`/health` → `opencv_build.cool: true`): it executes the full workload on Graviton, it speeds up the NHPT board stages, and the full service test suite passed on it (634 / 636 on 11 Oct, on the instance the judge server replaced; the two failures check `.gitignore` rules and need a git checkout).
- **Not measured:** an x86 (c7i) reference, multi-session throughput under load, and the browser-to-cue latency through CloudFront.

## Reproduce
On the judge server (c8g.large, COOL AMI), from a copy of the repo at `/opt/praxis/repo`:
```bash
python benchmark/cool_bench.py --prep /opt/praxis/bench_frames                       # once, any venv
for r in 1 2 3; do
  PYTHONPATH=/opt/cool/python_3.12/site-packages LD_LIBRARY_PATH=/opt/cool/cpp_sdk/lib \
    /opt/praxis/testvenv/bin/python benchmark/cool_bench.py --frames /opt/praxis/bench_frames --label cool --out benchmark/results/raw_v1/cool_r$r.json
  /opt/praxis/stockvenv/bin/python benchmark/cool_bench.py --frames /opt/praxis/bench_frames --label stock --out benchmark/results/raw_v1/stock_r$r.json
done
python benchmark/summarize.py          # writes this file from raw_v1/ (+ this notes file)
```
`testvenv` is the service's pinned dependencies without the OpenCV wheel, so `cv2` resolves to COOL. `stockvenv` is the same with `opencv-python-headless==5.0.0.93`.
