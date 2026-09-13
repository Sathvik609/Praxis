# Third-party licenses and attributions

Rule (CLAUDE.md §1): every model license is recorded here **before** it is integrated.

| Component | Source | License | Use in Praxis | Recorded |
|---|---|---|---|---|
| OpenCV 5.0.0 (`opencv-python-headless==5.0.0.93`) | https://github.com/opencv/opencv | Apache-2.0 | All perception (aruco, imgproc, dnn) | 2026-09-13 |
| GRASP (Graded Repetitive Arm Supplementary Program) | UBC / Heart & Stroke Foundation, https://neurorehab.med.ubc.ca/grasp/ | Copyright UBC; free for clinical/educational use, not for redistribution of original text/images | Exercise *concepts* only. All text paraphrased, all illustrations our own. The wider GRASP library is design vision only and does not ship as selectable content. | 2026-09-13 |
| Nine-Hole Peg Test (NHPT) | Mathiowetz et al. 1985 (public protocol) | Public domain protocol; no proprietary material used | Board geometry (32 mm hole spacing) and timing protocol | 2026-09-13 |
| ArUco dictionary DICT_4X4_50 | OpenCV contrib (Garrido-Jurado et al.) | Apache-2.0 (part of OpenCV) | Calibration sheet markers ids 0–3 | 2026-09-13 |
| reportlab 4.4.3 | https://www.reportlab.com | BSD-3-Clause | Generating `docs/board.pdf` only (not runtime) | 2026-09-13 |
| Hand landmark ONNX model | **TBD — must be Apache/MIT; record before integration (W4)** | | | |
| Pose ONNX model | **TBD — must be Apache/MIT; record before integration (W4)** | | | |
