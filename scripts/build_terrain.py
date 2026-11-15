#!/usr/bin/env python3
"""Build Eclipse's terrain products from NASA LRO/LOLA gridded data records (PDS).

Inputs (download with scripts/fetch_sources.sh into .cache/raw):
  ldem_875s_20m.img   LOLA polar stereographic DEM, 20 m/px, 87.5°S–90°S
  ldem_80s_80m.img    LOLA polar stereographic DEM, 80 m/px, 80°S–90°S
  ldem_75s_240m.img   LOLA polar stereographic DEM, 240 m/px, 75°S–90°S
  ldem_128.img        LOLA global simple-cylindrical DEM, 128 px/deg (~237 m)
  ldem_16.img         LOLA global simple-cylindrical DEM, 16 px/deg (~1.9 km)
  lroc_color_poles_8k.tif / _16k.tif   NASA SVS CGI Moon Kit colour mosaic

All DEMs: int16 little-endian, height = DN * 0.5 m above a 1737.4 km sphere,
frame = Moon Mean Earth/Polar Axis of DE421 (same frame as the ephemeris).

Outputs (public/data/terrain, public/assets):
  sites/<id>.json      terrain horizon mask (0.25° azimuth bins), far-field
                       horizon, site height, provenance
  sites/<id>-inner.png 512² local height grid, ±6 km, azimuthal-equidistant
  sites/<id>-outer.png 512² local height grid, ±48 km
  south-polar-480m.png LOLA south-polar DEM resampled to 480 m (75°S–90°S)
  moon-height-4k.png   global LOLA heights, 4096×2048 equirectangular
  moon-color-*.webp    colour mosaic, equirectangular (2k + 8k LOD)
  south-polar-color.webp colour mosaic reprojected to the polar DEM grid

16-bit values are packed as R = high byte, G = low byte of uint16
(value = DN + 32768 for absolute grids, round((h - h_site) * 2) + 32768 for
local grids), so they survive any 8-bit image pipeline losslessly.
"""

import json
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image
import tifffile

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".cache/raw"
OUT = ROOT / "public/data/terrain"
ASSETS = ROOT / "public/assets"
R = 1737400.0  # LOLA reference sphere radius, m
OBSERVER_HEIGHT = 2.0  # m above local terrain (deck/mast height assumption)
AZ_BINS = 1440  # 0.25° azimuth resolution
INNER_HALF, OUTER_HALF, TILE_N = 6000.0, 48000.0, 512


# ---------------------------------------------------------------- DEM readers

class PolarDEM:
    """South polar stereographic LOLA grid (DSMAP_POLAR.CAT conventions)."""

    def __init__(self, name, n, scale):
        self.name, self.n, self.scale = name, n, scale
        self.offset = n / 2 - 0.5  # 0-based pixel index of the pole
        self.data = np.memmap(RAW / f"{name}.img", dtype="<i2", mode="r", shape=(n, n))

    def pixel(self, lat, lon):
        r = 2 * R * np.tan(np.radians(90 - np.abs(lat)) / 2)
        lam = np.radians(lon)
        x, y = r * np.sin(lam), r * np.cos(lam)
        return x / self.scale + self.offset, -y / self.scale + self.offset

    def inside(self, i, j, margin=2):
        return (i >= margin) & (j >= margin) & (i <= self.n - 1 - margin) & (j <= self.n - 1 - margin) & np.isfinite(i)

    def sample(self, i, j):
        return bilinear(self.data, i, j) * 0.5


class GlobalDEM:
    """Simple cylindrical LOLA grid, 0°E at the left edge, +90° at the top."""

    def __init__(self, name, res):
        self.name, self.res = name, res
        self.lines, self.samples = 180 * res, 360 * res
        self.data = np.memmap(RAW / f"{name}.img", dtype="<i2", mode="r", shape=(self.lines, self.samples))

    def pixel(self, lat, lon):
        return np.mod(lon, 360.0) * self.res - 0.5, (90.0 - lat) * self.res - 0.5

    def inside(self, i, j, margin=1):
        return (j >= 0) & (j <= self.lines - 1) & np.isfinite(i)

    def sample(self, i, j):
        return bilinear(self.data, i, j, wrap_x=True) * 0.5


def bilinear(grid, i, j, wrap_x=False):
    """Bilinear interpolation; i = column (x), j = row (y), both 0-based."""
    h, w = grid.shape
    i = np.asarray(i, dtype=np.float64)
    j = np.clip(np.asarray(j, dtype=np.float64), 0, h - 1.000001)
    if wrap_x:
        i = np.mod(i, w)
    else:
        i = np.clip(i, 0, w - 1.000001)
    i0, j0 = np.floor(i).astype(np.int64), np.floor(j).astype(np.int64)
    fi, fj = i - i0, j - j0
    i1 = (i0 + 1) % w if wrap_x else np.minimum(i0 + 1, w - 1)
    j1 = np.minimum(j0 + 1, h - 1)
    a = grid[j0, i0].astype(np.float64)
    b = grid[j0, i1].astype(np.float64)
    c = grid[j1, i0].astype(np.float64)
    d = grid[j1, i1].astype(np.float64)
    return (a * (1 - fi) + b * fi) * (1 - fj) + (c * (1 - fi) + d * fi) * fj


