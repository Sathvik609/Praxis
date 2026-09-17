# Third-party licenses and attributions

Rule (CLAUDE.md §1): every model license is recorded here **before** it is integrated.

| Component | Source | License | Use in Praxis | Recorded |
|---|---|---|---|---|
| OpenCV 5.0.0 (`opencv-python-headless==5.0.0.93`) | https://github.com/opencv/opencv | Apache-2.0 | All perception (aruco, imgproc, dnn) | 2026-09-16 |
| ArUco dictionary DICT_4X4_50 | OpenCV (Garrido-Jurado et al.) | Apache-2.0 (part of OpenCV) | Sheet markers ids 0–3 | 2026-09-16 |
| GRASP (Graded Repetitive Arm Supplementary Program) | UBC / Heart & Stroke Foundation, https://neurorehab.med.ubc.ca/grasp/ | Copyright UBC; free for clinical/educational use; original text and images not redistributed | Exercise *concepts* and names (Waiter – cup, Arm to the front) only. All instructions paraphrased, all illustrations our own. Other GRASP exercises ship as paraphrased instructions-only. | 2026-09-16 |
| Nine-Hole Peg Test (NHPT) | Mathiowetz et al. 1985 (public protocol) | Public protocol; no proprietary material | Board geometry (32 mm pitch) and timing protocol | 2026-09-16 |
| reportlab 4.4.3 | https://www.reportlab.com | BSD-3-Clause | Generating `docs/sheets/*.pdf` (not runtime) | 2026-09-16 |
| jsonschema 4.25.1 | https://github.com/python-jsonschema/jsonschema | MIT | Event contract validation | 2026-09-16 |
| Three.js 0.186.0 | https://threejs.org | MIT | Procedural avatar in the browser | 2026-09-16 |
| Lora (via `@fontsource/lora` 5.3.0) | Cyreal | SIL OFL 1.1 | Headings | 2026-09-16 |
| Carlito (via `@fontsource/carlito` 5.3.0) | Google / tyPoland Lukasz Dziedzic | SIL OFL 1.1 | Body text | 2026-09-16 |
| Radix UI, Tailwind CSS, React, Vite | respective projects | MIT | Web app | 2026-09-16 |
| Palm detection ONNX `palm_detection_mediapipe_2023feb.onnx` | OpenCV Zoo `models/palm_detection_mediapipe` (MediaPipe palm detector converted by OpenCV), https://github.com/opencv/opencv_zoo | Apache-2.0 (LICENSE in the model folder) | Hand localisation stage 1 via `cv2.dnn`; pre/post-processing ported from `mp_palmdet.py` (Apache-2.0) | 2026-09-16, before download; SHA256 pinned in `services/session/tools/fetch_models.py` |
| Hand landmark ONNX `handpose_estimation_mediapipe_2023feb.onnx` | OpenCV Zoo `models/handpose_estimation_mediapipe` (MediaPipe hand landmarker converted by OpenCV) | Apache-2.0 | 21 hand landmarks via `cv2.dnn`; pre/post-processing ported from `mp_handpose.py` (Apache-2.0) | 2026-09-16, before download; SHA256 pinned |
| Person detection ONNX `person_detection_mediapipe_2023mar.onnx` | OpenCV Zoo `models/person_detection_mediapipe` | Apache-2.0 | Pose stage 1 via `cv2.dnn`; ported from `mp_persondet.py` | 2026-09-16, before download; SHA256 pinned |
| Pose landmark ONNX `pose_estimation_mediapipe_2023mar.onnx` | OpenCV Zoo `models/pose_estimation_mediapipe` (MediaPipe BlazePose converted by OpenCV) | Apache-2.0 | 33 body landmarks via `cv2.dnn` for Arm to the front; ported from `mp_pose.py` | 2026-09-16, before download; SHA256 pinned |
| lucide-react 1.47.0 | https://lucide.dev | ISC (Lucide icons; MIT for the original Feather icons) | Interface icons (check, play, camera, mic, flags, zoom) in the web app | 2026-09-17, before install; pinned exact |
