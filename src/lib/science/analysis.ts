import { AU_KM, DAY_MS, EARTH_RADIUS_KM, HOUR_MS, LIGHT_SPEED_KM_S, MINUTE_MS, SOLAR_CONSTANT_W_M2, SUN_RADIUS_KM } from './constants';
import { earthAt, sunAt, type Ephemeris } from './ephemeris';
import { horizonAt, type HorizonProfile } from './horizon';
import { angularRadiusDeg, diskVisibleFraction, toHorizontal, type SiteFrame } from './topocentric';
import { angleBetween, sub, type V3 } from './vec';

/** How much of the solar disk must clear the terrain for a moment to count as sunlit. */
export type SunCriterion = 'any' | 'center' | 'full';

export interface Criteria {
  sun: SunCriterion;
  /** Minimum elevation of Earth's centre above the terrain horizon for direct-to-Earth line of sight, deg. */
  earthMaskDeg: number;
}

export const DEFAULT_CRITERIA: Criteria = { sun: 'center', earthMaskDeg: 0 };

export interface SiteModel {
  key: string;
  name: string;
  frame: SiteFrame;
  horizon: HorizonProfile;
}

export interface BodyInstant {
  az: number;
  el: number;
  /** Terrain (or sphere) horizon elevation at this azimuth, deg. */
  horizon: number;
  /** el − horizon, deg. */
  clearance: number;
  radiusDeg: number;
  /** Fraction of the apparent disk above the horizon, 0–1. */
  fraction: number;
  rangeKm: number;
  visible: boolean;
}

export interface Instant {
  t: number;
  sun: BodyInstant;
  earth: BodyInstant;
  both: boolean;
  /** Irradiance on a Sun-pointing surface, W/m², including partial disk occultation. */
  irradiance: number;
  /** Irradiance on a horizontal surface, W/m². */
  irradianceHorizontal: number;
  /** Illuminated fraction of Earth's disk as seen from the Moon, 0–1. */
  earthPhase: number;
  /** One-way light time to Earth's centre, s. */
  lightTimeS: number;
}

const sunScratch: V3 = [0, 0, 0];
const earthScratch: V3 = [0, 0, 0];

export function sunThresholdOffset(criterion: SunCriterion, radiusDeg: number): number {
  return criterion === 'any' ? -radiusDeg : criterion === 'full' ? radiusDeg : 0;
}

function body(frame: SiteFrame, horizon: HorizonProfile, pos: V3, radiusKm: number, offset: (r: number) => number): BodyInstant {
  const h = toHorizontal(frame, pos);
  const hor = horizonAt(horizon, h.az);
  const radiusDeg = angularRadiusDeg(radiusKm, h.rangeKm);
  const clearance = h.el - hor;
  return {
    az: h.az,
    el: h.el,
    horizon: hor,
    clearance,
    radiusDeg,
    fraction: diskVisibleFraction(clearance, radiusDeg),
    rangeKm: h.rangeKm,
    visible: clearance - offset(radiusDeg) > 0,
  };
}

export function instantAt(eph: Ephemeris, site: SiteModel, t: number, criteria: Criteria = DEFAULT_CRITERIA): Instant {
  const sunPos = sunAt(eph, t, sunScratch);
  const earthPos = earthAt(eph, t, earthScratch);
  const sun = body(site.frame, site.horizon, sunPos, SUN_RADIUS_KM, (r) => sunThresholdOffset(criteria.sun, r));
  const earth = body(site.frame, site.horizon, earthPos, EARTH_RADIUS_KM, () => criteria.earthMaskDeg);
  const flux = SOLAR_CONSTANT_W_M2 * (AU_KM / sun.rangeKm) ** 2;
  // Earth's phase seen from the Moon: angle at Earth between the Sun and the Moon.
  const earthToSun = sub(sunPos, earthPos, [0, 0, 0]);
  const earthToMoon: V3 = [-earthPos[0], -earthPos[1], -earthPos[2]];
  const phaseAngle = angleBetween(earthToSun, earthToMoon);
  return {
    t,
    sun,
    earth,
    both: sun.visible && earth.visible,
    irradiance: flux * sun.fraction,
    irradianceHorizontal: flux * sun.fraction * Math.max(0, Math.sin((sun.el * Math.PI) / 180)),
    earthPhase: (1 + Math.cos(phaseAngle)) / 2,
    lightTimeS: earth.rangeKm / LIGHT_SPEED_KM_S,
  };
}

export type Channel = 'sun' | 'earth' | 'both';

/** Signed margin (deg) of a channel: > 0 means available. `both` is the smaller of the two. */
export function marginAt(eph: Ephemeris, site: SiteModel, t: number, criteria: Criteria, channel: Channel): number {
  const i = instantAt(eph, site, t, criteria);
  const s = i.sun.clearance - sunThresholdOffset(criteria.sun, i.sun.radiusDeg);
  const e = i.earth.clearance - criteria.earthMaskDeg;
  return channel === 'sun' ? s : channel === 'earth' ? e : Math.min(s, e);
}

// ------------------------------------------------------------------ series