class TieredSampler:
    """Uses the finest DEM that covers each point."""

    def __init__(self, tiers):
        self.tiers = tiers

    def heights(self, lat, lon):
        lat, lon = np.asarray(lat), np.asarray(lon)
        out = np.full(lat.shape, np.nan)
        used = np.full(lat.shape, -1, dtype=np.int8)
        for index, tier in enumerate(self.tiers):
            todo = np.isnan(out)
            if not todo.any():
                break
            i, j = tier.pixel(lat[todo], lon[todo])
            ok = tier.inside(i, j)
            if not ok.any():
                continue
            vals = np.full(i.shape, np.nan)
            vals[ok] = tier.sample(i[ok], j[ok])
            sub = out[todo]
            sub[ok] = vals[ok]
            out[todo] = sub
            u = used[todo]
            u[ok] = index
            used[todo] = u
        return out, used


# ---------------------------------------------------------------- geometry

def enu(lat, lon):
    """Unit up, east, north vectors (Moon-fixed) for planetocentric lat/lon in degrees.

    At the exact poles the chosen longitude fixes the east/north basis.
    """
    p, l = math.radians(lat), math.radians(lon)
    up = np.array([math.cos(p) * math.cos(l), math.cos(p) * math.sin(l), math.sin(p)])
    east = np.array([-math.sin(l), math.cos(l), 0.0])
    north = np.cross(up, east)
    return up, east, north


def unit_to_latlon(v):
    lat = np.degrees(np.arcsin(np.clip(v[..., 2], -1, 1)))
    lon = np.degrees(np.arctan2(v[..., 1], v[..., 0]))
    return lat, lon


def destination(lat, lon, azimuth_deg, distance_m):
    """Surface unit vectors at arc distance and azimuth (clockwise from north)."""
    up, east, north = enu(lat, lon)
    az = np.radians(azimuth_deg)[..., None]
    delta = (np.asarray(distance_m) / R)[..., None]
    direction = np.cos(az) * north + np.sin(az) * east
    return np.cos(delta) * up + np.sin(delta) * direction


def ray_distances(max_distance):
    parts = [
        np.arange(10, 2000, 10),
        np.arange(2000, 10000, 25),
        np.arange(10000, 40000, 60),
        np.arange(40000, 150000, 150),
        np.arange(150000, max_distance, 400),
    ]
    return np.concatenate(parts).astype(np.float64)


def horizon_mask(sampler, lat, lon, h0, max_distance=400000.0, far_from=OUTER_HALF * 0.92):
    distances = ray_distances(max_distance)
    azimuths = np.arange(AZ_BINS) * (360.0 / AZ_BINS)
    ro = R + h0 + OBSERVER_HEIGHT
    mask = np.empty(AZ_BINS)
    far = np.empty(AZ_BINS)
    far_index = np.searchsorted(distances, far_from)
    tiers_used = set()
    coverage = np.empty(AZ_BINS)
    for start in range(0, AZ_BINS, 60):
        az = azimuths[start:start + 60]
        pts = destination(lat, lon, az[:, None] * np.ones((1, distances.size)), distances[None, :])
        plat, plon = unit_to_latlon(pts)
        h, used = sampler.heights(plat, plon)
        tiers_used.update(int(t) for t in np.unique(used) if t >= 0)
        rp = R + h
        delta = distances / R
        vertical = rp * np.cos(delta) - ro
        horizontal = rp * np.sin(delta)
        angle = np.degrees(np.arctan2(vertical, horizontal))
        mask[start:start + 60] = np.nanmax(angle, axis=1)
        far[start:start + 60] = np.nanmax(angle[:, far_index:], axis=1)
        valid = np.isfinite(h)
        coverage[start:start + 60] = np.where(valid.all(axis=1), max_distance, distances[np.argmin(valid, axis=1)])
    return mask, far, sorted(tiers_used), float(coverage.min())


def local_grid(sampler, lat, lon, h0, half):
    """Azimuthal-equidistant height grid centred on the site, east = +x, north = +y (row 0 = north)."""
    axis = np.linspace(-half, half, TILE_N)
    east, north = np.meshgrid(axis, axis[::-1])
    distance = np.hypot(east, north)
    azimuth = np.degrees(np.arctan2(east, north))
    pts = destination(lat, lon, azimuth, distance)
    plat, plon = unit_to_latlon(pts)
    h, used = sampler.heights(plat, plon)
    if np.isnan(h).any():
        h = np.where(np.isnan(h), np.nanmean(h), h)
    return h, used


