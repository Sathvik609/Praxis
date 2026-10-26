"""Download the parts of REHAB24-6 (Černek et al. 2024, Zenodo record 13305826,
DOI 10.5281/zenodo.13305826, CC BY-NC 4.0, licence recorded in docs/LICENSES.md before
download) that `evaluation/scripts/rehab24_eval.py` reads, into the git-ignored
`evaluation/external/rehab24_6/`:

  Segmentation.csv, Segmentation.txt, joints_names.txt    whole files, MD5 checked against the
                                                          Zenodo record, SHA-256 pinned below
  videos/Ex1/PM_xxx-Camera17-30fps.mp4                    Camera17 (horizontal) RGB, 30 fps
  videos/Ex1/PM_xxx-Camera18-30fps-transposed.mp4         Camera18 (vertical) RGB, 30 fps
  3d_joints/Ex1/PM_xxx-30fps.npy                          26-joint mocap skeleton (virtual cm)
  2d_joints/Ex1/PM_xxx-c17-30fps.npy, -c18-30fps.npy      the joints projected into each camera

Only Ex1 (arm abduction) is needed, ~0.55 GB of the record's ~5.7 GB. The archives are not
downloaded whole: the zip central directory is read with HTTP range requests and only the Ex1
30-fps members are fetched. A partial download cannot be checked against the archive's MD5, so
each member is verified twice instead: the zip CRC-32 stored by the authors (checked while
it is inflated) and the SHA-256 pinned in `MEMBERS` below after the first verified fetch.
The 120-fps joint files and the 41-marker archives are not used. Evaluation only; nothing here
is redistributed and no frame or joint file ever enters git (privacy rule).

    uv run python tools/fetch_rehab24.py [--dir ../../evaluation/external/rehab24_6] [--check]
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import io
import struct
import sys
import time
import urllib.error
import urllib.request
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # `tools` from services/session
from tools.fetch_rehab_datasets import download  # noqa: E402  (same retrying download)

RECORD = "https://zenodo.org/api/records/13305826/files"
DEFAULT_DIR = Path(__file__).resolve().parents[3] / "evaluation" / "external" / "rehab24_6"

# whole files: name -> (Zenodo md5, pinned sha256)
FILES: dict[str, tuple[str, str]] = {
    "Segmentation.csv": ("90b8fbd7445dd050bf27b17126c78fbe", "72c70bc7e56eafb132452a850f7a56d21c3cb4a602bab1e98370f9b606567100"),
    "Segmentation.txt": ("5f2a5b886c6f794f03e1a8f642738c86", "e7c2c75469b7becf32e8deb115c0f0a5032d1ed571e1c7f6006ba2344f9a1895"),
    "joints_names.txt": ("3f04a37cce43086b1ea1fa49f1e4514f", "f3aa2491e9fedaeb5af74606135c54bc3b1027ce6daf7f2a21c5c094853b5f5b"),
}
ARCHIVES = ("3d_joints.zip", "2d_joints.zip", "videos.zip")
# archive member -> pinned sha256 (filled after the first fetch verified by the zip CRC-32)
MEMBERS: dict[str, str] = {
    "Ex1/PM_000-30fps.npy": "6f66a4dccd606b021926ecd34dcac6f0ddfcee0ab92ff918fa988247b4382124",
    "Ex1/PM_000-Camera17-30fps.mp4": "f18a51477bf73913eca8806cb6673733d2813731d09f5eea7c31be91bdc64430",
    "Ex1/PM_000-Camera18-30fps-transposed.mp4": "ec38b2ca55ff4db63ffa1d869e83d64686c62487dd9bf807a960603ca95921e8",
    "Ex1/PM_000-c17-30fps.npy": "debc61546918b800f12fd83683861094f42603029c4b31ad26239804b6c72a07",
    "Ex1/PM_000-c18-30fps.npy": "fa5a56e603909815ed5b55f59495f5d50b7d8bf275698f7b53167001010b892f",
    "Ex1/PM_001-30fps.npy": "90c9ade1c527b140823b5a6a1c9d8d7dbdbc6f1ef382fb9ee9a669eb8d75dc41",
    "Ex1/PM_001-Camera17-30fps.mp4": "92bdac73d80692914749701cc3adac91eb56eeb9a275d12f2bec93e08325dfd8",
    "Ex1/PM_001-Camera18-30fps-transposed.mp4": "77bfa230f5f8ca3575b84cd4e81d7c40cf860b831a362d53e039bfbb815d852d",
    "Ex1/PM_001-c17-30fps.npy": "746d195fc74beca987b20622b2c7db825145a3668f3e15b86f723ed428735ea9",
    "Ex1/PM_001-c18-30fps.npy": "20c1f15de542d4d811b77faa2a1ce6b35008d082f4c3c99b2e81d60545ef5973",
    "Ex1/PM_002-30fps.npy": "34db5b1a011356d100e3955b44d0c61c72478b749ea1e962ee1368422ee295ab",
    "Ex1/PM_002-Camera17-30fps.mp4": "854fa5b96b9f0b99bc7caf5df52f155078fa210b8114c28eab0b4d3a5ee11f41",
    "Ex1/PM_002-Camera18-30fps-transposed.mp4": "13a38b86605790b1c8adb67014bf249bce7b1dddb88c2ef857f012c4aaa0e760",
    "Ex1/PM_002-c17-30fps.npy": "453daa1a0428b5c20751e1fa525705df9ffe34620cb65d77278176c3c0e57896",
    "Ex1/PM_002-c18-30fps.npy": "861a6d207e3a6918c6cd7f9b0297cd4aa05c90dfac005aad9e97c9543cd156d7",
    "Ex1/PM_012-30fps.npy": "455c9bbcdcbca652e36f4bd674ac9a32ab74d3258a173fb3fd2c85366b3f81a3",
    "Ex1/PM_012-Camera17-30fps.mp4": "0af4e251ad54c17434ab357b6d2304f24cf9cd4aba624caf69b75c50a196be0e",
    "Ex1/PM_012-Camera18-30fps-transposed.mp4": "4f2363adae2a003cc6c2d6d6b60d4b42726df94b538861db50f3ebf7ca88e657",
    "Ex1/PM_012-c17-30fps.npy": "11ed19cfca880395122913558897ff4e1d0ec197f7b893d01298e684f92052ed",
    "Ex1/PM_012-c18-30fps.npy": "86e7ade2173550757f83300f397d54fdf9d2a006abf4ce814a8edbd4965a1af2",
    "Ex1/PM_016-30fps.npy": "91868ed26900ee591746500ac861f96e183095130ab0aec92bb16d64ee0599d9",
    "Ex1/PM_016-Camera17-30fps.mp4": "76ef17755bb4a52e81cab4489f542d35075b776611094107e612f74fcf8a7be4",
    "Ex1/PM_016-Camera18-30fps-transposed.mp4": "599c9c8710a45b3bb1295b4729e20bdd3935e11ee614c1042fa7986cd9df56d7",
    "Ex1/PM_016-c17-30fps.npy": "342e71178133a686b2a2d9d7f01f9edaec1abfa9f85acf122eb5bf7f8651ee2c",
    "Ex1/PM_016-c18-30fps.npy": "8ad6b3530b4026d93697263c7bee88d5669439853d1b67001ca17aac6353f620",
    "Ex1/PM_023-30fps.npy": "bfa92f1132244a7dd89609f0bd26eb9cdb50dc94402a1ed4568e2eca6c657f83",
    "Ex1/PM_023-Camera17-30fps.mp4": "440148eeba6f3939c4d91bee63c1900e631d1777fa1086c8876b08799bac8472",
    "Ex1/PM_023-Camera18-30fps-transposed.mp4": "be90425b76fa628a2834be671a5d4a4ceb7773a952f57c648ba4439958940efd",
    "Ex1/PM_023-c17-30fps.npy": "befffa28090e5c875b4d9d0c036ca8eec0de7e090a3e86019a681af73ce02a18",
    "Ex1/PM_023-c18-30fps.npy": "9b3560156328414feb740d08bc08e98f4566575b25531e207f782156f5f4a544",
    "Ex1/PM_024-30fps.npy": "1e718f5cca6bf2f9e4297a1744a5092e6c23fc91c03a7bd16a23355a644a9a1c",
    "Ex1/PM_024-Camera17-30fps.mp4": "e9e37e780b1b48da5747bc48b69f322380643ec6de033548b18c0d03474bbe55",
    "Ex1/PM_024-Camera18-30fps-transposed.mp4": "8ac4bbb7bb1f47ea8afd11f9d5b46e8aaa0a773ec6eddaf06dc6f0b189456d4c",
    "Ex1/PM_024-c17-30fps.npy": "2a415d693022672bd17af72f4035ea991767a70195ad900cf768a63b16ec41e1",
    "Ex1/PM_024-c18-30fps.npy": "13ff1d8f19638901858f8ae27694d1d8efaa14385778047701ce48e07a6b5295",
    "Ex1/PM_032-30fps.npy": "66d6bdc2f06bc40081bba3cda4096cd6f76aa3970641a71ae80b1bd34802d096",
    "Ex1/PM_032-Camera17-30fps.mp4": "8268366bebbf45f52e5a8d9963497e49d4293c4fe0c28da772c3bd7ade2ae8a1",
    "Ex1/PM_032-Camera18-30fps-transposed.mp4": "9923aec8736c5263439a321cfa9459f8a15fb0291addf6117d3275e04eb63d97",
    "Ex1/PM_032-c17-30fps.npy": "8fa9e209a3d74eff3d763e30c72a0690a878ded2e61ea0d11f7b0b9efee9512f",
    "Ex1/PM_032-c18-30fps.npy": "393c9cefdb09eb79ed85b93216cb57128955f0c4433736e3dc6dfad98e7c589a",
    "Ex1/PM_039-30fps.npy": "b2363b03167d78db62b71104b35ff8229ecb199f0e411b56a721295ccd65d038",
    "Ex1/PM_039-Camera17-30fps.mp4": "becc9eae0729570cba09b4402bbd685ac688c12203fb02c75d313adc88e02f87",
    "Ex1/PM_039-Camera18-30fps-transposed.mp4": "0f741833b7d81f7e60fd1dce0f8e4cb3064c58011dc7525216cf9b4ff6b086ba",
    "Ex1/PM_039-c17-30fps.npy": "73c2933acd15d7d1ed4e62cb64e2902b58641336b914dd135f24fd05c2c94d15",
    "Ex1/PM_039-c18-30fps.npy": "eaaa924bc75f6a3104723e164536197c1d6e735df00fdf392bb5ff2afcd28ed4",
    "Ex1/PM_101-30fps.npy": "54bf2528f64232e1229f784606a39b80165152469de08f1bfde8840a189aa271",
    "Ex1/PM_101-Camera17-30fps.mp4": "6bda81511a4c89eb31927c47d60466de982152d9349fca2ed6726fcb69be4d4c",
    "Ex1/PM_101-Camera18-30fps-transposed.mp4": "357cdda0e9cf85821883f9e93c7cab81f074d78a47ec784f7e3aee135c75e5f0",
    "Ex1/PM_101-c17-30fps.npy": "ba66a6d2b105370c6f8457fe219ee851074a0fedf37c8e1426f284d19f90ad39",
    "Ex1/PM_101-c18-30fps.npy": "319f782243a857f2d98efa1cf36d54dd3d3ae0ea9e251b60d961975cdb4202d7",
    "Ex1/PM_109-30fps.npy": "28393927a52e0602238c0b0e31980345081adbcf1f78d17b5c633390acf68fa9",
    "Ex1/PM_109-Camera17-30fps.mp4": "1f3995f1308e2999e994b4792e0f54f3b343a0d390aaeec221a24c34eec3b6c9",
    "Ex1/PM_109-Camera18-30fps-transposed.mp4": "493285f8af4a9db98485b9612bd0b3d8bba2a7b89e215eef220bd6dd09db0a8a",
    "Ex1/PM_109-c17-30fps.npy": "de8f975f650fe0e1b47f525248a4bff4cce3f993a957e7df56eb63e521a36a8d",
    "Ex1/PM_109-c18-30fps.npy": "a85aba94bcd6535bf5fb475e6e2bb0e93da01ff6076fcc4372d30b555e029caa",
    "Ex1/PM_114-30fps.npy": "06d3b71446b392c054200ad03f619f283e141903473159b62bad018be7304269",
    "Ex1/PM_114-Camera17-30fps.mp4": "c71a56abe2b5067e6b685143e8237d93654f42124618938bf2a0f3d1b902c6b7",
    "Ex1/PM_114-Camera18-30fps-transposed.mp4": "73f4a49c6df876b3fb54d5de8cce560ec162040c283da5c0772dcb88fb8d2582",
    "Ex1/PM_114-c17-30fps.npy": "f3266017ccf360977f4ed413998446422aa6f45207b630ed5a2124e07d959d4f",
    "Ex1/PM_114-c18-30fps.npy": "801b69425c00404ba80e62d6745e1c9806815ba290d42e78abc7399d44c792d6",
    "Ex1/PM_122-30fps.npy": "9a0fbdd831db7d556d6756513ee4eb0539c17df8dc8652a1812b9e8de6f4984b",
    "Ex1/PM_122-Camera17-30fps.mp4": "42555691175251ba8454a007604e03d714812ef983f389a900e39297b74f656b",
    "Ex1/PM_122-Camera18-30fps-transposed.mp4": "a8741875d816362d69758150bcf0377f06d1e0198a85debb79f59daa8b5e83ff",
    "Ex1/PM_122-c17-30fps.npy": "c7f7904241de69c9c6b467025fc43422d3c5ed4db660a27a53a1809085a32c6d",
    "Ex1/PM_122-c18-30fps.npy": "243b812083514317830a2018c0539f6b5ccfe7acf65db1247480df43a78b79f2",
}


def wanted(archive: str, member: str) -> bool:
    """Ex1 members at 30 fps only (the videos are all 30 fps; joints come at 30 and 120)."""
    if not member.startswith("Ex1/") or member.endswith("/"):
        return False
    return archive == "videos.zip" or member.endswith("-30fps.npy")


def local_path(root: Path, archive: str, member: str) -> Path:
    return root / archive.removesuffix(".zip") / member


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


class RangeFile(io.RawIOBase):
    """Read-only, seekable view of a remote file over HTTP Range requests (Zenodo answers 206),
    enough for `zipfile` to read the central directory and single members."""

    def __init__(self, url: str, attempts: int = 6) -> None:
        self.url, self.pos, self.attempts = url, 0, attempts
        self.size = int(self._get("HEAD")[1]["content-length"])

    def _get(self, method: str = "GET", rng: str | None = None) -> tuple[bytes, dict]:
        """One request with backoff; a short or broken body (IncompleteRead) is retried too."""
        for i in range(self.attempts):
            try:
                req = urllib.request.Request(self.url, method=method, headers={"User-Agent": "praxis-fetch/1.0"})
                if rng:
                    req.add_header("Range", rng)
                with urllib.request.urlopen(req, timeout=120) as r:
                    return (b"" if method == "HEAD" else r.read()), {k.lower(): v for k, v in r.headers.items()}
            except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as e:
                if i == self.attempts - 1:
                    raise
                wait = 2**i * 5
                print(f"retry  range in {wait}s ({e!r:.120})", file=sys.stderr)
                time.sleep(wait)
        raise RuntimeError("unreachable")

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, off: int, whence: int = 0) -> int:
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def readinto(self, b) -> int:  # type: ignore[override]
        if len(b) == 0 or self.pos >= self.size:
            return 0
        end = min(self.size, self.pos + len(b)) - 1
        data, _ = self._get(rng=f"bytes={self.pos}-{end}")
        b[: len(data)] = data
        self.pos += len(data)
        return len(data)


def _fetch_one(url: str, info: zipfile.ZipInfo, dest: Path, pin: str, attempts: int = 6) -> str:
    """Stream one deflated/stored member with a single Range request, inflate it locally, check
    the zip CRC-32 and the pinned SHA-256; returns the SHA-256."""
    rf = RangeFile(url)
    rf.seek(info.header_offset)
    head = rf.read(30)
    if head[:4] != b"PK\x03\x04":
        raise ValueError(f"bad local header for {info.filename}")
    name_len, extra_len = struct.unpack("<HH", head[26:30])
    start = info.header_offset + 30 + name_len + extra_len
    end = start + info.compress_size - 1
    tmp = dest.with_suffix(dest.suffix + ".part")
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "praxis-fetch/1.0", "Range": f"bytes={start}-{end}"})
            crc, h = 0, hashlib.sha256()
            inflate = zlib.decompressobj(-15) if info.compress_type == zipfile.ZIP_DEFLATED else None
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while chunk := r.read(1 << 20):
                    data = inflate.decompress(chunk) if inflate else chunk
                    crc = zlib.crc32(data, crc)
                    h.update(data)
                    f.write(data)
                if inflate:
                    tail = inflate.flush()
                    crc = zlib.crc32(tail, crc)
                    h.update(tail)
                    f.write(tail)
            break
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException, zlib.error) as e:
            tmp.unlink(missing_ok=True)
            if i == attempts - 1:
                raise
            wait = 2**i * 5
            print(f"retry  {info.filename} in {wait}s ({e!r:.120})", file=sys.stderr, flush=True)
            time.sleep(wait)
    digest = h.hexdigest()
    if crc != info.CRC or tmp.stat().st_size != info.file_size:
        tmp.unlink()
        raise ValueError(f"CRC-32/size mismatch for {info.filename}")
    if pin and digest != pin:
        tmp.unlink()
        raise ValueError(f"sha256 mismatch for {info.filename}: {digest} != pinned {pin}")
    tmp.replace(dest)
    return digest


def fetch_members(root: Path, archive: str, workers: int = 4) -> list[tuple[str, str]]:
    """Fetch every wanted member of one remote archive (central directory over Range requests,
    then one streamed Range request per member, `workers` at a time); returns [(member, sha256)]."""
    url = f"{RECORD}/{archive}/content"
    with zipfile.ZipFile(io.BufferedReader(RangeFile(url), 1 << 16)) as z:
        infos = [i for i in z.infolist() if wanted(archive, i.filename)]
    out: list[tuple[str, str]] = []
    todo = []
    for info in infos:
        dest = local_path(root, archive, info.filename)
        if not dest.resolve().is_relative_to(root.resolve()):
            raise ValueError(f"zip member escapes dest: {info.filename}")
        pin = MEMBERS.get(info.filename, "")
        if dest.exists() and dest.stat().st_size == info.file_size and (not pin or sha256(dest) == pin):
            out.append((info.filename, sha256(dest)))
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        todo.append((info, dest, pin))

    def job(item: tuple[zipfile.ZipInfo, Path, str]) -> tuple[str, str]:
        info, dest, pin = item
        print(f"fetch   {archive}:{info.filename} ({info.compress_size / 1e6:.1f} MB)", flush=True)
        return info.filename, _fetch_one(url, info, dest, pin)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        out += list(ex.map(job, todo))
    return sorted(out)


def check(root: Path) -> int:
    rc = 0
    for name, (md5_, pin) in FILES.items():
        p = root / name
        ok = p.exists() and md5(p) == md5_ and (not pin or sha256(p) == pin)
        print(("ok     " if ok else "BAD    ") + f" {name}")
        rc |= 0 if ok else 1
    if not MEMBERS:
        print("no pinned members (run a fetch first)")
        return 1
    for member, pin in MEMBERS.items():
        archive = next(a for a in ARCHIVES if wanted(a, member) and local_path(root, a, member).exists()) if any(
            local_path(root, a, member).exists() for a in ARCHIVES) else None
        ok = archive is not None and sha256(local_path(root, archive, member)) == pin
        print(("ok     " if ok else "BAD    ") + f" {member}")
        rc |= 0 if ok else 1
    return rc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(DEFAULT_DIR))
    ap.add_argument("--check", action="store_true", help="verify what is on disk; no network")
    args = ap.parse_args(argv)
    root = Path(args.dir)
    if args.check:
        return check(root)
    root.mkdir(parents=True, exist_ok=True)
    unpinned: list[tuple[str, str]] = []
    for name, (md5_, pin) in FILES.items():
        p = root / name
        if not (p.exists() and md5(p) == md5_):
            print("fetch  ", name, flush=True)
            download(f"{RECORD}/{name}/content", p)
        if md5(p) != md5_ or (pin and sha256(p) != pin):
            print("CHECKSUM MISMATCH", name, file=sys.stderr)
            p.unlink(missing_ok=True)
            return 1
        print("ok     ", name, flush=True)
        if not pin:
            unpinned.append((name, sha256(p)))
    for archive in ARCHIVES:
        got = fetch_members(root, archive)
        print(f"ok      {archive}: {len(got)} Ex1 members", flush=True)
        unpinned += [(m, d) for m, d in got if not MEMBERS.get(m)]
    if unpinned:
        print("UNPINNED (paste into FILES / MEMBERS):")
        for name, digest in unpinned:
            print(f'    "{name}": "{digest}",')
    return 0


if __name__ == "__main__":
    sys.exit(main())
