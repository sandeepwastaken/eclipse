import stationList from '../../data/stations.json';
import { DEG, LIGHT_SPEED_KM_S, RAD } from './constants';
import { earthAt, earthRotationAt, type Ephemeris } from './ephemeris';
import type { SiteFrame } from './topocentric';
import { rotate, type Quat, type V3 } from './vec';

/**
 * The Earth end of the direct-to-Earth link.
 *
 * Geometry: each ground station's WGS84 position is rotated into the Moon-fixed frame with
 * Earth's orientation from the same SPICE ephemeris (IAU_EARTH), so "the Moon is up at Madrid"
 * comes from the same data as "Earth is up at the site". A station can take the link when the
 * landing site is above its elevation mask (10°, a typical deep-space operating limit).
 *
 * Link budget: free-space loss over the real range, dish gains, system noise and clear-sky
 * gaseous absorption, plus rain fade from ITU-R P.838 specific attenuation along the slant path.
 * The lander's radio is an assumed CLPS-class design (listed in BANDS); only the payload of the
 * "send a photo" demo is invented.
 */

export interface Station {
  id: string;
  name: string;
  where: string;
  agency: string;
  dish: string;
  dishM: number;
  lat: number;
  lon: number;
  altM: number;
}
export const STATIONS = stationList as Station[];
export const STATION_MASK_DEG = 10;

export type Band = 'S' | 'X' | 'Ka';
export interface BandSpec {
  band: Band;
  ghz: number;
  /** Lander transmitter RF power, W, and antenna gain, dBi. */
  txW: number;
  txGainDbi: number;
  txAntenna: string;
  /** Ground aperture efficiency and system noise temperature at zenith, K. */
  eff: number;
  tsysK: number;
  /** Zenith clear-sky gaseous absorption, dB. */
  gasZenithDb: number;
  /** ITU-R P.838-3 rain coefficients (circular polarisation average). */
  k: number;
  alpha: number;
  /** Fastest rate the assumed modem supports, bit/s. */
  maxRate: number;
}

export const BANDS: Record<Band, BandSpec> = {
  S: { band: 'S', ghz: 2.25, txW: 5, txGainDbi: 3, txAntenna: 'low-gain antenna', eff: 0.6, tsysK: 40, gasZenithDb: 0.035, k: 0.0000912, alpha: 1.0, maxRate: 2e6 },
  X: { band: 'X', ghz: 8.45, txW: 10, txGainDbi: 20, txAntenna: 'medium-gain antenna', eff: 0.6, tsysK: 30, gasZenithDb: 0.045, k: 0.00454, alpha: 1.33, maxRate: 2e7 },
  Ka: { band: 'Ka', ghz: 26, txW: 10, txGainDbi: 40, txAntenna: '0.5 m high-gain dish', eff: 0.5, tsysK: 60, gasZenithDb: 0.3, k: 0.172, alpha: 0.985, maxRate: 5e8 },
};
/** Turbo-coded BPSK/QPSK at a 10⁻⁶ bit error rate, plus an operating margin. */
export const REQ_EBN0_DB = 2.5;
export const MARGIN_DB = 3;
const K_BOLTZ_DB = -228.6;
const RAIN_TOP_KM = 3.2; // effective rain height at mid-latitudes (ITU-R P.839, ~0°C isotherm)

const WGS_A = 6378.137;
const WGS_E2 = 0.00669438;

/** Station position (km) and local vertical in Earth-fixed axes. */
const ecef = STATIONS.map((s) => {
  const p = s.lat * DEG, l = s.lon * DEG, h = s.altM / 1000;
  const N = WGS_A / Math.sqrt(1 - WGS_E2 * Math.sin(p) ** 2);
  return {
    pos: [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - WGS_E2) + h) * Math.sin(p)] as V3,
    up: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)] as V3,
  };
});

export interface StationView {
  station: Station;
  /** Elevation of the landing site above the station's horizon, deg. */
  el: number;
  rangeKm: number;
  up: boolean;
}

const sc = { e: [0, 0, 0] as V3, q: [0, 0, 0, 1] as Quat, p: [0, 0, 0] as V3, u: [0, 0, 0] as V3 };

/** Where every station sees the landing site at time t. */
export function stationViews(eph: Ephemeris, site: SiteFrame, t: number): StationView[] {
  earthAt(eph, t, sc.e);
  earthRotationAt(eph, t, sc.q);
  const P = site.position;
  return STATIONS.map((station, i) => {
    rotate(sc.q, ecef[i].pos, sc.p);
    rotate(sc.q, ecef[i].up, sc.u);
    // Station → site, Moon-fixed km.
    const dx = P[0] - (sc.e[0] + sc.p[0]), dy = P[1] - (sc.e[1] + sc.p[1]), dz = P[2] - (sc.e[2] + sc.p[2]);
    const r = Math.hypot(dx, dy, dz);
    const el = Math.asin((dx * sc.u[0] + dy * sc.u[1] + dz * sc.u[2]) / r) * RAD;
    return { station, el, rangeKm: r, up: el >= STATION_MASK_DEG };
  });
}

/** The station that would carry the link: the highest one above its mask (null if none). */
export function bestStation(views: StationView[]): StationView | null {
  let best: StationView | null = null;
  for (const v of views) if (v.up && (!best || v.el > best.el)) best = v;
  return best;
}

export const lightTimeS = (rangeKm: number) => rangeKm / LIGHT_SPEED_KM_S;

