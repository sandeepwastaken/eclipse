import { create } from 'zustand';

/**
 * Adaptive render quality. Four tiers trade resolution, post-processing and shader work for
 * frame rate; in Auto the governor (components/scene/QualityGovernor) measures real GPU and
 * frame times and moves between tiers to hold 60 fps, never dropping below 30.
 */
export type Tier = 0 | 1 | 2 | 3;
export const TIER_NAMES = ['Low', 'Balanced', 'High', 'Ultra'] as const;

export interface Profile {
  /** Rendered pixel budget (device pixels); the canvas resolution scales to fit it. */
  pixels: number;
  /** Ceiling on the device-pixel ratio. */
  maxDpr: number;
  /** MSAA samples in the post-processing chain. */
  msaa: 0 | 2 | 4;
  /** off: tone mapping in the shaders only. lite: bloom + tone map + vignette + FXAA. full: the whole lens. */
  post: 'off' | 'lite' | 'full';
  /** Ray-march steps for terrain cast shadows (globe polar / globe global / surface). */
  steps: [number, number, number];
  /** 0–1: procedural sub-DEM detail (crater octaves, regolith noise). */
  detail: number;
  /** Boulders scattered around the lander. */
  rocks: number;
  shadowMap: number;
  /** Frosted-glass (backdrop blur) panels: costly to composite over a live WebGL canvas. */
  glass: boolean;
  /** Idle redraws for purely cosmetic motion (corona drift, astronaut breathing). */
  ambient: boolean;
  /** Globe tessellation. */
  globe: [number, number];
}

export const PROFILES: Record<Tier, Profile> = {
  0: { pixels: 0.62e6, maxDpr: 1, msaa: 0, post: 'off', steps: [16, 13, 12], detail: 0, rocks: 700, shadowMap: 1024, glass: false, ambient: false, globe: [360, 180] },
  1: { pixels: 1.15e6, maxDpr: 1.25, msaa: 0, post: 'lite', steps: [26, 21, 20], detail: 0.55, rocks: 1500, shadowMap: 2048, glass: false, ambient: false, globe: [512, 256] },
  2: { pixels: 2.3e6, maxDpr: 1.5, msaa: 4, post: 'full', steps: [44, 36, 34], detail: 1, rocks: 2600, shadowMap: 2048, glass: true, ambient: true, globe: [720, 360] },
  3: { pixels: 4.4e6, maxDpr: 2, msaa: 4, post: 'full', steps: [44, 36, 34], detail: 1, rocks: 2600, shadowMap: 4096, glass: true, ambient: true, globe: [720, 360] },
};

/** Live measurements, written by the governor every frame (never React state). */
export const perfStats = { fps: 0, frameMs: 0, gpuMs: NaN, dpr: 1, width: 0, height: 0, gpuName: '', continuous: false };

const KEY = 'eclipse:quality:v1';

interface Saved {
  mode: 'auto' | Tier;
  learned: Record<string, Tier>;
}

function load(): Saved {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (raw && typeof raw === 'object') return { mode: raw.mode ?? 'auto', learned: raw.learned ?? {} };
  } catch {
    /* storage blocked: defaults */
  }
  return { mode: 'auto', learned: {} };
}

function save(s: Saved) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** First guess from the GPU's name, before anything has been measured. */
export function guessTier(gpu: string): Tier {
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(g)) return 0;
  const touch = window.matchMedia?.('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 820;
  if (touch || /mali|adreno|powervr|videocore/.test(g)) return 0;
  if (/intel|uhd|iris|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d graphics/.test(g)) return 1;
  if (/apple m\d|apple gpu/.test(g)) return 2;
  if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|arc/.test(g)) return 2;
  return 1;
}

interface QualityState {
  mode: 'auto' | Tier;
  tier: Tier;
  gpu: string;
  setMode: (m: 'auto' | Tier) => void;
  /** Governor: start from the learned/guessed tier for this GPU. */
  init: (gpu: string) => void;
  /** Governor: an automatic tier change. */
  auto: (t: Tier) => void;
}

const saved = typeof window !== 'undefined' ? load() : { mode: 'auto' as const, learned: {} };

export const useQuality = create<QualityState>((set, get) => ({
  mode: saved.mode,
  tier: saved.mode === 'auto' ? 1 : saved.mode,
  gpu: '',
  setMode: (mode) => {
    const st = get();
    const tier = mode === 'auto' ? (load().learned[st.gpu] ?? guessTier(st.gpu)) : mode;
    set({ mode, tier });
    save({ ...load(), mode });
  },
  init: (gpu) => {
    const s = load();
    const tier = s.mode === 'auto' ? (s.learned[gpu] ?? guessTier(gpu)) : s.mode;
    set({ gpu, tier });
  },
  auto: (tier) => {
    const st = get();
    if (st.mode !== 'auto' || st.tier === tier) return;
    set({ tier });
    const s = load();
    save({ ...s, learned: { ...s.learned, [st.gpu]: tier } });
  },
}));

export const profile = () => PROFILES[useQuality.getState().tier];
// Exposed for automated browser checks and debugging from the console.
if (typeof window !== 'undefined') (window as unknown as { __quality: unknown }).__quality = { perfStats, useQuality, PROFILES };
export const useProfile = () => useQuality((s) => PROFILES[s.tier]);

// Mirror the tier onto <html> so CSS can drop expensive effects (backdrop blur) on lower tiers.
if (typeof document !== 'undefined') {
  const apply = (t: Tier) => {
    document.documentElement.dataset.quality = String(t);
    document.documentElement.dataset.glass = PROFILES[t].glass ? '1' : '0';
  };
  apply(useQuality.getState().tier);
  useQuality.subscribe((s, p) => s.tier !== p.tier && apply(s.tier));
}
