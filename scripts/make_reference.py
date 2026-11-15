#!/usr/bin/env python3
"""Independent SPICE reference values for Eclipse's TypeScript unit tests.

For several sites and UTC epochs, SPICE's own azlcpo routine computes the Sun's
and Earth's topocentric azimuth/elevation for an observer on the 1737.4 km lunar
sphere. The TypeScript implementation must reproduce these from the shipped
ephemeris (with its hourly interpolation) to within a small tolerance.

Output: tests/fixtures/spice-reference.json
"""

import json
import math
from pathlib import Path

import spiceypy as spice

ROOT = Path(__file__).resolve().parent.parent
KERNELS = ROOT / ".cache/kernels"
FRAME = "MOON_ME_DE440_ME421"
R_KM = 1737.4

SITES = [
    ("connecting-ridge", -89.4632, -137.49),
    ("malapert-massif", -85.9948, -0.23578),
    ("apollo-11", 0.67416, 23.47314),
    ("change-4", -45.4562, 177.5885),
    ("near-north-pole", 89.99, 45.0),
]
EPOCHS = [
    "2026-11-14T12:00:00Z",
    "2026-11-20T07:30:00Z",
    "2027-03-03T18:45:00Z",
    "2027-09-15T00:20:00Z",
    "2028-06-01T09:10:00Z",
]


def main():
    for name in ("naif0012.tls", "moon_de440_250416.tf", "moon_pa_de440_200625.bpc", "de440s.bsp", "pck00011.tpc"):
        spice.furnsh(str(KERNELS / name))
    rows = []
    for site_id, lat, lon in SITES:
        obs = spice.latrec(R_KM, math.radians(lon), math.radians(lat))
        for utc in EPOCHS:
            et = spice.str2et(utc)
            entry = {"site": site_id, "lat": lat, "lon": lon, "utc": utc}
            for body in ("SUN", "EARTH"):
                # azlcpo: azimuth clockwise from north (azccw=False), elevation positive up (elplsz=True)
                azl, _ = spice.azlcpo("ELLIPSOID", body, et, "NONE", False, True, obs, "MOON", FRAME)
                entry[body.lower()] = {"azimuthDeg": math.degrees(azl[1]) % 360, "elevationDeg": math.degrees(azl[2]), "rangeKm": azl[0]}
            rows.append(entry)
    spice.kclear()
    out = ROOT / "tests/fixtures/spice-reference.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"note": "SPICE azlcpo, geometric, observer on 1737.4 km sphere", "rows": rows}, indent=1))
    print(f"{len(rows)} reference rows")


if __name__ == "__main__":
    main()
