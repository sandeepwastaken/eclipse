import { useEffect, useMemo, useState } from 'react';
import { analyzeMission, computeLongSeries, type LongSeries, type MissionAnalysis, type SiteModel } from '../lib/science/analysis';
import { DAY_MS } from '../lib/science/constants';
import { loadEphemeris, type Ephemeris } from '../lib/science/ephemeris';
import { SPHERE_HORIZON } from '../lib/science/horizon';
import { siteFrame } from '../lib/science/topocentric';
import { buildCustomTerrain } from '../lib/terrain/custom';
import { loadSiteMeta, loadSiteTerrain, profileFromMeta, type SiteTerrain } from '../lib/terrain/sources';
import { useWalker } from '../lib/terrain/walker';
import { siteKey, siteLatLon, siteName, useApp, type ScenarioId, type SiteRef } from '../state/store';

// ---------------------------------------------------------------- ephemeris

let ephPromise: Promise<Ephemeris> | null = null;
let ephValue: Ephemeris | null = null;
export function getEphemeris(): Promise<Ephemeris> {
  ephPromise ??= loadEphemeris().then((e) => (ephValue = e));
  return ephPromise;
}
export const ephemerisNow = () => ephValue;

export function useEphemeris(): { eph: Ephemeris | null; error: string | null } {
  const [state, setState] = useState<{ eph: Ephemeris | null; error: string | null }>({ eph: ephValue, error: null });
  useEffect(() => {
    if (ephValue) return;
    getEphemeris().then((eph) => setState({ eph, error: null }), (e: Error) => setState({ eph: null, error: e.message }));
  }, []);
  return state;
}

// ---------------------------------------------------------------- site models

export interface ResolvedSite {
  model: SiteModel;
  status: 'sphere' | 'terrain';
}

const modelCache = new Map<string, ResolvedSite>();
const customCache = new Map<string, Promise<SiteTerrain>>();

export function customTerrain(lat: number, lon: number): Promise<SiteTerrain> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  let p = customCache.get(key);
  if (!p) {
    p = buildCustomTerrain(lat, lon);
    customCache.set(key, p);
  }
  return p;
}

function sphereModel(ref: SiteRef): ResolvedSite {
  const [lat, lon] = siteLatLon(ref);
  return { model: { key: siteKey(ref), name: siteName(ref), frame: siteFrame(lat, lon, 0), horizon: SPHERE_HORIZON }, status: 'sphere' };
}

/** Resolves a site reference to a geometry model with its LOLA horizon (falls back to the sphere while loading). */
export function useSiteModel(ref: SiteRef): ResolvedSite {
  const key = siteKey(ref);
  const [resolved, setResolved] = useState<ResolvedSite>(() => modelCache.get(key) ?? sphereModel(ref));
  useEffect(() => {
    const cached = modelCache.get(key);
    if (cached) {
      setResolved(cached);
      return;
    }
    setResolved(sphereModel(ref));
    let alive = true;
    const [lat, lon] = siteLatLon(ref);
    const job = ref.kind === 'curated'
      ? loadSiteMeta(ref.id).then((meta) => ({ heightM: meta.heightM, horizon: profileFromMeta(meta) }))
      : customTerrain(lat, lon).then((t) => ({ heightM: t.meta.heightM, horizon: t.horizon }));
    job.then(
      ({ heightM, horizon }) => {
        const r: ResolvedSite = { model: { key, name: siteName(ref), frame: siteFrame(lat, lon, heightM), horizon }, status: 'terrain' };
        modelCache.set(key, r);
        if (alive) setResolved(r);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return resolved;
}

export function useSiteTerrain(ref: SiteRef, enabled: boolean): SiteTerrain | null {
  const key = siteKey(ref);
  const [terrain, setTerrain] = useState<{ key: string; t: SiteTerrain } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const [lat, lon] = siteLatLon(ref);
    const job = ref.kind === 'curated' ? loadSiteTerrain(ref.id) : customTerrain(lat, lon);
    job.then((t) => alive && setTerrain({ key, t }), () => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return terrain && terrain.key === key ? terrain.t : null;
}

// ---------------------------------------------------------------- analyses

const longCache = new Map<string, LongSeries>();
export function getLongSeries(eph: Ephemeris, model: SiteModel, criteriaKey: string, criteria: Parameters<typeof computeLongSeries>[2]): LongSeries {
  const key = `${model.key}|${model.horizon.kind}|${criteriaKey}`;
  let v = longCache.get(key);
  if (!v) {
    v = computeLongSeries(eph, model, criteria);
    longCache.set(key, v);
    // Walking creates a new observer model every few metres: keep only the latest few.
    const walked = [...longCache.keys()].filter((k) => k.includes('@'));
    for (const k of walked.slice(0, Math.max(0, walked.length - 4))) longCache.delete(k);
  }
  return v;
}

export interface ScenarioData {
  id: ScenarioId;
  site: ResolvedSite;
  mission: MissionAnalysis | null;
  long: LongSeries | null;
}

export function useScenarioData(id: ScenarioId, enabled = true): ScenarioData {
  const { eph } = useEphemeris();
  const sc = useApp((s) => s.scenarios[id]);
  const criteria = useApp((s) => s.criteria);
  const siteBase = useSiteModel(sc.site);
  // If the observer has walked away from the site in the surface view, analyse that spot.
  const walked = useWalker((s) => (s.model && s.siteKey === siteBase.model.key ? s.model : null));
  const site = useMemo<ResolvedSite>(() => (walked ? { model: walked, status: 'terrain' } : siteBase), [walked, siteBase]);
  const criteriaKey = `${criteria.sun}|${criteria.earthMaskDeg}`;
  const mission = useMemo(
    () => (eph && enabled ? analyzeMission(eph, site.model, sc.landing, sc.durationDays * DAY_MS, criteria) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eph, site, sc.landing, sc.durationDays, criteriaKey, enabled],
  );
  const long = useMemo(
    () => (eph && enabled ? getLongSeries(eph, site.model, criteriaKey, criteria) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eph, site, criteriaKey, enabled],
  );
  return { id, site, mission, long };
}

/** Throttled subscription to the playhead for React UI (3D reads the store directly each frame). */
export function useThrottledElapsed(hz = 20): number {
  const [v, setV] = useState(() => useApp.getState().elapsed);
  useEffect(() => {
    let last = 0;
    let timer: number | null = null;
    return useApp.subscribe((s) => {
      const now = performance.now();
      const apply = () => {
        last = performance.now();
        timer = null;
        setV(useApp.getState().elapsed);
      };
      if (now - last > 1000 / hz) apply();
      else if (timer === null) timer = window.setTimeout(apply, 1000 / hz - (now - last));
      void s;
    });
  }, [hz]);
  return v;
}
