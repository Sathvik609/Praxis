"""Download the two public rehabilitation motion datasets whose licences are recorded in
docs/LICENSES.md (UI-PRMD, ODC PDDL 1.0; IntelliRehabDS, CC BY 4.0) into evaluation/external/
(git-ignored), verify pinned SHA-256 digests, and unpack only the parts the clip builder reads:

  evaluation/external/ui-prmd/   Kinect/ folders of the segmented correct + incorrect movements
                                 (the zips bundle Vicon too; those members are skipped)
  evaluation/external/irds/      SkeletonData/Simplified (25 joints x XYZ per line) + readme.txt

The UI-PRMD site (webpages.uidaho.edu/ui-prmd) went dark in 2026; the files come from the
Internet Archive capture of 2024-07-07 (original bytes via the `id_` URL form). Nothing here is
redistributed: the builder writes only derived joint angles and summary ranges into the repo.

    uv run python tools/fetch_rehab_datasets.py [--dir ../../evaluation/external] [--check]
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

WAYBACK = "https://web.archive.org/web/20240707205857id_/https://www.webpages.uidaho.edu/ui-prmd"
ZENODO = "https://zenodo.org/records/4610859/files"
DEFAULT_DIR = Path(__file__).resolve().parents[3] / "evaluation" / "external"


@dataclass(frozen=True)
class Item:
    url: str
    sha256: str
    dataset: str
    name: str
    # substring a zip member path must contain to be extracted (None = plain file, not a zip)
    keep: str | None = None


ITEMS: tuple[Item, ...] = (
    Item(
        f"{WAYBACK}/Segmented%20Movements.zip",
        "37478419e5bd6cdb814a94d1ec0fa0b2dfa6497cae03d25e1c2fbc51c676d721",
        "ui-prmd",
        "Segmented Movements.zip",
        keep="Kinect/",
    ),
    Item(
        f"{WAYBACK}/Incorrect%20Segmented%20Movements.zip",
        "d886f76e5096e934f7200a9307a2ad29327ab396a3728439f8e9bcd4717ac154",
        "ui-prmd",
        "Incorrect Segmented Movements.zip",
        keep="Kinect/",
    ),
    Item(
        f"{ZENODO}/SkeletonData.zip?download=1",
        "a5fa88829f8538d415e0f0a24d5cdf473a006e23cba5d845ed0f0176cb6c8106",
        "irds",
        "SkeletonData.zip",
        keep="Simplified/",
    ),
    Item(
        f"{ZENODO}/readme.txt?download=1",
        "c22584330c29d32b712e5b32e96fa842243540c37a5583a6f0a2de28ddb27bc6",
        "irds",
        "readme.txt",
    ),
)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, path: Path, attempts: int = 6) -> None:
    """Streamed download with backoff: the Wayback Machine answers 429/503 under load, Zenodo
    occasionally 503s (same pattern as tools/fetch_models.py)."""
    tmp = path.with_suffix(path.suffix + ".part")
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "praxis-fetch/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            tmp.replace(path)
            return
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
            tmp.unlink(missing_ok=True)
            if i == attempts - 1:
                raise
            wait = 2**i * 5
            print(f"retry  {path.name} in {wait}s ({e})", file=sys.stderr)
            time.sleep(wait)


def extract(zip_path: Path, dest: Path, keep: str) -> int:
    """Unpack only members whose path contains `keep`; returns the member count."""
    n = 0
    with zipfile.ZipFile(zip_path) as z:
        for m in z.infolist():
            if m.is_dir() or keep not in m.filename.replace("\\", "/"):
                continue
            target = dest / m.filename.replace("\\", "/")
            if not target.resolve().is_relative_to(dest.resolve()):
                raise ValueError(f"zip member escapes dest: {m.filename}")
            if target.exists() and target.stat().st_size == m.file_size:
                n += 1
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(m) as src, open(target, "wb") as out:
                out.write(src.read())
            n += 1
    return n


def check(items: tuple[Item, ...], root: Path) -> int:
    rc = 0
    for it in items:
        path = root / it.dataset / it.name
        if not path.exists():
            print("missing", it.dataset, it.name)
            rc = 1
        elif it.sha256 and sha256(path) != it.sha256:
            print("BAD    ", it.dataset, it.name)
            rc = 1
        else:
            print("ok     ", it.dataset, it.name)
    return rc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(DEFAULT_DIR))
    ap.add_argument("--check", action="store_true", help="verify what is on disk; no network")
    args = ap.parse_args(argv)
    root = Path(args.dir)
    if args.check:
        return check(ITEMS, root)
    for it in ITEMS:
        dest = root / it.dataset
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / it.name
        if path.exists() and it.sha256 and sha256(path) == it.sha256:
            print("ok     ", it.dataset, it.name)
        else:
            print("fetch  ", it.dataset, it.name)
            download(it.url, path)
            digest = sha256(path)
            if not it.sha256:
                print(f"UNPINNED {it.name}: sha256 {digest} (paste into ITEMS)")
            elif digest != it.sha256:
                print("CHECKSUM MISMATCH", it.name, digest, file=sys.stderr)
                path.unlink(missing_ok=True)
                return 1
            else:
                print("ok     ", it.dataset, it.name)
        if it.keep:
            n = extract(path, dest, it.keep)
            print(f"unpack  {it.name}: {n} members matching '{it.keep}'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
