#!/usr/bin/env python3
"""Generate Eclipse's hourly Sun/Earth geometry from NASA/JPL NAIF SPICE kernels.

Output
------
public/data/ephemeris.bin   little-endian Float32, 14 values per hourly sample:
    0-2   Sun position relative to the Moon's center, MOON_ME frame, km
    3-5   Earth position relative to the Moon's center, MOON_ME frame, km
    6-9   quaternion (x, y, z, w) rotating J2000 vectors into MOON_ME
          (used only to place catalogue stars in the sky)
    10-13 quaternion (x, y, z, w) rotating IAU_EARTH body-fixed vectors into
          MOON_ME (used only to orient the rendered Earth's continents)
public/data/ephemeris.json  metadata: epoch range, step, frame, kernels, checksums

Positions are geometric (aberration correction NONE), exactly as computed by
spkpos. The frame is MOON_ME_DE440_ME421, the DE440 realization of the Mean
Earth/Polar Axis frame aligned with the DE421 cartographic frame that LOLA and
LROC products use.

Usage:  .venv/bin/python scripts/generate_ephemeris.py [--kernel-dir DIR]
"""

import argparse
from datetime import UTC, datetime, timedelta
from hashlib import file_digest, sha256
import json
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from urllib.request import urlretrieve

import numpy as np
import spiceypy as spice

ROOT = Path(__file__).resolve().parent.parent
NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
KERNELS = (
    ("lsk/naif0012.tls", "678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b"),
    ("fk/satellites/moon_de440_250416.tf", "a47c71e9c9f33796bdafb2c9d69a7ee447b6016ecad80f71cd6f3e479f9cf768"),
    ("pck/moon_pa_de440_200625.bpc", "60cd55aa401ea2ea97360636f567554bfe4e37bb829f901b4460a455dfaf783f"),
    ("spk/planets/de440s.bsp", "c1c7feeab882263fc493a9d5a5b2ddd71b54826cdf65d8d17a76126b260a49f2"),
    ("pck/pck00011.tpc", "3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1"),
)
START = datetime(2026, 1, 1, tzinfo=UTC)
END = datetime(2029, 1, 1, tzinfo=UTC)
STEP = timedelta(hours=1)
FRAME = "MOON_ME_DE440_ME421"
COLUMNS = [
    "sunX", "sunY", "sunZ", "earthX", "earthY", "earthZ",
    "qJ2000X", "qJ2000Y", "qJ2000Z", "qJ2000W",
    "qEarthX", "qEarthY", "qEarthZ", "qEarthW",
]


def verify_checksum(path, expected):
    with path.open("rb") as handle:
        if file_digest(handle, "sha256").hexdigest() != expected:
            raise ValueError(f"Checksum mismatch for {path.name}; use the official NAIF kernel.")


def kernel_path(directory, relative_url, expected):
    path = directory / Path(relative_url).name
    if path.exists():
        verify_checksum(path, expected)
        return path
    print(f"Downloading {path.name}")
    with NamedTemporaryFile(dir=directory, prefix=f".{path.name}-", delete=False) as download:
        partial = Path(download.name)
    try:
        urlretrieve(NAIF + relative_url, partial)
        verify_checksum(partial, expected)
        partial.replace(path)
    finally:
        partial.unlink(missing_ok=True)
    return path


def utc_label(moment):
    return moment.isoformat().replace("+00:00", "Z")


def quaternion_xyzw(matrix):
    """SPICE m2q returns (w, x, y, z) with q2m(q) == matrix; Three.js uses (x, y, z, w)."""
    w, x, y, z = spice.m2q(matrix)
    return [x, y, z, w]


def generate(out_dir, kernel_dir):
    kernel_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    try:
        for url, checksum in KERNELS:
            spice.furnsh(str(kernel_path(kernel_dir, url, checksum)))
        moment = START
        while moment <= END:
            et = spice.str2et(utc_label(moment))
            sun, _ = spice.spkpos("SUN", et, FRAME, "NONE", "MOON")
            earth, _ = spice.spkpos("EARTH", et, FRAME, "NONE", "MOON")
            q_sky = quaternion_xyzw(spice.pxform("J2000", FRAME, et))
            q_earth = quaternion_xyzw(spice.pxform("IAU_EARTH", FRAME, et))
            rows.append([*sun, *earth, *q_sky, *q_earth])
            moment += STEP
    finally:
        spice.kclear()

    data = np.asarray(rows, dtype="<f4")
    out_dir.mkdir(parents=True, exist_ok=True)
    binary = out_dir / "ephemeris.bin"
    binary.write_bytes(data.tobytes())
    meta = {
        "version": 2,
        "frame": FRAME,
        "frameDescription": "Moon Mean Earth/Polar Axis (DE440 realization aligned to DE421 ME)",
        "origin": "MOON_CENTER",
        "reference": "NASA/JPL DE440 via NAIF SPICE (spiceypy)",
        "units": "km",
        "aberrationCorrection": "NONE",
        "startUtc": utc_label(START),
        "endUtc": utc_label(END),
        "stepSeconds": int(STEP.total_seconds()),
        "count": len(rows),
        "stride": len(COLUMNS),
        "dtype": "float32-le",
        "columns": COLUMNS,
        "sha256": sha256(binary.read_bytes()).hexdigest(),
        "kernels": [{"url": NAIF + url, "sha256": sha} for url, sha in KERNELS],
    }
    (out_dir / "ephemeris.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} samples ({binary.stat().st_size / 1e6:.2f} MB) to {binary}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--kernel-dir", type=Path, help="Reusable directory for the official kernels")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "public/data")
    args = parser.parse_args()
    if args.kernel_dir:
        generate(args.out_dir, args.kernel_dir)
    else:
        with TemporaryDirectory(prefix="lunar-spice-") as directory:
            generate(args.out_dir, Path(directory))


if __name__ == "__main__":
    main()