def pack16(values):
    v = np.clip(np.round(values), 0, 65535).astype(np.uint16)
    rgb = np.zeros(v.shape + (3,), dtype=np.uint8)
    rgb[..., 0] = v >> 8
    rgb[..., 1] = v & 0xFF
    return Image.fromarray(rgb, "RGB")


# ---------------------------------------------------------------- products

def build_sites(polar_sampler, global_sampler, tier_labels):
    meta = json.loads((ROOT / "src/data/sites.json").read_text())
    out_dir = OUT / "sites"
    out_dir.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[2:]) if len(sys.argv) > 2 else None
    for site in meta["sites"]:
        if only and site["id"] not in only:
            continue
        lat, lon = site["lat"], site["lon"]
        sampler = polar_sampler if lat < -74.0 else global_sampler
        labels = tier_labels["polar" if lat < -74.0 else "global"]
        h_site, used_site = sampler.heights(np.array([lat]), np.array([lon]))
        h0 = float(h_site[0])
        mask, far, used, reach = horizon_mask(sampler, lat, lon, h0)
        inner, inner_used = local_grid(sampler, lat, lon, h0, INNER_HALF)
        outer, outer_used = local_grid(sampler, lat, lon, h0, OUTER_HALF)
        pack16((inner - h0) * 2 + 32768).save(out_dir / f"{site['id']}-inner.png", optimize=True)
        pack16((outer - h0) * 2 + 32768).save(out_dir / f"{site['id']}-outer.png", optimize=True)
        record = {
            "id": site["id"],
            "lat": lat,
            "lon": lon,
            "heightM": round(h0, 1),
            "observerHeightM": OBSERVER_HEIGHT,
            "azimuthStepDeg": 360.0 / AZ_BINS,
            "horizonDeg": [round(float(x), 3) for x in mask],
            "farHorizonDeg": [round(float(x), 3) for x in far],
            "farFromM": OUTER_HALF * 0.92,
            "rayReachM": reach,
            "demSite": labels[int(used_site[0])],
            "demHorizon": [labels[t] for t in used],
            "inner": {"halfSizeM": INNER_HALF, "n": TILE_N, "dem": sorted({labels[t] for t in np.unique(inner_used) if t >= 0})},
            "outer": {"halfSizeM": OUTER_HALF, "n": TILE_N, "dem": sorted({labels[t] for t in np.unique(outer_used) if t >= 0})},
            "encoding": "uint16 = round((h - heightM) * 2) + 32768, R = high byte, G = low byte; row 0 = north edge, column 0 = west edge",
        }
        (out_dir / f"{site['id']}.json").write_text(json.dumps(record, separators=(",", ":")))
        print(f"{site['id']:<24} h0={h0:8.1f} m  max horizon={mask.max():5.2f}°  mean={mask.mean():5.2f}°  dem={record['demHorizon']}")


