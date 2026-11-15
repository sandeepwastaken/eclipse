import { DEG, MOON_RADIUS_KM, OBSERVER_HEIGHT_M, RAD } from './constants';

/**
 * Elevation of the local horizon (degrees) as a function of azimuth.
 * `terrain` profiles come from LOLA DEM ray casting; `sphere` is the smooth
 * 1737.4 km reference sphere (horizon at 0°, ignoring the ~0.003° dip for a
 * 2 m observer).
 */
export interface HorizonProfile {
  kind: 'terrain' | 'sphere';
  /** Azimuth spacing of `values`, degrees. values[k] is the horizon at az = k * stepDeg. */
  stepDeg: number;
  values: Float32Array;
  /** Horizon formed only by terrain beyond `farFromM` (used to draw distant mountains). */
  far?: Float32Array;
  farFromM?: number;
  /** Human-readable data provenance. */
  source: string;
  /** Effective DEM resolution of the near field, m. */
  resolutionM?: number;
}

export const SPHERE_HORIZON: HorizonProfile = { kind: 'sphere', stepDeg: 360, values: new Float32Array([0]), source: 'Smooth 1737.4 km reference sphere' };

export function horizonAt(profile: HorizonProfile, azDeg: number, which: 'values' | 'far' = 'values'): number {
  const arr = which === 'far' ? profile.far ?? profile.values : profile.values;
  if (arr.length === 1) return arr[0];
  const n = arr.length;
  let x = (azDeg / profile.stepDeg) % n;
  if (x < 0) x += n;
  const i = Math.floor(x);
  const f = x - i;
  const a = arr[i];
  const b = arr[(i + 1) % n];
  return a + (b - a) * f;
}

export interface HorizonStats {
  min: number;
  max: number;
  mean: number;
}

export function horizonStats(profile: HorizonProfile): HorizonStats {
  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of profile.values) {
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
  }
  return { min, max, mean: sum / profile.values.length };
}

/** Height sampler: returns terrain height (m above the reference sphere) or NaN outside coverage. */
export type HeightSampler = (latDeg: number, lonDeg: number) => number;

export interface ComputeHorizonOptions {
  bins?: number;
  maxDistanceM?: number;
  /** Smallest ray step, m; should be about the DEM resolution. */
  minStepM?: number;
  observerHeightM?: number;
  farFromM?: number;
}

/**
 * Ray-cast a terrain horizon around (lat, lon) through a height sampler, including
 * lunar curvature. Same geometry as scripts/build_terrain.py: for every azimuth,
 * the horizon is the maximum elevation angle of terrain points seen from an
 * observer `observerHeightM` above the local surface.
 */
export function computeHorizon(sample: HeightSampler, lat: number, lon: number, opts: ComputeHorizonOptions = {}): { values: Float32Array; far: Float32Array; h0: number; reachM: number } {
  const bins = opts.bins ?? 720;
  const maxD = opts.maxDistanceM ?? 300_000;
  const minStep = opts.minStepM ?? 240;
  const obsH = opts.observerHeightM ?? OBSERVER_HEIGHT_M;
  const farFrom = opts.farFromM ?? 44_000;
  const R = MOON_RADIUS_KM * 1000;
  const h0 = sample(lat, lon);
  const base = Number.isFinite(h0) ? h0 : 0;
  const ro = R + base + obsH;

  // Geometric step growth keeps near-field detail while reaching far mountains.
  const dists: number[] = [];
  for (let d = minStep * 0.5; d < maxD; d += Math.max(minStep * 0.5, d * 0.012)) dists.push(d);

  const p = lat * DEG, l = lon * DEG;
  const up = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  const east = [-Math.sin(l), Math.cos(l), 0];
  const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];

  const values = new Float32Array(bins);
  const far = new Float32Array(bins);
  let reach = maxD;
  for (let k = 0; k < bins; k++) {
    const az = (k * 360 / bins) * DEG;
    const ca = Math.cos(az), sa = Math.sin(az);
    const dx = north[0] * ca + east[0] * sa;
    const dy = north[1] * ca + east[1] * sa;
    const dz = north[2] * ca + east[2] * sa;
    let best = -90, bestFar = -90;
    for (const d of dists) {
      const delta = d / R;
      const cd = Math.cos(delta), sd = Math.sin(delta);
      const x = up[0] * cd + dx * sd, y = up[1] * cd + dy * sd, z = up[2] * cd + dz * sd;
      const h = sample(Math.asin(Math.max(-1, Math.min(1, z))) * RAD, Math.atan2(y, x) * RAD);
      if (!Number.isFinite(h)) {
        reach = Math.min(reach, d);
        break;
      }
      const rp = R + h;
      const ang = Math.atan2(rp * cd - ro, rp * sd) * RAD;
      if (ang > best) best = ang;
      if (d >= farFrom && ang > bestFar) bestFar = ang;
    }
    values[k] = best;
    far[k] = bestFar;
  }
  return { values, far, h0: base, reachM: reach };
}