/** Rain attenuation on the slant path, dB (ITU-R P.838 specific attenuation, P.618-style path reduction). */
export function rainFadeDb(b: BandSpec, rainMmH: number, elDeg: number, stationAltKm: number): number {
  if (rainMmH <= 0) return 0;
  const el = Math.max(5, elDeg) * DEG;
  const gamma = b.k * Math.pow(rainMmH, b.alpha); // dB/km
  const Ls = Math.max(0, RAIN_TOP_KM - stationAltKm) / Math.sin(el);
  const L0 = 35 * Math.exp(-0.015 * Math.min(rainMmH, 100));
  const r = 1 / (1 + (Ls * Math.cos(el)) / L0);
  return gamma * Ls * r;
}

export interface LinkResult {
  band: Band;
  /** Carrier-to-noise density, dB-Hz. */
  cn0: number;
  rainDb: number;
  /** Highest supported rate that keeps the operating margin, bit/s (0 = no link). */
  rate: number;
  /** Margin at that rate, dB. */
  marginDb: number;
  fspl: number;
}

const db = (x: number) => 10 * Math.log10(x);

/** Downlink budget from the lander to one station. */
export function linkBudget(band: Band, view: StationView, rainMmH = 0): LinkResult {
  const b = BANDS[band];
  const lambda = 0.299792458 / b.ghz; // m
  const fspl = 20 * Math.log10((4 * Math.PI * view.rangeKm * 1000) / lambda);
  const eirp = db(b.txW) + b.txGainDbi;
  const gr = db(b.eff * ((Math.PI * view.station.dishM) / lambda) ** 2);
  const el = Math.max(3, view.el) * DEG;
  const gas = b.gasZenithDb / Math.sin(el);
  const rainDb = rainFadeDb(b, rainMmH, view.el, view.station.altM / 1000);
  // Rain also radiates: the lost signal comes back as extra sky noise.
  const tsys = b.tsysK + 275 * (1 - Math.pow(10, -(rainDb + gas) / 10));
  const cn0 = eirp - fspl - gas - rainDb + gr - db(tsys) - K_BOLTZ_DB;
  let rate = b.maxRate;
  while (rate >= 1000 && cn0 - db(rate) - REQ_EBN0_DB < MARGIN_DB) rate /= 2;
  if (rate < 1000) return { band, cn0, rainDb, rate: 0, marginDb: cn0 - db(1000) - REQ_EBN0_DB, fspl };
  return { band, cn0, rainDb, rate, marginDb: cn0 - db(rate) - REQ_EBN0_DB, fspl };
}

// ------------------------------------------------------------------ rain climatology (ERA5)

export interface MonthRain {
  hours: number;
  /** Share of hours with ≥ 0.1 mm/h. */
  wet: number;
  /** Rain rate exceeded 1 % / 0.1 % of hours, mm/h. */
  r1: number;
  r01: number;
  mean: number;
}
export interface StationWeather {
  source: string;
  generated: string;
  stations: Record<string, { cell: [number, number]; months: MonthRain[] }>;
}

let weatherPromise: Promise<StationWeather | null> | null = null;
let weatherValue: StationWeather | null = null;
export function loadStationWeather(): Promise<StationWeather | null> {
  weatherPromise ??= fetch(`${import.meta.env.BASE_URL}data/stations-weather.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((w: StationWeather | null) => (weatherValue = w))
    .catch(() => null);
  return weatherPromise;
}
export const stationWeatherNow = () => weatherValue;

/**
 * Probability that the hourly rain rate exceeds `r` mm/h, interpolated log-log between the
 * climatological points (0.1 mm/h, wet share), (r1, 1 %) and (r01, 0.1 %).
 */
export function rainExceedance(m: MonthRain, r: number): number {
  const pts: [number, number][] = [[0.1, Math.max(m.wet, 0.0011)], [Math.max(m.r1, 0.11), 0.01], [Math.max(m.r01, m.r1 + 0.01, 0.12), 0.001]].sort((a, b) => a[0] - b[0]) as [number, number][];
  if (r <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [r0, p0] = pts[i - 1], [r1, p1] = pts[i];
    if (r <= r1) {
      const f = Math.log(r / r0) / Math.log(r1 / r0);
      return Math.exp(Math.log(p0) + f * (Math.log(p1) - Math.log(p0)));
    }
  }
  // Beyond the 0.1 % point: keep falling at the last slope, floored.
  const [ra, pa] = pts[pts.length - 2], [rb, pb] = pts[pts.length - 1];
  const slope = (Math.log(pb) - Math.log(pa)) / Math.log(rb / ra);
  return Math.max(1e-6, Math.exp(Math.log(pb) + slope * Math.log(r / rb)));
}

/** Smallest rain rate (mm/h) that pushes the link below its margin at the given rate. */
function criticalRain(band: Band, view: StationView, rate: number): number {
  let lo = 0, hi = 300;
  const ok = (r: number) => {
    const L = linkBudget(band, view, r);
    return L.rate >= rate;
  };
  if (!ok(0)) return 0;
  if (ok(hi)) return Infinity;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Chance that rain at the station drops the link below the rate it would have in clear sky,
 * for this calendar month (climatology, not a forecast).
 */
export function rainOutage(band: Band, view: StationView, month: number): number | null {
  const w = weatherValue?.stations[view.station.id]?.months[month];
  if (!w) return null;
  const clear = linkBudget(band, view, 0);
  if (clear.rate === 0) return 1;
  const r = criticalRain(band, view, clear.rate);
  if (!Number.isFinite(r)) return 0;
  return Math.min(1, rainExceedance(w, r));
}

export const fmtRate = (bps: number) => (bps >= 1e9 ? `${(bps / 1e9).toFixed(1)} Gbit/s` : bps >= 1e6 ? `${(bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1)} Mbit/s` : bps >= 1e3 ? `${(bps / 1e3).toFixed(0)} kbit/s` : '—');
