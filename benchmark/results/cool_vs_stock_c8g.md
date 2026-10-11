# COOL vs stock OpenCV on Praxis's per-frame work (11 Oct 2026)

Host: one **c8g.large** (AWS Graviton4, Neoverse-V2, 2 vCPU), us-east-2, launched from the COOL Marketplace AMI `ami-005a9f90c70ba8d9b` (Cloud Optimized OpenCV for AWS Graviton). Both builds ran on the same instance, Python 3.12.3, same pinned Praxis code, same input bytes, 2 OpenCV threads, alternating COOL / stock for 3 rounds x 5 passes (one warm-up pass each). Numbers are the median over rounds of the per-call p50 / p95.

| Build | `cv2.__version__` | Source | SIMD baseline | HAL |
|---|---|---|---|---|
| COOL | 5.1.0-dev | `/opt/cool/python_3.12/site-packages` | SVE NEON FP16 NEON_DOTPROD NEON_FP16 NEON_BF16 | YES (carotene (ver 0.0.1) KleidiCV (ver 0.7.0)) |
| Stock | 5.0.0 | pinned wheel `opencv-python-headless==5.0.0.93` | NEON FP16 | YES (carotene (ver 0.0.1) KleidiCV (ver 26.03)) |

Inputs: the two replay clips in `evaluation/dataset_v0` (NHPT 185 frames, cup 517 frames), resized to 640x480 and JPEG-encoded at quality 80 once (what the browser sends), so both builds time identical bytes.

| Stage (ms per frame, p50 / p95) | Stock 5.0.0 | COOL 5.1.0-dev | Speed-up (stock/COOL p50) |
|---|---|---|---|
| JPEG decode (`imdecode`) | 0.567 / 0.575 | 0.621 / 0.630 | 0.91x |
| ArUco + homography + solvePnP (`Calibrator.run`) | 1.875 / 1.987 | 2.178 / 2.313 | 0.86x |
| `warpPerspective` to canonical sheet | 0.470 / 0.473 | 0.489 / 0.492 | 0.96x |
| Hole finding (`GaussianBlur` + `HoughCircles`) | 2.618 / 2.870 | 1.982 / 2.096 | 1.32x |
| Peg mask (`cvtColor` HSV + `inRange`) | 0.482 / 0.491 | 0.303 / 0.314 | 1.59x |
| Peg blobs (mask + `findContours` + moments) | 0.566 / 0.609 | 0.381 / 0.419 | 1.49x |
| Hole occupancy (masked `matchTemplate` x9) | 3.337 / 3.654 | 2.830 / 2.933 | 1.18x |
| Cup (warp + `inRange` + `findContours`) | 1.286 / 1.304 | 1.538 / 1.579 | 0.84x |
| **Full NHPT frame** (`SessionPipeline.process`, classical) | 6.839 / 7.018 | 6.508 / 6.703 | 1.05x |
| **Full cup frame** (`SessionPipeline.process`, classical) | 3.592 / 3.700 | 3.896 / 4.122 | 0.92x |
| Hand model (`cv2.dnn` palm + landmarks ONNX), not classical | 21.357 / 21.750 | 24.376 / 24.727 | 0.88x |

## Reading it honestly
- COOL is faster on the stages that dominate board perception: HSV thresholding (1.6x), contour extraction (1.5x), `HoughCircles` (1.3x) and masked `matchTemplate` (1.2x).
- It is slower on JPEG decode, ArUco detection, the cup stage and the `cv2.dnn` hand model (0.84-0.91x). The stock 5.0.0 wheel already bundles a newer KleidiCV (26.03) than COOL's build (0.7.0), so the wheel is not an unoptimised baseline on Graviton.
- End to end the classical NHPT frame is 1.05x faster with COOL and the cup frame 0.92x. Both builds process a frame in under 7 ms, far inside the 66-100 ms per-frame budget at 10-15 fps; on a 2-vCPU c8g.large either build leaves >90 % of a core free per session.
- Praxis runs COOL in production on the instance (`/health` -> `opencv_build.cool: true`) and the full service test suite passes on it (634 / 636; the two failures check `.gitignore` rules and need a git checkout).

## Reproduce
```bash
python benchmark/cool_bench.py --prep /opt/praxis/bench_frames                       # stock venv
PYTHONPATH=/opt/cool/python_3.12/site-packages LD_LIBRARY_PATH=/opt/cool/cpp_sdk/lib \
  /opt/praxis/testvenv/bin/python benchmark/cool_bench.py --frames /opt/praxis/bench_frames --label cool --out benchmark/results/raw/cool_r1.json
/opt/praxis/stockvenv/bin/python benchmark/cool_bench.py --frames /opt/praxis/bench_frames --label stock --out benchmark/results/raw/stock_r1.json
```
Raw JSON per round: `benchmark/results/raw/`.