export interface Series {
  t0: number;
  step: number;
  n: number;
  sunEl: Float32Array;
  sunAz: Float32Array;
  sunHorizon: Float32Array;
  sunFraction: Float32Array;
  earthEl: Float32Array;
  earthAz: Float32Array;
  earthHorizon: Float32Array;
  sunMargin: Float32Array;
  earthMargin: Float32Array;
  irradiance: Float32Array;
}

export function computeSeries(eph: Ephemeris, site: SiteModel, t0: number, t1: number, step: number, criteria: Criteria): Series {
  const n = Math.max(2, Math.floor((t1 - t0) / step) + 1);
  const s: Series = {
    t0, step, n,
    sunEl: new Float32Array(n), sunAz: new Float32Array(n), sunHorizon: new Float32Array(n), sunFraction: new Float32Array(n),
    earthEl: new Float32Array(n), earthAz: new Float32Array(n), earthHorizon: new Float32Array(n),
    sunMargin: new Float32Array(n), earthMargin: new Float32Array(n), irradiance: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const t = Math.min(t1, t0 + i * step);
    const x = instantAt(eph, site, t, criteria);
    s.sunEl[i] = x.sun.el;
    s.sunAz[i] = x.sun.az;
    s.sunHorizon[i] = x.sun.horizon;
    s.sunFraction[i] = x.sun.fraction;
    s.earthEl[i] = x.earth.el;
    s.earthAz[i] = x.earth.az;
    s.earthHorizon[i] = x.earth.horizon;
    s.sunMargin[i] = x.sun.clearance - sunThresholdOffset(criteria.sun, x.sun.radiusDeg);
    s.earthMargin[i] = x.earth.clearance - criteria.earthMaskDeg;
    s.irradiance[i] = x.irradiance;
  }
  return s;
}

export const seriesTime = (s: Series, i: number): number => s.t0 + i * s.step;

// ------------------------------------------------------------------ intervals

export interface Interval {
  start: number;
  end: number;
}

/** Intervals where margin > 0, with crossing times linearly interpolated between samples. */
export function intervalsFromMargins(t0: number, step: number, margin: ArrayLike<number>, tEnd = t0 + (margin.length - 1) * step): Interval[] {
  const out: Interval[] = [];
  let openAt: number | null = margin[0] > 0 ? t0 : null;
  for (let i = 1; i < margin.length; i++) {
    const a = margin[i - 1];
    const b = margin[i];
    if ((a > 0) === (b > 0)) continue;
    const ta = t0 + (i - 1) * step;
    const tc = Math.min(tEnd, ta + step * (a / (a - b)));
    if (b > 0) openAt = tc;
    else if (openAt !== null) {
      out.push({ start: openAt, end: tc });
      openAt = null;
    }
  }
  if (openAt !== null) out.push({ start: openAt, end: tEnd });
  return out.filter((iv) => iv.end > iv.start);
}

export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) out.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
}

export const totalDuration = (iv: Interval[]): number => iv.reduce((s, x) => s + (x.end - x.start), 0);
export const longestDuration = (iv: Interval[]): number => iv.reduce((m, x) => Math.max(m, x.end - x.start), 0);

export interface ChannelSummary {
  intervals: Interval[];
  fraction: number;
  totalMs: number;
  longestMs: number;
  /** Longest gap without availability inside the window, ms. */
  longestGapMs: number;
}

function summarize(intervals: Interval[], t0: number, t1: number): ChannelSummary {
  const span = t1 - t0;
  let gap = 0, cursor = t0;
  for (const iv of intervals) {
    gap = Math.max(gap, iv.start - cursor);
    cursor = iv.end;
  }
  gap = Math.max(gap, t1 - cursor);
  const total = totalDuration(intervals);
  return { intervals, fraction: span > 0 ? total / span : 0, totalMs: total, longestMs: longestDuration(intervals), longestGapMs: gap };
}

export interface MissionAnalysis {
  t0: number;
  t1: number;
  series: Series;
  sun: ChannelSummary;
  earth: ChannelSummary;
  both: ChannelSummary;
  /** Mean irradiance on a Sun-pointing array over the window, W/m². */
  meanIrradiance: number;
  /** Solar energy available to a 1 m² Sun-pointing array over the window, kWh. */
  energyKWh: number;
  sunElRange: [number, number];
  earthElRange: [number, number];
}

export function missionStep(durationMs: number): number {
  return Math.min(30 * MINUTE_MS, Math.max(5 * MINUTE_MS, Math.ceil(durationMs / 4000 / MINUTE_MS) * MINUTE_MS));
}

