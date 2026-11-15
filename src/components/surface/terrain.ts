import * as THREE from 'three';
import { MOON_RADIUS_KM } from '../../lib/science/constants';
import { sampleGrid, type HeightGrid } from '../../lib/terrain/heights';
import type { SiteTerrain } from '../../lib/terrain/sources';

const R = MOON_RADIUS_KM * 1000;

/** Height (m, relative to the site) at local east/north arc coordinates, using the finest available grid. */
export function makeLocalSampler(t: SiteTerrain) {
  const inner = t.inner, outer = t.outer;
  const hi = t.meta.inner.halfSizeM, ho = t.meta.outer.halfSizeM;
  const sample = (g: HeightGrid, half: number, e: number, n: number) => {
    const x = ((e + half) / (2 * half)) * (g.width - 1);
    const y = ((half - n) / (2 * half)) * (g.height - 1);
    return sampleGrid(g, Math.min(g.width - 1, Math.max(0, x)), Math.min(g.height - 1, Math.max(0, y)));
  };
  return (e: number, n: number): number => {
    const m = Math.max(Math.abs(e), Math.abs(n));
    const o = sample(outer, ho, e, n);
    if (m >= hi) return o;
    const i = sample(inner, hi, e, n);
    const w = THREE.MathUtils.smoothstep(m, hi * 0.85, hi * 0.98);
    return i * (1 - w) + o * w;
  };
}

/** Scene-space vertical offset of terrain at (e, n): relative height minus lunar curvature drop. */
export function surfaceY(sample: (e: number, n: number) => number, h0: number, e: number, n: number): number {
  const d = Math.hypot(e, n);
  const r = R + h0 + sample(e, n);
  return r * Math.cos(d / R) - (R + h0);
}

/**
 * Terrain mesh in the site's local frame (three = east, up, −north), metres.
 * Vertex spacing grows from ~14 m at the site to ~650 m at 48 km (level of detail),
 * and every vertex sits on the true curved lunar surface.
 */
export function buildTerrainGeometry(t: SiteTerrain, segments = 440): THREE.BufferGeometry {
  const sample = makeLocalSampler(t);
  const L = t.meta.outer.halfSizeM * 0.995;
  const h0 = t.meta.heightM;
  const a = 0.06;
  const axis = new Float64Array(segments + 1);
  for (let i = 0; i <= segments; i++) {
    const u = -1 + (2 * i) / segments;
    axis[i] = L * (a * u + (1 - a) * u * u * u);
  }
  const n = segments + 1;
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    const north = -axis[j];
    for (let i = 0; i < n; i++) {
      const east = axis[i];
      const d = Math.hypot(east, north);
      const r = R + h0 + sample(east, north);
      const delta = d / R;
      const horiz = r * Math.sin(delta);
      const k = (j * n + i) * 3;
      const ue = d > 0 ? east / d : 0, un = d > 0 ? north / d : 0;
      pos[k] = ue * horiz;
      pos[k + 1] = r * Math.cos(delta) - (R + h0);
      pos[k + 2] = -un * horiz;
      uv[(j * n + i) * 2] = east;
      uv[(j * n + i) * 2 + 1] = north;
    }
  }
  const idx = new Uint32Array(segments * segments * 6);
  let p = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a0 = j * n + i, b0 = a0 + 1, c0 = a0 + n, d0 = c0 + 1;
      idx[p++] = a0; idx[p++] = c0; idx[p++] = b0;
      idx[p++] = b0; idx[p++] = c0; idx[p++] = d0;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.userData.axis = axis;
  return g;
}

/**
 * Height of the *rendered* terrain mesh at scene (x, z), interpolated across the same two
 * triangles per cell the GPU draws. Objects placed with this sit exactly on the visible ground
 * (the smooth DEM sampler can differ from the faceted mesh by centimetres to decimetres).
 */
