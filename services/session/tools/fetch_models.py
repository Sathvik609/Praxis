"""Download the OpenCV Zoo ONNX models (Apache-2.0, recorded in docs/LICENSES.md) with pinned
SHA256 checksums into services/session/models/ (git-ignored).

    uv run python tools/fetch_models.py [--dir models]
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

LFS = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models"
MODELS: dict[str, tuple[str, str]] = {
    "palm_detection_mediapipe_2023feb.onnx": (
        f"{LFS}/palm_detection_mediapipe/palm_detection_mediapipe_2023feb.onnx",
        "78ff51c38496b7fc8b8ebdb6cc8c1abb02fa6c38427c6848254cdaba57fcce7c",
    ),
    "handpose_estimation_mediapipe_2023feb.onnx": (
        f"{LFS}/handpose_estimation_mediapipe/handpose_estimation_mediapipe_2023feb.onnx",
        "db0898ae717b76b075d9bf563af315b29562e11f8df5027a1ef07b02bef6d81c",
    ),
    "person_detection_mediapipe_2023mar.onnx": (
        f"{LFS}/person_detection_mediapipe/person_detection_mediapipe_2023mar.onnx",
        "47fd5599d6fa17608f03e0eb0ae230baa6e597d7e8a2c8199fe00abea55a701f",
    ),
    "pose_estimation_mediapipe_2023mar.onnx": (
        f"{LFS}/pose_estimation_mediapipe/pose_estimation_mediapipe_2023mar.onnx",
        "9d89c599319a18fb7d2e28451a883476164543182bafca5f09eb2cf767ed2f3f",
    ),
}
DEFAULT_DIR = Path(__file__).resolve().parents[1] / "models"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(path: Path, expected: str) -> bool:
    return path.exists() and sha256(path) == expected


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(DEFAULT_DIR))
    args = ap.parse_args(argv)
    out = Path(args.dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, (url, digest) in MODELS.items():
        path = out / name
        if verify(path, digest):
            print("ok     ", name)
            continue
        print("fetch  ", name)
        urllib.request.urlretrieve(url, path)
        if not verify(path, digest):
            print("CHECKSUM MISMATCH", name, file=sys.stderr)
            path.unlink(missing_ok=True)
            return 1
        print("ok     ", name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
