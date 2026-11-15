import { create } from 'zustand';
import { DEG, MOON_RADIUS_KM, RAD } from '../science/constants';
import { computeHorizon, horizonAt, type HorizonProfile } from '../science/horizon';
import { siteFrame } from '../science/topocentric';
import type { SiteModel } from '../science/analysis';
import type { SiteTerrain } from './sources';
import { makeLocalSampler } from '../../components/surface/terrain';

const R = MOON_RADIUS_KM * 1000;

/**
 * Analysis for an observer who has walked away from the site (WASD in the surface view).
 * The near-field horizon is ray-cast from the new spot through the site's local LOLA
 * tiles (20 m inner, coarser outer) with the same ray caster used for custom sites; terrain
 * beyond the tiles comes from the site's precomputed far-field horizon. Both are expressed
 * in the walker's own east/north frame, which matters near the pole where "north" turns
 * quickly as you move.
 */
export function walkerModel(base: SiteModel, t: SiteTerrain, e: number, n: number, bins = 720): SiteModel {
  const f0 = base.frame;
  const sampleRel = makeLocalSampler(t);
  const half = t.meta.outer.halfSizeM * 0.99;
  // Walker position on the sphere.
  const relH = sampleRel(e, n);
  const P = [0, 1, 2].map((i) => f0.up[i] * (R + f0.heightM) + f0.east[i] * e + f0.north[i] * n);
  const len = Math.hypot(P[0], P[1], P[2]);
  const lat = Math.asin(P[2] / len) * RAD;
  const lon = Math.atan2(P[1], P[0]) * RAD;
  const frame = siteFrame(lat, lon, f0.heightM + relH);

  // Lat/lon → the site's local azimuthal-equidistant grid → absolute height (NaN off the tiles).
  const sampler = (la: number, lo: number) => {
    const p = la * DEG, l = lo * DEG;
    const v = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
    const de = v[0] * f0.east[0] + v[1] * f0.east[1] + v[2] * f0.east[2];
    const dn = v[0] * f0.north[0] + v[1] * f0.north[1] + v[2] * f0.north[2];
    const du = v[0] * f0.up[0] + v[1] * f0.up[1] + v[2] * f0.up[2];
    const d = Math.atan2(Math.hypot(de, dn), du) * R;
    const b = Math.atan2(de, dn);
    const x = d * Math.sin(b), y = d * Math.cos(b);
    if (Math.abs(x) > half || Math.abs(y) > half) return NaN;
    return f0.heightM + sampleRel(x, y);
  };
  const near = computeHorizon(sampler, lat, lon, { bins, maxDistanceM: half * 1.45, minStepM: 20, farFromM: Infinity });

  // Far field: the site's horizon from terrain beyond its tiles, looked up along the same direction.
  const values = new Float32Array(bins);
  const step = 360 / bins;
  for (let k = 0; k < bins; k++) {
    const az = k * step * DEG;
    const dx = frame.north[0] * Math.cos(az) + frame.east[0] * Math.sin(az);
    const dy = frame.north[1] * Math.cos(az) + frame.east[1] * Math.sin(az);
    const dz = frame.north[2] * Math.cos(az) + frame.east[2] * Math.sin(az);
    const azSite = Math.atan2(dx * f0.east[0] + dy * f0.east[1] + dz * f0.east[2], dx * f0.north[0] + dy * f0.north[1] + dz * f0.north[2]) * RAD;
    const far = base.horizon.far ? horizonAt(base.horizon, (azSite + 360) % 360, 'far') : -90;
    values[k] = Math.max(near.values[k], far);
  }
  const horizon: HorizonProfile = {
    kind: 'terrain',
    stepDeg: step,
    values,
    far: base.horizon.far,
    source: `${base.horizon.source}, re-cast from ${Math.round(Math.hypot(e, n))} m away`,
    resolutionM: base.horizon.resolutionM,
  };
  return { key: `${base.key}@${Math.round(e)},${Math.round(n)}`, name: base.name, frame, horizon };
}

/** Where the observer has walked to, and the analysis model for that spot. */
export const useWalker = create<{
  siteKey: string | null;
  e: number;
  n: number;
  model: SiteModel | null;
  set: (siteKey: string, e: number, n: number, model: SiteModel) => void;
  clear: () => void;
}>((set) => ({
  siteKey: null,
  e: 0,
  n: 0,
  model: null,
  set: (siteKey, e, n, model) => set({ siteKey, e, n, model }),
  clear: () => set({ siteKey: null, e: 0, n: 0, model: null }),
}));
