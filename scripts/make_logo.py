"""
Eclipse logo from the real Moon (run with the project venv):

  .venv/bin/python scripts/make_logo.py <out-dir>

Writes:
  moon-logo.svg     static vector mark: the near side's maria in black on a white disk, in a black ring
  moon-spin.mp4     one full turn every 9 s at 60 fps, for slides
  moon-spin.gif     the same turn at 50 fps (the smoothest a GIF plays reliably: frame delays are
                    in 1/100 s and browsers slow down anything shorter than 2/100 s)

Method. Everything is decided on the globe, before projecting, so shapes behave like real
surface features and stay visible all the way to the limb:
  1. The LROC WAC colour mosaic (NASA SVS CGI Moon Kit) is smoothed on the sphere at the scale
     of whole maria (the east-west blur widens with 1/cos(latitude) so it is the same on the
     ground everywhere).
  2. It is split into dark and bright where the dark share of the near side matches the maria's
     real share (~31%), so the black shapes are the actual maria.
  3. Specks and pinholes are removed by their true area on the sphere.
  4. Tycho, the most conspicuous crater at full Moon, is added as a ring at its true position.
Each view samples that map orthographically with 3x supersampling for smooth edges; the static
mark is traced to smooth Bézier curves.
"""
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import measure

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'brand')
OUT.mkdir(parents=True, exist_ok=True)
STATIC_ONLY = os.environ.get('STATIC_ONLY') == '1'

# Geometry of the mark (1000-unit square): white disk inside a thick black ring.
SIZE = 1000
RING_R = 476
RING_W = 44
DISK_R = RING_R  # the Moon is drawn to the ring's centre line; the ring covers the very edge
TYCHO = (-43.31, -11.36)
TYCHO_R, TYCHO_W = 0.115, 0.05  # ring angular radius and width on the sphere (rad), stylised
SMOOTH_DEG = 2.2   # smoothing scale on the ground (degrees of arc)
MARIA_PCT = 31.0   # dark share of the near side

# ------------------------------------------------------------------ 1. smooth on the sphere
W, H = 2048, 1024
alb = np.asarray(Image.open(ROOT / 'public/assets/moon-color-8k.webp').convert('L').resize((W, H), Image.BOX)).astype(np.float32) / 255
lat_rows = (0.5 - (np.arange(H) + 0.5) / H) * math.pi
sig_px = SMOOTH_DEG / 360 * W
sm = np.empty_like(alb)
for j in range(H):  # east-west, widening toward the poles; wraps around in longitude
    sx = min(sig_px / max(math.cos(lat_rows[j]), 1e-3), W / 3)
    sm[j] = ndimage.gaussian_filter1d(alb[j], sx, mode='wrap')
sm = ndimage.gaussian_filter1d(sm, sig_px, axis=0, mode='nearest')  # north-south


def ortho(n, lon0):
    """Orthographic view centred on longitude lon0 (deg): sphere lat/lon per pixel and disk mask."""
    y, x = np.mgrid[0:n, 0:n]
    k = DISK_R / (SIZE / 2)
    u = ((x + 0.5) / n * 2 - 1) / k
    v = (1 - (y + 0.5) / n * 2) / k
    inside = u * u + v * v <= 1
    z = np.sqrt(np.clip(1 - u * u - v * v, 0, 1))
    lat = np.arcsin(np.clip(v, -1, 1))
    lon = np.arctan2(u, z) + math.radians(lon0)
    return lat, lon, inside


def sample(field, lat, lon):
    """Bilinear lookup in an equirectangular field (column 0 = 180°W, row 0 = 90°N)."""
    px = (lon / (2 * math.pi) + 0.5) * W - 0.5
    py = np.clip((0.5 - lat / math.pi) * H - 0.5, 0, H - 1.001)
    x0 = np.floor(px).astype(int)
    y0 = np.floor(py).astype(int)
    fx, fy = px - x0, py - y0
    x0 %= W
    x1 = (x0 + 1) % W
    return field[y0, x0] * (1 - fx) * (1 - fy) + field[y0, x1] * fx * (1 - fy) + field[y0 + 1, x0] * (1 - fx) * fy + field[y0 + 1, x1] * fx * fy


# ------------------------------------------------------------------ 2. threshold at the maria's share
lat_n, lon_n, ins_n = ortho(800, 0.0)
THR = float(np.percentile(sample(sm, lat_n, lon_n)[ins_n], MARIA_PCT))
dark = sm < THR

# ------------------------------------------------------------------ 3. clean up by true area on the sphere
cell = np.broadcast_to(((2 * math.pi / W) * (math.pi / H) * np.cos(lat_rows))[:, None], (H, W))  # sr per pixel


def keep_large(mask, min_sr):
    lab, k = ndimage.label(mask)
    if k == 0:
        return mask
    area = ndimage.sum(cell, lab, range(1, k + 1))
    return np.isin(lab, np.nonzero(area >= min_sr)[0] + 1)


dark = keep_large(dark, 0.004)        # drop dark specks (smaller than ~0.03% of the sphere)
dark = ~keep_large(~dark, 0.0035)     # fill small bright pinholes
# A slight blur makes projected edges smooth curves rather than map pixels.
field = ndimage.gaussian_filter(dark.astype(np.float32), 1.2, mode='wrap')


