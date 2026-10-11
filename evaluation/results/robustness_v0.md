# Perception robustness v0 — synthetic renders

**Synthetic renders, not real-camera evidence.** Every frame is an OpenCV render of the printed sheet (`perception/synth.py`, flat discs for pegs, cup base and hand) perturbed in image space; the REAL product code is measured on it (`Calibrator`, `quality.build_checks`, `BoardState`, `CupSheetState`). Real lenses, 3-D pegs and cups, specular paper, auto-exposure and motion are not in it. Regenerate with `cd services/session && uv run python ../../evaluation/scripts/robustness.py`.

OpenCV 5.0.0 · generated 2026-10-11 · baseline: tilt 40.0°, yaw 5.0°, sheet fills ~80 % of 640×480, lens f = 1.4·w, noise σ3.0, JPEG q70 (what the browser sends). Each row changes one thing from the baseline unless it is in the *combined* group.

Columns: **cal** = first fix (all four markers, fresh calibrator); **session** = running session primed with a clean frame (fresh / partial = three markers / held = fewer, 1.5 s); **RMS** = the homography's reprojection RMS on the marker corners; **err** = worst true target position error after the round trip frame → mm; **tilt** = measured (true); **setup rows** = rows of screen 05 that fire, and whether that is the right advice for the condition.

## Summary

| | NHPT board | Waiter – cup |
|---|---|---|
| conditions | 81 | 91 |
| first fix (all four markers) | 74 | 83 |
| running session still calibrated (fresh / partial / held ≤ 1.5 s) | 81 | 91 |
| occupancy all correct / cup found within 10 mm (when calibrated) | 69 of 74 | 67 of 77 |
| phantoms (empty hole read occupied, extra free peg / cup where none) | 1 | 0 |
| setup rows right for the condition | 81 of 81 | 91 of 91 |

Worst target round-trip error over all calibrated frames: 10.64 mm (paper curl, ends up 20 mm, cup); median 0.23 mm. Remaining misses are physics or by design: blur that destroys the marker codes (the hint says so), a hand hiding ~80 % of the cup base (the FSM infers the placement and marks it unverified), cup and peg colours outside the default windows until the patient taps to sample, black pegs and a black cup band (no colour to segment, even sampled), a peg on a 45 %-filled far frame with defocus (the setup row asks to come closer), and a sheet curled 20 mm (8–11 mm target error; nothing flags it, see below).

Known blind spot: the homography's RMS rises with curl (0.8 mm at 5 mm, 1.5 mm at 10 mm, 3 mm at 20 mm) but also with lens distortion (≈1–2 mm at k1 = −0.25) and distance, so it is reported, not used as a 'sheet not flat' gate, until real recordings separate the two.

## What the first run found and what changed (11 Oct 2026)

