import { create } from 'zustand';
import { DEFAULT_CRITERIA, type Criteria } from '../lib/science/analysis';
import { DAY_MS, HOUR_MS } from '../lib/science/constants';
import { normalizeLon } from '../lib/science/topocentric';
import { DEFAULT_COMPARE_SITE_ID, DEFAULT_SITE_ID, getSite } from '../data/sites';
import type { Band } from '../lib/science/comms';

export type ScenarioId = 'A' | 'B';
export type SiteRef = { kind: 'curated'; id: string } | { kind: 'custom'; lat: number; lon: number };
export type ViewMode = 'orbit' | 'surface';
export type Sheet = null | 'methodology' | 'dates' | 'keys';

export interface Scenario {
  site: SiteRef;
  /** Landing epoch, ms UTC. */
  landing: number;
  durationDays: number;
}

export const EPHEMERIS_START = Date.UTC(2026, 0, 1);
export const EPHEMERIS_END = Date.UTC(2029, 0, 1);
export const DEFAULT_LANDING = Date.UTC(2026, 10, 14, 12);
export const DURATIONS = [3, 7, 14, 30, 90, 180, 365] as const;
export const SPEEDS = [1, 6, 24, 72, 168] as const; // simulated hours per second

export const siteKey = (s: SiteRef) => (s.kind === 'curated' ? s.id : `custom:${s.lat.toFixed(4)},${s.lon.toFixed(4)}`);
export const siteLatLon = (s: SiteRef): [number, number] => {
  if (s.kind === 'custom') return [s.lat, s.lon];
  const c = getSite(s.id);
  return c ? [c.lat, c.lon] : [0, 0];
};
export const siteName = (s: SiteRef) => (s.kind === 'curated' ? getSite(s.id)?.name ?? s.id : 'Custom site');

export function clampLanding(t: number, durationDays: number): number {
  const latest = EPHEMERIS_END - Math.min(durationDays, 365) * DAY_MS;
  return Math.min(latest, Math.max(EPHEMERIS_START, Math.round(t / 60_000) * 60_000));
}

interface CameraCommand {
  kind: 'reset' | 'pole' | 'site' | 'sun' | 'earth' | 'lander';
  nonce: number;
}

export interface AppState {
  scenarios: Record<ScenarioId, Scenario>;
  active: ScenarioId;
  compare: boolean;
  /** Playhead, ms after each scenario's landing (shared so compared missions stay aligned). */
  elapsed: number;
  playing: boolean;
  speed: number;
  view: ViewMode;
  criteria: Criteria;
  sheet: Sheet;
  camera: CameraCommand;
  reliefExaggeration: number;
  overlays: boolean;
  /** Headlamp from the camera: on by default when you land in darkness. */
  lamp: boolean;
  setLamp: (on: boolean) => void;
  /** Radio band for the direct-to-Earth link budget. */
  band: Band;
  setBand: (b: Band) => void;
  /** Scene-only mode: every panel and label hidden. */
  uiHidden: boolean;
  setUiHidden: (on: boolean) => void;
  setSite: (id: ScenarioId, site: SiteRef) => void;
  setLanding: (id: ScenarioId, t: number) => void;
  setDuration: (id: ScenarioId, days: number) => void;
  setActive: (id: ScenarioId) => void;
  setCompare: (on: boolean) => void;
  setElapsed: (ms: number) => void;
  setPlaying: (on: boolean) => void;
  setSpeed: (s: number) => void;
  setView: (v: ViewMode) => void;
  setCriteria: (c: Partial<Criteria>) => void;
  setSheet: (s: Sheet) => void;
  command: (kind: CameraCommand['kind']) => void;
  setRelief: (x: number) => void;
  setOverlays: (on: boolean) => void;
  swap: () => void;
  hydrate: (p: Partial<Pick<AppState, 'scenarios' | 'compare' | 'view' | 'elapsed' | 'active' | 'criteria'>>) => void;
}

export const useApp = create<AppState>((set, get) => ({
  scenarios: {
    A: { site: { kind: 'curated', id: DEFAULT_SITE_ID }, landing: DEFAULT_LANDING, durationDays: 30 },
    B: { site: { kind: 'curated', id: DEFAULT_COMPARE_SITE_ID }, landing: DEFAULT_LANDING, durationDays: 30 },
  },
  active: 'A',
  compare: false,
  elapsed: 0,
  playing: false,
  speed: 24,
  view: 'orbit',
  criteria: DEFAULT_CRITERIA,
  sheet: null,
  camera: { kind: 'site', nonce: 0 },
  reliefExaggeration: 1,
  overlays: true,
  lamp: false,
  band: 'X',
  setBand: (band) => set({ band }),
  uiHidden: false,
  setUiHidden: (uiHidden) => set({ uiHidden }),
  setSite: (id, site) => {
    const s = site.kind === 'custom' ? { kind: 'custom' as const, lat: Math.max(-90, Math.min(90, site.lat)), lon: normalizeLon(site.lon) } : site;
    set((st) => ({ scenarios: { ...st.scenarios, [id]: { ...st.scenarios[id], site: s } }, camera: { kind: 'site', nonce: st.camera.nonce + 1 } }));
  },
  setLanding: (id, t) => set((st) => ({ scenarios: { ...st.scenarios, [id]: { ...st.scenarios[id], landing: clampLanding(t, st.scenarios[id].durationDays) } } })),
  setDuration: (id, days) =>
    set((st) => {
      const sc = st.scenarios[id];
      const scenarios = { ...st.scenarios, [id]: { ...sc, durationDays: days, landing: clampLanding(sc.landing, days) } };
      const maxDays = Math.max(scenarios.A.durationDays, st.compare ? scenarios.B.durationDays : 0);
      return { scenarios, elapsed: Math.min(st.elapsed, maxDays * DAY_MS) };
    }),
  setActive: (active) => set((st) => ({ active, camera: { kind: 'site', nonce: st.camera.nonce + 1 } })),
  setCompare: (compare) => set((st) => ({ compare, active: compare ? st.active : 'A' })),
  setElapsed: (ms) => {
    const st = get();
    const max = Math.max(st.scenarios.A.durationDays, st.compare ? st.scenarios.B.durationDays : 0) * DAY_MS;
    set({ elapsed: Math.min(max, Math.max(0, ms)) });
  },
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setView: (view) => set({ view }),
  setCriteria: (c) => set((st) => ({ criteria: { ...st.criteria, ...c } })),
  setSheet: (sheet) => set({ sheet }),
  command: (kind) => set((st) => ({ camera: { kind, nonce: st.camera.nonce + 1 } })),
  setRelief: (reliefExaggeration) => set({ reliefExaggeration }),
  setOverlays: (overlays) => set({ overlays }),
  setLamp: (lamp) => set({ lamp }),
  swap: () => set((st) => ({ scenarios: { A: st.scenarios.B, B: st.scenarios.A } })),
  hydrate: (p) => set((st) => ({ ...st, ...p })),
}));

export const playheadTime = (sc: Scenario, elapsed: number) => sc.landing + Math.min(elapsed, sc.durationDays * DAY_MS);
export const HOUR = HOUR_MS;