def build_polar_overview(dem240):
    """75°S–pole LOLA grid downsampled 2× (block mean) to 480 m for in-browser horizons and globe shading."""
    n = dem240.n // 2 * 2
    block = np.asarray(dem240.data[:n, :n], dtype=np.float64).reshape(n // 2, 2, n // 2, 2).mean(axis=(1, 3))
    pack16(block + 32768).save(OUT / "south-polar-480m.png", optimize=True)
    info = {
        "projection": "south polar stereographic, sphere R=1737.4 km, lon 0 up, 90E right",
        "n": n // 2,
        "scaleM": dem240.scale * 2,
        "offsetPx": (n // 2) / 2 - 0.5,
        "encoding": "uint16 = DN + 32768, height_m = DN * 0.5, R = high byte, G = low byte",
        "source": "LOLA LDEM_75S_240M (PDS LRO-L-LOLA-4-GDR-V1.0), 2x2 block mean",
    }
    (OUT / "south-polar-480m.json").write_text(json.dumps(info, indent=1))
    print("south-polar-480m.png", n // 2)
    return n // 2, dem240.scale * 2


GLOBAL_HEIGHT_MIN, GLOBAL_HEIGHT_MAX = -9200.0, 10800.0


def build_global_height():
    """Globe-scale products from LOLA LDEM_16 (re-centred so column 0 = 180°W, matching the colour mosaic).

    moon-height-2k.png  8-bit heights (78 m steps) for vertex relief and terminator shadows
    moon-normal-4k.webp tangent-space normals (R = east slope, G = north slope, B = up) from
                        full-precision heights at true vertical scale
    """
    dem = np.asarray(GlobalDEM("ldem_16", 16).data, dtype=np.float64) * 0.5
    dem = np.roll(dem, dem.shape[1] // 2, axis=1)  # 0°E at the centre
    full = Image.fromarray(dem.astype(np.float32), "F")
    h2k = np.asarray(full.resize((2048, 1024), Image.Resampling.BOX), dtype=np.float64)
    q = np.clip((h2k - GLOBAL_HEIGHT_MIN) / (GLOBAL_HEIGHT_MAX - GLOBAL_HEIGHT_MIN) * 255, 0, 255)
    Image.fromarray(np.round(q).astype(np.uint8), "L").save(OUT / "moon-height-2k.png", optimize=True)

    w, h = 4096, 2048
    h4k = np.asarray(full.resize((w, h), Image.Resampling.BOX), dtype=np.float64)
    lat = np.radians(90 - (np.arange(h) + 0.5) * 180 / h)[:, None]
    px_north = math.pi * R / h
    px_east = 2 * math.pi * R / w * np.maximum(np.cos(lat), 0.02)
    d_east = (np.roll(h4k, -1, axis=1) - np.roll(h4k, 1, axis=1)) / (2 * px_east)
    d_north = (np.vstack([h4k[:1], h4k[:-1]]) - np.vstack([h4k[1:], h4k[-1:]])) / (2 * px_north)
    n = np.dstack([-d_east, -d_north, np.ones_like(h4k)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    rgb = np.clip(np.round((n * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)
    Image.fromarray(rgb, "RGB").save(ASSETS / "moon-normal-4k.webp", quality=92, method=6)
    meta = {"heightMinM": GLOBAL_HEIGHT_MIN, "heightMaxM": GLOBAL_HEIGHT_MAX, "source": "LOLA LDEM_16 (PDS), box-resampled",
            "layout": "equirectangular, column 0 = 180°W, row 0 = 90°N"}
    (OUT / "moon-height-2k.json").write_text(json.dumps(meta, indent=1))
    print("moon-height-2k.png, moon-normal-4k.webp")


def build_color(polar_n, polar_scale):
    ASSETS.mkdir(parents=True, exist_ok=True)
    color8k = tifffile.imread(RAW / "lroc_color_poles_8k.tif")
    if color8k.dtype != np.uint8:
        color8k = (color8k / (65535 if color8k.max() > 255 else 255) * 255).astype(np.uint8)
    img = Image.fromarray(color8k[..., :3])
    img.save(ASSETS / "moon-color-8k.webp", quality=88, method=6)
    img.resize((2048, 1024), Image.Resampling.LANCZOS).save(ASSETS / "moon-color-2k.webp", quality=90, method=6)
    print("moon-color 8k/2k", img.size)

    color16 = tifffile.memmap(RAW / "lroc_color_poles_16k.tif") if False else tifffile.imread(RAW / "lroc_color_poles_16k.tif")
    h, w = color16.shape[:2]
    # Polar stereographic grid matching south-polar-480m.png
    idx = np.arange(polar_n) - (polar_n / 2 - 0.5)
    X, Yimg = np.meshgrid(idx * polar_scale, idx * polar_scale)
    Y = -Yimg
    rr = np.hypot(X, Y)
    lat = -90 + np.degrees(2 * np.arctan(0.5 * rr / R))
    lon = np.degrees(np.arctan2(X, Y))
    px = np.mod(lon, 360.0) / 360.0 * w - 0.5
    py = (90.0 - lat) / 180.0 * h - 0.5
    channels = [bilinear(color16[..., c], px, py, wrap_x=True) for c in range(3)]
    polar = np.stack(channels, axis=-1)
    if color16.dtype != np.uint8:
        polar = polar / (65535 if color16.max() > 255 else 255) * 255
    Image.fromarray(np.clip(polar, 0, 255).astype(np.uint8)).save(ASSETS / "south-polar-color.webp", quality=90, method=6)
    print("south-polar-color.webp", polar_n)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    dem20 = PolarDEM("ldem_875s_20m", 7584, 20.0)
    dem80 = PolarDEM("ldem_80s_80m", 7600, 80.0)
    dem240 = PolarDEM("ldem_75s_240m", 3812, 240.0)
    g128 = GlobalDEM("ldem_128", 128)
    polar = TieredSampler([dem20, dem80, dem240, g128])
    global_ = TieredSampler([g128])
    labels = {
        "polar": ["LOLA LDEM_875S_20M (20 m)", "LOLA LDEM_80S_80M (80 m)", "LOLA LDEM_75S_240M (240 m)", "LOLA LDEM_128 (~237 m)"],
        "global": ["LOLA LDEM_128 (~237 m)"],
    }
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    if step in ("all", "sites"):
        build_sites(polar, global_, labels)
    if step in ("all", "polar", "color"):
        n, scale = build_polar_overview(dem240)
        if step != "polar":
            build_color(n, scale)
    if step in ("all", "global"):
        build_global_height()


if __name__ == "__main__":
    main()
