#!/usr/bin/env python3
"""Convert the Yale Bright Star Catalogue (BSC5, Hoffleit & Warren 1991) to a compact binary.

Input:  .cache/raw/bsc5.dat.gz  (http://tdc-www.harvard.edu/catalogs/bsc5.html, identical to CDS V/50)
Output: public/data/stars.bin   Float32 LE, 5 values per star: J2000 unit vector x, y, z, V magnitude, B-V
"""

import gzip
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent


def parse(line):
    try:
        ra = (int(line[75:77]) + int(line[77:79]) / 60 + float(line[79:83]) / 3600) * 15
        sign = -1 if line[83] == "-" else 1
        dec = sign * (int(line[84:86]) + int(line[86:88]) / 60 + int(line[88:90]) / 3600)
        vmag = float(line[102:107])
    except ValueError:
        return None
    try:
        bv = float(line[109:114])
    except ValueError:
        bv = 0.6
    a, d = math.radians(ra), math.radians(dec)
    return [math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d), vmag, bv]


def main():
    rows = []
    with gzip.open(ROOT / ".cache/raw/bsc5.dat.gz", "rt", encoding="latin-1") as handle:
        for line in handle:
            star = parse(line.rstrip("\n").ljust(200))
            if star and star[3] <= 6.5:
                rows.append(star)
    data = np.asarray(rows, dtype="<f4")
    (ROOT / "public/data/stars.bin").write_bytes(data.tobytes())
    print(f"{len(rows)} stars")


if __name__ == "__main__":
    main()