export function meshSurfaceY(g: THREE.BufferGeometry, x: number, z: number): number {
  const axis = g.userData.axis as Float64Array;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const n = axis.length;
  const find = (v: number) => {
    let lo = 0, hi = n - 1;
    if (v <= axis[0]) return 0;
    if (v >= axis[n - 1]) return n - 2;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (axis[m] <= v) lo = m;
      else hi = m;
    }
    return lo;
  };
  const e = x, north = -z;
  const i = find(e);
  const j = find(-north); // rows run from north = -axis[0] (south edge) … ; north = -axis[j]
  const u = THREE.MathUtils.clamp((e - axis[i]) / (axis[i + 1] - axis[i]), 0, 1);
  const v = THREE.MathUtils.clamp((-north - axis[j]) / (axis[j + 1] - axis[j]), 0, 1);
  const y = (jj: number, ii: number) => pos.getY(jj * n + ii);
  const ya = y(j, i), yb = y(j, i + 1), yc = y(j + 1, i), yd = y(j + 1, i + 1);
  return u + v <= 1 ? ya + (yb - ya) * u + (yc - ya) * v : yd + (yc - yd) * (1 - u) + (yb - yd) * (1 - v);
}

export function gridTexture(g: HeightGrid): THREE.DataTexture {
  const half = new Uint16Array(g.data.length);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(g.data[i]);
  const tex = new THREE.DataTexture(half, g.width, g.height, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Local slope (deg) and downhill azimuth at the site from the finest grid (central differences over ±2 px). */
export function siteSlope(t: SiteTerrain): { slopeDeg: number; normal: THREE.Vector3 } {
  const s = makeLocalSampler(t);
  const d = Math.max(20, (2 * t.meta.inner.halfSizeM) / (t.inner.width - 1)) * 2;
  const dhE = (s(d, 0) - s(-d, 0)) / (2 * d);
  const dhN = (s(0, d) - s(0, -d)) / (2 * d);
  const normal = new THREE.Vector3(-dhE, 1, dhN).normalize(); // three: x = east, y = up, z = −north
  return { slopeDeg: (Math.atan(Math.hypot(dhE, dhN)) * 180) / Math.PI, normal };
}

/**
 * Terrain horizon as seen from an arbitrary camera position in the surface scene, ray-cast
 * through the same LOLA tiles and the same curved-surface geometry the terrain mesh is built
 * from, so the guide line sits exactly on the rendered skyline. Beyond the tiles, the site's
 * far-field profile takes over. Azimuth k·(360/bins) is measured clockwise from scene north (−z).
 */
export function viewHorizon(t: SiteTerrain, far: ((az: number) => number) | null, cam: { x: number; y: number; z: number }, bins = 360, growth = 0.025): Float32Array {
  const sample = makeLocalSampler(t);
  const h0 = t.meta.heightM;
  const L = t.meta.outer.halfSizeM * 0.99;
  const out = new Float32Array(bins);
  const e0 = cam.x, n0 = -cam.z;
  for (let k = 0; k < bins; k++) {
    const az = (k * 2 * Math.PI) / bins;
    const se = Math.sin(az), sn = Math.cos(az);
    let best = -90;
    for (let s = 3; ; s += Math.max(3, s * growth)) {
      const e = e0 + se * s, n = n0 + sn * s;
      if (Math.abs(e) > L || Math.abs(n) > L) break;
      const d = Math.hypot(e, n);
      const r = R + h0 + sample(e, n);
      const delta = d / R;
      const horiz = r * Math.sin(delta);
      const px = d > 0 ? (e / d) * horiz : 0;
      const pz = d > 0 ? (-n / d) * horiz : 0;
      const py = r * Math.cos(delta) - (R + h0);
      const ang = Math.atan2(py - cam.y, Math.hypot(px - cam.x, pz - cam.z)) * (180 / Math.PI);
      if (ang > best) best = ang;
    }
    out[k] = far ? Math.max(best, far((k * 360) / bins)) : best;
  }
  return out;
}
