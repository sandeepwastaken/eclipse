import { MOON_RADIUS_KM } from '../science/constants';
import type { HorizonProfile } from '../science/horizon';
import { loadByteHeights, loadPackedHeights, sampleGrid, type HeightGrid } from './heights';

const base = () => import.meta.env.BASE_URL;
const R = MOON_RADIUS_KM * 1000;

// ---------------------------------------------------------------- curated sites

export interface SiteTerrainMeta {
  id: string;
  lat: number;
  lon: number;
  heightM: number;
  observerHeightM: number;
  azimuthStepDeg: number;
  horizonDeg: number[];
  farHorizonDeg: number[];
  farFromM: number;
  rayReachM: number;
  demSite: string;
  demHorizon: string[];
  inner: { halfSizeM: number; n: number; dem: string[] };
  outer: { halfSizeM: number; n: number; dem: string[] };
}

export interface SiteTerrain {
  meta: SiteTerrainMeta;
  horizon: HorizonProfile;
  /** Local azimuthal-equidistant height grids relative to the site (m). Row 0 = north, col 0 = west. */
  inner: HeightGrid;
  outer: HeightGrid;
}

const metaCache = new Map<string, Promise<SiteTerrainMeta>>();
const tileCache = new Map<string, Promise<SiteTerrain>>();

export function loadSiteMeta(id: string): Promise<SiteTerrainMeta> {
  let p = metaCache.get(id);
  if (!p) {
    p = fetch(`${base()}data/terrain/sites/${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`No terrain for ${id}`);
      return r.json() as Promise<SiteTerrainMeta>;
    });
    metaCache.set(id, p);
  }
  return p;
}

export function profileFromMeta(meta: SiteTerrainMeta): HorizonProfile {
  const finest = meta.demSite.match(/\((~?\d+) m\)/)?.[1];
  return {
    kind: 'terrain',
    stepDeg: meta.azimuthStepDeg,
    values: Float32Array.from(meta.horizonDeg),
    far: Float32Array.from(meta.farHorizonDeg),
    farFromM: meta.farFromM,
    source: meta.demHorizon.join(' · '),
    resolutionM: finest ? Number(finest.replace('~', '')) : undefined,
  };
}

export function loadSiteTerrain(id: string): Promise<SiteTerrain> {
  let p = tileCache.get(id);
  if (!p) {
    p = (async () => {
      const meta = await loadSiteMeta(id);
      const [inner, outer] = await Promise.all([
        loadPackedHeights(`${base()}data/terrain/sites/${id}-inner.png`),
        loadPackedHeights(`${base()}data/terrain/sites/${id}-outer.png`),
      ]);
      return { meta, horizon: profileFromMeta(meta), inner, outer };
    })();
    tileCache.set(id, p);
  }
  return p;
}

// ---------------------------------------------------------------- regional grids

export interface PolarGrid {
  grid: HeightGrid;
  scaleM: number;
  offsetPx: number;
}

let polarPromise: Promise<PolarGrid> | null = null;
export function loadPolarGrid(): Promise<PolarGrid> {
  polarPromise ??= (async () => {
    const info = (await (await fetch(`${base()}data/terrain/south-polar-480m.json`)).json()) as { n: number; scaleM: number; offsetPx: number };
    const grid = await loadPackedHeights(`${base()}data/terrain/south-polar-480m.png`);
    return { grid, scaleM: info.scaleM, offsetPx: info.offsetPx };
  })();
  return polarPromise;
}

/** LOLA south polar stereographic pixel coordinates (DSMAP_POLAR.CAT): lon 0 up, 90°E right. */
export function polarPixel(p: PolarGrid, lat: number, lon: number): [number, number] {
  const r = 2 * R * Math.tan(((90 - Math.abs(lat)) * Math.PI) / 360);
  const l = (lon * Math.PI) / 180;
  return [(r * Math.sin(l)) / p.scaleM + p.offsetPx, (-r * Math.cos(l)) / p.scaleM + p.offsetPx];
}

export function polarSampler(p: PolarGrid) {
  return (lat: number, lon: number): number => {
    if (lat > -74.9) return NaN;
    const [x, y] = polarPixel(p, lat, lon);
    return sampleGrid(p.grid, x, y);
  };
}

export const GLOBAL_HEIGHT_RANGE = { min: -9200, max: 10800 };

let globalPromise: Promise<HeightGrid> | null = null;
export function loadGlobalGrid(): Promise<HeightGrid> {
  globalPromise ??= loadByteHeights(`${base()}data/terrain/moon-height-2k.png`, GLOBAL_HEIGHT_RANGE.min, GLOBAL_HEIGHT_RANGE.max);
  return globalPromise;
}

/** Equirectangular grid with column 0 = 180°W and row 0 = 90°N. */
export function globalSampler(g: HeightGrid) {
  return (lat: number, lon: number): number => {
    const x = ((lon + 180) / 360) * g.width - 0.5;
    const y = ((90 - lat) / 180) * g.height - 0.5;
    return sampleGrid(g, x, Math.min(g.height - 1, Math.max(0, y)), true);
  };
}
