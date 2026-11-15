import { DEG, MOON_RADIUS_KM, RAD } from '../science/constants';
import { computeHorizon, type HeightSampler, type HorizonProfile } from '../science/horizon';
import type { HeightGrid } from './heights';
import { globalSampler, loadGlobalGrid, loadPolarGrid, polarSampler, type SiteTerrain, type SiteTerrainMeta } from './sources';

const R = MOON_RADIUS_KM * 1000;

/** Azimuthal-equidistant local grid around a site (row 0 = north, col 0 = west), heights relative to h0. */
export function buildLocalGrid(sample: HeightSampler, lat: number, lon: number, h0: number, half: number, n: number): HeightGrid {
  const p = lat * DEG, l = lon * DEG;
  const up = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  const east = [-Math.sin(l), Math.cos(l), 0];
  const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
  const data = new Float32Array(n * n);
  let fallback = 0;
  for (let row = 0; row < n; row++) {
    const nn = half - (2 * half * row) / (n - 1);
    for (let col = 0; col < n; col++) {
      const ee = -half + (2 * half * col) / (n - 1);
      const d = Math.hypot(ee, nn);
      const delta = d / R;
      const dirE = d > 0 ? ee / d : 0, dirN = d > 0 ? nn / d : 0;
      const cd = Math.cos(delta), sd = Math.sin(delta);
      const x = up[0] * cd + (north[0] * dirN + east[0] * dirE) * sd;
      const y = up[1] * cd + (north[1] * dirN + east[1] * dirE) * sd;
      const z = up[2] * cd + (north[2] * dirN + east[2] * dirE) * sd;
      const h = sample(Math.asin(Math.max(-1, Math.min(1, z))) * RAD, Math.atan2(y, x) * RAD);
      const v = Number.isFinite(h) ? h - h0 : fallback;
      fallback = v;
      data[row * n + col] = v;
    }
  }
  return { width: n, height: n, data };
}

/**
 * Terrain for an arbitrary coordinate from the shipped regional grids:
 * LOLA 480 m polar grid poleward of 75.5°S, otherwise the ~5 km global grid.
 */
export async function buildCustomTerrain(lat: number, lon: number): Promise<SiteTerrain> {
  const polar = lat < -75.5;
  let sample: HeightSampler;
  let label: string;
  let res: number;
  if (polar) {
    const g = await loadPolarGrid();
    const ps = polarSampler(g);
    const gs = globalSampler(await loadGlobalGrid());
    sample = (la, lo) => {
      const h = ps(la, lo);
      return Number.isFinite(h) ? h : gs(la, lo);
    };
    label = 'LOLA LDEM_75S_240M resampled to 480 m';
    res = 480;
  } else {
    sample = globalSampler(await loadGlobalGrid());
    label = 'LOLA LDEM_16, ~5.3 km global grid (coarse)';
    res = 5300;
  }
  const h = computeHorizon(sample, lat, lon, { bins: 720, minStepM: res * 0.5, maxDistanceM: 300_000 });
  const inner = buildLocalGrid(sample, lat, lon, h.h0, 6000, 128);
  const outer = buildLocalGrid(sample, lat, lon, h.h0, 48000, 256);
  const horizon: HorizonProfile = { kind: 'terrain', stepDeg: 0.5, values: h.values, far: h.far, farFromM: 44000, source: label, resolutionM: res };
  const meta: SiteTerrainMeta = {
    id: `custom:${lat.toFixed(4)},${lon.toFixed(4)}`,
    lat, lon,
    heightM: h.h0,
    observerHeightM: 2,
    azimuthStepDeg: 0.5,
    horizonDeg: Array.from(h.values),
    farHorizonDeg: Array.from(h.far),
    farFromM: 44000,
    rayReachM: h.reachM,
    demSite: label,
    demHorizon: [label],
    inner: { halfSizeM: 6000, n: 128, dem: [label] },
    outer: { halfSizeM: 48000, n: 256, dem: [label] },
  };
  return { meta, horizon, inner, outer };
}