export function analyzeMission(eph: Ephemeris, site: SiteModel, t0: number, durationMs: number, criteria: Criteria): MissionAnalysis {
  const t1 = Math.min(eph.end, t0 + durationMs);
  const step = missionStep(t1 - t0);
  const series = computeSeries(eph, site, t0, t1, step, criteria);
  const sunIv = intervalsFromMargins(t0, step, series.sunMargin, t1);
  const earthIv = intervalsFromMargins(t0, step, series.earthMargin, t1);
  const bothIv = intersectIntervals(sunIv, earthIv);
  let irr = 0, sMin = Infinity, sMax = -Infinity, eMin = Infinity, eMax = -Infinity;
  for (let i = 0; i < series.n; i++) {
    irr += series.irradiance[i];
    sMin = Math.min(sMin, series.sunEl[i]);
    sMax = Math.max(sMax, series.sunEl[i]);
    eMin = Math.min(eMin, series.earthEl[i]);
    eMax = Math.max(eMax, series.earthEl[i]);
  }
  const meanIrradiance = irr / series.n;
  return {
    t0, t1, series,
    sun: summarize(sunIv, t0, t1),
    earth: summarize(earthIv, t0, t1),
    both: summarize(bothIv, t0, t1),
    meanIrradiance,
    energyKWh: (meanIrradiance * (t1 - t0)) / HOUR_MS / 1000,
    sunElRange: [sMin, sMax],
    earthElRange: [eMin, eMax],
  };
}

// ------------------------------------------------------------------ long-range (full ephemeris)

export interface LongSeries {
  t0: number;
  step: number;
  n: number;
  sun: Float32Array;
  earth: Float32Array;
}

/** Hourly margins over the whole ephemeris, for event search and landing-date scans. */
export function computeLongSeries(eph: Ephemeris, site: SiteModel, criteria: Criteria): LongSeries {
  const n = eph.count;
  const sun = new Float32Array(n);
  const earth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = instantAt(eph, site, eph.start + i * eph.step, criteria);
    sun[i] = x.sun.clearance - sunThresholdOffset(criteria.sun, x.sun.radiusDeg);
    earth[i] = x.earth.clearance - criteria.earthMaskDeg;
  }
  return { t0: eph.start, step: eph.step, n, sun, earth };
}

export interface Transition {
  at: number;
  /** true when the channel becomes available at `at`. */
  rising: boolean;
}

/**
 * Next change of availability after time t, refined by bisection on the exact
 * (interpolated-ephemeris) margin to ~0.2 s. Returns null if none before the
 * end of the ephemeris.
 */
export function nextTransition(eph: Ephemeris, site: SiteModel, criteria: Criteria, long: LongSeries, t: number, channel: Channel): Transition | null {
  const margin = (tt: number) => marginAt(eph, site, tt, criteria, channel);
  const hourly = (i: number) => (channel === 'sun' ? long.sun[i] : channel === 'earth' ? long.earth[i] : Math.min(long.sun[i], long.earth[i]));
  const now = margin(t) > 0;
  let i = Math.max(0, Math.floor((t - long.t0) / long.step));
  // Within the current hour, check the exact margin at the next sample boundary first.
  for (; i < long.n - 1; i++) {
    const ta = Math.max(t, long.t0 + i * long.step);
    const tb = long.t0 + (i + 1) * long.step;
    const b = hourly(i + 1) > 0;
    if (b === now) continue;
    let lo = ta, hi = tb;
    for (let k = 0; k < 15; k++) {
      const mid = (lo + hi) / 2;
      if ((margin(mid) > 0) === now) lo = mid;
      else hi = mid;
    }
    return { at: hi, rising: !now };
  }
  return null;
}

// ------------------------------------------------------------------ landing date scan

export interface LandingScan {
  t0: number;
  step: number;
  n: number;
  durationMs: number;
  sun: Float32Array;
  earth: Float32Array;
  both: Float32Array;
}

/**
 * Availability fractions for every candidate landing time spaced `stepMs` apart
 * (same time of day as `anchor`), each over a mission of `durationMs`. Uses
 * hourly sampling of the long series (resolution ±1 h per window edge).
 */
export function scanLandingDates(long: LongSeries, anchor: number, durationMs: number, stepMs = DAY_MS): LandingScan {
  const hours = Math.max(1, Math.round(durationMs / long.step));
  const prefix = (pick: (i: number) => boolean) => {
    const p = new Float64Array(long.n + 1);
    for (let i = 0; i < long.n; i++) p[i + 1] = p[i] + (pick(i) ? 1 : 0);
    return p;
  };
  const ps = prefix((i) => long.sun[i] > 0);
  const pe = prefix((i) => long.earth[i] > 0);
  const pb = prefix((i) => long.sun[i] > 0 && long.earth[i] > 0);
  const tEnd = long.t0 + (long.n - 1) * long.step;
  let first = anchor;
  while (first - stepMs >= long.t0) first -= stepMs;
  const n = Math.max(0, Math.floor((tEnd - durationMs - first) / stepMs) + 1);
  const out: LandingScan = { t0: first, step: stepMs, n, durationMs, sun: new Float32Array(n), earth: new Float32Array(n), both: new Float32Array(n) };
  for (let k = 0; k < n; k++) {
    const i0 = Math.round((first + k * stepMs - long.t0) / long.step);
    const i1 = Math.min(long.n, i0 + hours);
    const span = i1 - i0;
    out.sun[k] = (ps[i1] - ps[i0]) / span;
    out.earth[k] = (pe[i1] - pe[i0]) / span;
    out.both[k] = (pb[i1] - pb[i0]) / span;
  }
  return out;
}
