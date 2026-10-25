"""Pictures for the README's "How it works": Blender renders run through the real OpenCV code.

    cd services/session && uv run python ../../docs/img/make_pipeline_figs.py

Needs the git-ignored 3-D clips (evaluation/blender/make_dataset_3d.py). Each clip is played
frame by frame through `Calibrator` and `BoardState` / `CupSheetState`, the same calls the
session pipeline makes, and the result is drawn on the frame it came from. Synthetic renders,
not a real camera. OpenCV 5.0.0 (cv2.__version__ is printed).
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from praxis_session.perception.board import BoardState
from praxis_session.perception.board_spec import CUP_TARGETS, NHPT_BOARD
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.cup import CupSheetState

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "evaluation" / "dataset_3d_v0"
OUT = ROOT / "docs" / "img" / "pipeline"
GREEN, BLUE, AMBER, WHITE = (120, 209, 67), (227, 98, 61), (0, 160, 245), (255, 255, 255)


def frames(clip: str):
    cap = cv2.VideoCapture(str(DS / f"{clip}.avi"))
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        yield i, frame
        i += 1
    cap.release()


def label(img: np.ndarray, text: str) -> np.ndarray:
    out = img.copy()
    cv2.rectangle(out, (0, 0), (out.shape[1], 30), (20, 20, 20), -1)
    cv2.putText(out, text, (10, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.55, WHITE, 1, cv2.LINE_AA)
    return out


def save(name: str, img: np.ndarray, width: int = 640) -> None:
    h = round(img.shape[0] * width / img.shape[1])
    cv2.imwrite(str(OUT / name), cv2.resize(img, (width, h), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 88])
    print("wrote", OUT / name)


def nhpt(clip: str = "nhpt3d_02", after_seat: int = 5) -> None:
    labels = json.loads((DS / f"{clip}.labels.json").read_text())
    stop = labels["reps"][after_seat - 1]["t_end"] + 1.0  # a second after the fifth peg is in
    cal_run, board = Calibrator(NHPT_BOARD), BoardState(NHPT_BOARD)
    for i, frame in frames(clip):
        t = i / labels["fps"]
        cal = cal_run.run(frame, t)
        if not (cal.calibrated and cal.marker_corners_px):
            continue
        canon = board.warp(frame, cal)
        occ = board.to_event_payload(canon)["occupancy"]
        if t >= stop:
            break
    # 1. the four markers found on the frame, with the sheet outline they give
    a = frame.copy()
    for k, c in cal.marker_corners_px.items():
        pts = np.round(c).astype(np.int32)
        cv2.polylines(a, [pts], True, GREEN, 2, cv2.LINE_AA)
        cv2.putText(a, str(k), tuple(pts[0] - [0, 6]), cv2.FONT_HERSHEY_SIMPLEX, 0.6, GREEN, 2, cv2.LINE_AA)
    w, h = NHPT_BOARD.width_mm, NHPT_BOARD.height_mm
    sheet = np.round(cal.to_px(np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32))).astype(np.int32)
    cv2.polylines(a, [sheet], True, AMBER, 1, cv2.LINE_AA)
    save("1_markers.jpg", label(a, f"cv2.aruco: 4 markers, homography RMS {cal.rms_mm:.2f} mm"))
    # 2. the sheet flattened to millimetres, holes from Hough, each hole empty or occupied
    b = canon.copy()
    for k, hole in enumerate(board.detect_holes(canon)):
        full = occ.get(f"hole_{k}") == "occupied"
        cv2.circle(b, (round(hole.x), round(hole.y)), round(board.hole_radius_px * 1.6), GREEN if full else BLUE, 2, cv2.LINE_AA)
    x0, y0, x1, y1 = board_crop(board)
    n = sum(v == "occupied" for v in occ.values())
    save("2_board.jpg", label(b[y0:y1, x0:x1], f"warped to mm: {n} of 9 holes occupied"), width=480)


def board_crop(board: BoardState) -> tuple[int, int, int, int]:
    holes = board._holes
    xs, ys = [h.x for h in holes], [h.y for h in holes]
    pad = board.px_per_mm * 40
    return (max(0, int(min(xs) - pad)), max(0, int(min(ys) - pad)), int(max(xs) + pad), int(max(ys) + pad))


def cup(clip: str = "cup3d_01", placement: int = 3) -> None:
    labels = json.loads((DS / f"{clip}.labels.json").read_text())
    stop = labels["reps"][placement - 1]["t_end"] + 0.6  # the cup has just been put down
    cal_run, sheet = Calibrator(CUP_TARGETS), CupSheetState(CUP_TARGETS)
    got = None
    for i, frame in frames(clip):
        t = i / labels["fps"]
        cal = cal_run.run(frame, t)
        if not cal.calibrated:
            continue
        canon = sheet.warp(frame, cal)
        if not sheet.has_reference and cal.source == "fresh":
            sheet.capture_reference()
        got = sheet.cup_mm(canon)
        if t >= stop and got is not None:
            break
    c = frame.copy()
    for k, (x, y) in enumerate(sheet.dots_frame_px(cal), start=1):
        cv2.circle(c, (round(x), round(y)), 9, BLUE, 2, cv2.LINE_AA)
        cv2.putText(c, str(k), (round(x) - 5, round(y) + 26), cv2.FONT_HERSHEY_SIMPLEX, 0.55, BLUE, 2, cv2.LINE_AA)
    if got is not None:
        px = cal.to_px(np.array([got[:2]], np.float32))[0]
        cv2.drawMarker(c, (round(px[0]), round(px[1])), GREEN, cv2.MARKER_CROSS, 22, 2, cv2.LINE_AA)
    # the dot named is the one nearest the cup base OpenCV found, in sheet mm
    dot = 1 + min(range(len(CUP_TARGETS.targets_mm)), key=lambda k: np.hypot(*np.subtract(CUP_TARGETS.targets_mm[k], got[:2])))
    save("3_cup.jpg", label(c, f"cup base found on dot {dot}, in mm on the sheet"))


if __name__ == "__main__":
    print("OpenCV", cv2.__version__)
    OUT.mkdir(parents=True, exist_ok=True)
    nhpt()
    cup()