def render_mask(n, lon0):
    lat, lon, inside = ortho(n, lon0)
    m = (sample(field, lat, lon) > 0.5) & inside
    tl, tn = math.radians(TYCHO[0]), math.radians(TYCHO[1])
    d = np.arccos(np.clip(np.sin(lat) * math.sin(tl) + np.cos(lat) * math.cos(tl) * np.cos(lon - tn), -1, 1))
    ring = (np.abs(d - TYCHO_R) < TYCHO_W / 2) & inside
    hole = (d < TYCHO_R - TYCHO_W / 2) & inside
    return (m & ~hole) | ring


def smooth_path(pts):
    """Catmull-Rom through simplified contour points -> SVG cubic Béziers."""
    p = measure.approximate_polygon(pts, tolerance=1.4)
    if len(p) > 1 and np.allclose(p[0], p[-1]):
        p = p[:-1]
    if len(p) < 4:
        return ''
    n = len(p)
    seg = [f'M{p[0][1]:.1f},{p[0][0]:.1f}']
    for i in range(n):
        p0, p1, p2, p3 = p[(i - 1) % n], p[i], p[(i + 1) % n], p[(i + 2) % n]
        c1, c2 = p1 + (p2 - p0) / 6, p2 - (p3 - p1) / 6
        seg.append(f'C{c1[1]:.1f},{c1[0]:.1f} {c2[1]:.1f},{c2[0]:.1f} {p2[1]:.1f},{p2[0]:.1f}')
    return ''.join(seg) + 'Z'


# ------------------------------------------------------------------ static SVG (near side)
mask = render_mask(SIZE, 0.0)
paths = [p for p in (smooth_path(c - 1) for c in measure.find_contours(np.pad(mask.astype(float), 1), 0.5)) if p]
c = SIZE / 2
(OUT / 'moon-logo.svg').write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" role="img" aria-label="Eclipse">
  <title>Eclipse</title>
  <defs><clipPath id="disk"><circle cx="{c}" cy="{c}" r="{RING_R}"/></clipPath></defs>
  <circle cx="{c}" cy="{c}" r="{RING_R}" fill="#fff"/>
  <path clip-path="url(#disk)" fill="#000" fill-rule="evenodd" d="{''.join(paths)}"/>
  <circle cx="{c}" cy="{c}" r="{RING_R}" fill="none" stroke="#000" stroke-width="{RING_W}"/>
</svg>
''')
print('svg ok', len(paths), 'paths, threshold', round(THR, 3))
if STATIC_ONLY:
    sys.exit(0)

# ------------------------------------------------------------------ hover sprite for the app's logo
# 120 frames, 3° apart, 96 px each, transparent outside the ring, laid out 12 x 10.
SP_N, SP_PX, SP_SS, SP_COLS = 120, 96, 4, 12
g = SP_PX * SP_SS
yy, xx = np.mgrid[0:g, 0:g]
rr_s = np.hypot(xx + 0.5 - g / 2, yy + 0.5 - g / 2) / (g / SIZE)
ring_s = np.abs(rr_s - RING_R) < RING_W / 2
out_s = rr_s > RING_R + RING_W / 2
sheet = Image.new('RGBA', (SP_PX * SP_COLS, SP_PX * (SP_N // SP_COLS)), (0, 0, 0, 0))
for i in range(SP_N):
    d = render_mask(g, -i * 360 / SP_N)
    v = np.full(d.shape, 255, np.uint8)
    v[d | ring_s] = 0
    rgba = np.dstack([v, v, v, np.where(out_s, 0, 255).astype(np.uint8)])
    fr = Image.fromarray(rgba, 'RGBA').resize((SP_PX, SP_PX), Image.LANCZOS)
    sheet.paste(fr, ((i % SP_COLS) * SP_PX, (i // SP_COLS) * SP_PX))
sheet.save(ROOT / 'public/assets/moon-spin-sprite.webp', lossless=True, quality=100, method=6)
print('sprite ok')
if os.environ.get('SPRITE_ONLY') == '1':
    sys.exit(0)

# ------------------------------------------------------------------ spin: one turn every 9 s
PERIOD_S = 9.0
PX, SS = 600, 3
yy, xx = np.mgrid[0:PX * SS, 0:PX * SS]
rr = np.hypot(xx + 0.5 - PX * SS / 2, yy + 0.5 - PX * SS / 2) / (PX * SS / SIZE)
ring_mask = np.abs(rr - RING_R) < RING_W / 2
outside = rr > RING_R + RING_W / 2


def frame(lon0):
    d = render_mask(PX * SS, lon0)
    img = np.full(d.shape, 255, np.uint8)
    img[d | ring_mask] = 0
    img[outside] = 255  # white background for slides
    return Image.fromarray(img, 'L').resize((PX, PX), Image.LANCZOS)


def spin(fps):
    n = round(PERIOD_S * fps)
    # The Moon turns west to east: seen with north up, features drift left to right.
    return [frame(-i * 360 / n) for i in range(n)]


tmp = OUT / '_frames'
tmp.mkdir(exist_ok=True)
if shutil.which('ffmpeg'):
    for i, f in enumerate(spin(60)):
        f.save(tmp / f'f{i:04d}.png')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '60', '-i', str(tmp / 'f%04d.png'),
                    '-vf', 'format=yuv420p', '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-movflags', '+faststart',
                    str(OUT / 'moon-spin.mp4')], check=True)
shutil.rmtree(tmp)
gif = [f.convert('P', palette=Image.ADAPTIVE, colors=16) for f in spin(50)]
gif[0].save(OUT / 'moon-spin.gif', save_all=True, append_images=gif[1:], duration=20, loop=0, optimize=True)
print('spin ok')
