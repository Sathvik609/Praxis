# Arm out to the side with laptop framing (REHAB24-6, cropped)

Generated 2026-10-25 by `evaluation/scripts/rehab24_laptop_framing.py`, OpenCV 5.0.0, pipeline e84c40750c1d. Recordings PM_000, PM_001, PM_012, PM_023 (Camera17, subject facing it throughout), healthy adults standing in a lab; the frame is cropped so the person fills a 640 x 480 laptop-like view. Angle error is against motion capture (`ref_frontal`), on frames where the product scored the angle.

| framing | labelled reps | reps found | false reps | rep F1 | reps < 1 s | angle scored | angle MAE | shoulder-hike flags | setup pauses |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| full | 35 | 35 | 3 | 0.96 | 0 | 100% | 3.5° | 0 | 1 |
| hips_at_edge | 35 | 34 | 4 | 0.93 | 0 | 84% | 5.0° | 0 | 0 |
| hips_out | 35 | 35 | 7 | 0.91 | 3 | 85% | 7.5° | 1 | 1 |

**Before the 25 Oct fix** (the same script on commit 7d0650b, pipeline e657f752cc9c; the angle gate needed the hip, and a dip over the start line of any length was a rep):

| framing | labelled reps | reps found | false reps | rep F1 | reps < 1 s | angle scored | angle MAE | shoulder-hike flags | setup pauses |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| full | 35 | 35 | 5 | 0.93 | 2 | 100% | 3.5° | 0 | 1 |
| hips_at_edge | 35 | 24 | 4 | 0.76 | 0 | 28% | 5.1° | 0 | 2 |
| hips_out | 35 | 6 | 2 | 0.28 | 1 | 2% | 8.5° | 1 | 11 |

Dataset: Černek, A., Sedmidubsky, J., Budikova, P.: REHAB24-6: Physical Therapy Dataset for Analyzing Pose Estimation Methods. 17th International Conference on Similarity Search and Applications (SISAP 2024), Springer LNCS. Data: Zenodo, doi:10.5281/zenodo.13305826, CC BY-NC 4.0.