| condition | before | fix |
|---|---|---|
| Dim room (mean luma 30–45) | NHPT lost every peg at luma 30; the cup base was missed at 30 and 45 | board/cup warp divides by the paper's own brightness (grey closing → flat field + white balance) |
| Warm bulb + noise | the paper itself read as 6–7 phantom pegs (warm laptop scene, dim evening) | same paper normalisation: the paper is white again before the HSV windows |
| Deep skin tone over the grid | 4 phantom pegs (skin V 75 was under the skin band's V ≥ 80 floor) | skin band V floor 80 → 40; every tone in the sweep now reads clean |
| Pen on the sheet | a red/blue pen was a free peg (NHPT) and an 85 mm-off phantom cup | free pegs ≤ 45 mm long; the cup blob must be cup-shaped (minAreaRect aspect ≤ 3) |
| Fingers across the cup (~55 % of the base visible) | no cup (three pieces, none cup-sized) | the base is the union of the pieces within 40 mm of the largest (tests/test_perception_robustness.py) |
| Mirrored video | no marker decodes in a mirror image: never calibrated, hint said 'flatten the sheet' | ArUco re-runs on cv2.flip and the corners are mapped back (calibration.mirrored) |
| Sheet partly out of frame / blurred corner / blur | hint always said 'Flatten the sheet and keep it in view' | missing markers are predicted from the visible ones: 'outside the picture', 'covered', or 'in view but cannot be read' |
| A4 PDF printed on US Letter | top- or bottom-aligned by the viewer, two corner markers were cut off: never calibrated | the page is cut to 210 × 279.4 mm (what A4 and Letter share); geometry unchanged |
| 16:9 camera squashed to 640×480 | camera-angle row read 45° as ~23° (square-pixel model broken) | the web centre-crops to 4:3 before encoding (web/src/session/useWebcamStream.ts); the row below is the server on a squashed frame |

## NHPT board sheet

| condition | cal | session | RMS mm | err mm | tilt ° | holes | occupancy (pegs 0,4,8) | free peg | phantoms | setup rows |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline (tilt 40°, JPEG q70, σ3) | yes | fresh | 0.348 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| tilt 0° | yes | fresh | 0.145 | 0.23 | 5.3 (5.0) | hough | ok | yes | 0 | none (right) |
| tilt 20° | yes | fresh | 0.259 | 0.26 | 20.6 (20.6) | hough | ok | yes | 0 | none (right) |
| tilt 45° | yes | fresh | 0.322 | 0.36 | 45.2 (45.2) | hough | ok | yes | 0 | none (right) |
| tilt 50° | yes | fresh | 0.399 | 0.3 | 50.1 (50.2) | hough | ok | yes | 0 | angle: “Tilt the laptop screen forward and move the sheet closer, so the camera looks down at it.” (right) |
| tilt 55° | yes | fresh | 0.446 | 0.17 | 55.2 (55.2) | hough | ok | yes | 0 | angle: “Tilt the laptop screen forward and move the sheet closer, so the camera looks down at it.” (right) |
| tilt 60° | yes | fresh | 0.496 | 0.42 | 60.2 (60.1) | hough | ok | yes | 0 | angle: “Tilt the laptop screen forward and move the sheet closer, so the camera looks down at it.” (right) |
| tilt 65° | yes | fresh | 1.089 | 0.53 | 65.0 (65.1) | hough | ok | yes | 0 | angle: “Tilt the laptop screen forward and move the sheet closer, so the camera looks down at it.” (right) |
| lens f=0.7·w, tilt 45° | yes | fresh | 0.37 | 0.18 | 45.2 (45.2) | hough | ok | yes | 0 | none (right) |
| lens f=0.9·w, tilt 45° | yes | fresh | 0.392 | 0.29 | 45.1 (45.2) | hough | ok | yes | 0 | none (right) |
| lens f=1.1·w, tilt 45° | yes | fresh | 0.277 | 0.27 | 45.2 (45.2) | hough | ok | yes | 0 | none (right) |
| lens f=2.0·w, tilt 45° | yes | fresh | 0.352 | 0.2 | 45.1 (45.2) | hough | ok | yes | 0 | none (right) |
| sheet rotated 30° in plane | yes | fresh | 0.271 | 0.26 | 40.2 (40.3) | hough | ok | yes | 0 | none (right) |
| sheet rotated 90° in plane | yes | fresh | 0.345 | 0.24 | 40.1 (40.3) | hough | ok | yes | 0 | none (right) |
| sheet rotated 180° in plane | yes | fresh | 0.312 | 0.22 | 40.2 (40.3) | hough | ok | yes | 0 | none (right) |
| sheet rotated 270° in plane | yes | fresh | 0.313 | 0.37 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| sheet fills 30% of frame | yes | fresh | 0.933 | 1.19 | 40.2 (40.3) | mixed | ok | yes | 0 | task_area: “Move the camera closer so the sheet fills more of the view.” (right) |
| sheet fills 40% of frame | yes | fresh | 0.717 | 0.62 | 40.1 (40.3) | hough | ok | yes | 0 | task_area: “Move the camera closer so the sheet fills more of the view.” (right) |
| sheet fills 50% of frame | yes | fresh | 0.633 | 0.66 | 40.5 (40.3) | hough | ok | yes | 0 | task_area: “Move the camera closer so the sheet fills more of the view.” (right) |
| sheet fills 60% of frame | yes | fresh | 0.48 | 0.24 | 40.4 (40.3) | hough | ok | yes | 0 | none (right) |
| sheet fills 100% of frame | yes | fresh | 0.254 | 0.32 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| dim, mean luma 30 | yes | fresh | 0.281 | 0.27 | 40.3 (40.3) | hough | ok | yes | 0 | lighting: “Too dark. Add light in front of you, not behind.” (right) |
| dim, mean luma 45 | yes | fresh | 0.327 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | lighting: “Too dark. Add light in front of you, not behind.” (right) |
| dim, mean luma 65 | yes | fresh | 0.33 | 0.21 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| bright, gain ×1.5 | yes | fresh | 0.39 | 0.24 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| bright, gain ×2.2 | yes | fresh | 0.437 | 0.27 | 40.2 (40.3) | hough | ok | yes | 0 | lighting: “Too bright. Move the lamp or close the blind.” (right) |
| warm tungsten white balance | yes | fresh | 0.37 | 0.21 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| cool / daylight-LED white balance | yes | fresh | 0.368 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| soft shadow gradient (100%→35%) | yes | fresh | 0.36 | 0.23 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| hard shadow edge (45%) | yes | fresh | 0.333 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| Gaussian noise σ6 | yes | fresh | 0.332 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| Gaussian noise σ12 | yes | fresh | 0.358 | 0.24 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| Gaussian noise σ20 | yes | fresh | 0.335 | 0.23 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| motion blur 5 px | yes | fresh | 0.591 | 0.38 | 40.4 (40.3) | hough | ok | yes | 0 | none (right) |
| motion blur 9 px | **no** | held | – | – | – (40.3) | – | – | – | – | markers: “The corner markers cannot be read. If the sheet is in view, hold the laptop still, wipe the lens and add light.” (right) |
| motion blur 15 px | **no** | held | – | – | – (40.3) | – | – | – | – | markers: “The corner markers cannot be read. If the sheet is in view, hold the laptop still, wipe the lens and add light.” (right) |
| defocus r2 | yes | fresh | 0.462 | 0.25 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| defocus r3 | yes | fresh | 1.172 | 0.35 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| defocus r5 | **no** | held | – | – | – (40.3) | – | – | – | – | markers: “The corner markers cannot be read. If the sheet is in view, hold the laptop still, wipe the lens and add light.”, lighting: “Image is blurry. Clean the lens or hold the camera still.” (right) |
| JPEG q40 | yes | fresh | 0.345 | 0.21 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| JPEG q60 | yes | fresh | 0.355 | 0.23 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| JPEG q80 | yes | fresh | 0.337 | 0.23 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| JPEG q90 | yes | fresh | 0.317 | 0.23 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| hand over marker 2 (one marker) | **no** | partial | – | – | – (40.3) | – | – | – | – | markers: “The marker in the bottom-right corner (2) is covered or creased: clear and flatten it.” (right) |
| hand over markers 1+2 (two markers) | **no** | held | – | – | – (40.3) | – | – | – | – | markers: “The markers in the top-right corner (1), bottom-right corner (2) are covered or creased: clear and flatten them.” (right) |
| light skin hand over hole grid | yes | fresh | 0.341 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| medium skin hand over hole grid | yes | fresh | 0.35 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| dark skin hand over hole grid | yes | fresh | 0.349 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| deep skin hand over hole grid | yes | fresh | 0.351 | 0.21 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| peg colour red (default mask) | yes | fresh | 0.34 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| peg colour red (tap-to-sample) | yes | fresh | 0.344 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| peg colour blue (default mask) | yes | fresh | 0.346 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| peg colour blue (tap-to-sample) | yes | fresh | 0.354 | 0.21 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| peg colour green (default mask) | yes | fresh | 0.348 | 0.23 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| peg colour green (tap-to-sample) | yes | fresh | 0.331 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| peg colour yellow (default mask) | yes | fresh | 0.339 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| peg colour yellow (tap-to-sample) | yes | fresh | 0.346 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| peg colour wood/beige (default mask) | yes | fresh | 0.349 | 0.22 | 40.3 (40.3) | hough | **wrong [0, 4, 8]** | **no** | 0 | none (right) |
| peg colour wood/beige (tap-to-sample) | yes | fresh | 0.327 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| peg colour black (default mask) | yes | fresh | 0.329 | 0.21 | 40.3 (40.3) | hough | **wrong [0, 4, 8]** | **no** | 0 | none (right) |
| peg colour black (tap-to-sample) | yes | fresh | 0.345 | 0.22 | 40.3 (40.3) | hough | **wrong [0, 4, 8]** | **no** | 0 | none (right) |
| wood-grain table | yes | fresh | 0.335 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| wood table + objects around the sheet | yes | fresh | 0.34 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| objects around + blue/red pens on the sheet | yes | fresh | 0.349 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| sheet PDF (210 × 279.4 page, 11 Oct) on US Letter, any alignment | yes | fresh | 0.341 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| old full-A4 PDF on US Letter, top-aligned | **no** | held | – | – | – (40.3) | – | – | – | – | markers: “The markers in the bottom-right corner (2), bottom-left corner (3) are covered or creased: clear and flatten them.” (right) |
| old full-A4 PDF on US Letter, bottom-aligned | **no** | held | – | – | – (40.3) | – | – | – | – | markers: “The markers in the top-left corner (0), top-right corner (1) are in view but cannot be read: hold the laptop still, wipe the lens and add light.” (right) |
| barrel lens distortion k1=-0.1 (f 0.8 w, tilt 45°) | yes | fresh | 0.554 | 0.52 | 45.1 (45.2) | hough | ok | yes | 0 | none (right) |
| barrel lens distortion k1=-0.25 (f 0.8 w, tilt 45°) | yes | fresh | 0.988 | 1.12 | 45.0 (45.2) | hough | ok | yes | 0 | none (right) |
| paper curl, ends up 5 mm | yes | fresh | 0.809 | 1.88 | 40.2 (40.3) | hough | ok | yes | 0 | none (right) |
| paper curl, ends up 10 mm | yes | fresh | 1.466 | 3.88 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| paper curl, ends up 20 mm | yes | fresh | 3.037 | 7.81 | 40.1 (40.3) | spec | **wrong [4, 8]** | **no** | **1** | none (right) |
| folded crease, ridge 4 mm | yes | fresh | 0.56 | 1.17 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| folded crease, ridge 8 mm | yes | fresh | 1.005 | 2.38 | 40.3 (40.3) | mixed | ok | yes | 0 | none (right) |
| mirrored frame | yes | fresh | 0.336 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| 16:9 camera squashed to 640×480 | yes | fresh | 0.334 | 0.34 | 22.9 (45.2) | hough | ok | yes | 0 | none (right) |
| laptop: tilt 45, f 0.9 w, fill 60%, warm, σ5, wood + clutter | yes | fresh | 0.626 | 0.36 | 45.2 (45.2) | hough | ok | yes | 0 | none (right) |
| dim evening: luma 45, warm, σ8 | yes | fresh | 0.361 | 0.22 | 40.3 (40.3) | hough | ok | yes | 0 | lighting: “Too dark. Add light in front of you, not behind.” (right) |
| desk lamp: hard shadow + gain ×1.5 | yes | fresh | 0.388 | 0.23 | 40.3 (40.3) | hough | ok | yes | 0 | none (right) |
| far + soft focus: fill 45%, defocus r2, σ5 | yes | fresh | 1.338 | 0.47 | 40.0 (40.3) | mixed | **wrong [0]** | yes | 0 | task_area: “Move the camera closer so the sheet fills more of the view.” (right) |
| sideways sheet, tilt 50, f 0.8 w | yes | fresh | 0.429 | 0.16 | 50.2 (50.2) | hough | ok | yes | 0 | angle: “Tilt the laptop screen forward and move the sheet closer, so the camera looks down at it.” (right) |

## Waiter – cup target sheet

| condition | cal | session | RMS mm | err mm | tilt ° | cup found | cup error mm | result | setup rows |
|---|---|---|---|---|---|---|---|---|---|
| baseline (tilt 40°, JPEG q70, σ3) | yes | fresh | 0.216 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| tilt 0° | yes | fresh | 0.096 | 0.29 | 4.4 (5.0) | yes | 0.5 | ok | none (right) |
| tilt 20° | yes | fresh | 0.161 | 0.27 | 20.7 (20.6) | yes | 0.5 | ok | none (right) |
| tilt 45° | yes | fresh | 0.176 | 0.28 | 45.2 (45.2) | yes | 0.5 | ok | none (right) |
| tilt 50° | yes | fresh | 0.24 | 0.23 | 50.2 (50.2) | yes | 0.4 | ok | angle: “Tilt the laptop screen forward and move the sheet closer, so the camera looks down at it.” (right) |
| tilt 55° | yes | fresh | 0.238 | 0.27 | 55.2 (55.2) | yes | 0.5 | ok | angle: “Tilt the laptop screen forward and move the sheet closer, so the camera looks down at it.” (right) |
| tilt 60° | yes | fresh | 0.376 | 0.31 | 60.1 (60.1) | yes | 0.4 | ok | angle: “Tilt the laptop screen forward and move the sheet closer, so the camera looks down at it.” (right) |
| tilt 65° | yes | fresh | 0.299 | 0.49 | 65.2 (65.1) | yes | 0.6 | ok | angle: “Tilt the laptop screen forward and move the sheet closer, so the camera looks down at it.” (right) |
| lens f=0.7·w, tilt 45° | yes | fresh | 0.188 | 0.25 | 45.1 (45.2) | yes | 0.5 | ok | none (right) |
| lens f=0.9·w, tilt 45° | yes | fresh | 0.179 | 0.24 | 45.2 (45.2) | yes | 0.5 | ok | none (right) |
| lens f=1.1·w, tilt 45° | yes | fresh | 0.255 | 0.3 | 45.3 (45.2) | yes | 0.5 | ok | none (right) |
| lens f=2.0·w, tilt 45° | yes | fresh | 0.21 | 0.26 | 45.3 (45.2) | yes | 0.5 | ok | none (right) |
| sheet rotated 30° in plane | yes | fresh | 0.158 | 0.23 | 40.3 (40.3) | yes | 0.5 | ok | none (right) |
| sheet rotated 90° in plane | yes | fresh | 0.187 | 0.24 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| sheet rotated 180° in plane | yes | fresh | 0.218 | 0.22 | 40.2 (40.3) | yes | 0.4 | ok | none (right) |
| sheet rotated 270° in plane | yes | fresh | 0.236 | 0.28 | 40.3 (40.3) | yes | 0.5 | ok | none (right) |
| sheet fills 30% of frame | yes | fresh | 0.604 | 0.5 | 40.3 (40.3) | yes | 0.3 | ok | task_area: “Move the camera closer so the sheet fills more of the view.” (right) |
| sheet fills 40% of frame | yes | fresh | 0.617 | 0.39 | 40.5 (40.3) | yes | 0.5 | ok | none (right) |
| sheet fills 50% of frame | yes | fresh | 0.446 | 0.3 | 40.2 (40.3) | yes | 0.5 | ok | none (right) |
| sheet fills 60% of frame | yes | fresh | 0.39 | 0.41 | 40.3 (40.3) | yes | 0.6 | ok | none (right) |
| sheet fills 100% of frame | **no** | partial | – | – | – (40.3) | – | – | – | markers: “The top-left corner (0) is outside the picture: move the sheet into the middle of the view, or tilt the screen.” (right) |
| dim, mean luma 30 | yes | fresh | 0.22 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | lighting: “Too dark. Add light in front of you, not behind.” (right) |
| dim, mean luma 45 | yes | fresh | 0.233 | 0.24 | 40.3 (40.3) | yes | 0.4 | ok | lighting: “Too dark. Add light in front of you, not behind.” (right) |
| dim, mean luma 65 | yes | fresh | 0.226 | 0.25 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| bright, gain ×1.5 | yes | fresh | 0.279 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| bright, gain ×2.2 | yes | fresh | 0.347 | 0.24 | 40.3 (40.3) | yes | 0.4 | ok | lighting: “Too bright. Move the lamp or close the blind.” (right) |
| warm tungsten white balance | yes | fresh | 0.231 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| cool / daylight-LED white balance | yes | fresh | 0.221 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| soft shadow gradient (100%→35%) | yes | fresh | 0.217 | 0.25 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| hard shadow edge (45%) | yes | fresh | 0.229 | 0.26 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| Gaussian noise σ6 | yes | fresh | 0.218 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| Gaussian noise σ12 | yes | fresh | 0.225 | 0.25 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| Gaussian noise σ20 | yes | fresh | 0.248 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| motion blur 5 px | yes | fresh | 0.264 | 0.24 | 40.3 (40.3) | yes | 0.5 | ok | none (right) |
| motion blur 9 px | **no** | partial | – | – | – (40.3) | – | – | – | markers: “The marker in the bottom-right corner (2) is in view but cannot be read: hold the laptop still, wipe the lens and add light.” (right) |
| motion blur 15 px | **no** | held | – | – | – (40.3) | – | – | – | markers: “The corner markers cannot be read. If the sheet is in view, hold the laptop still, wipe the lens and add light.” (right) |
| defocus r2 | yes | fresh | 0.286 | 0.25 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| defocus r3 | yes | fresh | 0.462 | 0.26 | 40.4 (40.3) | yes | 0.5 | ok | none (right) |
| defocus r5 | **no** | partial | – | – | – (40.3) | – | – | – | markers: “The marker in the top-left corner (0) is in view but cannot be read: hold the laptop still, wipe the lens and add light.”, lighting: “Image is blurry. Clean the lens or hold the camera still.” (right) |
| JPEG q40 | yes | fresh | 0.215 | 0.24 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| JPEG q60 | yes | fresh | 0.218 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| JPEG q80 | yes | fresh | 0.218 | 0.24 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| JPEG q90 | yes | fresh | 0.214 | 0.24 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| hand over marker 2 (one marker) | **no** | partial | – | – | – (40.3) | – | – | – | markers: “The marker in the bottom-right corner (2) is covered or creased: clear and flatten it.” (right) |
| hand over markers 1+2 (two markers) | **no** | held | – | – | – (40.3) | – | – | – | markers: “The markers in the top-right corner (1), bottom-right corner (2) are covered or creased: clear and flatten them.” (right) |
| light skin fingers across cup (~55% visible) | yes | fresh | 0.212 | 0.23 | 40.3 (40.3) | yes | 0.3 | ok | none (right) |
| light skin hand gripping cup (~22% visible) | yes | fresh | 0.214 | 0.23 | 40.3 (40.3) | **no** | – | **miss** | none (right) |
| light skin hand on sheet, no cup | yes | fresh | 0.212 | 0.23 | 40.3 (40.3) | no (none there) | – | ok | none (right) |
| medium skin fingers across cup (~55% visible) | yes | fresh | 0.213 | 0.23 | 40.3 (40.3) | yes | 0.3 | ok | none (right) |
| medium skin hand gripping cup (~22% visible) | yes | fresh | 0.211 | 0.23 | 40.3 (40.3) | **no** | – | **miss** | none (right) |
| medium skin hand on sheet, no cup | yes | fresh | 0.213 | 0.24 | 40.3 (40.3) | no (none there) | – | ok | none (right) |
| dark skin fingers across cup (~55% visible) | yes | fresh | 0.213 | 0.23 | 40.3 (40.3) | yes | 0.3 | ok | none (right) |
| dark skin hand gripping cup (~22% visible) | yes | fresh | 0.215 | 0.23 | 40.3 (40.3) | **no** | – | **miss** | none (right) |
| dark skin hand on sheet, no cup | yes | fresh | 0.213 | 0.23 | 40.3 (40.3) | no (none there) | – | ok | none (right) |
| deep skin fingers across cup (~55% visible) | yes | fresh | 0.212 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| deep skin hand gripping cup (~22% visible) | yes | fresh | 0.217 | 0.23 | 40.3 (40.3) | **no** | – | **miss** | none (right) |
| deep skin hand on sheet, no cup | yes | fresh | 0.209 | 0.23 | 40.3 (40.3) | no (none there) | – | ok | none (right) |
| cup band blue (default blue window) | yes | fresh | 0.212 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| cup band blue (tap-to-sample) | yes | fresh | 0.216 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| cup band red (default blue window) | yes | fresh | 0.216 | 0.24 | 40.3 (40.3) | **no** | – | **miss** | none (right) |
| cup band red (tap-to-sample) | yes | fresh | 0.215 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| cup band green (default blue window) | yes | fresh | 0.209 | 0.23 | 40.3 (40.3) | **no** | – | **miss** | none (right) |
| cup band green (tap-to-sample) | yes | fresh | 0.214 | 0.23 | 40.3 (40.3) | yes | 0.5 | ok | none (right) |
| cup band yellow (default blue window) | yes | fresh | 0.217 | 0.23 | 40.3 (40.3) | **no** | – | **miss** | none (right) |
| cup band yellow (tap-to-sample) | yes | fresh | 0.219 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| cup band orange (default blue window) | yes | fresh | 0.216 | 0.23 | 40.3 (40.3) | **no** | – | **miss** | none (right) |
| cup band orange (tap-to-sample) | yes | fresh | 0.207 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| cup band black (default blue window) | yes | fresh | 0.214 | 0.23 | 40.3 (40.3) | **no** | – | **miss** | none (right) |
| cup band black (tap-to-sample) | yes | fresh | 0.215 | 0.23 | 40.3 (40.3) | **no** | – | **miss** | none (right) |
| no cup on the sheet | yes | fresh | 0.214 | 0.23 | 40.3 (40.3) | no (none there) | – | ok | none (right) |
| wood-grain table | yes | fresh | 0.212 | 0.24 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| wood table + objects around the sheet | yes | fresh | 0.213 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| objects around + blue/red pens on the sheet | yes | fresh | 0.216 | 0.24 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| no cup, pens on the sheet | yes | fresh | 0.213 | 0.23 | 40.3 (40.3) | no (none there) | – | ok | none (right) |
| sheet PDF (210 × 279.4 page, 11 Oct) on US Letter, any alignment | yes | fresh | 0.214 | 0.24 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| old full-A4 PDF on US Letter, top-aligned | **no** | held | – | – | – (40.3) | – | – | – | markers: “The markers in the top-right corner (1), bottom-right corner (2) are in view but cannot be read: hold the laptop still, wipe the lens and add light.” (right) |
| old full-A4 PDF on US Letter, bottom-aligned | **no** | held | – | – | – (40.3) | – | – | – | markers: “The markers in the top-left corner (0), bottom-left corner (3) are in view but cannot be read: hold the laptop still, wipe the lens and add light.” (right) |
| barrel lens distortion k1=-0.1 (f 0.8 w, tilt 45°) | yes | fresh | 0.793 | 1.0 | 45.1 (45.2) | yes | 0.2 | ok | none (right) |
| barrel lens distortion k1=-0.25 (f 0.8 w, tilt 45°) | yes | fresh | 1.905 | 2.42 | 45.0 (45.2) | yes | 0.4 | ok | none (right) |
| paper curl, ends up 5 mm | yes | fresh | 0.927 | 2.7 | 40.3 (40.3) | yes | 1.9 | ok | none (right) |
| paper curl, ends up 10 mm | yes | fresh | 1.799 | 5.34 | 40.2 (40.3) | yes | 4.1 | ok | none (right) |
| paper curl, ends up 20 mm | yes | fresh | 3.501 | 10.64 | 40.2 (40.3) | yes | 8.4 | ok | none (right) |
| folded crease, ridge 4 mm | yes | fresh | 0.517 | 0.87 | 40.3 (40.3) | yes | 2.5 | ok | none (right) |
| folded crease, ridge 8 mm | yes | fresh | 0.956 | 1.9 | 40.3 (40.3) | yes | 4.6 | ok | none (right) |
| mirrored frame | yes | fresh | 0.207 | 0.23 | 40.3 (40.3) | yes | 0.4 | ok | none (right) |
| 16:9 camera squashed to 640×480 | yes | fresh | 0.221 | 0.38 | 23.2 (45.2) | yes | 0.5 | ok | none (right) |
| laptop: tilt 45, f 0.9 w, fill 60%, warm, σ5, wood + clutter | yes | fresh | 0.325 | 0.24 | 45.3 (45.2) | yes | 0.4 | ok | none (right) |
| dim evening: luma 45, warm, σ8 | yes | fresh | 0.214 | 0.23 | 40.3 (40.3) | yes | 0.5 | ok | lighting: “Too dark. Add light in front of you, not behind.” (right) |
| desk lamp: hard shadow + gain ×1.5 | yes | fresh | 0.26 | 0.25 | 40.3 (40.3) | yes | 0.5 | ok | none (right) |
| far + soft focus: fill 45%, defocus r2, σ5 | yes | fresh | 0.68 | 0.36 | 40.2 (40.3) | yes | 0.5 | ok | none (right) |
| sideways sheet, tilt 50, f 0.8 w | yes | fresh | 0.432 | 0.38 | 50.2 (50.2) | yes | 0.5 | ok | angle: “Tilt the laptop screen forward and move the sheet closer, so the camera looks down at it.” (right) |
